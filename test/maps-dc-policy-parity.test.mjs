// THE MAP-STATE POLICY IS EXPRESSED TWICE. THIS IS WHAT STOPS THE TWO COPIES DRIFTING.
//
//   • lib/maps-capture-policy.js — HS.mapsDcCapturePolicyEvidence, read by the capture job
//     (before it writes) and by the Acquisition Dashboard's Approve gate.
//   • homesignal-ingest/supabase/migrations/…_maps_dc_capture_policy_approval_guard.sql —
//     public.hs_maps_dc_capture_policy_violations, the server guard that a cached older
//     browser, a direct PostgREST call and psql all have to pass.
//
// A drift between them is invisible from either side: the browser would block an approval
// the server allows, or block one the server would have allowed. So BOTH read the SAME
// fixture file (test/fixtures/maps-dc-policy-cases.json) and must return the SAME verdict on
// every case. Adding a case adds it to both halves at once.
//
// OFFLINE the JS half runs in full and the SQL half is SKIPPED WITH A NAMED REASON — never
// silently, because "no credentials" and "agreed on every case" must not produce the same
// output. With SUPABASE_URL + a service key present, the SQL half runs too: it evaluates the
// migration's own helper text in `pg_temp`, so nothing is created in `public` and nothing is
// written.
//
// Run: node test/maps-dc-policy-parity.test.mjs
import { readFileSync, existsSync, writeFileSync } from 'node:fs';

globalThis.window = globalThis.window || globalThis;
for (const f of ['../lib/project-type.js', '../lib/map.js', '../lib/maps-social-theme.js', '../lib/maps-capture-policy.js',
                 '../lib/maps-capture-binding.js']) {
  (0, eval)(readFileSync(new URL(f, import.meta.url), 'utf8'));
}
const HS = globalThis.window.HS;

let n = 0, bad = 0;
const ok = (c, m, extra) => { n++; console.log((c ? 'PASS' : 'FAIL') + ' — ' + m
  + (extra !== undefined ? '  [' + extra + ']' : '')); if (!c) bad++; };

const FX = JSON.parse(readFileSync(new URL('./fixtures/maps-dc-policy-cases.json', import.meta.url), 'utf8'));
const clone = (x) => JSON.parse(JSON.stringify(x));

/**
 * Build a full social_posts-shaped row for a fixture case.
 * ONE builder, used for the JS call and for the SQL call, so the two halves cannot be
 * handed subtly different inputs — which would make an "agreement" meaningless.
 */
function buildRow(c) {
  const m = c.mutate || {};
  const statuses = clone(FX.compliant_statuses);
  const types = clone(FX.compliant_types);
  let regulatory = false;

  if (m.applied_status_off) statuses[m.applied_status_off] = false;
  if (m.extra_status) statuses[m.extra_status] = true;
  if (m.applied_type_on) types[m.applied_type_on] = true;
  if (m.regulatory === true) regulatory = true;

  const applied = { statuses: clone(statuses), types: clone(types), regulatory };
  const finalS = { statuses: clone(statuses), types: clone(types), regulatory };
  if (m.final_status_off) finalS.statuses[m.final_status_off] = false;
  if (m.final_type_on) finalS.types[m.final_type_on] = true;
  if (m.final_drop_type) delete finalS.types[m.final_drop_type];
  if (m.drop_regulatory) { delete applied.regulatory; delete finalS.regulatory; }
  if (m.regulatory_string) { applied.regulatory = m.regulatory_string; finalS.regulatory = m.regulatory_string; }

  const rendered = Object.assign(clone(FX.compliant_rendered), m.rendered || {});

  const capture_policy = {
    policy: m.policy || HS.MAPS_DC_CAPTURE_POLICY.key,
    applied, final: finalS,
    observed_before: { statuses: clone(statuses), types: clone(types), regulatory: true },
    controls_changed: { statuses: 0, types: 6, regulatory: 1 },
    rendered,
  };
  if (m.drop_rendered) delete capture_policy.rendered;

  const evidence = clone(FX[c.project || 'project']);
  evidence.theme = ('theme' in c) ? c.theme : 'datacenter';
  if (c.absence) { delete evidence.project_id; evidence.theme_answer = 'none_found'; }
  evidence.visual = { state: 'REAL_MAP_VISUAL', capture_key: 'placeholder' };
  if (!m.drop_capture_policy) evidence.visual.capture_policy = capture_policy;

  const post = {
    id: 'fixture-' + c.name,
    content_family: c.content_family || 'MAPS',
    tile: 'development',
    status: 'draft',
    zip: '85212',
    image_bucket_path: 'maps/85212/x.png',
    evidence,
  };
  // The key is computed by the shipped builder rather than typed, so the "bound" assertions
  // below are about real behaviour and not about a string this test invented.
  post.evidence.visual.capture_key = HS.mapsCaptureKey(post);
  return post;
}

// ═══ 1. THE FIXTURE IS ABOUT THE THING IT CLAIMS ═══════════════════════════════════════
// A suite whose fixture does not classify as a data centre would report every case as
// "not governed" and pass, measuring nothing. This is that denominator check.
const base = buildRow({ name: 'probe' });
ok(HS.mapsSocialThemeKey(base) === 'datacenter',
  '1a: the fixture project classifies as Data center through the SHIPPED Map 1 classifier',
  HS.mapsSocialThemeKey(base));
ok(HS.mapsDcCapturePolicyApplies(base) === true,
  '1b: …so the map-state policy governs it');
ok(FX.cases.filter((c) => c.governed).length >= 12,
  '1c: the fixture carries a real population of governed cases', FX.cases.filter((c) => c.governed).length);
ok(FX.cases.some((c) => c.governed && c.ok) && FX.cases.some((c) => c.governed && !c.ok),
  '1d: …with cases on BOTH sides of the verdict, so the validator is proven in both directions');

// ═══ 2. THE JS HALF, EVERY CASE ════════════════════════════════════════════════════════
const jsVerdicts = {};
for (const c of FX.cases) {
  const post = buildRow(c);
  const governed = HS.mapsDcCapturePolicyApplies(post);
  ok(governed === c.governed, `2/${c.name}: scope — governed=${governed}`, c.note);
  const v = HS.mapsDcCapturePolicyEvidence((post.evidence.visual) || {});
  const verdict = governed ? v.ok : true;   // an ungoverned row produces no violations
  jsVerdicts[c.name] = verdict;
  ok(verdict === c.ok, `2/${c.name}: verdict — ok=${verdict}`,
    verdict === c.ok ? c.note : (v.problems || []).join('; '));
  if (c.legacy) ok(v.legacy === true, `2/${c.name}: reported as LEGACY, not as a contradiction`);
}

// ═══ 3. BOUNDNESS FOLLOWS THE POLICY, AND ONLY FOR GOVERNED ROWS ══════════════════════
// The approval gate reads HS.mapsCaptureBound, so the policy has to reach it — and must NOT
// reach anything else.
//
// ⚠️ THE UNGOVERNED EXPECTATION IS THE PRE-POLICY BEHAVIOUR, NOT "true". An ALERTS row and
// the absence post were ALREADY unbound before this change (mapsCaptureKey returns null for
// a non-MAPS row and for a row with no project_id), so asserting `bound === true` there
// would be asserting a bug. The baseline is recomputed here from the key alone — exactly
// what mapsCaptureBound did before the policy clause — so "unchanged" is measured rather
// than assumed.
function preBaselineBound(post) {
  if (!post || !post.image_bucket_path) return false;
  const v = ((post.evidence) || {}).visual || {};
  if (!v.capture_key) return false;
  const now = HS.mapsCaptureKey(post);
  return !!now && v.capture_key === now;
}
for (const c of FX.cases) {
  const post = buildRow(c);
  const bound = HS.mapsCaptureBound(post);
  const want = c.governed ? c.ok : preBaselineBound(post);
  ok(bound === want, `3/${c.name}: mapsCaptureBound=${bound}`
    + (c.governed ? '' : ` (ungoverned — pre-policy baseline ${preBaselineBound(post)})`), c.note);
}

// ═══ 4. THE SQL HALF — SAME CASES, SAME VERDICTS ══════════════════════════════════════
// The SQL guard cannot be executed from this sandbox (no egress to the database), so this
// section EMITS the exact query that settles parity and says plainly that it has verified
// nothing by itself. `--emit-sql <path>` writes it; the operator (or a runner with
// credentials) executes it and compares. Silence and agreement must never look alike.
//
// The emitted query creates the migration's OWN helper text in `pg_temp` — session-local,
// invisible to anything else, gone when the session ends — so it touches nothing in
// `public`, reads no row and writes no row.
const MIG = new URL('../../homesignal-ingest/supabase/migrations/'
  + '20260921120000_maps_dc_capture_policy_approval_guard.sql', import.meta.url);
const emitArg = process.argv.indexOf('--emit-sql');
if (!existsSync(MIG)) {
  console.log('SKIP — §4 SQL parity: homesignal-ingest is not checked out beside this repo, so '
    + 'the migration text could not be read. NOTHING ABOUT THE SQL GUARD WAS VERIFIED HERE.');
} else {
  const src = readFileSync(MIG, 'utf8');
  const i1 = src.indexOf('create or replace function public.hs_maps_dc_snapshot_violations');
  const i2 = src.indexOf('-- \u2500\u2500 THE TRIGGER, SPLICED');
  ok(i1 > -1 && i2 > i1, '4a: the migration\'s policy helpers were located for extraction');
  // ── THE CALL SITE IS THE LOAD-BEARING PIN ────────────────────────────────────────
  // A correct helper that nothing calls is not a guard. Removing the one line that invokes
  // it from the trigger left every other assertion in this file green — MEASURED — because
  // they all exercise the helper directly. These read the trigger body instead.
  const trig = src.slice(i2);
  ok(/viol := public\.hs_maps_dc_capture_policy_violations\(new\.content_family, new\.evidence\);/.test(trig),
    '4b: the publication guard CALLS the policy helper');
  ok(/hs_maps_dc_capture_policy_violations[\s\S]{0,200}if array_length\(viol, 1\) > 0 then[\s\S]{0,400}raise exception/.test(trig),
    '4c: …and RAISES on a non-empty violation list, rather than computing it and moving on');
  ok(/if new\.status = 'approved' and prev_status <> 'approved' then[\s\S]{0,1400}hs_maps_dc_capture_policy_violations/.test(trig),
    '4d: …inside the branch that fires when a row FIRST becomes approved — so the RPC, a direct '
    + 'PostgREST PATCH and psql all pass through it');
  // The splice must not have dropped a pre-existing branch. Named individually, because a
  // migration that silently loses one of these is a regression nothing else would catch.
  for (const keep of ['hs_social_claim_violations', 'payload_fingerprint',
                      'publication requires a human approval', 'the payload changed after approval',
                      'the payload changed while the row is']) {
    ok(trig.indexOf(keep) > -1, `4e: the splice preserves the pre-existing branch "${keep}"`);
  }
  // ⚠️ THE DDL FORM, not any mention: the file's own header explains at length what it leaves
  // alone, and a bare-substring pin would fail on the explanation rather than on a redefinition.
  ok(!/create\s+(or\s+replace\s+)?function\s+public\.hs_approve_social_post/i.test(src),
    '4f: the migration does NOT redefine hs_approve_social_post — authorization, reviewed-payload '
    + 'checks, claim validation, the slot ladder and publishing are untouched');
  const helpers = src.slice(i1, i2)
    .replace(/public\.hs_maps_dc_snapshot_violations/g, 'pg_temp.hs_maps_dc_snapshot_violations')
    .replace(/public\.hs_maps_dc_capture_policy_violations/g, 'pg_temp.hs_maps_dc_capture_policy_violations')
    .replace(/set search_path to 'public'\n/g, '');
  // THE SAME BUILDER, so the two halves cannot be handed different inputs — which is what
  // would make an "agreement" meaningless.
  // A PROJECTION, NOT A DIFFERENT INPUT. The SQL guard reads exactly three things off the
  // row — `content_family`, `evidence.theme` / `evidence.project_id` (its scope) and
  // `evidence.visual.capture_policy` (its verdict) — and provably touches nothing else, so
  // the emitted literal carries those and drops the rest. That keeps the query small enough
  // to hand to a SQL console by copy-paste, which is the only channel this sandbox has.
  const rows = FX.cases.map((c) => {
    const p = buildRow(c);
    const e = p.evidence, ev = {};
    if ('theme' in e) ev.theme = e.theme;
    if ('project_id' in e) ev.project_id = e.project_id;
    if ('theme_answer' in e) ev.theme_answer = e.theme_answer;
    ev.visual = {};
    if (e.visual && e.visual.capture_policy) {
      const cp = e.visual.capture_policy;
      ev.visual.capture_policy = { policy: cp.policy, applied: cp.applied, final: cp.final, rendered: cp.rendered };
    }
    return `(${lit(c.name)},${lit(p.content_family)},${lit(JSON.stringify(ev))}::jsonb,${c.ok})`;
  }).join(',\n    ');
  const sql = helpers
    + '\nselect t.name,\n'
    + '       coalesce(array_length(pg_temp.hs_maps_dc_capture_policy_violations(t.cf, t.ev), 1), 0) = 0 as sql_ok,\n'
    + '       t.js_ok,\n'
    + '       (coalesce(array_length(pg_temp.hs_maps_dc_capture_policy_violations(t.cf, t.ev), 1), 0) = 0) = t.js_ok as agree\n'
    + `from (values\n    ${rows}\n) as t(name, cf, ev, js_ok)\norder by agree, t.name collate "C";\n`
    + 'drop function pg_temp.hs_maps_dc_capture_policy_violations(text, jsonb);\n'
    + 'drop function pg_temp.hs_maps_dc_snapshot_violations(jsonb, text);\n';
  if (emitArg > -1 && process.argv[emitArg + 1]) {
    writeFileSync(process.argv[emitArg + 1], sql);
    console.log('EMITTED — §4 parity SQL written to ' + process.argv[emitArg + 1]
      + ` (${FX.cases.length} cases). Run it and require agree=true on every row.`);
  } else {
    console.log(`SKIP — §4 SQL parity: this sandbox has no database egress, so the SQL guard was `
      + `NOT executed here and NOTHING ABOUT IT IS VERIFIED BY THIS RUN. Re-run with `
      + `--emit-sql <path> to produce the ${FX.cases.length}-case parity query.`);
  }
}
function lit(s) { return "'" + String(s).replace(/'/g, "''") + "'"; }

console.log(`\n${bad === 0 ? 'ALL CHECKS PASSED' : bad + ' FAILED'} (${n} checks)`);
process.exit(bad ? 1 : 0);
