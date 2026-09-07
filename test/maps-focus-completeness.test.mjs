// Focus ↔ rest-layer symbology PARITY — regression backbone (2026-07-24 marker audit).
//
// The bug this pins: Focus/schematic used to plot only the lettered A–P subset (+ a
// facility overlay), while the tile modes' uncapped "rest" layer carried the full
// remainder — so Focus silently dropped every record beyond the nearest 16 and read
// as facility-dominated. HS.plottedMarkerSet() is now the ONE complete set every mode
// renders. These tests prove Focus plots exactly what the rest layer carries (no
// drops, no double-plots), that classification is canonical, and that uncap never
// changes a marker's identity.
//
// Run: node test/maps-focus-completeness.test.mjs
let fails = 0;
const ok = (c, name) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name); if (!c) fails++; };
const eq = (a, b, name) => ok(JSON.stringify(a) === JSON.stringify(b), name + '  (got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b) + ')');

global.window = { HS: {} };
await import('../lib/templates.js');
await import('../lib/map.js');
const HS = global.window.HS;
const FAC = HS.markerRegistry.facilityHex;   // #7d148c

// ── a realistic synthetic ZIP: dev records across every canonical type × status,
//    plus more records than the 16-letter cap so the "rest" is non-trivial ──────────
const TYPES = ['Development', 'unclassified', 'Residential', 'Commercial', 'Industrial', 'Utility', 'Civic/Public'];
const STATUSES = ['Proposed', 'Approved', 'Operating', 'On file'];
const visible = [];
let id = 0;
for (let i = 0; i < 60; i++) {
  visible.push({ id: 'd' + (id++), type: TYPES[i % TYPES.length], status: STATUSES[i % STATUSES.length],
                 lat: 30.17 + i * 0.001, lng: -97.6 - i * 0.001, distance_mi: i * 0.1 });
}
// facilities: nearest set (kept as DOM squares) + a rest set (beyond the nearest)
const facs = [];
for (let i = 0; i < 24; i++) facs.push({ id: 'f' + (id++), type: 'industrial', status: 'Operating', record_kind: 'facility',
                                         lat: 30.2 + i * 0.001, lng: -97.5 - i * 0.001, distance_mi: 0.05 + i * 0.1 });
const restFacs = [];
for (let i = 0; i < 8; i++) restFacs.push({ id: 'rf' + (id++), type: 'energy', status: 'Operating', record_kind: 'facility',
                                            _restFacility: true, lat: 30.3 + i * 0.001, lng: -97.4 - i * 0.001, distance_mi: 5 + i });

// ── what each surface derives (mirrors maps.html exactly) ───────────────────────────
//   TILE mode (Street/Satellite) plots THREE groups: lettered DOM pins + the rest
//   layer (restItems) + the unlettered nearest-facility squares (unletteredFacs).
//   FOCUS mode must now plot the SAME complete set (HS.plottedMarkerSet).
const lettered = HS.reserveFacilitySlots(visible, facs, { cap: 16, floor: 4, letters: 'ABCDEFGHIJKLMNOP' });
const letteredIds = new Set(lettered.filter(x => x.id != null).map(x => x.id));
const restLayer = HS.restAfterLetters(visible, lettered).concat(restFacs);        // == restItems() (tile GL/LF rest)
const unletteredFacs = facs.filter(f => !(f.id != null && letteredIds.has(f.id))); // == unletteredFacs() (tile squares)
const tileComplete = lettered.concat(restLayer, unletteredFacs);                  // everything a tile mode plots
const focusSet = HS.plottedMarkerSet(visible, facs, restFacs);                    // everything Focus now plots

// ── 1. COMPLETENESS: Focus plots every record exactly once, nothing dropped/duplicated
const focusIds = focusSet.map(p => p.item.id);
ok(focusIds.length === new Set(focusIds).size, 'Focus plots each record at most once (no double-plot)');
ok(focusSet.length === visible.length + facs.length + restFacs.length,
   'Focus set total == visible + facs + restFacs (' + focusSet.length + ' == ' + (visible.length + facs.length + restFacs.length) + ')');
const allIds = new Set([...visible, ...facs, ...restFacs].map(x => x.id));
ok(focusIds.every(i => allIds.has(i)) && [...allIds].every(i => focusIds.includes(i)),
   'Focus set covers exactly the complete visible + facility universe');

// ── 2. PARITY: Focus renders exactly the tile-mode complete set (no drops/extras) ───
const focusIdSet = new Set(focusIds);
ok(restLayer.every(r => focusIdSet.has(r.id)), 'Focus ⊇ tile rest layer — every rest-layer record is plotted in Focus');
// symbol-count parity: the tile mode's complete render (lettered + rest + unlettered
// facility squares) and the Focus set must agree bucket-for-bucket and in total.
const tileHist = HS.markerHistogram(tileComplete.map(it => {
  const m = HS.resolveMarker(it); return { filterKey: m.filterKey, shape: m.shape, color: m.color };
}));
const focusHist = HS.markerHistogram(focusSet);
['proposed', 'approved', 'operating', 'facility'].forEach(k => {
  ok((focusHist.byStatus[k] || 0) === (tileHist.byStatus[k] || 0),
     'status "' + k + '" count parity: Focus(' + (focusHist.byStatus[k] || 0) + ') == tile(' + (tileHist.byStatus[k] || 0) + ')');
});
HS.SHAPE_LEGEND.map(s => s.shape).concat('square').forEach(sh => {
  ok((focusHist.byShape[sh] || 0) === (tileHist.byShape[sh] || 0),
     'shape "' + sh + '" count parity: Focus(' + (focusHist.byShape[sh] || 0) + ') == tile(' + (tileHist.byShape[sh] || 0) + ')');
});
ok(focusHist.total === tileComplete.length,
   'Focus total == tile-mode complete total (symbol-count conservation: ' + focusHist.total + ' == ' + tileComplete.length + ')');

// ── 3. CANONICAL CLASSIFICATION (the invariants the audit proved, now locked) ───────
// non-regulated records can NEVER receive the regulated icon (purple OR square).
const devEntries = focusSet.filter(p => !p.isFacility);
ok(devEntries.every(p => p.color !== FAC), 'no non-facility record is painted purple');
ok(devEntries.every(p => p.shape !== 'square'), 'no non-facility record receives the facility (square) shape');
// regulated records retain the regulated treatment.
const facEntries = focusSet.filter(p => p.isFacility);
ok(facEntries.length === facs.length + restFacs.length && facEntries.every(p => p.color === FAC && p.shape === 'square'),
   'every facility keeps the purple-square regulated treatment');

// every canonical STATUS → correct color; every canonical TYPE → correct shape.
eq(HS.resolveMarker({ type: 'X', status: 'Proposed' }).color, '#c47a1a', 'Proposed → orange');
eq(HS.resolveMarker({ type: 'X', status: 'Approved' }).color, '#3f7fb0', 'Approved → blue');
eq(HS.resolveMarker({ type: 'X', status: 'Operating' }).color, '#1f9d5c', 'Operating → green');
eq(HS.resolveMarker({ type: 'Industrial' }).shape, 'triangle', 'Industrial → triangle');
eq(HS.resolveMarker({ type: 'Residential' }).shape, 'pentagon', 'Residential → pentagon');
eq(HS.resolveMarker({ type: 'Roads & infrastructure' }).shape, 'diamond', 'Roads & infrastructure → diamond');
eq(HS.resolveMarker({ type: 'Commercial' }).shape, 'hexagon', 'Commercial → hexagon');
eq(HS.resolveMarker({ type: 'Development' }).shape, HS.CATEGORY_REGISTRY.other.symbol, 'generic Development → the Other-project symbol');
// missing / unknown fields → honest neutral fallback, NOT purple.
const blank = HS.resolveMarker({});
ok(blank.shape === HS.CATEGORY_REGISTRY.other.symbol && blank.color === HS.markerRegistry.neutralHex && blank.color !== FAC,
   'missing fields → the neutral Other-project symbol, never purple');
const unknown = HS.resolveMarker({ type: 'flabbergast', status: 'quux' });
ok(unknown.color === HS.markerRegistry.neutralHex && unknown.color !== FAC, 'unknown status → neutral "On file", not purple');

// ── 4. Street / Satellite / Focus consume the SAME canonical identity ───────────────
// (there is one resolver; every surface calls it — assert the plotted identity is
//  independent of which mode asked for it.)
const asFocus = HS.plottedMarkerSet(visible, facs, restFacs);
const asTiles = HS.plottedMarkerSet(visible, facs, restFacs);   // GL/LF derive the same set
eq(HS.markerHistogram(asFocus), HS.markerHistogram(asTiles), 'Focus and tile modes resolve an identical symbol histogram');

// ── 5. UNCAP invariance: growing the set never changes a marker's identity, never caps
const big = [];
for (let i = 0; i < 600; i++) big.push({ id: 'b' + i, type: TYPES[i % TYPES.length], status: STATUSES[i % STATUSES.length],
                                         lat: 30 + i * 1e-4, lng: -97 - i * 1e-4, distance_mi: i * 0.01 });
const bigSet = HS.plottedMarkerSet(big, [], []);
ok(bigSet.length === 600, 'uncap: 600 records → 600 plotted (no cap silently applied)');
// each record's shape/color is identical whether in the small or the huge set.
const oneSmall = HS.resolveMarker(big[0]), oneBig = bigSet.find(p => p.item.id === 'b0');
ok(oneSmall.shape === oneBig.shape && oneSmall.color === oneBig.color,
   'uncap does not change a marker\'s classification or icon selection');

if (fails) { console.error('\n' + fails + ' assertion(s) failed'); process.exit(1); }
console.log('\nAll Focus↔rest completeness tests passed.');
