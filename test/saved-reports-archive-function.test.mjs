// REMOVE FROM MY LIST — the report function's `archive` and `restore` actions, and the `archived` option of `list` (docs/saved-reports-archive.sql), offline.
// The handler is driven through injected fakes that record every call, so a test can say what was NOT called; the data layer through a stub fetch that
// records every request it would send. What is proven here:
//   1. who may ask: a trial member (active OR complete); an admin, a person with no trial, an ended trial and an unsigned request are refused, and nothing is written;
//   2. the request: `archive` / `restore` take `report_ids` (1 to 100 UUIDs) and NOTHING else - in particular no user id: whose list it is comes from the verified sign-in;
//   3. what is called: only the one archive dependency, with the VERIFIED user and the ids; never the geocoder, the engine, the credit rule or the issue function;
//   4. what comes back: how many were asked and how many changed, never an id list, a number, an address or a handle; nothing is ever "charged";
//   5. a refusal is the same for every cause (another brokerage's, unknown, no standing): 404; an unusable set is 400; the database failing is 502; anything else 500 with no message;
//   6. `list` returns the active list by default and the archived list only when asked with a real boolean;
//   7. the data layer: exact requests, exact shapes, ids checked before the database is asked, a wrong count or shape is a fault.
// test/trial_report_pg drives the same handler and data layer against the real SQL.
// Run: node test/saved-reports-archive-function.test.mjs
let n = 0, bad = 0;
const ok = (c, m, d) => { n++; if (c) console.log('PASS — ' + m); else { bad++; console.log('FAIL — ' + m + (d !== undefined ? '  [' + JSON.stringify(d) + ']' : '')); } };

const H = await import('../supabase/functions/get-development-activity-report/handler.ts');
const D = await import('../supabase/functions/get-development-activity-report/data.ts');
const E = await import('../supabase/functions/_shared/evaluation-reads.ts');
const { DataUnavailable } = await import('../supabase/functions/_shared/service-rest.ts');

const UID = 'a1111111-1111-4111-8111-111111111111';
const R1 = 'c0000000-0000-4000-8000-000000000001', R2 = 'c0000000-0000-4000-8000-000000000002', R3 = 'c0000000-0000-4000-8000-000000000003';
const CTX1 = 'd0000000-0000-4000-8000-000000000001', CTX2 = 'd0000000-0000-4000-8000-000000000002';
const ACTIVE = { status: 'active', credits_used: 2, credits_remaining: 8, expired: false };
const COMPLETE = { status: 'complete', credits_used: 10, credits_remaining: 0, expired: false };
const ROWS = [
  { report_id: R2, number: 2, generated_at: '2026-10-02T13:00:00+00:00', private_context_id: CTX2 },
  { report_id: R1, number: 1, generated_at: '2026-10-02T12:00:00+00:00', private_context_id: CTX1 },
];

function fakes(over = {}) {
  const calls = [];
  const rec = (name, fn) => async (...a) => { calls.push([name, ...a]); return fn(...a); };
  const never = (name) => rec(name, async () => { throw new Error(name + ' must not run'); });
  const deps = {
    now: () => new Date('2026-10-03T12:00:00Z'), rights: { version: 1, cleared: [] },
    authenticate: rec('authenticate', async (t) => (t === 'user-token' ? { email: 'agent@example.test', id: UID } : null)),
    isAdmin: rec('isAdmin', async () => false),
    trialOf: rec('trialOf', async () => ACTIVE),
    planOf: rec('planOf', async () => ({ brokerage_id: 'b0b0b0b0-1111-4222-8333-444444444444', role: 'owner', state: 'none', credit_limit: 100, credits_used: 0, credits_remaining: 0, period_ends_at: null })),
    savedReports: rec('savedReports', async (_u, archived) => (archived ? [ROWS[0]] : ROWS)),
    archiveReports: rec('archiveReports', async (_u, ids) => ids.length),
    openSavedReport: never('openSavedReport'),
    subjectOf: rec('subjectOf', async () => ({ address: '742 Evergreen Terrace, Springfield, OR 97477', label: 'Smith' })),
    headerOf: never('headerOf'),
    // everything that makes or charges a report: must never run for a list, an archive or a restore
    geocode: never('geocode'), zipSupported: never('zipSupported'), radius: never('radius'), hydrate: never('hydrate'), ledger: never('ledger'),
    events: never('events'), health: never('health'), issue: never('issue'), storedReport: never('storedReport'), contextMatches: never('contextMatches'), rateClaim: never('rateClaim'),
    ...over,
  };
  return { deps, calls };
}
const names = (calls) => calls.map((c) => c[0]);
async function ask(deps, body, { auth = 'Bearer user-token', raw } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (auth) headers.authorization = auth;
  const res = await H.makeHandler(deps)(new Request('https://x/functions/v1/get-development-activity-report', { method: 'POST', headers, body: raw !== undefined ? raw : JSON.stringify(body) }));
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json, text };
}
const MAKES = ['geocode', 'zipSupported', 'radius', 'hydrate', 'ledger', 'events', 'health', 'issue', 'storedReport', 'contextMatches', 'rateClaim'];

// ---- 1. who may ask -------------------------------------------------------------------------------------------------------------------------
for (const action of ['archive', 'restore']) {
  let f = fakes();
  let r = await ask(f.deps, { action, report_ids: [R1] });
  ok(r.status === 200 && r.json.status === 'OK' && r.json.action === action, '1a an active trial member may ' + action, r.json);
  f = fakes({ trialOf: async () => COMPLETE });
  r = await ask(f.deps, { action, report_ids: [R1] });
  ok(r.status === 200 && r.json.trial.status === 'complete', '1b a member of a COMPLETE trial (all 10 used) may ' + action + ' too: their reports stay theirs to arrange', r.json);
  for (const [label, trial] of [['revoked', { status: 'revoked', credits_used: 3, credits_remaining: 7, expired: false }], ['expired', { status: 'active', credits_used: 3, credits_remaining: 7, expired: true }], ['none', null]]) {
    f = fakes({ trialOf: async () => trial });
    r = await ask(f.deps, { action, report_ids: [R1] });
    ok(r.status === 403 && !names(f.calls).includes('archiveReports'), '1c a member with a ' + label + ' trial cannot ' + action + ' (403) and nothing is written', r.json);
  }
  f = fakes({ isAdmin: async () => true });
  r = await ask(f.deps, { action, report_ids: [R1] });
  ok(r.status === 403 && r.json.error === 'forbidden' && !names(f.calls).includes('archiveReports'), '1d an admin has no brokerage list: 403, nothing written', r.json);
  f = fakes();
  r = await ask(f.deps, { action, report_ids: [R1] }, { auth: null });
  ok(r.status === 401 && !names(f.calls).includes('archiveReports'), '1e no token: 401');
  f = fakes({ authenticate: async () => null });
  r = await ask(f.deps, { action, report_ids: [R1] });
  ok(r.status === 401 && !names(f.calls).includes('trialOf') && !names(f.calls).includes('archiveReports'), '1f the public anon key (no user behind it): 401 before any trial is read');
}

// ---- 2. the request -------------------------------------------------------------------------------------------------------------------------
const ids = (k) => Array.from({ length: k }, (_, i) => 'c0000000-0000-4000-8000-' + String(i + 1).padStart(12, '0'));
for (const [label, body] of [
  ['no report_ids', { action: 'archive' }], ['report_ids not a list', { action: 'archive', report_ids: R1 }], ['an empty list', { action: 'archive', report_ids: [] }],
  ['a number in the list', { action: 'archive', report_ids: [R1, 5] }], ['a malformed id', { action: 'archive', report_ids: [R1, 'nope'] }], ['a null', { action: 'archive', report_ids: [null] }],
  ['an object', { action: 'restore', report_ids: [{ id: R1 }] }], ['101 ids', { action: 'archive', report_ids: ids(101) }], ['a single report_id', { action: 'archive', report_id: R1 }],
]) {
  const f = fakes(); const r = await ask(f.deps, body);
  ok(r.status === 400 && r.json.error === 'invalid_request' && !names(f.calls).includes('archiveReports'), '2a ' + label + ' is a 400 and never reaches the database', r.json);
}
for (const extra of [{ user_id: '99999999-9999-4999-8999-999999999999' }, { p_user_id: UID }, { address: '742 Evergreen Terrace, Springfield, OR 97477' }, { archived: true }, { brokerage_id: 'x' }]) {
  const f = fakes(); const r = await ask(f.deps, { action: 'archive', report_ids: [R1], ...extra });
  ok(r.status === 400 && /unknown field/.test(r.json.detail) && !names(f.calls).includes('archiveReports'), '2b a request that also carries ' + Object.keys(extra)[0] + ' is refused: whose list it is can never be named by the request', r.json);
}
{
  const f = fakes(); const r = await ask(f.deps, { action: 'archive', report_ids: ids(100) });
  ok(r.status === 200 && f.calls.find((c) => c[0] === 'archiveReports')[2].length === 100, '2c exactly 100 ids is accepted (the bound is inclusive)');
}
{
  const f = fakes(); const r = await ask(f.deps, { action: 'list', archived: 'yes' });
  ok(r.status === 400 && r.json.detail === 'archived' && !names(f.calls).includes('savedReports'), '2d list takes a real boolean for `archived`, never a string', r.json);
  const g = fakes(); const s = await ask(g.deps, { action: 'list', archived: 1 });
  ok(s.status === 400, '2e nor a number');
  const h = fakes(); const t = await ask(h.deps, { action: 'list', report_ids: [R1] });
  ok(t.status === 400 && /unknown field: report_ids/.test(t.json.detail), '2f a list carries no ids');
}
{
  const f = fakes(); const r = await ask(f.deps, { action: 'archive', report_ids: [R1] }, { raw: '{"action":"archive","report_ids":[' + JSON.stringify(R1) + '],"x":' + '1'.repeat(5000) + '}' });
  ok(r.status === 413 && !names(f.calls).includes('archiveReports'), '2g an oversized body is 413 before anything is read');
}

// ---- 3. what is called ----------------------------------------------------------------------------------------------------------------------
for (const action of ['archive', 'restore']) {
  const f = fakes(); await ask(f.deps, { action, report_ids: [R1, R2] });
  const calls = names(f.calls);
  ok(MAKES.every((m) => !calls.includes(m)) && !calls.includes('openSavedReport') && !calls.includes('savedReports') && !calls.includes('subjectOf'),
    '3a ' + action + ' reaches NEITHER the geocoder, NOR the engine reads, NOR the rate limit, NOR the credit rule, NOR the issue function, and reads no list or address', calls);
  const call = f.calls.find((c) => c[0] === 'archiveReports');
  ok(call && call[1] === UID && JSON.stringify(call[2]) === JSON.stringify([R1, R2]) && call[3] === (action === 'archive'),
    '3b it calls the one archive dependency with the VERIFIED user, the ids as sent and the direction', call);
  ok(calls.filter((c) => c === 'archiveReports').length === 1, '3c exactly once');
}

// ---- 4. what comes back ---------------------------------------------------------------------------------------------------------------------
{
  const f = fakes({ archiveReports: async () => 1 });
  const r = await ask(f.deps, { action: 'archive', report_ids: [R1, R1, R2.toUpperCase()] });
  ok(r.json.requested === 2 && r.json.changed === 1 && r.json.action === 'archive', '4a it says how many reports were named (a repeated id once, case ignored) and how many changed', r.json);
  ok(!r.text.includes(R1) && !r.text.includes(CTX1) && !/address|number|body|report_id/.test(Object.keys(r.json).join(',')), '4b the answer holds no report id, address, number or handle');
  ok(JSON.stringify(Object.keys(r.json).sort()) === JSON.stringify(['action', 'changed', 'plan', 'requested', 'status', 'trial']), '4c and only the figures the other member answers carry (trial and plan)', Object.keys(r.json));
  ok(r.json.trial.credits_used === 2 && r.json.trial.credits_remaining === 8, '4d the trial figures are the ones the database reported, untouched by the change');
  ok(!('charged' in r.json) && !('credit' in r.json), '4e nothing is charged, refunded or credited in the answer');
}
{
  const f = fakes({ archiveReports: async () => 0 });
  const r = await ask(f.deps, { action: 'restore', report_ids: [R3] });
  ok(r.status === 200 && r.json.changed === 0 && r.json.requested === 1, '4f changing nothing (already so) is a quiet 200 with changed 0');
}

// ---- 5. refusals ----------------------------------------------------------------------------------------------------------------------------
for (const [label, err, status, body] of [
  ['not found (another brokerage\'s, unknown, no standing: one answer)', new E.SavedReportNotFound('x'), 404, 'not_found'],
  ['an unusable set the database refused', new E.ArchiveInvalid('x'), 400, 'invalid_request'],
  ['the database failing', new DataUnavailable('x'), 502, 'data_unavailable'],
  ['an unexpected failure', new Error('742 Evergreen Terrace secret'), 500, 'internal'],
]) {
  const f = fakes({ archiveReports: async () => { throw err; } });
  const r = await ask(f.deps, { action: 'archive', report_ids: [R1] });
  ok(r.status === status && r.json.error === body && !/Evergreen|secret/.test(r.text), '5a ' + label + ': ' + status + ' ' + body + ', and no message is returned', r.json);
}
{
  const a = await ask(fakes({ archiveReports: async () => { throw new E.SavedReportNotFound('foreign'); } }).deps, { action: 'archive', report_ids: [R1] });
  const b = await ask(fakes({ archiveReports: async () => { throw new E.SavedReportNotFound('unknown'); } }).deps, { action: 'archive', report_ids: [R2] });
  ok(a.text === b.text, '5b a report that is another brokerage\'s and one that does not exist get the SAME answer, byte for byte');
}

// ---- 6. the list ---------------------------------------------------------------------------------------------------------------------------
{
  let f = fakes(); let r = await ask(f.deps, { action: 'list' });
  const c = f.calls.find((x) => x[0] === 'savedReports');
  ok(r.status === 200 && r.json.archived === false && r.json.reports.length === 2 && c[1] === UID && c[2] === false, '6a the default list asks for the reports NOT removed, for the verified user', { r: r.json, c });
  f = fakes(); r = await ask(f.deps, { action: 'list', archived: true });
  const c2 = f.calls.find((x) => x[0] === 'savedReports');
  ok(r.status === 200 && r.json.archived === true && r.json.reports.length === 1 && c2[2] === true, '6b `archived: true` asks for the reports they removed', { r: r.json, c: c2 });
  f = fakes(); r = await ask(f.deps, { action: 'list', archived: false });
  ok(f.calls.find((x) => x[0] === 'savedReports')[2] === false, '6c `archived: false` is the default list');
  ok(JSON.stringify(Object.keys(r.json.reports[0]).sort()) === JSON.stringify(['address', 'generated_at', 'number', 'report_id']), '6d each row is exactly what the list has always carried (no handle, no archive flag)', Object.keys(r.json.reports[0]));
}

// ---- 7. the data layer ----------------------------------------------------------------------------------------------------------------------
const seen = [];
const json = (v, status = 200) => new Response(JSON.stringify(v), { status });
function stub(routes) {
  return async (url, init = {}) => {
    const u = new URL(url);
    seen.push({ path: u.pathname, body: init.body ? JSON.parse(init.body) : null, auth: (init.headers || {}).Authorization });
    for (const [re, g] of routes) if (re.test(u.pathname)) return g(init);
    throw new Error('unexpected ' + u.pathname);
  };
}
const dataFor = (routes) => D.makeDeps({ url: 'https://proj.supabase.co', serviceKey: 'svc-key', rights: { version: 1, cleared: [] } }, stub(routes));
const dbRow = { report_id: R1, number: 1, generated_at: '2026-10-02T12:00:00+00:00', private_context_id: CTX1 };
let d = dataFor([[/rpc\/saved_reports_listed$/, () => json([dbRow])]]);
await d.savedReports(UID, true);
ok(JSON.stringify(seen.map((s) => s.path)) === JSON.stringify(['/rest/v1/rpc/saved_reports_listed']) && JSON.stringify(seen[0].body) === JSON.stringify({ p_user_id: UID, p_archived: true }) && seen[0].auth === 'Bearer svc-key',
  '7a the archived list is ONE database function call, with the service key, the person\'s own id and the flag', seen);
seen.length = 0;
d = dataFor([[/rpc\/saved_reports_archive_set$/, () => json(2)]]);
const changed = await d.archiveReports(UID, [R1.toUpperCase(), R2], true);
ok(changed === 2 && seen.length === 1 && JSON.stringify(seen[0].body) === JSON.stringify({ p_user_id: UID, p_report_ids: [R1, R2], p_archived: true }),
  '7b an archive is ONE database function call: the person, the ids (lower-cased) and the direction; the answer is the number of rows changed', seen);
const attempt = async (routes, call) => { let t = null; try { await call(dataFor(routes)); } catch (e) { t = e; } return t; };
seen.length = 0;
for (const [label, ids2] of [['no ids', []], ['101 ids', ids(101)], ['a malformed id', [R1, 'nope']], ['a non-string', [R1, 5]], ['not a list', R1]]) {
  const t = await attempt([[/rpc\/saved_reports_archive_set$/, () => json(1)]], (x) => x.archiveReports(UID, ids2, true));
  ok(t instanceof E.ArchiveInvalid, '7c ' + label + ' is refused BEFORE the database is asked', t && t.constructor.name);
}
ok(seen.length === 0, '7d none of those reached the database', seen.length);
for (const [label, route, cls] of [
  ['the database says NOT_FOUND', () => json({ message: 'NOT_FOUND' }, 400), E.SavedReportNotFound],
  ['the database says ARCHIVE_INVALID', () => json({ message: 'ARCHIVE_INVALID' }, 400), E.ArchiveInvalid],
  ['the database fails', () => json({ message: 'boom' }, 500), DataUnavailable],
  ['an answer that is not a number', () => json('2'), DataUnavailable],
  ['an answer that is fractional', () => json(1.5), DataUnavailable],
  ['an answer that is negative', () => json(-1), DataUnavailable],
  ['an answer larger than the set (more rows changed than ids named)', () => json(3), DataUnavailable],
  ['an answer that is a list', () => json([1]), DataUnavailable],
]) {
  const t = await attempt([[/rpc\/saved_reports_archive_set$/, route]], (x) => x.archiveReports(UID, [R1, R2], true));
  ok(t instanceof cls, '7e ' + label + ' is ' + cls.name, t && t.constructor.name);
}
ok(!/saved_reports/.test(JSON.stringify(H.capability())) === false && /archive/.test(H.capability().method) && /restore/.test(H.capability().method) && !/brokerage_|evaluation_|saved_reports_/.test(JSON.stringify(H.capability())),
  '7f the capability names archive and restore, and no database function');

console.log('\n' + (n - bad) + ' passed, ' + bad + ' failed of ' + n);
process.exit(bad ? 1 : 0);
