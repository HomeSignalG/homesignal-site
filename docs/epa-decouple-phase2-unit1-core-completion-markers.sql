-- =====================================================================================
-- PHASE 2 · UNIT 1 — CORE COMPLETION MARKERS STOP COUNTING EPA
-- Founder decision 2026-09-07: "EPA / Regulatory is a separate data plane from core
-- Map 1 projects."  Phase 1 (PR #1102, applied 2026-09-07) cut the two RUNTIME control
-- paths: EPA could pause the national core refresh (1A), and refusing the regulatory
-- write refused the core write with it (1B).  This unit cuts the third path, which is
-- SEMANTIC rather than runtime: EPA facility records still decide whether a Map 1 ZIP
-- page is advertised as a development page, and no marker anywhere states core
-- completeness on its own.
--
-- Non-negotiable rules this unit satisfies (founder list, 2026-09-07):
--   #1  EPA must not determine whether a ZIP page is considered complete.
--   #8  EPA failures must never make a ZIP appear incomplete / stale / unprocessed.
-- Rule #1 is violated in BOTH directions today.  The audit and every prior discussion
-- named the failure direction; production is failing the OTHER one — EPA PRESENCE is
-- manufacturing completeness on ZIPs that have no core project record at all.
--
-- ⚠️ THIS FILE IS PARKED, NOT APPLIED.  It is executable and atomic: running it end to
-- end performs the whole unit.  Apply it in one transaction (Supabase
-- `apply_migration`), never in pieces — see "ONE MIGRATION, NOT TWO" in CLAUDE.md §7.1,
-- the 67-second window that cost 6 rows during Phase 1B.
--
-- 2026-09-09 founder call: EPA feed-first session CLOSED. Baltimore city proven-keep
-- is live (#1131 / v250); remaining EPA-only B rows are blocked or stalled. Do NOT
-- apply this unit until A/C/unknown policy is explicit. Do not start from a leftover
-- Tampa / recache / Unit 4 session.
--
-- Authored against live `public.app_refresh_zip`
--   md5 6591d7f79f9a6cd0b476bbcfc2065b9a, length 19428.
-- The script does NOT hard-fail on that md5 (another session may legitimately have
-- spliced an unrelated region — one did, 56 seconds after a Phase 1 read).  It fails
-- closed on the three ANCHORS instead, each of which must appear exactly once.
-- =====================================================================================

-- --------------------------------------------------------------------- 1. the columns
-- Two markers, because the current single flag answers two different questions at once
-- and the answers disagree:
--
--   core_project_scan_status  did the CORE project scan run for this ZIP, and did it
--                             find anything?  'not_scanned' | 'projects_found' |
--                             'no_qualifying_projects_found'.  The third value is the
--                             founder's own vocabulary and is a COMPLETE result, not an
--                             incomplete one — a ZIP with no development is a finished
--                             scan, not a failed one (rule #8).
--   core_records_present      does the core plane hold at least one real sourced record
--                             (development project or civic notice)?  The EPA-free
--                             analogue of data_quality='pass'.
--
-- Both are computed from _nd / _ndp / _nc / _has_report only.  Neither reads _nf or
-- _nfc, so an EPA outage, an empty FRS response, or removing the overlay entirely
-- cannot move either one.
alter table public.app_community_meta
  add column if not exists core_project_scan_status text,
  add column if not exists core_records_present     boolean;

comment on column public.app_community_meta.core_project_scan_status is
  'CORE plane only. not_scanned | projects_found | no_qualifying_projects_found. '
  'Never reads EPA/FRS facility counts (_nf/_nfc) — EPA must not determine core completeness.';
comment on column public.app_community_meta.core_records_present is
  'CORE plane only: >=1 development project or civic notice on record. '
  'The EPA-free analogue of a passing data-quality stamp; never reads EPA/FRS facility counts.';

-- ------------------------------------------------------------------- 2. the backfill
-- Computed in the DB from the same sources app_refresh_zip reads (rule 7 — the set is
-- never transcribed).  Backfilled in the SAME script as the writer, so no tick of
-- `dev-reports-rolling-refresh` or `app-content-refresh` can run a function that does
-- not maintain a column that already exists.
--
-- 🔑 `category <> 'Local News'` IS LOAD-BEARING, AND ITS ABSENCE IS INVISIBLE.
-- `app_refresh_zip`'s own `_nc` carries NO category filter — it is civic-only by
-- ORDERING: the function deletes the ZIP's app_changes rows, inserts the civic ones,
-- counts `_nc` at line 264, and only THEN inserts Local News at line 288.  A backfill
-- runs long after that ordering has passed, with the news rows already in the table, so
-- reproducing `_nc` requires the filter the function never needed.  `app_coverage_states`
-- states the same rule the other way, as `count(*) filter (where a.category <> 'Local
-- News') AS changes`.
--
-- Measured 2026-09-07: without the filter, **630 of 12,722 ZIPs** would have been stamped
-- `core_records_present = true` on Local News alone (12,308 vs the correct 11,678) — the
-- 2026-08-02 "news is content, not coverage" defect, reintroduced in a brand-new column.
-- The corrected figure reconciles exactly with the Unit 2 partition: 11,678 core-content
-- + 766 core-empty-with-EPA + 278 empty-either-way = 12,722.
update public.app_community_meta m
   set core_project_scan_status =
         case when not exists (select 1 from public.development_reports d where d.zip = m.zip)
                   then 'not_scanned'
              when exists (select 1 from public.app_projects p
                            where p.zip = m.zip and p.record_kind = 'development')
                   then 'projects_found'
              else 'no_qualifying_projects_found' end,
       core_records_present =
         exists (select 1 from public.app_projects p
                  where p.zip = m.zip and p.record_kind = 'development')
         or exists (select 1 from public.app_changes  c
                     where c.zip = m.zip and coalesce(c.source_ref,'') <> ''
                       and c.category <> 'Local News');

alter table public.app_community_meta
  add constraint app_community_meta_core_scan_status_chk
  check (core_project_scan_status is null
         or core_project_scan_status in ('not_scanned','projects_found','no_qualifying_projects_found'))
  not valid;
alter table public.app_community_meta validate constraint app_community_meta_core_scan_status_chk;

-- ------------------------------------------------------------- 3. the writer (splice)
-- `app_refresh_zip` is ~19.4 KB / 315 lines.  It is SPLICED from its own
-- pg_get_functiondef output rather than retyped (rule 7: never transcribe a
-- list-shaped or body-shaped artifact into a migration).  Every substitution asserts
-- its anchor occurs EXACTLY ONCE first, so a drifted body refuses the edit instead of
-- silently editing the wrong place — the bare-14-day-clause trap from the Government
-- Notices date-window work, where the same anchor appeared twice and one of them was
-- Local News.
do $splice$
declare
  src   text;
  out_  text;
  ka    text := E'    ((_nd+_nf+_nc)>0 and (_ndp > 0 or _nfc >= 3)),\n    _lat, _lng';
  va    text := E'    ((_nd+_nc)>0 and _ndp > 0),\n'
             || E'    case when not _has_report then ''not_scanned''\n'
             || E'         when _nd > 0 then ''projects_found''\n'
             || E'         else ''no_qualifying_projects_found'' end,\n'
             || E'    ((_nd+_nc) > 0),\n'
             || E'    _lat, _lng';
  kb    text := 'covered, data_quality, indexable, lat, lng)';
  vb    text := 'covered, data_quality, indexable, core_project_scan_status, core_records_present, lat, lng)';
  kd    text := 'name=excluded.name, county=excluded.county, state=excluded.state, indexable=excluded.indexable, updated_at=now(),';
  vd    text := 'name=excluded.name, county=excluded.county, state=excluded.state, indexable=excluded.indexable,'
             || ' core_project_scan_status=excluded.core_project_scan_status,'
             || ' core_records_present=excluded.core_records_present, updated_at=now(),';
  n     int;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'app_refresh_zip';
  if src is null then
    raise exception 'PHASE 2 UNIT 1 FAILED: public.app_refresh_zip not found';
  end if;
  raise notice 'app_refresh_zip BEFORE: md5=% len=%', md5(src), length(src);

  n := (length(src) - length(replace(src, ka, ''))) / length(ka);
  if n <> 1 then
    raise exception 'PHASE 2 UNIT 1 FAILED: indexable anchor occurs % time(s), expected exactly 1', n;
  end if;
  n := (length(src) - length(replace(src, kb, ''))) / length(kb);
  if n <> 1 then
    raise exception 'PHASE 2 UNIT 1 FAILED: insert-column anchor occurs % time(s), expected exactly 1', n;
  end if;
  n := (length(src) - length(replace(src, kd, ''))) / length(kd);
  if n <> 1 then
    raise exception 'PHASE 2 UNIT 1 FAILED: on-conflict anchor occurs % time(s), expected exactly 1', n;
  end if;

  out_ := replace(replace(replace(src, ka, va), kb, vb), kd, vd);

  -- The splice is three insertions and one deletion, nothing else.  Reconstructing the
  -- ORIGINAL by reversing every substitution must return the input byte for byte; if it
  -- does not, something moved that was not named here.
  if replace(replace(replace(out_, va, ka), vb, kb), vd, kd) <> src then
    raise exception 'PHASE 2 UNIT 1 FAILED: splice is not reversible — collateral movement in the body';
  end if;

  execute out_;

  -- Prove the splice took (an instrument must prove it ran).
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'app_refresh_zip';
  if src <> out_ then
    raise exception 'PHASE 2 UNIT 1 FAILED: stored body differs from the spliced body';
  end if;
  raise notice 'app_refresh_zip AFTER:  md5=% len=%', md5(src), length(src);
end
$splice$;

-- ------------------------------------------------------------------ 4. the invariants
do $verify$
declare
  src        text;
  n_nf_index int;
  n_rows     bigint;
  n_bad      bigint;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'app_refresh_zip';

  -- (a) THE CORE INVARIANT: the indexability decision no longer mentions the EPA plane.
  if position('((_nd+_nc)>0 and _ndp > 0),' in src) = 0 then
    raise exception 'VERIFY FAILED: the EPA-free indexable expression is not present';
  end if;
  if position('_nfc >= 3' in src) > 0 then
    raise exception 'VERIFY FAILED: the EPA facility limb still gates indexable';
  end if;

  -- (b) The overlay must still MEASURE itself — this unit removes EPA from the
  --     DECISION, never from the reporting.  _nfc still populates component_scores and
  --     the return line; deleting those would be a different (and wrong) change.
  n_nf_index := (length(src) - length(replace(src, '_nfc', ''))) / 4;
  if n_nf_index <> 6 then
    raise exception 'VERIFY FAILED: expected 6 remaining _nfc references (overlay self-reporting), found %', n_nf_index;
  end if;

  -- (c) Neither new marker may be derivable from the EPA plane.
  if position('core_records_present' in src) = 0
     or position('core_project_scan_status' in src) = 0 then
    raise exception 'VERIFY FAILED: the core markers are not written by app_refresh_zip';
  end if;

  -- (d) Every row carries a legal marker value.
  select count(*) into n_rows from public.app_community_meta;
  select count(*) into n_bad  from public.app_community_meta
   where core_project_scan_status is null or core_records_present is null;
  if n_bad > 0 then
    raise exception 'VERIFY FAILED: % of % rows have a NULL core marker after backfill', n_bad, n_rows;
  end if;

  -- (e0) The backfill must reproduce the WRITER's semantics. Inside app_refresh_zip the
  --      expression is `(_nd+_nc) > 0` with no category filter, which is civic-only
  --      because `_nc` is counted before the Local News insert; the backfill needs the
  --      explicit filter to reach the same answer after the fact. Assert the two agree
  --      on the one shape that separates them: a ZIP whose only app_changes rows are
  --      Local News must NOT be marked as having core records.
  select count(*) into n_bad from public.app_community_meta m
   where m.core_records_present
     and not exists (select 1 from public.app_projects p
                      where p.zip = m.zip and p.record_kind = 'development')
     and not exists (select 1 from public.app_changes c
                      where c.zip = m.zip and coalesce(c.source_ref,'') <> ''
                        and c.category <> 'Local News');
  if n_bad > 0 then
    raise exception 'VERIFY FAILED: % rows claim core records on Local News alone', n_bad;
  end if;

  -- (e) A ZIP whose core plane is empty must never be reported as having projects, and
  --     a ZIP reported as having projects must have core records.  This is the pair that
  --     makes the markers a statement rather than two independent columns.
  select count(*) into n_bad from public.app_community_meta
   where core_project_scan_status = 'projects_found' and core_records_present is not true;
  if n_bad > 0 then
    raise exception 'VERIFY FAILED: % rows claim projects_found with no core records', n_bad;
  end if;

  raise notice 'PHASE 2 UNIT 1 VERIFIED over % rows', n_rows;
end
$verify$;

-- ----------------------------------------------------------------- 5. what this moves
-- Measured from the STORED stamps (one self-consistent read of app_community_meta,
-- 2026-09-07) — not from a live recount of app_projects/app_changes, which the rolling
-- materializer moves under the query:
--
--   app_community_meta rows                                    12,722
--   indexable = true, before                                   11,704
--   indexable = true, after  (_ndp > 0)                         10,699
--   pages LEAVING the advertised set                            -1,005
--   ... of which the sole cause is the _nfc >= 3 limb        1,005 / 1,005
--   pages ENTERING the advertised set                                0
--   all 1,005 currently carry a development_reports row      1,005 / 1,005
--
-- WHAT THE 1,005 ARE: ZIP pages advertised as DEVELOPMENT pages that carry zero
-- parcel-precise development records and qualified on EPA facility count alone.  They
-- remain real, reachable pages and keep rendering their facility records unchanged;
-- they stop being advertised in sitemap.xml and stop being marked index-eligible on
-- homesignalmap.html.  That is a truthfulness correction, and it is a VISIBLE
-- sitemap/robots delta — the founder's call, which is why this file is parked.
--
-- WHAT THIS UNIT DELIBERATELY DOES **NOT** TOUCH, and why:
--   * `data_quality` keeps its `_nf` limb.  It is not only a completeness claim — it is
--     the LAYOUT GATE in lib/community-page.js (`if (status !== 'pass')`), and the
--     non-pass branch renders neither Development nor Facilities.  Dropping `_nf` there
--     would stop 766 pages (stored stamps: pass with _ndp=0 and _nc=0 and _nfc>0)
--     rendering REAL, SOURCED EPA facility records they hold today.  That is a product
--     regression, not a truthfulness correction, and it is the opposite of what the
--     founder's rules ask for.  Core completeness is stated by the new markers instead;
--     the audit's §10.2 recommendation to recompute BOTH flags is superseded by this
--     finding.
--   * `app_coverage_states.facilities_only` and its CI pin
--     (`legacy: populated/facilities_only => pass`, scripts/verify-coverage-state.mjs:64)
--     stay true by construction, because data_quality is unchanged.  Reworking that
--     coverage state is Phase 2 Unit 2.
--   * The `sites` jsonb still carries both planes (Unit 3) and EPA is still on the
--     report critical path via Promise.all (Unit 4).
