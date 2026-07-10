-- Parcel/rooftop rung — schema changes. Parked; applied via mcp__Supabase__apply_migration
-- (NOT yet applied — held for owner review of schema + resolver before any prod action).
--
-- The changes: adjust the geocodes match_type CHECK to name the parcel tier 'parcel_centroid'
-- (its own distinct tier), add the ordered-rank + never-downgrade guard functions, and add
-- three NEW internal tables. All RLS service-role only, like geocodes. (geocode_source stays
-- free text; provider_vintage already exists and is bumped by the re-geocode batch.)

-- ── geocodes match_type: rename the parcel tier to 'parcel_centroid' (distinct from rooftop).
--    Safe: no 'parcel'/'parcel_centroid' rows exist yet (every current row is range_interpolated).
alter table public.geocodes drop constraint if exists geocodes_match_type_check;
alter table public.geocodes add constraint geocodes_match_type_check
  check (match_type in ('rooftop','parcel_centroid','range_interpolated','zip_centroid','county_centroid','failed'));

-- ── ORDERED quality rank (SQL mirror of QUALITY_RANK in geocode-cache.ts — keep in lockstep).
--    Higher = more precise. This is the single ordering the never-downgrade guard consults.
create or replace function public.geocode_quality_rank(mt text) returns int
language sql immutable as $$
  select case mt
    when 'rooftop'            then 3
    when 'parcel_centroid'    then 2
    when 'range_interpolated' then 1
    when 'zip_centroid'       then 0
    when 'county_centroid'    then 0
    else -1   -- 'failed' / unknown
  end
$$;

-- ── THE IMPROVEMENT GUARD. Inserts a new address; on conflict, the WHERE clause overwrites
--    ONLY when the incoming tier STRICTLY OUTRANKS the stored one. A lower-or-equal tier
--    (including a transient 'failed') leaves the existing row untouched → a re-geocode can only
--    ever UPGRADE a point, never downgrade. Returns true iff it inserted or upgraded.
create or replace function public.upsert_geocode_if_better(
  p_canonical text, p_input text, p_lat double precision, p_lng double precision,
  p_match_type text, p_matched text, p_source text, p_needs_review boolean,
  p_review_reason text, p_vintage text
) returns boolean language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  insert into public.geocodes as g
    (canonical_addr, input_address, lat, lng, match_type, matched_address,
     geocode_source, needs_review, review_reason, provider_vintage, updated_at)
  values
    (p_canonical, p_input, p_lat, p_lng, p_match_type, p_matched,
     p_source, p_needs_review, p_review_reason, p_vintage, now())
  on conflict (canonical_addr) do update set
     lat = excluded.lat, lng = excluded.lng, match_type = excluded.match_type,
     matched_address = excluded.matched_address, geocode_source = excluded.geocode_source,
     needs_review = excluded.needs_review, review_reason = excluded.review_reason,
     provider_vintage = excluded.provider_vintage, updated_at = now()
  where geocode_quality_rank(excluded.match_type) > geocode_quality_rank(g.match_type);  -- ← never-downgrade
  get diagnostics n = row_count;   -- 1 = inserted or upgraded; 0 = guard blocked a downgrade
  return n > 0;
end $$;

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
