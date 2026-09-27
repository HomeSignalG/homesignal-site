-- =====================================================================================
-- C7 AUTOMATED GATE — the tightened derived-point verdict, proven on a REPLICA of production.
-- Founder ruling (2026-09-26): no manual list review; this gate decides. Run by scripts/dc-verdict-gate.sh
-- AFTER it has built a replica of production at the pre-C7 verdict, proven Map 1 parity, run both
-- resolvers once (baseline) and snapshotted:
--   gate_before / gate_geo_before / gate_osm_before / gate_verdict_before / gate_ident_before;
-- then applied docs/dc-verdict-apply.sql, run both resolvers           -> gate_after (and live tables).
-- Every check is a name|pass|detail row; the script refuses on any pass that is not 't'.
-- THE PREDICTION is worded independently of the verdict function: tokens, not its regexes.
-- =====================================================================================
\set ON_ERROR_STOP 1
-- verdicts now (after the apply), per geocode row at the current ladder
create temp table _vnow as
select d.geocoder_query, v.verdict from public.dc_address_geocode d
 cross join lateral public.dc_derived_point_verdict(d.match_type, d.provider_candidates, d.geocoder_query, d.matched_address, d.lat, d.lng) v
 where d.ladder_version = public.dc_geocode_ladder_version();
create temp table _flip as
select distinct b.geocoder_query, b.verdict as before, a.verdict as after
  from public.gate_verdict_before b join _vnow a using (geocoder_query)
 where a.verdict is distinct from b.verdict;
-- the independent prediction: a before-ACCEPTED address where either side's first token is not a house number, or whose
-- second token (a street direction) names a different compass point in the query than in the match
create temp table _tok as
select geocoder_query, verdict,
       split_part(btrim(geocoder_query), ' ', 1) ~ '^[0-9]+[A-Za-z]?$' as q_has_no,
       split_part(btrim(matched_address), ' ', 1) ~ '^[0-9]+[A-Za-z]?$' as m_has_no,
       upper(regexp_replace(split_part(btrim(geocoder_query), ' ', 2), '[.,]', '', 'g')) as q2,
       upper(regexp_replace(split_part(btrim(matched_address), ' ', 2), '[.,]', '', 'g')) as m2
  from public.gate_verdict_before;
create temp table _pred as
select distinct geocoder_query from _tok
 where verdict = 'ACCEPTED'
   and (not q_has_no or not m_has_no
        or (q2 in ('N','S','E','W','NORTH','SOUTH','EAST','WEST') and m2 in ('N','S','E','W','NORTH','SOUTH','EAST','WEST')
            and left(q2, 1) <> left(m2, 1)));
-- what reads a flipped address: canonical entities (through their observations) and OSM records
create temp table _ent as
select distinct eo.canonical_entity_id from public.dc_observation_derived_point p
  join public.dc_entity_observation eo on eo.home_signal_observation_id = p.home_signal_observation_id
 where p.geocoder_query in (select geocoder_query from _flip);
create temp table _osm as
select distinct n.source_key, o.check_outcome, o.admitted from public.gate_osm_before o
  join public.national_dc_records n on n.id = o.osm_record_id
 where o.geocoder_query in (select geocoder_query from _flip);
create temp table _b as select * from public.gate_before;
create temp table _a as select * from public.gate_after;
create temp table _removed as select b.* from _b b where not exists (select 1 from _a a where a.zip = b.zip and a.source_key = b.source_key);
create temp table _added as select a.* from _a a where not exists (select 1 from _b b where b.zip = a.zip and b.source_key = a.source_key);
create temp table _changed as
select b.zip, b.source_key, b.canonical_entity_id, b.quality_flags as fb, a.quality_flags as fa
  from _b b join _a a using (zip, source_key) where row_to_json(a)::jsonb is distinct from row_to_json(b)::jsonb;
create temp table _touched as
select canonical_entity_id, source_key from _removed union all select canonical_entity_id, source_key from _added
union all select canonical_entity_id, source_key from _changed;

select 'G01_BEFORE_IS_NOT_EMPTY', ((select count(*) from _b) > 0 and (select count(*) from public.gate_verdict_before) > 0)::text,
       (select count(*) from _b) || ' Map 1 rows, ' || (select count(*) from public.gate_verdict_before) || ' geocodes';
select 'G02_EVERY_FLIP_IS_ACCEPTED_TO_MATCH_DIVERGES',
       (not exists (select 1 from _flip where not (before = 'ACCEPTED' and after = 'REJECTED_MATCH_DIVERGES')))::text,
       (select count(*) || ' addresses flipped' from _flip);
select 'G03_FLIPS_EQUAL_THE_INDEPENDENT_PREDICTION',
       (not exists (select geocoder_query from _pred except select geocoder_query from _flip)
        and not exists (select geocoder_query from _flip except select geocoder_query from _pred))::text,
       (select count(*) || ' predicted' from _pred) || ' / ' || (select count(*) || ' flipped' from _flip);
select 'G04_EVERY_MAP1_CHANGE_READS_A_FLIPPED_ADDRESS',
       (not exists (select 1 from _touched t
                     where not (t.canonical_entity_id in (select canonical_entity_id from _ent)
                                or t.source_key in (select source_key from _osm))))::text,
       (select count(*) || ' rows touched' from _touched);
select 'G05_NO_PIN_MOVED',
       (not exists (select 1 from _a a join _b b using (zip, source_key)
                     where a.lat is distinct from b.lat or a.lng is distinct from b.lng))::text, null;
select 'G06_EVERY_ADDED_ROW_WAS_WITHHELD_ON_A_FLIPPED_DISAGREEMENT',
       (not exists (select 1 from _added a
                     where not (exists (select 1 from public.gate_geo_before g
                                         where g.canonical_entity_id = a.canonical_entity_id and g.provenance->>'rule' = 'SOURCES_DISAGREE'
                                           and a.canonical_entity_id in (select canonical_entity_id from _ent))
                                or exists (select 1 from _osm o where o.source_key = a.source_key and o.admitted and o.check_outcome = 'SOURCES_DISAGREE'))))::text,
       (select count(*) || ' added' from _added);
select 'G07_EVERY_REMOVED_ROW_WAS_PLACED_ON_A_FLIPPED_DERIVED_POINT',
       (not exists (select 1 from _removed r
                     where not exists (select 1 from public.gate_geo_before g
                                        where g.canonical_entity_id = r.canonical_entity_id and g.provenance->>'rule' = 'DERIVED_ADDRESS_POINT'
                                          and r.canonical_entity_id in (select canonical_entity_id from _ent))))::text,
       (select count(*) || ' removed' from _removed);
select 'G08_EVERY_CHANGED_ROW_ONLY_DROPS_THE_CORROBORATION',
       (not exists (select 1 from _changed c join _a a using (zip, source_key) join _b b using (zip, source_key)
                     where not ('CORROBORATED_BY_DERIVED_ADDRESS' = any (b.quality_flags)
                                and not ('CORROBORATED_BY_DERIVED_ADDRESS' = any (a.quality_flags))
                                and array(select unnest(b.quality_flags) except select 'CORROBORATED_BY_DERIVED_ADDRESS' order by 1)
                                    = array(select unnest(a.quality_flags) order by 1)
                                and (row_to_json(a)::jsonb - 'quality_flags') = (row_to_json(b)::jsonb - 'quality_flags'))))::text,
       (select count(*) || ' corroborations withdrawn' from _changed);
select 'G09_EVERY_OTHER_ENTITYS_GEOGRAPHY_BYTE_IDENTICAL',
       (not exists (select (row_to_json(g)::jsonb - 'created_at' - 'updated_at')::text from public.gate_geo_before g
                     where g.canonical_entity_id not in (select canonical_entity_id from _ent)
                    except select (row_to_json(g)::jsonb - 'created_at' - 'updated_at')::text from public.dc_entity_geography g
                     where g.canonical_entity_id not in (select canonical_entity_id from _ent))
        and (select count(*) from public.gate_geo_before) = (select count(*) from public.dc_entity_geography))::text,
       (select count(*) || ' affected entities' from _ent) || ', ' || (select count(*) || ' OSM records' from _osm);
select 'G10_IDENTITY_UNCHANGED',
       ((select row(entities, links, decisions, links_md5) from public.gate_ident_before)
          = (select row((select count(*) from public.dc_canonical_entity), (select count(*) from public.dc_entity_observation),
                        (select count(*) from public.dc_identity_decision),
                        (select md5(string_agg(canonical_entity_id::text || ':' || home_signal_observation_id::text, ','
                                   order by canonical_entity_id::text || ':' || home_signal_observation_id::text collate "C"))
                           from public.dc_entity_observation))))::text,
       (select entities || ' entities, ' || links || ' links' from public.gate_ident_before);
select 'G11_ROWS_RECONCILE',
       ((select count(*) from _a) = (select count(*) from _b) - (select count(*) from _removed) + (select count(*) from _added))::text,
       (select count(*) from _b) || ' - ' || (select count(*) from _removed) || ' + ' || (select count(*) from _added)
         || ' = ' || (select count(*) from _a);
select 'G12_THE_CHANGE_IS_NOT_EMPTY', ((select count(*) from _flip) > 0)::text, (select count(*) || ' flips' from _flip);

-- the change list (for the receipt; the gate above is what decides)
select 'CHANGE', 'FLIP', geocoder_query from _flip order by geocoder_query collate "C";
select 'CHANGE', 'RESTORED', zip || ' ' || source_key || ' ' || coalesce(project_name, '') from _added order by zip, source_key;
select 'CHANGE', 'REMOVED', zip || ' ' || source_key || ' ' || coalesce(project_name, '') from _removed order by zip, source_key;
select 'CHANGE', 'UNCORROBORATED', c.zip || ' ' || c.source_key from _changed c order by 3;
