// STEP 12 (C8) — THE DAILY DATA-CENTRE ADDRESS-CHECK MONITOR RIDES THE ONE EXISTING ALERT PATH.
// The structural half; the executable half is test/dc_address_check_monitor_pg/run.sh (18 checks on a stand-in).
// Run: node test/dc-address-check-monitor-structure.test.mjs
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

let n = 0, bad = 0;
const ok = (c, m, d) => { n++; if (c) console.log('PASS — ' + m); else { bad++; console.log('FAIL — ' + m + (d ? '  [' + d + ']' : '')); } };
const ROOT = new URL('..', import.meta.url).pathname;
const read = (f) => readFileSync(join(ROOT, f), 'utf8');
const stripSql = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');

const SQL = stripSql(read('docs/dc-address-check-monitor.sql'));
const snap = (SQL.match(/create or replace function public\.dc_address_check_snapshot\(\)[\s\S]*?\$fn\$;/) || [''])[0];
const block = (SQL.match(/_block  text := \$blk\$([\s\S]*?)\$blk\$;/) || ['', ''])[1];
ok(snap.length > 800 && block.length > 1500, '0: the snapshot function and the spliced check are located (positive control)');

// ── one walk a day, and the hourly check never walks ──────────────────────────────────────────────
ok((snap.match(/public\.dc_map1_address_check\b/g) || []).length === 1 && /as materialized/.test(snap),
  'W1: the snapshot reads the step 11 view exactly once (materialized), so it cannot disagree with it');
ok(!/dc_map1_address_check\b|map1_dc_zip_members|canonical_zip_registry/.test(block) && /public\.dc_address_check_daily/.test(block),
  'W2: the hourly check reads only the daily snapshots — it never walks 12,722 ZIPs inside the monitor');
ok(/cron\.schedule\('dc-address-check-snapshot', '50 11 \* \* \*',\s*\$c\$set statement_timeout = '300s'; select public\.dc_address_check_snapshot\(\)\$c\$\)/.test(SQL),
  'W3: the snapshot runs daily at 11:50 UTC (after the 10:45 geocode and the :25/:35 resolvers; outside 13:35-15:11 acquisitions)');
ok(/perform cron\.unschedule\(j\.jobid\) from cron\.job j where j\.jobname = 'dc-address-check-snapshot'/.test(SQL),
  'W4: re-applying replaces the job by id (works on pg_cron and on the stand-in stub) instead of adding a second one');
ok(!/statement_timeout/.test(snap),
  'W5a: the function does not try to raise its own limit — a SET inside a running statement re-arms nothing (measured), so the ceiling lives in the job command (W3)');

// ── the thresholds are the measured ones ──────────────────────────────────────────────────────────
ok(/l\.taken_at < _now - interval '26 hours'/.test(block), 'T1: stale at 26h (daily job, pg_cron punctual)');
ok(/l\.invariant_breaks > 0/.test(block) && /reason_code in \('NO_CHECK_ROW', 'ACCEPTED_NOT_JUDGED'\)/.test(snap),
  'T2: any NO_CHECK_ROW / ACCEPTED_NOT_JUDGED marker fails (structurally zero)');
ok(/l\.queue_n > 0 and p\.queue_n > 0/.test(block) && /l\.taken_at - interval '30 hours'/.test(block),
  'T3: backlog fails only when work waited through a geocode cycle with nothing geocoded for 30h');
ok(/l\.markers < p\.markers \* 0\.95/.test(block) && /l\.checked < p\.checked \* 0\.95/.test(block),
  'T4: markers and CHECKED each fail on a >5% day-over-day fall');
ok(/l\.admitted is distinct from p\.admitted/.test(block) && /l\.decision_defs is distinct from p\.decision_defs/.test(block),
  'T5: admission drift = the admitted set or any shared decision fingerprint changed');
const defs = (snap.match(/array\[([^\]]+)\]\) as f\(name\)/) || ['', ''])[1].match(/'[a-z0-9_]+'/g) || [];
ok(defs.length === 7 && ['dc_derived_address_admitted', 'dc_derived_point_verdict', 'dc_geocodable_site_address', 'map1_dc_zip_members']
     .every((f) => defs.includes(`'${f}'`)) && /'MISSING'/.test(snap),
  'T6: the admission gate, verdict, geocodability policy and Map 1 reader are fingerprinted; a vanished one reads MISSING', defs.join(','));
ok(/\(l\.taken_at is not null\),/.test(block) && /UNMEASURED/.test(block),
  'T7: with no snapshot yet the row is NOT alertable — no evidence is neither a pass nor a failure');

// ── splice discipline and access ──────────────────────────────────────────────────────────────────
ok(/_anchor text := 'insert into public\.pipeline_health_check as c \('/.test(SQL) && /expected exactly 1 — refusing to splice/.test(SQL)
   && /splice did not take/.test(SQL) && /already present — nothing to do/.test(SQL),
  'S1: one anchor, fail closed, idempotent, re-read after — the monitor\'s own splice discipline');
ok(/insert into _eval\s+select 'dc_address_check',/.test(block), 'S2: it writes one row into the monitor\'s _eval, like every other check');
ok(/enable row level security/.test(SQL) && /revoke all on public\.dc_address_check_daily from anon, authenticated/.test(SQL)
   && /revoke all on function public\.dc_address_check_snapshot\(\) from public, anon, authenticated/.test(SQL),
  'A1: the snapshot table and function are service-role only');
const WF = read('.github/workflows/zip-membership-suite.yml');
ok(/bash test\/dc_address_check_monitor_pg\/run\.sh/.test(WF) && (WF.match(/'docs\/dc-address-check-monitor\.sql'/g) || []).length === 2,
  'A2: CI runs the executable proof on pull requests and pushes touching the monitor');

console.log(`\n${n - bad}/${n} passed`);
process.exit(bad ? 1 : 0);
