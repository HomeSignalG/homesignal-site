-- ============================================================================
-- REPORT SHARE DELIVERY  (Development Activity build step 8 — 2026-10-03)
-- SQL OF RECORD. FOUR functions and two constants (six objects, all functions), built on the share-link primitive (docs/report-share.sql, Order J1, applied
-- 2026-10-02). No table, no column, no trigger, no schedule: a brokerage's agent can share one of its stored reports with a client,
-- list those links and revoke them, and a client who holds a link can read the report. ADDITIVE ONLY, idempotent; ROLLBACK is at the foot.
-- Applying it needs docs/report-share.sql, docs/saved-reports.sql, docs/evaluation-entitlement.sql, docs/brokerage-account-spine.sql and
-- docs/report-snapshot.sql (all applied).
--
-- WHAT IT IS
--   The share primitive (J1) deliberately had no owner, no caller and no default expiry. This is the layer that gives it all three,
--   under the founder's answers of 2026-10-03: a link lasts 6 MONTHS, and the client sees the street address.
--     report_share_lifetime()                     the ONE definition of how long a link lasts: 6 months.
--     report_share_limit()                        the ONE definition of how many links one report may ever have: 25.
--     evaluation_report_share_create(user, report, hash)   a member of the report's own brokerage makes a link. Expires after the lifetime.
--     evaluation_report_shares_of(user, report)   the links of one of the caller's own brokerage's reports, newest first, with their status.
--     evaluation_report_share_revoke(user, share) a member of the owning brokerage revokes a link.
--     report_share_open(hash)                     what a client who holds the link may read: the stored report, and nothing else.
--
-- CANONICAL TRUTH PATH (CLAUDE.md "one canonical truth path")
--   report_snapshot (the report, immutable) <- evaluation_credit (which brokerage's evaluation it belongs to) <- evaluation <- brokerage_account,
--   with brokerage_membership_of (who the caller is) and report_share_* (whether a link is usable). Decision owners, none duplicated here:
--     who the person is ......................... public.brokerage_membership_of (Order K0). Read, never re-derived.
--     whose a report is ......................... public.evaluation_credit (one row per stored report, report_id UNIQUE): a join, not a copy.
--                                                  NO owner column is added to a share. A share belongs to whoever owns its report.
--     whether a brokerage may make a link ........ public.evaluation_report_open: the SAME check that lets a member reopen a saved report
--                                                  (an active, unexpired trial, or a complete one). Called, not re-written.
--     whether a link is usable ................... public.report_share_resolve (J1). Every status in this file, and the client read, goes
--                                                  through it: the list calls it with the hash the table already holds. Nothing here re-decides
--                                                  ACTIVE, EXPIRED, REVOKED or UNKNOWN.
--     what a link is, how it is hashed, revoked .. docs/report-share.sql (J1), unchanged. This file calls report_share_create and
--                                                  report_share_revoke and writes no share row itself.
--     what the private layer keeps ............... public.report_private_context. NOT named here: the client read returns the snapshot's
--                                                  opaque context handle, and the caller asks the layer's own reader for the address.
--
-- RULES THIS ENCODES (each pinned by test/report_share_delivery_pg and test/report-share-delivery-structure.test.mjs)
--   1. A LINK LASTS 6 MONTHS (founder, 2026-10-03). The caller passes no expiry. The lifetime is report_share_lifetime(), written once.
--      The J1 guard means an expiry can never be extended: a lapsed link is replaced by a new one, not renewed.
--   2. Only a member of the brokerage that owns a report can share it, and only while that brokerage has standing (the check that
--      opens a saved report). A report that is not the caller's, an unknown id and a never-stored report all give the same NOT_FOUND.
--   3. Listing and revoking need OWNERSHIP, not standing. A brokerage whose trial has ended can still see and revoke the links it made:
--      a client link must never become impossible to take back because a trial ran out.
--   4. A report has at most 25 links, ever (live or not). The writes an authenticated caller can make are bounded; a lost link is revoked
--      and replaced, and 25 is far more than that needs. The count is taken under a lock keyed on the report, so two calls cannot both
--      take the last place.
--   5. THE CLIENT READ (report_share_open) returns ZERO rows unless the link is ACTIVE. An unknown, revoked and expired link are
--      indistinguishable from each other: there is no oracle for whether a token ever existed. It also returns nothing when the owning
--      brokerage's evaluation was REVOKED by an administrator or the brokerage is not active: a link does not outlive a withdrawn
--      account. An evaluation that merely ended (its time ran out, or its 10 reports are used) does NOT take back a report already shared.
--   6. What the client read returns: the stored text unchanged, when it was made, the snapshot's opaque context handle, and the owning
--      brokerage's name. No share_id, no ordinal, no evaluation, no user, no agent: a share records no actor, so the shared view names
--      the brokerage and no individual (see WHAT THIS DOES NOT HOLD).
--   7. Nothing here charges, issues or stores a report, and none of it touches the snapshot or the private layer. The client read writes
--      nothing at all (STABLE): an open is not recorded, in line with J1 (the audit log has two kinds and no text).
--   8. Nothing here is executable by anon or authenticated. All four and both constants are service_role only.
--
-- WHAT THIS DOES NOT HOLD
--   No actor. J1's audit log has no column for one and the credit ledger holds no user id by design (retaining an agent identity in a
--   permanent trail is an open founder question), so a share does not remember WHICH agent made it. Any member of the owning brokerage may
--   list and revoke it (the default for saved reports too: D-6-2). The shared view therefore names the brokerage, not a person; adding
--   "prepared by <agent>" would need a creator column and that founder decision.
--   No address, label, client or coordinate is read or returned: the address stays in the private layer.
-- ============================================================================

-- ---- 0. PRECONDITIONS (fail closed) ------------------------------------------------------------
do $pre$
begin
  if to_regprocedure('public.report_share_create(uuid, text, timestamptz)') is null
     or to_regprocedure('public.report_share_revoke(uuid)') is null
     or to_regprocedure('public.report_share_resolve(text)') is null
     or to_regprocedure('public.evaluation_report_open(uuid, uuid)') is null
     or to_regprocedure('public.brokerage_membership_of(uuid)') is null
     or to_regclass('public.report_share') is null
     or to_regclass('public.evaluation_credit') is null
     or to_regclass('public.brokerage_account') is null then
    raise exception 'report_share_delivery: apply docs/report-share.sql, docs/saved-reports.sql, docs/evaluation-entitlement.sql and docs/brokerage-account-spine.sql first';
  end if;
end $pre$;

-- ---- 1. THE TWO NUMBERS, EACH WRITTEN ONCE ------------------------------------------------------
-- Founder, 2026-10-03: "6 months". A calendar interval, so a link made on 3 October expires on 3 April.
create or replace function public.report_share_lifetime() returns interval
language sql immutable as $$ select interval '6 months' $$;

-- A bound on what an authenticated caller can write, not a product promise: it also bounds the listing.
create or replace function public.report_share_limit() returns integer
language sql immutable as $$ select 25 $$;

-- ---- 2. MAKE A LINK ----------------------------------------------------------------------------------
-- The caller hashes the token (supabase/functions/_shared/report-share.ts) and sends the hash: this database never sees a token.
-- NOT_FOUND (EV006): the report is not one of the caller's own brokerage's, or the brokerage has no standing. SHARE_LIMIT_REACHED (EV007).
create or replace function public.evaluation_report_share_create(p_user_id uuid, p_report_id uuid, p_token_sha256 text)
returns table (share_id uuid, expires_at timestamptz)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_id      uuid;
  v_expires timestamptz;
begin
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'evaluation_report_share_create: needs READ COMMITTED (the per-report limit is counted after a lock that refreshes what the count sees only there; this transaction is %)',
      current_setting('transaction_isolation') using errcode = '55000';
  end if;
  -- the SAME check that lets a member reopen a saved report: the caller's own brokerage, with standing
  if not exists (select 1 from public.evaluation_report_open(p_user_id, p_report_id)) then
    raise exception using errcode = 'EV006', message = 'NOT_FOUND';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('report_share:' || p_report_id::text, 0));
  if (select count(*) from public.report_share s where s.report_id = p_report_id) >= public.report_share_limit() then
    raise exception using errcode = 'EV007', message = 'SHARE_LIMIT_REACHED';
  end if;
  v_expires := now() + public.report_share_lifetime();
  v_id := public.report_share_create(p_report_id, p_token_sha256, v_expires);
  return query select v_id, v_expires;
end $$;

-- ---- 3. LIST ONE REPORT'S LINKS ---------------------------------------------------------------------
-- Ownership only (rule 3). The status is the ONE decision, report_share_resolve, asked with the hash the table already holds; the hash
-- itself is never returned. Empty for a report that is not the caller's, indistinguishably from one with no links.
create or replace function public.evaluation_report_shares_of(p_user_id uuid, p_report_id uuid)
returns table (share_id uuid, created_at timestamptz, expires_at timestamptz, revoked_at timestamptz, status text)
language sql stable security definer set search_path = public, pg_temp
as $$
  select s.share_id, s.created_at, s.expires_at, s.revoked_at, r.status
    from public.brokerage_membership_of(p_user_id) m
    join public.evaluation e on e.brokerage_id = m.brokerage_id
    join public.evaluation_credit c on c.evaluation_id = e.evaluation_id
    join public.report_share s on s.report_id = c.report_id
    cross join lateral public.report_share_resolve(s.token_sha256) r
   where c.report_id = p_report_id
   order by s.created_at desc, s.share_id
$$;

-- ---- 4. REVOKE A LINK -----------------------------------------------------------------------------------
-- true when THIS call revoked it, false when it was already revoked (J1's idempotent answer). NOT_FOUND (EV006) for a share that is not
-- on one of the caller's own brokerage's reports, the same for another brokerage's and for an unknown id.
create or replace function public.evaluation_report_share_revoke(p_user_id uuid, p_share_id uuid)
returns boolean
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1
      from public.brokerage_membership_of(p_user_id) m
      join public.evaluation e on e.brokerage_id = m.brokerage_id
      join public.evaluation_credit c on c.evaluation_id = e.evaluation_id
      join public.report_share s on s.report_id = c.report_id
     where s.share_id = p_share_id) then
    raise exception using errcode = 'EV006', message = 'NOT_FOUND';
  end if;
  return public.report_share_revoke(p_share_id);
end $$;

-- ---- 5. THE CLIENT READ ---------------------------------------------------------------------------------
-- Takes the token's HASH. Zero rows unless the link is ACTIVE (rule 5); one row otherwise. The report is returned as stored.
create or replace function public.report_share_open(p_token_sha256 text)
returns table (report_id uuid, generated_at timestamptz, body text, private_context_id uuid, brokerage_name text)
language sql stable security definer set search_path = public, pg_temp
as $$
  select s.report_id, s.generated_at, s.body, s.private_context_id, a.name
    from public.report_share_resolve(p_token_sha256) r
    join public.report_snapshot s on s.report_id = r.report_id
    join public.evaluation_credit c on c.report_id = s.report_id
    join public.evaluation e on e.evaluation_id = c.evaluation_id
    join public.brokerage_account a on a.id = e.brokerage_id
   where r.status = 'ACTIVE' and e.status <> 'revoked' and a.status = 'active'
$$;

-- ---- 6. LOCK-DOWN: system-only ----------------------------------------------------------------------
-- Supabase's default privileges open every new function in `public` to anon and authenticated; revoke by name, grant service_role alone.
revoke all on function public.report_share_lifetime()                               from public, anon, authenticated, service_role;
revoke all on function public.report_share_limit()                                  from public, anon, authenticated, service_role;
revoke all on function public.evaluation_report_share_create(uuid, uuid, text)      from public, anon, authenticated, service_role;
revoke all on function public.evaluation_report_shares_of(uuid, uuid)                from public, anon, authenticated, service_role;
revoke all on function public.evaluation_report_share_revoke(uuid, uuid)             from public, anon, authenticated, service_role;
revoke all on function public.report_share_open(text)                                from public, anon, authenticated, service_role;
grant execute on function public.report_share_lifetime()                            to service_role;
grant execute on function public.report_share_limit()                               to service_role;
grant execute on function public.evaluation_report_share_create(uuid, uuid, text)   to service_role;
grant execute on function public.evaluation_report_shares_of(uuid, uuid)             to service_role;
grant execute on function public.evaluation_report_share_revoke(uuid, uuid)          to service_role;
grant execute on function public.report_share_open(text)                             to service_role;

-- ---- 7. POST-CONDITION ------------------------------------------------------------------------------
-- Computed over every function with either prefix, so a function added later (or one of J1's) that is open to a resident role fails here.
do $post$
declare
  f   record;
  bad text;
begin
  for f in select p.oid, p.oid::regprocedure::text as sig, p.provolatile, p.prosecdef, p.proname
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and (p.proname like 'report\_share\_%' or p.proname like 'evaluation\_report\_share%') loop
    if exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                where p.oid = f.oid and a.grantee <> p.proowner
                  and (a.grantee <> (select oid from pg_roles where rolname = 'service_role') or a.privilege_type <> 'EXECUTE')) then
      raise exception 'report_share_delivery: % is executable by a role it should not be', f.sig;
    end if;
  end loop;
  for bad in select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.provolatile <> 's'
                and p.proname in ('evaluation_report_shares_of', 'report_share_open', 'report_share_resolve') loop
    raise exception 'report_share_delivery: % must be STABLE (it writes nothing)', bad;
  end loop;
  for bad in select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and not p.prosecdef
                and p.proname in ('evaluation_report_share_create', 'evaluation_report_shares_of', 'evaluation_report_share_revoke', 'report_share_open') loop
    raise exception 'report_share_delivery: % must be SECURITY DEFINER (the tables are closed to its caller)', bad;
  end loop;
  if public.report_share_lifetime() <> interval '6 months' then
    raise exception 'report_share_delivery: the share lifetime is the founder''s 6 months';
  end if;
end $post$;

-- ROLLBACK (this file only; it holds no data and no share row is touched):
-- ROLLBACK-BEGIN
--   drop function if exists public.report_share_open(text), public.evaluation_report_share_revoke(uuid, uuid),
--     public.evaluation_report_shares_of(uuid, uuid), public.evaluation_report_share_create(uuid, uuid, text),
--     public.report_share_limit(), public.report_share_lifetime();
-- ROLLBACK-END
