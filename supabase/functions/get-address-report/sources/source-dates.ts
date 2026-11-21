// THE OTHER DATES A SOURCE GIVES A RECORD, carried beside the record date and never in place of it (report-accuracy-universal, 2026-11-19).
// The registry's `column_map` names which column holds each (all optional, all source-specific); this helper only reads them. What each date MEANS is the
// shared contract in supabase/functions/_shared/record-dates.ts:
//   source_created ... the day the agency created the record      source_updated ... the day it last MODIFIED the record (any edit)
//   status_updated ... the day its STATUS last changed (map only a column that says so)      milestone_dates ... [{ column, label, kind? }] agency steps
// A column that is absent, blank or not a day contributes nothing. Nothing here is a fingerprint input: it rides in the record's `source_dates` object, which the
// ledger does not read, so adding a column to a mapping manufactures no change event.
import type { ColumnMap, ColumnRef } from "./socrata.ts";

export interface SourceDatesOut { created?: string; updated?: string; status_updated?: string; milestones?: Array<{ label: string; date: string; kind: "planned" | "actual" | "unstated" }> }
type Read = (row: Record<string, unknown>, ref: ColumnRef | undefined) => unknown;
type Day = (v: unknown) => string | null;

export function sourceDatesField(row: Record<string, unknown>, cm: ColumnMap, readCol: Read, isoDay: Day): { source_dates?: SourceDatesOut } {
  const out: SourceDatesOut = {};
  const one = (ref: ColumnRef | undefined) => (ref ? isoDay(readCol(row, ref)) : null);
  const created = one(cm.source_created), updated = one(cm.source_updated), statusUpdated = one(cm.status_updated);
  if (created) out.created = created;
  if (updated) out.updated = updated;
  if (statusUpdated) out.status_updated = statusUpdated;
  const ms: NonNullable<SourceDatesOut["milestones"]> = [];
  for (const m of cm.milestone_dates ?? []) {
    const date = one(m.column);
    if (date && m.label) ms.push({ label: m.label, date, kind: m.kind === "planned" || m.kind === "actual" ? m.kind : "unstated" });
  }
  if (ms.length) out.milestones = ms;
  return Object.keys(out).length ? { source_dates: out } : {};
}
