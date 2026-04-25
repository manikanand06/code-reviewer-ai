# ai-code-reviewer

> Structured, multi-provider, AI code review for **local checkouts**, **GitHub PRs**, and **Azure DevOps PRs** — with caching, parallel review, JSON / SARIF / HTML / Markdown output, and CI-ready exit codes.

This is **v2**, a substantial rewrite of the original Azure-DevOps-only tool. It keeps full backward compatibility with Azure DevOps while adding everything below.

---

## Why this is different

| | Original | **v2** |
|---|---|---|
| Source platforms | Azure DevOps only | **Local git, GitHub, Azure DevOps** |
| Output | Free-form Markdown, parsed via regex | **Strict JSON schema** (no parsing tricks) |
| Per-file review | Sequential | **Parallel** with concurrency limit |
| Cross-file review | Re-feeds every diff a 2nd time (2× cost) | Pass-2 sees only **summaries** (cheap, smarter) |
| Line numbers | Trusted blindly | **Validated** against actual diff hunks — hallucinations dropped |
| Configuration | Edit `config.js` | **`.env`, JSON config file, CLI flags** — layered |
| Caching | None | **sha256 content-addressed** disk cache |
| Outputs | Fragile combined HTML | **HTML (interactive), Markdown, JSON, SARIF, Console** |
| CI integration | None | **Exit codes, SARIF upload, `--fail-on`, quiet mode** |
| PR comments | None | **Posts review with inline comments** (GitHub + Azure DevOps) |
| Cost tracking | None | **Tokens + $ per run** |
| Big diffs | Brittle char-based chunking | **Hunk-boundary chunking** |
| Prompt | Generic | **Language-aware** (40+ extensions) |
| AI providers | Azure OpenAI / OpenAI hardcoded | **Pluggable** — base class + JSON-schema enforcement |
| API surface | None | **Programmatic API** (`import { ReviewPipeline } from 'ai-code-reviewer'`) |

---

## Install

```bash
npm install
npm link            # optional: makes `ai-review` available globally
```

Requires **Node.js >= 18**.

---

## Quick start

### 1. Review your local working-tree changes (no PR needed)

```bash
# Compare working tree against main (default)
ai-review local --base main

# Just what you've staged
ai-review local --staged

# A specific commit range
ai-review local --range main..HEAD
```

This is the **killer feature**: get an AI review *before* you push.

### 2. Review a GitHub PR

```bash
export GITHUB_TOKEN=ghp_xxx
export OPENAI_API_KEY=sk-xxx

ai-review github --owner octocat --repo hello-world --pr 42 \
  --post-comments \
  --formats html,markdown,sarif
```

### 3. Review an Azure DevOps PR

```bash
export AZDO_PAT=xxx
export AZURE_OPENAI_KEY=xxx
export AZURE_OPENAI_ENDPOINT=https://...
export AZURE_OPENAI_DEPLOYMENT=gpt-4o
export AI_PROVIDER=azure-openai

ai-review azure \
  --org https://dev.azure.com/yourorg \
  --project YourProject \
  --repo your-repo \
  --pr 123 \
  --post-comments
```

---

## Configuration

Configuration is layered (later overrides earlier):

1. **Defaults** baked into the tool
2. `ai-review.config.json` (or `.ai-review.json`) in your repo root
3. `.env` file (auto-loaded)
4. Process environment variables
5. CLI flags

### Example `ai-review.config.json`

```json
{
  "ai": {
    "provider": "openai",
    "model": "gpt-4o-mini",
    "temperature": 0.1
  },
  "pipeline": {
    "concurrency": 6,
    "cacheEnabled": true,
    "focus": { "categories": ["security", "bug", "performance"] }
  },
  "output": {
    "dir": "review-output",
    "formats": ["html", "json", "sarif"]
  }
}
```

See [`ai-review.config.example.json`](./ai-review.config.example.json) for every option.

### Environment variables

See [`.env.example`](./.env.example). The most common:

| Var | Purpose |
|---|---|
| `OPENAI_API_KEY` | OpenAI API key |
| `OPENAI_MODEL` | Override model (default `gpt-4o`) |
| `AI_PROVIDER` | `openai` or `azure-openai` |
| `AZURE_OPENAI_KEY` / `_ENDPOINT` / `_DEPLOYMENT` / `_API_VERSION` | Azure OpenAI |
| `GITHUB_TOKEN` | GitHub auth |
| `GITHUB_REPOSITORY` | `owner/repo`, e.g. `octocat/hello-world` |
| `AZDO_PAT` / `AZDO_ORG_URL` / `AZDO_PROJECT` / `AZDO_REPO` | Azure DevOps |

---

## CLI reference

### Common flags (all subcommands)

| Flag | Purpose |
|---|---|
| `--config <path>` | Path to a JSON config file |
| `--concurrency <n>` | Parallel file reviews (default 4) |
| `--focus <cats>` | Comma list — restrict to specific categories |
| `--severity <level>` | Drop issues below this severity in *reports* |
| `--no-cache` | Disable disk cache |
| `--output-dir <dir>` | Where reports go (default `review-output`) |
| `--formats <list>` | `html,markdown,json,sarif,console` |
| `--post-comments` | Post review back to PR (github/azure) |
| `--fail-on <severity>` | Exit 1 if any issue >= severity is found |
| `--ci` | Quiet logs + JSON to stdout |
| `--verbose` | Verbose logs |

### Subcommand-specific

```bash
ai-review local   [--base <ref>] [--staged] [--unstaged] [--range <a..b>]
ai-review github  --pr <n> [--owner <o>] [--repo <r>] [--token <t>]
ai-review azure   --pr <n> [--org <url>] [--project <p>] [--repo <r>] [--pat <t>]
```

---

## CI integration

### GitHub Actions — review every PR + upload SARIF for Code Scanning

```yaml
# .github/workflows/ai-review.yml
name: AI Review
on:
  pull_request:
    types: [opened, synchronize, reopened]

permissions:
  contents: read
  pull-requests: write
  security-events: write   # for SARIF upload

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }

      - run: npm ci
        working-directory: ./tools/ai-code-reviewer

      - name: Run AI review
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
        run: |
          ./tools/ai-code-reviewer/bin/review.js github \
            --owner ${{ github.repository_owner }} \
            --repo ${{ github.event.repository.name }} \
            --pr ${{ github.event.pull_request.number }} \
            --formats markdown,sarif \
            --post-comments \
            --fail-on high \
            --ci

      - name: Upload SARIF
        if: always()
        uses: github/codeql-action/upload-sarif@v3
        with:
          sarif_file: review-output/review.sarif
```

`--fail-on high` makes the workflow fail (red ✗) when the model finds anything `high` or `critical` — gating merges. Tune to taste.

### Azure DevOps — pipeline step

```yaml
- script: |
    npm ci
    node ./tools/ai-code-reviewer/bin/review.js azure \
      --org $(System.CollectionUri) \
      --project $(System.TeamProject) \
      --repo $(Build.Repository.Name) \
      --pr $(System.PullRequest.PullRequestId) \
      --post-comments \
      --fail-on high
  env:
    AZDO_PAT: $(System.AccessToken)
    AZURE_OPENAI_KEY: $(AzureOpenAIKey)
    AZURE_OPENAI_ENDPOINT: $(AzureOpenAIEndpoint)
    AZURE_OPENAI_DEPLOYMENT: $(AzureOpenAIDeployment)
    AI_PROVIDER: azure-openai
  condition: eq(variables['Build.Reason'], 'PullRequest')
```

### Pre-push git hook

```bash
# .git/hooks/pre-push
#!/usr/bin/env bash
ai-review local --base origin/main --fail-on high --formats console
```

---

## Output formats

| Format | File | Use |
|---|---|---|
| `html` | `review.html` | Interactive — filter by severity, category, file. Theme toggle. Self-contained, no server needed. |
| `markdown` | `review.md` | Drop into PR descriptions, wiki, etc. |
| `json` | `review.json` | Stable schema (`ai-code-reviewer.v1`) — feed to other tooling |
| `sarif` | `review.sarif` | SARIF 2.1.0 — upload to GitHub Code Scanning, view in VS Code SARIF Viewer |
| `console` | stderr | Quick local feedback |

### JSON output schema (excerpt)

```json
{
  "version": "ai-code-reviewer.v1",
  "model": "gpt-4o-mini",
  "stats": { "critical": 0, "high": 1, "medium": 3, "low": 2, "info": 0, "total": 6 },
  "usage": { "input": 12000, "output": 1800, "total": 13800 },
  "cost": 0.0042,
  "issues": [
    {
      "title": "Possible null dereference",
      "description": "...",
      "severity": "high",
      "category": "bug",
      "file": "src/foo.ts",
      "line_start": 42,
      "line_end": 44,
      "confidence": "high",
      "suggested_fix": {
        "explanation": "Guard against null before accessing .id",
        "replacement_code": "if (user) { return user.id; }"
      }
    }
  ]
}
```

---

## Architecture

```
                       ┌──────────────────┐
                       │       CLI        │  bin/review.js
                       └────────┬─────────┘
                                │
                ┌───────────────┴───────────────┐
                ▼                               ▼
       ┌────────────────┐               ┌──────────────┐
       │ SourceProvider │               │  AIProvider  │
       │  (pluggable)   │               │ (pluggable)  │
       └────┬─────┬─────┘               └──────┬───────┘
            │     │                            │
   LocalGit │  GitHub │ AzureDevOps   OpenAI / AzureOpenAI
            │     │     │                      │
            ▼     ▼     ▼                      │
         ┌─────────────────┐                   │
         │  changes object │                   │
         │  (normalized)   │                   │
         └────────┬────────┘                   │
                  │                            │
                  ▼                            │
         ┌─────────────────┐    JSON-schema   │
         │ ReviewPipeline  │◄─────────────────┘
         │                 │
         │  Pass 1: per-file (parallel, cached)
         │  Pass 2: aggregate (summaries only)
         │  Post:   validate line numbers vs diff
         └────────┬────────┘
                  │
                  ▼
         ┌─────────────────────────┐
         │ Output writers          │
         │ html │ md │ json │ sarif│ console
         └─────────────────────────┘
```

**Why this shape:**

- **Source providers** normalize different platforms to a common `changes` object, so the pipeline doesn't care if you're on GitHub or your laptop.
- **AI providers** all emit the same JSON shape because we enforce a JSON schema at the API call — no markdown parsing.
- **Pass 1 is parallel**: each file is reviewed independently. The default concurrency of 4 keeps you well under any rate limit.
- **Pass 2 only sees summaries** from pass 1, not the full diffs. The original tool re-fed every diff and got *very* expensive on big PRs. This finds cross-file issues (a renamed function whose callsite wasn't updated, missing test changes, etc.) at a fraction of the cost.
- **Line-number validation** removes a class of failure where the model invents lines that don't exist in the diff.
- **Cache key** includes the model, system prompt, user prompt and schema name — change any of them and the cache is invalidated automatically.

---

## Programmatic API

```js
import {
  loadConfig,
  buildAIProviderFromConfig,
  ReviewPipeline,
  GitHubProvider,
  writeJsonReport,
} from 'ai-code-reviewer';

const cfg = loadConfig();
const ai = await buildAIProviderFromConfig(cfg);

const source = new GitHubProvider({
  token: process.env.GITHUB_TOKEN,
  owner: 'octocat',
  repo: 'hello-world',
  prNumber: 42,
});

const changes = await source.fetchChanges();
const pipeline = new ReviewPipeline({ aiProvider: ai });
const result = await pipeline.run(changes);

await writeJsonReport(result, 'review.json');
console.log(`Found ${result.stats.total} issues. Cost: $${result.cost.toFixed(4)}`);
```

---

## Customizing the prompt

The system prompt and per-file template live in [`src/core/prompt-builder.js`](./src/core/prompt-builder.js). They are deliberately short, with explicit anti-noise rules. Tune them for your codebase — for example, add team-specific conventions ("we use `Result<T, E>` for fallible functions, not exceptions") to the system prompt.

The schema in [`src/core/schema.js`](./src/core/schema.js) controls *what fields* the model returns. Modifying it will invalidate the cache (intentional).

---

## Testing

```bash
npm test
```

Tests cover the deterministic, non-AI bits — diff utilities, language detection, schema validation, cache key derivation. Provider integrations are mocked.

---

## Migration from v1

If you're coming from the original tool:

- The Azure DevOps source path is preserved. Set `AZDO_*` env vars and run `ai-review azure --pr <id>`.
- The old `config.js` is gone. Move settings into `ai-review.config.json` or use env vars.
- HTML output is now interactive and lives at `review-output/review.html` by default (was `combined-report.html`).
- Cost dropped substantially because we no longer review each file twice.

---

## License

MIT.
