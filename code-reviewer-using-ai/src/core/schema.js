/**
 * JSON Schema for structured AI review output.
 *
 * Why this matters:
 * The original reviewer asked the model for free-form markdown like
 *   "**Lines X-Y**: brief description"
 * and then had to regex-match line numbers out of that text and fuzzy-match
 * them back to the diff (see the original `correctLineNumbersInFeedback`).
 * That approach is fragile, hallucination-prone, and impossible to filter or
 * aggregate.
 *
 * Instead, we make the model emit JSON that conforms to this schema. Every
 * issue has a deterministic shape we can sort, filter, badge, post as inline
 * PR comments, or feed into SARIF for GitHub Code Scanning.
 *
 * This is wired into OpenAI's `response_format: { type: "json_schema", ... }`,
 * which constrains the model to actually produce valid output instead of
 * "mostly the right shape, sometimes".
 */

export const SEVERITY = Object.freeze({
  CRITICAL: 'critical', // crashes, data loss, auth bypass, RCE, etc.
  HIGH: 'high',         // real bug, exploitable issue, broken feature
  MEDIUM: 'medium',     // likely bug, perf problem, maintainability hazard
  LOW: 'low',           // minor issue, code smell with real cost
  INFO: 'info',         // nitpick / style / suggestion
});

export const CATEGORY = Object.freeze({
  BUG: 'bug',
  SECURITY: 'security',
  PERFORMANCE: 'performance',
  CORRECTNESS: 'correctness',
  CONCURRENCY: 'concurrency',
  ERROR_HANDLING: 'error_handling',
  MAINTAINABILITY: 'maintainability',
  READABILITY: 'readability',
  TESTING: 'testing',
  DOCUMENTATION: 'documentation',
  STYLE: 'style',
});

export const SEVERITY_RANK = Object.freeze({
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
  info: 0,
});

/**
 * The schema we send to the model. Designed so the model emits exactly what we
 * need — no extra prose, no "let me explain my reasoning" preamble.
 */
export const REVIEW_SCHEMA = {
  name: 'code_review',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['summary', 'issues'],
    properties: {
      summary: {
        type: 'string',
        description:
          'One paragraph summary of WHAT changed in this diff and the overall review verdict. ' +
          'Do not list issues here — they go in the issues array.',
      },
      issues: {
        type: 'array',
        description:
          'List of distinct issues found ONLY in changed/added lines. Empty array if no real issues. ' +
          'Do not invent issues to fill space. Do not flag style unless it actually causes a bug.',
        items: {
          type: 'object',
          additionalProperties: false,
          required: [
            'title',
            'description',
            'severity',
            'category',
            'file',
            'line_start',
            'line_end',
            'confidence',
            'suggested_fix',
          ],
          properties: {
            title: {
              type: 'string',
              description: 'Short imperative title, like a good commit message. < 80 chars.',
            },
            description: {
              type: 'string',
              description:
                'What is wrong, why it matters, and what the consequence is. ' +
                'Be specific — reference the variable / function / SQL / etc. by name.',
            },
            severity: {
              type: 'string',
              enum: Object.values(SEVERITY),
              description:
                'critical = crash/data-loss/RCE; high = real bug or exploitable; medium = likely bug or perf hazard; ' +
                'low = minor issue with real cost; info = nitpick.',
            },
            category: {
              type: 'string',
              enum: Object.values(CATEGORY),
            },
            file: {
              type: 'string',
              description: 'Repository-relative path, exactly as given in the diff header.',
            },
            line_start: {
              type: 'integer',
              minimum: 1,
              description:
                'First line of the issue, using NEW-FILE line numbers (the right-hand side of the diff). ' +
                'Read the @@ -old,+new @@ hunk header — use the +new value.',
            },
            line_end: {
              type: 'integer',
              minimum: 1,
              description: 'Last line of the issue (inclusive). For a single-line issue, equal to line_start.',
            },
            confidence: {
              type: 'string',
              enum: ['high', 'medium', 'low'],
              description:
                'high = certain it is a real problem; medium = probably; low = worth checking but might be a false positive.',
            },
            suggested_fix: {
              type: 'object',
              additionalProperties: false,
              required: ['explanation', 'replacement_code'],
              properties: {
                explanation: {
                  type: 'string',
                  description: 'One sentence describing what the fix does.',
                },
                replacement_code: {
                  type: 'string',
                  description:
                    'The corrected code as it should appear, with no diff markers (no leading + / -). ' +
                    'Empty string if a code fix is not appropriate (e.g. the whole approach needs rethinking).',
                },
              },
            },
          },
        },
      },
    },
  },
};

/** Validate a parsed model response at runtime. Cheap belt-and-braces check. */
export function validateReview(obj) {
  if (!obj || typeof obj !== 'object') return 'Not an object';
  if (typeof obj.summary !== 'string') return 'summary must be a string';
  if (!Array.isArray(obj.issues)) return 'issues must be an array';
  for (const [i, issue] of obj.issues.entries()) {
    if (typeof issue.title !== 'string') return `issues[${i}].title invalid`;
    if (typeof issue.description !== 'string') return `issues[${i}].description invalid`;
    if (!Object.values(SEVERITY).includes(issue.severity)) return `issues[${i}].severity invalid`;
    if (!Object.values(CATEGORY).includes(issue.category)) return `issues[${i}].category invalid`;
    if (typeof issue.file !== 'string') return `issues[${i}].file invalid`;
    if (!Number.isInteger(issue.line_start) || issue.line_start < 1) return `issues[${i}].line_start invalid`;
    if (!Number.isInteger(issue.line_end) || issue.line_end < issue.line_start) return `issues[${i}].line_end invalid`;
    if (!['high', 'medium', 'low'].includes(issue.confidence)) return `issues[${i}].confidence invalid`;
    if (!issue.suggested_fix || typeof issue.suggested_fix !== 'object') return `issues[${i}].suggested_fix invalid`;
  }
  return null;
}
