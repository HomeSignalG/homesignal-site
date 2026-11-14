// PADDLE'S SHAPES, in the one place this repo knows them (supabase/functions/_shared/paddle-billing.ts) — offline.
//   1. the signature: header `ts=..;h1=..`, HMAC-SHA256 over `<ts>:<RAW body>`, hex, constant-time, ts within tolerance, several h1 allowed, empty secret verifies nothing;
//   2. which ENVIRONMENT verified (livemode comes from the secret, never from the body; the same secret in both environments is refused);
//   3. the checkout binding (signed brokerage id; a Sandbox or Lemon binding never verifies as a live Paddle one);
//   4. the translation (subscription events -> the ledger's nine keys; refunds / chargebacks -> a synthetic status; everything else ignored or refused);
//   5. the server-made transaction request and the one id handed to a browser.
// Every expected value is a constant or an independent computation (node:crypto), never the code under test.
// WHAT THIS DOES NOT PROVE: the payload fields come from Paddle's own Node SDK source, not from a captured Sandbox delivery; the adjustment ENUM VALUES
// (refund / full / approved / chargeback) and custom_data inheritance onto the subscription are unconfirmed until the first Sandbox payments (docs/paddle-billing-2026-11-14.md).
import { createHmac } from 'node:crypto';
const P = await import('../supabase/functions/_shared/paddle-billing.ts');
const L = await import('../supabase/functions/_shared/lemon-billing.ts');

let n = 0, bad = 0;
const ok = (c, m, d) => { n++; if (c) console.log('PASS — ' + m); else { bad++; console.log('FAIL — ' + m + (d !== undefined ? '  [' + JSON.stringify(d) + ']' : '')); } };
const hmac = (secret, msg) => createHmac('sha256', secret).update(msg).digest('hex');

const SECRET = 'pdl_ntfset_live_0123456789';
const SBX = 'pdl_ntfset_sandbox_9876543210';
const BK = 'b0b0b0b0-1111-4222-8333-444444444444';
const BK2 = 'c0c0c0c0-1111-4222-8333-444444444444';
const PRICE = 'pri_01m7d6kede6hqr2kh9b78mb25j';
const NOW = 1_800_000_000;
const sign = (secret, body, ts = NOW) => `ts=${ts};h1=${hmac(secret, ts + ':' + body)}`;

// ---- 1. the signature ----------------------------------------------------------------------------------------------------------------------
{
  const body = '{"event_id":"evt_1","event_type":"subscription.created","data":{"id":"sub_1"}}';
  const h = sign(SECRET, body);
  ok(await P.verifyPaddleSignature(SECRET, body, h, NOW) === true, '1a the right signature over the raw body verifies');
  ok(await P.verifyPaddleSignature(SECRET, body + ' ', h, NOW) === false && await P.verifyPaddleSignature(SECRET, body.replace('sub_1', 'sub_2'), h, NOW) === false,
    '1b one changed or added byte of the RAW body is refused (the text that was signed, not a re-serialised copy)');
  ok(await P.verifyPaddleSignature(SBX, body, h, NOW) === false, '1c a signature made under another secret is refused');
  ok(await P.verifyPaddleSignature(SECRET, body, sign(SECRET, body, NOW - 301), NOW) === false && await P.verifyPaddleSignature(SECRET, body, sign(SECRET, body, NOW + 301), NOW) === false,
    '1d a timestamp more than 5 minutes old OR in the future is refused (both directions)');
  ok(await P.verifyPaddleSignature(SECRET, body, sign(SECRET, body, NOW - 299), NOW) === true, '1e a timestamp 299 seconds old verifies (retry slack)');
  // the ts is part of what is signed: moving it without re-signing fails
  ok(await P.verifyPaddleSignature(SECRET, body, `ts=${NOW - 1};h1=${hmac(SECRET, NOW + ':' + body)}`, NOW) === false, '1f the timestamp is covered by the signature (a changed ts with the old h1 fails)');
  const good = hmac(SECRET, NOW + ':' + body), other = hmac(SBX, NOW + ':' + body);
  ok(await P.verifyPaddleSignature(SECRET, body, `ts=${NOW};h1=${other};h1=${good}`, NOW) === true && await P.verifyPaddleSignature(SECRET, body, `ts=${NOW};h1=${good};h1=${other}`, NOW) === true,
    '1g several h1 values are accepted when ANY matches, in either order (a rotated secret signs with both)');
  ok(await P.verifyPaddleSignature(SECRET, body, `ts=${NOW};h1=${other}`, NOW) === false, '1h several values do not weaken it: all wrong is refused');
  for (const [label, hdr] of [['no header', null], ['empty', ''], ['no ts', `h1=${good}`], ['no h1', `ts=${NOW}`], ['two ts', `ts=${NOW};ts=${NOW};h1=${good}`], ['non-hex', `ts=${NOW};h1=zz${good.slice(2)}`], ['short', `ts=${NOW};h1=${good.slice(2)}`], ['junk', 'hello'], ['non-numeric ts', `ts=abc;h1=${good}`]]) {
    ok(await P.verifyPaddleSignature(SECRET, body, hdr, NOW) === false, '1i a malformed header is refused: ' + label);
  }
  ok(await P.verifyPaddleSignature('', body, h, NOW) === false && await P.verifyPaddleSignature(undefined, body, h, NOW) === false, '1j an empty or missing secret verifies NOTHING (fails closed)');
  ok(await P.verifyPaddleSignature(SECRET, body, h.toUpperCase().replace('TS=', 'ts=').replace(';H1=', ';h1='), NOW) === true, '1k hex is case-blind');
}
// ---- 2. which environment verified -------------------------------------------------------------------------------------------------------------------
{
  const body = '{"x":1}';
  ok(await P.verifyEnvironment({ live: SECRET, sandbox: SBX }, body, sign(SECRET, body), NOW) === 'live', '2a a live-secret signature is environment live');
  ok(await P.verifyEnvironment({ live: SECRET, sandbox: SBX }, body, sign(SBX, body), NOW) === 'sandbox', '2b a sandbox-secret signature is environment sandbox (it can never be live)');
  ok(await P.verifyEnvironment({ live: SECRET, sandbox: SBX }, body, sign('nope', body), NOW) === null, '2c neither secret: null');
  ok(await P.verifyEnvironment({ live: '', sandbox: SBX }, body, sign(SECRET, body), NOW) === null && await P.verifyEnvironment({ live: SECRET, sandbox: '' }, body, sign(SBX, body), NOW) === null,
    '2d an unconfigured environment verifies nothing: a sandbox signature is refused when only live is set, and the reverse');
  ok(await P.verifyEnvironment({ live: SECRET, sandbox: SECRET }, body, sign(SECRET, body), NOW) === null, '2e the same secret configured for both environments is refused (livemode could not be told)');
}
// ---- 3. the binding -----------------------------------------------------------------------------------------------------------------------------
{
  const b = await P.paddleBinding(SECRET, BK);
  ok(b === hmac(SECRET, 'hs-billing-checkout|paddle|' + BK), '3a the binding is HMAC-SHA256 of a fixed Paddle context and the brokerage id under the environment\'s secret');
  ok(await P.verifyPaddleBinding(SECRET, BK, b) === true, '3b it verifies');
  ok(await P.verifyPaddleBinding(SECRET, BK2, b) === false, '3c it does not verify for another brokerage');
  ok(await P.verifyPaddleBinding(SBX, BK, b) === false, '3d a binding made under the Sandbox secret does not verify under the live one (and the reverse)');
  ok(await P.verifyPaddleBinding(SECRET, BK, await L.checkoutBinding(SECRET, BK)) === false, '3e a Lemon Squeezy binding for the same brokerage and secret does not verify as a Paddle one (different context)');
  ok(await P.verifyPaddleBinding('', BK, b) === false && await P.verifyPaddleBinding(SECRET, 'not-a-uuid', b) === false && await P.verifyPaddleBinding(SECRET, BK, 'abc') === false, '3f an empty secret, a malformed id or a malformed signature never verifies');
  let threw = 0; try { await P.paddleBinding('', BK); } catch { threw++; } try { await P.paddleBinding(SECRET, 'x'); } catch { threw++; }
  ok(threw === 2, '3g making a binding needs a secret and a UUID');
}
// ---- 4. the translation ------------------------------------------------------------------------------------------------------------------------
const bind = await P.paddleBinding(SECRET, BK);
const sub = (over = {}, data = {}) => ({
  event_id: 'evt_01hv8x9y0z1a2b3c4d5e6f7g8h', event_type: 'subscription.created', occurred_at: '2026-11-14T15:00:00.123456Z', notification_id: 'ntf_1',
  data: { id: 'sub_01hv8x9y0z1a2b3c4d5e6f7g8h', status: 'active', customer_id: 'ctm_1', custom_data: { brokerage_id: BK, bind },
    items: [{ status: 'active', quantity: 1, price: { id: PRICE, product_id: 'pro_01m7d6ke8gd7beyc6p68kvhxy3' } }], ...data }, ...over });
const CFG = { secret: SECRET, priceId: PRICE, livemode: true };
{
  const t = await P.translate(sub(), CFG);
  ok(t.kind === 'event' && t.brokerageId === BK, '4a a subscription event with a valid binding and our price is an event for that brokerage', t);
  ok(JSON.stringify(Object.keys(t.event).sort()) === JSON.stringify(['event_name', 'idempotency_key', 'livemode', 'occurred_at', 'processor', 'processor_status', 'product_ref', 'subscription_ref', 'variant_ref']),
    '4b the event carries exactly the ledger\'s nine keys and nothing personal (no customer id, no email, no custom data)');
  ok(t.event.idempotency_key === 'evt_01hv8x9y0z1a2b3c4d5e6f7g8h' && t.event.subscription_ref === 'sub_01hv8x9y0z1a2b3c4d5e6f7g8h' && t.event.processor === 'paddle' && t.event.processor_status === 'active'
     && t.event.variant_ref === PRICE && t.event.product_ref === 'pro_01m7d6ke8gd7beyc6p68kvhxy3' && t.event.occurred_at === '2026-11-14T15:00:00.123456Z' && t.event.livemode === true,
    '4c the idempotency key is Paddle\'s own event_id, the time is Paddle\'s occurred_at, the status is the subscription\'s own word');
  ok((await P.translate(sub(), { ...CFG, livemode: false })).event.livemode === false, '4d livemode is whatever the VERIFYING secret said, never read from the body');
  ok(!JSON.stringify(t).includes('ctm_1') && !JSON.stringify(t).includes(bind), '4e the customer id and the signature are not passed on');
  for (const s of ['active', 'trialing', 'past_due', 'paused', 'canceled']) {
    const x = await P.translate(sub({ event_type: 'subscription.updated' }, { status: s }), CFG);
    ok(x.kind === 'event' && x.event.processor_status === s, '4f status ' + s + ' is carried verbatim');
  }
  ok((await P.translate(sub({}, { status: 'unpaid' }), CFG)).kind === 'invalid' && (await P.translate(sub({}, { status: 7 }), CFG)).kind === 'invalid', '4g a status Paddle does not use is INVALID (loud), never guessed');
  ok((await P.translate(sub({ event_type: 'transaction.completed' }), CFG)).kind === 'ignore' && (await P.translate(sub({ event_type: 'customer.updated' }), CFG)).kind === 'ignore', '4h other event types are acknowledged and ignored');
  const noBind = sub({}, { custom_data: null });
  ok((await P.translate(noBind, CFG)).reason === 'no_binding' && (await P.translate(sub({}, { custom_data: { brokerage_id: BK } }), CFG)).reason === 'no_binding', '4i a subscription with no signed binding is ignored (a checkout we did not make)');
  ok((await P.translate(sub({}, { custom_data: { brokerage_id: BK2, bind } }), CFG)).reason === 'bad_binding', '4j a binding naming a DIFFERENT brokerage than it signs is ignored');
  ok((await P.translate(sub({}, { custom_data: { brokerage_id: BK, bind: await P.paddleBinding(SBX, BK) } }), CFG)).reason === 'bad_binding', '4k a Sandbox-made binding in a live event is ignored (separate secrets)');
  ok((await P.translate(sub({}, { items: [{ price: { id: 'pri_01m7d6kex4tsqv4gvjbtze9nbt', product_id: 'pro_x' } }] }), CFG)).reason === 'price', '4l another price (the Enterprise or the private partner offer) is ignored');
  ok((await P.translate(sub(), { ...CFG, priceId: '' })).reason === 'price', '4m with no configured price nothing is ours');
  ok((await P.translate(sub({ event_id: undefined }), CFG)).reason === 'event_id' && (await P.translate(sub({ occurred_at: '2026-11-14T15:00:00' }), CFG)).reason === 'occurred_at'
     && (await P.translate(sub({ occurred_at: 'garbage' }), CFG)).reason === 'occurred_at' && (await P.translate(sub({}, { id: undefined }), CFG)).reason === 'id' && (await P.translate(sub({}, { items: 'x' }), CFG)).reason === 'items',
    '4n a missing event id, a time with no offset, a missing subscription id or malformed items are INVALID');
  ok((await P.translate(null, CFG)).kind === 'invalid' && (await P.translate([], CFG)).kind === 'invalid' && (await P.translate({ data: {} }, CFG)).kind === 'invalid' && (await P.translate({ event_type: 5, data: {} }, CFG)).kind === 'invalid', '4o a body that is not an event is INVALID');
}
// adjustments
const adj = (data = {}, over = {}) => ({ event_id: 'evt_01hv8adjadjadjadjadjadjadj', event_type: 'adjustment.updated', occurred_at: '2026-11-20T10:00:00Z',
  data: { id: 'adj_1', action: 'refund', type: 'full', status: 'approved', transaction_id: 'txn_1', subscription_id: 'sub_01hv8x9y0z1a2b3c4d5e6f7g8h', customer_id: 'ctm_1', ...data }, ...over });
{
  const t = await P.translate(adj(), CFG);
  ok(t.kind === 'adjustment' && t.subscriptionRef === 'sub_01hv8x9y0z1a2b3c4d5e6f7g8h' && t.event.processor_status === 'refunded' && t.event.idempotency_key === 'evt_01hv8adjadjadjadjadjadjadj' && t.event.variant_ref === PRICE,
    '5a an approved FULL refund is an adjustment event of its subscription with the status word `refunded`', t);
  ok((await P.translate(adj({ action: 'chargeback', type: 'full' }), CFG)).event.processor_status === 'charged_back', '5b an approved chargeback is `charged_back`');
  for (const [label, d] of [['partial refund', { type: 'partial' }], ['pending approval', { status: 'pending_approval' }], ['rejected', { status: 'rejected' }], ['reversed', { status: 'reversed' }], ['credit', { action: 'credit' }]]) {
    ok((await P.translate(adj(d), CFG)).kind === 'ignore', '5c not final money-back: ' + label + ' changes nothing');
  }
  ok((await P.translate(adj({ subscription_id: null }), CFG)).reason === 'no_subscription', '5d an adjustment with no subscription (a one-off) is ignored');
  ok((await P.translate(adj({ action: undefined }), CFG)).kind === 'invalid', '5e an adjustment with no action is INVALID');
  ok((await P.translate(adj(), { ...CFG, livemode: false })).event.livemode === false, '5h a refund verified by the SANDBOX secret is a TEST-mode event (never livemode true)');
  ok(!('brokerageId' in t), '5f an adjustment names NO brokerage: it is bound only by the subscription the database already has');
  ok((await P.translate(adj({}, { event_type: 'adjustment.created' }), CFG)).kind === 'adjustment', '5g adjustment.created is read the same way');
}
// ---- 6. the checkout transaction -----------------------------------------------------------------------------------------------------------------
{
  const r = await P.transactionRequest({ environment: 'live', apiKey: 'pdl_live_apikey_abc', priceId: PRICE, secret: SECRET }, BK);
  const body = JSON.parse(r.init.body);
  ok(r.url === 'https://api.paddle.com/transactions' && r.init.method === 'POST', '6a a live transaction is asked of api.paddle.com');
  ok((await P.transactionRequest({ environment: 'sandbox', apiKey: 'k', priceId: PRICE, secret: SBX }, BK)).url === 'https://sandbox-api.paddle.com/transactions', '6b a sandbox one of sandbox-api.paddle.com');
  ok(JSON.stringify(body) === JSON.stringify({ items: [{ price_id: PRICE, quantity: 1 }], collection_mode: 'automatic', custom_data: { brokerage_id: BK, bind: hmac(SECRET, 'hs-billing-checkout|paddle|' + BK) } }),
    '6c the body is exactly one item of OUR price, quantity 1, automatic collection, and the signed binding (no trial, no discount, no annual)');
  ok(r.init.headers.Authorization === 'Bearer pdl_live_apikey_abc' && !r.init.body.includes('pdl_live_apikey_abc') && !r.init.body.includes(SECRET), '6d the API key is in one header only and the secret is nowhere in the body');
  let threw = 0;
  for (const c of [{ apiKey: '', priceId: PRICE, secret: SECRET }, { apiKey: 'k', priceId: 'nope', secret: SECRET }, { apiKey: 'k', priceId: PRICE, secret: '' }]) { try { await P.transactionRequest({ environment: 'live', ...c }, BK); } catch { threw++; } }
  ok(threw === 3, '6e an unconfigured checkout is refused before anything is built');
  ok(P.transactionIdFrom({ data: { id: 'txn_01hv8x9y0z1a2b3c4d5e6f7g8h' } }) === 'txn_01hv8x9y0z1a2b3c4d5e6f7g8h', '6f the transaction id of the documented shape is returned');
  ok(P.transactionIdFrom({ data: { id: 'sub_01hv8x9y0z1a2b3c4d5e6f7g8h' } }) === null && P.transactionIdFrom({ data: { id: 'txn_<script>' } }) === null && P.transactionIdFrom(null) === null && P.transactionIdFrom({ data: { checkout: { url: 'https://evil.test' } } }) === null,
    '6g anything else (another id kind, a script, a URL) is never handed to a browser');
}
console.log('\n' + (n - bad) + ' passed, ' + bad + ' failed of ' + n);
process.exit(bad ? 1 : 0);
