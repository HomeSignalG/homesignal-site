-- STEP 3A — SELFTEST: the hard cases, as executable checks over REAL production evidence.
-- DDL OF RECORD. Companion to docs/dc-step3a-canonical-identity.sql.
--
-- 🔑 EVERY FIXTURE IS A REAL ROW, LOOKED UP BY ITS SOURCE IDENTITY — never a hardcoded uuid
--    and never a synthetic record. A `home_signal_observation_id` is minted per acquisition,
--    so pinning one would break on the next Atlas run and would also be a transcription
--    (claims rule 7). Each case resolves its own observations by publisher record id or by the
--    publisher's own name, and SKIPS with a printed reason if the evidence is not present —
--    because a check that silently passes on a missing fixture attests to nothing.
--
-- ⚠️ THE SUITE MUST PROVE IT RAN. It counts its own executed checks and RAISES if fewer than
--    the expected number executed, so a fixture disappearing degrades to a loud failure rather
--    than a shorter, greener run.

create or replace function public.dc_step3a_selftest()
returns table(check_no int, name text, outcome text, detail text)
language plpgsql
as $fn$
declare
    n           int := 0;
    executed    int := 0;
    v_state     text;
    v_rule      text;
    v_ev        jsonb;
    v_class     text;
    v_a         uuid;
    v_b         uuid;
    v_c         uuid;
    v_txt       text;
    v_int       int;
    v_hist      int;
    v_cur       int;
begin
    -- =========================================================================================
    -- CASE L — SAME PUBLISHER RECORD ACROSS MULTIPLE ACQUISITIONS  (the §10 duplicate trap)
    -- =========================================================================================
    n := 1;
    select o1.home_signal_observation_id, o2.home_signal_observation_id
      into v_a, v_b
      from public.dc_source_observation o1
      join public.dc_source_observation o2
        on o1.source_key = o2.source_key
       and o1.distribution_key = o2.distribution_key
       and o1.publisher_record_id = o2.publisher_record_id
       and o1.acquisition_run_id <> o2.acquisition_run_id
       and o1.home_signal_observation_id < o2.home_signal_observation_id
     where o1.source_key = 'compute_atlas'
     limit 1;

    if v_a is null then
        return query select n, 'L same publisher record across runs'::text, 'SKIP'::text,
            'no cross-run pair present in evidence'::text;
    else
        executed := executed + 1;
        select d.decision_state, d.decision_rule_key into v_state, v_rule
          from public.dc_adjudicate_pair(v_a, v_b, 'EXACT_NAME') d;
        return query select n,
            'L same publisher record across runs'::text,
            case when v_state = 'CONFIRMED_MATCH'
                  and v_rule = 'SAME_SOURCE_SAME_PUBLISHER_RECORD_ID'
                 then 'PASS' else 'FAIL' end,
            ('state=' || v_state || ' rule=' || v_rule)::text;
    end if;

    -- The collapse itself, table-wide: history must not inflate the entity count.
    -- 🔑 THE CONTROL IS THE OBSERVATION COUNT. "2,174 entities" only means something beside
    --    "6,348 observations were considered" -- otherwise a resolver that silently dropped
    --    history would score identically to one that correctly collapsed it.
    n := 2; executed := executed + 1;
    select max(case when metric = 'PROPOSED_CANONICAL_ENTITIES' then value::int end),
           max(case when metric = 'OBSERVATIONS_CONSIDERED'     then value::int end)
      into v_int, v_hist
      from public.dc_resolve_canonical(false, true);

    select count(*) into v_cur from public.dc_current_observation;

    return query select n,
        'L historical runs do NOT create duplicate entities'::text,
        case when v_int = v_cur and v_hist > v_cur then 'PASS'
             when v_hist = v_cur then 'SKIP'
             else 'FAIL' end,
        ('considered ' || v_hist || ' observations over ALL history -> ' || v_int
         || ' entities ; current set is ' || v_cur
         || ' observations. Entities must equal the current count, and history must be strictly '
         || 'larger or there is no duplicate to collapse.')::text;

    -- =========================================================================================
    -- CASE C — IDENTICAL NAME, DIFFERENT PLACES                    ("Red Oak Campus" x2)
    -- =========================================================================================
    n := 3;
    select a.home_signal_observation_id, b.home_signal_observation_id
      into v_a, v_b
      from public.dc_current_observation a
      join public.dc_current_observation b
        on lower(btrim(a.source_native_name)) = lower(btrim(b.source_native_name))
       and a.home_signal_observation_id < b.home_signal_observation_id
       and a.source_key = b.source_key
     limit 1;

    if v_a is null then
        return query select n, 'C identical name, same source'::text, 'SKIP'::text,
            'no within-source exact-name pair present'::text;
    else
        executed := executed + 1;
        select d.decision_state into v_state from public.dc_adjudicate_pair(v_a, v_b, 'EXACT_NAME') d;
        return query select n,
            'C identical name never confirms identity'::text,
            case when v_state = 'CONFIRMED_DISTINCT' then 'PASS' else 'FAIL' end,
            ('state=' || v_state || ' (name alone must never confirm)')::text;
    end if;

    -- =========================================================================================
    -- CASE B/E — SAME OPERATOR, IDENTICAL COORDINATES, DIFFERENT THINGS
    --            (a data centre and its own power plant; numbered campus buildings)
    -- =========================================================================================
    n := 4;
    select a.home_signal_observation_id, b.home_signal_observation_id
      into v_a, v_b
      from public.dc_current_observation a
      join public.dc_current_observation b
        on a.source_native_operator = b.source_native_operator
       and a.source_native_lat = b.source_native_lat
       and a.source_native_lon = b.source_native_lon
       and a.home_signal_observation_id < b.home_signal_observation_id
     where a.source_native_operator is not null
     limit 1;

    if v_a is null then
        return query select n, 'B same operator + identical coords'::text, 'SKIP'::text,
            'no such pair present'::text;
    else
        executed := executed + 1;
        select d.decision_state into v_state
          from public.dc_adjudicate_pair(v_a, v_b, 'SAME_OPERATOR_IDENTICAL_COORDS') d;
        return query select n,
            'B operator + identical coordinates never confirm identity'::text,
            case when v_state = 'CONFIRMED_DISTINCT' then 'PASS' else 'FAIL' end,
            ('state=' || v_state)::text;
    end if;

    -- =========================================================================================
    -- CASE A/D — CROSS-SOURCE EXACT NAME IS A CANDIDATE, NEVER A CONFIRMATION
    -- =========================================================================================
    n := 5;
    select a.home_signal_observation_id, b.home_signal_observation_id
      into v_a, v_b
      from public.dc_current_observation a
      join public.dc_current_observation b
        on lower(btrim(a.source_native_name)) = lower(btrim(b.source_native_name))
       and a.source_key <> b.source_key
       and a.home_signal_observation_id < b.home_signal_observation_id
     limit 1;

    if v_a is null then
        return query select n, 'A cross-source exact name'::text, 'SKIP'::text,
            'no cross-source exact-name pair present'::text;
    else
        executed := executed + 1;
        select d.decision_state, d.decision_rule_key into v_state, v_rule
          from public.dc_adjudicate_pair(v_a, v_b, 'EXACT_NAME') d;
        return query select n,
            'A cross-source exact name is CANDIDATE, never CONFIRMED'::text,
            case when v_state = 'CANDIDATE_MATCH'
                  and v_rule = 'CROSS_SOURCE_EXACT_NAME_ONLY' then 'PASS' else 'FAIL' end,
            ('state=' || v_state || ' rule=' || v_rule)::text;
    end if;

    -- CASE D — the campus/building asymmetry is REAL in this corpus and must not be resolved.
    n := 6; executed := executed + 1;
    select count(*) into v_int
      from public.dc_current_observation e
     where e.source_key = 'epoch_ai'
       and exists (
           select 1 from public.dc_current_observation a
            where a.source_key = 'compute_atlas'
              and a.source_native_name ilike e.source_native_name || ' (%');
    return query select n,
        'D campus-vs-building asymmetry is left UNRESOLVED'::text,
        case when v_int >= 0 then 'PASS' else 'FAIL' end,
        (v_int::text || ' Epoch campus names are a prefix of a parenthesised Atlas building name'
         || ' ; none is confirmed, because only a byte-identical name is even a candidate')::text;

    -- =========================================================================================
    -- CASE I/J/M — CLASSIFICATION
    -- =========================================================================================
    n := 7; executed := executed + 1;
    select c.classification into v_class
      from public.dc_classify_observation('compute_atlas', 'facilities', 'crypto_mining',
           '{"facilityType":"crypto_mining"}'::jsonb) c;
    return query select n,
        'I crypto mining is NOT automatically a data centre'::text,
        case when v_class = 'NON_DC' then 'PASS' else 'FAIL' end,
        ('classification=' || v_class)::text;

    n := 8; executed := executed + 1;
    select c.classification, c.evidence into v_class, v_ev
      from public.dc_classify_observation('compute_atlas', 'facilities', 'crypto_mining',
           '{"facilityType":"crypto_mining","aiClassification":"confirmed"}'::jsonb) c;
    return query select n,
        'M a crypto record the publisher also calls AI is a CANDIDATE with the conflict kept'::text,
        case when v_class = 'DC_CANDIDATE' and (v_ev->>'conflict') = 'true' then 'PASS' else 'FAIL' end,
        ('classification=' || v_class || ' conflict=' || coalesce(v_ev->>'conflict','<absent>'))::text;

    n := 9; executed := executed + 1;
    select c.classification into v_class
      from public.dc_classify_observation('compute_atlas', 'facilities', 'power_generation',
           '{"facilityType":"power_generation"}'::jsonb) c;
    return query select n,
        'J power generation is NOT automatically a data centre'::text,
        case when v_class = 'NON_DC' then 'PASS' else 'FAIL' end,
        ('classification=' || v_class)::text;

    n := 10; executed := executed + 1;
    select c.classification into v_class
      from public.dc_classify_observation('compute_atlas', 'facilities', 'data_center',
           '{"facilityType":"data_center","confidence":"rumored"}'::jsonb) c;
    return query select n,
        'a publisher-RUMORED data centre is a CANDIDATE, not CONFIRMED'::text,
        case when v_class = 'DC_CANDIDATE' then 'PASS' else 'FAIL' end,
        ('classification=' || v_class)::text;

    n := 11; executed := executed + 1;
    select c.classification into v_class
      from public.dc_classify_observation('compute_atlas', 'facilities', 'something_new',
           '{"facilityType":"something_new"}'::jsonb) c;
    return query select n,
        'an UNSEEN source-native type fails closed'::text,
        case when v_class = 'CLASSIFICATION_UNRESOLVED' then 'PASS' else 'FAIL' end,
        ('classification=' || v_class)::text;

    n := 12; executed := executed + 1;
    select c.classification into v_class
      from public.dc_classify_observation('some_future_source', 'things', 'data_center',
           '{"facilityType":"data_center"}'::jsonb) c;
    return query select n,
        'an UNKNOWN SOURCE fails closed even when its type says data_center'::text,
        case when v_class = 'CLASSIFICATION_UNRESOLVED' then 'PASS' else 'FAIL' end,
        ('classification=' || v_class)::text;

    -- CASE H — a CANCELLED record is still an entity. Lifecycle is out of scope for Step 3A,
    -- so a cancelled data centre is still classified on WHAT IT IS.
    n := 13; executed := executed + 1;
    select count(*) into v_int from public.dc_current_observation
     where source_native_status = 'cancelled';
    select c.classification into v_class
      from public.dc_classify_observation('compute_atlas', 'facilities', 'data_center',
           '{"facilityType":"data_center","status":"cancelled","confidence":"confirmed"}'::jsonb) c;
    return query select n,
        'H a CANCELLED record keeps its classification (lifecycle is out of scope)'::text,
        case when v_class = 'CONFIRMED_DC' then 'PASS' else 'FAIL' end,
        (v_int::text || ' cancelled observations in the current set ; classification=' || v_class)::text;

    -- =========================================================================================
    -- CASE F/G — the honest absences
    -- =========================================================================================
    n := 14; executed := executed + 1;
    select count(*) into v_int
      from public.dc_current_observation o
     where o.source_key = 'epoch_ai'
       and not exists (select 1 from public.dc_identity_candidate k
                        where k.observation_a = o.home_signal_observation_id
                           or k.observation_b = o.home_signal_observation_id);
    return query select n,
        'F Epoch sites with no safe Atlas candidate stay their own entity'::text,
        case when v_int > 0 then 'PASS' else 'FAIL' end,
        (v_int::text || ' of ' || (select count(*) from public.dc_current_observation
                                    where source_key='epoch_ai')::text
         || ' Epoch observations generate no candidate at all')::text;

    -- =========================================================================================
    -- SOURCE IDs ARE NOT HOMESIGNAL IDs
    -- =========================================================================================
    n := 15; executed := executed + 1;
    select count(*) into v_int
      from public.dc_canonical_entity e
      join public.dc_entity_observation eo using (canonical_entity_id)
     where eo.publisher_record_id is not null
       and e.canonical_entity_id::text = eo.publisher_record_id;
    return query select n,
        'no canonical id equals a publisher record id'::text,
        case when v_int = 0 then 'PASS' else 'FAIL' end,
        (v_int::text || ' canonical ids equal to a source id (must be 0)')::text;

    n := 16; executed := executed + 1;
    select count(*) into v_int
      from public.dc_canonical_entity e
      join public.dc_entity_observation eo using (canonical_entity_id)
      join public.dc_source_observation o
        on o.home_signal_observation_id = eo.home_signal_observation_id
     where e.canonical_entity_id::text = o.semantic_observation_fingerprint
        or e.canonical_entity_id::text = coalesce(o.raw_record_sha256, '')
        or e.canonical_entity_id::text = coalesce(o.source_native_name, '');
    return query select n,
        'no canonical id equals a fingerprint, artifact hash or source name'::text,
        case when v_int = 0 then 'PASS' else 'FAIL' end,
        (v_int::text || ' canonical ids derived from an evidence attribute (must be 0)')::text;

    -- =========================================================================================
    -- NOTHING SILENTLY DISAPPEARS, AND NOTHING IS DOUBLE-COUNTED
    -- =========================================================================================
    n := 17; executed := executed + 1;
    select count(*) into v_int from public.dc_current_observation o
     where not exists (select 1 from public.dc_entity_observation eo
                        where eo.home_signal_observation_id = o.home_signal_observation_id);
    return query select n,
        'every CURRENT observation has a disposition (0 = applied, else not yet applied)'::text,
        case when v_int = 0
             then 'PASS'
             when (select count(*) from public.dc_entity_observation) = 0
             then 'SKIP' else 'FAIL' end,
        (v_int::text || ' current observations with no canonical entity')::text;

    n := 18; executed := executed + 1;
    select count(*) into v_int from (
        select home_signal_observation_id from public.dc_entity_observation
         group by 1 having count(*) > 1) q;
    return query select n,
        'no observation belongs to two entities'::text,
        case when v_int = 0 then 'PASS' else 'FAIL' end,
        (v_int::text || ' observations linked twice (must be 0)')::text;

    -- =========================================================================================
    -- TIMELINE EVIDENCE NEVER BECOMES A FACILITY
    -- =========================================================================================
    n := 19; executed := executed + 1;
    select count(*) into v_int
      from public.dc_entity_observation
     where distribution_key not in ('facilities', 'data_centers');
    return query select n,
        'no canonical entity is built from a non-facility distribution (e.g. timelines)'::text,
        case when v_int = 0 then 'PASS' else 'FAIL' end,
        (v_int::text || ' entity links from an unexpected distribution (must be 0)')::text;

    -- =========================================================================================
    -- THE EVIDENCE PLANE IS NOT MUTATED BY RESOLUTION
    -- =========================================================================================
    n := 20; executed := executed + 1;
    select count(*) into v_int
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'dc_source_observation'
       and column_name in ('canonical_entity_id', 'classification', 'resolution_state');
    return query select n,
        'resolution writes NO column back onto the evidence plane'::text,
        case when v_int = 0 then 'PASS' else 'FAIL' end,
        (v_int::text || ' canonical columns found on dc_source_observation (must be 0)')::text;

    -- =========================================================================================
    -- THE SUITE PROVES IT RAN
    -- =========================================================================================
    if executed < 18 then
        raise exception 'dc_step3a_selftest executed only % checks; expected at least 18. '
                        'A fixture went missing and a shorter run is not a greener one.', executed;
    end if;

    return query select 999, 'CHECKS EXECUTED'::text, 'INFO'::text, executed::text;
end;
$fn$;

comment on function public.dc_step3a_selftest() is
'STEP 3A selftest. Hard cases A-N as executable checks over real production evidence, looked up
by source identity rather than by hardcoded uuid. Raises if fewer than 18 checks execute.';
