import { Octokit } from '@octokit/rest';
import { BaseSourceProvider } from './base.js';

/**
 * GitHub Pull Request source provider.
 *
 * GitHub gives us unified diffs straight from the API (with --3way style headers
 * already including @@ hunks), so we don't need to construct them like the
 * Azure DevOps path does. We just normalize the API shape into our common
 * format.
 *
 * Implements `postReview()` to submit a review with inline comments back to
 * the PR — a feature the original tool didn't have at all.
 */
export class GitHubProvider extends BaseSourceProvider {
  constructor({ token, owner, repo, prNumber }) {
    super();
    if (!token) throw new Error('GitHub token is required');
    if (!owner || !repo) throw new Error('GitHub owner and repo are required');
    if (!prNumber) throw new Error('GitHub PR number is required');
    this.octokit = new Octokit({ auth: token });
    this.owner = owner;
    this.repo = repo;
    this.prNumber = prNumber;
  }

  async fetchChanges() {
    const { data: pr } = await this.octokit.pulls.get({
      owner: this.owner,
      repo: this.repo,
      pull_number: this.prNumber,
    });

    // Paginate file list — large PRs can have hundreds of files.
    const files = await this.octokit.paginate(this.octokit.pulls.listFiles, {
      owner: this.owner,
      repo: this.repo,
      pull_number: this.prNumber,
      per_page: 100,
    });

    const normalizedFiles = await Promise.all(
      files.map(async (f) => {
        // GitHub's `patch` is a unified diff for that file (without the file header).
        // We add a synthetic file header so the model sees the path consistently.
        const diff = f.patch ? `--- a/${f.previous_filename ?? f.filename}\n+++ b/${f.filename}\n${f.patch}` : '';

        // For added or small-modified files, fetch full content for richer context.
        let newContent = null;
        if (f.status !== 'removed' && (f.status === 'added' || f.changes < 200)) {
          try {
            const { data } = await this.octokit.repos.getContent({
              owner: this.owner,
              repo: this.repo,
              path: f.filename,
              ref: pr.head.sha,
            });
            if (data.content) {
              newContent = Buffer.from(data.content, 'base64').toString('utf8');
            }
          } catch {
            // File might be too large or binary — skip.
          }
        }

        return {
          path: f.filename,
          changeType: this._mapStatus(f.status),
          oldPath: f.previous_filename ?? null,
          diff,
          newContent,
          oldContent: null, // Skipping old content fetch — diff is usually enough on GH.
        };
      })
    );

    return {
      id: String(this.prNumber),
      title: pr.title,
      description: pr.body ?? '',
      url: pr.html_url,
      baseRef: pr.base.ref,
      headRef: pr.head.ref,
      files: normalizedFiles,
      _meta: { headSha: pr.head.sha },
    };
  }

  _mapStatus(status) {
    switch (status) {
      case 'added': return 'add';
      case 'removed': return 'delete';
      case 'renamed': return 'rename';
      case 'modified':
      case 'changed':
      default:
        return 'modify';
    }
  }

  /**
   * Post a review with inline comments. Inline comments require a commit SHA
   * and a position within the diff hunk; we pass the PR head SHA and use the
   * `line` parameter (much more forgiving than position-in-diff which the
   * original API requires).
   */
  async postReview({ body, inlineIssues, headSha }) {
    if (!headSha) {
      throw new Error('GitHub postReview requires headSha (pass changes._meta.headSha)');
    }

    const comments = inlineIssues
      .filter((i) => i.file && i.line_start)
      .map((i) => ({
        path: i.file,
        line: i.line_end ?? i.line_start,
        side: 'RIGHT',
        body: this._formatIssueComment(i),
      }));

    try {
      const { data } = await this.octokit.pulls.createReview({
        owner: this.owner,
        repo: this.repo,
        pull_number: this.prNumber,
        commit_id: headSha,
        body,
        event: 'COMMENT', // Use COMMENT not REQUEST_CHANGES — the AI is advisory.
        comments,
      });
      return { posted: true, reviewId: data.id, url: data.html_url };
    } catch (err) {
      // Inline-comment validation can fail on lines outside the diff. Fall back
      // to a body-only review so we at least post the summary.
      try {
        const { data } = await this.octokit.pulls.createReview({
          owner: this.owner,
          repo: this.repo,
          pull_number: this.prNumber,
          commit_id: headSha,
          body: body + '\n\n_(Inline comments could not be posted: ' + err.message + ')_',
          event: 'COMMENT',
        });
        return { posted: true, reviewId: data.id, url: data.html_url, fallback: true };
      } catch (err2) {
        return { posted: false, reason: err2.message };
      }
    }
  }

  _formatIssueComment(i) {
    const sevEmoji = {
      critical: '🚨', high: '⚠️', medium: '🟡', low: '🔵', info: 'ℹ️',
    }[i.severity] ?? '⚠️';
    let body = `${sevEmoji} **${i.severity.toUpperCase()} / ${i.category}** — ${i.title}\n\n${i.description}`;
    if (i.suggested_fix?.replacement_code) {
      body += `\n\n**Suggested fix:** ${i.suggested_fix.explanation}\n\n\`\`\`suggestion\n${i.suggested_fix.replacement_code}\n\`\`\``;
    }
    body += `\n\n_Confidence: ${i.confidence}_`;
    return body;
  }
}
