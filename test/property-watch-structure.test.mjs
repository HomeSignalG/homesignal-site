// THE WATCH — the structural half (Development Activity build step 9). The executable halves are test/property_watch_pg and
// test/property_watch_schedule_pg (the real SQL against a disposable Postgres, with real concurrent sessions),
// test/property-watch-changes.test.mjs (the diff, over the real engine's output), test/property-watch-email.test.mjs (the message) and
// test/property-watch-functions.test.mjs (the two handlers and their data layers). What none of them can see is the SHAPE that keeps a watch
// from becoming a second way to decide what a report says, or a place a property can leak from:
//   * the SQL: two tables and no column that could hold a property; one owner for each number; standing is a CALL to the saved-report check;
//     every removal of a watch closes its need; the daily slot moves only when a check is recorded; the system alone can run any of it;
//   * the schedule: one job, one wrapper, the secret only in a header, the public key the pages already carry, counts-only health;
//   * the edge: the change is decided in ONE place (the engine's rule, called, not copied); the canonical reads are shared with the report; ONE
//     module reads the private layer and the point leaves it by one door only; the run is gated by a secret compared in constant time; the email
//     is sent before anything is recorded as told; JWT stays on for both new functions;
//   * the wiring: the CI job, the mutation harnesses and the written record exist.
// Pinned on COMMENT-STRIPPED text, each with a positive control so a scan that matched nothing cannot pass.
// Run: node test/property-watch-structure.test.mjs
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

let n = 0, bad = 0;
const ok = (c, m, d) => { n++; if (c) console.log('PASS — ' + m); else { bad++; console.log('FAIL — ' + m + (d !== undefined ? '  [' + d + ']' : '')); } };
const ROOT = new URL('..', import.meta.url).pathname;
const read = (f) => (existsSync(join(ROOT, f)) ? readFileSync(join(ROOT, f), 'utf8') : '');
const stripSql = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');
const stripJs = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
const count = (s, re) => (s.match(re) || []).length;
/** The text of one SQL function: from its `create or replace function <name>(` to the end of its dollar-quoted body. */
function sqlFn(sql, name) {
  const i = sql.search(new RegExp('create or replace function public\\.' + name + '\\('));
  if (i < 0) return '';
  const rest = sql.slice(i);
  const open = /\bas\s+\$(\w*)\$/.exec(rest);
  if (!open) return '';
  const tag = '$' + open[1] + '$';
  const end = rest.indexOf(tag, open.index + open[0].length);
  return end < 0 ? '' : rest.slice(0, end + tag.length);
}
/** A TypeScript function body by name, brace-matched. */
function tsFn(src, name) {
  const i = src.search(new RegExp('(?:async\\s+)?function\\s+' + name + '\\b|\\b' + name + '\\s*\\([^)]*\\)\\s*(?::[^{]+)?\\{'));
  if (i < 0) return '';
  const open = src.indexOf('{', src.indexOf(')', i));
  let depth = 0;
  for (let k = open; k < src.length; k++) { if (src[k] === '{') depth++; else if (src[k] === '}') { depth--; if (depth === 0) return src.slice(i, k + 1); } }
  return '';
}

// ---- 1. the watch SQL -----------------------------------------------------------------------------------------------------------------------
const RAW = read('docs/property-watch.sql');
const SQL = stripSql(RAW);
const SQL_NS = SQL.replace(/'(?:[^']|'')*'/g, "''");
const FUNCS = ['property_watch_period', 'property_watch_limit', 'property_watch_lease', 'property_watch_retry', 'property_watch_seen_keep', 'property_watch_guard', 'property_watch_close_need',
  'property_watch_no_truncate', 'evaluation_property_watch_start', 'evaluation_property_watches_of', 'evaluation_property_watch_stop', 'property_watch_claim', 'property_watch_record_run',
  'property_watch_record_failure', 'property_watch_end', 'property_watch_integrity'];
ok(SQL.length > 5000 && FUNCS.every((f) => new RegExp('create or replace function public\\.' + f + '\\(').test(SQL)), '1a the SQL of record defines the sixteen functions (positive control)');
ok(count(SQL, /create table if not exists public\.property_watch\w*/g) === 2 && count(SQL, /create (or replace )?(view|type|policy|sequence|extension)\b/gi) === 0 && count(SQL, /create or replace function/g) === 16,
  '1b it creates exactly two tables and sixteen functions: no view, type, policy, sequence or extension');
ok(!/cron\.schedule|net\.http_|vault\./i.test(SQL_NS), '1c and schedules nothing and calls nothing: the schedule is another file, applied last');

const tableCols = (name) => {
  const m = new RegExp('create table if not exists public\\.' + name + ' \\(([\\s\\S]*?)\\n\\);').exec(SQL);
  return m ? m[1].split('\n').map((l) => l.trim().split(/\s+/)[0]).filter((c) => /^[a-z_]+$/.test(c) && !['constraint', 'check', 'unique', 'primary', 'foreign'].includes(c)) : [];
};
const WATCH_COLS = tableCols('property_watch'), SEEN_COLS = tableCols('property_watch_seen');
ok(WATCH_COLS.length >= 8 && SEEN_COLS.length >= 4 && WATCH_COLS.includes('watch_id') && SEEN_COLS.includes('project_id'), '1d the two tables\' columns were read (positive control)', WATCH_COLS.join() + ' / ' + SEEN_COLS.join());
ok(![...WATCH_COLS, ...SEEN_COLS].some((c) => /address|label|client|lat|lng|latitude|longitude|point|geom|email|name|zip|phone|note|body|text/i.test(c)),
  '1e neither table has a column that could hold a property, a label, a coordinate, an email or a name: a watch is ids, times, counts and an outcome word', [...WATCH_COLS, ...SEEN_COLS].join());

// the numbers, each written once
ok(/create or replace function public\.property_watch_period\(\) returns interval\s+language sql immutable as \$\$ select interval '1 day' \$\$;/.test(SQL)
   && /property_watch_period\(\) <> interval '1 day'/.test(SQL), '1f the founder\'s DAILY cadence is written once, as 1 day, and the post-condition pins it');
ok(/property_watch_limit\(\) returns integer\s+language sql immutable as \$\$ select 25 \$\$;/.test(SQL) && count(SQL_NS, /\b25\b/g) === 1, '1g the per-brokerage limit is written once, as 25');
ok(/property_watch_lease\(\) returns interval\s+language sql immutable as \$\$ select interval '10 minutes' \$\$;/.test(SQL) && /property_watch_retry\(\) returns interval\s+language sql immutable as \$\$ select interval '1 hour' \$\$;/.test(SQL)
   && /property_watch_seen_keep\(\) returns interval\s+language sql immutable as \$\$ select interval '100 days' \$\$;/.test(SQL), '1h the lease (10 minutes), the back-off unit (1 hour) and the told-about retention (100 days, longer than the 90-day look-back) are each written once');

// standing and ownership are CALLS to their owners
const start = sqlFn(SQL, 'evaluation_property_watch_start'), list = sqlFn(SQL, 'evaluation_property_watches_of'), stop = sqlFn(SQL, 'evaluation_property_watch_stop');
ok(start.length > 600 && /public\.evaluation_report_open\(p_user_id, p_report_id\)/.test(start) && !/\bfrom public\.evaluation\b|evaluation_credit|report_snapshot/.test(start),
  '1i the right to watch is the SAME check that lets a member reopen a saved report (called, not re-written): start joins no entitlement table itself');
ok(/public\.brokerage_membership_of\(/.test(start) && /where w\.user_id = p_user_id/.test(list) && /w\.watch_id = p_watch_id and w\.user_id = p_user_id/.test(stop) && !/evaluation_report_open/.test(list + stop),
  '1j the limit counts through the one membership resolver, and listing and stopping need OWNERSHIP only (a watch can always be taken back, even after a trial has ended)');
ok(/pg_advisory_xact_lock\(/.test(start) && /transaction_isolation/.test(start) && /exception when sqlstate '55000' or sqlstate '23503'/.test(start), '1k the limit is counted after a per-brokerage lock, only under READ COMMITTED, and a refused need leaves no watch behind');

// the private layer: needs only, never a value
ok(count(SQL_NS, /report_private_context_need_open\(/g) >= 2 && count(SQL_NS, /report_private_context_need_close\(/g) === 1, '1l the layer is asked to keep (need_open) and to let go (need_close) - positive control');
ok(!/report_private_context_read|report_private_context_purge|from public\.report_private_context\b|report_private_context\s+(c|p|x)\b/.test(SQL_NS), '1m and nothing in this file reads a private value, a context row or purges one: it never asks for an address');
ok(/create or replace trigger property_watch_closes_need\s+after delete on public\.property_watch\s+for each row execute function public\.property_watch_close_need\(\);/.test(SQL)
   && /property_watch_close_need\(\) returns trigger\s+language plpgsql security definer/.test(SQL), '1n EVERY removal closes the watch\'s need: an AFTER DELETE row trigger, SECURITY DEFINER so a user deletion\'s cascade works');
ok(/create or replace trigger property_watch_no_truncate\s+before truncate/.test(SQL) && /create or replace trigger property_watch_identity_guard\s+before update on public\.property_watch/.test(SQL), '1o a TRUNCATE (which would skip the closing trigger) and a change of identity are refused by triggers');
const deletes = [...SQL_NS.matchAll(/delete from public\.property_watch\b(?!_)/g)].length;
ok(deletes === 2 && /delete from public\.property_watch w where w\.watch_id = p_watch_id and w\.user_id = p_user_id/.test(stop) && /delete from public\.property_watch where watch_id = p_watch;/.test(sqlFn(SQL, 'property_watch_end'))
   && /delete from public\.property_watch;/.test(RAW.slice(RAW.indexOf('-- ROLLBACK-BEGIN'))),
  '1p a watch is deleted in exactly two places in the live SQL - the agent\'s stop and the job\'s end - and in the rollback footer', deletes);

// the daily slot moves only when a check is recorded
const runRec = sqlFn(SQL, 'property_watch_record_run'), failRec = sqlFn(SQL, 'property_watch_record_failure');
ok(runRec.length > 500 && /next_due_at = w\.next_due_at \+ v_k \* public\.property_watch_period\(\)/.test(runRec) && !/next_due_at/.test(failRec) && [...SQL_NS.matchAll(/update\s+public\.property_watch\s+\w*\s*set\s+([^;]*);/g)].filter((m) => /\bnext_due_at\s*=/.test(m[1])).length === 1,
  '1q the daily slot is advanced in ONE place - recording a finished check, from its OWN slot, never from now - and a failure never touches it');
ok(/retry_after = now\(\) \+ public\.property_watch_retry\(\) \* least\(v_fail, 24\)/.test(failRec), '1r a failure backs off on its own column, by an hour times the failures so far, capped at 24 hours');
ok(/for update skip locked/.test(sqlFn(SQL, 'property_watch_claim')) && /order by w\.next_due_at, w\.watch_id/.test(sqlFn(SQL, 'property_watch_claim')), '1s a claim leases the oldest due watches and skips rows another run holds');

// lock-down
ok(FUNCS.every((f) => new RegExp('revoke all on function public\\.' + f + '\\([^)]*\\)\\s+from public, anon, authenticated, service_role;').test(SQL))
   && FUNCS.filter((f) => !['property_watch_guard', 'property_watch_close_need', 'property_watch_no_truncate'].includes(f)).every((f) => new RegExp('grant execute on function public\\.' + f + '\\([^)]*\\)\\s+to service_role;').test(SQL))
   && !/grant[^;]*\bto\s+[^;]*\b(anon|authenticated|public)\b/i.test(SQL_NS.replace(/revoke[^;]*;/gi, '')),
  '1t every function is revoked from everyone by name and granted to service_role alone (the three trigger functions to nobody): no grant to anon, authenticated or PUBLIC anywhere');
ok(count(SQL, /alter table public\.property_watch\w*\s+enable row level security;/g) === 2 && count(SQL, /grant select on public\.property_watch\w*\s+to service_role;/g) === 2 && !/grant (insert|update|delete|all)[^;]*public\.property_watch/i.test(SQL_NS),
  '1u both tables have row level security on and are SELECT-only to the system: every write is through the functions');
ok(count(SQL_NS, /security definer/g) === 9 && count(SQL_NS, /security definer set search_path = public, pg_temp/g) === 9 && /do \$post\$/.test(SQL) && /-- ROLLBACK-BEGIN/.test(RAW) && /-- ROLLBACK-END/.test(RAW)
   && RAW.indexOf('delete from public.property_watch;') < RAW.indexOf('drop table if exists public.property_watch_seen'), '1v each of the nine SECURITY DEFINER functions pins its search_path, there is a post-condition, and the rollback deletes the watches (closing their needs) BEFORE dropping the tables');

// ---- 2. the schedule SQL ------------------------------------------------------------------------------------------------------------------------------
const SRAW = read('docs/property-watch-schedule.sql');
const SSQL = stripSql(SRAW);
const SNS = SSQL.replace(/'(?:[^']|'')*'/g, "''");
const wrapper = sqlFn(SSQL, 'property_watch_run_scheduled'), health = sqlFn(SSQL, 'property_watch_job_health');
ok(SSQL.length > 3000 && wrapper.length > 500 && health.length > 800, '2a the schedule file defines the wrapper and the health read (positive control)');
ok(count(SSQL, /cron\.schedule\(/g) === 1 && /_name\s+constant text := 'property-watch-run'/.test(SSQL) && /_sched constant text := '3,13,23,33,43,53 \* \* \* \*'/.test(SSQL) && /_cmd\s+constant text := 'select public\.property_watch_run_scheduled\(\)'/.test(SSQL),
  '2b ONE job, named property-watch-run, on six minutes of every hour, running exactly the wrapper');
ok(/_limit constant integer := 5;/.test(wrapper) && /'x-signup-secret', _secret/.test(wrapper) && count(wrapper.replace(/'(?:[^']|'')*'/g, "''"), /\b_secret\b/g) === 5 && !/jsonb_build_object\('limit', _limit[^)]*_secret/.test(wrapper) && /name = 'signup_hook_secret'/.test(wrapper),
  '2c the scheduler secret is read from the vault, used once, in a header: it is not in the URL or the body');
ok(/raise exception[\s\S]*?using errcode = '28000'/.test(wrapper) && wrapper.indexOf("errcode = '28000'") < wrapper.indexOf('net.http_post'), '2d a missing secret raises BEFORE any request is built: an unauthenticated request never goes out');
const anon = (/_anon\s+constant text := '([^']+)'/.exec(SSQL) || [])[1];
const pageAnon = (/var SB_ANON = '([^']+)'/.exec(read('development-activity-reports.html')) || [])[1];
const claims = anon ? JSON.parse(Buffer.from(anon.split('.')[1], 'base64url').toString()) : {};
ok(anon && anon === pageAnon && claims.role === 'anon' && claims.ref === 'qwnnmljucajnexpxdgxr', '2e the gateway key in the wrapper is the public key the agent page already carries, byte for byte, and its role is "anon"');
ok(/https:\/\/qwnnmljucajnexpxdgxr\.supabase\.co\/functions\/v1\/run-property-watch/.test(wrapper), '2f it posts to run-property-watch on this project');
ok(/revoke all on function public\.property_watch_run_scheduled\(\) from public, anon, authenticated, service_role;/.test(SSQL) && !/grant execute on function public\.property_watch_run_scheduled/.test(SSQL),
  '2g the wrapper is callable by its owner alone (pg_cron runs as the owner): not even service_role');
const healthFrom = [...health.matchAll(/\bfrom\s+([a-z_.]+)/gi)].map((m) => m[1].toLowerCase());
ok(healthFrom.length >= 3 && healthFrom.every((t) => ['public.property_watch_integrity', 'public.property_watch', 'cron.job', 'cron.job_run_details'].includes(t)) && !/report_snapshot|report_private_context|auth\.users|property_watch_seen/.test(health),
  '2h the health read looks only at the audit, the watch table\'s counts and cron: never a report, a private context or a user', healthFrom.join());
ok(/-- >>> property_watch_run \(begin\)/.test(SRAW) && /-- <<< property_watch_run \(end\)/.test(SRAW) && /refusing to splice/.test(SSQL) && /splice did not take/.test(SSQL) && /A check that cannot run is a failing check|a check that cannot run is a failing check/i.test(SRAW)
   && /exception when others then\s+insert into _eval values \('property_watch_run', false, true,/.test(SSQL), '2i the check is spliced into the live monitor behind one anchor, re-read after, and a check that cannot run is a FAILING, alertable row');
ok(SSQL.indexOf('docs/property-watch.sql is not applied') >= 0 && SSQL.indexOf('docs/property-watch.sql is not applied') < SSQL.indexOf('cron.schedule(') && SSQL.indexOf('no single splice anchor') < SSQL.indexOf('cron.schedule('),
  '2j the job is armed only after the preconditions: the watch layer is there and the monitor can carry the alarm');

// ---- 3. the edge ------------------------------------------------------------------------------------------------------------------------------------------
const FN = 'supabase/functions/';
const PW = stripJs(read(FN + '_shared/property-watch.ts'));
const CSR = stripJs(read(FN + '_shared/changes-since-report.ts'));
const NR = stripJs(read(FN + '_shared/national-report.ts'));
const PS = stripJs(read(FN + '_shared/private-subject.ts'));
const WR = stripJs(read(FN + '_shared/watch-reads.ts'));
const WE = stripJs(read(FN + '_shared/watch-email.ts'));
const ES = stripJs(read(FN + '_shared/email-send.ts'));
const RRUN = stripJs(read(FN + '_shared/report-run.ts'));
const RREADS = stripJs(read(FN + '_shared/report-reads.ts'));
const RH = stripJs(read(FN + 'run-property-watch/handler.ts'));
const RD = stripJs(read(FN + 'run-property-watch/data.ts'));
const RI = stripJs(read(FN + 'run-property-watch/index.ts'));
const MH = stripJs(read(FN + 'manage-property-watch/handler.ts'));
const MD = stripJs(read(FN + 'manage-property-watch/data.ts'));
const REPORT_H = stripJs(read(FN + 'get-development-activity-report/handler.ts'));
const REPORT_D = stripJs(read(FN + 'get-development-activity-report/data.ts'));
ok([PW, CSR, NR, PS, WR, WE, ES, RRUN, RREADS, RH, RD, RI, MH, MD].every((t) => t.length > 500), '3a every edge file was read (positive control)');

// the change is decided in ONE place
const forProjects = tsFn(CSR, 'changesForProjects'), forReport = tsFn(CSR, 'changesSinceReport');
ok(forProjects.length > 300 && /selectDetectedChanges\(/.test(forProjects) && count(CSR, /selectDetectedChanges\(/g) === 1 && count(NR, /export function selectDetectedChanges\(/g) === 1,
  '3b the engine\'s change rule (selectDetectedChanges) is CALLED from exactly one place in changes-since-report.ts, and defined once in the engine');
ok(forReport.length > 100 && /changesForProjects\(/.test(forReport) && /changesForProjects\(/.test(PW) && count(PW, /changesForProjects\(/g) === 1 && !/selectDetectedChanges\(|created_at|event_type\s*===|material/.test(PW),
  '3c Changes Since Report and the Watch both call changesForProjects; the Watch decides no change, no boundary and no materiality of its own');
ok(!/from '\.\/service-rest\.ts'|from '\.\/private-subject\.ts'|fetch\(|Deno\.|Date\.now\(\)|new Date\(\)/.test(PW) && /import \{ changesForProjects[^}]*\} from '\.\/changes-since-report\.ts'/.test(PW),
  '3d the Watch\'s diff is pure: no network, no clock of its own, no private-layer reader, no database client');

// the canonical reads are shared with the report
ok(/n5_projects_within_radius/.test(RREADS) && /app_projects\?select=/.test(RREADS) && /readReportInputs/.test(RRUN),
  '3e the area read, the project read and their order live in report-reads.ts and report-run.ts (positive control)');
ok(/readReportInputs/.test(REPORT_H) && /readReportInputs/.test(RH) && !/n5_projects_within_radius|app_projects\?|dev_change_project/.test(REPORT_H + REPORT_D + RH + RD + MH + MD + PW),
  '3f the report and the Watch read the area, the projects and the ledger through the SAME functions: neither names a table or the spatial read itself');
ok(/makeReportReads/.test(RD) && /makeReportReads/.test(REPORT_D) && /makeChangeReads/.test(RD) && /import \{ readReportInputs \} from '\.\.\/_shared\/report-run\.ts'/.test(RH), '3g and both data layers build them from the one module');

// the private layer: one reader, one door for the point
ok(count(PS, /report_private_context_read/g) === 2, '3h the private layer is read by private-subject.ts in two functions (the display windows share one, pointOf has its own)', count(PS, /report_private_context_read/g));
const between = (src, from, to) => { const a = src.indexOf(from); const b = to ? src.indexOf(to, a + 1) : src.length; return a < 0 || b < 0 ? '' : src.slice(a, b); };
const pointOf = between(PS, 'async pointOf(', null), subjectOf = between(PS, 'async subjectOf(', 'async addressOf('), addressOf = between(PS, 'async addressOf(', 'async pointOf(');
ok(pointOf.length > 200 && /latitude/.test(pointOf) && /longitude/.test(pointOf) && !/address|label/.test(pointOf.replace(/\/\/.*$/gm, '')) && !/latitude|longitude|c\.lat|c\.lng/.test(subjectOf + addressOf) && count(PS, /latitude|longitude/g) === count(pointOf, /latitude|longitude/g),
  '3i the coordinates are read only inside pointOf, and pointOf returns no address or label; the two display windows cannot return a coordinate by accident');
const everyTs = ['_shared/property-watch.ts', '_shared/watch-reads.ts', '_shared/watch-email.ts', '_shared/email-send.ts', '_shared/report-run.ts', '_shared/report-reads.ts', 'run-property-watch/handler.ts', 'run-property-watch/data.ts',
  'run-property-watch/index.ts', 'manage-property-watch/handler.ts', 'manage-property-watch/data.ts', 'manage-property-watch/index.ts'];
const NEW_TS = Object.fromEntries(everyTs.map((f) => [f, stripJs(read(FN + f))]));
ok(everyTs.every((f) => !/report_private_context_read/.test(NEW_TS[f])) && everyTs.filter((f) => /\bpointOf\b/.test(NEW_TS[f])).sort().join() === 'run-property-watch/data.ts,run-property-watch/handler.ts',
  '3j no Watch file reads the private layer directly, and pointOf is named only by the daily job\'s data layer and handler: the agent\'s function can never ask for a point', everyTs.filter((f) => /\bpointOf\b/.test(NEW_TS[f])).join());
ok(!/pointOf|latitude|longitude|\.lat\b|\.lng\b/.test(MH + MD + WE + ES + WR + PW), '3k the agent\'s function, the email, the mail adapter, the watch reads and the diff name no point at all');

// the watch functions are named by ONE module
const watchRpcs = ['evaluation_property_watch_start', 'evaluation_property_watches_of', 'evaluation_property_watch_stop', 'property_watch_claim', 'property_watch_record_run', 'property_watch_record_failure', 'property_watch_end'];
ok(watchRpcs.every((f) => new RegExp("'" + f + "'").test(WR)) && everyTs.filter((f) => f !== '_shared/watch-reads.ts').every((f) => !watchRpcs.some((r) => new RegExp("['\"/]" + r + "['\"]").test(NEW_TS[f]))),
  '3l the seven watch functions are named by watch-reads.ts and by nothing else: the agent\'s function and the daily job cannot read a watch two different ways');
ok(/property_watch_seen\?select=project_id,event_type,observed_at&watch_id=eq\./.test(WR) && everyTs.filter((f) => /property_watch_seen|property_watch\?/.test(NEW_TS[f])).sort().join() === '_shared/watch-reads.ts,run-property-watch/data.ts',
  '3m the two table reads (what was told, and how many are due) are in watch-reads.ts and the daily job\'s data layer');

// the run: who may call, and the order of the work
const processWatch = tsFn(RH, 'processWatch'), makeH = tsFn(RH, 'makeHandler');
ok(processWatch.length > 800 && makeH.length > 800, '3n the run\'s two functions were found (positive control)');
ok(makeH.indexOf('if (!deps.secret)') > 0 && makeH.indexOf('if (!deps.secret)') < makeH.indexOf('sameSecret(') && makeH.indexOf('sameSecret(') < makeH.indexOf('readBounded(') && makeH.indexOf('readBounded(') < makeH.indexOf('deps.claim('),
  '3o the order is: no secret configured (503), the secret compared (401), THEN the body is read, THEN anything is claimed');
ok(/crypto\.subtle\.digest\('SHA-256'/.test(RH) && !/===\s*deps\.secret|deps\.secret\s*===|given\s*===|\.includes\(deps\.secret\)/.test(RH) && /\^=? u\[i\] \^ v\[i\]|d \|= u\[i\] \^ v\[i\]/.test(RH),
  '3p the secret is compared by hashing both sides to a fixed length and OR-ing the differences: never with ===, never early-exit');
ok(!/authorizeSignedIn|authorizeAdmin|authenticate\(/.test(RH + RD) && /SECRET_HEADER = 'x-signup-secret'/.test(RH), '3q the run is not a user-facing function: it has no sign-in gate, only the scheduler\'s secret');
const iSend = processWatch.indexOf('deps.send('), iRec = processWatch.indexOf("deps.recordRun(w.watch_id, 'NOTIFIED'"), iStand = processWatch.indexOf('deps.openReport('), iPoint = processWatch.indexOf('deps.pointOf('), iRead = processWatch.indexOf('readReportInputs(');
ok(iSend > 0 && iRec > iSend && iStand >= 0 && iStand < iPoint && iPoint < iRead, '3r in one watch: standing, then the point, then the area; an email is SENT before anything is recorded as told');
ok(/recipientOf\(w\.user_id\)/.test(processWatch) && processWatch.indexOf('recipientOf(') > processWatch.indexOf('check.changes.length === 0') && /selectForEmail\(check\.changes\)/.test(processWatch) && /idempotencyKeyFor\(w\.watch_id, selection\.told\)/.test(processWatch) && /selection\.told\)/.test(processWatch),
  '3s the agent\'s address is looked up only when there is something to say, the email is what selectForEmail chose, and the idempotency key and the record are both derived from the same selection.told');
const logs = [...RH.matchAll(/console\.error\(([\s\S]*?)\);/g)].map((m) => m[1]);
ok(logs.length === 3 && logs.every((l) => /JSON\.stringify\(\{ fn: 'run-property-watch', stage[:,] /.test(l)) && logs.every((l) => !/watch_id|user_id|\bto\b|email|point|\blat\b|\blng\b|address|label|opened|body|\bw\./.test(l.replace(/stage: '[a-z_]+'/g, ''))),
  '3t the run logs in exactly three places, each one JSON line of a function name, a stage, an outcome and a fixed reason: no watch id, user id, address, point or email', logs.length);
ok(!/console\./.test(WR + WE + ES + PW + RD + MH + MD + PS + RRUN + RREADS), '3u nothing else in the Watch logs at all');

// the manage function
const mh = tsFn(MH, 'makeHandler');
ok(mh.indexOf('authorizeSignedIn(') > 0 && mh.indexOf('authorizeSignedIn(') < mh.indexOf('readBounded(') && /who\.userId/.test(mh) && !/b\.user_id|b\.userId|body\.user/.test(mh) && /const FIELDS: Record<string, string\[\]> = \{ start: \['action', 'report_id'\], list: \['action'\], stop: \['action', 'watch_id'\] \};/.test(MH),
  '3v the agent\'s function settles who is asking BEFORE reading the body, acts only for the signed-in person, and accepts a closed set of fields per action (no schedule, no email, no point)');
ok(/PropertyNotKept[\s\S]*409/.test(mh) && /WatchLimitReached[\s\S]*409/.test(mh) && /WatchNotFound[\s\S]*404/.test(mh) && /return reply\(req, \{ error: 'internal' \}, 500\)/.test(mh), '3w each refusal has its own answer and an unknown failure is a 500 with no message');

// the mail
ok(/RESEND_URL = 'https:\/\/api\.resend\.com\/emails'/.test(ES) && count(ES, /https?:\/\//g) === 1 && /Authorization: 'Bearer ' \+ apiKey/.test(ES) && /'Idempotency-Key': idempotencyKey/.test(ES) && !/\bconsole\b|\.text\(\)|\.json\(\)/.test(ES),
  '3x the mail adapter has one URL, sends the key only to it, carries an idempotency key, and never reads or repeats the provider\'s answer');
ok(/import type \{[^}]*\} from '\.\/property-watch\.ts';/.test(WE) && count(WE, /^import /gm) === 1 && !/fetch\(|Deno\./.test(WE) && /\\u202e|\\u2028-\\u202e/.test(WE) && /\\u200b-\\u200f/.test(WE),
  '3y the email composer imports only types, does no I/O, and strips zero-width and bidirectional-override characters from publisher text');
ok(/https:\/\/homesignal\.net\/development-activity-reports\.html/.test(WE) && count(WE, /https?:\/\//g) <= 3 && !/\?.*token|#share|share=/.test(WE), '3z the one link in the email is the signed-in report page; no token rides in it');
ok(/Deno\.env\.get\('SIGNUP_HOOK_SECRET'\)/.test(RI) && /Deno\.env\.get\('RESEND_API_KEY'\)/.test(RI) && !/Deno\./.test(RH + RD) && !/console\./.test(RI + RD), '3aa the secrets are read from the environment in index.ts alone and passed in; the handler and data layer name no Deno global');

// ---- 4. wiring ------------------------------------------------------------------------------------------------------------------------------------------------
const TOML = read('supabase/config.toml');
ok(/\[functions\.manage-property-watch\]\s*\nverify_jwt = true/.test(TOML) && /\[functions\.run-property-watch\]\s*\nverify_jwt = true/.test(TOML), '4a JWT verification stays ON for both new functions');
const noYamlComments = (t) => t.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
const DEPLOY = noYamlComments(read('.github/workflows/deploy-edge-functions.yml'));
ok(count(DEPLOY, /--no-verify-jwt/g) === 3 && /"\$FN" = "get-address-report"/.test(DEPLOY) && /"\$FN" = "view-shared-report"/.test(DEPLOY) && /"\$FN" = "development-activity-billing-webhook"/.test(DEPLOY) && !/property-watch/.test(DEPLOY), '4b the deploy workflow\'s --no-verify-jwt exceptions are exactly three (build step 11 added the payment processor\'s webhook), and none is a Watch function');
const CI = noYamlComments(read('.github/workflows/report-snapshot-suite.yml'));
ok(/bash test\/property_watch_pg\/run\.sh/.test(CI) && /bash test\/property_watch_schedule_pg\/run\.sh/.test(CI) && count(CI, /docs\/property-watch\.sql/g) === 2 && count(CI, /supabase\/functions\/run-property-watch\/\*\*/g) === 2 && count(CI, /supabase\/functions\/manage-property-watch\/\*\*/g) === 2,
  '4c the CI job runs both database harnesses, and both its path lists include the Watch\'s SQL and functions');
ok(['test/property_watch_pg/run.sh', 'test/property_watch_pg/mutate.py', 'test/property_watch_pg/suite.sql', 'test/property_watch_schedule_pg/run.sh', 'test/property_watch_schedule_pg/mutate.py', 'test/property_watch_schedule_pg/suite.sql',
  'docs/development-activity-watch-2026-10-03.md'].every((f) => existsSync(join(ROOT, f))), '4d the harnesses and the written record exist');
const ENGINE = read('docs/development-activity-report-engine-2026-09-30.md');
ok(/Step 9/.test(ENGINE) && /docs\/development-activity-watch-2026-10-03\.md/.test(ENGINE), '4e the engine document has its Step 9 section pointing at the written record');

console.log('\n' + (n - bad) + ' of ' + n + ' passed');
if (bad) process.exit(1);
