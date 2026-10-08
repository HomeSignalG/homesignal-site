// Browser proof: the Development LIST page hosts canonical Map 1 (?embed=1) as a
// compact preview, with the right ZIP in both URLs; the iframe keeps ONE browsing
// context across a sort change and a Table-view toggle; detail pages carry no
// preview; no horizontal overflow at desktop or mobile widths.
//
// Run: node test/development-map-preview.browser.test.mjs
import { createServer } from 'node:http';
import { readFile } from './lib/serve-page.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, normalize } from 'node:path';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch (e) {
  console.log('SKIP navigation-development-dossier-nav.browser.test.mjs — playwright not installed');
  process.exit(0);
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
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
    const body = await readFile(p);
    res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' }).end(body);
  } catch { res.writeHead(404).end('not found'); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;

const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch(process.env.HS_CHROME ? { executablePath: process.env.HS_CHROME } : {}));
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();

await page.route('**/*', async (route) => {
  const url = route.request().url();
  if (url.startsWith(base)) return route.continue();
  if (url.includes('/rest/v1/') || url.includes('/auth/v1/') || url.includes('/functions/v1/')) {
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  }
  if (url.includes('cdn.jsdelivr.net')) {
    return route.fulfill({
      status: 200,
      contentType: 'text/javascript',
      body: `window.supabase={createClient:function(){
        function q(){
          var o={};
          ['select','eq','in','order','limit','contains','gte','lte','not','or','filter','range','match','maybeSingle','single','insert','update','delete']
            .forEach(function(m){ o[m]=function(){ return o; }; });
          o.then=function(r){ return Promise.resolve({data:[],error:null}).then(r); };
          return o;
        }
        return {
          from:function(){ return q(); },
          rpc:function(){ return Promise.resolve({data:null,error:null}); },
          functions:{invoke:function(){ return Promise.resolve({data:null,error:null}); }},
          auth:{
            getSession:function(){ return Promise.resolve({data:{session:null}}); },
            onAuthStateChange:function(){ return {data:{subscription:{unsubscribe:function(){}}}}; }
          }
        };
      }};`
    });
  }
  return route.abort();
});

async function waitReady() {
  await page.waitForFunction(() => window.HS && window.HS.ready);
  await page.evaluate(() => window.HS.ready);
}

async function navHrefs() {
  return page.evaluate(() => {
    const href = (nav) => {
      const a = document.querySelector('#hs-nav a[data-nav="' + nav + '"]');
      return a ? a.getAttribute('href') : '';
    };
    return { dev: href('dev'), alerts: href('alerts'), dash: href('dash'), props: href('props') };
  });
}


async function openList(zip) {
  await page.goto(base + '/development.html?data=seed&zip=' + zip, { waitUntil: 'domcontentloaded' });
  await waitReady();
  await page.waitForSelector('#devResults #devSort');
}

for (const zip of ['97702', '78617']) {
  await openList(zip);
  const n = await page.locator('iframe#devMapFrame').count();
  ok(n === 1, zip + ': exactly one Map 1 preview', n);
  const src = await page.getAttribute('#devMapFrame', 'src');
  ok(src === 'homesignalmap.html?embed=1&zip=' + zip, zip + ': iframe src is canonical Map 1 embed', src);
  const full = await page.getAttribute('#devMapFull', 'href');
  ok(full === 'homesignalmap.html?zip=' + zip, zip + ': full-map link resolves to Map 1', full);
  const title = await page.getAttribute('#devMapFrame', 'title');
  ok(/Development Map for ZIP /.test(title) && title.indexOf(zip) >= 0, zip + ': iframe has an accurate title', title);
  // Order: header CTA -> preview -> toolbar.
  const order = await page.evaluate(() => {
    const ph = document.querySelector('.ph'), pv = document.getElementById('devMapPreview'), tb = document.getElementById('devSort');
    return !!(ph && pv && tb) && (ph.compareDocumentPosition(pv) & 4) && (pv.compareDocumentPosition(tb) & 4) ? true : false;
  });
  ok(order, zip + ': header, then preview, then the sort toolbar');
}

// ---- The iframe IS canonical Map 1 (97702) ----
await openList('97702');
await page.evaluate(() => document.getElementById('devMapFrame').scrollIntoView());
const frameEl = await page.waitForSelector('#devMapFrame');
let frame = await frameEl.contentFrame();
await frame.waitForLoadState('domcontentloaded');
await frame.waitForFunction(() => window.HS && window.HS.ready);
await frame.evaluate(() => window.HS.ready);
// Map 1 reads the ZIP after HS.ready resolves, and #results (which holds the map) stays
// display:none until that read finishes. On a busy runner this check ran first and saw a
// 0x0 map (CI run 37028354853). Wait for the read to finish, with a limit: a map that never
// shows still fails below.
await frame.waitForFunction(() => {
  const r = document.getElementById('results');
  return !!r && getComputedStyle(r).display !== 'none';
}, null, { timeout: 20000 }).catch(() => {});
const inside = await frame.evaluate(() => {
  const vis = (sel) => { const e = document.querySelector(sel); if (!e) return false; const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0; };
  return {
    embed: document.documentElement.classList.contains('hs-embed'),
    side: vis('#hs-side'), top: vis('#hs-top'),
    key: !!document.querySelector('#mapkey'),
    map: vis('#map'),
    zip: new URL(location.href).searchParams.get('zip'),
  };
});
ok(inside.embed, 'iframe: embed mode active (html.hs-embed)', inside);
ok(!inside.side && !inside.top, 'iframe: global app chrome hidden', inside);
ok(inside.key, 'iframe: Map 1 control panel present (#mapkey)', inside);
ok(inside.map, 'iframe: the map canvas is visible', inside);
ok(inside.zip === '97702', 'iframe: carries the page ZIP', inside.zip);

// ---- Same browsing context across sort + Table view ----
await frame.evaluate(() => { window.__hsPreviewMark = 'kept'; });
const before = await page.evaluate(() => { const f = document.getElementById('devMapFrame'); f.__hsElMark = 'kept'; return true; });
await page.click('#devSort button[data-sort="newest"]');
await page.waitForSelector('#devSort button.on[data-sort="newest"]');
let el = await page.evaluate(() => document.getElementById('devMapFrame').__hsElMark);
let ctx = await frame.evaluate(() => window.__hsPreviewMark).catch(() => null);
ok(el === 'kept', 'sort: the iframe ELEMENT was not recreated', el);
ok(ctx === 'kept', 'sort: the iframe BROWSING CONTEXT was not reloaded', ctx);
await page.click('#devDataBtn');
await page.waitForSelector('#devResults table.data-table, #devResults .card');
el = await page.evaluate(() => document.getElementById('devMapFrame').__hsElMark);
ctx = await frame.evaluate(() => window.__hsPreviewMark).catch(() => null);
ok(el === 'kept', 'table view: the iframe ELEMENT was not recreated', el);
ok(ctx === 'kept', 'table view: the iframe BROWSING CONTEXT was not reloaded', ctx);
ok(await page.locator('iframe#devMapFrame').count() === 1, 'still exactly one preview after repaints');

// ---- No preview on a detail page ----
await page.goto(base + '/development.html?data=seed&zip=78617&id=proj-datacenter', { waitUntil: 'domcontentloaded' });
await waitReady();
await page.waitForTimeout(500);
ok(await page.locator('#devMapFrame, #devMapPreview').count() === 0, 'detail page (?id=) has no preview');

// ---- Full-page Map 1 is not in embed mode ----
await page.goto(base + '/homesignalmap.html?zip=97702', { waitUntil: 'domcontentloaded' });
await waitReady();
ok(!(await page.evaluate(() => document.documentElement.classList.contains('hs-embed'))), 'full-page Map 1 is NOT in embed mode');

// ---- Dimensions + no horizontal overflow, desktop and mobile ----
for (const [w, h, label] of [[1280, 800, 'desktop'], [390, 844, 'mobile']]) {
  await page.setViewportSize({ width: w, height: h });
  await openList('97702');
  const m = await page.evaluate(() => {
    const r = document.getElementById('devMapFrame').getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height), sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth };
  });
  console.log('      ' + label + ' preview ' + m.w + 'x' + m.h + ' (viewport ' + m.cw + ', scrollWidth ' + m.sw + ')');
  ok(m.sw <= m.cw, label + ': no horizontal overflow', m);
  ok(m.h >= 280 && m.h <= 425, label + ': preview height is compact', m);
}

await browser.close();
server.close();
console.log(fails ? '\nFAILED ' + fails : '\nAll development map-preview browser checks passed');
process.exit(fails ? 1 : 0);
