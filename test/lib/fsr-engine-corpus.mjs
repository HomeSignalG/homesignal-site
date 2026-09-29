// The scenario corpus for the Development Activity report engine (U02).
//
// It is data plus one stand-in for NYC Open Data. It imports no engine, so the same
// corpus can be pointed at any checkout of the code, including one from before a change.
// That is how "one engine, zero behavior change" is proved rather than asserted: run this
// corpus through the browser entry and the API entry of the OLD tree, run it through the
// NEW tree, and compare every request and every report, byte for byte.
//
// Dates are fixed to FIXED below, so a fixture can never age out of the 365-day window.

export const FIXED = '2026-09-29T12:00:00.000Z';

const MS_DAY = 86400000;
const at = (daysAgo) => new Date(Date.parse(FIXED) - daysAgo * MS_DAY);
const iso = (d) => d.toISOString().slice(0, 10);
const us = (d) => iso(d).slice(5, 7) + '/' + iso(d).slice(8, 10) + '/' + iso(d).slice(0, 4);
const isoTs = (d) => iso(d) + 'T00:00:00.000';

// 1 Centre Street, Manhattan. All offsets below are degrees from this point
// (0.001 deg of latitude is about 0.069 mi).
const HOME = { lng: -74.003758107366, lat: 40.712980288068 };
const near = (dLat, dLng) => ({
  lat: String((HOME.lat + dLat).toFixed(6)),
  lng: String((HOME.lng + dLng).toFixed(6))
});

export const centre = {
  the_geom: { type: 'Point', coordinates: [HOME.lng, HOME.lat] },
  addresspointid: '1001387', house_number: '1', street_name: 'CENTRE',
  full_street_name: 'CENTRE ST', zipcode: '10007', boroughcode: '1'
};

const permit = (o) => Object.assign({
  permit_type: 'NB', permit_status: 'ISSUED', issuance_date: us(at(30)),
  house__: '2', street_name: 'CENTRE', gis_latitude: near(0.0002, 0.0001).lat,
  gis_longitude: near(0.0002, 0.0001).lng, job__: 'JOB1', zip_code: '10007'
}, o);

const dobnow = (o) => Object.assign({
  work_type: 'General Construction', permit_status: 'Permit Issued', issued_date: isoTs(at(45)),
  house_no: '3', street_name: 'CENTRE', latitude: near(0.0004, 0.0002).lat,
  longitude: near(0.0004, 0.0002).lng, job_filing_number: 'M0001-I1', zip_code: '10007',
  work_permit: 'M00000001-I1-GC'
}, o);

const filing = (o) => Object.assign({
  job_type: 'New Building', filing_status: 'Plan Examiner Review', filing_date: isoTs(at(20)),
  house_no: '4', street_name: 'CENTRE', latitude: near(0.0003, 0.0003).lat,
  longitude: near(0.0003, 0.0003).lng, job_filing_number: 'M0002-I1', postcode: '10007'
}, o);

const manyPermits = (n) => Array.from({ length: n }, (_, i) => permit({
  job__: 'BULK' + i, house__: String(10 + i),
  gis_latitude: near(0.0001 + i * 0.00001, 0.0001).lat, issuance_date: us(at(1 + (i % 300)))
}));

const cappedCandidates = (n) => Array.from({ length: n }, (_, i) => Object.assign({}, centre, {
  addresspointid: 'C' + i, street_name: 'OTHER' + i, full_street_name: 'OTHER' + i + ' ST'
}));

const base = { address: '1 Centre Street', zip: '10007', radius_mi: 0.5, points: [centre] };

// `data` keys are the four dataset views. `fail` makes one request answer with an HTTP
// status instead of rows, keyed 'view:<id>' or 'resource:<id>'.
export const SCENARIOS = [
  Object.assign({}, base, {
    name: 'hit_all_three',
    issuance: [
      permit({}),
      permit({ job__: 'OLD', issuance_date: us(at(400)) }),
      permit({ job__: 'FAR', gis_latitude: near(0.05, 0).lat }),
      permit({ job__: 'ALT', permit_type: 'A2' })
    ],
    dobnow: [dobnow({}), dobnow({ work_type: 'Plumbing', job_filing_number: 'M0009-I1' })],
    filings: [filing({})]
  }),
  Object.assign({}, base, {
    name: 'withdrawn_filing_is_dropped',
    issuance: [], dobnow: [],
    filings: [filing({}), filing({ filing_status: 'Filing Withdrawn', job_filing_number: 'M0003-I1' })]
  }),
  Object.assign({}, base, {
    name: 'filing_statuses_are_all_kept_that_are_not_withdrawn',
    issuance: [], dobnow: [],
    filings: ['Approved', 'Objections', 'Permit Entire', 'LOC Issued', 'Full Demolition Signed-off']
      .map((s, i) => filing({ filing_status: s, job_filing_number: 'S' + i }))
  }),
  Object.assign({}, base, { name: 'no_records_nearby', issuance: [], dobnow: [], filings: [] }),
  Object.assign({}, base, {
    name: 'same_job_as_filing_and_permit',
    issuance: [],
    dobnow: [dobnow({ job_filing_number: 'M0002-I1' })],
    filings: [filing({ filing_status: 'Approved' })]
  }),
  Object.assign({}, base, {
    name: 'sixty_permits_hit_the_cap_of_fifty',
    issuance: manyPermits(60), dobnow: [], filings: []
  }),
  Object.assign({}, base, {
    name: 'future_dated_and_undated_rows',
    issuance: [permit({ issuance_date: us(at(-30)), job__: 'FUT' }), permit({ issuance_date: '', job__: 'NODATE' })],
    dobnow: [dobnow({ issued_date: '' })],
    filings: [filing({ filing_date: '' })]
  }),
  Object.assign({}, base, { name: 'address_miss', points: [], issuance: [], dobnow: [], filings: [] }),
  Object.assign({}, base, {
    name: 'address_ambiguous', points: [centre, Object.assign({}, centre, { addresspointid: '1001388' })],
    issuance: [], dobnow: [], filings: []
  }),
  Object.assign({}, base, {
    name: 'address_candidates_capped', points: cappedCandidates(5000),
    issuance: [], dobnow: [], filings: []
  }),
  Object.assign({}, base, {
    // A point can pass the address match and still carry no usable coordinates.
    name: 'matched_point_with_unusable_coordinates',
    points: [Object.assign({}, centre, { the_geom: { type: 'Point', coordinates: ['x', 'y'] } })],
    issuance: [permit({})], dobnow: [], filings: []
  }),
  Object.assign({}, base, { name: 'no_house_number', address: 'Centre Street', points: [], issuance: [], dobnow: [], filings: [] }),
  Object.assign({}, base, { name: 'blank_address', address: '   ', zip: '', points: [], issuance: [], dobnow: [], filings: [] }),
  Object.assign({}, base, {
    name: 'zip_only_in_the_address', address: '1 Centre Street, New York, NY 10007', zip: '',
    issuance: [permit({})], dobnow: [], filings: []
  }),
  Object.assign({}, base, {
    name: 'spelled_out_suffix_and_borough', address: '1 Centre Street, Manhattan', zip: '',
    issuance: [permit({})], dobnow: [dobnow({})], filings: []
  }),
  Object.assign({}, base, {
    name: 'radius_clamped_to_one_mile', radius_mi: 5,
    issuance: [permit({ gis_latitude: near(0.0145, 0).lat, job__: 'MILE' })], dobnow: [], filings: []
  }),
  Object.assign({}, base, {
    name: 'radius_zero_reads_as_half_a_mile', radius_mi: 0,
    issuance: [permit({})], dobnow: [dobnow({})], filings: [filing({})]
  }),
  Object.assign({}, base, {
    name: 'radius_small', radius_mi: 0.05,
    issuance: [permit({}), permit({ job__: 'NEAR2', gis_latitude: near(0.0006, 0).lat })], dobnow: [dobnow({})], filings: []
  }),
  Object.assign({}, base, {
    name: 'publisher_view_fails', issuance: [], dobnow: [], filings: [],
    fail: { 'view:ipu4-2q9a': 503 }
  }),
  Object.assign({}, base, {
    name: 'publisher_rows_fail', issuance: [], dobnow: [], filings: [],
    fail: { 'resource:rbx6-tga4': 500 }
  }),
  Object.assign({}, base, {
    name: 'publisher_returns_null_rows', points: [centre], issuance: null, dobnow: null, filings: null
  })
];

// A stand-in for data.cityofnewyork.us. It answers a view request with a fixed version,
// and a rows request with the scenario's rows for that dataset. It records every URL.
export function makeFetch(scenario, requests) {
  const rowsFor = (id) => ({
    'uf93-f8nk': scenario.points,
    'ipu4-2q9a': scenario.issuance,
    'rbx6-tga4': scenario.dobnow,
    'w9ak-ipjd': scenario.filings
  })[id];
  const reply = (status, body) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body))
  });
  return async function fetchStub(url) {
    const u = String(url);
    requests.push(u);
    const view = u.match(/\/api\/views\/([a-z0-9]{4}-[a-z0-9]{4})\.json/);
    const res = u.match(/\/resource\/([a-z0-9]{4}-[a-z0-9]{4})\.json/);
    const kind = view ? 'view' : res ? 'resource' : null;
    const id = (view || res || [])[1];
    if (!kind) return reply(404, 'not found');
    const failure = scenario.fail && scenario.fail[kind + ':' + id];
    if (failure) return reply(failure, 'publisher unavailable');
    if (kind === 'view') return reply(200, { id, name: id, viewLastModified: 1700000000, rowsUpdatedAt: 1700000100 });
    return reply(200, rowsFor(id));
  };
}
