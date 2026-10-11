-- Executable scenarios for docs/dev-change-recovery.sql on a DISPOSABLE Postgres (never production).
-- ZIP 76258 stands for any ZIP; nothing in the SQL under test names one.
\set ON_ERROR_STOP 0
create temp table res(name text, ok boolean, detail text);
create or replace function pg_temp.chk(n text, ok boolean, d text default '') returns void language sql as
$$ insert into res values (n, coalesce(ok,false), d) $$;
create or replace function pg_temp.ev(p_key text) returns table (material boolean, is_baseline boolean, event_type text)
language sql as $$ select material, is_baseline, event_type from public.dev_change_event where identity_key = 'arcgis:fixture:' || p_key order by id $$;
create or replace function pg_temp.rep(p_key text) returns int language sql as
$$ select count(*)::int from public.dev_change_event_reportable where identity_key = 'arcgis:fixture:' || p_key $$;

-- ── world: three legacy records known to the ledger from the national baseline ───────────────────
select public.sim_refresh('76258', jsonb_build_array(
   public.sim_site('L1','Issued','2024-03-01'), public.sim_site('L2','Issued','2024-04-01'), public.sim_site('L3','Issued','2024-05-01')),
   now() - interval '30 hours');
select public.sim_observe('76258', true);       -- baseline: not news
select pg_temp.chk('S00 baseline wrote 3 identities and no reportable event',
  (select count(*) from public.dev_change_project)=3 and (select count(*) from public.dev_change_event_reportable)=0);

-- ── 1. RECOVERY: the ZIP is expanded; stamped records appear alongside the legacy ones ─────────────
select public.sim_refresh('76258', jsonb_build_array(
   public.sim_site('L1','Issued','2024-03-01'), public.sim_site('L2','Issued','2024-04-01'), public.sim_site('L3','Issued','2024-05-01'),
   public.sim_site('R1','Issued','2023-02-10', true),           -- historical, recovered
   public.sim_site('R2','Final','2022-07-01',  true),           -- historical, recovered
   public.sim_site('R3','Issued', null,        true),           -- undated, recovered
   public.sim_site('R4','Issued', (current_date - 10)::date, true),   -- RECENT, recovered: a genuine new filing
   public.sim_site('R5','Issued','2199-09-09', true),           -- implausible future date
   public.sim_site('G1','Issued', (current_date - 3)::date),    -- genuine new filing, legacy scope (unstamped)
   public.sim_site('G2','Issued','2020-01-01')),                -- OLD, legacy scope (unstamped): unchanged behaviour
   now() - interval '10 hours');
select public.sim_observe('76258') as res \gset r_
select pg_temp.chk('S01 ordinary run observed the ZIP', (:'r_res'::jsonb)->>'status' = 'ok', :'r_res');
select pg_temp.chk('S02 historical recovered record: first_detected written, NON-material, not reportable',
  (select material = false and is_baseline = true from pg_temp.ev('R1') limit 1) and pg_temp.rep('R1') = 0);
select pg_temp.chk('S03 second historical recovered record likewise', pg_temp.rep('R2') = 0 and (select count(*) from pg_temp.ev('R2')) = 1);
select pg_temp.chk('S04 UNDATED recovered record fails closed (not announced as news)',
  pg_temp.rep('R3') = 0 and (select outcome from public.dev_change_recovery where identity_key='arcgis:fixture:R3') = 'undated_failed_closed');
select pg_temp.chk('S05 implausible future date fails closed', pg_temp.rep('R5') = 0
  and (select outcome from public.dev_change_recovery where identity_key='arcgis:fixture:R5') = 'undated_failed_closed');
select pg_temp.chk('S06 RECENT recovered record is a GENUINE new filing: reported (material, reportable)',
  pg_temp.rep('R4') = 1 and (select material and not is_baseline from pg_temp.ev('R4') limit 1)
  and (select outcome from public.dev_change_recovery where identity_key='arcgis:fixture:R4') = 'genuine_recent');
select pg_temp.chk('S07 a genuine new filing in the legacy scope (unstamped) is reported exactly as before',
  pg_temp.rep('G1') = 1 and not exists (select 1 from public.dev_change_recovery where identity_key='arcgis:fixture:G1'));
select pg_temp.chk('S08 an OLD record in the legacy scope (unstamped) is unchanged legacy behaviour: reported, not classified',
  pg_temp.rep('G2') = 1 and not exists (select 1 from public.dev_change_recovery where identity_key='arcgis:fixture:G2'));
select pg_temp.chk('S09 records the ledger already knew produced no event',
  (select count(*) from public.dev_change_event_reportable where identity_key in ('arcgis:fixture:L1','arcgis:fixture:L2','arcgis:fixture:L3')) = 0);
select pg_temp.chk('S10 audit: 5 stamped identities classified (3 not-news, 1 recent, + the future-dated one counted above)',
  (select count(*) from public.dev_change_recovery) = 5 and (select count(*) from public.dev_change_recovery where suppressed) = 4,
  (select string_agg(outcome, ',') from public.dev_change_recovery));
select pg_temp.chk('S11 the run reports what it did', ((:'r_res'::jsonb)->>'recovery_not_news')::int = 4 and ((:'r_res'::jsonb)->>'recovery_genuine')::int = 1, :'r_res');
select pg_temp.chk('S12 nothing was deleted: every recovered identity and its event exist',
  (select count(*) from public.dev_change_project where identity_key like 'arcgis:fixture:R%') = 5
  and (select count(*) from public.dev_change_event where identity_key like 'arcgis:fixture:R%') = 5);

-- ── 2. REPEAT REFRESH: the same cache again creates nothing new ─────────────────────────────────
select (select count(*) from public.dev_change_event) as n_ev, (select count(*) from public.dev_change_recovery) as n_rec \gset b_
select public.sim_refresh('76258', (select sites from public.development_reports where zip='76258'), now() - interval '9 hours');
select public.sim_observe('76258');
select pg_temp.chk('S13 a repeated expanded refresh writes no false identity, event or classification',
  (select count(*) from public.dev_change_event) = :b_n_ev and (select count(*) from public.dev_change_recovery) = :b_n_rec);

-- ── 3. GENUINE CHANGE AFTER RECOVERY IS PRESERVED ───────────────────────────────────────────────
select public.sim_refresh('76258', (select jsonb_agg(case when e->>'case_number' in ('R1','R2') then jsonb_set(e,'{stage}','"Final"') else e end)
                                      from public.development_reports d, jsonb_array_elements(d.sites) e where d.zip='76258'), now() - interval '8 hours');
select public.sim_observe('76258');
select pg_temp.chk('S14 a real publisher status change on a recovered record IS reported (material status_changed)',
  exists (select 1 from public.dev_change_event_reportable where identity_key='arcgis:fixture:R1' and event_type='status_changed' and material));
select pg_temp.chk('S15 R2 (stage already Final) emitted no change; R1 (Issued -> Final) did',
  pg_temp.rep('R2') = 0 and pg_temp.rep('R1') = 1);

-- ── 4. THE BARRIER: a cache newer than its materialisation is not observed ──────────────────────
select public.sim_refresh('76258', (select sites from public.development_reports where zip='76258')
                                   || jsonb_build_array(public.sim_site('R6','Issued','2021-05-05', true)), now() - interval '2 hours', false);
select (select count(*) from public.dev_change_event) as n_ev, (select count(*) from public.dev_change_project) as n_pr \gset c_
select public.sim_observe('76258') as res \gset d_
select pg_temp.chk('S16 cache newer than materialisation ⇒ status deferred', (:'d_res'::jsonb)->>'status' = 'deferred', :'d_res');
select pg_temp.chk('S17 a deferral writes NOTHING (no event, no identity)',
  (select count(*) from public.dev_change_event) = :c_n_ev and (select count(*) from public.dev_change_project) = :c_n_pr);
select pg_temp.chk('S18 the barrier helper agrees', not public.dev_change_materialization_current('76258'));
-- the tick: the deferred ZIP is not marked observed and is retried
insert into public.canonical_zip_registry (zip) values ('76258') on conflict do nothing;
insert into public.dev_change_zip_cursor (zip, status, first_ok_at, observed_at, materialized_at, last_run_id)
  select '76258', 'ok', now() - interval '3 days', now() - interval '48 hours', now() - interval '3 days',
         (select id from public.dev_change_run order by started_at desc limit 1)
on conflict (zip) do update set observed_at = excluded.observed_at, materialized_at = excluded.materialized_at;
update public.app_community_meta set updated_at = now() where zip = '76258';
select (select materialized_at from public.dev_change_zip_cursor where zip='76258') as cur_m \gset t_
select public.dev_change_start_run(false, '{}'::jsonb) as run \gset t_
select public.dev_change_tick(:'t_run'::uuid, 10, 20, 100000, null, 1) as tick \gset t_
select pg_temp.chk('S19 the tick reports the deferral and does not advance the ZIP cursor',
  ((:'t_tick'::jsonb)->>'zips_deferred')::int = 1 and ((:'t_tick'::jsonb)->>'zip_errors')::int = 0
  and (select materialized_at is not distinct from :'t_cur_m'::timestamptz and status = 'ok' and error is null from public.dev_change_zip_cursor where zip='76258'), :'t_tick');
select public.dev_change_finish_run(:'t_run'::uuid);
-- materialise it: the next observation classifies R6 (historical) and nothing was announced in between
select public.sim_refresh('76258', (select sites from public.development_reports where zip='76258'), (select refreshed_at from public.development_reports where zip='76258'));
select pg_temp.chk('S20 after materialisation the barrier opens', public.dev_change_materialization_current('76258'));
select public.sim_observe('76258');
select pg_temp.chk('S21 the previously-deferred stamped record was classified at first sighting: not news',
  pg_temp.rep('R6') = 0 and (select outcome from public.dev_change_recovery where identity_key='arcgis:fixture:R6') = 'historical_backlog');

-- ── 4b. THE CACHE MOVES WHILE THE STAMPS ARE READ ─────────────────────────────────────────────────
select public.sim_refresh('76259', jsonb_build_array(public.sim_site('B1','Issued','2019-01-01', true), public.sim_site('B2','Issued','2018-01-01', true)), now() - interval '90 minutes');
select (select count(*) from public.dev_change_event) as n_ev, (select count(*) from public.dev_change_project) as n_pr, (select count(*) from public.dev_change_recovery) as n_rc \gset f_
select set_config('test.bump_cache_zip', '76259', false);
select public.sim_observe('76259') as res \gset g_
select set_config('test.bump_cache_zip', '', false);
select pg_temp.chk('S29 a cache write landing during the stamp read defers the observation',
  (:'g_res'::jsonb)->>'status' = 'deferred' and (:'g_res'::jsonb)->>'reason' = 'cache_changed_during_observation', :'g_res');
select pg_temp.chk('S30 …and nothing was written',
  (select count(*) from public.dev_change_event) = :f_n_ev and (select count(*) from public.dev_change_project) = :f_n_pr
  and (select count(*) from public.dev_change_recovery) = :f_n_rc);

-- ── 5. DISABLE → legacy refresh → the recovered rows lapse; no event is invented ─────────────────
select (select count(*) from public.dev_change_event) as n_ev \gset e_
select public.sim_refresh('76258', jsonb_build_array(public.sim_site('L1','Issued','2024-03-01'), public.sim_site('L2','Issued','2024-04-01'),
   public.sim_site('L3','Issued','2024-05-01'), public.sim_site('G1','Issued',(current_date-3)::date), public.sim_site('G2','Issued','2020-01-01')), now() - interval '1 hours');
select public.sim_observe('76258');
select pg_temp.chk('S22 mode OFF + legacy refresh: recovered rows are gone from app_projects',
  not exists (select 1 from public.app_projects where zip='76258' and source_key like 'arcgis:fixture:R%'));
select pg_temp.chk('S23 …the ledger keeps their history (absence is never an event) and writes nothing for the lapse',
  (select count(*) from public.dev_change_project where identity_key like 'arcgis:fixture:R%') = 6
  and (select count(*) from public.dev_change_event) = :e_n_ev);
-- re-enable: the SAME identities return; they are already known, so no second announcement
select public.sim_refresh('76258', (select jsonb_agg(e) from (
   select public.sim_site('L1','Issued','2024-03-01') e union all select public.sim_site('R1','Final','2023-02-10', true)
   union all select public.sim_site('R4','Issued',(current_date - 10)::date, true)) q), now());
select public.sim_observe('76258');
select pg_temp.chk('S24 re-enable: already-known recovered identities are not announced again',
  pg_temp.rep('R4') = 1 and (select count(*) from pg_temp.ev('R4')) = 1 and pg_temp.rep('R1') = 1 and (select count(*) from public.dev_change_recovery) = 6);

-- ── 6. A BASELINE RUN IS UNTOUCHED ────────────────────────────────────────────────────────────────
select public.sim_refresh('76259', jsonb_build_array(public.sim_site('B1','Issued','2019-01-01', true)), now() - interval '1 hours');
select public.sim_observe('76259', true);
select pg_temp.chk('S25 a baseline run classifies nothing (it already writes non-reportable first sightings)',
  not exists (select 1 from public.dev_change_recovery where zip='76259') and pg_temp.rep('B1') = 0
  and (select is_baseline from pg_temp.ev('B1') limit 1));

-- ── 7. SAFETY ──────────────────────────────────────────────────────────────────────────────────────
select pg_temp.chk('S26 new objects are not reachable by anon/authenticated',
  not has_function_privilege('anon','public.dev_change_recovery_stamped(text)','execute')
  and not has_function_privilege('authenticated','public.dev_change_materialization_current(text)','execute')
  and not has_table_privilege('anon','public.dev_change_recovery','select')
  and not has_table_privilege('authenticated','public.dev_change_recovery','insert'));
select pg_temp.chk('S27 the audit table is RLS-protected',
  (select relrowsecurity from pg_class where oid='public.dev_change_recovery'::regclass));
select pg_temp.chk('S28 events stay immutable', (select count(*) from pg_trigger where tgrelid='public.dev_change_event'::regclass and not tgisinternal) >= 1);

select name||'|'||case when ok then 't' else 'f' end||'|'||detail from res order by name;
