// THE TWO BILLING FUNCTIONS, edge half (Development Activity build step 11) — offline, against the REAL handlers and data layers.
//   supabase/functions/_shared/billing-reads.ts                       the plan's one reader, and the webhook's one writer's caller
//   supabase/functions/manage-billing                                  a member reads their plan; the OWNER starts the checkout (signed in)
//   supabase/functions/development-activity-billing-webhook            the processor's signed events (NOT signed in: its HMAC is the gate)
//
//   1. the plan reads: the database's answer is checked for shape (a row that is not what it should be is a fault, never "no plan"), and what a
//      BROWSER is told is the state, the month's figures and the person's own role, never the brokerage id;
//   2. manage-billing: the gate refuses BEFORE the body is read, the field set is closed per action, only an OWNER may start a checkout, a
//      brokerage that is already paid cannot start another, an unset processor is 503 and never a guess, and no answer carries an id, a key or a
//      processor word;
//   3. the webhook: with no secret or no variant EVERY request is refused; a request whose signature is not the HMAC of the RAW body is refused
//      before anything is parsed; a body that is not ours is acknowledged and recorded nowhere; every refusal of the database has its own answer;
//   4. the real data layers: exactly the requests each makes, the API key only in the processor request's header, and nothing else.
// test/brokerage_billing_pg proves the database half; test/billing-structure.test.mjs pins the structure; test/lemon-billing.test.mjs proves the shapes.
// Run: node test/billing-functions.test.mjs
import { createHmac } from 'node:crypto';

const L = await import('../supabase/functions/_shared/lemon-billing.ts');
const B = await import('../supabase/functions/_shared/billing-reads.ts');
const Svc = await import('../supabase/functions/_shared/service-rest.ts');
const MH = await import('../supabase/functions/manage-billing/handler.ts');
const MD = await import('../supabase/functions/manage-billing/data.ts');
const WH = await import('../supabase/functions/development-activity-billing-webhook/handler.ts');
const WD = await import('../supabase/functions/development-activity-billing-webhook/data.ts');

let n = 0, bad = 0;
const ok = (c, m, d) => { n++; if (c) console.log('PASS — ' + m); else { bad++; console.log('FAIL — ' + m + (d !== undefined ? '  [' + JSON.stringify(d) + ']' : '')); } };
const hmac = (secret, msg) => createHmac('sha256', secret).update(msg).digest('hex');

const UID = 'a1111111-1111-4111-8111-111111111111';
const BK = 'b0b0b0b0-1111-4222-8333-444444444444';
const SECRET = 'whsec_test_0123456789abcdef';
const API_KEY = 'lsk_secret_api_key_value';
const VARIANT = '123456';
const SERVICE = 'service-key-xyz';
const BASE = 'https://qwnnmljucajnexpxdgxr.supabase.co';

const usage = (over = {}) => ({ brokerage_id: BK, role: 'owner', state: 'none', credit_limit: 100, credits_used: 0, credits_remaining: 0, period_ends_at: null, ...over });
const PAID = usage({ state: 'paid', credits_used: 3, credits_remaining: 97, period_ends_at: '2026-11-04T12:00:00+00:00' });
const rpcWith = (table) => { const calls = []; const rpc = async (fn, args) => { calls.push([fn, args]); const a = table[fn]; if (!a) throw new Svc.DataUnavailable('no script for ' + fn); return typeof a === 'function' ? a(args) : a; }; return { rpc, calls }; };
const okRows = (rows) => ({ data: rows, error: null });
const refused = (message) => ({ data: null, error: { message } });

// ---- 1. the plan reads ------------------------------------------------------------------------------------------------------------------------
{
  const reads = (rows) => B.makeBillingReads(rpcWith({ billing_usage: okRows(rows) }).rpc);
  const got = await reads([PAID]).usageOf(UID);
  ok(got && got.brokerage_id === BK && got.state === 'paid' && got.credits_remaining === 97 && got.role === 'owner', '1a a member\'s plan is read as the database gave it');
  ok(await reads([]).usageOf(UID) === null, '1b a person with no brokerage has no plan (null, which the functions answer 403)');
  const { rpc, calls } = rpcWith({ billing_usage: okRows([PAID]) });
  await B.makeBillingReads(rpc).usageOf(UID);
  ok(calls.length === 1 && calls[0][0] === 'billing_usage' && JSON.stringify(calls[0][1]) === JSON.stringify({ p_user_id: UID }), '1c the read is ONE call to billing_usage with the user id and nothing else (never an email)');
  let f = 0;
  for (const bad of [[PAID, PAID], [{ ...PAID, brokerage_id: 'x' }], [{ ...PAID, role: 'admin' }], [{ ...PAID, state: 'rich' }], [{ ...PAID, credits_used: -1 }], [{ ...PAID, credits_remaining: 1.5 }],
    [{ ...PAID, credit_limit: '100' }], [{ ...PAID, period_ends_at: 'soon' }], [null], ['x']]) {
    try { await reads(bad).usageOf(UID); } catch (e) { if (e instanceof Svc.DataUnavailable) f++; }
  }
  ok(f === 10, '1d two rows, or a row of the wrong shape (id, role, state, a count, a time), is a fault and never a plan (ten shapes)', f);
  let g = 'none';
  try { await B.makeBillingReads(rpcWith({ billing_usage: refused('boom') }).rpc).usageOf(UID); } catch (e) { g = e.constructor.name; }
  ok(g === 'DataUnavailable', '1e a database error is DataUnavailable, never "no plan"', g);
  let nonArray = 0;
  for (const bad of [null, {}, 'x', 5]) { try { await reads(bad).usageOf(UID); } catch (e) { if (e instanceof Svc.DataUnavailable) nonArray++; } }
  ok(nonArray === 4, '1f an answer that is not a list is a fault', nonArray);
  ok(['none', 'trialing', 'paid', 'past_due', 'canceled', 'unknown', 'test_only', 'suspended'].join() === [...B.PLAN_STATES].join(), '1g the plan states are exactly the eight the database can answer');
  const sum = B.planSummary(PAID);
  ok(JSON.stringify(Object.keys(sum).sort()) === JSON.stringify(['credit_limit', 'credits_remaining', 'credits_used', 'period_ends_at', 'role', 'state']) && !JSON.stringify(sum).includes(BK),
    '1h what a browser is told is the state, the role and the month\'s figures, and NEVER the brokerage id');
  ok(JSON.stringify(B.planSummary(null)) === JSON.stringify({ state: 'none', role: null, credit_limit: 0, credits_used: 0, credits_remaining: 0, period_ends_at: null }), '1i no plan is "none", with nothing to spend');
}
{
  // applyEvent: the webhook's one writer's caller
  const EVENT = { processor: 'lemonsqueezy', idempotency_key: 'k', subscription_ref: '1', event_name: 'subscription_created', processor_status: 'active', occurred_at: '2026-10-04T12:00:00Z', variant_ref: VARIANT, livemode: true };
  const okRow = { outcome: 'RECORDED', event_id: 1, is_latest: true, bound: true, state: 'paid' };
  const go = async (script, brokerage = BK) => { try { return await B.makeBillingReads(rpcWith(script).rpc).applyEvent(brokerage, EVENT); } catch (e) { return e.constructor.name; } };
  const r = await go({ billing_event_apply: okRows([okRow]) });
  ok(r.outcome === 'RECORDED' && r.bound === true && r.state === 'paid' && r.is_latest === true && !('event_id' in r), '1j a recorded event answers its outcome, whether it bound, the state and whether it is the latest, and no event id');
  const { rpc, calls } = rpcWith({ billing_event_apply: okRows([okRow]) });
  await B.makeBillingReads(rpc).applyEvent(BK, EVENT);
  ok(calls.length === 1 && calls[0][0] === 'billing_event_apply' && calls[0][1].p_brokerage === BK && calls[0][1].p_event === EVENT && Object.keys(calls[0][1]).length === 2, '1k the write is ONE call to billing_event_apply with the brokerage and the event');
  ok((await go({ billing_event_apply: okRows([{ ...okRow, outcome: 'DUPLICATE', bound: false }]) })).outcome === 'DUPLICATE', '1l a retried delivery is DUPLICATE');
  ok(await go({ billing_event_apply: refused('BINDING_CONFLICT') }) === 'BindingConflict', '1m BINDING_CONFLICT is BindingConflict');
  ok(await go({ billing_event_apply: refused('BROKERAGE_UNKNOWN') }) === 'BrokerageUnknown', '1n BROKERAGE_UNKNOWN is BrokerageUnknown');
  ok(await go({ billing_event_apply: refused('payment_event: the event key "foo" is not one of the nine') }) === 'EventRefused' && await go({ billing_event_apply: refused('billing_event_apply: the event must be an object') }) === 'EventRefused',
    '1o the ledger\'s own refusals (they name a field and never a value) are EventRefused');
  ok(await go({ billing_event_apply: refused('duplicate key value violates unique constraint') }) === 'DataUnavailable', '1p any other refusal is DataUnavailable, not a named one');
  ok(await go({ billing_event_apply: okRows([]) }) === 'DataUnavailable' && await go({ billing_event_apply: okRows([okRow, okRow]) }) === 'DataUnavailable', '1q no row, or two rows, is a fault');
  ok(await go({ billing_event_apply: okRows([{ ...okRow, outcome: 'MAYBE' }]) }) === 'DataUnavailable' && await go({ billing_event_apply: okRows([{ ...okRow, state: 'rich' }]) }) === 'DataUnavailable'
     && await go({ billing_event_apply: okRows([{ ...okRow, bound: 'yes' }]) }) === 'DataUnavailable', '1r a row of the wrong shape is a fault');
  ok(await go({}, 'not-a-uuid') === 'BrokerageUnknown', '1s a brokerage id that is not a UUID never reaches the database');
}
{
  // the checkout slot (docs/da-owner-safeguards.sql part C)
  const URL1 = 'https://homesignal.lemonsqueezy.com/checkout/custom/first';
  const claim = async (script, brokerage = BK) => { try { return await B.makeBillingReads(rpcWith(script).rpc).checkoutClaim(brokerage); } catch (e) { return e.constructor.name; } };
  ok(JSON.stringify(await claim({ billing_checkout_claim: okRows([{ outcome: 'CLAIMED', url: null }]) })) === '{"outcome":"CLAIMED"}', '1t a free slot reads CLAIMED');
  ok(JSON.stringify(await claim({ billing_checkout_claim: okRows([{ outcome: 'BUSY', url: null }]) })) === '{"outcome":"BUSY"}', '1u a slot another request is filling reads BUSY');
  ok(JSON.stringify(await claim({ billing_checkout_claim: okRows([{ outcome: 'OPEN', url: URL1 }]) })) === JSON.stringify({ outcome: 'OPEN', url: URL1 }), '1v an open checkout reads OPEN with its address');
  let f = 0;
  for (const bad of [[{ outcome: 'OPEN', url: 'http://homesignal.lemonsqueezy.com/x' }], [{ outcome: 'OPEN', url: 'https://evil.example/checkout' }], [{ outcome: 'OPEN', url: 'https://lemonsqueezy.com.evil.example/x' }],
    [{ outcome: 'OPEN', url: null }], [{ outcome: 'CLAIMED', url: URL1 }], [{ outcome: 'BUSY', url: URL1 }], [{ outcome: 'MAYBE', url: null }], [], [{ outcome: 'CLAIMED', url: null }, { outcome: 'CLAIMED', url: null }], null, 'x']) {
    if (await claim({ billing_checkout_claim: okRows(bad) }) === 'DataUnavailable') f++;
  }
  ok(f === 11, '1w an address that is not the processor\'s own https address, or an answer of the wrong shape or count, is a fault and is never handed on (eleven shapes)', f);
  ok(await claim({ billing_checkout_claim: refused('boom') }) === 'DataUnavailable' && await claim({}, 'not-a-uuid') === 'DataUnavailable', '1x a database error, or a brokerage id that is not a UUID, is DataUnavailable');
  const { rpc, calls } = rpcWith({ billing_checkout_claim: okRows([{ outcome: 'CLAIMED', url: null }]), billing_checkout_record: okRows(null), billing_checkout_release: okRows(null) });
  const reads = B.makeBillingReads(rpc);
  await reads.checkoutClaim(BK); await reads.checkoutRecord(BK, URL1); await reads.checkoutRelease(BK);
  ok(calls.length === 3 && JSON.stringify(calls[0]) === JSON.stringify(['billing_checkout_claim', { p_brokerage: BK }]) && JSON.stringify(calls[1]) === JSON.stringify(['billing_checkout_record', { p_brokerage: BK, p_url: URL1 }])
     && JSON.stringify(calls[2]) === JSON.stringify(['billing_checkout_release', { p_brokerage: BK }]), '1y each is ONE call with the brokerage (and the address for record) and nothing else');
  let e2 = 0;
  try { await B.makeBillingReads(rpcWith({ billing_checkout_record: refused('x') }).rpc).checkoutRecord(BK, URL1); } catch (e) { if (e instanceof Svc.DataUnavailable) e2++; }
  try { await B.makeBillingReads(rpcWith({ billing_checkout_release: refused('x') }).rpc).checkoutRelease(BK); } catch (e) { if (e instanceof Svc.DataUnavailable) e2++; }
  ok(e2 === 2, '1z a failed record or release is DataUnavailable (the caller decides it is best-effort)', e2);
}

// ---- 2. manage-billing ------------------------------------------------------------------------------------------------------------------------
const mcalls = [];
function mdeps(over = {}) {
  const rec = (name, f) => async (...a) => { mcalls.push([name, ...a]); return f(...a); };
  return {
    authenticate: rec('authenticate', over.authenticate ?? (async () => ({ email: 'owner@example.test', id: UID }))),
    isAdmin: rec('isAdmin', over.isAdmin ?? (async () => false)),
    usageOf: rec('usageOf', over.usageOf ?? (async () => usage())),
    configured: () => over.configured ?? true,
    createCheckout: rec('createCheckout', over.createCheckout ?? (async () => 'https://homesignal.lemonsqueezy.com/checkout/custom/abc')),
    checkoutClaim: rec('checkoutClaim', over.checkoutClaim ?? (async () => ({ outcome: 'CLAIMED' }))),
    checkoutRecord: rec('checkoutRecord', over.checkoutRecord ?? (async () => undefined)),
    checkoutRelease: rec('checkoutRelease', over.checkoutRelease ?? (async () => undefined)),
  };
}
async function ask(d, body, { method = 'POST', auth = 'Bearer t', raw } = {}) {
  mcalls.length = 0;
  const headers = { 'content-type': 'application/json' };
  if (auth) headers.authorization = auth;
  const init = { method, headers };
  if (method === 'POST') init.body = raw !== undefined ? raw : JSON.stringify(body);
  const res = await MH.makeHandler(d)(new Request('https://x/functions/v1/manage-billing', init));
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json, text, cache: res.headers.get('cache-control') };
}
const named = (name) => mcalls.filter((c) => c[0] === name);
{
  let r = await ask(mdeps(), null, { method: 'GET', auth: null });
  ok(r.status === 200 && r.json.product === 'HOMESIGNAL DEVELOPMENT ACTIVITY' && r.cache === 'no-store' && JSON.stringify(r.json.writes) === '[]', '2a the capability is described, writes nothing and is never cached');
  r = await ask(mdeps(), { action: 'status' }, { auth: null });
  ok(r.status === 401 && mcalls.length === 0, '2b no token: refused 401, and nothing was asked of anyone');
  r = await ask(mdeps({ authenticate: async () => null }), { action: 'status' });
  ok(r.status === 401 && named('usageOf').length === 0, '2c the public anon key (no user): refused 401');
  r = await ask(mdeps({ authenticate: async () => ({ email: 'a@example.test' }) }), { action: 'status' });
  ok(r.status === 403 && named('usageOf').length === 0, '2d a user with no id: refused 403');
  r = await ask(mdeps({ authenticate: async () => { throw new Svc.DataUnavailable('x'); } }), { action: 'status' });
  ok(r.status === 502 && named('usageOf').length === 0, '2e an unreachable user lookup is 502, never "allowed"');
  r = await ask(mdeps(), null, { raw: 'x'.repeat(5000) });
  ok(r.status === 413 && named('usageOf').length === 0, '2f a body over the cap is 413');
  r = await ask(mdeps(), null, { method: 'DELETE' });
  ok(r.status === 405, '2g any method but GET, POST and OPTIONS is 405');
  r = await ask(mdeps(), null, { raw: 'not json' });
  ok(r.status === 400 && named('usageOf').length === 0, '2h a body that is not JSON is 400');
  let bad400 = 0;
  for (const body of [{}, { action: 'refund' }, { action: 5 }, { action: 'status', plan: 'x' }, { action: 'checkout', brokerage_id: BK }, { action: 'checkout', url: 'https://evil.example' }, [], 'x', { action: '__proto__' }, { action: 'constructor' }]) {
    r = await ask(mdeps(), body);
    if (r.status === 400 && named('usageOf').length === 0 && named('createCheckout').length === 0) bad400++;
  }
  ok(bad400 === 10, '2i an unknown action, an unknown field (the page cannot name a brokerage or a url) or a body that is not an object is 400 before anything is read (ten bodies)', bad400);
}
{
  // status
  const stat = async (u, configured = true) => ask(mdeps({ usageOf: async () => u, configured }), { action: 'status' });
  let r = await stat(usage({ role: 'owner', state: 'none' }));
  ok(r.status === 200 && r.json.status === 'OK' && r.json.checkout === 'available' && r.json.plan.state === 'none' && r.json.plan.role === 'owner', '2j an owner with no plan may start a checkout');
  ok(!r.text.includes(BK) && !r.text.includes(UID) && !r.text.includes(SECRET) && !r.text.includes(API_KEY), '2k the answer carries neither the brokerage id, the user id nor a secret');
  r = await stat(usage({ role: 'agent', state: 'none' }));
  ok(r.json.checkout === 'not_owner' && r.json.plan.role === 'agent', '2l an agent is told they are an agent and that checkout is the owner\'s');
  r = await stat(PAID);
  ok(r.json.checkout === 'already_paid' && r.json.plan.state === 'paid' && r.json.plan.credits_remaining === 97 && r.json.plan.period_ends_at === '2026-11-04T12:00:00+00:00', '2m a paid brokerage reads paid, with the month\'s figures, and may not start another checkout');
  r = await stat(usage({ role: 'owner', state: 'canceled' }));
  ok(r.json.checkout === 'available' && r.json.plan.state === 'canceled', '2n a canceled brokerage may subscribe again (a new binding, a new month)');
  let held = 0;
  for (const state of ['past_due', 'trialing', 'unknown', 'suspended']) { r = await stat(usage({ role: 'owner', state })); if (r.json.checkout === 'subscription_exists' && r.json.plan.state === state) held++; }
  ok(held === 4, '2o a brokerage whose subscription exists and may recover (past due, trialing, unclear, suspended) is told so, and is offered NO second checkout: a second one would bill it twice', held);
  r = await stat(usage({ role: 'owner', state: 'test_only' }));
  ok(r.json.checkout === 'available', '2o2 a brokerage with only a TEST subscription may start a real checkout (a test subscription never granted anything)');
  r = await stat(usage({ role: 'owner', state: 'none' }), false);
  ok(r.json.checkout === 'not_set_up', '2p with the processor not set up, status says so and promises nothing');
  r = await stat(usage({ role: 'agent', state: 'none' }), false);
  ok(r.json.checkout === 'not_owner', '2q an agent is told it is the owner\'s even when the processor is not set up (the first reason is the person\'s own)');
  r = await ask(mdeps({ usageOf: async () => null }), { action: 'status' });
  ok(r.status === 403 && r.json.error === 'forbidden', '2r a person with no brokerage has no billing: 403');
  r = await ask(mdeps({ usageOf: async () => { throw new Svc.DataUnavailable('x'); } }), { action: 'status' });
  ok(r.status === 502 && r.json.error === 'data_unavailable', '2s an unreadable plan is 502, never "none"');
  r = await ask(mdeps({ usageOf: async () => { throw new Error('secret detail ' + BK); } }), { action: 'status' });
  ok(r.status === 500 && r.json.error === 'internal' && !r.text.includes(BK) && !r.text.includes('secret detail'), '2t any other failure is 500 and says nothing about why');
}
{
  // checkout
  const co = async (over, body = { action: 'checkout' }) => ask(mdeps(over), body);
  let r = await co({});
  ok(r.status === 200 && r.json.status === 'OK' && r.json.url === 'https://homesignal.lemonsqueezy.com/checkout/custom/abc' && JSON.stringify(Object.keys(r.json).sort()) === '["status","url"]'
     && named('createCheckout').length === 1 && named('createCheckout')[0][1] === BK, '2u an owner gets the processor\'s checkout address, made for THEIR brokerage (read from the database, never from the request)');
  r = await co({ usageOf: async () => usage({ role: 'agent' }) });
  ok(r.status === 403 && r.json.detail === 'owner_only' && named('createCheckout').length === 0, '2v an agent cannot start a checkout (403 owner_only) and the processor is never asked');
  r = await co({ usageOf: async () => PAID });
  ok(r.status === 409 && r.json.error === 'already_paid' && named('createCheckout').length === 0, '2w a paid brokerage cannot start another checkout (409), and the processor is never asked');
  r = await co({ configured: false });
  ok(r.status === 503 && r.json.error === 'billing_not_set_up' && named('createCheckout').length === 0, '2x with the processor not set up the checkout is refused 503 and the processor is never asked');
  r = await co({ createCheckout: async () => { throw new MH.CheckoutUnavailable('http 500'); } });
  ok(r.status === 502 && r.json.error === 'checkout_unavailable' && !r.text.includes('500'), '2y a processor that cannot give a checkout is 502, with no reason');
  r = await co({ usageOf: async () => null });
  ok(r.status === 403 && named('createCheckout').length === 0, '2z a person with no brokerage cannot start a checkout');
  r = await co({ createCheckout: async () => { throw new Svc.DataUnavailable('x'); } });
  ok(r.status === 502 && r.json.error === 'data_unavailable', '2aa a data fault while making the checkout is 502');
  let blocked = 0;
  for (const state of ['past_due', 'trialing', 'unknown']) {
    r = await ask(mdeps({ usageOf: async () => usage({ role: 'owner', state }) }), { action: 'checkout' });
    if (r.status === 409 && r.json.error === 'subscription_exists' && named('createCheckout').length === 0) blocked++;
  }
  ok(blocked === 3, '2ab a checkout over a subscription that exists and may recover (past due, trialing, unclear) is refused 409 and the processor is never asked: a second subscription would bill twice', blocked);
  r = await ask(mdeps({ usageOf: async () => usage({ role: 'owner', state: 'canceled' }) }), { action: 'checkout' });
  ok(r.status === 200 && named('createCheckout').length === 1, '2ab2 a brokerage whose subscription has ended may subscribe again');
  // ONE OPEN CHECKOUT AT A TIME (docs/da-owner-safeguards.sql part C)
  const OPENURL = 'https://homesignal.lemonsqueezy.com/checkout/custom/first';
  r = await co({});
  ok(named('checkoutClaim').length === 1 && named('checkoutClaim')[0][1] === BK && named('checkoutRecord').length === 1 && named('checkoutRecord')[0][1] === BK
     && named('checkoutRecord')[0][2] === 'https://homesignal.lemonsqueezy.com/checkout/custom/abc' && named('checkoutRelease').length === 0,
    '2ad a first press claims the brokerage\'s slot, makes ONE checkout, and keeps its address for the next press (the slot is for the brokerage read from the database)');
  r = await co({ checkoutClaim: async () => ({ outcome: 'OPEN', url: OPENURL }) });
  ok(r.status === 200 && r.json.url === OPENURL && JSON.stringify(Object.keys(r.json).sort()) === '["status","url"]' && named('createCheckout').length === 0 && named('checkoutRecord').length === 0,
    '2ae a second press while a checkout is open gets THAT checkout\'s address back and the processor is NOT asked for another');
  r = await co({ checkoutClaim: async () => ({ outcome: 'BUSY' }) });
  ok(r.status === 409 && r.json.error === 'checkout_in_progress' && named('createCheckout').length === 0 && !r.text.includes('http'),
    '2af while another request is still making the checkout the answer is 409 checkout_in_progress and the processor is not asked');
  r = await co({ checkoutClaim: async () => { throw new Svc.DataUnavailable('x'); } });
  ok(r.status === 502 && r.json.error === 'data_unavailable' && named('createCheckout').length === 0,
    '2ag a slot that cannot be claimed is 502 and NO checkout is made: a limiter that cannot be read is not an open door');
  r = await co({ createCheckout: async () => { throw new MH.CheckoutUnavailable('http 500'); } });
  ok(r.status === 502 && r.json.error === 'checkout_unavailable' && named('checkoutRelease').length === 1 && named('checkoutRelease')[0][1] === BK && named('checkoutRecord').length === 0,
    '2ah a processor that cannot give a checkout frees the slot at once (so the owner can try again) and records nothing');
  r = await co({ createCheckout: async () => { throw new MH.CheckoutUnavailable('http 500'); }, checkoutRelease: async () => { throw new Svc.DataUnavailable('x'); } });
  ok(r.status === 502 && r.json.error === 'checkout_unavailable', '2ai and a failed release does not hide the real answer (the slot frees itself in two minutes)');
  r = await co({ checkoutRecord: async () => { throw new Svc.DataUnavailable('x'); } });
  ok(r.status === 200 && r.json.url === 'https://homesignal.lemonsqueezy.com/checkout/custom/abc', '2aj and a failed record does not lose a checkout that was made: the owner still gets the address');
  r = await co({ checkoutClaim: async () => ({ outcome: 'OPEN', url: OPENURL }), usageOf: async () => PAID });
  ok(r.status === 409 && r.json.error === 'already_paid' && named('checkoutClaim').length === 0, '2ak a paid brokerage never reaches the slot at all (the plan check comes first)');
  for (const [who, over] of [['an agent', { usageOf: async () => usage({ role: 'agent' }) }], ['processor not set up', { configured: false }]]) {
    r = await co(over);
    ok(named('checkoutClaim').length === 0, '2al ' + who + ' never claims the slot');
  }
  ok(MH.checkoutAvailability(usage({ role: 'owner', state: 'paid' }), true) === 'already_paid' && MH.checkoutAvailability(usage({ role: 'agent', state: 'paid' }), true) === 'not_owner'
     && MH.checkoutAvailability(usage({ role: 'owner' }), false) === 'not_set_up' && MH.checkoutAvailability(usage({ role: 'owner' }), true) === 'available'
     && MH.checkoutAvailability(usage({ role: 'owner', state: 'past_due' }), true) === 'subscription_exists' && MH.checkoutAvailability(usage({ role: 'owner', state: 'canceled' }), false) === 'not_set_up',
    '2ac the ONE reading of who may start a checkout, answered directly for its five outcomes');
}

// ---- 3. the webhook ---------------------------------------------------------------------------------------------------------------------------
const wcalls = [];
const goodApplied = { outcome: 'RECORDED', bound: true, state: 'paid', is_latest: true };
function wdeps(over = {}) {
  return {
    secret: over.secret ?? SECRET,
    variantId: over.variantId ?? VARIANT,
    applyEvent: async (...a) => { wcalls.push(a); if (over.applyEvent) return over.applyEvent(...a); return goodApplied; },
  };
}
async function body(over = {}) {
  const bind = await L.checkoutBinding(SECRET, BK);
  const p = {
    meta: { event_name: 'subscription_created', test_mode: false, custom_data: { brokerage_id: BK, bind } },
    data: { type: 'subscriptions', id: '987654', attributes: { product_id: 4242, variant_id: 123456, status: 'active', user_email: 'pat.payer@example.test', updated_at: '2026-10-04T12:00:05.000000Z', test_mode: false } },
  };
  if (over.mutate) over.mutate(p);
  return JSON.stringify(p);
}
async function hook(d, raw, { sig, method = 'POST', headers = {} } = {}) {
  wcalls.length = 0;
  const h = { 'content-type': 'application/json', ...headers };
  if (sig !== null) h['x-signature'] = sig === undefined ? hmac(SECRET, raw ?? '') : sig;
  const init = { method, headers: h };
  if (method === 'POST') init.body = raw;
  const res = await WH.makeHandler(d)(new Request('https://x/functions/v1/development-activity-billing-webhook', init));
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json, text, cache: res.headers.get('cache-control'), acao: res.headers.get('access-control-allow-origin') };
}
{
  let r = await hook(wdeps(), undefined, { method: 'GET' });
  ok(r.status === 200 && r.json.configured === true && r.cache === 'no-store' && !r.text.includes(SECRET), '3a the capability says whether it is configured (a boolean) and never a value');
  r = await hook(wdeps({ secret: '' }), undefined, { method: 'GET' });
  ok(r.json.configured === false, '3b it says so when the secret is missing');
  r = await hook(wdeps({ variantId: '' }), undefined, { method: 'GET' });
  ok(r.json.configured === false, '3c and when the variant is missing');
  r = await hook(wdeps({ variantId: 'abc' }), undefined, { method: 'GET' });
  ok(r.json.configured === false, '3d and when the variant is not a number');
  r = await hook(wdeps(), undefined, { method: 'OPTIONS' });
  ok(r.status === 204 && r.acao === null, '3e a browser preflight is answered with nothing and no cross-origin grant: no page ever calls this');
  r = await hook(wdeps(), '{}', { method: 'PUT' });
  ok(r.status === 405 && wcalls.length === 0, '3f any method but GET, POST and OPTIONS is 405');
}
{
  // not set up: every request refused, and the body is never trusted
  const raw = await body();
  for (const [label, over] of [['no secret', { secret: '' }], ['no variant', { variantId: '' }], ['a non-numeric variant', { variantId: 'x' }]]) {
    const r = await hook(wdeps(over), raw, { sig: hmac(over.secret === '' ? '' : SECRET, raw) });
    ok(r.status === 503 && r.json.error === 'not_set_up' && wcalls.length === 0, '3g with ' + label + ' EVERY request is refused 503, even one signed under the empty secret, and nothing is recorded');
  }
}
{
  const raw = await body();
  let r = await hook(wdeps(), raw, { sig: null });
  ok(r.status === 401 && r.json.error === 'unauthorized' && wcalls.length === 0, '3h no signature header: 401, nothing recorded');
  r = await hook(wdeps(), raw, { sig: 'f'.repeat(64) });
  ok(r.status === 401 && wcalls.length === 0, '3i a wrong signature: 401');
  r = await hook(wdeps(), raw, { sig: hmac('whsec_other', raw) });
  ok(r.status === 401 && wcalls.length === 0, '3j a signature made under another secret: 401');
  r = await hook(wdeps(), raw + ' ', { sig: hmac(SECRET, raw) });
  ok(r.status === 401 && wcalls.length === 0, '3k a body changed after it was signed (one trailing space): 401');
  r = await hook(wdeps(), JSON.stringify(JSON.parse(raw), null, 2), { sig: hmac(SECRET, raw) });
  ok(r.status === 401 && wcalls.length === 0, '3l the RAW bytes are what is signed: the same JSON re-serialised is refused');
  r = await hook(wdeps(), raw, { sig: hmac(SECRET, raw).toUpperCase() });
  ok(r.status === 200, '3m an upper-case hex signature verifies');
  r = await hook(wdeps(), 'x'.repeat(WH.MAX_BODY_BYTES + 1));
  ok(r.status === 413 && wcalls.length === 0, '3n a body larger than any real event is 413, before it is hashed');
  r = await hook(wdeps(), raw, { headers: { 'content-length': String(WH.MAX_BODY_BYTES + 1) } });
  ok(r.status === 413 && wcalls.length === 0, '3o a declared length over the cap is refused 413 before the body is read');
}
{
  // a verified body
  let r = await hook(wdeps(), await body());
  ok(r.status === 200 && r.json.status === 'OK' && r.json.outcome === 'RECORDED' && wcalls.length === 1 && wcalls[0][0] === BK
     && wcalls[0][1].processor === 'lemonsqueezy' && wcalls[0][1].subscription_ref === '987654' && wcalls[0][1].livemode === true && wcalls[0][1].variant_ref === '123456',
    '3p a verified subscription event is recorded for the brokerage the SIGNED checkout named, once');
  ok(!r.text.includes(BK) && !r.text.includes('987654') && !r.text.includes('pat.payer') && JSON.stringify(Object.keys(r.json).sort()) === '["outcome","status"]',
    '3q the answer is a word: it carries no brokerage id, subscription id or payer detail');
  ok(!JSON.stringify(wcalls).includes('pat.payer') && !JSON.stringify(wcalls).includes('user_email'), '3r nothing personal reaches the recorder, though the body held an email');
  r = await hook(wdeps({ applyEvent: async () => ({ ...goodApplied, outcome: 'DUPLICATE', bound: false }) }), await body());
  ok(r.status === 200 && r.json.outcome === 'DUPLICATE', '3s a retried delivery is 200 DUPLICATE (the processor stops retrying)');
  r = await hook(wdeps(), await body({ mutate: (p) => { p.meta.event_name = 'order_created'; } }));
  ok(r.status === 200 && r.json.status === 'IGNORED' && r.json.reason === 'event_name' && wcalls.length === 0, '3t an order event is acknowledged 200 and recorded nowhere');
  r = await hook(wdeps(), await body({ mutate: (p) => { delete p.meta.custom_data; } }));
  ok(r.status === 200 && r.json.status === 'IGNORED' && r.json.reason === 'no_binding' && wcalls.length === 0, '3u a subscription this server did not make a checkout for (no custom data) is acknowledged and recorded nowhere');
  r = await hook(wdeps(), await body({ mutate: (p) => { p.meta.custom_data.bind = 'a'.repeat(64); } }));
  ok(r.status === 200 && r.json.reason === 'bad_binding' && wcalls.length === 0, '3v a checkout carrying a forged brokerage signature is acknowledged and recorded nowhere (a buyer cannot bind to an account)');
  r = await hook(wdeps(), await body({ mutate: (p) => { p.data.attributes.variant_id = 7; } }));
  ok(r.status === 200 && r.json.reason === 'variant' && wcalls.length === 0, '3w another product\'s subscription is acknowledged and recorded nowhere');
  r = await hook(wdeps(), await body({ mutate: (p) => { delete p.data.attributes.status; } }));
  ok(r.status === 422 && r.json.error === 'invalid' && r.json.reason === 'status' && wcalls.length === 0, '3x a subscription of ours that is not shaped as expected is 422 (loud, so a changed payload is noticed)');
  const junk = 'not json at all';
  r = await hook(wdeps(), junk);
  ok(r.status === 422 && r.json.reason === 'json' && wcalls.length === 0, '3y a correctly signed body that is not JSON is 422');
  r = await hook(wdeps(), await body({ mutate: (p) => { p.meta.test_mode = true; p.data.attributes.test_mode = true; } }));
  ok(r.status === 200 && wcalls.length === 1 && wcalls[0][1].livemode === false, '3z a TEST event is recorded as livemode false');
}
{
  const err = (e) => wdeps({ applyEvent: async () => { throw e; } });
  let r = await hook(err(new B.BindingConflict('x')), await body());
  ok(r.status === 409 && r.json.error === 'binding_conflict', '3aa a subscription that already belongs to another brokerage is 409 and recorded nowhere');
  r = await hook(err(new B.BrokerageUnknown('x')), await body());
  ok(r.status === 422 && r.json.reason === 'brokerage_unknown', '3ab a signed id that is no brokerage is 422');
  r = await hook(err(new B.EventRefused('x')), await body());
  ok(r.status === 422 && r.json.reason === 'event_refused', '3ac an event the ledger refuses is 422');
  r = await hook(err(new Svc.DataUnavailable('db')), await body());
  ok(r.status === 503 && r.json.error === 'data_unavailable', '3ad a database that cannot be reached is 503, so the processor retries');
  r = await hook(err(new Error('boom ' + BK + ' ' + SECRET)), await body());
  ok(r.status === 500 && r.json.error === 'internal' && !r.text.includes(BK) && !r.text.includes(SECRET) && !r.text.includes('boom'), '3ae any other failure is 500 and says nothing about why');
}

// ---- 4. the real data layers ------------------------------------------------------------------------------------------------------------------
{
  const reqs = [];
  const mkFetch = (routes) => async (url, init) => {
    reqs.push({ url: String(url), init: init ?? {} });
    for (const [re, fn] of routes) if (re.test(String(url))) return fn(url, init);
    return new Response('{}', { status: 404 });
  };
  const json = (v, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
  const BILL = { apiKey: API_KEY, storeId: '4321', variantId: VARIANT, secret: SECRET, testMode: false };

  // webhook data
  reqs.length = 0;
  let d = WD.makeDeps({ url: BASE, serviceKey: SERVICE, secret: SECRET, variantId: VARIANT }, mkFetch([[/rpc\/billing_event_apply$/, () => json([{ outcome: 'RECORDED', event_id: 9, is_latest: true, bound: true, state: 'paid' }])]]));
  const EVENT = { processor: 'lemonsqueezy', idempotency_key: 'k', subscription_ref: '1', event_name: 'subscription_created', processor_status: 'active', occurred_at: '2026-10-04T12:00:00Z', variant_ref: VARIANT, livemode: true };
  const out = await d.applyEvent(BK, EVENT);
  ok(out.outcome === 'RECORDED' && d.secret === SECRET && d.variantId === VARIANT, '4a the webhook\'s data layer carries the secret and the variant and records through applyEvent');
  ok(reqs.length === 1 && reqs[0].url === BASE + '/rest/v1/rpc/billing_event_apply' && reqs[0].init.method === 'POST' && reqs[0].init.headers.apikey === SERVICE && reqs[0].init.headers.Authorization === 'Bearer ' + SERVICE
     && JSON.parse(reqs[0].init.body).p_brokerage === BK && JSON.parse(reqs[0].init.body).p_event.subscription_ref === '1', '4b exactly ONE request: the project\'s own database function, as the service, with the brokerage and the event');
  reqs.length = 0;
  d = WD.makeDeps({ url: BASE, serviceKey: SERVICE, secret: SECRET, variantId: VARIANT }, mkFetch([[/rpc\/billing_event_apply$/, () => json({ message: 'BINDING_CONFLICT' }, 400)]]));
  let e = 'none'; try { await d.applyEvent(BK, EVENT); } catch (x) { e = x.constructor.name; }
  ok(e === 'BindingConflict', '4c a database refusal travels through the real layer as its named error', e);
  d = WD.makeDeps({ url: BASE, serviceKey: SERVICE, secret: SECRET, variantId: VARIANT }, mkFetch([[/rpc\/billing_event_apply$/, () => json({ message: 'x' }, 503)]]));
  e = 'none'; try { await d.applyEvent(BK, EVENT); } catch (x) { e = x.constructor.name; }
  ok(e === 'DataUnavailable', '4d a 5xx is DataUnavailable (the processor retries)', e);

  // manage-billing data
  reqs.length = 0;
  const CHECKOUT_OK = { data: { type: 'checkouts', id: 'c', attributes: { url: 'https://homesignal.lemonsqueezy.com/checkout/custom/abc?signature=1' } } };
  d = MD.makeDeps({ url: BASE, serviceKey: SERVICE, billing: BILL }, mkFetch([[/api\.lemonsqueezy\.com\/v1\/checkouts$/, () => json(CHECKOUT_OK, 201)], [/rpc\/billing_usage$/, () => json([PAID])]]));
  ok(d.configured() === true && MD.isConfigured(BILL) === true, '4e a complete configuration is configured');
  const url = await d.createCheckout(BK);
  ok(url === 'https://homesignal.lemonsqueezy.com/checkout/custom/abc?signature=1' && reqs.length === 1, '4f the checkout is ONE request to the processor and returns its address');
  const sent = reqs[0];
  const sbody = JSON.parse(sent.init.body);
  ok(sent.url === 'https://api.lemonsqueezy.com/v1/checkouts' && sent.init.method === 'POST' && sent.init.headers.Authorization === 'Bearer ' + API_KEY
     && sbody.data.attributes.checkout_data.custom.brokerage_id === BK && sbody.data.attributes.checkout_data.custom.bind === hmac(SECRET, 'hs-billing-checkout|' + BK)
     && sbody.data.attributes.product_options.redirect_url === B.BILLING_PAGE,
    '4g the request is the processor\'s endpoint, with the API key in the header, the brokerage and ITS signature in the custom data, and the billing page as the return address');
  ok(!sent.init.body.includes(API_KEY) && !sent.init.body.includes(SECRET) && !JSON.stringify(sent.init.headers).includes(SERVICE), '4h the API key is never in the body, the signing secret is never sent, and the project\'s service key never goes to the processor');
  ok(B.BILLING_PAGE === 'https://homesignal.net/development-activity-reports.html#billing', '4i the return address is the billing section of the agent\'s page');
  let f = 0;
  for (const routes of [[[/checkouts$/, () => json({ errors: [{ detail: 'x' }] }, 422)]], [[/checkouts$/, () => json({ data: { attributes: { url: 'https://evil.example/x' } } }, 201)]],
    [[/checkouts$/, () => new Response('not json', { status: 201 })]], [[/checkouts$/, () => { throw new Error('network down ' + API_KEY); }]]]) {
    const dd = MD.makeDeps({ url: BASE, serviceKey: SERVICE, billing: BILL }, mkFetch(routes));
    try { await dd.createCheckout(BK); } catch (x) { if (x instanceof MH.CheckoutUnavailable && !String(x.message).includes(API_KEY)) f++; }
  }
  ok(f === 4, '4j a refusal, a foreign address, an unreadable answer or a dead network is CheckoutUnavailable, and the API key is in none of the messages (four cases)', f);
  let readBody = false;
  const dd = MD.makeDeps({ url: BASE, serviceKey: SERVICE, billing: BILL }, mkFetch([[/checkouts$/, () => ({ ok: false, status: 500, json: async () => { readBody = true; return {}; }, text: async () => { readBody = true; return ''; } })]]));
  try { await dd.createCheckout(BK); } catch { /* expected */ }
  ok(readBody === false, '4k when the processor refuses, its answer\'s body is never read (it can name the buyer)');
  let unconfigured = 0;
  for (const b of [{ ...BILL, apiKey: '' }, { ...BILL, secret: '' }, { ...BILL, storeId: '' }, { ...BILL, variantId: 'abc' }, { ...BILL, storeId: 'x1' }]) {
    const x = MD.makeDeps({ url: BASE, serviceKey: SERVICE, billing: b }, mkFetch([]));
    reqs.length = 0;
    let threw = false; try { await x.createCheckout(BK); } catch (y) { threw = y instanceof MH.CheckoutUnavailable; }
    if (x.configured() === false && MD.isConfigured(b) === false && threw && reqs.length === 0) unconfigured++;
  }
  ok(unconfigured === 5, '4l any missing or malformed setting is "not configured", and then NO request goes to the processor (five cases)', unconfigured);
  reqs.length = 0;
  d = MD.makeDeps({ url: BASE, serviceKey: SERVICE, billing: BILL }, mkFetch([[/rpc\/billing_usage$/, () => json([PAID])]]));
  const got = await d.usageOf(UID);
  ok(got.state === 'paid' && reqs.length === 1 && reqs[0].url === BASE + '/rest/v1/rpc/billing_usage' && JSON.parse(reqs[0].init.body).p_user_id === UID, '4m the plan is read through the shared reader: one call to billing_usage, by user id');
}

console.log('\n' + (n - bad) + ' passed, ' + bad + ' failed of ' + n);
process.exit(bad ? 1 : 0);
