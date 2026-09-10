// PCM-2 — THE BOUNDARY PRIMITIVE, DRIVEN THROUGH THE SHIPPED lib/map.js
// Run: node test/buildlive-boundary.test.mjs
//
// WHY THE FIT LIVES INSIDE buildLive, which is what §3 exists to prove: Leaflet takes
// fitBounds as [[south,west],[north,east]] and MapLibre takes [[west,south],[east,north]] —
// OPPOSITE orders — the caller cannot tell which engine it was given, and onReady is never
// fired on the schematic path at all (Leaflet and MapLibre only). A caller-side fit would
// therefore be silently transposed on one engine and silently absent on another.
//
// §4 is the load-bearing one. The schematic has no tiles, no projection and no viewport; the
// only "boundary" it could draw is `o.radiusMi || 1.5` — the Dashboard's DECORATIVE ring,
// which is not in the RPC's radius allowlist and is not a data radius. A circle drawn where
// a ZIP boundary was asked for is a fabricated geography, so the schematic refuses.
let fails = 0;
const ok = (c, name, ev) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name + (c || ev === undefined ? '' : '\n        ' + JSON.stringify(ev)));
  if (!c) fails++;
};

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// --- DOM shim, then the SHIPPED module. Not a copy of it. ------------------------------
function makeEl() {
  return {
    innerHTML: '', style: {}, _attrs: {},
    setAttribute(k, v) { this._attrs[k] = v; },
    getAttribute(k) { return k in this._attrs ? this._attrs[k] : null; },
    querySelector() { return null; }, querySelectorAll() { return []; },
    addEventListener() {}
  };
}
global.window = { HS: {} };
global.document = {
  createElement: () => ({ style: { cssText: '' }, innerHTML: '', firstChild: { style: {}, title: '' },
                          setAttribute() {}, addEventListener() {}, appendChild() {} }),
  head: { appendChild() {} }
};
await import('../lib/map.js');
const HS = global.window.HS;
ok(typeof HS.buildLive === 'function', '0a the shipped buildLive loaded');

const FIX = JSON.parse(readFileSync(join(root, 'test/fixtures/zcta-84302.geojson'), 'utf8'));
// A real ZCTA outline (Brigham City 84302, TIGER/Line 2025, simplified for committing).
const POLY = FIX.geometry;
// Two translated copies, so MultiPolygon and holes are exercised on real vertex data
// rather than a hand-drawn square.
const MULTI = { type: 'MultiPolygon', coordinates: [
  POLY.coordinates,
  POLY.coordinates.map(r => r.map(([x, y]) => [x + 1, y + 1]))
] };

// --- §0 the pure helpers ---------------------------------------------------------------
ok(HS.boundaryFC(POLY).features.length === 1, '0b boundaryFC accepts a bare Polygon geometry');
ok(HS.boundaryFC(FIX).features.length === 1, '0c ...a Feature');
ok(HS.boundaryFC({ type: 'FeatureCollection', features: [FIX, FIX] }).features.length === 2, '0d ...and a FeatureCollection');
ok(HS.boundaryFC(MULTI).features.length === 1, '0e ...and a MultiPolygon');
for (const bad of [null, undefined, 42, { type: 'Point', coordinates: [1, 2] },
                   { type: 'LineString', coordinates: [[0, 0], [1, 1]] }])
  ok(HS.boundaryFC(bad) === null,
    '0f a non-AREA geometry yields null, never a drawn stand-in — ' + (bad && bad.type ? bad.type : String(bad)));

const B = HS.boundaryBounds(POLY);
const xs = POLY.coordinates[0].map(c => c[0]), ys = POLY.coordinates[0].map(c => c[1]);
ok(Math.abs(B.west - Math.min(...xs)) < 1e-12 && Math.abs(B.east - Math.max(...xs)) < 1e-12
   && Math.abs(B.south - Math.min(...ys)) < 1e-12 && Math.abs(B.north - Math.max(...ys)) < 1e-12,
  '0g boundaryBounds reproduces the polygon\'s own extent exactly', B);
const BM = HS.boundaryBounds(MULTI);
ok(Math.abs(BM.east - (B.east + 1)) < 1e-12 && Math.abs(BM.south - B.south) < 1e-12,
  '0h ...and spans EVERY part of a MultiPolygon, not just the first', BM);
ok(HS.boundaryBounds({ type: 'Point', coordinates: [1, 2] }) === null, '0i ...and refuses a non-area input');

// --- engine fakes -----------------------------------------------------------------------
function rec() { return { setView: [], fitBounds: [], geoJSON: [], circle: [], marker: [], added: [], src: [], layer: [], ready: 0, refused: [] }; }
// FAITHFUL TO LEAFLET'S ACTUAL CONTRACT, and that is load-bearing: `layer.addTo(target)`
// calls `target.addLayer(layer)`. An `addTo(){}` no-op would accept ANY argument, including
// a plain object that is not a map — which is precisely the defect §6 measures. A fake more
// permissive than the real library cannot detect a caller passing the wrong thing to it.
function leafletFake(r) {
  const map = {
    attributionControl: { setPrefix() {} },
    setView(c, z) { r.setView.push([c, z]); return map; },
    fitBounds(b, o) { r.fitBounds.push([b, o]); return map; },
    addLayer(l) { r.added.push(l); return map; },
    on() {}, remove() {}
  };
  const layer = (extra) => Object.assign({
    addTo(t) { t.addLayer(this); return this; }
  }, extra || {});
  return {
    map: () => map,
    tileLayer: () => layer({ on() {} }),
    circle: (c, o) => { r.circle.push([c, o]); return layer(); },
    divIcon: () => ({}),
    marker: (ll) => { r.marker.push(ll); return layer({ on() {}, getElement: () => null }); },
    geoJSON: (gj, o) => { r.geoJSON.push([gj, o]); return layer(); }
  };
}
function glFake(r) {
  const h = {};
  function Map(cfg) {
    r.cfg = cfg;
    this.on = (e, fn) => { h[e] = fn; };
    this.addSource = (id, s) => r.src.push([id, s]);
    this.addLayer = (l) => r.layer.push(l.id);
    this.fitBounds = (b, o) => r.fitBounds.push([b, o]);
    this.remove = () => {};
    this.fire = (e) => h[e] && h[e]({});
    r.map = this;
  }
  function Marker() { this.setLngLat = () => this; this.addTo = () => this; }
  return { Map, Marker };
}
// The documented way to reach the schematic: HS.loadLeaflet reports the library unavailable.
function forceSchematic() { HS.loadLeaflet = (cb) => cb(false); }
const realLoadLeaflet = HS.loadLeaflet;

function run(opts, engine, r) {
  const el = makeEl();
  // buildLive GUARDS on `window.L` / `window.maplibregl` but CALLS bare `L` / `maplibregl`.
  // In a browser those are the same binding; under Node they are not, so both have to be set
  // or the guard passes and the call throws into the catch — which looks exactly like the
  // engine legitimately failing over. Setting one and not the other is how this harness
  // would quietly measure the fallback instead of the engine it names.
  global.window.L = global.L = engine === 'leaflet' ? leafletFake(r) : undefined;
  global.window.maplibregl = global.maplibregl = engine === 'gl' ? glFake(r) : undefined;
  HS.loadLeaflet = engine === 'leaflet' ? ((cb) => cb(true)) : realLoadLeaflet;
  if (engine === 'schematic') forceSchematic();
  HS.buildLive(el, Object.assign({ onRefuse: (x) => r.refused.push(x) }, opts));
  if (engine === 'gl' && r.map) r.map.fire('load');
  return el;
}

// The Dashboard's own call (dashboard.html:189), verbatim in the parts that matter.
const DASH = { center: { lat: 30.17, lng: -97.61 }, items: [], home: null,
               interactive: true, zoom: 12.4, radiusMi: 1.5, w: 640, h: 300 };

// --- §1 defaults preserve today's behaviour ---------------------------------------------
let r = rec(); let el = run(DASH, 'leaflet', r);
ok(r.setView.length === 1 && r.setView[0][1] === 12.4, '1a Leaflet default: setView with the caller\'s zoom', r.setView);
ok(r.fitBounds.length === 0, '1b ...no fitBounds');
ok(r.geoJSON.length === 0, '1c ...no boundary layer');
ok(r.circle.length === 1 && Math.round(r.circle[0][1].radius) === Math.round(1.5 * 1609.34),
  '1d ...and the decorative 1.5 mi ring is drawn exactly as before', r.circle[0][1].radius);
ok(el.getAttribute('data-hs-map-refused') === null, '1e ...and nothing is refused');

r = rec(); run(DASH, 'gl', r);
ok(r.cfg.zoom === 12.4 && r.cfg.center[0] === -97.61, '1f MapLibre default: constructor center+zoom unchanged', r.cfg.center);
ok(r.fitBounds.length === 0, '1g ...no fitBounds');
ok(!r.src.some(s => s[0] === 'hsb') && !r.layer.includes('hsbf'), '1h ...no boundary source or layers');
ok(r.src.some(s => s[0] === 'r'), '1i ...and the radius source is still added');

r = rec(); el = run(DASH, 'schematic', r);
ok(/<svg/.test(el.innerHTML) && el.getAttribute('data-hs-map-refused') === null,
  '1j schematic default: still renders, still not a refusal');

// --- §2 a boundary DRAWS without changing the viewport ----------------------------------
r = rec(); run(Object.assign({}, DASH, { boundary: FIX }), 'leaflet', r);
ok(r.geoJSON.length === 1 && r.geoJSON[0][0].features[0].geometry.type === 'Polygon',
  '2a Leaflet draws the boundary as a GeoJSON layer');
ok(r.setView.length === 1 && r.fitBounds.length === 0,
  '2b ...and WITHOUT fitBoundary the viewport is still center+zoom');
r = rec(); run(Object.assign({}, DASH, { boundary: FIX }), 'gl', r);
ok(r.src.some(s => s[0] === 'hsb') && r.layer.includes('hsbf') && r.layer.includes('hsbl'),
  '2c MapLibre adds a fill AND a line layer', r.layer);
ok(r.fitBounds.length === 0, '2d ...and does not fit');

// --- §3 fitBoundary drives the viewport, in each engine's OWN order ----------------------
const FIT = Object.assign({}, DASH, { boundary: FIX, fitBoundary: true });
r = rec(); run(FIT, 'leaflet', r);
ok(r.setView.length === 0 && r.fitBounds.length === 1, '3a Leaflet fits instead of setView');
const lb = r.fitBounds[0][0];
ok(lb[0][0] === B.south && lb[0][1] === B.west && lb[1][0] === B.north && lb[1][1] === B.east,
  '3b ...as [[south,west],[north,east]] — Leaflet order', lb);
ok(r.fitBounds[0][1] && r.fitBounds[0][1].padding, '3c ...with padding');
r = rec(); run(FIT, 'gl', r);
ok(r.fitBounds.length === 1, '3d MapLibre fits');
const gb = r.fitBounds[0][0];
ok(gb[0][0] === B.west && gb[0][1] === B.south && gb[1][0] === B.east && gb[1][1] === B.north,
  '3e ...as [[west,south],[east,north]] — the OPPOSITE order, which is why this is not the caller\'s job', gb);
ok(gb[0][0] !== lb[0][0], '3f ...and the two orders really do differ on this fixture');

// --- §4 the schematic REFUSES rather than degrading --------------------------------------
r = rec(); el = run(FIT, 'schematic', r);
ok(el.getAttribute('data-hs-map-refused') === 'boundary-needs-tiles', '4a schematic refuses a boundary view',
  el.getAttribute('data-hs-map-refused'));
ok(el.innerHTML === '', '4b ...draws nothing at all');
ok(!/1\.5|circle/i.test(el.innerHTML) && r.circle.length === 0,
  '4c ...and never falls back on the decorative 1.5 mi ring as a stand-in for the ZIP');
ok(r.refused.length === 1, '4d ...and tells the caller, so a refusal is a state and not a silence');
r = rec(); el = run(Object.assign({}, DASH, { boundary: FIX }), 'schematic', r);
ok(el.getAttribute('data-hs-map-refused') === 'boundary-needs-tiles',
  '4e a boundary it cannot DRAW is refused too, not just a fit it cannot perform');

// --- §5 fitBoundary with no usable polygon is refused in EVERY engine ---------------------
for (const [eng, label] of [['leaflet', 'Leaflet'], ['gl', 'MapLibre'], ['schematic', 'schematic']]) {
  r = rec(); el = run(Object.assign({}, DASH, { fitBoundary: true }), eng, r);
  ok(el.getAttribute('data-hs-map-refused') === 'fitBoundary-without-boundary',
    '5 ' + label + ': fitBoundary with no polygon refuses rather than quietly serving center+zoom',
    el.getAttribute('data-hs-map-refused'));
}
r = rec(); el = run(Object.assign({}, DASH, { fitBoundary: true, boundary: { type: 'Point', coordinates: [0, 0] } }), 'leaflet', r);
ok(el.getAttribute('data-hs-map-refused') === 'fitBoundary-without-boundary',
  '5d ...and a non-area "boundary" counts as no polygon, rather than being drawn as one');

// --- §6 THE LEAFLET MAP SURVIVES ITS OWN MARKERS -----------------------------------------
// INVERTED. Until 5fa3f90 these pins recorded a defect: `const m = HS.resolveMarker(it)` in
// the marker loop SHADOWED the outer `const m = L.map(el, …)`, so `mk.addTo(m)` handed the
// marker to a plain object with no addLayer. Leaflet threw, the branch's own catch called
// schematic(), and the entire tiled map was discarded — on every call carrying at least one
// item. property.html is the page that felt it: it deliberately does not load maplibre-gl, so
// Leaflet IS its engine, and any nearby record turned its map into the schematic.
// The inner binding is now `spec`. These assert the map is KEPT.
//
// The fake's addTo is faithful on purpose — `addTo(t) { t.addLayer(this); }` — so a
// reintroduced shadow throws here exactly as Leaflet would. An `addTo(){}` no-op would
// accept any argument and let the defect back in unnoticed.
const ITEM = { id: 'x', lat: 41.55, lng: -112.05, status: 'Proposed' };
r = rec(); let readyWith = 0;
el = run(Object.assign({}, DASH, { items: [ITEM], onReady: () => { readyWith++; } }), 'leaflet', r);
ok(!/<svg/.test(el.innerHTML),
  '6a Leaflet KEEPS the map when items.length > 0 — no schematic dump', el.innerHTML.slice(0, 60));
ok(el.getAttribute('data-hs-map-refused') === null, '6b ...and nothing is refused by that path');
ok(r.marker.length === 1 && r.added.length === 3,
  '6c ...and the marker actually reached the map, alongside the tile layer and the radius ring',
  { markers: r.marker.length, added: r.added.length });
ok(r.setView.length === 1, '6d ...and the view was still set');
ok(readyWith === 1,
  '6e ...and onReady FIRES — it sits after the loop, so the throw used to skip it silently');

// The same, with the PCM-2 options on: a boundary view with markers is the PCM-4 shape.
r = rec(); el = run(Object.assign({}, FIT, { items: [ITEM] }), 'leaflet', r);
ok(r.fitBounds.length === 1 && el.getAttribute('data-hs-map-refused') === null && !/<svg/.test(el.innerHTML),
  '6f a boundary view WITH markers fits AND survives — the PCM-4 shape is no longer blocked');
ok(r.geoJSON.length === 1 && r.marker.length === 1 && r.added.length === 4,
  '6g ...with the boundary layer, the ring and the marker all on the map',
  { added: r.added.length });

// Control: the harness can still SEE a reintroduced shadow. Handing a marker to a
// non-map object must throw through the same faithful contract the fix relies on.
let threw = false;
try { leafletFake(rec()).marker([0, 0]).addTo({ notAMap: true }); } catch (e) { threw = true; }
ok(threw,
  '6h CONTROL: the fake still throws when a layer is added to a non-map, so 6a-6g are a '
  + 'measurement of the fix and not of a permissive stub');

console.log(fails === 0 ? '\nALL PASS' : '\n' + fails + ' FAILURE(S)');
process.exit(fails ? 1 : 0);
