import { describe, test, expect } from './runner.js';
import {
  diffStats,
  chunkDiffOnHunks,
  changedLineRanges,
  overlapsChangedLines,
} from '../src/utils/diff.js';

const sampleDiff = `@@ -1,3 +1,4 @@
 const a = 1;
-const b = 2;
+const b = 3;
+const c = 4;
 const d = 5;
@@ -10,2 +11,3 @@
 const e = 6;
+const f = 7;
 const g = 8;
`;

describe('diffStats', () => {
  test('counts adds, removes, hunks', () => {
    const s = diffStats(sampleDiff);
    expect(s.added).toBe(3);
    expect(s.removed).toBe(1);
    expect(s.hunks).toBe(2);
  });

  test('empty diff', () => {
    expect(diffStats('').added).toBe(0);
    expect(diffStats('').hunks).toBe(0);
  });
});

describe('chunkDiffOnHunks', () => {
  test('keeps small diffs as one chunk', () => {
    const chunks = chunkDiffOnHunks(sampleDiff, 100_000);
    expect(chunks.length).toBe(1);
    expect(chunks[0]).toBe(sampleDiff);
  });

  test('splits on hunk boundaries when too large', () => {
    const chunks = chunkDiffOnHunks(sampleDiff, 50);
    expect(chunks.length).toBeGreaterThan(1);
    // Every chunk should contain at least one hunk header.
    for (const c of chunks) expect(c.includes('@@')).toBeTruthy();
  });

  test('never splits inside a hunk', () => {
    const chunks = chunkDiffOnHunks(sampleDiff, 50);
    // Total hunk count preserved across chunks
    const totalHunks = chunks
      .map((c) => (c.match(/^@@ /gm) || []).length)
      .reduce((a, b) => a + b, 0);
    expect(totalHunks).toBe(2);
  });
});

describe('changedLineRanges', () => {
  test('returns NEW-side ranges as {start,end} objects', () => {
    const ranges = changedLineRanges(sampleDiff);
    // First hunk: header is +1,4 → range 1..4. Second: +11,3 → 11..13.
    expect(ranges.length).toBe(2);
    expect(ranges[0].start).toBe(1);
    expect(ranges[0].end).toBe(4);
    expect(ranges[1].start).toBe(11);
    expect(ranges[1].end).toBe(13);
  });
});

describe('overlapsChangedLines', () => {
  test('true for changed lines', () => {
    expect(overlapsChangedLines(sampleDiff, 2, 2)).toBeTruthy();
    expect(overlapsChangedLines(sampleDiff, 12, 12)).toBeTruthy();
  });
  test('false for unchanged lines', () => {
    expect(overlapsChangedLines(sampleDiff, 99, 99)).toBeFalsy();
  });
  test('inclusive range overlap', () => {
    expect(overlapsChangedLines(sampleDiff, 1, 5)).toBeTruthy();
  });
});
