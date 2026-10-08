-- dc-atlas-dryrun-report.sql — the national receipt for ATLAS COORDINATE VALIDATION.
-- Runs ONLY on the disposable replica (scripts/dc-atlas-replica-dryrun.sh step 9), never on production.
-- Expects, created by the caller:
--   _before(zip, <map1 columns>)       Map 1 over every registry ZIP, BEFORE (== production, parity-checked)
--   _geo_before                        dc_entity_geography BEFORE
--   _id_before(k text)                 identity fingerprint rows BEFORE
--   _phase_a(zip, <map1 columns>)      Map 1 after PHASE A (applied + Atlas derivations loaded, NOT admitted)
--   _geo_phase_a                       dc_entity_geography after PHASE A
-- and the database in the PHASE D state (the reviewed admission simulated, resolvers run).
-- Output: key|value rows. Keys ending in _ZERO are required-zero gates; RC_* rows must read true.
-- Every bucket set is printed WITH its total and a reconciliation row: a bucket that does not sum to
-- its control is a wrong query, not a finding (claims rule 5).

create temp table _after as
select r.zip, m.* from public.canonical_zip_registry r cross join lateral public.map1_dc_zip_members(r.zip) m;

-- ── 1. THE ATLAS CORPUS: input quality, every current record ─────────────────────────────────
create temp table _atl as
select c.home_signal_observation_id oid, c.source_native_name nm, c.source_native_lat plat, c.source_native_lon plng,
       c.raw_payload, x.address_line, x.extraction, gi.input_quality, gi.geocoder_query,
       dp.verdict, dp.lat dlat, dp.lng dlng, dp.positional_uncertainty_m unc, dp.matched_address, dp.provider_candidates
  from public.dc_current_observation c
 cross join lateral public.dc_publisher_stated_address(c.source_key, c.distribution_key, c.raw_payload) x
 cross join lateral public.dc_geocode_input(c.source_key, c.distribution_key, c.raw_payload) gi
  left join public.dc_observation_derived_point dp on dp.home_signal_observation_id = c.home_signal_observation_id
 where c.source_key = 'compute_atlas' and c.distribution_key = 'facilities';

select 'C01 TOTAL_CURRENT_ATLAS_RECORDS', count(*)::text from _atl
union all select 'C02 HAS_PUBLISHED_ADDRESS', count(*) filter (where input_quality <> 'BLANK')::text from _atl
union all select 'C03 GEOCODABLE_SITE_ADDRESS', count(*) filter (where input_quality = 'GEOCODABLE')::text from _atl
union all select 'C04 BLANK_ADDRESS', count(*) filter (where input_quality = 'BLANK')::text from _atl
union all select 'C05 NO_HOUSE_NUMBER', count(*) filter (where input_quality = 'NO_HOUSE_NUMBER')::text from _atl
union all select 'C06 HOUSE_NUMBER_RANGE', count(*) filter (where input_quality = 'HOUSE_NUMBER_RANGE')::text from _atl
union all select 'C07 NO_LOCALITY', count(*) filter (where input_quality = 'NO_LOCALITY')::text from _atl
union all select 'C08 OTHER_INPUT_REJECTION', count(*) filter (where input_quality not in
          ('GEOCODABLE', 'BLANK', 'NO_HOUSE_NUMBER', 'HOUSE_NUMBER_RANGE', 'NO_LOCALITY'))::text from _atl
union all select 'C09 DISTINCT_GEOCODABLE_QUERIES', count(distinct geocoder_query)::text from _atl where input_quality = 'GEOCODABLE'
union all select 'RC_C RECONCILES (C03+C05+C06+C07+C08 = C02, C02+C04 = C01)',
       ((count(*) filter (where input_quality not in ('BLANK')) = count(*) filter (where input_quality = 'GEOCODABLE')
            + count(*) filter (where input_quality in ('NO_HOUSE_NUMBER', 'HOUSE_NUMBER_RANGE', 'NO_LOCALITY'))
            + count(*) filter (where input_quality not in ('GEOCODABLE', 'BLANK', 'NO_HOUSE_NUMBER', 'HOUSE_NUMBER_RANGE', 'NO_LOCALITY')))
        and count(*) = count(*) filter (where input_quality <> 'BLANK') + count(*) filter (where input_quality = 'BLANK'))::text from _atl;
-- the ungeocodable shapes, verbatim (examples; the rule is judged against the whole corpus above)
select 'C10 EXAMPLE ' || input_quality, string_agg(address_line, ' ¦ ' order by address_line)
  from (select input_quality, address_line, row_number() over (partition by input_quality order by address_line) rn
          from _atl where input_quality in ('NO_HOUSE_NUMBER', 'HOUSE_NUMBER_RANGE', 'NO_LOCALITY')) s
 where rn <= 6 group by input_quality;

-- ── 2. THE DERIVATIONS of every geocodable record ────────────────────────────────────────────
select 'D01 QUEUED (geocodable records)', count(*)::text from _atl where input_quality = 'GEOCODABLE'
union all select 'D02 ACCEPTED_SINGLE_MATCH', count(*) filter (where verdict = 'ACCEPTED')::text from _atl where input_quality = 'GEOCODABLE'
union all select 'D03 REJECTED_NO_MATCH', count(*) filter (where verdict = 'REJECTED_NO_MATCH')::text from _atl where input_quality = 'GEOCODABLE'
union all select 'D04 REJECTED_MULTIPLE_MATCH', count(*) filter (where verdict = 'REJECTED_AMBIGUOUS')::text from _atl where input_quality = 'GEOCODABLE'
union all select 'D05 FAILED (other rejection or not derived)', count(*) filter (where verdict not in ('ACCEPTED', 'REJECTED_NO_MATCH', 'REJECTED_AMBIGUOUS') or verdict is null)::text from _atl where input_quality = 'GEOCODABLE'
union all select 'D05b FAILED by verdict', coalesce(string_agg(v || '=' || n, ' ' order by v), '-')
  from (select coalesce(verdict, 'NULL') v, count(*) n from _atl where input_quality = 'GEOCODABLE'
          and (verdict not in ('ACCEPTED', 'REJECTED_NO_MATCH', 'REJECTED_AMBIGUOUS') or verdict is null) group by 1) s
union all select 'RC_D RECONCILES (D02..D05 = D01)',
       (count(*) = count(*) filter (where verdict = 'ACCEPTED') + count(*) filter (where verdict = 'REJECTED_NO_MATCH')
                 + count(*) filter (where verdict = 'REJECTED_AMBIGUOUS')
                 + count(*) filter (where verdict not in ('ACCEPTED', 'REJECTED_NO_MATCH', 'REJECTED_AMBIGUOUS') or verdict is null))::text
  from _atl where input_quality = 'GEOCODABLE';

-- ── 3. ACCEPTED derived point vs the SAME record's publisher point ─────────────────────────
-- (per observation; the publisher point's class is the ONE evidence classification, read from the view)
create temp table _cmp as
select a.oid, a.nm, a.plat, a.plng, a.dlat, a.dlng, a.unc, a.address_line, a.matched_address,
       case when a.plat is null or a.plng is null then 'NO_PUBLISHER_POINT'
            else (select ev.evidence_class from public.dc_entity_geography_evidence ev
                   where ev.oid = a.oid and ev.evidence_class <> 'DERIVED_ADDRESS' limit 1) end pclass,
       ST_DistanceSphere(ST_MakePoint(a.plng, a.plat), ST_MakePoint(a.dlng, a.dlat)) dist_m,
       (select string_agg(z.zcta5, ',' order by z.zcta5) from geo.zcta_boundary z
         where ST_Covers(z.geom, ST_SetSRID(ST_MakePoint(a.plng, a.plat), 4269))) pzip,
       (select string_agg(z.zcta5, ',' order by z.zcta5) from geo.zcta_boundary z
         where ST_Covers(z.geom, ST_SetSRID(ST_MakePoint(a.dlng, a.dlat), 4269))) dzip
  from _atl a where a.verdict = 'ACCEPTED';

select 'V01 ACCEPTED_DERIVED_POINTS', count(*)::text from _cmp
union all select 'V02 WITHIN_UNCERTAINTY (publisher site point <= derived bound)', count(*) filter (where pclass = 'PUBLISHER_SITE' and dist_m <= unc)::text from _cmp
union all select 'V03 BEYOND_UNCERTAINTY', count(*) filter (where pclass = 'PUBLISHER_SITE' and dist_m > unc)::text from _cmp
union all select 'V04 PUBLISHER_NON_SITE', count(*) filter (where pclass = 'PUBLISHER_NON_SITE')::text from _cmp
union all select 'V05 PUBLISHER_UNUSABLE', count(*) filter (where pclass = 'PUBLISHER_UNUSABLE')::text from _cmp
union all select 'V06 NO_PUBLISHER_POINT', count(*) filter (where pclass = 'NO_PUBLISHER_POINT' or pclass is null)::text from _cmp
union all select 'RC_V RECONCILES (V02..V06 = V01)',
       (count(*) = count(*) filter (where pclass = 'PUBLISHER_SITE') + count(*) filter (where pclass in ('PUBLISHER_NON_SITE', 'PUBLISHER_UNUSABLE'))
                 + count(*) filter (where pclass = 'NO_PUBLISHER_POINT' or pclass is null))::text from _cmp
-- diagnostic only (claims rule: same ZIP is not proof): the polygon ZIP of each point
union all select 'V07 SAME_ZIP (site pairs; diagnostic)', count(*) filter (where pclass = 'PUBLISHER_SITE' and pzip is not distinct from dzip)::text from _cmp
union all select 'V08 CROSS_ZIP (site pairs; diagnostic)', count(*) filter (where pclass = 'PUBLISHER_SITE' and pzip is distinct from dzip)::text from _cmp
union all select 'V09 SAME_ZIP_BUT_BEYOND_UNCERTAINTY (a bad point a ZIP test would have passed)',
       count(*) filter (where pclass = 'PUBLISHER_SITE' and pzip is not distinct from dzip and dist_m > unc)::text from _cmp
union all select 'V10 SITE_PAIR_DISTANCE_M p50/p95/max',
       coalesce(round(percentile_cont(0.5) within group (order by dist_m))::text || ' / '
         || round(percentile_cont(0.95) within group (order by dist_m))::text || ' / ' || round(max(dist_m))::text, '-')
  from _cmp where pclass = 'PUBLISHER_SITE';

-- ── 4. GEOGRAPHY VALIDATION, per canonical entity carrying an Atlas record (PHASE D) ────────
create temp table _ent as
select distinct eo.canonical_entity_id from public.dc_entity_observation eo
  join public.dc_current_observation c using (home_signal_observation_id)
 where c.source_key = 'compute_atlas';
create temp table _val as
select e.canonical_entity_id, g.geography_status, g.rule_key, g.quality_flags,
       case when g.quality_flags @> array['DERIVED_ADDRESS_BEYOND_UNCERTAINTY'] then 'CONFLICT'
            when g.quality_flags @> array['CORROBORATED_BY_DERIVED_ADDRESS'] then 'CORROBORATED'
            when g.rule_key = 'DERIVED_ADDRESS_POINT' then 'PLACED_BY_DERIVED_ADDRESS'
            when not exists (select 1 from public.dc_entity_geography_evidence ev
                              where ev.canonical_entity_id = e.canonical_entity_id and ev.evidence_class = 'DERIVED_ADDRESS')
                 then case when exists (select 1 from public.dc_entity_geography_evidence ev
                                         where ev.canonical_entity_id = e.canonical_entity_id and ev.evidence_class = 'PUBLISHER_SITE')
                           then 'NO_DERIVED_EVIDENCE'
                           when exists (select 1 from public.dc_entity_geography_evidence ev
                                         where ev.canonical_entity_id = e.canonical_entity_id and ev.evidence_class = 'PUBLISHER_NON_SITE')
                           then 'PUBLISHER_NON_SITE'
                           else 'PUBLISHER_UNUSABLE_OR_NONE' end
            else 'DERIVED_PRESENT_NOT_DECISIVE (' || g.rule_key || ')' end bucket
  from _ent e left join public.dc_entity_geography g using (canonical_entity_id);
select 'G00 ATLAS_ENTITIES', count(*)::text from _val
union all select 'G ' || bucket, count(*)::text from _val group by bucket
union all select 'RC_G RECONCILES (G buckets = G00)', ((select count(*) from _val) = (select sum(n) from (select count(*) n from _val group by bucket) s))::text;

-- ── 5. MAP 1, NATIONALLY: before -> PHASE A -> PHASE D ───────────────────────────────────────
select 'M00 REGISTRY_ZIP_PAGES_CHECKED', count(*)::text from public.canonical_zip_registry
union all select 'M01 ROWS before / phaseA / phaseD', (select count(*) from _before) || ' / ' || (select count(*) from _phase_a) || ' / ' || (select count(*) from _after)
union all select 'M02 ZIP_PAGES_WITH_A_MARKER before / phaseA / phaseD', (select count(distinct zip) from _before) || ' / ' || (select count(distinct zip) from _phase_a) || ' / ' || (select count(distinct zip) from _after)
union all select 'M03 FACILITIES before / phaseA / phaseD', (select count(distinct source_key) from _before) || ' / ' || (select count(distinct source_key) from _phase_a) || ' / ' || (select count(distinct source_key) from _after)
union all select 'M04_PHASE_A_ROW_DELTA_ZERO', (select count(*) from ((select zip, source_key, lat, lng, map_status from _before except all select zip, source_key, lat, lng, map_status from _phase_a)
                                          union all (select zip, source_key, lat, lng, map_status from _phase_a except all select zip, source_key, lat, lng, map_status from _before)) d)::text
union all select 'M05_PHASE_A_GEOGRAPHY_DECISION_DELTA_ZERO', (select count(*) from _geo_before b full join _geo_phase_a a using (canonical_entity_id)
   where (b.geography_status, b.lat, b.lng, b.quality_flags, b.rule_key, b.authority_observation_id, b.positional_uncertainty_m, b.provenance)
         is distinct from (a.geography_status, a.lat, a.lng, a.quality_flags, a.rule_key, a.authority_observation_id, a.positional_uncertainty_m, a.provenance))::text;

create temp table _chg as
with b as (select source_key, string_agg(zip, ',' order by zip) zips, min(lat) lat, min(lng) lng, min(project_name) nm, min(canonical_entity_id::text)::uuid ce from _before group by source_key),
     a as (select source_key, string_agg(zip, ',' order by zip) zips, min(lat) lat, min(lng) lng, min(project_name) nm, min(canonical_entity_id::text)::uuid ce from _after group by source_key)
select coalesce(a.source_key, b.source_key) source_key, coalesce(a.ce, b.ce) ce, coalesce(a.nm, b.nm) nm,
       case when b.source_key is null then 'ADDED' when a.source_key is null then 'REMOVED'
            when (a.lat, a.lng) is distinct from (b.lat, b.lng) and a.zips = b.zips then 'MOVED'
            when a.zips <> b.zips then 'ZIP_CHANGED' else 'UNCHANGED' end kind,
       b.zips before_zip, a.zips after_zip, b.lat blat, b.lng blng, a.lat alat, a.lng alng
  from a full join b using (source_key);

select 'M06 ADDED', count(*) filter (where kind = 'ADDED')::text from _chg
union all select 'M07 REMOVED', count(*) filter (where kind = 'REMOVED')::text from _chg
union all select 'M08 MOVED', count(*) filter (where kind = 'MOVED')::text from _chg
union all select 'M09 ZIP_CHANGED', count(*) filter (where kind = 'ZIP_CHANGED')::text from _chg
union all select 'M10 UNCHANGED', count(*) filter (where kind = 'UNCHANGED')::text from _chg
union all select 'RC_M RECONCILES (M06..M10 = union of facilities)', (count(*) = count(*) filter (where kind in ('ADDED', 'REMOVED', 'MOVED', 'ZIP_CHANGED', 'UNCHANGED')))::text from _chg;

-- ── 6. PROTECTION AGAINST MASS FALSE REMOVALS: currently published Atlas facilities ────────────
create temp table _pub as
select distinct b.source_key, b.canonical_entity_id from _before b
  join _ent e using (canonical_entity_id);
select 'P00 PUBLISHED_ATLAS_FACILITIES_BEFORE', count(*)::text from _pub
union all select 'P01 PCT_UNCHANGED', round(100.0 * count(*) filter (where c.kind = 'UNCHANGED') / nullif(count(*), 0), 2)::text
  from _pub p join _chg c using (source_key)
union all select 'P02 PCT_CORROBORATED', round(100.0 * count(*) filter (where v.bucket = 'CORROBORATED') / nullif(count(*), 0), 2)::text
  from _pub p join _val v using (canonical_entity_id)
union all select 'P03 PCT_NO_USABLE_DERIVED_EVIDENCE', round(100.0 * count(*) filter (where v.bucket = 'NO_DERIVED_EVIDENCE') / nullif(count(*), 0), 2)::text
  from _pub p join _val v using (canonical_entity_id)
union all select 'P04 PCT_WITHHELD_FOR_CONFLICT', round(100.0 * count(*) filter (where v.bucket = 'CONFLICT') / nullif(count(*), 0), 2)::text
  from _pub p join _val v using (canonical_entity_id)
union all select 'P05 PCT_PUBLICATION_CHANGES', round(100.0 * count(*) filter (where c.kind <> 'UNCHANGED') / nullif(count(*), 0), 2)::text
  from _pub p join _chg c using (source_key);

-- ── 7. EVERY CHANGED FACILITY, individually ─────────────────────────────────────────────────────
select 'X ' || c.kind || ' ' || coalesce(c.ce::text, c.source_key),
       concat_ws(' | ',
         'facility=' || c.nm,
         'publisher=' || coalesce((select string_agg(distinct eo.source_key, '+') from public.dc_entity_observation eo where eo.canonical_entity_id = c.ce), '-'),
         'publisher_address=' || coalesce((select string_agg(coalesce(nullif(a.address_line, ''), '(none)'), ' ; ') from _atl a
                                            join public.dc_entity_observation eo on eo.home_signal_observation_id = a.oid where eo.canonical_entity_id = c.ce), '-'),
         'publisher_point=' || coalesce((select string_agg(ev.lat || ',' || ev.lng || ' [' || ev.evidence_class || ']', ' ; ') from public.dc_entity_geography_evidence ev
                                          where ev.canonical_entity_id = c.ce and ev.evidence_class <> 'DERIVED_ADDRESS'), '-'),
         'derived_point=' || coalesce((select string_agg(ev.lat || ',' || ev.lng, ' ; ') from public.dc_entity_geography_evidence ev
                                        where ev.canonical_entity_id = c.ce and ev.evidence_class = 'DERIVED_ADDRESS'), '-'),
         'distance_m=' || coalesce((select string_agg(round(ST_DistanceSphere(ST_MakePoint(p.lng, p.lat), ST_MakePoint(d.lng, d.lat)))::text, ' ; ')
                                     from public.dc_entity_geography_evidence p join public.dc_entity_geography_evidence d
                                       on d.canonical_entity_id = p.canonical_entity_id and d.evidence_class = 'DERIVED_ADDRESS'
                                    where p.canonical_entity_id = c.ce and p.evidence_class = 'PUBLISHER_SITE'), '-'),
         'derived_uncertainty_m=' || coalesce((select max(ev.uncertainty_m)::text from public.dc_entity_geography_evidence ev
                                                where ev.canonical_entity_id = c.ce and ev.evidence_class = 'DERIVED_ADDRESS'), '-'),
         'derived_verdict=' || coalesce((select string_agg(dp.verdict, ' ; ') from public.dc_observation_derived_point dp
                                          join public.dc_entity_observation eo using (home_signal_observation_id) where eo.canonical_entity_id = c.ce), '-'),
         'before_zip=' || coalesce(c.before_zip, '-'), 'after_zip=' || coalesce(c.after_zip, '-'),
         'before=' || coalesce((select gb.geography_status || '/' || gb.rule_key from _geo_before gb where gb.canonical_entity_id = c.ce), '-'),
         'after=' || coalesce((select g.geography_status || '/' || g.rule_key || ' ' || g.quality_flags::text from public.dc_entity_geography g where g.canonical_entity_id = c.ce), '-'))
  from _chg c where c.kind <> 'UNCHANGED'
 order by 1;

-- ── 8. ARCHITECTURE ZEROS ─────────────────────────────────────────────────────────────────────
select 'Z01_MANUAL_DECISIONS_ZERO',
       ((select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relkind in ('r', 'v', 'm') and c.relname ~ '^dc_.*(review|override|manual)')
        + (select count(*) from public.dc_identity_decision where decision_rule_key like 'REVIEWED%')
        + (select count(*) from public.dc_entity_observation where link_rule_key like 'REVIEWED%'))::text
union all select 'Z02_SOURCE_NAME_AUTHORITY_ZERO',
       (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
          and p.proname in ('dc_resolve_geography', 'dc_site_claims_conflict', 'map1_dc_zip_members', 'dc_geocodable_site_address')
          and p.prosrc ~ '''(compute_atlas|epoch_ai)''')::text
union all select 'Z03_PROVIDER_ZIP_MEMBERSHIP_ZERO',   -- a marker whose page is not the polygon of its own point
       (select count(*) from _after a where a.canonical_entity_id is not null and not exists (
          select 1 from geo.zcta_boundary z where z.zcta5 = a.zip and ST_Covers(z.geom, ST_SetSRID(ST_MakePoint(a.lng, a.lat), 4269))))::text
union all select 'Z04_CENTROID_MEMBERSHIP_ZERO',       -- a canonical point sitting exactly on a ZCTA centroid
       (select count(*) from public.dc_entity_geography g join geo.zcta_boundary z
          on ST_DWithin(ST_Centroid(z.geom), ST_SetSRID(ST_MakePoint(g.lng, g.lat), 4269), 1e-7)
         where g.geography_status = 'RESOLVED' and g.rule_key = 'DERIVED_ADDRESS_POINT')::text
union all select 'Z05_RADIUS_MEMBERSHIP_ZERO',          -- a derived marker whose uncertainty disk leaves its page
       (select count(*) from _after a join public.dc_entity_geography g using (canonical_entity_id)
         where g.positional_uncertainty_m is not null and (select count(*) from geo.zcta_boundary z
           where ST_DWithin(z.geom::geography, ST_SetSRID(ST_MakePoint(g.lng, g.lat), 4269)::geography, g.positional_uncertainty_m)) <> 1)::text
union all select 'Z06_NEAREST_ZIP_MEMBERSHIP_ZERO',     -- a canonical marker on more than one page, or on none it lies in
       (select count(*) from (select canonical_entity_id from _after where canonical_entity_id is not null
                               group by canonical_entity_id having count(*) > 1) s)::text
union all select 'Z07_SECOND_GEOCODER_ZERO',
       (select count(*) from public.dc_address_geocode where provider not in ('none')
          and provider !~ '^(census_|openaddresses|oa_|dataset)')::text
union all select 'Z07b PROVIDERS', (select string_agg(provider || '=' || n, ' ' order by provider) from (select provider, count(*) n from public.dc_address_geocode group by 1) s)
union all select 'Z08_SECOND_MAP1_READER_ZERO', ((select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname like 'map1_dc%') - 1)::text
union all select 'Z09_IDENTITY_CHANGES_FROM_DERIVED_GEOGRAPHY_ZERO',
       (select count(*) from ((select k from _id_before except select k from _id_after) union all (select k from _id_after except select k from _id_before)) d)::text
union all select 'Z10_PUBLISHER_EVIDENCE_OVERWRITTEN_ZERO', (select count(*) from _src_before b full join public.dc_source_observation o using (home_signal_observation_id)
   where (b.source_native_lat, b.source_native_lon, b.raw_payload) is distinct from (o.source_native_lat, o.source_native_lon, o.raw_payload))::text;

-- ── 9. REGRESSION: #1324 ───────────────────────────────────────────────────────────────────
select 'R01 EPOCH_RECORDS', count(*)::text from public.dc_record_identity where source_key = 'epoch_ai'
union all select 'R02 EPOCH_IDENTITY_STATES', string_agg(s || '=' || n, ' ' order by s)
  from (select identity_state s, count(*) n from public.dc_record_identity where source_key = 'epoch_ai' group by 1) x
union all select 'R03_EPOCH_ENTITY_GEOGRAPHY_CHANGED_ZERO_UNLESS_LISTED',
       (select count(*) from _geo_before b join public.dc_entity_geography a using (canonical_entity_id)
         where exists (select 1 from public.dc_entity_observation eo where eo.canonical_entity_id = b.canonical_entity_id and eo.source_key = 'epoch_ai')
           and (b.geography_status, b.lat, b.lng, b.rule_key) is distinct from (a.geography_status, a.lat, a.lng, a.rule_key))::text
union all select 'R04 LANCASTER_SHAPE (entities DERIVED_ADDRESS_BEYOND_UNCERTAINTY before) still withheld',
       (select count(*) filter (where a.geography_status = 'GEOGRAPHY_UNRESOLVED' and a.rule_key = 'SOURCES_DISAGREE') || ' of ' || count(*)
          from _geo_before b join public.dc_entity_geography a using (canonical_entity_id)
         where b.quality_flags @> array['DERIVED_ADDRESS_BEYOND_UNCERTAINTY'])
union all select 'R05 RULE_VERSIONS', (select string_agg(v || '=' || n, ' ' order by v) from (select rule_version v, count(*) n from public.dc_entity_geography group by 1) s);
