// Registry lint: STALLED STATUSES NEVER CLAIM MOTION (fleet ruling, founder, 2026-08-18).
//
// THE PRINCIPLE. A bucket is a claim to the resident — `proposed` claims "you may still
// weigh in," `approved` claims "this is moving." A held/stalled/suspended project supports
// neither; pausing is not proposing, and wrong content is worse than no content. The ruling
// flipped 31 raw values across 28 entries (1,044 cached records were rendering as proposed);
// this lint makes the class impossible to REINTRODUCE silently.
//
// Any status_to_bucket raw value matching the hold/stall/suspend/pause/dormant/inactive
// pattern that is bucketed to `proposed` or `approved` FAILS this test — unless the exact
// (registry_id, raw value) pair is on the reviewed-exceptions list below. Exceptions are
// PER-ENTRY, never per-word: the same raw value on a different entry trips the lint for
// its own review.
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}${detail ? '\n     ' + detail : ''}`); }
};

// Word-ish boundaries: 'shareholder' / 'withhold' / 'threshold' must NOT match.
const STALLED = /\b(on[\s_-]?hold|hold|held|stall\w*|suspend\w*|pause\w*|dormant|frozen|inactive)\b/i;

// REVIEWED EXCEPTIONS — every pair carries its founder-ruled rationale. This list may grow
// only with a rationale; a bare pair is itself a lint failure.
const EXCEPTIONS = new Map([
  ['sussex-county-de-conditional-use|Deferred',
    'hearing-register semantics: a deferred agenda item returns to the board and the comment window is genuinely open (founder, 2026-08-18)'],
  ['sussex-county-de-conditional-use|Defered',
    'same ruling — the upstream misspelling variant of the same hearing outcome'],
  ['raleigh-building-permits|INACTIVE (INSPECTIONS COMPLETED)',
    'completed-inactive: "inactive" here means finished, not stalled — inspections are done, operating is the honest bucket (founder, 2026-08-18)'],
]);
// NOTE: "Deferred" deliberately does NOT appear in the STALLED pattern — it is ambiguous
// (a stalled project vs a postponed hearing item). The Sussex pairs are listed so the
// exception survives even if a future edit adds defer\w* to the pattern; adding it is the
// intended way to force review of every new Deferred-type value.

const reg = JSON.parse(readFileSync(
  new URL('../supabase/functions/get-address-report/jurisdiction-registry.json', import.meta.url), 'utf8'));
const entries = [];
(function walk(o) {
  if (Array.isArray(o)) o.forEach(walk);
  else if (o && typeof o === 'object') { if (o.registry_id) entries.push(o); Object.values(o).forEach(walk); }
})(reg);

function violations(entryList) {
  const out = [];
  for (const e of entryList) {
    const s2b = e.status_to_bucket;
    if (!s2b || typeof s2b !== 'object') continue;
    for (const bucket of ['proposed', 'approved']) {
      for (const v of s2b[bucket] || []) {
        if (!STALLED.test(String(v))) continue;
        if (EXCEPTIONS.has(`${e.registry_id}|${v}`)) continue;
        out.push(`${e.registry_id}: '${v}' -> ${bucket}`);
      }
    }
  }
  return out;
}

console.log(`1) no stalled-pattern raw value claims motion (${entries.length} entries scanned)`);
{
  const v = violations(entries);
  ok('zero hold/stall/suspend/pause/dormant/inactive values bucketed to proposed or approved (beyond the reviewed exceptions)',
    v.length === 0, v.join('\n     '));
}

console.log('\n2) the exceptions list stays honest');
{
  // Every exception must still exist in the registry with the stated bucket — a stale
  // exception tells the reader a ruling applies to a value that is gone.
  const stale = [];
  for (const key of EXCEPTIONS.keys()) {
    const [rid, val] = key.split('|');
    const e = entries.find((x) => x.registry_id === rid);
    const buckets = e?.status_to_bucket || {};
    const present = ['proposed', 'approved', 'operating', 'exclude'].some((b) => (buckets[b] || []).includes(val));
    if (!present) stale.push(key);
  }
  ok('every reviewed exception still names a live (registry_id, raw value) pair', stale.length === 0, stale.join(', '));
  ok('every exception carries a written rationale', [...EXCEPTIONS.values()].every((r) => r && r.length > 20));
  // Per-entry, never per-word: prove the SAME raw value on a DIFFERENT entry is still caught.
  const planted = violations([{ registry_id: 'some-other-register', status_to_bucket: { proposed: ['Deferred', 'INACTIVE (INSPECTIONS COMPLETED)'], approved: [], operating: [], exclude: [] } }]);
  ok('an exception never travels: the exempted raw values on any OTHER entry are not exempt',
    planted.length === 1 && planted[0].includes('INACTIVE (INSPECTIONS COMPLETED)'),
    JSON.stringify(planted));
}

console.log('\n3) SELF-TEST — the lint can fail');
{
  const plant = (val, bucket) => violations([{ registry_id: 'planted', status_to_bucket: { proposed: bucket === 'proposed' ? [val] : [], approved: bucket === 'approved' ? [val] : [], operating: [], exclude: [] } }]);
  ok("planted 'On Hold' -> proposed is caught", plant('On Hold', 'proposed').length === 1);
  ok("planted 'Suspended' -> approved is caught", plant('Suspended', 'approved').length === 1);
  ok("planted 'Review on Hold' -> proposed is caught (embedded phrase)", plant('Review on Hold', 'proposed').length === 1);
  ok("planted 'Dormant' -> proposed is caught", plant('Dormant', 'proposed').length === 1);
  // Over-flagging direction pinned too — the gate must not become noise:
  ok("'Withhold of Occupancy Released' does NOT match (word boundary)", plant('Withholding', 'proposed').length === 0);
  ok("'Shareholder Review' does NOT match", plant('Shareholder Review', 'proposed').length === 0);
  ok("'Threshold Review' does NOT match", plant('Threshold Review', 'proposed').length === 0);
  ok("a stalled value bucketed to EXCLUDE passes (that is the ruling's endpoint)",
    violations([{ registry_id: 'x', status_to_bucket: { proposed: [], approved: [], operating: [], exclude: ['On Hold'] } }]).length === 0);
}


console.log(fail ? `\n${fail} stalled-status-bucket check(s) FAILED` : `\nAll ${pass} stalled-status-bucket checks passed.`);
process.exit(fail ? 1 : 0);
