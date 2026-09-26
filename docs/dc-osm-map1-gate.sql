-- =====================================================================================
-- C3c AUTOMATED GATE — the Map 1 change the OSM layer check makes, proven on a REPLICA of production.
-- Founder ruling (2026-09-26): no manual list review; this gate decides. Run by
-- scripts/dc-osm-map1-gate.sh AFTER it has:
--   built a replica from this checkout's DDL of record, applied docs/dc-osm-map1-rollback.sql so the
--   replica carries production's exact pre-C3c definitions, copied production's rows read-only, and
--   proven the replica's Map 1 equals production's row for row  -> public.gate_before;
--   then applied docs/dc-osm-map1-apply.sql (the byte-identical production artifact)
--                                                               -> public.gate_after.
-- Every check is a name|pass|detail row; the script refuses on any pass that is not 't'.
-- The PREDICTION is written independently of the reader: from gate_before and the check view alone.
-- =====================================================================================
\set ON_ERROR_STOP 1
create temp table _k as
select k.osm_record_id, n.source_key, k.check_outcome, k.admitted
  from public.dc_osm_address_check k join public.national_dc_records n on n.id = k.osm_record_id;
create temp table _b as select b.*, k.check_outcome, k.admitted from public.gate_before b left join _k k using (source_key);
create temp table _a as select * from public.gate_after;
-- the prediction: an admitted SOURCES_DISAGREE OSM row disappears; an admitted CORROBORATED OSM row
-- gains the canonical flag; every other row, and every column but that flag, is unchanged.
create temp table _pred as
select b.zip, b.source_key, b.lat, b.lng, b.map_status, b.publication_basis, b.canonical_entity_id,
       case when b.publication_basis = 'legacy_osm_compat' and b.admitted and b.check_outcome = 'CORROBORATED'
            then array['CORROBORATED_BY_DERIVED_ADDRESS']::text[] else b.quality_flags end as quality_flags
  from _b b
 where not (b.publication_basis = 'legacy_osm_compat' and coalesce(b.admitted, false) and b.check_outcome = 'SOURCES_DISAGREE');
create temp table _removed as
select b.* from _b b where not exists (select 1 from _a a where a.zip = b.zip and a.source_key = b.source_key);

select 'G01_BEFORE_IS_NOT_EMPTY', (select count(*) > 0 from _b)::text,
       (select count(*) || ' rows, ' || count(*) filter (where publication_basis = 'legacy_osm_compat') || ' OSM' from _b);
select 'G02_OSM_IS_ADMITTED_AFTER', (select bool_and(admitted) from _k)::text, (select count(*) || ' checks' from _k);
select 'G03_AFTER_EQUALS_PREDICTION_EXACTLY',
       (not exists (select zip, source_key, lat, lng, map_status, publication_basis, canonical_entity_id, quality_flags from _pred
                    except select zip, source_key, lat, lng, map_status, publication_basis, canonical_entity_id, quality_flags from _a)
        and not exists (select zip, source_key, lat, lng, map_status, publication_basis, canonical_entity_id, quality_flags from _a
                    except select zip, source_key, lat, lng, map_status, publication_basis, canonical_entity_id, quality_flags from _pred)
        and (select count(*) from _a) = (select count(*) from _pred))::text,
       (select count(*) || ' predicted' from _pred) || ' / ' || (select count(*) || ' after' from _a);
select 'G04_NO_ROW_ADDED',
       (not exists (select 1 from _a a where not exists (select 1 from _b b where b.zip = a.zip and b.source_key = a.source_key)))::text, null;
select 'G05_NO_PIN_MOVED',
       (not exists (select 1 from _a a join _b b using (zip, source_key)
                     where a.lat is distinct from b.lat or a.lng is distinct from b.lng))::text, null;
select 'G06_EVERY_REMOVED_ROW_IS_AN_ADMITTED_OSM_DISAGREEMENT',
       (not exists (select 1 from _removed where not (publication_basis = 'legacy_osm_compat' and admitted and check_outcome = 'SOURCES_DISAGREE')))::text,
       (select count(*) || ' removed' from _removed);
select 'G07_EVERY_FLAG_CHANGE_IS_AN_ADMITTED_OSM_CORROBORATION',
       (not exists (select 1 from _a a join _b b using (zip, source_key)
                     where a.quality_flags is distinct from b.quality_flags
                       and not (b.publication_basis = 'legacy_osm_compat' and b.admitted and b.check_outcome = 'CORROBORATED'
                                and a.quality_flags = array['CORROBORATED_BY_DERIVED_ADDRESS']::text[])))::text,
       (select count(*) || ' flagged' from _a a join _b b using (zip, source_key) where a.quality_flags is distinct from b.quality_flags);
select 'G08_CANONICAL_ROWS_BYTE_IDENTICAL',
       (not exists (select row_to_json(t)::text from (select * from public.gate_before where publication_basis = 'canonical') t
                    except select row_to_json(t)::text from (select * from public.gate_after where publication_basis = 'canonical') t)
        and (select count(*) from public.gate_before where publication_basis = 'canonical')
          = (select count(*) from public.gate_after where publication_basis = 'canonical'))::text,
       (select count(*) || ' canonical rows' from public.gate_after where publication_basis = 'canonical');
select 'G09_EVERY_OTHER_COLUMN_UNCHANGED',
       (not exists (select 1 from public.gate_after a join public.gate_before b using (zip, source_key)
                     where (row_to_json(a)::jsonb - 'quality_flags') is distinct from (row_to_json(b)::jsonb - 'quality_flags')))::text, null;
select 'G10_WITHHELD_AT_MOST_THE_DISAGREEMENTS',
       ((select count(distinct source_key) from _removed)
          <= (select count(*) from _k where admitted and check_outcome = 'SOURCES_DISAGREE'))::text,
       (select count(distinct source_key) || ' records withheld' from _removed) || ' / '
         || (select count(*) || ' SOURCES_DISAGREE' from _k where admitted and check_outcome = 'SOURCES_DISAGREE');
select 'G11_ROWS_RECONCILE',
       ((select count(*) from _b) = (select count(*) from _a) + (select count(*) from _removed))::text,
       (select count(*) from _b) || ' = ' || (select count(*) from _a) || ' + ' || (select count(*) from _removed);

-- the change list (for the receipt; the gate above is what decides)
select 'CHANGE', 'WITHHELD', zip || ' ' || source_key || ' ' || coalesce(project_name, '') from _removed order by zip, source_key;
select 'CHANGE_BY_ZIP', zip, count(*) filter (where a.quality_flags <> b.quality_flags) || ' flagged'
  from _a a join _b b using (zip, source_key) group by zip
 having count(*) filter (where a.quality_flags <> b.quality_flags) > 0 order by zip;
