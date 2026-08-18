// The status → lifecycle-bucket contract used by GATE 2B, in its own module so the offline
// unit suite can pin it. (scripts/gate2/full-inventory.mjs is a top-level-await script that
// fetches live data the moment it is imported, so its internals cannot be unit-tested in
// place — and a guard nothing tests is an instruction, not a control.)
//
// WHY THIS IS NOT IMPORTED FROM lib/map.js. Deriving the gate's expected bucket sizes by
// calling HS.resolveMarker would make the filter test TAUTOLOGICAL: a resolver bug that
// mis-buckets a record would move the expectation and the measurement together and the test
// would still pass. So the COUNTS follow the live data (drift-proof) while the MAPPING stays
// an independent restatement of the documented contract, asserted against lib/map.js by
// test/gate2-lifecycle-buckets.test.mjs rather than borrowed from it.

/** Mirrors lib/map.js::statusTier (lines 194-200). Lower-cased keys; values are the four
 *  first-class lifecycle buckets. */
export const STATUS_BUCKET = {
  'proposed': 'proposed',
  'approved': 'approved',
  'operating': 'operating',
  'active': 'operating',      // lib/map.js:198 — 'active' and 'built' ride with operating
  'built': 'operating',
  'on file': 'unknown',       // the legacy TABS vocabulary; frozen-fixture rows still carry it
};

export const LIFECYCLE_KEYS = ['proposed', 'approved', 'operating', 'unknown'];

/** Bucket a raw app_projects row. Facilities carry filterKey 'facility' (lib/map.js:531) and
 *  are never removable by a lifecycle toggle, so they are counted separately, never as one.
 *  Returns undefined for an unrecognised status — callers MUST fail closed on that. */
export function bucketOf(r) {
  if (r.record_kind === 'facility') return 'facility';
  return STATUS_BUCKET[String(r.status || '').trim().toLowerCase()];
}

/**
 * Census + FAIL-CLOSED vocabulary check over a row set.
 *
 * lib/map.js sends anything it does not recognise to `unknown` via an else-branch. That is
 * right for the PAGE (never promote a record to a lifecycle its source did not state) and
 * wrong for a GATE, because a vocabulary change then looks like normal operation. Here an
 * unrecognised status throws and NAMES the value. Had this existed, the 2026-08 move of the
 * five Del Valle TABS rows off 'On file' would have been reported the day it happened instead
 * of hiding inside eight days of red.
 *
 * @returns {{counts: Object, ids: Object}} per-bucket counts and per-bucket id lists, so a
 *   filter can be checked by MEMBERSHIP — a matching count over the wrong records is not a pass.
 */
export function censusOf(rows, label) {
  const unrecognised = {};
  const counts = { proposed: 0, approved: 0, operating: 0, unknown: 0, facility: 0 };
  const ids = { proposed: [], approved: [], operating: [], unknown: [], facility: [] };
  for (const r of rows) {
    const b = bucketOf(r);
    if (!b) {
      const v = r.status === null || r.status === undefined ? '(null)' : JSON.stringify(r.status);
      unrecognised[v] = (unrecognised[v] || 0) + 1;
      continue;
    }
    counts[b]++;
    ids[b].push(r.source_ref || r.name);
  }
  const bad = Object.keys(unrecognised);
  if (bad.length) {
    throw new Error(`${label}: ${bad.length} UNRECOGNISED status value(s) — the lifecycle `
      + `vocabulary moved and this gate will not guess how to bucket it. Add it to `
      + `STATUS_BUCKET (and check lib/map.js::statusTier agrees) before this gate can speak: `
      + bad.map(v => `${v} x${unrecognised[v]}`).join(', '));
  }
  return { counts, ids };
}
