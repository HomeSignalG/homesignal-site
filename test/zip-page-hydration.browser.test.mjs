// THE EXACT PATH THAT TURNED THE PAGES BUILD GATE RED — reproduced, then proven fixed.
//
// Pages run 33929420398 failed its crawler proof on two generated documents:
//   FAIL — [01002] no uncaught page errors during hydration
//          (TypeError: Cannot read properties of undefined (reading 'build'))
//   FAIL — [01001] ...the same
// A red build gate means the site does not deploy at all, so this is not a cosmetic bug.
//
// The path: lib/community-page.js calls HS.govNoticeCopy.build() when a ZIP has NO notices
// (`if (!notices.length)`). That global comes from lib/gov-notice-copy.js, which was added
// to community.html only — the generated documents never loaded it. Because the branch is
// data-dependent, the identical code passed the gate at 20:50 and failed it at 23:27.
//
// This drives the SHIPPED generator over the committed fixture, serves the documents it
// emits, forces the zero-notice branch, and hydrates the two ZIPs that actually failed.
// Offline: every outbound call is answered here, so it reproduces the failure by DATA SHAPE
// rather than by waiting for production to be in the wrong state again.
//
// Run: node test/zip-page-hydration.browser.test.mjs
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, normalize } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0;
const ok = (c, name, detail) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name);
  if (!c) { fails++; if (detail !== undefined) console.log('           detail: ' + JSON.stringify(detail).slice(0, 300)); }
};
const info = (k, v) => console.log('   · ' + k + ': ' + (typeof v === 'string' ? v : JSON.stringify(v)));

// ── build the real documents from the committed fixture ─────────────────────────────────
const out = mkdtempSync(join(tmpdir(), 'zph-'));
writeFileSync(join(out, 'sitemap.xml'), '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>\n');
execFileSync('python3', [join(root, 'scripts', 'gen_zip_pages.py'),
  '--fixture', join(root, 'test', 'fixtures', 'zip-pages.json'),
  '--out', out, '--now', '2026-09-04T00:00:00'], { encoding: 'utf8' });

// Serve the generated documents from the artifact directory and everything else (the shared
// runtime, config, libs) from the repo — exactly how the Pages artifact is laid out.
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.xml': 'application/xml' };
const server = createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]);
  const candidates = rel.endsWith('/') ? [join(out, rel, 'index.html')] : [join(out, rel), join(root, rel)];
  for (const p of candidates) {
    if (!normalize(p).startsWith(out) && !normalize(p).startsWith(root)) continue;
    try {
      const body = readFileSync(p);
      res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' }).end(body);
      return;
    } catch { /* try the next candidate */ }
  }
  res.writeHead(404).end('not found');
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;

// The one row that decides whether the runtime renders the full page: a PASSING ZIP.
// Without it the page short-circuits long before the branch this test exists to exercise.
const META_ROW = (zip) => ({ zip: zip, data_quality: 'pass', name: 'Fixture Town',
  county: 'Hampden', state: 'MA', component_scores: {}, indexable: true });
const SUPABASE_STUB = `window.__HS_ZIP = document.body.dataset.zip;
window.supabase = window.supabase || { createClient: function () {
  var meta = [${JSON.stringify(META_ROW('__ZIP__'))}];
  function rows(t){ return t === 'app_community_meta'
    ? [Object.assign({}, meta[0], { zip: window.__HS_ZIP })] : []; }
  function q(t){ var o = {}; ['select','eq','in','order','limit','contains','gte','lte','not','or','filter','range','maybeSingle','single']
    .forEach(function(m){ o[m] = function(){ return o; }; });
    o.then = function(r){ return Promise.resolve({ data: rows(t), error: null }).then(r); };
    return o; }
  return { from: function(t){ return q(t); },
           rpc: function(){ return Promise.resolve({ data: null, error: null }); },
           auth: { getSession: function(){ return Promise.resolve({ data: { session: null } }); },
                   onAuthStateChange: function(){ return { data: { subscription: { unsubscribe: function(){} } } }; } } };
} };`;

const browser = await chromium.launch();
const ctx = await browser.newContext();

async function hydrate(zip) {
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e).slice(0, 200)));
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.startsWith(base)) return route.continue();
    // ZERO NOTICES — the shape that enters the branch that crashed. Every app_* read
    // answers empty, so `notices.length === 0` and HS.govNoticeCopy.build() must run.
    if (url.includes('/rest/v1/') || url.includes('/functions/v1/'))
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    if (url.includes('cdn.jsdelivr.net'))
      // A TABLE-AWARE supabase stub. It must answer app_community_meta with a PASSING row,
      // or the runtime takes its "isn't covered yet" branch and never reaches the code that
      // crashed. Everything else answers empty — which is exactly the zero-notice shape
      // (`if (!notices.length)`) that enters HS.govNoticeCopy.build().
      return route.fulfill({ status: 200, contentType: 'text/javascript', body: SUPABASE_STUB });
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.goto(base + '/community/' + zip + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  // wait for the shared runtime to have run its render (or for it to have died trying)
  await page.waitForFunction(() => !!document.querySelector('#commPage'), null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2500);
  const state = await page.evaluate(() => ({
    govNoticeCopyLoaded: !!(window.HS && window.HS.govNoticeCopy && typeof window.HS.govNoticeCopy.build === 'function'),
    scripts: [].slice.call(document.querySelectorAll('script[src]')).map(s => s.getAttribute('src')),
    rendered: (document.getElementById('commPage') || {}).innerHTML ? true : false,
    // Proof the branch under test ACTUALLY RAN: with zero notices the runtime renders one
    // of gov-notice-copy's two determinate states. Without this the suite could pass
    // vacuously on a page that never reached the call at all — which is exactly how the
    // first version of this test went green while the defect was still in place.
    govNoticeRendered: /No notices on file right now|No source identified yet/
      .test(((document.getElementById('commPage') || {}).textContent) || '')
  }));
  await page.close();
  return { errors, ...state };
}

console.log('='.repeat(78));
console.log('GENERATED ZIP DOCUMENT — hydration on the zero-notice path');
console.log('='.repeat(78));

for (const zip of ['01001', '01002']) {
  const r = await hydrate(zip);
  info(zip, { errors: r.errors, govNoticeCopyLoaded: r.govNoticeCopyLoaded, rendered: r.rendered });
  const buildErr = r.errors.filter(e => /reading 'build'/.test(e));
  ok(buildErr.length === 0,
    zip + ' — no "Cannot read properties of undefined (reading \'build\')" (the exact gate failure)', buildErr);
  ok(r.govNoticeCopyLoaded,
    zip + ' — the generated document actually loaded the dependency its runtime consumes', r.scripts);
  ok(r.errors.length === 0, zip + ' — no uncaught page error at all during hydration', r.errors);
  ok(r.rendered, zip + ' — the page rendered its content');
  ok(r.govNoticeRendered,
    zip + ' — the zero-notice branch actually ran (this suite is not passing vacuously)', r.govNoticeRendered);
}

console.log('='.repeat(78));
console.log('FAILS: ' + fails);
console.log('='.repeat(78));
await browser.close();
server.close();
rmSync(out, { recursive: true, force: true });
process.exit(fails ? 1 : 0);
