// THE REPORT RATE LIMIT, AT THE EDGE (docs/report-rate-limit.sql; supabase/functions/_shared/rate-reads.ts; the report handler).
//
// What is real: the report function's request handler, the shared reader that calls the database's claim (rate-reads.ts), and the function's real data layer
// (data.ts makeDeps) for the wiring checks. What is stood in: everything the handler reaches through `Deps` (the geocoder, the canonical reads, the credit
// ledger) as recorders, and the network for the data-layer checks. The database's decision (the windows, the numbers, the counting) is NOT here: it is proven
// against a real Postgres by test/report_rate_limit_pg and by section 15 of test/launch_gate_pg. This file proves the EDGE half:
//   * where the claim is made (after validation, before any work), for whom (a signed-in member, never an admin), and what is NEVER claimed (reads, refused
//     requests, invalid requests);
//   * what a refusal looks like (429, the wait in the body and in Retry-After, nothing else) and that it did no work and charged nothing;
//   * that it FAILS CLOSED: a claim that cannot be made, or comes back in a shape nobody recognises, is a 502 and the geocoder is never asked;
//   * that the shared reader accepts exactly the shapes the database can answer and refuses every other.
// Every check is written to FAIL BY NAME: an answer without a field the check reads is a FAIL line (optional chaining), and any throw that still gets out ends
// as a named failure with the usual summary, never a bare stack trace.
// Run: node test/report-rate-limit-function.test.mjs
const H = await import('../supabase/functions/get-development-activity-report/handler.ts');
const D = await import('../supabase/functions/get-development-activity-report/data.ts');
const R = await import('../supabase/functions/_shared/rate-reads.ts');
const { DataUnavailable } = await import('../supabase/functions/_shared/service-rest.ts');
const M = await import('../supabase/functions/_shared/national-report.ts');

let n = 0, bad = 0;
process.on('uncaughtException', (e) => {
  console.log('FAIL — the test stopped: ' + String(e && e.message).slice(0, 160));
  console.log('\n' + (n - bad) + ' passed, ' + (bad + 1) + ' failed of ' + (n + 1));
  process.exit(1);
});
const ok = (c, m, d) => { n++; if (c) console.log('PASS — ' + m); else { bad++; console.log('FAIL — ' + m + (d !== undefined ? '  [' + JSON.stringify(d).slice(0, 400) + ']' : '')); } };

const NOW = new Date('2026-10-04T12:00:00Z');
const ADDRESS = '20 N Main St, Brigham City, UT 84302';
const USER = '0f0e4d2c-1b3a-4c5d-8e9f-a1b2c3d4e5f6';
const KEY = '3b2c1d4e-5f60-4718-8a9b-0c1d2e3f4a5b';
const BKID = 'b0b0b0b0-1111-4222-8333-444444444444';
const FAM = 'fixture-family-not-a-real-source';
const RIGHTS = { version: 1, cleared: [{ registry_id: FAM, cleared_on: '2026-10-02', audit_ref: 'fixture', attribution: 'Data: fixture' }] };
const proj = { source_key: 'k1', registry_id: FAM, record_kind: 'development', name: 'Fixture Bridge', type: 'Utility', type_raw: null, status: 'Approved', stage: 'Advertised',
  developer: null, size: null, investment: null, submitted_at: '2026-09-24', date_kind: 'issued', address: '005 King', source_ref: 'https://example.test/record' };
const PLAN = (over = {}) => ({ brokerage_id: BKID, role: 'owner', state: 'none', credit_limit: 100, credits_used: 0, credits_remaining: 0, period_ends_at: null, ...over });
const ALLOW = async () => ({ allowed: true });
const REFUSE = (over = {}) => async () => ({ allowed: false, retryAfterSeconds: 30, limitedBy: 'user', windowSeconds: 60, ...over });

/** A handler whose every dependency records its name, so a test can say what was and was not reached. */
function build(over = {}) {
  const calls = [], args = {};
  const rec = (name, fn) => async (...a) => { calls.push(name); args[name] = a; return fn(...a); };
  const base = {
    now: () => NOW, rights: RIGHTS,
    authenticate: async (t) => (t === 'member' ? { email: 'agent@example.test', id: USER } : t === 'admin' ? { email: 'founder@example.test' } : null),
    isAdmin: async (e) => e === 'founder@example.test',
    geocode: async () => ({ matchedAddress: '20 N MAIN ST, BRIGHAM CITY, UT, 84302', lat: 41.5109, lng: -112.0156, zip: '84302' }),
    zipSupported: async () => true,
    radius: async () => [{ source_key: 'k1', feature_id: 'pt:1', registry_id: FAM, provenance: 'proven_stored_point', distance_mi: 0.21, geometry_type: 'Point', has_more: false }],
    hydrate: async () => [proj], ledger: async () => [], events: async () => [], health: async () => [],
    trialOf: async () => ({ status: 'active', credits_used: 3, credits_remaining: 17, expired: false }),
    planOf: async () => PLAN(),
    rateClaim: ALLOW,
    issue: async () => ({ replayed: false, report_id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', content_hash: 'h', report_version: M.REPORT_VERSION, generated_at: NOW.toISOString(),
      private_context_id: 'cccccccc-dddd-4eee-8fff-000000000000', report: { stored: 'body' }, credit: { ordinal: 4, credits_used: 4, credits_remaining: 16, evaluation_status: 'active', allotment: 'trial', period_ends_at: null } }),
    storedReport: async () => JSON.stringify({ stored: 'first', coverage: { state: 'REPORT_READY' } }),
    contextMatches: async () => 'match',
    savedReports: async () => [], openSavedReport: async () => null, subjectOf: async () => ({ address: null, label: null }),
    headerOf: async () => ({ brokerage: 'Fixture Realty', agent: null }),
    ...over,
  };
  const deps = {};
  for (const [k, v] of Object.entries(base)) deps[k] = typeof v === 'function' && k !== 'now' ? rec(k, v) : v; // `now` is synchronous and is not a reach into anything
  return { deps, calls, args };
}
const ask = async (deps, body, token = 'member') => {
  const res = await H.makeHandler(deps)(new Request('https://x/functions/v1/get-development-activity-report', {
    method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body),
  }));
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json, text, headers: res.headers };
};
const REQ = { address: ADDRESS, idempotency_key: KEY };
const WORK = ['geocode', 'zipSupported', 'radius', 'hydrate', 'ledger', 'events', 'health', 'issue', 'headerOf'];
const didWork = (calls) => WORK.filter((w) => calls.includes(w));

// ---- 1. the claim is made once, for the signed-in member, after the plan and before any work ------------------------------------------------------------------
{
  const f = build();
  const r = await ask(f.deps, REQ);
  ok(r.status === 200 && r.json?.status === 'OK' && r.json?.charged === true, '1a a member under the limit gets an ordinary report (the limiter is invisible when it allows)', [r.status, r.json?.error]);
  ok(f.calls.filter((c) => c === 'rateClaim').length === 1 && f.args.rateClaim?.[0] === USER && f.args.rateClaim?.length === 1,
    '1b the claim is made exactly once, with the signed-in member\'s id and nothing else (no address, no email, no key)', f.args.rateClaim);
  ok(JSON.stringify(f.calls.slice(0, 6)) === '["authenticate","isAdmin","trialOf","planOf","rateClaim","geocode"]', '1c the order: who you are, the trial, the plan, the rate limit, and only then the address', f.calls);
  ok(f.calls.indexOf('rateClaim') < f.calls.indexOf('geocode') && f.calls.indexOf('rateClaim') < f.calls.indexOf('issue'), '1d the claim comes before the geocoder and before anything is charged');
}

// ---- 2. a refusal: 429, the wait, and no work -----------------------------------------------------------------------------------------------------------------
{
  const f = build({ rateClaim: REFUSE({ retryAfterSeconds: 42 }) });
  const r = await ask(f.deps, REQ);
  ok(r.status === 429 && r.json?.error === 'rate_limited' && r.json?.retry_after_seconds === 42 && r.json?.limited_by === 'user', '2a a full window answers 429 rate_limited with the seconds to wait and whose ceiling it was', [r.status, r.json]);
  ok(r.headers.get('retry-after') === '42', '2b and the standard Retry-After header carries the same number of seconds', r.headers.get('retry-after'));
  ok(didWork(f.calls).length === 0 && !f.calls.includes('contextMatches') && !f.calls.includes('storedReport'),
    '2c no work was done for it: no geocoder, no ZIP check, no canonical read, no header read, nothing issued', didWork(f.calls));
  ok(r.json?.report === undefined && r.json?.credit === undefined && r.json?.charged === undefined && r.json?.stored === undefined,
    '2d the refusal carries no report and no credit decision: a refused request is not a report', Object.keys(r.json || {}));
  ok(r.json?.trial?.credits_used === 3 && r.json?.trial?.credits_remaining === 17 && r.json?.plan?.state === 'none', '2e it still carries the trial figures and the plan summary, so the page can keep showing them');
  ok(!r.text.includes(BKID) && !r.text.includes('Main St') && !r.text.includes('84302') && !r.text.includes('agent@example.test') && !r.text.includes(KEY),
    '2f and it names no brokerage id, no address, no ZIP, no email and no key', r.text.slice(0, 200));
  ok(r.headers.get('cache-control') === 'no-store', '2g and it is never cacheable (like every answer of this function)', r.headers.get('cache-control'));
  const b = build({ rateClaim: REFUSE({ limitedBy: 'brokerage', windowSeconds: 3600, retryAfterSeconds: 1800 }) });
  const rb = await ask(b.deps, REQ);
  ok(rb.status === 429 && rb.json?.limited_by === 'brokerage' && rb.json?.retry_after_seconds === 1800 && rb.headers.get('retry-after') === '1800', '2h the brokerage\'s ceiling is reported as the brokerage\'s, with its own wait', rb.json);
  const day = build({ rateClaim: REFUSE({ windowSeconds: 86400, retryAfterSeconds: 72000 }) });
  const rd = await ask(day.deps, REQ);
  ok(rd.status === 429 && rd.json?.retry_after_seconds === 72000 && rd.headers.get('retry-after') === '72000', '2i a day-long wait is passed through whole', rd.json);
  const paid = build({ rateClaim: REFUSE(), planOf: async () => PLAN({ state: 'paid', credits_used: 5, credits_remaining: 95, period_ends_at: '2026-11-04T12:00:00+00:00' }) });
  const rp = await ask(paid.deps, REQ);
  ok(rp.status === 429 && rp.json?.plan?.state === 'paid' && rp.json?.plan?.credits_remaining === 95 && didWork(paid.calls).length === 0, '2j a PAID member is limited too, and the paid month\'s figures are not touched by the refusal', rp.json);
}

// ---- 3. it fails CLOSED -----------------------------------------------------------------------------------------------------------------------------------------
{
  let f = build({ rateClaim: async () => { throw new DataUnavailable('report_rate_claim'); } });
  let r = await ask(f.deps, REQ);
  ok(r.status === 502 && r.json?.error === 'data_unavailable' && didWork(f.calls).length === 0 && r.json?.report === undefined,
    '3a a claim that cannot be made answers 502 data_unavailable and the geocoder is NEVER asked', [r.status, r.json, didWork(f.calls)]);
  f = build({ rateClaim: async () => { throw new Error('boom with ' + ADDRESS); } });
  r = await ask(f.deps, REQ);
  ok(r.status === 500 && r.json?.error === 'internal' && !r.text.includes('Main St') && !r.text.includes('boom') && didWork(f.calls).length === 0,
    '3b any other failure of the claim is a 500 "internal" that says nothing (an error can carry the address) and still reaches no work', [r.status, r.text.slice(0, 120)]);
  const noClaim = build({ rateClaim: undefined });
  delete noClaim.deps.rateClaim;
  r = await ask(noClaim.deps, REQ);
  ok(r.status === 500 && r.json?.report === undefined && didWork(noClaim.calls).length === 0,
    '3c a handler wired WITHOUT a claim function makes no report at all: a missing limiter is a refusal, not an open door', [r.status, r.json?.error]);
  f = build({ rateClaim: async () => ({}) });
  r = await ask(f.deps, REQ);
  ok(r.status !== 200 && r.json?.report === undefined && didWork(f.calls).length === 0, '3d a claim that answers something that is neither "allowed" nor a refusal does not let the request through', [r.status, r.json]);
}

// ---- 4. what is NOT claimed ---------------------------------------------------------------------------------------------------------------------------------------
{
  let f = build();
  let r = await ask(f.deps, { address: ADDRESS }, 'admin');   // an admin report takes no idempotency key
  ok(r.status === 200 && !f.calls.includes('rateClaim'), '4a an ADMIN is not limited: the claim is never made for the founder\'s own tool', [r.status, f.calls]);
  f = build();
  r = await ask(f.deps, { action: 'list' });
  ok(r.status === 200 && !f.calls.includes('rateClaim'), '4b listing saved reports makes no claim (a read of what is stored)', [r.status, f.calls]);
  f = build({ openSavedReport: async () => null });
  r = await ask(f.deps, { action: 'open', report_id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' });
  ok(!f.calls.includes('rateClaim'), '4c opening a saved report makes no claim', f.calls);
  const invalid = [
    ['an address too short', { address: 'x y', idempotency_key: KEY }],
    ['an address with no space', { address: 'abcdefghijkl', idempotency_key: KEY }],
    ['an unknown field', { ...REQ, extra: 1 }],
    ['the internal view (a member may not ask)', { ...REQ, view: 'internal' }],
    ['a radius other than 0.5', { ...REQ, radius_mi: 1 }],
    ['a missing idempotency key', { address: ADDRESS }],
    ['a malformed idempotency key', { address: ADDRESS, idempotency_key: 'not-a-key' }],
    ['a label that is too long', { ...REQ, label: 'x'.repeat(81) }],
  ];
  for (const [what, body] of invalid) {
    f = build();
    r = await ask(f.deps, body);
    ok(r.status >= 400 && r.status < 500 && !f.calls.includes('rateClaim'), '4d ' + what + ' is refused before the limiter: an invalid request consumes nothing', [r.status, f.calls.includes('rateClaim')]);
  }
  f = build({ trialOf: async () => ({ status: 'complete', credits_used: 20, credits_remaining: 0, expired: false }) });
  r = await ask(f.deps, REQ);
  ok(r.status === 403 && r.json?.error === 'evaluation_complete' && !f.calls.includes('rateClaim'), '4e a spent trial is refused (403) before the limiter, so the refusal that matters is the one the person sees', [r.status, r.json?.error]);
  f = build({ planOf: async () => PLAN({ state: 'paid', credits_used: 100, credits_remaining: 0 }) });
  r = await ask(f.deps, REQ);
  ok(r.status === 403 && r.json?.error === 'allotment_complete' && !f.calls.includes('rateClaim'), '4f a spent paid month is refused (403) before the limiter', [r.status, r.json?.error]);
  f = build();
  r = await ask(f.deps, REQ, 'nobody');
  ok(r.status === 401 && !f.calls.includes('rateClaim'), '4g a request with no standing is refused (401) before the limiter', [r.status]);
}

// ---- 5. the limiter does not touch the entitlement or the report ---------------------------------------------------------------------------------------------
{
  const f = build();
  const r = await ask(f.deps, REQ);
  const cr = r.json?.credit;
  ok(cr?.uses_report === true && r.json?.allotment === 'trial' && r.json?.trial?.credits_used === 4 && r.json?.trial?.credits_remaining === 16, '5a an allowed request is charged exactly as before: the free allotment, one used', r.json?.trial);
  const none = build({ rights: { version: 1, cleared: [] } });
  const rn = await ask(none.deps, REQ);
  ok(rn.status === 200 && rn.json?.report?.activity?.outcome === 'NO_DATA_INGESTED' && rn.json?.charged === false && !none.calls.includes('issue') && none.calls.filter((c) => c === 'rateClaim').length === 1,
    '5b a "No data ingested" request is free of charge and NOT free of the limiter: it is exactly the unlimited work the limit exists for', [rn.status, rn.json?.report?.activity?.outcome, none.calls]);
  const twice = build();
  await ask(twice.deps, REQ); await ask(twice.deps, REQ);
  ok(twice.calls.filter((c) => c === 'rateClaim').length === 2, '5c a retried request (the same key) is a request: it takes its own slot', twice.calls.filter((c) => c === 'rateClaim').length);
}

// ---- 6. the shared reader accepts exactly what the database can answer ----------------------------------------------------------------------------------------
const rpcOf = (data, error = null) => { const seen = []; const fn = async (name, args) => { seen.push([name, args]); return { data, error }; }; fn.seen = seen; return fn; };
const verdict = async (data, error) => { try { return await R.makeRateReads(rpcOf(data, error)).claim(USER); } catch (e) { return e instanceof DataUnavailable ? 'DataUnavailable' : 'other:' + e?.message; } };
{
  const row = (over) => ({ allowed: true, retry_after_seconds: 0, limited_by: null, limited_window_secs: null, ...over });
  const refused = (over) => row({ allowed: false, retry_after_seconds: 30, limited_by: 'user', limited_window_secs: 60, ...over });
  const rpc = rpcOf([row({})]);
  const v = await R.makeRateReads(rpc).claim(USER);
  ok(v?.allowed === true && rpc.seen.length === 1 && rpc.seen[0][0] === 'report_rate_claim' && JSON.stringify(rpc.seen[0][1]) === JSON.stringify({ p_user: USER }),
    '6a the reader asks the database\'s report_rate_claim, with p_user and nothing else, and reads "allowed"', rpc.seen);
  ok(rpc.seen.every((s) => s[0] !== 'report_rate_claim_at'), '6b and never the clocked variant (the edge cannot choose the time)');
  for (const [by, win] of [['user', 60], ['user', 3600], ['user', 86400], ['brokerage', 60], ['brokerage', 3600], ['brokerage', 86400]]) {
    const x = await verdict([refused({ limited_by: by, limited_window_secs: win, retry_after_seconds: 7 })]);
    ok(x?.allowed === false && x?.limitedBy === by && x?.windowSeconds === win && x?.retryAfterSeconds === 7, '6c a refusal by the ' + by + ' in the ' + win + '-second window is read whole', x);
  }
  const malformed = [
    ['an empty answer', []], ['no answer', null], ['an object, not a list', {}], ['two rows', [row({}), row({})]], ['a row that is not an object', [null]],
    ['"allowed" missing', [{ retry_after_seconds: 0, limited_by: null, limited_window_secs: null }]], ['"allowed" as a string', [row({ allowed: 'true' })]],
    ['allowed with a wait', [row({ retry_after_seconds: 5 })]], ['allowed naming a limiter', [row({ limited_by: 'user' })]], ['allowed naming a window', [row({ limited_window_secs: 60 })]],
    ['a refusal with no wait', [refused({ retry_after_seconds: 0 })]], ['a refusal with a negative wait', [refused({ retry_after_seconds: -3 })]],
    ['a refusal waiting more than a day', [refused({ retry_after_seconds: 86401 })]], ['a refusal with a fractional wait', [refused({ retry_after_seconds: 1.5 })]],
    ['a refusal with a wait as text', [refused({ retry_after_seconds: '30' })]], ['a refusal by "ip"', [refused({ limited_by: 'ip' })]], ['a refusal by nobody', [refused({ limited_by: null })]],
    ['a refusal in a 120-second window', [refused({ limited_window_secs: 120 })]], ['a refusal in no window', [refused({ limited_window_secs: null })]],
  ];
  for (const [what, data] of malformed) {
    const x = await verdict(data);
    ok(x === 'DataUnavailable', '6d ' + what + ' is DataUnavailable (fail closed), never "allowed"', x);
  }
  ok(await verdict(null, { message: 'function report_rate_claim does not exist' }) === 'DataUnavailable', '6e a database error is DataUnavailable');
  const throwing = async () => { throw new DataUnavailable('network'); };
  ok(await (async () => { try { await R.makeRateReads(throwing).claim(USER); return 'returned'; } catch (e) { return e instanceof DataUnavailable ? 'DataUnavailable' : 'other'; } })() === 'DataUnavailable', '6f a failed call stays DataUnavailable');
  const guard = rpcOf([row({})]);
  const bad = await (async () => { try { await R.makeRateReads(guard).claim('not-a-uuid'); return 'returned'; } catch (e) { return e instanceof DataUnavailable ? 'DataUnavailable' : 'other'; } })();
  ok(bad === 'DataUnavailable' && guard.seen.length === 0, '6g an id that is not a uuid never reaches the database', [bad, guard.seen.length]);
}

// ---- 7. the real data layer is wired to it ---------------------------------------------------------------------------------------------------------------------
{
  const seen = [];
  const answer = (status, body) => async (url, init = {}) => { seen.push({ url: String(url), method: init.method, headers: init.headers, body: init.body }); return new Response(JSON.stringify(body), { status }); };
  const make = (f) => D.makeDeps({ url: 'https://proj.supabase.co', serviceKey: 'fixture-service-key-not-real', rights: RIGHTS, now: () => NOW }, f);
  let deps = make(answer(200, [{ allowed: true, retry_after_seconds: 0, limited_by: null, limited_window_secs: null }]));
  const v = await deps.rateClaim?.(USER);
  ok(v?.allowed === true && seen.length === 1 && seen[0].url === 'https://proj.supabase.co/rest/v1/rpc/report_rate_claim' && seen[0].method === 'POST' && JSON.stringify(JSON.parse(seen[0].body)) === JSON.stringify({ p_user: USER }),
    '7a makeDeps wires rateClaim to POST /rest/v1/rpc/report_rate_claim with {p_user} and nothing else', seen[0]);
  ok(String(seen[0]?.headers?.Authorization || '').startsWith('Bearer ') && seen[0]?.headers?.apikey === 'fixture-service-key-not-real', '7b and it is sent with the service credentials, to the project\'s own URL');
  seen.length = 0;
  deps = make(answer(500, { message: 'boom' }));
  const got = await deps.rateClaim?.(USER).then(() => 'returned', (e) => (e instanceof DataUnavailable ? 'DataUnavailable' : 'other'));
  ok(got === 'DataUnavailable', '7c a 500 from the database is DataUnavailable through the real data layer (fail closed)', got);
  deps = make(async () => { throw new TypeError('network down'); });
  const net = await deps.rateClaim?.(USER).then(() => 'returned', (e) => (e instanceof DataUnavailable ? 'DataUnavailable' : 'other'));
  ok(net === 'DataUnavailable', '7d a network failure is DataUnavailable too', net);
  // the whole function over the real data layer: a refusal from the database becomes a 429 and the geocoder is never reached
  const seen2 = [];
  const fetchFn = async (url, init = {}) => {
    const u = new URL(url); seen2.push(u.pathname);
    if (u.pathname === '/rest/v1/rpc/report_rate_claim') return new Response(JSON.stringify([{ allowed: false, retry_after_seconds: 12, limited_by: 'brokerage', limited_window_secs: 60 }]), { status: 200 });
    throw new Error('unexpected request ' + u.pathname);
  };
  const real = D.makeDeps({ url: 'https://proj.supabase.co', serviceKey: 'fixture-service-key-not-real', rights: RIGHTS, now: () => NOW }, fetchFn);
  const handler = H.makeHandler({ ...real,
    authenticate: async () => ({ email: 'agent@example.test', id: USER }), isAdmin: async () => false,
    trialOf: async () => ({ status: 'active', credits_used: 0, credits_remaining: 20, expired: false }), planOf: async () => PLAN() });
  const res = await handler(new Request('https://x/functions/v1/get-development-activity-report', { method: 'POST', headers: { authorization: 'Bearer t', 'content-type': 'application/json' }, body: JSON.stringify(REQ) }));
  const body = await res.json().catch(() => null);
  ok(res.status === 429 && body?.error === 'rate_limited' && body?.limited_by === 'brokerage' && seen2.length === 1 && seen2[0] === '/rest/v1/rpc/report_rate_claim',
    '7e the real handler over the real data layer: the database says "full" and the request ends there - one call to the database, none to the geocoder or the canonical reads', [res.status, body, seen2]);
}

console.log('\n' + (n - bad) + ' passed, ' + bad + ' failed of ' + n);
process.exit(bad ? 1 : 0);
