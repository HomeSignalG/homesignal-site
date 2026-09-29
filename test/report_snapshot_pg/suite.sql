-- =====================================================================================
-- DURABLE REPORT SNAPSHOTS — EXECUTABLE ADVERSARIAL SUITE  (docs/report-snapshot.sql)
--
-- Order F (the table, the one writer, the two identifiers) and its F2 privacy boundary (founder
-- decision 2026-09-29): a street address a brokerage typed is NOT permanent intelligence, so it is
-- never stored in this immutable table. It lives in the deletable public.report_private_context, and
-- the snapshot points at it. This suite proves the permanent record survives the address being purged.
-- Every expected answer below is a HARD-CODED constant, never computed by the code under test: the
-- SHA-256 values were produced outside the database (Python hashlib) so a database that hashed the
-- wrong bytes could not agree with them by construction.
-- Output: one row per check (check, pass, detail); a NULL pass is stored as FALSE.
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

-- the error MESSAGE of a statement that fails (null when it succeeds)
create function pg_temp._msg(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlerrm;
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

-- Supabase's service_role has BYPASSRLS and all three API roles hold USAGE on schema public. A freshly
-- created schema here has neither, and without them every refusal below could come from the SCHEMA or
-- from RLS rather than from the objects' own privileges. Set here, undone at the end.
alter role service_role bypassrls;
grant usage on schema public to anon, authenticated, service_role;

-- constants, computed outside the database
create temp table _k (name text primary key, body text, hash text);
insert into _k values
  ('a1',      '{"a":1}',                                       '015abd7f5cc57a2dd94b7590f04ad8084273905ee33ec5cebeae62276a97f862'),
  ('a2',      '{"a":2}',                                       '7e8059f495589fcd981232cc11d00b00da3802c01d688fa1cf1f6bed6e5bb33c'),
  ('ws',      '{"b":1,   "a":2}',                              '449d81fcb59b69ea27ef2fcab7620974181c9d5cc0f6b23c9d96a6fae877168b'),
  ('compact', '{"b":1,"a":2}',                                 'a1d46c3cdb4e5795c8d637f80daeb578ebb1a9a65dc1ed5f11f51794c3c89f3a'),
  ('arr',     '[1,2]',                                         '49a64717d5d4cb19952e6eac2946415cf6879adacf9908e7d872332d32c6e684'),
  ('str',     '"x"',                                           'ba2df4903a2c14e86dc3bcca58911b44ac1d2514b7227bf6eb08cfb978f55a1b'),
  ('junk',    'not json',                                      '7ccfa1fbf3940e6f0c0375d87c0f9235a50514e14cb427bdfaf5077987b26ccf'),
  ('utf8',    '{"z":1,"a":{"m":2,"b":[3,1,2]},"é":"naïve — ok"}', 'a6d781dd804c292e1422443761045549f6aceef647a36d7ef2bdc4d9790c68ce'),
  -- permanent intelligence: a project record near the property, and nothing that identifies the property
  ('clean',   $b${"product":"HomeSignal Development Activity","radius_mi":0.5,"nearby":[{"address":"2 CENTRE ST","lat":40.7132,"lng":-74.0039,"type":"NB","stage":"Permit issued"}]}$b$, '69c387af7d3df0ef88da1c8df62f64c8fe1e9395832e31ba4714132043b880c1'),
  ('other',   $b${"product":"HomeSignal Development Activity","radius_mi":0.5,"nearby":[]}$b$, 'b71eca2abbffac64e752287b1d399ce11c27ed7be8400ce5203e1df293fe2cc3'),
  ('coarse',  $b${"center":{"lat":40.71,"lng":-74.0},"nearby":[]}$b$, 'affa244b74f802f3a4c08cb0626a6263df3a9f35bc0110736e79c0041aba8a9c'),
  -- bodies that each carry exactly ONE kind of private value
  ('leak_addr',  $b${"buyer":{"address":"1 Centre Street, New York, NY 10007"},"nearby":[]}$b$, 'b3133ef9d0db0884842fb4a6b0d93a0bb29f29f59cb4585e83ce73ca010898a0'),
  ('leak_case',  $b${"buyer":{"address":"1   CENTRE   street,  new york, ny 10007"},"nearby":[]}$b$, '7e2491a3a956a4410102edde4c6ad545e8132a154c0290b26ea29e531d78ffb0'),
  ('leak_norm',  $b${"property":{"full_street_name":"1 CENTRE ST"},"nearby":[]}$b$, 'e5a1e323897b474134cf22a3aab16a3932c448377a02c2607945b9191e5de1d5'),
  ('leak_key',   $b${"property":{"addresspointid":"1001387"},"nearby":[]}$b$, '9d4667fb6f7a2388b481dbbdae5cbb6603d4cb8d6def6bad1b8c045ec9fdbf2d'),
  ('leak_label', $b${"note":"prepared for Acme Realty smith listing","nearby":[]}$b$, '3a0d0ad6b9224728aee65a6b8f4177f785d6e2dcea8e915aa1d728db1d04abeb'),
  ('leak_lat',   $b${"property":{"lat":40.712980288068},"nearby":[]}$b$, '8ac335f06606c7020e9ae00f4f97f7ddada53a1a97288155e0ea2e159b14bf45'),
  ('leak_lng',   $b${"property":{"lng":-74.003758107366},"nearby":[]}$b$, '8f432ddbfb66d5c811bc4e2dd7a62b5a03e8788281dc259522bf0d4ad564c77b'),
  -- subject-relative offsets: with the records' own coordinates they recover the property exactly, and the database cannot see them
  ('derived',    $b${"product":"HomeSignal Development Activity","nearby":[{"lat":40.7132,"lng":-74.0039,"distance_mi":0.05,"east_mi":0.03,"north_mi":0.04}]}$b$, '2e52574a7bc86fb51ea68219b64240ce3a7620a036f092278557df0aefbb80c6'),
  -- the street line alone: a FRAGMENT of the address, not a value the private context holds
  ('partial',    $b${"buyer":{"street":"1 Centre Street"},"nearby":[]}$b$, '7cfca62e54ce87e76888b90bb380220ac8dfc0e2cd9feeaf346c0a7f88fb305a');

-- the private contexts the customer would have entered
create temp table _pv (name text primary key, j jsonb);
insert into _pv values
  ('p0',       '{"address":"1 Centre Street, New York, NY 10007","normalized_address":"1 CENTRE ST","latitude":40.712980288068,"longitude":-74.003758107366,"property_keys":["nyc:1001387","1001387"],"label":"Acme Realty Smith listing"}'),
  ('addr',     '{"address":"1 Centre Street, New York, NY 10007"}'),
  ('norm',     '{"address":"1 Centre Street, New York, NY 10007","normalized_address":"1 CENTRE ST"}'),
  ('key',      '{"address":"1 Centre Street, New York, NY 10007","property_keys":["nyc:1001387","1001387"]}'),
  ('label',    '{"address":"1 Centre Street, New York, NY 10007","label":"Acme Realty Smith listing"}'),
  ('point',    '{"address":"1 Centre Street, New York, NY 10007","latitude":40.712980288068,"longitude":-74.003758107366}'),
  ('coarse',   '{"address":"77 Coarse Road, Springfield","latitude":40.71,"longitude":-74.0}'),
  ('short',    '{"address":"9 Short Street","label":"ea","property_keys":["10"]}');

create function pg_temp._b(n text) returns text language sql as $$ select body from _k where name = n $$;
create function pg_temp._h(n text) returns text language sql as $$ select hash from _k where name = n $$;
create function pg_temp._p(n text) returns jsonb language sql as $$ select j from _pv where name = n $$;

-- issue through the one writer; 'ok' or the SQLSTATE[:constraint]
create function pg_temp._issue(p_body text, p_hash text, p_ver text default 'engine-v1',
    p_inputs jsonb default '{"radius_mi":0.5,"zip":"10007"}', p_private jsonb default null)
returns text language sql as
$$ select pg_temp._try(format('select * from public.report_snapshot_issue(%L, %L, %L, %L::jsonb, %L::jsonb)', p_body, p_hash, p_ver, p_inputs, p_private)) $$;

-- the ids the writer returned, or NO ROW when it refused (so a refusal is a failed check, not a crash)
create function pg_temp._go(p_body text, p_hash text, p_ver text, p_inputs jsonb, p_private jsonb)
returns table (rid uuid, cid uuid) language plpgsql as $$
begin
  return query select i.report_id, i.private_context_id from public.report_snapshot_issue(p_body, p_hash, p_ver, p_inputs, p_private) i;
exception when others then
  return;
end $$;

create function pg_temp._purge(p_ctx uuid, p_reason text) returns boolean language plpgsql as $$
begin
  return public.report_private_context_purge(p_ctx, p_reason);
exception when others then
  return null;
end $$;

create function pg_temp._purge_due() returns integer language plpgsql as $$
begin
  return public.report_private_context_purge_due();
exception when others then
  return -1;
end $$;

-- Setup steps that touch the private layer go through these wrappers so that a regression becomes a FAILED
-- CHECK, not a crash that ends the suite before the checks that would have named it (S01 reports any that raised).
create temp table _setup (n serial, step text, result text);
create function pg_temp._open(p_ctx uuid, p_kind text, p_ref text) returns void language plpgsql as $$
begin
  perform public.report_private_context_need_open(p_ctx, p_kind, p_ref);
  insert into _setup (step, result) values ('need_open ' || p_kind, 'ok');
exception when others then
  insert into _setup (step, result) values ('need_open ' || p_kind, sqlstate);
end $$;
create function pg_temp._close(p_ctx uuid, p_kind text, p_ref text) returns void language plpgsql as $$
begin
  perform public.report_private_context_need_close(p_ctx, p_kind, p_ref);
  insert into _setup (step, result) values ('need_close ' || p_kind, 'ok');
exception when others then
  insert into _setup (step, result) values ('need_close ' || p_kind, sqlstate);
end $$;

create function pg_temp._row_md5(p_rid uuid) returns text language sql as
$$ select md5(row_to_json(s)::text) from public.report_snapshot s where s.report_id = p_rid $$;

create function pg_temp._counts() returns text language sql as
$$ select (select count(*) from public.report_snapshot) || '/' || (select count(*) from public.report_private_context) || '/'
       || (select count(*) from public.report_private_context_need) || '/' || (select count(*) from public.report_private_context_event) $$;

-- ---- E01  the environment the hash claim depends on ---------------------------------------------
select pg_temp._ck('E01 control: the database is UTF8 (so sha256(body) is the hash of the UTF-8 bytes a client hashes) and mints uuids',
  (select setting = 'UTF8' from pg_settings where name = 'server_encoding') and to_regprocedure('gen_random_uuid()') is not null,
  (select setting from pg_settings where name = 'server_encoding'));

-- ---- I01..I03  issuing ----------------------------------------------------------------------------------
create temp table _i1 as select * from pg_temp._go(pg_temp._b('clean'), pg_temp._h('clean'), 'engine-v1', '{"radius_mi":0.5,"zip":"10007"}'::jsonb, pg_temp._p('p0'));
select pg_temp._ck('I01 issuing mints a version-4 report_id and a private_context_id, and exactly one snapshot row is stored under that id with a server-assigned generated_at',
  (select count(*) = 1 and bool_and(substr(rid::text, 15, 1) = '4' and cid is not null) from _i1)
  and (select count(*) = 1 and bool_and(s.generated_at is not null) from public.report_snapshot s join _i1 on s.report_id = _i1.rid),
  (select rid::text from _i1));
select pg_temp._ck('I01b the stored row carries what was issued — hash, version, engine inputs, the exact body, its size in BYTES (163) — and a reference to the private context, and nothing that identifies the property',
  (select count(*) = 1 and bool_and(s.content_hash = pg_temp._h('clean') and s.report_version = 'engine-v1'
          and s.engine_inputs = '{"radius_mi":0.5,"zip":"10007"}'::jsonb and s.body = pg_temp._b('clean') and s.body_bytes = 163
          and s.private_context_id = _i1.cid)
     from public.report_snapshot s join _i1 on s.report_id = _i1.rid),
  null);
select pg_temp._ck('I01c the writer opened the first need IN THE SAME TRANSACTION: one open "report" need whose reference is this report_id, and the audit log reads created, need_opened',
  (select count(*) = 1 and bool_and(n.kind = 'report' and n.ref = _i1.rid::text and n.closed_at is null)
     from public.report_private_context_need n join _i1 on n.context_id = _i1.cid)
  and (select string_agg(e.kind || coalesce(':' || e.need_kind, ''), ',' order by e.event_id)
         from public.report_private_context_event e join _i1 on e.context_id = _i1.cid) = 'created,need_opened:report',
  null);
select pg_temp._ck('I01d control: the customer-entered values ARE in the private layer, exactly as sent — so the scans below have something to find',
  (select r.state = 'active' and r.address = '1 Centre Street, New York, NY 10007' and r.normalized_address = '1 CENTRE ST'
          and r.latitude = 40.712980288068 and r.longitude = -74.003758107366
          and r.property_keys = array['nyc:1001387', '1001387'] and r.label = 'Acme Realty Smith listing'
     from _i1, lateral public.report_private_context_read(_i1.cid) r),
  null);

select pg_sleep(0.05);
create temp table _i2 as select * from pg_temp._go(pg_temp._b('clean'), pg_temp._h('clean'), 'engine-v1', '{"radius_mi":0.5,"zip":"10007"}'::jsonb, pg_temp._p('p0'));
select pg_temp._ck('I02 the SAME content issued twice is two snapshots: two different report_ids, two private contexts, ONE content_hash, two issue times — the property the old fingerprint id lacked',
  (select i1.rid is not null and i2.rid is not null and i1.rid <> i2.rid and i1.cid <> i2.cid from _i1 i1, _i2 i2)
  and (select count(distinct report_id) = 2 and count(distinct content_hash) = 1 and count(*) = 2 and count(distinct generated_at) = 2
         from public.report_snapshot where content_hash = pg_temp._h('clean')),
  (select count(*)::text from public.report_snapshot));
create temp table _n2 as select pg_temp._counts() as c;
create temp table _i3 as select * from pg_temp._go(pg_temp._b('other'), pg_temp._h('other'), 'engine-v1', '{"zip":"10007"}'::jsonb, null);
select pg_temp._ck('I03 a report with NO subject address (no private context) is stored with a null reference and creates no context, need or event',
  (select count(*) = 1 and bool_and(rid is not null and cid is null) from _i3)
  and (select s.private_context_id is null from public.report_snapshot s join _i3 on s.report_id = _i3.rid)
  and split_part(pg_temp._counts(), '/', 2) = split_part((select c from _n2), '/', 2)
  and split_part(pg_temp._counts(), '/', 3) = split_part((select c from _n2), '/', 3),
  pg_temp._counts());

-- ---- T01..T03  the permanent table has no place for a private value -----------------------------------
select pg_temp._ck('T01 the permanent table has exactly these eight columns — and none that could hold an address, coordinates, an owner, a client or a label',
  (select string_agg(column_name, ',' order by column_name collate "C") from information_schema.columns where table_schema = 'public' and table_name = 'report_snapshot')
     = 'body,body_bytes,content_hash,engine_inputs,generated_at,private_context_id,report_id,report_version'
  and not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'report_snapshot'
                   and column_name ~* '(address|street|lat|lng|coord|owner|client|email|phone|label|property|parcel|inputs$)' and column_name <> 'engine_inputs'),
  (select string_agg(column_name, ',' order by column_name collate "C") from information_schema.columns where table_schema = 'public' and table_name = 'report_snapshot'));
select pg_temp._ck('T01b report_id has NO column default: the writer is the only thing that mints one, so a caller-supplied id has no path in',
  (select column_default is null from information_schema.columns where table_schema = 'public' and table_name = 'report_snapshot' and column_name = 'report_id'),
  null);
select pg_temp._ck('T02 private_context_id is a foreign key to the private table with NO cascade (no action on delete), so a snapshot can never lose its context row and a context can never be deleted out from under one',
  (select count(*) = 1 and bool_and(c.confrelid = 'public.report_private_context'::regclass and c.confdeltype = 'a' and c.confupdtype = 'a')
     from pg_constraint c where c.conrelid = 'public.report_snapshot'::regclass and c.contype = 'f'),
  null);

-- ---- X01..X09  THE BOUNDARY: no private value in the permanent record ----------------------------------
select pg_temp._ck('X01 the WHOLE permanent row of a snapshot issued with a full private context contains none of the private values — not the address, the normalized address, either coordinate, a property key or the label',
  (select bool_and(position(lower(v) in lower(row_to_json(s)::text)) = 0)
     from public.report_snapshot s join _i1 on s.report_id = _i1.rid,
          unnest(array['1 Centre Street', 'New York, NY', '1 CENTRE ST', '40.712980288068', '-74.003758107366', 'nyc:1001387', '1001387', 'Acme Realty', 'Smith listing']) v),
  null);
select pg_temp._ck('X01b control: the same nine values ARE found in the private layer, so a leak into the permanent row would have been found the same way',
  (select bool_and(position(lower(v) in lower(c::text)) > 0)
     from public.report_private_context c join _i1 on c.context_id = _i1.cid,
          unnest(array['1 Centre Street', 'New York, NY', '1 CENTRE ST', '40.712980288068', '-74.003758107366', 'nyc:1001387', '1001387', 'Acme Realty', 'Smith listing']) v),
  null);

create temp table _nx as select pg_temp._counts() as c;
select pg_temp._ck('X02a a body carrying the typed ADDRESS is refused by the containment trigger (23514) — the only value in this private context',
  pg_temp._issue(pg_temp._b('leak_addr'), pg_temp._h('leak_addr'), 'engine-v1', '{"zip":"10007"}', pg_temp._p('addr')) = '23514:report_snapshot_no_private_values',
  pg_temp._issue(pg_temp._b('leak_addr'), pg_temp._h('leak_addr'), 'engine-v1', '{"zip":"10007"}', pg_temp._p('addr')));
select pg_temp._ck('X02b the same address with different case, spacing and punctuation is refused too',
  pg_temp._issue(pg_temp._b('leak_case'), pg_temp._h('leak_case'), 'engine-v1', '{"zip":"10007"}', pg_temp._p('addr')) = '23514:report_snapshot_no_private_values',
  null);
select pg_temp._ck('X02c a body carrying only the NORMALIZED address is refused',
  pg_temp._issue(pg_temp._b('leak_norm'), pg_temp._h('leak_norm'), 'engine-v1', '{"zip":"10007"}', pg_temp._p('norm')) = '23514:report_snapshot_no_private_values',
  null);
select pg_temp._ck('X02d a body carrying only a PROPERTY KEY (the address-point id that resolves to the address) is refused',
  pg_temp._issue(pg_temp._b('leak_key'), pg_temp._h('leak_key'), 'engine-v1', '{"zip":"10007"}', pg_temp._p('key')) = '23514:report_snapshot_no_private_values',
  null);
select pg_temp._ck('X02e a body carrying only the customer LABEL is refused',
  pg_temp._issue(pg_temp._b('leak_label'), pg_temp._h('leak_label'), 'engine-v1', '{"zip":"10007"}', pg_temp._p('label')) = '23514:report_snapshot_no_private_values',
  null);
select pg_temp._ck('X02f a body carrying only the exact LATITUDE is refused',
  pg_temp._issue(pg_temp._b('leak_lat'), pg_temp._h('leak_lat'), 'engine-v1', '{"zip":"10007"}', pg_temp._p('point')) = '23514:report_snapshot_no_private_values',
  null);
select pg_temp._ck('X02g a body carrying only the exact LONGITUDE is refused',
  pg_temp._issue(pg_temp._b('leak_lng'), pg_temp._h('leak_lng'), 'engine-v1', '{"zip":"10007"}', pg_temp._p('point')) = '23514:report_snapshot_no_private_values',
  null);
select pg_temp._ck('X02i the private values may not travel in the ENGINE INPUTS either: an address in them is refused, and so is the label',
  pg_temp._issue(pg_temp._b('clean'), pg_temp._h('clean'), 'engine-v1', '{"address":"1 Centre Street, New York, NY 10007"}', pg_temp._p('addr')) = '23514:report_snapshot_no_private_values'
  and pg_temp._issue(pg_temp._b('clean'), pg_temp._h('clean'), 'engine-v1', '{"note":"Acme Realty Smith listing"}', pg_temp._p('label')) = '23514:report_snapshot_no_private_values',
  null);
select pg_temp._ck('X03 the refusal message names the FIELD and never the VALUE: a log line or an error shown to a caller cannot leak the address',
  (select m like '%contains the private context''s address' and m not ilike '%Centre%' and m not like '%10007%'
     from (select pg_temp._msg(format('select * from public.report_snapshot_issue(%L, %L, ''engine-v1'', ''{"zip":"10007"}''::jsonb, %L::jsonb)',
             pg_temp._b('leak_addr'), pg_temp._h('leak_addr'), pg_temp._p('addr'))) m) t),
  null);
select pg_temp._ck('X04 every refusal above was ATOMIC: no snapshot, no private context, no need and no audit event was left behind by a write that failed the boundary',
  pg_temp._counts() = (select c from _nx),
  pg_temp._counts() || ' vs ' || (select c from _nx));
select pg_temp._ck('X04b control (run AFTER the atomicity check, because it adds seven accepted rows): every one of those seven bodies is a perfectly valid snapshot on its own — with no private context it is ACCEPTED, so the refusals above are the containment rule and nothing else',
  (select bool_and(pg_temp._issue(_k.body, _k.hash, 'engine-v1', '{"zip":"10007"}', null) = 'ok')
     from _k where _k.name like 'leak\_%'),
  null);
select pg_temp._ck('X05 a body that carries none of a context''s values is accepted with that context — the boundary refuses leaks, not reports (the project''s own address "2 CENTRE ST" beside the subject "1 CENTRE ST")',
  pg_temp._issue(pg_temp._b('clean'), pg_temp._h('clean'), 'engine-v1', '{"zip":"10007"}', pg_temp._p('p0')) = 'ok'
  and pg_temp._issue(pg_temp._b('other'), pg_temp._h('other'), 'engine-v1', '{"zip":"10007"}', pg_temp._p('p0')) = 'ok',
  null);
select pg_temp._ck('X06 a COARSE coordinate (fewer than 5 decimals) is not an exact location and is not scanned: a body showing 40.71 / -74.0 is accepted for a context whose own coordinates are that coarse',
  pg_temp._issue(pg_temp._b('coarse'), pg_temp._h('coarse'), 'engine-v1', '{"zip":"10007"}', pg_temp._p('coarse')) = 'ok',
  null);
select pg_temp._ck('X06b a private value shorter than 3 characters (here the label "ea", which occurs inside "nearby", and the key "10") is not scanned: it would refuse innocent bodies, and it is not an identifier of a property',
  pg_temp._issue(pg_temp._b('clean'), pg_temp._h('clean'), 'engine-v1', '{"zip":"10007"}', pg_temp._p('short')) = 'ok',
  pg_temp._issue(pg_temp._b('clean'), pg_temp._h('clean'), 'engine-v1', '{"zip":"10007"}', pg_temp._p('short')));
select pg_temp._ck('X07 KNOWN LIMIT, pinned on purpose: offsets measured FROM the property (distance_mi, east_mi, north_mi) are derived from the private point and, with each record''s own coordinates, recover it exactly — and the database CANNOT see them. It accepts such a body; the shared module refuses those keys before the database is called, and the engine must never emit them. If this check starts failing, the backstop got better: update it deliberately.',
  pg_temp._issue(pg_temp._b('derived'), pg_temp._h('derived'), 'engine-v1', '{"zip":"10007"}', pg_temp._p('p0')) = 'ok',
  null);
select pg_temp._ck('X07b KNOWN LIMIT, pinned on purpose (found on the production probe, 2026-09-30): the database matches WHOLE private values. A body carrying only a FRAGMENT of the address — the street line "1 Centre Street" without the city and ZIP the context holds — is accepted. The engine must never emit any part of the subject address; Order G''s boundary test has to look for fragments, not only whole values. If this check starts failing, the backstop got better: update it deliberately.',
  pg_temp._issue(pg_temp._b('partial'), pg_temp._h('partial'), 'engine-v1', '{"zip":"10007"}', pg_temp._p('addr')) = 'ok',
  pg_temp._issue(pg_temp._b('partial'), pg_temp._h('partial'), 'engine-v1', '{"zip":"10007"}', pg_temp._p('addr')));
select pg_temp._ck('X08 the private argument goes through the private layer''s own validation before anything is stored: an array, an empty object, and a client name / email / phone are all refused, and nothing is stored',
  pg_temp._issue(pg_temp._b('clean'), pg_temp._h('clean'), 'engine-v1', '{"zip":"10007"}', '[]') = '22023'
  and pg_temp._issue(pg_temp._b('clean'), pg_temp._h('clean'), 'engine-v1', '{"zip":"10007"}', '{}') = '23514'
  and pg_temp._issue(pg_temp._b('clean'), pg_temp._h('clean'), 'engine-v1', '{"zip":"10007"}', '{"address":"1 A St","client_name":"Jane Doe"}') = '22023'
  and pg_temp._issue(pg_temp._b('clean'), pg_temp._h('clean'), 'engine-v1', '{"zip":"10007"}', '{"address":"1 A St","email":"jane@example.com"}') = '22023'
  and pg_temp._issue(pg_temp._b('clean'), pg_temp._h('clean'), 'engine-v1', '{"zip":"10007"}', '{"address":"1 A St","phone":"212-555-0100"}') = '22023',
  pg_temp._issue(pg_temp._b('clean'), pg_temp._h('clean'), 'engine-v1', '{"zip":"10007"}', '{"address":"1 A St","client_name":"Jane Doe"}'));

-- ---- H01..H09  the table refuses what does not describe itself -----------------------------------------
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
select pg_temp._ck('H07 the engine inputs must be a JSON object: an array is refused (23514) and null is refused (23502)',
  pg_temp._issue(pg_temp._b('a1'), pg_temp._h('a1'), 'engine-v1', '[]'::jsonb) = '23514:report_snapshot_engine_inputs_object'
  and pg_temp._issue(pg_temp._b('a1'), pg_temp._h('a1'), 'engine-v1', null) = '23502',
  pg_temp._issue(pg_temp._b('a1'), pg_temp._h('a1'), 'engine-v1', '[]'::jsonb));
select pg_temp._ck('H09 control: every refusal above left the table exactly as it was (no snapshot was added by any of them)',
  (select count(*) from public.report_snapshot) = (select n from _n0),
  (select count(*)::text from public.report_snapshot) || ' vs ' || (select n::text from _n0));

-- ---- B01..B02  the stored text is the delivered bytes ------------------------------------------------------
create temp table _b1 as select * from pg_temp._go(pg_temp._b('utf8'), pg_temp._h('utf8'), 'engine-v1', '{}'::jsonb, null);
select pg_temp._ck('B01 a body with unordered keys and multibyte characters is accepted, stored byte for byte, its size is counted in BYTES (52, not 48 characters), and the stored text hashes back to the hash issued',
  (select count(*) = 1 and bool_and(s.body = pg_temp._b('utf8') and s.body_bytes = 52 and char_length(s.body) = 48
          and encode(sha256(convert_to(s.body, 'UTF8')), 'hex') = 'a6d781dd804c292e1422443761045549f6aceef647a36d7ef2bdc4d9790c68ce')
     from public.report_snapshot s join _b1 on s.report_id = _b1.rid),
  null);
select pg_temp._ck('B01b control: jsonb would NOT have kept it — the same body through jsonb comes back reordered, which is why the column is text',
  pg_temp._b('utf8')::jsonb::text <> pg_temp._b('utf8'),
  pg_temp._b('utf8')::jsonb::text);
create temp table _b2 as select * from pg_temp._go(pg_temp._b('ws'), pg_temp._h('ws'), 'engine-v1', '{}'::jsonb, null);
select pg_temp._ck('B02 irregular whitespace is accepted and preserved exactly (16 bytes), and it still verifies against its own hash',
  (select count(*) = 1 and bool_and(s.body = '{"b":1,   "a":2}' and s.body_bytes = 16 and s.content_hash = '449d81fcb59b69ea27ef2fcab7620974181c9d5cc0f6b23c9d96a6fae877168b')
     from public.report_snapshot s join _b2 on s.report_id = _b2.rid),
  null);

-- ---- P01..P06  PURGING THE PRIVATE CONTEXT LEAVES THE PERMANENT HISTORY UNTOUCHED --------------------------
create temp table _pre as select _i1.rid, _i1.cid, pg_temp._row_md5(_i1.rid) as md5, pg_temp._counts() as counts from _i1;
create temp table _pu as select pg_temp._purge((select cid from _i1), 'verified_privacy_request') as r;
select pg_temp._ck('P01a the privacy request purged the customer''s address (control for what follows)',
  (select r from _pu) is true and (select state = 'purged' and address is null and label is null and latitude is null and property_keys is null
                                    from public.report_private_context_read((select cid from _i1))),
  null);
select pg_temp._ck('P01 after the purge the snapshot row is BYTE-IDENTICAL: same report_id, content_hash, version, generated_at, engine inputs and body, and it is still the only row under that id',
  pg_temp._row_md5((select rid from _i1)) = (select md5 from _pre)
  and (select count(*) = 1 from public.report_snapshot where report_id = (select rid from _i1)),
  pg_temp._row_md5((select rid from _i1)) || ' vs ' || (select md5 from _pre));
select pg_temp._ck('P02 the content_hash still verifies against the stored body after the purge (the integrity record survives), and the issue time is intact',
  (select encode(sha256(convert_to(s.body, 'UTF8')), 'hex') = s.content_hash and s.content_hash = pg_temp._h('clean') and s.generated_at is not null
     from public.report_snapshot s where s.report_id = (select rid from _i1)),
  null);
select pg_temp._ck('P03 the reference still resolves: the private context row still exists as a purged tombstone (state, purge time and reason kept), so the foreign key is intact and "this report''s address was purged, when and why" stays answerable',
  (select c.state = 'purged' and c.purged_at is not null and c.purge_reason = 'verified_privacy_request'
     from public.report_private_context c where c.context_id = (select cid from _i1))
  and (select s.private_context_id = (select cid from _i1) from public.report_snapshot s where s.report_id = (select rid from _i1)),
  null);
select pg_temp._ck('P04 the purge touched ONLY that customer: the second snapshot''s row is unchanged and its private context is still active with its address',
  pg_temp._row_md5((select rid from _i2)) is not null
  and (select r.state = 'active' and r.address = '1 Centre Street, New York, NY 10007' from public.report_private_context_read((select cid from _i2)) r)
  and split_part(pg_temp._counts(), '/', 1) = split_part((select counts from _pre), '/', 1),
  pg_temp._counts() || ' vs ' || (select counts from _pre));
select pg_temp._ck('P05 the permanent history is still immutable after a purge: an update or delete of the snapshot is refused (P0001), and the tombstone it points at cannot be deleted',
  pg_temp._try(format($$update public.report_snapshot set report_version = 'x' where report_id = %L$$, (select rid from _i1))) = 'P0001'
  and pg_temp._try(format($$delete from public.report_snapshot where report_id = %L$$, (select rid from _i1))) = 'P0001'
  and pg_temp._try(format($$delete from public.report_private_context where context_id = %L$$, (select cid from _i1))) = 'P0001',
  null);

-- retention path: the report is archived (its need closes), 90 days pass, the batch purges — snapshot intact
create temp table _pre2 as select pg_temp._row_md5(_i2.rid) as md5 from _i2;
select pg_temp._close((select cid from _i2), 'report', (select rid::text from _i2));
select pg_temp._ck('P06a with the report need closed and no other need, the 90-day clock starts and the address is STILL there during the grace window',
  (select c.purge_due_at = c.last_needed_at + interval '90 days' and c.state = 'active' and c.address is not null
     from public.report_private_context c where c.context_id = (select cid from _i2)),
  null);
update public.report_private_context set last_needed_at = last_needed_at - interval '91 days', purge_due_at = purge_due_at - interval '91 days' where context_id = (select cid from _i2);
create temp table _pd as select pg_temp._purge_due() as n;
select pg_temp._ck('P06 90 days after the last need closed the batch purges the address (reason retention_expired) and the snapshot row is byte-identical to what it was',
  (select n from _pd) = 1
  and (select state = 'purged' and purge_reason = 'retention_expired' and address is null from public.report_private_context_read((select cid from _i2)))
  and pg_temp._row_md5((select rid from _i2)) = (select md5 from _pre2),
  (select n::text from _pd));

-- Follow keeps the address for as long as the Follow lasts
create temp table _f as select * from pg_temp._go(pg_temp._b('clean'), pg_temp._h('clean'), 'engine-v1', '{"zip":"10007"}'::jsonb, pg_temp._p('p0'));
create temp table _pre3 as select pg_temp._row_md5(_f.rid) as md5 from _f;
select pg_temp._open((select cid from _f), 'follow', 'follow-A');
select pg_temp._close((select cid from _f), 'report', (select rid::text from _f));
select pg_temp._ck('P07 while a property Follow is open the address is KEPT and readable (no clock), the report it belongs to has been closed, and the permanent snapshot never changed — a Follow keeps the customer context alive without touching history',
  (select c.purge_due_at is null and c.state = 'active' and c.address = '1 Centre Street, New York, NY 10007'
     from public.report_private_context c where c.context_id = (select cid from _f))
  and pg_temp._row_md5((select rid from _f)) = (select md5 from _pre3),
  null);
select pg_temp._close((select cid from _f), 'follow', 'follow-A');
select pg_temp._ck('P07b when the Follow ends the 90 days start; the address is still there until they run out',
  (select c.purge_due_at = c.last_needed_at + interval '90 days' and c.address is not null from public.report_private_context c where c.context_id = (select cid from _f)),
  null);

select pg_temp._ck('P08 a snapshot cannot be written against a PURGED context (55000) or a context that does not exist (foreign key or trigger, 23503)',
  pg_temp._try(format($$insert into public.report_snapshot (report_id, content_hash, report_version, private_context_id, engine_inputs, body)
        values (gen_random_uuid(), %L, 'engine-v1', %L, '{}'::jsonb, %L)$$, pg_temp._h('other'), (select cid from _i1), pg_temp._b('other'))) = '55000'
  and pg_temp._try(format($$insert into public.report_snapshot (report_id, content_hash, report_version, private_context_id, engine_inputs, body)
        values (gen_random_uuid(), %L, 'engine-v1', '00000000-0000-4000-8000-000000000000', '{}'::jsonb, %L)$$, pg_temp._h('other'), pg_temp._b('other'))) like '23503%',
  null);

-- ---- M01..M05  immutable, and the caller cannot choose the identity -----------------------------------------
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
select pg_temp._ck('M04 the writer takes five arguments — body, hash, version, engine inputs, private context — and NONE of them is report_id, generated_at or a context id: the database mints the identity',
  (select count(*) = 1 and bool_and(pronargs = 5 and pg_get_function_arguments(p.oid) !~* 'report_id|generated_at|context_id|p_id')
     from pg_proc p where p.proname = 'report_snapshot_issue' and p.pronamespace = 'public'::regnamespace),
  (select string_agg(pg_get_function_arguments(p.oid), ' | ') from pg_proc p where p.proname = 'report_snapshot_issue'));
select pg_temp._ck('M04b there is exactly ONE writer, and the Order F writer (whose fifth argument was a property key as text) is gone',
  (select count(*) = 1 from pg_proc p where p.proname = 'report_snapshot_issue' and p.pronamespace = 'public'::regnamespace)
  and to_regprocedure('public.report_snapshot_issue(text, text, text, jsonb, text)') is null,
  null);
select pg_temp._ck('M05 report_id is the primary key, and a duplicate id is refused (23505)',
  exists (select 1 from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any (i.indkey)
           where i.indrelid = 'public.report_snapshot'::regclass and i.indisprimary and a.attname = 'report_id')
  and pg_temp._try(format($$insert into public.report_snapshot (report_id, content_hash, report_version, engine_inputs, body)
        select report_id, content_hash, report_version, engine_inputs, body from public.report_snapshot limit 1$$)) like '23505%',
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
create temp table _sr as select pg_temp._as('service_role', format($$select * from public.report_snapshot_issue(%L, %L, 'engine-v1', '{}'::jsonb, %L::jsonb)$$, pg_temp._b('a2'), pg_temp._h('a2'), '{"address":"SR Test Street"}')) as issued;
select pg_temp._ck('L04 AS service_role: the writer works WITH a private context (its definer rights reach the private tables service_role cannot touch), the table can be read, a direct insert is refused (42501), and the private table cannot be read directly (42501)',
  (select issued from _sr) = 'ok'
  and pg_temp._as('service_role', 'select count(*) from public.report_snapshot') = 'ok'
  and pg_temp._as('service_role', format($$insert into public.report_snapshot (report_id, content_hash, report_version, engine_inputs, body) values (gen_random_uuid(), %L, 'engine-v1', '{}'::jsonb, %L)$$, pg_temp._h('a2'), pg_temp._b('a2'))) = '42501'
  and pg_temp._as('service_role', 'select count(*) from public.report_private_context') = '42501'
  and exists (select 1 from public.report_private_context where address = 'SR Test Street'),
  (select issued from _sr));
select pg_temp._ck('L05 AS anon and AS authenticated: the writer is refused, the table cannot be read, and it cannot be written (all 42501)',
  pg_temp._as('anon', format($$select * from public.report_snapshot_issue(%L, %L, 'engine-v1', '{}'::jsonb, null)$$, pg_temp._b('a2'), pg_temp._h('a2'))) = '42501'
  and pg_temp._as('anon', 'select count(*) from public.report_snapshot') = '42501'
  and pg_temp._as('authenticated', format($$select * from public.report_snapshot_issue(%L, %L, 'engine-v1', '{}'::jsonb, null)$$, pg_temp._b('a2'), pg_temp._h('a2'))) = '42501'
  and pg_temp._as('authenticated', 'select count(*) from public.report_snapshot') = '42501'
  and pg_temp._as('authenticated', format($$insert into public.report_snapshot (report_id, content_hash, report_version, engine_inputs, body) values (gen_random_uuid(), %L, 'engine-v1', '{}'::jsonb, %L)$$, pg_temp._h('a2'), pg_temp._b('a2'))) = '42501'
  and pg_temp._as('anon', format($$select * from public.report_snapshot_issue(%L, %L, 'engine-v1', '{}'::jsonb, %L::jsonb)$$, pg_temp._b('a2'), pg_temp._h('a2'), '{"address":"x"}')) = '42501',
  null);

select pg_temp._ck('S01 every setup step that touches the private layer ran without raising (one that raises is a regression, reported here instead of ending the run)',
  not exists (select 1 from _setup where result <> 'ok') and (select count(*) >= 4 from _setup),
  (select string_agg(step || '=' || result, '; ') from _setup where result <> 'ok'));

alter role service_role nobypassrls;
revoke usage on schema public from anon, authenticated, service_role;

\o
select check_name, pass, detail from _r order by n;
