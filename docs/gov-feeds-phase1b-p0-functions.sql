-- Phase 1B P0 — feed_candidates functions (DOCS ONLY — do not auto-apply).
-- Embeds generated transition seed from lib/generated/transitions.sql
-- Regenerate artifacts: node scripts/gov-feeds/gen/generate-transition-artifacts.mjs

-- === BEGIN lib/generated/transitions.sql ===

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

-- === END lib/generated/transitions.sql ===

-- Authoritative transition RPC (Postgres enforces legal transitions)
create or replace function public.transition_feed_candidate(
  p_feed_id text,
  p_from_state text,
  p_to_state text,
  p_event text,
  p_actor text default 'operator',
  p_status_reason text default null,
  p_lock_version integer default null
)
returns public.feed_candidates
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.feed_candidates;
  v_legal boolean;
begin
  select exists (
    select 1
    from public.feed_candidate_transitions t
    where t.from_state = p_from_state
      and t.to_state = p_to_state
      and t.event = p_event
  ) into v_legal;

  if not v_legal then
    raise exception 'illegal transition: % --[%]--> %', p_from_state, p_event, p_to_state;
  end if;

  update public.feed_candidates
  set state = p_to_state,
      status_reason = coalesce(p_status_reason, status_reason),
      state_entered_at = now(),
      updated_at = now(),
      lock_version = lock_version + 1
  where feed_id = p_feed_id
    and state = p_from_state
    and (p_lock_version is null or lock_version = p_lock_version)
  returning * into v_row;

  if not found then
    raise exception 'feed_candidate not found or lock mismatch: %', p_feed_id;
  end if;

  insert into public.feed_candidate_audit (feed_id, from_state, to_state, event, actor, status_reason)
  values (p_feed_id, p_from_state, p_to_state, p_event, p_actor, p_status_reason);

  return v_row;
end;
$$;

comment on function public.transition_feed_candidate is
  'Phase 1B P0 — apply a legal feed_candidates state transition. Gates enforced at application layer before call.';

-- Activation pre-check helper (read-only; gates enforced by caller)
create or replace function public.feed_candidate_can_activate(p_feed_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.feed_candidates c
    join public.feeds f on f.feed_id = c.feed_id
    where c.feed_id = p_feed_id
      and c.title_verified_at is not null
      and c.state in ('title_verified', 'activating')
      and f.active = false
  );
$$;

comment on function public.feed_candidate_can_activate is
  'Returns true when title_verified_at is set, state allows activation, and feed is inactive.';
