select distinct on (source_key) source_key, registry_id, zip, type, type_raw, status, left(name,200) name, left(coalesce(scope_text,''),200) scope_text
from public.app_projects
where record_kind='development'
  and (coalesce(name,'')||' '||coalesce(type_raw,'')||' '||coalesce(scope_text,'')) ~* '(data ?cent(er|re)s?|hyperscale|colocation|server farm|super-?comput|\mhpc\M|comput(e|ing) facilit)'
order by source_key, id;
