// Fix 11 / A-010 — the top bar next to Viewing has both Place adds:
//   + Add an address  → HS.addHome (Census)
//   + Add a zip code  → HS.openLoc (follow)
// Viewing stays Switch place.
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

async function assertPlaceAddChips(label, path) {
  await page.goto(base + path, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#hsAddZip', { timeout: 15000 });
  await page.waitForSelector('#hsAddAddress', { timeout: 15000 });
  const zipChip = await page.locator('#hsAddZip').textContent();
  const addrChip = await page.locator('#hsAddAddress').textContent();
  ok(/Add a zip code/i.test(zipChip || ''), label + ': the ZIP chip says Add a zip code', zipChip);
  ok(/Add an address/i.test(addrChip || ''), label + ': the Address chip says Add an address', addrChip);
  const addrOn = await page.locator('#hsAddAddress').getAttribute('onclick');
  ok(/HS\.addHome\(\)/.test(addrOn || ''), label + ': Address chip reuses HS.addHome', addrOn);
  await page.locator('#hsAddZip').click();
  await page.waitForSelector('#locModal.show', { timeout: 5000 });
  const title = (await page.locator('#locModalTitle').textContent() || '').trim();
  const sub = (await page.locator('#locModal .msub').textContent() || '').trim();
  const cta = (await page.locator('#locForm .mbtn').textContent() || '').trim();
  ok(title === 'Add a zip code', label + ': ZIP modal title is Add a zip code', title);
  ok(!/change/i.test(title), label + ': ZIP modal title does not say Change', title);
  ok(/save it/i.test(sub), label + ': ZIP subtitle says the ZIP is saved', sub);
  ok(cta === 'Add this zip code', label + ': ZIP modal CTA is Add this zip code', cta);
  await page.locator('#locModal .mclose').click();
}

await assertPlaceAddChips('ZIP page', '/community.html?data=seed&zip=78617');
await assertPlaceAddChips('Alerts', '/alerts.html?data=seed&zip=78617');
await assertPlaceAddChips('Address', '/property.html?data=seed');
await assertPlaceAddChips('Development', '/development.html?data=seed&zip=78617');
await assertPlaceAddChips('My Places', '/properties.html?data=seed');

await page.setViewportSize({ width: 390, height: 844 });
await page.goto(base + '/alerts.html?data=seed&zip=78617', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#hsAddZip', { timeout: 15000 });
await page.waitForSelector('#hsAddAddress', { timeout: 15000 });
const mobile = await page.evaluate(() => ({
  overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
  zip: (document.getElementById('hsAddZip') || {}).innerText || '',
  addr: (document.getElementById('hsAddAddress') || {}).innerText || ''
}));
ok(!mobile.overflow, 'at 390px the top bar does not scroll sideways', mobile);
ok(/ZIP/i.test(mobile.zip), 'at 390px the ZIP chip stays visible as ZIP', mobile);
ok(/Address/i.test(mobile.addr), 'at 390px the Address chip stays visible as Address', mobile);
await page.screenshot({ path: join(ART, 'add_place_chips_topbar_390.png'), fullPage: false });

await page.setViewportSize({ width: 1280, height: 900 });
await page.goto(base + '/alerts.html?data=seed&zip=78617', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#hsAddZip', { timeout: 15000 });
await page.screenshot({ path: join(ART, 'add_place_chips_topbar_on_alerts.png'), fullPage: false });
await page.locator('#hsAddZip').click();
await page.waitForSelector('#locModal.show', { timeout: 5000 });
await page.locator('#locModal .modal').screenshot({ path: join(ART, 'add_zip_topbar_modal_alerts.png') });
await page.locator('#locModal .mclose').click();

await page.goto(base + '/property.html?data=seed', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#hsAddZip', { timeout: 15000 });
await page.screenshot({ path: join(ART, 'add_place_chips_topbar_on_address.png'), fullPage: false });
await page.locator('#hsAddZip').click();
await page.waitForSelector('#locModal.show', { timeout: 5000 });
await page.locator('#locModal .modal').screenshot({ path: join(ART, 'add_zip_topbar_modal_address.png') });
await page.locator('#locModal .mclose').click();

await page.goto(base + '/properties.html?data=seed', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#hsAddAddress', { timeout: 15000 });
await page.screenshot({ path: join(ART, 'add_address_topbar_on_my_places.png'), fullPage: false });

const signedIn = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const signedPage = await signedIn.newPage();
await signedPage.route('**/*', async (route) => {
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
            getSession:function(){ return Promise.resolve({data:{session:{user:{id:'u1',email:'sd@homesignal.net'}}}}); },
            onAuthStateChange:function(){ return {data:{subscription:{unsubscribe:function(){}}}}; }
          }
        };
      }};`
    });
  }
  return route.abort();
});
await signedPage.goto(base + '/properties.html', { waitUntil: 'domcontentloaded' });
await signedPage.waitForSelector('#hsAddAddress', { timeout: 15000 });
await signedPage.evaluate(() => {
  document.body.classList.remove('onboarding-lock');
  const ob = document.querySelector('.onboarding');
  if (ob) { ob.classList.remove('show'); ob.style.display = 'none'; }
});
await signedPage.locator('#hsAddAddress').click();
await signedPage.waitForSelector('#homeModal.show', { timeout: 8000 });
const homeTitle = (await signedPage.locator('#homeTitle').textContent() || '').trim();
ok(homeTitle === 'Add an address', 'signed-in Add an address opens the Census address modal', homeTitle);
await signedPage.locator('#homeModal .modal').screenshot({ path: join(ART, 'add_address_topbar_modal_my_places.png') });
await signedIn.close();

await browser.close();
server.close();
console.log(fails === 0 ? '\nALL PASS' : '\n' + fails + ' FAILURE(S)');
process.exit(fails ? 1 : 0);
