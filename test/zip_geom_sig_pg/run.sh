#!/usr/bin/env bash
# public.zip_geom_sig (docs/zip-scope-bounds.sql) on a DISPOSABLE PostGIS: the polygon's identity moves when its SHAPE moves, even
# when the bounding box does not. Never production.
set -euo pipefail
: "${PGHOST:?}" "${PGDATABASE:?}"
case "$PGDATABASE" in *disposable*) ;; *) echo "ABORT: PGDATABASE must name a disposable database"; exit 1;; esac
here="$(cd "$(dirname "$0")" && pwd)"; root="$here/../.."
P() { psql -X -qtA -v ON_ERROR_STOP=1 "$@"; }
n=0; bad=0
t() { n=$((n+1)); if [ "$2" = "$3" ]; then echo "  $1|t"; else echo "  $1|f|got=[$2] want=[$3]"; bad=$((bad+1)); fi; }
apply() { # $1 = bounds SQL file
  P -f "$root/test/zip_membership_pg/fixture_schema.sql" >/dev/null 2>&1
  P -f "$root/docs/zip-membership-canonical.sql" >/dev/null
  P -c "do \$\$ begin
    if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
    if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
    if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin; end if; end \$\$;" >/dev/null
  P -c "truncate geo.zcta_boundary; insert into geo.zcta_boundary values
    ('90001', ST_Multi(ST_GeomFromText('POLYGON((0 0,2 0,2 2,0 2,0 0))',4269))),
    ('90002', ST_Multi(ST_GeomFromText('POLYGON((0 0,2 0,0 2,0 0))',4269))),
    ('90003', ST_Multi(ST_GeomFromText('POLYGON((0 0,2 0,2 2,0 2,0 0))',4269))),
    ('76247', ST_Multi(ST_GeomFromText('POLYGON((-97.4 33.0,-97.2 33.0,-97.2 33.2,-97.4 33.2,-97.4 33.0))',4269)))" >/dev/null
  P -f "$1" >/dev/null
}
checks() {
  apply "$1"
  t 'Z01 the same shape has the same identity (deterministic, a 32-hex md5)' "$(P -c "select (public.zip_geom_sig('90001') = public.zip_geom_sig('90003') and public.zip_geom_sig('90001') ~ '^[0-9a-f]{32}\$')::text")" true
  t 'Z02 a different SHAPE with the SAME bounding box has a different identity' "$(P -c "select (b1.xmin=b2.xmin and b1.ymin=b2.ymin and b1.xmax=b2.xmax and b1.ymax=b2.ymax and public.zip_geom_sig('90001') <> public.zip_geom_sig('90002'))::text from public.zip_scope_bounds('90001') b1, public.zip_scope_bounds('90002') b2")" true
  before="$(P -c "select public.zip_geom_sig('90003')")"
  P -c "update geo.zcta_boundary set geom = ST_Multi(ST_GeomFromText('POLYGON((0 0,2 0,2 2.0000001,0 2,0 0))',4269)) where zcta5='90003'" >/dev/null
  t 'Z03 an edit to the polygon (1e-7 degrees) moves the identity' "$([ "$before" != "$(P -c "select public.zip_geom_sig('90003')")" ] && echo moved || echo same)" moved
  t 'Z04 a ZIP with no boundary has no identity (never a guess)' "$(P -c "select coalesce(public.zip_geom_sig('00000'), 'null')")" null
  t 'Z05 a malformed ZIP has none' "$(P -c "select coalesce(public.zip_geom_sig('abc'), 'null')")" null
  t 'Z06 service-role only' "$(P -c "select (has_function_privilege('service_role','public.zip_geom_sig(text)','execute') and not has_function_privilege('anon','public.zip_geom_sig(text)','execute') and not has_function_privilege('authenticated','public.zip_geom_sig(text)','execute'))::text")" true
  t 'Z07 the deployed zip_scope_bounds signature is untouched (4 columns)' "$(P -c "select count(*) from pg_proc p, unnest(p.proargnames) a where p.proname='zip_scope_bounds' and a <> 'p_zip'")" 4
}
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
echo "== shipped"; checks "$root/docs/zip-scope-bounds.sql" | tee "$tmp/o"
bash "$root/test/lib/require_exact_ids.sh" "$here/required_checks.txt" "$tmp/o" || { echo "FAIL -- the shipped SQL does not pass, or a required check did not report"; exit 1; }
st=0
mut() { python3 - "$root/docs/zip-scope-bounds.sql" "$tmp/m.sql" "$2" "$3" <<'PY' || { echo "HARNESS  $1"; st=1; return; }
import sys
s = open(sys.argv[1]).read()
if s.count(sys.argv[3]) != 1: sys.exit(1)
open(sys.argv[2], 'w').write(s.replace(sys.argv[3], sys.argv[4]))
PY
  checks "$tmp/m.sql" >"$tmp/mo" 2>&1 || true   # a kill needs a check that RAN and failed (a '|f|' line), never a crash
  if grep -q '|f|' "$tmp/mo"; then echo "KILLED   $1 by $(grep '|f|' "$tmp/mo" | cut -d'|' -f1 | tr -s '\n' ' ')"; else echo "SURVIVED $1"; st=1; fi; }
mut identity_is_the_bbox "select md5(ST_AsEWKB(g)) from (select geo.zip_membership_boundary(p_zip) as g) s" "select md5(ST_AsEWKB(ST_Envelope(g))) from (select geo.zip_membership_boundary(p_zip) as g) s"
mut identity_is_rounded "select md5(ST_AsEWKB(g)) from (select geo.zip_membership_boundary(p_zip) as g) s" "select md5(ST_AsText(ST_ReducePrecision(g, 0.5))) from (select geo.zip_membership_boundary(p_zip) as g) s"
mut open_to_anon "revoke all on function public.zip_geom_sig(text) from anon, authenticated;" "grant execute on function public.zip_geom_sig(text) to anon;"
[ "$(grep -c '^mut ' "$here/run.sh")" -eq 3 ] || { echo 'FAIL -- expected 3 mutations'; exit 1; }
[ $st -eq 0 ] && echo 'MUTATIONS: 3 of 3 killed'
exit $st
