// Chrome refuses to load an extension script that contains Unicode noncharacters (U+FFFE, U+FFFF,
// U+FDD0–U+FDEF...), reporting it as "not UTF-8", and then no content script is registered at all.
const fs = require('node:fs');
const files = fs.readdirSync('.').filter((f) => /\.(js|html|css|json)$/.test(f));
let bad = 0;
for (const f of files) {
  const text = fs.readFileSync(f, 'utf8');
  for (const ch of text) {
    const c = ch.codePointAt(0);
    if ((c >= 0xfdd0 && c <= 0xfdef) || (c & 0xfffe) === 0xfffe || c === 0xfffd) {
      console.error(`${f}: contains U+${c.toString(16).toUpperCase()}`);
      bad++;
      break;
    }
  }
}
process.exit(bad ? 1 : 0);
