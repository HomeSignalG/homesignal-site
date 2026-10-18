with t466 as (select * from public.zip_government_topics('98466')),
     t601 as (select * from public.zip_government_topics('84601'))
select * from (values
 ('T1 98466 the county offers its own topics on both streams', (select count(*) = 2 from t466 where body_kind='county' and topic='County Commission & county business'), ''),
 ('T2 98466 Tacoma notices are its own labels', (select array_agg(topic) = array['City government (Tacoma)'] from t466 where name='Tacoma' and stream='notices'), ''),
 ('T3 98466 Tacoma meetings are the six canonical topics', (select count(*) = 6 and bool_and(topic not like 'City government%') from t466 where name='Tacoma' and stream='meetings'), ''),
 ('T4 98466 a city with no community offers nothing', (select count(*) = 0 from t466 where name='University Place'), ''),
 ('T5 84601 Provo meetings include County Commission & county business (where its 32 meetings are filed)', (select count(*) = 1 from t601 where community_id='00000000-0000-0000-0000-0000000000a2' and stream='meetings' and topic='County Commission & county business'), ''),
 ('T7 a city community with no source yet offers nothing (not even the six meeting topics)', (select count(*) = 0 from t466 where name='Fircrest'), ''),
 ('T6 every offered row names a community', (select bool_and(community_id is not null) from t466), '')
) x(name, pass, detail);
;
select 'V1 the view lists Tacoma on 98466 and 98444, and nothing uncoded', (select count(*) = 2 from public.zip_government_city_links where community_id='00000000-0000-0000-0000-0000000000a1') and (select count(*) = 0 from public.zip_government_city_links where community_id is null), '';
select 'V2 anon may read the view', has_table_privilege('anon','public.zip_government_city_links','select'), '';
select 'V3 the view never lists a place below 1% of the ZIP', (select count(*) = 0 from public.zip_government_city_links where place_geoid='5399999'), '';
