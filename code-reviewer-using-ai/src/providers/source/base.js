/**
 * Base interface for source providers.
 *
 * A "source" is anywhere we can pull a set of changed files + diffs from:
 * GitHub PR, Azure DevOps PR, GitLab MR, a local git working tree, etc.
 *
 * Implementations must produce a normalized shape so the reviewer doesn't
 * need to care where the diffs came from. This is what unlocks reviewing
 * a local working tree (`git diff main`) with the same engine that reviews
 * a GitHub PR.
 *
 * The expected return from `fetchChanges()` is:
 *   {
 *     id:           string  // identifier (PR number, branch name, "working-tree")
 *     title:        string
 *     description:  string
 *     url:          string | null
 *     baseRef:      string  // e.g. "main"
 *     headRef:      string  // e.g. "feature/foo"
 *     files: [
 *       {
 *         path:        string  // repository-relative path
 *         changeType:  'add' | 'modify' | 'delete' | 'rename'
 *         oldPath:     string | null  // for renames
 *         diff:        string         // unified diff with @@ headers
 *         newContent:  string | null  // optional, full new content
 *         oldContent:  string | null  // optional, full old content
 *       }
 *     ]
 *   }
 */
export class BaseSourceProvider {
  // eslint-disable-next-line no-unused-vars
  async fetchChanges() {
    throw new Error('fetchChanges must be implemented by subclass');
  }

  /**
   * Optional: post comments back to the source. Implementations that don't
   * support this (e.g. local git) should just no-op.
   *
   * @param {object} args
   * @param {string} args.body         Markdown summary body.
   * @param {Array}  args.inlineIssues Array of issues with file/line info.
   */
  // eslint-disable-next-line no-unused-vars
  async postReview({ body, inlineIssues }) {
    return { posted: false, reason: 'Provider does not support posting reviews' };
  }
}
