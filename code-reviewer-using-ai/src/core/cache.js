import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

/**
 * Filesystem cache keyed by content hash.
 *
 * Why: re-running a review against the same diff (e.g., after iterating on
 * a different file in the PR, or running in CI on a no-op rebase) shouldn't
 * cost API tokens or time. The original tool re-ran every file every time.
 *
 * Cache key = sha256(model | systemPromptHash | userPrompt | schemaName).
 * If any of those change, we invalidate automatically.
 */
export class ReviewCache {
  constructor({ dir = '.ai-review-cache', enabled = true } = {}) {
    this.dir = path.resolve(dir);
    this.enabled = enabled;
  }

  static keyFor({ model, system, user, schemaName }) {
    return createHash('sha256')
      .update(model)
      .update('\x00')
      .update(system)
      .update('\x00')
      .update(user)
      .update('\x00')
      .update(schemaName)
      .digest('hex');
  }

  _path(key) {
    return path.join(this.dir, `${key.slice(0, 2)}`, `${key}.json`);
  }

  async get(key) {
    if (!this.enabled) return null;
    try {
      const data = await readFile(this._path(key), 'utf8');
      return JSON.parse(data);
    } catch {
      return null;
    }
  }

  async set(key, value) {
    if (!this.enabled) return;
    try {
      await mkdir(path.dirname(this._path(key)), { recursive: true });
      await writeFile(this._path(key), JSON.stringify(value), 'utf8');
    } catch {
      // Cache failures are non-fatal — just lose the speed boost.
    }
  }
}
