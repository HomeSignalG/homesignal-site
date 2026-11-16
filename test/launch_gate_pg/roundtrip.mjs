// THE LAUNCH GATE (Development Activity build step 13): the plan's own end-to-end sequence, one scenario, through the REAL layers.
//   "A test brokerage runs sign-up, 20 reports, the end of the trial, payment and a 100-report month."
//   (a quotation of the plan as written; the free allowance was cut from 20 to 10 on 2026-10-05, so this scenario now runs ten free reports)
// Every request goes through the real request handler and real data layer of the function a customer or the processor would reach:
//   development-activity-trial            an admin creates the trial, an owner joins it, an owner invites an agent, an agent joins
//   get-development-activity-report       the 10 free reports, the refusal of the 11th, the 100 paid reports, the refusal of the 101st, saved reports,
//                                         and (section 15, added with the report rate limit) the ceiling on how fast a member may ASK for them
//   manage-billing                        the plan, and the owner's checkout
//   paddle-webhook                        Paddle's signed events (the test payment, the live payment, the cancellation)
// against the SHIPPED SQL of every layer the product stands on. The only translations are the network (a request the data layer would send to PostgREST is
// run as the same database function call through psql, and a database refusal comes back the way PostgREST returns it) and the PAYMENT PROCESSOR, which is a
// stand-in: Paddle's checkout is opened by the BROWSER, so the server makes no processor request at all (the gate checks it never does). Nothing here reaches Paddle,
// holds a real key, or charges anyone: the processor's field names are the shapes in _shared/paddle-billing.ts, not shapes confirmed against a real webhook.
// The webhook body that the stand-in "processor" sends back is built from the custom data of the checkout request the REAL manage-billing handler made,
// so the binding that ties a payment to a brokerage is exercised end to end rather than assumed.
//   Run through: bash test/launch_gate_pg/run.sh   (it prepares the database and refuses anything not named disposable)
import { spawnSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { addressNo, geocodeStandIn } from '../lib/launch-test-location.mjs';

const H = await import('../../supabase/functions/get-development-activity-report/handler.ts');
const D = await import('../../supabase/functions/get-development-activity-report/data.ts');
const TH = await import('../../supabase/functions/development-activity-trial/handler.ts');
const TD = await import('../../supabase/functions/development-activity-trial/data.ts');
const BH = await import('../../supabase/functions/manage-billing/handler.ts');
const BD = await import('../../supabase/functions/manage-billing/data.ts');
const WH = await import('../../supabase/functions/paddle-webhook/handler.ts');
const WD = await import('../../supabase/functions/paddle-webhook/data.ts');
const L = await import('../../supabase/functions/_shared/paddle-billing.ts');

let n = 0, bad = 0;
// A check that THROWS (an answer without a field the check reads) must still end as a named failure with the usual summary, never a bare stack trace.
// The mutation loop treats this line as a crash, not a kill: a throw says something is wrong, but not what the gate checked.
process.on('uncaughtException', (e) => {
  console.log('FAIL — the scenario stopped: ' + String(e && e.message).slice(0, 160));
  console.log('\n' + (n - bad) + ' passed, ' + (bad + 1) + ' failed of ' + (n + 1));
  process.exit(1);
});
const ok = (c, m, d) => { n++; if (c) console.log('PASS — ' + m); else { bad++; console.log('FAIL — ' + m + (d !== undefined ? '  [' + JSON.stringify(d) + ']' : '')); } };

function psql(query, vars = {}) {
  const args = ['-X', '-q', '-tA', '-v', 'ON_ERROR_STOP=1'];
  for (const [k, v] of Object.entries(vars)) args.push('-v', k + '=' + v);
  const r = spawnSync('psql', [...args, '-f', '-'], { input: query, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { ok: r.status === 0, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}
const one = (q, v) => { const r = psql(q, v); if (!r.ok) throw new Error('psql: ' + r.err); return r.out; };

// ---- the database's own functions, called the way PostgREST would call them. A function not listed here stops the run. ---------------------------
const asJson = (call) => 'select coalesce(json_agg(row_to_json(t)), \'[]\') from ' + call + ' t';
const RPC = {
  evaluation_usage: (a) => [asJson("public.evaluation_usage(:'u'::uuid)"), { u: a.p_user_id }],
  billing_usage: (a) => [asJson("public.billing_usage(:'u'::uuid)"), { u: a.p_user_id }],
  // the webhook's one writer; the event is the exact object the webhook sent
  billing_event_apply: (a) => [asJson("public.billing_event_apply(:'b'::uuid, :'e'::jsonb)"), { b: a.p_brokerage, e: JSON.stringify(a.p_event) }],
  // Paddle's own database calls (docs/paddle-billing.sql): the account reading, the price table, the webhook's writers
  // decisions of 2026-11-16: the environment this database grants for, the launch gate, and the Terms agreement recorded before a checkout is signed
  billing_environment_mode: () => ["select to_json(public.billing_environment_mode())", {}],
  billing_gate_state: () => [asJson("public.billing_gate_state()"), {}],
  billing_terms_accept: (a) => ["select to_json(public.billing_terms_accept(:'u'::uuid, :'v', :'p'))", { u: a.p_user_id, v: a.p_version, p: a.p_plan }],
  billing_summary: (a) => [asJson("public.billing_summary(:'u'::uuid)"), { u: a.p_user_id }],
  billing_price_for: (a) => ["select to_json(public.billing_price_for(:'k', :'l'::boolean))", { k: a.p_plan_key, l: String(a.p_livemode) }],
  billing_portal_ref: (a) => [asJson("public.billing_portal_ref(:'u'::uuid)"), { u: a.p_user_id }],
  partner_enrollment_start: (a) => [asJson("public.partner_enrollment_start(:'u'::uuid, :'t', :'c'::boolean)"), { u: a.p_user_id, t: a.p_token_hash, c: String(a.p_create) }],
  paddle_event_apply: (a) => [asJson("public.paddle_event_apply(:'b'::uuid, :'e'::jsonb, :'p', nullif(:'n', '')::uuid, nullif(:'d', '')::jsonb)"),
    { b: a.p_brokerage, e: JSON.stringify(a.p_event), p: a.p_plan, n: a.p_enrollment ?? '', d: a.p_period ? JSON.stringify(a.p_period) : '' }],
  paddle_adjustment_apply: (a) => [asJson("public.paddle_adjustment_apply(:'e'::jsonb)"), { e: JSON.stringify(a.p_event) }],
  paddle_unmatched_record: (a) => ["select 'null'::json from (select public.paddle_unmatched_record(:'e'::jsonb, :'r')) x", { e: JSON.stringify(a.p_event), r: a.p_reason }],
  // the ONE issuing entry. The free evaluation's own issue function is NOT listed: a handler calling it directly would be a second way to charge a report.
  brokerage_report_issue: (a) => [asJson("public.brokerage_report_issue(:'u'::uuid, :'k'::uuid, :'b', :'h', :'v', :'i'::jsonb, nullif(:'p', '')::jsonb)"),
    { u: a.p_user_id, k: a.p_idempotency_key, b: a.p_body, h: a.p_content_hash, v: a.p_report_version, i: JSON.stringify(a.p_engine_inputs), p: a.p_private === null ? '' : JSON.stringify(a.p_private) }],
  report_private_context_read: (a) => [asJson("public.report_private_context_read(:'c'::uuid)"), { c: a.p_context }],
  evaluation_invite_redeem: (a) => [asJson("public.evaluation_invite_redeem(:'t', :'u'::uuid)"), { t: a.p_token, u: a.p_user_id }],
  // PostgREST passes a JSON null as SQL null; psql variables cannot carry one, so '' stands for null here and nowhere else
  evaluation_create: (a) => [asJson("public.evaluation_create(:'n', nullif(:'s', '')::integer, nullif(:'e', '')::timestamptz)"),
    { n: a.p_brokerage_name, s: a.p_seat_limit === null ? '' : String(a.p_seat_limit), e: a.p_expires_at === null ? '' : a.p_expires_at }],
  saved_reports_listed: (a) => [asJson("public.saved_reports_listed(:'u'::uuid, :'a'::boolean)"), { u: a.p_user_id, a: String(a.p_archived) }],
  evaluation_reports_of: (a) => [asJson("public.evaluation_reports_of(:'u'::uuid)"), { u: a.p_user_id }],
  evaluation_report_open: (a) => [asJson("public.evaluation_report_open(:'u'::uuid, :'r'::uuid)"), { u: a.p_user_id, r: a.p_report_id }],
  report_header_of: (a) => [asJson("public.report_header_of(:'u'::uuid)"), { u: a.p_user_id }],
  brokerage_membership_of: (a) => [asJson("public.brokerage_membership_of(:'u'::uuid)"), { u: a.p_user_id }],
  brokerage_account_type_of: (a) => ["select coalesce(json_agg(row_to_json(t)), '[]') from public.brokerage_account_type_of(:'u'::uuid) t", { u: a.p_user_id }],
  // the report rate limit (docs/report-rate-limit.sql): the wrapper that takes the DATABASE's clock. The clocked variant is NOT listed: the handler must not be able to reach it.
  report_rate_claim: (a) => [asJson("public.report_rate_claim(:'u'::uuid)"), { u: a.p_user }],
  // the one open checkout (docs/da-owner-safeguards.sql part C): the slot is claimed before the processor is asked, and freed or recorded after
  // (one column: the function is wrapped in a select so the row is an object, as PostgREST sends it, not the bare column)
  billing_checkout_claim: (a) => [asJson("(select * from public.billing_checkout_claim(:'b'::uuid))"), { b: a.p_brokerage }],
  // this one answers a bare boolean, which PostgREST sends as a bare JSON value
  billing_checkout_release: (a) => ["select to_json(public.billing_checkout_release(:'b'::uuid))", { b: a.p_brokerage }],
  evaluation_invite_mint: (a) => [asJson("public.evaluation_invite_mint(p_evaluation_id => :'e'::uuid, p_role => :'r', p_actor => :'u'::uuid)"),
    { e: a.p_evaluation_id, r: a.p_role, u: a.p_actor }],
};
const seen = [];
const json = (v, status = 200) => new Response(JSON.stringify(v), { status });

// THE PAYMENT PROCESSOR: Paddle's overlay is opened by the browser, so the server's checkout makes NO request to it. `processor.calls` records any request that
// would leave for Paddle's own origins; the gate asserts it stays empty.
const processor = { calls: [] };

async function fetchToSql(url, init = {}) {
  const u = new URL(url);
  if (/paddle\.com$/.test(u.hostname)) { processor.calls.push({ url, init }); return new Response('', { status: 503 }); }
  seen.push(u.pathname + u.search);
  const rpc = /^\/rest\/v1\/rpc\/(\w+)$/.exec(u.pathname);
  if (rpc) {
    if (!RPC[rpc[1]]) throw new Error('unexpected rpc ' + rpc[1]);
    const [q, v] = RPC[rpc[1]](JSON.parse(init.body));
    const r = psql(q, v);
    if (!r.ok) {
      // PostgREST: a raised exception is a 400 whose message is the exception's message
      const m = /ERROR:\s+(.*)/.exec(r.err);
      return json({ code: 'P0001', message: m ? m[1].trim() : r.err }, 400);
    }
    return json(JSON.parse(r.out));
  }
  if (u.pathname === '/rest/v1/report_snapshot') {
    const id = u.searchParams.get('report_id').replace(/^eq\./, '');
    if (u.searchParams.get('select') !== 'body') throw new Error('unexpected select ' + u.search);
    return json(JSON.parse(one("select coalesce(json_agg(json_build_object('body', body)), '[]') from public.report_snapshot where report_id = :'r'::uuid", { r: id })));
  }
  throw new Error('unexpected request ' + u.pathname);
}

// ---- the people ------------------------------------------------------------------------------------------------------------------------------------
const ADMIN = 'd4444444-4444-4444-8444-444444444444', OWNER = 'a1111111-1111-4111-8111-111111111111', AGENT = 'c3333333-3333-4333-8333-333333333333';
const OUTSIDER = 'b2222222-2222-4222-8222-222222222222', RIVAL = 'e5555555-5555-4555-8555-555555555555';
const NOFREE = 'aa111111-1111-4111-8111-111111111111', GRANTED = 'aa222222-2222-4222-8222-222222222222'; // section 16: no free plan

one("insert into auth.users (id, email) values ('aa111111-1111-4111-8111-111111111111', 'nofree@example.test'), ('aa222222-2222-4222-8222-222222222222', 'granted@example.test'), (:'a'::uuid, 'founder@example.test'), (:'o'::uuid, 'owner@example.test'), (:'g'::uuid, 'agent@example.test'), (:'s'::uuid, 'outsider@example.test'), (:'r'::uuid, 'rival@example.test'), ('f6666666-6666-4666-8666-666666666666', 'rateowner@example.test'), ('f7777777-7777-4777-8777-777777777777', 'rateagent@example.test')",
  { a: ADMIN, o: OWNER, g: AGENT, s: OUTSIDER, r: RIVAL });

// ---- the four functions, each built from its real handler and real data layer -------------------------------------------------------------------
const SUPABASE = { url: 'https://proj.supabase.co', serviceKey: 'fixture-service-key-not-real' };
const BILLING = { clientToken: 'live_' + 'a'.repeat(30), apiKey: 'fixture-api-key-not-real', bindingSecret: 'fixture-binding-secret-not-real', secret: 'fixture-signing-secret-not-real', sandboxSecret: 'fixture-sandbox-secret-not-real' };
const VARIANT = 'pri_01m7d6kede6hqr2kh9b78mb25j';          // the seeded LIVE Professional price
const SANDBOX_VARIANT = 'pri_01sandboxfixture000000001';   // registered below as a SANDBOX price
const RATE_OWNER = 'f6666666-6666-4666-8666-666666666666', RATE_AGENT = 'f7777777-7777-4777-8777-777777777777'; // section 15's own brokerage
const emailOf = (id) => ({ [ADMIN]: 'founder', [OWNER]: 'owner', [AGENT]: 'agent', [OUTSIDER]: 'outsider', [RIVAL]: 'rival', [RATE_OWNER]: 'rateowner', [RATE_AGENT]: 'rateagent', [NOFREE]: 'nofree', [GRANTED]: 'granted' }[id]) + '@example.test';
const post = (body, headers = {}) => new Request('https://x/functions/v1/f', { method: 'POST', headers: { authorization: 'Bearer t', 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });

async function trialAsk(userId, body, admin = false) {
  const real = TD.makeDeps(SUPABASE, fetchToSql);
  const h = TH.makeHandler({ ...real, authenticate: async () => ({ email: emailOf(userId), id: userId }), isAdmin: async () => admin });
  const res = await h(post(body));
  return { status: res.status, json: await res.json() };
}
async function billingAsk(userId, body, billing = BILLING) {
  if (body && body.action === 'checkout' && body.terms_version === undefined && !billing.noTerms) body = { ...body, terms_version: '2026-11-16' };
  const real = BD.makeDeps({ ...SUPABASE, paddle: { environment: billing.environment ?? 'production', clientToken: billing.clientToken, apiKey: billing.apiKey, bindingSecret: billing.bindingSecret } }, fetchToSql);
  const h = BH.makeHandler({ ...real, checkoutEnabled: () => true, authenticate: async () => ({ email: emailOf(userId), id: userId }), isAdmin: async () => false });
  const res = await h(post(body));
  return { status: res.status, json: await res.json() };
}
async function hook(payload, { secret = BILLING.secret, sign = true, signature } = {}) {
  if (payload && typeof payload === 'object' && payload._test !== undefined) { const { _test, ...rest } = payload; payload = rest; if (_test) secret = BILLING.sandboxSecret; }
  const raw = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const real = WD.makeDeps({ ...SUPABASE, secrets: { live: BILLING.secret, sandbox: BILLING.sandboxSecret }, bindingSecret: BILLING.bindingSecret }, fetchToSql);
  const h = WH.makeHandler(real);
  const headers = { 'content-type': 'application/json' };
  const ts = String(Math.floor(Date.now() / 1000));
  if (sign) headers['paddle-signature'] = signature ?? ('ts=' + ts + ';h1=' + createHmac('sha256', secret).update(ts + ':' + raw).digest('hex'));
  const res = await h(new Request('https://x/functions/v1/paddle-webhook', { method: 'POST', headers, body: raw }));
  return { status: res.status, json: await res.json() };
}

// the engine's inputs, as in test/trial_report_pg and test/national_report_pg
const FAM = 'wsdot-project-delivery-plan-proposed';
const CLEARED = { version: 1, attribution: { [FAM]: 'Data: WSDOT' } }; // the credit lines (national source policy, 2026-11-01: no source has to be listed to appear)
const proj = { source_key: 'k1', registry_id: FAM, record_kind: 'development', name: 'Ravenna Bridge Retrofit', type: 'Utility', type_raw: null, status: 'Approved', stage: 'Advertised',
  developer: null, size: null, investment: null, submitted_at: '2026-09-24', date_kind: 'issued', address: '005 King', source_ref: 'https://data.wsdot.wa.gov/arcgis/rest/services/Shared/WSDOTProjectDeliveryPlanCurrent/FeatureServer/0' };
let geocodeCalls = 0; // how often the geocoder was asked (section 15: a request the rate limit refuses must never reach it)
function handlerFor(userId) {
  const real = D.makeDeps({ ...SUPABASE, attribution: CLEARED, now: () => new Date('2026-10-02T12:00:00Z') }, fetchToSql);
  return H.makeHandler({
    ...real,
    authenticate: async () => ({ email: emailOf(userId), id: userId }),
    isAdmin: async () => false,
    geocode: async (a) => { geocodeCalls++; return geocodeStandIn(a); },
    zipSupported: async () => true,
    radius: async () => [{ source_key: 'k1', feature_id: 'pt:1', registry_id: FAM, provenance: 'proven_stored_point', distance_mi: 0.21, geometry_type: 'Point', has_more: false }],
    hydrate: async () => [proj], ledger: async () => [], events: async () => [], health: async () => [],
  });
}
// Sections 1-14 make ~140 reports in about a minute of wall clock, which is far above the report rate limit's ceiling by design; they test the ENTITLEMENT, so the
// limiter's counters are cleared before each of their requests (as the owner of the table - no API role can). Section 15 asks with `{ limited: true }`: no reset,
// the real wrapper on the real clock.
async function ask(userId, body, { limited = false } = {}) {
  if (!limited) one('truncate public.report_rate_window');
  const res = await handlerFor(userId)(post(body));
  return { status: res.status, json: await res.json(), retryAfter: res.headers.get('retry-after') };
}
const count = (t) => Number(one('select count(*) from public.' + t));
const key = (i) => '00000000-0000-4000-8000-' + String(i).padStart(12, '0');
const addr = (i) => addressNo(i); // the launch test location: Brigham City, UT 84302 (test/lib/launch-test-location.mjs)
const tokenOf = (link) => new URL(link).hash.slice('#invite='.length);
const reportRpcs = () => seen.filter((s) => /rpc\/brokerage_report_issue$/.test(s)).length;

// processor events, in the shape _shared/paddle-billing.ts translates. `custom` is the custom data of a checkout THIS SERVER made.
const BASE = Date.now() - 3 * 3_600_000;
const at = (k) => new Date(BASE + k * 1000).toISOString();
let evtN = 100;
const subEvent = (custom, { name = 'subscription.created', status = 'active', id = 'sub_01hv8x8x8x8x8x8x8x8x8x7001', test = false, variant, k = 1, evt } = {}) => ({
  event_id: evt ?? ('evt_01hv8x8x8x8x8x8x8x8x' + String(++evtN).padStart(6, '0')), event_type: name, occurred_at: at(k), notification_id: 'ntf_x',
  data: { id: String(id), status, items: [{ price: { id: variant ?? (test ? SANDBOX_VARIANT : VARIANT), product_id: 'pro_01m7d6ke8gd7beyc6p68kvhxy3' }, quantity: 1 }], custom_data: custom,
    next_billed_at: at(k + 86400), current_billing_period: { starts_at: at(k), ends_at: at(k + 86400) }, scheduled_change: null },
  _test: test,
});
const SUB = 'sub_01hv8x8x8x8x8x8x8x8x8x7001', SUB_TEST = 'sub_01hv8x8x8x8x8x8x8x8x8x9001';
one("insert into public.billing_plan_price (price_ref, livemode, plan_key, plan_label, kind, access_months) values (:'p', false, 'professional', 'Professional', 'recurring', null)", { p: SANDBOX_VARIANT });

// ---- 1. sign-up: an admin creates the trial, the owner joins, the owner invites an agent, the agent joins ----------------------------------------
let t = await trialAsk(ADMIN, { action: 'create', brokerage_name: 'Launch Gate Realty' }, true);
ok(t.status === 200 && /#invite=hse1_[0-9a-f]{64}$/.test(t.json.invite_link), '1a an admin creates the test brokerage\'s trial and gets the owner invite link', t.json);
const ownerToken = tokenOf(t.json.invite_link);
// DECISION 1 (2026-11-16): a NEW account holds no free reports. This scenario is the OLD promise, so its account is marked as promised (what the review list
// shows for the five existing ones), and the operator has armed the launch gate while choosing to honour those promises. Section 16 runs the new rule.
one("update public.evaluation set free_reports_granted = true where brokerage_id = (select id from public.brokerage_account where name = 'Launch Gate Realty')");
one("select public.billing_gate_set(true, true)");
t = await trialAsk(OWNER, { action: 'redeem', token: ownerToken });
ok(t.status === 200 && t.json.role === 'owner' && t.json.access === 'trial' && t.json.trial?.credits_remaining === 10, '1b the owner opens the link: owner, ten free reports left', t.json);
t = await trialAsk(OWNER, { action: 'invite' });
const agentLink = t.json.invite_link;
t = await trialAsk(AGENT, { action: 'redeem', token: tokenOf(agentLink) });
ok(t.status === 200 && t.json.role === 'agent' && t.json.access === 'trial', '1c the owner invites an agent, who joins the same trial as an agent', t.json);
const brokerageId = one("select id from public.brokerage_account where name = 'Launch Gate Realty'");
const evalId = one("select evaluation_id from public.evaluation where brokerage_id = :'b'::uuid", { b: brokerageId });
ok(count('brokerage_member') === 2 && count('brokerage_account') === 1 && count('evaluation') === 1, '1d the database holds one brokerage, one trial and two members');

// ---- 2. before any payment: the plan is "none", and only the owner may be offered a checkout --------------------------------------------------------
let b = await billingAsk(OWNER, { action: 'status' });
ok(b.status === 200 && b.json.plan?.state === 'none' && b.json.plan?.role === 'owner' && b.json.plan?.credits_remaining === 0 && b.json.checkout === 'available',
  '2a before payment the owner\'s plan is "none" with no paid reports, and a checkout is available to them', b.json);
b = await billingAsk(AGENT, { action: 'status' });
ok(b.status === 200 && b.json.plan?.state === 'none' && b.json.plan?.role === 'agent' && b.json.checkout === 'not_owner', '2b an agent sees the same plan and is told only an owner can start a checkout', b.json);
b = await billingAsk(OUTSIDER, { action: 'status' });
ok(b.status === 403 && b.json.error === 'forbidden', '2c a signed-in person with no brokerage has no plan to read (403)', b.json);
const ownerStatus = await billingAsk(OWNER, { action: 'status' });
const agentStatus = await billingAsk(AGENT, { action: 'status' });
const idsIn = (x) => { const s = JSON.stringify(x); return s.includes(brokerageId) || s.includes(evalId); };
ok(ownerStatus.json.plan && agentStatus.json.plan && !idsIn(ownerStatus.json) && !idsIn(agentStatus.json) && !idsIn(b.json),
  '2d no billing answer names the brokerage or its trial - checked on the answers that CARRY a plan (owner, agent), not only on the refusal', Object.keys(ownerStatus.json.plan || {}));

// ---- 3. the ten free reports --------------------------------------------------------------------------------------------------------------------
let r = await ask(OWNER, { address: addr(1), idempotency_key: key(1) });
ok(r.status === 200 && r.json.charged === true && r.json.stored === true && r.json.allotment === 'trial' && r.json.trial?.credits_used === 1 && r.json.trial?.credits_remaining === 9
   && r.json.plan?.state === 'none' && !idsIn(r.json), '3a the first report is charged to the free trial: one used, nine left, plan still "none"', [r.status, r.json.allotment, r.json.trial, r.json.error]);
const firstId = r.json.report_id;
for (let i = 2; i <= 10; i++) {
  r = await ask(i % 2 ? OWNER : AGENT, { address: addr(i), idempotency_key: key(i) });
  if (r.status !== 200 || r.json.allotment !== 'trial' || r.json.trial?.credits_used !== i) break;
}
ok(r.status === 200 && r.json.trial?.credits_used === 10 && r.json.trial?.credits_remaining === 0 && r.json.trial?.status === 'complete',
  '3b the tenth report (made by the agent) ends the trial: ten used, none left, complete', [r.status, r.json.trial, r.json.error]);
ok(count('evaluation_credit') === 10 && count('report_snapshot') === 10 && count('brokerage_paid_credit') === 0
   && one("select string_agg(ordinal::text, ',' order by ordinal) from public.evaluation_credit") === Array.from({ length: 10 }, (_, i) => i + 1).join(','),
  '3c the database holds ten stored reports, a free ledger numbered 1 to 10 with no gap, and no paid credit');
ok(one("select status from public.evaluation where evaluation_id = :'e'::uuid", { e: evalId }) === 'complete', '3d the trial is marked complete by the database');

// ---- 4. the end of the trial: the 11th report is refused before any work, and nothing can be charged ---------------------------------------------------
const before11 = seen.length, issued11 = reportRpcs();
r = await ask(OWNER, { address: addr(11), idempotency_key: key(11) });
ok(r.status === 403 && r.json.error === 'evaluation_complete' && r.json.plan?.state === 'none' && reportRpcs() === issued11,
  '4a the 11th report is refused (403 evaluation_complete) and the issue function is never asked', r.json);
ok(seen.slice(before11).every((s) => /rpc\/(evaluation_usage|billing_usage)$/.test(s)) && count('report_snapshot') === 10 && count('evaluation_credit') === 10,
  '4b nothing but the trial and plan reads ran: nothing stored, nothing charged');
r = await ask(AGENT, { address: addr(11), idempotency_key: key(12) });
ok(r.status === 403 && r.json.error === 'evaluation_complete', '4c the agent is refused the same way', r.json);

// ---- 5. the checkout: only the owner, only a new subscription; nothing is charged or changed by asking ---------------------------------------------------
const claims = () => seen.filter((x) => /rpc\/billing_checkout_claim$/.test(x)).length;
const claimsBefore = claims();
b = await billingAsk(AGENT, { action: 'checkout', plan: 'professional' });
ok(b.status === 403 && b.json.detail === 'owner_only' && claims() === claimsBefore && processor.calls.length === 0, '5a an agent cannot start a checkout (403 owner_only): no checkout slot is claimed and the processor is never contacted', b.json);
b = await billingAsk(OUTSIDER, { action: 'checkout', plan: 'professional' });
ok(b.status === 403 && claims() === claimsBefore, '5b a person with no brokerage cannot either');
b = await billingAsk(OWNER, { action: 'checkout', plan: 'professional' }, { ...BILLING, clientToken: '' });
ok(b.status === 503 && b.json.error === 'billing_not_set_up' && claims() === claimsBefore && processor.calls.length === 0, '5c with the checkout not set up the owner is told so (503) and nothing is claimed', b.json);
b = await billingAsk(OWNER, { action: 'checkout', plan: 'enterprise' });
ok(b.status === 400 && claims() === claimsBefore, '5d a plan that is not for sale (Brokerage & Enterprise is quote only) is refused (400): no public checkout exists for it', b.json);
b = await billingAsk(OWNER, { action: 'checkout', plan: 'professional' });
const session = b.json.session;
ok(b.status === 200 && b.json.status === 'OK' && session?.environment === 'production' && session?.priceId === VARIANT && session?.clientToken === BILLING.clientToken
   && JSON.stringify(Object.keys(b.json).sort()) === '["session","status"]', '5e the owner is given what Paddle.js needs (the public token, the Professional price from the database, signed custom data) and nothing else', b.json);
const custom = session.customData;
ok(custom.brokerage_id === brokerageId && custom.plan === 'professional' && await L.verifyBinding(BILLING.bindingSecret, custom.brokerage_id, custom.plan, undefined, custom.bind)
   && !JSON.stringify(b.json).includes(BILLING.bindingSecret) && !JSON.stringify(b.json).includes(BILLING.apiKey) && processor.calls.length === 0,
  '5g the checkout names THIS brokerage and plan with a signature only this server\'s secret makes; no secret is returned and the server made no request to Paddle');
ok(!/@/.test(JSON.stringify(b.json)), '5h the answer carries no email address');
ok(count('brokerage_subscription') === 0 && count('payment_event') === 0 && count('brokerage_paid_credit') === 0, '5i asking for a checkout changed nothing in the database: no subscription, no event, no credit');
b = await billingAsk(OWNER, { action: 'status' });
ok(b.json.plan?.state === 'none' && b.json.checkout === 'available', '5j and the plan is still "none"', b.json);
const claimsMid = claims();
b = await billingAsk(OWNER, { action: 'checkout', plan: 'private_partner' });
ok(b.status === 404 && b.json.error === 'offer_unavailable' && claims() === claimsMid, '5k the private partner offer cannot be bought without its private link (404): a price alone grants nothing', b.json);
await billingAsk(OWNER, { action: 'checkout_release' });

// ---- 6. the founder's TEST payment (processor test mode): recorded, and it grants nothing ----------------------------------------------------------
let w = await hook(subEvent(custom, { id: SUB_TEST, test: true, k: 1 }));
ok(w.status === 200 && w.json.outcome === 'RECORDED', '6a a test-mode subscription event is recorded', w.json);
b = await billingAsk(OWNER, { action: 'status' });
ok(b.json.plan?.state === 'test_only' && b.json.plan?.credits_remaining === 0 && b.json.checkout === 'available', '6b the plan reads "test only", with no paid reports, and a real checkout is still available', b.json);
r = await ask(OWNER, { address: addr(11), idempotency_key: key(11) });
ok(r.status === 403 && r.json.error === 'evaluation_complete' && count('brokerage_paid_credit') === 0 && count('report_snapshot') === 10, '6c a test payment lets no report through: the 11th is still refused, no paid credit exists', r.json);
ok(one("select livemode::text from public.brokerage_subscription where subscription_ref = '" + SUB_TEST + "'") === 'false', '6d the database holds the test subscription as NOT live');

// ---- 7. the webhook refuses what it cannot trust -------------------------------------------------------------------------------------------------------
const live = subEvent(custom, { id: SUB, k: 10 });
const subsBefore = count('brokerage_subscription'), eventsBefore = count('payment_event');
w = await hook(live, { sign: false });
ok(w.status === 401 && w.json.error === 'unauthorized', '7a an event with no signature is refused (401)', w.json);
w = await hook(live, { secret: 'a-different-secret-fixture-not-real' });
ok(w.status === 401, '7b an event signed with the wrong secret is refused (401)');
w = await hook(live, { signature: 'f'.repeat(64) });
ok(w.status === 401, '7c an event with a made-up signature is refused (401)');
ok(count('brokerage_subscription') === subsBefore && count('payment_event') === eventsBefore, '7d nothing was recorded by any of them');
const rivalBrokerage = (await trialAsk(ADMIN, { action: 'create', brokerage_name: 'Rival Realty' }, true)).json;
await trialAsk(RIVAL, { action: 'redeem', token: tokenOf(rivalBrokerage.invite_link) });
const rivalId = one("select id from public.brokerage_account where name = 'Rival Realty'");
w = await hook(subEvent({ brokerage_id: rivalId, plan: 'professional', bind: custom.bind }, { id: SUB, k: 10 }));
ok(w.status === 200 && w.json.status === 'IGNORED' && w.json.reason === 'bad_binding' && count('payment_event') === eventsBefore && count('paddle_unmatched_event') === 1,
  '7e a correctly SIGNED event that names another brokerage with this brokerage\'s signature is not acted on: a binding cannot be borrowed', w.json);
w = await hook(subEvent({ brokerage_id: brokerageId }, { id: SUB, k: 10 }));
ok(w.status === 200 && w.json.reason === 'no_binding' && count('payment_event') === eventsBefore, '7f a signed event with no binding from a checkout of ours is not acted on', w.json);
w = await hook(subEvent(custom, { id: SUB, variant: 'pri_01unknownprice000000001', k: 10 }));
ok(w.status === 200 && w.json.outcome === 'UNKNOWN_PRICE' && count('payment_event') === eventsBefore, '7g a signed event for a price that is not one of ours grants nothing and is recorded in no ledger', w.json);
w = await hook({ event_id: 'evt_01hv8x8x8x8x8x8x8x8x990001', event_type: 'customer.created', occurred_at: at(10), data: { id: 'ctm_01hv8x8x8x8x8x8x8x8x8x8x8x' } });
ok(w.status === 200 && w.json.status === 'IGNORED' && count('payment_event') === eventsBefore, '7h an event of a kind we do not use is acknowledged and recorded nowhere', w.json);
w = await hook(subEvent(custom, { name: 'subscription.imported', id: SUB, k: 10 }));
ok(w.status === 200 && w.json.status === 'IGNORED' && w.json.reason === 'event_type' && count('payment_event') === eventsBefore,
  '7h2 a subscription-shaped event whose NAME is not one of the lifecycle events (a payment notice) is acknowledged and recorded nowhere: the plan follows the subscription\'s own status', w.json);
w = await hook({ ...live, occurred_at: 'yesterday' });
ok(w.status === 422 && w.json.reason === 'occurred_at' && count('payment_event') === eventsBefore, '7i a signed event that is not shaped as expected is refused loudly (422), not guessed at', w.json);

// ---- 8. the LIVE payment: the subscription is bound to the brokerage and the plan becomes paid ---------------------------------------------------------
w = await hook(live);
ok(w.status === 200 && w.json.outcome === 'RECORDED' && JSON.stringify(Object.keys(w.json).sort()) === '["outcome","status"]' && !idsIn(w.json), '8a the live subscription event is recorded, and the answer is two fixed words', w.json);
w = await hook(live);
ok(w.status === 200 && w.json.outcome === 'DUPLICATE' && count('brokerage_subscription') === 2, '8b the processor retrying the same delivery is a duplicate: nothing new is recorded or bound');
ok(one("select count(*) from public.brokerage_subscription where subscription_ref = '" + SUB + "' and livemode and brokerage_id = :'b'::uuid", { b: brokerageId }) === '1'
   && one("select count(*) from public.payment_event where subscription_ref = '" + SUB + "'") === '1',
  '8c the database holds ONE live binding of subscription 7001 to this brokerage and ONE event for it');
b = await billingAsk(OWNER, { action: 'status' });
ok(b.json.plan?.state === 'paid' && b.json.plan?.credit_limit === 100 && b.json.plan?.credits_used === 0 && b.json.plan?.credits_remaining === 100 && b.json.checkout === 'already_paid'
   && typeof b.json.plan?.renews_at === 'string' && typeof b.json.plan?.next_reset_at === 'string', '8d the plan is paid: a month of 100, none used (the ten free reports do not count toward it), and no second checkout is offered', b.json);
const claimsN = claims();
b = await billingAsk(OWNER, { action: 'checkout', plan: 'professional' });
ok(b.status === 409 && b.json.error === 'already_paid' && claims() === claimsN, '8e a paid brokerage is refused a second checkout (409) and no checkout slot is claimed: nobody is billed twice', b.json);
b = await billingAsk(AGENT, { action: 'status' });
ok(b.json.plan?.state === 'paid' && b.json.plan?.credits_remaining === 100 && b.json.checkout === 'not_owner', '8f the agent sees the paid plan too');

// ---- 9. the 100-report month: paid reports 11 to 110 -------------------------------------------------------------------------------------------------
r = await ask(OWNER, { address: addr(11), idempotency_key: key(11) });
ok(r.status === 200 && !idsIn(r.json) && r.json.charged === true && r.json.stored === true && r.json.allotment === 'paid' && r.json.plan?.state === 'paid' && r.json.plan?.credits_used === 1 && r.json.plan?.credits_remaining === 99
   && r.json.trial?.credits_used === 10 && r.json.trial?.status === 'complete', '9a the first report after payment is a PAID one: one of the month\'s hundred, and the free trial is untouched', [r.status, r.json.allotment, r.json.plan, r.json.trial, r.json.error]);
const paidFirstId = r.json.report_id;
const dupe = await ask(OWNER, { address: addr(11), idempotency_key: key(11) });
ok(dupe.status === 200 && dupe.json.replayed === true && dupe.json.charged === false && dupe.json.report_id === paidFirstId && count('brokerage_paid_credit') === 1,
  '9b a retry of the same request returns the same report and charges nothing', [dupe.json.replayed, dupe.json.charged]);
let made = 1, last = r;
for (let i = 12; i <= 110; i++) {
  last = await ask(i % 2 ? OWNER : AGENT, { address: addr(i), idempotency_key: key(i) });
  if (last.status !== 200 || last.json.allotment !== 'paid' || last.json.plan?.credits_used !== i - 10) break;
  made++;
}
ok(made === 100 && last.status === 200 && last.json.plan?.credits_used === 100 && last.json.plan?.credits_remaining === 0,
  '9c one hundred paid reports are made, by the owner and the agent in turn; the hundredth leaves none', [made, last.status, last.json.plan, last.json.error]);
ok(count('brokerage_paid_credit') === 100 && count('evaluation_credit') === 10 && count('report_snapshot') === 110, '9d the database holds 100 paid credits, the 10 free ones untouched, and 110 stored reports');
ok(one("select string_agg(ordinal::text, ',' order by ordinal) from public.brokerage_paid_credit") === Array.from({ length: 100 }, (_, i) => i + 1).join(',')
   && one("select min(number) || '-' || max(number) || '-' || count(distinct number) from public.brokerage_paid_credit") === '11-110-100',
  '9e the paid ledger is the ordinals 1 to 100 with no gap, and the reports are numbered 11 to 110 (each number used once)');
ok(one("select count(distinct period_index) || ':' || max(period_index) from public.brokerage_paid_credit") === '1:0', '9f all hundred belong to one month (the first)');

// ---- 10. the 101st report: refused, and there is no way to buy more -------------------------------------------------------------------------------
const issued101 = reportRpcs();
r = await ask(OWNER, { address: addr(111), idempotency_key: key(111) });
ok(r.status === 403 && r.json.error === 'allotment_complete' && r.json.plan?.credits_remaining === 0 && reportRpcs() === issued101 && count('report_snapshot') === 110 && count('brokerage_paid_credit') === 100,
  '10a the 101st report is refused (403 allotment_complete) before any work: nothing stored, nothing charged', r.json);
const rawIssue = psql("select * from public.brokerage_report_issue(:'u'::uuid, :'k'::uuid, 'x', 'x', 'v', '{}'::jsonb, null)", { u: OWNER, k: key(112) });
ok(!rawIssue.ok && /ALLOTMENT_COMPLETE/.test(rawIssue.err) && count('brokerage_paid_credit') === 100, '10b asked directly, the DATABASE refuses the 101st (ALLOTMENT_COMPLETE): the handler\'s check is not the only guard');
const rawRow = psql("insert into public.brokerage_paid_credit (binding_id, brokerage_id, period_index, ordinal, number, idempotency_key, report_id) select binding_id, brokerage_id, 0, 101, 111, gen_random_uuid(), report_id from public.brokerage_paid_credit limit 1");
ok(!rawRow.ok && /brokerage_paid_credit_ordinal/.test(rawRow.err) && count('brokerage_paid_credit') === 100,
  '10c and the cap is a CONSTRAINT of the ledger, named in the refusal: a 101st row cannot be written by any path', rawRow.err.slice(0, 160));
b = await billingAsk(OWNER, { action: 'checkout', plan: 'professional' });
ok(b.status === 409 && b.json.error === 'already_paid', '10d there is no overage and no extra purchase: a second checkout is still refused', b.json);

// ---- 11. every report stays readable: saved reports list and open, free and paid -------------------------------------------------------------------------
const listed = await ask(OWNER, { action: 'list' });
ok(listed.status === 200 && listed.json.reports?.length === 110 && listed.json.reports?.[0]?.number === 110 && listed.json.reports?.[109]?.number === 1
   && new Set(listed.json.reports?.map((x) => x.number)).size === 110, '11a the owner lists all 110 reports, newest first, numbered 110 down to 1: the free and the paid in one list', listed.json.reports && listed.json.reports?.length);
const agentList = await ask(AGENT, { action: 'list' });
ok(agentList.status === 200 && JSON.stringify(agentList.json.reports) === JSON.stringify(listed.json.reports), '11b the agent sees the same 110');
const openFree = await ask(AGENT, { action: 'open', report_id: firstId });
const openPaid = await ask(AGENT, { action: 'open', report_id: paidFirstId });
ok(openFree.status === 200 && openFree.json.number === 1 && openFree.json.charged === false && openPaid.status === 200 && openPaid.json.number === 11 && openPaid.json.charged === false,
  '11c a free report (number 1) and a paid report (number 11) both open, and opening charges nothing');
const rivalList = await ask(RIVAL, { action: 'list' });
const rivalOpen = await ask(RIVAL, { action: 'open', report_id: paidFirstId });
ok(rivalList.status === 200 && rivalList.json.reports?.length === 0 && rivalOpen.status === 404 && rivalOpen.json.error === 'not_found',
  '11d the other brokerage sees none of them and cannot open one: paying makes a report this brokerage\'s alone', [rivalList.json.reports && rivalList.json.reports?.length, rivalOpen.status]);

// ---- 12. the other brokerage is unaffected, and cannot take this brokerage\'s subscription ---------------------------------------------------------------
b = await billingAsk(RIVAL, { action: 'status' });
ok(b.json.plan?.state === 'none' && b.json.plan?.role === 'owner', '12a the other brokerage\'s plan is still "none"', b.json);
const rivalCheckout = await billingAsk(RIVAL, { action: 'checkout', plan: 'professional' });
const rivalCustom = rivalCheckout.json.session?.customData ?? {};
ok(rivalCheckout.status === 200 && rivalCustom.brokerage_id === rivalId && rivalCustom.brokerage_id !== brokerageId, '12b it gets its own checkout, which names only itself');
w = await hook(subEvent(rivalCustom, { id: SUB, k: 20 }));
ok(w.status === 409 && w.json.error === 'binding_conflict' && count('payment_event') === 2 && count('brokerage_subscription') === 2,
  '12c an event naming ITS brokerage for OUR subscription is refused (409 binding_conflict) and recorded nowhere: a subscription belongs to one brokerage', w.json);
b = await billingAsk(RIVAL, { action: 'status' });
ok(b.json.plan?.state === 'none', '12d the other brokerage still has no paid plan');

// ---- 13. cancellation: the allotment ends at once, the reports stay, a new subscription can be taken -------------------------------------------------
w = await hook(subEvent(custom, { name: 'subscription.canceled', status: 'canceled', id: SUB, k: 30 }));
ok(w.status === 200 && w.json.outcome === 'RECORDED', '13a the cancellation is recorded', w.json);
b = await billingAsk(OWNER, { action: 'status' });
ok(b.json.plan?.state === 'canceled' && b.json.plan?.credits_remaining === 0 && b.json.checkout === 'available', '13b the plan reads "canceled", with no paid reports, and a new checkout is available (D-11-1)', b.json);
r = await ask(OWNER, { address: addr(111), idempotency_key: key(123) });
ok(r.status === 403 && r.json.error === 'evaluation_complete' && count('report_snapshot') === 110, '13c a canceled brokerage can make no new report (the trial is spent and the plan is not paid)', r.json);
const kept = await ask(OWNER, { action: 'list' });
const keptOpen = await ask(OWNER, { action: 'open', report_id: paidFirstId });
ok(kept.status === 200 && kept.json.reports?.length === 110 && keptOpen.status === 200 && count('brokerage_paid_credit') === 100,
  '13d but all 110 stored reports still list and open, and nothing was deleted: cancelling ends new reports, never the ones already made');
w = await hook(subEvent(custom, { name: 'subscription.updated', status: 'active', id: SUB, k: 25 }));
b = await billingAsk(OWNER, { action: 'status' });
ok(w.status === 200 && b.json.plan?.state === 'canceled', '13e an OLDER event arriving late does not undo the cancellation (the processor\'s own time orders them)', b.json.plan);

// ---- 14. the audit: every invariant is a count that must be zero, beside controls that must not be -----------------------------------------------------
const audit = Object.fromEntries(one("select string_agg(check_name || '=' || violations, ';') from public.billing_check()").split(';').map((x) => x.split('=')));
const invariants = JSON.parse(one("select json_agg(check_name) from public.billing_check() where kind = 'invariant'"));
ok(invariants.length >= 8 && invariants.every((k) => audit[k] === '0'), '14a every billing invariant reads zero (' + invariants.length + ' of them)', audit);
ok(Number(audit.bindings_total) === 2 && Number(audit.paid_credits_total) === 100, '14b beside controls that are not zero: two bindings (the test one and the live one) and 100 paid credits', audit);
const holders = (needle) => one("select string_agg(table_name, ',' order by table_name) from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'").split(',')
  .filter((tb) => Number(one('select count(*) from public."' + tb + '" x where x::text like :\'n\'', { n: '%' + needle + '%' })) > 0);
ok(holders('Launch Gate Realty').includes('brokerage_account') && holders(SUB).includes('brokerage_subscription'), '14c (control) the scan finds a value where it is kept: the brokerage\'s name and the subscription\'s id');
ok([BILLING.apiKey, BILLING.secret, BILLING.sandboxSecret, BILLING.bindingSecret, 'owner@example.test'].every((v) => holders(v).length === 0),
  '14d the processor\'s key, the signing secret, the checkout address and the owner\'s email are written in NO table of the public schema');
ok(['anon', 'authenticated'].every((role) => ['public.billing_usage(uuid)', 'public.billing_event_apply(uuid, jsonb)', 'public.brokerage_report_issue(uuid, uuid, text, text, text, jsonb, jsonb)']
     .every((f) => one("select has_function_privilege(:'r', :'f', 'execute')", { r: role, f }) === 'f')), '14e no resident role can run the billing functions: only the system can');

// ---- 15. THE REPORT RATE LIMIT (added with docs/report-rate-limit.sql; sections 1-14 above are unchanged) ----------------------------------------------------
// A second brokerage, so this section does not depend on the first one's cancelled state. Requests here go through the REAL wrapper on the REAL clock, with
// no reset. The windows are 60 seconds, so every check that depends on a count is made inside one window by taking the window's START as the reference:
// if the clock rolls into a new minute mid-run the check re-reads the stored window rather than guessing.
t = await trialAsk(ADMIN, { action: 'create', brokerage_name: 'Rate Gate Realty' }, true);
t = await trialAsk(RATE_OWNER, { action: 'redeem', token: tokenOf(t.json.invite_link) });
const rateOwnerOk = t.status === 200 && t.json.role === 'owner';
t = await trialAsk(RATE_OWNER, { action: 'invite' });
t = await trialAsk(RATE_AGENT, { action: 'redeem', token: tokenOf(t.json.invite_link) });
ok(rateOwnerOk && t.status === 200 && t.json.role === 'agent', '15a a second test brokerage (an owner and an agent) is signed up for the rate-limit checks', t.json);
const rateBrokerage = one("select id from public.brokerage_account where name = 'Rate Gate Realty'");
// The free allowance (10) now EQUALS the person's per-minute ceiling (10), so under it a person can never reach the ceiling: the free trial would be complete first
// and the 11th request would answer 403 evaluation_complete, not 429. The ceiling only matters once a brokerage can make more than ten reports, which is a PAID
// brokerage. So this brokerage pays before the burst: the same system-only writer the webhook calls (public.billing_event_apply), a live subscription bound to it.
one("select outcome from public.billing_event_apply(:'b'::uuid, :'e'::jsonb)", { b: rateBrokerage, e: JSON.stringify({ processor: 'paddle', idempotency_key: 'rate-gate-paid:1', subscription_ref: '7101', event_name: 'subscription_created', processor_status: 'active', occurred_at: new Date().toISOString(), product_ref: '11', variant_ref: '22', livemode: true }) });
ok(one("select state from public.billing_plan_of(:'b'::uuid)", { b: rateBrokerage }) === 'paid', '15a2 the rate-limit brokerage is on a PAID plan, so its burst can pass the free allowance of ten', one("select state from public.billing_plan_of(:'b'::uuid)", { b: rateBrokerage }));
one('truncate public.report_rate_window');
// The person's window is a WALL-CLOCK minute. The checks below (15b-15i) take a few seconds and several of them count inside ONE minute, so they begin early
// in a minute: a burst that straddled two would be let through legitimately and read as a defect. Costs up to half a minute of waiting, in this section only.
{ const sec = new Date().getUTCSeconds(); if (sec > 30) await new Promise((res) => setTimeout(res, (61 - sec) * 1000)); }
const minuteOf = (u) => Number(one("select coalesce(used, 0) from public.report_rate_window where bucket = 'user' and subject = :'u'::uuid and window_secs = 60", { u }) || 0);
const allowedBurst = [];
let blocked = null;
const geoBefore = geocodeCalls, issueBefore = reportRpcs();
for (let i = 1; i <= 14; i++) {
  const x = await ask(RATE_OWNER, { address: addr(300 + i), idempotency_key: key(300 + i) }, { limited: true });
  if (x.status === 429) { blocked = { ...x, at: i }; break; }
  allowedBurst.push(x);
}
ok(blocked !== null && allowedBurst.length >= 1 && allowedBurst.length <= 10 && allowedBurst.every((x) => x.status === 200 && x.json.charged === true),
  '15b a member asking quickly is let through up to the person\'s ceiling (ten in a minute) and then refused with 429; every one let through is an ordinary charged report', [allowedBurst.length, blocked?.status, blocked?.json]);
ok(blocked?.json?.error === 'rate_limited' && blocked?.json?.limited_by === 'user' && Number.isInteger(blocked?.json?.retry_after_seconds) && blocked.json.retry_after_seconds >= 1 && blocked.json.retry_after_seconds <= 60
   && blocked.retryAfter === String(blocked.json.retry_after_seconds),
  '15c the refusal says rate_limited, that it was the person\'s own ceiling, and how many seconds to wait (1 to 60), in the body and in the Retry-After header', [blocked?.json, blocked?.retryAfter]);
ok(blocked?.json?.report === undefined && blocked?.json?.credit === undefined && blocked?.json?.charged === undefined && !JSON.stringify(blocked?.json).includes(rateBrokerage)
   && !JSON.stringify(blocked?.json).includes('Main St') && (blocked?.json?.plan?.credits_used ?? blocked?.json?.trial?.credits_used) === allowedBurst.length,
  '15d the refusal carries no report, no charge, no address and no brokerage id, and the trial figures it does carry equal the reports actually made', blocked?.json);
ok(geocodeCalls - geoBefore === allowedBurst.length && reportRpcs() - issueBefore === allowedBurst.length,
  '15e the geocoder and the issuing function were asked exactly once for each report let through and NEVER for the refused request', [geocodeCalls - geoBefore, reportRpcs() - issueBefore, allowedBurst.length]);
const used0 = minuteOf(RATE_OWNER);
for (let i = 0; i < 4; i++) await ask(RATE_OWNER, { address: addr(320 + i), idempotency_key: key(320 + i) }, { limited: true });
ok(minuteOf(RATE_OWNER) === used0 && count('evaluation_credit') >= 0 && Number(one("select count(*) from public.evaluation_credit_all c join public.evaluation e on e.evaluation_id = c.evaluation_id where e.brokerage_id = :'b'::uuid", { b: rateBrokerage })) === allowedBurst.length,
  '15f four more refused requests consume nothing: the person\'s minute is unchanged and the free ledger holds exactly the reports that were let through', [used0, minuteOf(RATE_OWNER)]);
const agentTry = await ask(RATE_AGENT, { address: addr(340), idempotency_key: key(340) }, { limited: true });
ok(agentTry.status === 200 && agentTry.json.charged === true, '15g the owner being limited does not limit the agent: the same brokerage\'s other person is still let through', [agentTry.status, agentTry.json.error]);
const listWhileLimited = await ask(RATE_OWNER, { action: 'list' }, { limited: true });
ok(listWhileLimited.status === 200 && listWhileLimited.json.reports?.length === allowedBurst.length + 1, '15h and the limited person can still list their saved reports: reading what is stored is not what the limit is for', [listWhileLimited.status, listWhileLimited.json.reports?.length]);
ok(one('select public.evaluation_report_limit() || chr(47) || public.billing_report_limit()') === '10/100'
   && Number(one("select count(*) from public.evaluation_credit_all c join public.evaluation e on e.evaluation_id = c.evaluation_id where e.brokerage_id = :'b'::uuid", { b: rateBrokerage })) === allowedBurst.length + 1,
  '15i the founder\'s numbers are still 10 free and 100 paid, and the free ledger counts every report made and none refused', one('select public.evaluation_report_limit()'));
// the window rolls over: age the stored minute by two minutes (as the table's owner), and the same person is let through again
one("update public.report_rate_window set window_start = window_start - interval '2 minutes' where bucket = 'user' and subject = :'u'::uuid and window_secs = 60", { u: RATE_OWNER });
const afterRoll = await ask(RATE_OWNER, { address: addr(350), idempotency_key: key(350) }, { limited: true });
ok(afterRoll.status === 200 && afterRoll.json.charged === true && minuteOf(RATE_OWNER) === 1, '15j once the minute has passed the same person is let through again, and the new minute counts one', [afterRoll.status, afterRoll.json.error, minuteOf(RATE_OWNER)]);
// FAIL CLOSED: when the limiter cannot be read the request is refused (502) and the geocoder is never asked
one('alter function public.report_rate_claim(uuid) rename to report_rate_claim_offline');
const geoDown = geocodeCalls, issueDown = reportRpcs();
const down = await ask(RATE_AGENT, { address: addr(360), idempotency_key: key(360) }, { limited: true });
one('alter function public.report_rate_claim_offline(uuid) rename to report_rate_claim');
ok(down.status === 502 && down.json.error === 'data_unavailable' && geocodeCalls === geoDown && reportRpcs() === issueDown && down.json.report === undefined,
  '15k with the limiter unreadable the request answers 502 data_unavailable and the geocoder and the issuing function are NEVER reached: it fails closed', [down.status, down.json]);
const backUp = await ask(RATE_AGENT, { address: addr(361), idempotency_key: key(361) }, { limited: true });
ok(backUp.status === 200, '15l and with the limiter back the same person is served', [backUp.status, backUp.json.error]);
ok(Number(one("select count(*) from public.report_rate_window where subject = :'u'::uuid or subject = :'b'::uuid", { u: RATE_OWNER, b: rateBrokerage })) === 6
   && Number(one("select count(*) from public.report_rate_check() where kind = 'invariant' and n <> 0")) === 0,
  '15m the counters are the person\'s three windows and the brokerage\'s three, and the limiter\'s own audit reads zero');


// ---- 16. NO FREE PLAN, TERMS BEFORE PURCHASE, ENVIRONMENT AND GATE (founder decisions, 2026-11-16) ----------------------------------------------------
// A NEW account holds no free reports, whatever else is true. The gate is armed with the operator's choice to honour promised reports (set in section 1).
const fresh = async (who, name) => {
  const c = await trialAsk(ADMIN, { action: 'create', brokerage_name: name }, true);
  const red = await trialAsk(who, { action: 'redeem', token: tokenOf(c.json.invite_link) });
  return { c, red };
};
const nf = await fresh(NOFREE, 'No Free Realty');
ok(nf.red.status === 200 && nf.red.json.role === 'owner' && nf.red.json.trial?.credits_remaining === 0 && nf.red.json.trial?.credits_used === 0,
  '16a a brand-new account holds NO free reports: its owner joins and the usage reads zero left', nf.red.json);
const nfBrokerage = one("select id from public.brokerage_account where name = 'No Free Realty'");
const creditsBefore16 = count('evaluation_credit'), snapsBefore16 = count('report_snapshot'), paidBefore16 = count('brokerage_paid_credit');
r = await ask(NOFREE, { address: addr(401), idempotency_key: key(401) });
ok(r.status === 402 && r.json.error === 'payment_required' && r.json.report === undefined && count('evaluation_credit') === creditsBefore16 && count('report_snapshot') === snapsBefore16 && count('brokerage_paid_credit') === paidBefore16,
  '16b an unpaid account with no promised free reports cannot make a report (402 payment_required): nothing stored, nothing charged, no report returned', [r.status, r.json]);
ok(Number(one("select count(*) from public.report_snapshot s join public.evaluation_credit_all c on c.report_id = s.report_id join public.evaluation e on e.evaluation_id = c.evaluation_id where e.brokerage_id = :'b'::uuid", { b: nfBrokerage })) === 0,
  '16c the database holds no report for it');
// the gate does not touch what already exists: the earlier brokerage still reads and lists its saved reports
const listed16 = await ask(OWNER, { action: 'list' });
ok(listed16.status === 200 && listed16.json.reports.length >= 10, '16d reports already made stay listed16 and open for their owners', [listed16.status, listed16.json.reports?.length]);

// TERMS BEFORE PURCHASE
const acceptedBefore = count('billing_terms_acceptance'), claims16 = claims();
b = await billingAsk(NOFREE, { action: 'status' });
ok(b.status === 200 && b.json.checkout === 'available', '16e with the gate armed, the environment matching and Paddle set up, the new owner may start a checkout', b.json);
b = await billingAsk(NOFREE, { action: 'checkout', plan: 'professional' }, { ...BILLING, noTerms: true });
ok(b.status === 409 && b.json.error === 'terms_not_accepted' && count('billing_terms_acceptance') === acceptedBefore && claims() === claims16 && processor.calls.length === 0,
  '16f a checkout with no Terms version is refused: nothing recorded, no checkout slot claimed, no session signed', b.json);
b = await billingAsk(NOFREE, { action: 'checkout', plan: 'professional', terms_version: '2026-10-16' });
ok(b.status === 409 && b.json.detail === 'terms_changed' && count('billing_terms_acceptance') === acceptedBefore && claims() === claims16,
  '16g a stale Terms version (the October ones that said the service was free) is refused: the customer must read the current ones first', b.json);
b = await billingAsk(AGENT, { action: 'checkout', plan: 'professional' });
ok(b.status === 403 && count('billing_terms_acceptance') === acceptedBefore, '16h an agent cannot agree to the Terms for the account', b.json);
b = await billingAsk(NOFREE, { action: 'checkout', plan: 'professional' });
ok(b.status === 200 && b.json.session?.priceId === VARIANT && count('billing_terms_acceptance') === acceptedBefore + 1
   && one("select plan_key || '|' || terms_version from public.billing_terms_acceptance where brokerage_id = :'b'::uuid", { b: nfBrokerage }) === 'professional|2026-11-16',
  '16i agreeing to the CURRENT Terms is recorded (account, plan, version) and only then is the session signed', b.json);
await billingAsk(NOFREE, { action: 'checkout_release' });

// THE LAUNCH GATE AND THE ENVIRONMENT: checkout opens only when both are right
b = await billingAsk(NOFREE, { action: 'checkout', plan: 'professional' }, { ...BILLING, environment: 'sandbox', clientToken: 'test_' + 'a'.repeat(30) });
ok(b.status === 503 && b.json.error === 'billing_environment_mismatch' && claims() === claims16 + 1, '16j a SANDBOX checkout against this PRODUCTION database is refused: a sandbox payment can never be taken here', b.json);
one("select public.billing_gate_set(false, false)");
b = await billingAsk(NOFREE, { action: 'checkout', plan: 'professional' });
ok(b.status === 503 && b.json.error === 'billing_gate_not_armed', '16k with the unpaid-report gate off, checkout will not open: launching and gating are one act', b.json);
one("select public.billing_gate_set(true, true)");

// A PROMISED account, then the operator stops honouring promises: the promised reports can no longer be used, and what was made is untouched
const gr = await fresh(GRANTED, 'Granted Realty');
one("update public.evaluation set free_reports_granted = true where brokerage_id = (select id from public.brokerage_account where name = 'Granted Realty')");
r = await ask(GRANTED, { address: addr(402), idempotency_key: key(402) });
ok(r.status === 200 && r.json.allotment === 'trial' && r.json.charged === true, '16l an account that WAS promised free reports can use them while the operator honours the promise', [r.status, r.json.error, r.json.allotment]);
one("select public.billing_gate_set(true, false)");
const gSnap = count('report_snapshot');
r = await ask(GRANTED, { address: addr(403), idempotency_key: key(403) });
ok(r.status === 402 && r.json.error === 'payment_required' && count('report_snapshot') === gSnap, '16m once the operator stops honouring them, the same account is refused (402): no unpaid report is made after launch', [r.status, r.json]);
r = await ask(GRANTED, { address: addr(402), idempotency_key: key(402) });
ok(r.status === 200 && r.json.replayed === true && count('report_snapshot') === gSnap, '16n a retry of the report it already made still returns that report and charges nothing', [r.status, r.json.replayed]);
one("select public.billing_gate_set(true, true)");
ok(Number(one("select count(*) from public.billing_gate_log")) >= 4 && one("select paid_required || '|' || honor_granted_free_reports from public.billing_gate") === 'true|true',
  '16o every gate change is in the append-only log, and the gate is left as the scenario began');

console.log('\n' + (n - bad) + ' passed, ' + bad + ' failed of ' + n);
process.exit(bad ? 1 : 0);
