import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { BaseSourceProvider } from './base.js';

const execFileAsync = promisify(execFile);

/**
 * Local-git source provider. Reviews uncommitted, staged, or branch-relative
 * changes in a local working tree.
 *
 * This is the killer feature missing from the original:
 *   - Review your changes BEFORE you push, instead of waiting for CI.
 *   - No PAT / API tokens needed for the source side.
 *   - Works against any local clone of any repo.
 *
 * Modes (mutually exclusive):
 *   { base: 'main' }         → diff working tree against main (default)
 *   { staged: true }         → only what `git add` has prepared (`git diff --cached`)
 *   { unstaged: true }       → only modified-but-not-staged
 *   { commitRange: 'a..b' }  → diff between two commits/refs
 */
export class LocalGitProvider extends BaseSourceProvider {
  constructor({ repoPath = process.cwd(), base = null, staged = false, unstaged = false, commitRange = null } = {}) {
    super();
    this.repoPath = path.resolve(repoPath);
    // Pick exactly one mode. Validation in `_diffArgs`.
    this.mode = { base, staged, unstaged, commitRange };
  }

  async _git(args) {
    try {
      const { stdout } = await execFileAsync('git', args, {
        cwd: this.repoPath,
        maxBuffer: 50 * 1024 * 1024, // 50 MB — enough for huge diffs
      });
      return stdout;
    } catch (err) {
      // git exits 1 when there are changes for some commands; that's not an error.
      // It only counts as a failure if there's stderr or no stdout.
      if (err.stdout != null) return err.stdout;
      throw new Error(`git ${args.join(' ')} failed: ${err.stderr || err.message}`);
    }
  }

  /** Build the args for the diff command based on the configured mode. */
  _diffArgs(extra = []) {
    const { base, staged, unstaged, commitRange } = this.mode;
    const modesSet = [base, staged, unstaged, commitRange].filter(Boolean).length;
    if (modesSet === 0) {
      // Default: working tree vs HEAD.
      return ['diff', 'HEAD', ...extra];
    }
    if (modesSet > 1) {
      throw new Error('LocalGitProvider: choose exactly one of { base, staged, unstaged, commitRange }');
    }
    if (staged) return ['diff', '--cached', ...extra];
    if (unstaged) return ['diff', ...extra];
    if (commitRange) return ['diff', commitRange, ...extra];
    return ['diff', base, ...extra];
  }

  /** Map git's --name-status code to our normalized changeType. */
  _normalizeChangeType(code) {
    if (!code) return 'modify';
    const c = code[0];
    if (c === 'A') return 'add';
    if (c === 'D') return 'delete';
    if (c === 'R') return 'rename';
    if (c === 'M') return 'modify';
    return 'modify';
  }

  /** Read file content at a given ref, or from working tree if ref is null. */
  async _readContent(filePath, ref) {
    try {
      if (ref == null) {
        return await readFile(path.join(this.repoPath, filePath), 'utf8');
      }
      return await this._git(['show', `${ref}:${filePath}`]);
    } catch {
      return null;
    }
  }

  /** Resolve the "new" ref for reading current file content based on mode. */
  _newRef() {
    const { commitRange } = this.mode;
    if (commitRange) {
      // commitRange is like "a..b" — read from b
      const m = commitRange.match(/^(.+?)\.\.\.?(.+)$/);
      return m ? m[2] : null;
    }
    return null; // working tree
  }

  /** Resolve the "old" ref for reading prior file content based on mode. */
  _oldRef() {
    const { base, staged, unstaged, commitRange } = this.mode;
    if (commitRange) {
      const m = commitRange.match(/^(.+?)\.\.\.?(.+)$/);
      return m ? m[1] : 'HEAD';
    }
    if (staged) return 'HEAD';
    if (unstaged) return null; // diff vs index, but we'll read HEAD as a reasonable approx
    if (base) return base;
    return 'HEAD';
  }

  async fetchChanges() {
    // 1. List changed files with status.
    const nameStatus = await this._git(this._diffArgs(['--name-status']));
    const files = [];
    for (const line of nameStatus.split('\n')) {
      if (!line.trim()) continue;
      const parts = line.split('\t');
      const code = parts[0];
      let path1, path2;
      if (code.startsWith('R') || code.startsWith('C')) {
        path1 = parts[1];
        path2 = parts[2];
      } else {
        path1 = parts[1];
      }
      const changeType = this._normalizeChangeType(code);
      const filePath = path2 ?? path1;
      const oldPath = path2 ? path1 : null;

      // 2. Get unified diff for this specific file (with 5 lines of context).
      const diff = await this._git(this._diffArgs(['-U5', '--', filePath]));

      // 3. Optionally fetch full file contents for richer review context.
      const newContent = changeType === 'delete' ? null : await this._readContent(filePath, this._newRef());
      const oldContent = changeType === 'add' ? null : await this._readContent(oldPath ?? filePath, this._oldRef());

      files.push({
        path: filePath,
        changeType,
        oldPath,
        diff,
        newContent,
        oldContent,
      });
    }

    // 4. Build identifiers for the report.
    let id, title, description;
    const { base, staged, unstaged, commitRange } = this.mode;
    if (commitRange) {
      id = commitRange;
      title = `Local diff: ${commitRange}`;
    } else if (staged) {
      id = 'staged';
      title = 'Local staged changes';
    } else if (unstaged) {
      id = 'unstaged';
      title = 'Local unstaged changes';
    } else if (base) {
      id = `working-tree-vs-${base}`;
      title = `Working tree vs ${base}`;
    } else {
      id = 'working-tree';
      title = 'Working tree vs HEAD';
    }
    const branch = (await this._git(['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
    description = `Repo: ${this.repoPath}\nBranch: ${branch}`;

    return {
      id,
      title,
      description,
      url: null,
      baseRef: base ?? 'HEAD',
      headRef: branch,
      files,
    };
  }
}
