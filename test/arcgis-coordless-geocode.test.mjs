// Drives the SHIPPED arcgis connector for `coordless_geocode_days` — no network.
//
// WHY (2026-11-09). Scottsdale's building-permit table (OpenData_Tabular/MapServer/12) has
// published every permit issued since 2026-10-07 with BLANK Latitude/Longitude (measured live:
// 13 of 13 filtered permits 2026-10-07..11-06 had null coordinates). The connector scopes this
// table with `Latitude >= … AND Longitude <= …` in WHERE, which a blank coordinate never matches,
// so Scottsdale's newest record on every page stuck at 2026-10-06 with no error anywhere.
// Measured the same day: Scottsdale's firewall answers 403 to any query containing `IS NULL`,
// so the fix must never send that wording.
//
// Run: node test/arcgis-coordless-geocode.test.mjs  (Node >= 22.18 type stripping)
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0;
const ok = (c, name, detail) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name + (!c && detail ? '\n     ' + detail : ''));
  if (!c) fails++;
};

let arcgisForZip;
try { ({ arcgisForZip } = await import(join(root, 'supabase/functions/get-address-report/sources/arcgis.ts'))); }
catch (err) { console.log('FAIL — import sources/arcgis.ts\n     ' + err.message); process.exit(1); }

const REG = JSON.parse(readFileSync(join(root, 'supabase/functions/get-address-report/jurisdiction-registry.json'), 'utf8'));
const SCOT = REG.arcgis.find((e) => e.registry_id === 'scottsdale-building-permits');
ok(!!SCOT, 'the Scottsdale entry exists');
ok(SCOT.coordless_geocode_days === 120, 'Scottsdale opts in with a 120-day window');
ok(SCOT.spatial_latlng_cols && SCOT.geocode_assemble === true, 'it is an attribute-bbox table that already geocodes with the assembled address');

// Every Scottsdale status the fixture uses must be mapped, or the rows would be dropped for that reason instead.
const statuses = Object.values(SCOT.status_to_bucket || {}).flat();
ok(statuses.includes('ACTIVE'), 'ACTIVE is a mapped Scottsdale status', JSON.stringify(SCOT.status_to_bucket));

const DAY = (s) => Date.parse(s + 'T00:00:00Z');
// Report ZIP 85255 (north Scottsdale) centroid.
const CENTROID = { lat: 33.6965, lng: -111.8770 };
const WITH_COORDS = { PermitNumber: 324300, PermitType: 'SFR-CUSTOM IN SUBDIVISION', PermitStatus: 'ACTIVE', IssueDate: DAY('2026-10-05'), Address: '1 WITH COORDS RD', Latitude: 33.70, Longitude: -111.88 };
const BLANK_INSIDE = { PermitNumber: 324447, PermitType: 'SFR-CUSTOM IN SUBDIVISION', PermitStatus: 'ACTIVE', IssueDate: DAY('2026-11-06'), Address: '9553 E MADERA DR', Latitude: null, Longitude: null };
const BLANK_FAR = { PermitNumber: 324411, PermitType: 'SFR-REMODEL', PermitStatus: 'ACTIVE', IssueDate: DAY('2026-10-12'), Address: '701 N 74TH ST', Latitude: null, Longitude: null };
const BLANK_FAILS = { PermitNumber: 324430, PermitType: 'SFR-ADDITION', PermitStatus: 'ACTIVE', IssueDate: DAY('2026-10-24'), Address: '13160 N 76TH ST', Latitude: null, Longitude: null };
const BLANK_NOADDR = { PermitNumber: 324431, PermitType: 'SFR-ADDITION', PermitStatus: 'ACTIVE', IssueDate: DAY('2026-10-25'), Address: '', Latitude: null, Longitude: null };

const GEO = {
  '9553 E MADERA DR, Scottsdale, AZ': { lat: 33.7040, lng: -111.8700, match_type: 'Exact', matched_address: '9553 E MADERA DR, SCOTTSDALE, AZ, 85255' },
  '701 N 74TH ST, Scottsdale, AZ': { lat: 33.4570, lng: -111.9200, match_type: 'Exact', matched_address: '701 N 74TH ST, SCOTTSDALE, AZ, 85257' },
};

function makeDeps({ blankRows = [BLANK_INSIDE, BLANK_FAR, BLANK_FAILS, BLANK_NOADDR, WITH_COORDS] } = {}) {
  const urls = [];
  const geocoded = [];
  return {
    urls, geocoded,
    deps: {
      zipCentroid: CENTROID,
      geocode: async (input) => { geocoded.push(input); return GEO[input] ?? null; },
      fetch: async (u, init) => {
        // A long WHERE (Scottsdale's permit-type list) is sent as a form POST, so read both.
        const qs = new URLSearchParams(init && typeof init.body === 'string' ? init.body : String(init?.body ?? ''));
        const url = String(u);
        const where = new URL(url).searchParams.get('where') || qs.get('where') || '';
        urls.push(url + ' ' + where);
        const envelope = where.includes('Latitude >=');
        const body = envelope ? { features: [{ attributes: WITH_COORDS }], exceededTransferLimit: false }
                              : { features: blankRows.map((a) => ({ attributes: a })), exceededTransferLimit: false };
        return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
      },
    },
  };
}

console.log('\n1) Scottsdale: blank-coordinate permits are read, geocoded, and kept only inside the ZIP');
{
  const { deps, urls, geocoded } = makeDeps();
  const { sites, reports } = await arcgisForZip('85255', [{ state: 'AZ', county: 'Maricopa' }], [SCOT], deps);
  const r = reports[0];
  const byCase = Object.fromEntries(sites.map((s) => [String(s.case_number), s]));
  ok(urls.length === 2, 'two reads: the envelope read and the coordinate-less read', urls.join('\n'));
  ok(urls.every((u) => !/is\s+null/i.test(u)),
    'no request carries "IS NULL" (Scottsdale\'s firewall answers 403 to it)');
  const second = urls[1];
  ok(!second.includes('Latitude >='), 'the second read has no coordinate envelope (blank coordinates can never match one)');
  ok(/IssueDate >= DATE '\d{4}-\d{2}-\d{2}'/.test(second), 'the second read is bounded by a date window', second);
  ok(second.includes("PermitType IN ("), 'the second read keeps the same permit-type filter as the first', second.slice(0, 200));
  ok(!!byCase['324300'] && byCase['324300'].geo_precision === 'point', 'the record with its own coordinates is unchanged (point precision)');
  ok(!!byCase['324447'], 'the blank-coordinate permit whose address geocodes inside the ZIP is now on the page');
  ok(byCase['324447']?.geo_precision === 'address' && byCase['324447']?.scope === 'point',
    'it is marked as placed from its address, never as a published point', JSON.stringify(byCase['324447'] && { p: byCase['324447'].geo_precision, s: byCase['324447'].scope }));
  ok(byCase['324447']?.lat === 33.7040 && byCase['324447']?.lng === -111.8700, 'it sits at the geocoded point');
  ok(byCase['324447']?.file_date === '2026-11-06', 'its issue date (Nov 6) is kept, so the source\'s newest record moves forward');
  ok(!byCase['324411'], 'a blank-coordinate permit that geocodes 15 miles away is NOT put on this ZIP');
  ok(!byCase['324430'], 'a permit whose address does not geocode is left out (no guessed point)');
  ok(!byCase['324431'], 'a permit with no address is left out');
  ok(geocoded.every((g) => !/\b85255\b/.test(g)), 'the geocoder is never handed this page\'s ZIP for a record of unknown ZIP', geocoded.join(' | '));
  const c = r.coordless_geocode;
  ok(c && c.blank === 4 && c.kept === 1 && c.outside_scope === 1 && c.geocode_failed === 1 && c.no_address === 1,
    'the run report counts what the coordinate-less read did', JSON.stringify(c));
}

console.log('\n2) Entries without the option behave exactly as before');
{
  const { deps, urls, geocoded } = makeDeps();
  const plain = { ...SCOT }; delete plain.coordless_geocode_days;
  const { sites, reports } = await arcgisForZip('85255', [{ state: 'AZ', county: 'Maricopa' }], [plain], deps);
  ok(urls.length === 1, 'one read only');
  ok(geocoded.length === 0, 'nothing is geocoded');
  ok(sites.length === 1 && String(sites[0].case_number) === '324300', 'only the record with coordinates');
  ok(reports[0].coordless_geocode === undefined, 'no coordless counts in the report');
}

console.log('\n3) A ZIP far from Scottsdale gets none of its blank-coordinate permits');
{
  const { deps } = makeDeps();
  deps.zipCentroid = { lat: 33.7380, lng: -112.1350 };   // 85083, north Phoenix
  const { sites } = await arcgisForZip('85083', [{ state: 'AZ', county: 'Maricopa' }], [SCOT], deps);
  ok(!sites.some((s) => s.geo_precision === 'address'), 'no geocoded Scottsdale permit lands on a Phoenix page', JSON.stringify(sites.map((s) => s.case_number)));
}

console.log(fails ? `\n${fails} check(s) FAILED` : '\nall checks passed');
process.exit(fails ? 1 : 0);
