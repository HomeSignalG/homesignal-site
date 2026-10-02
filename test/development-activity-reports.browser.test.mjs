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
//   * it fits a 390 px screen; nothing else is fetched; no page error.
// Run: node test/development-activity-reports.browser.test.mjs
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, normalize } from 'node:path';
import { RICH, RIGHTS_SHIPPED, RIGHTS_AB, NOW } from './lib/da-report-view-world.mjs';

const RH = await import('../supabase/functions/get-development-activity-report/handler.ts');
const TH = await import('../supabase/functions/development-activity-trial/handler.ts');
const E = await import('../supabase/functions/_shared/evaluation-reads.ts');

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0, total = 0;
const ok = (c, name, detail) => {
  total++;
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name);
  if (!c) { fails++; if (detail !== undefined) console.log('           detail: ' + JSON.stringify(detail).slice(0, 600)); }
};

const PAGE = '/development-activity-reports.html';
const SB = 'https://qwnnmljucajnexpxdgxr.supabase.co/functions/v1/';
const REPORT_FN = SB + 'get-development-activity-report', TRIAL_FN = SB + 'development-activity-trial';
const ADDRESS = '742 Evergreen Terrace, Springfield, OR 97477', OTHER = '744 Evergreen Terrace, Springfield, OR 97477';
const TOKEN = 'hse1_' + '0123456789abcdef'.repeat(4);
const UID = 'a1111111-1111-4111-8111-111111111111';
const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// supabase-js stand-in. window.__sb.session is the signed-in session, or null; verifyOtp signs in and tells every listener. Like the real
// library, subscribing reports the current session once more (INITIAL_SESSION), so the page hears of one session twice on load.
const SESSION = "{ access_token: 'user-token', user: { id: '" + UID + "', email: 'agent@example.test' } }";
const SB_STUB = (signedIn) => `
window.__sb = { session: ${signedIn ? SESSION : 'null'}, listeners: [], otp: [] };
window.supabase = { createClient: function () { return { auth: {
  getSession: function () { return Promise.resolve({ data: { session: window.__sb.session } }); },
  onAuthStateChange: function (cb) { window.__sb.listeners.push(cb); setTimeout(function () { cb('INITIAL_SESSION', window.__sb.session); }, 0);
    return { data: { subscription: { unsubscribe: function () {} } } }; },
  signInWithOtp: function (a) { window.__sb.otp.push(a); return Promise.resolve({ error: null }); },
  verifyOtp: function () { window.__sb.session = ${SESSION};
    window.__sb.listeners.forEach(function (cb) { cb('SIGNED_IN', window.__sb.session); }); return Promise.resolve({ error: null }); },
  signOut: function () { window.__sb.session = null; window.__sb.listeners.forEach(function (cb) { cb('SIGNED_OUT', null); }); return Promise.resolve({}); }
} }; } };`;

/** The world behind both functions for one page: the trial's state and a fake ledger. */
function world({ trial = 'active', used = 0, admin = false, rights = RIGHTS_AB, redeem = 'ok' } = {}) {
  const w = { used, trial, admin, rights, redeem, made: new Map(), redeemed: 0 };
  const state = () => (w.trial === null ? null : { status: w.used >= 20 ? 'complete' : w.trial, credits_used: w.used, credits_remaining: 20 - w.used, expired: false });
  const gate = { authenticate: async (t) => (t === 'user-token' ? { email: 'agent@example.test', id: UID } : null), isAdmin: async () => w.admin };
  w.trialHandler = TH.makeHandler({
    ...gate,
    trialOf: async () => state(),
    redeemInvite: async (token) => {
      if (w.redeem === 'unusable' || token !== TOKEN) throw new E.InviteUnusable('x');
      w.redeemed++; if (w.trial === null) w.trial = 'active';
      return { role: 'agent', replayed: w.redeemed > 1 };
    },
  });
  const credit = () => ({ ordinal: w.used, credits_used: w.used, credits_remaining: 20 - w.used, evaluation_status: w.used >= 20 ? 'complete' : 'active' });
  w.reportHandler = RH.makeHandler({
    ...gate, now: () => NOW, rights: w.rights,
    geocode: async (a) => ({ matchedAddress: a.toUpperCase(), lat: 44.04612, lng: -122.98123, zip: '97477' }),
    zipSupported: async () => true,
    radius: async () => RICH.rows, hydrate: async () => RICH.projects, ledger: async () => RICH.ledger ?? [], events: async () => RICH.events ?? [], health: async () => [],
    trialOf: async () => state(),
    issue: async (_u, key, intelligence) => {
      const prior = w.made.get(key);
      if (prior) return { replayed: true, report_id: prior.id, generated_at: NOW.toISOString(), private_context_id: 'ctx-' + key, credit: credit() };
      w.used++;
      const id = 'r0000000-0000-4000-8000-' + String(w.used).padStart(12, '0');
      w.made.set(key, { id, address: w.lastAddress, report: intelligence });
      return { replayed: false, report_id: id, content_hash: 'h', report_version: 'v', generated_at: NOW.toISOString(), private_context_id: 'ctx-' + key, report: intelligence, credit: credit() };
    },
    contextMatches: async (ctx, address) => { const m = w.made.get(ctx.slice(4)); return m && m.address === address ? 'match' : 'mismatch'; },
    storedReport: async (id) => { for (const m of w.made.values()) if (m.id === id) return JSON.stringify(m.report); return null; },
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
async function open({ w = world(), signedIn = true, hash = '', width = 1280, height = 900, lose = () => false } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height } });
  const page = await ctx.newPage();
  const errors = [], reports = [], trials = [], foreign = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
  await page.route('**/*', async (route) => {
    const r = route.request(), url = r.url();
    if (url.startsWith(base)) return route.continue();
    if (url.startsWith('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2')) return route.fulfill({ status: 200, contentType: 'text/javascript', body: SB_STUB(signedIn) });
    if (url === REPORT_FN || url === TRIAL_FN) {
      const body = r.postData() ? JSON.parse(r.postData()) : null;
      const rec = { auth: r.headers().authorization || null, apikey: r.headers().apikey || null, body };
      (url === REPORT_FN ? reports : trials).push(rec);
      if (url === REPORT_FN) w.lastAddress = body && body.address;
      const res = await (url === REPORT_FN ? w.reportHandler : w.trialHandler)(new Request(url, { method: 'POST', headers: { authorization: rec.auth || '', 'content-type': 'application/json' }, body: r.postData() }));
      const answer = await res.text();
      if (url === REPORT_FN && lose(body)) return route.abort(); // the server did the work (and charged); only its answer is lost
      return route.fulfill({ status: res.status, contentType: 'application/json', body: answer });
    }
    foreign.push(url); return route.abort();
  });
  TRIALS.set(page, trials);
  await page.goto(base + PAGE + hash, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__sb && window.__sb.listeners.length > 0);
  return { ctx, page, errors, reports, trials, foreign, w };
}
const text = (page, sel) => page.$eval(sel, (e) => e.textContent.trim());
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
  const { ctx, page, errors, trials, foreign } = await open({ w, signedIn: false, hash: '#invite=' + TOKEN });
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
  ok(w.redeemed === 1 && /^20 free reports left$/.test(await text(page, '#trial-count')) && /joined/.test(await text(page, '#trial-sub')),
    '1e the panel says the person joined and has 20 free reports left', [await text(page, '#trial-count'), await text(page, '#trial-sub')]);
  ok((await page.evaluate(() => sessionStorage.getItem('hs-da-invite'))) === null, '1f the per-tab invite slot is emptied once the invite has been used');
  ok(!(await page.$eval('#go', (b) => b.disabled)), '1g "Make report" is offered');
  ok(errors.length === 0 && foreign.length === 0, '1h no page error, and nothing fetched but the page, its libraries, the sign-in stand-in and the two functions', { errors, foreign });
  await ctx.close();
}

// ---- 2. a report that uses a free report, and one that does not -------------------------------------------------------------------------
{
  const w = world({ used: 3 });
  const { ctx, page, errors, reports, foreign } = await open({ w });
  await waitCount(page, /^17 free reports left$/);
  ok(/^17 free reports left$/.test(await text(page, '#trial-count')), '2a signed in, the panel reads the trial: 17 left');
  await page.waitForTimeout(200);
  ok(trialsOf(page).length === 1, '2a2 the trial is read once, though the sign-in library reports the session twice on load (getSession and INITIAL_SESSION)', trialsOf(page).length);
  await make(page);
  ok(reports.length === 1 && reports[0].auth === 'Bearer user-token' && V4.test(reports[0].body.idempotency_key || '')
     && JSON.stringify(Object.keys(reports[0].body).sort()) === '["address","idempotency_key","view"]' && reports[0].body.view === 'customer',
    '2b one request, with the person\'s token, the customer view and a random v4 key, and nothing else', reports.map((r) => r.body));
  ok(w.used === 4 && (await page.$$('#report .da-rv-sec')).length > 0 && /used 1 of your brokerage/.test(await text(page, '#creditnote')),
    '2c a report that shows development is drawn and says it used one free report', await text(page, '#creditnote'));
  ok(/^16 free reports left$/.test(await text(page, '#trial-count')), '2d the panel now says 16 left, from the report function\'s own count');
  // a fresh world with nothing cleared: a "No data ingested" report
  await ctx.close();
  const w2 = world({ used: 4, rights: RIGHTS_SHIPPED });
  const o2 = await open({ w: w2 });
  await waitCount(o2.page, /^16 free reports left$/);
  await make(o2.page);
  ok(w2.used === 4 && /did not use a free report: No data ingested/.test(await text(o2.page, '#creditnote')) && /^16 free reports left$/.test(await text(o2.page, '#trial-count')),
    '2e a "No data ingested" report says it used nothing, and the count stays', [await text(o2.page, '#creditnote'), await text(o2.page, '#trial-count')]);
  ok(errors.length === 0 && o2.errors.length === 0 && foreign.length === 0 && o2.foreign.length === 0, '2f no page error, nothing foreign fetched', { errors, e2: o2.errors });
  await o2.ctx.close();
}

// ---- 3. a lost answer is retried with the same key, and is not charged twice -------------------------------------------------------------
{
  const w = world({ used: 0 });
  let lost = 0;
  const { ctx, page, reports } = await open({ w, lose: () => lost++ === 0 }); // the server charges the first request, but its answer never arrives
  await waitCount(page, /^20 free reports left$/);
  await make(page);
  ok(/could not be reached/.test(await text(page, '#status')) && /will not use a second free report/.test(await text(page, '#status')),
    '3a a lost answer says so, and says pressing again will not use a second free report');
  await page.click('#go');
  await page.waitForFunction(() => document.querySelectorAll('#report .da-rv-sec').length > 0, null, { timeout: 8000 }).catch(() => {});
  ok(reports.length === 2 && reports[0].body.idempotency_key === reports[1].body.idempotency_key, '3b pressing again for the same address resends the SAME key', reports.map((r) => r.body.idempotency_key));
  ok(w.used === 1 && /the report you already made for this address/.test(await text(page, '#creditnote')) && /did not use another/.test(await text(page, '#creditnote'))
     && /^19 free reports left$/.test(await text(page, '#trial-count')),
    '3c the server had already charged the first request: the retry gets that same report, says it used no second one, and 19 are left', [w.used, await text(page, '#creditnote')]);
  await make(page, OTHER);
  ok(reports.length === 3 && reports[2].body.idempotency_key !== reports[1].body.idempotency_key && V4.test(reports[2].body.idempotency_key) && w.used === 2,
    '3d a new address gets a new key, and is a new report');
  await make(page, OTHER);
  ok(reports.length === 4 && reports[3].body.idempotency_key !== reports[2].body.idempotency_key && w.used === 3,
    '3e once an answer arrived, asking again is a new report with a new key (the page never reuses a finished key)');
  await ctx.close();
}

// ---- 4. who may make reports, in plain words -----------------------------------------------------------------------------------------------
for (const [label, w, count, disabled] of [
  ['a used-up trial', world({ used: 20 }), /All 20 free reports are used/, true],
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
  const w = world({ used: 19 });
  const { ctx, page } = await open({ w });
  await waitCount(page, /^1 free report left$/);
  await make(page);
  ok(w.used === 20 && /All 20 free reports are used/.test(await text(page, '#trial-count')) && (await page.$eval('#go', (b) => b.disabled)) && (await page.$$('#report .da-rv-sec')).length > 0,
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

await browser.close();
server.close();
console.log('\n' + (total - fails) + ' passed, ' + fails + ' failed of ' + total);
process.exit(fails ? 1 : 0);
