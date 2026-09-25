// ENVIRONMENT & UTILITIES — NO AUTHORITATIVE OUTCOME, NO ENVIRONMENT CLAIM. Driven, not read.
//
// The offline half (test/environment-absence-requires-authoritative-outcome.test.mjs) pins
// the shipped SOURCE. This half hydrates a real generated /community/<zip>/ document — the
// shipped generator over the committed fixture, the shipped shared runtime, the shipped
// lib/data.js — against a table-aware Supabase stub, and reads what a resident would see.
//
// TWO DATA SHAPES:
//   ZERO   every plane answers empty — the shape that used to print the false absence
//          sentence on every page ("… on file for this ZIP yet").
//   FULL   every NEIGHBOURING plane carries a record that merely SOUNDS environmental, plus
//          one app_changes row whose category is literally 'Environment & utilities' — the
//          very value the old consumer keyed on. That row is not an authoritative
//          Environment outcome (no producer emits it; production holds 0 such rows), so it
//          must reach no section at all, and every neighbour must render its own record
//          exactly once, in its own section.
//
// Offline: every outbound call is answered here. Run: node test/environment-absence.browser.test.mjs
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
const out = mkdtempSync(join(tmpdir(), 'env-'));
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

// ── the records, one per neighbouring plane. Titles are unique so each can be counted. ──
const T = {
  envRow:   'ENVROW Drinking water advisory for the Fixture system',  // category 'Environment & utilities'
  govWater: 'GOVWATER Fixture Water Conservancy District board hearing',
  news:     'NEWSWQ Fixture reservoir water quality sampling results',
  devUtil:  'DEVUTIL Fixture Wastewater Treatment Plant Expansion',
  facility: 'FACIL Fixture Municipal Water Reclamation Facility',
  meeting:  'MTGWATER Fixture Sewer and Water Committee',
};
const FUTURE = '2099-01-15T18:00:00Z';
const FULL = {
  app_changes: [
    { id: 'c-env', zip: '__ZIP__', category: 'Environment & utilities', title: T.envRow,
      plain_language: 'x', occurred_at: '2026-09-01', source_ref: 'https://example.test/env', confidence: 'High', lens: 'water' },
    { id: 'c-gov', zip: '__ZIP__', category: 'Government & civic', title: T.govWater,
      plain_language: 'Government notice — Water districts & utilities from Hampden County — see the official record.',
      occurred_at: '2026-09-01', source_ref: 'https://example.test/gov', confidence: 'High', lens: 'safety' },
    { id: 'c-news', zip: '__ZIP__', category: 'Local News', title: T.news,
      plain_language: 'x', occurred_at: '2026-09-01', source_ref: 'https://example.test/news', confidence: 'High', lens: 'safety' },
  ],
  communities: [{ id: '00000000-0000-0000-0000-000000000001', name: 'Fixture Town (__ZIP__)', parent_id: null,
    county: 'Hampden', state: 'MA', zip_codes: ['__ZIP__'], level: 'zip', government_topics: [] }],
  meetings: [{ id: 'm1', title: T.meeting, meeting_date: FUTURE, location: 'Town Hall', category: 'Water districts & utilities',
    source_url: 'https://example.test/mtg', community_id: '00000000-0000-0000-0000-000000000001' }],
  rpc_development: [{ id: 'p1', zip: '__ZIP__', name: T.devUtil, type: 'Infrastructure', status: 'Proposed',
    source_ref: 'https://example.test/dev', record_kind: 'development', submitted_at: '2026-08-01' }],
  rpc_facility: [{ id: 'f1', zip: '__ZIP__', name: T.facility, type: 'Wastewater', status: 'Operating',
    developer: 'EPA FRS · registry 110000000000', source_ref: 'https://echo.epa.gov/detailed-facility-report?fid=110000000000',
    record_kind: 'facility' }],
};
const ZERO = { app_changes: [], communities: [], meetings: [], rpc_development: [], rpc_facility: [] };

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
    return { text: el ? el.textContent : '', html: el ? el.innerHTML : '', heads };
  });
  await page.close();
  return { errors, ...r };
}
const count = (hay, needle) => hay.split(needle).length - 1;
const ENV_HEAD = /environment\s*(&|&amp;|and)\s*utilit/i;
const ABSENCE = /no environment or utility/i;

for (const zip of ['01001', '01002']) {
  // ── ZERO ─────────────────────────────────────────────────────────────────────────────
  const z = await hydrate(zip, ZERO);
  ok(z.errors.length === 0, zip + ' ZERO — no uncaught page error', z.errors);
  // Positive control: the page actually composed its sections — without this the absence
  // checks below could pass on a page that never rendered at all.
  ok(z.heads.some(h => /^Government & civic/.test(h)) && z.heads.some(h => /^Local news/.test(h)),
    zip + ' ZERO — control: the section column rendered (Government & civic, Local news present)', z.heads);
  ok(!ABSENCE.test(z.text), zip + ' ZERO — A/B: the false Environment absence sentence is unreachable');
  ok(!z.heads.some(h => ENV_HEAD.test(h)), zip + ' ZERO — C: no Environment heading/group is drawn', z.heads);
  ok(!/environment[^<]{0,60}0 changes|0 changes[^<]{0,60}environment/i.test(z.text) && !ENV_HEAD.test(z.text),
    zip + ' ZERO — A: no Environment "0 changes" count anywhere on the page');

  // ── FULL ─────────────────────────────────────────────────────────────────────────────
  const f = await hydrate(zip, FULL);
  ok(f.errors.length === 0, zip + ' FULL — no uncaught page error', f.errors);
  ok(!f.heads.some(h => ENV_HEAD.test(h)) && !ENV_HEAD.test(f.text),
    zip + ' FULL — C/F: even with a row carrying the old category key, no Environment section is drawn', f.heads);
  ok(!ABSENCE.test(f.text), zip + ' FULL — B: no Environment absence sentence');
  ok(count(f.text, T.envRow) === 0,
    zip + ' FULL — F: the Environment-category row reaches NO section (no routing path, no fallback bucket)');
  // D: every neighbour renders its own record exactly once — none suppressed, none duplicated.
  ok(count(f.text, T.govWater) === 1, zip + ' FULL — D: the water-district notice renders once, under Government & civic', count(f.text, T.govWater));
  ok(count(f.text, T.news) >= 1 && f.heads.some(h => /^Local news — 1 item/.test(h)),
    zip + ' FULL — D: environmental Local News renders under Local news (1 item)', f.heads);
  ok(count(f.text, T.devUtil) === 1, zip + ' FULL — D: the utility-sounding project renders once, under Development', count(f.text, T.devUtil));
  // STATIC REGULATORY INVENTORY IS NOT A CHANGE (founder decision, 2026-09-25). The EPA facility
  // is served (rpc_facility) but renders in NO section of the "What's changing" feed — not its old
  // own section, and not relocated into Development & growth. The data plane is still read: the
  // summary strip's "Regulated facilities" tile counts it (component_scores is {} here, so the
  // tile falls back to facilities.length = 1), which is also what makes the zero non-vacuous.
  ok(count(f.text, T.facility) === 0 && !f.heads.some(h => /^Regulated facilities/.test(h)),
    zip + ' FULL — D: the EPA facility renders no card and no "Regulated facilities nearby" section', f.heads);
  ok(/<div class="n">1<\/div><div class="l">Regulated facilities<\/div>/.test(f.html),
    zip + ' FULL — D: the facility plane is still read — the summary tile counts it (1)');
  const dev = f.heads.find(h => /^Development & growth/.test(h)) || '';
  ok(/— 1 record\b/.test(dev), zip + ' FULL — D: Development counts only its own record, not the facility', dev);
  const order = f.heads.map(h => (h.match(/^(Development & growth|Government & civic|Local news)/) || [])[1]).filter(Boolean);
  ok(order.join(' | ') === 'Development & growth | Government & civic | Local news' && order.length === f.heads.length,
    zip + ' FULL — the feed is exactly Development & growth, Government & civic, Local news, in that order', f.heads);
  ok(count(f.text, T.meeting) === 1, zip + ' FULL — D: the water meeting renders once, in the Meetings card', count(f.text, T.meeting));
  const gov = f.heads.find(h => /^Government & civic/.test(h)) || '';
  ok(/1 notice\b/.test(gov), zip + ' FULL — D: Government & civic counts its notice (the Environment row is not a notice)', gov);
}

console.log('='.repeat(78));
console.log('FAILS: ' + fails);
console.log('='.repeat(78));
await browser.close();
server.close();
rmSync(out, { recursive: true, force: true });
process.exit(fails ? 1 : 0);
