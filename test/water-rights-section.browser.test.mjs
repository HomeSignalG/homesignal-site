// WATER RIGHTS FILINGS on a generated /community/<zip>/ document, in a real browser (2026-10-28).
// Builds the real documents with scripts/gen_zip_pages.py, stubs Supabase, and checks that the section
// renders the reader's answer: the filing (a55167) with its agency link, the not_covered sentence, and a
// failed read as a failed read. The three What's Changing groups stay exactly three.
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
const out = mkdtempSync(join(tmpdir(), 'wr-'));
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

// The production answer for 84336 (a55167), as public.water_rights_for_zip returned it 2026-10-28.
const WR_COMPLETE = { zip: '__ZIP__', state: 'UT', state_name: 'Utah', agency: 'Utah Division of Water Rights', status: 'complete',
  checked_at: '2026-10-28T15:42:56.663509+00:00',
  filings: [{ uses: 'OP', points: [{ lat: 41.733397354101, lng: -112.700301266394 }, { lat: 41.7534187416931, lng: -112.660197642405 }],
    status: 'Unapproved', filed_on: '2026-10-15', right_no: '13-2', applicant: 'BAR H RANCH INC.',
    diversion: 'Point of Return · Salt Wells Spring Stream', filing_no: 'a55167', date_label: 'Priority date',
    record_url: 'https://www.waterrights.utah.gov/search/?q=a55167', filing_type: 'Application To Appropriate' }] };
const WR_NOT_COVERED = { zip: '__ZIP__', state: 'MA', state_name: 'Massachusetts', status: 'not_covered', filings: [] };
const BASE = { app_changes: [], communities: [], meetings: [], rpc_development: [], rpc_facility: [] };

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
             if (n === 'water_rights_for_zip') return D.wr ? Promise.resolve({ data: D.wr, error: null }) : Promise.resolve({ data: null, error: { message: 'x' } });
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
    const hs = el ? [].slice.call(el.querySelectorAll('.groupHead')) : [];
    const wr0 = document.getElementById('zip-water-rights');
    const F = Node.DOCUMENT_POSITION_FOLLOWING;
    const placed = !!(wr0 && hs.length === 3 && (hs[0].compareDocumentPosition(wr0) & F) && (wr0.compareDocumentPosition(hs[1]) & F));
    const st = document.getElementById('zip-score-strip');
    const wr = document.getElementById('zip-water-rights');
    return { text: el ? el.textContent : '', html: el ? el.innerHTML : '', heads, placed,
             wrState: wr ? wr.getAttribute('data-water-rights-state') : null, wrText: wr ? wr.textContent.replace(/\s+/g, ' ').trim() : '',
             wrHref: wr && wr.querySelector('a[href]') ? wr.querySelector('a[href]').getAttribute('href') : null,
             strip: st ? st.textContent.replace(/\s+/g, ' ').trim() : '' };
  });
  await page.close();
  return { errors, ...r };
}

const zip = '01001';
const c = await hydrate(zip, Object.assign({}, BASE, { wr: WR_COMPLETE }));
ok(c.errors.length === 0, 'complete — no uncaught page error', c.errors);
ok(c.wrState === 'complete', 'complete — the section renders the reader state', c.wrState);
ok(/a55167/.test(c.wrText) && /BAR H RANCH INC\./.test(c.wrText) && /Agency status: Unapproved/.test(c.wrText), 'complete — the filing, its applicant and the agency status', c.wrText);
ok(c.wrHref === 'https://www.waterrights.utah.gov/search/?q=a55167', 'complete — links the agency record', c.wrHref);
ok(c.heads.length === 3 && /^Development/.test(c.heads[0]) && /^Government/.test(c.heads[1]) && /^Local news/.test(c.heads[2]),
  'complete — What\u2019s Changing still has exactly its three groups', c.heads);
ok(c.placed === true, 'complete — the section sits under Development & growth, above Government & civic');
const n = await hydrate(zip, Object.assign({}, BASE, { wr: WR_NOT_COVERED }));
ok(n.wrState === 'not_covered' && /does not read Massachusetts\u2019s water-rights records yet/.test(n.wrText), 'not_covered — the sentence is about us', n.wrText);
const f = await hydrate(zip, BASE);
ok(f.wrState === 'read_failed' && /could not be read just now/.test(f.wrText) && !/No pending/.test(f.wrText), 'failed read — never reads as none', f.wrText);

await browser.close();
server.close();
rmSync(out, { recursive: true, force: true });
console.log('FAILS: ' + fails);
process.exit(fails ? 1 : 0);
