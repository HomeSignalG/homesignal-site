// supabase/functions/get-address-report/sources/decision.ts
//
// THE ONE AUTHORITY for an application's DECISION HISTORY, shared by every connector
// (socrata · arcgis · ckan · csv · carto), the engine's area-notice path, and — through
// the parity test that pins the two vocabularies together — lib/map.js on the page.
//
// ── WHY THIS FILE EXISTS (the measured defect, 2026-09-20) ────────────────────────────
// A genuine proposal that a government body DENIED was deleted from HomeSignal outright.
// Measured across all 239 jurisdiction-registry entries: 294 denial-shaped raw status
// values ("Denied", "CC Rejected", "Withdrawn", "Denied but Closed", …) and 294 of 294
// sat in the `exclude` bucket — ZERO in any emitting bucket. `exclude` means "never
// emit", so the record never reached `development_reports.sites`, never reached
// `app_projects`, and never reached a resident. Control, same measurement: the emitting
// buckets carry 681 proposed / 425 approved / 299 operating values, so the 294-and-zero
// split is a real signal, not an empty read.
//
// Corroborated in production the same day: `app_projects` carries 3,000,229
// `record_kind='development'` rows whose ONLY status values are Operating (1,378,872),
// Approved (1,264,479), Proposed (356,873) and Active (5). No denial, no decision. And
// across a 299-ZIP / 48,342-site sample of `development_reports`, sites carrying
// `decided:true` = 0 (control: 277 area sites, 48,342 sites read). The decision plane
// was empty everywhere.
//
// ── THE PRODUCT CONTRACT THIS IMPLEMENTS (founder, 2026-09-20) ────────────────────────
// A denied proposal REMAINS DISCOVERABLE under Proposed, carrying a prominent sourced
// decision notation. It is never auto-deleted, never relabelled "Canceled", and an
// appeal is never treated as approval. FOUR things are separated, and this module is
// where that separation is defined once:
//
//   1. BROWSING CATEGORY  — `browsingBucketFor()`. A decided application is a historical
//      proposal, so it stays in `proposed`. This is what a resident BROWSES.
//   2. DECISION + HISTORY — `decisionFor()`. The outcome, its verified date when the
//      source states one, and the source URL that proves it.
//   3. CURRENT-STATUS VERIFICATION — `decisionEvidenceLevel()` / `currentStatusLine()`.
//      Whether this source can tell us a CURRENT disposition at all.
//   4. ELIGIBILITY — `isActiveUndecided()`. The ONE predicate for active-proposal counts,
//      upcoming-decision lists, notifications and social claims.
//
// A resident must be able to read (1) without any of the other three being implied by it.
//
// ── THE RULE THAT IS EASIEST TO GET WRONG ─────────────────────────────────────────────
// A RECENT FETCH IS NOT PROOF OF A RECENT DECISION CHECK. `refreshed_at` says when we
// re-read the publisher's dataset; it says nothing about whether the publisher re-checked
// the application, and nothing at all when the dataset carries no decision column. So no
// surface may assert a CURRENT disposition from freshness. Where the source cannot
// support the claim, `currentStatusLine()` returns the honest qualification instead.
//
// ⛔ SHARED CODE COVERAGE IS NOT KNOWLEDGE OF EVERY MUNICIPALITY. Every page runs this
// module; that is outcome one. What each SOURCE can actually evidence is a separate,
// separately measured fact — see scripts/measure-decision-evidence-coverage.mjs. Do not
// report the first as if it were the third.

// ───────────────────────────── vocabulary ─────────────────────────────

/** Dispositions that END an application without granting it. Each is the authority's or
 *  the applicant's OWN act, and each is described by its own word — never collapsed into
 *  one, because "denied" (the body refused it) and "withdrawn" (the applicant pulled it)
 *  are different facts about different actors, and calling either one "Canceled" is the
 *  specific mislabel this contract forbids.
 *
 *  ⛔ DELIBERATELY NOT MEMBERS: expired · void · cancelled · closed · revoked. Those are
 *  administrative lapses, not decisions on the merits — a source saying "Expired" has not
 *  told us the body ever ruled. They stay in `exclude`, where they already are, because
 *  surfacing them under a "Decision" heading would assert a ruling nobody made. That is
 *  the same fabrication this whole workstream exists to remove, reached from the other
 *  side. Adding a member here is a founder decision, not a maintenance edit. */
export const DECISION_OUTCOMES = ["denied", "withdrawn"] as const;
export type DecisionOutcome = (typeof DECISION_OUTCOMES)[number];

/** Resident-facing words for each outcome. Plain, and each names the ACTOR, so a reader
 *  can tell a refusal from a retreat without opening the record. */
export const DECISION_LABELS: Record<DecisionOutcome, string> = {
  denied: "Denied",
  withdrawn: "Withdrawn by applicant",
};

/** How strong the evidence for the decision is. This is stamped on the record so a
 *  downstream surface never has to guess how much weight the notation can bear.
 *    • "source_status" — the publisher's OWN status field said so (the strong case).
 *    • "title_text"    — a government notice's TITLE said so (the area-notice path).
 *  A title is real evidence and is shown, but it is labelled as wording rather than as a
 *  status field, because the two are not equally checkable. */
export const DECISION_BASES = ["source_status", "title_text"] as const;
export type DecisionBasis = (typeof DECISION_BASES)[number];

/** What a SOURCE is capable of telling us about a current disposition. NOT a ranking —
 *  it is a SET, and the only question asked of it is `sourceCanReportDenial()`.
 *    • "decision"   — the registry entry declares at least one decision bucket, so this
 *                     source CAN report a denial and its silence is informative.
 *    • "title_only" — a government-notice feed. A denial is detectable only from the
 *                     notice's WORDING, so it can report one, but never as a status field
 *                     and never with a decision date.
 *    • "date_only"  — no decision bucket, but a decision_date column exists: we can date a
 *                     decision the source records and CANNOT see a refusal.
 *    • "none"       — neither. This source can NEVER report a denial, so "still pending"
 *                     is unsupportable for every record it produces, however fresh.
 *  ⚠️ "date_only" is deliberately grouped with "none", not with "decision": a date column
 *  tells us WHEN something was decided, never THAT it was refused. Reading a decision date
 *  as denial coverage is the substitution this whole unit exists to prevent. */
export const DECISION_EVIDENCE_LEVELS = ["decision", "title_only", "date_only", "none"] as const;
export type DecisionEvidenceLevel = (typeof DECISION_EVIDENCE_LEVELS)[number];

// ───────────────────────────── the decision record ─────────────────────────────

export interface DecisionRecord {
  outcome: DecisionOutcome;
  /** Resident-facing word for the outcome (DECISION_LABELS). */
  outcome_label: string;
  /** The publisher's OWN value, verbatim — the same discipline `status_raw` follows.
   *  It is what lets a reader check our reading of it against the source. */
  status_raw: string;
  /** ISO date the decision was made, ONLY when the source states one. Null is a
   *  first-class value: "denied, date not stated" is a fact we can print, and inventing
   *  a date from file_date or from refreshed_at would fabricate the one field a resident
   *  would rely on. NEVER fill this from anything but a decision date column. */
  decided_on: string | null;
  basis: DecisionBasis;
  /** The official public record backing the notation. Required — a decision with no
   *  source is exactly the unsourced claim the anti-fabrication gate refuses. */
  source_url: string;
  source_precision: "record" | "dataset";
  /** A LATER disposition (an appeal, a re-filing, a remand) is a separate application
   *  event we have NOT checked for. Always false here: this module never asserts it, and
   *  the field exists so a surface discloses the limit instead of implying completeness.
   *  An appeal is NEVER an approval — a surface that learns of one must add it as a
   *  subsequent event beside this decision, not overwrite the decision with it. */
  later_disposition_verified: false;
}

/** BROWSING CATEGORY — separation (1).
 *  A decided application is a HISTORICAL PROPOSAL, so it browses under `proposed`. It is
 *  not promoted to `approved` (the body refused it) and it is not deleted (it happened,
 *  and a resident searching the address must find it). */
export function browsingBucketFor(_outcome: DecisionOutcome): "proposed" {
  return "proposed";
}

function isIsoDay(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v);
}

/** Build the decision record for an emitted row. Returns null for a lifecycle bucket, so
 *  a caller can stamp the result unconditionally and an ordinary proposal carries null. */
export function decisionFor(input: {
  bucket: string;
  statusRaw: string;
  decisionDate?: string | null;
  recordUrl: string;
  urlPrecision?: "record" | "dataset";
  basis?: DecisionBasis;
}): DecisionRecord | null {
  const outcome = (DECISION_OUTCOMES as readonly string[]).includes(input.bucket)
    ? (input.bucket as DecisionOutcome)
    : null;
  if (!outcome) return null;
  const url = String(input.recordUrl || "").trim();
  // ANTI-FABRICATION, same gate every emitted site already passes: a decision notation
  // with nothing to link to cannot be shown as sourced, so it is not built at all. The
  // caller then treats the row as it did before this unit existed.
  if (!url) return null;
  return {
    outcome,
    outcome_label: DECISION_LABELS[outcome],
    status_raw: String(input.statusRaw ?? "").trim(),
    decided_on: isIsoDay(input.decisionDate) ? String(input.decisionDate).slice(0, 10) : null,
    basis: input.basis ?? "source_status",
    source_url: url,
    source_precision: input.urlPrecision === "dataset" ? "dataset" : "record",
    later_disposition_verified: false,
  };
}

/** What this registry entry can evidence — separation (3), measured per SOURCE.
 *  Reads the entry's own declarations only; it never inspects a row, so it is the same
 *  answer for every record the entry produces and can be reported per source. */
export function decisionEvidenceLevel(entry: {
  status_to_bucket?: Record<string, string[] | undefined>;
  column_map?: { decision_date?: unknown };
}): DecisionEvidenceLevel {
  const s2b = entry?.status_to_bucket ?? {};
  for (const o of DECISION_OUTCOMES) {
    if ((s2b[o] ?? []).length > 0) return "decision";
  }
  const dd = entry?.column_map?.decision_date;
  const hasDateCol = Array.isArray(dd) ? dd.length > 0 : dd != null && dd !== "";
  return hasDateCol ? "date_only" : "none";
}

// ───────────────────────────── eligibility — separation (4) ─────────────────────────────

/** THE ONE PREDICATE for "counts as an active, undecided application".
 *
 * Every active-proposal count, upcoming-decision list, notification and social claim
 * MUST route through this. A denied proposal stays in the Proposed browsing category and
 * is refused here — that is the whole point of separating (1) from (4), and the reason
 * this is a function rather than a `status === 'Proposed'` test repeated per surface.
 *
 * Accepts a loose row so the same function serves an engine site object, a connector
 * record and an `app_projects` row without three spellings of one rule. */
export function isActiveUndecided(row: {
  decision?: unknown;
  decided?: unknown;
  status?: unknown;
  type?: unknown;
  bucket?: unknown;
} | null | undefined): boolean {
  const r = row ?? {};
  if (r.decision) return false;                       // a recorded decision ends it
  if (r.decided === true || r.decided === "true") return false;
  // `app_projects` spelling: the materializer writes 'Decided' whenever the site says so.
  if (String(r.status ?? "").trim().toLowerCase() === "decided") return false;
  const stage = String(r.bucket ?? r.type ?? r.status ?? "").trim().toLowerCase();
  return stage === "proposed";
}

// ───────────────────────────── copy — separations (2) and (3) ─────────────────────────────

/** Format an ISO day for a resident. Deliberately unlocalised and unambiguous. */
function humanDay(iso: string): string {
  const M = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const mon = M[Number(m[2]) - 1];
  return mon ? `${Number(m[3])} ${mon} ${m[1]}` : iso;
}

/** THE DECISION NOTATION — separation (2). One sentence, sourced, never speculative.
 *
 *  `subject` is what the source calls the application ("Conditional-use application"),
 *  passed in because only the caller knows the record's own words; it falls back to the
 *  neutral "Application" rather than inventing a permit class.
 *
 *  A missing date is SAID, not hidden: "denied · date not stated by the source" is an
 *  honest sentence, and dating a denial from a filing date would be the fabrication this
 *  module exists to prevent. */
export function decisionNotation(
  decision: DecisionRecord | null | undefined,
  subject?: string | null,
): string {
  if (!decision) return "";
  const subj = String(subject || "").trim() || "Application";
  const verb = decision.outcome === "denied" ? "denied" : "withdrawn by the applicant";
  const when = decision.decided_on
    ? ` on ${humanDay(decision.decided_on)}`
    : " · date not stated by the source";
  const how = decision.basis === "title_text" ? " (stated in the notice title)" : "";
  return `${subj} ${verb}${when}${how}.`;
}

/** THE CURRENT-STATUS LINE — separation (3). The universal protection.
 *
 *  Returns what a surface may HONESTLY say about the application's disposition TODAY.
 *  Three cases, and the third is the one that protects the 12,722 pages:
 *    • a recorded decision  → state it, and disclose that any later step is unverified.
 *    • no decision, source CAN report one → the absence is informative, but it is still
 *      not a fresh check, so it is qualified rather than asserted as "still pending".
 *    • no decision, source CANNOT report one → the honest qualification, always.
 *
 *  ⛔ There is no branch that reads a fetch time. That is deliberate and load-bearing. */
export function currentStatusLine(
  decision: DecisionRecord | null | undefined,
  evidence: DecisionEvidenceLevel,
): string {
  if (decision) {
    return `${decision.outcome_label} on the record · Any later appeal or re-filing is not verified.`;
  }
  if (sourceCanReportDenial(evidence)) {
    return "Application on file · No decision recorded by this source · Current decision status not verified.";
  }
  return "Application on file · Current decision status not verified.";
}

/** Can this source report a REFUSAL at all? The one question asked of an evidence level.
 *  A source that cannot must never have any of its records described as still pending. */
export function sourceCanReportDenial(evidence: DecisionEvidenceLevel | string): boolean {
  return evidence === "decision" || evidence === "title_only";
}

/** Heading disclosure for a browsing category that MIXES live and decided applications.
 *  Shown only when the rail actually holds a decided record, so a page with none is
 *  byte-for-byte unchanged and the sentence never appears without something to explain. */
export const PROPOSED_INCLUDES_HISTORY_NOTE =
  "Includes historical proposals — applications that were filed and later decided.";
