// N5 bounded spatial read RPC — STATIC guards for public.n5_projects_within_radius().
//
// REVISION 2 (2026-09-03). Founder decision: Map 1 radius mode means "ANY CANONICAL
// PHYSICALLY LOCATED PROJECT GEOMETRY NEAR THIS HOME", so the corpus includes BOTH
// proven_stored_point and recovered_authoritative, and `provenance` is a returned column
// so the two evidence classes stay distinguishable.
//
// WHY STATIC: the build sandbox has no database (same pattern as
// test/app-projects-stable-key.test.mjs). These assert against the SQL of record — the
// SHAPE of the contract. The BEHAVIOURAL half is no longer a recorded measurement taken
// on someone's word: it is executed on a real PostGIS by
// test/n5_spatial_pg/run_suite.py via .github/workflows/n5-spatial-rpc-suite.yml, which
// proves the lifecycle gate refuses mid-sweep, that has_more flips at exactly the right
// boundary, that a home inside a polygon measures 0, and — with negative controls — that
// each gate is load-bearing rather than decorative.
//
// What still requires live verification at apply time is the SECURITY DEFINER OWNER:
// geo.n5_geom and geo.n5_verdict_manifest have RLS enabled with zero policies, so a
// function not owned by `postgres` would create cleanly, pass every test here, and then
// return zero rows forever. See docs/n5-spatial-read-rpc-readiness.md.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sql = readFileSync(join(root, 'docs/n5-spatial-read-rpc.sql'), 'utf8');

// The header deliberately QUOTES patterns this test asserts are absent ("distinct on",
// "app_projects", "ST_Centroid"). Asserting over the raw text would fail on the
// documentation rather than the code — the false-failure recorded in
// test/app-projects-stable-key.test.mjs. Strip whole-line SQL comments first.
const code = sql.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');

let fails = 0;
const ok = (cond, name) => {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
  if (!cond) fails++;
};

// The instrument must prove it ran before its silence counts as evidence.
ok(sql.length > 8000, 'SQL of record loaded (non-trivial file)');
ok(code.length > 2000 && code.length < sql.length, 'comment-stripped code extracted and is smaller than the file');
ok(/create or replace function public\.n5_projects_within_radius\(/.test(code), 'function is declared');

// ---- 1. signature: four parameters, caller-supplied bounded limit ----
ok(/p_lat\s+double precision/.test(code) && /p_lng\s+double precision/.test(code), 'lat/lng parameters');
ok(/p_radius_mi\s+numeric/.test(code), 'radius parameter');
ok(/p_limit\s+integer\s+default\s+500/.test(code), 'caller-supplied p_limit with a default of 500');

// ---- 2. product radii: 0.5 / 1 / 2 / 5 accepted, everything else rejected ----
ok(/v_allowed\s+constant numeric\[\]\s*:=\s*array\[0\.5,\s*1,\s*2,\s*5\]/.test(code),
  'radius allowlist is exactly 0.5, 1, 2, 5 miles');
for (const r of ['0.5', '1', '2', '5']) {
  ok(new RegExp(`array\\[[^\\]]*\\b${r.replace('.', '\\.')}\\b`).test(code), `radius ${r} mi is an accepted product radius`);
}
ok(/if not \(p_radius_mi = any \(v_allowed\)\) then[\s\S]{0,220}raise exception/.test(code),
  'off-allowlist radius raises rather than silently broadening (covers 0, negative and excessive)');

// ---- 3. invalid input is REJECTED, never clamped or broadened ----
ok(/p_lat < -90 or p_lat > 90[\s\S]{0,180}raise exception/.test(code), 'invalid latitude is rejected');
ok(/p_lng < -180 or p_lng > 180[\s\S]{0,190}raise exception/.test(code), 'invalid longitude is rejected');
ok(/p_lat is null or p_lng is null or p_radius_mi is null[\s\S]{0,200}raise exception/.test(code),
  'null lat/lng/radius is rejected');
ok(/if p_limit is null then[\s\S]{0,160}raise exception/.test(code), 'null limit is rejected');
ok(/if p_limit < 1 then[\s\S]{0,180}raise exception/.test(code), 'limit below 1 is rejected');
ok(/if p_limit > v_max_rows then[\s\S]{0,240}raise exception/.test(code),
  'limit above the server maximum is REJECTED, not clamped');
ok(/errcode = '22023'/.test(code), 'validation failures raise a real SQLSTATE (22023 invalid_parameter_value)');
ok(!/least\(|greatest\(/.test(code), 'no input is ever clamped into range (no least/greatest on inputs)');

// ---- 4. LIFECYCLE GATE — READY + canonical-synced, fail closed ----
ok(/from geo\.n5_verdict_manifest/.test(code), 'reads the verdict manifest');
ok(/m\.state = 'READY'/.test(code), "requires state = 'READY'");
ok(/m\.canonical_synced_at is not null/.test(code), 'requires canonical_synced_at to be set');
ok(/into strict v_snapshot/.test(code),
  'uses SELECT INTO STRICT so zero rows AND many rows both fail closed');
ok(/when no_data_found then[\s\S]{0,400}raise exception/.test(code),
  'no consumable snapshot raises (the mid-sweep window)');
ok(/when too_many_rows then[\s\S]{0,400}raise exception/.test(code),
  'an ambiguous corpus (two consumable snapshots) raises');
ok((code.match(/errcode = '55000'/g) || []).length >= 2,
  'both lifecycle refusals carry SQLSTATE 55000 (object_not_in_prerequisite_state)');
ok(!/coalesce\([^)]*canonical_synced_at/i.test(code),
  'canonical_synced_at is never defaulted away with coalesce');

// ---- 5. PROVENANCE — both classes, always distinguishable ----
ok(/v_prov\s+constant text\[\]\s*:=\s*array\['proven_stored_point','recovered_authoritative'\]/.test(code),
  'both eligible provenance classes are named POSITIVELY in an allowlist');
ok(/provenance\s+text,/.test(code), 'provenance is a column of the RETURNS TABLE');
ok(/g\.provenance\s+as provenance/.test(code), 'provenance is selected from the row, not synthesised');
ok(/h\.provenance/.test(code), 'provenance is carried through to the returned result');
ok(/g\.provenance = any \(v_prov\)/.test(code),
  'predicate allowlists provenance by name, so an unknown class fails CLOSED');
ok(!/provenance\s*(<>|!=)/.test(code), 'provenance is an allowlist, never a denylist');
// the function COMMENT must no longer claim the whole result is recovered geometry
const fnComment = (sql.match(/comment on function[\s\S]*?';/) || [''])[0];
ok(fnComment.length > 400, 'function comment is present and substantial');
ok(/proven_stored_point/.test(fnComment) && /recovered_authoritative/.test(fnComment),
  'function comment names BOTH evidence classes');
ok(/NOT equivalent|not be presented as interchangeable/i.test(fnComment),
  'function comment states the two classes are not interchangeable');
ok(!/returns ONLY projects with recovered/i.test(fnComment),
  'function comment no longer claims the result is recovered geometry only');

// ---- 6. removed misleading columns ----
ok(!/first_z3/.test(code), 'first_z3 is NOT returned (NULL on all proven rows in production)');
ok(!/recovered_at/.test(code), 'recovered_at is NOT returned (it is the sync stamp on proven rows)');
ok(!/\boutcome\s+smallint,/.test(code), 'outcome is NOT returned (the predicate pins it to 1)');

// ---- 7. eligibility: positive allowlist, fails closed ----
ok(/g\.outcome = 1/.test(code), 'eligibility predicate requires outcome = 1');
ok(/g\.geom is not null/.test(code), 'eligibility predicate requires a stored geometry');
ok(!/outcome\s*(<>|!=)\s*/.test(code), 'eligibility is an allowlist, never a denylist (no outcome <> N)');
ok(/g\.verdict_snapshot_id = v_snapshot/.test(code),
  'proven geometry must belong to the consumable snapshot (snapshot isolation)');
ok(/not \(g\.provenance = 'proven_stored_point'[\s\S]{0,220}geo\.n5_point_reject/.test(code),
  "a rejected identity's PROVEN point is excluded by the RPC itself, not only by the sweep");
ok(/not \(g\.provenance = 'proven_stored_point'/.test(code),
  'the reject exclusion is scoped to proven points, so recovered geometry survives a bad coordinate');

// ---- 8. geometry semantics: true geometry, never a centroid ----
ok(/st_dwithin\(st_transform\(g\.geom, 4326\)::geography/.test(code),
  'radius test runs ST_DWithin against the true stored geometry in geography metres');
ok(/st_distance\(st_transform\(g\.geom, 4326\)::geography/.test(code),
  'distance is measured from the true stored geometry');
ok(!/st_centroid|st_pointonsurface|n5_rep_point/i.test(code),
  'NO centroid / point-on-surface / representative-point substitution');
ok(/\/ 1609\.344/.test(code), 'metres are converted to miles with the exact factor 1609.344');
ok(/st_transform\(v_home4326, 4269\)/.test(code) && /st_setsrid\(st_makepoint\(p_lng, p_lat\), 4326\)/.test(code),
  'home point is built in 4326 and transformed to the stored SRID 4269 for the prefilter');

// ---- 9. identity + result grain: geometry instances, never collapsed ----
ok(/\bfeature_id\s+text\b/.test(code), 'returns feature_id — the geometry-instance identity');
ok(/\bsource_key\s+text\b/.test(code), 'returns source_key — the project identity');
ok(!/distinct on/i.test(code), 'NO distinct on (source_key) — multi-geometry projects survive as separate rows');
ok(!/\bgroup by\b/i.test(code), 'no group-by collapse of geometry instances');
ok(!/\bsource_ref\b/.test(code), 'source_ref is never used as identity');
ok(!/\bsource_seq\b/.test(code), 'source_seq is never used as identity');
ok(!/app_projects/.test(code), 'this RPC stays spatial+identity only — it does not join app_projects');

// ---- 10. index usability (must remain viable as N5 grows nationally) ----
ok(/g\.geom && st_expand\(v_home4269, v_deg_lng, v_deg_lat\)/.test(code),
  'index-usable && bounding-box prefilter in the stored SRID (uses n5_geom_gix)');
ok(/\* 1\.10\)/.test(code), 'prefilter carries a margin so it can never exclude a true match');
ok(/abs\(p_lat\) > 89\.0 or v_coslat <= 0\.0001/.test(code),
  'longitude span degenerating near the poles is guarded (no divide-by-~zero)');
ok(!/create index/i.test(code), 'no new index is created — the existing n5_geom_gix is used');

// ---- 11. TRUNCATION CONTRACT — observable, never inferred ----
ok(/has_more\s+boolean/.test(code), 'has_more is a column of the RETURNS TABLE');
ok(/limit p_limit \+ 1/.test(code),
  'fetches p_limit + 1 rows so the extra row PROVES whether more matches exist');
ok(/\(\(select count\(\*\) from hit\) > p_limit\) as has_more/.test(code),
  'has_more is computed from that extra row, not from rows == limit');
ok(/with hit as materialized/.test(code), 'the CTE is MATERIALIZED so it is computed exactly once');
ok(/limit p_limit;/.test(code), 'at most p_limit rows are returned to the caller');
ok(/v_max_rows\s+constant integer\s*:=\s*2000/.test(code), 'a hard server maximum bounds any caller request');
ok(!/limit v_max_rows/.test(code), 'the bare unconditional LIMIT of revision 1 is gone');
ok(/order by distance_mi, source_key, feature_id[\s\S]{0,80}limit p_limit \+ 1/.test(code),
  'the bounded fetch is ordered nearest-first, so truncation drops the FARTHEST rows');
ok(/order by h\.distance_mi, h\.source_key, h\.feature_id/.test(code),
  'the returned result is ordered nearest-first and deterministic on ties');

// ---- 12. security: narrowest read surface, no arbitrary geo access ----
ok(/security definer/.test(code), 'SECURITY DEFINER (caller never needs geo access itself)');
ok(/set search_path = public/.test(code), 'search_path is pinned (PostGIS 3.3.7 lives in public)');
ok(/^stable$/m.test(code), 'function is STABLE — read-only, no writes');
const sig = 'double precision, double precision, numeric, integer';
ok(new RegExp(`revoke all on function public\\.n5_projects_within_radius\\(${sig}\\) from public;`).test(code),
  'execute is revoked from public before being granted (4-arg signature)');
ok(new RegExp(`grant execute on function public\\.n5_projects_within_radius\\(${sig}\\) to anon, authenticated;`).test(code),
  'execute is granted only to anon + authenticated (4-arg signature)');
ok(!/grant[\s\S]{0,80}on (table |schema )?geo\./i.test(code),
  'NO grant on the geo schema or any geo table — the function is the only way in');
ok(!/execute format|execute '|quote_ident|dynamic/i.test(code),
  'no dynamic SQL — this cannot be turned into an arbitrary query endpoint');
const geoReads = (code.match(/geo\.[a-z0-9_]+/g) || []).filter((v, i, a) => a.indexOf(v) === i).sort();
ok(geoReads.join(',') === 'geo.n5_geom,geo.n5_point_reject,geo.n5_verdict_manifest',
  'reads exactly three geo tables: n5_geom, n5_point_reject, n5_verdict_manifest — ' + geoReads.join(','));
ok(!/n5_association|n5_frozen|n5_shard|n5_zcta|n5_a3_/.test(code),
  'does not read the association/frozen/shard/A3 tables');
ok(!/insert into|update |delete from|create table|alter table|drop /i.test(code),
  'the function performs no writes of any kind');

process.exit(fails ? 1 : 0);
