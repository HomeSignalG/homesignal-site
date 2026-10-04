// The homepage search box: one box takes a ZIP code OR an address, and both go to the
// Development Map (founder, 2026-10-04; this replaced "both stay on the homepage").
// Run: node test/home-zip-or-address.browser.test.mjs
//
// History. This file first pinned #1528 (founder, 2026-10-01: "this should be enter a zip code
// or address"; "it should be go to MY places"): the box sent a ZIP, or an address's confirmed
// ZIP, to community.html, and the line under it read "Go to My Places →". The founder's Revised
// Index Design (Final Claude-Ready, uploaded 2026-10-02) replaces that flow: the box reads
// "Enter an address or ZIP code", the line under it reads "No account required." (My Places is
// in the header), a ZIP opens Map 1 for that ZIP on the homepage, and a confirmed address opens
// Map 1 around that address on the homepage (§14, §15). What #1528 also proved still holds and
// is kept here:
//   1. the box takes letters and more than five characters (no numeric keypad, no maxlength),
//      and its accessible name says address or ZIP; the hero has no Dashboard link;
//   2. a ZIP goes to homesignalmap.html?zip=<zip>;
//   3. an address goes to homesignalmap.html, handed over once in sessionStorage (never in a
//      URL); Map 1 reads and removes it and runs its own search (the one geocoder call);
//   4. input too short to be a ZIP or an address says so under the box and goes nowhere;
//   5. the placeholder is not cut off, side by side on a desktop and stacked on a phone.
// The layout, races and mode switches are test/home-index.browser.test.mjs.
//
// NO NETWORK (test/lib/home-index-harness.mjs answers every call from fixtures).
import { serve, open, PROJECTS_78657 } from './lib/home-index-harness.mjs';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch (e) {
  console.log('SKIP home-zip-or-address.browser.test.mjs — playwright not installed');
  process.exit(0);
}

let fails = 0;
const ok = (c, name, d) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name);
  if (!c) { fails++; if (d !== undefined) console.log('           detail: ' + JSON.stringify(d).slice(0, 400)); }
};

const ADDR_OK = '13313 Coomes Dr, Del Valle, TX 78617';
const ADDR_NOMATCH = '1 Nowhere Lane, Atlantis';
const ADDR_OUTAGE = '99 Outage Rd, Austin TX';
const MATCH = { matchedAddress: '13313 COOMES DR, DEL VALLE, TX, 78617', city: 'DEL VALLE', state: 'TX', zip: '78617', lat: 30.17, lng: -97.61 };
const STUB = {
  projects: { '78657': PROJECTS_78657, '84302': [] },
  meta: { '84302': { zip: '84302', place_name: 'Brigham City', state: 'UT' } },
  geocode: { [ADDR_OK]: MATCH, [ADDR_OUTAGE]: 'OUTAGE' }
};

const { srv, base } = await serve();
const browser = await chromium.launch();

async function homepage(viewport = { width: 1280, height: 900 }) {
  const o = await open(browser, base, '/index.html', { ...viewport, stub: STUB });
  // HS.logEvent records only on homesignal.net; spy on it instead.
  await o.page.evaluate(() => {
    window.__logs = [];
    window.HS.logEvent = function (t, p) { window.__logs.push([t, p]); };
  });
  return o;
}

async function submit(page, text, how = 'click') {
  await page.fill('#homeQuery', text);
  if (how === 'enter') await page.press('#homeQuery', 'Enter');
  else await page.click('#homeSearchBtn');
}

const state = (page) => page.evaluate(() => {
  const err = document.getElementById('homeSearchErr');
  return {
    path: location.pathname + location.search,
    url: location.href,
    msg: err && !err.hidden ? err.textContent : '',
    src: document.getElementById('homeMapFrame').getAttribute('src'),
    invokes: window.__invokes.slice(),
    inserts: window.__tables.filter((c) => c.insert).map((c) => c.table),
    logs: window.__logs.slice(),
    btnDisabled: document.getElementById('homeSearchBtn').disabled
  };
});

// ═══ 1. The markup ═══
console.log('--- 1. the box and the line under it ---');
{
  const { ctx, page, errors } = await homepage();
  const m = await page.evaluate(() => {
    const el = document.getElementById('homeQuery');
    const label = document.querySelector('label[for="homeQuery"]');
    const helper = document.querySelector('.home-index__helper');
    return {
      placeholder: el.getAttribute('placeholder'),
      inputmode: el.getAttribute('inputmode'),
      maxlength: el.getAttribute('maxlength'),
      label: (el.getAttribute('aria-label') || (label ? label.textContent : '')).trim(),
      helper: helper ? helper.textContent.trim() : null,
      myPlacesLine: [...document.querySelectorAll('.home-index a')].filter((a) => /My Places/.test(a.textContent)).length,
      heroDash: [...document.querySelectorAll('.home-index a')].filter((a) => /dashboard\.html/.test(a.getAttribute('href') || '')).length,
      headerMyPlaces: [...document.querySelectorAll('.hs-nav a')].filter((a) => a.getAttribute('href') === 'properties.html').length
    };
  });
  ok(m.placeholder === 'Enter an address or ZIP code', '1 the box says "Enter an address or ZIP code"', m.placeholder);
  ok(m.inputmode !== 'numeric', '1 ...and does not force the numeric keypad (an address has letters)', m.inputmode);
  ok(m.maxlength === null, '1 ...and is not limited to 5 characters', m.maxlength);
  ok(/address/i.test(m.label) && /zip/i.test(m.label), '1 ...and its accessible name says address or ZIP', m.label);
  ok(m.helper === 'No account required.', '1 the line under the box reads "No account required."', m.helper);
  ok(m.myPlacesLine === 0 && m.headerMyPlaces === 1, '1 "Go to My Places" left the hero; My Places is the header link', m);
  ok(m.heroDash === 0, '1 the homepage does not link to the Dashboard', m.heroDash);
  ok(errors.length === 0, '1 no page errors on load', errors);
  await ctx.close();
}

// Searching leaves the homepage for Map 1. The navigation is answered with a blank page, so
// the request URL and what the homepage left in the tab's sessionStorage can be read.
const HANDOFF_KEY = 'hs.homeSearchAddress';
async function searchAndCatch(typed, how) {
  const o = await homepage();
  const { page } = o;
  let hit = null;
  await page.route('**/homesignalmap.html*', (route) => {
    const u = new URL(route.request().url());
    hit = { path: u.pathname, search: u.search, href: u.href };
    return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>map</title>' });
  });
  await submit(page, typed, how);
  await page.waitForFunction(() => location.pathname === '/homesignalmap.html', null, { timeout: 8000 }).catch(() => {});
  const stored = await page.evaluate((k) => { try { return sessionStorage.getItem(k); } catch (e) { return 'ERR'; } }, HANDOFF_KEY);
  return { ...o, hit, stored };
}

// ═══ 2. A ZIP ═══
console.log('--- 2. a ZIP goes straight to the Development Map ---');
for (const how of ['enter', 'click']) {
  const { ctx, hit, stored, errors } = await searchAndCatch('84302', how);
  ok(hit && hit.path === '/homesignalmap.html' && hit.search === '?zip=84302', `2 "84302" (${how}) opens homesignalmap.html?zip=84302`, hit);
  ok(stored === null, `2 "84302" (${how}) hands nothing over in storage`, stored);
  ok(errors.length === 0, `2 (${how}) no page errors`, errors);
  await ctx.close();
}

// ═══ 3. An address ═══
console.log('--- 3. an address goes to the Development Map, handed over once and never in the URL ---');
for (const how of ['click', 'enter']) {
  const { ctx, hit, stored, errors } = await searchAndCatch(ADDR_OK, how);
  ok(hit && hit.path === '/homesignalmap.html', `3 (${how}) opens the Development Map`, hit);
  ok(hit && hit.search === '' && !/coomes|13313|del%20valle|del\+valle|lat=|lng=/i.test(hit.href), `3 (${how}) the address is not in the URL`, hit);
  ok(stored === ADDR_OK, `3 (${how}) the address is handed over exactly as typed, in this tab's sessionStorage`, stored);
  ok(errors.length === 0, `3 (${how}) no page errors`, errors);
  await ctx.close();
}
{
  // Map 1 takes the handoff: it fills its own box, removes the key at once, and runs ITS address
  // search (one geocoder call). A reload does not repeat it.
  const o = await homepage();
  const geocodes = [];
  await o.page.route('**/functions/v1/geocode-address', (route) => {
    geocodes.push(JSON.parse(route.request().postData() || '{}').address);
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ match: null }) });
  });
  await o.page.evaluate(([k, v]) => sessionStorage.setItem(k, v), [HANDOFF_KEY, ADDR_OK]);
  await o.page.goto(base + '/homesignalmap.html', { waitUntil: 'domcontentloaded' });
  await o.page.waitForFunction(() => window.HS && window.HS.ready, null, { timeout: 30000 });
  await o.page.waitForTimeout(800);
  const m = await o.page.evaluate((k) => ({ box: document.getElementById('addr').value, left: sessionStorage.getItem(k), url: location.href }), HANDOFF_KEY);
  ok(m.box === ADDR_OK, '3 Map 1 puts the handed-over address in its own box', m.box);
  ok(m.left === null, '3 Map 1 removes the handoff the moment it reads it', m.left);
  ok(geocodes.length === 1 && geocodes[0] === ADDR_OK, '3 Map 1 runs its own address search: one geocoder call, exactly as typed', geocodes);
  ok(!/coomes|13313/i.test(m.url), '3 the address never reaches Map 1\'s URL either', m.url);
  await o.page.reload({ waitUntil: 'domcontentloaded' });
  await o.page.waitForTimeout(800);
  ok(geocodes.length === 1, '3 a reload does not repeat the search', geocodes);
  await o.ctx.close();
}
{
  // An explicit ?zip= in the URL wins over a stale handoff, and the handoff is still cleared.
  const o = await homepage();
  const geocodes = [];
  await o.page.route('**/functions/v1/geocode-address', (route) => { geocodes.push(1); return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }); });
  await o.page.evaluate(([k, v]) => sessionStorage.setItem(k, v), [HANDOFF_KEY, ADDR_OK]);
  await o.page.goto(base + '/homesignalmap.html?zip=84302', { waitUntil: 'domcontentloaded' });
  await o.page.waitForFunction(() => window.HS && window.HS.ready, null, { timeout: 30000 });
  await o.page.waitForTimeout(500);
  const left = await o.page.evaluate((k) => sessionStorage.getItem(k), HANDOFF_KEY);
  ok(geocodes.length === 0 && left === null, '3 an explicit ?zip= beats a stale handoff, which is cleared', { geocodes: geocodes.length, left });
  await o.ctx.close();
}

// ═══ 4. Refusals ═══
console.log('--- 4. input too short to be a ZIP or an address says so and goes nowhere ---');
const REFUSALS = [
  ['abc', 'an input too short to be either'],
  ['1234', 'four digits'],
  ['84302-1234', 'a ZIP+4 (§14: a ZIP is exactly five digits)']
];
for (const [typed, what] of REFUSALS) {
  const { ctx, page, hit, stored, errors } = await searchAndCatch(typed, 'click');
  await page.waitForTimeout(300);
  const s = await page.evaluate(() => { const e = document.getElementById('homeSearchErr'); return { path: location.pathname, msg: e && !e.hidden ? e.textContent : '' }; });
  ok(/5-digit ZIP code, or a street address/.test(s.msg), `4 ${what}: the page says why`, s.msg);
  ok(s.path === '/index.html' && hit === null, `4 ${what}: stays on the homepage`, { path: s.path, hit });
  ok(stored === null, `4 ${what}: nothing handed over`, stored);
  ok(errors.length === 0, `4 ${what}: no page errors`, errors);
  await ctx.close();
}

// ═══ 5. The placeholder fits: side by side on a desktop, stacked on a phone ═══
console.log('--- 5. the placeholder fits, desktop and phone ---');
for (const [w, h, stacked] of [[1280, 900, false], [390, 844, true], [360, 640, true]]) {
  const { ctx, page } = await homepage({ width: w, height: h });
  const fit = await page.evaluate(() => {
    const el = document.getElementById('homeQuery');
    const cs = getComputedStyle(el);
    const c = document.createElement('canvas').getContext('2d');
    c.font = cs.fontSize + ' ' + cs.fontFamily;
    const text = c.measureText(el.getAttribute('placeholder')).width;
    const room = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const a = el.getBoundingClientRect(), b = document.getElementById('homeSearchBtn').getBoundingClientRect();
    return { text: Math.round(text), room: Math.round(room), below: b.top >= a.bottom - 1,
             overflow: document.documentElement.scrollWidth > window.innerWidth };
  });
  ok(fit.text <= fit.room, `5 the placeholder is not cut off at ${w}px`, fit);
  ok(fit.below === stacked, `5 the button sits ${stacked ? 'under' : 'beside'} the box at ${w}px`, fit);
  ok(!fit.overflow, `5 the page does not scroll sideways at ${w}px`, fit);
  await ctx.close();
}

await browser.close();
srv.close();
if (fails) { console.error(`\n${fails} failed`); process.exit(1); }
console.log('\nAll home zip-or-address assertions passed.');
