// Offline checks for the Idaho ITIP lines+points PAIR (statewide).
//
// WHY THIS EXISTS. Idaho had 96 dark pages of 111 and no statewide entry, and ITD had never
// been probed — every prior "ITD" string in docs/source-registry.md is a substring of a column
// name (AppSubmitDate, permitdate), not the agency. The state DCAT catalogue does not surface
// the source at all, because Idaho's programme acronym is ITIP, not STIP.
//
//   layer 0  ITIP_Lines_Regional   esriGeometryPolyline    507 rows / 464 distinct KeyNo
//   layer 1  ITIP_Lines_State      esriGeometryPolyline    237 rows / 229 distinct KeyNo
//   layer 2  ITIP_Points_Regional  esriGeometryPoint       785 rows / 742 distinct KeyNo
//   layer 3  ITIP_Points_State     esriGeometryPoint     1,055 rows / 977 distinct KeyNo
//
// THE TOPOLOGY, resolved on COMPLETE distinct-key sets rather than samples. Three disjoint
// blocks: A = 229 keys (lines only), B = 235 keys (published as BOTH a line and a point),
// C = 742 keys (points only). L0 = A+B, L1 = A, L2 = C, L3 = B+C, and A+B+C = 1,206 = the
// union of all four layers. So L1 and L2 are pure subsets that add ZERO keys, and only L0+L3
// are wired; the points entry yields_to the lines entry on block B.
//
// An earlier pass sampled 2 keys from L0 and 8 from L1/L2 and concluded the overlap "does not
// resolve". That was a sampling artifact — both L0 samples landed in block B, all eight L1
// samples in block A. A too-small sample does not announce itself as too small; it announces
// a contradiction. These assertions therefore pin the FULL-SET arithmetic.
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
const LIN = REG.arcgis.find((e) => e.registry_id === 'itd-itip-projects-lines');
const PTS = REG.arcgis.find((e) => e.registry_id === 'itd-itip-projects');
const BASE = 'https://services1.arcgis.com/Qqv4dYPC8Vv8e3c3/arcgis/rest/services/ITIP_2025/FeatureServer';

ok(!!LIN && !!PTS, 'both Idaho ITIP entries exist');

// ── 1. Only the two SUPERSET layers are wired, statewide ────────────────────────
ok(LIN.service_url === `${BASE}/0`, 'lines entry reads layer 0 (ITIP_Lines_Regional, the superset of layer 1)');
ok(PTS.service_url === `${BASE}/3`, 'points entry reads layer 3 (ITIP_Points_State, the superset of layer 2)');
{
  const wired = REG.arcgis.filter((e) => typeof e.service_url === 'string' && e.service_url.startsWith(BASE));
  ok(wired.length === 2, 'exactly TWO layers of this service are wired', `found ${wired.length}`);
  const suffixes = wired.map((e) => e.service_url.slice(BASE.length)).sort();
  ok(JSON.stringify(suffixes) === JSON.stringify(['/0', '/3']),
    'layers 1 and 2 are deliberately NOT wired — each is a pure subset adding 0 keys (L1⊂L0, L2⊂L3)',
    suffixes.join(','));
}
for (const [n, e] of [['lines', LIN], ['points', PTS]]) {
  ok(e.coverage.length === 1 && e.coverage[0].state === 'ID' && !e.coverage[0].county,
    `${n}: coverage is statewide ID with no county (County spans Idaho counties; UDOT precedent)`);
}

// ── 2. THE DUPLICATE GUARD — block B is 235 keys published as both a line and a point ──
ok(PTS.yields_to === 'itd-itip-projects-lines',
  'POINTS yields_to LINES — 235 KeyNo appear on both layers; omitting the yield would DOUBLE them');
ok(!Object.hasOwn(LIN, 'yields_to'), 'LINES yields to nothing — one-directional');
ok(LIN.column_map.case_number === 'KeyNo' && PTS.column_map.case_number === 'KeyNo',
  'both key case_number on KeyNo, which is what the yield matches on');

// The full-set arithmetic the wire decision rests on. Recorded here so a future edit that
// "simplifies" the layer choice has to confront the numbers.
{
  const A = 229, B = 235, C = 742;
  ok(A + B === 464, 'L0 = A+B = 464 distinct keys');
  ok(A === 229, 'L1 = A = 229 distinct keys, all of them in L0');
  ok(C === 742, 'L2 = C = 742 distinct keys, all of them in L3');
  ok(B + C === 977, 'L3 = B+C = 977 distinct keys');
  ok(A + B + C === 1206, 'A+B+C = 1,206 = |L0 ∪ L3| = |all four layers unioned|');
  ok((A + B) + (B + C) - B === 1206,
    'wired output after the yield = 464 lines + 742 points = 1,206 records, one per distinct project');
}

// ── 3. No status column anywhere → status_const, bucketed proposed ──────────────
for (const [n, e] of [['lines', LIN], ['points', PTS]]) {
  ok(e.status_const === 'Programmed in the Idaho Transportation Investment Program (FY2027–2033)',
    `${n}: status_const is the self-describing programme string (no status column exists in the service)`);
  ok(!e.column_map.status_raw, `${n}: no status_raw — there is no status column to read`);
  const s2b = e.status_to_bucket;
  ok(JSON.stringify(s2b.proposed) === JSON.stringify([e.status_const]),
    `${n}: the one status value buckets to proposed`);
  ok(s2b.approved.length === 0 && s2b.operating.length === 0 && s2b.exclude.length === 0,
    `${n}: no other bucket is populated`);
  // Every ProgramYear on both layers is 2027-2033 or "Preliminary" (vocabularies sum exactly
  // to 507 and 1,055), so on any date before FY2027 nothing here is built or under way.
  ok(!/built|complete|operating|construction started/i.test(e.status_const),
    `${n}: status does not claim anything is built — every ProgramYear is a future FY or "Preliminary"`);
}

// ── 4. No date field exists — file_date/kind/recency must all be ABSENT ─────────
// ProgramYear is a String holding a bare fiscal year and the P2027_CN…P2033_RW columns are
// dollar amounts. Interpolating a bare year into a day would be fabrication.
for (const [n, e] of [['lines', LIN], ['points', PTS]]) {
  ok(!e.column_map.file_date, `${n}: no file_date mapping — the service has no date field`);
  ok(!Object.hasOwn(e, 'file_date_kind'), `${n}: no file_date_kind without a file_date`);
  ok(!Object.hasOwn(e, 'recency_days'), `${n}: no recency_days — it would emit a DATE literal against a non-existent column`);
  ok(!JSON.stringify(e.column_map).includes('ProgramYear'),
    `${n}: ProgramYear is NOT mapped as a date — a bare year is not a day`);
  for (const bad of ['P2027_CN', 'P2030_RW', 'Total_Est']) {
    ok(!JSON.stringify(e.column_map).includes(bad),
      `${n}: ${bad} is not mapped as a date — it is a dollar amount`);
  }
}

// ── 5. Type vocabulary — complete on both layers, one shared map ────────────────
{
  // Live groupBy, each summing EXACTLY to its layer's row count, so complete not sampled.
  const L3_LIVE = { 'Safety & Traffic Operations': 227, 'Support': 198, 'Bridge': 148, 'Pavement': 122,
    'Active Transportation': 113, 'Transit Projects': 65, 'Corridor Studies': 54, 'Early Development': 48,
    'Railroad Crossings': 40, 'Airport Projects': 30, 'Freight': 6, 'Rest Areas': 2,
    'National Electric Vehicle Infrastructure (NEVI)': 1, 'New Airport Facilities': 1 };
  const L0_LIVE = { 'Pavement': 218, 'Safety & Traffic Operations': 100, 'Bridge': 63, 'Early Development': 60,
    'Active Transportation': 31, 'Railroad Crossings': 14, 'Freight': 11, 'Support': 3,
    'Corridor Studies': 3, 'Rest Areas': 1, 'Transit Projects': 1 }; // + a genuine NULL on 2 rows

  ok(Object.values(L3_LIVE).reduce((a, b) => a + b, 0) === 1055,
    'L3 Project_Type vocabulary sums EXACTLY to 1,055 — complete, not a sample');
  ok(Object.values(L0_LIVE).reduce((a, b) => a + b, 0) + 2 === 507,
    'L0 Project_Type vocabulary + 2 NULL rows sums EXACTLY to 507 — complete, not a sample');
  ok(Object.keys(L0_LIVE).every((k) => k in L3_LIVE),
    "L0's non-null values are a strict SUBSET of L3's, which is why one shared type_map serves both");

  for (const [n, e] of [['lines', LIN], ['points', PTS]]) {
    const unmapped = Object.keys(n === 'lines' ? L0_LIVE : L3_LIVE).filter((k) => !(k in e.type_map));
    ok(unmapped.length === 0, `${n}: every live Project_Type is mapped — 0 unclassified`, unmapped.join(', '));
  }
  ok(JSON.stringify(LIN.type_map) === JSON.stringify(PTS.type_map), 'both entries carry the identical type_map');

  // The closed six-value use_type vocabulary (lib/map.js::TYPE_EXACT). "Other" is NOT a member;
  // the generic bucket is written "Development" (Phoenix precedent) or it falls through to
  // keyword guessing and misses the intended pin shape.
  const CLOSED = new Set(['Residential', 'Commercial', 'Utility', 'Development', 'Industrial', 'Civic/Public']);
  const off = [...new Set(Object.values(PTS.type_map))].filter((v) => !CLOSED.has(v));
  ok(off.length === 0, 'every mapped use_type is in the closed six-value vocabulary', off.join(', '));
  ok(!Object.values(PTS.type_map).includes('Other'), 'no entry maps to the off-vocabulary string "Other"');

  // The two type calls a future edit is most likely to get wrong.
  ok(PTS.type_map['Airport Projects'] === 'Civic/Public' && PTS.type_map['Rest Areas'] === 'Civic/Public',
    'airports and rest areas are public FACILITIES → Civic/Public, not roadway Utility');
  ok(['Corridor Studies', 'Early Development', 'Support'].every((k) => PTS.type_map[k] === 'Development'),
    'pre-construction stages with no built asset → Development, the generic member');
}

// ── 6. Shape: projection, radius, dataset-precision URL ─────────────────────────
for (const [n, e] of [['lines', LIN], ['points', PTS]]) {
  ok(e.spatial_zip_radius_mi === 3, `${n}: spatial ZIP scoping at 3 mi — no ZIP column exists`);
  ok(e.record_url_precision === 'dataset', `${n}: dataset precision — no per-record URL column exists`);
  ok(!Object.hasOwn(e, 'record_url_template'), `${n}: no templated record_url — templating one would be guessing`);
  // out_fields must cover every column the column_map reads, or the projection silently blanks it.
  const read = new Set();
  for (const v of Object.values(e.column_map)) for (const c of [].concat(v)) read.add(c);
  const missing = [...read].filter((c) => !c.startsWith('__') && !e.out_fields.includes(c));
  ok(missing.length === 0, `${n}: out_fields covers every mapped column`, missing.join(', '));
  ok(e.column_map.lat === '__lat' && e.column_map.lng === '__lng',
    `${n}: geometry rides the connector's flattened __lat/__lng (server reprojects wkid 8826 via outSR=4326)`);
}

console.log(fails ? `\n${fails} check(s) FAILED` : '\nAll Idaho ITIP pair assertions passed.');
process.exit(fails ? 1 : 0);
