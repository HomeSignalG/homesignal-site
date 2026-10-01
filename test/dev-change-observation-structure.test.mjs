// DEVELOPMENT CHANGE LEDGER, THE RECURRING OBSERVATION JOB AND ITS ALARM — the structural half
// (the executable half is test/dev_change_observation_pg).
//
// A PostgreSQL suite proves the job BEHAVES. What it cannot see is the file quietly changing SHAPE: a baseline
// run started by a scheduled call (every project would read as new), a number moving (the 200-ZIP cap, the 60 s
// limit, the 3,500 MB budget, the 24 h interval), a second writer (an insert, a delete, a read of the raw event
// table), an error text or an address leaking out of the health read, a grant to an API role, a check that no
// longer reads only the health function, a rollback that deletes ledger rows. Those are pinned here on
// COMMENT-STRIPPED text (the raw text where a literal itself contains "--"), each with a positive control so a
// scan that matched nothing cannot pass.
// Run: node test/dev-change-observation-structure.test.mjs
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

let n = 0, bad = 0;
const ok = (c, m, d) => { n++; if (c) console.log('PASS — ' + m); else { bad++; console.log('FAIL — ' + m + (d !== undefined ? '  [' + d + ']' : '')); } };
const ROOT = new URL('..', import.meta.url).pathname;
const read = (f) => readFileSync(join(ROOT, f), 'utf8');
const stripSql = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');
const count = (s, re) => (s.match(re) || []).length;

const RAW = read('docs/dev-change-observation-schedule.sql');
const SQL = stripSql(RAW);
const SUITE = read('test/dev_change_observation_pg/suite.sql');
const MUT = read('test/dev_change_observation_pg/mutate.py');
const RUN = read('test/dev_change_observation_pg/run.sh');
const WF_PATH = '.github/workflows/dev-change-observation-suite.yml';
const WF = existsSync(join(ROOT, WF_PATH)) ? read(WF_PATH) : '';

const fnBody = (name) => (SQL.match(new RegExp('create or replace function public\\.' + name + '\\(\\)[\\s\\S]*?\\$fn\\$;')) || [''])[0];
const WRAP = fnBody('dev_change_observe_scheduled');
const HEALTH = fnBody('dev_change_observation_health');
const BLOCK = (RAW.match(/\$blk\$([\s\S]*?)\$blk\$/) || ['', ''])[1];
const CRON = (SQL.match(/do \$cron\$[\s\S]*?\$cron\$;/) || [''])[0];
const PRE = (SQL.match(/do \$pre\$[\s\S]*?\$pre\$;/) || [''])[0];
const ROLLBACK = RAW.slice(RAW.indexOf('-- ROLLBACK-BEGIN'), RAW.indexOf('-- ROLLBACK-END'));

// ── 0. everything under test is located (positive control for every scan below) ────────────────────
ok(RAW.length > 12000 && WRAP.length > 1500 && HEALTH.length > 1500 && BLOCK.length > 1500 && CRON.length > 300 && PRE.length > 800 && ROLLBACK.length > 600,
  '0: the SQL of record and each of its parts (wrapper, health read, job, check block, preconditions, rollback) are located and non-empty',
  [RAW.length, WRAP.length, HEALTH.length, BLOCK.length, CRON.length, PRE.length, ROLLBACK.length].join('/'));
ok(SUITE.length > 20000 && MUT.length > 5000 && RUN.length > 4000,
  '0b: the suite, the mutations and the harness are located and non-empty');

// ── 1. it fails closed: nothing is scheduled over what is not there ────────────────────────────────
ok(/dev_change_tick\(uuid, integer, integer, bigint, bigint, integer\)/.test(PRE) && /dev_change_zip_cursor/.test(PRE)
   && /dev_change_copy_conflict/.test(PRE) && /dev_change_record_facts\(jsonb\)/.test(PRE)
   && /dev_change_event_reportable/.test(PRE) && /pipeline_health_tick/.test(PRE),
  '1: the preconditions name the Order D driver, the cursor, ledger option (b) (the table and the function), the reportable view and the monitor');
ok(count(PRE, /raise exception/g) === 5 && /option \(b\)/.test(PRE),
  '1b: five refusals (the driver, option (b), the reportable view, the monitor, the monitor\'s splice anchor), and the option (b) one names it');
ok(/to_regclass\('public\.dev_change_copy_conflict'\) is null/.test(WRAP) && /raise exception 'dev_change_observe_scheduled: ledger option \(b\)/.test(WRAP),
  '1c: the wrapper itself refuses, before writing anything, if option (b) is missing (a later drop must not turn the job into a source of false changes)');

// ── 2. the four numbers, and nothing else is chosen ──────────────────────────────────────────────────
ok(count(WRAP, /_max_zips\s+constant integer := 200;/g) === 1 && count(WRAP, /_max_secs\s+constant integer := 60;/g) === 1
   && count(WRAP, /_budget_mb\s+constant bigint\s+:= 3500;/g) === 1 && count(WRAP, /_interval_h constant integer := 24;/g) === 1,
  '2: 200 ZIPs, 60 seconds, a 3,500 MB ledger budget and a 24-hour interval, each a constant declared once');
ok(/dev_change_tick\(_run, _max_zips, _max_secs, _budget_mb, null, _interval_h\)/.test(WRAP),
  '2b: the tick is called with exactly those constants and NO verified-free-disk figure (an ordinary run never gets the baseline capacity override)');
ok(!/\b(200|60|3500|24)\b/.test(WRAP.replace(/constant (integer|bigint)\s*:= \d+;/g, '').replace(/'[^']*'/g, '')),
  '2c: no other numeric literal in the wrapper: the numbers are not repeated or overridden further down');

// ── 3. ordinary runs only, started through the ledger's own helper ─────────────────────────────────
ok(count(WRAP, /dev_change_start_run\(false,/g) === 1 && !/dev_change_start_run\(\s*true/.test(WRAP) && !/dev_change_start_run\(\s*(?!false)/.test(WRAP),
  '3: the only run the wrapper starts is dev_change_start_run(false, …): an ordinary run, which can never write a first sighting as news');
ok(/'purpose', 'scheduled'/.test(WRAP) && /'day', _day/.test(WRAP) && /_day\s+text := to_char\(now\(\) at time zone 'UTC', 'YYYY-MM-DD'\)/.test(WRAP),
  '3b: the run is stamped with its purpose and its UTC day, and the day is a UTC day');
ok(/r\.detail->>'day' <> _day loop/.test(WRAP) && /dev_change_finish_run\(_old\.id\)/.test(WRAP) && /r\.detail->>'day' = _day/.test(WRAP),
  '3c: the first call of a new day closes the earlier days\' runs through the ledger\'s helper, and a call reuses today\'s run');

// ── 4. the only direct write is the receipt on the wrapper\'s own run ──────────────────────────────
const WRAP_BODY = WRAP.replace(/create or replace function[^\n]*\n/, '');
const stmts = [...WRAP_BODY.matchAll(/\b(insert\s+into|update|delete\s+from|truncate|alter\s+table|drop\s+\w+|create\s+\w+)\s+([a-z_.]+)/gi)].map((m) => m[1].toLowerCase().replace(/\s+/g, ' ') + ' ' + m[2]);
ok(/update public\.dev_change_run r/.test(WRAP) && /\bupdate\b/i.test(WRAP.replace(/create or replace function[^\n]*\n/, '')),
  '4-control: the scan sees the wrapper\'s one UPDATE');
ok(stmts.length === 1 && stmts[0] === 'update public.dev_change_run', '4: the wrapper\'s one direct write is the receipt UPDATE on dev_change_run — no insert, delete, truncate or DDL', stmts.join(' | '));
const SET = (WRAP.match(/update public\.dev_change_run r\s+set detail = r\.detail \|\| jsonb_build_object\([\s\S]*?\)\s+where r\.id = _run;/) || [''])[0];
ok(SET.length > 300 && ['ticks', 'last_tick_at', 'last_tick', 'completed', 'completed_at'].every((k) => new RegExp("'" + k + "',").test(SET))
   && [...SET.matchAll(/^\s+'([a-z_]+)',\s/gm)].length === 5 && !/\bset\s+(finished_at|baseline|started_at|id)\b/.test(SET),
  '4b: the receipt MERGES five keys into the run\'s detail and changes no column of the run (not baseline, not started_at, not finished_at)');
ok(/where r\.id = _run;/.test(SET) && !/where r\.id = _run or/i.test(SET),
  '4c: the receipt is written to the one run this call ticked, and to no other');

// ── 5. the wrapper reads the ledger only through the run and the tick; the health read only counts ──
ok(!/\bdev_change_event\b/.test(WRAP) && !/\bdev_change_project\b/.test(WRAP) && !/\bdev_change_event_reportable\b/.test(WRAP),
  '5: the wrapper never names the event table, the project table or the reportable view (the one reader of events stays the reportable view)');
ok(!/\bdev_change_event\b/.test(HEALTH) && !/\bdev_change_project\b/.test(HEALTH) && !/\bapp_projects\b/.test(HEALTH),
  '5b: the health read never names the event table, the project table or app_projects');
ok(!/\b(insert\s+into|update|delete\s+from|truncate|alter|drop|create)\b/i.test(HEALTH.replace(/create or replace function[^\n]*\n/, '')),
  '5c: the health read writes nothing');
ok(/returns table \(job_state text, last_tick_at timestamptz, last_stop_reason text, first_run_at timestamptz,\s+last_completed_at timestamptz, zips_in_error bigint, error_zips text,\s+cron_runs bigint, cron_recent_failed integer\)/.test(HEALTH),
  '5d: the health read returns exactly nine documented columns: states and fixed words, times, counts and ZIP codes');
ok(!/\bc\.error\b/.test(HEALTH) && !/\bz\.error\b/.test(HEALTH) && !/\b(name|address|identity_key|source_key|record_url)\b/.test(HEALTH.replace(/'[^']*'/g, '')),
  '5e: no error text, project name, address or record key is read by the health read (a ZIP code and a count are all it says about a failure)');
ok(/limit 5\) z;/.test(HEALTH), '5f: at most five ZIP codes are named');

// ── 6. who may call it ──────────────────────────────────────────────────────────────────────────────────
ok(/revoke all on function public\.dev_change_observe_scheduled\(\) from public, anon, authenticated;/.test(SQL)
   && /grant execute on function public\.dev_change_observe_scheduled\(\) to service_role;/.test(SQL)
   && /revoke all on function public\.dev_change_observation_health\(\) from public, anon, authenticated;/.test(SQL)
   && /grant execute on function public\.dev_change_observation_health\(\) to service_role;/.test(SQL),
  '6: both functions are revoked from PUBLIC, anon and authenticated, then granted to service_role only');
ok(!/grant[^;]*\bto\b[^;]*\b(anon|authenticated|public)\b/i.test(SQL), '6b: nothing is ever granted to anon, authenticated or PUBLIC');
ok(count(WRAP + HEALTH, /security definer set search_path = public, pg_temp/g) === 2,
  '6c: both functions run as their owner with a pinned search_path (the cron job runs as the owner either way; a pinned path stops an object in another schema from taking over a name)');

// ── 7. the job ────────────────────────────────────────────────────────────────────────────────────
ok(/_name\s+constant text := 'dev-change-observe';/.test(CRON) && /_cmd\s+constant text := 'select public\.dev_change_observe_scheduled\(\)';/.test(CRON),
  '7: ONE job named dev-change-observe that calls only the wrapper');
ok(/perform cron\.schedule\(_name, _sched, _cmd\);/.test(CRON) && /perform cron\.alter_job\(_id, schedule := _sched, command := _cmd, active := true\);/.test(CRON)
   && /order by jobid limit 1/.test(CRON),
  '7b: a new job is scheduled; an existing one is ALTERED IN PLACE with schedule, command and active reasserted (re-applying re-arms a deactivated job and never makes a second)');
const SCHED = (CRON.match(/_sched\s+constant text := '([^']+)';/) || ['', ''])[1];
const [sMin, sHour, ...sRest] = SCHED.split(' ');
const [h0, h1] = sHour.split('-').map(Number);
ok(sRest.join(' ') === '* * *' && /^\*\/\d+$/.test(sMin) && Number.isInteger(h0) && Number.isInteger(h1) && h0 <= h1,
  '7c: the schedule is "every N minutes, in a bounded UTC hour window, every day"', SCHED);
ok(h1 < 13,
  '7d: the window ENDS before 13:00 UTC, the earliest the daily verify-communities walk can start (13:17), so this job never runs beside it', SCHED);
ok(Number(sMin.slice(2)) >= 5,
  '7e: a call every five minutes at the fastest (one call is bounded at 60 s, so the duty cycle is at most 20%)', SCHED);
// the window must be able to FINISH a pass: 12,722 canonical ZIPs (the registry; CLAUDE.md "12,722 ZIP pages, fixed") at 200 a call
const CALLS_PER_DAY = (60 / Number(sMin.slice(2))) * (h1 - h0 + 1);
ok(CALLS_PER_DAY * 200 >= Math.ceil(12722 * 1.1),
  '7g: the window holds enough calls to walk the whole registry in a day with 10% headroom (a window that cannot reach "nothing due" would trip its own alarm)',
  CALLS_PER_DAY + ' calls x 200 = ' + CALLS_PER_DAY * 200 + ' vs ' + Math.ceil(12722 * 1.1));
ok(/raise notice 'pg_cron not installed here/.test(CRON), '7f: with no pg_cron the job is not scheduled and says so (a notice, not a failure)');

// ── 8. the check: ONE reader, every threshold, fails as a failing row ─────────────────────────────
const BLOCK_CODE = stripSql(BLOCK);
ok(count(BLOCK_CODE, /\bfrom\b/g) === 1 && /from public\.dev_change_observation_health\(\) h/.test(BLOCK_CODE),
  '8: the check reads ONLY public.dev_change_observation_health()');
const BLOCK_TOKENS = [...BLOCK_CODE.replace(/'[^']*'/g, "''").matchAll(/\bdev_change_[a-z_]+/g)].map((m) => m[0]);
ok(BLOCK_TOKENS.length >= 1 && BLOCK_TOKENS.every((t) => t === 'dev_change_observation_health'),
  '8b: the only ledger object the check names is the health function (no table, no view, however it is spelled)', BLOCK_TOKENS.join(','));
ok(count(BLOCK, /insert into _eval/g) === 2 && /exception when others then\s+insert into _eval values \('dev_change_observation', false, true,/.test(BLOCK)
   && /SQLSTATE ' \|\| sqlstate/.test(BLOCK) && !/sqlerrm/.test(BLOCK),
  '8c: a check that cannot run is a FAILING, alertable row naming the SQLSTATE only (never the message)');
ok(/interval '36 hours'/.test(BLOCK) && count(BLOCK, /interval '48 hours'/g) === 2 && /h\.cron_recent_failed >= 3/.test(BLOCK)
   && /h\.last_stop_reason = 'ledger_budget'/.test(BLOCK) && /h\.zips_in_error > 0/.test(BLOCK) && /h\.job_state <> 'ok'/.test(BLOCK),
  '8d: every threshold is in the block: the job state, 36 hours without a tick, 48 hours without a completed pass (both ends), the ledger budget stop, three failed cron runs, any ZIP in error');
ok(/not \(h\.last_tick_at is null and h\.cron_runs = 0 and h\.job_state = 'ok'\)/.test(BLOCK),
  '8e: the UNKNOWN state (armed, never ticked, no cron run) is ok and NOT alertable — and only that state');
ok(/\(q\.problems = ''\)/.test(BLOCK), '8f: the check is ok exactly when no problem was found');
ok(/position\(_begin in _def\) > 0/.test(SQL) && /<> 1 then\s+raise exception 'anchor % appears % time\(s\), expected exactly 1/.test(SQL)
   && /execute replace\(_def, _anchor, _block \|\| _anchor\);/.test(SQL) && /splice did not take/.test(SQL),
  '8g: the splice is idempotent, refuses unless the anchor is there exactly once, inserts the block before it, and re-reads the function to prove it took');
ok(RAW.includes("_begin  text := '-- >>> dev_change_observation (begin)';") && BLOCK.includes('-- <<< dev_change_observation (end)'),
  '8h: the block is delimited by the begin and end markers the rollback looks for');

// ── 9. the rollback removes this file\'s own objects and nothing of the ledger ──────────────────────
ok(/execute substr\(_def, 1, _b - 1\) \|\| substr\(_def, _e \+ length\(_end\) \+ 3\);/.test(ROLLBACK)
   && /cron\.unschedule\(j\.jobid\)[^\n]*dev-change-observe/.test(ROLLBACK)
   && /drop function if exists public\.dev_change_observation_health\(\);/.test(ROLLBACK)
   && /drop function if exists public\.dev_change_observe_scheduled\(\);/.test(ROLLBACK),
  '9: the rollback unsplices the check, unschedules the job and drops the two functions');
ok(!/drop\s+(table|view)|delete\s+from|truncate/i.test(ROLLBACK),
  '9b: the rollback deletes no table, view or row: the runs the job wrote and every ledger row stay (the ledger is append-only)');

// ── 10. no locality, no lifecycle, no classifier ─────────────────────────────────────────────────────
const localisms = SQL.match(/\b(nyc|new york|manhattan|brooklyn|bronx|queens|staten|dob|socrata|arcgis|legistar|granicus|civicplus|tucson|phoenix|denver)\b/gi) || [];
ok(localisms.length === 0, '10: no city or source-vendor literal', localisms.join(','));
ok(!/'(proposed|approved|operating|unknown)'/.test(SQL) && !/lifecycle/i.test(SQL) && !/event_type\s*(=|in)/i.test(SQL),
  '10b: no lifecycle key and no event-type filter: this file decides WHEN to observe, never what a change is');

// ── 11. the suite, its mutations and its workflow are real and wired ───────────────────────────────────
const ids = new Set([...SUITE.matchAll(/pg_temp\._ck\(\s*'([WH]\d+[a-z]?)\b/g)].map((m) => m[1]));
const harnessIds = new Set([...RUN.matchAll(/\b(?:tf|emit) '([ARN]\d+[a-z]?)\b/g)].map((m) => m[1]));
ok(ids.size >= 45 && harnessIds.size >= 16, '11: the executable suite carries at least 45 database checks and the harness at least 16 file-level ones', ids.size + '/' + harnessIds.size);
const mutNames = [...MUT.matchAll(/^    '([a-z_0-9]+)': \[/gm)].map((m) => m[1]);
ok(mutNames.length >= 50 && new Set(mutNames).size === mutNames.length, '11b: at least 50 distinct prohibited mutations', mutNames.length);
ok(['wrapper_starts_a_baseline_run', 'wrapper_without_option_b_refusal', 'wrapper_opens_a_run_per_tick', 'wrapper_never_closes_an_old_day',
    'completed_is_not_sticky', 'completion_declared_on_any_tick', 'tick_cap_of_one_zip', 'tick_cap_of_500_zips', 'interval_of_one_hour', 'interval_of_72_hours',
    'job_not_reactivated_on_reapply', 'missing_job_reads_ok', 'unknown_state_is_alertable', 'check_has_no_failure_handler',
    'health_leaks_an_error_text', 'wrapper_open_to_the_api_roles', 'arms_without_option_b', 'splice_is_not_idempotent', 'rollback_leaves_the_check']
     .every((m) => mutNames.includes(m)),
  '11c: the mutations that matter most are present: a baseline run, no option (b) refusal, a run per tick, stickiness, both ends of the cap and of the interval, an unarmed job reading ok, a leak, the API roles, an unguarded arm, the splice and the rollback');
ok(/\*disposable\*/.test(RUN) && /SURVIVED/.test(RUN) && /CRASHED-ONLY/.test(RUN) && /the suite CRASHED before printing a single result/.test(RUN)
   && /grep -vc '\^suite\|f\|'/.test(RUN),
  '11d: the harness refuses a non-disposable database, fails on any surviving mutation, and counts a mutation that only CRASHES the suite as NOT killed (a crash prints nothing, which once read as "no failures")');
ok(/grant usage on schema public to anon, authenticated, service_role/.test(SUITE) && /alter role service_role bypassrls/.test(SUITE),
  '11e: the suite gives the stand-in roles the schema usage and RLS bypass Supabase gives them, so a refusal can only come from the function');
ok(/count\(\*\) = 1 and bool_and\(detail->>'ticks' = '2'\)/.test(SUITE) && /count\(\*\) = 1 and bool_and\(\(detail->>'completed'\)::boolean and detail->>'completed_at' = /.test(SUITE),
  '11f: the checks that read the scheduled runs are AGGREGATES over them (a regression that leaves two rows where one is expected fails its named check instead of crashing the suite)');
ok(/'W15b[^']*'/.test(SUITE) && /generate_series\(1, 201\)/.test(SUITE) && /zips_observed' = '200' and j->>'stopped_reason' = 'max_zips'/.test(SUITE),
  '11g: one scenario makes 201 ZIPs due and requires exactly 200 observed with the stop named max_zips (this is what pins the cap)');
ok(WF.length > 1500 && /test\/dev_change_observation_pg\/run\.sh/.test(WF) && /Refuse to run if any Supabase credential is present/.test(WF)
   && /services:\s*\n\s*postgres:/.test(WF) && /POSTGRES_DB: dev_change_observation_disposable/.test(WF) && !/SUPABASE_[A-Z_]+:\s*\$\{\{\s*secrets\./.test(WF),
  '11h: the workflow runs the harness against a disposable service container, holds no Supabase secret, and refuses to run if one is present');
ok(/docs\/dev-change-observation-schedule\.sql/.test(WF) && /test\/dev_change_observation_pg\/\*\*/.test(WF) && /docs\/dev-change-ledger\.sql/.test(WF),
  '11i: the workflow is triggered by a change to the schedule, its suite and the ledger it depends on');

console.log('\n' + (n - bad) + ' passed, ' + bad + ' failed of ' + n);
process.exit(bad ? 1 : 0);
