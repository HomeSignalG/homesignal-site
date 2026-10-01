// FOLLOW / CHANGES SINCE REPORT — structural pins (Development Activity plan "Watch This Property";
// docs/report-private-context-contract-2026-09-30.md §6 gate 4 and §8.5).
// Each pin defends an invariant a behavioural test cannot see, because breaking it changes no output today:
//   the reader has no handle on the private context · the one gate, the one set of ledger reads and the one change rule are shared ·
//   the only writes are two locked database functions with a fixed kind · nothing private is ever put in a response.
// Reads source text only, with comments removed where a comment could quote what the code must not contain.
// Every absence pin carries a positive control (the same search over the same files finds the thing it forbids elsewhere), so an
// empty search cannot read as a pass.
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
/** The function's own code and the reader: everything that decides or touches a request for this feature. */
const mine = [c.handler, c.data, c.index, c.reader].join('\n');

// ---- 1. the access model: the gateway is ON and the handler adds the allow-list ------------------------------------------------------
{
  const cfg = read('supabase/config.toml');
  ok(/\[functions\.follow-development-report\]\s*\nverify_jwt = true/.test(cfg), '1a the function pins verify_jwt = true');
  const wf = read('.github/workflows/deploy-edge-functions.yml').split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  ok([...wf.matchAll(/--no-verify-jwt/g)].length === 1 && /if \[ "\$FN" = "get-address-report" \]/.test(wf) && !/follow-development-report/.test(wf),
    '1b the deploy workflow\'s one --no-verify-jwt exception is get-address-report; this function is not in it');
  const h = c.handler, at = (s) => h.indexOf(s);
  ok(at('authorizeAdmin(req, deps)') > 0 && at('authorizeAdmin(req, deps)') < at('readBounded(req)') && at('readBounded(req)') < at('deps.report('),
    '1c the order is: the shared gate, then read the body, then any database read', [at('authorizeAdmin(req, deps)'), at('readBounded(req)'), at('deps.report(')]);
  ok(!/auth\/v1\/user|dashboard_admins\?|rows\[0\]\.email|deps\.authenticate\(|deps\.isAdmin\(/.test(h + c.data + c.reader),
    '1d neither the handler, the data layer nor the reader carries a copy of the gate: it lives once, in _shared/admin-gate.ts and _shared/service-rest.ts');
  ok(/authorizeAdmin/.test(c.gate) && /dashboard_admins/.test(c.rest), '1e (control) the shared modules do hold the gate and the allow-list read');
  ok(!/Access-Control-Allow-Origin['"]?\s*:\s*['"]\*['"]/.test(h + c.gate), '1f there is no wildcard CORS origin');
  ok(/error: 'internal'/.test(h) && !/e\.message|err\.message|String\(e\)/.test(h), '1g an unexpected error is answered without its message');
  ok(!/console\./.test(mine + c.reads + c.gate + c.rest), '1h and nothing logs');
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
  ok(uses.length >= 3 && uses.every((l) => /^export type StoredReportRow = |deps\.openFollow|deps\.closeFollow|!stored\.private_context_id/.test(l.trim())),
    '2g every use of the context id in the handler is the missing-check or one of the two need calls', uses.map((l) => l.trim()));
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
  const overlay = (s) => [...s.matchAll(/SINCE_REPORT_OVERLAP_MS\s*=/g)].length;
  ok(overlay(c.reader) === 1 && overlay(c.handler + c.data + c.reads) === 0, '3h the overlap is defined once, in the reader');
  ok(/writtenSinceInstant\(stored\.generated_at\)/.test(c.handler) && !/Date\.parse|new Date\(/.test(c.handler), '3i the handler asks the reader for the instant and does no date arithmetic of its own');
  ok(/SINCE_REPORT_OVERLAP_MS = 10 \* 60 \* 1000/.test(c.reader), '3j the overlap is ten minutes: it must exceed the 60 s observation tick and the report\'s read-to-write span');
  ok(/NEW_PROJECTS_NOT_COVERED/.test(c.reader) && /limitations = \[\{ \.\.\.NEW_PROJECTS_NOT_COVERED \}\]/.test(c.reader), '3k every answer carries the statement that projects new since the report are not covered');
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
  ok(/report_snapshot\?select=/.test(c.data) && !/report_snapshot\?[^'"]*(delete|update|insert)/i.test(c.data), '4g it reads report_snapshot for the permanent body and the opaque context id');
  const sel = (c.data.match(/report_snapshot\?select=([^&']+)/) || [])[1] || '';
  ok(sel === 'report_id,content_hash,report_version,generated_at,private_context_id,body', '4h and selects exactly those columns', sel);
  const ledgerTables = [...(c.data + c.reads).matchAll(/'([a-z_]+)\?select=/g)].map((m) => m[1]);
  ok(ledgerTables.every((t) => ['report_snapshot', 'dev_change_project', 'dev_change_event_reportable', 'dev_change_source_health'].includes(t)) && ledgerTables.length >= 4,
    '4i every table it reads is one of four: the snapshot, the ledger\'s projects, its reportable view, its source health', ledgerTables);
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
  ok(/crypto\.randomUUID\(\)/.test(c.data) && !/Math\.random|Date\.now|crypto\.subtle|createHash|\bmd5\b|\bsha\d*\b/i.test(c.handler + c.data), '5j a follow id the function mints is a random UUID: nothing derived from the address, the report, the user or the clock');
}

// ---- 6. the request is closed: three actions, a fixed field list per action, UUIDs only -----------------------------------------------------------
{
  const h = src.handler;
  ok(/const ACTIONS = \['changes', 'follow', 'unfollow'\];/.test(h), '6a three actions and no others');
  ok(/changes: \['action', 'report_id', 'view'\]/.test(h) && /follow: \['action', 'report_id', 'follow_id'\]/.test(h) && /unfollow: \['action', 'report_id', 'follow_id'\]/.test(h), '6b each action has a fixed field list');
  ok(/unknown field/.test(h), '6c any other field is refused');
  ok(!/\baddress\b|\bzip\b|\blat\b|\blng\b/i.test(c.handler), '6d no action accepts an address, a ZIP or a point: a report is addressed by its id');
  ok(/UUID\.test\(b\.report_id\)/.test(h) && /UUID\.test\(b\.follow_id\)/.test(h), '6e both ids must be UUIDs before they are used');
  ok(/UUID\.test\(reportId\)/.test(c.data), '6f and the data layer refuses a report id that is not one before it puts it in a URL');
  ok(/'CONTEXT_PURGED'/.test(c.handler) && /'NO_PRIVATE_CONTEXT'/.test(c.handler), '6g a purged context and a report with no context are named outcomes, not errors');
}

// ---- 7. it is gated in CI --------------------------------------------------------------------------------------------------------------------
{
  const unit = read('.github/workflows/unit-tests.yml');
  ok(/'supabase\/functions\/\*\*'/.test(unit) && /'test\/\*\*'/.test(unit) && /'supabase\/config\.toml'/.test(unit), '7a the required unit check runs when the function, its tests or the JWT config change');
  for (const t of ['changes-since-report.test.mjs', 'follow-development-report.test.mjs', 'follow-development-report-structure.test.mjs']) {
    ok(existsSync(join(root, 'test', t)) && !/browser/.test(t), '7b ' + t + ' exists and is an offline suite');
  }
  const wf = read('.github/workflows/report-snapshot-suite.yml');
  ok(/bash test\/changes_since_report_pg\/run\.sh/.test(wf), '7c the snapshot workflow runs the Changes Since Report round trip on a disposable Postgres');
  const block = (from, to) => wf.slice(wf.indexOf(from), wf.indexOf(to));
  const pr = block('  pull_request:', '  push:'), push = block('  push:', '  workflow_dispatch:');
  const needs = ["'test/changes_since_report_pg/**'", "'supabase/functions/_shared/changes-since-report.ts'", "'supabase/functions/_shared/change-reads.ts'", "'supabase/functions/_shared/service-rest.ts'", "'supabase/functions/_shared/admin-gate.ts'", "'supabase/functions/follow-development-report/**'", "'docs/dev-change-reportable.sql'", "'docs/dev-change-ledger.sql'"];
  ok(pr.length > 100 && needs.every((p) => pr.includes(p)), '7d the PULL REQUEST trigger (the merge gate) runs when the reader, the shared reads, the gate, the function or the ledger SQL change', needs.filter((p) => !pr.includes(p)));
  ok(push.length > 100 && needs.every((p) => push.includes(p)), '7d and so does the push-to-main trigger', needs.filter((p) => !push.includes(p)));
  ok(!/secrets\./.test(wf) && /Refuse to run if any Supabase credential is present/.test(wf), '7e the workflow holds no secret and refuses to run if a Supabase credential is present');
  const run = read('test/changes_since_report_pg/run.sh');
  ok(/case "\$PGDATABASE" in \*disposable\*\)/.test(run) && /ABORT/.test(run) && /SUPABASE_DB_URL/.test(run) && /SUPABASE_WRITE_KEY/.test(run), '7f the round trip refuses any database not named disposable and any environment holding a Supabase credential');
  ok(/docs\/dev-change-ledger\.sql/.test(run) && /docs\/dev-change-reportable\.sql/.test(run) && /docs\/report-private-context\.sql/.test(run) && /docs\/report-snapshot\.sql/.test(run), '7g it applies the SHIPPED SQL of record for the ledger, its reportable view, the private layer and the snapshot, not a copy');
  const rt = read('test/changes_since_report_pg/roundtrip.mjs');
  ok(/follow-development-report\/handler\.ts/.test(rt) && /follow-development-report\/data\.ts/.test(rt) && /change-reads\.ts/.test(rt) && /report-snapshot\.ts/.test(rt) && /national-report\.ts/.test(rt),
    '7h it drives the real handler, the real data layer, the real shared reads, the real writer and the real engine');
  const standins = read('test/changes_since_report_pg/standins.sql');
  const created = [...standins.matchAll(/create (?:table|view|function) (?:if not exists )?(?:public\.)?(\w+)/gi)].map((m) => m[1]);
  ok(created.join() === 'dev_change_source_health', '7i the only stand-in is dev_change_source_health (a view over ingest-side tables this repo does not own); every other relation is the shipped SQL', created);
}

console.log('\n' + (n - bad) + ' passed, ' + bad + ' failed of ' + n);
process.exit(bad ? 1 : 0);
