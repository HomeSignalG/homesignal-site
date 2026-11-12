// MEETINGS LIST (header copied from community-card-links), LABEL THEIR KIND, AND NEVER OPEN RAW WEATHER DATA. Driven, not read.
// (founder, 2026-10-08). Hydrates the real generated /community/<zip>/ document with the shipped
// runtime against a table-aware stub, then reads and CLICKS what a resident would.
// Run: node test/community-card-links.browser.test.mjs
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
const out = mkdtempSync(join(tmpdir(), 'mtglist-'));
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



// THE CIVIC MEETINGS CARD LISTS EACH MEETING WITH ITS DATE, BADGE AND OWN LINK (2026-11-12).
// Before: one card named only the first two meetings (on 97149 both cancelled), no dates, one link,
// and claimed "development and environment items on the agendas". Rows are the real first eight
// upcoming Tillamook County OR meetings (public.meetings, 2026-11-12), stored date-only at 07:00Z.
const COMM = '00000000-0000-0000-0000-000000000001';
const MEETINGS = [{"id": "m2445", "title": "Community Update - CANCELLED", "meeting_date": "2026-11-17T07:00:00+00:00", "location": null, "category": "County Commission & county business", "source_url": "https://tillamookcoor.portal.civicclerk.com/event/2445/overview", "community_id": "00000000-0000-0000-0000-000000000001", "is_cancelled": true}, {"id": "m2512", "title": "Board Briefing - CANCELLED", "meeting_date": "2026-11-18T07:00:00+00:00", "location": null, "category": "County Commission & county business", "source_url": "https://tillamookcoor.portal.civicclerk.com/event/2512/overview", "community_id": "00000000-0000-0000-0000-000000000001", "is_cancelled": true}, {"id": "m2405", "title": "Board Meeting - CANCELLED", "meeting_date": "2026-11-18T07:00:00+00:00", "location": null, "category": "County Commission & county business", "source_url": "https://tillamookcoor.portal.civicclerk.com/event/2405/overview", "community_id": "00000000-0000-0000-0000-000000000001", "is_cancelled": true}, {"id": "m2562", "title": "Community Update", "meeting_date": "2026-11-24T07:00:00+00:00", "location": null, "category": "County Commission & county business", "source_url": "https://tillamookcoor.portal.civicclerk.com/event/2562/overview", "community_id": "00000000-0000-0000-0000-000000000001", "is_cancelled": false}, {"id": "m2721", "title": "Board Briefing", "meeting_date": "2026-11-25T07:00:00+00:00", "location": null, "category": "County Commission & county business", "source_url": "https://tillamookcoor.portal.civicclerk.com/event/2721/overview", "community_id": "00000000-0000-0000-0000-000000000001", "is_cancelled": false}, {"id": "m2668", "title": "Board Meeting", "meeting_date": "2026-11-25T07:00:00+00:00", "location": null, "category": "County Commission & county business", "source_url": "https://tillamookcoor.portal.civicclerk.com/event/2668/overview", "community_id": "00000000-0000-0000-0000-000000000001", "is_cancelled": false}, {"id": "m2563", "title": "Community Update", "meeting_date": "2026-12-01T07:00:00+00:00", "location": null, "category": "County Commission & county business", "source_url": "https://tillamookcoor.portal.civicclerk.com/event/2563/overview", "community_id": "00000000-0000-0000-0000-000000000001", "is_cancelled": false}, {"id": "m2722", "title": "Board Briefing", "meeting_date": "2026-12-02T07:00:00+00:00", "location": null, "category": "County Commission & county business", "source_url": "https://tillamookcoor.portal.civicclerk.com/event/2722/overview", "community_id": "00000000-0000-0000-0000-000000000001", "is_cancelled": false}];
const FULL = {
  app_changes: [],
  communities: [{ id: COMM, name: 'Fixture Town (__ZIP__)', parent_id: null, county: 'Hampden', state: 'MA', zip_codes: ['__ZIP__'], level: 'zip', government_topics: [] }],
  meetings: MEETINGS, rpc_development: [], rpc_facility: [],
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
for (const vp of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
  const ctx = await browser.newContext({ viewport: vp });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e).slice(0, 200)));
  await ctx.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.startsWith(base)) return route.continue();
    if (url.includes('/rest/v1/') || url.includes('/functions/v1/')) return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    if (url.includes('cdn.jsdelivr.net')) return route.fulfill({ status: 200, contentType: 'text/javascript', body: stubFor(FULL) });
    return route.fulfill({ status: 200, contentType: 'text/html', body: '<title>external</title>' });
  });
  await page.goto(base + '/community/01001/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => document.querySelector('#commPage .mtg-list'), null, { timeout: 30000 }).catch(() => {});
  const r = await page.evaluate(() => {
    const card = document.querySelector('#commPage [data-mtg-list]');
    if (!card) return null;
    const rows = [].slice.call(card.querySelectorAll('li.mtg-row')).map(li => ({
      text: li.textContent.replace(/\s+/g, ' ').trim(), href: (li.querySelector('a') || {}).href || null,
      badge: !!li.querySelector('.mtg-cancelled') }));
    return { tag: card.tagName, rows, text: card.textContent.replace(/\s+/g, ' '), head: (document.getElementById('commPage').textContent.match(/Government\s*&\s*civic\s*—\s*\d+ upcoming/) || [''])[0],
      overflow: document.documentElement.scrollWidth > innerWidth + 1 };
  });
  const L = vp.width + 'px: ';
  ok(errors.length === 0, L + 'no uncaught page error', errors);
  ok(r && r.tag === 'DIV', L + 'the card is a plain container, not one link to a single meeting', r && r.tag);
  ok(r && r.rows.length === 6, L + 'six meetings are listed', r && r.rows.length);
  ok(r && r.rows.every((x, i) => x.href === MEETINGS[i].source_url), L + 'each row links to its own county record, in date order', r && r.rows.map(x => x.href));
  ok(r && r.rows.every((x, i) => x.badge === MEETINGS[i].is_cancelled), L + 'exactly the cancelled meetings carry the Cancelled badge', r && r.rows.map(x => x.badge));
  ok(r && /Tue, Nov 17, 2026$/.test(r.rows[0].text) && /Wed, Nov 25, 2026$/.test(r.rows[5].text), L + 'each row shows its own date (the stored calendar date, not a day off)', r && r.rows.map(x => x.text));
  ok(r && /2 more upcoming meetings/.test(r.text), L + 'the meetings not listed are counted', r && r.text);
  ok(r && !/agenda/i.test(r.text), L + 'no claim about agenda items', r && r.text);
  ok(r && /— 8 upcoming/.test(r.head), L + 'the group head still counts every upcoming meeting', r && r.head);
  ok(r && !r.overflow, L + 'nothing overflows the page width');
  await ctx.close();
}
console.log('FAILS: ' + fails);
await browser.close();
server.close();
rmSync(out, { recursive: true, force: true });
process.exit(fails ? 1 : 0);
