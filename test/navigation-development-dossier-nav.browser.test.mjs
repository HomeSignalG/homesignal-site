// Browser proof: on a project dossier, nothing in the chrome can dump Viewing back to a ZIP
// list, and the in-page paths between the dossier, the list and Map 1 keep the ZIP.
//
// RETARGETED (founder navigation plan v3, 2026-09-30). This file used to prove that the
// Development SIDEBAR link kept ?id= on a dossier, because clicking the already-lit
// Development item opened the ZIP list and Viewing fell off the project. Plan v3 removed
// Development from the sidebar (Explore | My Places | Enterprise), so that defect has no
// link left to happen through — and that absence is asserted here rather than dropped. The
// journeys that remain are in-page: the dossier's "Back to development" button and the
// list's "View Development Map" link, both stamped with the viewed ZIP.
//
// Run: node test/navigation-development-dossier-nav.browser.test.mjs
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

const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch());
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

async function chrome() {
  return page.evaluate(() => {
    // Primary items carry data-nav. The Explore dropdown's entries (founder, 2026-10-02)
    // carry none and are read separately as `sub`.
    const links = [...document.querySelectorAll('#hs-nav a[data-nav]')];
    return {
      sub: [...document.querySelectorAll('#hs-explore-sub a')].map(a => a.getAttribute('data-sub') + '|' + a.getAttribute('href')),
      tokens: links.map(a => a.getAttribute('data-nav')),
      hrefs: links.map(a => a.getAttribute('href')),
      lit: links.filter(a => a.classList.contains('on')).map(a => a.getAttribute('data-nav')),
      back: (() => {
        const b = [...document.querySelectorAll('#hs-slot button.backbtn')]
          .find(x => /Back to development/.test(x.textContent));
        return b ? b.getAttribute('onclick') : null;
      })(),
      mapLinks: [...document.querySelectorAll('#hs-slot a[data-znav="homesignalmap.html"]')]
        .map(a => a.getAttribute('href'))
    };
  });
}

const PID = 'proj-datacenter';

await page.goto(base + '/development.html?data=seed&zip=78617&id=' + PID, { waitUntil: 'domcontentloaded' });
await waitReady();
await page.waitForSelector('#hs-nav a[data-nav="explore"]');
await page.waitForFunction(() => !!document.querySelector('#hs-slot button.backbtn'), null, { timeout: 30000 });
const onDossier = await chrome();
ok(onDossier.tokens.join('|') === 'explore|props|enterprise',
  'dossier: the sidebar is Explore, My Places, Enterprise (plan v3)', onDossier.tokens);
ok(onDossier.hrefs.every(h => (h || '').split('?')[0] !== 'development.html'),
  'dossier: no PRIMARY sidebar item targets development.html', onDossier.hrefs);
// The dropdown's Quality of Life Impact entry is the one sidebar link to development.html.
// On a dossier it KEEPS the record id, as the 2026-09-12 ruling requires of the sidebar's
// development link ("Clicking Development on a project dossier must stay on that dossier"),
// so Viewing never falls off the project. The other two carry the viewed ZIP only.
const qolHref = (onDossier.sub[0] || '').split('|')[1] || '';
ok(onDossier.sub.length === 3 && /^qol\|development\.html\?/.test(onDossier.sub[0])
   && /[?&]zip=78617(&|$)/.test(qolHref) && /[?&]id=proj-datacenter(&|$)/.test(qolHref),
  'dossier: the Quality of Life Impact entry keeps the ZIP AND the dossier id', onDossier.sub);
ok(onDossier.sub[1] === 'map|homesignalmap.html?zip=78617' && onDossier.sub[2] === 'activity|community.html?zip=78617',
  'dossier: Development Map and Activity carry the viewed ZIP and nothing else', onDossier.sub);
ok(JSON.stringify(onDossier.hrefs) === JSON.stringify(['index.html', 'properties.html', 'development-activity.html']),
  'dossier: primary sidebar hrefs are unstamped section links (no ZIP, no project id)', onDossier.hrefs);
ok(JSON.stringify(onDossier.lit) === JSON.stringify(['explore']),
  'dossier: Explore is the one lit item (the development list is part of Explore)', onDossier.lit);
ok(!!onDossier.back && /development\.html\?zip=78617/.test(onDossier.back) && onDossier.back.indexOf('id=') < 0,
  'dossier: "Back to development" returns to the ZIP list, not to a leftover id', onDossier.back);

await page.goto(base + '/development.html?data=seed&zip=78617', { waitUntil: 'domcontentloaded' });
await waitReady();
await page.waitForFunction(() => !!document.querySelector('#hs-slot a[data-znav="homesignalmap.html"]'), null, { timeout: 30000 });
const onList = await chrome();
ok(onList.tokens.join('|') === 'explore|props|enterprise' && JSON.stringify(onList.lit) === JSON.stringify(['explore']),
  'list: same three items, Explore lit', onList);
ok(JSON.stringify(onList.sub) === JSON.stringify(['qol|development.html?zip=78617', 'map|homesignalmap.html?zip=78617', 'activity|community.html?zip=78617']),
  'list: the dropdown entries carry the viewed ZIP, and the list link carries no record id', onList.sub);
ok(onList.mapLinks.length > 0 && onList.mapLinks.every(h => h === 'homesignalmap.html?zip=78617'),
  'list: "View Development Map" carries the viewed ZIP and nothing else', onList.mapLinks);

await browser.close();
server.close();
console.log(fails ? '\nFAILED ' + fails : '\nAll development-dossier sidebar browser checks passed');
process.exit(fails ? 1 : 0);
