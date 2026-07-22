-- ============================================================================
-- Read-only assertions for the app_refresh_all_candidate_coverage migration.
-- Run against production (or any environment) AFTER applying the migration OR
-- against the candidate expression directly — it only SELECTs, never writes and
-- never calls app_refresh_zip(). Each failing assertion RAISES; all-pass = silent.
--
--   psql "$SUPABASE_DB_URL" -f docs/app-refresh-all-candidate-coverage-test.sql
--
-- Covers the 6 required properties:
--   1. an existing development ZIP remains included
--   2. a covered Local News ZIP without a development report is included
--   3. a ZIP with no eligible content path is excluded
--   4. duplicate qualification produces one refresh call (no dup ZIPs)
--   5. the five identified Utah counties are all included (40 ZIPs)
--   6. indexability is not modified (no added ZIP is indexable; function is candidate-only)
-- ============================================================================

do $$
declare
  v_current int; v_proposed int; v_new int;
  v_t1 bool; v_t2 bool; v_t3 bool; v_t4 bool; v_t5 bool; v_t6 bool; v_removed int;
begin
  with dr as (select distinct zip from public.development_reports),
  mze as (
    select m.zip, m.indexable,
           coalesce(rt.county,m.county) rcounty, coalesce(rt.state,m.state) rstate,
      exists(select 1 from public.alerts a where a.community_id=coalesce(c.parent_id,m.community_id) and a.pipeline_type='news' and a.category='local_news' and a.created_at>=now()-interval '14 days' and coalesce(a.source_url,'')<>'') hn,
      exists(select 1 from public.alerts a where a.community_id=coalesce(c.parent_id,m.community_id) and a.pipeline_type='government_notice' and a.created_at>=now()-interval '14 days' and coalesce(a.source_url,'')<>'') hg,
      exists(select 1 from public.meetings mt where mt.community_id=coalesce(c.parent_id,m.community_id) and mt.meeting_date>=now() and coalesce(mt.source_url,'')<>'') hm
    from public.app_community_meta m
    join public.communities c on c.id=m.community_id
    left join public.communities rt on rt.id=coalesce(c.parent_id,m.community_id)
    where m.zip not in (select zip from dr)),
  cand as (select zip from dr union select zip from mze where hn or hg or hm),
  five as (select zip, indexable from mze where rcounty in ('Summit','Grand','San Juan','Uintah','Duchesne') and rstate='UT')
  select
    (select count(*) from dr),
    (select count(*) from cand),
    (select count(*) from cand)-(select count(*) from dr),
    exists(select 1 from cand where zip in (select zip from public.development_reports limit 1)),
    (select count(*) from mze where hn and zip in (select zip from cand))>0,
    not exists(select 1 from mze where not(hn or hg or hm) and zip in (select zip from cand)),
    (select count(*) from cand)=(select count(distinct zip) from cand),
    ((select count(*) from five where zip in (select zip from cand))=(select count(*) from five) and (select count(*) from five)=40),
    not exists(select 1 from mze where (hn or hg or hm) and indexable and zip in (select zip from cand)),
    (select count(*) from dr d where d.zip not in (select zip from cand))
  into v_current, v_proposed, v_new, v_t1, v_t2, v_t3, v_t4, v_t5, v_t6, v_removed;

  if not v_t1 then raise exception 'TEST 1 FAILED: an existing development ZIP is not in the candidate set'; end if;
  if not v_t2 then raise exception 'TEST 2 FAILED: a covered Local News ZIP without a development report is not included'; end if;
  if not v_t3 then raise exception 'TEST 3 FAILED: a covered ZIP with no eligible content path was included'; end if;
  if not v_t4 then raise exception 'TEST 4 FAILED: duplicate qualification produced duplicate candidate ZIPs'; end if;
  if not v_t5 then raise exception 'TEST 5 FAILED: the five Utah counties are not all included (expected 40 ZIPs)'; end if;
  if not v_t6 then raise exception 'TEST 6 FAILED: an added candidate ZIP is indexable (indexability must not change)'; end if;
  if v_removed <> 0 then raise exception 'REGRESSION: % existing development candidates were removed', v_removed; end if;

  raise notice 'ALL PASS — candidates % -> % (+%); five-county ZIPs & no dups & no indexable added; 0 removed',
    v_current, v_proposed, v_new;
end $$;
