// The homepage search box takes a zip code OR an address (founder, 2026-10-01: "this should
// be enter a zip code or address"), and the line under it goes to My Places, not the
// Dashboard ("it should be go to MY places").
// Run: node test/home-zip-or-address.browser.test.mjs
//
// It proves, signed out, in a real browser:
//   1. the box says "Enter a zip code or address" and no longer refuses anything but five
//      digits (no numeric keypad, no 5-character limit);
//   2. the line under it reads "Go to My Places →" and links to properties.html, and the hero
//      no longer links to the Dashboard;
//   3. a ZIP (and a ZIP+4) goes to its community page without calling the geocoder;
//   4. an address is sent once to the geocode-address service, exactly as typed, and the
//      CONFIRMED match's ZIP opens that community page. The address is not in the URL, is
//      not written anywhere, and the lookup event carries the ZIP alone;
//   5. an address the Census cannot confirm, a geocoder outage, and an input too short to be
//      either each say so on the page and go nowhere;
//   6. an address whose confirmed ZIP is not covered yet opens the same "request my zip code"
//      form a typed uncovered ZIP opens.
//
// NO NETWORK. The supabase-js CDN request is fulfilled with a stub. app_community_meta answers
// "covered" for 78617 and 84302 only; geocode-address answers by the typed string.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, normalize } from 'node:path';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch (e) {
  console.log('SKIP home-zip-or-address.browser.test.mjs — playwright not installed');
  process.exit(0);
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0;
const ok = (c, name, d) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name);
  if (!c) { fails++; if (d !== undefined) console.log('           detail: ' + JSON.stringify(d).slice(0, 400)); }
};

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  const p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
  if (!p.startsWith(root)) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(p);
    res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' }).end(body);
  } catch { res.writeHead(404).end('not found'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;

const ADDR_OK = '13313 Coomes Dr, Del Valle, TX 78617';
const ADDR_NOMATCH = '1 Nowhere Lane, Atlantis';
const ADDR_OUTAGE = '99 Outage Rd, Austin TX';
const ADDR_UNCOVERED = '5 Uncovered Way, Somewhere ZZ';

const STUB = `
window.__calls = [];
window.__invokes = [];
window.supabase = { createClient: function () {
  var COVERED = ['78617', '84302'];
  function table(name) {
    var call = { table: name, eq: [], insert: null };
    window.__calls.push(call);
    var api = {};
    ['select','update','upsert','delete','neq','in','is','or','not','gt','gte',
     'lt','lte','like','ilike','contains','overlaps','order','limit','range','filter','match']
      .forEach(function (m) { api[m] = function () { return api; }; });
    api.insert = function (rows) { call.insert = rows; return api; };
    api.eq = function (col, val) { call.eq.push([col, val]); return api; };
    api.single = function () { return Promise.resolve({ data: null, error: { code: 'PGRST116' } }); };
    api.maybeSingle = function () { return Promise.resolve({ data: null, error: null }); };
    api.then = function (res, rej) {
      var rows = [];
      if (name === 'app_community_meta') {
        var z = (call.eq.find(function (e) { return e[0] === 'zip'; }) || [])[1];
        if (COVERED.indexOf(z) >= 0) rows = [{ zip: z }];
      }
      return Promise.resolve({ data: rows, error: null }).then(res, rej);
    };
    return api;
  }
  var MATCHES = {
    ${JSON.stringify(ADDR_OK)}: { matchedAddress: '13313 COOMES DR, DEL VALLE, TX, 78617', city: 'DEL VALLE', state: 'TX', zip: '78617', lat: 30.17, lng: -97.61 },
    ${JSON.stringify(ADDR_UNCOVERED)}: { matchedAddress: '5 UNCOVERED WAY, SOMEWHERE, ZZ, 99999', zip: '99999', lat: 40.0, lng: -100.0 }
  };
  return {
    from: table,
    rpc: function () { return Promise.resolve({ data: null, error: null }); },
    functions: { invoke: function (fn, opts) {
      var address = opts && opts.body && opts.body.address;
      window.__invokes.push({ fn: fn, address: address });
      if (address === ${JSON.stringify(ADDR_OUTAGE)}) return Promise.resolve({ data: null, error: { message: 'geocoder_unavailable' } });
      return Promise.resolve({ data: { match: MATCHES[address] || null }, error: null });
    } },
    auth: {
      getSession: function () { return Promise.resolve({ data: { session: null } }); },
      signOut: function () { return Promise.resolve({ error: null }); },
      onAuthStateChange: function () { return { data: { subscription: { unsubscribe: function () {} } } }; }
    }
  };
} };`;

const browser = await chromium.launch();

async function homepage(viewport = { width: 1280, height: 900 }) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    // The community page itself is not under test: answer it with a stub so the test reads
    // only where the homepage SENT the resident.
    if (url.startsWith(base + '/community.html')) {
      return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>landed</title>' });
    }
    if (url.startsWith(base)) return route.continue();
    if (url.includes('cdn.jsdelivr.net') && /supabase/.test(url)) {
      return route.fulfill({ status: 200, contentType: 'text/javascript', body: STUB });
    }
    if (url.includes('cdn.jsdelivr.net')) return route.fulfill({ status: 200, contentType: 'text/javascript', body: '' });
    return route.abort();
  });
  await page.goto(base + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.HS && window.HS.ready && document.getElementById('homeZip'), null, { timeout: 30000 });
  await page.evaluate(() => window.HS.ready);
  // HS.logEvent records only on homesignal.net; spy on it instead. The calls are kept in
  // sessionStorage, which survives the navigation to the community page.
  await page.evaluate(() => {
    sessionStorage.setItem('__logs', '[]');
    window.HS.logEvent = function (t, p) {
      var l = JSON.parse(sessionStorage.getItem('__logs') || '[]');
      l.push([t, p]);
      sessionStorage.setItem('__logs', JSON.stringify(l));
    };
  });
  return { ctx, page, errors };
}

async function submit(page, text, how = 'click') {
  await page.fill('#homeZip', text);
  if (how === 'enter') await page.press('#homeZip', 'Enter');
  else await page.click('.ziprow .find');
}

const landed = async (page, path) => {
  try { await page.waitForURL((u) => (u.pathname + u.search) === path, { timeout: 8000 }); return true; }
  catch { return false; }
};

const state = (page) => page.evaluate(() => {
  const msg = document.getElementById('homeZipErr');
  return {
    path: location.pathname + location.search,
    msg: msg && !msg.hidden ? msg.textContent : '',
    border: document.getElementById('homeZip').style.borderColor,
    invokes: window.__invokes.slice(),
    inserts: window.__calls.filter((c) => c.insert).map((c) => c.table)
  };
});

// ═══ 1–2. The markup ═══
console.log('--- 1-2. the box and the line under it ---');
{
  const { ctx, page, errors } = await homepage();
  const m = await page.evaluate(() => {
    const el = document.getElementById('homeZip');
    const line = document.querySelector('.hero .freeline a');
    return {
      placeholder: el.getAttribute('placeholder'),
      inputmode: el.getAttribute('inputmode'),
      maxlength: el.getAttribute('maxlength'),
      label: el.getAttribute('aria-label'),
      lineText: line ? line.textContent.trim() : null,
      lineHref: line ? line.getAttribute('href') : null,
      heroDash: [...document.querySelectorAll('.hero a')].filter((a) => /dashboard\.html/.test(a.getAttribute('href') || '')).length
    };
  });
  ok(m.placeholder === 'Enter a zip code or address', '1 the box says "Enter a zip code or address"', m.placeholder);
  ok(m.inputmode !== 'numeric', '1 ...and does not force the numeric keypad (an address has letters)', m.inputmode);
  ok(m.maxlength === null, '1 ...and is not limited to 5 characters', m.maxlength);
  ok(!!m.label && /zip code or address/i.test(m.label), '1 ...and its accessible name says zip code or address', m.label);
  ok(m.lineText === 'Go to My Places →', '2 the line under the box reads "Go to My Places →"', m.lineText);
  ok(m.lineHref === 'properties.html', '2 ...and links to My Places (properties.html)', m.lineHref);
  ok(m.heroDash === 0, '2 the hero no longer links to the Dashboard', m.heroDash);
  ok(errors.length === 0, '1 no page errors on load', errors);
  await ctx.close();
}

// ═══ 3. A ZIP ═══
console.log('--- 3. a ZIP goes straight to its community ---');
for (const [typed, how] of [['84302', 'enter'], ['84302-1234', 'click']]) {
  const { ctx, page } = await homepage();
  await submit(page, typed, how);
  const went = await landed(page, '/community.html?zip=84302');
  ok(went, `3 "${typed}" (${how}) opens community.html?zip=84302`, page.url());
  const inv = await page.evaluate(() => (window.__invokes || []).length).catch(() => 0);
  ok(inv === 0, `3 "${typed}" does not call the geocoder`, inv);
  await ctx.close();
}

// ═══ 4. An address ═══
console.log('--- 4. an address opens the community of its confirmed ZIP ---');
for (const how of ['click', 'enter']) {
  const { ctx, page, errors } = await homepage();
  await page.fill('#homeZip', ADDR_OK);
  const before = await state(page);
  const nav = landed(page, '/community.html?zip=78617');
  if (how === 'enter') await page.press('#homeZip', 'Enter'); else await page.click('.ziprow .find');
  const went = await nav;
  ok(went, `4 (${how}) "${ADDR_OK}" opens community.html?zip=78617`, page.url());
  ok(!/coomes|13313|del%20valle|del\+valle/i.test(page.url()), `4 (${how}) the address is not in the URL`, page.url());
  const logs = await page.evaluate(() => JSON.parse(sessionStorage.getItem('__logs') || '[]'));
  ok(logs.length === 1 && logs[0][0] === 'property_lookup', `4 (${how}) one property_lookup event is recorded`, logs);
  ok(logs.length === 1 && JSON.stringify(logs[0][1]) === JSON.stringify({ zip_code: '78617' }),
    `4 (${how}) ...carrying the ZIP alone, never the address`, logs);
  ok(before.inserts.length === 0, `4 (${how}) nothing was written before the search`, before.inserts);
  ok(errors.length === 0, `4 (${how}) no page errors`, errors);
  await ctx.close();
}
{
  // The geocoder call itself, read on a page that does not navigate away: the uncovered case
  // stays on index.html, so its calls and writes can be read after the fact.
  const { ctx, page, errors } = await homepage();
  await submit(page, ADDR_UNCOVERED);
  await page.waitForFunction(() => {
    const f = document.getElementById('locRequest');
    return f && !f.classList.contains('hidden');
  }, null, { timeout: 8000 }).catch(() => {});
  const s = await state(page);
  ok(s.invokes.length === 1 && s.invokes[0].fn === 'geocode-address' && s.invokes[0].address === ADDR_UNCOVERED,
    '4 the address is sent once to geocode-address, exactly as typed', s.invokes);
  ok(s.inserts.length === 0, '4 the address is not written anywhere (no insert of any kind)', s.inserts);
  // ═══ 6. Uncovered ═══
  const r = await page.evaluate(() => ({
    open: document.getElementById('locModal').classList.contains('open') || getComputedStyle(document.getElementById('locModal')).display !== 'none',
    requestShown: !document.getElementById('locRequest').classList.contains('hidden'),
    zip: document.getElementById('reqZipLabel').textContent
  }));
  ok(r.requestShown && r.zip === '99999',
    '6 an address whose confirmed ZIP is not covered opens the "request my zip code" form for that ZIP', r);
  ok(s.path === '/index.html', '6 ...and stays on the homepage', s.path);
  ok(errors.length === 0, '6 no page errors', errors);
  await ctx.close();
}

// ═══ 5. Refusals ═══
console.log('--- 5. what cannot be confirmed says so and goes nowhere ---');
const REFUSALS = [
  [ADDR_NOMATCH, /couldn.t confirm that address against U\.S\. Census records/, 1, 'an address the Census cannot confirm'],
  [ADDR_OUTAGE, /address service couldn.t be reached/, 1, 'a geocoder outage'],
  ['abc', /5-digit zip code, or a street address/, 0, 'an input too short to be either'],
  ['1234', /5-digit zip code, or a street address/, 0, 'four digits']
];
for (const [typed, re, calls, what] of REFUSALS) {
  const { ctx, page, errors } = await homepage();
  await submit(page, typed);
  await page.waitForFunction(() => {
    const m = document.getElementById('homeZipErr');
    return m && !m.hidden && !/Looking up/.test(m.textContent);
  }, null, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(300);
  const s = await state(page);
  ok(re.test(s.msg), `5 ${what}: the page says why`, s.msg);
  ok(s.path === '/index.html', `5 ${what}: stays on the homepage`, s.path);
  ok(s.invokes.length === calls, `5 ${what}: geocoder called ${calls} time(s)`, s.invokes.length);
  ok(s.inserts.length === 0, `5 ${what}: nothing written`, s.inserts);
  const btn = await page.evaluate(() => document.querySelector('.ziprow .find').disabled);
  ok(btn === false, `5 ${what}: the button is usable again`, btn);
  ok(errors.length === 0, `5 ${what}: no page errors`, errors);
  await ctx.close();
}

// ═══ The placeholder fits: side by side on a desktop, stacked on a phone ═══
// At 390px the button left the box ~104px of text room; "Enter your ZIP code" (133px) was
// already cut off there, and the new wording needs ~183px. The page stacks the row on phones.
console.log('--- the placeholder fits, desktop and phone ---');
for (const [w, h, stacked] of [[1280, 900, false], [390, 844, true], [360, 640, true]]) {
  const { ctx, page } = await homepage({ width: w, height: h });
  const fit = await page.evaluate(() => {
    const el = document.getElementById('homeZip');
    const cs = getComputedStyle(el);
    const c = document.createElement('canvas').getContext('2d');
    c.font = cs.fontSize + ' ' + cs.fontFamily;
    const text = c.measureText(el.getAttribute('placeholder')).width;
    const room = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const a = el.getBoundingClientRect(), b = document.querySelector('.ziprow .find').getBoundingClientRect();
    return { text: Math.round(text), room: Math.round(room), below: b.top >= a.bottom - 1,
             overflow: document.documentElement.scrollWidth > window.innerWidth };
  });
  ok(fit.text <= fit.room, `the placeholder is not cut off at ${w}px`, fit);
  ok(fit.below === stacked, `the button sits ${stacked ? 'under' : 'beside'} the box at ${w}px`, fit);
  ok(!fit.overflow, `the page does not scroll sideways at ${w}px`, fit);
  await ctx.close();
}

await browser.close();
server.close();
if (fails) { console.error(`\n${fails} failed`); process.exit(1); }
console.log('\nAll home zip-or-address assertions passed.');
