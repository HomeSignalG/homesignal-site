#!/usr/bin/env bash
# Executable suite for PAID-ONLY individual signup (docs/paid-only-individual-signup.sql) against a DISPOSABLE Postgres (never production).
# 1. every layer is applied UNMUTATED in production's order (the Paddle billing file included); LEGACY accounts are seeded and fingerprinted;
#    THEN the file is applied and the legacy rows must be byte-identical; then suite.sql (every check must pass);
# 2. the file applies twice with an identical result; it REFUSES, changing nothing, when a layer is absent or an anchor moved;
# 3. each prohibited mutation fails >= 1 NAMED check or stops the apply. A mutation whose anchor is missing is a harness failure.
set -euo pipefail
: "${PGHOST:?}" "${PGDATABASE:?}"
case "$PGDATABASE" in *disposable*) ;; *) echo "ABORT: PGDATABASE must name a disposable database (got '$PGDATABASE')"; exit 1;; esac
if [ -n "${SUPABASE_DB_URL:-}${SUPABASE_ACCESS_TOKEN:-}${SUPABASE_WRITE_KEY:-}" ]; then echo "ABORT: a Supabase credential is present"; exit 1; fi
here="$(cd "$(dirname "$0")" && pwd)"; root="$(cd "$here/../.." && pwd)"
. "$root/test/lib/docsql.sh"
P() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }
SQL="${PAID_ONLY_SQL:-$root/docs/paid-only-individual-signup.sql}"
DEPS=(brokerage-account-spine report-private-context report-snapshot evaluation-entitlement saved-reports report-share report-share-delivery property-watch payment-event-ledger report-header brokerage-billing saved-reports-archive individual-agent-signup paddle-billing)
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
reset_db() { P -c "drop schema if exists auth cascade; drop schema public cascade; create schema public;" >/dev/null 2>&1; P -f "$root/test/individual_signup_pg/fixture.sql" >/dev/null; }
apply_deps() { local f; for f in "${DEPS[@]}"; do P -f "$(docsql "$f")" >/dev/null 2>"$tmp/dep.err" || { echo "FAIL - docs/$f.sql does not apply"; head -3 "$tmp/dep.err"; exit 1; }; done; }
seed_legacy() {
  P >/dev/null <<'SQL'
insert into auth.users (id, email, email_confirmed_at) select ('a0000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'l' || n || '@t.test', now() from unnest(array[1,2,5]) n;
select public.individual_signup('a0000000-0000-4000-8000-000000000001', 'Legacy Agent 1');
select public.individual_signup('a0000000-0000-4000-8000-000000000002', 'Legacy Agent 2');
create temp table t as select * from public.evaluation_create('Legacy Team');
select public.evaluation_invite_redeem((select owner_token from t), 'a0000000-0000-4000-8000-000000000005');
do $$ declare i int; b text; begin for i in 1..2 loop b := format('{"l":%s}', i);
  perform public.brokerage_report_issue('a0000000-0000-4000-8000-000000000001', ('e0000000-0000-4000-8000-0000000000' || lpad((60+i)::text,2,'0'))::uuid, b, encode(sha256(convert_to(b,'UTF8')),'hex'), 'engine-v1', '{"engine":"test"}'::jsonb, null); end loop; end $$;
SQL
}
fp() { P -tA -c "select md5(coalesce(string_agg(e::text, '|' order by e.evaluation_id), '')) from (select evaluation_id, brokerage_id, status, seat_limit from public.evaluation) e" ; }
credfp() { P -tA -c "select md5(coalesce(string_agg(c::text, '|' order by c.evaluation_id, c.ordinal), '')) from public.evaluation_credit c"; }
suite() { P -tA -F'|' -f "$here/suite.sql"; }
defs() { P -tA -c "select md5(coalesce(string_agg(pg_get_functiondef(p.oid), '|' order by p.oid::regprocedure::text), '')) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('individual_signup','evaluation_report_issue','evaluation_usage')"; }
fails_of() { grep -c '|f|' <<<"$1" || true; }
fail=0; ok() { echo "PASS — $1"; }; bad() { echo "FAIL — $1"; fail=1; }
base() { reset_db; apply_deps; seed_legacy; }

# ---- 1. legacy rows unchanged, then the suite -------------------------------------------------------------------------------------
base; F0="$(fp)"; C0="$(credfp)"
P -f "$SQL" >/dev/null 2>"$tmp/apply.err" || { echo "FAIL — docs/paid-only-individual-signup.sql does not apply"; head -5 "$tmp/apply.err"; exit 1; }
[ "$(fp)" = "$F0" ] && [ "$(credfp)" = "$C0" ] && ok "the legacy evaluations and every free credit are byte-identical after the apply" || bad "a legacy row changed"
out="$(suite)"; echo "$out" | awk -F'|' '{printf "%s %s\n", ($2=="t"?"PASS":"FAIL"), $1}'
[ "$(fails_of "$out")" = 0 ] && [ "$(grep -c '|t|' <<<"$out")" -ge 20 ] && ok "the suite: every check passes ($(grep -c '|t|' <<<"$out") checks)" || { bad "the suite has failing checks"; echo "$out" | grep '|f|' | head; }

# ---- 2. twice, identical; refuses without its layers ----------------------------------------------------------------------------------
base; P -f "$SQL" >/dev/null; D1="$(defs)"; P -f "$SQL" >/dev/null 2>"$tmp/twice.err" && [ "$(defs)" = "$D1" ] && ok "applies twice with an identical definition set" || bad "applying twice changed something"
reset_db; if P -f "$SQL" >/dev/null 2>"$tmp/ref.err"; then bad "applied on an empty database"; else grep -q "apply docs/evaluation-entitlement.sql" "$tmp/ref.err" && ok "refuses without the layers it stands on" || bad "refused for the wrong reason"; fi
base; python3 - "$SQL" "$tmp/anchor.sql" <<'PY'
import sys
s=open(sys.argv[1]).read(); o="insert into public.evaluation (brokerage_id, seat_limit) values (v_acct, 0)"
open(sys.argv[2],'w').write(s.replace(o,"insert into public.evaluation (brokerage_id, seat_limit) values (v_acct, 0) /*moved*/ ,",1).replace("'insert into public.evaluation (brokerage_id, seat_limit) values (v_acct, 0)'","'insert into public.evaluation (brokerage_id, seat_limit) values (v_acct, 1)'"))
PY
D2="$(defs)"; if P -f "$tmp/anchor.sql" >/dev/null 2>"$tmp/anc.err"; then bad "applied although individual_signup's anchor was absent"; else [ "$(defs)" = "$D2" ] && grep -q "expected exactly 1" "$tmp/anc.err" && ok "a moved anchor refuses, changing nothing" || bad "a moved anchor refused for the wrong reason or left a change"; fi

# ---- 3. prohibited mutations --------------------------------------------------------------------------------------------------------
mutate() {  # name old new
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
mutate signup_still_free "'insert into public.evaluation (brokerage_id, seat_limit, free_reports) values (v_acct, 0, false)'" "'insert into public.evaluation (brokerage_id, seat_limit, free_reports) values (v_acct, 0, true)'"
mutate no_issue_guard "if not ev.free_reports then" "if false then"
mutate usage_still_shows_free "case when e.free_reports then public.evaluation_report_limit() else 0 end, u.n," "public.evaluation_report_limit(), u.n,"
mutate existing_accounts_lose_free "add column if not exists free_reports boolean not null default true" "add column if not exists free_reports boolean not null default false"
mutate guard_after_charge "message = ''EVALUATION_COMPLETE'';   -- a paid-only" "message = ''NOT_ENTITLED'';   -- a paid-only"
[ "$fail" = 0 ] && echo "ALL PASS" || { echo "FAILURES"; exit 1; }
