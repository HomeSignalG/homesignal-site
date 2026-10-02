// THE NATIONAL DEVELOPMENT ACTIVITY REPORT — the edge function (Development Activity plan, Order G).
// handler.ts (who may ask, what they may ask, what happens next) and data.ts (the reads) are exercised without Deno or a
// database: the handler through injected fakes that record every call, the data layer through a stub fetch that records
// every request it would send. What is proven here is the ACCESS MODEL and the FAIL-CLOSED behaviour; the composition
// itself is test/national-report.test.mjs.
// Run: node test/national-report-function.test.mjs
let n = 0, bad = 0;
const ok = (c, m, d) => { n++; if (c) console.log('PASS — ' + m); else { bad++; console.log('FAIL — ' + m + (d !== undefined ? '  [' + JSON.stringify(d) + ']' : '')); } };

const H = await import('../supabase/functions/get-development-activity-report/handler.ts');
const D = await import('../supabase/functions/get-development-activity-report/data.ts');

const NOW = new Date('2026-09-29T12:00:00Z');
const ADDRESS = '742 Evergreen Terrace, Springfield, OR 97477';
const RIGHTS = { version: 1, cleared: [{ registry_id: 'fam-a', cleared_on: '2026-09-29', audit_ref: 'test fixture', attribution: 'Data: A' }] };
const proj = (k, x = {}) => ({ source_key: k, registry_id: 'fam-a', record_kind: 'development', name: 'Ravenna Bridge Retrofit', type: 'Utility', type_raw: null, status: 'Approved', stage: 'Advertised', developer: null, size: null, investment: null, submitted_at: '2026-09-24', date_kind: 'issued', address: '005 King', source_ref: 'https://example.gov/r/1', ...x });

/** Fakes that record every call, so a test can say what was NOT called. */
function fakes(over = {}) {
  const calls = [];
  const rec = (name, fn) => async (...a) => { calls.push(name); return fn(...a); };
  const deps = {
    now: () => NOW,
    rights: RIGHTS,
    authenticate: rec('authenticate', async (t) => (t === 'user-token' ? { email: 'founder@example.com' } : null)),
    isAdmin: rec('isAdmin', async (e) => e === 'founder@example.com'),
    geocode: rec('geocode', async () => ({ matchedAddress: '742 EVERGREEN TER, SPRINGFIELD, OR, 97477', lat: 44.04612, lng: -122.98123, zip: '97477' })),
    zipSupported: rec('zipSupported', async () => true),
    radius: rec('radius', async () => [{ source_key: 'k1', feature_id: 'pt:1', registry_id: 'fam-a', provenance: 'proven_stored_point', distance_mi: 0.31, geometry_type: 'Point', has_more: false }]),
    hydrate: rec('hydrate', async () => [proj('k1')]),
    ledger: rec('ledger', async () => []),
    events: rec('events', async () => []),
    health: rec('health', async () => []),
    ...over,
  };
  return { deps, calls };
}
const call = async (deps, body, headers = {}, method = 'POST') => {
  const h = H.makeHandler(deps);
  const init = { method, headers: { 'content-type': 'application/json', ...headers } };
  if (method === 'POST') init.body = typeof body === 'string' ? body : JSON.stringify(body);
  const res = await h(new Request('https://x.supabase.co/functions/v1/get-development-activity-report', init));
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, headers: res.headers, text, json };
};
const AUTH = { authorization: 'Bearer user-token' };
const REQ = { address: ADDRESS };

// capture anything the function writes to the console
const logged = [];
const orig = { log: console.log, error: console.error, warn: console.warn, info: console.info };
const spy = (k) => (...a) => { logged.push(a.map(String).join(' ')); };

// ---- 1. who may ask -----------------------------------------------------------------------------------------
{
  let f = fakes();
  const noAuth = await call(f.deps, REQ);
  ok(noAuth.status === 401 && f.calls.length === 0, '1a no Authorization header: 401, and nothing was read');
  f = fakes();
  const junk = await call(f.deps, REQ, { authorization: 'Bearer' });
  ok(junk.status === 401 && f.calls.length === 0, '1a a Bearer with no token: 401');
  f = fakes();
  const basic = await call(f.deps, REQ, { authorization: 'Basic abc' });
  ok(basic.status === 401 && f.calls.length === 0, '1a a non-Bearer scheme: 401');

  f = fakes();
  const anon = await call(f.deps, REQ, { authorization: 'Bearer public-anon-key' });
  ok(anon.status === 401 && f.calls.join() === 'authenticate', '1b THE PUBLIC ANON KEY: a validly signed JWT with no user is refused (401) and nothing beyond authentication runs');

  f = fakes({ authenticate: async () => ({ email: 'someone@example.com' }), isAdmin: async () => false });
  const notAdmin = await call(f.deps, REQ, AUTH);
  ok(notAdmin.status === 403 && notAdmin.json.error === 'forbidden', '1c a signed-in user who is not in dashboard_admins: 403');
  ok(!f.calls.includes('geocode') && !f.calls.includes('radius') && !f.calls.includes('hydrate'), '1c and no geocode, no spatial read, no hydration ran for them');

  f = fakes({ authenticate: async () => { throw new Error('boom'); } });
  ok((await call(f.deps, REQ, AUTH)).status === 502, '1d the auth service failing is 502, not a pass');
  f = fakes({ isAdmin: async () => { throw new Error('boom'); } });
  const adminDown = await call(f.deps, REQ, AUTH);
  ok(adminDown.status === 502 && !f.calls.includes('geocode'), '1d the allow-list read failing is 502 and stops there (never "assume admin")');

  f = fakes();
  const bad = await call(f.deps, { address: 'x' }, {});
  ok(bad.status === 401, '1e validation comes AFTER identity: an unauthenticated bad request is 401, not 400');

  f = fakes();
  const ok1 = await call(f.deps, REQ, AUTH);
  ok(ok1.status === 200 && ok1.json.status === 'OK', '1f a signed-in, allow-listed user gets a report', ok1.status);
}

// ---- 2. what they may ask ---------------------------------------------------------------------------------
{
  const f = () => fakes().deps;
  const post = (b, h = AUTH) => call(f(), b, h);
  ok((await post({ address: 'short' })).status === 400, '2a an address under 8 characters: 400');
  ok((await post({ address: 'nospacesatallinthisaddress' })).status === 400, '2a an address with no space: 400');
  ok((await post({ address: 'x '.repeat(101) })).status === 400, '2a an address over 200 characters: 400');
  ok((await post({ address: 12345678 })).status === 400 && (await post({})).status === 400, '2a a non-string or missing address: 400');
  // 100526 plan, ruling 7: every report is 0.5 mile. 1, 2 and 5 are radii the spatial read knows, and a report still refuses them.
  for (const r of [3, 'wide', 1, 2, 5, '2', 0.3]) {
    const res = await post({ ...REQ, radius_mi: r });
    ok(res.status === 400 && res.json.detail === 'radius_mi must be 0.5', '2b radius ' + JSON.stringify(r) + ' is refused: a report is 0.5 mile', res.json);
  }
  for (const r of [0.5, '0.5']) ok((await post({ ...REQ, radius_mi: r })).status === 200, '2b radius ' + JSON.stringify(r) + ' is accepted');
  ok((await post({ ...REQ, view: 'staff' })).status === 400, '2c an unknown view: 400');
  ok((await post({ ...REQ, label: 'x'.repeat(81) })).status === 400 && (await post({ ...REQ, label: 5 })).status === 400, '2d a label over 80 characters, or not a string: 400');
  const unk = await post({ ...REQ, client_name: 'Homer' });
  ok(unk.status === 400 && unk.json.detail === 'unknown field: client_name', '2e an unknown field is refused, not ignored (no client name, email or phone can ride in)');
  ok((await post('not json{')).status === 400 && (await post([1, 2])).status === 400 && (await post('"TOO_LARGE"')).status === 400, '2f invalid JSON, an array, or a bare string: 400 (and never mistaken for "too large")');
  const big = await post({ address: ADDRESS, label: 'x'.repeat(5000) });
  ok(big.status === 413, '2g a body over 4,096 bytes: 413', big.status);
  const declared = await call(f(), REQ, { ...AUTH, 'content-length': '999999' });
  ok(declared.status === 413, '2g a declared length over the bound is refused before the body is read');
  const get = await call(f(), null, {}, 'GET');
  ok(get.status === 200 && /never an admin report/.test(get.json.stores_reports) && get.json.radius_mi.join() === '0.5', '2h GET returns the capability (no data), and says an admin report is never stored');
  ok((await call(f(), null, AUTH, 'DELETE')).status === 405, '2h other methods: 405');
}

// ---- 3. the flow, and what is NEVER done ---------------------------------------------------------------------
{
  let f = fakes({ geocode: async () => null });
  const nomatch = await call(f.deps, REQ, AUTH);
  ok(nomatch.json.status === 'ADDRESS_NOT_RESOLVED' && nomatch.json.report === null && nomatch.json.stored === false, '3a an unresolved address: a status, no report');
  ok(nomatch.json.credit && nomatch.json.credit.uses_report === false && nomatch.json.credit.reason === 'NOT_A_REPORT', '3a and it never uses a free report', nomatch.json.credit);
  f = fakes({ geocode: async () => null }); await call(f.deps, REQ, AUTH);
  ok(!f.calls.includes('zipSupported') && !f.calls.includes('radius'), '3a and no coverage or spatial read runs');

  f = fakes({ zipSupported: async () => false });
  const outside = await call(f.deps, REQ, AUTH);
  ok(outside.json.status === 'OUTSIDE_COVERAGE' && outside.json.zip === '97477' && outside.json.report === null, '3b a ZIP outside the 12,722: OUTSIDE_COVERAGE, no report');
  ok(outside.json.credit && outside.json.credit.uses_report === false && outside.json.credit.reason === 'NOT_A_REPORT', '3b and it never uses a free report', outside.json.credit);
  f = fakes({ zipSupported: async () => false }); await call(f.deps, REQ, AUTH);
  ok(!f.calls.includes('radius') && !f.calls.includes('hydrate'), '3b and nothing beyond the coverage check ran');

  f = fakes({ geocode: async () => { throw new H.GeocoderUnavailable('x'); } });
  const gdown = await call(f.deps, REQ, AUTH);
  ok(gdown.status === 502 && gdown.json.error === 'geocoder_unavailable', '3c the geocoder being down is 502, distinct from "no match"');

  for (const which of ['zipSupported', 'radius', 'hydrate', 'ledger', 'events', 'health']) {
    const over = { [which]: async () => { throw new H.DataUnavailable('x'); } };
    if (which === 'health') over.hydrate = async () => [proj('k1')];
    f = fakes(over);
    const r = await call(f.deps, REQ, AUTH);
    ok(r.status === 502 && r.json.error === 'data_unavailable' && r.json.report === undefined, '3d a failed ' + which + ' read is 502 with NO report (an empty report would read as "nothing near you")');
  }

  f = fakes({ rights: { version: 1, cleared: 'everything' } });
  const badRights = await call(f.deps, REQ, AUTH);
  ok(badRights.status === 500 && badRights.json.error === 'internal', '3e a malformed rights registry fails the request (500), it does not fall back to all-cleared');

  const secret = new Error(ADDRESS + ' 44.04612');
  f = fakes({ radius: async () => { throw secret; } });
  const boom = await call(f.deps, REQ, AUTH);
  ok(boom.status === 500 && !boom.text.includes('Evergreen') && !boom.text.includes('44.046'), '3f an unexpected error never echoes its message (it can carry the address)');
}

// ---- 4. the successful response --------------------------------------------------------------------------------
{
  const f = fakes({
    radius: async () => [
      { source_key: 'k2', feature_id: 'pt:1', registry_id: 'fam-a', provenance: 'p', distance_mi: 0.5, geometry_type: 'Point', has_more: false },
      { source_key: 'k1', feature_id: 'pt:1', registry_id: 'fam-a', provenance: 'p', distance_mi: 0.3, geometry_type: 'Point', has_more: false },
      { source_key: 'k1', feature_id: 'pt:2', registry_id: 'fam-a', provenance: 'p', distance_mi: 0.2, geometry_type: 'Point', has_more: false },
    ],
    hydrate: async (keys) => { f.seen.hydrate = keys; return [proj('k1'), proj('k2', { name: 'Weather Station' })]; },
    ledger: async (keys) => { f.seen.ledger = keys; return []; },
    events: async (keys, since) => { f.seen.events = [keys, since]; return []; },
    health: async (fam) => { f.seen.health = fam; return []; },
  });
  f.seen = {};
  const r = await call(f.deps, { ...REQ, label: 'Homer client' }, AUTH);
  ok(r.status === 200 && r.json.stored === false && r.json.report_id === null, '4a the response says nothing was stored and there is no report_id');
  ok(r.headers.get('cache-control') === 'no-store', '4b the response is never cacheable (it can hold the customer\'s own address back to them)');
  ok(JSON.stringify(f.seen.hydrate) === '["k1","k2"]' && JSON.stringify(f.seen.ledger) === '["k1","k2"]' && JSON.stringify(f.seen.events) === '[["k1","k2"],"2026-07-01"]',
    '4c the keys are de-duplicated and sorted, and events are asked for only since today minus 90 days', f.seen);
  ok(JSON.stringify(f.seen.health) === '["fam-a"]', '4c source health is asked only for the families that appear');
  ok(r.json.render.distances_mi.k1 === 0.2 && r.json.render.distances_mi.k2 === 0.5, '4d distances come back in the response-only block, nearest instance per project', r.json.render);
  ok(!JSON.stringify(r.json.report).includes('Evergreen') && !JSON.stringify(r.json.report).includes('Homer') && !('distances_mi' in r.json.report), '4e the report itself holds no address, no label and no distance');
  ok(r.json.storable === true && r.json.storage_blockers.length === 0, '4f a clean customer report says it could be stored (and is not)');
  ok(r.json.coverage_state === 'REPORT_READY', '4g coverage state is reported', r.json.coverage_state);
  const asked = [];
  const d2 = fakes({ radius: async (lat, lng, rad) => { asked.push([lat, lng, rad]); return []; } });
  const dflt = await call(d2.deps, REQ, AUTH);
  ok(asked.length === 1 && asked[0][2] === 0.5 && dflt.json.report.radius_mi === 0.5, '4j with no radius given, the canonical read is asked for 0.5 mile and the report says so', asked);
  const half = await call(fakes({ radius: async (a, b, rad) => { asked.push(rad); return []; } }).deps, { ...REQ, radius_mi: 0.5 }, AUTH);
  ok(asked[1] === 0.5 && half.json.report.radius_mi === 0.5, '4j and a stated 0.5 is the one asked for');

  const internal = await call(fakes({ rights: { version: 1, cleared: [] } }).deps, { ...REQ, view: 'internal' }, AUTH);
  ok(internal.json.storable === false && internal.json.storage_blockers.includes('INTERNAL_VIEW') && internal.json.report.projects.every((p) => p.rights === 'HOLD'),
    '4h the internal view labels every record HOLD and reports itself not storable');
  const cust = await call(fakes({ rights: { version: 1, cleared: [] } }).deps, REQ, AUTH);
  ok(cust.json.report.projects.length === 0 && cust.json.coverage_state === 'LIMITED_COVERAGE', '4i with nothing cleared, the customer view is an honest LIMITED report with no records');

  // founder ruling R5: every answer carries the one credit decision, and nothing here charges anything
  const cr = (x) => x && [x.uses_report, x.reason, x.rule_version].join('|');
  ok(cr(r.json.credit) === 'true|DEVELOPMENT_SHOWN|credit-rule-1' && r.json.report.activity.outcome === 'DEVELOPMENT_SHOWN',
    '4k a customer report that shows development would use one free report, and says which rule decided it', r.json.credit);
  ok(cr(cust.json.credit) === 'false|NO_DATA_INGESTED|credit-rule-1' && cust.json.report.activity.label === 'No data ingested',
    '4l the shipped state (nothing cleared): the customer report says "No data ingested" and would use no free report', cust.json.credit);
  ok(cr(internal.json.credit) === 'false|INTERNAL_VIEW|credit-rule-1', '4m the operator\'s internal view is never charged', internal.json.credit);
  ok(cr(dflt.json.credit) === 'false|NO_DATA_INGESTED|credit-rule-1', '4n an empty radius under a cleared source is still "No data ingested", not "No development activity"', dflt.json.credit);
  ok(r.json.stored === false && r.json.report_id === null && r.json.charged === false && !('trial' in r.json), '4o an admin report is never charged or stored, even when the rule would charge a customer');
  ok(H.capability().credit_rule === 'credit-rule-1', '4p the capability names the credit rule');
}

// ---- 5. cross-origin ----------------------------------------------------------------------------------------
{
  const f = fakes().deps;
  const h = H.makeHandler(f);
  const pre = await h(new Request('https://x/functions/v1/y', { method: 'OPTIONS', headers: { origin: 'https://homesignal.net' } }));
  ok(pre.headers.get('access-control-allow-origin') === 'https://homesignal.net', '5a an allowed origin is echoed');
  const pre2 = await h(new Request('https://x/functions/v1/y', { method: 'OPTIONS', headers: { origin: 'https://evil.example' } }));
  ok(pre2.headers.get('access-control-allow-origin') === null, '5b a foreign origin gets no allow-origin header');
  const any = [pre, pre2, await call(f, REQ, { ...AUTH, origin: 'https://evil.example' })];
  ok(any.every((r) => (r.headers.get ? r.headers.get('access-control-allow-origin') : r.headers['access-control-allow-origin']) !== '*'), '5c the allow-origin header is never a wildcard');
  ok(H.ALLOWED_ORIGINS.join() === 'https://homesignal.net,https://www.homesignal.net', '5d the allowed origins are exactly the two site origins');
}

// ---- 6. nothing private is ever logged -----------------------------------------------------------------------
{
  console.log = spy('log'); console.error = spy('error'); console.warn = spy('warn'); console.info = spy('info');
  try {
    const f = fakes();
    await call(f.deps, { ...REQ, label: 'Homer client' }, AUTH);
    await call(fakes({ radius: async () => { throw new Error(ADDRESS); } }).deps, REQ, AUTH);
    await call(fakes({ geocode: async () => { throw new H.GeocoderUnavailable(ADDRESS); } }).deps, REQ, AUTH);
  } finally { Object.assign(console, orig); }
  ok(logged.length === 0, '6a the function writes nothing to the console on the success path or any failure path', logged);
}

// ---- 7. the data layer: every request it would send ------------------------------------------------------------
{
  const BASE = 'https://proj.supabase.co';
  const KEY = 'service-key-value';
  const reqs = [];
  const mk = (handlers) => D.makeDeps({ url: BASE + '/', serviceKey: KEY, rights: RIGHTS }, async (url, init) => {
    reqs.push({ url, init: init || {} });
    for (const [re, fn] of handlers) if (re.test(url)) return fn(url, init || {});
    return new Response('[]', { status: 200 });
  });
  const json = (v, status = 200) => new Response(JSON.stringify(v), { status });

  let d = mk([[/auth\/v1\/user/, (u, i) => (i.headers.Authorization === 'Bearer good' ? json({ email: 'a@b.com' }) : json({ msg: 'no' }, 401))]]);
  ok((await d.authenticate('good')).email === 'a@b.com', '7a authenticate returns the user\'s email for a real user token');
  ok(await d.authenticate('anon') === null, '7a and null for a token with no user (401)');
  const au = reqs.find((r) => r.url.includes('/auth/v1/user'));
  ok(au.init.headers.Authorization === 'Bearer good' && au.init.headers.apikey === KEY, '7a the user\'s token is the Authorization; the service key is only the apikey');
  d = mk([[/auth\/v1\/user/, () => json({}, 500)]]);
  ok(await d.authenticate('t').then(() => false, (e) => e instanceof H.DataUnavailable), '7a an auth-service 500 is DataUnavailable, not "not a user"');

  reqs.length = 0;
  d = mk([[/dashboard_admins/, () => json([{ email: 'Founder@Example.com' }])]]);
  ok(await d.isAdmin('Founder@Example.com') === true, '7b an exact email match is an admin');
  ok(await d.isAdmin('founder@example.com') === false, '7b a case-different email is NOT (the same exact comparison the dashboard RPCs make)');
  ok(reqs[0].url.includes('email=eq.Founder%40Example.com') && reqs[0].url.includes('select=email'), '7b the lookup is exact and selects only the email', reqs[0].url);
  d = mk([[/dashboard_admins/, () => json([])]]);
  ok(await d.isAdmin('x@y.com') === false, '7b an empty answer is not an admin');

  reqs.length = 0;
  d = mk([[/canonical_zip_registry/, () => json([{ zip: '97477' }])]]);
  ok(await d.zipSupported('97477') === true && reqs[0].url.includes('canonical_zip_registry') && reqs[0].url.includes('zip=eq.97477'), '7c coverage asks the canonical registry for the ZIP');
  ok(await d.zipSupported('9747') === false && await d.zipSupported('97477 OR 1=1') === false && reqs.length === 1, '7c a non-ZIP string never reaches the database');
  d = mk([[/canonical_zip_registry/, () => json([])]]);
  ok(await d.zipSupported('00000') === false, '7c a ZIP not in the registry is unsupported');

  reqs.length = 0;
  d = mk([[/rpc\/n5_projects_within_radius/, () => json([{ source_key: 'k', has_more: false }])]]);
  await d.radius(44.04612, -122.98123, 1);
  const rr = reqs[0];
  ok(rr.init.method === 'POST' && JSON.stringify(JSON.parse(rr.init.body)) === '{"p_lat":44.04612,"p_lng":-122.98123,"p_radius_mi":1,"p_limit":1000}', '7d the spatial read is the canonical RPC with its own parameter names and a 1,000-row limit', rr.init.body);
  d = mk([[/rpc\/n5_projects_within_radius/, () => json({ message: 'radius_mi 3 is not one of' }, 400)]]);
  ok(await d.radius(1, 1, 3).then(() => false, (e) => e instanceof H.DataUnavailable), '7d a refused radius is an ERROR, never an empty "nothing nearby"');

  reqs.length = 0;
  const keys = Array.from({ length: 60 }, (_, i) => 'arcgis:src:' + String(i).padStart(3, '0'));
  keys.push('we"ird\\key');
  d = mk([[/app_projects/, (u) => json(u.includes('000') ? [
    { source_key: 'arcgis:src:000', name: 'old copy', last_seen_at: '2026-09-01T00:00:00Z', record_kind: 'development' },
    { source_key: 'arcgis:src:000', name: 'new copy', last_seen_at: '2026-09-28T00:00:00Z', record_kind: 'development' }] : [])]]);
  const hyd = await d.hydrate(keys);
  ok(reqs.length === 3, '7e 61 keys are fetched in chunks of 25 (three requests)', reqs.length);
  ok(reqs.every((r) => r.url.includes('record_kind=eq.development') && !r.url.includes('select=*')), '7e every hydration asks for development records and named columns only');
  ok(decodeURIComponent(reqs[2].url).includes('"we\\"ird\\\\key"'), '7e a key with a quote and a backslash is escaped inside the in.() list', decodeURIComponent(reqs[2].url));
  ok(hyd.length === 1 && hyd[0].name === 'new copy' && !('last_seen_at' in hyd[0]), '7f a project with several ZIP copies resolves to the newest materialisation, and the bookkeeping column is dropped');

  reqs.length = 0;
  d = mk([[/dev_change_event_reportable/, () => json([])], [/dev_change_project/, () => json([])], [/dev_change_source_fetch_health/, () => json([])]]);
  await d.events(['a', 'b'], '2026-07-01'); await d.ledger(['a']); await d.health(['fam-a']);
  ok(reqs[0].url.includes('dev_change_event_reportable') && reqs[0].url.includes('observed_at=gte.2026-07-01'), '7g changes are read only from the ledger\'s REPORTABLE view, since the window start');
  ok(reqs[1].url.includes('dev_change_project?') && reqs[2].url.includes('dev_change_source_fetch_health?'), '7g change-readiness and source health come from the ledger\'s own relations (health from the failure-only view, never the whole-ledger one)');
  ok(!reqs.some((r) => /dev_change_event\?/.test(r.url)), '7g the raw event table is never read (the reportable view is the one rule)');

  d = mk([[/app_projects/, () => json(Array.from({ length: 1000 }, (_, i) => ({ source_key: 'k' + i })))]]);
  ok(await d.hydrate(['k1']).then(() => false, (e) => e instanceof H.DataUnavailable), '7h an answer that fills PostgREST\'s 1,000-row cap is refused, not silently cut short');
  d = mk([[/app_projects/, () => json({ message: 'nope' }, 500)]]);
  ok(await d.hydrate(['k1']).then(() => false, (e) => e instanceof H.DataUnavailable), '7h a failed read is DataUnavailable, not an empty list');

  reqs.length = 0;
  d = mk([[/functions\/v1\/geocode-address/, () => json({ match: { matchedAddress: '742 EVERGREEN TER', lat: 44.04612, lng: -122.98123, zip: '97477', city: 'X', state: 'OR' } })]]);
  const g = await d.geocode(ADDRESS);
  ok(g.zip === '97477' && g.lat === 44.04612 && reqs[0].url === BASE + '/functions/v1/geocode-address', '7i the address is resolved by the existing geocode-address function, not by a second geocoder');
  d = mk([[/geocode-address/, () => json({ match: null })]]);
  ok(await d.geocode(ADDRESS) === null, '7i no match is null');
  d = mk([[/geocode-address/, () => json({ match: { lat: 1, lng: 2, zip: 'ABCDE' } })]]);
  ok(await d.geocode(ADDRESS) === null, '7i a match with no valid ZIP is treated as no match');
  d = mk([[/geocode-address/, () => json({ error: 'geocoder_unavailable' }, 502)]]);
  ok(await d.geocode(ADDRESS).then(() => false, (e) => e instanceof H.GeocoderUnavailable), '7i the geocoder failing is GeocoderUnavailable');

  reqs.length = 0;
  d = mk([]);
  await d.authenticate('t'); await d.isAdmin('a@b.com'); await d.zipSupported('97477'); await d.radius(1, 1, 1); await d.hydrate(['k']); await d.ledger(['k']); await d.events(['k'], '2026-07-01'); await d.health(['f']); await d.geocode(ADDRESS).catch(() => null);
  ok(reqs.length >= 9 && reqs.every((r) => r.url.startsWith(BASE + '/')), '7j the service key is sent only to the project\'s own URL: every request went there', reqs.map((r) => r.url));
}

// ---- 8. the trial (build step 5b): a member of an active evaluation gets the customer view, charged only by the one rule -------------
{
  const S = await import('../supabase/functions/_shared/report-snapshot.ts');
  const M = await import('../supabase/functions/_shared/national-report.ts');
  const USER = '0f0e4d2c-1b3a-4c5d-8e9f-a1b2c3d4e5f6';
  const KEY = '3b2c1d4e-5f60-4718-8a9b-0c1d2e3f4a5b';
  const KEY2 = '7d6c5b4a-3928-4170-9e8d-7c6b5a493827';
  const TRIAL = { status: 'active', credits_used: 3, credits_remaining: 17, expired: false };
  const TAUTH = { authorization: 'Bearer trial-token' };
  const trialFakes = (over = {}) => {
    const f = fakes({
      authenticate: async (t) => (t === 'trial-token' ? { email: 'agent@brokerage.example', id: USER } : t === 'user-token' ? { email: 'founder@example.com' } : null),
      isAdmin: async (e) => e === 'founder@example.com',
      ...over,
    });
    const rec = (name, fn) => async (...a) => { f.calls.push(name); f.args[name] = a; return fn(...a); };
    f.args = {};
    for (const [name, fn] of Object.entries({
      trialOf: async () => TRIAL,
      issue: async () => ({ replayed: false, report_id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', content_hash: 'h', report_version: M.REPORT_VERSION, generated_at: '2026-10-02T19:00:00Z',
        private_context_id: 'cccccccc-dddd-4eee-8fff-000000000000', report: { stored: 'body' }, credit: { ordinal: 4, credits_used: 4, credits_remaining: 16, evaluation_status: 'active' } }),
      storedReport: async () => JSON.stringify({ stored: 'first', coverage: { state: 'REPORT_READY' } }),
      contextMatches: async () => 'match',
      ...Object.fromEntries(Object.entries(over).filter(([k]) => ['trialOf', 'issue', 'storedReport', 'contextMatches'].includes(k))),
    })) f.deps[name] = rec(name, fn);
    for (const name of ['authenticate', 'isAdmin']) { const fn = f.deps[name]; f.deps[name] = rec(name, fn); }
    return f;
  };
  const NONE = { version: 1, cleared: [] };
  const cr = (x) => x && [x.uses_report, x.reason].join('|');

  // the shipped state: nothing is cleared, so a trial report is "No data ingested", free, and stored nowhere
  let f = trialFakes({ rights: NONE });
  let r = await call(f.deps, { ...REQ, idempotency_key: KEY }, TAUTH);
  ok(r.status === 200 && r.json.report.activity.outcome === 'NO_DATA_INGESTED' && cr(r.json.credit) === 'false|NO_DATA_INGESTED' && r.json.charged === false
    && r.json.stored === false && r.json.report_id === null && !f.calls.includes('issue'),
    '8a a trial member today: "No data ingested", not charged, nothing stored, the ledger never called', [r.status, r.json.credit, f.calls]);
  ok(JSON.stringify(r.json.trial) === '{"status":"active","credits_used":3,"credits_remaining":17}' && f.args.trialOf[0] === USER,
    '8a and the answer says how many free reports are left (asked of the database by the auth user\'s id, never the email)', r.json.trial);
  ok(JSON.stringify(f.calls.slice(0, 4)) === '["authenticate","isAdmin","trialOf","geocode"]', '8a the order: who you are, the allow-list, the trial, and only then the address', f.calls);

  // once a source is cleared and a record is shown, the report uses one free report: stored and charged in one call
  f = trialFakes();
  r = await call(f.deps, { ...REQ, idempotency_key: KEY }, TAUTH);
  const a = f.args.issue || [];
  ok(r.status === 200 && f.calls.filter((c) => c === 'issue').length === 1 && a[0] === USER && a[1] === KEY && a[2] && a[2].activity.outcome === 'DEVELOPMENT_SHOWN'
    && a[3] && a[3].address === ADDRESS && a[4].reportVersion === M.REPORT_VERSION && a[4].engineInputs.engine === M.REPORT_VERSION,
    '8b a report that shows development is issued ONCE through the evaluation, with the user, the page\'s key, the permanent body, the private address and the engine version', [a[0], a[1], a[4]]);
  ok(r.json.stored === true && r.json.report_id === 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' && r.json.charged === true && r.json.replayed === false && JSON.stringify(r.json.report) === '{"stored":"body"}'
    && JSON.stringify(r.json.trial) === '{"status":"active","credits_used":4,"credits_remaining":16}' && cr(r.json.credit) === 'true|DEVELOPMENT_SHOWN',
    '8b and the answer is the STORED report, its id, "charged", and the trial counted after the charge', r.json.trial);
  ok(!JSON.stringify(a[2]).includes('Evergreen') && !('distances_mi' in a[2]) && !JSON.stringify(r.json.report).includes('Evergreen'), '8b the permanent body handed to the ledger carries no address and no distance');

  // what a trial request may carry
  for (const [what, body, detail] of [['no key', REQ, 'idempotency_key'], ['a key that is not a UUID', { ...REQ, idempotency_key: 'abc' }, 'idempotency_key'],
    ['a non-random (v1) UUID', { ...REQ, idempotency_key: 'c232ab00-9414-11ec-b3c8-9e6bdeced846' }, 'idempotency_key'], ['a number', { ...REQ, idempotency_key: 5 }, 'idempotency_key']]) {
    f = trialFakes();
    r = await call(f.deps, body, TAUTH);
    ok(r.status === 400 && r.json.detail === detail && !f.calls.includes('geocode'), '8c a trial request with ' + what + ' is refused before any address is looked up', r.json);
  }
  f = trialFakes();
  r = await call(f.deps, { ...REQ, idempotency_key: KEY, view: 'internal' }, TAUTH);
  ok(r.status === 403 && r.json.error === 'forbidden' && !f.calls.includes('geocode'), '8d a trial member may not ask for the internal view');
  f = trialFakes();
  r = await call(f.deps, { ...REQ, idempotency_key: KEY }, AUTH);
  ok(r.status === 400 && r.json.detail === 'idempotency_key is for trial reports' && !f.calls.includes('trialOf'), '8e an admin sending a key is refused (an admin report stores nothing and takes none), and an admin\'s trial is never read');
  f = trialFakes();
  r = await call(f.deps, REQ, AUTH);
  ok(r.status === 200 && !f.calls.includes('trialOf') && !f.calls.includes('issue') && r.json.charged === false && !('trial' in r.json), '8e2 the admin path is unchanged: no trial read, no charge');

  // who is refused
  for (const [what, over, status, err] of [
    ['no trial at all', { trialOf: async () => null }, 403, 'forbidden'],
    ['a trial whose 20 reports are used', { trialOf: async () => ({ ...TRIAL, status: 'complete', credits_used: 20, credits_remaining: 0 }) }, 403, 'evaluation_complete'],
    ['a revoked trial', { trialOf: async () => ({ ...TRIAL, status: 'revoked' }) }, 403, 'forbidden'],
    ['an expired trial', { trialOf: async () => ({ ...TRIAL, expired: true }) }, 403, 'forbidden'],
    ['a trial read that fails', { trialOf: async () => { throw new H.DataUnavailable('x'); } }, 502, 'unavailable'],
    ['a signed-in user with no id', { authenticate: async () => ({ email: 'agent@brokerage.example' }) }, 403, 'forbidden'],
  ]) {
    f = trialFakes(over);
    r = await call(f.deps, { ...REQ, idempotency_key: KEY }, TAUTH);
    ok(r.status === status && r.json.error === err && !f.calls.includes('geocode') && !f.calls.includes('issue'), '8f ' + what + ': ' + status + ' ' + err + ', and no address is looked up', [r.status, r.json]);
  }
  f = trialFakes({ trialOf: async () => ({ ...TRIAL, status: 'complete', credits_used: 20, credits_remaining: 0 }) });
  r = await call(f.deps, { ...REQ, idempotency_key: KEY }, TAUTH);
  ok(JSON.stringify(r.json.trial) === '{"status":"complete","credits_used":20,"credits_remaining":0}', '8f2 a used-up trial is told it is complete, with its counts (and never an id)', r.json);

  // the ledger refuses: nothing stored, nothing charged, and no report given
  for (const [what, err, status, code] of [['the 20th report used by another request first', new S.EvaluationComplete('x'), 403, 'evaluation_complete'],
    ['membership ended while the report was made', new S.NotEntitled('x'), 403, 'forbidden'], ['the ledger unreachable', new H.DataUnavailable('x'), 502, 'data_unavailable'], ['anything else', new Error('boom'), 500, 'internal']]) {
    f = trialFakes({ issue: async () => { throw err; } });
    r = await call(f.deps, { ...REQ, idempotency_key: KEY }, TAUTH);
    ok(r.status === status && r.json.error === code && r.json.report === undefined, '8g ' + what + ': ' + status + ' ' + code + ' and NO report (a report given anyway would be a free one)', [r.status, r.json]);
  }

  // a retried key: the database returns the FIRST report and charges nothing; shown only if it is about the same property
  const replay = { replayed: true, report_id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', generated_at: '2026-10-02T18:00:00Z', private_context_id: 'cccccccc-dddd-4eee-8fff-000000000000',
    credit: { ordinal: 4, credits_used: 4, credits_remaining: 16, evaluation_status: 'active' } };
  f = trialFakes({ issue: async () => replay });
  r = await call(f.deps, { ...REQ, idempotency_key: KEY }, TAUTH);
  ok(r.status === 200 && r.json.replayed === true && r.json.charged === false && r.json.stored === true && JSON.stringify(r.json.report) === '{"stored":"first","coverage":{"state":"REPORT_READY"}}'
    && f.args.contextMatches[0] === replay.private_context_id && f.args.contextMatches[1] === ADDRESS && f.args.storedReport[0] === replay.report_id,
    '8h a retried key for the same property returns the FIRST stored report, says it was not charged again, and the trial counts are the ledger\'s', r.json);
  for (const [what, ans] of [['a different property', 'mismatch'], ['a context that can no longer be read', 'unknown']]) {
    f = trialFakes({ issue: async () => replay, contextMatches: async () => ans });
    r = await call(f.deps, { ...REQ, idempotency_key: KEY }, TAUTH);
    ok(r.status === 409 && r.json.error === 'idempotency_key_reused' && r.json.report === undefined && !f.calls.includes('storedReport'), '8i a retried key for ' + what + ' is refused (409) and shows no report', r.json);
  }
  f = trialFakes({ issue: async () => ({ ...replay, private_context_id: null }) });
  r = await call(f.deps, { ...REQ, idempotency_key: KEY }, TAUTH);
  ok(r.status === 409 && !f.calls.includes('contextMatches'), '8i a replay with no private context cannot be checked, so it is refused');
  f = trialFakes({ issue: async () => replay, storedReport: async () => null });
  r = await call(f.deps, { ...REQ, idempotency_key: KEY }, TAUTH);
  ok(r.status === 502 && r.json.error === 'data_unavailable', '8i a stored report that cannot be read back is 502, never the freshly made one in its place');

  // a trial request that is not a report is never charged
  f = trialFakes({ geocode: async () => null });
  r = await call(f.deps, { ...REQ, idempotency_key: KEY2 }, TAUTH);
  ok(r.json.status === 'ADDRESS_NOT_RESOLVED' && cr(r.json.credit) === 'false|NOT_A_REPORT' && !f.calls.includes('issue') && r.json.trial.credits_remaining === 17, '8j an address that cannot be found: not a report, not charged, counts shown');
  f = trialFakes({ zipSupported: async () => false });
  r = await call(f.deps, { ...REQ, idempotency_key: KEY2 }, TAUTH);
  ok(r.json.status === 'OUTSIDE_COVERAGE' && cr(r.json.credit) === 'false|NOT_A_REPORT' && !f.calls.includes('issue'), '8j a ZIP HomeSignal does not cover: not charged');
}

// ---- 9. the data layer's trial reads: each goes through the database function that owns the decision --------------------------------
{
  const BASE = 'https://proj.supabase.co';
  const reqs = [];
  const json = (v, status = 200) => new Response(JSON.stringify(v), { status });
  const mk = (handlers) => D.makeDeps({ url: BASE, serviceKey: 'svc', rights: RIGHTS }, async (url, init) => {
    reqs.push({ url, init: init || {} });
    for (const [re, fn] of handlers) if (re.test(url)) return fn(url, init || {});
    return json([]);
  });
  const S = await import('../supabase/functions/_shared/report-snapshot.ts');
  const USER = '0f0e4d2c-1b3a-4c5d-8e9f-a1b2c3d4e5f6';
  let d = mk([[/auth\/v1\/user/, () => json({ email: 'a@b.com', id: USER })]]);
  const who = await d.authenticate('t');
  ok(who.email === 'a@b.com' && who.id === USER, '9a authenticate also returns the auth user\'s id');
  d = mk([[/auth\/v1\/user/, () => json({ email: 'a@b.com', id: 'not-a-uuid' })]]);
  ok(JSON.stringify(await d.authenticate('t')) === '{"email":"a@b.com"}', '9a a malformed id is not passed on');

  reqs.length = 0;
  d = mk([[/rpc\/evaluation_usage/, () => json([{ evaluation_id: 'e', status: 'active', credit_limit: 20, credits_used: 2, credits_remaining: 18, expires_at: null, expired: false }])]]);
  const t = await d.trialOf(USER);
  ok(JSON.stringify(t) === '{"status":"active","credits_used":2,"credits_remaining":18,"expired":false}' && reqs[0].init.method === 'POST'
    && JSON.parse(reqs[0].init.body).p_user_id === USER && reqs[0].url === BASE + '/rest/v1/rpc/evaluation_usage', '9b the trial is asked of public.evaluation_usage by user id, and only its status and counts are kept (never the evaluation id)', t);
  d = mk([[/rpc\/evaluation_usage/, () => json([])]]);
  ok(await d.trialOf(USER) === null, '9b no membership: no trial');
  for (const [what, resp] of [['two rows', json([{ status: 'active', credits_used: 1, credits_remaining: 19, expired: false }, { status: 'active', credits_used: 1, credits_remaining: 19, expired: false }])],
    ['a malformed row', json([{ status: 'active', credits_used: '1', credits_remaining: 19, expired: false }])], ['a 500', json({}, 500)], ['a refusal', json({ message: 'x' }, 400)]]) {
    d = mk([[/rpc\/evaluation_usage/, () => resp.clone()]]);
    ok(await d.trialOf(USER).then(() => false, (e) => e instanceof H.DataUnavailable), '9c ' + what + ' from the trial read is DataUnavailable, never "no trial" and never "a trial"');
  }

  const BODY = { product: 'P', projects: [] };
  const CTX = { address: '742 Evergreen Terrace, Springfield, OR 97477', latitude: 44.04, longitude: -122.98 };
  const OPTS = { reportVersion: 'v', engineInputs: { engine: 'v' } };
  const KEY = '3b2c1d4e-5f60-4718-8a9b-0c1d2e3f4a5b';
  const ROW = { report_id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', generated_at: '2026-10-02T19:00:00Z', private_context_id: 'cccccccc-dddd-4eee-8fff-000000000000', replayed: false, credit_ordinal: 1, credits_used: 1, credits_remaining: 19, evaluation_status: 'active' };
  reqs.length = 0;
  d = mk([[/rpc\/evaluation_report_issue/, () => json([ROW])]]);
  const out = await d.issue(USER, KEY, BODY, CTX, OPTS);
  const sent = JSON.parse(reqs[0].init.body);
  ok(reqs[0].url === BASE + '/rest/v1/rpc/evaluation_report_issue' && sent.p_user_id === USER && sent.p_idempotency_key === KEY && sent.p_body === JSON.stringify(BODY)
    && sent.p_content_hash === await S.sha256Hex(JSON.stringify(BODY)) && JSON.stringify(sent.p_private) === JSON.stringify(CTX) && !sent.p_body.includes('Evergreen'),
    '9d the charge is ONE call to public.evaluation_report_issue: user, key, the body and its hash, and the address only as p_private', Object.keys(sent));
  ok(out.replayed === false && out.report_id === ROW.report_id && out.credit.credits_remaining === 19 && JSON.stringify(out.report) === JSON.stringify(BODY), '9d and its answer is read back');
  for (const [what, resp, cls] of [['EVALUATION_COMPLETE', json({ code: 'EV002', message: 'EVALUATION_COMPLETE' }, 400), S.EvaluationComplete], ['NOT_ENTITLED', json({ code: 'EV003', message: 'NOT_ENTITLED' }, 400), S.NotEntitled]]) {
    d = mk([[/rpc\/evaluation_report_issue/, () => resp.clone()]]);
    ok(await d.issue(USER, KEY, BODY, CTX, OPTS).then(() => false, (e) => e instanceof cls), '9e the database\'s ' + what + ' becomes its own named refusal');
  }
  d = mk([[/rpc\/evaluation_report_issue/, () => json({ message: 'x' }, 503)]]);
  ok(await d.issue(USER, KEY, BODY, CTX, OPTS).then(() => false, (e) => e instanceof H.DataUnavailable), '9e a 5xx is DataUnavailable, never a refusal');
  d = mk([[/rpc\/evaluation_report_issue/, () => json([{ ...ROW, credits_used: null }])]]);
  ok(await d.issue(USER, KEY, BODY, CTX, OPTS).then(() => false, (e) => /did not confirm the credit/.test(e.message)), '9e an answer that does not confirm the credit is a failure, not a stored report');
  ok(await d.issue(USER, 'c232ab00-9414-11ec-b3c8-9e6bdeced846', BODY, CTX, OPTS).then(() => false, (e) => /idempotency key/.test(e.message)), '9e a non-random key never reaches the database');
  d = mk([[/rpc\/evaluation_report_issue/, () => json([{ ...ROW, replayed: true }])]]);
  const rep = await d.issue(USER, KEY, BODY, CTX, OPTS);
  ok(rep.replayed === true && !('report' in rep) && rep.report_id === ROW.report_id, '9f a replay carries the FIRST report\'s id and no body (the body this call made is not the stored one)');

  reqs.length = 0;
  d = mk([[/rpc\/report_private_context_read/, () => json([{ state: 'active', address: '742  EVERGREEN Terrace, Springfield, OR 97477', normalized_address: 'x', latitude: 1, longitude: 2 }])]]);
  ok(await d.contextMatches('cccccccc-dddd-4eee-8fff-000000000000', '742 Evergreen Terrace, Springfield, OR 97477') === 'match'
    && JSON.parse(reqs[0].init.body).p_context === 'cccccccc-dddd-4eee-8fff-000000000000', '9g the same property (case and spacing aside) matches; the read is the private layer\'s own function');
  ok(await d.contextMatches('cccccccc-dddd-4eee-8fff-000000000000', '1 Other St, Springfield, OR 97477') === 'mismatch', '9g a different property does not');
  d = mk([[/rpc\/report_private_context_read/, () => json([{ state: 'purged', address: null }])]]);
  ok(await d.contextMatches('c', 'x y') === 'unknown', '9g a purged context cannot be checked');
  d = mk([[/rpc\/report_private_context_read/, () => json([])]]);
  ok(await d.contextMatches('c', 'x y') === 'unknown', '9g a missing context cannot be checked');
  d = mk([[/rpc\/report_private_context_read/, () => json({}, 500)]]);
  ok(await d.contextMatches('c', 'x y').then(() => false, (e) => e instanceof H.DataUnavailable), '9g a failed read is DataUnavailable');

  reqs.length = 0;
  d = mk([[/report_snapshot/, () => json([{ body: '{"a":1}' }])]]);
  ok(await d.storedReport('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee') === '{"a":1}' && /report_snapshot\?select=body&report_id=eq\.aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee$/.test(reqs[0].url) && !reqs[0].init.method,
    '9h the stored report is read back by id, its body only, with a GET');
}

console.log('\n' + (n - bad) + ' passed, ' + bad + ' failed of ' + n);
process.exit(bad ? 1 : 0);
