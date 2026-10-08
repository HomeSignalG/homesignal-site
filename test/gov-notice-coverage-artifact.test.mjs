// lib/generated/gov-notice-coverage.json must describe the GOVERNMENT NOTICES tile —
// never "either tile".
//
// The two are different populations and the difference is large. Measured against
// production 2026-09-04 (control: 12,722 canonical ZIP pages):
//
//   notices tile (target_table='alerts')          6,246 wired, 6,246 delivering
//   either tile  (alerts OR meetings)             7,293 wired, 7,293 delivering
//
// Reading `wired` from one and `delivering` from the other manufactured a phantom cohort
// of 1,047 "armed but not delivering" ZIP pages in the engine repo. If that mixing reached
// THIS file the damage is worse than a bad metric: 1,047 ZIP pages would tell residents
// "we track Government Notices for your area" when the only thing wired for them is
// Upcoming Meetings, which structurally cannot produce a notice.
//
// The invariant is enforced at the DERIVATION, because that is what makes the output right:
// the generator reads DELIVERED government_notice ALERTS and walks parent_id down from each
// content-bearing community. It must never read `feeds`, and must never branch on
// `target_table`. Both of those are engine-side concepts; a site artifact that consulted
// them would be reconstructing the mixed metric.
//
// Deliberately offline and static. The live half — does the committed file still match
// production — is `--check`, which needs Supabase and therefore a runner; that gate proves
// itself in .github/workflows/verify-gov-notice-coverage.yml.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const GEN = readFileSync(join(root, 'scripts/gen-gov-notice-coverage.mjs'), 'utf8');
// ⚠️ THESE RUN ON CODE, NOT ON PROSE. The generator's header quotes the engine's SQL so
// the two halves can be compared without opening the other repo — which means a naive
// scan of the whole file sees `current_date - 365` in a COMMENT and reports the record
// window as applied. That is a false positive this file produced on its first run. It is
// also the vacuous-pass risk in the other direction: a comment mentioning a bound must
// never satisfy an assertion that the bound is enforced.
const GEN_CODE = GEN.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

const MAP = JSON.parse(readFileSync(join(root, 'lib/generated/gov-notice-coverage.json'), 'utf8'));
const failures = [];

// ── The generator derives from delivered NOTICES, not from feeds ────────────────────
if (!/alerts\?pipeline_type=eq\.government_notice/.test(GEN_CODE)) {
  failures.push('generator: no read of delivered government_notice alerts — the notices-tile source is gone');
}
if (/rest\/v1\/feeds|['"`]feeds\?/.test(GEN_CODE)) {
  failures.push('generator: reads `feeds` — coverage must come from delivered notices, not from arming');
}
if (/target_table/.test(GEN_CODE)) {
  failures.push('generator: branches on target_table — that is the either-tile mixing this file must not carry');
}
if (/\bmeetings\b/.test(GEN.replace(/^\s*\/\/.*$/gm, ''))) {
  failures.push('generator: reads `meetings` outside a comment — the meetings tile is a different population');
}

// ── The chain walk, not a (state, county) join ──────────────────────────────────────
// Independent cities share their county's NAME while having a separate government, so a
// name join grants one the other's coverage. Measured: it inflates by 96 ZIP pages across
// MD Baltimore and VA Fairfax.
if (!/parent_id/.test(GEN_CODE)) failures.push('generator: no parent_id chain walk');
if (/\.county\s*===|county\s*===\s*c\.county/.test(GEN_CODE)) {
  failures.push('generator: appears to join on county name — use the parent_id chain');
}

// ── The artifact is a strict subset of canonical, and reconciles ────────────────────
const c = MAP._counts;
if (c.canonical_zip_pages !== 12722) failures.push(`artifact: canonical is ${c.canonical_zip_pages}, expected 12722`);
if (c.configured + c.unconfigured !== c.canonical_zip_pages) failures.push('artifact: configured + unconfigured != canonical');
if (c.configured !== MAP.configured_zips.length) failures.push('artifact: _counts.configured disagrees with the list');
if (!(c.configured > 0 && c.configured < c.canonical_zip_pages)) {
  // Empty and total are the two shapes a broken generator produces that still look like data.
  failures.push(`artifact: implausible configured count ${c.configured}`);
}

// ── BOTH ENDS of the source-currentness window, ANDed ───────────────────────────────
// The founder's window is symmetric -90/+90 (2026-09-06, refined the same day). The
// ceiling was withheld for a day while a CivicClerk fetch defect made 17 counties look
// far-future-only; homesignal-ingest PR #480 (f67959f) repaired the fetch and run #597
// wrote in-window rows, so both ends are enforced again as of 2026-09-07.
//
// WHY BOTH ARE ASSERTED SEPARATELY: a half-window is the dangerous shape. Floor-only lets
// a far-future calendar placeholder hold a dead source open; ceiling-only lets a
// years-stale archive count as current. Either alone still returns a plausible number.

const genFloor = /published_at=gte\.\$\{currentFloor\}/.test(GEN_CODE);
const genCeil = /published_at=lte\.\$\{currentCeiling\}/.test(GEN_CODE);
if (!genFloor) failures.push('generator: the -90 source-currentness FLOOR (published_at=gte.) is missing');
if (!genCeil) failures.push('generator: the +90 source-currentness CEILING (published_at=lte.) is missing');
if (!/const SOURCE_CURRENT_DAYS = 90;/.test(GEN_CODE)) failures.push('generator: SOURCE_CURRENT_DAYS is no longer 90');
// The ceiling must be the SAME constant mirrored, never a second literal that can drift.
if (!/currentCeiling = new Date\(Date\.now\(\) \+ SOURCE_CURRENT_DAYS \* 86400000\)/.test(GEN_CODE)) {
  failures.push('generator: currentCeiling is not derived from SOURCE_CURRENT_DAYS');
}
// Both bounds must be on the SAME request. Two separate reads unioned would re-admit
// exactly what the window excludes.
if (!/alerts\?pipeline_type=eq\.government_notice[^`]*gte\.\$\{currentFloor\}[^`]*lte\.\$\{currentCeiling\}/.test(GEN_CODE)) {
  failures.push('generator: floor and ceiling are not ANDed into one government_notice read');
}

// The record window is a DIFFERENT contract and must not be conflated with -90/+90.
if (/published_at=gte\.\$\{recordFloor\}|current_date - 365/.test(GEN_CODE)) {
  failures.push('generator: the -365/+730 RECORD window must not be applied here');
}

// ── The self-test: these assertions must be capable of failing ──────────────────────
// A file of regexes that all match trivially is the vacuous-pass shape. Prove the two
// load-bearing patterns discriminate, by running them against text that must NOT pass.
const mixedGenerator = "const feeds = await all('feeds?target_table=eq.alerts', 'community_id');";
if (!/target_table/.test(mixedGenerator)) failures.push('self-test: the target_table guard cannot detect mixing');
if (!/rest\/v1\/feeds|['"`]feeds\?/.test(mixedGenerator)) failures.push('self-test: the feeds guard cannot detect a feeds read');
if (/alerts\?pipeline_type=eq\.government_notice/.test(mixedGenerator)) failures.push('self-test: the notices-source guard matches text that has no such read');

// Each window bound must be provably detectable in its own absence. A generator carrying
// only the other end must fail the pattern for the missing one — otherwise "both ends are
// present" is a claim no assertion here could ever contradict.
const floorOnly = 'alerts?pipeline_type=eq.government_notice&published_at=gte.${currentFloor}';
const ceilOnly = 'alerts?pipeline_type=eq.government_notice&published_at=lte.${currentCeiling}';
if (/published_at=lte\.\$\{currentCeiling\}/.test(floorOnly)) failures.push('self-test: the CEILING guard passes text that has no ceiling');
if (/published_at=gte\.\$\{currentFloor\}/.test(ceilOnly)) failures.push('self-test: the FLOOR guard passes text that has no floor');
if (/gte\.\$\{currentFloor\}[^`]*lte\.\$\{currentCeiling\}/.test(floorOnly)) failures.push('self-test: the ANDed-bounds guard passes a floor-only read');
if (/gte\.\$\{currentFloor\}[^`]*lte\.\$\{currentCeiling\}/.test(ceilOnly)) failures.push('self-test: the ANDed-bounds guard passes a ceiling-only read');

if (failures.length) {
  console.error(failures.map((f) => '  ✗ ' + f).join('\n'));
  process.exit(1);
}
console.log(`ok  gov-notice-coverage artifact: notices tile, ${c.configured} / ${c.canonical_zip_pages}`);
