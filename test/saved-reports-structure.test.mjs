// SAVED REPORTS — the structural half (Development Activity build step 6). The executable halves are test/trial_report_pg (the real SQL,
// the real handler and data layer) and test/saved-reports-function.test.mjs (the handler's list/open actions, offline). What neither can
// see is the SHAPE that keeps reopening harmless: the two SQL functions only read, only the system can run them, and name no private
// table or address column; the one module that reaches them is the shared evaluation module; the list/open branch of the report function
// never reaches the geocoder, the spatial read, the credit rule or the issue function; a trial that is complete can reopen but not make a
// report; and the page keeps nothing in the browser, asks only the report function, and forgets everything on sign-out. Pinned on
// COMMENT-STRIPPED text, each with a positive control so a scan that matched nothing cannot pass.
// Run: node test/saved-reports-structure.test.mjs
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

let n = 0, bad = 0;
const ok = (c, m, d) => { n++; if (c) console.log('PASS — ' + m); else { bad++; console.log('FAIL — ' + m + (d !== undefined ? '  [' + d + ']' : '')); } };
const ROOT = new URL('..', import.meta.url).pathname;
const read = (f) => (existsSync(join(ROOT, f)) ? readFileSync(join(ROOT, f), 'utf8') : '');
const stripSql = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');
const stripJs = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
// the text of the first brace-balanced block that starts at `anchor`
function block(src, anchor) {
  const i = src.indexOf(anchor); if (i < 0) return '';
  const o = src.indexOf('{', i); if (o < 0) return '';
  let d = 0;
  for (let k = o; k < src.length; k++) { if (src[k] === '{') d++; else if (src[k] === '}' && --d === 0) return src.slice(i, k + 1); }
  return '';
}

const SQL = stripSql(read('docs/saved-reports.sql'));
const SQL_NS = SQL.replace(/'(?:[^']|'')*'/g, "''");
ok(SQL.length > 800 && /create or replace function public\.evaluation_reports_of/.test(SQL) && /create or replace function public\.evaluation_report_open/.test(SQL), '1a the SQL of record defines both functions (positive control)');

// 1. the SQL only reads
ok(!/\b(insert|update|delete|truncate|alter\s+table|drop\s+table|create\s+table|create\s+trigger|cron\.|net\.|http_)/i.test(SQL_NS.replace(/drop function if exists[^;]*;/gi, '')), '1b no DML, no table, no trigger, no schedule, no network call');
const fnBodies = [...SQL.matchAll(/create or replace function (public\.\w+)\(([^)]*)\)([\s\S]*?)\$\$([\s\S]*?)\$\$/g)];
ok(fnBodies.length === 2, '1c exactly two functions', fnBodies.length);
for (const f of fnBodies) {
  ok(/\bstable\b/.test(f[3]) && !/\bvolatile\b/.test(f[3]), '1d ' + f[1] + ' is STABLE (it writes nothing)');
  ok(/security definer/.test(f[3]) && /set search_path = public, pg_temp/.test(f[3]), '1e ' + f[1] + ' is SECURITY DEFINER with a fixed search_path');
  ok(/^\s*select\b/i.test(f[4]), '1f ' + f[1] + ' is a single select');
  ok(/brokerage_membership_of\(p_user_id\)/.test(f[4]), '1g ' + f[1] + ' asks the ONE membership resolver (no email, no domain)');
  ok(!/(private_context\b|report_private_context|address|property_key|latitude|longitude|coordinate|client|email|label)/i.test(f[4]), '1h ' + f[1] + ' names no private table, address, client, email or coordinate');
  ok(/where e\.status = 'complete' or \(e\.status = 'active' and \(e\.expires_at is null or e\.expires_at > now\(\)\)\)/.test(f[4].replace(/\s+/g, ' ').replace(/ *\( */g, ' (').replace(/\( /g, '(')) || /e\.status = 'complete'/.test(f[4]), '1i ' + f[1] + ' serves a complete or an active unexpired evaluation only');
}
ok(/where s\.report_id = p_report_id/.test(fnBodies.find((f) => f[1].endsWith('evaluation_report_open'))?.[4] ?? ''), '1j open is by the report id, through the caller\'s own brokerage');
ok(!/s\.body/.test(fnBodies.find((f) => f[1].endsWith('evaluation_reports_of'))?.[4] ?? 'x'), '1k the list does not carry the stored text');
// 2. system-only
for (const sig of ['evaluation_reports_of\\(uuid\\)', 'evaluation_report_open\\(uuid, uuid\\)']) {
  ok(new RegExp('revoke all on function public\\.' + sig + '\\s+from public, anon, authenticated, service_role').test(SQL), '2a revoked from every role by name: ' + sig);
  ok(new RegExp('grant execute on function public\\.' + sig + '\\s+to service_role').test(SQL), '2b executable by service_role alone: ' + sig);
}
ok(!/grant\s+[^;]*\bto\s+[^;]*\b(anon|authenticated|public)\b/i.test(SQL.replace(/revoke[^;]*;/gi, '')), '2c no grant to anon, authenticated or public');
ok(/rollback-begin/i.test(read('docs/saved-reports.sql')) && /drop function if exists public\.evaluation_report_open/.test(read('docs/saved-reports.sql')), '2d the file carries its own rollback');

// 3. the shared module is the one reader
const READS = stripJs(read('supabase/functions/_shared/evaluation-reads.ts'));
const DATA = stripJs(read('supabase/functions/get-development-activity-report/data.ts'));
ok(/rpc\('evaluation_reports_of'/.test(READS) && /rpc\('evaluation_report_open'/.test(READS), '3a the shared module calls both functions (positive control)');
for (const f of ['supabase/functions/get-development-activity-report/handler.ts', 'supabase/functions/get-development-activity-report/data.ts', 'supabase/functions/development-activity-trial/handler.ts', 'supabase/functions/development-activity-trial/data.ts', 'supabase/functions/follow-development-report/handler.ts']) {
  ok(!/evaluation_report(s_of|_open)/.test(stripJs(read(f))), '3b ' + f + ' does not call the SQL functions directly');
}
const DATA_ALLOWED = /report_private_context_read/;
ok(DATA_ALLOWED.test(DATA) && !/rest\(\s*['"`]report_snapshot|from\('report_snapshot'|\/report_snapshot/.test(DATA), '3c the data layer reads the address only through the private layer\'s own reader and never reads a snapshot table itself');

// 4. the list/open branch never makes, geocodes or charges
const HANDLER = stripJs(read('supabase/functions/get-development-activity-report/handler.ts'));
const action = block(HANDLER, 'if (b.action !== undefined)');
ok(action.length > 400 && /deps\.savedReports/.test(action) && /deps\.openSavedReport/.test(action), '4a the action branch is found and reads saved reports (positive control)', action.length);
ok(!/(geocode|spatial|nearby|issue|chargeCredit|creditRule|renderReport|buildReport|deps\.report|deps\.make|insert|persist)/i.test(action.replace(/subjectOf/g, '').replace(/savedReports|openSavedReport/g, '')), '4b the action branch never reaches the geocoder, the spatial read, the credit rule or the issue function');
ok(/charged: false/.test(action) && !/charged: true/.test(action), '4c a reopened report says it was not charged');
ok(/if \(!trial\) return reply\(req, \{ error: 'forbidden' \}, 403\)/.test(action), '4d an admin (no trial) is refused a saved-report action');
ok(HANDLER.indexOf('if (b.action !== undefined)') > 0 && HANDLER.indexOf('if (b.action !== undefined)') < HANDLER.indexOf("error: 'evaluation_complete'"), '4e the saved-report branch comes BEFORE the complete-trial refusal, so a used-up trial can still reopen');
ok(HANDLER.indexOf("error: 'evaluation_complete'") < HANDLER.indexOf('unknown field: \' + unknown[0]') || HANDLER.indexOf("error: 'evaluation_complete'") < HANDLER.indexOf("'unknown field: ' + unknown[0]"), '4f a complete trial is refused before any address is read or geocoded');
const GATE = stripJs(read('supabase/functions/_shared/admin-gate.ts'));
ok(/standing !== 'active' && standing !== 'complete'/.test(GATE) && /complete: standing === 'complete'/.test(GATE), '5a the gate lets an active or a complete trial through and says which');
ok(!/'complete'[^;]*return reply\(req, \{ error: 'forbidden' \}/.test(GATE.replace(/if \(standing !== 'active' && standing !== 'complete'\)[^;]*;/, '')), '5b the gate has no other refusal for a complete trial');

// 6. the page
const PAGE = stripJs(read('development-activity-reports.html'));
const saved = block(PAGE, 'function showSaved');
ok(/id="saved"[^>]*hidden/.test(read('development-activity-reports.html')) && saved.length > 50, '6a the Saved reports card starts hidden (positive control)');
ok(/post\(REPORT_FN, \{ action: 'list' \}\)/.test(PAGE) && /post\(REPORT_FN, \{ action: 'open', report_id: reportId \}\)/.test(PAGE), '6b the page lists and opens only through the report function');
ok(!/(localStorage|sessionStorage|indexedDB)[^;]*(saved|report_id|reports)/i.test(PAGE), '6c nothing about a saved report is kept in the browser');
ok(/showSaved\(false\)/.test(block(PAGE, 'session.user.id !== lastUser') + PAGE) && (PAGE.match(/showSaved\(false\)/g) || []).length >= 3, '6d the list is forgotten on sign-out, on a new person and when access ends', (PAGE.match(/showSaved\(false\)/g) || []).length);
ok(/showSaved\(a === 'trial' \|\| a === 'complete'\)/.test(PAGE), '6e the card is offered to a trial member, active or complete, and nobody else');
ok(!/(refreshSaved|openSaved)[\s\S]{0,400}(idempotency_key|address:)/.test(block(PAGE, 'async function openSaved') + block(PAGE, 'async function refreshSaved')), '6f listing and opening send no address and no key');
ok(/Opening it did not use a free report/.test(PAGE), '6g the page says plainly that opening does not use a free report');

console.log('\n' + (n - bad) + ' passed, ' + bad + ' failed of ' + n);
process.exit(bad ? 1 : 0);
