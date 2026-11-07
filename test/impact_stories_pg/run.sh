#!/usr/bin/env bash
# Runs docs/impact-stories.sql on a DISPOSABLE Postgres (stubbed auth/vault/net) and executes suite.sql twice
# (the file must re-apply cleanly). Exit code is the result.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$HERE/../.."
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)}"
D="$(mktemp -d)"; PORT="${PGPORT:-55433}"
RUN=""; if [ "$(id -u)" = 0 ]; then id postgres >/dev/null 2>&1 || useradd -m postgres; chown postgres "$D"; RUN="su postgres -c"; fi
runas() { if [ -n "$RUN" ]; then $RUN "$*"; else bash -c "$*"; fi; }
runas "$PGBIN/initdb -D $D/data -A trust -U postgres >/dev/null"
runas "$PGBIN/pg_ctl -D $D/data -o '-p $PORT -k $D' -l $D/log -w start >/dev/null"
trap 'runas "$PGBIN/pg_ctl -D $D/data -m immediate stop >/dev/null" || true; rm -rf "$D"' EXIT
P="$PGBIN/psql -h $D -p $PORT -U postgres -v ON_ERROR_STOP=1 -q"
$P -d postgres -c "create database t" >/dev/null
P="$P -d t"
$P -f "$HERE/stubs.sql"
$P -f "$ROOT/docs/impact-stories.sql" >/dev/null
$P -f "$ROOT/docs/impact-stories.sql" >/dev/null   # idempotent re-apply
$P -f "$HERE/suite.sql"
# upgrade path: a database built from the first file (artifact list without 'narrative') widens on re-apply
$P -c "alter table public.impact_story_approvals drop constraint impact_story_approvals_artifact_check;
       alter table public.impact_story_approvals add constraint impact_story_approvals_artifact_check
         check (artifact in ('angle', 'main', 'short_a', 'short_b', 'packaging')) not valid;"
$P -f "$ROOT/docs/impact-stories.sql" >/dev/null
$P -c "do \$\$ begin
  if not exists (select 1 from pg_constraint where conname = 'impact_story_approvals_artifact_check'
                 and pg_get_constraintdef(oid) like '%narrative%') then raise exception 'FAIL: upgrade did not widen the artifact list'; end if;
end \$\$;" && echo "upgrade: artifact list widened on re-apply"
# upgrade path: a database from before photo sets (the newest choice per subject replaced the others) keeps exactly what
# it showed: re-applying adds the column and a 'remove' row for every photo the old rule had replaced
$P -c "alter table public.impact_story_asset_choices drop column action;"
$P -c "insert into public.impact_story_asset_choices (story_id, subject_id, candidate_id, job_id, entry, actor)
       select story_id, subject_id, 'replaced-' || candidate_id, job_id, entry, actor from public.impact_story_asset_choices where job_id is not null limit 1;
       insert into public.impact_story_asset_choices (story_id, subject_id, candidate_id, job_id, entry, actor)
       select story_id, subject_id, 'newest-' || candidate_id, job_id, entry, actor from public.impact_story_asset_choices where job_id is not null order by id limit 1;"
$P -c "create table public._old_newest as select distinct on (story_id, subject_id) story_id, subject_id, candidate_id
         from public.impact_story_asset_choices order by story_id, subject_id, id desc;"
$P -f "$ROOT/docs/impact-stories.sql" >/dev/null
$P -c "do \$\$ begin
  if exists (select story_id, subject_id, candidate_id from public._old_newest
             except select c.story_id, c.subject_id, c.candidate_id from public.impact_stories s, public._hs_is_choices(s.id) c)
     or exists (select c.story_id, c.subject_id, c.candidate_id from public.impact_stories s, public._hs_is_choices(s.id) c
             except select story_id, subject_id, candidate_id from public._old_newest)
  then raise exception 'FAIL: photo sets after the upgrade differ from what the old rule showed'; end if;
end \$\$;" && echo "upgrade: photo sets equal the old newest-per-subject choices"

# upgrade path: a database from before story numbers. Re-applying numbers the existing stories 8000.. in creation order
# (row_number, not nextval in a sorted subquery), and the next new story takes the number after the highest one.
$P -c "alter table public.impact_stories alter column story_number drop default;
       alter table public.impact_stories drop constraint impact_stories_story_number_check;
       alter table public.impact_stories alter column story_number drop not null;
       alter sequence public.impact_story_number_seq owned by none;
       drop sequence public.impact_story_number_seq;
       update public.impact_stories set story_number = null;
       update public.impact_stories set created_at = now() - (row_number * interval '1 hour')
         from (select id as rid, row_number() over (order by id desc) as row_number from public.impact_stories) r where id = r.rid;"
$P -f "$ROOT/docs/impact-stories.sql" >/dev/null
$P -c "do \$\$ declare n int; begin
  select count(*) into n from public.impact_stories;
  if n < 2 then raise exception 'FAIL: the numbering check needs at least 2 stories, has %', n; end if;
  if exists (select 1 from (select story_number, 7999 + row_number() over (order by created_at, id) as want
                              from public.impact_stories) x where story_number <> want)
  then raise exception 'FAIL: existing stories are not numbered 8000.. in creation order'; end if;
  if nextval('public.impact_story_number_seq') <> 8000 + n then raise exception 'FAIL: the next number does not follow the highest'; end if;
end \$\$;" && echo "upgrade: existing stories numbered 8000.. in creation order; the next number follows"
