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
const entries = [];
(function walk(node) {
  if (Array.isArray(node)) { node.forEach(walk); return; }
  if (node && typeof node === 'object') {
    if (typeof node.registry_id === 'string' && typeof node.service_url === 'string') entries.push(node);
    Object.values(node).forEach(walk);
  }
})(registry);

// The instrument must prove it ran before its silence counts as evidence.
ok(entries.length > 100, `registry parsed and traversed — ${entries.length} entries with a service_url`,
   `found only ${entries.length}; the walk is not seeing the entry list`);

const ids = entries.map(e => e.registry_id);
ok(new Set(ids).size === ids.length, 'every registry_id is unique',
   `duplicates: ${ids.filter((v, i) => ids.indexOf(v) !== i).join(', ')}`);

const byUrl = new Map();
for (const e of entries) {
  if (!byUrl.has(e.service_url)) byUrl.set(e.service_url, []);
  byUrl.get(e.service_url).push(e);
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
   'no two entries fetch the same service_url without disjoint extra_where slices',
   offenders.join('\n     '));

// Positive control: the assertion above is only meaningful if the traversal actually sees a
// shared-URL group. The WSDOT trio is the known legitimate one; if it ever disappears, this
// test would pass vacuously and we want to know.
ok(slicedGroups >= 1,
   `saw ${slicedGroups} legitimate sliced group(s) — the shared-URL path is exercised`,
   'no shared-URL group found at all; the check may be passing vacuously');

console.log(fails === 0 ? '\nAll checks passed.' : `\n${fails} check(s) failed.`);
process.exit(fails === 0 ? 0 : 1);
