-- =====================================================================================
-- STEP 11 (C5): EVERY MAP 1 DATA-CENTRE MARKER, ITS ADDRESS-CHECK STATE AND ONE DERIVED REASON.
--
-- One row per marker on every canonical ZIP page, exactly as public.map1_dc_zip_members draws it.
-- Each marker gets exactly ONE state:
--   CHECKED                   its pin is confirmed by, or placed at, its publisher's own address
--   CHECKABLE_NO_CLEAN_MATCH  an address is stated and geocodable, the shared ladder gave no clean match
--   NOT_CHECKABLE             the publisher states no usable address
--   PENDING                   a geocodable address waits for the geocoder
-- and ONE reason code, with the shared rule's own reason text.
--
-- DECIDES NOTHING. Every value is read from a shared decision already in production:
--   the Map 1 reader (what is drawn), dc_entity_geography (placement and its flags),
--   dc_observation_derived_point (the shared input policy + verdict, canonical layer),
--   dc_osm_address_check (the same policy + verdict + conflict rule, OpenStreetMap layer).
-- A second classifier of any of those would be a parallel truth path; this view only labels.
--
-- Coverage (the address-check measure of done) = CHECKED / (CHECKED + CHECKABLE_NO_CLEAN_MATCH + PENDING).
-- Service-role only: it walks every registry ZIP through the Map 1 reader.
-- =====================================================================================

create or replace view public.dc_map1_address_check with (security_invoker = true) as
with m as (
  select r.zip, x.source_key, x.canonical_entity_id, x.publication_basis, x.project_name
    from public.canonical_zip_registry r
   cross join lateral public.map1_dc_zip_members(r.zip) x),
-- a canonical marker's most-checkable CURRENT observation (the one a check would use)
best as (
  select distinct on (eo.canonical_entity_id)
         eo.canonical_entity_id, dp.input_quality, dp.verdict, dp.input_reason, dp.verdict_reason
    from public.dc_entity_observation eo
    join public.dc_current_observation c on c.home_signal_observation_id = eo.home_signal_observation_id
    join public.dc_observation_derived_point dp on dp.home_signal_observation_id = eo.home_signal_observation_id
   order by eo.canonical_entity_id,
            (dp.input_quality = 'GEOCODABLE') desc, (dp.verdict = 'ACCEPTED') desc,
            (dp.verdict is not null) desc, eo.home_signal_observation_id),
lbl as (
  select m.zip, m.source_key, m.canonical_entity_id, m.publication_basis, m.project_name,
         case
           when m.canonical_entity_id is not null then case
             when g.rule_key like 'DERIVED%'
               then array['CHECKED', 'PLACED_AT_OWN_ADDRESS', 'placed at the point its publisher''s own address geocodes to']
             when 'CORROBORATED_BY_DERIVED_ADDRESS' = any (g.quality_flags)
               then array['CHECKED', 'CORROBORATED_BY_OWN_ADDRESS', 'its publisher''s own address geocodes within the calibrated distance of the pin']
             when b.input_quality is null
               then array['NOT_CHECKABLE', 'NO_ADDRESS_FIELD', 'no current record of this site carries an address the pipeline reads']
             when b.input_quality <> 'GEOCODABLE'
               then array['NOT_CHECKABLE', b.input_quality, b.input_reason]
             when b.verdict = 'NOT_YET_GEOCODED'
               then array['PENDING', 'NOT_YET_GEOCODED', b.verdict_reason]
             when b.verdict <> 'ACCEPTED'
               then array['CHECKABLE_NO_CLEAN_MATCH', b.verdict, b.verdict_reason]
             else array['CHECKABLE_NO_CLEAN_MATCH', 'ACCEPTED_NOT_JUDGED',
                        'a derived point exists but the placement rule did not judge it against this pin']
           end
           else case
             when k.check_outcome = 'CORROBORATED'
               then array['CHECKED', 'CORROBORATED_BY_OWN_ADDRESS', 'its own address geocodes within the calibrated distance of the pin']
             when k.check_outcome is null
               then array['NOT_CHECKABLE', 'NO_CHECK_ROW', 'the OpenStreetMap record has no address-check row']
             when k.check_outcome = 'UNCHECKED_NOT_YET_GEOCODED'
               then array['PENDING', 'NOT_YET_GEOCODED', k.verdict_reason]
             when k.check_outcome like 'UNCHECKED\_REJECTED\_%'
               then array['CHECKABLE_NO_CLEAN_MATCH', substr(k.check_outcome, 11), k.verdict_reason]
             when k.check_outcome = 'UNCHECKED_NO_SITE_CLAIM'
               then array['NOT_CHECKABLE', 'NO_SITE_CLAIM', 'the pin is an area, not a site, so its address is not judged against it']
             when k.check_outcome like 'UNCHECKED\_%'
               then array['NOT_CHECKABLE', substr(k.check_outcome, 11), k.verdict_reason]
             else array['CHECKABLE_NO_CLEAN_MATCH', k.check_outcome, k.verdict_reason]
           end
         end as v
    from m
    left join public.dc_entity_geography g on g.canonical_entity_id = m.canonical_entity_id
    left join best b on b.canonical_entity_id = m.canonical_entity_id
    left join public.national_dc_records n on m.canonical_entity_id is null and n.source_key = m.source_key
    left join public.dc_osm_address_check k on k.osm_record_id = n.id)
select zip, source_key, canonical_entity_id,
       case when publication_basis = 'canonical' then 'canonical' else 'openstreetmap' end as layer,
       project_name, v[1] as check_state, v[2] as reason_code, v[3] as reason
  from lbl;

revoke all on public.dc_map1_address_check from anon, authenticated;

comment on view public.dc_map1_address_check is
'STEP 11 (C5). One row per Map 1 data-centre marker: CHECKED / CHECKABLE_NO_CLEAN_MATCH / NOT_CHECKABLE /
PENDING, one reason code and the shared rule''s reason text. Labels only: every value is read from the Map 1
reader, dc_entity_geography, dc_observation_derived_point and dc_osm_address_check. Service-role only.';
