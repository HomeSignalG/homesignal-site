// PCM-1 — THE ADDRESS CONTEXT MAP IS AN ORIENTATION LAYER, AND THE WAYS IT COULD STOP BEING ONE
// Run: node test/place-context-map.test.mjs
//
// Three of these pins exist because the SAME mistake was already made once, on the branch this
// contract replaced (#1141, closed 2026-09-10): it labelled the widget Map 1, took the
// Dashboard's 1.5 mi ring, fitted a bbox of project points instead of a ZIP polygon, and put
// map code on the public ZIP document with no auth gate. Every one of those passed CI, because
// nothing asserted the difference between an orientation map and an investigation map.
//
// §7 and §8 are the ones with no other guard: they pin what PCM-1 must NOT have started.
let fails = 0;
const ok = (c, name, eviq) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name + (c || eviq === undefined ? '' : '\n        ' + eviq));
  if (!c) fails++;
};

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
// Comments describe the contract and quote the things it forbids, so a string pin that swept
// them would fire on its own explanation. Strip them before matching, everywhere.
const code = (s) => s.replace(/^\s*\/\/.*$/gm, '').replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

const propRaw = read('property.html');
const prop = code(propRaw);
const mapJs = read('lib/map.js');

// ── §1 the libraries, and the one that is deliberately absent ───────────────────────────
const sha8 = (rel) => createHash('sha256').update(readFileSync(join(root, rel))).digest('hex').slice(0, 8);
ok(prop.includes('src="lib/map.js?v=' + sha8('lib/map.js') + '"'),
  '1a property.html loads lib/map.js at its CURRENT content hash');
ok(/src="lib\/n5-radius\.js\?v=/.test(prop), '1b ...and lib/n5-radius.js, which owns the address-mode site shape');
ok(/src="lib\/residential-qualify\.js\?v=/.test(prop),
  '1c ...and lib/residential-qualify.js — n5-radius calls Rule 5 through HS.residentialGateDrops, '
  + 'so omitting it would let routine residential work onto a new surface');
ok(!/maplibre-gl/.test(prop),
  '1d maplibre-gl is NOT loaded here — it is eager and ~200 KB gz on dashboard.html; buildLive '
  + 'falls through to lazy Leaflet when window.maplibregl is absent',
  (propRaw.match(/.{0,60}maplibre.{0,60}/) || [])[0]);

// ── §2 placement: after the identity header, before the intelligence content ────────────
const phEnd = prop.indexOf('everything changing around this specific address');
const block = prop.indexOf("+ contextMap");
const cols  = prop.indexOf(`'<div class="cols"><div>'`);
ok(phEnd > 0 && block > phEnd, '2a the map block comes AFTER the address identity/description');
ok(block > 0 && cols > block, '2b ...and BEFORE "What\'s changing near this property"');
ok(/id="propMap"/.test(prop) && /id="propContext"/.test(prop), '2c the block and its map container exist');

// ── §3 the radius: allowlist-asserted, and never the Dashboard's decorative ring ────────
ok(/var PCM_RADIUS_MI\s*=\s*2;/.test(prop), '3a the radius is the founder-set 2');
ok(/HS\.N5_RADII\.indexOf\(PCM_RADIUS_MI\)\s*<\s*0\)\s*return null;/.test(prop),
  '3b ...ASSERTED against the RPC allowlist, not trusted — an off-allowlist value raises 22023, '
  + 'which would render as "nothing near this home"');
ok(/radiusMi:\s*PCM_RADIUS_MI/.test(prop),
  '3c the drawn ring is the SAME constant as the queried radius, so the picture cannot disagree with the query');
ok(!/1\.5/.test(prop),
  '3d 1.5 appears nowhere on this page — it is not in the allowlist and is what buildLive\'s '
  + 'schematic path falls back to as `o.radiusMi || 1.5`', (prop.match(/.{0,50}1\.5.{0,50}/) || [])[0]);

// ── §4 nearby data is the radius RPC, never the ZIP read ────────────────────────────────
ok(/HS\.sb\(\)\.rpc\('n5_projects_within_radius'/.test(prop), '4a nearby data comes from n5_projects_within_radius');
ok(/items:\s*sites/.test(prop) && /sites\s*=\s*HS\.n5SitesFrom\(/.test(prop),
  '4b ...and the MAP ITEMS are built from it — not from HS.data.projects, whose set is every '
  + 'development record in the ZIP (app_projects_for_zip), i.e. ZIP membership, not proximity');
ok(!/items:\s*projects/.test(prop), '4c the ZIP-scoped projects array is never handed to the map');

// ── §5 anti-fabrication: every drawn marker traces to an official record ────────────────
ok(/\.filter\(function \(s\) \{ return !!s\.record_url; \}\)/.test(prop),
  '5a a site with no record_url is dropped before it can be drawn — HS.buildLive has no such gate');
ok(/if \(r\.error \|\| !Array\.isArray\(r\.data\)\) return null;/.test(prop),
  '5b a FAILED read returns null, never [] — "could not read" and "nothing is there" are different claims');
ok(/rows === null/.test(prop), '5c ...and the rendered note tells those two apart');
ok(/HS\.n5CoverageNote\(/.test(prop),
  '5d completeness uses the SHIPPED sentence, which already separates truncation from emptiness');

// ── §5b the home PIN is a claim about a real resident, and a demo persona is not one ────
ok(/var realAddress = !home\.sample && !home\.demo;/.test(prop),
  '5e the home marker is gated on the demo-exclusion predicate');
ok(/home:\s*realAddress \? home : null/.test(prop),
  '5f ...and a sample/demo Address is handed NO home pin — buildLive draws one only for o.home');
ok(!/HS\.isRealHome/.test(prop),
  '5g ...and NOT via HS.isRealHome, whose label/tag clause would also suppress the pin on a '
  + 'genuine saved Address carrying a different label',
  (prop.match(/.{0,60}isRealHome.{0,60}/) || [])[0]);
ok(/center: \{ lat: home\.lat, lng: home\.lng \}/.test(prop),
  '5h ...while the map still CENTERS on the Address either way — the page\'s subject is unchanged');

// ── §6 the handoff: the only Development deep link that exists today ────────────────────
ok(/HS\.navHref\('homesignalmap\.html', p\.zip\)/.test(prop),
  '6a the handoff carries the ADDRESS\'s ZIP');
ok(!/data-znav/.test(prop),
  '6b ...and carries NO data-znav, which would let the shell re-stamp it with the app\'s ACTIVE zip',
  (prop.match(/.{0,60}data-znav.{0,60}/) || [])[0]);
ok(!/[?&]addr=/.test(prop),
  '6c no ?addr= deep link was invented — that is the property_reports dossier, not address mode, '
  + 'and an address-mode parameter would mean touching Map 1');

// ── §7 PCM-2 IS BUILT, and PCM-1 still does not use it ─────────────────────────────────
// These pins were the inverse until PCM-2 landed ("the boundary primitive does not exist
// yet"). They now assert the primitive EXISTS — and, just as load-bearing, that the ADDRESS
// map does not reach for it. An Address is point-centered context; a polygon fit there would
// be the wrong contract on the right page.
ok(/HS\.boundaryFC = function/.test(mapJs) && /HS\.boundaryBounds = function/.test(mapJs),
  '7a lib/map.js exposes the boundary helpers');
ok(/o\.boundary \? HS\.boundaryFC\(o\.boundary\) : null/.test(mapJs) && /const fitB = !!o\.fitBoundary;/.test(mapJs),
  '7b ...and buildLive reads both additive options');
ok(/m\.fitBounds\(\[\[bBounds\.south, bBounds\.west\]/.test(mapJs),
  '7c Leaflet fits as [[south,west],[north,east]]');
ok(/map\.fitBounds\(\[\[bBounds\.west, bBounds\.south\]/.test(mapJs),
  '7d ...and MapLibre as [[west,south],[east,north]] — the opposite order, in ONE place');
ok(/if \(bFC \|\| fitB\) \{ refuse\('boundary-needs-tiles'\); return; \}/.test(mapJs),
  '7e the schematic REFUSES a boundary view instead of degrading to point+radius');
ok(/if \(fitB && !bBounds\) \{ refuse\('fitBoundary-without-boundary'\); return; \}/.test(mapJs),
  '7f ...and fitBoundary with no usable polygon is refused in every engine');
ok(!/fitItems/.test(prop) && !/fitItems/.test(mapJs),
  '7g still no fitItems — a bbox of project points is not a polygon fit (the #1141 shape)');
ok(!/\bboundary:/.test(prop) && !/fitBoundary/.test(prop),
  '7h PCM-1 does NOT use the boundary options — the Address map is point-centered context',
  (prop.match(/.{0,50}(boundary|fitBoundary).{0,50}/) || [])[0]);

// ── §8 PCM-4 IS BUILT — the authenticated ZIP context map ──────────────────────────────
// INVERTED. These said "the ZIP context map is PCM-4" and asserted its absence. They now
// assert it exists AND that it is authenticated-only — which is the half that matters,
// because the same file renders the protected public document.
const cp8raw = read('lib/community-page.js');
const cp8 = code(cp8raw);
for (const f of ['community.html', 'scripts/gen_zip_pages.py']) {
  const z = read(f);
  ok(/lib\/map\.js\?v=/.test(z), '8a ' + f + ' loads lib/map.js');
  ok(z.includes('lib/map.js?v=' + sha8('lib/map.js')),
    '8b ' + f + ' ...at the SAME content hash the other hosts carry, not a fourth key');
  ok(/server\.arcgisonline\.com/.test(z) && /style-src[^;]*cdn\.jsdelivr\.net/.test(z),
    '8c ' + f + ' CSP carries the Esri tile host and jsDelivr for Leaflet\'s stylesheet — '
    + 'a disclosed public-byte change on the PS-001 surface');
  // Scoped to a real tag, not the bare word: both hosts' comments SAY maplibre-gl is not
  // loaded, so a substring pin would fire on its own explanation.
  ok(!/(src|href)=["'][^"']*maplibre-gl/.test(z),
    '8d ' + f + ' does NOT load maplibre-gl — Leaflet is lazily injected by buildLive',
    (z.match(/.{0,40}(src|href)=["'][^"']*maplibre-gl.{0,20}/) || [])[0]);
}
ok(/HS\.buildLive\(el, \{/.test(cp8) && /boundary: geom/.test(cp8) && /fitBoundary: true/.test(cp8),
  '8e the shared ZIP runtime draws the polygon and FITS to it');
ok(/HS\.sb\(\)\.rpc\('app_zcta_boundary'/.test(cp8),
  '8f ...reading it through the SECURITY DEFINER function, never geo.zcta_boundary directly');
// THE GATE IS THE LOAD-BEARING PIN. Same shape as authedZipHealth: this file renders the
// protected public document, and an ungated map would both change anonymous PS-001 output
// and call an RPC that anon has no EXECUTE for — a guaranteed console error on the public page.
ok(/var zipContextMap = \(sess && !sess\.demo\)/.test(cp8),
  '8g the block is gated on (sess && !sess.demo) — the A-022 posture');
ok(/if \(zipContextMap\) paintZipBoundary\(zip\);/.test(cp8),
  '8h ...and the RPC is only ever called when that gate rendered the block');
ok(/var authedZipHealth = \(sess && !sess\.demo\)/.test(cp8),
  '8i ...the same gate ZIP health already uses, from one `var sess` (FM-081 unaffected)');
// NOT an Address map, NOT a project map, NOT investigation.
for (const [re, what] of [
  [/radiusMi/, 'a radius ring'],
  [/fitItems/, 'a bbox of project points (the #1141 shape)'],
  [/n5_projects_within_radius/, 'the Address-mode radius RPC'],
  [/ST_Buffer|ST_MakeEnvelope/, 'a substituted shape'],
  [/items: projects|items: topProjects/, 'every project in the ZIP plotted as pins'],
]) ok(!re.test(cp8), '8j the ZIP map has no ' + what, (cp8raw.match(re) || [])[0]);
ok(/items: \[\]/.test(cp8), '8k ...it passes items: [] — the geography IS the subject');
// A missing polygon is an honest state, never a drawn stand-in.
ok(/payload\.status === 'not_measured'/.test(cp8) && /data-hs-map-refused/.test(cp8),
  '8l not_measured is told apart from a failed read, and neither draws anything');
ok(!/<a[^>]*homesignalmap/.test(cp8.slice(cp8.indexOf('zipContextMap'), cp8.indexOf('paintZipBoundary'))),
  '8m the block adds NO second Development link — the header control is the handoff');
// A CAPTION IS A CLAIM, AND ONLY THE PATH THAT DREW MAY MAKE IT. Measured in the sandbox
// (jsDelivr unreachable, so buildLive refuses `boundary-needs-tiles`): a caption set straight
// after the call left an EMPTY box reading "The whole of ZIP 84302, from the U.S. Census ZCTA
// boundary." onReady fires on Leaflet and MapLibre only, never schematic — so routing the
// success sentence through it makes the two outcomes mutually exclusive by construction.
const cap = /from the U\.S\. Census ZCTA boundary/;
ok(cap.test(cp8), '8n the drawn state has a caption naming the publisher');
const onReadyBody = (cp8.match(/onReady: function \(\)[\s\S]{0,400}?\n      \}/) || [''])[0];
ok(cap.test(onReadyBody),
  '8o ...set INSIDE onReady, so a refused engine can never assert a drawn boundary');
ok(/onRefuse: function/.test(cp8) && /but the map couldn/.test(cp8),
  '8p ...and onRefuse says the boundary is on file while the map is not — not `not_measured`');

// ── §9 My Places still has no map (G), and Dashboard is untouched (F) ───────────────────
ok(!/HS\.buildLive/.test(read('properties.html')), '9a My Places has no map — portfolio management only');
ok(/radiusMi: 1\.5/.test(code(read('dashboard.html'))),
  '9b the Dashboard preview is byte-unchanged, decorative ring and all — PCM-1 did not "fix" it');

// ── §10 orientation, not investigation (E) ─────────────────────────────────────────────
const ctx = prop.slice(block - 4000 > 0 ? block - 4000 : 0, cols);
for (const [re, what] of [
  [/radSel|data-r=/, 'a user-selectable radius control'],
  [/setStatusFilter|setCategoryFilter|setTypeFilter/, 'investigation filters'],
  [/downloadHtml|exportCsv|\.ics\b/, 'export / ICS'],
  [/3D|maplibregl|three\.js/, 'a 2D/3D mode switch'],
]) ok(!re.test(ctx), '10 the context map adds no ' + what + ' — that belongs to Development',
     (ctx.match(re) || [])[0]);

console.log(fails === 0 ? '\nALL PASS' : '\n' + fails + ' FAILURE(S)');
process.exit(fails ? 1 : 0);
