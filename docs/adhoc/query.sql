-- READ ONLY. Workstream D: source coverage and freshness for the 32 existing Denton ZIP pages (serving membership).
with z as (select unnest(array['75007','75010','75022','75027','75028','75029','75033','75036','75056','75057','75065','75067','75068','75077','76201','76202','76203','76204','76205','76206','76207','76208','76209','76210','76226','76227','76247','76249','76258','76259','76262','76266']) zip),
m as (select m.zcta5::text zip, m.source_key from geo.n5_serving_membership m join z on z.zip = m.zcta5::text),
j as (select m.zip, m.source_key, p.registry_id, p.submitted_at, p.status, p.type
      from m left join lateral (select registry_id, submitted_at, status, type from public.app_projects a where a.source_key = m.source_key order by a.id limit 1) p on true)
select zip, count(*) members,
  count(*) filter (where registry_id='denton-county-dev-permits') county_permits_stale,
  count(*) filter (where submitted_at > now() - interval '365 days') filed_365d,
  count(*) filter (where submitted_at > now() - interval '365 days' and registry_id<>'denton-county-dev-permits') cur_other_365d,
  string_agg(distinct registry_id, ',') filter (where submitted_at > now() - interval '365 days') current_registries,
  max(submitted_at)::date newest_filed,
  (select count(*) from z) control_zips
from j right join z using (zip) group by zip order by zip;
