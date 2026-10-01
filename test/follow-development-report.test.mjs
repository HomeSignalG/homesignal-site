// FOLLOW / CHANGES SINCE REPORT — the edge function (contract §6 gate 4).
// handler.ts (who may ask, what they may ask, what happens next) and data.ts (the reads and the one write) are exercised without
// Deno or a database: the handler through injected fakes that record every call, the data layer through a stub fetch that records
// every request it would send. The composition itself is test/changes-since-report.test.mjs; the end-to-end proof on a real database is
// test/changes_since_report_pg.
// Run: node test/follow-development-report.test.mjs
let n = 0, bad = 0;
const ok = (c, m, d) => { n++; if (c) console.log('PASS — ' + m); else { bad++; console.log('FAIL — ' + m + (d !== undefined ? '  [' + JSON.stringify(d) + ']' : '')); } };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const H = await import('../supabase/functions/follow-development-report/handler.ts');
const D = await import('../supabase/functions/follow-development-report/data.ts');
const RH = await import('../supabase/functions/get-development-activity-report/handler.ts');
const M = await import('../supabase/functions/_shared/national-report.ts');
const S = await import('../supabase/functions/_shared/report-snapshot.ts');

// ---- fixtures: a real report from the real engine -----------------------------------------------------------------------------------
const FAM = 'fam-a';
const RIGHTS = { version: 1, cleared: [{ registry_id: FAM, cleared_on: '2026-09-29', audit_ref: 'fixture', attribution: 'Data: A' }] };
const SUBJECT = { address: '742 Evergreen Terrace, Springfield, OR 97477', matched_address: '742 EVERGREEN TER, SPRINGFIELD, OR, 97477', lat: 44.04612, lng: -122.98123, zip: '97477', label: 'Homer client' };
const proj = (k, x = {}) => ({ source_key: k, registry_id: FAM, record_kind: 'development', name: 'Ravenna Bridge Retrofit', type: 'Utility', type_raw: null, status: 'Approved', stage: 'Advertised', developer: null, size: null, investment: null, submitted_at: '2026-09-24', date_kind: 'issued', address: '005 King', source_ref: 'https://example.gov/r/1', ...x });
const out = M.assemble({
  now: new Date('2026-09-29T12:00:00Z'), view: 'customer', zip_supported: true, radius_mi: 1, rights: RIGHTS, subject: SUBJECT,
  rows: [{ source_key: 'k1', feature_id: 'pt:1', registry_id: FAM, provenance: 'proven_stored_point', distance_mi: 0.31, geometry_type: 'Point', has_more: false },
         { source_key: 'k2', feature_id: 'pt:2', registry_id: FAM, provenance: 'proven_stored_point', distance_mi: 0.5, geometry_type: 'Point', has_more: false }],
  projects: [proj('k1'), proj('k2', { name: 'Weather Station' })],
  ledger: [{ identity_key: 'k1', registry_id: FAM, comparable: true, change_ready: true, observation_count: 2, first_observed_at: '2026-09-20T00:00:00Z', last_observed_at: '2026-09-29T00:00:00Z' }],
  events: [], health: [],
});
const REPORT_ID = '11111111-1111-4111-8111-111111111111';
const CONTEXT_ID = 'c0c0c0c0-2222-4222-8222-c0c0c0c0c0c0';
const ISSUED = '2026-09-29T12:00:05.000Z';
const NOW = new Date('2026-09-30T08:00:00Z');
const ROW = { report_id: REPORT_ID, content_hash: 'h'.repeat(64), report_version: M.REPORT_VERSION, generated_at: ISSUED, private_context_id: CONTEXT_ID, body: S.snapshotBodyOf(out.intelligence) };
const LEDGER = [{ identity_key: 'k1', registry_id: FAM, comparable: true, change_ready: true, observation_count: 3, first_observed_at: '2026-09-20T00:00:00Z', last_observed_at: '2026-09-30T06:00:00Z' }];
const EVENT = { identity_key: 'k1', event_type: 'status_changed', material: true, observed_at: '2026-09-30T06:30:00Z', created_at: '2026-09-30T06:35:00Z', prev_facts: { status: 'Approved' }, new_facts: { status: 'Operating' }, changed_fields: ['status'], publisher_event_type: null, publisher_event_date: null };
const FOLLOW_ID = '33333333-3333-4333-8333-333333333333';

/** Fakes that record every call, so a test can say what was NOT called. */
function fakes(over = {}) {
  const calls = [];
  const asked = {};
  const rec = (name, fn) => async (...a) => { calls.push(name); asked[name] = a; return fn(...a); };
  const deps = {
    now: () => NOW,
    rights: RIGHTS,
    newId: () => FOLLOW_ID,
    authenticate: rec('authenticate', async (t) => (t === 'user-token' ? { email: 'founder@example.com' } : null)),
    isAdmin: rec('isAdmin', async (e) => e === 'founder@example.com'),
    report: rec('report', async (id) => (id === REPORT_ID ? ROW : null)),
    ledger: rec('ledger', async () => LEDGER),
    eventsWrittenSince: rec('eventsWrittenSince', async () => [EVENT]),
    health: rec('health', async () => []),
    openFollow: rec('openFollow', async () => 'OPENED'),
    closeFollow: rec('closeFollow', async () => undefined),
    ...over,
  };
  return { deps, calls, asked };
}
const call = async (deps, body, headers = {}, method = 'POST') => {
  const h = H.makeHandler(deps);
  const init = { method, headers: { 'content-type': 'application/json', ...headers } };
  if (method === 'POST') init.body = typeof body === 'string' ? body : JSON.stringify(body);
  const res = await h(new Request('https://x.supabase.co/functions/v1/follow-development-report', init));
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, headers: res.headers, text, json };
};
const AUTH = { authorization: 'Bearer user-token' };
const CHANGES = { action: 'changes', report_id: REPORT_ID };

// ---- 1. who may ask: the SAME gate as the national report -----------------------------------------------------------------------
{
  let f = fakes();
  const noAuth = await call(f.deps, CHANGES);
  ok(noAuth.status === 401 && f.calls.length === 0, '1a no Authorization header: 401, and nothing was read');
  const anon = await call(f.deps, CHANGES, { authorization: 'Bearer public-anon-key' });
  ok(anon.status === 401 && f.calls.join() === 'authenticate', '1b THE PUBLIC ANON KEY: refused (401), and nothing beyond authentication ran');
  f = fakes({ authenticate: async () => ({ email: 'someone@example.com' }), isAdmin: async () => false });
  const notAdmin = await call(f.deps, CHANGES, AUTH);
  ok(notAdmin.status === 403 && notAdmin.json.error === 'forbidden', '1c a signed-in user who is not in dashboard_admins: 403');
  f = fakes({ isAdmin: async () => { throw new Error('boom'); } });
  const down = await call(f.deps, CHANGES, AUTH);
  ok(down.status === 502 && down.json.error === 'unavailable', '1d an allow-list read that fails is 502, never "allowed"');
  f = fakes();
  const bad1 = await call(f.deps, '{not json');
  ok(bad1.status === 401, '1e validation comes AFTER identity: an unauthenticated bad request is 401, not 400');
  // PARITY with the national report: the same six requests get the same status and body from both functions
  const rf = (over = {}) => ({
    now: () => NOW, rights: RIGHTS,
    authenticate: async (t) => (t === 'user-token' ? { email: 'founder@example.com' } : null), isAdmin: async (e) => e === 'founder@example.com',
    geocode: async () => null, zipSupported: async () => true, radius: async () => [], hydrate: async () => [], ledger: async () => [], events: async () => [], health: async () => [], ...over,
  });
  const scenarios = [
    [{}, {}], [{ authorization: 'Basic abc' }, {}], [{ authorization: 'Bearer ' }, {}], [{ authorization: 'Bearer public-anon-key' }, {}],
    [AUTH, { isAdmin: async () => false }], [AUTH, { isAdmin: async () => { throw new Error('x'); } }], [AUTH, { authenticate: async () => { throw new Error('x'); } }],
  ];
  let allSame = true; const diffs = [];
  for (const [headers, over] of scenarios) {
    const a = await call(fakes(over).deps, CHANGES, headers);
    const rh = RH.makeHandler(rf(over));
    const res = await rh(new Request('https://x.supabase.co/functions/v1/get-development-activity-report', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ address: '742 Evergreen Terrace' }) }));
    const bText = await res.text();
    if (a.status !== res.status || a.text !== bText) { allSame = false; diffs.push([a.status, res.status]); }
  }
  ok(allSame, '1f the gate answers identically in this function and in the national report for 7 sign-in scenarios: it is one gate, not two copies', diffs);
}

// ---- 2. what they may ask ---------------------------------------------------------------------------------------------------------------
{
  const refuse = async (label, body, detail) => {
    const f = fakes();
    const r = await call(f.deps, body, AUTH);
    ok(r.status === 400 && r.json.error === 'invalid_request' && f.calls.every((c) => c === 'authenticate' || c === 'isAdmin') && (detail === undefined || r.json.detail === detail),
      '2 ' + label + ': 400, and no report was read', [r.status, r.text, f.calls]);
  };
  await refuse('no action', { report_id: REPORT_ID }, 'action');
  await refuse('an unknown action', { action: 'delete', report_id: REPORT_ID }, 'action');
  await refuse('no report_id', { action: 'changes' }, 'report_id');
  await refuse('a report_id that is not a UUID', { action: 'changes', report_id: '1; drop table report_snapshot' }, 'report_id');
  await refuse('a report_id with a PostgREST operator in it', { action: 'changes', report_id: REPORT_ID + '&select=*' }, 'report_id');
  await refuse('an unknown field', { action: 'changes', report_id: REPORT_ID, address: '742 Evergreen Terrace' }, 'unknown field: address');
  await refuse('follow_id on a changes request', { action: 'changes', report_id: REPORT_ID, follow_id: FOLLOW_ID }, 'unknown field: follow_id');
  await refuse('view on a follow request', { action: 'follow', report_id: REPORT_ID, view: 'internal' }, 'unknown field: view');
  await refuse('unfollow with no follow_id', { action: 'unfollow', report_id: REPORT_ID }, 'follow_id');
  await refuse('a follow_id that is not a UUID', { action: 'follow', report_id: REPORT_ID, follow_id: 'homer@example.com' }, 'follow_id');
  await refuse('an unknown view', { action: 'changes', report_id: REPORT_ID, view: 'public' }, 'view');
  await refuse('a body that is an array', '[]');
  await refuse('a body that is not JSON', '{nope');
  const big = await call(fakes().deps, JSON.stringify({ action: 'changes', report_id: REPORT_ID, view: 'x'.repeat(5000) }), AUTH);
  ok(big.status === 413, '2 a body over 4,096 bytes: 413');
  const get = await call(fakes().deps, null, {}, 'GET');
  ok(get.status === 200 && get.json.stores_reports === false && get.json.reads_private_context === false, '2 GET answers the capability, which says it stores no reports and reads no private context');
  ok(same(get.json.writes, ['a follow need on a report\'s private context (follow, unfollow)']) && /dashboard_admins/.test(get.json.access) && /POST \{ action: "changes" \| "follow" \| "unfollow"/.test(get.json.method),
    '2 and says what it writes (a follow need, nothing else), who may call it, and how', get.json);
  const put = await call(fakes().deps, null, AUTH, 'PUT');
  ok(put.status === 405, '2 any other method is 405');
  const mixed = await call(fakes().deps, { action: 'changes', report_id: REPORT_ID.toUpperCase() }, AUTH);
  ok(mixed.status === 200 && mixed.json.status === 'OK', '2 an upper-case UUID is accepted and looked up in its lower-case form');
}

// ---- 3. changes ------------------------------------------------------------------------------------------------------------------------------
{
  const f = fakes();
  const r = await call(f.deps, CHANGES, AUTH);
  ok(r.status === 200 && r.json.status === 'OK' && r.json.result.answer === 'CHANGES_SINCE_REPORT', '3a a stored report answers with its changes since');
  ok(r.json.result.changed.length === 1 && r.json.result.changed[0].project_id === 'k1' && r.json.result.changed[0].changes_since_report[0].changes[0].to === 'Operating', '3b k1 changed since the report: status to Operating');
  ok(same(f.calls, ['authenticate', 'isAdmin', 'report', 'ledger', 'eventsWrittenSince', 'health']), '3c the reads, in order: the report, then the ledger, the events the ledger wrote since, the source health', f.calls);
  ok(!f.calls.includes('openFollow') && !f.calls.includes('closeFollow'), '3d and a changes request opens and closes nothing');
  ok(same(f.asked.ledger[0], ['k1', 'k2']) && same(f.asked.eventsWrittenSince[0], ['k1', 'k2']), '3e the ledger is asked about exactly the report\'s projects, sorted: k1, k2', f.asked.ledger[0]);
  ok(f.asked.eventsWrittenSince[1] === '2026-09-29T11:50:05.000Z', '3f the events are asked from ten minutes before the report was issued', f.asked.eventsWrittenSince[1]);
  ok(same(f.asked.health[0], [FAM]), '3g and the source health is asked for the report\'s source families only');
  ok(r.headers.get('cache-control') === 'no-store', '3h the response is never cacheable');
  // the DEFAULT view is the customer's: no rights label, no internal field. An explicit internal view labels each project.
  ok(!('rights' in r.json.result.changed[0]), '3h2 with no view given the answer is the customer view: no internal rights label on a project', r.json.result.changed[0]);
  const ri = await call(fakes().deps, { ...CHANGES, view: 'internal' }, AUTH);
  ok(ri.status === 200 && ri.json.result.changed[0].rights === 'CLEARED', '3h3 (control) an explicit internal view does label it, so the check above is real', ri.json.result.changed[0]);
  ok(!r.text.includes(CONTEXT_ID) && !/742 Evergreen|Homer client|44\.04612|122\.98123/.test(r.text), '3i the response carries no context id and nothing private');
  const nf = fakes();
  const missing = await call(nf.deps, { action: 'changes', report_id: '99999999-9999-4999-8999-999999999999' }, AUTH);
  ok(missing.status === 404 && missing.json.error === 'report_not_found' && !nf.calls.includes('ledger'), '3j an unknown report is 404 and no ledger read happens');
  const un = fakes({ report: async () => ({ ...ROW, body: 'not json' }) });
  const bad2 = await call(un.deps, CHANGES, AUTH);
  ok(bad2.status === 422 && bad2.json.error === 'report_unreadable' && !bad2.text.includes('not json') && !un.calls.includes('ledger'), '3k a report this reader cannot read is 422, never an empty answer, and nothing from its body is echoed');
  for (const which of ['ledger', 'eventsWrittenSince', 'health', 'report']) {
    const g = fakes({ [which]: async () => { throw new H.DataUnavailable('x'); } });
    const rr = await call(g.deps, CHANGES, AUTH);
    ok(rr.status === 502 && rr.json.error === 'data_unavailable' && rr.json.result === undefined, '3l a failed ' + which + ' read is 502 data_unavailable, never "no changes"');
  }
  const boom = fakes({ ledger: async () => { throw new Error('secret 742 Evergreen'); } });
  const rb = await call(boom.deps, CHANGES, AUTH);
  ok(rb.status === 500 && rb.json.error === 'internal' && !rb.text.includes('Evergreen'), '3m an unexpected error is 500 with no message');
  const noRights = fakes({ rights: { version: 1, cleared: [{ registry_id: '*', cleared_on: '2026-09-29', audit_ref: 'x', attribution: '' }] } });
  const rr2 = await call(noRights.deps, CHANGES, AUTH);
  ok(rr2.status === 500 && rr2.json.result === undefined, '3n a malformed rights registry fails the request');
  const none = fakes({ report: async () => ({ ...ROW, body: JSON.stringify({ ...JSON.parse(ROW.body), projects: [] }) }) });
  const rn = await call(none.deps, CHANGES, AUTH);
  ok(rn.status === 200 && rn.json.result.projects_in_report === 0 && !none.calls.includes('ledger') && !none.calls.includes('eventsWrittenSince') && !none.calls.includes('health'), '3o a report with no projects needs no ledger read at all');
  const withContextNull = fakes({ report: async () => ({ ...ROW, private_context_id: null }) });
  ok((await call(withContextNull.deps, CHANGES, AUTH)).status === 200, '3p a report with no private context answers normally: the reader never needed it');
}

// ---- 4. follow / unfollow ----------------------------------------------------------------------------------------------------------------
{
  let f = fakes();
  const r = await call(f.deps, { action: 'follow', report_id: REPORT_ID }, AUTH);
  ok(r.status === 200 && r.json.status === 'FOLLOWING' && r.json.follow_id === FOLLOW_ID && r.json.report_id === REPORT_ID, '4a follow registers a follow and returns its (minted) id');
  ok(same(f.asked.openFollow, [CONTEXT_ID, FOLLOW_ID]) && !f.calls.includes('ledger') && !f.calls.includes('eventsWrittenSince'), '4b it opens the need on the report\'s context with that id, and reads no ledger');
  ok(!r.text.includes(CONTEXT_ID), '4c the context\'s id never leaves the function');
  f = fakes();
  const given = '44444444-4444-4444-8444-444444444444';
  const again = await call(f.deps, { action: 'follow', report_id: REPORT_ID, follow_id: given }, AUTH);
  ok(again.json.follow_id === given && f.asked.openFollow[1] === given, '4d a caller-supplied follow_id is used as given (so a retry is idempotent)');
  f = fakes({ openFollow: async () => 'CONTEXT_PURGED' });
  const purged = await call(f.deps, { action: 'follow', report_id: REPORT_ID }, AUTH);
  ok(purged.status === 200 && purged.json.status === 'CONTEXT_PURGED' && purged.json.follow_id === undefined, '4e following a report whose context was purged says so: a purge is terminal and a follow cannot reopen it');
  f = fakes({ report: async () => ({ ...ROW, private_context_id: null }) });
  const nc = await call(f.deps, { action: 'follow', report_id: REPORT_ID }, AUTH);
  ok(nc.json.status === 'NO_PRIVATE_CONTEXT' && !f.calls.includes('openFollow'), '4f a report stored with no private context has nothing to follow');
  f = fakes();
  const un = await call(f.deps, { action: 'unfollow', report_id: REPORT_ID, follow_id: FOLLOW_ID }, AUTH);
  ok(un.json.status === 'UNFOLLOWED' && same(f.asked.closeFollow, [CONTEXT_ID, FOLLOW_ID]) && !f.calls.includes('openFollow'), '4g unfollow closes exactly that follow on the report\'s context');
  const miss = await call(fakes().deps, { action: 'unfollow', report_id: '99999999-9999-4999-8999-999999999999', follow_id: FOLLOW_ID }, AUTH);
  ok(miss.status === 404, '4h unfollowing an unknown report is 404');
  f = fakes({ openFollow: async () => { throw new H.DataUnavailable('x'); } });
  ok((await call(f.deps, { action: 'follow', report_id: REPORT_ID }, AUTH)).status === 502, '4i a write that fails is 502, never "following"');
  f = fakes({ closeFollow: async () => { throw new H.DataUnavailable('x'); } });
  ok((await call(f.deps, { action: 'unfollow', report_id: REPORT_ID, follow_id: FOLLOW_ID }, AUTH)).status === 502, '4i and an unfollow that fails is 502, never "unfollowed"');
  f = fakes({ report: async () => ({ ...ROW, private_context_id: null }) });
  ok((await call(f.deps, { action: 'unfollow', report_id: REPORT_ID, follow_id: FOLLOW_ID }, AUTH)).json.status === 'NO_PRIVATE_CONTEXT', '4j unfollow on a report with no context says so and closes nothing');
}

// ---- 5. the data layer ----------------------------------------------------------------------------------------------------------------------------
{
  const BASE = 'https://proj.supabase.co';
  const KEY = 'service-key-value';
  const reqs = [];
  const mk = (handlers) => D.makeDeps({ url: BASE + '/', serviceKey: KEY, rights: RIGHTS, now: () => NOW }, async (url, init) => {
    reqs.push({ url, init: init || {} });
    for (const [re, fn] of handlers) if (re.test(url)) return fn(url, init || {});
    return new Response('[]', { status: 200 });
  });
  const json = (v, status = 200) => new Response(JSON.stringify(v), { status });

  let d = mk([[/report_snapshot/, () => json([ROW])]]);
  const got = await d.report(REPORT_ID);
  const rq = reqs[0].url;
  ok(got.report_id === REPORT_ID && rq === BASE + '/rest/v1/report_snapshot?select=report_id,content_hash,report_version,generated_at,private_context_id,body&report_id=eq.' + REPORT_ID, '5a the report read names its columns and the one report', rq);
  ok(!/engine_inputs|address|latitude|longitude|property_key/.test(rq), '5a and selects no engine input and no private column');
  d = mk([[/report_snapshot/, () => json([])]]);
  ok(await d.report(REPORT_ID) === null, '5b no row is null (the handler answers 404), not an error');
  d = mk([]);
  ok(await d.report('not-a-uuid').then(() => false, (e) => e instanceof H.DataUnavailable), '5c a report id that is not a UUID is refused before any request is made');
  ok(reqs.filter((r) => r.url.includes('not-a-uuid')).length === 0, '5c and none was sent');

  reqs.length = 0;
  d = mk([]);
  await d.eventsWrittenSince(['k1', 'k"2'], '2026-09-29T11:50:05.000Z');
  const ev = reqs[0].url;
  ok(ev.includes('/rest/v1/dev_change_event_reportable?select=') && ev.includes('created_at&created_at=gt.2026-09-29T11%3A50%3A05.000Z') && !ev.includes('dev_change_event?'), '5d events the ledger wrote since are read from the reportable view, filtered on created_at, never the raw table', ev);
  ok(ev.includes('identity_key=in.' + encodeURIComponent('("k1","k\\"2")')), '5d and the keys are quoted and escaped', ev);
  ok(!/rights_class/.test(ev), '5d and rights_class is not selected');

  reqs.length = 0;
  d = mk([[/need_open/, () => new Response(null, { status: 204 })]]);
  ok(await d.openFollow(CONTEXT_ID, FOLLOW_ID) === 'OPENED', '5e opening a follow is OPENED');
  const op = reqs[0];
  ok(op.url === BASE + '/rest/v1/rpc/report_private_context_need_open' && op.init.method === 'POST' && same(JSON.parse(op.init.body), { p_context: CONTEXT_ID, p_kind: 'follow', p_ref: FOLLOW_ID }), '5e it calls the existing need-open function with kind follow and nothing else', op.init.body);
  d = mk([[/need_open/, () => json({ code: '55000', message: 'the context was purged' }, 500)]]);
  ok(await d.openFollow(CONTEXT_ID, FOLLOW_ID) === 'CONTEXT_PURGED', '5f the database\'s purged-context refusal (55000) is CONTEXT_PURGED, a normal outcome');
  d = mk([[/need_open/, () => json({ code: '23503', message: 'no such context' }, 409)]]);
  ok(await d.openFollow(CONTEXT_ID, FOLLOW_ID).then(() => false, (e) => e instanceof H.DataUnavailable), '5g any other refusal is DataUnavailable');
  d = mk([[/need_open/, () => { throw new Error('socket'); }]]);
  ok(await d.openFollow(CONTEXT_ID, FOLLOW_ID).then(() => false, (e) => e instanceof H.DataUnavailable), '5g and so is a network failure');
  reqs.length = 0;
  d = mk([[/need_close/, () => new Response(null, { status: 204 })]]);
  await d.closeFollow(CONTEXT_ID, FOLLOW_ID);
  ok(reqs[0].url === BASE + '/rest/v1/rpc/report_private_context_need_close' && same(JSON.parse(reqs[0].init.body), { p_context: CONTEXT_ID, p_kind: 'follow', p_ref: FOLLOW_ID }), '5h closing calls the existing need-close function with kind follow');
  d = mk([[/need_close/, () => json({ code: 'XX000' }, 500)]]);
  ok(await d.closeFollow(CONTEXT_ID, FOLLOW_ID).then(() => false, (e) => e instanceof H.DataUnavailable), '5h a failed close is DataUnavailable');

  reqs.length = 0;
  d = mk([]);
  await d.authenticate('t'); await d.isAdmin('a@b.com'); await d.report(REPORT_ID); await d.ledger(['k']); await d.eventsWrittenSince(['k'], '2026-01-01T00:00:00Z'); await d.health(['f']);
  await d.openFollow(CONTEXT_ID, FOLLOW_ID); await d.closeFollow(CONTEXT_ID, FOLLOW_ID);
  ok(reqs.length === 8 && reqs.every((r) => r.url.startsWith(BASE + '/')), '5i the service key is sent only to the project\'s own URL: every request went there', reqs.map((r) => r.url));
  ok(!reqs.some((r) => /report_private_context_read|report_private_context\?|report_private_context_purge|report_private_context_create/.test(r.url)), '5j and not one request touches the private context other than the need open and close: never the read, the table, the purge or the writer');
  ok(typeof d.newId() === 'string' && /^[0-9a-f-]{36}$/.test(d.newId()) && d.newId() !== d.newId(), '5k the follow id is a random UUID: two calls differ');

  // the ledger reads ask for the columns the shared rule decides on. A column missing from the SELECT arrives as undefined, and the rule
  // would read "not change-ready" for every project: an empty answer that looks like a quiet week.
  reqs.length = 0;
  d = mk([]);
  await d.ledger(['k1']); await d.health([FAM]);
  const sel = (u) => ((u.match(/select=([^&]+)/) || [])[1] || '').split(',');
  const lcols = sel(reqs[0].url), hcols = sel(reqs[1].url);
  ok(reqs[0].url.includes('/rest/v1/dev_change_project?select=') && ['identity_key', 'registry_id', 'comparable', 'change_ready', 'observation_count'].every((c) => lcols.includes(c)), '5l the ledger read selects identity_key, registry_id, comparable, change_ready and observation_count', lcols);
  ok(reqs[1].url.includes('/rest/v1/dev_change_source_health?select=') && ['registry_id', 'fetch_failures_24h', 'blocked_24h', 'truncated_24h'].every((c) => hcols.includes(c)), '5m the source-health read selects registry_id and the three 24 h counters', hcols);
}

console.log('\n' + (n - bad) + ' passed, ' + bad + ' failed of ' + n);
process.exit(bad ? 1 : 0);
