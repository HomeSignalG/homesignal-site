-- ============================================================================
-- SCHEDULED EPA FRS AVAILABILITY PROBE — applied to qwnnmljucajnexpxdgxr as
-- migration `epa_frs_probe_scheduled` (2026-08-09). Parked here per CLAUDE.md
-- §1 row 3 so the schema stays reproducible. Design + ruling: §Z of
-- docs/accuracy-audit-2026-08.md.
--
-- WHY. EPA FRS went down on 2026-08-09 and nothing recorded it. The outage
-- zeroed the facilities layer on 1,722 of 12,722 cached pages before anyone
-- noticed, and the only evidence was ad-hoc manual probes that were never
-- persisted. This makes the moment FRS recovers visible and timestamped.
--
-- IT ONLY RECORDS. It does NOT un-pause dev-reports-rolling-refresh (pg_cron
-- job 14) and it does NOT fire the 82801 single-page recovery proof. Resuming
-- is a human decision.
--
-- Preconditions VERIFIED before building, not assumed: pg_cron 1.6.4 and
-- pg_net 0.20.3 are both already installed on this project — hence no deploy,
-- no secret and no runner.
-- ============================================================================

create table if not exists public.epa_frs_probes (
  id          bigserial primary key,
  probed_at   timestamptz      not null default now(),
  target      text             not null,   -- 'sheridan-rural' | 'atlanta-dense'
  lat         double precision not null,
  lng         double precision not null,
  radius_mi   numeric          not null,
  status_code integer,                     -- null = the request never completed (timeout / peer failure)
  ok          boolean          not null default false,
  error_msg   text,                        -- pg_net's own text on timeout / peer failure
  request_id  bigint,                      -- net._http_response id, for the raw body
  resolved_at timestamptz                  -- null = fired, response not yet harvested
);

comment on table public.epa_frs_probes is
  'Availability history for EPA FRS get_facilities. One row per fire; ok/status_code are '
  'filled in by the NEXT tick when the response has landed. ok is FAIL-CLOSED: it stays false '
  'until a response is proven good, so an unresolved row never reads as healthy.';
comment on column public.epa_frs_probes.ok is
  'HTTP 200 AND a Results payload carrying no Error. Deliberately NOT status_code=200: FRS '
  'answers 200 with a Results.Error body on a process-limit refusal, so a status-only test '
  'would report healthy during exactly the condition that zeroes pages (engine v13).';

create index if not exists epa_frs_probes_probed_at_idx on public.epa_frs_probes (probed_at desc);
create index if not exists epa_frs_probes_unresolved_idx on public.epa_frs_probes (id) where resolved_at is null;

-- Internal ops data: no browser reads it. RLS ON with NO policy denies anon/authenticated while
-- the service role and the table owner are unaffected. (Opposite case to development_reports,
-- which the page reads and which therefore carries a public select policy — see the CLAUDE.md
-- warning about enabling RLS without policies, which applies to READ-PATH tables, not this one.)
alter table public.epa_frs_probes enable row level security;

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
  with landed as (
    select p.id,
           resp.status_code,
           resp.error_msg,
           (resp.status_code = 200
            and resp.content is not null
            and position('"Results"' in resp.content) > 0
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
  '"epa-frs-probe". Records only — it never un-pauses dev-reports-rolling-refresh.';

select cron.schedule('epa-frs-probe', '*/15 * * * *', 'select public.epa_frs_probe_tick();');

-- ── FIRST ROWS, actually observed after applying ────────────────────────────
--  id | probed_at (UTC)      | target         | status_code | ok    | resolved_at
--   1 | 2026-08-09 21:46:17  | sheridan-rural | 502         | false | 21:46:39
--   2 | 2026-08-09 21:46:17  | atlanta-dense  | 502         | false | 21:46:39
-- Useful reads:
--   select * from public.epa_frs_probes order by id desc limit 20;                  -- recent history
--   select * from public.epa_frs_probes where ok order by probed_at limit 1;         -- FIRST recovery
