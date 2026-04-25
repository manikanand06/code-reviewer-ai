import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

/**
 * SARIF 2.1.0 output.
 *
 * Why: SARIF is the standard format for static-analysis findings. Upload it
 * to GitHub Code Scanning (`github/codeql-action/upload-sarif`) and your
 * findings appear inline on the PR's "Files changed" tab and in the Security
 * tab — no PAT, no posting comments, no maintenance. Same for many other
 * platforms.
 *
 * The original tool had no machine-readable output at all.
 */
export async function writeSarifReport(result, outPath) {
  const sarif = buildSarif(result);
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify(sarif, null, 2), 'utf8');
  return outPath;
}

function severityToSarifLevel(sev) {
  // SARIF levels: none | note | warning | error
  return { critical: 'error', high: 'error', medium: 'warning', low: 'note', info: 'note' }[sev] ?? 'warning';
}

function buildSarif(result) {
  // Build a unique rule per category — keeps GitHub UI groupings sensible.
  const ruleIds = new Set();
  for (const i of result.issues) ruleIds.add(`ai-review/${i.category}`);

  const rules = Array.from(ruleIds).map((id) => ({
    id,
    name: id.split('/')[1],
    shortDescription: { text: `AI-detected ${id.split('/')[1].replace('_', ' ')} issue` },
    fullDescription: {
      text: `Issues in this category were flagged by the AI reviewer. Each issue includes a severity, confidence, and (where possible) a suggested fix.`,
    },
    helpUri: 'https://github.com/your-org/ai-code-reviewer',
    defaultConfiguration: { level: 'warning' },
  }));

  const results = result.issues.map((i) => {
    const fix =
      i.suggested_fix?.replacement_code
        ? {
            description: { text: i.suggested_fix.explanation || 'Apply suggested fix' },
            artifactChanges: [
              {
                artifactLocation: { uri: i.file },
                replacements: [
                  {
                    deletedRegion: { startLine: i.line_start, endLine: i.line_end },
                    insertedContent: { text: i.suggested_fix.replacement_code },
                  },
                ],
              },
            ],
          }
        : undefined;

    return {
      ruleId: `ai-review/${i.category}`,
      level: severityToSarifLevel(i.severity),
      message: { text: `${i.title}\n\n${i.description}` },
      locations: [
        {
          physicalLocation: {
            artifactLocation: { uri: i.file },
            region: {
              startLine: i.line_start,
              endLine: i.line_end,
            },
          },
        },
      ],
      properties: {
        severity: i.severity,
        category: i.category,
        confidence: i.confidence,
      },
      ...(fix ? { fixes: [fix] } : {}),
    };
  });

  return {
    $schema: 'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'ai-code-reviewer',
            version: '2.0.0',
            semanticVersion: '2.0.0',
            informationUri: 'https://github.com/your-org/ai-code-reviewer',
            rules,
          },
        },
        results,
        invocations: [
          {
            executionSuccessful: true,
            endTimeUtc: result.generatedAt,
            properties: {
              model: result.model,
              tokens: result.usage.total,
              cost_usd: result.cost,
            },
          },
        ],
      },
    ],
  };
}
