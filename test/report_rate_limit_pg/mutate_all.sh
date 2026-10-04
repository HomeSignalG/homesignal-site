#!/usr/bin/env bash
# Runs every prohibited mutation of docs/report-rate-limit.sql through test/report_rate_limit_pg/run.sh (with MUTANT=1) and requires each to be KILLED:
# a NAMED failing check (a "FAIL —" line), or an apply that stops (kind 'postcondition'). A crash is not a kill; an unapplied anchor is a harness failure.
# Needs PGHOST / PGDATABASE naming a disposable database, as run.sh does.
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"; root="$(cd "$here/../.." && pwd)"
tmp="$(mktemp -d)"; survived=0; crashed=0; killed=0; total=0
for m in $(python3 "$here/mutate.py" --list); do
  total=$((total+1))
  kind="$(python3 "$here/mutate.py" --kind "$m")"
  if ! python3 "$here/mutate.py" "$m" "$root/docs/report-rate-limit.sql" > "$tmp/m.sql" 2>"$tmp/m.err"; then echo "HARNESS FAILURE — $m: $(cat "$tmp/m.err")"; crashed=$((crashed+1)); continue; fi
  cmp -s "$tmp/m.sql" "$root/docs/report-rate-limit.sql" && { echo "HARNESS FAILURE — $m changed nothing"; crashed=$((crashed+1)); continue; }
  out="$(MUTANT=1 RATE_SQL="$tmp/m.sql" bash "$here/run.sh" 2>&1)"; rc=$?
  if [ "$kind" = "postcondition" ]; then
    if echo "$out" | grep -q "the shipped SQL does not apply"; then echo "KILLED   — $m (the apply stopped)"; killed=$((killed+1)); else echo "SURVIVED — $m (the apply went through)"; survived=$((survived+1)); fi
  else
    if echo "$out" | grep -q "^CRASH"; then echo "CRASH    — $m (the suite stopped without naming a check)"; crashed=$((crashed+1))
    elif echo "$out" | grep -q "^FAIL —"; then echo "KILLED   — $m: $(echo "$out" | grep '^FAIL —' | head -1 | cut -c1-110)"; killed=$((killed+1))
    else echo "SURVIVED — $m"; survived=$((survived+1)); fi
  fi
done
rm -rf "$tmp"
echo "mutations: $total · killed $killed · survived $survived · crashed/harness $crashed"
[ "$survived" = "0" ] && [ "$crashed" = "0" ]
