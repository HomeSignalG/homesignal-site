-- property-reports-cache.sql
-- Per-ADDRESS cache of every public record the engine has returned for one canonical
-- address — the row behind the property page (address dossier), homesignalmap.html?addr=…
-- Mirrors development_reports exactly (docs/development-reports-cache.sql), keyed by the
-- canonical address instead of ZIP, so TABS/APHIS/EPA records at the same address collapse
-- into ONE row regardless of which refresh wrote them (case-study §4.3).
--
-- The CANONICAL ADDRESS KEY is the engine's geocoder-normalized address string — ONE
-- normalizer, engine-side, so page and cache always agree. The page never invents a key;
-- it links to the property page using the site's engine-emitted location_addr.
--
-- Parked/applied manually in the Supabase SQL editor (same convention as the other
-- docs/*.sql). Idempotent. NOT yet applied — the engine-side writer is a later session.
--
-- SECURITY (do NOT repeat the page_cache mistake — that table shipped with RLS disabled):
--   RLS is ENABLED. Property reports are public data the page reads with the ANON key, so
--   anon may SELECT. Only the service-role refresh job may write — there is intentionally
--   NO anon insert/update/delete policy, so the anon key cannot tamper with the cache.

create table if not exists public.property_reports (
  address        text primary key,                     -- canonical address (engine-normalized)
  zip            text check (zip ~ '^\d{5}$'),          -- the ZIP the address sits in (breadcrumb + Tier-2 join)
  county         text,                                  -- e.g. 'Travis' (header subline)
  state          text,                                  -- e.g. 'TX'
  lat            double precision,                      -- geocoded point (map pin, v2)
  lng            double precision,
  counts         jsonb not null default '{}'::jsonb,    -- { filings, federal, entity_links }
  sites          jsonb not null default '[]'::jsonb,    -- every record at this address, same sites[] shape as development_reports (record_url mandatory)
  sources_checked jsonb not null default '[]'::jsonb,   -- the "Also checked" line: ONLY sources the engine actually queried with a null result,
                                                        -- e.g. [{"src":"EPA TRI","result":"no reports"}]. The page NEVER assumes a source was checked.
  paywall        boolean not null default false,
  source_vintage text,
  refreshed_at   timestamptz not null default now(),
  created_at     timestamptz not null default now()
);

comment on table public.property_reports is
  'Per-address cached engine output behind the property page (homesignalmap.html?addr=…). Keyed by the engine''s canonical (geocoder-normalized) address string. Read by the page via the anon key (RLS: public select, no anon writes). Written only by the service-role refresh. See docs/case-study-78617-caldwell-gap-analysis.md §4.3.';

-- ── RLS: public read, no anon writes (identical posture to development_reports) ─────
alter table public.property_reports enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='property_reports'
      and policyname='property_reports_public_read'
  ) then
    create policy property_reports_public_read
      on public.property_reports for select
      using (true);
  end if;
end$$;
-- NOTE: no insert/update/delete policy is created on purpose. With RLS enabled and no
-- write policy, the anon role cannot write; the service-role key (used only by the
-- refresh job, never shipped to the browser) bypasses RLS and performs upserts.

-- ── Idempotent upsert shape the (future) engine writer uses (reference) ─────────────
-- insert into public.property_reports (address, zip, county, state, lat, lng, counts, sites, sources_checked, paywall, source_vintage, refreshed_at)
-- values (:address, :zip, :county, :state, :lat, :lng, :counts::jsonb, :sites::jsonb, :checked::jsonb, :paywall, :vintage, now())
-- on conflict (address) do update set
--   zip = excluded.zip, county = excluded.county, state = excluded.state,
--   lat = excluded.lat, lng = excluded.lng,
--   counts = excluded.counts, sites = excluded.sites, sources_checked = excluded.sources_checked,
--   paywall = excluded.paywall, source_vintage = excluded.source_vintage,
--   refreshed_at = excluded.refreshed_at
--   where public.property_reports.refreshed_at < excluded.refreshed_at;  -- never clobber with older data

-- Verify:
--   select address, zip, (counts->>'filings')::int as filings,
--          jsonb_array_length(sites) as records, refreshed_at
--   from public.property_reports order by address;
