// THE PADDLE PATH THROUGH THE REAL HANDLERS (offline): development-activity-paddle-webhook and manage-billing's paddle_checkout.
//   webhook: signature on the RAW body, environment separation (a Sandbox delivery is test-mode and never live), unconfigured = refuse everything, duplicate / ignore / refund routing,
//            every database refusal mapped, nothing echoed.
//   checkout: sign-in required, the account is the one the DATABASE names (never the request), owner-only, one slot, kill switches, the answer carries no account id or price.
// WHAT THIS DOES NOT PROVE: real Paddle deliveries (docs/paddle-billing-2026-11-14.md lists what the first Sandbox payments must confirm) and the database's own behaviour
// (test/paddle_billing_pg runs the real SQL).  Run: node test/paddle-functions.test.mjs
import { createHmac } from 'node:crypto';
const P = await import('../supabase/functions/_shared/paddle-billing.ts');
const B = await import('../supabase/functions/_shared/billing-reads.ts');
const Svc = await import('../supabase/functions/_shared/service-rest.ts');
const WH = await import('../supabase/functions/development-activity-paddle-webhook/handler.ts');
const WD = await import('../supabase/functions/development-activity-paddle-webhook/data.ts');
const MH = await import('../supabase/functions/manage-billing/handler.ts');
const MD = await import('../supabase/functions/manage-billing/data.ts');

let n = 0, bad = 0;
const ok = (c, m, d) => { n++; if (c) console.log('PASS — ' + m); else { bad++; console.log('FAIL — ' + m + (d !== undefined ? '  [' + JSON.stringify(d) + ']' : '')); } };
const hmac = (secret, msg) => createHmac('sha256', secret).update(msg).digest('hex');

const LIVE = 'pdl_ntfset_live_0123456789', SBX = 'pdl_ntfset_sandbox_9876543210';
const BK = 'b0b0b0b0-1111-4222-8333-444444444444', UID = 'a1111111-1111-4111-8111-111111111111';
const PRICE_L = 'pri_01m7d6kede6hqr2kh9b78mb25j', PRICE_S = 'pri_01sandboxprice0000000000000';
const NOW = 1_800_000_000;
const sig = (secret, body, ts = NOW) => `ts=${ts};h1=${hmac(secret, ts + ':' + body)}`;

// ---- the webhook ---------------------------------------------------------------------------------------------------------------------------
const applied = [], lookups = [];
function wdeps(over = {}) {
  return {
    live: over.live ?? { secret: LIVE, priceId: PRICE_L }, sandbox: over.sandbox ?? { secret: SBX, priceId: PRICE_S },
    applyEvent: over.applyEvent ?? (async (b, e) => { applied.push([b, e]); return { outcome: 'RECORDED', bound: true, state: 'paid', is_latest: true }; }),
    bindingOf: over.bindingOf ?? (async (p, l, s) => { lookups.push([p, l, s]); return BK; }),
    nowSeconds: () => NOW,
  };
}
async function bodyFor(secretForBind, priceId, over = {}, data = {}) {
  const bind = await P.paddleBinding(secretForBind, BK);
  return JSON.stringify({ event_id: 'evt_01hv8x9y0z1a2b3c4d5e6f7g8h', event_type: 'subscription.created', occurred_at: '2026-11-14T15:00:00Z',
    data: { id: 'sub_01hv8x9y0z1a2b3c4d5e6f7g8h', status: 'active', custom_data: { brokerage_id: BK, bind }, items: [{ price: { id: priceId, product_id: 'pro_1' } }], ...data }, ...over }, null, 2);
}
async function hook(d, body, header, { method = 'POST' } = {}) {
  applied.length = 0; lookups.length = 0;
  const headers = { 'content-type': 'application/json' };
  if (header !== undefined && header !== null) headers['paddle-signature'] = header;
  const res = await WH.makeHandler(d)(new Request('https://x/functions/v1/development-activity-paddle-webhook', { method, headers, ...(method === 'POST' ? { body } : {}) }));
  const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch { /* */ }
  return { status: res.status, json, text };
}
{
  const live = await bodyFor(LIVE, PRICE_L);
  let r = await hook(wdeps(), live, sig(LIVE, live));
  ok(r.status === 200 && r.json.outcome === 'RECORDED' && applied.length === 1 && applied[0][0] === BK && applied[0][1].livemode === true && applied[0][1].processor === 'paddle', '1a a live delivery is recorded for the brokerage its checkout named, livemode TRUE', r);
  r = await hook(wdeps(), live, sig(LIVE, live + ' '));
  ok(r.status === 401 && applied.length === 0, '1b a signature that does not cover the exact raw bytes is 401 and records nothing');
  r = await hook(wdeps(), live, undefined);
  ok(r.status === 401 && applied.length === 0, '1c no Paddle-Signature header is 401');
  r = await hook(wdeps(), live, sig(LIVE, live, NOW - 4000));
  ok(r.status === 401 && applied.length === 0, '1d an old timestamp is 401');
  const sbx = await bodyFor(SBX, PRICE_S);
  r = await hook(wdeps(), sbx, sig(SBX, sbx));
  ok(r.status === 200 && applied.length === 1 && applied[0][1].livemode === false && applied[0][1].variant_ref === PRICE_S, '1e a SANDBOX delivery is recorded as test-mode (livemode FALSE): it can never make a brokerage paid', applied);
  // the same body signed with the sandbox secret but carrying a LIVE-bound custom_data must not be taken as live
  const cross = await bodyFor(LIVE, PRICE_L);
  r = await hook(wdeps(), cross, sig(SBX, cross));
  ok(r.status === 200 && r.json.status === 'IGNORED' && applied.length === 0, '1f a binding made with the LIVE secret inside a Sandbox-signed delivery is ignored (the binding must verify under the secret that verified the delivery)', r);
  r = await hook(wdeps({ live: { secret: '', priceId: '' } }), live, sig(LIVE, live));
  ok(r.status === 401 && applied.length === 0, '1g live not configured: a live-signed delivery is refused');
  r = await hook(wdeps({ live: { secret: '', priceId: '' }, sandbox: { secret: '', priceId: '' } }), live, sig(LIVE, live));
  ok(r.status === 503 && r.json.error === 'not_set_up', '1h nothing configured: every request is 503, a missing secret never reads as no signature needed');
  r = await hook(wdeps({ sandbox: { secret: SBX, priceId: '' } }), sbx, sig(SBX, sbx));
  ok(r.status === 401, '1i an environment with a secret but no price is not accepted');
  r = await hook(wdeps(), null, null, { method: 'GET' });
  ok(r.status === 200 && r.json.configured === true && JSON.stringify(r.json).indexOf(LIVE) < 0, '1j GET describes the function and leaks nothing');
  const big = 'x'.repeat(300_000);
  r = await hook(wdeps(), big, sig(LIVE, big));
  ok(r.status === 413, '1k an oversize body is 413');
  const junk = 'not json at all';
  r = await hook(wdeps(), junk, sig(LIVE, junk));
  ok(r.status === 422 && r.json.reason === 'json', '1l a verified body that is not JSON is 422');
  // ignored kinds
  const other = await bodyFor(LIVE, 'pri_01m7d6kex4tsqv4gvjbtze9nbt');
  r = await hook(wdeps(), other, sig(LIVE, other));
  ok(r.status === 200 && r.json.reason === 'price' && applied.length === 0, '1m another price is acknowledged and recorded nowhere');
  const tx = await bodyFor(LIVE, PRICE_L, { event_type: 'transaction.completed' });
  r = await hook(wdeps(), tx, sig(LIVE, tx));
  ok(r.status === 200 && r.json.status === 'IGNORED' && applied.length === 0, '1n a non-subscription event is acknowledged and ignored');
  // duplicate
  r = await hook(wdeps({ applyEvent: async () => ({ outcome: 'DUPLICATE', bound: false, state: 'paid', is_latest: true }) }), live, sig(LIVE, live));
  ok(r.status === 200 && r.json.outcome === 'DUPLICATE', '1o a retried delivery is acknowledged DUPLICATE (200, so Paddle stops retrying)');
  // refunds
  const refund = JSON.stringify({ event_id: 'evt_01hv8adjadjadjadjadjadjadj', event_type: 'adjustment.updated', occurred_at: '2026-11-20T10:00:00Z',
    data: { id: 'adj_1', action: 'refund', type: 'full', status: 'approved', transaction_id: 'txn_1', subscription_id: 'sub_01hv8x9y0z1a2b3c4d5e6f7g8h' } });
  r = await hook(wdeps(), refund, sig(LIVE, refund));
  ok(r.status === 200 && lookups.length === 1 && lookups[0][1] === true && applied.length === 1 && applied[0][0] === BK && applied[0][1].processor_status === 'refunded' && applied[0][1].livemode === true,
    '1p a refund is recorded for the brokerage its subscription is ALREADY bound to (looked up by processor, livemode and subscription id), as `refunded`', { lookups, applied });
  r = await hook(wdeps({ bindingOf: async () => null }), refund, sig(LIVE, refund));
  ok(r.status === 200 && r.json.reason === 'unbound_subscription' && applied.length === 0, '1q a refund for a subscription that is bound to nobody is acknowledged and recorded nowhere');
  r = await hook(wdeps(), refund, sig(SBX, refund));
  ok(lookups.length === 1 && lookups[0][1] === false, '1r a Sandbox refund is looked up in the TEST bindings only (livemode false)');
  // errors
  const err = (e) => wdeps({ applyEvent: async () => { throw e; } });
  r = await hook(err(new B.BindingConflict('x')), live, sig(LIVE, live)); ok(r.status === 409 && r.json.error === 'binding_conflict', '1s a subscription bound to another brokerage is 409');
  r = await hook(err(new B.BrokerageUnknown('x')), live, sig(LIVE, live)); ok(r.status === 422 && r.json.reason === 'brokerage_unknown', '1t a signed id that is no brokerage is 422');
  r = await hook(err(new B.EventRefused('x')), live, sig(LIVE, live)); ok(r.status === 422 && r.json.reason === 'event_refused', '1u an event the ledger refuses is 422');
  r = await hook(err(new Svc.DataUnavailable('x')), live, sig(LIVE, live)); ok(r.status === 503, '1v a database that cannot be reached is 503 so Paddle retries');
  r = await hook(err(new Error('boom ' + BK + ' ' + LIVE)), live, sig(LIVE, live)); ok(r.status === 500 && !r.text.includes(BK) && !r.text.includes(LIVE) && !r.text.includes('boom'), '1w any other failure is 500 and says nothing about why');
  r = await hook(wdeps({ bindingOf: async () => { throw new Svc.DataUnavailable('x'); } }), refund, sig(LIVE, refund));
  ok(r.status === 503, '1x a failed binding lookup is 503 (retried), never "ignored"');
  const sub = await bodyFor(LIVE, PRICE_L, { event_type: 'subscription.canceled' }, { status: 'canceled' });
  r = await hook(wdeps(), sub, sig(LIVE, sub));
  ok(applied[0][1].processor_status === 'canceled' && applied[0][1].event_name === 'subscription.canceled', '1y a cancellation is recorded as `canceled`');
  ok(r.text.indexOf(BK) < 0 && r.text.indexOf('sub_') < 0, '1z no answer carries an account or subscription id');
}
// ---- the real data layer of the webhook --------------------------------------------------------------------------------------------------------
{
  const reqs = [];
  const f = (routes) => async (url, init) => { reqs.push({ url: String(url), init: init ?? {} }); for (const [re, fn] of routes) if (re.test(String(url))) return fn(); return new Response('{}', { status: 404 }); };
  const j = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json' } });
  const d = WD.makeDeps({ url: 'https://p.supabase.co', serviceKey: 'svc', live: { secret: LIVE, priceId: PRICE_L }, sandbox: { secret: '', priceId: '' } },
    f([[/rpc\/billing_binding_brokerage$/, () => j(BK)], [/rpc\/billing_event_apply$/, () => j([{ outcome: 'RECORDED', event_id: 1, is_latest: true, bound: true, state: 'paid' }])]]), () => NOW);
  const b = await d.bindingOf('paddle', true, 'sub_1');
  const body = JSON.parse(reqs[0].init.body);
  ok(b === BK && reqs[0].url.endsWith('/rpc/billing_binding_brokerage') && JSON.stringify(body) === JSON.stringify({ p_processor: 'paddle', p_livemode: true, p_subscription_ref: 'sub_1' }), '2a the binding lookup is one RPC with the processor, the mode and the subscription ref');
  const d2 = WD.makeDeps({ url: 'https://p.supabase.co', serviceKey: 'svc', live: { secret: LIVE, priceId: PRICE_L }, sandbox: { secret: '', priceId: '' } }, f([[/rpc\/billing_binding_brokerage$/, () => j(null)]]), () => NOW);
  ok(await d2.bindingOf('paddle', true, 'sub_1') === null, '2b an unbound subscription is null');
  const d3 = WD.makeDeps({ url: 'https://p.supabase.co', serviceKey: 'svc', live: { secret: LIVE, priceId: PRICE_L }, sandbox: { secret: '', priceId: '' } }, f([[/rpc\/billing_binding_brokerage$/, () => j('not-a-uuid')]]), () => NOW);
  let e = 'none'; try { await d3.bindingOf('paddle', true, 'sub_1'); } catch (x) { e = x.constructor.name; }
  ok(e === 'DataUnavailable', '2c a malformed answer is DataUnavailable');
}
// ---- manage-billing: the Paddle checkout ----------------------------------------------------------------------------------------------------------
const mcalls = [];
const usage = (o = {}) => ({ brokerage_id: BK, role: 'owner', state: 'none', credit_limit: 100, credits_used: 0, credits_remaining: 0, period_ends_at: null, ...o });
function mdeps(over = {}) {
  const rec = (name, f) => async (...a) => { mcalls.push([name, ...a]); return f(...a); };
  return {
    authenticate: rec('authenticate', over.authenticate ?? (async () => ({ email: 'owner@example.test', id: UID }))),
    isAdmin: rec('isAdmin', async () => false),
    usageOf: rec('usageOf', over.usageOf ?? (async () => usage())),
    configured: () => false, checkoutEnabled: () => false,
    createCheckout: rec('createCheckout', async () => 'https://x.lemonsqueezy.com/c'),
    paddleConfigured: () => over.paddleConfigured ?? true,
    paddleEnabled: () => over.paddleEnabled ?? true,
    createPaddleTransaction: rec('createPaddleTransaction', over.createPaddleTransaction ?? (async () => ({ environment: 'sandbox', token: 'test_abc123', transaction_id: 'txn_01hv8x9y0z1a2b3c4d5e6f7g8h' }))),
    checkoutClaim: rec('checkoutClaim', over.checkoutClaim ?? (async () => ({ outcome: 'CLAIMED' }))),
    checkoutRelease: rec('checkoutRelease', async () => undefined),
  };
}
async function ask(d, body, { auth = 'Bearer t' } = {}) {
  mcalls.length = 0;
  const headers = { 'content-type': 'application/json' }; if (auth) headers.authorization = auth;
  const res = await MH.makeHandler(d)(new Request('https://x/functions/v1/manage-billing', { method: 'POST', headers, body: JSON.stringify(body) }));
  const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch { /* */ }
  return { status: res.status, json, text };
}
const named = (x) => mcalls.filter((c) => c[0] === x);
{
  let r = await ask(mdeps(), { action: 'paddle_checkout' }, { auth: null });
  ok(r.status === 401 && named('createPaddleTransaction').length === 0, '3a SIGN-IN IS REQUIRED: no session, no transaction');
  r = await ask(mdeps(), { action: 'paddle_checkout' });
  ok(r.status === 200 && r.json.status === 'OK' && r.json.paddle.transaction_id === 'txn_01hv8x9y0z1a2b3c4d5e6f7g8h' && r.json.paddle.environment === 'sandbox' && r.json.paddle.token === 'test_abc123' && Object.keys(r.json.paddle).length === 3,
    '3b an owner gets the transaction id, the environment and the PUBLIC client token, and nothing else', r.json);
  ok(r.text.indexOf(BK) < 0 && !/brokerage|bind|price|pri_|secret|api/i.test(r.text.replace('paddle', '')), '3c the answer carries no account id, price, signature or key');
  ok(named('createPaddleTransaction').length === 1 && named('createPaddleTransaction')[0][1] === BK && named('checkoutClaim').length === 1, '3d the transaction is made for the account the DATABASE names for the signed-in user, after the one-checkout slot was claimed');
  r = await ask(mdeps(), { action: 'paddle_checkout', brokerage_id: 'c0c0c0c0-1111-4222-8333-444444444444' });
  ok(r.status === 400 && named('createPaddleTransaction').length === 0, '3e a request that names an account is refused (unknown field)');
  r = await ask(mdeps({ usageOf: async () => usage({ role: 'agent' }) }), { action: 'paddle_checkout' });
  ok(r.status === 403 && named('createPaddleTransaction').length === 0, '3f only the account owner may buy');
  r = await ask(mdeps({ usageOf: async () => null }), { action: 'paddle_checkout' });
  ok(r.status === 403, '3g a person with no account cannot buy (they create their individual account first)');
  r = await ask(mdeps({ usageOf: async () => usage({ state: 'paid' }) }), { action: 'paddle_checkout' });
  ok(r.status === 409 && r.json.error === 'already_paid' && named('createPaddleTransaction').length === 0, '3h a paid account is not billed twice');
  for (const st of ['past_due', 'trialing', 'unknown']) { r = await ask(mdeps({ usageOf: async () => usage({ state: st }) }), { action: 'paddle_checkout' }); ok(r.status === 409 && named('createPaddleTransaction').length === 0, '3i a live or recoverable subscription (' + st + ') blocks a second checkout'); }
  for (const st of ['canceled', 'test_only', 'none']) { r = await ask(mdeps({ usageOf: async () => usage({ state: st }) }), { action: 'paddle_checkout' }); ok(r.status === 200, '3j ' + st + ' may start a new subscription'); }
  r = await ask(mdeps({ paddleEnabled: false }), { action: 'paddle_checkout' });
  ok(r.status === 503 && r.json.error === 'checkout_disabled' && named('createPaddleTransaction').length === 0 && named('checkoutClaim').length === 0, '3k the kill switch refuses before anything is claimed or asked');
  r = await ask(mdeps({ paddleConfigured: false }), { action: 'paddle_checkout' });
  ok(r.status === 503 && r.json.error === 'billing_not_set_up', '3l Paddle not configured: refused');
  r = await ask(mdeps({ checkoutClaim: async () => ({ outcome: 'BUSY' }) }), { action: 'paddle_checkout' });
  ok(r.status === 409 && r.json.error === 'checkout_in_progress' && named('createPaddleTransaction').length === 0, '3m one checkout at a time');
  r = await ask(mdeps({ createPaddleTransaction: async () => { throw new MH.CheckoutUnavailable('http 500'); } }), { action: 'paddle_checkout' });
  ok(r.status === 502 && named('checkoutRelease').length === 1, '3n a failed transaction frees the slot and says only that the page could not be opened');
  r = await ask(mdeps(), { action: 'checkout' });
  ok(r.status === 409 && r.json.error === 'wrong_processor' && named('createCheckout').length === 0, '3o with Paddle in use the Lemon checkout is refused');
  r = await ask(mdeps({ paddleConfigured: false }), { action: 'status' });
  ok(r.status === 200 && r.json.paddle === false, '3p status says whether Paddle is the processor in use');
  r = await ask(mdeps({ paddleEnabled: false }), { action: 'status' });
  ok(r.json.paddle === true && r.json.checkout === 'disabled' && r.text.indexOf(BK) < 0, '3q status reports `disabled` while the switch is off, and no account id');
  r = await ask(mdeps(), { action: 'status' });
  ok(r.json.checkout === 'available' && r.json.paddle === true, '3r status reports `available` when configured and enabled');
}
// ---- manage-billing: the real data layer for Paddle ---------------------------------------------------------------------------------------------
{
  const reqs = [];
  const f = (routes) => async (url, init) => { reqs.push({ url: String(url), init: init ?? {} }); for (const [re, fn] of routes) if (re.test(String(url))) return fn(); return new Response('{}', { status: 404 }); };
  const j = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json' } });
  const PAD = { environment: 'sandbox', apiKey: 'pdl_sdbx_apikey_secret', clientToken: 'test_abcdef1234567890', priceId: PRICE_S, secret: SBX };
  const mk = (over, routes) => MD.makeDeps({ url: 'https://p.supabase.co', serviceKey: 'svc', billing: { apiKey: '', storeId: '', variantId: '', secret: '', testMode: false }, paddle: { ...PAD, ...over }, ...(over.cfg ?? {}) }, f(routes));
  const OKTXN = [[/sandbox-api\.paddle\.com\/transactions$/, () => j({ data: { id: 'txn_01hv8x9y0z1a2b3c4d5e6f7g8h', status: 'draft' } }, 201)]];
  let d = mk({}, OKTXN);
  ok(d.paddleConfigured() === true && MD.isPaddleConfigured(PAD) === true, '4a a complete sandbox configuration is configured');
  const out = await d.createPaddleTransaction(BK);
  ok(out.environment === 'sandbox' && out.token === 'test_abcdef1234567890' && out.transaction_id === 'txn_01hv8x9y0z1a2b3c4d5e6f7g8h' && reqs.length === 1, '4b one request to Paddle; the browser gets the sandbox environment, the public token and the id');
  const sent = reqs[0], sb = JSON.parse(sent.init.body);
  ok(sent.init.headers.Authorization === 'Bearer pdl_sdbx_apikey_secret' && sb.custom_data.brokerage_id === BK && sb.custom_data.bind === hmac(SBX, 'hs-billing-checkout|paddle|' + BK) && sb.items[0].price_id === PRICE_S && sb.items[0].quantity === 1,
    '4c the request carries the API key in its header, the account and its signature under the SANDBOX secret, and the configured price');
  ok(!JSON.stringify(out).includes('pdl_sdbx_apikey_secret') && !JSON.stringify(out).includes(BK), '4d neither the API key nor the account id is in what the browser gets');
  let bads = 0;
  for (const cfg of [{ environment: '' }, { environment: 'live' }, { clientToken: 'live_abc' }, { apiKey: '' }, { priceId: 'x' }, { secret: '' }]) { if (MD.isPaddleConfigured({ ...PAD, ...cfg }) === false) bads++; }
  ok(bads === 6, '4e an unset environment, a live environment with a sandbox-prefixed token, a token with the wrong prefix, or a missing key, price or secret is NOT configured');
  ok(MD.isPaddleConfigured({ ...PAD, environment: 'live', clientToken: 'live_abcdef1234567890' }) === true, '4f a live environment needs a live_ token');
  let f2 = 0;
  for (const routes of [[[/transactions$/, () => j({ error: 'x' }, 403)]], [[/transactions$/, () => j({ data: { id: 'sub_01hv8x9y0z1a2b3c4d5e6f7g8h' } }, 201)]], [[/transactions$/, () => new Response('nope', { status: 201 })]], [[/transactions$/, () => { throw new Error('down pdl_sdbx_apikey_secret'); }]]]) {
    try { await mk({}, routes).createPaddleTransaction(BK); } catch (x) { if (x instanceof MH.CheckoutUnavailable && !String(x.message).includes('pdl_sdbx_apikey_secret')) f2++; }
  }
  ok(f2 === 4, '4g a refusal, a wrong-kind id, an unreadable answer or a dead network is CheckoutUnavailable with no key in the message', f2);
  // switches: live reads the live switch only; sandbox reads the sandbox switch only
  const sw = (env, c, s) => MD.makeDeps({ url: 'u', serviceKey: 's', billing: { apiKey: '', storeId: '', variantId: '', secret: '', testMode: false }, paddle: { ...PAD, environment: env }, checkoutEnabled: c, paddleSandboxCheckoutEnabled: s }, f([])).paddleEnabled();
  ok(sw('live', false, true) === false && sw('live', true, false) === true && sw('sandbox', true, false) === false && sw('sandbox', false, true) === true && sw('sandbox', false, false) === false,
    '4h a live deployment opens only on the LIVE switch and a sandbox deployment only on the SANDBOX switch (the sandbox switch can never open live checkout)');
  const fs = await import('node:fs');
  const sws = fs.readFileSync(new URL('../supabase/functions/_shared/billing-switch.ts', import.meta.url), 'utf8');
  ok(/export const CHECKOUT_ENABLED = false;/.test(sws) && /export const PADDLE_SANDBOX_CHECKOUT_ENABLED = false;/.test(sws), '4i BOTH shipped switches are OFF: live checkout is disabled');
}
console.log('\n' + (n - bad) + ' passed, ' + bad + ' failed of ' + n);
process.exit(bad ? 1 : 0);
