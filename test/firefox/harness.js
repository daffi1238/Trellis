// Firefox test harness: installs the Firefox build of Trellis as a temporary add-on in Firefox (Selenium +
// geckodriver) and serves the mock chat pages over local HTTPS. Firefox resolves claude.ai and chatgpt.com to
// this machine (network.dns.localDomains), so the extension's host permissions apply as on the real sites.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const https = require('node:https');
const { execFileSync } = require('node:child_process');
const { Builder } = require('selenium-webdriver');
const firefox = require('selenium-webdriver/firefox');
const pages = require('../e2e/pages');

const ROOT = path.join(__dirname, '..', '..');
const PORT = Number(process.env.TRELLIS_FF_PORT || 18443);
const ADDON_ID = 'trellis@daffi1238.github.io';
const EXT_UUID = '6f1a5a52-0c2e-4d8a-9d5e-7a3b1c2d4e5f';
const extUrl = (page) => `moz-extension://${EXT_UUID}/${page}`;

function certificate() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trellis-ff-'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=claude.ai',
    '-addext', 'subjectAltName=DNS:claude.ai,DNS:chatgpt.com', '-keyout', path.join(dir, 'key.pem'), '-out', path.join(dir, 'cert.pem')],
  { stdio: 'ignore' });
  return { key: fs.readFileSync(path.join(dir, 'key.pem')), cert: fs.readFileSync(path.join(dir, 'cert.pem')) };
}

function startServer() {
  const received = [];
  const server = https.createServer(certificate(), (req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      if (req.url.startsWith('/api/')) {
        received.push(body);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{}');
        return;
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(req.headers.host.startsWith('chatgpt.com') ? pages.chatgpt : pages.claude);
    });
  });
  return new Promise((resolve) => server.listen(PORT, '127.0.0.1', () => resolve({ server, received })));
}

async function startFirefox() {
  execFileSync('node', [path.join(ROOT, 'scripts', 'package.js'), '--target=firefox'], { stdio: 'ignore' });
  const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8')).version;
  // Installed into the profile before start: content scripts do not run for add-ons installed as temporary
  // through WebDriver (installAddon) in this setup. Unsigned add-ons need Firefox ESR, Developer Edition or
  // Nightly (xpinstall.signatures.required = false).
  const xpi = path.join(ROOT, 'dist', `trellis-firefox-${version}.xpi`);
  fs.copyFileSync(path.join(ROOT, 'dist', `trellis-firefox-${version}.zip`), xpi);
  const options = new firefox.Options()
    .addArguments('-headless')
    .addExtensions(xpi)
    .setPreference('xpinstall.signatures.required', false)
    .setAcceptInsecureCerts(true)
    .setPreference('network.dns.localDomains', 'claude.ai,chatgpt.com')
    .setPreference('dom.events.testing.asyncClipboard', true) // lets the tests read/write the clipboard
    .setPreference('extensions.webextOptionalPermissionPrompts', false)
    // A fixed internal UUID, so tests can open the extension's own pages (moz-extension://<uuid>/...).
    .setPreference('extensions.webextensions.uuids', JSON.stringify({ [ADDON_ID]: EXT_UUID }));
  if (process.env.FIREFOX_BIN) options.setBinary(process.env.FIREFOX_BIN);
  // In CI, let Selenium Manager download Firefox ESR (release builds refuse unsigned add-ons).
  else if (process.env.FIREFOX_VERSION) options.setBrowserVersion(process.env.FIREFOX_VERSION);
  // --allow-system-access lets tests read the browser console (content script errors) from the chrome context.
  const service = new firefox.ServiceBuilder().addArguments('--allow-system-access');
  return new Builder().forBrowser('firefox').setFirefoxOptions(options).setFirefoxService(service).build();
}

const url = (host, p = '/new') => `https://${host}:${PORT}${p}`;

// Errors and warnings logged by Trellis' own scripts in the browser console.
async function extensionErrors(driver) {
  await driver.setContext(firefox.Context.CHROME);
  try {
    return await driver.executeScript(`
      return Services.console.getMessageArray()
        .filter((m) => m instanceof Ci.nsIScriptError && (m.sourceName || '').includes('moz-extension'))
        .map((m) => (m.flags & 1 ? 'warning' : 'error') + ': ' + m.errorMessage + ' @ ' + m.sourceName.split('/').pop() + ':' + m.lineNumber);`);
  } finally {
    await driver.setContext(firefox.Context.CONTENT);
  }
}

module.exports = { startServer, startFirefox, url, extUrl, extensionErrors };
