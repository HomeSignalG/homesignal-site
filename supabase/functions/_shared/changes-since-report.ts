// CHANGES SINCE REPORT — what the change ledger has learned about the projects in a stored report since that report was issued
// (Development Activity plan "Watch This Property"; docs/report-private-context-contract-2026-09-30.md §6 gate 4 and §8.5).
//
// PURE. This file reads no environment, calls no network and holds no client; the edge function hands it what the database
// returned. And it has no handle on the PRIVATE CONTEXT at all: it is given the report's permanent body (which holds project
// identities and no address), the ledger rows and events for those projects, the source health of the families in the report,
// and the rights registry. That is the whole contract (§8.5), and it is why this works while a Follow keeps the context alive,
// and equally after the context is purged: with the same clock and the same ledger state the answer is the same either way, byte
// for byte (test/changes_since_report_pg).
//
// IT DECIDES NOTHING THAT ALREADY HAS AN OWNER.
//   what a detected change is ...... national-report.ts `selectDetectedChanges` / `detectedChangeEntries`, the SAME functions the
//                                    report itself uses (a project is change-ready; an event is material). Not restated here.
//   which events may be shown ...... public.dev_change_event_reportable (the ledger's reader), through _shared/change-reads.ts
//   which sources may be shown ..... _shared/report-rights.json, read NOW, not as it stood when the report was issued: a source whose
//                                    clearance was withdrawn stops appearing in later answers
//   whether sources were readable .. national-report.ts `sourcesNotFullyRead`, the same rule as the report
// What it owns is the BOUNDARY IN TIME: which events count as "since".
//
// WHAT "SINCE" MEANS, and why it is not `observed_at > issued_at`.
//   An event's `observed_at` is the retrieval instant of the SOURCE RECORD (the materialiser's refresh time). The observation job
//   reaches a ZIP up to a day later, so an event can carry an `observed_at` hours BEFORE the report and be RECORDED in the ledger
//   AFTER it: the report could not have shown it, and `observed_at > issued_at` would lose it for good. What the report could not
//   have known is what the ledger recorded after the report read it, so the boundary is the event's `created_at`. That column is
//   `default now()`, which Postgres evaluates at TRANSACTION START, not at the write or the commit: an event is stamped with the
//   instant its transaction began.
//   The report reads the ledger a moment before it is issued, and an observation tick is one transaction (a soft 60 s budget checked
//   between ZIPs, a hard 120 s statement timeout), so an event can have a `created_at` slightly before `issued_at` and still not have
//   been visible to the report. The boundary therefore reaches back SINCE_REPORT_OVERLAP_MS, and any event the report ALREADY SHOWED
//   (the same project, instant and type are in its body) is removed. The overlap cannot double-report, because of that removal;
//   without the removal it would.
//   ONE ASSUMPTION IS NOT ENFORCED HERE: that the report's ledger read and its store were less than (overlap − longest tick) apart.
//   The body records `as_of` (a day), not the instant of the ledger read, so the reader cannot check it. Stamping the read instant
//   into the body is a report-engine change (Order I); until then this is the documented limit.
//
// SOME ANSWERS CAN LOOK AS IF THEY CONTRADICT THE REPORT, and every such answer says why. The report reads the project's CURRENT
// state at issue time; an event can be recorded after issue from a source record that was retrieved BEFORE issue, so its new facts
// may be exactly what the report already stated. Each entry therefore carries `recorded_at` (the ledger's `created_at`) beside
// `detected_at` (the source retrieval instant) and `source_retrieved_before_report`, and the answer carries a RECORDED_AFTER_REPORT
// limitation whenever one is present. The event is not dropped (dropping it would lose a change the report's own body may not
// carry in full) and not hidden: it is labelled.
//
// WHAT IT DOES NOT COVER, and says so on every answer: a project that appeared near the property after the report. Finding one
// needs the subject's point, which is the private context, and this reader never touches it. It is a different feature (a watch,
// which keeps the context alive precisely so that the point can be used) and is not claimed here.
import {
  dayOf, detectedChangeEntries, isChangeReady, materialEvents, PRODUCT_NAME, selectDetectedChanges, SOURCE_NOT_FULLY_READ, sourcesNotFullyRead,
  validateRights,
} from './national-report.ts';
import type { LedgerProject, ReportableEvent, SourceHealth, View } from './national-report.ts';

/** A ledger event with the instant the ledger WROTE it. */
export type WrittenEvent = ReportableEvent & { created_at: string };

/** A stored report's row (the snapshot table), as the reader needs it. `body` is the permanent text; nothing private is on the row. */
export type StoredReport = { report_id: string; content_hash: string; report_version: string; generated_at: string; body: string };

/** The stored report is not a report this reader understands. Fail closed: never "no changes". */
export class ReportUnreadable extends Error {}

/** A ledger event row whose timestamps cannot be read. Fail closed: an event dropped for its date would read as "no change". */
export class EventRowUnreadable extends Error {}

/**
 * How far before the issue instant the ledger read reaches. Defined once. It must exceed the longest span between the report's ledger
 * read and its write plus the longest observation transaction (the observation tick is capped at 60 s); ten minutes is that with
 * a wide margin, and it costs nothing, because anything the report already showed is removed.
 */
export const SINCE_REPORT_OVERLAP_MS = 10 * 60 * 1000;

export const NEW_PROJECTS_NOT_COVERED = {
  code: 'NEW_PROJECTS_NOT_COVERED',
  text: 'This answer covers the projects that were in the report. A project that appeared near the property after the report is not part of it.',
};
export const RECORDED_AFTER_REPORT = {
  code: 'RECORDED_AFTER_REPORT',
  text: 'Some changes below were recorded by HomeSignal after the report was issued, from a source record that was retrieved before it. The report may already show the new state; compare with the report.',
};
export const SOURCES_NOT_INCLUDED_SINCE = {
  code: 'SOURCES_NOT_INCLUDED',
  text: 'Some projects in the report come from official sources that are not included in this answer.',
};

type ReportedProject = {
  project_id: string; source_family: string | null; name: unknown; type: unknown; lifecycle: unknown;
  source: { url?: unknown } | null; homesignal_detected_changes: Array<{ event_type: string; detected_at: string }>;
};

export type ParsedReport = { generated_at: string; projects: ReportedProject[] };

/**
 * The changes a stored project card already showed. Each must be an object with an event type and a readable instant: they are what
 * de-duplicates the answer against the report, so an element that cannot be read would silently stop de-duplicating. Refused instead.
 */
function detectedChangesOf(p: { homesignal_detected_changes?: unknown }): Array<{ event_type: string; detected_at: string }> {
  const raw = p.homesignal_detected_changes;
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new ReportUnreadable('a project\'s detected changes are not a list');
  return raw.map((c) => {
    if (!c || typeof c !== 'object' || Array.isArray(c) || typeof c.event_type !== 'string'
      || typeof c.detected_at !== 'string' || !Number.isFinite(Date.parse(c.detected_at))) {
      throw new ReportUnreadable('a detected change in the report cannot be read');
    }
    return { event_type: c.event_type, detected_at: c.detected_at };
  });
}

/** Read the permanent body. Anything that is not the national report's own shape is refused. */
export function parseStoredReport(stored: StoredReport): ParsedReport {
  if (!stored || typeof stored.body !== 'string') throw new ReportUnreadable('no body');
  if (!Number.isFinite(Date.parse(stored.generated_at))) throw new ReportUnreadable('no issue time');
  let body: any;
  try { body = JSON.parse(stored.body); } catch { throw new ReportUnreadable('body is not JSON'); }
  if (!body || typeof body !== 'object' || Array.isArray(body) || body.product !== PRODUCT_NAME) throw new ReportUnreadable('not a Development Activity report');
  if (!Array.isArray(body.projects)) throw new ReportUnreadable('no project list');
  const seen = new Set<string>();
  const projects: ReportedProject[] = [];
  for (const p of body.projects) {
    if (!p || typeof p !== 'object' || typeof p.project_id !== 'string' || !p.project_id) throw new ReportUnreadable('a project has no identity');
    if (seen.has(p.project_id)) throw new ReportUnreadable('a project appears twice');
    seen.add(p.project_id);
    projects.push({
      project_id: p.project_id,
      source_family: typeof p.source_family === 'string' ? p.source_family : null,
      name: p.name ?? null, type: p.type ?? null, lifecycle: p.lifecycle ?? null,
      source: p.source && typeof p.source === 'object' ? p.source : null,
      homesignal_detected_changes: detectedChangesOf(p),
    });
  }
  projects.sort((a, b) => (a.project_id < b.project_id ? -1 : 1));
  return { generated_at: stored.generated_at, projects };
}

/** The earliest `created_at` the ledger read must ask for. */
export function writtenSinceInstant(generatedAt: string): string {
  return new Date(Date.parse(generatedAt) - SINCE_REPORT_OVERLAP_MS).toISOString();
}

export type ChangesSinceReport = {
  product: string;
  answer: 'CHANGES_SINCE_REPORT';
  report: { report_id: string; report_version: string; issued_at: string; content_hash: string };
  as_of: string;
  through: string;
  projects_in_report: number;
  changed: Array<Record<string, unknown> & { project_id: string }>;
  excluded: { no_rights: Record<string, number>; not_change_ready: number };
  limitations: Array<{ code: string; text: string }>;
};

export type ChangesInput = {
  now: Date; view: View; rights: unknown; report: StoredReport; ledger: LedgerProject[]; events: WrittenEvent[]; health: SourceHealth[];
};

const instant = (s: unknown) => Date.parse(String(s));

export function changesSinceReport(input: ChangesInput): ChangesSinceReport {
  const { now, view, report } = input;
  if (view !== 'customer' && view !== 'internal') throw new Error('changesSinceReport: view must be customer or internal');
  const rights = validateRights(input.rights);
  const parsed = parseStoredReport(report);
  const cleared = new Map(rights.cleared.map((e) => [e.registry_id, e]));
  const ledger = new Map(input.ledger.map((l) => [l.identity_key, l]));
  const eventsByKey = new Map<string, WrittenEvent[]>();
  for (const e of input.events) {
    // an event whose instants cannot be read is refused, never dropped: a dropped event would read as "no change"
    if (!Number.isFinite(instant(e.created_at)) || !Number.isFinite(instant(e.observed_at))) throw new EventRowUnreadable('a ledger event has an unreadable time');
    if (!eventsByKey.has(e.identity_key)) eventsByKey.set(e.identity_key, []);
    eventsByKey.get(e.identity_key)!.push(e);
  }

  const issued = instant(parsed.generated_at);
  const lower = issued - SINCE_REPORT_OVERLAP_MS;
  const upper = now.getTime();

  const excluded = { no_rights: {} as Record<string, number>, not_change_ready: 0 };
  const changed: ChangesSinceReport['changed'] = [];
  const latest = new Map<string, string>();
  const familiesInAnswer = new Set<string>();
  let recordedAfterReport = false;

  for (const p of parsed.projects) {
    const family = p.source_family ?? '';
    const grant = cleared.get(family);
    if (!grant && view === 'customer') { excluded.no_rights[family || '(none)'] = (excluded.no_rights[family || '(none)'] ?? 0) + 1; continue; }
    if (family) familiesInAnswer.add(family);

    // what the report already showed for this project: the same instant and type are in its body
    const shown = new Set(p.homesignal_detected_changes.map((c) => instant(c.detected_at) + '|' + String(c.event_type)));
    const keep = (e: WrittenEvent) => {
      const written = instant(e.created_at);
      const observed = instant(e.observed_at);
      return written > lower && written <= upper && observed <= upper && !shown.has(observed + '|' + e.event_type);
    };
    const events = eventsByKey.get(p.project_id) ?? [];
    const led = ledger.get(p.project_id);
    const found = selectDetectedChanges(led, events, keep as (e: ReportableEvent) => boolean);
    if (found.length === 0) {
      if (!isChangeReady(led) && materialEvents(events, keep).length > 0) excluded.not_change_ready++;
      continue;
    }
    latest.set(p.project_id, String(found[0].observed_at));
    // the shared entry shape, plus when the ledger recorded the event and whether its source record predates the report
    const entries = (found as WrittenEvent[]).map((e) => {
      const retrievedBefore = instant(e.observed_at) <= issued;
      if (retrievedBefore) recordedAfterReport = true;
      return { ...detectedChangeEntries([e])[0], recorded_at: e.created_at, source_retrieved_before_report: retrievedBefore };
    });
    changed.push({
      project_id: p.project_id,
      name: p.name,
      source_family: p.source_family,
      type: p.type,
      lifecycle_at_report: p.lifecycle,
      source: { url: p.source && typeof p.source.url === 'string' ? p.source.url : null, attribution: grant ? (grant.attribution || null) : null },
      changes_since_report: entries,
      ...(view === 'internal' ? { rights: grant ? 'CLEARED' : 'HOLD' } : {}),
    });
  }
  changed.sort((a, b) => {
    const x = latest.get(a.project_id)!, y = latest.get(b.project_id)!;
    return x < y ? 1 : x > y ? -1 : a.project_id < b.project_id ? -1 : 1;
  });

  const limitations = [{ ...NEW_PROJECTS_NOT_COVERED }];
  if (recordedAfterReport) limitations.push({ ...RECORDED_AFTER_REPORT });
  if (Object.keys(excluded.no_rights).length > 0) limitations.push({ ...SOURCES_NOT_INCLUDED_SINCE });
  if (sourcesNotFullyRead(input.health, familiesInAnswer)) limitations.push({ ...SOURCE_NOT_FULLY_READ });

  return {
    product: PRODUCT_NAME,
    answer: 'CHANGES_SINCE_REPORT',
    report: { report_id: report.report_id, report_version: report.report_version, issued_at: parsed.generated_at, content_hash: report.content_hash },
    as_of: dayOf(now),
    through: now.toISOString(),
    projects_in_report: parsed.projects.length,
    changed,
    excluded,
    limitations,
  };
}
