// THE CUSTOMER PAGE (development-activity-reports.html), driven in a real browser — build step 5c of
// docs/development-activity-build-steps-100526.md.
//
// CI has no invited account, so this suite stands in for what is outside the page: the supabase-js sign-in (a stub served at the CDN
// URL, so no request leaves the machine) and the two functions. Both functions are answered by their REAL request handlers, run here
// on every request the page makes, with a small fake ledger behind them (a count of used reports, and the reports already made, by
// key). So the page's own requests are validated by the real code: the trial function's gate and actions, and the report function's
// gate, its idempotency-key check and its one credit rule. What it proves:
//   * the invite link: the token is read from the fragment and removed from the address bar; signing in joins the trial once; the
//     per-tab invite slot is emptied; the panel says how many free reports are left;
//   * a report: one request, with the person's token, the customer view and a random v4 key; a charged report says so and the count
//     drops; a "No data ingested" report says it used nothing and the count stays;
//   * a lost answer: pressing again for the same address resends the SAME key and is not charged twice; a new address gets a new key;
//   * a used-up trial, no trial, an unusable invite, an admin: each in plain words, and "Make report" only for the two kinds of
//     caller the report function serves; an admin's request carries no key;
//   * it fits a 390 px screen; nothing else is fetched; no page error;
//   * build step 5e: an OWNER of an active trial sees "Invite an agent" and nobody else does; the link comes from the trial function's
//     real invite action, is shown once in a read-only box and copied; a refusal and a lost answer are said in plain words and show no
//     link; signing out, the trial ending and a different person signing in each take the card and its link away.
// Run: node test/development-activity-reports.browser.test.mjs
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, normalize } from 'node:path';
import { RICH, RIGHTS_NONE, RIGHTS_AB, NOW, wire, clone } from './lib/da-report-view-world.mjs';
import { LAUNCH_TEST_LOCATION, OTHER_PROPERTY, addressNo, geocodeStandIn } from './lib/launch-test-location.mjs';

const RH = await import('../supabase/functions/get-development-activity-report/handler.ts');
const TH = await import('../supabase/functions/development-activity-trial/handler.ts');
const E = await import('../supabase/functions/_shared/evaluation-reads.ts');
const MH = await import('../supabase/functions/manage-shared-report/handler.ts');   // build step 8: the agent's share-link function
const SR = await import('../supabase/functions/_shared/share-reads.ts');
const WH = await import('../supabase/functions/manage-property-watch/handler.ts');  // build step 9: the agent's Watch function
const WR = await import('../supabase/functions/_shared/watch-reads.ts');
const BH = await import('../supabase/functions/manage-billing/handler.ts');          // build step 11: the Billing function

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0, total = 0;
const ok = (c, name, detail) => {
  total++;
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name);
  if (!c) { fails++; if (detail !== undefined) console.log('           detail: ' + JSON.stringify(detail).slice(0, 600)); }
};

const PAGE = '/development-activity-reports.html';
const SB = 'https://qwnnmljucajnexpxdgxr.supabase.co/functions/v1/';
const REPORT_FN = SB + 'get-development-activity-report', TRIAL_FN = SB + 'development-activity-trial', MANAGE_FN = SB + 'manage-shared-report', WATCH_FN = SB + 'manage-property-watch', BILLING_FN = SB + 'manage-billing';
const CHECKOUT_URL = 'https://homesignal.lemonsqueezy.com/checkout/custom/test-checkout-1';
// the launch test location: Brigham City, UT 84302 (test/lib/launch-test-location.mjs; founder, 2026-10-04)
const ADDRESS = LAUNCH_TEST_LOCATION.address, OTHER = OTHER_PROPERTY;
const TOKEN = 'hse1_' + '0123456789abcdef'.repeat(4);
const UID = 'a1111111-1111-4111-8111-111111111111';
const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// supabase-js stand-in. window.__sb.session is the signed-in session, or null; verifyOtp signs in and tells every listener. Like the real
// library, subscribing reports the current session once more (INITIAL_SESSION), so the page hears of one session twice on load.
const SESSION_OF = (name) => "{ access_token: 'user-token', user: { id: '" + UID + "', email: 'agent@example.test', user_metadata: " + (name ? "{ full_name: " + JSON.stringify(name) + " }" : '{}') + ' } }';
const SB_STUB = (signedIn, name) => { const SESSION = SESSION_OF(name); return `
window.__sb = { session: ${signedIn ? SESSION : 'null'}, listeners: [], otp: [], updates: [], updateFails: false };
window.supabase = { createClient: function () { return { auth: {
  getSession: function () { return Promise.resolve({ data: { session: window.__sb.session } }); },
  onAuthStateChange: function (cb) { window.__sb.listeners.push(cb); setTimeout(function () { cb('INITIAL_SESSION', window.__sb.session); }, 0);
    return { data: { subscription: { unsubscribe: function () {} } } }; },
  signInWithOtp: function (a) { window.__sb.otp.push(a); return Promise.resolve({ error: null }); },
  verifyOtp: function () { window.__sb.session = ${SESSION};
    window.__sb.listeners.forEach(function (cb) { cb('SIGNED_IN', window.__sb.session); }); return Promise.resolve({ error: null }); },
  // build step 7: the agent's own name is saved to their sign-in account (user_metadata.full_name); the world's header follows what was saved
  updateUser: function (a) { window.__sb.updates.push(a);
    if (window.__sb.updateFails) return Promise.resolve({ data: null, error: { message: 'nope' } });
    // updateHold: the server's answer is on its way and arrives only when the test lets it (after another person has signed in)
    if (window.__sb.updateHold) return new Promise(function (res) { window.__sb.releaseUpdate = function () { res({ data: null, error: null }); }; });
    var u = window.__sb.session.user; u.user_metadata = Object.assign({}, u.user_metadata, a.data);
    if (window.__hsNameSaved) window.__hsNameSaved(a.data.full_name);
    window.__sb.listeners.forEach(function (cb) { cb('USER_UPDATED', window.__sb.session); });
    return Promise.resolve({ data: { user: u }, error: null }); },
  signOut: function () { window.__sb.session = null; window.__sb.listeners.forEach(function (cb) { cb('SIGNED_OUT', null); }); return Promise.resolve({}); }
} }; } };`; };

/** The world behind both functions for one page: the trial's state and a fake ledger. */
const MINT_TOKEN = 'hse1_' + 'fedcba9876543210'.repeat(4);
function world({ trial = 'active', used = 0, admin = false, rights = RIGHTS_AB, redeem = 'ok', role = 'agent', mint = 'ok', plan = 'none', paidUsed = 0, configured = true } = {}) {
  // build step 11: `plan` is the state the database would answer for this brokerage (none, paid, past_due, canceled, ...), `paidUsed` the reports used this month
  const w = { used, trial, admin, rights, redeem, role, mint, plan, paidUsed, configured, rate: null, checkoutMade: 0, checkoutFails: false, billingFails: false, billingGone: false, made: new Map(), redeemed: 0, minted: 0, header: { brokerage: 'Acme Realty', agent: null }, headerFails: false,
    shares: [], shareSeq: 0, shareFails: false, shareLimit: false,
    watches: [], watchSeq: 0, watchFails: false, watchLimit: false, watchNotKept: false, watchListFails: false };
  const state = () => (w.trial === null ? null : { status: w.used >= 10 ? 'complete' : w.trial, credits_used: w.used, credits_remaining: 10 - w.used, expired: false });
  const gate = { authenticate: async (t) => (t === 'user-token' ? { email: 'agent@example.test', id: UID } : null), isAdmin: async () => w.admin };
  w.trialHandler = TH.makeHandler({
    ...gate,
    trialOf: async () => state(),
    redeemInvite: async (token) => {
      if (w.redeem === 'unusable' || token !== TOKEN) throw new E.InviteUnusable('x');
      w.redeemed++; if (w.trial === null) w.trial = 'active';
      return { role: w.role, replayed: w.redeemed > 1 };
    },
    roleOf: async () => (w.trial === null ? null : w.role),
    // the database's own check at the moment of minting: an active owner of this brokerage, for an agent invite
    inviteAgent: async () => {
      if (w.mint === 'refuse' || w.role !== 'owner' || w.trial !== 'active') throw new E.NotEntitled('x');
      w.minted++;
      return { invite_link: E.inviteLink(MINT_TOKEN), invite_expires_at: '2026-10-16T12:00:00.123456+00:00' };
    },
    createTrial: async () => { throw new Error('the customer page never creates a trial'); },
    now: () => NOW,
  });
  // build step 8: the agent's share-link function, on the REAL handler and the real link form. The store behind it is the world's: a link is
  // made only for a report this brokerage made, a report holds at most 25, and revoking one that is already revoked is a quiet no-op.
  const ownReport = (id) => [...w.made.values()].some((m) => m.id === id);
  w.manageHandler = MH.makeHandler({
    ...gate,
    createShare: async (_u, reportId) => {
      if (w.shareFails) throw new RH.DataUnavailable('x');
      if (!ownReport(reportId)) throw new SR.ShareNotFound('x');
      if (w.shareLimit) throw new SR.ShareLimitReached('x');
      w.shareSeq++;
      const token = String(w.shareSeq).padStart(43, 'S');
      const row = { share_id: 'd0000000-0000-4000-8000-' + String(w.shareSeq).padStart(12, '0'), report_id: reportId, created_at: '2026-10-03T12:00:0' + (w.shareSeq % 10) + '+00:00',
        expires_at: '2027-04-03T12:00:00+00:00', revoked_at: null, status: 'ACTIVE', token };
      w.shares.push(row);
      return { share_id: row.share_id, expires_at: row.expires_at, link: SR.shareLink(token) };
    },
    listShares: async (_u, reportId) => {
      if (w.shareFails) throw new RH.DataUnavailable('x');
      return w.shares.filter((r) => r.report_id === reportId).slice().reverse().map(({ token: _t, report_id: _r, ...pub }) => pub);
    },
    revokeShare: async (_u, shareId) => {
      const row = w.shares.find((r) => r.share_id === shareId);
      if (!row) throw new SR.ShareNotFound('x');
      if (row.status === 'REVOKED') return false;
      row.status = 'REVOKED'; row.revoked_at = '2026-10-03T13:00:00+00:00'; return true;
    },
  });
  // build step 9: the agent's Watch function, on the REAL handler. The store behind it is the world's: a watch is made only for a report this
  // brokerage made, starting one twice is a no-op, a brokerage holds a limited number, and the property can have been purged.
  const reportRow = (id) => { let n = 0; for (const [key, m] of w.made.entries()) { n++; if (m.id === id) return { number: n, ctx: 'ctx-' + key, address: m.address }; } return null; };
  w.watchHandler = WH.makeHandler({
    ...gate,
    startWatch: async (_u, reportId) => {
      if (w.watchFails) throw new RH.DataUnavailable('x');
      if (!ownReport(reportId)) throw new WR.WatchNotFound('x');
      const have = w.watches.find((x) => x.report_id === reportId);
      if (have) return { watch_id: have.watch_id, started: false, created_at: have.created_at };
      if (w.watchNotKept) throw new WR.PropertyNotKept('x');
      if (w.watchLimit) throw new WR.WatchLimitReached('x');
      w.watchSeq++;
      const row = { watch_id: 'e0000000-0000-4000-8000-' + String(w.watchSeq).padStart(12, '0'), report_id: reportId, created_at: '2026-10-03T12:00:00+00:00',
        last_run_at: null, last_outcome: null, next_due_at: '2026-10-03T12:00:00+00:00' };
      w.watches.push(row);
      return { watch_id: row.watch_id, started: true, created_at: row.created_at };
    },
    watchesOf: async () => {
      if (w.watchFails || w.watchListFails) throw new RH.DataUnavailable('x');
      return w.watches.slice().reverse().map((x) => { const r = reportRow(x.report_id); return { ...x, number: r ? r.number : null, generated_at: '2026-10-02T12:00:00+00:00', private_context_id: r ? r.ctx : null }; });
    },
    stopWatch: async (_u, watchId) => {
      if (w.watchFails) throw new RH.DataUnavailable('x');
      const i = w.watches.findIndex((x) => x.watch_id === watchId);
      if (i < 0) throw new WR.WatchNotFound('x');
      w.watches.splice(i, 1);
    },
    addressOf: async (ctx) => { const m = ctx && w.made.get(ctx.slice(4)); return m ? m.address : null; },
  });
  const credit = () => ({ ordinal: w.used, credits_used: w.used, credits_remaining: 10 - w.used, evaluation_status: w.used >= 10 ? 'complete' : 'active', allotment: 'trial', period_ends_at: null });
  const PAID_END = '2026-11-04T12:00:00+00:00';
  const paidCredit = () => ({ ordinal: 10 + w.paidUsed, credits_used: w.paidUsed, credits_remaining: 100 - w.paidUsed, evaluation_status: 'paid', allotment: 'paid', period_ends_at: PAID_END });
  // the plan, as public.billing_usage answers it for this brokerage (null when the person belongs to none)
  const usage = () => (w.trial === null ? null : { brokerage_id: 'b0b0b0b0-1111-4222-8333-444444444444', role: w.role, state: w.plan, credit_limit: 100,
    credits_used: w.plan === 'paid' ? w.paidUsed : 0, credits_remaining: w.plan === 'paid' ? 100 - w.paidUsed : 0, period_ends_at: w.plan === 'paid' ? PAID_END : null });
  w.billingHandler = BH.makeHandler({
    ...gate,
    usageOf: async () => { if (w.billingFails) throw new RH.DataUnavailable('x'); return usage(); },
    configured: () => w.configured,
    createCheckout: async () => { if (w.checkoutFails) throw new BH.CheckoutUnavailable('x'); w.checkoutMade++; return CHECKOUT_URL; },
  });
  w.reportHandler = RH.makeHandler({
    ...gate, now: () => NOW, rights: w.rights,
    geocode: async (a) => geocodeStandIn(a),
    // the report rate limit (docs/report-rate-limit.sql): the database's answer, a refusal when the test sets `w.rate`
    rateClaim: async () => (w.rate ? { allowed: false, ...w.rate } : { allowed: true }),
    zipSupported: async () => true,
    radius: async () => RICH.rows, hydrate: async () => RICH.projects, ledger: async () => RICH.ledger ?? [], events: async () => RICH.events ?? [], health: async () => [],
    trialOf: async () => state(),
    planOf: async () => { if (w.billingFails) throw new RH.DataUnavailable('x'); return usage(); },
    issue: async (_u, key, intelligence, privateContext) => {
      const prior = w.made.get(key);
      if (prior) return { replayed: true, report_id: prior.id, generated_at: NOW.toISOString(), private_context_id: 'ctx-' + key, credit: prior.paid ? paidCredit() : credit() };
      // the database's one issuing entry: the month's allotment when the plan is paid, otherwise the free evaluation's
      const paid = w.plan === 'paid';
      if (paid) w.paidUsed++; else w.used++;
      const id = (paid ? 'c1000000' : 'c0000000') + '-0000-4000-8000-' + String(paid ? w.paidUsed : w.used).padStart(12, '0');
      w.made.set(key, { id, paid, address: w.lastAddress, label: (privateContext && privateContext.label) || null, report: intelligence });
      return { replayed: false, report_id: id, content_hash: 'h', report_version: 'v', generated_at: NOW.toISOString(), private_context_id: 'ctx-' + key, report: intelligence, credit: paid ? paidCredit() : credit() };
    },
    contextMatches: async (ctx, address) => { const m = w.made.get(ctx.slice(4)); return m && m.address === address ? 'match' : 'mismatch'; },
    storedReport: async (id) => { for (const m of w.made.values()) if (m.id === id) return JSON.stringify(m.report); return null; },
    // saved reports (build step 6): the stored reports of this brokerage, newest first; the database shows nothing without standing
    savedReports: async () => {
      if (w.trial !== 'active' && w.used < 10) return [];
      const rows = [...w.made.entries()].map(([key, m], i) => ({ report_id: m.id, number: i + 1, generated_at: w.generatedAt || '2026-10-02T12:00:00+00:00', private_context_id: 'ctx-' + key }));
      return w.listFails ? (() => { throw new RH.DataUnavailable('x'); })() : rows.reverse();
    },
    openSavedReport: async (_u, id) => {
      if (w.trial !== 'active' && w.used < 10) return null;
      let n = 0;
      for (const [key, m] of w.made.entries()) { n++; if (m.id === id) return { report_id: m.id, number: n, generated_at: w.generatedAt || '2026-10-02T12:00:00+00:00', private_context_id: 'ctx-' + key, body: JSON.stringify(m.report) }; }
      return null;
    },
    subjectOf: async (ctx) => { const m = ctx && w.made.get(ctx.slice(4)); return { address: m ? m.address : null, label: m ? E.cleanDisplayName(m.label, 80) : null }; },
    // build step 7: the viewer's own header, read when a report is shown
    headerOf: async () => { if (w.headerFails) throw new RH.DataUnavailable('x'); return w.header; },
  });
  return w;
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
  const url = req.url.split('?')[0];
  const p = normalize(join(root, decodeURIComponent(url)));
  if (!p.startsWith(root)) { res.writeHead(403).end(); return; }
  try { res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' }).end(await readFile(p)); }
  catch { res.writeHead(404).end('not found'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch();

/** Opens the page on a world. `lose` (a function of the report request body): the server handles that call, but its answer never
 *  reaches the page, the case where a retry could otherwise be charged twice. */
async function open({ w = world(), signedIn = true, hash = '', width = 1280, height = 900, lose = () => false, loseInvite = () => false, name = '', tz = '' } = {}) {
  const ctx = await browser.newContext(tz ? { viewport: { width, height }, timezoneId: tz } : { viewport: { width, height } });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
  const page = await ctx.newPage();
  await page.exposeFunction('__hsNameSaved', (v) => { w.header = { ...w.header, agent: E.cleanDisplayName(v, 80) }; }); // the server reads the saved name from the account
  const errors = [], reports = [], trials = [], foreign = [], saved = [], shareCalls = [], watchCalls = [], billingCalls = [], checkouts = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
  await page.route('**/*', async (route) => {
    const r = route.request(), url = r.url();
    if (url.startsWith(base)) return route.continue();
    if (url.startsWith('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2')) return route.fulfill({ status: 200, contentType: 'text/javascript', body: SB_STUB(signedIn, name) });
    if (url === MANAGE_FN) {
      const body = r.postData() ? JSON.parse(r.postData()) : null;
      shareCalls.push({ auth: r.headers().authorization || null, apikey: r.headers().apikey || null, body });
      const res = await w.manageHandler(new Request(url, { method: 'POST', headers: { authorization: r.headers().authorization || '', 'content-type': 'application/json' }, body: r.postData() }));
      return route.fulfill({ status: res.status, contentType: 'application/json', body: await res.text() });
    }
    if (url === BILLING_FN) {
      const body = r.postData() ? JSON.parse(r.postData()) : null;
      billingCalls.push({ auth: r.headers().authorization || null, apikey: r.headers().apikey || null, body });
      if (w.billingGone) return route.abort(); // the answer never reaches the page
      const res = await w.billingHandler(new Request(url, { method: 'POST', headers: { authorization: r.headers().authorization || '', 'content-type': 'application/json' }, body: r.postData() }));
      return route.fulfill({ status: res.status, contentType: 'application/json', body: await res.text() });
    }
    // the provider's own checkout page: the browser is sent here and nothing is exchanged with it; this stands in for it
    if (url.startsWith('https://homesignal.lemonsqueezy.com/')) { checkouts.push(url); return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Checkout</title><p>Checkout</p>' }); }
    if (url === WATCH_FN) {
      const body = r.postData() ? JSON.parse(r.postData()) : null;
      watchCalls.push({ auth: r.headers().authorization || null, apikey: r.headers().apikey || null, body });
      // holdNextWatchList: the server has the list and the answer is on its way; it arrives only when the test lets it (after the person has moved on)
      if (w.holdNextWatchList && body && body.action === 'list') { w.holdNextWatchList = false; await new Promise((res) => { w.releaseWatchList = res; }); }
      const res = await w.watchHandler(new Request(url, { method: 'POST', headers: { authorization: r.headers().authorization || '', 'content-type': 'application/json' }, body: r.postData() }));
      return route.fulfill({ status: res.status, contentType: 'application/json', body: await res.text() });
    }
    if (url === REPORT_FN || url === TRIAL_FN) {
      const body = r.postData() ? JSON.parse(r.postData()) : null;
      const rec = { auth: r.headers().authorization || null, apikey: r.headers().apikey || null, body };
      // a saved-reports read (build step 6) is not a report request: it is kept apart so "one request per report" stays checkable
      (url === REPORT_FN ? (body && body.action ? saved : reports) : trials).push(rec);
      if (url === REPORT_FN) w.lastAddress = body && body.address;
      // holdNextOpen: the server has the saved report and the answer is on its way; it arrives only when the test lets it (after the person has moved on)
      if (url === REPORT_FN && w.holdNextOpen && body && body.action === 'open') { w.holdNextOpen = false; await new Promise((res) => { w.releaseOpen = res; }); }
      const res = await (url === REPORT_FN ? w.reportHandler : w.trialHandler)(new Request(url, { method: 'POST', headers: { authorization: rec.auth || '', 'content-type': 'application/json' }, body: r.postData() }));
      const answer = await res.text();
      if (url === REPORT_FN && !(body && body.action) && lose(body)) return route.abort(); // the server did the work (and charged); only its answer is lost
      if (url === TRIAL_FN && body && body.action === 'invite' && loseInvite(body)) return route.abort(); // the invite was made; its answer is lost
      return route.fulfill({ status: res.status, contentType: 'application/json', body: answer });
    }
    foreign.push(url); return route.abort();
  });
  TRIALS.set(page, trials);
  await page.goto(base + PAGE + hash, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__sb && window.__sb.listeners.length > 0);
  return { ctx, page, errors, reports, trials, foreign, saved, shareCalls, watchCalls, billingCalls, checkouts, w };
}
const text = (page, sel) => page.$eval(sel, (e) => e.textContent.trim());
// WHAT A PERSON SEES, not what the attribute says. `el.hidden` is only the attribute: a page rule that sets a display (the cards below are display:grid by id)
// beats the browser's own rule for it, so an element can have hidden === true and still be drawn. That is exactly what happened live in Manual Test Part B
// (2026-10-04: Billing, "Invite an agent", "Saved reports" for a signed-out visitor; the Share box under a report that was not saved), and every earlier
// check passed because it read the attribute. So "not shown" is asserted here as: computed display is not none AND the box has a size.
const CARDS = ['#billing', '#team', '#saved', '#compare', '#profile', '#share', '#watch'];
const drawn = (page, sel) => page.$eval(sel, (e) => { const s = getComputedStyle(e), r = e.getBoundingClientRect(); return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0; });
const drawnCards = (page) => page.evaluate((sels) => sels.filter((sel) => { const e = document.querySelector(sel), s = getComputedStyle(e), r = e.getBoundingClientRect(); return s.display !== 'none' && r.width > 0 && r.height > 0; }), CARDS);
const TRIALS = new WeakMap();
const trialsOf = (page) => TRIALS.get(page);
const settled = (page) => page.waitForFunction(() => !/Making the report/.test(document.getElementById('status').textContent) && !/^Sign in/.test(document.getElementById('trial-count').textContent), null, { timeout: 8000 }).catch(() => {});
async function make(page, address = ADDRESS) {
  await page.fill('#addr', address);
  await page.click('#go');
  await page.waitForFunction(() => !/Making the report/.test(document.getElementById('status').textContent) && document.getElementById('status').textContent.trim() !== '', null, { timeout: 8000 }).catch(() => {});
}
const waitCount = (page, re) => page.waitForFunction((src) => new RegExp(src).test(document.getElementById('trial-count').textContent), re.source, { timeout: 8000 }).catch(() => {});

// ---- 1. the invite link: joined once, the token gone from the address bar and the tab ------------------------------------------------
{
  const w = world({ trial: null });
  // the link exactly as the trial function hands it to the admin who created the trial (build step 5d): its path is this page and its
  // fragment is what this page reads, so a change to either half of the invite link fails here
  const link = new URL(E.inviteLink(TOKEN));
  ok(link.origin === 'https://homesignal.net' && link.pathname === PAGE, '1-0 the invite link the server makes points at this page', link.href);
  const { ctx, page, errors, trials, foreign } = await open({ w, signedIn: false, hash: link.hash });
  ok((await page.evaluate(() => location.hash)) === '' && !(await page.evaluate(() => location.href)).includes('hse1_'), '1a the invite token is removed from the address bar on load');
  ok(/join your brokerage/.test(await text(page, '#trial-count')) && trials.length === 0, '1b signed out, the page asks the person to sign in to join, and calls nothing');
  await page.click('#signin');
  await page.fill('#auth-email', 'agent@example.test');
  await page.click('#auth-submit');
  await page.waitForSelector('#auth-code', { state: 'visible' });
  ok((await page.evaluate(() => window.__sb.otp[0].options.shouldCreateUser)) === true, '1c the sign-in may create an account (an invited person usually has none)');
  await page.fill('#auth-code', '123456');
  await page.click('#auth-submit');
  await waitCount(page, /free reports left/);
  ok(trials.length === 1 && trials[0].body.action === 'redeem' && trials[0].body.token === TOKEN && trials[0].auth === 'Bearer user-token',
    '1d after sign-in the page redeems the invite once, with the person\'s own token', trials.map((t) => t.body));
  ok(w.redeemed === 1 && /^10 free reports left$/.test(await text(page, '#trial-count')) && /joined/.test(await text(page, '#trial-sub')),
    '1e the panel says the person joined and has 10 free reports left', [await text(page, '#trial-count'), await text(page, '#trial-sub')]);
  ok((await page.evaluate(() => sessionStorage.getItem('hs-da-invite'))) === null, '1f the per-tab invite slot is emptied once the invite has been used');
  ok(!(await page.$eval('#go', (b) => b.disabled)), '1g "Make report" is offered');
  ok(errors.length === 0 && foreign.length === 0, '1h no page error, and nothing fetched but the page, its libraries, the sign-in stand-in and the two functions', { errors, foreign });
  await ctx.close();
}

// ---- 2. a report that uses a free report, and one that does not -------------------------------------------------------------------------
{
  const w = world({ used: 3 });
  const { ctx, page, errors, reports, foreign } = await open({ w });
  await waitCount(page, /^7 free reports left$/);
  ok(/^7 free reports left$/.test(await text(page, '#trial-count')), '2a signed in, the panel reads the trial: 7 left');
  await page.waitForTimeout(200);
  ok(trialsOf(page).length === 1, '2a2 the trial is read once, though the sign-in library reports the session twice on load (getSession and INITIAL_SESSION)', trialsOf(page).length);
  await make(page);
  ok(reports.length === 1 && reports[0].auth === 'Bearer user-token' && V4.test(reports[0].body.idempotency_key || '')
     && JSON.stringify(Object.keys(reports[0].body).sort()) === '["address","idempotency_key","view"]' && reports[0].body.view === 'customer',
    '2b one request, with the person\'s token, the customer view and a random v4 key, and nothing else', reports.map((r) => r.body));
  ok(w.used === 4 && (await page.$$('#report .da-rv-sec')).length > 0 && /used 1 of your brokerage/.test(await text(page, '#creditnote')),
    '2c a report that shows development is drawn and says it used one free report', await text(page, '#creditnote'));
  ok(/^6 free reports left$/.test(await text(page, '#trial-count')), '2d the panel now says 6 left, from the report function\'s own count');
  // a fresh world with nothing cleared: a "No data ingested" report
  await ctx.close();
  const w2 = world({ used: 4, rights: RIGHTS_NONE });
  const o2 = await open({ w: w2 });
  await waitCount(o2.page, /^6 free reports left$/);
  await make(o2.page);
  ok(w2.used === 4 && /did not use a free report: No data ingested/.test(await text(o2.page, '#creditnote')) && /^6 free reports left$/.test(await text(o2.page, '#trial-count')),
    '2e a "No data ingested" report says it used nothing, and the count stays', [await text(o2.page, '#creditnote'), await text(o2.page, '#trial-count')]);
  // the empty-source state on the launch test location (Brigham City, UT 84302), read off the page the way a person sees it: a plain answer, not a failure
  const hero = await o2.page.$eval('#report .da-rv-sec--outcome', (e) => ({ title: e.querySelector('.da-rv-h2').textContent.trim(), body: e.querySelector('.da-rv-outcome-p').textContent.trim() })).catch(() => null);
  ok(hero && hero.title === 'No data ingested' && /It is not a finding that there is no development\./.test(hero.body) && (await o2.page.$$('#report .da-rv-card')).length === 0,
    '2e2 the report page leads with "No data ingested" and the founder\'s sentence that it is not a finding of no development, and draws no project', hero);
  const st2 = await o2.page.$eval('#status', (e) => ({ text: e.textContent.trim(), cls: e.className }));
  ok(/^Report ready: No data ingested for this address\./.test(st2.text) && !/\b0 official records?\b/.test(st2.text) && st2.cls === '',
    '2e3 the status line says "No data ingested", never "0 official records within 0.5 miles", and is not styled as an error', st2);
  ok(await o2.page.$eval('#report', (e) => !e.hidden) && (await o2.page.$$('#status.err')).length === 0 && !/\b(error|could not|try again|something went wrong)\b/i.test(await text(o2.page, '#report')),
    '2e4 nothing on the page reads or looks like an error: the report is shown, the status is not red, no failure wording', await text(o2.page, '#report'));
  ok(!/\b0 (official )?(records?|projects?)\b/i.test(await text(o2.page, '#report')) && !(await text(o2.page, '#report')).includes('No development activity'),
    '2e5 and it states no measured zero and does not use the other outcome\'s words ("No development activity"): the two founder outcomes are never confused');
  ok(errors.length === 0 && o2.errors.length === 0 && foreign.length === 0 && o2.foreign.length === 0, '2f no page error, nothing foreign fetched', { errors, e2: o2.errors });
  // RENDERED, not the attribute (Manual Test Part B, 2026-10-04). A "No data ingested" report is not saved, so nothing about it can be shared or watched: no Share box and no
  // Watch box is DRAWN under it, while the report itself is (the positive control: this check can see a box that is on screen).
  ok(!(await drawn(o2.page, '#share')) && !(await drawn(o2.page, '#watch')) && (await drawn(o2.page, '#report')) && (await drawn(o2.page, '#rf')),
    '2g after a "No data ingested" report no Share box and no Watch box is drawn, while the report and the form are', { share: await drawn(o2.page, '#share'), watch: await drawn(o2.page, '#watch') });
  await o2.ctx.close();
  // A visitor who is not signed in sees none of the member cards. Billing, "Invite an agent", "Saved reports", Compare, "Your name", Share and Watch are all hidden by the
  // script and each has a display:grid rule of its own, so only the page's [hidden] rule keeps them off the screen.
  const so = await open({ w: world(), signedIn: false });
  const drawnOut = await drawnCards(so.page);
  ok(drawnOut.length === 0 && (await drawn(so.page, '#rf')) && (await drawn(so.page, '#trial')),
    '2h signed out, none of the seven member cards is drawn (Billing, Invite an agent, Saved reports, Compare, Your name, Share, Watch), while the form and the sign-in panel are', drawnOut);
  // the instrument must be able to see the defect: take the page's [hidden] rule out of the live stylesheet (the page as it was before the fix) and the same read must now
  // find all seven drawn. The count of rules removed is asserted, so a mutation that did not apply cannot pass as a kill.
  const removed = await so.page.evaluate(() => { let n = 0; for (const sh of document.styleSheets) { for (let i = sh.cssRules.length - 1; i >= 0; i--) { if (sh.cssRules[i].selectorText === '[hidden]') { sh.deleteRule(i); n++; } } } return n; });
  const drawnOld = await drawnCards(so.page);
  ok(removed === 1 && JSON.stringify(drawnOld.slice().sort()) === JSON.stringify(CARDS.slice().sort()),
    '2i without the page\'s [hidden] rule the same read finds all seven hidden cards drawn: this check fails on the old page', { removed, drawnOld });
  ok(so.errors.length === 0 && so.foreign.length === 0, '2j signed out: no page error, nothing foreign fetched', { e: so.errors, f: so.foreign });
  await so.ctx.close();
}

// ---- 3. a lost answer is retried with the same key, and is not charged twice -------------------------------------------------------------
{
  const w = world({ used: 0 });
  let lost = 0;
  const { ctx, page, reports } = await open({ w, lose: () => lost++ === 0 }); // the server charges the first request, but its answer never arrives
  await waitCount(page, /^10 free reports left$/);
  await make(page);
  ok(/could not be reached/.test(await text(page, '#status')) && /will not use a second free report/.test(await text(page, '#status')),
    '3a a lost answer says so, and says pressing again will not use a second free report');
  await page.click('#go');
  await page.waitForFunction(() => document.querySelectorAll('#report .da-rv-sec').length > 0, null, { timeout: 8000 }).catch(() => {});
  ok(reports.length === 2 && reports[0].body.idempotency_key === reports[1].body.idempotency_key, '3b pressing again for the same address resends the SAME key', reports.map((r) => r.body.idempotency_key));
  ok(w.used === 1 && /the report you already made for this address/.test(await text(page, '#creditnote')) && /did not use another/.test(await text(page, '#creditnote'))
     && /^9 free reports left$/.test(await text(page, '#trial-count')),
    '3c the server had already charged the first request: the retry gets that same report, says it used no second one, and 9 are left', [w.used, await text(page, '#creditnote')]);
  await make(page, OTHER);
  ok(reports.length === 3 && reports[2].body.idempotency_key !== reports[1].body.idempotency_key && V4.test(reports[2].body.idempotency_key) && w.used === 2,
    '3d a new address gets a new key, and is a new report');
  await make(page, OTHER);
  ok(reports.length === 4 && reports[3].body.idempotency_key !== reports[2].body.idempotency_key && w.used === 3,
    '3e once an answer arrived, asking again is a new report with a new key (the page never reuses a finished key)');
  await ctx.close();
}

// ---- 3x. the report rate limit, in plain words: nothing was made, nothing used, and it says how long to wait ---------------------------------------------------
{
  const cases = [
    [{ retryAfterSeconds: 30, limitedBy: 'user', windowSeconds: 60 }, /^You have asked for a lot of reports in a short time\. Try again in 30 seconds\. This did not use a free report\.$/, 'a person\'s own ceiling, 30 seconds'],
    [{ retryAfterSeconds: 1, limitedBy: 'user', windowSeconds: 60 }, /Try again in 1 second\. This did not use a free report\.$/, 'one second is singular'],
    [{ retryAfterSeconds: 600, limitedBy: 'brokerage', windowSeconds: 3600 }, /^Your brokerage has asked for a lot of reports in a short time\. Try again in 10 minutes\./, 'the brokerage\'s ceiling, 10 minutes'],
    [{ retryAfterSeconds: 72000, limitedBy: 'user', windowSeconds: 86400 }, /Try again in 20 hours\./, 'the day\'s ceiling, 20 hours'],
  ];
  for (const [rate, re, what] of cases) {
    const w = world({ used: 4 });
    const { ctx, page, reports, errors, foreign } = await open({ w });
    await waitCount(page, /^6 free reports left$/);
    w.rate = rate;
    await make(page);
    const st = await page.$eval('#status', (e) => ({ text: e.textContent.trim(), err: e.classList.contains('err') }));
    ok(re.test(st.text) && st.err, '3x ' + what + ': the page says so in plain words and shows it as a refusal', st);
    ok(w.used === 4 && /^6 free reports left$/.test(await text(page, '#trial-count')), '3x ' + what + ': nothing was used: the brokerage still has 6 free reports left', [w.used, await text(page, '#trial-count')]);
    ok(reports.length === 1 && (await page.$$('#report .da-rv-sec')).length === 0, '3x ' + what + ': one request was sent and no report is drawn', [reports.length, (await page.$$('#report .da-rv-sec')).length]);
    const shown = await text(page, 'main');
    ok(!/\b429\b|rate_limited|retry_after/.test(shown), '3x ' + what + ': no status code, error code or field name is shown to the person', shown.slice(0, 200));
    // Chromium itself logs one console line for any non-2xx answer; that single line is the expected network log, not a page error
    ok(errors.filter((e) => !/Failed to load resource: the server responded with a status of 429/.test(e)).length === 0 && errors.length <= 1 && foreign.length === 0, '3x ' + what + ': no page error and nothing foreign fetched (the one network log Chromium writes for a 429 is expected)', errors);
    await ctx.close();
  }
  // when the window has passed, the very same page makes the report
  const w = world({ used: 4 });
  const { ctx, page } = await open({ w });
  await waitCount(page, /^6 free reports left$/);
  w.rate = { retryAfterSeconds: 5, limitedBy: 'user', windowSeconds: 60 };
  await make(page);
  w.rate = null;
  await page.click('#go');
  await page.waitForFunction(() => document.querySelectorAll('#report .da-rv-sec').length > 0, null, { timeout: 8000 }).catch(() => {});
  ok(w.used === 5 && /^5 free reports left$/.test(await text(page, '#trial-count')), '3x and once the wait is over the same button makes the report: one free report used, 5 left', [w.used]);
  await ctx.close();
}

// ---- 4. who may make reports, in plain words -----------------------------------------------------------------------------------------------
for (const [label, w, count, disabled] of [
  ['a used-up trial', world({ used: 10 }), /All 10 free reports are used/, true],
  ['no trial', world({ trial: null }), /not part of a trial/, true],
  ['a revoked trial', world({ trial: 'revoked' }), /trial has ended/, true],
  ['an admin', world({ trial: null, admin: true }), /HomeSignal admin/, false],
]) {
  const { ctx, page, errors } = await open({ w });
  await waitCount(page, count);
  ok(count.test(await text(page, '#trial-count')) && (await page.$eval('#go', (b) => b.disabled)) === disabled,
    '4 ' + label + ': the panel says so, and "Make report" is ' + (disabled ? 'not offered' : 'offered'), await text(page, '#trial-count'));
  ok(errors.length === 0, '4 ' + label + ': no page error', errors);
  await ctx.close();
}
{
  const w = world({ trial: null, admin: true });
  const { ctx, page, reports } = await open({ w });
  await waitCount(page, /HomeSignal admin/);
  await make(page);
  ok(reports.length === 1 && reports[0].body.idempotency_key === undefined && w.used === 0 && /Admin report: no free report was used/.test(await text(page, '#creditnote')),
    '4e an admin\'s report carries no key (the report function refuses one), uses nothing, and says so', reports.map((r) => r.body));
  await ctx.close();
}
{
  const w = world({ trial: null, redeem: 'unusable' });
  const { ctx, page, trials } = await open({ w, hash: '#invite=' + TOKEN });
  await waitCount(page, /not part of a trial/);
  ok(trials.length === 2 && trials[0].body.action === 'redeem' && trials[1].body.action === 'status' && /cannot be used: it may have expired, been used by someone else, or been withdrawn/.test(await text(page, '#trial-sub')),
    '4f an unusable invite: the page says it cannot be used, then shows what the account does have', [trials.map((t) => t.body.action), await text(page, '#trial-sub')]);
  ok((await page.evaluate(() => sessionStorage.getItem('hs-da-invite'))) === null, '4g and forgets the invite');
  await ctx.close();
}
{
  const w = world({ used: 9 });
  const { ctx, page } = await open({ w });
  await waitCount(page, /^1 free report left$/);
  await make(page);
  ok(w.used === 10 && /All 10 free reports are used/.test(await text(page, '#trial-count')) && (await page.$eval('#go', (b) => b.disabled)) && (await page.$$('#report .da-rv-sec')).length > 0,
    '4h the twentieth report is shown, and the panel then says the trial is complete and stops offering reports');
  await ctx.close();
}

// ---- 5. a phone -------------------------------------------------------------------------------------------------------------------------------
{
  const w = world({ used: 2 });
  const { ctx, page } = await open({ w, width: 390, height: 844 });
  await waitCount(page, /free reports left/);
  await make(page);
  const wide = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok((await page.$$('#report .da-rv-sec')).length > 0 && wide <= 0, '5a on a 390 px screen the report is drawn and the page does not scroll sideways', wide);
  await ctx.close();
}

// ---- 6. an owner invites an agent (build step 5e) ---------------------------------------------------------------------------------------
const teamShown = (page) => drawn(page, '#team'); // rendered, not the attribute (see `drawn`)
for (const [label, w, count] of [
  ['an agent', world({ role: 'agent' }), /free reports left/],
  ['an admin', world({ trial: null, admin: true }), /HomeSignal admin/],
  ['a person with no trial', world({ trial: null, role: 'owner' }), /not part of a trial/],
  ['an owner of a used-up trial', world({ role: 'owner', used: 10 }), /All 10 free reports are used/],
  ['an owner of a revoked trial', world({ role: 'owner', trial: 'revoked' }), /trial has ended/],
]) {
  const { ctx, page, errors } = await open({ w });
  await waitCount(page, count);
  ok(!(await teamShown(page)) && errors.length === 0, '6a ' + label + ' is not offered "Invite an agent"', errors);
  await ctx.close();
}
{
  const w = world({ role: 'owner', used: 2 });
  const { ctx, page, trials, errors, foreign } = await open({ w });
  await waitCount(page, /^8 free reports left$/);
  ok(await teamShown(page) && /Invite an agent/.test(await text(page, '#team-title')) && (await page.$eval('#minted', (e) => e.hidden)),
    '6b an owner of an active trial sees "Invite an agent", with no link yet');
  await page.click('#mint');
  await page.waitForFunction(() => !document.getElementById('minted').hidden || /could not/.test(document.getElementById('team-status').textContent), null, { timeout: 8000 }).catch(() => {});
  const inv = trials.filter((t) => t.body && t.body.action === 'invite');
  ok(inv.length === 1 && JSON.stringify(inv[0].body) === '{"action":"invite"}' && inv[0].auth === 'Bearer user-token' && w.minted === 1,
    '6c one request to the trial function, with the person\'s own token and nothing but the action, and one invite made', inv.map((t) => t.body));
  const shown = await page.$eval('#invite-link', (e) => ({ v: e.value, ro: e.readOnly }));
  ok(shown.v === E.inviteLink(MINT_TOKEN) && shown.ro, '6d the link is the one invite-link form, in a read-only box', shown);
  const note = await text(page, '#invite-note');
  ok(/one agent/.test(note) && /October 16, 2026/.test(note) && /limit on agents/.test(note) && /only this once/.test(note),
    '6e the note says it is for one agent, until when it works, that a full seat limit stops it, and that it is shown once', note);
  await page.click('#copy-invite');
  await page.waitForFunction(() => /Copied|Selected/.test(document.getElementById('copy-invite').textContent), null, { timeout: 4000 }).catch(() => {});
  const copied = await page.evaluate(() => navigator.clipboard.readText().catch(() => null));
  ok(/^Copied$/.test(await text(page, '#copy-invite')) && copied === E.inviteLink(MINT_TOKEN), '6f "Copy link" copies exactly the link', [await text(page, '#copy-invite'), copied]);
  await page.click('#mint');
  await page.waitForTimeout(300);
  ok(w.minted === 2 && (await page.$eval('#invite-link', (e) => e.value)) === E.inviteLink(MINT_TOKEN) && /^Copy link$/.test(await text(page, '#copy-invite')),
    '6g a second press makes a second link (one per agent), and the copy button starts over');
  ok((await page.evaluate(() => JSON.stringify(sessionStorage) + JSON.stringify(localStorage))).indexOf('hse1_') === -1, '6h the link is never stored in the browser');
  await page.evaluate(() => window.__sb.listeners.forEach((cb) => cb('SIGNED_OUT', null)));
  await page.waitForTimeout(200);
  ok(!(await teamShown(page)) && (await page.$eval('#invite-link', (e) => e.value)) === '' && (await page.$eval('#minted', (e) => e.hidden)),
    '6i signing out takes the card away and forgets the link');
  // signed in again as the owner, a link made, and then a DIFFERENT person signs in on the same tab: in the same moment (before the
  // page has asked anything about the new person) the card and the owner's link are gone
  await page.evaluate((s) => { window.__sb.session = s; window.__sb.listeners.forEach((cb) => cb('SIGNED_IN', s)); }, { access_token: 'user-token', user: { id: UID, email: 'agent@example.test' } });
  await waitCount(page, /free reports left/);
  await page.waitForFunction(() => !document.getElementById('team').hidden, null, { timeout: 8000 }).catch(() => {});
  await page.click('#mint');
  await page.waitForFunction(() => !document.getElementById('minted').hidden, null, { timeout: 8000 }).catch(() => {});
  const swap = await page.evaluate(() => {
    const before = document.getElementById('invite-link').value;
    const other = { access_token: 'other-token', user: { id: 'b2222222-2222-4222-8222-222222222222', email: 'someone@example.test' } };
    window.__sb.session = other; window.__sb.listeners.forEach((cb) => cb('SIGNED_IN', other));
    return { before, hidden: document.getElementById('team').hidden, after: document.getElementById('invite-link').value };
  });
  ok(swap.before.includes('hse1_') && swap.hidden && swap.after === '', '6q a different person signing in on the tab takes the card and the owner\'s link away at once', swap);
  ok(errors.length === 0 && foreign.length === 0, '6j no page error, nothing foreign fetched', { errors, foreign });
  await ctx.close();
}
{
  // the person is an owner when the page loads, but the database refuses at the moment of minting (they were made an agent meanwhile)
  const w = world({ role: 'owner' });
  const { ctx, page } = await open({ w });
  await waitCount(page, /free reports left/);
  w.mint = 'refuse';
  await page.click('#mint');
  await page.waitForFunction(() => /owner/.test(document.getElementById('team-status').textContent), null, { timeout: 8000 }).catch(() => {});
  ok(/Only an owner of your brokerage.s trial can invite agents/.test(await text(page, '#team-status')) && (await page.$eval('#invite-link', (e) => e.value)) === '' && w.minted === 0,
    '6k the database refusing: plain words, and no link', await text(page, '#team-status'));
  w.mint = 'ok'; w.role = 'agent';
  await page.click('#mint');
  await page.waitForFunction(() => document.getElementById('team').hidden, null, { timeout: 8000 }).catch(() => {});
  ok(!(await teamShown(page)) && w.minted === 0, '6l after a refusal the page reads the trial again, and the card goes away once the person is no longer an owner');
  await ctx.close();
}
{
  const w = world({ role: 'owner' });
  const { ctx, page } = await open({ w, loseInvite: () => true });
  await waitCount(page, /free reports left/);
  await page.click('#mint');
  await page.waitForFunction(() => /could not be made/.test(document.getElementById('team-status').textContent), null, { timeout: 8000 }).catch(() => {});
  ok(/could not be made just now\. Try again/.test(await text(page, '#team-status')) && (await page.$eval('#invite-link', (e) => e.value)) === '' && !(await page.$eval('#mint', (b) => b.disabled)),
    '6m a lost answer says to try again, shows no link, and offers the button again (an unseen link simply expires)', await text(page, '#team-status'));
  await ctx.close();
}
{
  const w = world({ role: 'owner', used: 9 });
  const { ctx, page } = await open({ w });
  await waitCount(page, /^1 free report left$/);
  ok(await teamShown(page), '6n an owner with one report left is offered the card');
  await make(page);
  ok(w.used === 10 && !(await teamShown(page)), '6o using the last free report takes the card away (no agent could make a report)');
  await ctx.close();
}
{
  const w = world({ role: 'owner' });
  const { ctx, page } = await open({ w, width: 390, height: 844 });
  await waitCount(page, /free reports left/);
  await page.click('#mint');
  await page.waitForFunction(() => !document.getElementById('minted').hidden, null, { timeout: 8000 }).catch(() => {});
  const wide = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok(!(await page.$eval('#minted', (e) => e.hidden)) && wide <= 0, '6p on a 390 px screen the link is shown and the page does not scroll sideways', wide);
  await ctx.close();
}

// ---- 7. saved reports (build step 6): the brokerage's stored reports, opened as stored, never charged ---------------------------------
const ADDRESS_2 = addressNo(2);
const savedShown = (page) => page.$eval('#saved', (e) => !e.hidden);
const rowsOf = (page) => page.$$eval('#saved-list button', (bs) => bs.map((b) => b.textContent.trim()));
const waitRows = (page, k) => page.waitForFunction((c) => document.querySelectorAll('#saved-list button').length === c, k, { timeout: 8000 }).catch(() => {});
{
  const w = world();
  const { ctx, page, errors, reports, saved, foreign } = await open({ w });
  await waitCount(page, /free reports left/);
  ok(await savedShown(page) && (await rowsOf(page)).length === 0 && /No reports saved yet/.test(await text(page, '#saved-status')),
    '7a a trial member with no report yet sees the card and is told none is saved', await text(page, '#saved-status'));
  await make(page, ADDRESS); await make(page, ADDRESS_2);
  await waitRows(page, 2);
  const rows = await rowsOf(page);
  ok(rows.length === 2 && /^Report 2 · /.test(rows[0]) && /^Report 1 · /.test(rows[1]) && rows[0].includes(ADDRESS_2) && rows[1].includes(ADDRESS),
    '7b the list is newest first, each with its number, its address and its date', rows);
  ok(reports.length === 2 && w.used === 2, '7c listing made no report and used no free report', { reports: reports.length, used: w.used });
  const lists = saved.filter((r) => r.body.action === 'list');
  ok(lists.length >= 1 && lists.every((r) => JSON.stringify(r.body) === '{"action":"list"}' && r.auth === 'Bearer user-token'), '7d a list request carries the action and the person\'s own token, nothing else', lists.map((r) => r.body));
  await page.evaluate(() => { document.getElementById('report').textContent = ''; });
  await page.click('#saved-list li:nth-child(2) button');
  await page.waitForFunction(() => /Saved report 1/.test(document.getElementById('saved-status').textContent), null, { timeout: 8000 }).catch(() => {});
  const opens = saved.filter((r) => r.body.action === 'open');
  ok(opens.length === 1 && opens[0].body.report_id === 'c0000000-0000-4000-8000-000000000001' && Object.keys(opens[0].body).sort().join() === 'action,report_id', '7e opening sends the action and the report id only (no address, no key)', opens.map((o) => o.body));
  ok((await page.$eval('#report', (e) => e.textContent.trim().length)) > 100 && !(await page.$eval('#creditnote', (e) => e.hidden)) && /did not use a free report/.test(await text(page, '#creditnote')),
    '7f the stored report is shown and the page says opening did not use a free report', await text(page, '#creditnote'));
  ok(w.used === 2 && reports.length === 2 && /Saved report 1/.test(await text(page, '#saved-status')), '7g opening used no free report and made no report request', { used: w.used });
  w.made.forEach((m) => { m.address = null; }); // the private layer has purged the addresses
  await page.evaluate(() => window.__sb.listeners.forEach((cb) => cb('SIGNED_OUT', null)));
  await page.waitForTimeout(200);
  ok(!(await savedShown(page)) && (await rowsOf(page)).length === 0, '7h signing out hides the card and empties the list', await rowsOf(page));
  await page.evaluate((s2) => { window.__sb.session = s2; window.__sb.listeners.forEach((cb) => cb('SIGNED_IN', s2)); }, { access_token: 'user-token', user: { id: UID, email: 'agent@example.test' } });
  await waitRows(page, 2);
  const purged = await rowsOf(page);
  ok(purged.length === 2 && purged.every((r) => /address no longer kept/.test(r)), '7i a report whose address has been purged is still listed and opens, saying the address is no longer kept', purged);
  ok((await page.evaluate(() => JSON.stringify(sessionStorage) + JSON.stringify(localStorage))).indexOf('c0000000') === -1, '7j no report id is kept in the browser');
  ok(errors.length === 0 && foreign.length === 0, '7k no page error, nothing foreign fetched', { errors, foreign });
  await ctx.close();
}
{
  // a different person on the same tab: the first person's list and report are gone in the same moment
  const w = world();
  const { ctx, page } = await open({ w });
  await waitCount(page, /free reports left/);
  await make(page);
  await waitRows(page, 1);
  const swap = await page.evaluate(() => {
    const other = { access_token: 'other-token', user: { id: 'b2222222-2222-4222-8222-222222222222', email: 'someone@example.test' } };
    window.__sb.session = other; window.__sb.listeners.forEach((cb) => cb('SIGNED_IN', other));
    return { hidden: document.getElementById('saved').hidden, rows: document.querySelectorAll('#saved-list button').length };
  });
  ok(swap.hidden && swap.rows === 0, '7l a different person signing in takes the list away at once', swap);
  await ctx.close();
}
{
  // no standing, no card: a person with no trial, and a trial that has ended
  for (const [label, opts] of [['no trial', { trial: null }], ['an ended trial', { trial: 'revoked' }]]) {
    const { ctx, page, saved } = await open({ w: world(opts) });
    await settled(page);
    await page.waitForTimeout(300);
    ok(!(await savedShown(page)) && saved.length === 0, '7m ' + label + ': the card is not offered and nothing is asked', saved.length);
    await ctx.close();
  }
}
{
  // a trial whose 10 reports are used: the card stays, the stored reports reopen, and the page makes no new one
  const w = world({ used: 9 });
  const { ctx, page, reports } = await open({ w });
  await waitCount(page, /^1 free report left$/);
  await make(page);
  await waitCount(page, /0 free reports left|used/);
  await waitRows(page, 1);
  ok(w.used === 10 && await savedShown(page), '7n after the 10th report the card is still offered', w.used);
  await page.click('#saved-list button');
  await page.waitForFunction(() => /Saved report/.test(document.getElementById('saved-status').textContent), null, { timeout: 8000 }).catch(() => {});
  ok(/Saved report 1/.test(await text(page, '#saved-status')) && reports.length === 1 && w.used === 10, '7o a complete trial reopens a saved report and uses nothing', await text(page, '#saved-status'));
  await ctx.close();
}
{
  const w = world(); w.listFails = true;
  const { ctx, page } = await open({ w });
  await waitCount(page, /free reports left/);
  await page.waitForFunction(() => /could not be read/.test(document.getElementById('saved-status').textContent), null, { timeout: 8000 }).catch(() => {});
  ok(/could not be read just now/.test(await text(page, '#saved-status')) && (await rowsOf(page)).length === 0, '7p a list that cannot be read says so in plain words and shows no rows', await text(page, '#saved-status'));
  w.listFails = false;
  await ctx.close();
}
{
  const w = world();
  const { ctx, page } = await open({ w, width: 390, height: 844 });
  await waitCount(page, /free reports left/);
  await make(page);
  await waitRows(page, 1);
  const wide = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok(await savedShown(page) && wide <= 0, '7q on a 390 px screen the list is shown and the page does not scroll sideways', wide);
  await ctx.close();
}

// ---- 8. the header and "Your name on reports" (build step 7) -------------------------------------------------------------------------------
const profileShown = (page) => page.$eval('#profile', (e) => !e.hidden);
const whoLine = (page) => page.$eval('#report .da-rv-who', (e) => e.textContent.trim()).catch(() => null);
const labelLine = (page) => page.$eval('#report .da-rv-label', (e) => e.textContent.trim()).catch(() => null);
{
  const w = world();
  const { ctx, page, errors, foreign, reports } = await open({ w });
  await waitCount(page, /free reports left/);
  ok(await profileShown(page) && (await page.$eval('#agent-name', (e) => e.value)) === '' && /Your name on reports/.test(await text(page, '#profile-title')),
    '8a a trial member sees the "Your name on reports" card, with the box empty when they have given no name');
  await page.fill('#label', 'Smith buyers');
  await make(page);
  ok(await whoLine(page) === 'Acme Realty' && await labelLine(page) === 'Smith buyers' && reports[0].body.label === 'Smith buyers',
    '8b a report shows the brokerage\'s name from the account, and the client label the person typed, in its header (no name yet, so none is invented)', [await whoLine(page), await labelLine(page)]);
  await page.fill('#agent-name', '  Pat   Agent ');
  await page.click('#save-name');
  await page.waitForFunction(() => /^Saved/.test(document.getElementById('profile-status').textContent), null, { timeout: 8000 }).catch(() => {});
  const upd = await page.evaluate(() => window.__sb.updates);
  ok(upd.length === 1 && JSON.stringify(upd[0]) === '{"data":{"full_name":"Pat Agent"}}' && /^Saved/.test(await text(page, '#profile-status')),
    '8c saving sends ONE update to the sign-in account, with the name as one clean line and nothing else, and says it is saved', upd);
  ok((await page.$eval('#agent-name', (e) => e.value)) === 'Pat Agent', '8c2 and the box shows the cleaned name');
  await page.fill('#label', ''); // the second report is made with no client label
  await make(page, OTHER);
  ok(await whoLine(page) === 'Acme Realty · Pat Agent', '8d the next report\'s header carries the name', await whoLine(page));
  // reopening an earlier report: its header is the viewer\'s NOW, and its label is the one saved with it
  await page.waitForFunction(() => document.querySelectorAll('#saved-list button').length === 2, null, { timeout: 8000 }).catch(() => {});
  await page.click('#saved-list li:last-child button');
  await page.waitForFunction(() => /Saved report 1/.test(document.getElementById('saved-status').textContent), null, { timeout: 8000 }).catch(() => {});
  ok(await whoLine(page) === 'Acme Realty · Pat Agent' && await labelLine(page) === 'Smith buyers', '8e a reopened report shows the viewer\'s header and the client label saved with it', [await whoLine(page), await labelLine(page)]);
  await page.click('#saved-list li:first-child button');
  await page.waitForFunction(() => /Saved report 2/.test(document.getElementById('saved-status').textContent), null, { timeout: 8000 }).catch(() => {});
  ok(await whoLine(page) === 'Acme Realty · Pat Agent' && await labelLine(page) === null, '8e2 a report made with no client label shows none', await labelLine(page));
  ok((await page.evaluate(() => JSON.stringify(sessionStorage) + JSON.stringify(localStorage))).indexOf('Pat') === -1, '8f the name is kept in the sign-in account only: nothing about it is in the browser\'s storage');
  ok(errors.length === 0 && foreign.length === 0, '8g no page error, nothing foreign fetched', { errors, foreign });
  await ctx.close();
}
{
  // the name already on the account is filled in once, and a report being made never overwrites what is being typed
  const w = world(); w.header = { brokerage: 'Acme Realty', agent: 'Jo Agent' };
  const { ctx, page } = await open({ w, name: 'Jo Agent' });
  await waitCount(page, /free reports left/);
  ok((await page.$eval('#agent-name', (e) => e.value)) === 'Jo Agent', '8h the box starts with the name already on the person\'s account');
  await page.fill('#agent-name', 'Jo Q. Agent');
  await make(page);
  ok((await page.$eval('#agent-name', (e) => e.value)) === 'Jo Q. Agent' && await whoLine(page) === 'Acme Realty · Jo Agent',
    '8i making a report does not overwrite a name being typed, and the header uses the SAVED name until the person saves', [await page.$eval('#agent-name', (e) => e.value), await whoLine(page)]);
  await page.fill('#agent-name', '');
  await page.click('#save-name');
  await page.waitForFunction(() => /removed/.test(document.getElementById('profile-status').textContent), null, { timeout: 8000 }).catch(() => {});
  ok(JSON.stringify((await page.evaluate(() => window.__sb.updates))[0]) === '{"data":{"full_name":""}}' && /removed/.test(await text(page, '#profile-status')),
    '8j an empty box removes the name (an empty name is sent, which the server reads as none)');
  await make(page, OTHER);
  ok(await whoLine(page) === 'Acme Realty', '8j2 and the next report shows the brokerage alone', await whoLine(page));
  await ctx.close();
}
{
  // a name that cannot be saved, and one that is too long
  const w = world();
  const { ctx, page } = await open({ w });
  await waitCount(page, /free reports left/);
  await page.evaluate(() => { window.__sb.updateFails = true; });
  await page.fill('#agent-name', 'Pat Agent');
  await page.click('#save-name');
  await page.waitForFunction(() => /could not be saved/.test(document.getElementById('profile-status').textContent), null, { timeout: 8000 }).catch(() => {});
  ok(/could not be saved just now/.test(await text(page, '#profile-status')) && (await page.$eval('#profile-status', (e) => e.className)) === 'err' && (await page.$eval('#agent-name', (e) => e.value)) === 'Pat Agent',
    '8k a refused save says so in plain words and keeps what was typed');
  await page.evaluate(() => { window.__sb.updateFails = false; window.__sb.updates.length = 0; });
  await page.$eval('#agent-name', (e) => { e.maxLength = 1000; e.value = 'x'.repeat(81); });
  await page.click('#save-name');
  ok(/80 characters or fewer/.test(await text(page, '#profile-status')) && (await page.evaluate(() => window.__sb.updates.length)) === 0, '8l a name over 80 characters is refused by the page and nothing is sent');
  await ctx.close();
}
{
  // a header that cannot be read costs nothing and shows no report
  const w = world(); w.headerFails = true;
  const { ctx, page } = await open({ w });
  await waitCount(page, /free reports left/);
  await make(page);
  ok(w.used === 0 && (await page.$$('#report .da-rv-sec')).length === 0 && /could not be read just now/.test(await text(page, '#status')),
    '8m a header that cannot be read: no report, no free report used, and the page says the records could not be read', [w.used, await text(page, '#status')]);
  await ctx.close();
}
{
  // text is shown as text
  const w = world(); w.header = { brokerage: '<b>Acme</b> Realty', agent: '<img src=x onerror="window.__pwned=1">' };
  const { ctx, page } = await open({ w });
  await waitCount(page, /free reports left/);
  await make(page);
  const who = await page.evaluate(() => ({ text: (document.querySelector('#report .da-rv-who') || {}).textContent || '', imgs: document.querySelectorAll('#report .da-rv-who *').length, pwned: window.__pwned === 1 }));
  ok(who.text === '<b>Acme</b> Realty · <img src=x onerror="window.__pwned=1">' && who.imgs === 0 && !who.pwned, '8n a name and a brokerage with markup in them are printed as text, never run', who);
  await ctx.close();
}
{
  // who is offered the card: nobody without a trial, nobody signed out; and the box is emptied for the next person
  for (const [label, opts] of [['no trial', { trial: null }], ['an ended trial', { trial: 'revoked' }], ['an admin', { trial: null, admin: true }]]) {
    const { ctx, page } = await open({ w: world(opts), name: 'Pat Agent' });
    await settled(page);
    await page.waitForTimeout(300);
    ok(!(await profileShown(page)), '8o ' + label + ': the card is not offered', label);
    await ctx.close();
  }
  const { ctx, page } = await open({ w: world(), name: 'Pat Agent' });
  await waitCount(page, /free reports left/);
  ok(await profileShown(page) && (await page.$eval('#agent-name', (e) => e.value)) === 'Pat Agent', '8p (control) a trial member with a name on file sees the card with it filled in');
  await page.evaluate(() => window.__sb.listeners.forEach((cb) => cb('SIGNED_OUT', null)));
  await page.waitForTimeout(200);
  ok(!(await profileShown(page)) && (await page.$eval('#agent-name', (e) => e.value)) === '', '8q signing out hides the card and empties the box');
  await ctx.close();
  const o2 = await open({ w: world(), name: 'Pat Agent' });
  await waitCount(o2.page, /free reports left/);
  const swap = await o2.page.evaluate(() => {
    const other = { access_token: 'other-token', user: { id: 'b2222222-2222-4222-8222-222222222222', email: 'someone@example.test' } };
    window.__sb.session = other; window.__sb.listeners.forEach((cb) => cb('SIGNED_IN', other));
    return { hidden: document.getElementById('profile').hidden, value: document.getElementById('agent-name').value };
  });
  ok(swap.hidden && swap.value === '', '8r a different person signing in takes the card and the typed name away at once', swap);
  await o2.ctx.close();
}
{
  // a save still on its way when ANOTHER person signs in must not write its answer onto that person's page
  const { ctx, page } = await open({ w: world(), name: 'Pat Agent' });
  await waitCount(page, /free reports left/);
  await page.evaluate(() => { window.__sb.updateHold = true; });
  await page.fill('#agent-name', 'Pat Q. Agent');
  await page.click('#save-name');
  ok(/Saving/.test(await text(page, '#profile-status')) && (await page.$eval('#save-name', (e) => e.disabled)), '8t (control) while the answer is on its way the page says it is saving and the button waits');
  await page.evaluate(() => {
    const other = { access_token: 'other-token', user: { id: 'b2222222-2222-4222-8222-222222222222', email: 'someone@example.test' } };
    window.__sb.session = other; window.__sb.listeners.forEach((cb) => cb('SIGNED_IN', other));
  });
  await page.waitForTimeout(400); // let the new person's own sign-in finish (it clears the card), so a late write could not be wiped by it
  await page.evaluate(() => window.__sb.releaseUpdate());
  await page.waitForTimeout(200);
  const late =await page.evaluate(() => ({ hidden: document.getElementById('profile').hidden, status: document.getElementById('profile-status').textContent,
    value: document.getElementById('agent-name').value, waiting: document.getElementById('save-name').disabled }));
  ok(late.hidden && late.status === '' && late.value === '' && !late.waiting,
    '8t2 a late answer for the first person writes nothing onto the next person\'s page (no "Saved", no name in the box) and the button is free again', late);
  await ctx.close();
}
{
  const w = world();
  const { ctx, page } = await open({ w, width: 390, height: 844 });
  await waitCount(page, /free reports left/);
  await make(page);
  const wide = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok(await profileShown(page) && wide <= 0, '8s on a 390 px screen the card is shown and the page does not scroll sideways', wide);
  await ctx.close();
}

// ---- 9. sharing a saved report with a client, and saving it as a PDF (build step 8) -------------------------------------------------------
// The real manage-shared-report handler (and the real link form) behind a fake ledger. What is proved here is the PAGE: when it offers sharing,
// that it shows the link once and keeps it nowhere, that it withdraws a link, and that what it sends carries nothing the client must not
// see. Who may share, for how long and whether a link works are the database's, proved by test/report_share_delivery_pg.
const LINK = /^https:\/\/homesignal\.net\/shared-report\.html#share=[A-Za-z0-9_-]{43}$/;
const shareHidden = (page) => page.$eval('#share', (e) => e.hidden);
const shareList = (page) => page.$$eval('#share-list li', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
const waitShare = (page, re) => page.waitForFunction((src) => new RegExp(src).test(document.getElementById('share-status').textContent + ' ' + document.getElementById('share-list').textContent), re.source, { timeout: 8000 }).catch(() => {});
{
  const w = world();
  const { ctx, page, errors, shareCalls, foreign } = await open({ w });
  await waitCount(page, /free reports left/);
  ok(await shareHidden(page), '9a before any report, the share card is not shown');
  await make(page);
  ok(!(await shareHidden(page)) && /Share this report with your client/.test(await text(page, '#share-title')), '9b a report that was saved shows the share card');
  await waitShare(page, /No client link has been made/);
  const first = shareCalls[0];
  ok(first && first.body.action === 'list' && /^c0000000-/.test(first.body.report_id) && Object.keys(first.body).sort().join() === 'action,report_id' && first.auth === 'Bearer user-token',
    '9c the page asked for the report\'s links with the signed-in person\'s own token, naming the saved report and nothing else', first);
  ok(/6 months/.test(await text(page, '#share .sub')) && /street address/.test(await text(page, '#share .sub')) && /not your name, not your client label/.test(await text(page, '#share .sub')),
    '9d the card says in plain words what the client sees and for how long');

  await page.click('#share-make');
  await page.waitForFunction(() => !document.getElementById('share-new').hidden, null, { timeout: 8000 }).catch(() => {});
  const link = await page.$eval('#share-link', (e) => e.value);
  ok(LINK.test(link) && link === SR.shareLink(link.split('#share=')[1]), '9e the link is shown, in the one form the server makes (the page builds none of it)', link);
  const created = shareCalls.filter((c) => c.body.action === 'create');
  ok(created.length === 1 && Object.keys(created[0].body).sort().join() === 'action,report_id', '9f the create request names the report and nothing else: no address, no client label, no expiry, no token');
  ok(/only this once/.test(await text(page, '#share-note')) && /Anyone who has it can read this report/.test(await text(page, '#share-note')), '9g the page says the link is shown only once and that anyone who has it can read the report');
  await waitShare(page, /Working/);
  const rows = await shareList(page);
  ok(rows.length === 1 && /^Working · made / .test(rows[0]) && /works until April 3, 2027/.test(rows[0]) && /Withdraw$/.test(rows[0]), '9h the list shows the link as working, with when it was made and when it stops', rows);
  ok(!JSON.stringify(shareCalls).includes(link.split('#share=')[1]) && !(await page.evaluate(() => JSON.stringify(Object.assign({}, localStorage, sessionStorage)))).includes(link.split('#share=')[1]),
    '9i the token goes to the server nowhere and into browser storage nowhere');

  // a second link, then withdraw the first
  await page.click('#share-make');
  await page.waitForFunction(() => document.querySelectorAll('#share-list li').length === 2, null, { timeout: 8000 }).catch(() => {});
  ok((await shareList(page)).length === 2 && (await page.$eval('#share-link', (e) => e.value)) !== link, '9j a second link is a different link, and both are listed');
  await page.click('#share-list li:last-child button');
  await waitShare(page, /Withdrawn/);
  const after = await shareList(page);
  ok(after.some((r) => /^Withdrawn · made /.test(r) && !/Withdraw$/.test(r)) && after.some((r) => /^Working/.test(r)), '9k a withdrawn link is listed as withdrawn with no button; the other still works', after);
  ok(w.shares.filter((r) => r.status === 'REVOKED').length === 1 && (await page.$eval('#share-new', (e) => e.hidden)), '9l the server revoked exactly that one, and the page no longer shows the link');

  // the report's own bar: Compare (build step 10), Share and Watch are live and go to their cards, Download PDF is live and prints
  const bar = await page.$$eval('.da-rv-act', (els) => els.map((e) => ({ t: e.textContent, live: e.classList.contains('da-rv-act--live'), act: e.getAttribute('data-da-action'), disabled: e.getAttribute('aria-disabled') })));
  ok(JSON.stringify(bar.map((b) => b.t)) === JSON.stringify(['Compare property', 'Watch property', 'Share report', 'Download PDF'])
     && bar[0].live && bar[0].act === 'compare' && bar[0].disabled === null && bar[1].live && bar[1].act === 'watch' && bar[2].live && bar[2].act === 'share' && bar[3].live && bar[3].act === 'pdf',
    '9m the report\'s own bar has Compare (build step 10), Watch (build step 9), Share and Download PDF all live', bar);
  await page.evaluate(() => { window.__prints = 0; window.print = function(){ window.__prints++; }; });
  await page.click('.da-rv-act[data-da-action="pdf"]');
  await page.click('#share-pdf');
  ok((await page.evaluate(() => window.__prints)) === 2, '9n both Download PDF buttons open the browser\'s print window (no PDF is made on a server)');
  // the report's own Share button opens a popup that makes the private link and offers it right there (follow-up to build step 8, founder 2026-10-04)
  const createCount = () => shareCalls.filter((c) => c.body.action === 'create').length;
  const popState = () => page.evaluate(() => ({ open: !document.getElementById('share-pop').hidden, body: !document.getElementById('share-pop-body').hidden, link: document.getElementById('share-pop-link').value,
    focus: document.activeElement && document.activeElement.id, role: document.getElementById('share-pop').getAttribute('role'), modal: document.getElementById('share-pop').getAttribute('aria-modal'),
    msg: document.getElementById('share-pop-msg').textContent, msgErr: document.getElementById('share-pop-msg').classList.contains('err'), note: document.getElementById('share-pop-note').textContent,
    hrefs: [...document.querySelectorAll('#share-pop a')].map((a) => a.getAttribute('href')), html: document.getElementById('share-pop').innerHTML, native: !document.getElementById('share-pop-native').hidden,
    opener: document.activeElement && document.activeElement.getAttribute && document.activeElement.getAttribute('data-da-action') }));
  const addrTyped = await page.$eval('#addr', (e) => e.value);
  const c0 = createCount();
  await page.click('.da-rv-act[data-da-action="share"]');
  await page.waitForFunction(() => !document.getElementById('share-pop-body').hidden, null, { timeout: 8000 }).catch(() => {});
  const pop = await popState();
  ok(pop.open && pop.body && LINK.test(pop.link) && pop.link === (await page.$eval('#share-link', (e) => e.value)) && pop.role === 'dialog' && pop.modal === 'true' && pop.focus === 'share-pop-copy' && createCount() === c0 + 1,
    '9o the report\'s Share button opens a popup that made ONE client link and shows it, with focus on Copy', { c0, now: createCount(), pop: { ...pop, html: undefined } });
  const lastCreate = shareCalls.filter((c) => c.body.action === 'create').pop();
  ok(Object.keys(lastCreate.body).sort().join() === 'action,report_id', '9o2 the popup\'s create request names the report and nothing else (no address, no label)');
  const decoded = pop.hrefs.map((h) => decodeURIComponent((h.split('body=')[1] || h.split('text=')[1] || '')));
  ok(pop.hrefs.length === 3 && /^sms:/.test(pop.hrefs[0]) && /^mailto:/.test(pop.hrefs[1]) && /^https:\/\/wa\.me\//.test(pop.hrefs[2]) && decoded.every((d) => d.indexOf(pop.link) > -1),
    '9o3 it offers Text message, Email and WhatsApp, each carrying the same client link', pop.hrefs);
  ok(!/facebook|twitter|reddit|linkedin|bsky|nextdoor/i.test(pop.html + pop.hrefs.join(' ')) && !decoded.join(' ').includes(addrTyped.split(',')[0]), '9o4 no public network is offered, and the message names no street address');
  ok(/Anyone who has it can read this report/.test(pop.note) && /only this once/.test(pop.note), '9o5 the popup says anyone with the link can read the report and that the link is shown once', pop.note);
  // copy
  await page.evaluate(() => { window.__copied = null; Object.defineProperty(navigator, 'clipboard', { value: { writeText: (t) => { window.__copied = t; return Promise.resolve(); } }, configurable: true }); });
  await page.click('#share-pop-copy');
  await page.waitForFunction(() => document.getElementById('share-pop-copy').textContent === 'Copied', null, { timeout: 4000 }).catch(() => {});
  ok((await page.evaluate(() => window.__copied)) === pop.link && (await page.$eval('#share-pop-copy', (e) => e.textContent)) === 'Copied', '9o6 Copy link copies exactly the client link and says Copied');
  // keyboard: Tab stays inside the popup in both directions
  const inside = [];
  for (let i = 0; i < 14; i++) { await page.keyboard.press(i < 7 ? 'Tab' : 'Shift+Tab'); inside.push(await page.evaluate(() => document.getElementById('share-pop').contains(document.activeElement))); }
  ok(inside.every(Boolean), '9o7 Tab and Shift+Tab never leave the popup', inside);
  // Escape closes it and gives focus back to the Share button
  await page.keyboard.press('Escape');
  const afterEsc = await popState();
  ok(!afterEsc.open && afterEsc.opener === 'share', '9o8 Escape closes the popup and puts focus back on the report\'s Share button', { open: afterEsc.open, opener: afterEsc.opener });
  // pressing Share again re-opens the SAME link: no second link is made, and the card still holds the link
  await page.click('.da-rv-act[data-da-action="share"]');
  const again = await popState();
  ok(again.open && again.body && again.link === pop.link && createCount() === c0 + 1, '9o9 pressing Share again shows the same link and makes no second one', { c0, now: createCount() });
  // the phone's own share sheet is offered only where the browser has one
  ok(again.native === false, '9o10 without a share sheet in the browser the Share\u2026 button is not offered');
  await page.keyboard.press('Escape');
  await page.evaluate(() => { window.__shared = null; navigator.share = function (d) { window.__shared = d; return Promise.resolve(); }; });
  await page.click('.da-rv-act[data-da-action="share"]');
  await page.click('#share-pop-native');
  const shared = await page.evaluate(() => window.__shared);
  ok(shared && shared.url === pop.link && !JSON.stringify(shared).includes(addrTyped.split(',')[0]) && (await popState()).native, '9o11 with a share sheet in the browser, Share\u2026 hands it the client link and no address');
  // Close button and a click on the dimmed background both close it
  await page.click('#share-pop-close');
  const closed = await popState();
  await page.click('.da-rv-act[data-da-action="share"]');
  await page.mouse.click(4, 4);
  ok(!closed.open && !(await popState()).open, '9o12 the Close button and a click outside the box both close the popup');
  // print: the popup is never on the paper
  await page.click('.da-rv-act[data-da-action="share"]');
  await page.emulateMedia({ media: 'print' });
  const onPaper = await page.evaluate(() => document.getElementById('share-pop').getClientRects().length);
  await page.emulateMedia({ media: 'screen' });
  await page.keyboard.press('Escape');
  ok(onPaper === 0, '9o13 an open share popup takes no room in print', onPaper);
  // the old behaviour (scroll up to the card) is gone, but the card is still there to list and withdraw links
  ok(!(await shareHidden(page)) && (await shareList(page)).length >= 1, '9o14 the card above still lists the links, so one can still be withdrawn');

  // print: only the report goes on the paper
  await page.emulateMedia({ media: 'print' });
  const printed = await page.evaluate(() => {
    const shown = (sel) => { const e = document.querySelector(sel); return !!e && e.getClientRects().length > 0; }; // takes up room on the page (a child of a hidden card does not)
    return { report: shown('#report .da-rv'), head: shown('header.top'), share: shown('#share'), trial: shown('#trial'), status: shown('#status'), form: shown('#rf'),
      actions: shown('.da-rv-actions'), filters: shown('.da-rv-sec--filters'), saved: shown('#saved'), auth: shown('#auth-overlay') };
  });
  ok(printed.report && !printed.head && !printed.share && !printed.trial && !printed.status && !printed.form && !printed.actions && !printed.filters && !printed.saved && !printed.auth,
    '9p in print only the report is shown: no header, card, form, status, filter chips or action buttons', printed);
  await page.emulateMedia({ media: 'screen' });
  ok(errors.length === 0 && foreign.length === 0, '9q no page error, nothing foreign fetched', { errors, foreign });
  await ctx.close();
}
{
  // a report that was NOT saved ("No data ingested" uses nothing and is stored nowhere) cannot be shared, but can still be printed
  const w = world({ rights: RIGHTS_NONE });
  const { ctx, page, shareCalls } = await open({ w });
  await waitCount(page, /free reports left/);
  await make(page);
  ok(w.made.size === 0 && (await shareHidden(page)) && shareCalls.length === 0, '9r a report that was not saved gets no share card and makes no share request');
  const bar = await page.$$eval('.da-rv-act', (els) => els.map((e) => ({ live: e.classList.contains('da-rv-act--live'), act: e.getAttribute('data-da-action') })));
  ok(bar.length === 0 || (bar.every((b) => b.act !== 'share') && bar.filter((b) => b.live).every((b) => b.act === 'pdf')), '9s and its own bar offers no Share (Download PDF only, if the report has a bar at all)', bar);
  await ctx.close();
}
{
  // opening a saved report shows its card; another report, or another person, never inherits the link
  const w = world();
  const { ctx, page } = await open({ w });
  await waitCount(page, /free reports left/);
  await make(page);
  await page.click('#share-make');
  await page.waitForFunction(() => !document.getElementById('share-new').hidden, null, { timeout: 8000 }).catch(() => {});
  ok(LINK.test(await page.$eval('#share-link', (e) => e.value)), '9t (control) a link is on screen');
  await page.fill('#addr', OTHER);
  await page.click('#go');
  await page.waitForFunction(() => /Report ready|Making/.test(document.getElementById('status').textContent), null, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(300);
  ok((await page.$eval('#share-link', (e) => e.value)) === '' && (await page.$eval('#share-new', (e) => e.hidden)), '9u making the next report clears the previous report\'s link from the page');
  await page.click('#saved-list li:last-child button');
  await page.waitForFunction(() => /Saved report/.test(document.getElementById('saved-status').textContent), null, { timeout: 8000 }).catch(() => {});
  ok(!(await shareHidden(page)) && (await page.$eval('#share-link', (e) => e.value)) === '', '9v opening a saved report shows its card with no link on it (a link is never shown a second time)');
  await page.click('#share-make');
  await page.waitForFunction(() => !document.getElementById('share-new').hidden, null, { timeout: 8000 }).catch(() => {});
  await page.click('.da-rv-act[data-da-action="share"]');
  const openedBefore = await page.evaluate(() => !document.getElementById('share-pop').hidden && document.getElementById('share-pop-link').value !== '');
  await page.evaluate(() => { const o = window.__sb.session; window.__sb.session = null; window.__sb.listeners.forEach((cb) => cb('SIGNED_OUT', null)); void o; });
  await page.waitForTimeout(200);
  ok((await shareHidden(page)) && (await page.$eval('#share-link', (e) => e.value)) === '' && (await shareList(page)).length === 0, '9w signing out clears the card, the link and the list');
  ok(openedBefore && await page.evaluate(() => document.getElementById('share-pop').hidden && document.getElementById('share-pop-link').value === ''), '9w2 signing out with the share popup open closes it and leaves no link behind');
  await ctx.close();
}
{
  // the ways it can fail are said in plain words, and a failure never shows a link
  const w = world();
  const { ctx, page } = await open({ w });
  await waitCount(page, /free reports left/);
  await make(page);
  w.shareFails = true;
  await page.click('#share-make');
  await page.waitForFunction(() => /could not be done/.test(document.getElementById('share-status').textContent), null, { timeout: 8000 }).catch(() => {});
  ok(/Try again in a minute/.test(await text(page, '#share-status')) && (await page.$eval('#share-new', (e) => e.hidden)) && !(await page.$eval('#share-make', (e) => e.disabled)),
    '9x an unreachable service says so in plain words, shows no link, and leaves the button free');
  // the same failure reached through the report's own Share button is said inside the popup, not left behind in a card out of sight
  await page.click('#share-pop-close').catch(() => {});
  await page.click('.da-rv-act[data-da-action="share"]');
  await page.waitForFunction(() => /could not be done/.test(document.getElementById('share-pop-msg').textContent), null, { timeout: 8000 }).catch(() => {});
  const failPop = await page.evaluate(() => ({ open: !document.getElementById('share-pop').hidden, body: !document.getElementById('share-pop-body').hidden, msg: document.getElementById('share-pop-msg').textContent, err: document.getElementById('share-pop-msg').classList.contains('err'), link: document.getElementById('share-pop-link').value }));
  ok(failPop.open && !failPop.body && failPop.err && /Try again in a minute/.test(failPop.msg) && failPop.link === '', '9x2 when the link cannot be made the popup says so in plain words and shows no link', failPop);
  await page.click('#share-pop-close');
  w.shareFails = false; w.shareLimit = true;
  await page.click('#share-make');
  await page.waitForFunction(() => /most client links/.test(document.getElementById('share-status').textContent), null, { timeout: 8000 }).catch(() => {});
  ok(/most client links it can have/.test(await text(page, '#share-status')) && (await page.$eval('#share-new', (e) => e.hidden)), '9y a report at the most links it can have says so');
  await ctx.close();
}
{
  const w = world();
  const { ctx, page } = await open({ w, width: 390, height: 844 });
  await waitCount(page, /free reports left/);
  await make(page);
  await page.click('#share-make');
  await page.waitForFunction(() => !document.getElementById('share-new').hidden, null, { timeout: 8000 }).catch(() => {});
  const wide = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok(wide <= 0, '9z on a 390 px screen the share card, the link and the list do not scroll the page sideways', wide);
  // and the popup from the report's own Share button fits the phone: a sheet along the bottom, all inside the screen, every control easy to tap
  await page.click('.da-rv-act[data-da-action="share"]');
  await page.waitForFunction(() => !document.getElementById('share-pop-body').hidden, null, { timeout: 8000 }).catch(() => {});
  const ph = await page.evaluate(() => {
    const box = document.querySelector('#share-pop .box').getBoundingClientRect();
    const ctl = [...document.querySelectorAll('#share-pop button, #share-pop a.go')].filter((e) => e.getClientRects().length).map((e) => { const r = e.getBoundingClientRect(); return { id: e.id, h: Math.round(r.height), inside: r.left >= -0.5 && r.right <= innerWidth + 0.5 }; });
    return { box: { l: Math.round(box.left), r: Math.round(box.right), t: Math.round(box.top), b: Math.round(box.bottom) }, vw: innerWidth, vh: innerHeight, ctl, side: document.documentElement.scrollWidth - document.documentElement.clientWidth };
  });
  ok(ph.box.l >= 0 && ph.box.r <= ph.vw + 0.5 && ph.box.t >= 0 && ph.box.b <= ph.vh + 0.5 && ph.box.b >= ph.vh - 2 && ph.side <= 0 && ph.ctl.length >= 5 && ph.ctl.every((c) => c.inside && c.h >= 40),
    '9z2 on a 390 px screen the share popup is a sheet along the bottom, inside the screen, with every control at least 40 px tall and no sideways scroll', ph);
  await ctx.close();
}

// ---- 10. watching the property of a saved report (build step 9) -------------------------------------------------------------------------
// The real manage-property-watch handler behind a fake ledger. What is proved here is the PAGE: when it offers the watch, that it starts and
// stops exactly one watch for the report on screen, that it says in plain words how the last check went, that the address and the client label
// never go to the Watch function, and that another report or another person never inherits a watch. Who may watch, how many a brokerage may
// have and when a check runs are the database's, proved by test/property_watch_pg.
const watchHidden = (page) => page.$eval('#watch', (e) => e.hidden);
const watchButtons = (page) => page.evaluate(() => ({ start: !document.getElementById('watch-start').hidden, stop: !document.getElementById('watch-stop').hidden }));
const waitWatch = (page, re) => page.waitForFunction((src) => new RegExp(src).test(document.getElementById('watch-state').textContent + ' ' + document.getElementById('watch-status').textContent), re.source, { timeout: 8000 }).catch(() => {});
{
  const w = world();
  const { ctx, page, errors, watchCalls, foreign } = await open({ w });
  await waitCount(page, /free reports left/);
  ok(await watchHidden(page), '10a before any report, the Watch card is not shown');
  await make(page);
  ok(!(await watchHidden(page)) && /Watch this property/.test(await text(page, '#watch-title')), '10b a report that was saved shows the Watch card');
  await waitWatch(page, /not watching/);
  const first = watchCalls[0];
  ok(first && first.body.action === 'list' && Object.keys(first.body).join() === 'action' && first.auth === 'Bearer user-token',
    '10c the page first asked for the person\'s own watches, with their own token, and sent nothing else', first);
  const sub = await text(page, '#watch .sub');
  ok(/once a day/.test(sub) && /address you signed in with/.test(sub) && /does not include the property's address/.test(sub),
    '10d the card says in plain words how often it checks, where the email goes, and that the email leaves the address out', sub);
  ok(JSON.stringify(await watchButtons(page)) === JSON.stringify({ start: true, stop: false }) && /You are not watching this property/.test(await text(page, '#watch-state')),
    '10e not yet watching: "Watch this property" is offered, "Stop watching" is not, and the page says so');

  await page.click('#watch-start');
  await waitWatch(page, /You are watching this property, since/);
  const started = watchCalls.filter((c) => c.body.action === 'start');
  ok(started.length === 1 && Object.keys(started[0].body).sort().join() === 'action,report_id' && /^c0000000-/.test(started[0].body.report_id) && started[0].auth === 'Bearer user-token',
    '10f the start request names the saved report and nothing else', started);
  const st = await text(page, '#watch-state');
  ok(/You are watching this property, since October 3, 2026\./.test(st) && /The first check runs within a few minutes\./.test(st) && /Next check: October 3, 2026\./.test(st),
    '10g after the start the card says since when, that the first check is soon and when the next one is', st);
  ok(JSON.stringify(await watchButtons(page)) === JSON.stringify({ start: false, stop: true }) && w.watches.length === 1, '10h now "Stop watching" is offered and "Watch this property" is not; the server holds exactly one watch');
  ok(!JSON.stringify(watchCalls).includes('N Main St') && !(await text(page, '#watch')).includes('N Main St'), '10i neither the Watch requests nor the card carry the property\'s address');

  // every outcome, in plain words (the page reads the stored outcome; it decides none)
  const WORDS = { CHECKED: /Last checked October 3, 2026: nothing new\. Next check/, CHECKED_PARTIAL: /nothing new, but some official sources near the property could not be fully read/, NOTIFIED: /a change was found and emailed to you\./,
    READ_FAILED: /it could not be finished, so HomeSignal will try again\./, EMAIL_FAILED: /the email could not be sent, so HomeSignal will try again\./, NO_RECIPIENT: /your account has no email address to send it to\./ };
  let allWords = true; const seen = {};
  for (const [outcome, re] of Object.entries(WORDS)) {
    w.watches[0].last_run_at = '2026-10-03T15:00:00+00:00'; w.watches[0].last_outcome = outcome;
    await page.click('#saved-list button');
    await page.waitForFunction(() => /Saved report/.test(document.getElementById('saved-status').textContent), null, { timeout: 8000 }).catch(() => {});
    await waitWatch(page, /Last checked/);
    const t = await text(page, '#watch-state'); seen[outcome] = t;
    if (!re.test(t) || /The first check runs within a few minutes/.test(t)) allWords = false;
  }
  ok(allWords, '10j each of the six outcomes the database can record is told in its own plain words, and a watch that has been checked no longer says its first check is coming', seen);
  w.watches[0].last_run_at = null; w.watches[0].last_outcome = null;
  await page.click('#saved-list button');
  await waitWatch(page, /first check runs/);

  // the report's own bar: Watch is live and takes the person to the card
  await page.click('.da-rv-act[data-da-action="watch"]');
  ok(await page.evaluate(() => document.activeElement && document.activeElement.id) === 'watch-stop', '10k the report\'s own Watch button takes the person to the card (focus on "Stop watching" while it is on)');

  await page.click('#watch-stop');
  await waitWatch(page, /no longer watching/);
  await waitWatch(page, /You are not watching this property/); // the card is redrawn from the server's list after the stop answer
  const stopped = watchCalls.filter((c) => c.body.action === 'stop');
  ok(stopped.length === 1 && Object.keys(stopped[0].body).sort().join() === 'action,watch_id' && /^e0000000-/.test(stopped[0].body.watch_id) && w.watches.length === 0,
    '10l the stop request names the watch and nothing else; the server holds none', stopped);
  ok(JSON.stringify(await watchButtons(page)) === JSON.stringify({ start: true, stop: false }) && /You are not watching this property/.test(await text(page, '#watch-state')), '10m after the stop "Watch this property" is offered again and the card says it is off');
  await page.click('.da-rv-act[data-da-action="watch"]');
  ok(await page.evaluate(() => document.activeElement && document.activeElement.id) === 'watch-start', '10n and the report\'s Watch button now focuses "Watch this property"');

  // print: the card is left off the paper
  await page.emulateMedia({ media: 'print' });
  ok(await page.evaluate(() => { const e = document.getElementById('watch'); return e.getClientRects().length === 0; }), '10o in print the Watch card is not on the paper');
  await page.emulateMedia({ media: 'screen' });
  ok(errors.length === 0 && foreign.length === 0, '10p no page error, nothing foreign fetched', { errors, foreign });
  await ctx.close();
}
{
  // a report that was not saved cannot be watched
  const w = world({ rights: RIGHTS_NONE });
  const { ctx, page, watchCalls } = await open({ w });
  await waitCount(page, /free reports left/);
  await make(page);
  ok(w.made.size === 0 && (await watchHidden(page)) && watchCalls.length === 0, '10q a report that was not saved gets no Watch card and makes no Watch request');
  const bar = await page.$$eval('.da-rv-act', (els) => els.map((e) => ({ live: e.classList.contains('da-rv-act--live'), act: e.getAttribute('data-da-action') })));
  ok(bar.every((b) => b.act !== 'watch'), '10r and its own bar offers no Watch', bar);
  await ctx.close();
}
{
  // the ways it can fail are said in plain words; a refusal never leaves the card in a state the server did not give
  const w = world();
  const { ctx, page } = await open({ w });
  await waitCount(page, /free reports left/);
  await make(page);
  await waitWatch(page, /not watching/);
  w.watchFails = true;
  await page.click('#watch-start');
  await waitWatch(page, /could not be done/);
  ok(/Try again in a minute/.test(await text(page, '#watch-status')) && JSON.stringify(await watchButtons(page)) === JSON.stringify({ start: true, stop: false }) && !(await page.$eval('#watch-start', (e) => e.disabled)) && w.watches.length === 0,
    '10s an unreachable service says so in plain words, leaves the button free and starts nothing');
  w.watchFails = false; w.watchLimit = true;
  await page.click('#watch-start');
  await waitWatch(page, /most properties/);
  ok(/most properties it can/.test(await text(page, '#watch-status')) && w.watches.length === 0, '10t a brokerage at its limit is told so, plainly');
  w.watchLimit = false; w.watchNotKept = true;
  await page.click('#watch-start');
  await waitWatch(page, /no longer keeps/);
  ok(/no longer keeps this property.s address/.test(await text(page, '#watch-status')) && /Make a new report/.test(await text(page, '#watch-status')) && w.watches.length === 0, '10u a property whose address has been purged is told so, with what to do');
  w.watchNotKept = false;
  await page.click('#watch-start');
  await waitWatch(page, /You are watching this property, since/);
  w.watchFails = true;
  await page.click('#watch-stop');
  await waitWatch(page, /could not be done/);
  ok(w.watches.length === 1 && JSON.stringify(await watchButtons(page)) === JSON.stringify({ start: false, stop: true }) && !(await page.$eval('#watch-stop', (e) => e.disabled)),
    '10v a stop that fails leaves the watch on, says so, and leaves the button free');
  await ctx.close();
}
{
  // a list that cannot be read: starting is still offered (it does nothing twice), and the failure is said
  const w = world();
  const { ctx, page } = await open({ w });
  await waitCount(page, /free reports left/);
  w.watchListFails = true;
  await make(page);
  await waitWatch(page, /could not be done/);
  ok(JSON.stringify(await watchButtons(page)) === JSON.stringify({ start: true, stop: false }) && /Try again in a minute/.test(await text(page, '#watch-status')) && (await text(page, '#watch-state')) === '',
    '10w when the person\'s watches cannot be read the page says so, claims nothing about whether they are watching, and still offers to start');
  await ctx.close();
}
{
  // another report, and another person, never inherit a watch
  const w = world();
  const { ctx, page } = await open({ w });
  await waitCount(page, /free reports left/);
  await make(page);
  await page.click('#watch-start');
  await waitWatch(page, /You are watching this property, since/);
  await page.fill('#addr', OTHER);
  await page.click('#go');
  await page.waitForFunction(() => /Report ready|Making/.test(document.getElementById('status').textContent), null, { timeout: 8000 }).catch(() => {});
  await waitWatch(page, /not watching/);
  ok(JSON.stringify(await watchButtons(page)) === JSON.stringify({ start: true, stop: false }) && w.watches.length === 1, '10x a second report is not watched just because the first is: the card is about the report on screen');
  await page.evaluate(() => { window.__sb.session = null; window.__sb.listeners.forEach((cb) => cb('SIGNED_OUT', null)); });
  await page.waitForTimeout(200);
  ok((await watchHidden(page)) && (await text(page, '#watch-state')) === '' && (await text(page, '#watch-status')) === '', '10y signing out clears the card, its state and its message');
  await ctx.close();
}
{
  // a different person signing in on the same tab takes the card, its state and its message away at once
  const w = world();
  const { ctx, page } = await open({ w });
  await waitCount(page, /free reports left/);
  await make(page);
  await page.click('#watch-start');
  await waitWatch(page, /You are watching this property, since/);
  const swap = await page.evaluate(() => {
    const other = { access_token: 'other-token', user: { id: 'b2222222-2222-4222-8222-222222222222', email: 'someone@example.test' } };
    window.__sb.session = other; window.__sb.listeners.forEach((cb) => cb('SIGNED_IN', other));
    return { hidden: document.getElementById('watch').hidden, state: document.getElementById('watch-state').textContent, status: document.getElementById('watch-status').textContent,
      stop: !document.getElementById('watch-stop').hidden };
  });
  ok(swap.hidden && swap.state === '' && swap.status === '' && !swap.stop, '10y2 a different person signing in takes the Watch card and the first person\'s watch away at once', swap);
  await ctx.close();
}
{
  // a late answer for the report the person has since left is ignored: it must not paint a watch onto the report now on screen
  const w = world();
  const { ctx, page } = await open({ w });
  await waitCount(page, /free reports left/);
  w.holdNextWatchList = true;
  await make(page);                                   // report 1; its list is held on the server's side
  w.watches.push({ watch_id: 'e0000000-0000-4000-8000-0000000000aa', report_id: 'c0000000-0000-4000-8000-000000000001', created_at: '2026-10-03T12:00:00+00:00', last_run_at: null, last_outcome: null, next_due_at: '2026-10-03T12:00:00+00:00' });
  await make(page, OTHER);                            // report 2 comes on screen and is read at once
  await waitWatch(page, /not watching/);
  w.releaseWatchList();                               // the first answer, about report 1, arrives now
  await page.waitForTimeout(500);
  const late = await page.evaluate(() => ({ state: document.getElementById('watch-state').textContent, start: !document.getElementById('watch-start').hidden, stop: !document.getElementById('watch-stop').hidden }));
  ok(/not watching/.test(late.state) && late.start && !late.stop, '10y3 a late answer about the first report does not paint its watch onto the second report', late);
  await ctx.close();
}
{
  const w = world();
  const { ctx, page } = await open({ w, width: 390, height: 844 });
  await waitCount(page, /free reports left/);
  await make(page);
  await page.click('#watch-start');
  await waitWatch(page, /You are watching this property, since/);
  const wide = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok(wide <= 0, '10z on a 390 px screen the Watch card does not scroll the page sideways', wide);
  await ctx.close();
}

// ---- 11. build step 10: comparing saved reports side by side ------------------------------------------------------------------------------
const compareHidden = (page) => page.$eval('#compare', (e) => e.hidden);
const compareBoxes = (page) => page.$$eval('#compare-list input', (els) => els.map((e) => ({ checked: e.checked, disabled: e.disabled })));
const waitBoxes = (page, n) => page.waitForFunction((k) => document.querySelectorAll('#compare-list input').length === k, n, { timeout: 8000 }).catch(() => {});
const waitCompared = (page) => page.waitForFunction(() => document.querySelector('#compare-result .da-cmp') !== null || /could not|cannot|Choose|not made over|Sign in/.test(document.getElementById('compare-status').textContent), null, { timeout: 8000 }).catch(() => {});
const tableOf = (page) => page.evaluate(() => {
  const rows = [...document.querySelectorAll('#compare-result .da-cmp-table tbody tr')].filter((tr) => tr.querySelector('.da-cmp-rowh'));
  return {
    heads: [...document.querySelectorAll('#compare-result .da-cmp-table thead th')].slice(1).map((e) => e.textContent.trim()),
    legend: [...document.querySelectorAll('#compare-result .da-cmp-legend li')].map((e) => e.textContent.replace(/\s+/g, ' ').trim()),
    rows: rows.map((tr) => ({ label: tr.querySelector('.da-cmp-rowh').textContent.trim(), cells: [...tr.querySelectorAll('td .da-cmp-v')].map((e) => e.textContent.trim()) })),
  };
});
const rowCells = (t, label) => (t.rows.find((r) => r.label === label) || { cells: [] }).cells;
const A1 = '1 First Ave, Brigham City, UT 84302', A2 = '2 Second Ave, Brigham City, UT 84302', A3 = '3 Third Ave, Brigham City, UT 84302', A4 = '4 Fourth Ave, Brigham City, UT 84302', A5 = '5 Fifth Ave, Brigham City, UT 84302', A6 = '6 Sixth Ave, Brigham City, UT 84302';
const WNONE_REPORT = (await wire(RICH, { rights: RIGHTS_NONE })).report;   // the engine's report for an address where nothing is cleared: no records, "No data ingested"
{
  // before there are two reports there is nothing to compare, and the card says so
  const w = world();
  const { ctx, page, saved, foreign, errors } = await open({ w });
  await waitCount(page, /free reports left/);
  await page.waitForFunction(() => !document.getElementById('compare').hidden, null, { timeout: 8000 }).catch(() => {});
  ok(!(await compareHidden(page)) && /Comparing needs at least 2 saved reports/.test(await text(page, '#compare-status')) && (await page.$eval('#compare-go', (b) => b.disabled)),
    '11a with no saved report the card says comparing needs at least two, and the button is off', await text(page, '#compare-status'));
  await make(page, A1);
  await waitBoxes(page, 1);
  ok((await compareBoxes(page)).length === 1 && /needs at least 2/.test(await text(page, '#compare-status')) && (await page.$eval('#compare-go', (b) => b.disabled)), '11b with one saved report it still needs two');
  await ctx.close();
  const o = await open({ w: world(), signedIn: false });
  ok(await compareHidden(o.page), '11c signed out, the Compare card is not shown');
  await o.ctx.close();
}
{
  // three saved reports: the card lists them, two to five can be chosen, and comparing opens exactly the chosen ones
  const w = world();
  const { ctx, page, saved, reports, foreign, errors } = await open({ w });
  await waitCount(page, /free reports left/);
  await make(page, A1); await make(page, A2); await make(page, A3);
  await waitBoxes(page, 3);
  const labels = await page.$$eval('#compare-list label', (els) => els.map((e) => e.textContent.trim()));
  ok(labels.length === 3 && /^Report 3 · 3 Third Ave/.test(labels[0]) && /^Report 1 · 1 First Ave/.test(labels[2]), '11d the card lists the saved reports, newest first, each as "Report N · address · date"', labels);
  ok((await compareBoxes(page)).every((b) => !b.checked && !b.disabled) && (await page.$eval('#compare-go', (b) => b.disabled)) && /Choose 2 to 5 reports\./.test(await text(page, '#compare-count')), '11e nothing is ticked at first: the button is off and the count says to choose 2 to 5');
  await page.check('#compare-list li:nth-child(1) input');
  ok((await page.$eval('#compare-go', (b) => b.disabled)) && /1 report chosen\./.test(await text(page, '#compare-count')), '11f one chosen is not enough');
  await page.check('#compare-list li:nth-child(3) input');
  ok(!(await page.$eval('#compare-go', (b) => b.disabled)) && /2 reports chosen\./.test(await text(page, '#compare-count')), '11g two chosen turns the button on');
  const usedBefore = w.used, madeBefore = reports.length, listsBefore = saved.length;
  await page.check('#compare-list li:nth-child(2) input');
  await page.click('#compare-go');
  await waitCompared(page);
  const opens = saved.slice(listsBefore).filter((c) => c.body && c.body.action === 'open');
  ok(opens.length === 3 && opens.every((c) => c.auth === 'Bearer user-token' && Object.keys(c.body).sort().join() === 'action,report_id' && /^[0-9a-f-]{36}$/.test(c.body.report_id)), '11h comparing opens exactly the three chosen saved reports, each with the person\'s own token and nothing in the request but the action and the report id', opens.map((c) => c.body));
  ok(reports.length === madeBefore && w.used === usedBefore && /^7 free reports left$/.test(await text(page, '#trial-count')), '11i it made no report and used no free report: the count is still 7', [reports.length, w.used, await text(page, '#trial-count')]);
  ok(/Compared 3 saved reports\. Opening them did not use a free report\./.test(await text(page, '#compare-status')), '11j the card says it compared three and that opening them used no free report');
  const t = await tableOf(page);
  ok(t.heads.join() === 'Report 3,Report 2,Report 1', '11k the columns are in the saved list\'s order, newest first, not the order they were ticked', t.heads);
  ok(/20 N Main St|3 THIRD AVE/i.test(t.legend[0]) && /Report 3/.test(t.legend[0]) && t.legend.length === 3 && !t.heads.some((h) => /Ave/.test(h)), '11l the list says which address is which report, and the column headings are only "Report N"', t.legend);
  // the numbers equal what each report shows when it is opened on its own (same report rules, in the real page)
  const own = [];
  for (const num of [3, 2, 1]) {
    await page.click('#saved-list li:nth-child(' + (4 - num) + ') button');
    await page.waitForFunction((k) => new RegExp('Saved report ' + k).test(document.getElementById('saved-status').textContent), num, { timeout: 8000 }).catch(() => {});
    own.push(await page.evaluate(() => { const m = /On the record within 0\.5 miles: (\d+) permitted \/ under construction · (\d+) approved \/ coming · (\d+) proposed \/ under review\./.exec(document.getElementById('report').textContent.replace(/\s+/g, ' ')); return m ? [m[1], m[2], m[3]] : null; }));
  }
  ok(own.every((o2) => o2 && o2.join() === '0,2,4') && [0, 1, 2].every((i) => rowCells(t, 'Permitted / Under Construction')[i] === own[i][0] && rowCells(t, 'Approved / Coming')[i] === own[i][1] && rowCells(t, 'Proposed / Under Review')[i] === own[i][2]),
    '11m each column\'s stage counts are exactly what that report prints for itself when opened on its own (0 / 2 / 4)', [own, rowCells(t, 'Approved / Coming')]);
  ok(foreign.length === 0 && errors.length === 0, '11n no page error, and nothing fetched but the page, its libraries, the sign-in stand-in and the functions', { foreign, errors });
  await ctx.close();
}
{
  // 11p. the SAME day in the saved list and in the comparison: a report made at 8 PM Mountain on Oct 4 is 02:00 UTC on Oct 5, and the
  // comparison used to say "Oct 5" while the list said "October 4"
  const w = world(); w.generatedAt = '2026-10-05T02:00:00+00:00';
  const { ctx, page } = await open({ w, tz: 'America/Denver' });
  await waitCount(page, /free reports left/);
  await make(page, A1); await make(page, A2);
  await waitBoxes(page, 2);
  const listed = await page.$$eval('#compare-list label', (els) => els.map((e) => e.textContent.trim()));
  await page.check('#compare-list li:nth-child(1) input'); await page.check('#compare-list li:nth-child(2) input');
  await page.click('#compare-go');
  await waitCompared(page);
  const t2 = await tableOf(page);
  ok(listed.length === 2 && listed.every((x) => /October 4, 2026$/.test(x)) && t2.legend.length === 2 && t2.legend.every((x) => /Made Oct 4, 2026$/.test(x)),
    '11p2 a report made on the evening of Oct 4 (Mountain) is Oct 4 in BOTH the saved list and the comparison\'s "Made" line', [listed, t2.legend]);
  await ctx.close();
}
{
  // the limit: five may be chosen and no sixth; a changed choice clears the old comparison
  const w = world();
  const { ctx, page } = await open({ w });
  await waitCount(page, /free reports left/);
  for (const a of [A1, A2, A3, A4, A5, A6]) await make(page, a);
  await waitBoxes(page, 6);
  for (let i = 1; i <= 5; i++) await page.check('#compare-list li:nth-child(' + i + ') input');
  let boxes = await compareBoxes(page);
  ok(boxes.filter((b) => b.checked).length === 5 && boxes[5].disabled && !boxes[5].checked && !(await page.$eval('#compare-go', (b) => b.disabled)) && /5 reports chosen\./.test(await text(page, '#compare-count')),
    '11o with five chosen the sixth cannot be ticked, and five is enough to compare', boxes);
  await page.click('#compare-go');
  await waitCompared(page);
  let t = await tableOf(page);
  ok(t.heads.length === 5 && t.rows.length === 13 && t.rows.every((r) => r.cells.length === 5), '11p five reports compare: five columns and thirteen rows', [t.heads, t.rows.length]);
  await page.uncheck('#compare-list li:nth-child(1) input');
  ok((await page.$$('#compare-result .da-cmp')).length === 0 && (await text(page, '#compare-status')) === '' && !(await compareBoxes(page))[5].disabled, '11q changing the choice clears the comparison, so it never sits beside a different choice, and frees the sixth box');
  await ctx.close();
}
{
  // a column that cannot say what is nearby says so; it is never a zero
  const w = world();
  const { ctx, page } = await open({ w });
  await waitCount(page, /free reports left/);
  await make(page, A1); await make(page, A2);
  const keys = [...w.made.keys()];
  w.made.get(keys[0]).report = clone(WNONE_REPORT);                   // report 1 is stored as the engine saves a report with no data ingested
  await waitBoxes(page, 2);
  await page.check('#compare-list li:nth-child(1) input'); await page.check('#compare-list li:nth-child(2) input');
  await page.click('#compare-go');
  await waitCompared(page);
  const t = await tableOf(page);
  ok(['Records with a recent official event', 'Permitted / Under Construction', 'Approved / Coming', 'Proposed / Under Review'].every((l) => rowCells(t, l)[1] === 'No data ingested' && rowCells(t, l)[0] !== 'No data ingested'),
    '11r the report with "No data ingested" says so in every count cell and is not a zero; the report beside it still has its numbers', t.rows.map((r) => r.label + '=' + r.cells.join('/')));
  const notes = await page.$eval('#compare-result', (e) => e.textContent.replace(/\s+/g, ' '));
  ok(/No data ingested\. HomeSignal cannot yet confirm it receives official development records for this address/.test(notes), '11s the engine\'s own words for it appear under the table');
  await ctx.close();
}
{
  // refusals: a report that cannot be found, and reports made over different distances. Nothing partial is drawn.
  const w = world();
  const { ctx, page } = await open({ w });
  await waitCount(page, /free reports left/);
  await make(page, A1); await make(page, A2); await make(page, A3);
  await waitBoxes(page, 3);
  for (let i = 1; i <= 3; i++) await page.check('#compare-list li:nth-child(' + i + ') input');
  const keys = [...w.made.keys()];
  const gone = w.made.get(keys[1]);
  w.made.delete(keys[1]);                                              // report 2 is no longer there when the page asks for it
  await page.click('#compare-go');
  await waitCompared(page);
  ok(/could not be found/.test(await text(page, '#compare-status')) && (await page.$$('#compare-result .da-cmp')).length === 0, '11t if one of the chosen reports cannot be found the page says so in plain words and draws no partial comparison', await text(page, '#compare-status'));
  w.made.set(keys[1], gone);
  w.made.get(keys[2]).report = { ...clone(w.made.get(keys[2]).report), radius_mi: 1 };
  await page.click('#compare-go');
  await waitCompared(page);
  ok(/not made over the same distance/.test(await text(page, '#compare-status')) && (await page.$$('#compare-result .da-cmp')).length === 0, '11u reports made over different distances are refused in plain words and nothing is drawn', await text(page, '#compare-status'));
  ok(!(await page.$eval('#compare-go', (b) => b.disabled)), '11u2 and the button is free to try again');
  await ctx.close();
}
{
  // the report's own "Compare property" button adds the report on screen to the choice
  const w = world();
  const { ctx, page } = await open({ w });
  await waitCount(page, /free reports left/);
  await make(page, A1); await make(page, A2);
  await waitBoxes(page, 2);
  const btn = await page.$$eval('.da-rv-act', (els) => els.map((e) => ({ act: e.getAttribute('data-da-action'), live: e.classList.contains('da-rv-act--live'), label: e.textContent.trim() })));
  ok(btn.some((b) => b.act === 'compare' && b.live && b.label === 'Compare property'), '11v on a saved report the "Compare property" button is live', btn);
  await page.click('.da-rv-act[data-da-action="compare"]');
  const boxes = await compareBoxes(page);
  ok(boxes.filter((b) => b.checked).length === 1 && boxes[0].checked && /1 report chosen\./.test(await text(page, '#compare-count')) && (await page.evaluate(() => document.activeElement && document.activeElement.closest('#compare-list') !== null)),
    '11w pressing it ticks the report on screen (the newest, report 2) and moves to the card; it compares nothing by itself', boxes);
  ok((await page.$$('#compare-result .da-cmp')).length === 0, '11w2 ... and no comparison is drawn until the person asks for one');
  await ctx.close();
}
{
  // another person, signing out, and a late answer: nothing of one person's reports is left for the next
  const w = world();
  const { ctx, page } = await open({ w });
  await waitCount(page, /free reports left/);
  await make(page, A1); await make(page, A2);
  await waitBoxes(page, 2);
  await page.check('#compare-list li:nth-child(1) input'); await page.check('#compare-list li:nth-child(2) input');
  await page.click('#compare-go');
  await waitCompared(page);
  ok((await page.$$('#compare-result .da-cmp')).length === 1, '11x a comparison is on screen');
  await page.evaluate(() => { window.__sb.session = null; window.__sb.listeners.forEach((cb) => cb('SIGNED_OUT', null)); });
  await page.waitForTimeout(200);
  const out = await page.evaluate(() => ({ hidden: document.getElementById('compare').hidden, list: document.querySelectorAll('#compare-list li').length, result: document.getElementById('compare-result').textContent.trim(), status: document.getElementById('compare-status').textContent, count: document.getElementById('compare-count').textContent, go: document.getElementById('compare-go').disabled }));
  ok(out.hidden && out.list === 0 && out.result === '' && out.status === '' && out.count === '' && out.go, '11y signing out hides the card and takes the list, the comparison and the messages away', out);
  await ctx.close();
}
{
  const w = world();
  const { ctx, page } = await open({ w });
  await waitCount(page, /free reports left/);
  await make(page, A1); await make(page, A2);
  await waitBoxes(page, 2);
  await page.check('#compare-list li:nth-child(1) input'); await page.check('#compare-list li:nth-child(2) input');
  await page.click('#compare-go');
  await waitCompared(page);
  const swap = await page.evaluate(() => {
    const other = { access_token: 'other-token', user: { id: 'b2222222-2222-4222-8222-222222222222', email: 'someone@example.test' } };
    window.__sb.session = other; window.__sb.listeners.forEach((cb) => cb('SIGNED_IN', other));
    return { hidden: document.getElementById('compare').hidden, list: document.querySelectorAll('#compare-list li').length, result: document.getElementById('compare-result').textContent.trim() };
  });
  ok(swap.hidden && swap.list === 0 && swap.result === '', '11z a different person signing in takes the first person\'s list and comparison away at once', swap);
  await ctx.close();
}
{
  // a late answer for a person who has since signed out is dropped: it must not paint a comparison for nobody
  const w = world();
  const { ctx, page } = await open({ w });
  await waitCount(page, /free reports left/);
  await make(page, A1); await make(page, A2);
  await waitBoxes(page, 2);
  await page.check('#compare-list li:nth-child(1) input'); await page.check('#compare-list li:nth-child(2) input');
  w.holdNextOpen = true;
  await page.click('#compare-go');
  await page.waitForFunction(() => /Opening 2 saved reports/.test(document.getElementById('compare-status').textContent), null, { timeout: 8000 }).catch(() => {});
  ok(await page.$eval('#compare-go', (b) => b.disabled), '11z2 while the reports are being opened the button is off, so a second press cannot start a second comparison');
  await page.evaluate(() => { window.__sb.session = null; window.__sb.listeners.forEach((cb) => cb('SIGNED_OUT', null)); });
  await page.waitForTimeout(150);
  w.releaseOpen();
  await page.waitForTimeout(500);
  const late = await page.evaluate(() => ({ hidden: document.getElementById('compare').hidden, result: document.getElementById('compare-result').innerHTML.trim(), status: document.getElementById('compare-status').textContent }));
  ok(late.hidden && late.result === '' && late.status === '', '11z3 an answer that arrives after sign-out paints nothing', late);
  await ctx.close();
}
{
  // a phone: five reports side by side never scroll the page sideways, and each cell says which report it is
  const w = world();
  const { ctx, page } = await open({ w, width: 390, height: 844 });
  await waitCount(page, /free reports left/);
  for (const a of [A1, A2, A3, A4, A5]) await make(page, a);
  await waitBoxes(page, 5);
  for (let i = 1; i <= 5; i++) await page.check('#compare-list li:nth-child(' + i + ') input');
  await page.click('#compare-go');
  await waitCompared(page);
  const m = await page.evaluate(() => {
    const cell = document.querySelector('#compare-result .da-cmp-table tbody td .da-cmp-r');
    const th = document.querySelector('#compare-result .da-cmp-table thead');
    return { wide: document.documentElement.scrollWidth - document.documentElement.clientWidth, tag: getComputedStyle(cell).display, head: getComputedStyle(th).position, tableDisplay: getComputedStyle(document.querySelector('#compare-result .da-cmp-table')).display };
  });
  ok(m.wide <= 0 && m.tag !== 'none' && m.head === 'absolute' && m.tableDisplay === 'block', '11z4 on a 390 px screen the comparison stacks (each cell starts with its report number) and the page does not scroll sideways', m);
  await ctx.close();
  const d = await open({ w: world() });
  await waitCount(d.page, /free reports left/);
  await make(d.page, A1); await make(d.page, A2);
  await waitBoxes(d.page, 2);
  await d.page.check('#compare-list li:nth-child(1) input'); await d.page.check('#compare-list li:nth-child(2) input');
  await d.page.click('#compare-go');
  await waitCompared(d.page);
  const desk = await d.page.evaluate(() => ({ tag: getComputedStyle(document.querySelector('#compare-result .da-cmp-table tbody td .da-cmp-r')).display, tableDisplay: getComputedStyle(document.querySelector('#compare-result .da-cmp-table')).display, wide: document.documentElement.scrollWidth - document.documentElement.clientWidth }));
  ok(desk.tag === 'none' && desk.tableDisplay === 'table' && desk.wide <= 0, '11z5 on a wide screen it is a real table with the report numbers in the column headings', desk);
  await d.ctx.close();
}

{
  // the report's own Compare button is live on a REOPENED saved report too, and not only on a report just made
  const w = world();
  const { ctx, page } = await open({ w });
  await waitCount(page, /free reports left/);
  await make(page, A1); await make(page, A2);
  await waitBoxes(page, 2);
  await page.click('#saved-list button');
  await page.waitForFunction(() => /Saved report/.test(document.getElementById('saved-status').textContent), null, { timeout: 8000 }).catch(() => {});
  const btn = await page.$$eval('.da-rv-act', (els) => els.map((e) => ({ act: e.getAttribute('data-da-action'), live: e.classList.contains('da-rv-act--live') })));
  ok(/Saved report/.test(await text(page, '#saved-status')) && btn.some((b) => b.act === 'compare' && b.live), '11z6 on a REOPENED saved report the "Compare property" button is live too', btn);
  await ctx.close();
}
{
  // a saved list that cannot be read empties the card's list and says so; it never leaves a stale list to compare
  const w = world();
  const { ctx, page } = await open({ w });
  await waitCount(page, /free reports left/);
  await make(page, A1); await make(page, A2);
  await waitBoxes(page, 2);
  ok(!(await compareHidden(page)), '11z7a with two saved reports the card is on screen');
  w.listFails = true;
  await make(page, A3);
  await page.waitForFunction(() => /could not be read/.test(document.getElementById('saved-status').textContent), null, { timeout: 8000 }).catch(() => {});
  w.listFails = false;
  ok((await compareBoxes(page)).length === 0 && (await page.$eval('#compare-go', (b) => b.disabled)) && /saved reports could not be read just now/.test(await text(page, '#compare-status')),
    '11z7 when the saved list cannot be read the card holds no stale list to compare, the button is off, and it says so in plain words', [(await compareBoxes(page)).length, await text(page, '#compare-status')]);
  await ctx.close();
}
{
  // a report that comes back but is not a report the page can show is never compared (the same answer as one that cannot be found)
  const w = world();
  const { ctx, page } = await open({ w });
  await waitCount(page, /free reports left/);
  await make(page, A1); await make(page, A2);
  await waitBoxes(page, 2);
  await page.check('#compare-list li:nth-child(1) input'); await page.check('#compare-list li:nth-child(2) input');
  const keys = [...w.made.keys()];
  w.made.get(keys[0]).report = { not: 'a report' };
  await page.click('#compare-go');
  await waitCompared(page);
  const said = await text(page, '#compare-status');
  ok(/could not be opened just now/.test(said) && (await page.$$('#compare-result .da-cmp')).length === 0, '11z8 a saved report that is not a report the page can show is refused in plain words and nothing is drawn', said);
  await ctx.close();
}

// ---- 12. build step 11: the Billing card, the plan and the $79/month checkout ---------------------------------------------------------------------
// The billing function and the report function are answered by their REAL handlers on a fake database whose plan is the world's: the page's own
// requests are validated by the real code. Nothing here pays anything: the provider's page is a stand-in that only records that the browser was sent.
const billingText = (page) => page.$eval('#billing', (e) => e.textContent.replace(/\s+/g, ' ').trim());
const billingShown = (page) => page.$eval('#billing', (e) => !e.hidden);
const waitBilling = (page, re) => page.waitForFunction((src) => { var b = document.getElementById('billing'); return !b.hidden && new RegExp(src).test(b.textContent); }, re.source, { timeout: 8000 }).catch(() => {});
const BKID = 'b0b0b0b0-1111-4222-8333-444444444444';
{
  // 12a-12d. an owner with no plan: the offer in the landing page's own words, one status call, and a checkout that goes to the provider only
  const w = world({ role: 'owner', used: 3 });
  const { ctx, page, errors, foreign, billingCalls, checkouts } = await open({ w });
  await waitBilling(page, /Free trial/);
  const t = await billingText(page);
  ok(await billingShown(page) && /Billing/.test(t) && /Free trial/.test(t) && /\$79\/month gives your brokerage 100 new reports each month\. Cancel anytime\./.test(t) && /10 free reports are separate from the plan/.test(t),
    '12a an owner with no plan sees the Billing card: the free trial, and the $79/month offer in the landing page\'s own words (100 new reports each month, cancel anytime)', t);
  ok(billingCalls.length === 1 && billingCalls[0].body.action === 'status' && billingCalls[0].auth === 'Bearer user-token' && JSON.stringify(billingCalls[0].body) === '{"action":"status"}',
    '12b the plan is read with ONE status call carrying the person\'s own token and nothing else', billingCalls.map((c) => c.body));
  ok(await page.$eval('#subscribe', (e) => !e.hidden && /^Subscribe for \$79\/month$/.test(e.textContent.trim())), '12c the owner is offered "Subscribe for $79/month"');
  ok(!(await page.content()).includes(BKID) && !(await page.evaluate(() => document.body.innerText)).includes(BKID), '12c2 the brokerage\'s id is nowhere on the page');
  await page.click('#subscribe');
  await page.waitForFunction(() => /checkout/i.test(document.title), null, { timeout: 8000 }).catch(() => {});
  ok(w.checkoutMade === 1 && checkouts.length === 1 && checkouts[0] === CHECKOUT_URL && page.url().startsWith('https://homesignal.lemonsqueezy.com/'),
    '12d pressing it asks for ONE checkout and sends the browser to the provider\'s own page (nothing is charged and no plan changes by pressing it)', [w.checkoutMade, checkouts, page.url()]);
  ok(billingCalls.length === 2 && JSON.stringify(billingCalls[1].body) === '{"action":"checkout"}', '12d2 the checkout request carries no brokerage id, no price and no address: the server knows whose it is', billingCalls.map((c) => c.body));
  ok(foreign.length === 0 && errors.length === 0, '12d3 nothing else was fetched and the page raised no error', [foreign, errors]);
  await ctx.close();
}
{
  // 12e-12h. an agent, a processor that is not set up, a refusal, and a lost answer
  let o = await open({ w: world({ role: 'agent' }) });
  await waitBilling(o.page, /Free trial/);
  ok(await o.page.$eval('#subscribe', (e) => e.hidden) && /Only your brokerage's owner can subscribe\./.test(await billingText(o.page)), '12e an agent is told only the owner can subscribe and is offered no button');
  ok(o.billingCalls.length === 1, '12e2 and makes no checkout call');
  await o.page.evaluate(() => document.getElementById('subscribe').click()); // the hidden button pressed anyway, by a script
  await settled(o.page);
  ok(o.billingCalls.length === 1 && o.checkouts.length === 0, '12e3 and a checkout forced through the hidden button still asks for nothing: the page checks the role itself, not only the button');
  await o.ctx.close();

  o = await open({ w: world({ role: 'owner', configured: false }) });
  await waitBilling(o.page, /Free trial/);
  ok(await o.page.$eval('#subscribe', (e) => !e.hidden && e.disabled && /^Subscribe for \$79\/month$/.test(e.textContent.trim())) && /Subscribing is not open yet\./.test(await billingText(o.page)) && (await text(o.page, '#trial-count')).length > 0,
    '12f with the processor not set up the owner SEES the Subscribe button, disabled, beside "Subscribing is not open yet" (and the free trial still works)');
  await o.page.evaluate(() => document.getElementById('subscribe').click()); // a script presses the disabled button anyway
  await settled(o.page);
  ok(o.checkouts.length === 0 && o.billingCalls.length === 1, '12f2 pressing it asks for nothing: no checkout is requested while the processor is not set up');
  await o.ctx.close();

  const w = world({ role: 'owner' });
  o = await open({ w });
  await waitBilling(o.page, /Free trial/);
  w.checkoutFails = true;
  await o.page.click('#subscribe');
  await o.page.waitForFunction(() => /could not be opened/.test(document.getElementById('billing-status').textContent), null, { timeout: 8000 }).catch(() => {});
  ok(/The payment page could not be opened just now/.test(await text(o.page, '#billing-status')) && await o.page.$eval('#billing-status', (e) => e.className === 'err') && o.checkouts.length === 0 && !o.page.url().includes('lemonsqueezy'),
    '12g a provider that cannot give a checkout is said in plain words, and the browser is not sent anywhere');
  ok(await o.page.$eval('#subscribe', (e) => !e.disabled && !e.hidden), '12g2 the button is usable again, so a retry is one press');
  await o.ctx.close();

  // the server's own answer is a foreign or unsafe address: the page refuses it as well (the server checks it too)
  const w2 = world({ role: 'owner' });
  o = await open({ w: w2 });
  await waitBilling(o.page, /Free trial/);
  let forced = '';
  await o.page.route(BILLING_FN, async (route) => { const r = route.request(); const b = r.postData() ? JSON.parse(r.postData()) : {}; if (b.action === 'checkout') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'OK', url: forced }) }); return route.fallback(); });
  for (const bad of ['https://evil.example/pay', 'http://checkout.lemonsqueezy.com/pay', 'https://user:pw@checkout.lemonsqueezy.com/pay', 'https://lemonsqueezy.com.evil.example/pay']) {
    forced = bad;
    await o.page.evaluate(() => { document.getElementById('billing-status').textContent = ''; });
    await o.page.click('#subscribe');
    await o.page.waitForFunction(() => /could not be opened/.test(document.getElementById('billing-status').textContent), null, { timeout: 8000 }).catch(() => {});
    ok(o.page.url().startsWith(base) && !o.page.url().includes('evil') && !o.page.url().includes('lemonsqueezy') && /could not be opened/.test(await text(o.page, '#billing-status')),
      '12h an address that is not the provider\'s own, or is not plain https, or carries credentials, is never opened: the page checks it too and says the payment page could not be opened (' + bad + ')');
  }
  await o.ctx.close();
}
{
  // 12i-12m. a paid brokerage: the month's reports, whose number the page shows and never works out
  const w = world({ role: 'owner', used: 10, plan: 'paid', paidUsed: 3 });
  const { ctx, page, reports, errors, foreign } = await open({ w });
  await waitCount(page, /reports left this month/);
  ok(/^97 reports left this month$/.test(await text(page, '#trial-count')) && /100 new reports each month/.test(await text(page, '#trial-sub')) && /this month ends November 4, 2026/.test(await text(page, '#trial-sub')),
    '12i a brokerage whose free reports are used and whose plan is paid is told how many of the month\'s reports are left and when the month ends', [await text(page, '#trial-count'), await text(page, '#trial-sub')]);
  const t = await billingText(page);
  ok(/\$79\/month plan: 3 of 100 reports used this month/.test(t) && /kept as they were/.test(t) && await page.$eval('#subscribe', (e) => e.hidden), '12j the Billing card shows the plan, the month\'s figures, and no second checkout');
  ok(await page.$eval('#go', (e) => !e.disabled), '12k "Make report" is open: the free trial is complete but the plan is paid');
  await make(page);
  ok(reports.length === 1 && V4.test(reports[0].body.idempotency_key), '12k2 a report made on the paid plan carries a random key, like every member report', reports.map((r) => r.body));
  ok(w.paidUsed === 4 && w.used === 10 && /^96 reports left this month$/.test(await text(page, '#trial-count')) && /used 1 of your brokerage’s 100 reports this month/.test(await text(page, '#creditnote')),
    '12l the report used one of the MONTH\'s (4 used, 96 left), the 10 free ones are untouched, and the page says which it used', [w.paidUsed, w.used, await text(page, '#trial-count'), await text(page, '#creditnote')]);
  ok(/\$79\/month plan: 4 of 100 reports used this month/.test(await billingText(page)), '12l2 the Billing card follows the report, from the database\'s own answer');
  // a retry of a finished paid report
  ok(foreign.length === 0 && errors.length === 0, '12m nothing else was fetched and the page raised no error', [foreign, errors]);
  await ctx.close();
}
{
  // 12n-12o. a paid month that is used up
  const w = world({ role: 'owner', used: 10, plan: 'paid', paidUsed: 100 });
  const { ctx, page, reports } = await open({ w });
  await waitCount(page, /All 100 reports for this month are used/);
  ok(/All 100 reports for this month are used/.test(await text(page, '#trial-count')) && await page.$eval('#trial-count', (e) => e.className === 'count out') && /November 4, 2026/.test(await text(page, '#trial-sub')),
    '12n a month whose 100 reports are used says so, and says when the next month starts');
  ok(await page.$eval('#go', (e) => e.disabled), '12n2 "Make report" is off');
  await page.fill('#addr', ADDRESS);
  await page.evaluate(() => document.getElementById('rf').requestSubmit());
  await page.waitForFunction(() => /used/.test(document.getElementById('status').textContent), null, { timeout: 8000 }).catch(() => {});
  ok(reports.length === 0 && /All 100 of your brokerage's reports for this month are used/.test(await text(page, '#status')), '12o pressing it anyway sends NO report request and says why', reports.length);
  await ctx.close();
}
{
  // 12p-12s. a plan that is not paid never opens a used-up trial, and says what is wrong in plain words
  for (const [state, card, buy] of [['past_due', /Your subscription needs attention/, false], ['canceled', /Your subscription has ended/, true], ['unknown', /Your subscription status is not clear/, false],
    ['trialing', /Your subscription status is not clear/, false], ['test_only', /Test subscription only/, true]]) {
    const w = world({ role: 'owner', used: 10, plan: state });
    const { ctx, page, reports } = await open({ w });
    await waitBilling(page, card);
    ok(card.test(await billingText(page)) && await page.$eval('#go', (e) => e.disabled) && (await page.$eval('#subscribe', (e) => !e.hidden)) === buy && /All 10 free reports are used/.test(await text(page, '#trial-count')) && reports.length === 0,
      '12p a ' + state + ' plan on a used-up trial: the card says so, "Make report" stays off, and the checkout is ' + (buy ? 'offered (a new subscription is what is needed)' : 'NOT offered (a second one would bill twice)'), [await billingText(page), buy]);
    await ctx.close();
  }
  const w = world({ role: 'owner', used: 10, plan: 'canceled' });
  const { ctx, page } = await open({ w });
  await waitBilling(page, /ended/);
  ok(await page.$eval('#subscribe', (e) => /^Subscribe again for \$79\/month$/.test(e.textContent.trim())), '12q a brokerage whose subscription ended is offered "Subscribe again for $79/month"');
  await ctx.close();
}
{
  // 12t-12v. the plan cannot be read, Check again, and a different person
  const w = world({ role: 'owner', used: 3 });
  w.billingFails = true;
  const { ctx, page, billingCalls } = await open({ w });
  await waitBilling(page, /could not be read/);
  ok(/Your plan could not be read just now/.test(await billingText(page)) && await page.$eval('#subscribe', (e) => e.hidden), '12t a plan that cannot be read says so and offers no checkout (never "paid", never "free")');
  w.billingFails = false;
  await page.click('#billing-refresh');
  await waitBilling(page, /Free trial/);
  ok(/Free trial/.test(await billingText(page)) && await page.$eval('#subscribe', (e) => !e.hidden), '12u "Check again" asks again and the card follows', billingCalls.map((c) => c.body));
  // the provider has confirmed a payment: the page learns it only by asking
  w.plan = 'paid'; w.paidUsed = 0; w.used = 10;
  await page.click('#billing-refresh');
  await waitBilling(page, /\$79\/month plan/);
  ok(/\$79\/month plan: 0 of 100 reports used this month/.test(await billingText(page)) && /^100 reports left this month$/.test(await text(page, '#trial-count')) && await page.$eval('#go', (e) => !e.disabled),
    '12u2 once the database says the plan is paid, "Check again" shows it, and "Make report" opens: the page changed nothing until it was told');
  // the plan can no longer be read: the card says so and forgets the plan it showed (never the old figures)
  w.billingFails = true;
  await page.click('#billing-refresh');
  await waitBilling(page, /could not be read/);
  ok(/Your plan could not be read just now/.test(await billingText(page)) && !/\$79\/month plan: /.test(await page.$eval('#billing-plan', (e) => e.textContent)) && await page.$eval('#subscribe', (e) => e.hidden),
    '12u3 when the plan can no longer be read the card says so and forgets the plan it showed (never the old figures, never "paid")');
  w.billingFails = false;
  await page.click('#billing-refresh');
  await waitBilling(page, /\$79\/month plan/);
  await page.evaluate(() => window.__sb.listeners.forEach((cb) => cb('SIGNED_OUT', null)));
  await page.evaluate(() => { window.__sb.session = null; });
  await page.evaluate(() => window.__sb.listeners.forEach((cb) => cb('SIGNED_OUT', null)));
  await page.waitForFunction(() => document.getElementById('billing').hidden, null, { timeout: 8000 }).catch(() => {});
  ok(await page.$eval('#billing', (e) => e.hidden) && (await billingText(page)).includes('Billing') && !/\$79\/month plan|3 of 100|0 of 100/.test(await page.$eval('#billing-plan', (e) => e.textContent)),
    '12v signing out hides the Billing card and forgets the plan, so it is never left for the next person');
  await ctx.close();
}
{
  // 12v2. a different person signing in on the same tab: the first person's plan is gone in the same moment
  const w = world({ role: 'owner', used: 10, plan: 'paid', paidUsed: 3 });
  const { ctx, page } = await open({ w });
  await waitBilling(page, /\$79\/month plan/);
  const swap = await page.evaluate(() => {
    const other = { access_token: 'other-token', user: { id: 'b2222222-2222-4222-8222-222222222222', email: 'someone@example.test' } };
    window.__sb.session = other; window.__sb.listeners.forEach((cb) => cb('SIGNED_IN', other));
    return { hidden: document.getElementById('billing').hidden, plan: document.getElementById('billing-plan').textContent, sub: document.getElementById('billing-sub').textContent, buy: document.getElementById('subscribe').hidden };
  });
  ok(swap.hidden && swap.plan === '' && swap.sub === '' && swap.buy, '12v2 a different person signing in takes the first person\'s plan away at once, so it is never left for the next person', swap);
  await ctx.close();
}
{
  // 12w. not a member: no billing card at all
  for (const [what, w] of [['an account with no trial', world({ trial: null })], ['an admin', world({ admin: true })], ['a revoked trial', world({ trial: 'revoked' })]]) {
    const { ctx, page, billingCalls } = await open({ w });
    await settled(page);
    ok(!(await billingShown(page)) && billingCalls.length === 0, '12w ' + what + ' has no Billing card and makes no billing call', [billingCalls.length]);
    await ctx.close();
  }
  // a phone
  const { ctx, page } = await open({ w: world({ role: 'owner', used: 3 }), width: 390, height: 844 });
  await waitBilling(page, /Free trial/);
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), '12x at 390 px wide the page with the Billing card does not scroll sideways');
  await ctx.close();
}

await browser.close();
server.close();
console.log('\n' + (total - fails) + ' passed, ' + fails + ' failed of ' + total);
process.exit(fails ? 1 : 0);
