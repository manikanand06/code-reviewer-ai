import azdev from 'azure-devops-node-api';
import { diffLines } from 'diff';
import { BaseSourceProvider } from './base.js';

/**
 * Azure DevOps PR source provider.
 *
 * This preserves backward compatibility with the original tool's primary
 * use case while normalizing into our common shape.
 *
 * Key fixes from the original (util/get-file-difference.js):
 *   - Fewer redundant API calls.
 *   - Diff is built once, with proper @@ headers.
 *   - Whitespace-only changes are still ignored (matches original `unified-diff.js`).
 *   - We handle Add/Edit/Delete/Rename consistently.
 */
const FileChangeType = {
  Add: 1,
  Edit: 2,
  Delete: 16,
  Rename: 8,
  RenameEdit: 10,
};

export class AzureDevOpsProvider extends BaseSourceProvider {
  constructor({ orgUrl, project, repo, prId, pat }) {
    super();
    if (!orgUrl || !project || !repo || !prId || !pat) {
      throw new Error('Azure DevOps requires: orgUrl, project, repo, prId, pat');
    }
    this.orgUrl = orgUrl;
    this.project = project;
    this.repo = repo;
    this.prId = prId;
    this.pat = pat;
  }

  async _connect() {
    if (this.gitApi) return;
    const auth = azdev.getPersonalAccessTokenHandler(this.pat);
    const conn = new azdev.WebApi(this.orgUrl, auth);
    this.gitApi = await conn.getGitApi();
    this.pr = await this.gitApi.getPullRequest(this.repo, this.prId, this.project);
  }

  async _readFile(filePath, branchName) {
    if (!filePath || !branchName) return '';
    try {
      const versionDescriptor = {
        version: branchName.replace('refs/heads/', ''),
        versionType: 0, // Branch
      };
      const item = await this.gitApi.getItem(
        this.pr.repository.id,
        filePath,
        this.project,
        null, null, true, false, false,
        versionDescriptor,
        true, false, false
      );
      if (item?.content) return item.content;
      if (item?.objectId) {
        const stream = await this.gitApi.getBlobContent(this.pr.repository.id, item.objectId);
        return await streamToString(stream);
      }
      return '';
    } catch {
      return '';
    }
  }

  /** Build a unified diff between two strings, ignoring whitespace-only changes. */
  _unifiedDiff(oldContent, newContent, filePath) {
    let out = `--- a/${filePath}\n+++ b/${filePath}\n`;
    const parts = diffLines(oldContent || '', newContent || '', { ignoreWhitespace: true });

    // Build hunks with proper @@ headers and ~5 lines of context per hunk.
    // Walk line by line tracking old/new line numbers; group changes into hunks.
    const oldLines = (oldContent || '').split('\n');
    const newLines = (newContent || '').split('\n');

    let oldNum = 1;
    let newNum = 1;
    const hunks = [];
    let currentHunk = null;
    const ctxLines = 5;

    // Replay parts as a stream of "kept", "removed", "added" lines with line numbers.
    // We emit hunks whenever we encounter a change, with up to `ctxLines` of context.
    const events = [];
    for (const part of parts) {
      const partLines = part.value.split('\n');
      // diff library splits trailing newline as an empty string — filter it.
      const lines = partLines[partLines.length - 1] === '' ? partLines.slice(0, -1) : partLines;
      for (const line of lines) {
        if (part.added) {
          events.push({ kind: '+', line, oldNum: null, newNum });
          newNum += 1;
        } else if (part.removed) {
          events.push({ kind: '-', line, oldNum, newNum: null });
          oldNum += 1;
        } else {
          events.push({ kind: ' ', line, oldNum, newNum });
          oldNum += 1;
          newNum += 1;
        }
      }
    }

    // Walk events and build hunks: each hunk is a contiguous run of changes,
    // padded with up to ctxLines of " " context on each side.
    for (let i = 0; i < events.length; i += 1) {
      const e = events[i];
      if (e.kind === ' ') continue;
      // Start a new hunk
      const start = Math.max(0, i - ctxLines);
      let end = i;
      // Extend end through subsequent changes plus trailing context
      let j = i;
      while (j < events.length) {
        if (events[j].kind !== ' ') {
          end = j;
          j += 1;
        } else {
          // Look ahead — if there's another change within ctxLines*2, keep extending
          let nextChange = -1;
          for (let k = j; k < Math.min(events.length, j + ctxLines * 2); k += 1) {
            if (events[k].kind !== ' ') { nextChange = k; break; }
          }
          if (nextChange === -1) break;
          j = nextChange;
        }
      }
      const tail = Math.min(events.length - 1, end + ctxLines);

      const hunkEvents = events.slice(start, tail + 1);
      const oldStart = hunkEvents.find((x) => x.oldNum)?.oldNum ?? 1;
      const newStart = hunkEvents.find((x) => x.newNum)?.newNum ?? 1;
      const oldCount = hunkEvents.filter((x) => x.kind !== '+').length;
      const newCount = hunkEvents.filter((x) => x.kind !== '-').length;

      hunks.push({
        header: `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`,
        body: hunkEvents.map((x) => `${x.kind}${x.line}`).join('\n'),
      });

      i = tail; // skip past consumed events
    }

    if (hunks.length === 0) return '';
    out += hunks.map((h) => `${h.header}\n${h.body}`).join('\n') + '\n';
    return out;
  }

  _mapChangeType(code) {
    switch (code) {
      case FileChangeType.Add: return 'add';
      case FileChangeType.Edit: return 'modify';
      case FileChangeType.Delete: return 'delete';
      case FileChangeType.Rename: return 'rename';
      case FileChangeType.RenameEdit: return 'rename';
      default: return 'modify';
    }
  }

  async fetchChanges() {
    await this._connect();

    const iterations = await this.gitApi.getPullRequestIterations(
      this.pr.repository.id, this.prId, this.project
    );
    const latest = iterations[iterations.length - 1];
    const iterChanges = await this.gitApi.getPullRequestIterationChanges(
      this.pr.repository.id, this.prId, latest.id, this.project
    );

    const files = [];
    for (const change of iterChanges.changeEntries) {
      if (change.item.isFolder) continue;
      const changeType = this._mapChangeType(change.changeType);
      if (changeType === 'delete') {
        // Match original behavior: skip deletes.
        continue;
      }
      const path = change.item.path;
      const oldPath = change.originalPath ?? null;

      let newContent = '';
      let oldContent = '';
      if (changeType === 'add') {
        newContent = await this._readFile(path, this.pr.sourceRefName);
      } else {
        newContent = await this._readFile(path, this.pr.sourceRefName);
        oldContent = await this._readFile(oldPath ?? path, this.pr.targetRefName);
      }

      let diff;
      if (changeType === 'add') {
        diff = `--- /dev/null\n+++ b/${path}\n@@ -0,0 +1,${(newContent.match(/\n/g)?.length ?? 0) + 1} @@\n` +
          newContent.split('\n').map((l) => `+${l}`).join('\n') + '\n';
      } else {
        diff = this._unifiedDiff(oldContent, newContent, path);
      }

      files.push({
        path,
        changeType,
        oldPath,
        diff,
        newContent,
        oldContent: oldContent || null,
      });
    }

    return {
      id: String(this.prId),
      title: this.pr.title ?? '',
      description: this.pr.description ?? '',
      url: `${this.orgUrl}/${this.project}/_git/${this.repo}/pullrequest/${this.prId}`,
      baseRef: this.pr.targetRefName,
      headRef: this.pr.sourceRefName,
      files,
    };
  }

  async postReview({ body, inlineIssues }) {
    await this._connect();
    try {
      // Post overall summary as a PR thread comment.
      await this.gitApi.createThread(
        {
          comments: [{ parentCommentId: 0, content: body, commentType: 1 }],
          status: 1, // active
        },
        this.pr.repository.id,
        this.prId,
        this.project
      );

      // Post inline comments per issue.
      for (const i of inlineIssues) {
        if (!i.file || !i.line_start) continue;
        const filePath = i.file.startsWith('/') ? i.file : `/${i.file}`;
        await this.gitApi.createThread(
          {
            comments: [
              {
                parentCommentId: 0,
                content: this._formatIssueBody(i),
                commentType: 1,
              },
            ],
            status: 1,
            threadContext: {
              filePath,
              rightFileStart: { line: i.line_start, offset: 1 },
              rightFileEnd: { line: i.line_end ?? i.line_start, offset: 1 },
            },
          },
          this.pr.repository.id,
          this.prId,
          this.project
        );
      }
      return { posted: true };
    } catch (err) {
      return { posted: false, reason: err.message };
    }
  }

  _formatIssueBody(i) {
    let body = `**[${i.severity.toUpperCase()} / ${i.category}] ${i.title}**\n\n${i.description}`;
    if (i.suggested_fix?.replacement_code) {
      body += `\n\n**Suggested fix:** ${i.suggested_fix.explanation}\n\n\`\`\`\n${i.suggested_fix.replacement_code}\n\`\`\``;
    }
    body += `\n\n_Confidence: ${i.confidence}_`;
    return body;
  }
}

function streamToString(stream) {
  return new Promise((resolve, reject) => {
    if (!stream) return resolve('');
    const chunks = [];
    stream.on('data', (c) => chunks.push(c.toString()));
    stream.on('end', () => resolve(chunks.join('')));
    stream.on('error', reject);
  });
}
