// TWO PLANES, TWO DEADLINES — the join that stops the CORE project plane waiting minutes on EPA.
//
// UNIT 4 of the EPA/regulatory decoupling (founder decision 2026-09-07, CLAUDE.md §7.1). Map 1
// has a REQUIRED core project plane and an OPTIONAL regulatory overlay plane. Until now both
// call sites in `get-address-report/index.ts` joined them with:
//
//     const [dev, facResult] = await Promise.all([devSites(...), facilitySites(...)]);
//
// `Promise.all` has exactly the two properties this workstream exists to remove:
//   1. IT WAITS FOR THE SLOWEST WITH NO CAP. `facilitySites` → `frsFacilities` walks up to six
//      radii x three attempts, each bounded only by its own 30s fetch timeout, so a
//      slow-but-not-refusing FRS held the finished core result for MINUTES before the report
//      could be written.
//   2. IT FAILS ON THE FIRST REJECTION. An overlay that threw would have failed the whole core
//      report. (Today `facilitySites` cannot throw; this module makes that a guarantee rather
//      than an accident of the current implementation.)
//
// WHAT THIS MODULE ACTUALLY DOES — A BOUND, NOT INDEPENDENCE. Both planes still start together
// and the join still waits for both. Duration is max(core, overlay+grace), not their sum. Core
// does not return the moment `devSites` finishes: until Unit 3 splits `sites`, the report cannot
// be written without an overlay verdict. What this removes is the unbounded FRS ladder and the
// overlay-throw failing the core report. A miss after 45s is the existing 429 refusal path.
//
// THE ASYMMETRY IS THE WHOLE POINT — the two planes get deadlines with OPPOSITE miss semantics:
//
//   CORE misses    → THROW. Core is REQUIRED. A partial or empty core result written as if it
//                    were complete is fabrication by omission, and the refresh layer already
//                    knows what to do with a failed report: keep the previously cached row. This
//                    matches what `devSites` already does when its paginated read fails.
//   OVERLAY misses → the caller's own "unavailable" value, and NEVER a throw. That value carries
//                    `epa.ok:false`, which is the single discriminator
//                    `public.dev_epa_write_refused()` reads — so a timed-out EPA read preserves
//                    the stored facility rows verbatim, holds `facilities_refreshed_at`, and
//                    renders the count as UNKNOWN (`overlay_unknown`). It is deliberately routed
//                    into the EXISTING refusal path a 429 takes, not a new one, so nothing
//                    downstream has to learn a new state and no fake zero can be persisted.
//
// ⛔ SCOPE. This module bounds and joins the two planes. It does NOT merge or split them — the
// `sites` jsonb still carries both, which is Unit 3's job — and it touches no completion or
// indexability rule (`data_quality`, `indexable`, `coverage_state`), which are Units 1 and 2.

/** Core is REQUIRED, so a core deadline miss is a failed report, never an empty one. */
export class CoreDeadlineError extends Error {
  constructor(ms: number) {
    super(`core plane exceeded its ${ms}ms deadline`);
    this.name = "CoreDeadlineError";
  }
}

/**
 * The core plane's budget. Core is a paginated Postgres read over `alerts`, measured in
 * hundreds of milliseconds; 60s is a generous ceiling that only fires on a genuinely stuck
 * read, and a miss preserves the cached row rather than overwriting it.
 */
export const CORE_DEADLINE_MS = 60_000;

/**
 * The overlay's budget. Sized ABOVE one full FRS attempt timeout (`FRS_ATTEMPT_TIMEOUT_MS`,
 * 30s) on purpose: a single slow-but-successful FRS call must still succeed, or the deadline
 * would manufacture `overlay_unknown` out of healthy reads and lose real facility records.
 * What it removes is the ladder's MULTIPLIER — up to 18 attempts, previously bounded only by
 * 30s each. Below the Supabase edge worker's own wall clock, so the report still returns.
 */
export const OVERLAY_DEADLINE_MS = 45_000;

/**
 * The outer guard fires slightly after the deadline the overlay itself was handed, so the
 * cooperative stop (which reports real `attempts`) always wins a race it is capable of
 * winning, and the hard stop only covers a hang OUTSIDE the ladder's own checks.
 */
export const OVERLAY_GRACE_MS = 2_000;

type Timers = {
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (h: unknown) => void;
};

const REAL_TIMERS: Timers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export type PlaneOutcome<C, O> = {
  core: C;
  overlay: O;
  /** true when the overlay was cut off rather than answering. Observability only. */
  overlay_deadline_missed: boolean;
  /** true when the overlay REJECTED and was converted to the unavailable value. */
  overlay_threw: boolean;
};

/**
 * Run both planes concurrently under separate deadlines, then wait for both.
 *
 * Overlay is capped at `overlayDeadlineMs` (+ grace on the hard stop). A miss becomes
 * `overlayUnavailable` — never a throw, never a zero. This is a bound, not independence:
 * the caller still waits for the slower plane (Unit 3 is what would take EPA off the write).
 *
 * `overlay` receives the absolute epoch-ms instant it must finish by, so the plane's own
 * cooperative stop and this module's hard stop are derived from ONE value and cannot drift.
 */
export async function resolvePlanes<C, O>(opts: {
  core: () => Promise<C>;
  overlay: (deadlineAt: number) => Promise<O>;
  /** Builds the honest "we could not read it" value. MUST carry `ok:false`, never a zero. */
  overlayUnavailable: (reason: "deadline" | "error") => O;
  coreDeadlineMs?: number;
  overlayDeadlineMs?: number;
  now?: () => number;
  timers?: Timers;
}): Promise<PlaneOutcome<C, O>> {
  const now = opts.now ?? (() => Date.now());
  const timers = opts.timers ?? REAL_TIMERS;
  const coreMs = opts.coreDeadlineMs ?? CORE_DEADLINE_MS;
  const overlayMs = opts.overlayDeadlineMs ?? OVERLAY_DEADLINE_MS;
  const overlayDeadlineAt = now() + overlayMs;

  // Both start NOW, before either is awaited, so the wait is max(core, overlay) rather than
  // their sum. The join below still awaits both races — that is the bound.
  const corePromise = opts.core();
  const overlayPromise = opts.overlay(overlayDeadlineAt);

  // Convert each to a promise that CANNOT reject, immediately. A rejection arriving after its
  // deadline already resolved the race would otherwise surface as an unhandled rejection and
  // could take down the isolate — the report would fail for a reason that has nothing to do
  // with the report.
  const coreSettled: Promise<{ ok: true; v: C } | { ok: false; e: unknown }> = corePromise.then(
    (v) => ({ ok: true as const, v }),
    (e: unknown) => ({ ok: false as const, e }),
  );
  const overlaySettled: Promise<{ ok: true; v: O } | { ok: false }> = overlayPromise.then(
    (v) => ({ ok: true as const, v }),
    () => ({ ok: false as const }),
  );

  const LATE = Symbol("deadline");
  let coreTimer: unknown, overlayTimer: unknown;
  const coreRace = Promise.race([
    coreSettled,
    new Promise<typeof LATE>((res) => { coreTimer = timers.setTimeout(() => res(LATE), coreMs); }),
  ]);
  const overlayRace = Promise.race([
    overlaySettled,
    new Promise<typeof LATE>((res) => {
      overlayTimer = timers.setTimeout(() => res(LATE), overlayMs + OVERLAY_GRACE_MS);
    }),
  ]);

  let coreOut: typeof LATE | { ok: true; v: C } | { ok: false; e: unknown };
  let overlayOut: typeof LATE | { ok: true; v: O } | { ok: false };
  try {
    [coreOut, overlayOut] = await Promise.all([coreRace, overlayRace]);
  } finally {
    // Never leave a pending timer holding the isolate open past the response.
    timers.clearTimeout(coreTimer);
    timers.clearTimeout(overlayTimer);
  }

  // The overlay is resolved FIRST and unconditionally, so its verdict is decided even on the
  // path where core is about to throw — a core failure must never be reported as an EPA one.
  let overlay: O;
  let missed = false, threw = false;
  if (overlayOut === LATE) { missed = true; overlay = opts.overlayUnavailable("deadline"); }
  else if (overlayOut.ok === false) { threw = true; overlay = opts.overlayUnavailable("error"); }
  else overlay = overlayOut.v;

  if (coreOut === LATE) throw new CoreDeadlineError(coreMs);
  if (coreOut.ok === false) throw coreOut.e;   // the core read's own error, unwrapped

  return { core: coreOut.v, overlay, overlay_deadline_missed: missed, overlay_threw: threw };
}
