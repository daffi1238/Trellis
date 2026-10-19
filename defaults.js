// Default settings, shared by the background worker, content scripts and extension pages.
// Assigned to globalThis (not const) so re-injecting the script never fails on redeclaration.
// Token formats with a distinctive prefix, so they are found anywhere without context words. Adapted from the
// gitleaks rule set (MIT, see THIRD_PARTY_NOTICES.md) to JavaScript regex syntax.
const TRELLIS_API_KEY_FORMATS = [
  'sk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}', // Anthropic, OpenAI
  '(?:A3T[A-Z0-9]|AKIA|ASIA|ABIA|ACCA)[A-Z0-9]{16}', // AWS access key IDs
  'ABSK[A-Za-z0-9+/]{109,269}={0,2}', // Amazon Bedrock
  'AIza[0-9A-Za-z_-]{35}', // Google
  'gh[pousr]_[A-Za-z0-9]{36,}', // GitHub
  'github_pat_[A-Za-z0-9_]{22,}',
  'gl(?:pat|dt|ffct|ft|imt|agent|oas|ptt|rt|soat|cbt)-[0-9A-Za-z_.-]{20,300}', // GitLab
  'GR1348941[A-Za-z0-9_-]{20}',
  'xox[abeoprs]-[A-Za-z0-9-]{10,}', // Slack
  'xapp-\\d-[A-Za-z0-9-]{10,}',
  '(?:sk|rk)_(?:test|live|prod)_[A-Za-z0-9]{10,99}', // Stripe
  'sq0(?:atp|csp)-[A-Za-z0-9_-]{22,60}', // Square
  'SG\\.[A-Za-z0-9=_.-]{66}', // SendGrid
  'xkeysib-[a-f0-9]{64}-[A-Za-z0-9]{16}', // Brevo
  'SK[0-9a-fA-F]{32}', // Twilio
  'shp(?:at|ca|pa|ss)_[a-fA-F0-9]{32}', // Shopify
  'npm_[A-Za-z0-9]{36}', // npm
  'pypi-AgEIcHlwaS5vcmc[A-Za-z0-9_-]{50,1000}', // PyPI
  'rubygems_[a-f0-9]{48}', // RubyGems
  'CLOJARS_[A-Za-z0-9]{60}',
  'do[opr]_v1_[a-f0-9]{64}', // DigitalOcean
  'hf_[A-Za-z]{34}', // Hugging Face
  'api_org_[A-Za-z]{34}',
  'pplx-[A-Za-z0-9]{48}', // Perplexity
  'lin_api_[A-Za-z0-9]{40}', // Linear
  'ntn_[0-9]{11}[A-Za-z0-9]{35}', // Notion
  'PMAK-[a-fA-F0-9]{24}-[a-fA-F0-9]{34}', // Postman
  'sntryu_[a-f0-9]{64}', // Sentry
  'sntrys_eyJpYXQiO[A-Za-z0-9+/=_-]{40,}',
  'glc_[A-Za-z0-9+/]{32,400}={0,3}', // Grafana
  'glsa_[A-Za-z0-9]{32}_[A-Fa-f0-9]{8}',
  'eyJrIjoi[A-Za-z0-9]{70,400}={0,3}',
  'dapi[a-f0-9]{32}(?:-\\d)?', // Databricks
  'dt0c01\\.[A-Za-z0-9]{24}\\.[A-Za-z0-9]{64}', // Dynatrace
  'pul-[a-f0-9]{40}', // Pulumi
  'dp\\.pt\\.[A-Za-z0-9]{43}', // Doppler
  'hv[sb]\\.[A-Za-z0-9_-]{90,300}', // HashiCorp Vault
  'pscale_(?:tkn|oauth|pw)_[A-Za-z0-9_=.-]{32,64}', // PlanetScale
  'HRKU-AA[0-9A-Za-z_-]{58}', // Heroku
  'fo1_[A-Za-z0-9_-]{43}', // Fly.io
  'LTAI[A-Za-z0-9]{20}', // Alibaba Cloud
  'AKCp[A-Za-z0-9]{69}', // JFrog Artifactory
  'pnu_[A-Za-z0-9]{36}', // Prefect
  'ico-[A-Za-z0-9]{32}', // Infracost
  'rdme_[a-z0-9]{70}', // ReadMe
  'shippo_(?:live|test)_[a-fA-F0-9]{40}', // Shippo
  'v1\\.0-[a-f0-9]{24}-[a-f0-9]{146}', // Cloudflare Origin CA
  'ops_eyJ[A-Za-z0-9+/]{250,}={0,3}', // 1Password service account
  'A3-[A-Z0-9]{6}-(?:[A-Z0-9]{11}|[A-Z0-9]{6}-[A-Z0-9]{5})-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}', // 1Password secret key
  'AGE-SECRET-KEY-1[QPZRY9X8GF2TVDW0S3JN54KHCE6MUA7L]{58}', // age
  '[0-9]{8,10}:AA[0-9A-Za-z_-]{33}' // Telegram bot
];

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
  // Obfuscate typed data in the message box when the user pauses or leaves the box, so protection does not
  // depend on recognising the site's Send control.
  autoObfuscateTyped: true,
  // Network backstop: block a request that contains a sensitive value typed in the message box and not
  // obfuscated (e.g. sent through a control Trellis did not recognise).
  egressGuard: true,
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
  // Ids of default rules the user deleted, so later versions do not add them back.
  dismissedRules: [],
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
      // The header must decode to JSON with "alg" or "typ".
      validate: 'jwt',
      replacement: '',
      enabled: true
    },
    {
      id: 'api-key',
      name: 'API key',
      type: 'regex',
      pattern: `(?<![A-Za-z0-9_-])(?:${TRELLIS_API_KEY_FORMATS.join('|')})`,
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
      // Bounded, dot-separated labels: no catastrophic backtracking on hostile input like "a@a.a.a.a…".
      // Not the user or password@host of a URL (scheme://user:password@host): url-password handles those.
      pattern: '(?<![A-Za-z0-9._%+-])(?<!://(?:[^\\s:/@]{1,100}:)?)[A-Za-z0-9._%+-]{1,64}@(?:[A-Za-z0-9-]{1,63}\\.){1,8}[A-Za-z]{2,24}(?![A-Za-z0-9-])',
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
      validate: 'iban', // ISO 13616 mod-97 check
      replacement: '',
      enabled: true
    },
    {
      id: 'card',
      name: 'Card',
      type: 'regex',
      // 16 digits, or 15 for American Express
      pattern: '\\b(?:\\d{4}[ -]?){3}\\d{4}\\b|\\b3[47]\\d{2}[ -]?\\d{6}[ -]?\\d{5}\\b',
      flags: 'g',
      validate: 'luhn', // card number checksum
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
      validate: 'dni-es', // the letter is a checksum of the number
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
    },
    {
      // International numbers written with their country code (+44 20 7946 0958); 8 to 15 digits
      id: 'phone-intl',
      name: 'Phone',
      type: 'regex',
      pattern: '(?<![\\w+])\\+[1-9]\\d{0,2}[ .-]?(?:\\(\\d{1,4}\\)[ .-]?)?\\d{1,4}(?:[ .-]?\\d{1,4}){1,4}(?!\\w)',
      flags: 'g',
      validate: 'phone-intl',
      replacement: '',
      enabled: true
    },
    {
      // Only the password in scheme://user:password@host (database URLs, git remotes...)
      id: 'url-password',
      name: 'Password',
      type: 'regex',
      pattern: '(?<=\\b[A-Za-z][A-Za-z0-9+.-]{1,20}://[^\\s:/@]{1,100}:)[^\\s@/]{1,200}(?=@)',
      flags: 'g',
      replacement: '',
      enabled: true
    },
    {
      // Only the credential in "Authorization: Bearer ..." (and Basic, Token, Digest)
      id: 'auth-header',
      name: 'Token',
      type: 'regex',
      pattern: '(?<=\\b(?:Proxy-)?Authorization\\s*[:=]\\s*["\']?(?:Bearer|Basic|Token|Digest)\\s+)[A-Za-z0-9._~+/=-]{8,}',
      flags: 'gi',
      replacement: '',
      enabled: true
    },
    {
      // Cookie values in HTTP headers (Cookie: and Set-Cookie:), not the attributes (Path, Expires...)
      id: 'cookie-header',
      name: 'Cookie',
      type: 'regex',
      pattern: '(?<=^[ \\t]*(?:Set-)?Cookie:[^\\r\\n]*?\\b(?!(?:Path|Domain|Expires|Max-Age|SameSite|Priority|Partitioned)=)[\\w.!#$%&\'*+^`|~-]+=)[^;\\r\\n]+',
      flags: 'gim',
      replacement: '',
      enabled: true
    },
    {
      // User names in assignments (user=, username: , login=). Off by default: in code it also catches things like
      // `user = User()`; turn it on for logs, configs and HTTP traffic.
      id: 'user-assign',
      name: 'User',
      type: 'regex',
      pattern: '(?<=\\b(?:user(?:name)?|login|uid|usuario)\\s*[:=]\\s*["\']?)[^\\s"\',;&()<>]{2,64}',
      flags: 'gi',
      replacement: '',
      enabled: false
    },
    {
      // Incoming webhook URLs: whoever has one can post as you
      id: 'webhook',
      name: 'Webhook',
      type: 'regex',
      pattern: 'https://(?:hooks\\.slack\\.com/(?:services|workflows|triggers)/[A-Za-z0-9+/]{20,80}|(?:ptb\\.|canary\\.)?discord(?:app)?\\.com/api/webhooks/\\d+/[A-Za-z0-9_-]{60,80}|[a-z0-9-]+\\.webhook\\.office\\.com/webhookb2/[^\\s"\'<>]+)',
      flags: 'g',
      replacement: '',
      enabled: true
    }
  ]
};

// Stored settings over defaults, migrating keys from earlier versions.
// Default patterns replaced in later versions, upgraded in stored settings unless the user edited them.
// Earlier default patterns, per rule: a stored rule still using one of them gets the current pattern. On globalThis
// so that scripts reading this file (the Claude Code plugin's sync) can see it.
globalThis.TRELLIS_OUTDATED_PATTERNS = {
  email: [
    '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}', // quadratic backtracking on hostile input
    '(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]{1,64}@(?:[A-Za-z0-9-]{1,63}\\.){1,8}[A-Za-z]{2,24}(?![A-Za-z0-9-])' // matched the password@host of URLs
  ],
  'api-key': ['\\b(?:sk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,}|xox[abprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{35})'],
  card: ['\\b(?:\\d{4}[ -]?){3}\\d{4}\\b']
};

globalThis.trellisMergeSettings = function (stored) {
  const settings = { ...structuredClone(globalThis.TRELLIS_DEFAULTS), ...stored };
  if (stored.restoreMode === undefined && stored.restoreResponses === false) settings.restoreMode = 'off';
  if (Array.isArray(stored.rules)) settings.rules = globalThis.trellisUpgradeRules(stored.rules, stored.dismissedRules);
  return settings;
};

// Stored rules brought up to date with the defaults: outdated default patterns upgraded, validators of default
// rules added, and default rules added in later versions appended (unless the user deleted them: dismissedRules).
globalThis.trellisUpgradeRules = function (rules, dismissedRules) {
  const defaults = globalThis.TRELLIS_DEFAULTS.rules;
  const outdated = globalThis.TRELLIS_OUTDATED_PATTERNS;
  const out = rules.map((r) => {
    const def = defaults.find((d) => d.id === r?.id);
    if (!def) return r;
    let rule = r;
    if ((outdated[r.id] || []).includes(r.pattern)) rule = { ...rule, pattern: def.pattern };
    if (def.validate && !('validate' in rule)) rule = { ...rule, validate: def.validate };
    return rule;
  });
  const dismissed = new Set(Array.isArray(dismissedRules) ? dismissedRules : []);
  for (const def of defaults) {
    if (!dismissed.has(def.id) && !out.some((r) => r?.id === def.id)) out.push(structuredClone(def));
  }
  return out;
};

// Keeps only the known fields of a rule, with the right types (used for imported settings files).
globalThis.trellisSanitizeRule = function (r) {
  if (!r || typeof r !== 'object' || typeof r.pattern !== 'string') return null;
  const rule = {
    id: typeof r.id === 'string' ? r.id.slice(0, 64) : '',
    name: typeof r.name === 'string' ? r.name.slice(0, 64) : 'Rule',
    type: r.type === 'keyword' ? 'keyword' : 'regex',
    pattern: r.pattern.slice(0, 5000),
    replacement: typeof r.replacement === 'string' ? r.replacement.slice(0, 200) : '',
    enabled: r.enabled !== false
  };
  if (rule.type === 'keyword') rule.wholeWord = r.wholeWord !== false;
  else rule.flags = typeof r.flags === 'string' ? r.flags.replace(/[^dgimsuvy]/g, '') : 'gi';
  if (typeof r.validate === 'string' && (globalThis.TrellisEngine?.validators || []).includes(r.validate)) rule.validate = r.validate;
  return rule;
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
