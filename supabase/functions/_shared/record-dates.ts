// WHAT A DATE ON A RECORD MEANS — one contract for every source (report-accuracy-universal, 2026-11-19).
//
// A source can give a record several different dates, and they are NOT interchangeable:
//   record date ...... the one date the registry maps to `submitted_at` (`file_date`). What it MEANS is declared by the registry's `file_date_basis`:
//                      `filing` (the source says it is the filing / application date) or `record_created` (the day the agency created the record in its
//                      own system). A basis that is not declared is `unstated`: the legacy behaviour (the kind's label) is kept, and the mapping is listed
//                      as a follow-up (scripts/audit-date-basis.mjs), never guessed.
//   source updated ... the day the agency last MODIFIED the record (any edit). It is not a project milestone and not a status change.
//   status updated ... the day the agency says the record's STATUS last changed, only where the registry maps a column that says so.
//   milestones ....... dates the agency gives for steps of the project (advertise, award, hearing ...), each kept with its own label.
//   last read ........ when HomeSignal last read the record (the ledger's last observation). It is never any of the above.
//
// Pure: no clock (`today` is passed), no source, place or agency name. The registry and the connector say what a field is; this module only validates and
// carries it. Nothing here changes a stored column: the dates ride in `app_projects.provenance.source_dates` (docs/report-accuracy-universal-2026-11-19.md).
/** Plain UTC day arithmetic (national-report.ts has the same; it is not imported here because that module imports this one). */
function addDays(day: string, n: number): string {
  const d = new Date(day + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export const DATE_BASES = ['filing', 'record_created'] as const;
export type DateBasis = typeof DATE_BASES[number] | 'unstated';
export const MILESTONE_KINDS = ['planned', 'actual', 'unstated'] as const;
export type MilestoneKind = typeof MILESTONE_KINDS[number];
export type Milestone = { label: string; date: string; kind: MilestoneKind };
export type SourceDates = { created?: string; updated?: string; status_updated?: string; milestones?: Milestone[] };

/** The label of the record date when the registry gives none: filing is the legacy label of a `filed` kind, a creation date is never called a filing. */
export const BASIS_LABELS: Readonly<Record<'filing' | 'record_created', string>> = Object.freeze({ filing: 'Filed', record_created: 'Record created' });

export const SOURCE_DATE_FLOOR = '1990-01-01';
const MAX_MILESTONES = 6;
const MAX_LABEL = 60;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const validDay = (v: unknown): v is string => typeof v === 'string' && DAY.test(v) && !Number.isNaN(Date.parse(v + 'T00:00:00Z'));
/** A date a source stated is shown only when it is a real day inside the product's window: a sentinel (1900, 9999) or a day after today is dropped, never shown. */
const realDay = (v: unknown, today: string, allowFutureDays = 0): v is string =>
  validDay(v) && v >= SOURCE_DATE_FLOOR && v <= addDays(today, allowFutureDays);

export function dateBasisOf(v: unknown): DateBasis {
  return (DATE_BASES as readonly string[]).includes(v as string) ? (v as DateBasis) : 'unstated';
}

/** The source dates a record carries (provenance.source_dates, written by the ingest), validated. null when there are none: a date is never invented. */
export function sourceDatesOf(provenance: unknown, today: string): SourceDates | null {
  const raw = provenance && typeof provenance === 'object' ? (provenance as Record<string, unknown>).source_dates : null;
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const out: SourceDates = {};
  if (realDay(r.created, today)) out.created = r.created;
  if (realDay(r.updated, today)) out.updated = r.updated;
  if (realDay(r.status_updated, today)) out.status_updated = r.status_updated;
  if (Array.isArray(r.milestones)) {
    const ms: Milestone[] = [];
    for (const m of r.milestones) {
      if (!m || typeof m !== 'object') continue;
      const mm = m as Record<string, unknown>;
      const label = typeof mm.label === 'string' ? mm.label.trim().slice(0, MAX_LABEL) : '';
      // a milestone may be planned for a later day, so a future day is allowed (never a sentinel); its kind is what the registry declared, else unstated
      if (!label || !realDay(mm.date, today, 3650)) continue;
      ms.push({ label, date: mm.date, kind: (MILESTONE_KINDS as readonly string[]).includes(mm.kind as string) ? (mm.kind as MilestoneKind) : 'unstated' });
      if (ms.length >= MAX_MILESTONES) break;
    }
    if (ms.length) out.milestones = ms;
  }
  return Object.keys(out).length ? out : null;
}
