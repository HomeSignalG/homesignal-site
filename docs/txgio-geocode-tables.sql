-- Parcel/rooftop rung — schema changes. Parked; applied via mcp__Supabase__apply_migration
-- (NOT yet applied — held for owner review of schema + resolver before any prod action).
--
-- IMPORTANT: the `geocodes` table itself needs NO structural change. Its match_type CHECK
-- already permits 'rooftop' and 'parcel'; geocode_source is free text; provider_vintage
-- already exists (bumped by the improvement-guarded re-geocode batch). The changes below are
-- three NEW internal tables + one helper function. All RLS service-role only, like geocodes.

-- ── TxGIO StratMap Address Points (ROOFTOP tier). Loaded county-scoped by the CI load step,
--    keyed by canonicalAddr(). Primary rung. Zero runtime egress — the rung queries this table.
create table if not exists public.tx_address_points (
  canonical_addr text primary key,
  lat            double precision not null,
  lng            double precision not null,
  county         text,
  source_vintage text,                       -- TxGIO collection vintage that produced this point
  loaded_at      timestamptz not null default now()
);

-- ── TxGIO StratMap Land Parcels (PARCEL-CENTROID tier). Fallback used only when no Address
--    Point exists for a record. Stays needs_review=true (large-lot centroid caveat, #2).
create table if not exists public.tx_parcels (
  canonical_addr text primary key,
  lat            double precision not null,
  lng            double precision not null,
  county         text,
  parcel_id      text,
  source_vintage text,
  loaded_at      timestamptz not null default now()
);

-- ── Geocodio monthly spend cap counter. One row per (month, source); the rung reads it before
--    calling and falls through to Census when the cap is hit (fail-safe, never spends past cap).
create table if not exists public.geocode_usage (
  yyyymm         text    not null,           -- 'YYYY-MM'
  geocode_source text    not null,           -- 'geocodio'
  lookups        integer not null default 0,
  primary key (yyyymm, geocode_source)
);

-- Atomic increment used by the Geocodio rung (best-effort, one call per lookup attempt).
create or replace function public.incr_geocode_usage(p_yyyymm text, p_source text)
returns void language sql security definer set search_path = public as $$
  insert into public.geocode_usage (yyyymm, geocode_source, lookups)
  values (p_yyyymm, p_source, 1)
  on conflict (yyyymm, geocode_source)
  do update set lookups = public.geocode_usage.lookups + 1;
$$;

alter table public.tx_address_points enable row level security;   -- service-role only
alter table public.tx_parcels        enable row level security;   -- service-role only
alter table public.geocode_usage     enable row level security;   -- service-role only
