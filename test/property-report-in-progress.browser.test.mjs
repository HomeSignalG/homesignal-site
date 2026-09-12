// "GENERATE PROPERTY REPORT" — THE PUBLIC-BETA IN-PROGRESS STATE, DRIVEN IN A REAL BROWSER.
//
// test/nav-identity.test.mjs pins this contract STATICALLY — the copy, the CTA target, the
// return route, the absence of the retired prototype. What a source grep cannot see is the
// half that decides whether a resident is misled: the button appears only when the id it was
// handed resolves to a real saved Address, and lands them back on THAT Address rather than
// on whichever one happens to be active. Those are runtime decisions, so they are made here,
// by clicking, in the order a person clicks them.
//
// WHY THIS FILE EXISTS. Before 2026-09-11 the CTA opened dashboard.html#dashReports, whose
// "Property Intelligence Report" row links to itself; before that it opened a prototype that
// rendered a nearby project as though it were a generated report, with a Share button. Both
// answered the click with something other than the truth. The page under test answers it
// with the truth, and this file is what keeps that from silently regressing.
//
// Nothing here touches production: the static site is served locally and every outbound
// request is answered from fixtures. config.js is served with DATA_SOURCE flipped to the
// repo's own 'seed' mode, which is how the shell loads a resident's saved Addresses without
// a Supabase session — so the journey below is driven ENTIRELY by clicks, never by scripted
// navigation, and the id therefore travels exactly as the product makes it travel.
//
// Run: node test/property-report-in-progress.browser.test.mjs
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

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  const p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
  if (!p.startsWith(root)) { res.writeHead(403).end(); return; }
  try {
    let body = await readFile(p);
    // The one substitution, and it is the repo's own documented local mode: seed data, so
    // HS.state.properties is populated on EVERY page load the way a signed-in resident's
    // app_properties rows are. Nothing else in config.js is touched.
    if (p.endsWith('config.js')) body = Buffer.from(String(body).replace("DATA_SOURCE: 'supabase'", "DATA_SOURCE: 'seed'"));
    // Seed Addresses carry demo:true, which withholds the context map. Production saved
    // homes do not, and the map is what buried the CTA. Flip the flag so this journey
    // exercises the layout a real Address actually renders.
    if (p.endsWith('delvalle.js')) body = Buffer.from(String(body).replace(/demo:\s*true/g, 'demo:false'));
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

// Every request the journey makes, so §4 can assert on what it did NOT do.
const requests = [];
page.on('request', r => requests.push({ method: r.method(), url: r.url() }));

await page.route('**/*', async (route) => {
  const url = route.request().url();
  if (url.startsWith(base)) return route.continue();
  if (url.includes('cdn.jsdelivr.net')) {
    const kind = url.endsWith('.css') ? 'text/css' : 'text/javascript';
    return route.fulfill({ status: 200, contentType: kind, body: kind === 'text/css' ? '' : 'window.supabase={createClient:function(){return{};}};' });
  }
  return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
});

const waitShell = () => page.waitForFunction(() => !!document.querySelector('.nav a'), null, { timeout: 30000 });
// reports.html sets this once it has DECIDED whether a back action is warranted. Every
// assertion below about that action — present OR absent — waits on it first, because the
// absence and "not yet run" are the same DOM and only one of them is a finding.
const waitDecided = () => page.waitForFunction(() => window.__HS_REPORTS_READY === true, null, { timeout: 30000 });
const backBtn = () => page.$('#repBackBtn');
const bodyText = () => page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').trim());

console.log('='.repeat(78));
console.log('PROPERTY REPORT -> IN-PROGRESS STATE -> BACK TO THE EXACT PROPERTY');
console.log('='.repeat(78));

// ═══ 1. A real property, and its identity, recorded before anything is clicked ═══
// The SECOND seeded Address on purpose, not the first: an implementation that fell back to
// the active/default Address would still look correct on the first one.
await page.goto(base + '/properties.html', { waitUntil: 'domcontentloaded' });
await waitShell();
await page.waitForSelector('[data-kind="address"]', { timeout: 30000 });
const target = await page.evaluate(() => {
  const p = HS.state.properties[1];
  return { id: p.id, address: p.address };
});
info('target property', target);

// Opened the way a resident opens it — by clicking its card in My Places.
await Promise.all([
  page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
  page.click('[data-kind="address"][data-id="' + target.id + '"] h3')
]);
ok(new URL(page.url()).searchParams.get('id') === target.id,
  '1 My Places opens the Address on the app\'s own ?id= route', page.url());
await waitShell();
await page.setViewportSize({ width: 1280, height: 720 });
await page.waitForSelector('#propReportBtn', { timeout: 30000 });
await page.waitForSelector('#propContext', { timeout: 30000 });
const shownAddress = await page.evaluate(() => (document.querySelector('.ph h1') || {}).textContent);
ok(shownAddress === target.address, '1 the Address dossier is open on the property under test', { shownAddress, expected: target.address });
const fold = await page.evaluate(() => {
  const btn = document.getElementById('propReportBtn');
  const map = document.getElementById('propContext');
  const watch = document.querySelector('.doact .btn.primary');
  const r = btn ? btn.getBoundingClientRect() : null;
  return {
    hasMap: !!map,
    hasBtn: !!btn,
    watch: watch ? watch.textContent.trim() : null,
    top: r ? Math.round(r.top) : null,
    bottom: r ? Math.round(r.bottom) : null,
    vh: window.innerHeight,
    inView: !!(r && r.top >= 0 && r.bottom <= window.innerHeight && r.height > 0)
  };
});
ok(fold.hasMap && fold.hasBtn,
  '1 the Address map AND the Generate CTA are both on the page — otherwise a fold check is vacuous', fold);
ok(fold.inView,
  '1 Generate property report is in the 1280×720 viewport without scrolling', fold);
ok(fold.watch === 'Watch this property',
  '1 Watch this property is still the primary action next to the report CTA', fold);
await page.setViewportSize({ width: 390, height: 844 });
const mobileFold = await page.evaluate(() => {
  const btn = document.getElementById('propReportBtn');
  const r = btn ? btn.getBoundingClientRect() : null;
  const overflow = document.documentElement.scrollWidth > window.innerWidth + 1;
  return {
    top: r ? Math.round(r.top) : null,
    bottom: r ? Math.round(r.bottom) : null,
    vh: window.innerHeight,
    overflow,
    inView: !!(r && r.top >= 0 && r.bottom <= window.innerHeight && r.height > 0)
  };
});
ok(mobileFold.inView,
  '1 ...and at 390px too, because the actions column stacks first', mobileFold);
ok(!mobileFold.overflow, '1 ...and the 390px dossier does not scroll sideways', mobileFold);
await page.setViewportSize({ width: 1280, height: 720 });
const activeIsOther = await page.evaluate((id) => {
  const a = HS.state.activeProperty;
  return { activeId: a ? a.id : null, differs: !!a && a.id !== id };
}, target.id);
info('active property while on this page', activeIsOther);

// ═══ 2. Click the CTA — the journey is the click, never a scripted goto ═══
const cta = await page.$('#propReportBtn');
ok(!!cta, '2 the "Generate property report" CTA is on the page');
ok((await cta.textContent()).trim() === 'Generate property report', '2 ...with its label unchanged', (await cta.textContent()).trim());
const requestsBeforeClick = requests.length;
await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }), cta.click()]);
const landed = new URL(page.url());
ok(landed.pathname.endsWith('/reports.html'), '2 clicking it opens reports.html', page.url());
ok(landed.searchParams.get('id') === target.id, '2 ...carrying the ORIGINATING property, not a default', landed.search);
await waitShell(); await waitDecided();

// ═══ 3. What the resident is told — frozen Premium Property Reports treatment ═══
const txt = await bodyText();
ok(/PROPERTY REPORTS\s*·\s*PREMIUM/i.test(txt), '3 the page is labelled PROPERTY REPORTS · PREMIUM', txt.slice(0, 180));
ok(/Property reports are coming soon/.test(txt), '3 the page says "Property reports are coming soon"', txt.slice(0, 180));
ok(/Get a detailed report for this property, including property intelligence and nearby changes that may affect the property\./.test(txt),
  '3 ...and the frozen explainer');
ok(txt.includes(target.address), '3 the originating Address is visible on the page', { address: target.address, txt: txt.slice(0, 220) });
ok(/Get Premium access →/.test(txt), '3 the CTA is exactly "Get Premium access →"');
ok(!/We're working on this feature now\. Check back soon\./.test(txt), '3 the dead-end "check back soon" copy is gone');
// The retired prototype, by what a resident would actually see.
for (const gone of ['Share this report', 'Community Snapshot', 'Impact Analysis', 'Weekly Briefing', 'Bottom line', 'Recommended actions'])
  ok(!txt.includes(gone), '3 no trace of the retired prototype: "' + gone + '"');
const projectish = await page.evaluate(() => document.querySelectorAll('.card, .doc, .rrow, .rlist, .dsec').length);
ok(projectish === 0, '3 no report rows and no nearby-project preview document are rendered', projectish);
ok(!txt.includes(target.id), '3 the internal id is carried in the URL, never printed into the page');

// ═══ 3b. Get Premium access opens the SHARED waitlist modal ═══
const premiumCta = await page.$('#repPremiumBtn');
ok(!!premiumCta, '3b the Premium CTA is present');
ok((await premiumCta.textContent()).trim() === 'Get Premium access →', '3b ...with the frozen label');
await premiumCta.click();
const modal = await page.evaluate(() => {
  const overlay = document.getElementById('premiumModal');
  const title = document.getElementById('premiumTitle');
  const form = document.getElementById('premiumForm');
  const done = document.getElementById('premiumDone');
  const shown = overlay && overlay.classList.contains('show');
  return {
    shown: !!shown,
    title: title ? title.textContent.trim() : '',
    formVisible: !!(form && !form.classList.contains('hidden')),
    doneHidden: !!(done && done.classList.contains('hidden')),
    reportsForms: document.querySelectorAll('#hs-slot #premiumEmail, #repPremiumForm').length
  };
});
ok(modal.shown, '3b clicking it opens the existing Premium modal', modal);
ok(modal.title === 'Premium is being built', '3b ...the shared "Premium is being built" waitlist, not a report', modal);
ok(modal.formVisible && modal.doneHidden, '3b ...on the notify-me form, not a success state', modal);
ok(modal.reportsForms === 0, '3b ...and reports.html did not invent a second form', modal);
await page.keyboard.press('Escape');

// ═══ 4. Nothing was generated ═══
// Scoped to requests the CLICK itself issued. The Address map iframe POSTs to
// n5_projects_within_radius while the dossier is open; that call can land AFTER
// the click timestamp because the iframe is still in-flight when we navigate away.
// It is Map 1 loading, not a report being generated, so it is excluded by URL —
// counting it made the assertion red the moment the map (the layout this suite
// now requires) was present.
const afterClick = requests.slice(requestsBeforeClick)
  .filter(r => !/n5_projects_within_radius/.test(r.url));
const writes = afterClick.filter(r => r.method !== 'GET');
ok(writes.length === 0, '4 the click issued no write of any kind', writes.slice(0, 5));
const generated = afterClick.filter(r => /get-address-report|generate|report_pdf|property_reports|\.pdf/i.test(r.url));
ok(generated.length === 0, '4 ...and called no report generator, report API or dossier', generated.slice(0, 5));

// ═══ 5. Back to the EXACT property ═══
const back = await backBtn();
ok(!!back, '5 a "Back to property" action is offered when the id resolved');
ok((await back.textContent()).includes('Back to property'), '5 ...labelled "Back to property"', await back.textContent());
await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }), back.click()]);
await waitShell();
await page.waitForSelector('.ph h1', { timeout: 30000 });
const returned = new URL(page.url());
ok(returned.pathname.endsWith('/property.html') && returned.searchParams.get('id') === target.id,
  '5 it returns to the exact property from step 1', page.url());
ok((await page.evaluate(() => (document.querySelector('.ph h1') || {}).textContent)) === target.address,
  '5 ...and that Address is what renders', target.address);

// ═══ 6. Direct visit, no context — renders, with no broken affordance ═══
await page.goto(base + '/reports.html', { waitUntil: 'domcontentloaded' });
await waitShell(); await waitDecided();
const direct = await bodyText();
ok(/Property reports are coming soon/.test(direct), '6 a direct visit with no context still renders the coming-soon Premium surface');
ok(!(await backBtn()), '6 ...and offers NO "Back to property" action');
ok(!/Back to property/.test(direct), '6 ...not even as dead text', direct.slice(0, 140));

// ═══ 7. A stale or hand-typed id must not become somebody else's property ═══
// This is the assertion that separates "returns you where you were" from "returns you
// somewhere". An implementation inheriting property.html's `|| activeProperty` fallback
// passes every check above and fails this one.
await page.goto(base + '/reports.html?id=not-a-real-property', { waitUntil: 'domcontentloaded' });
await waitShell(); await waitDecided();
ok(/Property reports are coming soon/.test(await bodyText()), '7 an unresolvable id still renders the page');
ok(!(await backBtn()), '7 ...and offers no action, rather than one pointing at another property');

// ═══ 7b. The Address dossier itself must not inherit that fallback either ═══
// The production blank page was property.html?id=<a real uuid> with an empty
// #propPage. An unresolvable id is the other half of the same contract: named
// empty state, never another Address, never a blank slot.
await page.goto(base + '/property.html?id=not-a-real-property', { waitUntil: 'domcontentloaded' });
await waitShell();
await page.waitForFunction(() => {
  const el = document.querySelector('#propPage h1, .ph h1');
  return !!(el && el.textContent);
}, null, { timeout: 30000 });
const unknownDossier = await page.evaluate(() => ({
  h1: (document.querySelector('.ph h1') || {}).textContent,
  html: (document.getElementById('propPage') || {}).innerHTML || '',
  text: ((document.getElementById('propPage') || {}).innerText || '').replace(/\s+/g, ' ').trim()
}));
ok(/No Address/.test(unknownDossier.h1 || ''), '7b an unresolvable property id renders "No Address"', unknownDossier);
ok(unknownDossier.html.trim().length > 0, '7b ...and #propPage is not an empty slot');
ok(unknownDossier.h1 !== target.address && unknownDossier.text.indexOf(target.address) < 0,
  '7b ...and it does not render a different saved Address', unknownDossier);

// ═══ 8. The shell is intact, and so is the small screen ═══
await page.goto(base + '/reports.html?id=' + encodeURIComponent(target.id), { waitUntil: 'domcontentloaded' });
await waitShell(); await waitDecided();
const nav = await page.evaluate(() => ({
  sidebar: document.querySelectorAll('.nav a').length,
  active: [].slice.call(document.querySelectorAll('.nav a.on')).map(a => a.getAttribute('data-nav'))
}));
ok(nav.sidebar > 0, '8 the page renders inside the shared shell, so nobody is stranded', nav);
ok(nav.active.length === 0, '8 ...and lights no sidebar item, as a hidden section should', nav.active);

await page.setViewportSize({ width: 390, height: 844 });
await page.goto(base + '/reports.html?id=' + encodeURIComponent(target.id), { waitUntil: 'domcontentloaded' });
await waitShell(); await waitDecided();
const mobile = await page.evaluate(() => ({
  overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
  h1: (document.querySelector('.ph h1') || {}).textContent,
  back: !!document.getElementById('repBackBtn')
}));
ok(!mobile.overflow, '8 at 390px the page does not scroll sideways', mobile);
ok(mobile.h1 === 'Property reports are coming soon' && mobile.back, '8 ...and still carries the message and the way back', mobile);

ok(pageErrors.length === 0, 'no uncaught page errors during the journey', pageErrors);

await browser.close();
await new Promise(r => server.close(r));
console.log(fails ? '\n' + fails + ' assertion(s) FAILED.' : '\nAll property-report in-progress assertions passed.');
process.exit(fails ? 1 : 0);
