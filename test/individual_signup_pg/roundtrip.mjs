// SIGNUP -> REPORT THROUGH THE REAL LAYERS (Order L2, docs/individual-agent-signup.sql).
// A person who has never been anything on HomeSignal signs in (a confirmed email), presses nothing but "sign up", and gets: an individual account,
// the owner membership, and the 10-report evaluation, from ONE call to the real trial function. Then they make ten reports through the real
// report function (whose network is translated to the same database functions PostgREST would call), the eleventh free one is refused, the
// billing function offers them the existing $79 plan as the OWNER, and nothing lets them build a team. Every assertion is about what the database holds.
//   Run through: bash test/individual_signup_pg/run-roundtrip.sh
import { spawnSync } from 'node:child_process';
import { LAUNCH_TEST_LOCATION as LOC, geocodeStandIn } from '../lib/launch-test-location.mjs';

const H = await import('../../supabase/functions/get-development-activity-report/handler.ts');
const D = await import('../../supabase/functions/get-development-activity-report/data.ts');
const TH = await import('../../supabase/functions/development-activity-trial/handler.ts');
const TD = await import('../../supabase/functions/development-activity-trial/data.ts');
const BH = await import('../../supabase/functions/manage-billing/handler.ts');
const BD = await import('../../supabase/functions/manage-billing/data.ts');

let n = 0, bad = 0;
const ok = (c, m, d) => { n++; if (c) console.log('PASS — ' + m); else { bad++; console.log('FAIL — ' + m + (d !== undefined ? '  [' + JSON.stringify(d) + ']' : '')); } };

function psql(query, vars = {}) {
  const args = ['-X', '-q', '-tA', '-v', 'ON_ERROR_STOP=1'];
  for (const [k, v] of Object.entries(vars)) args.push('-v', k + '=' + v);
  const r = spawnSync('psql', [...args, '-f', '-'], { input: query, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { ok: r.status === 0, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}
const one = (q, v) => { const r = psql(q, v); if (!r.ok) throw new Error('psql: ' + r.err); return r.out; };
const J = "select coalesce(json_agg(row_to_json(t)), '[]') from ";

// the database's own functions, called the way PostgREST would call them. An UNLISTED call stops the run: that is how a second way in would show.
const RPC = {
  evaluation_usage: (a) => [J + "public.evaluation_usage(:'u'::uuid) t", { u: a.p_user_id }],
  billing_usage: (a) => [J + "public.billing_usage(:'u'::uuid) t", { u: a.p_user_id }],
  report_rate_claim: (a) => [J + "public.report_rate_claim(:'u'::uuid) t", { u: a.p_user }],
  brokerage_report_issue: (a) => [J + "public.brokerage_report_issue(:'u'::uuid, :'k'::uuid, :'b', :'h', :'v', :'i'::jsonb, nullif(:'p', '')::jsonb) t",
    { u: a.p_user_id, k: a.p_idempotency_key, b: a.p_body, h: a.p_content_hash, v: a.p_report_version, i: JSON.stringify(a.p_engine_inputs), p: a.p_private === null ? '' : JSON.stringify(a.p_private) }],
  report_private_context_read: (a) => [J + "public.report_private_context_read(:'c'::uuid) t", { c: a.p_context }],
  evaluation_reports_of: (a) => [J + "public.evaluation_reports_of(:'u'::uuid) t", { u: a.p_user_id }],
  report_header_of: (a) => [J + "public.report_header_of(:'u'::uuid) t", { u: a.p_user_id }],
  brokerage_membership_of: (a) => [J + "public.brokerage_membership_of(:'u'::uuid) t", { u: a.p_user_id }],
  brokerage_account_type_of: (a) => [J + "public.brokerage_account_type_of(:'u'::uuid) t", { u: a.p_user_id }],
  individual_signup: (a) => [J + "public.individual_signup(:'u'::uuid, :'n') t", { u: a.p_user_id, n: a.p_name }],
  evaluation_invite_mint: (a) => [J + "public.evaluation_invite_mint(p_evaluation_id => :'e'::uuid, p_role => :'r', p_actor => :'u'::uuid) t", { e: a.p_evaluation_id, r: a.p_role, u: a.p_actor }],
  billing_checkout_claim: (a) => [J + "public.billing_checkout_claim(:'b'::uuid) t", { b: a.p_brokerage }],
};
const seen = [];
const json = (v, status = 200) => new Response(JSON.stringify(v), { status });
async function fetchToSql(url, init = {}) {
  const u = new URL(url);
  seen.push(u.pathname + u.search);
  const rpc = /^\/rest\/v1\/rpc\/(\w+)$/.exec(u.pathname);
  if (rpc) {
    if (!RPC[rpc[1]]) throw new Error('unexpected rpc ' + rpc[1]);
    const [q, v] = RPC[rpc[1]](JSON.parse(init.body));
    const r = psql(q, v);
    if (!r.ok) { const m = /ERROR:\s+(.*)/.exec(r.err); return json({ code: 'P0001', message: m ? m[1].trim() : r.err }, 400); }
    return json(JSON.parse(r.out));
  }
  if (u.pathname === '/rest/v1/report_snapshot') {
    const id = u.searchParams.get('report_id').replace(/^eq\./, '');
    return json(JSON.parse(one("select coalesce(json_agg(json_build_object('body', body)), '[]') from public.report_snapshot where report_id = :'r'::uuid", { r: id })));
  }
  throw new Error('unexpected request ' + u.pathname);
}

// ---- the people ---------------------------------------------------------------------------------------------------------------------
const ANN = 'a1111111-1111-4111-8111-111111111111', UNCONFIRMED = 'b2222222-2222-4222-8222-222222222222', BEN = 'c3333333-3333-4333-8333-333333333333', LEGACY = 'd4444444-4444-4444-8444-444444444444';
one("insert into auth.users (id, email, email_confirmed_at) values (:'a'::uuid, 'ann@example.test', now()), (:'u'::uuid, 'new@example.test', null), (:'b'::uuid, 'ben@example.test', now()), (:'l'::uuid, 'legacy@example.test', now())", { a: ANN, u: UNCONFIRMED, b: BEN, l: LEGACY });
// a legacy brokerage that already exists, to prove signup touches nothing of it
const [legacyEval, legacyTok] = one("select evaluation_id || ' ' || owner_token from public.evaluation_create('Legacy Realty', 3)").split(' ');
one("select public.evaluation_invite_redeem(:'t', :'u'::uuid)", { t: legacyTok, u: LEGACY });
const legacyFp = () => one("select md5(string_agg(x, '|' order by x)) from (select a.id::text || a.name || a.account_type as x from public.brokerage_account a where a.name = 'Legacy Realty' union all select m.id::text || m.user_id::text || m.role from public.brokerage_member m where m.user_id = :'l'::uuid union all select e.evaluation_id::text || e.status || e.seat_limit::text from public.evaluation e where e.evaluation_id = :'e'::uuid) q", { l: LEGACY, e: legacyEval });
const legacyBefore = legacyFp();

async function trialAsk(userId, body) {
  const real = TD.makeDeps({ url: 'https://proj.supabase.co', serviceKey: 'svc' }, fetchToSql);
  const h = TH.makeHandler({ ...real, authenticate: async () => ({ email: 'x@example.test', id: userId }), isAdmin: async () => false });
  const res = await h(new Request('https://x/functions/v1/development-activity-trial', { method: 'POST', headers: { authorization: 'Bearer t', 'content-type': 'application/json' }, body: JSON.stringify(body) }));
  return { status: res.status, json: await res.json() };
}
async function billingAsk(userId, body) {
  const real = BD.makeDeps({ url: 'https://proj.supabase.co', serviceKey: 'svc', billing: { apiKey: '', storeId: '', variantId: '', secret: '', testMode: true } }, fetchToSql);
  const h = BH.makeHandler({ ...real, authenticate: async () => ({ email: 'x@example.test', id: userId }), isAdmin: async () => false });
  const res = await h(new Request('https://x/functions/v1/manage-billing', { method: 'POST', headers: { authorization: 'Bearer t', 'content-type': 'application/json' }, body: JSON.stringify(body) }));
  return { status: res.status, json: await res.json() };
}
const FAM = 'wsdot-project-delivery-plan-proposed';
const CLEARED = { version: 1, cleared: [{ registry_id: FAM, cleared_on: '2026-10-02', audit_ref: 'round-trip fixture', attribution: 'Data: WSDOT' }] };
const proj = { source_key: 'k1', registry_id: FAM, record_kind: 'development', name: 'Ravenna Bridge Retrofit', type: 'Utility', type_raw: null, status: 'Approved', stage: 'Advertised',
  developer: null, size: null, investment: null, submitted_at: '2026-09-24', date_kind: 'issued', address: '005 King', source_ref: 'https://data.wsdot.wa.gov/arcgis/rest/services/Shared/WSDOTProjectDeliveryPlanCurrent/FeatureServer/0' };
function reportHandler(userId) {
  const real = D.makeDeps({ url: 'https://proj.supabase.co', serviceKey: 'svc', rights: CLEARED, now: () => new Date('2026-10-02T12:00:00Z') }, fetchToSql);
  return H.makeHandler({ ...real, authenticate: async () => ({ email: 'x@example.test', id: userId }), isAdmin: async () => false,
    geocode: async (a) => geocodeStandIn(a), zipSupported: async () => true,
    radius: async () => [{ source_key: 'k1', feature_id: 'pt:1', registry_id: FAM, provenance: 'proven_stored_point', distance_mi: 0.21, geometry_type: 'Point', has_more: false }],
    hydrate: async () => [proj], ledger: async () => [], events: async () => [], health: async () => [] });
}
async function report(userId, i, address = LOC.address) {
  one('truncate public.report_rate_window');   // the rate limit has its own suites; this run is about the entitlement
  const key = '00000000-0000-4000-8000-' + String(i).padStart(12, '0');
  const res = await reportHandler(userId)(new Request('https://x/functions/v1/get-development-activity-report', { method: 'POST', headers: { authorization: 'Bearer t', 'content-type': 'application/json' }, body: JSON.stringify({ address, idempotency_key: key }) }));
  return { status: res.status, json: await res.json(), key };
}
const count = (t) => Number(one('select count(*) from public.' + t));

// ---- 1. before signing up -------------------------------------------------------------------------------------------------------------
let t = await trialAsk(ANN, { action: 'status' });
ok(t.status === 200 && t.json.access === 'none' && t.json.trial === null && t.json.account_type === null, '1a before signing up: no trial, no account, no type', t.json);
let r = await report(ANN, 1);
ok(r.status !== 200 && count('evaluation_credit') === 0 && count('report_snapshot') === 0, '1b a person with no account cannot make a report: nothing is stored, nothing is charged', [r.status, r.json.error]);
t = await billingAsk(ANN, { action: 'status' });
ok(t.status === 403, '1c and has no billing (no account, no plan)', t.json);

// ---- 2. signing up (the whole customer step) ------------------------------------------------------------------------------------
t = await trialAsk(UNCONFIRMED, { action: 'signup', name: 'New Person' });
ok(t.status === 400 && t.json.error === 'signup_refused' && count('brokerage_account') === 1, '2a an unconfirmed email is refused and writes nothing (only the legacy account exists)', t.json);
t = await trialAsk(ANN, { action: 'signup', name: '  Ann   Agent ' });
ok(t.status === 200 && t.json.replayed === false && t.json.access === 'trial' && t.json.role === 'owner' && t.json.account_type === 'individual'
   && t.json.trial.credits_used === 0 && t.json.trial.credits_remaining === 10, '2b ONE call: an individual account, owner, ten free reports', t.json);
ok(one("select a.account_type || '|' || a.name || '|' || m.role || '|' || e.status || '|' || e.seat_limit from public.brokerage_member m join public.brokerage_account a on a.id = m.brokerage_id join public.evaluation e on e.brokerage_id = a.id where m.user_id = :'u'::uuid", { u: ANN }) === 'individual|Ann Agent|owner|active|0',
  '2c the database holds the account (type individual, named by the person, cleaned), the owner membership, and an active evaluation with no seats');
ok(!/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/.test(JSON.stringify(t.json)), '2d the answer carries no id');
const acctsAfter = count('brokerage_account');
t = await trialAsk(ANN, { action: 'signup', name: 'Ann Again' });
ok(t.status === 200 && t.json.replayed === true && count('brokerage_account') === acctsAfter && count('evaluation') === 2, '2e signing up twice is a replay: still one account, never a second free pool', t.json);
ok(legacyFp() === legacyBefore, '2f the existing brokerage (account, owner, evaluation) is byte-identical after the signup');
t = await trialAsk(LEGACY, { action: 'signup', name: 'Legacy Owner' });
ok(t.status === 409 && t.json.error === 'already_a_member', '2g a member of an existing brokerage cannot also sign up for an individual account (409)', t.json);

// ---- 3. reports: the ten free ones ------------------------------------------------------------------------------------------------
r = await report(ANN, 1);
ok(r.status === 200 && r.json.charged === true && r.json.stored === true && r.json.trial.credits_used === 1 && r.json.trial.credits_remaining === 9, '3a the first report is made, stored and charged: one used, nine left', [r.status, r.json.trial, r.json.error]);
ok(JSON.stringify(r.json.header) === '{"brokerage":"Ann Agent","agent":null}', '3b the report header names the account by the person\'s own name', r.json.header);
const first = r;
for (let i = 2; i <= 10; i++) { r = await report(ANN, i); if (r.status !== 200 || r.json.trial.credits_used !== i) break; }
ok(r.status === 200 && r.json.trial.credits_used === 10 && r.json.trial.credits_remaining === 0 && count('evaluation_credit') === 10 && count('report_snapshot') === 10, '3c ten reports: ten stored, ten charged, none left', [r.status, r.json.trial, r.json.error]);
const before11 = [count('evaluation_credit'), count('report_snapshot')];
r = await report(ANN, 11);
ok(r.status !== 200 && [count('evaluation_credit'), count('report_snapshot')].join() === before11.join(), '3d the eleventh FREE report is refused: nothing stored, nothing charged', [r.status, r.json.error]);
t = await trialAsk(ANN, { action: 'status' });
ok(t.json.access === 'complete' && t.json.trial.credits_remaining === 0 && t.json.account_type === 'individual', '3f status now reads complete: free reports used', t.json);
ok(count('evaluation_credit') === 10 && Number(one("select count(*) from public.evaluation_credit c join public.evaluation e using (evaluation_id) where e.evaluation_id = :'e'::uuid", { e: legacyEval })) === 0, '3g the legacy brokerage\'s ledger was not touched by any of it');

// ---- 4. the paid plan is the existing one -----------------------------------------------------------------------------------------------
t = await billingAsk(ANN, { action: 'status' });
ok(t.status === 200 && t.json.plan.state === 'none' && t.json.plan.role === 'owner' && t.json.checkout === 'not_set_up',
  '4a billing sees the individual as the OWNER of a plan-less account, and checkout reads not_set_up because no payment provider is configured here: nothing was activated', t.json);
t = await billingAsk(ANN, { action: 'checkout' });
ok(t.status === 503 && t.json.error === 'billing_not_set_up' && !seen.some((s) => /billing_checkout_claim/.test(s)), '4b a checkout cannot be started without the provider configured: refused (503) before any slot or processor call', t.json);

// ---- 5. a team cannot form in an individual account --------------------------------------------------------------------------------
const invites = count('evaluation_invite');
t = await trialAsk(ANN, { action: 'invite' });
ok(t.status !== 200 && count('evaluation_invite') === invites, '5a the owner of an individual account cannot make an invite (complete trial: the handler refuses; the database refuses regardless)', t.json);
t = await trialAsk(BEN, { action: 'signup', name: 'Ben Fresh' });
ok(t.status === 200 && t.json.trial.credits_remaining === 10, '5b a second person signs up on their own and has their own ten (a separate account)', t.json);
t = await trialAsk(BEN, { action: 'invite' });
ok(t.status === 403 && t.json.error === 'not_owner' && count('evaluation_invite') === invites, '5c on an ACTIVE individual account the invite is refused by the DATABASE (NOT_ENTITLED -> not_owner): no invite exists', t.json);
let refused = null;
try { await TD.makeDeps({ url: 'https://proj.supabase.co', serviceKey: 'svc' }, fetchToSql).inviteAgent(BEN); } catch (e) { refused = e && e.constructor && e.constructor.name; }
ok(refused === 'NotEntitled' && count('evaluation_invite') === invites, '5d asked directly, the data layer\'s mint is refused by the database, so the handler\'s check is not the only guard', refused);
ok(one("select count(*) from public.individual_account_check() where kind = 'invariant' and violations <> 0") === '0' && one("select violations from public.individual_account_check() where check_name = 'individual_accounts'") === '2',
  '5e the audit reads zero violations beside two individual accounts');

console.log('\n' + (n - bad) + ' passed, ' + bad + ' failed of ' + n);
process.exit(bad ? 1 : 0);
