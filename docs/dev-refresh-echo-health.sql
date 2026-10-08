-- ECHO / CWA HEALTH ON THE ZIP ROW (2026-09-27)
--
-- WHY. Live ECHO/CWA enrichment now returns {attempted, ok, reason, matched,
-- query_rows, query_rows_reported} on the report body (sources/echo-cwa.ts).
-- dev_refresh_collect() wrote sites/counts/epa.ok and threw those outcomes
-- away, so a whole-call ECHO failure was stored as "no env.epa" and could not
-- be queried after collect. The FRS guard (dev_epa_write_refused) never saw it.
--
-- WHAT THIS DOES.
--   1. Persist j->'echo' and j->'cwa' on development_reports.
--   2. When echo.ok or cwa.ok is false, merge last-known-good env.epa onto
--      incoming facility sites by registry_id (same rule as preserveStoredEnv).
--   3. A view + queue helper for the ZIPs that already lost ECHO. The helper
--      INSERTS into dev_refresh_targets; it does NOT fire. Do not fire until
--      get-address-report carrying echo/cwa is deployed — a re-fire through
--      the old function would wipe again.
--
-- BACKWARD COMPATIBLE. A payload with no echo/cwa key keeps the stored
-- columns and treats retrieval as ok (coalesce true), so behaviour is
-- byte-identical until the engine deploys. Missing key ≠ failure.
--
-- APPLIED as named functions + an anchored collect patch. The live
-- dev_refresh_collect body is READ, not retyped.

-- ── 1. persist the plane outcomes ───────────────────────────────────────────
alter table public.development_reports
  add column if not exists echo jsonb,
  add column if not exists cwa jsonb;

comment on column public.development_reports.echo is
  'Last get-address-report ECHO call outcome {attempted, ok, reason, matched, query_rows, query_rows_reported, duration_ms, restored}. NULL = this row has never seen an echo key (pre-v25 engine). ok:false is a failed call, not an empty match.';
comment on column public.development_reports.cwa is
  'Last get-address-report ICIS-NPDES (CWA) call outcome, same shape as echo. NULL = never seen a cwa key.';

-- ── 2. merge stored env.epa onto an incoming facility when a live call failed
create or replace function public.dev_echo_apply_stored_epa(
  _site jsonb,
  _stored_epa jsonb,
  _echo_ok boolean,
  _cwa_ok boolean
) returns jsonb
language plpgsql
stable
set search_path to 'public'
as $function$
declare
  env jsonb;
  epa jsonb;
  k text;
  echo_keys text[] := array['in_violation','snc','quarters_nc','inspections','action_year','penalty_count','current_as_of'];
  cwa_keys text[] := array['permits','permit_status','compliance_tracking_on'];
  copied boolean := false;
begin
  if _stored_epa is null or jsonb_typeof(_stored_epa) <> 'object' then
    return _site;
  end if;
  env := coalesce(_site->'env', '{}'::jsonb);
  epa := coalesce(env->'epa', '{}'::jsonb);
  if not coalesce(_echo_ok, true) then
    foreach k in array echo_keys loop
      if (epa->k) is null and (_stored_epa->k) is not null then
        epa := epa || jsonb_build_object(k, _stored_epa->k);
        copied := true;
      end if;
    end loop;
  end if;
  if not coalesce(_cwa_ok, true) then
    foreach k in array cwa_keys loop
      if (epa->k) is null and (_stored_epa->k) is not null then
        epa := epa || jsonb_build_object(k, _stored_epa->k);
        copied := true;
      end if;
    end loop;
  end if;
  if not copied then return _site; end if;
  env := jsonb_set(env, '{link_type}', to_jsonb(coalesce(env->>'link_type', 'geo_matched')), true);
  env := jsonb_set(env, '{epa}', epa, true);
  return _site || jsonb_build_object('env', env);
end
$function$;

comment on function public.dev_echo_apply_stored_epa(jsonb, jsonb, boolean, boolean) is
  'Copy last-known-good ECHO/CWA fields onto one incoming facility site. Only fills keys this run did not stamp. A successful empty answer (ok true) is left alone.';

create or replace function public.dev_echo_merge_facility_sites(
  _incoming jsonb,
  _stored jsonb,
  _j jsonb
) returns jsonb
language sql
stable
set search_path to 'public'
as $function$
  with
  flags as (
    select coalesce((_j->'echo'->>'ok')::boolean, true) as echo_ok,
           coalesce((_j->'cwa'->>'ok')::boolean, true) as cwa_ok
  ),
  stored_epa as (
    select trim(s->>'registry_id') as rid, s->'env'->'epa' as epa
    from jsonb_array_elements(coalesce(_stored, '[]'::jsonb)) s
    where trim(coalesce(s->>'registry_id', '')) <> ''
      and jsonb_typeof(s->'env'->'epa') = 'object'
  )
  select coalesce(jsonb_agg(
           case
             when (select echo_ok and cwa_ok from flags) then e.x
             else public.dev_echo_apply_stored_epa(
                    e.x, se.epa,
                    (select echo_ok from flags),
                    (select cwa_ok from flags))
           end
           order by e.o), '[]'::jsonb)
  from jsonb_array_elements(coalesce(_incoming, '[]'::jsonb)) with ordinality e(x, o)
  left join stored_epa se on se.rid = trim(e.x->>'registry_id');
$function$;

comment on function public.dev_echo_merge_facility_sites(jsonb, jsonb, jsonb) is
  'Facility-plane merge used by dev_refresh_collect(). When echo.ok or cwa.ok is false, fills missing env.epa from the stored row by registry_id. A missing echo/cwa key coalesces to ok, so pre-v25 payloads are unchanged.';

-- ── collect: persist echo/cwa and merge facilities when a call failed ───────
do $mig$
declare
  src text;
  anchor text;
  repl text;
  hits int;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where p.proname = 'dev_refresh_collect' and n.nspname = 'public';
  if src is null then
    raise exception 'public.dev_refresh_collect() not found — refusing to patch nothing';
  end if;

  if position($$j->'echo'$$ in src) > 0 then
    raise notice 'echo health collect patch already applied — no change';
    return;
  end if;

  -- (a) incoming facility sites go through the ECHO merge, not a raw copy.
  anchor := $a$else coalesce((select jsonb_agg(x order by o)
                                  from jsonb_array_elements(j->'sites') with ordinality t(x, o)
                                 where x ? 'registry_id'), '[]'::jsonb)
               end,$a$;
  hits := (length(src) - length(replace(src, anchor, ''))) / length(anchor);
  if hits <> 1 then
    raise exception 'facility-write else-branch found % times (expected 1) — refusing to patch blind', hits;
  end if;
  repl := $r$else public.dev_echo_merge_facility_sites(
                   coalesce((select jsonb_agg(x order by o)
                               from jsonb_array_elements(j->'sites') with ordinality t(x, o)
                              where x ? 'registry_id'), '[]'::jsonb),
                   coalesce((select jsonb_agg(x order by o)
                               from jsonb_array_elements(d.sites) with ordinality t(x, o)
                              where x ? 'registry_id'), '[]'::jsonb),
                   j)
               end,$r$;
  src := replace(src, anchor, repl);

  -- (b) persist the outcomes. Missing key keeps what is already stored.
  anchor := $a$paywall        = coalesce((j->>'paywall')::boolean, false),$a$;
  hits := (length(src) - length(replace(src, anchor, ''))) / length(anchor);
  if hits <> 1 then
    raise exception 'paywall assignment found % times (expected 1) — refusing to patch blind', hits;
  end if;
  repl := $r$paywall        = coalesce((j->>'paywall')::boolean, false),
    echo           = case when j ? 'echo' then j->'echo' else d.echo end,
    cwa            = case when j ? 'cwa'  then j->'cwa'  else d.cwa  end,$r$;
  src := replace(src, anchor, repl);

  execute src;
  raise notice 'echo health collect patch applied';
end
$mig$;

-- ── 3. wiped-ZIP worklist. VIEW is the source of truth; queue does not fire. ─
create or replace view public.v_echo_wipe_candidates as
select
  d.zip,
  coalesce((d.counts->>'facilities')::int, 0) as facilities,
  (select count(*) from jsonb_array_elements(d.sites) s
    where s ? 'registry_id' and s->'env'->'epa' is not null) as echo_matched,
  d.facilities_unavailable,
  d.facilities_refreshed_at,
  d.echo,
  d.cwa
from public.development_reports d
where coalesce((d.counts->>'facilities')::int, 0) >= 5
  and coalesce(d.facilities_unavailable, false) = false
  and not exists (
    select 1 from jsonb_array_elements(d.sites) s
     where s ? 'registry_id' and s->'env'->'epa' is not null
  );

comment on view public.v_echo_wipe_candidates is
  'FRS-fresh ZIPs with at least 5 facilities and zero env.epa — the silent whole-call ECHO failure signature (01610 class). Not a fire list; public.dev_echo_queue_wipe_retries() inserts these into dev_refresh_targets. Do not fire until get-address-report v25 is deployed.';

create or replace function public.dev_echo_queue_wipe_retries()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare n integer;
begin
  insert into public.dev_refresh_targets (zip, fired_at)
  select c.zip, null
  from public.v_echo_wipe_candidates c
  union
  select z.zip, null
  from (values
    ('01610'),('27518'),('78723'),('10560'),
    ('37405'),('55103'),('63131'),('98412')
  ) as z(zip)
  join public.development_reports d on d.zip = z.zip
  on conflict (zip) do update
    set fired_at = null
    where public.dev_refresh_targets.fired_at is not null;
  get diagnostics n = row_count;
  return n;
end
$function$;

comment on function public.dev_echo_queue_wipe_retries() is
  'Queue the wipe-signature ZIPs onto dev_refresh_targets (fired_at null). Does NOT call net.http_post. Do not run public.dev_refresh_fire_targets() against this queue until get-address-report returns echo/cwa.';

-- The view is an operator receipt, not a page contract. Revoke the default PUBLIC
-- grant so anon cannot read the wipe list through the Data API.
revoke all on public.v_echo_wipe_candidates from public, anon, authenticated;
revoke all on function public.dev_echo_queue_wipe_retries() from public, anon, authenticated;
revoke all on function public.dev_echo_apply_stored_epa(jsonb, jsonb, boolean, boolean) from public, anon, authenticated;
revoke all on function public.dev_echo_merge_facility_sites(jsonb, jsonb, jsonb) from public, anon, authenticated;

-- APPLIED LIVE 2026-09-27 on qwnnmljucajnexpxdgxr as migrations
--   dev_refresh_echo_health_v1 (columns + merge functions)
--   dev_refresh_echo_health_v1_collect (collect patch + wipe view + queue helper)
-- Verified: development_reports.echo/cwa exist; collect reads j->'echo' and
-- calls dev_echo_merge_facility_sites; v_echo_wipe_candidates = 74 rows.
-- Queue helper was NOT executed. Do not fire until get-address-report v25
-- (echo/cwa on the report body) is deployed.
