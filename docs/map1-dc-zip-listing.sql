-- ════════════════════════════════════════════════════════════════════════════════════════════
-- MAP 1 DATA-CENTER LISTINGS, STORED PER ZIP, FOR THE PRE-BUILT ZIP PAGE (2026-11-14)
-- ════════════════════════════════════════════════════════════════════════════════════════════
-- The live ZIP page lists the national data-centre plane (public.map1_dc_zip_members) beside the
-- official records (lib/data.js HS.data.zipDevelopment). The document the build writes at
-- /community/<zip>/ (scripts/gen_zip_pages.py) did not: the build reads no per-ZIP development
-- rows, and calling map1_dc_zip_members for 12,746 ZIPs from the build is a minute of database
-- time per build through PostgREST.
--
-- This file stores, per registry ZIP, exactly what map1_dc_zip_members returns as 'member' for
-- that ZIP. It DECIDES NOTHING: membership, lifecycle and every value come from that one reader,
-- called per ZIP. No spatial join, no second membership rule (CLAUDE.md "ONE CANONICAL TRUTH PATH").
--
--   public.map1_dc_zip_listing          one row per registry ZIP: the member rows (stable fields
--                                        only), their count, whether the reader truncated, when the
--                                        ZIP was last checked and when its listings last changed.
--   public.map1_dc_zip_listing_refresh  checks the p_batch ZIPs checked longest ago. A ZIP whose
--                                        read fails keeps its previous row and records the error.
--   pg_cron 'map1-dc-zip-listing'       every 10 minutes, 1,500 ZIPs (measured 2026-11-14: about
--                                        5 ms a ZIP warm, so ~8 s a run; every ZIP within ~90 min).
--
-- The build reads rows with member_count > 0 and prints a ZIP's listings only when its row was
-- checked within 48 hours and was not truncated. It never prints an absence sentence from this
-- table: a missing or stale row means "not printed", never "no data centres".
--
-- Stored fields exclude last_seen_at, distance and coordinates on purpose: they move without the
-- listing changing, and the page's semantic fingerprint (scripts/page_semantics.py) must not.
--
-- Apply once, as one transaction. Re-applying is safe.
-- ════════════════════════════════════════════════════════════════════════════════════════════

begin;

create table if not exists public.map1_dc_zip_listing (
  zip           text primary key,
  listings      jsonb       not null default '[]'::jsonb,
  member_count  integer     not null default 0,
  truncated     boolean     not null default false,
  checked_at    timestamptz not null default now(),
  changed_at    timestamptz not null default now(),
  last_error    text,
  constraint map1_dc_zip_listing_zip_check check (zip ~ '^[0-9]{5}$'),
  constraint map1_dc_zip_listing_array check (jsonb_typeof(listings) = 'array'),
  constraint map1_dc_zip_listing_count check (member_count = jsonb_array_length(listings))
);

create index if not exists map1_dc_zip_listing_checked_idx on public.map1_dc_zip_listing (checked_at);

alter table public.map1_dc_zip_listing enable row level security;
-- The same rows anyone can already read through map1_dc_zip_members (anon EXECUTE). Read-only.
drop policy if exists map1_dc_zip_listing_read on public.map1_dc_zip_listing;
create policy map1_dc_zip_listing_read on public.map1_dc_zip_listing for select using (true);
revoke all on public.map1_dc_zip_listing from anon, authenticated;
grant select on public.map1_dc_zip_listing to anon, authenticated, supabase_read_only_user;

create or replace function public.map1_dc_zip_listing_refresh(p_batch integer default 1500)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  z      text;
  n      integer := 0;
  rows_j jsonb;
  cnt    integer;
  trunc  boolean;
begin
  -- One run at a time; a second run started while one is going does nothing.
  if not pg_try_advisory_xact_lock(hashtext('map1_dc_zip_listing_refresh')) then
    return 0;
  end if;

  -- A ZIP that left the registry has no page, so its row goes.
  delete from public.map1_dc_zip_listing l
   where not exists (select 1 from public.canonical_zip_registry r where r.zip = l.zip);

  for z in
    select r.zip
      from public.canonical_zip_registry r
      left join public.map1_dc_zip_listing l on l.zip = r.zip
     where r.zip ~ '^[0-9]{5}$'
     order by l.checked_at nulls first, r.zip
     limit greatest(coalesce(p_batch, 1500), 1)
  loop
    begin
      select coalesce(jsonb_agg(jsonb_build_object(
                 'source_key', m.source_key,
                 'source_name', m.source_name,
                 'source_url', m.source_url,
                 'source_licence', m.source_licence,
                 'project_name', m.project_name,
                 'developer_or_operator', m.developer_or_operator,
                 'raw_status', m.raw_status,
                 'normalized_status', m.normalized_status,
                 'map_status', m.map_status,
                 'project_type', m.project_type)
               order by m.source_key collate "C")
               filter (where m.zip_membership = 'member'), '[]'::jsonb),
             count(*) filter (where m.zip_membership = 'member'),
             coalesce(bool_or(m.has_more), false)
        into rows_j, cnt, trunc
        from public.map1_dc_zip_members(z) m;

      insert into public.map1_dc_zip_listing as l
             (zip, listings, member_count, truncated, checked_at, changed_at, last_error)
      values (z, rows_j, cnt, trunc, now(), now(), null)
      on conflict (zip) do update
         set listings     = excluded.listings,
             member_count = excluded.member_count,
             truncated    = excluded.truncated,
             checked_at   = excluded.checked_at,
             last_error   = null,
             changed_at   = case when l.listings is distinct from excluded.listings
                                   or l.truncated is distinct from excluded.truncated
                                 then excluded.changed_at else l.changed_at end;
    exception when others then
      -- A failed read is not an empty one: keep the previous listings, record why, and leave
      -- checked_at alone so the build sees the row ageing.
      insert into public.map1_dc_zip_listing as l (zip, last_error, checked_at, changed_at)
      values (z, left(sqlerrm, 500), '-infinity', '-infinity')
      on conflict (zip) do update set last_error = excluded.last_error;
    end;
    n := n + 1;
  end loop;
  return n;
end
$fn$;

alter function public.map1_dc_zip_listing_refresh(integer) owner to postgres;
revoke all on function public.map1_dc_zip_listing_refresh(integer) from public, anon, authenticated;
grant execute on function public.map1_dc_zip_listing_refresh(integer) to service_role;

do $$
begin
  perform cron.unschedule(j.jobid) from cron.job j where j.jobname = 'map1-dc-zip-listing';
  perform cron.schedule('map1-dc-zip-listing', '*/10 * * * *',
                        $c$select public.map1_dc_zip_listing_refresh(1500)$c$);
end $$;

commit;

-- ── ROLLBACK (by hand) ──────────────────────────────────────────────────────────────────────
-- select cron.unschedule(jobid) from cron.job where jobname = 'map1-dc-zip-listing';
-- drop function if exists public.map1_dc_zip_listing_refresh(integer);
-- drop table if exists public.map1_dc_zip_listing;
-- The build treats a missing table (PostgREST 404 / PGRST205) as "no listings printed".
