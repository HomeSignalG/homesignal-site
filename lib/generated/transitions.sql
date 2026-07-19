-- AUTO-GENERATED — do not edit. Source: scripts/gov-feeds/spec/transition-spec.v1.json
-- Regenerate: node scripts/gov-feeds/gen/generate-transition-artifacts.mjs
-- Apply manually via docs/gov-feeds-phase1b-p0-functions.sql (not auto-applied).

-- Legal feed_candidates state transitions (transition_spec_version 1.0)
create table if not exists public.feed_candidate_transitions (
  from_state text not null,
  to_state text not null,
  event text not null,
  requires_gate text,
  primary key (from_state, to_state, event)
);

comment on table public.feed_candidate_transitions is
  'Phase 1B P0 legal state transitions; generated from transition-spec.v1.json';

insert into public.feed_candidate_transitions (from_state, to_state, event, requires_gate)
values
  ('discovered', 'discriminated', 'discriminate', 'scope_discriminator'),
  ('discriminated', 'validated', 'validate', 'validation_prerequisites'),
  ('validated', 'title_gate_verified', 'title_gate_pass', 'scope_discriminator'),
  ('title_gate_verified', 'inserted', 'insert', 'insert_success'),
  ('inserted', 'dry_running', 'start_dry_run', null),
  ('verified', 'dry_running', 'start_dry_run', null),
  ('dry_running', 'dry_run_pass', 'dry_run_pass', null),
  ('dry_running', 'dry_run_failed', 'dry_run_fail', null),
  ('dry_run_pass', 'goliving', 'start_golive', null),
  ('goliving', 'title_verified', 'title_verify_pass', 'title_verified_at'),
  ('goliving', 'title_verify_failed', 'title_verify_fail', null),
  ('title_verified', 'activating', 'start_activation', 'activation_gates'),
  ('activating', 'active', 'activate', 'activation_gates'),
  ('activating', 'activation_failed', 'activation_fail', null),
  ('active', 'open_circuit', 'open_circuit', null),
  ('active', 'superseded', 'supersede', null),
  ('active', 'abandoned', 'abandon', null),
  ('open_circuit', 'circuit_halting', 'start_circuit_halt', null),
  ('circuit_halting', 'circuit_halted', 'circuit_halted', null),
  ('circuit_halted', 'rollback_running', 'start_rollback', null),
  ('rollback_running', 'rolled_back', 'rollback_complete', null),
  ('rollback_running', 'rollback_failed', 'rollback_fail', null),
  ('rolled_back', 'superseded', 'supersede', null),
  ('discovered', 'abandoned', 'abandon', null),
  ('discriminated', 'abandoned', 'abandon', null),
  ('validated', 'abandoned', 'abandon', null),
  ('title_gate_verified', 'abandoned', 'abandon', null),
  ('inserted', 'abandoned', 'abandon', null),
  ('verified', 'abandoned', 'abandon', null),
  ('dry_running', 'abandoned', 'abandon', null),
  ('dry_run_failed', 'abandoned', 'abandon', null),
  ('title_verify_failed', 'abandoned', 'abandon', null),
  ('activation_failed', 'abandoned', 'abandon', null),
  ('rollback_failed', 'abandoned', 'abandon', null),
  ('title_gate_verified', 'verified', 'legacy_verify', null),
  ('inserted', 'verified', 'legacy_verify', null),
  ('dry_run_pass', 'verified', 'legacy_verify', null),
  ('title_verified', 'verified', 'legacy_verify', null),
  ('verified', 'goliving', 'start_golive', null),
  ('verified', 'activating', 'start_activation', 'activation_gates'),
  ('verified', 'active', 'activate', 'activation_gates')
on conflict (from_state, to_state, event) do nothing;

-- States reference (documentation)
-- terminal: superseded, abandoned
