// zip-state-kind.mjs — the producer's geography answer -> the page-state name.
//
// Extracted so it can be proven OFFLINE, in both directions, without a browser or a live
// database. scripts/verify-map1-zip-states.mjs is a live gate; the mapping it selects its
// assertions with is a pure function and belongs where a unit test can reach it.
//
// THE STATES, and what the producer says for each. Mapping is UNCHANGED (unknown still
// -> pending). Standing totals measured 2026-09-28 over all 12,722 canonical ZIPs via
// geo.n5_serving_status on serving generation n5-national-2026-09-25, corroborated by
// public.app_zip_projects_markers(..., p_authoritative := true):
//   'unknown'           -> pending         0 ZIPs   currently unoccupied (do not invent a
//                                                   pending ZIP; the live gate's COVERAGE
//                                                   path is what fires if this stays 0)
//   'not_measured'      -> not_measured  706 ZIPs   measured deliberately as not-measured
//   'boundary_complete' -> authoritative           project_count > 0
//   'boundary_complete' -> measured_zero           project_count = 0   (12,016 complete in total)
// The 2026-09-15 receipt (3 unknown / 12,013 complete) is the pre-activation set. The three
// that were unknown then — 94128, 95219, 99128 — now resolve as measured_zero / measured_zero
// / authoritative (project_count 0 / 0 / 1). kindFromProducer({status:'unknown'}) still maps
// to pending so the fail-closed unknown branch remains a contract.

/**
 * @returns one of 'pending' | 'authoritative' | 'not_measured' | 'measured_zero', or
 *          null when the payload cannot be trusted to name a state.
 *
 * ⚠️ A FAILED OR UNRECOGNISED READ IS NOT A STATE. Returning a kind here for a payload that
 * does not clearly say one would make the live gate assert the WRONG page contract and then
 * report the result as fact — a false red or, worse, a false green. Every such case returns
 * null so the caller reports a resolution failure instead of guessing.
 */
export function kindFromProducer(auth) {
  if (!auth || typeof auth !== 'object' || Array.isArray(auth)) return null;
  const status = auth.status;
  if (status === 'unknown') return 'pending';
  if (status === 'not_measured') return 'not_measured';
  if (status === 'boundary_complete') {
    const n = auth.project_count;
    // 'complete' carrying no count is not a measurement — the same refusal
    // HS.zipAuthOutcome makes for a complete status with null projects/markers.
    if (typeof n !== 'number') return null;
    return n > 0 ? 'authoritative' : 'measured_zero';
  }
  return null;
}

/** The states this gate must exercise, in report order. */
export const ZIP_STATE_KINDS = Object.freeze(['pending', 'authoritative', 'not_measured', 'measured_zero']);
