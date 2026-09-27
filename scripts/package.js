// Builds dist/trellis-<version>.zip for the Chrome Web Store: only the files the extension needs
// (no tests, docs or node_modules), after checking that every file the extension references exists.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const files = [
  'manifest.json',
  ...fs.readdirSync(root).filter((f) => /\.(js|html|css)$/.test(f) && f !== 'playwright.config.js'),
  ...fs.readdirSync(path.join(root, 'icons')).filter((f) => /^icon(16|32|48|128)\.png$/.test(f)).map((f) => `icons/${f}`),
  ...fs.readdirSync(path.join(root, 'wordlists')).filter((f) => f.endsWith('.txt')).map((f) => `wordlists/${f}`)
];

// Every script, page and asset referenced by the manifest or the extension pages must be packaged.
const referenced = new Set([
  ...Object.values(manifest.icons || {}),
  ...Object.values(manifest.action?.default_icon || {}),
  manifest.action?.default_popup,
  manifest.options_page,
  ...(manifest.web_accessible_resources || []).flatMap((r) => r.resources)
].filter(Boolean));
for (const f of files.filter((f) => f.endsWith('.html'))) {
  for (const [, ref] of fs.readFileSync(path.join(root, f), 'utf8').matchAll(/(?:src|href)="([^"#?:]+)"/g)) referenced.add(ref);
}
for (const f of fs.readFileSync(path.join(root, 'background.js'), 'utf8').matchAll(/'([\w-]+\.js)'/g)) referenced.add(f[1]);
const missing = [...referenced].filter((f) => !files.includes(f));
if (missing.length) {
  console.error('Referenced but not packaged:', missing.join(', '));
  process.exit(1);
}

const out = path.join(root, 'dist', `trellis-${manifest.version}.zip`);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.rmSync(out, { force: true });
execFileSync('zip', ['-q', '-X', out, ...files], { cwd: root, stdio: 'inherit' });
console.log(`${path.relative(root, out)}: ${files.length} files, ${(fs.statSync(out).size / 1024).toFixed(0)} KB`);
