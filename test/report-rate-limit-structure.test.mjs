// THE REPORT RATE LIMIT — the structural half (docs/report-rate-limit.sql). The executable halves are test/report_rate_limit_pg (the database's rule against a real
// Postgres, with real concurrent sessions), test/report-rate-limit-function.test.mjs (the edge) and section 15 of test/launch_gate_pg (end to end). What those cannot
// see is whether the limiter is still WHERE and WHAT they proved: a claim moved after the geocoder, one that quietly gained an admin or a read, a second copy of the
// numbers, a path to the counters that is not the claim, a limiter that has drifted into the credit path, or a CI job that stopped running it would go on printing PASS.
// Pinned here on COMMENT-STRIPPED text, each with a positive control so a scan that matched nothing cannot pass:
//   * the SQL: system-only, the counters and nothing private, the founder's 10 and 100 asserted untouched, the rollback present;
//   * the edge: the claim is made only for a member, after validation and before any work, answers 429 with Retry-After, fails closed; the shared reader names
//     only the wrapper (never the clocked variant, never the table) and holds no number; no other file in the product reaches the counters;
//   * the credit path: nothing the entitlement owns names the limiter;
//   * the page: says it in plain words and never shows a code;
//   * the record: CI runs it, the mutation loops are committed, and the record says what it does NOT cover.
// Run: node test/report-rate-limit-structure.test.mjs
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

let n = 0, bad = 0;
process.on('uncaughtException', (e) => {
  console.log('FAIL — the test stopped: ' + String(e && e.message).slice(0, 160));
  console.log('\n' + (n - bad) + ' passed, ' + (bad + 1) + ' failed of ' + (n + 1));
  process.exit(1);
});
const ok = (c, m, d) => { n++; if (c) console.log('PASS — ' + m); else { bad++; console.log('FAIL — ' + m + (d !== undefined ? '  [' + d + ']' : '')); } };
const ROOT = new URL('..', import.meta.url).pathname;
const read = (f) => (existsSync(join(ROOT, f)) ? readFileSync(join(ROOT, f), 'utf8') : '');
const stripJs = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
const stripSql = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');
const stripYml = (s) => s.split('\n').map((l) => l.replace(/^(\s*)#.*$/, '$1')).join('\n');
const stripHtmlJs = (s) => stripJs(s);

// ---- 1. the SQL -----------------------------------------------------------------------------------------------------------------------------------------------
const SQLRAW = read('docs/report-rate-limit.sql');
const SQL = stripSql(SQLRAW);
ok(SQL.length > 3000 && /create table if not exists public\.report_rate_window/.test(SQL), '1a the SQL is read and creates the counter table (positive control)', SQL.length);
const grants = [...SQL.matchAll(/grant\s+[^;]+?\s+to\s+([^;]+);/gi)].map((m) => m[1].trim());
ok(grants.length === 4 && grants.every((g) => g === 'service_role'), '1b every grant in the file is to service_role, and there are exactly four (the four functions)', grants);
ok(!/\bto\s+(public|anon|authenticated)\b/i.test(SQL) && /alter table public\.report_rate_window enable row level security/.test(SQL) && !/create policy/i.test(SQL),
  '1c nothing is granted to public, anon or authenticated, row level security is on, and no policy opens the table');
ok(/revoke all on public\.report_rate_window from public, anon, authenticated, service_role/.test(SQL), '1d every privilege on the counter table is revoked from every role, the system role included: it reaches the counters only through the functions');
const cols = [...(/create table if not exists public\.report_rate_window \(([\s\S]*?)\n\);/.exec(SQL) || [, ''])[1].matchAll(/^\s{2}(\w+)\s+(\w+)/gm)].filter((m) => !/^constraint$/i.test(m[1])).map((m) => m[1] + ':' + m[2]);
ok(cols.join() === 'bucket:text,subject:uuid,window_secs:integer,window_start:timestamptz,used:integer', '1e the table holds a bucket, a subject that is a uuid, a window and a count - no email, address, IP or token column', cols);
ok(/evaluation_report_limit\(\) <> 10/.test(SQL) && /billing_report_limit\(\) <> 100/.test(SQL) && /raise exception 'report_rate_limit: the free report limit is not 10/.test(SQL) && /raise exception 'report_rate_limit: the paid monthly limit is not 100/.test(SQL),
  '1f the post-condition refuses to apply if the founder\'s 10 free or 100 paid reports are anything else');
ok(!/\b(insert|update|delete)\b[^;]*\b(evaluation|brokerage_paid_credit|brokerage_subscription|report_snapshot)\b/i.test(SQL.replace(/'(?:[^']|'')*'/g, "''")), '1g it writes no row of the credit ledgers or the snapshot: its only writes are to its own table');
ok(/pg_advisory_xact_lock/.test(SQL) && /read committed/.test(SQL) && /RATE_CLAIM_NEEDS_READ_COMMITTED/.test(SQL), '1h the claim is serialised by advisory locks and refuses to run above READ COMMITTED');
ok(/-- ROLLBACK \(this file only/.test(SQLRAW) && (SQLRAW.match(/^-- drop /gm) || []).length === 5, '1i the file carries its rollback (five drop statements)');
ok(/PROPOSED, NOT FOUNDER-SET/.test(SQLRAW) && /D-RL-1/.test(SQLRAW), '1j and it says in its own header that the numbers are proposed, not founder-set, and names the decision that would set them');
ok(/APPLY ORDER \(production\): this file FIRST, then deploy get-development-activity-report/.test(SQLRAW), '1k and it states the apply order: this file first, then the function');

// ---- 2. the edge ----------------------------------------------------------------------------------------------------------------------------------------------
const HANDLER = stripJs(read('supabase/functions/get-development-activity-report/handler.ts'));
const DATA = stripJs(read('supabase/functions/get-development-activity-report/data.ts'));
const RR = stripJs(read('supabase/functions/_shared/rate-reads.ts'));
ok(HANDLER.length > 5000 && RR.length > 500 && DATA.length > 2000, '2a the handler, the shared reader and the data layer are read (positive control)', [HANDLER.length, RR.length, DATA.length]);
ok(/rateClaim: \(userId: string\) => Promise<RateVerdict>;/.test(HANDLER) && /rateClaim: rate\.claim,/.test(DATA) && /makeRateReads\(rpc\)/.test(DATA), '2b the handler\'s Deps names the claim and the real data layer wires it to the shared reader');
const claimAt = HANDLER.indexOf('deps.rateClaim(');
const geoAt = HANDLER.indexOf('deps.geocode(');
const labelAt = HANDLER.indexOf("detail: 'label'");
const completeAt = HANDLER.indexOf("error: 'allotment_complete'");
const keyAt = HANDLER.indexOf("detail: 'idempotency_key'");
ok(claimAt > 0 && geoAt > 0 && labelAt > 0 && completeAt > 0 && keyAt > 0 && HANDLER.split('deps.rateClaim(').length === 2, '2c the handler claims exactly once (positive control: every anchor below was found)', [claimAt, geoAt, labelAt, completeAt, keyAt]);
ok(claimAt > labelAt && claimAt > keyAt && claimAt > completeAt && claimAt < geoAt, '2d and it does so AFTER every validation and both entitlement refusals, and BEFORE the geocoder: an invalid or spent request consumes nothing, and a limited one costs the geocoder nothing');
ok(/if \(trial\) \{\s*const verdict = await deps\.rateClaim\(trial\.userId\);/.test(HANDLER), '2e the claim is made only for a signed-in member, with the member\'s auth user id (never an email, an address or the key)');
const listAt = HANDLER.indexOf("b.action !== undefined");
const listEnd = HANDLER.indexOf('// a trial whose 10 free reports') >= 0 ? HANDLER.indexOf('// a trial whose 10 free reports') : HANDLER.indexOf("if (trial && trial.complete && !paid)");
ok(listAt > 0 && listEnd > listAt && claimAt > listEnd && !HANDLER.slice(listAt, listEnd).includes('rateClaim'), '2f the list and open actions (reads of what is stored) are decided before the claim and never make one');
const refusal = HANDLER.slice(claimAt, claimAt + 700);
ok(/reply\(req, \{\s*error: 'rate_limited', retry_after_seconds: verdict\.retryAfterSeconds, limited_by: verdict\.limitedBy, \.\.\.trialInfo,\s*\}, 429\)/.test(refusal) && /\.headers\.set\('Retry-After', String\(verdict\.retryAfterSeconds\)\)/.test(refusal),
  '2g a full window answers 429 rate_limited with the wait in the body and in Retry-After, and the trial and plan figures the page keeps showing', refusal.slice(0, 260));
ok(!/creditDecision|issue\(|geocode|brokerage_id|address/.test(refusal.slice(0, refusal.indexOf('const g =') > 0 ? refusal.indexOf('const g =') : 400).replace(/limited/g, '')),
  '2h and the refusal path names no credit decision, no issue call, no geocode and no address');
ok(/catch \(e\) \{[\s\S]*?DataUnavailable\) return reply\(req, \{ error: 'data_unavailable' \}, 502\)/.test(HANDLER) && claimAt > HANDLER.indexOf('try {', labelAt), '2i the claim is inside the handler\'s try, so a claim that cannot be made is a 502 data_unavailable and nothing after it runs (fails closed)');
ok(/rpc\('report_rate_claim', \{ p_user: userId \}\)/.test(RR) && !/report_rate_claim_at/.test(RR) && !/report_rate_window/.test(RR) && !/report_rate_limits/.test(RR),
  '2j the shared reader calls the wrapper with p_user only: never the clocked variant (the edge cannot choose the time), never the table, never the limits');
ok(!/\b(10|30|60|200|1000|3600|86400)\b\s*[,)\]]?\s*(requests|per|max)/i.test(RR) && !/max_requests|MAX_REQUESTS/.test(RR + HANDLER + DATA),
  '2k no number of the limit is written in the edge: the database\'s report_rate_limits() is the ONE definition (a second copy would drift)');
ok(/throw new DataUnavailable\('shape'\)/.test(RR) && (RR.match(/throw new DataUnavailable/g) || []).length >= 6 && /if \(!UUID\.test\(userId\)\) throw new DataUnavailable/.test(RR), '2l the reader throws DataUnavailable on an error, a shape it does not recognise and an id that is not a uuid, and never returns "allowed" by default');
ok(!/\bcatch\b[^{]*\{[^}]*allowed: true/.test(RR) && !/\.catch\(/.test(RR), '2m and it has no catch that turns a failure into "allowed"');

// no other file reaches the counters
function walk(dir, out = []) {
  for (const f of readdirSync(join(ROOT, dir))) {
    if (f === 'node_modules' || f === '.git') continue;
    const rel = dir ? dir + '/' + f : f;
    const st = statSync(join(ROOT, rel));
    if (st.isDirectory()) walk(rel, out); else out.push(rel);
  }
  return out;
}
const edgeFiles = walk('supabase/functions').filter((f) => /\.(ts|js|mjs)$/.test(f));
const pageFiles = readdirSync(ROOT).filter((f) => /\.(html|js)$/.test(f)).concat(walk('lib').filter((f) => /\.js$/.test(f)));
const touching = (re) => [...edgeFiles, ...pageFiles].filter((f) => re.test(stripJs(read(f))));
ok(edgeFiles.length > 30 && pageFiles.length > 10, '2n (control) the scan covers every edge file and every page and library', [edgeFiles.length, pageFiles.length]);
ok(JSON.stringify(touching(/report_rate_window/)) === '[]' && JSON.stringify(touching(/report_rate_claim_at/)) === '[]' && JSON.stringify(touching(/report_rate_limits|report_rate_check/)) === '[]',
  '2o no edge function, page or library names the counter table, the clocked claim, the limits or the audit: the claim wrapper is the only way in', touching(/report_rate_/));
ok(JSON.stringify(touching(/report_rate_claim\b/)) === '["supabase/functions/_shared/rate-reads.ts"]', '2p and exactly one file names the claim wrapper: the shared reader', touching(/report_rate_claim\b/));
ok(JSON.stringify(touching(/\brateClaim\b/).sort()) === '["supabase/functions/get-development-activity-report/data.ts","supabase/functions/get-development-activity-report/handler.ts"]',
  '2q only the report function claims: no other function (the Watch, share links, saved reports, billing, the trial) calls the limiter, which the record states as not covered', touching(/\brateClaim\b/));

// ---- 3. the credit path does not know about it ------------------------------------------------------------------------------------------------------------------
const CREDIT_FILES = ['supabase/functions/_shared/credit-rule.ts', 'supabase/functions/_shared/report-snapshot.ts', 'supabase/functions/_shared/evaluation-reads.ts', 'supabase/functions/_shared/billing-reads.ts',
  'docs/evaluation-entitlement.sql', 'docs/brokerage-billing.sql', 'docs/report-snapshot.sql', 'docs/saved-reports.sql'];
ok(CREDIT_FILES.every((f) => read(f).length > 500), '3a (control) every file of the credit path is read', CREDIT_FILES.filter((f) => read(f).length <= 500));
ok(CREDIT_FILES.every((f) => !/report_rate|rateClaim|rate_limited/.test(/\.sql$/.test(f) ? stripSql(read(f)) : stripJs(read(f)))), '3b none of them names the limiter: the credit ledgers and their 20 and 100 are decided without it, and cannot be changed by it');
ok(/report_rate/.test(SQL) && /report_rate/.test(RR), '3c (control) the same scan finds the limiter where it is');

// ---- 4. the page -------------------------------------------------------------------------------------------------------------------------------------------------
const PAGE = read('development-activity-reports.html');
const mf = /function messageFor\(httpStatus, body\)\{([\s\S]*?)\n  \}/.exec(PAGE);
// the 429 branch alone: the other branches say "This did not use ..." too, so a scan of the whole function would pass for the wrong reason
const branch = mf && /if \(httpStatus === 429 && body\.error === 'rate_limited'\) \{([\s\S]*?)\n    \}/.exec(mf[1]);
const said = branch ? branch[1] : '';
ok(!!branch && /Try again in ' \+ waitWords\(body\.retry_after_seconds\) \+ '\./.test(said) && /This did not use ' \+ oneOf\(\) \+ '\./.test(said) && /Your brokerage has asked for a lot of reports in a short time\./.test(said) && /You have asked for a lot of reports in a short time\./.test(said),
  '4a the customer page turns a 429 rate_limited into plain words, with the wait, whose ceiling it was, and says it did not use a report (checked on that branch alone)', said.slice(0, 200));
ok(!!branch && mf[1].indexOf('httpStatus === 429') < mf[1].indexOf('httpStatus === 403') && !/\b429\b|rate_limited|body\.error|retry_after|limited_by/.test(said.replace("body.limited_by === 'brokerage'", '').replace('body.retry_after_seconds', '')),
  '4b it is decided before the general 403 text, and no status code, error code or field name is part of what is shown to the person');
ok(/function waitWords\(n\)/.test(PAGE) && !/development-activity-review\.html/.test(PAGE), '4c the wait is worded by the page from the number of seconds the function sent');
ok(!/rate_limited|waitWords/.test(read('development-activity-review.html')), '4d the admin review page does not carry it: an admin is not limited');

// ---- 5. the record -------------------------------------------------------------------------------------------------------------------------------------------------
const WF = stripYml(read('.github/workflows/report-snapshot-suite.yml'));
const job = (/\n  report-rate-limit:\n([\s\S]*?)(?=\n  [a-z-]+:\n|$)/.exec(WF) || [, ''])[1];
ok(job.length > 500 && /bash test\/report_rate_limit_pg\/run\.sh/.test(job) && /bash test\/report_rate_limit_pg\/mutate_all\.sh/.test(job) && /image: postgres:17/.test(job) && /POSTGRES_DB: dev_change_disposable/.test(job),
  '5a CI runs the rate limit\'s database suite AND its mutation loop in their own job, against the disposable container', job.length);
ok(/SUPABASE_DB_URL/.test(job) && /exit 1/.test(job) && !/\$\{\{\s*secrets\./.test(job), '5b the job refuses to run with a Supabase credential present and takes no repository secret');
const pr = (/\n  pull_request:\n([\s\S]*?)\n  push:/.exec(WF) || [, ''])[1], push = (/\n  push:\n([\s\S]*?)\n  workflow_dispatch/.exec(WF) || [, ''])[1];
const PATHS = ['docs/report-rate-limit.sql', 'test/report_rate_limit_pg/**', 'test/report-rate-limit-structure.test.mjs', 'test/report-rate-limit-function.test.mjs', 'supabase/functions/_shared/rate-reads.ts'];
ok(PATHS.every((p) => pr.includes("'" + p + "'") && push.includes("'" + p + "'")), '5c it runs on a pull request and on main whenever the SQL, its suites or the shared reader change', PATHS.filter((p) => !pr.includes("'" + p + "'") || !push.includes("'" + p + "'")));
ok(['test/report_rate_limit_pg/mutate.py', 'test/report_rate_limit_pg/mutate_all.sh', 'test/report_rate_limit_mutants.py'].every((f) => existsSync(join(ROOT, f))), '5d the mutation loops are committed: the database half and the edge half');
const MUT = read('test/report_rate_limit_pg/mutate.py');
ok((MUT.match(/^    "[a-z_]+": \(/gm) || []).length >= 25, '5e the database loop carries at least 25 prohibited mutations', (MUT.match(/^    "[a-z_]+": \(/gm) || []).length);
const DOC = read('docs/development-activity-launch-gate-2026-10-04.md');
ok(/D-RL-1/.test(DOC) && /Anti-abuse audit/.test(DOC), '5f the launch record carries the anti-abuse audit and the decision on the numbers (D-RL-1)');
ok(/NOT COVERED|not covered/.test(DOC) && /saved-report/i.test(DOC) && /checkout/i.test(DOC) && /public client link/i.test(DOC), '5g and it says plainly what the limit does NOT cover (reads, the checkout request, the public client link, trial creation)');

console.log('\n' + (n - bad) + ' passed, ' + bad + ' failed of ' + n);
process.exit(bad ? 1 : 0);
