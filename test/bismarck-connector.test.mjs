// Offline regression checks for the `bismarck-building-permits` registry entry
// (City of Bismarck, BuildingPermitMain — the only wireable source found for North Dakota).
// No network: the SHIPPED connector (sources/arcgis.ts) is imported and driven over a REAL
// captured query response (fixtures/bismarck/building-permit-main-sample.json).
//
// WHY THIS EXISTS — and it is NOT the usual vocabulary-drift reason.
//
// This layer publishes OWNER PII on a residential permit ledger: OWNER_NAME, OWNER_FIRST,
// OWNER_LAST, OWNER_ADDR1/2, OWNER_CITY/STATE/ZIP, OWNER_EMAIL, OWNER_PHONE, OWNER_CELL,
// OWNER_FAX, OWNER_PAGER, plus APPLICANT_NAME and CONTRACTOR_NAME. The city publishes it
// openly; republishing it on homesignal.net would be a different act entirely.
//
// The ONLY thing standing between that data and our cache is `out_fields`. arcgis.ts sets
// outFields to exactly that list (else `*`), so an entry that loses `out_fields` — or gains
// an owner column in `column_map` — starts fetching names, home addresses and phone numbers
// on the next scheduled refresh, silently and with nothing failing. §4 below is therefore
// the real point of this file: it fails loudly if either guard is removed, and it asserts
// against the SHIPPED request URL rather than trusting the config.
//
// Live receipts (vocabularies each sum to exactly 20,933; freshness max(APPLIED)=2026-08-21)
// are in docs/source-registry.md "NORTH DAKOTA RECON".
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
let arcgisForZip;
try {
  ({ arcgisForZip } = await import(SRC));
} catch (err) {
  console.log('FAIL — import sources/arcgis.ts (needs Node >= 22.18 type stripping)\n     ' + err.message);
  process.exit(1);
}

const REG = JSON.parse(readFileSync(join(root, 'supabase/functions/get-address-report/jurisdiction-registry.json'), 'utf8'));
const ENTRY = REG.arcgis.find((e) => e.registry_id === 'bismarck-building-permits');
ok(!!ENTRY, 'jurisdiction-registry carries bismarck-building-permits');

// ── 1. Entry shape ───────────────────────────────────────────────────────────────
ok(ENTRY.service_url === 'https://services1.arcgis.com/XxHmL09eFqJWI0gE/arcgis/rest/services/Map1/FeatureServer/0',
  "service_url is the city's own BuildingPermitMain layer");
ok(ENTRY.coverage.length === 1 && ENTRY.coverage[0].state === 'ND' && ENTRY.coverage[0].county === 'Burleigh',
  'coverage is exactly [{ND, Burleigh}]');
ok(ENTRY.column_map.zip === 'SITE_ZIP',
  'ZIP scoping uses the NATIVE SITE_ZIP column (99.9% populated) — no spatial approximation');
ok(ENTRY.spatial_zip_radius_mi === undefined,
  'no spatial radius: a native ZIP column makes the 3-mi circle both unnecessary and less precise');
ok(ENTRY.column_map.lat === '__lat' && ENTRY.column_map.lng === '__lng',
  "coordinates come from the feature's OWN geometry, requested as outSR=4326 (the layer is natively wkid 2910 state-plane feet — reading LAT/LON columns would risk the unprojected value)");
ok(ENTRY.record_url_precision === 'dataset',
  'record_url is dataset-precision — Bismarck publishes no per-record permit URL');
ok(ENTRY.dataset_url === 'https://www.bismarcknd.gov/1106/Issued-Building-Permits',
  "dataset_url is the city's own Issued Building Permits page (200; sibling bogus paths return a Custom404, so that 200 discriminates)");
ok(ENTRY.column_map.file_date === 'APPLIED' && ENTRY.file_date_kind === 'filed',
  'file_date is APPLIED (100% populated), labelled "filed" not "issued" — ISSUED carries dates up to ~6 weeks in the future');

// ── 2. Status vocabulary — all 21 live values bucketed exactly once ──────────────
{
  const s2b = ENTRY.status_to_bucket;
  const all = [...s2b.proposed, ...s2b.approved, ...s2b.operating, ...s2b.exclude];
  ok(all.length === 21 && new Set(all).size === 21,
    `all 21 live STATUS values bucketed exactly once (got ${all.length}, ${new Set(all).size} distinct)`);
  ok(s2b.operating.includes('FINALED') && s2b.operating.includes('FINALED WITH CO'),
    'FINALED + FINALED WITH CO → operating (the two largest buckets, 10,873 + 794)');
  ok(s2b.approved.includes('ISSUED'), 'ISSUED → approved (7,408)');
  ok(s2b.exclude.includes('VOID') && s2b.exclude.includes('WITHDRAWN') && s2b.exclude.includes('DENIED')
     && s2b.exclude.includes('CANCELLED') && s2b.exclude.includes('EXPIRED')
     && s2b.exclude.includes('OUT OF JURISDICTION'),
    'dead statuses excluded — a denied or voided permit is not a development record');
  // HOLD started as `proposed` here and the stalled-status lint rejected it, correctly:
  // a permit on hold is not progressing, and bucketing it as proposed claims motion it
  // does not have. Pinned so it cannot drift back without this assertion failing first.
  ok(s2b.exclude.includes('HOLD') && !s2b.proposed.includes('HOLD'),
    'HOLD → exclude, never proposed (stalled values must not claim motion)');
}

// ── 3. Type vocabulary — whitelist and map agree, inside the closed use_type set ─
const USE_TYPES = new Set(['Industrial', 'Development', 'Residential', 'Utility', 'Commercial', 'Civic/Public']);
{
  const kept = new Set(ENTRY.include_types);
  const mapped = new Set(Object.keys(ENTRY.type_map));
  ok(kept.size === mapped.size && [...kept].every((t) => mapped.has(t)),
    'every included type has a type_map entry and vice versa (an unmapped kept type would emit "unclassified" and render as a generic circle)',
    JSON.stringify([...kept].filter((t) => !mapped.has(t))));
  const bad = Object.entries(ENTRY.type_map).filter(([, v]) => !USE_TYPES.has(v));
  ok(bad.length === 0, 'every mapped value is one of the six canonical use_types', JSON.stringify(bad));
  // Trades are the bulk of this layer and are deliberately dropped at source (the WA/MN/IL
  // precedent). If one ever appears in include_types it is a real change of policy, not a typo.
  for (const trade of ['BUILDING MECHANICAL', 'BUILDING ELECTRIC', 'BUILDING PLUMBING', 'BUILDING SIGN']) {
    ok(!kept.has(trade), `${trade} stays dropped at source (trades noise, WA/MN/IL precedent)`);
    ok(ENTRY.observed_types_unreviewed.includes(trade), `${trade} is recorded in observed_types_unreviewed, not silently forgotten`);
  }
}

// ── 4. THE PII GUARD — the reason this file exists ───────────────────────────────
const PII = ['OWNER', 'APPLICANT', 'CONTRACTOR'];
{
  ok(Array.isArray(ENTRY.out_fields) && ENTRY.out_fields.length > 0,
    'out_fields is present and non-empty — without it arcgis.ts requests outFields=* and pulls every owner column');
  const leaky = ENTRY.out_fields.filter((f) => PII.some((p) => f.toUpperCase().includes(p)));
  ok(leaky.length === 0, 'no owner/applicant/contractor column in out_fields', JSON.stringify(leaky));
  const mapped = Object.values(ENTRY.column_map).flatMap((v) => (Array.isArray(v) ? v : [v]));
  const leakyMap = mapped.filter((f) => PII.some((p) => String(f).toUpperCase().includes(p)));
  ok(leakyMap.length === 0, 'no owner/applicant/contractor column in column_map', JSON.stringify(leakyMap));
}

// ── 5. Drive the SHIPPED connector over the real captured response ───────────────
const FIXTURE = JSON.parse(readFileSync(join(root, 'fixtures/bismarck/building-permit-main-sample.json'), 'utf8'));

function stubFetch(calls) {
  let served = false;
  return async (url) => {
    calls.push(String(url));
    const body = served ? { features: [] } : FIXTURE;
    served = true;
    return { ok: true, status: 200, json: async () => body };
  };
}

{
  const calls = [];
  const { sites, reports } = await arcgisForZip(
    '58503',
    [{ state: 'ND', county: 'Burleigh' }],
    [ENTRY],
    { fetch: stubFetch(calls) },
  );
  ok(sites.length === 3, `all 3 fixture features emitted (got ${sites.length})`);
  ok(sites.every((s) => s.record_url === ENTRY.dataset_url && s.record_url_precision === 'dataset'),
    'every record carries the dataset-precision record_url (anti-fabrication gate)');
  ok(sites.every((s) => typeof s.lat === 'number' && typeof s.lng === 'number' && s.scope === 'point'),
    'every record is pinned from its own geometry');
  ok(sites.every((s) => s.lat > 46.7 && s.lat < 47.0 && s.lng > -101.0 && s.lng < -100.6),
    'pins land in Bismarck, not another jurisdiction',
    JSON.stringify(sites.map((s) => [s.lat, s.lng])));
  ok(sites.every((s) => USE_TYPES.has(s.use_type)), 'no record emits use_type "unclassified"',
    JSON.stringify(sites.map((s) => s.use_type)));
  ok(sites.every((s) => s.source_registry_id === 'bismarck-building-permits' && s.jurisdiction === 'City of Bismarck'),
    'records are stamped with the Bismarck registry id + jurisdiction');
  ok(sites.every((s) => s.case_number && s.file_date), 'every record carries its permit number and filing date');
  ok(reports[0].unmapped_statuses.length === 0 && reports[0].blank_status === 0,
    'run report shows no unmapped or blank statuses');

  // THE REQUEST ITSELF must not ask for PII — asserted against the shipped URL, not the config.
  const leakyUrl = calls.filter((u) => PII.some((p) => decodeURIComponent(u).toUpperCase().includes(p)));
  ok(leakyUrl.length === 0, 'the outgoing request never asks for an owner/applicant/contractor field',
    JSON.stringify(leakyUrl.slice(0, 1)));
  ok(calls[0].includes('outFields=') && !calls[0].includes('outFields=*'),
    'outFields is a projection, never the wildcard');
  ok(decodeURIComponent(calls[0]).includes("SITE_ZIP='58503'") || decodeURIComponent(calls[0]).includes('SITE_ZIP = \'58503\''),
    'the query filters on the native ZIP column', decodeURIComponent(calls[0]).slice(0, 300));
  ok(calls[0].includes('outSR=4326'), 'geometry is requested in WGS84, not the layer-native wkid 2910');

  // And no emitted site may carry a PII-shaped key, whatever the source sent.
  const leakySite = sites.flatMap((s) => Object.keys(s)).filter((k) => PII.some((p) => k.toUpperCase().includes(p)));
  ok(leakySite.length === 0, 'no emitted site object carries an owner/applicant/contractor key',
    JSON.stringify(leakySite));
}

// ── 6. Coverage gate, BOTH directions ────────────────────────────────────────────
{
  const calls = [];
  const { sites } = await arcgisForZip(
    '58102',                                   // Fargo — ND, but Cass County
    [{ state: 'ND', county: 'Cass' }],
    [ENTRY],
    { fetch: stubFetch(calls) },
  );
  ok(sites.length === 0 && calls.length === 0,
    'an in-state, out-of-COUNTY ZIP never even fetches the layer (Bismarck rides Burleigh pages only)');
}
{
  const calls = [];
  const { sites } = await arcgisForZip(
    '57101',                                   // Sioux Falls SD
    [{ state: 'SD', county: 'Minnehaha' }],
    [ENTRY],
    { fetch: stubFetch(calls) },
  );
  ok(sites.length === 0 && calls.length === 0, 'an out-of-state ZIP never fetches the layer');
}

console.log();
if (fails) { console.log(`${fails} check(s) FAILED`); process.exit(1); }
console.log('All bismarck-connector checks passed.');
