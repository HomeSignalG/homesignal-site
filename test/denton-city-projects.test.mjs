// Offline regression checks for the seven `denton-city-projects-*` registry entries
// (City of Denton Development Services, Planning/Projects MapServer, live 2026-10-14).
// No network: the SHIPPED connector (sources/arcgis.ts) is imported and driven over REAL
// captured features (fixtures/denton/city-planning-projects-sample.json).
//
// WHY THESE ENTRIES EXIST. `denton-county-dev-permits` is frozen at 2023-06-09 and the nine
// pilot Denton ZIPs had no fresh non-TxDOT development source (docs/denton-data-integrity-launch-gate-2026-10-10.md).
// The city's own Active Projects web maps read maps.cityofdenton.com/server/.../Planning/Projects,
// whose newest Status_Date is 2026-10-13. Its sibling service Planning/DevelopmentProjects is
// FROZEN at 2023-06 and must never be wired — pinned below.
//
// What a green run must mean:
//   * every verbatim status the live layers publish is bucketed exactly once (an unmapped
//     status excludes + flags; a missing one would silently drop a real project);
//   * the decided layer emits approved / denied / withdrawn with the publisher's own words,
//     and CLOSED / TRANSFERRED never surface as a decision;
//   * no applicant or contact column is ever requested (PII stays at the source);
//   * pins come from the parcel polygon's own geometry and land in Denton;
//   * the coverage gate holds both ways (Denton County pages only).
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
const FX = JSON.parse(readFileSync(join(root, 'fixtures/denton/city-planning-projects-sample.json'), 'utf8')).layers;
const BASE = 'https://maps.cityofdenton.com/server/rest/services/Planning/Projects/MapServer';
const IDS = {
  15: 'denton-city-projects-decided', 9: 'denton-city-projects-subdivision', 12: 'denton-city-projects-zoning',
  8: 'denton-city-projects-specific-use', 5: 'denton-city-projects-planned-development',
  13: 'denton-city-projects-site-plan', 0: 'denton-city-projects-annexation',
};
const ENTRIES = Object.fromEntries(Object.entries(IDS).map(([lid, id]) => [lid, REG.arcgis.find((e) => e.registry_id === id)]));

// ── 1. Entry shape — the config the live engine reads ───────────────────────────
console.log('1) entry shape');
ok(Object.values(ENTRIES).every(Boolean), 'all 7 entries are present in jurisdiction-registry.json');
for (const [lid, e] of Object.entries(ENTRIES)) {
  ok(e.service_url === `${BASE}/${lid}`, `${e.registry_id}: service_url is the city's own Planning/Projects layer ${lid}`);
  ok(!/DevelopmentProjects/.test(e.service_url), `${e.registry_id}: never the frozen DevelopmentProjects service`);
  ok(e.coverage.length === 1 && e.coverage[0].state === 'TX' && e.coverage[0].county === 'Denton', `${e.registry_id}: coverage is exactly [{TX, Denton}]`);
  ok(e.spatial_zip_radius_mi === 3 && e.column_map.lat === '__lat' && e.column_map.lng === '__lng',
    `${e.registry_id}: ZIP scope is spatial (no ZIP column exists) and pins come from the record's own geometry`);
  ok(e.record_url_precision === 'dataset' && e.dataset_url.startsWith('https://dentontxgis.maps.arcgis.com/apps/webappviewer/'),
    `${e.registry_id}: dataset-precision record_url = the city's Active Projects Map`);
  ok(e.use_type_const === 'Development' && !e.type_map,
    `${e.registry_id}: use_type is the constant Development (Project_Type is an application type, not a use)`);
  ok(e.column_map.case_number === 'Project_ID' && e.column_map.file_date === 'Submittal_Date' && e.file_date_kind === 'filed',
    `${e.registry_id}: identity is Project_ID and the date is the SUBMITTAL (filed) date`);
  // PII: the layer carries applicant + contact columns. None may be requested or mapped.
  const PII = /applicant|contact|manager|email|phone|owner|developer/i;
  const requested = [...(e.out_fields || []), ...Object.values(e.column_map).flat()];
  ok(requested.length > 0 && !requested.some((c) => PII.test(c)),
    `${e.registry_id}: no applicant/contact/manager column is requested or mapped`, JSON.stringify(requested.filter((c) => PII.test(c))));
  ok(Array.isArray(e.out_fields) && e.out_fields.includes('OBJECTID'), `${e.registry_id}: outFields is a projection, not "*"`);
}
ok(new Set(Object.values(ENTRIES).map((e) => e.service_url)).size === 7, 'seven distinct service_urls (no layer wired twice)');
ok(!REG.arcgis.some((e) => /Planning\/DevelopmentProjects/.test(e.service_url || '')),
  'the frozen Planning/DevelopmentProjects service is wired by NO entry');

// ── 2. Status vocabularies — verbatim live values, each bucketed exactly once ─────
console.log('2) status vocabularies (verbatim from the live layers, runs 38592730673 / 38594777168)');
const LIVE = {
  15: ['APPROVED', 'FILED', 'DENIED', 'APPROVED-PENDING BONDED SET', 'APPROVED - REVISIONS SUBMITTED', 'TRANSFERRED', 'WITHDRAWN', 'APPROVED W/CONDITION', 'CLOSED'],
  9: ['UNDER REVIEW', 'INACTIVE', 'EXTENSION 30', 'SCHEDULED FOR P&Z', 'SUBMITTED'],
  12: ['UNDER REVIEW', 'RESUBMIT', 'SUBMITTED', 'INACTIVE', 'PUBLIC HEARING/MEETI'],
  8: ['UNDER REVIEW', 'INACTIVE'],
  5: ['UNDER REVIEW', 'INACTIVE', 'PUBLIC HEARING/MEETI', 'RESUBMIT', 'SUBMITTED'],
  13: ['RESUBMIT', 'UNDER REVIEW', 'PENDING STAMPED PLANS', 'SUBMITTED', 'ACTIVE', 'INACTIVE'],
  0: ['UNDER REVIEW', 'PUBLIC HEARING/MEETI'],
};
for (const [lid, vals] of Object.entries(LIVE)) {
  const e = ENTRIES[lid];
  const mapped = Object.values(e.status_to_bucket).flat();
  ok(new Set(mapped).size === mapped.length, `${e.registry_id}: no status sits in two buckets`);
  const missing = vals.filter((v) => !mapped.includes(v));
  ok(missing.length === 0, `${e.registry_id}: every live status is bucketed (${vals.length})`, JSON.stringify(missing));
}
{
  const d = ENTRIES[15].status_to_bucket;
  ok(d.approved.includes('FILED') && d.approved.includes('APPROVED W/CONDITION'), 'decided layer: FILED and APPROVED W/CONDITION are approved');
  ok(d.denied.length === 1 && d.denied[0] === 'DENIED' && d.withdrawn.length === 1 && d.withdrawn[0] === 'WITHDRAWN', 'decided layer: DENIED → denied, WITHDRAWN → withdrawn');
  ok(d.exclude.includes('CLOSED') && d.exclude.includes('TRANSFERRED'),
    'decided layer: CLOSED (a pre-application ending, not a ruling) and TRANSFERRED (moved to another case id) never surface');
  ok(ENTRIES[15].column_map.decision_date === 'Status_Date', 'decided layer: the decision date is the publisher\'s Status_Date');
  for (const lid of [9, 12, 8, 5, 13, 0]) {
    const s = ENTRIES[lid].status_to_bucket;
    ok(s.approved.length === 0 && !s.denied && !s.withdrawn && !ENTRIES[lid].column_map.decision_date,
      `${ENTRIES[lid].registry_id}: an under-review layer asserts no decision`);
  }
  const inc = ENTRIES[15].include_types;
  ok(['CIVIL ENGINEERING PLANS', 'TREE PRESERVATION PLAN', 'PRE APPLICATION', 'TXDOT DRIVEWAY DRAIN', 'CLOMR'].every((t) => !inc.includes(t)),
    'decided layer: engineering / tree / pre-application / driveway / flood paperwork is dropped at source');
  ok(['FINAL PLAT', 'ZONING', 'SPECIFICUSE', 'PLANNED DEVELOPMENT', 'ZONING COMPLIANCE PLAN', 'ANNEXATIONS'].every((t) => inc.includes(t)),
    'decided layer: the development application types are kept');
}

// ── 3. Drive the SHIPPED connector over real captured features ───────────────────
console.log('3) the shipped connector over real captured features');
const DEN_CENTROID = { lat: 33.2148, lng: -97.1331 };   // Denton, downtown (76201)
function stubFor(lid, mutate) {
  const calls = [];
  let served = false;
  const fn = async (url) => {
    calls.push(String(url));
    const body = served ? { features: [] } : (() => { const b = structuredClone(FX[lid]); if (mutate) mutate(b); return b; })();
    served = true;
    return { ok: true, status: 200, json: async () => body };
  };
  fn.calls = calls;
  return fn;
}
async function run(lid, mutate, zip = '76201', county = 'Denton') {
  const f = stubFor(lid, mutate);
  const out = await arcgisForZip(zip, [{ state: 'TX', county }], [ENTRIES[lid]], { fetch: f, zipCentroid: DEN_CENTROID });
  return { ...out, calls: f.calls };
}
const inDenton = (s) => s.lat > 33.1 && s.lat < 33.4 && s.lng > -97.3 && s.lng < -97.0;

{
  const { sites, reports, calls } = await run(15);
  const by = Object.fromEntries(sites.map((s) => [s.case_number + ':' + s.status_raw, s]));
  ok(sites.length === 6, `decided layer: 6 captured features → 6 records, none dropped (got ${sites.length})`);
  ok(sites.map((x) => x.case_number).sort().join(',') === 'FP26-0014,FP26-0014,FP26-0016,FP26-0019,ZCP26-0019,ZCP26-0022',
    'exactly the captured features are emitted (no invented record)');
  ok(sites.filter((s) => s.bucket === 'approved').length === 4, 'APPROVED ×3 (one project twice) + FILED → 4 approved');
  const denied = sites.find((s) => s.case_number === 'ZCP26-0022');
  ok(denied && denied.bucket === 'denied' && denied.decided === true && denied.decision && denied.decision.outcome === 'denied'
    && denied.decision.status_raw === 'DENIED' && denied.decision.basis === 'source_status',
    'DENIED → bucket denied with a sourced decision object', JSON.stringify(denied && denied.decision));
  ok(denied && denied.status_raw === 'DENIED', 'the publisher\'s own status word is kept verbatim');
  const wd = sites.find((s) => s.case_number === 'FP26-0016');
  ok(wd && wd.bucket === 'withdrawn' && wd.decided === true, 'WITHDRAWN → bucket withdrawn');
  ok(denied && denied.decision_date === '2026-10-08' && denied.decision.decided_on === '2026-10-08',
    'decision_date is the publisher\'s Status_Date (1791417600000 = 2026-10-08), never the refresh clock', String(denied && denied.decision_date));
  ok(denied && denied.file_date === '2026-09-08', 'file_date is Submittal_Date (the filing), a different day from the decision', String(denied && denied.file_date));
  ok(sites.every((s) => s.record_url === ENTRIES[15].dataset_url && s.record_url_precision === 'dataset'),
    'every record carries the dataset-precision record_url (anti-fabrication gate)');
  ok(sites.every((s) => typeof s.lat === 'number' && typeof s.lng === 'number' && s.scope === 'point' && inDenton(s)),
    'every record is pinned from its own polygon centroid, inside Denton');
  ok(sites.every((s) => s.use_type === 'Development'), 'no record emits use_type "unclassified"', JSON.stringify(sites.map((s) => s.use_type)));
  ok(sites.every((s) => s.source_registry_id === 'denton-city-projects-decided' && s.jurisdiction === 'City of Denton'),
    'records are stamped with the registry id + jurisdiction');
  ok(sites.every((s) => s.case_number && s.file_date && s.address !== undefined), 'every record carries Project_ID and a filing date');
  const dup = sites.filter((s) => s.case_number === 'FP26-0014');
  ok(dup.length === 2 && dup[0].source_id === dup[1].source_id && dup[0].lat === dup[1].lat && dup[0].lng === dup[1].lng && dup[0].file_date === dup[1].file_date,
    'the publisher\'s own duplicate rows (OBJECTID 126 and 132) are IDENTICAL on every identity field, so the engine\'s exact-identity dedup collapses them');
  ok(reports[0].unmapped_statuses.length === 0 && reports[0].blank_status === 0, 'run report shows no unmapped or blank statuses');
  ok(calls.length > 0 && calls[0].includes('geometryType=esriGeometryEnvelope'), 'the query scopes by spatial envelope');
  ok(calls[0].includes('outSR=4326'), 'geometry is requested in WGS84');
  ok(!calls[0].includes('returnCentroid'), 'returnCentroid is never sent (a classic MapServer ignores it; the centroid is derived locally)');
  ok(calls[0].includes('outFields=OBJECTID') && !/outFields=\*/.test(calls[0]), 'outFields is projected (the applicant columns are never requested)');
  ok(/Project_Type\+IN\+|Project_Type%20IN|Project_Type\s+IN/.test(decodeURIComponent(calls[0]).replace(/\+/g, ' ')),
    'the development-type whitelist is pushed down into the WHERE (dropped AT SOURCE, not post-fetch)');
}
{
  // Synthetic mutations of REAL features (labelled as such): the two fail-closed paths.
  const { sites, reports } = await run(15, (b) => { b.features[0].attributes.Status = 'CLOSED'; b.features[1].attributes.Status = 'SOMETHING NEW'; });
  ok(!sites.some((s) => s.case_number === 'FP26-0016' || s.case_number === 'ZCP26-0019'),
    'SYNTHETIC: a CLOSED row and a never-seen status are both withheld');
  ok(reports[0].excluded_by_status.some((x) => x.status === 'CLOSED') && reports[0].unmapped_statuses.some((x) => x.status === 'SOMETHING NEW'),
    'SYNTHETIC: CLOSED is counted as excluded and the unseen status is FLAGGED by name (fail closed, not silent)');
}
for (const [lid, expectId, expectBucket] of [[9, 'MP26-0017', 'proposed'], [12, 'Z26-0007', 'proposed'], [8, 'S26-0005', 'proposed'],
  [5, 'PDA26-0004', 'proposed'], [13, 'ZCP26-0023', 'proposed'], [0, 'A26-0001', 'proposed']]) {
  const { sites, reports } = await run(lid);
  const s = sites[0];
  ok(sites.length === 1 && s.case_number === expectId && s.bucket === expectBucket && s.decided === false,
    `${IDS[lid]}: ${expectId} → ${expectBucket}, no decision asserted`, JSON.stringify(sites.map((x) => [x.case_number, x.bucket])));
  ok(s && inDenton(s) && s.scope === 'point' && s.use_type === 'Development' && s.record_url_precision === 'dataset',
    `${IDS[lid]}: pinned in Denton, Development, dataset-precision link`);
  ok(reports[0].unmapped_statuses.length === 0, `${IDS[lid]}: no unmapped status`);
}
{
  // Mills Rd annexation: the pin must be the polygon centroid (a hand-checkable bound), not a vertex.
  const { sites } = await run(0);
  ok(Math.abs(sites[0].lat - 33.2161) < 0.002 && Math.abs(sites[0].lng - -97.0780) < 0.002, 'annexation pin is the parcel centroid (≈33.216, -97.078)', JSON.stringify([sites[0].lat, sites[0].lng]));
}

// ── 4. Coverage gate, both directions ────────────────────────────────────────────
console.log('4) coverage gate');
const COV = ENTRIES[15].coverage;
ok(coverageMatches(COV, [{ state: 'TX', county: 'Denton' }]), 'gate ALLOWS TX/Denton');
ok(!coverageMatches(COV, [{ state: 'TX', county: 'Collin' }]), 'gate BLOCKS TX/Collin');
ok(!coverageMatches(COV, [{ state: 'TX', county: 'Tarrant' }]), 'gate BLOCKS TX/Tarrant');
ok(!coverageMatches(COV, [{ state: 'OK', county: 'Denton' }]), 'gate BLOCKS a same-named county in another state');
{
  const { sites, calls } = await run(15, null, '75024', 'Collin');
  ok(sites.length === 0 && calls.length === 0, 'a Collin County ZIP emits nothing AND never fetches the Denton layer');
}

console.log(fails ? `\n${fails} denton-city-projects assertion(s) FAILED.` : '\nAll denton-city-projects assertions passed.');
process.exit(fails ? 1 : 0);
