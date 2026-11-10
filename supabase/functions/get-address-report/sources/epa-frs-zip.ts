// sources/epa-frs-zip.ts — EPA FRS retrieval for a WHOLE ZIP (ZIP mode only).
//
// WHY THIS EXISTS (2026-11-09, Phoenix 85083 audit)
// ZIP mode asked FRS for ONE circle: 3 mi around the stored ZIP point (development_reports.home_lat/lng,
// a pinned ZIP centre), then dropped every row farther than 3 mi, kept the nearest 40, and only at READ
// time (public.zip_mode_report_sites) asked which of those 40 lie inside the ZIP. Map 1's ZIP boundary
// decided membership, but it could only ever choose from what the circle had fetched. 85083 is 19.9 sq mi
// and its stored point sits near the east edge: the circle covered 64.6% of the ZIP, FRS held 18 facilities
// inside the boundary from that point (31 from the boundary's centre), and the page served 3.
// The EPA call had taken (point, radius) since #113 (2026-07-04); the polygon-bbox scope of #1794 was only
// ever wired into the permit connectors, never into this plane.
//
// THE RULE HERE
//   * Retrieval covers the ZIP's canonical polygon (its bounding box, from public.zip_scope_bounds — the one
//     copy of ZIP geometry the engine reads). FRS only answers point/radius queries, so the box is covered
//     by circles: one circle circumscribing the box, split into four whenever FRS refuses a circle as too
//     large (its process limit). A refused circle is never SHRUNK in place — shrinking leaves a gap, which
//     is how the address ladder undercounts — it is replaced by four circles that together cover it.
//   * Every tile must answer. Any tile that fails (transient after retries, schema, deadline, too many
//     tiles) makes the WHOLE outcome ok:false. A partial inventory is never returned as complete, and
//     ok:false is the single field public.dev_epa_write_refused() reads, so the stored layer is kept and
//     the count shows as unknown.
//   * Rows from overlapping circles are de-duplicated by FRS RegistryId.
//   * Final inclusion is the ZIP polygon (public.zip_scope_members → geo.zip_point_membership_in, the same
//     boundary-inclusive predicate Map 1 serves through). Every in-ZIP facility is kept: there is no
//     count cap. Nothing outside the ZIP is kept, and nothing inside it is dropped for space.
//   * The stored ZIP point is not used here at all: it neither centres the search nor decides inclusion.
//
// Address mode (a user's address + radius) does not use this module and is unchanged.

import {
  FRS_ATTEMPT_TIMEOUT_MS,
  FRS_RETRY_BACKOFF_MS,
  frsAt,
  type FrsAttempt,
  type FrsErrorDiag,
} from "./epa-frs.ts";
import type { ZipBounds } from "./scope-box.ts";
import type { MembershipFn, Verdict } from "./scope-members.ts";

type FetchLike = (input: string, init?: unknown) => Promise<Response>;

/** A circle no smaller than this is ever requested; a refusal below it fails the ZIP (ok:false). */
export const FRS_TILE_MIN_RADIUS_MI = 0.25;
/**
 * A circle that answers with this many rows or more is treated as possibly cut short and is split, never
 * trusted as complete. FRS's process limit refuses large circles, but the largest ok answer seen in
 * production (479 refresh responses, 2026-11-09) was exactly 1,000 rows, so an answer at 1,000 cannot be
 * told apart from a silent cut. Splitting costs requests, never coverage.
 */
export const FRS_TILE_ROW_CEILING = 1000;
/** Upper bound on FRS requests for one ZIP (tiles + retries). Exceeding it fails the ZIP (ok:false). */
export const FRS_ZIP_MAX_REQUESTS = 64;
const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export type ZipFrsReason = "transient" | "deadline" | "schema" | "process_limit" | "saturated" | "request_limit";

/**
 * Stored in development_reports.counts.facilities_coverage when, and only when, this read covered the
 * whole ZIP boundary and every circle answered (epa.ok, mode zip_boundary, complete). The collector
 * stores the engine's counts object as sent on an accepted EPA write, so this needs no SQL change.
 * Its ABSENCE means the stored facility list is not known to be complete: a radius-era list, a failed
 * read, or a ZIP with no boundary. Never inferred from a count or a timestamp.
 */
export const ZIP_FACILITY_COVERAGE = "zip_boundary_v1";
export function facilityCoverage(epa: Record<string, unknown>): string | null {
  return epa.ok === true && epa.mode === "zip_boundary" && epa.complete === true ? ZIP_FACILITY_COVERAGE : null;
}

export interface ZipFrsOutcome {
  ok: boolean;
  /** de-duplicated FRS rows from every answered circle; empty when ok is false */
  rows: Record<string, unknown>[];
  reason: ZipFrsReason | null;
  attempts: number;
  failures: string[];
  /** circles that answered (observability) */
  tiles: number;
  /** radius of the first, box-circumscribing circle */
  cover_radius_mi: number;
  /** rows returned before de-duplication across overlapping circles */
  raw_rows: number;
  /** DIAGNOSTIC ONLY: thrown-error details for failed attempts, at most DIAG_MAX, never read by a decision. */
  diag?: ZipFrsDiag[];
}
export type ZipFrsDiag = FrsErrorDiag & { attempt: number; since_prev_ms: number | null };
export const DIAG_MAX = 8;

export interface ZipFrsOptions {
  deadlineAt?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  maxRequests?: number;
}

/** Miles between two points (planar, the engine's standard approximation at ZIP scale). */
export function milesBetween(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const n = (lat2 - lat1) * 69.0;
  const e = (lng2 - lng1) * 69.0 * Math.cos((((lat1 + lat2) / 2) * Math.PI) / 180);
  return Math.hypot(e, n);
}

/** Centre of a box and the radius (miles, rounded UP to 0.01, +1%) of the circle that contains all of it. */
export function circumCircle(b: ZipBounds): { lat: number; lng: number; radiusMi: number } {
  const lat = (b.ymin + b.ymax) / 2, lng = (b.xmin + b.xmax) / 2;
  // The farthest point of a box from its centre is a corner; test all four (the scale factor varies with lat).
  const r = Math.max(
    milesBetween(lat, lng, b.ymin, b.xmin), milesBetween(lat, lng, b.ymin, b.xmax),
    milesBetween(lat, lng, b.ymax, b.xmin), milesBetween(lat, lng, b.ymax, b.xmax),
  );
  return { lat, lng, radiusMi: Math.ceil(r * 1.01 * 100) / 100 };
}

/** The four quarters of a box; together they are exactly the box. */
export function splitBox(b: ZipBounds): ZipBounds[] {
  const mx = (b.xmin + b.xmax) / 2, my = (b.ymin + b.ymax) / 2;
  return [
    { xmin: b.xmin, ymin: b.ymin, xmax: mx, ymax: my },
    { xmin: mx, ymin: b.ymin, xmax: b.xmax, ymax: my },
    { xmin: b.xmin, ymin: my, xmax: mx, ymax: b.ymax },
    { xmin: mx, ymin: my, xmax: b.xmax, ymax: b.ymax },
  ];
}

function rowKey(r: Record<string, unknown>): string {
  const rid = String(r.RegistryId ?? r.RegistryID ?? "").trim();
  if (rid) return `rid:${rid}`;
  return `x:${String(r.FacilityName ?? r.FacName ?? "")}|${String(r.Latitude83 ?? r.FacLat ?? "")}|${String(r.Longitude83 ?? r.FacLong ?? "")}`;
}

/**
 * Cover a ZIP's bounding box with FRS circles. See the header for the rules. Never returns a partial set
 * as ok:true.
 */
export async function frsZipCoverage(
  bounds: ZipBounds,
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
  opts: ZipFrsOptions = {},
): Promise<ZipFrsOutcome> {
  const now = opts.now ?? (() => Date.now());
  const sleep = opts.sleep ?? realSleep;
  const maxRequests = opts.maxRequests ?? FRS_ZIP_MAX_REQUESTS;
  const cover = circumCircle(bounds);
  const failures: string[] = [];
  const diag: ZipFrsDiag[] = [];
  let attempts = 0, tiles = 0, raw = 0, lastEnd: number | null = null;
  const byKey = new Map<string, Record<string, unknown>>();
  const fail = (reason: ZipFrsReason): ZipFrsOutcome =>
    ({ ok: false, rows: [], reason, attempts, failures, tiles, cover_radius_mi: cover.radiusMi, raw_rows: raw, ...(diag.length ? { diag } : {}) });

  const queue: ZipBounds[] = [bounds];
  while (queue.length) {
    const box = queue.shift() as ZipBounds;
    const c = circumCircle(box);
    let answered: FrsAttempt | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempts >= maxRequests) return fail("request_limit");
      let timeoutMs = FRS_ATTEMPT_TIMEOUT_MS;
      if (opts.deadlineAt !== undefined) {
        const remaining = opts.deadlineAt - now();
        if (remaining <= 0) return fail("deadline");
        timeoutMs = Math.min(FRS_ATTEMPT_TIMEOUT_MS, remaining);
      }
      attempts++;
      // Diagnostic timing reads its own clock, never opts.now: an injected clock sees exactly the reads it saw before.
      const started = Date.now();
      const a = await frsAt(c.lat, c.lng, c.radiusMi, fetchImpl, timeoutMs);
      if (a.diag && diag.length < DIAG_MAX) {
        diag.push({ ...a.diag, attempt: attempts, since_prev_ms: lastEnd === null ? null : Math.round(started - lastEnd) });
      }
      lastEnd = Date.now();
      if (a.ok || a.tooBig) { answered = a; break; }
      failures.push(`${c.radiusMi}:${a.schema ? "schema" : a.why ?? "unknown"}`);
      if (a.schema) return fail("schema");
      if (attempt === 2) return fail("transient");
      // Always wait before a retry (with or without a deadline): at least the fixed backoff, and the
      // FULL Retry-After when FRS asks for longer. A server-requested wait is never shortened. When it
      // does not fit in what is left of this read's deadline, the read stops here (ok:false
      // "deadline", recorded as retry_after_exceeds_budget) and the stored layer is kept; the next
      // refresh tries again. Each retry counts toward this ZIP's request budget.
      const backoff = FRS_RETRY_BACKOFF_MS[attempt] ?? FRS_RETRY_BACKOFF_MS[FRS_RETRY_BACKOFF_MS.length - 1];
      const asked = a.retryAfterS !== undefined ? a.retryAfterS * 1000 : 0;
      const wait = Math.max(backoff, asked);
      if (opts.deadlineAt !== undefined && opts.deadlineAt - now() - wait <= 0) {
        if (asked > backoff) failures.push(`retry_after_exceeds_budget:${a.retryAfterS}`);
        return fail("deadline");
      }
      await sleep(wait);
    }
    if (!answered) return fail("transient");
    const atCeiling = !answered.tooBig && answered.rows.length >= FRS_TILE_ROW_CEILING;
    if (answered.tooBig || atCeiling) {
      failures.push(`${c.radiusMi}:${atCeiling ? "row_ceiling" : "process_limit"}`);
      // Four quarters, each circle about half this one. A circle already at the floor cannot be split.
      // A circle at the floor that is still refused or still full cannot be resolved: the ZIP fails
      // (ok:false). A saturated answer is NEVER returned as complete.
      if (c.radiusMi / 2 < FRS_TILE_MIN_RADIUS_MI) return fail(atCeiling ? "saturated" : "process_limit");
      queue.push(...splitBox(box));
      continue;
    }
    tiles++;
    raw += answered.rows.length;
    for (const r of answered.rows) {
      const k = rowKey(r);
      if (!byKey.has(k)) byKey.set(k, r);
    }
  }
  return { ok: true, rows: [...byKey.values()], reason: null, attempts, failures, tiles, cover_radius_mi: cover.radiusMi, raw_rows: raw, ...(diag.length ? { diag } : {}) };
}

export interface ZipFacilityPick<T> {
  kept: T[];
  /** rows with usable coordinates that passed the caller's own filter (before the boundary test) */
  candidates: number;
  members: number;
  outside: number;
  /** not_measured / no_coordinates verdicts — excluded, nothing invented */
  unresolved: number;
}

/**
 * Final inclusion by the ZIP polygon. EVERY member is kept: there is no storage cap (2026-11-09; the
 * 250 cap this replaced was a guess, never an EPA or storage limit, and measured ZIPs exceed it). `toSite` turns an FRS row into a site (or null to drop
 * it for a non-geographic reason, e.g. the engine's existing name filter); `member` is the boundary test.
 * Throws when the membership answer is missing or malformed — the caller turns that into ok:false.
 */
export async function pickZipFacilities<T extends { lat: number; lng: number }>(
  rows: Record<string, unknown>[],
  toSite: (r: Record<string, unknown>) => T | null,
  member: MembershipFn,
  center: { lat: number; lng: number },
): Promise<ZipFacilityPick<T>> {
  const cands: T[] = [];
  for (const r of rows) {
    const s = toSite(r);
    if (s && Number.isFinite(s.lat) && Number.isFinite(s.lng)) cands.push(s);
  }
  const verdicts: Verdict[] = [];
  for (let i = 0; i < cands.length; i += 500) {
    const chunk = cands.slice(i, i + 500);
    const out = await member(chunk.map((s) => [s.lat, s.lng] as const));
    if (!Array.isArray(out) || out.length !== chunk.length) throw new Error("membership answer incomplete");
    verdicts.push(...out);
  }
  const inZip: T[] = [];
  let outside = 0, unresolved = 0;
  cands.forEach((s, i) => {
    if (verdicts[i] === "member") inZip.push(s);
    else if (verdicts[i] === "outside") outside++;
    else unresolved++;
  });
  // Deterministic order, nearest the box centre first; only a display/storage order, never inclusion.
  inZip.sort((a, b) => milesBetween(center.lat, center.lng, a.lat, a.lng) - milesBetween(center.lat, center.lng, b.lat, b.lng));
  return {
    kept: inZip,
    candidates: cands.length,
    members: inZip.length,
    outside,
    unresolved,
  };
}
