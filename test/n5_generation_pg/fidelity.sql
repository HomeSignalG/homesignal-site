-- FIXTURE FIDELITY FINGERPRINT — run IDENTICALLY on production and on the suite's database.
-- One row per object: columns (name, type, NOT NULL, default, in attnum order — row order
-- matters, geo.n5_gen_candidate_geom returns setof geo.n5_geom), constraints (definition
-- text; names excluded because unnamed checks are auto-named differently), non-primary
-- indexes (definition text), and the bodies of the live functions the fixture copies.
-- Sorted aggregates pin collate "C" (CLAUDE.md rule 9).
with t(tbl) as (values
  ('geo.n5_generation'), ('geo.n5_generation_unresolved'), ('geo.n5_generation_reconcile'),
  ('geo.n5_generation_publish'), ('geo.n5_gen_zcta'), ('geo.n5_snapshot'), ('geo.n5_shard'),
  ('geo.n5_frozen'), ('geo.n5_zcta'), ('geo.n5_recovery_attempt'), ('geo.n5_association'),
  ('geo.n5_geom'), ('geo.n5_point_reject'), ('geo.n5_accepted_source'),
  ('geo.n5_boundary_membership'), ('geo.zip_authoritative_membership'),
  ('geo.zip_authoritative_marker'), ('geo.maps_zip_geography_status'),
  ('preservation.app_project_identity'), ('preservation.protected_snapshot'),
  ('public.canonical_zip_registry'), ('public.app_zip_geography_cutover'))
select t.tbl as object,
  (select md5(string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull
                         || ':' || coalesce(pg_get_expr(d.adbin, d.adrelid), ''), '|' order by a.attnum))
     from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
    where a.attrelid = t.tbl::regclass and a.attnum > 0 and not a.attisdropped) as cols,
  (select md5(coalesce(string_agg(pg_get_constraintdef(c.oid), '|' order by pg_get_constraintdef(c.oid) collate "C"), ''))
     from pg_constraint c where c.conrelid = t.tbl::regclass and c.contype <> 't') as cons,
  (select md5(coalesce(string_agg(regexp_replace(pg_get_indexdef(i.indexrelid), '^CREATE (UNIQUE )?INDEX \S+ ', 'CREATE \1INDEX '),
                                  '|' order by regexp_replace(pg_get_indexdef(i.indexrelid), '^CREATE (UNIQUE )?INDEX \S+ ', 'CREATE \1INDEX ') collate "C"), ''))
     from pg_index i where i.indrelid = t.tbl::regclass and not i.indisprimary) as idx
from t
union all
select f.fn, md5(pg_get_functiondef(f.fn::regprocedure)), null, null
  from (values ('preservation.guard_frozen()'), ('public.n5_expected_captured(text)'),
               ('public.n5_expected_input(timestamp with time zone)'), ('geo.n5_claim_shard(text,text,integer)')) f(fn)
order by 1;
