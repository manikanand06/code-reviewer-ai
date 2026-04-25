import pLimit from 'p-limit';
import { REVIEW_SCHEMA, validateReview, SEVERITY_RANK } from './schema.js';
import { ReviewCache } from './cache.js';
import { SYSTEM_PROMPT, buildFileReviewPrompt, buildAggregatePrompt } from './prompt-builder.js';
import { chunkDiffOnHunks, diffStats, overlapsChangedLines } from '../utils/diff.js';
import { isReviewable } from './language.js';

/**
 * The end-to-end review pipeline.
 *
 * The original tool reviewed each file twice (once per file, once globally
 * by re-feeding the model EVERY diff). That doubles cost and produces noisy,
 * duplicated findings.
 *
 * This pipeline does:
 *
 *   PASS 1 — Per-file review, IN PARALLEL with a concurrency limit.
 *            Each file gets a structured-JSON review.
 *
 *   PASS 2 — Aggregate cross-file review. Receives only SUMMARIES from pass 1
 *            (not the full diffs again), and is asked to find issues that
 *            only emerge when seeing files together — missing test updates,
 *            renamed-but-not-updated callsites, etc. Much cheaper, much more
 *            useful.
 *
 *   POST   — Validate every issue's line numbers against the actual diff,
 *            drop any that fall outside changed regions (model hallucinations).
 */
export class ReviewPipeline {
  constructor({
    aiProvider,
    logger,
    cache = new ReviewCache(),
    concurrency = 4,
    skipUnreviewable = true,
    focus = null, // { categories?: string[] }
    maxFileBytes = 200_000,
    onProgress = null, // ({ done, total, file }) => void
  }) {
    this.ai = aiProvider;
    this.log = logger;
    this.cache = cache;
    this.concurrency = concurrency;
    this.skipUnreviewable = skipUnreviewable;
    this.focus = focus;
    this.maxFileBytes = maxFileBytes;
    this.onProgress = onProgress;

    this.totalUsage = { input: 0, output: 0, total: 0 };
    this.cacheHits = 0;
    this.cacheMisses = 0;
  }

  _accumulateUsage(usage) {
    if (!usage) return;
    this.totalUsage.input += usage.input ?? 0;
    this.totalUsage.output += usage.output ?? 0;
    this.totalUsage.total += usage.total ?? 0;
  }

  /** Single file review with caching. */
  async _reviewFile(file) {
    const userPrompt = buildFileReviewPrompt({
      filePath: file.path,
      diff: file.diff,
      fullFile: file.newContent && file.newContent.length < this.maxFileBytes ? file.newContent : null,
      focus: this.focus,
    });

    const cacheKey = ReviewCache.keyFor({
      model: this.ai.modelId,
      system: SYSTEM_PROMPT,
      user: userPrompt,
      schemaName: REVIEW_SCHEMA.name,
    });

    const cached = await this.cache.get(cacheKey);
    if (cached) {
      this.cacheHits += 1;
      this.log.debug(`cache hit: ${file.path}`);
      return { review: cached.review, usage: { input: 0, output: 0, total: 0 }, cached: true };
    }

    this.cacheMisses += 1;
    const { data, usage } = await this.ai.chatJSON({
      system: SYSTEM_PROMPT,
      user: userPrompt,
      schema: REVIEW_SCHEMA,
    });

    const validationErr = validateReview(data);
    if (validationErr) {
      this.log.warn(`Validation warning for ${file.path}: ${validationErr}`);
      // Return an empty review rather than crashing the whole pipeline.
      return {
        review: { summary: `(Review failed validation: ${validationErr})`, issues: [] },
        usage,
        cached: false,
      };
    }

    // Validate line numbers against the diff and drop hallucinated ones.
    data.issues = data.issues.filter((iss) => {
      const ok = overlapsChangedLines(file.diff, iss.line_start, iss.line_end);
      if (!ok) {
        this.log.debug(
          `Dropping ${file.path}:${iss.line_start}-${iss.line_end} "${iss.title}" — line outside diff`
        );
      }
      // Always rewrite issue.file to the canonical path (model sometimes drops the directory).
      iss.file = file.path;
      return ok;
    });

    await this.cache.set(cacheKey, { review: data });
    return { review: data, usage, cached: false };
  }

  async run(changes) {
    const reviewable = changes.files.filter((f) => {
      if (f.changeType === 'delete') return false;
      if (!f.diff || f.diff.trim() === '') return false;
      if (this.skipUnreviewable && !isReviewable(f.path)) return false;
      return true;
    });

    if (this.onProgress) this.onProgress({ done: 0, total: reviewable.length, file: null });

    // PASS 1: Per-file, parallel.
    const limit = pLimit(this.concurrency);
    let done = 0;
    const fileResults = await Promise.all(
      reviewable.map((file) =>
        limit(async () => {
          // Handle very large diffs by chunking on hunk boundaries.
          const chunks = chunkDiffOnHunks(file.diff, 100_000);
          let combinedIssues = [];
          let combinedSummary = '';

          for (let ci = 0; ci < chunks.length; ci += 1) {
            const fileForChunk =
              chunks.length === 1 ? file : { ...file, diff: chunks[ci] };
            try {
              const { review, usage } = await this._reviewFile(fileForChunk);
              this._accumulateUsage(usage);
              combinedIssues = combinedIssues.concat(review.issues);
              combinedSummary = combinedSummary
                ? `${combinedSummary}\n\n${review.summary}`
                : review.summary;
            } catch (err) {
              this.log.error(`Failed to review ${file.path} (chunk ${ci + 1}/${chunks.length}): ${err.message}`);
              combinedSummary = `(error: ${err.message})`;
            }
          }

          done += 1;
          if (this.onProgress) this.onProgress({ done, total: reviewable.length, file: file.path });

          return {
            filePath: file.path,
            changeType: file.changeType,
            stats: diffStats(file.diff),
            review: { summary: combinedSummary, issues: combinedIssues },
          };
        })
      )
    );

    // PASS 2: Cross-file aggregate.
    let aggregateReview = { summary: '', issues: [] };
    if (fileResults.length > 0) {
      try {
        const aggregatePrompt = buildAggregatePrompt({
          fileResults,
          prTitle: changes.title,
          prDescription: changes.description,
        });
        const cacheKey = ReviewCache.keyFor({
          model: this.ai.modelId,
          system: SYSTEM_PROMPT,
          user: aggregatePrompt,
          schemaName: REVIEW_SCHEMA.name,
        });
        const cached = await this.cache.get(cacheKey);
        if (cached) {
          aggregateReview = cached.review;
          this.cacheHits += 1;
        } else {
          this.cacheMisses += 1;
          const { data, usage } = await this.ai.chatJSON({
            system: SYSTEM_PROMPT,
            user: aggregatePrompt,
            schema: REVIEW_SCHEMA,
          });
          this._accumulateUsage(usage);
          if (!validateReview(data)) {
            aggregateReview = data;
            await this.cache.set(cacheKey, { review: data });
          }
        }
      } catch (err) {
        this.log.error(`Aggregate pass failed: ${err.message}`);
      }
    }

    // Combine all issues. Sort by severity desc, then by file, then by line.
    const allIssues = [
      ...fileResults.flatMap((r) => r.review.issues.map((i) => ({ ...i, _source: 'per-file' }))),
      ...aggregateReview.issues.map((i) => ({ ...i, _source: 'cross-file' })),
    ];
    allIssues.sort((a, b) => {
      const sa = SEVERITY_RANK[a.severity] ?? 0;
      const sb = SEVERITY_RANK[b.severity] ?? 0;
      if (sa !== sb) return sb - sa;
      if (a.file !== b.file) return a.file.localeCompare(b.file);
      return (a.line_start ?? 0) - (b.line_start ?? 0);
    });

    // Aggregate stats by severity.
    const stats = {
      critical: 0, high: 0, medium: 0, low: 0, info: 0,
      total: allIssues.length,
      filesReviewed: reviewable.length,
      filesSkipped: changes.files.length - reviewable.length,
    };
    for (const i of allIssues) stats[i.severity] += 1;

    const cost = this.ai.estimateCost(this.totalUsage);

    return {
      changes,
      fileResults,
      aggregateReview,
      issues: allIssues,
      stats,
      usage: this.totalUsage,
      cost,
      cacheHits: this.cacheHits,
      cacheMisses: this.cacheMisses,
      model: this.ai.modelId,
      generatedAt: new Date().toISOString(),
    };
  }
}
