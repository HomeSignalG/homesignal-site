-- development-reports-cache.sql
-- Per-ZIP cache of the get-address-report edge function's ZIP-mode output, so the
-- development ZIP pages read a cached row instead of hitting Census/EPA on every view.
-- Address mode stays LIVE (one user-driven call) and is NOT cached here.
--
-- See docs/development-tracker-source-of-truth.md §8. Parked/applied manually in the
-- Supabase SQL editor (same convention as the alerts docs/*.sql). Idempotent.
--
-- SECURITY (do NOT repeat the page_cache mistake — that table shipped with RLS disabled):
--   RLS is ENABLED. Reports are public data the page reads with the ANON key, so anon may
--   SELECT. Only the service-role refresh job may write — there is intentionally NO anon
--   insert/update/delete policy, so the anon key cannot tamper with the cache.

create table if not exists public.development_reports (
  zip           text primary key check (zip ~ '^\d{5}$'),
  home_lat      double precision not null,      -- ZIP centroid (the page anchor, not a home)
  home_lng      double precision not null,
  counts        jsonb not null default '{}'::jsonb,   -- { facilities, development, locked }
  sites         jsonb not null default '[]'::jsonb,   -- the get-address-report sites[] array
  paywall       boolean not null default false,
  source_vintage text,                          -- ZIP/centroid dataset vintage (§7.1)
  refreshed_at  timestamptz not null default now(),
  created_at    timestamptz not null default now()
);

comment on table public.development_reports is
  'Per-ZIP cached ZIP-mode output of get-address-report. Read by the development ZIP pages via the anon key (RLS: public select, no anon writes). Refreshed by the service-role batch. See docs/development-tracker-source-of-truth.md.';

-- ── RLS: public read, no anon writes ──────────────────────────────────────────────
alter table public.development_reports enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='development_reports'
      and policyname='development_reports_public_read'
  ) then
    create policy development_reports_public_read
      on public.development_reports for select
      using (true);
  end if;
end$$;
-- NOTE: no insert/update/delete policy is created on purpose. With RLS enabled and no
-- write policy, the anon role cannot write; the service-role key (used only by the
-- refresh job, never shipped to the browser) bypasses RLS and performs upserts.

-- ── Idempotent upsert shape the batch uses (reference) ─────────────────────────────
-- insert into public.development_reports (zip, home_lat, home_lng, counts, sites, paywall, source_vintage, refreshed_at)
-- values (:zip, :lat, :lng, :counts::jsonb, :sites::jsonb, :paywall, :vintage, now())
-- on conflict (zip) do update set
--   home_lat = excluded.home_lat,
--   home_lng = excluded.home_lng,
--   counts   = excluded.counts,
--   sites    = excluded.sites,
--   paywall  = excluded.paywall,
--   source_vintage = excluded.source_vintage,
--   refreshed_at   = excluded.refreshed_at
--   where public.development_reports.refreshed_at < excluded.refreshed_at;  -- never clobber with older data

-- Verify:
--   select zip, home_lat, home_lng,
--          (counts->>'facilities')::int as facilities,
--          jsonb_array_length(sites) as mapped, refreshed_at
--   from public.development_reports order by zip;
