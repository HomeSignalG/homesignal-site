// AN ISSUED PERMIT IS "APPROVED" — founder ruling 2026-10-20 (CLAUDE.md §7.12a), applied to a
// layer whose STATUS WORD does not change when the permit is issued.
//
// Phoenix's Planning_Permit layer carries four statuses (OPEN / DONE / EXPR / VOID). OPEN covers
// a permit from intake until final inspection, so a permit the city has already ISSUED (its own
// PER_ISSUE_DATE is filled) was mapped to "proposed" and drawn on Map 1 as an unapproved
// proposal. Measured 2026-10-20 on three cached Phoenix ZIP reports: 843 of 987, 425 of 537
// and 173 of 203 "proposed" Phoenix records carried an issue date, none in the future.
//
// The rule reads only the publisher's own issue-date column. It never infers issuance from a
// title, a type or a status word, and it fails closed: no date, an unparseable date, or a date
// after today + 1 day (the date-sanity tolerance, sources/date-sanity.ts) leaves the mapped
// bucket exactly as it was. It is OPT-IN per registry entry; an entry without
// `issued_promotes` is byte-for-byte unchanged.

export interface IssuedPromotes {
  /** Verbatim status values (case-insensitive, trimmed) that a dated issuance promotes. */
  statuses: string[];
  /** The publisher's own issue-date column. */
  column: string;
}

/** Bucket after the rule. `issuedIso` is the issue-date column already normalized to
 *  YYYY-MM-DD (or null); `todayIso` is today's UTC date. Only "proposed" is ever promoted. */
export function issuedPromotedBucket<B extends string>(
  rule: IssuedPromotes | undefined,
  statusRaw: string,
  bucket: B,
  issuedIso: string | null,
  todayIso: string,
): B | "approved" {
  if (!rule || bucket !== "proposed") return bucket;
  const s = statusRaw.trim().toLowerCase();
  if (!rule.statuses.some((x) => x.trim().toLowerCase() === s)) return bucket;
  if (!issuedIso || !/^\d{4}-\d{2}-\d{2}$/.test(issuedIso)) return bucket;
  const limit = new Date(todayIso + "T00:00:00Z");
  limit.setUTCDate(limit.getUTCDate() + 1);
  if (new Date(issuedIso + "T00:00:00Z") > limit) return bucket;
  return "approved";
}
