-- Executable scenarios for docs/dev-change-recovery.sql (rule_version 4: receipts, per ZIP x source x scope version) on a DISPOSABLE Postgres (never production).
-- ZIP 76258 stands for any ZIP; nothing in the SQL under test names one.
\set ON_ERROR_STOP 0
create temp table res(name text, ok boolean, detail text);
create or replace function pg_temp.chk(n text, ok boolean, d text default '') returns void language sql as
$$ insert into res values (n, coalesce(ok,false), d) $$;
create or replace function pg_temp.ev(p_key text) returns table (material boolean, is_baseline boolean, event_type text)
language sql as $$ select material, is_baseline, event_type from public.dev_change_event where identity_key = 'arcgis:fixture:' || p_key order by id $$;
create or replace function pg_temp.rep(p_key text) returns int language sql as
$$ select count(*)::int from public.dev_change_event_reportable where identity_key = 'arcgis:fixture:' || p_key $$;
create or replace function pg_temp.unhealthy(p_zip text, p_reg text) returns boolean language sql as
$$ select exists (select 1 from public.dev_change_scope_health h where h.zip = p_zip and h.registry_id = p_reg
                   and h.monitoring_state in ('suspended','failed_or_incomplete','legacy_scope_fallback','source_not_reported','no_accepted_generation_evidence')) $$;
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

select pg_temp.chk('T01 the first complete expanded receipt made the pair READY at its scope version (and only that pair)',
  (select count(*) from public.dev_change_scope_ready where zip='76258' and registry_id='fixture' and lapsed_at is null and scope_version='v1:A') = 1
  and (select count(*) from public.dev_change_scope_ready where zip='76258') = 1);

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

-- ── 3b. AFTER THE VERIFIED BASELINE a stamped record that is NEW is a genuine arrival: ordinary first detection ──
-- Whatever its date: a RECENT filing and a 2019 one are alike (no date decides), and neither is "recovery".
select public.sim_refresh('76258', (select sites from public.development_reports where zip='76258') || jsonb_build_array(
   public.sim_site('R11','Issued',(current_date - 1)::date, true, 'filed'),
   public.sim_site('R11b','Issued','2019-04-04', true, 'filed')), now() - interval '7 hours');
select public.sim_observe('76258') as res \gset r11_
select pg_temp.chk('S14 a stamped record new AFTER the baseline is announced as a first detection (material, reportable) whatever its date',
  pg_temp.rep('R11') = 1 and pg_temp.rep('R11b') = 1
  and not exists (select 1 from public.dev_change_recovery where identity_key in ('arcgis:fixture:R11','arcgis:fixture:R11b'))
  and (select count(*) from pg_temp.ev('R11') where material and not is_baseline and event_type='first_detected') = 1, :'r11_res');
select public.sim_refresh('76258', (select jsonb_agg(case when e->>'case_number' = 'R11' then jsonb_set(e,'{stage}','"Final"') else e end)
                                      from public.development_reports d, jsonb_array_elements(d.sites) e where d.zip='76258'), now() - interval '6 hours');
select public.sim_observe('76258');
select pg_temp.chk('S15 …and its later genuine change IS announced',
  exists (select 1 from public.dev_change_event_reportable where identity_key='arcgis:fixture:R11' and event_type='status_changed' and material));

-- ── 4. SYNCHRONISATION AT OBSERVATION LEVEL (the probe runs only when a new identity must be classified) ──
-- 4a. the cache moved on (newer clock) and now holds a new stamped record; its row exists only from the PREVIOUS generation
select public.sim_refresh('76258', (select sites from public.development_reports where zip='76258') || jsonb_build_array(public.sim_site('R12','Issued','2021-05-05', true)),
                          now() - interval '2 hours', false);
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
select pg_temp.chk('S21 the previously-deferred stamped record is a genuine arrival (the pair was already verified): announced once',
  pg_temp.rep('R12') = 1 and not exists (select 1 from public.dev_change_recovery where identity_key='arcgis:fixture:R12'));

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
select pg_temp.chk('S27 once synchronised, the FIRST stamped record of a pair with no baseline is the baseline: recovery, and the pair becomes READY',
  (:'h_res'::jsonb)->>'status' = 'ok'
  and pg_temp.rep('M4') = 0 and exists (select 1 from public.dev_change_recovery where identity_key='arcgis:fixture:M4')
  and exists (select 1 from public.dev_change_scope_ready where zip='76260' and registry_id='fixture' and lapsed_at is null), :'h_res');

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
  (select pg_get_functiondef(p.oid) ~ 'coalesce\(p_scan, false\) or \(select k\.requested from k\) > 0' from pg_proc p where p.proname = 'dev_change_recovery_probe'));
select public.sim_refresh('76265', jsonb_build_array(public.sim_site('Q1','Issued','2024-01-01', true, null, 'qa'), public.sim_site('Q2','Issued','2024-01-01', false, null, 'qb')), now() - interval '3 hours',
   true, '[{"reg":"qa","scope":"expanded","complete":true},{"reg":"qb","scope":"fallback","complete":false}]'::jsonb);
select * from public.dev_change_recovery_probe('76265', '{}', true) \gset p19_
select * from public.dev_change_recovery_probe('76265', '{}', false) \gset p20_
select pg_temp.chk('P19 p_scan returns one entry per source with a receipt for THIS generation; without it the receipts are not read',
  (select count(*) from jsonb_array_elements(:'p19_sources'::jsonb)) = 2 and :'p20_sources' = '[]'
  and (select e->>'scope' from jsonb_array_elements(:'p19_sources'::jsonb) e where e->>'reg'='qb') = 'fallback');
select pg_temp.chk('P20 a source with no baseline is never "continuous", whatever its receipt',
  not exists (select 1 from jsonb_array_elements(:'p19_sources'::jsonb) e where (e->>'continuous')::boolean));

-- ── 6. SCOPE FALLS BACK (mode off / RPC fallback) → readiness lapses → coverage returns: re-baselined, never mis-announced ──
select (select count(*) from public.dev_change_event) as n_ev, (select count(*) from public.dev_change_project where identity_key like 'arcgis:fixture:R%') as n_r \gset k_
select public.sim_refresh('76258', jsonb_build_array(public.sim_site('L1','Issued','2024-03-01'), public.sim_site('L2','Issued','2024-04-01'),
   public.sim_site('L3','Issued','2024-05-01'), public.sim_site('G1','Issued',(current_date-3)::date), public.sim_site('G2','Issued','2020-01-01')), now() - interval '1 hours',
   true, '[{"reg":"fixture","scope":"legacy","complete":true}]'::jsonb);
select public.sim_observe('76258') as res \gset lp_
select pg_temp.chk('S28 mode OFF / fallback to the legacy scope: recovered rows are gone from app_projects',
  not exists (select 1 from public.app_projects where zip='76258' and source_key like 'arcgis:fixture:R%'));
select pg_temp.chk('S29 …the ledger keeps their history, writes no event for the lapse, and the pair is no longer READY (the widening is not evidenced)',
  (select count(*) from public.dev_change_project where identity_key like 'arcgis:fixture:R%') = :k_n_r
  and (select count(*) from public.dev_change_event) = :k_n_ev
  and not exists (select 1 from public.dev_change_scope_ready where zip='76258' and lapsed_at is null)
  and ((:'lp_res'::jsonb)->>'scope_ready_suspended')::int = 1, :'lp_res');
select public.sim_refresh('76258', (select jsonb_agg(e) from (
   select public.sim_site('L1','Issued','2024-03-01') e union all select public.sim_site('R1','Final','2023-02-10', true, 'filed')
   union all select public.sim_site('R4','Issued',(current_date - 10)::date, true, 'filed')
   union all select public.sim_site('N1','Issued',(current_date - 2)::date, true, 'filed')) q), now());
select public.sim_observe('76258') as res \gset re_
select pg_temp.chk('S30 re-enable: known identities are not announced again; a record that appeared during the gap is NOT claimed as genuine (baselined silently); the pair is READY again',
  pg_temp.rep('R4') = 0 and (select count(*) from pg_temp.ev('R4')) = 1 and pg_temp.rep('R1') = 1
  and pg_temp.rep('N1') = 0 and exists (select 1 from public.dev_change_recovery where identity_key='arcgis:fixture:N1')
  and exists (select 1 from public.dev_change_scope_ready where zip='76258' and registry_id='fixture' and lapsed_at is null), :'re_res');
select public.sim_refresh('76258', (select sites from public.development_reports where zip='76258') || jsonb_build_array(public.sim_site('N2','Issued',(current_date - 1)::date, true, 'filed')), now() + interval '1 second');
select public.sim_observe('76258');
select pg_temp.chk('S30b …and a record new AFTER the re-established baseline is announced again', pg_temp.rep('N2') = 1);

-- ── 7. A BASELINE RUN IS UNTOUCHED ────────────────────────────────────────────────────────────────
select public.sim_refresh('76259', jsonb_build_array(public.sim_site('B1','Issued','2019-01-01', true)), now() - interval '1 hours');
select public.sim_observe('76259', true);
select pg_temp.chk('S31 a baseline run classifies nothing (it already writes non-reportable first sightings)',
  not exists (select 1 from public.dev_change_recovery where zip='76259') and pg_temp.rep('B1') = 0
  and (select is_baseline from pg_temp.ev('B1') limit 1));

-- ── 8. SAFETY ──────────────────────────────────────────────────────────────────────────────────────
select pg_temp.chk('S32 new objects are not reachable by anon/authenticated',
  not has_function_privilege('anon','public.dev_change_recovery_probe(text,text[],boolean)','execute')
  and not has_table_privilege('anon','public.dev_change_scope_ready','select') and not has_table_privilege('authenticated','public.dev_change_scope_ready','update')
  and not has_function_privilege('authenticated','public.dev_change_materialization_current(text)','execute')
  and not has_table_privilege('anon','public.dev_change_recovery','select')
  and not has_table_privilege('authenticated','public.dev_change_recovery','insert'));
select pg_temp.chk('S33 the audit and readiness tables are RLS-protected',
  (select relrowsecurity from pg_class where oid='public.dev_change_recovery'::regclass)
  and (select relrowsecurity from pg_class where oid='public.dev_change_scope_ready'::regclass));
select pg_temp.chk('S34 events stay immutable', (select count(*) from pg_trigger where tgrelid='public.dev_change_event'::regclass and not tgisinternal) >= 1);
select pg_temp.chk('S35 the rule no longer carries a date window: no news_days function exists',
  to_regprocedure('public.dev_change_recovery_news_days()') is null and public.dev_change_recovery_rule_version() = 5);

-- ── 9. INCOMPLETE OR FAILED SOURCE: cannot establish readiness, and nothing is inferred ─────────────────────────────
select public.sim_refresh('76290', jsonb_build_array(public.sim_site('U0','Issued','2024-01-01')), now() - interval '30 hours');
select public.sim_observe('76290', true);
select public.sim_refresh('76290', jsonb_build_array(public.sim_site('U0','Issued','2024-01-01'),
   public.sim_site('X1','Issued','2023-01-01', true, 'filed', 'fx'), public.sim_site('X2','Issued','2023-01-02', true, 'filed', 'fy')), now() - interval '10 hours',
   true, '[{"reg":"fx","scope":"expanded","complete":false},{"reg":"fy","scope":"expanded","complete":true}]'::jsonb);   -- fx truncated in THIS generation
select public.sim_observe('76290') as res \gset u_
select pg_temp.chk('U01 a stamped record of an INCOMPLETE source is HELD: no identity, no event, no audit row',
  not exists (select 1 from public.dev_change_project where identity_key='arcgis:fixture:X1') and (select count(*) from pg_temp.ev('X1')) = 0
  and ((:'u_res'::jsonb)->>'coverage_held')::int = 1, :'u_res');
select pg_temp.chk('U02 …and that source did NOT become ready, while the complete source in the same ZIP did and its record is the baseline',
  not exists (select 1 from public.dev_change_scope_ready where zip='76290' and registry_id='fx' and baseline_gen_seq is not null)
  and exists (select 1 from public.dev_change_scope_ready where zip='76290' and registry_id='fy' and lapsed_at is null and baseline_gen_seq is not null)
  and exists (select 1 from public.dev_change_recovery where identity_key='arcgis:fixture:X2') and pg_temp.rep('X2') = 0);
select pg_temp.chk('U02b the incomplete source is explicitly UNHEALTHY in the report view',
  exists (select 1 from public.dev_change_scope_health where zip='76290' and registry_id='fx' and scope='expanded' and not complete
          and monitoring_state = 'failed_or_incomplete' and held_observations = 1)
  and not pg_temp.unhealthy('76290', 'fy'));
select public.sim_refresh('76290', (select sites from public.development_reports where zip='76290'), now() - interval '8 hours');   -- next generation: complete
select public.sim_observe('76290');
select pg_temp.chk('U03 the next COMPLETE read baselines the held record silently and makes the source READY',
  exists (select 1 from public.dev_change_recovery where identity_key='arcgis:fixture:X1') and pg_temp.rep('X1') = 0
  and exists (select 1 from public.dev_change_scope_ready where zip='76290' and registry_id='fx' and lapsed_at is null and baseline_gen_seq is not null));
select pg_temp.chk('U03b …and it leaves the unhealthy list',
  not pg_temp.unhealthy('76290', 'fx'));
-- a FAILED fetch and a FALLBACK are as disqualifying as truncation
select public.sim_refresh('76291', jsonb_build_array(public.sim_site('V0','Issued','2024-01-01')), now() - interval '30 hours');
select public.sim_observe('76291', true);
select public.sim_refresh('76291', jsonb_build_array(public.sim_site('V0','Issued','2024-01-01'),
   public.sim_site('Y1','Issued','2023-01-01', true, 'filed', 'fz'), public.sim_site('Y2','Issued','2023-01-02', true, 'filed', 'fw'), public.sim_site('Y3','Issued','2023-01-03', true, 'filed', 'fv')),
   now() - interval '10 hours', true,
   '[{"reg":"fz","scope":"failed","complete":false},{"reg":"fw","scope":"expanded","complete":true},{"reg":"fv","scope":"fallback","complete":false}]'::jsonb);
select public.sim_observe('76291');
select pg_temp.chk('U04 failed and fallback sources hold their records; the healthy source in the same ZIP baselines',
  not exists (select 1 from public.dev_change_project where identity_key in ('arcgis:fixture:Y1','arcgis:fixture:Y3'))
  and exists (select 1 from public.dev_change_scope_ready where zip='76291' and registry_id='fw'));
-- NO RECEIPT AT ALL (the receipt feature absent, or the response lost): fail closed
select public.sim_refresh('76292', jsonb_build_array(public.sim_site('W0','Issued','2024-01-01')), now() - interval '30 hours');
select public.sim_observe('76292', true);
select public.sim_refresh('76292', jsonb_build_array(public.sim_site('W0','Issued','2024-01-01'), public.sim_site('W1','Issued','2023-01-01', true, 'filed', 'fq')), now() - interval '10 hours', true, '[]'::jsonb);
select public.sim_observe('76292') as res \gset w0_
select pg_temp.chk('U05 a stamped record with NO receipt is HELD (the absence of evidence is not evidence of completeness)',
  not exists (select 1 from public.dev_change_project where identity_key='arcgis:fixture:W1') and ((:'w0_res'::jsonb)->>'coverage_held')::int = 1
  and not exists (select 1 from public.dev_change_scope_ready where zip='76292' and baseline_gen_seq is not null)
  and exists (select 1 from public.dev_change_scope_health where zip='76292' and registry_id='fq' and monitoring_state = 'no_accepted_generation_evidence'), :'w0_res');

-- ── 10. FALLBACK DURING THE FIRST EXPANSION cannot establish readiness ───────────────────────────────────────────────
select public.sim_refresh('76296', jsonb_build_array(public.sim_site('F0','Issued','2024-01-01')), now() - interval '30 hours');
select public.sim_observe('76296', true);
select public.sim_refresh('76296', jsonb_build_array(public.sim_site('F0','Issued','2024-01-01'), public.sim_site('F1','Issued','2024-02-01')), now() - interval '5 hours',
   true, '[{"reg":"fixture","scope":"fallback","complete":false}]'::jsonb);
select public.sim_observe('76296');
select pg_temp.chk('U08 a fallback generation establishes no readiness; unstamped behaviour is the legacy one',
  not exists (select 1 from public.dev_change_scope_ready where zip='76296') and pg_temp.rep('F1') = 1);

-- ── 11. IDENTICAL SOURCE KEYS ACROSS NEIGHBOURING ZIPs generate no false new event (test 7) ───────────────────────────
select public.sim_refresh('76281', jsonb_build_array(public.sim_site('N0','Issued','2024-01-01')), now() - interval '40 hours');
select public.sim_observe('76281', true);
select public.sim_refresh('76282', jsonb_build_array(public.sim_site('N0b','Issued','2024-01-01')), now() - interval '40 hours');
select public.sim_observe('76282', true);
select public.sim_refresh('76283', jsonb_build_array(public.sim_site('N0c','Issued','2024-01-01')), now() - interval '40 hours');
select public.sim_observe('76283', true);
select public.sim_refresh('76281', jsonb_build_array(public.sim_site('N0','Issued','2024-01-01'), public.sim_site('Z1','Issued','2022-02-02', true, 'filed', 'fn')), now() - interval '20 hours');
select public.sim_refresh('76282', jsonb_build_array(public.sim_site('N0b','Issued','2024-01-01'), public.sim_site('Z1','Issued','2022-02-02', true, 'filed', 'fn')), now() - interval '20 hours');
select public.sim_observe('76281');
select public.sim_observe('76282');
select pg_temp.chk('Z01 the same stamped key in two neighbouring ZIPs is ONE identity and ONE silent baseline event, never a second',
  (select count(*) from pg_temp.ev('Z1')) = 1 and pg_temp.rep('Z1') = 0
  and exists (select 1 from public.dev_change_scope_ready where zip='76281' and registry_id='fn' and lapsed_at is null)
  and exists (select 1 from public.dev_change_scope_ready where zip='76282' and registry_id='fn' and lapsed_at is null));
select public.sim_refresh('76281', (select sites from public.development_reports where zip='76281') || jsonb_build_array(public.sim_site('Z2','Issued',(current_date - 1)::date, true, 'filed', 'fn')), now() - interval '10 hours');
select public.sim_refresh('76282', (select sites from public.development_reports where zip='76282') || jsonb_build_array(public.sim_site('Z2','Issued',(current_date - 1)::date, true, 'filed', 'fn')), now() - interval '10 hours');
select public.sim_observe('76281');
select public.sim_observe('76282');
select pg_temp.chk('Z02 a genuine arrival visible from two ready neighbours is announced exactly ONCE',
  (select count(*) from pg_temp.ev('Z2') where event_type='first_detected') = 1 and pg_temp.rep('Z2') = 1);
select public.sim_refresh('76283', (select sites from public.development_reports where zip='76283') || jsonb_build_array(public.sim_site('Z3','Issued',(current_date - 1)::date, true, 'filed', 'fn')), now() - interval '10 hours');
select public.sim_observe('76283');
select pg_temp.chk('Z03 readiness is per ZIP: a source ready in a NEIGHBOUR is not ready here — the first stamped record is a baseline',
  pg_temp.rep('Z3') = 0 and exists (select 1 from public.dev_change_recovery where identity_key='arcgis:fixture:Z3'));

-- ── 12. ONE SHARED RULE: nothing in the shipped functions names a ZIP or a source (test 9) ───────────────────────────
select pg_temp.chk('X01 no 5-digit ZIP literal and no source id in the probe or the spliced observation',
  not exists (select 1 from pg_proc p where p.proname in ('dev_change_recovery_probe','dev_change_observe_zip','dev_change_tick','dev_change_materialization_current')
                and (pg_get_functiondef(p.oid) ~ '''[0-9]{5}''' or pg_get_functiondef(p.oid) ~* 'fixture|arcgis:'))
  and (select count(*) from pg_proc where proname = 'dev_change_observe_zip' and prosrc like '%dev_change_scope_ready%') = 1);

-- ── 13. EMPTY EXPANDED COVERAGE: a complete expanded read with ZERO widened-only records baselines the pair ───────────────
create or replace function pg_temp.cache(p_zip text) returns jsonb language sql as $$ select sites from public.development_reports where zip = p_zip $$;
create or replace function pg_temp.ready(p_zip text, p_reg text) returns text language sql as
$$ select coalesce((select scope_version || case when lapsed_at is null then '' else '(suspended)' end from public.dev_change_scope_ready where zip = p_zip and registry_id = p_reg and baseline_gen_seq is not null), '(none)') $$;
select public.sim_refresh('76300', jsonb_build_array(public.sim_site('nE0','Issued','2024-01-01')), now() - interval '40 hours');
select public.sim_observe('76300', true);
select public.sim_refresh('76300', pg_temp.cache('76300'), now() - interval '30 hours', true, '[{"reg":"fixture","scope":"expanded","complete":true}]'::jsonb);   -- NO ring records
select public.sim_observe('76300') as res \gset e1_
select pg_temp.chk('E01 an EMPTY ring read completely under the expanded scope establishes the baseline (no stamped record needed)',
  pg_temp.ready('76300','fixture') = 'v1:A' and ((:'e1_res'::jsonb)->>'scope_ready_verified')::int = 1
  and (select count(*) from public.dev_change_event_reportable where identity_key like 'arcgis:fixture:nE%') = 0, :'e1_res');
select public.sim_refresh('76300', pg_temp.cache('76300') || jsonb_build_array(public.sim_site('nE1','Issued',(current_date - 1)::date, true, 'filed')), now() - interval '20 hours');
select public.sim_observe('76300');
select pg_temp.chk('E02 the FIRST record to arrive after an empty baseline is announced (material first detection)',
  pg_temp.rep('nE1') = 1 and not exists (select 1 from public.dev_change_recovery where identity_key = 'arcgis:fixture:nE1'));
select public.sim_refresh('76300', pg_temp.cache('76300') || jsonb_build_array(public.sim_site('nE2','Issued','2015-06-01', true, 'filed')), now() - interval '10 hours');
select public.sim_observe('76300');
select pg_temp.chk('E03 …and an OLD-dated arrival is announced too: no date decides', pg_temp.rep('nE2') = 1);

-- ── 14. MULTI-SOURCE ZIP: every source is established, maintained, suspended and re-established ON ITS OWN ────────────────
select public.sim_refresh('76301', jsonb_build_array(public.sim_site('nM0','Issued','2024-01-01')), now() - interval '60 hours');
select public.sim_observe('76301', true);
select public.sim_refresh('76301', jsonb_build_array(public.sim_site('nM0','Issued','2024-01-01'), public.sim_site('nA1','Issued','2023-01-01', true, 'filed', 'sa'),
   public.sim_site('nB1','Issued','2023-01-02', true, 'filed', 'sb'), public.sim_site('nC1','Issued','2023-01-03', true, 'filed', 'sc')), now() - interval '50 hours');
select public.sim_observe('76301');
select pg_temp.chk('M01 three sources are baselined together, silently, each with its own readiness row',
  pg_temp.ready('76301','sa') = 'v1:A' and pg_temp.ready('76301','sb') = 'v1:A' and pg_temp.ready('76301','sc') = 'v1:A'
  and pg_temp.rep('nA1') = 0 and pg_temp.rep('nB1') = 0 and pg_temp.rep('nC1') = 0);
-- B falls back while A and C stay healthy and each gain a record
select public.sim_refresh('76301', jsonb_build_array(public.sim_site('nM0','Issued','2024-01-01'), public.sim_site('nA1','Issued','2023-01-01', true, 'filed', 'sa'),
   public.sim_site('nA2','Issued',(current_date-1)::date, true, 'filed', 'sa'), public.sim_site('nC1','Issued','2023-01-03', true, 'filed', 'sc'),
   public.sim_site('nC2','Issued',(current_date-1)::date, true, 'filed', 'sc')), now() - interval '40 hours',
   true, '[{"reg":"sa","scope":"expanded","complete":true},{"reg":"sb","scope":"fallback","complete":false},{"reg":"sc","scope":"expanded","complete":true}]'::jsonb);
select public.sim_observe('76301') as res \gset m2_
select pg_temp.chk('M02 A and C keep their baselines and announce their new arrivals while B falls back',
  pg_temp.rep('nA2') = 1 and pg_temp.rep('nC2') = 1, :'m2_res');
select pg_temp.chk('M03 B alone is SUSPENDED (its baseline is not kept ready by A or C) and listed as unhealthy',
  pg_temp.ready('76301','sb') = 'v1:A(suspended)' and pg_temp.ready('76301','sa') = 'v1:A' and pg_temp.ready('76301','sc') = 'v1:A'
  and ((:'m2_res'::jsonb)->>'scope_ready_suspended')::int = 1
  and exists (select 1 from public.dev_change_scope_health where zip='76301' and registry_id='sb' and baseline_suspended and scope='fallback' and monitoring_state = 'suspended')
  and not pg_temp.unhealthy('76301', 'sa') and not pg_temp.unhealthy('76301', 'sc'));
-- B returns with a NEW record published during its gap, while A also gains one
select public.sim_refresh('76301', pg_temp.cache('76301') || jsonb_build_array(public.sim_site('nB2','Issued','2022-01-02', true, 'filed', 'sb'),
   public.sim_site('nB1','Issued','2023-01-02', true, 'filed', 'sb'), public.sim_site('nA3','Issued',(current_date-1)::date, true, 'filed', 'sa')), now() - interval '30 hours');
select public.sim_observe('76301');
select pg_temp.chk('M04 B returns: its record new across the gap (B2) is BASELINED silently, its known B1 is not re-announced; A3 is still news',
  pg_temp.rep('nB2') = 0 and exists (select 1 from public.dev_change_recovery where identity_key='arcgis:fixture:nB2')
  and (select count(*) from pg_temp.ev('nB1')) = 1 and pg_temp.rep('nA3') = 1);
select pg_temp.chk('M05 B is READY again, re-established at this generation; the unhealthy list is empty',
  pg_temp.ready('76301','sb') = 'v1:A' and not pg_temp.unhealthy('76301','sa') and not pg_temp.unhealthy('76301','sb') and not pg_temp.unhealthy('76301','sc'));
select public.sim_refresh('76301', pg_temp.cache('76301') || jsonb_build_array(public.sim_site('nB3','Issued',(current_date-1)::date, true, 'filed', 'sb')), now() - interval '20 hours');
select public.sim_observe('76301');
select pg_temp.chk('M06 after the re-established baseline B3 is announced', pg_temp.rep('nB3') = 1);
-- A truncated, C healthy
select public.sim_refresh('76301', pg_temp.cache('76301') || jsonb_build_array(public.sim_site('nA4','Issued',(current_date-1)::date, true, 'filed', 'sa'),
   public.sim_site('nC3','Issued',(current_date-1)::date, true, 'filed', 'sc')), now() - interval '10 hours',
   true, '[{"reg":"sa","scope":"expanded","complete":false},{"reg":"sb","scope":"expanded","complete":true},{"reg":"sc","scope":"expanded","complete":true}]'::jsonb);
select public.sim_observe('76301') as res \gset m7_
select pg_temp.chk('M07 A truncated: A4 is HELD and A is suspended; C3 (healthy source) is announced; B is untouched',
  not exists (select 1 from public.dev_change_project where identity_key='arcgis:fixture:nA4') and pg_temp.rep('nC3') = 1
  and pg_temp.ready('76301','sa') = 'v1:A(suspended)' and pg_temp.ready('76301','sb') = 'v1:A' and ((:'m7_res'::jsonb)->>'coverage_held')::int = 1, :'m7_res');
select public.sim_refresh('76301', pg_temp.cache('76301'), now() - interval '5 hours');
select public.sim_observe('76301');
select pg_temp.chk('M08 A complete again: the record held across the break (A4) is baselined silently, not announced; A is READY',
  pg_temp.rep('nA4') = 0 and exists (select 1 from public.dev_change_recovery where identity_key='arcgis:fixture:nA4') and pg_temp.ready('76301','sa') = 'v1:A');

-- ── 15. SCOPE / CONFIGURATION CHANGE: a different scope version is a different baseline ──────────────────────────────
select public.sim_refresh('76302', jsonb_build_array(public.sim_site('nS0','Issued','2024-01-01')), now() - interval '40 hours');
select public.sim_observe('76302', true);
select public.sim_refresh('76302', jsonb_build_array(public.sim_site('nS0','Issued','2024-01-01'), public.sim_site('nS1','Issued','2022-01-01', true, 'filed')), now() - interval '30 hours');
select public.sim_observe('76302');
select public.sim_refresh('76302', pg_temp.cache('76302') || jsonb_build_array(public.sim_site('nS2','Issued','2022-01-02', true, 'filed')), now() - interval '20 hours',
   true, '[{"reg":"fixture","scope":"expanded","complete":true,"ver":"v1:B"}]'::jsonb);                      -- the envelope / rule changed
select public.sim_observe('76302');
select pg_temp.chk('V01 a CHANGED scope version re-baselines: the record that appears with it is silent and the baseline moves to the new version',
  pg_temp.rep('nS2') = 0 and exists (select 1 from public.dev_change_recovery where identity_key='arcgis:fixture:nS2') and pg_temp.ready('76302','fixture') = 'v1:B');
select public.sim_refresh('76302', pg_temp.cache('76302') || jsonb_build_array(public.sim_site('nS3','Issued','2022-01-03', true, 'filed')), now() - interval '10 hours',
   true, '[{"reg":"fixture","scope":"expanded","complete":true,"ver":"v1:B"}]'::jsonb);
select public.sim_observe('76302');
select pg_temp.chk('V02 …and the next arrival under the new version is news', pg_temp.rep('nS3') = 1);

-- ── 16. OFF / ON CYCLES and successful reactivation ───────────────────────────────────────────────────────────────────
select public.sim_refresh('76303', jsonb_build_array(public.sim_site('nO0','Issued','2024-01-01')), now() - interval '90 hours');
select public.sim_observe('76303', true);
select public.sim_refresh('76303', jsonb_build_array(public.sim_site('nO0','Issued','2024-01-01'), public.sim_site('nO1','Issued','2022-01-01', true, 'filed')), now() - interval '80 hours');
select public.sim_observe('76303');
select public.sim_refresh('76303', jsonb_build_array(public.sim_site('nO0','Issued','2024-01-01')), now() - interval '70 hours', true, '[{"reg":"fixture","scope":"legacy","complete":true}]'::jsonb);
select public.sim_observe('76303');
select public.sim_refresh('76303', jsonb_build_array(public.sim_site('nO0','Issued','2024-01-01'), public.sim_site('nO9','Issued','2024-02-02')), now() - interval '60 hours', true, '[{"reg":"fixture","scope":"legacy","complete":true}]'::jsonb);
select public.sim_observe('76303');
select pg_temp.chk('F01 OFF twice: the baseline is suspended, nothing is invented, and an UNSTAMPED arrival while OFF is still news (legacy behaviour)',
  pg_temp.ready('76303','fixture') = 'v1:A(suspended)' and pg_temp.rep('nO9') = 1 and pg_temp.rep('nO1') = 0);
select public.sim_refresh('76303', jsonb_build_array(public.sim_site('nO0','Issued','2024-01-01'), public.sim_site('nO9','Issued','2024-02-02'), public.sim_site('nO1','Issued','2022-01-01', true, 'filed'),
   public.sim_site('nO2','Issued',(current_date - 1)::date, true, 'filed')), now() - interval '50 hours');
select public.sim_observe('76303');
select pg_temp.chk('F02 ON again: the known ring record is not re-announced; the record new across the OFF window is baselined silently; the pair is READY',
  (select count(*) from pg_temp.ev('nO1')) = 1 and pg_temp.rep('nO2') = 0 and exists (select 1 from public.dev_change_recovery where identity_key='arcgis:fixture:nO2')
  and pg_temp.ready('76303','fixture') = 'v1:A');
select public.sim_refresh('76303', pg_temp.cache('76303') || jsonb_build_array(public.sim_site('nO3','Issued',(current_date - 1)::date, true, 'filed')), now() - interval '40 hours');
select public.sim_observe('76303');
select pg_temp.chk('F03 successful reactivation: the next arrival is news again', pg_temp.rep('nO3') = 1);

-- ── 17. A BREAK THE LEDGER NEVER OBSERVED is still a break (continuity is read from the receipt history) ──────────────────
create or replace function pg_temp.mk_ready(p_zip text, p_pre text) returns void language plpgsql as $f$
begin
  perform public.sim_refresh(p_zip, jsonb_build_array(public.sim_site(p_pre||'0','Issued','2024-01-01')), now() - interval '90 hours');
  perform public.sim_observe(p_zip, true);
  perform public.sim_refresh(p_zip, jsonb_build_array(public.sim_site(p_pre||'0','Issued','2024-01-01'), public.sim_site(p_pre||'1','Issued','2022-01-01', true, 'filed')), now() - interval '80 hours');
  perform public.sim_observe(p_zip);
end $f$;
select pg_temp.mk_ready('76304', 'nK');
select public.sim_refresh('76304', pg_temp.cache('76304'), now() - interval '70 hours', true, '[{"reg":"fixture","scope":"expanded","complete":false}]'::jsonb);   -- truncated, NOT observed
select public.sim_refresh('76304', pg_temp.cache('76304') || jsonb_build_array(public.sim_site('nK2','Issued',(current_date-1)::date, true, 'filed')), now() - interval '60 hours');
select public.sim_observe('76304');
select pg_temp.chk('G01 a truncated generation between two observations breaks continuity even though it was never observed: the arrival is baselined, not announced',
  pg_temp.rep('nK2') = 0 and exists (select 1 from public.dev_change_recovery where identity_key='arcgis:fixture:nK2'));
select pg_temp.mk_ready('76305', 'nJ');
select public.sim_refresh('76305', pg_temp.cache('76305'), now() - interval '70 hours');                          -- complete, NOT observed
select public.sim_refresh('76305', pg_temp.cache('76305') || jsonb_build_array(public.sim_site('nJ2','Issued',(current_date-1)::date, true, 'filed')), now() - interval '60 hours');
select public.sim_observe('76305');
select pg_temp.chk('G02 …whereas an unobserved COMPLETE generation keeps continuity: the arrival is news', pg_temp.rep('nJ2') = 1);
select pg_temp.mk_ready('76306', 'nI');
-- RETENTION: every diagnostic row (which response produced which generation) is long gone. The durable continuity does not depend on it.
delete from public.dev_refresh_generation where zip = '76306';
select public.sim_refresh('76306', pg_temp.cache('76306') || jsonb_build_array(public.sim_site('nI2','Issued',(current_date-1)::date, true, 'filed')), now() - interval '60 hours');
select public.sim_observe('76306');
select pg_temp.chk('G03 diagnostics pruned (seven-day retention) does NOT break continuity: the arrival is still news, not silently re-baselined',
  pg_temp.rep('nI2') = 1 and not exists (select 1 from public.dev_change_recovery where identity_key='arcgis:fixture:nI2'));
select pg_temp.mk_ready('76307', 'nH');
-- a cache write NOBODY can attribute to a response (a direct update of the clock) between the two observations
update public.development_reports set refreshed_at = now() - interval '70 hours' where zip = '76307';
select public.sim_refresh('76307', pg_temp.cache('76307') || jsonb_build_array(public.sim_site('nH2','Issued',(current_date-1)::date, true, 'filed')), now() - interval '60 hours');
select public.sim_observe('76307');
select pg_temp.chk('G04 an UNATTRIBUTED cache write between the two observations is a break: the arrival is baselined, not announced',
  pg_temp.rep('nH2') = 0 and exists (select 1 from public.dev_change_recovery where identity_key='arcgis:fixture:nH2'));
select pg_temp.mk_ready('76330', 'nG');
-- an accepted write whose response cannot be read (the cursor names a response that is gone)
update public.development_reports set refreshed_at = now() - interval '70 hours', last_collected_response_id = nextval('public.sim_resp_seq') where zip = '76330';
select public.sim_refresh('76330', pg_temp.cache('76330') || jsonb_build_array(public.sim_site('nG2','Issued',(current_date-1)::date, true, 'filed')), now() - interval '60 hours');
select public.sim_observe('76330');
select pg_temp.chk('G05 an accepted-but-UNREADABLE generation (no evidence) is a break: the arrival is baselined, not announced',
  pg_temp.rep('nG2') = 0 and exists (select 1 from public.dev_change_recovery where identity_key='arcgis:fixture:nG2')
  and exists (select 1 from public.dev_refresh_generation where zip = '76330' and outcome = 'unreadable'));
select pg_temp.mk_ready('76331', 'nF');
-- a REFUSED response (the cursor moves, the cache does not) is not a generation: the accepted one still describes the cache
update public.development_reports set last_collected_response_id = nextval('public.sim_resp_seq') where zip = '76331';
select pg_temp.chk('G06 a refused response leaves continuity untouched and still describing the current cache',
  exists (select 1 from public.dev_source_continuity_state where zip = '76331' and describes_current_cache)
  and (select count(*) from public.dev_refresh_generation where zip = '76331' and outcome = 'refused') = 1
  and not exists (select 1 from public.dev_source_continuity c join public.development_reports d on d.zip = c.zip where c.zip = '76331' and c.last_tick_at <> d.refreshed_at));
select public.sim_refresh('76331', pg_temp.cache('76331') || jsonb_build_array(public.sim_site('nF2','Issued',(current_date-1)::date, true, 'filed')), now() - interval '60 hours');
select public.sim_observe('76331');
select pg_temp.chk('G07 …and the arrival after it is news (the refusal broke nothing)', pg_temp.rep('nF2') = 1);

select pg_temp.mk_ready('76332', 'nU');
select public.sim_refresh('76332', pg_temp.cache('76332') || jsonb_build_array(public.sim_site('nU2','Issued',(current_date-1)::date, true, 'filed')), now() - interval '60 hours');
-- the durable row describes an EARLIER generation than the cache (the receipt for this one was never recorded): there is NO evidence
update public.dev_source_continuity set last_tick_at = last_tick_at - interval '1 minute' where zip = '76332';
select public.sim_observe('76332');
select pg_temp.chk('K01 continuity that does not describe the CURRENT cache generation is no evidence: the new record is HELD, neither announced nor baselined',
  pg_temp.rep('nU2') = 0 and not exists (select 1 from public.dev_change_recovery where identity_key='arcgis:fixture:nU2')
  and not exists (select 1 from public.dev_change_project where identity_key='arcgis:fixture:nU2')); 

select pg_temp.mk_ready('76333', 'nV');
-- defence in depth: continuity is unbroken, but the standing baseline was taken under a DIFFERENT version -> not comparable
update public.dev_change_scope_ready set scope_version = 'v1:OLD' where zip = '76333';
select public.sim_refresh('76333', pg_temp.cache('76333') || jsonb_build_array(public.sim_site('nV2','Issued',(current_date-1)::date, true, 'filed')), now() - interval '60 hours');
select public.sim_observe('76333');
select pg_temp.chk('K02 a baseline taken under another scope version is not continuity even when no break was recorded: the arrival is baselined, not announced',
  pg_temp.rep('nV2') = 0 and exists (select 1 from public.dev_change_recovery where identity_key='arcgis:fixture:nV2'));

-- a standing baseline is SUSPENDED by a generation with no evidence even when no new record arrived (the probe must still run)
select pg_temp.mk_ready('76335', 'nW');
select public.sim_refresh('76335', pg_temp.cache('76335'), now() - interval '60 hours');
update public.dev_source_continuity set last_tick_at = last_tick_at - interval '1 minute' where zip = '76335';
select public.sim_observe('76335');
select pg_temp.chk('K03 with a standing baseline and NO new record, a generation without evidence still suspends the baseline',
  pg_temp.ready('76335','fixture') = 'v1:A(suspended)');
-- an incomplete expanded read with nothing held and no baseline leaves NO readiness row at all
select public.sim_refresh('76334', jsonb_build_array(public.sim_site('nQ0','Issued','2024-01-01')), now() - interval '60 hours', true, '[{"reg":"fixture","scope":"expanded","complete":false}]'::jsonb);
select public.sim_observe('76334');
select pg_temp.chk('K04 an incomplete expanded read creates no readiness row when nothing was held and no baseline exists',
  not exists (select 1 from public.dev_change_scope_ready where zip = '76334'));

-- ── 18. A PERSISTENTLY INCOMPLETE SOURCE fails closed and stays reported ────────────────────────────────────────────
select public.sim_refresh('76308', jsonb_build_array(public.sim_site('nP0','Issued','2024-01-01')), now() - interval '90 hours');
select public.sim_observe('76308', true);
select public.sim_refresh('76308', pg_temp.cache('76308') || jsonb_build_array(public.sim_site('nP1','Issued',(current_date-1)::date, true, 'filed')), now() - interval '80 hours', true, '[{"reg":"fixture","scope":"expanded","complete":false}]'::jsonb);
select public.sim_observe('76308');
select public.sim_refresh('76308', pg_temp.cache('76308') || jsonb_build_array(public.sim_site('nP2','Issued',(current_date-1)::date, true, 'filed')), now() - interval '70 hours', true, '[{"reg":"fixture","scope":"expanded","complete":false}]'::jsonb);
select public.sim_observe('76308') as res \gset pp_
select pg_temp.chk('H01 incomplete on every refresh: nothing is observed, nothing is announced, no baseline ever appears — and it is REPORTED, not hidden',
  not exists (select 1 from public.dev_change_project where identity_key in ('arcgis:fixture:nP1','arcgis:fixture:nP2'))
  and pg_temp.ready('76308','fixture') = '(none)' and exists (select 1 from public.dev_change_scope_health where zip='76308' and registry_id='fixture')
  and ((:'pp_res'::jsonb)->>'coverage_held')::int = 2, :'pp_res');
select public.sim_refresh('76308', pg_temp.cache('76308'), now() - interval '60 hours');
select public.sim_observe('76308');
select pg_temp.chk('H02 the first COMPLETE read baselines everything that was held, silently',
  pg_temp.rep('nP1') = 0 and pg_temp.rep('nP2') = 0 and (select count(*) from public.dev_change_recovery where zip='76308') = 2 and pg_temp.ready('76308','fixture') = 'v1:A');

-- ── 19. A SOURCE ABSENT FROM A ZIP THAT HAS RECEIPTS is suspended on its own; and a contradictory receipt holds ──────────
select public.sim_refresh('76309', jsonb_build_array(public.sim_site('nX0','Issued','2024-01-01')), now() - interval '90 hours');
select public.sim_observe('76309', true);
select public.sim_refresh('76309', jsonb_build_array(public.sim_site('nX0','Issued','2024-01-01'), public.sim_site('nX1','Issued','2022-01-01', true, 'filed', 'sx'),
   public.sim_site('nY1','Issued','2022-01-01', true, 'filed', 'sy')), now() - interval '80 hours');
select public.sim_observe('76309');
select public.sim_refresh('76309', jsonb_build_array(public.sim_site('nX0','Issued','2024-01-01'), public.sim_site('nY1','Issued','2022-01-01', true, 'filed', 'sy')), now() - interval '70 hours',
   true, '[{"reg":"sy","scope":"expanded","complete":true}]'::jsonb);                                   -- sx has NO receipt at all this generation
select public.sim_observe('76309');
select pg_temp.chk('J01 a source missing from a ZIP that has other receipts is SUSPENDED by itself (sy stays ready)',
  pg_temp.ready('76309','sx') = 'v1:A(suspended)' and pg_temp.ready('76309','sy') = 'v1:A'
  and exists (select 1 from public.dev_change_scope_health where zip='76309' and registry_id='sx' and baseline_suspended));
select public.sim_refresh('76309', pg_temp.cache('76309') || jsonb_build_array(public.sim_site('nX1','Issued','2022-01-01', true, 'filed', 'sx'), public.sim_site('nX2','Issued',(current_date-1)::date, true, 'filed', 'sx')), now() - interval '60 hours');
select public.sim_observe('76309');
select pg_temp.chk('J02 when sx returns with a complete read there is NO receipt break to see, yet the suspension is remembered: re-baselined, not announced',
  pg_temp.rep('nX2') = 0 and exists (select 1 from public.dev_change_recovery where identity_key='arcgis:fixture:nX2') and pg_temp.ready('76309','sx') = 'v1:A');
-- a receipt that contradicts the records (a legacy-scope read that nonetheless carries a ring record) proves nothing
select public.sim_refresh('76310', jsonb_build_array(public.sim_site('nQ0','Issued','2024-01-01')), now() - interval '40 hours');
select public.sim_observe('76310', true);
select public.sim_refresh('76310', pg_temp.cache('76310') || jsonb_build_array(public.sim_site('nQ1','Issued',(current_date-1)::date, true, 'filed')), now() - interval '30 hours',
   true, '[{"reg":"fixture","scope":"legacy","complete":true}]'::jsonb);
select public.sim_observe('76310');
select pg_temp.chk('J03 a ring record under a non-expanded receipt is HELD (the receipt and the records disagree: nothing is inferred)',
  not exists (select 1 from public.dev_change_project where identity_key='arcgis:fixture:nQ1') and pg_temp.ready('76310','fixture') = '(none)');

select name||'|'||case when ok then 't' else 'f' end||'|'||detail from res order by name;
