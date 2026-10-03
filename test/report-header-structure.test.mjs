// THE REPORT HEADER — the structural half (Development Activity build step 7). The executable halves are test/trial_report_pg (the real SQL,
// the real handler and data layer: the header read, the label kept only in the private layer, no table of the public schema holding a name),
// test/national-report-function.test.mjs (the handler: header on every trial report, read before the charge, a 502 when it cannot be read)
// and test/development-activity-reports.browser.test.mjs (the page). What none of them can see is the SHAPE that keeps the header
// harmless: the one SQL function only reads and only the system can run it; the one module that reaches it is the shared evaluation
// module; the handler can never put a header into anything it stores or charges for; nothing in the repository writes a person's name
// except the page's own save to their sign-in account; and the page keeps nothing in the browser. Pinned on COMMENT-STRIPPED text, each
// with a positive control so a scan that matched nothing cannot pass.
// Run: node test/report-header-structure.test.mjs
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

let n = 0, bad = 0;
const ok = (c, m, d) => { n++; if (c) console.log('PASS — ' + m); else { bad++; console.log('FAIL — ' + m + (d !== undefined ? '  [' + d + ']' : '')); } };
const ROOT = new URL('..', import.meta.url).pathname;
const read = (f) => (existsSync(join(ROOT, f)) ? readFileSync(join(ROOT, f), 'utf8') : '');
const stripSql = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');
const stripJs = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
function block(src, anchor) {
  const i = src.indexOf(anchor); if (i < 0) return '';
  const o = src.indexOf('{', i); if (o < 0) return '';
  let d = 0;
  for (let k = o; k < src.length; k++) { if (src[k] === '{') d++; else if (src[k] === '}' && --d === 0) return src.slice(i, k + 1); }
  return '';
}
const walk = (d, out = []) => { for (const e of readdirSync(join(ROOT, d))) { const p = d + '/' + e; if (statSync(join(ROOT, p)).isDirectory()) walk(p, out); else out.push(p); } return out; };

// ---- 1. the SQL: one function, read-only, system-only ------------------------------------------------------------------------------------
const RAW = read('docs/report-header.sql');
const SQL = stripSql(RAW);
const SQL_NS = SQL.replace(/'(?:[^']|'')*'/g, "''");
ok(SQL.length > 600 && /create or replace function public\.report_header_of\(p_user_id uuid\)/.test(SQL), '1a the SQL of record defines public.report_header_of(p_user_id uuid) (positive control)');
const fnBody = (SQL.match(/create or replace function public\.report_header_of[\s\S]*?\$\$([\s\S]*?)\$\$;/) || [])[1] || '';
ok(fnBody.length > 80 && /from public\.brokerage_membership_of\(p_user_id\) r/.test(fnBody) && /join public\.brokerage_account a on a\.id = r\.brokerage_id/.test(fnBody) && /left join auth\.users u on u\.id = p_user_id/.test(fnBody),
  '1b it asks the ONE membership resolver who the caller is, then reads that account\'s name and the caller\'s own sign-in row', fnBody.replace(/\s+/g, ' '));
ok((create => create.length === 1)(SQL.match(/create (or replace )?(function|table|view|trigger|index|type)\b/gi) || []), '1c the file creates exactly one object: the function');
ok(/returns table \(brokerage_name text, agent_name text\)/.test(SQL) && !/p_[a-z_]+ [a-z]+,/.test(SQL.match(/report_header_of\(([^)]*)\)/)[0]), '1d it takes ONE argument (a user id) and returns exactly two columns: the brokerage\'s name and the person\'s');
ok(/raw_user_meta_data\s*->>\s*'full_name'/.test(fnBody) && (fnBody.match(/raw_user_meta_data/g) || []).length === 1 && !/\bemail\b|\bphone\b|\bidentities\b|raw_app_meta_data/.test(fnBody),
  '1e the only thing read from the sign-in account is the person\'s own full_name: no email, phone, identity or app metadata');
ok(!/\b(insert|update|delete|truncate|merge|copy)\b/i.test(SQL_NS.replace(/drop function if exists[^;]*;/gi, '')) && !/\bvolatile\b/i.test(SQL_NS) && /language sql stable security definer set search_path = public, pg_temp/.test(SQL),
  '1f it writes nothing: STABLE, SECURITY DEFINER with a pinned search_path, and no DML anywhere in the file');
ok(!/(report_private_context|report_snapshot|evaluation|label|address|latitude|longitude|property_key|client)/i.test(SQL_NS),
  '1g it names no private table, snapshot, evaluation, address, coordinate, client or label: the header can be asked of nothing a customer typed');
ok(/revoke all on function public\.report_header_of\(uuid\) from public, anon, authenticated, service_role;/.test(SQL) && /grant execute on function public\.report_header_of\(uuid\) to service_role;/.test(SQL)
   && !/grant\s+[^;]*\bto\s+[^;]*\b(anon|authenticated|public)\b/i.test(SQL.replace(/revoke[^;]*;/gi, '')),
  '1h it is revoked from every role by name and executable by service_role alone');
ok(/rollback-begin/i.test(RAW) && /drop function if exists public\.report_header_of\(uuid\)/.test(RAW) && /raise exception 'report_header: apply docs\/brokerage-account-spine\.sql first/.test(RAW) && /\$post\$/.test(RAW),
  '1i the file carries its own precondition (it fails closed without the spine), post-condition and rollback');

// ---- 2. the one module that reaches it ------------------------------------------------------------------------------------------------------
const fnFiles = walk('supabase/functions').filter((f) => /\.(ts|js|mjs)$/.test(f));
const callers = fnFiles.filter((f) => /report_header_of/.test(stripJs(read(f))));
ok(callers.join() === 'supabase/functions/_shared/evaluation-reads.ts', '2a across every edge function the database function is named by the shared evaluation module and nothing else', callers);
const READS = stripJs(read('supabase/functions/_shared/evaluation-reads.ts'));
ok((READS.match(/rpc\('report_header_of'/g) || []).length === 1 && /rpc\('report_header_of', \{ p_user_id: userId \}\)/.test(READS), '2b it is ONE rpc call with the user id and nothing else');
const clean = block(READS, 'export function cleanDisplayName');
ok(clean.length > 100 && /Array\.from\(s\)\.length <= max \? s : null/.test(clean) && /replace\(\/\\s\+\/g, ' '\)\.trim\(\)/.test(clean) && /typeof v !== 'string'/.test(clean),
  '2c names are made one line of plain text in one function, and a name that is over the limit is none (never a shortened copy)');
ok(/AGENT_NAME_MAX = 80/.test(READS) && /BROKERAGE_NAME_MAX = 120/.test(READS) && /cleanDisplayName\(r\.brokerage_name, BROKERAGE_NAME_MAX\)/.test(READS) && /cleanDisplayName\(r\.agent_name, AGENT_NAME_MAX\)/.test(READS),
  '2d both names go through it, at 80 characters for a person and 120 for a brokerage');
ok(/if \(error\) throw new DataUnavailable\('report_header_of'\)/.test(READS) && /data\.length > 1\) throw new DataUnavailable\('shape'\)/.test(READS),
  '2e a header that cannot be read, or that comes back as more than one row, is a fault (never an empty header)');

// ---- 3. the handler: the header is shown, never stored, never charged for ---------------------------------------------------------------
const HAN = stripJs(read('supabase/functions/get-development-activity-report/handler.ts'));
const DAT = stripJs(read('supabase/functions/get-development-activity-report/data.ts'));
ok(/headerOf: evaluation\.reportHeader,/.test(DAT) && /headerOf: \(userId: string\) => Promise<ReportHeader>/.test(HAN), '3a the handler asks for the header through the shared module (positive control)');
const assembleCall = block(HAN, 'const out = assemble(');
const issueCall = HAN.slice(HAN.indexOf('issued = await deps.issue('), HAN.indexOf('issued = await deps.issue(') + 220);
ok(assembleCall.length > 100 && issueCall.length > 100 && !/header|headerInfo|deps\.headerOf/.test(assembleCall) && !/header|headerInfo/.test(issueCall),
  '3b the header is handed neither to the composer of the report nor to the issue function: the permanent report, the private context and the engine inputs cannot carry it');
ok(HAN.indexOf('deps.headerOf(trial.userId)') > 0 && HAN.indexOf('const headerInfo = trial ?') < HAN.indexOf('deps.issue(') && HAN.indexOf('const headerInfo = trial ?') > HAN.indexOf('deps.zipSupported(g.zip)'),
  '3c it is read for a trial member after the address is known to be covered and BEFORE the charge, so a header that cannot be read costs nothing');
ok((HAN.match(/\.\.\.headerInfo/g) || []).length === 3 && /header,\s*charged: false/.test(HAN.slice(HAN.indexOf('if (b.action !== undefined)'), HAN.indexOf("error: 'evaluation_complete'"))),
  '3d it rides on the three report responses (stored, not stored, replayed) and on a reopened report, and nowhere else');
ok(/const header = await deps\.headerOf\(trial\.userId\);/.test(block(HAN, 'if (b.action !== undefined)')) && !/trial \?/.test(block(HAN, 'if (b.action !== undefined)')),
  '3f a reopened report asks for the viewer\'s own header now: the stored report holds none');

// ---- 4. nothing in the repository writes a person's name or the label ----------------------------------------------------------------------
const docsSql = walk('docs').filter((f) => f.endsWith('.sql'));
const metaNamers = docsSql.filter((f) => /raw_user_meta_data/.test(stripSql(read(f))));
ok(metaNamers.includes('docs/report-header.sql') && metaNamers.every((f) => !/\b(insert|update)\b[^;]*raw_user_meta_data/i.test(stripSql(read(f)))),
  '4a (control, and no write) the header SQL names the sign-in metadata, and no SQL file in docs/ writes it', metaNamers);
const tsNamers = fnFiles.filter((f) => /user_metadata|raw_user_meta_data|full_name/.test(stripJs(read(f))));
ok(tsNamers.length === 0, '4b no edge function reads or writes sign-in metadata itself: the name reaches a function only through the database function', tsNamers);
const labelReaders = fnFiles.filter((f) => f.endsWith('.ts') && /\bc\.label\b/.test(stripJs(read(f))));
ok(labelReaders.join() === 'supabase/functions/get-development-activity-report/data.ts', '4c the client label is read from the private layer in ONE place, the report function\'s data layer', labelReaders);
const reportFn = stripJs(read('supabase/functions/_shared/national-report.ts'));
ok(/\.\.\.\(subject\.label \? \{ label: subject\.label \} : \{\}\)/.test(reportFn) && /LABEL_IN_BODY/.test(reportFn), '4d (control) the engine still scans the permanent body for the label and carries it only in the private context');

// ---- 5. the page ------------------------------------------------------------------------------------------------------------------------------
const PAGE_RAW = read('development-activity-reports.html');
const PAGE = stripJs(PAGE_RAW);
ok(/id="profile"[^>]*hidden/.test(PAGE_RAW) && /id="agent-name"[^>]*maxlength="80"/.test(PAGE_RAW), '5a the "Your name on reports" card starts hidden and the box holds at most 80 characters (positive control)');
const saves = PAGE.match(/client\.auth\.updateUser\([^)]*\)/g) || [];
ok(saves.length === 1 && saves[0] === 'client.auth.updateUser({ data: { full_name: name } })', '5b the page makes ONE call to change the account, and it sets one thing: full_name', saves);
ok(!/(localStorage|sessionStorage|indexedDB)[^;]*(agent|full_name|name\b)/i.test(PAGE.replace(/hs-da-invite/g, '')), '5c the name is kept in the sign-in account only, never in the browser');
ok(/showProfile\(a === 'trial' \|\| a === 'complete'\)/.test(PAGE) && (PAGE.match(/showProfile\(false\)/g) || []).length === 3, '5d the card is offered to a trial member, active or complete, and nobody else (an ended or missing trial hides it through the same call); it is emptied on sign-out, a new person and an unreadable trial');
const mounts = PAGE.match(/V\.mount\([^;]*;?/g) || [];
ok(mounts.length === 2 && mounts.every((m) => /brokerage: hd\.brokerage/.test(m) && /agent: hd\.agent/.test(m)) && /function headerOf\(body\)/.test(PAGE) && /body\.header/.test(block(PAGE, 'function headerOf')),
  '5e both ways of showing a report (made, reopened) pass the header the function sent, read from body.header, and nothing else', mounts.length);
ok(/payload\.label = clientLabel/.test(PAGE) && /if \(clientLabel\)/.test(PAGE) && !/payload\.(agent|brokerage|header|name)\b/.test(PAGE), '5f the page sends the optional client label when there is one, and never a name or a brokerage (the server reads those itself)');
ok(!/The client label only appears in this report's header\. It is not saved\./.test(PAGE_RAW) && /A saved report keeps it with the address, not in the report itself/.test(PAGE_RAW), '5g the hint tells the truth: a saved report keeps the label with the address, not in the report itself');

console.log('\n' + (n - bad) + ' passed, ' + bad + ' failed of ' + n);
process.exit(bad ? 1 : 0);
