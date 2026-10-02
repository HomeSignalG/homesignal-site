// DEVELOPMENT ACTIVITY LANDING PAGE — driven in a real browser.
//
// Proves the behaviour the brief asks the page to demonstrate, on the shipped file:
//   * the shared shell is the only chrome (the three primary items of the founder navigation plan
//     v3, and Enterprise is the one lit — this page IS Enterprise);
//   * the sample report keeps the real hierarchy, and Type and Stage are two separate fields;
//   * selecting a Type filters that Type across ALL THREE Stage sections at once, dims the same
//     projects on the evidence plot, and shows an honest empty line where a Stage has none;
//   * the commerce buttons are hidden and do nothing (entitlement and checkout do not exist; the
//     founder listed the page on 2026-10-02 with the buttons hidden), and the Enterprise contact
//     link is the visible, working action;
//   * the coverage check answers only what it can prove, and says so when it cannot;
//   * a phone-width viewport does not scroll sideways.
//
// Nothing here touches production: the static site is served locally, config.js is flipped to seed,
// and every outbound request is answered from fixtures. HS.data.isCovered and HS.sb are stubbed in
// the page for the coverage cases, so the assertions are about THIS page's handling of each answer.
//
// Run: node test/development-activity-landing.browser.test.mjs
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, normalize } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = process.env.DA_SHOTS_DIR || '';
let fails = 0;
const ok = (c, name, detail) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name);
  if (!c) { fails++; if (detail !== undefined) console.log('           detail: ' + JSON.stringify(detail)); }
};

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  const p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
  if (!p.startsWith(root)) { res.writeHead(403).end(); return; }
  try {
    let body = await readFile(p);
    if (p.endsWith('config.js')) {
      body = Buffer.from(String(body)
        .replace("DATA_SOURCE: 'supabase'", "DATA_SOURCE: 'seed'")
        .replace('DEMO_SESSION: false', 'DEMO_SESSION: true'));
    }
    res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' }).end(body);
  } catch { res.writeHead(404).end('not found'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch();

async function open(width, height) {
  const ctx = await browser.newContext({ viewport: { width, height } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.startsWith(base)) return route.continue();
    if (url.includes('cdn.jsdelivr.net')) {
      return route.fulfill({ status: 200, contentType: 'text/javascript', body: 'window.supabase={createClient:function(){return{};}};' });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.goto(base + '/development-activity.html', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#daReport .da-card', { timeout: 30000 });
  return { ctx, page, errors };
}

const shape = (page) => page.evaluate(() => {
  const vis = (n) => !n.hidden && n.offsetParent !== null;
  const stages = ['approved', 'proposed', 'permitted'].map((k) => {
    const sec = document.getElementById('daStage-' + k);
    return {
      key: k,
      shown: [...sec.querySelectorAll('.da-card')].filter(vis).map((c) => c.dataset.n + ':' + c.dataset.type),
      count: sec.querySelector('.da-stagehead span').textContent,
      empty: (() => { const e = sec.querySelector('.da-empty'); return e && !e.hidden ? e.textContent : ''; })(),
      nav: [...document.querySelectorAll('#daStageLinks a')].find((a) => a.getAttribute('href') === '#daStage-' + k).querySelector('b').textContent
    };
  });
  return {
    pressed: [...document.querySelectorAll('#daTypeChips .da-chip')].filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.textContent),
    stages,
    dimmed: [...document.querySelectorAll('#daPlot .da-mk.dim')].length,
    markers: document.querySelectorAll('#daPlot .da-mk').length,
    status: document.getElementById('daFilterStatus').textContent
  };
});

// ---------------------------------------------------------------------------------------------
const D = await open(1360, 900);
const page = D.page;

console.log('--- 1. the shared shell, and nothing but the shared shell ---');
const shell = await page.evaluate(() => ({
  // Primary items carry data-nav; the Explore dropdown's entries (founder, 2026-10-02) do not.
  navLinks: [...document.querySelectorAll('#hs-nav a[data-nav]')].map((a) => a.getAttribute('href').split('?')[0]),
  sidebars: document.querySelectorAll('.side').length,
  navs: document.querySelectorAll('nav').length,
  lit: [...document.querySelectorAll('#hs-nav a.on')].map((a) => a.getAttribute('data-nav')),
  logo: document.querySelectorAll('.logo').length,
  upsell: document.querySelectorAll('.upsell').length,
  top: document.querySelectorAll('#hs-top').length,
  inSlot: !!document.querySelector('#hs-slot .page.da'),
  outsideSlot: document.querySelectorAll('.da').length - document.querySelectorAll('#hs-slot .da, #hs-slot .da *').length
}));
ok(JSON.stringify(shell.navLinks) === JSON.stringify(['index.html', 'properties.html', 'development-activity.html']),
  'the sidebar is the three primary items: Explore, My Places, Enterprise (plan v3)', shell.navLinks);
ok(shell.sidebars === 1 && shell.logo === 1 && shell.top === 1 && shell.navs === 1, 'one sidebar, one logo, one top bar, one <nav>: the page adds none', shell);
ok(JSON.stringify(shell.lit) === JSON.stringify(['enterprise']),
  'exactly one sidebar entry is lit, and it is Enterprise: this page is the Enterprise item (plan v3)', shell.lit);
ok(shell.inSlot, 'the page content is mounted in the shell slot');

console.log('--- 2. the sample keeps the real report hierarchy ---');
const order = await page.evaluate(() => {
  const r = document.getElementById('daReport');
  const idx = (sel) => { const n = r.querySelector(sel); return n ? [...r.querySelectorAll('*')].indexOf(n) : -1; };
  return {
    header: idx('.da-rhead'), activity: idx('#daActivity'), scan: idx('#daScan'), map: idx('#daMap'),
    approved: idx('#daStage-approved'), proposed: idx('#daStage-proposed'), permitted: idx('#daStage-permitted'),
    evidence: [...r.querySelectorAll('.da-rlab')].map((n) => n.textContent),
    text: r.textContent
  };
});
const seq = [order.header, order.activity, order.scan, order.map, order.approved, order.proposed, order.permitted];
ok(seq.every((n, i) => n > -1 && (i === 0 || n > seq[i - 1])),
  'header → Recent Official Activity → Type + Stage scan → Development Activity Map → Approved → Proposed → Permitted', seq);
ok(order.evidence[0] === 'Recent Official Activity' && order.evidence.includes('Development Activity Map') && order.evidence.includes('Official Evidence & Coverage'),
  'the report labels are the approved ones', order.evidence);
ok(!/what changed|what exists today/i.test(order.text), 'the sample makes no "What Changed" claim and has no What Exists Today section');
ok(/1234 Sample Street/i.test(order.text) && /Sample Realty · Agent Name/.test(order.text) && /Generated /.test(order.text),
  'property, brokerage/agent identity and generated date are present');

console.log('--- 3. Type and Stage are separate concepts ---');
const initial = await shape(page);
ok(JSON.stringify(await page.$$eval('#daTypeChips .da-chip', (b) => b.map((x) => x.textContent))) ===
  JSON.stringify(['All', 'Residential', 'Commercial', 'Industrial', 'Data Center', 'Roads & Infrastructure', 'Civic & Public']),
  'the Type row is All · Residential · Commercial · Industrial · Data Center · Roads & Infrastructure · Civic & Public');
ok(initial.pressed.join() === 'All', 'All is selected first', initial.pressed);
ok(JSON.stringify(await page.$$eval('#daStageLinks a', (a) => a.map((x) => x.firstChild.textContent))) ===
  JSON.stringify(['Approved / Coming', 'Proposed / Under Review', 'Permitted / Under Construction']), 'the Stage row is the three approved sections');
const cardParts = await page.$$eval('.da-card', (cs) => cs.map((c) => ({
  type: c.querySelector('.da-tag:not([class*="da-s-"]) i')?.textContent === 'Type',
  stage: c.querySelector('[class*="da-s-"] i')?.textContent === 'Stage',
  stageClass: [...c.querySelector('[class*="da-s-"]').classList].find((x) => x.startsWith('da-s-')),
  dataStage: c.dataset.stage
})));
ok(cardParts.length === 9 && cardParts.every((c) => c.type && c.stage && c.stageClass === 'da-s-' + c.dataStage),
  'every card states its Type and its Stage as two separate, labelled tags', cardParts.slice(0, 2));
ok(initial.stages.map((s) => s.shown.length).join() === '3,4,2' && initial.stages.map((s) => s.nav).join() === '3,4,2', 'all 9 entries show: 3 / 4 / 2', initial.stages);
ok(initial.dimmed === 0 && initial.markers === 9, 'all nine plot markers are drawn and none is dimmed');

console.log('--- 4. selecting a Type filters that Type across all three Stage sections ---');
const TYPES = { Residential: 'residential', Commercial: 'commercial', Industrial: 'industrial', 'Data Center': 'datacenter', 'Roads & Infrastructure': 'infrastructure', 'Civic & Public': 'civic' };
const allCards = await page.$$eval('.da-card', (cs) => cs.map((c) => ({ n: c.dataset.n, type: c.dataset.type, stage: c.dataset.stage })));
for (const [label, key] of Object.entries(TYPES)) {
  await page.click('#daTypeChips .da-chip:text-is("' + label + '")');
  const s = await shape(page);
  const want = ['approved', 'proposed', 'permitted'].map((st) => allCards.filter((c) => c.type === key && c.stage === st).map((c) => c.n + ':' + c.type));
  const got = s.stages.map((x) => x.shown);
  const total = want.flat().length;
  ok(JSON.stringify(got) === JSON.stringify(want), label + ': shows exactly its entries in each of the three Stage sections', { want, got });
  ok(s.pressed.join() === label, label + ': only that chip is pressed', s.pressed);
  ok(s.dimmed === 9 - total, label + ': the same projects are dimmed on the evidence plot (' + (9 - total) + ')', s.dimmed);
  ok(s.stages.every((x, i) => x.nav === String(want[i].length)), label + ': the Stage row counts follow', s.stages.map((x) => x.nav));
  ok(s.stages.every((x, i) => (want[i].length === 0) === (x.empty !== '')), label + ': a Stage with none says so plainly instead of vanishing', s.stages.map((x) => x.empty));
  ok(new RegExp('Showing ' + total + ' ').test(s.status) && s.status.includes('three Stage sections'), label + ': the status line names the count and the three Stage sections', s.status);
}
await page.click('#daTypeChips .da-chip:text-is("Residential")');
const res = await shape(page);
ok(res.stages.map((x) => x.shown.length).join() === '1,1,1', 'Residential appears in Approved / Coming, Proposed / Under Review AND Permitted / Under Construction at once', res.stages.map((x) => x.shown));
await page.click('#daTypeChips .da-chip:text-is("Commercial")');
const com = await shape(page);
ok(com.stages[1].empty === 'No Commercial projects in this stage in this sample.' && com.stages[2].empty === 'No Commercial projects in this stage in this sample.',
  'Commercial has none in two Stages and the page says exactly that', com.stages.map((x) => x.empty));
await page.click('#daStageLinks a >> nth=2');
const afterStage = await shape(page);
ok(afterStage.pressed.join() === 'Commercial', 'choosing a Stage does not change the Type: they are independent', afterStage.pressed);
await page.click('#daTypeChips .da-chip:text-is("All")');
const back = await shape(page);
ok(back.stages.map((s) => s.shown.length).join() === '3,4,2' && back.dimmed === 0, 'All restores every entry');

console.log('--- 5. evidence plot: fixed 0.5 mile, linked to the cards, no photographs ---');
const plot = await page.evaluate(() => ({
  ringLabel: [...document.querySelectorAll('#daPlot text')].some((t) => t.textContent === '0.5 mi'),
  subject: [...document.querySelectorAll('#daPlot text')].some((t) => t.textContent === 'Property'),
  dists: [...document.querySelectorAll('.da-card')].map((c) => parseFloat(c.querySelector('.da-tags span:last-child').textContent)),
  controls: document.querySelectorAll('#daReport select, #daReport input[type=range], #daReport [name*=radius]').length,
  imgs: document.querySelectorAll('img, picture, video, canvas').length
}));
ok(plot.ringLabel && plot.subject, 'the plot marks the subject property and the 0.5 mile ring');
ok(plot.dists.every((d) => d > 0 && d <= 0.5), 'every entry is within 0.5 mile', plot.dists);
ok(plot.controls === 0, 'no radius selector exists on the page');
ok(plot.imgs === 0, 'no image, photograph, canvas or video on the page');
await page.click('.da-card[data-n="1"]');
const sel1 = await page.evaluate(() => ({ card: document.querySelector('.da-card[data-n="1"]').classList.contains('sel'), mk: [...document.querySelectorAll('#daPlot .da-mk')][0].classList.contains('sel') }));
ok(sel1.card && sel1.mk, 'selecting a project card selects its marker on the plot');
await page.click('#daPlot .da-mk >> nth=3');
const sel4 = await page.evaluate(() => document.querySelector('.da-card[data-n="4"]').classList.contains('sel') && !document.querySelector('.da-card[data-n="1"]').classList.contains('sel'));
ok(sel4, 'selecting a marker selects its project card');

console.log('--- 6. the commerce buttons are hidden and inert; Enterprise is a real link ---');
// Positive control: the same probe DOES see a modal when one is really open, so a zero below means something.
const probe = () => page.evaluate(() => document.querySelectorAll('.overlay.show, .overlay.open, .modal.show').length);
await page.evaluate(() => HS.openModal('premiumModal'));
const controlOpen = await probe();
await page.evaluate(() => HS.closeModal('premiumModal'));
ok(controlOpen > 0 && (await probe()) === 0, 'control: an opened modal is visible to the probe used below', controlOpen);
const urlBefore = page.url();
const seen = await page.evaluate(() => {
  const vis = (n) => n.offsetParent !== null && n.getClientRects().length > 0;
  const soon = [...document.querySelectorAll('.da-soon')];
  return {
    buttons: document.querySelectorAll('[data-cta]').length,
    visibleButtons: [...document.querySelectorAll('[data-cta]')].filter(vis).length,
    soon: soon.length,
    visibleSoon: soon.filter(vis).length,
    // Positive control for the visibility probe: the coverage button IS visible.
    control: vis(document.getElementById('daCoverBtn')),
    enterpriseVisible: vis(document.getElementById('daEnterprise'))
  };
});
ok(seen.control && seen.buttons === 4 && seen.visibleButtons === 0,
  'HIDDEN (founder, 2026-10-02): all four commerce buttons are on the page and none is visible (control: the coverage button is)', seen);
ok(seen.soon === 4 && seen.visibleSoon === 0, 'no "Opens at launch." note is visible either', seen);
ok(seen.enterpriseVisible, 'Contact us for Enterprise Pricing → is visible: it is the page\'s working action', seen);
// A hidden button cannot be clicked by a person; click it from script to prove it still does nothing.
await page.$$eval('[data-cta]', (bs) => bs.forEach((b) => b.click()));
const afterClicks = await page.evaluate(() => ({ overlays: document.querySelectorAll('.overlay.show, .modal.show').length, onboarding: document.querySelectorAll('.onboarding.show').length }));
ok(page.url() === urlBefore && afterClicks.overlays === 0 && afterClicks.onboarding === 0,
  'clicking any of the four commerce buttons from script opens nothing and goes nowhere', { url: page.url(), afterClicks });
ok((await page.$$eval('[data-cta]', (bs) => bs.every((b) => b.getAttribute('aria-disabled') === 'true'))), 'each is aria-disabled so assistive technology reads it as unavailable');
ok(await page.$eval('#daEnterprise', (a) => a.getAttribute('href') === 'contact.html' && a.textContent === 'Contact us for Enterprise Pricing →'), 'Contact us for Enterprise Pricing → opens the existing contact page');
ok(await page.$eval('#daHeroCheck', (a) => a.getAttribute('href') === '#coverage'), 'Check coverage → jumps to the coverage check near the hero');

console.log('--- 7. coverage check: answers only what it can prove ---');
async function ask(input, stubs) {
  await page.evaluate((s) => {
    window.__calls = [];
    HS.data.isCovered = async (z) => { window.__calls.push(z); if (s.coverError) throw new Error('down'); return !!s.covered[z]; };
    HS.sb = () => ({ functions: { invoke: async (name, o) => { window.__calls.push(name + ':' + o.body.address); if (s.geoError) return { error: new Error('502') }; return { data: { match: s.match } }; } } });
  }, stubs);
  await page.fill('#daCoverInput', input);
  await page.click('#daCoverBtn');
  await page.waitForFunction(() => { const r = document.getElementById('daCoverResult'); return r && !r.hidden && r.textContent.length > 0; });
  return page.evaluate(() => ({ cls: document.getElementById('daCoverResult').className, text: document.getElementById('daCoverResult').textContent, calls: window.__calls.slice() }));
}
let r = await ask('78617', { covered: { 78617: true } });
ok(/\bin\b/.test(r.cls) && r.text.includes('INSIDE THE PRODUCT NETWORK') && r.text.includes('ZIP 78617') && r.text.includes('Source depth and report readiness vary by property.'),
  'a covered ZIP: inside the product network, with the approved readiness sentence', r);
ok(!/REPORT-READY|CHANGE-READY|LIMITED COVERAGE/i.test(r.text.replace('does not determine report-ready or change-ready status', '')) && r.text.includes('does not determine report-ready or change-ready status'),
  'it does NOT claim Report-Ready or Change-Ready, and says the check does not determine them');
ok(JSON.stringify(r.calls) === JSON.stringify(['78617']), 'it asked the existing authority (HS.data.isCovered) about exactly that ZIP', r.calls);
r = await ask('00000', { covered: {} });
ok(/\bout\b/.test(r.cls) && r.text.includes('OUTSIDE COVERAGE') && r.text.includes('The property resolves outside HomeSignal’s canonical 12,722-ZIP product network.'), 'an uncovered ZIP: OUTSIDE COVERAGE with the approved sentence', r);
r = await ask('4400 Wildhorse Trail, Del Valle, TX', { covered: { 78617: true }, match: { zip: '78617', lat: 30.17, lng: -97.6, matchedAddress: '4400 WILDHORSE TRL, DEL VALLE, TX, 78617' } });
ok(/\bin\b/.test(r.cls) && r.text.includes('4400 WILDHORSE TRL, DEL VALLE, TX, 78617 · ZIP 78617') && r.calls[0].startsWith('geocode-address:') && r.calls[1] === '78617',
  'an address is confirmed through the existing geocoder, then its ZIP is checked', r);
r = await ask('4400 Wildhorse Trail, Del Valle, TX', { covered: {}, geoError: true });
ok(/\berr\b/.test(r.cls) && r.text.includes('This is not a coverage result.') && !/OUTSIDE COVERAGE/.test(r.text), 'a geocoder outage is reported as an outage, never as "outside coverage"', r);
r = await ask('4400 Wildhorse Trail, Del Valle, TX', { covered: {}, match: null });
ok(/\berr\b/.test(r.cls) && /couldn’t confirm that address/.test(r.text) && !/OUTSIDE COVERAGE/.test(r.text), 'an address with no Census match is not called outside coverage', r);
r = await ask('78617', { covered: {}, coverError: true });
ok(/\berr\b/.test(r.cls) && r.text.includes('This is not a coverage result.') && !/OUTSIDE COVERAGE/.test(r.text), 'a failed coverage read is not called outside coverage (measured zero ≠ failed read)', r);
r = await ask('abc', { covered: {} });
ok(/\berr\b/.test(r.cls) && /full street address, or a 5-digit ZIP/.test(r.text) && r.calls.length === 0, 'text that is neither a ZIP nor an address asks nothing', r);
await page.fill('#daCoverInput', '78617');
await page.evaluate(() => { window.__calls = []; HS.data.isCovered = async (z) => { window.__calls.push(z); return true; }; });
await page.press('#daCoverInput', 'Enter');
await page.waitForFunction(() => window.__calls.length === 1);
ok(true, 'Enter in the field runs the check');

if (SHOTS) {
  mkdirSync(SHOTS, { recursive: true });
  await page.click('#daTypeChips .da-chip:text-is("All")');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: join(SHOTS, 'desktop-top.png') });
  await page.screenshot({ path: join(SHOTS, 'desktop-full.png'), fullPage: true });
  await page.click('#daTypeChips .da-chip:text-is("Residential")');
  await page.locator('#sample').screenshot({ path: join(SHOTS, 'desktop-sample-residential.png') });
}
ok(D.errors.length === 0, 'no uncaught page errors on desktop', D.errors);
await D.ctx.close();

console.log('--- 8. phone width ---');
const M = await open(390, 844);
const mob = await M.page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, chips: document.querySelectorAll('#daTypeChips .da-chip').length }));
ok(mob.sw <= mob.cw, 'no horizontal scroll at 390px', mob);
await M.page.click('#daTypeChips .da-chip:text-is("Data Center")');
const mshape = await shape(M.page);
ok(mshape.stages.map((s) => s.shown.length).join() === '0,1,0' && mshape.dimmed === 8, 'the Type filter works on a phone', mshape.stages.map((s) => s.shown));
if (SHOTS) { await M.page.evaluate(() => window.scrollTo(0, 0)); await M.page.screenshot({ path: join(SHOTS, 'mobile-top.png') }); await M.page.screenshot({ path: join(SHOTS, 'mobile-full.png'), fullPage: true }); }
ok(M.errors.length === 0, 'no uncaught page errors on mobile', M.errors);
await M.ctx.close();

await browser.close();
server.close();
console.log(fails ? '\n' + fails + ' FAILURE(S)' : '\nALL PASS');
process.exit(fails ? 1 : 0);
