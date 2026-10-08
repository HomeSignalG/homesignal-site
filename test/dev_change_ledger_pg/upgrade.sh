#!/usr/bin/env bash
# The LIVE change ledger upgrades in place (docs/dev-change-copy-conflicts-apply.sql) — proven against the exact file
# that was applied to production on 2026-09-29 (test/dev_change_ledger_pg/as_applied.sql, writer md5 17b45b9c…),
# on a DISPOSABLE Postgres (never production):
#   U01 the apply is accepted by the guard and takes, in one transaction
#   U02 the writer is exactly the one the file was built for, the new objects exist and are closed
#   U03 not one existing project, event or run row changes
#   U04 re-applying is a no-op
#   U05 the new rule works on the upgraded ledger (a contradicting copy is held; an ordinary change is still written)
#   U06 a writer the file has not seen is NEVER overwritten (refused, nothing created)
#   U07 without the ledger it is refused
#   U08 a failed post-condition rolls the whole migration back (the writer is still the old one, no new table)
set -euo pipefail
: "${PGHOST:?}" "${PGDATABASE:?}"
case "$PGDATABASE" in *disposable*) ;; *) echo "ABORT: PGDATABASE must name a disposable database (got '$PGDATABASE')"; exit 1;; esac
here="$(cd "$(dirname "$0")" && pwd)"; root="$(cd "$here/../.." && pwd)"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
P() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }
Q() { P -tA -c "$1"; }
APPLY="$root/docs/dev-change-copy-conflicts-apply.sql"
fails=0
tf() { if [ "$2" = "$3" ]; then echo "PASS — $1"; else echo "FAIL — $1  [got: $2 | want: $3]"; fails=$((fails+1)); fi; }
fresh() { P -c "drop schema public cascade; create schema public;" >/dev/null 2>&1; P -f "$here/fixture.sql" >/dev/null; }
OLD="$(sed -n "s/^--   old writer  md5(prosrc) \([0-9a-f]\{32\}\).*/\1/p" "$APPLY")"
NEW="$(sed -n "s/^--   new writer  md5(prosrc) \([0-9a-f]\{32\}\).*/\1/p" "$APPLY")"
writer() { Q "select md5(prosrc) from pg_proc where proname = 'dev_change_observe_zip' and pronamespace = 'public'::regnamespace"; }
ledger_hash() { Q "select md5(coalesce((select string_agg(t::text, ',' order by identity_key) from public.dev_change_project t), '')
                    || coalesce((select string_agg(t::text, ',' order by id) from public.dev_change_event t), '')
                    || coalesce((select string_agg(t::text, ',' order by id) from public.dev_change_run t), ''))"; }
# one app_projects row the way the materialiser writes it
row() { P -c "insert into public.app_projects (zip, record_kind, source_key, source_key_basis, source_seq, registry_id, name, type, type_raw, status, stage, date_kind, submitted_at, address, provenance)
              values ('$1', 'development', '$2', 'source_id:case_number', 1, 'fixture', '$3', 'Commercial', 'Retail', 'Proposed', '$4', 'filed', '2026-08-01', '$5',
                      jsonb_build_object('refreshed_at', to_char(now() at time zone 'UTC' - interval '$6 hours', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"+00:00\"')))
              on conflict (zip, source_key, source_seq) do update set name = excluded.name, stage = excluded.stage, address = excluded.address, provenance = excluded.provenance"; }

[ -n "$OLD" ] && [ -n "$NEW" ] && [ "$OLD" != "$NEW" ] || { echo "FAIL — cannot read the two writer fingerprints from the apply file"; exit 1; }

# ── the ledger exactly as it is live, with real history written by the OLD writer ─────────────────────────────────────
fresh
P -f "$here/as_applied.sql" >/dev/null 2>&1
tf 'the stand-in ledger is the live one: the old writer hashes to the production value' "$(writer)" "$OLD"
BASE="$(Q "select public.dev_change_start_run(true)")"
row 91001 k:u1 'Alpha Plaza' Submitted '1 Main St' 40
row 91002 k:u2 'Beta Court' Submitted '2 Main St' 40
row 91003 k:u3 'Gamma Lofts' Submitted '3 First Ave' 40      # copy A
row 91004 k:u3 'Gamma Lofts' Submitted '9 Other Rd' 30        # copy B: a different address (the contradiction)
for z in 91001 91002 91003 91004; do Q "select public.dev_change_observe_zip('$z', '$BASE')" >/dev/null; done
Q "select public.dev_change_finish_run('$BASE')" >/dev/null
ORD="$(Q "select public.dev_change_start_run(false)")"
row 91002 k:u2 'Beta Court' Approved '2 Main St' 20
Q "select public.dev_change_observe_zip('91002', '$ORD')" >/dev/null
Q "select public.dev_change_finish_run('$ORD')" >/dev/null
before="$(ledger_hash)"
tf 'before: the OLD writer wrote the cross-copy event the upgrade is for (one non-first event on k:u3) and one real status change (k:u2)' \
   "$(Q "select (select count(*) from public.dev_change_event where identity_key = 'k:u3' and event_type <> 'first_detected') || '/' || (select count(*) from public.dev_change_event where identity_key = 'k:u2' and event_type = 'status_changed')")" '1/1'

# ── U01..U03 the upgrade ──────────────────────────────────────────────────────────────────────────────────────────────────────
if P -1 -f "$APPLY" >/dev/null 2>"$tmp/err"; then tf 'U01 the upgrade applies, in one transaction' ok ok; else tf 'U01 the upgrade applies, in one transaction' "refused: $(head -c 300 "$tmp/err")" ok; fi
tf 'U02 the writer is exactly the one the file was built for' "$(writer)" "$NEW"
tf 'U02b the record-facts function and the conflict table exist, the table is empty, closed to anon/authenticated/PUBLIC, RLS on, service_role cannot delete' \
   "$(Q "select (to_regprocedure('public.dev_change_record_facts(jsonb)') is not null)::text || '/' || (select count(*) from public.dev_change_copy_conflict) || '/' ||
         (not exists (select 1 from (values ('anon'),('authenticated'),('public')) r(role), (values ('select'),('insert'),('update'),('delete'),('truncate')) p(priv) where has_table_privilege(r.role, 'public.dev_change_copy_conflict', p.priv)))::text || '/' ||
         (select relrowsecurity from pg_class where oid = 'public.dev_change_copy_conflict'::regclass)::text || '/' ||
         (not has_table_privilege('service_role', 'public.dev_change_copy_conflict', 'delete'))::text")" 'true/0/true/true/true'
tf 'U03 not one existing project, event or run row changed' "$([ "$before" = "$(ledger_hash)" ] && echo same || echo changed)" 'same'

# ── U04 idempotent ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
fpx() { Q "select md5(prosrc) from pg_proc where proname = 'dev_change_observe_zip' and pronamespace = 'public'::regnamespace" ; }
P -1 -f "$APPLY" >/dev/null 2>"$tmp/err" && tf 'U04 re-applying is accepted and changes nothing' "$(fpx)/$([ "$before" = "$(ledger_hash)" ] && echo same || echo changed)" "$NEW/same" \
  || tf 'U04 re-applying is accepted and changes nothing' "refused: $(head -c 300 "$tmp/err")" "$NEW/same"

# ── U05 the rule works on the upgraded ledger ─────────────────────────────────────────────────────────────────────────────────────────
R2="$(Q "select public.dev_change_start_run(false)")"
row 91003 k:u3 'Gamma Lofts' Submitted '3 First Ave' 10      # both copies refreshed again, still contradicting
row 91004 k:u3 'Gamma Lofts' Submitted '9 Other Rd' 9
row 91001 k:u1 'Alpha Plaza' Approved '1 Main St' 8          # an ordinary change, no other copy
for z in 91001 91003 91004; do Q "select public.dev_change_observe_zip('$z', '$R2')" >/dev/null; done
tf 'U05 after the upgrade a contradicting copy is HELD (no new event on k:u3, one audit row) and an ordinary change is still written (k:u1)' \
   "$(Q "select (select count(*) from public.dev_change_event where identity_key = 'k:u3' and event_type <> 'first_detected') || '/' || (select count(*) from public.dev_change_copy_conflict where identity_key = 'k:u3') || '/' || (select count(*) from public.dev_change_event where identity_key = 'k:u1' and event_type = 'status_changed')")" '1/1/1'

# ── U06 an unknown writer is never overwritten ───────────────────────────────────────────────────────────────────────────────────────────
fresh; P -f "$here/as_applied.sql" >/dev/null 2>&1
Q "select prosrc from pg_proc where proname = 'dev_change_observe_zip'" >/dev/null
P >/dev/null <<'SQL'
do $t$ declare _d text; begin
  select pg_get_functiondef(p.oid) into _d from pg_proc p where p.proname = 'dev_change_observe_zip';
  execute replace(_d, 'raise exception ''dev_change_observe_zip: % is not a 5-digit ZIP'', p_zip;', 'raise exception ''dev_change_observe_zip: % is not a 5-digit ZIP (edited)'', p_zip;');
end $t$;
SQL
tampered="$(writer)"
if P -1 -f "$APPLY" >/dev/null 2>"$tmp/err"; then tf 'U06 a writer the upgrade has not seen is refused' applied refused
else tf 'U06 a writer the upgrade has not seen is refused, naming both known versions' "$(grep -c 'neither the version this upgrade was built against' "$tmp/err")" '1'; fi
tf 'U06a the test really edited the writer (it no longer hashes to the old or the new version)' "$([ "$tampered" != "$OLD" ] && [ "$tampered" != "$NEW" ] && echo edited || echo unchanged)" 'edited'
tf 'U06b the refusal changed nothing: the edited writer is still there and no new table exists' "$([ "$tampered" = "$(writer)" ] && echo same || echo changed)/$(Q "select (to_regclass('public.dev_change_copy_conflict') is null)::text")" 'same/true'

# ── U07 without the ledger ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
fresh
if P -1 -f "$APPLY" >/dev/null 2>"$tmp/err"; then tf 'U07 without the ledger the file is refused' applied refused
else tf 'U07 without the ledger the file is refused, naming it' "$(grep -c 'is not installed' "$tmp/err")" '1'; fi

# ── U08 a failed post-condition rolls EVERYTHING back ───────────────────────────────────────────────────────────────────────────────────────
fresh; P -f "$here/as_applied.sql" >/dev/null 2>&1
sed "s/is distinct from '$NEW'/is distinct from 'ffffffffffffffffffffffffffffffff'/" "$APPLY" > "$tmp/bad.sql"
if cmp -s "$tmp/bad.sql" "$APPLY"; then echo "HARNESS — the post-condition anchor is missing"; exit 1; fi
if P -1 -f "$tmp/bad.sql" >/dev/null 2>"$tmp/err"; then tf 'U08 a failed post-condition rolls the migration back' applied refused
else tf 'U08 a failed post-condition refuses the migration' "$(grep -c 'did not install the writer it was built for' "$tmp/err")" '1'; fi
tf 'U08b and rolls EVERYTHING back: the writer is still the old one, no new table, no new function' \
   "$(writer)/$(Q "select (to_regclass('public.dev_change_copy_conflict') is null)::text || '/' || (to_regprocedure('public.dev_change_record_facts(jsonb)') is null)::text")" "$OLD/true/true"

[ "$fails" = 0 ] && echo "ALL UPGRADE CHECKS PASSED" || { echo "$fails FAILED"; exit 1; }
