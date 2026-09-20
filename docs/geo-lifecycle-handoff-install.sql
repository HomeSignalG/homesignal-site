-- ============================================================================
-- GEOGRAPHY LIFECYCLE HANDOFF — EXECUTABLE INSTALL ARTIFACT
--
-- PARKED. NOT APPLIED. Requires explicit founder approval plus a repeat of the
-- ingest gate and the drift check in the same window it is applied.
--
-- WHAT THIS IS, AND WHY IT EXISTS
-- docs/geo-work-handoff.sql (accepted at dedb7db) carries the queue and the
-- enqueue function as executable SQL, but describes THE FOUR SPLICES INTO
-- public.app_refresh_zip only as prose inside a comment block. This repo has
-- already paid for that shape once: "A PARKED MIGRATION THAT IS MOSTLY COMMENTS
-- IS NOT A MIGRATION" (CLAUDE.md, EPA Phase 1b) - replaying it added the column
-- and skipped the writer while looking complete. This file is the missing
-- executable half. It adds nothing to the accepted design and changes none of it.
--
-- HOW IT APPLIES
-- By SPLICING the LIVE pg_get_functiondef output, never by replaying a dated
-- CREATE OR REPLACE from this repo. app_refresh_zip has been amended repeatedly
-- by other sessions (the EPA plane split; the government-notice 365/730 window)
-- and a replay would silently revert whatever landed since. Every anchor must
-- occur EXACTLY ONCE or the migration raises and rolls back.
--
-- THE TRANSFORMATION IS PROVEN REVERSIBLE BEFORE IT IS APPLIED. After splicing,
-- the migration re-applies every replacement backwards and asserts the result is
-- md5-identical to the body it read. That is what establishes "only the intended
-- bytes moved" - a diff can be eyeballed, an excision cannot be fudged.
--
-- ⚠️ TWO ANCHOR HAZARDS, BOTH MEASURED AGAINST THE LIVE BODY (2026-09-20):
--
--   (1) `delete from public.app_projects p` OCCURS TWICE - at line 30 and at
--       line 156. Line 30 deletes rows `where p.source_key is null`, i.e. legacy
--       pre-stable-key rows. It is NOT the stale sweep and carries NO geography
--       meaning (geography is keyed by source_key; a NULL key has none). Only
--       line 156 is spliced. An anchor on the bare statement head would have
--       edited both. Same class as the government-notice window's "the bare
--       14-day clause appears twice, the second one is Local News."
--
--   (2) `      source_key_basis=excluded.source_key_basis, last_seen_at=excluded.last_seen_at;`
--       is BYTE-IDENTICAL at line 106 (development upsert tail) and line 153
--       (facility upsert tail). Neither can be anchored on alone. A2 therefore
--       carries the following blank line AND the facility insert head; A3 carries
--       the following `  end if;`. Each is unique; each is asserted to occur once.
--
-- 🔑 THE STALE SWEEP CANNOT SIMPLY BE WRAPPED IN A CTE, AND THIS IS THE ONE
--    PLACE A NAIVE SPLICE CORRUPTS UNRELATED STATE. Line 162 reads
--    `get diagnostics _stale = row_count;`. Wrapping the DELETE in a CTE makes
--    row_count report the OUTER statement's count (1), so `_stale` would silently
--    become 1 on every run, and `_stale` is returned in this function's status
--    string. A4 therefore replaces the `get diagnostics` line as well, setting
--    `_stale` from `count(*)` over the delete's own RETURNING set - the identical
--    value by construction. Proven equal in the fixture, both for a non-empty and
--    an empty delete (count(*) over zero rows is 0, matching row_count = 0).
--
--    The rejected alternative was to capture the keys in a separate SELECT before
--    the DELETE, leaving the DELETE and `get diagnostics` untouched. That
--    duplicates a five-line predicate into a second copy that silently stops
--    matching the first the next time either is edited - the hand-copied-list
--    anti-pattern CLAUDE.md records under _BODY_AS_PLACE_RE. One statement, one
--    predicate, one evaluation.
--
-- DEPENDENCY / DEPLOYMENT ORDER
--   1. docs/geo-work-handoff.sql        (queue + geo.enqueue_work)   <- REQUIRED FIRST
--   2. docs/geo-proven-expected-geometry.sql
--   3. docs/geo-source-scoped-reconcile.sql
--   4. THIS FILE
--   5. docs/geo-health-integration-install.sql
-- This file hard-checks (1) and refuses to run without it: splicing a call to a
-- function that does not exist would leave app_refresh_zip raising 42883 on every
-- tick, i.e. it would take the national materializer down.
--
-- ⚠️ CAPTURE CONTRACT. Once applied, these handoffs capture lifecycle events
-- IMMEDIATELY - app_refresh_zip runs ~240x/hour - so "reconciliation executions
-- = 0" and "the queue is empty" are different claims and only the first stays
-- true after install. Nothing here starts a worker.
--
-- 🔑 CAPTURE IS SCOPED TO NEW / CHANGED / REMOVED, WHICH IS WHAT THE ACCEPTED
-- CONTRACT SAYS ("how a NEW or CHANGED live project reaches the reconciler";
-- "A KEY THAT NEEDS EVALUATING"). An unchanged key whose refresh heartbeat
-- advanced is NOT captured.
--
-- THE RELEVANCE PREDICATE IS READ OFF THE GEOGRAPHY PATH, NOT GUESSED. The only
-- app_projects columns any accepted geography artifact consumes are the ones
-- geo.proven_expected_geometry's `live` CTE selects - source_key, registry_id,
-- lat, lng - under the eligibility filter record_kind = 'development'. The
-- reconciler reads geo.* only; its sole app_projects references are in its post
-- gate. So a change is relevant iff, for a (zip, source_key, source_seq):
--   * the row did not exist before  (NEW), or
--   * registry_id / lat / lng changed, or
--   * record_kind changed           (an ELIGIBILITY flip, in either direction).
-- last_seen_at is deliberately ABSENT from that list: it is the heartbeat.
--
-- HOW, WITHOUT TOUCHING THE MATERIALIZER'S UPSERT. Each upsert gains a PRE-IMAGE
-- CTE (geo_prev_dev / geo_prev_fac) scoped to `zip = _zip` - one ZIP's rows, the
-- same bound the upsert already has, never a corpus scan - and the handoff joins
-- the RETURNING set against it. ⛔ NO `where` IS ADDED TO `do update`: that would
-- stop last_seen_at advancing for unchanged rows and the stale sweep at line 156
-- deletes `last_seen_at < _run`, so a geography optimisation would become
-- national data loss. The upsert, its SET list, the stale-sweep predicates, the
-- retention `not exists` guards, `_stale` and every returned count are untouched.
--
-- NO WARM-UP. On the first refresh after install the pre-image already holds the
-- existing rows, so an unchanged corpus enqueues NOTHING. The historical backlog
-- is never enrolled by installing this.
--
-- CONCURRENCY, AND WHICH WAY IT FAILS. Both CTEs belong to ONE statement: the
-- pre-image reads the statement snapshot while ON CONFLICT re-reads the latest
-- committed row, so under READ COMMITTED a concurrent writer can make the two
-- disagree. That direction is OVER-capture (a key enqueued though nothing this
-- statement did changed it), never a miss - and re-evaluating an unchanged key is
-- idempotent. A missed change is the outcome that would be unsafe, and it cannot
-- arise: RETURNING reports what this statement wrote.
--
-- CROSS-ZIP AND source_seq. The join key is (zip, source_key, source_seq), so a
-- new source_seq for an existing key is NEW, and a key spanning ZIPs is captured
-- by whichever ZIP's refresh saw the change. The reconciler is source-key scoped
-- and rebuilds from all of a key's evidence, so one ZIP's enqueue suffices.
--
-- FACILITY KEYS: ELIGIBILITY UNCHANGED, EXPLICITLY. Facility upserts still
-- enqueue exactly as before; only the CHANGE scoping is new. Nothing about which
-- record kinds may enter the queue has moved.
-- ============================================================================

begin;

do $mig$
declare
  _src text; _out text; _back text;
  _md5_before text; _md5_after text;
  _n int; _i int;
  _expect_before constant text := '6591d7f79f9a6cd0b476bbcfc2065b9a';
  _pairs text[];
begin
  -- ---- (0) dependency: the passive core must already be installed -----------
  if to_regclass('geo.n5_reconcile_queue') is null then
    raise exception 'DEPENDENCY MISSING: geo.n5_reconcile_queue. Apply docs/geo-work-handoff.sql first.';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'geo' and p.proname = 'enqueue_work') then
    raise exception 'DEPENDENCY MISSING: geo.enqueue_work. Apply docs/geo-work-handoff.sql first.';
  end if;

  -- ---- (1) freshly capture the live body and pin it -------------------------
  _src := pg_get_functiondef('public.app_refresh_zip(text)'::regprocedure);
  _md5_before := md5(_src);
  if _md5_before <> _expect_before then
    raise exception
      'PRECONDITION FAIL / CONCURRENT DRIFT: app_refresh_zip md5 is %, expected %. '
      'Another session amended the function. Re-run docs/geo-lifecycle-handoff-verify.sql '
      'against the new body, re-confirm every anchor occurs exactly once, update '
      '_expect_before and the expected-after fingerprint, and have the diff re-reviewed. '
      'DO NOT relax this check.', _md5_before, _expect_before;
  end if;

  _out := _src;

  -- ---- (2) the five replacements, each asserted to match EXACTLY ONCE -------
  -- Flattened triples: label, find, replace.
  _pairs := array[

  'A0 declare _geo_keys',
$f$        _run timestamptz; _stale int; _kept int;$f$,
$r$        _run timestamptz; _stale int; _kept int;
        _geo_keys text[];$r$,

  'A1 development upsert head -> CTE open',
$f$    insert into public.app_projects (community_id, zip, name, type, status, stage, developer, size, investment, submitted_at, lat, lng, impact_score, source_ref, record_kind, registry_id, date_kind, type_raw,$f$,
$r$    with geo_prev_dev as (
      select zip, source_key, source_seq, registry_id, lat, lng, record_kind
        from public.app_projects
       where zip = _zip and record_kind = 'development'
    ),
    geo_up_dev as (
    insert into public.app_projects (community_id, zip, name, type, status, stage, developer, size, investment, submitted_at, lat, lng, impact_score, source_ref, record_kind, registry_id, date_kind, type_raw,$r$,

  'A2 development upsert tail -> NEW+UPDATE handoff, and facility CTE open',
$f$      source_key_basis=excluded.source_key_basis, last_seen_at=excluded.last_seen_at;

    insert into public.app_projects (community_id, zip, name, type, status, developer, lat, lng, impact_score, source_ref, record_kind, registry_id, facility_env,$f$,
$r$      source_key_basis=excluded.source_key_basis, last_seen_at=excluded.last_seen_at
      returning source_key, source_seq, zip, registry_id, lat, lng, record_kind
    )
    select array_agg(distinct u.source_key) into _geo_keys
      from geo_up_dev u
      left join geo_prev_dev p
        on  p.zip        = u.zip
        and p.source_key = u.source_key
        and p.source_seq = u.source_seq
     where p.source_key is null
        or p.registry_id is distinct from u.registry_id
        or p.lat         is distinct from u.lat
        or p.lng         is distinct from u.lng
        or p.record_kind is distinct from u.record_kind;
    perform geo.enqueue_work(_geo_keys, 'project_upsert');

    with geo_prev_fac as (
      select zip, source_key, source_seq, registry_id, lat, lng, record_kind
        from public.app_projects
       where zip = _zip and record_kind = 'facility'
    ),
    geo_up_fac as (
    insert into public.app_projects (community_id, zip, name, type, status, developer, lat, lng, impact_score, source_ref, record_kind, registry_id, facility_env,$r$,

  'A3 facility upsert tail -> NEW+UPDATE handoff',
$f$      source_key_basis=excluded.source_key_basis, last_seen_at=excluded.last_seen_at;
  end if;$f$,
$r$      source_key_basis=excluded.source_key_basis, last_seen_at=excluded.last_seen_at
      returning source_key, source_seq, zip, registry_id, lat, lng, record_kind
    )
    select array_agg(distinct u.source_key) into _geo_keys
      from geo_up_fac u
      left join geo_prev_fac p
        on  p.zip        = u.zip
        and p.source_key = u.source_key
        and p.source_seq = u.source_seq
     where p.source_key is null
        or p.registry_id is distinct from u.registry_id
        or p.lat         is distinct from u.lat
        or p.lng         is distinct from u.lng
        or p.record_kind is distinct from u.record_kind;
    perform geo.enqueue_work(_geo_keys, 'project_upsert');
  end if;$r$,

  'A4 stale sweep -> SOURCE_REMOVED handoff, _stale preserved',
$f$  delete from public.app_projects p
   where p.zip=_zip
     and (p.last_seen_at is null or p.last_seen_at < _run)
     and not exists (select 1 from public.property_company_roles r where r.project_id = p.id)
     and not exists (select 1 from public.project_facility_refs  f where f.project_id = p.id)
     and not exists (select 1 from public.identity_conflicts     c where c.project_id = p.id);
  get diagnostics _stale = row_count;$f$,
$r$  with geo_del as (
  delete from public.app_projects p
   where p.zip=_zip
     and (p.last_seen_at is null or p.last_seen_at < _run)
     and not exists (select 1 from public.property_company_roles r where r.project_id = p.id)
     and not exists (select 1 from public.project_facility_refs  f where f.project_id = p.id)
     and not exists (select 1 from public.identity_conflicts     c where c.project_id = p.id)
  returning p.source_key
  )
  select count(*)::int,
         array_agg(distinct source_key) filter (where source_key is not null)
    into _stale, _geo_keys
    from geo_del;
  perform geo.enqueue_work(_geo_keys, 'stale_removed');$r$,

  'A5 geocode fence -> coordinate-change handoff',
$f$    update public.app_projects set lat=null, lng=null
     where zip=_zip and lat is not null and (
       lat not between 17 and 72 or lng not between -180 and -60
       or (_lat is not null and 3959*acos(least(1::double precision, greatest(-1::double precision,
            cos(radians(_lat))*cos(radians(lat))*cos(radians(lng)-radians(_lng))
            + sin(radians(_lat))*sin(radians(lat))))) > 100)
     );$f$,
$r$    with geo_fence as (
    update public.app_projects set lat=null, lng=null
     where zip=_zip and lat is not null and (
       lat not between 17 and 72 or lng not between -180 and -60
       or (_lat is not null and 3959*acos(least(1::double precision, greatest(-1::double precision,
            cos(radians(_lat))*cos(radians(lat))*cos(radians(lng)-radians(_lng))
            + sin(radians(_lat))*sin(radians(lat))))) > 100)
     )
    returning source_key
    )
    select array_agg(distinct source_key) into _geo_keys from geo_fence;
    perform geo.enqueue_work(_geo_keys, 'geocode_nulled');$r$
  ];

  for _i in 1 .. array_length(_pairs, 1) / 3 loop
    declare
      _label text := _pairs[(_i-1)*3 + 1];
      _find  text := _pairs[(_i-1)*3 + 2];
      _repl  text := _pairs[(_i-1)*3 + 3];
    begin
      _n := (length(_out) - length(replace(_out, _find, ''))) / length(_find);
      if _n <> 1 then
        raise exception 'ANCHOR NOT UNIQUE: % occurs % time(s), expected exactly 1. '
                        'Ambiguous insertion point - refusing to splice.', _label, _n;
      end if;
      _out := replace(_out, _find, _repl);
    end;
  end loop;

  -- ---- (3) EXCISION PROOF: reverse every replacement, expect the original ---
  _back := _out;
  for _i in reverse array_length(_pairs, 1) / 3 .. 1 loop
    _back := replace(_back, _pairs[(_i-1)*3 + 3], _pairs[(_i-1)*3 + 2]);
  end loop;
  if md5(_back) <> _md5_before then
    raise exception 'EXCISION PROOF FAILED: reversing the splice did not reconstruct the '
                    'original body (got %, expected %). The transformation touched bytes it '
                    'did not intend to.', md5(_back), _md5_before;
  end if;

  -- ---- (4) structural assertions on the spliced text ------------------------
  if (length(_out) - length(replace(_out, 'geo.enqueue_work', ''))) / length('geo.enqueue_work') <> 4 then
    raise exception 'EXPECTED EXACTLY 4 HANDOFFS, found %',
      (length(_out) - length(replace(_out, 'geo.enqueue_work', ''))) / length('geo.enqueue_work');
  end if;
  if position('get diagnostics _stale = row_count;' in _out) <> 0 then
    raise exception 'A4 did not replace the get diagnostics line; _stale would be corrupted.';
  end if;
  -- the line-30 legacy delete must be untouched
  if position($chk$  delete from public.app_projects p
   where p.zip=_zip and p.source_key is null$chk$ in _out) = 0 then
    raise exception 'THE LINE-30 LEGACY DELETE WAS MODIFIED. It must be left exactly as-is.';
  end if;

  -- ---- (5) apply ------------------------------------------------------------
  execute _out;

  -- ---- (6) read back and prove what landed ---------------------------------
  _md5_after := md5(pg_get_functiondef('public.app_refresh_zip(text)'::regprocedure));
  if _md5_after = _md5_before then
    raise exception 'POST-APPLY: body unchanged - the replace produced identical text.';
  end if;
  if pg_get_functiondef('public.app_refresh_zip(text)'::regprocedure) <> _out then
    raise exception 'POST-APPLY: server-rendered body differs from the text applied. '
                    'Re-render drift - refusing to leave this in place.';
  end if;

  raise notice 'app_refresh_zip spliced: md5 % -> %', _md5_before, _md5_after;
  raise notice 'HANDOFFS LIVE. The queue begins filling on the next tick (~2 min).';
  raise notice 'Worker and scheduler remain OFF. Nothing consumes geo.n5_reconcile_queue.';
end $mig$;

-- Post-conditions a reviewer can re-run independently of the migration's own
-- NOTICEs. Any false here means the apply did not do what it claims.
-- ⚠️ THESE GATES FAIL CLOSED. Each read is WRAPPED so that a missing or
-- unreadable catalog aborts BY NAME rather than as an anonymous 42P01 - but it
-- aborts either way. "I could not check whether a trigger exists" is not
-- permission to proceed with a production mutation.
do $post$
begin
  begin
    if (select count(*) from pg_trigger t
         where t.tgrelid = 'public.app_projects'::regclass and not t.tgisinternal) <> 0 then
      raise exception 'A trigger appeared on public.app_projects. None is authorised.';
    end if;
  exception
    when insufficient_privilege or undefined_table then
      raise exception 'STOP - TRIGGER CHECK NOT EVALUATED: public.app_projects unreadable (%). '
                      'An unevaluated safety check is NOT permission to proceed.', sqlerrm;
  end;
  begin
    if (select count(*) from cron.job where jobname ~* 'geo|reconcil|n5') <> 0 then
      raise exception 'A geography cron job exists. The scheduler must remain OFF.';
    end if;
  exception
    when insufficient_privilege or undefined_table or invalid_schema_name then
      raise exception 'STOP - SCHEDULER CHECK NOT EVALUATED: cron catalog unreadable (%). '
                      'An unevaluated safety check is NOT permission to proceed.', sqlerrm;
  end;
end $post$;

commit;
