-- M14_second_resolver: rolled-back LIVE mutation, judged by the ingest gate's OWN facts SQL (read from
-- scripts/check_dc_step2a_isolation.py programmatically, never retyped). RAISES -> rolls back.
do $mut$
declare facts json;
begin
  execute $n$create function public.zz_resolve_v2() returns void language sql as $b$ insert into public.dc_canonical_entity (entity_grain, classification, rule_version) select 'SITE','CONFIRMED_DC',1 where false $b$$n$;
  execute $f$select json_build_object(
  'objects', (
    select coalesce(json_agg(n order by n collate "C"), '[]'::json) from (
      select c.relname::text as n
        from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
       where ns.nspname = 'public' and c.relkind in ('r','p','v','m')
         and left(c.relname, 3) = 'dc_'
      union
      select p.proname::text
        from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
       where ns.nspname = 'public' and left(p.proname, 3) = 'dc_'
    ) s
  ),
  'rpc_params', (
    select coalesce(json_agg(parameter_name order by parameter_name::text collate "C"),
                    '[]'::json)
      from information_schema.parameters
     where specific_schema = 'public'
       and specific_name ~ '^dc_complete_acquisition_[0-9]+$'
       and parameter_mode = 'IN'
  ),
  'resident_grants', (
    select coalesce(json_agg(g order by g collate "C"), '[]'::json) from (
      select distinct (table_name::text || ':' || grantee::text || ':' || privilege_type::text) as g
        from information_schema.role_table_grants
       where table_schema = 'public' and left(table_name::text, 3) = 'dc_'
         and grantee in ('anon', 'authenticated')
    ) s
  ),
  'relations', (
    select coalesce(json_agg(json_build_object(
        'name', c.relname::text, 'kind', c.relkind::text,
        'invoker', coalesce(array_to_string(c.reloptions, ','), '') like '%security_invoker=true%',
        'triggers', (select count(*) from pg_trigger t where t.tgrelid = c.oid and not t.tgisinternal),
        'trigger_fns', (select coalesce(json_agg(distinct p.proname::text collate "C" order by p.proname::text collate "C"), '[]'::json)
                          from pg_trigger t join pg_proc p on p.oid = t.tgfoid
                         where t.tgrelid = c.oid and not t.tgisinternal and t.tgenabled <> 'D'),
        'dependent_views', (select count(distinct v.oid) from pg_depend d
                              join pg_rewrite rw on rw.oid = d.objid
                              join pg_class v on v.oid = rw.ev_class
                             where d.refobjid = c.oid and v.oid <> c.oid),
        'columns', (select coalesce(json_agg(a.attname::text order by a.attname::text collate "C"), '[]'::json)
                      from pg_attribute a
                     where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped)
      ) order by c.relname::text collate "C"), '[]'::json)
      from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
     where ns.nspname = 'public' and c.relkind in ('r','p','v','m') and left(c.relname, 3) = 'dc_'
  ),
  'writers', (
    select coalesce(json_agg(json_build_object('fn', f.fn, 'writes', f.w)
                    order by f.fn collate "C"), '[]'::json)
      from (select p.proname::text as fn,
                   (select json_agg(distinct lower(m[2]) collate "C" order by lower(m[2]) collate "C")
                      from regexp_matches(p.prosrc,
                        '(insert\s+into|update|delete\s+from|truncate)\s+(?:only\s+)?(?:public\.)?(dc_[a-z0-9_]+)',
                        'gi') m) as w
              from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
             where ns.nspname = 'public') f
     where f.w is not null
  ),
  'fn_dc_refs', (
    select coalesce(json_agg(json_build_object('fn', f.fn, 'refs', f.r)
                    order by f.fn collate "C"), '[]'::json)
      from (select p.proname::text as fn,
                   (select json_agg(distinct lower(m[1]) collate "C" order by lower(m[1]) collate "C")
                      from regexp_matches(p.prosrc, '(dc_[a-z0-9_]+)', 'gi') m) as r
              from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
             where ns.nspname = 'public') f
     where f.r is not null
  ),
  'rpc_overloads', (
    select count(distinct specific_name)
      from information_schema.parameters
     where specific_schema = 'public'
       and specific_name ~ '^dc_complete_acquisition_[0-9]+$'
  )
) as facts$f$ into facts;
  raise exception 'MUTATION_FACTS M14_second_resolver %', json_build_object(
    'relations', (select json_agg(x) from json_array_elements(facts->'relations') x
                   where x->>'name' in ('dc_entity_observation','dc_identity_decision')),
    'writers', facts->'writers');
end $mut$;
