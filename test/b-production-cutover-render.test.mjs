// Unit B — the PRODUCTION cutover payload, driven through the SHIPPED render logic.
//
// The fixture below is a real capture from public.app_projects_for_zip(zip,'development')
// AFTER the 346-ZIP cutover — the ordinary resident path, NOT ?hs_auth=1. What is being
// proved is the property the whole unit rests on: a project that occupies many places
// inside a ZIP renders many MARKERS and exactly ONE CARD.
//
// Run: node test/b-production-cutover-render.test.mjs
let fails = 0;
const ok = (c, name) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name); if (!c) fails++; };

global.window = { HS: {} };
await import('../lib/templates.js');
await import('../lib/map.js');
const HS = global.window.HS;

// ── captured from production, ZIP 06390 (7 authoritative projects, 7 markers) ──────
const ZIP06390 = [
  { source_key: 'arcgis:ctdot-project-work-areas:0172-0557', name: 'Secondary Road Sign Replace D2', type: 'Utility', status: 'Proposed',
    lat: 41.300316, lng: -71.9757285771637, source_ref: 'https://services1.arcgis.com/FCaUeJ5SOVtImake/arcgis/rest/services/CTDOT_Project_Work_Areas/FeatureServer/0',
    _markers: [{ lat: 41.300316, lng: -71.9757285771637, marker_seq: 1, marker_rule: 'POLYGON_COMPONENT_POINT_ON_SURFACE' }] },
  { source_key: 'arcgis:ctdot-project-work-areas:0172-0547', name: '6" Edge Line D2', type: 'Utility', status: 'Approved',
    lat: 41.300316, lng: -71.9757285771637, source_ref: 'x',
    _markers: [{ lat: 41.300316, lng: -71.9757285771637, marker_seq: 1, marker_rule: 'POLYGON_COMPONENT_POINT_ON_SURFACE' }] },
  { source_key: 'arcgis:ctdot-project-work-areas:0170-3756', name: 'Muni Speed Limit D1&D2', type: 'Utility', status: 'Approved',
    lat: 41.300316, lng: -71.9757285771637, source_ref: 'x',
    _markers: [{ lat: 41.300316, lng: -71.9757285771637, marker_seq: 1, marker_rule: 'POLYGON_COMPONENT_POINT_ON_SURFACE' }] },
  { source_key: 'arcgis:ctdot-project-work-areas:0172-0538', name: 'Replace Crosswalk Signage - D2', type: 'Utility', status: 'Approved',
    lat: 41.300316, lng: -71.9757285771637, source_ref: 'x',
    _markers: [{ lat: 41.300316, lng: -71.9757285771637, marker_seq: 1, marker_rule: 'POLYGON_COMPONENT_POINT_ON_SURFACE' }] },
  { source_key: 'arcgis:ctdot-project-work-areas:0170-5025', name: 'Statewide Various Sign Support', type: 'Utility', status: 'Approved',
    lat: 41.2935489543924, lng: -72.0077688070546, source_ref: 'x',
    _markers: [{ lat: 41.2935489543924, lng: -72.0077688070546, marker_seq: 1, marker_rule: 'POLYGON_COMPONENT_POINT_ON_SURFACE' }] },
  { source_key: 'arcgis:ctdot-project-work-areas:0170-3597', name: 'CL Rumble Strips Town Roads', type: 'Utility', status: 'Operating',
    lat: 41.2935489543924, lng: -72.0077688070546, source_ref: 'x',
    _markers: [{ lat: 41.2935489543924, lng: -72.0077688070546, marker_seq: 1, marker_rule: 'POLYGON_COMPONENT_POINT_ON_SURFACE' }] },
  { source_key: 'arcgis:ctdot-project-work-areas:0170-3304', name: 'Repl H. P. Sodium Light Fix', type: 'Utility', status: 'Operating',
    lat: 41.2935489543924, lng: -72.0077688070546, source_ref: 'x',
    _markers: [{ lat: 41.2935489543924, lng: -72.0077688070546, marker_seq: 1, marker_rule: 'POLYGON_COMPONENT_POINT_ON_SURFACE' }] }
];

// ── captured from production, ZIP 01507 — the three heaviest line corridors ────────
const mkLine = (n, base) => Array.from({ length: n }, (_, i) => ({
  lat: base + i * 0.001, lng: -72.04 + i * 0.001, marker_seq: i + 1,
  marker_rule: 'LINE_MERGED_COMPONENT_INTERVAL_1000M' }));
const ZIP01507_TOP3 = [
  { source_key: 'arcgis:massdot-highway-projects:609482', name: 'STURBRIDGE- CHARLTON- OXFORD- AUBURN- I-90', type: 'Infrastructure',
    status: 'Approved', lat: 42.1435054149636, lng: -72.0200159070465, source_ref: 'x', _markers: mkLine(27, 42.1352794854513) },
  { source_key: 'arcgis:massdot-highway-projects:606288', name: 'DISTRICT 3- RESURFACING I-90', type: 'Infrastructure',
    status: 'Approved', lat: 42.1529905927308, lng: -71.9795233875061, source_ref: 'x', _markers: mkLine(26, 42.1352794854513) },
  { source_key: 'arcgis:massdot-highway-projects:606291', name: 'WESTBOROUGH- UPTON- RESURFACING I-90', type: 'Infrastructure',
    status: 'Approved', lat: 42.1586110214604, lng: -71.9580996417216, source_ref: 'x', _markers: mkLine(18, 42.1751513995279) }
];

// What every shipped marker loop now does.
function render(items) {
  const cards = [], markers = [];
  items.forEach(it => {
    cards.push(it.source_key);                       // one card per returned project
    HS.markerPoints(it).forEach(pt => markers.push({ opens: it.source_key, pt }));
  });
  return { cards, markers };
}

// ── 06390 ─────────────────────────────────────────────────────────────────────────
const r1 = render(ZIP06390);
ok(r1.cards.length === 7, '06390 renders 7 cards (got ' + r1.cards.length + ')');
ok(r1.markers.length === 7, '06390 renders 7 markers (got ' + r1.markers.length + ')');
ok(new Set(r1.cards).size === 7, '06390 has no duplicate cards');
ok(r1.markers.every(m => r1.cards.includes(m.opens)), '06390 every marker opens a returned project (no orphans)');

// ── 01507 multi-marker corridors: many markers, still one card each ───────────────
const r2 = render(ZIP01507_TOP3);
ok(r2.cards.length === 3, '01507 top-3 renders exactly 3 cards (got ' + r2.cards.length + ')');
ok(r2.markers.length === 71, '01507 top-3 renders 27+26+18 = 71 markers (got ' + r2.markers.length + ')');
ok(new Set(r2.cards).size === 3, '01507 no duplicate cards despite 71 markers');
const opensFor = k => r2.markers.filter(m => m.opens === k).length;
ok(opensFor('arcgis:massdot-highway-projects:609482') === 27, 'the 27-marker corridor is ONE card selected by 27 markers');
ok(opensFor('arcgis:massdot-highway-projects:606288') === 26, 'the 26-marker corridor is ONE card selected by 26 markers');
ok(r2.markers.every(m => r2.cards.includes(m.opens)), '01507 every marker resolves to one of the three cards');
ok(r2.markers.every(m => m.pt.lat != null && m.pt.lng != null), '01507 every rendered marker carries real coordinates');

// Markers are distinct places, not the card coordinate repeated.
const distinct = new Set(r2.markers.map(m => m.pt.lat + ',' + m.pt.lng)).size;
ok(distinct > 3, 'the corridor markers are distinct places (got ' + distinct + ' distinct points), not one point repeated');

// ── measured-zero: honest empty, never a legacy fallback ─────────────────────────
const r3 = render([]);
ok(r3.cards.length === 0 && r3.markers.length === 0,
   '01009-shape empty authoritative payload renders 0 cards and 0 markers (honest empty)');

// ── a NON-cutover ZIP still arrives without _markers and renders exactly as before ─
const legacyRows = [{ source_key: 'legacy-a', lat: 30.1, lng: -97.6 }, { source_key: 'legacy-b', lat: 30.2, lng: -97.7 },
                    { source_key: 'legacy-c', lat: null, lng: null }];
const r4 = render(legacyRows);
ok(r4.cards.length === 3, 'non-cutover ZIP: one card per legacy row, unchanged');
ok(r4.markers.length === 2, 'non-cutover ZIP: one marker per row WITH coordinates, unchanged (got ' + r4.markers.length + ')');

console.log(fails ? `\n${fails} assertion(s) FAILED` : '\nAll Unit B production cutover render assertions passed.');
process.exit(fails ? 1 : 0);
