-- ============================================================================
-- Migration: local_news_canonical_topic_gate            (PARKED — NOT APPLIED)
--
-- FOUNDER DECISION (2026-07-27), verbatim:
--   "The 12 HomeSignal Local News topics are the product definition. An article
--    that does not match at least one canonical topic must never become a Local
--    News Alert. An empty Local News section is the correct behavior when no
--    qualifying articles exist. Do not preserve general civic news merely to
--    avoid empty ZIP pages. Do not weaken the topic gate to maintain article
--    counts."
--
-- WHAT THIS DOES — exactly one predicate is added to public.app_refresh_zip's
-- Local News insert:
--
--     and cardinality(a.subtopics) >= 1
--
-- That is the whole change. Nothing else in the function is touched.
--
-- WHY THAT IS SUFFICIENT (all three named surfaces are covered):
--   * ZIP Local News pages      -> read public.app_changes, filled ONLY by
--                                  app_refresh_zip. Gated here.
--   * Local News Alerts page    -> alerts.html -> lib/data.js::news() -> the SAME
--                                  app_changes rows. Gated here, transitively.
--   * Local News subscriber email -> ALREADY GATED, no change required:
--                                  homesignal-ingest/digest.py:523
--                                    if set(r.get("subtopics") or []) & follows_set:
--                                  An article with an empty subtopics array
--                                  intersects nothing and can never be sent.
--
-- WHY NO CLEANUP SCRIPT IS NEEDED: app_refresh_zip is delete-then-rebuild per
-- ZIP ("delete from public.app_changes where zip=_zip;" precedes every insert),
-- so the already-materialized non-qualifying rows are dropped by the next
-- refresh of each ZIP. The hourly app_refresh_batch(1500) sweep propagates it
-- across all 12,722 ZIPs in ~9 hours (execution baseline, Addendum Obs 4).
--
-- WHY NO NEW STORAGE MODEL (per the task's "prove no suitable state exists"):
--   public.alerts.subtopics is text[] NOT NULL DEFAULT '{}'  (verified live:
--   pg_attribute.attnotnull = true). "Matches no approved topic" is therefore
--   already representable as cardinality(subtopics) = 0 — the exact predicate
--   digest.py has used since it shipped. Non-qualifying articles are NOT
--   deleted, NOT flagged, NOT moved: their public.alerts row is untouched, so
--   provenance, geo_evidence, resolver_version, publisher metadata, source_url
--   and title all survive for audit. They are simply not materialized.
--
-- ANTI-FABRICATION / SAFETY: no article is deleted, no raw publisher record is
-- removed, no routing logic, ZIP resolver, publisher eligibility, state
-- coverage, Gold Master workbook, Government Notices, Upcoming Meetings or any
-- non-Local-News pipeline is touched. No rollout flag is created or enabled.
--
-- METHOD: the guarded server-side rewrite required by
-- homesignal-ingest/docs/LOCAL_NEWS_EXECUTION_BASELINE.md §3 constraint 12 —
-- md5 pre-image assertion, anchor-uniqueness check, post-apply md5 assertion,
-- transactional dry-run first. The function body is never retyped; it is read
-- from pg_proc and rewritten in place, so no unrelated byte can drift.
--
-- MEASURED PRE-IMAGE (live, 2026-07-27):
--   md5(prosrc) = 3f1dde8707bb2bb4e9ee051480e1962b   length = 12419
-- COMPUTED POST-IMAGE (read-only, not applied):
--   md5(prosrc) = 36fd470f7781838b57b9e402e2e0df8f   length = 12859
--
-- HOW TO RUN: sections in order. §1 and §2 write nothing. Stop and investigate
-- on any raised exception — every guard fails closed.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- §1  PREFLIGHT (read-only — run first, expect the values in the header)
-- ---------------------------------------------------------------------------
select md5(p.prosrc)                                     as pre_md5_expect_3f1dde87,
       length(p.prosrc)                                  as pre_len_expect_12419,
       (select count(*) from regexp_matches(p.prosrc,
          'and a\.category = ''local_news''', 'g'))      as anchor_hits_expect_1,
       (select count(*) from regexp_matches(p.prosrc,
          'cardinality\(a\.subtopics\)', 'g'))           as gate_already_present_expect_0,
       (select attnotnull from pg_attribute
         where attrelid = 'public.alerts'::regclass
           and attname  = 'subtopics')                   as subtopics_not_null_expect_true
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'app_refresh_zip';

-- Impact preview (read-only): what the gate will remove from the page surface.
select count(*)                                          as page_rows_today,
       count(*) filter (where tagged)                    as page_rows_after_gate,
       count(distinct zip)                               as zips_with_local_news_today,
       count(distinct zip) filter (where tagged)         as zips_with_local_news_after
  from (
    select ac.zip,
           exists (select 1 from public.alerts a
                    where a.category = 'local_news'
                      and a.source_url = ac.source_ref
                      and cardinality(a.subtopics) >= 1) as tagged
      from public.app_changes ac
     where ac.category = 'Local News'
  ) s;


-- ---------------------------------------------------------------------------
-- §2  TRANSACTIONAL DRY RUN — performs the full rewrite, asserts the
--     post-image, then ROLLS BACK via a sentinel exception. Writes nothing.
--     Expected output: NOTICE "LNTG_DRYRUN_OK ..." followed by the sentinel.
-- ---------------------------------------------------------------------------
do $lntg$
declare
  _body text;
  _new  text;
  _anchor constant text := E'    and a.category = ''local_news''\n';
  _repl   constant text := E'    and a.category = ''local_news''\n    -- Canonical 12-topic gate (founder decision 2026-07-27): a Local News article\n    -- reaches a ZIP page only when the subtopic classifier assigned >=1 approved\n    -- topic. Non-qualifying rows stay in public.alerts for audit; they are simply\n    -- not materialized. alerts.subtopics is NOT NULL DEFAULT ''{}'' so cardinality\n    -- is never null. An empty Local News section is intended behavior.\n    and cardinality(a.subtopics) >= 1\n';
begin
  select p.prosrc into _body
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'app_refresh_zip';

  if _body is null then
    raise exception 'LNTG_FUNCTION_NOT_FOUND';
  end if;
  if md5(_body) <> '3f1dde8707bb2bb4e9ee051480e1962b' then
    raise exception 'LNTG_PREIMAGE_MISMATCH: live md5=% (expected 3f1dde8707bb2bb4e9ee051480e1962b). '
                    'The function changed since this migration was written — STOP and re-derive.', md5(_body);
  end if;
  if (select count(*) from regexp_matches(_body, 'and a\.category = ''local_news''', 'g')) <> 1 then
    raise exception 'LNTG_ANCHOR_NOT_UNIQUE';
  end if;
  if position(_anchor in _body) = 0 then
    raise exception 'LNTG_ANCHOR_NOT_FOUND_EXACT';
  end if;
  if (select count(*) from regexp_matches(_body, 'cardinality\(a\.subtopics\)', 'g')) <> 0 then
    raise exception 'LNTG_GATE_ALREADY_PRESENT';
  end if;
  if not (select attnotnull from pg_attribute
            where attrelid='public.alerts'::regclass and attname='subtopics') then
    raise exception 'LNTG_SUBTOPICS_NULLABLE: cardinality() could return NULL — re-derive the predicate.';
  end if;

  _new := replace(_body, _anchor, _repl);

  if md5(_new) <> '36fd470f7781838b57b9e402e2e0df8f' then
    raise exception 'LNTG_POSTIMAGE_MISMATCH: computed md5=% (expected 36fd470f7781838b57b9e402e2e0df8f)', md5(_new);
  end if;
  if (select count(*) from regexp_matches(_new, 'cardinality\(a\.subtopics\) >= 1', 'g')) <> 1 then
    raise exception 'LNTG_GATE_NOT_EXACTLY_ONCE';
  end if;

  execute 'create or replace function public.app_refresh_zip(_zip text) returns text language plpgsql as '
          || quote_literal(_new);

  -- read back from the catalog, not from the variable
  select p.prosrc into _body
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'app_refresh_zip';
  if md5(_body) <> '36fd470f7781838b57b9e402e2e0df8f' then
    raise exception 'LNTG_LIVE_POSTIMAGE_MISMATCH: %', md5(_body);
  end if;

  raise notice 'LNTG_DRYRUN_OK pre=3f1dde8707bb2bb4e9ee051480e1962b post=% len=%', md5(_body), length(_body);
  raise exception 'LNTG_DRYRUN_ROLLBACK — intentional sentinel, nothing was committed';
end
$lntg$;


-- ---------------------------------------------------------------------------
-- §3  APPLY  (identical to §2 with the sentinel removed)
-- ---------------------------------------------------------------------------
do $lntg$
declare
  _body text;
  _new  text;
  _anchor constant text := E'    and a.category = ''local_news''\n';
  _repl   constant text := E'    and a.category = ''local_news''\n    -- Canonical 12-topic gate (founder decision 2026-07-27): a Local News article\n    -- reaches a ZIP page only when the subtopic classifier assigned >=1 approved\n    -- topic. Non-qualifying rows stay in public.alerts for audit; they are simply\n    -- not materialized. alerts.subtopics is NOT NULL DEFAULT ''{}'' so cardinality\n    -- is never null. An empty Local News section is intended behavior.\n    and cardinality(a.subtopics) >= 1\n';
begin
  select p.prosrc into _body
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'app_refresh_zip';

  if md5(_body) <> '3f1dde8707bb2bb4e9ee051480e1962b' then
    raise exception 'LNTG_PREIMAGE_MISMATCH: live md5=%', md5(_body);
  end if;
  if (select count(*) from regexp_matches(_body, 'and a\.category = ''local_news''', 'g')) <> 1 then
    raise exception 'LNTG_ANCHOR_NOT_UNIQUE';
  end if;
  if (select count(*) from regexp_matches(_body, 'cardinality\(a\.subtopics\)', 'g')) <> 0 then
    raise exception 'LNTG_GATE_ALREADY_PRESENT';
  end if;
  if not (select attnotnull from pg_attribute
            where attrelid='public.alerts'::regclass and attname='subtopics') then
    raise exception 'LNTG_SUBTOPICS_NULLABLE';
  end if;

  _new := replace(_body, _anchor, _repl);
  if md5(_new) <> '36fd470f7781838b57b9e402e2e0df8f' then
    raise exception 'LNTG_POSTIMAGE_MISMATCH: %', md5(_new);
  end if;

  execute 'create or replace function public.app_refresh_zip(_zip text) returns text language plpgsql as '
          || quote_literal(_new);

  select p.prosrc into _body
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'app_refresh_zip';
  if md5(_body) <> '36fd470f7781838b57b9e402e2e0df8f' then
    raise exception 'LNTG_LIVE_POSTIMAGE_MISMATCH: %', md5(_body);
  end if;

  raise notice 'LNTG_APPLIED md5=% len=%', md5(_body), length(_body);
end
$lntg$;


-- ---------------------------------------------------------------------------
-- §4  POST-APPLY VERIFICATION
-- ---------------------------------------------------------------------------
-- 4a. The function carries the gate exactly once and nothing else moved.
select md5(prosrc) = '36fd470f7781838b57b9e402e2e0df8f' as body_is_expected_post_image,
       (select count(*) from regexp_matches(prosrc, 'cardinality\(a\.subtopics\) >= 1','g')) as gate_count_expect_1
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname='public' and p.proname='app_refresh_zip';

-- 4b. Re-materialize one pilot ZIP and confirm the Local News count drops to the
--     qualifying set (84302 = Brigham City, the reference pilot).
-- select public.app_refresh_zip('84302');

-- 4c. THE INVARIANT — must return 0 for every refreshed ZIP.
--     "No Local News row on any page lacks an approved canonical topic."
select count(*) as local_news_page_rows_without_a_canonical_topic_expect_0
  from public.app_changes ac
 where ac.category = 'Local News'
   and not exists (select 1 from public.alerts a
                    where a.category = 'local_news'
                      and a.source_url = ac.source_ref
                      and cardinality(a.subtopics) >= 1);

-- 4d. Retention proof — non-qualifying articles are still in alerts, intact.
select count(*)                                                as retained_for_audit,
       count(*) filter (where geo_evidence is not null)         as still_have_geo_evidence,
       count(*) filter (where coalesce(source_url,'') <> '')    as still_have_source_url,
       count(*) filter (where coalesce(agency_name,'') <> '')   as still_have_publisher
  from public.alerts
 where category = 'local_news' and cardinality(subtopics) = 0;


-- ---------------------------------------------------------------------------
-- §5  REVERT (removes the predicate, restoring the exact pre-image)
-- ---------------------------------------------------------------------------
do $lntg$
declare
  _body text; _new text;
  _anchor constant text := E'    and a.category = ''local_news''\n';
  _repl   constant text := E'    and a.category = ''local_news''\n    -- Canonical 12-topic gate (founder decision 2026-07-27): a Local News article\n    -- reaches a ZIP page only when the subtopic classifier assigned >=1 approved\n    -- topic. Non-qualifying rows stay in public.alerts for audit; they are simply\n    -- not materialized. alerts.subtopics is NOT NULL DEFAULT ''{}'' so cardinality\n    -- is never null. An empty Local News section is intended behavior.\n    and cardinality(a.subtopics) >= 1\n';
begin
  select p.prosrc into _body
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='public' and p.proname='app_refresh_zip';

  if md5(_body) <> '36fd470f7781838b57b9e402e2e0df8f' then
    raise exception 'LNTG_REVERT_PREIMAGE_MISMATCH: live md5=%', md5(_body);
  end if;

  _new := replace(_body, _repl, _anchor);
  if md5(_new) <> '3f1dde8707bb2bb4e9ee051480e1962b' then
    raise exception 'LNTG_REVERT_POSTIMAGE_MISMATCH: %', md5(_new);
  end if;

  execute 'create or replace function public.app_refresh_zip(_zip text) returns text language plpgsql as '
          || quote_literal(_new);
  raise notice 'LNTG_REVERTED md5=%', (select md5(prosrc) from pg_proc p
      join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname='app_refresh_zip');
end
$lntg$;
-- After a revert, re-run app_refresh_zip / app_refresh_batch to restore the
-- pre-gate rows; nothing was ever deleted from public.alerts.
