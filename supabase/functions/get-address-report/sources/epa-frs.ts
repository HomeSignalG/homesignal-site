// EPA FRS retrieval — the ONE upstream call behind the national facilities floor.
//
// WHY THIS IS ITS OWN MODULE (2026-08-13). Until now `frsAt`/`frsFacilities` lived inline in
// index.ts and `frsFacilities` returned a BARE ARRAY: `[]` for a genuinely empty area AND `[]`
// when every radius and every retry had failed. Those are different facts about the world, and
// the caller could not tell them apart — so the report emitted `counts.facilities: 0` either way
// and the cache stored a FALSE AUTHORITATIVE ZERO whenever EPA was unreachable.
//
// That is exactly the 2026-08-08→12 outage damage: 515 ZIP pages written with facilities = 0
// while FRS returned 502 / 429 / "Failure when receiving data from the peer" for every request.
// Measured: the facility-hit rate was ~90% in the hour before the window and ~90% in the hour
// after, and 0.0% across all 515 rows inside it.
//
// `dev_refresh_collect` could only ever GUESS whether a given ZIP's zero was real, from a GLOBAL
// two-point health probe (`public.epa_frs_probes`). That proxy is wrong precisely when FRS fails
// DENSITY-DEPENDENTLY — the process limit bites dense ZIPs and not rural ones — which is the
// failure mode FRS actually has. A global "healthy" reading plus a per-ZIP failure still writes
// an authoritative zero.
//
// The fix is to REPORT what happened instead of inferring it: every retrieval returns an outcome
// carrying `ok`, so a zero is authoritative only when `ok` is true. `ok` further requires a
// RECOGNIZED FRS envelope — parsed JSON that is not `{ Results: { FRSFacility|Facilities: [] } }`
// (or a process-limit Error, or a bare FRSFacility array) is `ok:false, reason:"schema"`.
// The 2026-09-27 audit measured `{}`, `{"Results":{}}`, scalars and a non-array FRSFacility
// all coming back as `ok:true, rows=0` (SILENT-ZERO SCHEMA RISK).
//
// THE DISTINCTION THIS MODULE EXISTS TO PRESERVE — four outcomes, never conflated:
//   ok:true  + rows>0            → EPA answered, facilities found.
//   ok:true  + rows=0            → EPA answered, genuinely nothing registered here. AUTHORITATIVE
//                                  ZERO — cacheable as 0. (Rural west-desert ZIPs are really 0.)
//   ok:true  + rows>0, all later
//            dropped by the
//            caller's name filter → still an AUTHORITATIVE ZERO. `ok` describes RETRIEVAL, never
//                                  the caller's intentional filtering, so `looksIndustrial()`
//                                  dropping every row must NOT read as an outage. (St. Louis
//                                  63118: FRS returns real rows at r=1; none are industrial.)
//   ok:false                     → EPA could not give a trustworthy answer. NOT a zero. The
//                                  caller must preserve last-known-good, or say "unknown".
//
// UNIT 4 (2026-09-07) — THE LADDER NOW HAS A DEADLINE, AND A MISS IS `ok:false`, NOT A ZERO.
// The back-off walks up to 6 radii x 3 attempts, each attempt bounded only by its own 30s fetch
// timeout, so a slow-but-not-refusing FRS could hold the caller for MINUTES. That cost was paid
// by the CORE project plane, which ran beside this call under one `Promise.all` and could not
// finish until EPA did. `deadlineAt` bounds the whole sequence: the ladder refuses to START an
// attempt it cannot finish, and shortens the last attempt's timeout to the budget that is left.
//
// A deadline miss is deliberately routed into the EXISTING refusal path rather than a new one —
// `ok:false` is the single discriminator `public.dev_epa_write_refused()` reads, so a timed-out
// read preserves the stored facility layer and renders the count UNKNOWN, exactly like a 429.
// `reason:"deadline"` is observability only; nothing switches on it.

/** One attempt at one radius. `tooBig` = FRS's process-limit refusal (shrink; retrying is futile).
 *  `schema` = HTTP 2xx JSON that is not a recognized FRS envelope. Not a zero; do not retry. */
export type FrsAttempt = {
  ok: boolean;
  tooBig: boolean;
  schema: boolean;
  rows: Record<string, unknown>[];
};

/** The result of the whole back-off sequence. `ok:false` must NEVER be persisted as zero. */
export type FrsOutcome = {
  /** true = FRS answered AND the payload is a recognized FRS envelope. Only then is `rows.length === 0` authoritative. */
  ok: boolean;
  rows: Record<string, unknown>[];
  /** the radius that actually answered; null when nothing did */
  radius_used: number | null;
  /** null on success; else why the sequence gave up — for logs and for the cache guard */
  reason: "process_limit" | "transient" | "deadline" | "schema" | "partial_scope" | null;
  /** how many HTTP attempts were made (observability: a 1 means it worked first try) */
  attempts: number;
};

/** One attempt's own network timeout. The deadline may shorten it, never lengthen it. */
export const FRS_ATTEMPT_TIMEOUT_MS = 30000;

export const FRS_ENDPOINT =
  "https://ofmpub.epa.gov/frs_public2/frs_rest_services.get_facilities";

/** The back-off ladder, largest first. Exported so tests and callers agree on the sequence. */
export function frsRadii(radiusMi: number): number[] {
  return [radiusMi, 3, 2, 1.5, 1, 0.5, 0.25].filter(
    (r, i, a) => r <= radiusMi && a.indexOf(r) === i,
  );
}

type FetchLike = (input: string, init?: unknown) => Promise<Response>;

const TRANSIENT: FrsAttempt = { ok: false, tooBig: false, schema: false, rows: [] };
const SCHEMA: FrsAttempt = { ok: false, tooBig: false, schema: true, rows: [] };
const TOO_BIG: FrsAttempt = { ok: false, tooBig: true, schema: false, rows: [] };

/**
 * A recognized FRS envelope is one of:
 *   { Results: { FRSFacility: <array> } }
 *   { Results: { Facilities: <array> } }
 *   { Results: { Error: … } }          — process-limit refusal, not a zero
 *   { FRSFacility: <array> }           — bare list, no Results wrapper
 * Anything else that parsed — `{}`, `{"Results":{}}`, a scalar, an array, FRSFacility
 * as an object/null — is NOT an answer. The 2026-09-27 audit measured those as
 * `ok:true, rows=0` (SILENT-ZERO SCHEMA RISK). Test 6c used to pin that as deliberate.
 */
export function recognizedFrsPayload(data: unknown): FrsAttempt {
  if (!data || typeof data !== "object" || Array.isArray(data)) return SCHEMA;
  const obj = data as Record<string, unknown>;
  const res = obj.Results;
  if (res && typeof res === "object" && !Array.isArray(res)) {
    const r = res as Record<string, unknown>;
    if (r.Error) return TOO_BIG;
    const list = r.FRSFacility ?? r.Facilities;
    if (Array.isArray(list)) return { ok: true, tooBig: false, schema: false, rows: list };
    return SCHEMA;
  }
  if (Array.isArray(obj.FRSFacility)) {
    return { ok: true, tooBig: false, schema: false, rows: obj.FRSFacility as Record<string, unknown>[] };
  }
  return SCHEMA;
}

// One FRS query at a fixed radius; tooBig = FRS process-limit refusal (shrink), transient = retry.
export async function frsAt(
  lat: number,
  lng: number,
  rad: number,
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
  timeoutMs: number = FRS_ATTEMPT_TIMEOUT_MS,
): Promise<FrsAttempt> {
  const q = new URLSearchParams({
    latitude83: lat.toFixed(6),
    longitude83: lng.toFixed(6),
    search_radius: String(rad),
    output: "JSON",
  });
  try {
    const r = await fetchImpl(`${FRS_ENDPOINT}?${q}`, {
      signal: AbortSignal.timeout(Math.max(1, Math.floor(timeoutMs))),
    });
    // 5xx AND 429: a rate-limit is a refusal to answer, not an answer of zero. Observed live
    // 2026-08-13 — the atlanta-dense health probe took a 429 while rural took a 200.
    if (r.status >= 500 || r.status === 429) return TRANSIENT;
    // Any other non-2xx is likewise not an answer. A 404/403 must not read as "no facilities".
    if (r.status < 200 || r.status >= 300) return TRANSIENT;
    const text = await r.text();
    // Escape any backslash that isn't a valid JSON escape so JSON.parse survives FRS payloads.
    const data = JSON.parse(text.replace(/\\(?!["\\/bfnrtu])/g, "\\\\"));
    return recognizedFrsPayload(data);
  } catch (_e) {
    return TRANSIENT;                          // network/parse → transient
  }
}

// Radius back-off + transient retry (v12/v13), now returning an OUTCOME rather than a bare array
// so that "EPA said zero" and "EPA said nothing" are distinguishable by the caller (v23).
/**
 * UNIT 4 — the overlay's own budget. `deadlineAt` is an ABSOLUTE epoch-ms instant, not a
 * duration, so the same value can bound the ladder AND the caller's outer guard without the
 * two drifting apart. `now` is injectable so the deadline is testable without real waiting.
 */
export type FrsOptions = { deadlineAt?: number; now?: () => number };

export async function frsFacilities(
  lat: number,
  lng: number,
  radiusMi: number,
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
  opts: FrsOptions = {},
): Promise<FrsOutcome> {
  const now = opts.now ?? (() => Date.now());
  const deadlineAt = opts.deadlineAt;
  let reason: "process_limit" | "transient" | "deadline" | "schema" | "partial_scope" | null = null;
  let attempts = 0;
  for (const rad of frsRadii(radiusMi)) {
    let transientExhausted = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      // NEVER START AN ATTEMPT THE BUDGET CANNOT PAY FOR. Checked BEFORE the attempt, so the
      // ladder cannot spend a whole 30s fetch only to discover it was already out of time; and
      // the remaining budget CAPS this attempt's own timeout, which is what makes the last
      // attempt honour the deadline instead of overrunning it by up to 30s. With no deadline
      // the timeout is the historical constant and this whole block is a no-op — ONE code path,
      // so the deadlined and undeadlined ladders can never drift apart.
      let timeoutMs = FRS_ATTEMPT_TIMEOUT_MS;
      if (deadlineAt !== undefined) {
        const remaining = deadlineAt - now();
        if (remaining <= 0) {
          // NOT a zero — the same `ok:false` refusal a 429 produces. See the header.
          return { ok: false, rows: [], radius_used: null, reason: "deadline", attempts };
        }
        timeoutMs = Math.min(FRS_ATTEMPT_TIMEOUT_MS, remaining);
      }
      attempts++;
      const { ok, tooBig, schema, rows } = await frsAt(lat, lng, rad, fetchImpl, timeoutMs);
      if (ok) {
        // A zero at a SMALLER radius is not a whole-ZIP zero. Process-limit back-off
        // answered a tighter circle; "nothing here" does not prove the requested
        // circle is empty. The 2026-09-27 audit: r=3 and r=2 refused, r=1.5 returned
        // [] → ok:true, treated as authoritative. A smaller NONZERO count still
        // writes (observable via radius_used / pre_cap) — that is undercount, not a
        // false zero.
        if (rows.length === 0 && rad < radiusMi) {
          return { ok: false, rows: [], radius_used: null, reason: "partial_scope", attempts };
        }
        return { ok: true, rows, radius_used: rad, reason: null, attempts };
      }
      if (schema) {
        // Same body will come back on retry. Not a zero, not a reason to shrink the circle.
        return { ok: false, rows: [], radius_used: null, reason: "schema", attempts };
      }
      if (tooBig) { reason = "process_limit"; break; } // too large → next smaller radius
      reason = "transient";                            // else transient → retry the same radius
      transientExhausted = attempt === 2;              // ...but only at THIS radius (see below)
    }
    // A TRANSIENT failure MUST NOT SHRINK THE SEARCH AREA. Falling through to the next, smaller
    // radius here is what silently undercounted EPA facilities fleet-wide (2026-08-27): under
    // load FRS refuses transiently at every rung, the ladder walks down to 0.25 mi, and that tiny
    // circle finally answers — returning ok:true with a real but far smaller number that no guard
    // can distinguish from the truth. Measured on ZIP 92867, minutes apart: 40 facilities at
    // radius 1 fired alone, 5 at radius 0.25 fired in a batch of 6; identical development counts.
    // "No answer at the radius we asked for" is the honest outcome, and ok:false preserves the
    // page's last-known-good instead of overwriting it with a smaller truth.
    if (transientExhausted) {
      return { ok: false, rows: [], radius_used: null, reason: "transient", attempts };
    }
  }
  // Every radius and every retry failed. This is NOT zero facilities — it is no answer.
  return { ok: false, rows: [], radius_used: null, reason: reason ?? "transient", attempts };
}
