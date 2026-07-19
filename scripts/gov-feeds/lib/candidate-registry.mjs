// Phase 1B P0 — feed_candidates registry client (read/write via Supabase REST).
// P0: library only; no production writes from unit tests.

import { validateTransition } from './state-machine.mjs';
import { CURRENT_SCHEMA_VERSION, CURRENT_TRANSITION_SPEC_VERSION } from '../../../lib/generated/versions.mjs';

/**
 * @typedef {import('./activation-gates.mjs').CandidateRow & {
 *   id?: string,
 *   feed_id: string,
 *   community_id: string,
 *   vendor: string,
 *   source: string,
 *   source_type: string,
 *   state: string,
 *   lock_version?: number,
 * }} FeedCandidate
 */

/**
 * @param {{ supabaseUrl: string, serviceRoleKey: string }} creds
 * @param {string} feedId
 */
export async function fetchCandidateByFeedId(creds, feedId) {
  const base = creds.supabaseUrl.replace(/\/$/, '');
  const url = `${base}/rest/v1/feed_candidates?feed_id=eq.${encodeURIComponent(feedId)}&select=*&limit=1`;
  const res = await fetch(url, {
    headers: {
      apikey: creds.serviceRoleKey,
      Authorization: `Bearer ${creds.serviceRoleKey}`,
    },
  });
  if (!res.ok) throw new Error(`feed_candidates read failed: ${res.status} ${await res.text()}`);
  const rows = await res.json();
  return rows[0] ?? null;
}

/**
 * Build a transition payload (does not POST — caller or RPC applies).
 * @param {FeedCandidate} candidate
 * @param {{ to: string, event: string, status_reason?: string, gates?: Record<string, boolean>, actor?: string }} args
 */
export function buildTransitionPayload(candidate, { to, event, status_reason, gates = {}, actor = 'operator' }) {
  const err = validateTransition({
    from: candidate.state,
    to,
    event,
    gates,
  });
  if (err) throw new Error(err);

  return {
    feed_id: candidate.feed_id,
    from_state: candidate.state,
    to_state: to,
    event,
    status_reason: status_reason || null,
    actor,
    lock_version: candidate.lock_version ?? 0,
    schema_version: candidate.schema_version ?? CURRENT_SCHEMA_VERSION,
    transition_spec_version: candidate.transition_spec_version ?? CURRENT_TRANSITION_SPEC_VERSION,
    state_entered_at: new Date().toISOString(),
  };
}

/**
 * Default row shape for new candidates (pre-insert registry).
 * @param {Partial<FeedCandidate>} partial
 */
export function newCandidateRow(partial) {
  return {
    state: 'discovered',
    schema_version: CURRENT_SCHEMA_VERSION,
    transition_spec_version: CURRENT_TRANSITION_SPEC_VERSION,
    target_table: 'meetings',
    golive_attempts: 0,
    ...partial,
  };
}
