-- =====================================================================================
-- REPORT SHARE LINKS — EXECUTABLE ADVERSARIAL SUITE  (docs/report-share.sql)
--
-- Order J, unit J1: an opaque, revocable, optionally expiring link to ONE stored report. The database holds only the
-- SHA-256 of the token (never the token), decides in ONE function whether a link is usable, and leaves the snapshot and
-- the private layer exactly as it found them. Every expected answer below is a HARD-CODED constant: the token hashes were
-- produced outside the database (Python hashlib over the 43-character token), so a database that stored or compared the
-- wrong thing could not agree with them by construction. The report snapshot and the private context (the two files this
-- one depends on) are applied unmutated and are the REAL ones.
-- Output: one row per check (check, pass, detail); a NULL pass is stored as FALSE.
-- Setup steps go through wrappers that catch their own errors, so a regression in the code under test becomes a FAILED
-- NAMED CHECK instead of a crash that ends the suite before the checks that would have named it (S01 reports any that raised).
-- =====================================================================================
\set ON_ERROR_STOP on
set client_min_messages = warning;
\o /dev/null

create temp table _r (n serial, check_name text, pass boolean, detail text);

create function pg_temp._ck(n text, p boolean, d text default null) returns void language sql as
$$ insert into _r (check_name, pass, detail) values (n, coalesce(p, false), d) $$;

-- run a statement; 'ok', or the SQLSTATE and (for a constraint) its name
create function pg_temp._try(p_sql text) returns text language plpgsql as $$
declare _c text; _s text;
begin
  execute p_sql;
  return 'ok';
exception when others then
  get stacked diagnostics _c = constraint_name;
  _s := sqlstate;
  return _s || case when coalesce(_c, '') <> '' then ':' || _c else '' end;
end $$;

-- run a statement AS a role (invoker rights); 'ok' or the SQLSTATE
create function pg_temp._as(p_role text, p_sql text) returns text language plpgsql as $$
begin
  execute format('set role %I', p_role);
  begin
    execute p_sql;
    execute 'reset role';
    return 'ok';
  exception when others then
    execute 'reset role';
    return sqlstate;
  end;
end $$;

-- Supabase's service_role has BYPASSRLS and all three API roles hold USAGE on schema public. A freshly created schema here
-- has neither, and without them every refusal below could come from the SCHEMA or from RLS rather than from the objects'
-- own privileges. Set here, undone at the end.
alter role service_role bypassrls;
grant usage on schema public to anon, authenticated, service_role;

-- ---- fixtures, computed outside the database ----------------------------------------------------
-- two stored reports with no subject address, and one body that is issued with a private context
create temp table _k (name text primary key, body text, hash text);
insert into _k values
  ('a1',    '{"a":1}', '015abd7f5cc57a2dd94b7590f04ad8084273905ee33ec5cebeae62276a97f862'),
  ('a2',    '{"a":2}', '7e8059f495589fcd981232cc11d00b00da3802c01d688fa1cf1f6bed6e5bb33c'),
  ('clean', $b${"product":"HomeSignal Development Activity","radius_mi":0.5,"nearby":[{"address":"2 CENTRE ST","lat":40.7132,"lng":-74.0039,"type":"NB","stage":"Permit issued"}]}$b$,
            '69c387af7d3df0ef88da1c8df62f64c8fe1e9395832e31ba4714132043b880c1');
create temp table _pv (name text primary key, j jsonb);
insert into _pv values
  ('p0', '{"address":"1 Centre Street, New York, NY 10007","normalized_address":"1 CENTRE ST","latitude":40.712980288068,"longitude":-74.003758107366,"property_keys":["nyc:1001387","1001387"],"label":"Acme Realty Smith listing"}');
-- twenty links: the 43-character token a caller would hold, and the SHA-256 of that token. The database under test is only
-- ever handed the hash (except where a check deliberately hands it a token, to see it refused).
create temp table _t (n int primary key, tok text, hash text);
insert into _t values
  (1, 'eA-njyL5YEA4cX7nBOdw1mPvgYkCjOJX2O-3-zhYQII', '50db3e635f7f9cefb88df8ae86bc0edbb20f8e39a628a02c3bfe437e2541c37f'),
  (2, '8yX9GC3vlylgIcINOuEyFSG4gGTIJVpu7YlTM2hUEIA', 'ecfa94640ddb33de07ff6a0de9d4457ed01b2f80899129432815df2f8bea1757'),
  (3, 'Szw05MUxlAVsPr4LS25tJuIS349UKHVrZgd8UQL3yJI', '23e6d6c064260bf1e1f791d83eb90e0fca4802d7134dfb1896281dfe02d4488f'),
  (4, 'WJ53NYbUNKghGAkSdIF0luYn1O2Ya7DbZZTWtLILANw', '84bd7eea0294071110e2d4480fac179f354eeaa3f04f409e3fb762880b320131'),
  (5, 'tJZQBArGpfIuvPtOoU4J1_jBHe2jvndbAx5AiMHFrmc', '367165dfbf3391615c177a5e8d32bac88a23fc3efe8ccaf6111046ede5e7d3ab'),
  (6, 'UD_rpwEJJaQvt6IBnvwAmRr4vl46paNJPMLPIV18jW4', '837302b8f22e8e07ab1a92396a0259085b642e1a2ee1dfcf422bfdcd77bc172c'),
  (7, 'o8FwAMagXAOUkvpCfajwF3AZ_H_iDCQ8kCsjs4CKDMc', '3306297b151631e6440f5b381c193a1454af8baf1af567efd6283e81628b3f1c'),
  (8, 'aAJ7WuqsUM4KcNapIJq8S4a3JnH8DCaohtgrArEHQH0', '9d65da0ae64134cf0e8a2bfaaeeabde2c8041873ef5b9ec7513f531279579835'),
  (9, '-phJakwLiBJER6OXv1G1ZDlBZGAGbQzX7WRBSyr0qRM', 'dd682ddadb1e9a7baadb183a01235f6ffcbd7c6ca3925e05c807346c963e37fc'),
  (10, 'bMwKGhvyXqN8MeftgiwSBOcqeUuGW0BvcrtkKydA0ZY', 'b787053ac730bc89c3ea08bfb86bb5767c67cc0c38dac3978fdfbc4dae892b07'),
  (11, 'aNW5wgvF6BI9v7m4CatL-QO7l0xEVOkDXFD6IflFqSk', 'b795c09a2e0c4e25b9cdcde1c2ba5e336c1a38af7ce27e25a53ba90b0edc9b4f'),
  (12, 'kBzB3TyvItuosDH49yOjZxLf8ctybwAfk9VozQpYECE', 'cb307a20fab6aa9e351f5ff175a2d4d9a0c59e83db636872edd833fd4137830d'),
  (13, 'U1HMfPUAC0gp-hY-exn9Y4WLeLA1K2iDT0Ywdnq_7Lo', '9d0082d3bc2c8dbf0d733817b61f178814a1655092ed4b14e42edb130fe471ff'),
  (14, 'uGgRfAHt-Nmo7y1i2NWsVwVo8udGn17wMln_KxgRGGY', '743837ff3562b825cb1ba66eb8d0dd05cb59917b24a881045f1ee19aa00dc823'),
  (15, 'emojRTpkbRTFaoUdQR9pc5_hhhdfHZItOXQ5ALWX0Dc', '00ee444a9a3dbdcde707f9bb58bd08b349f7726524fb5b974547b81f9e0fc939'),
  (16, 'n2Ip-MqDC5HpkL7K8K5J4fudyiqupNEtRhtmsFTPvcE', 'd8910788605de0f6ddaefaaa1d2743c7ac4b4f30c3d95413d98abf1910ee7569'),
  (17, 'NwtJDjtlEvqeUQqyavT170ls_il7xnTI0WVP--jzEUY', 'eb3c55053a997cc32c6f1f717a091c013c6e33649c95f2c99e207c5c41a26137'),
  (18, 'QeAmQGZagxVaECyQdheuUKlaYHMBx5BlurpZXX0NJS0', '620d2d8c606b21e9cf96ca98e8b26e99c62452126579318b6f4757fdc3e117e2'),
  (19, 'n2KERbgOPvN_s60VmZe-IAFIHRPJ9x8GUo-vHAybGG4', '8fe7451ac329ced548588cdf36e018124dd9ef98963af40db608cc3a95ce6629'),
  (20, 'R__4qHljM1riVIvU0K_gQc2ogudRK3GVwi4SP_JXa7g', '1ac8013ad2fd205fbd94aff2cba95412461ce89cac7355d2ae1c2440675aafed');

create function pg_temp._b(n text) returns text language sql as $$ select body from _k where name = n $$;
create function pg_temp._h(n text) returns text language sql as $$ select hash from _k where name = n $$;
create function pg_temp._p(n text) returns jsonb language sql as $$ select j from _pv where name = n $$;
create function pg_temp._hn(p_n int) returns text language sql as $$ select hash from _t where _t.n = p_n $$;

-- ---- wrappers: every one catches its own error and logs it to _setup --------------------------------
create temp table _setup (n serial, step text, result text);

-- store a report through the real writer; the report_id, or null
create function pg_temp._report(p_body text, p_hash text, p_priv jsonb default null) returns uuid language plpgsql as $$
begin
  return (select i.report_id from public.report_snapshot_issue(p_body, p_hash, 'engine-v1', '{"radius_mi":0.5,"zip":"10007"}'::jsonb, p_priv) i);
exception when others then
  insert into _setup (step, result) values ('report ' || p_hash, sqlstate);
  return null;
end $$;

-- create a share for link number p_n; the share_id, or null
create function pg_temp._share(p_report uuid, p_n int, p_exp timestamptz default null) returns uuid language plpgsql as $$
begin
  return public.report_share_create(p_report, pg_temp._hn(p_n), p_exp);
exception when others then
  insert into _setup (step, result) values ('share ' || p_n, sqlstate);
  return null;
end $$;

-- true / false from the revoke, or null when it raised
create function pg_temp._revoke(p_share uuid) returns boolean language plpgsql as $$
begin
  return public.report_share_revoke(p_share);
exception when others then
  insert into _setup (step, result) values ('revoke', sqlstate);
  return null;
end $$;

-- every row resolve returned, as 'STATUS:report_id,...' ('-' for a null report_id), or 'ERR:sqlstate'
create function pg_temp._res(p_hash text) returns text language plpgsql as $$
declare out text;
begin
  select string_agg(x.status || ':' || coalesce(x.report_id::text, '-'), ',') into out from public.report_share_resolve(p_hash) x;
  return coalesce(out, 'NO ROWS');
exception when others then
  return 'ERR:' || sqlstate;
end $$;
create function pg_temp._resn(p_n int) returns text language sql as $$ select pg_temp._res(pg_temp._hn(p_n)) $$;

create function pg_temp._purge(p_ctx uuid, p_reason text) returns boolean language plpgsql as $$
begin
  return public.report_private_context_purge(p_ctx, p_reason);
exception when others then
  insert into _setup (step, result) values ('purge ' || p_reason, sqlstate);
  return null;
end $$;

-- the audit trail of one share, in order
create function pg_temp._ev(p_share uuid) returns text language sql as
$$ select coalesce(string_agg(kind, ',' order by event_id), '') from public.report_share_event where share_id = p_share $$;
create function pg_temp._share_md5(p_share uuid) returns text language sql as
$$ select md5(row_to_json(s)::text) from public.report_share s where s.share_id = p_share $$;
create function pg_temp._snap_md5(p_report uuid) returns text language sql as
$$ select md5(row_to_json(s)::text) from public.report_snapshot s where s.report_id = p_report $$;
create function pg_temp._snaps_md5() returns text language sql as
$$ select coalesce(md5(string_agg(row_to_json(s)::text, ',' order by s.report_id)), '') from public.report_snapshot s $$;
-- the WHOLE private layer, row by row: contexts, needs and events
create function pg_temp._priv_md5() returns text language sql as
$$ select md5(coalesce((select string_agg(row_to_json(c)::text, ',' order by c.context_id) from public.report_private_context c), '')
           || coalesce((select string_agg(row_to_json(n)::text, ',' order by n.need_id) from public.report_private_context_need n), '')
           || coalesce((select string_agg(row_to_json(e)::text, ',' order by e.event_id) from public.report_private_context_event e), '')) $$;
create function pg_temp._counts() returns text language sql as
$$ select (select count(*) from public.report_share) || '/' || (select count(*) from public.report_share_event) $$;

-- the stored reports the shares attach to
create temp table _ra as select pg_temp._report(pg_temp._b('a1'), pg_temp._h('a1')) as id;
create temp table _rb as select pg_temp._report(pg_temp._b('a2'), pg_temp._h('a2')) as id;
create temp table _rc as select pg_temp._report(pg_temp._b('clean'), pg_temp._h('clean'), pg_temp._p('p0')) as id;
create temp table _rd as select pg_temp._report(pg_temp._b('clean'), pg_temp._h('clean'), pg_temp._p('p0')) as id;

-- ---- E01  the environment the rest depends on -------------------------------------------------------
select pg_temp._ck('E01 control: the four stored reports the checks attach shares to exist (two without a subject address, two with a private context), and every one of the twenty hash fixtures is 64 lower-case hex digits and every token is 43 characters — so a refusal below is the table''s rule and not a typo in a fixture',
  (select count(*) = 4 and bool_and(id is not null) from (select id from _ra union all select id from _rb union all select id from _rc union all select id from _rd) x)
  and (select count(*) = 20 and bool_and(hash ~ '^[0-9a-f]{64}$' and length(tok) = 43 and tok ~ '^[A-Za-z0-9_-]+$') from _t)
  and (select count(*) = 2 from public.report_snapshot where private_context_id is not null),
  (select count(*)::text from public.report_snapshot));

-- ---- C01..C08  creating a share ----------------------------------------------------------------------------
create temp table _n0 as select pg_temp._counts() as c;
create temp table _s1 as select pg_temp._share((select id from _ra), 1) as id;
select pg_temp._ck('C01 create returns a version-4 share_id and stores exactly one row: the report, the hash exactly as given, a server-assigned created_at, no expiry, not revoked',
  (select id is not null and substr(id::text, 15, 1) = '4' from _s1)
  and (select count(*) = 1 and bool_and(s.report_id = (select id from _ra) and s.token_sha256 = pg_temp._hn(1)
                                        and s.expires_at is null and s.revoked_at is null and abs(extract(epoch from now() - s.created_at)) < 120)
         from public.report_share s where s.share_id = (select id from _s1)),
  (select id::text from _s1));
select pg_temp._ck('C01b the audit log has exactly one event for it, "created", and the counts moved by exactly one share and one event',
  pg_temp._ev((select id from _s1)) = 'created' and pg_temp._counts() = '1/1' and (select c from _n0) = '0/0',
  pg_temp._counts());
create temp table _exp as select now() + interval '30 days' as t;
create temp table _s2 as select pg_temp._share((select id from _ra), 2, (select t from _exp)) as id;
select pg_temp._ck('C01c an optional expiry is stored exactly as given (the writer applies no default of its own: link 1 above has none)',
  (select s.expires_at = (select t from _exp) from public.report_share s where s.share_id = (select id from _s2))
  and (select expires_at is null from public.report_share where share_id = (select id from _s1)),
  null);

select pg_temp._ck('C02 the share table has exactly these six columns, and the event table exactly these four — and none that could hold an address, an owner, a client, a label, a note, a visitor or a request detail',
  (select string_agg(column_name, ',' order by column_name collate "C") from information_schema.columns where table_schema = 'public' and table_name = 'report_share')
     = 'created_at,expires_at,report_id,revoked_at,share_id,token_sha256'
  and (select string_agg(column_name, ',' order by column_name collate "C") from information_schema.columns where table_schema = 'public' and table_name = 'report_share_event')
     = 'at,event_id,kind,share_id'
  and not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name in ('report_share', 'report_share_event')
                   and column_name ~* '(address|street|lat|lng|coord|owner|client|email|phone|label|property|parcel|actor|user|agent|referrer|note|reason|detail|message|comment|^ip$|_ip$|^ip_)'),
  (select string_agg(table_name || '.' || column_name, ',' order by table_name, column_name collate "C") from information_schema.columns where table_schema = 'public' and table_name in ('report_share', 'report_share_event')));
select pg_temp._ck('C02b the token is stored ONLY as a hash: the one column whose name mentions a token is token_sha256 (text), no plaintext token appears anywhere in either table (all twenty tokens scanned), and the same scan DOES find the hash — so a stored token would have been found the same way',
  (select string_agg(column_name, ',') from information_schema.columns where table_schema = 'public' and table_name in ('report_share', 'report_share_event') and column_name ~* 'token') = 'token_sha256'
  and not exists (select 1 from _t t, public.report_share s where position(t.tok in row_to_json(s)::text) > 0)
  and not exists (select 1 from _t t, public.report_share_event e where position(t.tok in row_to_json(e)::text) > 0)
  and exists (select 1 from _t t, public.report_share s where position(t.hash in row_to_json(s)::text) > 0),
  null);

create temp table _nh as select pg_temp._counts() as c;
select pg_temp._ck('C03 a TOKEN handed over as the hash is refused, so a raw token cannot be stored by mistake — and so is every malformed hash: upper-case, 63 or 65 digits, a non-hex digit, a trailing newline, a leading space, empty (all 23514 under the named constraint)',
  pg_temp._try(format($$select public.report_share_create(%L, %L)$$, (select id from _ra), (select tok from _t where n = 1))) = '23514:report_share_hash_shape'
  and pg_temp._try(format($$select public.report_share_create(%L, %L)$$, (select id from _ra), upper(pg_temp._hn(14)))) = '23514:report_share_hash_shape'
  and pg_temp._try(format($$select public.report_share_create(%L, %L)$$, (select id from _ra), left(pg_temp._hn(14), 63))) = '23514:report_share_hash_shape'
  and pg_temp._try(format($$select public.report_share_create(%L, %L)$$, (select id from _ra), pg_temp._hn(14) || '0')) = '23514:report_share_hash_shape'
  and pg_temp._try(format($$select public.report_share_create(%L, %L)$$, (select id from _ra), overlay(pg_temp._hn(14) placing 'g' from 1 for 1))) = '23514:report_share_hash_shape'
  and pg_temp._try(format($$select public.report_share_create(%L, %L)$$, (select id from _ra), pg_temp._hn(14) || chr(10))) = '23514:report_share_hash_shape'
  and pg_temp._try(format($$select public.report_share_create(%L, %L)$$, (select id from _ra), ' ' || left(pg_temp._hn(14), 63))) = '23514:report_share_hash_shape'
  and pg_temp._try(format($$select public.report_share_create(%L, %L)$$, (select id from _ra), '')) = '23514:report_share_hash_shape',
  pg_temp._try(format($$select public.report_share_create(%L, %L)$$, (select id from _ra), (select tok from _t where n = 1))));
select pg_temp._ck('C03b a missing report or a missing hash is refused (23502), and EVERY refusal above left nothing behind: no share and no event from a create that failed',
  pg_temp._try(format($$select public.report_share_create(null, %L)$$, pg_temp._hn(14))) = '23502'
  and pg_temp._try(format($$select public.report_share_create(%L, null)$$, (select id from _ra))) = '23502'
  and pg_temp._counts() = (select c from _nh),
  pg_temp._counts() || ' vs ' || (select c from _nh));

select pg_temp._ck('C04 a hash is UNIQUE: a second share with the same hash is refused (23505 under the named constraint) and leaves nothing behind, so two links can never resolve to the same share',
  pg_temp._try(format($$select public.report_share_create(%L, %L)$$, (select id from _rb), pg_temp._hn(1))) = '23505:report_share_hash_unique'
  and pg_temp._counts() = (select c from _nh)
  and (select count(*) = 1 from public.report_share where token_sha256 = pg_temp._hn(1)),
  pg_temp._try(format($$select public.report_share_create(%L, %L)$$, (select id from _rb), pg_temp._hn(1))));
select pg_temp._ck('C05 a report that does not exist is refused by the foreign key (23503), and the refusal is atomic — no share and no event is left behind',
  pg_temp._try(format($$select public.report_share_create(%L, %L)$$, '00000000-0000-4000-8000-000000000000', pg_temp._hn(14))) = '23503:report_share_report_fk'
  and pg_temp._counts() = (select c from _nh),
  pg_temp._counts());
select pg_temp._ck('C06 an expiry must be strictly AFTER creation: a past expiry, an expiry of exactly this instant and one far in the past are refused (23514 under the named constraint); one microsecond later is accepted',
  pg_temp._try(format($$select public.report_share_create(%L, %L, now() - interval '1 day')$$, (select id from _ra), pg_temp._hn(14))) = '23514:report_share_expiry_after_creation'
  and pg_temp._try(format($$select public.report_share_create(%L, %L, now())$$, (select id from _ra), pg_temp._hn(14))) = '23514:report_share_expiry_after_creation'
  and pg_temp._try(format($$select public.report_share_create(%L, %L, '1970-01-01'::timestamptz)$$, (select id from _ra), pg_temp._hn(14))) = '23514:report_share_expiry_after_creation'
  and pg_temp._try(format($$select public.report_share_create(%L, %L, now() + interval '1 microsecond')$$, (select id from _ra), pg_temp._hn(15))) = 'ok',
  pg_temp._try(format($$select public.report_share_create(%L, %L, now())$$, (select id from _ra), pg_temp._hn(14))));

create temp table _s3 as select pg_temp._share((select id from _ra), 3) as id;
select pg_temp._ck('C07 a lost link is REISSUED, not recovered: a second share for the same report, with a different hash, is a different share_id and both resolve ACTIVE to the same report',
  (select a.id is not null and b.id is not null and a.id <> b.id from _s1 a, _s3 b)
  and pg_temp._resn(1) = 'ACTIVE:' || (select id::text from _ra) and pg_temp._resn(3) = 'ACTIVE:' || (select id::text from _ra),
  pg_temp._resn(1) || ' / ' || pg_temp._resn(3));
select pg_temp._ck('C08 the identity is the writer''s: share_id has NO column default, the writer has exactly three arguments (report, hash, expiry) and none is an id or a time, and the share points at the report with NO cascade and NO other reference',
  (select column_default is null from information_schema.columns where table_schema = 'public' and table_name = 'report_share' and column_name = 'share_id')
  and (select p.pronargs = 3 and p.proargnames = array['p_report', 'p_token_sha256', 'p_expires_at']
         from pg_proc p where p.oid = to_regprocedure('public.report_share_create(uuid, text, timestamptz)'))
  and (select count(*) = 1 and bool_and(c.confrelid = 'public.report_snapshot'::regclass and c.confdeltype = 'a' and c.confupdtype = 'a')
         from pg_constraint c where c.conrelid = 'public.report_share'::regclass and c.contype = 'f'),
  null);

-- ---- V01..V09  resolve: the ONE decision on whether a link is usable ------------------------------------------
select pg_temp._ck('V01 a hash nobody holds resolves UNKNOWN with no report; and so does every malformed input — empty, not a hash, null, a TOKEN, the upper-case copy of a real hash, a real hash with a trailing space. It is a status, never an error, and always exactly one row',
  pg_temp._res(pg_temp._hn(20)) = 'UNKNOWN:-'
  and pg_temp._res('') = 'UNKNOWN:-' and pg_temp._res('not-a-hash') = 'UNKNOWN:-' and pg_temp._res(null) = 'UNKNOWN:-'
  and pg_temp._res((select tok from _t where n = 1)) = 'UNKNOWN:-'
  and pg_temp._res(upper(pg_temp._hn(1))) = 'UNKNOWN:-'
  and pg_temp._res(pg_temp._hn(1) || ' ') = 'UNKNOWN:-',
  pg_temp._res(upper(pg_temp._hn(1))));
select pg_temp._ck('V02 a live share with no expiry resolves ACTIVE, with the report_id of the report it was made for (and the report of link 2, a different report... is not mixed up with it)',
  pg_temp._resn(1) = 'ACTIVE:' || (select id::text from _ra)
  and pg_temp._resn(2) = 'ACTIVE:' || (select id::text from _ra)
  and (select count(*) = 1 from public.report_share_resolve(pg_temp._hn(1))),
  pg_temp._resn(1));

-- the boundary, in ONE transaction so that now() is one fixed instant: expiry exactly now is EXPIRED, one microsecond later
-- is ACTIVE, one microsecond earlier is EXPIRED. The shares are fabricated by the table owner (the writer cannot create a
-- share whose expiry is already past), and each is resolved through the real function.
create function pg_temp._boundary(p_report uuid) returns text language plpgsql as $$
declare a text; b text; c text;
begin
  insert into public.report_share (share_id, report_id, token_sha256, created_at, expires_at) values
    (gen_random_uuid(), p_report, pg_temp._hn(9),  now() - interval '1 hour', now()),
    (gen_random_uuid(), p_report, pg_temp._hn(10), now() - interval '1 hour', now() - interval '1 microsecond'),
    (gen_random_uuid(), p_report, pg_temp._hn(11), now() - interval '1 hour', now() + interval '1 microsecond');
  a := pg_temp._res(pg_temp._hn(9));
  b := pg_temp._res(pg_temp._hn(10));
  c := pg_temp._res(pg_temp._hn(11));
  return a || ' ; ' || b || ' ; ' || c;
exception when others then
  return 'ERR:' || sqlstate;
end $$;
create temp table _bd as select pg_temp._boundary((select id from _ra)) as r;
select pg_temp._ck('V03 the expiry boundary is exact: at expires_at the link is EXPIRED (no report_id), a microsecond before it is EXPIRED, a microsecond after it is ACTIVE',
  (select r from _bd) = 'EXPIRED:- ; EXPIRED:- ; ACTIVE:' || (select id::text from _ra),
  (select r from _bd));

-- expiry is computed at read time: nothing writes when it passes. Two shares with a two-second expiry are created and
-- read straight away (ACTIVE); one of them is then revoked while it is still live; ONE sleep lets both lapse.
create temp table _s4 as select pg_temp._share((select id from _rb), 4, now() + interval '2 seconds') as id;
create temp table _e4 as select pg_temp._resn(4) as before_expiry, pg_temp._share_md5((select id from _s4)) as row_before;
create temp table _s6 as select pg_temp._share((select id from _rb), 6, now() + interval '2 seconds') as id;
create temp table _rv6 as select pg_temp._revoke((select id from _s6)) as r;
-- revoked AND lapsed from the start: fabricated by the table owner so that both are true at once (the real path is link 6)
create function pg_temp._fabricate_revoked_and_lapsed(p_report uuid, p_n int) returns void language plpgsql as $$
begin
  insert into public.report_share (share_id, report_id, token_sha256, created_at, expires_at, revoked_at)
  values (gen_random_uuid(), p_report, pg_temp._hn(p_n), now() - interval '3 hours', now() - interval '2 hours', now() - interval '1 hour');
exception when others then
  insert into _setup (step, result) values ('fabricate ' || p_n, sqlstate);
end $$;
select pg_temp._fabricate_revoked_and_lapsed((select id from _ra), 12);
select pg_sleep(2.4);
create temp table _e4b as select pg_temp._resn(4) as after_expiry, pg_temp._share_md5((select id from _s4)) as row_after;
select pg_temp._ck('V03b a share whose expiry passes becomes EXPIRED by the clock alone: ACTIVE before it, EXPIRED after it (report_id withheld), and the stored row is byte-identical — nothing was written, so there is no job that could fail to run',
  (select before_expiry from _e4) = 'ACTIVE:' || (select id::text from _rb)
  and (select after_expiry from _e4b) = 'EXPIRED:-'
  and (select row_before from _e4) = (select row_after from _e4b),
  (select before_expiry || ' -> ' || after_expiry from _e4, _e4b));

create temp table _s5 as select pg_temp._share((select id from _rb), 5) as id;
create temp table _rv5 as select pg_temp._revoke((select id from _s5)) as r;
select pg_temp._ck('V04 a revoked share resolves REVOKED, and the report_id is withheld: a dead link gets no handle on any report',
  (select r from _rv5) is true and pg_temp._resn(5) = 'REVOKED:-',
  pg_temp._resn(5));
select pg_temp._ck('V05 REVOKED beats EXPIRED: a share that was revoked and has also lapsed reads REVOKED — both for a row where both are true from the start, and for a real share that was revoked while live and then outlived its expiry',
  pg_temp._resn(12) = 'REVOKED:-'
  and (select r from _rv6) is true and pg_temp._resn(6) = 'REVOKED:-',
  pg_temp._resn(12) || ' / ' || pg_temp._resn(6));

select pg_temp._ck('V06 resolve answers with exactly two columns, status and report_id — it has no way to return a body, a private-context handle, an address, a share_id or a time — and it is STABLE (read-only by declaration)',
  pg_get_function_result(to_regprocedure('public.report_share_resolve(text)')) = 'TABLE(status text, report_id uuid)'
  and (select p.provolatile = 's' from pg_proc p where p.oid = to_regprocedure('public.report_share_resolve(text)')),
  pg_get_function_result(to_regprocedure('public.report_share_resolve(text)')));
select pg_temp._ck('V07 the four statuses are exactly ACTIVE, EXPIRED, REVOKED and UNKNOWN, and every answer is ONE row: a live, a lapsed, a revoked and an unknown hash between them give exactly those four words',
  (select string_agg(q.st, ',' order by q.st collate "C")
     from (select distinct split_part(pg_temp._res(h), ':', 1) as st
             from unnest(array[pg_temp._hn(1), pg_temp._hn(9), pg_temp._hn(5), pg_temp._hn(20)]) h) q) = 'ACTIVE,EXPIRED,REVOKED,UNKNOWN'
  and not exists (select 1 from unnest(array[pg_temp._hn(1), pg_temp._hn(9), pg_temp._hn(5), pg_temp._hn(20)]) h where pg_temp._res(h) ~ ','),
  null);

create temp table _rd0 as select pg_temp._counts() as c, pg_temp._snaps_md5() as s, pg_temp._priv_md5() as p;
create temp table _rd1 as select pg_temp._resn(i) as r from generate_series(1, 20) i;
select pg_temp._ck('V08 resolving writes NOTHING: after twenty resolves of every kind, no share or event was added or changed and no snapshot or private-context row moved',
  pg_temp._counts() = (select c from _rd0) and pg_temp._snaps_md5() = (select s from _rd0) and pg_temp._priv_md5() = (select p from _rd0)
  and (select count(*) = 20 from _rd1),
  pg_temp._counts() || ' vs ' || (select c from _rd0));

-- ---- R01..R05  revoking -----------------------------------------------------------------------------------
select pg_temp._ck('R01 revoke sets revoked_at and writes exactly one "revoked" event; it returned true because THIS call revoked it',
  (select r from _rv5) is true
  and (select s.revoked_at is not null and abs(extract(epoch from now() - s.revoked_at)) < 120 and s.revoked_at >= s.created_at
        from public.report_share s where s.share_id = (select id from _s5))
  and pg_temp._ev((select id from _s5)) = 'created,revoked',
  pg_temp._ev((select id from _s5)));
create temp table _rv5a as select pg_temp._share_md5((select id from _s5)) as m, pg_temp._counts() as c;
create temp table _rv5b as select pg_temp._revoke((select id from _s5)) as r;
select pg_temp._ck('R02 revoking again is IDEMPOTENT: it returns false, writes no second event, and the first revoked_at stands (the row is byte-identical)',
  (select r from _rv5b) is false
  and pg_temp._ev((select id from _s5)) = 'created,revoked'
  and pg_temp._share_md5((select id from _s5)) = (select m from _rv5a)
  and pg_temp._counts() = (select c from _rv5a),
  pg_temp._ev((select id from _s5)));
select pg_temp._ck('R03 revoking a share that does not exist (or no share at all) is an ERROR (23503), never a quiet false: a revoke that silently did nothing would leave a live link believed dead. Nothing is written',
  pg_temp._try($$select public.report_share_revoke('00000000-0000-4000-8000-000000000000')$$) = '23503'
  and pg_temp._try($$select public.report_share_revoke(null)$$) = '23503'
  and pg_temp._counts() = (select c from _rv5a),
  pg_temp._try($$select public.report_share_revoke(null)$$));
-- a share that has already lapsed can still be revoked, and reads REVOKED
create temp table _rv4 as select pg_temp._revoke((select id from _s4)) as r;
select pg_temp._ck('R04 a share that has already EXPIRED can still be revoked (it returns true, writes the event) and from then on reads REVOKED, not EXPIRED',
  (select r from _rv4) is true and pg_temp._resn(4) = 'REVOKED:-' and pg_temp._ev((select id from _s4)) = 'created,revoked',
  pg_temp._resn(4));
create temp table _rv1 as select pg_temp._revoke((select id from _s1)) as r;
select pg_temp._ck('R05 revoking one link leaves its sibling alone: the other share of the same report (reissued link 3) and a share of another report still resolve exactly as before',
  (select r from _rv1) is true and pg_temp._resn(1) = 'REVOKED:-'
  and pg_temp._resn(3) = 'ACTIVE:' || (select id::text from _ra) and pg_temp._resn(2) = 'ACTIVE:' || (select id::text from _ra)
  and pg_temp._ev((select id from _s3)) = 'created',
  pg_temp._resn(3));

-- ---- G01..G07  the guard: one update, never a delete or a truncate ---------------------------------------------
create temp table _s17 as select pg_temp._share((select id from _rb), 17, now() + interval '30 days') as id;
create temp table _g0 as select pg_temp._share_md5((select id from _s17)) as m;
select pg_temp._ck('G01 the table owner cannot change a live share in any way but revoking it: not the report, the hash, the creation time, the share_id — and above all NOT THE EXPIRY (extended, shortened or cleared). Every attempt is refused (P0001) and the row is unchanged',
  pg_temp._try(format($$update public.report_share set expires_at = expires_at + interval '1 day' where share_id = %L$$, (select id from _s17))) = 'P0001'
  and pg_temp._try(format($$update public.report_share set expires_at = expires_at - interval '1 day' where share_id = %L$$, (select id from _s17))) = 'P0001'
  and pg_temp._try(format($$update public.report_share set expires_at = null where share_id = %L$$, (select id from _s17))) = 'P0001'
  and pg_temp._try(format($$update public.report_share set report_id = %L where share_id = %L$$, (select id from _ra), (select id from _s17))) = 'P0001'
  and pg_temp._try(format($$update public.report_share set token_sha256 = %L where share_id = %L$$, pg_temp._hn(19), (select id from _s17))) = 'P0001'
  and pg_temp._try(format($$update public.report_share set created_at = created_at - interval '1 day' where share_id = %L$$, (select id from _s17))) = 'P0001'
  and pg_temp._try(format($$update public.report_share set share_id = gen_random_uuid() where share_id = %L$$, (select id from _s17))) = 'P0001'
  and pg_temp._share_md5((select id from _s17)) = (select m from _g0),
  pg_temp._try(format($$update public.report_share set expires_at = null where share_id = %L$$, (select id from _s17))));
create temp table _g1b as select
  pg_temp._try(format($$update public.report_share set revoked_at = now(), expires_at = now() + interval '1 year' where share_id = %L$$, (select id from _s17))) as extend,
  pg_temp._try(format($$update public.report_share set revoked_at = now(), expires_at = null where share_id = %L$$, (select id from _s17))) as clear,
  pg_temp._try(format($$update public.report_share set revoked_at = now(), report_id = %L where share_id = %L$$, (select id from _ra), (select id from _s17))) as report,
  pg_temp._try(format($$update public.report_share set revoked_at = now(), token_sha256 = %L where share_id = %L$$, pg_temp._hn(19), (select id from _s17))) as hash,
  pg_temp._try(format($$update public.report_share set revoked_at = now(), created_at = created_at - interval '1 day' where share_id = %L$$, (select id from _s17))) as created,
  pg_temp._try(format($$update public.report_share set revoked_at = now(), share_id = gen_random_uuid() where share_id = %L$$, (select id from _s17))) as share_id;
select pg_temp._ck('G01b revoking while changing ANYTHING else in the same update is refused (P0001): the one allowed change cannot carry a second one with it — not an extended or cleared expiry, not another report, not another hash, not another creation time, not another share_id. The share is still live and unchanged',
  (select extend = 'P0001' and clear = 'P0001' and report = 'P0001' and hash = 'P0001' and created = 'P0001' and share_id = 'P0001' from _g1b)
  and pg_temp._share_md5((select id from _s17)) = (select m from _g0)
  and pg_temp._resn(17) = 'ACTIVE:' || (select id::text from _rb),
  (select extend || ' ' || clear || ' ' || report || ' ' || hash || ' ' || created || ' ' || share_id from _g1b));
select pg_temp._ck('G02 a revoke can never be undone or moved: revoked_at cannot be cleared, brought forward or pushed back once it is set (P0001), and the revoked row is unchanged',
  pg_temp._try(format($$update public.report_share set revoked_at = null where share_id = %L$$, (select id from _s5))) = 'P0001'
  and pg_temp._try(format($$update public.report_share set revoked_at = revoked_at + interval '1 day' where share_id = %L$$, (select id from _s5))) = 'P0001'
  and pg_temp._try(format($$update public.report_share set revoked_at = revoked_at - interval '1 day' where share_id = %L$$, (select id from _s5))) = 'P0001'
  and pg_temp._resn(5) = 'REVOKED:-',
  pg_temp._try(format($$update public.report_share set revoked_at = null where share_id = %L$$, (select id from _s5))));
create temp table _s18 as select pg_temp._share((select id from _rb), 18) as id;
select pg_temp._ck('G03 control: the ONE allowed update is accepted — setting revoked_at on a live share, nothing else changing — so the refusals above are the guard and not a blanket lock; and the link then reads REVOKED',
  pg_temp._try(format($$update public.report_share set revoked_at = now() where share_id = %L$$, (select id from _s18))) = 'ok'
  and pg_temp._resn(18) = 'REVOKED:-',
  pg_temp._resn(18));
select pg_temp._ck('G04 a share is never deleted: deleting one, or all of them, is refused (P0001) and every share is still there',
  pg_temp._try(format($$delete from public.report_share where share_id = %L$$, (select id from _s17))) = 'P0001'
  and pg_temp._try($$delete from public.report_share$$) = 'P0001'
  and (select count(*) >= 8 from public.report_share),
  (select count(*)::text from public.report_share));
-- A plain TRUNCATE of the share table is stopped by PostgreSQL itself (the event table references it: 0A000), and
-- TRUNCATE ... CASCADE reaches the event table, whose own trigger refuses it. The share table's OWN truncate trigger is
-- therefore not what stops either, so it is probed with the foreign key dropped inside a sub-transaction that is always
-- rolled back: if the trigger is gone, the truncate goes through and the probe says so.
create function pg_temp._share_truncate_probe() returns text language plpgsql as $$
begin
  begin
    alter table public.report_share_event drop constraint report_share_event_share_fk;
    truncate public.report_share;
    raise exception 'TRUNCATE_WENT_THROUGH' using errcode = 'P9999';
  exception when others then
    return sqlstate || ':' || sqlerrm;
  end;
end $$;
create temp table _tp as select pg_temp._share_truncate_probe() as r,
  pg_temp._try($$truncate public.report_share$$) as plain, pg_temp._try($$truncate public.report_share cascade$$) as casc;
select pg_temp._ck('G05 the share table is never truncated: plain TRUNCATE is refused (0A000, referenced), TRUNCATE CASCADE is refused (P0001), and its OWN truncate trigger refuses even with the foreign key out of the way (P0001, by the share guard) — and every share survived all three',
  (select plain from _tp) = '0A000'
  and (select casc from _tp) = 'P0001'
  and (select r from _tp) = 'P0001:report_share may only be revoked, once (TRUNCATE refused)'
  and (select count(*) >= 8 from public.report_share)
  and (select count(*) = 1 from pg_constraint where conname = 'report_share_event_share_fk'),
  (select plain || ' / ' || casc || ' / ' || r from _tp));

create temp table _tg as select pg_temp._try($$update public.report_share_event set kind = 'created'$$) as upd,
  pg_temp._try($$delete from public.report_share_event$$) as del, pg_temp._try($$truncate public.report_share_event$$) as trunc;
select pg_temp._ck('G06 the audit log is append-only: no update, no delete, no truncate, even for the table owner (all P0001), and every event is still there',
  (select upd = 'P0001' and del = 'P0001' and trunc = 'P0001' from _tg)
  and (select count(*) >= 8 from public.report_share_event),
  (select upd || ' / ' || del || ' / ' || trunc from _tg));
select pg_temp._ck('G07 the audit log has a CLOSED vocabulary and no free text: "created" for a real share is accepted (control), while "viewed", "opened", "downloaded", "revoked " and an empty kind are refused (23514 under the named constraint), an event for a share that does not exist is refused (23503), and the only text column is kind',
  pg_temp._try(format($$insert into public.report_share_event (share_id, kind) values (%L, 'created')$$, (select share_id from public.report_share where token_sha256 = pg_temp._hn(9)))) = 'ok'
  and pg_temp._try(format($$insert into public.report_share_event (share_id, kind) values (%L, 'viewed')$$, (select id from _s17))) = '23514:report_share_event_kind'
  and pg_temp._try(format($$insert into public.report_share_event (share_id, kind) values (%L, 'opened')$$, (select id from _s17))) = '23514:report_share_event_kind'
  and pg_temp._try(format($$insert into public.report_share_event (share_id, kind) values (%L, 'downloaded')$$, (select id from _s17))) = '23514:report_share_event_kind'
  and pg_temp._try(format($$insert into public.report_share_event (share_id, kind) values (%L, 'revoked ')$$, (select id from _s17))) = '23514:report_share_event_kind'
  and pg_temp._try(format($$insert into public.report_share_event (share_id, kind) values (%L, '')$$, (select id from _s17))) = '23514:report_share_event_kind'
  and pg_temp._try($$insert into public.report_share_event (share_id, kind) values ('00000000-0000-4000-8000-000000000000', 'created')$$) = '23503:report_share_event_share_fk'
  and (select count(*) = 1 and bool_and(column_name = 'kind') from information_schema.columns
        where table_schema = 'public' and table_name = 'report_share_event' and data_type in ('text', 'character varying', 'character', 'json', 'jsonb')),
  pg_temp._try(format($$insert into public.report_share_event (share_id, kind) values (%L, 'viewed')$$, (select id from _s17))));

-- ---- L01..L08  lock-down: system-only ---------------------------------------------------------------------------
select pg_temp._ck('L01 row-level security is on for both tables and neither has a policy',
  (select count(*) = 2 and bool_and(relrowsecurity) from pg_class where oid in ('public.report_share'::regclass, 'public.report_share_event'::regclass))
  and (select count(*) = 0 from pg_policy where polrelid in ('public.report_share'::regclass, 'public.report_share_event'::regclass)),
  null);
select pg_temp._ck('L02 anon and authenticated hold NO privilege on either table (select, insert, update, delete, truncate, references, trigger), and PUBLIC holds none',
  not exists (select 1 from unnest(array['anon', 'authenticated']) r, unnest(array['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger']) p,
                     unnest(array['public.report_share', 'public.report_share_event']) t
               where has_table_privilege(r, t, p))
  and not exists (select 1 from pg_class c, aclexplode(c.relacl) a
                   where c.oid in ('public.report_share'::regclass, 'public.report_share_event'::regclass) and a.grantee = 0),
  null);
select pg_temp._ck('L03 service_role holds SELECT and nothing else on both tables: it cannot insert, update, delete, truncate, reference or add a trigger, so every share goes through the functions',
  has_table_privilege('service_role', 'public.report_share', 'select') and has_table_privilege('service_role', 'public.report_share_event', 'select')
  and not exists (select 1 from unnest(array['insert', 'update', 'delete', 'truncate', 'references', 'trigger']) p, unnest(array['public.report_share', 'public.report_share_event']) t
                   where has_table_privilege('service_role', t, p)),
  null);
select pg_temp._ck('L04 every report_share_ function is executable by service_role and by nobody else (not anon, not authenticated, not PUBLIC), and the three that touch shares are SECURITY DEFINER with a pinned search_path',
  (select count(*) >= 5 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'report\_share\_%')
  and not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'report\_share\_%'
               and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute')
                    or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0)
                    or not has_function_privilege('service_role', p.oid, 'execute')))
  and (select count(*) = 3 and bool_and(p.prosecdef and coalesce(p.proconfig, '{}') @> array['search_path=public, pg_temp'])
         from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('report_share_create', 'report_share_revoke', 'report_share_resolve')),
  (select string_agg(p.proname, ',' order by p.proname collate "C") from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'report\_share\_%'));
select pg_temp._ck('L05a control: all three API roles hold USAGE on the schema, so the refusals below come from the objects and not from the schema',
  has_schema_privilege('anon', 'public', 'usage') and has_schema_privilege('authenticated', 'public', 'usage') and has_schema_privilege('service_role', 'public', 'usage'),
  null);
-- (each step is its OWN statement: a statement's snapshot cannot see rows that a volatile function inside it just wrote)
create temp table _l5a as select pg_temp._as('service_role', format($$select public.report_share_create(%L, %L)$$, (select id from _ra), pg_temp._hn(16))) as r;
create temp table _l5b as select pg_temp._resn(16) as res, (select share_id from public.report_share where token_sha256 = pg_temp._hn(16)) as sid;
create temp table _l5c as select pg_temp._as('service_role', format($$select public.report_share_revoke(%L)$$, (select sid from _l5b))) as r;
create temp table _l5d as select pg_temp._resn(16) as res,
  pg_temp._as('service_role', format($$select * from public.report_share_resolve(%L)$$, pg_temp._hn(1))) as resolve_ok,
  pg_temp._as('service_role', 'select count(*) from public.report_share') as read_share,
  pg_temp._as('service_role', 'select count(*) from public.report_share_event') as read_event,
  pg_temp._as('service_role', format($$insert into public.report_share (share_id, report_id, token_sha256) values (gen_random_uuid(), %L, %L)$$, (select id from _ra), pg_temp._hn(19))) as ins,
  pg_temp._as('service_role', format($$update public.report_share set revoked_at = now() where share_id = %L$$, (select id from _s17))) as upd,
  pg_temp._as('service_role', 'delete from public.report_share') as del,
  pg_temp._as('service_role', 'truncate public.report_share') as trunc,
  pg_temp._as('service_role', $$insert into public.report_share_event (share_id, kind) values (gen_random_uuid(), 'created')$$) as ins_event;
select pg_temp._ck('L05 AS service_role: create, revoke and resolve all work, and reading both tables works — but a direct INSERT, UPDATE, DELETE or TRUNCATE is refused (all 42501), so the one writer cannot be bypassed',
  (select r = 'ok' from _l5a) and (select res = 'ACTIVE:' || (select id::text from _ra) from _l5b)
  and (select r = 'ok' from _l5c) and (select res = 'REVOKED:-' from _l5d)
  and (select resolve_ok = 'ok' and read_share = 'ok' and read_event = 'ok' from _l5d)
  and (select ins = '42501' and upd = '42501' and del = '42501' and trunc = '42501' and ins_event = '42501' from _l5d),
  (select 'create ' || (select r from _l5a) || ', revoke ' || (select r from _l5c) || ', ' || res || ', read ' || read_share || '/' || read_event || ', insert ' || ins
          || ', update ' || upd || ', delete ' || del || ', truncate ' || trunc || ', event insert ' || ins_event from _l5d));
select pg_temp._ck('L06 AS anon and AS authenticated: every function is refused, and neither table can be read or written (all 42501) — and nothing was created, revoked or exposed by the attempts',
  pg_temp._as('anon', format($$select public.report_share_create(%L, %L)$$, (select id from _ra), pg_temp._hn(19))) = '42501'
  and pg_temp._as('authenticated', format($$select public.report_share_create(%L, %L)$$, (select id from _ra), pg_temp._hn(19))) = '42501'
  and pg_temp._as('anon', format($$select public.report_share_revoke(%L)$$, (select id from _s17))) = '42501'
  and pg_temp._as('authenticated', format($$select public.report_share_revoke(%L)$$, (select id from _s17))) = '42501'
  and pg_temp._as('anon', format($$select * from public.report_share_resolve(%L)$$, pg_temp._hn(3))) = '42501'
  and pg_temp._as('authenticated', format($$select * from public.report_share_resolve(%L)$$, pg_temp._hn(3))) = '42501'
  and pg_temp._as('anon', 'select count(*) from public.report_share') = '42501'
  and pg_temp._as('authenticated', 'select count(*) from public.report_share_event') = '42501'
  and pg_temp._as('anon', format($$insert into public.report_share (share_id, report_id, token_sha256) values (gen_random_uuid(), %L, %L)$$, (select id from _ra), pg_temp._hn(19))) = '42501'
  and pg_temp._as('authenticated', 'delete from public.report_share') = '42501'
  and pg_temp._resn(19) = 'UNKNOWN:-'
  and pg_temp._resn(3) = 'ACTIVE:' || (select id::text from _ra),
  null);
select pg_temp._ck('L07 this file changed NOTHING about the snapshot table: still exactly its eight columns, its three triggers, one foreign key, RLS on, and the exact grants it had (the owner, plus SELECT to service_role and nobody else; the owner holds arwdDxt on PostgreSQL 16 and arwdDxtm on 17, which added MAINTAIN)',
  (select string_agg(column_name, ',' order by column_name collate "C") from information_schema.columns where table_schema = 'public' and table_name = 'report_snapshot')
     = 'body,body_bytes,content_hash,engine_inputs,generated_at,private_context_id,report_id,report_version'
  and (select count(*) = 3 from pg_trigger where tgrelid = 'public.report_snapshot'::regclass and not tgisinternal)
  and (select count(*) = 1 from pg_constraint where conrelid = 'public.report_snapshot'::regclass and contype = 'f')
  and (select relrowsecurity and relacl::text in ('{postgres=arwdDxt/postgres,service_role=r/postgres}', '{postgres=arwdDxtm/postgres,service_role=r/postgres}') from pg_class where oid = 'public.report_snapshot'::regclass),
  (select relacl::text from pg_class where oid = 'public.report_snapshot'::regclass));

-- ---- P01..P06  a share and the private layer: neither touches the other -----------------------------------------
create temp table _pc as select (select private_context_id from public.report_snapshot where report_id = (select id from _rc)) as ctx_c,
                                (select private_context_id from public.report_snapshot where report_id = (select id from _rd)) as ctx_d;
-- create and revoke a share against a report whose context is ACTIVE, and compare the private layer and every snapshot row before and after
create temp table _n1 as select pg_temp._priv_md5() as p, pg_temp._snaps_md5() as s,
  (select count(*) from public.report_private_context_need) as needs,
  (select last_needed_at from public.report_private_context where context_id = (select ctx_c from _pc)) as lna,
  (select purge_due_at from public.report_private_context where context_id = (select ctx_c from _pc)) as due;
create temp table _s13 as select pg_temp._share((select id from _rc), 13) as id;
create temp table _rv13 as select pg_temp._revoke((select id from _s13)) as r;
select pg_temp._ck('P01 creating and revoking a share for a report whose private context is ACTIVE changes NOTHING in the private layer (every context, need and event row is byte-identical: no need opened or closed, no clock started or cleared, no event) and no snapshot row moved',
  (select id is not null from _s13) and (select r from _rv13) is true
  and pg_temp._priv_md5() = (select p from _n1) and pg_temp._snaps_md5() = (select s from _n1)
  and (select count(*) from public.report_private_context_need) = (select needs from _n1)
  and (select last_needed_at = (select lna from _n1) and purge_due_at is not distinct from (select due from _n1) from public.report_private_context where context_id = (select ctx_c from _pc)),
  pg_temp._priv_md5() || ' vs ' || (select p from _n1));

create temp table _s7 as select pg_temp._share((select id from _rc), 7) as id;
-- the private layer exactly as it stands while both contexts are still active: the positive control for the leak scan in P05
create temp table _ctl as select string_agg(row_to_json(c)::text, ' ') as t from public.report_private_context c;
create temp table _pm as select pg_temp._snap_md5((select id from _rc)) as snap, pg_temp._share_md5((select id from _s7)) as shr, pg_temp._resn(7) as res_before;
create temp table _pp as select pg_temp._purge((select ctx_c from _pc), 'verified_privacy_request') as r;
select pg_temp._ck('P02 a share SURVIVES a verified privacy request: after the report''s private context is purged, the link still resolves ACTIVE to the same report; the snapshot row and the share row are byte-identical, and the snapshot still hashes to its content_hash',
  (select r from _pp) is true
  and (select state = 'purged' and address is null from public.report_private_context_read((select ctx_c from _pc)))
  and (select res_before from _pm) = 'ACTIVE:' || (select id::text from _rc) and pg_temp._resn(7) = (select res_before from _pm)
  and pg_temp._snap_md5((select id from _rc)) = (select snap from _pm)
  and pg_temp._share_md5((select id from _s7)) = (select shr from _pm)
  and (select content_hash = encode(sha256(convert_to(body, 'UTF8')), 'hex') from public.report_snapshot where report_id = (select id from _rc)),
  pg_temp._resn(7));
create temp table _pq as select pg_temp._purge((select ctx_d from _pc), 'verified_privacy_request') as r;
create temp table _s8 as select pg_temp._share((select id from _rd), 8) as id;
select pg_temp._ck('P03 a share can be CREATED against a report whose private context is already purged (creating one does not need an active context), and it resolves ACTIVE to that report',
  (select r from _pq) is true and (select id is not null from _s8)
  and (select state = 'purged' from public.report_private_context_read((select ctx_d from _pc)))
  and pg_temp._resn(8) = 'ACTIVE:' || (select id::text from _rd),
  pg_temp._resn(8));
create temp table _pr as select pg_temp._revoke((select id from _s8)) as r;
select pg_temp._ck('P03b and revoking it after the purge works too, and still leaves the purged context a tombstone (no value came back, no need opened)',
  (select r from _pr) is true and pg_temp._resn(8) = 'REVOKED:-'
  and (select state = 'purged' and address is null and label is null from public.report_private_context_read((select ctx_d from _pc)))
  and (select count(*) = 0 from public.report_private_context_need n where n.context_id = (select ctx_d from _pc) and n.closed_at is null),
  null);
select pg_temp._ck('P04 the share tables reference the snapshot and nothing else: the share has ONE foreign key (to report_snapshot), the event has ONE (to the share), and neither refers to any private-layer table — so deleting or purging a private context cannot touch a share',
  (select count(*) = 1 and bool_and(c.confrelid = 'public.report_snapshot'::regclass) from pg_constraint c where c.conrelid = 'public.report_share'::regclass and c.contype = 'f')
  and (select count(*) = 1 and bool_and(c.confrelid = 'public.report_share'::regclass) from pg_constraint c where c.conrelid = 'public.report_share_event'::regclass and c.contype = 'f')
  and not exists (select 1 from pg_constraint c where c.conrelid in ('public.report_share'::regclass, 'public.report_share_event'::regclass)
                   and c.confrelid::regclass::text like 'public.report\_private\_context%'),
  null);
select pg_temp._ck('P05 no private value is in the share tables: none of the nine values a customer entered (address, normalized address, both coordinates, both property keys, the label) appears anywhere in either table — and the very same scan DOES find all nine in the private layer as it stood while the contexts were active, so a leak would have been found the same way',
  (select bool_and(position(lower(v) in lower(coalesce((select string_agg(row_to_json(s)::text, ' ') from public.report_share s), '') || ' '
                                              || coalesce((select string_agg(row_to_json(e)::text, ' ') from public.report_share_event e), ''))) = 0)
     from unnest(array['1 Centre Street', 'New York, NY', '1 CENTRE ST', '40.712980288068', '-74.003758107366', 'nyc:1001387', '1001387', 'Acme Realty', 'Smith listing']) v)
  and (select count(*) = 9 and bool_and(position(lower(v) in lower((select t from _ctl))) > 0)
         from unnest(array['1 Centre Street', 'New York, NY', '1 CENTRE ST', '40.712980288068', '-74.003758107366', 'nyc:1001387', '1001387', 'Acme Realty', 'Smith listing']) v),
  null);
select pg_temp._ck('P06 resolve hands back no private value and no private-context handle: the whole answer for a report that HAS a private context is exactly "ACTIVE:" and its report_id — none of the nine values, and not the context id — and the same text scan finds the context id in the snapshot row, so it could have been found',
  (select r = 'ACTIVE:' || (select id::text from _rc)
          and position((select ctx_c::text from _pc) in r) = 0 and position((select ctx_d::text from _pc) in r) = 0
          and position('Centre' in r) = 0 and position('Acme' in r) = 0 and position('40.7129' in r) = 0
     from (select pg_temp._resn(7) as r) x)
  and position((select ctx_c::text from _pc) in (select row_to_json(s)::text from public.report_snapshot s where s.report_id = (select id from _rc))) > 0,
  pg_temp._resn(7));

select pg_temp._ck('S01 every setup step in this suite ran without raising (a step that raises is a regression in the code under test, reported here instead of ending the run)',
  not exists (select 1 from _setup) and (select count(*) = 4 from (select id from _ra union all select id from _rb union all select id from _rc union all select id from _rd) x where x.id is not null),
  (select string_agg(step || '=' || result, '; ') from _setup));

alter role service_role nobypassrls;
revoke usage on schema public from anon, authenticated, service_role;

\o
select check_name, pass, detail from _r order by n;
