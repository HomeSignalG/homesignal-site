#!/usr/bin/env bash
# Executable suite for Paddle billing and the six-month partner grant (docs/paddle-billing.sql) against a DISPOSABLE Postgres (never production).
# 1. every layer it stands on is applied UNMUTATED in production's order, then the Paddle file, then suite.sql (every check must pass);
# 2. the file applies twice with an identical result;
# 3. it REFUSES, creating nothing, when a layer it stands on is absent;
# 4. each prohibited mutation of the SQL fails >= 1 NAMED check or stops the apply. A mutation whose anchor is missing is a harness failure.
set -euo pipefail
: "${PGHOST:?}" "${PGDATABASE:?}"
case "$PGDATABASE" in *disposable*) ;; *) echo "ABORT: PGDATABASE must name a disposable database (got '$PGDATABASE')"; exit 1;; esac
if [ -n "${SUPABASE_DB_URL:-}${SUPABASE_ACCESS_TOKEN:-}${SUPABASE_WRITE_KEY:-}" ]; then echo "ABORT: a Supabase credential is present"; exit 1; fi
here="$(cd "$(dirname "$0")" && pwd)"; root="$(cd "$here/../.." && pwd)"
. "$root/test/lib/docsql.sh"
P() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }
SQL="${PADDLE_SQL:-$root/docs/paddle-billing.sql}"
DEPS=(brokerage-account-spine report-private-context report-snapshot evaluation-entitlement saved-reports report-share report-share-delivery property-watch payment-event-ledger report-header brokerage-billing saved-reports-archive individual-agent-signup)
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
reset_db() { P -c "drop schema if exists auth cascade; drop schema public cascade; create schema public;" >/dev/null 2>&1; P -f "$root/test/individual_signup_pg/fixture.sql" >/dev/null; }
apply_deps() { local f; for f in "${DEPS[@]}"; do P -f "$(docsql "$f")" >/dev/null 2>"$tmp/dep.err" || { echo "FAIL - docs/$f.sql does not apply"; head -3 "$tmp/dep.err"; exit 1; }; done; }
base() { reset_db; apply_deps; }
suite() { P -tA -F'|' -f "$here/suite.sql"; }
defs() { P -tA -c "select md5(coalesce(string_agg(pg_get_functiondef(p.oid), '|' order by p.oid::regprocedure::text), '')) from pg_proc p where p.pronamespace = 'public'::regnamespace and (p.proname like 'billing\\_%' or p.proname like 'payment\\_event\\_%' or p.proname = 'brokerage_paid_credit_guard')"; }
fails_of() { grep -c '|f|' <<<"$1" || true; }
fail=0; ok() { echo "PASS — $1"; }; bad() { echo "FAIL — $1"; fail=1; }

# ---- 1. the suite on the real SQL -------------------------------------------------------------------------------------------------
base; P -f "$SQL" >/dev/null 2>"$tmp/apply.err" || { echo "FAIL — docs/paddle-billing.sql does not apply"; head -5 "$tmp/apply.err"; exit 1; }
out="$(suite)"; echo "$out" | awk -F'|' '{printf "%s %s\n", ($2=="t"?"PASS":"FAIL"), $1}'
[ "$(fails_of "$out")" = 0 ] && [ "$(grep -c '|t|' <<<"$out")" -ge 27 ] && ok "the suite: every check passes ($(grep -c '|t|' <<<"$out") checks)" || { bad "the suite has failing checks"; echo "$out" | grep '|f|' | head; }

# ---- 2. twice, identical ----------------------------------------------------------------------------------------------------------
base; P -f "$SQL" >/dev/null; D1="$(defs)"; P -f "$SQL" >/dev/null 2>"$tmp/twice.err" && [ "$(defs)" = "$D1" ] && ok "applies twice with an identical definition set" || bad "applying twice changed something"

# ---- 3. refuses without its layers -------------------------------------------------------------------------------------------------
reset_db; if P -f "$SQL" >/dev/null 2>"$tmp/ref.err"; then bad "applied on an empty database"; else grep -q "apply docs/brokerage-billing.sql" "$tmp/ref.err" && ok "refuses without the billing layers" || bad "refused for the wrong reason"; fi

# ---- 4. prohibited mutations ---------------------------------------------------------------------------------------------------------
mutate() {  # name, python expression text replacements: old|new
  local name="$1" old="$2" new="$3" m="$tmp/m.sql"
  python3 - "$SQL" "$m" "$old" "$new" <<'PY' || { echo "HARNESS — anchor missing for $name"; fail=1; return; }
import sys
s=open(sys.argv[1]).read(); old,new=sys.argv[3],sys.argv[4]
if s.count(old)<1: sys.exit(1)
open(sys.argv[2],'w').write(s.replace(old,new,1))
PY
  base
  if ! P -f "$m" >/dev/null 2>"$tmp/m.err"; then echo "KILLED   $name - the apply stopped: $(head -1 "$tmp/m.err" | cut -c1-120)"; return; fi
  local o; o="$(suite 2>"$tmp/m.err")" || { echo "CRASH    $name - the suite crashed (does not count as killed)"; fail=1; return; }
  local n; n="$(fails_of "$o")"
  if [ "$n" -ge 1 ]; then echo "KILLED   $name - $n check(s) failed: $(grep '|f|' <<<"$o" | head -1 | cut -d'|' -f1 | cut -c1-70)"; else bad "SURVIVED $name"; fi
}
mutate no_expired_state "and now() >= ((b.bound_at at time zone 'UTC') + b.access_months * interval '1 month') at time zone 'UTC' then 'expired'" "and false then 'expired'"
mutate no_credit_guard "if b.access_months is not null and new.period_index >= b.access_months then" "if false then"
mutate no_individual_only "and a.account_type = 'individual')" "and true)"
mutate no_length_check "if p_access_months < 1 or p_access_months > 24 then" "if false then"
mutate no_conflict_on_length "if found and b.access_months is distinct from p_access_months then" "if false then"
mutate paddle_completed_unmapped "when 'completed' then 'active'" "when 'completed' then 'unknown'"
mutate lemon_branch_dropped "when p_processor = 'lemonsqueezy' then" "when p_processor = 'lemonsqueezy_x' then"
mutate paddle_canceled_grants "when 'canceled'  then 'canceled'
        when 'refunded'" "when 'canceled'  then 'active'
        when 'refunded'"
mutate usage_hides_end "case when pl.state in ('paid', 'expired') and g.access_months is not null" "case when false and g.access_months is not null"
mutate expiry_a_month_late "and now() >= ((b.bound_at at time zone 'UTC') + b.access_months * interval '1 month')" "and now() >= ((b.bound_at at time zone 'UTC') + (b.access_months + 1) * interval '1 month')"
mutate expiry_a_month_early "case when pl.state in ('paid', 'expired') and g.access_months is not null
              then ((pl.bound_at at time zone 'UTC') + g.access_months * interval '1 month')" "case when pl.state in ('paid', 'expired') and g.access_months is not null
              then ((pl.bound_at at time zone 'UTC') + (g.access_months - 1) * interval '1 month')"
mutate usage_open_to_anon "grant execute on function public.billing_usage(uuid) to service_role;" "grant execute on function public.billing_usage(uuid) to service_role, anon;"
[ "$fail" = 0 ] && echo "ALL PASS" || { echo "FAILURES"; exit 1; }
