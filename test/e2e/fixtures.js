// Playwright fixtures: a fresh Chromium profile with Trellis loaded for every test.
// Chat sites are never contacted: requests to their domains are answered with the mock pages in pages.js.
const path = require('node:path');
const { test: base, chromium, expect } = require('@playwright/test');
const pages = require('./pages');

const EXTENSION = path.join(__dirname, '..', '..');
const READER = 'https://clipboard-reader.test';

const test = base.extend({
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium', // the full build; the headless shell cannot load extensions
      args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`]
    });
    // Chat sites may write to the clipboard but not read it (Trellis refuses to copy originals on sites that
    // can read the clipboard). Tests check the clipboard from a separate "reader" origin.
    for (const origin of ['https://claude.ai', 'https://chatgpt.com', 'https://example.org']) {
      await context.grantPermissions(['clipboard-write'], { origin });
    }
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: READER });
    await context.route(`${READER}/**`, (r) => r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>reader</title>' }));
    await context.route('https://claude.ai/**', (r) => r.fulfill({ contentType: 'text/html', body: pages.claude }));
    await context.route('https://chatgpt.com/**', (r) => r.fulfill({ contentType: 'text/html', body: pages.chatgpt }));
    await context.route('https://example.org/**', (r) => r.fulfill({ contentType: 'text/html', body: pages.chatgpt }));
    await use(context);
    await context.close();
  },

  // The extension's background service worker, with the word lists already compiled.
  serviceWorker: async ({ context }, use) => {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent('serviceworker');
    await expect
      .poll(() => worker.evaluate(async () => (await chrome.storage.local.get('compiledWordlists')).compiledWordlists?.length ?? 0))
      .toBeGreaterThan(0);
    await use(worker);
  },

  extensionId: async ({ serviceWorker }, use) => {
    await use(serviceWorker.url().split('/')[2]);
  },

  // Opens a mock chat page and waits until Trellis is running in it.
  openChat: async ({ context, serviceWorker }, use) => {
    await use(async (url) => {
      const page = await context.newPage();
      page.errors = [];
      page.on('pageerror', (e) => page.errors.push(e.message));
      await page.goto(url);
      await page.waitForLoadState('load');
      return page;
    });
  }
});

// Puts text on the system clipboard and pastes it with a real Ctrl+V into the given element.
async function pasteInto(page, selector, text) {
  await page.evaluate((t) => navigator.clipboard.writeText(t), text);
  await page.click(selector);
  await page.keyboard.press('ControlOrMeta+V');
}

// Reads the clipboard from the reader page (the only origin allowed to), then gives the focus back.
async function readClipboardAs(page, kind) {
  const context = page.context();
  let reader = context.pages().find((p) => p.url().startsWith(READER));
  if (!reader) {
    reader = await context.newPage();
    await reader.goto(READER + '/');
  }
  await reader.bringToFront();
  const value = await reader.evaluate(async (k) => {
    if (k === 'text') return navigator.clipboard.readText();
    const [item] = await navigator.clipboard.read();
    return item.types.includes('text/html') ? (await item.getType('text/html')).text() : null;
  }, kind);
  await page.bringToFront();
  return value;
}
const readClipboard = (page) => readClipboardAs(page, 'text');
const readClipboardHtml = (page) => readClipboardAs(page, 'html');

// Moves the mouse over the first occurrence of `text` (within `root`, a CSS selector) in the page.
async function hoverText(page, text, root = 'body') {
  const point = await page.evaluate(([needle, rootSelector]) => {
    const walker = document.createTreeWalker(document.querySelector(rootSelector), NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const i = walker.currentNode.nodeValue.indexOf(needle);
      if (i < 0) continue;
      const range = document.createRange();
      range.setStart(walker.currentNode, i);
      range.setEnd(walker.currentNode, i + needle.length);
      const r = range.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }
    return null;
  }, [text, root]);
  if (!point) throw new Error(`text not found: ${text}`);
  await page.mouse.move(point.x, point.y);
}

// The label of Trellis' hover tooltip, or null when it is hidden. It lives in a closed shadow root that
// page scripts cannot reach; the DevTools protocol can (pierce: true), so tests read it that way.
async function tooltip(page) {
  const cdp = await page.context().newCDPSession(page);
  try {
    const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
    const attrs = (n) => Object.fromEntries((n.attributes || []).reduce((acc, v, i, a) => (i % 2 ? acc : [...acc, [v, a[i + 1]]]), []));
    let label = null;
    const walk = (node, host) => {
      if (node.nodeName === 'CANVAS' && attrs(node).role === 'tooltip') {
        if (/display:\s*block/.test(attrs(host || {}).style || '')) label = attrs(node)['aria-label'];
      }
      for (const child of [...(node.children || []), ...(node.shadowRoots || [])]) {
        walk(child, node.shadowRoots?.includes(child) ? node : host);
      }
    };
    walk(root, null);
    return label;
  } finally {
    await cdp.detach();
  }
}

// Text inside Trellis' closed shadow roots (the notice), read through the DevTools protocol.
async function closedShadowText(page) {
  const cdp = await page.context().newCDPSession(page);
  try {
    const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
    const out = [];
    const walk = (node, inShadow) => {
      if (inShadow && node.nodeType === 3) out.push(node.nodeValue);
      for (const child of node.children || []) walk(child, inShadow);
      for (const shadow of node.shadowRoots || []) walk(shadow, true);
    };
    walk(root, false);
    return out.join(' ').replace(/\s+/g, ' ');
  } finally {
    await cdp.detach();
  }
}

// Total number of highlighted ranges (placeholders with a known original).
const highlightCount = (page) => page.evaluate(() => [...CSS.highlights.values()].reduce((n, h) => n + h.size, 0));

module.exports = { test, expect, pasteInto, readClipboard, readClipboardHtml, hoverText, tooltip, highlightCount, closedShadowText };
