import OpenAI from 'openai';
import { BaseAIProvider, withRetry } from './base.js';

/**
 * Standard OpenAI provider. Uses chat.completions with response_format
 * json_schema for guaranteed structured output (much stronger than the
 * original's "ask for markdown and pray" approach).
 */
export class OpenAIProvider extends BaseAIProvider {
  constructor({ apiKey, model = 'gpt-4o', baseURL = null, temperature = 0.1, maxOutputTokens = 4096 }) {
    super();
    if (!apiKey) throw new Error('OpenAI API key is required');
    this.client = new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) });
    this.model = model;
    this.temperature = temperature;
    this.maxOutputTokens = maxOutputTokens;
  }

  get modelId() {
    return this.model;
  }

  get pricing() {
    // Coarse pricing table for cost estimates. Update as needed; not relied on
    // for correctness — purely informational. Falls back to 0 for unknowns.
    const table = {
      'gpt-4o':         { input: 2.50, output: 10.00 },
      'gpt-4o-mini':    { input: 0.15, output: 0.60 },
      'gpt-4.1':        { input: 2.00, output: 8.00 },
      'gpt-4.1-mini':   { input: 0.40, output: 1.60 },
      'gpt-4.1-nano':   { input: 0.10, output: 0.40 },
      'o3-mini':        { input: 1.10, output: 4.40 },
    };
    return table[this.model] ?? null;
  }

  async chatJSON({ system, user, schema }) {
    return withRetry(async () => {
      const result = await this.client.chat.completions.create({
        model: this.model,
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
        throw new Error(`Model returned invalid JSON: ${err.message}\nContent: ${content.slice(0, 500)}`);
      }

      const usage = result.usage
        ? {
            input: result.usage.prompt_tokens ?? 0,
            output: result.usage.completion_tokens ?? 0,
            total: result.usage.total_tokens ?? 0,
          }
        : { input: 0, output: 0, total: 0 };

      return { data, usage };
    }, { label: `openai:${this.model}` });
  }
}
