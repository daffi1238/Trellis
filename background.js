importScripts('defaults.js', 'obfuscator.js');

const SCRIPT_ID = 'trellis-content';
const SCRIPT_FILES = ['defaults.js', 'obfuscator.js', 'content.js'];
// Intercepts the site's own "Copy" buttons; runs in the page world and never sees original values.
const MAIN_SCRIPT_ID = 'trellis-clipboard';
const MAIN_SCRIPT_FILES = ['clipboard-main.js'];

// Registers the content scripts only on configured domains we have permission for.
async function syncContentScripts() {
  const { domains } = await trellisGetSettings();
  const patterns = [];
  for (const d of domains) {
    const p = trellisDomainToPattern(d);
    if (await chrome.permissions.contains({ origins: [p] })) patterns.push(p);
  }

  const registered = await chrome.scripting.getRegisteredContentScripts();
  if (registered.length) await chrome.scripting.unregisterContentScripts({ ids: registered.map((s) => s.id) });
  if (!patterns.length) return [];

  await chrome.scripting.registerContentScripts([
    {
      id: SCRIPT_ID,
      matches: patterns,
      js: SCRIPT_FILES,
      runAt: 'document_start',
      allFrames: true
    },
    {
      id: MAIN_SCRIPT_ID,
      matches: patterns,
      js: MAIN_SCRIPT_FILES,
      runAt: 'document_start',
      allFrames: true,
      world: 'MAIN'
    }
  ]);
  return patterns;
}

// Injects into tabs that are already open (the scripts guard against double loading).
async function injectIntoOpenTabs(patterns) {
  if (!patterns.length) return;
  const tabs = await chrome.tabs.query({ url: patterns });
  for (const tab of tabs) {
    const target = { tabId: tab.id, allFrames: true };
    chrome.scripting.executeScript({ target, files: SCRIPT_FILES }).catch(() => {});
    chrome.scripting.executeScript({ target, files: MAIN_SCRIPT_FILES, world: 'MAIN' }).catch(() => {});
  }
}

async function resync() {
  const patterns = await syncContentScripts();
  await injectIntoOpenTabs(patterns);
}

// Word lists and memory are compiled on install/reload (e.g. after editing the .txt files),
// on browser startup and whenever they change.
async function compileWordlists() {
  await chrome.storage.local.set(await trellisCompileWordlists(await trellisGetSettings()));
}

// Earlier versions stored custom entries inside each word list ("extra"); move them to memory.
async function migrateToMemory() {
  const { wordlists } = await chrome.storage.local.get('wordlists');
  if (!Array.isArray(wordlists) || !wordlists.some((l) => 'extra' in l || l.id === 'empresas')) return;
  for (const l of wordlists) {
    if (l.extra) await trellisAddToMemory(trellisParseWordlist(l.extra), l.id === 'empresas' ? 'Company' : 'Person');
  }
  // Back to the default lists (company names now live in memory).
  await chrome.storage.local.remove('wordlists');
}

// Context menu: select text on any site (webmail, CRM...) and add it to memory.
const MENU_PARENT = 'trellis-memory';
async function createMenus() {
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({ id: MENU_PARENT, title: 'Add "%s" to Trellis memory', contexts: ['selection'] });
  const { memoryCategories } = await trellisGetSettings();
  for (const cat of memoryCategories) {
    chrome.contextMenus.create({ id: 'cat:' + cat, parentId: MENU_PARENT, title: cat, contexts: ['selection'] });
  }
}

chrome.contextMenus.onClicked.addListener((info) => {
  if (!String(info.menuItemId).startsWith('cat:') || !info.selectionText) return;
  trellisAddToMemory([info.selectionText], String(info.menuItemId).slice(4));
});

chrome.runtime.onInstalled.addListener(async () => {
  await migrateToMemory();
  compileWordlists();
  createMenus();
  resync();
});
chrome.runtime.onStartup.addListener(() => {
  compileWordlists();
  syncContentScripts();
});
chrome.permissions.onAdded.addListener(resync);
chrome.permissions.onRemoved.addListener(syncContentScripts);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.domains) resync();
  if (changes.wordlists || changes.exceptionsExtra || changes.memory) compileWordlists();
  if (changes.memoryCategories) createMenus();
});

// ---------- Placeholder <-> original mapping ----------
// Content scripts cannot use storage.session by default; open it explicitly.
const accessReady = chrome.storage.session
  .setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' })
  .catch(() => {});

// Assignments are serialized here so two tabs never give the same placeholder to different values.
let queue = Promise.resolve();
function tokenize(items, site) {
  const run = queue.then(async () => {
    const session = TrellisEngine.createSession();
    for (const e of trellisVaultEntries(await chrome.storage.session.get(null), site)) {
      TrellisEngine.addEntry(session, e.token, e.label, e.value);
    }
    const toStore = {};
    const assigned = items.map(({ label, value }) => {
      const known = session.reverse.size;
      const token = TrellisEngine.placeholderFor(value, label, session);
      if (session.reverse.size > known) toStore[trellisVaultKey(site, token)] = { label, value };
      return { token, label, value };
    });
    if (Object.keys(toStore).length) await chrome.storage.session.set(toStore);
    return assigned;
  });
  queue = run.catch(() => {});
  return run;
}

// For content scripts the site is derived from the sender, never taken from the message: only our own
// content scripts, running in a tab on a configured domain, can get placeholders assigned.
// Extension pages (the workbench) are trusted and name the site they work for, which must be configured.
async function senderSite(sender, requestedSite) {
  if (sender.id !== chrome.runtime.id || !sender.url) return null;
  if (sender.url.startsWith(chrome.runtime.getURL(''))) {
    const { domains } = await trellisGetSettings();
    return domains.includes(requestedSite) ? requestedSite : null;
  }
  if (!sender.tab) return null;
  let host;
  try {
    host = new URL(sender.url).hostname;
  } catch (e) {
    return null;
  }
  const { domains } = await trellisGetSettings();
  return trellisHostMatches(host, domains) ? trellisSiteFor(host, domains) : null;
}

function validItems(items) {
  return Array.isArray(items) && items.length > 0 && items.length <= 1000 && items.every((i) =>
    i && typeof i.label === 'string' && /^[A-Z0-9_]{1,64}$/.test(i.label) &&
    typeof i.value === 'string' && i.value.length > 0 && i.value.length <= 20000);
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return;
  if (msg?.type === 'trellis:ready') {
    accessReady.then(() => sendResponse(true));
    return true;
  }
  if (msg?.type === 'trellis:tokenize') {
    (async () => {
      const site = await senderSite(sender, msg.site);
      if (!site || !validItems(msg.items)) return { error: 'rejected' };
      return { assigned: await tokenize(msg.items, site) };
    })().then(sendResponse, (err) => sendResponse({ error: String(err) }));
    return true;
  }
});
