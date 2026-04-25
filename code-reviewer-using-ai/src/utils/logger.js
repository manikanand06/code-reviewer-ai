import chalk from 'chalk';

/**
 * Simple structured logger. Supports a `quiet` mode for CI use, and emits
 * to stderr so stdout can be reserved for machine output (JSON / SARIF).
 */
export class Logger {
  constructor({ quiet = false, verbose = false } = {}) {
    this.quiet = quiet;
    this.verbose = verbose;
  }

  _write(stream, msg) {
    stream.write(msg + '\n');
  }

  info(msg) {
    if (this.quiet) return;
    this._write(process.stderr, chalk.cyan('ℹ ') + msg);
  }

  success(msg) {
    if (this.quiet) return;
    this._write(process.stderr, chalk.green('✓ ') + msg);
  }

  warn(msg) {
    this._write(process.stderr, chalk.yellow('⚠ ') + msg);
  }

  error(msg) {
    this._write(process.stderr, chalk.red('✗ ') + msg);
  }

  debug(msg) {
    if (!this.verbose) return;
    this._write(process.stderr, chalk.dim('· ' + msg));
  }

  /** Print to stdout — for machine output, never decorated. */
  raw(msg) {
    process.stdout.write(msg);
  }
}
