// THE USER JOURNEY, ON THE DEPLOYED SITE — navigation identity + location context.
//
// The offline twin (test/user-journey.browser.test.mjs) proves the rules against fixtures.
// This proves the PRODUCT: it opens homesignal.net in a real browser and walks the journey
// the founder walked when they found both defects — Alerts -> Maps, Development -> Maps,
// a ZIP that is not the saved home's ZIP, an address search, and back to a ZIP.
//
// Read-only. It signs nothing in, writes nothing, and makes only the calls the pages
// themselves make. The one thing it injects is a saved home into the page's own in-memory
// state (HS.state.properties) — production cannot hand an anonymous browser a signed-in
// user's home, and that is the exact state the founder's screenshot was taken in. Nothing
// is persisted: it lives for the life of the tab.
//
// Run: BASE=https://homesignal.net node scripts/map1-journey-live.mjs
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'https://homesignal.net';
const ZIP = process.env.ZIP || '78617';
const OTHER_ZIP = process.env.OTHER_ZIP || '80210';
const ADDRESS = process.env.ADDRESS || '2200 CALDWELL LN, DEL VALLE, TX 78617';

let fails = 0;
const ok = (c, name, detail) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name);
  if (!c) { fails++; if (detail !== undefined) console.log('           detail: ' + JSON.stringify(detail).slice(0, 400)); }
};
const info = (k, v) => console.log('   · ' + k + ': ' + (typeof v === 'string' ? v : JSON.stringify(v)));

// The saved home from the founder's own session: a real home, in Del Valle, NOT in Denver.
const SAVED_HOME = { id: 'live-home', label: 'Your home', tag: 'Your home', address: '13313 COOMES DR',
  city: 'Del Valle', state: 'TX', zip: '78617', lat: 30.1760, lng: -97.6098 };

const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e).slice(0, 200)));

const chrome = () => page.evaluate(() => {
  const on = [].slice.call(document.querySelectorAll('.nav a.on'));
  const el = document.getElementById('locLabel');
  return {
    activeTokens: on.map(a => a.getAttribute('data-nav')),
    activeLabels: on.map(a => a.textContent.trim().replace(/\s+/g, ' ')),
    locLabel: el ? el.textContent.trim() : null,
    kDev: (document.getElementById('kDev') || {}).textContent || null,
    kFac: (document.getElementById('kFac') || {}).textContent || null,
    totalTileShown: (() => { const t = document.getElementById('ccTot');
      return !!t && getComputedStyle(t).display !== 'none'; })(),
    covNote: (document.getElementById('covNote') || {}).textContent || '',
    covNoteShown: (() => { const n = document.getElementById('covNote');
      return !!n && getComputedStyle(n).display !== 'none'; })(),
    mapCap: (document.querySelector('.map-cap') || {}).textContent || '',
    hero: (document.querySelector('.sub') || {}).textContent || '',
    savedHome: (window.HS && HS.state && HS.state.activeProperty)
      ? { address: HS.state.activeProperty.address, zip: HS.state.activeProperty.zip } : null,
    path: location.pathname, search: location.search
  };
});
const waitShell = () => page.waitForFunction(() => !!document.querySelector('.nav a'), null, { timeout: 60000 });
const waitMap = () => page.waitForFunction(() => Array.isArray(window.__HS_SITES), null, { timeout: 90000 });
const installSavedHome = () => page.evaluate((h) => {
  HS.state.properties = [h];
  HS.state.activePropId = h.id;
  const cur = HS.state.viewLabel, precise = HS.state.viewLabelPrecise;
  HS.setViewLabel(cur + ' ·', { precise: precise });     // repaint through the shipped path only
  HS.setViewLabel(cur, { precise: precise });
}, SAVED_HOME);

console.log('='.repeat(78));
console.log('MAP 1 — LIVE USER JOURNEY (navigation identity + location context)');
info('base', BASE); info('zip', ZIP); info('other zip', OTHER_ZIP); info('address', ADDRESS);
console.log('='.repeat(78));

// ── A. Development & Impact identifies itself ───────────────────────────────────────────
await page.goto(BASE + '/development.html?zip=' + ZIP, { waitUntil: 'domcontentloaded', timeout: 60000 });
await waitShell();
let c = await chrome();
info('development.html', c.activeTokens);
ok(c.activeTokens.length === 1 && c.activeTokens[0] === 'dev',
  'A Development & Impact is the ONLY active item on development.html', c.activeLabels);
ok(c.activeTokens.indexOf('maps') < 0, 'A Maps is NOT active there', c.activeTokens);

// ── B. Map 1 identifies itself ──────────────────────────────────────────────────────────
await page.goto(BASE + '/homesignalmap.html?zip=' + ZIP, { waitUntil: 'domcontentloaded', timeout: 60000 });
await waitShell();
await waitMap();
c = await chrome();
info('homesignalmap.html', c.activeTokens);
ok(c.activeTokens.length === 1 && c.activeTokens[0] === 'maps',
  'B Maps is the ONLY active item on Map 1', c.activeLabels);
ok(c.activeTokens.indexOf('dev') < 0, 'B Development & Impact is NOT active on Map 1', c.activeTokens);

// ── E. ...and the proven ZIP contract is untouched ──────────────────────────────────────
const z = await page.evaluate(() => ({
  within: (document.getElementById('withinLbl') || {}).textContent,
  radiusVisible: (() => { const e = document.getElementById('radSel'); if (!e) return false;
    const cs = getComputedStyle(e); return cs.display !== 'none' && cs.visibility !== 'hidden'; })(),
  homePins: document.querySelectorAll('.homepin').length,
  sites: (window.__HS_SITES || []).length,
  devPoints: (window.__HS_SITES || []).filter(s => s.scope === 'point' && s.relevance === 'development').length,
  authoritative: (window.__HS_SITES || []).filter(s => s.zip_authoritative).length,
  distances: (window.__HS_SITES || []).filter(s => s.distance_mi != null).length,
  fresh: (document.getElementById('freshLine') || {}).textContent
}));
info('ZIP ' + ZIP, z);
ok(/Across ZIP/.test(z.within || ''), 'E ZIP mode still shows the whole ZIP', z.within);
ok(z.radiusVisible === false, 'E no address-radius control in ZIP mode');
ok(z.homePins === 0, 'E no HOME pin in ZIP mode');
ok(z.devPoints > 0 && z.devPoints === z.authoritative,
  'E every ZIP development point is authoritative whole-ZIP geometry', z);
ok(z.distances === 0, 'E no radius distance in ZIP mode', z.distances);

// ── C / D. Reaching Maps from other sections ────────────────────────────────────────────
for (const [origin, label] of [['alerts.html', 'C Alerts'], ['development.html', 'D Development & Impact']]) {
  await page.goto(BASE + '/' + origin + '?zip=' + ZIP, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await waitShell();
  const href = await page.getAttribute('.nav a[data-nav="maps"]', 'href');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 60000 }),
    page.click('.nav a[data-nav="maps"]')
  ]);
  await waitShell();
  await waitMap().catch(() => {});
  c = await chrome();
  info(label + ' -> Maps', { href, landed: c.path + c.search, active: c.activeTokens });
  ok(/homesignalmap\.html/.test(href || ''), label + ' -> the Maps entry points at Map 1', href);
  ok(/\/homesignalmap\.html$/.test(c.path), label + ' -> lands on Map 1', c.path);
  ok(c.activeTokens.length === 1 && c.activeTokens[0] === 'maps',
    label + ' -> Maps is active once the page settles', c.activeTokens);
  ok(c.activeTokens.indexOf('dev') < 0, label + ' -> Development & Impact is NOT active', c.activeTokens);
}

// ── F. A saved home in Del Valle, a map of Denver ───────────────────────────────────────
await page.goto(BASE + '/homesignalmap.html?zip=' + OTHER_ZIP, { waitUntil: 'domcontentloaded', timeout: 60000 });
await waitShell();
await waitMap();
await installSavedHome();
await page.waitForTimeout(500);
c = await chrome();
info('ZIP ' + OTHER_ZIP + ' with a Del Valle saved home', { loc: c.locLabel, saved: c.savedHome });
ok(!!c.locLabel && c.locLabel.indexOf('13313 COOMES DR') < 0,
  'F the saved Del Valle home is NOT presented as the current geography', c.locLabel);
ok(/^Viewing ·/.test(c.locLabel || ''), 'F the control names the CURRENT VIEW', c.locLabel);
ok(new RegExp(OTHER_ZIP).test(c.locLabel || ''), 'F ...and names the ZIP on screen', c.locLabel);
ok(!!(c.savedHome && c.savedHome.address === '13313 COOMES DR'),
  'F the saved home is preserved, unchanged', c.savedHome);

// positive control: on the home's OWN ZIP it still reads "Your home"
await page.goto(BASE + '/homesignalmap.html?zip=' + ZIP, { waitUntil: 'domcontentloaded', timeout: 60000 });
await waitShell();
await waitMap();
await installSavedHome();
await page.waitForTimeout(500);
c = await chrome();
info('ZIP ' + ZIP + ' with the same saved home', c.locLabel);
ok(/^Your home · 13313 COOMES DR/.test(c.locLabel || ''),
  'F POSITIVE CONTROL — on the home\'s own ZIP the control still says "Your home"', c.locLabel);

// ── G. Address mode still reaches the established experience ────────────────────────────
await page.fill('#addr', ADDRESS);
await page.click('#go');
await page.waitForFunction(() => (window.__HS_SITES || []).some(s => s.n5_feature_id), null, { timeout: 120000 });
await page.waitForTimeout(1000);
const a = await page.evaluate(() => ({
  within: (document.getElementById('withinLbl') || {}).textContent,
  radiusVisible: (() => { const e = document.getElementById('radSel'); if (!e) return false;
    const cs = getComputedStyle(e); return cs.display !== 'none' && cs.visibility !== 'hidden'; })(),
  homePins: document.querySelectorAll('.homepin').length,
  canonical: (window.__HS_SITES || []).filter(s => s.n5_feature_id).length
}));
c = await chrome();
info('address mode', { ...a, loc: c.locLabel });
ok(/Within/.test(a.within || ''), 'G address mode states the radius', a.within);
ok(a.radiusVisible === true, 'G the radius control is available in address mode');
ok(a.homePins === 1, 'G HOME is pinned at the geocoded address', a.homePins);
ok(a.canonical > 0, 'G canonical radius results render', a.canonical);
ok(/CALDWELL/i.test(c.locLabel || ''), 'G the current view follows the searched address', c.locLabel);
ok(c.activeTokens.length === 1 && c.activeTokens[0] === 'maps', 'G Maps is still the active item', c.activeTokens);

// ── H. ZIP -> address -> ZIP ────────────────────────────────────────────────────────────
await page.goto(BASE + '/homesignalmap.html?zip=' + OTHER_ZIP, { waitUntil: 'domcontentloaded', timeout: 60000 });
await waitShell();
await waitMap();
await installSavedHome();
await page.waitForTimeout(500);
c = await chrome();
const back = await page.evaluate(() => ({
  within: (document.getElementById('withinLbl') || {}).textContent,
  homePins: document.querySelectorAll('.homepin').length,
  stale: (window.__HS_SITES || []).filter(s => s.n5_feature_id).length
}));
info('back to ZIP ' + OTHER_ZIP, { loc: c.locLabel, ...back });
ok(new RegExp(OTHER_ZIP).test(c.locLabel || '') && !/CALDWELL/i.test(c.locLabel || ''),
  'H returning to a ZIP drops the address from the current view', c.locLabel);
ok(/Across ZIP/.test(back.within || ''), 'H ...and the page is back in whole-ZIP mode', back.within);
ok(back.stale === 0, 'H no address-radius result survives into ZIP mode', back.stale);
ok(back.homePins === 0, 'H no HOME pin in ZIP mode');
ok(!!(c.savedHome && c.savedHome.address === '13313 COOMES DR'),
  'H the saved home survived the whole journey', c.savedHome);

// ── I. F1 — the two scopes on one screen, live ──────────────────────────────────────────
// Development is measured across the whole ZIP; facilities are an EPA query AROUND it (44% of
// the facilities shown on a ZIP page sat outside that ZIP, measured over the 50 ZIPs that have
// authoritative boundaries). The page must say which is which, and must not add them together.
const WHOLE_ZIP_FACILITY_CLAIM = /(facilit\w*[^.]{0,80}\b(?:for|in|across)\s+(?:this|the)\s+ZIP)|((?:for|in|across)\s+(?:this|the)\s+ZIP[^.]{0,80}\bfacilit)/i;
// A live FACILITIES-ONLY control, chosen from production so the state actually renders:
// 71104 (Shreveport LA) carries 40 EPA facilities, 0 development records and no authoritative
// development membership, so the coverage note fires - the exact page state whose sentence
// used to read "Showing EPA-registered facilities for this ZIP."
const FAC_ZIP = process.env.FAC_ZIP || '71104';

await page.goto(BASE + '/homesignalmap.html?zip=' + ZIP, { waitUntil: 'domcontentloaded', timeout: 60000 });
await waitShell();
await waitMap();
await page.waitForTimeout(600);
c = await chrome();
const counts = await page.evaluate(() => ({ dev: (document.getElementById('cDev')||{}).textContent,
  fac: (document.getElementById('cFac')||{}).textContent,
  devMarkers: (window.__HS_SITES||[]).filter(s => s.scope==='point' && s.relevance==='development').length,
  facMarkers: (window.__HS_SITES||[]).filter(s => s.scope==='point' && s.relevance!=='development').length }));
info('ZIP ' + ZIP + ' scope copy', { kDev: c.kDev, kFac: c.kFac, totalTileShown: c.totalTileShown, mapCap: c.mapCap, counts });
ok(/across this ZIP/i.test(c.kDev || ''), 'I1 development is described as ACROSS this ZIP', c.kDev);
ok(/^Nearby regulated facilities$/i.test((c.kFac || '').trim()),
  'I2 facilities are described as NEARBY, not as a ZIP measurement', c.kFac);
ok(!WHOLE_ZIP_FACILITY_CLAIM.test(c.kFac + ' ' + c.covNote + ' ' + c.mapCap + ' ' + c.hero),
  'I3 no ZIP-mode wording says facilities are for/in/across this ZIP',
  { kFac: c.kFac, covNote: c.covNote, mapCap: c.mapCap, hero: c.hero });
ok(c.totalTileShown === false, 'I4 no mixed-geography total is displayed in ZIP mode');
ok(counts.devMarkers > 0 && counts.facMarkers > 0,
  'I5 both development and facility markers still render', counts);
ok(/^\d+$/.test((counts.dev||'').trim()) && /^\d+$/.test((counts.fac||'').trim()),
  'I6 both counts still render', counts);

// ── J. F1 — the facilities-only state, live ─────────────────────────────────────────────
await page.goto(BASE + '/homesignalmap.html?zip=' + FAC_ZIP, { waitUntil: 'domcontentloaded', timeout: 60000 });
await waitShell();
await waitMap();
await page.waitForTimeout(900);
c = await chrome();
info('facilities-only control ' + FAC_ZIP, { covNote: c.covNote, kFac: c.kFac, totalTileShown: c.totalTileShown });
// VACUITY GUARD, first: an absent coverage note would make every J assertion below pass
// by saying nothing. This control was picked BECAUSE the note fires here, so if it does not
// render the right thing to do is investigate, never to score a silent page as green.
ok(c.covNoteShown === true && /Nearby EPA-registered facilities are shown for additional local context/i.test(c.covNote || ''),
  'J0 the corrected facilities-only sentence is actually ON SCREEN (not a vacuous pass)',
  { covNoteShown: c.covNoteShown, covNote: c.covNote });
ok(!/Showing EPA-registered facilities for this ZIP/i.test(c.covNote || ''),
  'J1 the false whole-ZIP sentence is absent from production', c.covNote);
ok(!WHOLE_ZIP_FACILITY_CLAIM.test((c.covNote || '') + ' ' + (c.kFac || '')),
  'J2 nothing on this page claims the facilities are the ZIP’s', { covNote: c.covNote, kFac: c.kFac });
ok(/^Nearby regulated facilities$/i.test((c.kFac || '').trim()),
  'J3 the facility counter is labelled as nearby context', c.kFac);
ok(c.totalTileShown === false, 'J4 no mixed total on a facilities-only ZIP');

ok(errors.length === 0, 'no fatal client error across the live journey', errors.slice(0, 3));

console.log('='.repeat(78));
console.log('FAILS: ' + fails);
console.log('='.repeat(78));
await browser.close();
process.exit(fails ? 1 : 0);
