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
// 1. THE POINT LAYERS OVERLAP, SO THEY YIELD IN A CHAIN: base -> layer 2 -> layer 1.
//    CORRECTED 2026-10-20 (NY pre-launch audit). The first pass (2026-08-23, #885) called the
//    three layers disjoint by PIN from THREE sampled PINs and said a yield "would silently drop
//    real projects". Both halves were wrong:
//      - Production measured 552 PINs across the three layers and 33 of them in TWO layers
//        (32 in layers 1+2, 1 — 8LC321 — in layers 0+2), 2,394 of 34,685 stored rows. All 33
//        are byte-identical across layers (same point, description, status, WEPIURL), so each
//        rendered as two stacked Map 1 pins and counted twice.
//      - yields_to drops a record ONLY when its target layer emitted the SAME PIN in the same
//        report (sources/yields.ts). A project unique to its own layer can never yield.
//    Every overlap involves layer 2, so: layer 0 yields to layer 2, layer 2 yields to layer 1,
//    layer 1 yields to nothing. Acyclic, so at least one copy of every PIN always survives,
//    and a failed target fetch keeps the yielding copy (the hook fails open).
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

// ── 3. The yield chain, and what it does to real rows ───────────────────────────
ok(E[0].yields_to === IDS[2], 'layer 0 yields to layer 2 (PIN 8LC321 is in both)');
ok(E[2].yields_to === IDS[1], 'layer 2 yields to layer 1 (32 PINs are in both)');
ok(!Object.hasOwn(E[1], 'yields_to'), 'layer 1 yields to nothing — the chain ends, so no PIN can lose every copy');
{
  const { applyYields, buildYieldsMap } = await import(join(root, 'supabase/functions/get-address-report/sources/yields.ts'));
  const Y = buildYieldsMap(REG);
  const r = (n, pin) => ({ source_registry_id: IDS[n], case_number: pin });
  const keep = (rows) => applyYields(rows, Y).map((s) => s.source_registry_id.slice(-2) + ':' + s.case_number).sort();
  // Real overlaps from production (2026-10-20).
  ok(JSON.stringify(keep([r(1, 'X73173'), r(2, 'X73173')])) === JSON.stringify(['-2:X73173']),
    'X73173 in layers 1 and 2 -> one copy survives (layer 1)');
  ok(keep([r(0, '8LC321'), r(2, '8LC321')]).length === 1, '8LC321 in layers 0 and 2 -> one copy survives');
  ok(keep([r(0, 'P'), r(1, 'P'), r(2, 'P')]).length === 1, 'a PIN in all three layers -> exactly one copy survives');
  // Unique projects are never dropped (the claim #885 got wrong).
  ok(keep([r(0, '581606'), r(1, '111111'), r(2, '881485')]).length === 3, 'a PIN unique to its own layer never yields');
  // Fail-open: target layer fetched nothing this report -> the yielding copy survives.
  ok(keep([r(2, 'X73173')]).length === 1, 'layer 1 empty this report -> layer 2 copy survives');
  ok(keep([r(0, '8LC321')]).length === 1, 'layer 2 empty this report -> layer 0 copy survives');
}

// ── 4. The three are identical apart from identity — same schema, same vocabulary ──
{
  const differ = new Set(['registry_id', 'service_url', 'dataset_url', '_receipts', 'yields_to']);
  const keys = new Set(E.flatMap((e) => Object.keys(e)));
  const drift = [...keys].filter((k) => !differ.has(k)
    && !(JSON.stringify(E[0][k]) === JSON.stringify(E[1][k]) && JSON.stringify(E[1][k]) === JSON.stringify(E[2][k])));
  ok(drift.length === 0,
    'the three entries are identical apart from registry_id, the two URLs, yields_to and _receipts — they share one 17-field schema upstream',
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
