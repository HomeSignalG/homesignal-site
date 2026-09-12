// PLACE CONTEXT HEADING — driven in a real browser against the two Place hosts.
//
// The heading must name the geography the MAP iframe is currently rendering:
//   Address-radius → "See what is changing at [DISPLAY ADDRESS]"
//   ZIP-area       → "See what is changing in [ZIP]"
// Kind is the host, not a string parse. myZip / followed ZIPs / the other saved
// Address must not leak into the heading, including across ZIP → Address → ZIP
// navigation without a refresh.
//
// Nothing here touches production: the static site is served locally, config.js
// is flipped to seed, and every outbound request is answered from fixtures.
// Seed properties are demo:true and the seed session is demo:true, both of which
// hide the Place map (A-022 / realAddress). The test server rewrites those two
// flags so the AUTHENTICATED map path renders, which is the path that carries
// the heading. It also lets seed community() answer for any covered ZIP — the
// heading still binds to ensureViewedZip's `zip`, not community.zip.
//
// Run: node test/place-changing-heading.browser.test.mjs
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, normalize } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ART = '/opt/cursor/artifacts';
let fails = 0;
const ok = (c, name, detail) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name);
  if (!c) { fails++; if (detail !== undefined) console.log('           detail: ' + JSON.stringify(detail)); }
};
const info = (k, v) => console.log('   · ' + k + ': ' + (typeof v === 'string' ? v : JSON.stringify(v)));

const P1 = { id: 'p1', address: '4400 Wildhorse Trail', lat: 30.176, lng: -97.6098 };
const P2 = { id: 'p2', address: '13100 Elroy Rd', lat: 30.1585, lng: -97.6009 };
const ZIP_A = '78617';
const ZIP_C = '78612';

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  const p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
  if (!p.startsWith(root)) { res.writeHead(403).end(); return; }
  try {
    let body = await readFile(p);
    let text = null;
    const asText = () => { if (text == null) text = String(body); return text; };
    if (p.endsWith('config.js')) {
      text = asText()
        .replace("DATA_SOURCE: 'supabase'", "DATA_SOURCE: 'seed'")
        .replace('DEMO_SESSION: false', 'DEMO_SESSION: true');
    } else if (p.endsWith('shell.js')) {
      // Seed session is demo:true, which hides the ZIP Place map. Flip only that
      // assignment so the A-022 authenticated path renders. Nothing else in shell.js.
      text = asText().replace(
        'demo: true, name: u.name, initials: u.initials',
        'demo: false, name: u.name, initials: u.initials'
      );
    } else if (p.endsWith('delvalle.js')) {
      text = asText().replace(/demo:true/g, 'demo:false');
    } else if (p.endsWith('data.js')) {
      // Seed community() is Del Valle-only. Other covered ZIPs are 'pass' but
      // community() returns null and the page throws before the heading paints.
      // Clone the seed community onto the REQUESTED zip so a second ZIP can
      // render. The heading still uses ensureViewedZip's `zip`, not c.zip.
      text = asText().replace(
        'if (isSeed()) { const c = window.HS_SEED.community; return c.zip === zip ? c : null; }',
        'if (isSeed()) { const c = window.HS_SEED.community; return Object.assign({}, c, { zip: zip }); }'
      );
    }
    if (text != null) body = Buffer.from(text);
    res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' }).end(body);
  } catch { res.writeHead(404).end('not found'); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;

const browser = await chromium.launch();
const ctx = await browser.newContext();
// Poison account/default geography BEFORE any Place page, without visiting
// index.html first. CI aborted the follow-up community.html navigation
// (net::ERR_ABORTED) when a previous document was still hydrating.
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('myZip', '78744');
    sessionStorage.setItem('viewZip', '78725');
    localStorage.setItem('myCommunities', JSON.stringify([{ zip: '78719', name: 'Austin (ABIA)', state: 'TX' }]));
  } catch (e) { /* about:blank / opaque origins */ }
});
const page = await ctx.newPage();
const pageErrors = [];
page.on('pageerror', e => {
  const msg = String(e);
  const stack = e && e.stack ? String(e.stack) : '';
  if (/homesignalmap\.html|leaflet|maplibre|MapLibre|L is not defined/i.test(msg + stack)) return;
  pageErrors.push(msg.slice(0, 240));
});

await page.route('**/*', async (route) => {
  const url = route.request().url();
  if (url.startsWith(base)) return route.continue();
  if (url.includes('cdn.jsdelivr.net')) {
    const kind = url.endsWith('.css') ? 'text/css' : 'text/javascript';
    return route.fulfill({
      status: 200,
      contentType: kind,
      body: kind === 'text/css' ? '' : 'window.supabase={createClient:function(){return{};}};'
    });
  }
  return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
});

const waitShell = () => page.waitForFunction(() => !!document.querySelector('.nav a'), null, { timeout: 30000 });

async function go(path) {
  const url = path.startsWith('http') ? path : base + path;
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
  } catch (e) {
    if (!/ERR_ABORTED|interrupted/i.test(String(e))) throw e;
    await page.goto(url, { waitUntil: 'domcontentloaded' });
  }
}

async function shot(name) {
  if (!existsSync(ART)) return;
  try { mkdirSync(ART, { recursive: true }); } catch { /* exists */ }
  // PNG, not webp: Playwright's screenshot encoder here rejects image/webp.
  const file = name.replace(/\.webp$/i, '.png');
  try { await page.screenshot({ path: join(ART, file), type: 'png', fullPage: false }); }
  catch (e) { info('screenshot skipped', String(e).slice(0, 120)); }
}

async function readAddress() {
  await page.waitForSelector('#propPlaceHeading', { timeout: 30000 });
  return page.evaluate(() => {
    const h = document.getElementById('propPlaceHeading');
    const f = document.getElementById('propMapFrame');
    const src = f ? f.getAttribute('src') : '';
    const u = new URL(src, location.href);
    return {
      heading: h ? h.textContent.trim() : null,
      lat: u.searchParams.get('lat'),
      lng: u.searchParams.get('lng'),
      zipParam: u.searchParams.get('zip'),
      addrParam: u.searchParams.get('addr'),
      embed: u.searchParams.get('embed'),
      radius: u.searchParams.get('radius'),
      stale: /undefined|null/i.test((h && h.textContent) || '')
    };
  });
}

async function readZip() {
  await page.waitForSelector('#zipPlaceHeading', { timeout: 30000 });
  return page.evaluate(() => {
    const h = document.getElementById('zipPlaceHeading');
    const f = document.getElementById('zipMapFrame');
    const src = f ? f.getAttribute('src') : '';
    const u = new URL(src, location.href);
    return {
      heading: h ? h.textContent.trim() : null,
      zipParam: u.searchParams.get('zip'),
      lat: u.searchParams.get('lat'),
      lng: u.searchParams.get('lng'),
      embed: u.searchParams.get('embed'),
      stale: /undefined|null/i.test((h && h.textContent) || '')
    };
  });
}

function near(a, b) { return Math.abs(Number(a) - Number(b)) < 1e-6; }

console.log('='.repeat(78));
console.log('PLACE CHANGING HEADING — browser, Address + ZIP, transitions');
console.log('='.repeat(78));

// ═══ 1. Direct URL load — ZIP A ═════════════════════════════════════════════
await go('/community.html?zip=' + ZIP_A);
await waitShell();
const zA = await readZip();
info('ZIP A', zA);
ok(zA.heading === 'See what is changing in ' + ZIP_A, '1 ZIP A heading is "in" + 78617', zA.heading);
ok(zA.zipParam === ZIP_A, '1 ZIP A iframe zip= matches the heading', zA);
ok(!zA.lat && !zA.lng, '1 ZIP A iframe is area-mode (no lat/lng)', zA);
ok(zA.embed === '1', '1 ZIP A iframe is embed mode');
ok(!zA.stale, '1 ZIP A heading is not undefined/null');
ok(!/78744|78725|78719/.test(zA.heading), '1 ZIP A heading ignored poisoned myZip/viewZip/followed ZIP', zA.heading);
await shot('place-heading-zip-a.png');

// ═══ 2. Browser refresh keeps ZIP A ═════════════════════════════════════════
try {
  await page.reload({ waitUntil: 'domcontentloaded' });
} catch (e) {
  if (!/ERR_ABORTED|interrupted/i.test(String(e))) throw e;
  await go('/community.html?zip=' + ZIP_A);
}
await waitShell();
const zA2 = await readZip();
ok(zA2.heading === 'See what is changing in ' + ZIP_A && zA2.zipParam === ZIP_A,
  '2 refresh keeps ZIP A heading and iframe zip=', zA2);

// ═══ 3. Direct URL load — Address 1 ═════════════════════════════════════════
await go('/property.html?id=' + P1.id);
await waitShell();
const a1 = await readAddress();
info('Address 1', a1);
ok(a1.heading === 'See what is changing at ' + P1.address, '3 Address 1 heading is "at" + display address', a1.heading);
ok(near(a1.lat, P1.lat) && near(a1.lng, P1.lng), '3 Address 1 iframe is that property\'s saved point', a1);
ok(!a1.zipParam && !a1.addrParam, '3 Address 1 iframe is point-mode (no zip=, no addr=)', a1);
ok(a1.embed === '1' && a1.radius === '2', '3 Address 1 iframe keeps embed + radius 2');
ok(!a1.stale, '3 Address 1 heading is not undefined/null');
ok(!a1.heading.includes(ZIP_A) && !a1.heading.includes('78744'),
  '3 Address 1 heading is not a ZIP and not the poisoned myZip', a1.heading);
await shot('place-heading-address-1.png');

// ═══ 4. Address → Address (no refresh) ══════════════════════════════════════
await go('/property.html?id=' + P2.id);
await waitShell();
const a2 = await readAddress();
info('Address 2', a2);
ok(a2.heading === 'See what is changing at ' + P2.address, '4 Address 2 heading is "at" + the OTHER address', a2.heading);
ok(!a2.heading.includes(P1.address), '4 previous Address 1 did not survive', a2.heading);
ok(near(a2.lat, P2.lat) && near(a2.lng, P2.lng), '4 Address 2 iframe is p2\'s saved point, not p1\'s', a2);
await shot('place-heading-address-2.png');

// ═══ 5. Address → ZIP C (no refresh) ════════════════════════════════════════
await go('/community.html?zip=' + ZIP_C);
await waitShell();
const zCfromAddr = await readZip();
ok(zCfromAddr.heading === 'See what is changing in ' + ZIP_C, '5 Address → ZIP C heading is "in" + 78612', zCfromAddr.heading);
ok(!zCfromAddr.heading.includes(P2.address) && !zCfromAddr.heading.includes(P1.address),
  '5 previous address did not survive into the ZIP heading', zCfromAddr.heading);
ok(zCfromAddr.zipParam === ZIP_C && !zCfromAddr.lat, '5 ZIP C iframe is 78612 area, not an address point', zCfromAddr);

// ═══ 6. ZIP → ZIP (no refresh) ══════════════════════════════════════════════
await go('/community.html?zip=' + ZIP_A);
await waitShell();
const zA3 = await readZip();
ok(zA3.heading === 'See what is changing in ' + ZIP_A, '6 ZIP C → ZIP A heading flips to 78617', zA3.heading);
ok(!zA3.heading.includes(ZIP_C), '6 previous ZIP C did not survive', zA3.heading);
ok(zA3.zipParam === ZIP_A, '6 ZIP A iframe zip= matches');

// ═══ 7. THE REQUIRED SEQUENCE: ZIP A → Address B → ZIP C without refresh ════
await go('/community.html?zip=' + ZIP_A);
await waitShell();
const seqA = await readZip();
ok(seqA.heading === 'See what is changing in ' + ZIP_A && seqA.zipParam === ZIP_A,
  '7a ZIP A: in 78617, iframe zip=78617', seqA);

await go('/property.html?id=' + P2.id);
await waitShell();
const seqB = await readAddress();
ok(seqB.heading === 'See what is changing at ' + P2.address, '7b Address B: at 13100 Elroy Rd', seqB.heading);
ok(!seqB.heading.includes(ZIP_A) && !seqB.heading.includes('in ' + ZIP_A),
  '7b previous ZIP A did not survive', seqB.heading);
ok(near(seqB.lat, P2.lat) && near(seqB.lng, P2.lng) && !seqB.zipParam,
  '7b iframe is Address B\'s point, not ZIP geography', seqB);
await shot('place-heading-seq-address-b.png');

await go('/community.html?zip=' + ZIP_C);
await waitShell();
const seqC = await readZip();
ok(seqC.heading === 'See what is changing in ' + ZIP_C, '7c ZIP C: in 78612', seqC.heading);
ok(!seqC.heading.includes(P2.address) && !seqC.heading.includes(ZIP_A),
  '7c neither Address B nor ZIP A survived', seqC.heading);
ok(seqC.zipParam === ZIP_C && !seqC.lat, '7c iframe is ZIP C area', seqC);
ok(!/78744|78725|78719/.test(seqC.heading), '7c poisoned account geography still unused', seqC.heading);
await shot('place-heading-seq-zip-c.png');

// ═══ 8. Narrow viewport: Address heading wraps without overflowing ══════════
await page.setViewportSize({ width: 390, height: 844 });
await go('/property.html?id=' + P1.id);
await waitShell();
const wrap = await readAddress();
ok(wrap.heading === 'See what is changing at ' + P1.address, '8 mobile still shows Address 1 heading', wrap.heading);
const layout = await page.evaluate(() => {
  const h = document.getElementById('propPlaceHeading');
  const row = h && h.parentElement;
  const vw = document.documentElement.clientWidth;
  return {
    headingScroll: h ? h.scrollWidth : null,
    rowClient: row ? row.clientWidth : null,
    vw,
    overflowsViewport: h ? h.scrollWidth > vw + 1 : true,
    rowOverflows: row ? row.scrollWidth > row.clientWidth + 2 : true
  };
});
info('mobile wrap', layout);
ok(!layout.overflowsViewport, '8 heading does not overflow the 390px viewport', layout);
await shot('place-heading-mobile-wrap.png');

await page.setViewportSize({ width: 390, height: 844 });
await go('/community.html?zip=' + ZIP_A);
await waitShell();
const zipWrap = await readZip();
ok(zipWrap.heading === 'See what is changing in ' + ZIP_A, '8b mobile ZIP heading still "in" 78617', zipWrap.heading);
const zipLayout = await page.evaluate(() => {
  const h = document.getElementById('zipPlaceHeading');
  const vw = document.documentElement.clientWidth;
  return { headingScroll: h ? h.scrollWidth : null, vw, overflowsViewport: h ? h.scrollWidth > vw + 1 : true };
});
ok(!zipLayout.overflowsViewport, '8b ZIP heading does not overflow the 390px viewport', zipLayout);

// ═══ 9. Parent-page console ═════════════════════════════════════════════════
const headingErrors = pageErrors.filter(e =>
  /placeChangingHeading|propPlaceHeading|zipPlaceHeading|is not a function|undefined/i.test(e));
ok(headingErrors.length === 0, '9 no heading-related page errors', headingErrors);
if (pageErrors.length) info('other page errors (ignored if map-internal)', pageErrors);

await browser.close();
server.close();
console.log(fails === 0 ? '\nALL PASS' : '\n' + fails + ' FAILURE(S)');
process.exit(fails ? 1 : 0);
