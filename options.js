const Engine = globalThis.TrellisEngine;
const $ = (sel) => document.querySelector(sel);

let state = null;
let dirty = false;

// Keys saved with the Save button (domains are saved immediately because they involve permissions).
const SAVED_KEYS = [
  'enabled', 'mode', 'maskText', 'showToast', 'restoreMode', 'highlightRestored', 'restoreOnCopy',
  'restoreExclude', 'presend', 'typingWarning', 'showPanel', 'rules', 'wordlists', 'exceptionsExtra', 'allowlist'
];
// Memory and domains are saved immediately, but are included in export/import.
const EXPORT_KEYS = [...SAVED_KEYS, 'domains', 'memory', 'memoryCategories'];
const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => k in obj).map((k) => [k, obj[k]]));

function uid() {
  return 'r-' + Math.random().toString(36).slice(2, 10);
}

function setStatus(msg, isError = false) {
  const el = $('#status');
  el.textContent = msg;
  el.classList.toggle('error', isError);
}

function markDirty() {
  dirty = true;
  setStatus('Unsaved changes');
  runTest();
}

// ---------- General ----------
function renderGeneral() {
  $('#enabled').checked = state.enabled;
  $('#showToast').checked = state.showToast;
  $('#restoreMode').value = state.restoreMode;
  showInlineOptions();
  $('#highlightRestored').checked = state.highlightRestored;
  $('#restoreOnCopy').checked = state.restoreOnCopy;
  $('#typingWarning').checked = state.typingWarning;
  $('#showPanel').checked = state.showPanel;
  $('#presend').value = state.presend;
  $('#restoreExclude').value = state.restoreExclude;
  $('#mode').value = state.mode;
  $('#maskText').value = state.maskText;
  $('#maskText').hidden = state.mode !== 'mask';
}

for (const id of ['enabled', 'showToast', 'typingWarning', 'showPanel', 'highlightRestored', 'restoreOnCopy']) {
  $('#' + id).addEventListener('change', (e) => {
    state[id] = e.target.checked;
    markDirty();
  });
}
$('#mode').addEventListener('change', (e) => {
  state.mode = e.target.value;
  $('#maskText').hidden = state.mode !== 'mask';
  markDirty();
});
function showInlineOptions() {
  const inline = state.restoreMode === 'inline';
  $('#inlineWarning').hidden = !inline;
  $('#restoreExcludeRow').hidden = !inline;
}
$('#restoreMode').addEventListener('change', (e) => {
  state.restoreMode = e.target.value;
  showInlineOptions();
  markDirty();
});
$('#presend').addEventListener('change', (e) => {
  state.presend = e.target.value;
  markDirty();
});
$('#restoreExclude').addEventListener('input', (e) => {
  state.restoreExclude = e.target.value;
  let ok = true;
  try {
    if (e.target.value.trim()) document.querySelector(e.target.value);
  } catch (err) {
    ok = false;
  }
  e.target.classList.toggle('invalid', !ok);
  markDirty();
});
$('#maskText').addEventListener('input', (e) => {
  state.maskText = e.target.value;
  markDirty();
});

// ---------- Rules ----------
function el(tag, props = {}, children = []) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function renderRules() {
  const tbody = $('#rules tbody');
  tbody.innerHTML = '';
  state.rules.forEach((rule, i) => tbody.append(ruleRow(rule, i)));
}

function ruleRow(rule, index) {
  const update = (patch) => {
    Object.assign(rule, patch);
    validate();
    markDirty();
  };

  const enabled = el('input', { type: 'checkbox', checked: rule.enabled });
  enabled.addEventListener('change', () => update({ enabled: enabled.checked }));

  const name = el('input', { type: 'text', className: 'name', value: rule.name || '' });
  name.addEventListener('input', () => update({ name: name.value }));

  const type = el('select', {}, [
    el('option', { value: 'keyword', textContent: 'Keywords' }),
    el('option', { value: 'regex', textContent: 'Regex' })
  ]);
  type.value = rule.type;
  type.addEventListener('change', () => {
    update({ type: type.value });
    renderRules();
  });

  const pattern = el(rule.type === 'keyword' ? 'textarea' : 'input', {
    className: 'pattern',
    value: rule.pattern || '',
    placeholder: rule.type === 'keyword' ? 'acme, project x, client' : '\\bpattern\\b'
  });
  if (rule.type === 'keyword') pattern.rows = 2;
  else pattern.type = 'text';
  pattern.addEventListener('input', () => update({ pattern: pattern.value }));
  const err = el('div', { className: 'err' });

  let options;
  if (rule.type === 'keyword') {
    const whole = el('input', { type: 'checkbox', checked: rule.wholeWord !== false });
    whole.addEventListener('change', () => update({ wholeWord: whole.checked }));
    options = el('label', { title: 'When checked, "acme" does not match inside "acmecorp"' }, [whole, ' Whole word']);
  } else {
    const flags = el('input', { type: 'text', className: 'flags', value: rule.flags ?? 'gi', title: 'Regex flags' });
    flags.addEventListener('input', () => update({ flags: flags.value }));
    options = el('label', {}, ['flags ', flags]);
  }

  const repl = el('input', {
    type: 'text',
    className: 'repl',
    value: rule.replacement || '',
    placeholder: 'default'
  });
  repl.addEventListener('input', () => update({ replacement: repl.value }));

  const del = el('button', { className: 'danger', textContent: '✕', title: 'Delete rule' });
  del.addEventListener('click', () => {
    state.rules.splice(index, 1);
    renderRules();
    markDirty();
  });

  function validate() {
    const msg = Engine.validateRule(rule);
    err.textContent = msg ? 'Invalid regex: ' + msg : '';
    pattern.classList.toggle('invalid', !!msg);
  }
  validate();

  return el('tr', {}, [
    el('td', {}, [enabled]),
    el('td', {}, [name]),
    el('td', {}, [type]),
    el('td', {}, [pattern, err]),
    el('td', {}, [options]),
    el('td', {}, [repl]),
    el('td', {}, [del])
  ]);
}

$('#addKeyword').addEventListener('click', () => {
  state.rules.unshift({ id: uid(), name: 'Keywords', type: 'keyword', pattern: '', wholeWord: true, replacement: '', enabled: true });
  renderRules();
  markDirty();
  $('#rules tbody .pattern').focus();
});
$('#addRegex').addEventListener('click', () => {
  state.rules.unshift({ id: uid(), name: 'Rule', type: 'regex', pattern: '', flags: 'gi', replacement: '', enabled: true });
  renderRules();
  markDirty();
  $('#rules tbody .pattern').focus();
});
$('#resetRules').addEventListener('click', () => {
  state.rules = structuredClone(TRELLIS_DEFAULTS.rules);
  renderRules();
  markDirty();
});

// ---------- Try it ----------
function runTest() {
  const res = Engine.obfuscate($('#testIn').value, { ...state, ...compiled }, Engine.createSession());
  $('#testOut').value = res.text;
}
$('#testIn').addEventListener('input', runTest);

// ---------- Word lists ----------
let compiled = { compiledWordlists: [], compiledExceptions: [] };
const fileCounts = {};
let recompileTimer = null;

async function countFile(path) {
  if (!path) return 0;
  if (!(path in fileCounts)) fileCounts[path] = trellisParseWordlist(await trellisReadExtensionFile(path)).length;
  return fileCounts[path];
}

function scheduleRecompile() {
  clearTimeout(recompileTimer);
  recompileTimer = setTimeout(async () => {
    compiled = await trellisCompileWordlists(state);
    runTest();
  }, 300);
}

function wordlistsChanged() {
  markDirty();
  scheduleRecompile();
}

async function renderWordlists() {
  const box = $('#wordlists');
  box.innerHTML = '';
  for (const list of state.wordlists) {
    const enabled = el('input', { type: 'checkbox', checked: list.enabled });
    enabled.addEventListener('change', () => {
      list.enabled = enabled.checked;
      wordlistsChanged();
    });
    const cap = el('input', { type: 'checkbox', checked: !!list.capitalizedOnly });
    cap.addEventListener('change', () => {
      list.capitalizedOnly = cap.checked;
      wordlistsChanged();
    });
    const info = el('span', { className: 'hint', textContent: `${list.file} · ${await countFile(list.file)} entries` });
    box.append(
      el('div', { className: 'row' }, [
        el('label', {}, [enabled, ` ${list.name}`]),
        el('label', { title: 'Avoids false positives with common words ("rose", "grace")' }, [cap, ' Only when capitalized']),
        info
      ])
    );
  }
  $('#excFile').textContent = `${state.exceptionsFile} · ${await countFile(state.exceptionsFile)} entries`;
  $('#exceptionsExtra').value = state.exceptionsExtra || '';
  $('#allowlist').value = (state.allowlist || []).join('\n');
}

$('#allowlist').addEventListener('input', (e) => {
  state.allowlist = trellisParseWordlist(e.target.value);
  markDirty();
});
$('#exceptionsExtra').addEventListener('input', (e) => {
  state.exceptionsExtra = e.target.value;
  wordlistsChanged();
});

// ---------- Memory (saved immediately; also fed from the popup and the context menu) ----------
function renderMemoryCategories() {
  const list = $('#memCategories');
  list.innerHTML = '';
  for (const c of state.memoryCategories) list.append(el('option', { value: c }));
  for (const input of [$('#memCategory'), $('#memBulkCategory')]) {
    if (!input.value) input.value = state.memoryCategories[0] || 'Other';
  }
}

function renderMemory() {
  const filter = Engine.normalizeTerm($('#memFilter').value);
  const tbody = $('#memory tbody');
  tbody.innerHTML = '';
  const rows = state.memory
    .map((m, i) => ({ ...m, i }))
    .filter((m) => !filter || Engine.normalizeTerm(m.term).includes(filter) || Engine.normalizeTerm(m.category).includes(filter));
  for (const m of rows.slice(0, 500)) {
    const partial = el('input', { type: 'checkbox', checked: !!m.partial, title: 'Also match inside other words' });
    partial.addEventListener('change', async () => {
      const entry = state.memory[m.i];
      if (partial.checked) entry.partial = true;
      else delete entry.partial;
      await chrome.storage.local.set({ memory: state.memory });
      if (partial.checked) warnShortPartial([entry.term]);
    });
    const del = el('button', { className: 'danger', textContent: '✕', title: 'Remove from memory' });
    del.addEventListener('click', async () => {
      state.memory.splice(m.i, 1);
      await chrome.storage.local.set({ memory: state.memory });
    });
    tbody.append(el('tr', {}, [
      el('td', { textContent: m.term }),
      el('td', { textContent: m.category }),
      el('td', {}, [el('label', {}, [partial, ' partial'])]),
      el('td', {}, [del])
    ]));
  }
  $('#memCount').textContent = `${state.memory.length} entries` + (rows.length > 500 ? ` (showing 500 of ${rows.length})` : '');
}

// Short partial terms match inside far too many words ("an" in "plan", "want"...).
function warnShortPartial(terms) {
  const short = terms.filter((t) => t.trim().length < 4);
  if (short.length) setStatus(`Partial match on very short terms (${short.join(', ')}) will hit many unrelated words`, true);
}

async function addToMemory(terms, rawCategory, partial = false) {
  const category = String(rawCategory || '').trim() || 'Other';
  // A new category is remembered, so it also shows up in the popup and the context menu.
  if (!state.memoryCategories.some((c) => c.toLowerCase() === category.toLowerCase())) {
    state.memoryCategories = [...state.memoryCategories, category];
    await chrome.storage.local.set({ memoryCategories: state.memoryCategories });
    renderMemoryCategories();
  }
  const added = await trellisAddToMemory(terms, category, { partial });
  setStatus(`${added} ${added === 1 ? 'entry' : 'entries'} added or updated in memory`);
  if (partial) warnShortPartial(terms);
  return added;
}

$('#memAdd').addEventListener('click', async () => {
  if (await addToMemory([$('#memTerm').value], $('#memCategory').value, $('#memPartial').checked)) $('#memTerm').value = '';
  $('#memTerm').focus();
});
$('#memTerm').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('#memAdd').click();
});
$('#memBulkAdd').addEventListener('click', async () => {
  await addToMemory(trellisParseWordlist($('#memBulk').value), $('#memBulkCategory').value, $('#memBulkPartial').checked);
  $('#memBulk').value = '';
});
// Plain lists ("term" per line, or comma/semicolon separated) take the selected category. Lines with tabs are
// the format written by "Export memory": category<TAB>term[<TAB>partial].
$('#memImport').addEventListener('change', async (e) => {
  const plain = [];
  const exported = [];
  for (const f of e.target.files) {
    for (const line of trellisParseWordlist(await f.text())) {
      if (line.includes('\t')) {
        const [category, term, match] = line.split('\t').map((x) => x.trim());
        if (term) exported.push({ category, term, partial: match === 'partial' });
      } else {
        plain.push(...line.split(/[,;]/).map((t) => t.trim()).filter(Boolean));
      }
    }
  }
  e.target.value = '';
  if (plain.length) await addToMemory(plain, $('#memBulkCategory').value, $('#memBulkPartial').checked);
  for (const { category, term, partial } of exported) await addToMemory([term], category, partial);
  if (exported.length) setStatus(`${exported.length} exported entries imported`);
});
$('#memFilter').addEventListener('input', renderMemory);
$('#memExport').addEventListener('click', () => {
  const text = state.memory.map((m) => `${m.category}\t${m.term}${m.partial ? '\tpartial' : ''}`).join('\n');
  const a = el('a', { href: URL.createObjectURL(new Blob([text], { type: 'text/plain' })), download: 'trellis-memory.tsv' });
  a.click();
  URL.revokeObjectURL(a.href);
});

// Memory can change from the popup or the context menu while this page is open.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.memory) return;
  state.memory = changes.memory.newValue || [];
  renderMemory();
  scheduleRecompile();
});

// ---------- Domains (saved immediately because they involve permissions) ----------
async function renderDomains() {
  const ul = $('#domains');
  ul.innerHTML = '';
  for (const d of state.domains) {
    const granted = await chrome.permissions.contains({ origins: [trellisDomainToPattern(d)] });
    const del = el('button', { className: 'danger', textContent: '✕', title: 'Remove' });
    del.addEventListener('click', () => removeDomain(d));
    const li = el('li', { className: granted ? '' : 'noperm', title: granted ? '' : 'Permission not granted' }, [d, del]);
    if (!granted) {
      const grant = el('button', { textContent: 'grant' });
      grant.addEventListener('click', () => addDomain(d));
      li.insertBefore(grant, del);
    }
    ul.append(li);
  }
}

async function addDomain(raw) {
  const d = trellisNormalizeDomain(raw);
  if (!d) {
    setStatus('Invalid domain', true);
    return;
  }
  // permissions.request must be called directly from the user gesture.
  const granted = await chrome.permissions.request({ origins: [trellisDomainToPattern(d)] });
  if (!granted) {
    setStatus('Permission denied for ' + d, true);
    return;
  }
  if (!state.domains.includes(d)) state.domains.push(d);
  await chrome.storage.local.set({ domains: state.domains });
  $('#newDomain').value = '';
  setStatus('Domain added: ' + d);
  renderDomains();
}

async function removeDomain(d) {
  state.domains = state.domains.filter((x) => x !== d);
  await chrome.storage.local.set({ domains: state.domains });
  // Permissions declared in the manifest cannot be removed; optional ones can.
  chrome.permissions.remove({ origins: [trellisDomainToPattern(d)] }).catch(() => {});
  setStatus('Domain removed: ' + d);
  renderDomains();
}

$('#addDomain').addEventListener('click', () => addDomain($('#newDomain').value));
$('#newDomain').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') addDomain(e.target.value);
});

// ---------- Save / import / export ----------
async function save() {
  const invalid = state.rules.filter((r) => Engine.validateRule(r));
  if (invalid.length) {
    setStatus(`Fix ${invalid.length} invalid rule(s) before saving`, true);
    return;
  }
  await chrome.storage.local.set(pick(state, SAVED_KEYS));
  dirty = false;
  setStatus('Saved ✓');
}
$('#save').addEventListener('click', save);
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault();
    save();
  }
});
window.addEventListener('beforeunload', (e) => {
  if (dirty) e.preventDefault();
});

$('#export').addEventListener('click', () => {
  const data = pick(state, EXPORT_KEYS);
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: 'application/json'
  });
  const a = el('a', { href: URL.createObjectURL(blob), download: 'trellis-settings.json' });
  a.click();
  URL.revokeObjectURL(a.href);
});

$('#import').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.rules)) throw new Error('missing "rules"');
    Object.assign(state, pick(data, SAVED_KEYS));
    if (Array.isArray(data.memory)) {
      for (const m of data.memory) {
        if (m && typeof m.term === 'string') await trellisAddToMemory([m.term], m.category, { partial: !!m.partial });
      }
    }
    state.rules.forEach((r) => (r.id ||= uid()));
    // Domains are never imported: a shared settings file must not be able to widen where Trellis runs.
    const skipped = Array.isArray(data.domains) ? data.domains.filter((d) => !state.domains.includes(d)).length : 0;
    renderAll();
    markDirty();
    setStatus(`Imported. Review the rules and press Save.${skipped ? ` ${skipped} domain(s) were not imported.` : ''}`);
  } catch (err) {
    setStatus('Import failed: ' + err.message, true);
  }
});

function renderAll() {
  renderGeneral();
  renderRules();
  renderWordlists();
  renderMemoryCategories();
  renderMemory();
  scheduleRecompile();
  renderDomains();
  runTest();
}

(async () => {
  state = await trellisGetSettings();
  renderAll();
})();
