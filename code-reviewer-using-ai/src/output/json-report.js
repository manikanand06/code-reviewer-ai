import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

/**
 * Stable JSON representation — for piping into other tools or storing as
 * a CI artifact. Excludes the raw diffs and full file contents to keep the
 * file small; the structured findings are what other tools care about.
 */
export async function writeJsonReport(result, outPath) {
  const slim = {
    schema: 'ai-code-reviewer.v1',
    generatedAt: result.generatedAt,
    model: result.model,
    source: {
      id: result.changes.id,
      title: result.changes.title,
      url: result.changes.url,
      baseRef: result.changes.baseRef,
      headRef: result.changes.headRef,
    },
    stats: result.stats,
    usage: result.usage,
    cost: result.cost,
    cache: { hits: result.cacheHits, misses: result.cacheMisses },
    summary: result.aggregateReview?.summary ?? '',
    files: result.fileResults.map((f) => ({
      path: f.filePath,
      changeType: f.changeType,
      stats: f.stats,
      summary: f.review.summary,
    })),
    issues: result.issues.map((i) => ({
      title: i.title,
      description: i.description,
      severity: i.severity,
      category: i.category,
      file: i.file,
      line_start: i.line_start,
      line_end: i.line_end,
      confidence: i.confidence,
      suggested_fix: i.suggested_fix,
      source: i._source,
    })),
  };
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify(slim, null, 2), 'utf8');
  return outPath;
}
