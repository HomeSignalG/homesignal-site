// Phase 1B P0 — activation gate checks (sync, circuit, title_verified_at, active=false).

/**
 * @typedef {{
 *   title_verified_at?: string | null,
 *   state?: string,
 *   blocked_by?: string | null,
 * }} CandidateRow
 *
 * @typedef {{
 *   feed_id: string,
 *   active?: boolean,
 * }} FeedRow
 *
 * @typedef {{
 *   has_drift?: boolean,
 *   missing_from_db?: string[],
 *   mismatched?: unknown[],
 * }} SyncDiff
 */

/**
 * @param {CandidateRow} candidate
 */
export function gateTitleVerifiedAt(candidate) {
  return Boolean(candidate.title_verified_at);
}

/**
 * @param {FeedRow} feed
 */
export function gateFeedInactive(feed) {
  return feed.active === false || feed.active === 'false' || feed.active === 0;
}

/**
 * @param {SyncDiff | null | undefined} syncDiff
 * @param {string} feedId
 */
export function gateSyncPass(syncDiff, feedId) {
  if (!syncDiff) return false;
  if (syncDiff.has_drift) return false;
  if (syncDiff.missing_from_db?.includes(feedId)) return false;
  return true;
}

/**
 * @param {{ circuit_status?: string } | null | undefined} circuit
 */
export function gateCircuitClosed(circuit) {
  if (!circuit) return true;
  return circuit.circuit_status !== 'halted';
}

/**
 * @param {CandidateRow} candidate
 */
export function gateValidClaim(candidate, { actor = 'operator', now = new Date() } = {}) {
  if (actor === 'system' || actor === 'ci') return true;
  if (!candidate.claimed_by) return false;
  if (!candidate.claim_expires_at) return true;
  return new Date(candidate.claim_expires_at) > now;
}

/**
 * Run all activation gates.
 * @param {{
 *   candidate: CandidateRow,
 *   feed: FeedRow,
 *   syncDiff?: SyncDiff,
 *   circuit?: { circuit_status?: string },
 *   actor?: string,
 * }} args
 */
export function checkActivationGates({ candidate, feed, syncDiff, circuit, actor = 'operator' }) {
  /** @type {string[]} */
  const failures = [];

  if (!gateTitleVerifiedAt(candidate)) failures.push('title_verified_at');
  if (!gateFeedInactive(feed)) failures.push('feed_active_false');
  if (!gateSyncPass(syncDiff, feed.feed_id)) failures.push('sync_pass');
  if (!gateCircuitClosed(circuit)) failures.push('circuit_closed');
  if (!gateValidClaim(candidate, { actor })) failures.push('valid_claim');

  return {
    pass: failures.length === 0,
    failures,
  };
}
