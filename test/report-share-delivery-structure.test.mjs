// SHARE AND PDF — the structural half (Development Activity build step 8). The executable halves are test/report_share_delivery_pg (the
// real SQL against a disposable Postgres, with two real concurrent sessions), test/share-link-functions.test.mjs (the two handlers and
// their data layers, driven over a stand-in database) and test/shared-report-page.browser.test.mjs + test/development-activity-reports.browser.test.mjs
// (the two pages in Chromium). What none of them can see is the SHAPE that keeps a client link harmless:
//   * the SQL: six functions and nothing else; the lifetime and the cap are each written ONCE; no share row is written except through the
//     share primitive; every decision (who a person is, whether a brokerage may share, whether a link is usable) is a call to its one owner;
//     the read a client can reach returns the report, the brokerage's name and an opaque handle and nothing a customer typed; the system alone
//     can run any of it;
//   * the edge: ONE module names the database functions, mints and hashes the token, and writes the link's form; ONE module reads the private
//     layer; the client's function has no gate, no write and no way to ask for the label; the agent's function is NOT the trial-standing gate,
//     so a link can always be taken back; JWT verification is off for exactly one more function and no other;
//   * the pages: the agent's page only validates the link the server handed back and never stores it; the client's page is reached only from
//     a link (pinned in test/shared-report-page.test.mjs);
//   * the wiring: the CI job, the mutation harness and the written record exist.
// Pinned on COMMENT-STRIPPED text, each with a positive control so a scan that matched nothing cannot pass.
// Run: node test/report-share-delivery-structure.test.mjs
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

let n = 0, bad = 0;
const ok = (c, m, d) => { n++; if (c) console.log('PASS — ' + m); else { bad++; console.log('FAIL — ' + m + (d !== undefined ? '  [' + d + ']' : '')); } };
const ROOT = new URL('..', import.meta.url).pathname;
const read = (f) => (existsSync(join(ROOT, f)) ? readFileSync(join(ROOT, f), 'utf8') : '');
const stripSql = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');
const stripJs = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
const walk = (d, out = []) => { for (const e of readdirSync(join(ROOT, d))) { const p = d + '/' + e; if (statSync(join(ROOT, p)).isDirectory()) walk(p, out); else out.push(p); } return out; };
/** The text of one SQL function: from its `create or replace function <name>(` to the end of its dollar-quoted body. */
function sqlFn(sql, name) {
  const i = sql.search(new RegExp('create or replace function public\\.' + name + '\\('));
  if (i < 0) return '';
  const rest = sql.slice(i);
  const m = /\$\$[\s\S]*?\$\$;?/.exec(rest);
  return m ? rest.slice(0, m.index + m[0].length) : '';
}

// ---- 1. the SQL ---------------------------------------------------------------------------------------------------------------------------
const RAW = read('docs/report-share-delivery.sql');
const SQL = stripSql(RAW);
const SQL_NS = SQL.replace(/'(?:[^']|'')*'/g, "''");
const NAMES = ['report_share_lifetime', 'report_share_limit', 'evaluation_report_share_create', 'evaluation_report_shares_of', 'evaluation_report_share_revoke', 'report_share_open'];
const creates = SQL.match(/create (or replace )?(function|table|view|trigger|index|type|policy|sequence|extension)\b/gi) || [];
ok(SQL.length > 2000 && NAMES.every((f) => new RegExp('create or replace function public\\.' + f + '\\(').test(SQL)), '1a the SQL of record defines the six functions (positive control)');
ok(creates.length === 6 && creates.every((c) => /function/i.test(c)), '1b it creates exactly six objects and every one is a function: no table, view, trigger, index, type, policy or sequence', creates.join(' | '));
ok(!/\balter\s+table\b|\bdrop\s+table\b|\bcreate\s+table\b|\bcreate\s+trigger\b|cron\.schedule|\bcreate\s+extension\b/i.test(SQL_NS), '1c no table is added or changed, no trigger and no schedule exists');

// the two numbers, each written once
const create = sqlFn(SQL, 'evaluation_report_share_create');
ok(/create or replace function public\.report_share_lifetime\(\) returns interval\s+language sql immutable as \$\$ select interval '6 months' \$\$;/.test(SQL)
   && (SQL.match(/interval '/g) || []).length === 2 && /report_share_lifetime\(\) <> interval '6 months'/.test(SQL),
  '1d the lifetime is written once, as the founder\'s 6 months (the second occurrence is the post-condition that pins it)');
ok(/create or replace function public\.report_share_limit\(\) returns integer\s+language sql immutable as \$\$ select 25 \$\$;/.test(SQL) && !/\b25\b/.test(SQL.replace(/select 25/, '')),
  '1e the per-report limit is written once, as 25');
ok(create.length > 400 && /v_expires := now\(\) \+ public\.report_share_lifetime\(\);/.test(create) && /public\.report_share_limit\(\)/.test(create) && !/interval|\b25\b/.test(create)
   && /evaluation_report_share_create\(p_user_id uuid, p_report_id uuid, p_token_sha256 text\)/.test(create) && (SQL_NS.match(/\bnow\(\)/g) || []).length === 1,
  '1f the caller passes NO expiry: create takes a user, a report and a token hash, asks the lifetime and the limit functions, and is the only place that reads the clock');

// no share row written except through the primitive
ok(!/\b(insert\s+into|update|delete\s+from|truncate)\s+(public\.)?report_share\b/i.test(SQL_NS) && !/\b(insert\s+into|update|delete\s+from|truncate)\b/i.test(SQL_NS.replace(/drop function if exists[^;]*;/gi, '')),
  '1g no statement of this file writes any row: a share is written only by the primitive\'s own report_share_create and report_share_revoke');
ok(/public\.report_share_create\(p_report_id, p_token_sha256, v_expires\)/.test(create) && /public\.report_share_revoke\(p_share_id\)/.test(sqlFn(SQL, 'evaluation_report_share_revoke')),
  '1h make and withdraw are calls to the primitive, with the hash the caller sent (this database never sees a token)');

// every decision is a call to its one owner
const list = sqlFn(SQL, 'evaluation_report_shares_of'), revoke = sqlFn(SQL, 'evaluation_report_share_revoke'), open = sqlFn(SQL, 'report_share_open');
ok(/public\.evaluation_report_open\(p_user_id, p_report_id\)/.test(create) && !/evaluation_report_open/.test(list + revoke + open),
  '1i standing to make a link is the SAME check that lets a member reopen a saved report (called, not re-written); listing and withdrawing need ownership only');
ok(/public\.brokerage_membership_of\(p_user_id\) m/.test(list) && /public\.brokerage_membership_of\(p_user_id\) m/.test(revoke) && /join public\.evaluation_credit c on c\.evaluation_id = e\.evaluation_id/.test(list + revoke),
  '1j who the caller is comes from the one membership resolver, and whose a report is comes from the credit ledger (a join, never a copied owner column)');
ok(/cross join lateral public\.report_share_resolve\(s\.token_sha256\) r/.test(list) && /from public\.report_share_resolve\(p_token_sha256\) r/.test(open) && /where r\.status = 'ACTIVE'/.test(open)
   && !/expires_at\s*[<>]|revoked_at is|now\(\)/.test(list + open),
  '1k whether a link is usable is the primitive\'s ONE decision: the list and the client read ask it and compare nothing against the clock themselves');
ok(/e\.status <> 'revoked'/.test(open) && /a\.status = 'active'/.test(open) && !/expires|trial|reports_used|ended/i.test(open.replace(/where r\.status = 'ACTIVE'/, '')),
  '1l a link stops with a WITHDRAWN account (revoked evaluation, inactive brokerage) and not with an ended trial: a client report already shared is not taken back');
ok(/order by s\.created_at desc, s\.share_id/.test(list) && /\bs\.token_sha256\b/.test(list) && !/select[^;]*\btoken_sha256\b[^;]*from/i.test(list.replace(/cross join lateral[^\n]*/, '')) === true,
  '1m the list is newest first and never returns the stored hash (it is used only to ask for the status)');

// what the client can read
ok(/returns table \(report_id uuid, generated_at timestamptz, body text, private_context_id uuid, brokerage_name text\)/.test(open)
   && /select s\.report_id, s\.generated_at, s\.body, s\.private_context_id, a\.name\s+from/.test(open)
   && !/\b(address|label|client|agent|user|latitude|longitude|property_key|coordinate|report_private_context)\b/i.test(open) && !/\bshare_id\b|\bordinal\b/.test(open),
  '1n what a client can read is the stored report, when it was made, the snapshot\'s opaque handle and the brokerage\'s name: the select list is exactly those five, and no address, label, agent, user, share id or ordinal is named', open.replace(/\s+/g, ' ').slice(0, 300));
ok(!/report_private_context/.test(SQL_NS), '1o the private layer is not named: the address is asked of the layer\'s own reader, by the function that serves the link');

// volatility, definer, state
ok(!/\bvolatile\b/i.test(SQL_NS) && /language sql stable security definer set search_path = public, pg_temp/.test(list) && /language sql stable security definer set search_path = public, pg_temp/.test(open)
   && /language plpgsql security definer set search_path = public, pg_temp/.test(create) && /language plpgsql security definer set search_path = public, pg_temp/.test(revoke),
  '1p the two reads are STABLE (a client open writes nothing), the two writes are plpgsql, and all four are SECURITY DEFINER with a pinned search_path');
const iLock = create.indexOf('pg_advisory_xact_lock'), iCount = create.indexOf('count(*)'), iCall = create.indexOf('public.report_share_create(');
ok(/current_setting\('transaction_isolation'\) <> 'read committed'/.test(create) && /errcode = '55000'/.test(create) && iLock > 0 && iLock < iCount && iCount < iCall
   && /hashtextextended\('report_share:' \|\| p_report_id::text, 0\)/.test(create),
  '1q the limit is counted AFTER a lock keyed on the report, and only at READ COMMITTED, so two calls cannot both take the last place');
ok(/errcode = 'EV006', message = 'NOT_FOUND'/.test(create) && /errcode = 'EV006', message = 'NOT_FOUND'/.test(revoke) && /errcode = 'EV007', message = 'SHARE_LIMIT_REACHED'/.test(create),
  '1r the only two refusals the edge can name are NOT_FOUND (one answer for another brokerage\'s, an unknown and a never-stored report) and SHARE_LIMIT_REACHED');

// the lock-down
const revokes = SQL.match(/revoke all on function public\.[a-z_]+\([a-z, ]*\)\s+from public, anon, authenticated, service_role;/g) || [];
const grants = SQL.match(/grant execute on function public\.[a-z_]+\([a-z, ]*\)\s+to [a-z_]+;/g) || [];
ok(revokes.length === 6 && grants.length === 6 && grants.every((g) => /to service_role;$/.test(g)) && NAMES.every((f) => revokes.some((r) => r.includes('public.' + f + '(')) && grants.some((g) => g.includes('public.' + f + '('))),
  '1s every one of the six is revoked from every role by name and executable by service_role alone', revokes.length + '/' + grants.length);
ok(!/grant\s+[^;]*\bto\s+[^;]*\b(anon|authenticated|public)\b/i.test(SQL.replace(/revoke[^;]*;/gi, '')), '1t nothing is granted to a resident role or to everyone');

// the file's own fence
ok(/rollback-begin/i.test(RAW) && NAMES.every((f) => new RegExp('drop function if exists[\\s\\S]*public\\.' + f + '\\(').test(RAW.slice(RAW.search(/ROLLBACK-BEGIN/)))) && /ROLLBACK-END/.test(RAW),
  '1u the rollback drops all six functions and touches nothing else');
ok(/raise exception 'report_share_delivery: apply docs\/report-share\.sql, docs\/saved-reports\.sql, docs\/evaluation-entitlement\.sql and docs\/brokerage-account-spine\.sql first'/.test(RAW)
   && /do \$pre\$/.test(RAW) && /do \$post\$/.test(RAW) && /aclexplode/.test(SQL) && /like 'report\\_share\\_%' or p\.proname like 'evaluation\\_report\\_share%'/.test(SQL),
  '1v it fails closed without the primitive, and its post-condition looks at EVERY function with either prefix (so a later one left open to a resident role fails it)');

// ---- 2. the edge -----------------------------------------------------------------------------------------------------------------------------
const fnFiles = walk('supabase/functions').filter((f) => /\.(ts|js|mjs)$/.test(f));
const S = (f) => stripJs(read(f));
const namers = (re) => fnFiles.filter((f) => re.test(S(f)));
ok(namers(/evaluation_report_share_create|evaluation_report_shares_of|evaluation_report_share_revoke|report_share_open/).join() === 'supabase/functions/_shared/share-reads.ts',
  '2a across every edge function the four database functions are named by ONE module', namers(/evaluation_report_share_create|evaluation_report_shares_of|evaluation_report_share_revoke|report_share_open/));
ok(namers(/(?<![a-z_])(report_share_resolve|report_share_create|report_share_revoke|report_share_lifetime|report_share_limit)\b/).length === 0,
  '2b the primitive and the two constants are reachable from no edge function: only the delivery layer\'s four functions are');
ok(namers(/newShareToken|hashShareToken/).filter((f) => f !== 'supabase/functions/_shared/report-share.ts').join() === 'supabase/functions/_shared/share-reads.ts',
  '2c the token is minted and hashed by ONE module (besides the one that defines how)');
ok(namers(/#share=|shared-report\.html/).join() === 'supabase/functions/_shared/share-reads.ts' && (S('supabase/functions/_shared/share-reads.ts').match(/shared-report\.html/g) || []).length === 1
   && /export const SHARE_PAGE = 'https:\/\/homesignal\.net\/shared-report\.html';/.test(S('supabase/functions/_shared/share-reads.ts')) && /return SHARE_PAGE \+ '#share=' \+ token;/.test(S('supabase/functions/_shared/share-reads.ts')),
  '2d the link\'s form is written ONCE, with the token in the URL fragment (which no server receives)');
{
  const reads = S('supabase/functions/_shared/share-reads.ts');
  const make = (reads.match(/async createShare[\s\S]*?\n    \},/) || [''])[0];
  ok(make.length > 300 && /p_token_sha256: await hashShareToken\(token\)/.test(make) && /return \{ share_id: r\.share_id, expires_at: r\.expires_at, link: shareLink\(token\) \}/.test(make) && !/token_sha256: token\b/.test(make),
    '2e the database is sent the HASH and the agent is handed the link: the token is returned once and stored nowhere');
  ok(!/token_sha256/.test((reads.match(/type (CreatedShare|ShareRow|SharedReport) =[^\n]*/g) || []).join('\n')) && !/\bshare_id\b/.test((reads.match(/type SharedReport =[^\n]*/) || [''])[0]) && !/\blabel\b|agent/.test(reads.replace(/agent who|agent's|the agent|an agent|agent typed|agent \(/g, '')),
    '2f no type the module returns carries a hash; what a client can hold carries no share id; nothing in it reads a label or an agent');
}
ok(namers(/report_private_context_read/).sort().join() === 'supabase/functions/_shared/private-subject.ts,supabase/functions/get-development-activity-report/data.ts',
  '2g across every edge function the private layer\'s reader is named by TWO files and no more: the shared reader of a stored report\'s address and label, and the report function\'s replay check (which compares and returns no value; pinned in test/report-private-context-structure.test.mjs 5c4/5d). The client\'s function names neither', namers(/report_private_context_read/));
{
  const ps = S('supabase/functions/_shared/private-subject.ts');
  const addr = (ps.match(/async addressOf[\s\S]*?\n    \},/) || [''])[0];
  ok(addr.length > 80 && !/label|cleanDisplayName/.test(addr) && /return c \? addressText\(c\.address\) : null;/.test(addr) && /c\.state !== 'active'/.test(ps),
    '2h the window a client\'s function uses returns the address and NOTHING else, and only while the layer still keeps it');
  const users = fnFiles.filter((f) => /makePrivateSubjectReads/.test(S(f)) && f !== 'supabase/functions/_shared/private-subject.ts').sort();
  // build step 9 added two users of the one reader, each pinned to the narrowest window it needs: the agent's Watch list (the address alone, shown back to
  // the agent who started the watch, the label discarded in the same expression) and the daily job (the point alone, never shown or sent).
  ok(users.join() === 'supabase/functions/get-development-activity-report/data.ts,supabase/functions/manage-property-watch/data.ts,supabase/functions/run-property-watch/data.ts,supabase/functions/view-shared-report/data.ts',
    '2i exactly four functions read the private layer: the report function (the address and the label, for the brokerage), the agent\'s Watch list (the address), the daily Watch job (the point) and the client\'s function (the address)', users);
  const md = S('supabase/functions/manage-property-watch/data.ts').replace(/\/\/[^\n]*/g, ''), rd = S('supabase/functions/run-property-watch/data.ts').replace(/\/\/[^\n]*/g, '');
  ok((md.match(/subjects\.\w+/g) || []).join() === 'subjects.subjectOf' && /addressOf: \(contextId\) => subjects\.subjectOf\(contextId, LABEL_MAX\)\.then\(\(s\) => s\.address\),/.test(md)
     && (rd.match(/subjects\.\w+/g) || []).join() === 'subjects.pointOf' && /pointOf: subjects\.pointOf,/.test(rd) && !/subjectOf|addressOf/.test(rd),
    '2i2 the Watch list takes the address from the brokerage window and drops the label in the same expression; the daily job is wired to the point window alone and cannot ask for an address or a label');
  ok(/subjects\.addressOf/.test(S('supabase/functions/view-shared-report/data.ts')) && !/subjectOf/.test(S('supabase/functions/view-shared-report/data.ts')), '2j the client\'s function is wired to the address-only window and cannot ask for the label');
}
{
  const vh = S('supabase/functions/view-shared-report/handler.ts').replace(/export const CAPABILITY = \{[\s\S]*?\n\};/, ''), vd = S('supabase/functions/view-shared-report/data.ts'), vi = S('supabase/functions/view-shared-report/index.ts');
  ok(!/authorize[A-Za-z]*\(|AdminGateDeps|isAdmin|authenticate|session|getUser/.test(vh + vd) && !/\blabel\b|client_label|agent|share_id|evaluation_id|user_id/.test(vh)
     && !/method:\s*'(PATCH|POST|PUT|DELETE)'/.test(vh + vd) && !/\.(insert|update|delete|upsert)\(/.test(vh + vd),
    '2k the client\'s function has no gate to lean on and uses none, names no label, agent, share id, evaluation or user, and writes nothing');
  ok(/Object\.keys\(b\)\.some\(\(k\) => k !== 'token'\)/.test(vh) && (vh.match(/error: 'not_found' \}, 404/g) || []).length === 2 && !/revoked|expired|withdrawn|EXPIRED|REVOKED/.test(vh),
    '2l its input is one field, and a link that opens nothing is one answer (404 not_found) that never says unknown, withdrawn or expired');
  ok(/return reply\(req, \{ error: 'internal' \}, 500\);/.test(vh) && /catch \(e\) \{\s*if \(e instanceof DataUnavailable\) return reply\(req, \{ error: 'data_unavailable' \}, 502\);/.test(vh) && !/\.message|String\(e\)|\$\{e\}|console\./.test(vh + vd + vi),
    '2m an unexpected failure answers with a fixed word and never the exception (it can carry the address), and nothing is logged');
  ok(/address,\s*\n?\s*\}\);/.test(vh) && /brokerage: cleanDisplayName\(shared\.brokerage_name, BROKERAGE_NAME_MAX\)/.test(vh) && /report_id: shared\.report_id/.test(vh),
    '2n the answer is the report, its id, when it was made, the brokerage\'s name (cleaned) and the address');
  ok(/Deno\.serve\(makeHandler\(makeDeps/.test(vi) && !/verify|jwt|bearer/i.test(vi.replace(/\/\/[^\n]*/g, '')), '2o the entry point only wires the handler to its reads');
}
{
  const mh = S('supabase/functions/manage-shared-report/handler.ts'), md = S('supabase/functions/manage-shared-report/data.ts');
  ok(/authorizeSignedIn\(req, deps\)/.test(mh) && !/authorizeReportCaller|authorizeAdmin|brokerage|trial|ended|standing/i.test(mh.replace(/CAPABILITY[\s\S]*?\};/, '')),
    '2p the agent\'s function lets in any signed-in person and is NOT the report function\'s standing gate: a client link must stay possible to take back after a trial ends');
  ok(/const FIELDS: Record<string, string\[\]> = \{ create: \['action', 'report_id'\], list: \['action', 'report_id'\], revoke: \['action', 'share_id'\] \};/.test(mh)
     && /extra\.length/.test(mh) && /error: 'share_limit_reached' \}, 409/.test(mh) && /error: 'not_found' \}, 404/.test(mh) && /error: 'data_unavailable' \}, 502/.test(mh),
    '2q each action takes a closed set of fields, a report or link that is not the caller\'s brokerage\'s is 404, the cap is 409, and a failed read is 502 (never a guess)');
  ok(/who\.userId/.test(mh) && !/b\.user|body\.user|b\.brokerage|b\.evaluation/.test(mh) && /createShare: shares\.createShare, listShares: shares\.listShares, revokeShare: shares\.revokeShare/.test(md),
    '2r the caller\'s own id comes from the verified sign-in and never from the request');
}
{
  const wf = read('.github/workflows/deploy-edge-functions.yml');
  const cmds = wf.split('\n').filter((l) => /--no-verify-jwt/.test(l) && !/^\s*#/.test(l));
  const branches = (wf.match(/^\s*(?:el)?if \[ "\$FN" = "[a-z-]+" \][^\n]*$/gm) || []).map((l) => l.trim());
  ok(cmds.length === 3 && branches.length === 3 && branches.join() === 'if [ "$FN" = "get-address-report" ]; then,elif [ "$FN" = "view-shared-report" ]; then,elif [ "$FN" = "development-activity-billing-webhook" ]; then',
    '2s the deploy turns JWT verification off for exactly THREE functions: the report engine, the client link\'s function and (build step 11) the payment processor\'s webhook', branches);
  const cfg = read('supabase/config.toml');
  const off = [...cfg.matchAll(/\[functions\.([a-z-]+)\]\s*\nverify_jwt = (true|false)/g)].filter((m) => m[2] === 'false').map((m) => m[1]);
  const on = [...cfg.matchAll(/\[functions\.([a-z-]+)\]\s*\nverify_jwt = (true|false)/g)].filter((m) => m[2] === 'true').map((m) => m[1]);
  ok(off.join() === 'view-shared-report,development-activity-billing-webhook' && on.includes('manage-shared-report') && on.includes('development-activity-trial') && on.includes('manage-billing'), '2t config.toml records exactly two verify_jwt = false (the client\'s function and, from build step 11, the payment processor\'s webhook) and keeps the agent\'s functions on', off.join() + ' / ' + on.join());
}

// ---- 3. the pages ------------------------------------------------------------------------------------------------------------------------------
{
  const agent = stripJs(read('development-activity-reports.html'));
  ok(/POST_NOT_GET|function post\(/.test(agent) && (agent.match(/SHARE_FN/g) || []).length >= 4 && /action: 'create', report_id: forReport/.test(agent) && /action: 'list', report_id: forReport/.test(agent) && /action: 'revoke', share_id: shareId/.test(agent),
    '3a the agent\'s page makes, lists and withdraws links through the one function');
  ok(!/(sessionStorage|localStorage)\.setItem\([^)]*(link|share)/i.test(agent) && !/setItem\([^)]*\$\('share-link'\)/.test(agent) && /\$\('share-link'\)\.value = link/.test(agent),
    '3b the page shows the link once and keeps it nowhere: it is never written to browser storage');
  ok(/window\.print\(\)/.test(agent) && !/jspdf|html2canvas|createObjectURL|pdf-lib/i.test(agent), '3c Download PDF is the browser\'s own print window, here too');
}
{
  const view = stripJs(read('lib/da-report-view.js'));
  ok(/opts\.live/.test(view) && /opts\.hide/.test(view), '3d the shared view takes `live` and `hide` for the report\'s actions, so the client\'s page can hide all four and the agent\'s page enables only what it can do');
}

// ---- 4. the wiring and the written record --------------------------------------------------------------------------------------------------
{
  const wf = read('.github/workflows/report-snapshot-suite.yml');
  ok((wf.match(/bash test\/report_share_delivery_pg\/run\.sh/g) || []).length === 1 && (wf.match(/'docs\/report-share-delivery\.sql'/g) || []).length === 2 && (wf.match(/'test\/report_share_delivery_pg\/\*\*'/g) || []).length === 2,
    '4a CI runs the database suite, and a change to its SQL, its suite or its functions triggers it on both a pull request and main');
  ok(['supabase/functions/_shared/share-reads.ts', 'supabase/functions/_shared/private-subject.ts', 'supabase/functions/manage-shared-report/**', 'supabase/functions/view-shared-report/**'].every((p) => (wf.split("'" + p + "'").length - 1) === 2),
    '4b the workflow\'s path filters include every edge file of this step, on both triggers');
}
{
  const mut = read('test/report_share_delivery_pg/mutate.py'), run = read('test/report_share_delivery_pg/run.sh');
  const n_mut = (mut.match(/^    '[a-z_0-9]+': /gm) || []).length;
  ok(n_mut >= 25 && /MUTATION_FILTER/.test(run) && /did not apply|ANCHOR/i.test(mut), '4c the database suite carries a mutation harness (>= 25 prohibited mutations; one whose anchor is missing is a harness failure)', n_mut);
  ok(existsSync(join(ROOT, 'test/share_delivery_mutants.py')), '4d the edge and page mutation harness exists');
}
{
  const doc = read('docs/development-activity-report-engine-2026-09-30.md');
  const at = doc.search(/^(##+ .*|\*\*)Step 8/m);
  ok(at >= 0 && /6 months/.test(doc.slice(at)) && /view-shared-report/.test(doc.slice(at)), '4e the written record has a Step 8 section that states the lifetime and names the client function');
}

console.log('\n' + (n - bad) + ' passed, ' + bad + ' failed of ' + n);
process.exit(bad ? 1 : 0);
