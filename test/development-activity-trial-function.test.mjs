// THE TRIAL FUNCTION (supabase/functions/development-activity-trial) — offline, build step 5c of
// docs/development-activity-build-steps-100526.md.
//
//   1. the gate: no token, the anon key, a user with no id, and an unreachable user lookup are refused BEFORE the body is read;
//   2. status: what each kind of person is told (admin, active trial, used up, revoked, expired, none), never an id;
//   3. redeem: a malformed token never reaches the database; each database refusal has its own answer; a success says the role and
//      whether it was a replay, and never an id even when the database returns them;
//   4. the real data layer: exactly the requests it makes (the user lookup, the allow-list, the two database functions, with the
//      service key), and a failure to reach the database is "unavailable", never "refused";
//   5. trialStanding, the ONE reading of a trial's state, which the report gate and this function share.
// test/trial_report_pg drives the same handler and data layer against the real SQL.
// Run: node test/development-activity-trial-function.test.mjs
const H = await import('../supabase/functions/development-activity-trial/handler.ts');
const D = await import('../supabase/functions/development-activity-trial/data.ts');
const G = await import('../supabase/functions/_shared/admin-gate.ts');
const E = await import('../supabase/functions/_shared/evaluation-reads.ts');

let n = 0, bad = 0;
const ok = (c, m, d) => { n++; if (c) console.log('PASS — ' + m); else { bad++; console.log('FAIL — ' + m + (d !== undefined ? '  [' + JSON.stringify(d) + ']' : '')); } };

const UID = 'a1111111-1111-4111-8111-111111111111';
const TOKEN = 'hse1_' + '0123456789abcdef'.repeat(4);
const ACTIVE = { status: 'active', credits_used: 3, credits_remaining: 17, expired: false };
const calls = [];
function deps(over = {}) {
  const rec = (name, f) => async (...a) => { calls.push([name, ...a]); return f(...a); };
  return {
    authenticate: rec('authenticate', over.authenticate ?? (async () => ({ email: 'agent@example.test', id: UID }))),
    isAdmin: rec('isAdmin', over.isAdmin ?? (async () => false)),
    trialOf: rec('trialOf', over.trialOf ?? (async () => ACTIVE)),
    redeemInvite: rec('redeemInvite', over.redeemInvite ?? (async () => ({ role: 'agent', replayed: false }))),
  };
}
async function ask(d, body, { method = 'POST', auth = 'Bearer t', raw } = {}) {
  calls.length = 0;
  const headers = { 'content-type': 'application/json' };
  if (auth) headers.authorization = auth;
  const init = { method, headers };
  if (method === 'POST') init.body = raw !== undefined ? raw : JSON.stringify(body);
  const res = await H.makeHandler(d)(new Request('https://x/functions/v1/development-activity-trial', init));
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json, text, cache: res.headers.get('cache-control') };
}
const named = (name) => calls.filter((c) => c[0] === name);

// ---- 1. the gate --------------------------------------------------------------------------------------------------------------------------------
let r = await ask(deps(), null, { method: 'GET', auth: null });
ok(r.status === 200 && r.json.stores_reports === false && /signed-in user/.test(r.json.access) && /redeem/.test(r.json.method) && !/evaluation_/.test(r.text),
  '1a GET is the capability, needs no token, and names no database function', r.json);
r = await ask(deps(), null, { method: 'OPTIONS', auth: null });
ok(r.status === 204, '1b OPTIONS is the CORS preflight');
r = await ask(deps(), null, { method: 'PUT' });
ok(r.status === 405, '1c any other method is refused');
r = await ask(deps(), { action: 'status' }, { auth: null });
ok(r.status === 401 && r.json.error === 'unauthorized' && named('trialOf').length === 0, '1d no token: 401, nothing read');
r = await ask(deps({ authenticate: async () => null }), { action: 'status' });
ok(r.status === 401 && named('trialOf').length === 0, '1e the public anon key (no user behind it): 401');
r = await ask(deps({ authenticate: async () => ({ email: 'x@example.test' }) }), { action: 'status' });
ok(r.status === 403 && r.json.error === 'forbidden' && named('trialOf').length === 0, '1f a user with no id: 403 (a trial is keyed on the auth user, never an email)');
r = await ask(deps({ authenticate: async () => { throw new Error('down'); } }), { action: 'status' });
ok(r.status === 502 && named('trialOf').length === 0, '1g the user lookup unreachable: 502, not a refusal');
r = await ask(deps({ authenticate: async () => null }), null, { raw: '{not json' });
ok(r.status === 401, '1h the gate runs before the body is read: an unauthenticated caller with a broken body is told 401, not 400');
r = await ask(deps(), null, { raw: '{not json' });
ok(r.status === 400 && r.json.error === 'bad_request', '1i a signed-in caller with a broken body: 400');
r = await ask(deps(), null, { raw: JSON.stringify({ action: 'status', pad: 'x'.repeat(5000) }) });
ok(r.status === 413, '1j a body over the limit: 413');
r = await ask(deps(), { action: 'mint' });
ok(r.status === 400 && named('trialOf').length === 0 && named('redeemInvite').length === 0, '1k an unknown action: 400, nothing read');
ok(r.cache === 'no-store', '1l no answer is cacheable');

// ---- 2. status ------------------------------------------------------------------------------------------------------------------------------------
const statusFor = async (trial, admin = false) => (await ask(deps({ trialOf: async () => trial, isAdmin: async () => admin }), { action: 'status' })).json;
let j = await statusFor(ACTIVE);
ok(j.status === 'OK' && j.access === 'trial' && j.trial.credits_remaining === 17 && j.trial.credits_used === 3 && j.trial.status === 'active',
  '2a an active trial: access "trial", with its counts', j);
ok(JSON.stringify(Object.keys(j.trial).sort()) === '["credits_remaining","credits_used","status"]', '2b the trial is described by status and counts only (no id, no expiry date)', j.trial);
j = await statusFor({ status: 'complete', credits_used: 20, credits_remaining: 0, expired: false });
ok(j.access === 'complete' && j.trial.credits_remaining === 0, '2c a used-up trial: access "complete"', j);
j = await statusFor({ status: 'revoked', credits_used: 4, credits_remaining: 16, expired: false });
ok(j.access === 'ended', '2d a revoked trial: access "ended"', j);
j = await statusFor({ status: 'active', credits_used: 4, credits_remaining: 16, expired: true });
ok(j.access === 'ended', '2e an expired trial: access "ended"', j);
j = await statusFor(null);
ok(j.access === 'none' && j.trial === null, '2f no trial: access "none"', j);
j = await statusFor(null, true);
ok(j.access === 'admin' && j.trial === null, '2g an admin with no trial: access "admin" (the report function serves them as an admin)', j);
j = await statusFor(ACTIVE, true);
ok(j.access === 'admin' && j.trial.credits_remaining === 17, '2h an admin who is also a trial member is served as an admin (D-5b-2), and still sees the counts', j);
r = await ask(deps({ trialOf: async () => { throw new H.DataUnavailable('x'); } }), { action: 'status' });
ok(r.status === 502 && r.json.error === 'data_unavailable', '2i the trial unreadable: 502, never "no trial"');
r = await ask(deps({ trialOf: async () => { throw new Error('boom'); } }), { action: 'status' });
ok(r.status === 500 && r.json.error === 'internal' && !/boom/.test(r.text), '2j an unexpected failure: 500, and its message is not returned');

// ---- 3. redeem ------------------------------------------------------------------------------------------------------------------------------------
r = await ask(deps(), { action: 'redeem', token: TOKEN });
ok(r.status === 200 && r.json.role === 'agent' && r.json.replayed === false && r.json.access === 'trial' && r.json.trial.credits_remaining === 17,
  '3a a redeemed invite: the role, not a replay, and the trial as status reports it', r.json);
ok(JSON.stringify(named('redeemInvite').map((c) => c.slice(1))) === JSON.stringify([[TOKEN, UID]]), '3b redeemed for the signed-in person\'s own id, with the token they sent');
ok(named('trialOf').length === 1 && calls.findIndex((c) => c[0] === 'redeemInvite') < calls.findIndex((c) => c[0] === 'trialOf'), '3c the trial is read AFTER joining, so the counts are the ones the person now has');
r = await ask(deps({ redeemInvite: async () => ({ role: 'owner', replayed: true }) }), { action: 'redeem', token: TOKEN });
ok(r.status === 200 && r.json.role === 'owner' && r.json.replayed === true, '3d the same person using their own invite again is told it was a replay', r.json);
for (const [label, token] of [['missing', undefined], ['a number', 42], ['too long', 'hse1_' + 'a'.repeat(200)]]) {
  r = await ask(deps(), { action: 'redeem', token });
  ok(r.status === 400 && r.json.error === 'invite_unusable' && named('redeemInvite').length === 0, '3e a ' + label + ' token is refused before the database is asked');
}
for (const [Err, status, error] of [[E.InviteUnusable, 400, 'invite_unusable'], [E.AlreadyAMember, 409, 'already_a_member'], [E.SeatLimitReached, 409, 'seat_limit_reached']]) {
  r = await ask(deps({ redeemInvite: async () => { throw new Err('x'); } }), { action: 'redeem', token: TOKEN });
  ok(r.status === status && r.json.error === error && named('trialOf').length === 0, '3f ' + Err.name + ' → ' + status + ' ' + error + ', and no trial is read');
}
r = await ask(deps({ redeemInvite: async () => { throw new H.DataUnavailable('x'); } }), { action: 'redeem', token: TOKEN });
ok(r.status === 502 && r.json.error === 'data_unavailable', '3g the database unreachable: 502, never "the invite is unusable"');

// ---- 4. the real data layer -------------------------------------------------------------------------------------------------------------------------
const seen = [];
function stubFetch(routes) {
  return async (url, init = {}) => {
    const u = new URL(url);
    seen.push({ path: u.pathname + u.search, method: init.method ?? 'GET', headers: init.headers ?? {}, body: init.body ? JSON.parse(init.body) : null });
    for (const [re, f] of routes) if (re.test(u.pathname + u.search)) return f(init);
    throw new Error('unexpected ' + u.pathname);
  };
}
const json = (v, status = 200) => new Response(JSON.stringify(v), { status });
const USER = [/\/auth\/v1\/user$/, () => json({ id: UID, email: 'agent@example.test' })];
const NOT_ADMIN = [/dashboard_admins/, () => json([])];
const USAGE = [/\/rest\/v1\/rpc\/evaluation_usage$/, () => json([{ evaluation_id: 'e0000000-0000-4000-8000-000000000001', status: 'active', credit_limit: 20, credits_used: 5, credits_remaining: 15, expires_at: null, expired: false }])];
async function real(routes, body) {
  seen.length = 0;
  const h = H.makeHandler(D.makeDeps({ url: 'https://proj.supabase.co/', serviceKey: 'svc-key' }, stubFetch(routes)));
  const res = await h(new Request('https://x/f', { method: 'POST', headers: { authorization: 'Bearer user-token', 'content-type': 'application/json' }, body: JSON.stringify(body) }));
  return { status: res.status, json: JSON.parse(await res.text()) };
}
r = await real([USER, NOT_ADMIN, USAGE], { action: 'status' });
ok(r.status === 200 && r.json.access === 'trial' && r.json.trial.credits_remaining === 15, '4a status through the real data layer', r.json);
ok(JSON.stringify(seen.map((s) => s.method + ' ' + s.path.split('?')[0])) === JSON.stringify(['GET /auth/v1/user', 'GET /rest/v1/dashboard_admins', 'POST /rest/v1/rpc/evaluation_usage']),
  '4b exactly three requests: who the token belongs to, the allow-list, and evaluation_usage', seen.map((s) => s.path));
ok(seen[0].headers.Authorization === 'Bearer user-token' && seen[2].headers.Authorization === 'Bearer svc-key' && JSON.stringify(seen[2].body) === JSON.stringify({ p_user_id: UID }),
  '4c the user lookup carries the person\'s token; the database call carries the service key and asks by the person\'s id');
ok(!/e0000000/.test(JSON.stringify(r.json)), '4d the evaluation id the database returned does not reach the answer');
const REDEEM_OK = [/\/rest\/v1\/rpc\/evaluation_invite_redeem$/, () => json([{ evaluation_id: 'e0000000-0000-4000-8000-000000000001', brokerage_id: 'b0000000-0000-4000-8000-000000000002', role: 'agent', replayed: false }])];
r = await real([USER, NOT_ADMIN, REDEEM_OK, USAGE], { action: 'redeem', token: TOKEN });
const redeemReq = seen.find((s) => /evaluation_invite_redeem/.test(s.path));
ok(r.status === 200 && r.json.role === 'agent' && redeemReq && JSON.stringify(redeemReq.body) === JSON.stringify({ p_token: TOKEN, p_user_id: UID }),
  '4e redeem through the real data layer: the token and the person\'s id go to evaluation_invite_redeem', r.json);
ok(!/e0000000|b0000000/.test(JSON.stringify(r.json)), '4f neither the evaluation id nor the brokerage id reaches the answer');
for (const [msg, status, error] of [['INVITE_UNUSABLE', 400, 'invite_unusable'], ['ALREADY_A_MEMBER', 409, 'already_a_member'], ['SEAT_LIMIT_REACHED', 409, 'seat_limit_reached'], ['SOMETHING_ELSE', 502, 'data_unavailable']]) {
  r = await real([USER, NOT_ADMIN, [/evaluation_invite_redeem/, () => json({ code: 'EV001', message: msg }, 400)], USAGE], { action: 'redeem', token: TOKEN });
  ok(r.status === status && r.json.error === error, '4g the database refusing with ' + msg + ' (HTTP 400) → ' + status + ' ' + error, r.json);
}
r = await real([USER, NOT_ADMIN, [/evaluation_invite_redeem/, () => json({ message: 'down' }, 503)], USAGE], { action: 'redeem', token: TOKEN });
ok(r.status === 502, '4h the database answering 5xx: 502, never a refusal');
r = await real([USER, NOT_ADMIN, [/evaluation_invite_redeem/, () => { throw new Error('reset'); }], USAGE], { action: 'redeem', token: TOKEN });
ok(r.status === 502, '4i the database unreachable: 502');
r = await real([USER, NOT_ADMIN, REDEEM_OK, USAGE], { action: 'redeem', token: 'hse1_' + 'Z'.repeat(64) });
ok(r.status === 400 && !seen.some((s) => /evaluation_invite_redeem/.test(s.path)), '4j a token of the wrong shape never reaches the database (the shared module checks it too)');
r = await real([USER, NOT_ADMIN, [/evaluation_invite_redeem/, () => json([{ role: 'boss', replayed: false }])], USAGE], { action: 'redeem', token: TOKEN });
ok(r.status === 502, '4k an answer of the wrong shape (an unknown role) is unavailable, not a success');
r = await real([USER, NOT_ADMIN, [/evaluation_usage/, () => json([{ status: 'active' }])]], { action: 'status' });
ok(r.status === 502, '4l a trial row of the wrong shape is unavailable, not "no trial"');
r = await real([USER, NOT_ADMIN, [/evaluation_usage/, () => json([])]], { action: 'status' });
ok(r.status === 200 && r.json.access === 'none', '4m no row: no trial');

{
  const reads = E.makeEvaluationReads(async () => ({ data: [{ evaluation_id: 'e0000000-0000-4000-8000-000000000001', brokerage_id: 'b0000000-0000-4000-8000-000000000002', role: 'owner', replayed: true }], error: null }));
  const got = await reads.redeemInvite(TOKEN, UID);
  ok(JSON.stringify(got) === JSON.stringify({ role: 'owner', replayed: true }), '4n the shared module itself returns only the role and whether it was a replay: no id leaves it, whoever calls it', got);
}

// ---- 5. trialStanding --------------------------------------------------------------------------------------------------------------------------------
const S = (status, expired) => G.trialStanding({ status, credits_used: 0, credits_remaining: 20, expired });
ok(S('active', false) === 'active' && S('active', true) === 'ended' && S('complete', false) === 'complete' && S('complete', true) === 'complete'
   && S('revoked', false) === 'ended' && S('paid', false) === 'ended' && S('', false) === 'ended',
  '5a trialStanding: active only when the status says active and it has not expired; a used-up trial is complete; anything else, including a status this code does not know, has ended');
const gateSrc = (await import('node:fs')).readFileSync(new URL('../supabase/functions/_shared/admin-gate.ts', import.meta.url), 'utf8');
ok((gateSrc.match(/trialStanding\(/g) || []).length === 2 && /const standing = trialStanding\(trial\);/.test(gateSrc),
  '5b the report gate reads a trial through trialStanding and nothing else (its definition plus its one use)');

console.log('\n' + (n - bad) + ' passed, ' + bad + ' failed of ' + n);
process.exit(bad ? 1 : 0);
