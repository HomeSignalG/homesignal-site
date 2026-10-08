// PROPERTY WATCH — what is new near a watched property, and what an email may say about it (Development Activity build step 9;
// docs/development-activity-watch-2026-10-03.md). PURE: it reads no environment, calls no network and holds no client. The daily job hands
// it what the database returned.
//
// IT DECIDES NOTHING THAT ALREADY HAS AN OWNER.
//   which projects are near the property ... _shared/report-run.ts (the report's own reads) and `assemble` (national-report.ts): the nearby
//                                            set is the projects a NEW report for the same point would show to a customer
//   what a detected change is ................ national-report.ts `selectDetectedChanges`, through changes-since-report.ts `changesForProjects`:
//                                            the SAME function the report and Changes Since Report ask, over the same ledger view
//   when a change counts as "since" ........... changes-since-report.ts `changesForProjects`: created_at, the overlap, de-duplication against
//                                            what the stored report already showed. Not restated here.
//   which sources may be named ................ _shared/report-rights.json, read now
// What this file owns is the two things only a watch has:
//   1. THE STARTING POINT is the stored report, so nothing falls between "the report" and "the watch": the first check reports everything the
//      ledger recorded after the report. A project that is near the property now but was not in the report is covered by the same boundary.
//   2. EXACTLY ONCE, as far as a retried job allows: a change the agent was already told about is removed, and what an email lists is exactly
//      what is recorded as told (`selectForEmail`), so a cap on the email cannot silently lose a change — what does not fit stays unreported
//      and rolls into the next email.
//
// THE NEARBY PROJECTS' OWN `homesignal_detected_changes` ARE DELIBERATELY NOT USED to de-duplicate. They are the CURRENT 90-day window — the
// very changes being looked for — so treating them as "already shown" would erase every new change. What the report already showed is the
// STORED report's list, for the same project.
//
// NO PRIVATE VALUE ENTERS OR LEAVES. It is given no address, no label and no point; it returns project facts (public records) and the
// instants the ledger recorded them. A distance or bearing from the property would recover the property, so none is computed.
import { changesForProjects, parseStoredReport, ReportUnreadable, writtenSinceInstant } from './changes-since-report.ts';
import type { ReportedProject, StoredReport, WrittenEvent } from './changes-since-report.ts';
import { RECENT_DAYS } from './national-report.ts';
import type { LedgerProject, SourceHealth } from './national-report.ts';

export { ReportUnreadable };

/** What one email may list. A project's detail and an entry's detail are both capped; what does not fit rolls into the next email. */
export const MAX_PROJECTS_PER_EMAIL = 10;
export const MAX_ENTRIES_PER_PROJECT = 5;

/** The ledger's three event types (its event_type column), the only values the told-about table accepts. */
export const EVENT_TYPES = ['first_detected', 'status_changed', 'source_record_updated'] as const;

/** One thing the agent has been told, as the database stores it. `observed_at` keeps the ledger's own text; comparison is by instant. */
export type SeenKey = { project_id: string; event_type: string; observed_at: string };

export const seenKey = (k: SeenKey): string => k.project_id + '|' + k.event_type + '|' + Date.parse(k.observed_at);

export type WatchEntry = {
  event_type: string;
  detected_at: string;
  recorded_at: string;
  publisher_event: { kind: string; date: string | null } | null;
  changes: Array<{ field: string; from: unknown; to: unknown }>;
};
export type WatchChange = {
  project_id: string;
  name: unknown;
  type: unknown;
  source: { url: string | null; attribution: string | null };
  entries: WatchEntry[];
};

export type WatchCheck = {
  /** every change the agent has not been told about, newest project first */
  changes: WatchChange[];
  /** one or more official sources near the property could not be fully read recently: silence is a weaker answer */
  partial: boolean;
  /** how many projects a new report for this point would show: a control for the caller's log, never a claim */
  nearby: number;
};

export type CheckInput = {
  now: Date;
  rights: unknown;
  /** the stored report this watch started from: its permanent body and issue time, never its private context */
  original: Pick<StoredReport, 'generated_at' | 'body'>;
  /** `assemble(...).intelligence.projects` for the watched point NOW, customer view */
  nearby: unknown[];
  ledger: LedgerProject[];
  /** material events the ledger recorded after the report, for the nearby projects (change-reads.ts `eventsWrittenSince`) */
  events: WrittenEvent[];
  health: SourceHealth[];
  seen: SeenKey[];
};

/** The earliest `created_at` the ledger read must ask for: the report's own boundary, but never further back than the report's window. */
export function lookBackInstant(originalGeneratedAt: string, now: Date): string {
  const reportBoundary = Date.parse(writtenSinceInstant(originalGeneratedAt));
  const window = now.getTime() - RECENT_DAYS * 24 * 60 * 60 * 1000;
  return new Date(Math.max(reportBoundary, window)).toISOString();
}

/** A project as the nearby list carries it. Anything that cannot be read is refused: a project dropped for its shape would read as "no change". */
function asReported(p: unknown, shownBy: Map<string, ReportedProject['homesignal_detected_changes']>): ReportedProject {
  const x = p as Record<string, unknown> | null;
  if (!x || typeof x !== 'object' || typeof x.project_id !== 'string' || !x.project_id) throw new ReportUnreadable('a nearby project has no identity');
  const src = x.source && typeof x.source === 'object' ? (x.source as { url?: unknown }) : null;
  return {
    project_id: x.project_id,
    source_family: typeof x.source_family === 'string' ? x.source_family : null,
    name: x.name ?? null, type: x.type ?? null, lifecycle: x.lifecycle ?? null,
    source: src,
    // what the STORED report showed for this project, never what the nearby list says now (see the header)
    homesignal_detected_changes: shownBy.get(x.project_id) ?? [],
  };
}

export function checkWatch(i: CheckInput): WatchCheck {
  const original = parseStoredReport(i.original);
  const shownBy = new Map(original.projects.map((p) => [p.project_id, p.homesignal_detected_changes]));
  const seen = new Set(i.seen.map(seenKey));
  const seenProjects = new Set<string>();
  const nearby: ReportedProject[] = [];
  for (const p of i.nearby) {
    const r = asReported(p, shownBy);
    if (seenProjects.has(r.project_id)) throw new ReportUnreadable('a nearby project appears twice');
    seenProjects.add(r.project_id);
    nearby.push(r);
  }
  const core = changesForProjects({
    now: i.now, view: 'customer', rights: i.rights, issuedAt: original.generated_at, projects: nearby,
    ledger: i.ledger, events: i.events, health: i.health,
  });
  const changes: WatchChange[] = [];
  for (const c of core.changed) {
    const entries = (c.changes_since_report as WatchEntry[]).filter((e) =>
      (EVENT_TYPES as readonly string[]).includes(e.event_type)
      && !seen.has(seenKey({ project_id: c.project_id, event_type: e.event_type, observed_at: e.detected_at })));
    if (!entries.length) continue;
    changes.push({
      project_id: c.project_id, name: c.name, type: c.type,
      source: c.source as WatchChange['source'],
      entries,
    });
  }
  return { changes, partial: core.flags.sourcesNotFullyRead, nearby: nearby.length };
}

export type EmailSelection = {
  /** what the email lists, in detail */
  listed: WatchChange[];
  /** EXACTLY the entries in `listed`: what is recorded as told once the email is accepted */
  told: SeenKey[];
  /** what did not fit, which stays unreported and will be in a later email */
  remaining: { projects: number; entries: number };
};

/** What one email carries. `told` is derived from `listed` and from nothing else, so the two cannot disagree. */
export function selectForEmail(changes: WatchChange[]): EmailSelection {
  const listed: WatchChange[] = [];
  const told: SeenKey[] = [];
  let remainingEntries = 0;
  let remainingProjects = 0;
  for (const c of changes) {
    if (listed.length >= MAX_PROJECTS_PER_EMAIL) { remainingProjects++; remainingEntries += c.entries.length; continue; }
    const shown = c.entries.slice(0, MAX_ENTRIES_PER_PROJECT);
    remainingEntries += c.entries.length - shown.length;
    listed.push({ ...c, entries: shown });
    for (const e of shown) told.push({ project_id: c.project_id, event_type: e.event_type, observed_at: e.detected_at });
  }
  return { listed, told, remaining: { projects: remainingProjects, entries: remainingEntries } };
}
