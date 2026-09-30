// Uploads a package to the Chrome Web Store and submits it for review (Chrome Web Store API v2).
//
//   node scripts/publish-chrome.js dist/trellis-<version>.zip [--no-publish]
//
// Environment:
//   CWS_SERVICE_ACCOUNT_KEY  JSON key of the Google Cloud service account linked in the Developer Dashboard
//   CWS_PUBLISHER_ID         Developer Dashboard → Account → Publisher ID
//   CWS_EXTENSION_ID         the item's ID (created by the first, manual submission)
//
// No dependencies: the service account's access token is obtained with a JWT signed by node:crypto.
const fs = require('node:fs');
const crypto = require('node:crypto');

const SCOPE = 'https://www.googleapis.com/auth/chromewebstore';
const API = 'https://chromewebstore.googleapis.com';

// JWT assertion for the OAuth 2.0 service account flow (RFC 7523).
function buildAssertion(key, now = Math.floor(Date.now() / 1000)) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
    iss: key.client_email,
    scope: SCOPE,
    aud: key.token_uri || 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  })}`;
  return `${unsigned}.${crypto.sign('RSA-SHA256', Buffer.from(unsigned), key.private_key).toString('base64url')}`;
}

async function accessToken(key) {
  const res = await fetch(key.token_uri || 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: buildAssertion(key) })
  });
  const body = await res.json();
  if (!res.ok || !body.access_token) throw new Error(`token request failed (${res.status}): ${JSON.stringify(body)}`);
  return body.access_token;
}

async function call(token, method, url, body, contentType) {
  const res = await fetch(url, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(contentType ? { 'content-type': contentType } : {}) },
    body
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch (e) {
    json = { raw: text };
  }
  if (!res.ok) throw new Error(`${method} ${url} failed (${res.status}): ${text}`);
  return json;
}

async function main() {
  const [zip] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const publish = !process.argv.includes('--no-publish');
  const { CWS_SERVICE_ACCOUNT_KEY, CWS_PUBLISHER_ID, CWS_EXTENSION_ID } = process.env;
  if (!zip || !fs.existsSync(zip)) throw new Error(`package not found: ${zip}`);
  for (const [name, value] of Object.entries({ CWS_SERVICE_ACCOUNT_KEY, CWS_PUBLISHER_ID, CWS_EXTENSION_ID })) {
    if (!value) throw new Error(`missing environment variable ${name}`);
  }
  const key = JSON.parse(CWS_SERVICE_ACCOUNT_KEY);
  const item = `publishers/${CWS_PUBLISHER_ID}/items/${CWS_EXTENSION_ID}`;
  const token = await accessToken(key);

  console.log(`Uploading ${zip}…`);
  const upload = await call(token, 'POST', `${API}/upload/v2/${item}:upload`, fs.readFileSync(zip), 'application/zip');
  console.log('Upload:', JSON.stringify(upload));

  // Large packages are processed asynchronously: wait until the upload is no longer in progress.
  for (let i = 0; i < 40 && JSON.stringify(upload).includes('IN_PROGRESS'); i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const status = await call(token, 'GET', `${API}/v2/${item}:fetchStatus`);
    if (!JSON.stringify(status).includes('IN_PROGRESS')) {
      console.log('Status:', JSON.stringify(status));
      break;
    }
  }
  if (/FAILED|FAILURE/.test(JSON.stringify(upload))) throw new Error('upload failed');

  if (!publish) {
    console.log('Uploaded as a draft (--no-publish): submit it for review in the Developer Dashboard.');
    return;
  }
  const result = await call(token, 'POST', `${API}/v2/${item}:publish`, '{}', 'application/json');
  console.log('Submitted for review:', JSON.stringify(result));
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}

module.exports = { buildAssertion };
