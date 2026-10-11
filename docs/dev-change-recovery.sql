-- ============================================================================
-- DEVELOPMENT CHANGE LEDGER — HISTORICAL-RECOVERY PROTECTION   (PR B; SQL OF RECORD, NOT APPLIED)
--
-- THE PROBLEM
--   When the ZIP-mode scope is widened to the polygon (docs/zip-scope-members.sql, sources/scope-members.ts) a ZIP
--   suddenly SEES records that were always there: a 2023 permit that the old centroid square never fetched. The
--   ledger knows nothing about that, so the first ORDINARY run writes `first_detected`, `material = true`, and every
--   reader of public.dev_change_event_reportable (the report, the Follow, property watches, buyer alerts) says a new
--   development appeared. A baseline run would suppress it — but a baseline over a whole ZIP also hides a genuine
--   new filing that arrives in the same window, and it needs a human to decide per ZIP. Neither is acceptable at 12,722.
--
-- WHAT THIS DOES (one rule, evaluated by the ledger's ONE writer, in the transaction that creates the identity)
--   1. PROVENANCE. The connector stamps `scope_origin = 'polygon_member'` on a record kept ONLY because the polygon
--      widening reached it (never on a record the legacy scope already returned). It rides in the cached `sites`.
--   2. BARRIER. dev_change_observe_zip returns {status:'deferred'} — writing nothing — whenever the ZIP's cached
--      report is NEWER than what was materialised into app_projects (provenance.refreshed_at is the cache's own
--      refreshed_at, so equality is exact). An ordinary observation therefore can never read rows whose provenance
--      (the stamps in `sites`) belongs to a different refresh. dev_change_tick does not advance the ZIP's cursor on a
--      deferral, so it is simply retried.
--   3. CLASSIFICATION, at first sighting, in the same statement sequence that writes the identity. A NEW comparable
--      identity that is stamped is:
--        genuine_recent         publisher event date within `dev_change_recovery_news_days()` of the observation  -> reported as before
--        historical_backlog     older                                                                          -> first_detected written
--                                                                                                              non-material, is_baseline
--        undated_failed_closed  no date, or a date in the future                                               -> same (cannot prove it is news)
--      Unstamped identities are untouched (legacy behaviour, byte for byte). Every classification is recorded in
--      public.dev_change_recovery (outcome, the date, the window, the rule version) so the silence is auditable.
--   4. THE READER RULE moves with the decision owner: public.dev_change_event_reportable additionally excludes
--      events with is_baseline = true. Today that excludes NOTHING (measured 2026-10-11: 0 of 50,183 ordinary-run
--      events are is_baseline), so existing readers are unchanged.
--
-- WHAT IT DELIBERATELY DOES NOT DO
--   * It never baselines a ZIP. A later genuine change to a recovered identity is an ordinary event (the record has one
--     observation; its second comparable observation can emit `status_changed`/`source_record_updated` as always).
--   * It never deletes or rewrites an event, and never touches an identity the ledger already knows (cross-ZIP copies
--     and copy-conflict handling are unchanged).
--   * A genuine NEW filing in a recovered area is reported when its publisher date is recent. One published long after
--     it was filed (older than the window) is recorded as historical_backlog — non-material, but the event and its
--     audit row exist, so nothing is lost; it is only not announced as news. That trade is the cost of never
--     baselining, and it is bounded to widened-member records.
--
-- HOW IT IS APPLIED: by splicing the LIVE bodies (pg_get_functiondef) at apply time — never a retyped copy (CLAUDE.md
-- ingest rule 7). It refuses unless the live bodies fingerprint to the ones this was written against, proves each splice
-- by excising the inserted text and recovering the original md5, and is idempotent. ROLLBACK is at the foot.
-- ============================================================================

-- ---- 0. PRECONDITIONS (fail closed) ----------------------------------------------------------------------------
do $pre$
declare
  _o text; _t text; _v text;
  _o_done boolean; _t_done boolean;
begin
  if to_regprocedure('public.dev_change_observe_zip(text, uuid)') is null
     or to_regprocedure('public.dev_change_tick(uuid, integer, integer, bigint, bigint, integer)') is null
     or to_regclass('public.dev_change_event_reportable') is null
     or to_regprocedure('public.dev_sites_deduped(text)') is null
     or to_regprocedure('public.app_source_key(jsonb)') is null then
    raise exception 'dev_change_recovery: the ledger, its tick, the reportable view, dev_sites_deduped or app_source_key is missing';
  end if;
  select prosrc into _o from pg_proc where oid = 'public.dev_change_observe_zip(text, uuid)'::regprocedure;
  select prosrc into _t from pg_proc where oid = 'public.dev_change_tick(uuid, integer, integer, bigint, bigint, integer)'::regprocedure;
  _o_done := position('-- dev_change_recovery:' in _o) > 0;
  _t_done := position('-- dev_change_recovery:' in _t) > 0;
  if _o_done <> _t_done then
    raise exception 'dev_change_recovery: half-applied (observe_zip spliced=%, tick spliced=%) — refusing', _o_done, _t_done;
  end if;
  if not _o_done and md5(_o) <> '042ce94641c713c6c0b6e7d18c4addb6' then
    raise exception 'dev_change_recovery: live dev_change_observe_zip is % — written against 042ce946…; re-review before applying', md5(_o);
  end if;
  if not _t_done and md5(_t) <> '59ce03a97d78ca872735d613d286c991' then
    raise exception 'dev_change_recovery: live dev_change_tick is % — written against 59ce03a9…; re-review before applying', md5(_t);
  end if;
  _v := pg_get_viewdef('public.dev_change_event_reportable'::regclass);
  if position('is_baseline' in substring(_v from position('WHERE' in _v))) = 0 and md5(_v) <> '46e9ec8b1c28601f52bc87010bedaf89' then
    raise exception 'dev_change_recovery: live dev_change_event_reportable is not the definition this was written against';
  end if;
end $pre$;

-- ---- 1. THE AUDIT TABLE ---------------------------------------------------------------------------------------------
create table if not exists public.dev_change_recovery (
  identity_key         text primary key references public.dev_change_project (identity_key),
  zip                  text not null,
  run_id               uuid not null references public.dev_change_run (id),
  outcome              text not null check (outcome in ('genuine_recent', 'historical_backlog', 'undated_failed_closed')),
  suppressed           boolean generated always as (outcome <> 'genuine_recent') stored,
  publisher_event_date date,
  observed_at          timestamptz not null,
  news_days            smallint not null,
  rule_version         smallint not null,
  classified_at        timestamptz not null default now()
);
alter table public.dev_change_recovery enable row level security;
revoke all on public.dev_change_recovery from public, anon, authenticated, service_role;
grant select, insert on public.dev_change_recovery to service_role;

-- ---- 2. THE PARAMETERS AND THE TWO READ HELPERS ------------------------------------------------------------------------
-- A design parameter, not a founder-set value: a stamped record whose publisher date is older than this at first sighting
-- is "historical", not news. Changing it is this function's body and nothing else. (45 matches the 45-day recent-activity
-- window quoted in docs/zip-scope-bounds-runbook.md gate 7; confirm before the first canary.)
create or replace function public.dev_change_recovery_news_days() returns smallint
language sql immutable as $$ select 45::smallint $$;
create or replace function public.dev_change_recovery_rule_version() returns smallint
language sql immutable as $$ select 1::smallint $$;

-- Identities that the CACHE says were reached only by the polygon widening. Same filters, same identity function as
-- app_refresh_zip's `src` CTE, so a key here is exactly a key app_projects holds.
create or replace function public.dev_change_recovery_stamped(p_zip text) returns setof text
language sql stable security definer set search_path = public, pg_temp as $$
  select distinct public.app_source_key(d.el)
    from public.dev_sites_deduped(p_zip) as d
   where d.el->>'scope_origin' = 'polygon_member'
     and coalesce(d.el->>'relevance','') = 'development'
     and coalesce(d.el->>'scope','') = 'point'
     and coalesce(d.el->>'record_url', d.el->>'url','') <> ''
     and public.app_source_key(d.el) is not null
$$;

-- THE BARRIER. True when what app_projects holds for this ZIP was materialised from the CURRENT cache. app_refresh_zip
-- stamps every row's provenance.refreshed_at with development_reports.refreshed_at, so a cache that is newer than the
-- newest materialised row has not been materialised yet and its stamps do not describe the rows.
create or replace function public.dev_change_materialization_current(p_zip text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select case
    -- nothing cached for the ZIP, or the cache carries no clock: there are no stamps to be out of step with
    when (select d.refreshed_at from public.development_reports d where d.zip = p_zip) is null then true
    -- nothing materialised: the observation reads no rows
    when not exists (select 1 from public.app_projects a
                      where a.zip = p_zip and a.record_kind = 'development' and a.source_key is not null) then true
    -- the newest materialised row must be at least as new as the cache it came from (unparsable = not current)
    else coalesce(
      (select max((a.provenance->>'refreshed_at')::timestamptz)
         from public.app_projects a
        where a.zip = p_zip and a.record_kind = 'development' and a.source_key is not null
          and a.provenance->>'refreshed_at' ~ '^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}')
      >= (select d.refreshed_at from public.development_reports d where d.zip = p_zip),
      false)
  end
$$;

-- ---- 3. SPLICE THE TWO LIVE BODIES ------------------------------------------------------------------------------------
do $splice$
declare
  _oid_o oid := 'public.dev_change_observe_zip(text, uuid)'::regprocedure;
  _oid_t oid := 'public.dev_change_tick(uuid, integer, integer, bigint, bigint, integer)'::regprocedure;
  _def text; _new text; _orig_src text; _new_src text; _back text;
  _pairs_o text[][]; _pairs_t text[][]; i int; n int;
begin
  if position('-- dev_change_recovery:' in (select prosrc from pg_proc where oid = _oid_o)) > 0 then
    return;     -- already spliced (the precondition proved tick is too)
  end if;

  -- ---- dev_change_observe_zip ----
  _pairs_o := array[
    -- declarations
    array[E'  _newconf integer := 0;  -- new identities recorded non-comparable because their copies already contradict\nbegin',
          E'  _newconf integer := 0;  -- new identities recorded non-comparable because their copies already contradict\n  _rec_supp integer := 0;   -- dev_change_recovery: stamped first sightings classified as not-news\n  _rec_gen  integer := 0;   -- dev_change_recovery: stamped first sightings classified as genuinely recent\n  _rec_cache_at timestamptz; -- dev_change_recovery: the cache clock the barrier saw\nbegin'],
    -- barrier, right after the single-writer lock
    array[E'    return jsonb_build_object(''status'', ''busy'');\n  end if;\n',
          E'    return jsonb_build_object(''status'', ''busy'');\n  end if;\n  -- dev_change_recovery: BARRIER. Do not observe a ZIP whose cache is newer than what was materialised from it: the\n  -- stamps in the cached sites would not describe the rows being read. Writes nothing; the tick retries it.\n  if not _baseline and not public.dev_change_materialization_current(p_zip) then\n    return jsonb_build_object(''status'', ''deferred'', ''reason'', ''cache_newer_than_materialisation'', ''zip'', p_zip);\n  end if;\n  select d.refreshed_at into _rec_cache_at from public.development_reports d where d.zip = p_zip;\n'],
    -- classification, before the new identities are written
    array[E'  -- New identities (state first, so events can reference them). One whose copies already contradict is',
          E'  -- dev_change_recovery: CLASSIFY first sightings of identities the polygon widening alone reached. Ordinary runs only\n  -- (a baseline run already writes non-reportable first sightings). Evaluated here, by the one writer, in the same\n  -- transaction that creates the identity, so no ordinary observation can precede its classification.\n  create temp table if not exists _dc_recovery (identity_key text primary key, outcome text not null) on commit delete rows;\n  truncate _dc_recovery;\n  if not _baseline then\n    insert into _dc_recovery (identity_key, outcome)\n    select o.identity_key,\n           case when o.submitted_at is null or o.submitted_at > o.observed_at::date + 1 then ''undated_failed_closed''\n                when o.submitted_at >= o.observed_at::date - public.dev_change_recovery_news_days() then ''genuine_recent''\n                else ''historical_backlog'' end\n      from _dc_obs o\n     where o.is_new and o.here_comparable\n       and not exists (select 1 from _dc_conflict k where k.identity_key = o.identity_key)\n       and o.identity_key in (select s from public.dev_change_recovery_stamped(p_zip) s);\n    select count(*) filter (where outcome <> ''genuine_recent''), count(*) filter (where outcome = ''genuine_recent'')\n      into _rec_supp, _rec_gen from _dc_recovery;\n    -- the cache must not have moved while the stamps were read (READ COMMITTED gives each statement its own snapshot).\n    -- Nothing has been written yet, so deferring here is clean; the tick retries the ZIP.\n    if (select d.refreshed_at from public.development_reports d where d.zip = p_zip) is distinct from _rec_cache_at then\n      return jsonb_build_object(''status'', ''deferred'', ''reason'', ''cache_changed_during_observation'', ''zip'', p_zip);\n    end if;\n  end if;\n\n  -- New identities (state first, so events can reference them). One whose copies already contradict is'],
    -- the first_detected insert: not news when classified as recovery
    array[E'  select o.identity_key, ''first_detected'', not _baseline, _baseline, o.observed_at, null, o.facts, null,\n         o.fp, ''{}''::text[], o.date_kind, o.submitted_at, o.registry_id, _dv, _fv, p_run\n    from _dc_obs o\n   where o.is_new and o.here_comparable\n',
          E'  select o.identity_key, ''first_detected'',\n         not (_baseline or (rc.identity_key is not null and rc.outcome <> ''genuine_recent'')),\n         (_baseline or (rc.identity_key is not null and rc.outcome <> ''genuine_recent'')),\n         o.observed_at, null, o.facts, null,\n         o.fp, ''{}''::text[], o.date_kind, o.submitted_at, o.registry_id, _dv, _fv, p_run\n    from _dc_obs o left join _dc_recovery rc on rc.identity_key = o.identity_key\n   where o.is_new and o.here_comparable\n'],
    -- the audit rows, after the first_detected insert's GET DIAGNOSTICS
    array[E'  get diagnostics _ev = row_count;\n\n  -- A difference between two comparable observations',
          E'  get diagnostics _ev = row_count;\n\n  insert into public.dev_change_recovery\n    (identity_key, zip, run_id, outcome, publisher_event_date, observed_at, news_days, rule_version)\n  select r.identity_key, p_zip, p_run, r.outcome, o.submitted_at, o.observed_at,\n         public.dev_change_recovery_news_days(), public.dev_change_recovery_rule_version()\n    from _dc_recovery r join _dc_obs o on o.identity_key = r.identity_key\n  on conflict (identity_key) do nothing;\n\n  -- A difference between two comparable observations'],
    -- return value
    array[E'''copy_conflicts_held'', _held, ''identities_new_conflicted'', _newconf);',
          E'''copy_conflicts_held'', _held, ''identities_new_conflicted'', _newconf,\n                            ''recovery_not_news'', _rec_supp, ''recovery_genuine'', _rec_gen);']
  ];
  select prosrc into _orig_src from pg_proc where oid = _oid_o;
  _def := pg_get_functiondef(_oid_o);
  _new := _def;
  for i in 1 .. array_length(_pairs_o, 1) loop
    n := (length(_new) - length(replace(_new, _pairs_o[i][1], ''))) / length(_pairs_o[i][1]);
    if n <> 1 then raise exception 'dev_change_recovery: observe_zip anchor % appears % times (need exactly 1)', i, n; end if;
    _new := replace(_new, _pairs_o[i][1], _pairs_o[i][2]);
  end loop;

  -- ---- dev_change_tick (spliced next, executed together so neither can land alone) ----
  select prosrc into _orig_src from pg_proc where oid = _oid_t;
  _pairs_t := array[
    array[E'  _errs       integer := 0;\n', E'  _errs       integer := 0;\n  _deferred   integer := 0;   -- dev_change_recovery: ZIPs not observed because the cache is newer than the materialisation\n'],
    array[E'      if _res->>''status'' = ''busy'' then _reason := ''busy''; exit; end if;\n',
          E'      if _res->>''status'' = ''busy'' then _reason := ''busy''; exit; end if;\n      -- dev_change_recovery: a deferred ZIP wrote nothing and is NOT marked observed; the next tick tries it again.\n      if _res->>''status'' = ''deferred'' then _deferred := _deferred + 1; continue; end if;\n'],
    array[E'    ''zip_errors'', _errs,\n', E'    ''zip_errors'', _errs,\n    ''zips_deferred'', _deferred,\n']
  ];
  declare _defT text := pg_get_functiondef(_oid_t); _newT text := pg_get_functiondef(_oid_t); begin
    for i in 1 .. array_length(_pairs_t, 1) loop
      n := (length(_newT) - length(replace(_newT, _pairs_t[i][1], ''))) / length(_pairs_t[i][1]);
      if n <> 1 then raise exception 'dev_change_recovery: tick anchor % appears % times (need exactly 1)', i, n; end if;
      _newT := replace(_newT, _pairs_t[i][1], _pairs_t[i][2]);
    end loop;
    execute _new;
    execute _newT;
    -- PROOF: excising every inserted fragment (last first) recovers the ORIGINAL prosrc byte for byte.
    select prosrc into _new_src from pg_proc where oid = _oid_o; _back := _new_src;
    for i in reverse array_length(_pairs_o, 1) .. 1 loop _back := replace(_back, _pairs_o[i][2], _pairs_o[i][1]); end loop;
    if md5(_back) <> '042ce94641c713c6c0b6e7d18c4addb6' then raise exception 'dev_change_recovery: observe_zip splice is not a pure insertion (got %)', md5(_back); end if;
    select prosrc into _new_src from pg_proc where oid = _oid_t; _back := _new_src;
    for i in reverse array_length(_pairs_t, 1) .. 1 loop _back := replace(_back, _pairs_t[i][2], _pairs_t[i][1]); end loop;
    if md5(_back) <> '59ce03a97d78ca872735d613d286c991' then raise exception 'dev_change_recovery: tick splice is not a pure insertion (got %)', md5(_back); end if;
  end;
end $splice$;

-- ---- 4. THE READER RULE, WITH ITS DECISION OWNER -------------------------------------------------------------------------
-- Same columns, same order. Excludes events a baseline-class decision wrote (is_baseline) even from an ordinary run.
create or replace view public.dev_change_event_reportable with (security_invoker = true) as
select e.id, e.identity_key, e.event_type, e.material, e.is_baseline, e.observed_at,
       e.prev_facts, e.new_facts, e.prev_fp, e.new_fp, e.changed_fields,
       e.publisher_event_type, e.publisher_event_date, e.source_id,
       e.derivation_version, e.facts_version, e.rights_class, e.run_id, e.created_at
  from public.dev_change_event e
  join public.dev_change_run r on r.id = e.run_id
 where not r.baseline and not e.is_baseline;
revoke all on public.dev_change_event_reportable from public, anon, authenticated, service_role;
grant select on public.dev_change_event_reportable to service_role;

-- ---- 5. LOCK-DOWN of the new functions: system-only ---------------------------------------------------------------------
do $lock$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('dev_change_recovery_news_days','dev_change_recovery_rule_version',
                  'dev_change_recovery_stamped','dev_change_materialization_current') loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
  if has_function_privilege('anon', 'public.dev_change_recovery_stamped(text)', 'execute')
     or has_function_privilege('authenticated', 'public.dev_change_materialization_current(text)', 'execute')
     or has_table_privilege('anon', 'public.dev_change_recovery', 'select')
     or has_table_privilege('authenticated', 'public.dev_change_recovery', 'select') then
    raise exception 'dev_change_recovery: a new object is reachable by anon/authenticated';
  end if;
end $lock$;

-- ROLLBACK (restores the exact original bodies by excising the spliced text; run as one transaction):
--   Re-run this file's splice in reverse: for each (anchor, replacement) pair, replace(replacement -> anchor) in
--   pg_get_functiondef(...) and execute; then `create or replace view public.dev_change_event_reportable` WITHOUT
--   `and not e.is_baseline` (docs/dev-change-reportable.sql). Tables/functions:
--   drop function if exists public.dev_change_recovery_stamped(text), public.dev_change_materialization_current(text),
--     public.dev_change_recovery_news_days(), public.dev_change_recovery_rule_version();
--   The table dev_change_recovery is audit history; keep it (the ledger never deletes).
