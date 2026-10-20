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
// 1669-01-01-SU with Effective_ 9999-09-09 (a `decided` date), shown on 6 ZIP pages.
//
// PLACEHOLDER HORIZON (Massachusetts pre-launch, 2026-10-20). Every OTHER date kind is refused only
// when it is more than PLACEHOLDER_HORIZON_DAYS (20 years) ahead: no real schedule reaches that far,
// so such a value is a publisher's "date not set" placeholder. Measured on app_projects 2026-10-20,
// every future development date nationally: real schedules end at 2042-07-07 (WSDOT; NH's ten-year
// plan reaches 2040), nothing is dated 2043-2049, then 341 MassDOT design projects all carry
// ScheduledAdDate 2050-10-01/02 (on 537 of 627 Massachusetts ZIP pages) and one Champaign IL
// special-use permit carries decided 9999. 20 years sits between 2042 and 2050 and names no source.
// The Illinois note above called 2050-10-02 a real plan; ruled a placeholder by the founder 2026-10-20
// (all 341 MassDOT design projects share it, and nothing real is dated 2043-2049).

const IMPOSSIBLE_IF_FUTURE = new Set(["filed", "issued"]);
export const PLACEHOLDER_YEAR_FROM = "2100-01-01";
export const PLACEHOLDER_HORIZON_DAYS = 7305;

/** `today` is YYYY-MM-DD (UTC). Returns the latest acceptable filing/issue day, today + 1. */
export function latestPlausibleFilingDay(today: string): string {
  const d = new Date(today + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** `today` is YYYY-MM-DD (UTC). Returns the latest acceptable date of any other kind. */
export function latestPlausibleScheduledDay(today: string): string {
  const d = new Date(today + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + PLACEHOLDER_HORIZON_DAYS);
  return d.toISOString().slice(0, 10);
}

/**
 * For each record whose file_date_kind is filed/issued and whose file_date is after today + 1 day,
 * or whose file_date of any kind is in year 2100 or later (PLACEHOLDER_YEAR_FROM), or whose file_date
 * (any other kind) is more than PLACEHOLDER_HORIZON_DAYS ahead, set file_date to
 * null and keep the refused value in `file_date_refused`. Every other record, and every other field,
 * is returned unchanged. Pure: no I/O, no clock of its own.
 */
export function refuseFutureFilingDates<T extends Record<string, unknown>>(rows: T[], today: string): T[] {
  const filingLimit = latestPlausibleFilingDay(today);
  const placeholderLimit = latestPlausibleScheduledDay(today);
  return rows.map((r) => {
    const kind = String(r.file_date_kind ?? "");
    const fd = r.file_date == null ? "" : String(r.file_date).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fd)) return r;
    if (fd >= PLACEHOLDER_YEAR_FROM) return { ...r, file_date: null, file_date_refused: fd };
    const limit = IMPOSSIBLE_IF_FUTURE.has(kind) ? filingLimit : placeholderLimit;
    if (fd <= limit) return r;
    return { ...r, file_date: null, file_date_refused: fd };
  });
}
