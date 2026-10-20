// Oregon pre-launch fixes (2026-10-20), driven through the SHIPPED code — no network.
//
//   1. portland-building-permits: Type from NEWTYPE (the building type), not NEWCLASS (the work).
//      Measured upstream (layer 89, pg_net 2026-10-20): NEWCLASS alias "Standardized Work Description"
//      = New Construction / Alteration / Addition / Move / Replacement / First; NEWTYPE alias
//      "Standardized Building Type" = 20 values. With the columns swapped, all 896 cached Portland
//      permits drew as "Other project". "Under Inspection" (work in progress) is Approved, not
//      Operating now (founder ruling 2026-10-20: an issued permit is approved).
//   2. A connection reset is retried (sources/fetch-retry.ts); a timeout is not.
//   3. A future filed/issued date is refused, the record kept (sources/date-sanity.ts).
//   4. An Accessory Dwelling Unit is a dwelling, not an accessory object (lib/residential-qualify.js).
// Run: node scripts/run-unit-tests.mjs   (or: node test/oregon-prelaunch-2026-10-20.test.mjs)
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fn = join(root, 'supabase/functions/get-address-report');
let fails = 0;
const ok = (c, name, detail) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name + (!c && detail ? '\n     ' + detail : ''));
  if (!c) fails++;
};

const { arcgisForZip } = await import(join(fn, 'sources/arcgis.ts'));
const { isRetryableNetworkError } = await import(join(fn, 'sources/fetch-retry.ts'));
const { refuseFutureFilingDates } = await import(join(fn, 'sources/date-sanity.ts'));
const registry = JSON.parse(readFileSync(join(fn, 'jurisdiction-registry.json'), 'utf8'));
const portland = registry.arcgis.find((e) => e && e.registry_id === 'portland-building-permits');

console.log('\n1) Portland registry entry');
// Every NEWTYPE value the layer carries (groupBy and returnDistinctValues agreed, 2026-10-20).
const NEWTYPE_VALUES = ['Single Family Dwelling', 'Rowhouse', 'Accessory Dwelling Unit', 'Duplex',
  'Apartments/Condos', 'Business', 'Conversion', 'Special Residential', 'Hotel/Motel', 'Assembly',
  'Townhouse', 'Floating Home', 'Institutional', 'Mercantile', 'Factory/Industrial', 'Storage',
  'Row House', 'Duplex/Two Family Dwelling', 'Accessory Structure'];
ok(portland.column_map.type_source === 'NEWTYPE', 'type_source is NEWTYPE (the building type)');
ok(!portland.include_types, 'no include_types (it would filter the building-type column)');
ok(/NEWCLASS IN \(/.test(portland.extra_where || ''), 'the work filter stays, on NEWCLASS, in extra_where');
const unmapped = NEWTYPE_VALUES.filter((v) => !portland.type_map[v]);
ok(unmapped.length === 0, 'every upstream NEWTYPE value is mapped', unmapped.join(', '));
ok(portland.status_to_bucket.approved.includes('Under Inspection'), '"Under Inspection" is Approved');
ok(!portland.status_to_bucket.operating.includes('Under Inspection') &&
   JSON.stringify(portland.status_to_bucket.operating) === '["Final"]', 'Operating now is "Final" only');
ok(portland.commercial_work_evidence?.column === 'NEWCLASS', 'Commercial needs work evidence from NEWCLASS');

console.log('\n2) the shipped connector over Portland-shaped rows, through two connection resets');
const day = Date.UTC(2026, 8, 1);
const row = (id, cls, type, status) => ({
  attributes: { NEWCLASS: cls, NEWTYPE: type, WORKDESC: cls, STATUS: status, ISSUEDATE: day,
                PROP_ADDRE: id + ' SE MAIN ST', FOLDERNUMB: id },
  geometry: { x: -122.65, y: 45.51 },
});
const FEATURES = [
  row('t1', 'New Construction', 'Townhouse', 'Under Inspection'),
  row('s1', 'New Construction', 'Single Family Dwelling', 'Final'),
  row('a1', 'New Construction', 'Accessory Dwelling Unit', 'Issued'),
  row('b1', 'Alteration', 'Business', 'Issued'),
  row('b2', 'Move', 'Business', 'Issued'),
];
let calls = 0, urls = [];
const resetTwice = {
  fetch: async (url) => {
    calls++; urls.push(String(url));
    if (calls <= 2) throw new TypeError('error sending request for url: client error (Connect): Connection reset by peer (os error 104)');
    return { ok: true, status: 200, json: async () => (calls === 3 ? { features: FEATURES, exceededTransferLimit: false } : { features: [] }) };
  },
  zipCentroid: { lat: 45.51, lng: -122.65 },
};
const { sites, reports } = await arcgisForZip('97214', [{ state: 'OR', county: 'Multnomah' }], [portland], resetTwice);
const by = Object.fromEntries(sites.map((s) => [s.case_number, s]));
ok(reports[0].quarantined.length === 0, 'two resets did not fail the source', JSON.stringify(reports[0].quarantined));
ok(sites.length === 5, 'all five rows emitted after the retries', 'emitted ' + sites.length);
ok(by.t1?.use_type === 'Residential' && by.t1?.type === 'approved', 'Townhouse, Under Inspection → Residential, Approved');
ok(by.s1?.use_type === 'Residential' && by.s1?.type === 'built', 'Single Family, Final → Residential, Operating now');
ok(by.a1?.use_type === 'Residential', 'new ADU → Residential');
ok(by.b1?.use_type === 'Commercial', 'Business + Alteration (qualifying work) → Commercial');
ok(by.b2?.use_type === 'other project', 'Business + Move (no qualifying work) → Other project, never Commercial');
ok(urls.some((u) => /NEWCLASS/.test(decodeURIComponent(u))) && !urls.some((u) => /NEWTYPE\s+IN/.test(decodeURIComponent(u).replace(/\+/g, ' '))),
  'the outgoing query filters NEWCLASS and never NEWTYPE');

console.log('\n3) a timeout is NOT retried (each attempt already waits 30 s)');
let tcalls = 0;
const timeoutOnce = {
  fetch: async () => { tcalls++; const e = new Error('Signal timed out.'); e.name = 'TimeoutError'; throw e; },
  zipCentroid: { lat: 45.51, lng: -122.65 },
};
const t = await arcgisForZip('97214', [{ state: 'OR', county: 'Multnomah' }], [portland], timeoutOnce);
ok(tcalls === 1, 'one attempt only', 'calls ' + tcalls);
ok(/fetch failed: Signal timed out/.test(t.reports[0].quarantined[0]?.reason || ''), 'reported as a fetch failure');
ok(isRetryableNetworkError(new TypeError('Connection reset')) && !isRetryableNetworkError(Object.assign(new Error('x'), { name: 'AbortError' })),
  'isRetryableNetworkError: TypeError yes, AbortError no');
ok(!isRetryableNetworkError(Object.assign(new TypeError('timed out'), { name: 'TimeoutError' })),
  'isRetryableNetworkError: a timeout is never retried, even if a runtime wraps it in a TypeError');
for (const f of ['arcgis.ts', 'socrata.ts', 'ckan.ts', 'carto.ts']) {
  const src = readFileSync(join(fn, 'sources', f), 'utf8');
  const loop = src.slice(src.indexOf('async function getWithBackoff'));
  ok(/attemptFetch\(\(\) => deps\.fetch\(/.test(loop) && /if \(lastNet\) throw lastNet;/.test(loop),
    f + ': its backoff loop goes through attemptFetch and keeps the reset as the reported error');
}

console.log('\n4) future filing/issue dates');
const out = refuseFutureFilingDates([
  { case_number: 'BP20-877', file_date: '2033-10-20', file_date_kind: 'issued' },   // Bend, real
  { case_number: 'f1', file_date: '2027-01-01', file_date_kind: 'filed' },
  { case_number: 'ok1', file_date: '2026-10-21', file_date_kind: 'issued' },         // tomorrow: tolerated
  { case_number: 'stip', file_date: '2028-06-01', file_date_kind: 'scheduled' },     // untouched
  { case_number: 'hr', file_date: '2026-11-15', file_date_kind: 'hearing' },         // untouched
  { case_number: 'old', file_date: '2025-04-02', file_date_kind: 'issued' },
], '2026-10-20');
const o = Object.fromEntries(out.map((r) => [r.case_number, r]));
ok(o['BP20-877'].file_date === null && o['BP20-877'].file_date_refused === '2033-10-20', 'Bend BP20-877 keeps the record, loses the 2033 date');
ok(o.f1.file_date === null, 'a future FILED date is refused too');
ok(o.ok1.file_date === '2026-10-21', 'one day ahead is tolerated');
ok(o.stip.file_date === '2028-06-01' && o.hr.file_date === '2026-11-15', 'scheduled and hearing dates are never touched');
ok(o.old.file_date === '2025-04-02' && !('file_date_refused' in o.old), 'past dates unchanged');
ok(out.length === 6, 'no record is dropped');
const idx = readFileSync(join(fn, 'index.ts'), 'utf8');
ok(/refuseFutureFilingDates\(\[\.\.\.tabsSites, \.\.\.socrataSites, \.\.\.arcgisSites, \.\.\.ckanSites, \.\.\.csvSites, \.\.\.cartoSites\], today\)/.test(idx),
  'index.ts applies it to every permit connector before dedup');

console.log('\n5) an ADU is a dwelling');
global.window = { HS: {} };
await import(join(root, 'lib/project-type.js'));
await import(join(root, 'lib/residential-qualify.js'));
const HS = global.window.HS;
const q = (t, n) => HS.residentialQualifies({ type_raw: t, name: n, registry_id: 'portland-building-permits' });
ok(q('Accessory Dwelling Unit', 'Accessory Dwelling Unit New Construction'), 'new ADU construction qualifies');
ok(!q('Accessory Dwelling Unit', 'Accessory Dwelling Unit Alteration'), 'an ADU alteration is still routine');
ok(!q('Accessory Dwelling Unit', 'Accessory Dwelling Unit'), 'a bare ADU record is still not development by itself');
ok(!q('Accessory Structure', 'Accessory Structure New Construction'), 'an accessory STRUCTURE is still routine');
const gen = execFileSync(process.execPath, [join(root, 'scripts/residential-qualify-sql.mjs'), '--norm'], { encoding: 'utf8' });
ok((gen.match(/' accessory dwelling ', ' adu dwelling '/g) || []).length === 2, 'the generated SQL normaliser (--norm) applies the same rewrite to type_raw and name');

console.log(`\n${fails ? 'FAILED' : 'OK'} — ${fails} failure(s)`);
process.exit(fails ? 1 : 0);
