-- ============================================================================
-- PRESERVATION BASELINE PROTECTION — SQL OF RECORD
--
-- APPLIED 2026-09-01 as migration `preservation_baseline_protection`
-- (ledger version 20260901144754). Founder-approved the same day.
--
-- ADDITIVE. Confined to schema `preservation`. No production table, function,
-- cron job, policy, grant or read path is touched.
--
-- ⛔ RESIDUAL RISK, STATED NOT IMPLIED — the baseline is NOT technically
--    undeletable, and must never be described as such.
--    `postgres` is not a superuser in this project (rolsuper = false), and
--    PostgreSQL requires superuser for CREATE EVENT TRIGGER. There is
--    therefore NO in-database interception point for DROP or destructive DDL,
--    from any console available to us (the Supabase dashboard SQL editor also
--    connects as `postgres`). `DROP TABLE ... CASCADE` and
--    `DROP SCHEMA preservation CASCADE` both succeed.
--    The primary protection against a catastrophic DROP remains, in order:
--      1. verified platform backup / recovery   (K12 — CLEARED 2026-09-01 with a
--         documented limitation: Pro plan, scheduled DAILY physical backups active,
--         PITR NOT enabled. Recovery granularity is the available scheduled backups,
--         not arbitrary point-in-time. See docs/preservation-recovery-posture.md.)
--      2. the preservation baseline itself
--      3. repository / audit evidence
--      4. deliberate administrative controls (this file)
--
-- WHAT THIS DOES PREVENT, for any role including the table owner:
--    DELETE / UPDATE / TRUNCATE of rows in a protected snapshot,
--    INSERT of new rows claiming a protected snapshot_id,
--    UPDATE that relabels an ordinary row INTO a protected snapshot,
--    and silent removal of the protection register itself.
--
-- WHY TRIGGERS RATHER THAN GRANTS: the only role holding any privilege on
--    this schema is `postgres` — the role EVERY session connects as. Measured
--    2026-09-01: schema acl {postgres=UC/postgres}; every table acl
--    {postgres=arwdDxtm/postgres}; anon/authenticated/service_role/
--    authenticator hold nothing and pg_default_acl is empty. A REVOKE would
--    constrain nobody. Triggers are the one mechanism that binds the owner.
--
-- WHY THE GUARD CANNOT BE SIDESTEPPED BY A SESSION SETTING: the usual bypass,
--    SET session_replication_role = 'replica', has context = superuser and
--    pg_parameter_acl is empty (no role has been granted SET on it).
-- ============================================================================


-- ============================================================================
-- PART 1 — the register: which snapshots are protected data
-- ============================================================================

create table if not exists preservation.protected_snapshot (
  snapshot_id   text primary key,
  protected_at  timestamptz not null default now(),
  reason        text not null,
  authorized_by text not null
);

alter table preservation.protected_snapshot enable row level security;
revoke all on preservation.protected_snapshot from anon, authenticated, service_role;

insert into preservation.protected_snapshot (snapshot_id, reason, authorized_by)
values (
  'phase1-2026-09-01',
  'Phase 1 pre-migration preservation baseline. Founder ruling 2026-09-01: must not be '
  'dropped, truncated, rewritten, refreshed or repurposed during the geographic migration.',
  'founder'
)
on conflict (snapshot_id) do nothing;


-- ============================================================================
-- PART 2 — the guard. `security invoker`: it can do nothing the caller cannot,
--          and it has no write path — every branch raises or returns the row.
-- ============================================================================

create or replace function preservation.guard_frozen()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, preservation
as $fn$
declare
  v_snaps text[];
  v_hit   text;
  v_hint  text;
begin
  v_hint := format('Intentional override: ALTER TABLE %I.%I DISABLE TRIGGER %I;',
                   tg_table_schema, tg_table_name, tg_name);

  if tg_op = 'TRUNCATE' then
    raise exception using
      errcode = 'raise_exception',
      message = format('preservation: TRUNCATE of %I.%I refused - the preservation baseline '
                       'is protected data (founder ruling 2026-09-01).',
                       tg_table_schema, tg_table_name),
      hint    = v_hint;
  end if;

  -- An UPDATE is refused if EITHER side names a protected snapshot: that stops a
  -- frozen row being edited AND an ordinary row being relabelled into the frozen set.
  v_snaps := case tg_op
               when 'INSERT' then array[new.snapshot_id]
               when 'DELETE' then array[old.snapshot_id]
               else               array[old.snapshot_id, new.snapshot_id]
             end;

  select p.snapshot_id into v_hit
    from preservation.protected_snapshot p
   where p.snapshot_id = any (v_snaps)
   limit 1;

  if v_hit is not null then
    raise exception using
      errcode = 'raise_exception',
      message = format('preservation: %s on %I.%I refused - snapshot %L is protected data '
                       '(founder ruling 2026-09-01).',
                       tg_op, tg_table_schema, tg_table_name, v_hit),
      hint    = v_hint;
  end if;

  return case tg_op when 'DELETE' then old else new end;
end;
$fn$;


-- ============================================================================
-- PART 3 — the register guards itself. Adding a protected snapshot is a
--          WIDENING and stays open; removing or editing one does not.
--          Without this, deleting one register row would silently switch the
--          entire guard off.
-- ============================================================================

create or replace function preservation.guard_register()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $fn$
begin
  raise exception using
    errcode = 'raise_exception',
    message = format('preservation: %s on preservation.protected_snapshot refused - '
                     'the protection register is itself protected.', tg_op),
    hint    = format('Intentional override: ALTER TABLE preservation.protected_snapshot '
                     'DISABLE TRIGGER %I;', tg_name);
end;
$fn$;


-- ============================================================================
-- PART 4 — attach. The protected set is COMPUTED FROM THE CATALOG, never typed
--          (CLAUDE.md rule 7 — the 188 → 183 uuid incident). Every base table
--          in `preservation` carrying a `snapshot_id` column, excluding the
--          register. A future Phase-N table is covered by re-running this.
-- ============================================================================

do $do$
declare r record;
begin
  for r in
    select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid
                         and a.attname  = 'snapshot_id'
                         and a.attnum   > 0
                         and not a.attisdropped
     where n.nspname  = 'preservation'
       and c.relkind  = 'r'
       and c.relname <> 'protected_snapshot'
     order by c.relname
  loop
    execute format('drop trigger if exists zz_guard_frozen_row on preservation.%I', r.relname);
    execute format('create trigger zz_guard_frozen_row
                      before insert or update or delete on preservation.%I
                      for each row execute function preservation.guard_frozen()', r.relname);

    execute format('drop trigger if exists zz_guard_frozen_truncate on preservation.%I', r.relname);
    execute format('create trigger zz_guard_frozen_truncate
                      before truncate on preservation.%I
                      for each statement execute function preservation.guard_frozen()', r.relname);
  end loop;
end
$do$;

drop trigger if exists zz_guard_register_row on preservation.protected_snapshot;
create trigger zz_guard_register_row
  before update or delete on preservation.protected_snapshot
  for each row execute function preservation.guard_register();

drop trigger if exists zz_guard_register_truncate on preservation.protected_snapshot;
create trigger zz_guard_register_truncate
  before truncate on preservation.protected_snapshot
  for each statement execute function preservation.guard_register();

comment on table preservation.protected_snapshot is
  'Register of protected preservation snapshots. Rows here are enforced by the '
  'zz_guard_frozen_* triggers on every preservation table carrying snapshot_id. '
  'The register is itself guarded by zz_guard_register_*: INSERT (widening) is '
  'open, UPDATE/DELETE/TRUNCATE are refused.';


-- ============================================================================
-- PART 5 — TRIGGER / CONFIGURATION FINGERPRINT  (CLAUDE.md rule 8)
--
-- A list-shaped artifact is fingerprinted against its source after apply,
-- never eyeballed. `triggers_present` must equal `tables_to_guard * 2 + 2`.
-- The sort is COLLATE "C"-pinned (rule 9) so the value is collation-stable.
--
-- Measured 2026-09-01 immediately after apply:
--   tables_to_guard  = 7
--   triggers_present = 16   (7 * 2 + 2)      count_ok = true
--   disabled_triggers = 0
--   guard_md5           = d55a010018cf5c345f4c8051b8a67279
--   guard_frozen_md5    = 884f17e8348229b36f12539bf6474e23
--   guard_register_md5  = 3b3bdf1874c03ecb6ad5008d275435ab
--
-- `tgenabled` rides INSIDE guard_md5, so a guard left disabled after an
-- override changes the fingerprint and is visible on the next check.
-- ============================================================================

with guarded as (
  select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attname = 'snapshot_id'
                       and a.attnum > 0 and not a.attisdropped
   where n.nspname = 'preservation' and c.relkind = 'r'
     and c.relname <> 'protected_snapshot'
), trg as (
  select c.relname || ':' || t.tgname || ':' || t.tgenabled::text as sig,
         t.tgenabled::text as en
    from pg_trigger t
    join pg_class c     on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'preservation' and not t.tgisinternal
     and t.tgname like 'zz_guard_%'
)
select (select count(*) from guarded)                                       as tables_to_guard,
       (select count(*) from trg)                                           as triggers_present,
       (select count(*) from guarded) * 2 + 2                               as triggers_expected,
       ((select count(*) from trg) = (select count(*) from guarded)*2 + 2)   as count_ok,
       (select count(*) from trg where en <> 'O')                           as disabled_triggers,
       (select md5(string_agg(sig, ',' order by sig collate "C")) from trg)  as guard_md5,
       md5(pg_get_functiondef('preservation.guard_frozen()'::regprocedure))   as guard_frozen_md5,
       md5(pg_get_functiondef('preservation.guard_register()'::regprocedure)) as guard_register_md5;


-- ============================================================================
-- PART 6 — SELF-TEST
--
-- Runs entirely inside one statement whose final act is a deliberate
-- RAISE EXCEPTION, so EVERY attempted write above it is rolled back — even if
-- the guard had failed and an attempt had succeeded. The results are carried
-- out in the error message. Nothing persists; nothing in the Phase-1 baseline
-- is modified (the destructive attempts are refused, and the writable probes
-- use a throwaway snapshot id).
--
-- It proves BOTH directions. A blanket deny would pass every refusal test and
-- be worthless, so e1/e2/e3 assert an UNPROTECTED snapshot is still writable.
--
-- RESULT, 2026-09-01, verbatim from the returned error:
--   e1_new_snapshot_INSERT=ALLOWED | e2_new_snapshot_UPDATE=ALLOWED
--   h_relabel_INTO_frozen=REFUSED  | e3_new_snapshot_DELETE=ALLOWED
--   a_protected_DELETE=REFUSED     | b_protected_UPDATE=REFUSED
--   c_protected_TRUNCATE=REFUSED   | d_protected_INSERT=REFUSED
--   f_register_DELETE=REFUSED      | g_register_UPDATE=REFUSED
--   i_register_TRUNCATE=REFUSED
--   rows_now fingerprint=9/was=9 register=1/was=1
-- ============================================================================

do $t$
declare
  r text := '';
  ok boolean;
  n_before_fp  bigint;
  n_before_reg bigint;
begin
  select count(*) into n_before_fp  from preservation.fingerprint;
  select count(*) into n_before_reg from preservation.protected_snapshot;

  -- (e1) a NEW, separately identified snapshot must still be writable
  begin
    insert into preservation.fingerprint (snapshot_id, scope, method, value, rows)
    values ('selftest-unprotected','control','control','control',0);
    ok := true;
  exception when others then ok := false;
  end;
  r := r || 'e1_new_snapshot_INSERT=' || case when ok then 'ALLOWED' else 'BLOCKED(FAIL)' end || ' | ';

  -- (e2) and updatable
  begin
    update preservation.fingerprint set value='control2' where snapshot_id='selftest-unprotected';
    ok := true;
  exception when others then ok := false;
  end;
  r := r || 'e2_new_snapshot_UPDATE=' || case when ok then 'ALLOWED' else 'BLOCKED(FAIL)' end || ' | ';

  -- (h) but it must NOT be relabellable INTO the frozen set
  begin
    update preservation.fingerprint set snapshot_id='phase1-2026-09-01'
     where snapshot_id='selftest-unprotected';
    ok := false;
  exception when raise_exception then ok := position('refused' in sqlerrm) > 0;
  end;
  r := r || 'h_relabel_INTO_frozen=' || case when ok then 'REFUSED' else 'PERMITTED(FAIL)' end || ' | ';

  -- (e3) and deletable
  begin
    delete from preservation.fingerprint where snapshot_id='selftest-unprotected';
    ok := true;
  exception when others then ok := false;
  end;
  r := r || 'e3_new_snapshot_DELETE=' || case when ok then 'ALLOWED' else 'BLOCKED(FAIL)' end || ' | ';

  -- (a) protected DELETE
  begin
    delete from preservation.fingerprint where snapshot_id='phase1-2026-09-01';
    ok := false;
  exception when raise_exception then ok := position('refused' in sqlerrm) > 0;
  end;
  r := r || 'a_protected_DELETE=' || case when ok then 'REFUSED' else 'PERMITTED(FAIL)' end || ' | ';

  -- (b) protected UPDATE
  begin
    update preservation.fingerprint set value='tampered' where snapshot_id='phase1-2026-09-01';
    ok := false;
  exception when raise_exception then ok := position('refused' in sqlerrm) > 0;
  end;
  r := r || 'b_protected_UPDATE=' || case when ok then 'REFUSED' else 'PERMITTED(FAIL)' end || ' | ';

  -- (c) protected TRUNCATE
  begin
    truncate preservation.fingerprint;
    ok := false;
  exception when raise_exception then ok := position('refused' in sqlerrm) > 0;
  end;
  r := r || 'c_protected_TRUNCATE=' || case when ok then 'REFUSED' else 'PERMITTED(FAIL)' end || ' | ';

  -- (d) protected INSERT
  begin
    insert into preservation.fingerprint (snapshot_id, scope, method, value, rows)
    values ('phase1-2026-09-01','forged','forged','forged',0);
    ok := false;
  exception when raise_exception then ok := position('refused' in sqlerrm) > 0;
  end;
  r := r || 'd_protected_INSERT=' || case when ok then 'REFUSED' else 'PERMITTED(FAIL)' end || ' | ';

  -- (f) the register cannot be used to silently remove protection
  begin
    delete from preservation.protected_snapshot where snapshot_id='phase1-2026-09-01';
    ok := false;
  exception when raise_exception then ok := position('refused' in sqlerrm) > 0;
  end;
  r := r || 'f_register_DELETE=' || case when ok then 'REFUSED' else 'PERMITTED(FAIL)' end || ' | ';

  -- (g) nor by renaming the protected snapshot out from under the guard
  begin
    update preservation.protected_snapshot set snapshot_id='neutered'
     where snapshot_id='phase1-2026-09-01';
    ok := false;
  exception when raise_exception then ok := position('refused' in sqlerrm) > 0;
  end;
  r := r || 'g_register_UPDATE=' || case when ok then 'REFUSED' else 'PERMITTED(FAIL)' end || ' | ';

  -- (i) nor by emptying it
  begin
    truncate preservation.protected_snapshot;
    ok := false;
  exception when raise_exception then ok := position('refused' in sqlerrm) > 0;
  end;
  r := r || 'i_register_TRUNCATE=' || case when ok then 'REFUSED' else 'PERMITTED(FAIL)' end || ' | ';

  r := r || 'rows_now fingerprint=' || (select count(*) from preservation.fingerprint)::text
         || '/was=' || n_before_fp::text
         || ' register=' || (select count(*) from preservation.protected_snapshot)::text
         || '/was=' || n_before_reg::text;

  -- Force the whole self-test to roll back and carry the results out.
  raise exception 'SELFTEST_ROLLBACK :: %', r;
end
$t$;


-- ============================================================================
-- PART 7 — INTENTIONAL ADMINISTRATIVE OVERRIDE
--
-- There is NO hidden bypass. The only way through is to name the trigger you
-- are switching off. Every refusal message carries this recipe in its HINT.
--
-- ⚠️ NOT exercised against the Phase-1 baseline. Documented, not demonstrated.
--
-- Two properties make this safe to use:
--   * ALTER TABLE ... DISABLE TRIGGER is transactional and takes an
--     ACCESS EXCLUSIVE lock, so a rollback or a dropped session can never
--     leave the guard switched off.
--   * `tgenabled` rides inside guard_md5 (PART 5), so a guard left disabled
--     is detectable, not silent.
--
-- (a) DISABLE protection on one table
--       begin;
--         alter table preservation.<table> disable trigger zz_guard_frozen_row;
--         alter table preservation.<table> disable trigger zz_guard_frozen_truncate;
--         -- ... the intentional operation ...
--
-- (b) RESTORE protection, in the same transaction
--         alter table preservation.<table> enable trigger zz_guard_frozen_row;
--         alter table preservation.<table> enable trigger zz_guard_frozen_truncate;
--       commit;
--
-- (c) RETIRE a snapshot from protection entirely (two named triggers, on
--     purpose — this is the act that un-protects the founder's baseline)
--       begin;
--         alter table preservation.protected_snapshot disable trigger zz_guard_register_row;
--         delete from preservation.protected_snapshot where snapshot_id = '<snapshot>';
--         alter table preservation.protected_snapshot enable  trigger zz_guard_register_row;
--       commit;
--
-- (d) VERIFY AFTERWARDS — mandatory. Re-run PART 5 and confirm:
--       triggers_present  = tables_to_guard * 2 + 2
--       disabled_triggers = 0
--       guard_md5         = d55a010018cf5c345f4c8051b8a67279
--     A different guard_md5 with disabled_triggers = 0 means the protected
--     TABLE SET changed (e.g. a new snapshot_id table was added and guarded);
--     reconcile that difference by name before accepting it.
--     Then re-run PART 8 and confirm all nine Phase-1 fingerprints still
--     reproduce.
--
-- A platform PITR / backup restore needs none of this: it restores tables and
-- triggers together and is unaffected by the guard.
-- ============================================================================


-- ============================================================================
-- PART 8 — PHASE-1 BASELINE FINGERPRINT REPRODUCTION
--
-- The nine stored fingerprints, re-derived from the frozen tables. Every one
-- must match `preservation.fingerprint` exactly. Sorts are COLLATE "C"-pinned;
-- the corpus-scale ones use an order-independent additive checksum, so no sort
-- happens there at all.
--
-- Measured 2026-09-01 after the protection was applied: 9 of 9 match, all row
-- counts identical.
-- ============================================================================

with be as (
  select distinct unnest(zip_codes) as zip
    from public.communities
   where county = 'Box Elder' and state in ('Utah','UT')
),
i as (
  select p.* from preservation.app_project_identity p
    join be on be.zip = p.zip
   where p.snapshot_id = 'phase1-2026-09-01'
),
c as (
  select * from preservation.box_elder_cache_site where snapshot_id = 'phase1-2026-09-01'
),
f as (
  select * from preservation.fingerprint where snapshot_id = 'phase1-2026-09-01'
),
rederived as (
  select 'corpus:all' as scope,
         (select sum(('x'||substr(encode(identity_hash,'hex'),1,8))::bit(32)::bigint)::text
            from preservation.app_project_identity where snapshot_id='phase1-2026-09-01') as value,
         (select count(*) from preservation.app_project_identity where snapshot_id='phase1-2026-09-01') as rows
  union all select 'corpus:development',
         (select sum(('x'||substr(encode(identity_hash,'hex'),1,8))::bit(32)::bigint)::text
            from preservation.app_project_identity where snapshot_id='phase1-2026-09-01' and record_kind='development'),
         (select count(*) from preservation.app_project_identity where snapshot_id='phase1-2026-09-01' and record_kind='development')
  union all select 'corpus:facility',
         (select sum(('x'||substr(encode(identity_hash,'hex'),1,8))::bit(32)::bigint)::text
            from preservation.app_project_identity where snapshot_id='phase1-2026-09-01' and record_kind='facility'),
         (select count(*) from preservation.app_project_identity where snapshot_id='phase1-2026-09-01' and record_kind='facility')
  union all select 'content:development',
         (select sum(('x'||substr(encode(content_hash,'hex'),1,8))::bit(32)::bigint)::text
            from preservation.app_project_identity where snapshot_id='phase1-2026-09-01' and record_kind='development'),
         (select count(*) from preservation.app_project_identity where snapshot_id='phase1-2026-09-01' and record_kind='development')
  union all select 'boxelder:P1_app_projects_development',
         (select md5(string_agg(encode(identity_hash,'hex'), ',' order by encode(identity_hash,'hex') collate "C")) from i where record_kind='development'),
         (select count(*) from i where record_kind='development')
  union all select 'boxelder:P2_app_projects_development_UDOT',
         (select md5(string_agg(encode(identity_hash,'hex'), ',' order by encode(identity_hash,'hex') collate "C")) from i where record_kind='development' and registry_id like 'udot%'),
         (select count(*) from i where record_kind='development' and registry_id like 'udot%')
  union all select 'boxelder:P3_cache_UDOT_site_appearances',
         (select md5(string_agg(encode(site_hash,'hex'), ',' order by encode(site_hash,'hex') collate "C")) from c where source_registry_id like 'udot%'),
         (select count(*) from c where source_registry_id like 'udot%')
  union all select 'boxelder:P4_cache_all_sites',
         (select md5(string_agg(encode(site_hash,'hex'), ',' order by encode(site_hash,'hex') collate "C")) from c),
         (select count(*) from c)
  union all select 'boxelder:P5_app_projects_facility_CONTROL',
         (select md5(string_agg(encode(identity_hash,'hex'), ',' order by encode(identity_hash,'hex') collate "C")) from i where record_kind='facility'),
         (select count(*) from i where record_kind='facility')
)
select f.scope, f.method, f.value as stored, d.value as rederived,
       (f.value = d.value) as match, f.rows as stored_rows, d.rows as rederived_rows
  from f join rederived d on d.scope = f.scope
 order by f.scope collate "C";


-- ============================================================================
-- PART 9 — NON-INTERFERENCE RE-VERIFICATION
--
-- Measured before and after the migration on 2026-09-01. Every value below is
-- IDENTICAL across the two readings except `preservation_acl_md5`, whose delta
-- is fully explained: the new `protected_snapshot` table joined the set. With
-- that one table excluded, the pre-existing ACL md5 is byte-identical
-- (c68753aabe7652463f82404a7ff97899 before and after), and the new table's own
-- ACL is {postgres=arwdDxtm/postgres} — the same shape as its siblings, with
-- no application-role grant.
--
--   read_path_md5        ec1b01ae4485ad2c59b9f946c9d565b6   unchanged
--   app_refresh_zip_md5  dfd09ac72c5b6b65e61ad597665570a0   unchanged
--   cron_md5             75b49e8c7e274ea10a3c17e979f86e6f   unchanged (5 jobs)
--   public tables        135                                unchanged
--   public routines      854                                unchanged
--   zz_guard triggers in `public`                    0
--   app-role grants on `preservation`                0
--   preservation schema acl  {postgres=UC/postgres}  unchanged
-- ============================================================================

select
  md5(pg_get_functiondef('public.app_projects_for_zip(text,text)'::regprocedure))  as read_path_md5,
  md5(pg_get_functiondef('public.app_refresh_zip(text)'::regprocedure))            as app_refresh_zip_md5,
  (select md5(string_agg(jobid::text||'|'||coalesce(jobname,'')||'|'||schedule||'|'||command||'|'||active::text, ';' order by jobid))
     from cron.job)                                                                as cron_md5,
  (select count(*) from cron.job)                                                  as cron_n,
  (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind='r')                                    as public_tables,
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public')                                                      as public_routines,
  (select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid
     join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and not t.tgisinternal and t.tgname like 'zz_guard%') as guard_triggers_in_public,
  (select count(*) from information_schema.table_privileges
    where table_schema='preservation'
      and grantee in ('anon','authenticated','service_role','authenticator','PUBLIC')) as app_role_grants,
  (select nspacl::text from pg_namespace where nspname='preservation')             as preservation_schema_acl,
  (select md5(string_agg(c.relname||':'||coalesce(c.relacl::text,'-'), ',' order by c.relname collate "C"))
     from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='preservation' and c.relkind in ('r','v')
      and c.relname <> 'protected_snapshot')                                       as preexisting_acl_md5;


-- ============================================================================
-- PART 10 — SAFE REMOVAL
--
-- One transaction, catalog-computed so it cannot miss a trigger or name one
-- that does not exist. The baseline data is byte-identical afterwards, and
-- nothing outside `preservation` is touched. NOT RUN.
-- ============================================================================

-- begin;
--
-- do $do$
-- declare r record;
-- begin
--   for r in
--     select n.nspname, c.relname, t.tgname
--       from pg_trigger t
--       join pg_class c     on c.oid = t.tgrelid
--       join pg_namespace n on n.oid = c.relnamespace
--      where n.nspname = 'preservation'
--        and not t.tgisinternal
--        and t.tgname like 'zz_guard_%'
--   loop
--     execute format('drop trigger %I on %I.%I', r.tgname, r.nspname, r.relname);
--   end loop;
-- end
-- $do$;
--
-- drop function if exists preservation.guard_frozen();
-- drop function if exists preservation.guard_register();
--
-- -- The register is KEPT as the record of what was protected and why.
-- -- Drop it only if the protection is being retired for good:
-- --   drop table preservation.protected_snapshot;
--
-- commit;
