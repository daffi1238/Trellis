// Run with: node --test test/
// All names, emails and numbers below are fictional.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
require('../defaults.js');
const E = require('../obfuscator.js');

const base = () => structuredClone(globalThis.TRELLIS_DEFAULTS);
const run = (text, patch = {}) => E.obfuscate(text, { ...base(), ...patch }, E.createSession()).text;
const readList = (f) => globalThis.trellisParseWordlist(fs.readFileSync(path.join(__dirname, '..', 'wordlists', f), 'utf8'));

test('default rules', () => {
  const out = run(
    'I am jane.doe@example.com, ID 12345678Z, IP 192.168.1.20, phone +34 612 345 678, ' +
    'IBAN ES91 2100 0418 4502 0005 1332, card 4111 1111 1111 1111, key sk-proj-abcdefghijklmnopqrstuvwxyz123456, ' +
    'password=Sup3rS3cret! AKIAABCDEFGHIJKLMNOP'
  );
  assert.equal(out,
    'I am [EMAIL_1], ID [NATIONAL_ID_1], IP [IPV4_1], phone [PHONE_1], ' +
    'IBAN [IBAN_1], card [CARD_1], key [API_KEY_1], ' +
    'password=[SECRET_1] [API_KEY_2]');
});

test('the same value always gets the same placeholder', () => {
  const s = E.createSession();
  const st = base();
  assert.equal(E.obfuscate('a@b.com and A@B.com and c@d.com', st, s).text, '[EMAIL_1] and [EMAIL_1] and [EMAIL_2]');
  assert.equal(E.obfuscate('again a@b.com', st, s).text, 'again [EMAIL_1]');
});

test('keywords: case-insensitive, whole word, accents', () => {
  const rules = [{ name: 'Client', type: 'keyword', pattern: 'Acme, Proyecto Ñandú', wholeWord: true, enabled: true }];
  assert.equal(run('ACME and acme but not acmecorp; the proyecto ñandú', { rules, mode: 'mask' }),
    '[REDACTED] and [REDACTED] but not acmecorp; the [REDACTED]');
  rules[0].wholeWord = false;
  assert.equal(run('acmecorp', { rules, mode: 'mask' }), '[REDACTED]corp');
});

test('keywords with regex special characters', () => {
  const rules = [{ name: 'k', type: 'keyword', pattern: 'c++ (v2), a.b', wholeWord: false, enabled: true }];
  assert.equal(run('using c++ (v2) and axb and a.b', { rules, mode: 'mask', maskText: 'X' }), 'using X and axb and X');
});

test('asterisks mode and per-rule replacement', () => {
  const rules = [
    { name: 'Email', type: 'regex', pattern: '\\S+@\\S+', flags: 'g', enabled: true },
    { name: 'Srv', type: 'regex', pattern: 'srv-\\d+', flags: 'gi', replacement: '<SERVER>', enabled: true }
  ];
  assert.equal(run('x@y.io on SRV-42', { rules, mode: 'asterisks' }), '****** on <SERVER>');
});

test('invalid regex is ignored and reported', () => {
  const bad = { name: 'bad', type: 'regex', pattern: '([a-z', enabled: true };
  assert.ok(E.validateRule(bad));
  assert.equal(run('hello', { rules: [bad] }), 'hello');
});

test('multi-line private key and JWT', () => {
  const pk = '-----BEGIN RSA PRIVATE KEY-----\nMIIEow\nabc\n-----END RSA PRIVATE KEY-----';
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig_nature-x';
  assert.equal(run(`k:\n${pk}\nt: ${jwt}`), 'k:\n[PRIVATE_KEY_1]\nt: [JWT_1]');
});

test('disabled rules are not applied', () => {
  const st = base();
  st.rules.forEach((r) => (r.enabled = false));
  assert.equal(E.obfuscate('a@b.com', st).count, 0);
});

test('domain helpers', () => {
  assert.equal(globalThis.trellisNormalizeDomain('https://www.Chat.Z.ai/c/123'), 'www.chat.z.ai');
  assert.equal(globalThis.trellisNormalizeDomain('nope'), null);
  assert.ok(globalThis.trellisHostMatches('chat.z.ai', ['z.ai']));
  assert.ok(!globalThis.trellisHostMatches('notz.ai', ['z.ai']));
});

test('restore placeholders with and without brackets', () => {
  const s = E.createSession();
  const out = E.obfuscate('write to jane@acme.com from 10.0.0.1', base(), s).text;
  assert.equal(out, 'write to [EMAIL_1] from [IPV4_1]');
  assert.equal(E.restore('Sent to [EMAIL_1] (EMAIL_1) from IPV4_1.', s), 'Sent to jane@acme.com (jane@acme.com) from 10.0.0.1.');
  // unknown or look-alike placeholders are left alone
  assert.equal(E.restore('[EMAIL_2] EMAIL_10 MY_EMAIL_1', s), '[EMAIL_2] EMAIL_10 MY_EMAIL_1');
});

test('pendingPlaceholders and externally assigned entries', () => {
  const s = E.createSession();
  const st = base();
  const m = E.findMatches('a@b.com a@b.com c@d.com', st.rules);
  assert.deepEqual(E.pendingPlaceholders(m, st, s), [{ label: 'EMAIL', value: 'a@b.com' }, { label: 'EMAIL', value: 'c@d.com' }]);
  E.addEntry(s, '[EMAIL_7]', 'EMAIL', 'a@b.com');
  assert.equal(E.pendingPlaceholders(m, st, s).length, 1);
  assert.equal(E.obfuscate('a@b.com c@d.com', st, s).text, '[EMAIL_7] [EMAIL_8]');
  assert.equal(E.pendingPlaceholders(m, { ...st, mode: 'mask' }, E.createSession()).length, 0);
});

test('keywords ignore accents and spacing, sharing one placeholder', () => {
  const rules = [{ name: 'Person', type: 'keyword', pattern: 'Jose Nunez, Pérez-Llorca, Acme', enabled: true }];
  const s = E.createSession();
  const out = E.obfuscate('JOSÉ  NÚÑEZ, jose\nnunez, Jose\u0301 Nun\u0303ez, Perez-Llorca, ÁCME, acmes',
    { mode: 'placeholder', rules }, s).text;
  assert.equal(out, '[PERSON_1], [PERSON_1], [PERSON_1], [PERSON_2], [PERSON_3], acmes');
  assert.equal(E.restore('Hi [PERSON_1]', s), 'Hi JOSÉ  NÚÑEZ');
});

test('restore with HTML escaping', () => {
  const s = E.createSession();
  E.addEntry(s, '[X_1]', 'X', 'a<b>&c');
  const esc = (v) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  assert.equal(E.restore('<p>[X_1]</p>', s, null, esc), '<p>a&lt;b&gt;&amp;c</p>');
});

test('word lists: names, compound surnames, memory, capitalization and exceptions', () => {
  const settings = {
    ...base(),
    compiledWordlists: [
      { id: 'mem:Company', name: 'Company', capitalizedOnly: false, ignoreExceptions: true, words: ['Globex', 'Procter & Gamble', 'El Corte Inglés', 'Julia Labs'] },
      { id: 'first-names', name: 'Name', capitalizedOnly: true, words: readList('first-names.txt') },
      { id: 'surnames', name: 'Surname', capitalizedOnly: true, words: readList('surnames.txt') }
    ],
    compiledExceptions: readList('exceptions.txt')
  };
  const out = E.obfuscate(
    'María García and Miguel de la Cruz Sánchez (globex) talk to Claude about Julia. ' +
    'A white rose. Laura Pérez shops at el corte ingles, Procter & Gamble and Julia Labs. JORGE LÓPEZ.',
    settings, E.createSession()).text;
  assert.equal(out,
    '[NAME_1] [SURNAME_1] and [NAME_2] [SURNAME_2] [SURNAME_3] ([COMPANY_1]) talk to Claude about Julia. ' +
    'A white rose. [NAME_3] [SURNAME_4] shops at [COMPANY_2], [COMPANY_3] and [COMPANY_4]. [NAME_4] [SURNAME_5].');
});

test('word lists: large lists stay fast', () => {
  const words = Array.from({ length: 200000 }, (_, i) => 'Nom' + i.toString(36));
  const settings = { rules: [], mode: 'mask', compiledWordlists: [{ id: 'x', name: 'X', words }], compiledExceptions: [] };
  const text = 'Hello Nom1a2 and Nomzz, '.repeat(5000);
  E.findAll('warmup', settings);
  const t0 = Date.now();
  const n = E.findAll(text, settings).length;
  const ms = Date.now() - t0;
  assert.equal(n, 10000);
  assert.ok(ms < 1000, `too slow: ${ms}ms`);
});

test('placeholder mappings are scoped per site', () => {
  const domains = ['claude.ai', 'z.ai', 'chat.z.ai'];
  assert.equal(globalThis.trellisSiteFor('claude.ai', domains), 'claude.ai');
  assert.equal(globalThis.trellisSiteFor('www.claude.ai', domains), 'claude.ai');
  assert.equal(globalThis.trellisSiteFor('chat.z.ai', domains), 'chat.z.ai'); // the most specific domain wins
  assert.equal(globalThis.trellisSiteFor('other.z.ai', domains), 'z.ai');

  const items = {
    [globalThis.trellisVaultKey('claude.ai', '[EMAIL_1]')]: { label: 'EMAIL', value: 'a@b.com' },
    [globalThis.trellisVaultKey('chatgpt.com', '[EMAIL_1]')]: { label: 'EMAIL', value: 'c@d.com' },
    'trellis:t:[EMAIL_9]': { label: 'EMAIL', value: 'old format, ignored' },
    unrelated: 1
  };
  assert.deepEqual(globalThis.trellisVaultEntries(items, 'claude.ai'),
    [{ site: 'claude.ai', token: '[EMAIL_1]', label: 'EMAIL', value: 'a@b.com' }]);
  assert.equal(globalThis.trellisVaultEntries(items).length, 2);
});

test('settings from earlier versions are migrated', () => {
  assert.equal(globalThis.trellisMergeSettings({ restoreResponses: false }).restoreMode, 'off');
  assert.equal(globalThis.trellisMergeSettings({ restoreResponses: true }).restoreMode, 'hover');
  assert.equal(globalThis.trellisMergeSettings({}).restoreMode, 'hover');
});

test('memory: partial entries also match inside other words and share the placeholder', () => {
  const settings = {
    rules: [],
    mode: 'placeholder',
    compiledWordlists: [
      { id: 'mem:Corp:partial', name: 'Corp', partial: true, ignoreExceptions: true, words: ['hooli'] },
      { id: 'mem:Corp', name: 'Corp', ignoreExceptions: true, words: ['acme'] }
    ],
    compiledExceptions: []
  };
  const s = E.createSession();
  assert.equal(E.obfuscate('HOOLI_DC, HooliDC, hoolicorp, Hóoli123', settings, s).text,
    '[CORP_1]_DC, [CORP_1]DC, [CORP_1]corp, [CORP_1]123');
  // whole-word entries stay whole-word
  assert.equal(E.obfuscate('acme acmecorp', settings, s).text, '[CORP_2] acmecorp');
});

test('suggestions: names, codes, hosts and long numbers that matched nothing', () => {
  const settings = {
    ...base(),
    compiledWordlists: [
      { id: 'first-names', name: 'Name', capitalizedOnly: true, words: readList('first-names.txt') },
      { id: 'surnames', name: 'Surname', capitalizedOnly: true, words: readList('surnames.txt') }
    ],
    compiledExceptions: readList('exceptions.txt')
  };
  const text = 'Hi Claude, from Sarah Johnson at Northwind Traders about Project Phoenix.\n' +
    'Server HOOLI_DC (hooli.local), meeting 987654321098765, code Xq7mP2vL. Our API returns JSON, see report.pdf and v1.2.3.';
  assert.deepEqual(E.suggest(text, settings).map((s) => [s.value, s.kind]), [
    ['Northwind Traders', 'name'],
    ['Project Phoenix', 'name'],
    ['HOOLI_DC', 'code'],
    ['hooli.local', 'host'],
    ['987654321098765', 'number'],
    ['Xq7mP2vL', 'code']
  ]);
  // Dismissed values and placeholders are not suggested again.
  assert.deepEqual(E.suggest('[COMPANY_1] and Northwind Traders', settings, ['northwind traders']), []);
});

test('allowlist: never obfuscated by rules or lists, but memory still applies', () => {
  const settings = {
    ...base(),
    allowlist: ['support@example.com', 'Acme'],
    compiledWordlists: [{ id: 'mem:Client', name: 'Client', ignoreExceptions: true, words: ['Acme'] }],
    compiledExceptions: []
  };
  assert.equal(E.obfuscate('Mail support@example.com or jane@example.com about Acme', settings, E.createSession()).text,
    'Mail support@example.com or [EMAIL_1] about [CLIENT_1]');
});

test('hostile input does not make the default rules backtrack', () => {
  const settings = base();
  for (const text of ['a@' + 'a.'.repeat(40000), 'a'.repeat(40000) + '@']) {
    const t0 = Date.now();
    E.findAll(text, settings);
    assert.ok(Date.now() - t0 < 200, 'too slow');
  }
});

test('outdated default patterns are upgraded, edited ones are kept; imported rules are sanitized', () => {
  const old = '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}';
  const merged = globalThis.trellisMergeSettings({ rules: [{ id: 'email', pattern: old }, { id: 'mine', pattern: 'x+' }] });
  assert.equal(merged.rules[0].pattern, globalThis.TRELLIS_DEFAULTS.rules.find((r) => r.id === 'email').pattern);
  assert.equal(merged.rules[1].pattern, 'x+');
  const rule = globalThis.trellisSanitizeRule(JSON.parse('{"pattern":"a","flags":"gi<x>","__proto__":{"polluted":1},"extra":true}'));
  assert.deepEqual(Object.keys(rule).sort(), ['enabled', 'flags', 'id', 'name', 'pattern', 'replacement', 'type']);
  assert.equal(rule.flags, 'gi');
  assert.equal({}.polluted, undefined);
  assert.equal(globalThis.trellisSanitizeRule({ pattern: 1 }), null);
});

test('validators: card, IBAN, Spanish ID, JWT and international phone checksums', () => {
  const ok = (name, value) => E.validate(name, value);
  assert.ok(ok('luhn', '4111 1111 1111 1111') && ok('luhn', '3782 822463 10005'));
  assert.ok(!ok('luhn', '1234 5678 9012 3456'));
  assert.ok(ok('iban', 'ES91 2100 0418 4502 0005 1332') && ok('iban', 'GB82WEST12345698765432'));
  assert.ok(!ok('iban', 'ES91 2100 0418 4502 0005 1333'));
  assert.ok(ok('dni-es', '12345678Z') && ok('dni-es', 'X1234567L') && ok('dni-es', '12345678-z'));
  assert.ok(!ok('dni-es', '12345678A'));
  assert.ok(ok('jwt', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.x') && !ok('jwt', 'eyJmb28iOjF9.eyJ4IjoxfQ.x'));
  assert.ok(ok('phone-intl', '+1 415 555 0100') && !ok('phone-intl', '+44 20'));
  assert.ok(ok('unknown-validator', 'anything'), 'an unknown validator does not drop matches');
  // Matches failing their validator are not obfuscated
  assert.equal(run('order 1234 5678 9012 3456, IBAN ES91 2100 0418 4502 0005 1333, ID 12345678A'),
    'order 1234 5678 9012 3456, IBAN ES91 2100 0418 4502 0005 1333, ID 12345678A');
  assert.equal(run('Amex 3782 822463 10005'), 'Amex [CARD_1]');
});

test('API key formats from many providers; no false positives on hashes and ids', () => {
  // Built at run time so no token-shaped literal is in the repository.
  const r = (n, set = 'abcdefghijklmnopqrstuvwxyz0123456789') => Array.from({ length: n }, (_, i) => set[(i * 7 + 3) % set.length]).join('');
  const hex = (n) => r(n, '0123456789abcdef');
  const tokens = [
    'sk' + '_live_' + r(24), 'glpat' + '-' + r(20), 'npm' + '_' + r(36), 'hf' + '_' + r(34, 'abcdefghijklmnopqrstuvwxyzABCDEFGH'),
    'xapp' + '-1-' + r(20).toUpperCase(), 'SG' + '.' + r(22) + '.' + r(43), 'SK' + hex(32), 'shpat' + '_' + hex(32),
    'dop' + '_v1_' + hex(64), '123456789' + ':AA' + r(33), 'hvs' + '.' + r(95), 'xox' + 'b-' + r(24), 'gh' + 'p_' + r(36)
  ];
  for (const t of tokens) assert.equal(run(`key ${t} end`), 'key [API_KEY_1] end', t.slice(0, 6));
  for (const t of ['commit 3f786850e387550fdab836ed7e6dc881de23001b', 'id 550e8400-e29b-41d4-a716-446655440000', 'skip_live_test', 'the npm_config value']) {
    assert.equal(run(t), t);
  }
});

test('URL passwords, Authorization headers, webhooks and international phones', () => {
  assert.equal(run('postgres://app:' + 'S3cr3tPass@db.internal:5432/x'), 'postgres://app:[PASSWORD_1]@db.internal:5432/x');
  assert.equal(run('https://user@host.example.com/x'), 'https://user@host.example.com/x');
  assert.equal(run('mailto:jane.doe@example.com'), 'mailto:[EMAIL_1]');
  assert.equal(run('Authorization: Bearer ' + 'abcDEF123456789xyz'), 'Authorization: Bearer [TOKEN_1]');
  assert.equal(run('curl -H "authorization: basic ' + 'dXNlcjpwYXNzd29yZA=="'), 'curl -H "authorization: basic [TOKEN_1]"');
  assert.equal(run('hook https://hooks.' + 'slack.com/services/T0000/B0000/' + 'x'.repeat(24)), 'hook [WEBHOOK_1]');
  assert.equal(run('call +44 20 7946 0958 or +34 612 345 678'), 'call [PHONE_1] or [PHONE_2]');
  for (const t of ['v+1.2.3', 'UTC+0100', '+44 20', 'a+b=c']) assert.equal(run(t), t);
});

test('HTTP traffic: Cookie and Set-Cookie values, and user names when that rule is on', () => {
  const http = 'Cookie: sessionid=' + 'abc123XYZ; theme=dark\nSet-Cookie: sid=' + 's%3AxYz987; Path=/; HttpOnly; SameSite=Lax';
  assert.equal(run(http), 'Cookie: sessionid=[COOKIE_1]; theme=[COOKIE_2]\nSet-Cookie: sid=[COOKIE_3]; Path=/; HttpOnly; SameSite=Lax');
  assert.equal(run('the cookie jar: theme=dark'), 'the cookie jar: theme=dark', 'only in header lines');
  assert.equal(run('login=jdoe'), 'login=jdoe', 'user names are off by default');
  const rules = base().rules.map((r) => (r.id === 'user-assign' ? { ...r, enabled: true } : r));
  assert.equal(run('username=jdoe&next=1\nuser: admin\nn = user_count(3)', { rules }), 'username=[USER_1]&next=1\nuser: [USER_2]\nn = user_count(3)');
});

test('hashed word lists: terms are matched by fingerprint, never stored', () => {
  const crypto = require('node:crypto');
  const key = crypto.randomBytes(32);
  const hash = (k) => crypto.createHmac('sha256', key).update(k).digest('hex');
  const terms = ['Northwind Traders', 'José Núñez de la Cruz', 'initech'];
  const list = { id: 'kw', name: 'Client', hash, hashes: terms.map((t) => hash(E.keywordKey(t))), maxWords: 5 };
  assert.ok(!JSON.stringify(list.hashes).includes('Northwind'));
  const out = run('Mail NORTHWIND  traders and jose nunez de la cruz; Initech-hosted, not Initechs', { compiledWordlists: [list] });
  assert.equal(out, 'Mail [CLIENT_1] and [CLIENT_2]; [CLIENT_3]-hosted, not Initechs');
  assert.equal(run('no hashes here', { compiledWordlists: [{ ...list, hashes: [] }] }), 'no hashes here');
});

test('stored rules are upgraded: new defaults added unless deleted, validators added, outdated patterns replaced', () => {
  const D = globalThis.TRELLIS_DEFAULTS.rules;
  const stored = [
    { id: 'card', name: 'Card', type: 'regex', pattern: globalThis.TRELLIS_OUTDATED_PATTERNS.card[0], flags: 'g', enabled: false },
    { id: 'iban', name: 'IBAN', type: 'regex', pattern: 'my own', flags: 'g', enabled: true },
    { id: 'mine', name: 'Mine', type: 'keyword', pattern: 'x', enabled: true }
  ];
  const rules = globalThis.trellisMergeSettings({ rules: stored, dismissedRules: ['ipv4', 'webhook'] }).rules;
  const byId = Object.fromEntries(rules.map((x) => [x.id, x]));
  assert.equal(byId.card.pattern, D.find((x) => x.id === 'card').pattern);
  assert.equal(byId.card.enabled, false, 'user choices are kept');
  assert.equal(byId.card.validate, 'luhn');
  assert.equal(byId.iban.pattern, 'my own', 'edited patterns are kept');
  assert.equal(byId.iban.validate, 'iban');
  assert.ok(byId['url-password'] && byId['phone-intl'] && byId['auth-header']);
  assert.equal(byId.ipv4, undefined);
  assert.equal(byId.webhook, undefined);
  assert.deepEqual(rules.slice(0, 3).map((x) => x.id), ['card', 'iban', 'mine'], 'stored order first');
  const kept = globalThis.trellisSanitizeRule({ pattern: 'a', validate: 'luhn' });
  assert.equal(kept.validate, 'luhn');
  assert.equal(globalThis.trellisSanitizeRule({ pattern: 'a', validate: 'eval' }).validate, undefined);
});

test('the store package contains everything the extension references', () => {
  const { execFileSync } = require('node:child_process');
  const out = execFileSync('node', [path.join(__dirname, '..', 'scripts', 'package.js')], { encoding: 'utf8' });
  assert.match(out, /trellis-\d+\.\d+\.\d+\.zip: \d+ files/);
  const listing = execFileSync('unzip', ['-Z1', out.split(':')[0]], { cwd: path.join(__dirname, '..'), encoding: 'utf8' }).split('\n');
  for (const f of ['manifest.json', 'content.js', 'panel.html', 'welcome.html', 'icons/icon128.png', 'wordlists/first-names.txt']) {
    assert.ok(listing.includes(f), `missing ${f}`);
  }
  assert.ok(!listing.some((f) => f.startsWith('test/') || f.startsWith('node_modules/') || f.startsWith('docs/')));
});

test('Chrome Web Store publishing: the service account assertion is a valid RS256 JWT', () => {
  const crypto = require('node:crypto');
  const { buildAssertion } = require('../scripts/publish-chrome.js');
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const key = { client_email: 'publisher@project.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
  const jwt = buildAssertion(key, 1000);
  const [header, claims, signature] = jwt.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(header, 'base64url')), { alg: 'RS256', typ: 'JWT' });
  assert.deepEqual(JSON.parse(Buffer.from(claims, 'base64url')), {
    iss: key.client_email,
    scope: 'https://www.googleapis.com/auth/chromewebstore',
    aud: 'https://oauth2.googleapis.com/token',
    iat: 1000,
    exp: 4600
  });
  assert.ok(crypto.verify('RSA-SHA256', Buffer.from(`${header}.${claims}`), publicKey, Buffer.from(signature, 'base64url')));
});

test('Chrome Web Store publishing refuses to run without its configuration', () => {
  const { spawnSync } = require('node:child_process');
  const r = spawnSync('node', [path.join(__dirname, '..', 'scripts', 'publish-chrome.js'), path.join(__dirname, '..', 'manifest.json')],
    { env: { PATH: process.env.PATH }, encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /missing environment variable CWS_SERVICE_ACCOUNT_KEY/);
});

test('AMO metadata has what the first listed submission requires', () => {
  const meta = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'docs', 'store', 'amo-metadata.json'), 'utf8'));
  assert.deepEqual(meta.categories, { firefox: ['privacy-security'] });
  assert.ok(meta.summary['en-US'].length <= 250);
  assert.equal(meta.version.license, 'MIT');
});
