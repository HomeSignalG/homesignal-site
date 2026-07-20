// Canonical marker registry — unit tests for HS.resolveMarker (lib/map.js).
// Run: node test/map-markers.test.mjs
let fails = 0;
const ok = (c, name) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name); if (!c) fails++; };

global.window = { HS: {} };
await import('../lib/templates.js');
await import('../lib/map.js');
const HS = global.window.HS;

const CASES = [
  { label: 'Data Center / Proposed', item: { type: 'Data Center', status: 'Proposed' }, shape: 'square', color: '#c47a1a' },
  { label: 'Industrial / Active', item: { type: 'Industrial', status: 'Active' }, shape: 'triangle', color: '#1f9d5c' },
  { label: 'Residential / Active', item: { type: 'Residential', status: 'Active' }, shape: 'pentagon', color: '#1f9d5c' },
  { label: 'Infrastructure / Approved', item: { type: 'Infrastructure', status: 'Approved' }, shape: 'diamond', color: '#3f7fb0' },
  { label: 'Commercial / Proposed', item: { type: 'Commercial', status: 'Proposed' }, shape: 'hexagon', color: '#c47a1a' },
  { label: 'Unknown / On file', item: { type: 'Mystery', status: 'Pending review' }, shape: 'circle', color: '#6b7f76' },
  { label: 'Regulated facility / Operating', item: { type: 'Industrial', status: 'Operating', _facility: true }, shape: 'square', color: '#6f42c1', isFacility: true }
];

CASES.forEach(function (c) {
  const m = HS.resolveMarker(c.item);
  ok(m.shape === c.shape, c.label + ' shape → ' + c.shape + ' (got ' + m.shape + ')');
  ok(m.color === c.color, c.label + ' color → ' + c.color + ' (got ' + m.color + ')');
  if (c.isFacility) ok(m.isFacility === true && m.legendLabel === 'Regulated facility', c.label + ' facility flags');
});

// Regression: ordinary Industrial must never resolve to square.
const ind = HS.resolveMarker({ type: 'Industrial', status: 'Proposed' });
ok(ind.shape === 'triangle' && ind.shape !== 'square', 'Industrial never resolves to square');

// Regression: facility with Industrial type → purple square.
const fac = HS.resolveMarker({ type: 'Industrial', status: 'Operating', record_kind: 'facility' });
ok(fac.shape === 'square' && fac.color === '#6f42c1', 'facility Industrial → purple square');

// Collision cases — deliberate precedence.
ok(HS.resolveMarker({ type: 'Commercial Industrial Mixed-Use' }).shape === 'hexagon', 'Commercial Industrial Mixed-Use → hexagon (mixed-use)');
ok(HS.resolveMarker({ type: 'Mixed-Use Residential' }).shape === 'pentagon', 'Mixed-Use Residential → pentagon');
ok(HS.resolveMarker({ type: 'Water Treatment Plant' }).shape === 'diamond', 'Water Treatment Plant → diamond (not plant/industrial)');
ok(HS.resolveMarker({ type: 'School' }).shape === 'circle', 'School → circle');

// projectShape delegates to resolveMarker.
ok(HS.projectShape({ type: 'Industrial' }) === 'triangle', 'HS.projectShape delegates to resolveMarker');

// MapProvider.render uses resolveMarker (schematic path).
const el = { innerHTML: '' };
HS.MapProvider.render(el, {
  home: { lat: 30.17, lng: -97.61 },
  items: [
    { id: 'p1', name: 'Giga', type: 'Industrial', status: 'Active', lat: 30.18, lng: -97.60 },
    { id: 'f1', name: 'Plant', type: 'Industrial', status: 'Operating', _facility: true, lat: 30.19, lng: -97.59 }
  ],
  radiusMi: 1.5, showRadius: false, showHome: false, w: 400, h: 300
});
ok(el.innerHTML.indexOf('<polygon') !== -1, 'schematic Industrial pin renders polygon (triangle)');
const facMk = HS.resolveMarker({ type: 'Industrial', _facility: true, status: 'Operating' });
ok(facMk.shape === 'square' && facMk.color === '#6f42c1', 'schematic facility contract is purple square');

// Tracker lifecycle color mode (Approach B).
const site = { label: 'Permit', use_type: 'Industrial', type: 'proposed', layer: 'industrial' };
const tmk = HS.resolveTrackerMarker(site, function () { return ''; });
ok(tmk.shape === 'triangle' && tmk.color === HS.LIFECYCLE_HEX.proposed, 'tracker dev item: triangle + lifecycle proposed color');
const fsite = { label: 'EPA site', use_type: 'Industrial', type: 'built', layer: 'industrial', registry_id: 'TX123' };
const fmk = HS.resolveTrackerMarker(fsite, function (s) { return s.registry_id; });
ok(fmk.shape === 'square' && fmk.color === '#6f42c1', 'tracker EPA facility: purple square regardless of lifecycle');

if (fails) {
  console.error('\n' + fails + ' assertion(s) failed');
  process.exit(1);
}
console.log('\nAll map-markers tests passed.');
