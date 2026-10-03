// ZIP COVERAGE, rendered (founder, 2026-10-03). Drives the SHIPPED generator and the SHIPPED shell
// and community runtime over a local copy of the site, offline.
//
//   §1 a specialized ZIP and a verification-pending ZIP serve their normal /community/<zip>/ page
//      (HTTP 200), show the approved panel once, and draw NO map, no stat tiles and no ZIP-wide
//      count or "0 projects" sentence
//   §2 the legacy community.html?zip= route does the same, with its notices and news sections
//   §3 the ZIP-keyed map pages show the panel instead of a map, noindex, canonical -> the document
//   §4 ADDRESS SEARCH IS NOT REPLACED: lat/lng and a session ZIP never turn a map page into a panel
//   §5 controls: a standard ZIP is untouched everywhere; Alerts is untouched; an unreadable model
//      fails OPEN to the standard page
//   §6 a USPS-verified retired ZIP (test-only model) gets the neutral unavailable page
//   §7 the CTAs: the nearby-ZIPs link lands on its anchor, the address link puts the cursor in the
//      homepage search with a hint
//
// Run: node test/zip-coverage.browser.test.mjs
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
  if (!c) { fails++; if (detail !== undefined) console.log('           detail: ' + JSON.stringify(detail).slice(0, 400)); }
};

const MODEL = JSON.parse(readFileSync(join(root, 'lib', 'zip-coverage.json'), 'utf8'));          // PUBLIC model
const INTERNAL = JSON.parse(readFileSync(join(root, 'docs', 'maps-coverage', 'fix4', 'zip-coverage-internal.json'), 'utf8'));   // place names for the fixture only
const SPEC = '78769', PEND = '75245', OPEN = '01001';     // PO box · regular street ZIP · standard
ok(MODEL.zips[SPEC].page_mode === 'specialized_zip' && MODEL.zips[PEND].page_mode === 'verification_pending' && !MODEL.zips[OPEN],
  'fixture ZIPs are on the right sides of the model');

// ── build the documents ─────────────────────────────────────────────────────────────────
const out = mkdtempSync(join(tmpdir(), 'zcovb-'));
const fx = JSON.parse(readFileSync(join(root, 'test', 'fixtures', 'zip-pages.json'), 'utf8'));
for (const z of [SPEC, PEND]) {
  fx.zips.push(z);
  fx.meta.push({ zip: z, name: `${INTERNAL.zips[z].city} (${z})`, county: INTERNAL.zips[z].county, state: INTERNAL.zips[z].state, data_quality: 'pass', indexable: true });
}
fx.zips.sort();
writeFileSync(join(out, 'fixture.json'), JSON.stringify(fx));
writeFileSync(join(out, 'sitemap.xml'), '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>\n');
const site = join(out, 'site');
execFileSync('python3', [join(root, 'scripts', 'gen_zip_pages.py'), '--fixture', join(out, 'fixture.json'), '--out', site,
  '--now', '2026-09-04T00:00:00', '--dev-plane', join(root, 'test', 'fixtures', 'development_seo_plane.json')], { encoding: 'utf8' });

// ── serve the repo the way Pages lays it out ────────────────────────────────────────────
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.xml': 'application/xml' };
let modelStatus = 200;          // §5 turns the model into a 500
let modelBody = null;           // §6 serves a different model
const server = createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel === '/lib/zip-coverage.json') {
    if (modelStatus !== 200) { res.writeHead(modelStatus).end('down'); return; }
    if (modelBody) { res.writeHead(200, { 'content-type': 'application/json' }).end(modelBody); return; }
  }
  const candidates = rel.endsWith('/') ? [join(site, rel, 'index.html'), join(root, rel, 'index.html')] : [join(site, rel), join(root, rel)];
  for (const p of candidates) {
    if (!normalize(p).startsWith(site) && !normalize(p).startsWith(root)) continue;
    let body;
    try { body = readFileSync(p); } catch { continue; }
    res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' }).end(body);
    return;
  }
  res.writeHead(404, { 'content-type': 'text/html' }).end(readFileSync(join(root, '404.html')));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;

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
async function open(path, { sessionZip, keep } = {}) {
  const ctx = await browser.newContext();
  if (sessionZip) await ctx.addInitScript((z) => { try { sessionStorage.setItem('hs:viewZip', z); } catch (e) {} }, sessionZip);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.startsWith(base)) return route.continue();
    if (url.includes('/rest/v1/') || url.includes('/functions/v1/')) return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    if (url.includes('cdn.jsdelivr.net') && /supabase/.test(url)) return route.fulfill({ status: 200, contentType: 'text/javascript', body: STUB });
    if (url.includes('cdn.jsdelivr.net')) return route.fulfill({ status: 200, contentType: 'text/javascript', body: '' });
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  const resp = await page.goto(base + path, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => !!document.getElementById('hs-zip-coverage') || !!document.getElementById('hs-zip-coverage-page')
    || ((document.getElementById('commPage') || {}).innerHTML || '').length > 0, null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const st = await page.evaluate(() => {
    const panels = document.querySelectorAll('#hs-zip-coverage');
    const p = panels[0];
    const robots = document.querySelector('meta[name="robots"]');
    const canon = document.querySelector('link[rel="canonical"]');
    return {
      url: location.pathname + location.search,
      title: document.title,
      panels: panels.length,
      inSlot: !!document.querySelector('#hs-slot #hs-zip-coverage'),
      visible: !!(p && p.getBoundingClientRect().height > 0 && p.getBoundingClientRect().top < window.innerHeight),
      mode: p ? p.getAttribute('data-zip-coverage') : null,
      panelZip: p ? p.getAttribute('data-zip') : null,
      panelText: p ? p.textContent.replace(/\s+/g, ' ').trim() : '',
      panelHeading: p && p.querySelector('h2') ? p.querySelector('h2').textContent.trim() : null,
      h1: (document.querySelector('h1') || {}).textContent || null,
      robots: robots ? robots.content : null,
      canonical: canon ? canon.getAttribute('href') : null,
      mapFrame: !!document.getElementById('zipMapFrame') || !!document.querySelector('iframe'),
      leaflet: !!document.querySelector('.leaflet-container, #map'),
      strip: !!document.querySelector('#zip-score-strip, .strip'),
      ssr: !!document.getElementById('hs-ssr'),
      bodyText: document.body.innerText.replace(/\s+/g, ' '),
      commPage: ((document.getElementById('commPage') || {}).innerHTML || '').length,
      retiredPage: !!document.getElementById('hs-zip-coverage-page') && document.getElementById('hs-zip-coverage-page').getAttribute('data-zip-coverage-page'),
      sessionZip: (function () { try { return sessionStorage.getItem('hs:viewZip'); } catch (e) { return 'x'; } })(),
    };
  });
  const extra = keep ? await keep(page) : null;
  await ctx.close();
  return { ...st, status: resp.status(), errors, extra };
}
const NO_ZIPWIDE = /\b\d+ (development )?projects?\b|0 projects|No permit or planning records|no projects/i;

// ── §1 the generated documents ──────────────────────────────────────────────────────────
console.log('§1 /community/<zip>/ for a specialized and a verification-pending ZIP');
for (const [z, mode] of [[SPEC, 'specialized_zip'], [PEND, 'verification_pending']]) {
  const c = MODEL.copy[mode];
  const r = await open(`/community/${z}/`);
  ok(r.status === 200, `${z} → HTTP 200 at its normal URL`, r.status);
  ok(r.panels === 1 && r.mode === mode && r.panelZip === z, `${z} → the ${mode} panel, exactly once`, { panels: r.panels, mode: r.mode });
  ok(r.inSlot && r.visible, `${z} → the panel is in the page body and on screen, not below the footer`, { inSlot: r.inSlot, visible: r.visible });
  ok(r.panelText.includes(c.title.replace('{zip}', z)) && c.body.every((p) => r.panelText.includes(p)), `${z} → the approved title and both paragraphs, whole`, r.panelText);
  if (mode === 'specialized_zip') ok(r.panelHeading === `HomeSignal coverage for ZIP ${z}`, `${z} → the heading is "HomeSignal coverage for ZIP ${z}"`, r.panelHeading);
  ok(!/active in HomeSignal|USPS|Postal Service|confirmed/i.test(r.panelText.replace(/verifying its current postal/i, '')), `${z} → the panel never says the Postal Service confirmed or activated the ZIP`, r.panelText);
  ok(r.title === c.page_title.replace('{zip}', z), `${z} → the approved page title`, r.title);
  ok(!r.mapFrame && !r.leaflet && !r.strip, `${z} → no map, no iframe, no stat tiles`, { frame: r.mapFrame, leaflet: r.leaflet, strip: r.strip });
  ok(!NO_ZIPWIDE.test(r.bodyText), `${z} → no ZIP-wide project count and no empty-search sentence`, r.bodyText.match(NO_ZIPWIDE));
  ok(!/decommission|retired|inactive|undeliverable|invalid/i.test(r.bodyText), `${z} → never calls the ZIP retired, inactive, invalid or decommissioned`);
  ok(r.canonical === `https://homesignal.net/community/${z}/`, `${z} → keeps its own canonical`, r.canonical);
  ok(r.errors.length === 0, `${z} → no page error`, r.errors);
}

// ── §2 the legacy route ─────────────────────────────────────────────────────────────────
console.log('§2 community.html?zip= (the legacy route)');
for (const [z, mode] of [[SPEC, 'specialized_zip'], [PEND, 'verification_pending']]) {
  const r = await open(`/community.html?zip=${z}`);
  ok(r.panels === 1 && r.mode === mode, `${z} → the ${mode} panel`, { panels: r.panels, mode: r.mode });
  ok(!r.mapFrame && !r.leaflet && !r.strip && !NO_ZIPWIDE.test(r.bodyText), `${z} → no map, no tiles, no ZIP-wide claim`, r.bodyText.slice(0, 200));
  ok(/government & civic/i.test(r.bodyText) && /local news/i.test(r.bodyText), `${z} → still shows its government and local news sections`);
  ok(/noindex/.test(r.robots || '') && r.canonical === `/community/${z}/`, `${z} → noindex legacy URL canonicalised to the document`, { robots: r.robots, canonical: r.canonical });
  ok(r.errors.length === 0, `${z} → no page error`, r.errors);
}

// ── §3 the ZIP map pages ────────────────────────────────────────────────────────────────
console.log('§3 map pages show the panel instead of a map');
for (const path of [`/homesignalmap.html?zip=${SPEC}`, `/development.html?zip=${PEND}`]) {
  const z = path.match(/zip=(\d{5})/)[1], mode = MODEL.zips[z].page_mode;
  const r = await open(path);
  ok(r.panels === 1 && r.mode === mode && r.panelZip === z, `${path} → the ${mode} panel`, { panels: r.panels, mode: r.mode });
  ok(!r.leaflet && !r.mapFrame, `${path} → no map was drawn`, { leaflet: r.leaflet });
  ok(/noindex/.test(r.robots || '') && r.canonical === `/community/${z}/`, `${path} → noindex, canonical to the document`, { robots: r.robots, canonical: r.canonical });
  ok(r.title === MODEL.copy[mode].page_title.replace('{zip}', z), `${path} → the approved page title`, r.title);
  ok(r.sessionZip !== z, `${path} → the ZIP is not carried to the next page`, r.sessionZip);
}

// ── §4 address search is not replaced ───────────────────────────────────────────────────
console.log('§4 address search near one of these ZIPs stays address search');
for (const path of [`/homesignalmap.html?lat=32.91&lng=-96.72&radius=2`, `/homesignalmap.html?zip=${SPEC}&lat=30.31&lng=-97.72&radius=2`]) {
  const r = await open(path, { sessionZip: SPEC });
  ok(r.panels === 0 && r.retiredPage === false, `${path} (session ZIP ${SPEC}) → no panel; Map 1 loads as an address search`, { panels: r.panels });
}
{
  const r = await open('/homesignalmap.html', { sessionZip: SPEC });
  ok(r.panels === 0, 'a map page with no ?zip= ignores a session ZIP in the model', { panels: r.panels });
}

// ── §5 controls ─────────────────────────────────────────────────────────────────────────
console.log('§5 controls');
for (const path of [`/community/${OPEN}/`, `/community.html?zip=${OPEN}`, `/homesignalmap.html?zip=${OPEN}`, `/development.html?zip=${OPEN}`]) {
  const r = await open(path);
  ok(r.panels === 0 && r.retiredPage === false, `${path} (standard ZIP) → no panel`, { panels: r.panels });
  if (path.startsWith('/community')) ok(r.commPage > 0 || r.ssr, `${path} → still renders its page`, { commPage: r.commPage });
}
{
  const r = await open(`/alerts.html?zip=${SPEC}`);
  ok(r.panels === 0 && r.retiredPage === false, `/alerts.html?zip=${SPEC} → untouched: Alerts is not a map page`, { panels: r.panels });
}
{
  const r = await open('/about.html', { sessionZip: SPEC });
  ok(r.panels === 0 && r.retiredPage === false, 'a page that draws no ZIP ignores a session ZIP in the model');
}
{
  modelStatus = 500;
  const r = await open(`/homesignalmap.html?zip=${SPEC}`);
  modelStatus = 200;
  ok(r.panels === 0 && r.retiredPage === false && r.errors.length === 0, 'a model that cannot be read fails OPEN: the page draws as a standard page, no error', { panels: r.panels, errors: r.errors });
}

// ── §6 a USPS-verified retired ZIP (test-only model) ────────────────────────────────────
console.log('§6 a confirmed-retired ZIP');
{
  const m = JSON.parse(JSON.stringify(MODEL));
  m.zips[PEND] = { ...m.zips[PEND], page_mode: 'retired' };       // the build derives this only from a USPS-verified internal entry (offline test §6)
  m.zips['48391'] = { ...m.zips['48391'], page_mode: 'mystery' };  // a mode the page cannot place
  modelBody = JSON.stringify(m);
  for (const path of [`/community.html?zip=${PEND}`, `/alerts.html?zip=${PEND}`, `/homesignalmap.html?zip=${PEND}`]) {
    const r = await open(path);
    ok(r.retiredPage === 'retired' && r.panels === 1 && r.mode === 'retired', `${path} → the neutral unavailable page`, { page: r.retiredPage, mode: r.mode });
    ok(/noindex/.test(r.robots || '') && r.canonical === null, `${path} → noindex, no canonical`, { robots: r.robots, canonical: r.canonical });
    ok(!/decommission|inactive|undeliverable/i.test(r.bodyText), `${path} → no decommissioned / inactive wording`);
  }
  const t = await open('/community.html?zip=48391');
  ok(t.mode === 'verification_pending' && t.retiredPage === false, '48391: a mode the page cannot place fails SAFE to a verification-pending page, never a retired one', { mode: t.mode, page: t.retiredPage });
  modelBody = null;
}

// ── §7 the CTAs ─────────────────────────────────────────────────────────────────────────
console.log('§7 the two calls to action');
{
  const r = await open(`/community/${SPEC}/`, { keep: async (page) => {
    const addr = await page.getAttribute('#zcovAddress', 'href');
    const near = await page.getAttribute('#zcovNearby', 'href');
    await page.click('#zcovNearby');
    await page.waitForTimeout(300);
    return { addr, near, path: await page.evaluate(() => location.pathname), hash: await page.evaluate(() => location.hash), anchor: await page.evaluate(() => !!document.getElementById('zip-nearby')) };
  } });
  ok(r.extra.addr === `/?near=${SPEC}#homeSearch`, 'primary CTA → the existing address search, carrying the ZIP as context', r.extra.addr);
  ok(r.extra.near === `/community/${SPEC}/#zip-nearby` && r.extra.hash === '#zip-nearby' && r.extra.anchor && r.extra.path === `/community/${SPEC}/`, 'secondary CTA → lands on the nearby-ZIPs section of the same page', r.extra);
  const m = await open(`/homesignalmap.html?zip=${SPEC}`, { keep: async (page) => ({ near: await page.getAttribute('#zcovNearby', 'href') }) });
  ok(m.extra.near === `/community/${SPEC}/#zip-nearby`, 'on a map page the secondary CTA goes to the ZIP document\'s nearby section', m.extra);
  const h = await open(`/?near=${SPEC}`, { keep: async (page) => ({
    hint: await page.evaluate(() => { const e = document.getElementById('homeNearHint'); return e && !e.hidden ? e.textContent : null; }),
    focused: await page.evaluate(() => document.activeElement && document.activeElement.id) }) });
  ok(/near ZIP 78769/.test(h.extra.hint || ''), 'the homepage shows a hint to enter an address near the ZIP', h.extra);
  ok(h.extra.focused === 'homeQuery', 'and the cursor is in the address box', h.extra);
}

// ── §9 ZIPs whose existence is unverified (84684, 84685) ─────────────────────────────────
console.log('§9 an unverified ZIP has no page: a noindex notice that says only that');
for (const z of ['84684', '84685']) {
  for (const path of [`/community.html?zip=${z}`, `/homesignalmap.html?zip=${z}`, `/alerts.html?zip=${z}`, `/homesignalmap.html?zip=${z}&lat=40.3&lng=-111.8&radius=2`]) {
    const r = await open(path, { keep: async (page) => ({
      cta: await page.getAttribute('#zcovAddress', 'href'),
      nearby: await page.evaluate(() => !!document.getElementById('zcovNearby')),
      h1: await page.evaluate(() => (document.querySelector('h1') || {}).textContent || ''),
      links: await page.evaluate(() => Array.from(document.querySelectorAll('#hs-slot a')).map((a) => a.getAttribute('href'))) }) });
    ok(r.retiredPage === 'unverified' && r.panels === 1 && r.mode === 'unverified', `${path} → the unverified notice`, { page: r.retiredPage, mode: r.mode });
    ok(r.extra.h1 === `ZIP ${z} is not available`, `${path} → heading "ZIP ${z} is not available"`, r.extra.h1);
    ok(r.panelText.includes(`We couldn't confirm that ZIP code ${z} is an active U.S. Postal Service ZIP code, so we don't have a page for it. Check the number, or search by city or address to find your community.`),
      `${path} → the founder-approved sentence, whole`, r.panelText);
    ok(/noindex/.test(r.robots || '') && /nofollow/.test(r.robots || '') && r.canonical === null, `${path} → noindex, nofollow, no canonical`, { robots: r.robots, canonical: r.canonical });
    ok(r.title === `ZIP ${z} is not available — HomeSignal`, `${path} → page title`, r.title);
    ok(r.extra.cta === '/' && r.extra.nearby === false && r.extra.links.every((h) => h === '/'), `${path} → one link, to the home page; no nearby-ZIP link, no redirect to another place`, r.extra);
    ok(!r.mapFrame && !r.leaflet && !r.strip, `${path} → no map, no tiles`);
    ok(!/retired|invalid|decommission|inactive|no longer in use/i.test(r.bodyText), `${path} → never called retired, invalid, decommissioned or inactive`);
    ok(r.sessionZip !== z, `${path} → the ZIP is not carried to the next page`, r.sessionZip);
  }
}
for (const z of ['84651', '84653']) {
  const r = await open(`/homesignalmap.html?zip=${z}`);
  ok(r.panels === 0 && r.retiredPage === false, `${z} (the real neighbour) → drawn normally, never the notice`, { panels: r.panels });
}

// ── §8 what the browser actually receives ───────────────────────────────────────────────
console.log('§8 the coverage JSON the browser fetches carries no internal provenance');
{
  const res = await fetch(base + '/lib/zip-coverage.json');
  const raw = await res.text();
  const j = JSON.parse(raw);
  ok(res.status === 200 && Object.keys(j.zips).length === 49, 'the served model lists the 47 coverage-limited ZIPs and the 2 unverified ones');
  ok(!/third_party_flag|decommission|verification_notes|postal_status_source|postal_status_verified_at/i.test(raw), 'it contains none of third_party_flag, decommissioned, verification_notes, postal_status_source, postal_status_verified_at');
  ok(Object.values(j.zips).every((e) => Object.keys(e).join() === 'zip_code,zip_type,map_coverage,page_mode'), 'every entry is exactly zip_code, zip_type, map_coverage, page_mode');
}

console.log('='.repeat(78));
console.log('FAILS: ' + fails);
console.log('='.repeat(78));
await browser.close();
server.close();
rmSync(out, { recursive: true, force: true });
process.exit(fails ? 1 : 0);
