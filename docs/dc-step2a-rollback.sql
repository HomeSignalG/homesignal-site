-- STEP 2A ROLLBACK — explicit, ordered, and NEVER `drop ... cascade`.
--
-- ⛔ CASCADE IS THE WRONG CONTRACT HERE AND THAT IS THE POINT. `drop table ... cascade` silently
-- removes whatever else happens to depend on the table, which is precisely the situation a
-- rollback must REFUSE: if something outside Step 2A has come to depend on this schema, the
-- correct outcome is a loud stop, not a wider deletion. Every drop below is unqualified, so
-- Postgres itself refuses on an unexpected dependent -- and step 0 names the dependent first,
-- because a bare "cannot drop ... because other objects depend on it" does not say which.
--
-- ⚠️ THIS DELETES EVIDENCE. Any acquisition runs and observations present are destroyed. Step 2A
-- ships with zero producers, so the expected state at rollback time is 0 runs / 0 observations,
-- and step 0 REPORTS the counts rather than assuming them.

-- TRANSACTION: this file carries NO explicit begin/commit, matching every applied SQL file
-- in this repo. Postgres runs a multi-statement string as ONE implicit transaction under the
-- simple query protocol, and `apply_migration` owns the transaction itself; a nested `begin`
-- would warn and a mid-file `commit` would end the tool's transaction early -- which this
-- file did, leaving the selftest section outside it. Apply the whole file as one batch.

-- ---------------------------------------------------------------------------------------------
-- 0. FAIL CLOSED on anything outside Step 2A that depends on these objects.
-- ---------------------------------------------------------------------------------------------
do $$
declare
  ours constant text[] := array[
    'dc_source','dc_acquisition_run','dc_source_observation',
    'dc_source_contract_stamp','dc_acquisition_run_guard','dc_source_observation_guard',
    'dc_mark_run_advanced','dc_step2a_expect_fail','dc_step2a_expect_ok','dc_step2a_selftest',
    -- Step 2B-1A. Listed here or the dependency check treats our OWN objects as somebody
    -- else's and refuses a rollback that is in fact clean.
    'dc_evidence_commit_guard','dc_complete_acquisition'];
  bad text;
  n_runs bigint; n_obs bigint; n_adv bigint;
begin
  -- (a) a FOREIGN KEY from any table that is not one of ours
  select string_agg(format('FK %I.%I -> %s', ns.nspname, c.relname, t.relname), ', ')
    into bad
    from pg_constraint k
    join pg_class c  on c.oid = k.conrelid
    join pg_namespace ns on ns.oid = c.relnamespace
    join pg_class t  on t.oid = k.confrelid
   where k.contype = 'f'
     and t.relname = any (ours)
     and not (c.relname = any (ours));
  if bad is not null then
    raise exception 'STEP 2A ROLLBACK REFUSED -- external foreign key(s) depend on it: %', bad;
  end if;

  -- (b) a VIEW or MATERIALIZED VIEW built on any of the three tables
  select string_agg(format('%s %I.%I', c.relkind, ns.nspname, c.relname), ', ')
    into bad
    from pg_depend d
    join pg_rewrite r  on r.oid = d.objid
    join pg_class   c  on c.oid = r.ev_class
    join pg_namespace ns on ns.oid = c.relnamespace
    join pg_class   t  on t.oid = d.refobjid
   where d.classid = 'pg_rewrite'::regclass
     and d.refclassid = 'pg_class'::regclass
     and t.relname = any (ours)
     and c.relkind in ('v','m')
     and c.relname <> t.relname;
  if bad is not null then
    raise exception 'STEP 2A ROLLBACK REFUSED -- view(s) depend on it: %', bad;
  end if;

  -- (c) any OTHER function whose body names one of these objects. A body reference is not a
  --     catalog dependency, so nothing would refuse the drop -- it would simply break at runtime.
  select string_agg(format('%I.%I', ns.nspname, p.proname), ', ') into bad
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname not in ('pg_catalog','information_schema')
     and not (p.proname = any (ours))
     and p.prosrc ~ '\mdc_(source|acquisition_run|source_observation)\M';
  if bad is not null then
    raise exception 'STEP 2A ROLLBACK REFUSED -- function body/bodies reference it: %', bad;
  end if;

  -- (d) report what is being destroyed; an unexpected non-zero is a reason to stop and look.
  -- ⛔ STEP 2B-1A: REFUSE RATHER THAN DESTROY. Dropping dc_complete_acquisition and the
  -- commit guard removes the only path that can produce an evidence-bearing SUCCESS_COMPLETE
  -- and the only thing enforcing that one is honest. If ADVANCED COMPLETE runs already exist,
  -- rolling back leaves their evidence standing with nothing defending its meaning -- which is
  -- worse than either keeping the contract or removing it wholesale. Step 2A's own expectation
  -- at rollback time is 0 runs / 0 observations, so this raises only where that is untrue.
  select count(*) into n_adv from public.dc_acquisition_run
   where completeness_state = 'SUCCESS_COMPLETE' and advanced_observations;
  if n_adv > 0 then
    raise exception
      'REFUSING ROLLBACK: % ADVANCED COMPLETE acquisition run(s) hold committed evidence. '
      'Rolling back would drop the contract that makes SUCCESS_COMPLETE mean "evidence is '
      'present" while leaving the rows behind. Decide deliberately what happens to that '
      'evidence first; this file will not decide it for you.', n_adv;
  end if;

  select count(*) into n_runs from public.dc_acquisition_run;
  select count(*) into n_obs  from public.dc_source_observation;
  raise notice 'STEP 2A ROLLBACK: destroying % acquisition run(s) and % observation(s)', n_runs, n_obs;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- 1. Triggers (named individually -- dropping the table would take them, but an explicit list is
--    what makes an unexpected EXTRA trigger visible rather than silently swept away).
-- ---------------------------------------------------------------------------------------------
drop trigger if exists dc_source_contract_stamp_trg        on public.dc_source;
drop trigger if exists dc_acquisition_run_guard_trg        on public.dc_acquisition_run;
drop trigger if exists dc_acquisition_run_truncate_trg     on public.dc_acquisition_run;
drop trigger if exists dc_source_observation_guard_trg     on public.dc_source_observation;
drop trigger if exists dc_source_observation_truncate_trg  on public.dc_source_observation;
drop trigger if exists dc_mark_run_advanced_trg            on public.dc_source_observation;

-- ---------------------------------------------------------------------------------------------
-- 2. Tables, child first. No CASCADE: an unexpected dependent stops the rollback.
-- ---------------------------------------------------------------------------------------------
drop table if exists public.dc_source_observation;
drop table if exists public.dc_acquisition_run;
drop table if exists public.dc_source;

-- ---------------------------------------------------------------------------------------------
-- 3. Functions. No CASCADE.
-- ---------------------------------------------------------------------------------------------
drop function if exists public.dc_step2a_selftest();
drop function if exists public.dc_step2a_expect_ok(text);
drop function if exists public.dc_step2a_expect_fail(text,text);
drop function if exists public.dc_mark_run_advanced();
-- Step 2B-1A. The constraint trigger goes with its table below; the two functions are named
-- explicitly here so an unexpected dependent makes Postgres refuse, rather than a CASCADE
-- deciding on our behalf.
drop function if exists public.dc_complete_acquisition(uuid,integer,text,text,integer,integer,
  jsonb,integer,bigint,text,text,jsonb,text,text,timestamptz,timestamptz);
drop function if exists public.dc_evidence_commit_guard();
drop function if exists public.dc_source_observation_guard();
drop function if exists public.dc_acquisition_run_guard();
drop function if exists public.dc_source_contract_stamp();

-- ---------------------------------------------------------------------------------------------
-- 4. Prove the rollback is complete rather than assuming it.
-- ---------------------------------------------------------------------------------------------
do $$
declare n integer;
begin
  select count(*) into n from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
   where ns.nspname = 'public'
     and c.relname in ('dc_source','dc_acquisition_run','dc_source_observation');
  if n <> 0 then raise exception 'STEP 2A ROLLBACK INCOMPLETE: % table(s) remain', n; end if;
  select count(*) into n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public'
     and p.proname in ('dc_source_contract_stamp','dc_acquisition_run_guard',
                       'dc_source_observation_guard','dc_mark_run_advanced',
                       'dc_step2a_expect_fail','dc_step2a_expect_ok','dc_step2a_selftest');
  if n <> 0 then raise exception 'STEP 2A ROLLBACK INCOMPLETE: % function(s) remain', n; end if;
  raise notice 'STEP 2A ROLLBACK COMPLETE: 0 tables, 0 functions remain';
end
$$;
