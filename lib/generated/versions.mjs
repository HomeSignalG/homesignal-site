// AUTO-GENERATED — do not edit. Source: scripts/gov-feeds/spec/*.v1.json
// Regenerate: node scripts/gov-feeds/gen/generate-transition-artifacts.mjs

export const REGISTRY_SCHEMA_VERSION = 1;
export const REGISTRY_TRANSITION_SPEC_VERSION = 1;
export const CURRENT_SCHEMA_VERSION = 1;
export const CURRENT_TRANSITION_SPEC_VERSION = 1;

/** @type {readonly string[]} */
export const FEED_CANDIDATES_COLUMNS = [
  "id",
  "community_id",
  "feed_id",
  "vendor",
  "source",
  "source_type",
  "state",
  "status_reason",
  "batch_id",
  "confidence",
  "discovery_version",
  "claimed_by",
  "claim_expires_at",
  "title_verified_at",
  "activated_at",
  "target_table",
  "lock_version",
  "state_entered_at",
  "blocked_by",
  "source_normalized",
  "discovery_artifact_path",
  "golive_attempts",
  "superseded_by_feed_id",
  "schema_version",
  "transition_spec_version",
  "created_at",
  "updated_at"
];

/** @type {Record<string, string>} */
export const GATE_DEFINITIONS = {
  "valid_claim": "Operator transitions require an unexpired claim unless actor is system or ci.",
  "circuit_closed": "Batch circuit_status must not be halted for activation paths.",
  "title_verified_at_set": "title_verified_at must be set before activation_queued to active.",
  "feed_active_false": "public.feeds.active must be false before activation.",
  "sync_pass": "feeds.csv and public.feeds must agree for feed_id (checked at activation)."
};
