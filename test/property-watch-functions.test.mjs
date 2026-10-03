// PROPERTY WATCH, edge half (Development Activity build step 9) — offline.
//   supabase/functions/_shared/watch-reads.ts       the database calls and their refusals (the ONE place an edge function names them)
//   supabase/functions/manage-property-watch        an agent starts, lists and stops watching (signed-in)
//   supabase/functions/run-property-watch           the daily job: claims due watches, checks each, sends at most one email per watch
//   the real data layers of both, driven with a stubbed fetch so every request they would make is looked at
//
//   1. watch-reads: exact arguments, one named error per database refusal, a fault for any answer of the wrong shape (never "no watches");
//   2. manage: the gate, a closed field set per action, the three answers, never a context id / coordinate / label / other agent's watch;
//   3. run, the request: only the scheduler (a constant-time secret), and nothing works when no secret is configured; bounded body and limit;
//      a dry run leases, checks and sends nothing; the answer is counts;
//   4. run, one watch: standing is asked every time; a lost watch ends; an email is sent BEFORE anything is recorded as told, what is recorded
//      is exactly what the email listed, a retry carries the same idempotency key, a failure is recorded against the watch with its own name,
//      and the address, point, label and agent's email are in no recorded value, log line, response or email;
//   5. the real data layers.
// test/property-watch-changes.test.mjs proves the diff; test/property-watch-email.test.mjs proves the message; test/property_watch_pg proves the
// database half; test/property-watch-structure.test.mjs pins the structure. Run: node test/property-watch-functions.test.mjs
import { createHash } from 'node:crypto';

const M = await import('../supabase/functions/_shared/national-report.ts');
const S = await import('../supabase/functions/_shared/report-snapshot.ts');
const R = await import('../supabase/functions/_shared/watch-reads.ts');
const Svc = await import('../supabase/functions/_shared/service-rest.ts');
const E = await import('../supabase/functions/_shared/email-send.ts');
const CR = await import('../supabase/functions/_shared/changes-since-report.ts');
const MH = await import('../supabase/functions/manage-property-watch/handler.ts');
const MD = await import('../supabase/functions/manage-property-watch/data.ts');
const RH = await import('../supabase/functions/run-property-watch/handler.ts');
const RD = await import('../supabase/functions/run-property-watch/data.ts');
const PS = await import('../supabase/functions/_shared/private-subject.ts');

let n = 0, bad = 0;
const ok = (c, m, d) => { n++; if (c) console.log('PASS — ' + m); else { bad++; console.log('FAIL — ' + m + (d !== undefined ? '  [' + JSON.stringify(d) + ']' : '')); } };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const UID = 'a1111111-1111-4111-8111-111111111111';
const REPORT = 'b2222222-2222-4222-8222-222222222222';
const WATCH = 'c3333333-3333-4333-8333-333333333333';
const WATCH2 = 'c4444444-4444-4444-8444-444444444444';
const CTX = 'd4444444-4444-4444-8444-444444444444';
const KEY = 'service-key-xyz';
const SECRET = 'a-long-private-secret-for-the-scheduler';
const MAILKEY = 're_test_mail_key_123';
const AGENT_EMAIL = 'agent.one@example.test';

function rpcWith(table) {
  const calls = [];
  const rpc = async (fn, args) => { calls.push([fn, args]); const a = table[fn]; if (!a) throw new Svc.DataUnavailable('no script for ' + fn); return typeof a === 'function' ? a(args) : a; };
  return { rpc, calls };
}
const okRows = (rows) => ({ data: rows, error: null });
const refused = (message) => ({ data: null, error: { message } });
const noRest = async () => { throw new Error('rest must not be called'); };
const kind = async (f) => { try { await f(); return 'returned'; } catch (e) { return e.constructor.name; } };

// ---- 1. watch-reads ----------------------------------------------------------------------------------------------------------------------------
const WROW = { watch_id: WATCH, report_id: REPORT, number: 3, generated_at: '2026-09-29T12:00:05+00:00', private_context_id: CTX, created_at: '2026-10-01T09:00:00+00:00', last_run_at: null, last_outcome: null, next_due_at: '2026-10-02T09:00:00+00:00' };
{
  const { rpc, calls } = rpcWith({ evaluation_property_watch_start: okRows([{ watch_id: WATCH, created_at: '2026-10-01T09:00:00+00:00', started: true }]) });
  const w = await R.makeWatchReads(rpc, noRest).startWatch(UID, REPORT);
  ok(same(w, { watch_id: WATCH, created_at: '2026-10-01T09:00:00+00:00', started: true }) && same(calls, [['evaluation_property_watch_start', { p_user_id: UID, p_report_id: REPORT }]]),
    '1a start asks for exactly the person and the report, and returns the watch, when it began and whether this call began it');
  const go = (script, f) => kind(() => f(R.makeWatchReads(rpcWith(script).rpc, noRest)));
  ok(await go({ evaluation_property_watch_start: refused('NOT_FOUND') }, (r) => r.startWatch(UID, REPORT)) === 'WatchNotFound', '1b NOT_FOUND is WatchNotFound');
  ok(await go({ evaluation_property_watch_start: refused('WATCH_LIMIT_REACHED') }, (r) => r.startWatch(UID, REPORT)) === 'WatchLimitReached', '1c WATCH_LIMIT_REACHED is WatchLimitReached');
  ok(await go({ evaluation_property_watch_start: refused('PROPERTY_NOT_KEPT') }, (r) => r.startWatch(UID, REPORT)) === 'PropertyNotKept', '1d PROPERTY_NOT_KEPT is PropertyNotKept');
  ok(await go({ evaluation_property_watch_start: refused('canceling statement due to statement timeout') }, (r) => r.startWatch(UID, REPORT)) === 'DataUnavailable', '1e any other refusal is DataUnavailable: never a named answer');
  ok(await go({ evaluation_property_watch_start: okRows([]) }, (r) => r.startWatch(UID, REPORT)) === 'DataUnavailable', '1f a start that returns no row is a fault');
  ok(await go({ evaluation_property_watch_start: okRows([{ watch_id: WATCH, created_at: 'soon', started: true }]) }, (r) => r.startWatch(UID, REPORT)) === 'DataUnavailable', '1g and so is a row with a bad time');
  ok(await go({ evaluation_property_watch_start: okRows([{ watch_id: WATCH, created_at: '2026-10-01T09:00:00+00:00', started: 'yes' }]) }, (r) => r.startWatch(UID, REPORT)) === 'DataUnavailable', '1h and a started flag that is not a boolean');
  ok(await go({}, (r) => r.startWatch(UID, 'not-a-uuid')) === 'WatchNotFound', '1i a report id that is not a UUID never reaches the database');
}
{
  const list = (rows) => R.makeWatchReads(rpcWith({ evaluation_property_watches_of: okRows(rows) }).rpc, noRest).watchesOf(UID);
  const got = await list([WROW, { ...WROW, watch_id: WATCH2, last_run_at: '2026-10-02T09:00:30+00:00', last_outcome: 'NOTIFIED', number: null, private_context_id: null }]);
  ok(got.length === 2 && got[0].watch_id === WATCH && got[1].last_outcome === 'NOTIFIED' && got[1].number === null && got[1].private_context_id === null, '1j the list is read as the database gives it, including a purged context and a report with no number');
  const bads = [{ ...WROW, watch_id: 'x' }, { ...WROW, last_outcome: 'DONE' }, { ...WROW, next_due_at: 'tomorrow' }, { ...WROW, number: 1.5 }, { ...WROW, private_context_id: 'x' }, { ...WROW, last_run_at: 'x' }, null];
  let f = 0;
  for (const b of bads) { if (await kind(() => list([b])) === 'DataUnavailable') f++; }
  ok(f === bads.length, '1k a row of the wrong shape - a bad id, an unknown outcome, a bad time, a fractional number - is a fault and is never shown', f);
  ok(await kind(() => list(Array.from({ length: 201 }, () => WROW))) === 'DataUnavailable', '1l more than 200 rows is a fault (a list that long is not what this returns)');
  ok(await kind(() => R.makeWatchReads(rpcWith({ evaluation_property_watches_of: refused('boom') }).rpc, noRest).watchesOf(UID)) === 'DataUnavailable', '1m a list the database refuses is a fault, never an empty list (an empty list would say "no watches" about an agent who has some)');
  ok(await kind(() => list({})) === 'DataUnavailable', '1n an answer that is not a list is a fault');
}
{
  const stop = (script, id = WATCH) => kind(() => R.makeWatchReads(rpcWith(script).rpc, noRest).stopWatch(UID, id));
  ok(await stop({ evaluation_property_watch_stop: okRows(true) }) === 'returned', '1o a stop the database confirms returns');
  ok(await stop({ evaluation_property_watch_stop: refused('NOT_FOUND') }) === 'WatchNotFound', '1p a watch that is not theirs, unknown or already stopped is WatchNotFound');
  ok(await stop({ evaluation_property_watch_stop: okRows('yes') }) === 'DataUnavailable' && await stop({ evaluation_property_watch_stop: okRows(false) }) === 'DataUnavailable', '1q an answer that is not exactly true is a fault: a stop is never reported that did not happen');
  ok(await stop({ evaluation_property_watch_stop: refused('boom') }) === 'DataUnavailable', '1r any other refusal is a fault');
  ok(await stop({}, 'nope') === 'WatchNotFound', '1s a watch id that is not a UUID never reaches the database');
}
{
  const claimWith = (script, limit) => { const t = rpcWith(script); return { t, p: kind(() => R.makeWatchReads(t.rpc, noRest).claim(limit)) }; };
  const row = { watch_id: WATCH, report_id: REPORT, user_id: UID };
  const t = rpcWith({ property_watch_claim: okRows([row]) });
  const got = await R.makeWatchReads(t.rpc, noRest).claim(10);
  ok(same(got, [row]) && same(t.calls, [['property_watch_claim', { p_limit: 10 }]]), '1t a claim asks for the size and returns the three ids and nothing else');
  const leaky = rpcWith({ property_watch_claim: okRows([{ ...row, private_context_id: CTX, address: '1 Main St' }]) });
  ok(same(Object.keys((await R.makeWatchReads(leaky.rpc, noRest).claim(5))[0]).sort(), ['report_id', 'user_id', 'watch_id']), '1u whatever else a row carried is dropped: three fields');
  let refusedSizes = 0, called = 0;
  for (const bsz of [0, -1, 101, 1.5, '3', null, undefined, NaN]) {
    const c = claimWith({ property_watch_claim: () => { called++; return okRows([]); } }, bsz);
    if (await c.p === 'DataUnavailable') refusedSizes++;
  }
  ok(refusedSizes === 8 && called === 0, '1v a claim size that is not a whole number from 1 to 100 never reaches the database (eight values)', { refusedSizes, called });
  ok(await claimWith({ property_watch_claim: okRows([row, row, row]) }, 2).p === 'DataUnavailable', '1w more rows than asked for is a fault');
  ok(await claimWith({ property_watch_claim: okRows([{ ...row, user_id: 'x' }]) }, 2).p === 'DataUnavailable', '1x a row with a bad id is a fault');
  ok(await claimWith({ property_watch_claim: refused('boom') }, 2).p === 'DataUnavailable', '1y a refused claim is a fault, never "nothing is due"');
}
{
  const seenPaths = [];
  const rest = async (p) => { seenPaths.push(p); return [{ project_id: 'k1', event_type: 'status_changed', observed_at: '2026-10-01T06:30:00+00:00' }]; };
  const reads = R.makeWatchReads(rpcWith({}).rpc, rest);
  const got = await reads.seenOf(WATCH);
  ok(got.length === 1 && seenPaths[0] === 'property_watch_seen?select=project_id,event_type,observed_at&watch_id=eq.' + WATCH, '1z what the agent was told is read for exactly one watch, with exactly three columns');
  ok(await kind(() => reads.seenOf('not-a-uuid')) === 'DataUnavailable' && seenPaths.length === 1, '1z2 a watch id that is not a UUID is refused before any request');
  for (const bad of [{ project_id: 5, event_type: 'status_changed', observed_at: '2026-10-01T06:30:00Z' }, { project_id: 'k', event_type: 'made_up', observed_at: '2026-10-01T06:30:00Z' }, { project_id: 'k', event_type: 'status_changed', observed_at: 'x' }]) {
    const r = R.makeWatchReads(rpcWith({}).rpc, async () => [bad]);
    ok(await kind(() => r.seenOf(WATCH)) === 'DataUnavailable', '1z3 a told-about row of the wrong shape is a fault, never skipped (a skipped row would be told again): ' + JSON.stringify(bad).slice(0, 60));
  }
  const rec = rpcWith({ property_watch_record_run: okRows(true), property_watch_record_failure: okRows(false), property_watch_end: okRows(true) });
  const rr = R.makeWatchReads(rec.rpc, noRest);
  const told = [{ project_id: 'k1', event_type: 'status_changed', observed_at: '2026-10-01T06:30:00Z' }];
  ok(await rr.recordRun(WATCH, 'NOTIFIED', told) === true && await rr.recordFailure(WATCH, 'EMAIL_FAILED') === false && await rr.endWatch(WATCH, 'STANDING_LOST') === true
     && same(rec.calls, [['property_watch_record_run', { p_watch: WATCH, p_outcome: 'NOTIFIED', p_seen: told }], ['property_watch_record_failure', { p_watch: WATCH, p_outcome: 'EMAIL_FAILED' }], ['property_watch_end', { p_watch: WATCH, p_reason: 'STANDING_LOST' }]],
     ), '1z4 the three recorders send exactly the watch, the outcome and what was told, and return the database\'s true/false (false: the watch had been stopped meanwhile)');
  for (const f of [() => R.makeWatchReads(rpcWith({ property_watch_record_run: okRows('t') }).rpc, noRest).recordRun(WATCH, 'CHECKED', []),
                   () => R.makeWatchReads(rpcWith({ property_watch_record_failure: refused('x') }).rpc, noRest).recordFailure(WATCH, 'READ_FAILED'),
                   () => R.makeWatchReads(rpcWith({ property_watch_end: okRows(null) }).rpc, noRest).endWatch(WATCH, 'STANDING_LOST')]) {
    ok(await kind(f) === 'DataUnavailable', '1z5 a recorder whose answer is not a boolean, or is refused, is a fault - never assumed to have worked');
  }
}

// ---- 2. manage-property-watch -------------------------------------------------------------------------------------------------------------------------------
const mcalls = [];
function mdeps(over = {}) {
  const rec = (name, f) => async (...a) => { mcalls.push([name, ...a]); return f(...a); };
  return {
    authenticate: rec('authenticate', over.authenticate ?? (async () => ({ email: 'agent@example.test', id: UID }))),
    isAdmin: rec('isAdmin', over.isAdmin ?? (async () => false)),
    startWatch: rec('startWatch', over.startWatch ?? (async () => ({ watch_id: WATCH, created_at: '2026-10-01T09:00:00+00:00', started: true }))),
    watchesOf: rec('watchesOf', over.watchesOf ?? (async () => [])),
    stopWatch: rec('stopWatch', over.stopWatch ?? (async () => undefined)),
    addressOf: rec('addressOf', over.addressOf ?? (async () => '1 Centre Street, New York, NY 10007')),
  };
}
async function mask(d, body, { method = 'POST', auth = 'Bearer t', raw, origin } = {}) {
  mcalls.length = 0;
  const headers = { 'content-type': 'application/json' };
  if (auth) headers.authorization = auth;
  if (origin) headers.origin = origin;
  const init = { method, headers };
  if (method === 'POST') init.body = raw !== undefined ? raw : JSON.stringify(body);
  const res = await MH.makeHandler(d)(new Request('https://x/functions/v1/manage-property-watch', init));
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json, text, cache: res.headers.get('cache-control'), acao: res.headers.get('access-control-allow-origin') };
}
const mnamed = (name) => mcalls.filter((c) => c[0] === name);
const MUTATING = ['startWatch', 'watchesOf', 'stopWatch', 'addressOf'];
{
  let r = await mask(mdeps(), null, { method: 'GET', auth: null });
  ok(r.status === 200 && r.json.cadence === 'once a day' && r.cache === 'no-store' && mcalls.length === 0, '2a the capability states the daily cadence, is never cached and asks nothing of anyone');
  r = await mask(mdeps(), { action: 'list' }, { auth: null });
  ok(r.status === 401 && mcalls.length === 0, '2b no token: refused 401 and nothing was asked of anyone');
  r = await mask(mdeps({ authenticate: async () => null }), { action: 'list' });
  ok(r.status === 401 && MUTATING.every((x) => mnamed(x).length === 0), '2c the public anon key (no user): refused 401');
  r = await mask(mdeps({ authenticate: async () => ({ email: 'a@example.test' }) }), { action: 'list' });
  ok(r.status === 403 && MUTATING.every((x) => mnamed(x).length === 0), '2d a user with no id: refused 403');
  r = await mask(mdeps({ authenticate: async () => { throw new Svc.DataUnavailable('x'); } }), { action: 'list' });
  ok(r.status === 502 && MUTATING.every((x) => mnamed(x).length === 0), '2e an unreachable user lookup is 502, never "allowed"');
  r = await mask(mdeps(), null, { raw: 'x'.repeat(5000) });
  ok(r.status === 413 && MUTATING.every((x) => mnamed(x).length === 0), '2f a body over the cap is 413');
  r = await mask(mdeps(), null, { method: 'DELETE' });
  ok(r.status === 405, '2g any method but GET, POST and OPTIONS is 405');
}
{
  const cases = [
    [{ action: 'start', report_id: REPORT, daily: false }, 'a start cannot carry a schedule: the daily check is the founder\'s'],
    [{ action: 'start', report_id: REPORT, email: 'x@example.test' }, 'a start cannot carry an email address: the address comes from the account'],
    [{ action: 'start', report_id: REPORT, lat: 1, lng: 2 }, 'a start cannot carry a point: the point is the report\'s own private context'],
    [{ action: 'list', report_id: REPORT }, 'a list carries nothing else'],
    [{ action: 'stop', watch_id: WATCH, report_id: REPORT }, 'a stop carries a watch id and nothing else'],
    [{ action: 'start' }, 'a start needs a report id'],
    [{ action: 'stop', report_id: WATCH }, 'a stop needs a WATCH id'],
    [{ action: 'start', report_id: 'nope' }, 'a report id must be a UUID'],
    [{ action: 'stop', watch_id: 5 }, 'a watch id must be a string'],
    [{ action: 'frobnicate' }, 'an unknown action'],
    [{ action: 'constructor' }, 'an inherited property name is not an action'],
    [{ report_id: REPORT }, 'no action'],
    [[], 'an array body'],
    [null, 'a null body'],
  ];
  let all = true, touched = 0;
  for (const [body, why] of cases) {
    const r = await mask(mdeps(), body);
    touched += mcalls.filter((c) => MUTATING.includes(c[0])).length;
    if (!(r.status === 400 && r.json?.error === 'bad_request')) { all = false; console.log('   not refused: ' + why + ' → ' + r.status); }
  }
  ok(all && touched === 0, '2h every malformed or extra-field request is 400, and the database is never asked (14 cases)');
}
{
  let r = await mask(mdeps(), { action: 'start', report_id: REPORT.toUpperCase() });
  ok(r.status === 200 && same(r.json, { status: 'OK', watch_id: WATCH, started: true, created_at: '2026-10-01T09:00:00+00:00' }) && r.cache === 'no-store', '2i start answers the watch, whether this call began it and when, and nothing else; never cached');
  ok(same(mnamed('startWatch'), [['startWatch', UID, REPORT]]), '2j and asks for the SIGNED-IN person\'s id, never one the body supplied, and for the report id in lower case');
  r = await mask(mdeps({ startWatch: async () => ({ watch_id: WATCH, created_at: '2026-10-01T09:00:00+00:00', started: false }) }), { action: 'start', report_id: REPORT });
  ok(r.status === 200 && r.json.started === false, '2k watching again says it was already watching, and is not an error');
  const named = [[R.WatchNotFound, 404, 'not_found'], [R.WatchLimitReached, 409, 'watch_limit_reached'], [R.PropertyNotKept, 409, 'property_not_kept'], [Svc.DataUnavailable, 502, 'data_unavailable']];
  for (const [cls, status, code] of named) {
    r = await mask(mdeps({ startWatch: async () => { throw new cls('x'); } }), { action: 'start', report_id: REPORT });
    ok(r.status === status && r.json.error === code, '2l ' + cls.name + ' is ' + status + ' ' + code);
  }
  r = await mask(mdeps({ startWatch: async () => { throw new Error('boom with 1 Main St'); } }), { action: 'start', report_id: REPORT });
  ok(r.status === 500 && r.json.error === 'internal' && !r.text.includes('Main St'), '2m any other failure is 500 and its message is never shown');
}
{
  const rows = [
    { watch_id: WATCH, report_id: REPORT, number: 3, generated_at: '2026-09-29T12:00:05+00:00', private_context_id: CTX, created_at: '2026-10-01T09:00:00+00:00', last_run_at: '2026-10-02T09:00:30+00:00', last_outcome: 'NOTIFIED', next_due_at: '2026-10-03T09:00:00+00:00' },
    { watch_id: WATCH2, report_id: REPORT, number: null, generated_at: '2026-09-29T12:00:05+00:00', private_context_id: null, created_at: '2026-10-01T10:00:00+00:00', last_run_at: null, last_outcome: null, next_due_at: '2026-10-02T10:00:00+00:00' },
  ];
  const asked = [];
  const r = await mask(mdeps({ watchesOf: async () => rows, addressOf: async (c) => { asked.push(c); return c ? '1 Centre Street, New York, NY 10007' : null; } }), { action: 'list' });
  ok(r.status === 200 && r.json.watches.length === 2 && r.json.watches[0].address === '1 Centre Street, New York, NY 10007' && r.json.watches[1].address === null,
    '2n list answers each watch with its address while the private layer keeps it, and null once purged');
  ok(same(Object.keys(r.json.watches[0]).sort(), ['address', 'created_at', 'generated_at', 'last_outcome', 'last_run_at', 'next_due_at', 'number', 'report_id', 'watch_id']),
    '2o and nine fields: no context id, no point, no label, no agent, no email', Object.keys(r.json.watches[0]));
  ok(!r.text.includes(CTX) && !/context|latitude|longitude|label|user_id|email/i.test(r.text), '2p the context handle appears nowhere in the answer');
  ok(same(mnamed('watchesOf'), [['watchesOf', UID]]) && same(asked, [CTX, null]), '2q the list is the SIGNED-IN person\'s, and the address is read for each watch\'s own context handle');
  const failing = await mask(mdeps({ watchesOf: async () => rows, addressOf: async () => { throw new Svc.DataUnavailable('x'); } }), { action: 'list' });
  ok(failing.status === 502 && !failing.text.includes('watches'), '2r an address read that fails is 502 and returns NO list (half an answer is not given)');
  const stopped = await mask(mdeps(), { action: 'stop', watch_id: WATCH });
  ok(stopped.status === 200 && same(stopped.json, { status: 'OK', stopped: true }) && same(mnamed('stopWatch'), [['stopWatch', UID, WATCH]]), '2s stop answers stopped, for the SIGNED-IN person\'s id');
  const nf = await mask(mdeps({ stopWatch: async () => { throw new R.WatchNotFound('x'); } }), { action: 'stop', watch_id: WATCH });
  ok(nf.status === 404 && nf.json.error === 'not_found', '2t stopping a watch that is not theirs is 404');
  const admin = await mask(mdeps({ isAdmin: async () => true }), { action: 'start', report_id: REPORT });
  ok(admin.status === 200 && mnamed('startWatch').length === 1, '2u an admin is just a signed-in person here: the database decides, not the allow-list');
  let o = await mask(mdeps(), { action: 'list' }, { origin: 'https://evil.example' });
  ok(o.acao === null, '2v a foreign origin gets no CORS grant');
  o = await mask(mdeps(), { action: 'list' }, { origin: 'https://homesignal.net' });
  ok(o.acao === 'https://homesignal.net', '2w the site\'s own origin does');
}

// ---- 3 + 4. run-property-watch -----------------------------------------------------------------------------------------------------------------------------------
// The report is produced by the REAL engine, so the watch is proven against the shapes the engine writes.
const FAM = 'wsdot-project-delivery-plan-proposed';
const OTHER = 'a-source-with-no-clearance';
const RIGHTS = { version: 1, cleared: [{ registry_id: FAM, cleared_on: '2026-09-29', audit_ref: 'fixture', attribution: 'Data: WSDOT' }] };
const row = (k, d, x = {}) => ({ source_key: k, feature_id: 'pt:1', registry_id: FAM, provenance: 'proven_stored_point', distance_mi: d, geometry_type: 'Point', has_more: false, ...x });
const proj = (k, x = {}) => ({ source_key: k, registry_id: FAM, record_kind: 'development', name: 'Ravenna Bridge Retrofit', type: 'Utility', type_raw: null, status: 'Proposed', stage: 'Not Yet Advertised', developer: null, size: null, investment: null, submitted_at: '2026-09-12', date_kind: 'filed', address: '005 King', source_ref: 'https://data.wsdot.wa.gov/arcgis/rest/services/Shared/X/FeatureServer/0', ...x });
const led = (k, x = {}) => ({ identity_key: k, registry_id: FAM, comparable: true, change_ready: true, observation_count: 2, first_observed_at: '2026-09-20T19:00:00Z', last_observed_at: '2026-09-29T09:00:00Z', ...x });
const ev = (k, x = {}) => ({ identity_key: k, event_type: 'status_changed', material: true, observed_at: '2026-09-25T10:00:00Z', prev_facts: { status: 'Proposed' }, new_facts: { status: 'Approved' }, changed_fields: ['status'], publisher_event_type: 'issued', publisher_event_date: '2026-09-24', ...x });

// the PRIVATE values: unique markers, so any appearance anywhere is a leak
const PRIVATE_ADDRESS = '742 Evergreen Terrace, Springfield, OR 97477';
const PRIVATE_LABEL = 'Homer Simpson buyers';
const POINT = { lat: 44.04612345, lng: -122.98123456 };
const SUBJECT = { address: PRIVATE_ADDRESS, matched_address: PRIVATE_ADDRESS.toUpperCase(), lat: POINT.lat, lng: POINT.lng, zip: '97477', label: PRIVATE_LABEL };
const NOW_REPORT = new Date('2026-09-29T12:00:00Z');
const ISSUED = '2026-09-29T12:00:05.000Z';
const reportOut = M.assemble({ now: NOW_REPORT, view: 'customer', zip_supported: true, radius_mi: 0.5, rights: RIGHTS, subject: SUBJECT,
  rows: [row('k1', 0.21), row('k2', 0.37)], projects: [proj('k1', { status: 'Approved', date_kind: 'issued', submitted_at: '2026-09-24' }), proj('k2', { name: 'Weather Station Replacement', address: '520 King' })],
  ledger: [led('k1'), led('k2', { change_ready: false, observation_count: 1 })], events: [ev('k1', { created_at: '2026-09-25T10:05:00Z' })], health: [] });
const STORED_BODY = S.snapshotBodyOf(reportOut.intelligence);

const NOW = new Date('2026-10-02T08:00:00Z');
const AREA = {
  rows: [row('k1', 0.21), row('k2', 0.37), row('k3', 0.3), row('k4', 0.4, { registry_id: OTHER })],
  projects: [
    proj('k1', { status: 'Operating', date_kind: 'completed', submitted_at: '2026-10-01', stage: 'Complete' }),
    proj('k2', { name: 'Weather Station Replacement', address: '520 King' }),
    proj('k3', { name: 'Fremont Bike Lane Extension', address: '100 Fremont' }),
    proj('k4', { name: 'A Project From An Uncleared Source', registry_id: OTHER }),
  ],
  ledger: [led('k1'), led('k2'), led('k3', { first_observed_at: '2026-09-30T19:00:00Z' }), led('k4', { registry_id: OTHER })],
  events: [ev('k1', { created_at: '2026-09-25T10:05:00Z' })],
  health: [],
};
const wev = (k, created, x = {}) => ({ ...ev(k, { observed_at: '2026-10-01T06:30:00Z' }), created_at: created, ...x });
const E_K1 = wev('k1', '2026-10-01T06:35:00Z', { prev_facts: { stage: 'Approved' }, new_facts: { stage: 'Complete' }, changed_fields: ['stage'], publisher_event_type: 'completed', publisher_event_date: '2026-10-01' });
const E_K3 = wev('k3', '2026-10-01T07:00:00Z', { event_type: 'first_detected', observed_at: '2026-09-30T19:00:00Z', prev_facts: null, new_facts: { status: 'Proposed', stage: 'Not Yet Advertised' }, changed_fields: [], publisher_event_type: 'filed', publisher_event_date: '2026-09-12' });
const CLAIMED = { watch_id: WATCH, report_id: REPORT, user_id: UID };

const logs = [];
const origError = console.error;
const quietly = async (f) => { console.error = (...a) => { logs.push(a.map(String).join(' ')); }; try { return await f(); } finally { console.error = origError; } };

/** Fake deps over the engine fixture. `log` records every call, in order, with its arguments. */
function rdeps(over = {}) {
  const log = [];
  const rec = (name, f) => async (...a) => { log.push([name, ...a]); return f(...a); };
  const area = over.area ?? AREA;
  const d = {
    now: () => (over.now ?? NOW),
    rights: over.rights ?? RIGHTS,
    secret: over.secret ?? SECRET,
    emailConfigured: over.emailConfigured ?? true,
    claim: rec('claim', over.claim ?? (async () => [CLAIMED])),
    dueCount: rec('dueCount', over.dueCount ?? (async () => 4)),
    seenOf: rec('seenOf', over.seenOf ?? (async () => [])),
    recordRun: rec('recordRun', over.recordRun ?? (async () => true)),
    recordFailure: rec('recordFailure', over.recordFailure ?? (async () => true)),
    endWatch: rec('endWatch', over.endWatch ?? (async () => true)),
    openReport: rec('openReport', over.openReport ?? (async () => ({ report_id: REPORT, number: 3, generated_at: ISSUED, body: STORED_BODY, private_context_id: CTX }))),
    pointOf: rec('pointOf', over.pointOf ?? (async () => POINT)),
    radius: rec('radius', over.radius ?? (async () => area.rows)),
    hydrate: rec('hydrate', over.hydrate ?? (async () => area.projects)),
    ledger: rec('ledger', over.ledger ?? (async () => area.ledger)),
    events: rec('events', over.events ?? (async () => area.events)),
    health: rec('health', over.health ?? (async () => area.health)),
    eventsWrittenSince: rec('eventsWrittenSince', over.eventsWrittenSince ?? (async () => [E_K1, E_K3])),
    recipientOf: rec('recipientOf', over.recipientOf ?? (async () => AGENT_EMAIL)),
    send: rec('send', over.send ?? (async () => undefined)),
  };
  return { d, log };
}
const names = (log) => log.map((c) => c[0]);
const callOf = (log, name) => log.find((c) => c[0] === name);
async function run(d, body, { method = 'POST', headers, raw } = {}) {
  const init = { method, headers: { 'content-type': 'application/json', 'x-signup-secret': SECRET, ...(headers ?? {}) } };
  if (method === 'POST') init.body = raw !== undefined ? raw : JSON.stringify(body);
  const res = await RH.makeHandler(d)(new Request('https://x/functions/v1/run-property-watch', init));
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json, text };
}

// ---- 3. the request
{
  const { d, log } = rdeps();
  let r = await run(d, {}, { method: 'GET', headers: { 'x-signup-secret': '' } });
  ok(r.status === 200 && r.json.secret_configured === true && r.json.email_configured === true && !r.text.includes(SECRET) && log.length === 0,
    '3a the capability states whether the secret and the mail key are CONFIGURED, never either value, and asks nothing');
  r = await run(d, {}, { headers: { 'x-signup-secret': '' } });
  ok(r.status === 401 && names(log).length === 0, '3b no secret: refused 401 and nothing was claimed');
  r = await run(d, {}, { headers: { 'x-signup-secret': SECRET + 'x' } });
  ok(r.status === 401 && names(log).length === 0, '3c a wrong secret (one character too long): refused');
  r = await run(d, {}, { headers: { 'x-signup-secret': SECRET.slice(0, -1) } });
  ok(r.status === 401 && names(log).length === 0, '3d a wrong secret (one character short): refused');
  r = await run(d, {}, { headers: { 'x-signup-secret': SECRET.toUpperCase() } });
  ok(r.status === 401, '3e a secret in the wrong case: refused');
  const none = rdeps({ secret: '' });
  r = await run(none.d, {}, { headers: { 'x-signup-secret': '' } });
  const r2 = await run(none.d, {}, { headers: { 'x-signup-secret': 'anything' } });
  ok(r.status === 503 && r2.status === 503 && none.log.length === 0, '3f when NO secret is configured every request is refused, including one that sends an empty secret (a missing secret never reads as "no secret needed")');
  r = await run(d, {}, { method: 'PUT' });
  ok(r.status === 405, '3g any method but GET, POST and OPTIONS is 405');
  r = await run(d, null, { raw: 'x'.repeat(5000) });
  ok(r.status === 413 && log.length === 0, '3h a body over the cap is 413');
  const refusals = [[{ limit: 0 }, 'limit 0'], [{ limit: RH.MAX_LIMIT + 1 }, 'limit over the maximum'], [{ limit: 2.5 }, 'a fractional limit'], [{ limit: '5' }, 'a string limit'], [{ dry_run: 'yes' }, 'a string dry_run'],
    [{ dry_run: 1 }, 'a number dry_run'], [{ watch_id: WATCH }, 'an extra field (a run cannot be pointed at one watch)'], [{ email: 'x@example.test' }, 'an email field'], [[], 'an array'], [null, 'null']];
  let all = true;
  for (const [b, why] of refusals) { const x = await run(d, b); if (!(x.status === 400 && x.json?.error === 'bad_request')) { all = false; console.log('   not refused: ' + why + ' → ' + x.status); } }
  ok(all && log.length === 0, '3i every malformed request is 400 and nothing was claimed (10 cases)');
  r = await run(d, null, { raw: '{not json' });
  ok(r.status === 400 && log.length === 0, '3j a body that is not JSON is 400');
}
{
  const { d, log } = rdeps();
  const r = await run(d, { dry_run: true });
  ok(r.status === 200 && same(r.json, { status: 'OK', dry_run: true, due: 4, email_configured: true }) && same(names(log), ['dueCount']),
    '3k a dry run counts what is due and says whether mail is configured: it claims nothing, checks nothing, sends nothing');
}
{
  const { d, log } = rdeps();
  const r = await quietly(() => run(d, {}));
  ok(callOf(log, 'claim')[1] === RH.DEFAULT_LIMIT, '3l the default claim is ' + RH.DEFAULT_LIMIT + ' watches');
  const big = rdeps({ claim: async () => [] });
  await run(big.d, { limit: RH.MAX_LIMIT });
  ok(callOf(big.log, 'claim')[1] === RH.MAX_LIMIT, '3m and the caller may ask for up to ' + RH.MAX_LIMIT);
  ok(r.status === 200 && same(Object.keys(r.json).sort(), ['checked', 'claimed', 'dry_run', 'ended', 'failed', 'not_reached', 'notified', 'status']) && r.json.claimed === 1 && r.json.notified === 1,
    '3n the answer is counts and nothing else', Object.keys(r.json));
}
{
  // a watch is checked one at a time and the run stops starting new ones when its time is spent
  let t = NOW.getTime();
  const many = Array.from({ length: 5 }, (_, i) => ({ watch_id: 'c3333333-3333-4333-8333-33333333333' + i, report_id: REPORT, user_id: UID }));
  const { d, log } = rdeps({ claim: async () => many, openReport: async () => null });
  d.now = () => new Date(t);
  const origEnd = d.endWatch;
  d.endWatch = async (...a) => { t += 40_000; return origEnd(...a); };
  const r = await run(d, {});
  ok(r.json.claimed === 5 && r.json.ended + r.json.not_reached === 5 && r.json.not_reached >= 1 && r.json.ended >= 1, '3o the run stops starting watches after its time budget: the rest are counted as not reached', r.json);
}
{
  const down = rdeps({ claim: async () => { throw new Svc.DataUnavailable('claim'); } });
  let r = await quietly(() => run(down.d, {}));
  ok(r.status === 502 && r.json.error === 'data_unavailable', '3p a claim that cannot be made is 502');
  const odd = rdeps({ claim: async () => { throw new Error('boom at 742 Evergreen'); } });
  r = await quietly(() => run(odd.d, {}));
  ok(r.status === 500 && r.json.error === 'internal' && !r.text.includes('Evergreen'), '3q any other failure is 500 and its message is never shown');
}

// ---- 4. one watch
const RECORDING = ['recordRun', 'recordFailure', 'endWatch'];
{
  // a change is found: the order is the contract
  const { d, log } = rdeps();
  const r = await quietly(() => run(d, {}));
  const order = names(log);
  ok(order.indexOf('openReport') < order.indexOf('pointOf') && order.indexOf('pointOf') < order.indexOf('radius') && order.indexOf('radius') < order.indexOf('eventsWrittenSince')
     && order.indexOf('seenOf') < order.indexOf('recipientOf') && order.indexOf('recipientOf') < order.indexOf('send') && order.indexOf('send') < order.indexOf('recordRun'),
    '4a the order is: standing, the point, the area, the ledger, what was already told, the address, the EMAIL, and only then the record', order.join(' > '));
  const send = callOf(log, 'send'), rec = callOf(log, 'recordRun');
  ok(order.filter((x) => x === 'send').length === 1 && send[1].to === AGENT_EMAIL && send[1].from === 'HomeSignal <noreply@homesignal.net>', '4b exactly one email, to the agent\'s address, from the one From address');
  ok(/^watch-[0-9a-f]{64}$/.test(send[2]), '4c carrying an idempotency key', send[2]);
  ok(rec[1] === WATCH && rec[2] === 'NOTIFIED' && rec[3].length === 2 && same(rec[3].map((x) => x.project_id).sort(), ['k1', 'k3']), '4d what is recorded is the watch, NOTIFIED, and the two changes the email told');
  const flat = send[1].text;
  ok(flat.includes('Ravenna Bridge Retrofit') && flat.includes('Fremont Bike Lane Extension') && flat.includes('Stage: Approved → Complete'), '4e and the email names both projects and the change in the publisher\'s words');
  ok(r.status === 200 && r.json.notified === 1 && r.json.checked === 0 && r.json.failed === 0, '4f the run counts one notified watch', r.json);
  ok(!names(log).includes('endWatch') && !names(log).includes('recordFailure'), '4g and ended or failed nothing');
}
{
  // PRIVACY: nothing private reaches anything that is stored, sent, logged or returned
  const { d, log } = rdeps();
  logs.length = 0;
  const r = await quietly(() => run(d, {}));
  const everything = JSON.stringify([log.filter((c) => RECORDING.includes(c[0]) || c[0] === 'send'), r.text, logs]);
  const markers = [PRIVATE_ADDRESS, 'Evergreen', 'Springfield', PRIVATE_LABEL, 'Homer', String(POINT.lat), String(POINT.lng), '44.0461', '122.9812', CTX];
  const found = markers.filter((m) => everything.includes(m));
  ok(found.length === 0, '4h the address, the label, the point and the context handle appear in no email, no recorded value, no log line and no response (9 markers; the point was given to the check and used)', found);
  const toAll = JSON.stringify(log.filter((c) => RECORDING.includes(c[0]) || c[0] === 'send' || c[0] === 'seenOf' || c[0] === 'eventsWrittenSince'));
  ok(!toAll.includes(AGENT_EMAIL.split('@')[0]) || JSON.stringify(log.filter((c) => RECORDING.includes(c[0]))).includes(AGENT_EMAIL) === false, '4i the agent\'s email address is recorded nowhere: it goes to the mail provider and nowhere else');
  ok(logs.length === 0, '4j a clean run logs nothing at all', logs);
}
{
  // the point is used for the area read and NOTHING else
  const { d, log } = rdeps();
  await quietly(() => run(d, {}));
  const rad = callOf(log, 'radius');
  ok(rad[1] === POINT.lat && rad[2] === POINT.lng && rad[3] === 0.5, '4k the area is read at the property\'s point and the report\'s own radius');
  const others = log.filter((c) => c[0] !== 'radius' && c[0] !== 'pointOf').map((c) => JSON.stringify(c));
  ok(others.every((s) => !s.includes(String(POINT.lat)) && !s.includes(String(POINT.lng))), '4l and no other call is given the point');
  ok(callOf(log, 'openReport')[1] === UID && callOf(log, 'openReport')[2] === REPORT, '4m standing is asked for THIS agent and THIS report, by the same function that lets a member reopen a saved report');
  ok(callOf(log, 'hydrate')[1].join() === 'k1,k2,k3,k4' && callOf(log, 'eventsWrittenSince')[1].join() === 'k1,k2,k3', '4n the ledger is asked about exactly the projects a new report would show a customer (k4\'s source is not cleared)', callOf(log, 'eventsWrittenSince')[1]);
  ok(callOf(log, 'eventsWrittenSince')[2] === '2026-09-29T11:50:05.000Z', '4o since the report\'s own boundary', callOf(log, 'eventsWrittenSince')[2]);
}
{
  // nothing new
  const { d, log } = rdeps({ eventsWrittenSince: async () => [] });
  const r = await quietly(() => run(d, {}));
  const rec = callOf(log, 'recordRun');
  ok(rec && rec[2] === 'CHECKED' && rec[3].length === 0 && !names(log).includes('recipientOf') && !names(log).includes('send') && r.json.checked === 1, '4p nothing new: the check is recorded as CHECKED with nothing told, the agent\'s address is not even looked up, and no email is sent');
  const bad = [{ registry_id: FAM, fetch_failures_24h: 2, blocked_24h: 0, truncated_24h: 0 }];
  const partial = rdeps({ eventsWrittenSince: async () => [], health: async () => bad });
  await quietly(() => run(partial.d, {}));
  ok(callOf(partial.log, 'recordRun')[2] === 'CHECKED_PARTIAL' && callOf(partial.log, 'recordRun')[3].length === 0 && !names(partial.log).includes('send'),
    '4q nothing new but a source near the property failed to read in the last day: recorded CHECKED_PARTIAL - silence is a weaker answer - and still no email');
  const withNews = rdeps({ health: async () => bad });
  await quietly(() => run(withNews.d, {}));
  ok(callOf(withNews.log, 'recordRun')[2] === 'NOTIFIED' && /could not be fully read/.test(callOf(withNews.log, 'send')[1].text), '4q2 and when there is news AND a source failed, the email says what it found and says the check was not complete');
}
{
  // a change already told is not told again
  const told = [{ project_id: 'k1', event_type: 'status_changed', observed_at: '2026-10-01T06:30:00.000000+00:00' }, { project_id: 'k3', event_type: 'first_detected', observed_at: '2026-09-30T19:00:00+00:00' }];
  const { d, log } = rdeps({ seenOf: async () => told });
  const r = await quietly(() => run(d, {}));
  ok(callOf(log, 'recordRun')[2] === 'CHECKED' && !names(log).includes('send') && r.json.checked === 1, '4r a change the agent was already told (whatever timestamp text the database prints) is not told again: CHECKED, no email');
}
{
  // standing and the point
  const lost = rdeps({ openReport: async () => null });
  const r = await quietly(() => run(lost.d, {}));
  ok(same(names(lost.log), ['claim', 'openReport', 'endWatch']) && callOf(lost.log, 'endWatch')[2] === 'STANDING_LOST' && r.json.ended === 1,
    '4s an agent who no longer has standing (trial over, account suspended, left the brokerage): the watch ends and NOTHING else is read - no point, no area, no email', names(lost.log));
  const gone = rdeps({ pointOf: async () => null });
  await quietly(() => run(gone.d, {}));
  ok(callOf(gone.log, 'endWatch')[2] === 'PROPERTY_NOT_KEPT' && !names(gone.log).includes('radius') && !names(gone.log).includes('send'), '4t a property the private layer no longer keeps: the watch ends and the area is never read');
}
{
  // failures: each has its own name, none sends a thing as told
  const cases = [
    ['the area read fails', { radius: async () => { throw new Svc.DataUnavailable('x'); } }, 'READ_FAILED', false],
    ['the ledger read fails', { eventsWrittenSince: async () => { throw new Svc.DataUnavailable('x'); } }, 'READ_FAILED', false],
    ['what was told cannot be read', { seenOf: async () => { throw new Svc.DataUnavailable('x'); } }, 'READ_FAILED', false],
    ['the standing check fails', { openReport: async () => { throw new Svc.DataUnavailable('x'); } }, 'READ_FAILED', false],
    ['the private layer cannot be read', { pointOf: async () => { throw new Svc.DataUnavailable('x'); } }, 'READ_FAILED', false],
    ['the agent has no address', { recipientOf: async () => null }, 'NO_RECIPIENT', false],
    ['the account lookup says no such user', { recipientOf: async () => { throw new RH.NoRecipient('x'); } }, 'NO_RECIPIENT', false],
    ['the mail provider refuses', { send: async () => { throw new E.EmailFailed('http 422'); } }, 'EMAIL_FAILED', true],
    ['the stored body is not JSON', { openReport: async () => ({ report_id: REPORT, number: 3, generated_at: ISSUED, body: 'not json', private_context_id: CTX }) }, 'READ_FAILED', false],
    ['the stored body names no ZIP', { openReport: async () => ({ report_id: REPORT, number: 3, generated_at: ISSUED, body: '{"product":"x"}', private_context_id: CTX }) }, 'READ_FAILED', false],
    ['the rights registry is malformed', { rights: { nonsense: true } }, 'READ_FAILED', false],
  ];
  let allOk = true;
  for (const [why, over, outcome, sendTried] of cases) {
    const { d, log } = rdeps(over);
    logs.length = 0;
    const r = await quietly(() => run(d, {}));
    const fail = callOf(log, 'recordFailure');
    const good = fail && fail[1] === WATCH && fail[2] === outcome && !names(log).includes('recordRun') && !names(log).includes('endWatch') && r.json.failed === 1
      && (sendTried ? names(log).includes('send') : !names(log).includes('send'));
    if (!good) { allOk = false; console.log('   wrong for: ' + why + ' → ' + JSON.stringify([names(log), fail, r.json])); }
  }
  ok(allOk, '4u each failure is recorded against the watch under its own name (READ_FAILED, NO_RECIPIENT, EMAIL_FAILED), nothing is recorded as told, and the watch is not ended (11 cases)');
}
{
  // a failure the operator can read must not contain anything private
  const { d } = rdeps({ radius: async () => { throw new Svc.DataUnavailable('http 503'); } });
  logs.length = 0;
  await quietly(() => run(d, {}));
  const line = logs.join('\n');
  ok(logs.length === 1 && JSON.parse(logs[0]).stage === 'read' && JSON.parse(logs[0]).outcome === 'READ_FAILED' && JSON.parse(logs[0]).reason === 'http 503' && !line.includes(PRIVATE_ADDRESS) && !line.includes(String(POINT.lat)) && !line.includes(WATCH) && !line.includes(UID),
    '4v a failure is logged as one line: stage, outcome and a fixed reason - no watch id, no user id, no address, no point', logs);
  const odd = rdeps({ eventsWrittenSince: async () => { throw new Error('boom at 742 Evergreen Terrace ' + POINT.lat); } });
  logs.length = 0;
  const r = await quietly(() => run(odd.d, {}));
  ok(r.json.failed === 1 && !logs.join('').includes('Evergreen') && !logs.join('').includes(String(POINT.lat)) && JSON.parse(logs[0]).reason === 'Error', '4w and a failure of an unknown kind logs only its class, never its message (a message can carry whatever it was reading)', logs);
}
{
  // the failure of the failure record never ends the run
  const { d, log } = rdeps({ radius: async () => { throw new Svc.DataUnavailable('x'); }, recordFailure: async () => { throw new Svc.DataUnavailable('record'); }, claim: async () => [CLAIMED, { ...CLAIMED, watch_id: WATCH2 }] });
  const r = await quietly(() => run(d, {}));
  ok(r.status === 200 && r.json.failed === 2 && names(log).filter((x) => x === 'recordFailure').length === 2, '4x a failure that cannot even be recorded does not stop the run: the next watch is still checked');
}
{
  // EXACTLY ONCE: the email is accepted, the record fails; the retry carries the SAME key, so the provider sends nothing twice
  const first = rdeps({ recordRun: async () => { throw new Svc.DataUnavailable('record'); } });
  await quietly(() => run(first.d, {}));
  ok(names(first.log).includes('send') && callOf(first.log, 'recordFailure')[2] === 'READ_FAILED', '4y the email was accepted but recording it failed: the failure is recorded, and the changes stay untold');
  const second = rdeps();
  await quietly(() => run(second.d, {}));
  ok(callOf(first.log, 'send')[2] === callOf(second.log, 'send')[2], '4z so the retry\'s email carries the same idempotency key as the first (the provider answers a repeat with the first result)', [callOf(first.log, 'send')[2], callOf(second.log, 'send')[2]]);
  const k = (told) => E.idempotencyKeyFor(WATCH, told);
  const t1 = [{ project_id: 'k1', event_type: 'status_changed', observed_at: '2026-10-01T06:30:00Z' }];
  const t2 = [{ project_id: 'k3', event_type: 'first_detected', observed_at: '2026-09-30T19:00:00Z' }];
  ok(await k(t1) === await k([{ project_id: 'k1', event_type: 'status_changed', observed_at: '2026-10-01T06:30:00.000000+00:00' }]) && await k(t1) !== await k(t2) && await k(t1) !== await E.idempotencyKeyFor(WATCH2, t1) && await k([...t1, ...t2]) === await k([...t2, ...t1]),
    '4aa the key depends on the watch and on WHAT is told (by instant, not by timestamp text, and in any order) - a different set of changes is a different key');
}
{
  // THE CAP, end to end: twelve new projects; the email lists ten; exactly those ten are recorded; the other two come in the next email
  const keys = Array.from({ length: 12 }, (_, i) => 'n' + String(i + 1).padStart(2, '0'));
  const area = {
    rows: keys.map((k, i) => row(k, 0.1 + i * 0.01)),
    projects: keys.map((k, i) => proj(k, { name: 'New Project ' + k, address: i + ' Main', stage: 'Not Yet Advertised' })),
    ledger: keys.map((k) => led(k, { first_observed_at: '2026-09-30T19:00:00Z' })),
    events: [], health: [],
  };
  const written = keys.map((k, i) => wev(k, '2026-10-01T0' + (i % 9) + ':00:00Z', { event_type: 'first_detected', observed_at: '2026-09-30T19:00:00Z', prev_facts: null, new_facts: { status: 'Proposed' }, changed_fields: [], publisher_event_type: 'filed', publisher_event_date: '2026-09-12' }));
  const told = [];
  const mk = () => rdeps({ area, eventsWrittenSince: async () => written, seenOf: async () => told.slice() });
  const a = mk();
  await quietly(() => run(a.d, {}));
  const recA = callOf(a.log, 'recordRun'), sendA = callOf(a.log, 'send');
  const listedA = keys.filter((k) => sendA[1].text.includes('New Project ' + k));
  ok(listedA.length === 10 && recA[3].length === 10 && same(recA[3].map((x) => x.project_id).sort(), listedA), '4ab twelve new projects: the first email lists ten and exactly those ten are recorded as told - not eleven, not twelve', { listed: listedA.length, told: recA[3].length });
  ok(/2 more changes will be in your next email/.test(sendA[1].text), '4ac and says that two more will follow');
  told.push(...recA[3]);
  const b = mk();
  await quietly(() => run(b.d, {}));
  const recB = callOf(b.log, 'recordRun'), sendB = callOf(b.log, 'send');
  const listedB = keys.filter((k) => sendB[1].text.includes('New Project ' + k));
  ok(listedB.length === 2 && !listedB.some((k) => listedA.includes(k)) && recB[3].length === 2, '4ad the next run lists the two that did not fit, and none of the ten again');
  told.push(...recB[3]);
  const c = mk();
  await quietly(() => run(c.d, {}));
  ok(callOf(c.log, 'recordRun')[2] === 'CHECKED' && !names(c.log).includes('send'), '4ae and the run after that has nothing to say: all twelve were told, each exactly once');
}

// ---- 5. the real data layers ----------------------------------------------------------------------------------------------------------------------------------
const json = (v, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
function stub(routes) {
  const reqs = [];
  const f = async (url, init) => {
    reqs.push({ url: String(url), method: init?.method ?? 'GET', headers: init?.headers ?? {}, body: init?.body ? JSON.parse(init.body) : null });
    for (const [re, fn] of routes) if (re.test(String(url))) return fn(init);
    return new Response('{}', { status: 404 });
  };
  return { f, reqs };
}
const CFG = { url: 'https://proj.supabase.co', serviceKey: KEY };
{
  const { f, reqs } = stub([
    [/auth\/v1\/user$/, () => json({ id: UID, email: 'agent@example.test' })],
    [/dashboard_admins/, () => json([])],
    [/rpc\/evaluation_property_watch_start$/, () => json([{ watch_id: WATCH, created_at: '2026-10-01T09:00:00+00:00', started: true }])],
    [/rpc\/evaluation_property_watches_of$/, () => json([WROW])],
    [/rpc\/report_private_context_read$/, () => json([{ state: 'active', address: PRIVATE_ADDRESS, label: PRIVATE_LABEL, normalized_address: 'X', latitude: POINT.lat, longitude: POINT.lng, property_keys: ['k'] }])],
    [/rpc\/evaluation_property_watch_stop$/, () => json(true)],
  ]);
  const h = MH.makeHandler(MD.makeDeps(CFG, f));
  const post = (b) => h(new Request('https://x/', { method: 'POST', headers: { authorization: 'Bearer user-jwt' }, body: JSON.stringify(b) }));
  const started = await (await post({ action: 'start', report_id: REPORT })).json();
  const listedRes = await post({ action: 'list' });
  const listedText = await listedRes.text();
  await post({ action: 'stop', watch_id: WATCH });
  const start = reqs.find((r) => /evaluation_property_watch_start$/.test(r.url));
  ok(started.started === true && start.body.p_user_id === UID && start.body.p_report_id === REPORT && Object.keys(start.body).length === 2, '5a the real manage function: the signed-in person\'s id comes from the verified token, and a start sends the person and the report only');
  const listed = JSON.parse(listedText);
  ok(listed.watches[0].address === PRIVATE_ADDRESS && !listedText.includes(PRIVATE_LABEL) && !listedText.includes(String(POINT.lat)) && !listedText.includes(String(POINT.lng)) && !listedText.includes('property_keys'),
    '5b the list shows the address while the layer keeps it and does NOT show the label, the coordinates or the keys, though the private layer returned all of them');
  const fns = reqs.map((r) => r.url.split('/').pop()).filter((x) => /^(evaluation_property|report_private)/.test(x)).sort().join(',');
  ok(fns === 'evaluation_property_watch_start,evaluation_property_watch_stop,evaluation_property_watches_of,report_private_context_read', '5c exactly the three watch functions and the private layer\'s reader', fns);
  ok(reqs.every((r) => /\/auth\/v1\/user$|\/rest\/v1\/dashboard_admins\?|\/rest\/v1\/rpc\/(evaluation_property_watch|report_private_context_read)/.test(r.url)) && reqs.every((r) => !/auth\/v1\/user$/.test(r.url) || r.headers.Authorization === 'Bearer user-jwt'),
    '5d and nothing else: no table is read, the snapshot and the ledger are not touched', reqs.map((r) => r.url));
}
{
  // the daily job's real data layer
  const sent = [];
  const { f, reqs } = stub([
    [/auth\/v1\/admin\/users\/[0-9a-f-]{36}$/, () => json({ id: UID, email: '  ' + AGENT_EMAIL + ' ', user_metadata: { name: 'Agent One' } })],
    [/api\.resend\.com\/emails$/, (init) => { sent.push(init); return json({ id: 'msg_1' }); }],
    [/property_watch\?select=watch_id/, () => json([{ watch_id: WATCH }, { watch_id: WATCH2 }])],
  ]);
  const deps = RD.makeDeps({ ...CFG, rights: RIGHTS, secret: SECRET, resendKey: MAILKEY, now: () => NOW }, f);
  ok(deps.emailConfigured === true && deps.secret === SECRET, '5e the data layer carries the configuration it was given');
  const to = await deps.recipientOf(UID);
  const lookup = reqs.find((r) => /auth\/v1\/admin\/users/.test(r.url));
  ok(to === AGENT_EMAIL && lookup.url === 'https://proj.supabase.co/auth/v1/admin/users/' + UID && lookup.headers.Authorization === 'Bearer ' + KEY && lookup.method === 'GET', '5f the agent\'s address is read from the auth service, by id, with the service key, and returned trimmed');
  ok(await kind(() => deps.recipientOf('nope')) === 'DataUnavailable' && reqs.length === 1, '5g an id that is not a UUID makes no request');
  const miss = RD.makeDeps({ ...CFG, rights: RIGHTS, secret: SECRET, resendKey: MAILKEY }, stub([[/auth\/v1\/admin\/users/, () => json({}, 404)]]).f);
  const down = RD.makeDeps({ ...CFG, rights: RIGHTS, secret: SECRET, resendKey: MAILKEY }, stub([[/auth\/v1\/admin\/users/, () => json({}, 500)]]).f);
  const nomail = RD.makeDeps({ ...CFG, rights: RIGHTS, secret: SECRET, resendKey: MAILKEY }, stub([[/auth\/v1\/admin\/users/, () => json({ email: 'not an address' })]]).f);
  ok(await kind(() => miss.recipientOf(UID)) === 'NoRecipient' && await kind(() => down.recipientOf(UID)) === 'DataUnavailable' && (await nomail.recipientOf(UID)) === null,
    '5h no such user is NoRecipient, an auth service that fails is DataUnavailable (never "no address"), and an address that cannot be mailed is null');
  await deps.send({ from: 'HomeSignal <noreply@homesignal.net>', to: AGENT_EMAIL, subject: 'S', text: 'T', html: '<p>H</p>' }, 'watch-abc');
  const mail = reqs.find((r) => /api\.resend\.com/.test(r.url));
  ok(mail.url === 'https://api.resend.com/emails' && mail.method === 'POST' && mail.headers.Authorization === 'Bearer ' + MAILKEY && mail.headers['Idempotency-Key'] === 'watch-abc'
     && same(mail.body.to, [AGENT_EMAIL]) && mail.body.from === 'HomeSignal <noreply@homesignal.net>', '5i an email is one POST to the mail provider with the mail key, the idempotency key and one recipient');
  ok(!JSON.stringify(reqs.filter((r) => !/api\.resend\.com/.test(r.url))).includes(MAILKEY) && !JSON.stringify(mail).includes(KEY), '5j the mail key goes only to the mail provider and the service key never does');
  for (const [status, label] of [[422, 'http 422'], [429, 'http 429'], [500, 'http 500']]) {
    const bad = RD.makeDeps({ ...CFG, rights: RIGHTS, secret: SECRET, resendKey: MAILKEY }, stub([[/api\.resend\.com/, () => json({ message: 'invalid to ' + AGENT_EMAIL, name: 'validation_error' }, status)]]).f);
    let msg = null;
    try { await bad.send({ from: 'x', to: AGENT_EMAIL, subject: 's', text: 't', html: 'h' }, 'k'); } catch (e) { msg = e instanceof E.EmailFailed ? e.message : 'wrong class'; }
    ok(msg === label, '5k a provider refusal is EmailFailed with a fixed reason (' + label + '), never the provider\'s text (which echoes the recipient)', msg);
  }
  const unreachable = RD.makeDeps({ ...CFG, rights: RIGHTS, secret: SECRET, resendKey: MAILKEY }, async () => { throw new Error('connect ECONNREFUSED'); });
  ok(await kind(() => unreachable.send({ from: 'x', to: AGENT_EMAIL, subject: 's', text: 't', html: 'h' }, 'k')) === 'EmailFailed', '5l a provider that cannot be reached is EmailFailed');
  const nokey = RD.makeDeps({ ...CFG, rights: RIGHTS, secret: SECRET, resendKey: '' }, f);
  const before = reqs.length;
  ok(nokey.emailConfigured === false && await kind(() => nokey.send({ from: 'x', to: AGENT_EMAIL, subject: 's', text: 't', html: 'h' }, 'k')) === 'EmailFailed' && reqs.length === before, '5m with no mail key nothing is sent, and the data layer says it is not configured');
  ok(await kind(() => deps.send({ from: 'x', to: 'not an address', subject: 's', text: 't', html: 'h' }, 'k')) === 'EmailFailed' && reqs.filter((r) => /resend/.test(r.url)).length === 1, '5n an address that cannot be mailed is refused before any request');
  ok(await deps.dueCount() === 2 && /property_watch\?select=watch_id&limit=101&next_due_at=lte\.2026-10-02T08%3A00%3A00\.000Z$/.test(reqs.at(-1).url), '5o the dry run counts the watches due now, reading at most 101 rows and writing nothing');
}
{
  // the engine reads the run uses are the SAME reads the report uses
  const { f, reqs } = stub([
    [/rpc\/n5_projects_within_radius$/, () => json([row('k1', 0.2)])],
    [/app_projects\?/, () => json([proj('k1')])],
    [/dev_change_project\?/, () => json([led('k1')])],
  ]);
  const deps = RD.makeDeps({ ...CFG, rights: RIGHTS, secret: SECRET, resendKey: MAILKEY, now: () => NOW }, f);
  await deps.radius(44.1, -122.9, 0.5);
  const rad = reqs[0];
  ok(rad.url.endsWith('/rest/v1/rpc/n5_projects_within_radius') && same(rad.body, { p_lat: 44.1, p_lng: -122.9, p_radius_mi: 0.5, p_limit: 1000 }), '5p the area is the canonical spatial read with the report\'s own limit');
  await deps.hydrate(['k1']);
  await deps.ledger(['k1']);
  ok(reqs.some((r) => /app_projects\?select=/.test(r.url)) && reqs.some((r) => /dev_change_project\?/.test(r.url)), '5q and the projects and the ledger are the report\'s own tables');
}

// ---- 6. found by the mutation loop: a malformed rights registry, and the private layer's point window ----------------------------------------------
{
  // a rights registry that cannot be read must fail the check, never read as "everything is cleared"
  const { d, log } = rdeps({ rights: { version: 1, cleared: 'everything' } });
  const r = await quietly(() => run(d, {}));
  const fail = callOf(log, 'recordFailure');
  ok(r.status === 200 && r.json.failed === 1 && r.json.notified === 0 && fail && fail[1] === WATCH && fail[2] === 'READ_FAILED' && !names(log).includes('send') && !names(log).includes('recordRun'),
    '6a a malformed rights registry fails the check (READ_FAILED, nothing sent, nothing recorded as told) instead of clearing every source', { status: r.status, json: r.json, order: names(log).join(',') });
}
{
  const read = (row) => PS.makePrivateSubjectReads(rpcWith({ report_private_context_read: okRows(row === undefined ? [] : [row]) }).rpc);
  const ACTIVE = { state: 'active', address: PRIVATE_ADDRESS, label: PRIVATE_LABEL, latitude: 44.04612345, longitude: -122.98123456 };
  const point = await read(ACTIVE).pointOf(CTX);
  ok(same(point, { lat: 44.04612345, lng: -122.98123456 }) && !Object.keys(point).some((k) => k !== 'lat' && k !== 'lng'), '6b the point window returns the point and nothing else: no address, no label, no other column');
  const { rpc, calls } = rpcWith({ report_private_context_read: okRows([ACTIVE]) });
  await PS.makePrivateSubjectReads(rpc).pointOf(CTX);
  ok(same(calls, [['report_private_context_read', { p_context: CTX }]]), '6c it makes the one read, by the context handle and nothing else');
  ok(await read(ACTIVE).pointOf(null) === null && (await kind(() => PS.makePrivateSubjectReads(rpcWith({}).rpc).pointOf(null))) === 'returned', '6d no context handle: no point, and no database call');
  ok(await read({ ...ACTIVE, state: 'purged', latitude: null, longitude: null }).pointOf(CTX) === null, '6e a purged context has no point');
  ok(await read({ ...ACTIVE, state: 'purged' }).pointOf(CTX) === null, '6f and a purged context returns no point even if a coordinate were still in the row');
  ok(await read({ ...ACTIVE, latitude: null, longitude: null }).pointOf(CTX) === null, '6g an active context that holds no point has no point (the watch ends: nothing to look near)');
  ok(await read(undefined).pointOf(CTX) === null, '6h an unknown context has no point');
  const bad = [{ latitude: 44.0, longitude: null }, { latitude: null, longitude: -122.9 }, { latitude: NaN, longitude: -122.9 }, { latitude: 44.0, longitude: Infinity }, { latitude: '44.0', longitude: '-122.9' },
    { latitude: 91, longitude: -122.9 }, { latitude: -91, longitude: -122.9 }, { latitude: 44.0, longitude: 181 }, { latitude: 44.0, longitude: -181 }, { latitude: undefined, longitude: -122.9 }, { latitude: undefined, longitude: undefined }];
  let faults = 0; const missed = [];
  for (const b of bad) { if (await kind(() => read({ ...ACTIVE, ...b }).pointOf(CTX)) === 'DataUnavailable') faults++; else missed.push(b); }
  ok(faults === bad.length, '6i a half point, a non-number, a non-finite number or a point off the globe is a fault, never "somewhere"', missed);
  ok(await kind(() => PS.makePrivateSubjectReads(rpcWith({ report_private_context_read: refused('boom') }).rpc).pointOf(CTX)) === 'DataUnavailable'
     && await kind(() => PS.makePrivateSubjectReads(rpcWith({ report_private_context_read: { data: null, error: null } }).rpc).pointOf(CTX)) === 'DataUnavailable'
     && await kind(() => PS.makePrivateSubjectReads(rpcWith({ report_private_context_read: okRows([ACTIVE, ACTIVE]) }).rpc).pointOf(CTX)) === 'returned',
    '6j a read the database refuses or answers oddly is a fault, never "no point"; (control) more than one row is read as no context, as the display windows do');
}

{
  // the RUN-level failure (the lease itself fails): the same promise, one level up - the answer is a fixed word and the log carries a class, never a message
  const { d } = rdeps({ claim: async () => { throw new Error('boom while reading 742 Evergreen Terrace ' + CTX); } });
  logs.length = 0;
  const r = await quietly(() => run(d, {}));
  const line = logs.length === 1 ? JSON.parse(logs[0]) : null;
  ok(r.status === 500 && r.json.error === 'internal' && line && line.stage === 'run' && line.status === 500 && line.reason === 'Error' && !logs.join('').includes('Evergreen') && !logs.join('').includes(CTX) && !r.text.includes('Evergreen'),
    '6k a run that fails before any watch is reached answers 500 internal and logs only its class (never the message, which can carry what it was reading)', { status: r.status, logs });
  const known = rdeps({ claim: async () => { throw new Svc.DataUnavailable('property_watch_claim'); } });
  logs.length = 0;
  const r2 = await quietly(() => run(known.d, {}));
  ok(r2.status === 502 && r2.json.error === 'data_unavailable' && logs.length === 1 && JSON.parse(logs[0]).reason === 'property_watch_claim', '6l and a database fault answers 502 data_unavailable and logs its own fixed reason', { status: r2.status, logs });
}

console.log('\n' + (n - bad) + ' of ' + n + ' passed');
if (bad) process.exit(1);
