// Offline regression checks for `kytc-syp-highway-plan` — KYTC's enacted Six-Year Highway
// Plan (SYPQuery on maps.kytc.ky.gov, a JOINED MapServer layer).
// No network: the SHIPPED connector (sources/arcgis.ts) is driven over a REAL captured
// query response (fixtures/kytc-syp/*.json, pg_net request 33424, outSR=4326).
//
// WHY THIS EXISTS. Four facts are pinned here that a config-only diff cannot show, and
// each one silently breaks the wire if it drifts:
//
//   • THE VINTAGE GATE. The layer holds EVERY Highway Plan back to 1996 (16 biennial
//     PLANYEAR groups summing exactly to 18,683). `extra_where CUR_PLANYEAR_IND='Y'` is
//     the publisher's own current-plan flag; drop it and 1996 programme rows publish as
//     live development.
//
//   • FULLY-QUALIFIED FIELD NAMES. On a joined MapServer layer the short column names do
//     not exist, and querying them returns an HTTP 200 carrying {"error":{"code":400}} —
//     the South Dakota class, which reads like a hostile server and is actually a wrong
//     query. Every column_map/out_fields reference must carry the table prefix.
//
//   • `SYP_RPT_PRECONFLAG` IS PRECON-SCOPED: 'I' MEANS PRECONSTRUCTION FINISHED, NOT
//     PROJECT DEAD. An earlier draft bucketed I -> exclude. That would have dropped 43
//     AWARDED construction contracts, among them the Covington/Newport 4th Street Bridge
//     replacement. 43 of 57 current-plan I rows sit at construction stage AWARDED. The
//     `AWARDED I` -> approved assertion below is the guard against re-introducing that.
//
//   • STATUS IS A COMPOSITE, because NEITHER COLUMN ALONE IS CORRECT. PRECONFLAG alone
//     mis-files 47 approved rows as proposed; STAGEC alone fails 72 rows closed on a null
//     stage. readCol joins a column array skipping empties, so a null STAGEC yields the
//     bare "A" key — which is exactly why that key exists and must not be "tidied away".
//
// Live receipts (edge-probe 4/4, the complete crosstab, the 126-ZIP coverage probe, and
// the expired-certificate finding behind dataset precision): jurisdiction-registry
// `_receipts` + docs/source-registry.md "KENTUCKY".
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0;
const ok = (c, name, detail) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name + (!c && detail ? '\n     ' + detail : ''));
  if (!c) fails++;
};

const SRC = join(root, 'supabase/functions/get-address-report/sources/arcgis.ts');
let arcgisForZip, coverageMatches;
try {
  ({ arcgisForZip, coverageMatches } = await import(SRC));
} catch (err) {
  console.log('FAIL — import sources/arcgis.ts (needs Node >= 22.18 type stripping)\n     ' + err.message);
  process.exit(1);
}

const REG = JSON.parse(readFileSync(join(root, 'supabase/functions/get-address-report/jurisdiction-registry.json'), 'utf8'));
const E = REG.arcgis.find((e) => e.registry_id === 'kytc-syp-highway-plan');
const FIXTURE = JSON.parse(readFileSync(join(root, 'fixtures/kytc-syp/louisville-current-plan.json'), 'utf8'));
const Q = 'KYTCDynamic_Highways.DBO.TED_CHIPS_ACTIVEPLAN.';
const LOUISVILLE = () => ({ lat: 38.2542, lng: -85.7594 });
const CINCINNATI = () => ({ lat: 39.1031, lng: -84.5120 });

if (!E) {
  console.log('FAIL — kytc-syp-highway-plan entry missing from jurisdiction-registry.json');
  process.exit(1);
}

function stubFetch(calls, fixture) {
  let served = false;
  return async (url) => {
    calls.push(String(url));
    const body = served ? { features: [] } : fixture;
    served = true;
    return { ok: true, status: 200, json: async () => body };
  };
}

// ── 1. Shape: statewide KY, the right layer, dataset precision ───────────────────
{
  ok(E.coverage.length === 1 && E.coverage[0].state === 'KY' && !E.coverage[0].county,
    'coverage is exactly [{state: KY}] — statewide, no county narrowing');
  ok(E.service_url === 'https://maps.kytc.ky.gov/arcgis/rest/services/Apps/ActiveHighwayPlanQuery_Ext_Prd/MapServer/0',
    'service_url is SYPQuery (the queryable joined layer), NOT the ActiveHighwayPlan FeatureServer');
  ok(!/ActiveHighwayPlan_Ext_Prd/.test(E.service_url),
    'NOT pointed at ActiveHighwayPlan_Ext_Prd — its layers 0/1/2 are dynamic LRS layers that reject where=1=1 in every form, and extra_where can never rescue a 1=1 failure');
  ok(E.spatial_zip_radius_mi === 3, 'spatial ZIP scoping at 3 mi (no ZIP column on the layer)');
  ok(E.record_url_precision === 'dataset' && !E.column_map.record_url,
    'record_url OMITTED and precision is dataset — pmtoolbox.kytc.ky.gov serves an EXPIRED certificate (so does datamart.kytc.ky.gov); the ladder falls through to dataset_url');
  ok(/^https:\/\/transportation\.ky\.gov\//.test(E.dataset_url),
    'dataset_url is the KYTC Program Management page (verified 200), not a guessed URL');
  ok(!/pmtoolbox|datamart/.test(JSON.stringify(E.dataset_url) + JSON.stringify(E.column_map)),
    'neither expired-certificate host is referenced anywhere the page would link to');
  ok(/KENTUCKY|Transportation CABINET/i.test(E.jurisdiction) && /KDOT is KANSAS/i.test(E.jurisdiction),
    'jurisdiction disambiguates the agency — KYTC is a CABINET; KDOT is Kansas');

  // The generated county-sources label is USER-VISIBLE on the development coverage card
  // (development.html reads lib/generated/county-sources.json) and gen-county-sources.mjs
  // truncates the jurisdiction at the first EM-DASH. A plain hyphen does NOT truncate — the
  // first draft of this entry used one, which would have rendered the internal
  // "KDOT is KANSAS" note to a Kentucky resident.
  const label = E.jurisdiction.split('—')[0].trim();
  ok(E.jurisdiction.includes('—'),
    'jurisdiction uses an EM-DASH before the internal note, so the public label truncates');
  ok(label === 'Kentucky Transportation Cabinet (KYTC)',
    `public label is the agency name alone (got "${label}")`);
  ok(!/KDOT|KANSAS|CABINET, not a DOT/i.test(label),
    'no internal disambiguation note leaks into the user-visible label');
}

// ── 2. The vintage gate — without it, 1996 rows publish as live development ──────
{
  ok(typeof E.extra_where === 'string' && E.extra_where.includes(Q + 'CUR_PLANYEAR_IND'),
    'extra_where filters on CUR_PLANYEAR_IND (fully qualified)');
  ok(/=\s*'Y'/.test(E.extra_where),
    "extra_where pins CUR_PLANYEAR_IND = 'Y' — the publisher's OWN current-plan flag");
  ok(!/PLANYEAR\s*(>=|>|<|<=)/.test(E.extra_where),
    'the gate is the publisher flag, NOT a hand-rolled year comparison (the Wyoming shape does not apply here)');
}

// ── 3. Every field reference is FULLY QUALIFIED (the joined-layer trap) ──────────
{
  const refs = [];
  for (const [k, v] of Object.entries(E.column_map)) {
    if (k === 'lat' || k === 'lng') continue;
    for (const c of Array.isArray(v) ? v : [v]) refs.push([k, c]);
  }
  ok(refs.length > 0 && refs.every(([, c]) => c.startsWith(Q)),
    'every column_map reference carries the TED_CHIPS_ACTIVEPLAN prefix',
    refs.filter(([, c]) => !c.startsWith(Q)).map(([k, c]) => `${k}=${c}`).join(', '));
  ok(E.out_fields.length > 0 && E.out_fields.every((c) => c.startsWith(Q)),
    'every out_fields column carries the prefix');
  ok(E.column_map.lat === '__lat' && E.column_map.lng === '__lng',
    'lat/lng read the connector-flattened polyline centroid, not an attribute column');
  const mapped = new Set(refs.map(([, c]) => c));
  ok([...mapped].every((c) => E.out_fields.includes(c)),
    'out_fields projects EVERY mapped column — a projection that drops one silently blanks it',
    [...mapped].filter((c) => !E.out_fields.includes(c)).join(', '));
}

// ── 4. Status: the composite, and the 'I' inversion guard ───────────────────────
{
  const sr = E.column_map.status_raw;
  ok(Array.isArray(sr) && sr.length === 2 && sr[0] === Q + 'SYP_RPT_STAGEC' && sr[1] === Q + 'SYP_RPT_PRECONFLAG',
    'status_raw is the [STAGEC, PRECONFLAG] composite, in that order');
  const b = E.status_to_bucket;
  const all = [...b.proposed, ...b.approved, ...b.operating, ...b.exclude];
  ok(all.length === 18 && new Set(all).size === 18,
    `all 18 enumerated STAGEC×PRECONFLAG combinations mapped, no duplicates (got ${all.length}/${new Set(all).size})`);

  // THE GUARD. 43 of 57 current-plan 'I' rows are AWARDED construction contracts.
  ok(b.approved.includes('AWARDED I'),
    "'AWARDED I' is APPROVED — PRECONFLAG is precon-scoped, so I means preconstruction FINISHED. Bucketing it to exclude drops 43 awarded contracts incl. the Covington 4th Street Bridge");
  ok(!b.exclude.includes('AWARDED I') && !b.exclude.some((k) => k.endsWith(' I') && k.startsWith('AWARDED')),
    "no AWARDED row is excluded on the strength of an 'I' flag");
  ok(b.approved.includes('SENTTOFHWA I') && b.proposed.includes('ESTIMATED I'),
    "the other 'I' combinations follow their STAGE, not the flag");

  // Option 2: the bare "A" key exists because readCol skips an empty STAGEC.
  ok(b.proposed.includes('A'),
    'the bare "A" key is present — a null construction stage yields it, and those 72 rows are proposed rather than silently withheld');
  ok(b.operating.length === 0, 'nothing is claimed as operating — a programmed plan never asserts built');
  ok(b.exclude.includes('ESTIMATED Rejected') && b.exclude.includes('ESTIMATED Withdrawn'),
    'Rejected/Withdrawn are excluded IN THE MAP, so they appear in excluded_by_status rather than vanishing at source');
  ok(!/Rejected|Withdrawn/.test(E.extra_where),
    'and they are NOT dropped via extra_where — the run report must be able to show them');
}

// ── 5. type_map: complete, closed vocabulary, publisher spellings verbatim ───────
{
  const TYPES = new Set(['Residential', 'Commercial', 'Utility', 'Development', 'Industrial', 'Civic/Public']);
  const keys = Object.keys(E.type_map);
  ok(keys.length === 55, `all 55 enumerated SYP_RPT_TYPEWORK values mapped (got ${keys.length})`);
  ok(Object.values(E.type_map).every((v) => TYPES.has(v)),
    'every use_type is in the closed six-value vocabulary (lib/map.js TYPE_EXACT)',
    [...new Set(Object.values(E.type_map))].filter((v) => !TYPES.has(v)).join(', '));
  ok(E.type_map['UNKNOWN'] === 'Development',
    "the publisher's literal 'UNKNOWN' maps to the generic Development bucket — never guessed, and never the off-vocabulary string 'Other'");
  for (const [a, b2] of [['MAJOR WIDENING', 'MAJOR WIDENING(O)'], ['RECONSTRUCTION', 'RECONSTRUCTION(O)'],
    ['NEW ROUTE', 'NEW ROUTE(O)'], ['SAFETY', 'SAFETY(P)'], ['SPOT IMPROVEMENTS', 'SPOT IMPROVEMENTS(O)'],
    ['MINOR WIDENING', 'MINOR WIDENING(O)'], ['NEW INTERCHANGE', 'NEW INTERCHANGE(O)']]) {
    ok(E.type_map[a] && E.type_map[b2],
      `both spellings mapped: "${a}" and "${b2}" — the vocabulary carries suffixed AND un-suffixed duplicates`);
  }
  ok(E.type_map['MINR WIDENING'] === 'Utility',
    "the publisher's typo 'MINR WIDENING' is mapped verbatim — we map what the source emits");
  ok(E.type_map['FERRY OPERATION(P)'] === 'Civic/Public' && E.type_map['BIKE/PED FACIL(O)'] === 'Civic/Public',
    'public-amenity work is Civic/Public');
  ok(E.type_map['SCOPING STUDY(O)'] === 'Development' && E.type_map['DESIGN ENGINEERING(O)'] === 'Development',
    'studies and engineering are Development, matching the WYDOT precedent');
}

// ── 6. Drive the SHIPPED connector over the real captured page ───────────────────
{
  const calls = [];
  const { sites, reports } = await arcgisForZip(
    '40202', [{ state: 'KY', county: 'Jefferson' }], [E],
    { fetch: stubFetch(calls, FIXTURE), zipCentroid: LOUISVILLE },
  );
  ok(sites.length === 5, `all 5 fixture features emitted (got ${sites.length})`);
  ok(sites.every((s) => typeof s.lat === 'number' && typeof s.lng === 'number' && s.scope === 'point'),
    'every polyline pinned from its OWN geometry via featurePoint()');
  ok(sites.every((s) => s.lat > 36.4 && s.lat < 39.2 && s.lng > -89.6 && s.lng < -81.9),
    'pins land inside Kentucky');
  ok(sites.every((s) => s.record_url === E.dataset_url && s.case_number),
    'every record carries the dataset record_url and a DIST_ITEM case_number');
  ok(sites.every((s) => s.file_date == null),
    'no fabricated file_date — the plan carries fiscal years and phase dates, not a filing date');

  const byItem = Object.fromEntries(sites.map((s) => [s.case_number, s]));
  ok(byItem['5-10016.00']?.bucket === 'approved',
    "5-10016.00 (AWARDED / I, the I-64 Riverside Expressway bridges) resolves APPROVED through the shipped connector — the inversion guard, end to end");
  ok(byItem['5-607.00']?.bucket === 'approved', '5-607.00 (AUTHORIZED / A) resolves approved');
  ok(byItem['5-10065.00']?.bucket === 'proposed', '5-10065.00 (ESTIMATED / A) resolves proposed');
  ok(byItem['6-80416.00']?.bucket === 'proposed',
    '6-80416.00 has a NULL construction stage and still resolves proposed — the bare "A" composite key doing its job');
  ok(byItem['6-80416.00']?.status_raw === 'A',
    'and its status_raw is the bare "A", proving readCol skipped the null column rather than emitting a blank');

  ok(byItem['5-10016.00']?.use_type === 'Utility' && byItem['5-80311.00']?.use_type === 'Civic/Public'
      && byItem['6-80416.00']?.use_type === 'Development',
    'use_type resolves from TYPEWORK across three different buckets');
  ok(sites.every((s) => s.use_type !== 'unclassified'),
    'nothing falls through to unclassified');
  ok(byItem['5-10016.00']?.title?.includes('I-64 AT KY 3077'),
    'title comes from SYP_RPT_DESC, the publisher’s own project description');

  ok(reports[0].unmapped_statuses.length === 0 && reports[0].blank_status === 0,
    'clean status report — no unmapped combination, no blank status');
  const url = calls[0];
  ok(url.includes('outSR=4326') && url.includes('geometryType=esriGeometryEnvelope'),
    'envelope + WGS84 on the wire');
  ok(url.includes('CUR_PLANYEAR_IND') && url.includes('%27Y%27'),
    'the current-plan filter reaches the actual request');
  ok(url.includes(encodeURIComponent(Q + 'DIST_ITEM')) && !url.includes('outFields=*'),
    'qualified outFields projection is sent, never outFields=*');
  ok(!url.includes('returnCentroid'),
    'no returnCentroid — this is a classic MapServer layer, which silently ignores it (the TxDOT/Clark lesson)');
}

// ── 7. Coverage gate, both directions — the two cross-border controls ────────────
{
  ok(coverageMatches(E.coverage, [{ state: 'KY', county: 'Jefferson' }]), 'gate ALLOWS KY');
  ok(!coverageMatches(E.coverage, [{ state: 'OH', county: 'Hamilton' }]), 'gate BLOCKS OH (Cincinnati)');
  ok(!coverageMatches(E.coverage, [{ state: 'IN', county: 'Vanderburgh' }]), 'gate BLOCKS IN (Evansville)');
}
{
  // Cincinnati 45202 sits ~1 mi from the Kentucky line — its 3-mi radius genuinely
  // overlaps KY geography, so a coverage bug here would NOT show up as an empty result.
  const calls = [];
  const { sites } = await arcgisForZip(
    '45202', [{ state: 'OH', county: 'Hamilton' }], [E],
    { fetch: stubFetch(calls, FIXTURE), zipCentroid: CINCINNATI },
  );
  ok(sites.length === 0 && calls.length === 0,
    'Cincinnati OH (45202) emits nothing AND NEVER FETCHES the layer — despite its radius crossing into Kentucky');
}

console.log(fails ? `\n${fails} kytc-syp-connector assertion(s) FAILED.` : '\nAll kytc-syp-connector assertions passed.');
process.exit(fails ? 1 : 0);
