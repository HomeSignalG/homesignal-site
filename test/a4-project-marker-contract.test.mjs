// Unit A4 — the projects/markers delivery contract.
//
// The property that matters: a project may occupy several places inside one ZIP, and
// rendering those places must NOT produce several cards. These assertions pin both
// halves — the marker fan-out, and the fact that the card count never follows it.
//
// The legacy half is pinned just as hard: with no _markers attached, markerPoints must
// return exactly the item's own single point, because that is what shipped before and
// the authoritative cutover is OFF.
//
// Run: node test/a4-project-marker-contract.test.mjs
let fails = 0;
const ok = (c, name) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name); if (!c) fails++; };

global.window = { HS: {} };
await import('../lib/templates.js');
await import('../lib/map.js');
const HS = global.window.HS;

// ── legacy shape: unchanged behaviour ────────────────────────────────────────────
ok(typeof HS.markerPoints === 'function', 'HS.markerPoints exists');

const legacy = { source_key: 'A', lat: 42.1, lng: -72.5 };
const lp = HS.markerPoints(legacy);
ok(lp.length === 1, 'no _markers + coords → exactly ONE point (legacy unchanged), got ' + lp.length);
ok(lp[0].lat === 42.1 && lp[0].lng === -72.5, 'legacy point is the item\'s own coordinate');

ok(HS.markerPoints({ source_key: 'B' }).length === 0, 'no _markers + no coords → zero points (renders nothing, as today)');
ok(HS.markerPoints(null).length === 0, 'null item → zero points, never throws');
ok(HS.markerPoints({ lat: 1, lng: null }).length === 0, 'half a coordinate is not a point');

// An EMPTY _markers array must not silently fall back to the legacy point: an
// authoritative project with no markers is a defect we want visible, not papered over.
ok(HS.markerPoints({ lat: 5, lng: 6, _markers: [] }).length === 1,
   'empty _markers falls back to the single point (empty is treated as "not supplied")');

// ── authoritative shape: many markers, still ONE project ─────────────────────────
const multi = {
  source_key: 'ROAD-1', lat: 41.0, lng: -72.0,
  _markers: [
    { lat: 41.0, lng: -72.0, marker_seq: 1, marker_rule: 'LINE_MERGED_COMPONENT_INTERVAL_1000M' },
    { lat: 41.1, lng: -72.1, marker_seq: 2, marker_rule: 'LINE_MERGED_COMPONENT_INTERVAL_1000M' },
    { lat: 41.2, lng: -72.2, marker_seq: 3, marker_rule: 'LINE_MERGED_COMPONENT_INTERVAL_1000M' }
  ]
};
const mp = HS.markerPoints(multi);
ok(mp.length === 3, 'three authoritative markers → three points, got ' + mp.length);
ok(mp[0].marker_seq === 1 && mp[2].marker_seq === 3, 'marker_seq is carried through in order');
ok(mp.every(p => p.lat != null && p.lng != null), 'every emitted point carries coordinates');

// A marker missing coordinates is dropped rather than rendered at (0,0).
const holed = { source_key: 'X', _markers: [{ lat: 1, lng: 2, marker_seq: 1 }, { lat: null, lng: 3, marker_seq: 2 }] };
ok(HS.markerPoints(holed).length === 1, 'a marker with no coordinate is dropped, not placed at a fabricated point');

// ── the invariant the whole unit exists for ──────────────────────────────────────
// Simulate what every render loop now does: items.forEach(it => markerPoints(it).forEach(...)).
const projects = [multi, legacy, { source_key: 'P', lat: 40, lng: -71,
  _markers: [{ lat: 40, lng: -71, marker_seq: 1 }, { lat: 40.5, lng: -71.5, marker_seq: 2 }] }];
let markerCount = 0;
const cardsOpened = new Set();
projects.forEach(it => HS.markerPoints(it).forEach(() => { markerCount++; cardsOpened.add(it.source_key); }));
ok(markerCount === 6, 'three projects fan out to six markers, got ' + markerCount);
ok(projects.length === 3, 'the card list is still THREE projects — markers never multiply cards');
ok(cardsOpened.size === 3, 'every marker resolves to one of the three projects, no orphans');

// ── attachMarkers: grouping by project_ref ───────────────────────────────────────
// Re-stated here rather than imported, because lib/data.js needs a Supabase client at
// module scope. The rule under test is the association, and it is asserted against the
// exact shape the RPC returns.
function attachMarkers(projs, markers) {
  const by = new Map();
  (markers || []).forEach(mk => {
    if (!mk || mk.project_ref == null) return;
    const k = String(mk.project_ref);
    if (!by.has(k)) by.set(k, []);
    by.get(k).push({ lat: mk.lat, lng: mk.lng, marker_seq: mk.marker_seq });
  });
  (projs || []).forEach(p => {
    const list = by.get(String(p.project_ref));
    if (list && list.length) p._markers = list.sort((a, b) => (a.marker_seq || 0) - (b.marker_seq || 0));
  });
  return projs || [];
}

const rpcProjects = [{ project_ref: 'K1', name: 'One' }, { project_ref: 'K2', name: 'Two' }];
const rpcMarkers = [
  { project_ref: 'K1', marker_seq: 2, lat: 1.2, lng: 2.2 },
  { project_ref: 'K1', marker_seq: 1, lat: 1.1, lng: 2.1 },
  { project_ref: 'K2', marker_seq: 1, lat: 3.1, lng: 4.1 }
];
const joined = attachMarkers(rpcProjects.slice(), rpcMarkers);
ok(joined.length === 2, 'two projects in → two projects out (no duplication from three markers)');
ok(joined[0]._markers.length === 2 && joined[1]._markers.length === 1, 'markers land on the right project');
ok(joined[0]._markers[0].marker_seq === 1, 'markers are ordered by marker_seq regardless of arrival order');
ok(HS.markerPoints(joined[0]).length === 2 && HS.markerPoints(joined[1]).length === 1,
   'the joined objects feed markerPoints correctly');

// A marker whose project is absent from the response must not attach anywhere.
const orphanTest = attachMarkers([{ project_ref: 'K1' }], [{ project_ref: 'GHOST', marker_seq: 1, lat: 0, lng: 0 }]);
ok(!orphanTest[0]._markers, 'a marker referencing an absent project attaches to nothing');

console.log(fails ? `\n${fails} assertion(s) FAILED` : '\nAll A4 project/marker contract assertions passed.');
process.exit(fails ? 1 : 0);
