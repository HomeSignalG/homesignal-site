// MAP 1 MARKET-READINESS GATE — the product check, driven as a resident would.
//
// This is NOT another backend certification. It opens the DEPLOYED page in a real browser,
// does what a user does, and asks user-level questions: does the map load, do results render,
// do the numbers agree with what is drawn, does clicking a marker explain itself, is the
// control set right for the mode.
//
// It walks BOTH geographic contracts, which must never be conflated:
//   ZIP MODE      = the entire actual ZIP/ZCTA geography, no radius.
//   ADDRESS MODE  = the geocoded HOME + a user-selected radius.
//
// THE HEADLINE INVARIANT IT EXISTS TO PROTECT
//
//   The big number a resident reads must be a projection of what the map actually draws.
//   The page states this contract itself, above #cDev: "it must equal the orange Proposed
//   rail." A tile that says 48 over a map drawing 40 is not a rounding difference - it is the
//   product telling the user something the evidence on screen contradicts, which is the
//   fastest way to lose their trust in everything else on the page.
//
//   Address mode already protects it: when canonical results replace the report engine's own
//   development set, it DELETES the engine's development counters so render() recomputes from
//   what is on screen. That makes address mode a POSITIVE CONTROL here - the same assertion
//   runs in both modes, and if it passes in address mode while failing in ZIP mode, the defect
//   is specific and the fix is the pattern address mode already proves.
//
// Run: BASE=https://homesignal.net node scripts/map1-ux-gate.mjs
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'https://homesignal.net';
const ZIP = process.env.ZIP || '78617';
const ADDRESS = process.env.ADDRESS || '2200 CALDWELL LN, DEL VALLE, TX 78617';

let fails = 0;
const ok = (c, name, detail) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name);
  if (!c) { fails++; if (detail !== undefined) console.log('           detail: ' + JSON.stringify(detail).slice(0, 400)); }
};
const info = (k, v) => console.log('   · ' + k + ': ' + (typeof v === 'string' ? v : JSON.stringify(v)));

const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e).slice(0, 200)));

// What a resident actually sees: the counter tiles, and the rails the map is drawn from.
const readScreen = () => page.evaluate(() => {
  const txt = (id) => { const el = document.getElementById(id); return el ? el.textContent.trim() : null; };
  const num = (id) => { const t = txt(id); const n = Number(String(t).replace(/[^0-9.]/g, '')); return t === '—' ? 'unavailable' : (isFinite(n) ? n : null); };
  const sites = window.__HS_SITES || [];
  // The page's own predicates, mirrored so the rails are read the way it computes them.
  const bucketOf = (t) => String(t || '').toLowerCase();
  const devPoint = (s) => s.scope === 'point' && s.relevance === 'development';
  const areaDev = (s) => s.scope === 'area' && s.relevance !== 'civic';
  const proposed = sites.filter(s => (devPoint(s) || areaDev(s)) && bucketOf(s.type) === 'proposed');
  return {
    tile_proposed: num('cDev'),
    tile_facilities: num('cFac'),
    tile_open: num('cOpen'),
    tile_total: num('cTot'),
    total_tile_shown: (() => { const t = document.getElementById('ccTot');
      return !!t && getComputedStyle(t).display !== 'none'; })(),
    k_dev: (document.getElementById('kDev') || {}).textContent || null,
    k_fac: (document.getElementById('kFac') || {}).textContent || null,
    rail_proposed: proposed.length,
    sites_total: sites.length,
    dev_points: sites.filter(devPoint).length,
    facilities: sites.filter(s => s.scope === 'point' && s.relevance !== 'development').length,
    freshLine: txt('freshLine'),
    withinLbl: txt('withinLbl'),
    mapCap: (document.querySelector('.map-cap') || {}).textContent || '',
    tileDevText: (document.getElementById('cDev') || {}).textContent || '',
    homeBtnShown: (() => { const b = document.getElementById('homeViewBtn');
      return !!b && getComputedStyle(b).display !== 'none'; })(),
    rAddr: txt('rAddr'),
    scopeNote: txt('scopeNote'),
    scopeNoteShown: (() => { const n = document.getElementById('scopeNote');
      return !!n && getComputedStyle(n).display !== 'none'; })(),
    backZipShown: (() => { const b = document.getElementById('backZip');
      return !!b && getComputedStyle(b).display !== 'none'; })(),
    backZipHref: (() => { const a = document.querySelector('#backZip a');
      return a ? a.getAttribute('href') : null; })(),
    status: txt('status'),
    radiusVisible: (() => { const el = document.getElementById('radSel'); if (!el) return false;
      const cs = getComputedStyle(el); return cs.display !== 'none' && cs.visibility !== 'hidden'; })(),
    homePins: document.querySelectorAll('.homepin').length,
    mapPresent: !!document.querySelector('#mapInner .leaflet-container, #map .leaflet-container')
  };
});

console.log('='.repeat(78));
console.log('MAP 1 — MARKET-READINESS GATE (product check, live)');
info('base', BASE); info('zip', ZIP); info('address', ADDRESS);
console.log('='.repeat(78));

// ═══════════════════ A. ZIP MODE — the entire ZIP ═══════════════════
// Opens the first DEVELOPMENT marker's real popup and reads it back.
async function openDossier() {
  return page.evaluate(async () => {
    const ms = window.siteMarkers || [];
    const hit = ms.find(x => x && x.s && x.s.scope === 'point' && x.s.relevance === 'development');
    if (!hit) return null;
    hit.m.openPopup();
    await new Promise(r => setTimeout(r, 400));
    const el = document.querySelector('.leaflet-popup-content');
    return el ? { label: hit.s.label || null, text: el.textContent.trim().slice(0, 160),
                  link: !!el.querySelector('a[href^="http"]') } : null;
  });
}

console.log('\nA. ZIP MODE — a resident opens their ZIP');
await page.goto(BASE + '/homesignalmap.html?zip=' + ZIP, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => Array.isArray(window.__HS_SITES), null, { timeout: 90000 });
await page.waitForTimeout(4000);
const z = await readScreen();
info('screen', z);

ok(errors.length === 0, 'A1 the page loads with no fatal client error', errors.slice(0, 3));
ok(z.mapPresent, 'A2 the map renders');
ok(z.sites_total > 0, 'A3 results appear', z.sites_total);
ok(z.dev_points > 0, 'A4 development/projects appear', z.dev_points);
// A5 CHANGED 2026-09-06 (first-launch standard). The whole-ZIP label now spans the eyebrow
// and the prominent place line, so assert the SENTENCE A RESIDENT READS rather than one
// element - either half alone can pass while the rendered heading is broken.
const zLine = ((z.withinLbl || '') + ' ' + (z.rAddr || '')).replace(/\s+/g, ' ').trim();
ok(zLine === ('All development across ZIP ' + ZIP),
  'A5 the page reads "All development across ZIP <zip>"', zLine);
ok(z.scopeNoteShown === true && /entire ZIP area/i.test(z.scopeNote || ''),
  'A5b ...with a visible clarifier that this is the entire ZIP, not nearby projects', z.scopeNote);
ok(z.backZipShown === false,
  'A5c ZIP mode offers no "back to ZIP" control - it IS the whole-ZIP view', z.backZipShown);
ok(z.radiusVisible === false, 'A6 no radius control in ZIP mode (address-radius semantics do not leak)');
ok(z.homePins === 0, 'A7 no HOME pin for a ZIP (a ZIP is not somebody’s home)');

// THE HEADLINE NUMBER MUST DESCRIBE THE MAP.
ok(z.tile_proposed === z.rail_proposed,
  'A8 the "New projects proposed nearby" tile equals the Proposed set actually drawn',
  { tile: z.tile_proposed, drawn: z.rail_proposed });
// A9 CHANGED 2026-09-05 (F1). ZIP mode no longer shows a combined total: adding whole-ZIP
// development to nearby facilities produced one number from two geographies. The assertion is
// now that it is ABSENT here, and address mode - where every class shares one radius contract -
// still carries it and still has to add up (B-section).
ok(z.total_tile_shown === false,
  'A9 ZIP mode shows no combined total (whole-ZIP development + nearby facilities is not a number)',
  { shown: z.total_tile_shown, tile: z.tile_total });
ok(/across this ZIP/i.test(z.k_dev || ''),
  'A9b the development counter says it is measured ACROSS this ZIP', z.k_dev);
ok(/^Nearby regulated facilities$/i.test((z.k_fac || '').trim()),
  'A9c the facility counter says NEARBY, never a whole-ZIP claim', z.k_fac);

// Marker -> dossier -> evidence: the page's primary interaction. Opened through the page's
// OWN hook (window.siteMarkers), which homesignalmap.html exposes precisely so a proof can
// open a specific marker's real popup "instead of guessing at DOM order". Guessing is what
// the first version of this gate did, and it clicked the HOME pin in address mode and
// something inert in ZIP mode - reporting a harness artifact as a product defect.
const zPop = await openDossier();
info('ZIP dossier', zPop);
ok(!!zPop, 'A10 clicking a development marker opens its dossier', zPop);
ok(!!(zPop && zPop.link), 'A11 the dossier carries an official record link (evidence stays reachable)', zPop);

// ═══════════════════ B. ADDRESS MODE — HOME + radius ═══════════════════
// Address mode already deletes the engine's development counters when canonical results
// replace them, so B6 below is the POSITIVE CONTROL for A8: same assertion, known-good path.
console.log('\nB. ADDRESS MODE — a resident searches their street address');
await page.goto(BASE + '/homesignalmap.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('#addr', { timeout: 30000 });
await page.fill('#addr', ADDRESS);
await page.click('#go');
await page.waitForFunction(() => {
  const t = document.getElementById('status');
  return (window.__HS_SITES || []).length > 0 || /couldn't|error/i.test(t ? t.textContent : '');
}, null, { timeout: 120000 });
await page.waitForTimeout(3000);
const a = await readScreen();
info('screen', a);

ok(a.mapPresent, 'B1 the map renders for an address');
ok(a.homePins === 1, 'B2 HOME is shown, so development is readable relative to the home', a.homePins);
ok(a.radiusVisible === true, 'B3 the radius control is available in address mode');
ok(a.sites_total > 0, 'B4 results appear', a.sites_total);
ok(/^Showing development within .+ of$/.test((a.withinLbl || '').trim()),
  'B5 the page says WHAT is shown and the radius it is within', a.withinLbl);
// THE WAY BACK. run() flips ZIP_MODE in JS without touching the URL, so without this control
// an address search is a one-way door: no control, no history entry, no visible route back.
ok(a.backZipShown === true && /^homesignalmap\.html\?zip=\d{5}$/.test(a.backZipHref || ''),
  'B5b address mode offers a real link back to the whole-ZIP view',
  { shown: a.backZipShown, href: a.backZipHref });
ok(a.scopeNoteShown === false,
  'B5c the whole-ZIP clarifier does not leak into address mode', a.scopeNote);
ok(a.tile_proposed === a.rail_proposed,
  'B6 POSITIVE CONTROL — the proposed tile equals the drawn set in address mode',
  { tile: a.tile_proposed, drawn: a.rail_proposed });
ok(!/across ZIP/i.test(((a.withinLbl || '') + ' ' + (a.rAddr || ''))),
  'B7 ZIP semantics do not leak into address mode', { withinLbl: a.withinLbl, rAddr: a.rAddr });

const aPop = await openDossier();
info('address dossier', aPop);
ok(!!aPop, 'B8 clicking a development marker opens its dossier in address mode', aPop);
ok(!!(aPop && aPop.link), 'B8b ...carrying its official record link', aPop);

// A radius change must actually change the answer, or the control is decorative.
const before = a.sites_total;
await page.click('#radSel button[data-r="2"]');
await page.waitForTimeout(9000);
const a2 = await readScreen();
info('after switching to 2 miles', { before: before, after: a2.sites_total, within: a2.withinLbl });
ok(/2 miles/i.test(a2.withinLbl || ''), 'B9 the page states the NEW radius', a2.withinLbl);
// The caption is ON the map canvas, so it must track the radius too - a caption still
// naming the OLD radius beside re-scoped pins is worse than no caption.
ok(/^Development within 2 miles of this home$/.test((a2.mapCap || '').trim()),
  'B9b ...and the map caption states the NEW radius too', a2.mapCap);
ok(a2.tile_proposed === a2.rail_proposed,
  'B10 the tile still equals the drawn set after a radius change',
  { tile: a2.tile_proposed, drawn: a2.rail_proposed });

// ══════════════ C. THE STATE CONTROLS, LIVE ON PRODUCTION ══════════════
// The founder's launch controls that the A/B flows above do not reach.

// C1 — a resident who searched an address can get back, and the return is CLEAN.
await page.goto(BASE + '/homesignalmap.html?zip=' + ZIP, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => Array.isArray(window.__HS_SITES), null, { timeout: 90000 });
const cZip = await readScreen();
ok(cZip.homeBtnShown === false,
  'C1 ZIP mode hides the HOME-specific "From home" control - there is no home on a ZIP page',
  cZip.homeBtnShown);

await page.fill('#addr', ADDRESS);
await page.click('#go');
await page.waitForFunction(() => /Showing development within/.test(
  (document.getElementById('withinLbl') || {}).textContent || ''), null, { timeout: 90000 });
await page.waitForTimeout(3000);
const cAddr = await readScreen();
ok(cAddr.homeBtnShown === true,
  'C2 ...while address mode, which HAS a geocoded home, still offers it', cAddr.homeBtnShown);
ok(cAddr.backZipShown === true, 'C3 the Back-to-ZIP control is present in address mode');

// Actually CLICK it. "A link exists" is not "the return works".
await page.click('#backZip a');
await page.waitForFunction(() => Array.isArray(window.__HS_SITES), null, { timeout: 90000 });
await page.waitForTimeout(3000);
const cBack = await readScreen();
const backLine = ((cBack.withinLbl || '') + ' ' + (cBack.rAddr || '')).replace(/\s+/g, ' ').trim();
info('after clicking Back to ZIP', { line: backLine, radiusVisible: cBack.radiusVisible,
  homePins: cBack.homePins, backZipShown: cBack.backZipShown, homeBtnShown: cBack.homeBtnShown });
ok(backLine === ('All development across ZIP ' + ZIP),
  'C4 clicking Back returns to the SAME whole-ZIP view', backLine);
ok(cBack.radiusVisible === false && cBack.homePins === 0,
  'C5 ...and the return is CLEAN - no radius control, no HOME pin left behind',
  { radiusVisible: cBack.radiusVisible, homePins: cBack.homePins });
ok(cBack.backZipShown === false && cBack.homeBtnShown === false,
  'C6 ...and neither the Back control nor the HOME control survives the return',
  { backZip: cBack.backZipShown, homeBtn: cBack.homeBtnShown });

// C7 — BARE ADDRESS FLOW: no ?zip= in the URL, so no ZIP is known from the page. The control
// may only appear if the searched ADDRESS itself yields a ZIP; with neither it must be absent
// rather than guessing one.
await page.goto(BASE + '/homesignalmap.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(4000);
const bare = await page.evaluate(() => { const b = document.getElementById('backZip');
  return { shown: !!b && getComputedStyle(b).display !== 'none',
           html: b ? b.innerHTML : null }; });
info('bare page, no ZIP known', bare);
ok(bare.shown === false,
  'C7 with no ZIP known, no Back-to-ZIP control is drawn (never a guessed ZIP)', bare);

// C8/C9 — NOT-MEASURED vs MEASURED, read from whatever state production is actually in.
// Each ZIP is judged by the state IT reports, and the pass requires having OBSERVED both
// states, so a run where every candidate happened to be measured cannot score green on the
// not-measured rule it never exercised.
// FIRST RUN FOUND ALL CANDIDATES MEASURED, so the list is widened to genuinely SEARCH for a
// not_measured ZIP - rural/remote ZIPs across many states, where authoritative measurement is
// least likely to have landed. Selection is the instrument here; a narrow list proves nothing.
const CAND = (process.env.STATE_ZIPS ||
  '78617,71104,84334,59718,82190,89049,79837,99723,57625,88055,04413,96769,83252,59645,89310'
).split(',').map(z => z.trim()).filter(Boolean);
let sawNotMeasured = 0, sawMeasured = 0, sawMeasuredZero = 0, stateFails = 0, zeroFails = 0;
for (const z of CAND) {
  await page.goto(BASE + '/homesignalmap.html?zip=' + z, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => Array.isArray(window.__HS_SITES), null, { timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(2500);
  const r = await readScreen();
  const fresh = r.freshLine || '';
  const notMeasured = /not measured yet/i.test(fresh);
  // "measured zero" is the AUTHORITATIVE zero and says so in its own words.
  const measuredZero = /measurement of the whole ZIP, not an empty search/i.test(fresh);
  const dev = (r.tileDevText || '').trim();
  info('state ZIP ' + z, { notMeasured, measuredZero, dev, fresh: fresh.slice(0, 110) });
  if (notMeasured) {
    sawNotMeasured++;
    if (dev !== '\u2014') { stateFails++; console.log('   !! ' + z + ' is not_measured but shows dev "' + dev + '"'); }
  } else if (measuredZero) {
    sawMeasuredZero++; sawMeasured++;
    // The founder's control: an authoritative zero must stay a REAL numeric zero.
    if (dev !== '0') { zeroFails++; console.log('   !! ' + z + ' is a measured zero but shows dev "' + dev + '"'); }
  } else if (/^\d+$/.test(dev)) {
    sawMeasured++;
  }
}
ok(stateFails === 0,
  'C8 every not-measured ZIP shows UNKNOWN, never a false numeric zero', stateFails);
ok(zeroFails === 0,
  'C8b every AUTHORITATIVE measured zero shows a real numeric 0, never an em-dash', zeroFails);
ok(sawMeasured > 0,
  'C9 measured ZIPs were actually observed live (not a vacuous pass)', sawMeasured);
ok(sawMeasuredZero > 0,
  'C9b ...including at least one AUTHORITATIVE measured zero, distinct from not-measured',
  sawMeasuredZero);
// NOT-MEASURED is reported as INCONCLUSIVE rather than failed when production contains no such
// ZIP. The repo's own convention: an absence of evidence is neither a pass nor a fail, and
// scoring it green would claim a live proof that never ran. The RULE itself is mutation-proved
// offline (user-journey section 14), so this reports coverage, not correctness.
if (sawNotMeasured === 0) {
  console.log('INCONCLUSIVE — C8 not exercised live: none of the ' + CAND.length +
    ' probed ZIPs is in the not_measured state. Rule proven offline (section 14e/14f); ' +
    'NOT proven on production.');
} else {
  console.log('   · not_measured ZIPs observed live: ' + sawNotMeasured);
}

console.log('='.repeat(78));
console.log('FAILS: ' + fails);
console.log('='.repeat(78));
await browser.close();
process.exit(fails ? 1 : 0);
