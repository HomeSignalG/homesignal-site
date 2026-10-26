// The ZIP-less Development Map landing page (/homesignalmap.html) is INDEX-ELIGIBLE FROM ITS FIRST BYTE
// (founder, 2026-10-26), and nothing else about indexing moved.
//
// WHY: the source used to ship `noindex, nofollow` and let JavaScript promote it. Google does not render a
// page whose initial robots says noindex, so a script could never have promoted it. The default is now
// `index, follow`, and every state that is not the landing page (ZIP, street address, lat/lng point, embed,
// property record) is forced back to noindex, in the head before paint and again in the runtime.
//
// This suite tests the BUILT JODY ARTIFACT, not the HomeSignal-branded source: stage_site.py, then
// gen_zip_pages.py (fixture data), then brand_stage.py --identity jody (the launch overlay, no --staging).
// This file reads the artifact's files (offline). test/map-landing-seo.browser.test.mjs drives the same artifact in Chromium.
// Run: node test/map-landing-seo.test.mjs
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { buildJodyArtifact, ORIGIN, LANDING, robotsOf, canonOf } from './lib/jody-artifact.mjs';

let fails = 0;
const ok = (c, name, extra) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name + (extra !== undefined && !c ? '  [' + extra + ']' : ''));
  if (!c) fails++;
};
const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });

const out = buildJodyArtifact();

const withoutTemplate = (h) => h.replace(/<template\b[\s\S]*?<\/template>/gi, '');

// ── A. the artifact's files ────────────────────────────────────────────────────────────────────────────
const L = readFileSync(join(out, 'homesignalmap.html'), 'utf8');
ok(JSON.stringify(robotsOf(L)) === JSON.stringify(['index, follow']), 'A1 landing: exactly one robots meta, and it is "index, follow"', robotsOf(L));
ok(!/noindex/i.test(L.slice(0, L.indexOf('</head>')).replace(/<script>[\s\S]*?<\/script>/g, '').replace(/<!--[\s\S]*?-->/g, '')),
  'A2 landing: no noindex anywhere in the head markup (the only noindex string is inside the guard script)');
ok(JSON.stringify(canonOf(L)) === JSON.stringify([LANDING]), 'A3 landing: one canonical, self-referencing on the Jody origin', canonOf(L));
ok(L.includes(`<meta property="og:url" content="${LANDING}"/>`), 'A4 landing: og:url equals the canonical');
ok(!/https:\/\/(?:www\.)?homesignal\.net/.test(L), 'A5 landing: no old-origin URL is left in the built page');
ok(/<title>Jody Development Map/.test(L), 'A6 landing: unique, branded title', (L.match(/<title>[^<]*/) || [''])[0]);
const desc = (L.match(/<meta name="description" content="([^"]*)"/) || [])[1] || '';
ok(desc.length >= 80 && desc.length <= 200 && /Development Map/.test(desc), 'A7 landing: a real meta description', desc);
const guard = L.indexOf('hs-map-state');
ok(guard > 0 && guard < L.indexOf('<script src='), 'A8 the head guard runs before any external script and before the runtime');
ok(L.indexOf('id="robots-meta"') < guard, 'A9 the robots meta exists before the guard that edits it');

const crawlable = withoutTemplate(L);
const about = (crawlable.match(/<section class="hs-map-about"[\s\S]*?<\/section>/) || [''])[0];
const words = about.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
ok(about.length > 0 && words >= 180, 'A10 landing: useful crawlable copy sits OUTSIDE the <template> (the initial HTML carries it)', words);
ok(/About the Jody Development Map/.test(about), 'A11 the copy is branded for the Jody artifact');
for (const href of ['/map/98335/', '/guides/what-is-being-built-near-me/', '/guides/check-proposed-development-near-a-house/', '/how-it-works.html']) {
  ok(about.includes(`href="${href}"`), `A12 crawlable link in the copy: ${href}`);
}
ok(!/<h1\b/i.test(about), 'A13 the copy adds no second <h1> (the page keeps its own)');

const sm = readFileSync(join(out, 'sitemap.xml'), 'utf8');
ok((sm.match(new RegExp(`<loc>${LANDING.replace(/[.]/g, '\\.')}</loc>`, 'g')) || []).length === 1, 'A14 sitemap.xml lists the landing page exactly once');
const allSitemaps = [join(out, 'sitemap.xml'), ...walk(join(out, 'sitemaps')).filter((f) => f.endsWith('.xml'))];
ok(allSitemaps.every((f) => !/homesignalmap\.html\?/.test(readFileSync(f, 'utf8'))), 'A15 no sitemap advertises a homesignalmap.html?… URL (zip, addr, embed)', allSitemaps.length);
ok(!/\/homesignalmap\.html/.test(allSitemaps.filter((f) => f !== join(out, 'sitemap.xml')).map((f) => readFileSync(f, 'utf8')).join('')),
  'A16 the landing page is advertised once, in sitemap.xml, not duplicated into a family sitemap');
const robotsTxt = readFileSync(join(out, 'robots.txt'), 'utf8');
ok(!/^Disallow:\s*\/(?:homesignalmap\.html|map\/?)\s*$/m.test(robotsTxt) && !/^Disallow:\s*\/\s*$/m.test(robotsTxt), 'A17 robots.txt does not block the landing page or /map/');

// per-ZIP documents: unchanged rules, no landing copy, one self-canonical each, none duplicates another
const mapDocs = walk(join(out, 'map')).filter((f) => f.endsWith('index.html'));
ok(mapDocs.length > 3, 'A18 control: the fixture build wrote /map/<zip>/ documents', mapDocs.length);
let idxMaps = 0;
for (const f of mapDocs) {
  const z = f.match(/map\/(\d{5})\/index\.html$/)[1];
  const h = readFileSync(f, 'utf8');
  const r = robotsOf(h), c = canonOf(h);
  const bad = [];
  if (r.length !== 1) bad.push('robots count ' + r.length);
  if (c.length !== 1) bad.push('canonical count ' + c.length);
  if (/hs-map-about/.test(h)) bad.push('carries the landing copy');
  if (!/<title>[^<]*<\/title>\n<meta name="robots"/.test(h)) bad.push('robots no longer follows the title (page fingerprint order)');
  const idx = r[0] === 'index, follow';
  if (idx) { idxMaps++; if (c[0] !== `${ORIGIN}/map/${z}/`) bad.push('indexable but not self-canonical: ' + c[0]); }
  else if (c[0] === LANDING) bad.push('canonicalises to the landing page');
  ok(bad.length === 0, `A19 /map/${z}/ keeps its own robots + canonical (${r[0]})`, bad.join('; '));
}
ok(idxMaps > 0 && idxMaps < mapDocs.length, 'A20 control: the fixture has both indexable and noindex map pages (the evidence rules still discriminate)', `${idxMaps}/${mapDocs.length}`);

// no duplicate canonicals among everything a crawler may index, and the landing page is not anyone's canonical target
const seen = new Map();
for (const f of walk(out).filter((p) => p.endsWith('.html'))) {
  const h = readFileSync(f, 'utf8');
  if (robotsOf(h)[0] !== 'index, follow') continue;
  const c = canonOf(h)[0];
  if (!c) continue;
  seen.set(c, (seen.get(c) || []).concat(f.slice(out.length)));
}
const dup = [...seen].filter(([, v]) => v.length > 1);
ok(dup.length === 0, 'A21 no two indexable documents share a canonical URL', JSON.stringify(dup.slice(0, 3)));
ok((seen.get(LANDING) || []).length === 1 && seen.get(LANDING)[0] === '/homesignalmap.html', 'A22 exactly one indexable document canonicalises to the landing URL: the landing page itself', JSON.stringify(seen.get(LANDING)));

// mass-indexing guard: the ONLY static document that changed robots is the landing page; the other static pages keep theirs
const generated = /^\/(community|city|project|guides|map|map1)\//;
const staticIndexable = [...seen.values()].flat().filter((p) => !generated.test(p)).sort();
ok(staticIndexable.includes('/homesignalmap.html'), 'A23 control: the landing page is among the indexable static documents', staticIndexable.length);
for (const p of ['/property.html', '/development.html', '/alerts.html', '/dashboard.html', '/community.html', '/maps.html', '/follow-embed.html']) {
  ok(!staticIndexable.includes(p), `A24 ${p} stays out of the index`);
}

console.log(fails ? `\n${fails} FAILED` : '\nAll map landing SEO file assertions passed.');
process.exit(fails ? 1 : 0);
