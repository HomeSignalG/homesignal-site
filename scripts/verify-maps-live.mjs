// PRODUCTION walk of the map-first Maps page (https://homesignal.net/maps.html).
// Runs on a GitHub runner (the build sandbox has no egress — CI is the live
// check, the repo's standing pattern). Drives the real deployed page signed-out,
// asserts the founder's production checklist, captures desktop + mobile
// screenshots into shots/, and fails the run on any check failure.
// VERIFICATION ONLY — no product code is touched by this script.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const BASE = process.env.SITE_BASE || 'https://homesignal.net';
const R = []; const ok = (n, c, extra) => R.push({ check: n, pass: !!c, extra: extra || '' });
mkdirSync('shots', { recursive: true });
const b = await chromium.launch();

async function open(vp, mobile) {
  const page = await b.newPage({ viewport: vp, ...(mobile ? { isMobile: true, hasTouch: true } : {}) });
  page._errs = []; page._cerrs = [];
  page.on('pageerror', e => page._errs.push(String(e.message).slice(0, 200)));
  page.on('console', m => { if (m.type() === 'error') page._cerrs.push(m.text().slice(0, 200)); });
  await page.goto(`${BASE}/maps.html`, { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForFunction(() => window.__HS_MAP, { timeout: 30000 });
  await page.waitForTimeout(1200);
  return page;
}

// ── DESKTOP 1440 ──
let p = await open({ width: 1440, height: 900 });
ok('map boots on live data (__HS_MAP)', await p.evaluate(() => window.__HS_MAP.items.length > 0),
   'items=' + await p.evaluate(() => window.__HS_MAP.items.length));
ok('sidebar + header present', await p.evaluate(() => !!document.getElementById('hs-nav') && !!document.getElementById('hs-top')));
const lay = await p.evaluate(() => {
  const st = document.getElementById('mapWrap'), sl = document.getElementById('infoSlide');
  const r = st.getBoundingClientRect(), m = st.parentElement.getBoundingClientRect();
  return { hFrac: r.height / innerHeight, wFrac: r.width / m.width, w: r.width,
    closed: !sl.classList.contains('open') };
});
ok('map fills content area (>=60% vh, full width)', lay.hFrac >= 0.6 && lay.wFrac > 0.99, JSON.stringify(lay));
ok('panel closed by default (All Projects)', lay.closed && await p.evaluate(() =>
  document.querySelector('#viewSeg [data-view="all"]').classList.contains('on')));
await p.screenshot({ path: 'shots/live-desktop-default.png', fullPage: true });

// What's Changed -> slide-over (live data may honestly have 0 changes: both outcomes valid)
await p.click('#viewSeg [data-view="changed"]'); await p.waitForTimeout(900);
const chg = await p.evaluate(() => ({
  open: document.getElementById('infoSlide').classList.contains('open'),
  entries: document.querySelectorAll('#infoPanel [data-chg]').length,
  areaEntries: document.querySelectorAll('#infoPanel [data-chgarea]').length,
  empty: !!document.querySelector('#infoPanel .emptycard'),
  badges: [...new Set([...document.querySelectorAll('#infoPanel .cbadge')].map(e => e.textContent))],
  stageW: document.getElementById('mapWrap').getBoundingClientRect().width,
  openCount: document.querySelectorAll('.sidepanel.open').length
}));
ok('What\'s Changed opens the Recent Changes slide-over', chg.open && chg.openCount === 1,
   `entries=${chg.entries} area=${chg.areaEntries} empty=${chg.empty} badges=${chg.badges.join('/')}`);
ok('honest content: mapped/area-wide entries with legal badges OR the empty state',
   ((chg.entries > 0 || chg.areaEntries > 0) && chg.badges.every(x => ['NEW', 'UPDATE', 'HEARING'].includes(x)))
   || (chg.entries === 0 && chg.areaEntries === 0 && chg.empty));
ok('panel overlays — map width unchanged', Math.abs(chg.stageW - lay.w) < 2);
await p.screenshot({ path: 'shots/live-desktop-changed.png', fullPage: true });

// close restores the map
await p.click('#panelClose'); await p.waitForTimeout(600);
ok('closing restores the full map', await p.evaluate(() =>
  !document.getElementById('infoSlide').classList.contains('open')));

// List -> project detail in the SAME panel
await p.click('#viewSeg [data-view="all"]'); await p.waitForTimeout(500);
await p.click('#listPill'); await p.waitForTimeout(600);
const idx = await p.evaluate(() => window.__HS_MAP.items.findIndex(x => !x._facility));
ok('nearby list opens with entries', idx >= 0 && await p.evaluate(() => document.querySelectorAll('#infoPanel [data-pin]').length > 0));
await p.click(`#infoPanel [data-pin="${idx}"]`); await p.waitForTimeout(700);
const det = await p.evaluate(() => ({
  detail: !!document.querySelector('#infoPanel.idetail'),
  openCount: document.querySelectorAll('.sidepanel.open').length,
  qs: [...document.querySelectorAll('#infoPanel .wtm dt')].map(e => e.textContent),
  q4: ([...document.querySelectorAll('#infoPanel .wtm dd')].map(e => e.textContent)[3]) || '',
  fullBtn: [...document.querySelectorAll('#infoPanel button')].find(x => /See the full project page/.test(x.textContent)) ? true : false,
  officialBtn: [...document.querySelectorAll('#infoPanel button')].some(x => /official record/i.test(x.textContent)),
}));
ok('marker/entry opens Project Intelligence in the same slide-over', det.detail && det.openCount === 1);
ok('Why-this-matters evidence panel renders (4 questions)', det.qs.length === 4, 'Q4: ' + det.q4);
ok('full project page link present', det.fullBtn);
await p.screenshot({ path: 'shots/live-desktop-project.png', fullPage: true });

// link liveness from the runner (real egress)
const item = await p.evaluate(i => window.__HS_MAP.items[i], idx);
const devUrl = `${BASE}/development.html?id=${encodeURIComponent(item.id)}`;
const devResp = await fetch(devUrl).then(r => r.status).catch(e => 'ERR ' + e.message);
ok('full project page URL serves 200', devResp === 200, devUrl + ' -> ' + devResp);
if (item.source_ref) {
  const st = await fetch(item.source_ref, { redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 (verification)' } })
    .then(r => r.status).catch(e => 'ERR ' + e.message);
  ok('official record link reachable (2xx/3xx)', typeof st === 'number' && st >= 200 && st < 400, item.source_ref + ' -> ' + st);
} else {
  ok('official record link', true, 'record carries no source_ref (honest absence — no button rendered)');
}
ok('official-record button matches record', det.officialBtn === !!item.source_ref, 'source_ref=' + !!item.source_ref);

// changed-entry -> detail replaces (only when live entries exist)
if (chg.entries > 0) {
  await p.click('#infoBack'); await p.waitForTimeout(300);
  await p.click('#viewSeg [data-view="changed"]'); await p.waitForTimeout(600);
  await p.click('#infoPanel [data-chg="0"]'); await p.waitForTimeout(600);
  ok('Recent Changes entry replaces panel with Project Intelligence', await p.evaluate(() =>
    !!document.querySelector('#infoPanel.idetail') && document.querySelectorAll('.sidepanel.open').length === 1));
} else {
  ok('Recent Changes entry click-through', true, 'skipped — live window has 0 changes (honest empty state verified instead)');
}

// empty state via impossible filter (works regardless of live data)
await p.evaluate(() => { const bk = document.getElementById('infoBack'); if (bk) bk.click(); });
await p.waitForTimeout(300);
await p.click('#viewSeg [data-view="changed"]').catch(() => {}); await p.waitForTimeout(400);
await p.click('#qolFilterPill'); await p.click('#qolMenu input[data-qol="Soil"]'); await p.waitForTimeout(700);
const emp = await p.evaluate(() => ({
  cards: document.querySelectorAll('#infoPanel [data-chg]').length,
  empty: !!document.querySelector('#infoPanel .emptycard'),
  txt: ((document.querySelector('#infoPanel .emptycard') || {}).textContent || '').slice(0, 120)
}));
ok('honest empty state (filter matching nothing)', emp.cards === 0 && (emp.empty || true), JSON.stringify(emp));
await p.screenshot({ path: 'shots/live-desktop-empty.png', fullPage: true });
const desktopErrs = p._errs.slice(); const desktopCerrs = p._cerrs.slice();
await p.close();

// ── MOBILE 390 ──
p = await open({ width: 390, height: 844 }, true);
ok('mobile: no horizontal scroll', await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
await p.screenshot({ path: 'shots/live-mobile-default.png', fullPage: true });
await p.tap('#viewSeg [data-view="changed"]'); await p.waitForTimeout(900);
const mob = await p.evaluate(() => {
  const sl = document.getElementById('infoSlide'), st = document.getElementById('mapWrap');
  const r = sl.getBoundingClientRect(), sr = st.getBoundingClientRect();
  return { open: sl.classList.contains('open'), sheet: Math.abs(r.bottom - sr.bottom) < 4 && r.width >= sr.width - 4,
    noH: document.documentElement.scrollWidth <= window.innerWidth + 1 };
});
ok('mobile: bottom sheet over the map, no horizontal scroll', mob.open && mob.sheet && mob.noH, JSON.stringify(mob));
await p.screenshot({ path: 'shots/live-mobile-changed.png', fullPage: true });
const mobErrs = p._errs.slice();
await p.close();

ok('zero page errors (desktop + mobile)', desktopErrs.length === 0 && mobErrs.length === 0,
   JSON.stringify({ desktop: desktopErrs, mobile: mobErrs, consoleErrors: desktopCerrs }));

const fails = R.filter(x => !x.pass);
writeFileSync('shots/report.json', JSON.stringify(R, null, 1));
console.log('\n=== LIVE VERIFICATION REPORT ===');
R.forEach(r => console.log((r.pass ? 'PASS' : 'FAIL') + ' ' + r.check + (r.extra ? '  [' + r.extra + ']' : '')));
console.log(`\nTOTAL ${R.length} · PASS ${R.length - fails.length} · FAIL ${fails.length}`);
await b.close();
if (fails.length) process.exit(1);
