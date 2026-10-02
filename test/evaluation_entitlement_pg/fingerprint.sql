-- The definition a second apply of docs/evaluation-entitlement.sql must leave exactly as it found it: constraints, functions (body and
-- ACL), tables and the event sequence (ACL and RLS flag), triggers, indexes and policies of everything named evaluation*. Every sort is
-- pinned to the C collation, inside the fingerprint itself.
select md5(
     coalesce((select string_agg(c.relname || ':' || pg_get_constraintdef(k.oid), ',' order by c.relname collate "C", k.conname collate "C")
                 from pg_constraint k join pg_class c on c.oid = k.conrelid
                where c.relname like 'evaluation%' and k.contype in ('p', 'f', 'c', 'u')), '')
  || coalesce((select string_agg(pg_get_functiondef(p.oid) || coalesce(p.proacl::text, ''), ',' order by p.proname collate "C", p.oid::regprocedure::text collate "C")
                 from pg_proc p where p.proname like 'evaluation%'), '')
  || coalesce((select string_agg(c.relname || coalesce(c.relacl::text, '') || c.relrowsecurity::text, ',' order by c.relname collate "C")
                 from pg_class c where c.relname like 'evaluation%' and c.relkind in ('r', 'S')), '')
  || coalesce((select string_agg(pg_get_triggerdef(t.oid), ',' order by t.tgname collate "C")
                 from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relname like 'evaluation%' and not t.tgisinternal), '')
  || coalesce((select string_agg(indexdef, ',' order by indexname collate "C") from pg_indexes where tablename like 'evaluation%'), '')
  || coalesce((select string_agg(po.polname, ',' order by po.polname collate "C")
                 from pg_policy po join pg_class c on c.oid = po.polrelid where c.relname like 'evaluation%'), '')
);
