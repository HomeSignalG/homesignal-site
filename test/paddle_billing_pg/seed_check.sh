#!/usr/bin/env bash
# The staging seed (docs/paddle-billing-staging-seed.sql) against the DISPOSABLE database run.sh just built: both named partner exceptions, all or nothing,
# idempotent, refusing outside staging. Sourced by run.sh after the suite (the suite's accounts are the fixtures); never run against anything else.
set -euo pipefail
case "$PGDATABASE" in *disposable*) ;; *) echo "ABORT: PGDATABASE must name a disposable database"; exit 1;; esac
root="$(cd "$(dirname "$0")/../.." && pwd)"; SEED="$root/docs/paddle-billing-staging-seed.sql"
Q() { psql -X -tA -v ON_ERROR_STOP=1 "$@"; }
run() { psql -X -q -v free_reports_mode=none -v complimentary_expiry="${EXP:-2026-12-31}" -v partner_email_1="$1" -v partner_email_2="$2" -f "$SEED" 2>&1 || true; }
ok() { echo "PASS $1"; }; bad() { echo "FAIL $1"; exit 1; }
P1=person1@example.test; P2=person2@example.test; NOBODY=nobody@example.test
# the disposable database holds suite payments, which (rightly) stop the mode being switched; the test lifts that one guard on its own throwaway copy
Q -c "alter table public.billing_environment disable trigger billing_environment_guard" >/dev/null
Q -c "update public.billing_environment set mode = 'production'" >/dev/null
[[ "$(run $P1 $P2)" == *"production mode"* ]] && ok "S1 the seed refuses to run against a production-mode database" || bad "S1"
Q -c "update public.billing_environment set mode = 'staging'" >/dev/null
Q -c "update public.evaluation set free_reports_granted = true where evaluation_id = (select evaluation_id from public.evaluation limit 1)" >/dev/null
[[ "$(run $P1 $NOBODY)" == *"partner email #2 of 2"* ]] && [ "$(Q -c "select count(*) from public.billing_complimentary where revoked_at is null")" = 0 ] && [ "$(Q -c "select count(*) from public.evaluation where free_reports_granted")" -ge 1 ] \
  && ok "S2 a partner with no account yet stops the whole run: no exception for the other one, no promise cleared" || bad "S2"
[[ "$(run $P1 $P1)" == *"must be different"* ]] && [ "$(Q -c "select count(*) from public.billing_complimentary where revoked_at is null")" = 0 ] && ok "S3 the same email twice is refused" || bad "S3"
[[ "$(run $P1 $P2)" == *"two named exceptions"* ]] || bad "S4 apply"
[ "$(Q -c "select count(*) from public.billing_complimentary where revoked_at is null and reason = 'partner, approved by founder' and approved_by = 'founder' and expires_at = '2027-01-01 07:59:59+00'")" = 2 ] \
  && ok "S4 BOTH partners hold a named exception with the reason, the approver and the 2026-12-31 expiry (end of day, Los Angeles)" || bad "S4"
[ "$(Q -c "select count(*) from public.evaluation where free_reports_granted")" = 0 ] && ok "S5 no existing account holds a free-report promise any more" || bad "S5"
Q -c "select public.billing_complimentary_active(m.brokerage_id) from public.brokerage_member m where m.user_id = 'a0000000-0000-4000-8000-000000000001' and m.status = 'active' limit 1" | grep -q t \
  && Q -c "select public.billing_complimentary_active(m.brokerage_id) from public.brokerage_member m where m.user_id = 'a0000000-0000-4000-8000-000000000002' and m.status = 'active' limit 1" | grep -q t \
  && ! Q -c "select public.billing_complimentary_active(m.brokerage_id) from public.brokerage_member m where m.user_id = 'a0000000-0000-4000-8000-000000000004' and m.status = 'active' limit 1" | grep -q t \
  && ok "S6 each partner's account is complimentary and an unrelated account is not" || bad "S6"
[[ "$(run $P1 $P2)" == *"two named exceptions"* ]] && [ "$(Q -c "select count(*) from public.billing_complimentary where revoked_at is null")" = 2 ] && ok "S7 a second run changes nothing (still exactly two)" || bad "S7"
Q -c "update public.billing_environment set mode = 'production'" >/dev/null
Q -c "alter table public.billing_environment enable trigger billing_environment_guard" >/dev/null
