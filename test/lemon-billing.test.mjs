// THE PROCESSOR'S SHAPES, in the one place this repo knows them (Development Activity build step 11) — offline.
//   supabase/functions/_shared/lemon-billing.ts
//
//   1. the signature: HMAC-SHA256 of the RAW body, in hex, checked in constant time, and an empty secret verifies NOTHING;
//   2. the checkout binding: a brokerage id is bound to a checkout only by a signature this server made, so a public buy link cannot name one;
//   3. the translation: a verified body becomes the ONE event the payment ledger accepts (exactly its nine keys), a test payment is
//      livemode false, an event that is not ours is IGNORED and one that should be ours and is not shaped as expected is INVALID, and nothing
//      personal is carried across;
//   4. the checkout request: every byte of it, with the API key in one header only;
//   5. the checkout answer: an https address on the processor's own domain, and nothing else is ever handed to a browser.
//
// WHAT THIS DOES NOT PROVE. The field names below were recalled from the processor's documented shapes and not read from a captured payload (the
// build sandbox cannot reach the processor's documentation). Every expected answer here is a hard-coded constant or an independent computation
// (node:crypto), never the code under test. The founder's one TEST payment is what confirms the real shape; docs/development-activity-billing-2026-10-04.md
// says exactly what to check.
// Run: node test/lemon-billing.test.mjs
import { createHmac } from 'node:crypto';

const L = await import('../supabase/functions/_shared/lemon-billing.ts');

let n = 0, bad = 0;
const ok = (c, m, d) => { n++; if (c) console.log('PASS — ' + m); else { bad++; console.log('FAIL — ' + m + (d !== undefined ? '  [' + JSON.stringify(d) + ']' : '')); } };
const hmac = (secret, msg) => createHmac('sha256', secret).update(msg).digest('hex');

const SECRET = 'whsec_test_0123456789abcdef';
const OTHER = 'whsec_other_fedcba9876543210';
const BROKERAGE = 'b0b0b0b0-1111-4222-8333-444444444444';
const OTHER_BROKERAGE = 'c0c0c0c0-1111-4222-8333-444444444444';
const VARIANT = '123456';

// ---- 1. the signature ------------------------------------------------------------------------------------------------------------------------
{
  const body = '{"meta":{"event_name":"subscription_created"},"data":{"id":"1"}}';
  const sig = hmac(SECRET, body);
  ok(await L.hmacHex(SECRET, body) === sig, '1a hmacHex equals an INDEPENDENT HMAC-SHA256 (node:crypto) of the same bytes');
  ok(await L.verifySignature(SECRET, body, sig) === true, '1b the right signature over the raw body verifies');
  ok(await L.verifySignature(SECRET, body, sig.toUpperCase()) === true && await L.verifySignature(SECRET, body, '  ' + sig + ' ') === true,
    '1c a signature in upper case or with surrounding spaces verifies (hex is case-blind, a header may be padded)');
  ok(await L.verifySignature(OTHER, body, sig) === false, '1d a signature made under another secret is refused');
  ok(await L.verifySignature(SECRET, body + ' ', sig) === false && await L.verifySignature(SECRET, body.replace('1', '2'), sig) === false,
    '1e a body changed by one byte is refused (a trailing space, a changed value)');
  const pretty = JSON.stringify(JSON.parse(body), null, 2);
  ok(await L.verifySignature(SECRET, pretty, sig) === false, '1f the RAW text is what is signed: the same JSON re-serialised with other whitespace is refused');
  ok(await L.verifySignature('', body, hmac('', body)) === false && await L.verifySignature(undefined, body, sig) === false,
    '1g an empty or missing secret verifies NOTHING, even a signature made with the empty secret (fails closed)');
  let refused = 0;
  for (const h of [null, undefined, '', 'abc', sig.slice(1), sig + '0', 'z'.repeat(64), 5, {}]) if (await L.verifySignature(SECRET, body, h) === false) refused++;
  ok(refused === 9, '1h a missing, short, long, non-hex or non-text header is refused (nine values)', refused);
  ok(await L.verifySignature(SECRET, 5, sig) === false && await L.verifySignature(SECRET, null, sig) === false, '1i a body that is not text is refused');
  ok(L.timingSafeEqual('abcdef', 'abcdef') === true && L.timingSafeEqual('abcdef', 'abcdeg') === false && L.timingSafeEqual('abcdef', 'abcde') === false && L.timingSafeEqual('abcde', 'abcdef') === false
     && L.timingSafeEqual('', '') === true && L.timingSafeEqual(1, 1) === false && L.timingSafeEqual('a', null) === false,
    '1j the comparison is exact: equal, one differing character, a different length, and non-text are each answered correctly');
  const unicode = '{"meta":{"x":"é中😀"}}';
  ok(await L.verifySignature(SECRET, unicode, hmac(SECRET, unicode)) === true, '1k a body with non-ASCII characters is hashed as UTF-8, the same as the processor signs it');
}

// ---- 2. the checkout binding -----------------------------------------------------------------------------------------------------------------
{
  const bind = await L.checkoutBinding(SECRET, BROKERAGE);
  ok(bind === hmac(SECRET, 'hs-billing-checkout|' + BROKERAGE) && /^[0-9a-f]{64}$/.test(bind), '2a the binding is an INDEPENDENT HMAC of a fixed context and the brokerage id');
  ok(bind !== hmac(SECRET, BROKERAGE), '2b the context separates it from a bare signature of the id (a signature made for any other purpose never binds a brokerage)');
  ok(bind !== await L.checkoutBinding(SECRET, OTHER_BROKERAGE) && bind !== await L.checkoutBinding(OTHER, BROKERAGE), '2c it differs for another brokerage and under another secret');
  ok(await L.verifyBinding(SECRET, BROKERAGE, bind) === true, '2d the right binding verifies');
  ok(await L.verifyBinding(SECRET, OTHER_BROKERAGE, bind) === false, '2e a binding made for one brokerage does not verify for another (a public buy link cannot name a different one)');
  ok(await L.verifyBinding(OTHER, BROKERAGE, bind) === false && await L.verifyBinding('', BROKERAGE, bind) === false, '2f a binding does not verify under another or an empty secret');
  let refused = 0;
  for (const [id, b] of [[BROKERAGE, ''], [BROKERAGE, 'short'], [BROKERAGE, bind + '0'], [BROKERAGE, 5], [5, bind], [null, bind], ['not-a-uuid', bind], [BROKERAGE.toUpperCase(), bind]]) {
    if (await L.verifyBinding(SECRET, id, b) === false) refused++;
  }
  ok(refused === 8, '2g a missing, malformed, wrong-type or upper-case id or binding is refused (eight values)', refused);
  let threw = 0;
  for (const [s, id] of [['', BROKERAGE], [SECRET, 'x'], [SECRET, BROKERAGE.toUpperCase()], [SECRET, 5]]) { try { await L.checkoutBinding(s, id); } catch { threw++; } }
  ok(threw === 4, '2h a binding is made only for a well-formed brokerage id under a real secret', threw);
}

// ---- 3. the translation ----------------------------------------------------------------------------------------------------------------------
const CFG = { secret: SECRET, variantId: VARIANT };
async function payload(over = {}) {
  const bind = await L.checkoutBinding(SECRET, BROKERAGE);
  const p = {
    meta: { event_name: 'subscription_created', test_mode: false, webhook_id: 'wh-1', custom_data: { brokerage_id: BROKERAGE, bind } },
    data: {
      type: 'subscriptions', id: '987654',
      attributes: {
        store_id: 1, customer_id: 555, order_id: 777, order_item_id: 888, product_id: 4242, variant_id: 123456, product_name: 'Reports', variant_name: 'Monthly',
        user_name: 'Pat Payer', user_email: 'pat.payer@example.test', status: 'active', status_formatted: 'Active', card_brand: 'visa', card_last_four: '4242',
        pause: null, cancelled: false, trial_ends_at: null, billing_anchor: 4, renews_at: '2026-11-04T12:00:00.000000Z', ends_at: null,
        created_at: '2026-10-04T12:00:00.000000Z', updated_at: '2026-10-04T12:00:05.000000Z', test_mode: false,
      },
    },
  };
  return over.mutate ? over.mutate(p) ?? p : p;
}
const tr = async (mutate, cfg = CFG) => L.translate(await payload({ mutate }), cfg);
{
  const t = await tr();
  const E = { processor: 'lemonsqueezy', idempotency_key: 'subscription_created:987654:2026-10-04T12:00:05.000000Z', subscription_ref: '987654',
    event_name: 'subscription_created', processor_status: 'active', occurred_at: '2026-10-04T12:00:05.000000Z', product_ref: '4242', variant_ref: '123456', livemode: true };
  ok(t.kind === 'event' && t.brokerageId === BROKERAGE && JSON.stringify(t.event) === JSON.stringify(E), '3a a live subscription_created for our variant is the ledger event, key for key', t);
  const LEDGER_KEYS = ['processor', 'idempotency_key', 'subscription_ref', 'event_name', 'processor_status', 'occurred_at', 'product_ref', 'variant_ref', 'livemode'];
  ok(Object.keys(t.event).every((k) => LEDGER_KEYS.includes(k)), '3b the event carries no key the ledger\'s nine-key allow-list does not name');
  const LEAK = /pat\.payer|Pat Payer|customer_id|order_id|store_id|user_email|user_name|card_brand|card_last_four|visa/i;
  ok(LEAK.test(JSON.stringify(await payload())), '3c0 (control) the payload the processor sends DOES hold a name, an email, a customer, an order, a store and a card');
  ok(!LEAK.test(JSON.stringify(t)) && !/555|777|888|4321/.test(JSON.stringify(t)),
    '3c nothing personal or commercial is carried across: no name, email, customer, order, store or card, though the payload held all of them');
  const t2 = await tr((p) => { p.meta.test_mode = true; });
  ok(t2.kind === 'event' && t2.event.livemode === false, '3d a TEST payment (meta.test_mode true) is livemode false: it can never be taken for a live one');
  const t3 = await tr((p) => { delete p.meta.test_mode; p.data.attributes.test_mode = true; });
  ok(t3.kind === 'event' && t3.event.livemode === false, '3e the subscription\'s own test_mode is read when the meta has none');
  const t4 = await tr((p) => { p.meta.test_mode = false; p.data.attributes.test_mode = true; });
  ok(t4.kind === 'event' && t4.event.livemode === true, '3f the meta\'s test_mode wins when both are present');
  const t5 = await tr((p) => { delete p.meta.test_mode; delete p.data.attributes.test_mode; });
  ok(t5.kind === 'invalid' && t5.reason === 'test_mode', '3g a body that does not say whether it is a test is INVALID, never guessed live');
  const t6 = await tr((p) => { p.meta.test_mode = 'false'; delete p.data.attributes.test_mode; });
  ok(t6.kind === 'invalid' && t6.reason === 'test_mode', '3h test_mode as text is not a boolean: INVALID, never guessed');
}
{
  // which events are ours
  const names = ['subscription_created', 'subscription_updated', 'subscription_cancelled', 'subscription_resumed', 'subscription_expired', 'subscription_paused', 'subscription_unpaused'];
  let all = 0;
  for (const name of names) { const t = await tr((p) => { p.meta.event_name = name; }); if (t.kind === 'event' && t.event.event_name === name) all++; }
  ok(all === 7 && JSON.stringify(L.SUBSCRIPTION_EVENTS) === JSON.stringify(names), '3i each of the seven subscription lifecycle events is recorded, and no other is listed');
  let ignored = 0;
  for (const name of ['order_created', 'order_refunded', 'subscription_payment_success', 'subscription_payment_failed', 'subscription_payment_recovered', 'license_key_created', 'affiliate_activated', 'x']) {
    const t = await tr((p) => { p.meta.event_name = name; });
    if (t.kind === 'ignore' && t.reason === 'event_name') ignored++;
  }
  ok(ignored === 8, '3j order, invoice, licence and unknown events are acknowledged and recorded nowhere (the plan follows the subscription\'s own status)', ignored);
  let invalid = 0;
  for (const name of [undefined, null, 5, '', 'Subscription_Created', 'subscription created', 'a'.repeat(65)]) {
    const t = await tr((p) => { p.meta.event_name = name; });
    if (t.kind === 'invalid' && t.reason === 'event_name') invalid++;
  }
  ok(invalid === 7, '3k a missing or malformed event name is INVALID (seven values)', invalid);
  const t = await tr((p) => { p.data.type = 'orders'; });
  ok(t.kind === 'ignore' && t.reason === 'type', '3l a payload whose data is not a subscription is ignored');
  let shape = 0;
  for (const bad of [null, 5, 'x', [], {}, { meta: {} }, { data: {} }, { meta: [], data: {} }, { meta: {}, data: [] }]) {
    const r = await L.translate(bad, CFG);
    if (r.kind === 'invalid' && r.reason === 'shape') shape++;
  }
  ok(shape === 9, '3m a body that is not an object with meta and data is INVALID (nine values)', shape);
}
{
  // whose it is: the checkout's own signed custom data
  let t = await tr((p) => { delete p.meta.custom_data; });
  ok(t.kind === 'ignore' && t.reason === 'no_binding', '3n a subscription with no custom data is not ours: ignored (it may belong to the user-scoped webhook)');
  t = await tr((p) => { p.meta.custom_data = { user_id: 'a1111111-1111-4111-8111-111111111111' }; });
  ok(t.kind === 'ignore' && t.reason === 'no_binding', '3o a subscription carrying only a user id (the map product\'s) is ignored here');
  t = await tr((p) => { p.meta.custom_data = { brokerage_id: BROKERAGE }; });
  ok(t.kind === 'ignore' && t.reason === 'no_binding', '3p a brokerage id with no signature is ignored: a public buy link can carry any custom data');
  t = await tr((p) => { p.meta.custom_data.brokerage_id = OTHER_BROKERAGE; });
  ok(t.kind === 'ignore' && t.reason === 'bad_binding', '3q a signature made for one brokerage on another\'s id is ignored (it cannot be moved to a different account)');
  t = await tr((p) => { p.meta.custom_data.bind = 'f'.repeat(64); });
  ok(t.kind === 'ignore' && t.reason === 'bad_binding', '3r a forged signature is ignored');
  t = await tr(() => {}, { secret: OTHER, variantId: VARIANT });
  ok(t.kind === 'ignore' && t.reason === 'bad_binding', '3s a signature made under another secret is ignored');
  t = await tr((p) => { p.meta.custom_data = 'x'; });
  ok(t.kind === 'ignore' && t.reason === 'no_binding', '3t custom data that is not an object is ignored');
}
{
  // our variant, and the shape of what we record
  let t = await tr((p) => { p.data.attributes.variant_id = 999999; });
  ok(t.kind === 'ignore' && t.reason === 'variant', '3u another product\'s variant is ignored: it is not the $79 plan');
  t = await tr(() => {}, { secret: SECRET, variantId: '' });
  ok(t.kind === 'ignore' && t.reason === 'variant', '3v with no variant configured nothing matches: every event is ignored (fails closed)');
  t = await tr((p) => { p.data.attributes.variant_id = '123456'; });
  ok(t.kind === 'event' && t.event.variant_ref === '123456', '3w a variant id given as text matches the same as a number');
  let invalid = 0;
  const cases = [
    [(p) => { delete p.data.attributes; }, 'attributes'], [(p) => { p.data.attributes = []; }, 'attributes'],
    [(p) => { delete p.data.attributes.variant_id; }, 'variant_id'], [(p) => { p.data.attributes.variant_id = 'a b'; }, 'variant_id'], [(p) => { p.data.attributes.variant_id = -1; }, 'variant_id'],
    [(p) => { delete p.data.id; }, 'id'], [(p) => { p.data.id = 'has space'; }, 'id'], [(p) => { p.data.id = ''; }, 'id'], [(p) => { p.data.id = 'x'.repeat(65); }, 'id'],
    [(p) => { delete p.data.attributes.status; }, 'status'], [(p) => { p.data.attributes.status = 'Active'; }, 'status'], [(p) => { p.data.attributes.status = 5; }, 'status'],
    [(p) => { delete p.data.attributes.updated_at; }, 'updated_at'], [(p) => { p.data.attributes.updated_at = '2026-10-04T12:00:05'; }, 'updated_at'], [(p) => { p.data.attributes.updated_at = '2026-10-04'; }, 'updated_at'],
    [(p) => { p.data.attributes.updated_at = '2026-13-45T99:99:99Z'; }, 'updated_at'],
    [(p) => { p.data.attributes.product_id = 'a b'; }, 'product_id'],
  ];
  for (const [mut, why] of cases) { const r = await tr(mut); if (r.kind === 'invalid' && r.reason === why) invalid++; else console.log('   (case ' + why + ' gave ' + JSON.stringify(r) + ')'); }
  ok(invalid === cases.length, '3x each malformed field of a subscription that should be ours is INVALID, with its own reason (' + cases.length + ' cases)', invalid);
  t = await tr((p) => { delete p.data.attributes.product_id; });
  ok(t.kind === 'event' && !('product_ref' in t.event), '3y a payload with no product id records no product_ref (an absent field stays absent)');
  t = await tr((p) => { p.data.attributes.updated_at = '2026-10-04T07:00:05-05:00'; });
  ok(t.kind === 'event' && t.event.occurred_at === '2026-10-04T07:00:05-05:00', '3z a time with a UTC offset (not Z) is kept as given: the ledger parses the offset');
}
{
  // the idempotency key
  const a = await tr(() => {}), b = await tr(() => {});
  const c = await tr((p) => { p.data.attributes.updated_at = '2026-10-04T12:05:00.000000Z'; });
  const d = await tr((p) => { p.meta.event_name = 'subscription_updated'; });
  const e = await tr((p) => { p.data.id = '987655'; });
  ok(a.event.idempotency_key === b.event.idempotency_key, '3aa a retried delivery carries the SAME key (it is recorded once)');
  ok(new Set([a, c, d, e].map((x) => x.event.idempotency_key)).size === 4, '3ab a later change, another event name or another subscription each carry a NEW key');
  ok(a.event.idempotency_key.length <= 200 && /^[a-z_]+:[A-Za-z0-9_-]+:[0-9T:.+\-Z]+$/.test(a.event.idempotency_key), '3ac the key is readable text of bounded length');
}

// ---- 4. the checkout request -----------------------------------------------------------------------------------------------------------------
const CK = { apiKey: 'lsk_secret_api_key_value', storeId: '4321', variantId: VARIANT, secret: SECRET, testMode: false, redirectUrl: 'https://homesignal.net/development-activity-reports.html#billing' };
const NOW = new Date('2026-10-04T12:00:00.000Z');
{
  const r = await L.checkoutRequest(CK, BROKERAGE, NOW);
  ok(r.url === 'https://api.lemonsqueezy.com/v1/checkouts' && r.init.method === 'POST' && L.CHECKOUT_ENDPOINT === r.url, '4a one POST to the processor\'s checkout endpoint');
  ok(r.init.headers.Authorization === 'Bearer ' + CK.apiKey && r.init.headers.Accept === 'application/vnd.api+json' && r.init.headers['Content-Type'] === 'application/vnd.api+json'
     && Object.keys(r.init.headers).length === 3, '4b the API key is in the Authorization header and nowhere else; the content type is JSON:API');
  const body = JSON.parse(r.init.body);
  ok(body.data.type === 'checkouts' && JSON.stringify(Object.keys(body.data.attributes).sort()) === JSON.stringify(['checkout_data', 'expires_at', 'product_options']),
    '4c the body asks for a checkout with exactly: its data, an expiry and its product options (no test flag in live mode)', Object.keys(body.data.attributes));
  ok(JSON.stringify(body.data.attributes.checkout_data) === JSON.stringify({ custom: { brokerage_id: BROKERAGE, bind: hmac(SECRET, 'hs-billing-checkout|' + BROKERAGE) } }),
    '4d the checkout carries the brokerage id and its signature in its custom data, and NOTHING else (no email, no name, no amount)');
  ok(body.data.attributes.product_options.redirect_url === CK.redirectUrl && JSON.stringify(Object.keys(body.data.attributes.product_options)) === '["redirect_url"]',
    '4e the success address only brings the person back: it is the only product option, and the page re-reads the plan');
  ok(body.data.attributes.expires_at === '2026-10-04T13:00:00.000Z', '4f the checkout lasts one hour from the clock it was given');
  ok(JSON.stringify(body.data.relationships) === JSON.stringify({ store: { data: { type: 'stores', id: '4321' } }, variant: { data: { type: 'variants', id: VARIANT } } }),
    '4g the store and the variant are named by their configured ids');
  ok(!r.init.body.includes(CK.apiKey) && !r.init.body.includes(SECRET), '4h neither the API key nor the signing secret is in the body');
  const t = JSON.parse((await L.checkoutRequest({ ...CK, testMode: true }, BROKERAGE, NOW)).init.body);
  ok(t.data.attributes.test_mode === true, '4i test mode asks for a TEST checkout');
  let threw = 0;
  for (const cfg of [{ ...CK, apiKey: '' }, { ...CK, storeId: '' }, { ...CK, variantId: '' }, { ...CK, secret: '' }, { ...CK, storeId: 'abc' }, { ...CK, variantId: '12 3' }, { ...CK, storeId: '1'.repeat(21) }]) {
    try { await L.checkoutRequest(cfg, BROKERAGE, NOW); } catch { threw++; }
  }
  try { await L.checkoutRequest(CK, 'not-a-uuid', NOW); } catch { threw++; }
  ok(threw === 8, '4j an incomplete or malformed configuration, or a brokerage id that is not one, never produces a request (eight cases)', threw);
}

// ---- 5. the checkout answer ------------------------------------------------------------------------------------------------------------------
{
  const res = (url) => ({ data: { type: 'checkouts', id: 'x', attributes: { url } } });
  ok(L.checkoutUrlFrom(res('https://homesignal.lemonsqueezy.com/checkout/custom/abc-123?signature=aa')) === 'https://homesignal.lemonsqueezy.com/checkout/custom/abc-123?signature=aa',
    '5a an https checkout address on a lemonsqueezy.com subdomain is returned');
  ok(L.checkoutUrlFrom(res('https://lemonsqueezy.com/checkout/x')) === 'https://lemonsqueezy.com/checkout/x', '5b the bare domain is accepted too');
  let refused = 0;
  for (const u of ['http://homesignal.lemonsqueezy.com/x', 'https://evil.example/x', 'https://lemonsqueezy.com.evil.example/x', 'https://notlemonsqueezy.com/x', 'https://evil-lemonsqueezy.com/x',
    'https://user:pw@homesignal.lemonsqueezy.com/x', 'https://user@homesignal.lemonsqueezy.com/x', 'javascript:alert(1)', 'data:text/html,x', '//homesignal.lemonsqueezy.com/x', 'not a url', '',
    'https://homesignal.lemonsqueezy.com/' + 'a'.repeat(2000)]) {
    if (L.checkoutUrlFrom(res(u)) === null) refused++;
  }
  ok(refused === 13, '5c an http address, another host (including look-alikes), credentials in the address, a script, or an over-long address is never handed on (thirteen values)', refused);
  let shape = 0;
  for (const r of [null, 5, 'x', [], {}, { data: null }, { data: {} }, { data: { attributes: null } }, { data: { attributes: {} } }, { data: { attributes: { url: 5 } } }]) if (L.checkoutUrlFrom(r) === null) shape++;
  ok(shape === 10, '5d an answer without a text address in the expected place is null (ten shapes)', shape);
}

console.log('\n' + (n - bad) + ' passed, ' + bad + ' failed of ' + n);
process.exit(bad ? 1 : 0);
