// THE TRIAL FUNCTION (supabase/functions/development-activity-trial) — offline, build step 5c of
// docs/development-activity-build-steps-100526.md.
//
//   1. the gate: no token, the anon key, a user with no id, and an unreachable user lookup are refused BEFORE the body is read;
//   2. status: what each kind of person is told (admin, active trial, used up, revoked, expired, none), never an id;
//   3. redeem: a malformed token never reaches the database; each database refusal has its own answer; a success says the role and
//      whether it was a replay, and never an id even when the database returns them;
//   4. the real data layer: exactly the requests it makes (the user lookup, the allow-list, the two database functions, with the
//      service key), and a failure to reach the database is "unavailable", never "refused";
//   5. trialStanding, the ONE reading of a trial's state, which the report gate and this function share;
//   6. create (build step 5d): admins only, refused for anyone else before a field is read; every field checked before the database
//      is asked; the answer is the invite link and its expiry, once, and never an id; the real data layer's exact request; the one
//      form of the invite link, and that the customer page reads it.
//   7. invite (build step 5e): a trial OWNER makes an agent invite while the trial is active. No trial is refused, a used-up or
//      ended trial is refused, and whether this person is an owner is the database's answer (NotEntitled → not_owner), never the
//      handler's; the answer is the link and its expiry, once, and never an id; the real data layer's exact requests; and the role
//      the status answer carries comes from the one membership resolver.
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
const ACTIVE = { status: 'active', credits_used: 3, credits_remaining: 7, expired: false };
const NOW = new Date('2026-10-02T12:00:00Z');
const M1 = 'c0000000-0000-4000-8000-000000000001', I1 = 'c0000000-0000-4000-8000-000000000002';
const calls = [];
function deps(over = {}) {
  const rec = (name, f) => async (...a) => { calls.push([name, ...a]); return f(...a); };
  return {
    authenticate: rec('authenticate', over.authenticate ?? (async () => ({ email: 'agent@example.test', id: UID }))),
    isAdmin: rec('isAdmin', over.isAdmin ?? (async () => false)),
    trialOf: rec('trialOf', over.trialOf ?? (async () => ACTIVE)),
    redeemInvite: rec('redeemInvite', over.redeemInvite ?? (async () => ({ role: 'agent', replayed: false }))),
    createTrial: rec('createTrial', over.createTrial ?? (async () => ({ invite_link: E.inviteLink(TOKEN), invite_expires_at: '2026-10-16T12:00:00+00:00' }))),
    roleOf: rec('roleOf', over.roleOf ?? (async () => 'agent')),
    teamOf: rec('teamOf', over.teamOf ?? (async () => ({ members: [{ ref: M1, label: 'a***@example.test', joined_at: '2026-10-03T12:00:00+00:00' }], invites: [{ ref: I1, created_at: '2026-10-04T12:00:00+00:00', expires_at: '2026-10-18T12:00:00+00:00' }] }))),
    removeMember: rec('removeMember', over.removeMember ?? (async () => true)),
    withdrawInvite: rec('withdrawInvite', over.withdrawInvite ?? (async () => true)),
    inviteAgent: rec('inviteAgent', over.inviteAgent ?? (async () => ({ invite_link: E.inviteLink(TOKEN), invite_expires_at: '2026-10-16T12:00:00+00:00' }))),
    now: over.now ?? (() => NOW),
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
ok(j.status === 'OK' && j.access === 'trial' && j.trial.credits_remaining === 7 && j.trial.credits_used === 3 && j.trial.status === 'active',
  '2a an active trial: access "trial", with its counts', j);
ok(JSON.stringify(Object.keys(j.trial).sort()) === '["credits_remaining","credits_used","status"]', '2b the trial is described by status and counts only (no id, no expiry date)', j.trial);
j = await statusFor({ status: 'complete', credits_used: 10, credits_remaining: 0, expired: false });
ok(j.access === 'complete' && j.trial.credits_remaining === 0, '2c a used-up trial: access "complete"', j);
j = await statusFor({ status: 'revoked', credits_used: 4, credits_remaining: 6, expired: false });
ok(j.access === 'ended', '2d a revoked trial: access "ended"', j);
j = await statusFor({ status: 'active', credits_used: 4, credits_remaining: 6, expired: true });
ok(j.access === 'ended', '2e an expired trial: access "ended"', j);
j = await statusFor(null);
ok(j.access === 'none' && j.trial === null, '2f no trial: access "none"', j);
j = await statusFor(null, true);
ok(j.access === 'admin' && j.trial === null, '2g an admin with no trial: access "admin" (the report function serves them as an admin)', j);
j = await statusFor(ACTIVE, true);
ok(j.access === 'admin' && j.trial.credits_remaining === 7, '2h an admin who is also a trial member is served as an admin (D-5b-2), and still sees the counts', j);
r = await ask(deps({ trialOf: async () => { throw new H.DataUnavailable('x'); } }), { action: 'status' });
ok(r.status === 502 && r.json.error === 'data_unavailable', '2i the trial unreadable: 502, never "no trial"');
r = await ask(deps({ roleOf: async () => 'owner' }), { action: 'status' });
ok(r.status === 200 && r.json.role === 'owner' && JSON.stringify(named('roleOf').map((c) => c.slice(1))) === JSON.stringify([[UID]]),
  '2k the status carries the person\'s role, read for their own id from the membership resolver (build step 5e)', r.json);
r = await ask(deps({ trialOf: async () => null, roleOf: async () => 'owner' }), { action: 'status' });
ok(r.status === 200 && r.json.role === null && named('roleOf').length === 0, '2l no trial: no role, and the role is not read', r.json);
r = await ask(deps({ roleOf: async () => { throw new H.DataUnavailable('x'); } }), { action: 'status' });
ok(r.status === 502 && r.json.error === 'data_unavailable', '2m the role unreadable: 502, never "no role"');
r = await ask(deps({ trialOf: async () => { throw new Error('boom'); } }), { action: 'status' });
ok(r.status === 500 && r.json.error === 'internal' && !/boom/.test(r.text), '2j an unexpected failure: 500, and its message is not returned');

// ---- 3. redeem ------------------------------------------------------------------------------------------------------------------------------------
r = await ask(deps(), { action: 'redeem', token: TOKEN });
ok(r.status === 200 && r.json.role === 'agent' && r.json.replayed === false && r.json.access === 'trial' && r.json.trial.credits_remaining === 7,
  '3a a redeemed invite: the role, not a replay, and the trial as status reports it', r.json);
ok(JSON.stringify(named('redeemInvite').map((c) => c.slice(1))) === JSON.stringify([[TOKEN, UID]]), '3b redeemed for the signed-in person\'s own id, with the token they sent');
ok(named('trialOf').length === 1 && calls.findIndex((c) => c[0] === 'redeemInvite') < calls.findIndex((c) => c[0] === 'trialOf'), '3c the trial is read AFTER joining, so the counts are the ones the person now has');
r = await ask(deps({ redeemInvite: async () => ({ role: 'owner', replayed: true }), roleOf: async () => 'owner' }), { action: 'redeem', token: TOKEN });
ok(r.status === 200 && r.json.role === 'owner' && r.json.replayed === true, '3d the same person using their own invite again is told it was a replay', r.json);
r = await ask(deps({ redeemInvite: async () => ({ role: 'owner', replayed: false }), roleOf: async () => 'agent' }), { action: 'redeem', token: TOKEN });
ok(r.status === 200 && r.json.role === 'agent' && named('roleOf').length === 1 && calls.findIndex((c) => c[0] === 'redeemInvite') < calls.findIndex((c) => c[0] === 'roleOf'),
  '3h after joining, the role in the answer is the membership resolver\'s, read after the join (the same reading status gives), never a second copy', r.json);
for (const [label, token] of [['missing', undefined], ['a number', 42], ['too long', 'hse1_' + 'a'.repeat(200)]]) {
  r = await ask(deps(), { action: 'redeem', token });
  ok(r.status === 400 && r.json.error === 'invite_unusable' && named('redeemInvite').length === 0, '3e a ' + label + ' token is refused before the database is asked');
}
for (const [Err, status, error] of [[E.InviteUnusable, 400, 'invite_unusable'], [E.AlreadyAMember, 409, 'already_a_member'], [E.SeatLimitReached, 409, 'seat_limit_reached']]) {
  r = await ask(deps({ redeemInvite: async () => { throw new Err('x'); } }), { action: 'redeem', token: TOKEN });
  ok(r.status === status && r.json.error === error && named('trialOf').length === 0 && named('roleOf').length === 0, '3f ' + Err.name + ' → ' + status + ' ' + error + ', and no trial or role is read');
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
const USER = [/\/auth\/v1\/user$/, () => json({ id: UID, email: 'agent@example.test', email_confirmed_at: '2026-10-01T00:00:00Z' })];
const NOT_ADMIN = [/dashboard_admins/, () => json([])];
const USAGE = [/\/rest\/v1\/rpc\/evaluation_usage$/, () => json([{ evaluation_id: 'e0000000-0000-4000-8000-000000000001', status: 'active', credit_limit: 10, credits_used: 5, credits_remaining: 5, expires_at: null, expired: false }])];
const MEMBER = (role = 'agent') => [/\/rest\/v1\/rpc\/brokerage_membership_of$/, () => json([{ brokerage_id: 'b0000000-0000-4000-8000-000000000002', role }])];
async function real(routes, body) {
  seen.length = 0;
  const h = H.makeHandler(D.makeDeps({ url: 'https://proj.supabase.co/', serviceKey: 'svc-key' }, stubFetch(routes)));
  const res = await h(new Request('https://x/f', { method: 'POST', headers: { authorization: 'Bearer user-token', 'content-type': 'application/json' }, body: JSON.stringify(body) }));
  return { status: res.status, json: JSON.parse(await res.text()) };
}
r = await real([USER, NOT_ADMIN, USAGE, MEMBER('owner')], { action: 'status' });
ok(r.status === 200 && r.json.access === 'trial' && r.json.trial.credits_remaining === 5 && r.json.role === 'owner', '4a status through the real data layer, with the role', r.json);
ok(JSON.stringify(seen.map((s) => s.method + ' ' + s.path.split('?')[0])) === JSON.stringify(['GET /auth/v1/user', 'GET /rest/v1/dashboard_admins', 'POST /rest/v1/rpc/evaluation_usage', 'POST /rest/v1/rpc/brokerage_membership_of']),
  '4b exactly four requests: who the token belongs to, the allow-list, evaluation_usage, and the membership resolver for the role', seen.map((s) => s.path));
ok(seen[0].headers.Authorization === 'Bearer user-token' && seen[2].headers.Authorization === 'Bearer svc-key' && JSON.stringify(seen[2].body) === JSON.stringify({ p_user_id: UID })
   && seen[3].headers.Authorization === 'Bearer svc-key' && JSON.stringify(seen[3].body) === JSON.stringify({ p_user_id: UID }),
  '4c the user lookup carries the person\'s token; both database calls carry the service key and ask by the person\'s id');
ok(!/e0000000|b0000000/.test(JSON.stringify(r.json)), '4d neither the evaluation id nor the brokerage id the database returned reaches the answer');
const REDEEM_OK = [/\/rest\/v1\/rpc\/evaluation_invite_redeem$/, () => json([{ evaluation_id: 'e0000000-0000-4000-8000-000000000001', brokerage_id: 'b0000000-0000-4000-8000-000000000002', role: 'agent', replayed: false }])];
r = await real([USER, NOT_ADMIN, REDEEM_OK, USAGE, MEMBER()], { action: 'redeem', token: TOKEN });
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
r = await real([USER, NOT_ADMIN, [/evaluation_invite_redeem/, () => json([{ role: 'boss', replayed: false }])], USAGE, MEMBER()], { action: 'redeem', token: TOKEN });
ok(r.status === 502, '4k an answer of the wrong shape (an unknown role) is unavailable, not a success (every later read would succeed)');
for (const bad of [[{ role: 'boss', replayed: false }], [{ role: 'agent', replayed: 'no' }], [{ role: 'agent', replayed: false }, { role: 'agent', replayed: false }], []]) {
  let thrown = null;
  try { await E.makeEvaluationReads(async () => ({ data: bad, error: null })).redeemInvite(TOKEN, UID); } catch (e) { thrown = e; }
  ok(thrown instanceof H.DataUnavailable, '4k2 the shared module refuses a join answer of the wrong shape: ' + JSON.stringify(bad));
}
r = await real([USER, NOT_ADMIN, [/evaluation_usage/, () => json([{ status: 'active' }])]], { action: 'status' });
ok(r.status === 502, '4l a trial row of the wrong shape is unavailable, not "no trial"');
r = await real([USER, NOT_ADMIN, [/evaluation_usage/, () => json([])]], { action: 'status' });
ok(r.status === 200 && r.json.access === 'none' && r.json.role === null && !seen.some((x) => /brokerage_membership_of/.test(x.path)), '4m no row: no trial, no role, and the resolver is not asked');
for (const [label, route] of [['an unknown role', () => json([{ brokerage_id: 'b0000000-0000-4000-8000-000000000002', role: 'boss' }])],
  ['two rows', () => json([{ role: 'owner' }, { role: 'agent' }])], ['a refusal', () => json({ message: 'nope' }, 400)], ['a 5xx', () => json({ message: 'down' }, 503)],
  ['not a list', () => json({ role: 'owner' })]]) {
  r = await real([USER, NOT_ADMIN, USAGE, [/brokerage_membership_of/, route]], { action: 'status' });
  ok(r.status === 502 && r.json.error === 'data_unavailable', '4o the membership resolver answering with ' + label + ': 502, never a guessed role', r.json);
}
r = await real([USER, NOT_ADMIN, USAGE, [/brokerage_membership_of/, () => json([])]], { action: 'status' });
ok(r.status === 200 && r.json.role === null, '4p the resolver answering no membership (a race with a removal): no role, not an error', r.json);

{
  const reads = E.makeEvaluationReads(async () => ({ data: [{ evaluation_id: 'e0000000-0000-4000-8000-000000000001', brokerage_id: 'b0000000-0000-4000-8000-000000000002', role: 'owner', replayed: true }], error: null }));
  const got = await reads.redeemInvite(TOKEN, UID);
  ok(JSON.stringify(got) === JSON.stringify({ role: 'owner', replayed: true }), '4n the shared module itself returns only the role and whether it was a replay: no id leaves it, whoever calls it', got);
}

// ---- 5. trialStanding --------------------------------------------------------------------------------------------------------------------------------
const S = (status, expired) => G.trialStanding({ status, credits_used: 0, credits_remaining: 10, expired });
ok(S('active', false) === 'active' && S('active', true) === 'ended' && S('complete', false) === 'complete' && S('complete', true) === 'complete'
   && S('revoked', false) === 'ended' && S('paid', false) === 'ended' && S('', false) === 'ended',
  '5a trialStanding: active only when the status says active and it has not expired; a used-up trial is complete; anything else, including a status this code does not know, has ended');
const gateSrc = (await import('node:fs')).readFileSync(new URL('../supabase/functions/_shared/admin-gate.ts', import.meta.url), 'utf8');
ok((gateSrc.match(/trialStanding\(/g) || []).length === 2 && /const standing = trialStanding\(trial\);/.test(gateSrc),
  '5b the report gate reads a trial through trialStanding and nothing else (its definition plus its one use)');

// ---- 6. create (build step 5d): an admin creates a brokerage's trial and its owner invite -----------------------------------------------------------
const LINK = 'https://homesignal.net/development-activity-reports.html#invite=' + TOKEN;
const admin = (over = {}) => deps({ isAdmin: async () => true, ...over });
r = await ask(deps(), { action: 'create', brokerage_name: 'Acme Realty' });
ok(r.status === 403 && r.json.error === 'forbidden' && named('createTrial').length === 0, '6a a signed-in person who is not an admin cannot create a trial: 403, and the database is not asked', r.json);
r = await ask(deps(), { action: 'create', brokerage_name: '', seat_limit: 'x' });
ok(r.status === 403 && named('createTrial').length === 0, '6b and is refused before any field is looked at (a broken request from a non-admin is 403, not 400)', r.json);
r = await ask(deps({ isAdmin: async () => true, authenticate: async () => null }), { action: 'create', brokerage_name: 'Acme Realty' });
ok(r.status === 401 && named('createTrial').length === 0, '6c the public anon key (no user) cannot create a trial: 401');
r = await ask(admin(), { action: 'create', brokerage_name: '  Acme Realty  ', seat_limit: 5, trial_days: 30 });
ok(r.status === 200 && r.json.status === 'OK' && r.json.brokerage_name === 'Acme Realty' && r.json.seat_limit === 5 && r.json.trial_ends_at === '2026-11-01T12:00:00.000Z'
   && r.json.invite_link === LINK && r.json.invite_expires_at === '2026-10-16T12:00:00+00:00',
  '6d an admin creates a trial: the trimmed name, the seat limit, the end date 30 days from now, and the owner invite link with its expiry', r.json);
ok(JSON.stringify(named('createTrial').map((c) => c[1])) === JSON.stringify([{ brokerageName: 'Acme Realty', seatLimit: 5, expiresAt: '2026-11-01T12:00:00.000Z' }]),
  '6e the database is asked once, with exactly the checked fields', named('createTrial'));
ok(JSON.stringify(Object.keys(r.json).sort()) === JSON.stringify(['brokerage_name', 'invite_expires_at', 'invite_link', 'seat_limit', 'status', 'trial_ends_at'])
   && named('trialOf').length === 0, '6f the answer holds only those fields (no id of any kind), and no trial is read', Object.keys(r.json));
r = await ask(admin(), { action: 'create', brokerage_name: 'Acme Realty' });
ok(r.status === 200 && r.json.seat_limit === null && r.json.trial_ends_at === null
   && JSON.stringify(named('createTrial')[0][1]) === JSON.stringify({ brokerageName: 'Acme Realty', seatLimit: null, expiresAt: null }),
  '6g with only a name: no seat limit and no end date (D-L2, D-L3); nothing is invented', r.json);
r = await ask(admin(), { action: 'create', brokerage_name: 'Acme Realty', seat_limit: null, trial_days: null });
ok(r.status === 200 && JSON.stringify(named('createTrial')[0][1]) === JSON.stringify({ brokerageName: 'Acme Realty', seatLimit: null, expiresAt: null }), '6h null means none, the same as leaving a field out');
const BAD = [
  ['brokerage_name', 'missing', { brokerage_name: undefined }], ['brokerage_name', 'empty', { brokerage_name: '' }], ['brokerage_name', 'only spaces', { brokerage_name: '   ' }],
  ['brokerage_name', 'too long', { brokerage_name: 'A'.repeat(H.NAME_MAX + 1) }], ['brokerage_name', 'a line break', { brokerage_name: 'Acme\nRealty' }],
  ['brokerage_name', 'a control character', { brokerage_name: 'Acme\u0007Realty' }], ['brokerage_name', 'a number', { brokerage_name: 5 }],
  ['seat_limit', 'negative', { seat_limit: -1 }], ['seat_limit', 'a fraction', { seat_limit: 1.5 }], ['seat_limit', 'text', { seat_limit: '5' }],
  ['seat_limit', 'over the bound', { seat_limit: H.SEATS_MAX + 1 }], ['seat_limit', 'true', { seat_limit: true }],
  ['trial_days', 'zero', { trial_days: 0 }], ['trial_days', 'over a year', { trial_days: H.DAYS_MAX + 1 }], ['trial_days', 'a fraction', { trial_days: 2.5 }],
  ['trial_days', 'text', { trial_days: '30' }], ['trial_days', 'false', { trial_days: false }],
];
for (const [field, label, extra] of BAD) {
  r = await ask(admin(), { action: 'create', brokerage_name: 'Acme Realty', ...extra });
  ok(r.status === 400 && r.json.error === 'bad_request' && r.json.detail === field && named('createTrial').length === 0,
    '6i ' + field + ' ' + label + ': 400 naming the field, and the database is not asked', r.json);
}
for (const [label, extra, want] of [['a 120-character name', { brokerage_name: 'A'.repeat(H.NAME_MAX) }, { brokerageName: 'A'.repeat(H.NAME_MAX) }],
  ['no agent seats (owner only)', { seat_limit: 0 }, { seatLimit: 0 }], ['the largest seat limit', { seat_limit: H.SEATS_MAX }, { seatLimit: H.SEATS_MAX }],
  ['one day', { trial_days: 1 }, { expiresAt: '2026-10-03T12:00:00.000Z' }], ['a year', { trial_days: H.DAYS_MAX }, { expiresAt: '2027-10-02T12:00:00.000Z' }]]) {
  r = await ask(admin(), { action: 'create', brokerage_name: 'Acme Realty', ...extra });
  const got = named('createTrial')[0] && named('createTrial')[0][1];
  ok(r.status === 200 && got && Object.entries(want).every(([k, v]) => got[k] === v), '6j accepted at the edge: ' + label, got);
}
ok(H.NAME_MAX === 120 && H.SEATS_MAX === 1000 && H.DAYS_MAX === 365, '6k the input bounds are the ones documented (input checks, not product limits)');
r = await ask(admin({ createTrial: async () => { throw new E.TrialRejected('x'); } }), { action: 'create', brokerage_name: 'Acme Realty' });
ok(r.status === 422 && r.json.error === 'rejected', '6l the database refusing to create the trial: 422 "rejected" (its function is one transaction, so nothing was created)', r.json);
r = await ask(admin({ createTrial: async () => { throw new H.DataUnavailable('x'); } }), { action: 'create', brokerage_name: 'Acme Realty' });
ok(r.status === 502 && r.json.error === 'data_unavailable', '6m the database unreachable: 502, never "rejected" (the trial may or may not exist)', r.json);
r = await ask(admin({ createTrial: async () => { throw new Error('boom ' + TOKEN); } }), { action: 'create', brokerage_name: 'Acme Realty' });
ok(r.status === 500 && r.json.error === 'internal' && !r.text.includes(TOKEN), '6n an unexpected failure: 500, and its message is not returned');

// the real data layer
const IS_ADMIN = [/dashboard_admins/, () => json([{ email: 'agent@example.test' }])];
const CREATED = [/\/rest\/v1\/rpc\/evaluation_create$/, () => json([{ evaluation_id: 'e0000000-0000-4000-8000-000000000001', brokerage_id: 'b0000000-0000-4000-8000-000000000002',
  invite_id: 'f0000000-0000-4000-8000-000000000003', owner_token: TOKEN, invite_expires_at: '2026-10-16T12:00:00.123456+00:00' }])];
r = await real([USER, IS_ADMIN, CREATED], { action: 'create', brokerage_name: 'Acme Realty', seat_limit: 3 });
ok(r.status === 200 && r.json.invite_link === LINK && r.json.invite_expires_at === '2026-10-16T12:00:00.123456+00:00' && r.json.seat_limit === 3,
  '6o create through the real data layer: the owner invite comes back as the link', r.json);
ok(JSON.stringify(seen.map((x) => x.method + ' ' + x.path.split('?')[0])) === JSON.stringify(['GET /auth/v1/user', 'GET /rest/v1/dashboard_admins', 'POST /rest/v1/rpc/evaluation_create']),
  '6p exactly three requests: who the token belongs to, the allow-list, and evaluation_create', seen.map((x) => x.path));
const createReq = seen.find((x) => /evaluation_create/.test(x.path));
ok(createReq.headers.Authorization === 'Bearer svc-key' && JSON.stringify(createReq.body) === JSON.stringify({ p_brokerage_name: 'Acme Realty', p_seat_limit: 3, p_expires_at: null }),
  '6q evaluation_create is called with the service key and exactly the name, seat limit and end date (the invite lifetime is the database\'s own default)', createReq.body);
ok(!/e0000000|b0000000|f0000000/.test(JSON.stringify(r.json)), '6r none of the three ids the database returned reaches the answer');
r = await real([USER, NOT_ADMIN, CREATED], { action: 'create', brokerage_name: 'Acme Realty' });
ok(r.status === 403 && !seen.some((x) => /evaluation_create/.test(x.path)), '6s a signed-in person not on the allow-list: 403, and evaluation_create is never called');
for (const [label, route, status] of [
  ['a refusal (HTTP 400 with a message)', () => json({ code: '23514', message: 'new row violates check constraint' }, 400), 422],
  ['a 5xx', () => json({ message: 'down' }, 503), 502], ['the network failing', () => { throw new Error('reset'); }, 502],
  ['a token of the wrong shape', () => json([{ owner_token: 'hse1_short', invite_expires_at: '2026-10-16T12:00:00+00:00' }]), 502],
  ['no expiry', () => json([{ owner_token: TOKEN }]), 502], ['two rows', () => json([{ owner_token: TOKEN, invite_expires_at: '2026-10-16' }, { owner_token: TOKEN, invite_expires_at: '2026-10-16' }]), 502],
  ['no row', () => json([]), 502]]) {
  r = await real([USER, IS_ADMIN, [/evaluation_create/, route]], { action: 'create', brokerage_name: 'Acme Realty' });
  ok(r.status === status && !JSON.stringify(r.json).includes('hse1_'), '6t the database answering with ' + label + ' → ' + status + ', and no token in the answer', r.json);
}

// the one form of the invite link, and the page that reads it
ok(E.INVITE_PAGE === 'https://homesignal.net/development-activity-reports.html' && E.inviteLink(TOKEN) === LINK, '6u the invite link is the customer page with the token in the fragment');
let threw = false; try { E.inviteLink('hse1_nope'); } catch (e) { threw = e instanceof H.DataUnavailable; }
ok(threw, '6v a token of the wrong shape is never made into a link');
{
  const fs = await import('node:fs');
  const page = fs.readFileSync(new URL('../development-activity-reports.html', import.meta.url), 'utf8');
  const stager = fs.readFileSync(new URL('../scripts/stage_site.py', import.meta.url), 'utf8');
  const m = /var m = (\/[^\n]*\/)\.exec\(location\.hash \|\| ''\);/.exec(page);
  const read = m && new Function('h', 'var x = ' + m[1] + '.exec(h); return x && x[1];');
  ok(read && read(new URL(LINK).hash) === TOKEN && stager.includes("'development-activity-reports.html'"),
    '6w the customer page reads exactly this link: its own fragment reader, run on the link\'s fragment, gives back the token (and the page is staged)');
}
ok(/action: "create"/.test(H.CAPABILITY.method) && /admin/.test(H.CAPABILITY.access) && H.CAPABILITY.writes.some((w) => /owner invite/.test(w)) && !/evaluation_/.test(JSON.stringify(H.CAPABILITY)),
  '6x the capability names the create action, says it is for admins, lists what it writes, and names no database function');

// ---- 7. invite (build step 5e): a trial owner invites an agent ------------------------------------------------------------------------------------
r = await ask(deps({ trialOf: async () => null }), { action: 'invite' });
ok(r.status === 403 && r.json.error === 'forbidden' && named('inviteAgent').length === 0, '7a a person with no trial cannot invite: 403, and no invite is asked for', r.json);
for (const [label, trial] of [['used up', { status: 'complete', credits_used: 10, credits_remaining: 0, expired: false }],
  ['revoked', { status: 'revoked', credits_used: 2, credits_remaining: 8, expired: false }], ['expired', { status: 'active', credits_used: 2, credits_remaining: 8, expired: true }]]) {
  r = await ask(deps({ trialOf: async () => trial }), { action: 'invite' });
  ok(r.status === 409 && r.json.error === 'trial_not_active' && named('inviteAgent').length === 0, '7b a ' + label + ' trial: 409 trial_not_active, and no invite is asked for (an agent joining it could make no report)', r.json);
}
r = await ask(deps(), { action: 'invite' });
ok(r.status === 200 && r.json.status === 'OK' && r.json.invite_link === E.inviteLink(TOKEN) && r.json.invite_expires_at === '2026-10-16T12:00:00+00:00',
  '7c an owner of an active trial: the agent invite link and its expiry', r.json);
ok(JSON.stringify(Object.keys(r.json).sort()) === '["invite_expires_at","invite_link","status"]' && JSON.stringify(named('inviteAgent').map((c) => c.slice(1))) === JSON.stringify([[UID]]),
  '7d the answer holds only the link and its expiry (no id), and the invite is asked for once, for the signed-in person\'s own id', r.json);
ok(named('roleOf').length === 0 && named('trialOf').length === 1 && calls.findIndex((c) => c[0] === 'trialOf') < calls.findIndex((c) => c[0] === 'inviteAgent'),
  '7e the handler checks only that the trial is active, then asks; whether this person is an OWNER is the database\'s check when the invite is made, not re-derived here');
r = await ask(deps({ inviteAgent: async () => { throw new E.NotEntitled('x'); } }), { action: 'invite' });
ok(r.status === 403 && r.json.error === 'not_owner', '7f the database refusing (an agent, an owner of another brokerage, a trial that ended meanwhile): 403 not_owner', r.json);
r = await ask(deps({ inviteAgent: async () => { throw new H.DataUnavailable('x'); } }), { action: 'invite' });
ok(r.status === 502 && r.json.error === 'data_unavailable', '7g the database unreachable: 502, never "not an owner"', r.json);
r = await ask(deps({ inviteAgent: async () => { throw new Error('boom ' + TOKEN); } }), { action: 'invite' });
ok(r.status === 500 && r.json.error === 'internal' && !r.text.includes(TOKEN), '7h an unexpected failure: 500, and its message is not returned');
r = await ask(deps({ trialOf: async () => null, isAdmin: async () => true }), { action: 'invite' });
ok(r.status === 403 && named('inviteAgent').length === 0, '7i being an admin does not make an invite: an admin with no trial is refused like anyone else');
r = await ask(deps(), { action: 'invite', role: 'owner', p_role: 'owner', p_actor: 'b0000000-0000-4000-8000-000000000002', token: TOKEN });
ok(r.status === 200 && JSON.stringify(named('inviteAgent').map((c) => c.slice(1))) === JSON.stringify([[UID]]),
  '7j nothing the caller sends reaches the invite: a requested role, actor or token is ignored (an owner can invite agents only)');

// the real data layer
const MINTED = [/\/rest\/v1\/rpc\/evaluation_invite_mint$/, () => json([{ invite_id: 'f0000000-0000-4000-8000-000000000003', token: TOKEN, expires_at: '2026-10-16T12:00:00.123456+00:00' }])];
r = await real([USER, NOT_ADMIN, USAGE, MINTED], { action: 'invite' });
ok(r.status === 200 && r.json.invite_link === LINK && r.json.invite_expires_at === '2026-10-16T12:00:00.123456+00:00', '7k invite through the real data layer: the agent invite comes back as the link', r.json);
ok(JSON.stringify(seen.map((x) => x.method + ' ' + x.path.split('?')[0])) === JSON.stringify(['GET /auth/v1/user', 'GET /rest/v1/dashboard_admins', 'POST /rest/v1/rpc/evaluation_usage', 'POST /rest/v1/rpc/evaluation_usage', 'POST /rest/v1/rpc/evaluation_invite_mint']),
  '7l exactly five requests: who the token belongs to, the allow-list, the trial (the handler\'s active check), the trial again (the shared module finds its evaluation), and evaluation_invite_mint', seen.map((x) => x.path));
const mintReq = seen.find((x) => /evaluation_invite_mint/.test(x.path));
ok(mintReq.headers.Authorization === 'Bearer svc-key' && JSON.stringify(mintReq.body) === JSON.stringify({ p_evaluation_id: 'e0000000-0000-4000-8000-000000000001', p_role: 'agent', p_actor: UID }),
  '7m evaluation_invite_mint is called with the service key, the person\'s own evaluation, the role AGENT and the person as the ACTOR, so the database checks they are an owner of it (the lifetime is the database\'s default)', mintReq.body);
ok(!/e0000000|b0000000|f0000000/.test(JSON.stringify(r.json)), '7n none of the ids the database returned reaches the answer');
for (const [label, route, status, error] of [
  ['NOT_ENTITLED (HTTP 400)', () => json({ code: 'EV003', message: 'NOT_ENTITLED' }, 400), 403, 'not_owner'],
  ['another refusal', () => json({ code: '22023', message: 'evaluation_invite_mint: the role must be owner or agent' }, 400), 502, 'data_unavailable'],
  ['a 5xx', () => json({ message: 'down' }, 503), 502, 'data_unavailable'], ['the network failing', () => { throw new Error('reset'); }, 502, 'data_unavailable'],
  ['a token of the wrong shape', () => json([{ token: 'hse1_short', expires_at: '2026-10-16T12:00:00+00:00' }]), 502, 'data_unavailable'],
  ['no expiry', () => json([{ token: TOKEN }]), 502, 'data_unavailable'], ['no row', () => json([]), 502, 'data_unavailable'],
  ['two rows', () => json([{ token: TOKEN, expires_at: '2026-10-16' }, { token: TOKEN, expires_at: '2026-10-16' }]), 502, 'data_unavailable']]) {
  r = await real([USER, NOT_ADMIN, USAGE, [/evaluation_invite_mint/, route]], { action: 'invite' });
  ok(r.status === status && r.json.error === error && !JSON.stringify(r.json).includes('hse1_'), '7o the database answering with ' + label + ' → ' + status + ' ' + error + ', and no token in the answer', r.json);
}
{
  const asked = [];
  const reads = (usage) => E.makeEvaluationReads(async (fn, args) => { asked.push(fn); if (fn === 'evaluation_usage') return usage; return { data: [{ token: TOKEN, expires_at: '2026-10-16T12:00:00Z' }], error: null }; });
  let got = null;
  try { await reads({ data: [], error: null }).inviteAgent(UID); } catch (e) { got = e; }
  ok(got instanceof E.NotEntitled && !asked.includes('evaluation_invite_mint'), '7p the shared module: no trial is NotEntitled, and no invite is asked for');
  asked.length = 0; got = null;
  try { await reads({ data: [{ evaluation_id: 'not-a-uuid', status: 'active' }], error: null }).inviteAgent(UID); } catch (e) { got = e; }
  ok(got instanceof H.DataUnavailable && !asked.includes('evaluation_invite_mint'), '7q the shared module: an evaluation id of the wrong shape is unavailable, and never sent to the mint');
  asked.length = 0;
  const made = await reads({ data: [{ evaluation_id: 'e0000000-0000-4000-8000-000000000001', status: 'active' }], error: null }).inviteAgent(UID);
  ok(JSON.stringify(made) === JSON.stringify({ invite_link: LINK, invite_expires_at: '2026-10-16T12:00:00Z' }) && JSON.stringify(asked) === '["evaluation_usage","evaluation_invite_mint"]',
    '7r the shared module returns only the link and its expiry: the evaluation id it used stays inside it', made);
}
ok(/action: "invite"/.test(H.CAPABILITY.method) && /owner/.test(H.CAPABILITY.access) && H.CAPABILITY.writes.some((w) => /agent invite/.test(w)) && !/evaluation_/.test(JSON.stringify(H.CAPABILITY)),
  '7s the capability names the invite action, says it is for an owner, lists what it writes, and names no database function');

// ---- 8. the team (audit item D, docs/da-owner-safeguards.sql part A): list, remove an agent, withdraw an invite ------------------------------------------
r = await ask(deps(), { action: 'team' });
ok(r.status === 200 && r.json.status === 'OK' && JSON.stringify(Object.keys(r.json).sort()) === '["invites","members","status"]' && r.json.members[0].label === 'a***@example.test'
   && r.json.members[0].ref === M1 && r.json.invites[0].ref === I1 && named('teamOf').length === 1 && named('teamOf')[0][1] === UID,
  '8a an owner is shown their team: the agents as masked labels and the open invites, each with an opaque handle - for the person the token names, never one the request names');
ok(!/@.*\./.test(r.json.members[0].label.replace('***@example.test', '')) && !/hse1_/.test(r.text) && r.cache === 'no-store', '8b no address and no invite token is in the list, and it is never cached');
r = await ask(deps({ teamOf: async () => { throw new E.NotEntitled('x'); } }), { action: 'team' });
ok(r.status === 403 && r.json.error === 'not_allowed', '8c anyone who is not an owner is refused 403, and the database - not the handler - says who is an owner');
r = await ask(deps({ teamOf: async () => { throw new H.DataUnavailable('x'); } }), { action: 'team' });
ok(r.status === 502 && r.json.error === 'data_unavailable', '8d a team that cannot be read is 502, never an empty team');
r = await ask(deps({ teamOf: async () => { throw new Error('boom ' + M1); } }), { action: 'team' });
ok(r.status === 500 && r.json.error === 'internal' && !r.text.includes(M1), '8e any other failure is 500 and its message is never shown');
r = await ask(deps(), { action: 'remove_member', member: M1 });
ok(r.status === 200 && r.json.removed === true && JSON.stringify(Object.keys(r.json).sort()) === '["removed","status"]' && JSON.stringify(named('removeMember').map((c) => c.slice(1))) === JSON.stringify([[UID, M1]]),
  '8f an owner removes an agent: the database is asked with the person the token names (the ACTOR) and the handle, and the answer says only whether this call did it');
r = await ask(deps({ removeMember: async () => false }), { action: 'remove_member', member: M1 });
ok(r.status === 200 && r.json.removed === false, '8g removing someone already removed is a clean false, not an error');
r = await ask(deps({ removeMember: async () => { throw new E.NotEntitled('x'); } }), { action: 'remove_member', member: M1 });
ok(r.status === 403 && r.json.error === 'not_allowed', '8h a handle that is not theirs to remove (another brokerage, an owner, themselves, unknown) is one answer: 403 not_allowed');
let badBodies = 0;
for (const b of [{ action: 'remove_member' }, { action: 'remove_member', member: 'x' }, { action: 'remove_member', member: 5 }, { action: 'remove_member', member: M1, actor: UID }, { action: 'remove_member', invite: I1 }, { action: 'remove_member', member: [M1] }]) {
  r = await ask(deps(), b);
  if (r.status === 400 && named('removeMember').length === 0) badBodies++;
}
ok(badBodies === 6, '8i a missing, malformed or extra field is 400 before the database is asked (six bodies) - the caller cannot name the actor', badBodies);
r = await ask(deps(), { action: 'withdraw_invite', invite: I1 });
ok(r.status === 200 && r.json.withdrawn === true && JSON.stringify(Object.keys(r.json).sort()) === '["status","withdrawn"]' && JSON.stringify(named('withdrawInvite').map((c) => c.slice(1))) === JSON.stringify([[UID, I1]]),
  '8j an owner withdraws an open invite: the actor is the token\'s person, the handle is the invite');
r = await ask(deps({ withdrawInvite: async () => false }), { action: 'withdraw_invite', invite: I1 });
ok(r.status === 200 && r.json.withdrawn === false, '8k an invite no longer open is a clean false');
r = await ask(deps({ withdrawInvite: async () => { throw new E.NotEntitled('x'); } }), { action: 'withdraw_invite', invite: I1 });
ok(r.status === 403 && r.json.error === 'not_allowed', '8l an invite that is not theirs is 403 not_allowed');
r = await ask(deps(), { action: 'withdraw_invite', member: M1 });
ok(r.status === 400 && named('withdrawInvite').length === 0, '8m a withdrawal carries an invite handle, not a member handle');
ok(['team', 'remove_member', 'withdraw_invite'].every((a) => H.CAPABILITY.method.includes(a)) && H.CAPABILITY.writes.length === 5, '8n the capability lists the three new actions and what they write');
r = await ask(deps({ isAdmin: async () => true }), { action: 'team' });
ok(named('teamOf').length === 1, '8o being an admin does not skip the database\'s ownership check: it is asked for an admin too');
// the real data layer
const ROW_M = { kind: 'member', ref: M1, role: 'agent', label: 'a***@example.test', at: '2026-10-03T12:00:00+00:00', expires_at: null };
const ROW_I = { kind: 'invite', ref: I1, role: 'agent', label: null, at: '2026-10-04T12:00:00+00:00', expires_at: '2026-10-18T12:00:00+00:00' };
r = await real([USER, NOT_ADMIN, [/\/rest\/v1\/rpc\/brokerage_team_of$/, () => json([ROW_M, ROW_I])]], { action: 'team' });
ok(r.status === 200 && r.json.members.length === 1 && r.json.invites.length === 1 && JSON.stringify(seen.map((x) => x.path.split('?')[0]).slice(-1)) === '["/rest/v1/rpc/brokerage_team_of"]'
   && JSON.stringify(seen.at(-1).body) === JSON.stringify({ p_actor: UID }) && seen.at(-1).headers.Authorization === 'Bearer svc-key',
  '8p the real data layer: ONE call to brokerage_team_of with the person as actor, with the service key');
let bad8 = 0;
for (const rows of [[{ ...ROW_M, role: 'owner' }], [{ ...ROW_M, kind: 'other' }], [{ ...ROW_M, ref: 'x' }], [{ ...ROW_M, label: '' }], [{ ...ROW_M, expires_at: '2026-10-18T12:00:00+00:00' }], [{ ...ROW_I, label: 'x@y.z' }], [{ ...ROW_I, expires_at: null }], [{ ...ROW_M, at: 'soon' }], [null], 'x']) {
  r = await real([USER, NOT_ADMIN, [/brokerage_team_of$/, () => json(rows)]], { action: 'team' });
  if (r.status === 502 && r.json.error === 'data_unavailable') bad8++;
}
ok(bad8 === 10, '8q a row of the wrong shape (an owner, an unknown kind, a bad handle, an empty label, an invite with a label, a member with an expiry, ...) is a fault, never a team (ten shapes)', bad8);
r = await real([USER, NOT_ADMIN, [/brokerage_team_of$/, () => json({ code: 'EV003', message: 'NOT_ENTITLED' }, 400)]], { action: 'team' });
ok(r.status === 403 && r.json.error === 'not_allowed', '8r the database answering NOT_ENTITLED is 403 not_allowed');
r = await real([USER, NOT_ADMIN, [/brokerage_member_remove$/, () => json(true)]], { action: 'remove_member', member: M1 });
ok(r.status === 200 && r.json.removed === true && JSON.stringify(seen.at(-1).body) === JSON.stringify({ p_actor: UID, p_member_id: M1 }), '8s removal is ONE call to brokerage_member_remove with the actor and the handle');
r = await real([USER, NOT_ADMIN, [/evaluation_invite_revoke$/, () => json(true)]], { action: 'withdraw_invite', invite: I1 });
ok(r.status === 200 && r.json.withdrawn === true && JSON.stringify(seen.at(-1).body) === JSON.stringify({ p_invite_id: I1, p_actor: UID }), '8t withdrawal is ONE call to the existing evaluation_invite_revoke with the invite and the actor');
let bad9 = 0;
for (const [fn, body] of [['brokerage_member_remove', { action: 'remove_member', member: M1 }], ['evaluation_invite_revoke', { action: 'withdraw_invite', invite: I1 }]]) {
  for (const route of [() => json({ message: 'down' }, 503), () => json('yes'), () => json(null), () => json({ code: 'EV003', message: 'NOT_ENTITLED' }, 400)]) {
    r = await real([USER, NOT_ADMIN, [new RegExp(fn + '$'), route]], body);
    if ((r.status === 502 && r.json.error === 'data_unavailable') || (r.status === 403 && r.json.error === 'not_allowed')) bad9++;
  }
}
ok(bad9 === 8, '8u a 5xx or a non-boolean answer is a fault (502) and a NOT_ENTITLED is 403 - never "done" (eight cases)', bad9);

console.log('\n' + (n - bad) + ' passed, ' + bad + ' failed of ' + n);
process.exit(bad ? 1 : 0);
