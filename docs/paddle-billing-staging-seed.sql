-- STAGING ONLY. Run by the database owner against the isolated homesignal-staging project, AFTER docs/paddle-billing.sql, and never against production.
-- Founder decisions of 2026-11-27: (a) no free reports for the existing accounts; (b) one NAMED complimentary exception for the partner contact (a database row
-- with its reason; NOT a $0 Paddle checkout), which never weakens the gate. Idempotent: running it twice changes nothing the second time.
--
-- psql -v ON_ERROR_STOP=1 -v free_reports_mode=none -v complimentary_expiry=none -v partner_email=<her email> -f docs/paddle-billing-staging-seed.sql
--   free_reports_mode      none   = no free reports for any existing account (the only mode built; 'credit' is refused until you choose it)
--   complimentary_expiry   none   = no expiry, or a date such as 2027-01-31 (end of that day, America/Los_Angeles) = a review/expiry date
--   partner_email          the account's sign-in email (kept out of the repository on purpose)
\set ON_ERROR_STOP on
\if :{?free_reports_mode} \else \echo 'REFUSED: set -v free_reports_mode=none'  \quit \endif
\if :{?complimentary_expiry} \else \echo 'REFUSED: set -v complimentary_expiry=none or a date (2027-01-31)' \quit \endif
\if :{?partner_email} \else \echo 'REFUSED: set -v partner_email=<the partner contact''s sign-in email>' \quit \endif

begin;
-- psql does not substitute variables inside a dollar-quoted body, so they are handed to the session first
select set_config('seed.free_reports_mode', :'free_reports_mode', true), set_config('seed.complimentary_expiry', :'complimentary_expiry', true), set_config('seed.partner_email', :'partner_email', true) \gset skip_
do $guard$
begin
  if public.billing_environment_mode() <> 'staging' then
    raise exception 'staging seed: this database is in % mode. This script runs only against the isolated staging database (update public.billing_environment set mode = ''staging'' there first).', public.billing_environment_mode();
  end if;
  if current_setting('seed.free_reports_mode') <> 'none' then
    raise exception 'staging seed: free_reports_mode=% is not built. Only "none" exists; choose and build the credit option deliberately.', current_setting('seed.free_reports_mode');
  end if;
  if current_setting('seed.complimentary_expiry') <> 'none' and current_setting('seed.complimentary_expiry') !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'staging seed: complimentary_expiry must be none or a date like 2027-01-31';
  end if;
end $guard$;

-- (a) no free reports for anyone who holds a promise today; reports already made are untouched
update public.evaluation set free_reports_granted = false where free_reports_granted;

-- (b) the named exception, only for an account that exists; the account must have signed up first (the script never creates an account)
do $comp$
declare
  v_brokerage uuid;
  v_expiry    timestamptz := case when current_setting('seed.complimentary_expiry') = 'none' then null
                                  else ((current_setting('seed.complimentary_expiry'))::date + 1)::timestamp at time zone 'America/Los_Angeles' - interval '1 second' end;
begin
  select m.brokerage_id into v_brokerage
    from auth.users u join public.brokerage_member m on m.user_id = u.id and m.status = 'active'
   where lower(u.email) = lower(current_setting('seed.partner_email')) limit 1;
  if v_brokerage is null then
    raise exception 'staging seed: no active account for that email yet. She must sign up first; nothing was changed.';
  end if;
  if not public.billing_complimentary_active(v_brokerage) then
    perform public.billing_complimentary_grant(v_brokerage, 'partner, approved by founder', 'founder', v_expiry);
  end if;
end $comp$;

-- proof: no existing account holds a promise, the gate is untouched, and exactly the named account is complimentary
do $proof$
begin
  if exists (select 1 from public.evaluation where free_reports_granted) then raise exception 'staging seed: an account still holds a free-report promise'; end if;
  if (select count(*) from public.billing_complimentary where revoked_at is null) <> 1 then raise exception 'staging seed: expected exactly one open complimentary exception'; end if;
end $proof$;
commit;
select 'seed applied: no free reports, one named exception' as result;
