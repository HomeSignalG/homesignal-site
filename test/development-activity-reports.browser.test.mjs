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
function world({ trial = 'active', used = 0, admin = false, rights = RIGHTS_AB, redeem = 'ok', role = 'agent', mint = 'ok' } = {}) {
  const w = { used, trial, admin, rights, redeem, role, mint, made: new Map(), redeemed: 0, minted: 0, header: { brokerage: 'Acme Realty', agent: null }, headerFails: false };
  const state = () => (w.trial === null ? null : { status: w.used >= 20 ? 'complete' : w.trial, credits_used: w.used, credits_remaining: 20 - w.used, expired: false });
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
  const credit = () => ({ ordinal: w.used, credits_used: w.used, credits_remaining: 20 - w.used, evaluation_status: w.used >= 20 ? 'complete' : 'active' });
  w.reportHandler = RH.makeHandler({
    ...gate, now: () => NOW, rights: w.rights,
    geocode: async (a) => ({ matchedAddress: a.toUpperCase(), lat: 44.04612, lng: -122.98123, zip: '97477' }),
    zipSupported: async () => true,
    radius: async () => RICH.rows, hydrate: async () => RICH.projects, ledger: async () => RICH.ledger ?? [], events: async () => RICH.events ?? [], health: async () => [],
    trialOf: async () => state(),
    issue: async (_u, key, intelligence, privateContext) => {
      const prior = w.made.get(key);
      if (prior) return { replayed: true, report_id: prior.id, generated_at: NOW.toISOString(), private_context_id: 'ctx-' + key, credit: credit() };
      w.used++;
      const id = 'c0000000-0000-4000-8000-' + String(w.used).padStart(12, '0');
      w.made.set(key, { id, address: w.lastAddress, label: (privateContext && privateContext.label) || null, report: intelligence });
      return { replayed: false, report_id: id, content_hash: 'h', report_version: 'v', generated_at: NOW.toISOString(), private_context_id: 'ctx-' + key, report: intelligence, credit: credit() };
    },
    contextMatches: async (ctx, address) => { const m = w.made.get(ctx.slice(4)); return m && m.address === address ? 'match' : 'mismatch'; },
    storedReport: async (id) => { for (const m of w.made.values()) if (m.id === id) return JSON.stringify(m.report); return null; },
    // saved reports (build step 6): the stored reports of this brokerage, newest first; the database shows nothing without standing
    savedReports: async () => {
      if (w.trial !== 'active' && w.used < 20) return [];
      const rows = [...w.made.entries()].map(([key, m], i) => ({ report_id: m.id, number: i + 1, generated_at: '2026-10-02T12:00:00+00:00', private_context_id: 'ctx-' + key }));
      return w.listFails ? (() => { throw new RH.DataUnavailable('x'); })() : rows.reverse();
    },
    openSavedReport: async (_u, id) => {
      if (w.trial !== 'active' && w.used < 20) return null;
      let n = 0;
      for (const [key, m] of w.made.entries()) { n++; if (m.id === id) return { report_id: m.id, number: n, generated_at: '2026-10-02T12:00:00+00:00', private_context_id: 'ctx-' + key, body: JSON.stringify(m.report) }; }
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
async function open({ w = world(), signedIn = true, hash = '', width = 1280, height = 900, lose = () => false, loseInvite = () => false, name = '' } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height } });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
  const page = await ctx.newPage();
  await page.exposeFunction('__hsNameSaved', (v) => { w.header = { ...w.header, agent: E.cleanDisplayName(v, 80) }; }); // the server reads the saved name from the account
  const errors = [], reports = [], trials = [], foreign = [], saved = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
  await page.route('**/*', async (route) => {
    const r = route.request(), url = r.url();
    if (url.startsWith(base)) return route.continue();
    if (url.startsWith('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2')) return route.fulfill({ status: 200, contentType: 'text/javascript', body: SB_STUB(signedIn, name) });
    if (url === REPORT_FN || url === TRIAL_FN) {
      const body = r.postData() ? JSON.parse(r.postData()) : null;
      const rec = { auth: r.headers().authorization || null, apikey: r.headers().apikey || null, body };
      // a saved-reports read (build step 6) is not a report request: it is kept apart so "one request per report" stays checkable
      (url === REPORT_FN ? (body && body.action ? saved : reports) : trials).push(rec);
      if (url === REPORT_FN) w.lastAddress = body && body.address;
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
  return { ctx, page, errors, reports, trials, foreign, saved, w };
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

// ---- 6. an owner invites an agent (build step 5e) ---------------------------------------------------------------------------------------
const teamShown = (page) => page.$eval('#team', (e) => !e.hidden && e.getBoundingClientRect().height > 0);
for (const [label, w, count] of [
  ['an agent', world({ role: 'agent' }), /free reports left/],
  ['an admin', world({ trial: null, admin: true }), /HomeSignal admin/],
  ['a person with no trial', world({ trial: null, role: 'owner' }), /not part of a trial/],
  ['an owner of a used-up trial', world({ role: 'owner', used: 20 }), /All 20 free reports are used/],
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
  await waitCount(page, /^18 free reports left$/);
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
  const w = world({ role: 'owner', used: 19 });
  const { ctx, page } = await open({ w });
  await waitCount(page, /^1 free report left$/);
  ok(await teamShown(page), '6n an owner with one report left is offered the card');
  await make(page);
  ok(w.used === 20 && !(await teamShown(page)), '6o using the last free report takes the card away (no agent could make a report)');
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
const ADDRESS_2 = '1600 Pennsylvania Ave NW, Washington, DC 20500';
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
  // a trial whose 20 reports are used: the card stays, the stored reports reopen, and the page makes no new one
  const w = world({ used: 19 });
  const { ctx, page, reports } = await open({ w });
  await waitCount(page, /^1 free report left$/);
  await make(page);
  await waitCount(page, /0 free reports left|used/);
  await waitRows(page, 1);
  ok(w.used === 20 && await savedShown(page), '7n after the 20th report the card is still offered', w.used);
  await page.click('#saved-list button');
  await page.waitForFunction(() => /Saved report/.test(document.getElementById('saved-status').textContent), null, { timeout: 8000 }).catch(() => {});
  ok(/Saved report 1/.test(await text(page, '#saved-status')) && reports.length === 1 && w.used === 20, '7o a complete trial reopens a saved report and uses nothing', await text(page, '#saved-status'));
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

await browser.close();
server.close();
console.log('\n' + (total - fails) + ' passed, ' + fails + ' failed of ' + total);
process.exit(fails ? 1 : 0);
