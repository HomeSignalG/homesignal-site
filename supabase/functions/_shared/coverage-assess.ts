// COVERAGE ASSESSMENT — what a Development Activity report may claim about the sources it read, and whether it may be charged (founder decisions
// 2026-11-19: D1 credit, D2 freshness, D3 geographic coverage, D4 language). PURE: no environment, network or database. The ONE place this is decided;
// national-report.ts asks it once per report and stores the answer in `coverage.coverage_disclosure`, which every surface (online, PDF, shared, saved)
// prints as written. No view, no credit rule and no other module re-derives any of it.
//
// AUTHORITIES (nothing here decides a class or an applicability itself):
//   source class ........ jurisdiction-registry.json `source_class`, bundled as source-class.generated.json (scripts/gen-source-class.mjs). SOLE billing authority.
//   applicability ....... source-applicability.ts (the registry's declared state and county; #3050). County-level only in Phase 1 (D3).
//   health .............. SourceHealth rows: failure counts (dev_change_source_fetch_health) and last_success_at (dev_source_freshness).
//
// FAIL CLOSED (D2): a source with no health row, no last_success_at, an unreadable one, one older than 72 hours, or any failed / blocked / truncated read is
// NOT verified. A source whose class is unknown is never chargeable. Truncation and records that could not be loaded prevent verified coverage.
// D1: ONLY `local_permit_planning` can make a report chargeable. Transportation and land-use records are always shown, never charged on their own.
// D3: NO_DEVELOPMENT_ACTIVITY is unreachable in Phase 1 (activityOutcome has no path to it): county-level applicability is not evidence that a source covers an
// exact address. Phase 2 needs authoritative jurisdiction boundaries; no record-point footprint is ever used.
import classFile from './source-class.generated.json' with { type: 'json' };

export const COVERAGE_RULE_VERSION = 'coverage-rule-1';
/** D2: the maximum age of the last SUCCESSFUL read of a source. Publisher record dates are informational only and never enter this. */
export const READ_FRESHNESS_HOURS = 72;

export const SOURCE_CLASSES = ['local_permit_planning', 'local_transportation', 'statewide_transportation', 'statewide_land_use'] as const;
export type SourceClass = typeof SOURCE_CLASSES[number];
const CLASSES: Record<string, string> = ((classFile as unknown as { families?: Record<string, string> }).families) ?? {};

/** The class the registry gives a source, or null when it has none (unclassified: shown, never chargeable). */
export function sourceClassOf(family: string | null | undefined): SourceClass | null {
  const c = family && Object.prototype.hasOwnProperty.call(CLASSES, family) ? CLASSES[family] : null;
  return (SOURCE_CLASSES as readonly string[]).includes(c as string) ? (c as SourceClass) : null;
}

export type HealthRow = {
  registry_id: string; fetch_failures_24h: number; blocked_24h: number; truncated_24h: number;
  /** the last successful read of the source (dev_source_freshness.last_success_at); absent or null = unknown */
  last_success_at?: string | null;
};
export type ReadState = 'HEALTHY' | 'DEGRADED' | 'STALE_READ' | 'UNKNOWN';

/** D2 for one source. Missing or malformed evidence is UNKNOWN, never healthy. */
export function readStateOf(h: HealthRow | undefined, now: Date): ReadState {
  if (!h || typeof h !== 'object') return 'UNKNOWN';
  const nums = [h.fetch_failures_24h, h.blocked_24h, h.truncated_24h];
  if (nums.some((n) => !Number.isInteger(n) || n < 0)) return 'UNKNOWN';
  if (nums.some((n) => n > 0)) return 'DEGRADED';
  if (typeof h.last_success_at !== 'string' || !h.last_success_at) return 'UNKNOWN';
  const t = Date.parse(h.last_success_at);
  if (!Number.isFinite(t)) return 'UNKNOWN';
  const ageH = (now.getTime() - t) / 3_600_000;
  if (ageH < -1) return 'UNKNOWN';                    // a read dated in the future is not evidence
  return ageH > READ_FRESHNESS_HOURS ? 'STALE_READ' : 'HEALTHY';
}

export type Availability = 'LOCAL_PERMIT_PLANNING' | 'TRANSPORT_OR_LAND_USE_ONLY' | 'NONE';
export type EmptyReason =
  | 'AREA_INCOMPLETE' | 'NO_SOURCE' | 'NO_LOCAL_PERMIT_SOURCE' | 'SOURCE_UNHEALTHY' | 'SOURCE_STALE' | 'HEALTH_UNKNOWN' | 'FOOTPRINT_NOT_VERIFIED';

export type CoverageInput = {
  now: Date;
  /** registry families applicable to the subject by verified state and county (source-applicability.ts) */
  applicable: string[];
  /** families of every key the spatial read found (loaded or not) */
  found: string[];
  /** families of the records DISPLAYED in the report (included in `projects`) */
  displayed: string[];
  health: HealthRow[];
  truncated: boolean;
  notHydrated: number;
  /** official records the relevance rule read and left out (relevance_review); a report of only these still discloses its coverage */
  judgedCount: number;
  /** publishing agency of a family (customer-facing names), supplied by the caller so this module imports nothing from the report */
  agencyOf: (family: string) => string | null;
};
export type Limitation = { code: string; text: string };
export type CoverageAssessment = {
  rule_version: string;
  availability: Availability;
  /** classes of the sources that returned a displayed record */
  classes_shown: SourceClass[];
  /** classes of every applicable source */
  classes_applicable: SourceClass[];
  local_permit_read_state: ReadState | 'NOT_APPLICABLE';
  area_complete: boolean;
  /** D1: chargeable on coverage grounds (outcome DEVELOPMENT_SHOWN is checked by the credit rule) */
  verified_for_credit: boolean;
  credit_basis: 'LOCAL_PERMIT_PLANNING_RECORD_SHOWN' | null;
  /** why an empty report is not a verified absence (null when records are displayed or judged) */
  empty_reason: EmptyReason;
  limitations: Limitation[];
};

const uniq = (xs: Array<string | null | undefined>): string[] => [...new Set(xs.filter((x): x is string => !!x))].sort();
const classes = (fs: string[]): SourceClass[] => [...new Set(fs.map(sourceClassOf).filter((c): c is SourceClass => !!c))].sort() as SourceClass[];
const worst = (xs: ReadState[]): ReadState => (['DEGRADED', 'STALE_READ', 'UNKNOWN'] as ReadState[]).find((s) => xs.includes(s)) ?? 'HEALTHY';

// ── copy (D4): JODY, never the old brand; missing records are told apart from missing or degraded coverage ───────────────────────────────────────────────────
export const NO_RECORDS_HEADLINE = 'No records found — coverage here is limited';
/** The sentence every non-empty report and every report of only excluded records opens its coverage paragraph with (the standing wording of national-8). */
export const COVERAGE_BASE = 'This report reflects development activity identified within the property\'s search radius using official government records monitored by JODY. Additional development activity may exist that is not reflected in this report.';
const names = (agencies: string[]) => (agencies.length ? ' (' + agencies.join('; ') + ')' : '');
export function emptyReasonText(reason: EmptyReason, agencies: string[]): string {
  const a = names(agencies);
  switch (reason) {
    case 'AREA_INCOMPLETE': return 'This area holds more records than one report can carry, or some records could not be loaded, so JODY cannot say that nothing else is nearby.';
    case 'NO_SOURCE': return 'JODY does not yet read an official development source for this area, so it cannot say anything about nearby development.';
    case 'NO_LOCAL_PERMIT_SOURCE': return 'JODY found no development records within 0.5 mile of this address. For this area JODY currently reads transportation or land-use project data only' + a + ', not local building-permit or planning records. This is not a finding that nothing is being built nearby.';
    case 'SOURCE_UNHEALTHY': return 'JODY could not fully read its official source for this area' + a + ' in the last 3 days, so a missing record may be a gap on our side.';
    case 'SOURCE_STALE': return 'JODY has not read its official source for this area' + a + ' successfully in the last 3 days, so a missing record may be a gap on our side.';
    case 'HEALTH_UNKNOWN': return 'JODY cannot yet confirm that its source for this area' + a + ' was read in the last 3 days.';
    default: return 'JODY found no development records within 0.5 mile of this address in the local sources it reads for this county' + a + '. JODY has not verified that those sources cover this exact address, so this is not a finding that nothing is being built nearby.';
  }
}
export const PARTIAL_TRANSPORT_ONLY = (agencies: string[]) =>
  'This report draws on transportation or land-use project records only' + names(agencies) + '. JODY does not yet read local building-permit or planning records for this area, so nearby activity may be missing.';
export const PARTIAL_NO_LOCAL_RECORD = (agencies: string[]) =>
  'JODY reads local building-permit or planning sources for this county, but none returned a record within 0.5 mile of this address. This report draws on ' + (agencies.join('; ') || 'other sources') + ' only, so nearby activity may be missing.';
export const LOCAL_SOURCE_NOT_VERIFIED = 'JODY could not confirm that its local building-permit or planning source for this area was fully read in the last 3 days, so nearby activity may be missing.';

/** ONE assessment of what a report's sources support. Never throws; every doubt is a refusal to verify. */
export function assessCoverage(input: CoverageInput): CoverageAssessment {
  const applicable = uniq(input.applicable), displayed = uniq(input.displayed);
  const judged = uniq([...applicable, ...input.found, ...displayed]);
  const healthOf = new Map(input.health.map((h) => [h.registry_id, h] as const));
  const state = (f: string) => readStateOf(healthOf.get(f), input.now);

  const scope = uniq([...applicable, ...input.found, ...displayed]);       // sources this report can be judged on
  const localApplicable = scope.filter((f) => sourceClassOf(f) === 'local_permit_planning');
  const shownLocal = displayed.filter((f) => sourceClassOf(f) === 'local_permit_planning');
  const classesApplicable = classes(scope);
  const availability: Availability = localApplicable.length ? 'LOCAL_PERMIT_PLANNING' : scope.length ? 'TRANSPORT_OR_LAND_USE_ONLY' : 'NONE';

  const localState: ReadState | 'NOT_APPLICABLE' = localApplicable.length ? worst(localApplicable.map(state)) : 'NOT_APPLICABLE';
  const areaComplete = !input.truncated && input.notHydrated === 0;
  // D1 + D2 + B1: every applicable local permit source, and every source that contributed a displayed record, must be healthy; an unhealthy
  // transportation source that contributed nothing is disclosed (below) but does not block a charge.
  const contributingOk = displayed.every((f) => state(f) === 'HEALTHY');
  const localOk = localApplicable.every((f) => state(f) === 'HEALTHY');
  const verified = areaComplete && shownLocal.length > 0 && contributingOk && localOk;

  const empty: EmptyReason =
    !areaComplete ? 'AREA_INCOMPLETE'
    : !scope.length ? 'NO_SOURCE'
    : !localApplicable.length ? 'NO_LOCAL_PERMIT_SOURCE'
    : localState === 'DEGRADED' ? 'SOURCE_UNHEALTHY'
    : localState === 'STALE_READ' ? 'SOURCE_STALE'
    : localState === 'UNKNOWN' ? 'HEALTH_UNKNOWN'
    : 'FOOTPRINT_NOT_VERIFIED';

  const limitations: Limitation[] = [];
  const agenciesOf = (fs: string[]) => uniq(fs.map((f) => input.agencyOf(f)));
  const anyRecords = displayed.length > 0 || input.judgedCount > 0;
  if (anyRecords) {
    // a report that shows records, or only read and excluded them, still says what it was built from (D4: non-empty and excluded-only reports too)
    if (!localApplicable.length) {
      limitations.push({ code: 'PARTIAL_COVERAGE_TRANSPORT_ONLY', text: PARTIAL_TRANSPORT_ONLY(agenciesOf(displayed.length ? displayed : scope)) });
    } else if (displayed.length && !shownLocal.length) {
      limitations.push({ code: 'PARTIAL_COVERAGE_NO_LOCAL_RECORD', text: PARTIAL_NO_LOCAL_RECORD(agenciesOf(displayed)) });
    }
    if (localApplicable.length && localState !== 'HEALTHY') limitations.push({ code: 'LOCAL_SOURCE_NOT_VERIFIED', text: LOCAL_SOURCE_NOT_VERIFIED });
  }
  return {
    rule_version: COVERAGE_RULE_VERSION,
    availability,
    classes_shown: classes(displayed),
    classes_applicable: classesApplicable,
    local_permit_read_state: localState,
    area_complete: areaComplete,
    verified_for_credit: verified,
    credit_basis: verified ? 'LOCAL_PERMIT_PLANNING_RECORD_SHOWN' : null,
    empty_reason: empty,
    limitations,
  };
}

/** The one customer-facing paragraph, built once from an assessment and the report's other limitations; every surface prints this string.
 *  `form` is what the report holds: SHOWN (records displayed), JUDGED (records read and all left out), EMPTY (nothing within the radius). */
export function disclosureParagraph(a: CoverageAssessment, o: { form: 'SHOWN' | 'JUDGED' | 'EMPTY'; agencies: string[]; extra: Limitation[] }): { headline: string | null; paragraph: string } {
  if (o.form === 'EMPTY') return { headline: NO_RECORDS_HEADLINE, paragraph: emptyReasonText(a.empty_reason, o.agencies) };
  const texts = [...a.limitations, ...o.extra].map((l) => l.text);
  return { headline: null, paragraph: [COVERAGE_BASE, ...texts].join(' ') };
}
