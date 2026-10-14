-- ============================================================================
-- DEVELOPMENT CHANGE LEDGER -- TIME-BOUNDED SOURCE BASELINE   (SQL OF RECORD; drift-guarded splice)
--
-- THE PROBLEM (City of Denton, 2026-10-14)
--   Seven new registry sources (denton-city-projects-*, merged 21e5ce1a, live in get-address-report v271 since
--   2026-10-14 18:04Z) will, as the development refresh reaches each of the 32 Denton ZIPs, put HISTORICAL records into
--   app_projects for ZIPs the ledger already baselined. The next ordinary dev-change-observe tick sees an identity it has
--   never seen and writes `first_detected`, material = true -> every reader of dev_change_event_reportable (the report,
--   Follow, property watches, buyer alerts) would say "New official record" for years-old filings.
--   docs/dev-change-recovery.sql does NOT cover this: it only classifies records stamped scope_origin = 'polygon_member'
--   (a widened ZIP scope). A new SOURCE on an unchanged ZIP is unstamped, so it is announced as news.
--
-- WHY NOT A BASELINE RUN
--   A baseline run can only mark records the observer SEES, i.e. rows already in app_projects, and it baselines EVERY new
--   identity on the ZIP that night (all sources). The Denton rows arrive over a ~53 h refresh sweep, ZIP by ZIP, so a
--   one-shot baseline would miss every ZIP refreshed afterwards and would silence other sources' genuine arrivals.
--
-- WHAT THIS DOES (additive; one table, one function, one 2-line splice of the ONE writer)
--   public.dev_change_source_baseline  (registry_id, baseline_until, closed_at, reason): an ALLOWLIST of source families whose
--     FIRST sighting by the ledger is not news, until baseline_until (or closed_at). State, not history.
--   public.dev_change_source_baseline_active(registry_id, identity_key): true iff the identity belongs to an allowlisted,
--     open, unexpired source family. Identity = the source's own record key 'arcgis:<registry_id>:<record>' (the same
--     identity app_source_key derives); app_projects.registry_id equals its second segment (measured 14,436 of 14,436
--     phoenix-building-permits ledger identities).
--   dev_change_observe_zip: the `first_detected` insert becomes is_baseline = true / material = false when the identity is
--     in the allowlist, in an ORDINARY run, exactly as a baseline run or a coverage-recovery classification already does.
--     For every identity of every other source the function evaluates to the same value as before (the new term is false).
--   It never baselines by ZIP, never names a person, never touches an existing identity, never deletes an event. A real
--     CHANGE to an already-known Denton record (status/stage) after its first sighting is still an ordinary material event.
--   Cost, stated: a genuinely NEW Denton filing first seen by HomeSignal inside the window is recorded silently (is_baseline)
--     rather than announced. Close the window early (closed_at) once every Denton ZIP has been observed.
--
-- HOW IT IS APPLIED: splice of the LIVE pg_get_functiondef, refuses unless the live observe_zip fingerprints to the body this
-- was written against, proves the splice by excising the inserted text and recovering that md5, idempotent. ROLLBACK at foot.
-- ============================================================================

-- ---- 0. PRECONDITIONS (fail closed) ------------------------------------------------------------------------------
do $pre$
declare _o text; _done boolean; _v text;
begin
  if to_regprocedure('public.dev_change_observe_zip(text, uuid)') is null
     or to_regclass('public.dev_change_recovery') is null or to_regclass('public.dev_change_event_reportable') is null then
    raise exception 'dev_change_source_baseline: the ledger, its recovery protection or the reportable view is missing';
  end if;
  select prosrc into _o from pg_proc where oid = 'public.dev_change_observe_zip(text, uuid)'::regprocedure;
  _done := position('-- dev_change_source_baseline:' in _o) > 0;
  if not _done and md5(_o) <> '2f70e4c786ae301d0efe9cdeb333f46d' then
    raise exception 'dev_change_source_baseline: live dev_change_observe_zip is % -- written against 2f70e4c7...; re-review before applying', md5(_o);
  end if;
  -- the reader rule that makes is_baseline events invisible must be live, or this protects nothing
  _v := pg_get_viewdef('public.dev_change_event_reportable'::regclass);
  if position('is_baseline' in substring(_v from position('WHERE' in _v))) = 0 then
    raise exception 'dev_change_source_baseline: dev_change_event_reportable does not exclude is_baseline -- refusing';
  end if;
end $pre$;

-- ---- 1. THE ALLOWLIST ---------------------------------------------------------------------------------------------
create table if not exists public.dev_change_source_baseline (
  registry_id    text primary key,
  baseline_until timestamptz not null,
  closed_at      timestamptz,
  reason         text not null,
  created_at     timestamptz not null default now()
);
alter table public.dev_change_source_baseline enable row level security;
revoke all on public.dev_change_source_baseline from public, anon, authenticated, service_role;
grant select, insert, update on public.dev_change_source_baseline to service_role;

create or replace function public.dev_change_source_baseline_active(p_registry_id text, p_identity_key text)
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.dev_change_source_baseline b
     where b.closed_at is null and now() < b.baseline_until
       and b.registry_id in (coalesce(p_registry_id, ''), coalesce(split_part(p_identity_key, ':', 2), '')))
$$;
revoke all on function public.dev_change_source_baseline_active(text, text) from public, anon, authenticated;
grant execute on function public.dev_change_source_baseline_active(text, text) to service_role;

-- ---- 2. THE SEVEN DENTON FAMILIES (fingerprinted against the registry file, never trusted) ------------------------------
-- ids: supabase/functions/get-address-report/jurisdiction-registry.json, registry_id like 'denton-city-projects-%'.
-- md5(string_agg(id, ',' order by id collate "C")) over them = 40ee6c7656c91446829f639845737880 (7 ids, computed from the file).
insert into public.dev_change_source_baseline (registry_id, baseline_until, reason)
select v.id, timestamptz '2026-10-20 00:00:00+00',
       'City of Denton Planning/Projects MapServer: historical records enter app_projects on an already-baselined ZIP (v271, 2026-10-14)'
  from (values ('denton-city-projects-annexation'), ('denton-city-projects-decided'), ('denton-city-projects-planned-development'),
               ('denton-city-projects-site-plan'), ('denton-city-projects-specific-use'), ('denton-city-projects-subdivision'),
               ('denton-city-projects-zoning')) v(id)
on conflict (registry_id) do nothing;

do $fp$
declare _fp text; _n int;
begin
  select md5(string_agg(registry_id, ',' order by registry_id collate "C")), count(*) into _fp, _n
    from public.dev_change_source_baseline where registry_id like 'denton-city-projects-%';
  if _n <> 7 or _fp <> '40ee6c7656c91446829f639845737880' then
    raise exception 'dev_change_source_baseline: Denton allowlist fingerprint % (n=%) does not match the registry file (7, 40ee6c76...)', _fp, _n;
  end if;
end $fp$;

-- ---- 3. SPLICE THE LIVE WRITER -------------------------------------------------------------------------------------------
do $splice$
declare
  _oid oid := 'public.dev_change_observe_zip(text, uuid)'::regprocedure;
  _def text; _new text; _a text; _b text; _n int; _back text;
begin
  if position('-- dev_change_source_baseline:' in (select prosrc from pg_proc where oid = _oid)) > 0 then
    return;                                     -- already spliced
  end if;
  _a := E'         not (_baseline or rc.identity_key is not null),\n         (_baseline or rc.identity_key is not null),\n';
  _b := E'         -- dev_change_source_baseline: an allowlisted source family''s FIRST sighting is not news (open, unexpired window only)\n'
     || E'         not (_baseline or rc.identity_key is not null or public.dev_change_source_baseline_active(o.registry_id, o.identity_key)),\n'
     || E'         (_baseline or rc.identity_key is not null or public.dev_change_source_baseline_active(o.registry_id, o.identity_key)),\n';
  _def := pg_get_functiondef(_oid);
  _n := (length(_def) - length(replace(_def, _a, ''))) / length(_a);
  if _n <> 1 then raise exception 'dev_change_source_baseline: anchor appears % times (need exactly 1)', _n; end if;
  _new := replace(_def, _a, _b);
  execute _new;
  select prosrc into _back from pg_proc where oid = _oid;
  if position('-- dev_change_source_baseline:' in _back) = 0 then raise exception 'dev_change_source_baseline: splice did not take'; end if;
  _back := replace(_back, _b, _a);
  if md5(_back) <> '2f70e4c786ae301d0efe9cdeb333f46d' then
    raise exception 'dev_change_source_baseline: splice is not a pure insertion (got %)', md5(_back);
  end if;
end $splice$;

-- ---- 4. LOCK-DOWN -------------------------------------------------------------------------------------------------------
do $lock$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = 'dev_change_source_baseline_active' loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
  if has_function_privilege('anon', 'public.dev_change_source_baseline_active(text, text)', 'execute')
     or has_function_privilege('authenticated', 'public.dev_change_source_baseline_active(text, text)', 'execute')
     or has_table_privilege('anon', 'public.dev_change_source_baseline', 'select')
     or has_table_privilege('authenticated', 'public.dev_change_source_baseline', 'select') then
    raise exception 'dev_change_source_baseline: a new object is reachable by anon/authenticated';
  end if;
end $lock$;

-- CLOSE EARLY (after every Denton ZIP has been observed and verified):
--   update public.dev_change_source_baseline set closed_at = now() where registry_id like 'denton-city-projects-%' and closed_at is null;
-- EXTEND (only if verification shows ZIPs not yet observed): update ... set baseline_until = <later> where ...;
-- ROLLBACK (restores the exact live body by excising the inserted text; ledger rows already written stay -- the ledger never deletes):
--   do $rb$ declare _o oid := 'public.dev_change_observe_zip(text, uuid)'::regprocedure; _d text := pg_get_functiondef(_o);
--   begin execute replace(_d,
--     E'         -- dev_change_source_baseline: an allowlisted source family''s FIRST sighting is not news (open, unexpired window only)\n'
--     || E'         not (_baseline or rc.identity_key is not null or public.dev_change_source_baseline_active(o.registry_id, o.identity_key)),\n'
--     || E'         (_baseline or rc.identity_key is not null or public.dev_change_source_baseline_active(o.registry_id, o.identity_key)),\n',
--     E'         not (_baseline or rc.identity_key is not null),\n         (_baseline or rc.identity_key is not null),\n'); end $rb$;
--   -- then: drop function public.dev_change_source_baseline_active(text, text); drop table public.dev_change_source_baseline;
--   -- and confirm md5(prosrc) = 2f70e4c786ae301d0efe9cdeb333f46d
