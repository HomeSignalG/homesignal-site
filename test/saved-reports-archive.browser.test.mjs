// SAVED REPORTS: REMOVE FROM MY LIST (docs/saved-reports-archive.sql), driven in a real browser against the real page.
//
// The page is answered by the REAL report-function handler (validation, gate, the list / archive / restore / open actions) and the REAL trial, billing, share
// and watch handlers, over an in-memory world that holds what the database would: two brokerages, three people, stored reports made through the handler's own
// issue path, and a PER-PERSON archive set whose rules are the SQL's (the SQL itself is proven in test/saved_reports_archive_pg and, end to end through the
// real handler, in test/trial_report_pg). Two browser contexts are two devices: nothing is shared between them but the world.
// What it proves:
//   1  a row shows its number, address and date; opening still works; a three-dot menu per row, named for its report; the menu does not open the report
//   2  removing ONE: nothing changes (and nothing is announced) until the server answers; then the row leaves, "Removed from Saved Reports." and Undo appear;
//      a second device sees the removal; Undo puts the report back in its own place with its own number
//   3  rapid repeated clicks send ONE request; a server failure shows no success and changes nothing
//   4  Manage: checkboxes, "Select all shown", a count; Remove selected asks first with the exact number; the request carries exactly the chosen ids
//   5  a search narrows the selection; Cancel changes nothing
//   6  View archived: only archived reports, Restore, the empty states, the original number back
//   7  two people in one brokerage keep separate lists; a removed member and an expired session are handled in words
//   8  the free-report figure never moves; no request is a report request; shares and watches are untouched
//   9  keyboard and screen-reader behaviour; the menu is not clipped by the scrolling list; desktop and phone layout
// Run: node test/saved-reports-archive.browser.test.mjs
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from './lib/serve-page.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, normalize } from 'node:path';
import { mkdirSync } from 'node:fs';
import { RICH, RIGHTS_AB, NOW } from './lib/da-report-view-world.mjs';
import { LAUNCH_TEST_LOCATION, geocodeStandIn } from './lib/launch-test-location.mjs';

const RH = await import('../supabase/functions/get-development-activity-report/handler.ts');
const TH = await import('../supabase/functions/development-activity-trial/handler.ts');
const E = await import('../supabase/functions/_shared/evaluation-reads.ts');
const MH = await import('../supabase/functions/manage-shared-report/handler.ts');
const WH = await import('../supabase/functions/manage-property-watch/handler.ts');
const BH = await import('../supabase/functions/manage-billing/handler.ts');

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = process.env.SHOTS_DIR || '';
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
let fails = 0, total = 0;
const ok = (c, name, detail) => { total++; console.log((c ? 'PASS' : 'FAIL') + ' — ' + name); if (!c) { fails++; if (detail !== undefined) console.log('           detail: ' + JSON.stringify(detail).slice(0, 600)); } };

const PAGE = '/development-activity-reports.html';
const SB = 'https://qwnnmljucajnexpxdgxr.supabase.co/functions/v1/';
const REPORT_FN = SB + 'get-development-activity-report', TRIAL_FN = SB + 'development-activity-trial', MANAGE_FN = SB + 'manage-shared-report', WATCH_FN = SB + 'manage-property-watch', BILLING_FN = SB + 'manage-billing';
const U1 = 'a1111111-1111-4111-8111-111111111111', U2 = 'a2222222-2222-4222-8222-222222222222', U3 = 'a3333333-3333-4333-8333-333333333333';
const TOKENS = { 'tok-1': { id: U1, email: 'one@example.test' }, 'tok-2': { id: U2, email: 'two@example.test' }, 'tok-3': { id: U3, email: 'three@example.test' } };
const BROKERAGE = { [U1]: 'A', [U2]: 'A', [U3]: 'B' };
const ADDRS = ['101 Birch Lane, Brigham City, UT 84302', '202 Cedar Court, Brigham City, UT 84302', '303 Maple Street, Brigham City, UT 84302', '404 Oak Avenue, Brigham City, UT 84302',
  '505 Pine Road, Brigham City, UT 84302', '606 Elm Drive, Brigham City, UT 84302', '707 Spruce Way, Brigham City, UT 84302', '808 Aspen Circle, Brigham City, UT 84302'];
const GEN = '2026-10-02T12:00:00+00:00';
const SB_STUB = (token, uid, email) => `
window.__sb = { session: { access_token: '${token}', user: { id: '${uid}', email: '${email}', user_metadata: {} } }, listeners: [], otp: [] };
window.supabase = { createClient: function () { return { auth: {
  getSession: function () { return Promise.resolve({ data: { session: window.__sb.session } }); },
  onAuthStateChange: function (cb) { window.__sb.listeners.push(cb); setTimeout(function () { cb('INITIAL_SESSION', window.__sb.session); }, 0); return { data: { subscription: { unsubscribe: function () {} } } }; },
  signInWithOtp: function () { return Promise.resolve({ error: null }); }, verifyOtp: function () { return Promise.resolve({ error: null }); },
  updateUser: function () { return Promise.resolve({ data: null, error: null }); },
  signOut: function () { window.__sb.session = null; window.__sb.listeners.forEach(function (cb) { cb('SIGNED_OUT', null); }); return Promise.resolve({}); }
} }; } };`;

/** The world behind the functions: the stored reports of two brokerages and each person's own archive set. */
async function makeWorld({ reportsA = 8 } = {}) {
  const w = { reports: [], archive: new Set(), vanished: new Set(), revoked: new Set(), calls: [], fail: null, hold: null, expireToken: new Set(), keySeq: 0, issued: 0 };
  const key = (u, id) => u + '|' + id;
  const brokerageOf = (u) => (w.revoked.has(u) ? null : BROKERAGE[u] || null);
  const visible = (u) => { const b = brokerageOf(u); return b ? w.reports.filter((r) => r.brokerage === b && !w.vanished.has(r.id)) : []; };
  const usedOf = (u) => visible(u).length;
  const state = (u) => (brokerageOf(u) ? { status: usedOf(u) >= 10 ? 'complete' : 'active', credits_used: usedOf(u), credits_remaining: 10 - usedOf(u), expired: false } : null);
  const gate = { authenticate: async (t) => (w.expireToken.has(t) ? null : TOKENS[t] || null), isAdmin: async () => false };
  const credit = (u) => ({ ordinal: usedOf(u), credits_used: usedOf(u), credits_remaining: 10 - usedOf(u), evaluation_status: 'active', allotment: 'trial', period_ends_at: null });
  w.trial = TH.makeHandler({
    ...gate, now: () => NOW, trialOf: async (u) => state(u), roleOf: async (u) => (brokerageOf(u) ? 'owner' : null), accountTypeOf: async (u) => (brokerageOf(u) ? 'brokerage' : null),
    redeemInvite: async () => { throw new Error('no'); }, createTrial: async () => { throw new Error('no'); }, inviteAgent: async () => { throw new Error('no'); },
    teamOf: async () => ({ members: [], invites: [] }), removeMember: async () => false, withdrawInvite: async () => false, signupIndividual: async () => { throw new Error('no'); },
  });
  w.manage = MH.makeHandler({ ...gate, createShare: async () => { throw new Error('no'); }, listShares: async () => [], revokeShare: async () => false });
  w.watch = WH.makeHandler({ ...gate, startWatch: async () => { throw new Error('no'); }, watchesOf: async () => [], stopWatch: async () => {}, addressOf: async () => null });
  w.billing = BH.makeHandler({ ...gate, usageOf: async (u) => (brokerageOf(u) ? { brokerage_id: 'b0b0b0b0-1111-4222-8333-444444444444', role: 'owner', state: 'none', credit_limit: 100, credits_used: 0, credits_remaining: 0, period_ends_at: null } : null),
    configured: () => false, createCheckout: async () => { throw new Error('no'); }, checkoutClaim: async () => ({ outcome: 'CLAIMED' }), checkoutRelease: async () => undefined });
  const planOf = async (u) => (brokerageOf(u) ? { brokerage_id: 'b0b0b0b0-1111-4222-8333-444444444444', role: 'owner', state: 'none', credit_limit: 100, credits_used: 0, credits_remaining: 0, period_ends_at: null } : null);
  w.report = RH.makeHandler({
    ...gate, now: () => NOW, rights: RIGHTS_AB, geocode: async (a) => geocodeStandIn(a), zipSupported: async () => true,
    rateClaim: async () => ({ allowed: true }), radius: async () => RICH.rows, hydrate: async () => RICH.projects, ledger: async () => RICH.ledger ?? [], events: async () => RICH.events ?? [], health: async () => [],
    trialOf: async (u) => state(u), planOf,
    issue: async (u, k, intelligence, ctx) => {
      w.issued++;
      const number = w.reports.filter((r) => r.brokerage === brokerageOf(u)).length + 1;
      const id = 'c0000000-0000-4000-8000-' + String(++w.keySeq).padStart(12, '0');
      w.reports.push({ id, brokerage: brokerageOf(u), number, report: intelligence, address: w.lastAddress, ctx: 'ctx-' + id });
      return { replayed: false, report_id: id, content_hash: 'h', report_version: 'v', generated_at: NOW.toISOString(), private_context_id: 'ctx-' + id, report: intelligence, credit: credit(u) };
    },
    contextMatches: async () => 'match', storedReport: async () => null,
    savedReports: async (u, archived = false) => visible(u).filter((r) => w.archive.has(key(u, r.id)) === !!archived).map((r) => ({ report_id: r.id, number: r.number, generated_at: GEN, private_context_id: r.ctx })).sort((a, b) => b.number - a.number),
    archiveReports: async (u, ids, archived) => {
      w.calls.push({ u, ids: ids.slice(), archived });
      if (w.fail === 'down') throw new RH.DataUnavailable('x');
      const own = new Set(visible(u).map((r) => r.id)), uniq = [...new Set(ids.map((x) => x.toLowerCase()))];
      if (!uniq.every((x) => own.has(x))) throw new E.SavedReportNotFound('x');
      let changed = 0;
      for (const id of uniq) { const k = key(u, id); if (archived && !w.archive.has(k)) { w.archive.add(k); changed++; } if (!archived && w.archive.has(k)) { w.archive.delete(k); changed++; } }
      return changed;
    },
    openSavedReport: async (u, id) => { const r = visible(u).find((x) => x.id === id); return r ? { report_id: r.id, number: r.number, generated_at: GEN, private_context_id: r.ctx, body: JSON.stringify(r.report) } : null; },
    subjectOf: async (ctx) => { const r = w.reports.find((x) => x.ctx === ctx); return { address: r ? r.address : null, label: null }; },
    headerOf: async () => ({ brokerage: 'Acme Realty', agent: null }),
  });
  // the stored reports are made through the handler's own issue path, as the first brokerage's first person
  for (let i = 0; i < reportsA; i++) await makeReport(w, 'tok-1', ADDRS[i]);
  await makeReport(w, 'tok-3', ADDRS[0]);
  return w;
}
async function makeReport(w, token, address) {
  w.lastAddress = address;
  const res = await w.report(new Request(REPORT_FN, { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
    body: JSON.stringify({ address, idempotency_key: crypto.randomUUID() }) }));
  const j = await res.json();
  if (res.status !== 200 || !j.report_id) throw new Error('could not make fixture report: ' + res.status + ' ' + JSON.stringify(j).slice(0, 200));
  return j.report_id;
}
const idOf = (w, brokerage, number) => w.reports.find((r) => r.brokerage === brokerage && r.number === number).id;

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
  const p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
  if (!p.startsWith(root)) { res.writeHead(403).end(); return; }
  let body; try { body = await readFile(p); } catch { res.writeHead(404).end('not found'); return; }
  res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' }).end(body);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch();

/** One device: a fresh browser context signed in as `token`'s person. `hold` (a predicate on the request body) delays the server's answer until release() is called. */
async function device(w, { token = 'tok-1', width = 1280, height = 900, mobile = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, ...(mobile ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
  const page = await ctx.newPage();
  const errors = [], saved = [], reportRequests = [], foreign = [];
  const held = { pending: null, release: null, match: null };
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
  const who = TOKENS[token];
  await page.route('**/*', async (route) => {
    const r = route.request(), url = r.url();
    if (url.startsWith(base)) return route.continue();
    if (url.startsWith('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2')) return route.fulfill({ status: 200, contentType: 'text/javascript', body: SB_STUB(token, who.id, who.email) });
    const fns = { [TRIAL_FN]: w.trial, [MANAGE_FN]: w.manage, [WATCH_FN]: w.watch, [BILLING_FN]: w.billing, [REPORT_FN]: w.report };
    if (fns[url]) {
      const body = r.postData() ? JSON.parse(r.postData()) : null;
      if (url === REPORT_FN) { (body && body.action ? saved : reportRequests).push(body); }
      if (url === REPORT_FN && held.match && body && held.match(body)) { held.match = null; await new Promise((res) => { held.release = res; }); }
      const res = await fns[url](new Request(url, { method: 'POST', headers: { authorization: r.headers().authorization || '', 'content-type': 'application/json' }, body: r.postData() }));
      return route.fulfill({ status: res.status, contentType: 'application/json', body: await res.text() });
    }
    foreign.push(url); return route.abort();
  });
  await page.goto(base + PAGE, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__sb && window.__sb.listeners.length > 0);
  await page.waitForFunction(() => document.querySelectorAll('#saved-list .sv-row').length > 0 || /No reports saved|archived/.test(document.getElementById('saved-status').textContent), null, { timeout: 8000 }).catch(() => {});
  return { ctx, page, errors, saved, reportRequests, foreign, holdNext: (match) => { held.match = match; }, release: () => held.release && held.release() };
}
const rowsOf = (page) => page.$$eval('#saved-list .sv-row', (els) => els.filter((e) => !e.hidden).map((e) => e.querySelector('.sv-open').textContent.trim()));
const numbers = async (page) => (await rowsOf(page)).map((t) => Number(/^Report (\d+)/.exec(t)[1]));
const status = (page) => page.$eval('#saved-status', (e) => e.textContent.trim());
const toast = (page) => page.$eval('#saved-toast', (e) => ({ shown: !e.hidden && e.getBoundingClientRect().height > 0, text: e.querySelector('#saved-toast-text').textContent.trim(), undo: !document.getElementById('saved-undo').hidden }));
const trialCount = (page) => page.$eval('#trial-count', (e) => e.textContent.trim());
const settle = (page, ms = 150) => page.waitForTimeout(ms);
const openMenu = async (page, n) => { await page.click(`#saved-list button.sv-kebab[aria-label="Actions for report ${n}"]`); await page.waitForSelector('#saved-menu:not([hidden])'); };
const viewArchived = async (page) => { await page.click('#saved-archived-toggle'); await page.waitForFunction(() => /Archived reports/.test(document.getElementById('saved-title').textContent)); await settle(page); };
const backToSaved = async (page) => { await page.click('#saved-archived-toggle'); await page.waitForFunction(() => /^Saved reports$/.test(document.getElementById('saved-title').textContent)); await settle(page); };
const noReportRequests = (d) => d.reportRequests.length === 0;
const archiveCalls = (d) => d.saved.filter((b) => b.action === 'archive' || b.action === 'restore');

// ---- 1. the list, the menu, opening ---------------------------------------------------------------------------------------------------
{
  const w = await makeWorld();
  const d = await device(w);
  const { page } = d;
  ok((await numbers(page)).join() === '8,7,6,5,4,3', '1a the list shows the six most recent reports, newest first, by number', await numbers(page));
  const first = (await rowsOf(page))[0];
  ok(/^Report 8 · 808 Aspen Circle, Brigham City, UT 84302 · /.test(first) && /2026/.test(first), '1b each row shows its report number, property address and date', first);
  ok(await page.$$eval('#saved-list .sv-row', (els) => els.every((e) => e.querySelector('.sv-kebab') && /^Actions for report \d+$/.test(e.querySelector('.sv-kebab').getAttribute('aria-label')))), '1c every row has its own three-dot button, named for its report');
  ok(await page.$eval('#saved-list .sv-row', (e) => !!e.querySelector('.sv-kebab') && e.querySelector('.sv-kebab').getAttribute('aria-haspopup') === 'menu' && e.querySelector('.sv-kebab').getAttribute('aria-expanded') === 'false'), '1d the button says it opens a menu, closed');
  ok((await page.$$('#saved-list .sv-trash, #saved-list [class*="trash"], #saved-list svg')).length === 0, '1e there is no red trash icon on any row');
  const before = d.saved.length;
  await openMenu(page, 8);
  ok(d.saved.length === before && (await page.$eval('#report', (e) => e.textContent.trim() === '')), '1f opening the menu opens no report and asks the server nothing');
  ok(await page.$eval('#saved-menu', (m) => m.getAttribute('role') === 'menu' && m.querySelector('[role="menuitem"]').textContent.trim() === 'Remove from Saved Reports'), '1g the menu offers "Remove from Saved Reports" and nothing else');
  ok(await page.$eval('.sv-kebab[aria-label="Actions for report 8"]', (b) => b.getAttribute('aria-expanded') === 'true'), '1h the open menu is reported to assistive technology');
  await page.keyboard.press('Escape');
  ok(await page.$eval('#saved-menu', (m) => m.hidden) && (await page.evaluate(() => document.activeElement.getAttribute('aria-label'))) === 'Actions for report 8', '1i Escape closes the menu and returns focus to the button that opened it');
  await page.click('#saved-list .sv-row .sv-open');
  await page.waitForFunction(() => document.querySelectorAll('#report .da-rv-sec').length > 0);
  ok(d.saved.some((b) => b.action === 'open' && b.report_id === idOf(w, 'A', 8)) && /Saved report 8/.test(await status(page)), '1j clicking the row still opens that saved report, as before');
  ok(/^8 of 10 free reports used$/.test(await trialCount(page)) && w.issued === 9, '1k opening used nothing: still 8 of 10 free reports used');
  ok(d.errors.length === 0 && d.foreign.length === 0, '1l no page error, nothing foreign fetched', { e: d.errors, f: d.foreign });
  await d.ctx.close();
}

// ---- 2. removing ONE: nothing is announced before the server answers; another device sees it; Undo --------------------------------------
{
  const w = await makeWorld();
  const d = await device(w);
  const { page } = d;
  d.holdNext((b) => b.action === 'archive');
  await openMenu(page, 7);
  await page.click('#saved-menu-remove');
  await page.waitForFunction(() => document.querySelector('#saved-list .sv-row.sv-busy'));
  const mid = await toast(page);
  ok(!mid.shown && (await numbers(page)).includes(7) && w.archive.size === 0, '2a while the server has not answered: no "Removed" notice, the row is still there, nothing is stored', { mid, n: await numbers(page) });
  ok(await page.$eval('#saved-list .sv-row.sv-busy', (e) => e.getAttribute('data-id')) === idOf(w, 'A', 7), '2a2 and the one row being changed is marked as busy');
  d.release(); await page.waitForFunction(() => !document.getElementById('saved-toast').hidden);
  const t = await toast(page);
  ok(t.shown && t.text === 'Removed from Saved Reports.' && t.undo, '2b once the server confirms, the page says "Removed from Saved Reports." and offers Undo', t);
  ok((await numbers(page)).join() === '8,6,5,4,3,2', '2c the report left the list and the next one took its place (six shown, newest first)', await numbers(page));
  ok(archiveCalls(d).length === 1 && JSON.stringify(archiveCalls(d)[0]) === JSON.stringify({ action: 'archive', report_ids: [idOf(w, 'A', 7)] }), '2d exactly one request, naming exactly that report', archiveCalls(d));
  ok(noReportRequests(d) && /^8 of 10 free reports used$/.test(await trialCount(page)), '2e no report request was made and the free-report figure still reads 8 of 10 used');
  // a second device
  const d2 = await device(w);
  ok((await numbers(d2.page)).join() === '8,6,5,4,3,2', '2f a second device (a fresh browser context, nothing shared but the account) shows the same list', await numbers(d2.page));
  await d2.ctx.close();
  // Undo
  await page.click('#saved-undo');
  await page.waitForFunction(() => /Restored to Saved Reports\./.test(document.getElementById('saved-toast-text').textContent));
  await page.waitForFunction(() => document.querySelectorAll('#saved-list .sv-row').length > 0 && !document.querySelector('#saved-list .sv-row.sv-busy'));
  await settle(page, 250);
  ok((await numbers(page)).join() === '8,7,6,5,4,3', '2g Undo puts the report back in its own place with its own number (report 7)', await numbers(page));
  ok(w.archive.size === 0 && (await toast(page)).undo === false, '2h the archive is empty again, and there is nothing left to undo');
  ok(JSON.stringify(archiveCalls(d).map((b) => b.action)) === '["archive","restore"]' && d.errors.length === 0, '2i Undo was one restore request', { c: archiveCalls(d), e: d.errors });
  await d.ctx.close();
}

// ---- 3. rapid clicks, and a failure -----------------------------------------------------------------------------------------------------
{
  const w = await makeWorld();
  const d = await device(w);
  const { page } = d;
  d.holdNext((b) => b.action === 'archive');
  await openMenu(page, 6);
  await page.click('#saved-menu-remove');
  // the menu is closed and the row is busy: hammer every control that could start a second change
  await page.click('.sv-kebab[aria-label="Actions for report 6"]', { force: true }).catch(() => {});
  await page.click('.sv-kebab[aria-label="Actions for report 5"]', { force: true }).catch(() => {});
  await page.evaluate(() => { const m = document.getElementById('saved-menu-remove'); m.click(); m.click(); });
  await settle(page, 100); d.release(); await page.waitForFunction(() => !document.getElementById('saved-toast').hidden);
  ok(archiveCalls(d).length === 1, '3a repeated clicks while a request is in flight send ONE request', archiveCalls(d));
  ok(w.archive.size === 1 && (await numbers(page)).join() === '8,7,5,4,3,2', '3b and only the chosen report was removed', { n: await numbers(page), a: [...w.archive] });
  // a failure: no success notice, nothing changes, in words
  await page.click('#saved-undo'); await page.waitForFunction(() => /Restored/.test(document.getElementById('saved-toast-text').textContent)); await settle(page, 250);
  w.fail = 'down';
  await openMenu(page, 5); await page.click('#saved-menu-remove');
  await page.waitForFunction(() => /could not be done just now/.test(document.getElementById('saved-status').textContent));
  ok(!(await toast(page)).shown || !/^Removed/.test((await toast(page)).text), '3c a server failure shows no "Removed" notice', await toast(page));
  ok(/Nothing was changed/.test(await status(page)) && (await page.$eval('#saved-status', (e) => e.className)) === 'err', '3d it says plainly that nothing was changed, as an error', await status(page));
  ok((await numbers(page)).includes(5) && w.archive.size === 0, '3e the report is still on the list and nothing was stored');
  w.fail = null;
  await d.ctx.close();
}

// ---- 4. Manage: several at once ----------------------------------------------------------------------------------------------------------
{
  const w = await makeWorld();
  const d = await device(w);
  const { page } = d;
  ok(await page.$eval('#saved-manage', (b) => !b.hidden && b.textContent.trim() === 'Manage' && b.getAttribute('aria-pressed') === 'false'), '4a a discreet "Manage" control sits by the Saved reports heading');
  ok(await page.$$eval('#saved-list .sv-mpick', (els) => els.every((e) => getComputedStyle(e).display === 'none')) && await page.$eval('#saved-bulk', (e) => e.hidden), '4b outside Manage mode there are no checkboxes and no bulk bar');
  ok(!(await page.$('text=/Delete all/i')) && !(await page.$('#saved-bulk button:has-text("Delete")')), '4c there is no "Delete all" control anywhere');
  await page.click('#saved-manage');
  ok(await page.$eval('#saved-bulk', (e) => !e.hidden) && await page.$$eval('#saved-list .sv-row:not([hidden]) .sv-mpick', (els) => els.length === 6 && els.every((e) => getComputedStyle(e).display !== 'none')), '4d Manage mode shows a checkbox on each of the six rows');
  ok(await page.$$eval('#saved-list .sv-row:not([hidden]) .sv-kebab', (els) => els.every((e) => getComputedStyle(e).display === 'none')), '4e and the row menus step aside');
  ok(await page.$eval('#saved-remove-sel', (b) => b.disabled) && (await text(page, '#saved-count')) === '0 selected', '4f "Remove selected" is disabled until something is chosen');
  await page.check('#saved-list .sv-mpick input[value="' + idOf(w, 'A', 8) + '"]');
  await page.check('#saved-list .sv-mpick input[value="' + idOf(w, 'A', 5) + '"]');
  ok((await text(page, '#saved-count')) === '2 selected' && await page.$eval('#saved-all', (c) => c.indeterminate), '4g ticking two says "2 selected" and shows the select-all box as partly chosen');
  await page.check('#saved-all');
  ok((await text(page, '#saved-count')) === '6 selected', '4h "Select all shown" selects the six reports displayed (not the two behind "View all")', await text(page, '#saved-count'));
  await page.uncheck('#saved-list .sv-mpick input[value="' + idOf(w, 'A', 3) + '"]');
  await page.click('#saved-remove-sel');
  const ct = await text(page, '#saved-confirm-text'), cb = await text(page, '#saved-confirm-go');
  ok(await page.$eval('#saved-confirm', (e) => !e.hidden) && /^Remove 5 reports from Saved Reports\?/.test(ct) && cb === 'Remove 5 reports', '4i before anything is sent, the page asks, naming the exact number (5)', { ct, cb });
  ok(archiveCalls(d).length === 0 && w.archive.size === 0, '4j nothing has been sent or stored yet');
  ok(/restore .* from View archived/.test(ct) && /Nothing is refunded/.test(ct) && /client links and property watches keep working/.test(ct), '4k and says in one sentence that they can be restored and that credits, client links and watches are untouched', ct);
  await page.click('#saved-confirm-go');
  await page.waitForFunction(() => !document.getElementById('saved-toast').hidden);
  const sent = archiveCalls(d)[0];
  const want = [8, 7, 6, 5, 4].map((n) => idOf(w, 'A', n)).sort();
  ok(archiveCalls(d).length === 1 && sent.action === 'archive' && JSON.stringify([...sent.report_ids].sort()) === JSON.stringify(want), '4l the request names exactly the five chosen reports, no more', sent);
  ok(w.archive.size === 5 && [...w.archive].every((k) => want.includes(k.split('|')[1])), '4m exactly those five are archived', [...w.archive]);
  const t = await toast(page);
  ok(t.text === 'Removed 5 reports from Saved Reports.' && t.undo, '4n the notice names the number and offers Undo', t);
  ok((await numbers(page)).join() === '3,2,1' && await page.$eval('#saved-bulk', (e) => e.hidden), '4o the three remaining reports are shown (report 3, which was unticked, stays) and Manage mode has ended', await numbers(page));
  await page.click('#saved-undo');
  await page.waitForFunction(() => /Restored 5 reports/.test(document.getElementById('saved-toast-text').textContent));
  await settle(page, 300);
  ok(w.archive.size === 0 && (await numbers(page)).join() === '8,7,6,5,4,3', '4p Undo puts all five back at once', await numbers(page));
  ok(noReportRequests(d) && /^8 of 10 free reports used$/.test(await trialCount(page)), '4q still no report request, still 8 of 10 free reports used');
  await d.ctx.close();
}

// ---- 5. search narrows a selection; Cancel changes nothing; View all -----------------------------------------------------------------------
{
  const w = await makeWorld();
  const d = await device(w);
  const { page } = d;
  await page.click('#saved-manage'); await page.check('#saved-all');
  ok((await text(page, '#saved-count')) === '6 selected', '5a six selected');
  await page.fill('#saved-search', 'Maple');
  ok((await text(page, '#saved-count')) === '1 selected' && (await numbers(page)).join() === '3', '5b a search shows one report and the selection shrinks to what is shown (1), not what is hidden', { c: await text(page, '#saved-count'), n: await numbers(page) });
  await page.click('#saved-remove-sel');
  ok(/^Remove 1 report from Saved Reports\? You can restore it/.test(await text(page, '#saved-confirm-text')), '5c the confirmation says "1 report", singular');
  await page.fill('#saved-search', '');
  ok(await page.$eval('#saved-confirm', (e) => e.hidden), '5d changing what is shown withdraws a pending confirmation');
  ok((await text(page, '#saved-count')) === '1 selected', '5d2 and the five reports the search hid were let go: clearing the search does not bring their ticks back (1 selected, not 6)', await text(page, '#saved-count'));
  await page.click('#saved-cancel');
  ok(await page.$eval('#saved-bulk', (e) => e.hidden) && archiveCalls(d).length === 0 && w.archive.size === 0 && (await numbers(page)).join() === '8,7,6,5,4,3', '5e Cancel leaves Manage mode and changes nothing');
  await page.click('#saved-more');
  await page.click('#saved-manage'); await page.check('#saved-all');
  ok((await text(page, '#saved-count')) === '8 selected', '5f after "View all saved reports", "Select all shown" selects all eight displayed', await text(page, '#saved-count'));
  await d.ctx.close();
}

// ---- 6. View archived ---------------------------------------------------------------------------------------------------------------------------
{
  const w = await makeWorld();
  const d = await device(w);
  const { page } = d;
  ok(await page.$eval('#saved-archived-toggle', (b) => !b.hidden && b.textContent.trim() === 'View archived'), '6a a secondary "View archived" entry is offered');
  await viewArchived(page);
  ok((await status(page)) === 'No archived reports.' && (await rowsOf(page)).length === 0, '6b with nothing archived it says so');
  await backToSaved(page);
  await openMenu(page, 8); await page.click('#saved-menu-remove'); await page.waitForFunction(() => !document.getElementById('saved-toast').hidden);
  ok(!(await rowsOf(page)).some((t) => /^Report 8 /.test(t)), '6c the removed report is not in the main list');
  await page.fill('#saved-search', 'Aspen');
  ok((await rowsOf(page)).length === 0, '6d nor in a search of it (the main list and its search never include archived reports)');
  await page.fill('#saved-search', '');
  await viewArchived(page);
  ok((await numbers(page)).join() === '8' && await page.$eval('#saved-title', (e) => e.textContent) === 'Archived reports', '6e View archived lists only that report, with its original number (8)', await numbers(page));
  ok(await page.$eval('#saved-list .sv-restore', (b) => b.textContent.trim() === 'Restore' && b.getAttribute('aria-label') === 'Restore report 8 to Saved Reports'), '6f it offers Restore, named for the report');
  ok(await page.$eval('#saved-manage', (b) => b.hidden), '6g Manage is not offered on the archived list');
  await page.click('#saved-list .sv-open');
  await page.waitForFunction(() => document.querySelectorAll('#report .da-rv-sec').length > 0);
  ok(d.saved.some((b) => b.action === 'open' && b.report_id === idOf(w, 'A', 8)) && /Saved report 8/.test(await status(page)), '6h an archived report can still be opened, exactly as before');
  await page.click('#saved-list .sv-restore');
  await page.waitForFunction(() => /Restored to Saved Reports\./.test(document.getElementById('saved-toast-text').textContent));
  ok(w.archive.size === 0 && (await rowsOf(page)).length === 0 && /No archived reports/.test(await status(page)), '6i Restore returns it to Saved Reports; the archived list is empty again', await status(page));
  await backToSaved(page);
  ok((await numbers(page)).join() === '8,7,6,5,4,3', '6j and report 8 is back in the main list with its original number, in its own place', await numbers(page));
  // everything archived: a clear empty state
  const ids = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => idOf(w, 'A', n));
  await page.click('#saved-manage'); await page.click('#saved-more').catch(() => {});
  await page.check('#saved-all'); await page.click('#saved-remove-sel'); await page.click('#saved-confirm-go');
  await page.waitForFunction(() => /Every saved report is archived/.test(document.getElementById('saved-status').textContent), null, { timeout: 8000 });
  ok(w.archive.size === 8 && ids.every((id) => w.archive.has(U1 + '|' + id)), '6k all eight can be archived in one confirmed step');
  ok(/Every saved report is archived\. Choose View archived to restore one\./.test(await status(page)) && (await rowsOf(page)).length === 0 && await page.$eval('#saved-manage', (b) => b.hidden),
    '6l with every report archived the main list says so and points to View archived', await status(page));
  await d.ctx.close();
}

// ---- 7. other people, a removed member, an expired session ----------------------------------------------------------------------------------------
{
  const w = await makeWorld();
  const a = await device(w, { token: 'tok-1' });
  const b = await device(w, { token: 'tok-2' });
  await openMenu(a.page, 8); await a.page.click('#saved-menu-remove'); await a.page.waitForFunction(() => !document.getElementById('saved-toast').hidden);
  await b.page.reload(); await b.page.waitForFunction(() => document.querySelectorAll('#saved-list .sv-row').length > 0);
  ok((await numbers(b.page)).join() === '8,7,6,5,4,3', '7a a colleague in the same brokerage still sees the report the first person removed (separate lists)', await numbers(b.page));
  await openMenu(b.page, 7); await b.page.click('#saved-menu-remove'); await b.page.waitForFunction(() => !document.getElementById('saved-toast').hidden);
  await a.page.reload(); await a.page.waitForFunction(() => document.querySelectorAll('#saved-list .sv-row').length > 0);
  ok((await numbers(a.page)).join() === '7,6,5,4,3,2' && w.archive.has(U1 + '|' + idOf(w, 'A', 8)) && w.archive.has(U2 + '|' + idOf(w, 'A', 7)) && !w.archive.has(U1 + '|' + idOf(w, 'A', 7)), '7b and the colleague\'s removal did not change theirs', await numbers(a.page));
  const c = await device(w, { token: 'tok-3' });
  ok((await numbers(c.page)).join() === '1' && c.errors.length === 0, '7c a person in another brokerage sees only their own report', await numbers(c.page));
  // a member removed from the brokerage after the page loaded
  w.revoked.add(U2);
  await openMenu(b.page, 6); await b.page.click('#saved-menu-remove');
  await b.page.waitForFunction(() => /cannot change saved reports right now/.test(document.getElementById('saved-status').textContent), null, { timeout: 8000 });
  ok(!w.archive.has(U2 + '|' + idOf(w, 'A', 6)) && (await rowsOf(b.page)).length === 0, '7d a member who has been removed cannot remove a report: told so in words, nothing stored, and their list is empty');
  w.revoked.delete(U2);
  // an expired session
  w.expireToken.add('tok-1');
  await openMenu(a.page, 5); await a.page.click('#saved-menu-remove');
  await a.page.waitForFunction(() => /Sign in first/.test(document.getElementById('saved-status').textContent), null, { timeout: 8000 });
  ok(await a.page.$eval('#auth-overlay', (e) => getComputedStyle(e).display !== 'none') && !w.archive.has(U1 + '|' + idOf(w, 'A', 5)), '7e an expired session asks the person to sign in, and nothing is stored');
  for (const x of [a, b, c]) await x.ctx.close();
}
{
  const w = await makeWorld();
  const d = await device(w);
  const { page } = d;
  w.vanished.add(idOf(w, 'A', 5));
  await openMenu(page, 5); await page.click('#saved-menu-remove');
  await page.waitForFunction(() => /no longer available to you/.test(document.getElementById('saved-status').textContent), null, { timeout: 8000 });
  await settle(page, 400);
  ok(/no longer available to you/.test(await status(page)) && (await numbers(page)).join() === '8,7,6,4,3,2' && !(await toast(page)).shown,
    '7f a report that is no longer the person\'s (404): the list is read again WITHOUT it, the words stay on screen, and no "Removed" notice appears', { s: await status(page), n: await numbers(page) });
  await d.ctx.close();
}

// ---- 8. shares and watches are keyed on the report, not the list: the page calls no share or watch function while removing ----------------------
{
  const w = await makeWorld();
  const seen = [];
  const d = await device(w);
  d.page.on('request', (r) => { if (r.url() === MANAGE_FN || r.url() === WATCH_FN) seen.push(r.url()); });
  await openMenu(d.page, 8); await d.page.click('#saved-menu-remove'); await d.page.waitForFunction(() => !document.getElementById('saved-toast').hidden);
  await d.page.click('#saved-undo'); await settle(d.page, 400);
  ok(seen.length === 0, '8a removing and restoring call no share-link or property-watch function: they cannot be changed from here', seen);
  await d.ctx.close();
}

// ---- 9. keyboard, clipping, layout ---------------------------------------------------------------------------------------------------------------
{
  const w = await makeWorld();
  const d = await device(w);
  const { page } = d;
  await page.focus('.sv-kebab[aria-label="Actions for report 8"]');
  await page.keyboard.press('Enter');
  ok(await page.$eval('#saved-menu', (m) => !m.hidden) && (await page.evaluate(() => document.activeElement.id)) === 'saved-menu-remove', '9a Enter on the three-dot button opens the menu and puts focus on its item');
  await page.keyboard.press('Escape'); await page.focus('.sv-kebab[aria-label="Actions for report 7"]'); await page.keyboard.press('Space');
  ok(await page.$eval('#saved-menu', (m) => !m.hidden), '9b Space opens it too');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => !document.getElementById('saved-toast').hidden);
  ok(archiveCalls(d).length === 1 && archiveCalls(d)[0].report_ids[0] === idOf(w, 'A', 7), '9c Enter on the item removes that report: the whole flow works without a mouse');
  ok(await page.$eval('#saved-manage', (b) => b.tagName === 'BUTTON') && await page.$eval('#saved-all', (b) => b.type === 'checkbox'), '9d Manage and Select all are real buttons and checkboxes (tab order, Space to toggle)');
  // the menu is not clipped by the scrolling list: open it on the LAST row of a list that scrolls
  await page.click('#saved-more'); await settle(page, 100);
  const lastN = (await numbers(page)).slice(-1)[0];
  await page.evaluate(() => { const l = document.getElementById('saved-list'); l.scrollTop = l.scrollHeight; });
  await openMenu(page, lastN);
  const geo = await page.evaluate(() => {
    const m = document.getElementById('saved-menu'), r = m.getBoundingClientRect(), it = document.getElementById('saved-menu-remove').getBoundingClientRect();
    const top = document.elementFromPoint(it.left + it.width / 2, it.top + it.height / 2);
    return { inView: r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth, topIsItem: !!top && top.id === 'saved-menu-remove' };
  });
  ok(geo.inView && geo.topIsItem, '9e a menu opened on the last row of the scrolling list is fully visible and on top (not clipped by the list)', geo);
  ok(await page.evaluate(() => { document.getElementById('saved-list').dispatchEvent(new Event('scroll')); return !document.getElementById('saved-menu').hidden; }),
    '9e2 a scroll event that did not move the button (focus landing on the menu fires one) leaves the menu open');
  await page.evaluate(() => { const l = document.getElementById('saved-list'); l.scrollTop = Math.max(0, l.scrollTop - 40); });
  await page.waitForFunction(() => document.getElementById('saved-menu').hidden, null, { timeout: 3000 }).catch(() => {});
  ok(await page.$eval('#saved-menu', (m) => m.hidden), '9e3 and when the list really scrolls the button away, the menu closes with it');
  await page.keyboard.press('Escape');
  const lay = async () => page.evaluate(() => {
    const list = document.getElementById('saved-list').getBoundingClientRect();
    const rows = [...document.querySelectorAll('#saved-list .sv-row:not([hidden])')];
    return { noOverflow: document.documentElement.scrollWidth <= innerWidth, kebabsInside: rows.every((r) => { const k = r.querySelector('.sv-kebab').getBoundingClientRect(); return k.width >= 36 && k.right <= list.right + 1 && k.left >= list.left - 1; }),
      kebabH: Math.round(rows[0].querySelector('.sv-kebab').getBoundingClientRect().height), kebabW: Math.round(rows[0].querySelector('.sv-kebab').getBoundingClientRect().width) };
  });
  const L1 = await lay();
  ok(L1.noOverflow && L1.kebabsInside, '9f on a desktop window: no horizontal overflow and every three-dot button sits fully inside its row', L1);
  if (SHOTS) {
    await page.evaluate(() => { document.getElementById('saved').scrollIntoView(); }); await page.screenshot({ path: join(SHOTS, 'desktop-1-list.png') });
    await openMenu(page, (await numbers(page))[0]); await page.screenshot({ path: join(SHOTS, 'desktop-2-menu.png') }); await page.keyboard.press('Escape');
  }
  await d.ctx.close();
}
for (const [label, width, height] of [['phone', 390, 844], ['narrow', 320, 640]]) {
  const w = await makeWorld();
  const d = await device(w, { width, height, mobile: true });
  const { page } = d;
  const lay = await page.evaluate(() => {
    const list = document.getElementById('saved-list').getBoundingClientRect();
    const rows = [...document.querySelectorAll('#saved-list .sv-row:not([hidden])')];
    const k = rows[0].querySelector('.sv-kebab').getBoundingClientRect();
    return { noOverflow: document.documentElement.scrollWidth <= innerWidth, inside: rows.every((r) => { const b = r.querySelector('.sv-kebab').getBoundingClientRect(); return b.right <= list.right + 1 && b.left >= list.left - 1; }), kw: Math.round(k.width), kh: Math.round(k.height) };
  });
  ok(lay.noOverflow && lay.inside, `9g (${label} ${width}px) no horizontal overflow, and every three-dot button is fully inside its row`, lay);
  ok(lay.kw >= 44 && lay.kh >= 44, `9h (${label}) the three-dot button is a ${lay.kw}x${lay.kh} touch target (at least 44x44)`, lay);
  await page.evaluate(() => document.getElementById('saved').scrollIntoView());
  await page.tap('.sv-kebab[aria-label="Actions for report 8"]'); await page.waitForSelector('#saved-menu:not([hidden])');
  const m = await page.evaluate(() => { const r = document.getElementById('saved-menu').getBoundingClientRect(); return { inView: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight, h: Math.round(document.getElementById('saved-menu-remove').getBoundingClientRect().height) }; });
  ok(m.inView && m.h >= 44, `9i (${label}) the menu fits on screen and its item is a touch target (${m.h}px)`, m);
  if (SHOTS && label === 'phone') { await page.screenshot({ path: join(SHOTS, 'phone-1-menu.png') }); }
  await page.keyboard.press('Escape');
  await page.tap('#saved-manage');
  const bulk = await page.evaluate(() => ({ noOverflow: document.documentElement.scrollWidth <= innerWidth, checks: [...document.querySelectorAll('#saved-list .sv-row:not([hidden]) .sv-mpick')].every((e) => { const r = e.getBoundingClientRect(); return r.width >= 40 && r.height >= 40; }) }));
  ok(bulk.noOverflow && bulk.checks, `9j (${label}) in Manage mode there is still no horizontal overflow and the checkboxes are touch-sized`, bulk);
  await page.tap('#saved-all'); await page.tap('#saved-remove-sel');
  if (SHOTS && label === 'phone') { await page.evaluate(() => document.getElementById('saved').scrollIntoView()); await page.screenshot({ path: join(SHOTS, 'phone-2-manage-confirm.png') }); }
  const cf = await page.evaluate(() => ({ noOverflow: document.documentElement.scrollWidth <= innerWidth, text: document.getElementById('saved-confirm-text').textContent.slice(0, 40) }));
  ok(cf.noOverflow && /^Remove 6 reports/.test(cf.text), `9k (${label}) the confirmation fits and names the number`, cf);
  await page.tap('#saved-confirm-go'); await page.waitForFunction(() => !document.getElementById('saved-toast').hidden);
  if (SHOTS && label === 'phone') { await page.screenshot({ path: join(SHOTS, 'phone-3-removed-undo.png') }); }
  await d.ctx.close();
}
{
  const w = await makeWorld();
  const d = await device(w);
  await d.page.evaluate(() => document.getElementById('saved').scrollIntoView());
  await d.page.click('#saved-manage'); await d.page.check('#saved-all');
  if (SHOTS) await d.page.screenshot({ path: join(SHOTS, 'desktop-3-manage.png') });
  await d.page.click('#saved-remove-sel');
  if (SHOTS) await d.page.screenshot({ path: join(SHOTS, 'desktop-4-confirm.png') });
  await d.page.click('#saved-confirm-go'); await d.page.waitForFunction(() => !document.getElementById('saved-toast').hidden);
  if (SHOTS) await d.page.screenshot({ path: join(SHOTS, 'desktop-5-removed-undo.png') });
  await d.page.click('#saved-archived-toggle'); await d.page.waitForFunction(() => /Archived reports/.test(document.getElementById('saved-title').textContent)); await d.page.waitForTimeout(250);
  if (SHOTS) await d.page.screenshot({ path: join(SHOTS, 'desktop-6-archived.png') });
  await d.ctx.close();
}

async function text(page, sel) { return page.$eval(sel, (e) => e.textContent.trim()); }
await browser.close(); server.close();
console.log('\n' + (total - fails) + ' passed, ' + fails + ' failed of ' + total);
process.exit(fails ? 1 : 0);
