// ONE FIXTURE, BOTH HALVES OF THE UNIVERSAL MAP GATE.
//
// The browser half is `acquisition.html::bskyMapGateBlock` — what a human sees on the Approve
// button. The enforced half is `public.hs_maps_map_gate_violations`, called by the approval
// RPC and by the publication trigger. A direct RPC call never passes through the page, so the
// SQL half is the one that actually decides; the page half is the one anybody reads.
//
// ⚠️ THEY HAVE DISAGREED TWICE IN ONE DAY, AND NOTHING COMPARED THEM.
//
//   #560       the SQL half matched `v1|zip|<zip>|`, a key format that was never shipped,
//              while the capture job emitted `v1|<zip>|zip-scope|`. 28 correct captures were
//              refused at the boundary while the page accepted them.
//   2026-09-22 fixing that over-corrected: SQL began defaulting a projectless row to ZIP
//              scope and accepting ANY subject, so a picture framed on a project the post
//              does not name PASSED — while the page still refused it. Laxer server than
//              page, which is the dangerous direction.
//
// Both shipped because `hs_maps_map_gate_violations` appeared in NO test file at all. The DC
// map-state policy has had a parity harness since #536; the UNIVERSAL gate never did. This is
// that harness, built the same way and deliberately carrying the two regressions above as
// named cases, so a revert of either is a red test rather than a production measurement.
//
// ⚠️ WHAT THIS FILE CAN AND CANNOT PROVE ON ITS OWN. The sandbox has no database egress, so
// the SQL half is NOT executed here. It is EMITTED (`--emit-sql <path>`) as a self-contained
// query that defines the committed function in `pg_temp` — session-local, reads no row, writes
// no row — and compares it to the JS verdicts case by case. Offline this file proves the JS
// half and prints a loud SKIP for the other. That is the same honesty the DC harness uses, and
// the same limitation: see the note at the bottom about nothing running the emitted SQL yet.
import { readFileSync, existsSync, writeFileSync } from 'node:fs';

let n = 0, bad = 0;
const ok = (c, m) => { n++; if (c) console.log('PASS — ' + m); else { bad++; console.log('FAIL — ' + m); } };

globalThis.window = globalThis.window || globalThis;
for (const f of ['../lib/map.js', '../lib/maps-social-theme.js', '../lib/maps-capture-policy.js',
                 '../lib/maps-capture-binding.js']) {
  (0, eval)(readFileSync(new URL(f, import.meta.url), 'utf8'));
}
const HS = globalThis.window.HS;
const DASH = readFileSync(new URL('../acquisition.html', import.meta.url), 'utf8');
const FX = JSON.parse(readFileSync(new URL('./fixtures/maps-map-gate-cases.json', import.meta.url), 'utf8'));

// ── §0 THE JS HALF IS LIFTED OUT OF THE PAGE AND RUN, not grepped ────────────────────
const bodyOf = (name) => {
  const m = DASH.match(new RegExp('function ' + name + '\\(([^)]*)\\)\\{([\\s\\S]*?)\\n  \\}'));
  return m ? { args: m[1], body: m[2] } : null;
};
const lifted = (() => {
  const a = bodyOf('bskyTheme'), c = bodyOf('bskyIsAbsence'),
    b = bodyOf('dcThemeMapPolicyApplies'), d = bodyOf('bskyMapGateBlock');
  if (!a || !b || !c || !d) return null;
  return new Function('HS', 'window', `
    function bskyTheme(${a.args}){${a.body}}
    function bskyIsAbsence(${c.args}){${c.body}}
    function dcThemeMapPolicyApplies(${b.args}){${b.body}}
    function bskyMapGateBlock(${d.args}){${d.body}}
    return bskyMapGateBlock;`)(HS, { HS });
})();
ok(typeof lifted === 'function', '0a: the page half is liftable and runnable');
ok(FX.cases.length >= 10 && FX.cases.some((c) => c.js) && FX.cases.some((c) => !c.js),
  `0b: control — the fixture has ${FX.cases.length} cases and covers BOTH verdicts, so an `
  + 'agreement below is not agreement over a one-sided set');

// ⚠️ A LEGITIMATE CASE'S KEY IS DERIVED BY THE SHIPPED RULE, NEVER TYPED. The first draft of
// this fixture hand-wrote key strings, and cases 03/04/05 — the three CORRECT shapes — failed,
// because an invented key cannot equal what `HS.mapsCaptureKey` computes from the evidence
// beside it. That reads exactly like a product defect and is a fixture defect. Only the
// deliberately-wrong cases carry a literal, and each names its own fault.
function buildRow(c) {
  const row = {
    id: 'fx', content_family: 'MAPS', status: 'draft', zip: c.zip,
    image_bucket_path: c.image ? ('maps/' + (c.zip || 'x') + '/f.png') : null,
    evidence: JSON.parse(JSON.stringify(c.evidence || {})),
  };
  const v = row.evidence && row.evidence.visual;
  if (v && v.capture_key === '@derive') v.capture_key = HS.mapsCaptureKey(row, c.derive_scope);
  return row;
}
ok(FX.cases.filter((c) => c.derive_scope).every((c) => {
  const k = buildRow(c).evidence.visual.capture_key;
  return typeof k === 'string' && k.length > 0;
}), '0c: control — every @derive case produced a non-empty key from the shipped rule');

// ── §1 THE JS HALF AGREES WITH THE FIXTURE ───────────────────────────────────────────
const jsVerdicts = [];
if (lifted) {
  for (const c of FX.cases) {
    const jsOk = !lifted(buildRow(c));
    jsVerdicts.push(jsOk);
    ok(jsOk === c.js, `1: page half — ${c.name} → ${jsOk ? 'approvable' : 'refused'}`);
  }
}

// ── §1b THE SAFETY DIRECTION, which is the whole point of this file ──────────────────
// EXACT parity is impossible: JS recomputes the whole key and demands equality, SQL holds no
// copy of the key vocabulary on purpose. So the contract is directional — SQL may refuse what
// JS allows, but must NEVER allow what JS refuses, because a direct RPC call never touches the
// dashboard and SQL is then the only thing between it and an approval.
const violations = FX.cases.filter((c) => c.sql && !c.js);
const declared = new Set((FX.known_asymmetries || []).map((a) => a.case));
for (const c of violations) {
  ok(declared.has(c.name),
    `1b: SAFETY — "${c.name}" has SQL passing what JS refuses and is declared in `
    + 'known_asymmetries with a reason');
}
ok(FX.cases.filter((c) => c.sql && !c.js && !declared.has(c.name)).length === 0,
  `1b: no UNDECLARED case lets SQL approve what the page refuses `
  + `(${violations.length} declared asymmetr${violations.length === 1 ? 'y' : 'ies'})`);
for (const a of (FX.known_asymmetries || [])) {
  ok(typeof a.reason === 'string' && a.reason.length > 120,
    `1b: …and "${a.case}" carries a real stated reason, not a snooze`);
  ok(FX.cases.some((c) => c.name === a.case),
    `1b: …and names a case that still exists (a stale waiver is a guard that stopped guarding)`);
}

// ── §2 THE REGRESSIONS ARE NAMED, so a revert is a red test and not a measurement ─────
for (const needle of ['REGRESSION #560: projectless row carrying a project-framed key',
                      'CONTROL a future non-record subject token must still pass']) {
  ok(FX.cases.some((c) => c.name.indexOf(needle) > -1),
    `2: the fixture still carries "${needle}"`);
}

// ── §3 THE SQL HALF — emitted, and honest about not having run ───────────────────────
const MIG = new URL('../../homesignal-ingest/supabase/migrations/'
  + '20260922000500_maps_map_gate_definition_of_record.sql', import.meta.url);
const emitArg = process.argv.indexOf('--emit-sql');
if (!existsSync(MIG)) {
  console.log('SKIP — §3 SQL parity: homesignal-ingest is not checked out beside this repo, so '
    + 'the committed function text could not be read. NOTHING ABOUT THE SQL HALF IS VERIFIED '
    + 'BY THIS RUN — this is a skip, not a pass.');
} else {
  const src = readFileSync(MIG, 'utf8');
  const i = src.indexOf('CREATE OR REPLACE FUNCTION');
  ok(i > -1, '3a: the record file carries a literal function definition');
  const fn = src.slice(i)
    .replace(/public\.hs_maps_map_gate_violations/g, 'pg_temp.hs_maps_map_gate_violations')
    .replace(/CREATE OR REPLACE FUNCTION public\./, 'CREATE OR REPLACE FUNCTION pg_temp.')
    .replace(/CREATE OR REPLACE FUNCTION hs_maps/, 'CREATE OR REPLACE FUNCTION pg_temp.hs_maps');
  // A PROJECTION, NOT A DIFFERENT INPUT. The SQL half provably reads exactly five things off
  // the row — content_family, zip, image_bucket_path, evidence.project_id and
  // evidence.visual.{scope,capture_key,capture_policy.scope} — so the emitted literal carries
  // those and drops the rest. That keeps the query small enough to paste into a console, which
  // is the only channel this sandbox has, WITHOUT feeding the two halves different inputs:
  // anything dropped here is something the function cannot reach.
  const READS = /capture_policy|project_id|image_bucket_path|content_family|\bzip\b|capture_key|'scope'/;
  ok(READS.test(src), '3b: control — the projection below names fields the function text actually reads');
  const rows = FX.cases.map((c, k) => {
    const p = buildRow(c);
    const v = (p.evidence && p.evidence.visual) || null;
    const ev = {};
    if (p.evidence && 'project_id' in p.evidence) ev.project_id = p.evidence.project_id;
    if (v) {
      ev.visual = {};
      if ('scope' in v) ev.visual.scope = v.scope;
      if ('capture_key' in v) ev.visual.capture_key = v.capture_key;
      if (v.capture_policy && 'scope' in v.capture_policy) {
        ev.visual.capture_policy = { scope: v.capture_policy.scope };
      }
    }
    const j = { content_family: 'MAPS', status: 'draft', zip: p.zip,
                image_bucket_path: p.image_bucket_path, evidence: ev };
    return `(${lit(c.name)},${lit(JSON.stringify(j))}::jsonb,${jsVerdicts[k]},${c.sql})`;
  }).join(',\n    ');
  // TWO COLUMNS, BECAUSE THEY ANSWER TWO DIFFERENT QUESTIONS AND ONE OF THEM IS THE POINT.
  // `pg_temp` is the COMMITTED text this repo pins (what CI would check); `public` is the LIVE
  // function residents are actually protected by. Emitting only one was the vestigial defect
  // here: the file created a pg_temp copy and then queried public, so it silently answered the
  // live question while claiming to test the committed one. Asking both also makes
  // committed-vs-live DRIFT visible in the same run, which neither column can show alone.
  // PARENTHESISED, because `a = '{}' = b` is not a chain in Postgres — it is a syntax error
  // (42601). The first emitted query carried it and could not run at all, which is the
  // emitter's own version of "an instrument must prove it ran": a query nothing had executed
  // looked exactly like one that worked.
  const CALL = (sch) => '(' + sch + '.hs_maps_map_gate_violations('
    + 'jsonb_populate_record(null::public.social_posts, t.j)) = \'{}\')';
  const sql = fn
    + '\nselect t.name,\n'
    + `       ${CALL('pg_temp')} as committed_ok,\n`
    + `       ${CALL('public')} as live_ok,\n`
    + '       t.js_ok, t.sql_expected,\n'
    + `       ${CALL('pg_temp')} = t.sql_expected as agree,\n`
    + `       ${CALL('pg_temp')} = (${CALL('public')}) as committed_matches_live\n`
    + `from (values\n    ${rows}\n) as t(name, j, js_ok, sql_expected)\n`
    + 'order by agree, committed_matches_live, t.name collate "C";\n';
  if (emitArg > -1 && process.argv[emitArg + 1]) {
    writeFileSync(process.argv[emitArg + 1], sql);
    console.log(`EMITTED — §3 parity SQL written to ${process.argv[emitArg + 1]} `
      + `(${FX.cases.length} cases). Run it and require agree=true on EVERY row.`);
  } else {
    console.log(`SKIP — §3 SQL parity: this sandbox has no database egress, so the SQL half was `
      + `NOT executed and NOTHING ABOUT IT IS VERIFIED BY THIS RUN. Re-run with `
      + `--emit-sql <path> for the ${FX.cases.length}-case query.`);
  }
}
function lit(s) { return "'" + String(s).replace(/'/g, "''") + "'"; }

// ✅ THE EMITTED QUERY HAS BEEN RUN ONCE, AGAINST PRODUCTION, 2026-09-22 — and this is the
// only reason any claim here is about SQL rather than about a string. Result, all 13 cases:
//   agree                  13 / 13   (the committed text matches this fixture's sql column)
//   committed_matches_live 13 / 13   (the record file is byte-equivalent IN BEHAVIOUR to live)
// The two declared asymmetries reproduced exactly: case 11 sql=true js=false (the unsafe
// direction, waived in known_asymmetries) and case 12 sql=false js=true (SQL stricter, safe).
//
// ⚠️ THE FIRST EMITTED QUERY COULD NOT RUN AT ALL. It carried `call = '{}' = expected`, which
// Postgres rejects (42601 — comparison does not chain), so the emitter had shipped an artifact
// nobody had executed, looking exactly like one that worked. That is this file's own version of
// "an instrument must prove it ran". The same run also exposed the header/schema mismatch: it
// created a `pg_temp` copy and then queried `public`, i.e. it silently answered the LIVE
// question while claiming to test the COMMITTED one. Both columns are emitted now.
//
// 📌 STILL TRUE, AND STILL FLAGGED RATHER THAN FIXED: NOTHING IN CI RUNS THIS SQL — not for
// this gate and not for the DC one either (grep the workflows: no job passes --emit-sql). So
// JS↔SQL agreement is checked only when a human runs the query, and the receipt above is a
// dated measurement, not a standing guarantee. Wiring it is a new scheduled job with a
// database credential, which the autonomy envelope gates.
console.log(`\n${bad === 0 ? 'ALL CHECKS PASSED' : bad + ' FAILED'} (${n} checks)`);
process.exit(bad ? 1 : 0);
