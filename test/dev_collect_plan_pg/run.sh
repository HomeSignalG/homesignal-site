#!/usr/bin/env bash
# THE PLAN-FLIP TEST for docs/dev-refresh-collect-blocked-plan-stable.sql, on a DISPOSABLE Postgres only (never production; no DDL in
# production, in any schema, in any transaction — site CLAUDE.md §7.11). Nothing here is measured on, or says anything about, production
# TIMINGS: the production evidence is in the SQL file's header (read-only SELECTs). This suite proves three things on the real, fingerprinted
# live collector (test/dev_collect_harness/build.sh) over a national-shaped cache (12,722 ZIPs x 100 sites):
#   CONTROL  the live function plans the "blocked" lookup as a HASH SEMI JOIN over the whole cache once the response set reaches the batch cap (16),
#            and as an index nested loop for a small set — the defect is reproduced before any fix is trusted;
#   FIX      after the splice the lookup is an index probe at every set size (1..200), and a full 16-response tick that carries failed
#            sources runs in a small fraction of the time;
#   SAME     the collector writes exactly the same rows, cursors and refusals before and after (failed source with stored records still
#            blocks the write; a failed source with none does not; nothing is dropped).
# Prohibited weakenings (each must be KILLED by a check that ran and failed): the EXISTS form back · blocking removed · blocking always on.
set -euo pipefail
: "${PGHOST:?}" "${PGDATABASE:?}"
case "$PGDATABASE" in *disposable*) ;; *) echo "ABORT: PGDATABASE must name a disposable database (got '$PGDATABASE')"; exit 1;; esac
here="$(cd "$(dirname "$0")" && pwd)"; root="$here/../.."
P() { psql -X -qtA -v ON_ERROR_STOP=1 "$@"; }
Q() { P -c "$1"; }
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
n=0; bad=0
t() { n=$((n+1)); if [ "$2" = "$3" ]; then echo "  $1|t"; else echo "  $1|f|got=[$2] want=[$3]"; bad=$((bad+1)); fi; }
FIX="$root/docs/dev-refresh-collect-blocked-plan-stable.sql"
LIVE_MD5=2012877397532a1e8e160b5a7a4c8032

build() {
  bash "$root/test/dev_collect_harness/build.sh" >/dev/null 2>"$tmp/err" || { cat "$tmp/err" >&2; echo "FAIL — the live collector could not be rebuilt"; exit 1; }
  # a NATIONAL-SHAPED cache: 12,722 ZIPs, 100 sites each, 8 sources cycling (so every ZIP stores every source)
  Q "insert into public.development_reports(zip, sites, counts, paywall, refreshed_at, last_collected_response_id, facilities_refreshed_at)
     select lpad(g::text,5,'0'),
            (select jsonb_agg(jsonb_build_object('source_registry_id',
                   (array['maine-dot-public-projects','maine-dot-public-projects-lines','fairfax-recent-building-permits','s4','s5','s6','s7','s8'])[1+(g+k)%8],
                   'title','Permit '||g||'-'||k, 'record_url','https://example.test/'||g||'/'||k, 'lat',40+k/1000.0, 'lng',-100,
                   'scope','point', 'status','Issued', 'pad', repeat('x',120))) from generate_series(1,100) k),
            '{\"development\":100,\"facilities\":0}'::jsonb, false, now()-interval '3 days', 0, now()-interval '3 days'
       from generate_series(1,12722) g"
  Q "analyze public.development_reports"
}
# 200 committed response rows (only their count and the table's size matter to the plan tests)
seed_plan_rows() {
  Q "delete from net._http_response"
  Q "insert into net._http_response(id,status_code,content_type,content,created)
     select 900000+i, 200, 'application/json',
            jsonb_build_object('mode','zip','zip',lpad((6000+i)::text,5,'0'),'counts','{\"development\":100,\"facilities\":0}'::jsonb,'sites','[]'::jsonb,'epa','{\"ok\":true}'::jsonb)::text, now()
       from generate_series(1,200) i"
  Q "analyze net._http_response"
}
# the 'blocked' CTE's SELECT, taken from the function body that is installed (never retyped)
blocked_sql() { Q "select substring(prosrc from 'blocked as \(\s*(select distinct.*?)\n  \),') from pg_proc where proname='dev_refresh_collect' and pronamespace='public'::regnamespace"; }
plan_for() { # k
  local ids; ids="$(seq -s, 900001 $((900000+$1)))"
  P -c "explain (costs off) with resp as (select r.id as rid, r.content::jsonb as j from net._http_response r where r.id = any(array[$ids]::bigint[])) $(blocked_sql)"
}
# One tick of the real collector over 16 responses, inside a transaction that is rolled back.
#   scenario A: no failed source · B: 2 failed sources that the ZIP's stored sites DO contain · C: 3 failed sources it does NOT contain
scenario() { # A|B|C  -> "elapsed_ms|rows_written|digest"
  P <<SQL
begin;
insert into net._http_response(id,status_code,content_type,content,created)
select 100000+i, 200, 'application/json',
       (jsonb_build_object('mode','zip','zip',lpad((5000+i)::text,5,'0'),
          'counts','{"development":100,"facilities":0}'::jsonb,'sites','[{"title":"x","record_url":"https://example.test/x"}]'::jsonb,'epa','{"ok":true}'::jsonb)
        || case
             when '$1'='B' and i in (3,9)   then jsonb_build_object('arcgis_reports', jsonb_build_array(jsonb_build_object('registry_id','maine-dot-public-projects','quarantined', jsonb_build_array(jsonb_build_object('reason','fetch failed: rate-limited/5xx after retries')))))
             when '$1'='C' and i in (3,9,12) then jsonb_build_object('arcgis_reports', jsonb_build_array(jsonb_build_object('registry_id','no-such-source','quarantined', jsonb_build_array(jsonb_build_object('reason','fetch failed: Token Required')))))
             else '{}'::jsonb end)::text, now()
  from generate_series(1,16) i;
select set_config('t.t0', clock_timestamp()::text, true) as x0 \gset
select public.dev_refresh_collect() as written \gset
select round(extract(epoch from clock_timestamp() - current_setting('t.t0')::timestamptz) * 1000) as ms \gset
select md5(string_agg(zip||'|'||(counts::text)||'|'||coalesce(last_collected_response_id,0)||'|'||(refreshed_at > now() - interval '1 hour')::text, ',' order by zip collate "C")) as dg
  from public.development_reports where zip between '05001' and '05016' \gset
rollback;
select :'ms' || '|' || :'written' || '|' || :'dg';
SQL
}
get_ms() { cut -d'|' -f1 <<<"$1"; }; get_w() { cut -d'|' -f2 <<<"$1"; }; get_dg() { cut -d'|' -f3 <<<"$1"; }
has() { grep -q "$2" <<<"$1" && echo yes || echo no; }

# ── 0. the LIVE function, rebuilt and fingerprinted ──────────────────────────────────────────────────────────────────────────────
build; seed_plan_rows
t "G01 the rebuilt collector is production's, md5 $LIVE_MD5" "$(Q "select md5(prosrc) from pg_proc where proname='dev_refresh_collect' and pronamespace='public'::regnamespace")" "$LIVE_MD5"
p16="$(plan_for 16)"; p8="$(plan_for 1)"
t "G02 CONTROL (live): a 16-response set plans the blocked lookup as a HASH SEMI JOIN" "$(has "$p16" 'Hash Semi Join')" yes
t "G03 CONTROL (live): …whose build side is a Seq Scan of the whole development_reports table" "$(has "$p16" 'Seq Scan on development_reports')" yes
t "G04 CONTROL (live): a 1-response set is an index probe, not a hash join (the plan flips on the set size)" "$(has "$p8" 'Hash Semi Join')|$(has "$p8" 'Seq Scan on development_reports')" "no|no"
OLD_A="$(scenario A)"; OLD_B="$(scenario B)"; OLD_C="$(scenario C)"
echo "  (live, 16-response tick: A ${OLD_A%%|*} ms · B (failed sources) ${OLD_B%%|*} ms · C ${OLD_C%%|*} ms — disposable PG, not production)"
OLD_BMS="$(get_ms "$OLD_B")"
t "G05 CONTROL (live): the failed-source tick is the slow one (B at least 3x A)" "$([ "$OLD_BMS" -ge $((3*$(get_ms "$OLD_A")+1)) ] && echo yes || echo no)" yes

# ── 1. the fix, applied twice ────────────────────────────────────────────────────────────────────────────────────────────────────
P -f "$FIX" >/dev/null 2>"$tmp/err" || { cat "$tmp/err" >&2; echo "FAIL — the fix does not apply"; exit 1; }
md5_1="$(Q "select md5(prosrc) from pg_proc where proname='dev_refresh_collect' and pronamespace='public'::regnamespace")"
P -f "$FIX" >/dev/null 2>"$tmp/err" || { cat "$tmp/err" >&2; echo "FAIL — the fix does not apply twice"; exit 1; }
md5_2="$(Q "select md5(prosrc) from pg_proc where proname='dev_refresh_collect' and pronamespace='public'::regnamespace")"
t "F01 the fix is idempotent (second apply changes nothing)" "$md5_1" "$md5_2"
t "F02 the fix changes the body (and the marker is present exactly once)" "$([ "$md5_1" != "$LIVE_MD5" ] && echo yes || echo no)|$(Q "select (length(prosrc)-length(replace(prosrc,'(PLAN-STABLE','')))/length('(PLAN-STABLE') from pg_proc where proname='dev_refresh_collect' and pronamespace='public'::regnamespace")" "yes|1"

checks_after() { # prints results under id prefix $1
  local pre="$1" allok=yes anyhash=no anyseq=no k pl
  for k in 1 8 12 16 64 200; do
    pl="$(plan_for $k)"
    [ "$(has "$pl" 'Seq Scan on development_reports')" = yes ] && anyseq=yes
    [ "$(has "$pl" 'Hash')" = yes ] && anyhash=yes
  done
  t "${pre}P01 no set size 1..200 scans development_reports sequentially" "$anyseq" no
  t "${pre}P02 no set size 1..200 builds a hash" "$anyhash" no
  t "${pre}P03 at 16 responses the lookup is the primary-key index" "$(has "$(plan_for 16)" 'development_reports_pkey')" yes
  local A B C; A="$(scenario A)"; B="$(scenario B)"; C="$(scenario C)"
  echo "  (${pre}: 16-response tick: A ${A%%|*} ms · B ${B%%|*} ms · C ${C%%|*} ms — disposable PG, not production)"
  t "${pre}T01 a 16-response tick with failed sources is at least 5x faster than live" "$([ "$(get_ms "$B")" -le $((OLD_BMS/5)) ] && echo yes || echo no)" yes
  t "${pre}T02 …and finishes in under 2 s" "$([ "$(get_ms "$B")" -lt 2000 ] && echo yes || echo no)" yes
  t "${pre}E01 scenario A (no failures): same rows, cursors and counts as live" "$(get_dg "$A")|$(get_w "$A")" "$(get_dg "$OLD_A")|$(get_w "$OLD_A")"
  t "${pre}E02 scenario B (failed sources the ZIP stores): same as live" "$(get_dg "$B")|$(get_w "$B")" "$(get_dg "$OLD_B")|$(get_w "$OLD_B")"
  t "${pre}E03 scenario C (failed sources the ZIP does not store): same as live" "$(get_dg "$C")|$(get_w "$C")" "$(get_dg "$OLD_C")|$(get_w "$OLD_C")"
  t "${pre}B01 failed sources that a ZIP stores STILL block its write (B writes 14 of 16)" "$(get_w "$B")" 14
  t "${pre}B02 failed sources it does not store do not block (C and A write all 16)" "$(get_w "$C")|$(get_w "$A")" "16|16"
}
checks_after ""

# ── 2. prohibited weakenings: each must be KILLED by a check that ran and failed ─────────────────────────────────────────────────
P -t -c "select pg_get_functiondef('public.dev_refresh_collect()'::regprocedure)" > "$tmp/fixed.sql"
python3 -I - "$FIX" > "$tmp/blocks.txt" <<'PY'
import re,sys
t=open(sys.argv[1]).read()
a=re.search(r"old_  text := \$a\$(.*?)\$a\$;",t,re.S).group(1); b=re.search(r"new_  text := \$b\$(.*?)\$b\$;",t,re.S).group(1)
open(sys.argv[1]+".old.tmp","w").write(a); open(sys.argv[1]+".new.tmp","w").write(b)
PY
mv "$FIX.old.tmp" "$tmp/old.blk"; mv "$FIX.new.tmp" "$tmp/new.blk"
mutate() { # name  python-expression body that edits variable s (the function definition)
  local name="$1" body="$2"
  python3 -I - "$tmp/fixed.sql" "$tmp/mut.sql" "$tmp/old.blk" "$tmp/new.blk" <<PY
import sys
s=open(sys.argv[1]).read(); old=open(sys.argv[3]).read(); new=open(sys.argv[4]).read()
assert new in s, "fixed block not found in the installed definition"
$body
assert s != open(sys.argv[1]).read(), "the mutation changed nothing"
open(sys.argv[2],"w").write(s)
PY
  P -f "$tmp/mut.sql" >/dev/null
  local b0=$bad n0=$n
  checks_after "M-$name-" >/dev/null 2>&1 || true
  local killed=$((bad-b0)); bad=$b0; n=$n0
  P -f "$tmp/fixed.sql" >/dev/null                                  # restore the fixed function
  if [ "$killed" -gt 0 ]; then echo "  MUTANT $name: KILLED by $killed check(s)"; else echo "  MUTANT $name: SURVIVED"; survivors=$((survivors+1)); fi
}
survivors=0
mutate exists_form_back   's = s.replace(new, old)'
mutate blocking_removed   's = s.replace(new, new.replace("> 0", "> 1000000000"))'
mutate blocking_always_on 's = s.replace(new, new.replace("> 0", ">= 0"))'
t "X01 all 3 prohibited weakenings are killed" "$survivors" 0
echo "MUTATIONS: $((3-survivors)) of 3 prohibited weakenings are killed"
echo "CHECKS: $n run, $bad failed"
[ "$bad" -eq 0 ]
