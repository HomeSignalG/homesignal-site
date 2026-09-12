// PLACE CONTEXT MAPS ARE MAP 1, EMBEDDED — and the ways that could stop being true
// Run: node test/place-context-map.test.mjs
//
// THE HISTORY THIS FILE EXISTS FOR, because it has now been got wrong twice in opposite
// directions. #1141 (closed) put an investigation map on the public ZIP document with no auth
// gate and fitted a bbox of project points. PCM-1/PCM-4 then over-corrected into a pair of
// HS.buildLive ORIENTATION widgets with no type, no status and no regulatory layer — a second
// and a third implementation of "the development map", neither of them Map 1. This unit
// deletes both widgets and iframes homesignalmap.html instead.
//
// So the load-bearing pins here are the ones that keep the count at ONE: the Place hosts must
// carry an embed URL and no map-drawing code, and the filter rows a resident touches must be
// Map 1's own DOM ids driven by Map 1's own writers — never a decorative chip set.
let fails = 0;
const ok = (c, name, eviq) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name + (c || eviq === undefined ? '' : '\n        ' + eviq));
  if (!c) fails++;
};

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
// Comments describe the contract and quote the things it forbids, so a string pin that swept
// them would fire on its own explanation. Strip them before matching, everywhere.
// ⚠️ THE BLOCK-COMMENT STRIP MUST NOT FIRE INSIDE A URL, AND THIS FILE IS WHERE THAT WAS
// MEASURED. homesignalmap.html's CSP contains `https://*.tile.openstreetmap.org`, whose `/*`
// opened a phantom comment that ran 2,297 bytes to the first real `*/` in the page CSS —
// swallowing the CSP, the stylesheet links and the embed-mode <script> in the head. A pin
// asserting something is ABSENT from that region would have passed by reading nothing, which
// is the "success-shaped output attesting to nothing" failure this repo names explicitly.
// Requiring the opener not to follow `:` or `/` keeps every real comment and no URL.
const code = (s) => s.replace(/^\s*\/\/.*$/gm, '').replace(/<!--[\s\S]*?-->/g, '')
  .replace(/(^|[^:/])\/\*[\s\S]*?\*\//g, '$1');

const propRaw = read('property.html');
const prop    = code(propRaw);
const cpRaw   = read('lib/community-page.js');
const cp      = code(cpRaw);
const m1Raw   = read('homesignalmap.html');
const m1       = code(m1Raw);
const mapJs   = read('lib/map.js');

// ── §1 ONE IMPLEMENTATION: the Place hosts draw no map of their own ─────────────────────
// This is the whole unit in four assertions. A Place host that calls HS.buildLive is, by
// definition, a second implementation of the development map.
for (const [label, src, raw] of [['property.html', prop, propRaw], ['lib/community-page.js', cp, cpRaw]]) {
  ok(!/HS\.buildLive/.test(src), '1a ' + label + ' calls no map builder — the map is an iframe of Map 1',
    (raw.match(/.{0,60}buildLive.{0,60}/) || [])[0]);
  ok(!/src="lib\/map\.js/.test(src) && !/src="\/lib\/map\.js/.test(src),
    '1b ' + label + ' does not load lib/map.js — it loads inside the FRAMED document',
    (raw.match(/.{0,60}lib\/map\.js.{0,60}/) || [])[0]);
}
// The three Map 1 libraries left property.html with the widget that needed them.
for (const lib of ['lib/n5-radius.js', 'lib/residential-qualify.js']) {
  ok(!prop.includes(lib), '1c property.html no longer loads ' + lib + ' — homesignalmap.html already does',
    (propRaw.match(new RegExp('.{0,40}' + lib.replace(/[./]/g, '\\$&') + '.{0,40}')) || [])[0]);
}
ok(/src="lib\/n5-radius\.js\?v=/.test(m1) && /src="lib\/map\.js\?v=/.test(m1),
  '1d ...and homesignalmap.html — the one document that draws — still loads them');

// ── §2 the ADDRESS embed URL ────────────────────────────────────────────────────────────
const propFrame = (prop.match(/<iframe id="propMapFrame"[\s\S]*?<\/iframe>'/) || [''])[0];
ok(propFrame.length > 0, '2a property.html renders an iframe for the context map');
ok(/homesignalmap\.html\?embed=1/.test(propFrame), '2b ...pointed at homesignalmap.html in EMBED mode');
ok(/lat=' \+ encodeURIComponent\(p\.lat\)/.test(propFrame) && /lng=' \+ encodeURIComponent\(p\.lng\)/.test(propFrame),
  '2c ...carrying the SAVED point verbatim — never re-geocoded, so a Place\'s pin cannot move between visits');
ok(/radius=' \+ PCM_RADIUS_MI/.test(propFrame) && /var PCM_RADIUS_MI = 2;/.test(prop),
  '2d ...at the founder-set radius 2, from one constant');
// ⚠️ `&amp;` IS THE SEPARATOR AN IFRAME src ACTUALLY USES, and the first version of this pin
// could not see it: /[?&]addr=/ requires ? or & immediately before, and in `&amp;addr=` the
// preceding character is `;`. The mutation that adds ?addr= to the embed URL therefore passed.
// Unescape first, then match — a pin that only recognises the unescaped form is not a pin.
const unesc = (x) => x.replace(/&amp;/g, '&');
ok(!/[?&]addr=/.test(unesc(prop)),
  '2e NO ?addr= anywhere — that is loadProperty(), the dossier, not address mode',
  (unesc(propRaw).match(/.{0,60}[?&]addr=.{0,60}/) || [])[0]);
ok(!/[?&]addr=/.test(unesc(cp)), '2e2 ...nor on the ZIP host');
ok(!/geocode/i.test(prop), '2f the Address host runs no geocoder',
  (propRaw.match(/.{0,50}geocode.{0,50}/i) || [])[0]);

// ── §3 the ZIP embed URL, and the A-022 gate that withholds it ─────────────────────────
const zipFrame = (cp.match(/<iframe id="zipMapFrame"[\s\S]*?<\/iframe>'/) || [''])[0];
ok(zipFrame.length > 0, '3a the shared ZIP runtime renders an iframe for the context map');
ok(/homesignalmap\.html\?embed=1/.test(zipFrame) && /zip=' \+ encodeURIComponent\(zip\)/.test(zipFrame),
  '3b ...in EMBED mode, carrying the ZIP');
ok(!/[?&]addr=/.test(zipFrame) && !/lat=/.test(zipFrame),
  '3c ...and neither an address nor a point — a ZIP Place is an AREA');
ok(/var zipContextMap = \(sess && !sess\.demo\)/.test(cp),
  '3d the block is gated on (sess && !sess.demo) — the A-022 posture');
ok(/var sess = HS\.state\.session;/.test(cp) && cp.indexOf('var sess = HS.state.session;') < cp.indexOf('zipContextMap'),
  '3e ...read from the SAME single `var sess` ZIP health already uses (FM-081 unaffected)');
// The empty string is what makes the public document byte-identical, so pin the else branch.
ok(/\n    : '';/.test(cp.slice(cp.indexOf('zipContextMap'), cp.indexOf('zipContextMap') + 1400)),
  '3f ...and an anonymous or demo visitor concatenates \'\' — no iframe, no request, no map');

// ── §4 NO SECOND DEVELOPMENT LINK inside the frame ──────────────────────────────────────
// A link inside an iframe navigates the iframe. The handoff belongs on the PARENT, and both
// parents already had one before this unit.
ok(!/<a[^>]*homesignalmap/.test(zipFrame), '4a the ZIP frame markup carries no link of its own');
ok(/HS\.navHref\('homesignalmap\.html', p\.zip\)/.test(prop) && /id="propMapOpen"/.test(prop),
  '4b property.html keeps its parent-level "Open in Development →"');
ok(!/data-znav/.test(prop),
  '4c ...with NO data-znav, which would let the shell re-stamp it with the app\'s ACTIVE zip',
  (propRaw.match(/.{0,60}data-znav.{0,60}/) || [])[0]);
ok(/View Development Map/.test(cpRaw), '4d the ZIP page keeps its parent-level "View Development Map →"');

// ── §5 a demo or sample Place gets no map ───────────────────────────────────────────────
ok(/var realAddress = pcmHasPoint\(p\) && !p\.sample && !p\.demo;/.test(prop),
  '5a the Address embed is gated on a real point AND the demo-exclusion predicate');
ok(!/HS\.isRealHome/.test(prop),
  '5b ...and NOT via HS.isRealHome, whose label/tag clause would also suppress the map on a '
  + 'genuine saved Address carrying a different label',
  (propRaw.match(/.{0,60}isRealHome.{0,60}/) || [])[0]);

// ── §6 Map 1 embed mode: the hide list, and what survives it ────────────────────────────
ok(/classList\.add\("hs-embed"\)/.test(m1) && m1.indexOf('classList.add("hs-embed")') < m1.indexOf('shell.js'),
  '6a hs-embed is set in the HEAD, BEFORE shell.js — otherwise the chrome paints inside the frame first');
const hide = m1.slice(m1.indexOf('.hs-embed .app'), m1.indexOf('</style>'));
for (const [sel, what] of [
  ['#hs-side', 'the shared sidebar'],
  ['#hs-top', 'the shared top bar'],
  ['.wrap>.head', 'the hero and the ADDRESS SEARCH FORM'],
  ['#viewSeg', 'the 2D/3D switch'],
  ['#map3d', 'the 3D aerial canvas'],
  ['#mapgl', 'the 3D satellite canvas'],
  ['#radSel', 'the radius picker'],
  ['.results>.devtracker', 'the Development tracker'],
  ['#property', 'the address dossier'],
]) ok(hide.includes(sel), '6b the embed hide list hides ' + what + ' (' + sel + ')');
ok(/\.hs-embed \.app\{grid-template-columns:1fr\}/.test(hide),
  '6c ...and collapses the sidebar GRID COLUMN — display:none alone leaves its track reserved');
// What must NOT be hidden is the point of the unit.
for (const keep of ['#mapkey', '#mapkeyShapes', '#mapkeyReg', '#map', '.maplegend-wrap']) {
  ok(!new RegExp('\\.hs-embed [^{]*\\' + keep.replace(/[.#]/g, '\\$&') + '[^{]*\\{[^}]*display:none').test(hide),
    '6d the embed does NOT hide ' + keep + ' — the filter rows and the canvas are what it is for');
}

// ── §7 the three rows are Map 1's OWN controls, not decorative chips ────────────────────
// ACCEPTANCE, stated as code: unchecking a chip must reach the real writer.
ok(/HS\.setCategoryFilter\(key, on\)/.test(m1), '7a the TYPE row writes through HS.setCategoryFilter');
ok(/HS\.setCategoryFilter\(HS\.REGULATORY_LEGEND\.key, !!on\)/.test(m1),
  '7b the REGULATORY row writes through the same filter, keyed on HS.REGULATORY_LEGEND');
ok(/HS\.regulatoryVisible/.test(m1), '7c ...and reads its state from HS.regulatoryVisible');
ok(/id="mapkey"/.test(m1) && /id="mapkeyShapes"/.test(m1) && /id="mapkeyReg"/.test(m1),
  '7d all three rows are the full page\'s own DOM ids — the embed hides chrome, it does not rebuild controls');
ok(/Shape = project type/.test(m1Raw) && /Purple R = regulatory record/.test(m1Raw),
  '7e ...and the existing map key rides with them');
// The Place hosts must not grow a rival set.
for (const [label, src] of [['property.html', prop], ['lib/community-page.js', cp]]) {
  ok(!/setCategoryFilter|regulatoryVisible|mapkeyShapes|REGULATORY_LEGEND/.test(src),
    '7f ' + label + ' defines no filter controls of its own');
}

// ── §8 embed ADDRESS boot: no geocode, radius asserted against the server's allowlist ───
const boot = m1.slice(m1.indexOf('function embedRadius'), m1.indexOf('function paintEmbedZipBoundary'));
ok(/function runEmbedPoint\(home, radius\)/.test(boot), '8a there is a point-boot that takes a home and a radius');
ok(!/geocodeAddress/.test(boot),
  '8b ...and it never calls the geocoder — the saved point arrives in the URL and is used verbatim');
ok(/HS\.N5_RADII\.indexOf\(raw\) < 0\) return null/.test(boot),
  '8c the radius is ASSERTED against HS.N5_RADII, which mirrors the RPC\'s own allowlist — '
  + 'an off-allowlist value raises 22023, which would render as "nothing near this home"');
ok(/n5Radius\(home, radius\)/.test(boot) && /HS\.n5SitesFrom\(rows, projects, home\)/.test(boot),
  '8d ...and it runs the EXISTING address pipeline into the same render()');
ok(/CUR_RADIUS = radius;/.test(boot), '8e CUR_RADIUS is pinned to the URL\'s radius');
ok(!/1\.5/.test(boot), '8f the Dashboard\'s decorative 1.5 appears nowhere in the embed boot');

// ── §9 embed ZIP: the real ZCTA polygon, and nothing in its place ───────────────────────
const zboot = m1.slice(m1.indexOf('function paintEmbedZipBoundary'), m1.indexOf('function boot()'));
ok(/rpc\("app_zcta_boundary", \{ p_zip: zip \}\)/.test(zboot),
  '9a the embed reads the boundary through the SECURITY DEFINER function, by name, with a ZIP');
ok(!/geo\.zcta_boundary/.test(m1),
  '9b ...never geo.zcta_boundary directly — the browser roles have no USAGE on that schema');
ok(/payload\.status !== "boundary_complete"\) return/.test(zboot),
  '9c not_measured draws NOTHING — Map 1\'s own framing stands');
ok(!/L\.circle|ST_Buffer|ST_MakeEnvelope|fitItems/.test(zboot),
  '9d ...no circle, no envelope, no bbox of project points stands in for a boundary we do not have',
  (zboot.match(/L\.circle|ST_Buffer|ST_MakeEnvelope|fitItems/) || [])[0]);
// The RPC is embed-only: the full Development page must not newly start calling it.
// ⚠️ COUNTING THE RPC NAME MEASURED THE WRONG THING. It stays at one however many times the
// WRAPPER is called, so adding paintEmbedZipBoundary(z) to the non-embed ZIP boot passed. The
// question is where the FUNCTION is invoked, so pin the call sites: one definition, one call,
// and that call inside the embed branch.
const bootFn = m1.slice(m1.indexOf('(function boot(){'));
const embedBranch = bootFn.slice(bootFn.indexOf('embed'), bootFn.indexOf('var a = u.searchParams.get("addr")'));
const paintCalls = (m1.match(/paintEmbedZipBoundary\(/g) || []).length;
ok(paintCalls === 2, '9e paintEmbedZipBoundary has exactly ONE definition and ONE call site (found '
  + paintCalls + ' occurrences)');
ok(/paintEmbedZipBoundary\(ez\);/.test(embedBranch),
  '9e2 ...and that call is inside the embed branch');
ok(!/paintEmbedZipBoundary/.test(bootFn.slice(bootFn.indexOf('var a = u.searchParams.get("addr")'))),
  '9e3 ...so the non-embed ?zip= / ?addr= paths gain no new read',
  (bootFn.slice(bootFn.indexOf('var a = u.searchParams')).match(/.{0,70}paintEmbedZipBoundary.{0,30}/) || [])[0]);
const callsBoundary = (m1.match(/app_zcta_boundary/g) || []).length;
ok(callsBoundary === 1, '9e4 ...and the RPC name itself appears once (found ' + callsBoundary + ')');
ok(/if\(u\.searchParams\.get\("embed"\) === "1"\)\{/.test(m1),
  '9f the embed branch is entered only for embed=1');

// ── §10 non-embed Map 1 is unchanged ────────────────────────────────────────────────────
ok(/var a = u\.searchParams\.get\("addr"\);/.test(m1) && /loadProperty\(a\.trim\(\)\); return;/.test(m1),
  '10a ?addr= still routes to the dossier on the full page');
ok(/loadZip\(z\); loadDevTracker\(z\);/.test(m1),
  '10b ...and ?zip= still boots the ZIP report WITH the Development tracker (the embed skips the tracker)');
ok(/ZIP_FRAME = ZIP_MODE && window\.HS && HS\.zipFrameFromSites/.test(m1),
  '10c ZIP_FRAME still comes from the records\' own extent — non-embed ZIP framing is untouched');
ok(/<div class="radsel" id="radSel">/.test(m1Raw) && /<form class="search" id="form"/.test(m1Raw),
  '10d the radius picker and the address search still EXIST — the embed hides them with CSS, it does not delete them');

// ── §11 PCM-2's primitive is still there, and is now used by nobody on a Place ──────────
ok(/HS\.boundaryFC = function/.test(mapJs) && /HS\.boundaryBounds = function/.test(mapJs),
  '11a lib/map.js still exposes the boundary helpers');
ok(/HS\.boundaryFC\(payload\.geometry\)/.test(zboot),
  '11b ...and Map 1\'s embed is what consumes them now');
ok(!/\bboundary:/.test(prop) && !/fitBoundary/.test(prop) && !/\bboundary:/.test(cp) && !/fitBoundary/.test(cp),
  '11c neither Place host passes boundary/fitBoundary — neither draws anything');

// ── §12 My Places still has no map (G), and Dashboard is untouched (F) ─────────────────
ok(!/HS\.buildLive/.test(read('properties.html')) && !/<iframe/.test(read('properties.html')),
  '12a My Places has no map — portfolio management only');
ok(/radiusMi: 1\.5/.test(code(read('dashboard.html'))),
  '12b the Dashboard preview is byte-unchanged, decorative ring and all');

// ── §13 the Place hosts iframe the EMBED, never the full Development page ──────────────
// INVERTED. §10 of this file used to forbid type/status/regulatory controls near the Place
// map, because the Place map was an orientation widget. Place maps ARE Map 1 now, so those
// controls SHOULD be present — on the EMBEDDED document, which §7 pins. What survives here
// is the other half: a Place must not iframe the FULL page, chrome and all.
for (const [label, src, raw] of [['property.html', prop, propRaw], ['lib/community-page.js', cp, cpRaw]]) {
  const frames = src.match(/<iframe[\s\S]*?<\/iframe>/g) || [];
  ok(frames.length === 1, '13a ' + label + ' renders exactly one iframe (found ' + frames.length + ')');
  ok(frames.every((f) => /embed=1/.test(f)),
    '13b ' + label + '\'s iframe carries embed=1 — a frame without it is the full Development page, '
    + 'chrome and all, inside a Place', (raw.match(/<iframe[^>]*>/) || [])[0]);
}

// ── §14 the map must not bury "Generate property report" ────────────────────────────────
// PCM-1's position is still "between the header and What's changing". That means the FIRST
// CELL of the left column of .cols, not a full-width sibling above the grid. A 320–520px
// iframe above .cols pushed the actions rail below the fold on a 1280×720 laptop. Demo/seed
// Addresses skip the map, so a seed-only browser pass cannot see this — the pin is on the
// concatenation order, which is what production saved homes actually render.
// Destination is unchanged: reports.html?id= (the #1177 Premium waitlist), not a generator.
const colsOpen = prop.indexOf("'<div class=\"cols\" id=\"propCols\"><div>'");
const mapUse   = prop.indexOf('+ contextMap');
const changing = prop.indexOf("What\\'s changing near this property");
ok(colsOpen >= 0, '14a the Address grid is #propCols — the stacked-order rule is scoped to this page');
ok(mapUse > colsOpen,
  '14b the Address map is concatenated INSIDE .cols, after the grid opens — not as a full-width sibling above it',
  'colsOpen=' + colsOpen + ' mapUse=' + mapUse);
ok(changing > mapUse,
  '14c ...and still BEFORE "What\'s changing" — PCM-1\'s position, not a relocation',
  'mapUse=' + mapUse + ' changing=' + changing);
ok(/id="propReportBtn"/.test(prop),
  '14d Generate property report has a stable id, so a buried CTA is measurable');
ok(prop.indexOf("What you can do") < prop.indexOf("Property vitals"),
  '14d2 the actions block leads the right rail — vitals under it still left the CTA 4px below a 720px laptop viewport');
ok(/location\.href=\\'reports\.html\?id=' \+ encodeURIComponent\(p\.id\)/.test(prop),
  '14d3 the CTA still opens reports.html?id= — the shipped Premium flow, not a generator');
const cssSrc = read('app.css');
const mq900 = cssSrc.slice(cssSrc.indexOf('@media (max-width: 900px)'), cssSrc.indexOf('@media (max-width: 620px)'));
ok(/#propCols\s*>\s*:last-child\s*\{[^}]*order:\s*-1/.test(mq900),
  '14e stacked, the actions column paints FIRST — otherwise the map still buries the CTA on a phone');
ok(!/#propCols/.test(code(read('dashboard.html'))) && !/#propCols/.test(code(read('development.html')))
  && !/#propCols/.test(code(read('lib/community-page.js'))),
  '14f ...and no other container page reused that id, so the order rule cannot leak');

console.log(fails === 0 ? '\nALL PASS' : '\n' + fails + ' FAILURE(S)');
process.exit(fails ? 1 : 0);
