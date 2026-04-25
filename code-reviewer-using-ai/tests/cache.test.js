import { describe, test, expect } from './runner.js';
import { ReviewCache } from '../src/core/cache.js';

describe('ReviewCache.keyFor', () => {
  test('is deterministic', () => {
    const a = ReviewCache.keyFor({ model: 'gpt-4o', system: 's', user: 'u', schemaName: 'r' });
    const b = ReviewCache.keyFor({ model: 'gpt-4o', system: 's', user: 'u', schemaName: 'r' });
    expect(a).toBe(b);
  });

  test('changes when model changes', () => {
    const a = ReviewCache.keyFor({ model: 'gpt-4o', system: 's', user: 'u', schemaName: 'r' });
    const b = ReviewCache.keyFor({ model: 'gpt-4o-mini', system: 's', user: 'u', schemaName: 'r' });
    expect(a === b).toBeFalsy();
  });

  test('changes when system prompt changes', () => {
    const a = ReviewCache.keyFor({ model: 'm', system: 's1', user: 'u', schemaName: 'r' });
    const b = ReviewCache.keyFor({ model: 'm', system: 's2', user: 'u', schemaName: 'r' });
    expect(a === b).toBeFalsy();
  });

  test('changes when user prompt changes', () => {
    const a = ReviewCache.keyFor({ model: 'm', system: 's', user: 'u1', schemaName: 'r' });
    const b = ReviewCache.keyFor({ model: 'm', system: 's', user: 'u2', schemaName: 'r' });
    expect(a === b).toBeFalsy();
  });

  test('null-byte separator prevents collision', () => {
    // Without a separator, ('ab','c') and ('a','bc') would hash the same.
    const a = ReviewCache.keyFor({ model: 'ab', system: 'c', user: '', schemaName: '' });
    const b = ReviewCache.keyFor({ model: 'a', system: 'bc', user: '', schemaName: '' });
    expect(a === b).toBeFalsy();
  });

  test('returns hex string of expected length', () => {
    const k = ReviewCache.keyFor({ model: 'm', system: 's', user: 'u', schemaName: 'r' });
    expect(k.length).toBe(64); // sha256 hex
    expect(/^[0-9a-f]{64}$/.test(k)).toBeTruthy();
  });
});

describe('ReviewCache instance', () => {
  test('disabled cache returns null on get and silently no-ops on set', async () => {
    const c = new ReviewCache({ dir: '.tmp-test-cache', enabled: false });
    const k = ReviewCache.keyFor({ model: 'm', system: 's', user: 'u', schemaName: 'r' });
    await c.set(k, { foo: 1 });
    expect(await c.get(k)).toBe(null);
  });
});
