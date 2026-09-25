// Default settings, shared by the background worker, content scripts and extension pages.
// Assigned to globalThis (not const) so re-injecting the script never fails on redeclaration.
globalThis.TRELLIS_DEFAULTS = {
  enabled: true,
  // 'placeholder' -> [EMAIL_1] (consistent across the browser session) | 'mask' -> fixed text | 'asterisks' -> ****
  mode: 'placeholder',
  maskText: '[REDACTED]',
  showToast: true,
  // How to show the original value of a placeholder ([EMAIL_1]) on the page:
  // 'hover'  -> in a tooltip drawn by the extension that the site's scripts cannot read (default)
  // 'inline' -> replaced in the page text; convenient, but the site's scripts CAN read it
  // 'off'    -> never
  restoreMode: 'hover',
  // Highlight placeholders whose original value is known.
  highlightRestored: true,
  // When copying (Ctrl+C or the site's "Copy" buttons), put the original values on the clipboard.
  restoreOnCopy: true,
  // Inline mode only: CSS selectors (comma-separated) where nothing is ever restored, so they show exactly
  // what was sent: dialogs (attachment previews) and your own messages on Claude and ChatGPT.
  restoreExclude: '[role="dialog"], [aria-modal="true"], [data-testid="user-message"], [data-message-author-role="user"]',
  // Check on send (Enter or Send button): 'obfuscate' obfuscates what you typed and asks you to send again,
  // 'block' only blocks and warns, 'off' disables it.
  presend: 'obfuscate',
  // Warn as soon as something sensitive is typed (the site already receives keystrokes).
  typingWarning: true,
  // Memory: your own keywords (people, companies, clients, projects...). Stored only in this browser
  // (chrome.storage.local), never in the repository. [{ term, category }]
  memory: [],
  memoryCategories: ['Person', 'Company', 'Client', 'Project', 'Other'],
  // Generic word lists shipped with the extension (wordlists/ folder, re-read when the extension reloads).
  // "capitalizedOnly": match only words starting with a capital letter (avoids false positives).
  wordlists: [
    { id: 'first-names', name: 'Name', file: 'wordlists/first-names.txt', enabled: true, capitalizedOnly: true },
    { id: 'surnames', name: 'Surname', file: 'wordlists/surnames.txt', enabled: true, capitalizedOnly: true }
  ],
  exceptionsFile: 'wordlists/exceptions.txt',
  exceptionsExtra: '',
  // Values that are never obfuscated by rules or lists (false positives marked from the in-page panel).
  // Memory entries still apply.
  allowlist: [],
  // Floating button + panel on chat pages: detected placeholders, suggestions and quick add to memory.
  showPanel: true,
  domains: [
    'chatgpt.com',
    'chat.openai.com',
    'claude.ai',
    'gemini.google.com',
    'aistudio.google.com',
    'chat.deepseek.com',
    'z.ai',
    'chat.mistral.ai',
    'perplexity.ai',
    'copilot.microsoft.com',
    'grok.com',
    'poe.com',
    'chat.qwen.ai',
    'kimi.com',
    'meta.ai',
    'huggingface.co'
  ],
  rules: [
    {
      id: 'kw-example',
      name: 'Keywords',
      type: 'keyword',
      pattern: 'Acme Corp, Project Phoenix',
      wholeWord: true,
      replacement: '',
      enabled: false
    },
    {
      id: 'private-key',
      name: 'Private key',
      type: 'regex',
      pattern: '-----BEGIN [A-Z ]*PRIVATE KEY-----[\\s\\S]+?-----END [A-Z ]*PRIVATE KEY-----',
      flags: 'g',
      replacement: '',
      enabled: true
    },
    {
      id: 'jwt',
      name: 'JWT',
      type: 'regex',
      pattern: '\\beyJ[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+',
      flags: 'g',
      replacement: '',
      enabled: true
    },
    {
      id: 'api-key',
      name: 'API key',
      type: 'regex',
      pattern: '\\b(?:sk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,}|xox[abprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{35})',
      flags: 'g',
      replacement: '',
      enabled: true
    },
    {
      id: 'secret-assign',
      name: 'Secret',
      type: 'regex',
      // Only the value after "password=", "token: ", etc.
      pattern: '(?<=\\b(?:password|passwd|pwd|passwort|contraseña|mot de passe|secret|token|api[_-]?key)\\s*[:=]\\s*["\']?)[^\\s"\',;]+',
      flags: 'gi',
      replacement: '',
      enabled: true
    },
    {
      id: 'email',
      name: 'Email',
      type: 'regex',
      pattern: '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}',
      flags: 'g',
      replacement: '',
      enabled: true
    },
    {
      id: 'iban',
      name: 'IBAN',
      type: 'regex',
      pattern: '\\b[A-Z]{2}\\d{2}(?: ?[A-Z0-9]{4}){3,7}(?: ?[A-Z0-9]{1,3})?\\b',
      flags: 'g',
      replacement: '',
      enabled: true
    },
    {
      id: 'card',
      name: 'Card',
      type: 'regex',
      pattern: '\\b(?:\\d{4}[ -]?){3}\\d{4}\\b',
      flags: 'g',
      replacement: '',
      enabled: true
    },
    {
      // Spanish national ID (DNI/NIE)
      id: 'dni-es',
      name: 'National ID',
      type: 'regex',
      pattern: '\\b[XYZ]?\\d{7,8}[- ]?[TRWAGMYFPDXBNJZSQVHLCKE]\\b',
      flags: 'gi',
      replacement: '',
      enabled: true
    },
    {
      // Spanish phone numbers; add your own country's format as a new rule
      id: 'phone-es',
      name: 'Phone',
      type: 'regex',
      pattern: '(?:\\+34[ -]?)?\\b[6789]\\d{2}[ -]?\\d{3}[ -]?\\d{3}\\b',
      flags: 'g',
      replacement: '',
      enabled: true
    },
    {
      id: 'ipv4',
      name: 'IPv4',
      type: 'regex',
      pattern: '\\b(?:(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)\\.){3}(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)\\b',
      flags: 'g',
      replacement: '',
      enabled: true
    }
  ]
};

// Stored settings over defaults, migrating keys from earlier versions.
globalThis.trellisMergeSettings = function (stored) {
  const settings = { ...structuredClone(globalThis.TRELLIS_DEFAULTS), ...stored };
  if (stored.restoreMode === undefined && stored.restoreResponses === false) settings.restoreMode = 'off';
  return settings;
};

globalThis.trellisGetSettings = async function () {
  return globalThis.trellisMergeSettings(await chrome.storage.local.get(null));
};

// "claude.ai" -> "https://*.claude.ai/*" (covers the domain and its subdomains)
globalThis.trellisDomainToPattern = function (domain) {
  return `https://*.${domain}/*`;
};

globalThis.trellisNormalizeDomain = function (input) {
  let d = String(input || '').trim().toLowerCase();
  d = d.replace(/^[a-z]+:\/\//, '').replace(/[/?#].*$/, '').replace(/:\d+$/, '').replace(/^\*\./, '');
  return /^[a-z0-9.-]+\.[a-z0-9-]+$/.test(d) ? d : null;
};

globalThis.trellisHostMatches = function (hostname, domains) {
  const h = String(hostname || '').toLowerCase();
  return (domains || []).some((d) => h === d || h.endsWith('.' + d));
};

// Placeholder -> original mappings. They live in chrome.storage.session (in memory, cleared when the
// browser closes) and are scoped per site: a placeholder created on claude.ai can only ever be shown on
// claude.ai, so another site cannot make it reveal data by printing "[EMAIL_1]".
// One key per placeholder: "trellis:t:claude.ai|[EMAIL_1]" -> { label, value }.
globalThis.TRELLIS_VAULT_PREFIX = 'trellis:t:';

globalThis.trellisVaultKey = function (site, token) {
  return `${globalThis.TRELLIS_VAULT_PREFIX}${site}|${token}`;
};

globalThis.trellisParseVaultKey = function (key) {
  const prefix = globalThis.TRELLIS_VAULT_PREFIX;
  if (!key.startsWith(prefix)) return null;
  const rest = key.slice(prefix.length);
  const bar = rest.indexOf('|');
  return bar > 0 ? { site: rest.slice(0, bar), token: rest.slice(bar + 1) } : null;
};

// Entries of one site (or of every site when `site` is omitted).
globalThis.trellisVaultEntries = function (items, site) {
  const out = [];
  for (const [key, v] of Object.entries(items || {})) {
    const parsed = globalThis.trellisParseVaultKey(key);
    if (!parsed || !v || (site && parsed.site !== site)) continue;
    out.push({ ...parsed, label: v.label, value: v.value });
  }
  return out;
};

// The configured domain a hostname belongs to ("chat.z.ai" -> "z.ai"); the most specific one wins.
globalThis.trellisSiteFor = function (hostname, domains) {
  const h = String(hostname || '').toLowerCase();
  let best = null;
  for (const d of domains || []) {
    if ((h === d || h.endsWith('.' + d)) && (!best || d.length > best.length)) best = d;
  }
  return best || h;
};

// ---------- Word lists ----------
globalThis.trellisParseWordlist = function (text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
};

globalThis.trellisReadExtensionFile = async function (path) {
  if (!path) return '';
  try {
    const res = await fetch(chrome.runtime.getURL(path));
    return res.ok ? await res.text() : '';
  } catch (e) {
    return '';
  }
};

// Merges memory + bundled files. The result is stored (compiledWordlists / compiledExceptions) so content
// scripts never read the files themselves nor expose them to web pages.
globalThis.trellisCompileWordlists = async function (settings) {
  const parse = globalThis.trellisParseWordlist;
  const read = globalThis.trellisReadExtensionFile;
  const compiledWordlists = [];
  // Memory comes first and ignores exceptions: whatever you store there is always obfuscated.
  // Grouped by category and match type; both groups of a category share its placeholder label.
  const groups = new Map();
  for (const { term, category, partial } of settings.memory || []) {
    const cat = category || 'Other';
    const key = cat + (partial ? '\u0000partial' : '');
    if (!groups.has(key)) groups.set(key, { cat, partial: !!partial, words: [] });
    groups.get(key).words.push(term);
  }
  for (const { cat, partial, words } of groups.values()) {
    compiledWordlists.push({
      id: 'mem:' + cat + (partial ? ':partial' : ''),
      name: cat,
      capitalizedOnly: false,
      ignoreExceptions: true,
      partial,
      words
    });
  }
  for (const l of settings.wordlists || []) {
    if (!l.enabled) continue;
    compiledWordlists.push({
      id: l.id,
      name: l.name,
      capitalizedOnly: !!l.capitalizedOnly,
      words: parse(await read(l.file))
    });
  }
  const compiledExceptions = [...parse(await read(settings.exceptionsFile)), ...parse(settings.exceptionsExtra)];
  return { compiledWordlists, compiledExceptions };
};

// Adds terms to memory (no duplicates; case/accent-insensitive). Adding an existing term again updates its
// category and can turn partial matching on, never off (that is done from the memory table).
// Returns how many terms were added or changed.
// options.partial: also match inside other words ("hooli" in "HooliDC").
globalThis.trellisAddToMemory = async function (terms, category, options = {}) {
  const normalize = globalThis.TrellisEngine.normalizeTerm;
  const { memory = [] } = await chrome.storage.local.get('memory');
  const byKey = new Map(memory.map((m) => [normalize(m.term), m]));
  const cat = category || 'Other';
  let changed = 0;
  for (const raw of terms) {
    const term = String(raw || '').replace(/\s+/g, ' ').trim();
    const key = normalize(term);
    if (!key) continue;
    const existing = byKey.get(key);
    if (existing) {
      if (existing.category === cat && (existing.partial || !options.partial)) continue;
      existing.category = cat;
      if (options.partial) existing.partial = true;
    } else {
      const entry = { term, category: cat };
      if (options.partial) entry.partial = true;
      memory.push(entry);
      byKey.set(key, entry);
    }
    changed++;
  }
  if (changed) await chrome.storage.local.set({ memory });
  return changed;
};
