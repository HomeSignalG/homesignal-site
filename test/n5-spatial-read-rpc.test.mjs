// N5 bounded spatial read RPC — structural guards for public.n5_projects_within_radius().
//
// WHY STRUCTURAL: CI has no database (see test/app-projects-stable-key.test.mjs and
// test/app-refresh-zip-determinism.test.mjs, which follow the same pattern), so these
// assert against the SQL of record. The behavioural half was measured live against the
// real stored geometry on 2026-09-02 and is recorded here so the numbers are auditable:
//
//   * polygon containing the home -> ST_Distance = 0.0000 m, and a point 1 mile east of
//     it -> 1540.6 m (distance to the polygon EDGE, not to a centroid).
//   * radius monotonicity from one real home point, 0.5 / 1 / 2 / 5 mi ->
//     25 / 28 / 52 / 69 geometry rows, max distance 0.4910 / 0.9271 / 1.7471 / 4.9838 mi
//     — every result strictly inside its requested radius.
//   * multi-geometry survives: arcgis:massdot-highway-projects:609402 owns 191 features;
//     58 distinct feature_ids of that ONE source_key fall within 1 mile and come back as
//     58 separate rows (17 distinct projects, 80 rows total). This is also the line-geometry
//     case — MassDOT highway projects are stored as ST_MultiLineString.
//   * EXPLAIN (ANALYZE): "Index Scan using n5_geom_gix", Rows Removed by Filter: 18,
//     Execution Time 33.852 ms — the existing GiST index is used; no new index was created.
//
// What still requires live DB verification is stated in the PR: the function itself has
// NOT been created in production by this change (creating it is a write), so grants and
// SECURITY DEFINER ownership are asserted here as text only.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sql = readFileSync(join(root, 'docs/n5-spatial-read-rpc.sql'), 'utf8');

// The header of that file deliberately QUOTES the patterns this test asserts are absent
// ("NO `distinct on (source_key)`", "app_projects", "source_ref", "ST_Centroid"). Asserting
// over the raw text would therefore fail on the documentation rather than on the code —
// the exact false-failure recorded in test/app-projects-stable-key.test.mjs. Strip
// whole-line SQL comments before any code-level assertion.
const code = sql.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');

let fails = 0;
const ok = (cond, name) => {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
  if (!cond) fails++;
};

// The instrument must prove it ran before its silence counts as evidence.
ok(sql.length > 4000, 'SQL of record loaded (non-trivial file)');
ok(code.length > 1200 && code.length < sql.length, 'comment-stripped code extracted and is smaller than the file');
ok(/create or replace function public\.n5_projects_within_radius\(/.test(code), 'function is declared');

// ---- 1. product radii: 0.5 / 1 / 2 / 5 are accepted ----
ok(/v_allowed\s+constant numeric\[\]\s*:=\s*array\[0\.5,\s*1,\s*2,\s*5\]/.test(code),
  'radius allowlist is exactly 0.5, 1, 2, 5 miles');
for (const r of ['0.5', '1', '2', '5']) {
  ok(new RegExp(`array\\[[^\\]]*\\b${r.replace('.', '\\.')}\\b`).test(code), `radius ${r} mi is an accepted product radius`);
}

// ---- 2. invalid input is REJECTED, not clamped or broadened ----
ok(/if not \(p_radius_mi = any \(v_allowed\)\) then[\s\S]{0,200}raise exception/.test(code),
  'invalid radius raises rather than silently broadening the query');
ok(/p_lat < -90 or p_lat > 90[\s\S]{0,160}raise exception/.test(code),
  'invalid latitude is rejected');
ok(/p_lng < -180 or p_lng > 180[\s\S]{0,170}raise exception/.test(code),
  'invalid longitude is rejected');
ok(/p_lat is null or p_lng is null or p_radius_mi is null[\s\S]{0,180}raise exception/.test(code),
  'null lat/lng/radius is rejected');
ok(/errcode = '22023'/.test(code), 'validation failures raise a real SQLSTATE (22023 invalid_parameter_value)');
ok(!/least\(|greatest\(/.test(code), 'radius is never clamped into range (no least/greatest on the input)');

// ---- 3. eligibility: positive allowlist, fails closed ----
ok(/g\.outcome = 1/.test(code), 'eligibility predicate requires outcome = 1');
ok(/g\.geom is not null/.test(code), 'eligibility predicate requires a stored geometry');
ok(!/outcome\s*(<>|!=)\s*/.test(code), 'eligibility is an allowlist, never a denylist (no outcome <> N)');

// ---- 4. geometry semantics: true geometry, never a centroid ----
ok(/st_dwithin\(st_transform\(g\.geom, 4326\)::geography/.test(code),
  'radius test runs ST_DWithin against the true stored geometry in geography metres');
ok(/st_distance\(st_transform\(g\.geom, 4326\)::geography/.test(code),
  'distance is measured from the true stored geometry');
ok(!/st_centroid|st_pointonsurface/i.test(code), 'NO centroid/point-on-surface substitution in the query');
ok(/\/ 1609\.344/.test(code), 'metres are converted to miles with the exact factor 1609.344');
ok(/st_transform\(v_home4326, 4269\)/.test(code) && /st_setsrid\(st_makepoint\(p_lng, p_lat\), 4326\)/.test(code),
  'home point is built in 4326 and transformed to the stored SRID 4269 for the prefilter');

// ---- 5. identity + result grain: geometry instances, never collapsed ----
ok(/\bfeature_id\s+text\b/.test(code), 'returns feature_id — the geometry-instance identity');
ok(/\bsource_key\s+text\b/.test(code), 'returns source_key — the project identity');
ok(!/distinct on/i.test(code), 'NO distinct on (source_key) — multi-geometry projects survive as separate rows');
ok(!/\bgroup by\b/i.test(code), 'no group-by collapse of geometry instances');
ok(!/\bsource_ref\b/.test(code), 'source_ref is never used as identity');
ok(!/\bsource_seq\b/.test(code), 'source_seq is never used as identity');
ok(!/app_projects/.test(code), 'this RPC stays spatial+identity only — it does not join app_projects');

// ---- 6. index usability (must remain viable as N5 grows nationally) ----
ok(/g\.geom && st_expand\(v_home4269, v_deg_lng, v_deg_lat\)/.test(code),
  'index-usable && bounding-box prefilter in the stored SRID (uses n5_geom_gix)');
ok(/\* 1\.10\)/.test(code), 'prefilter carries a margin so it can never exclude a true match');
ok(/abs\(p_lat\) > 89\.0 or v_coslat <= 0\.0001/.test(code),
  'longitude span degenerating near the poles is guarded (no divide-by-~zero)');
ok(!/create index/i.test(code), 'no new index is created — the existing n5_geom_gix is used');

// ---- 7. bounded surface ----
ok(/limit v_max_rows/.test(code) && /v_max_rows\s+constant integer\s*:=\s*2000/.test(code),
  'result set is bounded by an explicit row ceiling');
ok(/order by 4, g\.source_key, g\.feature_id/.test(code),
  'ordering is nearest-first and deterministic on ties (so the ceiling truncates predictably)');

// ---- 8. security: narrowest read surface, no arbitrary geo access ----
ok(/security definer/.test(code), 'SECURITY DEFINER (caller never needs geo access itself)');
ok(/set search_path = public/.test(code), 'search_path is pinned (PostGIS 3.3.7 lives in public)');
ok(/^stable$/m.test(code), 'function is STABLE — read-only, no writes');
ok(/revoke all on function public\.n5_projects_within_radius\(double precision, double precision, numeric\) from public;/.test(code),
  'execute is revoked from public before being granted');
ok(/grant execute on function public\.n5_projects_within_radius\(double precision, double precision, numeric\) to anon, authenticated;/.test(code),
  'execute is granted only to anon + authenticated');
ok(!/grant[\s\S]{0,80}on (table |schema )?geo\./i.test(code),
  'NO grant on the geo schema or geo.n5_geom — the function is the only way in');
ok(!/execute format|execute '|quote_ident|dynamic/i.test(code),
  'no dynamic SQL — this cannot be turned into an arbitrary query endpoint');
ok((code.match(/from geo\./g) || []).length === 1 && /from geo\.n5_geom g/.test(code),
  'reads exactly one geo table: geo.n5_geom');
ok(!/n5_association|n5_frozen|n5_shard|n5_zcta/.test(code),
  'does not read the association/frozen/shard tables (their eligibility gap is not laundered through this RPC)');

process.exit(fails ? 1 : 0);
