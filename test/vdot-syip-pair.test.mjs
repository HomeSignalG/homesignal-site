// Offline checks for the VDOT SYIP points+lines PAIR (Virginia, statewide).
//
// WHY THIS EXISTS. Virginia had 92 dark pages and NO statewide entry, and VDOT had never
// actually been probed — every prior "VDOT" string in docs/source-registry.md is really
// *nv*dot (Nevada). The source is VDOT's Six-Year Improvement Program, found through the
// virginiaroads.org ArcGIS Hub DCAT feed:
//
//   layer 0  STE_VDOT_SYIP_APPRVD_SUM   esriGeometryPoint     2,853 rows
//   layer 1  STE_VDOT_SYIP_APPRVD_LINE  esriGeometryPolyline  2,682 rows
//
// THE DUPLICATE GUARD. The two layers describe the SAME projects — 5 UPCs taken from the
// line layer matched 5 rows on the point layer, with a control (a fabricated UPC returned 0)
// proving the query discriminates. So the POINTS entry declares `yields_to` the LINES entry.
// This is the OH/ME/VT/UT/IA case, NOT the NY case: here omitting the yield DOUBLES, whereas
// on NY's disjoint layer set declaring one would have DROPPED. The decision is measured per
// source, never inherited.
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
const PTS = REG.arcgis.find((e) => e.registry_id === 'vdot-syip-approved-projects');
const LIN = REG.arcgis.find((e) => e.registry_id === 'vdot-syip-approved-projects-lines');
const BASE = 'https://services.arcgis.com/p5v98VHDX9Atv3l7/arcgis/rest/services/SYIP_Approved_Projects/FeatureServer';

ok(!!PTS && !!LIN, 'both VDOT SYIP entries exist');

// ── 1. Two layers of one service, statewide ─────────────────────────────────────
ok(PTS.service_url === `${BASE}/0`, 'points entry reads layer 0');
ok(LIN.service_url === `${BASE}/1`, 'lines entry reads layer 1');
ok(PTS.coverage.length === 1 && PTS.coverage[0].state === 'VA' && !PTS.coverage[0].county,
  'coverage is statewide VA — JURISDICTION_DESC carries 227 distinct Virginia localities');
ok(JSON.stringify(LIN.coverage) === JSON.stringify(PTS.coverage), 'both carry the same coverage');

// ── 2. THE DUPLICATE GUARD ──────────────────────────────────────────────────────
ok(PTS.yields_to === 'vdot-syip-approved-projects-lines',
  'POINTS yields_to LINES — the pair is the SAME projects (5 line UPCs matched 5 point rows, control 0)');
ok(!Object.hasOwn(LIN, 'yields_to'), 'LINES yields to nothing — one-directional');
ok(PTS.column_map.case_number === 'UPC' && LIN.column_map.case_number === 'UPC',
  'both key case_number on UPC, which is what the yield matches on');

// ── 3. Status vocabulary — all 15 live values, bucketed exactly once ────────────
// Live groupBy summed EXACTLY to the layer count on both layers (2,853 / 2,682), so the
// vocabulary is complete rather than sampled, and the value SETS are identical.
{
  const LIVE = { 'Construction Started': 484, 'No Dates Set Yet': 419, 'Construction Completed': 354,
    'Waiting Financial Closure': 312, 'No Dates Set Yet - PE Open': 275, 'Activity Dates Set': 254,
    'Awarded': 181, 'Activity Dates Set - RW Started': 163, 'Advertised': 161, 'Monitoring Funds': 103,
    'Study Only': 79, 'Canceled': 45, 'Critical Decision Needed': 21, 'Project Closeout Complete': 1,
    'Claims - RW': 1 };
  for (const e of [PTS, LIN]) {
    const s2b = e.status_to_bucket;
    const all = [...s2b.proposed, ...s2b.approved, ...s2b.operating, ...s2b.exclude];
    ok(all.length === 15 && new Set(all).size === 15, `${e.registry_id}: 15 values, each bucketed once`);
    const missing = Object.keys(LIVE).filter((v) => !all.includes(v));
    ok(missing.length === 0, `${e.registry_id}: every live status is mapped`, JSON.stringify(missing));
    const sum = all.reduce((a, v) => a + (LIVE[v] || 0), 0);
    ok(sum === 2853, `${e.registry_id}: the bucketed values account for all 2,853 point rows (got ${sum})`);
    // A cancelled project must never render as live work.
    ok(s2b.exclude.includes('Canceled'), `${e.registry_id}: Canceled → exclude`);
    const moving = [...s2b.proposed, ...s2b.approved];
    const stalled = moving.filter((v) => /hold|stall|suspend|paus|dormant|inactive/i.test(v));
    ok(stalled.length === 0, `${e.registry_id}: no stalled value claims motion`, JSON.stringify(stalled));
  }
}

// ── 4. Type vocabulary inside the closed six-value use_type set ─────────────────
const USE = new Set(['Industrial', 'Development', 'Residential', 'Utility', 'Commercial', 'Civic/Public']);
for (const e of [PTS, LIN]) {
  const bad = Object.entries(e.type_map).filter(([, v]) => !USE.has(v));
  ok(bad.length === 0, `${e.registry_id}: every type_map value is canonical`, JSON.stringify(bad));
  ok(Object.keys(e.type_map).length === 29,
    `${e.registry_id}: all 29 non-null SCOPE_OF_WORK_DESC values mapped (the 30th is a genuine NULL, left unmapped)`);
}
// The publisher ships three malformed values. They are mapped VERBATIM, because the
// connector matches the raw string — "correcting" the spelling would silently unmap them.
for (const v of ['Mitigation Of Water Pollution Due To Highway Runof',
                 'Safety And Education Of Pedestrians /Bicyclisits',
                 'Acqusition Of Scenic Easement Or Sites']) {
  ok(Object.hasOwn(PTS.type_map, v), `publisher typo kept verbatim: '${v}'`);
}

// ── 5. The date field — the one that would have been wrong ─────────────────────
// CURRENT_SYP_DATE is populated on 2,852/2,853 and looks like the obvious choice, but a
// groupBy returns only TWO distinct values: it is the programme's adoption date repeated on
// every row. CN_START_DATE (2,712/2,853) is the real per-project date. Population alone is
// never evidence that a date field is usable.
for (const e of [PTS, LIN]) {
  ok(e.column_map.file_date === 'CN_START_DATE', `${e.registry_id}: file_date is CN_START_DATE`);
  ok(e.column_map.file_date !== 'CURRENT_SYP_DATE',
    `${e.registry_id}: CURRENT_SYP_DATE is NOT used — only 2 distinct values, a constant adoption date`);
  ok(e.file_date_kind === 'scheduled', `${e.registry_id}: file_date_kind 'scheduled' (a programmed construction start)`);
  ok(e.recency_days === 1825, `${e.registry_id}: 1825-day window keeps 2,437 of 2,853`);
}

// ── 6. The title field — the other one that would have been wrong ──────────────
// MAP_PROJECT_DESC reads like a title and is the literal string "Map Project" (3 distinct
// values across 2,853 rows). DESCRIPTION is populated 2,853/2,853 with real project names.
for (const e of [PTS, LIN]) {
  ok(e.column_map.title[0] === 'DESCRIPTION', `${e.registry_id}: title leads with DESCRIPTION (100% populated)`);
  ok(!e.column_map.title.includes('MAP_PROJECT_DESC'),
    `${e.registry_id}: MAP_PROJECT_DESC is NOT a title — 3 distinct values, literally "Map Project"`);
}

// ── 7. The pair stays in lockstep except where it must differ ───────────────────
{
  const differ = new Set(['registry_id', 'service_url', 'dataset_url', 'yields_to', '_receipts']);
  const keys = new Set([...Object.keys(PTS), ...Object.keys(LIN)]);
  const drift = [...keys].filter((k) => !differ.has(k) && JSON.stringify(PTS[k]) !== JSON.stringify(LIN[k]));
  ok(drift.length === 0, 'points and lines are identical apart from identity keys', JSON.stringify(drift));
}

console.log();
if (fails) { console.log(`${fails} check(s) FAILED`); process.exit(1); }
console.log('All vdot-syip-pair checks passed.');
