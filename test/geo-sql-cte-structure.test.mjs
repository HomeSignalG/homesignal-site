// The instrument that would have caught commit 47b005e.
//
// That commit shipped the marker BUILD with a MISSING COMMA between the `pt` and
// `expected` CTEs. Every structural (grep) assertion in
// test/geo-source-scoped-mutation.test.mjs passed, because every string it looks for
// was present. The statement could never have parsed. A pin that reads SQL as text
// cannot tell a statement that RUNS from one that merely CONTAINS the right words.
//
// The sandbox has no egress to Postgres, so this cannot be a real parse. What it CAN
// do is check the one structural property that broke: inside a `with` chain, each
// CTE's closing paren must be followed by a comma (another CTE) or by the statement
// keyword that consumes the chain. Narrow on purpose - a general SQL parser here
// would be a second implementation of something nobody maintains.
//
// §7 proves the checker FAILS on the reintroduced defect. A checker that has never
// produced a red is indistinguishable from one that cannot.
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; } else { fail++; console.log('FAIL: ' + m); } };
const section = (s) => console.log('\n-- ' + s);

// ---------------------------------------------------------------- the checker
//
// Strips string literals, dollar-quoted blocks and comments FIRST. Without that a
// comma inside `string_agg(x, ',' ...)` or a `)` inside a comment is read as
// structure, and the checker reports defects that are not there - the over-flagging
// direction, which is how a gate becomes noise and then gets deleted.
export function stripNoise(sql) {
  let out = '', i = 0;
  while (i < sql.length) {
    const two = sql.slice(i, i + 2);
    if (two === '--') { const nl = sql.indexOf('\n', i); i = nl < 0 ? sql.length : nl; continue; }
    if (two === '/*') { const e = sql.indexOf('*/', i + 2); i = e < 0 ? sql.length : e + 2; continue; }
    if (sql[i] === "'") {
      i++;
      while (i < sql.length) { if (sql[i] === "'" && sql[i + 1] === "'") { i += 2; continue; } if (sql[i] === "'") { i++; break; } i++; }
      out += "''"; continue;
    }
    if (sql[i] === '"') {
      i++; while (i < sql.length && sql[i] !== '"') i++; i++;
      out += '""'; continue;
    }
    const dq = /^\$[A-Za-z_]*\$/.exec(sql.slice(i));
    if (dq) { const tag = dq[0]; const e = sql.indexOf(tag, i + tag.length); i = e < 0 ? sql.length : e + tag.length; out += ' '; continue; }
    out += sql[i]; i++;
  }
  return out;
}

// Returns a list of human-readable problems; empty means the chain is well formed.
export function checkCteChain(sql) {
  const s = stripNoise(sql);
  const problems = [];
  const re = /\bwith\b/gi;
  let m;
  while ((m = re.exec(s)) !== null) {
    let i = m.index + m[0].length;
    for (;;) {
      // <name> [ ( cols ) ] as [materialized] ( body )
      const head = /^\s*(?:recursive\s+)?([A-Za-z_][A-Za-z_0-9]*)\s*(?:\([^)]*\)\s*)?as\s*(?:not\s+)?(?:materialized\s*)?\(/i.exec(s.slice(i));
      if (!head) break;
      let j = i + head[0].length, depth = 1;
      while (j < s.length && depth > 0) { if (s[j] === '(') depth++; else if (s[j] === ')') depth--; j++; }
      if (depth !== 0) { problems.push(`CTE ${head[1]}: unbalanced parentheses`); break; }
      const after = s.slice(j).replace(/^\s+/, '');
      if (after.startsWith(',')) { i = j + (s.slice(j).length - after.length) + 1; continue; }
      if (/^(select|insert|update|delete|merge|values|with|table)\b/i.test(after)) break;
      problems.push(`CTE ${head[1]}: closing ")" is followed by "${after.slice(0, 24).replace(/\s+/g, ' ')}" - `
                    + 'expected "," (another CTE) or the statement keyword');
      break;
    }
  }
  return problems;
}

// Pull triple-quoted SQL constants out of a Python module without importing it.
function pySqlConstants(path) {
  const src = readFileSync(path, 'utf8');
  const out = {};
  const re = /^([A-Z_][A-Z_0-9]*)\s*=\s*f?"""([\s\S]*?)"""/gm;
  let m;
  while ((m = re.exec(src)) !== null) out[m[1]] = m[2];
  return out;
}

section('1. the checker is sound on the SHIPPED reconciliation stages');
const recon = pySqlConstants('scripts/n5_reconcile_sql.py');
for (const name of ['STAGE2_BOUNDARY', 'STAGE3_MEMBERSHIP', 'STAGE4_MARKERS']) {
  const sql = recon[name];
  ok(sql !== undefined, `n5_reconcile_sql.py exposes ${name}`);
  if (sql === undefined) continue;
  const p = checkCteChain(sql);
  ok(p.length === 0, `${name} CTE chain: ${p.join(' | ')}`);
}
// `_STAGE1_CHANGED` is a PRELUDE, not a statement: it ends on the `changed` CTE and
// the caller appends the DELETE or the INSERT. Checked with each real continuation
// rather than alone, because alone it is correctly reported as ending in nothing -
// and a checker told to ignore that would stop seeing the real defect.
const prelude = recon['_STAGE1_CHANGED'];
ok(prelude !== undefined, 'n5_reconcile_sql.py exposes _STAGE1_CHANGED');
if (prelude !== undefined) {
  ok(checkCteChain(prelude).length > 0, 'the bare prelude is (correctly) not a complete statement');
  for (const [tag, tail] of [['delete', 'delete from g where g.source_key in (select source_key from changed);'],
                             ['insert', 'insert into g select 1 from i where i.source_key in (select source_key from changed);']]) {
    const p = checkCteChain(prelude + '\n' + tail);
    ok(p.length === 0, `_STAGE1_CHANGED + ${tag}: ${p.join(' | ')}`);
  }
}
// The composition is the load-bearing pin: stage 1 must stay TWO statements built
// from ONE prelude, or the 23505 the fixture proved comes straight back.
const reconSrc = readFileSync('scripts/n5_reconcile_sql.py', 'utf8');
ok((reconSrc.match(/_STAGE1_CHANGED \+ """/g) || []).length === 2,
   'STAGE1_GEOMETRY concatenates the prelude TWICE (delete, then insert)');
ok(!/del as \(\s*\n\s*delete from \{GEOM\}/.test(reconSrc),
   'stage 1 does not carry the DELETE back inside a data-modifying CTE');

section('2. the files the defect actually landed in');
for (const [file, keys] of [['scripts/n5_a3_markers.py', ['BUILD']],
                            ['scripts/n5_unit_a_shadow.py', ['POPULATE']]]) {
  const consts = pySqlConstants(file);
  for (const k of keys) {
    ok(consts[k] !== undefined, `${file} exposes ${k}`);
    if (consts[k] === undefined) continue;
    const p = checkCteChain(consts[k]);
    ok(p.length === 0, `${file}::${k} CTE chain: ${p.join(' | ')}`);
  }
}

section('3. noise is stripped before structure is read (the over-flagging direction)');
ok(checkCteChain(`with a as (select string_agg(x, ',' order by x) y from t) select * from a`).length === 0,
   'a comma inside a string literal is not read as a CTE separator');
ok(checkCteChain(`with a as (select 1) -- ) , trailing junk\nselect * from a`).length === 0,
   'parens and commas inside a line comment are ignored');
ok(checkCteChain(`with a as (select 1) select * from a where q = $q$ ) , $q$`).length === 0,
   'a dollar-quoted block is ignored');
ok(checkCteChain(`with a as (select x collate "C" from t) select * from a`).length === 0,
   'a quoted identifier (collate "C") does not break the scan');

section('4. multi-CTE chains, the real shape');
ok(checkCteChain(`with a as (select 1), b as (select 2), c as (select 3) insert into t select * from c`).length === 0,
   'three CTEs feeding an INSERT');
ok(checkCteChain(`with a as (select 1), d as (delete from t returning 1) insert into u select * from a`).length === 0,
   'a data-modifying CTE in the chain');

section('5. nested parentheses inside a CTE body');
ok(checkCteChain(`with a as (select coalesce((select max(x) from t), 0) v), b as (select 1) select * from a, b`).length === 0,
   'a scalar subquery inside a CTE body does not end the CTE early');

section('6. it detects an unbalanced CTE body');
ok(checkCteChain(`with a as (select 1, b as (select 2) select * from a`).length > 0,
   'an unclosed CTE body is reported');

section('7. NEGATIVE CONTROL - the exact defect from 47b005e must be detected');
const broken = `with scope as (select 1),
pt as (
  select p.* from placed p)
expected as (
  select 1 from pt),
del as (delete from t returning 1)
insert into u select 1;`;
const found = checkCteChain(broken);
ok(found.length > 0, 'the missing comma between `pt` and `expected` is reported');
ok(found.some(x => /CTE pt/.test(x)), `the report NAMES the offending CTE: ${found.join(' | ')}`);
const fixed = broken.replace('from placed p)\nexpected as (', 'from placed p),\nexpected as (');
ok(checkCteChain(fixed).length === 0, 'and the same statement passes once the comma is restored');

// Only self-report when invoked directly. Other suites import checkCteChain from
// here, and a bare process.exit(1) at import time would end THEIR run before a
// single one of their own assertions had a chance to print.
if (process.argv[1] && process.argv[1].endsWith('geo-sql-cte-structure.test.mjs')) {
  console.log(`\nPassed: ${pass}  Failed: ${fail}`);
  if (fail) process.exit(1);
}
