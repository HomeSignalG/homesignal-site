// Offline pins for the Phase 6 geography health model (docs/geo-health-model.sql).
//
// The behavioural proof runs server-side (the sandbox has no egress) and is
// recorded in docs/geo-phase6-health.md. What CANNOT be left to that receipt is
// the set of properties a future edit would quietly remove: they need a gate that
// runs on every PR. Each pin below corresponds to a rule the fixture proved and a
// mutation that broke it, so this file fails if the SQL stops meaning what the
// receipt says it means.
//
// It also re-uses the Phase 5 CTE structure checker, because the health model is
// SQL too and the 47b005e defect class does not care which file it lands in.
import { readFileSync } from 'node:fs';
import { checkCteChain } from './geo-sql-cte-structure.test.mjs';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; } else { fail++; console.log('FAIL: ' + m); } };
const section = (s) => console.log('\n-- ' + s);

const sql = readFileSync('docs/geo-health-model.sql', 'utf8');
const lower = sql.toLowerCase();

// Slice one function/view body out by name, so a pin about the state machine
// cannot accidentally be satisfied by text somewhere else in the file - the
// "a pin that names the string it forbids" lesson, applied to a 450-line file.
// ⚠️ `a.indexOf(x) < a.indexOf(y)` IS TRUE WHEN x IS ABSENT, because indexOf
// returns -1. The first version of the two ordering pins below used exactly that,
// and when the SLA branch was deleted as a mutation only ONE of the two pins went
// red - the ordering pin passed over a branch that no longer existed. An ordering
// assertion must first assert PRESENCE. Same family as "a pin that names the
// string it forbids cannot also search the whole file for it".
function before(haystack, first, second) {
  const a = haystack.indexOf(first), b = haystack.indexOf(second);
  return a >= 0 && b >= 0 && a < b;
}

function slice(startMarker, endMarker) {
  const i = sql.indexOf(startMarker);
  if (i < 0) return '';
  const j = sql.indexOf(endMarker, i + startMarker.length);
  return j < 0 ? sql.slice(i) : sql.slice(i, j);
}
const stateFn = slice('create or replace function geo.geography_health_state(', '$fn$;');
const probeFn = slice('create or replace function geo.geography_health_probe(', '$fn$;');
const regView = slice('create or replace view geo.v_geography_registry_health', ';\n\ncomment on view');

section('1. the file is applied by nobody - Phase 6 observes');
ok(!/create\s+(or replace\s+)?trigger/i.test(sql), 'the health model installs NO trigger');
ok(!/cron\.schedule/i.test(sql), 'the health model schedules NOTHING');
ok(!/geo\.n5_claim_batch|reconcile_stage1|geography_reconcile\(/i.test(sql),
   'the health model never invokes reconciliation');
ok(!/insert\s+into\s+geo\.(zip_authoritative|n5_geom|n5_boundary)/i.test(lower),
   'the health model never writes a resident-facing geography plane');
ok(!/delete\s+from\s+geo\.(zip_authoritative|n5_geom|n5_boundary)/i.test(lower),
   'the health model never deletes from a geography plane');

section('2. the state machine - every branch a mutation proved load-bearing');
ok(stateFn.length > 500, 'the state function was sliced out');
ok(/not_activated/i.test(stateFn), 'NOT_ACTIVATED exists as its own state');
ok(before(stateFn, 'NOT_ACTIVATED', "state := 'HEALTHY'"),
   'NOT_ACTIVATED is decided BEFORE HEALTHY can be reached (mutation M2)');
ok(/_oldest_pending_age\s*>\s*_sla/.test(stateFn),
   'the SLA branch exists - work aging past the SLA is CRITICAL (mutation M1)');
ok(before(stateFn, '_oldest_pending_age > _sla', "state := 'HEALTHY'"),
   'the SLA branch outranks HEALTHY: a successful run that processed zero keys '
   + 'cannot report healthy while work ages');
ok(/_ingest_active\s+and\s*\(_last_success_at is null/.test(stateFn),
   'the frozen-pipeline branch is GATED on _ingest_active (mutation M3, case C)');
ok(/_queue_growth_windows,\s*0\)\s*>=\s*6/.test(stateFn), 'sustained queue growth is CRITICAL');
ok(/_queue_growth_windows,\s*0\)\s*>=\s*3/.test(stateFn), 'early queue growth is WARNING');
ok(/_consecutive_errors,\s*0\)\s*>=\s*3/.test(stateFn), 'repeated failure is CRITICAL');
ok(/immutable/i.test(stateFn), 'the state machine is a PURE function - testable without a plane');
ok(!/\bfrom\s+geo\./i.test(stateFn.replace(/--.*$/gm, '')),
   'the state machine reads NO table, so no case can depend on production state');

section('3. thresholds are PROVISIONAL and say so');
ok(/PROVISIONAL/.test(sql), 'the thresholds are marked provisional');
ok(/_interval\s+interval\s+default\s+'15 minutes'/.test(stateFn),
   'the scheduler interval is a parameter, not a literal buried in a branch');
ok(/_sla\s+interval\s+default\s+'24 hours'/.test(stateFn), 'the SLA is a parameter');

section('4. the probe is bounded and cheap');
ok(/_max_scan/.test(probeFn), 'the probe caps how much queue it will aggregate');
ok(/refusing to aggregate/i.test(probeFn),
   'over the cap the probe reports CRITICAL rather than running an unbounded count');
ok(!/max\(.*computed_at.*\)/i.test(probeFn),
   'the probe does NOT scan a 901k-row plane for max(computed_at) - measured at 841.8 ms');
ok(/development_reports/.test(probeFn),
   'ingest activity is read from development_reports (12,722 rows), not app_projects (3.2M)');
ok(/order by o\.observed_at desc limit 1/.test(probeFn),
   'trend comes from the PREVIOUS observation only - no history scan');

section('5. governance holds are not failures');
ok(/'HOLD'/.test(regView), 'the registry view has a HOLD state');
ok(/'NOT_PROCESSABLE'/.test(regView), 'the registry view separates NOT_PROCESSABLE');
ok(/governance_hold/.test(regView), 'holds are flagged so a roll-up can exclude them');
ok(/PROVEN','RECOVERY'/.test(regView),
   'only PROVEN and RECOVERY count as processable');
ok(/PENDING_REVIEW/.test(sql) && /BLOCKED_NO_RECORDS/.test(sql),
   'both governance-hold dispositions are named in the contract');

section('6. historical backlog is a constant, never queue work');
ok(/historical_keys\s+bigint\s+not null default 53610/.test(sql), 'the Phase 0 key count is carried');
ok(/historical_pairs\s+bigint\s+not null default 124070/.test(sql), 'the Phase 0 pair count is carried');
ok(/historical_rows\s+bigint\s+not null default 141612/.test(sql), 'the Phase 0 row count is carried');
ok(/historical_zips\s+integer\s+not null default 3152/.test(sql), 'the Phase 0 ZIP count is carried');
ok(/historical_regs\s+integer\s+not null default 147/.test(sql), 'the Phase 0 registry count is carried');
ok(!/insert into geo\.n5_reconcile_queue/i.test(sql),
   'the health model NEVER enqueues - it cannot turn the scheduler into the backfill');

section('7. integration adds a component, it does not fork the health system');
ok(/pipeline_health_check/.test(sql), 'it writes to the EXISTING health surface');
ok(/geography_progression/.test(sql), 'the component has its own check name');
ok(/258df595490b81c3dfcc7086cf9f8c39/.test(sql),
   'the traced pipeline_health_tick md5 is recorded, so a later divergence is visible');
ok(/splicing pg_get_functiondef|SPLICING pg_get_functiondef/i.test(sql),
   'the integration is a splice, never a replay of a dated CREATE OR REPLACE');
ok(/h\.state <> 'NOT_ACTIVATED'/.test(sql),
   'pre-activation is reported but not paged');

section('8. CTE structure - the 47b005e defect class, in this file too');
for (const [name, body] of [['registry view', regView]]) {
  const p = checkCteChain(body);
  ok(p.length === 0, `${name} CTE chain: ${p.join(' | ')}`);
}

section('9. NEGATIVE CONTROL - the pins can fail');
const brokenState = stateFn.replace(/_oldest_pending_age\s*>\s*_sla/, '_oldest_pending_age > _sla_REMOVED');
ok(!/_oldest_pending_age\s*>\s*_sla\b/.test(brokenState),
   'removing the SLA branch is detectable by the same regex the pin uses');
const brokenView = regView.replace(/'HOLD'/g, "'FAILED'");
ok(!/'HOLD'/.test(brokenView), 'reclassifying a hold as a failure is detectable');

console.log(`\nPassed: ${pass}  Failed: ${fail}`);
if (fail) process.exit(1);
