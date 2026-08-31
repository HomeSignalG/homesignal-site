// Offline checks for georgia-dot-gpas-projects (Georgia, statewide).
//
// WHY THIS EXISTS. Georgia had never been reconned — it appeared nowhere in
// docs/source-registry.md and the registry carried NO statewide GA entry, only four
// county/city entries. That is why four counties sat 100% dark (Cobb 22, Hall 15, Clarke 9,
// Cherokee 9) inside 95 dark GA pages.
//
// FOUR TRAPS THIS FILE PINS, each of which would have shipped silently or killed the wire:
//
//  1. AN EMPTY ArcGIS FOLDER LISTING IS NOT AN EMPTY FOLDER. On rnhp.dot.ga.gov the STIP and
//     GDOT_Public_Outreach folders return {"folders":[],"services":[]} to an anonymous caller
//     while Planning returns an explicit 499 Token Required. Both are authorization, not
//     absence — proven by the CONTROL that Hosted (7 services) and Utilities (2) DO list.
//     Without that control "GDOT publishes no STIP" reads as a fact and Georgia gets stamped a
//     source desert.
//
//  2. THE LAYER NAME DESCRIBES ITS CONSUMER, NOT ITS CONTENT. Layer 13 is called "Projects for
//     Utilities Permit" because it backs a utility-permit picker. The rows ARE GDOT's project
//     inventory. Skipping on the name alone misses the state's only statewide source.
//
//  3. ONE ROW WOULD HAVE POISONED EVERY GEORGIA PAGE. `COUNTIES = 'All Counties'` rows carry
//     statewide geometry: returnExtentOnly on 'SHARP CURVE WARNING SIGNS @ 304 LOCS IN
//     DISTRICT 1' spans lat 30.31–34.99 / lng −85.60 to −80.75. Scoping is `intersects`, so
//     that single polyline would attach to all ~177 GA ZIP pages and render as active
//     construction on every one. 1,200 such rows survive the type filter. The exclusion is a
//     correctness requirement, not tidying.
//
//  4. HTTP 200 IS NOT VERIFICATION — THE TITLE DISCRIMINATED. Every GDOT deep project page
//     returns 200: /InvestSmart/Pages/default.aspx and
//     /InvestSmart/TransportationFundingAct/Pages/default.aspx are <title>Page Has Moved</title>
//     and ActiveProjectsNoFrame.html is <title>Untitled 1</title> (a frameless fragment). Only
//     www.dot.ga.gov/ is a real page. dataset_url is the record_url fallback for every emitted
//     row, so a 200-but-moved stub would have shipped a dead end on thousands of records.
//
// Also pinned: USER_DT is aliased "Last Updated Date" — an EDIT stamp. It must never be mapped
// to file_date (that would claim a filing date the publisher never stated). The rolling bound
// rides in recency_expr, which buildWhere applies INSTEAD of the file_date-derived DATE literal.
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
const E = REG.arcgis.find((e) => e.registry_id === 'georgia-dot-gpas-projects');

ok(!!E, 'georgia-dot-gpas-projects entry exists');
if (!E) { console.log('\n1 check(s) FAILED'); process.exit(1); }

// ── first-party host, exact layer ────────────────────────────────────────────────
ok(
  E.service_url === 'https://rnhp.dot.ga.gov/hosting/rest/services/GPAS/MapServer/13',
  'points at GPAS layer 13 on GDOT’s own rnhp host',
  E.service_url,
);
ok(/^https:\/\/[a-z]+\.dot\.ga\.gov\//.test(E.service_url), 'service_url is first-party dot.ga.gov');
ok(!/GEOPI_APP/.test(E.service_url), 'does NOT point at GEOPI_APP (decommissioned on both GDOT hosts)');
ok(!/arcgis\.com/.test(E.service_url), 'not an AGO third-party re-host (city GIS / Esri staff / consultant copies exist)');

// ── trap 4: dataset_url must be the one page that is not a moved stub ────────────
ok(E.dataset_url === 'https://www.dot.ga.gov/', 'dataset_url is the verified GDOT homepage', E.dataset_url);
ok(
  !/InvestSmart|NoFrame|TransportationFundingAct/i.test(E.dataset_url),
  'dataset_url avoids the /InvestSmart/ tree — those return 200 with <title>Page Has Moved</title>',
);

// ── statewide coverage ──────────────────────────────────────────────────────────
ok(E.coverage.length === 1 && E.coverage[0].state === 'GA', 'coverage is statewide GA');
ok(!('county' in E.coverage[0]), 'statewide entry declares no county');

// ── trap 3: the All-Counties exclusion is load-bearing ──────────────────────────
ok(
  typeof E.extra_where === 'string' && /COUNTIES\s*<>\s*'All Counties'/.test(E.extra_where),
  'extra_where excludes COUNTIES = \'All Counties\' — those rows carry STATEWIDE geometry',
  E.extra_where,
);

// ── type whitelist: construction only, and no grant/admin/study classes ─────────
const KEPT = ['Maintenance', 'Capital', 'Reconstruction/Rehabilitation', 'Safety',
  'New Construction', 'Replacement', 'Enhancement'];
const DROPPED = ['Intermodal', 'Operating', 'Planning', 'Other', 'UNKNOWN'];
for (const t of KEPT) {
  ok(E.extra_where.includes(`'${t}'`), `extra_where keeps construction type ${t}`);
  ok(E.type_map[t] === 'Utility', `type_map classifies ${t} as Utility (DOT road work)`);
}
for (const t of DROPPED) {
  ok(!new RegExp(`'${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`).test(E.extra_where),
    `extra_where drops non-development class ${t} at source`);
}
ok(Object.keys(E.type_map).length === KEPT.length, 'type_map covers exactly the kept types — 0 unclassified');

// ── status buckets: verbatim publisher strings, admin/legacy excluded ───────────
const S = E.status_to_bucket;
ok(S.proposed.includes('Long Range Program'), 'Long Range Program → proposed');
ok(S.approved.includes('Construction Work Program') && S.approved.includes('Under Construction'),
  'Construction Work Program + Under Construction → approved');
ok(S.operating.length === 0, 'operating is empty — the kept set has no completed status');
for (const s of ['Legacy Projects', 'Overhead Projects', 'Temporarily Shored Bridges', 'Deferred', 'Rejected', 'UNKNOWN']) {
  ok(S.exclude.includes(s), `${s} → exclude`);
}
const allStatuses = [...S.proposed, ...S.approved, ...S.operating, ...S.exclude];
ok(new Set(allStatuses).size === allStatuses.length, 'no status appears in two buckets');
ok(allStatuses.length === 9, 'all 9 publisher STATUS values are accounted for (they sum to 26,544)');

// ── the edit-stamp rule: USER_DT must NOT become file_date ──────────────────────
ok(!('file_date' in E.column_map), 'no file_date — USER_DT is an EDIT stamp ("Last Updated Date"), not a filing date');
ok(E.recency_expr === "USER_DT >= DATE '{cutoff}'", 'rolling window rides in recency_expr', E.recency_expr);
ok(E.recency_days === 1095, 'recency_days 1095 supplies the {cutoff} recency_expr interpolates');
ok(/\{cutoff\}/.test(E.recency_expr), 'recency_expr interpolates {cutoff} rather than hardcoding a date that goes stale');

// ── polyline geometry: centroid path, and NOT return_centroid ──────────────────
ok(E.column_map.lat === '__lat' && E.column_map.lng === '__lng',
  'lat/lng read the flattened geometry (__lat/__lng), not attribute columns');
ok(!('return_centroid' in E), 'no return_centroid — classic 10.61 MapServer silently ignores it');
ok(E.spatial_zip_radius_mi === 3, 'spatial ZIP scoping at 3 mi (no ZIP column on the layer)');

// ── no per-record URL exists on this layer ─────────────────────────────────────
ok(E.record_url_precision === 'dataset', 'dataset precision — HAS_DOCUMENT is a flag, there is no URL column');
ok(!('record_url' in E.column_map), 'no record_url column mapped');
ok(!('record_url_template' in E), 'no templated record_url — that would be guessing a per-record page');

// ── PII fence: GPAS layer 1 carries requester identity and is deliberately unwired ──
const PII = ['REQUESTOR_NAME', 'SUBMITTED_BY_NAME', 'SUBMITTED_BY', 'REQUESTOR_ID'];
for (const f of PII) {
  ok(!E.out_fields.includes(f), `out_fields excludes PII column ${f}`);
}
ok(!REG.arcgis.some((e) => /GPAS\/MapServer\/1$/.test(e.service_url || '')),
  'GPAS layer 1 (Access Permit) is NOT wired anywhere — it carries requester names');

// ── out_fields carry what the page renders ─────────────────────────────────────
for (const f of ['PROJECT_ID', 'PROJECT_NAME', 'PROJECT_TYPE', 'STATUS', 'COUNTIES']) {
  ok(E.out_fields.includes(f), `out_fields projects ${f}`);
}

// ── generated county-sources must agree (parity gate regenerates from the registry) ──
const CS = JSON.parse(readFileSync(join(root, 'lib/generated/county-sources.json'), 'utf8'));
const blob = JSON.stringify(CS);
ok(blob.includes('georgia-dot-gpas-projects'), 'county-sources.json was regenerated with the new entry');

console.log(fails === 0 ? '\nAll checks passed' : `\n${fails} check(s) FAILED`);
process.exit(fails === 0 ? 0 : 1);
