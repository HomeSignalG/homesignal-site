// Pure evaluation for the EXTERNAL ingest heartbeat alarm. No network, no clock of its own —
// `now` is always passed in, which is what makes both directions testable offline.
//
// ── WHY THIS LIVES IN homesignal-site ────────────────────────────────────────────────────
// The ingest repo already HAS a heartbeat check (`check-ingest-heartbeat.yml`) and it is correct:
// dispatched by hand on 2026-08-23 it reported "none of the last 20 ingest runs SUCCEEDED"
// immediately. It never fired during the outage for one reason — it is a job in the repo whose
// Actions were dead. A watchdog inside the thing it watches cannot survive its own trigger
// condition.
//
// This repo is PUBLIC, so its Actions minutes are free and unaffected by whatever stops the
// private ingest repo. That is the entire reason the alarm lives here.
//
// ── WHY A HEARTBEAT ROW AND NOT ROW ARRIVAL ──────────────────────────────────────────────
// `alerts` rows arrive only when publishers publish. Measured: worst NORMAL quiet gap 101.3h vs a
// 113.8h outage — no threshold separates them, which is why pipeline_health_tick() marks
// `government_notice_ingest` and `meetings_ingest` explicitly NOT ALERTABLE. A heartbeat is
// written unconditionally at the end of every successful run on a fixed cron, so the denominator
// is RUNS, not publisher behaviour. That is what makes it separating.
//
// ── WHY NO PAT ───────────────────────────────────────────────────────────────────────────
// The reader uses the PUBLIC anon key against a table with a public-select RLS policy. The writer
// uses the write key the ingest run already holds. There is no credential in the detection path
// that can die — which matters, because the account PAT was 401 throughout the outage and a
// GitHub-API-based watchdog would have been blind exactly when it was needed.

/** Threshold in hours: the cron cadence plus enough slack that ONE dropped fire is not a page.
 *  Founder-set: 6h against the 4h ingest cron. Not derived here — if the cron changes, this
 *  changes deliberately, in the same commit, rather than drifting behind it. */
export const HEARTBEAT_CADENCE_HOURS = 4;
export const HEARTBEAT_THRESHOLD_HOURS = 6;

/**
 * @param {object}  a
 * @param {Date}    a.now            evaluation time (always injected — never read from the clock here)
 * @param {?string} a.latestFinished ISO timestamp of the newest SUCCESSFUL run, or null/undefined
 * @param {number}  a.thresholdHours hours of silence that constitute an alarm
 * @returns {{ok:boolean, state:string, ageHours:?number, reason:string}}
 */
export function evaluateHeartbeat({ now, latestFinished, thresholdHours = HEARTBEAT_THRESHOLD_HOURS }) {
  // ⚠️ NO HEARTBEAT AT ALL IS AN ALARM, NOT A PASS. This is the fail-closed direction and it is
  // the one that matters: an empty table looks identical to a healthy-but-quiet one to any check
  // written as `if (row && tooOld)`. During the outage the table did not exist; the day it is
  // created it is empty, and "empty" must not read as "fine".
  if (!latestFinished) {
    return { ok: false, state: 'NO_HEARTBEAT', ageHours: null,
      reason: 'no successful ingest run has ever been recorded — the pipeline has never reported success, or the writer is not deployed' };
  }

  const t = Date.parse(latestFinished);
  // An unparseable timestamp is also an alarm. Silently coercing it to NaN and comparing would
  // make every comparison false, i.e. a permanent pass — success-shaped output attesting to
  // nothing.
  if (Number.isNaN(t)) {
    return { ok: false, state: 'UNREADABLE', ageHours: null,
      reason: `heartbeat timestamp could not be parsed: ${JSON.stringify(latestFinished)}` };
  }

  const ageHours = (now.getTime() - t) / 3_600_000;

  // A heartbeat from the FUTURE means clock skew or a bad write. Not an outage, but not something
  // to pass silently either — it would mask a real one for as long as the skew lasts.
  if (ageHours < -0.25) {
    return { ok: false, state: 'FUTURE', ageHours,
      reason: `newest heartbeat is ${Math.abs(ageHours).toFixed(1)}h in the FUTURE — clock skew or a bad write; a future stamp can mask a real outage` };
  }

  if (ageHours > thresholdHours) {
    return { ok: false, state: 'STALE', ageHours,
      reason: `no successful ingest run for ${ageHours.toFixed(1)}h (threshold ${thresholdHours}h, cron every ${HEARTBEAT_CADENCE_HOURS}h)` };
  }

  return { ok: true, state: 'OK', ageHours,
    reason: `newest successful ingest run ${ageHours.toFixed(1)}h ago (threshold ${thresholdHours}h)` };
}
