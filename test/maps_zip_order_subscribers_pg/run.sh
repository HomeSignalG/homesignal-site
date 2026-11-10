#!/usr/bin/env bash
# docs/maps-zip-order-subscriber-zips.sql against a DISPOSABLE Postgres (never production).
# Applies the file twice (idempotent), runs suite.sql, then checks that each mutation in
# MUTATIONS makes at least one check fail.
set -euo pipefail
: "${PGHOST:?}" "${PGDATABASE:?}"
here="$(cd "$(dirname "$0")" && pwd)"; root="$(cd "$here/../.." && pwd)"
SQL="$root/docs/maps-zip-order-subscriber-zips.sql"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
P() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }
run_once() {  # $1 = file to apply; prints check lines
  P -c "drop schema if exists public cascade; drop schema if exists auth cascade; create schema public;" >/dev/null 2>&1
  P -f "$here/fixture.sql" >/dev/null
  P -f "$1" >/dev/null 2>"$tmp/err" || { cat "$tmp/err" >&2; return 2; }
  P -f "$1" >/dev/null 2>"$tmp/err" || { cat "$tmp/err" >&2; return 2; }
  P -tA -f "$here/suite.sql" 2>/dev/null | grep -E '^S[0-9]' || true
}
out="$(run_once "$SQL")"; echo "$out" | sed 's/^/  /'
n=$(grep -c '|' <<<"$out" || true); f=$(grep -c '|false$' <<<"$out" || true)
echo "SHIPPED: $n checks, $f failed"
[ "$n" -ge 15 ] && [ "$f" -eq 0 ] || { echo FAIL; exit 1; }   # every check in suite.sql printed
# mutations: name|python expression on the text s
MUT=(
 "no-insert-trigger|s.replace('after insert or update on public.user_subscriptions','after delete on public.user_subscriptions')"
 "no-users-trigger|s.replace('after update of unsubscribed, alert_email_consent, community_id on public.users','after delete on public.users')"
 "ignores-subscribed|s.replace(\"where s.stream = 'maps' and s.subscribed\\n        and c.level\",\"where s.stream = 'maps'\\n        and c.level\",1)"
 "upload-drops-subscribers|s.replace('  perform public.maps_zip_order_sync_subscribers();\n\n  return query','  return query')"
 "no-exception-guard|s.replace('exception when others then','exception when division_by_zero then')"
 "prepends|s.replace('next_pos := next_pos + 1;','next_pos := 1000 - next_pos;')"
)
bad=0
for m in "${MUT[@]}"; do
  name="${m%%|*}"; expr="${m#*|}"
  python3 -c "import sys;s=open(sys.argv[1]).read();t=$expr;assert t!=s,'mutation did not apply';open(sys.argv[2],'w').write(t)" "$SQL" "$tmp/m.sql"
  set +e; mo="$(run_once "$tmp/m.sql")"; rc=$?; set -e
  if [ $rc -ne 0 ] || grep -q '|false$' <<<"$mo" || [ "$(grep -c '|' <<<"$mo")" -lt "$n" ]; then echo "  killed: $name"; else echo "  SURVIVED: $name"; bad=1; fi
done
[ $bad -eq 0 ] || { echo FAIL; exit 1; }
bash "$here/replay_guard.sh"
echo "PASS"
