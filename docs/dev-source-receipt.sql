-- ============================================================================
-- SOURCE COMPLETION RECEIPT  (SQL OF RECORD, NOT APPLIED)
--
-- The change ledger needs, per ZIP x source, a POSITIVE record of what scope the cached generation was read under and
-- whether that read finished. Nothing existing says so: dev_refresh_source_failures records only what went WRONG, and "no
-- failure row" is the absence of evidence, not evidence of a complete read. The connectors now attach a receipt to each run
-- report (supabase/functions/get-address-report/sources/scope-receipt.ts); this file persists it.
--
-- WHAT IS RECORDED, per ZIP x source x collected response:
--   scope          expanded | fallback | legacy   (from the connector's receipt)
--                  failed                         (the fetch failed: the EXISTING dev_failed_sources authority, never a receipt)
--   scope_version  identity of the expanded scope used (null unless expanded)
--   complete       a positive statement: no truncation, no failed/unresolved membership test, no overflow, no failure
--   tick_at        development_reports.refreshed_at of the generation this response PRODUCED — the same clock the ledger's
--                  synchronisation probe already compares row generations with. A receipt describes a generation only when
--                  tick_at equals the cache's current refreshed_at.
--
-- HOW IT STAYS LINKED TO THE GENERATION WITHOUT TOUCHING dev_refresh_collect (a 15.8 KB live body):
--   the collector sets development_reports.last_collected_response_id for every response it EVALUATES (accepted or not) and
--   advances refreshed_at (= now() of that transaction) only when the write is ACCEPTED. dev_refresh_receipts_collect reads
--   the response named by that cursor and records a receipt only if refreshed_at >= the response's arrival (the write was
--   accepted from that response). A refused or vanished response leaves a registry_id = '' marker (so it is not re-read) and
--   NO receipt: the ledger then has no evidence for that generation and fails closed.
--   Runs every minute (job suggested at the foot); the collector fires <= 8 ZIPs per 2 minutes, so a generation is receipted
--   within a minute of being written. Receipts older than 7 days are pruned.
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

create table if not exists public.dev_refresh_source_receipt (
  zip           text        not null,
  registry_id   text        not null,          -- '' = a processed-response marker (refused / vanished), never a source
  response_id   bigint      not null,
  tick_at       timestamptz not null,          -- the generation clock this receipt describes (development_reports.refreshed_at)
  scope         text        not null check (scope in ('expanded', 'fallback', 'legacy', 'failed', 'refused', 'lost', 'processed')),
  scope_version text,
  complete      boolean     not null,
  fetched       integer,
  recorded_at   timestamptz not null default now(),
  primary key (zip, registry_id, response_id),
  constraint dev_source_receipt_version check ((scope = 'expanded') = (scope_version is not null))
);
create index if not exists dev_refresh_source_receipt_tick_idx on public.dev_refresh_source_receipt (zip, tick_at);
create index if not exists dev_refresh_source_receipt_recorded_idx on public.dev_refresh_source_receipt (recorded_at);
alter table public.dev_refresh_source_receipt enable row level security;
revoke all on public.dev_refresh_source_receipt from public, anon, authenticated, service_role;
grant select on public.dev_refresh_source_receipt to service_role;

-- One row per source in a response: the connector's receipt when it has one, 'failed' from the existing failure authority, else
-- 'legacy' (a connector with no spatial scope, or a pre-receipt payload) with completeness = "not truncated".
create or replace function public.dev_source_receipts(j jsonb)
returns table (registry_id text, scope text, scope_version text, complete boolean, fetched integer)
language sql immutable set search_path = public as $$
  select r->>'registry_id',
         case when r->>'registry_id' in (select f.registry_id from public.dev_failed_sources(j) f) then 'failed'
              when r->'scope_receipt'->>'scope' in ('expanded', 'fallback', 'legacy') then r->'scope_receipt'->>'scope'
              else 'legacy' end,
         case when r->>'registry_id' not in (select f.registry_id from public.dev_failed_sources(j) f)
                   and r->'scope_receipt'->>'scope' = 'expanded' then r->'scope_receipt'->>'version' end,
         case when r->>'registry_id' in (select f.registry_id from public.dev_failed_sources(j) f) then false
              when r->'scope_receipt' ? 'complete' then coalesce((r->'scope_receipt'->>'complete')::boolean, false)
              else r->>'truncated_at_max_rows' is null end,
         nullif(r->>'fetched', '')::integer
    from jsonb_array_elements(
           coalesce(j->'arcgis_reports', '[]'::jsonb) || coalesce(j->'socrata_reports', '[]'::jsonb)
        || coalesce(j->'carto_reports',  '[]'::jsonb) || coalesce(j->'ckan_reports',    '[]'::jsonb)
        || coalesce(j->'csv_reports',    '[]'::jsonb)) r
   where r->>'registry_id' is not null and r->>'registry_id' <> ''
$$;

-- An 'expanded' receipt without a version cannot be compared with anything: it is demoted to legacy/incomplete below rather than
-- stored as an unverifiable claim.
create or replace function public.dev_refresh_receipts_collect(p_max integer default 50) returns integer
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare n integer := 0; z record; resp record;
begin
  if not pg_try_advisory_xact_lock(hashtext('dev_refresh_receipts')) then return 0; end if;
  for z in
    select d.zip, d.refreshed_at, d.last_collected_response_id as rid
      from public.development_reports d
     where d.last_collected_response_id is not null
       and not exists (select 1 from public.dev_refresh_source_receipt r
                        where r.zip = d.zip and r.response_id = d.last_collected_response_id)
     order by d.last_collected_response_id
     limit greatest(p_max, 1)
  loop
    select h.created, h.status_code, case when left(ltrim(h.content), 1) = '{' then h.content::jsonb end as j
      into resp from net._http_response h where h.id = z.rid;
    if not found or resp.status_code is distinct from 200 or resp.j is null or resp.j->>'zip' is distinct from z.zip then
      insert into public.dev_refresh_source_receipt (zip, registry_id, response_id, tick_at, scope, complete)
      values (z.zip, '', z.rid, coalesce(z.refreshed_at, now()), 'lost', false) on conflict do nothing;
    elsif z.refreshed_at is null or z.refreshed_at < resp.created then
      insert into public.dev_refresh_source_receipt (zip, registry_id, response_id, tick_at, scope, complete)
      values (z.zip, '', z.rid, coalesce(z.refreshed_at, now()), 'refused', false) on conflict do nothing;
    else
      insert into public.dev_refresh_source_receipt (zip, registry_id, response_id, tick_at, scope, scope_version, complete, fetched)
      select z.zip, s.registry_id, z.rid, z.refreshed_at,
             case when s.scope = 'expanded' and s.scope_version is null then 'legacy' else s.scope end,
             case when s.scope = 'expanded' then s.scope_version end,
             case when s.scope = 'expanded' and s.scope_version is null then false else s.complete end, s.fetched
        from public.dev_source_receipts(resp.j) s
      on conflict do nothing;
      -- the marker, so a ZIP whose response named no source is not re-read every minute
      insert into public.dev_refresh_source_receipt (zip, registry_id, response_id, tick_at, scope, complete)
      values (z.zip, '', z.rid, z.refreshed_at, 'processed', false) on conflict do nothing;
    end if;
    n := n + 1;
  end loop;
  delete from public.dev_refresh_source_receipt where recorded_at < now() - interval '7 days';
  return n;
end $fn$;

revoke all on function public.dev_source_receipts(jsonb) from public, anon, authenticated;
grant execute on function public.dev_source_receipts(jsonb) to service_role;
revoke all on function public.dev_refresh_receipts_collect(integer) from public, anon, authenticated;
grant execute on function public.dev_refresh_receipts_collect(integer) to service_role;

-- The health view the ledger and operators read: the newest receipt per ZIP x source, never a source's absence read as health.
create or replace view public.dev_source_receipt_current with (security_invoker = true) as
select r.zip, r.registry_id, r.scope, r.scope_version, r.complete, r.tick_at,
       (r.tick_at = d.refreshed_at) as describes_current_cache
  from public.dev_refresh_source_receipt r
  join public.development_reports d on d.zip = r.zip
 where r.registry_id <> ''
   and r.tick_at = (select max(x.tick_at) from public.dev_refresh_source_receipt x where x.zip = r.zip and x.registry_id = r.registry_id);
revoke all on public.dev_source_receipt_current from public, anon, authenticated, service_role;
grant select on public.dev_source_receipt_current to service_role;

-- SCHEDULE (separate, deliberate act; NOT executed here):
--   select cron.schedule('dev-refresh-receipts', '* * * * *', 'select public.dev_refresh_receipts_collect()');
-- ROLLBACK: select cron.unschedule('dev-refresh-receipts');  drop view public.dev_source_receipt_current;
--   drop function public.dev_refresh_receipts_collect(integer), public.dev_source_receipts(jsonb);
--   drop table public.dev_refresh_source_receipt;   (diagnostic state; nothing else reads it until the ledger rule that uses it ships)
