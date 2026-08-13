-- ============================================================================
-- CANONICAL ZIP REGISTRY + CREATION GUARD — DDL of record
-- Applied 2026-08-13 as migrations:
--   registry_drift_audit_and_remove_zip_80249
--   canonical_zip_registry_and_creation_guard
--   canonical_zip_guard_selftest  (+ _detail_fix)
--
-- WHY THIS EXISTS
-- ---------------
-- The approved Gold Master registry (homesignal-ingest,
-- data/local_news_gold_master/LocalNews_HomeSignal_Source_Registry_Updated.xlsx)
-- is the SOURCE OF TRUTH for which ZIP pages exist: 12,722 ZIPs, md5 of the sorted
-- comma-joined set = af48c60436e525ae94dc87654b272c81. Production must never create
-- or expand the ZIP universe independently. A row appearing in the DB is not evidence
-- that the page should exist.
--
-- On 2026-08-11 13:39:57 a 12,723rd ZIP page appeared — Denver (80249), CO. Root cause,
-- traced to the statement: migration 20260811133957 `evidence_phase6_evidence_only_zip_routing`
-- carried a HARDCODED single-ZIP insert into public.communities to make one Denver parcel
-- routable. It never consulted the Gold Master. state='Colorado' (every other row uses the
-- two-letter code) kept it failing the CO coverage gates, so it sat inert for two days; on
-- 2026-08-13 17:50:41 `fix_denver_80249_state_code` normalised it to 'CO' on the assumption
-- it was one of the legitimate 12,722, after which the materializer published it
-- (indexable=true, 17:51:51) and the maps cache filled it (239 sites, 17:51:19).
--
-- THE GUARD IS IN THE DATABASE ON PURPOSE. The drift arrived through a MIGRATION, so a guard
-- in site JS, an edge function, or a seed script could never have caught it. The only choke
-- point that sees migrations, seed scripts, RPCs, the REST API and manual SQL alike is the
-- database itself.
--
-- ROUTABILITY, NOT JUST PAGES. community.html?zip= resolves via zip_codes @> [zip], so a ZIP
-- sitting in ANY row's zip_codes array is routable even with no level='zip' row. The guard
-- therefore covers every level, not only level='zip'. Measured before applying: the union of
-- zip_codes across all rows is exactly 12,722 / af48c604… — 0 existing rows violate it, so
-- the guard went on VALIDATED.
-- ============================================================================

-- ── 1. Evidence. Append-only receipts for rows removed as drift. ────────────
create table if not exists public.registry_drift_audit (
  id           bigint generated always as identity primary key,
  zip          text        not null,
  surface      text        not null,          -- which table the row was removed from
  row_snapshot jsonb       not null,          -- the complete row as it existed
  reason       text        not null,
  root_cause   text        not null,
  removed_at   timestamptz not null default now()
);

alter table public.registry_drift_audit enable row level security;
-- No policies: RLS on with zero policies denies anon/authenticated outright. Evidence is
-- operator-only. Service-role bypasses RLS for reads.

-- ── 2. The canonical set. ───────────────────────────────────────────────────
create table if not exists public.canonical_zip_registry (
  zip                 text primary key,
  gold_master_version text not null,
  workbook_sha256     text not null,
  loaded_at           timestamptz not null default now()
);

alter table public.canonical_zip_registry enable row level security;
create policy canonical_zip_registry_read on public.canonical_zip_registry for select using (true);
-- SELECT only. No insert/update/delete policy, so anon and authenticated cannot widen the
-- registry through the REST API; changing it requires service-role or a migration.

-- Seeded from live data, but the GOLD MASTER FINGERPRINT is the authority: if production does
-- not already equal the approved set exactly, the seed ABORTS rather than canonising drift.
do $$
declare _md5 text; _n int;
begin
  select md5(string_agg(z, ',' order by z)), count(*) into _md5, _n
    from (select distinct unnest(zip_codes) z from public.communities) s;
  if _md5 <> 'af48c60436e525ae94dc87654b272c81' or _n <> 12722 then
    raise exception 'refusing to seed: live ZIP set is % rows md5 %, expected 12722 / af48c60436e525ae94dc87654b272c81', _n, _md5;
  end if;
  insert into public.canonical_zip_registry (zip, gold_master_version, workbook_sha256)
  select distinct unnest(zip_codes), '2.4',
         'd982fb287ff169fc911774ae6a0d0410ce9c97eadb2b73807d559c8a04b9b3f3'
    from public.communities
  on conflict (zip) do nothing;
end $$;

-- ── 3. The guard. FAILS CLOSED. ─────────────────────────────────────────────
-- An empty or missing registry rejects EVERY ZIP rather than allowing every ZIP — the same
-- posture as the ingest repo's gold_master_allowlist. "HOLD, do not silently create."
create or replace function public.enforce_canonical_zip()
returns trigger language plpgsql as $fn$
declare _bad text[];
begin
  if not exists (select 1 from public.canonical_zip_registry) then
    raise exception using
      errcode = 'check_violation',
      message = 'canonical_zip_registry is empty — refusing to create any ZIP (fail closed)',
      hint    = 'Seed the registry from the approved Gold Master workbook before creating ZIP rows.';
  end if;

  if TG_TABLE_NAME = 'communities' then
    select array_agg(z) into _bad
      from unnest(coalesce(NEW.zip_codes, array[]::text[])) z
     where not exists (select 1 from public.canonical_zip_registry r where r.zip = z);
  else
    select array_agg(NEW.zip) into _bad
     where not exists (select 1 from public.canonical_zip_registry r where r.zip = NEW.zip);
  end if;

  if _bad is not null and array_length(_bad, 1) > 0 then
    raise exception using
      errcode = 'check_violation',
      message = format('ZIP %s is not in the approved Gold Master registry — refusing to create it in %s',
                       array_to_string(_bad, ', '), TG_TABLE_NAME),
      hint    = 'The Gold Master registry is the source of truth for which ZIP pages exist. '
             || 'Production must not expand the ZIP universe. Add the ZIP to the approved '
             || 'workbook in homesignal-ingest first, then reseed canonical_zip_registry.';
  end if;
  return NEW;
end $fn$;

-- `UPDATE OF <col>` narrows each trigger to statements that actually touch the ZIP column, so
-- routine app_refresh_zip upserts do not pay for a check on unrelated column writes.
drop trigger if exists trg_communities_canonical_zip on public.communities;
create trigger trg_communities_canonical_zip
  before insert or update of zip_codes on public.communities
  for each row execute function public.enforce_canonical_zip();

drop trigger if exists trg_app_community_meta_canonical_zip on public.app_community_meta;
create trigger trg_app_community_meta_canonical_zip
  before insert or update of zip on public.app_community_meta
  for each row execute function public.enforce_canonical_zip();

drop trigger if exists trg_development_reports_canonical_zip on public.development_reports;
create trigger trg_development_reports_canonical_zip
  before insert or update of zip on public.development_reports
  for each row execute function public.enforce_canonical_zip();

-- ── 4. The regression test, living next to the thing it tests. ──────────────
-- NOTHING PERSISTS: each case runs in a subtransaction that is ALWAYS aborted — on the
-- expected path the guard raises; otherwise a deliberate ROLLBACK_MARKER raise aborts it.
-- A subtransaction that merely "succeeded" would commit with the caller, which is exactly
-- the failure a test like this must not have.
create or replace function public.canonical_zip_guard_selftest()
returns table (case_name text, expected text, blocked boolean, passed boolean, detail text)
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare _parent uuid; _msg text; _blocked boolean; _detail text;
begin
  select id into _parent from public.communities where level='county' limit 1;

  for case_name, expected in
    select * from (values ('communities','REJECT'),
                          ('app_community_meta','REJECT'),
                          ('development_reports','REJECT')) v(a,b)
  loop
    _blocked := false; _detail := null;
    begin
      if case_name = 'communities' then
        insert into public.communities (name,county,state,zip_codes,level,government_topics,slug,parent_id)
        values ('SELFTEST 80249','Denver','CO',array['80249'],'zip',array[]::text[],
                'selftest-80249-'||gen_random_uuid()::text,_parent);
      elsif case_name = 'app_community_meta' then
        insert into public.app_community_meta (zip, community_id, name, county, state)
        values ('80249', _parent, 'SELFTEST 80249','Denver','CO');
      else
        insert into public.development_reports (zip, home_lat, home_lng, counts, sites)
        values ('80249', 0, 0, '{}'::jsonb, '[]'::jsonb);
      end if;
      raise exception 'ROLLBACK_MARKER';
    exception
      when check_violation then
        get stacked diagnostics _msg = message_text;
        _blocked := true; _detail := _msg;
      when others then
        if sqlerrm <> 'ROLLBACK_MARKER' then
          get stacked diagnostics _msg = message_text;
          _detail := 'unexpected: ' || _msg;
        else
          _detail := 'insert succeeded — guard did not fire';
        end if;
    end;
    blocked := _blocked; passed := _blocked; detail := _detail;
    return next;
  end loop;

  -- POSITIVE CONTROL. Without this, a guard that rejected EVERYTHING would score 3/3 above
  -- and read as healthy.
  case_name := 'in-registry ZIP passes guard'; expected := 'ALLOW';
  _blocked := false; _detail := null;
  begin
    insert into public.development_reports (zip, home_lat, home_lng, counts, sites)
    values ((select zip from public.canonical_zip_registry order by zip limit 1),
            0, 0, '{}'::jsonb, '[]'::jsonb);
    raise exception 'ROLLBACK_MARKER';
  exception
    when check_violation then
      get stacked diagnostics _msg = message_text;
      _blocked := true; _detail := 'guard wrongly rejected an in-registry ZIP: ' || _msg;
    when unique_violation then
      _detail := 'reached uniqueness — guard passed it through';
    when others then
      if sqlerrm <> 'ROLLBACK_MARKER' then
        get stacked diagnostics _msg = message_text; _detail := 'unexpected: ' || _msg;
      else _detail := 'insert accepted — guard passed it through'; end if;
  end;
  blocked := _blocked; passed := not _blocked; detail := _detail;
  return next;

  case_name := 'registry is populated'; expected := '12722';
  _detail := (select count(*)::text || ' ZIPs in canonical_zip_registry'
                from public.canonical_zip_registry);
  blocked := false;
  passed := ((select count(*) from public.canonical_zip_registry) = 12722);
  detail := _detail;
  return next;
end $fn$;

revoke all on function public.canonical_zip_guard_selftest() from public;
grant execute on function public.canonical_zip_guard_selftest() to anon, authenticated;
