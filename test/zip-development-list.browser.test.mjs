// A PROPOSED DATA CENTRE MAP 1 DRAWS IS IN THE ZIP PAGE'S DEVELOPMENT LIST, LABELLED AS A
// THIRD-PARTY LISTING (2026-11-12). Driven, not read: a real generated /community/<zip>/
// document, the shipped runtime and lib/data.js, against a stub whose map1_dc_zip_members answer
// is the real 94612 Behring row (production, 2026-11-12). Companion of
// test/zip-development-map-parity.test.mjs. Run: node test/zip-development-list.browser.test.mjs
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { readFileSync } from './lib/serve-page.mjs';
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
const out = mkdtempSync(join(tmpdir(), 'zdl-'));
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
    ['select','in','order','limit','contains','gte','lte','not','or','filter','range','maybeSingle','single','neq','lt','gt','is','ilike','like','match']
      .forEach(function(m){ o[m] = function(){ return o; }; });
    o.eq = function(c, v){ f.push([c, v]); return o; };
    o.then = function(r){ var rows = base(t).filter(function(x){
        return f.every(function(p){ return !(p[0] in x) || String(x[p[0]]) === String(p[1]); }); });
      return Promise.resolve({ data: rows, error: null }).then(r); };
    return o; }
  return { from: function(t){ return q(t); },
           rpc: function(n, a){
             if (n === 'map1_dc_zip_members') return Promise.resolve({ data: D.rpc_dc || [], error: null });
             if (n === 'app_projects_for_zip') return Promise.resolve({ data: D['rpc_' + (a && a.p_kind)] || [], error: null });
             // docs/zip-facility-inventory.sql: a complete boundary inventory holding the one facility row.
             if (n === 'zip_facility_inventory') return Promise.resolve({ data: { state: 'complete', member_count: (D.rpc_facility || []).length, latest_refresh: 'ok' }, error: null });
             return Promise.resolve({ data: null, error: null }); },
           auth: { getSession: function(){ return Promise.resolve({ data: { session: null } }); },
                   onAuthStateChange: function(){ return { data: { subscription: { unsubscribe: function(){} } } }; } } };
} };`;

const browser = await chromium.launch();
const ctx = await browser.newContext();

async function hydrate(zip, data) {
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e).slice(0, 200)));
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.startsWith(base)) return route.continue();
    if (url.includes('/rest/v1/') || url.includes('/functions/v1/'))
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    if (url.includes('cdn.jsdelivr.net'))
      return route.fulfill({ status: 200, contentType: 'text/javascript', body: stubFor(data) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.goto(base + '/community/' + zip + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => /Government\s*&\s*civic/.test((document.getElementById('commPage') || {}).textContent || ''),
    null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const r = await page.evaluate(() => {
    const el = document.getElementById('commPage');
    const heads = el ? [].slice.call(el.querySelectorAll('.groupHead')).map(h => h.textContent.replace(/\s+/g, ' ').trim()) : [];
    const st = document.getElementById('zip-score-strip');
    return { text: el ? el.textContent : '', html: el ? el.innerHTML : '', heads,
             strip: st ? st.textContent.replace(/\s+/g, ' ').trim() : '' };
  });
  await page.close();
  return { errors, ...r };
}

const BEHRING = {
  lat: 37.8086782, lng: -122.267477, has_more: false, map_status: 'Proposed', raw_status: 'proposed',
  source_key: 'dc:e59b8d43-9ec7-436f-a180-378d1ecfbbec',
  source_url: 'https://www.kqed.org/news/12095308/developer-councilmember-say-proposed-oakland-data-center-isnt-what-you-might-think',
  source_name: 'Compute Atlas (Edward Kubiak)', project_name: 'Behring 415 20th Street Data Center (former LBNL supercomputing building)',
  project_type: 'datacenter', location_text: '415 20th Street, Oakland, CA', source_licence: 'CC BY 4.0', zip_membership: 'member',
  normalized_status: 'proposed', publication_basis: 'canonical', location_precision: 'approximate_campus_area',
  canonical_entity_id: 'e59b8d43-9ec7-436f-a180-378d1ecfbbec', developer_or_operator: 'Behring Companies', quality_flags: [],
};
const OFFICIAL = 'OFFICIALPERMIT Fixture Tenant Improvement';
const DATA = {
  app_changes: [], meetings: [],
  communities: [{ id: '00000000-0000-0000-0000-000000000001', name: 'Fixture Town (__ZIP__)', parent_id: null,
    county: 'Hampden', state: 'MA', zip_codes: ['__ZIP__'], level: 'zip', government_topics: [] }],
  rpc_development: [{ id: 'p1', zip: '__ZIP__', name: OFFICIAL, type: 'Commercial', status: 'Approved',
    source_ref: 'https://example.test/permit', record_kind: 'development', submitted_at: '2026-08-01' }],
  rpc_facility: [],
  rpc_dc: [BEHRING],
};
const NAME = 'Behring 415 20th Street Data Center';
for (const zip of ['01001']) {
  const r = await hydrate(zip, DATA);
  ok(r.errors.length === 0, zip + ' no uncaught page error', r.errors);
  const dev = r.heads.find(h => /^Development & growth/.test(h)) || '';
  ok(/— 2 records/.test(dev), zip + ' the Development heading counts the official record and the listing', dev);
  ok(r.text.includes(NAME), zip + ' the proposed data centre is in the Development list');
  ok(r.text.includes(OFFICIAL), zip + ' control: the official record is still listed');
  ok(/Proposed · third-party listing/.test(r.text), zip + ' its status says it is a third-party listing');
  ok(/Not an official application, approval or permit; no official filing has been verified\./.test(r.text), zip + ' its card says it is not an official filing');
  ok(/Compute Atlas \(Edward Kubiak\), CC BY 4\.0/.test(r.text), zip + ' its card credits the source and licence');
  ok(r.html.includes(BEHRING.source_url), zip + ' its card links to the source\'s own page');
  ok(/(?:^|[^0-9])2\s*Development projects/.test(r.strip), zip + ' the Development projects tile counts both', r.strip);
}
// 94612's real shape (2026-11-14 audit): 205 official records ahead of the listing. The page shows
// three cards; a plain slice showed three official rows and never the data centre.
{
  const many = [];
  for (let i = 0; i < 205; i++) many.push({ id: 'o' + i, zip: '__ZIP__', name: 'Official permit ' + i, type: 'Commercial',
    status: 'Proposed', source_ref: 'https://example.test/p/' + i, record_kind: 'development', submitted_at: '2026-08-01' });
  const SECOND = Object.assign({}, BEHRING, { source_key: 'dc:second', canonical_entity_id: 'second', project_name: 'Second Listed Data Center' });
  const r = await hydrate('01001', Object.assign({}, DATA, { rpc_development: many, rpc_dc: [BEHRING, SECOND] }));
  ok(r.errors.length === 0, 'many: no uncaught page error', r.errors);
  ok(r.text.includes(NAME), 'many: the data centre gets one of the three cards behind 205 official records');
  ok(r.text.includes('Official permit 0') && r.text.includes('Official permit 1'), 'many: control, the first official records still show');
  ok(!r.text.includes('Official permit 2'), 'many: still three cards, not four');
  ok(/1 more data-center listing from third-party sources is on the map/.test(r.text), 'many: the listing not shown is named, with a link to the full list');
  ok(/href="\/development\.html\?zip=01001"/.test(r.html), 'many: the link goes to the full development list');
}
console.log('='.repeat(78));
console.log('FAILS: ' + fails);
console.log('='.repeat(78));
await browser.close();
server.close();
rmSync(out, { recursive: true, force: true });
process.exit(fails ? 1 : 0);
