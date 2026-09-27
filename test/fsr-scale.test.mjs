// Steps 9–13: coverage, usage, listing, portfolio, allowlist API pins.
// Run: node test/fsr-scale.test.mjs
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const V1 = require('../lib/nyc-v1-report.js');
const Scale = require('../lib/fsr-scale.js');
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

const missReport = await V1.assembleReport({
  address: '1 Nowhere Street',
  zip: '10007',
  address_points: [centre],
  issuance: [issuanceNear],
  dobnow: []
});

const matrix = Scale.coverageMatrix();
ok(matrix.assemblable_market_ids.length === 1 && matrix.assemblable_market_ids[0] === 'nyc-v1',
  '9a only NYC V1 is assemblable');
ok(matrix.signed_paid_pilots === 0 && matrix.verdict === 'NOT YET', '9b signed pilots stay 0');
const nyc = matrix.markets.find((m) => m.id === 'nyc-v1');
const sea = matrix.markets.find((m) => m.id === 'seattle');
ok(nyc && nyc.assemblable && nyc.geography.dataset_id === 'uf93-f8nk', '9c NYC geography is AddressPoint');
ok(sea && !sea.assemblable && /HOLD/.test(sea.geography.classification), '9d Seattle geography is HOLD');
ok(sea.geography.assetType === 'federated_href', '9e Seattle MAF is federated_href');
ok(/FeatureServer/.test(sea.geography.access_points.join(' ')), '9f Seattle MAF points at ArcGIS');
ok(sea.publisher_data[0].classification === 'CLEARED WITH ATTRIBUTION', '9g Seattle permits stay cleared');

const store = Scale.memoryStore();
const listing = Scale.listingSummary(report);
ok(listing.version === 'nyc-v1-listing' && listing.derived_from === report.report_id, '11a listing derives from report_id');
ok(listing.nearby_count === 1 && listing.nearest.case_number === 'JOB1', '11b listing counts nearby');
ok(listing.listing.addresspointid === '1001387', '11c listing keeps AddressPoint id');
ok(!listing.score && !listing.outlook && !listing.sowhat, '11d listing has no prediction fields');
const missListing = Scale.listingSummary(missReport);
ok(missListing.nearby_count === 0 && missListing.listing.addresspointid == null, '11e miss listing has no pin');
ok(Scale.listingSummary({ product: 'other' }).status === 'rejected', '11f foreign payload rejected');
ok(Scale.listingSummary({ product: report.product, version: 'get-address-report' }).status === 'rejected',
  '11g get-address-report version rejected');

ok(Scale.addToPortfolio(store, { product: 'x' }).ok === false, '12a refuse non-allowlist objects');
ok(Scale.addToPortfolio(store, report).ok === true, '12b store an NYC V1 report');
ok(Scale.addToPortfolio(store, report).ok === true, '12c same report_id replaces, does not duplicate');
ok(Scale.listPortfolio(store).length === 1, '12d one stored report');
ok(Scale.addToPortfolio(store, missReport).ok === true, '12e miss reports may be stored');
const port = Scale.summarizePortfolio(store);
ok(port.count === 2 && port.unique_addresspoints === 1 && port.nearby_total === 1, '12f portfolio summary', port);
ok(port.signed_paid_pilots === 0 && port.markets['nyc-v1'] === 2, '12g portfolio stays NYC-only and unsold');
ok(Scale.removeFromPortfolio(store, report.report_id).count === 1, '12h remove by report_id');

Scale.recordUse(store, { kind: 'build', report_id: report.report_id, at: '2026-09-27T00:00:00.000Z' });
Scale.recordUse(store, { kind: 'json', report_id: report.report_id, at: '2026-09-27T00:01:00.000Z' });
const usage = Scale.usageSummary(store);
ok(usage.events === 2 && usage.by_kind.build === 1 && usage.distinct_report_ids === 1, '10a usage counts');
ok(usage.signed_paid_pilots === 0 && /No customer has been sold/.test(usage.note), '10b signed pilots stay 0');

const good = Scale.validateApiRequest({ address: '1 Centre Street', zip: '10007', radius_mi: 0.5 });
ok(good.ok && good.market === 'nyc-v1' && good.radius_mi === 0.5, '13a allowlisted request accepted');
ok(!Scale.validateApiRequest({ address: '1 Centre Street', lat: 40.7 }).ok, '13b lat/lng rejected');
ok(!Scale.validateApiRequest({ address: '1 Centre Street', market: 'seattle' }).ok, '13c Seattle market rejected');
ok(!Scale.validateApiRequest({ address: '1 Centre Street', geocode: true }).ok, '13d geocode field rejected');
ok(!Scale.validateApiRequest({ zip: '10007' }).ok, '13e address required');
ok(Scale.apiCapability().datasets.join(',') === 'uf93-f8nk,ipu4-2q9a,rbx6-tga4', '13f capability names three views');
ok(Scale.apiCapability().signed_paid_pilots === 0, '13g capability signed pilots stay 0');

const page = read('future-surroundings-report.html');
ok(/data-view="coverage"/.test(page) && /data-view="listing"/.test(page), '14a page has coverage and listing views');
ok(/data-view="portfolio"/.test(page) && /data-view="usage"/.test(page), '14b page has portfolio and usage views');
ok(/lib\/fsr-scale\.js/.test(page), '14c page loads the scale library');
ok(!/get-address-report|homesignalmap|openstreetmap|value_outlook|Effect at this address/.test(page),
  '14d page source stays off HOLD/EXCLUDE surfaces');
ok(/Signed paid pilots: 0/.test(page), '14e page states signed pilots are 0');

const api = read('supabase/functions/get-future-surroundings-report/index.ts');
const allow = read('supabase/functions/get-future-surroundings-report/allowlist.ts');
ok(/from '\.\/allowlist\.ts'/.test(api), '13h API imports local allowlist only');
ok(!/get-address-report|geocode-address|geocoding\.geo\.census\.gov/.test(api),
  '13i API index does not call the held stack');
ok(!/from ['"].*get-address-report/.test(allow), '13j allowlist does not import get-address-report');
ok(/data\.cityofnewyork\.us/.test(allow) && /uf93-f8nk/.test(allow), '13k allowlist stays on NYC Socrata');
ok(/FORBIDDEN_HOST_RE/.test(allow) && /arcgis/.test(allow), '13l allowlist forbids ArcGIS hosts');

const coverageDoc = read('docs/corporate-output-coverage-matrix-2026-09-27.md');
ok(/federated_href/.test(coverageDoc) && /TRANSPO_MAFDAP_PV/.test(coverageDoc),
  '9h coverage evidence records Seattle MAF ArcGIS pointer');
ok(/The additional-market choice is: \*\*none\*\*/.test(coverageDoc), '9i no second market is forced');

const scaleDoc = read('docs/corporate-output-fsr-scale-2026-09-27.md');
ok(/signed_paid_pilots` is \*\*0\*\*/.test(scaleDoc), '10c scale evidence keeps signed at 0');
ok(/get-future-surroundings-report/.test(scaleDoc), '13m scale evidence names the new function');

const staged = execFileSync('python3', [join(root, 'scripts/stage_site.py'), '--src', root, '--list-only'], { encoding: 'utf8' })
  .split('\n').map((l) => l.trim()).filter(Boolean);
ok(staged.includes('lib/fsr-scale.js'), '14f scale library ships');

const cfg = read('supabase/config.toml');
ok(/functions\.get-future-surroundings-report/.test(cfg) && /verify_jwt = true/.test(cfg),
  '13n JWT stays on for the allowlist API');

ok(existsSync(join(root, 'docs/corporate-output-coverage-matrix-2026-09-27.md')), '9j coverage file exists');
ok(existsSync(join(root, 'docs/corporate-output-fsr-scale-2026-09-27.md')), '10d scale file exists');

console.log(fails ? '\n' + fails + ' FAILED' : '\nALL PASSED');
process.exit(fails ? 1 : 0);
