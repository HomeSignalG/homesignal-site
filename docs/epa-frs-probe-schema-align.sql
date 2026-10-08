-- ============================================================================
-- EPA FRS PROBE SCHEMA ALIGNMENT (2026-09-27) — PARKED, NOT APPLIED
--
-- SQL OF RECORD for public.epa_frs_probe_tick() after the silent-zero schema
-- fix. Supersedes the harvest predicate in docs/epa-frs-probe-migration.sql
-- (that file remains the table + original function + cron). This file replaces
-- ONLY the function. It does not create the table, does not touch the cron,
-- and does not fire a probe.
--
-- WHAT WAS WRONG
-- ----------------------------------------------------------------------------
-- The probe called a payload healthy when it was HTTP 200, contained the text
-- "Results", and did not contain the text "Error". Ingest accepted any 2xx and
-- any parseable JSON. Measured mismatches (audit 2026-09-27):
--   * {"Results":{}} passed the probe AND the ingest parser (now ingest
--     schema-fails; this file makes the probe fail too).
--   * {"FRSFacility":[…]} with no Results wrapper passed ingest and failed
--     the probe. Official FRS wraps in Results; the probe stays on that
--     envelope. Ingest still accepts a bare FRSFacility array as retrieval.
--   * HTTP 204 / other 2xx fell through ingest parse. Ingest now requires 200.
--
-- THE FIX
-- ----------------------------------------------------------------------------
-- ok requires HTTP 200 AND "Results" AND ("FRSFacility" OR "Facilities") AND
-- no "Error". Still text-matched, never jsonb-cast (unescaped backslashes).
-- A process-limit body (Results + Error) stays unhealthy. A bare {} stays
-- unhealthy. {"Results":{}} is now unhealthy on BOTH sides.
--
-- ROLLBACK: re-apply the function body in docs/epa-frs-probe-migration.sql.
-- ============================================================================

begin;

create or replace function public.epa_frs_probe_tick()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'net'
as $function$
declare _resolved int; _fired int; r record; rid bigint;
begin
  -- (a) HARVEST the previous tick's fires. Matched on request_id, so a response that arrives
  --     late is still picked up on a later tick rather than lost.
  --     `ok` is TEXT-matched, never jsonb-cast: FRS is known to emit invalid JSON (unescaped
  --     backslashes in facility names — the v13 defect), so a cast would throw on exactly the
  --     payloads this probe exists to observe.
  --     SCHEMA ALIGN 2026-09-27: "Results" alone is not an envelope. {"Results":{}} passed
  --     this probe and the ingest parser. Require a facility list key, matching recognizedFrsPayload().
  with landed as (
    select p.id,
           resp.status_code,
           resp.error_msg,
           (resp.status_code = 200
            and resp.content is not null
            and position('"Results"' in resp.content) > 0
            and (position('"FRSFacility"' in resp.content) > 0
                 or position('"Facilities"' in resp.content) > 0)
            and position('"Error"'   in resp.content) = 0) as ok
      from public.epa_frs_probes p
      join net._http_response resp on resp.id = p.request_id
     where p.resolved_at is null
  )
  update public.epa_frs_probes p
     set status_code = l.status_code,
         error_msg   = l.error_msg,
         ok          = coalesce(l.ok, false),
         resolved_at = now()
    from landed l
   where p.id = l.id;
  get diagnostics _resolved = row_count;

  -- (b) FIRE both targets. Two points, not one: FRS's failure mode is density-dependent (the
  --     process limit bites in dense areas and not rural ones — engine v13), so a single rural
  --     probe can read healthy while every dense page still returns nothing.
  _fired := 0;
  for r in
    select * from (values
      ('sheridan-rural', 44.7973::double precision, -106.9562::double precision, 3::numeric),
      ('atlanta-dense',  33.7490::double precision,  -84.3760::double precision, 1::numeric)
    ) t(target, lat, lng, radius_mi)
  loop
    rid := net.http_get(
      'https://ofmpub.epa.gov/frs_public2/frs_rest_services.get_facilities'
        || '?latitude83='  || to_char(r.lat, 'FM999990.000000')
        || '&longitude83=' || to_char(r.lng, 'FM999990.000000')
        || '&search_radius=' || r.radius_mi::text
        || '&output=JSON',
      timeout_milliseconds := 40000);
    insert into public.epa_frs_probes (target, lat, lng, radius_mi, request_id)
    values (r.target, r.lat, r.lng, r.radius_mi, rid);
    _fired := _fired + 1;
  end loop;

  return jsonb_build_object('resolved', _resolved, 'fired', _fired, 'at', now());
end $function$;

comment on function public.epa_frs_probe_tick() is
  'Harvest the previous fires, then fire both targets. Scheduled every 15 minutes by pg_cron job '
  '"epa-frs-probe". Records only — it never un-pauses dev-reports-rolling-refresh. ok requires '
  'HTTP 200, a Results envelope, a FRSFacility/Facilities list key, and no Error.';

comment on column public.epa_frs_probes.ok is
  'HTTP 200 AND a Results envelope carrying FRSFacility or Facilities AND no Error. '
  '{"Results":{}} is NOT healthy (2026-09-27 schema align). Still not status-only: FRS '
  'answers 200 with Results.Error on a process-limit refusal.';

commit;
