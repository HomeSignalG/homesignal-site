// Fix 11 — clicking "+ Add a zip code" must open ADD, not Change.
//
// The dashed chip on the ZIP page used to open a dialog titled "Change your zip
// code", so a resident could not tell whether they were saving a new ZIP or
// toggling among ones they already had. Switching already-saved ZIPs is the
// solid chips / Switch place. This modal follows/saves.
//
// Run: node test/add-zip-modal.browser.test.mjs
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, normalize } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ART = '/opt/cursor/artifacts';
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

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();

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

await page.addInitScript(() => {
  localStorage.setItem('hs:myCommunities', JSON.stringify([
    { zip: '78617', name: 'Del Valle (78617)', state: 'TX' },
    { zip: '78657', name: 'Horseshoe Bay (78657)', state: 'TX' }
  ]));
  localStorage.setItem('hs:myZip', JSON.stringify('78617'));
});

await page.goto(base + '/community.html?data=seed&zip=78617', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#commStrip button.wchip', { timeout: 15000 });

const chip = await page.locator('#commStrip button.wchip').textContent();
ok(/Add a zip code/i.test(chip || ''), 'the dashed chip says Add a zip code', chip);

await page.locator('#commStrip button.wchip').click();
await page.waitForSelector('#locModal.show', { timeout: 5000 });

const title = (await page.locator('#locModalTitle').textContent() || '').trim();
const sub = (await page.locator('#locModal .msub').textContent() || '').trim();
ok(title === 'Add a zip code', 'modal title is Add a zip code', title);
ok(!/change/i.test(title), 'modal title does not say Change', title);
ok(/save it/i.test(sub), 'subtitle says the ZIP is saved', sub);

await page.screenshot({ path: join(ART, 'add-zip-modal-after.png'), fullPage: false });

await browser.close();
server.close();
console.log(fails === 0 ? '\nALL PASS' : '\n' + fails + ' FAILURE(S)');
process.exit(fails ? 1 : 0);
