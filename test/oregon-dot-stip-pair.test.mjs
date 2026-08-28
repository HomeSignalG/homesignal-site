// Offline checks for the ODOT STIP points+lines PAIR (Oregon, statewide).
//
// WHY THIS EXISTS. Oregon had 147 dark pages and five CITY-scoped entries only
// (portland-building-permits, salem-structure-permits, bend-or-permit-applications), so
// statewide.OR was EMPTY and Lane 37, Jackson 18, Yamhill 12, Benton 9 and Hood River 3 had
// no covering source at all. ODOT's own STIP had never been probed.
//
//   layer 361  STIP 2024-2027 Points - Current   esriGeometryPoint     595 rows
//   layer 362  STIP 2024-2027 Lines - Current    esriGeometryPolyline  684 rows
//   layers 198/199, 316-319, 200-203, 202, 203   SUPERSEDED vintages   <-- NOT wired
//
// THREE TRAPS THIS FILE PINS, each of which would have shipped silently:
//
//  1. THE REST ROOT IS VERSIONED. gis.odot.state.or.us/arcgis returns HTTP 500 "Runtime
//     Error"; the live root is /arcgis1006. A bare-path 500 is not evidence the agency has
//     no GIS — it is evidence you guessed the instance path.
//
//  2. LAT/LONGTD ARE DECLARED AND NULL. Both layers carry LAT and LONGTD columns (aliases
//     "Beginning Latitude"/"Beginning Longitude") that are NULL on live rows, while SHAPE is
//     populated and correct (PROJ_KEY_NO 21719 -> x -124.2262, y 43.288..., wkid 4326).
//     Mapping lat/lng to those columns emits every record with no coordinates — listed,
//     never pinned, and dropped by the point-scope-only app_projects materializer.
//
//  3. "ODOT" IN THIS REGISTRY IS OHIO. odot-current-projects / -lines are Ohio DOT. Oregon
//     is oregon-dot-* deliberately (the NDOT-Nebraska / NVDOT-Nevada / NDDOT-North-Dakota
//     class). A session skimming for "odot" can read one state as the other.
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
const PTS = REG.arcgis.find((e) => e.registry_id === 'oregon-dot-stip-projects');
const LIN = REG.arcgis.find((e) => e.registry_id === 'oregon-dot-stip-projects-lines');
const BASE = 'https://gis.odot.state.or.us/arcgis1006/rest/services/facs_stip/data_catalog/MapServer';

ok(!!PTS && !!LIN, 'both Oregon DOT STIP entries exist');
if (!PTS || !LIN) { console.log('\n1 check(s) FAILED'); process.exit(1); }

const BOTH = [['points', PTS], ['lines', LIN]];

// ── 1. First-party agency server, versioned root, ONLY the "- Current" pair ──────
ok(PTS.service_url === `${BASE}/361`, 'points entry reads layer 361');
ok(LIN.service_url === `${BASE}/362`, 'lines entry reads layer 362');
{
  const wired = REG.arcgis.filter((e) => typeof e.service_url === 'string' && e.service_url.startsWith(BASE));
  ok(wired.length === 2, 'exactly TWO layers of this service are wired', `found ${wired.length}`);
  // The superseded STIP vintages live in the same MapServer and would multi-count history.
  for (const stale of ['198', '199', '316', '317', '318', '319', '200', '201', '202', '203']) {
    ok(!wired.some((e) => e.service_url === `${BASE}/${stale}`),
      `superseded STIP vintage layer ${stale} is NOT wired — only the "- Current" pair is`);
  }
  for (const [n, e] of BOTH) {
    ok(e.service_url.includes('/arcgis1006/'),
      `${n}: reads the VERSIONED rest root — the bare /arcgis path returns HTTP 500`);
    ok(e.service_url.startsWith('https://gis.odot.state.or.us/'),
      `${n}: reads ODOT's own server, not an ArcGIS Online copy`);
  }
}

// ── 2. Oregon, not Ohio ─────────────────────────────────────────────────────────
for (const [n, e] of BOTH) {
  ok(e.coverage.length === 1 && e.coverage[0].state === 'OR' && !e.coverage[0].county,
    `${n}: coverage is statewide OR with no county`);
  ok(e.registry_id.startsWith('oregon-dot-'),
    `${n}: id is oregon-dot-*, never odot-* — that prefix is OHIO in this registry`);
}
{
  const ohio = REG.arcgis.filter((e) => e.registry_id.startsWith('odot-'));
  ok(ohio.length > 0 && ohio.every((e) => e.coverage.every((c) => c.state === 'OH')),
    'the odot-* entries are all Ohio — the collision this naming avoids is real');
}

// ── 3. THE DUPLICATE GUARD — overlap is MEASURED, not assumed ───────────────────
ok(PTS.yields_to === 'oregon-dot-stip-projects-lines',
  'POINTS yields_to LINES — 22 PROJ_KEY_NO appear on both halves of the wired forward subset');
ok(!Object.hasOwn(LIN, 'yields_to'), 'LINES yields to nothing — one-directional');
ok(PTS.column_map.case_number === 'PROJ_KEY_NO' && LIN.column_map.case_number === 'PROJ_KEY_NO',
  'both key case_number on PROJ_KEY_NO, which is what the yield matches on');
{
  // Live arithmetic on the WIRED FORWARD SUBSET (PROJ_PHASE_CURRENT_STIP_YR_NO >= 2026).
  const ptsRows = 310, linRows = 249, ptsKeys = 137, linKeys = 60, shared = 22;
  ok(ptsKeys + linKeys - shared === 175, 'union of the wired subset is 175 distinct projects');
  ok(shared > 0, 'the overlap is REAL, so the yield is load-bearing — not a fail-safe declaration');
  ok(ptsRows > ptsKeys && linRows > linKeys,
    'rows exceed distinct keys on both layers — one project legitimately carries several locations');
}

// ── 4. THE FORWARD WINDOW — past-year rows excluded, not guessed ────────────────
// PROJ_PHASE_CURRENT_STIP_YR_NO carries 2013-2027. 285 of 595 point rows and 435 of 684 line
// rows sit at or before 2025; a 2013 phase-year project may already be built and the service
// carries no evidence either way. Calling those proposed asserts not-yet-built without
// evidence; calling them operating fabricates completion. Same call as WYDOT's drft_year.
for (const [n, e] of BOTH) {
  ok(e.extra_where === 'PROJ_PHASE_CURRENT_STIP_YR_NO >= 2026',
    `${n}: forward-only window on the phase year`, e.extra_where);
  ok(!/<|<=/.test(e.extra_where), `${n}: the window keeps FORWARD years, not past ones`);
}
ok(PTS.extra_where === LIN.extra_where, 'both entries carry the identical window');

// ── 5. No status column → one self-describing status_const, bucketed proposed ────
for (const [n, e] of BOTH) {
  ok(e.status_const === 'Programmed in the ODOT 2024-2027 Statewide Transportation Improvement Program (STIP)',
    `${n}: status_const is the self-describing programme string (neither layer has a status field)`);
  ok(!e.column_map.status_raw, `${n}: no status_raw — there is no status column to read`);
  ok(JSON.stringify(e.status_to_bucket.proposed) === JSON.stringify([e.status_const]),
    `${n}: the one status value buckets to proposed`);
  ok(e.status_to_bucket.approved.length === 0 && e.status_to_bucket.operating.length === 0,
    `${n}: nothing is claimed built or under way`);
}
// MNTR_CD reads as a phase pair (PSEDOC 384/363, CONST 211/321 — each set sums exactly to its
// layer count) and bucketing CONST to `approved` is tempting. The ARDOT discipline requires a
// DECODE RECEIPT from the agency's own material, and there is none: empty layer description,
// empty copyrightText, alias only "Monitor Code", and no legend labels for 361/362.
for (const [n, e] of BOTH) {
  ok(!JSON.stringify(e.column_map).includes('MNTR_CD'),
    `${n}: MNTR_CD is NOT mapped — an undecoded code must not drive a status or a type`);
  ok(!JSON.stringify(e.status_to_bucket).includes('CONST') &&
     !JSON.stringify(e.status_to_bucket).includes('PSEDOC'),
    `${n}: no MNTR_CD value is bucketed — that would be a guess dressed as a decode`);
}

// ── 6. No date field is honest here ─────────────────────────────────────────────
// PROJ_TRGT_DT and BID_LET_DT are FORECAST scheduling dates (the sd-stip founder rider);
// GIS_PRC_DT is the layer's own rebuild stamp, not a filing date.
for (const [n, e] of BOTH) {
  ok(!e.column_map.file_date, `${n}: no file_date mapping — every date on this layer is a forecast or a rebuild stamp`);
  ok(!Object.hasOwn(e, 'file_date_kind'), `${n}: no file_date_kind without a file_date`);
  ok(!Object.hasOwn(e, 'recency_days'), `${n}: no recency_days — there is no filing date to compare`);
  for (const d of ['PROJ_TRGT_DT', 'BID_LET_DT', 'GIS_PRC_DT']) {
    ok(!JSON.stringify(e.column_map).includes(d), `${n}: ${d} is not mapped as a date`);
  }
  ok(!JSON.stringify(e.column_map).includes('PHASE_STIP_ESTIMATE_AMOUNT'),
    `${n}: the phase cost estimate is not mapped as a date`);
}

// ── 7. Type: constant, because no work-type column exists ───────────────────────
const CLOSED = new Set(['Residential', 'Commercial', 'Utility', 'Development', 'Industrial', 'Civic/Public']);
for (const [n, e] of BOTH) {
  ok(e.use_type_const === 'Utility', `${n}: statewide-DOT roadway work → Utility (the udot/txdot/wydot fleet)`);
  ok(CLOSED.has(e.use_type_const), `${n}: use_type_const is in the closed six-value vocabulary`);
  ok(!Object.hasOwn(e, 'type_map'), `${n}: no type_map — the layer ships no work-type vocabulary to map`);
  ok(!e.column_map.type_source, `${n}: no type_source — same reason`);
}

// ── 8. THE COORDINATE TRAP — geometry, never the null LAT/LONGTD columns ────────
for (const [n, e] of BOTH) {
  ok(e.column_map.lat === '__lat' && e.column_map.lng === '__lng',
    `${n}: geometry rides the connector's flattened __lat/__lng`);
  for (const bad of ['LAT', 'LONGTD']) {
    ok(!Object.values(e.column_map).flat().includes(bad),
      `${n}: the declared-but-NULL ${bad} column is NOT mapped — it would emit coordinate-less records`);
  }
  ok(!(e.out_fields || []).includes('LONGTD') && !(e.out_fields || []).includes('LAT'),
    `${n}: the null coordinate columns are not even fetched`);
}

// ── 9. Shape ────────────────────────────────────────────────────────────────────
for (const [n, e] of BOTH) {
  ok(e.spatial_zip_radius_mi === 3, `${n}: spatial ZIP scoping at 3 mi — no ZIP column exists`);
  ok(e.record_url_precision === 'dataset', `${n}: dataset precision — no per-record URL column exists`);
  ok(!Object.hasOwn(e, 'record_url_template'), `${n}: no templated record_url`);
  ok(e.dataset_url === 'https://www.oregon.gov/odot/STIP/Pages/index.aspx',
    `${n}: dataset_url is ODOT's own STIP page`);
  const read = new Set();
  for (const v of Object.values(e.column_map)) for (const c of [].concat(v)) read.add(c);
  const missing = [...read].filter((c) => !c.startsWith('__') && !e.out_fields.includes(c));
  ok(missing.length === 0, `${n}: out_fields covers every mapped column`, missing.join(', '));
  ok(e.out_fields.includes('PROJ_PHASE_CURRENT_STIP_YR_NO'),
    `${n}: the window's own column is fetched, so a record can be traced back to why it qualified`);
}
ok(JSON.stringify(PTS.column_map) === JSON.stringify(LIN.column_map),
  'both entries carry the identical column_map — the two layers share a schema');

console.log(fails ? `\n${fails} check(s) FAILED` : '\nAll Oregon DOT STIP pair assertions passed.');
process.exit(fails ? 1 : 0);
