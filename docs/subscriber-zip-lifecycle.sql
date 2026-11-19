-- Subscriber ZIP lifecycle (2026-11-19). SQL of record. ADDITIVE; NOT APPLIED to production (founder approves DDL).
--
-- WHY: Tab 2 "Subscriber ZIP Health" (docs/subscriber-zip-health.sql) is a live, stateless read. The founder asked for a
-- PERSISTENT, inspectable lifecycle:
--   registration -> geographic_validation -> coverage_audit -> source_assessment -> remediation_queue -> reconciliation
--   -> scheduled_refresh -> public_page_verification -> tab2_monitoring -> draft_eligibility
-- This file stores ONE row per subscriber ZIP (shared subscribers dedupe by construction: the key is the ZIP) and advances
-- its stage from facts that already exist. It never sends, publishes, deploys or activates a source.
--
-- TRUTH PATH (read only, nothing re-decided here):
--   who is a real subscriber  -> public.bsky_maps_priority_classification, class 'eligible' (homesignal-ingest; test and
--                                 unsubscribed identities are already excluded by that view)
--   boundary / jurisdictions  -> public.communities (zip_codes), geo.zcta_boundary
--   sources / failures / map  -> public._hs_subscriber_zip_health_core() (Tab 2's reader)
--
-- RULES:
--   * A stage is a CEILING from evidence, never a claim of completion. The stage never passes 'reconciliation' until a
--     reconciliation is recorded in reconciliation_at/reconciliation_json by a run that read the official source.
--   * A ZIP that loses every qualifying subscriber gets deprioritized_at set. Its row, history and shared sources stay.
--   * Rows are never deleted. Every stage change is appended to subscriber_zip_lifecycle_history.
--   * Unknown stays NULL, never inferred.
--
-- (applied as ONE transaction by apply_migration; do not add begin/commit)

create table if not exists public.subscriber_zip_lifecycle (
  zip                  text primary key check (zip ~ '^[0-9]{5}$'),
  stage                text not null default 'registration' check (stage in (
    'registration','geographic_validation','coverage_audit','source_assessment','remediation_queue','reconciliation',
    'scheduled_refresh','public_page_verification','tab2_monitoring','draft_eligibility')),
  stage_reason         text,
  active_subscribers   integer not null default 0 check (active_subscribers >= 0),
  first_subscribed_at  timestamptz,           -- NULL until the subscriber-date definition below is confirmed in ingest
  registered_at        timestamptz not null default now(),
  stage_changed_at     timestamptz not null default now(),
  deprioritized_at     timestamptz,
  reconciliation_at    timestamptz,           -- set ONLY by a run that completed an official-source read + record comparison
  reconciliation_json  jsonb,                 -- { complete, official_count, jody_count, missing, method, run_id }
  last_checked_at      timestamptz
);
comment on column public.subscriber_zip_lifecycle.first_subscribed_at is
  'Subscriber-date definition is NOT yet fixed: left NULL rather than inferred from users.created_at.';

create table if not exists public.subscriber_zip_lifecycle_history (
  id          bigserial primary key,
  zip         text not null,
  from_stage  text,
  to_stage    text not null,
  reason      text,
  at          timestamptz not null default now()
);

alter table public.subscriber_zip_lifecycle enable row level security;
alter table public.subscriber_zip_lifecycle_history enable row level security;
revoke all on public.subscriber_zip_lifecycle, public.subscriber_zip_lifecycle_history from public, anon, authenticated;
revoke all on sequence public.subscriber_zip_lifecycle_history_id_seq from public, anon, authenticated;

-- The ceiling stage for one ZIP, from facts. Pure read.
create or replace function public._hs_subscriber_zip_stage(p_zip text, p_core jsonb)
returns table(stage text, reason text) language plpgsql stable security definer set search_path = public, geo as $$
declare
  has_community boolean := exists (select 1 from public.communities c where c.zip_codes @> array[p_zip]);
  has_boundary  boolean := exists (select 1 from geo.zcta_boundary b where b.zcta5 = p_zip::bpchar);
  n_src int  := coalesce(jsonb_array_length(p_core->'sources'), 0);
  n_fail int := coalesce(jsonb_array_length(p_core->'failures_without_records'), 0)
                + coalesce((select count(*) from jsonb_array_elements(p_core->'sources') s where (s->>'failures_48h')::int > 0), 0);
  absent int := coalesce((p_core->>'not_in_serving_generation')::int, 0);
  rep_at timestamptz := nullif(p_core->'report'->>'refreshed_at','')::timestamptz;
  rec_at timestamptz;
begin
  select l.reconciliation_at into rec_at from public.subscriber_zip_lifecycle l where l.zip = p_zip;
  if not has_community then return query select 'geographic_validation', 'no ZIP community row'; return; end if;
  if not has_boundary   then return query select 'geographic_validation', 'no ZCTA boundary: boundary not verified'; return; end if;
  if n_src = 0          then return query select 'source_assessment', 'no development source has stored a record'; return; end if;
  if n_fail > 0 or absent > 0 then return query select 'remediation_queue', 'failed source read or records missing from Map 1'; return; end if;
  if rec_at is null     then return query select 'reconciliation', 'no official-source reconciliation recorded'; return; end if;
  if rep_at is null or rep_at < now() - interval '72 hours' then return query select 'scheduled_refresh', 'ZIP report is not current'; return; end if;
  return query select 'public_page_verification', 'reconciled and refreshed; public page and Map 1 proof not yet recorded';
end $$;
revoke all on function public._hs_subscriber_zip_stage(text, jsonb) from public, anon, authenticated;

-- Idempotent. Registers new subscriber ZIPs, refreshes subscriber counts, advances/regresses stage from evidence, and
-- deprioritizes (never deletes) a ZIP with no qualifying subscriber. Returns what it changed, for the run log.
create or replace function public.subscriber_zip_lifecycle_sync()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r record; core jsonb; st record; cur text; added int := 0; moved int := 0; dropped int := 0;
begin
  insert into public.subscriber_zip_lifecycle (zip, active_subscribers)
  select c.zip, count(*) from public.bsky_maps_priority_classification c
   where c.class = 'eligible' and c.zip ~ '^[0-9]{5}$' group by c.zip
  on conflict (zip) do update set active_subscribers = excluded.active_subscribers, deprioritized_at = null
  where public.subscriber_zip_lifecycle.active_subscribers is distinct from excluded.active_subscribers
     or public.subscriber_zip_lifecycle.deprioritized_at is not null;
  get diagnostics added = row_count;

  update public.subscriber_zip_lifecycle l set active_subscribers = 0, deprioritized_at = coalesce(l.deprioritized_at, now())
   where l.deprioritized_at is null and not exists (
     select 1 from public.bsky_maps_priority_classification c where c.zip = l.zip and c.class = 'eligible');
  get diagnostics dropped = row_count;

  for r in select l.zip, l.stage from public.subscriber_zip_lifecycle l where l.deprioritized_at is null loop
    select e into core from jsonb_array_elements(public._hs_subscriber_zip_health_core()) e where e->>'zip' = r.zip;
    select * into st from public._hs_subscriber_zip_stage(r.zip, coalesce(core, '{}'::jsonb));
    cur := r.stage;
    if st.stage is distinct from cur then
      update public.subscriber_zip_lifecycle set stage = st.stage, stage_reason = st.reason, stage_changed_at = now(), last_checked_at = now() where zip = r.zip;
      insert into public.subscriber_zip_lifecycle_history (zip, from_stage, to_stage, reason) values (r.zip, cur, st.stage, st.reason);
      moved := moved + 1;
    else
      update public.subscriber_zip_lifecycle set stage_reason = st.reason, last_checked_at = now() where zip = r.zip;
    end if;
  end loop;
  return jsonb_build_object('registered_or_updated', added, 'deprioritized', dropped, 'stage_changes', moved);
end $$;
revoke all on function public.subscriber_zip_lifecycle_sync() from public, anon, authenticated;

-- Admin read for Tab 2 (aggregate-only; no subscriber identity).
create or replace function public.hs_subscriber_zip_lifecycle()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare caller_email text := auth.jwt() ->> 'email';
begin
  if caller_email is null or not exists (select 1 from public.dashboard_admins da where da.email = caller_email) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('zip', zip, 'stage', stage, 'stage_reason', stage_reason,
      'active_subscribers', active_subscribers, 'stage_changed_at', stage_changed_at, 'deprioritized_at', deprioritized_at,
      'reconciliation_at', reconciliation_at, 'last_checked_at', last_checked_at) order by zip) from public.subscriber_zip_lifecycle), '[]'::jsonb);
end $$;
revoke all on function public.hs_subscriber_zip_lifecycle() from public, anon;
grant execute on function public.hs_subscriber_zip_lifecycle() to authenticated;
