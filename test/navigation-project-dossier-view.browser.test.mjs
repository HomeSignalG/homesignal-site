// Browser proof: a project dossier with a listed street names that street in Viewing.
// Seed records have no address (pinned by the contract suite). This server injects
// one on proj-datacenter only, the same field My Places already reads.
//
// Run: node test/navigation-project-dossier-view.browser.test.mjs
import { createServer } from 'node:http';
import { mkdir } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, normalize } from 'node:path';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch (e) {
  console.log('SKIP navigation-project-dossier-view.browser.test.mjs — playwright not installed');
  process.exit(0);
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ART = '/opt/cursor/artifacts';
const STREET = '11921 PEARCE LN';
const PID = 'proj-datacenter';

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
    let body = await readFile(p);
    if (p.endsWith('seed/delvalle.js')) {
      body = Buffer.from(String(body).replace(
        "{ id:'proj-datacenter', name:'SH-130 Data Center Campus'",
        "{ id:'proj-datacenter', address:'" + STREET + "', zip:'78617', name:'SH-130 Data Center Campus'"
      ));
    }
    res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' }).end(body);
  } catch { res.writeHead(404).end('not found'); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;

const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch());
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
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

async function locLabel() {
  return page.evaluate(() => {
    const el = document.getElementById('locLabel');
    return el ? String(el.textContent || '').trim() : '';
  });
}

try { await mkdir(ART, { recursive: true }); } catch (e) {}

// ── list view stays an area ──────────────────────────────────────────────────
await page.goto(base + '/development.html?data=seed&zip=78617', { waitUntil: 'domcontentloaded' });
await waitReady();
await page.waitForSelector('#locLabel');
const listChip = await locLabel();
ok(listChip.length > 0, 'list view paints the Viewing chip', listChip);
ok(!new RegExp(STREET.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(listChip),
  'Development LIST does not name the project street in Viewing', listChip);
await page.screenshot({ path: join(ART, 'project_dossier_viewing_list.png'), fullPage: false });

// ── dossier names the listed street ──────────────────────────────────────────
await page.goto(base + '/development.html?data=seed&zip=78617&id=' + PID, { waitUntil: 'domcontentloaded' });
await waitReady();
await page.waitForFunction((street) => {
  const el = document.getElementById('locLabel');
  return el && el.textContent && el.textContent.indexOf(street) >= 0;
}, STREET);
const detailChip = await locLabel();
ok(detailChip.indexOf('Viewing · ' + STREET) >= 0,
  'project dossier Viewing chip names the listed street', detailChip);
ok(detailChip.indexOf('ZIP 78617') < 0,
  'project dossier Viewing is not the bare ZIP once a street is listed', detailChip);

const specs = await page.evaluate(() => {
  const el = document.querySelector('.specs');
  return el ? el.innerText : '';
});
ok(new RegExp('Address[\\s\\S]*' + STREET.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(specs),
  'THE SPECS names the same listed street', specs);

const heading = await page.evaluate(() => {
  const h = document.querySelector('.ph .eyebrow');
  return h ? h.textContent : '';
});
ok(/SH-130 Data Center Campus/.test(heading),
  'the dossier is still the seed project, not a different record', heading);

await page.screenshot({ path: join(ART, 'project_dossier_viewing_street.png'), fullPage: false });

await browser.close();
server.close();
console.log(fails ? '\nFAILED ' + fails : '\nAll project-dossier Viewing browser checks passed');
process.exit(fails ? 1 : 0);
