#!/usr/bin/env node
/**
 * ai-review — command-line entry point.
 *
 * Subcommands:
 *   local    Review uncommitted/staged/range changes in your local checkout
 *   github   Review a GitHub pull request
 *   azure    Review an Azure DevOps pull request
 *
 * Common flags (work for every subcommand):
 *   --config <path>          Path to ai-review.config.json
 *   --concurrency <n>        Parallel file reviews (default 4)
 *   --focus <cats>           Comma list: bug,security,performance,...
 *   --severity <level>       Drop issues below this severity in reports
 *   --no-cache               Disable on-disk cache
 *   --output-dir <dir>       Where to write reports (default review-output)
 *   --formats <list>         Comma list: html,markdown,json,sarif,console
 *   --post-comments          Post review back to the PR (github/azure only)
 *   --fail-on <severity>     Exit 1 if any issue >= this severity is found
 *   --ci                     Quiet mode + machine-readable stdout
 *   --verbose                Verbose logs
 */
import { hideBin } from 'yargs/helpers';
import yargs from 'yargs';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import ora from 'ora';
import chalk from 'chalk';

import { loadConfig, buildAIProviderFromConfig } from '../src/config.js';
import { Logger } from '../src/utils/logger.js';
import { ReviewCache } from '../src/core/cache.js';
import { ReviewPipeline } from '../src/core/pipeline.js';
import { SEVERITY_RANK } from '../src/core/schema.js';

import { writeHtmlReport } from '../src/output/html-report.js';
import { writeMarkdownReport } from '../src/output/markdown-report.js';
import { writeJsonReport } from '../src/output/json-report.js';
import { writeSarifReport } from '../src/output/sarif-report.js';
import { printReportToConsole } from '../src/output/console.js';

// ---------------------------------------------------------------------------
// Common option definitions, shared across subcommands.
// ---------------------------------------------------------------------------
function commonOptions(y) {
  return y
    .option('config', { type: 'string', describe: 'Path to ai-review.config.json' })
    .option('concurrency', { type: 'number', describe: 'Parallel file reviews' })
    .option('focus', { type: 'string', describe: 'Comma list of categories to focus on' })
    .option('severity', {
      type: 'string',
      describe: 'Minimum severity to include in reports',
      choices: ['critical', 'high', 'medium', 'low', 'info'],
    })
    .option('cache', { type: 'boolean', default: true, describe: 'Use on-disk cache' })
    .option('output-dir', { type: 'string', describe: 'Output directory' })
    .option('formats', {
      type: 'string',
      describe: 'Comma list of: html, markdown, json, sarif, console',
    })
    .option('post-comments', {
      type: 'boolean',
      default: false,
      describe: 'Post review back to the PR (github/azure only)',
    })
    .option('fail-on', {
      type: 'string',
      describe: 'Exit non-zero if any issue >= this severity is found',
      choices: ['critical', 'high', 'medium', 'low', 'info'],
    })
    .option('ci', { type: 'boolean', default: false, describe: 'CI mode: quiet + machine output' })
    .option('verbose', { type: 'boolean', default: false, describe: 'Verbose logging' });
}

// ---------------------------------------------------------------------------
// Build pipeline arguments from CLI + config.
// ---------------------------------------------------------------------------
function applyCliOverrides(cfg, argv) {
  if (argv.concurrency != null) cfg.pipeline.concurrency = argv.concurrency;
  if (argv.cache === false) cfg.pipeline.cacheEnabled = false;
  if (argv['output-dir']) cfg.output.dir = argv['output-dir'];
  if (argv.formats) cfg.output.formats = argv.formats.split(',').map((s) => s.trim()).filter(Boolean);
  if (argv.focus) {
    cfg.pipeline.focus = {
      categories: argv.focus.split(',').map((s) => s.trim()).filter(Boolean),
    };
  }
  return cfg;
}

function filterBySeverity(result, minSeverity) {
  if (!minSeverity) return result;
  const minRank = SEVERITY_RANK[minSeverity] ?? 0;
  const issues = result.issues.filter((i) => (SEVERITY_RANK[i.severity] ?? 0) >= minRank);
  return { ...result, issues };
}

// ---------------------------------------------------------------------------
// The main runner — shared by all subcommands once they've built a source provider.
// ---------------------------------------------------------------------------
async function runWithSource(sourceProvider, sourceLabel, argv) {
  const log = new Logger({ quiet: argv.ci, verbose: argv.verbose });
  const cfg = applyCliOverrides(loadConfig({ configPath: argv.config }), argv);

  if (cfg._loadedFrom) log.debug(`Loaded config from ${cfg._loadedFrom}`);
  log.info(`Source: ${sourceLabel}`);
  log.info(`AI provider: ${cfg.ai.provider}  model: ${cfg.ai.model}`);

  // --- Fetch changes ------------------------------------------------------
  const fetchSpinner = !argv.ci && ora({ stream: process.stderr, text: 'Fetching changes…' }).start();
  let changes;
  try {
    changes = await sourceProvider.fetchChanges();
    fetchSpinner && fetchSpinner.succeed(`Fetched ${changes.files.length} changed file(s)`);
  } catch (err) {
    fetchSpinner && fetchSpinner.fail('Failed to fetch changes');
    log.error(err.message);
    process.exit(2);
  }

  if (changes.files.length === 0) {
    log.warn('No changed files to review.');
    process.exit(0);
  }

  // --- Build AI provider --------------------------------------------------
  let ai;
  try {
    ai = await buildAIProviderFromConfig(cfg);
  } catch (err) {
    log.error(`Failed to build AI provider: ${err.message}`);
    process.exit(2);
  }

  // --- Pipeline -----------------------------------------------------------
  const cache = cfg.pipeline.cacheEnabled
    ? new ReviewCache({ dir: cfg.pipeline.cacheDir })
    : null;

  const reviewSpinner = !argv.ci && ora({ stream: process.stderr, text: 'Reviewing…' }).start();
  const pipeline = new ReviewPipeline({
    aiProvider: ai,
    logger: log,
    cache: cache ?? new ReviewCache({ dir: '.tmp-no-cache', enabled: false }),
    concurrency: cfg.pipeline.concurrency,
    skipUnreviewable: cfg.pipeline.skipUnreviewable,
    focus: cfg.pipeline.focus,
    onProgress: ({ done, total, file }) => {
      if (reviewSpinner) {
        reviewSpinner.text = `Reviewing… ${done}/${total}${file ? '  ' + file : ''}`;
      }
    },
  });

  let result;
  try {
    result = await pipeline.run(changes);
    reviewSpinner && reviewSpinner.succeed(
      `Reviewed ${result.stats.filesReviewed} file(s) — found ${result.stats.total} issue(s)`,
    );
  } catch (err) {
    reviewSpinner && reviewSpinner.fail('Review failed');
    log.error(err.message);
    if (argv.verbose) log.error(err.stack);
    process.exit(2);
  }

  // --- Severity filter (cosmetic — does not affect raw issues elsewhere) --
  const displayResult = filterBySeverity(result, argv.severity);

  // --- Outputs ------------------------------------------------------------
  const formats = new Set(cfg.output.formats || ['html', 'markdown', 'console']);
  const outDir = path.isAbsolute(cfg.output.dir)
    ? cfg.output.dir
    : path.join(process.cwd(), cfg.output.dir);
  if (formats.size > 1 || !formats.has('console')) {
    if (!existsSync(outDir)) await mkdir(outDir, { recursive: true });
  }
  const written = [];

  if (formats.has('html')) {
    const p = path.join(outDir, 'review.html');
    await writeHtmlReport(displayResult, p);
    written.push(p);
  }
  if (formats.has('markdown')) {
    const p = path.join(outDir, 'review.md');
    await writeMarkdownReport(displayResult, p);
    written.push(p);
  }
  if (formats.has('json')) {
    const p = path.join(outDir, 'review.json');
    await writeJsonReport(displayResult, p);
    written.push(p);
  }
  if (formats.has('sarif')) {
    const p = path.join(outDir, 'review.sarif');
    await writeSarifReport(displayResult, p);
    written.push(p);
  }
  if (formats.has('console') && !argv.ci) {
    printReportToConsole(displayResult);
  }

  for (const p of written) log.success(`Wrote ${path.relative(process.cwd(), p)}`);

  // --- Cost summary -------------------------------------------------------
  log.info(
    `Tokens: ${result.usage.input} in / ${result.usage.output} out  ` +
      `(cache: ${result.cacheHits} hit / ${result.cacheMisses} miss)  ` +
      `cost: ${result.cost != null ? '$' + result.cost.toFixed(4) : 'n/a'}`,
  );

  // --- Post comments back to PR -------------------------------------------
  if (argv['post-comments']) {
    if (typeof sourceProvider.postReview !== 'function') {
      log.warn('Source provider does not support posting comments.');
    } else {
      try {
        const body = buildPostBody(result);
        await sourceProvider.postReview({
          body,
          inlineIssues: result.issues,
          headSha: changes._meta?.headSha,
        });
        log.success('Posted review to PR.');
      } catch (err) {
        log.error(`Failed to post review: ${err.message}`);
      }
    }
  }

  // --- CI mode: emit JSON to stdout for downstream tools ------------------
  if (argv.ci && formats.has('json')) {
    const summary = {
      stats: result.stats,
      cost: result.cost,
      model: result.model,
      issues: result.issues,
    };
    log.raw(JSON.stringify(summary, null, 2) + '\n');
  }

  // --- Exit code ----------------------------------------------------------
  if (argv['fail-on']) {
    const threshold = SEVERITY_RANK[argv['fail-on']] ?? 0;
    const triggered = result.issues.some(
      (i) => (SEVERITY_RANK[i.severity] ?? 0) >= threshold,
    );
    if (triggered) {
      log.error(`Exiting 1 — at least one issue >= ${argv['fail-on']}`);
      process.exit(1);
    }
  }
  process.exit(0);
}

function buildPostBody(result) {
  const { stats, model, cost } = result;
  return [
    `### 🤖 AI Code Review`,
    ``,
    `Model: \`${model}\`  •  Cost: ${cost != null ? '$' + cost.toFixed(4) : 'n/a'}`,
    ``,
    `| Severity | Count |`,
    `|----------|------:|`,
    `| 🚨 Critical | ${stats.critical} |`,
    `| ⚠️ High | ${stats.high} |`,
    `| 🟡 Medium | ${stats.medium} |`,
    `| 🔵 Low | ${stats.low} |`,
    `| ℹ️ Info | ${stats.info} |`,
    ``,
    `_Inline comments below._`,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Subcommand definitions.
// ---------------------------------------------------------------------------
yargs(hideBin(process.argv))
  .scriptName('ai-review')
  .usage('$0 <command> [options]')
  .command(
    'local',
    'Review local working-tree changes',
    (y) =>
      commonOptions(y)
        .option('base', { type: 'string', describe: 'Base ref to diff against (e.g. main, origin/main)' })
        .option('staged', { type: 'boolean', default: false, describe: 'Review only staged changes' })
        .option('unstaged', { type: 'boolean', default: false, describe: 'Review only unstaged changes' })
        .option('range', { type: 'string', describe: 'Commit range, e.g. abc123..HEAD' }),
    async (argv) => {
      const { LocalGitProvider } = await import('../src/providers/source/local-git.js');
      const provider = new LocalGitProvider({
        base: argv.base ?? null,
        staged: argv.staged,
        unstaged: argv.unstaged,
        commitRange: argv.range ?? null,
      });
      const label = argv.range
        ? `local git range ${argv.range}`
        : argv.staged
          ? 'local git (staged)'
          : argv.unstaged
            ? 'local git (unstaged)'
            : `local git vs ${argv.base ?? 'main'}`;
      await runWithSource(provider, label, argv);
    },
  )
  .command(
    'github',
    'Review a GitHub pull request',
    (y) =>
      commonOptions(y)
        .option('owner', { type: 'string', describe: 'Repo owner (org or user)' })
        .option('repo', { type: 'string', describe: 'Repo name' })
        .option('pr', { type: 'number', demandOption: true, describe: 'PR number' })
        .option('token', { type: 'string', describe: 'GitHub token (or set GITHUB_TOKEN)' }),
    async (argv) => {
      const cfg = loadConfig({ configPath: argv.config });
      const owner = argv.owner ?? cfg.github?.owner;
      const repo = argv.repo ?? cfg.github?.repo;
      const token = argv.token ?? cfg.github?.token ?? process.env.GITHUB_TOKEN;
      if (!owner || !repo) {
        console.error('Missing --owner / --repo (or set GITHUB_REPOSITORY=owner/repo)');
        process.exit(2);
      }
      if (!token) {
        console.error('Missing --token / GITHUB_TOKEN');
        process.exit(2);
      }
      const { GitHubProvider } = await import('../src/providers/source/github.js');
      const provider = new GitHubProvider({ token, owner, repo, prNumber: argv.pr });
      await runWithSource(provider, `github ${owner}/${repo}#${argv.pr}`, argv);
    },
  )
  .command(
    'azure',
    'Review an Azure DevOps pull request',
    (y) =>
      commonOptions(y)
        .option('org', { type: 'string', describe: 'Org URL, e.g. https://dev.azure.com/yourorg' })
        .option('project', { type: 'string', describe: 'Project name' })
        .option('repo', { type: 'string', describe: 'Repo name' })
        .option('pr', { type: 'number', demandOption: true, describe: 'PR id' })
        .option('pat', { type: 'string', describe: 'Personal access token (or AZDO_PAT env)' }),
    async (argv) => {
      const cfg = loadConfig({ configPath: argv.config });
      const orgUrl = argv.org ?? cfg.azure?.orgUrl;
      const project = argv.project ?? cfg.azure?.project;
      const repo = argv.repo ?? cfg.azure?.repo;
      const pat = argv.pat ?? cfg.azure?.pat ?? process.env.AZDO_PAT;
      if (!orgUrl || !project || !repo) {
        console.error('Missing --org / --project / --repo (or set AZDO_ORG_URL / AZDO_PROJECT / AZDO_REPO)');
        process.exit(2);
      }
      if (!pat) {
        console.error('Missing --pat / AZDO_PAT');
        process.exit(2);
      }
      const { AzureDevOpsProvider } = await import('../src/providers/source/azure-devops.js');
      const provider = new AzureDevOpsProvider({ orgUrl, project, repo, prId: argv.pr, pat });
      await runWithSource(provider, `azure ${project}/${repo}#${argv.pr}`, argv);
    },
  )
  .demandCommand(1, 'Specify a subcommand: local, github, or azure')
  .help()
  .strict()
  .fail((msg, err) => {
    if (err) {
      console.error(chalk.red('✗'), err.message);
      if (process.env.AI_REVIEW_DEBUG) console.error(err.stack);
    } else {
      console.error(chalk.red('✗'), msg);
    }
    process.exit(2);
  })
  .parse();
