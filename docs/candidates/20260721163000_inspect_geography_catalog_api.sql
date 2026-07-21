-- Phase 1 catalog inspection (Management API safe — no psql meta-commands).

-- 1) Functions
select jsonb_build_object(
  'section', 'functions',
  'rows', coalesce(jsonb_agg(jsonb_build_object(
    'function_name', p.proname,
    'arguments', pg_get_function_identity_arguments(p.oid),
    'security_definer', p.prosecdef,
    'volatility', p.provolatile::text
  ) order by p.proname), '[]'::jsonb)
) as catalog
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'community_covers_zip',
    'resolve_digest_community_id',
    'retire_stale_digest_identities',
    'signup_complete',
    'subscribe_area_defaults',
    'enable_area_email_alerts',
    'trg_users_geography_invariant'
  );

-- 2) Triggers on public.users
select jsonb_build_object(
  'section', 'triggers',
  'rows', coalesce(jsonb_agg(jsonb_build_object(
    'trigger_name', t.tgname,
    'enabled_code', t.tgenabled::text,
    'enabled_status', case t.tgenabled
      when 'O' then 'enabled'
      when 'D' then 'disabled'
      when 'R' then 'replica'
      when 'A' then 'always'
      else t.tgenabled::text
    end,
    'trigger_function', p.proname,
    'trigger_def', pg_get_triggerdef(t.oid, true)
  ) order by t.tgname), '[]'::jsonb)
) as catalog
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
join pg_proc p on p.oid = t.tgfoid
where n.nspname = 'public'
  and c.relname = 'users'
  and not t.tgisinternal;

-- 3) signup_complete flags
select jsonb_build_object(
  'section', 'signup_complete_flags',
  'calls_retire_stale', (
    select position('retire_stale_digest_identities' in pg_get_functiondef(
      'public.signup_complete(text,uuid,text,jsonb,text,jsonb,boolean,text,text,text)'::regprocedure
    )) > 0
  ),
  'calls_resolve_digest', (
    select position('resolve_digest_community_id' in pg_get_functiondef(
      'public.signup_complete(text,uuid,text,jsonb,text,jsonb,boolean,text,text,text)'::regprocedure
    )) > 0
  )
) as catalog;

-- 4) users constraints
select jsonb_build_object(
  'section', 'users_constraints',
  'rows', coalesce(jsonb_agg(jsonb_build_object(
    'name', con.conname,
    'type', con.contype::text,
    'definition', pg_get_constraintdef(con.oid)
  ) order by con.conname), '[]'::jsonb)
) as catalog
from pg_constraint con
join pg_class rel on rel.oid = con.conrelid
join pg_namespace nsp on nsp.oid = rel.relnamespace
where nsp.nspname = 'public'
  and rel.relname = 'users';

-- 5) failed E2E account
select jsonb_build_object(
  'section', 'failed_e2e_users',
  'rows', coalesce(jsonb_agg(to_jsonb(u) order by u.created_at), '[]'::jsonb)
) as catalog
from public.users u
where lower(u.email) = 'texas-launch-8200c786d2@homesignal-e2e.test';

-- 6) SQL smoke tests
select jsonb_build_object(
  'section', 'sql_smoke',
  'covers_texas', public.community_covers_zip(
    'b0d7b834-4fcf-49bf-a018-0cb611de065c'::uuid, '78617'
  ),
  'travis_id', public.resolve_digest_community_id('78617')::text
) as catalog;
