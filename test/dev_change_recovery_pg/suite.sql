-- Executable scenarios for docs/dev-change-recovery.sql (rule_version 2) on a DISPOSABLE Postgres (never production).
-- ZIP 76258 stands for any ZIP; nothing in the SQL under test names one.
\set ON_ERROR_STOP 0
create temp table res(name text, ok boolean, detail text);
create or replace function pg_temp.chk(n text, ok boolean, d text default '') returns void language sql as
$$ insert into res values (n, coalesce(ok,false), d) $$;
create or replace function pg_temp.ev(p_key text) returns table (material boolean, is_baseline boolean, event_type text)
language sql as $$ select material, is_baseline, event_type from public.dev_change_event where identity_key = 'arcgis:fixture:' || p_key order by id $$;
create or replace function pg_temp.rep(p_key text) returns int language sql as
$$ select count(*)::int from public.dev_change_event_reportable where identity_key = 'arcgis:fixture:' || p_key $$;
create or replace function pg_temp.k(p_ids text[]) returns text[] language sql as
$$ select array(select 'arcgis:fixture:' || x from unnest(p_ids) x) $$;

-- ── world: three legacy records known to the ledger from the national baseline ───────────────────
select public.sim_refresh('76258', jsonb_build_array(
   public.sim_site('L1','Issued','2024-03-01'), public.sim_site('L2','Issued','2024-04-01'), public.sim_site('L3','Issued','2024-05-01')),
   now() - interval '30 hours');
select public.sim_observe('76258', true);       -- baseline: not news
select pg_temp.chk('S00 baseline wrote 3 identities and no reportable event',
  (select count(*) from public.dev_change_project)=3 and (select count(*) from public.dev_change_event_reportable)=0);

-- ── 1. COVERAGE RECOVERY: every kind and state of publisher date, stamped, arrives in ONE expansion ──
-- Nothing about the date may decide the outcome. Unstamped controls (legacy scope) must behave exactly as before.
select public.sim_refresh('76258', jsonb_build_array(
   public.sim_site('L1','Issued','2024-03-01'), public.sim_site('L2','Issued','2024-04-01'), public.sim_site('L3','Issued','2024-05-01'),
   public.sim_site('R1','Issued','2023-02-10', true, 'filed'),                      -- old filing
   public.sim_site('R2','Final','2022-07-01',  true, 'filed'),                      -- old filing, later stage
   public.sim_site('R3','Issued', null,        true),                               -- no date at all
   public.sim_site('R4','Issued', (current_date - 10)::date, true, 'filed'),        -- RECENT filing: used to be "genuine"
   public.sim_site('R5','Issued','2199-09-09', true, 'filed'),                      -- implausible future date
   public.sim_site('R6','Issued', (current_date - 5)::date,  true, 'issued'),       -- RECENT issue date
   public.sim_site('R7','Proposed',(current_date + 20)::date, true, 'scheduled'),   -- scheduled hearing (future, plausible)
   public.sim_site('R8','Proposed','2021-01-01', true, 'estimated'),                -- estimated date
   public.sim_site('R9','Approved',(current_date - 2)::date, true, 'decided'),      -- recent decision
   public.sim_site('R10','Issued',(current_date - 400)::date, true, 'filed'),       -- delayed publication: filed 400 d ago, first seen now
   public.sim_site('G1','Issued', (current_date - 3)::date),                        -- genuine new filing, legacy scope (unstamped)
   public.sim_site('G2','Issued','2020-01-01'),                                     -- OLD, legacy scope (unstamped)
   public.sim_site('G3','Issued','2199-09-09')),                                    -- future-dated, legacy scope (unstamped)
   now() - interval '10 hours');
select public.sim_observe('76258') as res \gset r_
select pg_temp.chk('S01 ordinary run observed the ZIP', (:'r_res'::jsonb)->>'status' = 'ok', :'r_res');
select pg_temp.chk('S02 EVERY stamped first sighting (old, recent, undated, future, scheduled, estimated, decided, delayed) is written non-material and is NOT reportable',
  (select count(*) from public.dev_change_event_reportable where identity_key like 'arcgis:fixture:R%') = 0
  and (select count(*) from public.dev_change_event where identity_key like 'arcgis:fixture:R%' and event_type='first_detected' and not material and is_baseline) = 10);
select pg_temp.chk('S03 …and each carries the SAME outcome whatever its date (no date decides)',
  (select count(distinct outcome) from public.dev_change_recovery) = 1
  and (select outcome from public.dev_change_recovery limit 1) = 'coverage_recovered'
  and (select count(*) from public.dev_change_recovery) = 10,
  (select string_agg(distinct outcome, ',') from public.dev_change_recovery));
select pg_temp.chk('S04 a RECENT filing (R4) and an OLD one (R1) are treated alike',
  (select outcome from public.dev_change_recovery where identity_key='arcgis:fixture:R4')
  = (select outcome from public.dev_change_recovery where identity_key='arcgis:fixture:R1') and pg_temp.rep('R4') = 0 and pg_temp.rep('R1') = 0);
select pg_temp.chk('S05 the audit DESCRIBES the date and its kind without using them',
  (select date_state from public.dev_change_recovery where identity_key='arcgis:fixture:R3') = 'undated'
  and (select date_state from public.dev_change_recovery where identity_key='arcgis:fixture:R5') = 'future'
  and (select date_state from public.dev_change_recovery where identity_key='arcgis:fixture:R7') = 'future'
  and (select date_state from public.dev_change_recovery where identity_key='arcgis:fixture:R1') = 'dated'
  and (select date_kind from public.dev_change_recovery where identity_key='arcgis:fixture:R6') = 'issued'
  and (select date_kind from public.dev_change_recovery where identity_key='arcgis:fixture:R7') = 'scheduled'
  and (select date_kind from public.dev_change_recovery where identity_key='arcgis:fixture:R8') = 'estimated'
  and (select date_kind from public.dev_change_recovery where identity_key='arcgis:fixture:R9') = 'decided');
select pg_temp.chk('S06 the audit names the cache generation it was synchronised with',
  (select count(*) from public.dev_change_recovery where cache_refreshed_at = (select refreshed_at from public.development_reports where zip='76258')) = 10);
select pg_temp.chk('S07 UNSTAMPED records (legacy scope) behave exactly as before, whatever their age or date: reported, never classified',
  pg_temp.rep('G1') = 1 and pg_temp.rep('G2') = 1 and pg_temp.rep('G3') = 1
  and not exists (select 1 from public.dev_change_recovery where identity_key like 'arcgis:fixture:G%'));
select pg_temp.chk('S08 records the ledger already knew produced no event',
  (select count(*) from public.dev_change_event_reportable where identity_key in ('arcgis:fixture:L1','arcgis:fixture:L2','arcgis:fixture:L3')) = 0);
select pg_temp.chk('S09 the run reports what it did', ((:'r_res'::jsonb)->>'coverage_recovered')::int = 10, :'r_res');
select pg_temp.chk('S10 nothing was deleted: every recovered identity and its event exist',
  (select count(*) from public.dev_change_project where identity_key like 'arcgis:fixture:R%') = 10
  and (select count(*) from public.dev_change_event where identity_key like 'arcgis:fixture:R%') = 10);

-- ── 2. REPEAT REFRESH: the same cache again creates nothing new ─────────────────────────────────
select (select count(*) from public.dev_change_event) as n_ev, (select count(*) from public.dev_change_recovery) as n_rec \gset b_
select public.sim_refresh('76258', (select sites from public.development_reports where zip='76258'), now() - interval '9 hours');
select public.sim_observe('76258');
select pg_temp.chk('S11 a repeated expanded refresh writes no false identity, event or classification',
  (select count(*) from public.dev_change_event) = :b_n_ev and (select count(*) from public.dev_change_recovery) = :b_n_rec);

-- ── 3. GENUINE SUBSEQUENT CHANGE IS PRESERVED ──────────────────────────────────────────────────────
select public.sim_refresh('76258', (select jsonb_agg(case when e->>'case_number' in ('R1','R2') then jsonb_set(e,'{stage}','"Final"') else e end)
                                      from public.development_reports d, jsonb_array_elements(d.sites) e where d.zip='76258'), now() - interval '8 hours');
select public.sim_observe('76258');
select pg_temp.chk('S12 a real publisher status change on a recovered record IS reported (material status_changed)',
  exists (select 1 from public.dev_change_event_reportable where identity_key='arcgis:fixture:R1' and event_type='status_changed' and material));
select pg_temp.chk('S13 R2 (stage already Final) emitted no change; R1 (Issued -> Final) did',
  pg_temp.rep('R2') = 0 and pg_temp.rep('R1') = 1);

-- ── 3b. A STAMPED RECORD THAT FIRST APPEARS IN A LATER GENERATION is also recovery (the stated product trade) ──
select public.sim_refresh('76258', (select sites from public.development_reports where zip='76258') || jsonb_build_array(public.sim_site('R11','Issued',(current_date - 1)::date, true, 'filed')), now() - interval '7 hours');
select public.sim_observe('76258');
select pg_temp.chk('S14 a stamped record first seen in a later generation is recorded, not announced as new',
  pg_temp.rep('R11') = 0 and (select count(*) from pg_temp.ev('R11')) = 1);
select public.sim_refresh('76258', (select jsonb_agg(case when e->>'case_number' = 'R11' then jsonb_set(e,'{stage}','"Final"') else e end)
                                      from public.development_reports d, jsonb_array_elements(d.sites) e where d.zip='76258'), now() - interval '6 hours');
select public.sim_observe('76258');
select pg_temp.chk('S15 …and its first genuine change IS announced',
  exists (select 1 from public.dev_change_event_reportable where identity_key='arcgis:fixture:R11' and event_type='status_changed' and material));

-- ── 4. SYNCHRONISATION AT OBSERVATION LEVEL (the probe runs only when a new identity must be classified) ──
-- 4a. the cache moved on (newer clock) and now holds a new stamped record; its row exists only from the PREVIOUS generation
update public.development_reports set refreshed_at = now() - interval '2 hours',
       sites = sites || jsonb_build_array(public.sim_site('R12','Issued','2021-05-05', true)) where zip='76258';
insert into public.app_projects (zip, name, type, status, stage, submitted_at, date_kind, record_kind, registry_id, provenance, source_key, source_key_basis, source_seq)
select '76258','Permit R12','Industrial','Proposed','Issued','2021-05-05','filed','development','fixture',
       jsonb_build_object('refreshed_at', now() - interval '5 hours'), public.app_source_key(public.sim_site('R12','Issued','2021-05-05', true)),
       public.app_source_key_basis(public.sim_site('R12','Issued','2021-05-05', true)), 1;
select (select count(*) from public.dev_change_event) as n_ev, (select count(*) from public.dev_change_project) as n_pr, (select count(*) from public.dev_change_recovery) as n_rc \gset c_
select public.sim_observe('76258') as res \gset d_
select pg_temp.chk('S16 a new identity whose rows are NOT from the current cache generation ⇒ status deferred, with the probe''s reason',
  (:'d_res'::jsonb)->>'status' = 'deferred' and (:'d_res'::jsonb)->>'reason' = 'rows_not_from_current_cache', :'d_res');
select pg_temp.chk('S17 a deferral writes NOTHING (no event, identity or classification)',
  (select count(*) from public.dev_change_event) = :c_n_ev and (select count(*) from public.dev_change_project) = :c_n_pr
  and (select count(*) from public.dev_change_recovery) = :c_n_rc);
select pg_temp.chk('S18 the ZIP-wide helper agrees', not public.dev_change_materialization_current('76258'));
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
-- materialise the current cache: the next observation classifies R12 and nothing was announced in between
select public.sim_refresh('76258', (select sites from public.development_reports where zip='76258'), (select refreshed_at from public.development_reports where zip='76258'));
select pg_temp.chk('S20 after materialisation the ZIP is synchronised', public.dev_change_materialization_current('76258'));
select public.sim_observe('76258');
select pg_temp.chk('S21 the previously-deferred stamped record was classified at first sighting: not news',
  pg_temp.rep('R12') = 0 and (select outcome from public.dev_change_recovery where identity_key='arcgis:fixture:R12') = 'coverage_recovered');

-- 4b. LAZY: a stale ZIP with NOTHING new to classify is observed normally (the probe is not on the ordinary path)
select public.sim_refresh('76258', (select sites from public.development_reports where zip='76258'), (select refreshed_at from public.development_reports where zip='76258') + interval '1 hour', false);
select pg_temp.chk('S22 precondition: the ZIP is now out of step', not public.dev_change_materialization_current('76258'));
select public.sim_observe('76258') as res \gset e_
select pg_temp.chk('S23 …yet an observation with no new identity is NOT deferred (ordinary observation pays nothing)',
  (:'e_res'::jsonb)->>'status' = 'ok', :'e_res');
select public.sim_refresh('76258', (select sites from public.development_reports where zip='76258'), (select refreshed_at from public.development_reports where zip='76258'));

-- 4c. ONE CURRENT ROW AND SEVERAL STALE ROWS plus a new identity ⇒ deferred
select public.sim_refresh('76260', jsonb_build_array(public.sim_site('M1','Issued','2024-01-01'), public.sim_site('M2','Issued','2024-01-02'),
                                                    public.sim_site('M3','Issued','2024-01-03')), now() - interval '20 hours');
select public.sim_observe('76260', true);
select public.sim_refresh('76260', (select sites from public.development_reports where zip='76260') || jsonb_build_array(public.sim_site('M4','Issued','2020-01-01', true)), now() - interval '4 hours');
select public.sim_set_generation('76260', pg_temp.k(array['M1','M2']), (now() - interval '19 hours')::text);     -- two rows stale, M3 + M4 current
select public.sim_observe('76260') as res \gset f_
select pg_temp.chk('S24 one new identity with its own row current but TWO other rows stale ⇒ deferred (the ZIP is not one generation)',
  (:'f_res'::jsonb)->>'status' = 'deferred' and (:'f_res'::jsonb)->>'reason' = 'rows_not_from_current_cache', :'f_res');
select pg_temp.chk('S25 …and it wrote nothing for that ZIP', not exists (select 1 from public.dev_change_project where identity_key = 'arcgis:fixture:M4'));
-- a missing generation on any row
select public.sim_refresh('76260', (select sites from public.development_reports where zip='76260'), (select refreshed_at from public.development_reports where zip='76260'));
select public.sim_set_generation('76260', pg_temp.k(array['M2']), null);
select public.sim_observe('76260') as res \gset g_
select pg_temp.chk('S26 a row with NO generation stamp ⇒ deferred (invalid_row_generation)',
  (:'g_res'::jsonb)->>'status' = 'deferred' and (:'g_res'::jsonb)->>'reason' = 'invalid_row_generation', :'g_res');
select public.sim_refresh('76260', (select sites from public.development_reports where zip='76260'), (select refreshed_at from public.development_reports where zip='76260'));
select public.sim_observe('76260') as res \gset h_
select pg_temp.chk('S27 once synchronised the stamped record is classified as recovery', (:'h_res'::jsonb)->>'status' = 'ok'
  and pg_temp.rep('M4') = 0 and exists (select 1 from public.dev_change_recovery where identity_key='arcgis:fixture:M4'), :'h_res');

-- ── 5. PROBE UNIT CASES (direct calls; ZIP 76261) ────────────────────────────────────────────────────
select public.sim_refresh('76261', jsonb_build_array(public.sim_site('P1','Issued','2024-01-01', true), public.sim_site('P2','Issued','2024-01-02'),
                                                    public.sim_site('P3','Issued','2024-01-03', true)), now() - interval '3 hours');
select * from public.dev_change_recovery_probe('76261', pg_temp.k(array['P1','P2'])) \gset p1_
select pg_temp.chk('P01 synchronised: ok, and ONLY the requested stamped key is returned', :'p1_synchronized'::boolean and :'p1_reason' = 'ok'
  and :'p1_stamped_keys' = '{arcgis:fixture:P1}', :'p1_reason' || ' ' || :'p1_stamped_keys');
select * from public.dev_change_recovery_probe('76261', '{}') \gset p2_
select pg_temp.chk('P02 with no keys requested the cache is never scanned for stamps', :'p2_synchronized'::boolean and :'p2_stamped_keys' = '{}');
select public.sim_set_generation('76261', pg_temp.k(array['P2','P3']), (now() - interval '40 hours')::text);
select * from public.dev_change_recovery_probe('76261', pg_temp.k(array['P1'])) \gset p3_
select pg_temp.chk('P03 ONE current row and TWO stale rows is NOT synchronised', not :'p3_synchronized'::boolean and :'p3_reason' = 'rows_not_from_current_cache'
  and :'p3_rows_stale'::int = 2 and :'p3_rows_total'::int = 3, :'p3_reason');
select public.sim_set_generation('76261', pg_temp.k(array['P2','P3']), (select to_char(refreshed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"+00:00"') from public.development_reports where zip='76261'));
select pg_temp.chk('P04 …and once every row carries the cache clock it is', public.dev_change_materialization_current('76261'));
select public.sim_set_generation('76261', pg_temp.k(array['P2']), 'not-a-timestamp');
select * from public.dev_change_recovery_probe('76261', pg_temp.k(array['P1'])) \gset p5_
select pg_temp.chk('P05 an unparsable generation fails closed (and does not raise)', not :'p5_synchronized'::boolean and :'p5_reason' = 'invalid_row_generation' and :'p5_rows_invalid'::int = 1);
select public.sim_set_generation('76261', pg_temp.k(array['P2']), '2026-02-31T00:00:00Z');
select * from public.dev_change_recovery_probe('76261', pg_temp.k(array['P1'])) \gset p6_
select pg_temp.chk('P06 an impossible calendar date in the stamp fails closed (and does not raise)', not :'p6_synchronized'::boolean and :'p6_reason' = 'invalid_row_generation');
select public.sim_set_generation('76261', pg_temp.k(array['P2']), null);
select pg_temp.chk('P07 a MISSING stamp fails closed', not public.dev_change_materialization_current('76261'));
select public.sim_refresh('76261', (select sites from public.development_reports where zip='76261'), (select refreshed_at from public.development_reports where zip='76261'));
select * from public.dev_change_recovery_probe('76261', pg_temp.k(array['P9'])) \gset p8_
select pg_temp.chk('P08 a requested identity that is not in the current generation is NOT synchronised',
  not :'p8_synchronized'::boolean and :'p8_reason' = 'requested_key_not_in_current_generation' and :'p8_keys_unmatched'::int = 1);
update public.development_reports set refreshed_at = refreshed_at + interval '1 hour' where zip='76261';
select pg_temp.chk('P09 a cache NEWER than its rows is NOT synchronised', not public.dev_change_materialization_current('76261'));
update public.development_reports set refreshed_at = refreshed_at - interval '2 hours' where zip='76261';
select * from public.dev_change_recovery_probe('76261', '{}') \gset p10_
select pg_temp.chk('P10 rows NEWER than the cache (a rewound cache) are NOT synchronised', not :'p10_synchronized'::boolean and :'p10_reason' = 'rows_not_from_current_cache');
update public.development_reports set refreshed_at = null where zip='76261';
select * from public.dev_change_recovery_probe('76261', '{}') \gset p11_
select pg_temp.chk('P11 a cache with no clock fails closed', not :'p11_synchronized'::boolean and :'p11_reason' = 'cache_clock_missing');
delete from public.development_reports where zip = '76261';
select * from public.dev_change_recovery_probe('76261', pg_temp.k(array['P1'])) \gset p12_
select pg_temp.chk('P12 no cache row ⇒ no stamps can exist ⇒ synchronised with no stamped keys', :'p12_synchronized'::boolean and :'p12_reason' = 'no_cache' and :'p12_stamped_keys' = '{}');

-- empty materialisation
select public.sim_refresh('76262', jsonb_build_array(public.sim_site('E1','Issued','2024-01-01', true)), now() - interval '3 hours', false);
select * from public.dev_change_recovery_probe('76262', '{}') \gset q1_
select pg_temp.chk('P13 an EMPTY materialisation of a cache that holds development records is NOT synchronised',
  not :'q1_synchronized'::boolean and :'q1_reason' = 'empty_materialisation_nonempty_cache' and :'q1_rows_total'::int = 0);
select public.sim_refresh('76263', jsonb_build_array(jsonb_build_object('relevance','facility','scope','point','record_url','https://example.test/f','source_registry_id','epa')), now() - interval '3 hours', false);
select pg_temp.chk('P14 an empty materialisation of a cache with NO development content IS synchronised', public.dev_change_materialization_current('76263'));
select public.sim_refresh('76264', '[]'::jsonb, now() - interval '3 hours', false);
select pg_temp.chk('P15 an empty materialisation of an empty cache IS synchronised', public.dev_change_materialization_current('76264'));

-- structure: the probe is ONE statement with ONE snapshot (STABLE SQL function; a plpgsql body would take a snapshot per statement)
select pg_temp.chk('P16 the probe is a STABLE SQL function (one statement, one snapshot)',
  (select p.provolatile = 's' and l.lanname = 'sql' from pg_proc p join pg_language l on l.oid = p.prolang where p.proname = 'dev_change_recovery_probe'));
select pg_temp.chk('P17 …and it is SECURITY DEFINER with a pinned search_path',
  (select p.prosecdef and p.proconfig::text like '%search_path=public, pg_temp%' from pg_proc p where p.proname = 'dev_change_recovery_probe'));

-- cost pin: with no requested keys the stamped-element scan must not run (results are identical either way, so only the source shows it)
select pg_temp.chk('P18 the stamped scan is guarded by "keys were requested" (no full-cache scan when nothing is new)',
  (select pg_get_functiondef(p.oid) ~ 'reason = ''ok'' and \(select k\.requested from k\) > 0' from pg_proc p where p.proname = 'dev_change_recovery_probe'));

-- ── 6. DISABLE → legacy refresh → the recovered rows lapse; no event is invented ─────────────────
select (select count(*) from public.dev_change_event) as n_ev \gset k_
select public.sim_refresh('76258', jsonb_build_array(public.sim_site('L1','Issued','2024-03-01'), public.sim_site('L2','Issued','2024-04-01'),
   public.sim_site('L3','Issued','2024-05-01'), public.sim_site('G1','Issued',(current_date-3)::date), public.sim_site('G2','Issued','2020-01-01')), now() - interval '1 hours');
select public.sim_observe('76258');
select pg_temp.chk('S28 mode OFF + legacy refresh: recovered rows are gone from app_projects',
  not exists (select 1 from public.app_projects where zip='76258' and source_key like 'arcgis:fixture:R%'));
select pg_temp.chk('S29 …the ledger keeps their history (absence is never an event) and writes nothing for the lapse',
  (select count(*) from public.dev_change_project where identity_key like 'arcgis:fixture:R%') = 12
  and (select count(*) from public.dev_change_event) = :k_n_ev);
select public.sim_refresh('76258', (select jsonb_agg(e) from (
   select public.sim_site('L1','Issued','2024-03-01') e union all select public.sim_site('R1','Final','2023-02-10', true, 'filed')
   union all select public.sim_site('R4','Issued',(current_date - 10)::date, true, 'filed')) q), now());
select public.sim_observe('76258');
select pg_temp.chk('S30 re-enable: already-known recovered identities are not announced again and not re-classified',
  pg_temp.rep('R4') = 0 and (select count(*) from pg_temp.ev('R4')) = 1 and pg_temp.rep('R1') = 1
  and (select count(*) from public.dev_change_recovery where zip = '76258') = 12);

-- ── 7. A BASELINE RUN IS UNTOUCHED ────────────────────────────────────────────────────────────────
select public.sim_refresh('76259', jsonb_build_array(public.sim_site('B1','Issued','2019-01-01', true)), now() - interval '1 hours');
select public.sim_observe('76259', true);
select pg_temp.chk('S31 a baseline run classifies nothing (it already writes non-reportable first sightings)',
  not exists (select 1 from public.dev_change_recovery where zip='76259') and pg_temp.rep('B1') = 0
  and (select is_baseline from pg_temp.ev('B1') limit 1));

-- ── 8. SAFETY ──────────────────────────────────────────────────────────────────────────────────────
select pg_temp.chk('S32 new objects are not reachable by anon/authenticated',
  not has_function_privilege('anon','public.dev_change_recovery_probe(text,text[])','execute')
  and not has_function_privilege('authenticated','public.dev_change_materialization_current(text)','execute')
  and not has_table_privilege('anon','public.dev_change_recovery','select')
  and not has_table_privilege('authenticated','public.dev_change_recovery','insert'));
select pg_temp.chk('S33 the audit table is RLS-protected',
  (select relrowsecurity from pg_class where oid='public.dev_change_recovery'::regclass));
select pg_temp.chk('S34 events stay immutable', (select count(*) from pg_trigger where tgrelid='public.dev_change_event'::regclass and not tgisinternal) >= 1);
select pg_temp.chk('S35 the rule no longer carries a date window: no news_days function exists',
  to_regprocedure('public.dev_change_recovery_news_days()') is null and public.dev_change_recovery_rule_version() = 2);

select name||'|'||case when ok then 't' else 'f' end||'|'||detail from res order by name;
