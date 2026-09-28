// Chrome runs this file as a service worker and loads the shared scripts here; Firefox runs it as an event page
// with the shared scripts listed before it in the manifest.
if (typeof importScripts === 'function') importScripts('defaults.js', 'obfuscator.js');

const SCRIPT_ID = 'trellis-content';
const SCRIPT_FILES = ['defaults.js', 'obfuscator.js', 'content.js'];
// Page-world scripts: the bridge for the site's own "Copy" buttons and the network backstop. They never
// receive rules, memory or original values.
const MAIN_SCRIPT_ID = 'trellis-page';
const MAIN_SCRIPT_FILES = ['clipboard-main.js', 'egress-main.js'];

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

chrome.runtime.onInstalled.addListener(async (details) => {
  // First install: explain what Trellis reads and that nothing leaves the browser.
  if (details.reason === 'install') chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html') });
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
// Mappings live in storage.session, which only extension pages and this worker can read. Content scripts never
// access it directly (it is not available to them in every browser): they ask here for their own site's entries,
// and are told when those change. A tab therefore only ever receives the mappings of its own site.

async function vaultFor(site) {
  return trellisVaultEntries(await chrome.storage.session.get(null), site);
}

// Tells the content scripts of the configured sites that mappings changed, so they reload theirs.
async function broadcastVaultChanged() {
  const { domains } = await trellisGetSettings();
  const tabs = await chrome.tabs.query({ url: domains.map(trellisDomainToPattern) }).catch(() => []);
  for (const tab of tabs) chrome.tabs.sendMessage(tab.id, { type: 'trellis:vault-changed' }).catch(() => {});
}

// In-page panel: the panel (an extension page) and the content script of its tab talk through here.
// State from the content script is stored for the panel; commands written by the panel are forwarded to the tab.
const PANEL_PREFIX = 'trellis:panel:';
const CMD_PREFIX = 'trellis:cmd:';
const PANEL_TAB_PREFIX = 'trellis:panel-tab:';

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'session') return;
  const keys = Object.keys(changes);
  if (keys.some((k) => trellisParseVaultKey(k))) broadcastVaultChanged();
  for (const key of keys.filter((k) => k.startsWith(CMD_PREFIX) && changes[k].newValue)) {
    const panelId = key.slice(CMD_PREFIX.length);
    const where = (await chrome.storage.session.get(PANEL_TAB_PREFIX + panelId))[PANEL_TAB_PREFIX + panelId];
    if (where) {
      chrome.tabs.sendMessage(where.tabId, { type: 'trellis:panel-cmd', panelId, cmd: changes[key].newValue }, { frameId: where.frameId })
        .catch(() => {});
    }
  }
});

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
  if (msg?.type === 'trellis:vault') {
    senderSite(sender).then(async (site) => sendResponse({ entries: site ? await vaultFor(site) : [] }), () => sendResponse({ entries: [] }));
    return true;
  }
  if (msg?.type === 'trellis:panel-state' || msg?.type === 'trellis:panel-close') {
    (async () => {
      const id = String(msg.panelId || '');
      if (!/^x\d{1,12}$/.test(id) || !sender.tab || !(await senderSite(sender))) return;
      if (msg.type === 'trellis:panel-close') {
        await chrome.storage.session.remove([PANEL_PREFIX + id, CMD_PREFIX + id, PANEL_TAB_PREFIX + id]);
        return;
      }
      await chrome.storage.session.set({
        [PANEL_PREFIX + id]: msg.state,
        [PANEL_TAB_PREFIX + id]: { tabId: sender.tab.id, frameId: sender.frameId || 0 }
      });
    })().then(() => sendResponse(true), () => sendResponse(false));
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
