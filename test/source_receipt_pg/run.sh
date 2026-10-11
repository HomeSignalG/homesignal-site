#!/usr/bin/env bash
# docs/dev-source-receipt.sql against the LIVE dev_refresh_collect() (rebuilt and fingerprinted by test/dev_collect_harness/build.sh)
# on a DISPOSABLE Postgres. Nothing here fakes an outcome: the collector accepts or refuses a response, and the receipt is whatever
# the trigger recorded from that row update.
set -euo pipefail
: "${PGHOST:?}" "${PGDATABASE:?}"
case "$PGDATABASE" in *disposable*) ;; *) echo "ABORT: PGDATABASE must name a disposable database (got '$PGDATABASE')"; exit 1;; esac
here="$(cd "$(dirname "$0")" && pwd)"; root="$here/../.."
P() { psql -X -qtA -v ON_ERROR_STOP=1 "$@"; }
Q() { P -c "$1"; }
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
n=0; bad=0
t() { n=$((n+1)); if [ "$2" = "$3" ]; then echo "  $1|t"; else echo "  $1|f|got=[$2] want=[$3]"; bad=$((bad+1)); fi; }

build() { # $1 = the receipt SQL under test
  bash "$root/test/dev_collect_harness/build.sh" >/dev/null 2>"$tmp/build_err" || { cat "$tmp/build_err" >&2; exit 1; }
  P -f "$1" >/dev/null
  P -f "$here/helpers.sql" >/dev/null
}
fire() { Q "select public.t_fire('$1', ARRAY[$2]::jsonb[]${3:-})"; }       # zip, reports(sql list), extra args
collect() { Q "select public.dev_refresh_collect()"; }
gen() { local id; id="$(fire "$1" "$2" "${3:-}")"; collect >/dev/null; echo "$id"; }
C() { Q "select $3 from public.dev_source_continuity where zip='$1' and registry_id='$2'"; }   # zip reg expr
G() { Q "select count(*) from public.dev_refresh_generation where zip='$1' and $2"; }
EXP() { echo "public.t_exp('$1','$2')"; }; INC() { echo "public.t_inc('$1','$2')"; }; FB() { echo "public.t_fb('$1')"; }
LEG() { echo "public.t_leg('$1')"; }; FAIL() { echo "public.t_fail('$1')"; }

run_checks() {
  build "$1"
  Q "select public.t_reset()" >/dev/null

  # ═══ A. the accepted response is bound to the accepted cache write ═══════════════════════════════════════════════════════════════
  Q "select public.t_zip('71001')" >/dev/null
  id1="$(gen 71001 "$(EXP s1 v1),$(EXP s2 v1)")"
  t 'A01 an accepted response leaves exactly one accepted generation row, naming that response' "$(G 71001 "outcome='accepted' and response_id=$id1")" 1
  t 'A02 ...whose tick is the cache clock written in the same row update' "$(Q "select (g.tick_at = d.refreshed_at)::text from public.dev_refresh_generation g join public.development_reports d using (zip) where g.zip='71001' and g.response_id=$id1 and g.outcome='accepted'")" true
  t 'A03 the cursor names that response' "$(Q "select last_collected_response_id from public.development_reports where zip='71001'")" "$id1"
  t 'A04 every source got a continuity row at gen 1 describing the current cache' "$(Q "select count(*) from public.dev_source_continuity_state where zip='71001' and gen_seq=1 and describes_current_cache and last_response_id=$id1")" 2
  t 'A05 the generation row records the source counts' "$(Q "select sources||'/'||not_complete from public.dev_refresh_generation where zip='71001' and outcome='accepted'")" "2/0"

  # a response the collector EVALUATES and REFUSES (an unexplained development collapse on a fresh row) is not an accepted generation
  Q "select public.t_zip('71002', '[]', '{\"development\":3}', '1 hour')" >/dev/null
  idr="$(fire 71002 "$(EXP s1 v1)")"; collect >/dev/null
  t 'A06 a refused response: cursor moved, cache clock did not' "$(Q "select (last_collected_response_id=$idr and refreshed_at < now() - interval '30 minutes')::text from public.development_reports where zip='71002'")" true
  t 'A07 ...recorded as refused, never as accepted' "$(G 71002 "response_id=$idr and outcome='refused'")|$(G 71002 "outcome='accepted'")" "1|0"
  t 'A08 ...and it created NO continuity claim for that response' "$(Q "select count(*) from public.dev_source_continuity where zip='71002'")" 0

  # accepted, then refused: the cache still describes the accepted generation, and that receipt stays valid
  Q "select public.t_zip('71003')" >/dev/null
  ida="$(gen 71003 "$(EXP s1 v1)")"
  Q "update public.development_reports set counts='{\"development\":4}' where zip='71003'" >/dev/null
  idb="$(fire 71003 "$(EXP s1 v1)" ", '{\"development\":0}'")"; collect >/dev/null
  t 'A09 accepted then refused: the refused response is recorded as refused' "$(G 71003 "response_id=$idb and outcome='refused'")" 1
  t 'A10 ...and the accepted generation still describes the current cache (a refusal does not disturb it)' "$(Q "select describes_current_cache::text||'/'||gen_seq from public.dev_source_continuity_state where zip='71003' and registry_id='s1'")" "true/1"

  # idempotence / retry / order
  collect >/dev/null; collect >/dev/null
  t 'A11 re-running the collector for an already-evaluated response changes nothing' "$(G 71001 "outcome='accepted'")|$(C 71001 s1 gen_seq)" "1|1"
  Q "select public.t_zip('71004')" >/dev/null; Q "select setval('net.http_request_queue_id_seq', 5000)" >/dev/null
  hi="$(fire 71004 "$(EXP s1 v1)")"; collect >/dev/null
  lo=$((hi-1000)); Q "insert into net._http_response (id,status_code,content,created) values ($lo,200,(select content from net._http_response where id=$hi),now())" >/dev/null; collect >/dev/null
  t 'A12 an OLDER response landing after a newer one was evaluated is never applied' "$(G 71004 "response_id=$lo")|$(C 71004 s1 gen_seq)" "0|1"
  id5="$(gen 71004 "$(EXP s1 v1)")"; id6="$(gen 71004 "$(EXP s1 v1)")"
  t 'A13 two accepted responses in a row: BOTH generations are recorded, the sequence advances by exactly one each' "$(C 71004 s1 gen_seq)|$(G 71004 "outcome='accepted'")" "3|3"

  # the receipt commits with the cache write or not at all
  Q "select public.t_zip('71005')" >/dev/null
  idx="$(fire 71005 "$(EXP s1 v1)")"
  psql -X -q -c "do \$\$ begin perform public.dev_refresh_collect(); raise exception 'collector transaction rolled back'; end \$\$" >/dev/null 2>&1 || true
  t 'A14 a collector transaction that rolls back leaves no generation, no continuity, and the cursor unmoved' "$(G 71005 'true')|$(Q "select count(*) from public.dev_source_continuity where zip='71005'")|$(Q "select coalesce(last_collected_response_id,0) from public.development_reports where zip='71005'")" "0|0|0"
  collect >/dev/null
  t 'A15 ...and the very next collector run applies the same response exactly once' "$(G 71005 "response_id=$idx and outcome='accepted'")|$(C 71005 s1 gen_seq)" "1|1"

  # a restart heal moves the cursor DOWN: not an event
  Q "select public.t_zip('71006')" >/dev/null
  Q "update public.development_reports set last_collected_response_id = 999999 where zip='71006'" >/dev/null
  b="$(G 71006 'true')"; collect >/dev/null
  t 'A16 the restart heal (cursor moved down) is not recorded as a generation' "$(G 71006 'true')" "$b"

  # writes nobody can attribute, and payloads that cannot be read
  Q "select public.t_zip('71007')" >/dev/null
  gen 71007 "$(EXP s1 v1)" >/dev/null
  Q "update public.development_reports set refreshed_at = now() where zip='71007'" >/dev/null
  t 'A17 a cache write with no response behind it is recorded as unattributed and breaks every source' "$(G 71007 "outcome='unattributed'")|$(C 71007 s1 "scope||'/'||break_seq||'/'||gen_seq")" "1|unattributed/2/2"
  Q "select public.t_zip('71008')" >/dev/null
  gen 71008 "$(EXP s1 v1)" >/dev/null
  Q "update public.development_reports set last_collected_response_id=888888, refreshed_at=now() where zip='71008'" >/dev/null
  t 'A18 a cursor naming a response that cannot be read is accepted-but-unreadable: no evidence, source breaks' "$(G 71008 "outcome='unreadable'")|$(C 71008 s1 break_seq)" "1|2"
  Q "select public.t_zip('71009')" >/dev/null
  gen 71009 "$(EXP s1 v1)" >/dev/null
  Q "insert into net._http_response (id,status_code,content,created) values (777777,200,'{\"zip\":\"00000\",\"mode\":\"zip\"}',now())" >/dev/null
  Q "update public.development_reports set last_collected_response_id=777777, refreshed_at=now() where zip='71009'" >/dev/null
  t 'A19 a response for ANOTHER ZIP is never attributed to this one' "$(G 71009 "outcome='unreadable'")" 1

  # replaying a generation step is idempotent
  Q "select public.t_zip('71011')" >/dev/null
  gen 71011 "$(EXP s1 v1)" >/dev/null
  tk="$(Q "select last_tick_at from public.dev_source_continuity where zip='71011' and registry_id='s1'")"
  Q "select count(*) from public.dev_continuity_step('71011', '$tk'::timestamptz, 1, (select content::jsonb from net._http_response order by id desc limit 1), 'accepted', '[]'::jsonb)" >/dev/null
  t 'A22 replaying the same generation step (same tick) does not advance the sequence' "$(C 71011 s1 gen_seq)" 1

  # diagnostics can never hold the collector hostage
  Q "select public.t_zip('71010')" >/dev/null
  Q "alter table public.dev_source_continuity add constraint t_boom check (registry_id <> 'boom') not valid" >/dev/null
  idz="$(fire 71010 "$(EXP boom v1)")"; r="$(collect)"
  t 'A20 a receipt that cannot be stored does NOT stop the collector: the cache write lands' "$r|$(Q "select (last_collected_response_id=$idz)::text from public.development_reports where zip='71010'")" "1|true"
  t 'A21 ...and leaves no continuity claim for that generation (the ledger will hold)' "$(Q "select count(*) from public.dev_source_continuity where zip='71010' and last_tick_at=(select refreshed_at from public.development_reports where zip='71010')")" 0
  Q "alter table public.dev_source_continuity drop constraint t_boom" >/dev/null

  # ═══ B. durable continuity per ZIP x source ═════════════════════════════════════════════════════════════════════════════════════
  Q "select public.t_reset()" >/dev/null; Q "select public.t_zip('72001')" >/dev/null
  gen 72001 "$(EXP s1 v1),$(EXP s2 v1)" >/dev/null
  t 'B01 first complete expanded generation: gen 1, break 1 (first_generation), baseline pending' "$(C 72001 s1 "gen_seq||'/'||break_seq||'/'||break_reason")|$(Q "select continuity_state from public.dev_source_continuity_state where zip='72001' and registry_id='s1'")" "1/1/first_generation|baseline_pending"
  gen 72001 "$(EXP s1 v1),$(EXP s2 v1)" >/dev/null
  t 'B02 a second complete expanded read at the same version continues it: break stays at 1' "$(C 72001 s1 "gen_seq||'/'||break_seq")|$(Q "select continuity_state from public.dev_source_continuity_state where zip='72001' and registry_id='s1'")" "2/1|complete"
  gen 72001 "$(EXP s1 v2),$(EXP s2 v1)" >/dev/null
  t 'B03 a changed scope version breaks s1 only, with its reason' "$(C 72001 s1 "break_seq||'/'||break_reason")|$(C 72001 s2 break_seq)" "3/scope_version_changed|1"
  gen 72001 "$(INC s1 v2),$(EXP s2 v1)" >/dev/null
  t 'B04 an incomplete expanded read breaks s1, opens a gap, and is reported unhealthy' "$(C 72001 s1 "break_seq||'/'||(impaired_since is not null)::text")|$(Q "select continuity_state from public.dev_source_continuity_state where zip='72001' and registry_id='s1'")" "4/true|failed_or_incomplete"
  t 'B05 ...while s2 (same ZIP, same generation) is untouched: sources are independent' "$(C 72001 s2 "break_seq||'/'||(impaired_since is null)::text")" "1/true"
  gen 72001 "$(INC s1 v2),$(EXP s2 v1)" >/dev/null
  t 'B06 a persistently incomplete source stays impaired and counts its generations' "$(C 72001 s1 "gap_generations")" 2
  gen 72001 "$(EXP s1 v2),$(EXP s2 v1)" >/dev/null
  t 'B07 the first complete read after the gap moves the break to itself (restored_after_gap) and records the gap' "$(C 72001 s1 "break_seq||'/'||break_reason||'/'||(impaired_since is null)::text||'/'||gaps_total")" "6/restored_after_gap/true/1"
  t 'B08 the gap duration is recorded and survives the recovery' "$(C 72001 s1 "(last_gap_seconds is not null and last_restored_at is not null and gap_seconds_total >= 0)::text")" true
  gen 72001 "$(EXP s1 v2),$(EXP s2 v1)" >/dev/null
  t 'B09 and the generation after that continues again (break stays at the restore point)' "$(C 72001 s1 "gen_seq||'/'||break_seq")" "7/6"
  gen 72001 "$(FB s1),$(EXP s2 v1)" >/dev/null
  t 'B10 a legacy-scope FALLBACK is an impairment, reported as such' "$(Q "select continuity_state from public.dev_source_continuity_state where zip='72001' and registry_id='s1'")" legacy_scope_fallback
  gen 72001 "$(FAIL s1),$(EXP s2 v1)" >/dev/null
  t 'B11 a failed fetch is an impairment (from the existing failure authority), never a legacy success' "$(C 72001 s1 "scope||'/'||complete::text")" "failed/false"
  gen 72001 "$(LEG s1),$(EXP s2 v1)" >/dev/null
  t 'B12 an expanded source that drops to LEGACY scope (mode switched off) is an impairment' "$(Q "select continuity_state from public.dev_source_continuity_state where zip='72001' and registry_id='s1'")" legacy_scope_fallback
  gen 72001 "$(EXP s1 v2),$(EXP s2 v1)" >/dev/null
  t 'B13 successful reactivation after OFF/ON re-establishes it as a break (a quiet re-baseline), not as continuity' "$(C 72001 s1 "break_reason||'/'||(break_seq=gen_seq)::text")" "restored_after_gap/true"
  # a source that vanishes from the payload
  gen 72001 "$(EXP s2 v1)" >/dev/null
  t 'B14 an expanded source missing from the payload is "not reported" (an impairment), not a silent success' "$(Q "select continuity_state from public.dev_source_continuity_state where zip='72001' and registry_id='s1'")" source_not_reported
  Q "select public.t_zip('72002')" >/dev/null
  gen 72002 "$(EXP s1 v1)" ", '{\"development\":0}', '[{\"source_registry_id\":\"s1\",\"title\":\"x\"}]'::jsonb" >/dev/null   # the cache now HOLDS a record from s1
  gen 72002 "$(EXP s2 v1)" >/dev/null                                                                                           # ...and s1 is no longer reported
  t 'B15 a source absent AND explained by the retired-source definition (it had cached records) is retired, not unhealthy' "$(Q "select continuity_state from public.dev_source_continuity_state where zip='72002' and registry_id='s1'")" retired
  # sources that were never expanded do not make noise
  Q "select public.t_zip('72003')" >/dev/null
  gen 72003 "$(LEG l1)" >/dev/null; gen 72003 "$(FAIL l1)" >/dev/null
  t 'B16 a source that was never expanded is "legacy scope" / not an expanded-monitoring impairment' "$(C 72003 l1 "(impaired_since is null)::text")" true

  # ═══ C. retention: durable evidence outlives the diagnostic window ══════════════════════════════════════════════════════════════
  Q "select public.t_reset()" >/dev/null; Q "select public.t_zip('73001')" >/dev/null
  gen 73001 "$(EXP s1 v1)" >/dev/null; gen 73001 "$(EXP s1 v1)" >/dev/null
  Q "update public.dev_refresh_generation set recorded_at = now() - interval '9 days' where zip='73001'" >/dev/null
  gen 73001 "$(EXP s1 v1)" >/dev/null
  t 'C01 day-eight diagnostics are pruned (only the new generation row remains)' "$(G 73001 'true')" 1
  t 'C02 ...but the continuity is untouched: the source is still on an unbroken run since generation 1' "$(C 73001 s1 "gen_seq||'/'||break_seq")" "3/1"
  t 'C03 the state is still "complete": a seven-day window did not force a re-baseline' "$(Q "select continuity_state from public.dev_source_continuity_state where zip='73001' and registry_id='s1'")" complete

  # another ZIP's quiet continuity (cache unchanged for 9 days) is not touched by this ZIP's generations
  Q "select public.t_zip('73002')" >/dev/null; gen 73002 "$(EXP s1 v1)" >/dev/null
  Q "update public.dev_source_continuity set updated_at = now() - interval '9 days', last_tick_at = last_tick_at - interval '9 days' where zip='73002'" >/dev/null
  gen 73001 "$(EXP s1 v1)" >/dev/null
  t 'C04 continuity for a ZIP whose cache has been quiet for nine days survives other ZIPs generations and any diagnostic pruning' "$(C 73002 s1 "gen_seq||'/'||break_seq")" "1/1"

  # ═══ D. connector contract: the receipt as the response payload carries it ═════════════════════════════════════════════════════
  t 'D01 an expanded receipt without a version is demoted to legacy/incomplete, never stored as an unverifiable claim' "$(Q "select scope||'/'||complete::text||'/'||coalesce(scope_version,'-') from public.dev_source_receipts('{\"arcgis_reports\":[{\"registry_id\":\"u\",\"scope_receipt\":{\"scope\":\"expanded\",\"version\":null,\"complete\":true}}]}'::jsonb)")" "legacy/false/-"
  t 'D02 a pre-receipt payload (no scope_receipt) is legacy, complete only if not truncated' "$(Q "select string_agg(registry_id||':'||scope||':'||complete::text, ',' order by registry_id) from public.dev_source_receipts('{\"csv_reports\":[{\"registry_id\":\"a\"},{\"registry_id\":\"b\",\"truncated_at_max_rows\":20000}]}'::jsonb)")" "a:legacy:true,b:legacy:false"
  t 'D03 nothing here is reachable by anon / authenticated' "$(Q "select (not has_table_privilege('anon','public.dev_source_continuity','select') and not has_table_privilege('authenticated','public.dev_source_continuity','select') and not has_table_privilege('anon','public.dev_refresh_generation','select') and not has_function_privilege('anon','public.dev_continuity_step(text,timestamptz,bigint,jsonb,text,jsonb)','execute') and not has_function_privilege('authenticated','public.dev_source_receipts(jsonb)','execute'))::text")" true
}

echo "== the shipped receipt SQL, against the live collector"
run_checks "$root/docs/dev-source-receipt.sql" | tee "$tmp/shipped"
tf=$(grep -c '|f|' "$tmp/shipped" || true); tn=$(grep -c '|[tf]' "$tmp/shipped" || true)
echo "SHIPPED: $tn checks, $tf failed"
[ "$tn" -ge 45 ] || { echo "FAIL -- fewer checks ran than the suite defines"; exit 1; }
[ "$tf" -eq 0 ] || { echo "FAIL -- the shipped SQL does not pass"; exit 1; }

# applying the file twice must be harmless
build "$root/docs/dev-source-receipt.sql"; P -f "$root/docs/dev-source-receipt.sql" >/dev/null 2>"$tmp/err" || { cat "$tmp/err" >&2; echo "FAIL -- not idempotent"; exit 1; }
echo "IDEMPOTENT: the file applies twice"

# ── mutations: every prohibited weakening must fail at least one check ─────────────────────────────────────────────────────────────
mut() { # name, python replacement spec
  local name="$1"; shift
  python3 - "$root/docs/dev-source-receipt.sql" "$tmp/m.sql" "$@" <<'PY' || { echo "HARNESS  $name -- anchor missing"; return 2; }
import sys
src, dst, a, b = sys.argv[1:5]
s = open(src).read()
if s.count(a) != 1:
    sys.exit(1)
open(dst, 'w').write(s.replace(a, b))
PY
  if ! run_checks "$tmp/m.sql" >"$tmp/mout" 2>"$tmp/merr"; then echo "KILLED   $name (suite aborted)"; return 0; fi
  local k; k="$(grep '|f|' "$tmp/mout" | cut -d'|' -f1 | tr -s ' \n' ' ' || true)"
  if [ -n "$k" ]; then echo "KILLED   $name by $k"; else echo "SURVIVED $name"; return 1; fi
}
st=0
mut accepted_without_cursor_move "elsif moved then" "elsif false then" || st=1
mut refused_counts_as_accepted "  if new.refreshed_at is not null and new.refreshed_at > coalesce(old.refreshed_at, '-infinity'::timestamptz) then" "  if (new.refreshed_at is not null and new.refreshed_at > coalesce(old.refreshed_at, '-infinity'::timestamptz)) or moved then" || st=1
mut heal_counts_as_event "new.last_collected_response_id > coalesce(old.last_collected_response_id, 0);   -- a DOWNWARD move is the restart heal" "true;" || st=1
mut attribution_ignores_zip "if j->>'zip' is distinct from new.zip then j := null; end if;" "null;" || st=1
mut trigger_failure_blocks_collector "exception when others then
      -- FAIL CLOSED" "exception when no_data_found then
      -- FAIL CLOSED" || st=1
mut break_never_moves "case when z.cont then z.o_break else z.gen_n end," "coalesce(z.o_break, z.gen_n)," || st=1
mut version_not_compared "(q.ok_n and q.prev_ok and q.o_version = q.v_in)" "(q.ok_n and q.prev_ok)" || st=1
mut gap_never_opened "case when z.impaired_n then coalesce(z.o_imp, p_tick) end," "null::timestamptz," || st=1
mut incomplete_read_continues_run "(k.o_scope = 'expanded' and k.o_complete and k.o_version is not null) as prev_ok" "(k.o_scope = 'expanded' and k.o_version is not null) as prev_ok" || st=1
mut incomplete_read_is_ok "(k.scope_n = 'expanded' and k.complete_in and k.v_in is not null) as ok_n," "(k.scope_n = 'expanded' and k.v_in is not null) as ok_n," || st=1
mut absent_is_silent "when m.scope_in = 'absent' and (not coalesce(m.o_ever, false) or m.is_retired) then 'retired'" "when m.scope_in = 'absent' then 'retired'" || st=1
mut idempotence_guard_dropped "   where t.last_tick_at < excluded.last_tick_at;" ";" || st=1
mut diagnostics_prune_removes_continuity "delete from public.dev_refresh_generation g where g.zip = new.zip and g.recorded_at < now() - interval '7 days';" "delete from public.dev_source_continuity g where g.updated_at < now() - interval '7 days'; delete from public.dev_refresh_generation g where g.zip = new.zip and g.recorded_at < now() - interval '7 days';" || st=1
mut failed_fetch_read_as_legacy "when r.r->>'registry_id' in (select registry_id from f) then 'failed'" "when false then 'failed'" || st=1
[ "$st" -eq 0 ] && echo "MUTATIONS: every prohibited weakening is killed" || { echo "FAIL -- a mutation survived or did not apply"; exit 1; }
