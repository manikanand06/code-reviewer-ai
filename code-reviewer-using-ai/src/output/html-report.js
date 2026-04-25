import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

/**
 * Self-contained interactive HTML report.
 *
 * The original report was a static markdown-to-HTML conversion. This one is
 * a single-file interactive app with:
 *   - severity & category chips that filter the visible issues
 *   - file sidebar with issue counts
 *   - per-issue cards with diff context, fix preview, and "copy fix" button
 *   - keyboard navigation
 *   - dark-mode toggle that respects prefers-color-scheme
 *   - everything embedded — no external CSS/JS, no CDN dependency
 *
 * The data is serialized as JSON inside a <script type="application/json">
 * tag and rendered client-side by ~250 lines of vanilla JS.
 */
export async function writeHtmlReport(result, outPath) {
  const html = renderReport(result);
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, html, 'utf8');
  return outPath;
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderReport(result) {
  // We pass the data as JSON — escape </script> defensively to prevent breakouts.
  const dataJson = JSON.stringify(result, null, 0).replace(/<\/script>/gi, '<\\/script>');

  const title = result.changes?.title || `Review of ${result.changes?.id ?? 'changes'}`;
  const generated = new Date(result.generatedAt).toLocaleString();

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AI Code Review — ${escapeHtml(title)}</title>
<style>${STYLES}</style>
</head>
<body>
<div id="app"></div>
<script type="application/json" id="report-data">${dataJson}</script>
<script>
const REPORT = JSON.parse(document.getElementById('report-data').textContent);
const REPORT_TITLE = ${JSON.stringify(title)};
const REPORT_GENERATED = ${JSON.stringify(generated)};
${CLIENT_SCRIPT}
</script>
</body>
</html>`;
}

const STYLES = `
:root {
  --bg: #f7f8fa;
  --surface: #ffffff;
  --surface-2: #f3f4f6;
  --border: #e4e7eb;
  --text: #1a202c;
  --text-dim: #5e6471;
  --accent: #3b82f6;
  --accent-hover: #2563eb;
  --critical: #dc2626;
  --high: #ea580c;
  --medium: #ca8a04;
  --low: #2563eb;
  --info: #6b7280;
  --add: #22c55e;
  --del: #ef4444;
  --shadow: 0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04);
}
[data-theme="dark"] {
  --bg: #0f1115;
  --surface: #1a1d23;
  --surface-2: #22262e;
  --border: #2d3139;
  --text: #e4e7eb;
  --text-dim: #9ca3af;
  --accent: #60a5fa;
  --accent-hover: #93c5fd;
  --shadow: 0 1px 3px rgba(0,0,0,0.4), 0 1px 2px rgba(0,0,0,0.3);
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: var(--bg);
  color: var(--text);
  line-height: 1.5;
  font-size: 14px;
}
code, pre { font-family: 'SF Mono', Menlo, Monaco, Consolas, 'Liberation Mono', monospace; font-size: 13px; }

.app { display: grid; grid-template-columns: 280px 1fr; min-height: 100vh; }
@media (max-width: 900px) { .app { grid-template-columns: 1fr; } .sidebar { position: static !important; height: auto !important; } }

.sidebar {
  background: var(--surface);
  border-right: 1px solid var(--border);
  padding: 20px 16px;
  position: sticky; top: 0;
  height: 100vh; overflow-y: auto;
}
.sidebar h2 { margin: 0 0 16px; font-size: 13px; text-transform: uppercase; color: var(--text-dim); letter-spacing: 0.05em; }
.file-list { list-style: none; padding: 0; margin: 0 0 24px; }
.file-list li {
  padding: 8px 10px; border-radius: 6px; cursor: pointer; margin-bottom: 2px;
  font-size: 13px; display: flex; justify-content: space-between; align-items: center; gap: 8px;
}
.file-list li:hover { background: var(--surface-2); }
.file-list li.active { background: var(--accent); color: white; }
.file-list li.active .file-count { background: rgba(255,255,255,0.25); color: white; }
.file-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.file-count { background: var(--surface-2); color: var(--text-dim); padding: 1px 8px; border-radius: 10px; font-size: 11px; }

.main { padding: 24px 32px; max-width: 1100px; }
.header { margin-bottom: 24px; }
.header h1 { margin: 0 0 4px; font-size: 24px; font-weight: 600; }
.header .meta { color: var(--text-dim); font-size: 13px; }
.header .meta a { color: var(--accent); text-decoration: none; }
.header .meta a:hover { text-decoration: underline; }

.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 12px; margin: 20px 0; }
.stat-card {
  background: var(--surface); border: 1px solid var(--border); border-radius: 8px;
  padding: 14px 16px; box-shadow: var(--shadow);
}
.stat-card .label { font-size: 11px; text-transform: uppercase; color: var(--text-dim); letter-spacing: 0.05em; }
.stat-card .value { font-size: 24px; font-weight: 600; margin-top: 4px; }
.stat-card.sev-critical .value { color: var(--critical); }
.stat-card.sev-high .value { color: var(--high); }
.stat-card.sev-medium .value { color: var(--medium); }
.stat-card.sev-low .value { color: var(--low); }
.stat-card.sev-info .value { color: var(--info); }

.controls {
  background: var(--surface); border: 1px solid var(--border); border-radius: 8px;
  padding: 14px 16px; margin: 20px 0; box-shadow: var(--shadow);
  display: flex; flex-wrap: wrap; gap: 14px; align-items: center;
}
.controls .group-label { font-size: 12px; text-transform: uppercase; color: var(--text-dim); margin-right: 4px; letter-spacing: 0.05em; }
.chip {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 5px 10px; border: 1px solid var(--border); background: var(--surface-2);
  border-radius: 14px; cursor: pointer; user-select: none; font-size: 12px;
  color: var(--text);
  transition: all 0.15s;
}
.chip:hover { border-color: var(--accent); }
.chip.active { background: var(--accent); color: white; border-color: var(--accent); }
.chip.sev-critical.active { background: var(--critical); border-color: var(--critical); }
.chip.sev-high.active { background: var(--high); border-color: var(--high); }
.chip.sev-medium.active { background: var(--medium); border-color: var(--medium); }
.chip.sev-low.active { background: var(--low); border-color: var(--low); }
.chip.sev-info.active { background: var(--info); border-color: var(--info); }
.chip-count { font-size: 11px; opacity: 0.8; }

.search-input {
  flex: 1; min-width: 200px; padding: 8px 12px;
  background: var(--surface-2); border: 1px solid var(--border); border-radius: 6px;
  color: var(--text); font-size: 13px;
}
.search-input:focus { outline: 2px solid var(--accent); outline-offset: -1px; }

.theme-toggle, .clear-btn {
  background: var(--surface-2); border: 1px solid var(--border); border-radius: 6px;
  padding: 6px 12px; cursor: pointer; color: var(--text); font-size: 12px;
}
.theme-toggle:hover, .clear-btn:hover { background: var(--accent); color: white; border-color: var(--accent); }

.summary-card {
  background: var(--surface); border: 1px solid var(--border); border-radius: 8px;
  padding: 16px 20px; margin: 20px 0; box-shadow: var(--shadow);
}
.summary-card h3 { margin: 0 0 8px; font-size: 14px; }
.summary-card p { margin: 0; color: var(--text-dim); }

.file-section { margin-top: 32px; }
.file-section h2 {
  font-size: 16px; font-weight: 600; padding: 10px 14px;
  background: var(--surface-2); border-radius: 6px; margin: 0 0 12px;
  font-family: 'SF Mono', Menlo, Monaco, Consolas, monospace;
  display: flex; align-items: center; gap: 10px;
}
.file-badge { font-size: 11px; padding: 2px 8px; border-radius: 10px; background: var(--accent); color: white; font-family: -apple-system, sans-serif; font-weight: 500; }
.file-badge.add { background: var(--add); }
.file-badge.modify { background: var(--accent); }
.file-badge.rename { background: var(--medium); }
.file-stats { font-size: 12px; color: var(--text-dim); margin-left: auto; font-family: -apple-system, sans-serif; font-weight: 400; }
.file-stats .added { color: var(--add); }
.file-stats .removed { color: var(--del); }

.issue {
  background: var(--surface); border: 1px solid var(--border); border-radius: 8px;
  margin-bottom: 12px; box-shadow: var(--shadow); overflow: hidden;
  border-left: 4px solid var(--info);
}
.issue.sev-critical { border-left-color: var(--critical); }
.issue.sev-high { border-left-color: var(--high); }
.issue.sev-medium { border-left-color: var(--medium); }
.issue.sev-low { border-left-color: var(--low); }
.issue.sev-info { border-left-color: var(--info); }

.issue-header {
  padding: 12px 16px; cursor: pointer;
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
}
.issue-header:hover { background: var(--surface-2); }
.issue-title { font-weight: 600; font-size: 14px; flex: 1; min-width: 200px; }
.severity-badge, .category-badge, .confidence-badge {
  font-size: 10px; text-transform: uppercase; padding: 2px 8px; border-radius: 10px;
  font-weight: 600; letter-spacing: 0.04em;
}
.severity-badge.sev-critical { background: var(--critical); color: white; }
.severity-badge.sev-high { background: var(--high); color: white; }
.severity-badge.sev-medium { background: var(--medium); color: white; }
.severity-badge.sev-low { background: var(--low); color: white; }
.severity-badge.sev-info { background: var(--info); color: white; }
.category-badge { background: var(--surface-2); color: var(--text-dim); border: 1px solid var(--border); }
.confidence-badge { background: var(--surface-2); color: var(--text-dim); border: 1px solid var(--border); }
.location { color: var(--text-dim); font-size: 12px; font-family: 'SF Mono', monospace; }
.toggle-icon { color: var(--text-dim); transition: transform 0.2s; font-size: 16px; }
.issue.open .toggle-icon { transform: rotate(90deg); }

.issue-body { padding: 0 16px 16px; display: none; border-top: 1px solid var(--border); padding-top: 14px; }
.issue.open .issue-body { display: block; }
.issue-body p { margin: 0 0 12px; }
.fix-block { background: var(--surface-2); border: 1px solid var(--border); border-radius: 6px; margin-top: 12px; }
.fix-header { padding: 8px 12px; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; font-size: 12px; color: var(--text-dim); }
.fix-header strong { color: var(--text); }
.copy-btn { background: var(--accent); color: white; border: none; border-radius: 4px; padding: 3px 10px; font-size: 11px; cursor: pointer; }
.copy-btn:hover { background: var(--accent-hover); }
.copy-btn.copied { background: var(--add); }
pre.code { margin: 0; padding: 12px; overflow-x: auto; }
pre.code code { display: block; white-space: pre; }

.diff-context { margin-top: 12px; background: var(--surface-2); border: 1px solid var(--border); border-radius: 6px; overflow: hidden; }
.diff-context-header { padding: 8px 12px; border-bottom: 1px solid var(--border); font-size: 12px; color: var(--text-dim); }
.diff-line { padding: 1px 12px; font-family: 'SF Mono', monospace; font-size: 12px; white-space: pre; }
.diff-line.add { background: rgba(34, 197, 94, 0.12); color: var(--add); }
.diff-line.del { background: rgba(239, 68, 68, 0.12); color: var(--del); }
.diff-line.hunk { background: var(--surface); color: var(--text-dim); border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); }
.diff-line.highlight { background: rgba(255, 235, 59, 0.18); }

.empty-state { text-align: center; padding: 60px 20px; color: var(--text-dim); }
.empty-state .icon { font-size: 48px; margin-bottom: 12px; }

.footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid var(--border); color: var(--text-dim); font-size: 12px; text-align: center; }
.kbd { background: var(--surface-2); border: 1px solid var(--border); border-radius: 3px; padding: 1px 5px; font-family: monospace; font-size: 11px; }
`;

// Client-side rendering script. Plain DOM, no framework. ~ 250 lines.
const CLIENT_SCRIPT = `
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const el = (tag, attrs = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2).toLowerCase(), v);
    else node.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null) continue;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
};
const escape = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'];
const ALL_CATEGORIES = Array.from(new Set(REPORT.issues.map(i => i.category))).sort();

const state = {
  selectedSeverities: new Set(SEVERITIES),
  selectedCategories: new Set(ALL_CATEGORIES),
  selectedFile: null, // null = all files
  search: '',
  theme: localStorage.getItem('ai-review-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'),
};
document.documentElement.setAttribute('data-theme', state.theme);

function filteredIssues() {
  const q = state.search.toLowerCase();
  return REPORT.issues.filter(i => {
    if (!state.selectedSeverities.has(i.severity)) return false;
    if (!state.selectedCategories.has(i.category)) return false;
    if (state.selectedFile && i.file !== state.selectedFile) return false;
    if (q) {
      const hay = (i.title + ' ' + i.description + ' ' + i.file + ' ' + i.category).toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function severityCounts(filterFn = () => true) {
  const counts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const i of REPORT.issues) if (filterFn(i)) counts[i.severity]++;
  return counts;
}

function categoryCounts() {
  const counts = {};
  for (const i of REPORT.issues) counts[i.category] = (counts[i.category] || 0) + 1;
  return counts;
}

function fileIssueCounts() {
  const counts = {};
  for (const i of REPORT.issues) counts[i.file] = (counts[i.file] || 0) + 1;
  return counts;
}

/** Extract a small diff window around the issue's line range from the file's diff. */
function extractDiffContext(filePath, lineStart, lineEnd) {
  const file = REPORT.fileResults.find(f => f.filePath === filePath);
  if (!file || !file.review) return null;
  const fileObj = REPORT.changes.files.find(f => f.path === filePath);
  if (!fileObj || !fileObj.diff) return null;
  const lines = fileObj.diff.split('\\n');
  const out = [];
  let curNew = 0;
  let inHunk = false;
  let hunkHeader = null;
  for (const ln of lines) {
    if (ln.startsWith('@@')) {
      const m = ln.match(/^@@ -\\d+(?:,\\d+)? \\+(\\d+)(?:,(\\d+))? @@/);
      if (m) {
        curNew = parseInt(m[1], 10);
        inHunk = true;
        hunkHeader = ln;
        const hunkEnd = curNew + (m[2] ? parseInt(m[2], 10) : 1);
        // include hunk header only if the issue range overlaps this hunk
        if (lineStart < hunkEnd) out.push({ kind: 'hunk', text: ln });
      }
      continue;
    }
    if (!inHunk) continue;
    if (ln.startsWith('---') || ln.startsWith('+++')) continue;
    let kind = 'ctx', textLine = ln.slice(1);
    if (ln.startsWith('+')) kind = 'add';
    else if (ln.startsWith('-')) kind = 'del';
    const lineNum = (kind === 'del') ? null : curNew;
    const within = lineNum != null && lineNum >= Math.max(1, lineStart - 3) && lineNum <= lineEnd + 3;
    const highlight = lineNum != null && lineNum >= lineStart && lineNum <= lineEnd;
    if (within) out.push({ kind, text: ln, lineNum, highlight });
    if (kind !== 'del') curNew++;
  }
  return out.length ? out : null;
}

function renderHeader() {
  const c = REPORT.changes;
  const link = c.url ? \`<a href="\${escape(c.url)}" target="_blank">View source ↗</a>\` : '';
  const cost = REPORT.cost ? \` · est. cost $\${REPORT.cost.toFixed(4)}\` : '';
  return el('div', { class: 'header', html: \`
    <h1>\${escape(REPORT_TITLE)}</h1>
    <div class="meta">
      \${escape(c.headRef || '')} → \${escape(c.baseRef || '')} ·
      \${REPORT.stats.filesReviewed} files reviewed ·
      \${REPORT.usage.total.toLocaleString()} tokens\${cost} ·
      Model: \${escape(REPORT.model)} ·
      \${REPORT.cacheHits ? \`<span title="Cache hits">⚡ \${REPORT.cacheHits} cached</span> · \` : ''}
      Generated \${escape(REPORT_GENERATED)}
      \${link ? ' · ' + link : ''}
    </div>
  \` });
}

function renderStats() {
  const s = REPORT.stats;
  const stats = el('div', { class: 'stats' });
  for (const sev of SEVERITIES) {
    stats.appendChild(el('div', { class: \`stat-card sev-\${sev}\`, html:
      \`<div class="label">\${sev}</div><div class="value">\${s[sev]}</div>\`
    }));
  }
  stats.appendChild(el('div', { class: 'stat-card', html:
    \`<div class="label">Total issues</div><div class="value">\${s.total}</div>\`
  }));
  return stats;
}

function renderControls() {
  const sevCounts = severityCounts();
  const catCounts = categoryCounts();
  const controls = el('div', { class: 'controls' });

  controls.appendChild(el('span', { class: 'group-label' }, 'Severity'));
  for (const sev of SEVERITIES) {
    const chip = el('span', {
      class: \`chip sev-\${sev}\${state.selectedSeverities.has(sev) ? ' active' : ''}\`,
      onclick: () => {
        if (state.selectedSeverities.has(sev)) state.selectedSeverities.delete(sev);
        else state.selectedSeverities.add(sev);
        render();
      },
    });
    chip.appendChild(document.createTextNode(sev));
    chip.appendChild(el('span', { class: 'chip-count' }, '· ' + sevCounts[sev]));
    controls.appendChild(chip);
  }

  controls.appendChild(el('span', { class: 'group-label' }, 'Category'));
  for (const cat of ALL_CATEGORIES) {
    const chip = el('span', {
      class: \`chip\${state.selectedCategories.has(cat) ? ' active' : ''}\`,
      onclick: () => {
        if (state.selectedCategories.has(cat)) state.selectedCategories.delete(cat);
        else state.selectedCategories.add(cat);
        render();
      },
    });
    chip.appendChild(document.createTextNode(cat.replace('_', ' ')));
    chip.appendChild(el('span', { class: 'chip-count' }, '· ' + (catCounts[cat] || 0)));
    controls.appendChild(chip);
  }

  const search = el('input', {
    class: 'search-input',
    placeholder: 'Search issues...',
    value: state.search,
    oninput: (e) => { state.search = e.target.value; renderIssuesOnly(); },
  });
  controls.appendChild(search);

  const themeBtn = el('button', {
    class: 'theme-toggle',
    onclick: () => {
      state.theme = state.theme === 'dark' ? 'light' : 'dark';
      localStorage.setItem('ai-review-theme', state.theme);
      document.documentElement.setAttribute('data-theme', state.theme);
    },
  }, state.theme === 'dark' ? '☀ Light' : '☾ Dark');
  controls.appendChild(themeBtn);

  return controls;
}

function renderSidebar() {
  const counts = fileIssueCounts();
  const sb = el('div', { class: 'sidebar' });
  sb.appendChild(el('h2', {}, \`Files (\${REPORT.fileResults.length})\`));
  const ul = el('ul', { class: 'file-list' });

  const allLi = el('li', {
    class: state.selectedFile == null ? 'active' : '',
    onclick: () => { state.selectedFile = null; render(); },
  });
  allLi.appendChild(el('span', { class: 'file-name' }, 'All files'));
  allLi.appendChild(el('span', { class: 'file-count' }, String(REPORT.issues.length)));
  ul.appendChild(allLi);

  for (const f of REPORT.fileResults) {
    const li = el('li', {
      class: state.selectedFile === f.filePath ? 'active' : '',
      title: f.filePath,
      onclick: () => { state.selectedFile = f.filePath; render(); },
    });
    li.appendChild(el('span', { class: 'file-name' }, f.filePath.split('/').pop()));
    li.appendChild(el('span', { class: 'file-count' }, String(counts[f.filePath] || 0)));
    ul.appendChild(li);
  }
  sb.appendChild(ul);
  return sb;
}

function renderSummary() {
  const summary = REPORT.aggregateReview?.summary || REPORT.fileResults[0]?.review?.summary || '';
  if (!summary.trim()) return null;
  return el('div', { class: 'summary-card' },
    el('h3', {}, 'Overall summary'),
    el('p', {}, summary)
  );
}

function renderIssue(i) {
  const fix = i.suggested_fix || {};
  const fixHtml = fix.replacement_code
    ? \`<div class="fix-block">
        <div class="fix-header">
          <strong>Suggested fix</strong> — \${escape(fix.explanation || '')}
          <button class="copy-btn" data-fix="\${encodeURIComponent(fix.replacement_code)}">Copy</button>
        </div>
        <pre class="code"><code>\${escape(fix.replacement_code)}</code></pre>
      </div>\`
    : (fix.explanation ? \`<div class="fix-block"><div class="fix-header"><strong>Suggestion</strong> — \${escape(fix.explanation)}</div></div>\` : '');

  // Diff context
  const ctx = extractDiffContext(i.file, i.line_start, i.line_end);
  let diffHtml = '';
  if (ctx) {
    const lines = ctx.map(c => {
      if (c.kind === 'hunk') return \`<div class="diff-line hunk">\${escape(c.text)}</div>\`;
      const numStr = c.lineNum != null ? String(c.lineNum).padStart(4, ' ') + '  ' : '      ';
      return \`<div class="diff-line \${c.kind}\${c.highlight ? ' highlight' : ''}">\${escape(numStr)}\${escape(c.text)}</div>\`;
    }).join('');
    diffHtml = \`<div class="diff-context"><div class="diff-context-header">Diff context</div>\${lines}</div>\`;
  }

  const wrap = el('div', { class: \`issue sev-\${i.severity}\` });
  wrap.innerHTML = \`
    <div class="issue-header">
      <span class="severity-badge sev-\${i.severity}">\${i.severity}</span>
      <span class="category-badge">\${escape(i.category.replace('_', ' '))}</span>
      <span class="issue-title">\${escape(i.title)}</span>
      <span class="confidence-badge">conf: \${i.confidence}</span>
      <span class="location">\${escape(i.file.split('/').pop())}:\${i.line_start}\${i.line_end !== i.line_start ? '-' + i.line_end : ''}</span>
      <span class="toggle-icon">›</span>
    </div>
    <div class="issue-body">
      <p>\${escape(i.description)}</p>
      <div style="font-size:12px;color:var(--text-dim);font-family:monospace;">\${escape(i.file)}:\${i.line_start}\${i.line_end !== i.line_start ? '-' + i.line_end : ''}</div>
      \${diffHtml}
      \${fixHtml}
    </div>
  \`;
  // Wire up toggle + copy
  wrap.querySelector('.issue-header').addEventListener('click', () => wrap.classList.toggle('open'));
  const copyBtn = wrap.querySelector('.copy-btn');
  if (copyBtn) {
    copyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const code = decodeURIComponent(copyBtn.dataset.fix);
      navigator.clipboard.writeText(code).then(() => {
        copyBtn.textContent = 'Copied ✓';
        copyBtn.classList.add('copied');
        setTimeout(() => { copyBtn.textContent = 'Copy'; copyBtn.classList.remove('copied'); }, 1500);
      });
    });
  }
  return wrap;
}

function renderIssues() {
  const issues = filteredIssues();
  const main = $('#issues-list');
  main.innerHTML = '';

  if (issues.length === 0) {
    const allClean = REPORT.issues.length === 0;
    main.appendChild(el('div', { class: 'empty-state', html:
      allClean
        ? '<div class="icon">✨</div><h3>No issues found</h3><p>The reviewer thinks this change is clean. Nice work.</p>'
        : '<div class="icon">🔍</div><h3>No issues match your filters</h3><p>Try widening the severity or category filters.</p>'
    }));
    return;
  }

  // Group by file
  const byFile = new Map();
  for (const i of issues) {
    if (!byFile.has(i.file)) byFile.set(i.file, []);
    byFile.get(i.file).push(i);
  }

  for (const [file, fileIssues] of byFile) {
    const section = el('div', { class: 'file-section' });
    const fileMeta = REPORT.fileResults.find(f => f.filePath === file);
    const stats = fileMeta ? fileMeta.stats : null;
    const changeType = fileMeta ? fileMeta.changeType : 'modify';
    const statsHtml = stats ? \`<span class="file-stats"><span class="added">+\${stats.added}</span> <span class="removed">-\${stats.removed}</span></span>\` : '';
    const headerHtml = \`<span class="file-badge \${changeType}">\${changeType}</span>\${escape(file)}\${statsHtml}\`;
    const h2 = el('h2', { html: headerHtml });
    section.appendChild(h2);
    for (const i of fileIssues) section.appendChild(renderIssue(i));
    main.appendChild(section);
  }
}

function renderIssuesOnly() {
  // Re-render just the issues without rebuilding the whole DOM (faster on big reports).
  renderIssues();
}

function render() {
  const root = $('#app');
  root.innerHTML = '';
  const app = el('div', { class: 'app' });
  app.appendChild(renderSidebar());
  const main = el('div', { class: 'main' });
  main.appendChild(renderHeader());
  main.appendChild(renderStats());
  main.appendChild(renderControls());
  const summaryNode = renderSummary();
  if (summaryNode) main.appendChild(summaryNode);
  main.appendChild(el('div', { id: 'issues-list' }));
  main.appendChild(el('div', { class: 'footer', html:
    'Generated by AI Code Reviewer · <span class="kbd">/</span> to focus search · click an issue to expand'
  }));
  app.appendChild(main);
  root.appendChild(app);
  renderIssues();
}

document.addEventListener('keydown', (e) => {
  if (e.key === '/' && document.activeElement.tagName !== 'INPUT') {
    e.preventDefault();
    const s = $('.search-input');
    if (s) s.focus();
  }
});

render();
`;
