// NYC V1 Future Surroundings Report — allowlist, miss, and no-prediction pins.
// Run: node test/nyc-v1-report.test.mjs
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const V1 = require('../lib/nyc-v1-report.js');
const Soda = require('../lib/nyc-v1-soda.js');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(root, f), 'utf8');

let fails = 0;
const ok = (c, name, detail) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name);
  if (!c) {
    fails++;
    if (detail !== undefined) console.log('           detail: ' + JSON.stringify(detail));
  }
};

const centre = {
  the_geom: { type: 'Point', coordinates: [-74.003758107366, 40.712980288068] },
  addresspointid: '1001387',
  house_number: '1',
  street_name: 'CENTRE',
  full_street_name: 'CENTRE ST',
  zipcode: '10007',
  boroughcode: '1'
};

const parsed = V1.parseBuyerAddress('1 Centre Street', '10007');
ok(parsed.house === '1' && parsed.zip === '10007', '1a parse house and ZIP', parsed);
ok(parsed.street === 'CENTRE ST' && parsed.street_core === 'CENTRE', '1b normalize street', parsed);

const hit = V1.matchAddressPoint([centre], parsed);
ok(hit.status === 'ok' && hit.point.addresspointid === '1001387', '1c AddressPoint match');

const miss = V1.matchAddressPoint([], parsed);
ok(miss.status === 'address_miss' && miss.point == null, '1d empty table is a miss');

const wrongZip = V1.matchAddressPoint([centre], V1.parseBuyerAddress('1 Centre Street', '10013'));
ok(wrongZip.status === 'address_miss', '1e ZIP mismatch is a miss');

const coords = V1.pointCoords(centre);
ok(coords && Math.abs(coords.lat - 40.712980288068) < 1e-9, '1f pin from the_geom');

const issuanceNear = {
  permit_type: 'NB',
  permit_status: 'ISSUED',
  issuance_date: '03/01/2026',
  house__: '2',
  street_name: 'CENTRE',
  gis_latitude: '40.7132',
  gis_longitude: '-74.0039',
  job__: 'JOB1',
  zip_code: '10007'
};
const issuanceFar = Object.assign({}, issuanceNear, {
  job__: 'JOBFAR',
  gis_latitude: '40.78',
  gis_longitude: '-73.96'
});
const issuanceNoType = Object.assign({}, issuanceNear, { permit_type: 'PL', job__: 'PLUMB' });
const issuanceNoCoord = Object.assign({}, issuanceNear, { job__: 'NOGEO', gis_latitude: '', gis_longitude: '' });

const nearby = V1.nearbyFromPublisherRows(
  [issuanceNear, issuanceFar, issuanceNoType, issuanceNoCoord],
  [],
  coords,
  0.5
);
ok(nearby.length === 1 && nearby[0].case_number === 'JOB1', '2a only allowlisted nearby issuance', nearby);
ok(nearby[0].distance_mi > 0 && nearby[0].distance_mi < 0.5, '2b distance is HomeSignal arithmetic');
ok(nearby[0].record_url === 'https://data.cityofnewyork.us/d/ipu4-2q9a', '2c dataset-precision URL');

const report = await V1.assembleReport({
  address: '1 Centre Street',
  zip: '10007',
  radius_mi: 0.5,
  address_points: [centre],
  issuance: [issuanceNear],
  dobnow: [],
  versions: { addresspoint: 'uf93-f8nk v1', issuance: 'ipu4-2q9a v1', dobnow: 'rbx6-tga4 v1' },
  retrieved_at: '2026-09-27T00:00:00.000Z',
  generated_at: '2026-09-27T00:00:00.000Z'
});
ok(report.version === 'nyc-v1' && report.status === 'ok', '3a assembled ok');
ok(/^[0-9a-f]{64}$/.test(report.report_id), '3b report_id is SHA-256', report.report_id);
ok(report.nearby.length === 1, '3c nearby retained');
ok(report.investigate.indexOf('does not predict') !== -1, '3d investigation prompt, not a forecast');
ok(report.exclusions.some(function (x) { return /get-address-report/.test(x); }), '3e exclusions name get-address-report');
const soldBody = JSON.stringify({
  nearby: report.nearby,
  property: report.property,
  investigate: report.investigate,
  buyer: report.buyer
});
ok(!/How it impacts you|value_outlook|Quality of Life Impact Score/.test(soldBody),
  '3f sold fields have no outlook / impact-score labels');
ok(report.exclusions.some(function (x) { return /Effect at this address/.test(x); }),
  '3f2 exclusions name Effect at this address instead of using it as a label');

const again = await V1.assembleReport({
  address: '1 Centre Street',
  zip: '10007',
  radius_mi: 0.5,
  address_points: [centre],
  issuance: [issuanceNear],
  dobnow: [],
  versions: { addresspoint: 'uf93-f8nk v1', issuance: 'ipu4-2q9a v1', dobnow: 'rbx6-tga4 v1' },
  retrieved_at: '2026-09-27T00:00:00.000Z',
  generated_at: '2026-09-28T00:00:00.000Z'
});
ok(again.report_id === report.report_id, '3g same data state produces the same report_id');

const missReport = await V1.assembleReport({
  address: '1 Nowhere Street',
  zip: '10007',
  address_points: [centre],
  issuance: [issuanceNear],
  dobnow: []
});
ok(missReport.status === 'address_miss' && missReport.nearby.length === 0 && missReport.property == null,
  '3h AddressPoint miss drops nearby and does not invent a pin');

ok(V1.forbiddenUrl('https://geocoding.geo.census.gov/geocoder/locations/onelineaddress'), '4a Census forbidden');
ok(V1.forbiddenUrl('https://services6.arcgis.com/x/arcgis/rest/services/AddressPoint_view/FeatureServer/0'), '4b ArcGIS forbidden');
ok(!V1.forbiddenUrl('https://data.cityofnewyork.us/resource/uf93-f8nk.json'), '4c Socrata allowed by host check');

ok(Soda.sodaUrl('resource', 'uf93-f8nk', { $limit: '1' }).indexOf('https://data.cityofnewyork.us/resource/uf93-f8nk.json') === 0,
  '4d sodaUrl stays on the portal');
let threw = false;
try { Soda.sodaUrl('resource', 'bc8t-ecyu', {}); } catch (_e) { threw = true; }
ok(threw, '4e PAD / other views are rejected');

const page = read('future-surroundings-report.html');
ok(/data\.cityofnewyork\.us/.test(page) && !/geocoding\.geo\.census\.gov/.test(page), '5a page CSP/connect is Socrata only');
ok(!/get-address-report|homesignalmap|openstreetmap|value_outlook|Effect at this address/.test(page),
  '5b page does not load HOLD/EXCLUDE surfaces');
ok(/Download JSON/.test(page) && /Print \/ PDF/.test(page) && /Copy share link/.test(page),
  '5c page exposes JSON, print, and share');
ok(/noindex/.test(page), '5d page is noindex');

const robots = read('robots.txt');
ok(robots.includes('Disallow: /future-surroundings-report.html'), '5e robots disallows the report page');

const staged = execFileSync('python3', [join(root, 'scripts/stage_site.py'), '--src', root, '--list-only'], { encoding: 'utf8' })
  .split('\n').map((l) => l.trim()).filter(Boolean);
ok(staged.includes('future-surroundings-report.html'), '5f page ships');
ok(staged.includes('lib/nyc-v1-report.js') && staged.includes('lib/nyc-v1-soda.js'), '5g libraries ship');
ok(existsSync(join(root, 'future-surroundings-report.html')), '5h template exists');

console.log(fails ? '\n' + fails + ' FAILED' : '\nALL PASSED');
process.exit(fails ? 1 : 0);
