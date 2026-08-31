// Offline checks for tennessee-dot-projects (Tennessee, statewide).
//
// WHY THIS EXISTS. Tennessee had NO statewide entry — only 8 city/county permit entries — and
// 47 dark pages. TDOT's own layer was found by the Georgia method: read the agency's OWN host out
// of the `url` field of its AGO items rather than trusting AGO-hosted third-party copies.
//
// THE TRAP THIS FILE EXISTS FOR — the same mistake made TWICE, in opposite directions, and both
// times by reading the SCHEMA instead of the DATA:
//
//   1. `PROJECT_WEB_LINK` exists  → "so this is record precision!"   WRONG: 126 of 2,342 (5.4%).
//   2. `PROJECT_TITLE` is 5% full → "so this source is unusable!"    WRONG: SCOPE_OF_WORK is 82.6%.
//
//   Accepting (1) would have shipped a broken link on 95% of records. Acting on (2) would have
//   discarded a live statewide source for a state that had none. MEASURED non-null counts over
//   all 2,342 rows: SCOPE_OF_WORK 1,934 · PROJECT_DESCRIPTION 328 · PROJECT_TITLE 126 ·
//   PROJECT_WEB_LINK 126 (the same rows as PROJECT_TITLE) · PROJECT_STATUS 2,342.
//
// THREE MORE THINGS PINNED HERE:
//
//   • NO file_date and NO recency_days. The layer exposes no edit or filing timestamp at all —
//     both date columns are FORECASTS (max ESTIMATED_COMPLETION_DATE ~2030-06, max
//     CURRENT_PHASE_FED_YR_DATE ~2030-10). Mapping either to file_date would claim a filing date
//     the publisher never stated (the ODOT STIP precedent). Currency is carried by the ACTIVE/LET
//     filter instead, which makes that filter load-bearing rather than cosmetic.
//   • NO return_centroid. ArcGIS HARD-REJECTS it on polyline layers ("Return geometry centroid is
//     only supported on layer with polygon geometry type" — the TxDOT precedent).
//   • The status vocabulary is 4 values summing EXACTLY to 2,342: ACTIVE 1,923 + LET 393 +
//     CONSTCOMP 25 + CLOSED 1. All four must stay accounted for even though extra_where already
//     restricts to two of them.
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
const E = REG.arcgis.find((e) => e.registry_id === 'tennessee-dot-projects');

ok(!!E, 'tennessee-dot-projects entry exists');
if (!E) { console.log('\n1 check(s) FAILED'); process.exit(1); }

// ── first-party host ────────────────────────────────────────────────────────────
ok(
  E.service_url === 'https://spatial.tdot.tn.gov/arcgis/rest/services/Roadway_Projects/Projects_Public_Viewer/FeatureServer/0',
  'points at TDOT’s own spatial.tdot.tn.gov layer 0',
  E.service_url,
);
ok(/^https:\/\/[a-z.]+\.tn\.gov\//.test(E.service_url), 'service_url is first-party tn.gov');
ok(!/arcgis\.com/.test(E.service_url), 'not an AGO-hosted third-party copy');
ok(E.coverage.length === 1 && E.coverage[0].state === 'TN' && !('county' in E.coverage[0]),
  'coverage is statewide TN with no county');

// ── THE TITLE TRAP: SCOPE_OF_WORK, alone ───────────────────────────────────────
ok(E.column_map.title === 'SCOPE_OF_WORK',
  'title maps to SCOPE_OF_WORK (82.6% populated) — NOT PROJECT_TITLE (5.4%)',
  String(E.column_map.title));
ok(!Array.isArray(E.column_map.title),
  'title is a SCALAR — a column_map array JOINs values, it does not fall back (UDOT standing answer)');
ok(E.column_map.title !== 'PROJECT_TITLE', 'PROJECT_TITLE is never the title field on this layer');

// ── THE LINK TRAP: mapped, but precision is dataset ────────────────────────────
ok(E.record_url_precision === 'dataset',
  'dataset precision — PROJECT_WEB_LINK is populated on only 126 of 2,342 rows');
ok(E.column_map.record_url === 'PROJECT_WEB_LINK',
  'PROJECT_WEB_LINK is still mapped, so the 126 rows that have one emit a true deep link');
ok(!('record_url_template' in E), 'no templated record_url — that would fabricate a per-record page');
ok(E.dataset_url === 'https://www.tn.gov/tdot/projects.html',
  'dataset_url is the VERIFIED TDOT projects page (200, <title>Transportation Projects</title>)',
  E.dataset_url);

// ── status buckets: all four publisher values accounted for ────────────────────
const S = E.status_to_bucket;
ok(S.approved.includes('ACTIVE') && S.approved.includes('LET'), 'ACTIVE + LET → approved');
ok(S.operating.includes('CONSTCOMP'), 'CONSTCOMP → operating (construction complete)');
ok(S.exclude.includes('CLOSED'), 'CLOSED → exclude');
ok(S.proposed.length === 0, 'proposed is empty — the publisher has no pre-approval status');
const all = [...S.proposed, ...S.approved, ...S.operating, ...S.exclude];
ok(all.length === 4, 'exactly the 4 publisher statuses are mapped (they sum to 2,342)');
ok(new Set(all).size === all.length, 'no status appears in two buckets');

// ── the ACTIVE/LET filter is load-bearing, not cosmetic ────────────────────────
ok(/PROJECT_STATUS IN \('ACTIVE','LET'\)/.test(E.extra_where),
  'extra_where restricts to ACTIVE/LET — the only currency signal this layer has',
  E.extra_where);
ok(/SCOPE_OF_WORK IS NOT NULL/.test(E.extra_where),
  'extra_where drops the 396 scope-less rows — a pin with no readable title is the Marion defect');

// ── no date exists, so none may be claimed ─────────────────────────────────────
ok(!('file_date' in E.column_map),
  'NO file_date — both date columns are FORECASTS (~2030), never a filing date (ODOT precedent)');
ok(!('recency_days' in E), 'NO recency_days — the layer exposes no edit/filing timestamp to bound on');
ok(!('recency_expr' in E), 'NO recency_expr either — there is no date column to apply it to');
ok(!('decision_date' in E.column_map), 'no decision_date — the publisher states none');

// ── polyline geometry ──────────────────────────────────────────────────────────
ok(E.column_map.lat === '__lat' && E.column_map.lng === '__lng',
  'lat/lng read the flattened geometry, not attribute columns');
ok(!('return_centroid' in E),
  'NO return_centroid — ArcGIS HARD-REJECTS it on polyline layers (TxDOT precedent)');
ok(E.spatial_zip_radius_mi === 3, 'spatial ZIP scoping at 3 mi (the layer has no ZIP column)');

// ── use_type ───────────────────────────────────────────────────────────────────
ok(E.use_type_const === 'Utility', 'DOT road work → Utility (Caltrans/ODOT/GDOT precedent)');
ok(!('type_map' in E) || Object.keys(E.type_map).length > 0,
  'no empty type_map stub');

// ── PII / noise fenced out ─────────────────────────────────────────────────────
for (const f of ['CONTRACTOR', 'CONTRACT_ID']) {
  ok(!E.out_fields.includes(f), `out_fields excludes ${f}`);
}
for (const f of ['PIN', 'SCOPE_OF_WORK', 'PROJECT_STATUS', 'COUNTY_NAMES', 'PROJECT_WEB_LINK']) {
  ok(E.out_fields.includes(f), `out_fields projects ${f}`);
}

// ── generated county-sources must agree ────────────────────────────────────────
const CS = JSON.parse(readFileSync(join(root, 'lib/generated/county-sources.json'), 'utf8'));
ok(JSON.stringify(CS).includes('tennessee-dot-projects'),
  'county-sources.json was regenerated with the new entry');

console.log(fails === 0 ? '\nAll checks passed' : `\n${fails} check(s) FAILED`);
process.exit(fails === 0 ? 0 : 1);
