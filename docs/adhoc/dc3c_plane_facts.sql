with rel as (
  select c.oid, c.relname::text n, c.relkind::text k, coalesce(array_to_string(c.reloptions, ','), '') opts
    from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
   where ns.nspname = 'public' and left(c.relname, 3) = 'dc_' and c.relkind in ('r','p','v','m')
)
select json_build_object(
 'relations', (select json_agg(json_build_object(
     'name', r.n, 'kind', r.k, 'invoker', r.opts like '%security_invoker=true%',
     'triggers', (select count(*) from pg_trigger t where t.tgrelid = r.oid and not t.tgisinternal),
     'dependent_views', (select coalesce(json_agg(distinct v.relname::text), '[]'::json) from pg_depend d join pg_rewrite rw on rw.oid = d.objid join pg_class v on v.oid = rw.ev_class where d.refobjid = r.oid and v.oid <> r.oid),
     'geo_cols', (select coalesce(json_agg(a.attname::text), '[]'::json) from pg_attribute a where a.attrelid = r.oid and a.attnum > 0 and not a.attisdropped and a.attname ~* '(^|_)(zip|zcta|postal|community|county|centroid|radius|geom)')
   ) order by r.n collate "C") from rel r),
 'writers', (select json_agg(json_build_object('fn', p.proname::text, 'writes', w) order by p.proname::text collate "C") from (
     select p.proname, (select json_agg(distinct m[2] order by m[2]) from regexp_matches(p.prosrc, '(insert\s+into|update|delete\s+from|truncate)\s+(?:public\.)?(dc_[a-z_]+)', 'gi') m) w
       from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace where ns.nspname = 'public') p
     where p.w is not null),
 'recon_referencing_fns', (select coalesce(json_agg(p.proname::text order by p.proname::text collate "C"), '[]'::json) from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace where ns.nspname = 'public' and p.prosrc ilike '%dc_resident_lineage_ledger%')
) facts;
