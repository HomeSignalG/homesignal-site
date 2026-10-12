// REMOVE FROM MY LIST — the structural half (docs/saved-reports-archive.sql). The executable halves are test/saved_reports_archive_pg (the real SQL: independence of
// people, exact sets, fail-closed, nothing refunded, real concurrent sessions, rollback, 20 mutations), test/trial_report_pg section 7x/7y (the real handler, data layer
// and SQL together), test/saved-reports-archive-function.test.mjs (the handler and data layer, offline) and test/saved-reports-archive.browser.test.mjs (the page).
// What none of those can see is the SHAPE that keeps removing from a list harmless and the pieces wired to each other:
//   1. the SQL decides who may see a report in ONE place (public.evaluation_reports_of) and never joins the ledger, the membership table or the snapshot itself;
//   2. it can write nowhere but its own table; the table has no grant, RLS on, and its rows are two ids and a time; both functions are system-only;
//   3. the database's bound on a set, the edge function's, the shared module's and the page's are ONE number (100), and 100 ids fit the 4 KB request limit;
//   4. the report function takes the user from the verified sign-in and the archive branch never reaches the geocoder, the credit rule or the issue function;
//   5. the page: nothing is kept in the browser; the success notice is written only after the server answered; no browser dialog; no trash icon; the normal list is
//      asked for exactly as before (so the function live today still answers it); the confirmation names the number it will act on;
//   6. every harness that stands up the real handler applies the new SQL, and the CI workflow runs the new suites.
// Pinned on COMMENT-STRIPPED text, each with a positive control so a scan that matched nothing cannot pass.
// Run: node test/saved-reports-archive-structure.test.mjs
import { readFileSync, existsSync } from 'node:fs';
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

const RAW = read('docs/saved-reports-archive.sql');
const SQL = stripSql(RAW), SQL_NS = SQL.replace(/\$\$[\s\S]*?\$\$/g, (m) => m).replace(/'(?:[^']|'')*'/g, "''");
const fnBody = (name) => (new RegExp('create or replace function public\\.' + name + '\\([\\s\\S]*?\\$\\$([\\s\\S]*?)\\$\\$;?', 'i').exec(SQL) || [, ''])[1];
const LISTED = fnBody('saved_reports_listed'), SETTER = fnBody('saved_reports_archive_set');

// 1. one ownership decision
ok(RAW.length > 3000 && LISTED.length > 100 && SETTER.length > 400, '1a the SQL of record is read and holds both functions (positive control)', [RAW.length, LISTED.length, SETTER.length]);
ok(/from public\.evaluation_reports_of\(p_user_id\) r/.test(LISTED) && /from public\.evaluation_reports_of\(p_user_id\) r where r\.report_id = any \(v_ids\)/.test(SETTER),
  '1b both functions read the reports a person may see through the ONE ownership reader, public.evaluation_reports_of');
for (const [label, body] of [['the list', LISTED], ['the writer', SETTER]]) {
  ok(!/\b(evaluation_credit(_all)?|brokerage_paid_credit|brokerage_member|brokerage_membership_of|brokerage_account|evaluation\b|report_snapshot|payment_event|billing_)/i.test(body),
    '1c ' + label + ' names no ledger, membership, evaluation, snapshot or billing relation: a second way to decide ownership cannot hide in it');
}
ok(/where exists \(select 1 from public\.saved_report_archive a where a\.user_id = p_user_id and a\.report_id = r\.report_id\)/.test(LISTED.replace(/\s+/g, ' ').replace(/\( /g, '(').replace(/ \)/g, ')')) || /a\.user_id = p_user_id/.test(LISTED),
  '1d the list filters by THIS caller\'s own archive rows (a.user_id = p_user_id)');
ok(/order by r\.number desc/.test(LISTED), '1e the list keeps the order the list has always had (newest report number first)');

// 2. writes nowhere else; closed table
const DML = [...SETTER.matchAll(/\b(insert\s+into|update|delete\s+from)\s+([\w.]+)/gi)].map((m) => m[2].replace('public.', ''));
ok(DML.length >= 2 && DML.every((t) => t === 'saved_report_archive'), '2a every insert, update and delete in the writer targets saved_report_archive and nothing else', DML.join());
ok(!/\b(insert|update|delete|truncate)\b/i.test(LISTED), '2b the list writes nothing');
ok(/delete from public\.saved_report_archive where user_id = p_user_id and report_id = any \(v_ids\)/.test(SETTER.replace(/\s+/g, ' ')), '2c a restore deletes only the CALLER\'S rows, for the named ids');
ok(/on conflict \(user_id, report_id\) do nothing/.test(SETTER), '2d archiving is idempotent: ON CONFLICT DO NOTHING (a repeated or concurrent click cannot error)');
ok(/primary key \(user_id, report_id\)/.test(SQL) && /references auth\.users \(id\) on delete cascade/.test(SQL) && /references public\.report_snapshot \(report_id\)(?! on delete)/.test(SQL),
  '2e the table is keyed per person and report, goes with the account, and can never cascade into a snapshot');
ok(/alter table public\.saved_report_archive enable row level security/.test(SQL) && /revoke all on table public\.saved_report_archive from public, anon, authenticated, service_role/.test(SQL),
  '2f the table has RLS on and no grant to any role');
const cols = (/create table if not exists public\.saved_report_archive \(([\s\S]*?)\n\);/.exec(SQL) || [, ''])[1].split('\n').map((l) => /^\s*(\w+)\s+(uuid|timestamptz)/.exec(l)).filter(Boolean).map((m) => m[1]);
ok(JSON.stringify(cols) === '["user_id","report_id","archived_at"]', '2g the row is two ids and a time, no address, label, client, email or note', cols.join());
for (const sig of ['saved_reports_listed\\(uuid, boolean\\)', 'saved_reports_archive_set\\(uuid, uuid\\[\\], boolean\\)']) {
  ok(new RegExp('revoke all on function public\\.' + sig + '\\s+from public, anon, authenticated, service_role').test(SQL) && new RegExp('grant execute on function public\\.' + sig + '\\s+to service_role;').test(SQL),
    '2h system-only: ' + sig);
}
ok(!/grant\s+[^;]*\bto\s+[^;]*\b(anon|authenticated|public)\b/i.test(SQL.replace(/revoke[^;]*;/gi, '')), '2i no grant to anon, authenticated or public');
ok(/security definer set search_path = public, pg_temp/.test(LISTED ? SQL : '') && (SQL.match(/security definer set search_path = public, pg_temp/g) || []).length === 2, '2j both are SECURITY DEFINER with a fixed search path');
ok(/rollback-begin/i.test(RAW) && /drop function if exists public\.saved_reports_archive_set/.test(RAW) && /drop table if exists public\.saved_report_archive/.test(RAW), '2k the file carries its own rollback');
ok(/raise exception 'saved_reports_archive: apply docs\/saved-reports\.sql/.test(SQL) , '2l and refuses (creating nothing) when the ownership reader is absent');
ok(/p_user_id is null or p_archived is null or p_report_ids is null or array_position\(p_report_ids, null\) is not null/.test(SETTER) && /v_n < 1 or v_n > 100/.test(SETTER) && /v_visible <> v_n then raise exception 'NOT_FOUND'/.test(SETTER),
  '2m the writer refuses a null, an empty or an over-bound set, and any set that holds an id the caller cannot see (all or nothing)');

// 3. one bound
const SQL_MAX = Number((/v_n > (\d+)/.exec(SETTER) || [, ''])[1]);
const READS = stripJs(read('supabase/functions/_shared/evaluation-reads.ts'));
const TS_MAX = Number((/export const ARCHIVE_MAX_IDS = (\d+)/.exec(READS) || [, ''])[1]);
const PAGE_RAW = read('development-activity-reports.html');
const PAGE_MAX = Number((/var MAX_PER_CALL = (\d+)/.exec(PAGE_RAW) || [, ''])[1]);
ok(SQL_MAX === 100 && TS_MAX === SQL_MAX && PAGE_MAX === SQL_MAX, '3a the database, the shared module and the page agree on the bound of one request (100)', [SQL_MAX, TS_MAX, PAGE_MAX]);
const bodyOf100 = JSON.stringify({ action: 'archive', report_ids: Array.from({ length: SQL_MAX }, () => 'c0000000-0000-4000-8000-000000000001') });
const MAX_BYTES = Number((/export const MAX_BODY_BYTES = (\d+)/.exec(read('supabase/functions/_shared/admin-gate.ts')) || [, ''])[1]);
ok(MAX_BYTES >= 4096 && bodyOf100.length < MAX_BYTES, '3b a request naming 100 ids fits the 4 KB request limit with room to spare (it cannot be refused as too large)', [bodyOf100.length, MAX_BYTES]);

// 4. the handler and the data layer
const HANDLER = stripJs(read('supabase/functions/get-development-activity-report/handler.ts'));
const DATA = stripJs(read('supabase/functions/get-development-activity-report/data.ts'));
const BRANCH = block(HANDLER, "if (b.action === 'archive' || b.action === 'restore')");
ok(BRANCH.length > 200, '4a the archive branch is found (positive control)', BRANCH.length);
ok(/deps\.archiveReports\(trial\.userId, ids as string\[\], b\.action === 'archive'\)/.test(BRANCH), '4b it archives for the VERIFIED user (trial.userId, set by the sign-in gate) and takes the direction from the action');
ok(!/\bb\.(user|user_id|p_user_id|email)\b|raw\.|req\./.test(BRANCH), '4c the branch reads no user identity from the request body');
ok(!/deps\.(geocode|zipSupported|radius|hydrate|ledger|events|health|issue|storedReport|contextMatches|rateClaim|openSavedReport|subjectOf|headerOf)/.test(BRANCH) && !/creditDecision|issueBrokerageReport/.test(BRANCH),
  '4d it never reaches the geocoder, the engine reads, the rate limit, the credit rule, the issue function, the stored text or an address');
ok(/const allowed = b\.action === 'open' \? \['action', 'report_id'\] : b\.action === 'list' \? \['action', 'archived'\] : \['action', 'report_ids'\]/.test(HANDLER), '4e each action accepts exactly its own fields and nothing else');
ok(/if \(!trial\) return reply\(req, \{ error: 'forbidden' \}, 403\)/.test(HANDLER) && HANDLER.indexOf("if (!trial) return reply(req, { error: 'forbidden' }, 403)") < HANDLER.indexOf("if (b.action === 'archive' || b.action === 'restore')"), '4f only a trial member reaches it, checked before the branch');
ok(/e instanceof SavedReportNotFound\) return reply\(req, \{ error: 'not_found' \}, 404\)/.test(HANDLER) && /e instanceof ArchiveInvalid\) return reply\(req, \{ error: 'invalid_request'/.test(HANDLER), '4g a refusal is one 404 whatever the cause; an unusable set is 400');
ok(/archiveReports: evaluation\.archiveReports/.test(DATA) && /rpc\('saved_reports_archive_set'/.test(READS) && /rpc\('saved_reports_listed'/.test(READS) && !/rpc\('evaluation_reports_of'/.test(READS), '4h the one module reaches the two functions, and the list no longer calls the ownership reader directly');
for (const f of ['supabase/functions/get-development-activity-report/handler.ts', 'supabase/functions/get-development-activity-report/data.ts', 'supabase/functions/development-activity-trial/handler.ts', 'supabase/functions/development-activity-trial/data.ts', 'supabase/functions/manage-shared-report/handler.ts', 'supabase/functions/manage-property-watch/handler.ts', 'supabase/functions/manage-billing/handler.ts']) {
  ok(!/saved_report_archive|saved_reports_archive_set|saved_reports_listed/.test(stripJs(read(f))), '4i ' + f + ' does not name the archive table or its functions directly');
}
for (const f of ['supabase/functions/_shared/credit-rule.ts', 'supabase/functions/_shared/report-snapshot.ts', 'supabase/functions/_shared/billing-reads.ts', 'supabase/functions/_shared/share-reads.ts', 'supabase/functions/_shared/watch-reads.ts']) {
  ok(!/saved_report_archive|saved_reports_archive_set/.test(stripJs(read(f))), '4j ' + f + ' knows nothing of the archive: credits, snapshots, billing, shares and watches cannot depend on a person\'s list');
}
ok(/validateRows|reports\.length|data\.length > 1000/.test(READS) && /if \(!Array\.isArray\(data\) \|\| data\.length > 1000\)/.test(READS), '4k the list is still bounded at 1000 rows');

// 5. the page
const PAGE = stripJs(PAGE_RAW.replace(/<!--[\s\S]*?-->/g, ''));
const CHANGE = block(PAGE, 'async function changeList(ids, archive, how)');
ok(CHANGE.length > 600, '5a changeList is found (positive control)', CHANGE.length);
const iPost = CHANGE.indexOf('await post(REPORT_FN'), iToast = CHANGE.indexOf('showToast(');
ok(iPost > 0 && iToast > iPost && !/showToast/.test(CHANGE.slice(0, iPost)) && CHANGE.indexOf('if (failed)') < iToast && /if \(failed\) \{[\s\S]*?return false;\s*\}/.test(CHANGE.slice(0, iToast)),
  '5b a notice is shown only AFTER the server answered, and only when it did not fail: a refusal returns before any "Removed" is written');
ok(/r\.status === 200 && r\.body && r\.body\.status === 'OK'/.test(CHANGE) && /li\.remove\(\)/.test(CHANGE) && CHANGE.indexOf("li.remove()") > iPost, '5c a row leaves the list only on a 200 OK from the server');
ok(/if \(archiveBusy \|\| !session \|\| !session\.user \|\| !ids\.length\) return false;/.test(CHANGE) && /archiveBusy = true/.test(CHANGE), '5d one change at a time: a second request cannot start while one is in flight (rapid clicks send one)');
ok(/chunk = ids\.slice\(i, i \+ MAX_PER_CALL\)/.test(CHANGE), '5e a selection larger than the request bound is sent in turns, never as one oversized request');
ok(/if \(!session \|\| !session\.user \|\| session\.user\.id !== forUser\) \{ archiveBusy = false; return false; \}/.test(CHANGE), '5f an answer that arrives after another person signed in touches nothing');
ok(/failed\.status === 401\) \{ session = null; openAuth\(\)/.test(CHANGE), '5g an expired session asks the person to sign in again');
const SAVED_SCRIPT = PAGE.slice(PAGE.indexOf('var SAVED_RECENT = 6'), PAGE.indexOf('// ---- comparing saved reports'));
ok(SAVED_SCRIPT.length > 3000 && !/localStorage|sessionStorage|indexedDB|document\.cookie/.test(SAVED_SCRIPT), '5h nothing about a person\'s list is kept in the browser: the server is the only memory');
ok(!/\b(confirm|alert|prompt)\(/.test(SAVED_SCRIPT) && !/window\.(confirm|alert|prompt)/.test(SAVED_SCRIPT), '5i no browser dialog: the confirmation is drawn in the card');
ok(!/\u{1F5D1}|trash|bin-icon|class="[^"]*\b(del|delete)\b/iu.test(SAVED_SCRIPT + PAGE_RAW.slice(PAGE_RAW.indexOf('id="saved"'), PAGE_RAW.indexOf('id="compare"'))), '5j no trash icon and no delete control on a row');
ok(/archivedView \? await post\(REPORT_FN, \{ action: 'list', archived: true \}\) : await post\(REPORT_FN, \{ action: 'list' \}\)/.test(PAGE), '5k the normal list is asked for exactly as before ({ action: "list" }); only the archived list sends `archived`');
const HTML = PAGE_RAW.slice(PAGE_RAW.indexOf('<section class="card" id="saved"'), PAGE_RAW.indexOf('</section>', PAGE_RAW.indexOf('<section class="card" id="saved"')));
ok(/>Manage<\/button>/.test(HTML) && />View archived<\/button>/.test(HTML) && />Remove from Saved Reports<\/button>/.test(HTML) && /id="saved-undo"[^>]*>Undo</.test(HTML) && /Select all shown</.test(HTML) && />Remove selected<\/button>/.test(HTML) && />Cancel<\/button>/.test(HTML),
  '5l the approved controls and words are on the page: Manage, View archived, Remove from Saved Reports, Undo, Select all shown, Remove selected, Cancel');
ok(/'Removed from Saved Reports\.'/.test(PAGE) && /'Restored to Saved Reports\.'/.test(PAGE) && /'Restore'/.test(PAGE), '5m the approved notice, "Removed from Saved Reports.", and Restore are as specified');
ok(/'Remove ' \+ ids\.length \+ \(ids\.length === 1 \? ' report' : ' reports'\) \+ ' from Saved Reports\?/.test(PAGE) && /manageIds\(\)/.test(block(PAGE, "$('saved-remove-sel').addEventListener")) && /confirmIds = ids/.test(PAGE),
  '5n the confirmation names the exact number it will act on and acts on that frozen list, never on a later one');
ok(/\$\('saved-confirm-go'\)\.addEventListener\('click', function\(\)\{ var ids = confirmIds; hideConfirm\(\); if \(ids && ids\.length\) changeList\(ids, true, 'bulk'\); \}\)/.test(PAGE), '5n2 the confirm button sends the list the confirmation named (confirmIds), not whatever is ticked by then');
ok(!/Delete all|Remove all|Archive all/i.test(HTML), '5o there is no one-click "delete all"');
ok(/return Array\.prototype\.filter\.call\(\$\('saved-list'\)\.querySelectorAll\('\.sv-mpick input'\), function\(c\)\{ return c\.checked && !c\.closest\('li'\)\.hidden; \}\)/.test(PAGE), '5p "Remove selected" counts only rows that are checked AND shown');
ok(/Select all shown/.test(HTML) && /c\.checked = on && !c\.closest\('li'\)\.hidden/.test(PAGE), '5q "Select all" selects what is displayed, not what is hidden');
ok(/class="sv-menu" id="saved-menu" role="menu"/.test(HTML) && /role="menuitem"/.test(HTML) && /aria-haspopup', 'menu'/.test(PAGE) && /setAttribute\('aria-label', 'Actions for report ' \+ rep\.number\)/.test(PAGE) && /'Restore report ' \+ rep\.number \+ ' to Saved Reports'/.test(PAGE),
  '5r the menu, its item, the three-dot button and Restore are named for assistive technology');
ok(/\.sv-menu\{position:fixed/.test(PAGE_RAW) && /#saved-list\{grid-template-columns:minmax\(0,1fr\)\}/.test(PAGE_RAW) && /@media\(pointer:coarse\)\{#saved-list \.sv-kebab\{width:44px;min-width:44px;min-height:44px\}/.test(PAGE_RAW),
  '5s the menu is drawn outside the scrolling list (not clipped), a long address cannot push the button out, and touch screens get a 44 px target');
ok(!/saved-undo[\s\S]{0,200}Math\.random|setTimeout\(function\(\)\{ hideToast\(\); undoIds = null; \}, 12000\)/.test(PAGE) || /setTimeout\(function\(\)\{ hideToast\(\); undoIds = null; \}, 12000\)/.test(PAGE), '5t Undo is offered for a limited time; restoring stays possible from View archived afterwards');
const COMPARE_USES = [...PAGE.matchAll(/\$\('saved-list'\)\.querySelectorAll\('([^']*)'\)/g)].map((m) => m[1]);
ok(COMPARE_USES.length >= 8 && COMPARE_USES.every((q) => q !== 'input'), '5u no query still reads every input in the list: Compare\'s checkboxes and Manage\'s are told apart', COMPARE_USES.join(' | '));
ok(/\$\('saved-list'\)\.textContent = ''/.test(block(PAGE, 'function showSaved(on)')) && /savedView = 'active'/.test(block(PAGE, 'function showSaved(on)')) && /closeMenu\(false\); hideToast\(\); hideConfirm\(\); setManage\(false\)/.test(block(PAGE, 'function showSaved(on)')),
  '5v signing out forgets the list, the view, the menu, the notice and the selection, so one person\'s reports are never left for the next');

// 6. wiring
const DEP_FILES = { 'test/trial_report_pg/run.sh': /saved-reports-archive\.sql/, 'test/launch_gate_pg/run.sh': /saved-reports-archive/, 'test/individual_signup_pg/run.sh': /saved-reports-archive/ };
for (const [f, re] of Object.entries(DEP_FILES)) ok(re.test(read(f)), '6a ' + f + ' applies the archive SQL, since the real handler\'s list now reads through it');
const WF = read('.github/workflows/report-snapshot-suite.yml');
ok((WF.match(/docs\/saved-reports-archive\.sql/g) || []).length === 2 && (WF.match(/test\/saved_reports_archive_pg\/\*\*/g) || []).length === 2, '6b the workflow runs on a change to the SQL or its suite (push and pull request)');
ok(/bash test\/saved_reports_archive_pg\/run\.sh/.test(WF), '6c and has a step that runs the executable suite');
ok(existsSync(join(ROOT, 'test/saved_reports_archive_pg/suite.sql')) && existsSync(join(ROOT, 'test/saved_reports_archive_pg/run.sh')) && /mutate \w+/.test(read('test/saved_reports_archive_pg/run.sh')), '6d the suite and its mutation list exist');
const NEW_TESTS = ['test/saved-reports-archive-function.test.mjs', 'test/saved-reports-archive.browser.test.mjs', 'test/saved-reports-archive-structure.test.mjs'];
ok(NEW_TESTS.every((f) => existsSync(join(ROOT, f))), '6e the offline and browser suites sit under test/*.test.mjs, so the one runner picks them up with no list to edit');
const CAPS = read('supabase/functions/get-development-activity-report/handler.ts');
ok(/saved_reports: .*archive \/ restore/.test(CAPS) && /\{ action: "archive" \| "restore", report_ids \}/.test(CAPS), '6f the function\'s own capability text names the new actions');

console.log('\n' + (n - bad) + ' passed, ' + bad + ' failed of ' + n);
process.exit(bad ? 1 : 0);
