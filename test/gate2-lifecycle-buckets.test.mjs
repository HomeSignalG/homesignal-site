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

const GID = r => r.__gid;
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
  try { censusOf([{ status: 'Approved', __gid: 'a' }, { status: 'Zombie', __gid: 'b' }], 'probe', GID); }
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
  try { censusOf([{ status: null, __gid: 'n' }], 'probe', GID); } catch (e) { threw = e; }
  ok(!!threw && /\(null\)/.test(threw.message), 'D5 a NULL status is reported as (null), not absorbed into unknown');
}
{
  // The guard must not fire on a healthy set — an over-eager guard is noise, and noise is how
  // a real signal gets ignored later.
  let threw = null;
  try { censusOf([{ status: 'Approved', __gid: 'a' }, { record_kind: 'facility', status: 'Operating', __gid: 'f' }], 'probe', GID); }
  catch (e) { threw = e; }
  ok(!threw, 'D6 a recognised vocabulary does NOT trip the guard (no over-flagging)');
}

// ── E. census counts AND membership ──────────────────────────────────────────────────────
{
  const rows = [
    { status: 'Proposed', __gid: 'p1' }, { status: 'Approved', __gid: 'a1' },
    { status: 'Operating', __gid: 'o1' }, { status: 'Active', __gid: 'o2' },
    { status: 'On file', __gid: 'u1' },
    { record_kind: 'facility', status: 'Operating', __gid: 'f1' },
  ];
  const { counts, ids } = censusOf(rows, 'probe', GID);
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
  const { counts, ids } = censusOf(FROZEN_ROWS, 'frozen fixture', GID);
  ok(counts.unknown > 0,
    'F1 the frozen fixture still carries lifecycle-unknown rows — without them the gate\'s '
    + 'unknown-branch pass would prove nothing', JSON.stringify(counts));
  const evidence = new Map(FROZEN_ROWS.map(r => [r.__gid, r.source_ref]));
  ok(ids.unknown.every(gid => (evidence.get(gid) || '').includes('tdlr.texas.gov')),
    'F2 every frozen unknown row is a real TABS filing (production-derived, not invented)');
  ok(new Set(FROZEN_ROWS.map(r => r.__gid)).size === FROZEN_ROWS.length,
    'F4 the frozen fixture\'s own __gid values are unique — it can key a membership check');
  ok(counts.proposed > 0 && counts.approved > 0 && counts.operating > 0 && counts.facility > 0,
    'F3 the fixture spans every other bucket too, so the unknown pass runs against a realistic set',
    JSON.stringify(counts));
}

// ── G. THE IDENTITY GUARD — ids must be 1:1 with rows ────────────────────────────────────
// Added after the 2026-08-18 finding: the gate's old identity was `source_ref || name`, which
// collapses 540 live rows at ZIP 78617 into 521 distinct values because all 20 TxDOT route
// segments share one dataset-precision url. That silently shrank the parity comparison and
// produced a false coordinate-drift failure. The per-bucket id lists are what a filter's
// removed set is compared against, so a colliding or missing id must never pass quietly.
{
  let threw = null;
  try { censusOf([{ status: 'Approved', __gid: 'a' }], 'probe'); } catch (e) { threw = e; }
  ok(!!threw && /idOf/.test(threw.message),
    'G1 censusOf REFUSES to run without an explicit idOf — no content-key default to fall back to');
}
{
  let threw = null;
  try { censusOf([{ status: 'Approved' }], 'probe', GID); } catch (e) { threw = e; }
  ok(!!threw && /no identity/.test(threw.message),
    'G2 a row with no identity throws rather than being counted anonymously', threw && threw.message);
}
{
  // THE COLLISION ITSELF, reproduced: two distinct records sharing one dataset-precision url.
  const shared = 'https://services.arcgis.com/…/TxDOT_Projects_Info_All/FeatureServer/0';
  const byContent = r => r.source_ref || r.name;
  let threw = null;
  try {
    censusOf([{ status: 'Proposed', source_ref: shared, name: 'SH 130 Install Traffic Signal' },
              { status: 'Proposed', source_ref: shared, name: 'CR 1288 Widen Road' }], 'probe', byContent);
  } catch (e) { threw = e; }
  ok(!!threw && /duplicate identity/.test(threw.message),
    'G3 two records sharing one dataset url are caught as a DUPLICATE IDENTITY, not merged',
    threw && threw.message);
}
{
  // …and the same two rows pass cleanly once keyed on __gid — the fix, demonstrated.
  const shared = 'https://services.arcgis.com/…/TxDOT_Projects_Info_All/FeatureServer/0';
  const { counts, ids } = censusOf(
    [{ status: 'Proposed', source_ref: shared, __gid: 'dv-1' },
     { status: 'Proposed', source_ref: shared, __gid: 'dv-2' }], 'probe', GID);
  ok(counts.proposed === 2 && ids.proposed.length === 2,
    'G4 the same two records stay DISTINCT under __gid — both counted, both addressable');
}

console.log(fails ? `\n${fails} gate2-lifecycle-buckets assertion(s) FAILED.` : '\nAll gate2-lifecycle-buckets assertions passed.');
process.exit(fails ? 1 : 0);
