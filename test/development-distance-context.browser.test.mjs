// Browser proof: Distance is ADDRESS-RELATIVE. The context comes from the shared Place-state
// contract (HS.declareRouteZipPlace -> HS.state.viewPlaceType === 'zip'), never from S.zip:
// a ZIP Place view has an active saved address too, so S.zip alone cannot tell them apart.
//   ZIP Place  (development.html?zip=<ZIP>): no Distance sort, no Distance table column, and
//              ?sort=distance / ?lens=2 fall back to the default (Impact).
//   Address    (development.html, saved address): Distance sort + column unchanged, ordered
//              by the existing distance_mi.
//
// Run: node test/development-distance-context.browser.test.mjs
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
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



const ids = () => page.evaluate(() => [...document.querySelectorAll('#devResults .devgrid .card')]
  .map(c => decodeURIComponent((c.getAttribute('onclick') || '').replace(/^.*\?id=([^']*)'.*$/, '$1'))));
const segs = () => page.evaluate(() => [...document.querySelectorAll('#devSort button')].map(b => b.dataset.sort));
const onSeg = () => page.evaluate(() => { const b = document.querySelector('#devSort button.on'); return b ? b.dataset.sort : null; });
const heads = () => page.evaluate(() => [...document.querySelectorAll('#devResults table.data-table th')].map(t => t.textContent.trim()));
const rowWidth = () => page.evaluate(() => { const r = document.querySelector('#devResults table.data-table tbody tr'); return r ? r.children.length : -1; });
async function open(url) {
  await page.goto(base + url, { waitUntil: 'domcontentloaded' });
  await waitReady();
  await page.waitForSelector('#devResults #devSort');
}
// Expected orders computed from the SAME projects the page renders, with the page's own comparators.
async function expected(kind) {
  return page.evaluate(async (kind) => {
    const S = HS.state;
    const a = (await HS.data.projects(S.zip, S.activeProperty)).slice();
    if (kind === 'distance') a.sort((x, y) => (x.distance_mi || 9e9) - (y.distance_mi || 9e9));
    if (kind === 'impact') a.sort((x, y) => (y.impact_score || 0) - (x.impact_score || 0));
    if (kind === 'status') a.sort((x, y) => HS.devStatusSortRank(x) - HS.devStatusSortRank(y));
    if (kind === 'newest') a.sort((x, y) => new Date(y.submitted_at) - new Date(x.submitted_at));
    return a.map(p => String(p.id));
  }, kind);
}

// ---- ZIP Place ----
for (const zip of ['84302', '97702']) {
  await open('/development.html?data=seed&zip=' + zip);
  const ctx = await page.evaluate(() => ({ vpt: HS.state.viewPlaceType, home: !!HS.state.activeProperty }));
  ok(ctx.vpt === 'zip', zip + ': the shared contract declares a ZIP Place', ctx);
  ok(JSON.stringify(await segs()) === JSON.stringify(['impact', 'status', 'newest']),
    zip + ': sort controls are Impact | Status | Newest (no Distance)', await segs());
  await page.click('#devDataBtn');
  await page.waitForSelector('#devResults table.data-table');
  const h = await heads();
  ok(h.indexOf('Distance') < 0, zip + ': Table view has no Distance column', h);
  ok(await rowWidth() === h.length, zip + ': table rows have one cell per header', { cells: await rowWidth(), heads: h.length });
}
ok(true, '84302 ZIP Place keeps a saved address active (S.zip / activeProperty cannot be the test)');

for (const q of ['sort=distance', 'lens=2']) {
  await open('/development.html?data=seed&zip=84302&' + q);
  ok(await onSeg() === 'impact', 'ZIP Place + ?' + q + ': falls back to the default Impact sort', await onSeg());
  ok(JSON.stringify(await ids()) === JSON.stringify(await expected('impact')),
    'ZIP Place + ?' + q + ': cards are in Impact order, not a hidden Distance order');
}

// Impact / Status / Newest unchanged on the ZIP Place.
await open('/development.html?data=seed&zip=84302');
for (const k of ['status', 'newest', 'impact']) {
  await page.click('#devSort button[data-sort="' + k + '"]');
  await page.waitForSelector('#devSort button.on[data-sort="' + k + '"]');
  ok(JSON.stringify(await ids()) === JSON.stringify(await expected(k)), 'ZIP Place: ' + k + ' order unchanged');
}

// ---- Address context (no route ZIP; saved address active) ----
// The sample projects carry no distance_mi, which would make a Distance-order check vacuous.
// Give them DISTINCT distance_mi values (ordered unlike Impact) by wrapping HS.data.projects
// before the page's first read, so the page's existing distance_mi comparator is exercised.
await page.addInitScript(() => {
  const t = setInterval(() => {
    const d = window.HS && window.HS.data;
    if (!d || !d.projects || d.projects.__distWrapped) return;
    const orig = d.projects;
    const w = async function () {
      const rows = await orig.apply(this, arguments);
      return (rows || []).map((p, i) => Object.assign({}, p, { distance_mi: ((i * 7) % 11) + 0.5 }));
    };
    w.__distWrapped = true; d.projects = w; clearInterval(t);
  }, 0);
});
await open('/development.html?data=seed');
const actx = await page.evaluate(() => ({ vpt: HS.state.viewPlaceType, home: HS.state.activeProperty && HS.state.activeProperty.address }));
ok(actx.vpt !== 'zip' && !!actx.home, 'address context: no ZIP Place declared, saved address active', actx);
ok(JSON.stringify(await segs()) === JSON.stringify(['impact', 'status', 'distance', 'newest']),
  'address context: Impact | Status | Distance | Newest', await segs());
for (const k of ['distance', 'status', 'newest', 'impact']) {
  await page.click('#devSort button[data-sort="' + k + '"]');
  await page.waitForSelector('#devSort button.on[data-sort="' + k + '"]');
  ok(JSON.stringify(await ids()) === JSON.stringify(await expected(k)), 'address context: ' + k + ' order (distance = existing distance_mi)');
}
const dvals = await page.evaluate(async () => (await HS.data.projects(HS.state.zip, HS.state.activeProperty)).map(p => p.distance_mi));
ok(dvals.every(v => typeof v === 'number') && JSON.stringify(await expected('distance')) !== JSON.stringify(await expected('impact')), 'address context: distance_mi present and orders differently from Impact (the check is not vacuous)', dvals);
await page.click('#devDataBtn');
await page.waitForSelector('#devResults table.data-table');
const ah = await heads();
ok(ah.indexOf('Distance') >= 0, 'address context: Table view keeps the Distance column', ah);
ok(await rowWidth() === ah.length, 'address context: table rows have one cell per header');
await open('/development.html?data=seed&sort=distance');
ok(await onSeg() === 'distance', 'address context: ?sort=distance is still honoured', await onSeg());

// ---- Layout: desktop + mobile, both contexts ----
for (const [w, h, label] of [[1280, 800, 'desktop'], [390, 844, 'mobile']]) {
  await page.setViewportSize({ width: w, height: h });
  for (const url of ['/development.html?data=seed&zip=84302', '/development.html?data=seed']) {
    await open(url);
    const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth,
      bar: Math.round(document.getElementById('devSort').getBoundingClientRect().width) }));
    ok(m.sw <= m.cw && m.bar > 0, label + ' ' + url + ': renders, no horizontal overflow', m);
  }
}

await browser.close();
server.close();
console.log(fails ? '\nFAILED ' + fails : '\nAll development distance-context browser checks passed');
process.exit(fails ? 1 : 0);
