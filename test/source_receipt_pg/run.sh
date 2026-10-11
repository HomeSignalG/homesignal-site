#!/usr/bin/env bash
# docs/dev-source-receipt.sql on a DISPOSABLE Postgres: receipts are positive, generation-linked, fail-closed.
set -euo pipefail
: "${PGHOST:?}" "${PGDATABASE:?}"
case "$PGDATABASE" in *disposable*) ;; *) echo "ABORT: PGDATABASE must name a disposable database (got '$PGDATABASE')"; exit 1;; esac
here="$(cd "$(dirname "$0")" && pwd)"; root="$here/../.."
P() { psql -X -qtA -v ON_ERROR_STOP=1 "$@"; }
Q() { P -c "$1"; }
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
n=0; bad=0
t() { n=$((n+1)); if [ "$2" = "$3" ]; then echo "  $1|t"; else echo "  $1|f|got=[$2] want=[$3]"; bad=$((bad+1)); fi; }

build() { # $1 = sql file under test
  P -c "drop schema if exists public cascade; create schema public;" >/dev/null 2>&1
  P -f "$here/fixture.sql" >/dev/null
  sed -n '/^create or replace function public.dev_failed_sources/,/^\$\$;/p' "$root/docs/dev-refresh-source-failure-guard.sql" | P >/dev/null   # the REAL failure authority
  P -f "$1" >/dev/null
}
payload() { # zip arcgis_reports(json)
  echo "{\"zip\":\"$1\",\"mode\":\"zip\",$2}"
}
put() { # id status zip created content
  P -c "insert into net._http_response values ($1,$2,'$5'::text,'$4')" >/dev/null
  P -c "insert into public.development_reports values ('$3','$6',$1) on conflict (zip) do update set refreshed_at='$6', last_collected_response_id=$1" >/dev/null
}
run_checks() {
  local f="$1"
  build "$f"
  EXP='{"registry_id":"a-exp","fetched":5,"quarantined":[],"truncated_at_max_rows":null,"scope_receipt":{"scope":"expanded","version":"v1:K","complete":true}}'
  EXPI='{"registry_id":"b-inc","fetched":5,"quarantined":[],"truncated_at_max_rows":null,"scope_receipt":{"scope":"expanded","version":"v1:K","complete":false}}'
  FB='{"registry_id":"c-fb","fetched":3,"quarantined":[{"reason":"polygon membership unavailable (x)","sample":"s"}],"scope_receipt":{"scope":"fallback","version":null,"complete":false}}'
  FAIL='{"registry_id":"d-fail","fetched":0,"quarantined":[{"reason":"fetch failed: reset","sample":"s"}]}'
  LEG='{"registry_id":"e-leg","fetched":9,"quarantined":[],"truncated_at_max_rows":null}'
  TRUNC='{"registry_id":"f-trunc","fetched":9,"quarantined":[],"truncated_at_max_rows":20000}'
  NOVER='{"registry_id":"g-nover","fetched":1,"quarantined":[],"scope_receipt":{"scope":"expanded","version":null,"complete":true}}'
  # accepted: the cache was written after the response arrived
  put 101 200 71001 '2026-10-11 10:00+00' "$(payload 71001 "\"arcgis_reports\":[$EXP,$EXPI,$FB,$FAIL],\"csv_reports\":[$LEG,$TRUNC,$NOVER]")" '2026-10-11 10:00:30+00'
  # refused: the cache clock is OLDER than the response
  put 102 200 71002 '2026-10-11 10:00+00' "$(payload 71002 "\"arcgis_reports\":[$EXP]")" '2026-10-09 10:00:30+00'
  # lost: the cursor names a response that is gone
  P -c "insert into public.development_reports values ('71003','2026-10-11 10:00+00',999)" >/dev/null
  # non-200
  put 104 500 71004 '2026-10-11 10:00+00' '{}' '2026-10-11 10:00:30+00'
  t 'V01 first collection processes every unprocessed ZIP' "$(Q "select public.dev_refresh_receipts_collect()")" 4
  t 'V02 a second call finds nothing to do (idempotent, markers stop re-reads)' "$(Q "select public.dev_refresh_receipts_collect()")" 0
  s() { Q "select coalesce(scope||':'||coalesce(scope_version,'-')||':'||complete,'(none)') from public.dev_refresh_source_receipt where zip='71001' and registry_id='$1'"; }
  t 'V03 expanded + complete keeps its version' "$(s a-exp)" 'expanded:v1:K:true'
  t 'V04 expanded + INCOMPLETE is stored incomplete' "$(s b-inc)" 'expanded:v1:K:false'
  t 'V05 a fallback is a fallback with no version' "$(s c-fb)" 'fallback:-:false'
  t 'V06 a failed fetch is FAILED (from the existing failure authority), never legacy' "$(s d-fail)" 'failed:-:false'
  t 'V07 a connector with no receipt is legacy, complete = not truncated' "$(s e-leg)" 'legacy:-:true'
  t 'V08 …and a truncated one is legacy + incomplete' "$(s f-trunc)" 'legacy:-:false'
  t 'V09 an expanded claim WITHOUT a version is demoted, never stored as expanded' "$(s g-nover)" 'legacy:-:false'
  t 'V10 every receipt of an accepted write carries the cache clock as tick_at' "$(Q "select count(*) from public.dev_refresh_source_receipt where zip='71001' and registry_id<>'' and tick_at='2026-10-11 10:00:30+00'")" 7
  t 'V11 a REFUSED write leaves no source receipt, only a refused marker' "$(Q "select string_agg(registry_id||':'||scope,',') from public.dev_refresh_source_receipt where zip='71002'")" ':refused'
  t 'V12 a VANISHED response leaves only a lost marker (the ledger then has no evidence)' "$(Q "select string_agg(registry_id||':'||scope,',') from public.dev_refresh_source_receipt where zip='71003'")" ':lost'
  t 'V13 a non-200 response is lost, not receipted' "$(Q "select string_agg(registry_id||':'||scope,',') from public.dev_refresh_source_receipt where zip='71004'")" ':lost'
  t 'V14 the health view reports a receipt only as describing the CURRENT cache when the clocks are equal' "$(Q "select count(*) from public.dev_source_receipt_current where zip='71001' and describes_current_cache")" 7
  # a newer accepted generation supersedes
  put 201 200 71001 '2026-10-11 12:00+00' "$(payload 71001 "\"arcgis_reports\":[$EXP]")" '2026-10-11 12:00:30+00'
  Q "select public.dev_refresh_receipts_collect()" >/dev/null
  t 'V15 a newer generation: the view shows the newest receipt per source and flags the older source rows as NOT describing the cache' "$(Q "select count(*) from public.dev_source_receipt_current where zip='71001' and describes_current_cache")" 1
  t 'V16 …and the source absent from the newest generation no longer describes the cache' "$(Q "select count(*) from public.dev_source_receipt_current where zip='71001' and registry_id='b-inc' and not describes_current_cache")" 1
  # pruning
  Q "update public.dev_refresh_source_receipt set recorded_at = now() - interval '8 days' where response_id = 101" >/dev/null
  Q "select public.dev_refresh_receipts_collect()" >/dev/null
  t 'V17 receipts older than 7 days are pruned' "$(Q "select count(*) from public.dev_refresh_source_receipt where response_id = 101")" 0
  # safety
  t 'V18 nothing here is reachable by anon / authenticated' "$(Q "select (not has_table_privilege('anon','public.dev_refresh_source_receipt','select') and not has_table_privilege('authenticated','public.dev_refresh_source_receipt','select') and not has_function_privilege('anon','public.dev_refresh_receipts_collect(integer)','execute') and not has_function_privilege('authenticated','public.dev_source_receipts(jsonb)','execute'))::text")" true
  t 'V19 RLS is on' "$(Q "select relrowsecurity::text from pg_class where oid='public.dev_refresh_source_receipt'::regclass")" true
  t 'V20 the file does not touch dev_refresh_collect' "$(grep -c 'create or replace function public.dev_refresh_collect' "$f")" 0
}

out="$(run_checks "$root/docs/dev-source-receipt.sql" 2>&1)"; echo "$out"
total=$(grep -c '|' <<<"$out"); fail=$(grep -c '|f|' <<<"$out" || true)
echo "SHIPPED: $total checks, $fail failed"
if [ "$total" -lt 20 ] || [ "$fail" -ne 0 ]; then echo "FAIL"; exit 1; fi
# every prohibited mutation must fail the suite
mut() { # name sed-expr
  sed "$2" "$root/docs/dev-source-receipt.sql" > "$tmp/m.sql"
  cmp -s "$tmp/m.sql" "$root/docs/dev-source-receipt.sql" && { echo "HARNESS: mutation $1 did not apply"; bad=1; return; }
  o="$(run_checks "$tmp/m.sql" 2>&1 || true)"
  if [ "$(grep -c '|f|' <<<"$o")" -gt 0 ] || grep -q 'ERROR' <<<"$o"; then echo "KILLED   $1"; else echo "SURVIVED $1"; bad=1; fi
}
mut refused_treated_as_accepted "s/z.refreshed_at < resp.created then/false then/"
mut failed_authority_ignored "s/when r->>'registry_id' in (select f.registry_id from public.dev_failed_sources(j) f) then 'failed'/when false then 'failed'/"
mut absence_is_completeness "s/else r->>'truncated_at_max_rows' is null end,/else true end,/"
mut unversioned_expanded_kept "s/case when s.scope = 'expanded' and s.scope_version is null then 'legacy' else s.scope end/s.scope/"
mut version_dropped "s/case when r->>'registry_id' not in (select f.registry_id from public.dev_failed_sources(j) f)/case when false/"
mut no_prune "s/delete from public.dev_refresh_source_receipt where recorded_at/delete from public.dev_refresh_source_receipt where false and recorded_at/"
mut no_marker "s/values (z.zip, '', z.rid, coalesce(z.refreshed_at, now()), 'refused', false) on conflict do nothing;/values (z.zip, 'x', z.rid, coalesce(z.refreshed_at, now()), 'refused', false) on conflict do nothing;/"
mut open_to_anon "s/revoke all on public.dev_refresh_source_receipt from public, anon, authenticated, service_role;/grant select on public.dev_refresh_source_receipt to anon;/"
[ "$bad" -eq 0 ] || { echo "FAIL — a mutation survived or a harness fault"; exit 1; }
echo "all passed"
