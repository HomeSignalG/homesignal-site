// PROPERTY REPORTS → EXISTING PREMIUM WAITLIST, DRIVEN IN A REAL BROWSER.
//
// test/property-reports-premium.test.mjs pins the source contract statically.
// This file is the half a grep cannot see: the shared modal opens, a refused
// write does NOT show "You're on the list", and a successful write sends the
// Property Reports URL as source plus the resolved Address ZIP — through
// HS.submitWaitlist, not a reports.html-specific persist.
//
// DATA_SOURCE stays 'supabase' so the repaired waitlist path (hs_premium_waitlist_join)
// is the one that runs. DEMO_SESSION is forced in the served config (not via ?demo=)
// so seed Addresses resolve on reports.html?id=p2 AND the query string stays the
// production route, so source attribution is /reports.html?id=p2.
//
// NEITHER PATH REACHES PRODUCTION (Fix 16). Playwright fulfills the RPC on both:
// §F with the historical PGRST205 payload, §D with the deployed function's own success
// shape. This journey used to let §D call production, and every green run appended a
// permanent Premium lead — 40 of the table's 44 rows on 2026-09-12, each carrying the
// Date.now() it was created at. The row was never read back by any assertion: it was a
// side effect bought to obtain an {ok:true} the UI needs, so intercepting costs nothing
// the file was actually proving. What production DOES still prove is §D2, a zero-write
// reachability probe that uses the RPC's own pre-INSERT email guard.
// Run:
//   node test/property-reports-premium.browser.test.mjs
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, normalize } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0;
const ok = (c, name, detail) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name);
  if (!c) { fails++; if (detail !== undefined) console.log('           detail: ' + JSON.stringify(detail)); }
};
const info = (k, v) => console.log('   · ' + k + ': ' + (typeof v === 'string' ? v : JSON.stringify(v)));

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
  const p = normalize(join(root, decodeURIComponent((req.url || '/').split('?')[0])));
  if (!p.startsWith(root)) { res.writeHead(403).end(); return; }
  try {
    let body = await readFile(p);
    if (p.endsWith('config.js')) {
      body = Buffer.from(String(body).replace('DEMO_SESSION: false', 'DEMO_SESSION: true'));
    }
    res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' }).end(body);
  } catch { res.writeHead(404).end('not found'); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;

const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(String(e).slice(0, 200)));

const waitShell = () => page.waitForFunction(() => !!document.querySelector('.nav a'), null, { timeout: 30000 });
const waitDecided = () => page.waitForFunction(() => window.__HS_REPORTS_READY === true, null, { timeout: 30000 });
const modalState = () => page.evaluate(() => {
  const overlay = document.getElementById('premiumModal');
  const done = document.getElementById('premiumDone');
  const form = document.getElementById('premiumForm');
  const err = document.getElementById('premiumError');
  return {
    shown: !!(overlay && overlay.classList.contains('show')),
    title: ((document.getElementById('premiumTitle') || {}).textContent || '').trim(),
    doneHidden: !!(done && done.classList.contains('hidden')),
    formHidden: !!(form && form.classList.contains('hidden')),
    error: ((err && !err.classList.contains('hidden')) ? err.textContent : '').trim()
  };
});

console.log('='.repeat(78));
console.log('PROPERTY REPORTS PREMIUM — SHARED WAITLIST, TRUTHFUL SUCCESS/FAILURE');
console.log('='.repeat(78));

// ═══ A/B. Property context + Premium surface ═══
await page.goto(base + '/property.html?id=p2', { waitUntil: 'domcontentloaded' });
await waitShell();
await page.waitForSelector('#propReportBtn, .doact .btn', { timeout: 30000 });
const fromProperty = await page.evaluate(() => {
  const p = (HS.state.properties || []).filter(function (x) { return x && x.id === 'p2'; })[0] || {};
  return {
    urlId: new URL(location.href).searchParams.get('id'),
    address: (document.querySelector('.ph h1') || {}).textContent,
    expected: p.address,
    zip: p.zip
  };
});
ok(fromProperty.urlId === 'p2' && fromProperty.address === fromProperty.expected,
  'A the Address dossier is the originating property', fromProperty);
info('property', fromProperty);

const gen = page.locator('.doact .btn', { hasText: 'Generate property report' });
await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }), gen.click()]);
const reportsUrl = new URL(page.url());
ok(reportsUrl.pathname.endsWith('/reports.html') && reportsUrl.searchParams.get('id') === 'p2',
  'A Generate property report carries ?id=p2', page.url());
await waitShell(); await waitDecided();
const surface = await page.evaluate(() => {
  const t = document.body.innerText.replace(/\s+/g, ' ');
  return {
    id: new URL(location.href).searchParams.get('id'),
    h1: (document.querySelector('.ph h1') || {}).textContent,
    eyebrow: (document.querySelector('.eyebrow') || {}).textContent,
    identity: (document.getElementById('repIdentity') || {}).textContent,
    cta: (document.getElementById('repPremiumBtn') || {}).textContent,
    text: t.slice(0, 280)
  };
});
ok(surface.id === 'p2', 'A reports.html kept the originating id');
ok(/PROPERTY REPORTS/.test(surface.eyebrow) && /PREMIUM/.test(surface.eyebrow),
  'B labelled PROPERTY REPORTS · PREMIUM', surface.eyebrow);
ok(surface.h1 === 'Property reports are coming soon', 'B heading is coming soon, not a generated report', surface.h1);
ok((surface.identity || '').indexOf(fromProperty.expected) >= 0, 'A originating address is on the page', surface);
ok((surface.cta || '').trim() === 'Get Premium access →', 'B frozen CTA', surface.cta);

// ═══ C. Shared Premium modal ═══
await page.click('#repPremiumBtn');
let modal = await modalState();
ok(modal.shown && modal.title === 'Premium is being built',
  'C Get Premium access opens the shared waitlist modal', modal);
ok(modal.doneHidden && !modal.formHidden, 'C notify-me form, not a granted-access or generated-report state', modal);

// ═══ F. Failed write → no false success ═══
const failEmail = 'waitlist.ui.refused@example.com';
await page.route('**/rest/v1/rpc/hs_premium_waitlist_join', async (route) => {
  await route.fulfill({
    status: 404,
    contentType: 'application/json',
    body: JSON.stringify({
      code: 'PGRST205',
      message: "Could not find the table 'public.premium_waitlist' in the schema cache"
    })
  });
});
await page.fill('#premiumEmail', failEmail);
await page.click('#premiumSubmit');
await page.waitForTimeout(800);
modal = await modalState();
ok(modal.shown && modal.doneHidden, 'F a refused write does NOT show You\'re on the list', modal);
ok(!modal.formHidden, 'F the form stays up so the visitor can retry', modal);
ok(modal.error.length > 0, 'F an error is shown instead', modal);
await page.unroute('**/rest/v1/rpc/hs_premium_waitlist_join');

// ═══ D. Success through the shared RPC — fulfilled, never committed ═══
// The success payload is not invented: it is the DDL of record's own return expression,
// asserted against docs/premium-waitlist-capture.sql below, so the fixture cannot drift
// away from what production actually answers.
const RPC_SUCCESS_SHAPE = "jsonb_build_object('ok', true, 'email', e)";
const captureSql = await readFile(join(root, 'docs/premium-waitlist-capture.sql'), 'utf8');
ok(captureSql.indexOf(RPC_SUCCESS_SHAPE) >= 0,
  'D0 the fulfilled success shape is still the one hs_premium_waitlist_join returns',
  RPC_SUCCESS_SHAPE);

const joinCalls = [];
page.on('request', (r) => {
  if (/hs_premium_waitlist_join/.test(r.url())) {
    joinCalls.push({ url: r.url(), method: r.method(), post: r.postData() });
  }
});
const okEmail = 'waitlist.ui.fixture@example.com';
await page.route('**/rest/v1/rpc/hs_premium_waitlist_join', async (route) => {
  const sent = JSON.parse(route.request().postData() || '{}');
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ ok: true, email: String(sent.p_email || '').toLowerCase() })
  });
});
await page.fill('#premiumEmail', okEmail);
await page.click('#premiumSubmit');
await page.waitForFunction(() => {
  const done = document.getElementById('premiumDone');
  const err = document.getElementById('premiumError');
  const doneUp = done && !done.classList.contains('hidden');
  const errUp = err && !err.classList.contains('hidden') && (err.textContent || '').trim();
  return doneUp || errUp;
}, null, { timeout: 20000 });
modal = await modalState();
ok(!modal.doneHidden, 'D success is shown only after the shared handler accepts the write', modal);
ok(modal.formHidden, 'D the form yields to You\'re on the list', modal);
const payload = joinCalls.length ? JSON.parse(joinCalls[joinCalls.length - 1].post || '{}') : {};
info('join RPC', payload);
ok(payload.p_email === okEmail, 'D the email on the wire is the one entered', payload);
ok(typeof payload.p_source === 'string' && /reports\.html/.test(payload.p_source) && /id=p2/.test(payload.p_source),
  'D source is the Property Reports URL (existing path+query convention)', payload);
ok(payload.p_zip === fromProperty.zip && /^\d{5}$/.test(payload.p_zip || ''),
  'D ZIP is the resolved Address ZIP, not a guessed sample', { zip: payload.p_zip, expected: fromProperty.zip });
ok(joinCalls.length === 1, 'D the shared RPC was invoked exactly once', joinCalls.length);
// The client half of the signature check. §D2 proves the deployed function accepts
// exactly these four names; this proves the shipped client sends exactly them.
ok(JSON.stringify(Object.keys(payload).sort()) === JSON.stringify(['p_address', 'p_email', 'p_source', 'p_zip']),
  'D the wire payload carries the deployed 4-argument context, no more and no less', Object.keys(payload).sort());
ok('p_address' in payload, 'D address context is present on the wire (absent stays null, never omitted)', payload.p_address);
await page.unroute('**/rest/v1/rpc/hs_premium_waitlist_join');

// ═══ D2. PRODUCTION REACHABILITY — a real call to the deployed RPC that writes NOTHING ═══
// §D no longer touches production, so this is what stops that from becoming a coverage
// hole. It is NOT a new self-test RPC: it calls the shipped hs_premium_waitlist_join with
// the four deployed argument names and an email the function's OWN guard rejects. That
// guard raises 22023 BEFORE the insert, so the call proves reachability and signature and
// leaves no row. Verified against production 2026-09-12 (pg_net 31384/31385/31386):
//   correct 4 names + invalid email -> HTTP 400 {"code":"22023","message":"invalid email"}
//   a wrong argument name           -> HTTP 404 PGRST202 "no matches ... in the schema cache"
//   a function that does not exist  -> HTTP 404 PGRST202
//   rows before 44 -> rows after 44, written_in_last_10min = 0
// 22023 is therefore only reachable when PostgREST has the function in its schema cache,
// anon may execute it, the four names match, and the body RAN. The PGRST202 control is
// what makes that discriminating rather than merely green.
const CFG = String(await readFile(join(root, 'config.js'), 'utf8'));
const SUPA_URL = (CFG.match(/SUPABASE_URL:\s*'([^']+)'/) || [])[1];
const SUPA_KEY = (CFG.match(/SUPABASE_ANON_KEY:\s*'([^']+)'/) || [])[1];
const rpcProbe = async (fn, body) => {
  const r = await fetch(SUPA_URL + '/rest/v1/rpc/' + fn, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPA_KEY, Authorization: 'Bearer ' + SUPA_KEY },
    body: JSON.stringify(body)
  });
  return { status: r.status, json: await r.json().catch(() => ({})) };
};
ok(!!SUPA_URL && !!SUPA_KEY, 'D2 the shipped config supplies the production endpoint', { url: SUPA_URL });
let liveProbe = null;
try {
  liveProbe = await rpcProbe('hs_premium_waitlist_join',
    { p_email: '', p_source: '/reports.html?id=p2', p_zip: '78617', p_address: null });
} catch (e) {
  // An instrument must prove it ran before its silence counts as evidence. A blocked
  // egress is reported as an UNRUN probe, never as a pass — the build sandbox cannot
  // reach Supabase, the CI runner can.
  console.log('SKIP — D2 production probe DID NOT RUN (no egress to ' + SUPA_URL + '): ' + (e && e.message));
}
if (liveProbe) {
  info('D2 live', liveProbe);
  ok(liveProbe.status === 400 && liveProbe.json && liveProbe.json.code === '22023',
    'D2 the deployed RPC is reachable and its pre-INSERT guard ran', liveProbe);
  const control = await rpcProbe('hs_premium_waitlist_join', { p_email: '', p_bogus: 'x' });
  info('D2 control', control);
  ok(control.status === 404 && control.json && control.json.code === 'PGRST202',
    'D2 CONTROL a wrong argument name is refused, so 22023 really does discriminate', control);
}

// ═══ E. Acquisition Dashboard still has ONE waitlist read ═══
const acq = await page.goto(base + '/acquisition.html', { waitUntil: 'domcontentloaded' });
ok(acq && acq.ok(), 'E acquisition.html loads');
const dash = await page.evaluate(() => ({
  tab: !!document.getElementById('tab-premium'),
  src: document.documentElement.innerHTML
}));
ok(dash.tab, 'E the Premium waitlist tab still exists (same pipeline, not a second log)');
ok(/hs_premium_waitlist/.test(dash.src) && /canonical app_premium_waitlist/.test(dash.src),
  'E KPI + lead log still come from hs_premium_waitlist over app_premium_waitlist');
ok(!/property_reports_waitlist|premium_waitlist_reports/.test(dash.src),
  'E no Property-Reports-specific dashboard source was invented');

// ═══ G. Community Profile CTA still opens the same modal ═══
await page.goto(base + '/community.html?zip=78617', { waitUntil: 'domcontentloaded' });
await waitShell();
await page.waitForFunction(() => {
  const buttons = Array.from(document.querySelectorAll('button'));
  return buttons.some((b) => (b.textContent || '').trim() === 'Get Premium access →');
}, null, { timeout: 30000 });
const profileCta = page.locator('button', { hasText: 'Get Premium access →' }).first();
ok(await profileCta.count() > 0, 'G Community Profile still offers Get Premium access →');
await profileCta.click();
modal = await modalState();
ok(modal.shown && modal.title === 'Premium is being built',
  'G it still opens the shared Premium waitlist', modal);

ok(pageErrors.length === 0, 'no uncaught page errors during the journey', pageErrors);

await browser.close();
await new Promise(r => server.close(r));
console.log(fails ? '\n' + fails + ' assertion(s) FAILED.' : '\nAll property-reports Premium assertions passed.');
process.exit(fails ? 1 : 0);
