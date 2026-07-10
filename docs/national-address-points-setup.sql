-- national_address_points — the zero-fee national geocode backbone (OpenAddresses).
--
-- WHY: our development records are national (50 states / 522 counties) and overwhelmingly NEW
-- construction. We geocode them with FREE/OPEN sources only — no commercial geocoder, ever.
-- A chunked CI loader ingests OpenAddresses (one uniform national schema — no per-state custom
-- code) into this table; the engine's `datasetRung` looks addresses up here by canonicalAddr()
-- at zero per-lookup cost, falling to the US Census rung on a miss.
--
-- HONEST TIERS (the whole point of this project): OpenAddresses has mixed per-source quality and
-- no reliable per-POINT rooftop flag, so every point DEFAULTS to 'parcel_centroid' (stays
-- needs_review=true, never claimed as rooftop). A point is 'rooftop' ONLY where the source gave
-- an explicit, reliable rooftop signal. match_type flows through the engine's existing tiers and
-- the improvement-guarded upsert, so a better rung (e.g. a real rooftop source) can only upgrade.
--
-- Parked / applied via mcp__Supabase__apply_migration. RLS service-role only (internal).

create table if not exists public.national_address_points (
  canonical_addr text primary key,          -- canonicalAddr() of the assembled OA address = lookup key
  lat            double precision not null,
  lng            double precision not null,
  match_type     text not null default 'parcel_centroid'  -- rooftop ONLY on explicit OA rooftop signal
                 check (match_type in ('rooftop','parcel_centroid')),
  state          text,                       -- 2-letter; scopes incremental loads/refreshes
  source         text,                       -- OpenAddresses source id (provenance)
  source_vintage text,                       -- OpenAddresses run date
  loaded_at      timestamptz not null default now()
);

create index if not exists nap_state_idx on public.national_address_points (state);
alter table public.national_address_points enable row level security;   -- service-role only
