// Offline regression checks for `el-paso-new-residential-permits` — the City of El Paso's
// own ArcGIS Server (gis.elpasotexas.gov, Planning/NewResidential FeatureServer layer 1).
// No network: the SHIPPED connector (sources/arcgis.ts) is driven over a REAL captured
// response (fixtures/el-paso/new-residential-sample.json, pg_net 30999, outSR=4326).
//
// WHY THIS EXISTS. This entry REWRITES a rejection stamp: the 2026-07-25 rejection was a
// WAF 403 under the real 143-ZIP production workload, not a schema defect, so the wire-time
// smoke is the full paced rollout itself (see the entry's _receipts for the failure path).
// The offline gates here are the two the founder named:
//   - Las Cruces NM (88001), directly across the state line, never fetches;
//   - county-name disambiguation BOTH directions with `colorado-springs-planning-applications`,
//     the registry's other `county: "El Paso"` (CO) — the TX entry never fires for CO/El Paso
//     and the CO entry never fires for TX/El Paso.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0;
const ok = (c, name, detail) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name + (!c && detail ? '\n     ' + detail : ''));
  if (!c) fails++;
};

const ARC = join(root, 'supabase/functions/get-address-report/sources/arcgis.ts');
let arcgisForZip, coverageMatches;
try {
  ({ arcgisForZip, coverageMatches } = await import(ARC));
} catch (err) {
  console.log('FAIL — import shipped connector (needs Node >= 22.18 type stripping)\n     ' + err.message);
  process.exit(1);
}

const REG = JSON.parse(readFileSync(join(root, 'supabase/functions/get-address-report/jurisdiction-registry.json'), 'utf8'));
const EP = REG.arcgis.find((e) => e.registry_id === 'el-paso-new-residential-permits');
const COS = REG.arcgis.find((e) => e.registry_id === 'colorado-springs-planning-applications');
ok(!!EP && !!COS, 'registry carries the El Paso TX entry and its CO county-name namesake');

// ── 1. Entry shape — the receipted config, field by field ─────────────────────────
ok(EP.service_url === 'https://gis.elpasotexas.gov/arcgis/rest/services/Planning/NewResidential/FeatureServer/1',
  'service_url is layer 1 on the city\'s own server (the layer the ×3 audit and re-recon receipted)');
ok(EP.coverage.length === 1 && EP.coverage[0].state === 'TX' && EP.coverage[0].county === 'El Paso',
  'coverage exactly [{state: TX, county: El Paso}]');
ok(EP.status_const === 'Issued'
    && JSON.stringify(EP.status_to_bucket) === JSON.stringify({ proposed: [], approved: ['Issued'], operating: [], exclude: [] }),
  'status_const Issued → approved (B1_APPL_ST is blank on ALL 544 in-window rows — Detroit issuance-ledger pattern)');
ok(EP.extra_where === 'Issued_Dat IS NOT NULL',
  'extra_where guards the constant on the real issuance event — and carries NO quoted-string comparison (the WAF is content-sensitive; see _receipts)');
ok(EP.recency_days === 365 && EP.column_map.file_date === 'Issued_Dat' && EP.file_date_kind === 'issued',
  'recency 365d on Issued_Dat (real past event; REC_DATE stalled 2019-09-26, rejected)');
ok(JSON.stringify(EP.column_map.title) === JSON.stringify(['Street_Add', 'Record_Typ'])
    && EP.column_map.case_number === 'B1_ALT_ID',
  'title [Street_Add, Record_Typ] (Descriptio blank on the live end, rejected); case_number B1_ALT_ID');
{
  const tm = EP.type_map;
  ok(Object.keys(tm).length === 4 && Object.values(tm).every((v) => v === 'Residential')
      && ['New Residential', '3rd/Residential/New', 'Residential/New/NA', 'New Construction'].every((k) => k in tm),
    'type_map: all 4 named Record_Typ values → Residential (in-window vocab sums exactly to 544; a blank stays unclassified, fails closed)');
}
ok(EP.spatial_zip_radius_mi === 3 && !('zip' in EP.column_map),
  'spatial 3-mi scoping — B1_SITUS_Z holds years, not ZIPs (0 of 42,677 LIKE \'799%\'), so no zip column is mapped');
ok(EP.record_url_precision === 'dataset' && EP.dataset_url === EP.service_url,
  'dataset-precision record_url on the layer\'s own REST endpoint (no per-record URL column — Boulder precedent)');
ok(!('return_centroid' in EP) && !('use_type_const' in EP), 'return_centroid and use_type_const never set');
{
  const all = ['socrata', 'arcgis', 'ckan', 'csv', 'carto', 'opendatasoft']
    .flatMap((p) => REG[p] || [])
    .filter((e) => (e.service_url || '').includes('elpasotexas.gov'));
  ok(all.length === 1, `exactly ONE elpasotexas.gov entry exists registry-wide — NewCommercial stays rejected (got ${all.length})`);
}

// ── 2. Drive the SHIPPED connector over the real capture ──────────────────────────
const EL_PASO = { lat: 31.7587, lng: -106.4869 };     // 79901 downtown El Paso TX
const LAS_CRUCES = { lat: 32.3199, lng: -106.7637 };  // 88001 Las Cruces NM
const CO_SPRINGS = { lat: 38.8339, lng: -104.8214 };  // 80903 Colorado Springs (El Paso County, CO)
const FIX = JSON.parse(readFileSync(join(root, 'fixtures/el-paso/new-residential-sample.json'), 'utf8'));

function stubFetch(calls, fixture) {
  let served = false;
  return async (url) => {
    calls.push(String(url));
    const body = served ? { features: [] } : fixture;
    served = true;
    return { ok: true, status: 200, json: async () => body };
  };
}

{
  const calls = [];
  const { sites, reports } = await arcgisForZip(
    '79901', [{ state: 'TX', county: 'El Paso' }], [EP],
    { fetch: stubFetch(calls, FIX), zipCentroid: EL_PASO },
  );
  ok(sites.length === 3, `all 3 fixture permits emitted (got ${sites.length})`);
  ok(sites.every((s) => s.bucket === 'approved'), 'every record buckets approved via the guarded status_const — never guessed');
  ok(sites.every((s) => s.use_type === 'Residential'), 'every record classifies Residential through the verbatim type_map');
  ok(sites.every((s) => s.file_date && s.case_number && s.case_number.startsWith('BRNN')),
    'real issuance dates and B1_ALT_ID case numbers ride through');
  ok(sites.every((s) => s.scope === 'point' && s.lat > 31.6 && s.lat < 31.8 && s.lng > -106.4 && s.lng < -106.3),
    'pinned from the layer\'s own WGS84 point geometry, inside El Paso');
  ok(sites.every((s) => s.record_url === EP.dataset_url && s.record_url_precision === 'dataset'),
    'every record carries the dataset record_url (anti-fabrication gate)');
  ok(sites.some((s) => s.title.includes('8519 WELLS') && s.title.includes('New Residential')),
    'title joins Street_Add + Record_Typ ("8519 WELLS … New Residential")');
  ok(reports[0].unmapped_statuses.length === 0, 'clean status report (constant path has nothing to unmap)');
  ok(calls[0].includes('Issued_Dat') && calls[0].includes('outSR=4326') && !calls[0].includes('returnCentroid')
      && !calls[0].includes('%3C%3E'),
    'live query carries the Issued_Dat guard + WGS84, no returnCentroid — and no <> comparison anywhere (WAF discipline)');
}

// ── 3. The founder-named gates: state line + county-name namesake ─────────────────
ok(coverageMatches(EP.coverage, [{ state: 'TX', county: 'El Paso' }]), 'gate ALLOWS TX/El Paso');
ok(!coverageMatches(EP.coverage, [{ state: 'NM', county: 'Dona Ana' }]), 'gate BLOCKS NM/Dona Ana (Las Cruces)');
ok(!coverageMatches(EP.coverage, [{ state: 'CO', county: 'El Paso' }]),
  'gate BLOCKS CO/El Paso — the county NAME matches, the state does not');
ok(!coverageMatches(COS.coverage, [{ state: 'TX', county: 'El Paso' }]),
  'and the CO namesake entry BLOCKS TX/El Paso — disambiguation holds in BOTH directions');
{
  const calls = [];
  const { sites } = await arcgisForZip(
    '88001', [{ state: 'NM', county: 'Dona Ana' }], [EP],
    { fetch: stubFetch(calls, FIX), zipCentroid: LAS_CRUCES },
  );
  ok(sites.length === 0 && calls.length === 0,
    'Las Cruces NM (88001, across the state line) emits nothing AND never fetches the layer');
}
{
  const calls = [];
  const { sites } = await arcgisForZip(
    '80903', [{ state: 'CO', county: 'El Paso' }], [EP],
    { fetch: stubFetch(calls, FIX), zipCentroid: CO_SPRINGS },
  );
  ok(sites.length === 0 && calls.length === 0,
    'Colorado Springs (80903, El Paso County CO) emits nothing AND never fetches the TX layer');
}
{
  const calls = [];
  const { sites } = await arcgisForZip(
    '79901', [{ state: 'TX', county: 'El Paso' }], [COS],
    { fetch: stubFetch(calls, FIX), zipCentroid: EL_PASO },
  );
  ok(sites.length === 0 && calls.length === 0,
    'and a TX/El Paso page never fetches the Colorado Springs layer (both directions proven at the drive level)');
}

console.log(fails ? `\n${fails} el-paso-connector assertion(s) FAILED.` : '\nAll el-paso-connector assertions passed.');
process.exit(fails ? 1 : 0);
