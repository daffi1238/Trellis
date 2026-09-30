// Sets the same version in manifest.json, package.json and package-lock.json.
//   node scripts/bump-version.js 2.8.0
// Then: git commit -am "Release 2.8.0" && git tag v2.8.0 && git push && git push --tags
const fs = require('node:fs');
const path = require('node:path');

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version || '')) {
  console.error('Usage: node scripts/bump-version.js <major.minor.patch>');
  process.exit(1);
}
const root = path.join(__dirname, '..');
for (const file of ['manifest.json', 'package.json', 'package-lock.json']) {
  const p = path.join(root, file);
  if (!fs.existsSync(p)) continue;
  const json = JSON.parse(fs.readFileSync(p, 'utf8'));
  json.version = version;
  if (file === 'package-lock.json' && json.packages?.['']) json.packages[''].version = version;
  fs.writeFileSync(p, JSON.stringify(json, null, 2) + '\n');
}
console.log(`Version ${version}. Next: commit, then tag v${version} and push the tag to release.`);
