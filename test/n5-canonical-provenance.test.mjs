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
ok(code.indexOf('begin;') < code.indexOf('drop table geo.n5_point_reject')
   && code.indexOf('drop table geo.n5_point_reject') < code.lastIndexOf('commit;'),
  'the destructive reject DROP is inside the transaction');
ok(code.indexOf('archive is NOT provably complete') < code.indexOf('drop table geo.n5_point_reject'),
  'the archive-complete gate precedes the destructive DROP');
ok(/APPLY THIS FILE AS A SINGLE STATEMENT\/SCRIPT/.test(sql),
  'the apply-mechanism gate is documented in the migration');

// ---- 2. PROVENANCE — VALIDATE, DO NOT RE-APPLY ----
// f7c4b79 already created provenance + CHECK + NOT NULL. Re-issuing that backfill is a
// loaded gun (it would relabel canonical PROVEN geometry if the column were ever nullable
// again). #1016 must refuse a missing provenance column, not recreate it.
ok(/VALIDATES that column/.test(sql) && /does not create it/.test(sql),
  'provenance is validated, not created, by this migration');
ok(!/add column if not exists provenance/.test(code),
  'this migration does not re-add the provenance column f7c4b79 already applied');
ok(!/set provenance = 'recovered_authoritative'/.test(code),
  'this migration does not re-run the f7c4b79 provenance backfill');
ok(/check \(provenance in \('recovered_authoritative','proven_stored_point'\)\)/.test(sql),
  'provenance allowlist is exactly the two v1 values (quoted as the definition this file validates)');

// ---- 3. pt: NAMESPACE STRUCTURALLY RESERVED ----
ok(/check \(\(provenance = 'proven_stored_point'\) = \(feature_id = 'pt:1'\)\)/.test(code),
  'biconditional CHECK reserves the pt: namespace');
ok(/wrong_feature_id/.test(sql) && /recovered_squatting_pt/.test(sql),
  'pre-existing namespace violators STOP the migration');
ok(!/'pt:2'/.test(pycode), 'no executable path emits pt:2');

// ---- 4. ASSOCIATION PK — ALREADY CORRECT, VALIDATED, NOT REBUILT ----
ok(/expected \(source_key,zip\)/.test(sql), 'association PK is required to already be (source_key, zip)');
ok(/already corrected this key by table swap/.test(sql),
  'a legacy three-column key is a STOP, not a silent rebuild');
ok(!/drop constraint if exists n5_association_pkey/.test(code),
  'this migration does not re-drop the association PK f7c4b79 already swapped');

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
ok(/constraint n5_point_reject_new_pkey primary key \(source_key\)/.test(code)
   || /constraint n5_point_reject_pkey primary key \(source_key\)/.test(code),
  'reject identity is project-global (source_key alone)');
const rejDdl = code.slice(code.indexOf('create table geo.n5_point_reject_new'),
  code.indexOf('create table if not exists geo.n5_proven_verdict'));
ok(rejDdl.length > 200, 'explicit reject rebuild (not create-if-not-exists) is present');
ok(/observed_in_z3/.test(rejDdl) && !/primary key \(z3/.test(rejDdl),
  'z3 is retained only as diagnostic metadata, not as identity');
ok(/create table if not exists geo\.n5_point_reject_archive/.test(code),
  'the legacy reject provenance is archived before rebuild');
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
ok(!/vacuum full/i.test(code), 'no reclamation');
ok(!/drop table geo\.n5_geom/i.test(code) && !/drop table geo\.n5_association\b/i.test(code),
  'canonical geometry and association tables are never dropped');
ok((code.match(/drop table geo\.n5_point_reject\b/g) || []).length === 1,
  'exactly one drop of the reject table, gated behind the archive-complete proof');
ok(!/insert into geo\.n5_geom/i.test(code),
  'migration inserts no geometry rows (Option D: keep the 718,278 canonical points)');
ok(/set verdict_snapshot_id = current_setting\('n5\.snapshot'/.test(code),
  'the only geometry write is the verdict_snapshot_id backfill of existing proven_stored_point rows');

// ---- 16. SNAPSHOT LIFECYCLE (round 4) ----
ok(/os\.environ\.get\("SNAPSHOT", ""\)/.test(py), 'SNAPSHOT has NO default');
ok(/def require_snapshot/.test(py) && /require_snapshot\(\)/.test(py.slice(py.indexOf('def assert_snapshot_consumable'))),
  'the requirement is enforced at run time, not on import (import must stay safe)');
ok(/SNAPSHOT must be set explicitly - there is no default/.test(py), 'an unset SNAPSHOT fails closed');

ok(/create table if not exists geo\.n5_verdict_manifest/.test(code), 'verdict manifest exists');
ok(/check \(state in \('BUILDING','READY','FAILED'\)\)/.test(code), 'manifest states are an allowlist');
ok(/constraint n5_verdict_manifest_ready_ck/.test(code), 'READY constraint exists');
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
ok(/verdict_snapshot_id  text        not null/.test(code)
   || /verdict_snapshot_id text not null/.test(code),
  'current rejects carry their verdict snapshot');
ok(/rename constraint n5_point_reject_new_pkey to n5_point_reject_pkey/.test(code)
   || /constraint n5_point_reject_pkey primary key \(source_key\)/.test(code),
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
ok(/EXECUTED BY EXACTLY ONE CALLER - sync_canonical\(\)/.test(sweepFn),
  'the sweep names its single caller — no shard runs it');
ok(/PUBLICATION BARRIER/.test(sweepFn),
  'the publication barrier is documented at the sweep');

// completeness validation
ok(/def validate_verdict_completeness/.test(py), 'completeness validation exists');
ok(/except select source_key from v/.test(py) && /except select source_key from auth/.test(py),
  'missing AND extra are both reconciled');
ok(!/723449/.test(py), '723,449 never appears as a numeric literal — receipt evidence only');
ok(/ORPHAN \/ INPUT BASELINE ABSENT \/ NOT CONSUMABLE/.test(sql),
  'the orphan S2 manifest row is documented, not deleted');

// ---- 17. VERDICT PUBLICATION PIPELINE + CANONICAL SYNCHRONIZATION (round 5) ----
// Every guard below asserts a LIVE CONDITIONAL or a LIVE CALL. None of them can be satisfied
// by a comment, a docstring, or an error-message string — each was verified by defeating the
// code it guards and confirming the guard turned red.

// 17a. the READY constraint's three-valued-logic hole
const readyCk = code.slice(code.indexOf('constraint n5_verdict_manifest_ready_ck'),
                           code.indexOf('constraint n5_verdict_manifest_sync_ck'));
ok(readyCk.length > 100 && readyCk.length < 900, 'READY constraint located');
for (const col of ['completed_at', 'expected_source_keys', 'verdict_rows', 'eligible_rows',
                   'reject_counts', 'fingerprint']) {
  ok(new RegExp(col + '\\s+is not null').test(readyCk),
    'READY asserts ' + col + ' IS NOT NULL (a NULL CHECK is ACCEPTED by PostgreSQL)');
}
ok(/verdict_rows = expected_source_keys/.test(readyCk),
  'READY still asserts the completeness equality');
ok(/state is not null|not null,\s*\n\s*state /.test(code) || /state {17}text {8}not null/.test(code),
  'manifest.state is NOT NULL, so the sync CHECK has no NULL branch of its own');

// 17b. frozen INPUT validation — the orphan snapshot must fail
ok(/def assert_frozen_input_present/.test(py), 'frozen input validation exists');
const frozenSeg = py.slice(py.indexOf('def assert_frozen_input_present'),
                           py.indexOf('def assert_snapshot_consumable'));
// Match the QUERY, not the docstring: the docstring legitimately names the relation, so a
// bare /preservation\.app_project_identity/ passed even with the query pointed elsewhere.
ok(/from preservation\.app_project_identity\s*\n\s*where snapshot_id=\{lit\(SNAPSHOT\)\} and record_kind='development'\) input_rows/.test(frozenSeg),
  'the frozen input is COUNTED from the INPUT RELATION, not from the declaration alone');
ok(/if int\(row\["input_rows"\]\) == 0:/.test(frozenSeg),
  'a zero-row snapshot is refused by a live conditional');
ok(/if int\(row\["declared"\]\) == 0:/.test(frozenSeg),
  'an undeclared snapshot is refused by a live conditional');

// 17c. publish_verdict — BUILDING -> BUILD -> VALIDATE -> RECORD -> READY, in that order
ok(/def publish_verdict/.test(py), 'the verdict publication entry point exists');
const pubSeg = py.slice(py.indexOf('def publish_verdict'),
                        py.indexOf('def verify_canonical_geometry_sets'));
ok(pubSeg.length > 1500, 'publish_verdict located');
ok(/assert_frozen_input_present\(\)/.test(pubSeg),
  'publication validates the frozen input before creating a manifest row');
ok(pubSeg.indexOf("'BUILDING'") < pubSeg.indexOf('refresh_proven_verdict_sql()'),
  'the manifest is set BUILDING BEFORE the verdict is rebuilt underneath it');
ok(/canonical_synced_at=null/.test(pubSeg),
  'entering BUILDING clears the canonical sync barrier');
ok(/expected_source_keys=null, verdict_rows=null/.test(pubSeg),
  'entering BUILDING clears every recorded completeness metric');
ok(/sql\(refresh_proven_verdict_sql\(\), /.test(pubSeg),
  'the verdict build is actually EXECUTED, not merely defined');
ok(/snapshot_id=\{lit\(SNAPSHOT\)\}/.test(pubSeg), 'publication writes are snapshot-keyed');
const refreshSeg = py.slice(py.indexOf('def refresh_proven_verdict_sql'), py.indexOf('def publish_verdict'));
ok(/delete from geo\.n5_proven_verdict where snapshot_id=\{lit\(SNAPSHOT\)\};/.test(refreshSeg),
  'the verdict rebuild deletes ONLY this snapshot rows — set replacement, not a truncate');
ok((py.match(/delete from geo\.n5_proven_verdict/g) || []).length
   === (py.match(/delete from geo\.n5_proven_verdict where snapshot_id=/g) || []).length,
  'EVERY delete against the verdict table is snapshot-scoped — S1 can never erase S2');
ok(!/truncate\s+(table\s+)?geo\./i.test(py), 'no TRUNCATE of any geo table');
ok(/v = validate_verdict_completeness\(\)/.test(pubSeg),
  'completeness validation is CALLED (it was previously dead code)');
for (const [re, name] of [[/if int\(v\["missing"\]\) != 0:/, 'missing'],
                          [/if int\(v\["extra"\]\) != 0:/, 'extra'],
                          [/if int\(v\["verdict_rows"\]\) != int\(v\["verdict_distinct"\]\):/, 'distinctness'],
                          [/if v\["fingerprint"\] is None:/, 'fingerprint']]) {
  ok(re.test(pubSeg), 'completeness ENFORCES ' + name + ' via a live conditional');
}
ok(/if problems:/.test(pubSeg) && pubSeg.indexOf('if problems:') < pubSeg.indexOf("state='READY'"),
  'the failure branch is evaluated BEFORE READY can be written');
ok(/state='FAILED', completed_at=now\(\)/.test(pubSeg),
  'a failed completeness check records FAILED');
ok(/raise SystemExit\("STOP: verdict completeness FAILED/.test(pubSeg),
  'a failed completeness check raises loudly');
ok(pubSeg.indexOf("state='READY'") > pubSeg.indexOf('validate_verdict_completeness()'),
  'READY is written only after validation has run');
ok(/where snapshot_id=\{lit\(SNAPSHOT\)\} and state='BUILDING';/.test(pubSeg),
  'the READY transition is guarded on the row still being BUILDING');
ok(/if str\(chk\["state"\]\) != "READY":/.test(pubSeg),
  'the READY transition is read back and verified by a live conditional');
ok(!/canonical_synced_at *= *now\(\)/.test(pubSeg),
  'publishing the verdict NEVER marks the canonical corpus synced');

// 17d. sync_canonical — invalidate FIRST, sweep, verify both set equalities, then publish
ok(/def sync_canonical/.test(py), 'the canonical synchronization entry point exists');
const syncSeg = py.slice(py.indexOf('def sync_canonical'),
                         py.indexOf('def materialize_proven_points'));
ok(syncSeg.length > 1500, 'sync_canonical located');
ok(/if str\(man\["state"\]\) != "READY":/.test(syncSeg),
  'the sweep refuses a non-READY verdict via a live conditional');
ok(/set canonical_synced_at=null/.test(syncSeg), 'the sweep invalidates the sync barrier');
ok(syncSeg.indexOf('set canonical_synced_at=null') < syncSeg.indexOf('global_canonical_sweep_sql()'),
  'INVALIDATION PRECEDES MUTATION — a half-swept corpus is never marked synced');
ok(!/finally:/.test(syncSeg),
  'the sync barrier is not set from a finally/cleanup path (a killed process never reaches one)');
ok(/for stmt, tag in global_canonical_sweep_sql\(\):/.test(syncSeg),
  'the sweep statements are actually EXECUTED (previously nothing called them)');
ok(syncSeg.indexOf('verify_canonical_geometry_sets()') > syncSeg.indexOf('global_canonical_sweep_sql()')
   && syncSeg.indexOf('verify_canonical_reject_sets()') > syncSeg.indexOf('global_canonical_sweep_sql()'),
  'both set-equality verifications run AFTER the sweep');
ok(/if bad:/.test(syncSeg) && syncSeg.indexOf('if bad:') < syncSeg.indexOf('canonical sync complete'),
  'a set mismatch is evaluated BEFORE the sync timestamp is written');
ok(/raise SystemExit\("HALT: canonical sets do not match/.test(syncSeg),
  'a set mismatch HALTS');
ok(/canonical_synced_at REMAINS NULL/.test(syncSeg),
  'the halt states that the snapshot stays unconsumable');
ok(/if not done\["synced"\]:/.test(syncSeg),
  'the sync write is read back and verified by a live conditional');

// 17e. exactly ONE writer of the canonical sync barrier, anywhere
ok((py.match(/canonical_synced_at *= *now\(\)/g) || []).length === 1,
  'canonical_synced_at = now() is written in EXACTLY ONE place in the module');
ok((syncSeg.match(/canonical_synced_at *= *now\(\)/g) || []).length === 1,
  'that one place is inside sync_canonical');
ok(/and state='READY';/.test(syncSeg.slice(syncSeg.indexOf('canonical_synced_at = now()'))) ||
   /set canonical_synced_at = now\(\)\s*\n\s*where snapshot_id=\{lit\(SNAPSHOT\)\} and state='READY';/.test(syncSeg),
  'the sync write re-checks state=READY at write time');

// 17f. post-sweep SET EQUALITY, both directions, both corpora
const geomVer = py.slice(py.indexOf('def verify_canonical_geometry_sets'),
                         py.indexOf('def verify_canonical_reject_sets'));
for (const col of ['eligible_not_canonical', 'canonical_not_eligible', 'coord_mismatch',
                   'wrong_snapshot']) {
  ok(new RegExp(col).test(geomVer), 'geometry verification measures ' + col);
}
ok(/except select source_key from can/.test(geomVer)
   && /except select source_key from elig/.test(geomVer),
  'geometry set equality is checked in BOTH directions');
ok(/abs\(ST_X\(c\.geom\) - e\.lng\)/.test(geomVer) && /abs\(ST_Y\(c\.geom\) - e\.lat\)/.test(geomVer),
  'coordinate equality is checked, not just membership');
ok(/verdict_snapshot_id is distinct from \{lit\(SNAPSHOT\)\}/.test(geomVer),
  'every canonical proven point must carry THIS snapshot');
const rejVer = py.slice(py.indexOf('def verify_canonical_reject_sets'), py.indexOf('def sync_canonical'));
for (const col of ['ineligible_not_rejected', 'rejected_not_ineligible', 'reason_mismatch',
                   'wrong_snapshot', 'eligible_still_rejected']) {
  ok(new RegExp(col).test(rejVer), 'reject verification measures ' + col);
}
ok(/sweep reject drop absent/.test(sweep),
  'the sweep drops rejects for projects absent from the snapshot (else both-direction '
  + 'reject equality could never reach zero)');

// 17g. no durable mutation before the gate
const mainSeg = py.slice(py.indexOf('def main():'), py.indexOf('COMMANDS = {'));
ok(mainSeg.indexOf('assert_snapshot_consumable()') > 0
   && mainSeg.indexOf('assert_snapshot_consumable()') < mainSeg.indexOf("state='running'"),
  'the snapshot gate runs BEFORE any shard is marked running');
const assocSeg = py.slice(py.indexOf('def associate(z3):'), py.indexOf('def shard_counts'));
ok(assocSeg.indexOf('assert_snapshot_consumable()') > 0
   && assocSeg.indexOf('assert_snapshot_consumable()') < assocSeg.indexOf('stage_associations(z3)'),
  'associate() is gated DIRECTLY, not only by its caller');

// 17h. operator entry points
ok(/"publish-verdict": publish_verdict/.test(py) && /"sync-canonical": sync_canonical/.test(py)
   && /"shards": main/.test(py), 'three named commands, one per publication act');
ok(/raise SystemExit\("STOP: unknown command/.test(py), 'an unknown command is refused');
ok(/sys\.exit\(cli\(sys\.argv\)/.test(py), 'the CLI dispatcher is the entry point');
ok(/require_snapshot\(\)/.test(py.slice(py.indexOf('def cli('))),
  'every command requires an explicit SNAPSHOT');

// ---- 18. AUDIT-INSTRUCTION HARDENING (round 5b) ----

// 18a. the consumability gate proves the FROZEN BASELINE, not just the declaration
ok(/from preservation\.app_project_identity\s*\n\s*where snapshot_id=\{lit\(SNAPSHOT\)\} and record_kind='development'\) input_rows/.test(gateSeg),
  'the shard/associate gate COUNTS the frozen baseline rows, not only the declaration');
ok(/if int\(row\["input_rows"\]\) == 0:/.test(gateSeg),
  'a declared-but-orphaned snapshot is refused by a live conditional in the gate itself');

// 18b. geometry reconciliation asserts the SLOT, not just membership
ok(/where feature_id is distinct from 'pt:1'\) wrong_feature_id/.test(geomVer),
  'every canonical proven row is proved to be feature_id pt:1');
ok(/where provenance is distinct from 'proven_stored_point'\) wrong_provenance/.test(geomVer),
  'every canonical proven row is proved to carry provenance proven_stored_point');
ok(/where provenance='proven_stored_point' or feature_id='pt:1'/.test(geomVer),
  'the slot is claimed by EITHER marker — an OR also catches a squatted pt:1');
ok(/GEOM_CHECKS = \("eligible_not_canonical", "canonical_not_eligible", "coord_mismatch",\s*\n\s*"wrong_feature_id", "wrong_provenance", "wrong_snapshot"\)/.test(syncSeg),
  'the halt list and the printed list are ONE tuple — a new check cannot be reported but unenforced');
ok(/bad = \[f"geometry\.\{k\}=\{g\[k\]\}" for k in GEOM_CHECKS/.test(syncSeg),
  'the geometry halt iterates that same tuple');

// 18c. completeness proves malformed rows impossible and the vocabulary closed
ok(/\) malformed,/.test(py) && /\) bad_verdict_value,/.test(py),
  'completeness measures malformed rows and out-of-vocabulary verdicts');
ok(/if int\(v\["malformed"\]\) != 0:/.test(pubSeg),
  'malformed verdict rows block READY via a live conditional');
ok(/if int\(v\["bad_verdict_value"\]\) != 0:/.test(pubSeg),
  'an out-of-vocabulary verdict blocks READY via a live conditional');

// 18d. stored metrics are RECONCILED after the write, not assumed
ok(/select sum\(value::bigint\) from jsonb_each_text\(reject_counts\)/.test(pubSeg),
  'the STORED reason counts are read back and summed');
ok(/if int\(chk\["count_sum"\] or -1\) != int\(v\["verdict_rows"\]\):/.test(pubSeg),
  'stored reason counts must sum to verdict_rows — live conditional');
ok(/if int\(chk\["stored_eligible"\]\) != int\(v\["eligible_rows"\]\):/.test(pubSeg),
  'the stored ELIGIBLE bucket must equal eligible_rows — live conditional');
ok(/if str\(chk\["fingerprint"\]\) != str\(v\["fingerprint"\]\):/.test(pubSeg),
  'the stored fingerprint must match the derivation — live conditional');

// 18e. BOTH reconciliations precede the sync write, by position not by narration
const syncWrite = syncSeg.indexOf('canonical_synced_at = now()');
ok(syncWrite > 0 && syncSeg.indexOf('g = verify_canonical_geometry_sets()') < syncWrite
   && syncSeg.indexOf('r = verify_canonical_reject_sets()') < syncWrite,
  'canonical_synced_at is written only AFTER both reconciliations have run');
ok(syncSeg.indexOf('raise SystemExit("HALT: canonical sets do not match') < syncWrite,
  'the halt on mismatch is positioned before the sync write, not after it');
ok(syncSeg.indexOf('set canonical_synced_at=null') < syncSeg.indexOf('sql(stmt, tag)'),
  'the barrier is cleared before the FIRST sweep mutation statement executes');

process.exit(fails ? 1 : 0);
