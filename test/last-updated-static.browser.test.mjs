// "Last updated" on the STATIC ZIP-page and city-page cards, read as a visitor sees them
// (Chromium, JavaScript off, so the crawlable document is what is measured).
//   tracked project -> its day · paused project -> its frozen day · a card with no project page -> none
// Run: node test/last-updated-static.browser.test.mjs
import { chromium } from 'playwright';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIX = join(root, 'test', 'fixtures', 'city-pages');
let fails = 0;
const ok = (c, m, d) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + m); if (!c) { fails++; if (d !== undefined) console.log('   ' + JSON.stringify(d).slice(0, 300)); } };

const plane = JSON.parse(readFileSync(join(FIX, 'development_seo_plane.json'), 'utf8'));
const CASES = {}; const projects = {};
let n = 0;
const keyOf = (url) => `arcgis:town-permits:CASE-${url.split('/').pop()}|1`;
const add = (e, zips) => {
  const k = keyOf(e.source_url); e.key = k;
  projects[k] = { registry_id: 'town-permits', case: 'CASE-' + e.source_url.split('/').pop(), name: e.name, type: e.type, status: e.status,
    source_url: e.source_url, zips: [...new Set([...(projects[k] ? projects[k].zips : []), ...zips])].sort() };
};
for (const [z, rec] of Object.entries(plane.zips)) for (const e of rec.representative_entities || []) add(e, [z]);
for (const c of Object.values(plane.cities)) for (const e of c.representative_entities || []) add(e, [e.zip]);
const keys = Object.keys(projects).sort();
// k0 tracked (live day), k1 paused (frozen day), k2 has NO project page (removed from the plane's project list)
const TRACKED = '2026-09-20', FROZEN = '2026-08-02';
projects[keys[0]].verified_on = TRACKED; projects[keys[0]].as_of = '2026-11-26'; projects[keys[0]].tracked = true;   // as_of = plane run day, never shown
projects[keys[1]].verified_on = FROZEN; projects[keys[1]].as_of = '2026-11-26'; projects[keys[1]].tracked = false;
const noPageName = projects[keys[2]].name, trackedName = projects[keys[0]].name, frozenName = projects[keys[1]].name;
delete projects[keys[2]];

const { cities, ...zipPlane } = plane;
const dir = mkdtempSync(join(tmpdir(), 'lus-'));
const out = mkdtempSync(join(tmpdir(), 'lus-out-'));
writeFileSync(join(dir, 'zip-pages.json'), readFileSync(join(FIX, 'zip-pages.json')));
writeFileSync(join(dir, 'development_seo_plane.json'), JSON.stringify(zipPlane));
writeFileSync(join(dir, 'development_seo_cities.json'), JSON.stringify({ version: '1.0.0', identity: zipPlane.identity, generated_at: zipPlane.generated_at, cities }));
writeFileSync(join(dir, 'development_seo_projects.json'), JSON.stringify({ version: '1.0.0', identity: zipPlane.identity, generated_at: zipPlane.generated_at, scope: 'featured', projects }));
writeFileSync(join(out, 'sitemap.xml'), '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>\n');
const r = spawnSync('python3', [join(root, 'scripts', 'gen_zip_pages.py'), '--fixture', join(dir, 'zip-pages.json'), '--out', out, '--now', '2026-09-28T00:00:00'], { encoding: 'utf8' });
ok(r.status === 0, 'the build succeeds', (r.stderr || '').slice(-200));

const MIME = { '.html': 'text/html', '.json': 'application/json', '.css': 'text/css', '.js': 'text/javascript' };
const srv = createServer((q, s) => { const p = decodeURIComponent(q.url.split('?')[0]);
  for (const f of [p.endsWith('/') ? join(out, p, 'index.html') : join(out, p), join(root, p)]) { let body; try { body = readFileSync(f); } catch { continue; } s.writeHead(200, { 'content-type': MIME[extname(f)] || 'text/plain' }).end(body); return; }
  s.writeHead(404).end('x'); });
await new Promise((res) => srv.listen(0, '127.0.0.1', res));
const base = 'http://127.0.0.1:' + srv.address().port;
const browser = await chromium.launch();
const ctx = await browser.newContext({ javaScriptEnabled: false });
const visible = async (path) => { const pg = await ctx.newPage(); await pg.goto(base + path, { waitUntil: 'domcontentloaded' });
  const t = await pg.evaluate(() => document.body.innerText.replace(/\s+/g, ' ')); const lis = await pg.evaluate(() => Array.from(document.querySelectorAll('main li')).map((l) => l.innerText.replace(/\s+/g, ' ')));
  await pg.close(); return { t, lis }; };
const rowFor = (lis, name) => lis.find((x) => x.includes(name.slice(0, 20))) || null;

const zipPaths = Object.entries(plane.zips).filter(([, z]) => (z.representative_entities || []).length).map(([z]) => '/community/' + z + '/');
let seenT = false, seenF = false, seenN = false;
for (const path of zipPaths) {
  const { t, lis } = await visible(path);
  const a = rowFor(lis, trackedName), b = rowFor(lis, frozenName), c = rowFor(lis, noPageName);
  if (a) { seenT = true; ok(a.includes('Last updated: Sep 20, 2026'), `ZIP card (${path}), tracked project: Last updated: Sep 20, 2026`, a); }
  if (b) { seenF = true; ok(b.includes('Last updated: Aug 2, 2026'), `ZIP card (${path}), paused project: its frozen day, Aug 2, 2026`, b); }
  if (c) { seenN = true; ok(!/Last updated/.test(c), `ZIP card (${path}), no project page: no date`, c); }
  ok(!/last seen|no longer track|not tracked|status as of/i.test(t), `${path}: no tracked/untracked wording`);
}
ok(seenT && seenF && seenN, 'every case (tracked, paused, no page) was actually found on a ZIP page', { seenT, seenF, seenN });

const cityDirs = []; for (const st of readdirSync(join(out, 'city'))) for (const c of readdirSync(join(out, 'city', st))) cityDirs.push(`/city/${st}/${c}/`);
let cT = false, cF = false, cN = false;
for (const path of cityDirs) {
  const { t, lis } = await visible(path);
  const a = rowFor(lis, trackedName), b = rowFor(lis, frozenName), c = rowFor(lis, noPageName);
  if (a) { cT = true; ok(a.includes('Last updated: Sep 20, 2026'), `city card (${path}), tracked: Sep 20, 2026`, a); }
  if (b) { cF = true; ok(b.includes('Last updated: Aug 2, 2026'), `city card (${path}), paused: Aug 2, 2026`, b); }
  if (c) { cN = true; ok(!/Last updated/.test(c), `city card (${path}), no project page: no date`, c); }
  ok(!/last seen|no longer track|not tracked|status as of/i.test(t), `${path}: no tracked/untracked wording`);
}
ok(cT || cF || cN, 'at least one city page card was checked', { cT, cF, cN });
await browser.close(); srv.close(); rmSync(dir, { recursive: true, force: true }); rmSync(out, { recursive: true, force: true });
console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);
