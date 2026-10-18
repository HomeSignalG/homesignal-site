-- Each row: name | pass (t/f) | detail
with
b466 as (select * from public.zip_government_bodies('98466')),
b444 as (select * from public.zip_government_bodies('98444')),
b411 as (select * from public.zip_government_bodies('98411')),
b333 as (select * from public.zip_government_bodies('98333')),
b601 as (select * from public.zip_government_bodies('84601')),
b003 as (select * from public.zip_government_bodies('84003')),
b005 as (select * from public.zip_government_bodies('84005'))
select * from (values
 ('01 98466 lists the county and three cities', (select count(*) = 4 from b466), (select string_agg(name, ', ' order by sort_key) from b466)),
 ('02 98466 cities ordered by share', (select array_agg(name order by sort_key) from b466 where body_kind='city') = array['University Place','Fircrest','Tacoma'], ''),
 ('03 98466 Tacoma resolves to its community', (select community_id = '00000000-0000-0000-0000-0000000000a1' and has_source from b466 where name='Tacoma'), ''),
 ('04 98466 a city with no community is shown with no community, never borrowed', (select community_id is null and not has_source from b466 where name='University Place'), ''),
 ('05 98466 county land share is what no city covers (0)', (select area_share = 0 from b466 where body_kind='county'), (select area_share::text from b466 where body_kind='county')),
 ('06 98444 a CDP is not a government', (select count(*) = 0 from b444 where name ilike '%parkland%'), ''),
 ('07 98444 a 0.5% city is below the floor', (select count(*) = 0 from b444 where name ilike '%lakewood%'), ''),
 ('08 98444 a funcstat F place is not a government', (select count(*) = 0 from b444 where name ilike '%balance%'), ''),
 ('09 98444 county share subtracts every incorporated place, even below the floor', (select area_share = 0.805 from b444 where body_kind='county'), (select area_share::text from b444 where body_kind='county')),
 ('10 98444 Tacoma 19%', (select area_share = 0.19 from b444 where name='Tacoma'), ''),
 ('11 98411 PO box: not measured, county only, no share', (select count(*) = 1 and bool_and(not measured) and bool_and(area_share is null) from b411), ''),
 ('12 98333 fully unincorporated: county only, share 1', (select count(*) = 1 and bool_and(measured) and bool_and(area_share = 1) from b333), ''),
 ('13 84601 a chain city with no Census code still shows, by its own community, with no share (nothing that delivers today disappears)', (select count(*) = 1 and bool_and(area_share is null) from b601 where community_id = '00000000-0000-0000-0000-0000000000a2'), (select string_agg(name||':'||coalesce(area_share::text,'-'), ', ') from b601)),
 ('14 84601 the unmatched Census place shows too (no community yet)', (select count(*) = 1 from b601 where community_id is null and census_place_geoid='4962470'), ''),
 ('15 84003 a coded chain city shows once, with its share', (select count(*) = 1 and bool_and(area_share = 0.9) from b003 where name='American Fork'), (select string_agg(name, ', ') from b003)),
 ('16 84005 a root city is not listed twice', (select count(*) = 1 from b005), (select string_agg(body_kind||':'||name, ', ') from b005)),
 ('17 unknown and malformed ZIPs return nothing', (select count(*) = 0 from public.zip_government_bodies('00000')) and (select count(*) = 0 from public.zip_government_bodies('9846x')), ''),
 ('18 anon may execute the function', has_function_privilege('anon','public.zip_government_bodies(text)','execute'), ''),
 ('19 anon may not read the overlap table', not has_table_privilege('anon','geo.zcta_place_overlap','select'), ''),
 ('20 shares are land area 0..1', (select bool_and(area_share between 0 and 1) from (select area_share from b466 union all select area_share from b444) s where area_share is not null), '')
) t(name, pass, detail);
