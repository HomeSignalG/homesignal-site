-- ===========================================================================
-- HomeSignal — CANONICAL EMAIL-SUBSCRIPTION MODEL, migration A9
-- FREEZE THE LEGACY STORE — `users.topics` -> `users.topics_pre_migration`
-- Applied 2026-09-21 as
--   `alert_subscription_canonical_a9_freeze_topics_pre_migration`.
--
-- ⚠️ THIS STEP OF THE APPROVED DESIGN HAD NOT SHIPPED, AND THE GAP WAS INVISIBLE
-- BECAUSE ITS NAME WAS ALREADY BEING USED. Founder MANDATORY CHANGE 1 reads: "Do not
-- drop `topics_pre_migration` in this implementation. Freeze it read-only as proposed
-- and retain it after production cutover. Do not dual-write it." That instruction
-- PRESUPPOSES the rename. A5 was re-scoped mid-flight to append `sort_order` to the
-- state view (`create or replace view` can only APPEND columns), and the rename went
-- with it. Measured before this migration: `users.topics` still existed, under its old
-- name, writable — so the three-store divergence the whole workstream exists to end
-- still had one store open, while every report called it frozen.
--
-- NOTHING READS OR WRITES IT — verified, not assumed, before the rename:
--   * views      — no view reads users.topics (pg_get_viewdef scan over public). The
--                  one match, `digest_recipients.topics`, is an ALIAS over a
--                  `user_subscriptions` aggregate.
--   * functions  — signup_complete / enable_area_email_alerts / subscribe_area_defaults
--                  (A4) write `user_subscriptions` only; `hs_acquisition_metrics`'
--                  `topics_top` reads `user_subscriptions`.
--   * homesignal-site   — 0 references across .js / .html / supabase/functions
--   * homesignal-ingest — digest.py names it in COMMENTS only; `_recipients()` reads
--                  the `digest_recipients` view. Those comments are corrected in the
--                  same change, because a stale docstring naming the retired store is
--                  how the next session writes to it.
-- ===========================================================================

do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema='public' and table_name='users' and column_name='topics') then
    alter table public.users rename column topics to topics_pre_migration;
  end if;
end $$;

-- THE FREEZE IS A TRIGGER, NOT A COLUMN-PRIVILEGE REVOKE. Making one column read-only
-- by privilege means revoking table-level UPDATE and re-granting every other column,
-- which silently stops covering a column added later — a guard that stops guarding.
-- A trigger refuses the WRITE, so neither a new column nor a service-role write escapes.
create or replace function public.refuse_topics_pre_migration_write()
returns trigger
language plpgsql set search_path to 'public'
as $function$
begin
  if tg_op = 'INSERT' then
    if new.topics_pre_migration is not null then
      raise exception 'users.topics_pre_migration is FROZEN (pre-migration snapshot, retained read-only); write user_subscriptions instead'
        using errcode = '23514';
    end if;
  elsif new.topics_pre_migration is distinct from old.topics_pre_migration then
    raise exception 'users.topics_pre_migration is FROZEN (pre-migration snapshot, retained read-only); write user_subscriptions instead'
      using errcode = '23514';
  end if;
  return new;
end $function$;

drop trigger if exists users_topics_pre_migration_frozen on public.users;
create trigger users_topics_pre_migration_frozen
  before insert or update on public.users
  for each row execute function public.refuse_topics_pre_migration_write();

-- Fail closed. A rename that lost rows is not a freeze, and an empty table verifies
-- nothing at all.
do $$
declare v_old int; v_new int; v_rows int; v_nonnull int;
begin
  select count(*) into v_old from information_schema.columns
   where table_schema='public' and table_name='users' and column_name='topics';
  select count(*) into v_new from information_schema.columns
   where table_schema='public' and table_name='users' and column_name='topics_pre_migration';
  select count(*) into v_rows from public.users;
  execute 'select count(*) from public.users where topics_pre_migration is not null' into v_nonnull;
  if v_old <> 0 or v_new <> 1 then
    raise exception 'A9 refused: users.topics=% users.topics_pre_migration=%', v_old, v_new;
  end if;
  if v_rows = 0 then
    raise exception 'A9 refused: users is empty — NOTHING WAS VERIFIED';
  end if;
  raise notice 'A9 ok: % users rows, % carrying a retained snapshot', v_rows, v_nonnull;
end $$;

-- ---------------------------------------------------------------------------
-- VERIFIED LIVE 2026-09-21, one rolled-back transaction, controls beside each check.
-- Checks 2 and 3 are the ones that matter: a freeze that also blocked ordinary writes
-- would break signup, and a BEFORE INSERT trigger is exactly the shape that does it.
--
--   0 users=13  retained snapshots=8  digest recipients=8
--   1 WRITE TO THE FROZEN SNAPSHOT: REFUSED -> users.topics_pre_migration is FROZEN…
--   2 CONTROL ordinary users UPDATE: SUCCEEDED
--   3 CONTROL users INSERT without the column: SUCCEEDED   (signup_complete's shape)
--   4 INSERT carrying the frozen column: REFUSED
--   5 digest recipients after: 8 (was 8)                    (delivery unchanged)
-- ---------------------------------------------------------------------------
