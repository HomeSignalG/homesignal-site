// PADDLE'S SHAPES, in the one place this repo knows them (replaces test/lemon-billing.test.mjs; founder 2026-11-14) — offline.
//   supabase/functions/_shared/paddle-billing.ts
//
//   1. the signature: Paddle-Signature `ts=<unix>;h1=<hex>`, HMAC-SHA256 of "<ts>:<RAW body>", the timestamp tolerance, a rotated secret's two h1s,
//      and an empty secret verifies NOTHING;
//   2. the checkout binding: a brokerage id is bound to a payment only by a signature this server made;
//   3. the translation: Professional subscription events and the Private Partner one-time payment become the ONE event the ledger accepts (exactly
//      its nine keys), with the access length fixed by the PRICE (6 months for the partner offer, none for a subscription), the environment taken
//      from configuration, and nothing personal carried across;
//   4. the checkout request: every byte of it, the API key in one header only;
//   5. the checkout answer: only an https address on our own page's host or Paddle's domain is ever handed to a browser.
// WHAT THIS DOES NOT PROVE: the field names are Paddle Billing's documented ones, not read from a captured payload (no Sandbox account exists yet).
// Every expected answer is a hard-coded constant or an independent computation (node:crypto), never the code under test.
// Run: node test/paddle-billing.test.mjs
import { createHmac } from 'node:crypto';

const P = await import('../supabase/functions/_shared/paddle-billing.ts');

let n = 0, bad = 0;
const ok = (c, m, d) => { n++; if (c) console.log('PASS — ' + m); else { bad++; console.log('FAIL — ' + m + (d !== undefined ? '  [' + JSON.stringify(d) + ']' : '')); } };
const hmac = (secret, msg) => createHmac('sha256', secret).update(msg).digest('hex');

const SECRET = 'pdl_ntfset_test_0123456789abcdef';
const OTHER = 'pdl_ntfset_other_fedcba9876543210';
const BROKERAGE = 'b0b0b0b0-1111-4222-8333-444444444444';
const OTHER_BROKERAGE = 'c0c0c0c0-1111-4222-8333-444444444444';
const PRO = 'pri_01m7d6kede6hqr2kh9b78mb25j';
const PARTNER = 'pri_01m7d6q4yw2yzygm5cz92s5abg';
const STRANGER = 'pri_01zzzzzzzzzzzzzzzzzzzzzzzz';
const PRICES = { professional: PRO, partner: PARTNER };
const NOW = 1_800_000_000;
const sign = (secret, ts, body) => 'ts=' + ts + ';h1=' + hmac(secret, ts + ':' + body);

// ---- 1. the signature --------------------------------------------------------------------------------------------------------------------------
{
  const body = '{"event_id":"evt_01","event_type":"subscription.created","data":{"id":"sub_1"}}';
  const hdr = sign(SECRET, NOW, body);
  ok(await P.hmacHex(SECRET, body) === hmac(SECRET, body), '1a hmacHex equals an INDEPENDENT HMAC-SHA256 (node:crypto) of the same bytes');
  ok(await P.verifySignature(SECRET, body, hdr, NOW) === true, '1b the right signature over "<ts>:<raw body>" verifies');
  ok(await P.verifySignature(OTHER, body, hdr, NOW) === false, '1c a signature made under another secret is refused');
  ok(await P.verifySignature(SECRET, body + ' ', hdr, NOW) === false && await P.verifySignature(SECRET, body.replace('sub_1', 'sub_2'), hdr, NOW) === false,
    '1d a body changed by one byte is refused');
  ok(await P.verifySignature(SECRET, JSON.stringify(JSON.parse(body), null, 2), hdr, NOW) === false, '1e the RAW text is what is signed: re-serialised JSON is refused');
  ok(await P.verifySignature(SECRET, body, 'h1=' + hmac(SECRET, body), NOW) === false, '1f a header with no timestamp is refused');
  ok(await P.verifySignature(SECRET, body, 'ts=' + (NOW + 5) + ';h1=' + hmac(SECRET, NOW + ':' + body), NOW) === false,
    '1g the signature covers the timestamp: a header carrying a different ts than the one signed is refused');
  ok(await P.verifySignature(SECRET, body, sign(SECRET, NOW - 301, body), NOW) === false && await P.verifySignature(SECRET, body, sign(SECRET, NOW + 301, body), NOW) === false,
    '1h a timestamp more than 300 seconds old or ahead is refused (a replay or a wrong clock)');
  ok(await P.verifySignature(SECRET, body, sign(SECRET, NOW - 300, body), NOW) === true && await P.verifySignature(SECRET, body, sign(SECRET, NOW + 300, body), NOW) === true,
    '1i exactly 300 seconds either way is inside the tolerance');
  const rotated = 'ts=' + NOW + ';h1=' + hmac(OTHER, NOW + ':' + body) + ';h1=' + hmac(SECRET, NOW + ':' + body);
  ok(await P.verifySignature(SECRET, body, rotated, NOW) === true, '1j while a secret is rotated Paddle sends two h1s: one valid h1 is enough');
  ok(await P.verifySignature('', body, sign('', NOW, body), NOW) === false && await P.verifySignature(undefined, body, hdr, NOW) === false,
    '1k an empty or missing secret verifies NOTHING, even a signature made with the empty secret (fails closed)');
  let refused = 0;
  for (const h of [null, undefined, '', 'abc', 'ts=;h1=', 'ts=' + NOW, 'h1=' + 'a'.repeat(64), 'ts=' + NOW + ';h1=zz', 'ts=abc;h1=' + 'a'.repeat(64), 5, {}, 'ts=' + NOW + ';h1=' + 'a'.repeat(64) + ';ts=' + NOW,
    'x'.repeat(700)]) if (await P.verifySignature(SECRET, body, h, NOW) === false) refused++;
  ok(refused === 13, '1l a missing, short, malformed, duplicated-ts, over-long or non-text header is refused (thirteen values)', refused);
  ok(await P.verifySignature(SECRET, 5, hdr, NOW) === false && await P.verifySignature(SECRET, body, hdr, NaN) === false, '1m a body that is not text, or no clock, is refused');
  ok(P.timingSafeEqual('abcdef', 'abcdef') === true && P.timingSafeEqual('abcdef', 'abcdeg') === false && P.timingSafeEqual('abcdef', 'abcde') === false, '1n timingSafeEqual: equal, differing, different lengths');
}

// ---- 2. the checkout binding ------------------------------------------------------------------------------------------------------------------
{
  const bind = await P.checkoutBinding(SECRET, BROKERAGE);
  ok(bind === hmac(SECRET, 'hs-billing-checkout|' + BROKERAGE), '2a the binding equals an independent HMAC of the fixed context and the brokerage id');
  ok(await P.verifyBinding(SECRET, BROKERAGE, bind) === true, '2b a genuine binding verifies');
  ok(await P.verifyBinding(SECRET, OTHER_BROKERAGE, bind) === false && await P.verifyBinding(OTHER, BROKERAGE, bind) === false, '2c a binding does not move to another brokerage or secret');
  ok(await P.verifyBinding(SECRET, BROKERAGE, 'a'.repeat(64)) === false && await P.verifyBinding(SECRET, 'nope', bind) === false && await P.verifyBinding('', BROKERAGE, bind) === false, '2d forged, malformed or unsecured bindings are refused');
  let threw = 0;
  for (const f of [() => P.checkoutBinding('', BROKERAGE), () => P.checkoutBinding(SECRET, 'not-a-uuid')]) { try { await f(); } catch { threw++; } }
  ok(threw === 2, '2e making a binding with no secret or no brokerage id throws');
}

// ---- 3. the translation ----------------------------------------------------------------------------------------------------------------------
const bound = await P.checkoutBinding(SECRET, BROKERAGE);
const CUSTOM = { brokerage_id: BROKERAGE, bind: bound };
const sub = (over = {}, dataOver = {}) => ({
  event_id: 'evt_01hv8x8d6dxy3k7h2m0aaaaaaa', event_type: 'subscription.created', occurred_at: '2026-11-14T10:00:00.123456Z', notification_id: 'ntf_1',
  data: { id: 'sub_01hv8x8d6dxy3k7h2m0bbbbbbb', status: 'active', customer_id: 'ctm_secret_customer', custom_data: CUSTOM,
          items: [{ status: 'active', quantity: 1, price: { id: PRO, product_id: 'pro_01m7d6ke8gd7beyc6p68kvhxy3', unit_price: { amount: '7800', currency_code: 'USD' } } }], ...dataOver },
  ...over,
});
const txn = (over = {}, dataOver = {}) => ({
  event_id: 'evt_01hv8x8d6dxy3k7h2m0ccccccc', event_type: 'transaction.completed', occurred_at: '2026-11-14T10:00:00Z',
  data: { id: 'txn_01hv8x8d6dxy3k7h2m0ddddddd', status: 'completed', subscription_id: null, customer_id: 'ctm_secret_customer', custom_data: CUSTOM,
          items: [{ price_id: PARTNER, quantity: 1, price: { id: PARTNER, product_id: 'pro_01m7d6q09cv0d8hmbbpjv1qraz' } }], ...dataOver },
  ...over,
});
const cfg = { secret: SECRET, prices: PRICES, livemode: true };
{
  const t = await P.translate(sub(), cfg);
  ok(t.kind === 'event' && t.offer === 'professional' && t.accessMonths === null && t.brokerageId === BROKERAGE, '3a a Professional subscription event is an event with NO fixed access length');
  ok(JSON.stringify(Object.keys(t.event).sort()) === JSON.stringify(['event_name','idempotency_key','livemode','occurred_at','processor','processor_status','product_ref','subscription_ref','variant_ref']),
    '3b the ledger event carries exactly its nine keys');
  ok(t.event.processor === 'paddle' && t.event.idempotency_key === 'evt_01hv8x8d6dxy3k7h2m0aaaaaaa' && t.event.event_name === 'subscription.created' && t.event.processor_status === 'active'
     && t.event.subscription_ref === 'sub_01hv8x8d6dxy3k7h2m0bbbbbbb' && t.event.variant_ref === PRO && t.event.product_ref === 'pro_01m7d6ke8gd7beyc6p68kvhxy3'
     && t.event.occurred_at === '2026-11-14T10:00:00.123456Z' && t.event.livemode === true,
    '3c every field comes from the right place: the key is Paddle\'s own event id, the status is the subscription\'s own, the price is the variant');
  ok(!JSON.stringify(t).includes('ctm_secret_customer') && !JSON.stringify(t).includes('7800'), '3d nothing personal and no price amount is carried across');
  const sandbox = await P.translate(sub(), { ...cfg, livemode: false });
  ok(sandbox.kind === 'event' && sandbox.event.livemode === false, '3e the environment comes from CONFIGURATION: a sandbox setting records livemode false');
  const statuses = [];
  for (const [ev, st] of [['subscription.activated', 'active'], ['subscription.updated', 'active'], ['subscription.past_due', 'past_due'], ['subscription.paused', 'paused'], ['subscription.resumed', 'active'], ['subscription.canceled', 'canceled']]) {
    const r = await P.translate(sub({ event_type: ev }, { status: st }), cfg); statuses.push(r.kind === 'event' && r.event.processor_status === st && r.event.event_name === ev);
  }
  ok(statuses.every(Boolean) && statuses.length === 6, '3f every lifecycle event is recorded with its own status word (Paddle spells it "canceled")');

  const one = await P.translate(txn(), cfg);
  ok(one.kind === 'event' && one.offer === 'partner' && one.accessMonths === 6, '3g the Private Partner payment is an event whose access length is SIX months, set by the price');
  ok(one.event.subscription_ref === 'txn_01hv8x8d6dxy3k7h2m0ddddddd' && one.event.processor_status === 'completed' && one.event.event_name === 'transaction.completed' && one.event.variant_ref === PARTNER,
    '3h the grant is bound to the transaction, with the ledger word "completed"');
  const sneaky = await P.translate(txn({}, { custom_data: { ...CUSTOM, access_months: 120 } }), cfg);
  ok(sneaky.kind === 'event' && sneaky.accessMonths === 6 && !JSON.stringify(sneaky.event).includes('120'), '3i a payload cannot choose the access length: custom data that says 120 months is ignored');
}
{
  const ign = async (p, c = cfg) => { const r = await P.translate(p, c); return r.kind === 'ignore' ? r.reason : r.kind + ':' + r.reason; };
  ok(await ign(sub({ event_type: 'subscription.imported' })) === 'event_type' && await ign(sub({ event_type: 'transaction.paid' })) === 'event_type' && await ign(sub({ event_type: 'adjustment.updated' })) === 'event_type',
    '3j an event type this build does not act on is ignored (acknowledged, recorded nowhere)');
  ok(await ign(sub({}, { custom_data: undefined })) === 'no_binding' && await ign(sub({}, { custom_data: { brokerage_id: BROKERAGE } })) === 'no_binding', '3k a payment with no signed brokerage id is ignored');
  ok(await ign(sub({}, { custom_data: { brokerage_id: OTHER_BROKERAGE, bind: bound } })) === 'bad_binding' && await ign(sub({}, { custom_data: { brokerage_id: BROKERAGE, bind: 'a'.repeat(64) } })) === 'bad_binding',
    '3l a forged binding (another brokerage with a genuine signature, or a made-up signature) is ignored');
  ok(await ign(sub({}, { items: [{ price: { id: STRANGER } }] })) === 'price' && await ign(sub({}, { items: [] })) === 'price' && await ign(sub({}, { items: undefined })) === 'price',
    '3m another product\'s price is ignored');
  ok(await ign(sub({}, { items: [{ price: { id: PARTNER } }] })) === 'offer_mismatch', '3n the one-time price arriving as a SUBSCRIPTION event is not ours to act on');
  ok(await ign(txn({}, { items: [{ price_id: PRO, price: { id: PRO } }] })) === 'offer_mismatch', '3o a one-time payment for the monthly price is not a grant');
  ok(await ign(txn({}, { subscription_id: 'sub_01hv8x8d6dxy3k7h2m0bbbbbbb' })) === 'subscription_transaction', '3p a transaction that belongs to a subscription (a renewal) is the subscription\'s own billing, not a grant');
  ok(await ign(sub(), { ...cfg, prices: { professional: '', partner: '' } }) === 'price' && await ign(txn(), { ...cfg, prices: { professional: PRO, partner: 'not-a-price' } }) === 'price',
    '3q a price that is not configured (or malformed) matches nothing: that offer is not sold');
  ok(await ign(sub({ event_id: undefined })) === 'invalid:event_id', '3r a missing event id is INVALID (loud), never guessed at');
  ok(await ign(sub({ occurred_at: '2026-11-14 10:00:00' })) === 'invalid:occurred_at' && await ign(sub({ occurred_at: 'nope' })) === 'invalid:occurred_at', '3s a time with no offset or no meaning is INVALID');
  ok(await ign(sub({}, { id: undefined })) === 'invalid:id' && await ign(sub({}, { status: 'ACTIVE' })) === 'invalid:status' && await ign(sub({}, { status: undefined })) === 'invalid:status', '3t a missing id or a malformed status is INVALID');
  ok(await ign(txn({}, { status: 'billed' })) === 'invalid:status' && await ign(txn({}, { status: 'paid' })) === 'invalid:status', '3u a one-time payment counts only when Paddle says completed');
  ok(await ign(null) === 'invalid:shape' && await ign([]) === 'invalid:shape' && await ign({ data: 5 }) === 'invalid:shape' && await ign({ event_type: 5, data: {} }) === 'invalid:event_type', '3v a body that is not an event envelope is INVALID');
}

// ---- 4. the checkout request -----------------------------------------------------------------------------------------------------------------
{
  const c = { apiKey: 'pdl_live_apikey_SECRET', prices: PRICES, secret: SECRET, environment: 'production', checkoutPageUrl: 'https://jodytracks.com/development-activity-reports.html#billing' };
  const r = await P.checkoutRequest(c, BROKERAGE, 'professional');
  const body = JSON.parse(r.init.body);
  ok(r.url === 'https://api.paddle.com/transactions' && r.init.method === 'POST', '4a the live request goes to api.paddle.com/transactions by POST');
  ok(JSON.stringify(body.items) === JSON.stringify([{ price_id: PRO, quantity: 1 }]) && body.collection_mode === 'automatic', '4b it names the offer\'s price and one unit');
  ok(JSON.stringify(body.custom_data) === JSON.stringify({ brokerage_id: BROKERAGE, bind: hmac(SECRET, 'hs-billing-checkout|' + BROKERAGE) }), '4c the brokerage id rides with its signature in the custom data');
  ok(body.checkout.url === c.checkoutPageUrl, '4d the checkout page is our own approved page');
  ok(r.init.headers.Authorization === 'Bearer pdl_live_apikey_SECRET' && Object.values(r.init.headers).filter((v) => String(v).includes('apikey_SECRET')).length === 1 && !r.init.body.includes('apikey_SECRET') && !r.url.includes('apikey_SECRET'),
    '4e the API key is in ONE header and nowhere else');
  const p = await P.checkoutRequest(c, BROKERAGE, 'partner');
  ok(JSON.parse(p.init.body).items[0].price_id === PARTNER && JSON.parse(p.init.body).items.length === 1, '4f the partner offer asks for the one-time price');
  const sb = await P.checkoutRequest({ ...c, environment: 'sandbox' }, BROKERAGE, 'professional');
  ok(sb.url === 'https://sandbox-api.paddle.com/transactions', '4g the sandbox environment uses the sandbox host');
  let threw = 0;
  for (const f of [() => P.checkoutRequest({ ...c, apiKey: '' }, BROKERAGE, 'professional'), () => P.checkoutRequest({ ...c, secret: '' }, BROKERAGE, 'professional'),
    () => P.checkoutRequest({ ...c, prices: { professional: PRO, partner: '' } }, BROKERAGE, 'partner'), () => P.checkoutRequest({ ...c, environment: 'staging' }, BROKERAGE, 'professional'),
    () => P.checkoutRequest(c, 'not-a-uuid', 'professional')]) { try { await f(); } catch { threw++; } }
  ok(threw === 5, '4h an unconfigured key, secret, price, environment or brokerage throws: nothing is sent');
}

// ---- 5. the checkout answer ----------------------------------------------------------------------------------------------------------------
{
  const own = ['jodytracks.com'];
  const url = (u) => P.checkoutUrlFrom({ data: { checkout: { url: u } } }, own);
  ok(url('https://jodytracks.com/development-activity-reports.html?_ptxn=txn_1#billing') === 'https://jodytracks.com/development-activity-reports.html?_ptxn=txn_1#billing', '5a an https address on our own page is handed back');
  ok(url('https://buy.paddle.com/checkout?x=1') !== null && url('https://sandbox-buy.paddle.com/x') !== null && url('https://pay.paddle.io/hsc_1') !== null, '5b Paddle\'s own domains are accepted');
  let refused = 0;
  for (const u of ['http://jodytracks.com/x', 'https://evil.example.com/x', 'https://jodytracks.com.evil.com/x', 'https://notpaddle.com/x', 'https://user:pw@jodytracks.com/x', 'javascript:alert(1)', 'not a url', 'https://paddle.com.evil.com/', '', 5, 'https://jodytracks.com/' + 'a'.repeat(2000)])
    if (url(u) === null) refused++;
  ok(refused === 11, '5c an http, look-alike, credentialed, malformed or over-long address is never handed to a browser (eleven values)', refused);
  ok(P.checkoutUrlFrom(null, own) === null && P.checkoutUrlFrom({}, own) === null && P.checkoutUrlFrom({ data: {} }, own) === null && P.checkoutUrlFrom({ data: { checkout: {} } }, own) === null, '5d an answer without a checkout address is refused');
}

console.log('\n' + (n - bad) + '/' + n + ' passed');
process.exit(bad ? 1 : 0);
