#!/usr/bin/env bash
# Runs every prohibited mutation of docs/report-rate-limit.sql through test/report_rate_limit_pg/run.sh (with MUTANT=1) and requires each to be KILLED:
# a NAMED failing check (a "FAIL —" line), or an apply that stops (kind 'postcondition'). A crash is not a kill; an unapplied anchor is a harness failure.
# Needs PGHOST / PGDATABASE naming a disposable database, as run.sh does.
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"; root="$(cd "$here/../.." && pwd)"
# An instrument must prove it ran before its silence counts as evidence. A suite that never started (no database named, no cluster) prints no "FAIL —" line, which used to
# read as "survived" for every mutation. So: name the database up front, and require the UNMUTATED suite to pass here, as the control, before any mutation is judged.
: "${PGHOST:?PGHOST must name a disposable Postgres}" "${PGDATABASE:?PGDATABASE must name a disposable database}"
tmp="$(mktemp -d)"; survived=0; crashed=0; killed=0; total=0
control="$(bash "$here/run.sh" 2>&1)"
echo "$control" | grep -Eq '^[0-9]+ passed, 0 failed of [0-9]+$' || { echo "HARNESS FAILURE — the unmutated suite did not pass, so no mutation can be judged:"; echo "$control" | tail -5 | cut -c1-200; exit 2; }
echo "CONTROL  the unmutated suite passes: $(echo "$control" | grep -E '^[0-9]+ passed, 0 failed of [0-9]+$')"
for m in $(python3 "$here/mutate.py" --list); do
  total=$((total+1))
  kind="$(python3 "$here/mutate.py" --kind "$m")"
  if ! python3 "$here/mutate.py" "$m" "$root/docs/report-rate-limit.sql" > "$tmp/m.sql" 2>"$tmp/m.err"; then echo "HARNESS FAILURE — $m: $(cat "$tmp/m.err")"; crashed=$((crashed+1)); continue; fi
  cmp -s "$tmp/m.sql" "$root/docs/report-rate-limit.sql" && { echo "HARNESS FAILURE — $m changed nothing"; crashed=$((crashed+1)); continue; }
  out="$(MUTANT=1 RATE_SQL="$tmp/m.sql" bash "$here/run.sh" 2>&1)"; rc=$?
  # the suite must have RUN: it ends with a summary line, names a failing check, crashes by name, or its apply stops. None of those = it never started.
  if ! echo "$out" | grep -Eq '^([0-9]+ passed, [0-9]+ failed of [0-9]+|FAIL —|CRASH)|the shipped SQL does not apply'; then
    echo "HARNESS FAILURE — $m: the suite did not run (no summary, no failing check, no crash, no stopped apply): $(echo "$out" | tail -1 | cut -c1-140)"; crashed=$((crashed+1)); continue
  fi
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
