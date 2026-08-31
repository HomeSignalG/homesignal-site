// Offline checks for the Jackson County, OREGON permit pair.
//
// WHY THIS EXISTS. Oregon is statewide-covered by the ODOT STIP pair, and 89 Oregon pages are
// STILL dark — because a STIP reaches project corridors, not neighbourhoods. This is the first
// wire against the COVERED-BUT-UNREACHED class, which the 2026-08-31 measurement showed is
// 1,983 of the 2,388 remaining dark pages nationally: the large majority of the work left.
//
// ⚠️⚠️ THIS IS OREGON. It was found by accident while probing a MISSISSIPPI lead — an AGO search
// for MS permits returned owner `JCGIS_Owner`, which resolves to jacksoncountyor.gov (extent
// lat 42.00–42.94, southern Oregon). The same search also returned
// `City_of_Jackson_TN_Building_Permits`, which is TENNESSEE.
//
// ⚠️ AND THE COUNTY'S OWN CITIES ARE TRAPS. Jackson County OR contains cities named **Phoenix**
// and **Talent**, so its `Phoenix_Building_Permits_view` and `Talent Building Permits View`
// layers are OREGON — not Phoenix, ARIZONA, where this project already has a wired source.
// Confirm the state before the schema.
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
const BLD = REG.arcgis.find((e) => e.registry_id === 'jackson-county-or-building-permits');
const LU = REG.arcgis.find((e) => e.registry_id === 'jackson-county-or-land-use-permits');
ok(!!BLD && !!LU, 'both Jackson County OR entries exist');
if (!BLD || !LU) { console.log('\n1 check(s) FAILED'); process.exit(1); }
const BOTH = [['building', BLD], ['land-use', LU]];

// ── 1. Oregon, on the county's own server, and only ONE of the two copies ────────
for (const [n, e] of BOTH) {
  ok(e.coverage.length === 1 && e.coverage[0].state === 'OR' && e.coverage[0].county === 'Jackson',
    `${n}: coverage is exactly OR/Jackson — never MS, TN, or Phoenix AZ`);
  ok(e.service_url.startsWith('https://jcportal.jacksoncountyor.gov/server/rest/services/Property/'),
    `${n}: reads the county's own jcportal server`);
  ok(!/spatial\.jacksoncountyor\.gov/.test(e.service_url),
    `${n}: does NOT read the DevServ MapServer copy`);
}
{
  // The second server carries the SAME data with FEWER rows; wiring both would double-emit
  // across two source_registry_ids, which exact-identity dedup cannot catch.
  const devserv = REG.arcgis.filter((e) => typeof e.service_url === 'string'
    && e.service_url.includes('spatial.jacksoncountyor.gov'));
  ok(devserv.length === 0, 'the DevServ MapServer copy is wired ZERO times', devserv.map((e) => e.registry_id).join(', '));
  ok(BLD.service_url.endsWith('/Permits_Building/FeatureServer/1'),
    'building reads layer 1 — layer 0 does not exist on that service');
  ok(LU.service_url.endsWith('/Permits_LandUse/FeatureServer/0'), 'land-use reads layer 0');
  // jcportal 251,367 / 88,801 vs DevServ 243,044 / 40,648 — jcportal is the fuller copy.
  ok(251367 > 243044 && 88801 > 40648, 'jcportal carries MORE rows than DevServ on both layers');
}

// ── 2. PII IS FENCED OUT — the Bismarck precedent ───────────────────────────────
for (const [n, e] of BOTH) {
  for (const pii of ['APPLICANT', 'CONTRACTOR']) {
    ok(!JSON.stringify(e.column_map).includes(pii), `${n}: ${pii} (a person's name) is NOT mapped`);
    ok(!e.out_fields.includes(pii), `${n}: ${pii} is NOT even fetched`);
  }
}

// ── 3. Record precision is EARNED — LINK is null on 0 rows of both layers ───────
for (const [n, e] of BOTH) {
  ok(e.column_map.record_url === 'LINK', `${n}: record_url reads the per-record LINK column`);
  ok(e.record_url_precision === 'record', `${n}: record precision, because LINK is populated on every row`);
  ok(e.out_fields.includes('LINK'), `${n}: LINK is fetched`);
}

// ── 4. Complete vocabularies — every live value mapped or explicitly excluded ────
{
  const BLD_STATUS = { 'Approved': 187905, 'Pending': 24363, 'Other': 14707, 'Denied or Expired': 13166, 'Withdrawn': 11226 };
  const BLD_TYPE = { 'Residential': 154725, 'Commercial': 95541, 'Disaster Relief': 760, 'Inquiry': 341 };
  const LU_STATUS = { 'Approved': 65948, 'Pending': 19073, 'Withdrawn': 2343, 'Denial': 1230, 'Other': 207 };
  const LU_TYPE = { 'Zoning': 75509, 'Subdivision': 6774, 'Pre-Application Conference': 4778, 'Site Plan Review': 1740 };

  ok(Object.values(BLD_STATUS).reduce((a, b) => a + b, 0) === 251367, 'building STATUSCAT sums EXACTLY to 251,367');
  ok(Object.values(BLD_TYPE).reduce((a, b) => a + b, 0) === 251367, 'building PERMITTYPE sums EXACTLY to 251,367');
  ok(Object.values(LU_STATUS).reduce((a, b) => a + b, 0) === 88801, 'land-use STATUSCAT sums EXACTLY to 88,801');
  ok(Object.values(LU_TYPE).reduce((a, b) => a + b, 0) === 88801, 'land-use PERMITTYPE sums EXACTLY to 88,801');

  for (const [n, e, st, ty, dropped] of [
    ['building', BLD, BLD_STATUS, BLD_TYPE, 'Inquiry'],
    ['land-use', LU, LU_STATUS, LU_TYPE, 'Pre-Application Conference'],
  ]) {
    const bucketed = new Set([...e.status_to_bucket.proposed, ...e.status_to_bucket.approved,
                              ...e.status_to_bucket.operating, ...e.status_to_bucket.exclude]);
    const unb = Object.keys(st).filter((s) => !bucketed.has(s));
    ok(unb.length === 0, `${n}: every live STATUSCAT is bucketed`, unb.join(', '));
    const all = [...e.status_to_bucket.proposed, ...e.status_to_bucket.approved,
                 ...e.status_to_bucket.operating, ...e.status_to_bucket.exclude];
    ok(all.length === new Set(all).size, `${n}: no status sits in two buckets`);
    // Every live type is either mapped or dropped at source — never silently unclassified.
    const unmapped = Object.keys(ty).filter((t) => !(t in e.type_map) && t !== dropped);
    ok(unmapped.length === 0, `${n}: every KEPT PERMITTYPE is mapped`, unmapped.join(', '));
    ok(!(dropped in e.type_map), `${n}: the dropped type "${dropped}" is not mapped — it is excluded at source`);
    ok(e.extra_where === `PERMITTYPE <> '${dropped}'`, `${n}: extra_where drops "${dropped}"`, e.extra_where);
  }
}

// ── 5. THE TWO STATUS MAPS ARE DELIBERATELY DIFFERENT ───────────────────────────
// The land-use layer says "Denial"; the building layer says "Denied or Expired". Sharing one
// map would leave a live value unmapped on one of them.
ok(BLD.status_to_bucket.exclude.includes('Denied or Expired') && !BLD.status_to_bucket.exclude.includes('Denial'),
  'building excludes "Denied or Expired" — its own wording');
ok(LU.status_to_bucket.exclude.includes('Denial') && !LU.status_to_bucket.exclude.includes('Denied or Expired'),
  'land-use excludes "Denial" — its own wording, NOT the building layer\'s');
ok(JSON.stringify(BLD.status_to_bucket) !== JSON.stringify(LU.status_to_bucket),
  'the two status maps are not shared');

// ── 6. The calls most likely to be "corrected" wrongly later ────────────────────
ok(BLD.column_map.status_raw === 'STATUSCAT' && !JSON.stringify(BLD.column_map).includes('PERMITSTAT'),
  'building reads STATUSCAT, not PERMITSTAT — the latter is 37 values with 12,494 NULLs');
ok(BLD.status_to_bucket.approved.includes('Approved') && BLD.status_to_bucket.operating.length === 0,
  '"Approved" buckets to approved on the publisher\'s own word; nothing is claimed built');
for (const [n, e] of BOTH) {
  ok(e.status_to_bucket.exclude.includes('Other'),
    `${n}: the opaque "Other" residual is EXCLUDED, never guessed into a bucket`);
}
{
  const CLOSED = new Set(['Residential', 'Commercial', 'Utility', 'Development', 'Industrial', 'Civic/Public']);
  for (const [n, e] of BOTH) {
    const off = [...new Set(Object.values(e.type_map))].filter((v) => !CLOSED.has(v));
    ok(off.length === 0, `${n}: every mapped use_type is in the closed six-value vocabulary`, off.join(', '));
  }
  ok(Object.values(LU.type_map).every((v) => v === 'Development'),
    'land-use cases all map to the generic Development — none asserts a built use');
}

// ── 7. recency_days is MEASURED, not guessed ────────────────────────────────────
// Live 3-mile envelope around Medford 97501: 21,980 all-time (the Cleveland row-size hazard on a
// single page), 1,194 at 1095 days, 443 at 365.
for (const [n, e] of BOTH) {
  ok(e.recency_days === 1095, `${n}: recency_days 1095`);
  ok(e.column_map.file_date === 'SUBMITDT' && e.file_date_kind === 'filed',
    `${n}: file_date is SUBMITDT, declared filed`);
  ok(e.column_map.decision_date === 'APPROVEDT', `${n}: APPROVEDT is the decision date, not the filing`);
}
ok(21980 > 1194 && 1194 > 443, 'the measured envelope counts order all-time > 1095d > 365d');

// ── 8. Shape ────────────────────────────────────────────────────────────────────
for (const [n, e] of BOTH) {
  ok(e.spatial_zip_radius_mi === 3, `${n}: spatial ZIP scoping at 3 mi — no ZIP column exists`);
  ok(e.column_map.lat === '__lat' && e.column_map.lng === '__lng',
    `${n}: geometry rides the connector's flattened __lat/__lng`);
  ok(!JSON.stringify(e.column_map).includes('JURISDICTION'),
    `${n}: JURISDICTION is NOT mapped — a groupBy returns one blank value for every row`);
  const read = new Set();
  for (const v of Object.values(e.column_map)) for (const c of [].concat(v)) read.add(c);
  const missing = [...read].filter((c) => !c.startsWith('__') && !e.out_fields.includes(c));
  ok(missing.length === 0, `${n}: out_fields covers every mapped column`, missing.join(', '));
}

console.log(fails ? `\n${fails} check(s) FAILED` : '\nAll Jackson County OR assertions passed.');
process.exit(fails ? 1 : 0);
