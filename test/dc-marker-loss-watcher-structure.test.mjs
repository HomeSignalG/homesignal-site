// STEP 13 (C9) — THE MAP 1 MARKER-LOSS WINDOW IS CLOSED BY THE SAME RESOLVER, RUN SOONER, UNDER ONE LOCK.
// The structural half; the executable half is test/dc_marker_loss_pg/run.sh (the defect reproduced and closed).
// Run: node test/dc-marker-loss-watcher-structure.test.mjs
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

let n = 0, bad = 0;
const ok = (c, m, d) => { n++; if (c) console.log('PASS — ' + m); else { bad++; console.log('FAIL — ' + m + (d ? '  [' + d + ']' : '')); } };
const ROOT = new URL('..', import.meta.url).pathname;
const read = (f) => readFileSync(join(ROOT, f), 'utf8');
const stripSql = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');

const SQL = stripSql(read('docs/dc-marker-loss-watcher.sql'));
const fn = (name) => (SQL.match(new RegExp('create or replace function public\\.' + name + '\\([\\s\\S]*?\\$fn\\$;')) || [''])[0];
const WATCH = fn('dc_resolve_on_acquisition');
const WRAP = fn('dc_resolve_serialized');
ok(WATCH.length > 600 && WRAP.length > 400, '0: both functions are located (positive control)');

// ── one truth path: the shipped resolvers, never a copy ───────────────────────────────────────────
ok(/from public\.dc_resolve_canonical\(true, false\)/.test(WATCH) && !/insert into|update |delete from/i.test(WATCH),
  'P1: the watcher runs the shipped canonical resolver and writes nothing itself');
ok(/public\.dc_resolve_canonical\(true, false\)/.test(WRAP) && /public\.dc_resolve_geography\(true\)/.test(WRAP)
   && !/insert into|update |delete from/i.test(WRAP),
  'P2: the wrapper runs the two shipped resolvers and writes nothing itself');
ok(!/create or replace function public\.(dc_resolve_canonical|dc_resolve_geography|map1_dc_zip_members)\b/.test(SQL)
   && !/create or replace view/.test(SQL),
  'P3: no resolver, reader or view is redefined — the window closes without changing any decision');

// ── the lock ──────────────────────────────────────────────────────────────────────────────────────
const KEY = "hashtextextended('dc-resolvers', 0)";
ok(WRAP.includes('perform pg_advisory_xact_lock(' + KEY + ')') && WATCH.includes('pg_try_advisory_xact_lock(' + KEY + ')'),
  'L1: the wrapper WAITS for the lock and the watcher only TRIES it, on the same key');
ok(WATCH.indexOf('pg_try_advisory_xact_lock') < WATCH.indexOf('dc_resolve_canonical'),
  'L2: the watcher takes the lock before it resolves');

// ── the detector: a current run with not one linked observation ───────────────────────────────────
ok(/where r\.id in \(select c\.acquisition_run_id from public\.dc_current_observation c\)/.test(WATCH)
   && /and not exists \(select 1\s+from public\.dc_current_observation c\s+join public\.dc_entity_observation eo/.test(WATCH),
  'D1: it fires on a CURRENT run with zero links, so a single unlinkable record can never make it fire forever');

// ── the jobs ──────────────────────────────────────────────────────────────────────────────────────
ok(SQL.includes("cron.schedule('dc-resolve-canonical', '25 * * * *', $c$select public.dc_resolve_serialized('canonical')$c$)")
   && /cron\.schedule\('dc-resolve-geography', '35 \* \* \* \*',\s*\$c\$set statement_timeout = '300s'; select public\.dc_resolve_serialized\('geography'\)\$c\$\)/.test(SQL)
   && SQL.includes("cron.schedule('dc-resolve-on-acquisition', '*/2 * * * *', 'select public.dc_resolve_on_acquisition()')"),
  'J1: the hourly resolvers keep their :25/:35 schedules through the lock; the watcher runs every 2 minutes');
// the drift guard must accept exactly what the DDL of record schedules, or a replay of step 3a/3b is refused
// forever (and a re-apply after such a replay is the documented way back to the lock)
const s3a = (read('docs/dc-step3a-canonical-identity.sql').match(/cron\.schedule\('dc-resolve-canonical', '25 \* \* \* \*',\s*'([^']+)'\)/) || [])[1];
const s3b = (read('docs/dc-step3b-canonical-geography.sql').match(/cron\.schedule\('dc-resolve-geography', '35 \* \* \* \*',\s*'([^']+)'\)/) || [])[1];
ok(s3a && s3b && SQL.includes("v_canon is distinct from '" + s3a + "'") && SQL.includes("v_geo is distinct from '" + s3b + "'"),
  'J2: the drift guard accepts exactly the commands the step 3a/3b DDL of record schedules', `${s3a} | ${s3b}`);
ok(/raise exception 'DRIFT: dc-resolve-canonical/.test(SQL) && /raise exception 'DRIFT: dc-resolve-geography/.test(SQL),
  'J3: any other command is refused, never overwritten');

// ── access and wiring ─────────────────────────────────────────────────────────────────────────────
ok(/revoke all on function public\.dc_resolve_serialized\(text\) from public, anon, authenticated;/.test(SQL)
   && /revoke all on function public\.dc_resolve_on_acquisition\(\) from public, anon, authenticated;/.test(SQL),
  'A1: neither function can be called by the public site key');
const WF = read('.github/workflows/zip-membership-suite.yml');
ok(/bash test\/dc_marker_loss_pg\/run\.sh/.test(WF) && (WF.match(/'docs\/dc-marker-loss-watcher\.sql'/g) || []).length === 2,
  'A2: CI runs the executable proof on pull requests and pushes touching the watcher');

console.log(`\n${n - bad}/${n} passed`);
process.exit(bad ? 1 : 0);
