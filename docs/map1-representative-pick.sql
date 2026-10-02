-- ============================================================================
-- MAP 1 STEP (a), SECOND VERSION: EACH PIN SHOWS ITS PROJECT'S NEWEST RECORD, LOOKED UP FROM A
-- STORED DAILY PICK (2026-10-02). DDL OF RECORD. NOT APPLIED.
-- Founder-approved goal, 2026-10-02: "newest record shown, page addresses kept the same, all
-- three places changed together", with the before-and-after shown before anything goes live.
-- Replaces docs/map1-representative-newest.sql, which was applied and rolled back the same hour.
-- Rollback: docs/map1-representative-pick.rollback.sql.
--
-- THE DEFECT (unchanged). Map 1 draws one pin per source_key, and a source_key can carry several
-- public.app_projects rows: the same record copied into each ZIP it touches, and sometimes
-- several different records that share the key (a 1996 site plan and its 2026 amendment; an NYC
-- job's FO and NB permits). Three readers pick the row that describes the pin, and all three
-- pick `order by p.id asc limit 1`. id is gen_random_uuid(), so the pick is arbitrary.
--   public.app_zip_projects_markers              Map 1's ZIP read (site)
--   public.app_authoritative_projects_for_zip    the ZIP page's read (site)
--   public.app_development_projects_for_zips     the Rule D / project-page bulk read (ingest)
--
-- WHY THE FIRST VERSION WAS ROLLED BACK. It decided the newest row at READ time,
-- `order by submitted_at desc, last_seen_at desc, id limit 1`, once per pin. Every ZIP copy of
-- a record shares its submitted_at, so the last_seen_at tie-break read every copy: 333 members
-- in 010xx read 29,541 rows, one key has 1,728 copies, Map 1 for ZIP 30032 took 20.8 s cold
-- (limit 25 s), and the Rule D refresh died on its first call (57014). Indexing last_seen_at
-- would have made about 670,000 updates a day non-HOT across 8 indexes.
--
-- THIS VERSION decides once a day and stores the answer.
--   public.app_project_pick (source_key, record_kind) -> project_id holds ONE row per key whose
--   newest record is NOT its lowest-id row. Every other key is already shown correctly by the
--   lowest-id row, so it needs no entry.
--   public.app_project_pick_refresh() recomputes the table set-based: one hash aggregate over
--   app_projects finds the keys whose rows disagree on a fact (only those can need a stored
--   pick), only their rows are ranked, only changed rows are written, and the run is logged in
--   public.app_project_pick_runs. pg_cron runs it daily at 04:50 UTC (PART C),
--   40 minutes before the Rule D refresh and 110 minutes before the site build.
--   public.app_project_representative(source_key, record_kind), the one function the three
--   readers call, returns the stored pick if it still exists and still belongs to that key,
--   otherwise the lowest-id row (today's pick). It never reads the key's copies.
--
-- MEASURED ON PRODUCTION, READ-ONLY, 2026-10-02 (db-sql runs on scratch queries, in quarters):
--   the refresh would store 2,116 picks (2,108 development, 8 facility); about 3 minutes for all
--   four quarters, measured together with the comparison below. 2,589 of 912,246 drawn pins
--   change their card (name, status, date, type or address), on 887 ZIP pages; 840 drawn keys
--   change source_seq (project-page addresses are kept by homesignal-ingest's pageSeqs). 2 MAPS
--   drafts (0 approved, 0 published) sit on a stored key. Page reads, ZIPs 30032 + 97702 + 16801
--   (5,707 pins): 5,709 app_projects index entries today, 5,719 with this lookup (+10 = the 10
--   pins on stored keys); the rolled-back rule read 47,672 for 30032 alone.
--
-- THE RULE, ONCE (only in app_project_pick_refresh):
--   1. the newest record: rows with the latest submitted_at (undated last);
--   2. its newest version: among those rows, group the copies that state the same facts
--      (name, type, type_raw, status, stage, submitted_at, date_kind, source_ref, registry_id,
--      address, source_key_basis, developer, start_date, end_date, scope_text), and take the
--      group written most recently (max last_seen_at, unwritten last; last_seen_at moves only
--      when app_refresh_zip rewrites a row's content);
--   3. a stable copy: the lowest id in that group.
--   Copies that state the same facts are interchangeable on every page, so step 3 picks the
--   same copy every day instead of flipping between identical copies as they are rewritten.
--   Per-copy columns (id, zip, community_id, source_seq, created_at, last_seen_at, lat, lng,
--   impact_score, impact_dimensions, lens, provenance, facility_env, company_esg, parties, size,
--   investment, jobs) are not facts of the record and do not split a group.
--
-- FRESHNESS. A pick is at most one day old. Between refreshes a pin keeps the newest record of
-- the last refresh; a key that gains a second record between refreshes shows its lowest-id row
-- (today's behaviour) until the next one; a picked row that app_refresh_zip removes falls back
-- to the lowest-id row. app_projects itself is refreshed on a ~53 h sweep, so the pick is never
-- the slowest part.
--
-- ACCESS. The three readers are SECURITY DEFINER (owner postgres), so they read the pick table
-- as its owner. The tables have RLS on, no policies, and nothing granted to PUBLIC, anon or
-- authenticated; the refresh is not executable by them either. The lookup function is plain
-- LANGUAGE sql, STABLE, not STRICT, not SECURITY DEFINER and has no SET clause, so the planner
-- inlines it into each reader. Its body is two branches: the stored pick (read through
-- app_project_pick_pkey, then app_projects_pkey), or, only when no valid pick is stored, the
-- lowest-id row (app_projects_skey_kind_id_idx, limit 1). So a pin with no stored pick reads
-- exactly what it reads today (one app_projects index entry and one row) plus two probes of the
-- small pick table; a pin with a stored pick reads two app_projects index entries and two rows.
-- Every name in its body is schema-qualified.
--
-- HOW IT IS APPLIED (db-sql.yml, one part per run, in order):
--   PART A   one transaction: the two tables and the refresh function.
--   PART A2  alone: the first refresh (about one to two minutes on production).
--   PART B   one transaction: refuses unless a refresh finished in the last 6 hours; replaces
--            the lookup function (from the unused rolled-back body 28f6fefb..., or creates it);
--            splices both site readers from their LIVE definitions (fingerprint-guarded,
--            each anchor exactly once, owner/grants/SET clauses unchanged).
--   then homesignal-ingest's reader migration (it refuses until PART B is in place);
--   PART C   alone: the daily pg_cron job.
--
-- PROOF: test/n5_generation_pg/run_map1_pick.py, on a throwaway PostgreSQL + PostGIS built from
-- production's pre-state, with keys carrying 1,700 copies. It checks which row every reader
-- shows against an independent oracle, counts the index entries and rows each reader reads per
-- pin (the check the first version would have failed), and kills mutations, including one that
-- puts the rolled-back read-time rule back.
-- ============================================================================

-- ========================== PART A: tables and the refresh ==========================
do $pa$
begin
  perform set_config('lock_timeout', '5s', true);

  create table if not exists public.app_project_pick (
    source_key  text        not null,
    record_kind text        not null,
    project_id  uuid        not null,
    picked_at   timestamptz not null default now(),
    primary key (source_key, record_kind)
  );
  alter table public.app_project_pick enable row level security;
  revoke all on table public.app_project_pick from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on table public.app_project_pick from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on table public.app_project_pick from authenticated';
  end if;
  comment on table public.app_project_pick is
    'Map 1 step (a): for each source_key whose newest record is not its lowest-id row, the app_projects row that describes it. Written only by public.app_project_pick_refresh(); read through public.app_project_representative(). docs/map1-representative-pick.sql';

  create table if not exists public.app_project_pick_runs (
    ran_at     timestamptz not null primary key,
    seconds    numeric     not null,
    rows_read  bigint      not null,
    overrides  integer     not null,
    inserted   integer     not null,
    changed    integer     not null,
    deleted    integer     not null,
    part       integer     not null default 0,
    parts      integer     not null default 1
  );
  alter table public.app_project_pick_runs enable row level security;
  revoke all on table public.app_project_pick_runs from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on table public.app_project_pick_runs from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on table public.app_project_pick_runs from authenticated';
  end if;
  comment on table public.app_project_pick_runs is
    'One row per public.app_project_pick_refresh() run. docs/map1-representative-pick.sql';
end
$pa$;

create or replace function public.app_project_pick_refresh(p_part integer default 0, p_parts integer default 1)
returns jsonb
language plpgsql
set search_path = public, pg_temp
set work_mem = '128MB'
set statement_timeout = '15min'
as $fn$
declare
  t0 timestamptz := clock_timestamp();
  v_out jsonb;
begin
  -- p_parts > 1 refreshes one share of the keys (by a hash of source_key), so a first fill can
  -- run as several calls that each finish quickly. The daily job refreshes everything.
  if p_parts is null or p_parts < 1 or p_parts > 64 or p_part is null or p_part < 0 or p_part >= p_parts then
    raise exception 'app_project_pick_refresh: part % of % is not valid', p_part, p_parts using errcode = '22023';
  end if;
  -- One run at a time: a second caller waits for the first to finish.
  perform pg_advisory_xact_lock(hashtext('public.app_project_pick_refresh'));

  -- Only keys whose rows disagree on a fact can have a newest record that is not their
  -- lowest-id row (if every row states the same facts, the newest group is all of them and its
  -- lowest id is the key's). One hash aggregate over the table finds them, comparing a 64-bit
  -- hash of the facts (a collision could only leave a key on its lowest-id row, today's pick);
  -- only their rows are ranked, by the full facts.
  with amb as materialized (
    select s.source_key, s.record_kind, min(s.id_text collate "C") as key_first
      from (select p.source_key, p.record_kind, p.id::text as id_text,
                   hashtextextended(row(p.name, p.type, p.type_raw, p.status, p.stage, p.submitted_at, p.date_kind,
                                        p.source_ref, p.registry_id, p.address, p.source_key_basis, p.developer,
                                        p.start_date, p.end_date, p.scope_text)::text, 0) as h
              from public.app_projects p
             where p.source_key is not null
               and (hashtext(p.source_key)::bigint % p_parts + p_parts) % p_parts = p_part) s
     group by s.source_key, s.record_kind
    having min(s.h) <> max(s.h)
  ),
  -- Only those keys' rows are read again, by key, through app_projects_source_key_kind_idx.
  c as (
    select a.source_key, a.record_kind, a.key_first, r.id, r.last_seen_at, r.facts, r.newest
      from amb a
      cross join lateral (
        select p.id, p.last_seen_at,
               md5(row(p.name, p.type, p.type_raw, p.status, p.stage, p.submitted_at, p.date_kind,
                       p.source_ref, p.registry_id, p.address, p.source_key_basis, p.developer,
                       p.start_date, p.end_date, p.scope_text)::text) as facts,
               rank() over (order by p.submitted_at desc nulls last) as newest
          from public.app_projects p
         where p.source_key = a.source_key
           and p.record_kind = a.record_kind) r
  ),
  grp as (
    select source_key, record_kind, facts, key_first,
           max(last_seen_at) as written,
           min(id::text collate "C") as first_id
      from c
     where newest = 1
     group by source_key, record_kind, facts, key_first
  ),
  picked as (
    select distinct on (source_key, record_kind) source_key, record_kind, key_first, first_id
      from grp
     order by source_key, record_kind, written desc nulls last, first_id collate "C"
  ),
  want as (
    select source_key, record_kind, first_id::uuid as project_id
      from picked
     where first_id <> key_first
  ),
  del as (
    delete from public.app_project_pick k
     where (hashtext(k.source_key)::bigint % p_parts + p_parts) % p_parts = p_part
       and not exists (select 1 from want w
                        where w.source_key = k.source_key and w.record_kind = k.record_kind)
    returning 1
  ),
  up as (
    insert into public.app_project_pick as k (source_key, record_kind, project_id, picked_at)
    select w.source_key, w.record_kind, w.project_id, now() from want w
    on conflict (source_key, record_kind) do update
      set project_id = excluded.project_id, picked_at = excluded.picked_at
      where k.project_id is distinct from excluded.project_id
    returning (xmax = 0) as inserted
  )
  select jsonb_build_object(
           'rows_read', (select count(*) from c),
           'keys_disagreeing', (select count(*) from amb),
           'overrides', (select count(*) from want),
           'inserted',  (select count(*) from up where inserted),
           'changed',   (select count(*) from up where not inserted),
           'deleted',   (select count(*) from del))
    into v_out;

  insert into public.app_project_pick_runs (ran_at, seconds, rows_read, overrides, inserted, changed, deleted, part, parts)
  values (clock_timestamp(), round(extract(epoch from clock_timestamp() - t0)::numeric, 1),
          (v_out->>'rows_read')::bigint, (v_out->>'overrides')::int, (v_out->>'inserted')::int,
          (v_out->>'changed')::int, (v_out->>'deleted')::int, p_part, p_parts);
  return v_out || jsonb_build_object('part', p_part, 'parts', p_parts,
                                     'seconds', round(extract(epoch from clock_timestamp() - t0)::numeric, 1));
end
$fn$;

revoke all on function public.app_project_pick_refresh(integer, integer) from public;
do $pa2$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.app_project_pick_refresh(integer, integer) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function public.app_project_pick_refresh(integer, integer) from authenticated';
  end if;
  if md5((select prosrc from pg_proc where oid = 'public.app_project_pick_refresh(integer,integer)'::regprocedure))
     <> 'e36b0263e217ab8a36fcb357c4fe027e' then
    raise exception 'map1-representative-pick: public.app_project_pick_refresh fingerprints to %, expected e36b0263e217ab8a36fcb357c4fe027e. Rolled back.',
      md5((select prosrc from pg_proc where oid = 'public.app_project_pick_refresh(integer,integer)'::regprocedure));
  end if;
end
$pa2$;

-- ========================== PART A2: the first refresh (run ALONE) ==========================
-- On production the whole pass takes about 2-3 minutes, longer than db-sql's 2-minute client,
-- so run it there as four separate calls, one per db-sql run:
--   select public.app_project_pick_refresh(0, 4);  ...  select public.app_project_pick_refresh(3, 4);
select public.app_project_pick_refresh();

-- ========================== PART B: the lookup and the two site readers ==========================
do $rep$
declare
  rep_fn       constant text := 'public.app_project_representative(text,text)';
  rep_old_md5  constant text := '28f6fefb57b2d7fbd64e630caf272fcf';
  rep_md5      constant text := '2c01f73a567d0dde746481cb4e780510';
  rep_create   constant text := $fn$create or replace function public.app_project_representative(p_source_key text, p_record_kind text)
returns setof public.app_projects
language sql
stable
parallel safe
as $body$
  select p.*
    from public.app_project_pick k
    join public.app_projects p on p.id = k.project_id
                              and p.source_key = k.source_key
                              and p.record_kind = k.record_kind
   where k.source_key = p_source_key
     and k.record_kind = p_record_kind
  union all
  (select p.*
     from public.app_projects p
    where p.source_key = p_source_key
      and p.record_kind = p_record_kind
      and not exists (select 1
                        from public.app_project_pick k
                        join public.app_projects q on q.id = k.project_id
                                                  and q.source_key = k.source_key
                                                  and q.record_kind = k.record_kind
                       where k.source_key = p_source_key
                         and k.record_kind = p_record_kind)
    order by p.id
    limit 1)
$body$$fn$;
  mk_fn        constant regprocedure := 'public.app_zip_projects_markers(text,text,boolean)'::regprocedure;
  mk_pre       constant text := '4918783a335244d4a7056b4922120c1c';
  mk_post      constant text := '371f1fcfdfaf412b7de1a8a0bd7618ae';
  az_fn        constant regprocedure := 'public.app_authoritative_projects_for_zip(text)'::regprocedure;
  az_pre       constant text := 'f10327fed96e87285fee43cad667b764';
  az_post      constant text := 'dc2304ec115550df9946e98085ae7116';
  src          text;
  newdef       text;
  got          int;
  attrs_before text;
  attrs_after  text;
  r            record;
  f            record;
begin
  perform set_config('lock_timeout', '5s', true);

  -- 1. A refresh must have filled the pick table recently.
  if to_regclass('public.app_project_pick_runs') is null then
    raise exception 'map1-representative-pick: no app_project_pick_refresh() run in the last 6 hours (PART A has not been applied). Not applied.';
  end if;
  -- Every share of the keys must have been refreshed in the last 6 hours: one whole run, or all
  -- the parts of one split.
  if not exists (select 1 from public.app_project_pick_runs pr
                  where pr.ran_at > now() - interval '6 hours'
                  group by pr.parts having count(distinct pr.part) = pr.parts) then
    raise exception 'map1-representative-pick: no app_project_pick_refresh() run in the last 6 hours (PART A2 has not been run). Not applied.';
  end if;

  -- 2. The lookup. It replaces the unused rolled-back body, or is created; if it already
  --    exists with any other body, stop.
  select p.prosrc into src from pg_proc p where p.oid = to_regprocedure(rep_fn);
  if src is not null and md5(src) not in (rep_old_md5, rep_md5) then
    raise exception 'map1-representative-pick: public.app_project_representative exists with a different body (md5 %, expected % or %). Not applied.',
      md5(src), rep_old_md5, rep_md5;
  end if;
  if src is null or md5(src) <> rep_md5 then
    execute rep_create;
    execute 'revoke all on function public.app_project_representative(text, text) from public';
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute 'revoke all on function public.app_project_representative(text, text) from anon';
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute 'revoke all on function public.app_project_representative(text, text) from authenticated';
    end if;
    execute $c$comment on function public.app_project_representative(text, text) is
'The one row that describes a source_key on Map 1, the ZIP page and the Rule D / project-page read: the stored daily pick (public.app_project_pick) when it still exists, otherwise the lowest-id row. docs/map1-representative-pick.sql'$c$;
  end if;
  select p.prosrc into src from pg_proc p where p.oid = to_regprocedure(rep_fn);
  if md5(src) <> rep_md5 then
    raise exception 'map1-representative-pick: public.app_project_representative fingerprints to %, expected %. Rolled back.', md5(src), rep_md5;
  end if;
  if not exists (select 1 from pg_proc p join pg_language l on l.oid = p.prolang
                  where p.oid = to_regprocedure(rep_fn) and l.lanname = 'sql'
                    and p.provolatile = 's' and not p.prosecdef and not p.proisstrict
                    and p.proretset and p.proconfig is null
                    and p.prorettype = 'public.app_projects'::regtype) then
    raise exception 'map1-representative-pick: public.app_project_representative is not an inlinable STABLE sql set-returning function. Rolled back.';
  end if;
  if has_function_privilege('public', to_regprocedure(rep_fn), 'execute')
     or (exists (select 1 from pg_roles where rolname = 'anon')
         and has_function_privilege('anon', to_regprocedure(rep_fn), 'execute'))
     or (exists (select 1 from pg_roles where rolname = 'authenticated')
         and has_function_privilege('authenticated', to_regprocedure(rep_fn), 'execute')) then
    raise exception 'map1-representative-pick: anon or authenticated can execute public.app_project_representative. Rolled back.';
  end if;

  -- 3. The two site readers, each spliced from its live definition.
  for f in
    select * from (values
      (1, mk_fn, mk_pre, mk_post),
      (2, az_fn, az_pre, az_post)) v(n, fn, pre_md5, post_md5)
    order by n
  loop
    select p.prosrc into src from pg_proc p where p.oid = f.fn;
    if md5(src) = f.post_md5 then
      raise notice 'map1-representative-pick: % already applied (body md5 %), left alone', f.fn, f.post_md5;
      continue;
    end if;
    if md5(src) <> f.pre_md5 then
      raise exception 'map1-representative-pick: the live body of % drifted (md5 %, expected %). Not applied.',
        f.fn, md5(src), f.pre_md5;
    end if;

    select concat_ws(' | ', p.proowner::regrole::text, coalesce(p.proacl::text, '(default)'),
                     array_to_string(p.proconfig, ','), p.prosecdef::text, p.provolatile::text,
                     p.proparallel::text, p.prorettype::regtype::text, pg_get_function_arguments(p.oid))
      into attrs_before from pg_proc p where p.oid = f.fn;

    newdef := pg_get_functiondef(f.fn);
    for r in
      select * from (values
        (1, 1, $n$  -- One project per (ZIP, source_key) membership; the descriptive row is the lowest stable id.$n$,
               $r$  -- One project per (ZIP, source_key) membership. The descriptive row is the source_key's
  -- newest record, looked up by public.app_project_representative from the stored daily pick,
  -- the one rule Map 1, the ZIP page and the Rule D read share (docs/map1-representative-pick.sql).$r$),
        (1, 2, $n$        from public.app_projects p
       where p.source_key = mm.source_key
         and p.record_kind = p_kind
       order by p.id asc
       limit 1) a on true$n$,
               $r$        from public.app_project_representative(mm.source_key, p_kind) p) a on true$r$),
        (2, 1, $n$    left join lateral (
      select p.* from public.app_projects p
       where p.source_key = m.source_key and p.record_kind = 'development'
       order by p.id asc limit 1) a on true$n$,
               $r$    -- The descriptive row is the source_key's newest record, looked up by
    -- public.app_project_representative from the stored daily pick, the one rule Map 1, the ZIP
    -- page and the Rule D read share (docs/map1-representative-pick.sql).
    left join lateral public.app_project_representative(m.source_key, 'development') a on true$r$))
        v(fn_n, n, needle, repl)
      where v.fn_n = f.n
      order by n
    loop
      got := (length(newdef) - length(replace(newdef, r.needle, ''))) / length(r.needle);
      if got <> 1 then
        raise exception 'map1-representative-pick: % anchor % appears % time(s), expected 1. Not applied.',
          f.fn, r.n, got;
      end if;
      newdef := replace(newdef, r.needle, r.repl);
      got := (length(newdef) - length(replace(newdef, r.repl, ''))) / length(r.repl);
      if got <> 1 then
        raise exception 'map1-representative-pick: % replacement % landed % time(s), expected 1. Not applied.',
          f.fn, r.n, got;
      end if;
    end loop;

    execute newdef;

    select p.prosrc into src from pg_proc p where p.oid = f.fn;
    if md5(src) <> f.post_md5 then
      raise exception 'map1-representative-pick: the new body of % fingerprints to %, expected %. Rolled back.',
        f.fn, md5(src), f.post_md5;
    end if;
    if position('order by p.id asc' in src) > 0
       or (length(src) - length(replace(src, 'public.app_project_representative(', '')))
          / length('public.app_project_representative(') <> 1 then
      raise exception 'map1-representative-pick: % does not read through the shared lookup exactly once. Rolled back.', f.fn;
    end if;

    select concat_ws(' | ', p.proowner::regrole::text, coalesce(p.proacl::text, '(default)'),
                     array_to_string(p.proconfig, ','), p.prosecdef::text, p.provolatile::text,
                     p.proparallel::text, p.prorettype::regtype::text, pg_get_function_arguments(p.oid))
      into attrs_after from pg_proc p where p.oid = f.fn;
    if attrs_after is distinct from attrs_before then
      raise exception 'map1-representative-pick: attributes of % changed (% -> %). Rolled back.',
        f.fn, attrs_before, attrs_after;
    end if;

    raise notice 'map1-representative-pick: % applied (body md5 % -> %)', f.fn, f.pre_md5, f.post_md5;
  end loop;
end
$rep$;

-- ========================== PART C: the daily refresh (run ALONE) ==========================
do $pc$
begin
  if to_regnamespace('cron') is null then
    raise exception 'map1-representative-pick: pg_cron is not installed. Not scheduled.';
  end if;
  if exists (select 1 from cron.job where jobname = 'app-project-pick-refresh') then
    if (select schedule || ' ' || command from cron.job where jobname = 'app-project-pick-refresh')
       <> '50 4 * * * select public.app_project_pick_refresh()' then
      raise exception 'map1-representative-pick: cron job app-project-pick-refresh exists with another schedule or command. Not changed.';
    end if;
    raise notice 'map1-representative-pick: cron job app-project-pick-refresh already scheduled, left alone';
  else
    perform cron.schedule('app-project-pick-refresh', '50 4 * * *', 'select public.app_project_pick_refresh()');
    raise notice 'map1-representative-pick: cron job app-project-pick-refresh scheduled daily at 04:50 UTC';
  end if;
end
$pc$;
