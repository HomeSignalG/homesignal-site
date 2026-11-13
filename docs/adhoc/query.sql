select table_name, string_agg(column_name, ',' order by ordinal_position) cols
from information_schema.columns
where table_schema='public' and table_name in ('app_projects','alerts','meetings','source_documents','acquisition_runs','dc_source','dc_source_observation','dc_canonical_entity','dc_entity_geography','official_record','development_project','development_project_link','gov_actions','feeds')
group by 1 order by 1;
