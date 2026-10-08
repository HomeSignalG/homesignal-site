// Fix 11 / A-010 — both Place adds, and where they live.
//   + Add Address   → HS.addHome (Census)
//   + Add ZIP Code  → HS.openLoc (follow)
// They sat in the top bar next to Viewing until the horizontal header (founder, Revised Index
// Design, 2026-09-30) took them out of the global chrome: "My Places already contains + Add
// Address and remains the supported management entry point", and the same for + Add ZIP
// Code. So this proves the header no longer carries them, and My Places' two buttons open the
// same two modals they used to.
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

async function assertNoHeaderPlaceAdds(label, path) {
  await page.goto(base + path, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#hs-top .hs-brand', { timeout: 15000 });
  const gone = await page.evaluate(() => ['hsAddZip', 'hsAddAddress', 'locLabel'].filter((id) => document.getElementById(id)));
  ok(gone.length === 0, label + ': the header carries no Place add and no Viewing chip', gone);
}
await assertNoHeaderPlaceAdds('ZIP page', '/community.html?data=seed&zip=78617');
await assertNoHeaderPlaceAdds('Alerts', '/alerts.html?data=seed&zip=78617');
await assertNoHeaderPlaceAdds('Address', '/property.html?data=seed');
await assertNoHeaderPlaceAdds('Development', '/development.html?data=seed&zip=78617');

await page.goto(base + '/properties.html?data=seed', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#plAddZip', { timeout: 15000 });
await page.waitForSelector('#plAddAddress', { timeout: 15000 });
const zipBtn = (await page.locator('#plAddZip').textContent() || '').trim();
const addrBtn = (await page.locator('#plAddAddress').textContent() || '').trim();
ok(zipBtn === '+ Add ZIP Code', 'My Places: the ZIP button says + Add ZIP Code', zipBtn);
ok(addrBtn === '+ Add Address', 'My Places: the Address button says + Add Address', addrBtn);
await page.locator('#plAddZip').click();
await page.waitForSelector('#locModal.show', { timeout: 5000 });
const title = (await page.locator('#locModalTitle').textContent() || '').trim();
const sub = (await page.locator('#locModal .msub').textContent() || '').trim();
const cta = (await page.locator('#locForm .mbtn').textContent() || '').trim();
ok(title === 'Add a zip code', 'My Places: ZIP modal title is Add a zip code', title);
ok(!/change/i.test(title), 'My Places: ZIP modal title does not say Change', title);
ok(/save it/i.test(sub), 'My Places: ZIP subtitle says the ZIP is saved', sub);
ok(cta === 'Add this zip code', 'My Places: ZIP modal CTA is Add this zip code', cta);
await page.locator('#locModal .modal').screenshot({ path: join(ART, 'add_zip_modal_my_places.png') });
await page.locator('#locModal .mclose').click();

await page.setViewportSize({ width: 390, height: 844 });
await page.goto(base + '/properties.html?data=seed', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#plAddZip', { timeout: 15000 });
const mobile = await page.evaluate(() => {
  const vis = (id) => { const e = document.getElementById(id); return !!(e && e.offsetParent !== null); };
  return { overflow: document.documentElement.scrollWidth > window.innerWidth + 1, zip: vis('plAddZip'), addr: vis('plAddAddress') };
});
ok(!mobile.overflow, 'at 390px My Places does not scroll sideways', mobile);
ok(mobile.zip && mobile.addr, 'at 390px both Place adds stay visible on My Places', mobile);
await page.screenshot({ path: join(ART, 'add_place_buttons_my_places_390.png'), fullPage: false });
await page.setViewportSize({ width: 1280, height: 900 });

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
await signedPage.waitForSelector('#plAddAddress', { timeout: 15000 });
await signedPage.evaluate(() => {
  document.body.classList.remove('onboarding-lock');
  const ob = document.querySelector('.onboarding');
  if (ob) { ob.classList.remove('show'); ob.style.display = 'none'; }
});
await signedPage.locator('#plAddAddress').click();
await signedPage.waitForSelector('#homeModal.show', { timeout: 8000 });
const homeTitle = (await signedPage.locator('#homeTitle').textContent() || '').trim();
ok(homeTitle === 'Add an address', 'signed-in + Add Address on My Places opens the Census address modal', homeTitle);
await signedPage.locator('#homeModal .modal').screenshot({ path: join(ART, 'add_address_topbar_modal_my_places.png') });
await signedIn.close();

await browser.close();
server.close();
console.log(fails === 0 ? '\nALL PASS' : '\n' + fails + ' FAILURE(S)');
process.exit(fails ? 1 : 0);
