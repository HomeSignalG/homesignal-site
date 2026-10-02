// The homepage search box: one box takes a ZIP code OR an address, and both stay on the
// homepage. Run: node test/home-zip-or-address.browser.test.mjs
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
//   2. a ZIP never calls the geocoder;
//   3. an address is sent once to geocode-address, exactly as typed; it is not put in the URL,
//      nothing is written anywhere, and the lookup event carries the confirmed ZIP alone;
//   4. an address the Census cannot confirm, a geocoder outage, and input too short to be
//      either each say so under the box, go nowhere, and leave the button usable;
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

// ═══ 2. A ZIP ═══
console.log('--- 2. a ZIP opens its map here and never calls the geocoder ---');
for (const how of ['enter', 'click']) {
  const { ctx, page, errors } = await homepage();
  await submit(page, '84302', how);
  await page.waitForFunction(() => /zip=84302$/.test(document.getElementById('homeMapFrame').getAttribute('src') || ''), null, { timeout: 8000 }).catch(() => {});
  const s = await state(page);
  ok(s.src === 'homesignalmap.html?embed=1&zip=84302', `2 "84302" (${how}) opens Map 1 for that ZIP`, s.src);
  ok(s.path === '/index.html', `2 "84302" (${how}) stays on the homepage`, s.path);
  ok(s.invokes.length === 0, `2 "84302" (${how}) does not call the geocoder`, s.invokes);
  ok(s.inserts.length === 0, `2 "84302" (${how}) writes nothing`, s.inserts);
  ok(errors.length === 0, `2 (${how}) no page errors`, errors);
  await ctx.close();
}

// ═══ 3. An address ═══
console.log('--- 3. an address: sent once, as typed; never in the URL; nothing written ---');
for (const how of ['click', 'enter']) {
  const { ctx, page, errors } = await homepage();
  await submit(page, ADDR_OK, how);
  await page.waitForFunction(() => /lat=/.test(document.getElementById('homeMapFrame').getAttribute('src') || ''), null, { timeout: 8000 }).catch(() => {});
  const s = await state(page);
  ok(s.src === 'homesignalmap.html?embed=1&lat=30.17&lng=-97.61&radius=2', `3 (${how}) the confirmed point opens the 2-mile map`, s.src);
  ok(s.invokes.length === 1 && s.invokes[0].fn === 'geocode-address' && s.invokes[0].address === ADDR_OK,
    `3 (${how}) sent once to geocode-address, exactly as typed`, s.invokes);
  ok(s.path === '/index.html' && !/coomes|13313|del%20valle|del\+valle/i.test(s.url), `3 (${how}) the address is not in the URL`, s.url);
  ok(s.inserts.length === 0, `3 (${how}) the address is not written anywhere (no insert of any kind)`, s.inserts);
  ok(s.logs.length === 1 && s.logs[0][0] === 'property_lookup', `3 (${how}) one property_lookup event is recorded`, s.logs);
  ok(s.logs.length === 1 && JSON.stringify(s.logs[0][1]) === JSON.stringify({ zip_code: '78617' }),
    `3 (${how}) ...carrying the confirmed ZIP alone, never the address`, s.logs);
  ok(errors.length === 0, `3 (${how}) no page errors`, errors);
  await ctx.close();
}
{
  // The same address searched twice records one event (the old homepage's rule).
  const { ctx, page } = await homepage();
  await submit(page, ADDR_OK);
  await page.waitForFunction(() => window.__logs.length === 1, null, { timeout: 8000 }).catch(() => {});
  await submit(page, ADDR_OK);
  await page.waitForFunction(() => window.__invokes.length === 2, null, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(300);
  const s = await state(page);
  ok(s.invokes.length === 2 && s.logs.length === 1, '3 the same address searched twice records one lookup event', { invokes: s.invokes.length, logs: s.logs });
  await ctx.close();
}

// ═══ 4. Refusals ═══
console.log('--- 4. what cannot be confirmed says so and goes nowhere ---');
const REFUSALS = [
  [ADDR_NOMATCH, /couldn.t confirm that address against U\.S\. Census records/, 1, 'an address the Census cannot confirm'],
  [ADDR_OUTAGE, /address service couldn.t be reached/, 1, 'a geocoder outage'],
  ['abc', /5-digit ZIP code, or a street address/, 0, 'an input too short to be either'],
  ['1234', /5-digit ZIP code, or a street address/, 0, 'four digits'],
  ['84302-1234', /5-digit ZIP code, or a street address/, 0, 'a ZIP+4 (§14: a ZIP is exactly five digits)']
];
for (const [typed, re, calls, what] of REFUSALS) {
  const { ctx, page, errors } = await homepage();
  const before = await state(page);
  await submit(page, typed);
  await page.waitForFunction(() => !document.getElementById('homeSearchErr').hidden, null, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(300);
  const s = await state(page);
  ok(re.test(s.msg), `4 ${what}: the page says why`, s.msg);
  ok(s.path === '/index.html' && s.src === before.src, `4 ${what}: stays on the homepage, map unchanged`, { path: s.path, src: s.src });
  ok(s.invokes.length === calls, `4 ${what}: geocoder called ${calls} time(s)`, s.invokes.length);
  ok(s.inserts.length === 0 && s.logs.length === 0, `4 ${what}: nothing written, no lookup event`, { inserts: s.inserts, logs: s.logs });
  ok(s.btnDisabled === false, `4 ${what}: the button is usable again`, s.btnDisabled);
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
