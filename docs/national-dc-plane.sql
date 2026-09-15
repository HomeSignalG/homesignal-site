-- ============================================================================
-- MAP 1 · NATIONAL DATA-CENTER PLANE — DDL of record
--
-- CLAUDE.md section 1 makes docs/*.sql the schema of record: applied by hand in the
-- Supabase SQL editor, kept here so the state is reproducible. This file is the
-- executable record of three applied migrations:
--     national_dc_records_v1
--     national_dc_for_zip_rpc_v1
--     national_dc_for_zip_security_definer_fix
--
-- It is EXECUTABLE and idempotent, not a narration of one. CLAUDE.md's own rule:
-- "A PARKED MIGRATION THAT IS MOSTLY COMMENTS IS NOT A MIGRATION" — replaying this
-- file must reproduce the live state, so nothing load-bearing sits in a comment.
--
-- WHAT THIS PLANE IS. A third data plane for Map 1, modelled on the EPA FRS national
-- plane: read LIVE, no jurisdiction-registry entry, no coverage gate. It is what lets
-- a ZIP with no local permit/planning connector still show real data-center projects.
-- Local connector rules are untouched — lib/data.js::projects() still reads app_projects.
--
-- WHY NOT app_projects. app_refresh_zip() deletes app_projects rows whose last_seen_at
-- predates its run, and dev-reports-rolling-refresh fires */2. National rows written
-- there would be wiped every two minutes.
--
-- SOURCE: OpenStreetMap (telecom=data_center), ODbL. Displaying these records REQUIRES
-- crediting the source; homesignalmap.html renders that credit from the rows' own
-- source_name, so a load returning nothing credits nothing.
-- ============================================================================

create table if not exists public.national_dc_records (
  id uuid not null default gen_random_uuid(),
  source_name text not null default 'OpenStreetMap'::text,
  source_key text not null,
  source_record_id text not null,
  osm_type text not null,
  source_url text not null,
  project_name text,
  developer_or_operator text,
  raw_status text not null,
  normalized_status text not null,
  project_type text not null default 'datacenter'::text,
  lat double precision,
  lng double precision,
  location_text text,
  location_precision text not null,
  raw_tags jsonb not null default '{}'::jsonb,
  imported_at timestamp with time zone not null default now(),
  last_seen_at timestamp with time zone not null default now(),
  map_eligible boolean not null default false,
  map_exclusion_reason text,

  constraint national_dc_records_pkey PRIMARY KEY (id),
  constraint national_dc_source_key_unique UNIQUE (source_key),

  constraint national_dc_records_osm_type_check
    CHECK (osm_type = ANY (ARRAY['node'::text, 'way'::text, 'relation'::text])),

  constraint national_dc_records_location_precision_check
    CHECK (location_precision = ANY (ARRAY['precise_location'::text,
           'approximate_campus_area'::text, 'approximate_project_area'::text, 'none'::text])),

  constraint national_dc_records_normalized_status_check
    CHECK (normalized_status = ANY (ARRAY['announced'::text, 'site_selection'::text,
           'pre_development'::text, 'planned'::text, 'proposed'::text, 'permitted'::text,
           'under_construction'::text, 'operational'::text, 'cancelled'::text,
           'shelved'::text, 'blocked'::text, 'unknown'::text])),

  -- THE ANTI-FABRICATION GATE, AS A CONSTRAINT RATHER THAN APPLICATION LOGIC.
  -- An eligible row is structurally impossible without its evidence: a real source URL,
  -- real in-range coordinates that are not 0,0, a stated location precision, and a
  -- status that is displayable. An INELIGIBLE row must say why it was excluded, so a
  -- record is never silently dropped. 440 of the 1,824 imported rows sit here, all for
  -- "no source-supplied project name" — excluded, never given a placeholder name.
  constraint national_dc_eligible_requires_evidence
    CHECK (
      ((map_eligible = false) AND (map_exclusion_reason IS NOT NULL))
      OR
      ((map_eligible = true)
       AND (source_url <> ''::text)
       AND (lat IS NOT NULL) AND (lng IS NOT NULL)
       AND (lat >= (-90)::double precision) AND (lat <= (90)::double precision)
       AND (lng >= (-180)::double precision) AND (lng <= (180)::double precision)
       AND (NOT ((lat = (0)::double precision) AND (lng = (0)::double precision)))
       AND (location_precision <> 'none'::text)
       AND (normalized_status = ANY (ARRAY['announced'::text, 'site_selection'::text,
            'pre_development'::text, 'planned'::text, 'proposed'::text, 'permitted'::text,
            'under_construction'::text, 'operational'::text])))
    )
);

create index if not exists national_dc_records_geo_idx
  on public.national_dc_records using btree (lat, lng) where map_eligible;
create index if not exists national_dc_records_eligible_idx
  on public.national_dc_records using btree (map_eligible);

-- RLS ON, and anon/authenticated REVOKED. Deliberately NOT modelled on page_cache,
-- which the DB advisory flags for having RLS disabled. The raw table is unreadable
-- through PostgREST; the filtered function below is the only door.
alter table public.national_dc_records enable row level security;
revoke all on public.national_dc_records from anon, authenticated;

-- ============================================================================
-- THE READ PATH
--
-- SECURITY DEFINER is load-bearing, and it is a CORRECTION — see the defect note.
-- ============================================================================
create or replace function public.national_dc_for_zip(p_zip text, p_radius_mi numeric default 5)
returns table(source_key text, source_name text, source_url text, project_name text,
              developer_or_operator text, raw_status text, normalized_status text,
              project_type text, lat double precision, lng double precision,
              location_text text, location_precision text, distance_mi numeric,
              last_seen_at timestamp with time zone)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with z as (
    select home_lat, home_lng from public.development_reports where zip = p_zip limit 1
  ),
  -- Clamped: the radius is caller-supplied on an anon-executable DEFINER function, and
  -- an unbounded value degenerates the bbox prefilter into a full scan any anonymous
  -- caller could trigger. 25 is far above the 5 the page passes, so no caller changes.
  p as (select least(greatest(coalesce(p_radius_mi, 5), 0), 25) as r)
  select r.source_key, r.source_name, r.source_url,
         r.project_name, r.developer_or_operator,
         r.raw_status, r.normalized_status, r.project_type,
         r.lat, r.lng, r.location_text, r.location_precision,
         round((3958.8 * 2 * asin(sqrt(
             power(sin(radians(r.lat - z.home_lat) / 2), 2)
           + cos(radians(z.home_lat)) * cos(radians(r.lat))
           * power(sin(radians(r.lng - z.home_lng) / 2), 2)
         )))::numeric, 2) as distance_mi,
         r.last_seen_at
  from public.national_dc_records r, z, p
  where r.map_eligible
    and r.lat between z.home_lat - (p.r / 69.0) and z.home_lat + (p.r / 69.0)
    and r.lng between z.home_lng - (p.r / 55.0) and z.home_lng + (p.r / 55.0)
    and (3958.8 * 2 * asin(sqrt(
            power(sin(radians(r.lat - z.home_lat) / 2), 2)
          + cos(radians(z.home_lat)) * cos(radians(r.lat))
          * power(sin(radians(r.lng - z.home_lng) / 2), 2)
        ))) <= p.r
  order by distance_mi asc, r.source_key
  limit 200;
$function$;

alter function public.national_dc_for_zip(text, numeric) owner to postgres;
revoke all on function public.national_dc_for_zip(text, numeric) from public;
grant execute on function public.national_dc_for_zip(text, numeric) to anon, authenticated;

-- ============================================================================
-- 🔑 A PRIVILEGED READ IS NOT A CONTROL FOR AN ANON PATH (measured 2026-09-15)
--
-- This function SHIPPED as SECURITY INVOKER against a table revoked from anon. Probed
-- through execute_sql as a privileged role it returned 169 records for 20147 and looked
-- perfect. The browser's own call — same URL, same body, the page's publishable key —
-- returned:
--     HTTP 401 {"code":"42501","message":"permission denied for table national_dc_records"}
-- and homesignalmap.html's `.catch(function(){ return [] })` swallowed it into an empty
-- plane. The page would have looked deployed and rendered ZERO national markers, with
-- nothing anywhere reporting a fault.
--
-- The fix is SECURITY DEFINER, which is this project's stated posture for exactly this
-- shape ("RLS + SECURITY DEFINER functions are the gate", CLAUDE.md section 4).
--
-- ⛔ NOT `grant select on public.national_dc_records to anon`. That exposes the RAW table
-- through PostgREST including every map_eligible = false row, which is precisely what the
-- eligibility constraint exists to keep off every surface. The function's
-- `where r.map_eligible` must stay the only door.
--
-- Verified after the fix, on the real resident path (pg_net -> PostgREST, page's own key):
--     20147 Ashburn VA            -> 200, 169 records, nearest 1.21 mi, 0 unsourced
--     07446 Ramsey NJ (NO local connector) -> 200, 1 record, 1.49 mi, 0 unsourced
--     raw table as anon           -> 401 (negative control: the gate still holds)
-- ============================================================================

-- Fail closed. If a future edit inverts either half of the posture, replaying this
-- file raises instead of quietly reproducing the defect above.
do $$
begin
  if has_table_privilege('anon', 'public.national_dc_records', 'SELECT') then
    raise exception
      'national_dc_records must NOT be anon-readable; the filtered function is the only door';
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'national_dc_for_zip' and p.prosecdef
  ) then
    raise exception 'national_dc_for_zip must be SECURITY DEFINER or the anon path 401s';
  end if;
end $$;
