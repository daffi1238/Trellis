// Builds the store packages from the same sources:
//   node scripts/package.js                  -> dist/trellis-<version>.zip          (Chrome Web Store)
//   node scripts/package.js --target=firefox -> dist/firefox/ + dist/trellis-firefox-<version>.zip (AMO)
// Only the files the extension needs are included (no tests, docs or node_modules), after checking that every
// file the extension references exists.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const target = (process.argv.find((a) => a.startsWith('--target=')) || '--target=chrome').split('=')[1];
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const files = [
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

// Firefox: an event page instead of a service worker, an add-on id, the minimum version with every API Trellis
// uses (MAIN-world scripts, CSS Custom Highlight API, host permissions granted at install), and the data
// collection declaration AMO requires for new extensions.
function firefoxManifest(m) {
  const out = { ...m };
  out.background = { scripts: ['defaults.js', 'obfuscator.js', 'background.js'] };
  out.browser_specific_settings = {
    gecko: {
      id: 'trellis@daffi1238.github.io',
      strict_min_version: '140.0',
      data_collection_permissions: { required: ['none'] }
    },
    // Firefox for Android supports the data collection declaration from version 142.
    gecko_android: { strict_min_version: '142.0' }
  };
  // Firefox already uses a random per-install extension URL.
  out.web_accessible_resources = (m.web_accessible_resources || []).map(({ use_dynamic_url, ...r }) => r);
  return out;
}

const dist = path.join(root, 'dist');
fs.mkdirSync(dist, { recursive: true });
let out;
if (target === 'firefox') {
  const dir = path.join(dist, 'firefox');
  fs.rmSync(dir, { recursive: true, force: true });
  for (const f of files) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.copyFileSync(path.join(root, f), path.join(dir, f));
  }
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(firefoxManifest(manifest), null, 2) + '\n');
  out = path.join(dist, `trellis-firefox-${manifest.version}.zip`);
  fs.rmSync(out, { force: true });
  execFileSync('zip', ['-q', '-X', '-r', out, '.'], { cwd: dir, stdio: 'inherit' });
} else if (target === 'chrome') {
  out = path.join(dist, `trellis-${manifest.version}.zip`);
  fs.rmSync(out, { force: true });
  execFileSync('zip', ['-q', '-X', out, 'manifest.json', ...files], { cwd: root, stdio: 'inherit' });
} else {
  console.error(`Unknown target: ${target}`);
  process.exit(1);
}
console.log(`${path.relative(root, out)}: ${files.length + 1} files, ${(fs.statSync(out).size / 1024).toFixed(0)} KB`);
