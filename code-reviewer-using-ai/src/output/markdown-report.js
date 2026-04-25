import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

/**
 * Markdown report — for archival, README pasting, etc. Cleaner than the
 * original because it's built from structured data, not stitched together
 * from raw model output.
 */
export async function writeMarkdownReport(result, outPath) {
  const md = renderMarkdown(result);
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, md, 'utf8');
  return outPath;
}

function sevEmoji(sev) {
  return { critical: '🚨', high: '⚠️', medium: '🟡', low: '🔵', info: 'ℹ️' }[sev] ?? '•';
}

function renderMarkdown(result) {
  const c = result.changes;
  const lines = [];

  lines.push(`# AI Code Review — ${c.title || c.id}`);
  lines.push('');
  if (c.url) lines.push(`Source: ${c.url}`);
  lines.push(`Branches: \`${c.headRef}\` → \`${c.baseRef}\``);
  lines.push(`Generated: ${new Date(result.generatedAt).toLocaleString()}`);
  lines.push(`Model: \`${result.model}\` · Tokens: ${result.usage.total.toLocaleString()}` +
    (result.cost ? ` · est. $${result.cost.toFixed(4)}` : ''));
  lines.push('');

  // Severity stats
  lines.push('## Summary');
  lines.push('');
  lines.push('| Severity | Count |');
  lines.push('|---|---|');
  for (const sev of ['critical', 'high', 'medium', 'low', 'info']) {
    lines.push(`| ${sevEmoji(sev)} ${sev} | ${result.stats[sev]} |`);
  }
  lines.push(`| **Total** | **${result.stats.total}** |`);
  lines.push('');

  if (result.aggregateReview?.summary) {
    lines.push('### Overall verdict');
    lines.push('');
    lines.push(result.aggregateReview.summary);
    lines.push('');
  }

  if (result.issues.length === 0) {
    lines.push('## Issues');
    lines.push('');
    lines.push('_No issues found._ ✨');
    lines.push('');
    return lines.join('\n');
  }

  lines.push('## Issues');
  lines.push('');

  // Group by file
  const byFile = new Map();
  for (const i of result.issues) {
    if (!byFile.has(i.file)) byFile.set(i.file, []);
    byFile.get(i.file).push(i);
  }

  for (const [file, items] of byFile) {
    lines.push(`### \`${file}\``);
    lines.push('');
    for (const i of items) {
      const lineRef = i.line_end !== i.line_start ? `${i.line_start}-${i.line_end}` : `${i.line_start}`;
      lines.push(`#### ${sevEmoji(i.severity)} ${i.title}`);
      lines.push('');
      lines.push(`- **Severity:** ${i.severity} · **Category:** ${i.category} · **Confidence:** ${i.confidence}`);
      lines.push(`- **Location:** \`${file}\` line ${lineRef}`);
      lines.push('');
      lines.push(i.description);
      lines.push('');
      if (i.suggested_fix?.replacement_code) {
        lines.push(`**Suggested fix** — ${i.suggested_fix.explanation}`);
        lines.push('');
        lines.push('```');
        lines.push(i.suggested_fix.replacement_code);
        lines.push('```');
        lines.push('');
      } else if (i.suggested_fix?.explanation) {
        lines.push(`**Suggestion:** ${i.suggested_fix.explanation}`);
        lines.push('');
      }
    }
  }

  return lines.join('\n');
}
