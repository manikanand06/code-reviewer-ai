import chalk from 'chalk';

/**
 * Pretty CLI output for terminal use.
 *
 * Distinct from `Logger` (which handles status / progress logs). This module
 * formats the FINAL review result as colored text, suitable for piping to
 * less or showing inline in a terminal.
 */

const SEV_COLOR = {
  critical: chalk.bgRed.white.bold,
  high: chalk.red.bold,
  medium: chalk.yellow.bold,
  low: chalk.blue.bold,
  info: chalk.gray.bold,
};

const SEV_GLYPH = {
  critical: '🚨',
  high: '⚠️ ',
  medium: '🟡',
  low: '🔵',
  info: 'ℹ️ ',
};

export function printReportToConsole(result) {
  const out = process.stderr; // keep stdout clean for machine output

  const c = result.changes;
  out.write('\n');
  out.write(chalk.bold.underline(`AI Code Review`) + ' — ' + chalk.cyan(c.title || c.id) + '\n');
  if (c.url) out.write(chalk.dim(c.url) + '\n');
  out.write(chalk.dim(`${c.headRef} → ${c.baseRef} · ${result.stats.filesReviewed} files · ${result.usage.total.toLocaleString()} tokens`));
  if (result.cost) out.write(chalk.dim(` · est. $${result.cost.toFixed(4)}`));
  out.write('\n\n');

  // Summary bar
  const s = result.stats;
  const bar = [
    s.critical ? SEV_COLOR.critical(` ${s.critical} critical `) : chalk.gray(' 0 critical '),
    s.high ? SEV_COLOR.high(`${s.high} high`) : chalk.gray('0 high'),
    s.medium ? SEV_COLOR.medium(`${s.medium} med`) : chalk.gray('0 med'),
    s.low ? SEV_COLOR.low(`${s.low} low`) : chalk.gray('0 low'),
    s.info ? SEV_COLOR.info(`${s.info} info`) : chalk.gray('0 info'),
  ].join(chalk.dim(' · '));
  out.write(bar + '\n\n');

  if (result.aggregateReview?.summary) {
    out.write(chalk.bold('Verdict: '));
    out.write(result.aggregateReview.summary + '\n\n');
  }

  if (result.issues.length === 0) {
    out.write(chalk.green('✓ No issues found.\n\n'));
    return;
  }

  // Group by file
  const byFile = new Map();
  for (const i of result.issues) {
    if (!byFile.has(i.file)) byFile.set(i.file, []);
    byFile.get(i.file).push(i);
  }

  for (const [file, items] of byFile) {
    out.write(chalk.bold.underline(file) + '\n');
    for (const i of items) {
      const colorize = SEV_COLOR[i.severity] ?? chalk.white;
      const lineRef = i.line_end !== i.line_start ? `${i.line_start}-${i.line_end}` : `${i.line_start}`;
      out.write(`  ${SEV_GLYPH[i.severity] ?? '•'} ${colorize(i.severity.toUpperCase())} ` +
        chalk.dim(`[${i.category}]`) + ` ${chalk.bold(i.title)} ` +
        chalk.dim(`(${file.split('/').pop()}:${lineRef}, conf:${i.confidence})`) + '\n');
      out.write('     ' + i.description.replace(/\n/g, '\n     ') + '\n');
      if (i.suggested_fix?.replacement_code) {
        out.write(chalk.dim('     fix: ') + i.suggested_fix.explanation + '\n');
        const codeLines = i.suggested_fix.replacement_code.split('\n');
        for (const cl of codeLines) {
          out.write(chalk.dim('       │ ') + chalk.cyan(cl) + '\n');
        }
      }
      out.write('\n');
    }
  }

  out.write(chalk.dim(`(${result.issues.length} issue${result.issues.length === 1 ? '' : 's'} total)\n\n`));
}
