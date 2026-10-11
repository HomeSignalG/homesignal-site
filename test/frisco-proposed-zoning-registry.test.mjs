// Frisco "Proposed Zoning" (External_Planning_and_Zoning MapServer layer 5) — config-only registry entry `frisco-proposed-zoning`.
//
// Founder authorization 2026-10-11: prepare a DRAFT PR only. Standard shared pipeline, no Frisco-specific code. These checks drive the
// SHIPPED arcgis connector over a fixture of the real layer (fixtures/arcgis/frisco_proposed_zoning_layer5_2026-10-11.json: 20 features,
// 17 PROJECT_NO, staff fields removed, derived from the live probe of that day) and pin every constraint the authorization lists:
//   1 the entry's shape: staff fields projected out, no Type inferred, no recency_days on a string date, REVIEW COMPLETE bucketed nowhere
//   2 the fixture: 20 features / 17 projects, repeated project polygons, one null name, eTRAKiT links that match their project
//   3 the connector over it: identity is PROJECT_NO, unknown / blank / held statuses fail closed and are surfaced, nothing is "approved"
//   4 Type is never inferred (SUP / ZONING / project names) -> unclassified -> the report's "Impact not determined"
//   5 MM/DD/YYYY dates: parsed as an application date, malformed dates are dropped (never invented), never read as approval/construction
//   6 true-geometry edge distance vs centroid distance at the 0.5 mile line (JS mirror of ST_DWithin on the stored polygon)
//   7 rights: the id is NOT in report-rights.json and the generator's own tripwire (test/report-rights-r7.test.mjs) is red until R8
// Needs Node >= 22.18 (type stripping), like the other connector suites.
// Run: node test/frisco-proposed-zoning-registry.test.mjs
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0;
const ok = (c, name, detail) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name + (!c && detail !== undefined ? '\n     ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 500) : ''));
  if (!c) fails++;
};
const read = (p) => readFileSync(join(root, p), 'utf8');

const FN = 'supabase/functions/';
const { arcgisForZip } = await import(join(root, FN, 'get-address-report/sources/arcgis.ts'));
const { validateRights } = await import(join(root, FN, '_shared/national-report.ts'));
const registry = JSON.parse(read(FN + 'get-address-report/jurisdiction-registry.json'));
const rights = JSON.parse(read(FN + '_shared/report-rights.json'));
const fx = JSON.parse(read('fixtures/arcgis/frisco_proposed_zoning_layer5_2026-10-11.json'));
const entry = registry.arcgis.find((e) => e.registry_id === 'frisco-proposed-zoning');

const COLLIN = [{ state: 'TX', county: 'Collin' }];
const ZIP = '75034';
const deps = (doc, urls = []) => ({
  fetch: async (u) => { urls.push(String(u)); return new Response(JSON.stringify(doc), { status: 200, headers: { 'content-type': 'application/json' } }); },
  zipCentroid: { lat: 33.15, lng: -96.82 },
});
const run = async (doc = fx, e = entry, urls = []) => arcgisForZip(ZIP, COLLIN, [e], deps(doc, urls));
const withFeatures = (features) => ({ ...fx, features });
const feat = (over = {}, rings) => ({
  attributes: { OBJECTID: 900, PROJECT_NO: 'Z99-0001', Project_Type: 'ZONING', PROJECT_NAME: 'Test', Status: 'UNDER REVIEW', Applied_Date: '01/02/2026', Hyperlink: 'https://etrakit.friscotexas.gov/etrakit/Search/project.aspx?activityNo=Z99-0001', Type: 'Zoning: Under Review', ...over },
  geometry: { rings: rings ?? fx.features[0].geometry.rings },
});

// ── 0. controls: the instrument ran over what we think it did ────────────────────────────────────────────────────────────
ok(!!entry, '0a the entry exists in the registry');
ok(fx.features.length === 20 && new Set(fx.features.map((f) => f.attributes.PROJECT_NO)).size === 17, '0b (control) fixture is the live shape: 20 features / 17 PROJECT_NO');
ok(registry.arcgis.filter((e) => e.service_url === entry.service_url).length === 1, '0c service_url is unique in the registry (layer 5, not the permits layer 1)');
ok(entry.service_url.endsWith('/External_Planning_and_Zoning/MapServer/5') && entry.service_url !== registry.arcgis.find((e) => e.registry_id === 'frisco-active-building-permits').service_url, '0d it is layer 5 and a different dataset from frisco-active-building-permits');

// ── 1. the entry's shape ────────────────────────────────────────────────────────────────────────────────────────────────
ok(!entry.out_fields.some((f) => /planner|e_?mail/i.test(f)), '1a Planner and Planner_EMail are projected out (out_fields is an allow-list)', entry.out_fields);
ok(entry.out_fields.length > 0 && !entry.out_fields.includes('*') && !entry.out_fields.includes('DESCRIPTION'), '1b out_fields is explicit (never "*") and carries no free-text DESCRIPTION');
ok(!('type_map' in entry) && !('use_type_const' in entry) && !entry.column_map.type_source, '1c no type_map, no use_type_const, no type_source: no Type is asserted by configuration');
ok(!('recency_days' in entry), '1d no recency_days (Applied_Date is a STRING; the DATE literal would never match — frisco-active-building-permits standing answer)');
ok(entry.file_date_kind === 'filed', '1e Applied_Date is declared an application date (filed), never issued/decided');
ok(entry.column_map.case_number === 'PROJECT_NO' && !('identity_fields' in entry), '1f PROJECT_NO is the canonical project identity via case_number (the source_id fallback; no identity_fields override — only two audited entries may declare it)');
const buckets = entry.status_to_bucket;
const all = Object.values(buckets).flat();
ok(JSON.stringify(buckets.proposed) === '["UNDER REVIEW","REVISE AND RESUBMIT"]' && !all.includes('REVIEW COMPLETE'), '1g only the two verified-active statuses are Proposed; REVIEW COMPLETE is in no bucket');
ok(buckets.approved.length === 0 && buckets.operating.length === 0 && !buckets.denied?.length && !buckets.withdrawn?.length, '1h nothing is Approved/Operating/denied/withdrawn by configuration');
ok(entry.status_unresolved?.[0]?.value === 'REVIEW COMPLETE', '1i REVIEW COMPLETE is recorded as a human-reviewed unresolved status');
ok(!('extra_where' in entry), '1j no per-record exclusion hack (SUP26-0009 is documented, not special-cased)');
ok(entry.record_url_precision === 'record' && entry.column_map.record_url === 'Hyperlink', '1k record_url is the per-project eTRAKiT link');
ok(JSON.stringify(entry.coverage) === JSON.stringify([{ state: 'TX', county: 'Collin' }, { state: 'TX', county: 'Denton' }]), '1l coverage: Collin + Denton (the city straddles both; permits-layer precedent)');
ok(/PROVISIONAL/.test(entry._receipts) && /SUP26-0009/.test(entry._receipts) && /NOT rights-cleared/.test(entry._receipts), '1m the receipts name the provisional mapping, the withdrawn-reference case and the rights hold');

// ── 2. the fixture: repeated polygons, null name, links ──────────────────────────────────────────────────────────────────
{
  const by = new Map();
  for (const f of fx.features) by.set(f.attributes.PROJECT_NO, (by.get(f.attributes.PROJECT_NO) ?? 0) + 1);
  ok(by.get('SUP26-0007') === 3 && by.get('Z26-0009') === 2 && [...by.values()].filter((n) => n > 1).length === 2, '2a (control) the repeated-polygon projects are SUP26-0007 x3 and Z26-0009 x2');
  ok(fx.features.filter((f) => f.attributes.PROJECT_NAME == null).length === 1, '2b (control) exactly one null PROJECT_NAME (Z26-0010)');
  const bad = fx.features.filter((f) => {
    const u = new URL(f.attributes.Hyperlink);
    return u.protocol !== 'https:' || u.hostname !== 'etrakit.friscotexas.gov' || u.searchParams.get('activityNo') !== f.attributes.PROJECT_NO;
  });
  ok(bad.length === 0, '2c every Hyperlink is https on etrakit.friscotexas.gov and its activityNo equals its PROJECT_NO (no invalid/incomplete/mismatched link)', bad.map((f) => f.attributes.PROJECT_NO));
  const dupLinks = [...new Set(fx.features.map((f) => f.attributes.Hyperlink))];
  ok(dupLinks.length === 17, '2d repeated links are exactly the repeated polygons: 20 features, 17 distinct links');
  ok(fx.features.every((f) => !('Planner' in f.attributes) && !('Planner_EMail' in f.attributes)), '2e the fixture itself carries no staff fields');
  ok(!/@/.test(JSON.stringify(fx)), '2f no e-mail address anywhere in the fixture');
}

// ── 3. the connector over the fixture ───────────────────────────────────────────────────────────────────────────────────
const urls = [];
const base = await run(fx, entry, urls);
const rep = base.reports[0];
{
  const q = decodeURIComponent(urls[0]);
  ok(urls.length === 1 && /outFields=OBJECTID,PROJECT_NO,Project_Type,PROJECT_NAME,Status,Applied_Date,Hyperlink/.test(q), '3a the request asks for exactly the allow-listed columns', q);
  ok(!/planner|email|outFields=\*/i.test(q), '3b the request never names Planner / Planner_EMail and never asks for "*"');
  ok(rep.fetched === 20 && rep.emitted === 19, '3c fetched 20, emitted 19 (REVIEW COMPLETE held)', { fetched: rep.fetched, emitted: rep.emitted });
  ok(base.sites.every((s) => s.bucket === 'proposed' && s.type === 'proposed' && s.decided === false && s.decision == null), '3d every emitted record is Proposed and undecided');
  ok(!base.sites.some((s) => s.case_number === 'Z25-0009'), '3e REVIEW COMPLETE (Z25-0009) is not published as Proposed or Approved');
  ok(JSON.stringify(rep.unmapped_statuses) === JSON.stringify([{ status: 'REVIEW COMPLETE', count: 1, sample: 'Z25-0009' }]), '3f ...and it is SURFACED (unmapped_statuses names it), not silently dropped', rep.unmapped_statuses);
  ok(rep.quarantined.length === 0 && rep.blank_status === 0 && rep.geocode_failures === 0, '3g nothing quarantined, no blank status, no geocode needed (geometry-derived points)');
  const ids = base.sites.map((s) => s.source_id);
  ok(new Set(ids).size === 16 && ids.length === 19, '3h identity is PROJECT_NO: 19 polygon rows -> 16 distinct source_ids (no duplicate PROJECTS)', [new Set(ids).size, ids.length]);
  const mult = ids.filter((i) => i.endsWith(':SUP26-0007')).length;
  ok(mult === 3 && ids.filter((i) => i.endsWith(':Z26-0009')).length === 2, '3i the repeated polygons share ONE source_id each (the N5 multi-feature path owns the geometry)');
  ok(ids.every((i) => /^arcgis:frisco-proposed-zoning:(SUP|Z)\d\d-\d{4}$/.test(i)), '3j source_id = arcgis:<registry_id>:<PROJECT_NO>');
  const nullName = base.sites.find((s) => s.case_number === 'Z26-0010');
  ok(nullName && nullName.title === 'Z26-0010' && nullName.label === 'Z26-0010', '3k a null PROJECT_NAME falls back to the project number (never "null"/empty)', nullName?.title);
  ok(base.sites.every((s) => s.record_url && s.record_url_precision === 'record' && s.record_url.includes('activityNo=' + s.case_number)), '3l every record carries its own per-project eTRAKiT record_url');
  ok(base.sites.every((s) => s.address == null), '3m no address is invented (the layer states none)');
  const blob = JSON.stringify(base);
  ok(!/planner|@friscotexas|@/i.test(blob), '3n nothing in the output (sites or run report) names a staff member or an e-mail address');
  const sup9 = base.sites.find((s) => s.case_number === 'SUP26-0009');
  ok(sup9 && /Withdrawn as SUP25-0008/.test(sup9.title) && sup9.bucket === 'proposed' && sup9.decision == null, '3o SUP26-0009 keeps the publisher\'s own words and is NOT turned into a withdrawal or exclusion by inference (open decision)');
}

// ── 3b. unknown / blank / hostile statuses fail closed ──────────────────────────────────────────────────────────────────
{
  const r = await run(withFeatures([
    feat({ PROJECT_NO: 'Z99-0001', Status: 'SOMETHING NEW' }),
    feat({ PROJECT_NO: 'Z99-0002', Status: '' }),
    feat({ PROJECT_NO: 'Z99-0003', Status: null }),
    feat({ PROJECT_NO: 'Z99-0004', Status: 'APPROVED' }),
    feat({ PROJECT_NO: 'Z99-0005', Status: 'under review' }),
    feat({ PROJECT_NO: 'Z99-0006', Status: 'UNDER REVIEW' }),
  ]));
  const pub = r.sites.map((s) => s.case_number).sort();
  ok(!pub.includes('Z99-0001') && !pub.includes('Z99-0004'), '3p an unknown status, and even the word APPROVED, are NOT published (nothing outside the two mapped statuses is Proposed)', pub);
  ok(r.reports[0].blank_status === 2, '3q empty and null statuses are counted as blank and dropped', r.reports[0].blank_status);
  const um = r.reports[0].unmapped_statuses.map((u) => u.status).sort();
  ok(um.includes('SOMETHING NEW') && um.includes('APPROVED'), '3r unknown statuses are surfaced for a human', um);
  ok(pub.includes('Z99-0006'), '3s (control) the mapped status still publishes in the same run');
}

// ── 4. Type is never inferred ───────────────────────────────────────────────────────────────────────────────────────────
{
  ok(base.sites.every((s) => s.use_type === 'unclassified' && s.type_raw == null), '4a every record is unclassified with no type_raw: SUP/ZONING is a PROCESS kind, not a land use');
  const wanted = ['Z26-0011', 'SUP26-0005', 'SUP26-0007', 'Z26-0002', 'Z25-0011', 'SUP26-0006'];
  const names = wanted.map((n) => base.sites.find((s) => s.case_number === n));
  ok(names.every((s) => s && s.use_type === 'unclassified'),
    '4b names that LOOK like a land use ("AG to SF-7", "Child-Care", "Monopole", "Townhome", "Hospitality Resort") are never turned into a Type', names.map((s) => s?.title));
  const t = await run(withFeatures([feat({ Project_Type: 'SUP', Type: 'Residential' }), feat({ PROJECT_NO: 'Z99-0002', Project_Type: 'ZONING', Type: 'Industrial', PROJECT_NAME: 'Data Center' })]));
  ok(t.sites.length === 2 && t.sites.every((s) => s.use_type === 'unclassified'), '4c even a Type column that SAYS Residential/Industrial and a "Data Center" name change nothing: the column is not mapped, the name is not a classifier');
}

// ── 5. dates ────────────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const d = Object.fromEntries(base.sites.map((s) => [s.case_number + ':' + s.file_date, s.file_date]));
  ok(base.sites.find((s) => s.case_number === 'SUP25-0005').file_date === '2025-09-29', '5a MM/DD/YYYY parses month-first (09/29/2025 -> 2025-09-29)');
  ok(base.sites.find((s) => s.case_number === 'Z25-0007').file_date === '2026-09-14', '5b 09/14/2026 -> 2026-09-14 (a 2025 case number with a 2026 date is the LATEST submittal)');
  ok(base.sites.every((s) => s.file_date_kind === 'filed' && s.decision_date == null), '5c every date is a FILED date; no decision_date is ever set (never approval or construction commencement)');
  ok(base.sites.every((s) => /^\d{4}-\d{2}-\d{2}$/.test(s.file_date)), '5d every fixture date parsed');
  const r = await run(withFeatures([feat({ PROJECT_NO: 'Z99-0001', Applied_Date: '31/31/2026' }), feat({ PROJECT_NO: 'Z99-0002', Applied_Date: '' }), feat({ PROJECT_NO: 'Z99-0003', Applied_Date: 'not a date' }), feat({ PROJECT_NO: 'Z99-0004', Applied_Date: '02/30/2026' })]));
  const fd = Object.fromEntries(r.sites.map((s) => [s.case_number, s.file_date]));
  ok(r.sites.length === 4 && fd['Z99-0002'] == null && fd['Z99-0003'] == null, '5e an empty or non-date value is dropped to null, never guessed — and the record still publishes', fd);
  // FINDING (shared, not Frisco-specific, NOT fixed here — sources/arcgis.ts is owned by other open work): the shared isoDay() re-orders
  // M/D/YYYY WITHOUT calendar validation, so an impossible date comes through as an impossible ISO-shaped string. The paid report's validDay()
  // (round-trip through Date) refuses it, so it is never shown as a real date. Pinned in BOTH directions so a fix to isoDay has to update this.
  const roundTrips = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && (() => { const d = new Date(v + 'T00:00:00Z'); return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v; })();
  ok((fd['Z99-0001'] == null || !roundTrips(fd['Z99-0001'])) && (fd['Z99-0004'] == null || !roundTrips(fd['Z99-0004'])),
    '5f an impossible calendar date (31/31, Feb 30) is not a REAL date downstream: it either drops here or fails the report\'s validDay round-trip', fd);
  ok(fd['Z99-0001'] === '2026-31-31' && fd['Z99-0004'] === '2026-02-30', '5g (known shared leniency, documented) isoDay passes the impossible dates through as strings today — if this goes red the connector was fixed: update 5f/5g', fd);
}

// ── 6. true polygon edge distance vs centroid ──────────────────────────────────────────────────────────────────────────
// JS mirror of what geo.n5_projects_within_radius does with ST_DWithin on the stored true geometry (the SQL is covered by
// test/n5_spatial_pg and test/n5-spatial-read-rpc.test.mjs; this file proves the connector hands N5 a polygon whose EDGE, not centroid, matters).
const MI = 3958.7613;
const toRad = (d) => (d * Math.PI) / 180;
const proj = (lat0) => ([lng, lat]) => [toRad(lng) * Math.cos(toRad(lat0)) * MI, toRad(lat) * MI];
function segDist(p, a, b) {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const t = dx === 0 && dy === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}
function inside(p, ring) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    if ((ring[i][1] > p[1]) !== (ring[j][1] > p[1]) && p[0] < ((ring[j][0] - ring[i][0]) * (p[1] - ring[i][1])) / (ring[j][1] - ring[i][1]) + ring[i][0]) c = !c;
  }
  return c;
}
const edgeMi = (pt, ring) => {
  const pr = proj(pt[1]); const P = pr(pt); const R = ring.map(pr);
  if (inside(P, R)) return 0;
  let m = Infinity;
  for (let i = 0; i < R.length - 1; i++) m = Math.min(m, segDist(P, R[i], R[i + 1]));
  return m;
};
const dist = (a, b) => { const pr = proj(a[1]); const A = pr(a), B = pr(b); return Math.hypot(A[0] - B[0], A[1] - B[1]); };
{
  const polys = fx.features.map((f) => ({ no: f.attributes.PROJECT_NO, ring: f.geometry.rings[0] }));
  const siteFor = new Map(base.sites.map((s) => [s.case_number + '|' + s.lat.toFixed(5), s]));
  // the connector's pin is the polygon's own centroid, not an edge
  let centroidOK = 0;
  for (const p of polys) {
    const hit = base.sites.filter((s) => s.case_number === p.no).some((s) => edgeMi([s.lng, s.lat], p.ring) < 0.5);
    if (p.no === 'Z25-0009' || hit) centroidOK++;
  }
  ok(centroidOK === polys.length, '6a (control) every published pin is on/near its own polygon', centroidOK);
  // find the largest polygon the layer holds and walk outward from its farthest vertex
  const withReach = polys.map((p) => {
    const s = base.sites.find((x) => x.case_number === p.no && edgeMi([x.lng, x.lat], p.ring) < 0.5);
    if (!s) return null;
    const c = [s.lng, s.lat];
    const far = p.ring.reduce((best, v) => (dist(c, v) > dist(c, best) ? v : best), p.ring[0]);
    return { p, c, far, r: dist(c, far) };
  }).filter(Boolean).sort((a, b) => b.r - a.r);
  const big = withReach[0];
  ok(big && big.r > 0.05, '6b (control) the layer holds a polygon with a real extent (> 0.05 mi from its pin to its far corner)', big && big.r);
  const outward = (miles) => {
    const pr = proj(big.c[1]); const C = pr(big.c), F = pr(big.far);
    const u = [(F[0] - C[0]) / big.r, (F[1] - C[1]) / big.r];
    const P = [F[0] + u[0] * miles, F[1] + u[1] * miles];
    return [big.far[0] + ((P[0] - F[0]) / (Math.cos(toRad(big.far[1])) * MI)) * (180 / Math.PI), big.far[1] + ((P[1] - F[1]) / MI) * (180 / Math.PI)];
  };
  const near = outward(0.45), farther = outward(0.6);
  const e45 = edgeMi(near, big.p.ring), c45 = dist(near, big.c);
  ok(e45 > 0.3 && e45 <= 0.46 && c45 > 0.5, `6c a point 0.45 mi outside the polygon edge is within 0.5 mi by EDGE (${e45.toFixed(3)}) but beyond 0.5 mi by CENTROID (${c45.toFixed(3)}) — centroid distance would wrongly drop it`);
  ok(edgeMi(farther, big.p.ring) > 0.5, '6d a point 0.6 mi from the edge is beyond 0.5 mi on both measures (the boundary is real, not "everything")');
  ok(edgeMi(big.c, big.p.ring) === 0 || edgeMi(big.c, big.p.ring) < 0.05, '6e a point inside/at the polygon is distance 0');
  // multi-polygon project: nearest of the parts wins, one project
  const parts = polys.filter((p) => p.no === 'SUP26-0007');
  const probe = parts[0].ring[0];
  const dMin = Math.min(...parts.map((p) => edgeMi(probe, p.ring)));
  ok(parts.length === 3 && dMin === 0 || dMin < 0.01, '6f a multi-polygon project is measured by its NEAREST part, and it is still one project (16 source_ids)');
  ok(base.sites.filter((s) => s.case_number === 'SUP26-0007').every((s) => s.scope === 'point' && s.geo_precision === 'point'), '6g every part carries its own centroid pin; the TRUE rings are the geometry N5 stores (recovered_authoritative)');
}

// ── 7. rights HOLD ─────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const reg = validateRights(rights);
  ok(!reg.cleared.some((e) => e.registry_id === 'frisco-proposed-zoning'), '7a frisco-proposed-zoning is NOT in report-rights.json: a new registry entry receives no automatic clearance (R7 lists the 240 ids that existed)');
  const nIds = Object.values(registry).filter(Array.isArray).flat().filter((e) => e && typeof e.registry_id === 'string').length;
  ok(reg.cleared.length === 240 && nIds === 241, '7b (control) 240 cleared ids vs a registry that now holds 241', [reg.cleared.length, nIds]);
  ok(!/frisco-proposed-zoning/.test(read('docs/development-activity-founder-ruling-r7-2026-10-04.md')), '7c the R7 ruling text does not list it');
  ok(!/frisco-proposed-zoning/.test(read('scripts/build-report-rights.mjs')), '7d no clearance is hard-coded in the generator');
}

console.log(fails ? `\n${fails} FAILED` : '\nall frisco-proposed-zoning checks passed');
process.exit(fails ? 1 : 0);
