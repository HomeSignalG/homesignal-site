# TEST-ONLY. The executable Postgres suites exercise the MECHANISM of the free allowance (the ordinal CHECK, the completion flip, the
# refusal at the limit, the paid numbering that starts after it), and they were written around a small allowance so a full ledger
# can be built in a test. The shipped number is 100 (docs/evaluation-entitlement.sql). So the suites install a COPY of the SQL of
# record whose free limit is LIMIT_UNDER_TEST (10), and nothing else differs. The real value is proven separately:
# test/free_report_limit_pg (the 10 -> 100 migration equals a fresh install of the real file, limit 100) and the structure test.
#   docsql <name>   prints the path of docs/<name>.sql, or of its limit-under-test copy for the three files that state the number.
LIMIT_UNDER_TEST=10
DOCSQL_DIR="$(mktemp -d)"
docsql() {
  local name="$1" src out
  src="$root/docs/$name.sql"
  out="$DOCSQL_DIR/$name.sql"
  case "$name" in
    evaluation-entitlement)
      sed "s/language sql immutable as \\\$\\\$ select 100 \\\$\\\$;/language sql immutable as \$\$ select $LIMIT_UNDER_TEST \$\$;/" "$src" >"$out";;
    report-rate-limit)
      sed "s/evaluation_report_limit() <> 100 then raise exception 'report_rate_limit: the free report limit is not 100/evaluation_report_limit() <> $LIMIT_UNDER_TEST then raise exception 'report_rate_limit: the free report limit is not $LIMIT_UNDER_TEST/" "$src" >"$out";;
    da-owner-safeguards)
      sed "s/evaluation_report_limit() <> 100 or/evaluation_report_limit() <> $LIMIT_UNDER_TEST or/" "$src" >"$out";;
    *) printf '%s' "$src"; return;;
  esac
  cmp -s "$src" "$out" && { echo "docsql: the limit-under-test substitution changed nothing in $name" >&2; return 1; }
  printf '%s' "$out"
}
