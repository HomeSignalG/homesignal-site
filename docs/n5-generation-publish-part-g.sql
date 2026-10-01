-- GENERATED from docs/n5-generation-publish-part-d.sql by slicing its D11 function
-- (geo.n5_generation_publish_problems) verbatim - never hand-edited. Part G (2026-09-29).
-- Regenerate: python3 test/n5_generation_pg/build_part_g.py
--
-- Fix 3: ZIPs 94128, 95219 and 99128 have a Census ZCTA boundary and had NO row in the
-- generation that served until 2026-09-27 (legacy-phase1-2026-09-01: 12,013 boundary_complete
-- + 706 not_measured = 12,719 of 12,722). Each is the only canonical ZIP of its ZIP3 prefix
-- (941, 952, 991), and the legacy writer (scripts/n5_unit_a_shadow.py) built only prefixes that
-- had a phase-1 shard. None of the three did. The generation path already repaired the
-- PRESENCE half: publication scope = shard prefixes + every canonical prefix, and READY /
-- ACTIVATE refuse on canonical_zip_without_status. Both national generations since carry all
-- 12,722 rows, and the three have served since 2026-09-27 15:00Z.
--
-- This adds the CORRECTNESS half. A row can exist and still be wrong: publish writes
-- boundary_complete only where the loader made a polygon resident, so a shape the loader
-- skipped would publish a ZIP that has a boundary as not_measured, and every existing check
-- would pass. The new check compares each canonical ZIP's status with geo.zcta_boundary (the
-- same pinned TIGER 2025 file) and blocks READY and ACTIVATE on any disagreement.
-- Measured 2026-09-29 before applying: 0 disagreements in every generation that has rows.
--
-- ONE transaction. Fail-closed on both sides:
--   before: the live body must be exactly the previous DDL of record (md5(prosrc) 611926736840a6b43847978d2ec9e9d6);
--   after:  it must be exactly the new DDL of record (66f5995db01c5bb8d6c9d88f9a217234).
begin;
set local lock_timeout = '10s';
do $g$
declare m text;
begin
  select md5(p.prosrc) into m from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'geo' and p.proname = 'n5_generation_publish_problems';
  if m is distinct from '611926736840a6b43847978d2ec9e9d6' then
    raise exception 'part G: live n5_generation_publish_problems is % - not the previous DDL of record; refusing', m;
  end if;
end $g$;

create or replace function geo.n5_generation_publish_problems(p_generation_id text, p_expected_chunks text[])
returns table (check_name text, n bigint)
language sql stable
set search_path = geo, public, pg_temp
as $$
  with g as (select * from geo.n5_generation where generation_id = p_generation_id),
  checks as (
    select 'shards_not_done'::text c,
           (select count(*) from geo.n5_shard s where s.generation_id = p_generation_id and s.state <> 'done') n
    union all
    select 'no_shards', case when exists (select 1 from geo.n5_shard s where s.generation_id = p_generation_id) then 0 else 1 end
    union all
    select 'not_prepared', (select case when g.publish_prepared_at is null then 1 else 0 end from g)
    union all
    select 'prefixes_unpublished',
           (select count(*) from geo.n5_generation_publish_scope(p_generation_id) sc
             where not exists (select 1 from geo.n5_generation_publish p
                                where p.generation_id = p_generation_id and p.z3 = sc.z3))
    union all
    select 'unresolved_not_recorded_after_last_publish',
           (select case when g.unresolved_recorded_at is null
                          or g.unresolved_recorded_at < coalesce((select max(p.completed_at) from geo.n5_generation_publish p
                                                                   where p.generation_id = p_generation_id), '-infinity')
                        then 1 else 0 end from g)
    union all
    select 'membership_without_marker',
           (select count(*) from geo.zip_authoritative_membership m
             where m.generation_id = p_generation_id
               and not exists (select 1 from geo.zip_authoritative_marker k
                                where k.generation_id = m.generation_id and k.zcta5 = m.zcta5 and k.source_key = m.source_key))
    union all
    select 'marker_without_membership',
           (select count(*) from geo.zip_authoritative_marker k
             where k.generation_id = p_generation_id
               and not exists (select 1 from geo.zip_authoritative_membership m
                                where m.generation_id = k.generation_id and m.zcta5 = k.zcta5 and m.source_key = k.source_key))
    union all
    select 'canonical_zip_without_status',
           (select count(*) from public.canonical_zip_registry r
             where not exists (select 1 from geo.maps_zip_geography_status st
                                where st.generation_id = p_generation_id and st.zip = r.zip))
    union all
    -- A status row that EXISTS can still be the wrong one. The publisher writes
    -- boundary_complete only where the loader made a polygon resident, so a shape the loader
    -- skipped would publish a ZIP that HAS a boundary as not_measured, and the presence check
    -- above would pass. geo.zcta_boundary is the same pinned TIGER 2025 ZCTA file (33,791
    -- polygons), read from a different carrier. Part G, 2026-09-29.
    select 'canonical_zip_status_disagrees_with_boundary',
           (select count(*) from public.canonical_zip_registry r
              join geo.maps_zip_geography_status st
                on st.generation_id = p_generation_id and st.zip = r.zip
             where st.status is distinct from
                   case when exists (select 1 from geo.zcta_boundary b where b.zcta5 = r.zip)
                        then 'boundary_complete' else 'not_measured' end)
    union all
    select 'boundary_scratch_residue',
           (select count(*) from geo.n5_gen_zcta z where z.generation_id = p_generation_id)
    union all
    -- the declared chunk set must cover every expected key, or reconciliation could pass
    -- while a slice of the expected set was never evaluated at all. Evaluated once per
    -- distinct ZIP (a ZIP is covered or not regardless of how many rows carry it).
    select 'expected_keys_outside_declared_chunks',
           (select coalesce(sum(z.n), 0) from (
              select e.zip, count(*) n
                from public.n5_expected_captured((select snapshot_id from g)) e
               group by e.zip) z
             where p_expected_chunks is null
                or not exists (select 1 from unnest(p_expected_chunks) c(k)
                                where z.zip >= rpad(c.k, 5, '0') and z.zip <= rpad(c.k, 5, '9'))))
  select c, n from checks where n > 0;
$$;
revoke all on function geo.n5_generation_publish_problems(text, text[]) from public;

do $g$
declare m text;
begin
  select md5(p.prosrc) into m from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'geo' and p.proname = 'n5_generation_publish_problems';
  if m is distinct from '66f5995db01c5bb8d6c9d88f9a217234' then
    raise exception 'part G post-condition failed: n5_generation_publish_problems md5 %', m;
  end if;
end $g$;
commit;
