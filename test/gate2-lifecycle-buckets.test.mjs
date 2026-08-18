// GATE 2B's lifecycle-bucket contract and its two guards.
//
// WHY THIS TEST EXISTS. `scripts/gate2/full-inventory.mjs` only runs on a GitHub runner, only
// on PRs touching a handful of paths, and it just spent 8 days red without executing a single
// parity comparison. The guards that replaced its hardcoded 517 therefore need coverage that
// runs on EVERY PR — otherwise they are an instruction, not a control, which is precisely the
// failure the repair is about.
//
// THE BALANCE THIS FILE KEEPS. `STATUS_BUCKET` deliberately RESTATES lib/map.js::statusTier
// rather than importing it: if the gate derived its expected bucket sizes from the resolver it
// is testing, a resolver bug would move expectation and measurement together and the filter
// test would still pass. So the restatement must be proven EQUIVALENT here (assert, don't
// borrow) while staying independent there.
// Run: node test/gate2-lifecycle-buckets.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { STATUS_BUCKET, LIFECYCLE_KEYS, bucketOf, censusOf } from '../scripts/gate2/lifecycle-buckets.mjs';
import { ROWS as FROZEN_ROWS } from '../scripts/gate2/seed78617.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0;
const ok = (c, name, detail) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name + (!c && detail ? '\n     ' + detail : ''));
  if (!c) fails++;
};

// ── A. the restatement agrees with the shipped resolver ──────────────────────────────────
global.window = { HS: {} };
await import('../lib/templates.js');
await import('../lib/map.js');
const HS = global.window.HS;

{
  // Every key we claim to know must resolve, through the REAL resolver, to the bucket we say.
  const wrong = Object.entries(STATUS_BUCKET).filter(([status, bucket]) =>
    HS.resolveMarker({ status, type: 'Commercial' }).filterKey !== bucket);
  ok(wrong.length === 0,
    'A1 every STATUS_BUCKET entry matches lib/map.js::statusTier through the shipped resolver',
    wrong.map(([s, b]) => `${s} -> claimed ${b}, resolver says ${HS.resolveMarker({ status: s }).filterKey}`).join('; '));
}
{
  // …and the four bucket names are exactly the resolver's own first-class set — no fifth
  // bucket invented here, none of its four dropped.
  const mine = LIFECYCLE_KEYS.slice().sort();
  const theirs = (HS.LIFECYCLE_KEYS || []).slice().sort();
  ok(JSON.stringify(mine) === JSON.stringify(theirs),
    'A2 LIFECYCLE_KEYS is exactly lib/map.js::LIFECYCLE_KEYS', `gate ${mine} vs map ${theirs}`);
}
{
  // The mapping mirrors a specific block of lib/map.js. If that block is edited, this test
  // should be the thing that notices — so pin its shape, not just its behaviour.
  const src = readFileSync(join(ROOT, 'lib/map.js'), 'utf8');
  ok(/s === 'operating' \|\| s === 'active' \|\| s === 'built'/.test(src),
    'A3 lib/map.js still folds operating/active/built into one bucket (the line STATUS_BUCKET mirrors)');
  ok(/: 'unknown';/.test(src),
    'A4 lib/map.js still sends unrecognised statuses to `unknown` via its else-branch');
}

// ── B. facilities are never a lifecycle bucket ───────────────────────────────────────────
{
  ok(bucketOf({ record_kind: 'facility', status: 'Operating' }) === 'facility',
    'B1 a facility buckets as `facility`, not `operating` — no lifecycle toggle may hide one');
  ok(HS.resolveMarker({ record_kind: 'facility', status: 'Operating', _facility: true }).filterKey === 'facility',
    'B2 …and the shipped resolver agrees');
}

// ── C. case / whitespace tolerance, matching the resolver's own normalisation ─────────────
{
  ok(bucketOf({ status: '  APPROVED ' }) === 'approved', 'C1 trimmed + case-folded like statusTier');
  ok(bucketOf({ status: 'On File' }) === 'unknown', 'C2 mixed-case legacy TABS value still buckets unknown');
}

// ── D. THE FAIL-CLOSED VOCABULARY GUARD (guard 1 of 2) ───────────────────────────────────
{
  ok(bucketOf({ status: 'Zombie' }) === undefined, 'D1 an unrecognised status returns undefined, never a guess');
}
{
  let threw = null;
  try { censusOf([{ status: 'Approved', name: 'a' }, { status: 'Zombie', name: 'b' }], 'probe'); }
  catch (e) { threw = e; }
  ok(!!threw, 'D2 censusOf THROWS on an unrecognised status rather than bucketing it as unknown');
  ok(threw && /Zombie/.test(threw.message), 'D3 …and NAMES the offending value', threw && threw.message);
  ok(threw && /probe/.test(threw.message), 'D4 …and names the row set it was checking');
}
{
  // A NULL status is the dangerous case: it reads as "no lifecycle stated", which is exactly
  // what `unknown` means — so silently accepting it would be defensible and wrong. The gate
  // must be told, because a column that started emitting NULL is a vocabulary change.
  let threw = null;
  try { censusOf([{ status: null, name: 'n' }], 'probe'); } catch (e) { threw = e; }
  ok(!!threw && /\(null\)/.test(threw.message), 'D5 a NULL status is reported as (null), not absorbed into unknown');
}
{
  // The guard must not fire on a healthy set — an over-eager guard is noise, and noise is how
  // a real signal gets ignored later.
  let threw = null;
  try { censusOf([{ status: 'Approved', name: 'a' }, { record_kind: 'facility', status: 'Operating', name: 'f' }], 'probe'); }
  catch (e) { threw = e; }
  ok(!threw, 'D6 a recognised vocabulary does NOT trip the guard (no over-flagging)');
}

// ── E. census counts AND membership ──────────────────────────────────────────────────────
{
  const rows = [
    { status: 'Proposed', source_ref: 'p1' }, { status: 'Approved', source_ref: 'a1' },
    { status: 'Operating', source_ref: 'o1' }, { status: 'Active', source_ref: 'o2' },
    { status: 'On file', source_ref: 'u1' },
    { record_kind: 'facility', status: 'Operating', source_ref: 'f1' },
  ];
  const { counts, ids } = censusOf(rows, 'probe');
  ok(counts.proposed === 1 && counts.approved === 1 && counts.operating === 2
     && counts.unknown === 1 && counts.facility === 1,
    'E1 counts split across all four lifecycle buckets plus facility', JSON.stringify(counts));
  ok(JSON.stringify(ids.operating.sort()) === JSON.stringify(['o1', 'o2']),
    'E2 `Active` joins `Operating` in the SAME bucket — the 2026-08 vocabulary move');
  ok(JSON.stringify(ids.unknown) === JSON.stringify(['u1']),
    'E3 ids are returned per bucket so a filter can be checked by MEMBERSHIP, not by count alone');
  ok(!ids.operating.includes('f1'), 'E4 the facility never appears in a lifecycle bucket');
}

// ── F. THE FROZEN FIXTURE MUST STILL BE ABLE TO TEST THE UNKNOWN BRANCH (guard 2 of 2) ────
// `unknown` is the one lifecycle state whose purpose is to NOT fabricate a fact, and
// production currently holds ZERO records in it (the five Del Valle TABS rows moved off
// 'On file' during 2026-08). The gate therefore proves that branch against
// scripts/gate2/rows.tsv — 39 rows exported verbatim from production, five still carrying
// 'On file'. If someone edits that file and the unknown rows go, the branch would pass
// vacuously; this is the check that refuses to let that happen quietly.
{
  const { counts, ids } = censusOf(FROZEN_ROWS, 'frozen fixture');
  ok(counts.unknown > 0,
    'F1 the frozen fixture still carries lifecycle-unknown rows — without them the gate\'s '
    + 'unknown-branch pass would prove nothing', JSON.stringify(counts));
  ok(ids.unknown.every(i => i.includes('tdlr.texas.gov')),
    'F2 every frozen unknown row is a real TABS filing (production-derived, not invented)');
  ok(counts.proposed > 0 && counts.approved > 0 && counts.operating > 0 && counts.facility > 0,
    'F3 the fixture spans every other bucket too, so the unknown pass runs against a realistic set',
    JSON.stringify(counts));
}

console.log(fails ? `\n${fails} gate2-lifecycle-buckets assertion(s) FAILED.` : '\nAll gate2-lifecycle-buckets assertions passed.');
process.exit(fails ? 1 : 0);
