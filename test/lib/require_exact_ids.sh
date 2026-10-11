#!/usr/bin/env bash
# require_exact_ids <required-ids-file> <suite-output-file>
# A suite's result lines look like "  ID free text|t|detail" or "...|f|detail". The set of IDs that actually printed must equal the committed
# required list EXACTLY: a missing ID (never ran / errored before reporting), a duplicate, an unexpected ID, or any |f| is a failure.
# A check that did not report is never a pass. Prints a one-line verdict; returns non-zero on any problem.
set -uo pipefail
req="$1"; out="$2"
[ -s "$req" ] || { echo "IDS FAIL — required list '$req' is missing or empty"; exit 1; }
grep -E '\|[tf](\||$)' "$out" | sed -E 's/^[[:space:]]+//' | awk '{print $1}' > "$out.ids"
sort "$req" | uniq -d > "$out.reqdup"
[ -s "$out.reqdup" ] && { echo "IDS FAIL — required list has duplicates: $(tr '\n' ' ' < "$out.reqdup")"; exit 1; }
dups="$(sort "$out.ids" | uniq -d | tr '\n' ' ')"
missing="$(comm -13 <(sort -u "$out.ids") <(sort "$req") | tr '\n' ' ')"
extra="$(comm -23 <(sort -u "$out.ids") <(sort "$req") | tr '\n' ' ')"
failed="$(grep -E '\|f(\||$)' "$out" | sed -E 's/^[[:space:]]+//' | awk '{print $1}' | tr '\n' ' ')"
n_req=$(wc -l < "$req"); n_got=$(sort -u "$out.ids" | wc -l)
if [ -n "$dups$missing$extra$failed" ]; then
  echo "IDS FAIL — required $n_req, reported $n_got | missing: [${missing}] duplicated: [${dups}] unexpected: [${extra}] failed: [${failed}]"; exit 1
fi
echo "IDS OK — all $n_req required check IDs reported exactly once and passed"
