-- Pierce County PALS homeowner-privacy backfill — READ-ONLY dry run and post-refresh verification.
-- Rule: sources/record-hygiene.ts::cleanApplicantTitle (founder decision 2026-10-15). Corporate applicants kept,
-- plat text kept, everything else (individuals) stripped. These queries are a SQL approximation of that rule
-- (same word lists, word-bounded); test/record-hygiene.test.mjs is the authority. They print COUNTS ONLY, never names.
--
-- THERE IS NO WRITE STEP IN THIS FILE, ON PURPOSE. Stored titles are rewritten by the pipeline itself:
--   get-address-report (deployed with the new rule) -> dev_refresh_collect() -> development_reports.sites
--   -> app_refresh_zip() -> app_projects.name (conditional upsert; source_key / source_id are unchanged).
-- The rolling refresh (pg_cron job 14, dev_refresh_tick(8,20) every 2 min, oldest-first, 240 ZIPs/h) reaches every ZIP
-- within one ~53 h sweep. DO NOT use dev_refresh_fire_targets: public.dev_refresh_targets holds 1,437 UNFIRED rows from an
-- August campaign, so it would refresh the wrong ZIPs. DO NOT back-date refreshed_at to jump the queue: that falsifies the
-- freshness clock the coverage states read. Re-run section A until section B returns 0.

-- ── A. DRY RUN: how many stored records still carry a name the rule would strip ────────────────────────────────
-- A1. development_reports.sites on the 65 Pierce pages
with z as (select c.zip_codes[1] zip from public.communities c where c.state='WA' and c.county='Pierce' and c.level='zip'),
e as (select r.zip, x s, regexp_replace(x->>'title', '^'||regexp_replace(coalesce(x->>'type_raw',''),'([.()*+?\[\]\\|^$])','\\\1','g')||' ?', '') nm
      from z join public.development_reports r on r.zip=z.zip, jsonb_array_elements(r.sites) x
      where x->>'source_registry_id'='pierce-county-pals-permits'),
c as (select *,
 (nm ~* '(^|[^a-z0-9])(l\.?l\.?c|inc|corp(?:oration)?|holdings?|propert(?:y|ies)|builders?|homes?|developments?|group|partners?|limited|co|lp)($|[^a-z0-9])') ent,
 (nm ~* '(^|[^a-z0-9])(lots?|blk|block|tract|plat|phase|div(?:ision)?|parcel|unit|sec(?:tion)?|subdivision)\.?\s*#?[0-9]') plat,
 (nm ~ '[A-Za-z][A-Za-z''.-]*, [A-Za-z]' and nm !~* ', (llc|inc|corp|co|ltd|llp|lp|pllc|jr|sr)\M' and nm !~* ', (lot|lots|blk|block|unit|phase|tract|parcel|div|division|plat|sec|section)\M') pp from e),
k as (select *, (nm<>'' and not (plat and not pp) and not (ent and not pp)) strip from c)
select 'A1 PALS entries on Pierce pages (control)' k, count(*)::text v from k
union all select 'A1 entries to strip', count(*)::text from k where strip
union all select 'A1 distinct source_id to strip', count(distinct s->>'source_id')::text from k where strip
union all select 'A1 Pierce report rows affected (of 65)', count(distinct zip)::text from k where strip;

-- A2. app_projects (the materialized copy); also shows which other columns could carry the name
with p as (select id, developer, scope_text, parties, source_key,
  regexp_replace(coalesce(name,''), '^'||regexp_replace(coalesce(type_raw,''),'([.()*+?\[\]\\|^$])','\\\1','g')||' ?', '') nm
  from public.app_projects where source_key like 'arcgis:pierce-county-pals-permits:%'),
c as (select *,
 (nm ~* '(^|[^a-z0-9])(l\.?l\.?c|inc|corp(?:oration)?|holdings?|propert(?:y|ies)|builders?|homes?|developments?|group|partners?|limited|co|lp)($|[^a-z0-9])') ent,
 (nm ~* '(^|[^a-z0-9])(lots?|blk|block|tract|plat|phase|div(?:ision)?|parcel|unit|sec(?:tion)?|subdivision)\.?\s*#?[0-9]') plat,
 (nm ~ '[A-Za-z][A-Za-z''.-]*, [A-Za-z]' and nm !~* ', (llc|inc|corp|co|ltd|llp|lp|pllc|jr|sr)\M' and nm !~* ', (lot|lots|blk|block|unit|phase|tract|parcel|div|division|plat|sec|section)\M') pp from p),
k as (select *, (nm<>'' and not (plat and not pp) and not (ent and not pp)) strip from c)
select 'A2 app_projects PALS rows (control)' k, count(*)::text v from k
union all select 'A2 rows to strip', count(*)::text from k where strip
union all select 'A2 distinct source_key to strip', count(distinct source_key)::text from k where strip
union all select 'A2 to-strip rows with developer / scope_text / parties set (expect 0)', count(*)::text from k where strip and (coalesce(developer,'')<>'' or coalesce(scope_text,'')<>'' or parties::text not in ('[]','null','{}'))
union all select 'A2 app_changes referencing PALS rows (expect 0)', count(*)::text from public.app_changes a join p on p.id=a.related_project_id;

-- A3. MAPS drafts built from a PALS record (their post_text can quote the old name)
select 'A3 MAPS posts from PALS records, by status' k, status||': '||count(*) v from public.social_posts
where content_family='MAPS' and (source_id like 'arcgis:pierce-county-pals-permits:%' or evidence::text like '%arcgis:pierce-county-pals-permits:%') group by status;

-- NOT QUERYABLE FROM SQL: the Rule D project-pages object (email-assets/seo/development-seo-projects.json, produced by
-- homesignal-ingest). It KEEPS untracked pages ("only grows"), so it can hold old names after the tables are clean.
-- Inspect it from a runner; purging it is a destructive change that needs its own decision.

-- ── B. POST-REFRESH VERIFICATION: re-run A1 and A2. Both "to strip" counts must reach 0 once every Pierce ZIP has refreshed. ──
-- B1. how far the rotation has got: Pierce ZIPs refreshed after the deploy (2026-10-15 17:31:52Z)
with z as (select c.zip_codes[1] zip from public.communities c where c.state='WA' and c.county='Pierce' and c.level='zip')
select 'B1 Pierce ZIPs refreshed since the deploy (target 65)' k, count(*)::text v
from z join public.development_reports d on d.zip=z.zip where d.refreshed_at > '2026-10-15 17:31:52+00';

-- ── C. 98396 recovery: coverage_state must read 'populated' once the rotation reaches it ──────────────────────────
select s.zip, s.coverage_state, r.refreshed_at, r.last_refresh_attempt_at, r.facilities_unavailable
from public.app_coverage_states s join public.development_reports r using (zip) where s.zip='98396';
