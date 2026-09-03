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
// The association PK is ALREADY (source_key, zip) in production, applied by the parallel
// session (f7c4b79) as a table swap. #1016 must therefore NOT re-author it.
ok(!/drop constraint if exists n5_association_pkey/.test(code)
   && !/add constraint n5_association_pkey/.test(code),
  'the association PK is validated, never re-authored by this migration');
ok(/APPLY THIS FILE AS A SINGLE STATEMENT\/SCRIPT/.test(sql),
  'the apply-mechanism gate is documented in the migration');

// ---- 2. PROVENANCE ----
// provenance + its backfill are the parallel session's and already applied; what #1016 adds
// nullable-then-populates-then-constrains is verdict_snapshot_id.
ok(code.indexOf('add column if not exists verdict_snapshot_id')
   < code.indexOf("set verdict_snapshot_id = 'phase1-2026-09-01'"),
  'verdict_snapshot_id is added nullable before it is backfilled');
ok(code.indexOf('provenance backfill incomplete') < code.indexOf('n5_geom_provenance_ck'),
  'zero-NULL assertion precedes the CHECK');
ok(code.indexOf('primary key (source_key)')
   < code.indexOf('alter column verdict_snapshot_id set not null'),
  'the reject PK is narrowed before verdict_snapshot_id is made NOT NULL');
ok(!/add column if not exists verdict_snapshot_id[^;]*default/i.test(code),
  'verdict_snapshot_id has NO default - NULL is the required value for recovered geometry');
ok(/n5_geom_provenance_ck is missing or unrecognised/.test(code)
   && /prov_ck !~ 'recovered_authoritative'/.test(code)
   && /prov_ck !~ 'proven_stored_point'/.test(code),
  'the provenance allowlist is VALIDATED against the two v1 values, not re-authored');

// ---- 3. pt: NAMESPACE STRUCTURALLY RESERVED ----
ok(/check \(\(provenance = 'proven_stored_point'\) = \(feature_id = 'pt:1'\)\)/.test(code),
  'biconditional CHECK reserves the pt: namespace');
ok(/legacy geometry namespace violated/.test(code)
   && /recovered squatting pt:\*/.test(code),
  'pre-existing namespace violators STOP the migration');
ok(!/'pt:2'/.test(pycode), 'no executable path emits pt:2');

// ---- 4. ASSOCIATION PK ----
ok(/PRIMARY KEY \(source_key, zip\)/.test(code)
   && /already applied by the parallel session/.test(code),
  'the migration requires the association PK to already be (source_key, zip)');
ok(/canonical-not-eligible=%, eligible-not-canonical=%/.test(code)
   && /ineligible-not-rejected=%, rejected-not-ineligible=%, reason mismatch=%/.test(code),
  'both directions of BOTH set-equality preconditions are verified in the gate');
ok(/Attribution refused/.test(code) && /raise exception/.test(code),
  'nonzero preconditions STOP the migration');

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
ok(/'OUTSIDE_JURISDICTION'/.test(sql) && !/'OUTSIDE_JURISDICTION'/.test(code),
  'OUTSIDE_JURISDICTION stays RESERVED and documented, and this migration never authors it');
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
ok(/add column if not exists verdict_snapshot_id text/.test(code)
   && /alter column verdict_snapshot_id set not null/.test(code),
  'current rejects carry their verdict snapshot, enforced NOT NULL after the rebuild');
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

// ---- 19. B1 POST-CREATION DEFINITION VALIDATION ----
const defn = code.slice(code.indexOf('do $defn$'), code.indexOf('end $defn$'));
ok(defn.length > 1500, 'B1 definition-validation block located');
ok(/pg_constraint/.test(defn) && /pg_attribute/.test(defn) && /format_type/.test(defn),
  'B1 reads CATALOG definitions, not the text of this file');
for (const t of ['geo.n5_proven_verdict', 'geo.n5_verdict_manifest', 'geo.n5_association_stage']) {
  ok(defn.includes(t), 'B1 validates ' + t);
}
ok(/'snapshot_id,source_key'/.test(defn) && /'z3,source_key,zip'/.test(defn),
  'B1 asserts the expected PRIMARY KEY column lists, in order');
ok(/act\.nn is distinct from w\.nn/.test(defn),
  'B1 asserts NULLABILITY, not just column presence');
ok(/act\.typ <> w\.typ/.test(defn), 'B1 asserts DATA TYPE where semantics depend on it');
ok(/canonical_synced_at/.test(defn) && /reject_counts/.test(defn) && /ncoord/.test(defn),
  'B1 covers the snapshot, verdict/eligibility and coordinate-bearing columns');
ok(/pg_get_constraintdef/.test(defn) && /position\(r\.token in d\.def\)/.test(defn),
  'B1 checks migration-critical CHECKs by DEFINITION token, not by name alone');
ok(/definition validation FAILED/.test(defn) && /raise exception/.test(defn),
  'B1 RAISES on an incompatible shape');
ok(!/alter table/i.test(defn) && !/drop table/i.test(defn),
  'B1 never ALTERs-to-repair or drops an unknown shape');

// ---- 20. B2 UNIQUE VERDICT DERIVATION ----
const mult = code.slice(code.indexOf('do $multiplicity$'), code.indexOf('end $multiplicity$'));
ok(mult.length > 500, 'B2 multiplicity block located');
ok(/group by d\.source_key having count\(\*\) <> 1/.test(mult),
  'B2 states the multiplicity invariant DIRECTLY: group by source_key having count(*) <> 1');
// \bexcept\b, not /except/i: the latter matches "raise exception" and would pass vacuously.
ok(!/\bexcept\b/i.test(mult),
  'B2 does not rely on EXCEPT / set-difference, which dedupes the very duplicate it must catch');
ok(/not one row per source_key/.test(mult) && /raise exception/.test(mult),
  'B2 RAISES on a duplicated derivation');
ok(!/distinct on/i.test(mult) && !/limit 1\b/.test(mult.replace(/limit 5/g, '')),
  'B2 never deduplicates automatically or picks an arbitrary coordinate');
ok(/geo\.n5_accepted_source/.test(mult) && /preservation\.app_project_identity/.test(mult),
  'B2 measures the EXACT authoritative derivation feeding the migration');
// ordering: B2 before the legacy gate, and both before any attribution or destruction
ok(code.indexOf('do $multiplicity$') < code.indexOf('do $gate$')
   && code.indexOf('do $multiplicity$') < code.indexOf("set verdict_snapshot_id = 'phase1")
   && code.indexOf('do $multiplicity$') < code.indexOf('do $reject_transition$'),
  'B2 runs BEFORE the gate, before attribution and before the destructive reject step');
ok(!/if legacy_points = 0/.test(mult),
  'B2 runs unconditionally - not behind the "are there legacy points" early return');

// ---- 21. TIMEOUT POLICY (lock_timeout / statement_timeout) ----
// `code` is the migration with comment lines stripped, so the migration's own prose about
// these settings cannot satisfy any assertion below. Every regex names the GUC explicitly,
// so no unrelated word (`exception`, `preset`, `resettable`, ...) can match.
const countOf = (re) => (code.match(re) || []).length;

// 21.1 / 21.2 — exactly one declaration each, with the exact authorized value.
ok(countOf(/^\s*set\s+local\s+lock_timeout\s*=\s*'5s'\s*;\s*$/gim) === 1,
  "exactly one `set local lock_timeout = '5s';`");
ok(countOf(/^\s*set\s+local\s+statement_timeout\s*=\s*'15min'\s*;\s*$/gim) === 1,
  "exactly one `set local statement_timeout = '15min';`");

// 21.3 / 21.4 — no BARE SET of either GUC anywhere. A bare SET is session-scoped: it would
// survive commit and, on a session-mode pooler, leak onto the next tenant of that backend.
// The negative lookahead is what distinguishes `set lock_timeout` from `set local lock_timeout`.
ok(countOf(/\bset\s+(?!local\b)(?:session\s+)?lock_timeout\b/gi) === 0,
  'lock_timeout is never assigned with a bare/session-scoped SET');
ok(countOf(/\bset\s+(?!local\b)(?:session\s+)?statement_timeout\b/gi) === 0,
  'statement_timeout is never assigned with a bare/session-scoped SET');

// 21.5 — both fall inside the transaction. SET LOCAL outside a transaction block warns and
// silently does nothing, so being after `begin;` is the difference between a policy and a
// no-op that looks like one.
const iBegin = code.search(/^begin;$/m);
const iLock  = code.search(/^\s*set\s+local\s+lock_timeout\b/im);
const iStmt  = code.search(/^\s*set\s+local\s+statement_timeout\b/im);
ok(iBegin >= 0 && iLock > iBegin && iStmt > iBegin,
  'both SET LOCALs occur AFTER begin; (outside a transaction they would be a silent no-op)');

// 21.6 — both precede every statement that can take a lock, §1's introspection included:
// a catalog read takes ACCESS SHARE and can itself queue behind someone else's exclusive lock.
const iWork = Math.min(...[
  /^do \$/m, /^\s*alter\s+table\b/im, /^\s*create\s+table\b/im, /^\s*create\s+index\b/im,
  /^\s*update\s+/im, /^\s*insert\s+into\b/im, /^\s*delete\s+from\b/im, /^\s*select\b/im,
].map((re) => { const i = code.search(re); return i < 0 ? Infinity : i; }));
ok(Number.isFinite(iWork) && iLock < iWork && iStmt < iWork,
  'both SET LOCALs precede the first lock-taking statement (introspection included)');

// 21.7 — nothing later clears or re-assigns them. A RESET or a second assignment mid-migration
// would silently return the rest of the transaction to unbounded waiting.
// Enumerate every assignment and check its VALUE, rather than negating with a lookahead:
// `=\s*(?!'5s')` backtracks \s* to zero width and then matches the space, so the negative
// form passes vacuously on the correct file. Found by this assertion failing on a correct
// migration - a false positive in the test, not a defect in the SQL.
const assigns = [...code.matchAll(/\bset\s+local\s+(lock_timeout|statement_timeout)\s*=\s*('[^']*')/gi)]
  .map((m) => [m[1].toLowerCase(), m[2]]);
ok(!/\breset\s+(all|lock_timeout|statement_timeout)\b/i.test(code)
   && !/\bset\s+local\s+(lock_timeout|statement_timeout)\s+to\s+default\b/i.test(code)
   && assigns.length === 2
   && assigns.every(([g, v]) => (g === 'lock_timeout' && v === "'5s'")
                             || (g === 'statement_timeout' && v === "'15min'")),
  'neither GUC is RESET, set TO DEFAULT, or re-assigned to any other value later');

// 21.8 — "immediately after begin;": the two declarations are the FIRST two statements of the
// transaction, in that order, with nothing executable between them and begin;.
const afterBegin = code.slice(iBegin).replace(/^begin;/, '');
const firstStmts = afterBegin.split(';').map((x) => x.trim()).filter((x) => x.length);
ok(/^set\s+local\s+lock_timeout\s*=\s*'5s'$/i.test(firstStmts[0] || '')
   && /^set\s+local\s+statement_timeout\s*=\s*'15min'$/i.test(firstStmts[1] || ''),
  'the two declarations are the first two statements after begin;, lock_timeout first');

process.exit(fails ? 1 : 0);
