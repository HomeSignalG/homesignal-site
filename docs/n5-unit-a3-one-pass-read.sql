-- Unit A3 — SHADOW one-pass authoritative read. DDL of record.
-- Applied 2026-09-03. SHADOW ONLY: not referenced by any production read path.
--
-- Production preservation control (verified before and after this unit):
--   public.app_projects_for_zip  md5(pg_get_functiondef(oid)) = ec1b01ae4485ad2c59b9f946c9d565b6
-- Unmodified. No index was created on public.app_projects. Unit B was not reattempted.
--
-- Grain: one row per (ZIP, source_key) authoritative membership.
-- Descriptive row: deterministic min(id) per source_key. last_seen_at is deliberately NOT used.
-- Coordinates come from geo.zip_authoritative_membership (the authoritative representative
-- point), never borrowed from an arbitrary app_projects row under another ZIP.

create or replace function geo.n5_a3_projects_one_pass(p_zip text)
returns jsonb
language sql
stable
set search_path to 'public', 'pg_temp'
as $function$
  with m as (
    select source_key, lat, lng
      from geo.zip_authoritative_membership
     where zcta5 = p_zip),
  a as (
    select distinct on (p.source_key) p.*
      from public.app_projects p
      join m on m.source_key = p.source_key
     where p.record_kind = 'development'
     order by p.source_key, p.id asc)
  select coalesce(
           jsonb_agg(to_jsonb(a.*) || jsonb_build_object('zip', p_zip, 'lat', m.lat, 'lng', m.lng)
                     order by a.submitted_at desc nulls last, a.id),
           '[]'::jsonb)
    from m join a on a.source_key = m.source_key;
$function$;

-- Fail closed: no web-reachable grant. `geo` also has no USAGE for anon/authenticated.
revoke all on function geo.n5_a3_projects_one_pass(text) from public;

-- MEASURED RESULT (see docs/maps-coverage/UNIT-A3-BENCHMARK-EVIDENCE.md):
--   NOT servable. ~245-290 ms per distinct source_key because the only index carrying
--   source_key (app_projects_zip_source_key_uidx) has it as the SECOND column, so each key
--   costs a full 431 MB index scan. p50 2.2 s / p95 15.5 s / max 21.3 s over the 364
--   boundary_complete ZIPs. The set-based seq-scan alternative is 17.8x slower still
--   (31.7 s constant) because the 2,870 MB heap cannot fit in 1,024 MB of shared_buffers.

-- ROLLBACK (removes the shadow read entirely; production is untouched by it either way):
--   drop function if exists geo.n5_a3_projects_one_pass(text);

-- Unit A shadow-status correction applied in the same session:
--   update geo.maps_zip_geography_status set cutover = false where cutover;  -- 346 rows
--   Unit B was rolled back, so cutover = true was asserting a state that does not exist.
