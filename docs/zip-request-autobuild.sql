-- ============================================================================
-- TAB 14 AREA REQUESTS BUILD THEIR ZIP PAGE AUTOMATICALLY (founder, 2026-11-11:
-- "make this also automatic code build. if we receive a request on a tab 14. you automatically
-- build it and notify me by email"). Email goes to hello@homesignal.net through the notify-health
-- Edge Function (Resend). Hard cases are emailed and NOT built (founder choice the same day).
--
-- The chain:
--   1. A row lands in public.community_requests (the coverage modal, homepage, Tab 14's source).
--   2. Trigger zip_request_enqueue: a five-digit ZIP not in canonical_zip_registry and not already
--      in public.zip_request_builds gets one 'queued' row and a dispatch of homesignal-ingest
--      zip-request-build.yml (ref main). The workflow also runs hourly and claims anything queued,
--      so a lost dispatch is picked up within the hour.
--   3. The workflow decides (homesignal-ingest scripts/zip_request_plan.py), adds the row to the
--      Gold Master workbook, checks it in a job that holds no secret, lands it on main, and only
--      then calls zip_request_apply here. The workbook stays the source of truth and changes first.
--   4. zip_request_apply adds the registry row, the county root if new, the ZIP page, and moves
--      canonical_zip_guard_selftest's expected count. zip_request_store_report saves the page's
--      development report and materializes it. zip_request_finish records the outcome and emails.
--
-- Every function is SECURITY DEFINER and executable by service_role only. public.zip_request_builds
-- has RLS on and no visitor grant; it is the audit record of every ZIP added this way
-- (scripts/verify-zip-universe.mjs counts it).
-- ============================================================================

create table if not exists public.zip_request_builds (
  zip            text primary key check (zip ~ '^[0-9]{5}$'),
  status         text not null default 'queued'
                 check (status in ('queued','building','built','refused','failed')),
  code           text,
  reason         text,
  plan           jsonb,
  request_id     uuid,
  requested_at   timestamptz,
  attempts       int not null default 0,
  dispatch_request_id bigint,
  workbook_sha256 text,
  run_url        text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  finished_at    timestamptz,
  notified_at    timestamptz
);
alter table public.zip_request_builds enable row level security;
revoke all on public.zip_request_builds from public, anon, authenticated;
grant all on public.zip_request_builds to service_role;

-- 97149 was built by hand on 2026-11-11 before this existed; it is recorded so the audit is complete.
insert into public.zip_request_builds (zip, status, code, reason, request_id, requested_at, workbook_sha256, finished_at, notified_at)
select '97149', 'built', 'hand_built', 'Built by hand 2026-11-11 (homesignal-ingest #1088, homesignal-site #2799).',
       r.id, r.created_at, '47e3d8d65926af357c5947ccb38ba95489f94336e3f373299270ff1a6076f230', now(), now()
  from public.community_requests r
 where r.requested_zip = '97149'
   and exists (select 1 from public.canonical_zip_registry where zip = '97149')
 order by r.created_at limit 1
on conflict (zip) do nothing;

-- The one place the build is requested.
create or replace function public._zip_request_dispatch(p_zip text)
returns void language plpgsql security definer
set search_path to 'public', 'extensions', 'net', 'vault', 'pg_temp' as $$
declare _pat text; _req bigint;
begin
  select decrypted_secret into _pat from vault.decrypted_secrets where name = 'github_actions_pat';
  if _pat is null or btrim(_pat) = '' then
    update public.zip_request_builds set reason = 'no GitHub credential stored; the hourly run will pick it up',
           updated_at = now() where zip = p_zip;
    return;
  end if;
  select net.http_post(
    url := 'https://api.github.com/repos/HomeSignalG/homesignal-ingest/actions/workflows/zip-request-build.yml/dispatches',
    body := jsonb_build_object('ref', 'main', 'inputs', jsonb_build_object('zip', p_zip)),
    headers := jsonb_build_object('Authorization', 'Bearer ' || _pat, 'Accept', 'application/vnd.github+json',
              'X-GitHub-Api-Version', '2022-11-28', 'User-Agent', 'homesignal-zip-request', 'Content-Type', 'application/json'),
    timeout_milliseconds := 15000) into _req;
  update public.zip_request_builds set dispatch_request_id = _req, updated_at = now() where zip = p_zip;
end $$;
revoke all on function public._zip_request_dispatch(text) from public, anon, authenticated;

-- Never blocks a request: any failure here is a WARNING and the request is stored as before.
create or replace function public.tg_zip_request_enqueue()
returns trigger language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
begin
  begin
    if new.requested_zip ~ '^[0-9]{5}$'
       and not exists (select 1 from public.canonical_zip_registry where zip = new.requested_zip)
       and not exists (select 1 from public.zip_request_builds where zip = new.requested_zip) then
      insert into public.zip_request_builds (zip, request_id, requested_at)
      values (new.requested_zip, new.id, new.created_at)
      on conflict (zip) do nothing;
      perform public._zip_request_dispatch(new.requested_zip);
    end if;
  exception when others then
    raise warning 'zip_request_enqueue failed for %: %', new.requested_zip, sqlerrm;
  end;
  return null;
end $$;
revoke all on function public.tg_zip_request_enqueue() from public, anon, authenticated;
drop trigger if exists zip_request_enqueue on public.community_requests;
create trigger zip_request_enqueue after insert on public.community_requests
  for each row execute function public.tg_zip_request_enqueue();

-- Claim one ZIP to work on: the named one if it is queued (or failed fewer than 3 times), else the
-- oldest queued. A row 'building' for more than 2 hours is a run that died; it may be claimed again.
create or replace function public.zip_request_claim(p_zip text default null)
returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
declare r public.zip_request_builds;
begin
  select * into r from public.zip_request_builds b
   where (p_zip is null or b.zip = p_zip)
     and (b.status = 'queued'
          or (b.status = 'failed' and b.attempts < 3 and p_zip is not null)
          or (b.status = 'building' and b.updated_at < now() - interval '2 hours'))
   order by b.created_at
   limit 1 for update skip locked;
  if not found then return null; end if;
  update public.zip_request_builds set status = 'building', attempts = attempts + 1, updated_at = now(),
         code = null, reason = null
   where zip = r.zip;
  return jsonb_build_object('zip', r.zip, 'attempt', r.attempts + 1, 'requested_at', r.requested_at);
end $$;

-- Facts the plan needs from production. The county shares are computed here, from the Census
-- county polygons the runner fetched from TIGERweb (p_counties = the GeoJSON features), against
-- geo.zcta_boundary, so the land share is a PostGIS measurement, never an estimate.
create or replace function public.zip_request_facts(p_zip text, p_lat float8 default null, p_lng float8 default null,
                                                    p_counties jsonb default null, p_state text default null)
returns jsonb language plpgsql security definer set search_path to 'public', 'geo', 'extensions', 'pg_temp' as $$
declare z record; _shares jsonb; _roots jsonb; _inside boolean;
begin
  select geom, st_xmin(geom) x0, st_ymin(geom) y0, st_xmax(geom) x1, st_ymax(geom) y1,
         st_y(st_pointonsurface(geom)) plat, st_x(st_pointonsurface(geom)) plng, st_srid(geom) srid,
         st_area(geom::geography) a
    into z from geo.zcta_boundary where zcta5 = p_zip;
  if p_counties is not null and z.geom is not null then
    select coalesce(jsonb_agg(jsonb_build_object('name', n, 'geoid', g, 'share', round(s::numeric, 4)) order by s desc), '[]')
      into _shares
      from (select f->'properties'->>'NAME' n, f->'properties'->>'GEOID' g,
                   st_area(st_intersection(st_makevalid(st_setsrid(st_geomfromgeojson(f->>'geometry'), z.srid)), z.geom)::geography) / z.a s
              from jsonb_array_elements(p_counties->'features') f) q
     where s > 0.0001;
  end if;
  if p_lat is not null and z.geom is not null then
    _inside := st_contains(z.geom, st_setsrid(st_point(p_lng, p_lat), z.srid));
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'slug', slug, 'name', name, 'county', county, 'state', state)), '[]')
    into _roots from public.communities where level = 'county' and state = p_state;
  return jsonb_build_object(
    'zip', p_zip,
    'in_registry', exists (select 1 from public.canonical_zip_registry where zip = p_zip),
    'registry_n', (select count(*) from public.canonical_zip_registry),
    'has_zcta', z.geom is not null,
    'envelope', case when z.geom is null then null else jsonb_build_array(z.x0, z.y0, z.x1, z.y1) end,
    'point_on_surface', case when z.geom is null then null else jsonb_build_object('lat', z.plat, 'lng', z.plng) end,
    'usps_point_inside', _inside,
    'shares', _shares,
    'roots', _roots);
end $$;

-- Make production match the workbook for one ZIP. Refuses unless the registry is exactly one row
-- short of the workbook (p_workbook_rows) and the ZIP is the one this queue claimed.
create or replace function public.zip_request_apply(p_zip text, p_plan jsonb, p_workbook_sha text, p_workbook_rows int)
returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
declare
  _topics constant text[] := array['County Commission & county business',
    'Planning, zoning & development','Property taxes & assessments',
    'Public safety & emergencies','Water districts & utilities','Elections & voting'];
  m jsonb := p_plan->'manifest_zip'; rt jsonb := p_plan->'root';
  _n int; _root uuid; _src text; _old text; _new text;
begin
  if not exists (select 1 from public.zip_request_builds where zip = p_zip and status = 'building') then
    raise exception 'refusing: % is not being built by this queue', p_zip;
  end if;
  if m->>'zip' is distinct from p_zip or p_workbook_sha !~ '^[0-9a-f]{64}$' then
    raise exception 'refusing: the plan is not for % or the workbook hash is malformed', p_zip;
  end if;
  select count(*) into _n from public.canonical_zip_registry where zip <> p_zip;
  if _n <> p_workbook_rows - 1 then
    raise exception 'refusing: the registry outside % is % rows; the workbook has % rows', p_zip, _n, p_workbook_rows;
  end if;

  insert into public.canonical_zip_registry (zip, gold_master_version, workbook_sha256)
  select p_zip, (select gold_master_version from public.canonical_zip_registry order by loaded_at desc limit 1), p_workbook_sha
   where not exists (select 1 from public.canonical_zip_registry where zip = p_zip);

  if (rt->>'new')::boolean then
    insert into public.communities (name, county, state, zip_codes, level, government_topics, slug)
    select rt->>'name', rt->>'county', rt->>'state', array[p_zip], 'county', _topics, rt->>'slug'
     where not exists (select 1 from public.communities where slug = rt->>'slug');
    select id into strict _root from public.communities where slug = rt->>'slug' and level = 'county';
  else
    select id into strict _root from public.communities where id = (rt->>'id')::uuid and level = 'county';
  end if;
  update public.communities set zip_codes = zip_codes || array[p_zip]
   where id = _root and not (zip_codes @> array[p_zip]);

  insert into public.communities (name, county, state, zip_codes, level, parent_id, government_topics, slug)
  select m->>'name', m->>'county', m->>'state', array[p_zip], 'zip', _root, '{}'::text[], m->>'slug'
   where not exists (select 1 from public.communities where slug = m->>'slug');

  -- canonical_zip_guard_selftest's expected registry size moves with the registry
  select prosrc into _src from pg_proc where oid = 'public.canonical_zip_guard_selftest()'::regprocedure;
  _old := (p_workbook_rows - 1)::text; _new := p_workbook_rows::text;
  if position(format($q$expected := '%s';$q$, _old) in _src) > 0 then
    if position(format($q$canonical_zip_registry) = %s);$q$, _old) in _src) = 0 then
      raise exception 'refusing: canonical_zip_guard_selftest does not carry the expected anchors';
    end if;
    _src := replace(replace(_src, format($q$expected := '%s';$q$, _old), format($q$expected := '%s';$q$, _new)),
                    format($q$canonical_zip_registry) = %s);$q$, _old), format($q$canonical_zip_registry) = %s);$q$, _new));
    execute format('create or replace function public.canonical_zip_guard_selftest() returns table '
      || '(case_name text, expected text, blocked boolean, passed boolean, detail text) '
      || 'language plpgsql security definer set search_path = public, pg_temp as %L', _src);
  end if;

  if (select count(*) from public.canonical_zip_registry) <> p_workbook_rows then
    raise exception 'post-check: registry is not % rows', p_workbook_rows;
  end if;
  if (select count(*) from public.communities c, unnest(c.zip_codes) z where z = p_zip) <> 2 then
    raise exception 'post-check: % must be claimed by exactly its page and its root', p_zip;
  end if;
  if exists (select 1 from public.canonical_zip_guard_selftest() where not passed) then
    raise exception 'post-check: canonical_zip_guard_selftest has a failing case';
  end if;
  update public.zip_request_builds set plan = p_plan, workbook_sha256 = p_workbook_sha, updated_at = now() where zip = p_zip;
  return jsonb_build_object('zip', p_zip, 'root', _root, 'registry_n', p_workbook_rows);
end $$;

-- Save the page's development report (the runner called get-address-report) and build the page.
create or replace function public.zip_request_store_report(p_zip text, p_report jsonb)
returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
begin
  if p_report->>'zip' is distinct from p_zip or jsonb_typeof(p_report->'sites') <> 'array' then
    raise exception 'refusing: the report is not a ZIP-mode report for %', p_zip;
  end if;
  -- An EPA read that failed (epa.ok missing or false) is stored as an UNKNOWN facility count, never a zero:
  -- facilities_unavailable is set and the facility clock is not started. Found on 78521 (2026-11-12): FRS
  -- answered 429 and the page would have read "0 regulated facilities" where EPA lists 82.
  insert into public.development_reports (zip, home_lat, home_lng, counts, sites, paywall, source_vintage, refreshed_at,
                                          facilities_refreshed_at, facilities_unavailable)
  values (p_zip, (p_report->'home'->>'lat')::float8, (p_report->'home'->>'lng')::float8, p_report->'counts', p_report->'sites',
          coalesce((p_report->>'paywall')::bool, false), 'get-address-report ZIP mode; Tab 14 area request, built automatically', now(),
          case when coalesce((p_report->'epa'->>'ok')::bool, false) then now() end,
          not coalesce((p_report->'epa'->>'ok')::bool, false))
  on conflict (zip) do nothing;
  perform public.app_refresh_zip(p_zip);
  return (select jsonb_build_object('counts', counts) from public.development_reports where zip = p_zip);
end $$;

-- Record the outcome and email hello@homesignal.net (notify-health, kind zip_request).
create or replace function public.zip_request_finish(p_zip text, p_status text, p_code text, p_reason text,
                                                     p_detail jsonb default '{}'::jsonb, p_run_url text default null)
returns void language plpgsql security definer set search_path to 'public', 'extensions', 'net', 'vault', 'pg_temp' as $$
declare _secret text; _page text; _subject text;
begin
  if p_status not in ('built','refused','failed') then raise exception 'bad status %', p_status; end if;
  update public.zip_request_builds set status = p_status, code = p_code, reason = p_reason, run_url = p_run_url,
         finished_at = now(), updated_at = now(), notified_at = now()
   where zip = p_zip;
  _page := 'https://jodytracks.com/community/' || p_zip || '/';
  _subject := case p_status
    when 'built' then 'ZIP page ' || p_zip || ' built from a Tab 14 request'
    when 'refused' then 'ZIP ' || p_zip || ' needs you: not built automatically'
    else 'ZIP ' || p_zip || ' build failed' end;
  select decrypted_secret into _secret from vault.decrypted_secrets where name = 'signup_hook_secret';
  perform net.http_post(
    url := 'https://qwnnmljucajnexpxdgxr.supabase.co/functions/v1/notify-health',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-signup-secret', _secret),
    body := jsonb_build_object('kind', 'zip_request', 'state', case when p_status = 'built' then 'HEALTHY' else 'UNHEALTHY' end,
      'subject', _subject,
      'summary', coalesce(p_reason, ''),
      'checks', jsonb_build_array(
        jsonb_build_object('check', 'ZIP', 'ok', p_status = 'built', 'detail', p_zip),
        jsonb_build_object('check', 'Outcome', 'ok', p_status = 'built', 'detail', p_status || coalesce(' (' || p_code || ')', '')),
        jsonb_build_object('check', 'Page', 'ok', p_status = 'built', 'detail', case when p_status = 'built' then _page else 'not created' end),
        jsonb_build_object('check', 'Details', 'ok', true, 'detail', p_detail::text),
        jsonb_build_object('check', 'Run', 'ok', true, 'detail', coalesce(p_run_url, '')))));
end $$;

do $$
declare f text;
begin
  foreach f in array array['public.zip_request_claim(text)',
    'public.zip_request_facts(text,double precision,double precision,jsonb,text)',
    'public.zip_request_apply(text,jsonb,text,integer)', 'public.zip_request_store_report(text,jsonb)',
    'public.zip_request_finish(text,text,text,text,jsonb,text)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

-- Anyone may ask how many ZIPs this queue has added (the ZIP-universe check compares it); nothing else.
create or replace function public.zip_request_built_zips()
returns table (zip text, finished_at timestamptz, code text) language sql stable security definer set search_path to 'public', 'pg_temp' as $$
  select b.zip, b.finished_at, b.code from public.zip_request_builds b where b.status = 'built' order by b.zip collate "C"
$$;
revoke all on function public.zip_request_built_zips() from public;
grant execute on function public.zip_request_built_zips() to anon, authenticated, service_role;
