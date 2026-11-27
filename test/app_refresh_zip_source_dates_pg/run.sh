#!/usr/bin/env bash
# Runs the PROPOSED migration (docs/app-refresh-zip-source-dates.sql) and its rollback against a stand-in whose provenance expression is the live one, on a
# disposable Postgres (PGHOST/PGPORT/PGUSER must point at one; nothing here touches production). The guard md5 is replaced with the stand-in's, because the live md5
# cannot hold for a stand-in: every OTHER line of the migration runs unchanged. Writes the persisted provenance shapes to the fixtures the offline test reads.
set -euo pipefail
cd "$(dirname "$0")/../.."
DB=sd_test_$$; psql -qAt -c "create database $DB" postgres >/dev/null; trap 'psql -qAt -c "drop database $DB" postgres >/dev/null' EXIT
P="psql -v ON_ERROR_STOP=1 -qAt $DB"
$P -c "create table site_in(site jsonb)" -f test/app_refresh_zip_source_dates_pg/stub.sql >/dev/null
OLD=$($P -c "select md5(pg_get_functiondef('public.app_refresh_zip(text)'::regprocedure))")
mig() { sed "s/50d925795f2c4d11804551a54947e4e6/$OLD/" "$1"; }
prov() { $P -c "truncate site_in; insert into site_in values ('$1'::jsonb)" -c "select public.app_refresh_zip('x')" | tail -1; }
WITH='{"src":"Agency","case_number":"P-1","record_url_precision":"record","source_dates":{"created":"2024-08-26","updated":"2026-09-20","milestones":[{"label":"Advertise","date":"2027-02-01","kind":"planned"}]}}'
WITHOUT='{"src":"Agency","case_number":"P-2","record_url_precision":"record"}'
B1=$(prov "$WITH"); B2=$(prov "$WITHOUT")
echo "before: $B1"; [[ "$B1" != *source_dates* ]] || { echo "FAIL: stand-in already carries source_dates"; exit 1; }
mig docs/app-refresh-zip-source-dates.sql | $P >/dev/null
A1=$(prov "$WITH"); A2=$(prov "$WITHOUT")
echo "after:  $A1"
[[ "$A1" == *'"source_dates"'* ]] || { echo "FAIL: source_dates not carried"; exit 1; }
[[ "$A2" == "$B2" ]] || { echo "FAIL: a record without source dates changed its provenance"; exit 1; }
# second apply is refused (the body is no longer the reviewed one)
if mig docs/app-refresh-zip-source-dates.sql | $P >/dev/null 2>&1; then echo "FAIL: re-apply was accepted"; exit 1; fi
# a drifted body is refused
$P -c "create or replace function public.zz() returns int language sql as 'select 1'" >/dev/null
sed "s/50d925795f2c4d11804551a54947e4e6/deadbeefdeadbeefdeadbeefdeadbeef/" docs/app-refresh-zip-source-dates.sql | psql -v ON_ERROR_STOP=1 -qAt $DB >/dev/null 2>&1 && { echo "FAIL: wrong md5 accepted"; exit 1; } || true
# rollback restores the reviewed body exactly
mig docs/app-refresh-zip-source-dates.rollback.sql | sed "s/$(echo $OLD)/$OLD/" | $P >/dev/null
[[ "$($P -c "select md5(pg_get_functiondef('public.app_refresh_zip(text)'::regprocedure))")" == "$OLD" ]] || { echo "FAIL: rollback did not restore the body"; exit 1; }
printf '%s\n' "{\"with_source_dates\": $A1, \"without_source_dates\": $A2}" > test/fixtures/report-accuracy/persisted-provenance.json
echo "PASS — migration, rollback, drift and re-apply refusals"
