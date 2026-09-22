-- Bounded independent check of the Fairfax "499 Token Required": 2 requests, from Supabase's egress
-- (the path get-address-report uses), not the GitHub runner's. Read-only apart from pg_net's queue.
with req as (
  select 'layer1_meta' as label, net.http_get(
    'https://www.fairfaxcounty.gov/mercator/rest/services/LDS/DevelopmentTracker/FeatureServer/1?f=json') as id
  union all
  select 'layer1_record', net.http_get(
    'https://www.fairfaxcounty.gov/mercator/rest/services/LDS/DevelopmentTracker/FeatureServer/1/query?where='
    || 'RECORDID%3D%27SP-2023-00087%27&outFields=RECORDID,APPTYPEALIAS,PROJECT_NAME&returnGeometry=false&f=json')
)
select json_agg(json_build_object('label',label,'id',id)) as requests,
       (select json_agg(column_name order by column_name collate "C") from information_schema.columns
         where table_schema='public' and table_name='app_projects'
           and (data_type like 'timestamp%' or column_name in ('registry_id','source_key'))) as ts_cols
from req;
