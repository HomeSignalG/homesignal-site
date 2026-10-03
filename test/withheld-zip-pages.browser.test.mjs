// WITHHELD ZIP PAGES — the 47 retired ZIPs are off the live site (founder, 2026-10-01:
// "retire the 47 zip code pages, take them off live site until i can investigate further"), and so are
// the two UNVERIFIED ZIPs 84684 and 84685 (founder, 2026-10-03), whose notice must not say "retired".
//
// Drives the SHIPPED generator and the SHIPPED shell over a local copy of the site, offline:
//   §1  the build writes no document and no sitemap entry for a withheld ZIP, even when the
//       registry carries it, and records documents + withheld = registry in its manifest;
//   §2  every page that draws a ZIP shows the "not available" notice (noindex, no canonical)
//       for a withheld ZIP and never runs its own page code: ?zip= on the community page, Map 1,
//       Alerts and Development, the pretty /community/<zip>/ path through 404.html, and a
//       withheld ZIP carried only in the session;
//   §3  controls, so the notice cannot pass by blanking every page: a non-withheld ZIP still
//       renders its page, a non-ZIP page ignores a withheld session ZIP, and a list that cannot
//       be read fails OPEN (the page draws as before).
//
// Run: node test/withheld-zip-pages.browser.test.mjs
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, normalize } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0;
const ok = (c, name, detail) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name);
  if (!c) { fails++; if (detail !== undefined) console.log('           detail: ' + JSON.stringify(detail).slice(0, 300)); }
};

const LIST = JSON.parse(readFileSync(join(root, 'lib', 'withheld-zip-pages.json'), 'utf8'));
const W = '10048';          // a withheld ZIP (the old World Trade Center ZIP)
const OPEN = '01001';       // a ZIP that is not withheld and is in the committed fixture
const U = ['84684', '84685'];   // unverified ZIPs (existence not established)
const N = ['84651', '84653'];   // real neighbours: must render normally and be unchanged
ok(LIST.zips.includes(W) && !LIST.zips.includes(OPEN), 'fixture ZIPs are on the right sides of the list');
ok(U.every((z) => LIST.zips.includes(z) && LIST.unverified[z]) && !N.some((z) => LIST.zips.includes(z)),
  'the two unverified ZIPs are withheld and the two neighbours are not');

// ── §1 the build ────────────────────────────────────────────────────────────────────────
console.log('§1 the build writes nothing for a withheld ZIP');
const out = mkdtempSync(join(tmpdir(), 'whz-'));
const fx = JSON.parse(readFileSync(join(root, 'test', 'fixtures', 'zip-pages.json'), 'utf8'));
ok(!fx.zips.includes(W), 'the committed fixture does not already carry the withheld ZIP');
const metaFor = (zip, name, county, state) => ({ zip, name, county, state, data_quality: 'pass', indexable: true });
const utahMeta = [metaFor(N[0], 'Fixture Alpha (84651)', 'Utah', 'UT'), metaFor(N[1], 'Fixture Beta (84653)', 'Utah', 'UT'),
  metaFor(U[0], 'West Mountain', 'Utah', 'UT'), metaFor(U[1], 'Woodland Hills (84685)', 'Utah', 'UT')];
const fxBase = JSON.parse(JSON.stringify(fx));   // registry WITHOUT the unverified ZIPs, for the unchanged-neighbour comparison
fxBase.zips = fxBase.zips.concat([W].concat(N)).sort();
fxBase.meta = (fxBase.meta || []).concat([metaFor(W, 'New York (10048)', 'New York', 'NY'), utahMeta[0], utahMeta[1]]);
fx.zips = fx.zips.concat([W].concat(N, U)).sort();   // the registry carries them, as production does
fx.meta = (fx.meta || []).concat([metaFor(W, 'New York (10048)', 'New York', 'NY')], utahMeta);
const fxPath = join(out, 'fixture.json');
writeFileSync(fxPath, JSON.stringify(fx));
writeFileSync(join(out, 'sitemap.xml'), '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>\n');
const site = join(out, 'site');
const log = execFileSync('python3', [join(root, 'scripts', 'gen_zip_pages.py'), '--fixture', fxPath,
  '--out', site, '--now', '2026-09-04T00:00:00',
  '--dev-plane', join(root, 'test', 'fixtures', 'development_seo_plane.json')], { encoding: 'utf8' });
const man = JSON.parse(readFileSync(join(site, 'zip-pages-manifest.json'), 'utf8'));
ok(!existsSync(join(site, 'community', W)), `no /community/${W}/ document was written`);
ok(existsSync(join(site, 'community', OPEN, 'index.html')), `control: /community/${OPEN}/ was written`);
const sm = readFileSync(join(site, 'sitemap.xml'), 'utf8');
const withheldInFixture = fx.zips.filter((z) => LIST.zips.includes(z)).length;     // W + 84684 + 84685
ok(withheldInFixture === 3, 'the fixture registry carries three withheld ZIPs (10048, 84684, 84685)', withheldInFixture);
ok(man.documents + withheldInFixture === fx.zips.length && man.canonical_registry === fx.zips.length,
  'manifest: documents + the withheld ZIPs in the fixture = the registry, and the registry still counts all of them',
  { documents: man.documents, registry: man.canonical_registry, fixture: fx.zips.length });
for (const z of U) {
  ok(!existsSync(join(site, 'community', z)), `no /community/${z}/ document was written`);
  ok(!(man.indexable_zips || []).includes(z), `${z} is not in the indexable set`);
  ok(!sm.includes(`/community/${z}/`) && !sm.includes(`zip=${z}`), `the sitemap does not list ${z}`);
  ok(!sm.includes(`homesignalmap.html?zip=${z}`) && !sm.includes(`community.html?zip=${z}`), `the sitemap lists neither page URL form for ${z}`);
}
for (const z of N) ok(existsSync(join(site, 'community', z, 'index.html')), `control: /community/${z}/ was written`);
// No page the build wrote links to, names, or canonicalises either unverified ZIP.
{
  const { readdirSync, statSync } = await import('node:fs');
  const walk = (d) => readdirSync(d).flatMap((f) => { const q = join(d, f); return statSync(q).isDirectory() ? walk(q) : [q]; });
  const hits = walk(site).filter((f) => /\.(html|xml|json)$/.test(f) && f !== join(site, 'zip-pages-manifest.json'))
    .filter((f) => U.some((z) => readFileSync(f, 'utf8').includes(z)));
  ok(hits.length === 0, 'no generated page, sitemap or index names 84684 or 84685 (no sibling, related, city or canonical link)', hits.slice(0, 5));
}
// The neighbours are UNCHANGED by the withheld ZIPs sitting in the registry: build again without them and compare bytes.
{
  const out2 = mkdtempSync(join(tmpdir(), 'whz-base-'));
  const fx2 = join(out2, 'fixture.json'); writeFileSync(fx2, JSON.stringify(fxBase));
  writeFileSync(join(out2, 'sitemap.xml'), readFileSync(join(out, 'sitemap.xml')));
  const site2 = join(out2, 'site');
  execFileSync('python3', [join(root, 'scripts', 'gen_zip_pages.py'), '--fixture', fx2, '--out', site2, '--now', '2026-09-04T00:00:00',
    '--dev-plane', join(root, 'test', 'fixtures', 'development_seo_plane.json')], { encoding: 'utf8' });
  for (const z of N) ok(readFileSync(join(site, 'community', z, 'index.html')).equals(readFileSync(join(site2, 'community', z, 'index.html'))),
    `/community/${z}/ is byte-identical with and without 84684/84685 in the registry`);
  const m2 = JSON.parse(readFileSync(join(site2, 'zip-pages-manifest.json'), 'utf8'));
  ok(m2.canonical_registry === fxBase.zips.length && man.canonical_registry === m2.canonical_registry + 2,
    'the registry count differs by exactly the two ZIPs, which both builds count', { with: man.canonical_registry, without: m2.canonical_registry });
  rmSync(out2, { recursive: true, force: true });
}
ok(JSON.stringify(man.withheld_zips) === JSON.stringify([...LIST.zips].sort()), 'manifest records the list it used');
ok(!(man.indexable_zips || []).includes(W), 'the withheld ZIP is not in the indexable set');
ok(!sm.includes(`/community/${W}/`) && !sm.includes(`zip=${W}`), 'the sitemap does not list the withheld ZIP');
ok(new RegExp('withheld pages : ' + LIST.zips.length + ' ').test(log), 'the build says how many pages it withheld', log.split('\n').filter((l) => /withheld/.test(l)));

// ── serve the repo the way Pages lays it out ────────────────────────────────────────────
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.xml': 'application/xml' };
let listStatus = 200;      // §3c turns the list into a 500
const server = createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel === '/lib/withheld-zip-pages.json' && listStatus !== 200) { res.writeHead(listStatus).end('down'); return; }
  const candidates = rel.endsWith('/') ? [join(site, rel, 'index.html')] : [join(site, rel), join(root, rel)];
  for (const p of candidates) {
    if (!normalize(p).startsWith(site) && !normalize(p).startsWith(root)) continue;
    let body;
    try { body = readFileSync(p); } catch { continue; }
    res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' }).end(body);
    return;
  }
  // GitHub Pages serves 404.html for a path that does not exist.
  res.writeHead(404, { 'content-type': 'text/html' }).end(readFileSync(join(root, '404.html')));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;

// A passing meta row for whichever ZIP asks, so a non-withheld page renders its full page.
const STUB = `window.supabase = window.supabase || { createClient: function () {
  function zipOf(){ var m = location.search.match(/zip=(\\d{5})/); return (m && m[1]) || document.body.dataset.zip || '${OPEN}'; }
  function rows(t){ return t === 'app_community_meta' ? [{ zip: zipOf(), data_quality: 'pass', name: 'Fixture Town',
    county: 'Hampden', state: 'MA', component_scores: {}, indexable: true }] : []; }
  function q(t){ var o = {}; ['select','eq','in','order','limit','contains','gte','lte','not','or','filter','range','maybeSingle','single','is','neq','ilike','like','match']
    .forEach(function(m){ o[m] = function(){ return o; }; });
    o.then = function(r){ return Promise.resolve({ data: rows(t), error: null }).then(r); };
    return o; }
  return { from: function(t){ return q(t); },
           rpc: function(){ return Promise.resolve({ data: null, error: null }); },
           auth: { getSession: function(){ return Promise.resolve({ data: { session: null } }); },
                   onAuthStateChange: function(){ return { data: { subscription: { unsubscribe: function(){} } } }; } } };
} };`;

const browser = await chromium.launch();
async function open(path, { sessionZip } = {}) {
  const ctx = await browser.newContext();
  if (sessionZip) await ctx.addInitScript((z) => { try { sessionStorage.setItem('hs:viewZip', z); } catch (e) {} }, sessionZip);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.startsWith(base)) return route.continue();
    if (url.includes('/rest/v1/') || url.includes('/functions/v1/'))
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    if (url.includes('cdn.jsdelivr.net') && /supabase/.test(url))
      return route.fulfill({ status: 200, contentType: 'text/javascript', body: STUB });
    if (url.includes('cdn.jsdelivr.net')) return route.fulfill({ status: 200, contentType: 'text/javascript', body: '' });
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.goto(base + path, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => !!document.getElementById('hs-withheld')
    || ((document.getElementById('commPage') || {}).innerHTML || '').length > 0
    || !!document.getElementById('hs-slot'), null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2000);
  const st = await page.evaluate(() => {
    const w = document.getElementById('hs-withheld');
    const robots = document.querySelector('meta[name="robots"]');
    return {
      url: location.pathname + location.search,
      withheld: w ? w.getAttribute('data-zip-withheld') : null,
      h1: w ? (w.querySelector('h1') || {}).textContent : null,
      copy: w ? w.textContent : null,
      robots: robots ? robots.content : null,
      canonical: !!document.querySelector('link[rel="canonical"]'),
      commPage: ((document.getElementById('commPage') || {}).innerHTML || '').length,
      sessionZip: (function () { try { return sessionStorage.getItem('hs:viewZip'); } catch (e) { return 'x'; } })(),
    };
  });
  await ctx.close();
  return { ...st, errors };
}

// ── §2 every ZIP page shows the notice ──────────────────────────────────────────────────
console.log('§2 a withheld ZIP shows the notice on every page that draws a ZIP');
for (const path of [`/community.html?zip=${W}`, `/homesignalmap.html?zip=${W}`, `/alerts.html?zip=${W}`,
                    `/development.html?zip=${W}`, `/community/${W}/`]) {
  const r = await open(path);
  ok(r.withheld === W, `${path} → the "not available" notice for ${W}`, r);
  ok(r.h1 === `ZIP ${W} is not available`, `${path} → its heading names the ZIP`, r.h1);
  ok(/noindex/.test(r.robots || ''), `${path} → noindex`, r.robots);
  ok(!r.canonical, `${path} → no canonical link`);
  ok(r.commPage === 0, `${path} → the page's own code did not draw the ZIP`, r.commPage);
  ok(r.sessionZip !== W, `${path} → the withheld ZIP is not carried to the next page`, r.sessionZip);
}
console.log('§2b the unverified ZIPs show the same notice, worded as unverified, with no redirect');
for (const z of U) {
  for (const path of [`/community.html?zip=${z}`, `/homesignalmap.html?zip=${z}`, `/community/${z}/`]) {
    const r = await open(path);
    ok(r.withheld === z, `${path} → the "not available" notice for ${z}`, r);
    // /community/<zip>/ has no document for a withheld ZIP, so GitHub Pages serves 404.html, which (existing
    // behaviour) forwards to the dynamic page for the SAME ZIP. Anything else would be a redirect elsewhere.
    ok(r.url === path || r.url === `/community.html?zip=${z}`, `${path} → stayed on this ZIP (no redirect to another ZIP, city or place)`, r.url);
    ok(r.h1 === `ZIP ${z} is not available`, `${path} → its heading names the ZIP`, r.h1);
    ok(/noindex/.test(r.robots || ''), `${path} → noindex`, r.robots);
    ok(!r.canonical, `${path} → no canonical link`);
    ok(r.commPage === 0, `${path} → the page's own code did not draw the ZIP`, r.commPage);
    ok(/couldn't confirm that ZIP code /.test(r.copy || '') && !/retired|decommission|invalid|no longer in use/i.test(r.copy || ''),
      `${path} → says it could not confirm the ZIP, and never calls it retired, decommissioned or invalid`, r.copy);
    ok(!/West Mountain|Woodland Hills|Payson|Salem|Utah County/.test(r.copy || ''), `${path} → names no place, county or nearby ZIP`, r.copy);
  }
}
{
  const r = await open(`/community.html?zip=${W}`);
  ok(/retired/.test(r.copy || ''), 'control: the decommissioned ZIPs keep their own notice wording', r.copy);
}
{
  const r = await open('/alerts.html', { sessionZip: U[0] });
  ok(r.withheld === U[0], 'an unverified ZIP carried only in the session shows the notice and is not carried on', r);
}
{
  const r = await open('/alerts.html', { sessionZip: W });
  ok(r.withheld === W, 'a withheld ZIP carried only in the session still shows the notice on Alerts', r);
}

// ── §3 controls ─────────────────────────────────────────────────────────────────────────
console.log('§3 controls');
{
  const r = await open(`/community.html?zip=${OPEN}`);
  ok(r.withheld === null, `${OPEN} (not withheld) shows no notice`, r);
  ok(r.commPage > 0, `${OPEN} (not withheld) still renders its page`, r.commPage);
}
{
  const r = await open(`/community/${OPEN}/`);
  ok(r.withheld === null && r.commPage > 0, `/community/${OPEN}/ (generated document) still renders`, r);
}
for (const z of N) {
  for (const path of [`/community.html?zip=${z}`, `/homesignalmap.html?zip=${z}`, `/community/${z}/`]) {
    const r = await open(path);
    ok(r.withheld === null && r.url === path, `${path} (a real neighbour) shows no notice and is not redirected`, r);
  }
  const r = await open(`/community/${z}/`);
  ok(r.commPage > 0 && r.canonical, `/community/${z}/ still renders its page with its canonical link`, r);
}
{
  const r = await open('/about.html', { sessionZip: W });
  ok(r.withheld === null, 'a page that draws no ZIP ignores a withheld session ZIP', r);
}
{
  listStatus = 500;
  const r = await open(`/community.html?zip=${W}`);
  listStatus = 200;
  ok(r.withheld === null && r.commPage > 0, 'a list that cannot be read fails OPEN: the page draws as before', r);
}

console.log('='.repeat(78));
console.log('FAILS: ' + fails);
console.log('='.repeat(78));
await browser.close();
server.close();
rmSync(out, { recursive: true, force: true });
process.exit(fails ? 1 : 0);
