// PCM-1 — Address context map on property.html only.
//
// Orientation, not investigation: house-logo pin for THIS Address, nearby
// canonical projects from n5_projects_within_radius at Map 1's 1-mile address
// default, handoff to homesignalmap.html?zip=. Does NOT put Map 1 on the page,
// does not invent 1.5 mi, does not treat ?addr= as address-mode, and does not
// ship a ZIP geography map (that's PCM-4).
//
// Every check runs on a COMMENT-STRIPPED copy so a comment naming a forbidden
// string cannot satisfy a check that it is absent.
import fs from 'node:fs';
let fails = 0;
const ok = (c, name, d) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name
  + (!c && d !== undefined ? '  detail: ' + JSON.stringify(d).slice(0, 220) : '')); if (!c) fails++; };
const read = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const strip = (x) => x.replace(/^\s*\/\/.*$/gm, '').replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
const exists = (f) => fs.existsSync(new URL('../' + f, import.meta.url));

const propRaw = read('property.html');
const prop = strip(propRaw);
const paintStart = prop.indexOf('function paintPlaceContextMap');
const readyStart = prop.indexOf('HS.onReady');
ok(paintStart >= 0 && readyStart > paintStart, 'paintPlaceContextMap is defined before HS.onReady');
const paint = paintStart >= 0 && readyStart > paintStart ? prop.slice(paintStart, readyStart) : '';
const dash = strip(read('dashboard.html'));
const mapjs = strip(read('lib/map.js'));
const comm = exists('community.html') ? strip(read('community.html')) : '';
const props = exists('properties.html') ? strip(read('properties.html')) : '';
const gen = exists('scripts/gen_zip_pages.py') ? read('scripts/gen_zip_pages.py') : '';

// ---- insertion: after .ph / eyebrow+H1, before "What's changing" --------------
const ph = prop.indexOf("class=\"ph\"");
const around = prop.indexOf('<h2>Around this address</h2>');
const changing = prop.indexOf('What\\\'s changing near this property');
ok(ph >= 0 && around > ph && changing > around,
  'map block sits after .ph and before the existing "What\'s changing" list',
  { ph, around, changing });
ok(/id="placeContextMap"/.test(prop) && /id="placeContextMapLink"/.test(prop)
  && /id="placeContextMapNote"/.test(prop),
  'map surface, Development handoff, and honest note all have ids');
ok(/Open in Development →/.test(prop), 'handoff copy is "Open in Development →"');
ok(!/<h2>Map 1<\/h2>/.test(prop) && !/>Map 1</.test(prop),
  'the widget is not labelled Map 1');

// ---- renderer: HS.buildLive, not the #1141 HS.placeMap / fitItems path --------
ok(/HS\.buildLive\(mapEl,/.test(paint), 'calls HS.buildLive directly');
ok(!/HS\.placeMap/.test(prop), 'does not invent HS.placeMap');
ok(!/fitItems|fitBoundary|boundary/.test(paint),
  'does not fit a project bbox or ZIP polygon (PCM-1 is address-point)');

// ---- nearby: N5 RPC at allowlisted 1 mile, not ZIP-scoped HS.data.projects ----
ok(/n5_projects_within_radius/.test(paint), 'nearby path is n5_projects_within_radius');
ok(/var RADIUS_MI = 1;/.test(paint) && /HS\.N5_RADII\.indexOf\(RADIUS_MI\)/.test(paint),
  'radius is 1 and is refused unless it is on HS.N5_RADII');
ok(/p_radius_mi:\s*RADIUS_MI/.test(paint) && /p_lat:\s*p\.lat/.test(paint) && /p_lng:\s*p\.lng/.test(paint),
  'RPC is centred on THIS Address row\'s lat/lng');
ok(/HS\.n5SitesFrom\(rows, projects, home\)/.test(paint),
  'sites are built by HS.n5SitesFrom (same grain as Map 1 address mode)');
ok(!/HS\.data\.projects/.test(paint),
  'the map painter does not read HS.data.projects');
ok(/var projects = HS\.withDistance\(await HS\.data\.projects/.test(prop),
  'HS.data.projects still feeds the existing "What\'s changing" list');
ok(!/\b1\.5\b/.test(prop), 'property.html does not use the Dashboard\'s 1.5 mi decorative ring');

// ---- home pin: this Address, never sample/demo, never HS.realHome() -----------
ok(/!p\.sample/.test(paint) && /!p\.demo/.test(paint) && /p\.lat != null/.test(paint) && /p\.lng != null/.test(paint),
  'house pin is gated on !sample && !demo && lat/lng');
ok(/HS\.isRealHome\(p\)/.test(paint), 'popup "Your home" is gated on HS.isRealHome(this Address)');
ok(!/HS\.realHome\(/.test(prop),
  'never calls HS.realHome() — that can pin a different ZIP\'s home');
ok(/homeTitle: homeTitle/.test(paint), 'passes homeTitle through to buildLive');

// ---- handoff: navHref zip, not invented ?addr= address-mode -------------------
ok(/HS\.navHref\('homesignalmap.html',\s*zip\)/.test(paint),
  'handoff is HS.navHref(\'homesignalmap.html\', zip)');
ok(!/\?addr=/.test(prop), 'does not invent ?addr= as address-mode');
ok(/href="homesignalmap.html"/.test(prop),
  'markup default is the Development page (JS then stamps ?zip=)');

// ---- CSP + scripts: tiles, workers, content-keyed map.js, no eager MapLibre ---
ok(/worker-src blob:/.test(propRaw) && /tile\.openstreetmap\.org/.test(propRaw)
  && /server\.arcgisonline\.com/.test(propRaw),
  'CSP allows map tiles and worker-src blob: (Dashboard-shaped, this page only)');
ok(/lib\/map\.js\?v=[0-9a-f]{8}/.test(propRaw), 'lib/map.js is content-keyed');
ok(/lib\/n5-radius\.js\?v=20260904/.test(propRaw),
  'n5-radius.js keeps the dated key shared with homesignalmap.html');
ok(/lib\/residential-qualify\.js\?v=20260905/.test(propRaw),
  'residential-qualify.js is loaded (N5 sites use the same gate)');
ok(!/maplibre-gl/.test(prop), 'no eager MapLibre on the Address dossier');

// ---- buildLive default is unchanged for Dashboard -----------------------------
ok(/homeTitle = 'Your home'/.test(mapjs) || /homeTitle = 'Your home'/.test(read('lib/map.js')),
  'HS.buildLive defaults homeTitle to "Your home"');
ok(!/homeTitle:/.test(dash),
  'Dashboard does not pass homeTitle — it keeps the default');

// ---- PCM-1 does not leak onto ZIP pages, My Places, or the generator ----------
ok(!/lib\/map\.js/.test(comm) && !/placeContextMap/.test(comm),
  'community.html has no map.js and no place-context map');
ok(!/lib\/map\.js/.test(props) && !/placeContextMap/.test(props),
  'properties.html (My Places) has no map.js and no place-context map');
ok(!/map\.js/.test(gen) && !/placeContextMap/.test(gen) && !/buildLive/.test(gen),
  'scripts/gen_zip_pages.py still does not load map.js');

// ---- seed / sample: no N5 fetch around a demo home ----------------------------
ok(/DATA_SOURCE/.test(paint) && /isSeed/.test(paint),
  'seed mode skips the live N5 RPC');
ok(/!canPin/.test(paint), 'sample/unlocated addresses still render the wrap, not an N5 query');

console.log(fails ? '\n' + fails + ' failed' : '\nAll Place Context Address (PCM-1) assertions passed.');
process.exit(fails ? 1 : 0);
