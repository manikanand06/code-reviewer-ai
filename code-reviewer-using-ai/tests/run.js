/**
 * Test entry point. Discovers all `*.test.js` files in this directory,
 * imports them (which registers their tests against the runner), then runs.
 *
 * Kept separate from runner.js so the test files can `import { describe, ... }
 * from './runner.js'` without creating a top-level await cycle.
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { run } from './runner.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const files = readdirSync(here)
  .filter((f) => f.endsWith('.test.js'))
  .sort();

for (const f of files) {
  await import(pathToFileURL(path.join(here, f)).href);
}

await run();
