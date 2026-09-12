// Browser proof: on a project dossier, the Development sidebar keeps ?id=
// so clicking it does not dump Viewing back to a ZIP list.
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

async function navHrefs() {
  return page.evaluate(() => {
    const href = (nav) => {
      const a = document.querySelector('#hs-nav a[data-nav="' + nav + '"]');
      return a ? a.getAttribute('href') : '';
    };
    return { dev: href('dev'), alerts: href('alerts'), dash: href('dash'), props: href('props') };
  });
}

const PID = 'proj-datacenter';

await page.goto(base + '/development.html?data=seed&zip=78617&id=' + PID, { waitUntil: 'domcontentloaded' });
await waitReady();
await page.waitForSelector('#hs-nav a[data-nav="dev"]');
const onDossier = await navHrefs();
ok(/development\.html\?/.test(onDossier.dev) && onDossier.dev.indexOf('id=' + PID) >= 0,
  'dossier: Development sidebar keeps the project id', onDossier.dev);
ok(/zip=78617/.test(onDossier.dev), 'dossier: Development sidebar keeps the project ZIP', onDossier.dev);
ok(/alerts\.html\?zip=78617$/.test(onDossier.alerts),
  'dossier: Alerts stays zip-only (no project id)', onDossier.alerts);
ok(onDossier.props === 'properties.html' || onDossier.props.indexOf('properties.html') === 0,
  'My Places stays account-wide', onDossier.props);

await page.goto(base + '/development.html?data=seed&zip=78617', { waitUntil: 'domcontentloaded' });
await waitReady();
const onList = await navHrefs();
ok(onList.dev === 'development.html?zip=78617',
  'list: Development sidebar has ZIP only, no leftover dossier id', onList.dev);

await browser.close();
server.close();
console.log(fails ? '\nFAILED ' + fails : '\nAll development-dossier sidebar browser checks passed');
process.exit(fails ? 1 : 0);
