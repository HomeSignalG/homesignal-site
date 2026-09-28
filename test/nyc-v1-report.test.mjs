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
ok(nearby[0].stage === 'Permit issued' && nearby[0].date_label === 'Issued', '2d issuance rows carry a stage');

const filingNear = {
  job_type: 'New Building',
  filing_status: 'Plan Examiner Review',
  filing_date: '2026-09-01T00:00:00.000',
  house_no: '4',
  street_name: 'CENTRE',
  latitude: '40.7133',
  longitude: '-74.0040',
  job_filing_number: 'M0001-I1',
  postcode: '10007',
  zip: '11050'
};
const filingWithdrawn = Object.assign({}, filingNear, {
  job_filing_number: 'M0002-I1',
  filing_status: 'Filing Withdrawn'
});
const filingWrongType = Object.assign({}, filingNear, {
  job_filing_number: 'M0003-I1',
  job_type: 'Alteration'
});

const dobnowNear = {
  work_type: 'General Construction',
  permit_status: 'Permit Issued',
  issued_date: '2026-03-01T00:00:00.000',
  house_no: '3',
  street_name: 'CENTRE',
  latitude: '40.7132',
  longitude: '-74.0039',
  job_filing_number: 'M0002-I1',
  zip_code: '10007'
};

const withFilings = V1.nearbyFromPublisherRows([], [], coords, 0.5, [filingNear, filingWithdrawn, filingWrongType]);
ok(withFilings.length === 1 && withFilings[0].case_number === 'M0001-I1', '2e only allowlisted filings', withFilings);
ok(withFilings[0].stage === 'Filed' && withFilings[0].date_label === 'Filed', '2f filings are staged as Filed');
ok(withFilings[0].zip === '10007', '2g filing ZIP is postcode, not the applicant zip');
ok(withFilings[0].record_url === 'https://data.cityofnewyork.us/d/w9ak-ipjd', '2h filing record URL');
ok(!withFilings.some((r) => /Withdrawn/i.test(r.status)), '2i withdrawn filings are not listed as work');

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
ok(report.data_state.datasets.join(',') === 'uf93-f8nk,ipu4-2q9a,rbx6-tga4,w9ak-ipjd',
  '3i data_state names the four allowlisted views', report.data_state.datasets);
ok(report.attribution.some(function (a) { return a.dataset === 'w9ak-ipjd' && /Filing Withdrawn/.test(a.modifications); }),
  '3j filings attribution states the withdrawn drop');
ok(report.nearby_matched === 1 && report.nearby_truncated === false, '3k report states matched count and truncation');

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
ok(Soda.sodaUrl('resource', 'w9ak-ipjd', {}).indexOf('https://data.cityofnewyork.us/resource/w9ak-ipjd.json') === 0,
  '4f filings view is on the allowlist');
let threwIc3t = false;
try { Soda.sodaUrl('resource', 'ic3t-wcy2', {}); } catch (_e) { threwIc3t = true; }
ok(threwIc3t, '4g the stale BIS filings view is rejected');

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
ok(staged.includes('lib/nyc-v1-report.js') && staged.includes('lib/nyc-v1-soda.js') && staged.includes('lib/fsr-scale.js'), '5g libraries ship');
ok(existsSync(join(root, 'future-surroundings-report.html')), '5h template exists');

// The publisher's row window must be the same window the report keeps. An unordered
// window returns the oldest rows, the recency filter drops them all, and the dataset
// silently contributes nothing.
const seen = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (url) => {
  seen.push(String(url));
  return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
};
// Called the way loadReport calls them: with a bounding box, not a ZIP list. Passing
// the wrong shape used to still emit a query, so the assertions below check the box
// numbers appear rather than only that a floor is present somewhere.
const testBox = V1.bbox(coords.lat, coords.lng, 0.5);
await Soda.fetchIssuance(testBox);
await Soda.fetchFilings(testBox);
await Soda.fetchIssuance(null);
globalThis.fetch = realFetch;

// URLSearchParams encodes spaces as '+', which decodeURIComponent leaves alone.
const readQuery = (u) => decodeURIComponent(String(u || '').replace(/\+/g, '%20'));
const issUrl = readQuery(seen.find((u) => u.includes('ipu4-2q9a')));
const filUrl = readQuery(seen.find((u) => u.includes('w9ak-ipjd')));
const floor = Soda.windowFloor();

ok(V1.RECENT_DAYS === 365, '6a the report window is a named constant', V1.RECENT_DAYS);
ok(/^\d{4}-\d{2}-\d{2}$/.test(floor), '6b window floor is a date literal', floor);
ok(issUrl.includes("issuance_date::floating_timestamp >= '" + floor + "'"),
  '6c BIS query is floored to the report window', issUrl);
ok(issUrl.includes('$order=issuance_date::floating_timestamp DESC'),
  '6d BIS query is ordered newest first, not an arbitrary row window', issUrl);
ok(issUrl.includes('issuance_date is not null'), '6e BIS query skips rows with no issuance date', issUrl);
ok(filUrl.includes("filing_date >= '" + floor + "'"), '6f filings query is floored to the same window', filUrl);
ok(filUrl.includes('$order=filing_date DESC'), '6g filings query is ordered newest first', filUrl);

// Records are nearby because of the publisher's coordinates, not because of a ZIP text
// field. Measured at 1 Centre Street, the ZIP route missed 2 in-radius records in 10006.
ok(issUrl.includes('gis_latitude::number between ' + testBox.minLat + ' and ' + testBox.maxLat)
  && issUrl.includes('gis_longitude::number between ' + testBox.minLng + ' and ' + testBox.maxLng),
  '6q BIS query is scoped on cast publisher coordinates', issUrl);
ok(filUrl.includes('latitude::number between ' + testBox.minLat + ' and ' + testBox.maxLat),
  '6r filings query is scoped on cast publisher coordinates', filUrl);
ok(!/zip_code in\(/.test(issUrl) && !/postcode in\(/.test(filUrl),
  '6s neither record query decides nearness by a ZIP field', issUrl + ' || ' + filUrl);
ok(!/undefined|NaN/.test(issUrl + filUrl),
  '6t no query ships an undefined bound', issUrl + ' || ' + filUrl);
ok(seen.filter((u) => u.includes('ipu4-2q9a')).length === 1,
  '6u a missing box queries nothing rather than querying the whole city',
  seen.filter((u) => u.includes('ipu4-2q9a')).length);
ok(!seen.some((u) => u.includes('within_circle')),
  '6v the ZIP round trip is gone, not merely unused');

// The repo's older instrument for this column rebuilds a sort key with substring().
// That assumes one date format. This column holds two, and on the 17,237 ISO-formatted
// rows the substring positions admit 12,621 permits from 1993-2006 as recent.
ok(!/substring\(issuance_date/.test(issUrl),
  '6p BIS query does not use the substring key, which is wrong on this column now', issUrl);

const soda = read('lib/nyc-v1-soda.js');
ok(!/\$limit: '200'/.test(soda), '6h the row cap is a named constant, not a literal per query');
// The cap is only honest if it clears the densest window a buyer can ask for. The
// worst case measured against the live views is 3,390 rows (1 mi, lower Manhattan);
// anything at or below that silently truncates exactly where coverage matters most.
const DENSEST_MEASURED_WINDOW = 3390;
ok(Soda.ROW_CAP > DENSEST_MEASURED_WINDOW,
  '6h2 the row cap clears the densest window measured against the live views',
  { row_cap: Soda.ROW_CAP, densest_measured: DENSEST_MEASURED_WINDOW });
ok((soda.match(/windowFloor\(\)/g) || []).length >= 4,
  '6i all three record queries request the window', (soda.match(/windowFloor\(\)/g) || []).length);
ok(report.data_state.window_days === 365 && report.data_state.row_cap_per_dataset === null,
  '6j report discloses the window it kept', report.data_state);
ok(report.attribution.every((a) => /last 365 days/.test(a.modifications) || a.dataset === 'uf93-f8nk'),
  '6k every record view discloses the recency filter as a modification',
  report.attribution.map((a) => a.dataset + ':' + /last 365 days/.test(a.modifications)));
ok(/text/.test(report.attribution.find((a) => a.dataset === 'ipu4-2q9a').modifications),
  '6l BIS attribution states the date column is text');

const fnSrc = read('supabase/functions/get-future-surroundings-report/allowlist.ts');
ok(/issuance_date::floating_timestamp >= /.test(fnSrc) && /issuance_date::floating_timestamp DESC/.test(fnSrc),
  '6m the API applies the same BIS floor and order as the browser');
ok(/window_days: RECENT_DAYS/.test(fnSrc), '6n the API discloses the window too');
ok(!/\$limit: '200'/.test(fnSrc), '6o the API row cap is a named constant');
const fnRowCap = Number((fnSrc.match(/const ROW_CAP = (\d+);/) || [])[1]);
ok(fnRowCap === Soda.ROW_CAP,
  '6o2 the API reads the same depth as the browser, so the two cannot disagree on coverage',
  { api: fnRowCap, browser: Soda.ROW_CAP });
ok(/gis_latitude::number between/.test(fnSrc) && !/zip_code in\(/.test(fnSrc),
  '6w the API scopes on coordinates too, not on zip_code');
ok(!/within_circle/.test(fnSrc), '6x the API no longer makes the ZIP round trip');

// §7 — the contribution guard. The defect that started this was a view that was
// allowlisted, credited, and returning nothing, and no test could see it because every
// assertion fed synthetic rows to the row shaper. These assert on the coverage record.
const cov = V1.coverageFor(
  [{ d: '03/01/2026' }, { d: '2025-12-15T00:00:00.000' }, { d: '' }],
  'd',
  3
);
ok(cov.fetched === 3, '7a coverage counts what the publisher returned', cov);
ok(cov.oldest === '2025-12-15' && cov.newest === '2026-03-01',
  '7b coverage reach spans both date formats', cov);
ok(cov.capped === true, '7c hitting the row cap is recorded, not hidden', cov);
ok(V1.coverageFor([{ d: '03/01/2026' }], 'd', 3).capped === false,
  '7d a short read is not reported as capped');
ok(V1.coverageFor([], 'd', 3).fetched === 0 && V1.coverageFor([], 'd', 3).oldest === '',
  '7e an empty read reports zero, not a guessed range');

const silentReport = await V1.assembleReport({
  address: '1 Centre Street',
  zip: '10007',
  radius_mi: 0.5,
  address_points: [centre],
  issuance: [],
  dobnow: [dobnowNear],
  filings: [],
  versions: { addresspoint: 'v', issuance: 'v', dobnow: 'v', filings: 'v' },
  row_cap_per_dataset: 5000,
  retrieved_at: 'r',
  generated_at: 'g'
});
ok(silentReport.data_state.silent_datasets.join(',') === 'ipu4-2q9a,w9ak-ipjd',
  '7f a view that returned nothing is named, not quietly credited',
  silentReport.data_state.silent_datasets);
ok(silentReport.data_state.coverage_complete === true,
  '7g returning nothing is not the same as being capped');
ok(silentReport.data_state.coverage['rbx6-tga4'].fetched === 1,
  '7h the view that did contribute is counted');

const cappedReport = await V1.assembleReport({
  address: '1 Centre Street',
  zip: '10007',
  radius_mi: 0.5,
  address_points: [centre],
  issuance: [issuanceNear],
  dobnow: [dobnowNear],
  filings: [filingNear],
  versions: { addresspoint: 'v', issuance: 'v', dobnow: 'v', filings: 'v' },
  row_cap_per_dataset: 1,
  retrieved_at: 'r',
  generated_at: 'g'
});
ok(cappedReport.data_state.coverage_complete === false,
  '7i a capped read makes coverage incomplete, so the page cannot claim the full window');
ok(cappedReport.data_state.silent_datasets.length === 0,
  '7j capped is not silent');

const missCov = await V1.assembleReport({
  address: '1 Nowhere Street', zip: '10007', address_points: [centre], issuance: [], dobnow: []
});
ok(missCov.data_state.silent_datasets.length === 0,
  '7k a miss queries nothing, so nothing is reported silent');

ok(report.data_state.window_start === V1.isoDate(new Date(Date.now() - 365 * 86400000).toISOString()),
  '7l the report names the date its window starts', report.data_state.window_start);

const pageSrc = read('future-surroundings-report.html');
ok(!/Records dated in the last/.test(pageSrc),
  '7m the page no longer claims a window it may not have covered');

// Grepping the page for these strings only proves the branch was written, not that it
// is ever reached. The disclosure is the product, so it is run against real reports.
const noteSrc = (pageSrc.match(/\n( *)(function coverageNote\(report\) \{[\s\S]*?\n\1\})/) || [])[2];
ok(!!noteSrc, '7n0 the page exposes a coverage note to test');
const coverageNote = new Function(
  'esc',
  noteSrc + '\n return coverageNote;'
)((s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[c]));

const fullReport = await V1.assembleReport({
  address: '1 Centre Street',
  zip: '10007',
  radius_mi: 0.5,
  address_points: [centre],
  issuance: [issuanceNear],
  dobnow: [dobnowNear],
  filings: [filingNear],
  versions: { addresspoint: 'v', issuance: 'v', dobnow: 'v', filings: 'v' },
  row_cap_per_dataset: 5000,
  retrieved_at: 'r',
  generated_at: 'g'
});
const completeHtml = coverageNote(fullReport);
ok(/Every allowlisted/.test(completeHtml) && !/Partial coverage/.test(completeHtml),
  '7n a complete read is stated as complete', completeHtml);
ok(completeHtml.includes(fullReport.data_state.window_start),
  '7n1 a complete read names the date it reaches back to', completeHtml);

const cappedHtml = coverageNote(cappedReport);
ok(/Partial coverage/.test(cappedHtml) && !/Every allowlisted/.test(cappedHtml),
  '7n2 a capped read is stated as partial, not as the full window', cappedHtml);
ok(/ipu4-2q9a/.test(cappedHtml) && /reaches back to/.test(cappedHtml),
  '7n3 a capped read names which set was truncated and how far it got', cappedHtml);

const silentHtml = coverageNote(silentReport);
ok(/ipu4-2q9a, w9ak-ipjd/.test(silentHtml) && /contributed/.test(silentHtml),
  '7o the page tells the buyer which credited source contributed nothing', silentHtml);
ok(!/contributed/.test(completeHtml),
  '7o1 a report with no silent source does not invent one', completeHtml);

console.log(fails ? '\n' + fails + ' FAILED' : '\nALL PASSED');
process.exit(fails ? 1 : 0);
