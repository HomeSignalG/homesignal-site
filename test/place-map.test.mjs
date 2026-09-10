// Map 1 on each Place: Address = house logo at the saved point; ZIP Code = geography.
//
// WHY THIS FILE EXISTS. After the architecture merge, Map 1 left the sidebar and the
// Address dossier (property.html) had no map at all. A saved ZIP opened community.html
// with only a "View Development Map →" link. The founder asked for Map 1 ON each Place:
//   • Address  → house logo at that location (never a sample/demo/centroid)
//   • ZIP Code → full geography (no home pin, no radius)
//
// CONCURRENCY (CLAUDE.md): GENUINE GAP as of 2026-09-10. No open PR put a map on
// property.html or the ZIP Place surface.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

let fails = 0;
const ok = (c, name, d) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name
    + (!c && d !== undefined ? '  detail: ' + JSON.stringify(d).slice(0, 220) : ''));
  if (!c) fails++;
};
const read = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const strip = (x) => x.replace(/^\s*\/\/.*$/gm, '').replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

const prop = strip(read('property.html'));
const cp   = strip(read('lib/community-page.js'));
const map  = read('lib/map.js');
const comm = read('community.html');
const gen  = read('scripts/gen_zip_pages.py');

// ---- wiring: both Place surfaces mount Map 1 via the shared helper --------------------
ok(/id="placeMap"/.test(prop), 'Address Place (property.html) has #placeMap');
ok(/mode:\s*'address'/.test(prop) && /HS\.placeMap/.test(prop),
  'property.html mounts HS.placeMap in address mode');
ok(/homesignalmap\.html\?addr=/.test(prop),
  'Address "Open full map" targets Map 1 address mode (?addr=)');
ok(/Watch this property/.test(read('property.html')) && /Generate property report/.test(read('property.html')),
  'property.html Watch / Generate report CTAs are untouched');

ok(/id="placeMap"/.test(cp), 'ZIP Place (community-page.js) has #placeMap');
ok(/mode:\s*'zip'/.test(cp) && /home:\s*null/.test(cp),
  'ZIP Place mounts HS.placeMap in zip mode with home: null');
ok(/View Development Map →/.test(cp) && /HS\.navHref\('homesignalmap\.html', zip\)/.test(cp),
  'PS-001 "View Development Map →" still targets Map 1');
ok(/Open full map →/.test(cp), 'ZIP Place also has Open full map → on the Map 1 block');

// ---- two hosts of the ZIP runtime load map.js the same way -----------------------------
ok(/lib\/map\.js\?v=/.test(comm) && /lib\/map\.js\?v=/.test(gen),
  'community.html and the generator both load lib/map.js (keyed)');
ok(/tile\.openstreetmap\.org/.test(comm) && /server\.arcgisonline\.com/.test(comm),
  'community.html CSP allows map tiles');
ok(/tile\.openstreetmap\.org/.test(gen) && /server\.arcgisonline\.com/.test(gen),
  'generator CSP allows map tiles — pretty /community/<zip>/ gets the same map');
ok(/tile\.openstreetmap\.org/.test(read('property.html')) && /maplibre-gl/.test(read('property.html')),
  'property.html CSP/scripts allow the live map engines');

// ---- the helper itself encodes the two Place types ------------------------------------
ok(/HS\.placeMap = function/.test(map), 'HS.placeMap exists on the shared map backbone');
ok(/mode === 'address'/.test(map) && /!raw\.sample && !raw\.demo/.test(map),
  'address mode refuses sample/demo rows as a home pin');
ok(/fitItems: !isAddr && items\.length > 1/.test(map),
  'ZIP mode frames the records (fitItems) instead of a home radius');
ok(/radiusMi: \(isAddr && home\) \? 1\.5 : undefined/.test(map),
  'ZIP mode does not draw a radius — that is an address-mode concept');

// ---- executed: schematic Address has the house mark; ZIP geography does not -----------
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
global.window = { HS: {}, location: { href: '' } };
global.document = {
  createElement: function () { return { style: {}, setAttribute: function () {}, appendChild: function () {} }; },
  head: { appendChild: function () {} },
  body: { appendChild: function () {} },
  documentElement: { appendChild: function () {} }
};
await import(join(root, 'lib/templates.js'));
await import(join(root, 'lib/map.js'));
const HS = global.window.HS;
HS.loadLeaflet = function (cb) { cb(false); };   // force schematic — no network
function el() {
  return {
    innerHTML: '', style: {},
    getAttribute: function () { return '0'; },
    setAttribute: function () {},
    addEventListener: function () {}
  };
}

const addrEl = el();
HS.placeMap(addrEl, {
  mode: 'address',
  home: { lat: 30.176, lng: -97.61, address: '13313 Coomes Dr', sample: false, demo: false },
  homeCaption: 'Your home',
  items: [{ lat: 30.183, lng: -97.60, status: 'Approved', type: 'Industrial', name: 'Near' }],
  mapHref: 'homesignalmap.html?addr=13313%20Coomes%20Dr'
});
ok(/hs-home/.test(addrEl.innerHTML), 'Address schematic draws the house-logo mark', addrEl.innerHTML.slice(0, 120));
ok(/Your home/.test(addrEl.innerHTML), 'Address schematic labels the house mark');

const demoEl = el();
HS.placeMap(demoEl, {
  mode: 'address',
  home: { lat: 30.176, lng: -97.61, address: '4400 Wildhorse Trail', sample: false, demo: true },
  items: [{ lat: 30.183, lng: -97.60, status: 'Approved', type: 'Industrial' }]
});
ok(!/hs-home/.test(demoEl.innerHTML), 'a DEMO address never gets the house logo');

const zipEl = el();
HS.placeMap(zipEl, {
  mode: 'zip',
  home: { lat: 30.1745, lng: -97.6134, address: 'ZIP centroid' },  // must be ignored
  items: [
    { lat: 30.183, lng: -97.60, status: 'Approved', type: 'Industrial', name: 'A' },
    { lat: 30.191, lng: -97.64, status: 'Proposed', type: 'Data Center', name: 'B' }
  ],
  mapHref: 'homesignalmap.html?zip=78617'
});
ok(!/hs-home/.test(zipEl.innerHTML), 'ZIP geography never draws a house logo — even if a centroid is passed as home');
ok(!/Your home/.test(zipEl.innerHTML), 'ZIP geography never says Your home');
ok(!/mi radius/.test(zipEl.innerHTML), 'ZIP geography has no address-mode radius ring');

console.log(fails ? '\n' + fails + ' failed' : '\nAll Place Map 1 assertions passed.');
process.exit(fails ? 1 : 0);
