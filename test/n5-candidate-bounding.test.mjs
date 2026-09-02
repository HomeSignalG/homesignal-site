// N5 candidate-bounding invariant — executed by the REQUIRED offline CI gate.
//
// The boundary-first pass exists because `scripts/n5_shard.py::build_associations`
// joins geo.n5_geom to `proj` (the shard's frozen slice) rather than to `bnd`, so the
// national geometry corpus is narrowed to what the legacy 3-mile method already placed
// in that prefix BEFORE any ST_Intersects runs. That is why the association layer
// measures over-inclusion well and is nearly blind to under-inclusion (QUEUE.md,
// 2026-09-02). Rebuilding that narrowing "for performance" would silently undo the
// whole exercise, so the invariant is a gate rather than a comment.
//
// This file must FAIL against a planted defect, not merely pass in a codebase that
// never had one. The two plants below are the real shapes: a `join proj` narrowing and
// a `first_z3` predicate. Both are asserted to be REJECTED; if the validator is
// neutered, these assertions fail.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Call the SHIPPED validator, never a re-implementation — a copy here would pass
// forever while the real rule drifted.
const check = (sql) => JSON.parse(execFileSync('python3', [
  '-c',
  [
    'import sys, json',
    'sys.path.insert(0, sys.argv[1])',
    'from n5_candidate_bounding import check_candidate_bounding',
    'print(json.dumps(check_candidate_bounding(sys.stdin.read())))',
  ].join('\n'),
  join(root, 'scripts'),
], { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }));

const CLEAN = `
-- Boundary-first: probe every ZCTA against the WHOLE corpus. The prose in this
-- comment says ZIP on purpose — comments are stripped before scanning, and a rule
-- that tripped on its own documentation would be abandoned within a week.
select b.zcta5, g.source_key
  from bnd b
  join geo.n5_geom g
    on g.outcome = 1 and g.geom is not null and ST_Intersects(g.geom, b.geom)
 group by b.zcta5, g.source_key;`;

let pass = 0;
const ok = (name, cond) => { assert.ok(cond, `FAIL — ${name}`); console.log(`PASS — ${name}`); pass++; };

ok('an admissible boundary-first pass is accepted', check(CLEAN).length === 0);
ok('its own comment prose mentioning ZIP does not trip the rule',
   check(CLEAN).length === 0 && CLEAN.includes('ZIP'));

// PLANT 1 — the defect verbatim. Names no forbidden table and no forbidden column:
// identifier matching alone does NOT catch it, which is why the structural rule exists.
const PLANT_JOIN_PROJ = CLEAN.replace(
  'join geo.n5_geom g\n    on',
  'join geo.n5_geom g join proj p on p.source_key = g.source_key\n    on');
ok('a planted `join proj` narrowing is REJECTED',
   check(PLANT_JOIN_PROJ).includes('MEMBERSHIP_PREDICATE:source_key_used_as_predicate'));

// PLANT 2 — the same defect wearing provenance clothing.
const PLANT_FIRST_Z3 = CLEAN.replace("g.outcome = 1", "g.first_z3 = '010' and g.outcome = 1");
ok('a planted `first_z3` predicate is REJECTED',
   check(PLANT_FIRST_Z3).includes('MEMBERSHIP_PREDICATE:first_z3'));

// A rename cannot defeat the structural rule, which is why it matches the predicate
// rather than the CTE name `proj`.
ok('the same narrowing under a renamed CTE is still REJECTED',
   check(CLEAN.replace('join geo.n5_geom g\n    on',
     'join geo.n5_geom g join whatever w on w.source_key = g.source_key\n    on'))
     .includes('MEMBERSHIP_PREDICATE:source_key_used_as_predicate'));

ok('a subquery form (`source_key in (select …)`) is REJECTED',
   check(CLEAN.replace('g.outcome = 1',
     'g.source_key in (select source_key from proj) and g.outcome = 1'))
     .includes('MEMBERSHIP_PREDICATE:source_key_used_as_predicate'));

for (const [ident, sql] of [
  ['zip',    CLEAN.replace('b.zcta5,', 'b.zcta5, b.zip,')],
  ['z3',     CLEAN.replace('g.outcome = 1', "g.z3 = '010' and g.outcome = 1")],
  ['state',  CLEAN.replace('g.outcome = 1', "g.state = 'MA' and g.outcome = 1")],
  ['county', CLEAN.replace('g.outcome = 1', "g.county = 'Suffolk' and g.outcome = 1")],
  ['coverage', CLEAN.replace('g.outcome = 1', 'g.coverage @> b.geom and g.outcome = 1')],
]) {
  ok(`a \`${ident}\` predicate on the geometry side is REJECTED`,
     check(sql).includes(`MEMBERSHIP_PREDICATE:${ident}`));
}

ok('reading geo.n5_frozen is REJECTED',
   check(`${CLEAN} select * from geo.n5_frozen;`).includes('MEMBERSHIP_TABLE:n5_frozen'));
ok('reading geo.n5_association is REJECTED',
   check(`${CLEAN} select * from geo.n5_association;`).includes('MEMBERSHIP_TABLE:n5_association'));

// Fail-closed eligibility is REQUIRED, not optional: dropping it would admit
// outcome=3 rows (geom NULL) and any future outcome code by default.
const NO_GATE = check(CLEAN.replace('g.outcome = 1 and g.geom is not null and ', ''));
ok('dropping the fail-closed eligibility allowlist is REJECTED',
   NO_GATE.includes('MISSING_REQUIRED:outcome') && NO_GATE.includes('MISSING_REQUIRED:geom is not null'));
ok('dropping ST_Intersects is REJECTED',
   check(CLEAN.replace('ST_Intersects(g.geom, b.geom)', 'true')).includes('MISSING_REQUIRED:st_intersects'));

console.log(`\nAll ${pass} candidate-bounding assertions passed.`);
