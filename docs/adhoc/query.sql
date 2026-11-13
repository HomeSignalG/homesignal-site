select json_agg(json_build_array(source_key, type, type_raw, status, left(name,90), left(coalesce(scope_text,''),50))) j from (
select distinct on (source_key) source_key, type, type_raw, status, name, scope_text
from public.app_projects
where record_kind='development'
  and (coalesce(name,'')||' '||coalesce(type_raw,'')||' '||coalesce(scope_text,'')) ~* '(data ?cent(er|re)s?|hyperscale|colocation|server farm|super-?comput|\mhpc\M|comput(e|ing) facilit)'
order by source_key, id offset 40 limit 40) x;
