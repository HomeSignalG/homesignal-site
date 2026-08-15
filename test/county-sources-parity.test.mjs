// lib/generated/county-sources.json must be EXACTLY what the registry produces.
//
// WHY THIS IS THE LOAD-BEARING TEST. The empty-state copy names the sources we track for a
// county. That is only self-clearing if regenerating this file is part of the same commit
// that edits the registry — otherwise wiring a source leaves the page still saying "we have
// not identified a source", which is the second manual step the whole design exists to
// remove. This test is what makes the two physically inseparable: edit the registry without
// running the generator and CI goes red.
//
// It also proves the generator ran over what we think it ran over — a byte comparison
// against a freshly built object, not a spot check of a few keys.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCountySources, readRegistry, serialize } from '../scripts/gen-county-sources.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];

const registry = readRegistry();
const fresh = buildCountySources(registry);
const onDisk = readFileSync(join(root, 'lib/generated/county-sources.json'), 'utf8');

if (serialize(fresh) !== onDisk) {
  failures.push('lib/generated/county-sources.json is stale — run `node scripts/gen-county-sources.mjs` '
    + 'in the SAME commit as the registry edit');
}

// Denominator check: a generator that silently produced nothing would pass a byte
// comparison against a file it also wrote. Assert the corpus is the size we expect it to be.
const entryCount = Object.entries(registry)
  .filter(([k]) => !k.startsWith('_'))
  .reduce((n, [, v]) => n + v.length, 0);
if (fresh.registry_entries !== entryCount) {
  failures.push(`registry_entries ${fresh.registry_entries} != ${entryCount} counted from the registry`);
}
if (entryCount < 150) failures.push(`only ${entryCount} registry entries read — the registry did not load`);
if (Object.keys(fresh.counties).length < 100) {
  failures.push(`only ${Object.keys(fresh.counties).length} counties mapped — expected >100`);
}

// Every label must come from a real jurisdiction string, never an id. An id leaking into
// resident-facing copy is the "opaque code" failure the registry contract already bans.
const jurisdictions = new Set();
for (const [k, v] of Object.entries(registry)) {
  if (k.startsWith('_')) continue;
  for (const e of v) if (e.jurisdiction) jurisdictions.add(String(e.jurisdiction).split(' — ')[0].trim());
}
const allSources = [
  ...Object.values(fresh.counties).flat(),
  ...Object.values(fresh.statewide).flat()
];
for (const s of allSources) {
  if (!jurisdictions.has(s.label)) failures.push(`label not traceable to a jurisdiction string: ${s.label}`);
  if (s.label === s.id) failures.push(`label is the registry id (opaque code): ${s.id}`);
  if (!['statewide', 'city', 'local'].includes(s.scope)) failures.push(`bad scope: ${s.scope}`);
}

// Anchors that pin the two shapes the copy actually branches on. Both were verified
// against the live registry and the live empty-page population on 2026-08-11.
const sandoval = fresh.counties['NM|Sandoval'];
if (!sandoval || sandoval.length !== 1 || sandoval[0].id !== 'albuquerque-building-permits'
    || sandoval[0].scope !== 'city') {
  failures.push('NM|Sandoval must map to albuquerque-building-permits with scope "city" — '
    + 'this is what licenses the "those records cover the city" sentence');
}
if (fresh.counties['NM|Taos']) {
  failures.push('NM|Taos must have NO entry — it is the class (d) anchor (443 pages)');
}
const ak = fresh.statewide['AK'];
if (!ak || ak.length !== 1 || ak[0].id !== 'akdot-stip-24-27' || ak[0].scope !== 'statewide') {
  failures.push('AK statewide must be exactly akdot-stip-24-27 — the class (b) statewide anchor');
}

if (failures.length) {
  console.error(failures.map((f) => `FAIL — ${f}`).join('\n'));
  process.exit(1);
}
console.log(`county-sources parity: ${fresh.registry_entries} entries -> `
  + `${Object.keys(fresh.counties).length} counties + ${Object.keys(fresh.statewide).length} statewide, `
  + 'byte-identical to the generator, every label traceable to a jurisdiction string.');
