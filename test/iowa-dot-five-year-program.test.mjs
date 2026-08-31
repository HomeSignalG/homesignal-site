// Offline checks for iowa-dot-five-year-program (Iowa, statewide).
//
// WHY THIS EXISTS. Iowa already had two statewide DOT entries (iowa-dot-bid-projects and
// -lines), so the first question was not "is there a source" but "is this a DIFFERENT source".
// It is: both existing entries carry `extra_where: "CONTRACT_AWARDED IS NOT NULL"` and read
// AWARDED CONTRACTS. This layer is the adopted 2027-2031 Five Year Program — PRE-AWARD
// programmed work. Different lifecycle stage, different rows, additive coverage.
//
// THE TRAP THIS FILE EXISTS FOR — the one that killed North Dakota and New Mexico the same day:
// A LAYER-WIDE SURFACE COUNT IS NOT THE PUBLISHABLE SURFACE COUNT.
//
//   ND Flex Fund : 358 rows reached 45 dark pages → 7 once the 306 DECLINED applications
//                  (Approved='No', 85% of the layer) were excluded.
//   NM eSTIP+HSIP:  82 rows reached 19 dark pages → 5 once the layer stalled at 2023-08-24
//                  (despite being named "Project Locations 2025") was excluded.
//   Iowa         : 668 rows reach 135 pages, 61 dark — and NOTHING is excluded, because
//                  Year2 is 2027..2031 (all future) and Program is one adopted programme.
//
//   That is why Iowa was wired and the other two were not. The assertions below pin the
//   properties that make Iowa's headline number equal to its honest number: an empty
//   `exclude` bucket, and a status_const that names the programme rather than a per-record
//   stage that does not exist.
//
// THREE MORE THINGS PINNED HERE:
//
//   • NO recency_days / recency_expr / file_date. The layer publishes no filing or edit
//     timestamp at all. `Year2` is a future FISCAL YEAR (2027-2031), not a filing date —
//     mapping it to file_date would claim a date the publisher never stated (ODOT precedent).
//   • NO return_centroid. ArcGIS HARD-REJECTS it on polyline layers (TxDOT precedent).
//   • The title is a two-element ARRAY on purpose. `column_map` arrays JOIN values, they do
//     NOT fall back (the UDOT standing answer) — and joining is exactly what is wanted here:
//     "US 61" + "N of Mediapolis to 0.5 mi N of IA 78". Both are 668/668 populated, so the
//     join can never produce a half-empty title. This is the same shape the sibling
//     iowa-dot-bid-projects entry already uses (["ROUTE_NAME","WORK_DESC"]).
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0;
const ok = (c, name, detail) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name + (!c && detail ? '\n     ' + detail : ''));
  if (!c) fails++;
};

const REG = JSON.parse(
  readFileSync(join(root, 'supabase/functions/get-address-report/jurisdiction-registry.json'), 'utf8'),
);
const E = REG.arcgis.find((e) => e.registry_id === 'iowa-dot-five-year-program');

ok(!!E, 'iowa-dot-five-year-program entry exists');
if (!E) { console.log('\n1 check(s) FAILED'); process.exit(1); }

// ── first-party host + statewide coverage ──────────────────────────────────────
ok(
  E.service_url ===
    'https://services.arcgis.com/8lRhdTsQyJpO52F1/arcgis/rest/services/Iowa_DOT_Five_Year_Program_Project_Data_V2_Public_VIEW/FeatureServer/0',
  'points at Iowa DOT’s own hosted Five Year Program layer 0',
  E.service_url,
);
ok(/^https:\/\/services\.arcgis\.com\/8lRhdTsQyJpO52F1\//.test(E.service_url),
  'service_url is Iowa DOT’s own AGO org (8lRhdTsQyJpO52F1) — the same org as the sibling bid entries');
ok(E.coverage.length === 1 && E.coverage[0].state === 'IA' && !('county' in E.coverage[0]),
  'coverage is statewide IA with no county');

// ── ADDITIVE, not a duplicate of the existing Iowa entries ─────────────────────
const bid = REG.arcgis.filter((e) => /^iowa-dot-bid-projects/.test(e.registry_id));
ok(bid.length === 2, 'the two pre-existing iowa-dot-bid-projects entries are still present');
for (const b of bid) {
  ok(/CONTRACT_AWARDED IS NOT NULL/.test(b.extra_where || ''),
    `${b.registry_id} still filters on CONTRACT_AWARDED — it reads AWARDED contracts, not programmed work`);
  ok(b.service_url !== E.service_url, `${b.registry_id} reads a different service than the Five Year Program`);
}
ok(!('extra_where' in E),
  'the Five Year Program needs NO extra_where — every row is publishable (this is the ND/NM contrast)');

// ── THE SURFACE TRAP: nothing is excluded, so headline == honest ───────────────
const S = E.status_to_bucket;
ok(S.exclude.length === 0,
  'exclude is EMPTY — unlike ND Flex Fund, where 306 of 358 rows had to be excluded as declined');
ok(S.proposed.length === 1 && S.proposed[0] === E.status_const,
  'the single status_const is the only bucketed value, and it is bucketed as proposed');
ok(S.approved.length === 0 && S.operating.length === 0,
  'approved/operating are empty — a programmed future project is neither awarded nor built');
ok(/2027-2031/.test(E.status_const),
  'status_const names the specific programme, so the claim is auditable when the programme rolls over',
  E.status_const);
ok(/^Programmed in the /.test(E.status_const),
  'status_const follows the MT/SD/WY/NC/OR STIP wording — "Programmed in the <agency> <years>"');

// ── the title trap, inverted: an ARRAY that JOINS, both parts 100% populated ───
ok(Array.isArray(E.column_map.title) && E.column_map.title.length === 2,
  'title is a two-element array — column_map arrays JOIN (UDOT standing answer), which is intended here');
ok(E.column_map.title[0] === 'RouteID' && E.column_map.title[1] === 'Project_Location',
  'title joins RouteID + Project_Location → "US 61 N of Mediapolis to 0.5 mi N of IA 78"',
  JSON.stringify(E.column_map.title));
ok(E.column_map.case_number === 'Project_Code', 'case_number is the per-record Project_Code');
ok(E.column_map.address === 'Project_Location', 'address is the publisher’s own location prose');

// ── no date exists, so none may be claimed ─────────────────────────────────────
ok(!('file_date' in E.column_map),
  'NO file_date — Year2 is a future FISCAL YEAR (2027-2031), never a filing date (ODOT precedent)');
ok(!('recency_days' in E), 'NO recency_days — the layer exposes no filing/edit timestamp to bound on');
ok(!('recency_expr' in E), 'NO recency_expr either — there is no date column to apply it to');
ok(!('decision_date' in E.column_map), 'no decision_date — the publisher states none');

// ── polyline geometry ──────────────────────────────────────────────────────────
ok(E.column_map.lat === '__lat' && E.column_map.lng === '__lng',
  'lat/lng read the flattened polyline geometry, not attribute columns');
ok(!('return_centroid' in E),
  'NO return_centroid — ArcGIS HARD-REJECTS it on polyline layers (TxDOT precedent)');
ok(E.spatial_zip_radius_mi === 3, 'spatial ZIP scoping at 3 mi (the layer has no ZIP column)');

// ── use_type + record precision ────────────────────────────────────────────────
ok(E.use_type_const === 'Utility', 'DOT road work → Utility (Caltrans/ODOT/GDOT/TDOT precedent)');
ok(!('type_map' in E),
  'no type_map — use_type_const covers it; a bare type_source would fall through to keyword guessing');
ok(E.record_url_precision === 'dataset',
  'dataset precision — the layer carries no per-record URL column');
ok(!('record_url_template' in E), 'no templated record_url — that would fabricate a per-record page');
ok(!('record_url' in E.column_map), 'no record_url column is claimed — the layer has none');

// ── out_fields projects everything column_map reads ────────────────────────────
for (const f of ['RouteID', 'Project_Location', 'Project_Code']) {
  ok(E.out_fields.includes(f), `out_fields projects ${f} (read by column_map)`);
}
ok(!E.out_fields.includes('SummaryWorkType'),
  'out_fields excludes SummaryWorkType — a 1000-char free-text field, the Miami/Columbus CPU hazard');

// ── generated county-sources must agree ────────────────────────────────────────
const CS = JSON.parse(readFileSync(join(root, 'lib/generated/county-sources.json'), 'utf8'));
ok(JSON.stringify(CS).includes('iowa-dot-five-year-program'),
  'county-sources.json was regenerated with the new entry');

console.log(fails === 0 ? '\nAll checks passed' : `\n${fails} check(s) FAILED`);
process.exit(fails === 0 ? 0 : 1);
