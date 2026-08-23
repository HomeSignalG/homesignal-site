// Offline checks for the NYSDOT CapitalProgramProjects LAYER SET.
//
// WHY THIS EXISTS. The service publishes SIX layers whose display names are duplicates —
// three called "Project Points" (one with a trailing space) and three called "Project
// Polygons" — so it could not be resolved by name and needed a measured pass. What it is:
//
//   THREE programs x TWO geometries, paired by exact row count:
//     layer 0 (point) 2,459  <->  layer 3 (polygon) 2,459
//     layer 1 (point) 1,724  <->  layer 4 (polygon) 1,724
//     layer 2 (point)   872  <->  layer 5 (polygon)   872
//
// Only layer 0 was ever wired, so production read 2,459 of the 5,055 point projects — 49%.
// Layers 1 and 2 add 2,596 more.
//
// THE TWO DECISIONS THIS FILE PINS.
//
// 1. NO yields_to BETWEEN THE POINT LAYERS, because they are disjoint by PIN. That is
//    measured, not assumed: layer 0 holds 0 rows for layer 2's PIN 881485, layer 2 holds 0
//    for layer 0's PIN 581606, and layer 1 holds neither — with CONTROLS PASSING, which is
//    what makes those zeros real rather than a broken query (the same query shape returns
//    4 rows for layer 0's own PIN and 15 for layer 2's own). Declaring a yield here would
//    silently drop real projects.
// 2. THE POLYGON TWINS STAY UNWIRED. They mirror the points by exact count, so wiring them
//    would double every project — and unlike the OH/ME/VT line layers, a polygon twin adds
//    no project the points lack, so there is nothing to yield TO.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0;
const ok = (c, name, detail) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name + (!c && detail ? '\n     ' + detail : ''));
  if (!c) fails++;
};

const REG = JSON.parse(readFileSync(join(root, 'supabase/functions/get-address-report/jurisdiction-registry.json'), 'utf8'));
const IDS = ['nysdot-capital-program-projects', 'nysdot-capital-program-projects-2', 'nysdot-capital-program-projects-3'];
const E = IDS.map((id) => REG.arcgis.find((e) => e.registry_id === id));
const BASE = 'https://gisportalny.dot.ny.gov/hostingny/rest/services/Projects/CapitalProgramProjects/FeatureServer';

ok(E.every(Boolean), 'all three NYSDOT point entries exist');

// ── 1. The three POINT layers, and only those ────────────────────────────────────
E.forEach((e, n) => {
  ok(e.service_url === `${BASE}/${n}`, `entry ${n + 1} reads point layer /${n}`);
  ok(e.dataset_url === e.service_url, `entry ${n + 1}: dataset_url tracks service_url`);
});

// ── 2. THE POLYGON TWINS MUST NEVER BE WIRED — they duplicate the points exactly ──
{
  const wiredUrls = REG.arcgis.filter((e) => (e.service_url || '').startsWith(BASE)).map((e) => e.service_url);
  const twins = [3, 4, 5].map((n) => `${BASE}/${n}`).filter((u) => wiredUrls.includes(u));
  ok(twins.length === 0,
    'no polygon twin (/3, /4, /5) is wired — each mirrors a point layer by exact count and would double every project',
    JSON.stringify(twins));
  ok(wiredUrls.length === 3, `exactly three layers of this service are wired (got ${wiredUrls.length})`);
}

// ── 3. NO yields_to — the point layers are disjoint, so a yield would DROP projects ──
E.forEach((e, n) => {
  ok(!Object.hasOwn(e, 'yields_to'),
    `entry ${n + 1} declares no yields_to — the three point layers are disjoint by PIN (measured, controls passing), so a yield would silently drop real projects`);
});

// ── 4. The three are identical apart from identity — same schema, same vocabulary ──
{
  const differ = new Set(['registry_id', 'service_url', 'dataset_url', '_receipts']);
  const keys = new Set(E.flatMap((e) => Object.keys(e)));
  const drift = [...keys].filter((k) => !differ.has(k)
    && !(JSON.stringify(E[0][k]) === JSON.stringify(E[1][k]) && JSON.stringify(E[1][k]) === JSON.stringify(E[2][k])));
  ok(drift.length === 0,
    'the three entries are identical apart from registry_id, the two URLs and _receipts — they share one 17-field schema upstream',
    JSON.stringify(drift));
}

// ── 5. The vocabulary is the SAME 11 values on all three, and complete ───────────
// Live groupBy per layer returned 12 values summing exactly to that layer's row count
// (2,459 / 1,724 / 872) — complete, not sampled. The 11 non-null values are identical
// across the three layers and were already in layer 0's shipped type_map, so wiring
// layers 1 and 2 required NO new mapping. The 12th value is a genuine NULL.
{
  const LIVE = ['Corrective Maint', 'BRIDGE PRESERVATION', 'PAVEMENT RECONSTRUCTION', 'OTHER', 'SAFETY',
    'BRIDGE REHABILITATION OR REPLACEMENT', 'Preventative Maint', 'PAVEMENT PRESERVATION',
    'Renewal', 'Rehabilitation', 'MOBILITY'];
  const USE = new Set(['Industrial', 'Development', 'Residential', 'Utility', 'Commercial', 'Civic/Public']);
  E.forEach((e, n) => {
    const missing = LIVE.filter((v) => !Object.hasOwn(e.type_map, v));
    ok(missing.length === 0, `entry ${n + 1}: all 11 live WORK_CATEGORY values are mapped — 0 rows unclassified`, JSON.stringify(missing));
    const bad = Object.entries(e.type_map).filter(([, v]) => !USE.has(v));
    ok(bad.length === 0, `entry ${n + 1}: every type_map value is a canonical use_type`, JSON.stringify(bad));
  });
  // A NULL WORK_CATEGORY (1 row on layer 0, 7 on layer 1, 7 on layer 2) is deliberately
  // unmapped: a value the source leaves empty must never be invented into a type.
  E.forEach((e, n) => {
    ok(!Object.hasOwn(e.type_map, '') && !Object.hasOwn(e.type_map, 'null'),
      `entry ${n + 1}: the NULL WORK_CATEGORY is not mapped — absent stays absent`);
  });
}

// ── 6. Status is inherited, not invented ─────────────────────────────────────────
// The source publishes NO status column. Layer 0 already ships status_const 'Capital
// Program' -> proposed; the siblings keep it. The layers MAY be lifecycle tranches (layer
// 0's sample carries no ContractNumber and a 2030 date, layer 2's carries contract D265141
// and a 2025 date) — but bucketing them differently would assert a lifecycle the data does
// not state, so consistency with the sibling entry is the conservative choice.
E.forEach((e, n) => {
  ok(e.status_const === 'Capital Program', `entry ${n + 1}: status_const inherited unchanged from layer 0`);
  ok(e.status_to_bucket.proposed.includes('Capital Program')
     && e.status_to_bucket.approved.length === 0
     && e.status_to_bucket.operating.length === 0,
    `entry ${n + 1}: no lifecycle bucket is invented for a source with no status column`);
});

// ── 7. Record precision survives ─────────────────────────────────────────────────
E.forEach((e, n) => {
  ok(e.record_url_precision === 'record' && e.column_map.record_url === 'WEPIURL',
    `entry ${n + 1}: per-project WEPIURL keeps record precision`);
});

console.log();
if (fails) { console.log(`${fails} check(s) FAILED`); process.exit(1); }
console.log('All nysdot-layer-set checks passed.');
