-- ============================================================================
-- PROPERTY WATCH  (Development Activity build step 9 — 2026-10-03)
-- SQL OF RECORD. TWO tables and their functions. An agent can ask HomeSignal to keep watching the property of one of its brokerage's
-- stored reports; once a day a system job checks it, and the agent is emailed when a development record near it has a material change.
-- ADDITIVE ONLY, idempotent; ROLLBACK is at the foot. Applying it needs docs/report-private-context.sql, docs/report-snapshot.sql,
-- docs/brokerage-account-spine.sql, docs/evaluation-entitlement.sql and docs/saved-reports.sql (all applied). It does NOT schedule
-- anything: the schedule is docs/property-watch-schedule.sql, applied separately and only after the function it calls is deployed.
--
-- WHAT IT IS
--   Founder-set, plan line "Watch": "Daily check of the property; email to the agent when a nearby project's official status changes."
--     property_watch                one row per (agent, stored report) being watched: when it is next due, and how the last check went.
--     property_watch_seen           what the agent has ALREADY been told about, so a change is emailed once and a retried run cannot repeat it.
--   The agent-facing functions (the caller passes its own user id; the edge function has authenticated it):
--     evaluation_property_watch_start(user, report)    start watching a report of the caller's own brokerage; idempotent.
--     evaluation_property_watches_of(user)             the caller's own watches, newest first.
--     evaluation_property_watch_stop(user, watch)      stop one of the caller's own watches.
--   The system functions (the daily job; no user id, because the job acts for the system):
--     property_watch_claim(n)                          lease up to n watches that are due.
--     property_watch_record_run(watch, outcome, seen)  a check finished: record what was told and move the watch to its next day.
--     property_watch_record_failure(watch, outcome)    a check could not finish: back off and try again.
--     property_watch_end(watch, reason)                the watch can no longer run (standing lost, property no longer kept): remove it.
--     property_watch_integrity()                       every invariant as a count that must be zero, beside a control that must not be.
--   Constants, each written ONCE: property_watch_limit() 25 · property_watch_period() 1 day · property_watch_retry() 1 hour ·
--     property_watch_lease() 10 minutes · property_watch_seen_keep() 100 days.
--
-- CANONICAL TRUTH PATH (CLAUDE.md "one canonical truth path")
--   report_snapshot (the report, immutable) <- evaluation_credit (whose it is) <- evaluation (standing) <- brokerage_member (who the caller is),
--   with report_private_context (the property's point, deletable) and the change ledger (what changed). Decision owners, none duplicated here:
--     who the person is ......................... public.brokerage_membership_of. Read, never re-derived.
--     whether a brokerage may use a stored report . public.evaluation_report_open: the SAME check that lets a member reopen or share a saved
--                                                  report. Called at start AND by the job on every check, so a trial that ends, a revoked
--                                                  account or a member who leaves ends the watch by the one rule.
--     whether the property is still kept ......... public.report_private_context_need_open / _need_close and the private layer's own purge.
--                                                  A watch registers a `follow` need whose ref is the watch id (random, minted HERE, so a lost
--                                                  response cannot orphan a need). The address and point stay in the private layer; this file
--                                                  never names them, never copies them and never reads them.
--     what counts as a change ................... NOT HERE. The job asks supabase/functions/_shared/national-report.ts, the report's own rule
--                                                  (`selectDetectedChanges`), over public.dev_change_event_reportable. This file stores only
--                                                  which (project, event type, instant) the agent was already told about.
--     when a watch is checked ................... property_watch_period() — the founder's "daily". Written once.
--
-- RULES THIS ENCODES (each pinned by test/property_watch_pg and test/property-watch-structure.test.mjs)
--   1. A watch is the AGENT's own: (user, report) is unique. Start is idempotent. Two members of one brokerage may each watch the same report
--      and each is emailed; neither can see, stop or change the other's.
--   2. Only a member of the brokerage that owns a stored report, with the standing that opens it, can start a watch. A report that is not the
--      caller's, an unknown id and a never-stored report give ONE answer: NOT_FOUND (EV006).
--   3. A brokerage has at most property_watch_limit() watches at once (EV008 WATCH_LIMIT_REACHED), counted under a lock keyed on the brokerage,
--      so two callers cannot both take the last place. The count is over watches whose agent is currently a member of that brokerage.
--   4. A watch needs the property to be kept. A report with no private context, or one the layer has purged, gives EV009 PROPERTY_NOT_KEPT and
--      stores nothing. The watch and its `follow` need are written in ONE transaction: there is no watch without its need, or a need without
--      its watch.
--   5. EVERY removal of a watch closes its `follow` need — stop, end, the cascade from a deleted user, a manual delete — because it is a
--      trigger on the table, not a step the callers remember. TRUNCATE is refused: it would skip the trigger and leave needs open. When the
--      last need closes the private layer starts its own 90-day clock; a watch therefore never extends how long an address is kept beyond the
--      time it is watched.
--   6. Stopping is owner-only (NOT_FOUND for another agent's watch). Standing is NOT needed to stop or to list: a trial that ended must never
--      leave a watch that cannot be taken back.
--   7. THE JOB CHECKS EACH WATCH ABOUT ONCE A DAY, ON A FIXED DAILY SLOT. After a check, the next one is the first slot of the form
--      first_due + k * 1 day that is after now (k >= 1). A late run does not move the slot, and a job that was down for three days checks once
--      and moves on: there is no catch-up burst.
--   8. A check that cannot finish backs off (1 hour times the number of consecutive failures, at most 24 hours) and says so; a success clears
--      the count. A failure never touches the daily slot, only a separate retry time, so a failed check is retried, never skipped, and a run of
--      failures does not move when the watch is checked once it succeeds.
--   9. A claim is a LEASE (10 minutes). Two job runs cannot take the same watch; a crashed run's lease lapses and its watches are retried.
--  10. `property_watch_seen` holds exactly what an email told the agent: a row exists only through a NOTIFIED record, and a CHECKED one carries
--      none. A project id is a public record's id; no address, label, name or coordinate is stored. Rows older than property_watch_seen_keep()
--      (longer than the 90-day window the job looks back over) are deleted as part of recording a run.
--  11. Nothing here is executable or readable by anon or authenticated. The two tables are readable by service_role and writable only through
--      these functions.
--
-- WHAT THIS DOES NOT HOLD
--   No address, label, client, coordinate or email address. The recipient's email is read by the job from the auth service at send time and is
--   stored nowhere. A watch is not a permanent record: it is deleted when stopped or ended, and its `follow` need (append-only, with a random ref
--   and no private value) is the only trace the private layer keeps, exactly as for the admin Follow function.
-- ============================================================================

-- ---- 0. PRECONDITIONS (fail closed) ------------------------------------------------------------
do $pre$
begin
  if to_regprocedure('public.report_private_context_need_open(uuid, text, text)') is null
     or to_regprocedure('public.report_private_context_need_close(uuid, text, text)') is null
     or to_regprocedure('public.evaluation_report_open(uuid, uuid)') is null
     or to_regprocedure('public.brokerage_membership_of(uuid)') is null
     or to_regclass('public.report_snapshot') is null
     or to_regclass('public.evaluation_credit') is null
     or to_regclass('public.brokerage_account') is null
     or to_regclass('auth.users') is null then
    raise exception 'property_watch: apply docs/report-private-context.sql, docs/report-snapshot.sql, docs/brokerage-account-spine.sql, docs/evaluation-entitlement.sql and docs/saved-reports.sql first';
  end if;
end $pre$;

-- ---- 1. THE NUMBERS, EACH WRITTEN ONCE ---------------------------------------------------------
-- Founder: "Daily check of the property". Once a day per watch.
create or replace function public.property_watch_period() returns interval
language sql immutable as $$ select interval '1 day' $$;

-- A default, not a founder-set value: the most watches one brokerage may hold at once. It bounds what an authenticated caller can make the
-- daily job do; the founder may change it (step 11 gives a paid account its own allocation).
create or replace function public.property_watch_limit() returns integer
language sql immutable as $$ select 25 $$;

-- The unit of the back-off after a failed check: 1 hour after the first failure, 2 after the second, ... at most 24.
create or replace function public.property_watch_retry() returns interval
language sql immutable as $$ select interval '1 hour' $$;

-- How long a claim holds a watch. A check is a few seconds; a crashed job's watches are retried after this.
create or replace function public.property_watch_lease() returns interval
language sql immutable as $$ select interval '10 minutes' $$;

-- How long a told-about row is kept. It must exceed the window the job looks back over (90 days) with room: older rows can never be
-- returned by the job again, so they are only weight.
create or replace function public.property_watch_seen_keep() returns interval
language sql immutable as $$ select interval '100 days' $$;

-- ---- 2. THE WATCH ---------------------------------------------------------------------------------
create table if not exists public.property_watch (
  watch_id      uuid        primary key default gen_random_uuid(),
  report_id     uuid        not null references public.report_snapshot (report_id),
  user_id       uuid        not null references auth.users (id) on delete cascade,
  created_at    timestamptz not null default now(),
  next_due_at   timestamptz not null default now(),
  retry_after   timestamptz,
  lease_until   timestamptz,
  last_run_at   timestamptz,
  last_outcome  text,
  failure_count integer     not null default 0,
  constraint property_watch_one_per_agent_and_report unique (user_id, report_id),
  constraint property_watch_outcome check (last_outcome is null
    or last_outcome in ('CHECKED', 'CHECKED_PARTIAL', 'NOTIFIED', 'READ_FAILED', 'EMAIL_FAILED', 'NO_RECIPIENT')),
  constraint property_watch_failures check (failure_count >= 0)
);
create index if not exists property_watch_by_due on public.property_watch (next_due_at);
create index if not exists property_watch_by_user on public.property_watch (user_id);

-- ---- 3. WHAT THE AGENT HAS BEEN TOLD -------------------------------------------------------------
create table if not exists public.property_watch_seen (
  watch_id    uuid        not null references public.property_watch (watch_id) on delete cascade,
  project_id  text        not null,
  event_type  text        not null,
  observed_at timestamptz not null,
  notified_at timestamptz not null default now(),
  primary key (watch_id, project_id, event_type, observed_at),
  constraint property_watch_seen_event_type check (event_type in ('first_detected', 'status_changed', 'source_record_updated')),
  constraint property_watch_seen_project check (btrim(project_id) <> '' and char_length(project_id) <= 200)
);

-- ---- 4. GUARDS --------------------------------------------------------------------------------------
-- A watch's identity never changes: it is the key of its follow need and the owner of its row.
create or replace function public.property_watch_guard() returns trigger
language plpgsql as $$
begin
  if new.watch_id <> old.watch_id or new.report_id <> old.report_id or new.user_id <> old.user_id or new.created_at <> old.created_at then
    raise exception 'property_watch: identity columns cannot change';
  end if;
  return new;
end $$;

-- EVERY removal closes the watch's follow need. SECURITY DEFINER so it also works when the removal is a cascade from a deleted user, run by a
-- role that cannot execute the private layer's functions.
create or replace function public.property_watch_close_need() returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_ctx uuid;
begin
  select s.private_context_id into v_ctx from public.report_snapshot s where s.report_id = old.report_id;
  if v_ctx is not null then
    perform public.report_private_context_need_close(v_ctx, 'follow', old.watch_id::text);
  end if;
  return old;
end $$;

create or replace function public.property_watch_no_truncate() returns trigger
language plpgsql as $$
begin
  raise exception 'property_watch is never truncated: that would skip the trigger that closes each watch''s follow need';
end $$;

create or replace trigger property_watch_identity_guard
  before update on public.property_watch
  for each row execute function public.property_watch_guard();
create or replace trigger property_watch_closes_need
  after delete on public.property_watch
  for each row execute function public.property_watch_close_need();
create or replace trigger property_watch_no_truncate
  before truncate on public.property_watch
  for each statement execute function public.property_watch_no_truncate();

-- ---- 5. START ---------------------------------------------------------------------------------------
-- NOT_FOUND (EV006) · WATCH_LIMIT_REACHED (EV008) · PROPERTY_NOT_KEPT (EV009). `started` is false when the agent was already watching it.
create or replace function public.evaluation_property_watch_start(p_user_id uuid, p_report_id uuid)
returns table (watch_id uuid, created_at timestamptz, started boolean)
language plpgsql security definer set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_ctx       uuid;
  v_brokerage uuid;
  v_id        uuid;
  v_created   timestamptz;
  v_n         integer;
begin
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'evaluation_property_watch_start: needs READ COMMITTED (the per-brokerage limit is counted after a lock that refreshes what the count sees only there; this transaction is %)',
      current_setting('transaction_isolation') using errcode = '55000';
  end if;
  -- the SAME check that lets a member reopen or share a saved report: the caller's own brokerage, with standing
  select o.private_context_id into v_ctx from public.evaluation_report_open(p_user_id, p_report_id) o;
  if not found then
    raise exception using errcode = 'EV006', message = 'NOT_FOUND';
  end if;
  select m.brokerage_id into v_brokerage from public.brokerage_membership_of(p_user_id) m;
  perform pg_advisory_xact_lock(hashtextextended('property_watch:' || v_brokerage::text, 0));

  select w.watch_id, w.created_at into v_id, v_created from public.property_watch w where w.user_id = p_user_id and w.report_id = p_report_id;
  if found then
    -- already watching: idempotent. The need is asserted again, which is a no-op while it is open.
    begin
      perform public.report_private_context_need_open(v_ctx, 'follow', v_id::text);
    exception when sqlstate '55000' or sqlstate '23503' then
      raise exception using errcode = 'EV009', message = 'PROPERTY_NOT_KEPT';
    end;
    return query select v_id, v_created, false;
    return;
  end if;

  if v_ctx is null then
    raise exception using errcode = 'EV009', message = 'PROPERTY_NOT_KEPT';
  end if;
  select count(*) into v_n from public.property_watch w
   where exists (select 1 from public.brokerage_membership_of(w.user_id) m where m.brokerage_id = v_brokerage);
  if v_n >= public.property_watch_limit() then
    raise exception using errcode = 'EV008', message = 'WATCH_LIMIT_REACHED';
  end if;

  begin
    insert into public.property_watch (report_id, user_id) values (p_report_id, p_user_id)
      returning property_watch.watch_id, property_watch.created_at into v_id, v_created;
    perform public.report_private_context_need_open(v_ctx, 'follow', v_id::text);
  exception when sqlstate '55000' or sqlstate '23503' then
    raise exception using errcode = 'EV009', message = 'PROPERTY_NOT_KEPT';
  end;
  return query select v_id, v_created, true;
end $$;

-- ---- 6. THE CALLER'S OWN WATCHES ----------------------------------------------------------------------
-- Ownership only (rule 6). The report's number and time come from the ledger and the snapshot; the address is NOT here — the caller asks the
-- private layer's own reader for it, with the handle this returns.
create or replace function public.evaluation_property_watches_of(p_user_id uuid)
returns table (watch_id uuid, report_id uuid, number integer, generated_at timestamptz, private_context_id uuid,
               created_at timestamptz, last_run_at timestamptz, last_outcome text, next_due_at timestamptz)
language sql stable security definer set search_path = public, pg_temp
as $$
  select w.watch_id, w.report_id, c.ordinal, s.generated_at, s.private_context_id, w.created_at, w.last_run_at, w.last_outcome, w.next_due_at
    from public.property_watch w
    join public.report_snapshot s on s.report_id = w.report_id
    left join public.evaluation_credit c on c.report_id = w.report_id
   where w.user_id = p_user_id
   order by w.created_at desc, w.watch_id
$$;

-- ---- 7. STOP ---------------------------------------------------------------------------------------------
-- NOT_FOUND (EV006) for a watch that is not the caller's, an unknown id and one already stopped: the caller cannot tell them apart.
create or replace function public.evaluation_property_watch_stop(p_user_id uuid, p_watch_id uuid)
returns boolean
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  delete from public.property_watch w where w.watch_id = p_watch_id and w.user_id = p_user_id;
  if not found then
    raise exception using errcode = 'EV006', message = 'NOT_FOUND';
  end if;
  return true;
end $$;

-- ---- 8. THE DAILY JOB'S FUNCTIONS -------------------------------------------------------------------------
-- Claim: lease up to p_limit watches that are due and not already leased. SKIP LOCKED, so two runs never take the same one.
create or replace function public.property_watch_claim(p_limit integer)
returns table (watch_id uuid, report_id uuid, user_id uuid)
language plpgsql security definer set search_path = public, pg_temp
as $$
#variable_conflict use_column
begin
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'property_watch_claim: p_limit must be between 1 and 100' using errcode = '22023';
  end if;
  -- oldest due first, so a batch smaller than the backlog always works on the watches that have waited longest
  return query
    with due as (
      select w.watch_id from public.property_watch w
       where w.next_due_at <= now() and (w.retry_after is null or w.retry_after <= now())
         and (w.lease_until is null or w.lease_until <= now())
       order by w.next_due_at, w.watch_id
       limit p_limit
       for update skip locked),
    taken as (
      update public.property_watch w set lease_until = now() + public.property_watch_lease()
        from due where w.watch_id = due.watch_id
      returning w.watch_id, w.report_id, w.user_id, w.next_due_at)
    select t.watch_id, t.report_id, t.user_id from taken t order by t.next_due_at, t.watch_id;
end $$;

-- A check finished. `p_seen` is what an email just told the agent: [{project_id, event_type, observed_at}]. NOTIFIED needs at least one;
-- CHECKED and CHECKED_PARTIAL (the sources could not all be read, so silence is a weaker answer) carry none. Returns false, writing nothing,
-- when the watch no longer exists (stopped while the check ran).
create or replace function public.property_watch_record_run(p_watch uuid, p_outcome text, p_seen jsonb)
returns boolean
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  w     public.property_watch%rowtype;
  v_seen jsonb := coalesce(p_seen, '[]'::jsonb);
  v_k   integer;
begin
  if p_outcome is null or p_outcome not in ('CHECKED', 'CHECKED_PARTIAL', 'NOTIFIED') then
    raise exception 'property_watch_record_run: unknown outcome' using errcode = '22023';
  end if;
  if jsonb_typeof(v_seen) <> 'array' or jsonb_array_length(v_seen) > 200 then
    raise exception 'property_watch_record_run: p_seen must be an array of at most 200 entries' using errcode = '22023';
  end if;
  if (p_outcome = 'NOTIFIED') <> (jsonb_array_length(v_seen) > 0) then
    raise exception 'property_watch_record_run: a NOTIFIED check records what it told, and any other records nothing' using errcode = '22023';
  end if;
  select * into w from public.property_watch where watch_id = p_watch for update;
  if not found then
    return false;
  end if;
  insert into public.property_watch_seen (watch_id, project_id, event_type, observed_at)
    select p_watch, x.project_id, x.event_type, x.observed_at
      from jsonb_to_recordset(v_seen) as x (project_id text, event_type text, observed_at timestamptz)
    on conflict do nothing;
  delete from public.property_watch_seen s where s.watch_id = p_watch and s.observed_at < now() - public.property_watch_seen_keep();
  -- the next slot is first_due + k * period, the first one after now (k >= 1): a late run does not move the slot, and a long outage is not a burst
  v_k := greatest(1, floor(extract(epoch from (now() - w.next_due_at)) / extract(epoch from public.property_watch_period()))::integer + 1);
  update public.property_watch
     set last_run_at = now(), last_outcome = p_outcome, failure_count = 0, lease_until = null, retry_after = null,
         next_due_at = w.next_due_at + v_k * public.property_watch_period()
   where watch_id = p_watch;
  return true;
end $$;

-- A check could not finish. Back off by (retry unit * consecutive failures), at most 24 units. The DAILY SLOT (next_due_at) is not touched, so
-- a run of failures does not move when the watch is checked once it succeeds.
create or replace function public.property_watch_record_failure(p_watch uuid, p_outcome text)
returns boolean
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_fail integer;
begin
  if p_outcome is null or p_outcome not in ('READ_FAILED', 'EMAIL_FAILED', 'NO_RECIPIENT') then
    raise exception 'property_watch_record_failure: unknown outcome' using errcode = '22023';
  end if;
  update public.property_watch
     set failure_count = failure_count + 1, last_outcome = p_outcome, lease_until = null
   where watch_id = p_watch
   returning failure_count into v_fail;
  if not found then
    return false;
  end if;
  update public.property_watch
     set retry_after = now() + public.property_watch_retry() * least(v_fail, 24)
   where watch_id = p_watch;
  return true;
end $$;

-- End a watch that can no longer run. The trigger closes its follow need.
create or replace function public.property_watch_end(p_watch uuid, p_reason text)
returns boolean
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if p_reason is null or p_reason not in ('STANDING_LOST', 'PROPERTY_NOT_KEPT') then
    raise exception 'property_watch_end: unknown reason' using errcode = '22023';
  end if;
  delete from public.property_watch where watch_id = p_watch;
  return found;
end $$;

-- ---- 9. THE AUDIT ---------------------------------------------------------------------------------------------
-- Every invariant as a count that must be zero, beside a control that must not be (a zero from an empty table is not a clean bill).
create or replace function public.property_watch_integrity()
returns table (check_name text, kind text, violations bigint)
language sql stable security definer set search_path = public, pg_temp
as $$
  select 'watches', 'control', (select count(*) from public.property_watch)
  union all
  -- a watch whose follow need is not open: the property would not be kept (the context may be purged, or the need closed behind our back)
  select 'watch_without_open_follow_need', 'invariant', (
    select count(*) from public.property_watch w
      join public.report_snapshot s on s.report_id = w.report_id
     where not exists (select 1 from public.report_private_context_need n
                        where n.context_id = s.private_context_id and n.kind = 'follow' and n.ref = w.watch_id::text and n.closed_at is null))
  union all
  -- a watch that was due more than 6 hours ago and is not leased: the daily job is not keeping up, or is not running
  select 'overdue_watches', 'invariant', (
    select count(*) from public.property_watch w
     where greatest(w.next_due_at, coalesce(w.retry_after, w.next_due_at)) < now() - interval '6 hours'
       and (w.lease_until is null or w.lease_until <= now()))
  union all
  -- a told-about row older than it is kept for
  select 'seen_past_keep', 'invariant', (
    select count(*) from public.property_watch_seen s where s.observed_at < now() - public.property_watch_seen_keep() - interval '1 day')
$$;

-- ---- 10. LOCK-DOWN: system-only ---------------------------------------------------------------------------------
-- Supabase's default privileges open every new table and function in `public` to anon and authenticated; revoke by name, enable RLS with no
-- policy (deny by default), then grant back exactly what the system needs.
alter table public.property_watch      enable row level security;
alter table public.property_watch_seen enable row level security;
revoke all on public.property_watch      from public, anon, authenticated, service_role;
revoke all on public.property_watch_seen from public, anon, authenticated, service_role;
grant select on public.property_watch      to service_role;
grant select on public.property_watch_seen to service_role;

revoke all on function public.property_watch_period()                              from public, anon, authenticated, service_role;
revoke all on function public.property_watch_limit()                               from public, anon, authenticated, service_role;
revoke all on function public.property_watch_retry()                               from public, anon, authenticated, service_role;
revoke all on function public.property_watch_lease()                               from public, anon, authenticated, service_role;
revoke all on function public.property_watch_seen_keep()                           from public, anon, authenticated, service_role;
revoke all on function public.evaluation_property_watch_start(uuid, uuid)          from public, anon, authenticated, service_role;
revoke all on function public.evaluation_property_watches_of(uuid)                 from public, anon, authenticated, service_role;
revoke all on function public.evaluation_property_watch_stop(uuid, uuid)           from public, anon, authenticated, service_role;
revoke all on function public.property_watch_claim(integer)                        from public, anon, authenticated, service_role;
revoke all on function public.property_watch_record_run(uuid, text, jsonb)         from public, anon, authenticated, service_role;
revoke all on function public.property_watch_record_failure(uuid, text)            from public, anon, authenticated, service_role;
revoke all on function public.property_watch_end(uuid, text)                       from public, anon, authenticated, service_role;
revoke all on function public.property_watch_integrity()                           from public, anon, authenticated, service_role;
revoke all on function public.property_watch_guard()                               from public, anon, authenticated, service_role;
revoke all on function public.property_watch_close_need()                          from public, anon, authenticated, service_role;
revoke all on function public.property_watch_no_truncate()                         from public, anon, authenticated, service_role;
grant execute on function public.property_watch_period()                           to service_role;
grant execute on function public.property_watch_limit()                            to service_role;
grant execute on function public.property_watch_retry()                            to service_role;
grant execute on function public.property_watch_lease()                            to service_role;
grant execute on function public.property_watch_seen_keep()                        to service_role;
grant execute on function public.evaluation_property_watch_start(uuid, uuid)       to service_role;
grant execute on function public.evaluation_property_watches_of(uuid)              to service_role;
grant execute on function public.evaluation_property_watch_stop(uuid, uuid)        to service_role;
grant execute on function public.property_watch_claim(integer)                     to service_role;
grant execute on function public.property_watch_record_run(uuid, text, jsonb)      to service_role;
grant execute on function public.property_watch_record_failure(uuid, text)         to service_role;
grant execute on function public.property_watch_end(uuid, text)                    to service_role;
grant execute on function public.property_watch_integrity()                        to service_role;

-- ---- 11. POST-CONDITION -------------------------------------------------------------------------------------------
-- Computed over every function with either prefix and both tables, so a function added later that is open to a resident role fails here.
do $post$
declare
  f   record;
  t   text;
  bad text;
begin
  for f in select p.oid, p.oid::regprocedure::text as sig, p.proname, p.prorettype
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and (p.proname like 'property\_watch%' or p.proname like 'evaluation\_property\_watch%') loop
    if exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                where p.oid = f.oid and a.grantee <> p.proowner
                  and (a.grantee <> (select oid from pg_roles where rolname = 'service_role') or a.privilege_type <> 'EXECUTE')) then
      raise exception 'property_watch: % is executable by a role it should not be', f.sig;
    end if;
  end loop;
  foreach t in array array['public.property_watch', 'public.property_watch_seen'] loop
    if not (select c.relrowsecurity from pg_class c where c.oid = t::regclass) then
      raise exception 'property_watch: % must have row level security enabled', t;
    end if;
    if exists (select 1 from pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
                where c.oid = t::regclass and a.grantee <> c.relowner
                  and (a.grantee <> (select oid from pg_roles where rolname = 'service_role') or a.privilege_type <> 'SELECT')) then
      raise exception 'property_watch: % is open to a role it should not be', t;
    end if;
  end loop;
  for bad in select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and not p.prosecdef
                and p.proname in ('evaluation_property_watch_start', 'evaluation_property_watches_of', 'evaluation_property_watch_stop',
                                  'property_watch_claim', 'property_watch_record_run', 'property_watch_record_failure', 'property_watch_end',
                                  'property_watch_integrity', 'property_watch_close_need') loop
    raise exception 'property_watch: % must be SECURITY DEFINER (the tables are closed to its caller)', bad;
  end loop;
  if public.property_watch_period() <> interval '1 day' then
    raise exception 'property_watch: the check is the founder''s daily';
  end if;
  if public.property_watch_seen_keep() <= interval '90 days' then
    raise exception 'property_watch: told-about rows must be kept longer than the 90-day window the job looks back over';
  end if;
end $post$;

-- ROLLBACK (this file only). Deleting the watches FIRST closes every follow need through the trigger; dropping the table alone would not.
-- ROLLBACK-BEGIN
--   do $rb$ begin if to_regclass('public.property_watch') is not null then delete from public.property_watch; end if; end $rb$;
--   drop table if exists public.property_watch_seen;
--   drop table if exists public.property_watch;
--   drop function if exists public.property_watch_integrity(), public.property_watch_end(uuid, text),
--     public.property_watch_record_failure(uuid, text), public.property_watch_record_run(uuid, text, jsonb),
--     public.property_watch_claim(integer), public.evaluation_property_watch_stop(uuid, uuid),
--     public.evaluation_property_watches_of(uuid), public.evaluation_property_watch_start(uuid, uuid),
--     public.property_watch_close_need(), public.property_watch_guard(), public.property_watch_no_truncate(),
--     public.property_watch_seen_keep(), public.property_watch_lease(), public.property_watch_retry(),
--     public.property_watch_limit(), public.property_watch_period();
-- ROLLBACK-END
