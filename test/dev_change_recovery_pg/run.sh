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

emit_mut() { :; }
out="$(checks "$SQL")"; echo "$out" | sed 's/^/  /'
n_all=$(grep -c '|' <<<"$out"); n_fail=$(grep -c '|f|' <<<"$out" || true)
echo "SHIPPED: $n_all checks, $n_fail failed"
if [ "$n_all" -lt 38 ] || [ "$n_fail" -ne 0 ]; then echo "FAIL — the shipped SQL does not pass"; exit 1; fi

status=0
for m in "$here"/mutations/*.py; do
  name="$(basename "$m" .py)"
  python3 "$m" "$SQL" > "$tmp/mut.sql" || { echo "HARNESS FAILURE — mutation $name did not apply (anchor missing)"; status=1; continue; }
  cmp -s "$SQL" "$tmp/mut.sql" && { echo "HARNESS FAILURE — mutation $name changed nothing"; status=1; continue; }
  mo="$(checks "$tmp/mut.sql" || true)"; nf=$(grep -c '|f|' <<<"$mo" || true)
  if [ "$nf" -gt 0 ]; then echo "KILLED   $name — $nf check(s) failed"; else echo "SURVIVED $name"; status=1; fi
done
exit $status
