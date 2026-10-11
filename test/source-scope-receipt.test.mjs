// The SOURCE COMPLETION RECEIPT (sources/scope-receipt.ts) through the SHIPPED arcgis / socrata / csv connectors.
// A receipt is a POSITIVE statement of the scope a fetch ran under and whether it finished; it is never inferred from a
// missing failure. The same implementation is driven for three ZIPs; no ZIP appears in any business logic.
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(root, 'supabase/functions/get-address-report/sources');
let fails = 0;
const ok = (c, name, detail) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name + (!c && detail ? '\n     ' + detail : '')); if (!c) fails++; };
const sr = await import(join(SRC, 'scope-receipt.ts')), sb = await import(join(SRC, 'scope-box.ts'));
const arc = await import(join(SRC, 'arcgis.ts')), soc = await import(join(SRC, 'socrata.ts')), csvm = await import(join(SRC, 'csv.ts'));

const Z = {
  '76258': { lat: 33.371, lng: -96.9446, xmin: -97.0372, ymin: 33.288322, xmax: -96.815242, ymax: 33.449421 },
  '76247': { lat: 33.0734, lng: -97.3093, xmin: -97.419356, ymin: 33.005089, xmax: -97.226825, ymax: 33.179387 },
  '76227': { lat: 33.292, lng: -96.9879, xmin: -97.123906, ymin: 33.188336, xmax: -96.863538, ymax: 33.357867 },
};
const R = 3;
const GEO = (z) => 'ab' + z.padEnd(30, 'c');   // a stand-in 32-hex md5 of the polygon, per ZIP
const bounds = (z) => ({ xmin: Z[z].xmin, ymin: Z[z].ymin, xmax: Z[z].xmax, ymax: Z[z].ymax, geom_sig: GEO(z) });
const cen = (z) => ({ lat: Z[z].lat, lng: Z[z].lng });
const jit = (z) => { const sq = sb.centroidSquare(Z[z].lat, Z[z].lng, R), b = bounds(z); return { sq, b }; };
// a legacy point (inside the square) and widened points (inside the bbox, outside the square)
const legacyPts = (z, n) => { const { sq } = jit(z); return Array.from({ length: n }, (_, i) => [sq.xmin + (sq.xmax - sq.xmin) * (i + 1) / (n + 1), Z[z].lat]); };
const widenedPts = (z, n) => { const { sq, b } = jit(z); const out = [];
  for (let i = 0; i < 400 && out.length < n; i++) { const x = b.xmin + (b.xmax - b.xmin) * ((i * 37) % 97) / 97, y = b.ymin + (b.ymax - b.ymin) * ((i * 53) % 89) / 89;
    if (!sb.pointInBox(y, x, sq)) out.push([x, y]); } if (out.length < n) throw new Error('fixture short'); return out; };
const allMember = async (pts) => pts.map(() => 'member'), allOutside = async (pts) => pts.map(() => 'outside'), allUnresolved = async (pts) => pts.map(() => 'no_coordinates');
const boom = async () => { throw new Error('reset'); };

const aEntry = { registry_id: 'fx-arc', platform: 'arcgis', service_url: 'https://example.test/arcgis/rest/services/X/FeatureServer/0', dataset_url: 'https://example.test/r',
  coverage: [{ state: 'TX', county: 'Denton' }], column_map: { title: 'T', address: 'A', case_number: 'ID', status_raw: 'ST', type_source: 'T', file_date: 'D', lat: '__lat', lng: '__lng' },
  status_to_bucket: { approved: ['Approved'], proposed: [], operating: [], exclude: [] }, spatial_zip_radius_mi: R, max_rows: 100 };
const feat = (x, y) => ({ attributes: { T: 'HOUSE', A: 'a', ID: 'P' + x.toFixed(5) + y.toFixed(5), ST: 'Approved', D: Date.UTC(2023, 0, 5) }, geometry: { x, y } });
const arcRun = (z, pts, deps, over = {}) => {
  const rows = pts.map(([x, y]) => feat(x, y));
  const f = async (u) => { const q = new URL(String(u)); const g = (q.searchParams.get('geometry') || '').split(',').map(Number);
    const hit = rows.filter((r) => g.length === 4 ? r.geometry.x >= g[0] && r.geometry.y >= g[1] && r.geometry.x <= g[2] && r.geometry.y <= g[3] : true);
    const off = Number(q.searchParams.get('resultOffset') || 0), lim = Number(q.searchParams.get('resultRecordCount') || 1000);
    return { ok: true, status: 200, json: async () => ({ features: hit.slice(off, off + lim), exceededTransferLimit: off + lim < hit.length }) }; };
  return arc.arcgisForZip(z, [{ state: 'TX', county: 'Denton' }], [{ ...aEntry, ...over }], { fetch: f, sleep: async () => {}, ...deps });
};
const R0 = (o) => o.reports[0].scope_receipt;

console.log('1) the pure builder');
{
  const base = { requested: true, widens: true, widenedRan: true, fallback: null, truncatedAt: null, metrics: { unresolved_excluded: 0, rpc_failures: 0, capacity_truncated: false }, version: 'v2:x' };
  ok(JSON.stringify(sr.buildScopeReceipt(base)) === '{"scope":"expanded","version":"v2:x","complete":true}', 'a clean widened run is expanded + complete');
  ok(sr.buildScopeReceipt({ ...base, truncatedAt: 20 }).complete === false, 'truncation is incomplete');
  ok(sr.buildScopeReceipt({ ...base, metrics: { ...base.metrics, unresolved_excluded: 1 } }).complete === false, 'an unresolved membership test is incomplete');
  ok(sr.buildScopeReceipt({ ...base, metrics: { ...base.metrics, rpc_failures: 1 } }).complete === false, 'a failed membership call is incomplete');
  ok(sr.buildScopeReceipt({ ...base, metrics: { ...base.metrics, capacity_truncated: true } }).complete === false, 'capacity overflow is incomplete');
  ok(sr.buildScopeReceipt({ ...base, metrics: null }).complete === false, 'NO scope accounting ⇒ incomplete (never assumed complete)');
  const fb = sr.buildScopeReceipt({ ...base, fallback: 'legacy_after_membership_error' });
  ok(fb.scope === 'fallback' && fb.version === null && fb.complete === false, 'a fallback is a fallback, with no version');
  ok(sr.buildScopeReceipt({ ...base, requested: false }).scope === 'legacy' && sr.buildScopeReceipt({ ...base, widens: false }).scope === 'legacy', 'not requested / does not widen ⇒ legacy');
  const ENTRY = { registry_id: 'e1', platform: 'arcgis', dataset_url: 'https://x/y', extra_where: "A = 'b'", type_map: { A: 'Commercial' } };
  const v = (z, b, e = ENTRY) => sr.receiptVersion(cen(z), R, b, e);
  ok(v('76258', bounds('76258')) === v('76258', bounds('76258')) && v('76258', bounds('76258')) !== v('76258', { ...bounds('76258'), xmax: bounds('76258').xmax + 0.01 }), 'the version moves when the envelope moves, and only then');
  ok(v('76258', null) === null && sr.receiptVersion(null, R, bounds('76258'), ENTRY) === null, 'no bounds / no centroid ⇒ no version');
  ok(sr.scopeVersion(sb.scopeBox(cen('76258'), R, bounds('76258')), 3, 'g', 'c') !== sr.scopeVersion(sb.scopeBox(cen('76258'), R, bounds('76258')), 4, 'g', 'c'), 'the radius is part of the version');
  // ── NEW: the polygon's SHAPE and the source's configuration are part of the version ──
  const b0 = bounds('76258');
  ok(v('76258', { ...b0, geom_sig: 'f'.repeat(32) }) !== v('76258', b0), 'a polygon edit that keeps the SAME bounding box moves the version');
  ok(v('76258', { xmin: b0.xmin, ymin: b0.ymin, xmax: b0.xmax, ymax: b0.ymax }) === null, 'no polygon identity (older database) ⇒ no version ⇒ never READY');
  ok(v('76258', { ...b0, geom_sig: 'not-hex' }) === null, 'a malformed polygon identity is not accepted');
  ok(v('76258', b0, { ...ENTRY, extra_where: "A = 'c'" }) !== v('76258', b0), 'a changed query filter moves the version');
  ok(v('76258', b0, { ...ENTRY, type_map: { A: 'Industrial' } }) !== v('76258', b0), 'a changed eligibility/type mapping moves the version');
  ok(v('76258', b0, { ...ENTRY, dataset_url: 'https://x/z' }) !== v('76258', b0), 'a different endpoint/dataset moves the version');
  ok(v('76258', b0, { ...ENTRY, identity_fields: ['ID'] }) !== v('76258', b0), 'a changed identity mapping moves the version');
  ok(v('76258', b0, { ...ENTRY, new_unknown_key: 1 }) !== v('76258', b0), 'an UNKNOWN new registry key is material by default (a safe rebaseline, never a silent inherit)');
  ok(v('76258', b0, { ...ENTRY, _receipts: 'x', jurisdiction: 'Y', coverage: [{ state: 'TX' }], out_fields: 'A', page_size: 50, observed_types_unreviewed: [1] }) === v('76258', b0), 'audit notes, labels, coverage gating, projection and paging do NOT move it');
  ok(v('76258', b0, { type_map: { A: 'Commercial' }, extra_where: "A = 'b'", dataset_url: 'https://x/y', platform: 'arcgis', registry_id: 'e1' }) === v('76258', b0), 'key order never matters');
  ok(sr.fnv64('') === 'cbf29ce484222325' && sr.fnv64('a') === 'af63dc4c8601ec8c', 'the hash is the standard FNV-1a 64 (pinned, so it cannot drift between runtimes)');
  ok(sr.buildScopeReceipt({ requested: true, widens: true, widenedRan: true, fallback: null, truncatedAt: null, metrics: { unresolved_excluded: 0, rpc_failures: 0, capacity_truncated: false }, version: null }).complete === false, 'an expanded run whose version is unknown is never complete');
}

for (const z of Object.keys(Z)) {
  console.log(`\n2) arcgis — ${z}`);
  const L = legacyPts(z, 5), W = widenedPts(z, 6);
  const deps = (mem) => ({ zipCentroid: cen(z), zipBounds: bounds(z), zipMembers: mem });
  const e1 = await arcRun(z, [...L, ...W], deps(allMember));
  ok(R0(e1).scope === 'expanded' && R0(e1).complete === true && /^v2:/.test(R0(e1).version), 'members found ⇒ expanded, complete, versioned', JSON.stringify(R0(e1)));
  const e2 = await arcRun(z, [...L, ...W], deps(allOutside));
  ok(e2.sites.length === 5 && R0(e2).scope === 'expanded' && R0(e2).complete === true, 'EMPTY ring (every widened record outside the polygon) ⇒ still expanded + complete', JSON.stringify(R0(e2)));
  const e3 = await arcRun(z, L, deps(allMember));
  ok(R0(e3).scope === 'expanded' && R0(e3).complete === true && e3.sites.length === 5, 'NO widened candidates at all ⇒ still expanded + complete');
  ok(R0(e1).version === R0(e3).version, 'same ZIP, same scope ⇒ same version');
  const fb = await arcRun(z, [...L, ...W], deps(boom));
  ok(R0(fb).scope === 'fallback' && R0(fb).complete === false && R0(fb).version === null, 'membership error ⇒ fallback, incomplete');
  const un = await arcRun(z, [...L, ...W], deps(allUnresolved));
  ok(R0(un).scope === 'expanded' && R0(un).complete === false, 'unresolved verdicts ⇒ expanded but INCOMPLETE (a hidden member could appear later)');
  const off = await arcRun(z, [...L, ...W], { zipCentroid: cen(z) });
  ok(R0(off).scope === 'legacy' && R0(off).complete === true && R0(off).version === null, 'widening off ⇒ legacy');
  const trunc = await arcRun(z, [...L], { zipCentroid: cen(z) }, { max_rows: 3 });
  ok(R0(trunc).scope === 'legacy' && R0(trunc).complete === false, 'a capped legacy fetch is legacy + incomplete');
  const ov = await arcRun(z, [...L, ...W], deps(allMember), { max_rows: 8 });
  ok(R0(ov).scope === 'fallback' && R0(ov).complete === false, 'widened overflow ⇒ fallback, incomplete');
  const failed = await arc.arcgisForZip(z, [{ state: 'TX', county: 'Denton' }], [aEntry], { fetch: async () => { throw new Error('connection reset'); }, sleep: async () => {}, ...deps(allMember) });
  ok(failed.reports[0].scope_receipt === undefined && failed.reports[0].quarantined.some((q) => /^fetch failed:/.test(q.reason)), 'a FAILED fetch carries NO receipt (the SQL side records it as failed)');
  const moved = await arcRun(z, L, { zipCentroid: cen(z), zipBounds: { ...bounds(z), xmin: bounds(z).xmin - 0.01 }, zipMembers: allMember });
  ok(R0(moved).version !== R0(e3).version, 'a changed envelope ⇒ a different version');
}

console.log('\n3) csv (the connector that used to set scope_widened only when a ring record was KEPT)');
{
  const z = '76258', L = legacyPts(z, 4), W = widenedPts(z, 5);
  const cEntry = { registry_id: 'fx-csv', platform: 'csv', url: 'https://example.test/f.csv', dataset_url: 'https://example.test/d', coverage: [{ state: 'TX', county: 'Denton' }],
    spatial_zip_radius_mi: R, max_rows: 100, column_map: { title: 'T', address: 'A', case_number: 'ID', status_raw: 'ST', type_source: 'T', file_date: 'D', lat: 'LAT', lng: 'LNG' },
    status_to_bucket: { approved: ['Approved'], proposed: [], operating: [], exclude: [] } };
  const text = (pts) => ['ID,T,A,ST,D,LAT,LNG', ...pts.map(([x, y], i) => `${i},HOUSE,${i} ST,Approved,2023-01-05,${y},${x}`)].join('\n');
  const go = (pts, deps, over = {}) => csvm.csvForZip(z, [{ state: 'TX', county: 'Denton' }], [{ ...cEntry, ...over }],
    { fetch: async () => ({ ok: true, status: 200, text: async () => text(pts), headers: new Headers() }), ...deps });
  const d = (mem) => ({ zipCentroid: cen(z), zipBounds: bounds(z), zipMembers: mem });
  const r = (o) => o.reports[0].scope_receipt;
  const e1 = await go([...L, ...W], d(allMember));
  ok(r(e1).scope === 'expanded' && r(e1).complete === true && /^v2:/.test(r(e1).version), 'members found ⇒ expanded + complete');
  const e2 = await go([...L, ...W], d(allOutside));
  ok(e2.reports[0].scope_widened !== true && r(e2).scope === 'expanded' && r(e2).complete === true, 'EMPTY ring: scope_widened stays unset (nothing kept) but the RECEIPT still proves the expanded read', JSON.stringify(r(e2)));
  const e3 = await go(L, d(allMember));
  ok(r(e3).scope === 'expanded' && r(e3).complete === true, 'no box rows at all ⇒ expanded + complete');
  const fb = await go([...L, ...W], d(boom));
  ok(r(fb).scope === 'fallback' && r(fb).complete === false, 'membership error ⇒ fallback');
  const un = await go([...L, ...W], d(allUnresolved));
  ok(r(un).scope === 'expanded' && r(un).complete === false, 'unresolved ⇒ incomplete');
  const off = await go([...L, ...W], { zipCentroid: cen(z) });
  ok(r(off).scope === 'legacy', 'off ⇒ legacy');
  const capped = await go([...L, ...W], d(allMember), { max_rows: 6 });
  ok(r(capped).complete === false, 'a capped emit is never complete');
  const failed = await csvm.csvForZip(z, [{ state: 'TX', county: 'Denton' }], [{ ...cEntry, registry_id: 'fx-csv-failing', url: 'https://example.test/other-failing.csv' }], { fetch: async () => { throw new Error('boom'); }, ...d(allMember) });
  ok(failed.reports[0].scope_receipt === undefined, 'a failed fetch carries no receipt');
  const e1b = await go([...L, ...W], d(allMember));
  ok(r(e1).version === r(e1b).version, 'deterministic version');
}

console.log('\n4) socrata');
{
  const z = '76258';
  const sEntry = { registry_id: 'fx-soc', platform: 'socrata', domain: 'data.example.test', dataset_id: 'abcd-1234', dataset_url: 'https://data.example.test/d/abcd-1234',
    coverage: [{ state: 'TX', county: 'Denton' }], spatial_zip_radius_mi: R, spatial_point_col: 'location', max_rows: 100,
    column_map: { title: 'T', address: 'A', case_number: 'ID', status_raw: 'ST', type_source: 'T', file_date: 'D', lat: 'lat', lng: 'lng' },
    status_to_bucket: { approved: ['Approved'], proposed: [], operating: [], exclude: [] } };
  const go = (rows, deps) => soc.socrataForZip(z, [{ state: 'TX', county: 'Denton' }], [sEntry],
    { fetch: async (u) => { const q = new URL(String(u)).searchParams, off = Number(q.get('$offset') || 0), lim = Number(q.get('$limit') || 1000);
        return { ok: true, status: 200, json: async () => rows.slice(off, off + lim) }; }, sleep: async () => {}, ...deps });
  const mk = (pts) => pts.map(([x, y], i) => ({ T: 'HOUSE', A: i + ' ST', ID: 'S' + i + ':' + x.toFixed(4), ST: 'Approved', D: '2023-01-05T00:00:00.000', lat: String(y), lng: String(x) }));
  const d = (mem) => ({ zipCentroid: cen(z), zipBounds: bounds(z), zipMembers: mem });
  const r = (o) => o.reports[0].scope_receipt;
  const e0 = await go([], d(allMember));
  ok(r(e0).scope === 'expanded' && r(e0).complete === true, 'an expanded fetch that returns NOTHING is still a complete expanded read');
  const rowsAll = mk([...legacyPts(z, 3), ...widenedPts(z, 4)]);
  const fb = await go(rowsAll, d(boom));
  ok(r(fb).scope === 'fallback' && r(fb).complete === false, 'membership error ⇒ fallback');
  const off = await go([], { zipCentroid: cen(z) });
  ok(r(off).scope === 'legacy' && r(off).complete === true, 'off ⇒ legacy');
  const e1 = await go(rowsAll, d(allOutside));
  ok(r(e1).scope === 'expanded' && r(e1).complete === true, 'all candidates outside the polygon ⇒ expanded + complete (empty ring)');
}

console.log('\n5) structure');
{
  const code = (f) => readFileSync(join(SRC, f), 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const f of ['arcgis.ts', 'socrata.ts', 'csv.ts']) ok(/report\.scope_receipt\s*=/.test(code(f)) && /buildScopeReceipt\(/.test(code(f)), `${f} attaches the one shared receipt`);
  ok(!/7[0-9]{4}/.test(code('scope-receipt.ts')) && !/\b(arcgis|socrata|csv)\b/.test(code('scope-receipt.ts')), 'the receipt module names no ZIP and no connector');
}

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
