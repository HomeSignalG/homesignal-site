-- =====================================================================================
-- EVALUATION ENTITLEMENT — EXECUTABLE ADVERSARIAL SUITE  (docs/evaluation-entitlement.sql)
--
-- Order L1 of the Development Activity plan: the database layer of the 10-report brokerage evaluation. Four tables
-- (evaluation, evaluation_invite, evaluation_credit, evaluation_event) and the functions that mint, redeem and revoke a hashed invite
-- and issue a report atomically against a 10-credit pool shared by the members of one brokerage account (public.brokerage_account,
-- Order K0). This suite stands on the REAL account spine, the REAL private-context layer and the REAL snapshot writer, applied unmutated.
-- It proves the posture (empty, unreadable by anon, authenticated and service_role, reached only through system-only functions), the
-- invite (only a hash is stored; one-time; bound to a user id; one generic refusal), the pool (shared by every member, never changed by
-- a member or an invite), the quota (the 11th report is refused, by function AND by constraint), idempotency (a retried key returns
-- the stored report and charges nothing), atomicity (a refusal by the snapshot costs no credit), isolation (non-members, removed
-- members and ended evaluations are refused identically) and privacy (nothing an agent typed reaches any new table).
-- What only two real sessions can prove (the 10th credit, the same key, one token, one seat, REPEATABLE READ) is in run.sh.
-- Every expected answer is a HARD-CODED constant, never computed by the code under test. The suite runs as the table owner; refusals for
-- the API roles are asked AS those roles (SET ROLE).
-- Output: one row per check (check, pass, detail); a NULL pass is stored as FALSE.
-- =====================================================================================
\set ON_ERROR_STOP on
set client_min_messages = warning;
\o /dev/null

create temp table _r (n serial, check_name text, pass boolean, detail text);

create function pg_temp._ck(n text, p boolean, d text default null) returns void language sql as
$$ insert into _r (check_name, pass, detail) values (n, coalesce(p, false), d) $$;

-- A NULL-SAFE "all of these are true": bool_and() IGNORES NULLs, so `bool_and(err like '55000:%')` passes when a call that was meant to be
-- refused returned NO error at all (err is NULL) — a refusal check that cannot see the absence of a refusal. pg_temp.all_t treats a NULL as false.
create function pg_temp._and_strict(a boolean, b boolean) returns boolean language sql immutable as $$ select a and coalesce(b, false) $$;
create aggregate pg_temp.all_t(boolean) (sfunc = pg_temp._and_strict, stype = boolean, initcond = 't');

-- run a statement; 'ok', or SQLSTATE: message (a constraint refusal names the constraint in its message)
create function pg_temp._why(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return sqlstate || ': ' || sqlerrm;
end $$;

-- Setup steps go through this wrapper so that a REGRESSION in the code under test becomes a FAILED CHECK, not a crash that ends the
-- suite before the checks that would have named it. S01 (last) fails if any step raised.
create temp table _setup (n serial, step text, result text);
create function pg_temp._run(p_step text, p_sql text) returns void language plpgsql as $$
begin
  execute p_sql;
  insert into _setup (step, result) values (p_step, 'ok');
exception when others then
  insert into _setup (step, result) values (p_step, sqlstate || ': ' || sqlerrm);
end $$;

-- run a statement and RECORD its outcome, so a check that depends on a state change reads a result that was already produced
create temp table _w (label text primary key, result text);
create function pg_temp._do(p_label text, p_sql text) returns void language plpgsql as $$
begin
  insert into _w values (p_label, pg_temp._why(p_sql));
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

-- the first column of the first row of a query, run AS a role; 'ERR:<sqlstate>' when it raised, NULL when no row
create function pg_temp._as_val(p_role text, p_sql text) returns text language plpgsql as $$
declare v text;
begin
  execute format('set role %I', p_role);
  begin
    execute p_sql into v;
    execute 'reset role';
    return v;
  exception when others then
    execute 'reset role';
    return 'ERR:' || sqlstate;
  end;
end $$;

-- Supabase's service_role has BYPASSRLS and all three API roles hold USAGE on schema public. A freshly created schema here has neither,
-- and without them every refusal below could come from the SCHEMA or from RLS rather than from the object's own privileges.
alter role service_role bypassrls;
grant usage on schema public to anon, authenticated, service_role;

-- fixed identities and keys (test data, not code under test)
create function pg_temp._u(n int) returns uuid language sql immutable as $$ select ('a0000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp._k(n int) returns uuid language sql immutable as $$ select ('e0000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp._h(b text) returns text language sql immutable as $$ select encode(sha256(convert_to(b, 'UTF8')), 'hex') $$;

-- evaluations by label, with the owner token evaluation_create returned (kept here, in a TEMP table: the point of the suite is that no
-- permanent table holds it)
create temp table _t (label text primary key, evaluation_id uuid, brokerage_id uuid, invite_id uuid, token text);
create function pg_temp._mk(p_label text, p_name text, p_seats int default null) returns void language plpgsql as $$
begin
  insert into _t select p_label, c.evaluation_id, c.brokerage_id, c.invite_id, c.owner_token from public.evaluation_create(p_name, p_seats) c;
end $$;
create function pg_temp._ev(p_label text) returns uuid language sql as $$ select evaluation_id from _t where label = p_label $$;
create function pg_temp._bk(p_label text) returns uuid language sql as $$ select brokerage_id from _t where label = p_label $$;

-- redeem results by label
create temp table _rd (label text primary key, evaluation_id uuid, brokerage_id uuid, role text, replayed boolean, err text);
create function pg_temp._rdm(p_label text, p_token text, p_user int) returns void language plpgsql as $$
declare r record;
begin
  select * into r from public.evaluation_invite_redeem(p_token, pg_temp._u(p_user));
  insert into _rd values (p_label, r.evaluation_id, r.brokerage_id, r.role, r.replayed, null);
exception when others then
  insert into _rd (label, err) values (p_label, sqlstate || ': ' || sqlerrm);
end $$;

-- minted invites by label
create temp table _v (label text primary key, invite_id uuid, token text, expires_at timestamptz, err text);
create function pg_temp._mintv(p_label text, p_ev text, p_role text, p_actor int default null, p_ttl interval default interval '14 days') returns void language plpgsql as $$
declare r record;
begin
  select * into r from public.evaluation_invite_mint(pg_temp._ev(p_ev), p_role, case when p_actor is null then null else pg_temp._u(p_actor) end, p_ttl);
  insert into _v values (p_label, r.invite_id, r.token, r.expires_at, null);
exception when others then
  insert into _v (label, err) values (p_label, sqlstate || ': ' || sqlerrm);
end $$;

-- issue results by label. p_body / p_hash default to a clean body derived from the key; p_priv is the private context (or null)
create temp table _i (label text primary key, report_id uuid, generated_at timestamptz, ctx uuid, replayed boolean, ord int, used int, remaining int, st text, err text);
create function pg_temp._iss(p_label text, p_u int, p_k int, p_priv jsonb default null, p_body text default null, p_hash text default null) returns void language plpgsql as $$
declare r record; b text := coalesce(p_body, format('{"product":"HomeSignal Development Activity","n":%s}', p_k));
begin
  select * into r from public.evaluation_report_issue(pg_temp._u(p_u), pg_temp._k(p_k), b, coalesce(p_hash, pg_temp._h(b)), 'engine-v1', '{"engine":"test"}'::jsonb, p_priv);
  insert into _i values (p_label, r.report_id, r.generated_at, r.private_context_id, r.replayed, r.credit_ordinal, r.credits_used, r.credits_remaining, r.evaluation_status, null);
exception when others then
  insert into _i (label, err) values (p_label, sqlstate || ': ' || sqlerrm);
end $$;
create function pg_temp._ie(p_label text) returns text language sql as $$ select err from _i where label = p_label $$;

-- a snapshot written DIRECTLY through the real writer, so a constraint can be asked of a ledger insert that bypasses the function
create temp table _direct (report_id uuid primary key);
create function pg_temp._snap() returns uuid language plpgsql as $$
declare v_id uuid; b text := '{"direct":true}';
begin
  select s.report_id into v_id from public.report_snapshot_issue(b, pg_temp._h(b), 'engine-v1', '{}'::jsonb, null) s;
  insert into _direct values (v_id);
  return v_id;
end $$;

-- the scalar a query returns (as text), by label; 'ERR sqlstate: message' when it raised
create temp table _b (label text primary key, val text);
create function pg_temp._val(p_label text, p_sql text) returns void language plpgsql as $$
declare v text;
begin
  execute p_sql into v;
  insert into _b values (p_label, v);
exception when others then
  insert into _b values (p_label, 'ERR ' || sqlstate || ': ' || sqlerrm);
end $$;

-- how many rows, across the four new tables and the two account tables, hold a needle as text (case-insensitive)
create function pg_temp._leaks(p_needle text) returns bigint language plpgsql as $$
declare t text; n bigint := 0; c bigint;
begin
  foreach t in array array['public.evaluation', 'public.evaluation_invite', 'public.evaluation_credit', 'public.evaluation_event',
                           'public.brokerage_account', 'public.brokerage_member'] loop
    execute format('select count(*) from %s x where position(lower(%L) in lower(to_jsonb(x)::text)) > 0', t, p_needle) into c;
    n := n + c;
  end loop;
  return n;
end $$;

-- ---- Z01..Z07  what the apply left behind: nothing but structure ---------------------------------------------------------------
select pg_temp._ck('Z01 after the apply the four tables exist and hold NO row: the file seeds nothing (the zero is real: the owner reads them, and the account spine and snapshot beneath them exist)',
  to_regclass('public.evaluation') is not null and to_regclass('public.evaluation_invite') is not null
  and to_regclass('public.evaluation_credit') is not null and to_regclass('public.evaluation_event') is not null
  and (select count(*) from public.evaluation) = 0 and (select count(*) from public.evaluation_invite) = 0
  and (select count(*) from public.evaluation_credit) = 0 and (select count(*) from public.evaluation_event) = 0
  and to_regclass('public.brokerage_account') is not null and to_regclass('public.report_snapshot') is not null,
  null);
select pg_temp._ck('Z02 the four tables carry exactly the planned columns and no others: nothing for an address, label, client, email, hash of an address, property key, coordinate, ip, free text, user (but the redeemer) or a counter',
  (select string_agg(column_name || ':' || data_type, ',' order by column_name collate "C") from information_schema.columns where table_schema = 'public' and table_name = 'evaluation')
    = 'brokerage_id:uuid,created_at:timestamp with time zone,evaluation_id:uuid,expires_at:timestamp with time zone,revoked_at:timestamp with time zone,seat_limit:integer,status:text'
  and (select string_agg(column_name || ':' || data_type, ',' order by column_name collate "C") from information_schema.columns where table_schema = 'public' and table_name = 'evaluation_invite')
    = 'created_at:timestamp with time zone,evaluation_id:uuid,expires_at:timestamp with time zone,invite_id:uuid,redeemed_at:timestamp with time zone,redeemed_by:uuid,revoked_at:timestamp with time zone,role:text,status:text,token_hash:text'
  and (select string_agg(column_name || ':' || data_type, ',' order by column_name collate "C") from information_schema.columns where table_schema = 'public' and table_name = 'evaluation_credit')
    = 'evaluation_id:uuid,idempotency_key:uuid,issued_at:timestamp with time zone,ordinal:integer,report_id:uuid'
  and (select string_agg(column_name || ':' || data_type, ',' order by column_name collate "C") from information_schema.columns where table_schema = 'public' and table_name = 'evaluation_event')
    = 'at:timestamp with time zone,evaluation_id:uuid,event_id:bigint,invite_id:uuid,kind:text,role:text',
  (select string_agg(table_name || '.' || column_name, ',' order by table_name collate "C", column_name collate "C") from information_schema.columns
    where table_schema = 'public' and table_name like 'evaluation%'));
select pg_temp._ck('Z03 the constraints are exactly the planned ones (the ledger carries its cap, its key and its report as UNIQUE constraints and a CHECK), and every foreign key points where it should',
  (select string_agg(conname, ',' order by conname collate "C") from pg_constraint where conrelid = 'public.evaluation'::regclass and contype in ('p', 'f', 'c', 'u'))
    = 'evaluation_brokerage_id_fkey,evaluation_expiry,evaluation_one_per_brokerage,evaluation_pkey,evaluation_revoked,evaluation_seat_limit,evaluation_status'
  and (select string_agg(conname, ',' order by conname collate "C") from pg_constraint where conrelid = 'public.evaluation_invite'::regclass and contype in ('p', 'f', 'c', 'u'))
    = 'evaluation_invite_evaluation_id_fkey,evaluation_invite_lifetime,evaluation_invite_pkey,evaluation_invite_redeemed_by_fkey,evaluation_invite_role,evaluation_invite_state,evaluation_invite_token_hash_shape,evaluation_invite_token_hash_unique'
  and (select string_agg(conname, ',' order by conname collate "C") from pg_constraint where conrelid = 'public.evaluation_credit'::regclass and contype in ('p', 'f', 'c', 'u'))
    = 'evaluation_credit_evaluation_id_fkey,evaluation_credit_key_unique,evaluation_credit_ordinal,evaluation_credit_pkey,evaluation_credit_report_id_fkey,evaluation_credit_report_unique'
  and (select string_agg(conname, ',' order by conname collate "C") from pg_constraint where conrelid = 'public.evaluation_event'::regclass and contype in ('p', 'f', 'c', 'u'))
    = 'evaluation_event_evaluation_id_fkey,evaluation_event_invite,evaluation_event_invite_id_fkey,evaluation_event_kind,evaluation_event_pkey,evaluation_event_role'
  and (select string_agg(conrelid::regclass::text || '>' || confrelid::regclass::text || ':' || confdeltype::text, ',' order by conrelid::regclass::text collate "C", confrelid::regclass::text collate "C")
         from pg_constraint where contype = 'f' and conrelid in ('public.evaluation'::regclass, 'public.evaluation_invite'::regclass, 'public.evaluation_credit'::regclass, 'public.evaluation_event'::regclass))
    = 'evaluation>brokerage_account:a,evaluation_credit>evaluation:a,evaluation_credit>report_snapshot:a,evaluation_event>evaluation:a,evaluation_event>evaluation_invite:a,evaluation_invite>auth.users:n,evaluation_invite>evaluation:a',
  (select string_agg(conrelid::regclass::text || '>' || confrelid::regclass::text || ':' || confdeltype::text, ',' order by conrelid::regclass::text collate "C", confrelid::regclass::text collate "C")
     from pg_constraint where contype = 'f' and conrelid in ('public.evaluation'::regclass, 'public.evaluation_invite'::regclass, 'public.evaluation_credit'::regclass, 'public.evaluation_event'::regclass)));
select pg_temp._ck('Z03b the closed vocabularies, the shape of a row, the ledger''s keys and its cap are EXACTLY these definitions (a vocabulary widened by one word, a hash shape loosened or a key made global cannot hide behind an unchanged constraint NAME)',
  (select string_agg(conname || '=' || pg_get_constraintdef(oid), E'\n' order by conname collate "C") from pg_constraint
     where conrelid in ('public.evaluation'::regclass, 'public.evaluation_invite'::regclass, 'public.evaluation_credit'::regclass, 'public.evaluation_event'::regclass)
       and conname in ('evaluation_status', 'evaluation_invite_role', 'evaluation_invite_state', 'evaluation_invite_token_hash_shape', 'evaluation_event_kind', 'evaluation_event_role',
                       'evaluation_event_invite', 'evaluation_credit_ordinal', 'evaluation_credit_pkey', 'evaluation_credit_key_unique', 'evaluation_credit_report_unique',
                       'evaluation_one_per_brokerage', 'evaluation_revoked', 'evaluation_invite_token_hash_unique'))
  = $e$evaluation_credit_key_unique=UNIQUE (evaluation_id, idempotency_key)
evaluation_credit_ordinal=CHECK (((ordinal >= 1) AND (ordinal <= evaluation_report_limit())))
evaluation_credit_pkey=PRIMARY KEY (evaluation_id, ordinal)
evaluation_credit_report_unique=UNIQUE (report_id)
evaluation_event_invite=CHECK (((kind = ANY (ARRAY['invite_minted'::text, 'invite_redeemed'::text, 'invite_revoked'::text])) = (invite_id IS NOT NULL)))
evaluation_event_kind=CHECK ((kind = ANY (ARRAY['created'::text, 'invite_minted'::text, 'invite_redeemed'::text, 'invite_revoked'::text, 'completed'::text, 'revoked'::text])))
evaluation_event_role=CHECK (((role IS NULL) OR (role = ANY (ARRAY['owner'::text, 'agent'::text]))))
evaluation_invite_role=CHECK ((role = ANY (ARRAY['owner'::text, 'agent'::text])))
evaluation_invite_state=CHECK ((((status = 'open'::text) AND (redeemed_at IS NULL) AND (redeemed_by IS NULL) AND (revoked_at IS NULL)) OR ((status = 'redeemed'::text) AND (redeemed_at IS NOT NULL) AND (revoked_at IS NULL)) OR ((status = 'revoked'::text) AND (revoked_at IS NOT NULL) AND (redeemed_at IS NULL) AND (redeemed_by IS NULL))))
evaluation_invite_token_hash_shape=CHECK ((token_hash ~ '^[0-9a-f]{64}$'::text))
evaluation_invite_token_hash_unique=UNIQUE (token_hash)
evaluation_one_per_brokerage=UNIQUE (brokerage_id)
evaluation_revoked=CHECK (((status = 'revoked'::text) = (revoked_at IS NOT NULL)))
evaluation_status=CHECK ((status = ANY (ARRAY['active'::text, 'complete'::text, 'revoked'::text])))$e$,
  null);
select pg_temp._ck('Z04 exactly seven triggers exist on the four tables: the ledger and the log are append-only for row and truncate; the evaluation and the invite have a guard; the 10th ledger row flips the status AFTER INSERT',
  (select string_agg(t.tgname || ':' || c.relname || ':' || case when (t.tgtype & 2) = 2 then 'before' else 'after' end || ':' ||
                     case when (t.tgtype & 1) = 1 then 'row' else 'statement' end || ':' ||
                     concat_ws('+', case when (t.tgtype & 4) = 4 then 'insert' end, case when (t.tgtype & 8) = 8 then 'delete' end,
                                    case when (t.tgtype & 16) = 16 then 'update' end, case when (t.tgtype & 32) = 32 then 'truncate' end),
                     ',' order by t.tgname collate "C")
     from pg_trigger t join pg_class c on c.oid = t.tgrelid where not t.tgisinternal and c.relname in ('evaluation', 'evaluation_invite', 'evaluation_credit', 'evaluation_event'))
    = 'evaluation_credit_append_only:evaluation_credit:before:row:delete+update,evaluation_credit_complete_trg:evaluation_credit:after:row:insert,evaluation_credit_no_truncate:evaluation_credit:before:statement:truncate,evaluation_event_append_only:evaluation_event:before:row:delete+update,evaluation_event_no_truncate:evaluation_event:before:statement:truncate,evaluation_guard_trg:evaluation:before:row:delete+update,evaluation_invite_guard_trg:evaluation_invite:before:row:delete+update',
  null);
select pg_temp._ck('Z05 the indexes are exactly the primary keys, the four unique constraints and one lookup index',
  (select string_agg(indexname, ',' order by indexname collate "C") from pg_indexes where schemaname = 'public' and tablename like 'evaluation%')
    = 'evaluation_credit_key_unique,evaluation_credit_pkey,evaluation_credit_report_unique,evaluation_event_by_evaluation,evaluation_event_pkey,evaluation_invite_pkey,evaluation_invite_token_hash_unique,evaluation_one_per_brokerage,evaluation_pkey',
  null);
select pg_temp._ck('Z06 exactly thirteen functions, with the planned signatures: nothing returns a hash, and nothing is named for a counter, a seat price or a plan',
  (select string_agg(proname || '(' || pg_get_function_identity_arguments(oid) || ')', ';' order by proname collate "C"|| pg_get_function_identity_arguments(oid) collate "C") from pg_proc where pronamespace = 'public'::regnamespace and proname like 'evaluation%')
    = 'evaluation_append_only();evaluation_check();evaluation_create(p_brokerage_name text, p_seat_limit integer, p_expires_at timestamp with time zone, p_invite_ttl interval);evaluation_credit_after_insert();evaluation_guard();evaluation_invite_guard();evaluation_invite_mint(p_evaluation_id uuid, p_role text, p_actor uuid, p_ttl interval);evaluation_invite_redeem(p_token text, p_user_id uuid);evaluation_invite_revoke(p_invite_id uuid, p_actor uuid);evaluation_report_issue(p_user_id uuid, p_idempotency_key uuid, p_body text, p_content_hash text, p_report_version text, p_engine_inputs jsonb, p_private jsonb);evaluation_report_limit();evaluation_revoke(p_evaluation_id uuid);evaluation_usage(p_user_id uuid)',
  (select string_agg(proname, ',' order by proname collate "C") from pg_proc where pronamespace = 'public'::regnamespace and proname like 'evaluation%'));
select pg_temp._ck('Z07 the only sequence behind the four tables is the event identity (the relations named evaluation* are four tables, nine indexes and that one sequence)',
  (select string_agg(relname || ':' || relkind::text, ',' order by relname collate "C") from pg_class where relnamespace = 'public'::regnamespace and relname like 'evaluation%' and relkind = 'S')
    = 'evaluation_event_event_id_seq:S'
  and (select count(*) = 4 from pg_class where relnamespace = 'public'::regnamespace and relname like 'evaluation%' and relkind = 'r')
  and (select count(*) = 9 from pg_class where relnamespace = 'public'::regnamespace and relname like 'evaluation%' and relkind = 'i'),
  (select string_agg(relname || ':' || relkind::text, ',' order by relname collate "C") from pg_class where relnamespace = 'public'::regnamespace and relname like 'evaluation%'));

-- ---- setup: people, six brokerages, their owners and agents ------------------------------------------------------------------
select pg_temp._run('users', $$insert into auth.users (id, email)
  select pg_temp._u(g), 'person' || g || '@example.test' from generate_series(1, 30) g$$);
-- Alpha (owner 1; agents 2, 3), Beta (owner 4; agent 5), Gamma (SEAT LIMIT 1; owner 6), Quota (owner 9), Delta (owner 11), Foxtrot (owner 13), Hotel (owner 16)
select pg_temp._run('mk alpha',   $$select pg_temp._mk('alpha', 'Alpha Realty')$$);
select pg_temp._run('mk beta',    $$select pg_temp._mk('beta', 'Beta Homes')$$);
select pg_temp._run('mk gamma',   $$select pg_temp._mk('gamma', 'Gamma Group', 1)$$);
select pg_temp._run('mk quota',   $$select pg_temp._mk('quota', 'Quota Partners')$$);
select pg_temp._run('mk delta',   $$select pg_temp._mk('delta', 'Delta Estates')$$);
select pg_temp._run('mk foxtrot', $$select pg_temp._mk('foxtrot', 'Foxtrot Co')$$);
select pg_temp._run('mk hotel',   $$select pg_temp._mk('hotel', 'Hotel Homes')$$);
select pg_temp._run('mk scratch1', $$select pg_temp._mk('scratch1', 'Scratch One')$$);
select pg_temp._run('mk scratch2', $$select pg_temp._mk('scratch2', 'Scratch Two')$$);
select pg_temp._run('mk scratch3', $$select pg_temp._mk('scratch3', 'Scratch Three')$$);
select pg_temp._run('mk scratch4', $$select pg_temp._mk('scratch4', 'Scratch Four')$$);
select pg_temp._ck('Z08 evaluation_create made eleven evaluations, each with its own brokerage account, ONE open owner invite and one created event, and no member yet (a brokerage has no owner until its invite is redeemed: stated in the file; the account, the evaluation and the invite are one transaction)',
  (select count(*) = 11 from public.evaluation) and (select count(*) = 11 from public.brokerage_account)
  and (select count(distinct brokerage_id) = 11 from public.evaluation)
  and (select count(*) = 11 and count(*) filter (where role = 'owner' and status = 'open') = 11 from public.evaluation_invite)
  and (select count(*) = 11 from public.evaluation_event where kind = 'created')
  and (select count(*) = 11 from public.evaluation_event where kind = 'invite_minted' and role = 'owner')
  and (select count(*) = 0 from public.brokerage_member) and (select count(*) = 0 from public.evaluation_credit),
  null);

-- ---- L01  the token is shown once, and only its hash is kept ----------------------------------------------------------------------------
select pg_temp._run('mint 25', $$create temp table _m25 as
  select m.invite_id, m.token from generate_series(1, 25) g cross join lateral public.evaluation_invite_mint(pg_temp._ev('scratch1'), case when g > 0 then 'agent' end) m$$);
select pg_temp._ck('L01a each owner token evaluation_create returned is 69 characters, ''hse1_'' and 64 hex, and the hash stored for it is exactly the SHA-256 of that text (64 hex)',
  (select count(*) = 11 and pg_temp.all_t(token ~ '^hse1_[0-9a-f]{64}$' and length(token) = 69) from _t)
  and (select count(*) = 11 and pg_temp.all_t(i.token_hash = encode(sha256(convert_to(t.token, 'UTF8')), 'hex') and i.token_hash ~ '^[0-9a-f]{64}$')
         from _t t join public.evaluation_invite i on i.invite_id = t.invite_id),
  null);
select pg_temp._ck('L01b 25 more mints give 25 distinct tokens and 25 distinct stored hashes, all of the one shape (no token repeats)',
  (select count(*) = 25 and count(distinct token) = 25 and pg_temp.all_t(token ~ '^hse1_[0-9a-f]{64}$') from _m25)
  and (select count(distinct i.token_hash) = 25 from _m25 m join public.evaluation_invite i on i.invite_id = m.invite_id),
  null);
select pg_temp._ck('L01c the RAW token is stored NOWHERE: none of the 36 tokens appears as text in any row of the four new tables or the two account tables; control: the same scan DOES find a brokerage name and a stored hash, so it reads those rows',
  (select sum(pg_temp._leaks(token)) = 0 from (select token from _t union all select token from _m25) x)
  and pg_temp._leaks('Alpha Realty') = 1
  and pg_temp._leaks((select token_hash from public.evaluation_invite order by invite_id limit 1)) = 1,
  (select sum(pg_temp._leaks(token))::text from (select token from _t union all select token from _m25) x));
select pg_temp._ck('L01d no function returns a hash, and the only functions that return or take a token are evaluation_create and evaluation_invite_mint (return) and evaluation_invite_redeem (take): the token is shown once, at birth (control: the same search finds the one function that returns a report_id)',
  (select count(*) = 0 from pg_proc where pronamespace = 'public'::regnamespace and proname like 'evaluation\_%' and pg_get_function_result(oid) ~* 'hash')
  and (select string_agg(proname, ',' order by proname collate "C") from pg_proc where pronamespace = 'public'::regnamespace and proname like 'evaluation\_%' and pg_get_function_result(oid) ~* 'token') = 'evaluation_create,evaluation_invite_mint'
  and (select string_agg(proname, ',') from pg_proc where pronamespace = 'public'::regnamespace and proname like 'evaluation\_%' and pg_get_function_identity_arguments(oid) ~* 'token') = 'evaluation_invite_redeem'
  and (select string_agg(proname, ',') from pg_proc where pronamespace = 'public'::regnamespace and proname like 'evaluation\_%' and pg_get_function_result(oid) ~* 'report_id') = 'evaluation_report_issue',
  null);

-- ---- L02  redeem: one-time, bound to a user, one generic refusal ----------------------------------------------------------------------
select pg_temp._run('redeem alpha owner',       $$select pg_temp._rdm('a-own', (select token from _t where label = 'alpha'), 1)$$);
select pg_temp._run('redeem alpha owner again', $$select pg_temp._rdm('a-own-again', (select token from _t where label = 'alpha'), 1)$$);
select pg_temp._run('redeem alpha by other',    $$select pg_temp._rdm('a-other', (select token from _t where label = 'alpha'), 2)$$);
select pg_temp._ck('L02a a valid owner invite redeemed by a user binds that user: an ACTIVE owner membership of THAT brokerage exists (written in public.brokerage_member by the redeem function), the invite is redeemed by that user with a database-stamped time, and one redeemed event is recorded',
  (select err is null and not replayed and role = 'owner' and brokerage_id = pg_temp._bk('alpha') and evaluation_id = pg_temp._ev('alpha') from _rd where label = 'a-own')
  and (select count(*) = 1 and pg_temp.all_t(role = 'owner' and status = 'active' and brokerage_id = pg_temp._bk('alpha')) from public.brokerage_member where user_id = pg_temp._u(1))
  and (select status = 'redeemed' and redeemed_by = pg_temp._u(1) and redeemed_at is not null and redeemed_at <= now() from public.evaluation_invite where invite_id = (select invite_id from _t where label = 'alpha'))
  and (select count(*) = 1 from public.evaluation_event where kind = 'invite_redeemed' and role = 'owner' and invite_id = (select invite_id from _t where label = 'alpha')),
  (select coalesce(err, 'no error') from _rd where label = 'a-own'));
select pg_temp._ck('L02b the SAME user presenting the token again is idempotent: replayed = true, the same brokerage and role, and still exactly ONE membership and ONE redeemed event for it (no second membership, no second event)',
  (select err is null and replayed and role = 'owner' and brokerage_id = pg_temp._bk('alpha') from _rd where label = 'a-own-again')
  and (select count(*) = 1 from public.brokerage_member where user_id = pg_temp._u(1))
  and (select count(*) = 1 from public.evaluation_event where kind = 'invite_redeemed' and evaluation_id = pg_temp._ev('alpha')),
  (select coalesce(err, 'no error') from _rd where label = 'a-own-again'));
select pg_temp._ck('L02c a DIFFERENT user presenting a redeemed token is refused with the one generic refusal (EV001 INVITE_UNUSABLE), gets no membership, and does not take the invite (it stays bound to the first user)',
  (select err = 'EV001: INVITE_UNUSABLE' from _rd where label = 'a-other')
  and (select count(*) = 0 from public.brokerage_member where user_id = pg_temp._u(2))
  and (select redeemed_by = pg_temp._u(1) from public.evaluation_invite where invite_id = (select invite_id from _t where label = 'alpha')),
  (select err from _rd where label = 'a-other'));
select pg_temp._do('g-unknown',  format($$select * from public.evaluation_invite_redeem(%L, %L)$$, 'hse1_' || repeat('0', 64), pg_temp._u(2)));
select pg_temp._do('g-short',    format($$select * from public.evaluation_invite_redeem(%L, %L)$$, 'hse1_abc', pg_temp._u(2)));
select pg_temp._do('g-noprefix', format($$select * from public.evaluation_invite_redeem(%L, %L)$$, repeat('0', 69), pg_temp._u(2)));
select pg_temp._do('g-upper',    format($$select * from public.evaluation_invite_redeem(%L, %L)$$, 'hse1_' || repeat('A', 64), pg_temp._u(2)));
select pg_temp._do('g-nulltoken', format($$select * from public.evaluation_invite_redeem(%L, %L)$$, null::text, pg_temp._u(2)));
select pg_temp._do('g-nulluser', format($$select * from public.evaluation_invite_redeem(%L, %L)$$, (select token from _m25 limit 1), null::uuid));
select pg_temp._ck('L02d an unknown, a short, a prefix-less, an upper-case and a NULL token, and a NULL user, are each refused with the one generic refusal, and nothing is written',
  (select count(*) = 6 and pg_temp.all_t(result = 'EV001: INVITE_UNUSABLE') from _w where label like 'g-%')
  and (select count(*) = 1 from public.brokerage_member) and (select count(*) = 1 from public.evaluation_invite where status <> 'open'),
  (select string_agg(label || '=' || result, '; ') from _w where label like 'g-%'));
-- an invite whose time has passed: inserted directly (the owner may; created in the past), with a token this suite knows
select pg_temp._run('expired invite', $$insert into public.evaluation_invite (evaluation_id, role, token_hash, created_at, expires_at)
  values (pg_temp._ev('beta'), 'agent', pg_temp._h('hse1_' || repeat('1', 64)), now() - interval '5 days', now() - interval '1 day')$$);
select pg_temp._do('g-expired', format($$select * from public.evaluation_invite_redeem(%L, %L)$$, 'hse1_' || repeat('1', 64), pg_temp._u(5)));
select pg_temp._do('guard-expired', format($$update public.evaluation_invite set status = 'redeemed', redeemed_by = %L where token_hash = %L$$, pg_temp._u(5), pg_temp._h('hse1_' || repeat('1', 64))));
select pg_temp._ck('L02e an EXPIRED invite is refused with the same generic refusal, and the DATABASE itself refuses to mark it redeemed (55000), so no writer can redeem past the lifetime; the user gets no membership and the row stays open',
  (select result = 'EV001: INVITE_UNUSABLE' from _w where label = 'g-expired')
  and (select result like '55000:%expired%' from _w where label = 'guard-expired')
  and (select count(*) = 0 from public.brokerage_member where user_id = pg_temp._u(5))
  and (select status = 'open' and redeemed_by is null from public.evaluation_invite where token_hash = pg_temp._h('hse1_' || repeat('1', 64))),
  (select string_agg(label || '=' || result, '; ') from _w where label in ('g-expired', 'guard-expired')));
select pg_temp._run('mint beta revoke', $$select pg_temp._mintv('beta-rev', 'beta', 'agent')$$);
select pg_temp._val('revoke1', format($$select public.evaluation_invite_revoke(%L)::text$$, (select invite_id from _v where label = 'beta-rev')));
select pg_temp._val('revoke2', format($$select public.evaluation_invite_revoke(%L)::text$$, (select invite_id from _v where label = 'beta-rev')));
select pg_temp._do('g-revoked', format($$select * from public.evaluation_invite_redeem(%L, %L)$$, (select token from _v where label = 'beta-rev'), pg_temp._u(5)));
select pg_temp._val('revoke-redeemed', format($$select public.evaluation_invite_revoke(%L)::text$$, (select invite_id from _t where label = 'alpha')));
select pg_temp._ck('L02f a REVOKED invite is refused with the same generic refusal; revoking says true the first time and false after (idempotent); revoking an already REDEEMED invite changes nothing (false) and leaves the member in place; one revoked event',
  (select val = 'true' from _b where label = 'revoke1') and (select val = 'false' from _b where label = 'revoke2')
  and (select result = 'EV001: INVITE_UNUSABLE' from _w where label = 'g-revoked')
  and (select val = 'false' from _b where label = 'revoke-redeemed')
  and (select status = 'redeemed' from public.evaluation_invite where invite_id = (select invite_id from _t where label = 'alpha'))
  and (select count(*) = 1 from public.brokerage_member where user_id = pg_temp._u(1) and status = 'active')
  and (select status = 'revoked' and revoked_at is not null and redeemed_by is null from public.evaluation_invite where invite_id = (select invite_id from _v where label = 'beta-rev'))
  and (select count(*) = 1 from public.evaluation_event where kind = 'invite_revoked'),
  (select string_agg(label || '=' || val, '; ') from _b where label like 'revoke%'));
select pg_temp._ck('L02g the refusals for an unknown, a malformed, an expired, a revoked and a redeemed-by-someone-else token are IDENTICAL (one SQLSTATE and one message), so a refusal says nothing about WHY',
  (select count(distinct r) = 1 and count(*) = 9 from
     (select result as r from _w where label like 'g-%' union all select err from _rd where label = 'a-other') x),
  (select string_agg(distinct r, ' | ') from (select result as r from _w where label like 'g-%' union all select err from _rd where label = 'a-other') x));
select pg_temp._run('mint beta agent', $$select pg_temp._mintv('beta-ag', 'beta', 'agent')$$);
select pg_temp._run('redeem beta by an existing member', $$select pg_temp._rdm('b-dup', (select token from _v where label = 'beta-ag'), 1)$$);
select pg_temp._run('redeem by a stranger to auth', $$select pg_temp._rdm('x-user', (select token from _v where label = 'beta-ag'), 99)$$);
select pg_temp._ck('L02h a person who already has an ACTIVE membership is refused (EV004 ALREADY_A_MEMBER): an invite cannot mint a second pool for them; the invite is NOT consumed and no second membership exists',
  (select err = 'EV004: ALREADY_A_MEMBER' from _rd where label = 'b-dup')
  and (select count(*) = 1 from public.brokerage_member where user_id = pg_temp._u(1))
  and (select status = 'open' from public.evaluation_invite where invite_id = (select invite_id from _v where label = 'beta-ag')),
  (select err from _rd where label = 'b-dup'));
select pg_temp._ck('L02i a user id that is not in auth.users is refused with the generic refusal, and the invite stays open',
  (select err = 'EV001: INVITE_UNUSABLE' from _rd where label = 'x-user')
  and (select status = 'open' from public.evaluation_invite where invite_id = (select invite_id from _v where label = 'beta-ag')),
  (select err from _rd where label = 'x-user'));
select pg_temp._run('gamma owner',   $$select pg_temp._rdm('g-own', (select token from _t where label = 'gamma'), 6)$$);
select pg_temp._run('gamma invite 1', $$select pg_temp._mintv('g-ag1', 'gamma', 'agent', 6)$$);
select pg_temp._run('gamma invite 2', $$select pg_temp._mintv('g-ag2', 'gamma', 'agent', 6)$$);
select pg_temp._run('gamma agent 1', $$select pg_temp._rdm('g-a1', (select token from _v where label = 'g-ag1'), 7)$$);
select pg_temp._run('gamma agent 2', $$select pg_temp._rdm('g-a2', (select token from _v where label = 'g-ag2'), 8)$$);
select pg_temp._run('gamma owner invite', $$select pg_temp._mintv('g-own2', 'gamma', 'owner')$$);
select pg_temp._run('gamma second owner', $$select pg_temp._rdm('g-o2', (select token from _v where label = 'g-own2'), 8)$$);
select pg_temp._ck('L02j the SEAT LIMIT (Gamma: 1, a parameter, NULL elsewhere) is enforced at redeem: the first agent joins, the second is refused (EV005 SEAT_LIMIT_REACHED) and keeps its invite open, and an OWNER invite is not a seat (the same person then joins as an owner); Alpha, with no limit, holds agents without one (control)',
  (select err is null and role = 'agent' from _rd where label = 'g-a1')
  and (select err = 'EV005: SEAT_LIMIT_REACHED' from _rd where label = 'g-a2')
  and (select status = 'open' from public.evaluation_invite where invite_id = (select invite_id from _v where label = 'g-ag2'))
  and (select count(*) = 1 from public.brokerage_member where brokerage_id = pg_temp._bk('gamma') and role = 'agent' and status = 'active')
  and (select err is null and role = 'owner' from _rd where label = 'g-o2')
  and (select count(*) = 2 from public.brokerage_member where brokerage_id = pg_temp._bk('gamma') and role = 'owner' and status = 'active'),
  (select string_agg(label || '=' || coalesce(err, role), '; ') from _rd where label like 'g-%'));
select pg_temp._ck('L02k the role a membership gets is the role of the invite: an agent invite makes an agent, an owner invite an owner, and nobody becomes an owner by redeeming an agent invite',
  (select role = 'agent' from public.brokerage_member where user_id = pg_temp._u(7))
  and (select role = 'owner' from public.brokerage_member where user_id = pg_temp._u(6))
  and (select role = 'owner' from public.brokerage_member where user_id = pg_temp._u(8)),
  null);
select pg_temp._do('t-reopen',  format($$update public.evaluation_invite set status = 'open', redeemed_at = null, redeemed_by = null where invite_id = %L$$, (select invite_id from _t where label = 'alpha')));
select pg_temp._do('t-rerole',  format($$update public.evaluation_invite set role = 'agent' where invite_id = %L$$, (select invite_id from _t where label = 'alpha')));
select pg_temp._do('t-rehash',  format($$update public.evaluation_invite set token_hash = %L where invite_id = %L$$, pg_temp._h('another'), (select invite_id from _t where label = 'alpha')));
select pg_temp._do('t-unrevoke', format($$update public.evaluation_invite set status = 'open', revoked_at = null where invite_id = %L$$, (select invite_id from _v where label = 'beta-rev')));
select pg_temp._do('t-extend',  format($$update public.evaluation_invite set expires_at = expires_at + interval '1 day' where invite_id = %L$$, (select invite_id from _v where label = 'beta-ag')));
select pg_temp._do('t-delete',  format($$delete from public.evaluation_invite where invite_id = %L$$, (select invite_id from _v where label = 'beta-ag')));
select pg_temp._ck('L02l an invite is terminal and unchangeable at the table: a redeemed one cannot be reopened or re-roled, a revoked one cannot be un-revoked, no token hash or lifetime can be edited, and none can be deleted (all 55000)',
  (select count(*) = 6 and pg_temp.all_t(result like '55000:%') from _w where label like 't-%'),
  (select string_agg(label || '=' || result, '; ') from _w where label like 't-%'));
-- the one change a redeemed invite allows is the account-deletion foreign key clearing redeemed_by ALONE: clearing it while also touching the redemption time is refused
select pg_temp._do('t-fkclear-time', format($$update public.evaluation_invite set redeemed_by = null, redeemed_at = redeemed_at - interval '1 day' where invite_id = %L$$, (select invite_id from _t where label = 'alpha')));
select pg_temp._do('t-fkclear-status', format($$update public.evaluation_invite set redeemed_by = null, status = 'open', redeemed_at = null where invite_id = %L$$, (select invite_id from _t where label = 'alpha')));
select pg_temp._ck('L02r clearing redeemed_by together with ANOTHER change is refused (55000): the redemption time cannot be rewritten, and a redeemed invite cannot be reopened, by a writer that clears the redeemer in the same statement; and the invite is unchanged',
  (select result like '55000:%' from _w where label = 't-fkclear-time') and (select result like '55000:%' from _w where label = 't-fkclear-status')
  and (select status = 'redeemed' and redeemed_by = pg_temp._u(1) and redeemed_at is not null from public.evaluation_invite where invite_id = (select invite_id from _t where label = 'alpha')),
  (select string_agg(label || '=' || result, '; ') from _w where label like 't-fkclear%'));
select pg_temp._ck('L02m the invite table refuses, each by its own rule: an unknown role, an unknown status, an open row that already has a redeemer, a redeemed row with no time, a short, an upper-case and a repeated token hash, a lifetime past 90 days and a lifetime that ends before it begins',
  pg_temp._why(format($$insert into public.evaluation_invite (evaluation_id, role, token_hash, expires_at) values (%L, 'admin', %L, now() + interval '1 day')$$, pg_temp._ev('beta'), pg_temp._h('m1'))) like '23514:%evaluation_invite_role%'
  and pg_temp._why(format($$insert into public.evaluation_invite (evaluation_id, role, token_hash, status, expires_at) values (%L, 'agent', %L, 'pending', now() + interval '1 day')$$, pg_temp._ev('beta'), pg_temp._h('m2'))) like '23514:%evaluation_invite_state%'
  and pg_temp._why(format($$insert into public.evaluation_invite (evaluation_id, role, token_hash, redeemed_by, expires_at) values (%L, 'agent', %L, %L, now() + interval '1 day')$$, pg_temp._ev('beta'), pg_temp._h('m3'), pg_temp._u(5))) like '23514:%evaluation_invite_state%'
  and pg_temp._why(format($$insert into public.evaluation_invite (evaluation_id, role, token_hash, status, expires_at) values (%L, 'agent', %L, 'redeemed', now() + interval '1 day')$$, pg_temp._ev('beta'), pg_temp._h('m4'))) like '23514:%evaluation_invite_state%'
  and pg_temp._why(format($$insert into public.evaluation_invite (evaluation_id, role, token_hash, expires_at) values (%L, 'agent', 'abc123', now() + interval '1 day')$$, pg_temp._ev('beta'))) like '23514:%evaluation_invite_token_hash_shape%'
  and pg_temp._why(format($$insert into public.evaluation_invite (evaluation_id, role, token_hash, expires_at) values (%L, 'agent', %L, now() + interval '1 day')$$, pg_temp._ev('beta'), upper(pg_temp._h('m5')))) like '23514:%evaluation_invite_token_hash_shape%'
  and pg_temp._why(format($$insert into public.evaluation_invite (evaluation_id, role, token_hash, expires_at) values (%L, 'agent', %L, now() + interval '1 day')$$, pg_temp._ev('beta'), (select token_hash from public.evaluation_invite order by invite_id limit 1))) like '23505:%evaluation_invite_token_hash_unique%'
  and pg_temp._why(format($$insert into public.evaluation_invite (evaluation_id, role, token_hash, expires_at) values (%L, 'agent', %L, now() + interval '91 days')$$, pg_temp._ev('beta'), pg_temp._h('m6'))) like '23514:%evaluation_invite_lifetime%'
  and pg_temp._why(format($$insert into public.evaluation_invite (evaluation_id, role, token_hash, created_at, expires_at) values (%L, 'agent', %L, now(), now() - interval '1 day')$$, pg_temp._ev('beta'), pg_temp._h('m7'))) like '23514:%evaluation_invite_lifetime%',
  null);
select pg_temp._do('n-role',   format($$select * from public.evaluation_invite_mint(%L, 'admin')$$, pg_temp._ev('beta')));
select pg_temp._do('n-ttl0',   format($$select * from public.evaluation_invite_mint(%L, 'agent', null, interval '0')$$, pg_temp._ev('beta')));
select pg_temp._do('n-ttl91',  format($$select * from public.evaluation_invite_mint(%L, 'agent', null, interval '91 days')$$, pg_temp._ev('beta')));
select pg_temp._do('n-ttlnull', format($$select * from public.evaluation_invite_mint(%L, 'agent', null, null)$$, pg_temp._ev('beta')));
select pg_temp._do('n-unknown', format($$select * from public.evaluation_invite_mint(%L, 'agent')$$, pg_temp._k(1)));
select pg_temp._ck('L02n mint refuses an unknown role, a lifetime that is zero, longer than 90 days or NULL (22023), and an unknown evaluation (EV003); the default lifetime is 14 days',
  (select result like '22023:%' from _w where label = 'n-role') and (select result like '22023:%' from _w where label = 'n-ttl0')
  and (select result like '22023:%' from _w where label = 'n-ttl91') and (select result like '22023:%' from _w where label = 'n-ttlnull')
  and (select result = 'EV003: NOT_ENTITLED' from _w where label = 'n-unknown')
  and (select expires_at - created_at = interval '14 days' from public.evaluation_invite where invite_id = (select invite_id from _t where label = 'alpha')),
  (select string_agg(label || '=' || result, '; ') from _w where label like 'n-%'));

create temp table _o0 as select (select count(*) from public.brokerage_account) as accounts, (select count(*) from public.evaluation) as evals,
  (select count(*) from public.evaluation_invite) as invs, (select count(*) from public.evaluation_event) as evs;
select pg_temp._do('c-blank',  $$select * from public.evaluation_create('   ')$$);
select pg_temp._do('c-past',   $$select * from public.evaluation_create('Past Expiry Co', null, now() - interval '1 day')$$);
select pg_temp._do('c-ttl',    $$select * from public.evaluation_create('Long Invite Co', null, null, interval '100 days')$$);
select pg_temp._do('c-seats',  $$select * from public.evaluation_create('Negative Seats Co', -1)$$);
select pg_temp._ck('L02o evaluation_create is ONE transaction: a blank name (23514), an expiry in the past (23514), an invite lifetime over 90 days (22023) and a negative seat limit (23514) each leave NO brokerage account, NO evaluation, NO invite and NO event behind (the account is never created without its evaluation and its first owner invite)',
  (select result like '23514:%brokerage_account_name%' from _w where label = 'c-blank') and (select result like '23514:%evaluation_expiry%' from _w where label = 'c-past')
  and (select result like '22023:%' from _w where label = 'c-ttl') and (select result like '23514:%evaluation_seat_limit%' from _w where label = 'c-seats')
  and (select accounts = (select count(*) from public.brokerage_account) and evals = (select count(*) from public.evaluation)
             and invs = (select count(*) from public.evaluation_invite) and evs = (select count(*) from public.evaluation_event) from _o0),
  (select string_agg(label || '=' || result, '; ') from _w where label like 'c-%'));

-- ---- setup: everyone joins their brokerage (the redeem function is the only writer of a membership) ------------------------------------
select pg_temp._run('alpha invite a1', $$select pg_temp._mintv('a-ag1', 'alpha', 'agent', 1)$$);
select pg_temp._run('alpha invite a2', $$select pg_temp._mintv('a-ag2', 'alpha', 'agent', 1)$$);
select pg_temp._run('alpha agent 2 joins', $$select pg_temp._rdm('a-j2', (select token from _v where label = 'a-ag1'), 2)$$);
select pg_temp._run('alpha agent 3 joins', $$select pg_temp._rdm('a-j3', (select token from _v where label = 'a-ag2'), 3)$$);
select pg_temp._run('beta owner joins',  $$select pg_temp._rdm('b-own', (select token from _t where label = 'beta'), 4)$$);
select pg_temp._run('beta agent joins',  $$select pg_temp._rdm('b-ag', (select token from _v where label = 'beta-ag'), 5)$$);
select pg_temp._run('quota owner joins', $$select pg_temp._rdm('q-own', (select token from _t where label = 'quota'), 9)$$);
select pg_temp._run('delta owner joins', $$select pg_temp._rdm('d-own', (select token from _t where label = 'delta'), 11)$$);
select pg_temp._run('foxtrot owner joins', $$select pg_temp._rdm('f-own', (select token from _t where label = 'foxtrot'), 13)$$);
select pg_temp._run('hotel owner joins', $$select pg_temp._rdm('h-own', (select token from _t where label = 'hotel'), 16)$$);
select pg_temp._run('scratch owners join', $$select pg_temp._rdm('s1-own', (select token from _t where label = 'scratch1'), 20), pg_temp._rdm('s2-own', (select token from _t where label = 'scratch2'), 21), pg_temp._rdm('s3-own', (select token from _t where label = 'scratch3'), 22)$$);
-- two brokerages that are NOT evaluations the redeem function made: one with an owner but no evaluation (the account spine on its own),
-- one whose evaluation ran out on its own date (inserted directly: a past expiry cannot be created through the function)
select pg_temp._run('k0-only brokerage', $$with b as (insert into public.brokerage_account (name) values ('K0 Only Co') returning id)
  insert into public.brokerage_member (brokerage_id, user_id, role) select id, pg_temp._u(14), 'owner' from b$$);
select pg_temp._run('echo expired evaluation', $$with b as (insert into public.brokerage_account (name) values ('Echo Expired Co') returning id),
  e as (insert into public.evaluation (brokerage_id, created_at, expires_at) select id, now() - interval '10 days', now() - interval '1 day' from b returning brokerage_id)
  insert into public.brokerage_member (brokerage_id, user_id, role) select brokerage_id, pg_temp._u(12), 'owner' from e$$);
select pg_temp._ck('Z09 the people joined through evaluation_invite_redeem only: every membership in the account spine was written by it (owners 1, 4, 6, 8, 9, 11, 13, 16, 20, 21, 22; agents 2, 3, 5, 7), except the two the setup inserted directly (14 and 12)',
  (select count(*) = 17 from public.brokerage_member)
  and (select string_agg(role || ':' || n, ',' order by role) from (select role, count(*) n from public.brokerage_member group by role) x) = 'agent:4,owner:13',
  (select string_agg(role || ':' || n, ',' order by role) from (select role, count(*) n from public.brokerage_member group by role) x));

select pg_temp._run('peer redeems the owner token', $$select pg_temp._rdm('a-peer', (select token from _t where label = 'alpha'), 2)$$);
select pg_temp._ck('L02p a member of the SAME brokerage presenting someone else''s redeemed owner token is refused (an invite is bound to the person who redeemed it, not to the brokerage): the generic refusal, and their own role is unchanged (agent)',
  (select err = 'EV001: INVITE_UNUSABLE' from _rd where label = 'a-peer')
  and (select count(*) = 1 and pg_temp.all_t(role = 'agent') from public.brokerage_member where user_id = pg_temp._u(2) and status = 'active'),
  (select coalesce(err, role) from _rd where label = 'a-peer'));
select pg_temp._ck('L02q the event log refuses what it must not carry: an unknown kind, an unknown role, an invite event with no invite, and a non-invite event that names one',
  pg_temp._why(format($$insert into public.evaluation_event (evaluation_id, kind) values (%L, 'login')$$, pg_temp._ev('alpha'))) like '23514:%evaluation_event_kind%'
  and pg_temp._why(format($$insert into public.evaluation_event (evaluation_id, kind, role) values (%L, 'created', 'admin')$$, pg_temp._ev('alpha'))) like '23514:%evaluation_event_role%'
  and pg_temp._why(format($$insert into public.evaluation_event (evaluation_id, kind, role) values (%L, 'invite_minted', 'agent')$$, pg_temp._ev('alpha'))) like '23514:%evaluation_event_invite%'
  and pg_temp._why(format($$insert into public.evaluation_event (evaluation_id, kind, invite_id) values (%L, 'created', %L)$$, pg_temp._ev('alpha'), (select invite_id from _t where label = 'alpha'))) like '23514:%evaluation_event_invite%'
  and pg_temp._why(format($$insert into public.evaluation_event (evaluation_id, kind) values (%L, 'created')$$, pg_temp._k(1))) like '23503:%',
  null);

-- ---- L03  one shared pool: a member, or an invite, never changes the limit and never mints a credit -----------------------------------
select pg_temp._run('alpha and beta issue', $x$do $d$ begin
  perform pg_temp._iss('a1', 1, 1); perform pg_temp._iss('a2', 1, 2);
  perform pg_temp._iss('a3', 2, 3); perform pg_temp._iss('a4', 2, 4); perform pg_temp._iss('a5', 2, 5);
  perform pg_temp._iss('a6', 3, 6);
  perform pg_temp._iss('b1', 4, 1); perform pg_temp._iss('b2', 5, 2);
end $d$$x$);
select pg_temp._ck('L03a the owner and two agents of ONE brokerage share ONE pool: Alpha issued 6 reports between its three people with ordinals 1..6 in order and credits used 1..6 (remaining 9..4), and each of the three reads the same evaluation with the same 6 used, 4 remaining, limit 10',
  (select count(*) = 6 and pg_temp.all_t(err is null and not replayed)
          and string_agg(ord::text, ',' order by label) = '1,2,3,4,5,6' and string_agg(used::text, ',' order by label) = '1,2,3,4,5,6'
          and string_agg(remaining::text, ',' order by label) = '9,8,7,6,5,4' from _i where label ~ '^a[1-6]$')
  and (select count(*) = 6 from public.evaluation_credit where evaluation_id = pg_temp._ev('alpha'))
  and (select count(*) = 3 and count(distinct u.evaluation_id) = 1 and min(u.credits_used) = 6 and max(u.credits_used) = 6
          and min(u.credits_remaining) = 4 and max(u.credits_remaining) = 4 and min(u.credit_limit) = 10 and max(u.credit_limit) = 10 and min(u.status) = 'active' and max(u.status) = 'active'
        from generate_series(1, 3) n cross join lateral public.evaluation_usage(pg_temp._u(n)) u),
  (select string_agg(label || '=' || coalesce(err, ord::text), '; ' order by label) from _i where label ~ '^a[1-6]$'));
select pg_temp._run('alpha extras', $$select pg_temp._mintv('a-x1', 'alpha', 'agent', 1)$$);
select pg_temp._run('alpha extras 2', $$select pg_temp._mintv('a-x2', 'alpha', 'agent', 1)$$);
select pg_temp._run('alpha extras 3', $$select pg_temp._mintv('a-x3', 'alpha', 'owner')$$);
select pg_temp._run('alpha extra member', $$select pg_temp._rdm('a-j23', (select token from _v where label = 'a-x1'), 23)$$);
select pg_temp._ck('L03b a FOURTH member and three more invites change NOTHING about the pool: still 6 ledger rows, still ONE evaluation for the brokerage, the new member reads the same 6 used / 4 remaining / limit 10, and no credit row was created by a mint or a redeem',
  (select count(*) = 6 from public.evaluation_credit where evaluation_id = pg_temp._ev('alpha'))
  and (select count(*) = 1 from public.evaluation where brokerage_id = pg_temp._bk('alpha'))
  and (select count(*) = 4 from public.brokerage_member where brokerage_id = pg_temp._bk('alpha') and status = 'active')
  and (select err is null and role = 'agent' from _rd where label = 'a-j23')
  and (select credits_used = 6 and credits_remaining = 4 and credit_limit = 10 and evaluation_id = pg_temp._ev('alpha') from public.evaluation_usage(pg_temp._u(23))),
  (select err from _rd where label = 'a-j23'));
select pg_temp._ck('L03c two brokerages do not share a pool: Beta used 2 while Alpha used 6, each ledger row carries only its own evaluation, and a person who is nobody sees no evaluation at all',
  (select count(*) = 2 and pg_temp.all_t(used between 1 and 2) from _i where label in ('b1', 'b2'))
  and (select count(*) = 2 from public.evaluation_credit where evaluation_id = pg_temp._ev('beta'))
  and (select credits_used = 2 and credits_remaining = 8 from public.evaluation_usage(pg_temp._u(4)))
  and (select credits_used = 2 from public.evaluation_usage(pg_temp._u(5)))
  and (select count(*) = 0 from public.evaluation_usage(pg_temp._u(10)))
  and (select count(*) = 0 from public.evaluation_usage(null)),
  null);

-- ---- L04  the quota: ten, and the 11th is refused ---------------------------------------------------------------------------------
select pg_temp._run('quota 10', $x$do $d$ begin for n in 1..10 loop perform pg_temp._iss('q' || n, 9, 100 + n); end loop; end $d$$x$);
select pg_temp._run('before the 11th', $$create temp table _q0 as select (select count(*) from public.report_snapshot) as snaps,
  (select count(*) from public.report_private_context) as ctxs, (select count(*) from public.evaluation_event where evaluation_id = pg_temp._ev('quota')) as evs$$);
select pg_temp._run('quota 11', $$select pg_temp._iss('q11', 9, 121)$$);
select pg_temp._ck('L04a ten DISTINCT keys all succeed: ordinals 1..10 in order, credits used 1..10, remaining 9..0, ten different reports',
  (select count(*) = 10 and pg_temp.all_t(err is null and not replayed) and count(distinct report_id) = 10
          and string_agg(ord::text, ',' order by substring(label from 2)::int) = '1,2,3,4,5,6,7,8,9,10'
          and string_agg(remaining::text, ',' order by substring(label from 2)::int) = '9,8,7,6,5,4,3,2,1,0'
     from _i where label ~ '^q([1-9]|10)$'),
  (select string_agg(label || '=' || coalesce(err, ord::text), '; ') from _i where label ~ '^q([1-9]|10)$' and err is not null));
select pg_temp._ck('L04b the 11th key is REFUSED with EVALUATION_COMPLETE (EV002) and costs nothing: 10 ledger rows, no 11th snapshot, no new private context, no new event; the reader says complete, 10 used, 0 remaining',
  (select err = 'EV002: EVALUATION_COMPLETE' from _i where label = 'q11')
  and (select count(*) = 10 from public.evaluation_credit where evaluation_id = pg_temp._ev('quota'))
  and (select snaps = (select count(*) from public.report_snapshot) and ctxs = (select count(*) from public.report_private_context)
             and evs = (select count(*) from public.evaluation_event where evaluation_id = pg_temp._ev('quota')) from _q0)
  and (select status = 'complete' and credits_used = 10 and credits_remaining = 0 and credit_limit = 10 from public.evaluation_usage(pg_temp._u(9))),
  (select err from _i where label = 'q11'));
select pg_temp._ck('L04c the status flips to complete at the 10th credit and not before: active on the first nine results, complete on the tenth, and exactly ONE completed event was written',
  (select count(*) = 9 and pg_temp.all_t(st = 'active') from _i where label ~ '^q[1-9]$')
  and (select st = 'complete' from _i where label = 'q10')
  and (select status = 'complete' from public.evaluation where evaluation_id = pg_temp._ev('quota'))
  and (select count(*) = 1 from public.evaluation_event where evaluation_id = pg_temp._ev('quota') and kind = 'completed'),
  (select string_agg(label || '=' || st, ',' order by substring(label from 2)::int) from _i where label ~ '^q([1-9]|10)$'));
select pg_temp._do('d-11',  format($$insert into public.evaluation_credit (evaluation_id, ordinal, idempotency_key, report_id) values (%L, 11, %L, %L)$$, pg_temp._ev('quota'), pg_temp._k(900), pg_temp._snap()));
select pg_temp._do('d-10',  format($$insert into public.evaluation_credit (evaluation_id, ordinal, idempotency_key, report_id) values (%L, 10, %L, %L)$$, pg_temp._ev('quota'), pg_temp._k(901), pg_temp._snap()));
select pg_temp._do('d-0',   format($$insert into public.evaluation_credit (evaluation_id, ordinal, idempotency_key, report_id) values (%L, 0, %L, %L)$$, pg_temp._ev('quota'), pg_temp._k(902), pg_temp._snap()));
select pg_temp._do('d-neg', format($$insert into public.evaluation_credit (evaluation_id, ordinal, idempotency_key, report_id) values (%L, -1, %L, %L)$$, pg_temp._ev('quota'), pg_temp._k(903), pg_temp._snap()));
select pg_temp._do('d-100', format($$insert into public.evaluation_credit (evaluation_id, ordinal, idempotency_key, report_id) values (%L, 100, %L, %L)$$, pg_temp._ev('quota'), pg_temp._k(904), pg_temp._snap()));
select pg_temp._ck('L04d the cap holds BY CONSTRAINT, for a writer that bypasses the function: an 11th ordinal, ordinal 0, a negative one and 100 are refused by the ordinal CHECK, a second row for ordinal 10 by the primary key, and the ledger still has 10 rows',
  (select result like '23514:%evaluation_credit_ordinal%' from _w where label = 'd-11') and (select result like '23514:%evaluation_credit_ordinal%' from _w where label = 'd-0')
  and (select result like '23514:%evaluation_credit_ordinal%' from _w where label = 'd-neg') and (select result like '23514:%evaluation_credit_ordinal%' from _w where label = 'd-100')
  and (select result like '23505:%evaluation_credit_pkey%' from _w where label = 'd-10')
  and (select count(*) = 10 from public.evaluation_credit where evaluation_id = pg_temp._ev('quota')),
  (select string_agg(label || '=' || result, '; ') from _w where label like 'd-%'));
select pg_temp._ck('L04e the number is defined ONCE: evaluation_report_limit() is 10, and the ledger''s ordinal CHECK is written in terms of it',
  public.evaluation_report_limit() = 10
  and (select pg_get_constraintdef(oid) from pg_constraint where conname = 'evaluation_credit_ordinal') like '%evaluation_report_limit()%'
  and (select pg_get_constraintdef(oid) from pg_constraint where conname = 'evaluation_credit_ordinal') like '%ordinal >= 1%',
  (select pg_get_constraintdef(oid) from pg_constraint where conname = 'evaluation_credit_ordinal'));

-- ---- L05  idempotency: a retried key returns the stored report and charges nothing -----------------------------------------------------------
select pg_temp._run('before replays', $$create temp table _s0 as select (select count(*) from public.report_snapshot) as snaps,
  (select count(*) from public.report_private_context) as ctxs, (select count(*) from public.evaluation_credit) as credits,
  (select count(*) from public.evaluation_event) as evs$$);
select pg_temp._run('replays', $x$do $d$ begin
  perform pg_temp._iss('a1-again', 1, 1);                 -- the same person retries
  perform pg_temp._iss('a1-by-2', 2, 1);                  -- another member of the same evaluation presents the same key
  perform pg_temp._iss('b1-again', 4, 1);                 -- Beta used the SAME uuid as Alpha for its own first report
  perform pg_temp._iss('q10-again', 9, 110);              -- the 10th, after the evaluation is complete
  perform pg_temp._iss('q1-again', 9, 101);
  perform pg_temp._iss('q12', 9, 122);                    -- a NEW key on a complete evaluation
  perform pg_temp._iss('a1-diff', 1, 1, '{"address":"999 Other Road"}'::jsonb, '{"different":true}');   -- same key, different content
end $d$$x$);
select pg_temp._ck('L05a the same key twice returns the SAME report: replayed = true, the same report_id and ordinal, and nothing was charged or stored: still 6 ledger rows for Alpha, no new snapshot, no new private context, no new event',
  (select err is null and replayed and report_id = (select report_id from _i where label = 'a1') and ord = 1 and used = 6 and remaining = 4 from _i where label = 'a1-again')
  and (select count(*) = 6 from public.evaluation_credit where evaluation_id = pg_temp._ev('alpha'))
  and (select count(*) = 1 from public.evaluation_credit where evaluation_id = pg_temp._ev('alpha') and idempotency_key = pg_temp._k(1))
  and (select snaps = (select count(*) from public.report_snapshot) and ctxs = (select count(*) from public.report_private_context)
             and credits = (select count(*) from public.evaluation_credit) and evs = (select count(*) from public.evaluation_event) from _s0),
  (select coalesce(err, 'replayed=' || replayed || ' used=' || used) from _i where label = 'a1-again'));
select pg_temp._ck('L05b a retry still works on a COMPLETE evaluation: the 10th key and the 1st key return their stored reports (replayed, status complete, 0 remaining), while a NEW key is refused EVALUATION_COMPLETE',
  (select err is null and replayed and report_id = (select report_id from _i where label = 'q10') and ord = 10 and used = 10 and remaining = 0 and st = 'complete' from _i where label = 'q10-again')
  and (select err is null and replayed and report_id = (select report_id from _i where label = 'q1') and ord = 1 from _i where label = 'q1-again')
  and (select err = 'EV002: EVALUATION_COMPLETE' from _i where label = 'q12'),
  (select string_agg(label || '=' || coalesce(err, 'ok'), '; ') from _i where label in ('q10-again', 'q1-again', 'q12')));
select pg_temp._ck('L05c a key is bound to ONE evaluation: Alpha and Beta both used the same uuid for their first report and got two different reports and two different credits; Beta presenting it again gets BETA''s report, never Alpha''s',
  (select report_id is not null from _i where label = 'a1') and (select report_id is not null from _i where label = 'b1')
  and (select report_id <> (select report_id from _i where label = 'b1') from _i where label = 'a1')
  and (select count(*) = 2 and count(distinct evaluation_id) = 2 from public.evaluation_credit where idempotency_key = pg_temp._k(1))
  and (select replayed and report_id = (select report_id from _i where label = 'b1') and ord = 1 and used = 2 from _i where label = 'b1-again'),
  (select string_agg(label || '=' || coalesce(report_id::text, err), '; ') from _i where label in ('a1', 'b1', 'b1-again')));
select pg_temp._ck('L05e (stated limit, D-L6) the key is bound to the evaluation, NOT to the content: the same key with a DIFFERENT body and address returns the FIRST report and stores nothing new (no second snapshot, no second private context). The handler must detect the mismatch while the private context is active',
  (select err is null and replayed and report_id = (select report_id from _i where label = 'a1') from _i where label = 'a1-diff')
  and (select snaps = (select count(*) from public.report_snapshot) and ctxs = (select count(*) from public.report_private_context) from _s0),
  (select coalesce(err, 'replayed=' || replayed) from _i where label = 'a1-diff'));
select pg_temp._do('k-dupkey',  format($$insert into public.evaluation_credit (evaluation_id, ordinal, idempotency_key, report_id) values (%L, 3, %L, %L)$$, pg_temp._ev('beta'), pg_temp._k(1), pg_temp._snap()));
select pg_temp._do('k-dupreport', format($$insert into public.evaluation_credit (evaluation_id, ordinal, idempotency_key, report_id) values (%L, 3, %L, %L)$$, pg_temp._ev('beta'), pg_temp._k(905), (select report_id from _i where label = 'a1')));
select pg_temp._do('k-nullkey', format($$select * from public.evaluation_report_issue(%L, null, '{"x":1}', %L, 'engine-v1', '{}'::jsonb, null)$$, pg_temp._u(4), pg_temp._h('{"x":1}')));
select pg_temp._ck('L05d the one-credit-per-key and one-credit-per-report rules are CONSTRAINTS, not conventions: a second ledger row repeating an evaluation''s key is refused by unique(evaluation_id, idempotency_key), one repeating a report_id by unique(report_id); and a call with no key is refused (22023 IDEMPOTENCY_KEY_REQUIRED) and writes nothing',
  (select result like '23505:%evaluation_credit_key_unique%' from _w where label = 'k-dupkey')
  and (select result like '23505:%evaluation_credit_report_unique%' from _w where label = 'k-dupreport')
  and (select result = '22023: IDEMPOTENCY_KEY_REQUIRED' from _w where label = 'k-nullkey')
  and (select count(*) = 2 from public.evaluation_credit where evaluation_id = pg_temp._ev('beta')),
  (select string_agg(label || '=' || result, '; ') from _w where label like 'k-%'));
select pg_temp._do('k-nullreport', format($$insert into public.evaluation_credit (evaluation_id, ordinal, idempotency_key, report_id) values (%L, 3, %L, null)$$, pg_temp._ev('beta'), pg_temp._k(906)));
select pg_temp._do('k-ghostreport', format($$insert into public.evaluation_credit (evaluation_id, ordinal, idempotency_key, report_id) values (%L, 3, %L, %L)$$, pg_temp._ev('beta'), pg_temp._k(907), pg_temp._k(1)));
select pg_temp._do('k-ghosteval', format($$insert into public.evaluation_credit (evaluation_id, ordinal, idempotency_key, report_id) values (%L, 1, %L, %L)$$, pg_temp._k(1), pg_temp._k(908), pg_temp._snap()));
select pg_temp._ck('L05f every ledger row LINKS a stored report and an existing evaluation: a row with no report_id is refused (NOT NULL), one naming a report that does not exist and one naming an evaluation that does not exist are each refused by their foreign key — a credit cannot be spent on nothing',
  (select result like '23502:%report_id%' from _w where label = 'k-nullreport')
  and (select result like '23503:%evaluation_credit_report_id_fkey%' from _w where label = 'k-ghostreport')
  and (select result like '23503:%evaluation_credit_evaluation_id_fkey%' from _w where label = 'k-ghosteval')
  and (select count(*) = 2 from public.evaluation_credit where evaluation_id = pg_temp._ev('beta')),
  (select string_agg(label || '=' || result, '; ') from _w where label in ('k-nullreport', 'k-ghostreport', 'k-ghosteval')));
-- ---- L06  atomicity: a refusal by the snapshot costs no credit ------------------------------------------------------------------------------------
select pg_temp._run('before refusals', $$create temp table _a0 as select (select count(*) from public.evaluation_credit) as credits,
  (select count(*) from public.report_snapshot) as snaps, (select count(*) from public.report_private_context) as ctxs,
  (select count(*) from public.evaluation_event) as evs, (select count(*) from public.report_private_context_need) as needs$$);
select pg_temp._run('refusals', $x$do $d$ begin
  perform pg_temp._iss('leak', 1, 90, '{"address":"77 Leak Lane, Springfield"}'::jsonb, '{"note":"deliver to 77 Leak Lane, Springfield"}');
  perform pg_temp._iss('badhash', 1, 91, null, '{"x":1}', 'deadbeef');
  perform pg_temp._iss('badctx', 1, 92, '{"address":"1 A Street","client":"Smith"}'::jsonb);
  perform pg_temp._iss('noaddr', 1, 93, '{"label":"no address here"}'::jsonb);
end $d$$x$);
select pg_temp._ck('L06a a snapshot REFUSED by the containment trigger (the address is in the body) leaves NOTHING behind: no ledger row, no snapshot, no private context, no need, no event; the call raised the snapshot''s own error, and Alpha still has 6 credits used',
  (select err like '23514: report_snapshot: the permanent snapshot contains the private context%' from _i where label = 'leak')
  and (select credits = (select count(*) from public.evaluation_credit) and snaps = (select count(*) from public.report_snapshot)
             and ctxs = (select count(*) from public.report_private_context) and evs = (select count(*) from public.evaluation_event)
             and needs = (select count(*) from public.report_private_context_need) from _a0)
  and (select credits_used = 6 and credits_remaining = 4 from public.evaluation_usage(pg_temp._u(1))),
  (select err from _i where label = 'leak'));
select pg_temp._ck('L06b every other refusal by the snapshot layer is atomic too: a wrong content hash (23514, the hash CHECK), an unknown private field (22023) and a context with no address (23514) each leave no ledger row, no snapshot, no context',
  (select err like '23514:%report_snapshot_hash_matches_body%' from _i where label = 'badhash')
  and (select err like '22023:%unknown field%' from _i where label = 'badctx')
  and (select err like '23514:%an address is required%' from _i where label = 'noaddr')
  and (select credits = (select count(*) from public.evaluation_credit) and snaps = (select count(*) from public.report_snapshot)
             and ctxs = (select count(*) from public.report_private_context) from _a0),
  (select string_agg(label || '=' || coalesce(err, 'ok'), '; ') from _i where label in ('badhash', 'badctx', 'noaddr')));
select pg_temp._run('retry after refusal', $$select pg_temp._iss('leak-retry', 1, 90)$$);
select pg_temp._ck('L06c the credit was NOT lost: the key of the refused call is not burned, so the same key with a clean body succeeds as ordinal 7 (credits used 7, remaining 3), not replayed',
  (select err is null and not replayed and ord = 7 and used = 7 and remaining = 3 from _i where label = 'leak-retry'),
  (select coalesce(err, 'ord=' || ord) from _i where label = 'leak-retry'));
select pg_temp._ck('L06d every stored snapshot is a credit: across all the refusals and replays above, the snapshots the suite did not write directly equal the ledger rows (control: the suite did write some directly)',
  (select count(*) > 0 from _direct)
  and (select count(*) from public.report_snapshot) - (select count(*) from _direct) = (select count(*) from public.evaluation_credit),
  (select (select count(*) from public.report_snapshot) || ' snapshots, ' || (select count(*) from _direct) || ' direct, ' || (select count(*) from public.evaluation_credit) || ' credits'));

-- ---- L08  isolation: who may, and that every refusal looks the same -----------------------------------------------------------------------
select pg_temp._run('remove alpha agent 3', $$update public.brokerage_member set status = 'deactivated' where user_id = pg_temp._u(3)$$);
select pg_temp._run('e issues', $x$do $d$ begin
  perform pg_temp._iss('e-outsider', 10, 301);                 -- has no membership at all
  perform pg_temp._iss('e-k0only', 14, 302);                   -- a member of a brokerage that has NO evaluation
  perform pg_temp._iss('e-removed', 3, 303);                   -- a REMOVED member (Alpha agent 3)
  perform pg_temp._iss('e-removed-replay', 3, 6);              -- ... asking for the report they themselves made before they left
  perform pg_temp._iss('e-member-replay', 1, 6);               -- control: a CURRENT member can still retrieve that credit
  perform pg_temp._iss('e-expired', 12, 304);                  -- the evaluation ended on its own date
  perform pg_temp._iss('g50', 6, 50);                          -- Gamma's first report, key 50
  perform pg_temp._iss('b50', 4, 50);                          -- Beta's, the SAME uuid
end $d$$x$);
select pg_temp._do('e-nulluser', format($$select * from public.evaluation_report_issue(null, %L, '{"x":1}', %L, 'engine-v1', '{}'::jsonb, null)$$, pg_temp._k(305), pg_temp._h('{"x":1}')));
select pg_temp._ck('L08a a person with no membership, a member of a brokerage that has no evaluation, and a NULL user are each refused NOT_ENTITLED (EV003), and nothing is written',
  (select err = 'EV003: NOT_ENTITLED' from _i where label = 'e-outsider') and (select err = 'EV003: NOT_ENTITLED' from _i where label = 'e-k0only')
  and (select result = 'EV003: NOT_ENTITLED' from _w where label = 'e-nulluser')
  and (select count(*) = 0 from public.evaluation_credit where idempotency_key in (pg_temp._k(301), pg_temp._k(302), pg_temp._k(305))),
  (select string_agg(label || '=' || coalesce(err, 'ok'), '; ') from _i where label in ('e-outsider', 'e-k0only')));
select pg_temp._ck('L08b a REMOVED member is refused, even for the key they used themselves, while a current member of the same evaluation still retrieves that credit (the credit belongs to the evaluation, the right to ask belongs to the membership)',
  (select err = 'EV003: NOT_ENTITLED' from _i where label = 'e-removed') and (select err = 'EV003: NOT_ENTITLED' from _i where label = 'e-removed-replay')
  and (select err is null and replayed and report_id = (select report_id from _i where label = 'a6') from _i where label = 'e-member-replay')
  and (select count(*) = 0 from public.evaluation_credit where idempotency_key = pg_temp._k(303))
  and (select count(*) = 0 from public.evaluation_usage(pg_temp._u(3))),
  (select string_agg(label || '=' || coalesce(err, 'ok'), '; ') from _i where label in ('e-removed', 'e-removed-replay', 'e-member-replay')));
select pg_temp._ck('L08c a key is not a window into another evaluation: Gamma and Beta used the same key uuid and each got ITS OWN report and credit, in its own ledger; Alpha''s ledger is untouched (still 7 rows)',
  (select err is null and not replayed from _i where label = 'g50') and (select err is null and not replayed from _i where label = 'b50')
  and (select report_id <> (select report_id from _i where label = 'b50') from _i where label = 'g50')
  and (select count(*) = 2 and count(distinct evaluation_id) = 2 from public.evaluation_credit where idempotency_key = pg_temp._k(50))
  and (select count(*) = 7 from public.evaluation_credit where evaluation_id = pg_temp._ev('alpha')),
  null);
-- Delta: issues once, is REVOKED, and is refused from then on, replay included; Echo's expiry date has passed (inserted directly)
select pg_temp._run('delta issue', $$select pg_temp._iss('d1', 11, 201)$$);
select pg_temp._run('delta invite', $$select pg_temp._mintv('d-ag', 'delta', 'agent')$$);
select pg_temp._val('delta revoke', format($$select public.evaluation_revoke(%L)::text$$, pg_temp._ev('delta')));
select pg_temp._val('delta revoke again', format($$select public.evaluation_revoke(%L)::text$$, pg_temp._ev('delta')));
select pg_temp._run('delta after revoke', $x$do $d$ begin
  perform pg_temp._iss('e-revoked', 11, 202);
  perform pg_temp._iss('e-revoked-replay', 11, 201);
  perform pg_temp._mintv('e-revoked-mint', 'delta', 'agent');
  perform pg_temp._rdm('d-ag-after', (select token from _v where label = 'd-ag'), 15);
end $d$$x$);
select pg_temp._do('delta to active', format($$update public.evaluation set status = 'active' where evaluation_id = %L$$, pg_temp._ev('delta')));
select pg_temp._do('delta to complete', format($$update public.evaluation set status = 'complete' where evaluation_id = %L$$, pg_temp._ev('delta')));
select pg_temp._do('delta revoke unknown', format($$select public.evaluation_revoke(%L)$$, pg_temp._k(1)));
select pg_temp._ck('L08d a REVOKED evaluation is refused for everyone: a new key and a replay are NOT_ENTITLED, minting is refused, an open invite for it can no longer be redeemed (generic), revoking says true then false, revoked_at is database-stamped, one revoked event, and the reader still shows it (revoked, 1 used) so the workspace can say so. Revoked is terminal even for the table owner (55000)',
  (select err is null and ord = 1 from _i where label = 'd1')
  and (select val = 'true' from _b where label = 'delta revoke') and (select val = 'false' from _b where label = 'delta revoke again')
  and (select err = 'EV003: NOT_ENTITLED' from _i where label = 'e-revoked') and (select err = 'EV003: NOT_ENTITLED' from _i where label = 'e-revoked-replay')
  and (select err = 'EV003: NOT_ENTITLED' from _v where label = 'e-revoked-mint')
  and (select err = 'EV001: INVITE_UNUSABLE' from _rd where label = 'd-ag-after')
  and (select status = 'revoked' and revoked_at is not null and revoked_at <= now() from public.evaluation where evaluation_id = pg_temp._ev('delta'))
  and (select count(*) = 1 from public.evaluation_event where evaluation_id = pg_temp._ev('delta') and kind = 'revoked')
  and (select count(*) = 1 from public.evaluation_credit where evaluation_id = pg_temp._ev('delta'))
  and (select status = 'revoked' and credits_used = 1 and credits_remaining = 9 from public.evaluation_usage(pg_temp._u(11)))
  and (select result like '55000:%' from _w where label = 'delta to active') and (select result like '55000:%' from _w where label = 'delta to complete')
  and (select result = 'EV003: NOT_ENTITLED' from _w where label = 'delta revoke unknown'),
  (select string_agg(label || '=' || val, '; ') from _b where label like 'delta%'));
select pg_temp._do('echo mint', format($$select * from public.evaluation_invite_mint((select evaluation_id from public.evaluation where expires_at < now()), 'agent')$$));
select pg_temp._ck('L08e an evaluation past its own expiry date is refused (NOT_ENTITLED), cannot mint, and is reported expired by the reader (status still active: the date, not a stored flag, decides)',
  (select err = 'EV003: NOT_ENTITLED' from _i where label = 'e-expired')
  and (select result = 'EV003: NOT_ENTITLED' from _w where label = 'echo mint')
  and (select expired and status = 'active' and credits_used = 0 from public.evaluation_usage(pg_temp._u(12)))
  and (select count(*) = 1 from public.evaluation where expires_at is not null and expires_at < now()),
  (select err from _i where label = 'e-expired'));
-- Foxtrot: a suspended or closed BROKERAGE ends what its evaluation allows, and active again restores it (so the refusal is the status, not the data)
select pg_temp._run('foxtrot control', $$select pg_temp._iss('f1', 13, 401)$$);
select pg_temp._run('foxtrot invite', $$select pg_temp._mintv('f-ag', 'foxtrot', 'agent')$$);
select pg_temp._run('foxtrot suspended', $$update public.brokerage_account set status = 'suspended' where id = pg_temp._bk('foxtrot')$$);
select pg_temp._run('foxtrot suspended calls', $x$do $d$ begin
  perform pg_temp._iss('e-suspended', 13, 402);
  perform pg_temp._rdm('f-ag-susp', (select token from _v where label = 'f-ag'), 17);
  perform pg_temp._mintv('f-mint-susp', 'foxtrot', 'agent');
end $d$$x$);
select pg_temp._run('foxtrot closed', $$update public.brokerage_account set status = 'closed' where id = pg_temp._bk('foxtrot')$$);
select pg_temp._run('foxtrot closed call', $$select pg_temp._iss('e-closed', 13, 403)$$);
select pg_temp._run('foxtrot active again', $$update public.brokerage_account set status = 'active' where id = pg_temp._bk('foxtrot')$$);
select pg_temp._run('foxtrot after', $$select pg_temp._iss('f2', 13, 402)$$);
select pg_temp._ck('L08f a SUSPENDED or CLOSED brokerage is refused (issue, mint) and its open invite cannot be redeemed; made active again the same person is served, and the key the refused call used is not burned (it now succeeds as ordinal 2)',
  (select err is null and ord = 1 from _i where label = 'f1')
  and (select err = 'EV003: NOT_ENTITLED' from _i where label = 'e-suspended') and (select err = 'EV003: NOT_ENTITLED' from _i where label = 'e-closed')
  and (select err = 'EV003: NOT_ENTITLED' from _v where label = 'f-mint-susp')
  and (select err = 'EV001: INVITE_UNUSABLE' from _rd where label = 'f-ag-susp')
  and (select err is null and not replayed and ord = 2 and used = 2 from _i where label = 'f2'),
  (select string_agg(label || '=' || coalesce(err, 'ok'), '; ') from _i where label in ('f1', 'e-suspended', 'e-closed', 'f2')));
select pg_temp._ck('L08g every entitlement refusal is IDENTICAL: an outsider, a member of a brokerage with no evaluation, a NULL user, a removed member (new key and replay), an expired, a revoked (new key and replay), a suspended and a closed brokerage all get one SQLSTATE and one message, so a refusal says nothing about WHY',
  (select count(*) = 10 and count(distinct r) = 1 and min(r) = 'EV003: NOT_ENTITLED' from
     (select err as r from _i where label in ('e-outsider', 'e-k0only', 'e-removed', 'e-removed-replay', 'e-expired', 'e-revoked', 'e-revoked-replay', 'e-suspended', 'e-closed')
      union all select result from _w where label = 'e-nulluser') x),
  (select string_agg(distinct r, ' | ') from (select err as r from _i where label like 'e-%' union all select result from _w where label = 'e-nulluser') x));
-- who may mint and revoke an invite
select pg_temp._run('mint auth', $x$do $d$ begin
  perform pg_temp._mintv('x-agent', 'alpha', 'agent', 2);            -- an AGENT may not mint
  perform pg_temp._mintv('x-foreign', 'alpha', 'agent', 4);          -- Beta's owner may not mint for Alpha
  perform pg_temp._mintv('x-owner-owner', 'alpha', 'owner', 1);      -- an owner may invite AGENTS only (D-L8)
  perform pg_temp._mintv('x-owner-agent', 'alpha', 'agent', 1);      -- control: this is allowed
  perform pg_temp._mintv('x-removed', 'alpha', 'agent', 3);          -- a removed member
  perform pg_temp._mintv('x-outsider', 'alpha', 'agent', 10);
  perform pg_temp._mintv('x-admin-owner', 'alpha', 'owner');         -- control: the admin/system path (no actor) may mint any role
end $d$$x$);
select pg_temp._ck('L08h minting is authorised in the database: an agent, another brokerage''s owner, a removed member and an outsider are refused (NOT_ENTITLED), an owner may invite AGENTS only (an owner invite on an actor''s behalf is refused), and the controls work: an owner''s agent invite and the admin''s owner invite',
  (select count(*) = 5 and pg_temp.all_t(err = 'EV003: NOT_ENTITLED') from _v where label in ('x-agent', 'x-foreign', 'x-owner-owner', 'x-removed', 'x-outsider'))
  and (select err is null and token ~ '^hse1_' from _v where label = 'x-owner-agent')
  and (select err is null and token ~ '^hse1_' from _v where label = 'x-admin-owner'),
  (select string_agg(label || '=' || coalesce(err, 'ok'), '; ') from _v where label like 'x-%'));
select pg_temp._val('rv-agent',   format($$select public.evaluation_invite_revoke(%L, %L)::text$$, (select invite_id from _v where label = 'a-x2'), pg_temp._u(2)));
select pg_temp._val('rv-foreign', format($$select public.evaluation_invite_revoke(%L, %L)::text$$, (select invite_id from _v where label = 'a-x2'), pg_temp._u(4)));
select pg_temp._val('rv-unknown', format($$select public.evaluation_invite_revoke(%L, null)$$, pg_temp._k(1)));
select pg_temp._ck('L08i revoking an invite is authorised too: an agent, another brokerage''s owner and an unknown invite are refused, and the invite is still open',
  (select val = 'ERR EV003: NOT_ENTITLED' from _b where label = 'rv-agent') and (select val = 'ERR EV003: NOT_ENTITLED' from _b where label = 'rv-foreign')
  and (select val = 'ERR EV003: NOT_ENTITLED' from _b where label = 'rv-unknown')
  and (select status = 'open' from public.evaluation_invite where invite_id = (select invite_id from _v where label = 'a-x2')),
  (select string_agg(label || '=' || val, '; ') from _b where label like 'rv-%'));
select pg_temp._val('rv-owner', format($$select public.evaluation_invite_revoke(%L, %L)::text$$, (select invite_id from _v where label = 'a-x2'), pg_temp._u(1)));
select pg_temp._ck('L08j the owner of the brokerage can revoke its open invite (true), and it is revoked',
  (select val = 'true' from _b where label = 'rv-owner')
  and (select status = 'revoked' from public.evaluation_invite where invite_id = (select invite_id from _v where label = 'a-x2')),
  (select val from _b where label = 'rv-owner'));
-- isolation levels: the two lock-based functions refuse any transaction that is not READ COMMITTED, and work at READ COMMITTED
begin isolation level repeatable read;
select pg_temp._iss('rr-issue', 4, 60);
select pg_temp._rdm('rr-redeem', (select token from _v where label = 'a-x3'), 24);
commit;
begin isolation level serializable;
select pg_temp._iss('ser-issue', 4, 60);
select pg_temp._rdm('ser-redeem', (select token from _v where label = 'a-x3'), 24);
commit;
select pg_temp._run('rc control', $x$do $d$ begin perform pg_temp._iss('rc-issue', 4, 60); perform pg_temp._rdm('rc-redeem', (select token from _v where label = 'a-x3'), 24); end $d$$x$);
select pg_temp._ck('L08k at REPEATABLE READ and at SERIALIZABLE both evaluation_report_issue and evaluation_invite_redeem are REFUSED (55000, "needs READ COMMITTED") before anything is written; at READ COMMITTED the same calls go through (so the refusal is not blanket)',
  (select count(*) = 4 and pg_temp.all_t(err like '55000:%needs READ COMMITTED%') from (
     select err from _i where label in ('rr-issue', 'ser-issue') union all select err from _rd where label in ('rr-redeem', 'ser-redeem')) x)
  and (select err is null and ord = 4 and not replayed from _i where label = 'rc-issue')
  and (select err is null and role = 'owner' from _rd where label = 'rc-redeem')
  and (select count(*) = 4 from public.evaluation_credit where evaluation_id = pg_temp._ev('beta')),
  (select string_agg(label || '=' || coalesce(err, 'ok'), '; ') from _i where label like 'rr-%' or label like 'ser-%' or label = 'rc-issue'));

-- the two ACTOR-authorised functions refuse it as well (review finding: at REPEATABLE READ an owner removed after the snapshot could still mint or revoke)
select pg_temp._run('iso targets', $x$do $d$ begin perform pg_temp._mintv('iso-t1', 'alpha', 'agent', 1); perform pg_temp._mintv('iso-t2', 'alpha', 'agent', 1); perform pg_temp._mintv('iso-t3', 'alpha', 'agent', 1); end $d$$x$);
begin isolation level repeatable read;
select pg_temp._mintv('rr-mint', 'alpha', 'agent', 1);
select pg_temp._val('rr-revoke', format($$select public.evaluation_invite_revoke(%L, %L)::text$$, (select invite_id from _v where label = 'iso-t1'), pg_temp._u(1)));
select pg_temp._mintv('rr-mint-admin', 'alpha', 'agent');
select pg_temp._val('rr-revoke-admin', format($$select public.evaluation_invite_revoke(%L)::text$$, (select invite_id from _v where label = 'iso-t1')));
commit;
begin isolation level serializable;
select pg_temp._mintv('ser-mint', 'alpha', 'agent', 1);
select pg_temp._val('ser-revoke', format($$select public.evaluation_invite_revoke(%L, %L)::text$$, (select invite_id from _v where label = 'iso-t1'), pg_temp._u(1)));
commit;
select pg_temp._mintv('rc-mint', 'alpha', 'agent', 1);
select pg_temp._val('rc-revoke', format($$select public.evaluation_invite_revoke(%L, %L)::text$$, (select invite_id from _v where label = 'iso-t1'), pg_temp._u(1)));
select pg_temp._ck('L08k2 at REPEATABLE READ and at SERIALIZABLE evaluation_invite_mint and evaluation_invite_revoke are REFUSED (55000, "needs READ COMMITTED") for a VALID owner and for the admin path, before anything is written; at READ COMMITTED the same calls go through (so the refusal is not blanket)',
  (select count(*) = 6 and pg_temp.all_t(err like '55000:%needs READ COMMITTED%') from (
     select err from _v where label in ('rr-mint', 'rr-mint-admin', 'ser-mint') union all select substr(val, 5) from _b where label in ('rr-revoke', 'rr-revoke-admin', 'ser-revoke')) x)
  and (select err is null and token ~ '^hse1_[0-9a-f]{64}$' from _v where label = 'rc-mint')
  and (select val = 'true' from _b where label = 'rc-revoke')
  and (select status = 'revoked' from public.evaluation_invite where invite_id = (select invite_id from _v where label = 'iso-t1'))
  and (select count(*) = 0 from _v where label in ('rr-mint', 'rr-mint-admin', 'ser-mint') and invite_id is not null),
  (select string_agg(label || '=' || coalesce(err, 'ok'), '; ') from _v where label like 'rr-%' or label like 'ser-%' or label = 'rc-mint')
  || ' | ' || (select string_agg(label || '=' || val, '; ') from _b where label in ('rr-revoke', 'rr-revoke-admin', 'ser-revoke', 'rc-revoke')));

-- redeem against an ended membership, an expired evaluation, and a freed seat
select pg_temp._run('redeem replays', $x$do $d$ begin
  perform pg_temp._rdm('a-j3-replay', (select token from _v where label = 'a-ag2'), 3);    -- agent 3 was removed above: their token is no longer theirs to use
  perform pg_temp._rdm('a-j2-replay', (select token from _v where label = 'a-ag1'), 2);    -- control: agent 2 is current and replays their own
end $d$$x$);
select pg_temp._ck('L08l a REMOVED member replaying the invite they once redeemed is refused with the generic refusal (the replay is answered from a current membership, never from the invite alone), while a current member replaying theirs is idempotent (control)',
  (select err = 'EV001: INVITE_UNUSABLE' from _rd where label = 'a-j3-replay')
  and (select err is null and replayed and role = 'agent' and brokerage_id = pg_temp._bk('alpha') from _rd where label = 'a-j2-replay')
  and (select count(*) = 0 from public.brokerage_member where user_id = pg_temp._u(3) and status = 'active'),
  (select string_agg(label || '=' || coalesce(err, 'ok'), '; ') from _rd where label like 'a-j%-replay'));
select pg_temp._run('echo invite', $$insert into public.evaluation_invite (evaluation_id, role, token_hash, expires_at)
  values ((select evaluation_id from public.evaluation where expires_at < now()), 'agent', pg_temp._h('hse1_' || repeat('2', 64)), now() + interval '5 days')$$);
select pg_temp._run('echo redeem', $$select pg_temp._rdm('echo-redeem', 'hse1_' || repeat('2', 64), 25)$$);
select pg_temp._ck('L08m an open, unexpired invite for an evaluation that has passed its own expiry date cannot be redeemed (the generic refusal): nobody joins an ended evaluation, and the invite stays open',
  (select err = 'EV001: INVITE_UNUSABLE' from _rd where label = 'echo-redeem')
  and (select count(*) = 0 from public.brokerage_member where user_id = pg_temp._u(25))
  and (select status = 'open' from public.evaluation_invite where token_hash = pg_temp._h('hse1_' || repeat('2', 64))),
  (select coalesce(err, 'ok') from _rd where label = 'echo-redeem'));
select pg_temp._run('gamma agent leaves', $$update public.brokerage_member set status = 'deactivated' where user_id = pg_temp._u(7)$$);
select pg_temp._run('gamma seat reused', $x$do $d$ begin
  perform pg_temp._rdm('g-a3', (select token from _v where label = 'g-ag2'), 27);          -- the seat the first agent held is free again
  perform pg_temp._mintv('g-ag3', 'gamma', 'agent', 6);
  perform pg_temp._rdm('g-a4', (select token from _v where label = 'g-ag3'), 28);          -- ... and now taken again
end $d$$x$);
select pg_temp._ck('L08n a seat is held by an ACTIVE agent only: when Gamma''s one agent is removed the next agent joins (the removed one does not count), and a further agent is then refused again (EV005); the removed agent keeps no membership',
  (select err is null and role = 'agent' from _rd where label = 'g-a3')
  and (select err = 'EV005: SEAT_LIMIT_REACHED' from _rd where label = 'g-a4')
  and (select count(*) = 1 from public.brokerage_member where brokerage_id = pg_temp._bk('gamma') and role = 'agent' and status = 'active' and user_id = pg_temp._u(27))
  and (select count(*) = 0 from public.brokerage_member where user_id = pg_temp._u(7) and status = 'active')
  and (select status = 'open' from public.evaluation_invite where invite_id = (select invite_id from _v where label = 'g-ag3')),
  (select string_agg(label || '=' || coalesce(err, role), '; ') from _rd where label in ('g-a3', 'g-a4')));

-- ---- L04f..g  the evaluation and its guards ----------------------------------------------------------------------------------------------------------
select pg_temp._do('g-reactivate', format($$update public.evaluation set status = 'active' where evaluation_id = %L$$, pg_temp._ev('quota')));
select pg_temp._do('g-early-complete', format($$update public.evaluation set status = 'complete' where evaluation_id = %L$$, pg_temp._ev('alpha')));
select pg_temp._do('g-rekey', format($$update public.evaluation set brokerage_id = %L where evaluation_id = %L$$, pg_temp._bk('beta'), pg_temp._ev('alpha')));
select pg_temp._do('g-redate', format($$update public.evaluation set created_at = now() - interval '1 year' where evaluation_id = %L$$, pg_temp._ev('alpha')));
select pg_temp._do('g-delete', format($$delete from public.evaluation where evaluation_id = %L$$, pg_temp._ev('alpha')));
select pg_temp._do('g-stamp', format($$update public.evaluation set status = 'revoked', revoked_at = now() - interval '3 years' where evaluation_id = %L$$, pg_temp._ev('scratch4')));
select pg_temp._ck('L04f the evaluation is a state machine the table enforces: a complete one cannot become active, an active one with fewer than 10 credits cannot be marked complete (complete means every credit is used), its identity cannot change, it is never deleted (all 55000); and a revoked_at a caller supplies is overwritten by the database clock',
  (select count(*) = 5 and pg_temp.all_t(result like '55000:%') from _w where label in ('g-reactivate', 'g-early-complete', 'g-rekey', 'g-redate', 'g-delete'))
  and (select result = 'ok' from _w where label = 'g-stamp')
  and (select status = 'revoked' and revoked_at > now() - interval '1 minute' from public.evaluation where evaluation_id = pg_temp._ev('scratch4'))
  and (select status = 'complete' from public.evaluation where evaluation_id = pg_temp._ev('quota')),
  (select string_agg(label || '=' || result, '; ') from _w where label like 'g-%'));
select pg_temp._ck('L04g the evaluation table refuses, each by its own rule: an unknown status, a negative seat limit, a second evaluation for one brokerage, an expiry before the creation, and a revoked_at without a revoked status',
  pg_temp._why(format($$insert into public.evaluation (brokerage_id, status) values ((select id from public.brokerage_account order by id limit 1), 'paused')$$)) like '23514:%evaluation_status%'
  and pg_temp._why(format($$insert into public.evaluation (brokerage_id, seat_limit) values (gen_random_uuid(), -1)$$)) like '23514:%evaluation_seat_limit%'
  and pg_temp._why(format($$insert into public.evaluation (brokerage_id) values (%L)$$, pg_temp._bk('beta'))) like '23505:%evaluation_one_per_brokerage%'
  and pg_temp._why(format($$insert into public.evaluation (brokerage_id, created_at, expires_at) values (gen_random_uuid(), now(), now() - interval '1 day')$$)) like '23514:%evaluation_expiry%'
  and pg_temp._why(format($$insert into public.evaluation (brokerage_id, revoked_at) values (gen_random_uuid(), now())$$)) like '23514:%evaluation_revoked%'
  and pg_temp._why(format($$insert into public.evaluation (brokerage_id) values (%L)$$, pg_temp._k(1))) like '23503:%',
  null);

-- ---- L12  deleting an account is never blocked, and the credit history survives it ------------------------------------------------------
select pg_temp._run('hotel agent invite', $$select pg_temp._mintv('h-ag', 'hotel', 'agent', 16)$$);
select pg_temp._run('hotel agent joins', $$select pg_temp._rdm('h-j17', (select token from _v where label = 'h-ag'), 17)$$);
select pg_temp._run('hotel issues', $x$do $d$ begin perform pg_temp._iss('h1', 16, 501); perform pg_temp._iss('h2', 17, 502); end $d$$x$);
select pg_temp._run('hotel counts', $$create temp table _h0 as select (select count(*) from public.evaluation_credit where evaluation_id = pg_temp._ev('hotel')) as credits,
  (select count(*) from public.evaluation_event where evaluation_id = pg_temp._ev('hotel')) as evs$$);
select pg_temp._do('delete agent account', format($$delete from auth.users where id = %L$$, pg_temp._u(17)));
select pg_temp._run('redeem after delete', $$select pg_temp._rdm('h-after', (select token from _v where label = 'h-ag'), 18)$$);
select pg_temp._ck('L12a deleting the account of an AGENT is not blocked: their membership goes with them, the invite they redeemed keeps its redeemed status and time but no longer names them (redeemed_by cleared), nobody else can redeem it, and the credits they used stay in the ledger (2 rows, no user id in it)',
  (select result = 'ok' from _w where label = 'delete agent account')
  and (select count(*) = 0 from public.brokerage_member where user_id = pg_temp._u(17))
  and (select status = 'redeemed' and redeemed_by is null and redeemed_at is not null from public.evaluation_invite where invite_id = (select invite_id from _v where label = 'h-ag'))
  and (select err = 'EV001: INVITE_UNUSABLE' from _rd where label = 'h-after')
  and (select count(*) = 0 from public.brokerage_member where user_id = pg_temp._u(18))
  and (select credits = 2 and credits = (select count(*) from public.evaluation_credit where evaluation_id = pg_temp._ev('hotel')) from _h0)
  and (select evs = (select count(*) from public.evaluation_event where evaluation_id = pg_temp._ev('hotel')) from _h0),
  (select result from _w where label = 'delete agent account'));
select pg_temp._do('delete owner account', format($$delete from auth.users where id = %L$$, pg_temp._u(16)));
select pg_temp._ck('L12b deleting the account of the LAST owner of an active brokerage is not blocked either (K0, default D-K4): the evaluation, its ledger and its status are untouched, the reader answers nothing for the deleted person, and the brokerage is left active with no active owner, which one query finds (Hotel) beside a control that finds the brokerages that do have one',
  (select result = 'ok' from _w where label = 'delete owner account')
  and (select status = 'active' from public.evaluation where evaluation_id = pg_temp._ev('hotel'))
  and (select count(*) = 2 from public.evaluation_credit where evaluation_id = pg_temp._ev('hotel'))
  and (select count(*) = 0 from public.evaluation_usage(pg_temp._u(16)))
  and exists (select 1 from public.brokerage_account a where a.id = pg_temp._bk('hotel') and a.status = 'active'
                and not exists (select 1 from public.brokerage_member m where m.brokerage_id = a.id and m.role = 'owner' and m.status = 'active'))
  and exists (select 1 from public.brokerage_account a where a.id = pg_temp._bk('alpha') and a.status = 'active'
                and exists (select 1 from public.brokerage_member m where m.brokerage_id = a.id and m.role = 'owner' and m.status = 'active')),
  (select result from _w where label = 'delete owner account'));

-- ---- L09  privacy: nothing an agent typed reaches any new table --------------------------------------------------------------------------------------
select pg_temp._run('private issue', $$select pg_temp._iss('priv', 6, 95, '{"address":"1 Centre Street, New York, NY 10007","normalized_address":"1 CENTRE ST NEW YORK NY 10007","latitude":40.71234,"longitude":-74.00589,"label":"Client Smith condo","property_keys":["PK-998877"]}'::jsonb)$$);
select pg_temp._ck('L09a after issuing with a known address, normalized address, coordinates, label and property key, NONE of them and NO fragment (the street line, the house number with its street, the ZIP, either coordinate, a word of the label, the property key, the town, the street of a refused attempt) appears in any row of the four new tables or the two account tables; control: the private layer DOES hold the address and label, and the same scan finds a brokerage name',
  (select err is null and ord = 2 from _i where label = 'priv')
  and (select sum(pg_temp._leaks(n)) = 0 from unnest(array['1 Centre', 'Centre Street', 'centre st', '10007', '40.71234', '74.00589', 'Smith', 'Client', 'condo', 'PK-998877', 'New York', 'Leak Lane', 'Springfield']) n)
  and (select count(*) = 1 from public.report_private_context where address like '%Centre Street%' and label = 'Client Smith condo' and property_keys @> array['PK-998877'])
  and pg_temp._leaks('Gamma Group') = 1,
  (select sum(pg_temp._leaks(n))::text from unnest(array['1 Centre', 'Centre Street', 'centre st', '10007', '40.71234', '74.00589', 'Smith', 'Client', 'condo', 'PK-998877', 'New York', 'Leak Lane', 'Springfield']) n));
create function pg_temp._forbidden(c text) returns boolean language sql immutable as
$$ select c ~* '(addr|propert|latitude|longitude|\mlat\M|\mlng\M|coord|geo|label|email|domain|phone|client|street|city|zip|\mip\M|note|comment|descr|payload|content|free|name|user|member|actor|_by$|hash|fingerprint|key)' $$;
select pg_temp._ck('L09b no column of the four tables is named for an address, property, coordinate, label, email, client, ip, note, name, user, hash or key, except the three that are on purpose: token_hash (the invite), redeemed_by (the one person it was redeemed by, cleared when their account is deleted) and idempotency_key (a random uuid); control: the same pattern flags fourteen planted names',
  (select count(*) = 0 from information_schema.columns where table_schema = 'public' and table_name like 'evaluation%' and pg_temp._forbidden(column_name)
     and column_name not in ('token_hash', 'redeemed_by', 'idempotency_key'))
  and (select count(*) = 3 from information_schema.columns where table_schema = 'public' and table_name like 'evaluation%' and pg_temp._forbidden(column_name))
  and (select count(*) = 14 from unnest(array['address_hash', 'property_key', 'latitude', 'lng', 'client_name', 'label', 'email', 'ip_address', 'note', 'created_by', 'user_id', 'body_hash', 'zip', 'coordinates']) c where pg_temp._forbidden(c)),
  (select string_agg(table_name || '.' || column_name, ',') from information_schema.columns where table_schema = 'public' and table_name like 'evaluation%' and pg_temp._forbidden(column_name)));
select pg_temp._ck('L09c nothing semi-structured or free-form can be stored: every column is a uuid, an integer, a bigint, a timestamp or text; and every one of the six text columns is closed by a CHECK (a vocabulary, or the 64-hex shape of a hash), so no sentence, token or address can be written to it',
  (select string_agg(dt, ',' order by dt collate "C") from (select distinct data_type as dt from information_schema.columns where table_schema = 'public' and table_name like 'evaluation%') x)
    = 'bigint,integer,text,timestamp with time zone,uuid'
  and (select count(*) = 6 and pg_temp.all_t(exists (select 1 from pg_constraint k where k.conrelid = format('public.%I', c.table_name)::regclass and k.contype = 'c'
                                                  and pg_get_constraintdef(k.oid) ~ ('\m' || c.column_name || '\M')))
         from information_schema.columns c where c.table_schema = 'public' and c.table_name like 'evaluation%' and c.data_type = 'text'),
  (select string_agg(table_name || '.' || column_name, ',' order by table_name collate "C", column_name collate "C") from information_schema.columns where table_schema = 'public' and table_name like 'evaluation%' and data_type = 'text'));
select pg_temp._ck('L09d the ledger links a report by its report_id ONLY: there is no column that points at a private context, and the log carries kinds, roles and ids, never a person or a place (its only text columns are kind and role)',
  (select count(*) = 0 from information_schema.columns where table_schema = 'public' and table_name like 'evaluation%' and column_name like '%context%')
  and (select string_agg(column_name, ',' order by column_name collate "C") from information_schema.columns where table_schema = 'public' and table_name = 'evaluation_event' and data_type = 'text') = 'kind,role',
  null);

-- ---- L11  remaining is DERIVED: there is no counter to drift --------------------------------------------------------------------------------------------
select pg_temp._ck('L11a no column is a counter: the only integer columns are the seat limit, the ordinal and the event identity, and no column is named for used, remaining, balance, count, total, quota, credits or spent',
  (select string_agg(table_name || '.' || column_name, ',' order by table_name collate "C", column_name collate "C") from information_schema.columns
    where table_schema = 'public' and table_name like 'evaluation%' and data_type in ('integer', 'bigint', 'smallint', 'numeric'))
    = 'evaluation.seat_limit,evaluation_credit.ordinal,evaluation_event.event_id'
  and (select count(*) = 0 from information_schema.columns where table_schema = 'public' and table_name like 'evaluation%'
         and column_name ~* '(used|remain|balance|counter|count|total|quota|credits|spent|left)'),
  null);
select pg_temp._ck('L11b the reader answers from the ledger, after replays and refusals: for EVERY active member, credits used = the ledger rows of their evaluation and remaining = 10 minus that; and the hard-coded figures hold: Alpha 7, Beta 4, Gamma 2, Quota 10, Delta 1 (revoked), Foxtrot 2, Hotel 2',
  (select count(*) > 8 and pg_temp.all_t(u.credits_used = (select count(*) from public.evaluation_credit c where c.evaluation_id = u.evaluation_id) and u.credits_remaining = 10 - u.credits_used)
     from public.brokerage_member m cross join lateral public.evaluation_usage(m.user_id) u where m.status = 'active')
  and (select credits_used = 7 and credits_remaining = 3 from public.evaluation_usage(pg_temp._u(1)))
  and (select credits_used = 4 from public.evaluation_usage(pg_temp._u(4)))
  and (select credits_used = 2 from public.evaluation_usage(pg_temp._u(6)))
  and (select credits_used = 10 and credits_remaining = 0 from public.evaluation_usage(pg_temp._u(9)))
  and (select credits_used = 1 and status = 'revoked' from public.evaluation_usage(pg_temp._u(11)))
  and (select credits_used = 2 from public.evaluation_usage(pg_temp._u(13)))
  and (select count(*) = 2 from public.evaluation_credit where evaluation_id = pg_temp._ev('hotel')),
  (select string_agg(u.credits_used::text, ',') from public.brokerage_member m cross join lateral public.evaluation_usage(m.user_id) u where m.status = 'active'));
select pg_temp._ck('L11c the audit finds nothing wrong in a consistent database, beside non-zero controls: four invariants at zero (a complete evaluation has a full ledger, an active one has not, the ordinals have no gaps, none exceeds the limit) and two controls above zero',
  (select count(*) = 4 and pg_temp.all_t(violations = 0) from public.evaluation_check() where kind = 'invariant')
  and (select count(*) = 2 and pg_temp.all_t(violations > 0) from public.evaluation_check() where kind = 'control')
  and (select violations = (select count(*) from public.evaluation_credit) from public.evaluation_check() where check_name = 'credits_total')
  and (select violations = (select count(*) from public.evaluation) from public.evaluation_check() where check_name = 'evaluations_total'),
  (select string_agg(check_name || '=' || violations, ', ') from public.evaluation_check()));

-- ---- L10  lock-down: system-only -------------------------------------------------------------------------------------------------------------------------------
select pg_temp._ck('L10a row-level security is ON for all four tables, and none carries a policy',
  (select count(*) = 4 and pg_temp.all_t(relrowsecurity) from pg_class where oid in ('public.evaluation'::regclass, 'public.evaluation_invite'::regclass, 'public.evaluation_credit'::regclass, 'public.evaluation_event'::regclass))
  and not exists (select 1 from pg_policy where polrelid in ('public.evaluation'::regclass, 'public.evaluation_invite'::regclass, 'public.evaluation_credit'::regclass, 'public.evaluation_event'::regclass)),
  null);
select pg_temp._ck('L10b anon, authenticated AND service_role hold NO privilege on any of the four tables (select, insert, update, delete, truncate, references, trigger), and no grantee at all but the owner appears in the whole ACL (so PUBLIC, an unnamed role and a privilege a newer PostgreSQL adds are covered)',
  not exists (select 1 from unnest(array['anon', 'authenticated', 'service_role']) r, unnest(array['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger']) p,
                     unnest(array['public.evaluation', 'public.evaluation_invite', 'public.evaluation_credit', 'public.evaluation_event']) t
               where has_table_privilege(r, t, p))
  and not exists (select 1 from pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
                   where c.oid in ('public.evaluation'::regclass, 'public.evaluation_invite'::regclass, 'public.evaluation_credit'::regclass, 'public.evaluation_event'::regclass) and a.grantee <> c.relowner),
  null);
select pg_temp._ck('L10c the SEQUENCE behind the event identity is locked too (Supabase''s default privileges open every sequence in public): no API role holds usage, select or update on it, and no grantee but the owner appears in its ACL; control: the owner can use it, and the apply found it by its dependency on the table',
  not exists (select 1 from unnest(array['anon', 'authenticated', 'service_role']) r, unnest(array['usage', 'select', 'update']) p where has_sequence_privilege(r, 'public.evaluation_event_event_id_seq', p))
  and not exists (select 1 from pg_class c, aclexplode(coalesce(c.relacl, acldefault('s', c.relowner))) a where c.oid = 'public.evaluation_event_event_id_seq'::regclass and a.grantee <> c.relowner)
  and has_sequence_privilege(current_user, 'public.evaluation_event_event_id_seq', 'usage')
  and (select count(*) = 3 and pg_temp.all_t(pg_temp._as(r, $q$select nextval('public.evaluation_event_event_id_seq')$q$) = '42501') from unnest(array['anon', 'authenticated', 'service_role']) r),
  null);
select pg_temp._ck('L10d AS each API role every read and write of every table is refused with 42501 (48 attempts), while the table owner reads them (control)',
  (select count(*) = 48 and pg_temp.all_t(pg_temp._as(r, s) = '42501')
     from unnest(array['anon', 'authenticated', 'service_role']) r,
          unnest(array['select count(*) from public.evaluation', 'insert into public.evaluation default values', 'update public.evaluation set status = status', 'delete from public.evaluation',
                        'select count(*) from public.evaluation_invite', 'insert into public.evaluation_invite default values', 'update public.evaluation_invite set status = status', 'delete from public.evaluation_invite',
                        'select count(*) from public.evaluation_credit', 'insert into public.evaluation_credit default values', 'update public.evaluation_credit set ordinal = ordinal', 'delete from public.evaluation_credit',
                        'select count(*) from public.evaluation_event', 'insert into public.evaluation_event default values', 'update public.evaluation_event set kind = kind', 'delete from public.evaluation_event']) s)
  and pg_temp._as(current_user, 'select count(*) from public.evaluation') = 'ok' and pg_temp._as(current_user, 'select count(*) from public.evaluation_credit') = 'ok',
  null);
select pg_temp._ck('L10e only service_role can execute the nine callable functions (anon, authenticated and PUBLIC cannot), and NOBODY, not even service_role, can execute the four trigger functions (computed over every evaluation_ function)',
  (select count(*) = 13 and pg_temp.all_t(has_function_privilege('service_role', p.oid, 'execute') = (p.prorettype <> 'trigger'::regtype)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'evaluation\_%')
  and (select count(*) = 4 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'evaluation\_%' and p.prorettype = 'trigger'::regtype)
  and not exists (select 1 from pg_proc p, unnest(array['anon', 'authenticated']) r where p.pronamespace = 'public'::regnamespace and p.proname like 'evaluation\_%' and has_function_privilege(r, p.oid, 'execute'))
  and not exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where p.pronamespace = 'public'::regnamespace and p.proname like 'evaluation\_%' and a.grantee = 0)
  and not exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                   where p.pronamespace = 'public'::regnamespace and p.proname like 'evaluation\_%' and a.grantee <> p.proowner
                     and (p.prorettype = 'trigger'::regtype or a.grantee <> (select oid from pg_roles where rolname = 'service_role'))),
  null);
select pg_temp._ck('L10f AS anon and AS authenticated every callable function is refused (42501: 18 attempts); AS service_role the reads work (the usage reader, the audit, the limit) while the tables stay unreadable',
  (select count(*) = 18 and pg_temp.all_t(pg_temp._as(r, s) = '42501')
     from unnest(array['anon', 'authenticated']) r,
          unnest(array['select public.evaluation_report_limit()', 'select * from public.evaluation_check()', 'select * from public.evaluation_usage(null)', $q$select * from public.evaluation_create('x')$q$,
                        $q$select * from public.evaluation_invite_mint(null, 'agent')$q$, 'select * from public.evaluation_invite_redeem(null, null)', 'select public.evaluation_invite_revoke(null)',
                        'select public.evaluation_revoke(null)', 'select * from public.evaluation_report_issue(null, null, null, null, null, null)']) s)
  and pg_temp._as('service_role', 'select public.evaluation_report_limit()') = 'ok'
  and pg_temp._as('service_role', 'select * from public.evaluation_check()') = 'ok'
  and pg_temp._as_val('service_role', format($$select credits_used::text from public.evaluation_usage(%L)$$, pg_temp._u(1))) = '7'
  and pg_temp._as('service_role', 'select count(*) from public.evaluation_credit') = '42501',
  pg_temp._as_val('service_role', format($$select credits_used::text from public.evaluation_usage(%L)$$, pg_temp._u(1))));
select pg_temp._ck('L10g exactly eight functions are SECURITY DEFINER (the callable ones that touch a table), every function that touches a table pins its search_path, and the trigger functions and the limit are not definer',
  (select string_agg(proname, ',' order by proname collate "C") from pg_proc where pronamespace = 'public'::regnamespace and proname like 'evaluation\_%' and prosecdef)
    = 'evaluation_check,evaluation_create,evaluation_invite_mint,evaluation_invite_redeem,evaluation_invite_revoke,evaluation_report_issue,evaluation_revoke,evaluation_usage'
  and (select count(*) = 12 and pg_temp.all_t(coalesce(proconfig, '{}') @> array['search_path=public, pg_temp']) from pg_proc where pronamespace = 'public'::regnamespace and proname like 'evaluation\_%' and proname <> 'evaluation_report_limit')
  and (select not prosecdef and provolatile = 'i' from pg_proc where oid = 'public.evaluation_report_limit()'::regprocedure),
  null);
select pg_temp._ck('L10h the uniqueness rules are exactly these, as constraints: token_hash, (evaluation_id, idempotency_key), report_id, the primary key (evaluation_id, ordinal) and one evaluation per brokerage',
  (select string_agg(conname || ': ' || pg_get_constraintdef(oid), ' | ' order by conname collate "C") from pg_constraint
    where conname in ('evaluation_invite_token_hash_unique', 'evaluation_credit_key_unique', 'evaluation_credit_report_unique', 'evaluation_credit_pkey', 'evaluation_one_per_brokerage'))
    = 'evaluation_credit_key_unique: UNIQUE (evaluation_id, idempotency_key) | evaluation_credit_pkey: PRIMARY KEY (evaluation_id, ordinal) | evaluation_credit_report_unique: UNIQUE (report_id) | evaluation_invite_token_hash_unique: UNIQUE (token_hash) | evaluation_one_per_brokerage: UNIQUE (brokerage_id)',
  null);
create temp table _c0 as select (select count(*) from public.evaluation_credit) as credits, (select count(*) from public.evaluation_event) as evs, (select count(*) from public.evaluation) as evals, (select count(*) from public.evaluation_invite) as invs;
select pg_temp._do('ao-update-credit', 'update public.evaluation_credit set ordinal = ordinal');
select pg_temp._do('ao-delete-credit', 'delete from public.evaluation_credit');
select pg_temp._do('ao-truncate-credit', 'truncate public.evaluation_credit');
select pg_temp._do('ao-update-event', 'update public.evaluation_event set kind = kind');
select pg_temp._do('ao-delete-event', 'delete from public.evaluation_event');
select pg_temp._do('ao-truncate-event', 'truncate public.evaluation_event');
select pg_temp._do('ao-truncate-evaluation', 'truncate public.evaluation');
select pg_temp._do('ao-truncate-evaluation-cascade', 'truncate public.evaluation cascade');
select pg_temp._do('ao-truncate-invite', 'truncate public.evaluation_invite');
select pg_temp._do('ao-truncate-invite-cascade', 'truncate public.evaluation_invite cascade');
select pg_temp._ck('L10i the ledger and the log are APPEND-ONLY for every role including the owner: no update, delete or truncate (55000); the evaluation and the invite tables cannot be truncated either (PostgreSQL refuses a plain truncate of a referenced table, and a cascade reaches the ledger, whose trigger refuses it); and nothing changed',
  (select count(*) = 8 and pg_temp.all_t(result like '55000:%') from _w where label in ('ao-update-credit', 'ao-delete-credit', 'ao-truncate-credit', 'ao-update-event', 'ao-delete-event', 'ao-truncate-event', 'ao-truncate-evaluation-cascade', 'ao-truncate-invite-cascade'))
  and (select count(*) = 2 and pg_temp.all_t(result like '0A000:%') from _w where label in ('ao-truncate-evaluation', 'ao-truncate-invite'))
  and (select credits = (select count(*) from public.evaluation_credit) and evs = (select count(*) from public.evaluation_event)
             and evals = (select count(*) from public.evaluation) and invs = (select count(*) from public.evaluation_invite) from _c0),
  (select string_agg(label || '=' || result, '; ') from _w where label like 'ao-%'));

-- ---- L11d  the audit DETECTS each kind of inconsistency (positive controls: states built by switching a guard off, as only the owner can) --------
select pg_temp._run('dirty gap', format($$insert into public.evaluation_credit (evaluation_id, ordinal, idempotency_key, report_id) values (%L, 3, %L, %L)$$, pg_temp._ev('scratch2'), pg_temp._k(950), pg_temp._snap()));
select pg_temp._run('dirty complete a', $$alter table public.evaluation disable trigger evaluation_guard_trg$$);
select pg_temp._run('dirty complete b', format($$update public.evaluation set status = 'complete' where evaluation_id = %L$$, pg_temp._ev('scratch3')));
select pg_temp._run('dirty complete c', $$alter table public.evaluation enable trigger evaluation_guard_trg$$);
select pg_temp._run('dirty full a', $$alter table public.evaluation_credit disable trigger evaluation_credit_complete_trg$$);
select pg_temp._run('dirty full b', $x$do $d$ begin
  for n in 1..10 loop
    insert into public.evaluation_credit (evaluation_id, ordinal, idempotency_key, report_id) values (pg_temp._ev('scratch1'), n, pg_temp._k(960 + n), pg_temp._snap());
  end loop;
end $d$$x$);
select pg_temp._run('dirty full c', $$alter table public.evaluation_credit enable trigger evaluation_credit_complete_trg$$);
select pg_temp._ck('L11d the audit DETECTS what it is for: an evaluation marked complete with no ledger (1), one still active with a full ledger (1), a ledger whose ordinals skip (1), and still none beyond the limit (0), beside the same non-zero controls',
  (select violations = 1 from public.evaluation_check() where check_name = 'complete_without_a_full_ledger')
  and (select violations = 1 from public.evaluation_check() where check_name = 'active_with_a_full_ledger')
  and (select violations = 1 from public.evaluation_check() where check_name = 'ledger_with_gaps')
  and (select violations = 0 from public.evaluation_check() where check_name = 'ledger_beyond_the_limit')
  and (select count(*) = 2 and pg_temp.all_t(violations > 0) from public.evaluation_check() where kind = 'control'),
  (select string_agg(check_name || '=' || violations, ', ') from public.evaluation_check()));
select pg_temp._run('dirty issues', $x$do $d$ begin perform pg_temp._iss('dirty-full', 20, 990); perform pg_temp._iss('dirty-complete', 22, 991); end $d$$x$);
select pg_temp._ck('L04i the function reads the LEDGER and the STATUS, each on its own: an evaluation whose ledger is full but whose status still says active (scratch1), and one whose status says complete with an empty ledger (scratch3), are BOTH refused EVALUATION_COMPLETE and charge nothing',
  (select err = 'EV002: EVALUATION_COMPLETE' from _i where label = 'dirty-full') and (select err = 'EV002: EVALUATION_COMPLETE' from _i where label = 'dirty-complete')
  and (select count(*) = 10 from public.evaluation_credit where evaluation_id = pg_temp._ev('scratch1'))
  and (select count(*) = 0 from public.evaluation_credit where evaluation_id = pg_temp._ev('scratch3')),
  (select string_agg(label || '=' || coalesce(err, 'ok'), '; ') from _i where label like 'dirty-%'));
select pg_temp._ck('L04h the status flip is a TRIGGER on the 10th ledger row, whoever writes it: with the trigger switched off the 10th row left the evaluation active (the audit sees it, L11d), and with it on (everywhere else in this suite) the same row completed it',
  (select status = 'active' and (select count(*) = 10 from public.evaluation_credit c where c.evaluation_id = e.evaluation_id) from public.evaluation e where e.evaluation_id = pg_temp._ev('scratch1'))
  and (select count(*) = 1 from pg_trigger where tgname = 'evaluation_credit_complete_trg' and tgenabled = 'O'),
  null);

-- ---- L13  USAGE ALREADY MADE UNDER THE OLD LIMIT IS PRESERVED, AND REMAINING NEVER GOES BELOW ZERO (founder, 2026-10-05: 20 -> 10) --------------------
-- The only way to hold more than ten ledger rows is to have made them while the limit was higher, so that is exactly what this builds: the limit is
-- put back to 20 for twelve reports and then set to 10 again. No row is edited; the ledger is only ever appended to.
select pg_temp._run('mk legacy', $$select pg_temp._mk('legacy', 'Legacy Brokerage')$$);
select pg_temp._run('legacy owner', $$select pg_temp._rdm('lg-own', (select token from _t where label = 'legacy'), 25)$$);
select pg_temp._run('legacy limit 20', $q$create or replace function public.evaluation_report_limit() returns integer language sql immutable as $f$ select 20 $f$$q$);
select pg_temp._run('legacy issues', $x$do $d$ begin for n in 1..12 loop perform pg_temp._iss('lg' || n, 25, 1000 + n); end loop; end $d$$x$);
select pg_temp._run('legacy limit 10', $q$create or replace function public.evaluation_report_limit() returns integer language sql immutable as $f$ select 10 $f$$q$);
select pg_temp._run('legacy after', $x$do $d$ begin
  perform pg_temp._iss('lg13', 25, 1013);                 -- a NEW key: no free report is granted past the limit
  perform pg_temp._iss('lg5-again', 25, 1005);            -- a retried key still returns its stored report
end $d$$x$);
select pg_temp._ck('L13a a brokerage that had already used 12 under the old limit keeps all 12 (nothing edited or deleted) and reads 0 remaining, never -2; a NEW report is refused EVALUATION_COMPLETE and no free report is granted; a retried key still returns its stored report, also with 0 remaining',
  (select count(*) = 12 from public.evaluation_credit where evaluation_id = pg_temp._ev('legacy'))
  and (select credits_used = 12 and credits_remaining = 0 and credit_limit = 10 from public.evaluation_usage(pg_temp._u(25)))
  and (select err = 'EV002: EVALUATION_COMPLETE' from _i where label = 'lg13')
  and (select err is null and replayed and used = 12 and remaining = 0 from _i where label = 'lg5-again')
  and (select count(*) = 12 from public.evaluation_credit where evaluation_id = pg_temp._ev('legacy')),
  (select string_agg(label || '=' || coalesce(err, 'used ' || used || ' remaining ' || remaining), '; ') from _i where label in ('lg13', 'lg5-again')));

select pg_temp._ck('S01 every setup step in this suite ran without raising (a step that raises is a regression in the code under test, reported here instead of ending the run)',
  not exists (select 1 from _setup where result <> 'ok') and (select count(*) >= 60 from _setup),
  (select string_agg(step || '=' || result, '; ') from _setup where result <> 'ok'));

alter role service_role nobypassrls;
revoke usage on schema public from anon, authenticated, service_role;

\o
select check_name, pass, detail from _r order by n;
