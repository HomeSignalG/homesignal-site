// Offline registry invariant: A TYPE MAP MUST BE REACHABLE.
//
// WHY. `use_type` drives the pin SHAPE on all three map views. The connector resolves it by
// reading `column_map.type_source` off each record and looking the value up in `type_map`. If
// those two halves disagree, the failure is SILENT — every record emits `use_type:"unclassified"`,
// nothing errors, CI stays green, and the only symptom is a page full of generic circles. That is
// how four entries reached production carrying 265,351 unclassified records between them.
//
// SCOPE — deliberately narrow. This asserts only the UNAMBIGUOUS condition: a `type_map` that no
// `type_source` can ever feed. It does NOT try to infer which column *should* be the source.
// That is a judgment call — `clv-planning-cases` is correctly typeless (its only categorical
// field carries opaque application codes with no published domain), and a checker that guessed
// would fail it wrongly and train people to ignore the check.
//
// NOT CHECKABLE HERE, ON PURPOSE: "a `type_source` naming a field that no record carries" is the
// same defect class in the opposite direction — it is what the DeKalb wrong-column case looked
// like from the outside — but it cannot be answered offline. The registry does not know the
// layer's field list; only a live probe does. That assertion belongs in the nightly
// `source-monitor` (which already fetches each layer's `?f=json`), not in a unit test that would
// have to invent the answer. Recorded here so the gap is visible rather than assumed covered.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0;
const ok = (c, name, detail) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name + (!c && detail ? '\n     ' + detail : ''));
  if (!c) fails++;
};

const registry = JSON.parse(readFileSync(
  join(root, 'supabase/functions/get-address-report/jurisdiction-registry.json'), 'utf8'));

// Collect on registry_id ALONE. Keying on service_url is what made an earlier guard blind to
// every socrata/ckan/csv/carto entry — 27 of 183 — while its own control reported success.
const entries = [];
(function walk(node) {
  if (Array.isArray(node)) { node.forEach(walk); return; }
  if (node && typeof node === 'object') {
    if (typeof node.registry_id === 'string') entries.push(node);
    Object.values(node).forEach(walk);
  }
})(registry);

ok(entries.length >= 180, `registry traversed — ${entries.length} entries`,
   `found only ${entries.length}; the walk is not seeing the whole entry list`);
const nonArcgis = entries.filter((e) => e.platform && e.platform !== 'arcgis').length;
ok(nonArcgis >= 20, `traversal sees ${nonArcgis} non-arcgis entries`,
   `only ${nonArcgis}; the walk is arcgis-blind`);

// What counts as a USABLE type_source.
//
// ⚠️ AN ARRAY IS LEGITIMATE, and asserting "must be a string" is a FALSE POSITIVE that this very
// test shipped with for one draft. `readCol` (sources/arcgis.ts:791) JOINS an array of columns
// with a space rather than falling back between them, and
// `york-county-pa-planning-subdivisions` USES that on purpose: type_source is eight boolean
// columns (IND_USE, COM_USE, MF_USE, MHP_USE, SR_USE, AG_USE, SF_USE, OTHER_USE) and its 32
// type_map keys are exactly the joined strings — 'NO NO NO NO NO NO YES NO' and friends. That is
// a multi-column boolean matrix encoded as one lookup key, and it works.
// `null` is treated as ABSENT, because that is exactly how the connector treats it.
const usableSource = (src) => (typeof src === 'string' && src.trim() !== '')
  || (Array.isArray(src) && src.length > 0 && src.every((c) => typeof c === 'string' && c.trim() !== ''));

// ── THE INVARIANT ────────────────────────────────────────────────────────────────────────────
// A type_map with no usable type_source can never fire. Every one of its keys is dead weight and
// every record the entry emits is unclassified.
const orphanMaps = entries.filter((e) => {
  const hasMap = e.type_map && typeof e.type_map === 'object' && Object.keys(e.type_map).length > 0;
  return hasMap && !usableSource((e.column_map || {}).type_source);
}).map((e) => `${e.registry_id} — ${Object.keys(e.type_map).length} map keys, no usable column_map.type_source`);

ok(orphanMaps.length === 0,
   'every type_map is reachable via a column_map.type_source',
   orphanMaps.join('\n     '));

// A declared type_source must be usable. An empty string, an empty array, or an array with a
// blank member reads as "configured" to a human skimming the file while behaving like absent.
// `null` and `undefined` are honest absence and are NOT flagged.
const badSources = entries.filter((e) => {
  const src = (e.column_map || {}).type_source;
  if (src === undefined || src === null) return false;
  return !usableSource(src);
}).map((e) => `${e.registry_id} — unusable type_source: ${JSON.stringify((e.column_map || {}).type_source)}`);

ok(badSources.length === 0,
   'every declared type_source is a usable field name or array of field names',
   badSources.join('\n     '));

// ── THE SECOND INVARIANT: a type_source must SURVIVE the out_fields projection ───────────────
//
// SHIPPED DEFECT, 2026-08-07, caught only by measuring after deploy. `out_fields` is an optional
// column whitelist (added for dense/slow layers to bound row size). Both burlington-vt entries
// carried one, and `type_source: "PrimaryLUC"` was wired WITHOUT adding PrimaryLUC to it — so the
// connector never fetched the column, read null on every row, and emitted 100% unclassified
// behind a correct, fully-verified, completely unreachable 20-key map. 13,307 + 3,913 records.
//
// The first invariant above could not see this: the map HAS a source, the source IS a real field
// name. The break is that the projection silently removes it. Same failure signature as the
// orphan map (everything unclassified, nothing errors), different cause — so it needs its own
// assertion rather than a widened one.
const projectionDrops = entries.filter((e) => {
  const src = (e.column_map || {}).type_source;
  const of = e.out_fields;
  if (!usableSource(src) || !Array.isArray(of) || of.length === 0) return false;
  const need = Array.isArray(src) ? src : [src];
  return need.some((c) => !of.includes(c));
}).map((e) => {
  const src = (e.column_map || {}).type_source;
  const need = (Array.isArray(src) ? src : [src]).filter((c) => !e.out_fields.includes(c));
  return `${e.registry_id} — type_source ${JSON.stringify(need)} not in out_fields, so it is never fetched`;
});

ok(projectionDrops.length === 0,
   'every type_source column survives the entry\'s out_fields projection',
   projectionDrops.join('\n     '));

// ── SELF-TEST: the detector must be able to fail ─────────────────────────────────────────────
// Without this the two assertions above would pass vacuously on a registry where the shape can
// no longer occur, and nobody would notice the check had stopped meaning anything.
{
  const synthetic = [
    { registry_id: 'synthetic-orphan-map', type_map: { A: 'Residential' }, column_map: { title: 't' } },
    { registry_id: 'synthetic-empty-src', type_map: { A: 'Residential' }, column_map: { type_source: '   ' } },
  ];
  const caughtOrphan = synthetic.filter((e) => {
    const hasMap = e.type_map && Object.keys(e.type_map).length > 0;
    return hasMap && !usableSource((e.column_map || {}).type_source);
  }).length;
  ok(caughtOrphan === 2, 'SELF-TEST: the detector flags both orphan shapes',
     `caught ${caughtOrphan} of 2 — the predicate has drifted and no longer detects the defect`);
  // The inverse control: a legitimate ARRAY type_source must NOT be flagged. Without this the
  // string-only predicate that produced a false positive on York County could come back unseen.
  const arrayOk = usableSource(['IND_USE', 'COM_USE']) && !usableSource([]) && !usableSource(['IND_USE', '  ']);
  ok(arrayOk, 'SELF-TEST: an array type_source is accepted, an empty/blank-member array is not',
     'the array predicate is wrong — York County would be failed as a false positive again');
  // SELF-TEST for the projection check, in both directions.
  const drops = (src, of) => {
    const need = Array.isArray(src) ? src : [src];
    return Array.isArray(of) && of.length > 0 && need.some((c) => !of.includes(c));
  };
  ok(drops('PrimaryLUC', ['OBJECTID', 'Latitude']) === true
     && drops('PrimaryLUC', ['OBJECTID', 'PrimaryLUC']) === false
     && drops(['A', 'B'], ['A']) === true
     && drops('Anything', undefined) === false,
     'SELF-TEST: the projection check flags a dropped column and clears a present one',
     'the projection predicate has drifted — the Burlington out_fields defect would ship again');
}

// ── INFORMATIONAL, never a failure ───────────────────────────────────────────────────────────
// The opposite shape — a type_source with NO type_map — is also 100%-unclassified by
// construction, but it is not always a defect: an entry can legitimately carry a source column
// while its vocabulary is still being verified. It is reported so it stays visible, and is
// deliberately NOT failed, because failing it would block on entries with no page surface.
const sourceNoMap = entries.filter((e) => {
  const hasMap = e.type_map && Object.keys(e.type_map || {}).length > 0;
  return usableSource((e.column_map || {}).type_source) && !hasMap;
}).map((e) => `${e.registry_id} (type_source=${e.column_map.type_source})`);
if (sourceNoMap.length) {
  console.log(`NOTE — ${sourceNoMap.length} entr(y|ies) declare a type_source with no type_map, so they emit`);
  console.log(`       100% unclassified by construction (informational, not a failure):`);
  for (const s of sourceNoMap) console.log(`         · ${s}`);
}

console.log(fails === 0 ? '\nAll checks passed.' : `\n${fails} check(s) failed.`);
process.exit(fails === 0 ? 0 : 1);
