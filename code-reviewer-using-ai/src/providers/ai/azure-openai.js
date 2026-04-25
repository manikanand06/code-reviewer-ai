import { AzureOpenAI } from 'openai';
import { BaseAIProvider, withRetry } from './base.js';

/**
 * Azure OpenAI provider. Preserves backward compatibility with the original
 * tool, which targeted Azure OpenAI exclusively.
 *
 * Differences from the original:
 *   - Uses structured JSON output (response_format json_schema).
 *   - Uses a system prompt distinct from the user prompt.
 *   - Bigger max_tokens default (the original 2048 cut off long reviews).
 *   - Retry uses Retry-After when available.
 */
export class AzureOpenAIProvider extends BaseAIProvider {
  constructor({ apiKey, endpoint, deployment, apiVersion = '2024-08-01-preview', temperature = 0.1, maxOutputTokens = 4096 }) {
    super();
    if (!apiKey) throw new Error('Azure OpenAI key is required');
    if (!endpoint) throw new Error('Azure OpenAI endpoint is required');
    if (!deployment) throw new Error('Azure OpenAI deployment is required');
    this.client = new AzureOpenAI({ apiKey, endpoint, apiVersion, deployment });
    this.deployment = deployment;
    this.temperature = temperature;
    this.maxOutputTokens = maxOutputTokens;
  }

  get modelId() {
    return `azure:${this.deployment}`;
  }

  async chatJSON({ system, user, schema }) {
    return withRetry(async () => {
      const result = await this.client.chat.completions.create({
        model: this.deployment, // Azure SDK accepts deployment as model id
        temperature: this.temperature,
        max_tokens: this.maxOutputTokens,
        response_format: {
          type: 'json_schema',
          json_schema: schema,
        },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      });

      const content = result.choices?.[0]?.message?.content ?? '';
      let data;
      try {
        data = JSON.parse(content);
      } catch (err) {
        throw new Error(`Azure OpenAI returned invalid JSON: ${err.message}\nContent: ${content.slice(0, 500)}`);
      }

      const usage = result.usage
        ? {
            input: result.usage.prompt_tokens ?? 0,
            output: result.usage.completion_tokens ?? 0,
            total: result.usage.total_tokens ?? 0,
          }
        : { input: 0, output: 0, total: 0 };

      return { data, usage };
    }, { label: `azure:${this.deployment}` });
  }
}
