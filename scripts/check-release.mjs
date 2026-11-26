#!/usr/bin/env node
// Release guard: fails if a production bundle contains anything that only the PRIVATE store/seed.local.ts contains
// (real data; gitignored). Run before every `eas update` / build: `npm run check:release`.
//
// How: the string literals that appear in seed.local.ts and in NO other source file are the "markers". A fresh
// `npx expo export` (all platforms: web JS and the iOS / Android Hermes bytecode an OTA ships) is searched for each
// marker as UTF-8, as JS \uXXXX escapes, and as UTF-16LE (Hermes stores non-ASCII strings that way).
//
// It NEVER prints a marker: only counts, and for a hit the marker's index and a short SHA-256 prefix.
//
//   npm run check:release                 export to a temp dir, then scan it
//   node scripts/check-release.mjs <dir>  scan an existing export instead
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// fileURLToPath, not URL.pathname: a path with spaces would come out %20-encoded and the seed would look absent.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const seedPath = path.join(root, 'store', 'seed.local.ts');

if (!fs.existsSync(seedPath)) {
  console.log('check:release — no store/seed.local.ts on this machine: nothing private to leak. PASS');
  process.exit(0);
}

// --- markers: literals only seed.local.ts has --------------------------------------------------------------------
const seed = fs.readFileSync(seedPath, 'utf8');
const literals = new Set();
for (const m of seed.matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)) {
  const value = (m[1] ?? m[2] ?? m[3] ?? '').trim();
  if (value) literals.add(value);
}
const sourceDirs = ['app', 'components', 'constants', 'store', 'utils', 'tests', 'hooks'].map((d) => path.join(root, d));
const otherSources = [];
const walk = (dir) => {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p);
    else if (/\.(ts|tsx|js|mjs|json)$/.test(entry.name) && path.resolve(p) !== path.resolve(seedPath)) otherSources.push(fs.readFileSync(p, 'utf8'));
  }
};
sourceDirs.forEach(walk);
const elsewhere = otherSources.join('\n');
const hasNonAscii = (s) => /[^\x00-\x7f]/.test(s);
const markers = [...literals].filter((s) => {
  if (elsewhere.includes(s)) return false; // shared with app code (category ids, …): not private
  if (!/[A-Za-z؀-ۿ]/.test(s)) return false; // numbers, dates, punctuation: too generic
  return hasNonAscii(s) ? s.length >= 3 : s.length >= 8; // short Latin words may occur in libraries
});
if (markers.length === 0) {
  console.error('check:release — found no private markers in store/seed.local.ts; cannot verify. FAIL (check the extraction).');
  process.exit(2);
}

// --- the export ---------------------------------------------------------------------------------------------------
let outDir = process.argv[2];
if (!outDir) {
  outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wealth-release-check-'));
  console.log(`check:release — exporting production bundles (all platforms) to a temp dir…`);
  execSync(`npx expo export --output-dir "${outDir}"`, { cwd: root, stdio: ['ignore', 'ignore', 'inherit'], env: { ...process.env, CI: '1' } });
}
const files = [];
const collect = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) collect(p);
    else if (/\.(js|hbc|bundle|json|map|html)$/.test(entry.name) || !path.extname(entry.name)) files.push(p);
  }
};
collect(outDir);
const bundles = files.filter((f) => /\.(js|hbc|bundle)$/.test(f) || /_expo[\\/]static[\\/]js/.test(f));
if (bundles.length === 0) {
  console.error(`check:release — no bundle files found in ${outDir}. FAIL`);
  process.exit(2);
}

// --- search -------------------------------------------------------------------------------------------------------
const escaped = (s, upper) =>
  [...s].map((ch) => (ch.charCodeAt(0) < 128 ? ch : `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')[upper ? 'toUpperCase' : 'toLowerCase']()}`)).join('');
const forms = (s) => {
  const out = [Buffer.from(s, 'utf8'), Buffer.from(s, 'utf16le')];
  if (hasNonAscii(s)) out.push(Buffer.from(escaped(s, false), 'utf8'), Buffer.from(escaped(s, true), 'utf8'));
  return out;
};
const hash = (s) => createHash('sha256').update(s).digest('hex').slice(0, 10);

// Control: the scan must be able to SEE strings at all. The committed, synthetic seed.example.ts is what production
// ships, so strings only it has must be found; if not (e.g. a bundle format that hides strings), fail instead of
// passing blindly.
const examplePath = path.join(root, 'store', 'seed.example.ts');
const example = fs.existsSync(examplePath) ? fs.readFileSync(examplePath, 'utf8') : '';
// Strings that are certainly bundled: the app's Arabic error messages (committed code; proves non-ASCII text is
// readable in every format, UTF-8 JS and Hermes UTF-16) and the example seed's longer strings (production's seed).
// Strings the private seed shares are left out.
const messages = fs.readFileSync(path.join(root, 'utils', 'errorMessages.ts'), 'utf8');
const literalsOf = (src) => [...src.matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"/g)].map((m) => (m[1] ?? m[2] ?? '').trim());
const controls = [
  ...new Set([
    ...literalsOf(messages).filter((s) => /[؀-ۿ]/.test(s) && s.length >= 8 && !s.includes('${')).slice(0, 10),
    ...literalsOf(example).filter((s) => /[A-Za-z]/.test(s) && s.length >= 8),
  ]),
].filter((s) => !seed.includes(s));
const seen = controls.filter((c) => bundles.some((f) => forms(c).some((form) => fs.readFileSync(f).includes(form))));
if (controls.length > 0 && seen.length === 0) {
  console.error('check:release — FAIL: the scan could not find even the example seed in the bundles; it cannot be trusted.');
  process.exit(2);
}
const hits = [];
for (const file of bundles) {
  const content = fs.readFileSync(file);
  markers.forEach((marker, index) => {
    if (forms(marker).some((form) => content.includes(form))) hits.push({ index, hash: hash(marker), file: path.relative(outDir, file) });
  });
}

console.log(`check:release — ${markers.length} private markers, ${bundles.length} bundle files scanned; control: ${seen.length}/${controls.length} known-bundled strings visible.`);
if (hits.length > 0) {
  const distinct = new Set(hits.map((h) => h.index)).size;
  console.error(`check:release — FAIL: ${distinct} private marker(s) found in the bundles (${hits.length} hit(s)). Do NOT publish.`);
  for (const h of hits.slice(0, 20)) console.error(`  marker #${h.index} (sha256 ${h.hash}…) in ${h.file}`);
  process.exit(1);
}
console.log('check:release — PASS: nothing from store/seed.local.ts is in the bundles.');
