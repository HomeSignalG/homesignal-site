# shellcheck shell=bash
# Sourced by run.sh AFTER the plan/mutation sections (shares t, P, Q, tmp, FIX, LIVE_MD5, orig.sql, fixed.sql). DISPOSABLE database only.
#   MIGRATION  fail-closed apply + exact reversal, every refusal path, rollback on error, bounded lock wait
#   EQUIV      the ORIGINAL and the PATCHED collector produce byte-identical resulting state across a scenario matrix
#   PERF       worst-case COUNT(*) behaviour: huge arrays, thousands of one source, many failed sources, full batch, national fixture
REV="$root/docs/dev-refresh-collect-blocked-plan-stable-reverse.sql"
PIN_ORIG=2012877397532a1e8e160b5a7a4c8032; LEN_ORIG=15800
PIN_NEW=12b3dcc680b322af7d2cd61734be9b4c;  LEN_NEW=16047
FNQ="from pg_proc where proname='dev_refresh_collect' and pronamespace='public'::regnamespace"
fnmd5() { Q "select md5(prosrc)||'|'||length(prosrc) $FNQ"; }
setfn() { P -f "$tmp/$1.sql" >/dev/null; }                   # install orig|fixed|<variant file in tmp>
props() { Q "select p.proowner::regrole::text||'|'||coalesce(p.proacl::text,'')||'|'||p.prosecdef||'|'||coalesce(p.proconfig::text,'')||'|'||p.prorettype::regtype::text||'|'||p.provolatile||'|'||p.proparallel $FNQ" 2>/dev/null || true; }
mig() { # file -> sets MRC, MOUT
  set +e; MOUT="$(psql -X -v ON_ERROR_STOP=1 -f "$1" 2>&1)"; MRC=$?; set -e
}
variant() { # name  python-edit-of-s  (source: orig|fixed)
  local name="$1" src="$2" body="$3"
  python3 -I - "$tmp/$src.sql" "$tmp/$name.sql" <<PY
import sys
s=open(sys.argv[1]).read(); o=s
$body
assert s!=o, "variant changed nothing"
open(sys.argv[2],"w").write(s)
PY
}

# ── MIGRATION ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
setfn orig
t "M00 start state: the rebuilt collector is the approved ORIGINAL" "$(fnmd5)" "$PIN_ORIG|$LEN_ORIG"
Q "revoke all on function public.dev_refresh_collect() from public; grant execute on function public.dev_refresh_collect() to service_role" >/dev/null
P0="$(props)"
# independent expectation: the patched fingerprint recomputed here in Python from the ORIGINAL body and the blocks of the apply file
python3 -I - "$FIX" "$REV" "$tmp/orig.sql" "$PIN_ORIG" "$PIN_NEW" "$LEN_NEW" > "$tmp/indep.txt" <<'PY'
import hashlib,re,sys
fix,rev,orig,pin_o,pin_n,len_n=sys.argv[1:7]
def blocks(f):
    t=open(f).read()
    a=re.search(r"old_  text := \$a\$(.*?)\$a\$;",t,re.S).group(1); b=re.search(r"new_  text := \$b\$(.*?)\$b\$;",t,re.S).group(1)
    pins=re.findall(r"c_(orig_md5|orig_len|new_md5|new_len)\s+constant \w+\s*:=\s*'?(\w+)'?;",t)
    return a,b,dict(pins),t
a,b,pf,tf=blocks(fix); a2,b2,pr,tr=blocks(rev)
body=open(orig).read().split("$function$")[1]
assert hashlib.md5(body.encode()).hexdigest()==pin_o, "orig.sql body is not the approved original"
assert body.count(a)==1
p=body.replace(a,b)
print("indep_md5="+hashlib.md5(p.encode()).hexdigest()); print("indep_len=%d"%len(p))
print("pins_agree="+str(pf==pr and pf["new_md5"]==pin_n and pf["orig_md5"]==pin_o and pf["new_len"]==len_n))
print("blocks_agree="+str(a==a2 and b==b2))
# only the intended expression changed: the two bodies differ by exactly that one block, nothing else
print("only_block_changed="+str(p.replace(b,a)==body and len(p)-len(body)==len(b)-len(a)))
PY
IND_MD5="$(sed -n 's/^indep_md5=//p' "$tmp/indep.txt")"; IND_LEN="$(sed -n 's/^indep_len=//p' "$tmp/indep.txt")"
t "Y01 apply and reverse files carry the SAME blocks and the SAME pins, equal to the approved ones" "$(sed -n 's/^pins_agree=//p;s/^blocks_agree=//p' "$tmp/indep.txt" | tr '\n' ' ')" "True True "
t "M02 the patched fingerprint was established SEPARATELY (Python, from the original body) and equals the pin" "$IND_MD5|$IND_LEN" "$PIN_NEW|$LEN_NEW"
t "M08 only the one intended expression differs between the approved bodies" "$(sed -n 's/^only_block_changed=//p' "$tmp/indep.txt")" True
mig "$FIX"
t "M01 apply on the exact original: succeeds, body is the approved PATCHED fingerprint" "$MRC|$(fnmd5)" "0|$PIN_NEW|$LEN_NEW"
P1="$(props)"; P1DEF="$(Q "select md5(pg_get_functiondef('public.dev_refresh_collect()'::regprocedure))")"
t "M09 apply output carries before/after evidence and committed" "$(grep -c 'EVIDENCE before: md5=2012877397532a1e8e160b5a7a4c8032' <<<"$MOUT")|$(grep -c 'EVIDENCE after: md5=12b3dcc680b322af7d2cd61734be9b4c' <<<"$MOUT")|$(grep -c 'committed' <<<"$MOUT")" "1|1|1"
mig "$FIX"
t "M03 re-apply is a no-op ONLY on the exact patched fingerprint" "$MRC|$(fnmd5)|$(grep -c 'already at the approved PATCHED' <<<"$MOUT")" "0|$PIN_NEW|$LEN_NEW|1"
mig "$REV"
t "M04 reversal restores the approved ORIGINAL body" "$MRC|$(fnmd5)" "0|$PIN_ORIG|$LEN_ORIG"
mig "$REV"
t "M05 re-reversal is a no-op on the exact original" "$MRC|$(fnmd5)|$(grep -c 'already at the approved ORIGINAL' <<<"$MOUT")" "0|$PIN_ORIG|$LEN_ORIG|1"
P2="$(props)"
mig "$FIX"; P3="$(props)"; P3DEF="$(Q "select md5(pg_get_functiondef('public.dev_refresh_collect()'::regprocedure))")"
t "M06 apply → reverse → apply round-trips to the identical patched definition" "$(fnmd5)|$P3DEF" "$PIN_NEW|$LEN_NEW|$P1DEF"
t "M07 owner, ACL, SECURITY DEFINER, search_path, return type, volatility are identical before apply, after apply, after reverse and after re-apply" "$P0|$P1|$P2|$P3" "$P0|$P0|$P0|$P0"
t "M07b …and those properties are the production ones (SECURITY DEFINER, search_path=public, net, integer)" "$(Q "select prosecdef||'|'||proconfig::text||'|'||prorettype::regtype $FNQ")" "true|{\"search_path=public, net\"}|integer"
setfn fixed; mig "$REV"; setfn orig                              # leave the original installed for the refusal tests

refuse() { # id desc  state-md5-expected-after  (uses MRC MOUT)  — must exit non-zero with REFUSED/ROLLED BACK and leave the body untouched
  local id="$1" desc="$2" want="$3"
  t "$id $desc" "$([ "$MRC" -ne 0 ] && echo refused || echo ACCEPTED)|$(grep -cE 'REFUSED|ROLLED BACK|ERROR' <<<"$MOUT" | sed 's/^0$/none/;s/^[1-9].*/yes/')|$(fnmd5)" "refused|yes|$want"
}
variant drift orig 's=s.replace("\n  return n;\nend","\n  return n;\n  -- drift\nend",1)'
setfn drift; D="$(fnmd5)"; mig "$FIX"; refuse N01 "a DRIFTED body (original + a trailing comment) is refused and left untouched" "$D"
variant markeronly orig 's=s.replace("  -- ONE COLLECTOR AT A TIME","  -- (PLAN-STABLE marker only; the EXISTS form is still here)\n  -- ONE COLLECTOR AT A TIME",1)'
setfn markeronly; D="$(fnmd5)"; mig "$FIX"; refuse N02 "a body that merely carries the PLAN-STABLE marker is refused (a marker never permits success)" "$D"
variant halfpatch fixed 's=s.replace("f.registry_id) > 0","f.registry_id) >= 1",1)'
setfn halfpatch; D="$(fnmd5)"; mig "$FIX"; refuse N03 "a half-patched / hand-modified patched body is refused by apply" "$D"
variant patchedplus fixed 's=s.replace("\n  return n;\nend","\n  return n;\n  -- tampered\nend",1)'
setfn patchedplus; D="$(fnmd5)"; mig "$FIX"; refuse N04 "the patched body plus one comment is refused by apply (marker present, fingerprint not the approved one)" "$D"
mig "$REV"; refuse N08 "the reversal refuses an intervening change and does NOT overwrite it" "$D"
setfn markeronly; D="$(fnmd5)"; mig "$REV"; refuse N09 "the reversal refuses a marker-only / non-patched body" "$D"
setfn orig; Q "alter function public.dev_refresh_collect() security invoker" >/dev/null; D="$(fnmd5)"; mig "$FIX"
t "N05 a function that is not SECURITY DEFINER is refused (and stays so)" "$([ "$MRC" -ne 0 ] && echo refused)|$(Q "select prosecdef $FNQ")" "refused|f"
setfn orig; Q "alter function public.dev_refresh_collect() set search_path = public" >/dev/null; mig "$FIX"
t "N06 a changed search_path is refused" "$([ "$MRC" -ne 0 ] && echo refused)|$(Q "select proconfig::text $FNQ")" "refused|{search_path=public}"
setfn orig; Q "alter function public.dev_refresh_collect() set search_path = public, net" >/dev/null
Q "drop function public.dev_refresh_collect()" >/dev/null; mig "$FIX"
t "N07 a missing function is refused (nothing is created)" "$([ "$MRC" -ne 0 ] && echo refused)|$(Q "select count(*) $FNQ")" "refused|0"
setfn orig; Q "revoke all on function public.dev_refresh_collect() from public; grant execute on function public.dev_refresh_collect() to service_role" >/dev/null
sed "s/12b3dcc680b322af7d2cd61734be9b4c/00000000000000000000000000000000/" "$FIX" > "$tmp/badpin.sql"; mig "$tmp/badpin.sql"
t "N10 an apply whose planned replacement does not hit the approved fingerprint is refused BEFORE executing" "$([ "$MRC" -ne 0 ] && echo refused)|$(grep -c 'planned replacement fingerprints' <<<"$MOUT")|$(fnmd5)" "refused|1|$PIN_ORIG|$LEN_ORIG"
# a SQL error AFTER the function was replaced rolls everything back (DDL is transactional)
Q "create function public.inject_fail() returns event_trigger language plpgsql as \$\$ begin raise exception 'injected failure after CREATE FUNCTION'; end \$\$;
   create event trigger inject_fail_trg on ddl_command_end when tag in ('CREATE FUNCTION') execute function public.inject_fail()" >/dev/null
mig "$FIX"; t "N11 an error injected right after the replacement rolls the whole apply back (body still the original)" "$([ "$MRC" -ne 0 ] && echo failed)|$(grep -c 'injected failure' <<<"$MOUT")|$(fnmd5)" "failed|1|$PIN_ORIG|$LEN_ORIG"
Q "drop event trigger inject_fail_trg" >/dev/null; mig "$FIX"; setfn fixed
Q "create event trigger inject_fail_trg on ddl_command_end when tag in ('CREATE FUNCTION') execute function public.inject_fail()" >/dev/null
mig "$REV"; t "N12 an error injected during the REVERSAL rolls it back (body still the patched one)" "$([ "$MRC" -ne 0 ] && echo failed)|$(fnmd5)" "failed|$PIN_NEW|$LEN_NEW"
Q "drop event trigger inject_fail_trg; drop function public.inject_fail()" >/dev/null
# DDL does not get its lock immediately on a busy database: a concurrent uncommitted replace holds it; the apply must give up inside lock_timeout
setfn orig
( psql -X -q -c "begin" -c "$(cat "$tmp/orig.sql")" -c "select pg_sleep(9)" -c "rollback" >/dev/null 2>&1 ) &
HOLD=$!; sleep 1.5
t0=$(date +%s.%N); mig "$FIX"; t1=$(date +%s.%N); wait $HOLD || true
el="$(python3 -c "print(round($t1-$t0,1))")"
t "N13 behind a held lock the apply fails inside lock_timeout (3 s), not after the holder; nothing changed" "$([ "$MRC" -ne 0 ] && echo failed)|$(grep -ciE 'lock timeout' <<<"$MOUT" | sed 's/^[1-9].*/yes/')|$(python3 -c "print('fast' if $el < 7 else 'SLOW($el)')")|$(fnmd5)" "failed|yes|fast|$PIN_ORIG|$LEN_ORIG"
echo "  (lock wait observed: ${el} s)"
setfn orig; mig "$FIX"; mig "$REV"
t "M10 after every refusal test the forward and reverse paths still work from the original (no residue)" "$(fnmd5)|$P0" "$PIN_ORIG|$LEN_ORIG|$(props)"
setfn fixed

# ── EQUIVALENCE ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
equiv_fixture() {
  Q "truncate public.development_reports; truncate public.dev_refresh_source_failures; delete from net._http_response"
  Q "insert into public.development_reports(zip, sites, counts, paywall, echo, cwa, source_vintage, refreshed_at, last_collected_response_id, facilities_refreshed_at, facilities_unavailable)
     select lpad((7000+g)::text,5,'0'),
       case (g-1)%12
         when 5 then '[]'::jsonb
         when 6 then (select jsonb_agg(x) from (select jsonb_build_object('source_registry_id','F1','title','dup','record_url','https://e.test/d') x from generate_series(1,3) union all select jsonb_build_object('source_registry_id','a','title','T'||m,'record_url','https://e.test/'||g||'/'||m) from generate_series(1,2) m) q)
         else (select jsonb_agg(jsonb_build_object('source_registry_id','a','title','S'||g||'-'||m,'record_url','https://e.test/s/'||g||'/'||m)) from generate_series(1,5) m)
              || case (g-1)%12 when 1 then (select jsonb_agg(jsonb_build_object('source_registry_id','F1','title','F1-'||m,'record_url','https://e.test/f/'||g||'/'||m)) from generate_series(1,3) m)
                               when 3 then (select jsonb_agg(jsonb_build_object('source_registry_id','F1','title','F1-'||m,'record_url','https://e.test/f/'||g||'/'||m)) from generate_series(1,2) m)
                               when 11 then (select jsonb_agg(jsonb_build_object('registry_id','r'||m,'source_registry_id','F1','title','fac-'||m,'record_url','https://e.test/fac/'||m)) from generate_series(1,2) m)
                               else '[]'::jsonb end
       end,
       case (g-1)%12 when 5 then '{\"development\":0,\"facilities\":0}'::jsonb else '{\"development\":5,\"facilities\":0}'::jsonb end,
       (g%3=0), case when g%2=0 then '{\"e\":1}'::jsonb end, case when g%4=0 then '{\"c\":2}'::jsonb end, 'seed',
       case when (g-1)%12=10 then now()-interval '10 days' else now()-interval '1 day' end,
       case when g%5=0 then null else 100 end, now()-interval '1 day', (g%7=0)
     from generate_series(1,270) g"
  Q "analyze public.development_reports"
  Q "select setval('net.http_request_queue_id_seq', 1000000)" >/dev/null          # cursors below the counter: the restart-heal (R) must not touch fixture rows
}
# scen <variant-file> <N> <seed> <kind(-1 mixed)> <ticks> <dup 0|1>   -> a full normalised dump of the resulting state after every tick
scen() {
  local variant="$1" N="$2" seed="$3" kind="$4" ticks="$5" dup="$6" i
  {
  cat <<SQL
\set ON_ERROR_STOP on
begin;
\i $variant
create function pg_temp.mk(idx int, zip text, twin boolean) returns jsonb language plpgsql as \$f\$
declare k int := (idx-1)%12; sites jsonb; fl text[] := '{}'; cnt jsonb := '{"development":5,"facilities":0}'; rep jsonb := '[]';
begin
  sites := (select jsonb_agg(jsonb_build_object('title','P'||idx||'-'||m,'record_url','https://e.test/'||idx||'/'||m,'source_registry_id','a','scope','point')) from generate_series(1,5) m);
  if k = 9 then sites := sites || jsonb_build_array(jsonb_build_object('title','P'||idx||'-1','record_url','https://e.test/'||idx||'/1','source_registry_id','a','scope','point')); end if;
  if k in (7,10) then sites := '[]'; cnt := '{"development":0,"facilities":0}'; end if;
  if k = 8 then sites := '{}'; end if;
  fl := case k when 1 then '{F1}' when 2 then '{F9}' when 3 then '{F1,F9}' when 4 then '{F8,F9}' when 5 then '{F1}' when 6 then '{F1}' when 11 then '{F1}' else '{}' end;
  if twin then sites := '[]'; cnt := '{"development":0,"facilities":0}'; fl := '{F1}'; end if;
  if cardinality(fl) > 0 then
    rep := (select jsonb_agg(jsonb_build_object('registry_id', s, 'quarantined', jsonb_build_array(jsonb_build_object('reason','fetch failed: rate limited')))) from unnest(fl) s);
  end if;
  return jsonb_build_object('mode','zip','zip',zip,'counts',cnt,'sites',sites,'epa','{"ok":true}'::jsonb,'arcgis_reports',coalesce(rep,'[]'::jsonb));
end \$f\$;
SQL
  if [ "$dup" = 1 ]; then cat <<SQL
insert into net._http_response(id,status_code,content_type,content,created)
select 190000+i, 200, 'application/json', pg_temp.mk(idx, lpad((7000+idx)::text,5,'0'), true)::text, now()
  from (select i, case when $kind < 0 then i + $seed*5 else $kind+1 + 12*(i-1) end idx from generate_series(1,$N) i) s;
SQL
  fi
  cat <<SQL
insert into net._http_response(id,status_code,content_type,content,created)
select 200000+i, 200, 'application/json', pg_temp.mk(idx, lpad((7000+idx)::text,5,'0'), false)::text, now()
  from (select i, case when $kind < 0 then i + $seed*5 else $kind+1 + 12*(i-1) end idx from generate_series(1,$N) i) s;
create temp table before_t as select * from public.development_reports;
SQL
  for i in $(seq 1 "$ticks"); do cat <<SQL
select public.dev_refresh_collect() as ret \gset
\qecho RET|$i|:ret
select 'ROW|$i|'||zip||'|'||coalesce(md5(sites::text),'-')||'|'||coalesce(counts::text,'-')||'|'||coalesce(paywall::text,'-')||'|'||coalesce(md5(echo::text),'-')||'|'||coalesce(md5(cwa::text),'-')||'|'||coalesce(source_vintage,'-')||'|'||(case when refreshed_at=now() then 'ADV' else coalesce(refreshed_at::text,'-') end)||'|'||(case when facilities_refreshed_at=now() then 'ADV' else coalesce(facilities_refreshed_at::text,'-') end)||'|'||coalesce(last_collected_response_id::text,'-')||'|'||coalesce(facilities_unavailable::text,'-') from public.development_reports order by zip collate "C";
select l from (select 'FAIL|$i|'||zip||'|'||registry_id||'|'||reason||'|'||cached_records||'|'||blocked_update||'|'||kind||'|'||coalesce(detail::text,'-') as l from public.dev_refresh_source_failures) q order by l collate "C";
select 'RESP|$i|'||count(*)||'|'||md5(coalesce(string_agg(id||content, ',' order by id),'')) from net._http_response;
select 'OUT|$i|'||r.id||'|'||d.zip||'|'||case when d.last_collected_response_id = r.id and d.refreshed_at is distinct from b.refreshed_at then 'ACCEPTED' when d.last_collected_response_id = r.id and d.last_collected_response_id is distinct from b.last_collected_response_id then 'REFUSED' when d.last_collected_response_id = r.id then 'ALREADY' else 'PENDING' end
  from net._http_response r join public.development_reports d on d.zip = r.content::jsonb->>'zip' join before_t b on b.zip = d.zip where r.id >= 200000 order by r.id;
select 'ADVTICK|$i|'||d.zip from public.development_reports d join before_t b using (zip) where d.refreshed_at is distinct from b.refreshed_at or d.facilities_refreshed_at is distinct from b.facilities_refreshed_at order by d.zip collate "C";
select 'INV|$i|UNRELATED_CHANGED|'||count(*) from public.development_reports d join before_t b using (zip) where d.last_collected_response_id is not distinct from b.last_collected_response_id and to_jsonb(d) <> to_jsonb(b);
select 'INV|$i|REFUSED_ROW_TOUCHED|'||count(*) from public.development_reports d join before_t b using (zip) where d.last_collected_response_id is distinct from b.last_collected_response_id and d.refreshed_at is not distinct from b.refreshed_at and (to_jsonb(d) - 'last_collected_response_id') <> (to_jsonb(b) - 'last_collected_response_id');
select 'INV|$i|ACCEPTED_IDENTITY_MISMATCH|'||count(*) from public.development_reports d join net._http_response r on r.id = d.last_collected_response_id
  where d.refreshed_at = now() and
    (select md5(coalesce(string_agg(x->>'record_url'||'|'||(x->>'title'), ',' order by x->>'record_url' collate "C", x->>'title' collate "C"), '')) from jsonb_array_elements(d.sites) x where not (x ? 'registry_id'))
    is distinct from
    (select md5(coalesce(string_agg(x->>'record_url'||'|'||(x->>'title'), ',' order by x->>'record_url' collate "C", x->>'title' collate "C"), '')) from jsonb_array_elements(case when jsonb_typeof(r.content::jsonb->'sites')='array' then r.content::jsonb->'sites' else '[]'::jsonb end) x where not (x ? 'registry_id'));
select 'INV|$i|ACCEPTED|'||count(*) from public.development_reports d join before_t b using (zip) where d.refreshed_at = now() and b.refreshed_at is distinct from now();
select 'INV|$i|REFUSED|'||count(*) from public.development_reports d join before_t b using (zip) where d.last_collected_response_id is distinct from b.last_collected_response_id and d.refreshed_at is not distinct from b.refreshed_at;
drop table before_t; create temp table before_t as select * from public.development_reports;
SQL
  done
  echo "rollback;"
  } > "$tmp/scen.sql"
  psql -X -qtA -v ON_ERROR_STOP=1 -f "$tmp/scen.sql" 2>&1
}
# one comparison: ORIGINAL vs PATCHED must print byte-identical state. Returns 0/1; appends the NEW output to $tmp/equiv_all.txt
equiv_one() { # N seed kind ticks dup label
  local o n; o="$(scen "$tmp/orig.sql" "$1" "$2" "$3" "$4" "$5")"; n="$(scen "$tmp/fixed.sql" "$1" "$2" "$3" "$4" "$5")"
  if grep -qE 'ERROR|FATAL' <<<"$o$n"; then echo "    ($6: scenario error: $(grep -m1 -E 'ERROR|FATAL' <<<"$o$n"))"; return 1; fi
  printf '%s\n' "$n" >> "$tmp/equiv_all.txt"; printf '%s\n' "$o" > "$tmp/o_$6.txt"; printf '%s\n' "$n" > "$tmp/n_$6.txt"
  if [ "$o" = "$n" ]; then return 0; fi
  echo "    ($6: DIFFERS — first difference:)"; diff "$tmp/o_$6.txt" "$tmp/n_$6.txt" | head -4; return 1
}
equiv_fixture; : > "$tmp/equiv_all.txt"
fails() { local f=0; for c in "$@"; do eval "equiv_one $c" || f=$((f+1)); done; echo $f; }
t "Q01 1 response (all 12 scenario shapes, one each): full state identical" "$(fails "1 0 -1 1 0 q01a" "1 1 -1 1 0 q01b" "1 2 -1 1 0 q01c" "1 3 -1 1 0 q01d" "1 4 -1 1 0 q01e" "1 5 -1 1 0 q01f" "1 6 -1 1 0 q01g" "1 7 -1 1 0 q01h" "1 8 -1 1 0 q01i" "1 9 -1 1 0 q01j" "1 10 -1 1 0 q01k" "1 11 -1 1 0 q01l")" 0
t "Q02 8 responses (3 mixes): full state identical" "$(fails "8 0 -1 1 0 q02a" "8 1 -1 1 0 q02b" "8 2 -1 1 0 q02c")" 0
t "Q03 12 responses (3 mixes): full state identical" "$(fails "12 0 -1 1 0 q03a" "12 1 -1 1 0 q03b" "12 2 -1 1 0 q03c")" 0
t "Q04 16 responses = the batch cap (3 mixes): full state identical" "$(fails "16 0 -1 1 0 q04a" "16 1 -1 1 0 q04b" "16 2 -1 1 0 q04c")" 0
t "Q05 16 responses each with an OLDER twin for the same ZIP (newest wins): full state identical" "$(fails "16 0 -1 1 1 q05a" "16 1 -1 1 1 q05b")" 0
t "Q06 multiple sequential ticks (20 responses over 3 ticks: 16 + 4 + 0): full state identical after EVERY tick" "$(fails "20 0 -1 3 0 q06a" "20 1 -1 3 0 q06b" "20 2 -1 3 1 q06c")" 0
pure=""; for k in 0 1 2 3 4 5 6 7 8 9 10 11; do pure="$pure \"16 0 $k 1 0 q07_$k\""; done
t "Q07 16 responses of ONE shape each (no failures · failed source with records · without · several failed · empty sites · duplicate identities · guards · facilities): identical" "$(eval fails $pure)" 0
variant mutblock fixed 's=s.replace("f.registry_id) > 0","f.registry_id) > 1000000000",1)'
O1="$(scen "$tmp/orig.sql" 16 0 1 1 0)"; M1="$(scen "$tmp/mutblock.sql" 16 0 1 1 0)"
t "Q10 sensitivity control: the equivalence comparison FAILS when blocking is removed (so a passing Q01-Q07 can fail)" "$([ "$O1" != "$M1" ] && echo differs || echo SAME)" differs
tot() { grep -c "$1" "$tmp/equiv_all.txt" || true; }
t "Q08 the invariants hold in every run: unrelated rows unchanged, refused rows untouched, accepted identities equal the payload's (duplicates kept)" "$(grep -E '^INV\|[0-9]+\|(UNRELATED_CHANGED|REFUSED_ROW_TOUCHED|ACCEPTED_IDENTITY_MISMATCH)\|' "$tmp/equiv_all.txt" | awk -F'|' '$4!=0' | wc -l)" 0
acc="$(awk -F'|' '$3=="ACCEPTED"{s+=$4} END{print s+0}' <(grep -E '^INV\|[0-9]+\|ACCEPTED\|' "$tmp/equiv_all.txt"))"; ref="$(awk -F'|' '$3=="REFUSED"{s+=$4} END{print s+0}' <(grep -E '^INV\|[0-9]+\|REFUSED\|' "$tmp/equiv_all.txt"))"
t "Q09 positive control: the matrix really accepted and really refused rows (so the zero invariants mean something)" "$([ "$acc" -gt 100 ] && [ "$ref" -gt 100 ] && echo yes || echo "no(acc=$acc ref=$ref)")" yes
echo "  (matrix totals across all runs: $acc rows accepted, $ref refused-and-handled; $(grep -c '^FAIL|' "$tmp/equiv_all.txt") source-failure rows logged)"
# pinned per-shape outcomes (what the live collector does with 16 responses of one shape): blocks only where the ZIP stores the failed source
exp_w="0:16 1:0 2:16 3:0 4:16 5:16 6:0 7:16 8:0 9:16 10:16 11:0"; got_w=""
for k in 0 1 2 3 4 5 6 7 8 9 10 11; do got_w="$got_w $k:$(awk -F'|' '$1=="RET"{print $3}' "$tmp/n_q07_$k.txt")"; done
t "S01 pinned outcomes per shape (writes out of 16): failed source STORED ⇒ blocked (0); not stored / empty / none ⇒ written (16); non-array payload withheld (0)" "${got_w# }" "$exp_w"
t "S02 blocked ZIPs are recorded as blocked_update=true with their cached record count, unblocked failures as false" "$(grep -c '^FAIL|1|[0-9]*|F1|.*|3|true|fetch_failed' "$tmp/n_q07_1.txt")|$(grep -c '^FAIL|1|[0-9]*|F9|.*|0|false|fetch_failed' "$tmp/n_q07_2.txt")" "16|16"

# ── PERFORMANCE: worst-case COUNT(*) ───────────────────────────────────────────────────────────────────────────────────────────
pad() { echo "md5(random()::text)||md5(random()::text)||md5(random()::text)||md5(random()::text)"; }
Q "truncate public.development_reports; delete from net._http_response"
Q "insert into public.development_reports(zip, sites, counts, paywall, refreshed_at, last_collected_response_id, facilities_refreshed_at)
   select lpad(g::text,5,'0'),
          (select jsonb_agg(jsonb_build_object('source_registry_id',(array['maine-dot-public-projects','maine-dot-public-projects-lines','fairfax-recent-building-permits','s4','s5','s6','s7','s8'])[1+(g+k)%8],
                 'title','Permit '||g||'-'||k,'record_url','https://example.test/'||g||'/'||k,'scope','point','status','Issued','pad',md5(g||'a'||k)||md5(k||'b'||g)||md5(g||'c'||k)||md5(k||'d'||g))) from generate_series(1,100) k),
          '{\"development\":100,\"facilities\":0}'::jsonb, false, now()-interval '3 days', 0, now()-interval '3 days' from generate_series(1,12722) g"
# the worst arrays: 40,000 sites (~6 MB compressed, ~14 MB raw) in one ZIP · 6,000 sites of ONE failed source in another
Q "insert into public.development_reports(zip, sites, counts, paywall, refreshed_at, last_collected_response_id, facilities_refreshed_at)
   select '90001', (select jsonb_agg(jsonb_build_object('source_registry_id',(array['maine-dot-public-projects','maine-dot-public-projects-lines','fairfax-recent-building-permits','s4','s5','s6','s7','s8'])[1+k%8],'title','H-'||k,'record_url','https://example.test/h/'||k,'scope','point','pad',$(pad))) from generate_series(1,40000) k), '{\"development\":1}'::jsonb, false, now()-interval '3 days', 0, now()-interval '3 days'
   union all
   select '90002', (select jsonb_agg(jsonb_build_object('source_registry_id','maine-dot-public-projects','title','O-'||k,'record_url','https://example.test/o/'||k,'pad',md5(random()::text)||md5(random()::text))) from generate_series(1,6000) k), '{\"development\":1}'::jsonb, false, now()-interval '3 days', 0, now()-interval '3 days'"
Q "vacuum analyze public.development_reports"
TOTAL_BLK="$(Q "select pg_relation_size('public.development_reports')/8192 + coalesce((select pg_relation_size(reltoastrelid) from pg_class where oid='public.development_reports'::regclass),0)/8192")"
python3 -I - "$tmp/orig.sql" "$tmp/fixed.sql" "$tmp" <<'PY'
import re,sys
for src,dst in ((sys.argv[1],"blk_orig"),(sys.argv[2],"blk_fixed")):
    m=re.search(r"blocked as \(\s*(select distinct.*?)\n  \),",open(src).read(),re.S); open(sys.argv[3]+"/"+dst+".sql","w").write(m.group(1))
PY
# probe <label> <failed-ids csv> <zips csv> <orig|fixed> -> "ms|buffers|seq|hash|pkey|pages_bound"
probe() {
  local fs="$2" zs="$3" which="$4" pre="" ; [ "$which" = orig ] && pre="set enable_hashjoin=off; set enable_mergejoin=off;"   # orig = the best EXISTS plan the planner could have chosen
  local sql="explain (analyze, buffers, timing off, format json) with resp as (select i::bigint rid, jsonb_build_object('zip', z, 'arcgis_reports', (select jsonb_agg(jsonb_build_object('registry_id', s, 'quarantined', jsonb_build_array(jsonb_build_object('reason','fetch failed: x')))) from unnest(string_to_array('$fs', ',')) s)) j from unnest(string_to_array('$zs', ',')) with ordinality t(z,i)) , blocked as ($(cat "$tmp/blk_$which.sql")) select count(*) from blocked"
  psql -X -qtA -v ON_ERROR_STOP=1 -c "$pre" -c "$sql" 2>&1 | python3 -I -c "
import json,sys
raw=sys.stdin.read()
if '[' not in raw: sys.exit('probe failed: '+raw[:600])
i=raw.index('['); d=json.loads(raw[i:])[0]; p=d['Plan']; s=json.dumps(d)
def tot(n,k): return n.get(k,0)+sum(tot(c,k) for c in n.get('Plans',[]))
print('%d|%d|%s|%s|%s'%(round(d['Execution Time']), p.get('Shared Hit Blocks',0)+p.get('Shared Read Blocks',0),
  'yes' if 'Seq Scan' in s and 'development_reports' in s and '\"Relation Name\": \"development_reports\"' in s and '\"Node Type\": \"Seq Scan\"' in s else 'no',
  'yes' if 'Hash' in s else 'no', 'yes' if 'development_reports_pkey' in s else 'no'))"
}
pages_bound() { # fs zs -> sum over (zip, failed id) probes of pages read
  Q "select coalesce(sum(ceil(pg_column_size(d.sites)/7800.0)+3),0)::int from unnest(string_to_array('$2', ',')) z join public.development_reports d on d.zip=z, unnest(string_to_array('$1', ',')) f"
}
FS1=maine-dot-public-projects
FS5="maine-dot-public-projects,maine-dot-public-projects-lines,fairfax-recent-building-permits,s4,s5"
ZS16="90001,90002,$(seq -s, 100 113)"
pf() { # id desc fs zs
  local id="$1" desc="$2" fs="$3" zs="$4" c b bound cm cb sq ha pk
  c="$(probe x "$fs" "$zs" fixed)"; b="$(probe x "$fs" "$zs" orig)"; bound="$(pages_bound "$fs" "$zs")"
  IFS='|' read -r cm cb sq ha pk <<<"$c"; local bm bb; bm="${b%%|*}"; bb="$(cut -d'|' -f2 <<<"$b")"
  echo "  ($id: COUNT ${cm} ms, ${cb} buffers · best-case EXISTS ${bm} ms, ${bb} buffers · touched-array pages ${bound} · table ${TOTAL_BLK} blocks — disposable PG, not production)"
  t "${id}a $desc: no seq scan, no hash, primary-key probe" "$sq|$ha|$pk" "no|no|yes"
  t "${id}b …buffers proportional to the touched arrays (<= 1.5x their pages + 300) and below ONE scan of the table" "$([ "$cb" -le $((bound*3/2+300)) ] && [ "$cb" -lt $TOTAL_BLK ] && echo yes || echo "no($cb>$bound)")" yes
  t "${id}c …COUNT reads no more than the best-case EXISTS (<= 1.25x + 100 buffers) and is not >3x + 1 s slower, and < 5 s" "$([ "$cb" -le $((bb*5/4+100)) ] && [ "$cm" -le $((bm*3+1000)) ] && [ "$cm" -lt 5000 ] && echo yes || echo no)" yes
}
pf PF01 "one huge array (40,000 sites), 1 failed source" "$FS1" 90001
pf PF02 "6,000 sites of the one failed source" "$FS1" 90002
pf PF03 "huge array, 5 failed sources in one response" "$FS5" 90001
pf PF04 "full 16-response batch, 5 failed sources each, huge + 6,000-site + 14 small ZIPs" "$FS5" "$ZS16"
# a full tick on the national fixture with huge ZIPs in the batch
setfn fixed
T16="$(P <<SQL
begin;
insert into net._http_response(id,status_code,content_type,content,created)
select 300000+i, 200, 'application/json',
       jsonb_build_object('mode','zip','zip', case when i=1 then '90001' when i=2 then '90002' else lpad((100+i)::text,5,'0') end,
          'counts','{"development":100,"facilities":0}'::jsonb,'sites','[{"title":"x","record_url":"https://example.test/x"}]'::jsonb,'epa','{"ok":true}'::jsonb,
          'arcgis_reports', (select jsonb_agg(jsonb_build_object('registry_id', s, 'quarantined', jsonb_build_array(jsonb_build_object('reason','fetch failed: x')))) from unnest(string_to_array('$FS5', ',')) s))::text, now()
  from generate_series(1,16) i;
select set_config('t.t0', clock_timestamp()::text, true) as x0 \gset
select public.dev_refresh_collect() as written \gset
select round(extract(epoch from clock_timestamp() - current_setting('t.t0')::timestamptz) * 1000) as ms \gset
rollback;
select :'ms' || '|' || :'written';
SQL
)"
echo "  (PF05 full 16-response tick on the 12,722-ZIP fixture incl. the 40,000-site and 6,000-site ZIPs, 5 failed sources each: ${T16%%|*} ms, ${T16##*|} written — disposable PG, not production)"
t "PF05 that full tick completes in under 5 s and blocks all 16 (each stores the failed sources)" "$([ "${T16%%|*}" -lt 5000 ] && echo fast || echo "SLOW(${T16%%|*})")|${T16##*|}" "fast|0"
