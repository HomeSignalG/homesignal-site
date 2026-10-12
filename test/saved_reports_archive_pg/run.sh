#!/usr/bin/env bash
# Executable suite for REMOVE FROM MY LIST (docs/saved-reports-archive.sql) against a DISPOSABLE Postgres (never production).
# It stands on the REAL account spine, private context, snapshot, evaluation entitlement, saved reports, share links, property watch, payment-event
# ledger, header and billing SQL, applied unmutated.
# 1. the shipped SQL passes every check of suite.sql (independence of people, exact sets, all-or-nothing, fail-closed for foreign, unknown, removed and
#    revoked, nothing it must not touch changes, who may call it);
# 2. it applies twice with an identical result, and applying it changes NOTHING it stands on;
# 3. REAL concurrent sessions: two sessions removing the same reports at once, and one removing while the other restores, never error and end in a
#    state one serial order explains; two members racing on different reports never see each other's list change;
# 4. its ROLLBACK (the footer of the file, extracted and run) removes only what it created, with archive rows stored, and leaves every report, ledger
#    row, share and watch as it was; re-applying gives the first apply;
# 5. it REFUSES, creating nothing, when the ownership reader it stands on is absent;
# 6. each prohibited mutation fails >= 1 NAMED check (a mutation that makes the suite CRASH does not count as killed).
set -euo pipefail
: "${PGHOST:?}" "${PGDATABASE:?}"
case "$PGDATABASE" in *disposable*) ;; *) echo "ABORT: PGDATABASE must name a disposable database (got '$PGDATABASE')"; exit 1;; esac
if [ -n "${SUPABASE_DB_URL:-}${SUPABASE_ACCESS_TOKEN:-}${SUPABASE_WRITE_KEY:-}" ]; then echo "ABORT: a Supabase credential is present"; exit 1; fi
here="$(cd "$(dirname "$0")" && pwd)"; root="$(cd "$here/../.." && pwd)"
P() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }
SQL="${ARCHIVE_SQL:-$root/docs/saved-reports-archive.sql}"
DEPS=(brokerage-account-spine report-private-context report-snapshot evaluation-entitlement saved-reports report-share report-share-delivery property-watch payment-event-ledger report-header brokerage-billing report-rate-limit da-owner-safeguards)
reset_db() { P -c "drop schema if exists auth cascade; drop schema public cascade; create schema public;" >/dev/null 2>&1; P -f "$root/test/evaluation_entitlement_pg/fixture.sql" >/dev/null; }
apply_deps() { local f; for f in "${DEPS[@]}"; do P -f "$root/docs/$f.sql" >/dev/null 2>"$here/.dep.err" || { echo "FAIL - docs/$f.sql does not apply"; head -3 "$here/.dep.err"; exit 1; }; done; rm -f "$here/.dep.err"; }
apply_base() { reset_db; apply_deps; }
suite() { P -tA -F'|' -f "$here/suite.sql"; }
rollback_sql() { sed -n '/^-- ROLLBACK-BEGIN$/,/^-- ROLLBACK-END$/p' "$1" | sed '1d;$d' | sed 's/^-- //'; }
MINE="('saved_reports_listed', 'saved_reports_archive_set')"
fp_mine() { P -tA -c "select md5(
    coalesce((select string_agg(pg_get_functiondef(p.oid) || coalesce(p.proacl::text, ''), ',' order by p.proname collate \"C\") from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in $MINE), '')
  || coalesce((select string_agg(column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, '-'), ',' order by column_name collate \"C\") from information_schema.columns where table_schema = 'public' and table_name = 'saved_report_archive'), '')
  || coalesce((select string_agg(pg_get_constraintdef(oid), ',' order by conname collate \"C\") from pg_constraint where conrelid = to_regclass('public.saved_report_archive')), '')
  || coalesce((select c.relacl::text || c.relrowsecurity::text from pg_class c where c.oid = to_regclass('public.saved_report_archive')), ''))"; }
# everything this file stands on and must not touch
fp_deps() { P -tA -c "select md5(
    coalesce((select string_agg(pg_get_functiondef(p.oid) || coalesce(p.proacl::text, ''), ',' order by p.oid::regprocedure::text collate \"C\") from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname not in $MINE), '')
  || coalesce((select string_agg(table_name || ':' || column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, '-'), ',' order by table_name collate \"C\", column_name collate \"C\") from information_schema.columns where table_schema = 'public' and table_name <> 'saved_report_archive'), '')
  || coalesce((select string_agg(c.relname || coalesce(c.relacl::text, '') || c.relrowsecurity::text, ',' order by c.relname collate \"C\") from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relname <> 'saved_report_archive'), ''))"; }
n_mine() { P -tA -c "select (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in $MINE) + (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relname = 'saved_report_archive')"; }

FAILS=0; TOTAL=0
report() { # $1 name  $2 t|f  $3 detail
  TOTAL=$((TOTAL+1)); if [ "$2" = "t" ]; then echo "PASS — $1"; else FAILS=$((FAILS+1)); echo "FAIL — $1  [$3]"; fi; }
run_suite() { local out; out="$(suite 2>&1)" || { echo "FAIL — the suite crashed"; echo "$out" | tail -5; return 1; }; printf '%s\n' "$out"; }
count_fails() { printf '%s\n' "$1" | awk -F'|' 'NF>=2 && $2=="f"{n++} END{print n+0}'; }

# ---- 1. the shipped SQL passes the suite ---------------------------------------------------------------------------------------
apply_base
BEFORE_DEPS="$(fp_deps)"
P -f "$SQL" >/dev/null 2>"$here/.apply.err" || { echo "FAIL — docs/saved-reports-archive.sql does not apply"; head -5 "$here/.apply.err"; exit 1; }
FIRST="$(fp_mine)"
AFTER_DEPS="$(fp_deps)"
report "2a applying it changes nothing it stands on (every other function, column, grant and policy is as it was)" "$([ "$BEFORE_DEPS" = "$AFTER_DEPS" ] && echo t || echo f)" "$BEFORE_DEPS vs $AFTER_DEPS"
report "2b it creates exactly two functions and one table" "$([ "$(n_mine)" = "3" ] && echo t || echo f)" "$(n_mine)"
P -f "$SQL" >/dev/null 2>&1 || { echo "FAIL — it does not apply a second time"; exit 1; }
report "2c it applies twice with an identical result" "$([ "$(fp_mine)" = "$FIRST" ] && echo t || echo f)" ""
apply_base; P -f "$SQL" >/dev/null 2>&1
OUT="$(run_suite)"
printf '%s\n' "$OUT" | awk -F'|' 'NF>=2{ if ($2=="t") print "PASS — " $1; else print "FAIL — " $1 "  [" $3 "]" }'
NS="$(printf '%s\n' "$OUT" | awk -F'|' 'NF>=2' | wc -l)"; NF_="$(count_fails "$OUT")"
TOTAL=$((TOTAL+NS)); FAILS=$((FAILS+NF_))
report "1z the suite ran at least 40 checks (a suite that ran nothing is not a pass)" "$([ "$NS" -ge 40 ] && echo t || echo f)" "$NS"

# ---- 3. real concurrent sessions --------------------------------------------------------------------------------------------------
apply_base; P -f "$SQL" >/dev/null 2>&1
U1='f0000000-0000-4000-8000-000000000001'; U2='f0000000-0000-4000-8000-000000000002'
P -c "insert into auth.users (id, email) values ('$U1', 'c1@example.test'), ('$U2', 'c2@example.test');
      do \$\$ declare c record; t text; n int; b text; begin
        select * into c from public.evaluation_create('Concurrent Realty'); perform 1 from public.evaluation_invite_redeem(c.owner_token, '$U1');
        select m.token into t from public.evaluation_invite_mint(c.evaluation_id, 'agent') m; perform 1 from public.evaluation_invite_redeem(t, '$U2');
        for n in 1..6 loop b := format('{\"product\":\"HomeSignal Development Activity\",\"n\":%s}', n);
          perform * from public.brokerage_report_issue('$U1', ('f1000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, b, encode(sha256(convert_to(b, 'UTF8')), 'hex'), 'engine-v1', '{\"engine\":\"test\"}'::jsonb, null); end loop;
      end \$\$" >/dev/null
IDS="$(P -tA -c "select string_agg(quote_literal(report_id::text) || '::uuid', ',' order by number) from public.evaluation_reports_of('$U1')")"
A1="$(mktemp)"; A2="$(mktemp)"
# session 1 removes all six and HOLDS its transaction; session 2 removes the same six meanwhile (it must wait for, then agree with, session 1)
( P -tA -f - >"$A1" 2>&1 <<SQL
begin;
select 'changed=' || public.saved_reports_archive_set('$U1', array[$IDS], true);
select pg_sleep(2);
commit;
SQL
) &
bg=$!; sleep 0.7
P -tA -c "select 'changed=' || public.saved_reports_archive_set('$U1', array[$IDS], true)" >"$A2" 2>&1 || true
wait "$bg" || true
ROWS="$(P -tA -c "select count(*) from public.saved_report_archive where user_id = '$U1'")"
S1="$(sed -n 's/^changed=//p' "$A1")"; S2="$(sed -n 's/^changed=//p' "$A2")"
report "3a two sessions removing the same six reports at once: neither errors, together they changed exactly six rows ($S1 + $S2), and six rows exist ($ROWS)" \
  "$([ "$ROWS" = "6" ] && [ "$((S1 + S2))" = "6" ] && ! grep -qi 'error' "$A1" "$A2" && echo t || echo f)" "s1=$(tr '\n' ' ' <"$A1") s2=$(tr '\n' ' ' <"$A2")"
rm -f "$A1" "$A2"
# remove (session 1, holding) against restore (session 2): the end state is one serial order's - all six or none, never a mixture
A1="$(mktemp)"; A2="$(mktemp)"
( P -tA -f - >"$A1" 2>&1 <<SQL
begin;
select 'changed=' || public.saved_reports_archive_set('$U1', array[$IDS], false);
select pg_sleep(2);
commit;
SQL
) &
bg=$!; sleep 0.7
P -tA -c "select 'changed=' || public.saved_reports_archive_set('$U1', array[$IDS], true)" >"$A2" 2>&1 || true
wait "$bg" || true
ROWS="$(P -tA -c "select count(*) from public.saved_report_archive where user_id = '$U1'")"
report "3b one session restoring while another removes the same set: no error, and the end state is all six removed or none (a serial order), here $ROWS" \
  "$([ "$ROWS" = "6" ] || [ "$ROWS" = "0" ] && ! grep -qi 'error' "$A1" "$A2" && echo t || echo f)" "rows=$ROWS $(tr '\n' ' ' <"$A1") $(tr '\n' ' ' <"$A2")"
rm -f "$A1" "$A2"
# two different people removing at once never change each other's list
P -c "delete from public.saved_report_archive" >/dev/null
( P -tA -c "select public.saved_reports_archive_set('$U1', array[$IDS], true)" >/dev/null 2>&1 ) &
( P -tA -c "select public.saved_reports_archive_set('$U2', array[$IDS], true)" >/dev/null 2>&1 ) &
wait
R1="$(P -tA -c "select count(*) from public.saved_report_archive where user_id = '$U1'")"; R2="$(P -tA -c "select count(*) from public.saved_report_archive where user_id = '$U2'")"
report "3c two members removing the same reports at once each end with their OWN six rows ($R1, $R2): neither list is the other's" "$([ "$R1" = "6" ] && [ "$R2" = "6" ] && echo t || echo f)" "$R1 $R2"

# ---- 4. the rollback --------------------------------------------------------------------------------------------------------------
BEFORE_ROLL="$(P -tA -c "select md5((select coalesce(string_agg(c::text, ',' order by c.evaluation_id, c.ordinal), '') from public.evaluation_credit c) || (select coalesce(string_agg(s.report_id::text || s.content_hash, ',' order by s.report_id), '') from public.report_snapshot s))")"
rollback_sql "$SQL" >"$here/.rollback.sql"
report "4a the file carries a rollback of exactly two function drops and one table drop" "$([ "$(grep -c '^ *drop' "$here/.rollback.sql")" = "2" ] && echo t || echo f)" "$(cat "$here/.rollback.sql")"
P -f "$here/.rollback.sql" >/dev/null 2>&1 || { report "4b the rollback runs with archive rows stored" f "did not run"; }
AFTER_ROLL="$(P -tA -c "select md5((select coalesce(string_agg(c::text, ',' order by c.evaluation_id, c.ordinal), '') from public.evaluation_credit c) || (select coalesce(string_agg(s.report_id::text || s.content_hash, ',' order by s.report_id), '') from public.report_snapshot s))")"
report "4b the rollback removes everything it created (0 objects left), with archive rows stored" "$([ "$(n_mine)" = "0" ] && echo t || echo f)" "$(n_mine)"
report "4c and leaves every report and ledger row exactly as it was" "$([ "$BEFORE_ROLL" = "$AFTER_ROLL" ] && echo t || echo f)" ""
report "4d the saved-reports reader the product stood on still answers after a rollback" "$([ "$(P -tA -c "select count(*) from public.evaluation_reports_of('$U1')")" = "6" ] && echo t || echo f)" ""
P -f "$here/.rollback.sql" >/dev/null 2>&1 && report "4e the rollback is repeatable" t "" || report "4e the rollback is repeatable" f ""
P -f "$SQL" >/dev/null 2>&1; report "4f applying again after a rollback gives the first apply" "$([ "$(fp_mine)" = "$FIRST" ] && echo t || echo f)" ""
rm -f "$here/.rollback.sql"

# ---- 5. refusal without the ownership reader -----------------------------------------------------------------------------------------
apply_base; P -c "drop function public.evaluation_reports_of(uuid) cascade" >/dev/null 2>&1 || true
if P -f "$SQL" >/dev/null 2>&1; then report "5a it REFUSES when the ownership reader is absent" f "applied"; else report "5a it REFUSES when the ownership reader is absent" "$([ "$(n_mine)" = "0" ] && echo t || echo f)" "partial objects"; fi

# ---- 6. prohibited mutations -------------------------------------------------------------------------------------------------------
KILLED=0; MUT=0
mutate() { # $1 name  $2 python expression body that edits `s`
  MUT=$((MUT+1)); local f="$here/.mut.sql" out n
  SQLIN="$SQL" python3 - "$f" "$2" <<'PY' || { report "6 mutation $1 is applicable (its anchor exists)" f "anchor missing"; return; }
import os, sys
s = open(os.environ['SQLIN']).read(); t = s
exec(sys.argv[2])
if s == t: sys.exit(1)
open(sys.argv[1], 'w').write(s)
PY
  apply_base
  if ! P -f "$f" >/dev/null 2>&1; then KILLED=$((KILLED+1)); report "6 mutation $1 is killed (the apply stops)" t ""; rm -f "$f"; return; fi
  if out="$(P -tA -F'|' -f "$here/suite.sql" 2>&1)"; then n="$(count_fails "$out")"; if [ "$n" -ge 1 ]; then KILLED=$((KILLED+1)); report "6 mutation $1 is killed by $n named check(s): $(printf '%s\n' "$out" | awk -F'|' '$2=="f"{print $1}' | head -2 | cut -c1-70 | tr '\n' ';')" t ""; else report "6 mutation $1 SURVIVED" f "no check failed"; fi
  else report "6 mutation $1 only CRASHED the suite (a crash names nothing)" f "$(printf '%s' "$out" | tail -2)"; fi
  rm -f "$f"
}
mutate no_user_filter_in_list "s = s.replace('where a.user_id = p_user_id and a.report_id = r.report_id', 'where a.report_id = r.report_id')"
mutate list_ignores_archive "s = s.replace('         = coalesce(p_archived, false)', '         = exists (select 1)')"
mutate archived_view_is_default "s = s.replace('= coalesce(p_archived, false)', '<> coalesce(p_archived, false)')"
mutate no_visibility_check "s = s.replace('if v_visible <> v_n then raise exception \\'NOT_FOUND\\'; end if;', 'null;')"
mutate partial_set_allowed "s = s.replace('if v_visible <> v_n then', 'if v_visible = 0 then')"
mutate visibility_not_via_reader "s = s.replace('from public.evaluation_reports_of(p_user_id) r where r.report_id = any (v_ids)', 'from public.report_snapshot r where r.report_id = any (v_ids)')"
mutate restore_deletes_everyone "s = s.replace('delete from public.saved_report_archive where user_id = p_user_id and report_id = any (v_ids);', 'delete from public.saved_report_archive where report_id = any (v_ids);')"
mutate archive_not_idempotent "s = s.replace('on conflict (user_id, report_id) do nothing;', '')"
mutate unbounded_set "s = s.replace('v_n > 100', 'v_n > 100000')"
mutate empty_set_allowed "s = s.replace('v_n < 1 or ', '')"
mutate null_id_allowed "s = s.replace(' or array_position(p_report_ids, null) is not null', '')"
mutate list_open_to_authenticated "s = s.replace('grant execute on function public.saved_reports_listed(uuid, boolean)            to service_role;', 'grant execute on function public.saved_reports_listed(uuid, boolean)            to service_role, authenticated;')"
mutate writer_open_to_anon "s = s.replace('grant execute on function public.saved_reports_archive_set(uuid, uuid[], boolean) to service_role;', 'grant execute on function public.saved_reports_archive_set(uuid, uuid[], boolean) to service_role, anon;')"
mutate table_readable_by_service "s = s.replace('revoke all on table public.saved_report_archive from public, anon, authenticated, service_role;', 'revoke all on table public.saved_report_archive from public, anon, authenticated;')"
mutate rls_off "s = s.replace('alter table public.saved_report_archive enable row level security;', '')"
mutate account_delete_blocks "s = s.replace('references auth.users (id) on delete cascade', 'references auth.users (id)')"
mutate snapshot_cascade "s = s.replace('references public.report_snapshot (report_id)', 'references public.report_snapshot (report_id) on delete cascade')"
mutate writer_refunds_a_credit "s = s.replace('  get diagnostics v_changed = row_count;', '  get diagnostics v_changed = row_count;\\n  delete from public.evaluation_credit where report_id = any (v_ids);')"
mutate archive_stops_the_share "s = s.replace('  get diagnostics v_changed = row_count;', '  get diagnostics v_changed = row_count;\\n  update public.report_share set revoked_at = now() where report_id = any (v_ids);')"
mutate list_is_volatile "s = s.replace('language sql stable security definer', 'language sql volatile security definer', 1)"
report "6z at least 15 mutations ran, and every one was killed ($KILLED of $MUT)" "$([ "$MUT" -ge 15 ] && [ "$KILLED" = "$MUT" ] && echo t || echo f)" "$KILLED/$MUT"

echo
echo "$((TOTAL - FAILS)) passed, $FAILS failed of $TOTAL"
[ "$FAILS" = "0" ]
