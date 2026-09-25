// Trellis workbench: obfuscate and reveal text inside the extension, so original values never reach
// a chat page. It is an extension page (trusted context): web pages cannot read it.
const Engine = globalThis.TrellisEngine;
const $ = (sel) => document.querySelector(sel);

let settings = null;
let site = null;
let session = Engine.createSession();

function el(tag, props = {}, children = []) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

async function loadSession() {
  const fresh = Engine.createSession();
  for (const e of trellisVaultEntries(await chrome.storage.session.get(null), site)) {
    Engine.addEntry(fresh, e.token, e.label, e.value);
  }
  session = fresh;
  renderMappings();
  reveal();
}

function renderMappings() {
  const tbody = $('#mappings tbody');
  tbody.replaceChildren();
  const entries = [...session.reverse.entries()].sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }));
  for (const [token, value] of entries) {
    tbody.append(el('tr', {}, [el('td', { textContent: token }), el('td', { textContent: value })]));
  }
  $('#mappingCount').textContent = `(${entries.length})`;
}

// ---------- 1 · Obfuscate ----------
async function obfuscate() {
  const text = $('#source').value;
  const info = $('#obfuscateInfo');
  const matches = Engine.findAll(text, settings);
  const pending = Engine.pendingPlaceholders(matches, settings, session);
  if (pending.length) {
    // New placeholders are assigned by the background worker, which serializes assignments per site.
    const res = await chrome.runtime.sendMessage({ type: 'trellis:tokenize', site, items: pending });
    if (!res?.assigned) {
      info.textContent = 'Could not assign placeholders. Reload this page and try again.';
      return;
    }
    for (const a of res.assigned) Engine.addEntry(session, a.token, a.label, a.value);
  }
  const result = Engine.obfuscate(text, settings, session, matches);
  $('#obfuscated').value = result.text;
  const byRule = {};
  for (const m of result.matches) byRule[m.rule] = (byRule[m.rule] || 0) + 1;
  info.textContent = result.count
    ? `${result.count} item${result.count === 1 ? '' : 's'} obfuscated: ` +
      Object.entries(byRule).map(([r, n]) => `${r} ×${n}`).join(', ')
    : 'Nothing sensitive found.';
  if (settings.mode !== 'placeholder') info.textContent += ' (Mask/asterisks mode: replies cannot be revealed.)';
  renderMappings();
}

$('#obfuscate').addEventListener('click', obfuscate);
$('#source').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) obfuscate();
});

$('#copyObfuscated').addEventListener('click', async () => {
  const text = $('#obfuscated').value;
  if (!text) return;
  await navigator.clipboard.writeText(text);
  $('#copyObfuscatedInfo').textContent = 'Copied. Paste it into the chat.';
});

// ---------- 2 · Reveal ----------
function reveal() {
  const reply = $('#reply').value;
  const revealed = Engine.restore(reply, session);
  $('#revealed').value = revealed;
  const re = Engine.buildRestoreRegex(session);
  const found = re ? (reply.match(re) || []).length : 0;
  $('#revealInfo').textContent = reply
    ? `${found} placeholder${found === 1 ? '' : 's'} revealed.`
    : 'Revealed automatically as you paste.';
}

$('#reply').addEventListener('input', reveal);

$('#copyRevealed').addEventListener('click', async () => {
  const text = $('#revealed').value;
  if (!text) return;
  await navigator.clipboard.writeText(text);
  $('#revealInfo').textContent = 'Copied with original values. Clear the clipboard when you are done.';
});

$('#clearClipboard').addEventListener('click', async () => {
  try {
    // An empty string does not replace the clipboard contents in Chrome, so write a single space.
    await navigator.clipboard.writeText(' ');
    $('#revealInfo').textContent = 'Clipboard cleared.';
  } catch (e) {
    $('#revealInfo').textContent = 'Could not clear the clipboard: ' + e.message;
  }
});

// ---------- Site and mappings ----------
$('#site').addEventListener('change', (e) => {
  site = e.target.value;
  history.replaceState(null, '', `?site=${encodeURIComponent(site)}`);
  $('#obfuscated').value = '';
  loadSession();
});

$('#forgetSite').addEventListener('click', async () => {
  const keys = Object.keys(await chrome.storage.session.get(null)).filter((k) => trellisParseVaultKey(k)?.site === site);
  await chrome.storage.session.remove(keys);
});

// Placeholders created in the chat tabs of this site show up here too.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'session' && Object.keys(changes).some((k) => trellisParseVaultKey(k)?.site === site)) loadSession();
  if (area === 'local' && (changes.rules || changes.compiledWordlists || changes.compiledExceptions || changes.mode)) {
    trellisGetSettings().then((s) => (settings = s));
  }
});

(async () => {
  settings = await trellisGetSettings();
  const requested = new URLSearchParams(location.search).get('site');
  for (const d of settings.domains) $('#site').append(new Option(d, d));
  site = settings.domains.includes(requested) ? requested : settings.domains.includes('claude.ai') ? 'claude.ai' : settings.domains[0];
  $('#site').value = site;
  await loadSession();
})();
