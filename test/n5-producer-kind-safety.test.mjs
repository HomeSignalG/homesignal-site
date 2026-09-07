// PRODUCER SAFETY FOR REGULATED FACILITY GEOGRAPHY.
//
// THE FAILURE THIS PREVENTS, stated as the thing that would actually happen:
// the N5 producers rebuild geo.zip_authoritative_membership / _marker ONE ZIP3 PREFIX AT A
// TIME, and each rebuild is `delete ... where left(zcta5,3) = PFX` followed by an insert that
// regenerates DEVELOPMENT rows only. Add facility rows to those relations and the next
// development rebuild of that prefix deletes every facility row under it and never puts one
// back - silently, because the producer's own verification counted a single kind-blind
// total, and a missing facility row looks like nothing at all.
//
// Facility geography is deliberately unpopulated today (record_kind='facility' is 0 in both
// relations, measured 2026-09-07), so every change these tests cover is a provable no-op on
// current behaviour. That is the point: the guard has to exist BEFORE the first facility row,
// because after it the damage is already possible.
//
// WHY THIS TEST EVALUATES THE PREDICATE INSTEAD OF GREPPING FOR IT.
// A test that asserts "the source contains record_kind = 'development'" passes on SQL that
// cannot run. That is not hypothetical: while writing this change an edit produced
//     select ... from geo.zip_authoritative_membership where record_kind='development' and
//     where left(zcta5,3)='840';
// - two WHERE keywords, valid Python, invalid SQL, and carrying the exact substring a grep
// would have been satisfied by. So the DELETE's WHERE clause is parsed out of the shipped
// source and EXECUTED against a fixture row set by a small evaluator that fails closed on
// anything it cannot parse. What is asserted is which rows survive, not which words appear.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('FAIL ' + m); } };

const src = (f) => readFileSync(join(root, 'scripts', f), 'utf8');
const SHADOW = src('n5_unit_a_shadow.py');
const MARKERS = src('n5_a3_markers.py');

// Resolve the f-string interpolation the way Python does at import: `{NAME}` from the
// module's own constant, `{{X}}` collapsing to a literal `{X}` placeholder. The doubled
// braces are parked on a sentinel first so the single-brace pass cannot eat them.
function resolve(py, sqlText) {
  let out = sqlText.replace(/\{\{(\w+)\}\}/g, '@@PH:$1@@');
  out = out.replace(/\{(\w+)\}/g, (m, name) => {
    // Relation names are quoted strings; the rule parameters (MIN_LINE_M, D_M, ...) are
    // bare numbers. Both are module constants and both must resolve, or the statement under
    // test is not the statement that ships.
    // Two declaration shapes, both real in these modules:
    //   MEMB = "geo.zip_authoritative_membership"        - a relation name
    //   D_M  = float(os.environ.get("MARKER_D_M", "1000")) - a tunable with a default
    // The second is resolved to its DEFAULT, which is what Python produces with the env
    // var unset - the same value the production run uses unless someone overrides it.
    let decl = new RegExp('^' + name + '\\s*=\\s*"([^"]+)"', 'm').exec(py);
    if (decl) return decl[1];
    decl = new RegExp('^' + name + '\\s*=\\s*\\w+\\(os\\.environ\\.get\\("[^"]+",\\s*"([^"]+)"\\)\\)', 'm').exec(py);
    if (decl) return decl[1];
    throw new Error('unresolved f-string constant {' + name + '}');
  });
  return out.replace(/@@PH:(\w+)@@/g, '{$1}');
}

// Pull a triple-quoted module constant (POPULATE = f"""..."""") out of the shipped source.
function constant(py, name) {
  const re = new RegExp(name + '\\s*=\\s*f?"""([\\s\\S]*?)"""');
  const m = re.exec(py);
  if (!m) throw new Error('constant ' + name + ' not found');
  return resolve(py, m[1]);
}

// -- the evaluator ----------------------------------------------------------------------
// Supports exactly the grammar these producers use. Anything else throws, so a future
// rewrite fails loudly rather than being silently waved through.
function parsePredicate(where) {
  const terms = where.trim().replace(/;+\s*$/, '').split(/\s+and\s+/i);
  return terms.map((t) => {
    const s = t.trim();
    let m = /^left\(\s*(\w+)\s*,\s*(\d+)\s*\)\s*=\s*'([^']*)'$/i.exec(s);
    if (m) { const [, col, n, v] = m; return (r) => String(r[col]).slice(0, Number(n)) === v; }
    m = /^(?:\w+\.)?(\w+)\s*=\s*'([^']*)'$/.exec(s);
    if (m) { const [, col, v] = m; return (r) => r[col] === v; }
    throw new Error('unsupported predicate term: ' + JSON.stringify(s));
  });
}
function whereOf(stmt) {
  const i = stmt.toLowerCase().indexOf(' where ');
  if (i < 0) throw new Error('statement has no WHERE at all');
  const rest = stmt.slice(i + 7);
  if (/\bwhere\b/i.test(rest)) throw new Error('statement has a second WHERE: ' + stmt.trim());
  return rest;
}
const matches = (stmt, row) => parsePredicate(whereOf(stmt)).every((f) => f(row));

// -- the fixture: two prefixes, both kinds, so every direction is observable -------------
// Real ZIPs, and note 84302 is prefix 843 - NOT 840. That is deliberate: the first draft of
// this fixture assumed it was, the delete matched one row instead of two, and the test said
// so. A fixture whose prefixes are asserted rather than assumed is the point.
const ROWS = [
  { id: 'dev-840-a', zcta5: '84010', record_kind: 'development' },  // in prefix, rebuilt
  { id: 'dev-840-b', zcta5: '84041', record_kind: 'development' },  // in prefix, rebuilt
  { id: 'FAC-840-a', zcta5: '84010', record_kind: 'facility' },     // SAME ZIP as a deleted dev row
  { id: 'FAC-840-b', zcta5: '84041', record_kind: 'facility' },     // in prefix, must survive
  { id: 'dev-843-a', zcta5: '84302', record_kind: 'development' },  // other prefix, untouched
  { id: 'FAC-843-a', zcta5: '84302', record_kind: 'facility' },     // other prefix, untouched
];
const PFX = '840';
const deleteOf = (sqlText) => {
  const line = sqlText.split('\n').find((l) => /^delete from/i.test(l.trim()));
  if (!line) throw new Error('no delete statement');
  return line.replace('{PFX}', "'" + PFX + "'");
};

const CASES = [
  ['n5_unit_a_shadow.py POPULATE (membership)', deleteOf(constant(SHADOW, 'POPULATE'))],
  ['n5_a3_markers.py BUILD (marker)', deleteOf(constant(MARKERS, 'BUILD'))],
];

for (const [label, del] of CASES) {
  ok(/geo\.zip_authoritative_(membership|marker)/.test(del),
    `0: ${label} - delete targets the kind-bearing relation`);

  const deleted = ROWS.filter((r) => matches(del, r));
  const survived = ROWS.filter((r) => !matches(del, r));

  // 1. a DEVELOPMENT prefix rebuild removes exactly the development rows of that prefix
  ok(deleted.length === 2 && deleted.every((r) => r.id.startsWith('dev-840')),
    `1: ${label} - deletes exactly the two development rows in prefix ${PFX} `
    + `(got ${deleted.map((r) => r.id).join(',') || 'none'})`);

  // 2. facility rows in the SAME prefix survive - including one sharing a ZIP with a
  //    deleted development row, which is the case a ZIP-level guard would miss
  ok(survived.some((r) => r.id === 'FAC-840-a') && survived.some((r) => r.id === 'FAC-840-b'),
    `2: ${label} - facility rows in prefix ${PFX} survive`);
  ok(!deleted.some((r) => r.record_kind === 'facility'),
    `2: ${label} - no facility row is deleted anywhere`);

  // 3. development output is unchanged from current behaviour: rows OUTSIDE the prefix are
  //    untouched, exactly as before, so the added predicate narrows and never widens
  ok(survived.some((r) => r.id === 'dev-843-a') && survived.some((r) => r.id === 'FAC-843-a'),
    `3: ${label} - rows outside the prefix are untouched, both kinds`);
  const kindBlind = ROWS.filter((r) => r.zcta5.slice(0, 3) === PFX);
  const devOnly = kindBlind.filter((r) => r.record_kind === 'development');
  ok(deleted.length === devOnly.length,
    `3: ${label} - the development half of the old kind-blind set is deleted in full `
    + `(${deleted.length}/${devOnly.length})`);

  // 5. MUTATION PROOF - the predicate is load-bearing, not decoration. Strip it from the
  //    SHIPPED statement and the facility rows must start being deleted; if they do not,
  //    this test is asserting nothing and says so.
  const mutated = del.replace(/\s+and\s+record_kind\s*=\s*'development'/i, '');
  ok(mutated !== del, `5: ${label} - the mutation actually changed the statement`);
  const mutatedDeleted = ROWS.filter((r) => matches(mutated, r));
  ok(mutatedDeleted.some((r) => r.record_kind === 'facility'),
    `5: ${label} - WITHOUT the predicate the rebuild destroys facility rows (mutation proof)`);
  ok(mutatedDeleted.length === kindBlind.length,
    `5: ${label} - the unsafe form takes the whole prefix, both kinds `
    + `(${mutatedDeleted.length}/${kindBlind.length})`);
}

// -- 4. the writer STATES its kind rather than inheriting a column default ---------------
for (const [label, py, name, rel] of [
  ['POPULATE', SHADOW, 'POPULATE', 'geo.zip_authoritative_membership'],
  ['BUILD', MARKERS, 'BUILD', 'geo.zip_authoritative_marker'],
]) {
  const stmt = constant(py, name);
  const ins = new RegExp('insert into ' + rel.replace('.', '\\.') + '\\s*\\(([^)]*)\\)').exec(stmt);
  ok(!!ins, `4: ${label} - insert into ${rel} found`);
  ok(ins && /\brecord_kind\b/.test(ins[1]),
    `4: ${label} - the insert names record_kind explicitly `
    + `(columns: ${ins && ins[1].replace(/\s+/g, ' ').trim()})`);
  ok(/'development'/.test(stmt), `4: ${label} - and supplies 'development' as the value`);
}

// A development rebuild must not READ facility membership either: scoping only the delete
// would still generate development markers FROM facility rows.
const memberJoins = (py) =>
  (py.match(/join geo\.zip_authoritative_membership m\b[\s\S]{0,120}?(?=\n\s*(?:cross|join|where|\)|select))/g) || []);
for (const [label, py] of [['n5_a3_markers.py', MARKERS]]) {
  const joins = memberJoins(py);
  ok(joins.length > 0, `4: ${label} - membership joins located (${joins.length})`);
  const unscoped = joins.filter((j) => !/record_kind\s*=\s*'development'/.test(j));
  ok(unscoped.length === 0,
    `4: ${label} - every membership join is kind-scoped (${unscoped.length} unscoped)`);
}

// -- 6. producer verification reports and asserts BOTH kinds, separately -----------------
for (const [label, py, helper] of [
  ['n5_unit_a_shadow.py', SHADOW, 'facility_rows'],
  ['n5_a3_markers.py', MARKERS, 'facility_markers'],
]) {
  ok(new RegExp('def ' + helper + '\\(').test(py), `6: ${label} - has a ${helper}() probe`);
  // a COUNT alone cannot tell "untouched" from "deleted and re-inserted at the same size"
  ok(new RegExp('def ' + helper + '\\([\\s\\S]{0,1200}?md5\\(string_agg').test(py),
    `6: ${label} - ${helper}() fingerprints the rows, not just their number`);
  ok(/collate "C"/.test(py), `6: ${label} - that fingerprint pins its collation`);
  ok(/fac_before != fac_after/.test(py),
    `6: ${label} - the before/after facility state is compared`);
  ok(/development rebuild changed FACILITY/.test(py),
    `6: ${label} - and a change is a HARD STOP, not a warning`);
  ok(/raise SystemExit/.test(py), `6: ${label} - that stop is a raise`);
  ok(/DEVELOPMENT/.test(py) && /FACILITY/.test(py),
    `6: ${label} - both kinds are named in the reported line`);
}
// the development assertion must be measured on the development half alone, or the day
// facilities land it fails against a freeze basis that only ever held development
ok(/record_kind='development'\) memb,/.test(SHADOW),
  "6: shadow's membership-vs-authoritative equality counts the DEVELOPMENT half only");
ok(/record_kind='facility'\) memb_facility,/.test(SHADOW),
  '6: ...and the facility half is measured beside it rather than folded in');
ok(/record_kind='development';", "n"\)/.test(MARKERS) || /and record_kind='development';/.test(MARKERS),
  '6: markers per-prefix row count is the DEVELOPMENT count');

// -- 7. no prefix placeholder escapes unsubstituted --------------------------------------
for (const [label, stmt] of CASES) {
  ok(!/\{\w+\}/.test(stmt), `7: ${label} - no unsubstituted placeholder survives`);
}

// -- 8. the evaluator itself must be able to fail, or none of the above means anything ---
let threw = false;
try { matches("delete from x where zcta5 in (select 1) and record_kind = 'development';", ROWS[0]); }
catch (e) { threw = true; }
ok(threw, '8: the predicate evaluator rejects grammar it does not understand (fails closed)');
threw = false;
try { whereOf("select 1 from t where a='b' and where c='d';"); } catch (e) { threw = true; }
ok(threw, '8: ...and rejects the two-WHERE shape that a grep would have accepted');

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
