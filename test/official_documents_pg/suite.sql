-- OFFICIAL DOCUMENTS PR 1: the suite. Runs after seed_before.sql and docs/official-documents-map-gate.sql.
-- One row per check: check|pass|detail. A NULL pass is a failure. Expected answers are constants.
-- Test ids follow the design's matrix (§9).
\set ON_ERROR_STOP 1
create temp table if not exists _r (n serial, check_name text, pass boolean, detail text);
truncate _r;

-- the checker's output shape (PR 3 writes it; here it is written by hand, which is the point of the suite)
create or replace function pg_temp.doc(p_run uuid, p_pid text, p_name text, p_class text, p_status text,
    p_lat float8, p_lng float8, p_street text, p_state text, p_postal text, p_extra jsonb default '{}'::jsonb)
returns uuid language sql as $$
  insert into public.dc_source_observation (acquisition_run_id, source_key, distribution_key,
      publisher_record_id, raw_payload, source_native_name, source_native_type, source_native_status,
      source_native_address, source_native_lat, source_native_lon, source_native_precision)
  values (p_run, 'official_documents', 'official_listing', p_pid,
      jsonb_build_object(
        'document_type', 'hearing_notice',
        'checker', jsonb_build_object('classification', p_class, 'checker_version', 'checker-1',
                                      'source_term', 'super-compute facility', 'site_identified', 'true',
                                      'term_rule_site_commit', '7ed31bc038762c7ce0a65356b2dbf5a7fb78384a'),
        'passage', jsonb_build_object('quote', 'proposes to construct, own, and operate a facility',
                                      'document_sha256', repeat('a', 64), 'page', 1),
        'sources', jsonb_build_array(jsonb_build_object('url', 'https://example.gov/docs/' || p_pid || '.pdf')))
        || p_extra,
      p_name, null, p_status,
      case when p_street is null then null
           else jsonb_build_object('street', p_street, 'state', p_state, 'postalCode', p_postal) end,
      p_lat, p_lng, 'exact')
  returning home_signal_observation_id $$;

create or replace function pg_temp.map(p_zip text) returns text language sql as $$
  select coalesce(string_agg(project_name || '=' || map_status, ';' order by project_name collate "C"), '')
    from public.map1_dc_zip_members(p_zip) $$;

-- ── THE ACQUISITION (G2 stores; G3 closed) ───────────────────────────────────────────────────
insert into public.dc_acquisition_run (id, source_key, distribution_key, run_seq, source_contract) values
 ('00000000-0000-0000-0000-00000000d101', 'official_documents', 'official_listing', 1,
  '{"release_mode":"incremental"}'),
 ('00000000-0000-0000-0000-00000000d102', 'official_documents', 'official_listing', 2,
  '{"release_mode":"incremental"}');

-- T-18 an alteration to the operating Alpha campus: the facility status is NULL (the document states only
-- the action), same stated site address
select pg_temp.doc('00000000-0000-0000-0000-00000000d101', 'doc-alpha-alteration', 'Fixture Campus Alpha',
  'CONFIRMED_DC', null, 40.1500, -97.4500, '100 Server Way', 'NE', '99921',
  '{"actions":[{"action_kind":"alteration","status_text":"application accepted","state":"open","action_date":"2026-11-01"}]}');
-- T-20 / T-47 an expansion on the operating Beta campus (open), and an earlier one withdrawn
select pg_temp.doc('00000000-0000-0000-0000-00000000d101', 'doc-beta-expansion', 'Fixture Campus Beta',
  'CONFIRMED_DC', null, 35.1500, -90.0500, '200 Rack Road', 'TN', '99922',
  '{"actions":[{"action_kind":"expansion","status_text":"Phase 3 hearing scheduled","state":"open","action_date":"2026-12-09","document_url":"https://example.gov/docs/beta3.pdf","page":2},
               {"action_kind":"expansion","status_text":"Phase 2 application withdrawn","state":"withdrawn","action_date":"2025-05-01"}]}');
-- T-06 a new proposal named in a hearing notice, on a scoped parcel; T-45 its record is a hearing action
select pg_temp.doc('00000000-0000-0000-0000-00000000d101', 'doc-delta-notice', 'Fixture Delta Compute Facility',
  'CONFIRMED_DC', 'proposed', 44.1500, -104.1500, null, null, null,
  '{"scoped_keys":["parcel:xx-county-cad:171887"],
    "actions":[{"action_kind":"hearing","status_text":"public hearing December 9, 2026","state":"open","action_date":"2026-12-09"}]}');
-- T-12 / T-50 / T-44 the power plant's own air permit: NON_DC, same parcel, its own case number
select pg_temp.doc('00000000-0000-0000-0000-00000000d101', 'doc-delta-air-permit', 'Fixture Delta Gas Turbines',
  'NON_DC', 'proposed', 44.1510, -104.1510, null, null, null,
  '{"document_type":"permit","scoped_keys":["parcel:xx-county-cad:171887","case:state-air:185303"]}');
-- T-15 one project in two documents of one agency case, read in two runs: the case key IS the record id
select pg_temp.doc('00000000-0000-0000-0000-00000000d101', 'case:county-planning:z-2026-1', 'Fixture Epsilon Data Center',
  'CONFIRMED_DC', 'proposed', 38.1500, -110.1500, null, null, null,
  '{"document_type":"staff_report","scoped_keys":["case:county-planning:z-2026-1"]}');
-- T-16 / T-17 an unrelated project on the same parcel as Epsilon's neighbour: a shared parcel never merges
select pg_temp.doc('00000000-0000-0000-0000-00000000d101', 'doc-zeta-a', 'Fixture Zeta Data Center',
  'CONFIRMED_DC', 'proposed', 38.2013, -110.2017, null, null, null,
  '{"scoped_keys":["parcel:yy-county-cad:9001"]}');
select pg_temp.doc('00000000-0000-0000-0000-00000000d101', 'doc-zeta-b', 'Fixture Eta Data Center',
  'CONFIRMED_DC', 'proposed', 38.2005, -110.2005, null, null, null,
  '{"scoped_keys":["parcel:yy-county-cad:9001"]}');
-- held and refused classes
select pg_temp.doc('00000000-0000-0000-0000-00000000d101', 'doc-held', 'Fixture Theta Data Center',
  'CONFIRMED_DC', 'proposed', 38.1000, -110.1000, null, null, null,
  '{"checker":{"classification":"CONFIRMED_DC","checker_version":"checker-1","source_term":"data center","site_identified":"false"}}');
select pg_temp.doc('00000000-0000-0000-0000-00000000d101', 'doc-incomplete', 'Fixture Iota Data Center',
  'CONFIRMED_DC', 'proposed', 38.1100, -110.1100, null, null, null, '{"passage":{"quote":"x"}}');
select pg_temp.doc('00000000-0000-0000-0000-00000000d101', 'doc-not-a-project', 'Data center zoning definition',
  'NOT_A_PROJECT', null, 38.1200, -110.1200, null, null, null);
select pg_temp.doc('00000000-0000-0000-0000-00000000d102', 'case:county-planning:z-2026-1', 'Epsilon rezoning item 4',
  'CONFIRMED_DC', 'proposed', 38.1500, -110.1500, null, null, null,
  '{"document_type":"agenda_packet","scoped_keys":["case:county-planning:z-2026-1"]}');
-- T-04 a corrected notice supersedes the first (run 2), and T-23 a project whose every action is withdrawn
select pg_temp.doc('00000000-0000-0000-0000-00000000d101', 'doc-kappa-v1', 'Fixture Kappa Data Center',
  'CONFIRMED_DC', 'proposed', 38.2500, -110.2500, null, null, null,
  '{"actions":[{"action_kind":"hearing","status_text":"hearing scheduled","state":"open","action_date":"2026-10-01"}]}');
select pg_temp.doc('00000000-0000-0000-0000-00000000d102', 'doc-kappa-v2', 'Fixture Kappa Data Center',
  'CONFIRMED_DC', 'withdrawn', 38.2500, -110.2500, null, null, null,
  '{"actions":[{"action_kind":"hearing","status_text":"application withdrawn","state":"withdrawn","action_date":"2026-10-20"}]}'::jsonb
  || jsonb_build_object('supersedes', jsonb_build_array(
    (select home_signal_observation_id::text from public.dc_source_observation where publisher_record_id = 'doc-kappa-v1'))));

select count(*) >= 0 from public.dc_resolve_canonical(true, false);
-- the history path too (p_include_history): every stored observation, current or not
select count(*) >= 0 from public.dc_resolve_canonical(true, true);
select count(*) >= 0 from public.dc_resolve_geography(true);

-- ── G3 CLOSED: NONINTERFERENCE (T-30, T-48) ──────────────────────────────────────────────────
insert into _r (check_name, pass, detail)
select 'T-30/T-48 G3 closed: ' || b.k || ' byte-identical to the run without the source (n=' || b.n || ')',
       b.fp = a.fp, b.fp || ' vs ' || a.fp
  from public._od_before b join public._od_fp() a on a.k = b.k;
insert into _r (check_name, pass, detail)
select 'G2 stores: 13 official-documents observations are on file', count(*) = 13, count(*)::text
  from public.dc_source_observation where source_key = 'official_documents';
insert into _r (check_name, pass, detail)
select 'G3 closed: no official-documents observation is current', count(*) = 0, count(*)::text
  from public.dc_current_observation where source_key = 'official_documents';
insert into _r (check_name, pass, detail)
select 'G3 closed: no canonical link to an official-documents observation', count(*) = 0, count(*)::text
  from public.dc_entity_observation where source_key = 'official_documents';
insert into _r (check_name, pass, detail)
select 'G3 closed: the open-actions reader returns nothing', count(*) = 0, count(*)::text
  from public.dc_entity_open_actions(array(select canonical_entity_id from public.dc_canonical_entity));

-- ── G3 OPEN (in the suite only) ──────────────────────────────────────────────────────────────
insert into public.official_document_gate_decision (gate, scope_key, is_open, actor, policy_version, reason)
values ('G3_MAP_ADMISSION', 'official_documents/official_listing', true, 'suite', 'suite-1', 'suite opens G3');
select count(*) >= 0 from public.dc_resolve_canonical(true, false);
-- a history backfill with the gate open links superseded documents too (the reader must still skip them)
select count(*) >= 0 from public.dc_resolve_canonical(true, true);
select count(*) >= 0 from public.dc_resolve_geography(true);
create temp table _open as select * from public._od_fp();

insert into _r (check_name, pass, detail)
select 'T-06 a stated compute facility on an identified site is CONFIRMED_DC by the shared-rule branch',
       c.classification = 'CONFIRMED_DC' and c.rule_key = 'OFFICIAL_DOC_SHARED_TERM_RULE_SITE_USE',
       c.classification || '/' || c.rule_key
  from public.dc_source_observation o
 cross join lateral public.dc_classify_observation(o.source_key, o.distribution_key, o.source_native_type, o.raw_payload) c
 where o.publisher_record_id = 'doc-delta-notice';
insert into _r (check_name, pass, detail)
select 'T-06 the proposal is drawn as Proposed on its ZIP', pg_temp.map('99923') = 'Fixture Delta Compute Facility=Proposed',
       pg_temp.map('99923');
insert into _r (check_name, pass, detail)
select 'T-12/T-50 the power plant''s permit is NON_DC, not merged into the project, never a data-center pin',
       (select e.classification from public.dc_entity_observation eo join public.dc_canonical_entity e
          on e.canonical_entity_id = eo.canonical_entity_id where eo.publisher_record_id = 'doc-delta-air-permit') = 'NON_DC'
       and (select count(distinct eo.canonical_entity_id) from public.dc_entity_observation eo
             where eo.publisher_record_id in ('doc-delta-notice', 'doc-delta-air-permit')) = 2
       and position('Turbines' in pg_temp.map('99923')) = 0,
       pg_temp.map('99923');
insert into _r (check_name, pass, detail)
select 'T-15 two documents with one agency case number are ONE entity and one pin',
       (select count(*) || '/' || count(distinct canonical_entity_id) from public.dc_entity_observation
         where publisher_record_id = 'case:county-planning:z-2026-1') = '2/1'
       and (select count(*) from public.map1_dc_zip_members('99924') m
             where m.project_name in ('Epsilon rezoning item 4', 'Fixture Epsilon Data Center')) = 1,
       pg_temp.map('99924');
insert into _r (check_name, pass, detail)
select 'T-16/T-17 two projects on one parcel stay TWO entities, and the shared parcel was surfaced',
       (select count(distinct canonical_entity_id) from public.dc_entity_observation
         where publisher_record_id in ('doc-zeta-a', 'doc-zeta-b')) = 2
       and position('Fixture Zeta Data Center=Proposed' in pg_temp.map('99924')) > 0
       and position('Fixture Eta Data Center=Proposed' in pg_temp.map('99924')) > 0
       and exists (select 1 from public.dc_identity_decision where candidate_rule_key = 'SCOPED_KEY'),
       (select string_agg(distinct decision_state || ':' || decision_rule_key, ',') from public.dc_identity_decision
         where candidate_rule_key = 'SCOPED_KEY');
insert into _r (check_name, pass, detail)
select 'T-18 an alteration links to the operating campus and Map 1 still says Operating, one pin',
       pg_temp.map('99921') = 'Fixture Campus Alpha=Operating'
       and (select count(distinct canonical_entity_id) from public.dc_entity_observation
             where publisher_record_id in ('fixture-alpha', 'doc-alpha-alteration')) = 1,
       pg_temp.map('99921');
insert into _r (check_name, pass, detail)
select 'T-20 an open expansion: the campus stays Operating with one pin, the reader returns the expansion',
       pg_temp.map('99922') = 'Fixture Campus Beta=Operating'
       and (select string_agg(action_kind || '|' || action_status || '|' || action_date || '|' || page, ';')
              from public.dc_zip_open_actions('99922')) = 'expansion|Phase 3 hearing scheduled|2026-12-09|2',
       pg_temp.map('99922') || ' / ' || coalesce((select string_agg(action_kind || '|' || action_status, ';')
                                                  from public.dc_zip_open_actions('99922')), '<none>');
insert into _r (check_name, pass, detail)
select 'T-47 a withdrawn expansion is never returned', count(*) = 0, count(*)::text
  from public.dc_zip_open_actions('99922') where action_status ilike '%withdrawn%';
insert into _r (check_name, pass, detail)
select 'T-45 the hearing notice is a hearing action, carries no permit record', count(*) = 1 and bool_and(action_kind = 'hearing'),
       string_agg(action_kind, ',')
  from public.dc_zip_open_actions('99923');
insert into _r (check_name, pass, detail)
select 'reader contract: a superseded entity''s actions return under the id asked about',
       (select count(*) from public.dc_entity_open_actions(array[e.canonical_entity_id])) = 1, e.canonical_entity_id::text
  from public.dc_entity_observation eo join public.dc_canonical_entity e on e.canonical_entity_id = eo.canonical_entity_id
 where eo.publisher_record_id = 'doc-beta-expansion';
insert into _r (check_name, pass, detail)
select 'reader contract: an unknown or non-canonical id returns nothing, never an error',
       count(*) = 0, count(*)::text from public.dc_entity_open_actions(array[gen_random_uuid(), null::uuid]);
insert into _r (check_name, pass, detail)
select 'held: a term with no identified site is DC_CANDIDATE and not drawn',
       c.classification = 'DC_CANDIDATE' and position('Theta' in pg_temp.map('99924')) = 0, c.rule_key
  from public.dc_source_observation o
 cross join lateral public.dc_classify_observation(o.source_key, o.distribution_key, o.source_native_type, o.raw_payload) c
 where o.publisher_record_id = 'doc-held';
insert into _r (check_name, pass, detail)
select 'fail closed: missing checker evidence is CLASSIFICATION_UNRESOLVED and not drawn',
       c.classification = 'CLASSIFICATION_UNRESOLVED' and position('Iota' in pg_temp.map('99924')) = 0, c.rule_key
  from public.dc_source_observation o
 cross join lateral public.dc_classify_observation(o.source_key, o.distribution_key, o.source_native_type, o.raw_payload) c
 where o.publisher_record_id = 'doc-incomplete';
insert into _r (check_name, pass, detail)
select 'fail closed: an unstored class (NOT_A_PROJECT) is CLASSIFICATION_UNRESOLVED',
       c.classification = 'CLASSIFICATION_UNRESOLVED', c.rule_key
  from public.dc_source_observation o
 cross join lateral public.dc_classify_observation(o.source_key, o.distribution_key, o.source_native_type, o.raw_payload) c
 where o.publisher_record_id = 'doc-not-a-project';
insert into _r (check_name, pass, detail)
select 'T-04 a superseded document is not current; its correction is',
       not exists (select 1 from public.dc_current_observation where publisher_record_id = 'doc-kappa-v1')
       and exists (select 1 from public.dc_current_observation where publisher_record_id = 'doc-kappa-v2'),
       null;
insert into _r (check_name, pass, detail)
select 'T-04 a superseded document''s open action is never returned (it IS linked after the backfill)',
       count(*) = 0 and (select count(*) from public.dc_entity_observation where publisher_record_id = 'doc-kappa-v1') = 1,
       coalesce(string_agg(action_status, ','), '<none>')
  from public.dc_entity_open_actions(array(select canonical_entity_id from public.dc_entity_observation
                                            where publisher_record_id in ('doc-kappa-v1', 'doc-kappa-v2')));
insert into _r (check_name, pass, detail)
select 'T-23 every action withdrawn: not drawn as Proposed', position('Kappa' in pg_temp.map('99924')) = 0, pg_temp.map('99924');
insert into _r (check_name, pass, detail)
select 'incremental: run 1 stays current after run 2 (a document family has no release)',
       exists (select 1 from public.dc_current_observation where publisher_record_id = 'doc-delta-notice'), null;
insert into _r (check_name, pass, detail)
select 'untouched: the unrelated operating campus is exactly as before',
       pg_temp.map('99925') = 'Fixture Campus Gamma=Operating', pg_temp.map('99925');
insert into _r (check_name, pass, detail)
select 'whole-release sources unchanged: only the newest Atlas run is current',
       (select count(distinct acquisition_run_id) from public.dc_current_observation where source_key = 'compute_atlas') = 1, null;

-- ── KILL SWITCH (T-37) AND ROLLBACK (T-38) ──────────────────────────────────────────────────
create temp table _off as select public.official_documents_exposure_off('suite: exposure off') as res;
insert into _r (check_name, pass, detail)
select 'T-37 after the kill switch Map 1 is exactly the run without the source',
       (select fp from public._od_fp() where k = 'map1') = (select fp from public._od_before where k = 'map1'),
       pg_temp.map('99921') || ' / ' || pg_temp.map('99922') || ' / ' || pg_temp.map('99923') || ' / ' || pg_temp.map('99924');
insert into _r (check_name, pass, detail)
select 'T-37 every gate is closed and the decision is logged with what it replaced',
       not public.dc_source_map_admitted('official_documents', 'official_listing')
       and not public.official_document_gate_open('G4_AUTO_PUBLISH', 'official_documents')
       and (select effects->'previous_gates'->>'G3_MAP_ADMISSION|official_documents/official_listing'
              from public.official_document_gate_decision where decision_id = (select (res->>'decision_id')::bigint from _off)) = 'true',
       (select res::text from _off);
insert into _r (check_name, pass, detail)
select 'T-37 the open-actions reader returns nothing once the gate is closed', count(*) = 0, count(*)::text
  from public.dc_zip_open_actions('99922');
select public.official_documents_exposure_restore((select (res->>'decision_id')::bigint from _off), 'suite: restore');
insert into _r (check_name, pass, detail)
select 'T-38 the rollback restores the opened state exactly (Map 1)',
       (select fp from public._od_fp() where k = 'map1') = (select fp from _open where k = 'map1'),
       pg_temp.map('99923');
insert into _r (check_name, pass, detail)
select 'T-38 a restore cannot be applied twice', false, 'second restore succeeded';
do $$ begin
  perform public.official_documents_exposure_restore(
    (select decision_id from public.official_document_gate_decision where policy_version = 'exposure-off-1'
      and gate = 'G4_AUTO_PUBLISH' order by decision_id desc limit 1), 'twice');
exception when others then
  update _r set pass = sqlerrm like '%already restored%', detail = sqlerrm where check_name = 'T-38 a restore cannot be applied twice';
end $$;

-- ── THE LOG IS APPEND-ONLY; NOTHING IS OPEN FOR THE PUBLIC ─────────────────────────────────
insert into _r (check_name, pass, detail) values ('gate log refuses UPDATE', false, null), ('gate log refuses DELETE', false, null);
do $$ begin
  update public.official_document_gate_decision set is_open = true;
exception when others then update _r set pass = sqlstate = '55000', detail = sqlerrm where check_name = 'gate log refuses UPDATE'; end $$;
do $$ begin
  delete from public.official_document_gate_decision;
exception when others then update _r set pass = sqlstate = '55000', detail = sqlerrm where check_name = 'gate log refuses DELETE'; end $$;
insert into _r (check_name, pass, detail)
select 'no anon or authenticated access to any new object',
       not has_table_privilege('anon', 'public.official_document_gate_decision', 'select')
       and not has_table_privilege('authenticated', 'public.official_document_gate_decision', 'select')
       and not has_function_privilege('anon', 'public.dc_entity_open_actions(uuid[])', 'execute')
       and not has_function_privilege('anon', 'public.official_documents_exposure_off(text, text)', 'execute')
       and not has_function_privilege('authenticated', 'public.official_documents_exposure_off(text, text)', 'execute')
       and not has_function_privilege('anon', 'public.dc_source_map_admitted(text, text)', 'execute'), null;
insert into _r (check_name, pass, detail)
select 'a kill switch needs a reason', false, null;
do $$ begin
  perform public.official_documents_exposure_off('  ');
exception when others then update _r set pass = sqlstate = '22023', detail = sqlerrm where check_name = 'a kill switch needs a reason'; end $$;

select check_name || '|' || coalesce(case when pass then 't' else 'f' end, 'f') || '|' || coalesce(detail, '')
  from _r order by n;
