/**
 * Diff utility functions.
 *
 * The original `chunk-utils.js` chunked by raw character count. That's brittle
 * because it can split a single hunk down the middle, leaving the model with
 * orphaned `+` lines and no @@ header. Here we chunk on hunk boundaries when
 * possible.
 */

/** Count the number of added/removed lines in a unified diff. */
export function diffStats(diff) {
  if (!diff) return { added: 0, removed: 0, hunks: 0 };
  let added = 0, removed = 0, hunks = 0;
  for (const line of diff.split('\n')) {
    if (line.startsWith('@@ ')) hunks += 1;
    else if (line.startsWith('+') && !line.startsWith('+++')) added += 1;
    else if (line.startsWith('-') && !line.startsWith('---')) removed += 1;
  }
  return { added, removed, hunks };
}

/**
 * Split a unified diff into chunks of approximately `maxChars`, preferring to
 * split on @@ hunk boundaries. Each chunk retains the file header.
 *
 * Returns an array of strings (each is a self-contained diff snippet).
 */
export function chunkDiffOnHunks(diff, maxChars = 100_000) {
  if (!diff || diff.length <= maxChars) return [diff];

  const lines = diff.split('\n');
  // Find file-header range (--- / +++) and hunk start indices.
  const headerLines = [];
  const hunkStarts = [];
  for (let i = 0; i < lines.length; i += 1) {
    const l = lines[i];
    if (l.startsWith('--- ') || l.startsWith('+++ ')) {
      if (hunkStarts.length === 0) headerLines.push(l);
    } else if (l.startsWith('@@ ')) {
      hunkStarts.push(i);
    }
  }
  if (hunkStarts.length === 0) {
    // No hunks — fall back to naive char split.
    const chunks = [];
    for (let i = 0; i < diff.length; i += maxChars) {
      chunks.push(diff.slice(i, i + maxChars));
    }
    return chunks;
  }

  const header = headerLines.join('\n');
  const chunks = [];
  let cur = header + '\n';

  for (let h = 0; h < hunkStarts.length; h += 1) {
    const start = hunkStarts[h];
    const end = h + 1 < hunkStarts.length ? hunkStarts[h + 1] : lines.length;
    const hunk = lines.slice(start, end).join('\n');

    if (cur.length + hunk.length > maxChars && cur.length > header.length + 1) {
      chunks.push(cur.trimEnd());
      cur = header + '\n';
    }
    cur += hunk + '\n';
  }
  if (cur.trim().length > header.length) chunks.push(cur.trimEnd());

  return chunks;
}

/**
 * Extract the set of NEW-FILE line ranges that the diff actually touches.
 * Used to validate AI-reported line numbers fall within changed regions.
 */
export function changedLineRanges(diff) {
  if (!diff) return [];
  const ranges = [];
  const re = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm;
  let m;
  while ((m = re.exec(diff))) {
    const start = parseInt(m[1], 10);
    const count = m[2] ? parseInt(m[2], 10) : 1;
    ranges.push({ start, end: start + Math.max(count - 1, 0) });
  }
  return ranges;
}

/** Whether a (line_start, line_end) overlaps any changed range in the diff. */
export function overlapsChangedLines(diff, lineStart, lineEnd) {
  const ranges = changedLineRanges(diff);
  for (const r of ranges) {
    if (lineStart <= r.end && lineEnd >= r.start) return true;
  }
  return false;
}
