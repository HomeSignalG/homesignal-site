// Offline checks for the WYDOT STIP points+lines PAIR (Wyoming, statewide).
//
// WHY THIS EXISTS. Wyoming had 91 dark pages of 103 and only one entry
// (sheridan-county-building-permits). WYDOT had never been probed — 0 occurrences of
// "WYDOT" in docs/source-registry.md before this wire.
//
//   layer 0  ITSM STIP Point  esriGeometryPoint     1,065 rows /  433 distinct project_id
//   layer 1  ITSM STIP Line   esriGeometryPolyline    706 rows /  356 distinct
//   layer 2  ITSM STIP ALL    esriGeometryPoint     1,751 rows /  776 distinct   <-- NOT wired
//
// L2 "ALL" is exactly L0 ∪ L1 minus 5 point-only keys (L1\L2 = 0, L2\(L0∪L1) = 0, L0\L2 = 5,
// |L0∪L1| = 781 = |all three unioned|). It contributes nothing and wiring it would multi-count
// almost every project. Note the row-count arithmetic alone (1,065+706 = 1,771 vs 1,751) only
// HINTED at this — the complete distinct-key sets are what established it.
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
const PTS = REG.arcgis.find((e) => e.registry_id === 'wydot-stip-projects');
const LIN = REG.arcgis.find((e) => e.registry_id === 'wydot-stip-projects-lines');
const BASE = 'https://services2.arcgis.com/WI04Bd6haCzitbuQ/arcgis/rest/services/ITSM_STIP_Data_Layers/FeatureServer';

ok(!!PTS && !!LIN, 'both WYDOT STIP entries exist');

// ── 1. First-party org, and ONLY layers 0 and 1 ─────────────────────────────────
ok(PTS.service_url === `${BASE}/0`, 'points entry reads layer 0');
ok(LIN.service_url === `${BASE}/1`, 'lines entry reads layer 1');
{
  const wired = REG.arcgis.filter((e) => typeof e.service_url === 'string' && e.service_url.startsWith(BASE));
  ok(wired.length === 2, 'exactly TWO layers of this service are wired', `found ${wired.length}`);
  ok(!wired.some((e) => e.service_url.endsWith('/2')),
    'layer 2 "ALL" is NOT wired — it is L0 ∪ L1 minus 5 keys and would multi-count');
  // The org id in the URL is the proof of first-party: /portals/WI04Bd6haCzitbuQ → name "WYDOT".
  // The HDR-consultant copies live on services.arcgis.com/04HiymDgLlsbhaV4 and are stale (2020-2021).
  for (const [n, e] of [['points', PTS], ['lines', LIN]]) {
    ok(e.service_url.includes('/WI04Bd6haCzitbuQ/'),
      `${n}: reads the WYDOT-owned org, not a consultant copy`);
    ok(!e.service_url.includes('04HiymDgLlsbhaV4'),
      `${n}: does NOT read the HDR consultant org (WYDOT_STIP_AGOL etc., last modified 2020-2021)`);
  }
}
for (const [n, e] of [['points', PTS], ['lines', LIN]]) {
  ok(e.coverage.length === 1 && e.coverage[0].state === 'WY' && !e.coverage[0].county,
    `${n}: coverage is statewide WY with no county`);
}

// ── 2. THE DUPLICATE GUARD ──────────────────────────────────────────────────────
ok(PTS.yields_to === 'wydot-stip-projects-lines',
  'POINTS yields_to LINES — 8 project_id on the full sets (6 on the wired forward subset) appear on both');
ok(!Object.hasOwn(LIN, 'yields_to'), 'LINES yields to nothing — one-directional');
ok(PTS.column_map.case_number === 'project_id' && LIN.column_map.case_number === 'project_id',
  'both key case_number on project_id, which is what the yield matches on');
{
  // Full-set arithmetic the layer choice rests on.
  const l0 = 433, l1 = 356, l2 = 776, overlap = 8;
  ok(l0 + l1 - overlap === 781, 'L0 ∪ L1 = 781 distinct projects');
  ok(l2 + 5 === 781, 'L2 is the union minus exactly 5 point-only keys — it adds nothing');
  const fwd0 = 256, fwd1 = 294, fwdOverlap = 6;
  ok(fwd0 + fwd1 - fwdOverlap === 544, 'wired forward subset = 544 distinct projects, one record each');
}

// ── 3. No status column → status_const, bucketed proposed ───────────────────────
for (const [n, e] of [['points', PTS], ['lines', LIN]]) {
  ok(e.status_const === 'Programmed in the WYDOT State Transportation Improvement Program (STIP)',
    `${n}: status_const is the self-describing programme string (neither layer has a status field)`);
  ok(!e.column_map.status_raw, `${n}: no status_raw — there is no status column to read`);
  ok(JSON.stringify(e.status_to_bucket.proposed) === JSON.stringify([e.status_const]),
    `${n}: the one status value buckets to proposed`);
  ok(e.status_to_bucket.approved.length === 0 && e.status_to_bucket.operating.length === 0,
    `${n}: nothing is claimed built or under way`);
}

// ── 4. THE FORWARD WINDOW — the deliberate conservative restriction ─────────────
// drft_year includes PAST years (559 of L0's 1,065 rows are 2020-2025). Unlike Idaho's ITIP,
// where every ProgramYear was future so "proposed" was provable, a past-year Wyoming project
// may already be built and this service carries no evidence either way. Those rows are
// EXCLUDED rather than guessed — calling them proposed asserts not-yet-built without evidence,
// calling them operating fabricates completion.
for (const [n, e] of [['points', PTS], ['lines', LIN]]) {
  ok(e.extra_where === 'drft_year >= 2026',
    `${n}: forward-only window on drft_year — past-year rows are excluded, not guessed`, e.extra_where);
  ok(!/<|<=/.test(e.extra_where), `${n}: the window keeps FORWARD years, not past ones`);
}
ok(PTS.extra_where === LIN.extra_where, 'both entries carry the identical window');

// ── 5. No date field exists ─────────────────────────────────────────────────────
for (const [n, e] of [['points', PTS], ['lines', LIN]]) {
  ok(!e.column_map.file_date, `${n}: no file_date mapping — the service has no date field`);
  ok(!Object.hasOwn(e, 'file_date_kind'), `${n}: no file_date_kind without a file_date`);
  ok(!Object.hasOwn(e, 'recency_days'), `${n}: no recency_days — there is no date column to compare`);
  ok(!JSON.stringify(e.column_map).includes('drft_year'),
    `${n}: drft_year is NOT mapped as a date — a bare fiscal year is not a day`);
  for (const money of ['ce11', 'con1']) {
    ok(!JSON.stringify(e.column_map).includes(money),
      `${n}: ${money} is not mapped as a date — it is a cost estimate`);
  }
}

// ── 6. Type vocabulary — complete on both layers, one shared map ────────────────
{
  const L0_LIVE = { 'SAFETY IMPROVEMENTS': 334, 'STRUCTURE REPAIR': 170, 'BRIDGE REPLACEMENT': 128,
    'DRAINAGE REPAIR': 101, 'PAVEMENT REHABILITATION': 41, 'OPERATING/ADMIN/MAINT': 40,
    'PAVEMENT MAINTENANCE': 39, 'PAVEMENT RECONSTRUCTION': 22, 'COMMUNITY DEVELOPMENT': 18,
    'GENERAL MAINTENANCE': 16, 'BUILDINGS': 16, 'AIRPORT EQUIPMENT': 15, 'ENVIRONMENTAL': 13,
    'PAVEMENT EXPANSION': 13, 'GUARDRAIL': 9, 'LIGHTING': 8, 'ACQUIRE LAND/EASEMENT': 7,
    'RAILROAD': 7, 'PLANNING STUDY': 7, 'RECONSTRUCTION': 6, 'PURCHASE ONE LIGHT-DUTY BUS': 5,
    'TRAFFIC SYSTEMS': 5, 'AIRCRAFT RESCUE FIRE TRAINING': 5, 'AIRPORT LIGHTING OR SIGNAGE': 4,
    'PLANNING': 3, 'SLIDE REPAIR': 3, 'FENCING': 3, 'PURCHASE TWO LIGHT-DUTY BUSES': 3,
    'UTILITY': 3, 'RTAP': 2, 'PURCHASE ONE MINI-VAN': 2, 'MODIFY INTERCHANGE': 2, 'OPERATING': 2,
    'CAPITAL/COMPUTER EQUIP': 1, 'CAPITAL/BUS EQUIPMENT': 1, 'PURCHASE ADMIN VEHICLE': 1,
    'CAPITAL/SHOP EQUIPMENT': 1, 'PURCHASE THREE MINI-VANS': 1, 'PURC 4 ELEC BUSES/CHRG STATION': 1,
    'STATE ADMINISTRATION': 1, 'PURCHASE THREE LIGHTDUTY BUSES': 1, 'PURCHASE NON-ADA VEHICLE': 1,
    'BUS GARAGE PROJECT': 1, 'PURCHASE FOUR LIGHT-DUTY BUSES': 1, 'NEW CONSTRUCTION': 1 };
  const L1_LIVE = { 'PAVEMENT REHABILITATION': 241, 'PAVEMENT MAINTENANCE': 147,
    'SAFETY IMPROVEMENTS': 135, 'ENVIRONMENTAL': 32, 'COMMUNITY DEVELOPMENT': 29,
    'PAVEMENT RESURFACE': 27, 'RECONSTRUCTION': 25, 'GUARDRAIL': 14, 'DRAINAGE REPAIR': 11,
    'UTILITY': 8, 'FENCING': 8, 'ITS': 6, 'NEW CONSTRUCTION': 5, 'MODIFY INTERSECTION': 4,
    'STUDIES': 4, 'ADDITIONAL LANES': 3, 'SNOW FENCE': 2, 'SLIDE REPAIR': 2, 'PARKING': 2,
    'STRUCTURE REPAIR': 1 };

  ok(Object.values(L0_LIVE).reduce((a, b) => a + b, 0) + 1 === 1065,
    'L0 cow_desc vocabulary + 1 NULL row sums EXACTLY to 1,065 — complete, not a sample');
  ok(Object.values(L1_LIVE).reduce((a, b) => a + b, 0) === 706,
    'L1 cow_desc vocabulary sums EXACTLY to 706 — complete, not a sample');

  for (const [n, e, live] of [['points', PTS, L0_LIVE], ['lines', LIN, L1_LIVE]]) {
    const unmapped = Object.keys(live).filter((k) => !(k in e.type_map));
    ok(unmapped.length === 0, `${n}: every live cow_desc is mapped — 0 unclassified`, unmapped.join(', '));
  }
  ok(JSON.stringify(LIN.type_map) === JSON.stringify(PTS.type_map), 'both entries carry the identical type_map');

  const CLOSED = new Set(['Residential', 'Commercial', 'Utility', 'Development', 'Industrial', 'Civic/Public']);
  const off = [...new Set(Object.values(PTS.type_map))].filter((v) => !CLOSED.has(v));
  ok(off.length === 0, 'every mapped use_type is in the closed six-value vocabulary', off.join(', '));
  ok(!Object.values(PTS.type_map).includes('Other'), 'no entry maps to the off-vocabulary string "Other"');

  // The calls most likely to be "simplified" wrongly later.
  ok(PTS.type_map['BUILDINGS'] === 'Civic/Public' && PTS.type_map['AIRPORT EQUIPMENT'] === 'Civic/Public',
    'buildings and airport equipment are public facilities → Civic/Public, not roadway Utility');
  ok(Object.keys(PTS.type_map).filter((k) => k.startsWith('PURCHASE') || k.startsWith('PURC '))
      .every((k) => PTS.type_map[k] === 'Civic/Public'),
    'every transit rolling-stock purchase → Civic/Public');
  ok(['PLANNING', 'PLANNING STUDY', 'STUDIES', 'ACQUIRE LAND/EASEMENT'].every((k) => PTS.type_map[k] === 'Development'),
    'planning, studies and land acquisition have no built asset → Development');
}

// ── 7. Shape ────────────────────────────────────────────────────────────────────
for (const [n, e] of [['points', PTS], ['lines', LIN]]) {
  ok(e.spatial_zip_radius_mi === 3, `${n}: spatial ZIP scoping at 3 mi — no ZIP column exists`);
  ok(e.record_url_precision === 'dataset', `${n}: dataset precision — no per-record URL column exists`);
  ok(!Object.hasOwn(e, 'record_url_template'), `${n}: no templated record_url`);
  const read = new Set();
  for (const v of Object.values(e.column_map)) for (const c of [].concat(v)) read.add(c);
  const missing = [...read].filter((c) => !c.startsWith('__') && !e.out_fields.includes(c));
  ok(missing.length === 0, `${n}: out_fields covers every mapped column`, missing.join(', '));
  ok(e.column_map.lat === '__lat' && e.column_map.lng === '__lng',
    `${n}: geometry rides the connector's flattened __lat/__lng`);
}

console.log(fails ? `\n${fails} check(s) FAILED` : '\nAll WYDOT STIP pair assertions passed.');
process.exit(fails ? 1 : 0);
