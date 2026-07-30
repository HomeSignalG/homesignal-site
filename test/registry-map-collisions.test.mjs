// Guard for the case-insensitive registry lookup: no map in the LIVE registry may have two
// keys that collapse to the same normalized form (trim + case-fold) while pointing at
// DIFFERENT targets. Such a pair is unresolvable — the lookup cannot choose a bucket or a
// use_type — so the shipped builders throw on it and the entry is quarantined at run time.
//
// This file is the LOUD half of that guard: it drives the SHIPPED builders
// (sources/socrata.ts) over every entry of jurisdiction-registry.json, so a collision
// introduced by a future registry edit goes red in CI *before* it can reach production,
// rather than surfacing as one silently source-less page.
//
// BENIGN duplicates (two spellings of one value → the SAME target, e.g.
// dallas-specific-use-permits' 'Private School' / 'Private school' / 'private school' →
// Civic/Public) are legal and keep first-wins. They are counted and printed, not failed —
// with case-insensitive lookup they are simply redundant.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0;
const ok = (c, name, detail) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name + (!c && detail ? '\n     ' + detail : ''));
  if (!c) fails++;
};

const SRC = join(root, 'supabase/functions/get-address-report/sources/socrata.ts');
let buildBucketLookup, buildTypeLookup, normKey, RegistryMapCollisionError;
try {
  ({ buildBucketLookup, buildTypeLookup, normKey, RegistryMapCollisionError } = await import(SRC));
} catch (err) {
  console.log('FAIL — import sources/socrata.ts (needs Node >= 22.18 type stripping)\n     ' + err.message);
  process.exit(1);
}

const REG = JSON.parse(readFileSync(join(root, 'supabase/functions/get-address-report/jurisdiction-registry.json'), 'utf8'));
const FAMILIES = ['socrata', 'arcgis', 'ckan', 'csv', 'carto', 'opendatasoft'];
const entries = FAMILIES.flatMap((f) => (Array.isArray(REG[f]) ? REG[f] : []));
ok(entries.length > 100, `registry carries ${entries.length} entries across ${FAMILIES.length} families`);

// ── 1. Every live map builds — no unresolvable collision anywhere ────────────────
const collisions = [];
let statusMaps = 0, typeMaps = 0;
for (const e of entries) {
  if (e.status_to_bucket) {
    statusMaps++;
    try { buildBucketLookup(e.status_to_bucket, e.registry_id); }
    catch (err) { collisions.push(`${e.registry_id} status_to_bucket: ${err.message}`); }
  }
  if (e.type_map) {
    typeMaps++;
    try { buildTypeLookup(e.type_map, e.registry_id); }
    catch (err) { collisions.push(`${e.registry_id} type_map: ${err.message}`); }
  }
}
ok(collisions.length === 0,
  `all ${statusMaps} status_to_bucket + ${typeMaps} type_map maps build with no unresolvable collision`,
  collisions.join('\n     '));

// ── 2. Benign duplicate census — printed, never failed ───────────────────────────
{
  const benign = [];
  for (const e of entries) {
    const groups = (pairs, mapName) => {
      const seen = new Map();
      for (const [k, v] of pairs) {
        const nk = normKey(k);
        if (!seen.has(nk)) seen.set(nk, []);
        seen.get(nk).push([String(k).trim(), v]);
      }
      for (const [nk, g] of seen) {
        if (g.length > 1) benign.push(`${e.registry_id} ${mapName} "${nk}" ← ${JSON.stringify(g)}`);
      }
    };
    if (e.status_to_bucket) {
      groups(['proposed', 'approved', 'operating', 'exclude']
        .flatMap((b) => (e.status_to_bucket[b] ?? []).map((s) => [s, b])), 'status_to_bucket');
    }
    if (e.type_map) groups(Object.entries(e.type_map), 'type_map');
  }
  // Every group here maps to ONE target (otherwise check 1 would have failed), so this is
  // informational: the count only ever tells us how much redundancy the maps still carry.
  console.log(`INFO — ${benign.length} benign case/whitespace-duplicate key group(s) in the live registry`);
  for (const b of benign.slice(0, 8)) console.log('       ' + b);
  if (benign.length > 8) console.log(`       … and ${benign.length - 8} more`);
  ok(true, 'benign duplicates are legal (same target, first wins) — reported, not failed');
}

// ── 3. The guard actually fires on a conflicting pair (so green means something) ──
{
  let threw = null;
  try {
    buildBucketLookup({ approved: ['Issued'], exclude: ['ISSUED'] }, 'synthetic-conflict');
  } catch (err) { threw = err; }
  ok(threw instanceof RegistryMapCollisionError,
    'a status key colliding across DIFFERENT buckets throws RegistryMapCollisionError',
    threw ? threw.message : 'no throw');
  ok(!!threw && /synthetic-conflict/.test(threw.message) && /status_to_bucket/.test(threw.message),
    'the error names the registry_id and the map', threw ? threw.message : '');
}
{
  let threw = null;
  try {
    buildTypeLookup({ 'New Building': 'Residential', 'NEW BUILDING': 'Commercial' }, 'synthetic-conflict');
  } catch (err) { threw = err; }
  ok(threw instanceof RegistryMapCollisionError,
    'a type_map key colliding onto a DIFFERENT use_type throws RegistryMapCollisionError',
    threw ? threw.message : 'no throw');
}
{
  // Same target → must NOT throw (this is the shape 56 live maps already carry).
  let threw = null;
  try { buildTypeLookup({ 'Private School': 'Civic/Public', 'private school': 'Civic/Public' }, 'synthetic-benign'); }
  catch (err) { threw = err; }
  ok(threw === null, 'a duplicate collapsing onto the SAME target does not throw');
}

console.log(fails ? `\n${fails} registry-map-collision assertion(s) FAILED.` : '\nAll registry-map-collision assertions passed.');
process.exit(fails ? 1 : 0);
