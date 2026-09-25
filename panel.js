// Trellis in-page panel. An extension page loaded in a cross-origin <iframe> on the chat page, so the site
// cannot read it. It talks to the content script of its tab through chrome.storage.session:
//   trellis:panel:<id> -> state published by the content script ({ site, suggestions })
//   trellis:cmd:<id>   -> commands for the content script ({ cmd, ... })
const $ = (sel) => document.querySelector(sel);
const panelId = location.hash.slice(1);
const PANEL_KEY = `trellis:panel:${panelId}`;
const CMD_KEY = `trellis:cmd:${panelId}`;
const KIND_LABELS = { name: 'Capitalized words', code: 'Code or identifier', host: 'Host name', number: 'Long number' };

let site = null;
let suggestions = [];
let settings = null;

function el(tag, props = {}, children = []) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function status(text, warn = false) {
  $('#status').textContent = text;
  $('#status').classList.toggle('warn', warn);
}

function send(cmd, extra = {}) {
  return chrome.storage.session.set({ [CMD_KEY]: { cmd, ...extra, nonce: Math.random() } });
}

function defaultCategory(kind) {
  const cats = settings.memoryCategories;
  if (kind === 'name') return cats.includes('Person') ? 'Person' : cats[0];
  return cats.includes('Other') ? 'Other' : cats[cats.length - 1];
}

async function remember(term, category, partial) {
  category = String(category || '').trim() || 'Other';
  if (!settings.memoryCategories.some((c) => c.toLowerCase() === category.toLowerCase())) {
    settings.memoryCategories = [...settings.memoryCategories, category];
    await chrome.storage.local.set({ memoryCategories: settings.memoryCategories });
  }
  await trellisAddToMemory([term], category, { partial });
  await send('apply');
  status(`"${term}" will be hidden as ${category}.`);
}

function renderSuggestions() {
  const list = $('#suggestions');
  list.replaceChildren();
  for (const s of suggestions) {
    const cat = el('input', { type: 'text', className: 'category', value: defaultCategory(s.kind) });
    cat.setAttribute('list', 'categories');
    cat.title = 'Category (placeholder label)';
    const hide = el('button', { className: 'primary', textContent: 'Hide' });
    hide.addEventListener('click', () => remember(s.value, cat.value, false));
    const ignore = el('button', { className: 'link', textContent: 'Ignore', title: 'Do not suggest it again on this page' });
    ignore.addEventListener('click', () => send('dismiss', { value: s.value }));
    list.append(el('li', {}, [
      el('div', {}, [
        el('div', { className: 'value', textContent: s.value }),
        el('div', { className: 'kind', textContent: KIND_LABELS[s.kind] + (s.count > 1 ? ` · ×${s.count}` : '') })
      ]),
      el('div', { className: 'actions' }, [cat, hide, ignore])
    ]));
  }
  $('#suggestionCount').textContent = suggestions.length ? `(${suggestions.length})` : '';
  $('#noSuggestions').hidden = suggestions.length > 0;
}

async function renderPlaceholders() {
  const entries = trellisVaultEntries(await chrome.storage.session.get(null), site)
    .sort((a, b) => a.token.localeCompare(b.token, undefined, { numeric: true }));
  const list = $('#placeholders');
  list.replaceChildren();
  for (const e of entries) {
    const never = el('button', { className: 'link', textContent: 'Never hide', title: 'Mark as not sensitive and put it back in the message box' });
    never.addEventListener('click', async () => {
      const allowlist = [...new Set([...(settings.allowlist || []), e.value])];
      settings.allowlist = allowlist;
      await chrome.storage.local.set({ allowlist });
      await send('revert', { token: e.token });
      status(`"${e.value}" will no longer be hidden.`);
    });
    list.append(el('li', {}, [
      el('div', {}, [el('span', { className: 'chip', textContent: e.token }), ' ', el('span', { className: 'value', textContent: e.value })]),
      el('div', { className: 'actions' }, [never])
    ]));
  }
  $('#placeholderCount').textContent = entries.length ? `(${entries.length})` : '';
  $('#noPlaceholders').hidden = entries.length > 0;
}

function renderCategories() {
  const list = $('#categories');
  list.replaceChildren(...settings.memoryCategories.map((c) => el('option', { value: c })));
  if (!$('#category').value) $('#category').value = defaultCategory('name');
}

async function loadState() {
  const state = (await chrome.storage.session.get(PANEL_KEY))[PANEL_KEY];
  if (!state) return;
  site = state.site;
  suggestions = state.suggestions || [];
  $('#site').textContent = site;
  renderSuggestions();
  await renderPlaceholders();
}

$('#close').addEventListener('click', () => send('close'));
$('#add').addEventListener('click', async () => {
  const term = $('#term').value.trim();
  if (!term) return;
  if ($('#partial').checked && term.length < 4) status('Partial match on a very short term will hit many unrelated words.', true);
  await remember(term, $('#category').value, $('#partial').checked);
  $('#term').value = '';
});
$('#term').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('#add').click();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'session') {
    if (changes[PANEL_KEY]?.newValue) loadState();
    else if (Object.keys(changes).some((k) => trellisParseVaultKey(k)?.site === site)) renderPlaceholders();
  } else if (area === 'local' && (changes.memoryCategories || changes.allowlist)) {
    trellisGetSettings().then((s) => {
      settings = s;
      renderCategories();
    });
  }
});

(async () => {
  settings = await trellisGetSettings();
  renderCategories();
  await loadState();
})();
