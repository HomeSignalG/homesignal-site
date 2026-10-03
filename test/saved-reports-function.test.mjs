// SAVED REPORTS — the report function's `list` and `open` actions (Development Activity build step 6), offline.
// The handler is driven through injected fakes that record every call, so a test can say what was NOT called; the data layer through a
// stub fetch that records every request it would send. What is proven here:
//   1. who may ask: only a trial member (active OR complete); an admin, a person with no trial and an ended trial are refused;
//   2. the request: only `list`, or `open` with a UUID `report_id`; nothing else is accepted alongside;
//   3. what is read: a list or an open reaches NEITHER the geocoder, NOR the spatial read, NOR the credit rule, NOR the issue function;
//   4. what comes back: the stored report as stored, never a render block, never charged, never an internal handle;
//   5. a report that is not the caller's brokerage's is "not found", the same for an unknown id;
//   6. the shared module and the data layer: exact requests, exact shapes, and a different id or a second row is a fault;
//   7. a trial that is complete still cannot MAKE a report.
// test/trial_report_pg drives the same handler and data layer against the real SQL.
// Run: node test/saved-reports-function.test.mjs
let n = 0, bad = 0;
const ok = (c, m, d) => { n++; if (c) console.log('PASS — ' + m); else { bad++; console.log('FAIL — ' + m + (d !== undefined ? '  [' + JSON.stringify(d) + ']' : '')); } };

const H = await import('../supabase/functions/get-development-activity-report/handler.ts');
const D = await import('../supabase/functions/get-development-activity-report/data.ts');
const E = await import('../supabase/functions/_shared/evaluation-reads.ts');
const { DataUnavailable } = await import('../supabase/functions/_shared/service-rest.ts');

const UID = 'a1111111-1111-4111-8111-111111111111';
const R1 = 'c0000000-0000-4000-8000-000000000001', R2 = 'c0000000-0000-4000-8000-000000000002';
const CTX1 = 'd0000000-0000-4000-8000-000000000001', CTX2 = 'd0000000-0000-4000-8000-000000000002';
const ACTIVE = { status: 'active', credits_used: 2, credits_remaining: 18, expired: false };
const COMPLETE = { status: 'complete', credits_used: 20, credits_remaining: 0, expired: false };
const STORED = { coverage: { state: 'COVERED' }, activity: { outcome: 'DEVELOPMENT_SHOWN' }, projects: [], sections: {} };
const ROWS = [
  { report_id: R2, number: 2, generated_at: '2026-10-02T13:00:00+00:00', private_context_id: CTX2 },
  { report_id: R1, number: 1, generated_at: '2026-10-02T12:00:00+00:00', private_context_id: CTX1 },
];
const ADDR = { [CTX1]: '742 Evergreen Terrace, Springfield, OR 97477', [CTX2]: null }; // report 2's address has been purged
const LABEL = { [CTX1]: 'Smith buyers', [CTX2]: null };
const HEADER = { brokerage: 'Acme Realty', agent: 'Pat Agent' }; // build step 7: the viewer's own header, read when a report is shown

function fakes(over = {}) {
  const calls = [];
  const rec = (name, fn) => async (...a) => { calls.push([name, ...a]); return fn(...a); };
  const never = (name) => rec(name, async () => { throw new Error(name + ' must not run'); });
  const deps = {
    now: () => new Date('2026-10-03T12:00:00Z'), rights: { version: 1, cleared: [] },
    authenticate: rec('authenticate', async (t) => (t === 'user-token' ? { email: 'agent@example.test', id: UID } : null)),
    isAdmin: rec('isAdmin', async () => false),
    trialOf: rec('trialOf', async () => ACTIVE),
    savedReports: rec('savedReports', async () => ROWS),
    openSavedReport: rec('openSavedReport', async (_u, id) => (id === R1 ? { ...ROWS[1], body: JSON.stringify(STORED) } : null)),
    subjectOf: rec('subjectOf', async (c) => ({ address: c ? ADDR[c] ?? null : null, label: c ? LABEL[c] ?? null : null })),
    headerOf: rec('headerOf', async () => HEADER),
    // everything that makes or charges a report: must never run for a list or an open
    geocode: never('geocode'), zipSupported: never('zipSupported'), radius: never('radius'), hydrate: never('hydrate'), ledger: never('ledger'),
    events: never('events'), health: never('health'), issue: never('issue'), storedReport: never('storedReport'), contextMatches: never('contextMatches'),
    ...over,
  };
  return { deps, calls };
}
const names = (calls) => calls.map((c) => c[0]);
async function ask(deps, body, { auth = 'Bearer user-token', method = 'POST', raw } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (auth) headers.authorization = auth;
  const init = { method, headers };
  if (method === 'POST') init.body = raw !== undefined ? raw : JSON.stringify(body);
  const res = await H.makeHandler(deps)(new Request('https://x/functions/v1/get-development-activity-report', init));
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json, text };
}
const MAKES = ['geocode', 'zipSupported', 'radius', 'hydrate', 'ledger', 'events', 'health', 'issue', 'storedReport', 'contextMatches'];

// ---- 1. who may ask ---------------------------------------------------------------------------------------------------------------------------
let f = fakes();
let r = await ask(f.deps, { action: 'list' });
ok(r.status === 200 && r.json.status === 'OK' && r.json.reports.length === 2, '1a an active trial member lists their brokerage\'s reports', r.json);
f = fakes({ trialOf: async () => COMPLETE });
r = await ask(f.deps, { action: 'list' });
ok(r.status === 200 && r.json.reports.length === 2 && r.json.trial.status === 'complete', '1b a member of a COMPLETE trial (all 20 used) can still list them', r.json);
f = fakes({ trialOf: async () => COMPLETE });
r = await ask(f.deps, { action: 'open', report_id: R1 });
ok(r.status === 200 && r.json.reopened === true, '1c and open one');
for (const [label, trial] of [['revoked', { status: 'revoked', credits_used: 3, credits_remaining: 17, expired: false }], ['expired', { status: 'active', credits_used: 3, credits_remaining: 17, expired: true }], ['none', null]]) {
  f = fakes({ trialOf: async () => trial });
  r = await ask(f.deps, { action: 'list' });
  ok(r.status === 403 && !names(f.calls).includes('savedReports'), '1d a member with a ' + label + ' trial is refused (403) and the stored reports are not read', r.json);
}
f = fakes({ isAdmin: async () => true });
r = await ask(f.deps, { action: 'list' });
ok(r.status === 403 && r.json.error === 'forbidden' && !names(f.calls).includes('savedReports'), '1e an admin has no brokerage\'s reports: 403, and nothing is read (an admin report is never stored)', r.json);
f = fakes();
r = await ask(f.deps, { action: 'list' }, { auth: null });
ok(r.status === 401 && !names(f.calls).includes('savedReports'), '1f no token: 401');
f = fakes({ authenticate: async () => null });
r = await ask(f.deps, { action: 'list' });
ok(r.status === 401 && !names(f.calls).includes('trialOf'), '1g the public anon key (no user behind it): 401, before any trial is read');

// ---- 2. the request ---------------------------------------------------------------------------------------------------------------------------
for (const [label, body, detail] of [
  ['an unknown action', { action: 'delete', report_id: R1 }, 'action'], ['a number as the action', { action: 5 }, 'action'],
  ['list with an address', { action: 'list', address: '742 Evergreen Terrace, Springfield, OR 97477' }, 'unknown field: address'],
  ['list with a report_id', { action: 'list', report_id: R1 }, 'unknown field: report_id'],
  ['open with an address', { action: 'open', report_id: R1, address: 'x' }, 'unknown field: address'],
  ['open with a key', { action: 'open', report_id: R1, idempotency_key: R1 }, 'unknown field: idempotency_key'],
  ['open with no id', { action: 'open' }, 'report_id'], ['open with a number', { action: 'open', report_id: 7 }, 'report_id'],
  ['open with a malformed id', { action: 'open', report_id: 'not-a-uuid' }, 'report_id'], ['open with an id and a suffix', { action: 'open', report_id: R1 + 'x' }, 'report_id'],
]) {
  f = fakes();
  r = await ask(f.deps, body);
  ok(r.status === 400 && r.json.error === 'invalid_request' && r.json.detail === detail && !names(f.calls).includes('savedReports') && !names(f.calls).includes('openSavedReport'),
    '2 ' + label + ': 400 naming the field, and nothing is read', r.json);
}
f = fakes();
r = await ask(f.deps, { action: 'list' }, { raw: JSON.stringify({ action: 'list', pad: 'x'.repeat(9000) }) });
ok(r.status === 413, '2z a request over the size limit: 413');

// ---- 3. what is read --------------------------------------------------------------------------------------------------------------------------
f = fakes();
await ask(f.deps, { action: 'list' });
const afterList = names(f.calls);
f = fakes();
await ask(f.deps, { action: 'open', report_id: R1 });
const afterOpen = names(f.calls);
ok(MAKES.every((m) => !afterList.includes(m) && !afterOpen.includes(m)),
  '3a a list and an open reach neither the geocoder, the spatial read, the ledger, the credit rule nor the issue function (nothing can be made, charged or stored)', { afterList, afterOpen });
ok(JSON.stringify(afterOpen.filter((x) => !['authenticate', 'isAdmin'].includes(x))) === JSON.stringify(['trialOf', 'openSavedReport', 'subjectOf', 'headerOf']), '3b an open reads the trial, the one stored report, its address and client label, and the viewer\'s own header, in that order', afterOpen);
ok(f.calls.find((c) => c[0] === 'openSavedReport')[1] === UID && f.calls.find((c) => c[0] === 'openSavedReport')[2] === R1, '3c it asks for the signed-in person\'s own id and the id they sent');

// ---- 4. what comes back -----------------------------------------------------------------------------------------------------------------------
f = fakes();
r = await ask(f.deps, { action: 'list' });
ok(JSON.stringify(r.json.reports) === JSON.stringify([
  { report_id: R2, number: 2, generated_at: '2026-10-02T13:00:00+00:00', address: null },
  { report_id: R1, number: 1, generated_at: '2026-10-02T12:00:00+00:00', address: '742 Evergreen Terrace, Springfield, OR 97477' }]),
  '4a the list is id, number, time and address (null once the private layer no longer keeps it), newest first', r.json.reports);
ok(!r.text.includes(CTX1) && !r.text.includes(CTX2) && !/private_context|context_id/.test(r.text), '4b and carries no private-context handle');
f = fakes();
r = await ask(f.deps, { action: 'open', report_id: R1 });
ok(r.status === 200 && r.json.status === 'OK' && r.json.reopened === true && r.json.stored === true && r.json.charged === false && r.json.report_id === R1 && r.json.number === 1
   && r.json.address === '742 Evergreen Terrace, Springfield, OR 97477' && JSON.stringify(r.json.report) === JSON.stringify(STORED) && r.json.coverage_state === 'COVERED',
  '4c an open returns the stored report as stored, flagged reopened and NOT charged, with its number and address', r.json);
ok(r.json.render === undefined && r.json.credit === undefined && !r.text.includes(CTX1), '4d with no render block (it is measured from a live address and never stored), no credit decision and no handle');
ok(JSON.stringify(Object.keys(r.json).sort()) === JSON.stringify(['address','charged','client_label','coverage_state','generated_at','header','number','reopened','report','report_id','status','stored','trial'].sort()), '4e exactly those fields', Object.keys(r.json).sort());
f = fakes({ subjectOf: async () => ({ address: null, label: null }) });
r = await ask(f.deps, { action: 'open', report_id: R1 });
ok(r.status === 200 && r.json.address === null && r.json.client_label === null && JSON.stringify(r.json.report) === JSON.stringify(STORED), '4f with the address and label purged the report is the same, and both are null');

// ---- 5. not the caller's report ---------------------------------------------------------------------------------------------------------------
f = fakes();
const foreign = await ask(f.deps, { action: 'open', report_id: R2 }); // a well-formed id the database does not give this caller
const unknown = await ask(f.deps, { action: 'open', report_id: 'c0000000-0000-4000-8000-0000000000ff' });
ok(foreign.status === 404 && unknown.status === 404 && foreign.text === unknown.text && foreign.json.error === 'not_found' && !foreign.text.includes(R2), '5a a report that is not the caller\'s brokerage\'s and an unknown id get the identical answer (404 not_found)', [foreign.json, unknown.json]);
ok(!names(f.calls).includes('subjectOf'), '5b and no address is read for either');

// ---- 6. failures ------------------------------------------------------------------------------------------------------------------------------
for (const [label, over, body] of [
  ['the list unreadable', { savedReports: async () => { throw new H.DataUnavailable('x'); } }, { action: 'list' }],
  ['the open unreadable', { openSavedReport: async () => { throw new H.DataUnavailable('x'); } }, { action: 'open', report_id: R1 }],
  ['the address unreadable', { subjectOf: async () => { throw new H.DataUnavailable('x'); } }, { action: 'list' }],
  ['the header unreadable', { headerOf: async () => { throw new H.DataUnavailable('x'); } }, { action: 'open', report_id: R1 }],
  ['a stored report that is not JSON', { openSavedReport: async () => ({ ...ROWS[1], body: '{nope' }) }, { action: 'open', report_id: R1 }],
  ['a stored report that is not an object', { openSavedReport: async () => ({ ...ROWS[1], body: '7' }) }, { action: 'open', report_id: R1 }],
]) {
  f = fakes(over);
  r = await ask(f.deps, body);
  ok(r.status === 502 && r.json.error === 'data_unavailable' && !r.text.includes('{nope'), '6a ' + label + ': 502, never "not found" and never a half answer', r.json);
}
f = fakes({ openSavedReport: async () => { throw new Error('boom 742 Evergreen'); } });
r = await ask(f.deps, { action: 'open', report_id: R1 });
ok(r.status === 500 && r.json.error === 'internal' && !r.text.includes('Evergreen'), '6b an unexpected failure: 500, and its message (which could carry an address) is not returned');

// ---- 7. a complete trial still cannot make a report -------------------------------------------------------------------------------------------
f = fakes({ trialOf: async () => COMPLETE });
r = await ask(f.deps, { address: '742 Evergreen Terrace, Springfield, OR 97477', idempotency_key: '3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f' });
ok(r.status === 403 && r.json.error === 'evaluation_complete' && r.json.trial.credits_remaining === 0 && MAKES.every((m) => !names(f.calls).includes(m)),
  '7a a complete trial asking for a REPORT is still refused (403 evaluation_complete) before anything is geocoded, read or charged', r.json);
f = fakes({ trialOf: async () => COMPLETE });
r = await ask(f.deps, null, { raw: '{not json' });
ok(r.status === 400, '7b and an unreadable request is a 400, not a report');
ok(/saved_reports/.test(JSON.stringify(H.capability())) && /"list"/.test(H.capability().method) && /"open"/.test(H.capability().method) && !/brokerage|evaluation_/.test(JSON.stringify(H.capability())),
  '7c the capability names list and open, and names no brokerage or database function');

// ---- 8. the shared module and the data layer --------------------------------------------------------------------------------------------------
const seen = [];
const json = (v, status = 200) => new Response(JSON.stringify(v), { status });
function stub(routes) {
  return async (url, init = {}) => {
    const u = new URL(url);
    seen.push({ path: u.pathname + u.search, body: init.body ? JSON.parse(init.body) : null, auth: (init.headers || {}).Authorization });
    for (const [re, g] of routes) if (re.test(u.pathname + u.search)) return g(init);
    throw new Error('unexpected ' + u.pathname);
  };
}
const dbRow = { report_id: R1, number: 1, generated_at: '2026-10-02T12:00:00+00:00', private_context_id: CTX1 };
const dataFor = (routes) => D.makeDeps({ url: 'https://proj.supabase.co', serviceKey: 'svc-key', rights: { version: 1, cleared: [] } }, stub(routes));
let d = dataFor([[/rpc\/evaluation_reports_of$/, () => json([dbRow, { ...dbRow, report_id: R2, number: 2, private_context_id: null }])]]);
let rows = await d.savedReports(UID);
ok(rows.length === 2 && JSON.stringify(seen.map((s) => s.path)) === JSON.stringify(['/rest/v1/rpc/evaluation_reports_of']) && JSON.stringify(seen[0].body) === JSON.stringify({ p_user_id: UID }) && seen[0].auth === 'Bearer svc-key',
  '8a the list is ONE database function call, with the service key, asked for by the person\'s own id', seen);
seen.length = 0;
d = dataFor([[/rpc\/evaluation_report_open$/, () => json([{ ...dbRow, body: JSON.stringify(STORED) }])]]);
const got = await d.openSavedReport(UID, R1);
ok(got && got.body === JSON.stringify(STORED) && JSON.stringify(seen[0].body) === JSON.stringify({ p_user_id: UID, p_report_id: R1 }) && seen.length === 1,
  '8b an open is ONE database function call with the person and the id, and returns the stored text unchanged', seen[0]);
seen.length = 0;
d = dataFor([[/rpc\/evaluation_report_open$/, () => json([])]]);
ok((await d.openSavedReport(UID, R1)) === null, '8c no row is null (not a report), not an error');
ok((await d.openSavedReport(UID, 'nope')) === null && seen.length === 1, '8d a malformed id never reaches the database', seen.length);
seen.length = 0;
const badOf = async (routes, call) => { let t = null; try { await call(dataFor(routes)); } catch (e) { t = e; } return t instanceof DataUnavailable ? 'unavailable' : t ? 'other:' + t.message : 'no error'; };
for (const [label, route, call] of [
  ['an open that answers with a DIFFERENT id', () => json([{ ...dbRow, report_id: R2, body: '{}' }]), (x) => x.openSavedReport(UID, R1)],
  ['an open that answers with two rows', () => json([{ ...dbRow, body: '{}' }, { ...dbRow, body: '{}' }]), (x) => x.openSavedReport(UID, R1)],
  ['an open with no body', () => json([{ ...dbRow }]), (x) => x.openSavedReport(UID, R1)],
  ['an open refused by the database', () => json({ message: 'nope' }, 400), (x) => x.openSavedReport(UID, R1)],
  ['an open, database down', () => json({ message: 'down' }, 503), (x) => x.openSavedReport(UID, R1)],
  ['a list row with a bad id', () => json([{ ...dbRow, report_id: 'zzz' }]), (x) => x.savedReports(UID)],
  ['a list row with a fractional number', () => json([{ ...dbRow, number: 1.5 }]), (x) => x.savedReports(UID)],
  ['a list row with no time', () => json([{ ...dbRow, generated_at: 'never' }]), (x) => x.savedReports(UID)],
  ['a list row with a bad handle', () => json([{ ...dbRow, private_context_id: 'xyz' }]), (x) => x.savedReports(UID)],
  ['a list that is not a list', () => json({ rows: [] }), (x) => x.savedReports(UID)],
  ['a list over the bound (1001 rows)', () => json(Array.from({ length: 1001 }, () => ({ ...dbRow }))), (x) => x.savedReports(UID)],
  ['a list, database refusing', () => json({ message: 'nope' }, 400), (x) => x.savedReports(UID)],
]) {
  const got2 = await badOf([[/rpc\/evaluation_report(s_of|_open)$/, route]], call);
  ok(got2 === 'unavailable', '8e ' + label + ' is a fault (unavailable), never a report or an empty list', got2);
}
const subjectSeen = [];
const mk = (c) => D.makeDeps({ url: 'https://proj.supabase.co', serviceKey: 'svc-key', rights: { version: 1, cleared: [] } }, async (url, init = {}) => {
  subjectSeen.push(new URL(url).pathname + ' ' + init.body);
  return json(c);
});
ok(JSON.stringify(await mk([{ state: 'active', address: '1 Main St', label: '  Smith   buyers ' }]).subjectOf(CTX1)) === JSON.stringify({ address: '1 Main St', label: 'Smith buyers' }) && JSON.stringify(subjectSeen) === JSON.stringify(['/rest/v1/rpc/report_private_context_read ' + JSON.stringify({ p_context: CTX1 })]),
  '8f the address and the label come from the private layer\'s own reader, for the one context (the label printed as clean one-line text)');
const NOTHING = JSON.stringify({ address: null, label: null });
ok(JSON.stringify(await mk([{ state: 'purged', address: null, label: null }]).subjectOf(CTX1)) === NOTHING && JSON.stringify(await mk([{ state: 'purged', address: '1 Main St', label: 'Smith buyers' }]).subjectOf(CTX1)) === NOTHING && JSON.stringify(await mk([]).subjectOf(CTX1)) === NOTHING,
  '8g a purged context, or one that is gone, gives neither (an address and a label are shown only while the layer keeps them)');
ok(JSON.stringify(await mk([{ state: 'active', address: '1 Main St', label: null }]).subjectOf(CTX1)) === JSON.stringify({ address: '1 Main St', label: null }) && JSON.stringify(await mk([{ state: 'active', address: '1 Main St', label: '   ' }]).subjectOf(CTX1)) === JSON.stringify({ address: '1 Main St', label: null }) && JSON.stringify(await mk([{ state: 'active', address: '1 Main St', label: 'x'.repeat(81) }]).subjectOf(CTX1)) === JSON.stringify({ address: '1 Main St', label: null }),
  '8g2 no label, a blank label and a label over 80 characters are no label (never a shortened copy)');
subjectSeen.length = 0;
ok(JSON.stringify(await mk([]).subjectOf(null)) === NOTHING && subjectSeen.length === 0, '8h a report with no context asks nothing');
let thrown = null; try { await mk({ message: 'x' }).subjectOf(CTX1); } catch (e) { thrown = e; }
ok(thrown instanceof DataUnavailable, '8i an unreadable private layer is a fault, not "no address"');

console.log('\n' + (n - bad) + ' passed, ' + bad + ' failed of ' + n);
process.exit(bad ? 1 : 0);
