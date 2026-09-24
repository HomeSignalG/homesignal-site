-- ============================================================================
-- STEP 3D · DERIVED LOCATION EVIDENCE — DDL OF RECORD
-- ============================================================================
-- A publisher's ADDRESS is evidence. A geocoder's answer for that address is a SECOND,
-- DIFFERENT fact: "the production ladder, asked Q on date D, returned point P of quality T".
-- This file stores the second fact beside the first, never inside it.
--
-- WHAT IT IS
--   * dc_geocode_input        per-SOURCE canonical rule: which address a record states, and
--                             whether it is a geocodable site address at all (precondition).
--   * dc_address_geocode      append-only DERIVED evidence: one row per (query, ladder version).
--                             Written ONLY by .github/workflows/dc-geocode-observations.yml,
--                             which runs HomeSignal's ONE geocoding ladder
--                             (get-address-report/geocode-cache.ts::productionLadder via
--                             resolveGeocode, keyed by canonical-addr.ts::canonicalAddr).
--   * dc_derived_point_verdict the fail-closed quality rule (output quality, not input syntax).
--   * dc_observation_derived_point  current observation -> its derived point + verdict.
--   * dc_geocode_queue        the addresses the writer still has to resolve.
--
-- WHAT IT IS NOT
--   * It assigns NO ZIP. The provider's postal ZIP is kept as a diagnostic inside
--     matched_address and is never read by any membership decision. Membership stays the ONE
--     polygon authority (geo.zip_point_membership_in) inside public.map1_dc_zip_members.
--   * It decides NO identity and NO geography. The canonical geography resolver
--     (dc_resolve_geography) decides whether an ACCEPTED derived point may place an entity.
--   * It writes NOTHING into dc_source_observation. Publisher evidence is immutable, and a
--     geocoder coordinate written there would read as if the publisher had supplied it.
--   * It is not a second geocoder: SQL never calls a provider. The ladder runs in TypeScript,
--     in exactly one place, and this file only stores what it returned.
--
-- WHY A NEW TABLE (the smallest structure that keeps the two facts apart; measured 2026-09-24):
--   * dc_source_observation is immutable publisher evidence (guard trigger refuses UPDATE).
--   * public.geocodes is the report engine's CACHE: keyed by canonical address, overwritten by
--     upsert_geocode_if_better when a better tier arrives, and carrying no provider candidate
--     count. It cannot say what the ladder returned WHEN a DC decision was made.
--   * dc_entity_geography is a DECISION (one row per entity), not evidence.
--   The Step-2 v1 contract's dc_derived_geometry + per-source geocoding switch were superseded
--   by Step 2A and are NOT resurrected: the per-source switch is dc_geocode_input itself (a
--   source with no rule returns NO_GEOCODE_RULE and is never queued).
--
-- PROBE BEHIND EVERY RULE (dc-geocode-probe.yml, run 36029398914, zero writes, 2026-09-24):
--   Epoch US data-centre records 77: range_interpolated 35 (1 with TWO provider candidates),
--   failed 34, blank 8. The OpenAddresses parcel rung covers two Texas counties only, so
--   nearly every derived point is Census street interpolation.
--   CALIBRATION, 200 Atlas records whose own site point is published (exact, >= 5 dp, UNSTATED
--   basis) and which carry a street address -- the SAME record's address geocoded vs its own
--   point, so no identity is assumed: p50 120 m · p95 396 m · p99 637 m · max 1,801 m;
--   200/200 landed in the same ZCTA as the site point.
--   => positional uncertainty is carried as 2,000 m (the measured maximum, rounded UP), and
--      Map 1 membership requires the WHOLE uncertainty disk inside one ZCTA. Road centrelines
--      are ZCTA edges: 5 of the 35 Epoch points sit 6-26 m from one.
-- ============================================================================

create or replace function public.dc_geocode_ladder_version()
returns text language sql immutable as $$ select 'production-ladder-v1'::text $$;

comment on function public.dc_geocode_ladder_version() is
'STEP 3D. The version of get-address-report/geocode-cache.ts::productionLadder whose answers
dc_address_geocode stores. A ladder change is a new version, so old derivations are never
mistaken for new ones and nothing is overwritten.';

-- ── INPUT RULE: is this a geocodable SITE address? (precondition only) ─────────────────────
-- A house number and a locality are REQUIRED before anything is sent to a geocoder. Without a
-- locality a geocoder may place the address in any town ("13360 Miller Rd NW"); without a house
-- number it returns a road or a place ("Co Rd 42, Montgomery" was matched to 42 COUNTY CT, a
-- different street). A NUMBER RANGE ("14436-14998 Fairview Rd") names a frontage, not a point.
-- Passing this gate proves nothing about the result: output quality is judged separately.
create or replace function public.dc_geocode_input(p_source_key text, p_distribution_key text,
                                                   p_payload jsonb)
returns table(input_quality text, geocoder_query text, reason text)
language plpgsql
immutable
set search_path to 'public', 'pg_temp'
as $fn$
declare
    a    text;
    rest text;
    states constant text := '(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC)';
    state_names constant text := '(Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|Florida|Georgia|Hawaii|Idaho|Illinois|Indiana|Iowa|Kansas|Kentucky|Louisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|Missouri|Montana|Nebraska|Nevada|New Hampshire|New Jersey|New Mexico|New York|North Carolina|North Dakota|Ohio|Oklahoma|Oregon|Pennsylvania|Rhode Island|South Carolina|South Dakota|Tennessee|Texas|Utah|Vermont|Virginia|Washington|West Virginia|Wisconsin|Wyoming|District of Columbia)';
begin
    if p_source_key = 'epoch_ai' and p_distribution_key = 'data_centers' then
        a := btrim(regexp_replace(coalesce(p_payload->>'Address', ''), '\s+', ' ', 'g'));
        if coalesce(p_payload->>'Country', '') <> 'United States' then
            return query select 'NOT_US'::text, null::text, 'the publisher places this record outside the United States'::text;
        elsif a = '' then
            return query select 'BLANK'::text, null::text, 'the publisher states no address'::text;
        elsif a !~ '^\d' or a ~ '^\d{5}(-\d{4})?$' then   -- a bare ZIP names an area, not a site
            return query select 'NO_HOUSE_NUMBER'::text, null::text, 'no house number: a road, place or area is not a site address'::text;
        elsif a ~ '^\d+[A-Za-z]?\s*[-–]\s*\d+' then
            return query select 'HOUSE_NUMBER_RANGE'::text, null::text, 'a house-number range names a frontage, not a point'::text;
        else
            rest := regexp_replace(a, '^\S+\s*', '');   -- a 5-digit HOUSE number is not a ZIP
            if rest ~ '\m\d{5}(-\d{4})?\M'
               or a ~ (',\s*' || states || '(\s|,|$)')
               or a ~* ('\m' || state_names || '\M') then
                return query select 'GEOCODABLE'::text, a, 'house number and locality present'::text;
            else
                return query select 'NO_LOCALITY'::text, null::text, 'no ZIP or state: the geocoder could place this street in any town'::text;
            end if;
        end if;
        return;
    end if;
    -- Every other source: no rule, so nothing is geocoded. Adding a source is adding a branch.
    return query select 'NO_GEOCODE_RULE'::text, null::text, 'no address rule for this source'::text;
end;
$fn$;

comment on function public.dc_geocode_input(text, text, jsonb) is
'STEP 3D. Per-source address rule, keyed like dc_classify_observation. GEOCODABLE requires a
single house number and a locality; it is a PRECONDITION, never a verdict on the result.';

-- ── DERIVED EVIDENCE: what the ladder returned ────────────────────────────────────────────
create table if not exists public.dc_address_geocode (
    derivation_id              uuid primary key default gen_random_uuid(),
    geocoder_query             text not null,       -- exactly what was sent to the ladder
    canonical_addr             text not null,       -- canonicalAddr(query): the public.geocodes key
    ladder_version             text not null,
    provider                   text not null,       -- the rung that answered ('none' when none did)
    match_type                 text not null,
    lat                        double precision,
    lng                        double precision,
    matched_address            text,                -- provider's matched address (its ZIP is DIAGNOSTIC ONLY)
    provider_candidates        integer,             -- how many matches the provider returned
    provider_matched_addresses text[],
    derived_at                 timestamptz not null default now(),
    run_ref                    text not null,       -- the workflow run that derived it
    constraint dc_address_geocode_type_ck check (match_type in
        ('rooftop', 'parcel_centroid', 'range_interpolated', 'zip_centroid', 'county_centroid', 'failed')),
    constraint dc_address_geocode_point_ck check (
        (match_type = 'failed' and lat is null and lng is null)
     or (match_type <> 'failed' and lat is not null and lng is not null
         and lat between -90 and 90 and lng between -180 and 180))
);

create unique index if not exists dc_address_geocode_query_ladder
    on public.dc_address_geocode (geocoder_query, ladder_version);

alter table public.dc_address_geocode enable row level security;
revoke all on public.dc_address_geocode from anon, authenticated;

comment on table public.dc_address_geocode is
'STEP 3D. DERIVED location evidence: the production geocoding ladder''s answer for a source
address, with provenance. Append-only. Never copied into dc_source_observation, never a ZIP.';

-- Append-only: a derivation is a historical fact. A better answer is a NEW ladder version.
create or replace function public.dc_address_geocode_guard()
returns trigger language plpgsql as $g$
begin
    raise exception 'dc_address_geocode is append-only derived evidence (%): add a new ladder_version instead',
        tg_op;
end;
$g$;

drop trigger if exists dc_address_geocode_guard_trg on public.dc_address_geocode;
create trigger dc_address_geocode_guard_trg
    before update or delete on public.dc_address_geocode
    for each row execute function public.dc_address_geocode_guard();
drop trigger if exists dc_address_geocode_truncate_trg on public.dc_address_geocode;
create trigger dc_address_geocode_truncate_trg
    before truncate on public.dc_address_geocode
    for each statement execute function public.dc_address_geocode_guard();

-- ── QUALITY RULE: may this derived point stand for a SITE? (fail closed) ──────────────────
-- ACCEPTED only when ALL hold; anything else is a named rejection:
--   * a point-grade match type: rooftop, parcel_centroid or range_interpolated
--     (zip_centroid / county_centroid are AREA answers; failed / unknown are nothing);
--   * exactly ONE provider candidate (two matches = the provider could not choose);
--   * the matched house number is the queried house number, and the matched state is the
--     queried state when the query names one (the provider answered the address we asked).
-- The positional uncertainty returned with an ACCEPTED point is the calibrated bound (header).
-- Unmeasured tiers (rooftop, parcel_centroid) get the SAME bound: they are at least as precise
-- by definition, and no Epoch record reaches them today, so no tighter number is invented.
create or replace function public.dc_derived_point_verdict(
    p_match_type text, p_provider_candidates integer, p_query text, p_matched text,
    p_lat double precision, p_lng double precision)
returns table(verdict text, positional_uncertainty_m double precision, reason text)
language plpgsql
immutable
set search_path to 'public', 'pg_temp'
as $fn$
declare
    q_no text := substring(coalesce(p_query, '') from '^(\d+)');
    m_no text := substring(coalesce(p_matched, '') from '^(\d+)');
    q_st text := substring(coalesce(p_query, '') from ',\s*([A-Z]{2})(?:\s+\d{5}(?:-\d{4})?)?\s*(?:,|$)');
    m_st text := substring(coalesce(p_matched, '') from ',\s*([A-Z]{2}),\s*\d{5}\s*$');
begin
    if p_match_type is null then
        return query select 'NOT_YET_GEOCODED'::text, null::double precision, 'no derivation for this address yet'::text;
    elsif p_match_type = 'failed' then
        return query select 'REJECTED_NO_MATCH'::text, null::double precision, 'the ladder matched nothing; no fallback point'::text;
    elsif p_match_type in ('zip_centroid', 'county_centroid') then
        return query select 'REJECTED_AREA_CENTROID'::text, null::double precision, 'an area centroid is not a site'::text;
    elsif p_match_type not in ('rooftop', 'parcel_centroid', 'range_interpolated') then
        return query select 'REJECTED_UNKNOWN_MATCH_TYPE'::text, null::double precision, 'unknown precision is not a site'::text;
    elsif p_lat is null or p_lng is null then
        return query select 'REJECTED_NO_MATCH'::text, null::double precision, 'no coordinates returned'::text;
    elsif p_provider_candidates is distinct from 1 then
        return query select 'REJECTED_AMBIGUOUS'::text, null::double precision,
            'the provider returned ' || coalesce(p_provider_candidates::text, 'an unknown number of') || ' candidates';
    elsif q_no is null or m_no is null or q_no <> m_no then
        return query select 'REJECTED_MATCH_DIVERGES'::text, null::double precision,
            'matched house number ' || coalesce(m_no, 'none') || ' is not the queried ' || coalesce(q_no, 'none');
    elsif q_st is not null and m_st is not null and q_st <> m_st then
        return query select 'REJECTED_MATCH_DIVERGES'::text, null::double precision,
            'matched state ' || m_st || ' is not the queried ' || q_st;
    else
        return query select 'ACCEPTED'::text, 2000::double precision,
            p_match_type || ', one candidate, house number agrees; uncertainty = calibrated max error (2,000 m)';
    end if;
end;
$fn$;

comment on function public.dc_derived_point_verdict(text, integer, text, text, double precision, double precision) is
'STEP 3D. Output-quality rule for a derived point. Area centroids, failures, unknown types,
ambiguous or divergent matches never become a site. ACCEPTED carries the calibrated 2,000 m
positional uncertainty that Map 1 membership must respect.';

-- ── CURRENT OBSERVATION -> DERIVED POINT ─────────────────────────────────────────────────
-- Keyed by the ADDRESS, not the observation: a daily re-acquisition of an unchanged address
-- reuses the same derivation, so derived evidence survives runs without re-geocoding.
-- security_invoker + revoke: create-or-replace drops reloptions (Step 3C view-grants fix).
create or replace view public.dc_observation_derived_point with (security_invoker = true) as
select o.home_signal_observation_id, o.source_key, o.distribution_key,
       gi.input_quality, gi.geocoder_query, gi.reason as input_reason,
       d.derivation_id, d.provider, d.match_type, d.lat, d.lng, d.matched_address,
       d.provider_candidates, d.derived_at, d.run_ref,
       case when gi.input_quality <> 'GEOCODABLE' then 'NOT_GEOCODABLE'
            else v.verdict end as verdict,
       v.positional_uncertainty_m,
       case when gi.input_quality <> 'GEOCODABLE' then gi.reason else v.reason end as verdict_reason
  from public.dc_current_observation o
 cross join lateral public.dc_geocode_input(o.source_key, o.distribution_key, o.raw_payload) gi
  left join public.dc_address_geocode d
    on d.geocoder_query = gi.geocoder_query
   and d.ladder_version = public.dc_geocode_ladder_version()
  left join lateral public.dc_derived_point_verdict(d.match_type, d.provider_candidates,
                    gi.geocoder_query, d.matched_address, d.lat, d.lng) v on true
 where gi.input_quality <> 'NO_GEOCODE_RULE';

revoke all on public.dc_observation_derived_point from anon, authenticated;

comment on view public.dc_observation_derived_point is
'STEP 3D. Each current observation of a source with an address rule, its geocoder query, the
derivation for the current ladder version (if any) and the fail-closed verdict.';

-- ── WORK QUEUE for the writer ────────────────────────────────────────────────────────────
create or replace view public.dc_geocode_queue with (security_invoker = true) as
select distinct p.geocoder_query, public.dc_geocode_ladder_version() as ladder_version
  from public.dc_observation_derived_point p
 where p.input_quality = 'GEOCODABLE'
   and p.derivation_id is null;

revoke all on public.dc_geocode_queue from anon, authenticated;

comment on view public.dc_geocode_queue is
'STEP 3D. Geocodable source addresses with no derivation for the current ladder version: the
only input dc-geocode-observations.yml reads.';
