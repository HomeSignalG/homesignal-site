// Map 1 per ZIP at /map/<zip>/ (founder: 2026-10-21 short address, 2026-10-22 "go": a real page search
// engines can list). homesignalmap.html stays the ONE source; scripts/gen_zip_pages.py::MapTemplate
// renders one small document per ZIP and moves the page's style and runtime into content-addressed
// files under /map1/. This pins: the extracted runtime and style are byte-identical to the inline
// ones, each document carries its own title / canonical / robots, the sitemap and the page-state
// list exactly the indexable map pages, and the build gates count them.
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync, copyFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; };

function py(code, ...args) {
  const r = spawnSync('python3', ['-I', '-c', 'import sys, json; sys.path.insert(0,"scripts"); import gen_zip_pages as g\n' + code, ...args],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return r;
}
const R = py(`t = g.MapTemplate()
out = {"css_name": t.css_name, "js_name": t.js_name, "css": t.css, "js": t.js, "base": g.BASE,
  "plain": t.render({"zip": "06704", "name": "Waterbury (06704)", "state": "CT", "dev_indexable": False}),
  "idx": t.render({"zip": "06704", "name": "Waterbury (06704)", "state": "CT", "dev_indexable": True}),
  "cov": t.render({"zip": "06704", "name": "Waterbury (06704)", "state": "CT", "dev_indexable": True,
                   "coverage": {"mode": "specialized_zip"}})}
sys.stdout.write(json.dumps(out))`);
assert.equal(R.status, 0, R.stderr);
const T = JSON.parse(R.stdout);
const SRC = readFileSync('homesignalmap.html', 'utf8');

// 1. ONE source: the runtime and style are the inline ones, byte for byte, and the names are their hashes
const inlineJs = SRC.slice(SRC.lastIndexOf('\n<script>\n') + '\n<script>\n'.length, SRC.indexOf('\n</script>\n</body>') + 1);
const inlineCss = SRC.slice(SRC.indexOf('<style>\n') + '<style>\n'.length, SRC.indexOf('</style>\n</head>'));
ok(T.js === inlineJs && T.js.length > 100000, 'runtime file == the inline page runtime');
ok(T.css === inlineCss && T.css.length > 10000, 'style file == the inline page style');
ok(/HS\.onReady/.test(T.js), 'the runtime is the page runtime (HS.onReady)');
const { createHash } = await import('node:crypto');
ok(T.js_name === `page.${createHash('sha256').update(T.js).digest('hex').slice(0, 8)}.js`, 'js name is its content hash');
ok(T.css_name === `page.${createHash('sha256').update(T.css).digest('hex').slice(0, 8)}.css`, 'css name is its content hash');

// 2. the per-ZIP document: small, no inline runtime, no comments, loads the shared files in the same place
for (const d of [T.plain, T.idx, T.cov]) {
  ok(d.length < 20000, `document is small (${d.length} bytes)`);
  ok(!/HS\.onReady/.test(d), 'no inline runtime');
  ok(!/<!--/.test(d), 'no HTML comments');
  ok(d.includes(`<script src="/map1/${T.js_name}"></script>`), 'loads the shared runtime');
  ok(d.includes(`<link rel="stylesheet" href="/map1/${T.css_name}">`), 'loads the shared style');
  ok(d.indexOf(`/map1/${T.js_name}`) > d.indexOf('leaflet@1.9.4/dist/leaflet.js'), 'runtime still runs after Leaflet');
  ok(d.indexOf(`/map1/${T.css_name}`) > d.indexOf('app.css?v='), 'style still after app.css');
  ok((d.match(/<link rel="canonical"/g) || []).length === 1, 'one canonical');
  ok((d.match(/<meta name="robots"/g) || []).length === 1, 'one robots meta');
  ok(d.includes('id="robots-meta"'), 'the runtime can still flip robots');
  ok(d.includes('<base href="/"/>'), 'relative URLs still resolve from the site root');
}
ok(T.plain.includes('<title>Development around Waterbury (06704) — HomeSignal</title>'), 'title = the one the runtime sets');
ok(T.plain.includes(`<link rel="canonical" href="${T.base}/map/06704/"/>`), 'self-canonical');
ok(T.plain.includes(`<meta property="og:url" content="${T.base}/map/06704/"/>`), 'og:url');
ok(T.plain.includes('content="noindex, nofollow" id="robots-meta"'), 'not indexable -> noindex');
ok(T.idx.includes('content="index, follow" id="robots-meta"'), 'indexable -> index');
ok(T.cov.includes('content="noindex, nofollow" id="robots-meta"'), 'coverage-limited ZIP -> noindex');
ok(T.cov.includes(`<link rel="canonical" href="${T.base}/community/06704/"/>`), 'coverage-limited ZIP -> canonical to its document');
ok(/<meta name="description" content="Development records, permits and regulated facilities on file for ZIP 06704 \(Waterbury \(06704\), CT\)/.test(T.plain), 'ZIP description');
ok(!T.plain.includes('homesignalmap.html"/>'), 'no ZIP-less canonical left');
{
  // Every user-facing page is a ZIP page: the static bytes a crawler reads first must not carry the
  // Box Elder pilot's county copy, and must name this ZIP and link to its community document.
  const text = T.plain.replace(/<script[\s\S]*?<\/script>/g, '');
  ok(!/Box Elder/.test(text), 'static HTML carries no Box Elder county copy');
  ok(text.includes('<h1>Development around Waterbury (06704)</h1>'), 'static H1 names the ZIP place');
  ok(text.includes('<a href="/community/06704/">'), 'static link to the ZIP community page');
}
ok(T.plain.includes(`<meta property="og:image" content="${T.base}/og-default.png"/>`), 'og:image follows the site origin');
ok(T.plain.includes(`<meta name="twitter:image" content="${T.base}/og-default.png"/>`), 'twitter:image follows the site origin');
ok(T.base === 'https://homesignal.net' || !T.plain.includes('https://homesignal.net'), 'no old-host URL left when the origin moved');

// 3. the runtime reads the ZIP from the path: HS.urlZip accepts /map/<zip>/
const shell = readFileSync('shell.js', 'utf8');
const re = new RegExp(shell.match(/HS\.MAP_ROUTE_RE = (\/.*?\/);/)[1].slice(1, -1));
ok(re.test('/map/06704/') && re.test('/map/06704'), 'HS.MAP_ROUTE_RE matches /map/<zip>/');

// 4. a non-ZIP is refused; a template whose head moved fails the build
ok(py('g.MapTemplate().render({"zip": "../x"})').status !== 0, 'non-ZIP refused');
const tmp = mkdtempSync(join(tmpdir(), 'map-tpl-'));
const moved = join(tmp, 'm.html');
(await import('node:fs')).writeFileSync(moved, SRC.replace('<link rel="canonical" href="https://homesignal.net/homesignalmap.html"/>', ''));
ok(py('g.MapTemplate(sys.argv[1])', moved).status !== 0, 'a template with no canonical to replace is refused');

// 5. the build: one page per community document, sitemap + family sitemap + page-state carry the indexable ones
const out = mkdtempSync(join(tmpdir(), 'map-build-'));
copyFileSync('sitemap.xml', join(out, 'sitemap.xml'));
execFileSync('python3', ['scripts/gen_zip_pages.py', '--fixture', 'test/fixtures/zip-pages.json', '--out', out,
  '--now', '2026-09-28T00:00:00'], { stdio: 'pipe' });
const zips = readdirSync(join(out, 'community')).sort();
ok(JSON.stringify(readdirSync(join(out, 'map')).sort()) === JSON.stringify(zips), 'one /map/<zip>/ per community document');
ok(JSON.stringify(readdirSync(join(out, 'map1')).sort()) === JSON.stringify([T.css_name, T.js_name].sort()), 'exactly the two shared files');
const idx = zips.filter((z) => /content="index, follow" id="robots-meta"/.test(readFileSync(join(out, 'map', z, 'index.html'), 'utf8')));
ok(idx.length > 0 && idx.length < zips.length, `fixture has both indexable (${idx.length}) and noindex map pages`);
const sm = readFileSync(join(out, 'sitemap.xml'), 'utf8');
const smMaps = [...sm.matchAll(/<loc>[^<]*\/map\/(\d{5})\/<\/loc>/g)].map((m) => m[1]).sort();
ok(JSON.stringify(smMaps) === JSON.stringify(idx), 'sitemap lists exactly the indexable map pages');
ok(!/homesignalmap\.html\?zip=/.test(sm), 'no homesignalmap.html?zip= URL in the sitemap');
const fam = readFileSync(join(out, 'sitemaps', 'map.xml'), 'utf8');
ok([...fam.matchAll(/<loc>[^<]*\/map\/(\d{5})\/<\/loc>/g)].length === idx.length, 'family sitemap map.xml');
const st = JSON.parse(readFileSync(join(out, 'sitemaps', 'page-state.json'), 'utf8'));
const stMaps = Object.keys(st.pages).filter((p) => p.startsWith('/map/'));
ok(stMaps.length === zips.length, 'every map page is in the page state');
ok(stMaps.filter((p) => st.pages[p].i === 1).length === idx.length, 'page state indexability == robots');
ok(existsSync(join(out, 'map1', T.js_name)), 'runtime written');

// 6. wiring
const gen = readFileSync('scripts/gen_zip_pages.py', 'utf8');
ok(/nmap, map_bytes, map_indexable = build_map_pages\(pages, a\.out, state\)/.test(gen), 'build writes the map pages');
ok(/if nmap != stats\["documents"\]:/.test(gen), 'count checked against documents');
ok(/stats\["bytes"\] \+ proj_bytes \+ map_bytes > 900/.test(gen), 'map bytes count toward the artifact budget');
ok(!/def render_map_route/.test(gen), 'the forward-only document is gone');
const wf = readFileSync('.github/workflows/pages.yml', 'utf8');
ok(/p\.startswith\('map\/'\) or p\.startswith\('map1\/'\)/.test(wf), 'artifact audit allows map/ and map1/');
ok(/test "\$MAPS" -eq "\$DOCS"/.test(wf), 'pages gate counts map pages');
ok(/ls _site\/map1 \| wc -l\)" -eq 2/.test(wf), 'pages gate: exactly two shared files');

// 7. 404.html still forwards a /map/<zip> that has no document
function run(src, path, search, hash) {
  let went = null;
  const location = { pathname: path, search, hash, replace: (u) => { went = u; } };
  vm.runInNewContext(src, { location, window: { location } });
  return went;
}
const nf = readFileSync('404.html', 'utf8');
const nfScript = nf.match(/<script>([\s\S]*?)<\/script>/)[1];
ok(run(nfScript, '/map/84684', '?utm_source=bluesky', '') === '/homesignalmap.html?zip=84684&utm_source=bluesky', '404 map route');
ok(run(nfScript, '/development/84302', '', '') === '/homesignalmap.html?zip=84302', '404 development route unchanged');

console.log(`map-short-route: ${pass} checks passed`);
