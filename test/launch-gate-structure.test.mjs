// THE LAUNCH GATE — the structural half (Development Activity build step 13). The executable half is test/launch_gate_pg: the plan's own sequence
// (sign-up, 20 free reports, the end of the trial, checkout, payment, a 100-report month) as ONE scenario through the real handlers and the shipped SQL.
// What it cannot see is whether it is still that: a gate that quietly stops standing on the real layers, that is answered by a stand-in for the thing it is
// meant to test, that no longer runs in CI, or that has been made to hold a real credential would go on printing PASS. Pinned here, on COMMENT-STRIPPED
// text and each with a positive control so a scan that matched nothing cannot pass:
//   * the setup: refuses a database not named disposable and any credential, and applies EVERY layer the product stands on, in production order;
//   * the round trip: imports the four REAL handlers and data layers (never a copy), answers the database only through an ALLOWLIST of functions that
//     does not include the free evaluation's own issue function, reads no environment variable, and reaches no host but the processor's stand-in;
//   * the scenario: the numbers the plan names (20, 100, 120, the 21st and the 101st refused) and each rule the founder's sequence rests on are asserted;
//   * the wiring: it runs in CI in its own job, on node 22, against the disposable container, on every path it stands on;
//   * the record: it says plainly what the gate does NOT prove, and the landing page's buttons are still inert.
// Run: node test/launch-gate-structure.test.mjs
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

let n = 0, bad = 0;
const ok = (c, m, d) => { n++; if (c) console.log('PASS — ' + m); else { bad++; console.log('FAIL — ' + m + (d !== undefined ? '  [' + d + ']' : '')); } };
const ROOT = new URL('..', import.meta.url).pathname;
const read = (f) => (existsSync(join(ROOT, f)) ? readFileSync(join(ROOT, f), 'utf8') : '');
const stripJs = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
const stripSh = (s) => s.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
const stripYml = (s) => s.split('\n').map((l) => l.replace(/^(\s*)#.*$/, '$1')).join('\n');
const count = (s, re) => (s.match(re) || []).length;

// ---- 1. the setup script --------------------------------------------------------------------------------------------------------------------
const RUN = stripSh(read('test/launch_gate_pg/run.sh'));
const LAYERS = ['brokerage-account-spine', 'report-private-context', 'report-snapshot', 'evaluation-entitlement', 'saved-reports', 'report-share', 'report-share-delivery',
  'property-watch', 'payment-event-ledger', 'report-header', 'brokerage-billing', 'report-rate-limit'];
const applied = (/for f in ([^;]+); do/.exec(RUN) || [, ''])[1].trim().split(/\s+/);
ok(RUN.length > 400 && applied.length > 5, '1a the setup script is read and lists the layers it applies (positive control)', applied.length);
ok(JSON.stringify(applied) === JSON.stringify(LAYERS), '1b it applies exactly the twelve layers the product stands on, in the order production applied them (the billing file, then the report rate limit)', applied.join(','));
ok(/case "\$PGDATABASE" in \*disposable\*\)/.test(RUN) && /exit 1/.test(RUN) && /SUPABASE_DB_URL/.test(RUN) && /SUPABASE_ACCESS_TOKEN/.test(RUN) && /SUPABASE_WRITE_KEY/.test(RUN),
  '1c it refuses a database not named disposable and refuses to run when any Supabase credential is present');
ok(LAYERS.every((f) => existsSync(join(ROOT, 'docs', f + '.sql'))) && existsSync(join(ROOT, 'test/evaluation_entitlement_pg/fixture.sql')), '1d every layer it applies, and the roles fixture, exist');
ok(/exec node "\$here\/roundtrip\.mjs"/.test(RUN) && /set -euo pipefail/.test(RUN), '1e and it hands over to the round trip, failing on any error');
// the trial suite and this gate must agree on what the product stands on: every layer the trial suite applies is applied here too
const TRIAL = stripSh(read('test/trial_report_pg/run.sh'));
const trialApplied = ['report-share', 'report-share-delivery', 'property-watch', 'payment-event-ledger', 'report-header', 'brokerage-billing'];
ok(trialApplied.every((f) => RUN.includes(f) && TRIAL.includes(f)), '1f every later layer the trial suite stands on is applied here too, so the two cannot disagree about the product');

// ---- 2. the round trip ----------------------------------------------------------------------------------------------------------------------
const RTRAW = read('test/launch_gate_pg/roundtrip.mjs');
const RT = stripJs(RTRAW);
const importsOf = [...RT.matchAll(/await import\('([^']+)'\)/g)].map((m) => m[1]);
const WANT = ['get-development-activity-report/handler.ts', 'get-development-activity-report/data.ts', 'development-activity-trial/handler.ts', 'development-activity-trial/data.ts',
  'manage-billing/handler.ts', 'manage-billing/data.ts', 'development-activity-billing-webhook/handler.ts', 'development-activity-billing-webhook/data.ts', '_shared/lemon-billing.ts']
  .map((f) => '../../supabase/functions/' + f);
ok(RT.length > 8000 && importsOf.length >= WANT.length, '2a the round trip is read and imports modules (positive control)', importsOf.length);
ok(WANT.every((f) => importsOf.includes(f)) && WANT.every((f) => existsSync(join(ROOT, 'test/launch_gate_pg', f))),
  '2b it imports the REAL handler and data layer of all four functions, and the real processor module: the gate drives the shipped code, not a copy');
ok(importsOf.every((f) => f.startsWith('../../supabase/functions/')), '2c and imports nothing else: no helper that could stand in for a layer');
const rpcBlock = (/const RPC = \{([\s\S]*?)\n\};/.exec(RT) || [, ''])[1];
const rpcNames = [...rpcBlock.matchAll(/^\s{2}(\w+): \(a\) =>/gm)].map((m) => m[1]);
ok(rpcNames.length >= 10 && ['brokerage_report_issue', 'billing_usage', 'billing_event_apply', 'evaluation_usage', 'evaluation_reports_of', 'evaluation_report_open'].every((f) => rpcNames.includes(f)),
  '2d the database allowlist names the plan read, the ONE issue function, the webhook\'s one writer and the saved-report reads', rpcNames.join(','));
ok(!rpcNames.includes('evaluation_report_issue') && !/public\.evaluation_report_issue\(/.test(rpcBlock),
  '2e and does NOT answer the free evaluation\'s own issue function: a handler calling it directly would be a second way to charge a report, and an unlisted call stops the run');
ok(/if \(!RPC\[rpc\[1\]\]\) throw new Error\('unexpected rpc '/.test(RT) && /throw new Error\('unexpected request '/.test(RT), '2f a call to a function that is not listed, or any other request, stops the run');
ok(!/process\.env|Deno\.env/.test(RT) && !/SUPABASE_[A-Z_]*KEY|LEMON_SQUEEZY_[A-Z_]+/.test(RT), '2g it reads no environment variable and names no real secret: every key and secret in it is a fixture');
const fixtures = [...RT.matchAll(/(apiKey|secret|serviceKey): '([^']+)'/g)].map((m) => m[2]);
ok(fixtures.length >= 3 && fixtures.every((v) => /fixture|not-real/.test(v)), '2h every key and secret value in it is plainly marked as a fixture', fixtures.join(' | '));
const hosts = new Set([...RT.matchAll(/https?:\/\/([a-z0-9.-]+)/g)].map((m) => m[1]));
const allowedHosts = ['proj.supabase.co', 'x', 'homesignal.net', 'api.lemonsqueezy.com', 'fixture-store.lemonsqueezy.com', 'data.wsdot.wa.gov'];
ok([...hosts].every((h) => allowedHosts.includes(h)), '2i it names no host but the fixture project, the processor and its stand-in\'s own domain', [...hosts].join(','));
ok(/u\.origin === 'https:\/\/api\.lemonsqueezy\.com'\) return lemonStandIn\(/.test(RT) && !/\bawait fetch\(|globalThis\.fetch|node:https?|node:net/.test(RT),
  '2j the payment processor is answered by a stand-in that records the request, and the round trip opens no connection of its own');

// ---- 3. the scenario ------------------------------------------------------------------------------------------------------------------------
const LABELS = (RTRAW.match(/'(\d+[a-z]?\d?) /g) || []).map((x) => x.slice(1, -1));
ok(LABELS.length >= 60, '3a the scenario asserts at least sixty named checks (positive control)', LABELS.length);
const must = {
  '3b': /twentieth report[^']*ends the trial/, '4a': /21st report is refused \(403 evaluation_complete\) and the issue function is never asked/, '5a': /agent cannot start a checkout/,
  '5g': /checkout names THIS brokerage with a signature/, '6c': /test payment lets no report through/, '7a': /event with no signature is refused/, '7e': /binding cannot be borrowed/,
  '8b': /retrying the same delivery is a duplicate/, '8e': /nobody is billed twice/, '9c': /one hundred paid reports/, '9e': /ordinals 1 to 100 with no gap, and the reports are numbered 21 to 120/,
  '10a': /101st report is refused \(403 allotment_complete\)/, '10b': /the DATABASE refuses the 101st/, '10c': /the cap is a CONSTRAINT/, '11a': /all 120 reports/,
  '11d': /other brokerage sees none of them/, '12c': /binding_conflict/, '13b': /plan reads "canceled"/, '13d': /nothing was deleted/, '13e': /OLDER event arriving late/,
  '2d': /CARRY a plan/, '7h2': /payment notice/,
  '14a': /every billing invariant reads zero/, '14b': /controls that are not zero/, '14d': /NO table of the public schema/,
};
for (const [id, re] of Object.entries(must)) ok(new RegExp("'" + id + ' ').test(RTRAW) && re.test(RTRAW), '3c check ' + id + ' is present and says what the sequence needs');
ok(/for \(let i = 2; i <= 20; i\+\+\)/.test(RT) && /for \(let i = 22; i <= 120; i\+\+\)/.test(RT) && /made === 100/.test(RT) && /count\('report_snapshot'\) === 120/.test(RT),
  '3d the loops are the plan\'s numbers: reports 1-20 free, 21-120 paid, one hundred made, 120 stored');
ok(/credits_remaining === 0/.test(RT) && /allotment_complete/.test(RT) && /evaluation_complete/.test(RT), '3e and both refusals (the spent trial, the spent month) are asserted');
ok(/process\.exit\(bad \? 1 : 0\)/.test(RT) && /\(n - bad\) \+ ' passed, '/.test(RT), '3f the run exits non-zero on any failed check and prints its own summary');
ok(/process\.on\('uncaughtException'/.test(RT) && /FAIL — the scenario stopped: /.test(RTRAW), '3g a check that throws still ends as a named failure with the summary, never a bare stack trace');

// ---- 4. the wiring --------------------------------------------------------------------------------------------------------------------------
const WF = stripYml(read('.github/workflows/report-snapshot-suite.yml'));
const job = (/\n  launch-gate:\n([\s\S]*?)(?=\n  [a-z][a-z-]*:\n|$)/.exec(WF) || [, ''])[1];
ok(job.length > 500, '4a the workflow has a launch-gate job (positive control)', job.length);
ok(/bash test\/launch_gate_pg\/run\.sh/.test(job) && /POSTGRES_DB: dev_change_disposable/.test(job) && /node-version: '22'/.test(job) && /image: postgres:17/.test(job),
  '4b it runs the gate against the disposable container on node 22');
ok(/SUPABASE_DB_URL/.test(job) && /LEMON_SQUEEZY_API_KEY/.test(job) && /exit 1/.test(job) && !/\$\{\{\s*secrets\./.test(job), '4c it refuses to run with a Supabase credential or a processor key present, and takes no repository secret');
const pr = (/\n  pull_request:\n([\s\S]*?)\n  push:/.exec(WF) || [, ''])[1], push = (/\n  push:\n([\s\S]*?)\n  workflow_dispatch/.exec(WF) || [, ''])[1];
ok(['test/launch_gate_pg/**', 'test/launch-gate-structure.test.mjs', 'docs/brokerage-billing.sql', 'supabase/functions/manage-billing/**', 'supabase/functions/development-activity-billing-webhook/**',
    'supabase/functions/get-development-activity-report/**', 'supabase/functions/development-activity-trial/**', 'supabase/functions/_shared/lemon-billing.ts', 'supabase/functions/_shared/report-snapshot.ts']
  .every((p) => pr.includes("'" + p + "'") && push.includes("'" + p + "'")), '4d it runs on a pull request and on main whenever the gate, a handler it drives or the billing SQL changes');
ok(count(read('.github/workflows/report-snapshot-suite.yml'), /launch_gate_pg/g) >= 4, '4e (control) the workflow names the gate in its path lists and its job');
ok(existsSync(join(ROOT, 'test/launch_gate_mutants.py')), '4f the mutation loop that proves the gate can see a break is committed');
const MUT = read('test/launch_gate_mutants.py');
const mutNames = [...MUT.matchAll(/^mm?\('([a-z_]+)'/gm)].map((x) => x[1]);
ok(mutNames.length >= 25 && new Set(mutNames).size === mutNames.length, '4g it carries at least twenty-five named, distinct mutations of the path', mutNames.length);
ok(/UNMUTATED copy runs first as the positive control/.test(MUT) && /is NOT a kill/.test(MUT) && /never edited|nothing in the working tree is ever edited/.test(MUT), '4h it runs an unmutated control first, does not count a crash as a kill, and never edits the working tree');

// ---- 5. the record, and what the gate does not prove ----------------------------------------------------------------------------------------
const DOC = read('docs/development-activity-launch-gate-2026-10-04.md');
ok(DOC.length > 3000, '5a the written record exists (positive control)', DOC.length);
ok(/NOT LIVE/.test(DOC) && /stand-in/i.test(DOC) && /(ever|never) reached Lemon Squeezy/i.test(DOC) && /No payment has been made|no payment has been made/.test(DOC),
  '5b it says plainly that the buttons are not live, the processor was a stand-in, and no payment has been made');
ok(/field names/i.test(DOC) && /test payment/i.test(DOC) && /clearance|cleared/i.test(DOC) && /Start with 20 free reports/.test(DOC), '5c it lists what is still owed: the processor\'s field names, the founder\'s test payment, a cleared source, and what the Start button does');
const CHECKLIST = read('docs/development-activity-build-steps-100526.md');
const step13 = (/\*\*End-to-end launch test[\s\S]*?(?=\n\n|\n- |\n##)/.exec(CHECKLIST) || [''])[0];
ok(step13.length > 100 && !/^~~\*\*End-to-end/m.test(CHECKLIST), '5d step 13 is in the checklist and is NOT struck: the buttons are not live');
const LAND = read('development-activity.html');
const commerce = LAND.match(/<div[^>]*(?:checkout|billing|commerce|buy)[^>]*>/gi) || [];
ok(LAND.length > 1000 && (commerce.length === 0 || commerce.every((t) => /\bhidden\b|display:\s*none|inert/.test(t))), '5e the landing page\'s commerce buttons are still hidden or inert', commerce.join(' | ').slice(0, 200));
ok(!existsSync(join(ROOT, 'supabase/functions/lemonsqueezy-webhook')), '5f the map product\'s own webhook is not in this repo and is not touched');

// ---- 6. the report rate limit's section 15 (added 2026-10-04) ----------------------------------------------------------------------------------------------------
// The original scenario is sections 1-14 and MUST stay exactly what it was; the rate limit is a new trailing section. Pinned by counting check call sites on either side
// of the section-15 marker, with a positive control that the marker was found and that section 15 has checks of its own.
const S15 = RTRAW.indexOf('// ---- 15. THE REPORT RATE LIMIT');
const checksIn = (t) => (stripJs(t).match(/(^|[^\w.])ok\(/g) || []).length;
ok(S15 > 0 && checksIn(RTRAW.slice(S15)) === 13, '6a (control) section 15 is found and carries 13 checks of its own', [S15, S15 > 0 && checksIn(RTRAW.slice(S15))]);
ok(S15 > 0 && checksIn(RTRAW.slice(0, S15)) === 73, '6b the original scenario, sections 1-14, is still exactly 73 checks: none was removed, merged or weakened to make room', S15 > 0 && checksIn(RTRAW.slice(0, S15)));
ok(/report_rate_claim: \(a\) => \[asJson\("public\.report_rate_claim\(:'u'::uuid\)"\)/.test(RT) && !/report_rate_claim_at/.test(RT), '6c the round trip lets the handler reach the claim WRAPPER only: the clocked variant is not on the allowlist');
ok(/async function ask\(userId, body, \{ limited = false \} = \{\}\) \{\s*if \(!limited\) one\('truncate public\.report_rate_window'\);/.test(RT), '6d sections 1-14 clear the limiter\'s counters before each request (they test the entitlement, far above the ceiling by design), and the clearing is opt-out');
const after15 = stripJs(RTRAW.slice(S15));
ok(S15 > 0 && (after15.match(/\{ limited: true \}/g) || []).length >= 7 && (after15.match(/truncate public\.report_rate_window/g) || []).length === 1,
  '6e section 15 asks WITHOUT the reset (limited: true on its requests) and clears the counters exactly once, at its start');
ok(/geocodeCalls/.test(RT) && /geocodeCalls - geoBefore === allowedBurst\.length/.test(RT), '6f it counts the geocoder\'s calls, so "a refused request never reaches the geocoder" is measured and not assumed');
ok(['docs/report-rate-limit.sql', 'test/report_rate_limit_pg/**', 'supabase/functions/_shared/rate-reads.ts'].every((p) => pr.includes("'" + p + "'") && push.includes("'" + p + "'")), '6g and the gate runs when the rate limit\'s SQL, its suites or its shared reader change');

console.log('\n' + (n - bad) + ' passed, ' + bad + ' failed of ' + n);
process.exit(bad ? 1 : 0);
