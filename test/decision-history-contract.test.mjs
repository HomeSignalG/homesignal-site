// test/decision-history-contract.test.mjs
//
// THE FOUNDER'S DECISION-HISTORY CONTRACT (2026-09-20), pinned end to end.
//
// The defect Pennhurst exposed: a genuine proposal that a government body DENIED was
// deleted outright. Measured across all 239 jurisdiction-registry entries at the time,
// 294 denial-shaped raw status values sat in `exclude` and ZERO in any emitting bucket;
// production `app_projects` carried 3,000,229 development rows with 0 `Decided`.
//
// What this file refuses to let regress, in the contract's own four parts:
//   1. BROWSING CATEGORY — a denied application stays under Proposed. Not deleted, not
//      "Canceled", not promoted to Approved, and an appeal is never an approval.
//   2. DECISION + HISTORY — a sourced notation, with the date only when the source
//      states one.
//   3. CURRENT-STATUS VERIFICATION — no surface asserts a current disposition a source
//      cannot support, INCLUDING where decision evidence is unavailable entirely.
//   4. ELIGIBILITY — one predicate behind counts, notifications and social claims.
//
// Run: node test/decision-history-contract.test.mjs
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0;
const ok = (c, name, detail) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name + (!c && detail ? '\n     ' + detail : ''));
  if (!c) fails++;
};

const D = await import(join(root, 'supabase/functions/get-address-report/sources/decision.ts'));

// ── 1. BROWSING CATEGORY ─────────────────────────────────────────────────────────
for (const o of D.DECISION_OUTCOMES) {
  ok(D.browsingBucketFor(o) === 'proposed',
    `${o} browses under Proposed — a decided application is a HISTORICAL proposal, never deleted`);
}
ok(D.DECISION_OUTCOMES.every((o) => D.browsingBucketFor(o) !== 'approved'),
  'no outcome is ever promoted to Approved — an appeal or a decision is not a grant');
// The administrative non-decisions must NOT be outcomes: calling a denial "Canceled" (or
// a lapse a "denial") is the specific mislabel the contract forbids in both directions.
for (const bad of ['cancelled', 'canceled', 'expired', 'void', 'closed', 'revoked', 'tabled']) {
  ok(D.DECISION_OUTCOMES.indexOf(bad) === -1,
    `"${bad}" is not a decision outcome — an administrative lapse is not a ruling on the merits`);
}

// ── 2. THE SOURCED NOTATION ──────────────────────────────────────────────────────
const mk = (over = {}) => D.decisionFor({
  bucket: 'denied', statusRaw: 'Denied', decisionDate: '2024-03-12',
  recordUrl: 'https://example.gov/case/1', urlPrecision: 'record', ...over,
});
{
  const d = mk();
  ok(d && d.outcome === 'denied' && d.decided_on === '2024-03-12',
    'a denied row yields a decision carrying the source\'s own status word and its stated date');
  ok(d.status_raw === 'Denied', 'status_raw is the publisher\'s value verbatim, so our reading is checkable');
  ok(d.later_disposition_verified === false,
    'a later appeal or re-filing is NEVER claimed as verified — it is a separate event we did not check');
  ok(/denied on 12 Mar 2024\.$/.test(D.decisionNotation(d, 'Conditional-use application')),
    'the notation reads as the contract\'s example: "<subject> denied on <verified date>."');

  const undated = mk({ decisionDate: null });
  ok(undated.decided_on === null, 'no decision date from the source → null, never a substitute');
  ok(/date not stated by the source/.test(D.decisionNotation(undated)),
    'a missing date is SAID, not hidden — dating a denial from a filing date would fabricate it');
  ok(!/\d{4}/.test(D.decisionNotation(undated)),
    'and no year leaks into the undated sentence from anywhere');

  // file_date must never be able to stand in for a decision date.
  const fromFileDate = D.decisionFor({
    bucket: 'denied', statusRaw: 'Denied', decisionDate: undefined,
    recordUrl: 'https://example.gov/case/1', file_date: '2020-01-01',
  });
  ok(fromFileDate.decided_on === null,
    'decisionFor reads ONLY a decision date — a filing date cannot leak into decided_on');

  ok(mk({ recordUrl: '' }) === null,
    'a decision with no official record URL is not built at all — an unsourced notation is refused');
  ok(D.decisionFor({ bucket: 'proposed', statusRaw: 'Active', recordUrl: 'u' }) === null,
    'an ordinary live proposal carries no decision');
  ok(D.decisionNotation(null) === '' && D.decisionNotation(undefined) === '',
    'no decision → no sentence (a caller may stamp it unconditionally)');

  const w = mk({ bucket: 'withdrawn', statusRaw: 'Withdrawn' });
  ok(/withdrawn by the applicant/.test(D.decisionNotation(w)) && !/denied/.test(D.decisionNotation(w)),
    'a withdrawal names the APPLICANT and is never worded as a refusal — different actor, different fact');
}

// ── 3. CURRENT-STATUS VERIFICATION ───────────────────────────────────────────────
{
  ok(D.sourceCanReportDenial('decision') && D.sourceCanReportDenial('title_only'),
    'a source with a decision bucket, or a notice feed, can report a refusal');
  ok(!D.sourceCanReportDenial('date_only'),
    'a decision DATE column is NOT denial coverage — it says when, never that it was refused');
  ok(!D.sourceCanReportDenial('none') && !D.sourceCanReportDenial(''),
    'no evidence, and an unknown value, both fail closed');

  for (const lvl of D.DECISION_EVIDENCE_LEVELS) {
    const line = D.currentStatusLine(null, lvl);
    ok(/not verified/.test(line),
      `evidence "${lvl}" with no decision → the line still qualifies the current status`);
    ok(!/\b(still )?(pending|active|undecided|awaiting)\b/i.test(line),
      `evidence "${lvl}" never asserts the application is pending`);
  }
  ok(D.currentStatusLine(null, 'none') === 'Application on file · Current decision status not verified.',
    'the unavailable-evidence case reads exactly the founder\'s qualification');
  ok(/later appeal or re-filing is not verified/.test(D.currentStatusLine(mk(), 'decision')),
    'with a decision on record, the UNVERIFIED later disposition is disclosed rather than implied');

  // A RECENT FETCH IS NOT PROOF OF A RECENT DECISION CHECK. Structural, because a future
  // edit that reads a refresh clock would satisfy every sentence assertion above.
  const src = readFileSync(join(root, 'supabase/functions/get-address-report/sources/decision.ts'), 'utf8');
  const body = src.slice(src.indexOf('export function currentStatusLine'));
  ok(!/refreshed_at|updated|last_seen|Date\.now|fetched/i.test(body.slice(0, body.indexOf('\n}'))),
    'currentStatusLine reads no clock and no freshness field — a recent fetch is not a decision check');
}

// ── 4. ELIGIBILITY — the one predicate ───────────────────────────────────────────
{
  ok(D.isActiveUndecided({ type: 'proposed' }), 'a live proposal is active and undecided');
  ok(!D.isActiveUndecided({ type: 'proposed', decision: mk() }),
    'a DENIED proposal is in the Proposed browsing category and is NOT an active application');
  ok(!D.isActiveUndecided({ type: 'proposed', decided: true }),
    'the engine\'s `decided` flag alone is enough to refuse');
  ok(!D.isActiveUndecided({ status: 'Decided' }),
    'app_projects\' own spelling ("Decided") is refused — one predicate serves all three shapes');
  ok(!D.isActiveUndecided({ type: 'approved' }) && !D.isActiveUndecided({ type: 'built' }),
    'approved and operating records are not pending applications either');
  ok(!D.isActiveUndecided(null) && !D.isActiveUndecided(undefined),
    'a missing row fails closed rather than counting');
}

// ── 5. THE REGISTRY ACTUALLY CARRIES DECISIONS NOW (the defect, measured) ────────
{
  const REG = JSON.parse(readFileSync(join(root, 'supabase/functions/get-address-report/jurisdiction-registry.json'), 'utf8'));
  const FAM = ['socrata', 'arcgis', 'ckan', 'csv', 'carto', 'opendatasoft'];
  const entries = FAM.flatMap((f) => (Array.isArray(REG[f]) ? REG[f] : []));
  ok(entries.length > 200, `registry read: ${entries.length} entries (control — a zero here would make every count below vacuous)`);

  let denied = 0, withdrawn = 0, excluded = 0, deniedInExclude = 0;
  const DENIAL_WORD = /\b(den(?:y|ied|ies|ial)|reject(?:ed|s)?|disapprov\w*|refus\w*)\b/i;
  // The ambiguity rules the generator refuses on — a value matching one of these is
  // SUPPOSED to stay in exclude, so it must not be counted as a regression below.
  const AMBIGUOUS = /\bor\b|\bestimated\b|\bvoid(ed)?\b|\b(amendment|reconsideration|appeal)\b|\bdept\b/i;
  for (const e of entries) {
    const s = e.status_to_bucket ?? {};
    denied += (s.denied ?? []).length;
    withdrawn += (s.withdrawn ?? []).length;
    for (const v of (s.exclude ?? [])) {
      excluded++;
      if (DENIAL_WORD.test(v) && !AMBIGUOUS.test(v)) deniedInExclude++;
    }
  }
  ok(denied > 0 && withdrawn > 0,
    `decision buckets are populated: ${denied} denied, ${withdrawn} withdrawn (was 0 and 0 — every denial was dropped)`);
  ok(excluded > 0, `exclude still holds ${excluded} administrative values (control — the move was surgical, not a purge)`);
  ok(deniedInExclude === 0,
    'no UNAMBIGUOUS denial value is left in exclude — that is the original defect, and it is gone',
    `${deniedInExclude} still excluded`);

  // A value in two buckets is unresolvable — buildBucketLookup throws on it.
  let dup = 0;
  for (const e of entries) {
    const s = e.status_to_bucket ?? {}, seen = new Map();
    for (const b of Object.keys(s)) for (const v of (s[b] ?? [])) {
      const n = String(v).trim().toLowerCase();
      if (seen.has(n) && seen.get(n) !== b) dup++;
      seen.set(n, b);
    }
  }
  ok(dup === 0, 'no status is in two buckets of one entry — values MOVED, they were never copied');

  // Coverage is a per-SOURCE fact and must stay separable from code coverage.
  const can = entries.filter((e) => D.sourceCanReportDenial(D.decisionEvidenceLevel(e))).length;
  ok(can > 0 && can < entries.length,
    `decision-evidence coverage is PARTIAL and measured: ${can} of ${entries.length} sources can report a refusal`,
    'a 0 would mean nothing was enabled; a 100% would mean the measurement is not measuring');

  // The Pennhurst regression case, named. Chester County's Act 247 layer has no status
  // column at all, so it can never report a denial — and the contract's answer to that is
  // the honest qualification, not an asserted current status.
  const chester = entries.find((e) => e.registry_id === 'chester-county-pa-act247-plans');
  ok(!!chester, 'chester-county-pa-act247-plans is in the registry (control for the assertion below)');
  if (chester) {
    ok(D.decisionEvidenceLevel(chester) === 'none',
      'Chester County PA CANNOT report a refusal — no status column, so decision evidence is unavailable');
    ok(D.currentStatusLine(null, D.decisionEvidenceLevel(chester))
       === 'Application on file · Current decision status not verified.',
      'so every Chester County record reads the honest qualification — the universal protection, working');
  }
}

console.log(fails ? `\n${fails} check(s) FAILED` : '\nAll decision-history contract checks passed.');
process.exit(fails ? 1 : 0);
