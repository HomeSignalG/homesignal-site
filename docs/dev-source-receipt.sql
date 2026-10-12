-- ============================================================================
-- ACCEPTED-GENERATION RECEIPT + DURABLE SOURCE CONTINUITY   (SQL OF RECORD, NOT APPLIED)
--
-- THE CHAIN THE LEDGER MUST BE ABLE TO PROVE, each link a separate fact:
--   official source response -> successful source completion -> ACCEPTED cache generation -> materialisation
--   -> comparable ledger observation -> truthful notification.
-- This file owns links 2-3: what scope each source ran under and whether it finished (the connector's receipt, in the response
-- payload), and WHICH response produced WHICH accepted cache generation.
--
-- WHY A TRIGGER AND NOT A SECOND JOB (the previous revision polled net._http_response from a separate job):
--   dev_refresh_collect step (d) writes `refreshed_at = now()` and `last_collected_response_id = resp.rid` in ONE row update, and
--   only for a response it ACCEPTS. Step (e) moves the cursor alone for a response it evaluated and REFUSED. So the row update
--   itself is the proof of acceptance: an AFTER UPDATE trigger on development_reports sees, in the same transaction,
--     cursor moved up AND refreshed_at moved   => this response produced this generation        (accepted)
--     cursor moved up, refreshed_at unchanged  => evaluated and refused                          (refused)
--     refreshed_at moved, cursor did not       => a write nobody can attribute to a response     (unattributed)
--     cursor moved DOWN                        => the restart heal (R); not an event
--   Because it runs inside the collector's transaction:
--     * a rolled-back cache write rolls back its receipt (and its continuity step) with it;
--     * there is no window in which a generation exists without evidence, no polling, no cursor of its own, no lost response, and
--       no scheduled job;
--     * dev_refresh_collect is NOT modified (its live body, md5 2012877397532a1e8e160b5a7a4c8032, is untouched);
--     * a trigger that FAILS never blocks the collector (the cache write must not be held hostage to diagnostics); it records the
--       generation as having no evidence, which the ledger reads as a coverage break (fail closed).
--
-- WHAT IS DURABLE, per ZIP x source: public.dev_source_continuity — ONE row, updated in place (never a second event ledger, never a
--   copy of a payload). It carries a generation sequence number and a BREAK sequence number:
--     gen_seq    counts the accepted generations processed for this source
--     break_seq  the gen_seq of the latest generation that was NOT an unbroken, comparable, complete continuation
--   A ledger baseline taken at generation s is CONTINUOUS now iff s >= break_seq (and the scope version is unchanged): every
--   generation after s has been a complete read of the same expanded scope, whether or not anyone observed it. This needs no
--   receipt history, so no retention window can silently turn a continuously monitored source into a "broken" one.
--   A later successful refresh cannot erase an unresolved gap: break_seq only moves FORWARD, and only a baseline taken at or
--   after it (a quiet re-baseline by the ledger) clears the obligation.
--
-- WHAT IS DIAGNOSTIC AND PRUNED: public.dev_refresh_generation — one row per accepted/refused/unattributed event (7 days). It is
--   the audit answer to "which response produced this cache row", not an input to any decision.
--
-- SCOPE VERSION: the connector states the identity of the expanded scope it ran (rule version, envelope, radius, the canonical
--   polygon's geometry identity, and the source's material configuration — sources/scope-receipt.ts). A version that changes is a
--   break, so a baseline never survives an incompatible polygon or configuration.
-- ============================================================================
do $pre$
begin
  if to_regclass('public.development_reports') is null or to_regprocedure('public.dev_failed_sources(jsonb)') is null
     or to_regclass('net._http_response') is null then
    raise exception 'dev_source_receipt: development_reports, dev_failed_sources or net._http_response is missing';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public'
                  and table_name = 'development_reports' and column_name = 'last_collected_response_id') then
    raise exception 'dev_source_receipt: development_reports.last_collected_response_id (docs/dev-refresh-collect-once-per-response.sql) is required';
  end if;
end $pre$;

-- ── diagnostic: which response produced which generation (pruned) ───────────────────────────────────────────────────────────────
create table if not exists public.dev_refresh_generation (
  zip         text        not null,
  response_id bigint      not null default 0,     -- 0 = no response is named (an unattributed write)
  outcome     text        not null check (outcome in ('accepted', 'refused', 'unattributed', 'unreadable', 'receipt_error')),
  tick_at     timestamptz not null,               -- development_reports.refreshed_at AFTER the event (the cache clock)
  sources     integer,
  not_complete integer,
  recorded_at timestamptz not null default now(),
  primary key (zip, response_id, outcome, tick_at)
);
create index if not exists dev_refresh_generation_recorded_idx on public.dev_refresh_generation (recorded_at);
alter table public.dev_refresh_generation enable row level security;
revoke all on public.dev_refresh_generation from public, anon, authenticated, service_role;
grant select on public.dev_refresh_generation to service_role;

-- ── durable: one row per ZIP x source ───────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.dev_source_continuity (
  zip              text        not null,
  registry_id      text        not null,
  gen_seq          bigint      not null,
  break_seq        bigint      not null,
  break_reason     text        not null,
  break_at         timestamptz not null,
  scope            text        not null check (scope in ('expanded', 'fallback', 'legacy', 'failed', 'absent', 'retired', 'unattributed')),
  scope_version    text,
  complete         boolean     not null,
  fetched          integer,
  last_tick_at     timestamptz not null,          -- the cache generation this row last described (= development_reports.refreshed_at then)
  last_response_id bigint,
  ever_expanded    boolean     not null default false,
  impaired_since   timestamptz,                   -- start of the CURRENT unresolved monitoring gap; null when none
  gap_generations  integer     not null default 0,
  gaps_total       integer     not null default 0,
  gap_seconds_total bigint     not null default 0,
  last_gap_seconds bigint,
  last_restored_at timestamptz,
  first_seen_at    timestamptz not null,
  updated_at       timestamptz not null default now(),
  primary key (zip, registry_id),
  constraint dev_continuity_version check ((scope = 'expanded') or scope_version is null),
  constraint dev_continuity_order check (break_seq <= gen_seq and break_seq >= 1)
);
alter table public.dev_source_continuity enable row level security;
revoke all on public.dev_source_continuity from public, anon, authenticated, service_role;
grant select on public.dev_source_continuity to service_role;

-- One row per source in a response: the connector's receipt when it has one, 'failed' from the existing failure authority, else
-- 'legacy' (a connector with no spatial scope, or a pre-receipt payload) with completeness = "not truncated". The failure authority
-- is evaluated ONCE per payload.
create or replace function public.dev_source_receipts(j jsonb)
returns table (registry_id text, scope text, scope_version text, complete boolean, fetched integer)
language sql immutable set search_path = public as $$
  with f as materialized (select x.registry_id from public.dev_failed_sources(j) x),
       r as (
         select e as r from jsonb_array_elements(
                  coalesce(j->'arcgis_reports', '[]'::jsonb) || coalesce(j->'socrata_reports', '[]'::jsonb)
               || coalesce(j->'carto_reports',  '[]'::jsonb) || coalesce(j->'ckan_reports',    '[]'::jsonb)
               || coalesce(j->'csv_reports',    '[]'::jsonb)) e)
  select r.r->>'registry_id',
         case when r.r->>'registry_id' in (select registry_id from f) then 'failed'
              when r.r->'scope_receipt'->>'scope' = 'expanded' and nullif(r.r->'scope_receipt'->>'version', '') is null then 'legacy'
              when r.r->'scope_receipt'->>'scope' in ('expanded', 'fallback', 'legacy') then r.r->'scope_receipt'->>'scope'
              else 'legacy' end,
         case when r.r->>'registry_id' not in (select registry_id from f) and r.r->'scope_receipt'->>'scope' = 'expanded'
              then nullif(r.r->'scope_receipt'->>'version', '') end,
         case when r.r->>'registry_id' in (select registry_id from f) then false
              when r.r->'scope_receipt'->>'scope' = 'expanded' and nullif(r.r->'scope_receipt'->>'version', '') is null then false
              when r.r->'scope_receipt' ? 'complete' then coalesce((r.r->'scope_receipt'->>'complete')::boolean, false)
              else r.r->>'truncated_at_max_rows' is null end,
         nullif(r.r->>'fetched', '')::integer
    from r
   where r.r->>'registry_id' is not null and r.r->>'registry_id' <> ''
$$;

-- MEASURED (disposable Postgres, a 2.2 MB / 2,500-site / 40-source payload): with the default plan cache the planner constant-folds the
-- payload into every statement of the step and PLANNING alone took ~120-135 ms per generation; `plan_cache_mode = force_generic_plan`
-- keeps the payload a parameter (step ~2 ms of work). Both functions below carry it for that reason — do not remove it.
-- ── ONE generation step: given the payload that produced a generation (or none), advance every source row of the ZIP ─────────
-- p_resp = the response that produced it (null when unattributed); p_j = its payload (null when unreadable / unattributed).
-- Idempotent: a step is applied to a row only if its tick is newer than the row's last tick.
create or replace function public.dev_continuity_step(p_zip text, p_tick timestamptz, p_resp bigint, p_j jsonb, p_why text default null, p_old_sites jsonb default null)
returns table (sources integer, not_complete integer)
language plpgsql security definer set search_path = public, pg_temp set plan_cache_mode = force_generic_plan as $fn$
declare n integer := 0; nc integer := 0;
begin
  with src as (
    select s.registry_id, s.scope, s.scope_version, s.complete, s.fetched from public.dev_source_receipts(p_j) s where p_j is not null
  ),
  cur as (select c.* from public.dev_source_continuity c where c.zip = p_zip),
  -- sources that contributed cached records to the generation being REPLACED (dev_retired_sources' own definition, read from the
  -- row's OLD sites because this runs after the write): an absent one among them is an explained retirement, not an unexplained loss
  ret as materialized (select distinct e->>'source_registry_id' as registry_id
            from jsonb_array_elements(case when jsonb_typeof(p_old_sites) = 'array' then p_old_sites else '[]'::jsonb end) e
           where e->>'source_registry_id' is not null),
  m as (
    select coalesce(s.registry_id, c.registry_id) as registry_id,
           case when p_j is null then coalesce(p_why, 'unattributed')
                when s.registry_id is null then 'absent'
                else s.scope end as scope_in,
           s.scope_version as v_in, coalesce(s.complete, false) as complete_in, s.fetched as fetched_in,
           c.gen_seq as o_gen, c.break_seq as o_break, c.break_reason as o_reason, c.break_at as o_break_at,
           c.scope as o_scope, c.scope_version as o_version, c.complete as o_complete, c.impaired_since as o_imp,
           c.ever_expanded as o_ever, c.gap_generations as o_gapgen, c.gaps_total as o_gaps, c.gap_seconds_total as o_gapsec,
           c.last_gap_seconds as o_lastgap, c.last_restored_at as o_restored, c.first_seen_at as o_first,
           (s.registry_id is null and exists (select 1 from ret r where r.registry_id = c.registry_id)) as is_retired
      from src s full join cur c on c.registry_id = s.registry_id
     where p_j is not null or c.registry_id is not null
  ),
  k as (
    select m.*,
           case when m.scope_in = 'absent' and (not coalesce(m.o_ever, false) or m.is_retired) then 'retired'
                when m.scope_in in ('receipt_error', 'unreadable') then 'unattributed'
                else m.scope_in end as scope_n,
           coalesce(m.o_ever, false) or m.scope_in = 'expanded' as ever_n
      from m
  ),
  q as (
    select k.*,
           -- a comparable, complete read of the expanded scope: the only generation that can continue a baseline
           (k.scope_n = 'expanded' and k.complete_in and k.v_in is not null) as ok_n,
           -- the previous generation was such a read (an expanded read that is complete and versioned is by construction unimpaired)
           (k.o_scope = 'expanded' and k.o_complete and k.o_version is not null) as prev_ok
      from k
  ),
  z as (
    select q.*,
           coalesce(q.o_gen, 0) + 1 as gen_n,
           (q.ok_n and q.prev_ok and q.o_version = q.v_in) as cont,
           -- impairment: monitoring that WAS (or is being) established is not being delivered by this generation
           case q.scope_n
             when 'expanded'     then not q.ok_n
             when 'fallback'     then true
             when 'retired'      then false
             else q.ever_n       -- legacy / failed / absent / unattributed matter only for a source that was ever expanded
           end as impaired_n
      from q
  )
  insert into public.dev_source_continuity as t
        (zip, registry_id, gen_seq, break_seq, break_reason, break_at, scope, scope_version, complete, fetched, last_tick_at,
         last_response_id, ever_expanded, impaired_since, gap_generations, gaps_total, gap_seconds_total, last_gap_seconds,
         last_restored_at, first_seen_at)
  select p_zip, z.registry_id, z.gen_n,
         case when z.cont then z.o_break else z.gen_n end,
         case when z.cont then z.o_reason
              when z.ok_n and z.o_gen is null then 'first_generation'
              when z.ok_n and z.o_imp is not null then 'restored_after_gap'
              when z.ok_n and z.prev_ok then 'scope_version_changed'
              when z.ok_n then 'scope_expanded'
              when z.scope_n = 'expanded' then 'incomplete_read'
              when z.scope_n = 'unattributed' then 'unattributed_write'
              else z.scope_n end,
         case when z.cont then z.o_break_at else p_tick end,
         z.scope_n, case when z.scope_n = 'expanded' then z.v_in end, z.complete_in and z.scope_n <> 'unattributed', z.fetched_in, p_tick,
         p_resp, z.ever_n,
         case when z.impaired_n then coalesce(z.o_imp, p_tick) end,
         case when z.impaired_n then coalesce(z.o_gapgen, 0) + 1 else 0 end,
         coalesce(z.o_gaps, 0) + case when z.o_imp is not null and not z.impaired_n then 1 else 0 end,
         coalesce(z.o_gapsec, 0) + case when z.o_imp is not null and not z.impaired_n then greatest(extract(epoch from p_tick - z.o_imp), 0)::bigint else 0 end,
         case when z.o_imp is not null and not z.impaired_n then greatest(extract(epoch from p_tick - z.o_imp), 0)::bigint else z.o_lastgap end,
         case when z.o_imp is not null and not z.impaired_n then p_tick else z.o_restored end,
         coalesce(z.o_first, p_tick)
    from z
  on conflict (zip, registry_id) do update set
         gen_seq = excluded.gen_seq, break_seq = excluded.break_seq, break_reason = excluded.break_reason, break_at = excluded.break_at,
         scope = excluded.scope, scope_version = excluded.scope_version, complete = excluded.complete, fetched = excluded.fetched,
         last_tick_at = excluded.last_tick_at, last_response_id = excluded.last_response_id, ever_expanded = excluded.ever_expanded,
         impaired_since = excluded.impaired_since, gap_generations = excluded.gap_generations, gaps_total = excluded.gaps_total,
         gap_seconds_total = excluded.gap_seconds_total, last_gap_seconds = excluded.last_gap_seconds,
         last_restored_at = excluded.last_restored_at, updated_at = now()
   where t.last_tick_at < excluded.last_tick_at;
  select count(*), count(*) filter (where not c.complete or c.scope not in ('expanded'))
    into n, nc from public.dev_source_continuity c where c.zip = p_zip and c.last_tick_at = p_tick;
  return query select n, nc;
end $fn$;

-- ── THE TRIGGER: the row update itself is the proof ───────────────────────────────────────────────────────────────────────────
create or replace function public.dev_reports_generation_receipt() returns trigger
language plpgsql security definer set search_path = public, pg_temp set plan_cache_mode = force_generic_plan as $fn$
declare r record; j jsonb; moved boolean; resp bigint; s record; outcome text;
begin
  moved := new.last_collected_response_id is not null
           and new.last_collected_response_id > coalesce(old.last_collected_response_id, 0);   -- a DOWNWARD move is the restart heal
  if new.refreshed_at is not null and new.refreshed_at > coalesce(old.refreshed_at, '-infinity'::timestamptz) then
    -- ACCEPTED WRITE: the cache clock moved forward. If the cursor moved in the same row update, that response produced it.
    begin
      resp := case when moved then new.last_collected_response_id end;
      outcome := case when moved then 'accepted' else 'unattributed' end;
      if moved then
        select h.status_code, h.content into r from net._http_response h where h.id = resp;
        if found and r.status_code = 200 and left(ltrim(r.content), 1) = '{' then
          j := r.content::jsonb;
          if j->>'zip' is distinct from new.zip then j := null; end if;
        end if;
        if j is null then outcome := 'unreadable'; end if;     -- accepted, but its payload cannot be read: no evidence
      end if;
      select * into s from public.dev_continuity_step(new.zip, new.refreshed_at, resp, j, outcome, old.sites);
      insert into public.dev_refresh_generation (zip, response_id, outcome, tick_at, sources, not_complete)
      values (new.zip, coalesce(resp, 0), outcome, new.refreshed_at, s.sources, s.not_complete) on conflict do nothing;
      delete from public.dev_refresh_generation g where g.zip = new.zip and g.recorded_at < now() - interval '7 days';
    exception when others then
      -- FAIL CLOSED, NEVER BLOCK THE COLLECTOR: record the generation as having no evidence (every existing source row breaks).
      begin
        perform public.dev_continuity_step(new.zip, new.refreshed_at, resp, null, 'receipt_error');
        insert into public.dev_refresh_generation (zip, response_id, outcome, tick_at)
        values (new.zip, coalesce(resp, 0), 'receipt_error', new.refreshed_at) on conflict do nothing;
      exception when others then null;   -- no evidence at all: the ledger sees last_tick_at <> refreshed_at and holds
      end;
    end;
  elsif moved then
    -- EVALUATED AND REFUSED: the cursor moved, the cache did not. The cache still describes the previous generation.
    insert into public.dev_refresh_generation (zip, response_id, outcome, tick_at)
    values (new.zip, new.last_collected_response_id, 'refused', coalesce(new.refreshed_at, now())) on conflict do nothing;
  end if;
  return null;
end $fn$;

drop trigger if exists dev_reports_generation_receipt_trg on public.development_reports;
create trigger dev_reports_generation_receipt_trg
  after update of last_collected_response_id, refreshed_at on public.development_reports
  for each row
  when (new.last_collected_response_id is distinct from old.last_collected_response_id
        or new.refreshed_at is distinct from old.refreshed_at)
  execute function public.dev_reports_generation_receipt();

revoke all on function public.dev_source_receipts(jsonb) from public, anon, authenticated;
grant execute on function public.dev_source_receipts(jsonb) to service_role;
revoke all on function public.dev_continuity_step(text, timestamptz, bigint, jsonb, text, jsonb) from public, anon, authenticated;
grant execute on function public.dev_continuity_step(text, timestamptz, bigint, jsonb, text, jsonb) to service_role;
revoke all on function public.dev_reports_generation_receipt() from public, anon, authenticated;

-- ── what the ledger and operators read: the durable row, joined to the cache clock ─────────────────────────────────────────────
create or replace view public.dev_source_continuity_state with (security_invoker = true) as
select c.zip, c.registry_id, c.scope, c.scope_version, c.complete, c.gen_seq, c.break_seq, c.break_reason, c.break_at,
       c.last_tick_at, c.last_response_id, c.ever_expanded, c.impaired_since, c.gap_generations, c.gaps_total,
       c.gap_seconds_total, c.last_gap_seconds, c.last_restored_at,
       (c.last_tick_at = d.refreshed_at) as describes_current_cache,
       case when c.scope = 'retired'                                                            then 'retired'
            when c.impaired_since is not null and c.scope in ('fallback', 'legacy')              then 'legacy_scope_fallback'
            when c.impaired_since is not null and c.scope in ('unattributed')                    then 'no_accepted_generation_evidence'
            when c.impaired_since is not null and c.scope = 'absent'                             then 'source_not_reported'
            when c.impaired_since is not null                                                    then 'failed_or_incomplete'
            when not c.ever_expanded                                                             then 'legacy_scope'
            when d.refreshed_at < now() - interval '72 hours'                                   then 'collection_delayed'
            when c.break_reason = 'scope_version_changed' and c.gen_seq = c.break_seq            then 'scope_version_changed'
            when c.gen_seq = c.break_seq                                                         then 'baseline_pending'
            else 'complete' end as continuity_state
  from public.dev_source_continuity c
  join public.development_reports d on d.zip = c.zip;
revoke all on public.dev_source_continuity_state from public, anon, authenticated, service_role;
grant select on public.dev_source_continuity_state to service_role;

-- ── NO SCHEDULE: nothing here runs on its own. ────────────────────────────────────────────────────────────────────────────────────
-- ROLLBACK (all diagnostic/derived; nothing else reads them until the ledger rule that uses them ships):
--   drop trigger dev_reports_generation_receipt_trg on public.development_reports;
--   drop view public.dev_source_continuity_state;
--   drop function public.dev_reports_generation_receipt(), public.dev_continuity_step(text,timestamptz,bigint,jsonb,text,jsonb), public.dev_source_receipts(jsonb);
--   drop table public.dev_source_continuity, public.dev_refresh_generation;
