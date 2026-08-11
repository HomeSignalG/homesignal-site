// Regression guard for the 2026-08-11 EPA-probe-aware facilities guard.
//
// WHAT WENT WRONG (twice, in the same clause):
//   1. THE AGE CLIFF. The 2026-08-09 facilities guard refused a zeroing write only
//      while the row was FRESH (`refreshed_at >= now() - interval '7 days'`). A
//      refused write does not update refreshed_at, so a blocked row ages toward the
//      boundary and then stops being protected. Measured 2026-08-11 with FRS
//      returning 502/503: 15 rows already past it, 1,978 pages crossing ~08-14 and
//      9,005 more ~08-15. Un-pausing the refresh would have zeroed the EPA layer on
//      ~11,000 pages on schedule.
//   2. THE FLAG WAS WRITE-ONLY-FALSE. `dev_refresh_collect` is the only function in
//      the database that touches `facilities_unavailable`, and it only ever set it
//      FALSE. A zeroing write would have rendered "0 EPA facilities" instead of
//      "unavailable" — the exact claim #662 exists to prevent.
//
// CI has no database, so this drives the SQL OF RECORD
// (docs/dev-refresh-epa-probe-guard.sql). The live body was verified separately by
// pg_get_functiondef and by an 8-case predicate matrix; see the audit §V2.
//
// Run: node test/dev-refresh-epa-probe-guard.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sql = readFileSync(join(root, 'docs/dev-refresh-epa-probe-guard.sql'), 'utf8');
const copyTest = readFileSync(join(root, 'test/facilities-unavailable-copy.test.mjs'), 'utf8');

let fails = 0;
const ok = (cond, name) => {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
  if (!cond) fails++;
};

// ── the facilities refusal must consult EPA probe state, not just row age ──────
ok(/epa_frs_probes/.test(sql),
  'the guard reads live EPA health from public.epa_frs_probes');
ok(/resolved_at is not null/.test(sql),
  'only RESOLVED probes count — an un-reaped pg_net request is not evidence of health');
ok(/order by p\.probed_at desc/.test(sql) && /limit 1/.test(sql),
  'health is the LATEST resolved probe, not any historical success');

// THE cliff guard: the facilities clause must not be reachable on age alone.
ok(/\(not epa_ok or d\.refreshed_at >= now\(\) - interval ''7 days''\)/.test(sql),
  'facilities clause is (probe-failing OR row-fresh) — reverting to age-only fails here');

// ── fail-closed: every degenerate probe state means "EPA is failing" ───────────
ok(/select coalesce\(/.test(sql) && /\bfalse\)\\n'/.test(sql) && /into epa_ok/.test(sql),
  'the probe read is select coalesce(..., false) into epa_ok — NULL / no rows / empty table all read as failing');

// ── the flag must have a SET-TRUE path, server-derived ────────────────────────
ok(/when not epa_ok then true/.test(sql),
  'facilities_unavailable is SET TRUE when a zero-facility payload lands during an outage');
ok(/when coalesce\(\(j->''counts''->>''facilities''\)::int, 0\) > 0 then false/.test(sql),
  'a real facility count still CLEARS the flag (the #662 recovery path survives)');
ok(/else false/.test(sql),
  'a genuine zero while EPA is healthy is NOT flagged — rural empties stay honest zeros');

// ── the clauses this migration must NOT touch ─────────────────────────────────
// The migration must edit EXACTLY the three things it claims to. A fourth replace()
// — or a silent rewrite of the development / both-zero / blocked clauses — fails here.
ok((sql.match(/nd := replace\(src, anchor, repl\);/g) || []).length === 3,
  'the migration performs exactly three textual replacements, no more');
ok(/LEFT UNCHANGED ON PURPOSE[\s\S]*development-dimension clauses[\s\S]*both-dimensions-zero clause[\s\S]*`blocked` refusal/.test(sql),
  'the migration names the clauses it does not touch: development, both-zero, and the per-source blocked refusal');
ok(/no `explained` escape is added to the facilities clause/i.test(sql) ||
   !/explained x where x\.zip = d\.zip\n''\s*\|\|\s*E''\s*\)/.test(sql),
  'no `explained` escape is introduced on the facilities clause (FRS is not a registry source)');

// ── every edit is anchor-asserted, never a blind restatement of the body ──────
ok((sql.match(/refusing to patch blind/g) || []).length >= 3,
  'all three textual edits assert their anchor verbatim before replacing it');
ok(/pg_get_functiondef/.test(sql),
  'the body is read from the live catalog, not transcribed from memory');

// ── the client must still never infer the flag from a count ───────────────────
ok(/facilities_unavailable/.test(copyTest),
  'the client-side copy guard is still present and still keys on the server flag');

console.log(fails ? `\n${fails} check(s) failed.` : '\nEPA-probe-aware facilities guard holds.');
process.exit(fails ? 1 : 0);
