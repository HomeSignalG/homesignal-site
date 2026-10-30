#!/usr/bin/env bash
# resolved_projects.display_name against a DISPOSABLE Postgres (never production).
# Applies docs/resolved-projects-display-name.sql twice on a stand-in of the two production rows
# and their parcels, then checks: the decided names and bases, ids/keys/communities/parcels
# unchanged, the basis constraint, the post-condition guard, and the rollback.
set -euo pipefail
: "${PGHOST:?}" "${PGDATABASE:?}"
here="$(cd "$(dirname "$0")" && pwd)"; root="$(cd "$here/../.." && pwd)"
F="$root/docs/resolved-projects-display-name.sql"
P() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }
fails=0
ck() { if [ "$2" = "t" ]; then echo "PASS — $1"; else echo "FAIL — $1 ($2)"; fails=$((fails+1)); fi; }
q() { P -tAc "$1"; }

P <<'SQL'
drop table if exists public.resolved_project_parcels; drop table if exists public.resolved_projects;
create table public.resolved_projects (id uuid primary key default gen_random_uuid(), project_key text unique not null,
  community_id uuid, aliases jsonb, updated_at timestamptz default now());
create table public.resolved_project_parcels (id uuid primary key default gen_random_uuid(),
  project_id uuid references public.resolved_projects(id), apn text, zip text, in_anchor boolean);
insert into public.resolved_projects (project_key, community_id) values ('eagle-mountain', gen_random_uuid()), ('stratos-box-elder', gen_random_uuid());
insert into public.resolved_project_parcels (project_id, apn, zip, in_anchor)
  select id, 'A' || g, '84005', true from public.resolved_projects, generate_series(1, 5) g;
insert into public.resolved_project_parcels (project_id, apn, zip, in_anchor)
  select id, null, null, false from public.resolved_projects where project_key = 'eagle-mountain';
SQL
before=$(q "select md5(string_agg(id::text||project_key||coalesce(community_id::text,''),',' order by project_key collate \"C\")) || md5((select string_agg(id::text||project_id::text||coalesce(apn,'')||coalesce(zip,'')||in_anchor::text, ',' order by id::text collate \"C\") from public.resolved_project_parcels)) from public.resolved_projects")

P -f "$F" >/dev/null 2>&1 && ok1=t || ok1=f; ck "applies" "$ok1"
P -f "$F" >/dev/null 2>&1 && ok2=t || ok2=f; ck "re-applying changes nothing and does not fail" "$ok2"
ck "Stratos: record name" "$(q "select display_name = 'Stratos data center project' and display_name_basis = 'record' from public.resolved_projects where project_key = 'stratos-box-elder'")"
ck "Eagle Mountain: JODY's descriptive label, not an official name" "$(q "select display_name = 'Eagle Mountain land assembly' and display_name_basis = 'descriptive' from public.resolved_projects where project_key = 'eagle-mountain'")"
after=$(q "select md5(string_agg(id::text||project_key||coalesce(community_id::text,''),',' order by project_key collate \"C\")) || md5((select string_agg(id::text||project_id::text||coalesce(apn,'')||coalesce(zip,'')||in_anchor::text, ',' order by id::text collate \"C\") from public.resolved_project_parcels)) from public.resolved_projects")
ck "ids, keys, communities and parcels unchanged" "$([ "$before" = "$after" ] && echo t || echo f)"
for bad in "display_name_basis = 'official'" "display_name = null" "display_name = '  '" "display_name_basis = null"; do
  if P -c "update public.resolved_projects set $bad where project_key = 'eagle-mountain'" >/dev/null 2>&1; then r=f; else r=t; fi
  ck "constraint refuses: $bad" "$r"
done
# a parcel moved inside the same transaction is refused by the post-condition
P -c "alter table public.resolved_projects drop column display_name_basis, drop column display_name" >/dev/null
python3 - "$F" > /tmp/dn_moved.sql <<'PY'
import sys
s = open(sys.argv[1]).read()
anchor = "-- Post-conditions:"
assert s.count(anchor) == 1
print(s.replace(anchor, "update public.resolved_project_parcels set zip = '99999' where apn = 'A1';\n" + anchor, 1))
PY
if P -f /tmp/dn_moved.sql >/dev/null 2>&1; then r=f; else r=t; fi
ck "post-condition refuses a moved parcel (and nothing commits)" "$r"
ck "after the refused run, no name column exists" "$(q "select count(*) = 0 from information_schema.columns where table_name = 'resolved_projects' and column_name like 'display_name%'")"
P -f "$F" >/dev/null 2>&1
P -c "alter table public.resolved_projects drop column if exists display_name_basis, drop column if exists display_name" >/dev/null
ck "rollback removes both columns" "$(q "select count(*) = 0 from information_schema.columns where table_name = 'resolved_projects' and column_name like 'display_name%'")"
echo "failed: $fails"; [ "$fails" -eq 0 ]
