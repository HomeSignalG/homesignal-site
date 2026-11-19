// THE CREDIT RULE — whether a Development Activity report uses one of a brokerage's free reports (founder ruling R5, 2026-10-02).
//
// PURE. No environment, no network, no database. The trial handler (build step 5) asks this one function, and only calls the
// database's evaluation_report_issue (docs/evaluation-entitlement.sql) when it says the report uses one. No page, email or other
// function decides it again. The record of the ruling, in the founder's words: docs/development-activity-founder-ruling-r5-2026-10-02.md.
//
//   uses a free report ...... DEVELOPMENT_SHOWN, NO_DEVELOPMENT_ACTIVITY (a real answer about the area)
//   never uses one .......... NO_DATA_INGESTED (Jody's gap), NO_SIGNIFICANT_CHANGES (records were read and all left out: not a
//                             measured zero, and before 2026-11-02 these reports were NO_DATA_INGESTED, so charging is unchanged), the internal view, anything that is not an issued report
//                             (address not found, ZIP not covered, a report that cannot be stored), and anything this rule does
//                             not recognise. Unknown never charges: charging for a report Jody cannot vouch for is the
//                             error the ruling forbids.
//
// A report that shows development is charged even when it also carries a coverage limitation (a source not fully read, some
// sources not included, an area too large for one report), because data for the address is coming in. That is the R5 record's
// reading of "no data feeding ... should not be charged", open to the founder's correction there.
import { ACTIVITY_OUTCOMES, ACTIVITY_RULE_VERSION } from './national-report.ts';
import { COVERAGE_RULE_VERSION } from './coverage-assess.ts';

/** Bump whenever creditDecision() changes: the response and the credit ledger carry it, so a charge says which rule made it. */
export const CREDIT_RULE_VERSION = 'credit-rule-3';

export const CREDIT_REASONS = [
  'DEVELOPMENT_SHOWN', 'NO_DEVELOPMENT_ACTIVITY', 'NO_SIGNIFICANT_CHANGES', 'NO_VERIFIED_COVERAGE', 'NO_DATA_INGESTED', 'COVERAGE_NOT_VERIFIED', 'NO_LOCAL_RECORD',
  'INTERNAL_VIEW', 'NOT_A_REPORT', 'NOT_STORABLE', 'UNRECOGNISED',
] as const;
export type CreditReason = typeof CREDIT_REASONS[number];
export type CreditDecision = { uses_report: boolean; reason: CreditReason; rule_version: string };

/** The outcomes that can be a real answer about the area. Nothing else ever uses a report, and these two still need verified coverage (credit-rule-3).
 *  NO_DEVELOPMENT_ACTIVITY has no path in the engine in Phase 1 (activityOutcome), so in practice only DEVELOPMENT_SHOWN reaches the coverage check. */
const CHARGED: ReadonlySet<string> = new Set(['DEVELOPMENT_SHOWN', 'NO_DEVELOPMENT_ACTIVITY']);

function decide(uses_report: boolean, reason: CreditReason): CreditDecision {
  return { uses_report, reason, rule_version: CREDIT_RULE_VERSION };
}

/**
 * THE one credit decision.
 *   status    the response status ('OK' for a report; ADDRESS_NOT_RESOLVED and OUTSIDE_COVERAGE are not reports)
 *   view      'customer' or 'internal' (an operator's internal view is never charged)
 *   activity  the report's own `activity` object, exactly as the engine wrote it
 *   storable  whether the report may be stored: a report that cannot be issued cannot be charged for (plan lines 162-168)
 */
export function creditDecision(input: { status: unknown; view?: unknown; activity?: unknown; coverage?: unknown; storable?: unknown }): CreditDecision {
  if (!input || input.status !== 'OK') return decide(false, 'NOT_A_REPORT');
  if (input.view !== 'customer') return decide(false, 'INTERNAL_VIEW');
  const a = input.activity as { outcome?: unknown; rule_version?: unknown } | null | undefined;
  if (!a || typeof a !== 'object' || a.rule_version !== ACTIVITY_RULE_VERSION
    || typeof a.outcome !== 'string' || !(ACTIVITY_OUTCOMES as readonly string[]).includes(a.outcome)) {
    return decide(false, 'UNRECOGNISED');
  }
  const outcome = a.outcome as CreditReason;
  if (!CHARGED.has(outcome)) return decide(false, outcome);
  // credit-rule-3 (founder D1/D2, 2026-11-19): a charge also needs VERIFIED coverage, read from the report's own coverage_disclosure, which coverage-assess.ts
  // wrote: a displayed LOCAL permit/planning record, every applicable local source and every contributing source read successfully in the last 72 hours, and
  // an area that was neither truncated nor missing records. Transportation and statewide land-use records are shown but never charge on their own.
  // A missing, malformed or stale-rule coverage object fails closed (UNRECOGNISED); a coverage object that does not verify is COVERAGE_NOT_VERIFIED.
  const d = (input.coverage as { coverage_disclosure?: unknown } | null | undefined)?.coverage_disclosure as
    { rule_version?: unknown; verified_for_credit?: unknown; credit_basis?: unknown } | null | undefined;
  if (!d || typeof d !== 'object' || d.rule_version !== COVERAGE_RULE_VERSION || typeof d.verified_for_credit !== 'boolean') return decide(false, 'UNRECOGNISED');
  if (d.verified_for_credit !== true || d.credit_basis !== 'LOCAL_PERMIT_PLANNING_RECORD_SHOWN') {
    return decide(false, outcome === 'DEVELOPMENT_SHOWN' && d.verified_for_credit === true ? 'NO_LOCAL_RECORD' : 'COVERAGE_NOT_VERIFIED');
  }
  if (input.storable !== true) return decide(false, 'NOT_STORABLE');
  return decide(true, outcome);
}
