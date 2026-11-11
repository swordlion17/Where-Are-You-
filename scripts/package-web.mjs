// Zips dist/ into release/where-are-you-web-<version>.zip for itch.io (index.html at the zip root).
// Run through `npm run package:web`, which builds first.
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { zipSync } from 'fflate';

const DIST = 'dist';
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));

const files = {};
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else files[relative(DIST, path).split(sep).join('/')] = readFileSync(path); // forward slashes, as itch.io expects
  }
})(DIST);

if (!files['index.html']) throw new Error('dist/index.html is missing. Run the build first.');

mkdirSync('release', { recursive: true });
const out = `release/where-are-you-web-${pkg.version}.zip`;
const zip = zipSync(files, { level: 9 });
writeFileSync(out, zip);
const count = Object.keys(files).length;
console.log(`${out}: ${count} files, ${(zip.length / 1024).toFixed(0)} KB`);
