// sources/scope-members.ts — WIDENED-ONLY POLYGON CONTAINMENT for the ZIP-mode spatial scope.
//
// WHY (docs/zip-scope-bounds-runbook.md, docs/geographic-coverage-audit-2026-10-10.md)
// The scope of a radius-scoped source is   legacy centroid scope  ∪  polygon bounding box.
// The box is a PREFILTER. A record that lies in the box but OUTSIDE the ZIP polygon belongs to a
// neighbouring ZIP, and storing it here is a cross-ZIP publication (it inflates this ZIP's
// development count and its cached sites). So records added SOLELY by the widening are tested
// against the canonical polygon and only members are kept. Records the legacy scope already
// included are never tested and never dropped: OFF-mode behaviour is a subset of ON-mode.
//
// ONE AUTHORITY: membership is decided by public.zip_scope_members (docs/zip-scope-members.sql),
// a batch wrapper over geo.zip_point_membership_in. This module holds no geometry and no
// membership rule; it classifies (legacy vs widened-only), batches, validates and counts.
//
// FAIL-SAFE: anything that stops membership being KNOWN (RPC error, wrong/short answer, too many
// candidates, scan limit) throws ScopeMembershipError. The connector then re-runs the LEGACY scope
// for that source — never an unfiltered widened result — and says so in `legacy_fallback`.
// A record whose own coordinates cannot be tested is EXCLUDED when it is widened-only (nothing is
// invented) and counted as `unresolved_excluded`.


export type Verdict = "member" | "outside" | "not_measured" | "no_coordinates";
const VERDICTS: ReadonlySet<string> = new Set(["member", "outside", "not_measured", "no_coordinates"]);

/** Tests [lat,lng] pairs against ONE ZIP's polygon. Same length/order out as in. Throws on any failure. */
export type MembershipFn = (pts: ReadonlyArray<readonly [number, number]>) => Promise<Verdict[]>;

/** Points per RPC call (the SQL function allows 1000). */
export const MEMBERSHIP_BATCH = 500;
/** Widened-only candidates tested per source fetch. More than this ⇒ legacy scope (bounded cost). */
export const MAX_WIDENED_CANDIDATES = 10_000;
/** Rows SCANNED (fetched, before polygon filtering) per source fetch = this × max_rows. */
export const SCAN_FACTOR = 4;

export class ScopeMembershipError extends Error {
  reason: "rpc_error" | "incomplete_answer" | "candidate_limit" | "scan_limit";
  constructor(reason: "rpc_error" | "incomplete_answer" | "candidate_limit" | "scan_limit", detail: string) {
    super(`${reason}: ${detail}`);
    this.reason = reason;
  }
}

/** Separate counters — none of them is a "dropped" count, and none triggers an incomplete-fetch flag. */
export interface ScopeMetrics {
  /** records added solely by the widening that were tested against the polygon */
  widened_candidates: number;
  /** …of which inside the polygon and KEPT (the recovery) */
  members_recovered: number;
  /** …of which outside the polygon and intentionally EXCLUDED (correct, not a loss) */
  outside_excluded: number;
  /** …whose own coordinates/boundary could not be tested; EXCLUDED, nothing invented */
  unresolved_excluded: number;
  /** returned by the widened query but with no resolvable point; kept (the legacy query would have) */
  no_point_kept: number;
  rpc_calls: number;
  rpc_failures: number;
  /** rows fetched before polygon filtering (what the scan limit bounds) */
  rows_scanned: number;
  /** kept rows exceeded max_rows (capacity), counted AFTER polygon filtering */
  capacity_truncated: boolean;
  /** non-null ⇒ the report is the LEGACY-scope result and why */
  legacy_fallback: null | "membership_error" | "candidate_limit" | "scan_limit" | "capacity_overflow";
}

export function newScopeMetrics(): ScopeMetrics {
  return {
    widened_candidates: 0, members_recovered: 0, outside_excluded: 0, unresolved_excluded: 0,
    no_point_kept: 0, rpc_calls: 0, rpc_failures: 0, rows_scanned: 0,
    capacity_truncated: false, legacy_fallback: null,
  };
}

export type RowClass =
  | { cls: "legacy" }
  | { cls: "no_point" }
  | { cls: "widened"; lat: number; lng: number };

/** Classify a point against the LEGACY circle (Socrata within_circle / CSV radius). Planar miles, the
 *  engine's standard approximation, with a 2% tolerance that errs toward LEGACY (kept, untested). */
export function classifyByCircle(
  lat: number | null, lng: number | null, centroid: { lat: number; lng: number }, radiusMi: number,
): RowClass {
  if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) return { cls: "no_point" };
  const n = (lat - centroid.lat) * 69.0;
  const e = (lng - centroid.lng) * 69.0 * Math.cos((centroid.lat * Math.PI) / 180);
  return Math.hypot(e, n) <= radiusMi * 1.02 ? { cls: "legacy" } : { cls: "widened", lat, lng };
}

/**
 * Keep every legacy / no-point row and only the polygon MEMBERS among widened-only rows.
 * Order is preserved. Throws ScopeMembershipError (never returns a partial result).
 */
export async function keepMembers<T>(
  rows: readonly T[], classify: (r: T) => RowClass, member: MembershipFn, m: ScopeMetrics,
  onMember?: (r: T) => void,
): Promise<T[]> {
  const cls = rows.map(classify);
  const idx: number[] = [];
  cls.forEach((c, i) => { if (c.cls === "widened") idx.push(i); });
  const verdictAt = new Map<number, Verdict>();
  for (let s = 0; s < idx.length; s += MEMBERSHIP_BATCH) {
    if (m.widened_candidates + Math.min(MEMBERSHIP_BATCH, idx.length - s) > MAX_WIDENED_CANDIDATES) {
      throw new ScopeMembershipError("candidate_limit", `more than ${MAX_WIDENED_CANDIDATES} widened-only candidates`);
    }
    const chunk = idx.slice(s, s + MEMBERSHIP_BATCH);
    const pts = chunk.map((i) => { const c = cls[i] as { lat: number; lng: number }; return [c.lat, c.lng] as const; });
    let out: Verdict[];
    m.rpc_calls++;
    try { out = await member(pts); }
    catch (e) {
      m.rpc_failures++;
      throw e instanceof ScopeMembershipError ? e : new ScopeMembershipError("rpc_error", (e as Error).message);
    }
    if (!Array.isArray(out) || out.length !== chunk.length || !out.every((v) => VERDICTS.has(v))) {
      m.rpc_failures++;
      throw new ScopeMembershipError("incomplete_answer", `expected ${chunk.length} verdicts`);
    }
    m.widened_candidates += chunk.length;
    chunk.forEach((i, k) => verdictAt.set(i, out[k]));
  }
  const kept: T[] = [];
  rows.forEach((r, i) => {
    const c = cls[i];
    if (c.cls === "legacy") { kept.push(r); return; }
    if (c.cls === "no_point") { m.no_point_kept++; kept.push(r); return; }
    const v = verdictAt.get(i);
    if (v === "member") { m.members_recovered++; onMember?.(r); kept.push(r); }
    else if (v === "outside") m.outside_excluded++;
    else m.unresolved_excluded++;
  });
  return kept;
}

// deno-lint-ignore no-explicit-any
type Rpc = { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: any; error: { message: string } | null }> };

/** MembershipFn backed by public.zip_scope_members for one ZIP. Validates correspondence strictly. */
export function zipMembershipRpc(db: Rpc, zip: string): MembershipFn {
  return async (pts) => {
    const { data, error } = await db.rpc("zip_scope_members", { p_zip: zip, p_pts: pts.map((p) => [p[0], p[1]]) });
    if (error) throw new ScopeMembershipError("rpc_error", error.message);
    if (!Array.isArray(data) || data.length !== pts.length) {
      throw new ScopeMembershipError("incomplete_answer", `got ${Array.isArray(data) ? data.length : "non-array"} rows for ${pts.length} points`);
    }
    return data.map((r: { ord?: number; verdict?: string }, i: number) => {
      if (r?.ord !== i + 1 || !VERDICTS.has(String(r?.verdict))) {
        throw new ScopeMembershipError("incomplete_answer", `row ${i + 1} out of order or unknown verdict`);
      }
      return r.verdict as Verdict;
    });
  };
}

/** Recovery provenance carried on a record kept ONLY because the polygon widening reached it (never on a
 *  record the legacy scope already returned). The change ledger reads it from the cached `sites` to tell
 *  "historical records newly visible because coverage improved" from genuine new filings
 *  (docs/dev-change-recovery.sql). It is provenance, not a decision: nothing here reads it. */
export const SCOPE_ORIGIN_MEMBER = "polygon_member" as const;
export type ScopeOrigin = typeof SCOPE_ORIGIN_MEMBER;
export const SCOPE_ORIGIN_KEY = "__scope_origin";

/** Widening is only allowed when BOTH the polygon bounds AND a way to test membership exist. */
export function widenedBounds<B>(bounds: B | null | undefined, member: MembershipFn | null | undefined): B | null {
  return bounds && member ? bounds : null;
}
