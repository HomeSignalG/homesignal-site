-- geocodes — the write-once geocode cache for the development tracker.
--
-- WHY: TABS (and, later, other) point records were geocoded blind inside the serving
-- edge function with Census range-interpolation, storing lat/lng only — no quality
-- signal, no way to tell a good point from a bad one, no automatic flagging. This
-- table is the authoritative, once-per-address geocode with match quality.
--
-- ONE ROW PER REAL ADDRESS, keyed by canonicalAddr() (the ONE normalizer, engine-side).
-- The engine reads this table (read-through cache); a miss runs the geocoder LADDER
-- (highest-precision rung first) and upserts the classified result here.
--
-- match_type precision, highest first:  rooftop > parcel > range_interpolated >
--   zip_centroid > county_centroid > failed.
--   needs_review auto-sets TRUE for anything below parcel/rooftop OR a geofence miss.
--   Census Public_AR_Current has NO rooftop tier, so every Census result is
--   'range_interpolated' → flagged. That is correct: the review queue stays full until
--   a parcel/rooftop rung is added (a scoped follow-up — chosen on coverage/cost/
--   licensing/cadence, not rushed). Adding that rung needs NO change here: match_type
--   already permits 'parcel'/'rooftop' and geocode_source is free text.
--
-- RLS: enabled with NO policies = service-role only. This is an INTERNAL engine table;
--   the page never reads it directly — match_type is denormalized onto
--   development_reports.sites (already public-read). This is the CORRECT posture here,
--   unlike page_cache (which needs anon access); do not add anon policies.
--
-- Parked / applied manually (docs/*.sql convention, CLAUDE.md §1 #3). Idempotent.

create table if not exists public.geocodes (
  canonical_addr    text primary key,              -- canonicalAddr() output; dedup key
  input_address     text not null,                 -- raw address string sent to the geocoder
  lat               double precision,              -- null when match_type='failed'
  lng               double precision,
  match_type        text not null check (match_type in
                      ('rooftop','parcel','range_interpolated','zip_centroid','county_centroid','failed')),
  matched_address   text,                          -- the geocoder's returned/matched address string
  geocode_source    text not null,                 -- 'census_onelineaddress' | '<parcel source>' | ...
  needs_review      boolean not null default true, -- match_type not in (rooftop,parcel) OR geofence miss
  review_reason     text,                          -- why flagged (human-readable)
  geofence_status   text,                          -- reserved: verify-geocodes write-back (null|inside|outside_zip|outside_county)
  provider_vintage  text,                          -- geocoder benchmark/dataset vintage; bump forces re-geocode
  geocoded_at       timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- The review queue: everything the pipeline could not resolve to a precise point.
create index if not exists geocodes_needs_review_idx on public.geocodes (needs_review) where needs_review;

alter table public.geocodes enable row level security;   -- service-role only; no anon policies
