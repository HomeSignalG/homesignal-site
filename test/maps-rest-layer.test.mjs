// Maps uncap Phase 2 — pins the full-set "rest" layer backbone: the lettered A-P
// set is a presentation aid, NEVER an accessibility cap. Every visible record
// beyond the letters must reach the map (GL clustered source / Leaflet canvas
// layer) and the side panel ("All records on file", chunk-rendered).
// Pure helpers pinned directly (lib/map.js); the maps.html wiring is pinned by
// source assertions, repo convention (see map-legend-layers.test.mjs).
// Run: node test/maps-rest-layer.test.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const fs = require('node:fs');
let fails = 0;
const ok = (c, name) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name); if (!c) fails++; };

global.window = { HS: {} };
await import('../lib/templates.js').catch(() => {});   // statusHex, if load order provides it
await import('../lib/map.js');
const HS = global.window.HS;

// --- HS.restAfterLetters: everything visible minus the lettered set ---
const visible = [
  { id: 'a', name: 'A', lat: 30.1, lng: -97.6 },
  { id: 'b', name: 'B', lat: 30.2, lng: -97.5 },
  { id: 'c', name: 'C', lat: 30.3, lng: -97.4 },
  { id: 'area1', name: 'Area notice', lat: null, lng: null },      // area record: listed, never plotted
  { id: null, name: 'No id but placed', lat: 30.4, lng: -97.3 },   // keeps its point even without an id
];
const lettered = [{ id: 'b', _letter: 'A' }];
const rest = HS.restAfterLetters(visible, lettered);
ok(rest.length === 3, 'rest = visible minus lettered minus coordless (got ' + rest.length + ')');
ok(!rest.some(x => x.id === 'b'), 'a lettered record is not duplicated into the rest layer');
ok(!rest.some(x => x.id === 'area1'), 'a coordinate-less area record never enters the map layer');
ok(rest.some(x => x.id === null), 'an id-less record with real coords stays in the rest layer');
ok(HS.restAfterLetters(visible, []).length === 4, 'empty lettered set -> every placed record rides the rest layer');
ok(HS.restAfterLetters([], lettered).length === 0, 'empty visible set -> empty rest layer');

// --- COMPLETENESS invariant at dense-ZIP scale: lettered + rest covers every placed record ---
const dense = Array.from({ length: 3014 }, (_, i) => ({
  id: 'p' + i, name: 'Permit ' + i, type: 'permit', status: 'Proposed',
  lat: 30 + i * 1e-4, lng: -97 - i * 1e-4, distance_mi: i * 0.001,
}));
const let16 = HS.reserveFacilitySlots(dense, [], { cap: 16, floor: 4, letters: 'ABCDEFGHIJKLMNOP' });
const rest16 = HS.restAfterLetters(dense, let16);
ok(let16.length === 16, 'lettered set capped at 16 (presentation aid)');
ok(rest16.length === 3014 - 16, 'rest layer carries EVERY record beyond the letters (got ' + rest16.length + ')');
const union = new Set(let16.map(x => x.id).concat(rest16.map(x => x.id)));
ok(union.size === 3014, 'lettered ∪ rest = the complete visible set, no record lost (got ' + union.size + ')');

// --- HS.restFeatureCollection: GeoJSON for the GL clustered source ---
const fc = HS.restFeatureCollection([
  { id: 'x', name: 'Plant', type: 'permit', status: 'Proposed', lat: '30.5', lng: '-97.2' },
  { id: 'f', name: 'Fac', type: 'Regulated facility', lat: 30.6, lng: -97.1, _restFacility: true },
]);
ok(fc.type === 'FeatureCollection' && fc.features.length === 2, 'feature collection built 1:1');
ok(fc.features[0].geometry.coordinates[0] === -97.2 && typeof fc.features[0].geometry.coordinates[0] === 'number',
   'string coords coerced to numbers, [lng,lat] order');
ok(typeof fc.features[0].properties.col === 'string' && fc.features[0].properties.col.length > 0,
   'each point carries its resolved status color');
ok(fc.features[1].properties.fac === 1 && fc.features[0].properties.fac === 0,
   'facility rest points flagged for the facility-detail click dispatch');

// REMOVED 2026-09-04 with the retirement of the second map. Everything below this point
// read maps.html and pinned THAT page's GL clustered source, its Leaflet fallback, its
// "All records on file" list and its __HS_MAP totals hook. The page is now a redirect stub,
// so the assertions had no subject. The lib/map.js half above — restFeatureCollection's
// coordinate coercion, resolved colour and facility flagging — is untouched and still runs.

process.exit(fails ? 1 : 0);
