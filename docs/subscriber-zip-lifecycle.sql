-- Subscriber ZIP lifecycle (2026-11-19, revised after founder review). SQL of record. ADDITIVE; NOT APPLIED to production.
--
-- CHANGE GROUP A1 — NEW OBJECTS ONLY. It replaces nothing and alters no existing table or function.
-- DEPENDENCIES (all verified present in production 2026-11-19): public.bsky_maps_priority_classification (view),
--   public.communities(zip_codes text[]), geo.zcta_boundary(zcta5 text), public.dashboard_admins(email),
--   public._hs_subscriber_zip_health_core() (Tab 2's reader; ANY version works, but the stage 'remediation_queue' over-counts
--   N5-withheld keys until change group A2 (docs/subscriber-zip-health-core-revision.apply.sql) is also applied).
-- It never sends, publishes, deploys, activates a source, or writes a source record, post, email row, founder override
-- or reconciliation evidence. Its only writes are the three lifecycle tables below, from subscriber_zip_lifecycle_sync().
--
-- STAGES (a CEILING from evidence, never a claim of completion; verification of the public page is never reached by this file):
--   geographic_validation  no ZIP community row, or no ZCTA boundary
--   source_assessment      no development source has stored a record for the ZIP
--   remediation_queue      a source failed in the last 48h, or a recent live record is unexplained (in no Map 1 and not recorded
--                          unresolved by the active N5 generation)
--   reconciliation         NOT every applicable source has a VALID reconciliation entry (below), or discovery of applicable
--                          sources has not been declared complete
--   scheduled_refresh      reconciled, but the ZIP report is older than 72h
--   public_page_verification  reconciled and refreshed; public page and Map 1 proof are NOT recorded by this file
-- A reconciliation entry is VALID only when ALL hold: complete = true, missing = 0, undecidable = 0, run_id present, `at` within
-- 168 h, and kind in (verified_matched, verified_zero_activity). The EXISTENCE of a reconciliation row proves nothing.
-- reconciliation_json shape: { "coverage_declared_complete": bool,
--   "sources": { "<registry_id>": { "complete": bool, "missing": int, "undecidable": int, "run_id": text, "at": text, "kind": text } } }
-- Nothing in this file writes reconciliation_*; a future, separately approved recorder does.
--
-- (applied as ONE transaction by apply_migration; do not add begin/commit)

create table if not exists public.subscriber_zip_lifecycle (
  zip                  text primary key check (zip ~ '^[0-9]{5}$'),
  stage                text not null default 'registration' check (stage in (
    'registration','geographic_validation','coverage_audit','source_assessment','remediation_queue','reconciliation',
    'scheduled_refresh','public_page_verification','tab2_monitoring','draft_eligibility')),
  stage_reason         text,
  active_subscribers   integer not null default 0 check (active_subscribers >= 0),
  first_subscribed_at  timestamptz,
  registered_at        timestamptz not null default now(),
  stage_changed_at     timestamptz not null default now(),
  deprioritized_at     timestamptz,
  reconciliation_at    timestamptz,
  reconciliation_json  jsonb,
  last_attempt_at      timestamptz,          -- the last time a sync TRIED this ZIP
  last_success_at      timestamptz,          -- the last time a sync COMPLETED this ZIP; never updated by a failed attempt
  last_error           text,
  consecutive_failures integer not null default 0 check (consecutive_failures >= 0),
  constraint reconciliation_needs_evidence check (reconciliation_at is null or reconciliation_json is not null)
);
comment on column public.subscriber_zip_lifecycle.first_subscribed_at is
  'Subscriber-date definition not yet fixed: left NULL rather than inferred from users.created_at.';

create table if not exists public.subscriber_zip_lifecycle_history (
  id bigserial primary key, zip text not null, from_stage text, to_stage text not null, reason text, at timestamptz not null default now());

create table if not exists public.subscriber_zip_lifecycle_run (
  id           bigserial primary key,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  status       text not null check (status in ('success','partial','failed','skipped')),
  registered   integer, deprioritized integer, stage_changes integer, zips_failed integer,
  error        text
);

alter table public.subscriber_zip_lifecycle         enable row level security;   -- no policy: denies every non-owner, non-BYPASSRLS role
alter table public.subscriber_zip_lifecycle_history enable row level security;
alter table public.subscriber_zip_lifecycle_run     enable row level security;
revoke all on public.subscriber_zip_lifecycle, public.subscriber_zip_lifecycle_history, public.subscriber_zip_lifecycle_run
  from public, anon, authenticated;
revoke all on sequence public.subscriber_zip_lifecycle_history_id_seq, public.subscriber_zip_lifecycle_run_id_seq from public, anon, authenticated;
-- service_role is read-only here: only the SECURITY DEFINER sync (owner) writes, so no other path can edit reconciliation evidence.
revoke insert, update, delete, truncate on public.subscriber_zip_lifecycle, public.subscriber_zip_lifecycle_history,
  public.subscriber_zip_lifecycle_run from service_role;

-- One reconciliation entry -> valid? Pure.
create or replace function public._hs_lifecycle_recon_entry_valid(e jsonb)
returns boolean language sql stable set search_path = pg_catalog as $$
  select coalesce(e->>'complete' = 'true'
     and (e->>'missing') ~ '^[0-9]+$' and (e->>'missing')::int = 0
     and (e->>'undecidable') ~ '^[0-9]+$' and (e->>'undecidable')::int = 0
     and nullif(e->>'run_id','') is not null
     and e->>'kind' in ('verified_matched','verified_zero_activity')
     and nullif(e->>'at','') is not null and (e->>'at')::timestamptz >= now() - interval '168 hours', false) $$;
revoke all on function public._hs_lifecycle_recon_entry_valid(jsonb) from public, anon, authenticated;

-- Reconciliation ceiling for one ZIP: every source in the reader's list needs a valid entry AND discovery declared complete.
create or replace function public._hs_lifecycle_recon_ok(rec jsonb, core jsonb)
returns boolean language plpgsql stable set search_path = pg_catalog, public as $$
declare sid text;
begin
  if rec is null or coalesce(rec->>'coverage_declared_complete','') <> 'true' then return false; end if;
  if coalesce(jsonb_array_length(core->'sources'), 0) = 0 then return false; end if;
  for sid in select s->>'registry_id' from jsonb_array_elements(core->'sources') s loop
    if not public._hs_lifecycle_recon_entry_valid(rec->'sources'->sid) then return false; end if;
  end loop;
  return true;
end $$;
revoke all on function public._hs_lifecycle_recon_ok(jsonb, jsonb) from public, anon, authenticated;

-- The ceiling stage for one ZIP, from facts. Pure read.
create or replace function public._hs_subscriber_zip_stage(p_zip text, p_core jsonb, p_rec jsonb, p_rec_at timestamptz)
returns table(stage text, reason text) language plpgsql stable security definer set search_path = pg_catalog, public, geo as $$
declare
  has_community boolean := exists (select 1 from public.communities c where c.zip_codes @> array[p_zip]);
  has_boundary  boolean := exists (select 1 from geo.zcta_boundary b where b.zcta5 = p_zip);
  n_src int  := coalesce(jsonb_array_length(p_core->'sources'), 0);
  n_fail int := coalesce(jsonb_array_length(p_core->'failures_without_records'), 0)
                + coalesce((select count(*) from jsonb_array_elements(coalesce(p_core->'sources','[]'::jsonb)) s where (s->>'failures_48h')::int > 0), 0);
  unexplained int := coalesce((p_core->>'not_in_serving_generation')::int, 0);
  rep_at timestamptz := nullif(p_core->'report'->>'refreshed_at','')::timestamptz;
begin
  if not has_community then return query select 'geographic_validation'::text, 'no ZIP community row'::text; return; end if;
  if not has_boundary   then return query select 'geographic_validation'::text, 'no ZCTA boundary: boundary not verified'::text; return; end if;
  if n_src = 0          then return query select 'source_assessment'::text, 'no development source has stored a record'::text; return; end if;
  if n_fail > 0 or unexplained > 0 then return query select 'remediation_queue'::text, 'failed source read or unexplained missing map record'::text; return; end if;
  if p_rec_at is null or not public._hs_lifecycle_recon_ok(p_rec, p_core) then
    return query select 'reconciliation'::text, 'no valid reconciliation for every applicable source, or applicable-source discovery not declared complete'::text; return; end if;
  if rep_at is null or rep_at < now() - interval '72 hours' then return query select 'scheduled_refresh'::text, 'ZIP report is not current'::text; return; end if;
  return query select 'public_page_verification'::text, 'reconciled and refreshed; public page and Map 1 proof not recorded here'::text;
end $$;
revoke all on function public._hs_subscriber_zip_stage(text, jsonb, jsonb, timestamptz) from public, anon, authenticated;

create or replace function public._hs_lifecycle_lock_key() returns bigint language sql immutable set search_path = pg_catalog as
$$ select hashtextextended('homesignal.subscriber_zip_lifecycle_sync', 0) $$;
revoke all on function public._hs_lifecycle_lock_key() from public, anon, authenticated;

-- Idempotent daily bookkeeping. Never raises to its caller: a failure is RECORDED (run row + per-ZIP error) and returned.
-- Overlap: a second concurrent run does nothing and records a 'skipped' run.
create or replace function public.subscriber_zip_lifecycle_sync()
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  r record; core jsonb; st record; cur text;
  v_added int := 0; v_moved int := 0; v_dropped int := 0; v_failed int := 0; v_started timestamptz := clock_timestamp();
begin
  if not pg_try_advisory_xact_lock(public._hs_lifecycle_lock_key()) then
    insert into public.subscriber_zip_lifecycle_run (started_at, finished_at, status, error)
      values (v_started, clock_timestamp(), 'skipped', 'another lifecycle sync holds the lock');
    return jsonb_build_object('status', 'skipped', 'reason', 'another run is active');
  end if;
  begin
    insert into public.subscriber_zip_lifecycle (zip, active_subscribers)
    select c.zip, count(*) from public.bsky_maps_priority_classification c
     where c.class = 'eligible' and c.zip ~ '^[0-9]{5}$' group by c.zip
    on conflict (zip) do update set active_subscribers = excluded.active_subscribers, deprioritized_at = null
    where public.subscriber_zip_lifecycle.active_subscribers is distinct from excluded.active_subscribers
       or public.subscriber_zip_lifecycle.deprioritized_at is not null;
    get diagnostics v_added = row_count;

    update public.subscriber_zip_lifecycle l set active_subscribers = 0, deprioritized_at = coalesce(l.deprioritized_at, now())
     where l.deprioritized_at is null and not exists (
       select 1 from public.bsky_maps_priority_classification c where c.zip = l.zip and c.class = 'eligible');
    get diagnostics v_dropped = row_count;

    for r in select l.zip, l.stage, l.reconciliation_json, l.reconciliation_at from public.subscriber_zip_lifecycle l where l.deprioritized_at is null loop
      begin
        select e into core from jsonb_array_elements(public._hs_subscriber_zip_health_core()) e where e->>'zip' = r.zip;
        select * into st from public._hs_subscriber_zip_stage(r.zip, coalesce(core, '{}'::jsonb), r.reconciliation_json, r.reconciliation_at);
        cur := r.stage;
        if st.stage is distinct from cur then
          update public.subscriber_zip_lifecycle set stage = st.stage, stage_reason = st.reason, stage_changed_at = now(),
            last_attempt_at = now(), last_success_at = now(), last_error = null, consecutive_failures = 0 where zip = r.zip;
          insert into public.subscriber_zip_lifecycle_history (zip, from_stage, to_stage, reason) values (r.zip, cur, st.stage, st.reason);
          v_moved := v_moved + 1;
        else
          update public.subscriber_zip_lifecycle set stage_reason = st.reason, last_attempt_at = now(), last_success_at = now(),
            last_error = null, consecutive_failures = 0 where zip = r.zip;
        end if;
      exception when others then
        update public.subscriber_zip_lifecycle set last_attempt_at = now(), last_error = left(sqlerrm, 500),
          consecutive_failures = consecutive_failures + 1 where zip = r.zip;   -- last_success_at deliberately untouched
        v_failed := v_failed + 1;
      end;
    end loop;

    insert into public.subscriber_zip_lifecycle_run (started_at, finished_at, status, registered, deprioritized, stage_changes, zips_failed)
      values (v_started, clock_timestamp(), case when v_failed > 0 then 'partial' else 'success' end, v_added, v_dropped, v_moved, v_failed);
    return jsonb_build_object('status', case when v_failed > 0 then 'partial' else 'success' end,
      'registered_or_updated', v_added, 'deprioritized', v_dropped, 'stage_changes', v_moved, 'zips_failed', v_failed);
  exception when others then
    -- this block's writes are rolled back; the row below is written after, so a failure is never silent
    insert into public.subscriber_zip_lifecycle_run (started_at, finished_at, status, error)
      values (v_started, clock_timestamp(), 'failed', left(sqlerrm, 500));
    return jsonb_build_object('status', 'failed', 'error', left(sqlerrm, 200));
  end;
end $$;
revoke all on function public.subscriber_zip_lifecycle_sync() from public, anon, authenticated;

-- Admin read for Tab 2. Takes NO caller-supplied ZIP or filter; aggregate-only (no subscriber identity).
create or replace function public.hs_subscriber_zip_lifecycle()
returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare caller_email text := auth.jwt() ->> 'email';
begin
  if caller_email is null or not exists (select 1 from public.dashboard_admins da where da.email = caller_email) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'zips', coalesce((select jsonb_agg(jsonb_build_object('zip', zip, 'stage', stage, 'stage_reason', stage_reason,
        'active_subscribers', active_subscribers, 'stage_changed_at', stage_changed_at, 'deprioritized_at', deprioritized_at,
        'reconciliation_at', reconciliation_at, 'last_attempt_at', last_attempt_at, 'last_success_at', last_success_at,
        'consecutive_failures', consecutive_failures, 'last_error', last_error) order by zip) from public.subscriber_zip_lifecycle), '[]'::jsonb),
    'unregistered_subscriber_zips', coalesce((select jsonb_agg(z order by z) from (
        select distinct c.zip z from public.bsky_maps_priority_classification c
         where c.class = 'eligible' and c.zip ~ '^[0-9]{5}$'
           and not exists (select 1 from public.subscriber_zip_lifecycle l where l.zip = c.zip)) q), '[]'::jsonb),
    'run', jsonb_build_object(
        'last_attempt_at', (select max(started_at) from public.subscriber_zip_lifecycle_run),
        'last_attempt_status', (select status from public.subscriber_zip_lifecycle_run order by id desc limit 1),
        'last_success_at', (select max(finished_at) from public.subscriber_zip_lifecycle_run where status = 'success'),
        'failed_runs_since_last_success', (select count(*) from public.subscriber_zip_lifecycle_run r
            where r.status = 'failed' and r.id > coalesce((select max(id) from public.subscriber_zip_lifecycle_run where status = 'success'), 0))));
end $$;
revoke all on function public.hs_subscriber_zip_lifecycle() from public, anon;
grant execute on function public.hs_subscriber_zip_lifecycle() to authenticated;
