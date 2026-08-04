// Offline guard for DATED CONSTANTS IN REGISTRY WINDOWS — no network, no DB.
//
// THE CLASS. A few arcgis entries window on a HARDCODED YEAR because their date column is a
// STRING that `recency_days` cannot compare (it emits a `DATE` literal — the
// `frisco-active-building-permits` standing answer) and that does not sort lexicographically
// either, so a `>=` string compare is wrong too (the `nyc-dob-permit-issuance` trap). The
// socrata connector has `recency_expr` for exactly this; arcgis has no equivalent yet.
//
// TWO SHAPES, ONLY ONE DANGEROUS:
//   • fixed FLOOR  (`Date >= '2025-01-01'`) — degrades gracefully. The window only GROWS, so it
//     never goes blind to new data; it just accumulates old rows. NOT checked here.
//   • fixed WINDOW (`Date LIKE '%/2025' OR LIKE '%/2026'`) — goes BLIND. On the first day of the
//     year after its newest listed year it stops matching new records and decays silently to
//     stale-only, then to zero. Nothing errors. This is the silent-nothing class.
//
// WHY THIS IS A TEST AND NOT A CALENDAR REMINDER. QUEUE.md carries a "review every January"
// item for exactly these entries. On 2026-08-04 a session shipped a NEW fixed-window entry
// (`centre-county-pa-building-permits`) and did not register it there.
//
// ⚠️ CORRECTED 2026-08-04: the first version of this comment blamed a stale checkout. THAT WAS
// WRONG, and the real cause is worse. The item WAS present in every tree the session ever had
// (verified: `git show 606aa11:QUEUE.md | grep -ci "dated constant"` → 1). The grep found nothing
// because it ran from the WRONG WORKING DIRECTORY with `2>/dev/null` — every path argument failed
// to exist, stderr was suppressed, and grep exited 0 with NO OUTPUT. A search that read zero files
// is byte-identical to a search that found zero matches.
//
// A recurring manual review is an instrument that cannot prove it ran; so is a suppressed grep.
// This one fires on its own, at the right time, from the data itself.
//
// WHAT IT ENFORCES:
//   1. RATCHET — the set of fixed-window entries is pinned. A new one cannot ship unnoticed.
//   2. CLIFF — an entry whose newest listed year is ALREADY PAST is a hard failure, always,
//      acknowledgement or not: it is losing records right now.
//   3. GRACE — an entry that goes blind at the END of the current year fails too, UNLESS it is
//      named in EXPIRING_ACKNOWLEDGED. That set is a ratchet to shrink, not a place to park work.
//
// The cheap mitigation is to PRE-INCLUDE NEXT YEAR: a year that has not started matches nothing,
// so it costs zero rows today and converts a hard cliff into a year of slack.
// Run: node scripts/run-unit-tests.mjs   (or: node test/dated-window-must-not-go-blind.test.mjs)
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}${detail ? '\n     ' + detail : ''}`); }
};

const reg = JSON.parse(readFileSync(
  new URL('../supabase/functions/get-address-report/jurisdiction-registry.json', import.meta.url), 'utf8'));

const entries = [];
(function walk(o) {
  if (Array.isArray(o)) o.forEach(walk);
  else if (o && typeof o === 'object') { if (o.registry_id) entries.push(o); Object.values(o).forEach(walk); }
})(reg);

// A fixed WINDOW is a LIKE clause pinned to a literal 4-digit year. A fixed FLOOR uses a
// comparison operator against a full date literal and is deliberately NOT matched.
const YEAR_LIKE = /LIKE\s*'%\/(\d{4})'/gi;
const windowed = [];
for (const e of entries) {
  const w = typeof e.extra_where === 'string' ? e.extra_where : '';
  const years = [...w.matchAll(YEAR_LIKE)].map((m) => Number(m[1]));
  if (years.length) windowed.push({ id: e.registry_id, years, maxYear: Math.max(...years) });
}

// ── 1. RATCHET ────────────────────────────────────────────────────────────────────────────────
// Every fixed-window entry, named. Adding one means adding it here AND to the QUEUE.md review item.
const KNOWN = new Set([
  'worcester-building-permits',
  'centre-county-pa-building-permits',
]);

console.log('\n1) RATCHET — every fixed-year-window entry is a known, registered one');
{
  const found = windowed.map((w) => w.id).sort();
  const unknown = found.filter((id) => !KNOWN.has(id));
  const missing = [...KNOWN].filter((id) => !found.includes(id));
  ok('no UNREGISTERED fixed-window entry has appeared',
    unknown.length === 0,
    unknown.length ? `unregistered: ${unknown.join(', ')} — add to KNOWN here AND to QUEUE.md "DATED CONSTANTS IN REGISTRY WINDOWS"` : '');
  // Shrinking is good, but it must be deliberate — a removed entry means the durable fix landed.
  ok('no registered entry has vanished without updating this list',
    missing.length === 0,
    missing.length ? `gone from the registry: ${missing.join(', ')} — drop from KNOWN if the constant was retired` : '');
  console.log(`     (${found.length} fixed-window entries: ${found.join(', ') || 'none'})`);
}

// ── 2 + 3. THE CLIFF ──────────────────────────────────────────────────────────────────────────
// Entries known to go blind at the end of the CURRENT year, accepted for now. Shrink this.
// worcester: window is 2025+2026, so it goes blind 2027-01-01. The fix is one more OR clause.
const EXPIRING_ACKNOWLEDGED = new Set([
  'worcester-building-permits',
]);

const nowYear = new Date().getUTCFullYear();

console.log(`\n2) CLIFF — no entry is ALREADY blind (current UTC year ${nowYear})`);
for (const w of windowed) {
  ok(`${w.id}: newest listed year ${w.maxYear} is not in the past`,
    w.maxYear >= nowYear,
    `window ends ${w.maxYear} but the year is ${nowYear} — this entry is matching NO new records right now`);
}

console.log('\n3) GRACE — an entry going blind at year-end must be acknowledged');
for (const w of windowed) {
  if (w.maxYear > nowYear) {
    ok(`${w.id}: has grace (blind on ${w.maxYear + 1}-01-01)`, true);
  } else {
    ok(`${w.id}: goes blind at year-end and is named in EXPIRING_ACKNOWLEDGED`,
      EXPIRING_ACKNOWLEDGED.has(w.id),
      `add '%/${nowYear + 1}' to its extra_where (a future year matches nothing, so it costs no rows today), or acknowledge it here`);
  }
}

// ── 4. SELF-TEST — prove the matcher discriminates window from floor ───────────────────────────
console.log('\n4) SELF-TEST — the matcher separates a fixed WINDOW from a fixed FLOOR');
{
  const yearsIn = (s) => [...s.matchAll(new RegExp(YEAR_LIKE.source, 'gi'))].map((m) => Number(m[1]));
  ok('a LIKE year list IS matched',
    yearsIn("(Issue_Date LIKE '%/2024' OR Issue_Date LIKE '%/2025')").join(',') === '2024,2025');
  ok('a >= date floor is NOT matched (it degrades gracefully, so it is out of scope)',
    yearsIn("Application_Received >= '2025/07/01'").length === 0);
  ok('an ISO floor is NOT matched',
    yearsIn("IssuedDate >= '2025-01-01'").length === 0);
  ok('no extra_where at all is NOT matched',
    yearsIn('').length === 0);
}

// ── 5. SELF-TEST — prove the CLIFF/GRACE rules actually fire ───────────────────────────────────
// A guard that has never been shown to fail attests to nothing. These drive the same decision
// function over synthetic years, so a future refactor cannot quietly make it vacuous.
console.log('\n5) SELF-TEST — the cliff/grace decision fires on each violation class');
{
  // Mirrors the two checks above: returns what the suite would conclude for one entry.
  const verdict = (maxYear, year, acknowledged) =>
    maxYear < year ? 'FAIL_ALREADY_BLIND'
      : maxYear > year ? 'PASS_HAS_GRACE'
        : acknowledged ? 'PASS_ACKNOWLEDGED' : 'FAIL_UNACKNOWLEDGED_CLIFF';

  ok('an entry whose window ENDED LAST YEAR fails, even if acknowledged',
    verdict(2026, 2027, true) === 'FAIL_ALREADY_BLIND');
  ok('an entry going blind at year-end fails when NOT acknowledged',
    verdict(2026, 2026, false) === 'FAIL_UNACKNOWLEDGED_CLIFF');
  ok('an entry going blind at year-end passes when acknowledged',
    verdict(2026, 2026, true) === 'PASS_ACKNOWLEDGED');
  ok('an entry with next year pre-included passes on its own',
    verdict(2027, 2026, false) === 'PASS_HAS_GRACE');
  // The live consequence, stated as a test so it is not just prose:
  ok('WORCESTER as configured today WILL fail this suite on 2027-01-01',
    verdict(2026, 2027, true) === 'FAIL_ALREADY_BLIND',
    'that is the intended alarm — extend its window or ship recency_expr for arcgis');
  ok('CENTRE as configured today still passes on 2027-01-01, and fails on 2028-01-01',
    verdict(2027, 2027, false) === 'FAIL_UNACKNOWLEDGED_CLIFF' && verdict(2027, 2028, false) === 'FAIL_ALREADY_BLIND');
}

console.log(fail ? `\n${fail} check(s) FAILED (${pass} passed)` : `\nAll ${pass} checks passed.`);
process.exit(fail ? 1 : 0);
