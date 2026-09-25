// Trellis content script (isolated world):
// 1) Intercepts paste and drop in the capture phase (before the site's editor), obfuscates and inserts the text.
// 2) Checks what you typed before it is sent.
// 3) Shows the original value of placeholders ([EMAIL_1]) without handing it to the page.
// 4) Puts the original values on the clipboard when you copy a response.
//
// Threat model: the chat site itself is untrusted. Original values must never be written anywhere its
// scripts can read (DOM text, events, attributes), and placeholders only resolve on the site that created them.
(() => {
  // When the extension is reloaded or updated, the copy of this script already running in open tabs is
  // orphaned: it can no longer read settings or storage. It must stop touching the page, otherwise its
  // stale behaviour mixes with the new version's. A copy only blocks a new one while it is still alive.
  const alive = () => {
    try {
      return Boolean(chrome.runtime?.id);
    } catch (e) {
      return false;
    }
  };
  if (globalThis.__trellisAlive?.()) return;
  globalThis.__trellisAlive = alive;
  let dead = false;
  // Every listener goes through here, so an orphaned copy ignores all events.
  const on = (target, type, handler, options) =>
    target.addEventListener(type, (e) => {
      if (!dead) handler(e);
    }, options);

  const Engine = globalThis.TrellisEngine;
  const DEFAULTS = globalThis.TRELLIS_DEFAULTS;
  const randomId = () => 'x' + crypto.getRandomValues(new Uint32Array(2)).join('').slice(0, 12);
  let session = Engine.createSession();
  let settings = structuredClone(DEFAULTS);
  let reinjecting = false;

  const settingsReady = chrome.storage.local.get(null).then((stored) => {
    settings = globalThis.trellisMergeSettings(stored);
    vaultChanged();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (dead) return;
    if (area === 'local') {
      for (const [key, { newValue }] of Object.entries(changes)) {
        settings[key] = newValue === undefined ? structuredClone(DEFAULTS[key]) : newValue;
      }
      if (changes.domains) loadVault();
      if (changes.restoreMode || changes.highlightRestored || changes.enabled) vaultChanged();
      if (changes.compiledWordlists || changes.allowlist || changes.rules) {
        if (pendingApply) applyToEditor();
        else scheduleSuggestions(100);
      }
      if (changes.showPanel || changes.enabled) scheduleSuggestions(0);
    } else if (area === 'session') {
      if (changes[CMD_KEY]?.newValue) handlePanelCommand(changes[CMD_KEY].newValue);
      const mine = Object.keys(changes)
        .map((k) => ({ k, parsed: globalThis.trellisParseVaultKey(k) }))
        .filter(({ parsed }) => parsed && parsed.site === currentSite());
      if (!mine.length) return;
      if (mine.some(({ k }) => changes[k].newValue === undefined)) {
        loadVault(); // mappings were deleted: rebuild
        return;
      }
      for (const { k, parsed } of mine) {
        const { label, value } = changes[k].newValue;
        Engine.addEntry(session, parsed.token, label, value);
      }
      vaultChanged();
    }
  });

  function siteActive() {
    return globalThis.trellisHostMatches(location.hostname, settings.domains);
  }

  function currentSite() {
    return globalThis.trellisSiteFor(location.hostname, settings.domains);
  }

  // Only this site's mappings are loaded: other sites' placeholders never resolve here.
  async function loadVault() {
    try {
      await settingsReady;
      await chrome.runtime.sendMessage({ type: 'trellis:ready' }); // wakes the background worker, which opens storage.session
      const fresh = Engine.createSession();
      for (const e of globalThis.trellisVaultEntries(await chrome.storage.session.get(null), currentSite())) {
        Engine.addEntry(fresh, e.token, e.label, e.value);
      }
      session = fresh;
      vaultChanged();
    } catch (e) {
      // Extension context invalidated (e.g. the extension was reloaded): keep the local session.
    }
  }
  loadVault();

  // ================= Paste and drop =================

  // Capturing on window runs before any document or editor listener.
  on(window, 'paste', (e) => {
    if (reinjecting || !e.isTrusted || !settings.enabled || !siteActive()) return;
    const text = e.clipboardData?.getData('text/plain');
    if (!text) return; // images/files are left alone
    lastPasted = text; // kept in this isolated script only, for suggestions
    scheduleSuggestions(300);
    if (obfuscateInto(e.target, text)) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  }, true);

  // Dropped text would reach the page in clear through the event's dataTransfer.
  on(window, 'drop', (e) => {
    if (!e.isTrusted || !settings.enabled || !siteActive()) return;
    const text = e.dataTransfer?.getData('text/plain');
    if (!text) return;
    const matches = Engine.findAll(text, settings);
    if (!matches.length) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const target = editorFor(e.target) || (lastEditor?.isConnected ? lastEditor : null);
    if (!target) {
      showToast('⛔ Drop blocked', summarize(matches), 'The dropped text contains sensitive data. Paste it into the message box instead.');
      return;
    }
    target.focus();
    obfuscateInto(target, text, matches);
  }, true);

  // Obfuscates `text` and inserts it into `target`. Returns false when there is nothing to hide.
  function obfuscateInto(target, text, matches = Engine.findAll(text, settings)) {
    if (!matches.length) return false; // nothing to hide: normal paste (keeps formatting)
    const current = settings;
    const finish = (ok) => {
      // If placeholders could not be assigned, fall back to a mask: the original is never inserted.
      const s = ok ? current : { ...current, mode: 'mask' };
      const result = Engine.obfuscate(text, s, session, matches);
      insertText(target, result.text);
      if (current.showToast || !ok) {
        showToast(
          countTitle(result.count),
          summarize(result.matches),
          ok ? '' : 'Could not assign placeholders (was the extension reloaded?). A mask was used instead; reload the page.'
        );
      }
    };
    const pending = Engine.pendingPlaceholders(matches, current, session);
    if (!pending.length) finish(true);
    else allocate(pending).then(finish);
    return true;
  }

  // The background worker assigns new placeholders (a single allocator shared by all tabs of a site).
  async function allocate(items) {
    try {
      const res = await chrome.runtime.sendMessage({ type: 'trellis:tokenize', items });
      if (!res?.assigned) return false;
      for (const a of res.assigned) Engine.addEntry(session, a.token, a.label, a.value);
      vaultChanged();
      return true;
    } catch (e) {
      return false;
    }
  }

  function insertText(target, text) {
    const el = target instanceof Element ? target : target?.parentElement || document.activeElement;

    // 1) Re-dispatch a synthetic paste carrying the obfuscated text: editors
    //    (ProseMirror on ChatGPT/Claude, Quill on Gemini, Lexical...) handle it as a normal paste.
    const data = new DataTransfer();
    data.setData('text/plain', text);
    const synthetic = new ClipboardEvent('paste', {
      clipboardData: data,
      bubbles: true,
      cancelable: true,
      composed: true
    });
    reinjecting = true;
    try {
      el.dispatchEvent(synthetic);
    } finally {
      reinjecting = false;
    }

    // 2) If nobody handled it (e.g. a plain <textarea>), insert with execCommand, which fires
    //    'input' (React-friendly) and keeps undo working.
    if (!synthetic.defaultPrevented) {
      const active = document.activeElement || el;
      active.focus?.();
      if (!document.execCommand('insertText', false, text) && 'value' in active) {
        const start = active.selectionStart ?? active.value.length;
        const end = active.selectionEnd ?? active.value.length;
        active.setRangeText(text, start, end, 'end');
        active.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }
  }

  // ================= Showing original values =================
  // Hover mode (default): the page keeps the placeholders. Known placeholders are highlighted with the
  // CSS Custom Highlight API (no DOM change) and, on hover, the original is drawn on a <canvas> inside a
  // closed shadow root created from this isolated world. The page's scripts cannot reach a closed root,
  // and canvas pixels are not text: not in innerText, not findable with window.find, not selectable.
  //
  // Inline mode (opt-in): the original replaces the placeholder in the page text. Convenient, but the
  // site's scripts can read it; the compose area and CSS selectors in restoreExclude are skipped.

  const HIGHLIGHT = randomId();
  const SKIP = 'script,style,noscript,textarea,input';
  let restoreRe = null;
  let highlight = null;
  const marks = new Map(); // text node -> [{ range, token }] (hover mode)
  let observer = null;
  let started = false;
  const queued = new Set();
  let flushTimer = null;
  let composerRoots = [];

  // Placeholders are tracked in every mode: 'off' still highlights them (showing what the LLM really
  // received), it just never reveals the original.
  function restoreActive() {
    return !dead && settings.enabled && restoreRe && siteActive() &&
      (settings.restoreMode !== 'off' || settings.highlightRestored);
  }

  function vaultChanged() {
    if (dead) return;
    restoreRe = Engine.buildRestoreRegex(session);
    if (settings.restoreMode !== 'hover') hideTip();
    updatePill();
    if (!restoreActive()) {
      dropHighlight();
      marks.clear();
      hideTip();
      return;
    }
    if (started && document.body) enqueue(document.body);
  }

  // Wait for the page to load so React/Next hydration is not disturbed.
  function ensureStarted() {
    if (observer) return;
    observer = new MutationObserver((mutations) => {
      if (!restoreActive()) return;
      for (const m of mutations) {
        if (m.type === 'characterData') enqueue(m.target);
        else m.addedNodes.forEach(enqueue);
      }
    });
    const start = () =>
      setTimeout(() => {
        started = true;
        observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
        if (document.body) enqueue(document.body);
      }, 1000);
    if (document.readyState === 'complete') start();
    else on(window, 'load', start, { once: true });
  }

  ensureStarted();

  const lifeCheck = setInterval(() => {
    if (!alive()) teardown();
  }, 2000);

  function teardown() {
    if (dead) return;
    dead = true;
    clearInterval(lifeCheck);
    observer?.disconnect();
    queued.clear();
    marks.clear();
    dropHighlight();
    tip?.host.remove();
    toast?.host.remove();
    removePill();
    closePanel();
  }

  function enqueue(node) {
    if (!started) return;
    queued.add(node);
    if (!flushTimer) flushTimer = setTimeout(flush, 30);
  }

  // Container of each editor: its <form>/<fieldset>, or a couple of levels up if there is none.
  function findComposerRoots() {
    const roots = new Set();
    for (const ed of document.querySelectorAll('textarea, [contenteditable]:not([contenteditable="false"])')) {
      let root = ed.closest('form, fieldset');
      if (!root) {
        root = ed;
        for (let i = 0; i < 2 && root.parentElement && root.parentElement !== document.body; i++) root = root.parentElement;
      }
      roots.add(root);
    }
    return [...roots];
  }

  function isExcludedInline(el) {
    if (el.isContentEditable || el.closest(SKIP)) return true;
    if (composerRoots.some((r) => r.contains(el))) return true;
    const custom = (settings.restoreExclude || '').trim();
    if (custom) {
      try {
        if (el.closest(custom)) return true;
      } catch (e) {
        // invalid selector: ignored
      }
    }
    return false;
  }

  // Text is matched per block (paragraph, list item, code block...), not per text node: syntax
  // highlighters split "[NAME_1]" into several nodes ("[", "NAME", "_1", "]").
  const BLOCK = 'p,li,pre,td,th,h1,h2,h3,h4,h5,h6,blockquote,dd,dt,figcaption,summary,div';
  const MAX_BLOCK_TEXT = 200000;

  function blockOf(node) {
    const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    return el ? el.closest(BLOCK) || el : null;
  }

  function flush() {
    flushTimer = null;
    if (!restoreActive()) {
      queued.clear();
      return;
    }
    if (settings.restoreMode === 'inline') composerRoots = findComposerRoots();
    const blocks = new Set();
    for (const node of queued) {
      if (!node.isConnected) continue;
      if (node.nodeType === Node.TEXT_NODE) blocks.add(blockOf(node));
      else if (node.nodeType === Node.ELEMENT_NODE) {
        const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) blocks.add(blockOf(walker.currentNode));
      }
    }
    queued.clear();
    for (const block of blocks) if (block?.isConnected) processBlock(block);
    prune();
    // A placeholder may have appeared under a pointer that is not moving (e.g. a streamed reply).
    if (pointer && settings.restoreMode === 'hover' && marks.size && !hoverFrame) hoverFrame = requestAnimationFrame(checkHover);
  }

  function processBlock(block) {
    // Text nodes that belong to this block (nested blocks are processed on their own).
    const nodes = [];
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) if (blockOf(walker.currentNode) === block) nodes.push(walker.currentNode);
    for (const t of nodes) {
      for (const { range } of marks.get(t) || []) highlight?.delete(range);
      marks.delete(t);
    }

    const inline = settings.restoreMode === 'inline';
    const parts = [];
    let text = '';
    for (const t of nodes) {
      const parent = t.parentElement;
      const skipped = !parent || parent.isContentEditable || parent.closest(SKIP) || (inline && isExcludedInline(parent));
      if (skipped) {
        text += '\n'; // never join text across skipped nodes
        continue;
      }
      parts.push({ node: t, start: text.length, end: text.length + t.nodeValue.length });
      text += t.nodeValue;
    }
    if (text.length < 3 || text.length > MAX_BLOCK_TEXT) return;
    restoreRe.lastIndex = 0;
    if (!restoreRe.test(text)) return;

    // Offset in the joined text -> the part (text node) holding it.
    const locate = (pos, isEnd) => parts.findIndex((p) => (isEnd ? pos > p.start && pos <= p.end : pos >= p.start && pos < p.end));
    const found = [];
    let m;
    restoreRe.lastIndex = 0;
    while ((m = restoreRe.exec(text)) !== null) {
      const token = `[${m[1]}]`;
      if (!session.reverse.has(token)) continue;
      const a = locate(m.index, false);
      const b = locate(m.index + m[0].length, true);
      if (a >= 0 && b >= a) found.push({ token, a, b, start: m.index, end: m.index + m[0].length });
    }
    if (!found.length) return;

    if (inline) {
      restoreInline(parts, found);
      return;
    }
    const withHighlight = settings.highlightRestored && ensureHighlight();
    for (const f of found) {
      const range = new Range();
      range.setStart(parts[f.a].node, f.start - parts[f.a].start);
      range.setEnd(parts[f.b].node, f.end - parts[f.b].start);
      const mark = { range, token: f.token };
      for (let i = f.a; i <= f.b; i++) {
        const node = parts[i].node;
        if (!marks.has(node)) marks.set(node, []);
        marks.get(node).push(mark);
      }
      if (withHighlight) highlight.add(range);
    }
  }

  // Inline mode: writes the original into the first node of each match and removes the rest of the
  // placeholder from the following nodes. Processed from the end so earlier offsets stay valid.
  function restoreInline(parts, found) {
    const withHighlight = settings.highlightRestored && ensureHighlight();
    for (const f of [...found].reverse()) {
      const original = session.reverse.get(f.token);
      const first = parts[f.a];
      const last = parts[f.b];
      const from = f.start - first.start;
      const to = f.end - last.start;
      if (f.a === f.b) {
        first.node.nodeValue = first.node.nodeValue.slice(0, from) + original + first.node.nodeValue.slice(to);
      } else {
        last.node.nodeValue = last.node.nodeValue.slice(to);
        for (let i = f.b - 1; i > f.a; i--) parts[i].node.nodeValue = '';
        first.node.nodeValue = first.node.nodeValue.slice(0, from) + original;
      }
      if (withHighlight) {
        const r = new Range();
        r.setStart(first.node, from);
        r.setEnd(first.node, from + original.length);
        highlight.add(r);
      }
    }
  }

  let highlightSheet = null;
  function dropHighlight() {
    if (!highlight) return;
    highlight.clear();
    CSS.highlights.delete(HIGHLIGHT);
    document.adoptedStyleSheets = document.adoptedStyleSheets.filter((sh) => sh !== highlightSheet);
    highlight = null;
  }

  function ensureHighlight() {
    if (highlight) return true;
    if (!globalThis.CSS?.highlights || typeof Highlight === 'undefined') return false;
    highlight = new Highlight();
    CSS.highlights.set(HIGHLIGHT, highlight);
    const sheet = (highlightSheet = new CSSStyleSheet());
    sheet.replaceSync(
      `::highlight(${HIGHLIGHT}){background-color:rgba(52,211,153,.28);text-decoration:underline dotted rgba(5,150,105,.9);}`
    );
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    return true;
  }

  function prune() {
    for (const [node, list] of marks) {
      if (!node.isConnected) {
        list.forEach(({ range }) => highlight?.delete(range));
        marks.delete(node);
      }
    }
    if (!highlight) return;
    for (const r of highlight) {
      if (r.collapsed || !r.startContainer.isConnected) highlight.delete(r);
    }
  }

  // ---------- Hover tooltip ----------
  let tip = null;
  let hoverFrame = 0;
  let pointer = null;

  on(window, 'mousemove', (e) => {
    pointer = [e.clientX, e.clientY];
    if (!marks.size || settings.restoreMode !== 'hover') return;
    if (!hoverFrame) hoverFrame = requestAnimationFrame(checkHover);
  }, { capture: true, passive: true });
  on(window, 'scroll', hideTip, { capture: true, passive: true });
  on(window, 'blur', hideTip);

  function checkHover() {
    hoverFrame = 0;
    const hit = pointer && markAt(pointer[0], pointer[1]);
    const original = hit && session.reverse.get(hit.token);
    if (original == null) hideTip();
    else showTip(hit.rect, hit.token, original);
  }

  function markAt(x, y) {
    const hitIn = (mark) => {
      for (const rect of mark.range.getClientRects()) {
        if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) return { token: mark.token, rect };
      }
      return null;
    };
    // Fast path: the text node under the pointer.
    const pos = document.caretPositionFromPoint?.(x, y);
    const node = pos ? pos.offsetNode : document.caretRangeFromPoint?.(x, y)?.startContainer;
    for (const mark of (node && marks.get(node)) || []) {
      const hit = hitIn(mark);
      if (hit) return hit;
    }
    // Fallback (e.g. code blocks where caret hit-testing is unreliable): check every mark.
    if (marks.size > 5000) return null;
    const seen = new Set();
    for (const list of marks.values()) {
      for (const mark of list) {
        if (seen.has(mark)) continue;
        seen.add(mark);
        const hit = hitIn(mark);
        if (hit) return hit;
      }
    }
    return null;
  }

  function ensureTip() {
    if (tip?.host.isConnected) return tip;
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;display:none;';
    const root = host.attachShadow({ mode: 'closed' });
    const canvas = document.createElement('canvas');
    canvas.setAttribute('role', 'tooltip');
    root.append(canvas);
    document.documentElement.append(host);
    tip = { host, canvas, token: null, width: 0, height: 0 };
    return tip;
  }

  function showTip(rect, token, original) {
    const t = ensureTip();
    if (t.token !== token) {
      drawTip(t, token, original);
      t.token = token;
    }
    const left = Math.max(4, Math.min(rect.left, innerWidth - t.width - 4));
    const above = rect.top - t.height - 6;
    const top = above >= 4 ? above : rect.bottom + 6;
    t.host.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
    t.host.style.display = 'block';
  }

  // The tooltip only exists in the DOM while it is shown.
  function hideTip() {
    tip?.host.remove();
    tip = null;
  }

  // The width is rounded up so the tooltip's size says little about the value's length.
  function drawTip(t, token, original) {
    const text = original.replace(/\s*\n\s*/g, ' ⏎ ').slice(0, 160) + (original.length > 160 ? '…' : '');
    const font = '13px system-ui, -apple-system, "Segoe UI", sans-serif';
    const small = '10px system-ui, -apple-system, "Segoe UI", sans-serif';
    const ctx = t.canvas.getContext('2d');
    ctx.font = font;
    const textWidth = ctx.measureText(text).width;
    ctx.font = small;
    const labelWidth = ctx.measureText(token).width;
    const width = Math.min(640, Math.ceil((Math.max(textWidth, labelWidth) + 24) / 48) * 48);
    const height = 40;
    const dpr = devicePixelRatio || 1;
    t.canvas.width = Math.round(width * dpr);
    t.canvas.height = Math.round(height * dpr);
    t.canvas.style.width = width + 'px';
    t.canvas.style.height = height + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#1f2937';
    ctx.beginPath();
    ctx.roundRect(0, 0, width, height, 7);
    ctx.fill();
    ctx.textBaseline = 'alphabetic';
    ctx.font = small;
    ctx.fillStyle = '#34d399';
    ctx.fillText(token, 12, 14, width - 24);
    ctx.font = font;
    ctx.fillStyle = '#f9fafb';
    ctx.fillText(text, 12, 31, width - 24);
    // For assistive technology. The page cannot read the accessibility tree nor this closed root.
    t.canvas.setAttribute('aria-label', `${token}: ${original}`);
    t.width = width;
    t.height = height;
  }

  // ================= Copying with the original values =================
  // Only the isolated world (this script) knows the originals; the page only ever sees placeholders.

  let copying = null; // data to write during our own execCommand('copy')

  function copyActive() {
    return settings.enabled && settings.restoreOnCopy && restoreRe && siteActive();
  }

  // If this site may read the clipboard (the user granted it clipboard-read at some point), originals put on
  // the clipboard here could be read by its scripts while the tab has focus: copy the placeholders instead.
  let siteReadsClipboard = false;
  navigator.permissions?.query({ name: 'clipboard-read' }).then((status) => {
    const update = () => {
      siteReadsClipboard = status.state === 'granted';
    };
    update();
    status.onchange = update;
  }).catch(() => {});

  function clipboardBlocked() {
    if (!siteReadsClipboard) return false;
    showToast('📋 Copied with placeholders', '',
      'This site is allowed to read your clipboard, so Trellis did not copy the original values. ' +
      'Use the Trellis workbench, or remove the site\'s clipboard permission (padlock icon → Site settings).', 9000);
    return true;
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }

  // Writes to the clipboard from the isolated world, without touching the page DOM.
  function writeClipboard(text, html) {
    copying = { text, html };
    try {
      return document.execCommand('copy');
    } catch (e) {
      return false;
    } finally {
      copying = null;
    }
  }

  on(window, 'copy', (e) => {
    if (copying) {
      e.preventDefault();
      e.stopImmediatePropagation();
      e.clipboardData.setData('text/plain', copying.text);
      if (copying.html) e.clipboardData.setData('text/html', copying.html);
      return;
    }
    if (!e.isTrusted || !copyActive()) return;

    // Manual copy (Ctrl+C / context menu) of selected text.
    let text;
    let html = null;
    const active = document.activeElement;
    if (active && (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT')) {
      // A visible text box is where the user writes: leave it alone. Hidden ones are the helpers that
      // sites create for their "Copy" buttons (e.g. on code blocks), so those are restored.
      if (isVisible(active)) return;
      text = active.value.slice(active.selectionStart ?? 0, active.selectionEnd ?? 0);
    } else {
      if (active?.isContentEditable) return;
      const sel = document.getSelection();
      if (!sel || sel.isCollapsed) return;
      text = sel.toString();
      const box = document.createElement('div'); // detached: invisible to the page
      for (let i = 0; i < sel.rangeCount; i++) box.append(sel.getRangeAt(i).cloneContents());
      html = box.innerHTML;
    }
    const rText = Engine.restore(text, session, restoreRe);
    const rHtml = html == null ? null : Engine.restore(html, session, restoreRe, escapeHtml);
    if (rText === text && rHtml === html) return;
    if (clipboardBlocked()) return;

    e.preventDefault();
    e.stopImmediatePropagation();
    e.clipboardData.setData('text/plain', rText);
    if (rHtml != null) e.clipboardData.setData('text/html', rHtml);
  }, true);

  // The site's "Copy" buttons (via clipboard-main.js). The page can dispatch this event itself, so it is
  // only honoured right after a real click or key press by the user, and only with this site's placeholders.
  on(document, 'trellis:clipboard', (e) => {
    if (!copyActive() || !navigator.userActivation?.isActive) return;
    let data;
    try {
      data = JSON.parse(e.detail);
    } catch (err) {
      return;
    }
    const text = Engine.restore(String(data.text ?? ''), session, restoreRe);
    const html = data.html == null ? null : Engine.restore(String(data.html), session, restoreRe, escapeHtml);
    if (text === data.text && html === (data.html ?? null)) return;
    if (clipboardBlocked()) return;
    // If we cannot write, the site copies its placeholder version (the copy is never lost).
    if (writeClipboard(text, html)) e.preventDefault();
  });

  // ================= Check before sending =================
  // Covers typed text: on Enter or the Send button, if the compose box contains anything matching the
  // rules, lists or memory, sending is cancelled and it is obfuscated in the editor itself (or only
  // blocked, depending on the setting). The user reviews it and sends again.
  // Note: the site receives every keystroke as it is typed, so this is a safety net, not a guarantee.

  // Send buttons, including localized UIs (send / enviar / envoyer / senden / invia / wyślij / отправ...).
  const SEND_BUTTON = [
    '[data-testid="send-button"]',
    ...['send', 'enviar', 'envoyer', 'senden', 'invia', 'verstuur', 'wyślij', 'отправ', '送信', '发送', '傳送', '전송']
      .map((w) => `button[aria-label*="${w}" i]`),
    'button[type="submit"]'
  ].join(',');
  let lastEditor = null;
  let fixing = false;

  function presendActive() {
    return settings.enabled && settings.presend && settings.presend !== 'off' && siteActive();
  }

  function editorFor(node) {
    const el = node instanceof Element ? node : node?.parentElement;
    if (!el) return null;
    if (el.tagName === 'TEXTAREA') return el;
    if (!el.isContentEditable) return null;
    let host = el;
    while (host.parentElement?.isContentEditable) host = host.parentElement;
    return host;
  }

  function editorText(ed) {
    return ed.tagName === 'TEXTAREA' ? ed.value : ed.innerText;
  }

  function composerForButton(btn) {
    const root = btn.closest('form, fieldset');
    const ed = root?.querySelector('textarea, [contenteditable]:not([contenteditable="false"])');
    return (ed && editorFor(ed)) || (lastEditor?.isConnected ? lastEditor : null);
  }

  // Hidden text boxes (copy helpers, offscreen inputs) are not where the user writes.
  function isVisible(el) {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2 || r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) return false;
    const style = getComputedStyle(el);
    return style.visibility !== 'hidden' && Number(style.opacity) > 0.05;
  }

  on(document, 'focusin', (e) => {
    const ed = editorFor(e.target);
    if (ed && isVisible(ed)) lastEditor = ed;
  }, true);

  // Early warning while typing: the site receives every keystroke, so tell the user as soon as something
  // sensitive is typed instead of waiting for Send. Each value is only reported once.
  const warned = new Set();
  let typingTimer = null;
  on(document, 'input', (e) => {
    if (!e.isTrusted || !settings.enabled || !settings.typingWarning || !siteActive()) return;
    const ed = editorFor(e.target);
    if (!ed) return;
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => {
      const fresh = Engine.findAll(editorText(ed), settings).filter((m) => {
        const key = Engine.labelFor(m.rule) + '\u0000' + Engine.normalizeTerm(m.value);
        if (warned.has(key)) return false;
        warned.add(key);
        return true;
      });
      if (!fresh.length) return;
      showToast('⚠ Sensitive data typed', summarize(fresh),
        'The site sees what you type as you type it. Trellis will obfuscate it when you send, ' +
        'but pasting (or the Trellis workbench) is safer.', 8000);
    }, 500);
  }, true);

  function afterSend() {
    lastPasted = '';
    scheduleSuggestions(800);
  }

  // Returns true when sending must be cancelled.
  function checkBeforeSend(ed) {
    if (!ed) return false;
    if (fixing) return true;
    const matches = Engine.findAll(editorText(ed), settings);
    if (!matches.length) return false;
    if (settings.presend === 'block') {
      showToast('⛔ Sending blocked', summarize(matches), 'The message contains sensitive data. Edit it, or change the send check in Settings.');
      return true;
    }
    fixing = true;
    fixEditor(ed, matches).finally(() => {
      fixing = false;
    });
    return true;
  }

  function cancel(e) {
    e.preventDefault();
    e.stopImmediatePropagation();
  }

  on(window, 'keydown', (e) => {
    if (!e.isTrusted || e.key !== 'Enter' || e.shiftKey || e.altKey || e.isComposing) return;
    if (!presendActive()) return;
    if (checkBeforeSend(editorFor(e.target))) cancel(e);
    else if (editorFor(e.target)) afterSend();
  }, true);

  // Some sites send on pointerdown/mousedown and others on click: watch all three.
  for (const type of ['pointerdown', 'mousedown', 'click']) {
    on(window, type, (e) => {
      if (!e.isTrusted || !presendActive()) return;
      const btn = e.target instanceof Element ? e.target.closest(SEND_BUTTON) : null;
      if (!btn) return;
      if (checkBeforeSend(composerForButton(btn))) cancel(e);
      else if (type === 'click') afterSend();
    }, true);
  }

  on(window, 'submit', (e) => {
    if (!presendActive()) return;
    const ed = e.target.querySelector?.('textarea, [contenteditable]:not([contenteditable="false"])');
    if (checkBeforeSend(ed ? editorFor(ed) : lastEditor)) cancel(e);
  }, true);

  async function fixEditor(ed, matches) {
    const pending = Engine.pendingPlaceholders(matches, settings, session);
    const ok = pending.length ? await allocate(pending) : true;
    const s = ok ? settings : { ...settings, mode: 'mask' };
    const replaced = ed.tagName === 'TEXTAREA' ? fixTextarea(ed, s) : fixContentEditable(ed, s);
    const remaining = Engine.findAll(editorText(ed), s);
    if (remaining.length) {
      showToast('⛔ Sending blocked', summarize(remaining),
        'Not everything could be obfuscated automatically (e.g. mixed formatting). Edit it by hand before sending.', 8000);
    } else {
      showToast(countTitle(replaced) + ' before sending', summarize(matches),
        'Review the message and press Send again.', 6000);
    }
  }

  function fixTextarea(ta, s) {
    ta.focus();
    const current = Engine.findAll(ta.value, s);
    for (const m of [...current].reverse()) {
      const repl = Engine.replacementFor(m, s, session);
      ta.setSelectionRange(m.start, m.end);
      if (!document.execCommand('insertText', false, repl)) {
        ta.setRangeText(repl, m.start, m.end, 'end');
        ta.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }
    ta.setSelectionRange(ta.value.length, ta.value.length);
    return current.length;
  }

  // Replaces one match at a time by selecting it and inserting the placeholder with execCommand, which
  // editors (ProseMirror, Lexical, Quill...) treat as a normal edit, keeping the formatting.
  function fixContentEditable(ed, s) {
    ed.focus();
    const sel = document.getSelection();
    let count = 0;
    for (let guard = 0; guard < 500; guard++) {
      const hit = firstHit(ed, s);
      if (!hit) break;
      const repl = Engine.replacementFor(hit.match, s, session);
      if (Engine.findAll(repl, s).length) break; // the replacement would match again: avoid looping
      const range = document.createRange();
      range.setStart(hit.node, hit.match.start);
      range.setEnd(hit.node, hit.match.end);
      sel.removeAllRanges();
      sel.addRange(range);
      if (!document.execCommand('insertText', false, repl)) break;
      count++;
    }
    const end = document.createRange();
    end.selectNodeContents(ed);
    end.collapse(false);
    sel.removeAllRanges();
    sel.addRange(end);
    return count;
  }

  function firstHit(ed, s) {
    const walker = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const [match] = Engine.findAll(node.nodeValue, s);
      if (match) return { node, match };
    }
    return null;
  }

  // ================= In-page panel =================
  // A small floating button, present only while Trellis has something to show on this page, opens a panel
  // with this site's placeholders, suggestions (things that look sensitive but matched nothing) and a quick
  // "add to memory". The panel is an extension page in an <iframe>: cross-origin, so the page cannot read it,
  // placed inside a closed shadow root and only created while open. The panel and this script talk through
  // chrome.storage.session keys, never through the page (no postMessage, no DOM events).

  const panelId = randomId();
  const PANEL_KEY = `trellis:panel:${panelId}`;
  const CMD_KEY = `trellis:cmd:${panelId}`;
  let pill = null;
  let panel = null;
  let suggestions = [];
  const dismissed = new Set();
  let lastPasted = '';
  let pendingApply = false;
  let suggestTimer = null;

  function panelActive() {
    return !dead && settings.enabled && settings.showPanel && siteActive();
  }

  function refreshSuggestions() {
    if (!panelActive()) {
      removePill();
      closePanel();
      return;
    }
    const ed = lastEditor?.isConnected ? lastEditor : null;
    const text = [lastPasted, ed ? editorText(ed) : ''].filter(Boolean).join('\n');
    suggestions = text ? Engine.suggest(text, settings, [...dismissed]) : [];
    publishPanelState();
    updatePill();
  }

  function scheduleSuggestions(delay = 600) {
    clearTimeout(suggestTimer);
    suggestTimer = setTimeout(refreshSuggestions, delay);
  }

  function publishPanelState() {
    if (!panel) return;
    chrome.storage.session.set({ [PANEL_KEY]: { site: currentSite(), suggestions, at: Date.now() } }).catch(() => {});
  }

  function updatePill() {
    const placeholders = session.reverse.size;
    if (!panelActive() || (!placeholders && !suggestions.length && !panel)) {
      removePill();
      return;
    }
    if (!pill?.host.isConnected) {
      const host = document.createElement('div');
      host.style.cssText = 'position:fixed;z-index:2147483647;bottom:20px;right:20px;width:72px;height:32px;cursor:pointer;';
      const root = host.attachShadow({ mode: 'closed' });
      const canvas = document.createElement('canvas');
      canvas.setAttribute('role', 'button');
      root.append(canvas);
      host.addEventListener('click', (e) => {
        if (!e.isTrusted) return;
        e.stopPropagation();
        togglePanel();
      });
      document.documentElement.append(host);
      pill = { host, canvas, key: '' };
    }
    const key = `${placeholders}|${suggestions.length}|${!!panel}`;
    if (pill.key !== key) drawPill(pill.canvas, placeholders, suggestions.length, !!panel);
    pill.key = key;
  }

  // Drawn on a canvas: no text in the DOM that the page could find.
  function drawPill(canvas, placeholders, pending, open) {
    const dpr = devicePixelRatio || 1;
    const w = 72;
    const h = 32;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.cssText = `width:${w}px;height:${h}px;display:block;`;
    canvas.setAttribute('aria-label', `Trellis: ${placeholders} placeholders, ${pending} suggestions`);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = open ? '#065f46' : '#1f2937';
    ctx.beginPath();
    ctx.roundRect(0, 0, w, h, 16);
    ctx.fill();
    ctx.font = '14px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#f9fafb';
    ctx.fillText(`🔒 ${placeholders}`, 10, h / 2 + 1);
    if (pending) {
      ctx.fillStyle = '#f59e0b';
      ctx.beginPath();
      ctx.arc(w - 14, h / 2, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#111827';
      ctx.font = 'bold 11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(String(Math.min(pending, 99)), w - 14, h / 2 + 1);
    }
  }

  function removePill() {
    pill?.host.remove();
    pill = null;
  }

  function togglePanel() {
    if (panel) closePanel();
    else openPanel();
  }

  function openPanel() {
    if (panel || !panelActive()) return;
    refreshSuggestions();
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;z-index:2147483647;bottom:60px;right:20px;width:380px;height:min(540px,calc(100vh - 90px));' +
      'border-radius:12px;box-shadow:0 12px 32px rgba(0,0,0,.35);overflow:hidden;';
    const root = host.attachShadow({ mode: 'closed' });
    const frame = document.createElement('iframe');
    frame.style.cssText = 'border:0;width:100%;height:100%;display:block;color-scheme:normal;';
    frame.src = chrome.runtime.getURL('panel.html') + '#' + panelId;
    root.append(frame);
    document.documentElement.append(host);
    panel = { host };
    publishPanelState();
    updatePill();
  }

  function closePanel() {
    if (!panel) return;
    panel.host.remove();
    panel = null;
    chrome.storage.session.remove([PANEL_KEY, CMD_KEY]).catch(() => {});
    updatePill();
  }

  // Commands written by the panel.
  function handlePanelCommand(msg) {
    if (!msg || dead) return;
    if (msg.cmd === 'close') closePanel();
    else if (msg.cmd === 'dismiss') {
      dismissed.add(msg.value);
      refreshSuggestions();
    } else if (msg.cmd === 'apply') {
      // Memory or allowlist changed: once the lists are recompiled, re-check the message box.
      pendingApply = true;
      setTimeout(applyToEditor, 1200);
    } else if (msg.cmd === 'revert') {
      revertInEditor(msg.token);
      refreshSuggestions();
    }
  }

  async function applyToEditor() {
    pendingApply = false;
    const ed = lastEditor?.isConnected ? lastEditor : null;
    if (ed) {
      const matches = Engine.findAll(editorText(ed), settings);
      if (matches.length && !fixing) {
        fixing = true;
        try {
          await fixEditor(ed, matches);
        } finally {
          fixing = false;
        }
      }
    }
    refreshSuggestions();
  }

  // "Never obfuscate": puts the original value back where the placeholder is in the message box.
  function revertInEditor(token) {
    const original = session.reverse.get(token);
    const ed = lastEditor?.isConnected ? lastEditor : null;
    if (original == null || !ed) return;
    ed.focus();
    if (ed.tagName === 'TEXTAREA') {
      for (let i = ed.value.lastIndexOf(token); i >= 0; i = ed.value.lastIndexOf(token, i - 1)) {
        ed.setSelectionRange(i, i + token.length);
        document.execCommand('insertText', false, original);
        if (i === 0) break;
      }
      return;
    }
    const sel = document.getSelection();
    for (let guard = 0; guard < 200; guard++) {
      const walker = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT);
      let hit = null;
      while (!hit && walker.nextNode()) {
        const i = walker.currentNode.nodeValue.indexOf(token);
        if (i >= 0) hit = { node: walker.currentNode, i };
      }
      if (!hit) break;
      const range = document.createRange();
      range.setStart(hit.node, hit.i);
      range.setEnd(hit.node, hit.i + token.length);
      sel.removeAllRanges();
      sel.addRange(range);
      if (!document.execCommand('insertText', false, original)) break;
    }
  }

  // Keep suggestions current while the user writes.
  on(document, 'input', (e) => {
    if (!e.isTrusted || !editorFor(e.target)) return;
    const ed = editorFor(e.target);
    if (!editorText(ed).trim()) lastPasted = '';
    scheduleSuggestions();
  }, true);

  // ================= Toast =================

  function countTitle(n) {
    return `🔒 ${n} item${n === 1 ? '' : 's'} obfuscated`;
  }

  // Rule names and counts only, never originals.
  function summarize(matches) {
    const byRule = {};
    for (const m of matches) {
      // Matches from findAll carry the rule object; results of obfuscate() carry its name.
      const name = typeof m.rule === 'string' ? m.rule : m.rule.name || Engine.labelFor(m.rule);
      byRule[name] = (byRule[name] || 0) + 1;
    }
    return Object.entries(byRule)
      .map(([r, n]) => `${r} ×${n}`)
      .join(', ');
  }

  let toast = null;
  let toastTimer = null;
  function showToast(title, detail, warning = '', ms = 0) {
    if (!toast?.host.isConnected) {
      const host = document.createElement('div');
      host.style.cssText = 'position:fixed;z-index:2147483647;bottom:64px;right:20px;pointer-events:none;';
      const root = host.attachShadow({ mode: 'closed' });
      root.innerHTML = `
        <style>
          .t{font:13px/1.4 system-ui,sans-serif;background:#1f2937;color:#f9fafb;padding:10px 14px;
             border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.3);max-width:380px;
             opacity:0;transform:translateY(8px);transition:opacity .2s,transform .2s}
          .t.show{opacity:1;transform:none}
          b{color:#34d399}
          .warn{color:#fbbf24}
        </style>
        <div class="t"></div>`;
      (document.body || document.documentElement).appendChild(host);
      toast = { host, box: root.querySelector('.t') };
    }
    const box = toast.box;
    box.replaceChildren();
    const b = document.createElement('b');
    b.textContent = title;
    box.append(b);
    if (detail) {
      const d = document.createElement('div');
      d.textContent = detail;
      box.append(d);
    }
    if (warning) {
      const w = document.createElement('div');
      w.className = 'warn';
      w.textContent = warning;
      box.append(w);
    }
    box.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      box.classList.remove('show');
      // The notice only exists in the DOM while it is shown.
      toastTimer = setTimeout(() => {
        toast?.host.remove();
        toast = null;
      }, 300);
    }, ms || (warning ? 6000 : 3000));
  }
})();
