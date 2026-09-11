// Browser proof: Save/Follow a ZIP (and the address card path) must announce
// My Places + the approved Alerts CTA, then navigate with place context, without
// enabling email or selecting topics. Run: node test/place-saved-cta.browser.test.mjs
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, normalize } from 'node:path';

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

const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(String(e).slice(0, 200)));

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
  window.__enableEmailCalls = 0;
});

await page.goto(base + '/community.html?data=seed&zip=78617', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.HS && typeof window.HS.toggleFollowCommunityBtn === 'function', { timeout: 15000 });
await page.waitForSelector('#commFollowBtn', { timeout: 15000 });

await page.evaluate(() => {
  const orig = window.HS.enableAreaEmail;
  window.HS.enableAreaEmail = function () {
    window.__enableEmailCalls = (window.__enableEmailCalls || 0) + 1;
    if (typeof orig === 'function') return orig.apply(this, arguments);
  };
});

const followLabel = await page.locator('#commFollowBtn').innerText();
ok(/Follow this zip code/.test(followLabel), 'ZIP follow control is present before save', followLabel);

await page.click('#commFollowBtn');
await page.waitForSelector('#hsOptin', { timeout: 5000 });
if (process.env.HS_SCREENSHOT_DIR) {
  await page.locator('#hsOptin').screenshot({ path: join(process.env.HS_SCREENSHOT_DIR, 'zip-save-card-closeup.png') });
}
const zipCard = await page.locator('#hsOptin').innerText();
ok(/saved to My Places/.test(zipCard), 'ZIP save card states My Places', zipCard);
ok(/Want email alerts\?/.test(zipCard), 'ZIP save card invites email alerts separately', zipCard);
ok(/Choose your alert topics →/.test(zipCard), 'ZIP save card has the approved CTA', zipCard);
ok(!/Emailing you/.test(zipCard) && !/Email me these alerts/.test(zipCard),
  'ZIP save card does not claim email was activated', zipCard);

const zipCtaHref = await page.getAttribute('#optinAlertsCta', 'href');
ok(zipCtaHref === 'alerts.html?zip=78617', 'ZIP CTA preserves ZIP via alerts.html?zip=', zipCtaHref);

const following = await page.evaluate(() => {
  return {
    isFollowing: window.HS.isFollowingCommunity('78617'),
    list: (window.HS.followedCommunities() || []).map(c => c.zip),
    enableCalls: window.__enableEmailCalls || 0
  };
});
ok(following.isFollowing === true, 'ZIP is in My Places after follow', following);
ok(following.list.filter(z => z === '78617').length === 1, 'follow does not duplicate the ZIP', following);
ok(following.enableCalls === 0, 'follow did not call enableAreaEmail', following);

const prefsBefore = await page.evaluate(() => JSON.stringify(window.HS.state.topicPrefs || {}));

await page.click('#optinAlertsCta');
await page.waitForURL(/alerts\.html\?zip=78617/, { timeout: 10000 });
if (process.env.HS_SCREENSHOT_DIR) {
  await page.screenshot({ path: join(process.env.HS_SCREENSHOT_DIR, 'zip-cta-alerts.png'), fullPage: false });
}
ok(true, 'ZIP CTA opened Alerts with ?zip=78617');

const alertsState = await page.evaluate(() => {
  const qs = new URLSearchParams(location.search);
  const prefs = window.HS.state && window.HS.state.topicPrefs;
  const cats = ['gov', 'meetings', 'news', 'dev'];
  const selected = {};
  cats.forEach(k => { selected[k] = (prefs && prefs[k] && prefs[k].topics) ? prefs[k].topics.slice() : []; });
  return {
    zipParam: qs.get('zip'),
    href: location.pathname.split('/').pop() + location.search,
    selected: selected,
    enableCalls: window.__enableEmailCalls || 0,
    checked: [...document.querySelectorAll('#tmGrid .tchip.on')].map(el => el.textContent)
  };
});
ok(alertsState.zipParam === '78617', 'Alerts page kept the saved ZIP', alertsState);
ok(Object.values(alertsState.selected).every(arr => arr.length === 0),
  'CTA did not select any alert topics', alertsState.selected);
ok((alertsState.checked || []).length === 0, 'no topic chips auto-checked', alertsState.checked);
ok(alertsState.enableCalls === 0, 'CTA did not call enableAreaEmail', alertsState);

const prefsAfter = await page.evaluate(() => JSON.stringify(window.HS.state.topicPrefs || {}));
ok(prefsAfter === prefsBefore || prefsAfter === '{}',
  'navigating to Alerts did not mutate topicPrefs', { prefsBefore, prefsAfter });

// Duplicate follow: already-saved ZIP via the lookup path must not duplicate My Places.
await page.goto(base + '/community.html?data=seed&zip=78617', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#commFollowBtn', { timeout: 15000 });
const dup = await page.evaluate(() => {
  const before = (window.HS.followedCommunities() || []).filter(c => c.zip === '78617').length;
  window.HS.followCommunity({ zip: '78617', name: 'Del Valle', state: 'TX' });
  const after = (window.HS.followedCommunities() || []).filter(c => c.zip === '78617').length;
  return { before, after };
});
ok(dup.before === 1 && dup.after === 1, 're-follow does not duplicate the ZIP in My Places', dup);

// Address card (same renderer saveHome uses via announcePlaceSaved). Full saveHome
// requires a signed-in supabase session + geocode; seed mode refuses openHome.
await page.goto(base + '/alerts.html?data=seed&zip=78617', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.HS && typeof window.HS.showAreaOptin === 'function', { timeout: 15000 });
await page.evaluate(() => {
  window.__enableEmailCalls = 0;
  const orig = window.HS.enableAreaEmail;
  window.HS.enableAreaEmail = function () {
    window.__enableEmailCalls = (window.__enableEmailCalls || 0) + 1;
    if (typeof orig === 'function') return orig.apply(this, arguments);
  };
  try { localStorage.setItem('hs:activeProp', JSON.stringify('addr-1')); } catch (e) {}
  window.HS.announcePlaceSaved({
    zip: '78617',
    kind: 'address',
    address: '2200 CALDWELL LN, DEL VALLE, TX 78617',
    placeId: 'addr-1'
  }, false);
});
await page.waitForSelector('#hsOptin', { timeout: 5000 });
if (process.env.HS_SCREENSHOT_DIR) {
  await page.locator('#hsOptin').screenshot({ path: join(process.env.HS_SCREENSHOT_DIR, 'address-save-card-closeup.png') });
}
const addrCard = await page.locator('#hsOptin').innerText();
ok(/2200 CALDWELL LN, DEL VALLE, TX 78617/.test(addrCard),
  'address card uses the confirmed address identity', addrCard);
ok(/saved to My Places/.test(addrCard), 'address card states My Places', addrCard);
ok(/Want email alerts\?/.test(addrCard) && /Choose your alert topics →/.test(addrCard),
  'address card has the approved invitation + CTA', addrCard);
ok(!/Emailing you/.test(addrCard), 'address card does not claim email was activated', addrCard);
const addrHref = await page.getAttribute('#optinAlertsCta', 'href');
ok(addrHref === 'alerts.html?zip=78617', 'address CTA carries ZIP context', addrHref);

const addrEnable = await page.evaluate(() => window.__enableEmailCalls || 0);
ok(addrEnable === 0, 'address card did not call enableAreaEmail');

await page.click('#optinAlertsCta');
await page.waitForURL(/alerts\.html\?zip=78617/, { timeout: 10000 });
if (process.env.HS_SCREENSHOT_DIR) {
  await page.screenshot({ path: join(process.env.HS_SCREENSHOT_DIR, 'address-cta-alerts.png'), fullPage: false });
}
const addrAlerts = await page.evaluate(() => new URLSearchParams(location.search).get('zip'));
ok(addrAlerts === '78617', 'address CTA opened Alerts with the saved ZIP');

ok(pageErrors.length === 0, 'no uncaught page errors', pageErrors);

await browser.close();
server.close();
if (fails) { console.error(`\n${fails} failed`); process.exit(1); }
console.log('\nAll place-saved-cta browser assertions passed.');
