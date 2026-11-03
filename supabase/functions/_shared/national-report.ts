// THE NATIONAL DEVELOPMENT ACTIVITY REPORT — assembly (Development Activity plan, Order G).
//
// PURE. This file reads no environment, calls no network and holds no client: the edge function hands it
// what the database returned and it returns a report. It therefore cannot reach the database by any path
// of its own, and every rule below is testable without one.
//
// WHAT IT DECIDES, AND WHAT IT DOES NOT. It decides nothing that already has an owner:
//   which projects are near the subject ...... public.n5_projects_within_radius (canonical geometry)
//   what a project's Type is .................. lib/project-type.js, through the generated copy below
//   what its canonical lifecycle is ........... lib/project-type.js (four keys; a publisher status is
//                                                carried separately and never promoted)
//   whether a change occurred ................. public.dev_change_event_reportable (the ledger's reader)
//   whether a record may appear ............... national source policy, 2026-11-01 (docs/national-source-policy-2026-11-01.md):
//                                                any record a wired connector stamped with its source family and an official
//                                                record link. There is no per-source allowlist; a new registry source is in
//                                                reports the moment its records exist.
//   which credit line a source requires ....... _shared/source-attribution.json, generated from the registry (absence = none)
//   whether an address is in the product ...... public.canonical_zip_registry (12,722)
// What it owns is only the COMPOSITION: which of those answers go in which section, with what wording, and
// the split between what is kept forever and what is the customer's.
//
// THE SPLIT (docs/report-private-context-contract-2026-09-30.md §8). `assemble` builds TWO objects:
//   intelligence  permanent, hashed, and the body of a stored snapshot. Holds no address, no coordinate of the
//                 subject, no distance from it, no bearing.
//   privateContext  the customer's address and the point derived from it. Deletable.
//   renderOnly    distances and map directions from the subject, for the response only. Never stored.
// They are built separately and never split afterwards, so there is no step at which the address was ever
// inside the permanent object.
import './project-type.generated.js';
import './residential-qualify.generated.js';
import publishersFile from './source-publishers.generated.json' with { type: 'json' };
import { snapshotBodyOf, subjectRelativeKeys } from './report-snapshot.ts';
import type { PrivateContext } from './report-snapshot.ts';

export const PRODUCT_NAME = 'HOMESIGNAL DEVELOPMENT ACTIVITY';
/**
 * national-2 (2026-10-02, 100526 plan step 2): adds the Stage dimension (`stage`, `sections.by_stage`, `stage_rule_version`).
 * national-3 (2026-10-02, step 5, founder ruling R5): adds `activity`, the report's outcome ("No development activity" vs "No data ingested").
 * national-4 (2026-11-01): every record names its publishing agency and dataset (`source.agency`, `source.feed_ref`) and, when the official
 *   link carries it, the agency's own record number (`source.record_id`); `title_cut` marks a title the source feed shortened; `scope` separates
 *   minor building work from development; `coverage.source_agencies` lists the agencies in the report.
 * national-5 (2026-11-02, audit of the 3101 Western sample): a stage word the AGENCY did not publish (a connector's `status_const`) is no
 *   longer shown as the agency's status (`publisher_stage` null, `publisher_stage_unpublished` true); a date carries the source's own words for
 *   what it means when the registry states them (`file_date_label`); "Phase Issued" counts as an issued permit (stage-evidence-2).
 * national-6 (2026-11-02, founder): a record whose agency stage says occupancy was approved ("Approved to Occupy", "TCO Issued",
 * "Temporary C of O") is in its own stage, "Approved for occupancy — business opening not verified", never Approved / Coming (stage-evidence-3).
 * national-7 (2026-11-02, universal report corrections): every record is judged by `relevance()` before anything is built; routine work and records
 *   whose words establish no neighborhood-facing change leave the customer report (kept in `relevance_review` for traceability) and the Minor Building
 *   Work section is gone; each included record carries its `relevance` basis, the agency's own class (`publisher_type`), its fuller description when the
 *   ingest stored one (`description`) and any activity dates the source stated (`activity_window`); a stage the agency did not publish, or a temporary
 *   event, is given no stage; the stage labels no longer pair "permitted" with "under construction" on one record; `coverage.records_checked` says when
 *   Jody last read the included records and `coverage.undescribed_records` that some nearby records did not describe their work.
 */
export const REPORT_VERSION = 'development-activity-national-7';
/** Default, not a founder-set value: the plan's "last 90 days" example. Defined once, here. */
export const RECENT_DAYS = 90;
/** The radii the canonical spatial read accepts. Anything else is refused there, so it is refused here first. */
export const ALLOWED_RADII = [0.5, 1, 2, 5];
/**
 * THE report radius (100526 plan, ruling 7): every Phase 1 report, free or paid, is 0.5 mile, and no customer chooses it.
 * The canonical spatial read still accepts the other radii; the request handler is what refuses them for a report.
 */
export const REPORT_RADIUS_MI = 0.5;
/**
 * The publisher date kinds that record something that HAPPENED. `scheduled` and `estimated` are plans, not
 * events. Measured over app_projects (2026-09-29): the same column also carries sentinels (1900-01-01,
 * 1969-12-31, 2099-02-12, 9999-09-09), which a window bounded above by today and below by RECENT_DAYS
 * excludes by construction.
 */
export const EVENT_KINDS: Record<string, string> = {
  filed: 'Filed', issued: 'Issued', decided: 'Decided', awarded: 'Awarded', completed: 'Completed', hearing: 'Hearing',
};
export const LIFECYCLE_ORDER = ['approved', 'proposed', 'operating', 'unknown'] as const;

// ── the Stage dimension (100526 plan, rulings 2 and 3; "Customer-facing primary section assignment") ──────────────
//
// Stage is a PRESENTATION of the evidence, never a fifth lifecycle key. A current project sits in exactly one of three
// stages, strongest supported first:
//   permitted  Permitted / Under Construction — the publisher's OWN stage says a permit was issued or construction is
//              under way, and the canonical lifecycle is approved or unknown;
//   approved   Approved / Coming — lifecycle approved, without that evidence;
//   proposed   Proposed / Under Review — lifecycle proposed.
// Operating records and unknown records without the evidence have no stage (ruling 3: no "What Exists Today").
// Never inferred from a type, a date or an approval: only the words below, after normaliseStage(), count.

/** Bump whenever STAGE_EVIDENCE changes: the report carries it, so a stored report says which list judged it. */
export const STAGE_RULE_VERSION = 'stage-evidence-3';
/**
 * The publisher stage values that SAY a permit was issued or construction is under way. A closed list, taken from the
 * stage values in a 3% sample of production `app_projects` development rows on 2026-10-02
 * (docs/development-activity-build-steps-100526.md, step 2). A value not named here stays in Approved / Coming.
 * Deliberately NOT named, with the reason:
 *   'construction work program', 'in the 2026 county construction program', 'design and construct' ... a plan, not work;
 *   'construction (pending)', 'to be issued', 'approved for permitting', 'phased permitting' ............. not yet issued;
 *   'co issued', 'c of o issued', 'certificate of occupancy issued', 'tco issued', 'construction completed' ... finished;
 *   'decision issued' ...................................................................................... a decision, not a permit;
 *   'new building', 'phased construction', 'new non-building structure' ............................... a permit CLASS (Denver);
 *   'permit printed', 'underway' ........................................................................... not clear enough.
 */
export const STAGE_EVIDENCE: Readonly<Record<string, 'permit_issued' | 'under_construction'>> = Object.freeze({
  'issued': 'permit_issued',
  'permit issued': 'permit_issued',
  'permits issued': 'permit_issued',
  'permit(s) issued': 'permit_issued',
  'active - issued': 'permit_issued',
  'issued full': 'permit_issued',
  'issued (nca)': 'permit_issued',
  // A phased permit's phase (Seattle SDCI "Phase Issued": the permit for one phase, e.g. shoring and excavation, is issued). Added 2026-11-02.
  'phase issued': 'permit_issued',
  'issued - amendment pending': 'permit_issued',
  'reissued': 'permit_issued',
  're-issued': 'permit_issued',
  'under construction': 'under_construction',
  'construction': 'under_construction',
  'construction started': 'under_construction',
  'construction underway': 'under_construction',
  'in construction': 'under_construction',
  'construction (missing dates)': 'under_construction',
  'permit issued / construction started': 'under_construction',
});
export const STAGE_EVIDENCE_LABELS = { permit_issued: 'Permit issued', under_construction: 'Under construction' } as const;
/**
 * stage-evidence-3 (founder, 2026-11-02): the publisher stage values that say the AGENCY AUTHORIZED OCCUPANCY of the work while HomeSignal's
 * lifecycle bucket for the source still reads Approved. Such a record is not "coming": construction reached occupancy approval. It is also not
 * shown as operating, because an occupancy approval does not show that a business opened. A closed list, measured on production app_projects
 * (all development rows, 2026-11-02): the ONLY occupancy words filed under Approved were Seattle SDCI "Approved to Occupy" (3), Arlington TX
 * "TCO Issued" (56, a temporary certificate of occupancy) and Mesa AZ "Temporary C of O" (7). Every other occupancy word ("Certificate of
 * Occupancy Issued", "CO Final", "Finaled with CO" ...) is already filed under Operating by its source's own status map.
 */
export const OCCUPANCY_EVIDENCE: ReadonlySet<string> = Object.freeze(new Set(['approved to occupy', 'tco issued', 'temporary c of o']));
export const OCCUPANCY_EVIDENCE_LABEL = 'Occupancy approved';
export const STAGE_ORDER = ['approved', 'proposed', 'permitted', 'occupancy'] as const;
export type Stage = typeof STAGE_ORDER[number];
/** national-6: "Approved / Coming" predicted that approved work will happen, and "Permitted / Under Construction" put an issued permit and started work in
 *  one label. A record in the permitted stage now carries the label its own evidence supports (`stageLabel`). */
export const STAGE_LABELS: Record<Stage, string> = {
  approved: 'Approved', proposed: 'Proposed / Under review', permitted: 'Permit issued or under construction',
  occupancy: 'Approved for occupancy — business opening not verified',
};
/** True when the publisher's own stage says occupancy was approved (OCCUPANCY_EVIDENCE). */
export function occupancyEvidence(publisherStage: unknown): boolean {
  return OCCUPANCY_EVIDENCE.has(normaliseStage(publisherStage));
}
/** national-7: a TEMPORARY occupancy authorization ("TCO Issued", "Temporary C of O") keeps the word temporary; the agency's own word stays on the card. */
export function temporaryOccupancy(publisherStage: unknown): boolean {
  const k = normaliseStage(publisherStage);
  return OCCUPANCY_EVIDENCE.has(k) && (/\btco\b/.test(k) || /\btemporary\b/.test(k));
}
/** The label ONE record's stage carries: in the permitted stage, what the agency's word actually says (an issued permit is not started work); in the
 *  occupancy stage, whether the authorization is temporary. Neither says a business is open. */
export function stageLabel(stage: Stage, evidence: { kind: 'permit_issued' | 'under_construction' } | null, publisherStage?: unknown): string {
  if (stage === 'permitted' && evidence) return evidence.kind === 'under_construction' ? 'Under construction' : 'Permit issued';
  if (stage === 'occupancy' && temporaryOccupancy(publisherStage)) return 'Temporary occupancy approved — business opening not verified';
  return STAGE_LABELS[stage];}

/** Lower case, trimmed, a leading phase number removed ("05_Construction", "5. ISSUED", "2 - Design"), spaces collapsed. */
export function normaliseStage(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.toLowerCase().trim().replace(/^\d+\s*[._)-]\s*/, '').replace(/\s+/g, ' ').trim();
}

/** What the publisher's own stage says, when it says a permit was issued or construction is under way; otherwise null. */
export function stageEvidence(publisherStage: unknown): { kind: 'permit_issued' | 'under_construction'; label: string } | null {
  const k = normaliseStage(publisherStage);
  if (!k || !Object.prototype.hasOwnProperty.call(STAGE_EVIDENCE, k)) return null;
  const kind = STAGE_EVIDENCE[k];
  return { kind, label: STAGE_EVIDENCE_LABELS[kind] };
}

/** THE one assignment of a current project to a Stage. Null means it is in no stage section. */
export function presentationStage(lifecycleKey: string, publisherStage: unknown): Stage | null {
  if (occupancyEvidence(publisherStage) && (lifecycleKey === 'approved' || lifecycleKey === 'unknown')) return 'occupancy';
  const ev = stageEvidence(publisherStage);
  if (ev && (lifecycleKey === 'approved' || lifecycleKey === 'unknown')) return 'permitted';
  if (lifecycleKey === 'approved') return 'approved';
  if (lifecycleKey === 'proposed') return 'proposed';
  return null;
}

/**
 * How many projects "Things to Review With Your Client" lists (100526 plan, "Things to Review"). A presentation default, not a
 * founder-set value. The list is the nearest current projects (those in a stage section), so it is measured from the subject and
 * lives in the response-only block: a stored report carries no distance and therefore no such list.
 */
export const REVIEW_LIMIT = 3;
const STAGE_STRENGTH: Record<Stage, number> = { permitted: 0, approved: 1, proposed: 2, occupancy: 3 };

/** Initial compass bearing, in whole degrees, from one point to another. For the response only, never stored. */
export function bearingDeg(fromLat: number, fromLng: number, toLat: number, toLng: number): number | null {
  if (![fromLat, fromLng, toLat, toLng].every((v) => typeof v === 'number' && Number.isFinite(v))) return null;
  const r = Math.PI / 180;
  const y = Math.sin((toLng - fromLng) * r) * Math.cos(toLat * r);
  const x = Math.cos(fromLat * r) * Math.sin(toLat * r) - Math.sin(fromLat * r) * Math.cos(toLat * r) * Math.cos((toLng - fromLng) * r);
  if (x === 0 && y === 0) return null;
  return Math.round(((Math.atan2(y, x) / r) + 360) % 360) % 360;
}

export type Lifecycle = 'proposed' | 'approved' | 'operating' | 'unknown';
export type CoverageState = 'OUTSIDE_COVERAGE' | 'LIMITED_COVERAGE' | 'REPORT_READY' | 'CHANGE_READY';
export type View = 'customer' | 'internal';

/** The credit lines publishers require, by source family. Generated from the registry; a family that is absent has none. */
export type SourceAttribution = { version: number; attribution: Record<string, string> };
/** Names the eligibility rule that produced a report (provenance), so a stored report says which policy built it. */
export const SOURCE_POLICY = 'national-2026-11-01';
/** The one limitation a provenance exclusion produces (shared with the changes-since view). */
export const RECORDS_NOT_TRACEABLE = {
  code: 'RECORDS_NOT_TRACEABLE',
  text: 'Some records near this address are not included because their official source is not identified.',
};

/** One row of public.n5_projects_within_radius. A project may own several geometry instances. */
export type RadiusRow = {
  source_key: string; feature_id: string; registry_id: string | null; provenance: string;
  distance_mi: number; geometry_type: string; has_more: boolean;
  /** the RPC's display point for this geometry instance; used only for the map's direction, never stored */
  marker_lat?: number | null; marker_lng?: number | null;
};
/** The columns of public.app_projects the report reads. */
export type ProjectRow = {
  source_key: string; registry_id: string | null; record_kind: string; name: string | null; type: string | null;
  type_raw: string | null; status: string | null; stage: string | null; developer: string | null; size: string | null;
  investment: string | null; submitted_at: string | null; date_kind: string | null; address: string | null;
  source_ref: string | null;
  /** app_projects.provenance as the ingest wrote it; the report reads only `case_number` from it (the agency's own record number). */
  provenance?: Record<string, unknown> | null;
  /** national-6: the fuller description some connectors store, and the activity dates the source stated. Absent from older reads. */
  scope_text?: string | null; start_date?: string | null; end_date?: string | null;
};
export type LedgerProject = {
  identity_key: string; registry_id: string | null; comparable: boolean; change_ready: boolean;
  observation_count: number; first_observed_at: string; last_observed_at: string;
};
export type ReportableEvent = {
  identity_key: string; event_type: string; material: boolean; observed_at: string;
  prev_facts: Record<string, unknown> | null; new_facts: Record<string, unknown> | null;
  changed_fields: string[] | null; publisher_event_type: string | null; publisher_event_date: string | null;
};
/** A reportable event together with the instant the ledger WROTE it (`created_at`): what Changes Since Report reads. */
export type WrittenEvent = ReportableEvent & { created_at: string };
export type SourceHealth = {
  registry_id: string; fetch_failures_24h: number; blocked_24h: number; truncated_24h: number;
};
// ── the report's outcome (founder ruling R5, 2026-10-02: docs/development-activity-founder-ruling-r5-2026-10-02.md) ────────────
//
// A report says one of three things, and the two empty ones are never confused:
//   DEVELOPMENT_SHOWN        the report shows at least one development record;
//   NO_DEVELOPMENT_ACTIVITY  HomeSignal can PROVE its official development data for this address is coming in, and it shows no
//                            development within the report radius. A real answer: it uses one free report;
//   NO_SIGNIFICANT_CHANGES   (activity-outcome-2, founder 2026-11-02) the report lists nothing, but Jody READ official records within the
//                            radius and judged every one of them: routine work, a record that does not say what its work is, or a
//                            temporary activity that has ended. Data is coming in, so "No data ingested" would be false; it is still
//                            not a measured zero of development, so it never uses a free report (credit-rule.ts, unchanged charging);
//   NO_DATA_INGESTED         the report is empty and HomeSignal cannot prove its data is coming in (a source not read, no
//                            source covering the area, or no way to tell which). HomeSignal's gap,
//                            not an answer about the area: it never uses a free report.
// A query that returns no rows is not proof (plan line 1338). The proof is the Maps workbook's VERIFIED ZERO, whose inputs for the
// development family are not defined yet (freshness SLA_UNDEFINED), so today an empty report is ALWAYS "No data ingested".
// NO_DEVELOPMENT_ACTIVITY becomes reachable only through a reviewed change to activityOutcome() with its own tests, never a setting.

/** Bump whenever activityOutcome() or the labels change: the report carries it, so a stored report says which rule judged it. */
export const ACTIVITY_RULE_VERSION = 'activity-outcome-2';
export const ACTIVITY_OUTCOMES = ['DEVELOPMENT_SHOWN', 'NO_DEVELOPMENT_ACTIVITY', 'NO_SIGNIFICANT_CHANGES', 'NO_DATA_INGESTED'] as const;
export type ActivityOutcome = typeof ACTIVITY_OUTCOMES[number];
/** The founder's words, exactly ("lets be more clear and write \"no devlopment activity\" vs \"no data ingested\""). */
export const ACTIVITY_LABELS: Readonly<Record<ActivityOutcome, string>> = Object.freeze({
  DEVELOPMENT_SHOWN: 'Development shown',
  NO_DEVELOPMENT_ACTIVITY: 'No development activity',
  NO_SIGNIFICANT_CHANGES: 'No significant nearby changes found',
  NO_DATA_INGESTED: 'No data ingested',
});

/** THE one decision of what a report's outcome is. `recordsJudged` is how many official records in this radius the relevance rule read and
 *  left out (the report's relevance_review). Today there is no proof of ingestion beyond that, so an empty report with nothing judged is
 *  "No data ingested". */
export function activityOutcome(projectsInReport: number, recordsJudged: number = 0): ActivityOutcome {
  if (Number.isInteger(projectsInReport) && projectsInReport > 0) return 'DEVELOPMENT_SHOWN';
  return Number.isInteger(recordsJudged) && recordsJudged > 0 ? 'NO_SIGNIFICANT_CHANGES' : 'NO_DATA_INGESTED';
}

export type Subject = {
  /** exactly what the customer typed */
  address: string;
  /** the geocoder's normalised form of it */
  matched_address: string | null;
  lat: number; lng: number; zip: string;
  label?: string;
};
export type AssembleInput = {
  now: Date; subject: Subject; radius_mi: number; view: View; zip_supported: boolean;
  attribution: SourceAttribution; rows: RadiusRow[]; projects: ProjectRow[]; ledger: LedgerProject[];
  events: ReportableEvent[]; health: SourceHealth[];
};
export type Assembled = {
  coverage_state: CoverageState;
  /** null only when the ZIP is outside the product: there is nothing to store and nothing to charge for */
  intelligence: Record<string, unknown> | null;
  privateContext: PrivateContext | null;
  engineInputs: Record<string, unknown> | null;
  /** for the response only: never stored, never hashed */
  renderOnly: { distances_mi: Record<string, number>; bearings_deg: Record<string, number>; review: string[]; internal?: Record<string, unknown> };
  /** every reason this report may not be stored as a customer snapshot; empty means it may */
  storage_blockers: string[];
};

// ── small pure helpers ───────────────────────────────────────────────────────────────────────────────────

const HS = (): any => (globalThis as any).HS;

/** The same comparison the database's containment trigger makes: case, whitespace runs, commas and periods ignored. */
export function norm(t: unknown): string {
  return String(t ?? '').toLowerCase().replace(/[\s,.]+/g, ' ').trim();
}

export function parseRadius(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return ALLOWED_RADII.includes(n) ? n : null;
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
function validDay(s: unknown): s is string {
  if (typeof s !== 'string' || !ISO_DAY.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
export function dayOf(d: Date): string { return d.toISOString().slice(0, 10); }
export function addDays(day: string, n: number): string {
  const d = new Date(day + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * The attribution file, validated strictly. A malformed file throws and the caller fails the request: a credit line a
 * publisher requires is never silently dropped. It decides nothing about inclusion.
 */
export function validateAttribution(f: unknown): SourceAttribution {
  const r = f as any;
  if (!r || typeof r !== 'object' || !Number.isInteger(r.version) || !r.attribution || typeof r.attribution !== 'object' || Array.isArray(r.attribution)) {
    throw new Error('source attribution: expected { version, attribution: { <registry_id>: <credit line> } }');
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(r.attribution)) {
    if (!k.trim() || /[*?%]/.test(k)) throw new Error('source attribution: a key is blank or a pattern (' + k + ')');
    if (typeof v !== 'string' || !v.trim()) throw new Error('source attribution: ' + k + ' has no credit line');
    out[k] = v;
  }
  return { version: r.version, attribution: out };
}

/** The most recent publisher event that HAPPENED inside the window, or null. Never a plan, never a sentinel. */
export function recentPublisherEvent(p: Pick<ProjectRow, 'date_kind' | 'submitted_at'>, today: string) {
  const kind = p.date_kind ?? '';
  if (!Object.prototype.hasOwnProperty.call(EVENT_KINDS, kind)) return null;
  if (!validDay(p.submitted_at)) return null;
  const date = p.submitted_at;
  if (date > today || date < addDays(today, -RECENT_DAYS)) return null;
  return { kind, label: EVENT_KINDS[kind], date };
}

/** An official date older than this many days is flagged as old on the report (audit 2026-10-07, finding 2). Plain days, not a rule about the project. */
export const OLD_RECORD_DAYS = 365;
/** The stored date column also carries sentinels (1900-01-01, 1969-12-31: see EVENT_KINDS). Nothing before this is shown as a real filing date. */
export const RECORD_DATE_FLOOR = '1990-01-01';
/**
 * The date the publisher gave the record, of any age, with what it was (filed, issued, decided ...). `publisher_event` only carries one inside the last
 * RECENT_DAYS, so an Approved or Proposed record from years ago showed no date at all and read like last month's. This is the date and its meaning, and whether
 * it is more than a year old; it is never a status and never a change. Null when the kind is a plan, the date is not a real past day, or it is a sentinel.
 */
export function recordDate(p: Pick<ProjectRow, 'date_kind' | 'submitted_at'>, today: string) {
  const kind = p.date_kind ?? '';
  if (!Object.prototype.hasOwnProperty.call(EVENT_KINDS, kind)) return null;
  if (!validDay(p.submitted_at)) return null;
  const date = p.submitted_at;
  if (date > today || date < RECORD_DATE_FLOOR) return null;
  return { kind, label: EVENT_KINDS[kind], date, older_than_a_year: date < addDays(today, -OLD_RECORD_DAYS) };
}

/**
 * FRESHNESS (audit 2026-10-11): when the report asks the reader to verify that a record is still active.
 *
 * The age of an original FILING is not, by itself, evidence that an active development is stale: a project the agency lists as under construction
 * can have been filed years ago. So the warning is judged on the LATEST OFFICIAL DATE the report holds for the record, not on the date the record
 * was filed, and on what that date IS:
 *   latest official date = the newest of the record's own date and any later date the SOURCE stated for a ledger-proven change (`later`);
 *   it is never a retrieval time, a refresh time or an observation time (HomeSignal reading a record again proves nothing about the project).
 *   - latest official date within OLD_RECORD_DAYS ............................... no warning;
 *   - older, in a Permitted / Under Construction record whose ONLY date is its filing and no later official date is recorded ... `filing_only`
 *     (the line says so: the filing is old and nothing later is on record; it does not say the project is old);
 *   - older, in every other case (an old issue / decision / award date, any Proposed or Approved record, an unstaged record) ... `old_date`,
 *     the same warning as before.
 * Nothing is removed from a permitted record: an old permit with no later official date still warns. A record with no usable date has no
 * `record_date` at all, so no date is invented and no warning is made (unchanged).
 * Pure: reads no clock (`today` is passed), no stage vocabulary of its own (the stage key comes from presentationStage), and no place or source.
 */
export const FRESHNESS_RULE = 'freshness-1';
export type Verification = { rule: string; reason: 'old_date' | 'filing_only'; latest_official_date: string } | null;
export function verification(
  rd: { kind: string; date: string } | null, stage: Stage | null, later: Array<string | null | undefined>, today: string,
): Verification {
  if (!rd) return null;
  const real = later.filter((d): d is string => validDay(d) && d <= today && d >= RECORD_DATE_FLOOR);
  const latest = [rd.date, ...real].reduce((a, b) => (a >= b ? a : b));
  if (latest >= addDays(today, -OLD_RECORD_DAYS)) return null;
  const filingOnly = stage === 'permitted' && rd.kind === 'filed' && real.length === 0;
  return { rule: FRESHNESS_RULE, reason: filingOnly ? 'filing_only' : 'old_date', latest_official_date: latest };
}

// ── the boundary ─────────────────────────────────────────────────────────────────────────────────────────

/** Whether `needle` occurs in `text` with no letter or digit directly before or after it. */
export function containsBounded(text: string, needle: string): boolean {
  if (!needle) return false;
  const alnum = /[a-z0-9]/i;
  let at = text.indexOf(needle);
  while (at !== -1) {
    const before = at === 0 ? '' : text[at - 1], after = text[at + needle.length] ?? '';
    if (!(before && alnum.test(before)) && !(after && alnum.test(after))) return true;
    at = text.indexOf(needle, at + 1);
  }
  return false;
}

/**
 * The fragments of a private value that would still locate the subject, each with a NAME. The name is what a finding
 * reports; the text is never repeated in a finding, a response or a log line.
 */
export function addressFragments(address: string): Array<{ kind: 'street_line' | 'house_number_and_street'; text: string }> {
  const out: Array<{ kind: 'street_line' | 'house_number_and_street'; text: string }> = [];
  const street = norm(String(address).split(',')[0]);
  if (street.length >= 5) out.push({ kind: 'street_line', text: street });
  const words = street.split(' ');
  if (words.length >= 2 && /^\d/.test(words[0])) {
    const t = words[0] + ' ' + words[1];
    if (t.length >= 5 && t !== street) out.push({ kind: 'house_number_and_street', text: t });
  }
  return out;
}

/**
 * Everything in `intelligence` that would put the customer's private values into a permanent record. The database has
 * a backstop for whole values; it cannot see a fragment (contract §9, pinned by check X07b of the snapshot suite) or a derived
 * number, so THIS is the check that looks for them (contract §8.4). An empty list means the body is clean.
 */
export function boundaryFindings(intelligence: Record<string, unknown>, ctx: PrivateContext | null): string[] {
  const findings: string[] = [];
  const body = snapshotBodyOf(intelligence);
  for (const k of subjectRelativeKeys(JSON.parse(body))) findings.push('SUBJECT_RELATIVE_KEY:' + k);
  if (!ctx) return findings;
  // Bounded by what is NOT a letter or a digit, never by a space: in JSON a value is delimited by quotes, not spaces, so a private value that fills a whole
  // string ("address": "742 Evergreen ...") has no space on either side (test 7b). But "742 evergreen" is not in "1742 evergreen": a match that sits inside a
  // longer house number or street name is a different address, and treating it as a leak withheld a report that held nothing private (audit 2026-10-07).
  const text = norm(body);
  const has = (needle: string) => needle.length >= 3 && containsBounded(text, needle);
  const hasSub = (needle: string) => needle.length >= 5 && containsBounded(text, needle);
  if (ctx.address && has(norm(ctx.address))) findings.push('ADDRESS_IN_BODY');
  if (ctx.normalized_address && has(norm(ctx.normalized_address))) findings.push('NORMALIZED_ADDRESS_IN_BODY');
  if (ctx.label && has(norm(ctx.label))) findings.push('LABEL_IN_BODY');
  for (const pk of ctx.property_keys ?? []) if (has(norm(pk))) findings.push('PROPERTY_KEY_IN_BODY');
  for (const src of [ctx.address, ctx.normalized_address]) {
    if (!src) continue;
    for (const f of addressFragments(src)) if (hasSub(f.text)) findings.push('ADDRESS_FRAGMENT_IN_BODY:' + f.kind);
  }
  for (const c of [ctx.latitude, ctx.longitude]) {
    if (typeof c !== 'number' || !Number.isFinite(c)) continue;
    const decimals = (String(c).split('.')[1] ?? '').length;
    if (decimals >= 5 && body.includes(String(c))) findings.push('COORDINATE_IN_BODY');
  }
  return [...new Set(findings)];
}

// ── what counts as a detected change: ONE rule, two readers ──────────────────────────────────────────────────

/** Whether the ledger says a project's change history may be called changes: comparable, and observed at least twice. The ONE place this is asked. */
export function isChangeReady(led: LedgerProject | undefined): boolean {
  return !!led && led.change_ready === true;
}

/**
 * THE rule for which ledger events a report may call a HomeSignal-detected change. The report (`assemble`, below) and
 * Changes Since Report (`changes-since-report.ts`) both ask THIS function and neither restates it, so the two cannot
 * disagree about what a change is. It decides nothing about WHICH events exist (public.dev_change_event_reportable owns
 * that) and nothing about the time window (each caller passes its own `keep`).
 *   * a project counts only when the ledger marks it change-ready (comparable, and observed at least twice);
 *   * an event counts only when it is material (not a non-material refresh of a field such as `submitted_at`);
 *   * newest first.
 */
export function selectDetectedChanges(
  led: LedgerProject | undefined, events: ReportableEvent[], keep: (e: ReportableEvent) => boolean,
): ReportableEvent[] {
  if (!isChangeReady(led)) return [];
  return materialEvents(events, keep);
}

/** The material events that pass `keep`, newest first. A caller that must count what a not-yet-change-ready project WOULD show asks this. */
export function materialEvents<T extends ReportableEvent>(events: T[], keep: (e: T) => boolean): T[] {
  return events
    .filter((e) => e.material === true && keep(e))
    .sort((a, b) => (a.observed_at < b.observed_at ? 1 : -1));
}

/**
 * Whether any source family in `families` could not be fully read in the last day. ONE definition, used by the report and by
 * Changes Since Report: "no change was detected" is a weaker statement when the source was blocked, failed or came back cut short,
 * and both answers must say so by the same rule. Health of a family that is not in the answer is not the answer's business.
 */
export function sourcesNotFullyRead(health: SourceHealth[], families: Set<string>): boolean {
  return health
    .filter((h) => families.has(h.registry_id))
    .some((h) => h.fetch_failures_24h > 0 || h.blocked_24h > 0 || h.truncated_24h > 0);
}
export const SOURCE_NOT_FULLY_READ = { code: 'SOURCE_NOT_FULLY_READ', text: 'One or more official sources for this area could not be fully read recently.' };

/** The one shape a detected change takes in any customer-facing answer: the event, and what changed from what to what. */
export function detectedChangeEntries(events: ReportableEvent[]) {
  return events.map((e) => ({
    event_type: e.event_type,
    detected_at: e.observed_at,
    publisher_event: e.publisher_event_type ? { kind: e.publisher_event_type, date: e.publisher_event_date } : null,
    changes: (e.changed_fields ?? []).map((f) => ({ field: f, from: (e.prev_facts ?? {})[f] ?? null, to: (e.new_facts ?? {})[f] ?? null })),
  }));
}

// ── the assembly ─────────────────────────────────────────────────────────────────────────────────────────

// ── WHOSE RECORD IT IS, WHICH RECORD, AND HOW BIG A PIECE OF WORK (national-4, 2026-11-01) ──────────────────────────────────────
//
// THE PUBLISHER. source-publishers.generated.json is derived mechanically from the development source registry (the one place a
// source's agency is written down) by scripts/gen-source-publishers.mjs. A record whose source is not in the registry names no agency.
type Publisher = { agency: string | null; dataset: string | null; status_const?: string | null; date_label?: string | null };
const PUBLISHERS: Record<string, Publisher> = ((publishersFile as unknown as { publishers?: Record<string, Publisher> }).publishers) ?? {};
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
export function publisherOf(family: string | null): Publisher {
  const p = family ? PUBLISHERS[family] : undefined;
  return { agency: str(p?.agency), dataset: str(p?.dataset), status_const: str(p?.status_const), date_label: str(p?.date_label) };
}
/**
 * Whether the record's stored stage is a word the AGENCY published. A source with no status column stores its connector's constant
 * (the registry's `status_const`) as the stage; that word is HomeSignal's, so it is never shown as the agency's status (audit 2026-11-02:
 * the Washington SEPA Register publishes no status, and the report printed "Source agency status: proposed").
 */
export function agencyStage(stage: string | null, pub: Publisher): string | null {
  if (typeof stage !== 'string' || !stage.trim()) return null;
  return pub.status_const && stage.trim() === pub.status_const ? null : stage;
}
/** A date's label: the source's own words for what its one date means when the registry states them (`file_date_label`), else the kind's label. */
function withDateLabel<T extends { label: string } | null>(d: T, pub: Publisher): T {
  return d && pub.date_label ? { ...d, label: pub.date_label } : d;
}
/**
 * The agency's own record number, from the provenance the ingest stored (`case_number`), ONLY when the record's official link carries that
 * same number. The link is the agency's record, so a number found in it is the agency's identifier for that record, not ours. A number the
 * link does not carry is not shown: it could not be checked against the official record by the reader.
 */
export function recordIdOf(p: { provenance?: Record<string, unknown> | null; source_ref: string | null }): string | null {
  const raw = p.provenance && typeof p.provenance === 'object' ? (p.provenance as Record<string, unknown>).case_number : null;
  const id = typeof raw === 'string' || typeof raw === 'number' ? String(raw).trim() : '';
  if (!id || id.length > 60 || !p.source_ref) return null;
  let url = p.source_ref;
  try { url = decodeURIComponent(p.source_ref); } catch { /* keep the raw link */ }
  return url.includes(id) || p.source_ref.includes(id) ? id : null;
}
/**
 * Every development connector stores a record's title cut to this many characters (get-address-report/sources/*.ts, `.slice(0, 120)`;
 * test/national-report-structure.test.mjs pins the two together). A title of this length may have been cut mid-word by the feed, and the
 * report says so instead of printing the fragment as if it were the whole description.
 */
export const SOURCE_TITLE_CAP = 120;
export function titleCut(name: string | null): boolean { return typeof name === 'string' && name.length >= SOURCE_TITLE_CAP; }

/**
 * RELEVANCE (national-6, 2026-11-02, "Universal Development Activity Report corrections"). Jody reports documented nearby changes that matter to
 * everyday living; it is not a permit inventory. Every record is judged ONCE, here, BEFORE any section, count, map, history, alert or export is built,
 * so an excluded record cannot reach a customer by any indirect path (property-watch reads `assemble(...).intelligence.projects`, and Changes Since Report
 * reads the stored report's project list, so both see only included records).
 *
 *   include, with a BASIS ......... the record's own words (its description, the agency's class field, and the fuller scope text when the ingest stored
 *                                   one) document a neighborhood-facing change: new construction, demolition, site work, a change of use, an addition,
 *                                   substantial or building-wide exterior work, a land-use action, a change to street access or to a public facility, a
 *                                   nightlife use, a temporary event; or the canonical Type itself is the documented use (a road or utility project, a data
 *                                   center, a heavy facility).
 *   exclude, `routine_work` ....... the words say the work is interior, on one unit, a like-for-like repair or small fixture, or a tenant improvement that
 *                                   states no change of use, and nothing above is documented.
 *   exclude, `not_established` .... the words establish neither. The record is left out of the customer report and listed for internal review
 *                                   (`relevance_review`), never guessed into either side.
 * Excluded records are RETAINED in the permanent report body (`relevance_review`: identity, family, reason, the words that decided it) for traceability;
 * no customer surface reads that key (pinned by the view's structure test). A later record whose words document a substantive change is judged again on
 * every assembly (a Watch re-assembles), so a scope change re-includes it.
 * The rule never includes on a word alone that can mean routine work ("remodel", "repair", "alteration", "tenant improvement"), never on a permit value, and
 * never on the commercial Type. One normalisation (normalizeWords): lower case, non-alphanumerics to spaces, padded, so ' deck ' cannot match 'decker'.
 */
// relevance-2 (2026-11-02): "change in use" (Sioux Falls WORKCLASS) is the same fact as "change of use".
// relevance-3 (2026-11-03): a change of use that also builds a new building is new construction (Seattle 7118487-CN, 83 units). A temporary structure, market, booth, kiosk, canopy, exhibit, platform, seating or inflated structure is temporary
//   activity, judged on its documented dates, never new construction ("Erect (6) temporary structures for 2026 Christmas Market", Seattle).
export const RELEVANCE_RULE_VERSION = 'relevance-3';
export function normalizeWords(s: string): string {
  return ' ' + String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() + ' ';
}
export type RelevanceBasis =
  | 'residential_development' | 'development_record' | 'infrastructure' | 'facility_use' | 'temporary_event' | 'change_of_use' | 'demolition' | 'site_work' | 'new_construction'
  | 'land_use' | 'addition' | 'substantial_alteration' | 'exterior_building_wide' | 'public_access' | 'public_facility' | 'nightlife_use';
/** A record's documented scale: the numbers its own words state for what it proposes. Never estimated, never read from an existing building. */
export type DocumentedScale = { units?: number; stories?: number; sqft?: number };
export type Relevance =
  | { include: true; basis: RelevanceBasis; evidence: string; use?: string; proposes?: 'new_construction' | 'demolition' | 'site_work'; scale?: DocumentedScale; rule_version: string }
  | { include: false; reason: 'routine_work' | 'not_established'; evidence: string | null; rule_version: string };

const any = (w: string, list: string[]) => list.find((x) => w.includes(x)) ?? null;
/** Phrases that mean the demolition or work is INSIDE a building; removed before the significance phrases are looked for. */
const INTERIOR_DEMOLITION = [' interior demolition ', ' interior demo ', ' selective demolition ', ' non structural demolition ', ' demolition of interior '];
const TEMPORARY = [' temporary '];
const TEMPORARY_EVENT = [' event ', ' events ', ' stage ', ' festival ', ' concert ', ' fair ', ' tent ', ' tents ', ' bleachers ', ' outdoor '];
/** "temporary" followed closely by what is put up for a while: the thing named is the temporary object, so "erect" or "new construction" around it
 *  is not a new building. Adjacent only, so "temporary shoring", "temporary power" or "temporary hoist" for a real building is not read as an event. */
const TEMPORARY_INSTALLATION_RE = / temporary( [a-z0-9]+){0,3}? (structure|structures|market|markets|booth|booths|kiosk|kiosks|canopy|canopies|exhibit|exhibits|exhibition|platform|platforms|display|displays|seating|grandstand|grandstands|inflated) /;
const CHANGE_OF_USE = [' change of use ', ' change in use ', ' change use ', ' establish use ', ' change of occupancy ', ' convert ', ' conversion ', ' converting '];
const DEMOLITION = [' demolish ', ' demolition ', ' demo of ', ' raze '];
const SITE_WORK = [' shoring ', ' excavation ', ' excavate ', ' grading ', ' clearing and grading ', ' mass grading ', ' earthwork '];
const NEW_CONSTRUCTION = [' new construction ', ' new single family ', ' new multifamily ', ' erect ', ' high rise ', ' mid rise ',
  ' story ', ' stories ', ' dwelling units ', ' townhouses ', ' townhomes ', ' construct a residential ', ' construct a commercial ', ' construct a mixed use '];
/** "new" counts only before a building noun ("new 4-unit townhouse building"), so "new curb cut" or "new tenant" is not new construction. */
const NEW_BUILDING_RE = / new( [a-z0-9]+){0,3}? (building|buildings|structure|structures|residence|residences|dwelling|dwellings|duplex|triplex|fourplex|house|houses|home|homes|warehouse|hotel|school|tower) /;
/** "existing 3-story apartment building" describes what is there, not what is proposed: collapsed before the size and building words are read. */
const EXISTING_RE = / existing( [a-z0-9]+){0,8}? (building|buildings|structure|residence|house|home|facility|condominium) /g;
const LAND_USE = [' land use ', ' master use permit ', ' shoreline ', ' subdivision ', ' short plat ', ' preliminary plat ', ' final plat ', ' rezone ',
  ' rezoning ', ' zoning change ', ' zone change ', ' variance ', ' conditional use ', ' special use ', ' site plan ', ' site development ',
  ' planned unit development ', ' design review ', ' annexation ', ' comprehensive plan ', ' sepa '];
const ADDITION = [' addition ', ' additions '];
const SUBSTANTIAL = [' substantial alteration ', ' substantial alterations ', ' phased permit ', ' mixed use development ', ' major renovation ', ' gut renovation '];
const EXTERIOR = [' exterior ', ' facade ', ' balconies ', ' balcony ', ' decks ', ' envelope ', ' cladding ', ' siding ', ' windows '];
const BUILDING_WIDE = [' building wide ', ' entire building ', ' whole building ', ' all balconies ', ' all units ', ' all floors ', ' throughout the building '];
const BUILDING_WIDE_RE = /( floors? \d+ (to |through |thru )?\d+ | \d{2,} (balconies|decks|windows|units) )/;
/** Public-works wording, for a road or utility project the canonical Type did not file as Roads & infrastructure ("HMA Inlay", "Hwys. 96 & 255 Flood
 *  Repairs"). Not applied to a Residential record: a driveway "paving" or "overlay" on one house is routine. */
const PUBLIC_WORKS = [' inlay ', ' overlay ', ' resurfacing ', ' repaving ', ' paving ', ' pavement ', ' bridge ', ' culvert ', ' highway ', ' hwy ', ' hwys ',
  ' roadway ', ' water main ', ' sewer main ', ' storm drain ', ' traffic signal ', ' state route '];
const ROUTE_RE = / (sr|us|hwy|hwys|i|state route) \d{1,3} /;
const PUBLIC_ACCESS = [' curb cut ', ' street use ', ' use of street ', ' street improvement ', ' street improvements ', ' street vacation ', ' right of way ', ' sidewalk '];
const RENOVATION = [' renovate ', ' renovation ', ' renovations ', ' expansion ', ' expand '];
const NIGHTLIFE = [' nightclub ', ' night club ', ' bar ', ' tavern ', ' brewery ', ' brewpub ', ' distillery ', ' taproom ', ' lounge ', ' event venue ', ' music venue '];
const TENANT_IMPROVEMENT = [' tenant improvement ', ' tenant improvements ', ' ti '];
/** The routine-work phrases. Each needs nothing above it to have matched. A bare "repair", "remodel" or "alteration" is NOT here: alone it establishes nothing. */
const ROUTINE = [' stfi ', ' subject to field inspection ', ' interior alteration ', ' interior alterations ', ' interior remodel ', ' interior remodeling ',
  ' interior repairs ', ' finishes ', ' bathroom remodel ', ' bath remodel ', ' kitchen remodel ', ' in kind ', ' like for like ', ' repairs to unit ',
  ' to unit ', ' condo unit ', ' in unit ', ' damage repair ', ' reroof ', ' re roof ', ' roof replacement ', ' window replacement ', ' replace windows ',
  ' water heater ', ' furnace ', ' gas meter ', ' pergola ', ' small cell ', ' minor communication ', ' antenna ', ' fire rated ', ' fire alarm ',
  ' sprinkler ', ' signage ', ' sign ', ' fence ', ' shed ', ' blanket permit ', ' initial tenant improvement ', ' tenant finish ', ' tenant finishes ',
  // trade and small-object permits (measured on a 5,000-record national sample, 2026-11-02): they only decide a record nothing above included
  ' electrical ', ' mechanical ', ' plumbing ', ' hvac ', ' air conditioning ', ' heat pump ', ' roof ', ' roofing ', ' siding ', ' door ', ' doors ',
  ' retaining wall ', ' solar ', ' pool ', ' spa ', ' deck ', ' porch ', ' patio '];
const ONE_UNIT_RE = / (unit|suite|apt|apartment) [a-z]?\d+[a-z]? /;

/** The use a change of use or an established use names, in the record's own words, when it can be read cleanly; otherwise undefined. */
export function documentedUse(text: string): string | undefined {
  const t = String(text).replace(/\s+/g, ' ');
  const m = /(?:change (?:of )?use|establish use|convert(?:ing)?)\b[^.;]*?\b(?:to|as|into) (?:an? )?([a-z][a-z /&-]{2,40}?)(?=\s*(?:[.,;:(]|\bper\b|\bin\b|\bat\b|\bon\b|\bfor\b|\bwith\b|$))/i.exec(t);
  if (!m) return undefined;
  const use = m[1].trim().replace(/\s+/g, ' ').toLowerCase();
  return use.length >= 3 && !/^(the|a|an|existing)$/.test(use) ? use : undefined;
}

/** "existing 12-story building", "existing multifamily building (floors 2-12, 55 balconies)": what is already there, cut before any number is read. */
const EXISTING_SCALE_RE = /\bexisting\b(?:[\s,()-]+[\w-]+){0,8}?[\s,()-]+(?:building|buildings|structure|structures|residence|house|home|facility|condominium|tower)s?\b(?:\s*\([^)]*\))?/gi;
/** "254-unit" or "83 stacked dwelling units": a count. "28467 Unit 1517" or "1605 UNIT" is an address, so a bare singular "unit" never counts. */
const UNITS_RE = /\b(\d{1,3}(?:,\d{3})+|\d{1,5})(?:-units?\b|[\s-]+(?:(?:stacked|dwelling|residential|apartment|housing|condominium|condo|townhouse|townhome|hotel|guest|live[\s-]work|affordable|market[\s-]rate|senior|new|additional|rental|multifamily)[\s-]+){0,3}units\b)/i;
const STORIES_RE = /\b(\d{1,3})[\s-]*(?:story|stories|storey|storeys)\b/i;
const SQFT_RE = /\b(\d{1,3}(?:,\d{3})+|\d{3,7})\s*(?:sq\.?\s*ft\.?|square[\s-]f(?:ee|oo)t|sf)\b/i;
/** The scale a record's own words state (units, stories, square feet), or undefined. A number about something already standing is not read. */
export function documentedScale(text: string): DocumentedScale | undefined {
  const t = String(text ?? '').replace(/\s+/g, ' ').replace(EXISTING_SCALE_RE, ' ');
  const num = (re: RegExp, lo: number, hi: number) => { const m = re.exec(t); const n = m ? Number(m[1].replace(/,/g, '')) : NaN; return Number.isFinite(n) && n >= lo && n <= hi ? n : undefined; };
  const units = num(UNITS_RE, 2, 50000), stories = num(STORIES_RE, 1, 200), sqft = num(SQFT_RE, 500, 50000000);
  const out: DocumentedScale = { ...(units ? { units } : {}), ...(stories ? { stories } : {}), ...(sqft ? { sqft } : {}) };
  return Object.keys(out).length ? out : undefined;
}

/** THE one relevance decision. Pure: reads the record's own words, its canonical Type key and facility kind; no source name, place, clock or value. */
export function relevance(
  p: { name: string | null; type_raw: string | null; scope_text?: string | null; registry_id?: string | null }, typeKey?: string | null, facilityKind?: string | null,
): Relevance {
  const V = RELEVANCE_RULE_VERSION;
  const raw = [p.type_raw ?? '', p.name ?? '', p.scope_text ?? ''].join(' ');
  const scale = documentedScale([p.name ?? '', p.scope_text ?? ''].join(' '));
  const inc = (basis: RelevanceBasis, evidence: string, use?: string): Relevance =>
    ({ include: true, basis, evidence: evidence.trim(), ...(use ? { use } : {}), ...(scale ? { scale } : {}), rule_version: V });
  let w = normalizeWords(raw);
  // the Type itself is the documented use: a road, bridge or utility project; a data center; a heavy facility (landfill, quarry, burning, transfer)
  if (typeKey === 'infrastructure') return inc('infrastructure', 'road, utility or public-works project');
  if (typeKey === 'datacenter') return inc('facility_use', 'data center');
  if (facilityKind) return inc('facility_use', facilityKind);
  for (const x of INTERIOR_DEMOLITION) w = w.split(x).join(' interior work ');
  w = w.replace(EXISTING_RE, ' existing building ');
  let hit: string | null;
  if (any(w, TEMPORARY) && (hit = any(w, TEMPORARY_EVENT))) return inc('temporary_event', 'temporary' + hit.trimEnd());
  const tmp = TEMPORARY_INSTALLATION_RE.exec(w);
  if (tmp) return inc('temporary_event', 'temporary ' + tmp[2]);
  // a change of use that also builds a new building ("Establish use as permanent supportive housing for 83 stacked dwelling units ... Construct new
  // mixed-use building") is new construction of that use; a conversion of an existing building stays a change of use
  if ((hit = any(w, CHANGE_OF_USE))) {
    const nb = any(w, [' new construction ', ' erect ', ' construct a residential ', ' construct a commercial ', ' construct a mixed use ']) ?? (NEW_BUILDING_RE.exec(w)?.[0] ?? null);
    return nb ? inc('new_construction', nb.trim(), documentedUse(raw)) : inc('change_of_use', hit, documentedUse(raw));
  }
  // a land-use application or decision is framed as one, never as construction: what it would allow is carried as `proposes`
  const wl = w.split(' land use code ').join(' code ');
  const demo = any(w, DEMOLITION), site = any(w, SITE_WORK), build = any(w, NEW_CONSTRUCTION) ?? (NEW_BUILDING_RE.exec(w)?.[0] ?? null);
  if ((hit = any(wl, LAND_USE))) {
    const r = inc('land_use', hit);
    const proposes = build ? 'new_construction' : demo ? 'demolition' : site ? 'site_work' : null;
    return proposes ? { ...r, proposes } as Relevance : r;
  }
  if ((hit = demo)) return inc('demolition', hit);
  if ((hit = site)) return inc('site_work', hit);
  if ((hit = build)) return inc('new_construction', hit);
  if ((hit = any(w, ADDITION))) return inc('addition', hit);
  if ((hit = any(w, SUBSTANTIAL))) return inc('substantial_alteration', hit);
  const ext = any(w, EXTERIOR);
  if (ext) {
    const wide = any(w, BUILDING_WIDE) ?? (BUILDING_WIDE_RE.exec(w)?.[0] ?? null);
    if (wide) return inc('exterior_building_wide', (ext.trim() + ',' + wide).replace(/\s+/g, ' '));
  }
  if ((hit = any(w, PUBLIC_ACCESS))) return inc('public_access', hit);
  if (typeKey !== 'residential' && (hit = any(w, PUBLIC_WORKS) ?? (ROUTE_RE.exec(w)?.[0] ?? null))) return inc('infrastructure', hit);
  if (typeKey === 'civic' && (hit = any(w, RENOVATION)) && !w.includes(' interior ')) return inc('public_facility', hit);
  const ti = any(w, TENANT_IMPROVEMENT);
  const night = any(w, NIGHTLIFE);
  if (night && ti && !w.includes(' existing' + night)) return inc('nightlife_use', night, night.trim());
  // THE CANONICAL RESIDENTIAL ANSWER (lib/residential-qualify.js, through its generated copy): Map 1's own rule for whether a record is new residential
  // development or routine work on an existing home, including the founder's bounded development-class source families (2026-09-06). It is asked, never
  // restated. For a record of another Type only its source-class answers are taken (a bounded development corpus; a subdivision, plat or site-plan record).
  const ra = HS().residentialActivity ? HS().residentialActivity({ name: p.name, type_raw: p.type_raw, registry_id: p.registry_id ?? null }) : null;
  if (ra && ra.verdict === 'DEVELOPMENT' && (typeKey === 'residential' || ra.rule === 'DEV_PROVENANCE' || ra.rule === 'DEV_ANYWHERE')) {
    return inc(typeKey === 'residential' ? 'residential_development' : 'development_record', String(ra.evidence ?? ra.rule));
  }
  if (ra && ra.verdict === 'ROUTINE' && typeKey === 'residential') return { include: false, reason: 'routine_work', evidence: String(ra.evidence ?? ra.rule), rule_version: V };
  // routine work: positive evidence of interior, single-unit, like-for-like or small-fixture work, or a tenant improvement that states no change of use
  const routine = any(w, ROUTINE) ?? (ONE_UNIT_RE.exec(w)?.[0] ?? null) ?? ti;
  if (routine) return { include: false, reason: 'routine_work', evidence: routine.trim(), rule_version: V };
  return { include: false, reason: 'not_established', evidence: null, rule_version: V };
}

/**
 * Activity dates the SOURCE stated (app_projects.start_date / end_date). Only real calendar days are kept; an end before today says the activity is over, so a
 * record whose administrative status is still open is not presented as upcoming. Null when the source states neither.
 */
export function activityWindow(p: { start_date?: string | null; end_date?: string | null }, today: string) {
  const s = validDay(p.start_date) && p.start_date! >= RECORD_DATE_FLOOR ? p.start_date! : null;
  const e = validDay(p.end_date) && p.end_date! >= RECORD_DATE_FLOOR ? p.end_date! : null;
  if (!s && !e) return null;
  return { start: s, end: e, ended: !!e && e < today };
}

// ── TEMPORARY ACTIVITY TIMING (national-7, 2026-11-02, founder) ────────────────────────────────────────────────────────────────────────────────────
// A temporary installation or event is reported only while its DOCUMENTED activity is upcoming or under way. The window is the whole documented span,
// installation through removal (the earliest and latest day the source states), never only the public dates. It is read from the source's own date
// fields and from the record's own words (its description, and the fuller scope text when the ingest stored one), so a reusable path, not a list of events.
//   upcoming .................. the window starts after today                     -> included
//   active .................... today is inside the window                         -> included
//   ended ..................... the window ended before today                      -> excluded, unless the record also documents a continuing scope
//   timing_not_captured ....... no date found AND the ingested text was cut short  -> excluded, flagged: the source may state dates ingestion did not keep
//   timing_not_stated ......... no date found in the complete ingested text         -> excluded, flagged
// A day without a year ("9/5") takes its year only from the one four-digit year the same text states; with none, or two different ones, it is not read.
const MONTH_NAMES = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
function ymdDay(y: number, m: number, d: number): string | null {
  const s = String(y).padStart(4, '0') + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  return validDay(s) && s >= RECORD_DATE_FLOOR ? s : null;
}
/** Every calendar day a text states, as ISO days, with the words each came from. Pure. */
export function documentedDates(text: string): Array<{ day: string; words: string }> {
  const t = String(text ?? '');
  const out: Array<{ day: string; words: string }> = [];
  const push = (d: string | null, words: string) => { if (d && !out.some((o) => o.day === d)) out.push({ day: d, words: words.trim() }); };
  const years = [...new Set([...t.matchAll(/\b(20\d{2})\b/g)].map((m) => Number(m[1])))];
  const year = years.length === 1 ? years[0] : null;
  for (const m of t.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) push(ymdDay(+m[1], +m[2], +m[3]), m[0]);
  for (const m of t.matchAll(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{4}|\d{2}))?\b/g)) {
    const y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : year;
    if (y) push(ymdDay(y, +m[1], +m[2]), m[0]);
  }
  const mn = MONTH_NAMES.join('|') + '|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec';
  for (const m of t.matchAll(new RegExp('\\b(' + mn + ')\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b', 'gi'))) {
    const k = m[1].toLowerCase().slice(0, 3), mi = MONTH_NAMES.findIndex((x) => x.startsWith(k));
    const y = m[3] ? Number(m[3]) : year;
    if (mi >= 0 && y) push(ymdDay(y, mi + 1, +m[2]), m[0]);
  }
  return out;
}
export type TemporaryTiming = {
  status: 'upcoming' | 'under_way' | 'ended' | 'timing_not_captured' | 'timing_not_stated';
  start: string | null; end: string | null; source: 'source_fields' | 'record_text' | 'both' | null; evidence: string[];
};
export function temporaryTiming(
  p: { name: string | null; scope_text?: string | null; start_date?: string | null; end_date?: string | null }, today: string, textCut: boolean,
): TemporaryTiming {
  const days: string[] = [], evidence: string[] = [];
  const f = activityWindow(p, today);
  if (f) { if (f.start) { days.push(f.start); evidence.push('start date ' + f.start); } if (f.end) { days.push(f.end); evidence.push('end date ' + f.end); } }
  const fromText = documentedDates([p.name ?? '', p.scope_text ?? ''].join(' \n '));
  for (const d of fromText) { days.push(d.day); evidence.push('"' + d.words + '"'); }
  const source: TemporaryTiming['source'] = f && fromText.length ? 'both' : f ? 'source_fields' : fromText.length ? 'record_text' : null;
  if (!days.length) {
    const cut = textCut && !(typeof p.scope_text === 'string' && p.scope_text.trim());
    return { status: cut ? 'timing_not_captured' : 'timing_not_stated', start: null, end: null, source: null, evidence: [] };
  }
  const start = days.reduce((a, b) => (a <= b ? a : b)), end = days.reduce((a, b) => (a >= b ? a : b));
  const status = end < today ? 'ended' : start > today ? 'upcoming' : 'under_way';
  return { status, start, end, source, evidence };
}

export function assemble(input: AssembleInput): Assembled {
  const { now, subject, radius_mi, view } = input;
  if (!ALLOWED_RADII.includes(radius_mi)) throw new Error('assemble: radius_mi must be one of ' + ALLOWED_RADII.join(', '));
  if (view !== 'customer' && view !== 'internal') throw new Error('assemble: view must be customer or internal');
  if (!/^\d{5}$/.test(subject.zip)) throw new Error('assemble: subject.zip must be five digits');
  if (!Number.isFinite(subject.lat) || !Number.isFinite(subject.lng)) throw new Error('assemble: the subject point is not finite');
  if (typeof subject.address !== 'string' || !subject.address.trim()) throw new Error('assemble: the subject address is blank');
  const credits = validateAttribution(input.attribution).attribution;

  if (!input.zip_supported) {
    return {
      coverage_state: 'OUTSIDE_COVERAGE', intelligence: null, privateContext: null, engineInputs: null,
      renderOnly: { distances_mi: {}, bearings_deg: {}, review: [] }, storage_blockers: ['OUTSIDE_COVERAGE'],
    };
  }

  const today = dayOf(now);
  const truncated = input.rows.some((r) => r.has_more === true);

  // nearest distance per project (a project may own several geometry instances); its direction is taken from that instance's
  // display point, so on the map a line or an area is drawn at its true nearest distance and in an approximate direction
  const distance = new Map<string, number>();
  const nearest = new Map<string, RadiusRow>();
  for (const r of input.rows) {
    const cur = distance.get(r.source_key);
    if (cur === undefined || r.distance_mi < cur) { distance.set(r.source_key, r.distance_mi); nearest.set(r.source_key, r); }
  }
  const ledger = new Map(input.ledger.map((l) => [l.identity_key, l]));
  const eventsByKey = new Map<string, ReportableEvent[]>();
  for (const e of input.events) {
    if (!eventsByKey.has(e.identity_key)) eventsByKey.set(e.identity_key, []);
    eventsByKey.get(e.identity_key)!.push(e);
  }
  const windowStart = addDays(today, -RECENT_DAYS);

  const excluded = { development_only: 0, no_source_family: 0, no_source_url: 0, standing_inventory: 0, no_distance: 0, routine_work: 0, relevance_not_established: 0, temporary_ended: 0 };
  // national-6: what relevance() left out, kept in the permanent body for traceability and internal review. No customer surface reads it.
  const relevanceReview: Array<{ project_id: string; source_family: string; reason: string; evidence: string | null; rule_version: string }> = [];
  const checked: string[] = [];
  type Entry = Record<string, unknown> & { project_id: string };
  const projects: Entry[] = [];
  const whatChanged: Array<{ project_id: string; at: string }> = [];
  const recentOfficial: Array<{ project_id: string; at: string }> = [];
  const byLifecycle: Record<Lifecycle, string[]> = { approved: [], proposed: [], operating: [], unknown: [] };
  const byStage: Record<Stage, string[]> = { approved: [], proposed: [], permitted: [], occupancy: [] };
  const bearings: Record<string, number> = {};
  const familiesIncluded = new Set<string>();
  const distances: Record<string, number> = {};
  let anyChangeReady = false;

  for (const p of [...input.projects].sort((a, b) => (a.source_key < b.source_key ? -1 : 1))) {
    if (!distance.has(p.source_key)) { excluded.no_distance++; continue; }
    if (p.record_kind !== 'development') { excluded.development_only++; continue; }
    const family = p.registry_id ?? '';
    // PROVENANCE, not rights: a record a wired connector produced carries its source family. One without it cannot be
    // traced to a wired source and is left out (founder, 2026-11-01), and the report says so.
    if (!family) { excluded.no_source_family++; continue; }
    if (!p.source_ref || !p.source_ref.trim()) { excluded.no_source_url++; continue; }

    const t = HS().canonicalProjectType({ type: p.type, name: p.name });
    const lc = HS().canonicalLifecycle({ status: p.status });
    const pub = publisherOf(family || null);
    const ev = withDateLabel(recentPublisherEvent(p, today), pub);
    const led = ledger.get(p.source_key);
    const material = selectDetectedChanges(led, eventsByKey.get(p.source_key) ?? [],
      (e) => String(e.observed_at).slice(0, 10) >= windowStart && String(e.observed_at).slice(0, 10) <= today);
    const changeCounts = material.length > 0;

    // R3 / default D-4: an operating record is not a standing inventory. It appears only when it carries an event in the window.
    if (lc.key === 'operating' && !ev && !changeCounts) { excluded.standing_inventory++; continue; }

    // RELEVANCE, before the record reaches any section, count, map, history, alert or export (national-7)
    let rel = relevance(p, t ? t.typeKey : null, t && t.facilityKind ? t.facilityKind : null);
    let timing: TemporaryTiming | null = null;
    if (rel.include && rel.basis === 'temporary_event') {
      timing = temporaryTiming(p, today, titleCut(p.name));
      if (timing.status === 'ended') {
        // a separate, documented continuing scope still qualifies (the same words with the temporary activity taken out)
        const cont = relevance({ ...p, name: (p.name ?? '').replace(/\btemporary\b/gi, ' '), scope_text: (p.scope_text ?? '').replace(/\btemporary\b/gi, ' ') },
          t ? t.typeKey : null, t && t.facilityKind ? t.facilityKind : null);
        if (cont.include && cont.basis !== 'temporary_event') rel = cont;
        else {
          excluded.temporary_ended++;
          relevanceReview.push({ project_id: p.source_key, source_family: family, reason: 'temporary_activity_ended', evidence: timing.evidence.join('; ') || null, rule_version: RELEVANCE_RULE_VERSION });
          continue;
        }
      } else if (timing.status === 'timing_not_captured' || timing.status === 'timing_not_stated') {
        excluded.relevance_not_established++;
        relevanceReview.push({ project_id: p.source_key, source_family: family, reason: timing.status === 'timing_not_captured' ? 'temporary_timing_not_captured' : 'temporary_timing_not_stated', evidence: rel.evidence, rule_version: RELEVANCE_RULE_VERSION });
        continue;
      }
    }
    if (!rel.include) {
      if (rel.reason === 'routine_work') excluded.routine_work++; else excluded.relevance_not_established++;
      relevanceReview.push({ project_id: p.source_key, source_family: family, reason: rel.reason, evidence: rel.evidence, rule_version: rel.rule_version });
      continue;
    }

    // A STAGE THE AGENCY STATED. A source with no status column stores its connector's constant as the stage, and the canonical lifecycle then comes
    // from that constant too, so neither is the agency's: such a record is given no stage, except that an issue date the agency published IS evidence
    // the permit was issued. A temporary event is given no stage either: its administrative status says nothing about whether the event is still ahead.
    const unpublished = !!(pub.status_const && p.stage && agencyStage(p.stage, pub) === null);
    const rdRaw = recordDate(p, today);
    let stage = presentationStage(lc.key, unpublished ? null : p.stage);
    let evidence: { kind: 'permit_issued' | 'under_construction'; label: string } | null = stage === 'permitted' ? stageEvidence(p.stage) : null;
    const occLabel = stage === 'occupancy' ? (temporaryOccupancy(p.stage) ? 'Temporary occupancy approved' : OCCUPANCY_EVIDENCE_LABEL) : null;
    if (unpublished) {
      stage = rdRaw && rdRaw.kind === 'issued' && (lc.key === 'approved' || lc.key === 'unknown') ? 'permitted' : null;
      evidence = stage ? { kind: 'permit_issued', label: STAGE_EVIDENCE_LABELS.permit_issued } : null;
    }
    // (relevance-3, 2026-11-03) a temporary installation keeps its agency stage: how long it lasts and where its permit stands are separate facts
    const actWin = timing && (timing.start || timing.end)
      ? { start: timing.start, end: timing.end, ended: timing.status === 'ended', status: timing.status, from: timing.source }
      : activityWindow(p, today);
    const description = typeof p.scope_text === 'string' && p.scope_text.trim() && p.scope_text.trim() !== (p.name ?? '').trim() ? p.scope_text.trim() : null;
    const entry: Entry = {
      project_id: p.source_key,
      source_family: family || null,
      name: p.name,
      address: p.address,
      type: t ? { key: t.typeKey, label: t.label, ...(t.facilityKind ? { kind: t.facilityKind } : {}) } : null,
      lifecycle: { key: lc.key, label: lc.label },
      stage: stage ? { key: stage, label: stageLabel(stage, evidence, p.stage), ...(evidence ? { evidence: evidence.label } : occLabel ? { evidence: occLabel } : {}) } : null,
      publisher_status: p.status,
      publisher_stage: agencyStage(p.stage, pub),
      ...(pub.status_const && agencyStage(p.stage, pub) === null && p.stage ? { publisher_stage_unpublished: true } : {}),
      publisher_event: ev,
      record_date: ((rd: ReturnType<typeof recordDate>) => (rd ? { ...rd, verify: verification(rd, stage, [ev?.date, ...material.map((e) => e.publisher_event_date)], today) } : null))(withDateLabel(recordDate(p, today), pub)),
      developer: p.developer, size: p.size, investment: p.investment,
      ...(titleCut(p.name) ? { title_cut: true } : {}),
      relevance: { basis: rel.basis, evidence: rel.evidence, ...(rel.use ? { use: rel.use } : {}), ...(rel.proposes ? { proposes: rel.proposes } : {}), ...(rel.scale ? { scale: rel.scale } : {}), rule_version: rel.rule_version },
      publisher_type: typeof p.type_raw === 'string' && p.type_raw.trim() ? p.type_raw.trim() : null,
      ...(description ? { description } : {}),
      ...(actWin ? { activity_window: actWin } : {}),
      source: { url: p.source_ref, attribution: credits[family] ?? null, agency: pub.agency, feed_ref: pub.dataset, record_id: recordIdOf(p) },
      homesignal_observation: led
        ? { first_observed_at: led.first_observed_at, last_observed_at: led.last_observed_at, observation_count: led.observation_count, change_ready: led.change_ready }
        : null,
    };
    projects.push(entry);
    distances[p.source_key] = distance.get(p.source_key)!;
    const near = nearest.get(p.source_key);
    if (near && typeof near.marker_lat === 'number' && typeof near.marker_lng === 'number') {
      const b = bearingDeg(subject.lat, subject.lng, near.marker_lat, near.marker_lng);
      if (b !== null) bearings[p.source_key] = b;
    }
    familiesIncluded.add(family);
    if (led && typeof led.last_observed_at === 'string' && led.last_observed_at) checked.push(led.last_observed_at);
    if (led && led.change_ready) anyChangeReady = true;
    byLifecycle[lc.key as Lifecycle].push(p.source_key);
    if (stage) byStage[stage].push(p.source_key);
    if (changeCounts) whatChanged.push({ project_id: p.source_key, at: String(material[0].observed_at) });
    else if (ev) recentOfficial.push({ project_id: p.source_key, at: ev.date });
    if (changeCounts) {
      entry.homesignal_detected_changes = detectedChangeEntries(material);
    }
  }
  const order = (list: Array<{ project_id: string; at: string }>) =>
    list.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : a.project_id < b.project_id ? -1 : 1)).map((x) => x.project_id);
  for (const k of LIFECYCLE_ORDER) byLifecycle[k].sort();
  for (const k of STAGE_ORDER) byStage[k].sort();
  // Things to Review: the nearest projects in a stage section; on a tie, the stronger stage, then the project id
  const stageOf = new Map<string, Stage>();
  for (const k of STAGE_ORDER) for (const id of byStage[k]) stageOf.set(id, k);
  const review = [...stageOf.keys()].sort((a, b) =>
    (distances[a] - distances[b]) || (STAGE_STRENGTH[stageOf.get(a)!] - STAGE_STRENGTH[stageOf.get(b)!]) || (a < b ? -1 : a > b ? 1 : 0))
    .slice(0, REVIEW_LIMIT);

  // ── coverage: only what the inputs can support, and it says so ──
  const limitations: Array<{ code: string; text: string }> = [];
  if (excluded.no_source_family > 0) {
    // records were found near the subject and left out because they carry no source family: the report says so
    limitations.push({ ...RECORDS_NOT_TRACEABLE });
  }
  if (truncated) {
    limitations.push({ code: 'AREA_TRUNCATED', text: 'This area holds more records than one report can carry; the list is incomplete.' });
  }
  if (sourcesNotFullyRead(input.health, familiesIncluded)) limitations.push({ ...SOURCE_NOT_FULLY_READ });
  const state: CoverageState = limitations.length > 0 ? 'LIMITED_COVERAGE' : anyChangeReady ? 'CHANGE_READY' : 'REPORT_READY';
  const outcome = activityOutcome(projects.length, relevanceReview.length);

  const intelligence: Record<string, unknown> = {
    product: PRODUCT_NAME,
    report_version: REPORT_VERSION,
    as_of: today,
    zip: subject.zip,
    radius_mi,
    recent_days: RECENT_DAYS,
    stage_rule_version: STAGE_RULE_VERSION,
    relevance_rule_version: RELEVANCE_RULE_VERSION,
    activity: {
      outcome, label: ACTIVITY_LABELS[outcome], rule_version: ACTIVITY_RULE_VERSION,
      // what Jody read and left out, by kind: only on the outcome that rests on it (the view words it; nothing else reads it)
      ...(outcome === 'NO_SIGNIFICANT_CHANGES' ? { records_judged: {
        total: relevanceReview.length, routine: excluded.routine_work, undescribed: excluded.relevance_not_established, temporary_ended: excluded.temporary_ended,
      } } : {}),
    },
    coverage: {
      zip_supported: true,
      state,
      change_ready: anyChangeReady,
      area_truncated: truncated,
      source_families_in_report: [...familiesIncluded].filter(Boolean).sort(),
      source_feed_count: [...familiesIncluded].filter(Boolean).length,
      // the publishing agency and dataset of each source in the report, in the families' order: the coverage note names all of them
      source_agencies: [...familiesIncluded].filter(Boolean).sort().map((f) => ({ source_family: f, agency: publisherOf(f).agency, feed_ref: publisherOf(f).dataset })),
      assessment_basis: 'records_returned_for_this_radius',
      // when Jody last read the records in this report (the ledger's last observation of each): a retrieval time, never a project date
      records_checked: checked.length ? { earliest: checked.reduce((a, b) => (a <= b ? a : b)), latest: checked.reduce((a, b) => (a >= b ? a : b)) } : null,
      // some nearby records did not describe their work, so Jody cannot tell whether they are a meaningful change: the report says so, without a count
      undescribed_records: excluded.relevance_not_established > 0,
      // confirmed routine work was found and left out (a separate fact from "not described"; neither is a count)
      routine_records: excluded.routine_work > 0,
      limitations,
    },
    sections: {
      what_changed_recently: order(whatChanged),
      recent_official_activity: order(recentOfficial),
      by_lifecycle: byLifecycle,
      by_stage: byStage,
    },
    projects,
    relevance_review: relevanceReview,
  };

  const privateContext: PrivateContext = {
    address: subject.address,
    ...(subject.matched_address ? { normalized_address: subject.matched_address } : {}),
    latitude: subject.lat,
    longitude: subject.lng,
    ...(subject.label ? { label: subject.label } : {}),
  };

  const blockers: string[] = [];
  if (view !== 'customer') blockers.push('INTERNAL_VIEW');
  for (const f of boundaryFindings(intelligence, privateContext)) blockers.push('BOUNDARY:' + f);

  return {
    coverage_state: state,
    intelligence,
    privateContext,
    engineInputs: {
      engine: REPORT_VERSION, zip: subject.zip, radius_mi, recent_days: RECENT_DAYS, stage_rule_version: STAGE_RULE_VERSION,
      activity_rule_version: ACTIVITY_RULE_VERSION, relevance_rule_version: RELEVANCE_RULE_VERSION, source_policy: SOURCE_POLICY, attribution_version: input.attribution.version,
    },
    renderOnly: {
      distances_mi: distances,
      bearings_deg: bearings,
      review,
      ...(view === 'internal' ? { internal: { excluded } } : {}),
    },
    storage_blockers: blockers,
  };
}
