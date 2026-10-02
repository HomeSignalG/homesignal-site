// THE CREDIT RULE — whether a Development Activity report uses one of a brokerage's free reports (founder ruling R5, 2026-10-02).
//
// PURE. No environment, no network, no database. The trial handler (build step 5) asks this one function, and only calls the
// database's evaluation_report_issue (docs/evaluation-entitlement.sql) when it says the report uses one. No page, email or other
// function decides it again. The record of the ruling, in the founder's words: docs/development-activity-founder-ruling-r5-2026-10-02.md.
//
//   uses a free report ...... DEVELOPMENT_SHOWN, NO_DEVELOPMENT_ACTIVITY (a real answer about the area)
//   never uses one .......... NO_DATA_INGESTED (HomeSignal's gap), the internal view, anything that is not an issued report
//                             (address not found, ZIP not covered, a report that cannot be stored), and anything this rule does
//                             not recognise. Unknown never charges: charging for a report HomeSignal cannot vouch for is the
//                             error the ruling forbids.
//
// A report that shows development is charged even when it also carries a coverage limitation (a source not fully read, some
// sources not included, an area too large for one report), because data for the address is coming in. That is the R5 record's
// reading of "no data feeding ... should not be charged", open to the founder's correction there.
import { ACTIVITY_OUTCOMES, ACTIVITY_RULE_VERSION } from './national-report.ts';

/** Bump whenever creditDecision() changes: the response and the credit ledger carry it, so a charge says which rule made it. */
export const CREDIT_RULE_VERSION = 'credit-rule-1';

export const CREDIT_REASONS = [
  'DEVELOPMENT_SHOWN', 'NO_DEVELOPMENT_ACTIVITY', 'NO_DATA_INGESTED', 'INTERNAL_VIEW', 'NOT_A_REPORT', 'NOT_STORABLE', 'UNRECOGNISED',
] as const;
export type CreditReason = typeof CREDIT_REASONS[number];
export type CreditDecision = { uses_report: boolean; reason: CreditReason; rule_version: string };

/** The outcomes that are a real answer about the area. Nothing else ever uses a free report. */
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
export function creditDecision(input: { status: unknown; view?: unknown; activity?: unknown; storable?: unknown }): CreditDecision {
  if (!input || input.status !== 'OK') return decide(false, 'NOT_A_REPORT');
  if (input.view !== 'customer') return decide(false, 'INTERNAL_VIEW');
  const a = input.activity as { outcome?: unknown; rule_version?: unknown } | null | undefined;
  if (!a || typeof a !== 'object' || a.rule_version !== ACTIVITY_RULE_VERSION
    || typeof a.outcome !== 'string' || !(ACTIVITY_OUTCOMES as readonly string[]).includes(a.outcome)) {
    return decide(false, 'UNRECOGNISED');
  }
  const outcome = a.outcome as CreditReason;
  if (!CHARGED.has(outcome)) return decide(false, outcome);
  if (input.storable !== true) return decide(false, 'NOT_STORABLE');
  return decide(true, outcome);
}
