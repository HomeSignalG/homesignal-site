// A filing or issue date in the future is impossible; the record stays, the date does not (2026-10-20).
//
// WHY. Measured on app_projects 2026-10-20 (control: 2,741,263 dated development rows): 306 source
// records carried an ISSUED date after today across 6 sources (bend-or-permit-applications,
// bentonville-catalyst-permits, brunswick-county-permits, murfreesboro-building-permits,
// new-hanover-county-building-permits, thurston-county-residential-permits) and 12 carried a FILED one
// (lake-county-il-construction-program, lee-county-fl-development-orders). The Oregon case read at the
// source: Bend BP20-877, a Mechanical permit, IssueDate 2033-10-20. Such a date sorts first as
// "newest", passes every recency window and would lead a date-first post. The publisher's other
// facts are still real, so the record is kept and only the date is withheld.
//
// SCOPE. Only `filed` and `issued` dates. `scheduled`, `estimated`, `decided` and `hearing` dates are
// routinely in the future (a STIP letting year, a hearing next month) and are never touched.
// One day of tolerance absorbs a publisher whose clock runs ahead of UTC.
//
// PLACEHOLDER YEARS (2026-10-20, Illinois pre-launch). A date in year 2100 or later is a
// placeholder whatever its kind, and is withheld the same way. Measured on app_projects that day:
// 6 development rows nationally carried one, all City of Champaign IL special use permit
// 1669-01-01-SU with Effective_ 9999-09-09 (a `decided` date, which the rule above never touches),
// shown on 6 ZIP pages. The latest real far-future date was a `scheduled` 2050-10-02 (20,805
// scheduled rows are more than 10 years out, so a shorter horizon would drop real plans).

const IMPOSSIBLE_IF_FUTURE = new Set(["filed", "issued"]);
export const PLACEHOLDER_YEAR_FROM = "2100-01-01";

/** `today` is YYYY-MM-DD (UTC). Returns the latest acceptable filing/issue day, today + 1. */
export function latestPlausibleFilingDay(today: string): string {
  const d = new Date(today + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * For each record whose file_date_kind is filed/issued and whose file_date is after today + 1 day,
 * or whose file_date of any kind is in year 2100 or later (PLACEHOLDER_YEAR_FROM),
 * set file_date to null and keep the refused value in `file_date_refused`. Every other record, and
 * every other field, is returned unchanged. Pure: no I/O, no clock of its own.
 */
export function refuseFutureFilingDates<T extends Record<string, unknown>>(rows: T[], today: string): T[] {
  const limit = latestPlausibleFilingDay(today);
  return rows.map((r) => {
    const kind = String(r.file_date_kind ?? "");
    const fd = r.file_date == null ? "" : String(r.file_date).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fd)) return r;
    const placeholder = fd >= PLACEHOLDER_YEAR_FROM;
    if (!placeholder && (!IMPOSSIBLE_IF_FUTURE.has(kind) || fd <= limit)) return r;
    return { ...r, file_date: null, file_date_refused: fd };
  });
}
