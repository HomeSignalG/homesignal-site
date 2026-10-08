// CARDS OPEN THEIR RECORD, LABEL THEIR KIND, AND NEVER OPEN RAW WEATHER DATA. Driven, not read.
// (founder, 2026-10-08). Hydrates the real generated /community/<zip>/ document with the shipped
// runtime against a table-aware stub, then reads and CLICKS what a resident would.
// Run: node test/community-card-links.browser.test.mjs
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

// ── build the real documents from the committed fixture ─────────────────────────────────
const out = mkdtempSync(join(tmpdir(), 'cardlinks-'));
writeFileSync(join(out, 'sitemap.xml'), '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>\n');
execFileSync('python3', [join(root, 'scripts', 'gen_zip_pages.py'),
  '--fixture', join(root, 'test', 'fixtures', 'zip-pages.json'),
  '--out', out, '--now', '2026-09-04T00:00:00'], { encoding: 'utf8' });

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


const NWS = 'https://api.weather.gov/alerts/urn:oid:2.49.0.1.840.0.08321fd30b417d90603e7decb34d3ae7044dfcf9.001.1';
const NWS_PAGE = (z) => 'https://forecast.weather.gov/zipcity.php?inputstring=' + z;
const COMM = '00000000-0000-0000-0000-000000000001';
const T = { dataset: 'DATASETCARD Phoenix permit', record: 'RECORDCARD Austin case', nolink: 'NOLINKCARD dataset row without a link',
  wx: 'WXCARD Coastal Flood Advisory issued October 8', news: 'NEWSCARD Town approves library', gov: 'GOVCARD Notice of public hearing' };
const FULL = {
  app_changes: [
    { id: 'c-wx', zip: '__ZIP__', category: 'Local News', title: T.wx, plain_language: 'x', occurred_at: '2026-10-08', source_ref: NWS, confidence: 'High', lens: 'safety' },
    { id: 'c-news', zip: '__ZIP__', category: 'Local News', title: T.news, plain_language: 'x', occurred_at: '2026-10-07', source_ref: 'https://gazette.example.test/library', confidence: 'High', lens: 'safety' },
    { id: 'c-gov', zip: '__ZIP__', category: 'Government & civic', title: T.gov, plain_language: 'Government notice', occurred_at: '2026-10-06', source_ref: 'https://gov.example.test/n1', confidence: 'High', lens: 'safety' },
  ],
  communities: [{ id: COMM, name: 'Fixture Town (__ZIP__)', parent_id: null, county: 'Hampden', state: 'MA', zip_codes: ['__ZIP__'], level: 'zip', government_topics: [] }],
  meetings: [{ id: 'm1', title: 'MTGCARD Board of Selectmen', meeting_date: '2099-01-15T18:00:00Z', location: 'Town Hall', category: 'County Commission & county business', source_url: 'https://gov.example.test/mtg', community_id: COMM }],
  rpc_development: [
    { id: 'p1', zip: '__ZIP__', name: T.dataset, type: 'Commercial', status: 'Proposed', source_ref: 'https://apps-secure.example.test/pdd/search/permits', record_kind: 'development', submitted_at: '2026-08-01', registry_id: 'fixture-dataset', provenance: { url_precision: 'dataset' } },
    { id: 'p2', zip: '__ZIP__', name: T.record, type: 'Residential', status: 'Proposed', source_ref: 'https://www.example.test/devscreen/Case/C14-2026-0061', record_kind: 'development', submitted_at: '2026-08-02', registry_id: 'fixture-record', provenance: { url_precision: 'record' } },
    { id: 'p3', zip: '__ZIP__', name: T.nolink, type: 'Commercial', status: 'Proposed', source_ref: null, record_kind: 'development', submitted_at: '2026-08-03', registry_id: 'fixture-dataset', provenance: { url_precision: 'dataset' } },
  ],
  rpc_facility: [],
};
// A table- AND filter-aware stub: `.eq(col, val)` filters, so changes() and news() each get
// what a real PostgREST would give them. Every other chain method is a pass-through.
const stubFor = (data) => `window.__HS_ZIP = document.body.dataset.zip;
window.supabase = { createClient: function () {
  var Z = window.__HS_ZIP;
  var D = JSON.parse(${JSON.stringify(JSON.stringify(data))}.split('__ZIP__').join(Z));
  var META = [{ zip: Z, data_quality: 'pass', name: 'Fixture Town', county: 'Hampden', state: 'MA',
                component_scores: {}, indexable: true }];
  function base(t){ return t === 'app_community_meta' ? META : (D[t] || []); }
  function q(t){ var f = []; var o = {};
    ['select','in','order','limit','contains','gte','lte','not','or','filter','range','maybeSingle','single','neq']
      .forEach(function(m){ o[m] = function(){ return o; }; });
    o.eq = function(c, v){ f.push([c, v]); return o; };
    o.then = function(r){ var rows = base(t).filter(function(x){
        return f.every(function(p){ return !(p[0] in x) || String(x[p[0]]) === String(p[1]); }); });
      return Promise.resolve({ data: rows, error: null }).then(r); };
    return o; }
  return { from: function(t){ return q(t); },
           rpc: function(n, a){
             if (n === 'app_projects_for_zip') return Promise.resolve({ data: D['rpc_' + (a && a.p_kind)] || [], error: null });
             return Promise.resolve({ data: null, error: null }); },
           auth: { getSession: function(){ return Promise.resolve({ data: { session: null } }); },
                   onAuthStateChange: function(){ return { data: { subscription: { unsubscribe: function(){} } } }; } } };
} };`;


const browser = await chromium.launch();
const ctx = await browser.newContext();
const seenExternal = [];

async function hydrate(zip) {
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e).slice(0, 200)));
  await ctx.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.startsWith(base)) return route.continue();
    if (url.includes('/rest/v1/') || url.includes('/functions/v1/')) return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    if (url.includes('cdn.jsdelivr.net')) return route.fulfill({ status: 200, contentType: 'text/javascript', body: stubFor(FULL) });
    seenExternal.push(url);
    return route.fulfill({ status: 200, contentType: 'text/html', body: '<title>external</title>' });
  });
  await page.goto(base + '/community/' + zip + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => /GOVCARD/.test((document.getElementById('commPage') || {}).textContent || ''), null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1200);
  return { page, errors };
}
// every card whose title contains `marker`: how it is built
const cardOf = (page, marker) => page.evaluate((m) => {
  const root = document.getElementById('commPage');
  const cards = [].slice.call(root.querySelectorAll('.card.mini')).filter(c => c.textContent.indexOf(m) >= 0);
  if (cards.length !== 1) return { n: cards.length };
  const c = cards[0], lab = c.querySelector('.srclabel');
  return { n: 1, tag: c.tagName, href: c.getAttribute('href'), target: c.getAttribute('target'), rel: c.getAttribute('rel'),
           label: lab ? lab.textContent.replace(/\s+/g, ' ').trim() : null, srOnly: [].slice.call(c.querySelectorAll('.sr-only')).map(x => x.textContent).join(' '), nestedLinks: c.querySelectorAll('a').length };
}, marker);

const ZIP = '01001';
const { page, errors } = await hydrate(ZIP);
ok(errors.length === 0, 'no uncaught page error', errors);
const dataset = await cardOf(page, 'DATASETCARD'), record = await cardOf(page, 'RECORDCARD'), nolink = await cardOf(page, 'NOLINKCARD');
const wx = await cardOf(page, 'WXCARD'), news = await cardOf(page, 'NEWSCARD'), gov = await cardOf(page, 'GOVCARD');

ok(dataset.n === 1 && dataset.tag === 'A' && dataset.href === 'https://apps-secure.example.test/pdd/search/permits' && dataset.target === '_blank' && /noopener/.test(dataset.rel || ''),
  'a dataset-precision Development card is a link to its own URL, in a new tab, safely', dataset);
ok(dataset.label && /^Source data/.test(dataset.label), 'it carries the "Source data" label', dataset);
ok(dataset.nestedLinks === 0, 'the label is not a nested link', dataset);
ok(record.n === 1 && record.tag === 'A' && record.href === 'https://www.example.test/devscreen/Case/C14-2026-0061' && record.label === null && /opens in a new tab/.test(record.srOnly || ''),
  'a record-precision card is a link with NO label', record);
ok(nolink.n === 1 && nolink.tag === 'DIV' && nolink.href === null && nolink.label === null,
  'a dataset-precision row with no URL is a plain card: no link and no label', nolink);
ok(wx.n === 1 && wx.tag === 'A' && wx.href === NWS_PAGE(ZIP) && wx.target === '_blank', 'a weather alert card opens the NWS forecast page for the page\'s own ZIP', wx);
ok(wx.label && /Weather\.gov forecast for this ZIP \(may not list this alert\)/.test(wx.label), 'it says what it opens (the ZIP forecast) and that it may not list the alert', wx);
ok(news.n === 1 && news.tag === 'A' && news.href === 'https://gazette.example.test/library' && news.label === null, 'an ordinary news card is a link with no label', news);
ok(gov.n === 1 && gov.tag === 'A' && gov.href === 'https://gov.example.test/n1' && gov.label === null, 'a government notice card is a link with no label', gov);

const html = await page.evaluate(() => document.getElementById('commPage').innerHTML);
ok(!/api\.weather\.gov/i.test(html), 'the raw api.weather.gov URL appears nowhere in the rendered page');

// CLICK each kind and read where the browser actually goes: the navigation request it makes.
async function goesTo(trigger) {
  const mark = seenExternal.length;
  await trigger();
  const t0 = Date.now();
  while (Date.now() - t0 < 6000 && seenExternal.length === mark) await page.waitForTimeout(100);
  const urls = seenExternal.slice(mark);
  await page.waitForTimeout(400);                       // let a late popup appear before it is closed
  for (const pg of ctx.pages()) if (pg !== page) await pg.close().catch(() => {});
  return urls[0] || null;
}
ok((await goesTo(() => page.locator('.card.mini', { hasText: 'DATASETCARD' }).first().click())) === 'https://apps-secure.example.test/pdd/search/permits', 'clicking the dataset card goes to its source URL');
ok((await goesTo(() => page.locator('.card.mini', { hasText: 'WXCARD' }).first().click())) === NWS_PAGE(ZIP), 'clicking the weather card goes to the NWS ZIP page');
ok(!seenExternal.some(u => /api\.weather\.gov/.test(u)), 'the browser never requested the raw weather API');
const before = page.url(), mark = seenExternal.length;
await page.locator('.card.mini', { hasText: 'NOLINKCARD' }).first().click().catch(() => {});
await page.waitForTimeout(700);
ok(page.url() === before && seenExternal.length === mark, 'clicking a card with no link goes nowhere (no navigation, no new request)', { before, now: page.url(), requests: seenExternal.slice(mark) });
for (const pg of ctx.pages()) if (pg !== page) await pg.close().catch(() => {});

// KEYBOARD: a link card is reachable and Enter follows it
await page.locator('a.card-link', { hasText: 'RECORDCARD' }).first().focus();
ok((await goesTo(() => page.keyboard.press('Enter'))) === 'https://www.example.test/devscreen/Case/C14-2026-0061', 'a link card opens from the keyboard (Enter)');

// the label is readable: visible text plus a screen-reader hint, and the hint is not shown
const lab = await page.evaluate(() => { const s = document.querySelector('.srclabel'); if (!s) return null; const hid = s.querySelector('.sr-only'); const r = hid && hid.getBoundingClientRect();
  return { shown: s.getBoundingClientRect().height > 0, hint: hid ? hid.textContent : '', hintBox: r ? [r.width, r.height] : null }; });
ok(lab && lab.shown && /new tab/.test(lab.hint) && lab.hintBox && lab.hintBox[0] <= 1 && lab.hintBox[1] <= 1, 'the label shows, and its new-tab hint is for screen readers only', lab);
await page.close();

// THE CRAWLABLE DOCUMENT: weather alerts there open the same readable page, never the raw API
const staticHtml = readFileSync(join(out, 'community', ZIP, 'index.html'), 'utf8');
const wxSection = (staticHtml.match(/<h2>Weather alerts<\/h2>[\s\S]*?<\/ul>/) || [''])[0];
ok(wxSection.includes('href="' + NWS_PAGE(ZIP) + '"') && /Weather\.gov forecast for this ZIP \(may not list this alert\)/.test(wxSection), 'the generated page\'s weather list opens the NWS ZIP page, with its note', wxSection.slice(0, 300));
ok(/Every item links to its source record, except weather alerts, which link to the National Weather Service forecast for this ZIP; nothing on this page is generated or inferred\./.test(staticHtml), 'the crawlable footer no longer claims every item links to its source record when weather alerts are listed');
ok(!/api\.weather\.gov/i.test(staticHtml.replace(/<script[\s\S]*?<\/script>/g, '')), 'the generated page links the raw weather API nowhere');

console.log('='.repeat(78));
console.log('FAILS: ' + fails);
console.log('='.repeat(78));
await browser.close();
server.close();
rmSync(out, { recursive: true, force: true });
process.exit(fails ? 1 : 0);
