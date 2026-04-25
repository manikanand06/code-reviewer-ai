/**
 * Map file extensions to language identifiers and review-time guidance.
 *
 * The original reviewer was language-agnostic except for a one-off "if SQL,
 * focus on injection" note in the prompt. That left a lot of value on the
 * table — Python has different footguns from Rust, JS has different concerns
 * from C#, etc. This module gives every prompt a tailored "things to look for
 * in $LANG" hint without bloating the base prompt.
 */

const EXT_TO_LANG = {
  // JS / TS
  '.js': 'javascript', '.jsx': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
  '.ts': 'typescript', '.tsx': 'typescript',
  // Python
  '.py': 'python', '.pyi': 'python',
  // JVM
  '.java': 'java', '.kt': 'kotlin', '.kts': 'kotlin', '.scala': 'scala', '.groovy': 'groovy',
  // .NET
  '.cs': 'csharp', '.vb': 'vbnet', '.fs': 'fsharp',
  // Native
  '.c': 'c', '.h': 'c', '.cc': 'cpp', '.cpp': 'cpp', '.cxx': 'cpp', '.hpp': 'cpp',
  '.rs': 'rust',
  '.go': 'go',
  // Web
  '.html': 'html', '.htm': 'html',
  '.css': 'css', '.scss': 'scss', '.sass': 'sass', '.less': 'less',
  '.vue': 'vue', '.svelte': 'svelte',
  // Mobile
  '.swift': 'swift', '.m': 'objc', '.mm': 'objc',
  '.dart': 'dart',
  // Scripting
  '.rb': 'ruby', '.php': 'php', '.pl': 'perl',
  '.sh': 'shell', '.bash': 'shell', '.zsh': 'shell', '.fish': 'shell',
  '.ps1': 'powershell',
  // Data / config
  '.sql': 'sql',
  '.json': 'json', '.yaml': 'yaml', '.yml': 'yaml', '.toml': 'toml', '.xml': 'xml',
  '.tf': 'terraform', '.hcl': 'hcl',
  '.dockerfile': 'dockerfile',
  // Functional
  '.hs': 'haskell', '.elm': 'elm', '.clj': 'clojure', '.ex': 'elixir', '.exs': 'elixir',
  // Other
  '.lua': 'lua',
  '.r': 'r', '.R': 'r',
  '.md': 'markdown', '.markdown': 'markdown',
};

const LANG_GUIDANCE = {
  javascript:
    '- Watch for: missing await on promises, == vs ===, mutating shared state, ' +
    'unsanitized DOM/innerHTML (XSS), prototype pollution, unbounded loops, ' +
    'leaked event listeners, race conditions on async state.',
  typescript:
    '- Watch for: `any`/`unknown` escapes that bypass type safety, non-null assertions on ' +
    'values that can actually be null, missing await, incorrect generic constraints, ' +
    'unsafe type assertions (`as Foo`), enum/union exhaustiveness gaps.',
  python:
    '- Watch for: mutable default arguments, missing context managers (file/socket leaks), ' +
    'broad `except:` swallowing real errors, off-by-one on slicing, integer/float coercion ' +
    'bugs, GIL/threading misuse, string formatting injection in SQL/shell, missing ' +
    '`__init__`/`super()` calls.',
  java:
    '- Watch for: NullPointerException risk on unchecked dereferences, raw types/unchecked ' +
    'casts, broken equals/hashCode contracts, Calendar/Date thread-unsafety, resource leaks ' +
    '(use try-with-resources), SQL string concatenation, unchecked exception swallowing.',
  kotlin:
    '- Watch for: `!!` non-null assertions, platform-type leaks from Java interop, blocking ' +
    'calls inside coroutines, `runBlocking` in production paths, scope leaks, missing ' +
    'CoroutineExceptionHandler.',
  csharp:
    '- Watch for: missing `await` on async tasks, `async void` outside event handlers, ' +
    'IDisposable not disposed (use `using`), SQL string concat (use parameters), ' +
    '`Result`/`Wait()` causing deadlocks, LINQ multiple enumeration of expensive sources.',
  go:
    '- Watch for: ignored errors, goroutine leaks, missing context cancellation, range-loop ' +
    'variable capture in closures (pre Go 1.22), nil-map writes, deadlocks on unbuffered ' +
    'channels, defer in loops accumulating.',
  rust:
    '- Watch for: `unwrap`/`expect` on values that can fail, `unsafe` blocks without invariant ' +
    'documentation, lifetimes that compile but encode bugs, panic-prone integer arithmetic ' +
    '(use checked_), Mutex held across `.await` in async.',
  cpp:
    '- Watch for: raw `new`/`delete` instead of smart pointers, dangling references, ' +
    'iterator invalidation, integer overflow, signed/unsigned mismatch, missing virtual ' +
    'destructors, copy-vs-move misuse, undefined behavior.',
  c:
    '- Watch for: buffer overflows, off-by-one in array indexing, missing free / double free, ' +
    'unchecked malloc return, integer overflow, format-string vulnerabilities, ' +
    'use-after-free, signed/unsigned comparison.',
  ruby:
    '- Watch for: monkey-patching collisions, mass-assignment without strong params, ' +
    'string interpolation in SQL, `eval`/`send` with user input, N+1 query patterns.',
  php:
    '- Watch for: SQL string interpolation (use prepared statements), `==` vs `===`, ' +
    'unsanitized superglobals to output (XSS) or filesystem (LFI), unserialize on user data.',
  sql:
    '- Watch for: dynamic SQL built by string concatenation (injection), missing indexes on ' +
    'new WHERE/JOIN columns, SELECT *, N+1 patterns, missing transactions on multi-step ' +
    'mutations, deadlock-prone lock ordering, schema migrations that lock large tables.',
  shell:
    '- Watch for: unquoted variables (`"$var"` not `$var`), missing `set -euo pipefail`, ' +
    'command injection via interpolation of user input, parsing `ls`, `rm -rf "$VAR/"` ' +
    'where VAR can be empty.',
  dockerfile:
    '- Watch for: running as root, `:latest` tags, `ADD` from URLs without checksums, ' +
    'secrets baked into layers, missing `--no-install-recommends`, single-stage builds ' +
    'shipping build tools.',
  yaml:
    '- Watch for: secrets committed in plain text, indentation bugs that change structure, ' +
    'overly broad permissions in CI/CD configs, untagged image references.',
  terraform:
    '- Watch for: hardcoded secrets, missing tags, public S3/storage buckets, overly broad ' +
    'IAM policies (`*` actions/resources), missing state locking, drift-prone resources.',
};

/** Get the language identifier for a file path. Returns null for unknown extensions. */
export function detectLanguage(filePath) {
  if (!filePath) return null;
  const lower = filePath.toLowerCase();
  // Special filenames
  if (lower.endsWith('/dockerfile') || lower === 'dockerfile') return 'dockerfile';
  if (lower.endsWith('/makefile') || lower === 'makefile') return 'makefile';
  // Extension
  const dotIdx = lower.lastIndexOf('.');
  if (dotIdx === -1) return null;
  const ext = lower.slice(dotIdx);
  return EXT_TO_LANG[ext] ?? null;
}

/** Get review guidance for a given language. Returns empty string if none. */
export function languageGuidance(lang) {
  if (!lang) return '';
  return LANG_GUIDANCE[lang] ?? '';
}

/**
 * Files we should not bother reviewing — they're either generated, lock files,
 * binaries, or noise. Saves tokens and avoids junk findings.
 */
export function isReviewable(filePath) {
  if (!filePath) return false;
  // Normalize to forward slashes and prefix a slash so that "dir/" patterns
  // match both "dir/file" (relative path) and "a/dir/file" (subpath). Without
  // this prefix, a relative path "dist/bundle.js" would not match "/dist/".
  const lower = '/' + filePath.toLowerCase().replace(/\\/g, '/');

  // Substring patterns that always indicate non-reviewable content.
  const skipSubstrings = [
    'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'composer.lock',
    'gemfile.lock', 'cargo.lock', 'poetry.lock', 'go.sum',
    '.min.js', '.min.css', '.bundle.js',
  ];
  if (skipSubstrings.some((p) => lower.includes(p))) return false;

  // Directory segments to skip — any path passing through them is generated.
  const skipDirs = [
    '/dist/', '/build/', '/.next/', '/node_modules/', '/vendor/',
    '/__pycache__/', '/.venv/', '/venv/', '/target/', '/out/',
  ];
  if (skipDirs.some((p) => lower.includes(p))) return false;
  // Binary / asset extensions
  const binExts = [
    '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.svg',
    '.pdf', '.zip', '.tar', '.gz', '.7z', '.rar',
    '.mp3', '.mp4', '.mov', '.wav', '.ogg',
    '.woff', '.woff2', '.ttf', '.eot', '.otf',
    '.exe', '.dll', '.so', '.dylib', '.class', '.jar',
  ];
  if (binExts.some((e) => lower.endsWith(e))) return false;
  return true;
}
