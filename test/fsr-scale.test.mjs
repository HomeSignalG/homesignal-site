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
const cam = matrix.markets.find((m) => m.id === 'cambridge');
ok(cam && !cam.assemblable, '9k Cambridge is not assemblable');
ok(/HOLD/.test(cam.geography.classification), '9l Cambridge geography is HOLD despite the PDDL label');
ok(cam.hold.some((h) => /Commercial Use Prohibited/i.test(h)), '9m Cambridge HOLD names the prohibition');
ok(cam.publisher_data.every((p) => /HOLD/.test(p.classification)), '9n Cambridge permits are HOLD too');
ok(nyc.publisher_data.some((p) => p.dataset_id === 'w9ak-ipjd' && p.classification === 'CLEARED WITH ATTRIBUTION'),
  '9o NYC coverage includes the cleared filings view');

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
ok(Scale.apiCapability().datasets.join(',') === 'uf93-f8nk,ipu4-2q9a,rbx6-tga4,w9ak-ipjd',
  '13f capability names the four allowlisted views');
ok(!Scale.validateApiRequest({ address: '1 Centre Street', market: 'cambridge' }).ok, '13o Cambridge market rejected');
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

// §9 — the classification invariants, checked against the matrix and the shipped
// allowlist rather than against the prose of the evidence files. Asserting that a
// document I wrote contains a phrase I put in it proves nothing; these would actually
// catch a wrong decision.
const CLASSES = [
  'CLEARED FOR PAID REPORT',
  'CLEARED WITH ATTRIBUTION',
  'DERIVED FACTS ONLY',
  'HOLD — TERMS/RIGHTS NOT ESTABLISHED',
  'EXCLUDE'
];

// Every classification anywhere in the matrix is one of the five in force. Catches an
// invented or misspelled label, which prose matching cannot.
const allClasses = [];
matrix.markets.forEach((m) => {
  if (m.geography && m.geography.classification) allClasses.push(m.geography.classification);
  (m.publisher_data || []).forEach((d) => { if (d.classification) allClasses.push(d.classification); });
});
const badClass = allClasses.filter((c) => !CLASSES.includes(c));
ok(badClass.length === 0, '9p every classification in the matrix is one of the five in force', badClass);
ok(allClasses.length >= 12, '9q the matrix actually carries classifications to check', allClasses.length);

// Step 14, as a test rather than a promise: nothing HOLD or EXCLUDE may reach the
// sold allowlist, and everything in the sold allowlist must be cleared in the matrix.
const sold = Scale.apiCapability().datasets;
const heldIds = new Set();
const clearedIds = new Set();
matrix.markets.forEach((m) => {
  const note = (d) => {
    if (!d || !d.dataset_id) return;
    if (/^HOLD|^EXCLUDE/.test(d.classification || '')) heldIds.add(d.dataset_id);
    if (/^CLEARED/.test(d.classification || '')) clearedIds.add(d.dataset_id);
  };
  note(m.geography);
  (m.publisher_data || []).forEach(note);
});
const leaked = sold.filter((id) => heldIds.has(id));
ok(leaked.length === 0, '9r no HOLD or EXCLUDE dataset reaches the sold allowlist', leaked);
const unbacked = sold.filter((id) => !clearedIds.has(id));
ok(unbacked.length === 0, '9s every sold dataset is cleared in the matrix', unbacked);
ok(heldIds.size >= 4, '9t the matrix is actually holding datasets back', heldIds.size);

// The SODA client is the only thing that can reach the network, so the sold allowlist
// and the client's allowlist must be the same set. A drift here is how an uncleared
// view would ship.
const sodaSrc = read('lib/nyc-v1-soda.js');
const sodaAllowed = (sodaSrc.match(/var ALLOWED = \{([^}]*)\}/) || [, ''])[1]
  .match(/'([a-z0-9]{4}-[a-z0-9]{4})'/g) || [];
ok(sodaAllowed.length === sold.length
  && sold.every((id) => sodaAllowed.includes("'" + id + "'")),
  '9u the client allowlist and the sold allowlist are the same set',
  { sodaAllowed, sold });

// Every non-assemblable market states why, and every market points at an evidence file
// that exists. The file has to be on disk; its wording is not the test's business.
matrix.markets.filter((m) => !m.assemblable).forEach((m) => {
  const why = (m.hold || []).length > 0
    || /HOLD|EXCLUDE|not opened|not cleared/i.test(JSON.stringify(m.geography || {}) + (m.note || ''));
  ok(why, '9v ' + m.id + ' records why it is not assemblable');
});
const docRefs = JSON.stringify(matrix).match(/docs\/[a-z0-9-]+\.md/g) || [];
ok(docRefs.length > 0, '9w the matrix cites evidence files', docRefs.length);
docRefs.forEach((d) => ok(existsSync(join(root, d)), '9x cited evidence exists on disk: ' + d));

// A drafted clearance request is the one artifact that could be mistaken for a grant:
// it is written in the language of permission and lives beside the evidence files. So
// the market it names must still be held, and it must say on its face that it is unsent.
const REQUESTS = [['cambridge', 'docs/corporate-output-cambridge-clearance-request-2026-09-28.md']];
REQUESTS.forEach(([marketId, path]) => {
  ok(existsSync(join(root, path)), '9y0 the drafted request for ' + marketId + ' is on disk');
  const doc = read(path);
  ok(/NOT SENT/.test(doc), '9y1 the ' + marketId + ' request states on its face that it was not sent');
  const market = matrix.markets.find((m) => m.id === marketId);
  ok(market && !market.assemblable,
    '9y2 drafting a request did not make ' + marketId + ' assemblable');
  const clsOf = [market && market.geography, ...((market && market.publisher_data) || [])]
    .filter(Boolean).map((d) => d.classification || '');
  ok(clsOf.length > 0 && clsOf.every((c) => /^HOLD|^EXCLUDE/.test(c)),
    '9y3 every ' + marketId + ' object is still held while consent is unanswered', clsOf);
  const marketIds = [market.geography, ...(market.publisher_data || [])]
    .filter((d) => d && d.dataset_id).map((d) => d.dataset_id);
  ok(marketIds.length > 0, '9y4 the ' + marketId + ' entry names datasets to check', marketIds);
  const reached = Scale.apiCapability().datasets.filter((id) => marketIds.includes(id));
  ok(reached.length === 0, '9y5 no ' + marketId + ' dataset reached the sold allowlist', reached);
});

// The checkpoint names the NYC V1 inputs in a table a reader trusts. It has already
// drifted once from the code beside it, so the ids are compared rather than read.
const checkpoint = read('docs/future-surroundings-report-checkpoint-2026-09-27.md');
const cpMissing = sold.filter((id) => !checkpoint.includes(id));
ok(cpMissing.length === 0,
  '9y6 the checkpoint names every dataset the sold report actually reads', cpMissing);

ok(matrix.markets.filter((m) => m.assemblable).length === 1,
  '9y exactly one market is assemblable');
ok(!CLASSES.slice(0, 1).some((c) => JSON.stringify(matrix).includes(c)),
  '9z no family is CLEARED FOR PAID REPORT');

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
