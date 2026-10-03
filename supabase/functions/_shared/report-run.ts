// THE CANONICAL READS A REPORT IS BUILT FROM — moved here from get-development-activity-report/handler.ts so that the report and the
// Watch (docs/development-activity-watch-2026-10-03.md) ask the database the same questions in the same order and in the same words
// (CLAUDE.md "one canonical truth path"). A watch that re-implemented "which projects are near this point, and what does the ledger say
// about them" would be a second way to decide what a report shows; this is the one.
//
//   1. the projects near a point        public.n5_projects_within_radius (the canonical spatial read, behind `radius`)
//   2. what each project is             public.app_projects (behind `hydrate`)
//   3. what the ledger knows of it      public.dev_change_project and public.dev_change_event_reportable (behind `ledger` and `events`)
//   4. whether its source could be read public.dev_change_source_fetch_health (behind `health`)
// and then `assemble` (national-report.ts) turns them into a report. This file makes NO decision about what a report says: it only
// orders the reads. Everything external arrives through `reads`, so it is as pure as its callers' fakes.
import { addDays, dayOf, RECENT_DAYS } from './national-report.ts';
import type { LedgerProject, ProjectRow, RadiusRow, ReportableEvent, SourceHealth } from './national-report.ts';

/** The five reads a report needs. The report function's `Deps` and the Watch's data layer both provide exactly these. */
export type ReportReads = {
  radius: (lat: number, lng: number, radiusMi: number) => Promise<RadiusRow[]>;
  hydrate: (keys: string[]) => Promise<ProjectRow[]>;
  ledger: (keys: string[]) => Promise<LedgerProject[]>;
  events: (keys: string[], sinceDay: string) => Promise<ReportableEvent[]>;
  health: (families: string[]) => Promise<SourceHealth[]>;
};

export type ReportInputs = {
  rows: RadiusRow[]; projects: ProjectRow[]; ledger: LedgerProject[]; events: ReportableEvent[]; health: SourceHealth[];
};

/**
 * Read everything `assemble` needs for the area around a point. The order is the report's: the area first (a refused read is an error,
 * never "nothing nearby"), then the project rows, the ledger and the recent events together, then the health of the families found.
 */
export async function readReportInputs(
  reads: ReportReads, at: { lat: number; lng: number; radiusMi: number; now: Date },
): Promise<ReportInputs> {
  const rows = await reads.radius(at.lat, at.lng, at.radiusMi);
  const keys = [...new Set(rows.map((r) => r.source_key))].sort();
  const since = addDays(dayOf(at.now), -RECENT_DAYS);
  const [projects, ledger, events] = await Promise.all([
    reads.hydrate(keys), reads.ledger(keys), reads.events(keys, since),
  ]);
  const families = [...new Set(projects.map((p) => p.registry_id).filter((f): f is string => !!f))].sort();
  const health = families.length ? await reads.health(families) : [];
  return { rows, projects, ledger, events, health };
}
