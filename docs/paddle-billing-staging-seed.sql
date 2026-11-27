-- STAGING ONLY. Run by the database owner against the isolated homesignal-staging project, AFTER docs/paddle-billing.sql, and never against production.
-- Founder decisions of 2026-11-27: (a) no free reports for the existing accounts; (b) two NAMED complimentary exceptions for partner contacts (database rows
-- with their reason; NOT $0 Paddle checkouts), which never weaken the gate. Idempotent: running it twice changes nothing the second time. All or nothing: if either
-- partner has no account yet, nothing is changed.
--
-- psql -v ON_ERROR_STOP=1 -v free_reports_mode=none -v complimentary_expiry=2027-01-31 -v partner_email_1=<first email> -v partner_email_2=<second email> -f docs/paddle-billing-staging-seed.sql
--   free_reports_mode      none   = no free reports for any existing account (the only mode built; 'credit' is refused)
--   complimentary_expiry   none   = no expiry, or a date such as 2027-01-31 (end of that day, America/Los_Angeles) = a review/expiry date, the same for both
--   partner_email_1/_2     the two partner contacts' sign-in emails (kept out of the repository on purpose); they must be different people
\set ON_ERROR_STOP on
\if :{?free_reports_mode} \else \echo 'REFUSED: set -v free_reports_mode=none'  \quit \endif
\if :{?complimentary_expiry} \else \echo 'REFUSED: set -v complimentary_expiry=none or a date (2027-01-31)' \quit \endif
\if :{?partner_email_1} \else \echo 'REFUSED: set -v partner_email_1=<first partner contact''s sign-in email>' \quit \endif
\if :{?partner_email_2} \else \echo 'REFUSED: set -v partner_email_2=<second partner contact''s sign-in email>' \quit \endif

begin;
-- psql does not substitute variables inside a dollar-quoted body, so they are handed to the session first
select set_config('seed.free_reports_mode', :'free_reports_mode', true), set_config('seed.complimentary_expiry', :'complimentary_expiry', true), set_config('seed.partner_email_1', :'partner_email_1', true), set_config('seed.partner_email_2', :'partner_email_2', true) \gset skip_
do $guard$
begin
  if public.billing_environment_mode() <> 'staging' then
    raise exception 'staging seed: this database is in % mode. This script runs only against the isolated staging database (update public.billing_environment set mode = ''staging'' there first).', public.billing_environment_mode();
  end if;
  if lower(btrim(current_setting('seed.partner_email_1'))) = lower(btrim(current_setting('seed.partner_email_2'))) then
    raise exception 'staging seed: the two partner emails must be different';
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

-- (b) the named exceptions, only for accounts that exist; each partner must have signed up first (the script never creates an account). Both or neither.
do $comp$
declare
  v_brokerage uuid;
  v_email     text;
  v_expiry    timestamptz := case when current_setting('seed.complimentary_expiry') = 'none' then null
                                  else ((current_setting('seed.complimentary_expiry'))::date + 1)::timestamp at time zone 'America/Los_Angeles' - interval '1 second' end;
begin
  foreach v_email in array array[current_setting('seed.partner_email_1'), current_setting('seed.partner_email_2')] loop
    select m.brokerage_id into v_brokerage
      from auth.users u join public.brokerage_member m on m.user_id = u.id and m.status = 'active'
     where lower(u.email) = lower(btrim(v_email)) limit 1;
    if v_brokerage is null then
      raise exception 'staging seed: no active account yet for partner email #% of 2. Each partner must sign up first; nothing was changed.', array_position(array[current_setting('seed.partner_email_1'), current_setting('seed.partner_email_2')], v_email);
    end if;
    if not public.billing_complimentary_active(v_brokerage) then
      perform public.billing_complimentary_grant(v_brokerage, 'partner, approved by founder', 'founder', v_expiry);
    end if;
  end loop;
end $comp$;

-- proof: no existing account holds a promise, the gate is untouched, and exactly the named account is complimentary
do $proof$
begin
  if exists (select 1 from public.evaluation where free_reports_granted) then raise exception 'staging seed: an account still holds a free-report promise'; end if;
  if (select count(*) from public.billing_complimentary where revoked_at is null) <> 2 then raise exception 'staging seed: expected exactly two open complimentary exceptions'; end if;
end $proof$;
commit;
select 'seed applied: no free reports, two named exceptions' as result;
