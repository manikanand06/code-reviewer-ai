/**
 * Base class / interface for AI providers.
 *
 * All providers must implement `chatJSON({ system, user, schema })` which
 * returns:
 *   { data: <parsed JSON conforming to schema>, usage: { input, output, total } }
 *
 * The original code coupled the entire pipeline to AzureOpenAI. By separating
 * the AI backend from the review logic, we can support OpenAI, Azure OpenAI,
 * a local Ollama (via OpenAI-compatible API), or anything else without
 * touching the reviewer.
 */
export class BaseAIProvider {
  // eslint-disable-next-line no-unused-vars
  async chatJSON({ system, user, schema }) {
    throw new Error('chatJSON must be implemented by subclass');
  }

  /** Optional: model identifier for logging / cache keys. */
  get modelId() {
    return 'unknown';
  }

  /** Optional: per-token pricing in USD, used for cost reporting. Override to enable. */
  get pricing() {
    return null; // { input: $/1M tokens, output: $/1M tokens }
  }

  /** Compute cost from a usage record using `pricing`. Returns 0 if no pricing. */
  estimateCost(usage) {
    if (!this.pricing || !usage) return 0;
    const inputCost = (usage.input ?? 0) * (this.pricing.input ?? 0) / 1_000_000;
    const outputCost = (usage.output ?? 0) * (this.pricing.output ?? 0) / 1_000_000;
    return inputCost + outputCost;
  }
}

/** Sleep helper used by the retry wrapper. */
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Retry an async fn with exponential backoff on transient failures.
 * Honors Retry-After when present (e.g. on 429).
 */
export async function withRetry(fn, { maxAttempts = 4, baseDelayMs = 1000, label = 'operation' } = {}) {
  let attempt = 0;
  let delay = baseDelayMs;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      return await fn();
    } catch (err) {
      attempt += 1;
      const status = err?.status ?? err?.response?.status;
      const retriable =
        status === 429 ||
        status === 408 ||
        (status >= 500 && status < 600) ||
        ['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN'].includes(err?.code);

      if (!retriable || attempt >= maxAttempts) {
        err.message = `[${label}] failed after ${attempt} attempt(s): ${err.message}`;
        throw err;
      }

      // Honor Retry-After header on 429 if present (seconds or HTTP date).
      const retryAfter = err?.response?.headers?.['retry-after'] ?? err?.headers?.['retry-after'];
      let wait = delay;
      if (retryAfter) {
        const secs = Number(retryAfter);
        if (!Number.isNaN(secs)) wait = Math.max(wait, secs * 1000);
      }
      await sleep(wait);
      delay *= 2;
    }
  }
}
