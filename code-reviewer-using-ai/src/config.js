import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { config as loadDotenv } from 'dotenv';

/**
 * Config loader.
 *
 * Layered (later overrides earlier):
 *   1. Defaults below
 *   2. .env file in cwd
 *   3. Environment variables
 *   4. .ai-review.json or ai-review.config.json in cwd
 *   5. CLI flags (applied separately by the caller)
 *
 * The original tool required editing config.js with secrets. That makes
 * it impossible to commit your config without leaking, painful in CI, and
 * brittle when running against multiple PRs. Now you can:
 *   - export GITHUB_TOKEN=...; ai-review github --pr 123
 *   - or commit ai-review.config.json with non-secret bits and inject
 *     secrets via env in CI.
 */
const DEFAULTS = Object.freeze({
  ai: {
    provider: 'openai', // openai | azure-openai
    model: 'gpt-4o',
    temperature: 0.1,
    maxOutputTokens: 4096,
  },
  pipeline: {
    concurrency: 4,
    cacheDir: '.ai-review-cache',
    cacheEnabled: true,
    skipUnreviewable: true,
  },
  output: {
    dir: 'review-output',
    formats: ['html', 'markdown', 'console'], // any of: html, markdown, json, sarif, console
  },
});

export function loadConfig({ configPath = null } = {}) {
  loadDotenv(); // .env -> process.env

  const cfg = JSON.parse(JSON.stringify(DEFAULTS));

  // Find a config file unless explicitly disabled (configPath === false)
  const candidates = configPath
    ? [configPath]
    : ['ai-review.config.json', '.ai-review.json'];
  for (const c of candidates) {
    if (!c) continue;
    const full = path.isAbsolute(c) ? c : path.join(process.cwd(), c);
    if (existsSync(full)) {
      try {
        const fileCfg = JSON.parse(readFileSync(full, 'utf8'));
        deepMerge(cfg, fileCfg);
        cfg._loadedFrom = full;
        break;
      } catch (err) {
        throw new Error(`Failed to parse ${full}: ${err.message}`);
      }
    }
  }

  // Env vars (only fill in things the user didn't set in file).
  envOverlay(cfg);

  return cfg;
}

function deepMerge(target, source) {
  for (const k of Object.keys(source)) {
    if (source[k] && typeof source[k] === 'object' && !Array.isArray(source[k])) {
      target[k] = target[k] || {};
      deepMerge(target[k], source[k]);
    } else {
      target[k] = source[k];
    }
  }
}

function envOverlay(cfg) {
  // AI
  if (process.env.OPENAI_API_KEY) cfg.ai.openaiApiKey = process.env.OPENAI_API_KEY;
  if (process.env.OPENAI_MODEL) cfg.ai.model = process.env.OPENAI_MODEL;
  if (process.env.AZURE_OPENAI_KEY) cfg.ai.azureKey = process.env.AZURE_OPENAI_KEY;
  if (process.env.AZURE_OPENAI_ENDPOINT) cfg.ai.azureEndpoint = process.env.AZURE_OPENAI_ENDPOINT;
  if (process.env.AZURE_OPENAI_DEPLOYMENT) cfg.ai.azureDeployment = process.env.AZURE_OPENAI_DEPLOYMENT;
  if (process.env.AZURE_OPENAI_API_VERSION) cfg.ai.azureApiVersion = process.env.AZURE_OPENAI_API_VERSION;
  if (process.env.AI_PROVIDER) cfg.ai.provider = process.env.AI_PROVIDER;

  // Source: GitHub
  if (process.env.GITHUB_TOKEN) cfg.github = { ...(cfg.github ?? {}), token: process.env.GITHUB_TOKEN };
  if (process.env.GITHUB_REPOSITORY) {
    const [owner, repo] = process.env.GITHUB_REPOSITORY.split('/');
    cfg.github = { ...(cfg.github ?? {}), owner, repo };
  }

  // Source: Azure DevOps
  if (process.env.AZDO_PAT) cfg.azure = { ...(cfg.azure ?? {}), pat: process.env.AZDO_PAT };
  if (process.env.AZDO_ORG_URL) cfg.azure = { ...(cfg.azure ?? {}), orgUrl: process.env.AZDO_ORG_URL };
  if (process.env.AZDO_PROJECT) cfg.azure = { ...(cfg.azure ?? {}), project: process.env.AZDO_PROJECT };
  if (process.env.AZDO_REPO) cfg.azure = { ...(cfg.azure ?? {}), repo: process.env.AZDO_REPO };
}

export function buildAIProviderFromConfig(cfg) {
  // Imported lazily so unrelated commands don't pay the cost.
  if (cfg.ai.provider === 'azure-openai' || cfg.ai.provider === 'azure') {
    return import('./providers/ai/azure-openai.js').then(({ AzureOpenAIProvider }) =>
      new AzureOpenAIProvider({
        apiKey: cfg.ai.azureKey,
        endpoint: cfg.ai.azureEndpoint,
        deployment: cfg.ai.azureDeployment,
        apiVersion: cfg.ai.azureApiVersion,
        temperature: cfg.ai.temperature,
        maxOutputTokens: cfg.ai.maxOutputTokens,
      })
    );
  }
  return import('./providers/ai/openai.js').then(({ OpenAIProvider }) =>
    new OpenAIProvider({
      apiKey: cfg.ai.openaiApiKey,
      model: cfg.ai.model,
      temperature: cfg.ai.temperature,
      maxOutputTokens: cfg.ai.maxOutputTokens,
    })
  );
}
