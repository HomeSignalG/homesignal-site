-- =====================================================================================
-- DURABLE REPORT SNAPSHOTS — EXECUTABLE ADVERSARIAL SUITE  (docs/report-snapshot.sql)
--
-- Order F of the Development Activity plan: the table a commercial report is stored in, the one
-- writer, and the two identifiers that used to be one field (report_id, content_hash).
-- Every expected answer below is a HARD-CODED constant, never computed by the code under test:
-- the SHA-256 values were produced outside the database (Python hashlib) so a database that hashed
-- the wrong bytes could not agree with them by construction.
-- Output: one row per check (check, pass, detail); a NULL pass is stored as FALSE.
-- =====================================================================================
\set ON_ERROR_STOP on
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

create function pg_temp._issue(p_body text, p_hash text, p_ver text default 'nyc-v1',
    p_inputs jsonb default '{"address":"1 Centre Street","zip":"10007","radius_mi":0.5}', p_key text default null)
returns text language sql as
$$ select pg_temp._try(format('select * from public.report_snapshot_issue(%L, %L, %L, %L::jsonb, %L)', p_body, p_hash, p_ver, p_inputs, p_key)) $$;

-- Supabase's service_role has BYPASSRLS and all three API roles hold USAGE on schema public. A freshly
-- created schema here has neither, and without them every refusal below could come from the SCHEMA or
-- from RLS rather than from the table's own privileges. Set here, undone at the end.
alter role service_role bypassrls;
grant usage on schema public to anon, authenticated, service_role;

-- constants, computed outside the database
create temp table _k (name text primary key, body text, hash text);
insert into _k values
  ('a1',    '{"a":1}',                                       '015abd7f5cc57a2dd94b7590f04ad8084273905ee33ec5cebeae62276a97f862'),
  ('a2',    '{"a":2}',                                       '7e8059f495589fcd981232cc11d00b00da3802c01d688fa1cf1f6bed6e5bb33c'),
  ('ws',    '{"b":1,   "a":2}',                              '449d81fcb59b69ea27ef2fcab7620974181c9d5cc0f6b23c9d96a6fae877168b'),
  ('compact','{"b":1,"a":2}',                                'a1d46c3cdb4e5795c8d637f80daeb578ebb1a9a65dc1ed5f11f51794c3c89f3a'),
  ('arr',   '[1,2]',                                         '49a64717d5d4cb19952e6eac2946415cf6879adacf9908e7d872332d32c6e684'),
  ('str',   '"x"',                                           'ba2df4903a2c14e86dc3bcca58911b44ac1d2514b7227bf6eb08cfb978f55a1b'),
  ('junk',  'not json',                                      '7ccfa1fbf3940e6f0c0375d87c0f9235a50514e14cb427bdfaf5077987b26ccf'),
  ('utf8',  '{"z":1,"a":{"m":2,"b":[3,1,2]},"é":"naïve — ok"}', 'a6d781dd804c292e1422443761045549f6aceef647a36d7ef2bdc4d9790c68ce');

-- the report_id the writer minted, or null when it refused (so a refusal is a failed check, not a crash)
create function pg_temp._issue_id(p_body text, p_hash text, p_ver text, p_inputs jsonb, p_key text default null)
returns uuid language plpgsql as $$
declare r uuid;
begin
  select i.report_id into r from public.report_snapshot_issue(p_body, p_hash, p_ver, p_inputs, p_key) i;
  return r;
exception when others then
  return null;
end $$;

create function pg_temp._b(n text) returns text language sql as $$ select body from _k where name = n $$;
create function pg_temp._h(n text) returns text language sql as $$ select hash from _k where name = n $$;

-- ---- E01  the environment the hash claim depends on ---------------------------------------------
select pg_temp._ck('E01 control: the database is UTF8 (so sha256(body) is the hash of the UTF-8 bytes a client hashes) and mints uuids',
  (select setting = 'UTF8' from pg_settings where name = 'server_encoding') and to_regprocedure('gen_random_uuid()') is not null,
  (select setting from pg_settings where name = 'server_encoding'));

-- ---- I01..I03  issuing ----------------------------------------------------------------------------------
create temp table _i1 as select pg_temp._issue_id(pg_temp._b('a1'), pg_temp._h('a1'), 'nyc-v1',
  '{"address":"1 Centre Street","zip":"10007","radius_mi":0.5}'::jsonb, 'nyc:12345') as report_id;
select pg_temp._ck('I01 issuing mints a version-4 uuid report_id and exactly one row is stored under it, with a server-assigned generated_at',
  (select i.report_id is not null and substr(i.report_id::text, 15, 1) = '4'
          and (select count(*) = 1 and bool_and(generated_at is not null) from public.report_snapshot s where s.report_id = i.report_id)
     from _i1 i),
  (select report_id::text from _i1));
select pg_temp._ck('I01b the stored row carries what was issued: hash, version, key, inputs, exact body, and 7 bytes',
  (select count(*) = 1 and bool_and(s.content_hash = pg_temp._h('a1') and s.report_version = 'nyc-v1' and s.property_key = 'nyc:12345'
          and s.inputs = '{"address":"1 Centre Street","zip":"10007","radius_mi":0.5}'::jsonb
          and s.body = '{"a":1}' and s.body_bytes = 7)
     from public.report_snapshot s join _i1 using (report_id)),
  null);
select pg_temp._ck('I02a control: generated_at is the database clock (within a minute of now)',
  (select count(*) = 1 and bool_and(abs(extract(epoch from now() - s.generated_at)) < 60)
     from public.report_snapshot s join _i1 using (report_id)),
  null);

select pg_sleep(0.05);
create temp table _i2 as select pg_temp._issue_id(pg_temp._b('a1'), pg_temp._h('a1'), 'nyc-v1',
  '{"address":"1 Centre Street","zip":"10007","radius_mi":0.5}'::jsonb, 'nyc:12345') as report_id;
select pg_temp._ck('I02 the SAME content issued twice is two snapshots: two different report_ids, one content_hash, two rows, two issue times — the property the old fingerprint id lacked',
  (select i1.report_id is not null and i2.report_id is not null and i1.report_id <> i2.report_id from _i1 i1, _i2 i2)
  and (select count(distinct report_id) = 2 and count(distinct content_hash) = 1 and count(*) = 2 and count(distinct generated_at) = 2
         from public.report_snapshot where content_hash = pg_temp._h('a1')),
  (select count(*)::text from public.report_snapshot));

-- ---- H01..H08  the table refuses what does not describe itself -----------------------------------------
create temp table _n0 as select count(*) as n from public.report_snapshot;
select pg_temp._ck('H01 a hash that is not the SHA-256 of the body is refused by the hash-matches-body constraint',
  pg_temp._issue(pg_temp._b('a2'), pg_temp._h('a1')) = '23514:report_snapshot_hash_matches_body',
  pg_temp._issue(pg_temp._b('a2'), pg_temp._h('a1')));
select pg_temp._ck('H02 the right hash in UPPER CASE is refused (a hash is lower-case hex, as everyone else prints it)',
  pg_temp._issue(pg_temp._b('a1'), upper(pg_temp._h('a1'))) = '23514:report_snapshot_hash_matches_body',
  pg_temp._issue(pg_temp._b('a1'), upper(pg_temp._h('a1'))));
select pg_temp._ck('H03 a truncated hash is refused; so is an empty one',
  pg_temp._issue(pg_temp._b('a1'), left(pg_temp._h('a1'), 63)) = '23514:report_snapshot_hash_matches_body'
  and pg_temp._issue(pg_temp._b('a1'), '') = '23514:report_snapshot_hash_matches_body',
  null);
select pg_temp._ck('H04 the hash of the COMPACT form does not verify a body that differs only in whitespace: the hash is over the exact bytes',
  pg_temp._issue(pg_temp._b('ws'), pg_temp._h('compact')) = '23514:report_snapshot_hash_matches_body',
  pg_temp._issue(pg_temp._b('ws'), pg_temp._h('compact')));
select pg_temp._ck('H05 a body that is not a JSON object is refused even with its own correct hash: an array and a scalar (23514), and text that is not JSON at all (22P02)',
  pg_temp._issue(pg_temp._b('arr'), pg_temp._h('arr')) = '23514:report_snapshot_body_is_object'
  and pg_temp._issue(pg_temp._b('str'), pg_temp._h('str')) = '23514:report_snapshot_body_is_object'
  and pg_temp._issue(pg_temp._b('junk'), pg_temp._h('junk')) = '22P02',
  pg_temp._issue(pg_temp._b('arr'), pg_temp._h('arr')) || ' / ' || pg_temp._issue(pg_temp._b('str'), pg_temp._h('str')) || ' / ' || pg_temp._issue(pg_temp._b('junk'), pg_temp._h('junk')));
select pg_temp._ck('H06 a report_version that is empty, blank or null is refused',
  pg_temp._issue(pg_temp._b('a1'), pg_temp._h('a1'), '') = '23514:report_snapshot_version_named'
  and pg_temp._issue(pg_temp._b('a1'), pg_temp._h('a1'), '   ') = '23514:report_snapshot_version_named'
  and pg_temp._issue(pg_temp._b('a1'), pg_temp._h('a1'), null) = '23502',
  pg_temp._issue(pg_temp._b('a1'), pg_temp._h('a1'), '') || ' / ' || pg_temp._issue(pg_temp._b('a1'), pg_temp._h('a1'), null));
select pg_temp._ck('H07 the inputs must be a JSON object: an array is refused (23514) and null is refused (23502)',
  pg_temp._issue(pg_temp._b('a1'), pg_temp._h('a1'), 'nyc-v1', '[]'::jsonb) = '23514:report_snapshot_inputs_object'
  and pg_temp._issue(pg_temp._b('a1'), pg_temp._h('a1'), 'nyc-v1', null) = '23502',
  pg_temp._issue(pg_temp._b('a1'), pg_temp._h('a1'), 'nyc-v1', '[]'::jsonb));
select pg_temp._ck('H08 a property_key that is blank is refused; null and a real key are accepted',
  pg_temp._issue(pg_temp._b('a1'), pg_temp._h('a1'), 'nyc-v1', '{}'::jsonb, '  ') = '23514:report_snapshot_key_named'
  and pg_temp._issue(pg_temp._b('a1'), pg_temp._h('a1'), 'nyc-v1', '{}'::jsonb, null) = 'ok'
  and pg_temp._issue(pg_temp._b('a1'), pg_temp._h('a1'), 'nyc-v1', '{}'::jsonb, 'k') = 'ok',
  null);
select pg_temp._ck('H09 control: every refusal above left the table exactly as it was (only the two accepted issues in H08 were added, on top of the earlier two)',
  (select count(*) from public.report_snapshot) = (select n from _n0) + 2,
  (select count(*)::text from public.report_snapshot) || ' vs ' || (select (n + 2)::text from _n0));

-- ---- B01..B02  the stored text is the delivered bytes ------------------------------------------------------
create temp table _b1 as select pg_temp._issue_id(pg_temp._b('utf8'), pg_temp._h('utf8'), 'nyc-v1', '{}'::jsonb) as report_id;
select pg_temp._ck('B01 a body with unordered keys and multibyte characters is accepted, stored byte for byte, its size is counted in BYTES (52, not 48 characters), and the stored text hashes back to the hash issued',
  (select count(*) = 1 and bool_and(s.body = pg_temp._b('utf8') and s.body_bytes = 52 and char_length(s.body) = 48
          and encode(sha256(convert_to(s.body, 'UTF8')), 'hex') = 'a6d781dd804c292e1422443761045549f6aceef647a36d7ef2bdc4d9790c68ce')
     from public.report_snapshot s join _b1 using (report_id)),
  null);
select pg_temp._ck('B01b control: jsonb would NOT have kept it — the same body through jsonb comes back reordered, which is why the column is text',
  pg_temp._b('utf8')::jsonb::text <> pg_temp._b('utf8'),
  pg_temp._b('utf8')::jsonb::text);
create temp table _b2 as select pg_temp._issue_id(pg_temp._b('ws'), pg_temp._h('ws'), 'nyc-v1', '{}'::jsonb) as report_id;
select pg_temp._ck('B02 irregular whitespace is accepted and preserved exactly (16 bytes), and it still verifies against its own hash',
  (select count(*) = 1 and bool_and(s.body = '{"b":1,   "a":2}' and s.body_bytes = 16 and s.content_hash = '449d81fcb59b69ea27ef2fcab7620974181c9d5cc0f6b23c9d96a6fae877168b')
     from public.report_snapshot s join _b2 using (report_id)),
  null);

-- ---- M01..M04  immutable, and the caller cannot choose the identity -----------------------------------------
create temp table _n1 as select count(*) as n, md5(string_agg(report_id::text || content_hash || body, ',' order by report_id)) as fp from public.report_snapshot;
select pg_temp._ck('M01 an update is refused, even for the table owner',
  pg_temp._try($$update public.report_snapshot set report_version = 'x'$$) = 'P0001'
  and pg_temp._try($$update public.report_snapshot set body = '{}'$$) = 'P0001',
  pg_temp._try($$update public.report_snapshot set report_version = 'x'$$));
select pg_temp._ck('M02 a delete is refused',
  pg_temp._try($$delete from public.report_snapshot$$) = 'P0001',
  pg_temp._try($$delete from public.report_snapshot$$));
select pg_temp._ck('M03 a truncate is refused',
  pg_temp._try($$truncate public.report_snapshot$$) = 'P0001',
  pg_temp._try($$truncate public.report_snapshot$$));
select pg_temp._ck('M03b control: after those attempts every stored snapshot is unchanged (same count, same fingerprint)',
  (select count(*) = (select n from _n1) and md5(string_agg(report_id::text || content_hash || body, ',' order by report_id)) = (select fp from _n1)
     from public.report_snapshot),
  null);
select pg_temp._ck('M04 the writer takes five arguments and NONE of them is report_id or generated_at: the database mints both',
  (select count(*) = 1 and bool_and(pronargs = 5 and pg_get_function_arguments(p.oid) !~* 'report_id|generated_at')
     from pg_proc p where p.proname = 'report_snapshot_issue' and p.pronamespace = 'public'::regnamespace),
  (select string_agg(pg_get_function_arguments(p.oid), ' | ') from pg_proc p where p.proname = 'report_snapshot_issue'));
select pg_temp._ck('M05 report_id is the primary key, and a duplicate id is refused (23505)',
  exists (select 1 from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any (i.indkey)
           where i.indrelid = 'public.report_snapshot'::regclass and i.indisprimary and a.attname = 'report_id')
  and pg_temp._try(format($$insert into public.report_snapshot (report_id, content_hash, report_version, inputs, body)
        select report_id, content_hash, report_version, inputs, body from public.report_snapshot limit 1$$)) like '23505%',
  null);

-- ---- L01..L06  lock-down: system-only -------------------------------------------------------------------------
select pg_temp._ck('L01 row-level security is on for the table',
  (select relrowsecurity from pg_class where oid = 'public.report_snapshot'::regclass), null);
select pg_temp._ck('L02 anon and authenticated hold NO privilege on the table (select, insert, update, delete, truncate, references, trigger), and PUBLIC holds none',
  not exists (select 1 from unnest(array['anon', 'authenticated']) r, unnest(array['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger']) p
               where has_table_privilege(r, 'public.report_snapshot', p))
  and not exists (select 1 from pg_class c, aclexplode(c.relacl) a where c.oid = 'public.report_snapshot'::regclass and a.grantee = 0),
  null);
select pg_temp._ck('L02b service_role may only SELECT: it cannot insert (so it cannot choose an id), update, delete or truncate',
  has_table_privilege('service_role', 'public.report_snapshot', 'select')
  and not has_table_privilege('service_role', 'public.report_snapshot', 'insert')
  and not has_table_privilege('service_role', 'public.report_snapshot', 'update')
  and not has_table_privilege('service_role', 'public.report_snapshot', 'delete')
  and not has_table_privilege('service_role', 'public.report_snapshot', 'truncate'),
  null);
select pg_temp._ck('L03 every report_snapshot_ function is locked to service_role, and the writer is security definer with a pinned search_path',
  not exists (select 1 from pg_proc p where p.proname like 'report\_snapshot\_%'
               and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute')
                    or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0)
                    or not has_function_privilege('service_role', p.oid, 'execute')))
  and (select count(*) = 1 and bool_and(p.prosecdef and coalesce(p.proconfig, '{}') @> array['search_path=public, pg_temp'])
         from pg_proc p where p.proname = 'report_snapshot_issue' and p.pronamespace = 'public'::regnamespace),
  null);
select pg_temp._ck('L04a control: all three API roles hold USAGE on the schema, so the refusals below come from the objects and not from the schema',
  has_schema_privilege('anon', 'public', 'usage') and has_schema_privilege('authenticated', 'public', 'usage') and has_schema_privilege('service_role', 'public', 'usage'),
  null);
select pg_temp._ck('L04 AS service_role: the writer works, the table can be read, and a direct insert is refused (42501)',
  pg_temp._as('service_role', format($$select * from public.report_snapshot_issue(%L, %L, 'nyc-v1', '{}'::jsonb)$$, pg_temp._b('a2'), pg_temp._h('a2'))) = 'ok'
  and pg_temp._as('service_role', 'select count(*) from public.report_snapshot') = 'ok'
  and pg_temp._as('service_role', format($$insert into public.report_snapshot (content_hash, report_version, inputs, body) values (%L, 'nyc-v1', '{}'::jsonb, %L)$$, pg_temp._h('a2'), pg_temp._b('a2'))) = '42501',
  pg_temp._as('service_role', 'select count(*) from public.report_snapshot') || ' / ' || pg_temp._as('service_role', format($$insert into public.report_snapshot (content_hash, report_version, inputs, body) values (%L, 'nyc-v1', '{}'::jsonb, %L)$$, pg_temp._h('a2'), pg_temp._b('a2'))));
select pg_temp._ck('L05 AS anon and AS authenticated: the writer is refused, the table cannot be read, and it cannot be written (all 42501)',
  pg_temp._as('anon', format($$select * from public.report_snapshot_issue(%L, %L, 'nyc-v1', '{}'::jsonb)$$, pg_temp._b('a2'), pg_temp._h('a2'))) = '42501'
  and pg_temp._as('anon', 'select count(*) from public.report_snapshot') = '42501'
  and pg_temp._as('authenticated', format($$select * from public.report_snapshot_issue(%L, %L, 'nyc-v1', '{}'::jsonb)$$, pg_temp._b('a2'), pg_temp._h('a2'))) = '42501'
  and pg_temp._as('authenticated', 'select count(*) from public.report_snapshot') = '42501'
  and pg_temp._as('authenticated', format($$insert into public.report_snapshot (content_hash, report_version, inputs, body) values (%L, 'nyc-v1', '{}'::jsonb, %L)$$, pg_temp._h('a2'), pg_temp._b('a2'))) = '42501',
  null);

alter role service_role nobypassrls;
revoke usage on schema public from anon, authenticated, service_role;

\o
select check_name, pass, detail from _r order by n;
