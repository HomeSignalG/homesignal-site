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
//   whether a source may appear in a paid
//   report .................................... _shared/report-rights.json (empty; a HOLD is never cleared)
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
import { snapshotBodyOf, subjectRelativeKeys } from './report-snapshot.ts';
import type { PrivateContext } from './report-snapshot.ts';

export const PRODUCT_NAME = 'HOMESIGNAL DEVELOPMENT ACTIVITY';
/** national-2 (2026-10-02, 100526 plan step 2): adds the Stage dimension (`stage`, `sections.by_stage`, `stage_rule_version`). */
export const REPORT_VERSION = 'development-activity-national-2';
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
export const STAGE_RULE_VERSION = 'stage-evidence-1';
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
export const STAGE_ORDER = ['approved', 'proposed', 'permitted'] as const;
export type Stage = typeof STAGE_ORDER[number];
export const STAGE_LABELS: Record<Stage, string> = {
  approved: 'Approved / Coming', proposed: 'Proposed / Under Review', permitted: 'Permitted / Under Construction',
};

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
const STAGE_STRENGTH: Record<Stage, number> = { permitted: 0, approved: 1, proposed: 2 };

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

export type RightsEntry = { registry_id: string; cleared_on: string; audit_ref: string; attribution: string };
export type RightsRegistry = { version: number; cleared: RightsEntry[] };

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
  rights: RightsRegistry; rows: RadiusRow[]; projects: ProjectRow[]; ledger: LedgerProject[];
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
 * The rights registry, validated strictly. An entry that is malformed, duplicated or uses a wildcard makes the whole
 * registry unusable and this throws: the caller must fail the request, never fall back to "everything is cleared".
 */
export function validateRights(reg: unknown): RightsRegistry {
  const r = reg as any;
  if (!r || typeof r !== 'object' || !Number.isInteger(r.version) || !Array.isArray(r.cleared)) {
    throw new Error('rights registry: expected { version, cleared[] }');
  }
  const seen = new Set<string>();
  for (const e of r.cleared) {
    if (!e || typeof e !== 'object') throw new Error('rights registry: an entry is not an object');
    for (const k of ['registry_id', 'cleared_on', 'audit_ref']) {
      if (typeof e[k] !== 'string' || !e[k].trim()) throw new Error('rights registry: an entry has no ' + k);
    }
    if (typeof e.attribution !== 'string') throw new Error('rights registry: an entry has no attribution (use "" if none is required)');
    if (/[*?%]/.test(e.registry_id)) throw new Error('rights registry: a registry_id may not be a pattern (' + e.registry_id + ')');
    if (!validDay(e.cleared_on)) throw new Error('rights registry: cleared_on must be YYYY-MM-DD (' + e.registry_id + ')');
    if (seen.has(e.registry_id)) throw new Error('rights registry: duplicate registry_id ' + e.registry_id);
    seen.add(e.registry_id);
  }
  return { version: r.version, cleared: r.cleared.map((e: RightsEntry) => ({ ...e })) };
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

// ── the boundary ─────────────────────────────────────────────────────────────────────────────────────────

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
  // Substring, not word-bounded: in JSON a value is delimited by quotes, not spaces, so a private value that fills a whole
  // string ("address": "742 Evergreen ...") has no space on either side. (Found by test/national-report.test.mjs 7b.)
  const text = norm(body);
  const has = (needle: string) => needle.length >= 3 && text.includes(needle);
  const hasSub = (needle: string) => needle.length >= 5 && text.includes(needle);
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

export function assemble(input: AssembleInput): Assembled {
  const { now, subject, radius_mi, view } = input;
  if (!ALLOWED_RADII.includes(radius_mi)) throw new Error('assemble: radius_mi must be one of ' + ALLOWED_RADII.join(', '));
  if (view !== 'customer' && view !== 'internal') throw new Error('assemble: view must be customer or internal');
  if (!/^\d{5}$/.test(subject.zip)) throw new Error('assemble: subject.zip must be five digits');
  if (!Number.isFinite(subject.lat) || !Number.isFinite(subject.lng)) throw new Error('assemble: the subject point is not finite');
  if (typeof subject.address !== 'string' || !subject.address.trim()) throw new Error('assemble: the subject address is blank');
  const rights = validateRights(input.rights);

  if (!input.zip_supported) {
    return {
      coverage_state: 'OUTSIDE_COVERAGE', intelligence: null, privateContext: null, engineInputs: null,
      renderOnly: { distances_mi: {}, bearings_deg: {}, review: [] }, storage_blockers: ['OUTSIDE_COVERAGE'],
    };
  }

  const today = dayOf(now);
  const cleared = new Map(rights.cleared.map((e) => [e.registry_id, e]));
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

  const excluded = { development_only: 0, no_rights: {} as Record<string, number>, no_source_url: 0, standing_inventory: 0, no_distance: 0 };
  type Entry = Record<string, unknown> & { project_id: string };
  const projects: Entry[] = [];
  const whatChanged: Array<{ project_id: string; at: string }> = [];
  const recentOfficial: Array<{ project_id: string; at: string }> = [];
  const byLifecycle: Record<Lifecycle, string[]> = { approved: [], proposed: [], operating: [], unknown: [] };
  const byStage: Record<Stage, string[]> = { approved: [], proposed: [], permitted: [] };
  const bearings: Record<string, number> = {};
  const familiesIncluded = new Set<string>();
  const distances: Record<string, number> = {};
  let anyChangeReady = false;
  let anyHold = false;

  for (const p of [...input.projects].sort((a, b) => (a.source_key < b.source_key ? -1 : 1))) {
    if (!distance.has(p.source_key)) { excluded.no_distance++; continue; }
    if (p.record_kind !== 'development') { excluded.development_only++; continue; }
    const family = p.registry_id ?? '';
    const grant = cleared.get(family);
    if (!grant) {
      if (view === 'customer') { excluded.no_rights[family || '(none)'] = (excluded.no_rights[family || '(none)'] ?? 0) + 1; continue; }
      anyHold = true;
    }
    if (!p.source_ref || !p.source_ref.trim()) { excluded.no_source_url++; continue; }

    const t = HS().canonicalProjectType({ type: p.type, name: p.name });
    const lc = HS().canonicalLifecycle({ status: p.status });
    const ev = recentPublisherEvent(p, today);
    const led = ledger.get(p.source_key);
    const material = selectDetectedChanges(led, eventsByKey.get(p.source_key) ?? [],
      (e) => String(e.observed_at).slice(0, 10) >= windowStart && String(e.observed_at).slice(0, 10) <= today);
    const changeCounts = material.length > 0;

    // R3 / default D-4: an operating record is not a standing inventory. It appears only when it carries an event in the window.
    if (lc.key === 'operating' && !ev && !changeCounts) { excluded.standing_inventory++; continue; }

    const stage = presentationStage(lc.key, p.stage);
    const evidence = stage === 'permitted' ? stageEvidence(p.stage) : null;
    const entry: Entry = {
      project_id: p.source_key,
      source_family: family || null,
      name: p.name,
      address: p.address,
      type: t ? { key: t.typeKey, label: t.label } : null,
      lifecycle: { key: lc.key, label: lc.label },
      stage: stage ? { key: stage, label: STAGE_LABELS[stage], ...(evidence ? { evidence: evidence.label } : {}) } : null,
      publisher_status: p.status,
      publisher_stage: p.stage,
      publisher_event: ev,
      developer: p.developer, size: p.size, investment: p.investment,
      source: { url: p.source_ref, attribution: grant ? (grant.attribution || null) : null },
      homesignal_observation: led
        ? { first_observed_at: led.first_observed_at, last_observed_at: led.last_observed_at, observation_count: led.observation_count, change_ready: led.change_ready }
        : null,
    };
    if (view === 'internal') entry.rights = grant ? 'CLEARED' : 'HOLD';
    projects.push(entry);
    distances[p.source_key] = distance.get(p.source_key)!;
    const near = nearest.get(p.source_key);
    if (near && typeof near.marker_lat === 'number' && typeof near.marker_lng === 'number') {
      const b = bearingDeg(subject.lat, subject.lng, near.marker_lat, near.marker_lng);
      if (b !== null) bearings[p.source_key] = b;
    }
    familiesIncluded.add(family);
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
  if (rights.cleared.length === 0) {
    limitations.push({ code: 'NO_INCLUDED_SOURCE', text: 'No official development source for this area is included in this report.' });
  } else if (Object.keys(excluded.no_rights).length > 0) {
    // records were found near the subject and left out: the report is incomplete against the official record, and says so
    limitations.push({ code: 'SOURCES_NOT_INCLUDED', text: 'Some official sources for this area are not included in this report.' });
  }
  if (truncated) {
    limitations.push({ code: 'AREA_TRUNCATED', text: 'This area holds more records than one report can carry; the list is incomplete.' });
  }
  if (sourcesNotFullyRead(input.health, familiesIncluded)) limitations.push({ ...SOURCE_NOT_FULLY_READ });
  const state: CoverageState = limitations.length > 0 ? 'LIMITED_COVERAGE' : anyChangeReady ? 'CHANGE_READY' : 'REPORT_READY';

  const intelligence: Record<string, unknown> = {
    product: PRODUCT_NAME,
    report_version: REPORT_VERSION,
    as_of: today,
    zip: subject.zip,
    radius_mi,
    recent_days: RECENT_DAYS,
    stage_rule_version: STAGE_RULE_VERSION,
    coverage: {
      zip_supported: true,
      state,
      change_ready: anyChangeReady,
      area_truncated: truncated,
      source_families_in_report: [...familiesIncluded].filter(Boolean).sort(),
      assessment_basis: 'records_returned_for_this_radius',
      limitations,
    },
    sections: {
      what_changed_recently: order(whatChanged),
      recent_official_activity: order(recentOfficial),
      by_lifecycle: byLifecycle,
      by_stage: byStage,
    },
    projects,
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
  if (anyHold) blockers.push('CONTAINS_UNCLEARED_SOURCE');
  for (const f of boundaryFindings(intelligence, privateContext)) blockers.push('BOUNDARY:' + f);

  return {
    coverage_state: state,
    intelligence,
    privateContext,
    engineInputs: {
      engine: REPORT_VERSION, zip: subject.zip, radius_mi, recent_days: RECENT_DAYS, stage_rule_version: STAGE_RULE_VERSION,
      rights_registry_version: rights.version, cleared_families: rights.cleared.length,
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
