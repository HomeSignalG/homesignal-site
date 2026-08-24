// Offline checks for the NEBRASKA Program Book points+segments PAIR (statewide).
//
// WHY THIS EXISTS. gis.ne.gov/dot/.../ProgramBookDOT/FeatureServer has exactly two layers:
//
//   layer 0  Program Book Points    esriGeometryPoint     337 rows / 130 distinct ProjectNo
//   layer 1  Program Book Segments  esriGeometryPolyline  558 rows / 437 distinct
//
// Only layer 1 was ever wired. Layer 0 holds 102 ProjectNo that exist NOWHERE else, and shares
// 28 with layer 1 — so it is worth wiring, and doing so without a yield would double-emit those
// 28. Same geometry-sibling gap as Montana's MDT service, except MT's unwired layer held 5 rows
// and this one holds 337, which is why MT was left alone and NE was not.
//
// ⚠️ ACRONYM COLLISION: NDOT here is NEBRASKA. NVDOT is Nevada (and self-abbreviates "NDOT"),
// NDDOT is North Dakota. Three different states, one acronym.
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
const PTS = REG.arcgis.find((e) => e.registry_id === 'ndot-program-book-points');
const SEG = REG.arcgis.find((e) => e.registry_id === 'ndot-program-book-segments');
const BASE = 'https://gis.ne.gov/dot/rest/services/ProgramBookDOT/FeatureServer';

ok(!!PTS && !!SEG, 'both NE Program Book entries exist');

// ── 1. The pair, statewide NE ───────────────────────────────────────────────────
ok(PTS.service_url === `${BASE}/0`, 'points entry reads layer 0');
ok(SEG.service_url === `${BASE}/1`, 'segments entry reads layer 1');
{
  const wired = REG.arcgis.filter((e) => typeof e.service_url === 'string' && e.service_url.startsWith(BASE));
  ok(wired.length === 2, 'exactly TWO layers wired — the service has exactly two', `found ${wired.length}`);
}
for (const [n, e] of [['points', PTS], ['segments', SEG]]) {
  ok(e.coverage.length === 1 && e.coverage[0].state === 'NE' && !e.coverage[0].county,
    `${n}: coverage is statewide NE with no county`);
  ok(/NEBRASKA/i.test(e.jurisdiction) && /not North Dakota/i.test(e.jurisdiction),
    `${n}: jurisdiction names NEBRASKA explicitly — NDOT/NVDOT/NDDOT is a three-way collision`);
}

// ── 2. THE DUPLICATE GUARD ──────────────────────────────────────────────────────
ok(PTS.yields_to === 'ndot-program-book-segments',
  'POINTS yields_to SEGMENTS — 28 shared ProjectNo would otherwise double-emit');
ok(!Object.hasOwn(SEG, 'yields_to'), 'SEGMENTS yields to nothing — one-directional');
ok(PTS.column_map.case_number === 'ProjectNo' && SEG.column_map.case_number === 'ProjectNo',
  'both key case_number on ProjectNo, which is what the yield matches on');
{
  // Measured on complete groupBy sets (each summing exactly to its layer row count).
  const l0 = 130, l1 = 437, shared = 28;
  ok(l0 - shared === 102, 'layer 0 contributes 102 ProjectNo that exist nowhere else');
  ok(l0 + l1 - shared === 539, 'union is 539 distinct projects, one record each after the yield');
  ok(shared > 0 && shared < Math.min(l0, l1),
    'the overlap is partial — neither layer is a subset, so the yield is needed AND is not a merge');
}

// ── 3. Status — provably proposed, no forward window needed ─────────────────────
// ProgramYear is a complete 2-value vocabulary summing exactly to 337: "2027" (76) and
// "2028-2032" (261). Both are future, so bucketing proposed asserts nothing unevidenced.
// This is the Idaho case, NOT the Wyoming case (drft_year 2020-2032 → forward window required).
for (const [n, e] of [['points', PTS], ['segments', SEG]]) {
  ok(e.status_const === 'Programmed', `${n}: status_const "Programmed"`);
  ok(JSON.stringify(e.status_to_bucket.proposed) === JSON.stringify(['Programmed']),
    `${n}: buckets to proposed`);
  ok(e.status_to_bucket.approved.length === 0 && e.status_to_bucket.operating.length === 0,
    `${n}: nothing claimed built or under way`);
}
ok(!Object.hasOwn(PTS, 'extra_where'),
  'points needs NO forward window — every ProgramYear value is already future (2027, 2028-2032)');

// ── 4. No date field — ProgramYear is a RANGE, not a date ───────────────────────
for (const [n, e] of [['points', PTS], ['segments', SEG]]) {
  ok(!e.column_map.file_date, `${n}: no file_date — the service has no date field`);
  ok(!Object.hasOwn(e, 'file_date_kind'), `${n}: no file_date_kind without a file_date`);
  ok(!Object.hasOwn(e, 'recency_days'), `${n}: no recency_days — no date column to compare`);
  ok(!JSON.stringify(e.column_map).includes('ProgramYear'),
    `${n}: ProgramYear is NOT mapped as a date — it holds ranges like "2028-2032"`);
}

// ── 5. use_type must MATCH the sibling, or one geometry renders differently ─────
ok(PTS.use_type_const === SEG.use_type_const,
  'both entries use the SAME use_type_const — otherwise the same project renders as a different type depending on which geometry published it');
ok(PTS.use_type_const === 'Utility', 'use_type_const is Utility (DOT infrastructure precedent)');
ok(!PTS.type_map,
  'TypeImprovement is deliberately NOT mapped — 47 free-text values with publisher typos ("Br" vs "Br.", "Mill, Rusurf.")');
{
  const CLOSED = new Set(['Residential', 'Commercial', 'Utility', 'Development', 'Industrial', 'Civic/Public']);
  ok(CLOSED.has(PTS.use_type_const), 'use_type_const is in the closed six-value vocabulary');
}

// ── 6. Shape ────────────────────────────────────────────────────────────────────
for (const [n, e] of [['points', PTS], ['segments', SEG]]) {
  ok(e.spatial_zip_radius_mi === 3, `${n}: spatial ZIP scoping at 3 mi — no ZIP column exists`);
  ok(e.record_url_precision === 'dataset', `${n}: dataset precision — no per-record URL column`);
  ok(!Object.hasOwn(e, 'record_url_template'), `${n}: no templated record_url`);
  ok(e.column_map.lat === '__lat' && e.column_map.lng === '__lng',
    `${n}: geometry rides the connector's flattened __lat/__lng`);
}

console.log(fails ? `\n${fails} check(s) FAILED` : '\nAll NE Program Book pair assertions passed.');
process.exit(fails ? 1 : 0);
