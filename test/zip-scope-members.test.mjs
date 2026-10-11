// Offline checks for WIDENED-ONLY POLYGON CONTAINMENT (sources/scope-members.ts) through the SHIPPED
// arcgis / socrata / csv connectors. No network, no database.
//
// The membership function here is a ray-casting STAND-IN for public.zip_scope_members; the real SQL is
// proven separately on a disposable PostGIS (test/zip_scope_members_pg). What THIS file proves is the
// connector contract around it: which records are tested, what is kept, what each counter means,
// and that nothing that cannot be KNOWN is ever claimed.
//
// The same implementation is driven for three ZIPs (Pilot Point 76258, Justin 76247, Aubrey 76227) and
// an irregular polygon; no ZIP appears in any business logic — only in the fixtures' bounds/centroids.
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(root, 'supabase/functions/get-address-report/sources');
let fails = 0;
const ok = (c, name, detail) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name + (!c && detail ? '\n     ' + detail : '')); if (!c) fails++; };

let sb, sm, arc, soc, csvm;
try {
  sb = await import(join(SRC, 'scope-box.ts')); sm = await import(join(SRC, 'scope-members.ts'));
  arc = await import(join(SRC, 'arcgis.ts')); soc = await import(join(SRC, 'socrata.ts')); csvm = await import(join(SRC, 'csv.ts'));
} catch (e) { console.log('FAIL — import (needs Node >= 22.18 type stripping)\n     ' + e.message); process.exit(1); }

// production canonical bounds + centroids (2026-10-10)
const Z = {
  '76258': { lat: 33.371, lng: -96.9446, xmin: -97.0372, ymin: 33.288322, xmax: -96.815242, ymax: 33.449421 },
  '76247': { lat: 33.0734, lng: -97.3093, xmin: -97.419356, ymin: 33.005089, xmax: -97.226825, ymax: 33.179387 },
  '76227': { lat: 33.292, lng: -96.9879, xmin: -97.123906, ymin: 33.188336, xmax: -96.863538, ymax: 33.357867 },
};
const R = 3;
const bounds = (z) => ({ xmin: Z[z].xmin, ymin: Z[z].ymin, xmax: Z[z].xmax, ymax: Z[z].ymax });
const cen = (z) => ({ lat: Z[z].lat, lng: Z[z].lng });

// An IRREGULAR polygon inside the bbox (an L with a notch), generated from the bounds alone.
function polyFor(z) {
  const b = bounds(z), w = b.xmax - b.xmin, h = b.ymax - b.ymin, X = (f) => b.xmin + w * f, Y = (f) => b.ymin + h * f;
  return [[X(0), Y(0)], [X(1), Y(0)], [X(1), Y(.45)], [X(.55), Y(.45)], [X(.55), Y(1)], [X(0), Y(1)]];   // (lng,lat) ring
}
const inRing = (ring, x, y) => { let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
  const [xi, yi] = ring[i], [xj, yj] = ring[j];
  if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; };
const memberFn = (z, log) => async (pts) => { log && log.push(pts.length); return pts.map(([lat, lng]) => inRing(polyFor(z), lng, lat) ? 'member' : 'outside'); };

// Fixture points for a ZIP: legacy (in square), widened-in (outside square, in polygon), widened-out (outside square, outside polygon, in bbox).
const dist = (z, x, y) => Math.hypot((x - Z[z].lng) * 69 * Math.cos(Z[z].lat * Math.PI / 180), (y - Z[z].lat) * 69);
const inCircle = (z, x, y) => dist(z, x, y) <= R;
function pointsFor(z, nLegacy, nIn, nOut, shape = 'square') {
  const b = bounds(z), sq = sb.centroidSquare(Z[z].lat, Z[z].lng, R), ring = polyFor(z);
  const legacyHit = (x, y) => shape === 'circle' ? inCircle(z, x, y) : sb.pointInBox(y, x, sq);
  const L = [], I = [], O = [];
  for (let i = 0; i <= 80; i++) for (let j = 0; j <= 80; j++) {
    const x = b.xmin + (b.xmax - b.xmin) * i / 80, y = b.ymin + (b.ymax - b.ymin) * j / 80;
    const d = dist(z, x, y);
    if (shape === 'circle' && d > R * 0.97 && d < R * 1.03) continue;   // ambiguous band: tolerance, not a fixture
    const inSq = shape === 'circle' ? d <= R * 0.97 : legacyHit(x, y), inPoly = inRing(ring, x, y);
    (inSq ? L : inPoly ? I : O).push([x, y]);
    // widened-only members need to be outside the square AND in the polygon
    if (!inSq && inPoly) { /* already in I */ }
  }
  const takeIn = I, takeOut = O;
  const pick = (a, n) => { if (a.length < n) throw new Error(`fixture short: need ${n}, have ${a.length}`); const out = []; for (let k = 0; k < n; k++) out.push(a[Math.floor(k * a.length / n)]); return out; };
  return { legacy: pick(L, nLegacy), widenedIn: pick(takeIn, nIn), widenedOut: pick(takeOut, nOut), sq };
}

const entry = {
  registry_id: 'fixture-radius', platform: 'arcgis', service_url: 'https://example.test/arcgis/rest/services/X/FeatureServer/0',
  dataset_url: 'https://example.test/r', coverage: [{ state: 'TX', county: 'Denton' }],
  column_map: { title: 'T', address: 'A', case_number: 'ID', status_raw: 'ST', type_source: 'T', file_date: 'D', lat: '__lat', lng: '__lng' },
  status_to_bucket: { approved: ['Approved'], proposed: [], operating: [], exclude: [] },
  spatial_zip_radius_mi: R, max_rows: 100,
};
const pid = (x, y) => 'P' + x.toFixed(6) + ':' + y.toFixed(6);
const feat = (x, y) => ({ attributes: { T: 'HOUSE', A: pid(x, y) + ' ST', ID: pid(x, y), ST: 'Approved', D: Date.UTC(2023, 0, 5) }, geometry: { x, y } });
const arcRun = async (z, pts, deps, over = {}) => {
  const rows = pts.map(([x, y]) => feat(x, y));
  const f = async (u) => {
    const q = new URL(String(u)); const g = (q.searchParams.get('geometry') || '').split(',').map(Number);
    const hit = rows.filter((r) => g.length === 4 ? r.geometry.x >= g[0] && r.geometry.y >= g[1] && r.geometry.x <= g[2] && r.geometry.y <= g[3] : true);
    const off = Number(q.searchParams.get('resultOffset') || 0), lim = Number(q.searchParams.get('resultRecordCount') || 1000);
    return { ok: true, status: 200, json: async () => ({ features: hit.slice(off, off + lim), exceededTransferLimit: off + lim < hit.length }) };
  };
  return arc.arcgisForZip(z, [{ state: 'TX', county: 'Denton' }], [{ ...entry, ...over }], { fetch: f, sleep: async () => {}, ...deps });
};
const rep = (o) => o.reports[0];
const ids = (o) => o.sites.map((s) => String(s.case_number)).sort();

// ── 1. the shared module ─────────────────────────────────────────────────────────────
console.log('1) scope-members.ts');
{
  const m = sm.newScopeMetrics();
  const rows = [{ c: { cls: 'legacy' } }, { c: { cls: 'widened', lat: 1, lng: 1 } }, { c: { cls: 'widened', lat: 2, lng: 2 } },
    { c: { cls: 'no_point' } }, { c: { cls: 'widened', lat: 3, lng: 3 } }, { c: { cls: 'widened', lat: 4, lng: 4 } }];
  const kept = await sm.keepMembers(rows, (r) => r.c, async () => ['member', 'outside', 'no_coordinates', 'not_measured'], m);
  ok(kept.length === 3 && kept[0] === rows[0] && kept[1] === rows[1] && kept[2] === rows[3], 'keeps legacy + no-point + members, in original order');
  ok(m.widened_candidates === 4 && m.members_recovered === 1 && m.outside_excluded === 1 && m.unresolved_excluded === 2 && m.no_point_kept === 1,
    'counters: 4 candidates = 1 recovered + 1 outside + 2 unresolved (+1 no-point kept)', JSON.stringify(m));
  let threw = null;
  try { await sm.keepMembers([{ c: { cls: 'widened', lat: 1, lng: 1 } }], (r) => r.c, async () => [], sm.newScopeMetrics()); } catch (e) { threw = e; }
  ok(threw instanceof sm.ScopeMembershipError && threw.reason === 'incomplete_answer', 'a short answer throws (never a partial result)');
  threw = null;
  try { await sm.keepMembers([{ c: { cls: 'widened', lat: 1, lng: 1 } }], (r) => r.c, async () => ['maybe'], sm.newScopeMetrics()); } catch (e) { threw = e; }
  ok(threw instanceof sm.ScopeMembershipError, 'an unknown verdict throws');
  const rpcOk = (data, error = null) => ({ rpc: async (fn, args) => { rpcOk.last = { fn, args }; return { data, error }; } });
  const fnA = sm.zipMembershipRpc(rpcOk([{ ord: 1, verdict: 'member' }, { ord: 2, verdict: 'outside' }]), '76258');
  ok(JSON.stringify(await fnA([[1, 2], [3, 4]])) === '["member","outside"]' && rpcOk.last.fn === 'zip_scope_members' && rpcOk.last.args.p_zip === '76258'
    && JSON.stringify(rpcOk.last.args.p_pts) === '[[1,2],[3,4]]', 'RPC adapter: calls zip_scope_members with [lat,lng] pairs and returns verdicts in order');
  for (const [label, db] of [['error', rpcOk(null, { message: 'boom' })], ['short', rpcOk([{ ord: 1, verdict: 'member' }])],
    ['out-of-order', rpcOk([{ ord: 2, verdict: 'member' }, { ord: 1, verdict: 'member' }])], ['bad verdict', rpcOk([{ ord: 1, verdict: 'x' }, { ord: 2, verdict: 'member' }])],
    ['non-array', rpcOk({})]]) {
    let t = null; try { await sm.zipMembershipRpc(db, '76258')([[1, 2], [3, 4]]); } catch (e) { t = e; }
    ok(t instanceof sm.ScopeMembershipError, `RPC adapter ${label} ⇒ ScopeMembershipError`);
  }
  ok(sm.widenedBounds(bounds('76258'), null) === null && sm.widenedBounds(null, async () => []) === null && sm.widenedBounds(bounds('76258'), async () => []) !== null,
    'the box is usable ONLY together with a membership function');
}

// ── 2. ArcGIS, driven for three ZIPs through the same implementation ──────────────────
for (const z of Object.keys(Z)) {
  console.log(`\n2) arcgis — ${z} (same code, different fixture)`);
  const P = pointsFor(z, 20, 12, 30);
  const all = [...P.widenedOut, ...P.legacy, ...P.widenedIn];
  const calls = [];
  const off = await arcRun(z, all, { zipCentroid: cen(z) });
  const on = await arcRun(z, all, { zipCentroid: cen(z), zipBounds: bounds(z), zipMembers: memberFn(z, calls) });
  const m = rep(on).scope_membership;
  ok(ids(off).length === 20, 'OFF: exactly the legacy-square records (unchanged behaviour)', String(ids(off).length));
  ok(rep(off).scope_membership === undefined && rep(off).scope_widened !== true, 'OFF: no scope accounting appears');
  ok(ids(on).length === 32, 'ON: legacy 20 + recovered members 12; the 30 outside-polygon records are excluded', String(ids(on).length));
  ok(off.sites.every((s) => ids(on).includes(String(s.case_number))), 'ON ⊇ OFF: every record the legacy scope returned is still returned');
  ok(m && m.widened_candidates === 42 && m.members_recovered === 12 && m.outside_excluded === 30 && m.unresolved_excluded === 0 && m.legacy_fallback === null,
    'metrics: 42 candidates = 12 recovered + 30 excluded', JSON.stringify(m));
  ok(rep(on).truncated_at_max_rows == null && rep(on).scope_fallback === undefined && !rep(on).quarantined.length,
    'correct exclusion raises NO truncation, NO fallback, NO quarantine');
  ok(calls.length === 1 && calls[0] === 42, `one batched call carries all 42 widened-only candidates (legacy rows are never tested): ${JSON.stringify(calls)}`);
  ok(rep(on).fetched === 32 && !JSON.stringify(rep(on)).includes('scope_widened_rows_dropped'), '`fetched` is the kept population; no "dropped" counter describes polygon exclusion');
}

// ── 3. capacity: excluded records must not consume the cap ────────────────────────────
console.log('\n3) row cap and pagination');
{
  const z = '76258', P = pointsFor(z, 0, 8, 60);
  const all = [...P.widenedOut, ...P.widenedIn];                    // 60 outsiders arrive FIRST
  const on = await arcRun(z, all, { zipCentroid: cen(z), zipBounds: bounds(z), zipMembers: memberFn(z), pageSize: 7 }, { max_rows: 30 });
  const naive = await arcRun(z, all, { zipCentroid: cen(z), pageSize: 7 }, { max_rows: 30, spatial_zip_radius_mi: 99 });
  ok(rep(naive).truncated_at_max_rows === 30, 'control: WITHOUT polygon filtering the same 68 widened rows would hit the cap of 30 and truncate');
  ok(ids(on).length === 8 && rep(on).truncated_at_max_rows == null, '60 outsiders ahead of 8 members with max_rows=30: all 8 members survive, not truncated', `${ids(on).length}`);
  ok(rep(on).scope_membership.members_recovered === 8 && rep(on).scope_membership.outside_excluded === 60 && rep(on).scope_membership.capacity_truncated === false,
    'capacity_truncated is false; exclusions are not capacity');
  // members alone overflow the cap ⇒ legacy fallback (cache-protecting), reported as capacity
  const P2 = pointsFor(z, 5, 30, 10);
  const ov = await arcRun(z, [...P2.widenedIn, ...P2.legacy, ...P2.widenedOut], { zipCentroid: cen(z), zipBounds: bounds(z), zipMembers: memberFn(z), pageSize: 9 }, { max_rows: 20 });
  ok(rep(ov).scope_fallback === 'legacy_after_overflow' && ids(ov).length === 5, 'kept rows (5 legacy + 30 members) overflow max_rows=20 ⇒ legacy result (5), reported');
  ok(rep(ov).scope_membership.capacity_truncated === true && rep(ov).scope_membership.legacy_fallback === 'capacity_overflow', 'metrics say capacity_overflow');
  ok(rep(ov).truncated_at_max_rows == null, 'the legacy result is complete for what it covers (not flagged truncated)');
  // scan limit: far more outsiders than 4 × max_rows ⇒ cannot test them all within bound ⇒ legacy
  const P3 = pointsFor(z, 3, 4, 60);
  const sc = await arcRun(z, [...P3.legacy, ...P3.widenedOut, ...P3.widenedIn], { zipCentroid: cen(z), zipBounds: bounds(z), zipMembers: memberFn(z), pageSize: 10 }, { max_rows: 10 });
  ok(rep(sc).scope_fallback === 'legacy_after_membership_error' && rep(sc).scope_membership.legacy_fallback === 'scan_limit' && ids(sc).length === 3,
    'scanned rows beyond SCAN_FACTOR × max_rows ⇒ legacy scope (3 legacy rows), reason scan_limit');
}

// ── 4. fail-safe: nothing unknown is ever claimed as recovered ────────────────────────
console.log('\n4) failures fall back to the legacy scope');
{
  const z = '76258', P = pointsFor(z, 6, 9, 11), all = [...P.widenedIn, ...P.legacy, ...P.widenedOut];
  const legacy = await arcRun(z, all, { zipCentroid: cen(z) });
  const boom = async () => { throw new Error('connection reset'); };
  const cases = {
    'RPC throws': boom,
    'RPC returns short': async (p) => p.slice(1).map(() => 'member'),
    'RPC returns unknown verdict': async (p) => p.map(() => 'banana'),
    'RPC returns non-array': async () => ({}),
  };
  for (const [label, fn] of Object.entries(cases)) {
    const o = await arcRun(z, all, { zipCentroid: cen(z), zipBounds: bounds(z), zipMembers: fn });
    ok(JSON.stringify(ids(o)) === JSON.stringify(ids(legacy)), `${label}: result is EXACTLY the legacy-scope result (${ids(o).length})`);
    ok(rep(o).scope_fallback === 'legacy_after_membership_error' && rep(o).scope_membership.legacy_fallback === 'membership_error' && rep(o).scope_membership.members_recovered === 0,
      `${label}: reported as a legacy fallback; zero recovery claimed`);
    ok(!rep(o).quarantined.some((q) => /^fetch failed:/.test(q.reason)), `${label}: NOT a "fetch failed:" (the source is healthy; the cache-protection guard must not fire)`);
    ok(rep(o).scope_membership.rpc_failures >= (label === 'RPC returns non-array' || label === 'RPC returns short' || label === 'RPC returns unknown verdict' || label === 'RPC throws' ? 1 : 0), `${label}: rpc_failures counted`);
  }
  const big = pointsFor(z, 2, 3, 4);
  ok(big.widenedIn.length === 3, 'fixture sanity');
  // unresolved verdicts are excluded, counted, and never recovered
  const un = await arcRun(z, all, { zipCentroid: cen(z), zipBounds: bounds(z), zipMembers: async (p) => p.map(() => 'no_coordinates') });
  ok(ids(un).length === 6 && rep(un).scope_membership.unresolved_excluded === 20 && rep(un).scope_membership.members_recovered === 0, 'all-unresolved ⇒ only legacy kept; 20 unresolved counted, none recovered');
  const nm = await arcRun(z, all, { zipCentroid: cen(z), zipBounds: bounds(z), zipMembers: async (p) => p.map(() => 'not_measured') });
  ok(ids(nm).length === 6, 'a ZIP whose boundary is not measured ⇒ legacy only');
  // box without a membership function ⇒ legacy (no unfiltered box ever)
  const urls = [];
  const nofn = await arcRun(z, all, { zipCentroid: cen(z), zipBounds: bounds(z), fetch: async (u) => { urls.push(String(u)); return { ok: true, status: 200, json: async () => ({ features: [] }) }; } });
  const g = new URL(urls[0]).searchParams.get('geometry').split(',').map(Number), sq = sb.centroidSquare(Z[z].lat, Z[z].lng, R);
  ok(Math.abs(g[0] - sq.xmin) < 1e-9 && Math.abs(g[3] - sq.ymax) < 1e-9, 'bounds without a membership function ⇒ the legacy square, not the box');
  // candidate limit
  const many = []; for (let i = 0; i < 10_050; i++) many.push(P.widenedOut[i % P.widenedOut.length]);
  const lim = await arcRun(z, [...P.legacy, ...many], { zipCentroid: cen(z), zipBounds: bounds(z), zipMembers: memberFn(z), pageSize: 1000 }, { max_rows: 20000 });
  ok(rep(lim).scope_membership.legacy_fallback === 'candidate_limit' && ids(lim).length === 6, 'more than MAX_WIDENED_CANDIDATES ⇒ legacy scope, reason candidate_limit');
}

// ── 5. legacy-included polygon features are never tested or dropped ───────────────────
console.log('\n5) polygon features that the legacy envelope already returned');
{
  const z = '76258', sq = sb.centroidSquare(Z[z].lat, Z[z].lng, R), b = bounds(z);
  // a big polygon feature: centroid far outside the square AND outside the ZIP polygon, but its extent overlaps the square
  const ring = [[sq.xmin - .08, sq.ymax - .01], [sq.xmin + .01, sq.ymax - .01], [sq.xmin + .01, sq.ymax + .12], [sq.xmin - .08, sq.ymax + .12], [sq.xmin - .08, sq.ymax - .01]];
  const f = { attributes: { T: 'PARCEL', A: '1 ST', ID: 'POLY1', ST: 'Approved', D: Date.UTC(2023, 0, 5) }, geometry: { rings: [ring] } };
  const calls = [];
  const o = await arc.arcgisForZip(z, [{ state: 'TX', county: 'Denton' }], [{ ...entry, column_map: { ...entry.column_map } }], {
    fetch: async () => ({ ok: true, status: 200, json: async () => ({ features: [f], exceededTransferLimit: false }) }), sleep: async () => {},
    zipCentroid: cen(z), zipBounds: b, zipMembers: memberFn(z, calls) });
  ok(ids(o).length === 1 && calls.length === 0 && rep(o).scope_membership.widened_candidates === 0, 'extent overlaps the legacy square ⇒ treated as legacy: kept, not sent to membership');
}

// ── 6. socrata ─────────────────────────────────────────────────────────────────────────
console.log('\n6) socrata');
{
  const z = '76258', P = pointsFor(z, 7, 5, 9, 'circle');
  const sEntry = {
    registry_id: 'fx-soc', platform: 'socrata', domain: 'data.example.test', dataset_id: 'abcd-1234', dataset_url: 'https://data.example.test/d/abcd-1234',
    coverage: [{ state: 'TX', county: 'Denton' }], spatial_zip_radius_mi: R, spatial_point_col: 'location', max_rows: 100,
    column_map: { title: 'T', address: 'A', case_number: 'ID', status_raw: 'ST', type_source: 'T', file_date: 'D', lat: 'lat', lng: 'lng' },
    status_to_bucket: { approved: ['Approved'], proposed: [], operating: [], exclude: [] },
  };
  const mkRows = (pts) => pts.map(([x, y], i) => ({ T: 'HOUSE', A: i + ' ST', ID: 'S' + i + ':' + x.toFixed(4), ST: 'Approved', D: '2023-01-05T00:00:00.000', lat: String(y), lng: String(x) }));
  const rows = mkRows([...P.widenedOut, ...P.legacy, ...P.widenedIn]);
  const go = (deps, over = {}) => soc.socrataForZip(z, [{ state: 'TX', county: 'Denton' }], [{ ...sEntry, ...over }],
    { fetch: async (u) => { const w = new URL(String(u)).searchParams.get('$where'); const box = /^within_box/.test(w);
        const hit = rows.filter((r) => box ? sb.pointInBox(+r.lat, +r.lng, sb.scopeBox(cen(z), R, bounds(z))) : inCircle(z, +r.lng, +r.lat));
        const q = new URL(String(u)).searchParams, off = Number(q.get('$offset') || 0), lim = Number(q.get('$limit') || 1000);
        return { ok: true, status: 200, json: async () => hit.slice(off, off + lim) }; }, sleep: async () => {}, ...deps });
  const off = await go({ zipCentroid: cen(z) });
  const calls = [];
  const on = await go({ zipCentroid: cen(z), zipBounds: bounds(z), zipMembers: memberFn(z, calls) });
  ok(off.sites.length === 7, 'OFF: legacy-circle records only', String(off.sites.length));
  ok(on.sites.length === 12 && rep(on).scope_membership.members_recovered === 5 && rep(on).scope_membership.outside_excluded === 9, 'ON: 7 legacy + 5 members; 9 outside-polygon excluded', JSON.stringify(rep(on).scope_membership));
  ok(rep(on).truncated_at_max_rows == null && !rep(on).quarantined.length, 'exclusion ⇒ no truncation / quarantine');
  const bad = await go({ zipCentroid: cen(z), zipBounds: bounds(z), zipMembers: async () => { throw new Error('x'); } });
  ok(bad.sites.length === 7 && rep(bad).scope_fallback === 'legacy_after_membership_error', 'RPC failure ⇒ the legacy-circle result (7)');
  const cap = await go({ zipCentroid: cen(z), zipBounds: bounds(z), zipMembers: memberFn(z), pageSize: 5 }, { max_rows: 10 });
  ok(cap.sites.length === 7 && rep(cap).scope_fallback === 'legacy_after_overflow', '7 legacy + 5 members = 12 > max_rows 10 ⇒ legacy fallback (7), reported');
  const cap2 = await go({ zipCentroid: cen(z), zipBounds: bounds(z), zipMembers: memberFn(z), pageSize: 5 }, { max_rows: 12 });
  ok(cap2.sites.length === 12 && rep(cap2).truncated_at_max_rows == null, 'exactly at the cap with 9 outsiders ahead: 12 kept, not truncated (outsiders do not consume capacity)');
}

// ── 7. csv ────────────────────────────────────────────────────────────────────────────
console.log('\n7) csv');
{
  const z = '76258', P = pointsFor(z, 6, 5, 8, 'circle');
  const cEntry = {
    registry_id: 'fx-csv', platform: 'csv', url: 'https://example.test/f.csv', dataset_url: 'https://example.test/d',
    coverage: [{ state: 'TX', county: 'Denton' }], spatial_zip_radius_mi: R, max_rows: 100,
    column_map: { title: 'T', address: 'A', case_number: 'ID', status_raw: 'ST', type_source: 'T', file_date: 'D', lat: 'LAT', lng: 'LNG' },
    status_to_bucket: { approved: ['Approved'], proposed: [], operating: [], exclude: [] },
  };
  const line = ([x, y], i) => `${i},HOUSE,${i} ST,Approved,2023-01-05,${y},${x}`;
  const text = (pts) => ['ID,T,A,ST,D,LAT,LNG', ...pts.map(line)].join('\n');
  const FILE = [...P.widenedOut, ...P.legacy, ...P.widenedIn];
  const go = (deps, over = {}) => csvm.csvForZip(z, [{ state: 'TX', county: 'Denton' }], [{ ...cEntry, ...over }],
    { fetch: async () => ({ ok: true, status: 200, text: async () => text(FILE), headers: new Headers() }), ...deps });
  const off = await go({ zipCentroid: cen(z) });
  const on = await go({ zipCentroid: cen(z), zipBounds: bounds(z), zipMembers: memberFn(z) });
  ok(rep(off).fetched === 6, 'OFF: 6 legacy rows');
  ok(rep(on).fetched === 11 && rep(on).scope_membership.members_recovered === 5 && rep(on).scope_membership.outside_excluded === 8, 'ON: 6 legacy + 5 members; 8 outside excluded', JSON.stringify(rep(on).scope_membership));
  ok(rep(on).truncated_at_max_rows == null && rep(on).scope_widened_rows_dropped === undefined && !rep(on).quarantined.length, 'exclusion is not a drop, not truncation, not a quarantine');
  const bad = await go({ zipCentroid: cen(z), zipBounds: bounds(z), zipMembers: async () => { throw new Error('x'); } });
  ok(rep(bad).fetched === 6 && rep(bad).scope_fallback === 'legacy_after_membership_error' && rep(bad).scope_membership.members_recovered === 0, 'RPC failure ⇒ legacy rows only, no recovery claimed');
  const capped = await go({ zipCentroid: cen(z), zipBounds: bounds(z), zipMembers: memberFn(z) }, { max_rows: 8 });
  ok(rep(capped).fetched === 11 && capped.sites.length === 8 && rep(capped).scope_widened_rows_dropped === 3 && rep(capped).scope_membership.capacity_truncated === true,
    'members beyond the cap ARE counted as capacity drops (3), legacy rows all kept; the 8 outsiders are not part of that count');
}

// ── 9. counts: the headline is the cached point-scope record count ───────────────────
console.log('\n9) counts and cross-ZIP publication');
{
  // `app_refresh_zip` writes the "Development projects" tile as _ndp = count(cached sites where relevance =
  // 'development' AND scope = 'point' AND record_url <> ''). It reads the CACHE, so it is exactly as honest as
  // the connector's output. Pilot Point proportions (259 widened-only outside the polygon, 124 inside).
  const z = '76258', P = pointsFor(z, 40, 124, 259);
  const all = [...P.widenedOut, ...P.legacy, ...P.widenedIn];
  const withUrl = (o) => o.sites.filter((s) => (s.record_url || s.url || '').trim() !== '' && s.scope === 'point').length;
  const off = await arcRun(z, all, { zipCentroid: cen(z) });
  const on = await arcRun(z, all, { zipCentroid: cen(z), zipBounds: bounds(z), zipMembers: memberFn(z) }, { max_rows: 5000 });
  const polyMembers = all.filter(([x, y]) => inRing(polyFor(z), x, y)).length;
  ok(withUrl(off) === 40, 'OFF: headline input = the 40 legacy records');
  ok(withUrl(on) === 40 + 124, `ON: headline input = 40 legacy + 124 recovered members = 164 (got ${withUrl(on)}); the 259 outside-polygon records contribute 0`);
  ok(rep(on).scope_membership.outside_excluded === 259, 'the 259 are accounted for as EXCLUDED, not lost');
  ok(withUrl(on) <= polyMembers + 40, 'headline input never exceeds (polygon members + legacy-scope records)');
  // neighbour ZIP: complement polygon over the same bbox. Each widened-only record is published by AT MOST one ZIP.
  const comp = async (pts) => pts.map(([lat, lng]) => inRing(polyFor(z), lng, lat) ? 'outside' : 'member');
  const nb = await arcRun(z, all, { zipCentroid: cen(z), zipBounds: bounds(z), zipMembers: comp }, { max_rows: 5000 });
  const legacyIds = new Set(ids(off));
  const wide = (o) => new Set(ids(o).filter((i) => !legacyIds.has(i)));
  const A = wide(on), B = wide(nb);
  ok(A.size === 124 && B.size === 259 && [...A].every((i) => !B.has(i)), 'a record in the neighbour polygon is published by the neighbour only (124 + 259, disjoint)');
  ok(A.size + B.size === 383, 'together they cover every widened-only record exactly once');
  // the RPC is parameterised by the REQUESTED zip, never by a record's own stated ZIP
  const seen = []; const spy = { rpc: async (fn, args) => { seen.push(args.p_zip); return { data: args.p_pts.map((_, i) => ({ ord: i + 1, verdict: 'member' })), error: null }; } };
  await arcRun(z, all, { zipCentroid: cen(z), zipBounds: bounds(z), zipMembers: sm.zipMembershipRpc(spy, '75009') }, { max_rows: 5000 });
  ok(seen.length > 0 && seen.every((x) => x === '75009'), 'membership is always asked of the ZIP being built (75009 here), never of a neighbour');
}

// ── 8. wiring: one authority, no ZIP in logic ──────────────────────────────────────────
console.log('\n8) wiring');
{
  const idx = readFileSync(join(root, 'supabase/functions/get-address-report/index.ts'), 'utf8');
  const zm = idx.slice(idx.indexOf('── ZIP MODE ──'), idx.indexOf('── ZIP MODE ──') + 40000);
  ok((zm.match(/zipMembers: scope\.bounds \? zipMembers : null/g) || []).length === 3, 'the three radius-capable connectors receive the membership function, and only with bounds');
  ok(/zipMembershipRpc\(supabase, zip\)/.test(zm), 'membership goes through the one RPC adapter');
  ok(!/zipMembers/.test(idx.slice(idx.indexOf('── ZIP MODE ──') + 40000)), 'ADDRESS mode never receives a membership function');
  const code = ['scope-members.ts', 'arcgis.ts', 'socrata.ts', 'csv.ts'].map((f) => readFileSync(join(SRC, f), 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')).join('\n');
  ok(!/7[0-9]{4}/.test(code.replace(/\d{5,}/g, (m) => m.length === 5 && /^7[0-9]{4}$/.test(m) ? m : '')), 'no ZIP literal in connector/membership code');
  ok(!/\bST_|geo\.zip|\bring\b/.test(readFileSync(join(SRC, 'scope-members.ts'), 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')), 'the TS module holds no geometry or membership rule');
}

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
