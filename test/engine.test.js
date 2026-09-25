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
