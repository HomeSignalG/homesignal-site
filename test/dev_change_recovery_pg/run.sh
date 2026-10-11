#!/usr/bin/env bash
# Executable suite for docs/dev-change-recovery.sql (historical-recovery protection) on a DISPOSABLE Postgres.
# 1. every scenario passes; 2. applying twice is identical; 3. it REFUSES (changing nothing) on a drifted body,
# a half-applied pair and a broken anchor; 4. each prohibited mutation fails >= 1 check.
set -euo pipefail
: "${PGHOST:?}" "${PGDATABASE:?}"
case "$PGDATABASE" in *disposable*) ;; *) echo "ABORT: PGDATABASE must name a disposable database (got '$PGDATABASE')"; exit 1;; esac
here="$(cd "$(dirname "$0")" && pwd)"; root="$(cd "$here/../.." && pwd)"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
P() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }
Q() { P -tA -c "$1"; }
SQL="$root/docs/dev-change-recovery.sql"
emit() { printf '%s|%s|%s\n' "$1" "$2" "${3:-}"; }
tf() { if [ "$2" = "$3" ]; then emit "$1" t "$2"; else emit "$1" f "got [$2] want [$3]"; fi; }

apply_base() {
  P -c "drop schema if exists public cascade; create schema public;" >/dev/null 2>&1
  P -f "$root/test/dev_change_ledger_pg/fixture.sql" >/dev/null
  P -f "$root/test/dev_change_baseline_pg/fixture.sql" >/dev/null
  for d in dev-change-ledger dev-change-baseline dev-change-reportable; do
    P -f "$root/docs/$d.sql" >/dev/null 2>&1 || { echo "FAIL — docs/$d.sql does not apply"; exit 1; }
  done
  # the REAL identity function, extracted from its file (not retyped)
  sed -n '/^create or replace function public.app_source_key(el jsonb)/,/^\$\$;/p' "$root/docs/app-projects-stable-key-migration.sql" > "$tmp/key.sql"
  sed -n '/^create or replace function public.app_source_key_basis(el jsonb)/,/^\$\$;/p' "$root/docs/app-projects-stable-key-migration.sql" >> "$tmp/key.sql"
  P -f "$tmp/key.sql" >/dev/null
  P -f "$here/fixture.sql" >/dev/null
}
apply_file() { P -1 -f "$1" >/dev/null 2>"$tmp/err"; }
fp() { Q "select md5(coalesce((select string_agg(pg_get_functiondef(p.oid), '' order by p.proname collate \"C\") from pg_proc p where p.proname in ('dev_change_observe_zip','dev_change_tick')),'') || pg_get_viewdef('public.dev_change_event_reportable'::regclass))"; }

checks() {
  local f="$1" fp1 fp2 pre
  apply_base
  # the base must be what the file was written against (the same fingerprints the file asserts)
  tf 'A00 the repo ledger SQL reproduces the live observe_zip body' "$(Q "select md5(prosrc) from pg_proc where proname='dev_change_observe_zip'")" '042ce94641c713c6c0b6e7d18c4addb6'
  tf 'A00b … and the live tick body' "$(Q "select md5(prosrc) from pg_proc where proname='dev_change_tick'")" '59ce03a97d78ca872735d613d286c991'
  if ! apply_file "$f"; then emit 'apply' f "does not apply: $(tr '\n' ' ' <"$tmp/err" | head -c 400)"; return 0; fi
  if ! P -tA -F'|' -f "$here/suite.sql" 2>"$tmp/suite_err"; then
    emit 'suite' f "the suite CRASHED: $(tr '\n' ' ' <"$tmp/suite_err" | head -c 300)"
  fi
  conc_check
  # idempotence
  apply_base; apply_file "$f" || true; fp1="$(fp)"
  if apply_file "$f"; then fp2="$(fp)"; else fp2="re-apply refused: $(tr '\n' ' ' <"$tmp/err" | head -c 200)"; fi
  tf 'A01 applying twice changes nothing' "$([ "$fp1" = "$fp2" ] && echo same || echo "$fp1 vs $fp2")" 'same'
  # the splices are PURE INSERTIONS: excising them is proven inside the file; here, that the bodies are NOT the originals
  tf 'A02 observe_zip is changed' "$([ "$(Q "select md5(prosrc) from pg_proc where proname='dev_change_observe_zip'")" != 042ce94641c713c6c0b6e7d18c4addb6 ] && echo y || echo n)" 'y'
  # refusals leave the database as it was
  apply_base; pre="$(fp)"
  Q "create or replace function public.dev_change_tick(p_run uuid, p_max_zips integer, p_max_seconds integer, p_ledger_budget_mb bigint, p_verified_free_disk_mb bigint default null, p_min_interval_hours integer default 24) returns jsonb language sql as \$\$ select '{}'::jsonb \$\$" >/dev/null
  if apply_file "$f"; then emit 'A03 refuses when the live tick is not the body it was written against' f 'it applied'; else
    tf 'A03 refuses when the live tick is not the body it was written against' "$(grep -c 'written against 59ce03a9' "$tmp/err")" '1'; fi
  apply_base; Q "create or replace function public.dev_change_observe_zip(p_zip text, p_run uuid) returns jsonb language sql as \$\$ select '{}'::jsonb \$\$" >/dev/null
  if apply_file "$f"; then emit 'A04 refuses when the live observe_zip drifted' f 'it applied'; else
    tf 'A04 refuses when the live observe_zip drifted' "$(grep -c 'written against 042ce946' "$tmp/err")" '1'; fi
  apply_base; apply_file "$f" || true
  Q "create or replace function public.dev_change_tick(p_run uuid, p_max_zips integer, p_max_seconds integer, p_ledger_budget_mb bigint, p_verified_free_disk_mb bigint default null, p_min_interval_hours integer default 24) returns jsonb language sql as \$\$ select '{}'::jsonb \$\$" >/dev/null
  if apply_file "$f"; then emit 'A05 refuses a half-applied pair' f 'it applied'; else
    tf 'A05 refuses a half-applied pair' "$(grep -c 'half-applied' "$tmp/err")" '1'; fi
}

# CONCURRENCY: a collector write landing WHILE the probe runs must not split the probe's snapshot. The probe is one
# statement, and dev_sites_deduped is STABLE SQL as in production, so it reads the caller's snapshot even while a slow
# helper lets another session commit. A POSITIVE CONTROL swaps in a volatile plpgsql helper (the shape that would split):
# the same scenario then returns a result that contradicts the probe's own clock, so the check can fail.
conc_check() {
  local a b
  P -c "select public.sim_refresh('76270', jsonb_build_array(public.sim_site('C1','Issued','2024-01-01', true)), now() - interval '2 hours')" >/dev/null
  ( PGOPTIONS="-c test.dsd_sleep=2" psql -X -qtA -F'|' -c "select synchronized, reason, stamped_keys from public.dev_change_recovery_probe('76270', array['arcgis:fixture:C1'])" > "$tmp/conc_a" 2>&1 ) &
  sleep 0.7
  P -c "update public.development_reports set sites = '[]'::jsonb, refreshed_at = now() where zip='76270'" >/dev/null
  wait
  a="$(cat "$tmp/conc_a")"
  tf 'C01 a collector write landing DURING the probe does not split its snapshot (clock, rows and stamps agree)' "$a" 't|ok|{arcgis:fixture:C1}'
  tf 'C02 …and the NEXT probe sees the write: the ZIP is no longer synchronised' "$(Q "select reason from public.dev_change_recovery_probe('76270', '{}')")" 'rows_not_from_current_cache'
  # positive control: a volatile, per-statement-snapshot helper WOULD split it
  P -c "create or replace function public.dev_sites_deduped(p_zip text) returns table (el jsonb) language plpgsql volatile as \$\$ begin perform pg_sleep(nullif(current_setting('test.dsd_sleep', true), '')::float8); return query select e from public.development_reports d, jsonb_array_elements(d.sites) e where d.zip = p_zip; end \$\$" >/dev/null
  P -c "select public.sim_refresh('76271', jsonb_build_array(public.sim_site('C2','Issued','2024-01-01', true)), now() - interval '2 hours')" >/dev/null
  ( PGOPTIONS="-c test.dsd_sleep=2" psql -X -qtA -F'|' -c "select synchronized, reason, stamped_keys from public.dev_change_recovery_probe('76271', array['arcgis:fixture:C2'])" > "$tmp/conc_b" 2>&1 ) &
  sleep 0.7
  P -c "update public.development_reports set sites = '[]'::jsonb, refreshed_at = now() where zip='76271'" >/dev/null
  wait
  b="$(cat "$tmp/conc_b")"
  tf 'C03 CONTROL: a volatile helper splits the snapshot (this scenario can detect a split)' "$([ "$b" != 't|ok|{arcgis:fixture:C2}' ] && echo split || echo "not-detected: $b")" 'split'
  # restore the production-shaped helper
  P -f "$here/fixture.sql" >/dev/null 2>&1 || true
  # a SOURCE RECEIPT committed by the receipt collector DURING the probe is not seen by that probe (one snapshot with the cache and
  # the rows it judged), and is seen by the next one
  P -c "select public.sim_refresh('76272', jsonb_build_array(public.sim_site('C4','Issued','2024-01-01', true, null, 'cz')), now() - interval '2 hours', true, '[]'::jsonb)" >/dev/null
  ( PGOPTIONS="-c test.dsd_sleep=2" psql -X -qtA -F'|' -c "select jsonb_array_length(sources) from public.dev_change_recovery_probe('76272', '{}', true)" > "$tmp/conc_c" 2>&1 ) &
  sleep 0.7
  P -c "select public.sim_rcpt('76272', 'cz', 'expanded', true)" >/dev/null
  wait
  tf 'C04 a receipt committed DURING the probe does not leak into it (readiness is judged on one consistent snapshot)' "$(cat "$tmp/conc_c")" '0'
  tf 'C05 …and the NEXT probe sees it' "$(Q "select jsonb_array_length(sources) from public.dev_change_recovery_probe('76272', '{}', true)")" '1'
}

emit_mut() { :; }
out="$(checks "$SQL")"; echo "$out" | sed 's/^/  /'
n_all=$(grep -c '|' <<<"$out"); n_fail=$(grep -c '|f|' <<<"$out" || true)
echo "SHIPPED: $n_all checks, $n_fail failed"
if [ "$n_all" -lt 107 ] || [ "$n_fail" -ne 0 ]; then echo "FAIL — the shipped SQL does not pass"; exit 1; fi

status=0
for m in "$here"/mutations/*.py; do
  name="$(basename "$m" .py)"
  python3 "$m" "$SQL" > "$tmp/mut.sql" || { echo "HARNESS FAILURE — mutation $name did not apply (anchor missing)"; status=1; continue; }
  cmp -s "$SQL" "$tmp/mut.sql" && { echo "HARNESS FAILURE — mutation $name changed nothing"; status=1; continue; }
  mo="$(checks "$tmp/mut.sql" || true)"; nf=$(grep -c '|f|' <<<"$mo" || true)
  if [ "$nf" -gt 0 ]; then echo "KILLED   $name — $nf check(s) failed"; else echo "SURVIVED $name"; status=1; fi
done
exit $status
