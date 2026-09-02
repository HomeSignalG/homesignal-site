// N5 canonical geometry provenance + association key correction — structural guards.
//
// CI has no database (same convention as test/app-projects-stable-key.test.mjs and
// test/app-refresh-zip-determinism.test.mjs), so these assert against the SQL of record and
// the builder source. The live measurements that justify the design were taken read-only on
// 2026-09-02 and are recorded here so they are auditable:
//
//   * geo.n5_association: 20,170 rows = 20,170 distinct (source_key, zip); 0 pairs carry
//     multiple evidence values. evidence is state, not identity — so the old PK
//     (source_key, zip, evidence) permitted a corruption that has not yet occurred.
//   * shard boundary left(zip,3): every one of the 13 completed shards' association counts
//     matches its stored detail.associations exactly, 0 rows outside the done set.
//   * geo.n5_geom is RECOVERY-exclusive today (recover_shard filters treatment='RECOVERY'),
//     which is what makes the backfill to 'recovered_authoritative' provably safe.
//   * PROVEN nationally: 145 sources, 729,575 distinct projects, of which 4,802 carry more
//     than one distinct coordinate and are excluded from v1.
//
// Shard 760 (Arlington / Fort Worth TX) is the approved later validation geography. Its
// PLANNING expectations — 17,226 projects, 16,964 PROVEN, 4 PROVEN registries, ~16,385
// single-coordinate candidates, ~579 MULTI_COORD_UNRESOLVED, 262 RECOVERY — are documented
// here as expectations, deliberately NOT asserted as acceptance values.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sql = readFileSync(join(root, 'docs/n5-canonical-geometry-provenance.sql'), 'utf8');
const py = readFileSync(join(root, 'scripts/n5_shard.py'), 'utf8');

// The migration header quotes the very things asserted absent ("cache", "b4", "760"), so
// code-level assertions strip whole-line SQL comments first — the false-failure recorded in
// test/app-projects-stable-key.test.mjs.
const code = sql.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');

// Absence-assertions must not match the builder's own PROSE. This file documents the very
// things it asserts absent ("pt:2 is RESERVED", "Deliberately NO `on conflict`"), which is how
// the first run of this suite produced four false failures. Strip # lines and plain docstrings;
// KEEP f""" """ bodies, which are executable SQL.
const pycode = py
  .replace(/(^|[^f])"""[\s\S]*?"""/g, '$1')
  .split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');

let fails = 0;
const ok = (c, n) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + n); if (!c) fails++; };

ok(sql.length > 4000 && py.length > 20000, 'migration + builder loaded (non-trivial)');
ok(code.length > 1500 && code.length < sql.length, 'comment-stripped SQL extracted');

// ---- 1. PROVENANCE: order, fail-closed, no default ----
const addAt = code.indexOf('add column if not exists provenance');
const backfillAt = code.indexOf("set provenance = 'recovered_authoritative'");
const assertAt = code.indexOf('provenance backfill incomplete');
const checkAt = code.indexOf('n5_geom_provenance_ck');
const notNullAt = code.indexOf('alter column provenance set not null');
ok(addAt > 0 && backfillAt > addAt, 'column added nullable BEFORE backfill');
ok(assertAt > backfillAt, 'zero-NULL assertion runs AFTER backfill');
ok(checkAt > assertAt, 'CHECK added AFTER the assertion');
ok(notNullAt > checkAt, 'NOT NULL enforced LAST');
ok(!/add column if not exists provenance[^;]*default/i.test(code)
  && !/alter column provenance set default/i.test(code),
  'provenance has NO default (a default would silently misclassify)');
ok(/check \(provenance in \('recovered_authoritative','proven_stored_point'\)\)/.test(code),
  'provenance allowlist is exactly the two approved v1 values');
ok(/raise exception 'n5_geom provenance backfill incomplete/.test(code),
  'incomplete backfill raises rather than constraining a dirty table');

// ---- 2. BUILDER writes provenance explicitly on both paths ----
ok(/insert into geo\.n5_geom \(source_key,registry_id,feature_id,outcome,geom,invalid_reason,first_z3,"\n\s*"provenance\)/.test(py),
  'recovered-geometry insert names the provenance column');
ok((py.match(/'recovered_authoritative'\)"/g) || []).length === 2,
  'both recovered rows (geometry and NO_GEOMETRY) stamp recovered_authoritative');
ok(/'pt:1', 1, g, null, \{lit\(z3\)\}, 'proven_stored_point'/.test(py),
  'admitted PROVEN point is stamped proven_stored_point');

// ---- 3. ELIGIBILITY GATE — all six reasons, enforced at insertion ----
for (const r of ['NO_REGISTRY_VERDICT','MULTI_COORD_UNRESOLVED','NULL_COORD','INVALID_COORD','NULL_ISLAND','OUTSIDE_JURISDICTION']) {
  ok(new RegExp(`'${r}'`).test(py), `gate produces ${r}`);
  ok(new RegExp(`'${r}'`).test(code), `reject table permits ${r}`);
}
ok(/where reject_reason is null/.test(py), 'ONLY candidates with no reject reason are materialized');
ok(/where reject_reason is not null/.test(py), 'every rejected candidate is recorded');
ok(/exists \(select 1 from verdict v where v\.registry_id = a\.registry_id\)/.test(py),
  'affirmative registry verdict is required');
ok(/gg\.lat not between -90 and 90/.test(py) && /gg\.lng not between -180 and 180/.test(py),
  'coordinate range is validated');
ok(/abs\(gg\.lat\) < 1e-9 and abs\(gg\.lng\) < 1e-9/.test(py), 'null-island is rejected');
ok(/ST_Intersects\(gg\.g, b\.geom\)/.test(py) && /from geo\.n5_zcta where z3=/.test(py),
  'jurisdiction uses the shard ZCTA semantics');
ok(/when gg\.ncoord > 1\s+then 'MULTI_COORD_UNRESOLVED'/.test(py),
  'multi-coordinate projects are rejected, not materialized');
ok(/Eligibility is enforced at insertion, not at query time|ELIGIBILITY IS ENFORCED AT INSERTION/i.test(py),
  'insertion-gate rationale is recorded in the code');
ok(/an insertion gate is a rule callers cannot forget/.test(py), 'the rationale states WHY');

// ---- 4. FEATURE IDENTITY ----
ok(/'pt:1'/.test(py), "admitted point uses the reserved slot pt:1");
// Every occurrence of pt:2 must be documentation. Checked per LINE against SQL verbs,
// because the builder legitimately documents that pt:2 is reserved.
const pt2Lines = py.split('\n').filter((l) => l.includes('pt:2'));
ok(pt2Lines.length > 0 && pt2Lines.every((l) => !/(insert|select|values|feature_id\s*=)/i.test(l)),
  'pt:2 appears only in documentation, never in emitted SQL');
ok(!/pt:\$\{|pt:" \+|'pt:' \+/.test(pycode), 'no computed pt: identifier is ever built');
ok(/RESERVED AND UNDEFINED/.test(py), 'pt:2+ is documented as reserved and undefined');
ok(/Identity is the SLOT, not the coordinate value/.test(py),
  'coordinate correction cannot change geometry-instance identity');
ok(!/md5\([^)]*\b(lat|lng)\b/.test(pycode), 'feature_id is not derived from the coordinate');

// ---- 5. ASSOCIATION PK CORRECTION ----
ok(/primary key \(source_key, zip\)/.test(code), 'new PK is (source_key, zip)');
ok(/drop constraint if exists n5_association_pkey/.test(code), 'old PK is dropped, not duplicated');
ok(/having count\(\*\) > 1/.test(code) && /having count\(distinct evidence\) > 1/.test(code),
  'both preconditions verified: duplicate pairs AND conflicting evidence');
ok(/raise exception[\s\S]{0,200}needs reconciliation first/.test(code),
  'nonzero preconditions STOP the migration');
ok(/Automatic reconciliation is deliberately NOT attempted/.test(code),
  'migration refuses to auto-reconcile');
ok(!/create (unique )?index[\s\S]{0,80}n5_association \(source_key, zip\)/i.test(code),
  'no second equivalent uniqueness index is added');

// ---- 6. STAGE-AND-SWAP ----
ok(/create table if not exists geo\.n5_association_stage/.test(code), 'staging table exists');
ok(/primary key \(z3, source_key, zip\)/.test(code),
  'stage PK enforces one evidence class per pair — a bad run fails in staging');
ok(/delete from geo\.n5_association_stage where z3=/.test(py), 'staging clears its own z3 first (idempotent rerun)');
const stageIns = py.indexOf('insert into geo.n5_association_stage');
const stageIdx = pycode.indexOf('insert into geo.n5_association_stage');
const stageSeg = pycode.slice(stageIdx, stageIdx + 400);
ok(stageIdx > 0 && !/on conflict/.test(stageSeg), 'staging insert has NO on-conflict — duplicates must fail loudly');
ok(/do \$swap\$/.test(py) && /\$swap\$;/.test(py), 'swap is a single DO block = one transaction');
const swapAt = py.indexOf('do $swap$');
const swapSeg = py.slice(swapAt, swapAt + 600);
ok(/delete from geo\.n5_association where/.test(swapSeg) && /insert into geo\.n5_association \(/.test(swapSeg),
  'swap deletes then inserts inside the same transaction');
ok(/left\(zip,3\)=/.test(swapSeg), 'swap is scoped to the verified shard boundary');
ok(/stage_associations\(z3\)[\s\S]{0,300}reconcile_stage\(z3\)[\s\S]{0,400}swap_shard\(z3\)/.test(py),
  'order is stage -> reconcile -> swap');
ok(/refusing to swap/.test(py), 'reconciliation failure prevents the swap');
ok(/staged.*!=.*staged_pairs|int\(rc\["staged"\]\) != int\(rc\["staged_pairs"\]\)/.test(py),
  'reconcile asserts staged rows == staged distinct pairs');

// ---- 7. REJECT LEDGER ----
ok(/constraint n5_point_reject_pkey primary key \(z3, source_key, reason\)/.test(code),
  'reject PK makes recording deterministic and idempotent');
ok(/on conflict \(z3, source_key, reason\) do nothing/.test(py), 'rerun cannot duplicate a reject');
ok(/source_key/.test(code.slice(code.indexOf('n5_point_reject'))), 'reject is queryable by source_key');

// ---- 8. ASSOCIATION INVARIANCE (semantic, not hard-coded totals) ----
ok(/ZERO NEW ASSOCIATION SEMANTICS/.test(py), 'the invariant is stated in the builder');
ok(/ALREADY participate in association/.test(py) && /`pt` CTE in build_associations/.test(py),
  'rationale names the existing pt CTE as the reason no association is added');
ok(!/20,?170|5,?592|9,?857|4,?721/.test(py),
  'production totals are NOT hard-coded into builder logic');
ok((py.match(/from geo\.n5_geom g join proj p/g) || []).length === 1,
  'exactly one geometry->association path (rec); no second PROVEN association path');
ok(/where p\.treatment='RECOVERY' and g\.geom is not null/.test(py),
  'rec stays RECOVERY-filtered, so persisted PROVEN points are not double-counted');

// ---- 9. CANONICAL-DATA LANGUAGE ----
ok(/PERMANENT CANONICAL PRODUCT GEOMETRY/.test(code), 'table comment states canonical product data');
ok(/MUST NOT be reclaimed, truncated, or /.test(code), 'comment forbids reclamation');
ok(!/cross-shard geometry cache/.test(py), 'the misleading "cross-shard geometry cache" wording is gone');
ok(/PERMANENT CANONICAL PRODUCT GEOMETRY/.test(py), 'builder carries the canonical wording too');

// ---- 10. MIGRATION SAFETY — schema only ----
ok(!/\b760\b/.test(code), 'migration does not reference shard 760');
ok(!/b4_/.test(code), 'migration does not touch B4');
ok(!/vacuum full/i.test(code), 'migration performs no reclamation');
ok(!/\bdrop table\b/i.test(code), 'migration drops no table');
ok(!/update geo\.n5_shard|delete from geo\.n5_association\b/i.test(code),
  'migration rebuilds no shard and deletes no association');
ok(!/insert into geo\.n5_geom/i.test(code),
  'migration performs NO national PROVEN backfill — materialization is shard-time only');

process.exit(fails ? 1 : 0);
