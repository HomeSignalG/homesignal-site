// FOLLOW / CHANGES SINCE REPORT — structural pins (Development Activity plan "Watch This Property";
// docs/report-private-context-contract-2026-09-30.md §6 gate 4 and §8.5).
// Each pin defends an invariant a behavioural test cannot see, because breaking it changes no output today:
//   the reader has no handle on the private context · the one gate, the one set of ledger reads and the one change rule are shared ·
//   the only writes are two locked database functions with a fixed kind · nothing private is ever put in a response.
// Reads source text only, with comments removed where a comment could quote what the code must not contain.
// Most absence pins carry a positive control (the same search over the same files finds the thing it forbids elsewhere), so an
// empty search cannot read as a pass. The bare ones (1f, 1h, 2a, 2b, 4d, 4e, 5g) are each also killed by a mutation in test/follow_report_mutants.py.
// Run: node test/follow-development-report-structure.test.mjs
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(root, f), 'utf8');
let n = 0, bad = 0;
const ok = (c, m, d) => { n++; if (c) console.log('PASS — ' + m); else { bad++; console.log('FAIL — ' + m + (d !== undefined ? '  [' + JSON.stringify(d) + ']' : '')); } };
/** Code with // and block comments removed, so a pin cannot be satisfied (or tripped) by prose that quotes the thing. */
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');

const FN = 'supabase/functions/follow-development-report';
const files = {
  handler: FN + '/handler.ts',
  data: FN + '/data.ts',
  index: FN + '/index.ts',
  reader: 'supabase/functions/_shared/changes-since-report.ts',
  reads: 'supabase/functions/_shared/change-reads.ts',
  gate: 'supabase/functions/_shared/admin-gate.ts',
  rest: 'supabase/functions/_shared/service-rest.ts',
  module: 'supabase/functions/_shared/national-report.ts',
};
const src = Object.fromEntries(Object.entries(files).map(([k, f]) => [k, read(f)]));
const c = Object.fromEntries(Object.entries(src).map(([k, s]) => [k, code(s)]));
const same2 = (a, b) => JSON.stringify(a) === JSON.stringify(b);
/** The function's own code and the reader: everything that decides or touches a request for this feature. */
const mine = [c.handler, c.data, c.index, c.reader].join('\n');

// ---- 1. the access model: the gateway is ON and the handler adds the allow-list ------------------------------------------------------
{
  const cfg = read('supabase/config.toml');
  ok(/\[functions\.follow-development-report\]\s*\nverify_jwt = true/.test(cfg), '1a the function pins verify_jwt = true');
  const wf = read('.github/workflows/deploy-edge-functions.yml').split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  // build step 8 adds the SECOND, deliberate exception: view-shared-report (a client opening a private share link has no account)
  ok([...wf.matchAll(/--no-verify-jwt/g)].length === 2 && /if \[ "\$FN" = "get-address-report" \]/.test(wf) && /elif \[ "\$FN" = "view-shared-report" \]/.test(wf) && !/follow-development-report/.test(wf),
    '1b the deploy workflow\'s only --no-verify-jwt exceptions are get-address-report and view-shared-report; this function is not in them');
  const h = c.handler, at = (s) => h.indexOf(s);
  const firstRead = Math.min(at('deps.reportContext('), at('deps.report('));
  ok(at('authorizeAdmin(req, deps)') > 0 && at('authorizeAdmin(req, deps)') < at('readBounded(req)') && at('readBounded(req)') < firstRead && at('deps.reportContext(') > 0 && at('deps.report(') > 0,
    '1c the order is: the shared gate, then read the body, then any database read (of the context handle or of the report)', [at('authorizeAdmin(req, deps)'), at('readBounded(req)'), at('deps.reportContext('), at('deps.report(')]);
  ok(!/auth\/v1\/user|dashboard_admins\?|rows\[0\]\.email|deps\.authenticate\(|deps\.isAdmin\(/.test(h + c.data + c.reader),
    '1d neither the handler, the data layer nor the reader carries a copy of the gate: it lives once, in _shared/admin-gate.ts and _shared/service-rest.ts');
  ok(/authorizeAdmin/.test(c.gate) && /dashboard_admins/.test(c.rest), '1e (control) the shared modules do hold the gate and the allow-list read');
  ok(!/Access-Control-Allow-Origin['"]?\s*:\s*['"]\*['"]/.test(h + c.gate), '1f there is no wildcard CORS origin');
  ok(/error: 'internal'/.test(h) && !/e\.message|err\.message|String\(e\)/.test(h), '1g an unexpected error is answered without its message');
  // 1h: exactly ONE log call exists anywhere in the feature, in the handler's catch block, and it carries only fixed words: the function name,
  // the action (one of three validated words), the HTTP status, and a reason that is either the fixed-string message of one of the three
  // known error classes or an unknown error's CLASS NAME. Nothing from the request, the report, the ledger or the customer can reach it.
  const all = [c.handler, c.data, c.index, c.reader, c.reads, c.gate, c.rest, c.module].join('\n');
  const logs = [...all.matchAll(/console\.\w+\(/g)].map((m) => m[0]);
  ok(logs.length === 1 && logs[0] === 'console.error(', '1h the whole feature logs exactly once, with console.error', logs);
  const logLine = c.handler.split('\n').filter((l) => /console\.error\(/.test(l));
  ok(logLine.length === 1
      && /^\s*console\.error\(JSON\.stringify\(\{ fn: 'follow-development-report', action, status, reason: known \? \(e as Error\)\.message : \(e instanceof Error \? e\.name : 'unknown'\) \}\)\);\s*$/.test(logLine[0]),
    '1h2 that one line names only the function, the action, the status and a reason (a fixed-string message, or an unknown error\'s class name), and nothing else', logLine);
  ok(/const known = e instanceof ReportUnreadable \|\| e instanceof DataUnavailable \|\| e instanceof EventRowUnreadable;/.test(c.handler),
    '1h3 a message is logged only for the three error classes whose messages are fixed strings');
  ok(!/new (ReportUnreadable|DataUnavailable|EventRowUnreadable)\([^)]*[a-z_]+\.(zip|address|lat|lng|point|body|project_id|report_id|follow_id|email)/i.test(all),
    '1h4 and none of those messages is built from a field of the request, the report or the customer');
}

// ---- 2. the reader has no handle on the private context --------------------------------------------------------------------------------
{
  ok(!/private_context|privateContext|report_private/i.test(c.reader), '2a the reader names no private context, in any spelling');
  ok(!/\bpoint\b|\blat\b|\blng\b|\blatitude\b|\blongitude\b|\baddress\b|subject_/i.test(c.reader), '2b nor an address, a subject point or a coordinate');
  ok(!/report_private_context_read/.test(mine + c.reads + c.rest), '2c nothing here calls report_private_context_read, the one database function that returns the customer\'s address');
  ok(/report_private_context_read/.test(read('docs/report-private-context.sql')), '2d (control) that function exists in the SQL of record, so 2c is a real absence');
  const named = [...(mine + c.reads + c.rest).matchAll(/report_private_context\w*/g)].map((m) => m[0]);
  ok(named.length > 0 && named.every((x) => x === 'report_private_context_need_open' || x === 'report_private_context_need_close'),
    '2e the only private-layer names in the whole feature are the two need functions', [...new Set(named)]);
  const lines = c.handler.split('\n');
  // the ARGUMENT of each reply( call (from the call to the end of its line), so a guard on the same line is not mistaken for the reply
  const replies = lines.filter((l) => /\breply\(/.test(l)).map((l) => l.slice(l.indexOf('reply(')));
  ok(replies.length >= 10 && !replies.some((l) => /private_context|contextId|context_id/.test(l)),
    '2f no response is built from the private context id (it is passed to the two need calls and nowhere else)', replies.length);
  const uses = lines.filter((l) => /private_context_id/.test(l));
  ok(uses.length === 4 && uses.every((l) => /^export type ReportContextRow = |deps\.openFollow|deps\.closeFollow|!ctx\.private_context_id/.test(l.trim())),
    '2g every use of the context id in the handler is the type, the missing-check or one of the two need calls', uses.map((l) => l.trim()));
  // the `changes` branch: from the clock read to the end of the try. It must not name the handle or the call that reads it.
  const hc = c.handler;
  const changesBranch = hc.slice(hc.indexOf('const asked = deps.now()'), hc.indexOf('} catch (e)'));
  const followBranch = hc.slice(hc.indexOf("if (action === 'follow' || action === 'unfollow') {"), hc.indexOf('const asked = deps.now()'));
  ok(changesBranch.length > 400 && !/private_context|reportContext|openFollow|closeFollow|\bctx\b/.test(changesBranch) && /deps\.report\(/.test(changesBranch),
    '2h the `changes` branch of the handler never names the private-context handle or the reads and writes that use it (it holds `stored`, which has no such column)', changesBranch.length);
  ok(followBranch.length > 300 && /deps\.reportContext\(/.test(followBranch) && !/deps\.report\(|\.body\b|parseStoredReport|changesSinceReport/.test(followBranch),
    '2i and the follow / unfollow branch reads only the handle: it never reads the body and never calls the reader (control: it does call reportContext)', followBranch.length);
}

// ---- 3. one change rule, one set of reads, one time boundary --------------------------------------------------------------------------
{
  ok(!/(?<![A-Za-z_])change_ready(?![A-Za-z_])|\.material\b|\bmaterial\s*[=:]/.test(mine), '3a the reader, the handler and the data layer never look at `change_ready` or `material`: the rule is national-report.ts\'s');
  ok(/change_ready/.test(c.module) && /\.material\b/.test(c.module), '3b (control) the module that owns the rule does');
  const modDefs = (s) => [...s.matchAll(/export function (selectDetectedChanges|materialEvents|isChangeReady|detectedChangeEntries|sourcesNotFullyRead)\b/g)].map((m) => m[1]).sort();
  ok(modDefs(c.module).join() === 'detectedChangeEntries,isChangeReady,materialEvents,selectDetectedChanges,sourcesNotFullyRead', '3c the module defines each of the five shared rules, once');
  ok(modDefs(c.reader).length === 0 && !/function (selectDetectedChanges|materialEvents|isChangeReady|detectedChangeEntries|sourcesNotFullyRead)/.test(c.reader + c.handler + c.data),
    '3d and nothing here defines a second copy of any of them');
  for (const f of ['selectDetectedChanges', 'detectedChangeEntries', 'sourcesNotFullyRead', 'isChangeReady']) {
    ok(new RegExp('\\b' + f + '\\(').test(c.reader), '3e the reader calls the shared ' + f);
  }
  ok(!/\bdeps\.events\(|\.events\(/.test(mine), '3f nothing here asks for events by the source\'s observation day: Changes Since Report asks by the ledger\'s write time');
  ok(/created_at=gt\./.test(c.reads) && /,created_at/.test(c.reads) && /dev_change_event_reportable/.test(c.reads), '3g the read it uses selects created_at and filters on it, from the reportable view');
  const wr = c.reads.slice(c.reads.indexOf('async eventsWrittenSince'), c.reads.indexOf('async health'));
  ok(wr.length > 100 && (wr.match(/material=eq\.true/g) || []).length === 1 && !/material=eq\.true/.test(c.reads.slice(c.reads.indexOf('async events('), c.reads.indexOf('async eventsWrittenSince'))),
    '3g2 the since read asks the ledger for MATERIAL events only (every consumer discards the rest), and the national report\'s own read is unchanged');
  const asked = c.handler.indexOf('deps.now()');
  ok((c.handler.match(/deps\.now\(/g) || []).length === 1 && asked > 0 && asked < c.handler.indexOf('deps.report(') && asked < c.handler.indexOf('deps.ledger(') && /now: asked/.test(c.handler),
    '3g3 the clock is read once, before any ledger read, and that instant is handed to the reader as its `now`: `through` is when the question was asked');
  const overlay = (s) => [...s.matchAll(/SINCE_REPORT_OVERLAP_MS\s*=/g)].length;
  ok(overlay(c.reader) === 1 && overlay(c.handler + c.data + c.reads) === 0, '3h the overlap is defined once, in the reader');
  ok(/writtenSinceInstant\(stored\.generated_at\)/.test(c.handler) && !/Date\.parse|new Date\(/.test(c.handler), '3i the handler asks the reader for the instant and does no date arithmetic of its own');
  const ovl = c.reader.match(/SINCE_REPORT_OVERLAP_MS = (\d+) \* (\d+) \* (\d+)/);
  const overlapMs = ovl ? Number(ovl[1]) * Number(ovl[2]) * Number(ovl[3]) : NaN;
  ok(overlapMs === 600000, '3j the overlap is ten minutes', overlapMs);
  // The overlap is the margin between a transaction's START (what `created_at` records) and the report's read. It must dominate the longest
  // transaction the observation job can run, which is read from the SQL of record, not restated here.
  const sched = read('docs/dev-change-observation-schedule.sql'), base = read('docs/dev-change-baseline.sql');
  const maxSecs = Number((sched.match(/_max_secs\s+constant integer := (\d+);/) || [])[1]);
  const stmtTimeout = Number((base.match(/below the (\d+) s statement timeout/) || [])[1]);
  ok(Number.isFinite(maxSecs) && maxSecs > 0 && Number.isFinite(stmtTimeout) && stmtTimeout > maxSecs, '3j2 (control) the observation tick\'s soft budget and the hard statement timeout are both read from the SQL of record', [maxSecs, stmtTimeout]);
  ok(overlapMs >= 2 * stmtTimeout * 1000 && overlapMs >= 2 * maxSecs * 1000,
    '3j3 the overlap is at least twice the observation tick\'s soft time cap AND twice the hard statement timeout (the longest a transaction can run), so a change to either in the SQL breaks this pin before it breaks an answer', [overlapMs, maxSecs, stmtTimeout]);
  ok(/NEW_PROJECTS_NOT_COVERED/.test(c.reader) && /limitations = \[\{ \.\.\.NEW_PROJECTS_NOT_COVERED \}\]/.test(c.reader), '3k every answer carries the statement that projects new since the report are not covered');
  ok(/recorded_at: e\.created_at/.test(c.reader) && /source_retrieved_before_report/.test(c.reader) && /\.\.\.RECORDED_AFTER_REPORT/.test(c.reader) && /RECORDED_AFTER_REPORT = \{\s*code: 'RECORDED_AFTER_REPORT'/.test(c.reader),
    '3k2 every entry carries when the ledger recorded it and whether its source predates the report, and the answer says so when one does');
  ok(/class EventRowUnreadable/.test(c.reader) && /throw new EventRowUnreadable/.test(c.reader) && /EventRowUnreadable/.test(c.handler) && /class ReportUnreadable/.test(c.reader) && /throw new ReportUnreadable\('a detected change in the report cannot be read'\)/.test(c.reader),
    '3k3 an unreadable ledger event or an unreadable detected change in the stored body is refused (502 / 422), never dropped');
  ok(!/rights_class/.test(mine + c.reads), '3l no rights decision is read from the ledger: rights are the registry\'s, read at answer time');
  ok(/validateRights\(/.test(c.handler) && /validateRights\(input\.rights\)/.test(c.reader), '3m the registry is validated by the handler and again by the reader');
}

// ---- 4. the only writes are two locked database functions, with a fixed kind --------------------------------------------------------------
{
  const methods = [...c.data.matchAll(/method: '([A-Z]+)'/g)].map((m) => m[1]);
  ok(methods.length === 1 && methods[0] === 'POST', '4a the data layer has one fetch with a method, and it is a POST (an RPC)', methods);
  const rpcs = [...c.data.matchAll(/rpc\('([a-z_]+)'/g)].map((m) => m[1]).sort();
  ok(rpcs.join() === 'report_private_context_need_close,report_private_context_need_open', '4b the only RPCs it calls are need_open and need_close', rpcs);
  const kinds = [...c.data.matchAll(/p_kind: '([a-z]+)'/g)].map((m) => m[1]);
  ok(kinds.length === 2 && kinds.every((k) => k === 'follow'), '4c and both pass the fixed kind \'follow\': this function can open or close a follow need and no other kind', kinds);
  ok(!/p_kind: (?!')/.test(c.data), '4d the kind is never taken from the request');
  ok(!/\.insert\(|method: 'PUT'|method: 'PATCH'|method: 'DELETE'/.test(mine + c.reads + c.rest), '4e there is no table write of any kind');
  ok(!/report_snapshot_issue|issueSnapshot|report-snapshot\.ts/.test(mine + c.reads), '4f and this function never writes a snapshot');
  ok(/report_snapshot\?select=/.test(c.data) && !/report_snapshot\?[^'"]*(delete|update|insert)/i.test(c.data), '4g it reads report_snapshot for the permanent body and, separately, the opaque context id');
  const sels = [...c.data.matchAll(/report_snapshot\?select=([^&']+)/g)].map((m) => m[1]);
  ok(same2(sels, ['report_id,content_hash,report_version,generated_at,body', 'private_context_id']), '4h and its two SELECTs are exactly these: the changes read has NO private column, the follow read has NO body', sels);
  const ledgerTables = [...(c.data + c.reads).matchAll(/'([a-z_]+)\?select=/g)].map((m) => m[1]);
  ok(ledgerTables.every((t) => ['report_snapshot', 'dev_change_project', 'dev_change_event_reportable', 'dev_change_source_fetch_health'].includes(t)) && ledgerTables.length >= 4,
    '4i every table it reads is one of four: the snapshot, the ledger\'s projects, its reportable view, and the failure-only source-health view (never the whole-ledger dev_change_source_health, which cannot be filtered cheaply)', ledgerTables);
  const allRaw = [];
  const walk = (d) => { for (const e of readdirSync(join(root, d))) { const p = d + '/' + e; if (statSync(join(root, p)).isDirectory()) walk(p); else if (/\.(ts|js|mjs)$/.test(e) && /dev_change_event(?!_reportable)/.test(code(read(p)))) allRaw.push(p); } };
  walk('supabase/functions');
  ok(allRaw.length === 0, '4j across every edge function the raw event table public.dev_change_event is named nowhere: events come only from the reportable view', allRaw);
  const reportable = [];
  const walk2 = (d) => { for (const e of readdirSync(join(root, d))) { const p = d + '/' + e; if (statSync(join(root, p)).isDirectory()) walk2(p); else if (/\.(ts|js|mjs)$/.test(e) && /dev_change_event_reportable/.test(code(read(p)))) reportable.push(p); } };
  walk2('supabase/functions');
  ok(reportable.length === 1 && reportable[0] === 'supabase/functions/_shared/change-reads.ts', '4k (control) and the reportable view is named by exactly one module, so the 4j search is real and the SELECT has one home', reportable);
}

// ---- 5. purity: every file except index.ts can reach nothing by itself ------------------------------------------------------------------
{
  for (const k of ['handler', 'data', 'reader', 'reads', 'gate', 'rest']) {
    ok(!/\bDeno\b|process\.env|\brequire\(/.test(c[k]), '5' + 'abcdef'[['handler', 'data', 'reader', 'reads', 'gate', 'rest'].indexOf(k)] + ' ' + files[k].split('/').pop() + ' reads no environment and no runtime global');
  }
  ok(!/\bfetch\(/.test(c.handler + c.reader + c.reads + c.gate) && !/[^.\w]fetch\(/.test(c.data), '5g none of them calls a bare fetch: the network arrives injected');
  ok(/\(input, init\) => fetch\(input, init\)/.test(c.index), '5h index.ts is the one place the real fetch is handed in');
  ok(/SUPABASE_SERVICE_ROLE_KEY/.test(c.index) && !/SUPABASE_SERVICE_ROLE_KEY/.test(c.handler + c.data + c.reader + c.reads + c.gate + c.rest), '5i only index.ts reads the service key; every other file receives it');
  ok(!/randomUUID|newId|Math\.random|Date\.now|crypto\./.test(c.handler + c.data + c.index + c.reader) && /randomUUID/.test('const id = crypto.randomUUID();'),
    '5j the function mints no follow id and derives none from the address, the report, the user or the clock: the caller holds the id (control: the search pattern does fire on a minting call)');
}

// ---- 6. the request is closed: three actions, a fixed field list per action, UUIDs only -----------------------------------------------------------
{
  const h = c.handler;
  ok(/const ACTIONS = \['changes', 'follow', 'unfollow'\];/.test(h), '6a three actions and no others');
  ok(/changes: \['action', 'report_id', 'view'\]/.test(h) && /follow: \['action', 'report_id', 'follow_id'\]/.test(h) && /unfollow: \['action', 'report_id', 'follow_id'\]/.test(h), '6b each action has a fixed field list');
  ok(/unknown field/.test(h), '6c any other field is refused');
  ok(!/\baddress\b|\bzip\b|\blat\b|\blng\b/i.test(c.handler), '6d no action accepts an address, a ZIP or a point: a report is addressed by its id');
  ok(/UUID\.test\(b\.report_id\)/.test(h) && /FOLLOW_ID\.test\(b\.follow_id\)/.test(h), '6e the report id must be a UUID and the follow id a version-4 (random) UUID before they are used');
  ok(/const FOLLOW_ID = \/\^\[0-9a-f\]\{8\}-\[0-9a-f\]\{4\}-4\[0-9a-f\]\{3\}-\[89ab\]\[0-9a-f\]\{3\}-\[0-9a-f\]\{12\}\$\/i;/.test(h) && !/UUID\.test\(b\.follow_id\)/.test(h),
    '6e1 the follow id pattern admits version 4 only, so a name-based id (a hash of an address or a user) is refused, and the looser pattern is not used for it');
  ok(/\(action === 'follow' \|\| action === 'unfollow'\) && !followId\) return reply\(req, \{ error: 'invalid_request', detail: 'follow_id' \}, 400\)/.test(h) && !/followId \?\?/.test(h),
    '6e2 follow and unfollow both REQUIRE a follow_id, and nothing falls back to another value when it is absent');
  ok(/b\.report_id\.toLowerCase\(\)/.test(h) && /b\.follow_id\.toLowerCase\(\)/.test(h), '6e3 both ids are lower-cased before they are used, so a retry in another case is the same follow');
  ok(/UUID\.test\(reportId\)/.test(c.data), '6f and the data layer refuses a report id that is not one before it puts it in a URL');
  ok(/'CONTEXT_PURGED'/.test(c.handler) && /'NO_PRIVATE_CONTEXT'/.test(c.handler), '6g a purged context and a report with no context are named outcomes, not errors');
}

// ---- 7. it is gated in CI --------------------------------------------------------------------------------------------------------------------
{
  const unit = read('.github/workflows/unit-tests.yml');
  ok(/'supabase\/functions\/\*\*'/.test(unit) && /'test\/\*\*'/.test(unit) && /'supabase\/config\.toml'/.test(unit), '7a the required unit check runs when the function, its tests or the JWT config change');
  for (const t of ['changes-since-report.test.mjs', 'follow-development-report.test.mjs', 'follow-development-report-structure.test.mjs']) {
    // the unit runner's own rule: a suite is browser-backed only if it imports playwright. These must not, or the required offline job would skip them.
    ok(existsSync(join(root, 'test', t)) && !/(?:from|import\(|require\()\s*['"]playwright['"]/.test(read('test/' + t)), '7b ' + t + ' exists and the unit runner counts it as an offline suite');
  }
  ok(/(?:from|import\(|require\()\s*['"]playwright['"]/.test('import { chromium } from ' + "'play" + "wright';"), '7b2 (control) the pattern does recognise a browser suite (the control string is built in two pieces so THIS file does not read as browser-backed to the runner)');
  const wf = read('.github/workflows/report-snapshot-suite.yml');
  ok(/bash test\/changes_since_report_pg\/run\.sh/.test(wf), '7c the snapshot workflow runs the Changes Since Report round trip on a disposable Postgres');
  const block = (from, to) => wf.slice(wf.indexOf(from), wf.indexOf(to));
  const pr = block('  pull_request:', '  push:'), push = block('  push:', '  workflow_dispatch:');
  const needs = ["'test/dev_change_ledger_pg/fixture.sql'", "'test/changes_since_report_pg/**'", "'supabase/functions/_shared/changes-since-report.ts'", "'supabase/functions/_shared/change-reads.ts'", "'supabase/functions/_shared/service-rest.ts'", "'supabase/functions/_shared/admin-gate.ts'", "'supabase/functions/follow-development-report/**'", "'docs/dev-change-reportable.sql'", "'docs/dev-change-ledger.sql'"];
  ok(pr.length > 100 && needs.every((p) => pr.includes(p)), '7d the PULL REQUEST trigger (the merge gate) runs when the reader, the shared reads, the gate, the function or the ledger SQL change', needs.filter((p) => !pr.includes(p)));
  ok(push.length > 100 && needs.every((p) => push.includes(p)), '7d and so does the push-to-main trigger', needs.filter((p) => !push.includes(p)));
  ok(!/secrets\./.test(wf) && /Refuse to run if any Supabase credential is present/.test(wf), '7e the workflow holds no secret and refuses to run if a Supabase credential is present');
  const run = read('test/changes_since_report_pg/run.sh');
  ok(/case "\$PGDATABASE" in \*disposable\*\)/.test(run) && /ABORT/.test(run) && /SUPABASE_DB_URL/.test(run) && /SUPABASE_WRITE_KEY/.test(run), '7f the round trip refuses any database not named disposable and any environment holding a Supabase credential');
  ok(/docs\/dev-change-ledger\.sql/.test(run) && /docs\/dev-change-reportable\.sql/.test(run) && /docs\/report-private-context\.sql/.test(run) && /docs\/report-snapshot\.sql/.test(run), '7g it applies the SHIPPED SQL of record for the ledger, its reportable view, the private layer and the snapshot, not a copy');
  ok(/apply "\$root\/test\/dev_change_ledger_pg\/fixture\.sql"/.test(run) && /\|\| \{ echo "FAIL — \$1 did not apply:"; echo "\$out"; exit 3; \}/.test(run) && !/>\/dev\/null 2>&1/.test(run),
    '7g2 the round trip applies the ledger fixture too, and a setup file that fails to apply says WHICH one and why before the run stops (no output at all would read as a broken CI step)');
  const rt = read('test/changes_since_report_pg/roundtrip.mjs');
  ok(/follow-development-report\/handler\.ts/.test(rt) && /follow-development-report\/data\.ts/.test(rt) && /change-reads\.ts/.test(rt) && /report-snapshot\.ts/.test(rt) && /national-report\.ts/.test(rt),
    '7h it drives the real handler, the real data layer, the real shared reads, the real writer and the real engine');
  // the workflow's two path lists must be the SAME list: the round trip imports files that only one list named (a push to main that changed
  // only report-snapshot.ts or the SQL the round trip slices its real view from ran nothing), and reads docs/dev-change-baseline.sql
  const lists = (txt) => {
    const grab = (re) => { const m = re.exec(txt); return m ? [...m[1].matchAll(/^ {6}- '([^']*)'$/gm)].map((x) => x[1]) : null; };
    return { pr: grab(/ {2}pull_request:\n {4}paths:\n((?: {6}- '[^\n]*'\n)+)/), push: grab(/ {2}push:\n {4}branches: \[main\]\n {4}paths:\n((?: {6}- '[^\n]*'\n)+)/) };
  };
  ok(lists("  pull_request:\n    paths:\n      - 'a'\n      - 'b'\n  push:\n    branches: [main]\n    paths:\n      - 'a'\n").pr.length === 2 && lists("  pull_request:\n    paths:\n      - 'a'\n  push:\n    branches: [main]\n    paths:\n      - 'a'\n      - 'c'\n").push.length === 2,
    '7j-control the path-list reader finds both lists in a workflow');
  const wfl = lists(wf);
  ok(wfl.pr && wfl.push && wfl.pr.length >= 20 && same2([...wfl.pr].sort(), [...wfl.push].sort()),
    '7j the workflow\'s push-to-main and pull-request path lists are the SAME set: a push that changes any file the round trip uses runs it, as a pull request does', [wfl.pr && wfl.pr.length, wfl.push && wfl.push.length]);
  ok(['supabase/functions/_shared/report-snapshot.ts', 'docs/dev-change-baseline.sql', 'docs/dev-change-ledger.sql', 'docs/report-snapshot.sql', 'test/dev_change_ledger_pg/fixture.sql'].every((f) => wfl.push && wfl.push.includes(f)),
    '7j2 both lists name the real writer, the SQL of record the round trip applies and the SQL it slices its real view from');
  const standins = read('test/changes_since_report_pg/standins.sql');
  ok(/^alter role service_role bypassrls;$/m.test(standins),
    '7i2 the stand-in gives service_role the BYPASSRLS attribute Supabase\'s role has: without it the ledger (RLS on, no policy) reads as empty on a fresh database, which a developer machine where the role already carries the attribute hides');
  const created = [...standins.matchAll(/create (?:table|view|function) (?:if not exists )?(?:public\.)?(\w+)/gi)].map((m) => m[1]);
  ok(created.join() === 'dev_refresh_source_failures' && !/create (?:or replace )?view/i.test(standins),
    '7i the only stand-in is the failure TABLE dev_refresh_source_failures (an ingest-side table this repo does not own) and NO view is typed here; every other relation, including the source-health view the reader queries, is the shipped SQL', created);
  ok(/docs\/dev-change-baseline\.sql/.test(run) && /dev_change_source_fetch_health/.test(run) && /re\.search\(pat, s\)/.test(run) && /apply "\$slice"/.test(run),
    '7i3 run.sh applies the REAL dev_change_source_fetch_health, its revoke and its grant, sliced out of the SQL of record by pattern (and fails if the pattern stops matching), so the view the reader queries is production\'s own');
}

console.log('\n' + (n - bad) + ' passed, ' + bad + ' failed of ' + n);
process.exit(bad ? 1 : 0);
