/**
 * Zero-dependency test runner used by the unit tests.
 *
 * Why not Jest/Vitest: this project is meant to be a small, vendorable tool.
 * Adding a test framework just to run ~30 assertions doubles the install
 * footprint. Node 18 ships everything we need.
 *
 * Discovery & invocation lives in tests/run.js (see end of file for why).
 */

const tests = [];
let currentSuite = '';

export function describe(name, fn) {
  const prev = currentSuite;
  currentSuite = currentSuite ? `${currentSuite} > ${name}` : name;
  fn();
  currentSuite = prev;
}

export function test(name, fn) {
  tests.push({ name: currentSuite ? `${currentSuite} > ${name}` : name, fn });
}

export function expect(actual) {
  return {
    toBe(expected) {
      if (!Object.is(actual, expected)) {
        throw new Error(`Expected ${JSON.stringify(expected)} but got ${JSON.stringify(actual)}`);
      }
    },
    toEqual(expected) {
      const a = JSON.stringify(actual);
      const b = JSON.stringify(expected);
      if (a !== b) throw new Error(`Expected ${b} but got ${a}`);
    },
    toBeTruthy() {
      if (!actual) throw new Error(`Expected truthy but got ${JSON.stringify(actual)}`);
    },
    toBeFalsy() {
      if (actual) throw new Error(`Expected falsy but got ${JSON.stringify(actual)}`);
    },
    toContain(sub) {
      if (typeof actual === 'string') {
        if (!actual.includes(sub)) throw new Error(`Expected string to contain ${JSON.stringify(sub)}`);
      } else if (Array.isArray(actual)) {
        if (!actual.includes(sub)) throw new Error(`Expected array to contain ${JSON.stringify(sub)}`);
      } else {
        throw new Error('toContain only works on strings or arrays');
      }
    },
    toThrow(matcher) {
      let threw = false;
      let err;
      try { actual(); } catch (e) { threw = true; err = e; }
      if (!threw) throw new Error('Expected function to throw');
      if (matcher && !err.message.includes(matcher)) {
        throw new Error(`Expected error to include "${matcher}" but got "${err.message}"`);
      }
    },
    toBeGreaterThan(n) {
      if (!(actual > n)) throw new Error(`Expected > ${n} but got ${actual}`);
    },
    toBeLessThan(n) {
      if (!(actual < n)) throw new Error(`Expected < ${n} but got ${actual}`);
    },
  };
}

export async function run() {
  let passed = 0;
  let failed = 0;
  const failures = [];
  for (const t of tests) {
    try {
      await t.fn();
      passed += 1;
      process.stdout.write(`  \x1b[32m✓\x1b[0m ${t.name}\n`);
    } catch (err) {
      failed += 1;
      failures.push({ name: t.name, err });
      process.stdout.write(`  \x1b[31m✗\x1b[0m ${t.name}\n`);
    }
  }
  process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
  if (failed) {
    process.stdout.write('\n--- Failures ---\n');
    for (const f of failures) {
      process.stdout.write(`\n${f.name}\n${f.err.stack || f.err.message}\n`);
    }
    process.exit(1);
  }
}

// Discovery & invocation lives in tests/run.js to avoid a circular top-level
// await deadlock: test files statically import this file, so this file cannot
// itself await their import.

