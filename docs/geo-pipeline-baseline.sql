-- ============================================================================
-- GEOGRAPHY PIPELINE — REPRODUCIBLE BASELINE MEASUREMENT (READ-ONLY)
--
-- Phase 0 of the national geography pipeline repair. Every statement here is a
-- SELECT. Nothing in this file mutates anything.
--
-- Re-run this after each phase and diff against
-- docs/geo-pipeline-baseline-2026-09-19.md plus the two fingerprint files in
-- docs/geo-baseline/. A phase that changes a number this file did not predict
-- is a STOP.
--
-- TWO PREDICATES, AND THE DIFFERENCE IS NOT COSMETIC
--   predA  "no membership row at (p.zip, p.source_key)"
--   predB  "no membership row for p.source_key at ANY zcta5"
-- Authoritative membership is assigned by BOUNDARY (ZCTA polygon), not by the
-- ingest row's zip. A project whose boundary lands in a neighbouring ZCTA is
-- CORRECTLY represented there, so predA counts it as missing when it is not.
-- Measured 2026-09-19: predA 66,511 keys vs predB 53,610 keys — predA
-- overcounts by 12,901 keys (19.4%).
-- >>> predB IS THE BACKLOG. predA IS NOT. Acceptance gates use predB. <<<
--
-- TWO PERFORMANCE TRAPS, both measured, both cost a 60s timeout if reintroduced
--   1. `s.zip::text = p.zip` casts the INDEXED column on
--      geo.maps_zip_geography_status and defeats its primary key. Always write
--      `s.zip = p.zip::bpchar`.
--   2. `not exists (... where m.source_key = p.source_key)` cannot use
--      zip_authoritative_membership_pkey (zcta5, source_key) — source_key is
--      not the leading column. Materialise the represented-key set ONCE in a
--      CTE and anti-join against that, as below.
--
-- COLLATION: every fingerprint sort is pinned `collate "C"` (repo rule 9).
--            Postgres default collation and Python codepoint order disagree,
--            and a false drift alarm is how a real one gets ignored later.
-- ============================================================================

\echo '=== 1. HEADLINE COUNTS ==='
select now() captured_at,
 (select count(*) from geo.n5_geom) n5_geom_rows,
 (select count(distinct source_key) from geo.n5_geom) n5_geom_keys,
 (select count(*) from geo.zip_authoritative_membership) memb_rows,
 (select count(*) from geo.zip_authoritative_marker) marker_rows,
 (select count(*) from geo.maps_zip_geography_status where status='boundary_complete') zips_boundary_complete,
 (select count(*) from geo.maps_zip_geography_status where status='not_measured') zips_not_measured,
 (select count(*) from public.canonical_zip_registry) canonical_zips,
 (select count(*) from preservation.app_project_identity where snapshot_id='phase1-2026-09-01') preservation_rows,
 (select count(*) from preservation.protected_snapshot) protected_snapshots;

\echo '=== 2. BACKLOG (predB) — TOTAL ==='
with rep as (select distinct source_key from geo.zip_authoritative_membership where record_kind='development')
select count(distinct p.source_key) keys, count(*) rows,
       count(distinct (p.zip,p.source_key)) pairs, count(distinct p.zip) zips,
       count(distinct p.registry_id) registries,
       min(p.created_at) oldest_created,
       round(extract(epoch from (now()-min(p.created_at)))/86400.0,2) oldest_age_days
  from public.app_projects p
  left join geo.n5_accepted_source a on a.registry_id = p.registry_id
 where p.record_kind='development'
   and p.created_at > '2026-09-01 13:39:55.360946+00'
   and p.lat is not null and p.lng is not null
   and (a.treatment in ('PROVEN','RECOVERY') or a.treatment is null)
   and coalesce(p.source_key_basis,'') not in ('source_id:row_id','source_id:title(MUTABLE)')
   and exists (select 1 from geo.maps_zip_geography_status s where s.zip=p.zip::bpchar and s.status='boundary_complete')
   and not exists (select 1 from rep r where r.source_key = p.source_key);

\echo '=== 3. BACKLOG (predB) — BY TREATMENT (sizes Phases 8/9/10) ==='
with rep as (select distinct source_key from geo.zip_authoritative_membership where record_kind='development')
select coalesce(a.treatment,'(UNCLASSIFIED)') treatment,
       count(distinct p.source_key) keys, count(*) rows,
       count(distinct (p.zip,p.source_key)) pairs, count(distinct p.zip) zips,
       count(distinct p.registry_id) registries
  from public.app_projects p
  left join geo.n5_accepted_source a on a.registry_id = p.registry_id
 where p.record_kind='development'
   and p.created_at > '2026-09-01 13:39:55.360946+00'
   and p.lat is not null and p.lng is not null
   and (a.treatment in ('PROVEN','RECOVERY') or a.treatment is null)
   and coalesce(p.source_key_basis,'') not in ('source_id:row_id','source_id:title(MUTABLE)')
   and exists (select 1 from geo.maps_zip_geography_status s where s.zip=p.zip::bpchar and s.status='boundary_complete')
   and not exists (select 1 from rep r where r.source_key = p.source_key)
 group by 1 order by 2 desc;

\echo '=== 4. NATIONAL FINGERPRINT — MEMBERSHIP by ZIP2 (diff vs docs/geo-baseline/membership-zip2-*.txt) ==='
select left(m.zcta5,2) z2, count(*) n,
       md5(string_agg(m.zcta5||'|'||m.source_key||'|'||coalesce(m.lat::text,'')||'|'||coalesce(m.lng::text,'')||'|'||coalesce(m.point_rule,'')||'|'||coalesce(m.feature_count::text,''),
                      ',' order by m.zcta5 collate "C", m.source_key collate "C")) h
  from geo.zip_authoritative_membership m
 where m.record_kind='development'
 group by 1 order by 1 collate "C";

\echo '=== 5. NATIONAL FINGERPRINT — MARKERS by ZIP2 (diff vs docs/geo-baseline/marker-zip2-*.txt) ==='
select left(k.zcta5,2) z2, count(*) n,
       md5(string_agg(k.zcta5||'|'||k.source_key||'|'||k.marker_seq::text||'|'||coalesce(k.lat::text,'')||'|'||coalesce(k.lng::text,'')||'|'||coalesce(k.marker_rule,''),
                      ',' order by k.zcta5 collate "C", k.source_key collate "C", k.marker_seq)) h
  from geo.zip_authoritative_marker k
 where k.record_kind='development'
 group by 1 order by 1 collate "C";

\echo '=== 6. REGRESSION ZIPS — MEMBERSHIP (11 controls incl. 19475 negative control) ==='
select m.zcta5 zip, count(*) memb_rows,
       md5(string_agg(m.source_key||'|'||coalesce(m.lat::text,'')||'|'||coalesce(m.lng::text,'')||'|'||coalesce(m.point_rule,'')||'|'||coalesce(m.feature_count::text,''),
                      ',' order by m.source_key collate "C")) memb_md5
  from geo.zip_authoritative_membership m
  join public.maps_dc_zip_order o on o.zip = m.zcta5
 where m.record_kind='development' group by 1 order by 1 collate "C";

\echo '=== 7. REGRESSION ZIPS — MARKERS ==='
select k.zcta5 zip, count(*) marker_rows, max(k.marker_seq) max_seq,
       md5(string_agg(k.source_key||'|'||k.marker_seq::text||'|'||coalesce(k.lat::text,'')||'|'||coalesce(k.lng::text,'')||'|'||coalesce(k.marker_rule,''),
                      ',' order by k.source_key collate "C", k.marker_seq)) marker_md5
  from geo.zip_authoritative_marker k
  join public.maps_dc_zip_order o on o.zip = k.zcta5
 where k.record_kind='development' group by 1 order by 1 collate "C";

\echo '=== 8. KCMO 64165 CONTROL — pre-freeze must stay intact, post-freeze must progress ==='
with cand as (
  select p.id, p.source_key, (p.created_at > '2026-09-01 13:39:55.360946+00') post
    from public.app_projects p
   where p.zip='64165' and p.record_kind='development' and p.registry_id='kcmo-development-cases')
select post, count(*) rows, count(distinct source_key) keys,
       count(*) filter (where exists (select 1 from preservation.app_project_identity i
                         where i.snapshot_id='phase1-2026-09-01' and i.app_project_id=cand.id)) in_snapshot,
       count(*) filter (where exists (select 1 from geo.n5_geom g where g.source_key=cand.source_key)) in_n5_geom,
       count(*) filter (where exists (select 1 from geo.zip_authoritative_membership m
                         where m.source_key=cand.source_key and m.zcta5='64165')) in_memb_64165,
       count(*) filter (where exists (select 1 from geo.zip_authoritative_marker k
                         where k.source_key=cand.source_key and k.zcta5='64165')) in_marker_64165
  from cand group by 1 order by 1;

\echo '=== 9. REGISTRY CATALOGUE PARITY (Phase 3 gate) ==='
-- jurisdiction-registry.json is authoritative for EXISTENCE; n5_accepted_source
-- for ELIGIBILITY. A registry in the file with no catalogue row must FAIL CI,
-- never be auto-classified. File side is read by scripts/check_geo_registry_parity.
select count(*) catalogue_rows,
       count(*) filter (where registry_id is null) null_registry_rows
  from geo.n5_accepted_source;

\echo '=== 10. PRESERVATION UNTOUCHED (must be identical every phase) ==='
select snapshot_id, count(*) rows from preservation.app_project_identity group by 1;
select snapshot_id, reason is not null has_reason, authorized_by from preservation.protected_snapshot;
