// N5 canonical geometry — provenance, PROJECT-GLOBAL PROVEN verdict, association key
// correction, stage-and-swap. STATIC SOURCE ASSERTIONS ONLY.
//
// ⚠️ These are NOT database proof. No SQL is executed here. This container has no PostgreSQL
// server, no Docker daemon, and package egress is blocked, so the executable PostGIS suite
// required before apply does not exist yet. Do not read a green run as pre-apply readiness.
//
// Live read-only measurements behind the design (2026-09-02):
//   * PROVEN population on the authoritative frozen baseline: 723,449 source_keys.
//   * 72,856 of them (10.1%) appear in MORE THAN ONE z3 — up to 12 shards, 217 page ZIPs.
//     Hence canonical point ownership is source_key, never z3.
//   * preservation.app_project_identity has ONE index, (snapshot_id, app_project_id). A single
//     source_key lookup plans as Parallel Seq Scan cost=0.00..149046.81 over 1,125 MB — so the
//     global verdict is precomputed, not evaluated interactively per shard.
//   * Association impact of global eligibility: ZERO for the 13 completed shards (they hold 1
//     PROVEN source_key, globally single-coordinate). NONZERO for shard 760 — 29 projects are
//     single-coordinate locally but multi-coordinate globally; global multi 579 -> 609.
//   * geo.n5_association: 20,170 rows = 20,170 distinct pairs, 0 conflicting evidence.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sql = readFileSync(join(root, 'docs/n5-canonical-geometry-provenance.sql'), 'utf8');
const py = readFileSync(join(root, 'scripts/n5_shard.py'), 'utf8');
const code = sql.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');
// Absence assertions must not match the builder's own prose (it documents what it forbids).
const pycode = py.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');

let fails = 0;
const ok = (c, n) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + n); if (!c) fails++; };

ok(sql.length > 5000 && py.length > 20000, 'migration + builder loaded');

// ---- 1. MIGRATION ATOMICITY ----
ok(/^begin;$/m.test(code) && /^commit;$/m.test(code), 'migration is one transaction');
ok(code.indexOf('begin;') < code.indexOf('drop constraint if exists n5_association_pkey')
   && code.indexOf('add constraint n5_association_pkey') < code.lastIndexOf('commit;'),
  'the DROP PK / ADD PK window is inside the transaction');
ok(/APPLY THIS FILE AS A SINGLE STATEMENT\/SCRIPT/.test(sql),
  'the apply-mechanism gate is documented in the migration');

// ---- 2. PROVENANCE ----
ok(code.indexOf('add column if not exists provenance') < code.indexOf("set provenance = 'recovered_authoritative'"),
  'column added nullable before backfill');
ok(code.indexOf('provenance backfill incomplete') < code.indexOf('n5_geom_provenance_ck'),
  'zero-NULL assertion precedes the CHECK');
ok(code.indexOf('n5_geom_provenance_ck') < code.indexOf('alter column provenance set not null'),
  'NOT NULL enforced last');
ok(!/add column if not exists provenance[^;]*default/i.test(code), 'provenance has NO default');
ok(/check \(provenance in \('recovered_authoritative','proven_stored_point'\)\)/.test(code),
  'provenance allowlist is exactly the two v1 values');

// ---- 3. pt: NAMESPACE STRUCTURALLY RESERVED ----
ok(/check \(\(provenance = 'proven_stored_point'\) = \(feature_id = 'pt:1'\)\)/.test(code),
  'biconditional CHECK reserves the pt: namespace');
ok(/violate the pt: namespace reservation/.test(code), 'pre-existing violators STOP the migration');
ok(!/'pt:2'/.test(pycode), 'no executable path emits pt:2');

// ---- 4. ASSOCIATION PK ----
ok(/primary key \(source_key, zip\)/.test(code), 'association PK is (source_key, zip)');
ok(/having count\(\*\) > 1/.test(code) && /having count\(distinct evidence\) > 1/.test(code),
  'both PK preconditions are verified');
ok(/needs reconciliation first/.test(code), 'nonzero preconditions STOP the migration');

// ---- 5. PROJECT-GLOBAL OWNERSHIP ----
ok(/create table if not exists geo\.n5_proven_verdict/.test(code), 'global verdict table exists');
ok(/primary key \(snapshot_id, source_key\)/.test(code),
  'verdict grain is source_key (per snapshot) — NOT z3');
ok(/verdict <> 'ELIGIBLE' or \(ncoord = 1 and lat is not null and lng is not null\)/.test(code),
  'an ELIGIBLE verdict must carry exactly one observed coordinate pair');
ok(/preservation\.app_project_identity/.test(py), 'verdict is built from the authoritative baseline');
ok(/NOT POPULATED BY THIS MIGRATION/.test(sql), 'migration does not populate the verdict');
ok(!/insert into geo\.n5_proven_verdict/i.test(code), 'migration writes no verdict rows');

// ---- 6. ORDER INDEPENDENCE: no z3 in any canonical write predicate ----
const matSeg = py.slice(py.indexOf('def materialize_proven_points'));
const geomDel = matSeg.slice(matSeg.indexOf('delete from geo.n5_geom g')).split('"""')[0];
ok(/g\.source_key = v\.source_key/.test(geomDel) && /g\.provenance = 'proven_stored_point'/.test(geomDel),
  'stale point deletion is scoped to source_key AND the proven slot');
ok(!/z3/.test(geomDel), 'geometry deletion never filters by z3');
ok(!/recovered_authoritative/.test(geomDel), 'RECOVERY geometry is never deleted by this path');
const rejDel = matSeg.slice(matSeg.indexOf('delete from geo.n5_point_reject r')).split('"""')[0];
ok(!/z3/.test(rejDel), 'reject clearing never filters by z3');

// ---- 7. GEOMETRY CURRENT STATE (not append-only) ----
ok(/on conflict \(source_key, feature_id\) do update/.test(py),
  'eligible points UPSERT — a corrected coordinate updates the canonical geom');
ok(/set geom = excluded\.geom/.test(py), 'the update actually replaces the geometry');
ok(/v\.verdict <> 'ELIGIBLE'/.test(py), 'ineligible projects have their stale pt:1 removed');

// ---- 8. REJECT CURRENT STATE ----
ok(/constraint n5_point_reject_pkey primary key \(source_key\)/.test(code),
  'reject identity is project-global (source_key alone)');
const rejDdl = code.slice(code.indexOf('create table if not exists geo.n5_point_reject'),
  code.indexOf('create table if not exists geo.n5_proven_verdict'));
ok(/observed_in_z3/.test(rejDdl) && !/primary key \(z3/.test(rejDdl),
  'z3 is retained only as diagnostic metadata, not as identity');
ok(/where r\.source_key = v\.source_key and v\.verdict = 'ELIGIBLE'/.test(py),
  'a newly eligible project has its stale reject cleared');
ok(/on conflict \(source_key\) do update\s*\n?\s*set reason = excluded\.reason/.test(py),
  'an ineligible project holds exactly its CURRENT reason');

// ---- 9. JURISDICTION RULING ----
ok(!/ST_Intersects/.test(pycode.slice(pycode.indexOf('def refresh_proven_verdict_sql'),
                                      pycode.indexOf('def stage_associations'))),
  'no jurisdiction containment test in the PROVEN gate');
ok(!/'OUTSIDE_JURISDICTION'/.test(py), 'v1 never EMITS OUTSIDE_JURISDICTION as a SQL literal');
ok(/'OUTSIDE_JURISDICTION'/.test(code), 'the reason stays RESERVED in the schema vocabulary');
ok(/ZIP-page materialization is NOT jurisdiction evidence/.test(sql)
   || /not jurisdiction evidence/i.test(sql), 'the migration documents why page ZIP is not jurisdiction');
ok(/not an address ZIP/.test(py), 'the builder documents the same');

// ---- 10. COORDINATE PAIRS ----
ok(!/min\(fr\.lat\)|min\(fr\.lng\)|min\(i\.lat\)|min\(i\.lng\)/.test(pycode),
  'no independent latitude/longitude aggregation anywhere');
ok(/pairs as \(select distinct source_key, lat, lng from src/.test(py),
  'distinct OBSERVED pairs are derived from the same row');
ok(/c\.ncoord=1/.test(py), 'a coordinate is taken only when exactly one distinct pair exists');

// ---- 11. ASSOCIATION pt PATH USES THE GLOBAL VERDICT ----
// Scope this to the pt CTE ITSELF. Asserting on the whole file passed even when the CTE was
// reverted to the shard-local slice, because n5_proven_verdict also appears in the
// materializer — a guard that cannot fail is not a guard.
const ptCte = py.slice(py.indexOf('pt as ('), py.indexOf('rec as ('));
ok(ptCte.length > 40 && ptCte.length < 600, 'pt CTE located');
ok(/geo\.n5_proven_verdict/.test(ptCte) && /verdict='ELIGIBLE'/.test(ptCte),
  'the pt CTE itself reads the project-global verdict');
ok(!/\bfr\b/.test(ptCte), 'the pt CTE no longer reads the shard-local frozen slice');
ok(/EXPECTED SEMANTIC CORRECTION/.test(py),
  'the association change is documented as a correction, not hidden behind the old invariant');
ok(/13 COMPLETED shards the impact is ZERO/.test(py) && /579 -> 609/.test(py),
  'the measured impact is recorded at the decision site');
ok((py.match(/from geo\.n5_geom g join proj p/g) || []).length === 1,
  'exactly one geometry->association path');

// ---- 12. RECONCILIATION GATE ----
ok(/staged_not_prior/.test(py) && /prior_not_staged/.test(py), 'bidirectional diffs computed');
ok(/if prior > 0 and drift and not ALLOW_ASSOCIATION_DELTA:/.test(py), 'any delta HALTS a rebuild');
ok(/raise SystemExit\([\s\S]{0,400}Refusing to swap/.test(py), 'the halt is a raise, not a print');

// ---- 13. CACHE PROBE ----
ok(/where provenance='recovered_authoritative' and source_key in \(/.test(py),
  'cache reuse counts only recovered_authoritative geometry');
ok(!/geometry cache/i.test(py), 'no disposable-cache wording remains');

// ---- 14. FAIL CLOSED ----
ok(/A row-count check is NOT a readiness check/.test(py),
  'the row-count guard was replaced by a readiness gate, and why is recorded');
ok(/NOT RUN AUTOMATICALLY/.test(py), 'the expensive verdict refresh is not run implicitly');

// ---- 15. MIGRATION SAFETY ----
ok(!/\b760\b/.test(code), 'migration does not reference shard 760');
ok(!/b4_/.test(code), 'migration does not touch B4');
ok(!/vacuum full/i.test(code) && !/\bdrop table\b/i.test(code), 'no reclamation, no table drops');
ok(!/insert into geo\.n5_geom/i.test(code), 'migration performs no PROVEN backfill');

// ---- 16. SNAPSHOT LIFECYCLE (round 4) ----
ok(/os\.environ\.get\("SNAPSHOT", ""\)/.test(py), 'SNAPSHOT has NO default');
ok(/def require_snapshot/.test(py) && /require_snapshot\(\)/.test(py.slice(py.indexOf('def assert_snapshot_consumable'))),
  'the requirement is enforced at run time, not on import (import must stay safe)');
ok(/SNAPSHOT must be set explicitly - there is no default/.test(py), 'an unset SNAPSHOT fails closed');

ok(/create table if not exists geo\.n5_verdict_manifest/.test(code), 'verdict manifest exists');
ok(/check \(state in \('BUILDING','READY','FAILED'\)\)/.test(code), 'manifest states are an allowlist');
ok(/state <> 'READY' or \(completed_at is not null and expected_source_keys is not null/.test(code),
  'READY requires recorded completeness');
ok(/canonical_synced_at is null or state = 'READY'/.test(code),
  'canonical sync is only meaningful for a READY verdict');
ok(!/alter table geo\.n5_snapshot/.test(code), 'geo.n5_snapshot is NOT overloaded');

// READY + synced gate
ok(/def assert_snapshot_consumable/.test(py), 'a consumption gate exists');
ok(/if str\(row\["state"\]\) != "READY":/.test(py),
  'a non-READY verdict is refused by a live conditional, not just a message');
ok(/if not row\["synced"\]:/.test(py),
  'a READY-but-unsynced verdict is refused by a live conditional');
ok(/if int\(row\["input_exists"\]\) == 0:/.test(py),
  'an unknown snapshot is refused by a live conditional');
ok(/point sweep has not completed/.test(py) && /never consumable/.test(py),
  'both refusals carry an explanatory message');
const gateSeg = py.slice(py.indexOf('def assert_snapshot_consumable'),
  py.indexOf('def validate_verdict_completeness'));
ok(/snapshot_id=\{lit\(SNAPSHOT\)\}/.test(gateSeg),
  'the gate selects by EXACT snapshot equality');
ok(!/order by/i.test(gateSeg) && !/limit 1/i.test(gateSeg),
  'the gate never orders or limits to pick a snapshot (no MAX/latest/fallback)');
ok(/assert_snapshot_consumable\(\)/.test(py.slice(py.indexOf('def materialize_proven_points'))),
  'materialization consumes only a gated snapshot');
ok(!/geo\.n5_proven_verdict is empty for snapshot/.test(py),
  'the weak row-count guard is gone (a half-built snapshot would have passed it)');
const runShard = py.slice(py.indexOf('def run_shard'));
ok(runShard.indexOf('assert_snapshot_consumable()') < runShard.indexOf('FREEZE'),
  'the gate runs before freeze/recovery/materialization/association');

// n5_geom + reject snapshot provenance
ok(/check \(\(provenance = 'proven_stored_point'\) = \(verdict_snapshot_id is not null\)\)/.test(code),
  'proven <=> verdict_snapshot_id non-null, enforced structurally');
ok(/verdict_snapshot_id text not null,/.test(code), 'current rejects carry their verdict snapshot');
ok(/constraint n5_point_reject_pkey primary key \(source_key\)/.test(code),
  'reject identity is STILL source_key alone (snapshot is provenance, not identity)');
ok(/"verdict_snapshot_id": SNAPSHOT/.test(py), 'shard detail records the verdict snapshot');
ok(!/alter table geo\.n5_association add column/.test(code), 'association rows are NOT widened');

// global sweep
ok(/def global_canonical_sweep_sql/.test(py), 'the global S1->S2 sweep exists as a code path');
const sweepFn = py.slice(py.indexOf('def global_canonical_sweep_sql'), py.indexOf('def refresh_proven_verdict_sql'));
// Slice past the docstring: it legitimately SAYS "no z3", which the absence check would match.
const sweep = sweepFn.slice(sweepFn.indexOf('return ['));
ok(/not exists \(select 1 from geo\.n5_proven_verdict v/.test(sweep),
  'a project ABSENT from the new snapshot loses its stale pt:1');
ok((sweep.match(/provenance='proven_stored_point'/g) || []).length >= 2,
  'every sweep delete is scoped to the proven slot — RECOVERY geometry untouched');
ok(!/for .* in .*:/.test(sweep), 'the sweep is set-based SQL, not an application-side row loop');
ok(!/z3/.test(sweep.replace(/observed_in_z3/g,'').replace(/first_z3/g,'')),
  'the sweep has no z3 ownership (first_z3/observed_in_z3 are columns, not scoping)');
ok(/NOT EXECUTED BY THIS MODULE/.test(sweepFn), 'the sweep is not run here');
ok(/PUBLICATION BARRIER/.test(sweepFn),
  'the publication barrier is documented at the sweep');

// completeness validation
ok(/def validate_verdict_completeness/.test(py), 'completeness validation exists');
ok(/except select source_key from v/.test(py) && /except select source_key from auth/.test(py),
  'missing AND extra are both reconciled');
ok(!/723449/.test(py), '723,449 never appears as a numeric literal — receipt evidence only');
ok(/ORPHAN \/ INPUT BASELINE ABSENT \/ NOT CONSUMABLE/.test(sql),
  'the orphan S2 manifest row is documented, not deleted');

process.exit(fails ? 1 : 0);
