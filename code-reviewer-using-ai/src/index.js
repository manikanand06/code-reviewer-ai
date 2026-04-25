/**
 * Public programmatic API.
 *
 * Anyone using this as a library (rather than the CLI) imports from here:
 *
 *   import {
 *     loadConfig,
 *     buildAIProviderFromConfig,
 *     ReviewPipeline,
 *     LocalGitProvider,
 *     GitHubProvider,
 *     AzureDevOpsProvider,
 *     writeHtmlReport,
 *     writeJsonReport,
 *   } from 'ai-code-reviewer';
 */
export { loadConfig, buildAIProviderFromConfig } from './config.js';

export { ReviewPipeline } from './core/pipeline.js';
export { ReviewCache } from './core/cache.js';
export {
  REVIEW_SCHEMA,
  SEVERITY,
  CATEGORY,
  SEVERITY_RANK,
  validateReview,
} from './core/schema.js';
export { detectLanguage, isReviewable, languageGuidance } from './core/language.js';
export {
  SYSTEM_PROMPT,
  buildFileReviewPrompt,
  buildAggregatePrompt,
} from './core/prompt-builder.js';

export { BaseSourceProvider } from './providers/source/base.js';
export { LocalGitProvider } from './providers/source/local-git.js';
export { GitHubProvider } from './providers/source/github.js';
export { AzureDevOpsProvider } from './providers/source/azure-devops.js';

export { BaseAIProvider } from './providers/ai/base.js';
export { OpenAIProvider } from './providers/ai/openai.js';
export { AzureOpenAIProvider } from './providers/ai/azure-openai.js';

export { writeHtmlReport } from './output/html-report.js';
export { writeMarkdownReport } from './output/markdown-report.js';
export { writeJsonReport } from './output/json-report.js';
export { writeSarifReport } from './output/sarif-report.js';
export { printReportToConsole } from './output/console.js';

export { Logger } from './utils/logger.js';
export {
  diffStats,
  chunkDiffOnHunks,
  changedLineRanges,
  overlapsChangedLines,
} from './utils/diff.js';
