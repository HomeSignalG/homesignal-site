// Offline regression checks for the ZIP-mode SPATIAL SCOPE (sources/scope-box.ts) — no network.
// Drives the SHIPPED connectors (arcgis / socrata / csv) and the shared module; nothing is copied.
//
// THE DEFECT (docs/geographic-coverage-audit-2026-10-10.md). A spatial_zip_radius_mi entry fetched
// only records inside ±R miles of the ZIP CENTROID. ZIPs are polygons: on denton-county-dev-permits
// 5,429 of 25,727 source records (21%) lay outside every modeled ZIP's square, were never stored,
// and so could never be served — 5,061 of them inside the nine pilot ZIP polygons. The 20,298
// records that WERE stored all lay inside a square; the 5,429 that were not all lay outside every
// square — the mechanism, not the data, drew the line.
//
// THE FIX UNDER TEST. Scope = legacy centroid square ∪ the ZIP polygon's bounding box. It must be
//   • a strict SUPERSET of the legacy scope (nothing fetched today can stop being fetched),
//   • only a PREFILTER (membership is still decided by the polygon downstream),
//   • byte-for-byte the legacy query when no bounds are supplied (fail-safe).
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRCDIR = join(root, 'supabase/functions/get-address-report/sources');
let fails = 0;
const ok = (c, name, detail) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name + (!c && detail ? '\n     ' + detail : ''));
  if (!c) fails++;
};

let sb, arc, soc, csvm, zb;
try {
  sb = await import(join(SRCDIR, 'scope-box.ts'));
  arc = await import(join(SRCDIR, 'arcgis.ts'));
  soc = await import(join(SRCDIR, 'socrata.ts'));
  csvm = await import(join(SRCDIR, 'csv.ts'));
  zb = await import(join(SRCDIR, 'zip-bounds.ts'));
} catch (err) {
  console.log('FAIL — import (needs Node >= 22.18 type stripping)\n     ' + err.message);
  process.exit(1);
}
const { scopeBox, centroidSquare, widensLegacy, validBounds, pointInBox } = sb;

// ── REAL fixtures (production, 2026-10-10): canonical ZIP bounds + centroids for the nine pilot
//    ZIPs, and real Denton County permit points around 76247 (Justin).
const Z = {
  '75056': { lat: 33.094, lng: -96.8836, xmin: -96.96443, ymin: 33.02393, xmax: -96.842367, ymax: 33.126708 },
  '75068': { lat: 33.1768, lng: -96.9583, xmin: -97.02006, ymin: 33.1177, xmax: -96.880345, ymax: 33.22321 },
  '76207': { lat: 33.2285, lng: -97.1813, xmin: -97.26649, ymin: 33.130999, xmax: -97.092386, ymax: 33.31505 },
  '76226': { lat: 33.1062, lng: -97.16, xmin: -97.265302, ymin: 33.050882, xmax: -97.060992, ymax: 33.17936 },
  '76227': { lat: 33.292, lng: -96.9879, xmin: -97.123906, ymin: 33.188336, xmax: -96.863538, ymax: 33.357867 },
  '76247': { lat: 33.0734, lng: -97.3093, xmin: -97.419356, ymin: 33.005089, xmax: -97.226825, ymax: 33.179387 },
  '76258': { lat: 33.371, lng: -96.9446, xmin: -97.0372, ymin: 33.288322, xmax: -96.815242, ymax: 33.449421 },
  '76259': { lat: 33.1774, lng: -97.2848, xmin: -97.409481, ymin: 33.127498, xmax: -97.187904, ymax: 33.266388 },
  '76266': { lat: 33.3563, lng: -97.1814, xmin: -97.385545, ymin: 33.278295, xmax: -97.036074, ymax: 33.457186 },
};
const bounds = (z) => ({ xmin: Z[z].xmin, ymin: Z[z].ymin, xmax: Z[z].xmax, ymax: Z[z].ymax });
// membership stub: every widened-only record is a polygon MEMBER (this file tests the SCOPE; zip-scope-members.test.mjs tests containment)
const ALLMEM = async (pts) => pts.map(() => 'member');
const cen = (z) => ({ lat: Z[z].lat, lng: Z[z].lng });
// Real points in/near 76247. MISSING = inside the polygon, never stored (outside the square).
const MISSING = [[20120859, -97.3614509872001, 33.0678140389034], [20121110, -97.3475625458436, 33.156062611357],
  [20121117, -97.3628937441276, 33.1021128631019], [20121159, -97.3700815050373, 33.1397181089369],
  [20121228, -97.3651747922255, 33.085715125392], [20121251, -97.3646504034764, 33.1077391158648]];
const STORED = [[20120829, -97.3515445033863, 33.0669288380477], [20120858, -97.3593314225209, 33.0678771422413],
  [20120860, -97.3564178587789, 33.0679934078059], [20121024, -97.3564831740606, 33.0813751522187]];
const R = 3;

// ── 1. the pure module ──────────────────────────────────────────────────────────
console.log('1) scope-box.ts');
ok(JSON.stringify(scopeBox(cen('76247'), R, null)) === JSON.stringify(centroidSquare(33.0734, -97.3093, R)),
  'no bounds ⇒ exactly the legacy centroid square');
ok(JSON.stringify(scopeBox(cen('76247'), R, undefined)) === JSON.stringify(centroidSquare(33.0734, -97.3093, R)), 'undefined bounds ⇒ legacy square');
for (const bad of [{}, { xmin: 1 }, { xmin: 'a', ymin: 0, xmax: 1, ymax: 1 }, { xmin: 5, ymin: 0, xmax: 1, ymax: 1 },
  { xmin: -200, ymin: 0, xmax: 1, ymax: 1 }, { xmin: NaN, ymin: 0, xmax: 1, ymax: 1 }, 7]) {
  ok(!validBounds(bad) && JSON.stringify(scopeBox(cen('76247'), R, bad)) === JSON.stringify(centroidSquare(33.0734, -97.3093, R)),
    `invalid bounds ${JSON.stringify(bad)} ⇒ ignored, legacy square`);
}
for (const z of Object.keys(Z)) {
  const sq = centroidSquare(Z[z].lat, Z[z].lng, R), box = scopeBox(cen(z), R, bounds(z));
  ok(box.xmin <= sq.xmin && box.ymin <= sq.ymin && box.xmax >= sq.xmax && box.ymax >= sq.ymax,
    `${z}: scope ⊇ legacy square (nothing fetched today is dropped)`);
  ok(box.xmin <= Z[z].xmin && box.ymin <= Z[z].ymin && box.xmax >= Z[z].xmax && box.ymax >= Z[z].ymax,
    `${z}: scope ⊇ polygon bounding box`);
  ok(box.xmin === Math.min(sq.xmin, Z[z].xmin) && box.ymax === Math.max(sq.ymax, Z[z].ymax), `${z}: scope is the SMALLEST such box (not padded)`);
}
ok(widensLegacy(scopeBox(cen('76247'), R, bounds('76247')), cen('76247'), R), '76247 (Justin): the polygon reaches past the square ⇒ widened');
ok(!widensLegacy(scopeBox(cen('76207'), R, { xmin: -97.19, ymin: 33.22, xmax: -97.17, ymax: 33.24 }), cen('76207'), R),
  'a ZIP wholly inside its square ⇒ NOT widened (query unchanged)');

// Real records: the six MISSING points are outside the legacy square, inside the new scope.
{
  const sq = centroidSquare(33.0734, -97.3093, R), box = scopeBox(cen('76247'), R, bounds('76247'));
  ok(MISSING.every(([, x, y]) => !pointInBox(y, x, sq)), '6 real never-stored Denton records are OUTSIDE the legacy square (the defect)');
  ok(MISSING.every(([, x, y]) => pointInBox(y, x, box)), '…and INSIDE the new scope (recovered)');
  ok(STORED.every(([, x, y]) => pointInBox(y, x, sq) && pointInBox(y, x, box)), '4 real stored records stay inside both (no regression)');
  ok(!pointInBox(33.0, -97.5, box), 'a point far outside the ZIP is outside the scope (not a county-wide fetch)');
}
// The box is a PREFILTER: it must never be presented as the boundary.
ok(/PREFILTER/.test(readFileSync(join(SRCDIR, 'scope-box.ts'), 'utf8')) && /never decides membership/.test(readFileSync(join(SRCDIR, 'scope-box.ts'), 'utf8')),
  'module states it is a prefilter and never decides membership');

// ── 2. arcgis connector: the REQUEST it makes ────────────────────────────────────
console.log('\n2) arcgis connector request');
const entry = {
  registry_id: 'fixture-radius', platform: 'arcgis',
  service_url: 'https://example.test/arcgis/rest/services/X/FeatureServer/0',
  dataset_url: 'https://example.test/r', coverage: [{ state: 'TX', county: 'Denton' }],
  column_map: { title: 'T', address: 'A', case_number: 'ID', status_raw: 'ST', type_source: 'T', file_date: 'D', lat: '__lat', lng: '__lng' },
  status_to_bucket: { approved: ['Approved'], proposed: [], operating: [], exclude: [] },
  spatial_zip_radius_mi: 3, max_rows: 100,
};
const feat = (id, x, y) => ({ attributes: { T: 'HOUSE', A: id + ' ST', ID: String(id), ST: 'Approved', D: Date.UTC(2023, 0, 5) }, geometry: { x, y } });
const run = async (deps, over = {}, rows = null) => {
  const urls = [];
  const d = {
    fetch: async (u) => {
      urls.push(String(u));
      const all = rows ?? [];
      const q = new URL(String(u));
      const g = (q.searchParams.get('geometry') || '').split(',').map(Number);
      const hit = all.filter((f) => g.length === 4 ? f.geometry.x >= g[0] && f.geometry.y >= g[1] && f.geometry.x <= g[2] && f.geometry.y <= g[3] : true);
      const off = Number(q.searchParams.get('resultOffset') || 0), lim = Number(q.searchParams.get('resultRecordCount') || 1000);
      return { ok: true, status: 200, json: async () => ({ features: hit.slice(off, off + lim), exceededTransferLimit: off + lim < hit.length }) };
    },
    ...deps,
  };
  const out = await arc.arcgisForZip('76247', [{ state: 'TX', county: 'Denton' }], [{ ...entry, ...over }], d);
  return { urls, out };
};
const ALL = [...MISSING, ...STORED].map(([id, x, y]) => feat(id, x, y));
{
  const legacy = await run({ zipCentroid: cen('76247') }, {}, ALL);
  const same = await run({ zipCentroid: cen('76247'), zipBounds: null }, {}, ALL);
  ok(legacy.urls[0] === same.urls[0], 'no bounds ⇒ the query string is IDENTICAL to the legacy one (fail-safe)');
  const g0 = new URL(legacy.urls[0]).searchParams.get('geometry').split(',').map(Number);
  const sq = centroidSquare(33.0734, -97.3093, R);
  ok(Math.abs(g0[0] - sq.xmin) < 1e-9 && Math.abs(g0[3] - sq.ymax) < 1e-9, 'legacy geometry param = the centroid square');
  ok(legacy.out.sites.length === 4, `legacy: only the 4 in-square records are returned (got ${legacy.out.sites.length})`);

  const wide = await run({ zipCentroid: cen('76247'), zipBounds: bounds('76247'), zipMembers: ALLMEM }, {}, ALL);
  const g1 = new URL(wide.urls[0]).searchParams.get('geometry').split(',').map(Number);
  const box = scopeBox(cen('76247'), R, bounds('76247'));
  ok(Math.abs(g1[0] - box.xmin) < 1e-9 && Math.abs(g1[1] - box.ymin) < 1e-9 && Math.abs(g1[2] - box.xmax) < 1e-9 && Math.abs(g1[3] - box.ymax) < 1e-9,
    'bounds ⇒ geometry param = legacy square ∪ polygon bbox');
  ok(wide.out.sites.length === 10, `bounds: all 10 records returned — the 6 missing ones recovered (got ${wide.out.sites.length})`);
  ok(legacy.out.sites.every((s) => wide.out.sites.some((w) => w.case_number === s.case_number)),
    'every record the legacy scope returned is still returned (superset)');
  ok(wide.out.reports[0].scope_widened === true && legacy.out.reports[0].scope_widened === undefined, 'run report says WHEN the scope was widened');
  ok(['inSR', 'spatialRel', 'geometryType'].every((k) => new URL(wide.urls[0]).searchParams.get(k) === new URL(legacy.urls[0]).searchParams.get(k)),
    'only the extent changed — same inSR / spatialRel / geometryType');

  // a ZIP the polygon does not widen ⇒ identical request
  const tight = await run({ zipCentroid: cen('76207'), zipBounds: { xmin: -97.19, ymin: 33.22, xmax: -97.17, ymax: 33.24 }, zipMembers: ALLMEM }, {}, ALL);
  const tightLegacy = await run({ zipCentroid: cen('76207') }, {}, ALL);
  ok(tight.urls[0] === tightLegacy.urls[0], 'bounds inside the square ⇒ request identical to legacy (zero behaviour change)');

  // ── max_rows: widening must never make a report WORSE
  const many = Array.from({ length: 150 }, (_, i) => feat(30000 + i, -97.40 + (i % 10) * 0.0001, 33.01 + Math.floor(i / 10) * 0.001));
  const capped = await run({ zipCentroid: cen('76247'), zipBounds: bounds('76247'), zipMembers: ALLMEM }, { max_rows: 100 }, [...many, ...STORED.map(([id, x, y]) => feat(id, x, y))]);
  ok(capped.out.reports[0].truncated_at_max_rows == null, 'widened fetch hit the cap ⇒ re-run on the legacy square, report is NOT truncated');
  ok(capped.out.sites.length === 4, 'fallback returns exactly the legacy result (4 in-square records)');
  ok(capped.out.reports[0].quarantined.some((q) => /fell back to the legacy centroid square/.test(q.reason)), 'the fallback is reported, not silent');
}

// ── 3. socrata: circle ⇒ box only when widened ───────────────────────────────────
console.log('\n3) socrata connector request');
{
  const sEntry = {
    registry_id: 'fx-soc', platform: 'socrata', domain: 'data.example.test', dataset_id: 'abcd-1234', dataset_url: 'https://data.example.test/d/abcd-1234',
    coverage: [{ state: 'TX', county: 'Denton' }], spatial_zip_radius_mi: 3, spatial_point_col: 'location',
    column_map: { title: 'T', address: 'A', case_number: 'ID', status_raw: 'ST', type_source: 'T', file_date: 'D', lat: 'lat', lng: 'lng' },
    status_to_bucket: { approved: ['Approved'], proposed: [], operating: [], exclude: [] },
  };
  const wheres = [];
  const mk = (deps) => ({ fetch: async (u) => { wheres.push(new URL(String(u)).searchParams.get('$where')); return { ok: true, status: 200, json: async () => [] }; }, ...deps });
  await soc.socrataForZip('76247', [{ state: 'TX', county: 'Denton' }], [sEntry], mk({ zipCentroid: cen('76247') }));
  await soc.socrataForZip('76247', [{ state: 'TX', county: 'Denton' }], [sEntry], mk({ zipCentroid: cen('76247'), zipBounds: bounds('76247'), zipMembers: ALLMEM }));
  await soc.socrataForZip('76207', [{ state: 'TX', county: 'Denton' }], [sEntry], mk({ zipCentroid: cen('76207'), zipBounds: { xmin: -97.19, ymin: 33.22, xmax: -97.17, ymax: 33.24 }, zipMembers: ALLMEM }));
  ok(/^within_circle\(location, 33\.0734, -97\.3093, 4828\)/.test(wheres[0]), 'no bounds ⇒ the legacy within_circle');
  const box = scopeBox(cen('76247'), R, bounds('76247'));
  ok(wheres[1].startsWith(`within_box(location, ${box.ymax}, ${box.xmin}, ${box.ymin}, ${box.xmax})`), 'widened ⇒ within_box over the union box');
  ok(/^within_circle\(location, 33\.2285, -97\.1813, 4828\)/.test(wheres[2]), 'bounds that do not widen ⇒ legacy circle unchanged');
}

// ── 4. csv: radius OR box ────────────────────────────────────────────────────────
console.log('\n4) csv connector');
{
  const cEntry = {
    registry_id: 'fx-csv', platform: 'csv', url: 'https://example.test/f.csv', dataset_url: 'https://example.test/d',
    coverage: [{ state: 'TX', county: 'Denton' }], spatial_zip_radius_mi: 3,
    column_map: { title: 'T', address: 'A', case_number: 'ID', status_raw: 'ST', type_source: 'T', file_date: 'D', lat: 'LAT', lng: 'LNG' },
    status_to_bucket: { approved: ['Approved'], proposed: [], operating: [], exclude: [] },
  };
  const rows = [...MISSING, ...STORED].map(([id, x, y]) => `${id},HOUSE,${id} ST,Approved,2023-01-05,${y},${x}`);
  const text = ['ID,T,A,ST,D,LAT,LNG', ...rows].join('\n');
  const mk = (deps) => ({ fetch: async () => ({ ok: true, status: 200, text: async () => text, headers: new Headers() }), ...deps });
  const a = await csvm.csvForZip('76247', [{ state: 'TX', county: 'Denton' }], [cEntry], mk({ zipCentroid: cen('76247') }));
  const b = await csvm.csvForZip('76247', [{ state: 'TX', county: 'Denton' }], [cEntry], mk({ zipCentroid: cen('76247'), zipBounds: bounds('76247'), zipMembers: ALLMEM }));
  const na = a.reports[0].fetched, nb = b.reports[0].fetched;
  ok(na === 4 && nb === 10, `legacy keeps 4 rows; with bounds 10 (missing 6 recovered) — got ${na} / ${nb}`);
  ok(b.reports[0].scope_widened === true, 'csv report flags the widened scope');
}

// ── 5. the engine wiring + bounds reader ─────────────────────────────────────────
console.log('\n5) wiring');
{
  const idx = readFileSync(join(root, 'supabase/functions/get-address-report/index.ts'), 'utf8');
  const zipMode = idx.slice(idx.indexOf('── ZIP MODE ──'), idx.indexOf('── ZIP MODE ──') + 40000);
  ok((zipMode.match(/zipBounds: scope\.bounds/g) || []).length === 3, 'ZIP mode passes zipBounds to exactly the three radius-capable connectors (arcgis, socrata, csv)');
  ok(/zipScopeBounds\(supabase, zip\)/.test(zipMode), 'ZIP mode reads the bounds once through zipScopeBounds');
  ok(!/scope_bounds|scopeBounds/.test(idx), 'the request body has NO scope flag at all (public endpoint: callers cannot steer the rollout)');
  ok(/scopePolicy\(\(k\) => Deno\.env\.get\(k\), zip\)/.test(zipMode), 'rollout decided by server env policy (scopePolicy over Deno.env) only');
  ok(/policy\.on \? await zipScopeBounds\(supabase, zip\) : \{ bounds: null/.test(zipMode), 'policy OFF ⇒ no bounds read, legacy scope, zero extra queries');
  ok(!/zipBounds/.test(idx.slice(idx.indexOf('── ZIP MODE ──') + 40000)), 'ADDRESS mode never receives zipBounds (the property radius is untouched)');
  const okRpc = (data, error = null) => ({ rpc: async () => ({ data, error }) });
  const r1 = await zb.zipScopeBounds(okRpc([{ xmin: -97.4, ymin: 33.0, xmax: -97.2, ymax: 33.2 }]), '76247');
  ok(r1.bounds && r1.bounds.xmin === -97.4 && r1.reason === null, 'reads a valid box');
  for (const [label, db] of [['rpc error (migration not applied)', okRpc(null, { message: 'function does not exist' })],
    ['no row (ZIP has no boundary)', okRpc([])], ['malformed', okRpc([{ xmin: 'x' }])],
    ['threw', { rpc: async () => { throw new Error('boom'); } }]]) {
    const r = await zb.zipScopeBounds(db, '76247');
    ok(r.bounds === null && typeof r.reason === 'string', `${label} ⇒ null bounds + a reason (legacy scope, never a smaller fetch)`);
  }
  ok((await zb.zipScopeBounds(okRpc([{}]), 'abc')).bounds === null, 'a non-5-digit ZIP is refused before any call');
  const sql = readFileSync(join(root, 'docs/zip-scope-bounds.sql'), 'utf8');
  ok(/geo\.zip_membership_boundary\(p_zip\)/.test(sql) && !/geo\.zcta_boundary/.test(sql.replace(/--.*$/gm, '').replace(/do \$\$[\s\S]*$/i, '')),
    'the SQL reads the ONE boundary authority (geo.zip_membership_boundary), not the table directly');
  ok(/revoke all on function public\.zip_scope_bounds\(text\) from anon, authenticated;/.test(sql) && /grant execute on function public\.zip_scope_bounds\(text\) to service_role;/.test(sql),
    'the SQL locks the function to service_role by NAME (a revoke from public alone is not a lock)');
}


// ── 6. rollout policy (pure) ─────────────────────────────────────────────────────
console.log('\n6) scopePolicy');
{
  const env = (o) => (k) => o[k];
  const P = (o, z = '76258') => zb.scopePolicy(env(o), z);
  ok(!P({}).on, 'unset ⇒ off');
  for (const m of ['off', 'OFF', 'on', 'true', '1', 'yes', 'allow', '']) ok(!P({ ZIP_SCOPE_BOUNDS_MODE: m, ZIP_SCOPE_BOUNDS_ZIPS: '76258' }).on, `mode "${m}" ⇒ off (fail closed)`);
  ok(P({ ZIP_SCOPE_BOUNDS_MODE: 'all' }, '12345').on, 'mode all ⇒ every ZIP on');
  ok(P({ ZIP_SCOPE_BOUNDS_MODE: ' ALLOWLIST ', ZIP_SCOPE_BOUNDS_ZIPS: '76258, 76247 76227' }).on, 'allowlist (case/space tolerant) ⇒ listed ZIP on');
  ok(!P({ ZIP_SCOPE_BOUNDS_MODE: 'allowlist', ZIP_SCOPE_BOUNDS_ZIPS: '76258' }, '76247').on, 'allowlist ⇒ unlisted ZIP off');
  ok(!P({ ZIP_SCOPE_BOUNDS_MODE: 'allowlist', ZIP_SCOPE_BOUNDS_ZIPS: '' }).on, 'empty allowlist ⇒ nothing on');
  ok(!P({ ZIP_SCOPE_BOUNDS_MODE: 'allowlist', ZIP_SCOPE_BOUNDS_ZIPS: '7625 762588 abcde 76258;76247' }).on, 'malformed tokens never match');
}

// ── 7. widened-fetch FAILURES must not become an honest zero ─────────────────────
// The established authority: a `fetch failed:` / `fetch/parse failed:` quarantine reason makes
// dev_refresh_collect refuse to overwrite a contributing source's cached data
// (docs/dev-refresh-source-failure-guard.sql; test/fetch-failure-reason-contract.test.mjs).
console.log('\n7) widened-fetch failure modes');
{
  const resp = (status, body) => ({ ok: status >= 200 && status < 300, status, headers: new Headers(), json: async () => body, text: async () => JSON.stringify(body) });
  const modes = {
    'network failure': async () => { throw new TypeError('fetch failed'); },
    'timeout': async () => { const e = new Error('The operation timed out'); e.name = 'TimeoutError'; throw e; },
    'HTTP 200 + {error} (unsupported spatial query)': async () => resp(200, { error: { code: 400, message: 'Unable to perform query' } }),
    'HTTP 200 + no features array': async () => resp(200, { unexpected: true }),
    'HTTP 400': async () => resp(400, { error: { message: 'bad request' } }),
    'HTTP 403': async () => resp(403, {}),
    'HTTP 500': async () => resp(500, {}),
  };
  const noSleep = { sleep: async () => {} };
  for (const [label, f] of Object.entries(modes)) {
    const a = await arc.arcgisForZip('76247', [{ state: 'TX', county: 'Denton' }], [{ ...entry }],
      { fetch: f, zipCentroid: cen('76247'), zipBounds: bounds('76247'), zipMembers: ALLMEM, ...noSleep });
    const ar = a.reports[0];
    ok(a.sites.length === 0 && ar.quarantined.some((q) => /^fetch failed:/.test(q.reason)),
      `arcgis widened — ${label} ⇒ \`fetch failed:\` quarantine (cache-preserving), not an honest zero`, JSON.stringify(ar.quarantined));
    ok(!ar.scope_widened && !ar.scope_fallback, `arcgis widened — ${label} ⇒ no recovery is claimed`);
  }
  const sEntry = {
    registry_id: 'fx-soc', platform: 'socrata', domain: 'data.example.test', dataset_id: 'abcd-1234', dataset_url: 'https://data.example.test/d/abcd-1234',
    coverage: [{ state: 'TX', county: 'Denton' }], spatial_zip_radius_mi: 3, spatial_point_col: 'location',
    column_map: { title: 'T', address: 'A', case_number: 'ID', status_raw: 'ST', type_source: 'T', file_date: 'D', lat: 'lat', lng: 'lng' },
    status_to_bucket: { approved: ['Approved'], proposed: [], operating: [], exclude: [] },
  };
  const smodes = {
    'network failure': modes['network failure'], 'timeout': modes['timeout'],
    'HTTP 200 + error object (unsupported within_box)': async () => resp(200, { error: true, message: 'query.soql.no-such-function' }),
    'HTTP 400': modes['HTTP 400'], 'HTTP 403': modes['HTTP 403'], 'HTTP 500': modes['HTTP 500'],
  };
  for (const [label, f] of Object.entries(smodes)) {
    const s = await soc.socrataForZip('76247', [{ state: 'TX', county: 'Denton' }], [sEntry],
      { fetch: f, zipCentroid: cen('76247'), zipBounds: bounds('76247'), zipMembers: ALLMEM, ...noSleep });
    const sr = s.reports[0];
    ok(s.sites.length === 0 && sr.quarantined.some((q) => /^fetch failed:/.test(q.reason)),
      `socrata widened — ${label} ⇒ \`fetch failed:\` quarantine (cache-preserving), not an honest zero`, JSON.stringify(sr.quarantined));
    ok(!sr.scope_widened && !sr.scope_fallback, `socrata widened — ${label} ⇒ no recovery is claimed`);
  }
  // the legacy scope keeps its exact prior behaviour on the same failures (no new strictness)
  const legacyEmpty = await arc.arcgisForZip('76247', [{ state: 'TX', county: 'Denton' }], [{ ...entry }],
    { fetch: async () => resp(200, { unexpected: true }), zipCentroid: cen('76247'), ...noSleep });
  ok(!legacyEmpty.reports[0].quarantined.some((q) => /^fetch failed:/.test(q.reason)), 'legacy scope: unchanged behaviour on a features-less 200 (strictness applies only to the widened query)');
}

// ── 8. overflow honesty ──────────────────────────────────────────────────────────
console.log('\n8) overflow: fallback is reported, never presented as recovery');
{
  const many = Array.from({ length: 150 }, (_, i) => feat(30000 + i, -97.40 + (i % 10) * 0.0001, 33.01 + Math.floor(i / 10) * 0.001));
  const capped = await run({ zipCentroid: cen('76247'), zipBounds: bounds('76247'), zipMembers: ALLMEM }, { max_rows: 100 }, [...many, ...STORED.map(([id, x, y]) => feat(id, x, y))]);
  ok(capped.out.reports[0].scope_fallback === 'legacy_after_overflow', 'arcgis: overflow ⇒ report.scope_fallback = legacy_after_overflow (consumers must not count polygon-only records as recovered)');
}

// ── 9. csv cap: widened rows can never displace legacy rows ──────────────────────
console.log('\n9) csv cap regression');
{
  const cEntry = {
    registry_id: 'fx-csv', platform: 'csv', url: 'https://example.test/f.csv', dataset_url: 'https://example.test/d',
    coverage: [{ state: 'TX', county: 'Denton' }], spatial_zip_radius_mi: 3, max_rows: 6,
    column_map: { title: 'T', address: 'A', case_number: 'ID', status_raw: 'ST', type_source: 'T', file_date: 'D', lat: 'LAT', lng: 'LNG' },
    status_to_bucket: { approved: ['Approved'], proposed: [], operating: [], exclude: [] },
  };
  const line = ([id, x, y]) => `${id},HOUSE,${id} ST,Approved,2023-01-05,${y},${x}`;
  const mkText = (rs) => ['ID,T,A,ST,D,LAT,LNG', ...rs.map(line)].join('\n');
  const go = async (rs, deps, over = {}) => csvm.csvForZip('76247', [{ state: 'TX', county: 'Denton' }], [{ ...cEntry, ...over }],
    { fetch: async () => ({ ok: true, status: 200, text: async () => mkText(rs), headers: new Headers() }), ...deps });
  const ids = (o) => o.sites.map((s) => String(s.case_number)).sort();
  // 6 widened-only rows FIRST in the file, then 4 legacy rows, cap 6 → file order would emit the 6
  // widened rows and drop every legacy row.
  const FILE = [...MISSING, ...STORED];
  const legacy = await go(FILE, { zipCentroid: cen('76247') });
  const wide = await go(FILE, { zipCentroid: cen('76247'), zipBounds: bounds('76247'), zipMembers: ALLMEM });
  ok(ids(legacy).length === 4, 'legacy: the 4 in-square rows');
  ok(STORED.every(([id]) => ids(wide).includes(String(id))), 'widened + cap exceeded: EVERY legacy row is still emitted (none displaced)');
  ok(ids(wide).length === 6 && wide.reports[0].truncated_at_max_rows === 6, 'cap respected: 4 legacy + 2 widened = 6, report says truncated');
  ok(wide.reports[0].scope_widened_rows_dropped === 4, `the 4 dropped rows are counted as polygon-bbox rows (got ${wide.reports[0].scope_widened_rows_dropped})`);
  ok(wide.reports[0].quarantined.some((q) => /polygon-bbox row\(s\) were NOT included; every legacy-scope row was kept/.test(q.reason)), 'overflow is reported honestly (not claimed as full recovery)');
  // legacy alone exceeds the cap → identical to the legacy emit (first N in file order)
  const tiny = await go(FILE, { zipCentroid: cen('76247'), zipBounds: bounds('76247'), zipMembers: ALLMEM }, { max_rows: 3 });
  const tinyLegacy = await go(FILE, { zipCentroid: cen('76247') }, { max_rows: 3 });
  ok(JSON.stringify(ids(tiny)) === JSON.stringify(ids(tinyLegacy)), 'legacy alone overflows the cap ⇒ output identical to the pre-change connector');
  ok(tiny.reports[0].scope_widened_rows_dropped === undefined, '…and no widened-row drop is claimed there');
  // with room to spare nothing is dropped
  const roomy = await go(FILE, { zipCentroid: cen('76247'), zipBounds: bounds('76247'), zipMembers: ALLMEM }, { max_rows: 50 });
  ok(ids(roomy).length === 10 && roomy.reports[0].truncated_at_max_rows == null, 'cap not reached ⇒ all 10 recovered, not truncated');
}

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
