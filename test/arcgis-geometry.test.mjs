// Offline regression checks for the ArcGIS connector's NON-POINT geometry support
// (sources/arcgis.ts — `featurePoint` + the opt-in `return_centroid` query param).
// No network: the real connector module is imported and driven directly.
//
// WHY THIS EXISTS. Before this change the connector flattened ONLY point geometry
// (`f.geometry.x` / `f.geometry.y`), so every polygon and polyline layer produced records
// with no coordinates — listed but never pinned on any of the three map views. Nine
// workbook sources are polygon/polyline. The live probes that shaped the design (receipts
// in docs/source-registry.md "POLYGON / POLYLINE GEOMETRY PASS"):
//   • `returnCentroid=true` is HARD-REJECTED by a polyline layer — HTTP 200 carrying
//     {"error":{"code":400,…"Return geometry centroid is only supported on layer with
//     polygon geometry type."}} (txdot-projects-info-all). So the param can NEVER be sent
//     automatically for "not a point"; it is opt-in per registry entry.
//   • Six classic ArcGIS Server MapServer polygon layers SILENTLY IGNORE it (rings come
//     back, no `centroid` key), so the param alone would have pinned only 2 of the 9.
//   • Two hosted FeatureServers DO honor it, which is what lets these tests assert that
//     the locally-derived centroid reproduces the vendor's own value.
//
// The assertions below pin: point behavior is untouched; the server centroid wins when
// present; the shoelace centroid reproduces ArcGIS's own `returnCentroid` on a REAL
// committed feature; holes/multipart/degenerate/polyline cases behave; and a feature with
// no usable geometry yields no coordinates (the record stays area-scoped — never a
// fabricated pin).
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0;
const ok = (c, name, detail) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name + (!c && detail ? '\n     ' + detail : ''));
  if (!c) fails++;
};

// The connector is TypeScript. Node >= 22.18 strips types on import, so these checks run
// the SHIPPED code rather than a copy of it. On an older runtime we fail loudly instead of
// silently skipping — a green run must mean the assertions actually executed.
const SRC = join(root, 'supabase/functions/get-address-report/sources/arcgis.ts');
let featurePoint;
try {
  ({ featurePoint } = await import(SRC));
} catch (err) {
  console.log('FAIL — import sources/arcgis.ts (needs Node >= 22.18 type stripping)\n     ' + err.message);
  process.exit(1);
}
ok(typeof featurePoint === 'function', 'sources/arcgis.ts exports featurePoint');

// ── 1. POINT geometry — the pre-existing path, byte-for-byte unchanged ──────────
ok(JSON.stringify(featurePoint({ geometry: { x: -111.9, y: 40.7 } })) === JSON.stringify({ lng: -111.9, lat: 40.7 }),
  'point geometry {x,y} → {lng:x, lat:y} exactly as before');
ok(featurePoint({ geometry: { x: -111.9 } }) === null, 'a half-populated point yields no coordinates');
ok(featurePoint({ geometry: { x: 'a', y: 'b' } }) === null, 'non-numeric coordinates yield no coordinates');
ok(featurePoint({ geometry: { x: Number.NaN, y: 40 } }) === null, 'NaN coordinates yield no coordinates');
ok(featurePoint({ attributes: { A: 1 } }) === null,
  'a feature with NO geometry yields no coordinates (record stays area-scoped, never centre-pinned)');
ok(featurePoint({}) === null, 'an empty feature yields no coordinates');

// A point feature must NEVER be diverted to a derived value, even if one were offered.
ok(JSON.stringify(featurePoint({ geometry: { x: 1, y: 2 }, centroid: { x: 99, y: 99 } })) === JSON.stringify({ lng: 1, lat: 2 }),
  'point geometry OUTRANKS a server centroid — existing point sources cannot change behavior');

// ── 2. Server-supplied centroid (return_centroid honored) ──────────────────────
ok(JSON.stringify(featurePoint({ geometry: { rings: [[[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]]] }, centroid: { x: -115.15, y: 36.10 } }))
   === JSON.stringify({ lng: -115.15, lat: 36.10 }),
  "the server's own centroid is preferred over the locally derived one when present");

// ── 3. Derived polygon centroid vs ArcGIS's OWN value, on a REAL feature ────────
// fixtures/arcgis/polygon-centroid-sample.json is a live capture from the Douglas County
// (NV) major-projects FeatureServer — the rings AND the centroid ArcGIS returned for them.
// Stripping the centroid forces the local derivation and lets us compare the two directly.
const fx = JSON.parse(readFileSync(join(root, 'fixtures/arcgis/polygon-centroid-sample.json'), 'utf8'));
const real = fx.features[0];
ok(fx.geometryType === 'esriGeometryPolygon' && fx.spatialReference.wkid === 4326,
  'fixture is real polygon geometry in WGS84 (outSR=4326), as the connector requests');
ok(Array.isArray(real.geometry.rings) && real.geometry.rings[0].length === 52,
  'fixture carries the real 52-vertex ring');

const derived = featurePoint({ geometry: { rings: real.geometry.rings } });
const dx = Math.abs(derived.lng - real.centroid.x);
const dy = Math.abs(derived.lat - real.centroid.y);
// ~1e-5 degrees is ~1 m. The residual is planar-degree vs geodesic arithmetic, not a
// different quantity; a pin cannot resolve it. Anything beyond 1e-4 (~11 m) means the
// derivation drifted from what the vendor computes and must be investigated.
ok(dx < 1e-4 && dy < 1e-4,
  'derived shoelace centroid reproduces ArcGIS\'s own returnCentroid on the real feature',
  `dx=${dx} dy=${dy} derived=${JSON.stringify(derived)} server=${JSON.stringify(real.centroid)}`);

// ── 4. Polygon geometry — synthetic cases with known answers ───────────────────
const square = [[[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]]];
ok(JSON.stringify(featurePoint({ geometry: { rings: square } })) === JSON.stringify({ lng: 2, lat: 2 }),
  'a 4x4 square centroids at its exact centre (2,2)');

// A hole is wound the opposite way, so its signed area SUBTRACTS. Here the hole is
// centred in the right half, which must pull the centroid left of the outer centre.
const withHole = [
  [[0, 0], [8, 0], [8, 8], [0, 8], [0, 0]],
  [[5, 3], [5, 5], [7, 5], [7, 3], [5, 3]],
];
const holed = featurePoint({ geometry: { rings: withHole } });
ok(holed.lng < 4 && Math.abs(holed.lat - 4) < 1e-9,
  'a hole subtracts (opposite winding): the centroid shifts away from the hole, not toward it',
  JSON.stringify(holed));

// Two disjoint equal squares: the centroid sits midway between them.
const multipart = [
  [[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]],
  [[10, 0], [12, 0], [12, 2], [10, 2], [10, 0]],
];
const mp = featurePoint({ geometry: { rings: multipart } });
ok(Math.abs(mp.lng - 6) < 1e-9 && Math.abs(mp.lat - 1) < 1e-9,
  'a multipart polygon centroids between its parts (6,1)', JSON.stringify(mp));

// Winding direction must not flip the answer (signed area appears in numerator AND
// denominator) — a real layer may publish either winding.
const cw = [[[0, 0], [0, 4], [4, 4], [4, 0], [0, 0]]];
ok(JSON.stringify(featurePoint({ geometry: { rings: cw } })) === JSON.stringify({ lng: 2, lat: 2 }),
  'reversed winding gives the same centroid');

// Degenerate: a zero-area ring (all vertices collinear) has no centroid — fall back to the
// mean vertex rather than dividing by zero and emitting Infinity/NaN as a coordinate.
const collinear = [[[0, 0], [2, 2], [4, 4], [0, 0]]];
const deg = featurePoint({ geometry: { rings: collinear } });
ok(deg !== null && Number.isFinite(deg.lng) && Number.isFinite(deg.lat),
  'a zero-area (collinear) ring falls back to a finite mean vertex, never NaN/Infinity',
  JSON.stringify(deg));
ok(featurePoint({ geometry: { rings: [] } }) === null, 'an empty rings array yields no coordinates');
ok(featurePoint({ geometry: { rings: [[]] } }) === null, 'a rings array of empty rings yields no coordinates');

// ── 5. Polyline geometry — the point must lie ON the line, at half its length ───
const line = featurePoint({ geometry: { paths: [[[0, 0], [10, 0]]] } });
ok(JSON.stringify(line) === JSON.stringify({ lng: 5, lat: 0 }),
  'a straight 10-unit segment pins at its midpoint (5,0)');

// An L: total length 4 + 4 = 8, so the halfway point is at the corner (4,0).
const elbow = featurePoint({ geometry: { paths: [[[0, 0], [4, 0], [4, 4]]] } });
ok(Math.abs(elbow.lng - 4) < 1e-9 && Math.abs(elbow.lat - 0) < 1e-9,
  'a bent path pins at half its CUMULATIVE length, on the line (4,0)', JSON.stringify(elbow));

// Multipart polyline: the longest path wins, so the pin is on the real road segment
// rather than between two disconnected pieces (which would be off the line entirely).
const multiline = featurePoint({ geometry: { paths: [[[0, 0], [1, 0]], [[100, 50], [120, 50]]] } });
ok(Math.abs(multiline.lng - 110) < 1e-9 && Math.abs(multiline.lat - 50) < 1e-9,
  'a multipart polyline pins on the LONGEST path (110,50), never between the parts',
  JSON.stringify(multiline));

const zeroLen = featurePoint({ geometry: { paths: [[[7, 8], [7, 8]]] } });
ok(JSON.stringify(zeroLen) === JSON.stringify({ lng: 7, lat: 8 }),
  'a zero-length path falls back to its own vertex, never NaN');
ok(featurePoint({ geometry: { paths: [] } }) === null, 'an empty paths array yields no coordinates');
ok(featurePoint({ geometry: { paths: [[[1, 1]]] } }) === null,
  'a single-vertex path is not a line — no coordinates rather than a guess');

// ── 6. The query string: returnCentroid is opt-in and never leaks to other entries ──
const src = readFileSync(SRC, 'utf8');
ok(/if \(entry\.return_centroid\) url\.searchParams\.set\("returnCentroid", "true"\);/.test(src),
  'returnCentroid is set ONLY behind the entry-level return_centroid flag');
ok((src.match(/searchParams\.set\("returnCentroid"/g) || []).length === 1,
  'the connector sets returnCentroid in exactly ONE place — no unconditional second call');
ok(!/esriGeometryPoint/.test(src),
  'the connector never branches on geometryType — a polyline layer is never sent returnCentroid (it answers 400)');

// Every registry entry that opts in must be a polygon layer; none of the polyline or
// classic-MapServer entries may carry the flag (they 400 or silently ignore it).
const reg = JSON.parse(readFileSync(join(root, 'supabase/functions/get-address-report/jurisdiction-registry.json'), 'utf8'));
const optedIn = (reg.arcgis || []).filter((e) => e.return_centroid).map((e) => e.registry_id);
ok(!optedIn.includes('txdot-projects-info-all'),
  'the TxDOT POLYLINE entry does NOT set return_centroid (the server rejects it with a 400)');
for (const id of optedIn) {
  const e = reg.arcgis.find((x) => x.registry_id === id);
  ok(typeof e._receipts === 'string' && /centroid/i.test(e._receipts),
    `${id} opts into return_centroid and documents the live centroid receipt`);
}

if (fails) { console.error('\n' + fails + ' failed'); process.exit(1); }
console.log('\nAll arcgis-geometry assertions passed.');
