// Offline registry invariant: NO TWO ENTRIES MAY FETCH THE SAME LAYER UNSLICED.
//
// WHY THIS EXISTS (a defect this repo actually shipped, 2026-08-06). A municipal-tier pass
// added `madison-current-planning-projects` pointing at
//   maps.cityofmadison.com/.../Planning/Current_Planning_Projects/MapServer/0
// without noticing that `madison-planning-projects` — same URL, same {WI, Dane} coverage —
// was ALREADY in the registry. Both entries fetched the layer on the same report, and the
// deploy-verification probe for ZIP 53703 came back with two run-reports each emitting ~228
// records: every Madison planning case double-counted on every Dane page.
//
// The additivity check that guarded the change asserted the new `registry_id` was unique.
// That is the wrong key. `registry_id` uniqueness says nothing about what the entry FETCHES,
// and exact-identity dedup (engine v22) cannot collapse the copies because they carry
// different `source_registry_id` values — the same reason `houston-plat-applications` layer 0
// was rejected as a proven subset of layer 1.
//
// THE RULE: two entries may share a `service_url` ONLY when each carries a distinct, non-empty
// `extra_where`, i.e. they are deliberate disjoint slices of one layer. The wsdot-project-
// delivery-plan-{proposed,under-construction,complete} trio is the legitimate case and is what
// this test allows; an unsliced pair is always a double-emit.
//
// This is a guard, not a behaviour change: it reads the shipped registry and asserts. No
// runtime surface.
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

// Collect every object that looks like a source entry, wherever it sits in the file.
//
// ⚠️ WIDENED 2026-08-06. This originally required BOTH `registry_id` AND `service_url`, which
// silently skipped every socrata/ckan/csv/carto entry — those address their source with
// domain+dataset_id, not a service_url. It saw 156 of 183 entries and reported success, and the
// `entries.length > 100` control below passed while 27 entries (15%) went unchecked. The
// double-emit hazard is identical for them: two entries on the same Socrata dataset_id would
// both fetch it and both emit, exactly the Madison defect. Now every entry with a registry_id is
// collected, and the fetch identity is service_url OR domain|dataset_id, whichever it uses.
const entries = [];
(function walk(node) {
  if (Array.isArray(node)) { node.forEach(walk); return; }
  if (node && typeof node === 'object') {
    if (typeof node.registry_id === 'string') entries.push(node);
    Object.values(node).forEach(walk);
  }
})(registry);

// The thing an entry FETCHES, whatever platform it is on. Entries with neither are not
// source entries and are skipped by fetchKey() returning null.
const fetchKey = (e) => (typeof e.service_url === 'string' && e.service_url)
  || ((e.domain && e.dataset_id) ? `${e.domain}|${e.dataset_id}` : null);

// The instrument must prove it ran before its silence counts as evidence.
ok(entries.length >= 180, `registry parsed and traversed — ${entries.length} entries`,
   `found only ${entries.length}; the walk is not seeing the whole entry list`);
// Platform coverage control: the traversal must see NON-arcgis entries too. Asserting a bare
// count is what let the 156-of-183 blind spot pass unnoticed.
const nonArcgis = entries.filter((e) => e.platform && e.platform !== 'arcgis').length;
ok(nonArcgis >= 20, `traversal sees ${nonArcgis} non-arcgis entries (socrata/ckan/csv/carto)`,
   `only ${nonArcgis} non-arcgis entries seen; the walk is arcgis-blind again`);

const ids = entries.map(e => e.registry_id);
ok(new Set(ids).size === ids.length, 'every registry_id is unique',
   `duplicates: ${ids.filter((v, i) => ids.indexOf(v) !== i).join(', ')}`);

const byUrl = new Map();
for (const e of entries) {
  const key = fetchKey(e);
  if (!key) continue;
  if (!byUrl.has(key)) byUrl.set(key, []);
  byUrl.get(key).push(e);
}

const offenders = [];
let slicedGroups = 0;
for (const [url, group] of byUrl) {
  if (group.length === 1) continue;
  const wheres = group.map(e => (e.extra_where || '').trim());
  const allSliced = wheres.every(Boolean) && new Set(wheres).size === wheres.length;
  if (allSliced) { slicedGroups++; continue; }
  offenders.push(`${url}\n       shared by: ${group.map(e => e.registry_id).join(', ')}` +
                 `\n       extra_where: [${wheres.map(w => w || '(none)').join(' | ')}]`);
}

ok(offenders.length === 0,
   'no two entries fetch the same source (service_url, or domain|dataset_id) without disjoint extra_where slices',
   offenders.join('\n     '));

// Positive control: the assertion above is only meaningful if the traversal actually sees a
// shared-URL group. The WSDOT trio is the known legitimate one; if it ever disappears, this
// test would pass vacuously and we want to know.
ok(slicedGroups >= 1,
   `saw ${slicedGroups} legitimate sliced group(s) — the shared-URL path is exercised`,
   'no shared-URL group found at all; the check may be passing vacuously');

console.log(fails === 0 ? '\nAll checks passed.' : `\n${fails} check(s) failed.`);
process.exit(fails === 0 ? 0 : 1);
