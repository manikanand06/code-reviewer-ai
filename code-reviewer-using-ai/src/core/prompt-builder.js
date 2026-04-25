import { detectLanguage, languageGuidance } from './language.js';

/**
 * Prompt construction.
 *
 * Improvements over the original prompt:
 *   1. SYSTEM prompt establishes a precise reviewer persona with anti-noise
 *      principles ("don't invent issues to fill space"). The original used a
 *      single user prompt with no persona, which encouraged the model to
 *      generate something for every input even when nothing was wrong.
 *   2. Language-specific guidance is injected per file ("watch for X in Python").
 *   3. Output is JSON via a JSON schema (see schema.js), not regex-parsable
 *      markdown.
 *   4. Includes the file path explicitly so the model can use it in `file`.
 *   5. Notes the rule about NEW-side line numbers from @@ headers (the original's
 *      single biggest source of wrong line numbers).
 *   6. Single canonical prompt for both per-file and aggregate passes — no more
 *      maintaining two prompts that drift apart.
 */

const SYSTEM_PROMPT = `You are a precise, senior software engineer performing a code review.

PRINCIPLES:
- High signal, low noise. Only report issues that, if shipped, would cause real problems for users, operators, or future maintainers. Do not invent issues to fill space.
- A clean diff is a valid output. If the change looks correct and idiomatic, return an empty issues array and a one-line summary. Reviewers who flag everything teach engineers to ignore reviews.
- Comment ONLY on lines that are added or modified in the diff (lines prefixed with + and surrounding context to understand them). Do NOT critique unchanged context lines.
- Be specific. Reference variables, functions, SQL statements, etc. by name. "This could fail" is not useful; "userId is read from req.query without validation, causing the SQL on line 42 to be a string-injection vector" is.
- Distinguish severity honestly:
    * critical = data loss, auth bypass, RCE, crash on common input, security CVE-grade.
    * high    = a real bug or exploitable issue, even if narrow in scope.
    * medium  = likely bug, performance hazard at scale, maintainability landmine.
    * low     = real but minor issue with a clear cost.
    * info    = style/nitpick. Use sparingly — most "info" findings are noise.
- Confidence: use "low" for anything where you're guessing about runtime behavior you can't see. False-positive low-confidence findings are still worse than not reporting at all — when in doubt, don't.

LINE NUMBERS:
- Use NEW-FILE line numbers (the +N value from "@@ -O,o +N,n @@" hunk headers).
- For an issue spanning multiple lines, set line_start to the first affected line and line_end to the last (inclusive).
- For added files, line numbers start at 1 and increment normally.

FIXES:
- "suggested_fix.replacement_code" should be the corrected code as it should appear in the file. No leading + / -. No diff syntax. Match the file's existing language and style.
- If a fix isn't easily expressible as a code snippet (e.g. "rethink this whole approach"), set replacement_code to "" and explain in the description.

OUTPUT:
- Emit JSON conforming to the provided schema. No prose outside the JSON.
- The "summary" field is one paragraph describing what the diff does and your overall verdict — NOT a list of issues. Issues belong in "issues".`;

/**
 * Build a per-file review prompt.
 *
 * @param {object} args
 * @param {string} args.filePath
 * @param {string} args.diff       Unified diff with @@ headers.
 * @param {string=} args.fullFile  Optional: full new-file content, useful when
 *                                 the diff is most of the file or for added files.
 * @param {object=} args.focus     Optional: { categories?: string[] }
 */
export function buildFileReviewPrompt({ filePath, diff, fullFile = null, focus = null }) {
  const lang = detectLanguage(filePath);
  const guidance = languageGuidance(lang);

  const focusSection =
    focus && focus.categories && focus.categories.length > 0
      ? `\nFOCUS: For this review, only report issues in these categories: ${focus.categories.join(', ')}. Ignore everything else.\n`
      : '';

  const langHeader = lang
    ? `Language: ${lang}\n${guidance ? guidance + '\n' : ''}`
    : '';

  const fullFileSection = fullFile
    ? `\nFull current file content (for context):\n\`\`\`${lang ?? ''}\n${fullFile}\n\`\`\`\n`
    : '';

  return [
    `Review the following diff for file: ${filePath}`,
    '',
    langHeader,
    focusSection,
    'Diff:',
    '```diff',
    diff.trim(),
    '```',
    fullFileSection,
    '',
    'Return your review as JSON matching the schema.',
  ]
    .filter((s) => s !== '')
    .join('\n');
}

/**
 * Build a cross-file/architectural review prompt.
 *
 * Replaces the original "send-the-whole-thing-again" approach. Instead of
 * re-feeding every diff (expensive, redundant with per-file pass), we feed
 * the model a *summary of per-file findings* plus short headers showing what
 * changed in each file. This lets it spot:
 *   - cross-file inconsistencies (renamed in one file, not in another)
 *   - missing test updates
 *   - breaking API changes that callers don't account for
 *   - architectural drift
 */
export function buildAggregatePrompt({ fileResults, prTitle, prDescription }) {
  const fileSummaries = fileResults
    .map((r) => {
      const issuesPreview = (r.review.issues || [])
        .slice(0, 5)
        .map((i) => `    - [${i.severity}/${i.category}] L${i.line_start}: ${i.title}`)
        .join('\n');
      return `- ${r.filePath}\n    summary: ${r.review.summary}\n${issuesPreview}`;
    })
    .join('\n\n');

  const prHeader =
    (prTitle ? `PR title: ${prTitle}\n` : '') +
    (prDescription ? `PR description:\n${prDescription}\n\n` : '');

  return [
    prHeader,
    'Per-file review summaries from the first pass:',
    '',
    fileSummaries,
    '',
    'Now perform a CROSS-FILE pass. Look for issues that only appear when considering files together:',
    '- Functions renamed/signature-changed in one file but called the old way in another.',
    '- Missing test updates for changed behavior.',
    '- Breaking API changes without consumer updates.',
    '- Inconsistent error handling between layers.',
    '- Logical contradictions between files (e.g. validation rules that disagree).',
    '- Configuration / migration steps the diff implies but does not include.',
    '',
    'Do NOT repeat issues already found in the per-file pass — those are tracked separately. Only report NEW cross-file issues. If there are none, return an empty issues array.',
    '',
    'Return JSON matching the schema. The "file" field on each issue should be one of the changed files where the cross-file issue is most actionable.',
  ].join('\n');
}

export { SYSTEM_PROMPT };
