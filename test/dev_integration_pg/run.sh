#!/usr/bin/env bash
# THE INTEGRATION TEST. Real SQL of record from every layer, in one disposable Postgres, nothing re-typed:
#   the LIVE dev_refresh_collect()           (rebuilt from the committed chain, fingerprinted to production's md5)
#   docs/dev-source-receipt.sql              (PR #1840: accepted-generation receipt + durable source continuity)
#   docs/dev-change-{ledger,baseline,reportable}.sql + docs/dev-change-recovery.sql   (PR #1829, spliced onto the live ledger bodies)
# The only stand-in is the MATERIALISER (app_refresh_zip builds app_projects from the cache; its body is not reproduced here), which
# the fixture mirrors: one row per cached site, provenance.refreshed_at = the cache generation. Every cache write below is made by the
# real collector accepting or refusing a pg_net-shaped response.
set -euo pipefail
: "${PGHOST:?}" "${PGDATABASE:?}"
case "$PGDATABASE" in *disposable*) ;; *) echo "ABORT: PGDATABASE must name a disposable database (got '$PGDATABASE')"; exit 1;; esac
here="$(cd "$(dirname "$0")" && pwd)"; root="$here/../.."
P() { psql -X -qtA -v ON_ERROR_STOP=1 "$@"; }
Q() { P -c "$1"; }
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
n=0; bad=0
t() { n=$((n+1)); if [ "$2" = "$3" ]; then echo "  $1|t"; else echo "  $1|f|got=[$2] want=[$3]"; bad=$((bad+1)); fi; }

build() { # $1 = the recovery SQL under test
  bash "$root/test/dev_collect_harness/build.sh" >/dev/null 2>"$tmp/err" || { cat "$tmp/err" >&2; exit 1; }
  P -f "$root/test/dev_change_ledger_pg/fixture.sql" >/dev/null
  P -c "drop table public.dev_refresh_source_failures" >/dev/null     # the collector harness's narrower copy; the baseline fixture carries production's columns
  P -f "$root/test/dev_change_baseline_pg/fixture.sql" >/dev/null
  for d in dev-change-ledger dev-change-baseline dev-change-reportable; do
    P -f "$root/docs/$d.sql" >/dev/null 2>"$tmp/err" || { cat "$tmp/err" >&2; echo "FAIL — docs/$d.sql does not apply"; exit 1; }
  done
  sed -n '/^create or replace function public.app_source_key(el jsonb)/,/^\$\$;/p' "$root/docs/app-projects-stable-key-migration.sql" > "$tmp/key.sql"
  sed -n '/^create or replace function public.app_source_key_basis(el jsonb)/,/^\$\$;/p' "$root/docs/app-projects-stable-key-migration.sql" >> "$tmp/key.sql"
  P -f "$tmp/key.sql" >/dev/null
  P -f "$root/test/dev_change_recovery_pg/fixture.sql" >/dev/null 2>"$tmp/err" || { cat "$tmp/err" >&2; exit 1; }
  P -f "$root/docs/dev-source-receipt.sql" >/dev/null 2>"$tmp/err" || { cat "$tmp/err" >&2; echo "FAIL — the receipt SQL does not apply"; exit 1; }
  P -f "$root/test/source_receipt_pg/helpers.sql" >/dev/null
  P -1 -f "$1" >/dev/null 2>"$tmp/err" || { cat "$tmp/err" >&2; echo "FAIL — the recovery SQL does not apply"; exit 1; }
}
# ── one step of the real pipeline ───────────────────────────────────────────────────────────────────────────────────────────────
S() { echo "public.sim_site('$1','Issued','${3:-2023-01-01}', ${4:-true}, 'filed', '$2')"; }     # id source [file_date] [stamped]
SITES() { local IFS=,; echo "jsonb_build_array($*)"; }
EXP() { echo "public.t_exp('$1','${2:-vA}')"; }; INC() { echo "public.t_inc('$1','${2:-vA}')"; }; FB() { echo "public.t_fb('$1')"; }
LEG() { echo "public.t_leg('$1')"; }; FAIL() { echo "public.t_fail('$1')"; }
fire() { Q "select public.t_fire('$1', ARRAY[${3:-}]::jsonb[], '{\"development\":0}'::jsonb, $2)"; }    # zip sites_sql reports_sql
collect() { Q "select public.dev_refresh_collect()"; }
mat() { Q "select public.sim_materialize(d.zip, d.sites, d.refreshed_at) from public.development_reports d where d.zip='$1'" >/dev/null; }
gen() { fire "$1" "$2" "${3:-}" >/dev/null; collect >/dev/null; mat "$1"; }          # a full cycle: response -> collector -> materialiser
gen_nomat() { fire "$1" "$2" "${3:-}" >/dev/null; collect >/dev/null; }
obs() { Q "select public.sim_observe('$1'${2:+, true})"; }
news() { Q "select count(*) from public.dev_change_event_reportable where identity_key='arcgis:fixture:$2' and event_type='first_detected' and material"; }   # zip id
quiet() { Q "select count(*) from public.dev_change_recovery where identity_key='arcgis:fixture:$2'"; }
cache() { Q "select sites from public.development_reports where zip='$1'"; }
mon() { Q "select monitoring_state from public.dev_change_scope_health where zip='$1' and registry_id='$2'"; }
ZIP() { Q "select public.t_zip('$1')" >/dev/null; }
# a ZIP with a standing baseline for source $3: legacy generation, baseline run, expanded generation, first ordinary observation
mk() { # zip prefix source
  ZIP "$1"
  gen "$1" "$(SITES "$(S "$2"0 "$3" 2024-01-01 false)")" ""; obs "$1" base >/dev/null
  gen "$1" "$(SITES "$(S "$2"0 "$3" 2024-01-01 false)" "$(S "$2"1 "$3" 2022-01-01)")" "$(EXP "$3")"; obs "$1" >/dev/null
}
ADD() { # zip: append to the current cache  (id source)
  echo "(select sites from public.development_reports where zip='$1') || jsonb_build_array($(S "$2" "$3" "${4:-$(date -I -d yesterday)}"))"
}
KEEP() { echo "(select sites from public.development_reports where zip='$1')"; }

run_checks() {
  build "$1"
  # ── 1. the baseline, and an EMPTY expanded baseline (blocker 1) ────────────────────────────────────────────────────────────
  mk 76001 a sa
  t 'I01 first complete expanded read: the ring record is baselined silently, never announced' "$(news 76001 a1)|$(quiet 76001 a1)" "0|1"
  t 'I02 readiness: baselined at the continuity generation the accepted response produced' "$(Q "select (r.baseline_gen_seq = c.gen_seq)::text from public.dev_change_scope_ready r join public.dev_source_continuity c using (zip, registry_id) where r.zip='76001'")" true
  ZIP 76002
  gen 76002 "$(SITES "$(S b0 sa 2024-01-01 false)")" ""; obs 76002 base >/dev/null
  gen 76002 "$(KEEP 76002)" "$(EXP sa)"; obs 76002 >/dev/null          # a COMPLETE expanded read that found NOTHING in the ring
  t 'I03 an EMPTY expanded read establishes the baseline (no stamped record needed as proof)' "$(Q "select count(*) from public.dev_change_scope_ready where zip='76002' and registry_id='sa' and baseline_gen_seq is not null")" 1
  gen 76002 "$(ADD 76002 b1 sa)" "$(EXP sa)"; obs 76002 >/dev/null
  t 'I04 the FIRST genuine record after an empty baseline is announced (eligible for first detection)' "$(news 76002 b1)" 1
  # ── 2. accepted followed by refused (A) ──────────────────────────────────────────────────────────────────────────────────────
  mk 76003 c sa
  Q "update public.development_reports set counts='{\"development\":5}' where zip='76003'" >/dev/null     # a fresh row with development content...
  fire 76003 "$(KEEP 76003)" "$(EXP sa)" >/dev/null; collect >/dev/null                               # ...and a response that says 0: the reduction guard REFUSES it
  t 'I05 the collector refused it (cursor moved, cache clock did not) and recorded that as refused' "$(Q "select count(*) from public.dev_refresh_generation where zip='76003' and outcome='refused'")" 1
  Q "update public.development_reports set counts='{\"development\":0}' where zip='76003'" >/dev/null
  gen 76003 "$(ADD 76003 c2 sa)" "$(EXP sa)"; obs 76003 >/dev/null
  t 'I06 the refusal did not break monitoring: the next arrival is news' "$(news 76003 c2)" 1
  # ── 3. two accepted generations before any observation ──────────────────────────────────────────────────────────────────────
  mk 76004 d sa
  gen_nomat 76004 "$(ADD 76004 d2 sa)" "$(EXP sa)"
  gen 76004 "$(ADD 76004 d3 sa)" "$(EXP sa)"
  obs 76004 >/dev/null
  t 'I07 two accepted complete generations before the ledger looks: BOTH arrivals are news (an unobserved complete generation is not a gap)' "$(news 76004 d2)|$(news 76004 d3)" "1|1"
  # ── 4. an incomplete intermediate generation the ledger never saw ───────────────────────────────────────────────────────────
  mk 76005 e sa
  gen_nomat 76005 "$(KEEP 76005)" "$(INC sa)"
  gen 76005 "$(ADD 76005 e2 sa)" "$(EXP sa)"; obs 76005 >/dev/null
  t 'I08 an unobserved INCOMPLETE generation between two observations is a break: the arrival is baselined quietly' "$(news 76005 e2)|$(quiet 76005 e2)" "0|1"
  t 'I09 …the gap is on record (duration, count) and the re-baseline was counted' "$(Q "select (gaps_total = 1 and last_gap_seconds is not null and rebaseline_events = 1 and quiet_rebaselined_identities >= 1)::text from public.dev_change_scope_health where zip='76005' and registry_id='sa'")" true
  gen 76005 "$(ADD 76005 e3 sa)" "$(EXP sa)"; obs 76005 >/dev/null
  t 'I10 …and after the re-baseline the next arrival is news again (no permanent blind spot)' "$(news 76005 e3)" 1
  # ── 5. the collector transaction rolls back ────────────────────────────────────────────────────────────────────────────────
  mk 76006 f sa
  fire 76006 "$(ADD 76006 f2 sa)" "$(INC sa)" >/dev/null
  psql -X -q -c "do \$\$ begin perform public.dev_refresh_collect(); raise exception 'rolled back'; end \$\$" >/dev/null 2>&1 || true
  t 'I11 a rolled-back collector run leaves neither a cache write nor a receipt nor a break' "$(Q "select count(*) from public.dev_refresh_generation where zip='76006' and outcome='accepted' and response_id=(select max(id) from net._http_response)")|$(Q "select break_seq=gen_seq from public.dev_source_continuity where zip='76006' and registry_id='sa'")" "0|t"
  collect >/dev/null; mat 76006; obs 76006 >/dev/null
  t 'I12 …and the retry applies the same response once (it was an incomplete read: held, then not claimed as news)' "$(news 76006 f2)" 0
  # ── 6. two sources in one ZIP with different health ────────────────────────────────────────────────────────────────────────
  ZIP 76007
  gen 76007 "$(SITES "$(S g0 sa 2024-01-01 false)")" ""; obs 76007 base >/dev/null
  gen 76007 "$(SITES "$(S g0 sa 2024-01-01 false)" "$(S g1 sa)" "$(S h1 sb)")" "$(EXP sa),$(EXP sb)"; obs 76007 >/dev/null
  gen 76007 "$(SITES "$(S g0 sa 2024-01-01 false)" "$(S g1 sa)" "$(S g2 sa "$(date -I -d yesterday)")" "$(S h1 sb)" "$(S h2 sb 2023-05-05)")" "$(EXP sa),$(INC sb)"; obs 76007 >/dev/null
  t 'I13 source A (healthy) announces its arrival; source B (incomplete read) holds its own and is reported suspended' "$(news 76007 g2)|$(news 76007 h2)|$(quiet 76007 h2)|$(mon 76007 sb)|$(mon 76007 sa)|$(Q "select string_agg(registry_id||':'||(lapsed_at is not null)::text, ',' order by registry_id) from public.dev_change_scope_ready where zip='76007'")" "1|0|0|suspended|complete_verified|sa:false,sb:true"
  gen 76007 "$(KEEP 76007)" "$(EXP sa),$(EXP sb)"; obs 76007 >/dev/null
  t 'I14 B returns: its held record is baselined quietly (not claimed as news), B is restored, and A was never disturbed' "$(news 76007 h2)|$(quiet 76007 h2)|$(mon 76007 sb)|$(mon 76007 sa)" "0|1|monitoring_restored|complete_verified"
  # the collector's EXISTING guard still refuses a write while a failed source already contributes records: nothing is claimed for it
  before="$(Q "select gen_seq from public.dev_source_continuity where zip='76007' and registry_id='sb'")"
  gen 76007 "$(KEEP 76007)" "$(EXP sa),$(FAIL sb)"; obs 76007 >/dev/null
  t 'I14b the source-failure guard is preserved: the write is REFUSED, recorded as refused, and no generation is claimed for the failed source' "$(Q "select count(*) from public.dev_refresh_generation where zip='76007' and outcome='refused'")|$(Q "select gen_seq from public.dev_source_continuity where zip='76007' and registry_id='sb'")|$(mon 76007 sb)" "1|$before|monitoring_restored"
  # a failed fetch from a source that contributes nothing is accepted, and recorded as FAILED rather than as a legacy success
  ZIP 76014
  gen 76014 "$(SITES "$(S n0 sa 2024-01-01 false)")" ""; obs 76014 base >/dev/null
  gen 76014 "$(SITES "$(S n0 sa 2024-01-01 false)" "$(S n1 sa)")" "$(EXP sa),$(EXP sb)"; obs 76014 >/dev/null
  gen 76014 "$(KEEP 76014)" "$(EXP sa),$(FAIL sb)"; obs 76014 >/dev/null
  t 'I14c a failed fetch (nothing cached from it) is accepted and recorded as failed: that source alone is suspended' "$(mon 76014 sb)|$(mon 76014 sa)|$(Q "select continuity_state from public.dev_change_scope_health where zip='76014' and registry_id='sb'")" "suspended|complete_verified|failed_or_incomplete"
  # ── 7. a scope/geometry/config version change ───────────────────────────────────────────────────────────────────────────────
  mk 76008 i sa
  gen 76008 "$(ADD 76008 i2 sa)" "$(EXP sa vB)"; obs 76008 >/dev/null
  t 'I15 a changed scope version (polygon or source configuration) never inherits the old baseline: quiet re-baseline' "$(news 76008 i2)|$(quiet 76008 i2)|$(Q "select scope_version from public.dev_change_scope_ready where zip='76008' and registry_id='sa'")" "0|1|vB"
  gen 76008 "$(ADD 76008 i3 sa)" "$(EXP sa vB)"; obs 76008 >/dev/null
  t 'I16 …and under the new version the next arrival is news' "$(news 76008 i3)" 1
  # the version went A -> B -> A while the ledger was not looking: the baseline at A is not continuous across the B generation
  mk 76015 p sa
  gen_nomat 76015 "$(KEEP 76015)" "$(EXP sa vB)"
  gen 76015 "$(ADD 76015 p2 sa)" "$(EXP sa vA)"; obs 76015 >/dev/null
  t 'I15b an unobserved scope-version excursion (A -> B -> A) is a break: the arrival is baselined quietly' "$(news 76015 p2)|$(quiet 76015 p2)" "0|1"
  # defence in depth: even if a receipt claimed continuity, the ledger itself refuses a baseline from a different scope version
  mk 76016 q sa
  Q "update public.dev_source_continuity set scope_version = 'vZ' where zip='76016' and registry_id='sa'" >/dev/null
  gen_nomat 76016 "$(ADD 76016 q2 sa)" "$(EXP sa)"
  Q "update public.dev_source_continuity set scope_version = 'vZ', break_seq = 1 where zip='76016' and registry_id='sa'" >/dev/null
  mat 76016; obs 76016 >/dev/null
  t 'I15c the ledger refuses a baseline taken under a different version even where continuity claims none was lost' "$(news 76016 q2)|$(quiet 76016 q2)" "0|1"
  # a source whose FIRST expanded read is incomplete never gets a baseline
  ZIP 76017
  gen 76017 "$(SITES "$(S r0 sa 2024-01-01 false)")" ""; obs 76017 base >/dev/null
  gen 76017 "$(SITES "$(S r0 sa 2024-01-01 false)" "$(S r1 sa)")" "$(INC sa)"; obs 76017 >/dev/null
  t 'I15d a first expanded read that is incomplete establishes NO baseline; the record is held and the source is listed' "$(Q "select count(*) from public.dev_change_scope_ready where zip='76017' and baseline_gen_seq is not null")|$(news 76017 r1)|$(quiet 76017 r1)|$(mon 76017 sa)" "0|0|0|failed_or_incomplete"
  # ── 8. OFF / ON ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
  mk 76009 j sa
  gen 76009 "$(SITES "$(S j0 sa 2024-01-01 false)")" "$(LEG sa)"; obs 76009 >/dev/null
  t 'I17 mode OFF: the source is reported suspended with the legacy-scope fallback as the cause' "$(mon 76009 sa)|$(Q "select continuity_state from public.dev_change_scope_health where zip='76009' and registry_id='sa'")" "suspended|legacy_scope_fallback"
  gen 76009 "$(SITES "$(S j0 sa 2024-01-01 false)" "$(S j1 sa 2022-01-01)" "$(S j3 sa "$(date -I -d yesterday)")")" "$(EXP sa)"; obs 76009 >/dev/null
  t 'I18 mode ON again: the record that appeared across the OFF window is baselined quietly' "$(news 76009 j3)|$(quiet 76009 j3)" "0|1"
  gen 76009 "$(ADD 76009 j4 sa)" "$(EXP sa)"; obs 76009 >/dev/null
  t 'I19 successful reactivation: the next arrival is news' "$(news 76009 j4)" 1
  # ── 9. retention: nothing durable depends on the diagnostic window ────────────────────────────────────────────────────────
  mk 76010 k sa
  Q "update public.dev_refresh_generation set recorded_at = now() - interval '9 days' where zip='76010'" >/dev/null
  Q "delete from public.dev_refresh_generation where zip='76010'" >/dev/null
  gen 76010 "$(ADD 76010 k2 sa)" "$(EXP sa)"; obs 76010 >/dev/null
  t 'I20 after the diagnostic history is gone the continuously monitored source still announces' "$(news 76010 k2)" 1
  # ── 10. the collector is down for days: nothing happens, nothing breaks ───────────────────────────────────────────────────
  mk 76011 l sa
  Q "update public.development_reports set refreshed_at = refreshed_at - interval '5 days' where zip='76011'" >/dev/null   # (the clock the outage would have left behind)
  t 'I21 a stalled collector is visible as collection_delayed, not as a healthy source' "$(Q "select continuity_state from public.dev_source_continuity_state where zip='76011' and registry_id='sa'")|$(mon 76011 sa)" "collection_delayed|collection_delayed"
  # ── 11. a persistently incomplete source stays HELD and listed, with counts ─────────────────────────────────────────────
  mk 76012 m sa
  for i in 1 2 3; do gen 76012 "$(ADD 76012 m1$i sa)" "$(INC sa)"; obs 76012 >/dev/null; done
  t 'I22 three incomplete observations: every new record is held (none announced, none baselined), the source stays listed' "$(news 76012 m11)|$(quiet 76012 m11)|$(mon 76012 sa)" "0|0|suspended"
  t 'I23 …with the held count and the open gap on record' "$(Q "select (held_observations = 6 and gap_generations = 3 and impaired_since is not null)::text from public.dev_change_scope_health where zip='76012' and registry_id='sa'")" true
  gen 76012 "$(KEEP 76012)" "$(EXP sa)"; obs 76012 >/dev/null
  t 'I24 the first complete read re-baselines the held records quietly (the uncertain first sightings are not manufactured into alerts)' "$(news 76012 m11)|$(quiet 76012 m11)|$(quiet 76012 m13)" "0|1|1"
  # ── 12. an unattributed cache write ──────────────────────────────────────────────────────────────────────────────────────────
  mk 76013 o sa
  Q "update public.development_reports set refreshed_at = now() where zip='76013'" >/dev/null
  gen 76013 "$(ADD 76013 o2 sa)" "$(EXP sa)"; obs 76013 >/dev/null
  t 'I25 a cache write with no response behind it is a break: the arrival is baselined, not announced' "$(news 76013 o2)|$(quiet 76013 o2)" "0|1"
  # ── 13. the census ──────────────────────────────────────────────────────────────────────────────────────────────────────────
  Q "insert into public.development_reports (zip, sites, refreshed_at) values ('76099', '[]', now())" >/dev/null
  t 'I26 a ZIP with a cache and no accepted-generation evidence is counted' "$(Q "select pairs from public.dev_monitoring_coverage where monitoring_state='zip_without_any_generation_evidence'")" 1
  t 'I27 the census reports several states at once' "$(Q "select (count(distinct monitoring_state) >= 3)::text from public.dev_change_scope_health")" true
  t 'I28 no accepted write to this database left an error marker' "$(Q "select count(*) from public.dev_refresh_generation where outcome = 'receipt_error'")" 0
}

echo "== the shipped SQL, every layer real"
run_checks "$root/docs/dev-change-recovery.sql" | tee "$tmp/shipped"
echo "SHIPPED: $(grep -cE '\|[tf](\||$)' "$tmp/shipped") result lines"
bash "$root/test/lib/require_exact_ids.sh" "$here/required_checks.txt" "$tmp/shipped" || { echo "FAIL -- the integration does not pass, or a required check did not report"; exit 1; }

# ── mutations across the layers: each prohibited weakening must fail the INTEGRATION test ─────────────────────────────────────────
mut() { # file name anchor replacement
  local file="$1" name="$2"; shift 2
  python3 - "$root/docs/$file" "$tmp/m.sql" "$@" <<'PY' || { echo "HARNESS  $name -- anchor missing"; return 2; }
import sys
src, dst, a, b = sys.argv[1:5]
s = open(src).read()
if s.count(a) != 1:
    sys.exit(1)
open(dst, 'w').write(s.replace(a, b))
PY
  # a mutated RECEIPT file is applied in place of the real one
  local out
  if [ "$file" = "dev-source-receipt.sql" ]; then
    cp "$root/docs/dev-source-receipt.sql" "$tmp/receipt.orig"; cp "$tmp/m.sql" "$root/docs/dev-source-receipt.sql"
    out="$(run_checks "$root/docs/dev-change-recovery.sql" 2>&1 || true)"; cp "$tmp/receipt.orig" "$root/docs/dev-source-receipt.sql"
  else
    out="$(run_checks "$tmp/m.sql" 2>&1 || true)"
  fi
  local k; k="$(grep '|f|' <<<"$out" | cut -d'|' -f1 | tr -s ' \n' ' ' || true)"
  # a kill is a check that RAN and failed; a mutated stack that merely crashed is a broken harness, not evidence
  if [ -n "$k" ]; then echo "KILLED   $name by $k"; else echo "SURVIVED $name (or the mutated stack never reported)"; return 1; fi
}
st=0
# the mutated receipt file is swapped into docs/ for the run: restore it however this script ends
trap '[ -f "$tmp/receipt.orig" ] && cp "$tmp/receipt.orig" "$root/docs/dev-source-receipt.sql"; rm -rf "$tmp"' EXIT
mut dev-source-receipt.sql receipt_refused_counts_as_accepted "  if new.refreshed_at is not null and new.refreshed_at > coalesce(old.refreshed_at, '-infinity'::timestamptz) then" "  if (new.refreshed_at is not null and new.refreshed_at > coalesce(old.refreshed_at, '-infinity'::timestamptz)) or moved then" || st=1
mut dev-source-receipt.sql receipt_break_never_moves "case when z.cont then z.o_break else z.gen_n end," "coalesce(z.o_break, z.gen_n)," || st=1
mut dev-source-receipt.sql receipt_version_not_compared "(q.ok_n and q.prev_ok and q.o_version = q.v_in)" "(q.ok_n and q.prev_ok)" || st=1
mut dev-source-receipt.sql receipt_incomplete_is_complete "(k.scope_n = 'expanded' and k.complete_in and k.v_in is not null) as ok_n," "(k.scope_n = 'expanded' and k.v_in is not null) as ok_n," || st=1
mut dev-source-receipt.sql receipt_failed_read_as_legacy "when r.r->>'registry_id' in (select registry_id from f) then 'failed'" "when false then 'failed'" || st=1
mut dev-source-receipt.sql receipt_unattributed_ignored "if new.refreshed_at is not null and new.refreshed_at > coalesce(old.refreshed_at, '-infinity'::timestamptz) then" "if moved and new.refreshed_at is not null and new.refreshed_at > coalesce(old.refreshed_at, '-infinity'::timestamptz) then" || st=1
mut dev-change-recovery.sql ledger_continuity_ignores_break "and rd.bgs >= rc.break_seq and rd.bgs <= rc.gen_seq) as continuous" "and rd.bgs <= rc.gen_seq) as continuous" || st=1
mut dev-change-recovery.sql ledger_ignores_scope_version "(rc.scope = 'expanded' and rc.complete and rd.bgs is not null and rd.ver = rc.ver" "(rc.scope = 'expanded' and rc.complete and rd.bgs is not null" || st=1
mut dev-change-recovery.sql ledger_baselines_incomplete "case when s.scope = ''expanded'' and s.complete then s.gen_seq end," "case when s.scope = ''expanded'' then s.gen_seq end," || st=1
mut dev-change-recovery.sql ledger_holds_nothing "when s.reg is null or s.scope <> ''expanded'' or not s.complete then ''hold''" "when s.reg is null then ''hold''" || st=1
mut dev-change-recovery.sql ledger_all_sources_share_readiness "and not exists (select 1 from _dc_scopesrc s where s.reg = r.registry_id and s.scope = ''expanded'' and s.complete);" "and not exists (select 1 from _dc_scopesrc s where s.scope = ''expanded'' and s.complete);" || st=1
n_mut=$(grep -c '^mut ' "$here/run.sh" || true)
[ "$n_mut" -eq 11 ] || { echo "FAIL -- expected 11 mutations, the runner defines $n_mut"; exit 1; }
[ "$st" -eq 0 ] && echo "MUTATIONS: 11 of 11 prohibited weakenings are killed across the layers" || { echo "FAIL -- a mutation survived or did not apply"; exit 1; }
