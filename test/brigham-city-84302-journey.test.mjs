// THE LAUNCH TEST LOCATION, END TO END THROUGH THE REAL CODE: Brigham City, Utah 84302 (founder, 2026-10-04).
//
// What is real here: the report function's request handler and its REAL data layer (get-development-activity-report/data.ts: the geocode call, the ZIP check
// against the canonical registry, the canonical spatial read, the project hydration, the change-ledger reads), the engine (_shared/national-report.ts), the credit
// rule, and the rights registry AS SHIPPED (supabase/functions/_shared/report-rights.json, read from disk). What is stood in: the network. A fetch stand-in answers
// exactly the requests that data layer makes, with the rows production holds for 84302 (read 2026-10-04: 2 `udot-active-projects` and 39
// `udot-active-projects-lines` development rows, 22 EPA facility rows, ZIP 84302 in canonical_zip_registry: 1 of 12,722), and RECORDS every request, so the test can
// say where the address was routed. The member's standing, plan and charge are in-memory fakes that record whether a report was ever charged.
//
// WHAT IT PROVES
//   * the location is accepted and ROUTED: typed address -> geocode -> ZIP 84302 asked of the canonical registry -> the 0.5-mile spatial read at that point;
//   * an address outside the registry's ZIPs, and one that cannot be found, are named as such, free, and are not the "No data ingested" outcome;
//   * with the rights registry AS SHIPPED (founder ruling R7, 2026-10-04: every registry source, including the UDOT lines family these rows belong to) the report for
//     this location SHOWS the stored records: 200 OK, outcome "Development shown", the records by name with their official links, charged as one free report and
//     stored (the issuing function is called once);
//   * with NOTHING cleared (an explicit empty list, which is what the shipped file said until R7) the same journey says "No data ingested": 200 OK, not an error, not
//     charged, not stored, and NONE of the stored records leaks into the answer. That state still exists for any source that is not on the list;
//   * a covered ZIP is NOT a clearance: a list that names some other source leaves these records hidden;
//   * (control) the very same journey with a FIXTURE source cleared shows development, so an empty answer is caused by the rights registry and not by the
//     location or the routing failing.
// WHAT IT DOES NOT PROVE: that the live geocoder resolves the street address (a person checks that: docs/development-activity-manual-test-brigham-city-84302.md),
// or that any publisher permits its records in a paid report (R7 is the founder's decision to list them, not a publisher's grant).
// Run: node test/brigham-city-84302-journey.test.mjs
import { readFileSync } from 'node:fs';
import { LAUNCH_TEST_LOCATION as L, OTHER_PROPERTY, geocodeStandIn } from './lib/launch-test-location.mjs';

const H = await import('../supabase/functions/get-development-activity-report/handler.ts');
const D = await import('../supabase/functions/get-development-activity-report/data.ts');
const M = await import('../supabase/functions/_shared/national-report.ts');

let n = 0, bad = 0;
const ok = (c, m, d) => { n++; if (c) console.log('PASS — ' + m); else { bad++; console.log('FAIL — ' + m + (d !== undefined ? '  [' + JSON.stringify(d).slice(0, 400) + ']' : '')); } };

const SHIPPED = JSON.parse(readFileSync(new URL('../supabase/functions/_shared/report-rights.json', import.meta.url), 'utf8'));
const NONE = { version: 1, cleared: [] }; // nothing cleared, named here: the empty state does not depend on what the shipped file says
const NOW = new Date('2026-10-04T12:00:00Z');
const UDOT_LINES = 'udot-active-projects-lines';
const USER = 'a1111111-1111-4111-8111-111111111111';

// the stored UDOT rows near the test address, in the shape production holds them (test/national-report.test.mjs section 9)
const radiusRow = (k, d, mlat, mlng, fam = UDOT_LINES) => ({ source_key: k, feature_id: k + '#1', registry_id: fam, provenance: 'recovered_authoritative', distance_mi: d, geometry_type: 'ST_MultiLineString', has_more: false, marker_lat: mlat, marker_lng: mlng });
const projectRow = (k, status, stage, name, fam = UDOT_LINES) => ({ source_key: k, registry_id: fam, record_kind: 'development', name, type: 'Utility', type_raw: 'Traffic and Safety', status, stage,
  developer: null, size: null, investment: null, submitted_at: '2024-08-26', date_kind: 'filed', address: 'SR-13', source_ref: 'https://data-uplan.opendata.arcgis.com/datasets/udot-projects-points', last_seen_at: '2026-10-02T10:42:00Z' });
const STORED_NAMES = ['SR-13 (Main St) & 100 North', 'SR-13 (Main St) & 200 South'];
const stored = (fam = UDOT_LINES) => ({
  rows: [radiusRow('u:22248', 0.1217, 41.5128578810083, -112.015662896203, fam), radiusRow('u:22250', 0.3195, 41.50607192187, -112.015813250643, fam)],
  projects: [projectRow('u:22248', 'Approved', 'Under Construction', STORED_NAMES[0], fam), projectRow('u:22250', 'Approved', 'Under Construction', STORED_NAMES[1], fam)],
});

/** The network stand-in. `registry` is the set of ZIPs in canonical_zip_registry; `geocode` is what the geocode-address function answers. */
const ALLOWED = [{ allowed: true, retry_after_seconds: 0, limited_by: null, limited_window_secs: null }];
function world({ geocode = (a) => ({ match: { ...geocodeStandIn(a) } }), registry = ['84302'], rows = stored(), rate = ALLOWED } = {}) {
  const seen = [];
  const json = (v, status = 200) => new Response(JSON.stringify(v), { status });
  const fetchFn = async (url, init = {}) => {
    const u = new URL(url);
    const key = (init.method || 'GET') + ' ' + u.pathname + u.search;
    seen.push({ method: init.method || 'GET', path: u.pathname, search: u.search, body: init.body ? JSON.parse(init.body) : null });
    if (u.pathname === '/rest/v1/rpc/report_rate_claim') return json(rate);   // the database's answer to the report rate limit (docs/report-rate-limit.sql)
    if (u.pathname === '/functions/v1/geocode-address') return json(geocode(JSON.parse(init.body).address));
    if (u.pathname === '/rest/v1/canonical_zip_registry') return json(registry.includes(u.searchParams.get('zip').replace(/^eq\./, '')) ? [{ zip: u.searchParams.get('zip').replace(/^eq\./, '') }] : []);
    if (u.pathname === '/rest/v1/rpc/n5_projects_within_radius') return json(rows.rows);
    if (u.pathname === '/rest/v1/app_projects') return json(rows.projects);
    if (/^\/rest\/v1\/(dev_change_project|dev_change_event_reportable|dev_change_source_fetch_health)$/.test(u.pathname)) return json([]);
    throw new Error('unexpected request ' + key);
  };
  return { fetchFn, seen };
}

/** A trial member asking for a report; every database function that would charge or store is a recorder. */
function ask({ rights = SHIPPED, net = world(), body = { address: L.address }, used = 3 } = {}) {
  const calls = { issue: 0, trialOf: 0 };
  const real = D.makeDeps({ url: 'https://proj.supabase.co', serviceKey: 'fixture-service-key-not-real', rights, now: () => NOW }, net.fetchFn);
  const trial = { status: 'active', credits_used: used, credits_remaining: 20 - used, expired: false };
  const deps = {
    ...real,
    authenticate: async (t) => (t === 'user-token' ? { email: 'agent@example.test', id: USER } : null),
    isAdmin: async () => false,
    trialOf: async () => { calls.trialOf++; return trial; },
    planOf: async () => null,
    headerOf: async () => ({ brokerage: 'Fixture Realty', agent: null }),
    issue: async (_u, key, intelligence) => {
      calls.issue++;
      return { replayed: false, report_id: 'c0000000-0000-4000-8000-000000000001', content_hash: 'h', report_version: 'v', generated_at: NOW.toISOString(), private_context_id: 'ctx', report: intelligence,
        credit: { ordinal: used + 1, credits_used: used + 1, credits_remaining: 19 - used, evaluation_status: 'active', allotment: 'trial', period_ends_at: null } };
    },
  };
  const go = async () => {
    const res = await H.makeHandler(deps)(new Request('https://x/functions/v1/get-development-activity-report', {
      method: 'POST', headers: { authorization: 'Bearer user-token', 'content-type': 'application/json' }, body: JSON.stringify({ ...body, idempotency_key: '00000000-0000-4000-8000-0000000000aa' }),
    }));
    return { status: res.status, json: await res.json() };
  };
  return { go, calls, net };
}
const asked = (net, path) => net.seen.filter((s) => s.path === path);

// ---- 0. the fixtures say what they claim ------------------------------------------------------------------------------------------------------------
ok(L.zip === '84302' && L.city === 'Brigham City' && L.state === 'UT' && L.county === 'Box Elder' && /Brigham City, UT 84302$/.test(L.address), '0a the test location is Brigham City, UT 84302 (Box Elder County)');
// The shipped list is read from disk. It names the family these rows belong to (ruling R7); if that ever stops being true this control fails, and so does section 2, which
// describes what a customer gets at this address. The empty state is tested separately, against an explicit empty list.
const cleared = (fam) => SHIPPED.cleared.some((e) => e.registry_id === fam);
ok(Array.isArray(SHIPPED.cleared) && cleared(UDOT_LINES) && cleared('udot-active-projects'), '0b (control) the rights registry as shipped lists the UDOT families the stored rows below belong to (ruling R7), so section 2 describes production, not a staged case');
ok(stored().projects.length === 2 && stored().rows.every((r) => r.registry_id === UDOT_LINES), '0c (control) the stand-in holds stored UDOT records for this point, as production does for 84302: an empty report is not an empty database');

// ---- 1. the location is accepted and routed -------------------------------------------------------------------------------------------------------
{
  const t = ask();
  const r = await t.go();
  ok(r.status === 200 && r.json.status === 'OK', '1a the test address is accepted: 200 and status OK (not ADDRESS_NOT_RESOLVED, not OUTSIDE_COVERAGE)', [r.status, r.json.status]);
  const g = asked(t.net, '/functions/v1/geocode-address');
  ok(g.length === 1 && g[0].method === 'POST' && g[0].body.address === L.address, '1b the address is sent to the ONE geocoder exactly as typed', g.map((x) => x.body));
  const z = asked(t.net, '/rest/v1/canonical_zip_registry');
  ok(z.length === 1 && z[0].search.includes('zip=eq.84302'), '1c the ZIP the geocoder returned (84302) is checked against the canonical registry', z.map((x) => x.search));
  const rad = asked(t.net, '/rest/v1/rpc/n5_projects_within_radius');
  ok(rad.length === 1 && rad[0].body.p_lat === L.lat && rad[0].body.p_lng === L.lng && rad[0].body.p_radius_mi === 0.5,
    '1d the canonical spatial read is made AT the geocoded point (Brigham City), for 0.5 mile', rad.map((x) => x.body));
  const hyd = asked(t.net, '/rest/v1/app_projects');
  const hydQuery = hyd.length === 1 ? decodeURIComponent(hyd[0].search) : '';
  ok(hyd.length === 1 && hydQuery.includes('u:22248') && hydQuery.includes('u:22250'), '1e the records the spatial read named are the ones hydrated', hyd.map((x) => x.search).join('').slice(0, 160));
  const chain = ['/rest/v1/rpc/report_rate_claim', '/functions/v1/geocode-address', '/rest/v1/canonical_zip_registry', '/rest/v1/rpc/n5_projects_within_radius'].map((p) => t.net.seen.findIndex((s) => s.path === p));
  ok(chain.every((i) => i >= 0) && chain[0] < chain[1] && chain[1] < chain[2] && chain[2] < chain[3],
    '1f the steps happen in the order the journey promises: the rate limit, then geocode, then the ZIP check, then the spatial read', chain);
  const claims = asked(t.net, '/rest/v1/rpc/report_rate_claim');
  ok(claims.length === 1 && JSON.stringify(claims[0].body) === JSON.stringify({ p_user: USER }), '1g the rate limit is asked once, for the signed-in person\'s id and nothing else (no address, no email)', claims.map((x) => x.body));
}

// ---- 2. as shipped (ruling R7): the stored records are SHOWN ---------------------------------------------------------------------------------------------
{
  const t = ask({ used: 3 });
  const r = await t.go();
  const rep = r.json.report;
  ok(r.status === 200 && r.json.status === 'OK' && rep.activity.outcome === 'DEVELOPMENT_SHOWN' && rep.activity.label === 'Development shown', '2.1 the report for the test address says "Development shown"', rep.activity);
  const names = (rep.projects || []).map((p) => p.name).sort();
  ok(names.length === 2 && JSON.stringify(names) === JSON.stringify([...STORED_NAMES].sort()), '2.2 and it carries the two stored records, by name', names);
  ok(rep.projects.every((p) => p.source && /^https:\/\//.test(p.source.url) && p.source_family === UDOT_LINES), '2.3 each record carries its official link and its source family', rep.projects.map((p) => p.source));
  ok(r.json.charged === true && r.json.stored === true && typeof r.json.report_id === 'string' && t.calls.issue === 1 && r.json.credit.uses_report === true && r.json.credit.reason === 'DEVELOPMENT_SHOWN',
    '2.4 it is charged as one free report and stored: the issuing function is called once and the credit decision says a report is used', [r.json.charged, r.json.stored, r.json.credit]);
  ok(r.json.trial.credits_used === 4 && r.json.trial.credits_remaining === 16, '2.5 the trial now reads 4 used / 16 left', r.json.trial);
  ok(rep.projects.every((p) => p.source.attribution === null) && rep.coverage && rep.coverage.state !== 'LIMITED_COVERAGE', '2.6 these sources require no credit line, and the report is not marked limited coverage', rep.coverage);
}

// ---- 2b. NOTHING cleared: the empty-source state, accurate, plain, and not an error ----------------------------------------------------------------
{
  const t = ask({ used: 3, rights: NONE });
  const r = await t.go();
  const rep = r.json.report;
  ok(r.status === 200 && r.json.status === 'OK' && r.json.error === undefined, '2a the answer is a normal 200 OK with no error field: "No data ingested" is a report, not a failure', [r.status, r.json.status, r.json.error]);
  ok(rep.activity.outcome === 'NO_DATA_INGESTED' && rep.activity.label === 'No data ingested', '2b the report says "No data ingested", in the founder\'s words, from the engine\'s outcome code', rep.activity);
  ok(Array.isArray(rep.projects) && rep.projects.length === 0, '2c it carries no project record');
  const blob = JSON.stringify(r.json);
  ok(STORED_NAMES.every((nm) => !blob.includes(nm)) && !blob.includes('udot') && !blob.includes('SR-13'),
    '2d and none of the 41 stored records (UDOT) leaks into the answer by name, family or address: an uncleared source shows nothing at all', blob.length);
  ok(r.json.charged === false && r.json.stored === false && r.json.report_id === null && t.calls.issue === 0, '2e it is not charged, not stored and the issuing function is never called');
  ok(r.json.credit.uses_report === false && r.json.credit.reason === 'NO_DATA_INGESTED' && r.json.trial.credits_used === 3 && r.json.trial.credits_remaining === 17,
    '2f the credit decision says no free report is used, and the trial still reads 3 used / 17 left', [r.json.credit, r.json.trial]);
  ok(r.json.coverage_state !== 'OUTSIDE_COVERAGE' && typeof r.json.coverage_state === 'string', '2g the coverage state is not "outside coverage": the place IS covered, the SOURCE is what is missing', r.json.coverage_state);
}

// ---- 3. a covered ZIP is not a clearance -------------------------------------------------------------------------------------------------------------
{
  // clearing some OTHER source leaves the Brigham City records exactly as hidden as before
  const other = { version: 1, cleared: [{ registry_id: 'austin-site-plan-cases', cleared_on: '2026-10-04', audit_ref: 'launch-test fixture, not a clearance', attribution: '' }] };
  const r = await ask({ rights: other }).go();
  ok(r.json.report.activity.outcome === 'NO_DATA_INGESTED' && r.json.report.projects.length === 0, '3a clearing a different source changes nothing here: the covered ZIP is not a clearance', r.json.report.activity);
  // the registry can never be "everything cleared" by being malformed (fail closed), even for the test location
  const malformed = await ask({ rights: { version: 1, cleared: 'all' } }).go();
  ok(malformed.status >= 400 && malformed.json.report === undefined, '3b a malformed rights registry fails the request instead of clearing everything', [malformed.status, malformed.json.error]);
}

// ---- 4. control: the same journey with a FIXTURE source cleared shows development -----------------------------------------------------------------
{
  const FIXTURE = 'launch-test-fixture-family-not-a-real-source';
  const rights = { version: 1, cleared: [{ registry_id: FIXTURE, cleared_on: '2026-10-04', audit_ref: 'launch-test fixture, not a clearance', attribution: 'Data: fixture' }] };
  const t = ask({ rights, net: world({ rows: stored(FIXTURE) }) });
  const r = await t.go();
  ok(r.status === 200 && r.json.report.activity.outcome === 'DEVELOPMENT_SHOWN' && r.json.report.projects.length === 2 && r.json.charged === true && t.calls.issue === 1,
    '4a (control) with a fixture family cleared the same location, the same routing and the same rows show 2 projects and use one free report: the empty answer was the rights registry, not the location', [r.json.report.activity, r.json.charged]);
}

// ---- 5. places that are not covered, and addresses that cannot be found ----------------------------------------------------------------------------
{
  const noZip = ask({ net: world({ geocode: (a) => ({ match: { ...geocodeStandIn(a), zip: '99999' } }), registry: ['84302'] }), body: { address: '1 Fixture Way, Nowhere, ZZ 99999' } });
  const r = await noZip.go();
  ok(r.status === 200 && r.json.status === 'OUTSIDE_COVERAGE' && r.json.zip === '99999' && r.json.report === null && r.json.credit?.uses_report === false && noZip.calls.issue === 0,
    '5a a ZIP outside the registry is named as outside coverage, free, with no report (it is not "No data ingested")', r.json);
  ok(asked(noZip.net, '/rest/v1/rpc/n5_projects_within_radius').length === 0, '5b and no spatial read is made for it');
  const lost = ask({ net: world({ geocode: () => ({ match: null }) }), body: { address: OTHER_PROPERTY } });
  const r2 = await lost.go();
  ok(r2.status === 200 && r2.json.status === 'ADDRESS_NOT_RESOLVED' && r2.json.report === null && r2.json.credit.uses_report === false && lost.calls.issue === 0,
    '5c an address the geocoder cannot find is named as such, free, and nothing is charged or stored', r2.json.status);
  ok(asked(lost.net, '/rest/v1/canonical_zip_registry').length === 0, '5d and the ZIP check is not made without a ZIP');
}

// ---- 6. too many requests in a short time: refused before any work is done for the test address ---------------------------------------------------------
{
  const REFUSED = [{ allowed: false, retry_after_seconds: 42, limited_by: 'user', limited_window_secs: 60 }];
  const t = ask({ net: world({ rate: REFUSED }) });
  const r = await t.go();
  ok(r.status === 429 && r.json.error === 'rate_limited' && r.json.retry_after_seconds === 42 && r.json.limited_by === 'user' && r.json.report === undefined,
    '6a a full window answers 429 rate_limited with the seconds to wait (42) and no report', [r.status, r.json]);
  ok(asked(t.net, '/functions/v1/geocode-address').length === 0 && asked(t.net, '/rest/v1/canonical_zip_registry').length === 0 && asked(t.net, '/rest/v1/rpc/n5_projects_within_radius').length === 0 && t.calls.issue === 0,
    '6b and nothing was done for the address: no geocoder call, no ZIP check, no spatial read, nothing issued');
  ok(!JSON.stringify(r.json).includes('Main St') && !JSON.stringify(r.json).includes(L.zip) && r.json.credit === undefined,
    '6c and the refusal repeats neither the address nor the ZIP, and is not a credit decision (a refused request is not a report)');
  const down = ask({ net: (() => { const w = world(); const f = w.fetchFn; w.fetchFn = async (u, i) => (new URL(u).pathname === '/rest/v1/rpc/report_rate_claim' ? new Response('{}', { status: 500 }) : f(u, i)); return w; })() });
  const d = await down.go();
  ok(d.status === 502 && d.json.error === 'data_unavailable' && asked(down.net, '/functions/v1/geocode-address').length === 0,
    '6d with the rate limit unreadable (the database answers 500) the request fails CLOSED: 502, and the geocoder is never asked', [d.status, d.json]);
}

console.log('\n' + (n - bad) + ' passed, ' + bad + ' failed of ' + n);
process.exit(bad ? 1 : 0);
