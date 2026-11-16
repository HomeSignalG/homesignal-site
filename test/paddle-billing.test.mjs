// PADDLE, edge half — offline, against the REAL modules, handlers and data layers (Paddle replaced Lemon Squeezy, 2026-11-16).
//   supabase/functions/_shared/paddle-billing.ts   signature, checkout binding, translation, portal request
//   supabase/functions/paddle-webhook              Paddle's signed events (the HMAC is the gate)
//   supabase/functions/manage-billing              status / offer / checkout / checkout_release / portal
// The database half is test/paddle_billing_pg. Payload shapes follow Paddle Billing's documented notification format; the founder's first SANDBOX payment
// is what confirms them against the real service (docs/paddle-billing-2026-11-16.md).  Run: node test/paddle-billing.test.mjs
import { createHmac } from 'node:crypto';

const P = await import('../supabase/functions/_shared/paddle-billing.ts');
const B = await import('../supabase/functions/_shared/billing-reads.ts');
const Svc = await import('../supabase/functions/_shared/service-rest.ts');
const WH = await import('../supabase/functions/paddle-webhook/handler.ts');
const WD = await import('../supabase/functions/paddle-webhook/data.ts');
const MH = await import('../supabase/functions/manage-billing/handler.ts');
const MD = await import('../supabase/functions/manage-billing/data.ts');

let n = 0, bad = 0;
const ok = (c, m, d) => { n++; if (c) console.log('PASS — ' + m); else { bad++; console.log('FAIL — ' + m + (d !== undefined ? '  [' + JSON.stringify(d) + ']' : '')); } };

const LIVE = 'pdl_ntfset_live_secret', SANDBOX = 'pdl_ntfset_sandbox_secret', BIND = 'binding-secret-for-tests';
const NOW = Date.parse('2026-11-16T12:00:00Z');
const TS = String(Math.floor(NOW / 1000));
const sign = (secret, body, ts = TS) => 'ts=' + ts + ';h1=' + createHmac('sha256', secret).update(ts + ':' + body).digest('hex');
const BK = '11111111-1111-4111-8111-111111111111', EN = '22222222-2222-4222-8222-222222222222', UID = '33333333-3333-4333-8333-333333333333';
const PRO = 'pri_01m7d6kede6hqr2kh9b78mb25j', PAR = 'pri_01m7d6q4yw2yzygm5cz92s5abg', PRODUCT = 'pro_01m7d6ke8gd7beyc6p68kvhxy3';
const EVT = (i) => 'evt_01hv8x8x8x8x8x8x8x8x8x8x' + String(10 + i);
const SUB = 'sub_01hv8x8x8x8x8x8x8x8x8x8x8x', TXN = 'txn_01hv8x8x8x8x8x8x8x8x8x8x8x';

// ---- 1. the signature ----------------------------------------------------------------------------------------------------------------------
{
  const body = '{"a":1}';
  const S = { live: LIVE, sandbox: SANDBOX };
  ok(await P.verifyWebhook(S, body, sign(LIVE, body), NOW) === 'live', '1a a delivery signed with the PRODUCTION secret is verified as live');
  ok(await P.verifyWebhook(S, body, sign(SANDBOX, body), NOW) === 'sandbox', '1b a delivery signed with the SANDBOX secret is verified as sandbox (never live)');
  ok(await P.verifyWebhook(S, body, sign('other', body), NOW) === null, '1c a wrong secret verifies nothing');
  ok(await P.verifyWebhook(S, body + ' ', sign(LIVE, body), NOW) === null, '1d a body changed by one byte verifies nothing (the RAW text is what is signed)');
  ok(await P.verifyWebhook(S, body, sign(LIVE, body, String(Math.floor(NOW / 1000) - 301)), NOW) === null, '1e a replayed request older than five minutes is refused');
  ok(await P.verifyWebhook(S, body, sign(LIVE, body, String(Math.floor(NOW / 1000) + 301)), NOW) === null, '1f a timestamp from the future is refused');
  ok(await P.verifyWebhook({ live: '', sandbox: '' }, body, sign('', body), NOW) === null, '1g with no secret configured NOTHING verifies, even a signature made with the empty string (fails closed)');
  ok(await P.verifyWebhook({ live: '', sandbox: SANDBOX }, body, sign(LIVE, body), NOW) === null && await P.verifyWebhook({ live: LIVE, sandbox: '' }, body, sign(SANDBOX, body), NOW) === null, '1h each secret verifies only its own environment');
  const rot = 'ts=' + TS + ';h1=' + '0'.repeat(64) + ';h1=' + createHmac('sha256', LIVE).update(TS + ':' + body).digest('hex');
  ok(await P.verifyWebhook(S, body, rot, NOW) === 'live', '1i during a secret rotation Paddle sends two h1 values: either may match');
  for (const h of [null, '', 'garbage', 'ts=1;h1=zz', 'ts=' + TS, 'h1=' + 'a'.repeat(64), 'ts=' + TS + ';ts=' + TS + ';h1=' + 'a'.repeat(64), 'ts=abc;h1=' + 'a'.repeat(64)]) {
    ok(await P.verifyWebhook(S, body, h, NOW) === null, '1j a malformed header verifies nothing: ' + JSON.stringify(h));
  }
}

// ---- 2. the checkout binding -----------------------------------------------------------------------------------------------------------------
{
  const b = await P.checkoutBinding(BIND, BK, 'private_partner', EN);
  ok(/^[0-9a-f]{64}$/.test(b) && await P.verifyBinding(BIND, BK, 'private_partner', EN, b), '2a a binding made by this server verifies');
  ok(!(await P.verifyBinding(BIND, BK, 'professional', EN, b)), '2b the PLAN is inside the signature: a partner checkout cannot be passed off as Professional');
  ok(!(await P.verifyBinding(BIND, BK, 'private_partner', null, b)) && !(await P.verifyBinding(BIND, BK, 'private_partner', '44444444-4444-4444-8444-444444444444', b)), '2c the enrollment is inside the signature');
  ok(!(await P.verifyBinding(BIND, '55555555-5555-4555-8555-555555555555', 'private_partner', EN, b)), '2d the account is inside the signature (a buyer cannot pay into someone else\'s account)');
  ok(!(await P.verifyBinding('other-secret', BK, 'private_partner', EN, b)) && !(await P.verifyBinding('', BK, 'private_partner', EN, b)), '2e a different or empty secret verifies nothing');
  ok(!(await P.verifyBinding(BIND, BK, 'private_partner', EN, 'x')) && !(await P.verifyBinding(BIND, BK, 'private_partner', EN, undefined)) && !(await P.verifyBinding(BIND, 'nope', 'professional', null, b)), '2f a malformed binding or id verifies nothing');
  let threw = 0;
  for (const f of [() => P.checkoutBinding('', BK, 'professional', null), () => P.checkoutBinding(BIND, 'nope', 'professional', null), () => P.checkoutBinding(BIND, BK, 'enterprise', null)]) { try { await f(); } catch { threw++; } }
  ok(threw === 3, '2g making a binding with no secret, a bad id or an unknown plan throws', threw);
  const s = await P.checkoutSession({ environment: 'sandbox', clientToken: 'test_abc', bindingSecret: BIND }, BK, 'professional', null, PRO);
  ok(s.priceId === PRO && s.environment === 'sandbox' && s.customData.brokerage_id === BK && s.customData.plan === 'professional' && !('enrollment_id' in s.customData)
     && await P.verifyBinding(BIND, s.customData.brokerage_id, s.customData.plan, undefined, s.customData.bind) && !JSON.stringify(s).includes(BIND), '2h a checkout session carries the public token, the price and signed custom data - never the secret');
}

// ---- 3. translation ---------------------------------------------------------------------------------------------------------------------------
const custom = async (plan, enr = null, acct = BK) => ({ brokerage_id: acct, plan, ...(enr ? { enrollment_id: enr } : {}), bind: await P.checkoutBinding(BIND, acct, plan, enr) });
const item = (price) => [{ price: { id: price, product_id: PRODUCT }, quantity: 1 }];
async function subEvent(over = {}, type = 'subscription.created', dataOver = {}) {
  return { event_id: EVT(1), event_type: type, occurred_at: '2026-11-16T10:00:00.123456Z', notification_id: 'ntf_x',
    data: { id: SUB, status: 'active', items: item(PRO), custom_data: await custom('professional'), next_billed_at: '2026-12-16T10:00:00Z',
      current_billing_period: { starts_at: '2026-11-16T10:00:00Z', ends_at: '2026-12-16T10:00:00Z' }, scheduled_change: null, customer_id: 'ctm_secret', ...dataOver }, ...over };
}
{
  const t = await P.translate(await subEvent(), 'live', BIND);
  ok(t.kind === 'event' && t.brokerageId === BK && t.plan === 'professional' && t.enrollmentId === null, '3a a signed Professional subscription event is translated for its account');
  ok(t.event.processor === 'paddle' && t.event.idempotency_key === EVT(1) && t.event.subscription_ref === SUB && t.event.event_name === 'subscription_created'
     && t.event.processor_status === 'active' && t.event.variant_ref === PRO && t.event.product_ref === PRODUCT && t.event.livemode === true
     && /^[0-9a-f]/.test(t.event.occurred_at.slice(0, 1)) && t.event.occurred_at === '2026-11-16T10:00:00.123456Z', '3b the ledger event: Paddle\'s own event_id is the idempotency key, the price is the variant, livemode comes from the verified environment', t.event);
  ok(JSON.stringify(Object.keys(t.event).sort()) === JSON.stringify(['event_name', 'idempotency_key', 'livemode', 'occurred_at', 'processor', 'processor_status', 'product_ref', 'subscription_ref', 'variant_ref']), '3c the event carries exactly the ledger\'s allowed keys');
  ok(!JSON.stringify(t).includes('ctm_secret'), '3d no Paddle customer id (or any other field of the payload) is passed on');
  ok(t.period.next_billed_at === '2026-12-16T10:00:00Z' && t.period.period_ends_at === '2026-12-16T10:00:00Z' && t.period.cancel_effective_at === null, '3e the renewal date and the period end are carried');
  const t2 = await P.translate(await subEvent({}, 'subscription.updated', { scheduled_change: { action: 'cancel', effective_at: '2026-12-16T10:00:00Z', resume_at: null }, next_billed_at: null }), 'live', BIND);
  ok(t2.kind === 'event' && t2.period.cancel_effective_at === '2026-12-16T10:00:00Z' && t2.event.processor_status === 'active', '3f a SCHEDULED cancellation keeps status active and carries the end date (paid access runs to the end of the period)');
  const t3 = await P.translate(await subEvent({}, 'subscription.updated', { scheduled_change: { action: 'pause', effective_at: '2026-12-16T10:00:00Z' } }), 'live', BIND);
  ok(t3.kind === 'event' && t3.period.cancel_effective_at === null, '3g a scheduled PAUSE is not a cancellation');
  ok((await P.translate(await subEvent(), 'sandbox', BIND)).event.livemode === false, '3h the same body verified by the SANDBOX secret is livemode false');
  ok((await P.translate(await subEvent({}, 'subscription.canceled', { status: 'canceled' }), 'live', BIND)).event.event_name === 'subscription_canceled', '3i canceled maps to the ledger\'s vocabulary (no dot, one l)');
  const ev = await subEvent(); ev.data.custom_data = {};
  ok((await P.translate(ev, 'live', BIND)).kind === 'unbound' && (await P.translate(ev, 'live', BIND)).reason === 'no_binding', '3j a payment with no custom data is UNBOUND (kept for the operator, never granted)');
  const ev2 = await subEvent(); ev2.data.custom_data = { ...(await custom('professional')), brokerage_id: '66666666-6666-4666-8666-666666666666' };
  ok((await P.translate(ev2, 'live', BIND)).reason === 'bad_binding', '3k custom data edited in the browser (another account id) is a bad binding');
  const ev3 = await subEvent(); ev3.data.custom_data = { ...(await custom('professional')), plan: 'private_partner' };
  ok((await P.translate(ev3, 'live', BIND)).reason === 'bad_binding', '3l custom data with the plan swapped is a bad binding');
  const ev4 = await subEvent(); ev4.data.items = [...item(PRO), ...item(PAR)];
  ok((await P.translate(ev4, 'live', BIND)).kind === 'invalid', '3m two line items is not a plan we sell: refused loudly');
  ok((await P.translate(await subEvent({ event_id: 'evt_x' }), 'live', BIND)).reason === 'event_id' && (await P.translate(await subEvent({ occurred_at: '2026-11-16 10:00' }), 'live', BIND)).reason === 'occurred_at', '3n a missing or malformed event id or time is invalid');
  ok((await P.translate({ event_id: EVT(2), event_type: 'customer.updated', occurred_at: '2026-11-16T10:00:00Z', data: { id: 'ctm_1' } }, 'live', BIND)).kind === 'ignore', '3o an event that is not ours (a customer update) is ignored');
  ok((await P.translate(null, 'live', BIND)).kind === 'invalid' && (await P.translate({ event_type: 3, data: {} }, 'live', BIND)).kind === 'invalid', '3p a body that is not an event is invalid');

  const txn = { event_id: EVT(3), event_type: 'transaction.completed', occurred_at: '2026-11-16T10:00:00Z', data: { id: TXN, status: 'completed', subscription_id: null, items: item(PAR), custom_data: await custom('private_partner', EN) } };
  const tt = await P.translate(txn, 'live', BIND);
  ok(tt.kind === 'event' && tt.plan === 'private_partner' && tt.enrollmentId === EN && tt.event.subscription_ref === TXN && tt.event.event_name === 'transaction_completed' && tt.event.processor_status === 'completed' && tt.event.variant_ref === PAR && tt.period === null,
    '3q a one-time partner payment (transaction.completed) is translated with its enrollment', tt);
  const txs = structuredClone(txn); txs.data.subscription_id = SUB;
  ok((await P.translate(txs, 'live', BIND)).kind === 'ignore', '3r a subscription\'s own renewal transactions are ignored (the subscription events carry them)');
  const txu = structuredClone(txn); txu.data.status = 'billed';
  const tu = await P.translate(txu, 'live', BIND);
  ok(tu.kind === 'event' && tu.event.processor_status === 'billed', '3s a transaction that is only billed is passed through as such: the ledger maps it to unknown and it grants nothing');

  const adj = (over) => ({ event_id: EVT(4), event_type: 'adjustment.updated', occurred_at: '2026-11-17T10:00:00Z', data: { id: 'adj_01hv8x8x8x8x8x8x8x8x8x8x8x', action: 'refund', type: 'full', status: 'approved', transaction_id: TXN, subscription_id: null, ...over } });
  const ra = await P.translate(adj({}), 'live', BIND);
  ok(ra.kind === 'refund' && ra.event.subscription_ref === TXN && ra.event.processor_status === 'refunded' && ra.event.event_name === 'adjustment_refund', '3t a FULL approved refund of a one-time payment is a refund event against the transaction');
  ok((await P.translate(adj({ subscription_id: SUB }), 'live', BIND)).event.subscription_ref === SUB, '3u a refund of a subscription payment is recorded against the SUBSCRIPTION');
  ok((await P.translate(adj({ type: 'partial' }), 'live', BIND)).kind === 'ignore' && (await P.translate(adj({ status: 'pending_approval' }), 'live', BIND)).kind === 'ignore' && (await P.translate(adj({ action: 'credit' }), 'live', BIND)).kind === 'ignore',
    '3v a partial refund, an unapproved one and a credit change nothing');
  ok((await P.translate(adj({ action: 'chargeback' }), 'live', BIND)).kind === 'refund', '3w a full chargeback revokes like a refund');
}

// ---- 4. the webhook handler --------------------------------------------------------------------------------------------------------------------
const wcalls = [];
function wdeps(over = {}) {
  const rec = (name, f) => async (...a) => { wcalls.push([name, ...a]); return f(...a); };
  return {
    secrets: over.secrets ?? { live: LIVE, sandbox: SANDBOX }, bindingSecret: over.bindingSecret ?? BIND, now: () => NOW,
    applyEvent: rec('applyEvent', over.applyEvent ?? (async () => ({ outcome: 'RECORDED', bound: true, state: 'paid', is_latest: true }))),
    applyRefund: rec('applyRefund', over.applyRefund ?? (async () => ({ outcome: 'RECORDED', bound: false, state: 'canceled', is_latest: true }))),
    recordUnbound: rec('recordUnbound', over.recordUnbound ?? (async () => undefined)),
  };
}
async function hook(d, bodyObj, { secret = LIVE, header, method = 'POST', raw } = {}) {
  wcalls.length = 0;
  const body = raw ?? JSON.stringify(bodyObj);
  const headers = { 'content-type': 'application/json' };
  const sig = header === undefined ? sign(secret, body) : header;
  if (sig) headers['paddle-signature'] = sig;
  const res = await WH.makeHandler(d)(new Request('https://x/functions/v1/paddle-webhook', { method, headers, ...(method === 'POST' ? { body } : {}) }));
  const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json, text };
}
{
  const ev = await subEvent();
  let r = await hook(wdeps(), ev);
  ok(r.status === 200 && r.json.status === 'OK' && wcalls.length === 1 && wcalls[0][0] === 'applyEvent' && wcalls[0][1] === BK && wcalls[0][2] === 'professional' && wcalls[0][4].livemode === true, '4a a LIVE-signed Professional event is recorded for its account as live', r);
  r = await hook(wdeps(), ev, { secret: SANDBOX });
  ok(r.status === 200 && wcalls[0][4].livemode === false, '4b the same event signed by the SANDBOX secret is recorded as livemode FALSE: a sandbox delivery can never mark an account paid in production');
  r = await hook(wdeps(), ev, { header: null });
  ok(r.status === 401 && wcalls.length === 0 && r.json.error === 'unauthorized', '4c no signature header: 401, nothing recorded');
  r = await hook(wdeps(), ev, { secret: 'wrong' });
  ok(r.status === 401 && wcalls.length === 0, '4d a wrong signature: 401, nothing recorded, nothing parsed');
  r = await hook(wdeps(), ev, { header: sign(LIVE, JSON.stringify(ev), String(Math.floor(NOW / 1000) - 3600)) });
  ok(r.status === 401 && wcalls.length === 0, '4e a captured request replayed an hour later: 401');
  r = await hook(wdeps({ secrets: { live: '', sandbox: '' } }), ev);
  ok(r.status === 503 && r.json.error === 'not_set_up' && wcalls.length === 0, '4f with no signing secret EVERY request is refused 503 (never "no signature needed")');
  r = await hook(wdeps({ bindingSecret: '' }), ev);
  ok(r.status === 503 && wcalls.length === 0, '4g with no binding secret every request is refused');
  r = await hook(wdeps(), null, { raw: 'not json' });
  ok(r.status === 422 && r.json.reason === 'json' && wcalls.length === 0, '4h a signed body that is not JSON is 422');
  r = await hook(wdeps(), { ...ev, event_id: 'bad' });
  ok(r.status === 422 && wcalls.length === 0, '4i a signed body of the wrong shape is 422, loudly');
  r = await hook(wdeps(), { event_id: EVT(2), event_type: 'customer.updated', occurred_at: '2026-11-16T10:00:00Z', data: {} });
  ok(r.status === 200 && r.json.status === 'IGNORED' && wcalls.length === 0, '4j an event that is not ours is acknowledged (200) and recorded nowhere');
  const unbound = await subEvent(); unbound.data.custom_data = {};
  r = await hook(wdeps(), unbound);
  ok(r.status === 200 && r.json.reason === 'no_binding' && wcalls.length === 1 && wcalls[0][0] === 'recordUnbound' && !wcalls.some((c) => c[0] === 'applyEvent'), '4k a payment with no signed checkout is kept for the operator and never applied');
  const refund = { event_id: EVT(5), event_type: 'adjustment.updated', occurred_at: '2026-11-17T10:00:00Z', data: { id: 'adj_01hv8x8x8x8x8x8x8x8x8x8x8x', action: 'refund', type: 'full', status: 'approved', transaction_id: TXN, subscription_id: SUB } };
  r = await hook(wdeps(), refund);
  ok(r.status === 200 && wcalls.length === 1 && wcalls[0][0] === 'applyRefund' && wcalls[0][1].subscription_ref === SUB, '4l a full refund is applied against its subscription');
  r = await hook(wdeps({ applyEvent: async () => ({ outcome: 'DUPLICATE', bound: false, state: 'paid', is_latest: true }) }), ev);
  ok(r.status === 200 && r.json.outcome === 'DUPLICATE', '4m a re-delivered event is DUPLICATE and answered 200 (Paddle stops retrying)');
  r = await hook(wdeps({ applyEvent: async () => ({ outcome: 'PARTNER_NOT_ELIGIBLE', bound: false, state: null, is_latest: null }) }), ev);
  ok(r.status === 200 && r.json.outcome === 'PARTNER_NOT_ELIGIBLE', '4n a payment that granted nothing is answered 200 (it is kept in the unmatched list; retrying cannot help)');
  const err = (E) => wdeps({ applyEvent: async () => { throw new E('x'); } });
  r = await hook(err(B.BindingConflict), ev); ok(r.status === 409 && r.json.error === 'binding_conflict', '4o a subscription already bound to another account is 409');
  r = await hook(err(B.BrokerageUnknown), ev); ok(r.status === 422, '4p an account id that is no account is 422');
  r = await hook(err(B.EventRefused), ev); ok(r.status === 422, '4q an event the ledger refuses is 422');
  r = await hook(err(Svc.DataUnavailable), ev); ok(r.status === 503, '4r the database being unreachable is 503 so Paddle retries');
  r = await hook(err(Error), ev); ok(r.status === 500 && r.json.error === 'internal' && !r.text.includes('x\''), '4s any other failure is 500 with a fixed word');
  r = await hook(wdeps(), ev, { method: 'GET' });
  ok(r.status === 200 && r.json.configured === true && !r.text.includes(LIVE), '4t GET reports only whether it is configured');
  const big = 'x'.repeat(WH.MAX_BODY_BYTES + 10);
  r = await hook(wdeps(), null, { raw: big });
  ok(r.status === 413 && wcalls.length === 0, '4u an oversized body is 413 before it is verified');
  const txnBody = { event_id: EVT(3), event_type: 'transaction.completed', occurred_at: '2026-11-16T10:00:00Z', data: { id: TXN, status: 'completed', subscription_id: null, items: item(PAR), custom_data: await custom('private_partner', EN) } };
  r = await hook(wdeps(), txnBody);
  ok(r.status === 200 && wcalls[0][0] === 'applyEvent' && wcalls[0][2] === 'private_partner' && wcalls[0][3] === EN, '4v a partner payment reaches the writer with its plan and enrollment');
}

// ---- 5. manage-billing --------------------------------------------------------------------------------------------------------------------------
const mcalls = [];
const summary = (over = {}) => ({ brokerage_id: BK, role: 'owner', state: 'none', credit_limit: 100, credits_used: 0, credits_remaining: 0, period_ends_at: null, plan_key: null, plan_label: null, kind: null, access_months: null,
  next_reset_at: null, access_ends_at: null, renews_at: null, cancel_effective_at: null, ...over });
function mdeps(over = {}) {
  const rec = (name, f) => async (...a) => { mcalls.push([name, ...a]); return f(...a); };
  return {
    authenticate: rec('authenticate', over.authenticate ?? (async () => ({ email: 'o@example.test', id: UID }))),
    isAdmin: rec('isAdmin', async () => false),
    summaryOf: rec('summaryOf', over.summaryOf ?? (async () => summary())),
    configured: () => over.configured ?? true, apiConfigured: () => over.apiConfigured ?? true, checkoutEnabled: () => over.checkoutEnabled ?? true,
    paddleEnvironment: () => over.paddleEnvironment ?? 'sandbox',
    environmentMode: rec('environmentMode', over.environmentMode ?? (async () => 'staging')),
    gateArmed: rec('gateArmed', over.gateArmed ?? (async () => true)),
    termsAccept: rec('termsAccept', over.termsAccept ?? (async () => 'ACCEPTED')),
    partnerStart: rec('partnerStart', over.partnerStart ?? (async () => ({ outcome: 'OK', enrollment_id: EN, brokerage_id: BK }))),
    sha256: P.sha256Hex,
    makeSession: rec('makeSession', over.makeSession ?? (async (b, plan, enr) => ({ environment: 'sandbox', clientToken: 'test_x', priceId: plan === 'professional' ? PRO : PAR, customData: { brokerage_id: b, plan, ...(enr ? { enrollment_id: enr } : {}), bind: 'b'.repeat(64) } }))),
    checkoutClaim: rec('checkoutClaim', over.checkoutClaim ?? (async () => ({ outcome: 'CLAIMED' }))),
    checkoutRelease: rec('checkoutRelease', over.checkoutRelease ?? (async () => undefined)),
    managementUrls: rec('managementUrls', over.managementUrls ?? (async () => ({ update_payment_method: 'https://customer-portal.paddle.com/u', cancel: 'https://customer-portal.paddle.com/c' }))),
  };
}
async function ask(d, body, { method = 'POST', auth = 'Bearer t', raw, noTerms = false } = {}) {
  mcalls.length = 0;
  const headers = { 'content-type': 'application/json' }; if (auth) headers.authorization = auth;
  // a checkout carries the Terms version the page showed, unless a test is about its absence
  if (body && body.action === 'checkout' && body.terms_version === undefined && !noTerms) body = { ...body, terms_version: '2026-11-16' };
  const init = { method, headers }; if (method === 'POST') init.body = raw !== undefined ? raw : JSON.stringify(body);
  const res = await MH.makeHandler(d)(new Request('https://x/functions/v1/manage-billing', init));
  const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json, text };
}
const CODE = 'partner-code-0123456789abcdef';
{
  let r = await ask(mdeps(), { action: 'status' }, { auth: null });
  ok(r.status === 401 && !mcalls.some((c) => c[0] === 'summaryOf'), '5a no session: refused before anything is read');
  r = await ask(mdeps({ summaryOf: async () => null }), { action: 'status' });
  ok(r.status === 403, '5b a person with no account has no billing');
  r = await ask(mdeps(), { action: 'status' });
  ok(r.status === 200 && r.json.checkout === 'available' && r.json.plan.state === 'none' && !r.text.includes(BK), '5c status for an owner with no plan: checkout available, the account id is never sent', r.json);
  r = await ask(mdeps({ summaryOf: async () => summary({ state: 'paid', plan_key: 'private_partner', plan_label: 'Private Partner Offer', kind: 'one_time', credits_used: 4, credits_remaining: 96, next_reset_at: '2026-12-16T00:00:00Z', access_ends_at: '2027-05-16T00:00:00Z' }) }), { action: 'status' });
  ok(r.json.plan.credit_limit === 100 && r.json.plan.credits_remaining === 96 && r.json.plan.next_reset_at === '2026-12-16T00:00:00Z' && r.json.plan.access_ends_at === '2027-05-16T00:00:00Z' && r.json.plan.renews_at === null && r.json.checkout === 'already_paid' && r.json.portal === false,
    '5d the dashboard fields: allowance, remaining, next reset, access end, no renewal and no portal for a one-time plan', r.json);
  r = await ask(mdeps({ summaryOf: async () => summary({ state: 'paid', role: 'owner', kind: 'recurring', plan_key: 'professional', renews_at: '2026-12-16T00:00:00Z' }) }), { action: 'status' });
  ok(r.json.portal === true && r.json.plan.renews_at === '2026-12-16T00:00:00Z', '5e a recurring plan\'s owner is offered billing management');
  r = await ask(mdeps({ summaryOf: async () => summary({ role: 'agent' }) }), { action: 'checkout', plan: 'professional' });
  ok(r.status === 403 && r.json.detail === 'owner_only' && !mcalls.some((c) => c[0] === 'makeSession'), '5f an agent cannot start a checkout');
  r = await ask(mdeps(), { action: 'checkout', plan: 'professional' });
  ok(r.status === 200 && r.json.session.priceId === PRO && r.json.session.customData.plan === 'professional' && mcalls.some((c) => c[0] === 'checkoutClaim') && !mcalls.some((c) => c[0] === 'partnerStart'), '5g an owner gets a Professional session; no partner check is involved', r.json);
  r = await ask(mdeps(), { action: 'checkout', plan: 'professional', partner_code: CODE });
  ok(r.status === 400 && !mcalls.some((c) => c[0] === 'makeSession'), '5h a partner code on the public plan is a malformed request');
  r = await ask(mdeps(), { action: 'checkout', plan: 'private_partner' });
  ok(r.status === 404 && r.json.error === 'offer_unavailable' && !mcalls.some((c) => c[0] === 'makeSession'), '5i the partner offer WITHOUT a link is refused: a price id or a plan name alone grants nothing');
  r = await ask(mdeps(), { action: 'checkout', plan: 'private_partner', partner_code: 'short' });
  ok(r.status === 404 && !mcalls.some((c) => c[0] === 'partnerStart'), '5j a malformed code never reaches the database');
  r = await ask(mdeps(), { action: 'checkout', plan: 'private_partner', partner_code: CODE });
  const ps = mcalls.find((c) => c[0] === 'partnerStart');
  ok(r.status === 200 && r.json.session.priceId === PAR && r.json.session.customData.enrollment_id === EN && ps[2] === await P.sha256Hex(CODE) && ps[3] === true && !r.text.includes(CODE), '5k an eligible owner gets a partner session naming their enrollment; only the code\'s HASH reaches the database', r.json);
  for (const [outcome, st, err] of [['LINK_INVALID', 404, 'offer_unavailable'], ['ALREADY_USED', 409, 'offer_used'], ['ALREADY_PAID', 409, 'already_paid'], ['NOT_ENTITLED', 403, 'owner_only']]) {
    r = await ask(mdeps({ partnerStart: async () => ({ outcome, enrollment_id: null, brokerage_id: null }) }), { action: 'checkout', plan: 'private_partner', partner_code: CODE });
    ok(r.status === st && r.json.error === err && !mcalls.some((c) => c[0] === 'makeSession' || c[0] === 'checkoutClaim'), '5l partner outcome ' + outcome + ' -> ' + st + ' ' + err + ' and no session');
  }
  r = await ask(mdeps(), { action: 'offer', partner_code: CODE });
  ok(r.status === 200 && r.json.eligible === true && mcalls.find((c) => c[0] === 'partnerStart')[3] === false && !mcalls.some((c) => c[0] === 'checkoutClaim'), '5m the offer check is READ-ONLY (write=false) and claims no slot');
  r = await ask(mdeps(), { action: 'offer' });
  ok(r.status === 400, '5n the offer check needs a code');
  for (const [state, status, err] of [['paid', 409, 'already_paid'], ['past_due', 409, 'subscription_exists'], ['trialing', 409, 'subscription_exists'], ['suspended', 403, 'account_suspended']]) {
    r = await ask(mdeps({ summaryOf: async () => summary({ state }) }), { action: 'checkout', plan: 'professional' });
    ok(r.status === status && r.json.error === err && !mcalls.some((c) => c[0] === 'makeSession'), '5o state ' + state + ' cannot start a second checkout (' + err + ')');
  }
  for (const state of ['none', 'canceled', 'expired', 'test_only']) {
    r = await ask(mdeps({ summaryOf: async () => summary({ state }) }), { action: 'checkout', plan: 'professional' });
    ok(r.status === 200, '5p state ' + state + ' may buy');
  }
  r = await ask(mdeps({ checkoutEnabled: false }), { action: 'checkout', plan: 'professional' });
  ok(r.status === 503 && r.json.error === 'checkout_disabled' && !mcalls.some((c) => c[0] === 'makeSession'), '5q the committed kill switch refuses every checkout, whatever Paddle\'s settings');
  r = await ask(mdeps({ configured: false }), { action: 'checkout', plan: 'professional' });
  ok(r.status === 503 && r.json.error === 'billing_not_set_up', '5r unset Paddle settings are 503, never a guess');
  r = await ask(mdeps({ checkoutClaim: async () => ({ outcome: 'BUSY' }) }), { action: 'checkout', plan: 'professional' });
  ok(r.status === 409 && r.json.error === 'checkout_in_progress' && !mcalls.some((c) => c[0] === 'makeSession'), '5s a second checkout while one is open is refused');
  r = await ask(mdeps({ makeSession: async () => { throw new MH.CheckoutUnavailable('x'); } }), { action: 'checkout', plan: 'professional' });
  ok(r.status === 502 && r.json.error === 'checkout_unavailable' && mcalls.some((c) => c[0] === 'checkoutRelease'), '5t a failed session frees the slot and answers 502');
  r = await ask(mdeps(), { action: 'checkout_release' });
  ok(r.status === 200 && mcalls.some((c) => c[0] === 'checkoutRelease'), '5u closing the overlay without paying frees the slot');
  r = await ask(mdeps(), { action: 'checkout', plan: 'enterprise' });
  ok(r.status === 400 && r.json.detail === 'plan', '5v Brokerage & Enterprise cannot be bought: an unknown plan is a malformed request');
  r = await ask(mdeps(), { action: 'checkout', plan: 'professional', price_id: PAR });
  ok(r.status === 400 && /unknown field/.test(r.json.detail) && !mcalls.some((c) => c[0] === 'makeSession'), '5w the page cannot name a price: an extra field is refused');
  // ---- decisions 3 and 4: terms before purchase, and the environment / launch-gate safety checks ----
  r = await ask(mdeps(), { action: 'checkout', plan: 'professional' }, { noTerms: true });
  ok(r.status === 409 && r.json.error === 'terms_not_accepted' && !mcalls.some((c) => c[0] === 'makeSession' || c[0] === 'checkoutClaim' || c[0] === 'termsAccept'), '5aa a checkout with no Terms version is refused before anything is recorded or signed');
  r = await ask(mdeps(), { action: 'checkout', plan: 'professional', terms_version: 'yesterday' });
  ok(r.status === 409 && r.json.error === 'terms_not_accepted' && !mcalls.some((c) => c[0] === 'makeSession'), '5ab a malformed Terms version is refused');
  r = await ask(mdeps({ termsAccept: async () => 'VERSION_STALE' }), { action: 'checkout', plan: 'professional' });
  ok(r.status === 409 && r.json.error === 'terms_not_accepted' && r.json.detail === 'terms_changed' && !mcalls.some((c) => c[0] === 'makeSession' || c[0] === 'checkoutClaim'), '5ac a Terms version that is no longer current gets no session (the page must show the new Terms first)');
  r = await ask(mdeps({ termsAccept: async () => 'NOT_OWNER' }), { action: 'checkout', plan: 'professional' });
  ok(r.status === 403 && !mcalls.some((c) => c[0] === 'makeSession'), '5ad only the owner can agree for the account');
  r = await ask(mdeps(), { action: 'checkout', plan: 'professional' });
  const ta = mcalls.findIndex((c) => c[0] === 'termsAccept'), ms = mcalls.findIndex((c) => c[0] === 'makeSession');
  ok(r.status === 200 && ta > 0 && ms > ta && mcalls[ta][2] === '2026-11-16' && mcalls[ta][3] === 'professional', '5ae the agreement is RECORDED (version and plan) BEFORE the session is signed');
  r = await ask(mdeps(), { action: 'checkout', plan: 'private_partner', partner_code: CODE });
  const tb = mcalls.findIndex((c) => c[0] === 'termsAccept');
  ok(r.status === 200 && tb > 0 && mcalls[tb][3] === 'private_partner', '5af the partner offer requires the same agreement');
  r = await ask(mdeps({ paddleEnvironment: 'production', environmentMode: async () => 'staging' }), { action: 'checkout', plan: 'professional' });
  ok(r.status === 503 && r.json.error === 'billing_environment_mismatch' && !mcalls.some((c) => c[0] === 'makeSession' || c[0] === 'termsAccept'), '5ag a PRODUCTION Paddle function pointed at a STAGING database sells nothing');
  r = await ask(mdeps({ paddleEnvironment: 'sandbox', environmentMode: async () => 'production' }), { action: 'checkout', plan: 'professional' });
  ok(r.status === 503 && r.json.error === 'billing_environment_mismatch' && !mcalls.some((c) => c[0] === 'makeSession'), '5ah a SANDBOX checkout against the PRODUCTION database sells nothing (a sandbox payment can never be taken there)');
  r = await ask(mdeps({ paddleEnvironment: 'production', environmentMode: async () => 'production' }), { action: 'checkout', plan: 'professional' });
  ok(r.status === 200, '5ai production function + production database is the one allowed live pairing');
  r = await ask(mdeps({ gateArmed: async () => false }), { action: 'checkout', plan: 'professional' });
  ok(r.status === 503 && r.json.error === 'billing_gate_not_armed' && !mcalls.some((c) => c[0] === 'makeSession'), '5aj checkout cannot open while the unpaid-report gate is not armed: launching and gating are one act');
  r = await ask(mdeps({ checkoutEnabled: false }), { action: 'status' });
  ok(r.status === 200 && r.json.checkout === 'disabled' && !mcalls.some((c) => c[0] === 'environmentMode' || c[0] === 'gateArmed'), '5ak with the kill switch off, the database is not even asked about the environment or the gate');
  r = await ask(mdeps({ environmentMode: async () => { throw new MH.DataUnavailable('x'); } }), { action: 'checkout', plan: 'professional' });
  ok(r.status === 502 && !mcalls.some((c) => c[0] === 'makeSession'), '5al an unreadable environment fails closed (502), never a guess');
  r = await ask(mdeps(), { action: 'portal' });
  ok(r.status === 409, '5x the portal is refused for a plan with no recurring subscription');
  r = await ask(mdeps({ summaryOf: async () => summary({ state: 'paid', kind: 'recurring', plan_key: 'professional' }) }), { action: 'portal' });
  ok(r.status === 200 && r.json.cancel === 'https://customer-portal.paddle.com/c' && r.json.update_payment_method === 'https://customer-portal.paddle.com/u' && !r.text.includes('sub_'), '5y the owner of a recurring plan gets Paddle\'s own management addresses (no subscription id)');
  r = await ask(mdeps({ summaryOf: async () => summary({ role: 'agent', state: 'paid', kind: 'recurring' }) }), { action: 'portal' });
  ok(r.status === 403, '5z an agent cannot open the portal');
}

// ---- 6. the real data layers -----------------------------------------------------------------------------------------------------------------------
{
  const mkFetch = (routes) => { const reqs = []; const f = async (input, init) => { const u = String(input); reqs.push([u, init]); for (const [re, fn] of routes) if (re.test(u)) return fn(u, init); return new Response('{}', { status: 404 }); }; return { f, reqs }; };
  const json = (v, st = 200) => new Response(JSON.stringify(v), { status: st, headers: { 'content-type': 'application/json' } });
  const SBASE = 'https://proj.supabase.co';
  const cfg = (env = 'sandbox', over = {}) => ({ url: SBASE, serviceKey: 'service-key', paddle: { environment: env, clientToken: env === 'production' ? 'live_' + 'a'.repeat(30) : 'test_' + 'a'.repeat(30), apiKey: 'pdl_secret_key', bindingSecret: BIND, ...over } });
  {
    // the three new database reads: the environment, the launch gate and the Terms agreement
    const c3 = [];
    const { f: fe } = mkFetch([[/\/rest\/v1\/rpc\/(\w+)$/, (u, init) => { const fn = u.match(/rpc\/(\w+)$/)[1]; c3.push([fn, JSON.parse(init.body)]); return json(fn === 'billing_environment_mode' ? 'staging' : fn === 'billing_gate_state' ? [{ paid_required: true, honor_granted_free_reports: false }] : 'ACCEPTED'); }]]);
    const dd = MD.makeDeps(cfg('sandbox'), fe);
    ok(await dd.environmentMode() === 'staging' && await dd.gateArmed() === true && await dd.termsAccept(UID, '2026-11-16', 'professional') === 'ACCEPTED', '6aa the environment, the gate and the Terms agreement are each one database call and are read as the database answered');
    ok(c3.find((c) => c[0] === 'billing_terms_accept')[1].p_user_id === UID && c3.find((c) => c[0] === 'billing_terms_accept')[1].p_version === '2026-11-16' && c3.find((c) => c[0] === 'billing_terms_accept')[1].p_plan === 'professional', '6ab the agreement names the signed-in person, the version and the plan');
    const { f: fb } = mkFetch([[/\/rest\/v1\/rpc\/(\w+)$/, () => json('weird')]]);
    let bad = 0; for (const fn of ['environmentMode', 'gateArmed']) { try { await MD.makeDeps(cfg('sandbox'), fb)[fn](); } catch (e) { bad++; } }
    try { await MD.makeDeps(cfg('sandbox'), fb).termsAccept(UID, '2026-11-16', 'professional'); } catch (e) { bad++; }
    ok(bad === 3, '6ac an answer of an unknown shape from any of the three is a failed read, never a pass');
  }
  ok(MD.isConfigured(cfg('sandbox').paddle) && MD.isConfigured(cfg('production').paddle), '6a a token of the right kind for its environment is configured');
  ok(!MD.isConfigured({ ...cfg('production').paddle, clientToken: 'test_' + 'a'.repeat(30) }) && !MD.isConfigured({ ...cfg('sandbox').paddle, clientToken: 'live_' + 'a'.repeat(30) }) && !MD.isConfigured({ ...cfg('sandbox').paddle, bindingSecret: '' }) && !MD.isConfigured({ ...cfg('sandbox').paddle, clientToken: '' }),
    '6b a sandbox token in production (or the reverse), or a missing token or binding secret, is NOT configured');
  const rpcRoutes = (calls, answers) => [[/\/rest\/v1\/rpc\/(\w+)$/, (u, init) => { const fn = u.match(/rpc\/(\w+)$/)[1]; calls.push([fn, JSON.parse(init.body)]); return json(answers[fn] ?? []); }]];
  const calls = [];
  const { f } = mkFetch(rpcRoutes(calls, { billing_price_for: PRO }));
  const d = MD.makeDeps(cfg('sandbox'), f);
  const sess = await d.makeSession(BK, 'professional', null);
  ok(calls.length === 1 && calls[0][0] === 'billing_price_for' && calls[0][1].p_plan_key === 'professional' && calls[0][1].p_livemode === false && sess.priceId === PRO && sess.environment === 'sandbox', '6c the price comes from the DATABASE for the configured environment (sandbox = livemode false)', calls);
  const { f: f2 } = mkFetch(rpcRoutes([], { billing_price_for: null }));
  let t = 0; try { await MD.makeDeps(cfg('sandbox'), f2).makeSession(BK, 'professional', null); } catch (e) { if (e instanceof MH.CheckoutUnavailable) t++; }
  ok(t === 1, '6d a plan with no registered price in this environment is CheckoutUnavailable (the sandbox catalogue must be registered first)');
  const calls2 = [];
  const { f: f3, reqs } = mkFetch([...rpcRoutes(calls2, { billing_portal_ref: [{ subscription_ref: SUB, livemode: false }] }),
    [/sandbox-api\.paddle\.com\/subscriptions\//, () => json({ data: { management_urls: { update_payment_method: 'https://sandbox-customer-portal.paddle.com/u', cancel: 'https://sandbox-customer-portal.paddle.com/c' } } })]]);
  const urls = await MD.makeDeps(cfg('sandbox'), f3).managementUrls(UID);
  const pr = reqs.find((r) => /paddle\.com/.test(r[0]));
  ok(urls && urls.cancel.startsWith('https://sandbox-customer-portal.paddle.com/') && pr[0] === 'https://sandbox-api.paddle.com/subscriptions/' + SUB && pr[1].method === 'GET' && pr[1].headers.Authorization === 'Bearer pdl_secret_key', '6e the portal asks Paddle\'s SANDBOX API for the subscription, with the key only in that request\'s header');
  ok(reqs.filter((r) => !/paddle\.com/.test(r[0])).every((r) => !JSON.stringify(r[1]).includes('pdl_secret_key')), '6f the API key is sent nowhere else');
  const { f: f4 } = mkFetch([...rpcRoutes([], { billing_portal_ref: [{ subscription_ref: SUB, livemode: false }] })]);
  ok(await MD.makeDeps(cfg('production'), f4).managementUrls(UID) === null, '6g a TEST subscription is never opened through the production API');
  const { f: f5 } = mkFetch([...rpcRoutes([], { billing_portal_ref: [{ subscription_ref: SUB, livemode: false }] }), [/paddle\.com/, () => json({ data: { management_urls: { cancel: 'https://evil.example/c', update_payment_method: 'http://x.paddle.com/u' } } })]]);
  ok(await MD.makeDeps(cfg('sandbox'), f5).managementUrls(UID) === null, '6h an address that is not https on paddle.com is never handed on');
  ok(P.paddleUrl('https://paddle.com.evil.example/x') === null && P.paddleUrl('https://u:p@paddle.com/x') === null && P.paddleUrl('https://customer-portal.paddle.com/x') !== null, '6i the host test is exact (no lookalike, no credentials)');
  const { f: f6 } = mkFetch([...rpcRoutes([], { billing_portal_ref: [{ subscription_ref: SUB, livemode: false }] }), [/paddle\.com/, () => json({}, 500)]]);
  let t2 = 0; try { await MD.makeDeps(cfg('sandbox'), f6).managementUrls(UID); } catch (e) { if (e instanceof MH.CheckoutUnavailable) t2++; }
  ok(t2 === 1, '6j a Paddle failure is CheckoutUnavailable and its body is never read');
  // the webhook's data layer: exactly the database calls, with the service key, and nothing else
  const calls3 = [];
  const { f: f7, reqs: reqs7 } = mkFetch(rpcRoutes(calls3, { paddle_event_apply: [{ outcome: 'RECORDED', event_id: 1, is_latest: true, bound: true, state: 'paid' }] }));
  const wd = WD.makeDeps({ url: SBASE, serviceKey: 'service-key', secrets: { live: LIVE, sandbox: '' }, bindingSecret: BIND }, f7);
  const ev = (await P.translate(await subEvent(), 'live', BIND));
  const a = await wd.applyEvent(ev.brokerageId, ev.plan, ev.enrollmentId, ev.event, ev.period);
  ok(a.outcome === 'RECORDED' && calls3.length === 1 && calls3[0][0] === 'paddle_event_apply' && calls3[0][1].p_plan === 'professional' && calls3[0][1].p_brokerage === BK && calls3[0][1].p_event.livemode === true && reqs7.length === 1, '6k the webhook\'s data layer makes ONE database call: paddle_event_apply');
}

console.log('\n' + (n - bad) + ' of ' + n + ' passed' + (bad ? ', ' + bad + ' FAILED' : ''));
process.exit(bad ? 1 : 0);
