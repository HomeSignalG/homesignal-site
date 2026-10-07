// Ordering and wiring of the IndexNow publication in .github/workflows/pages.yml.
//
// The behaviour is proven elsewhere (indexnow-delta, indexnow-submit). This file pins what only
// the workflow can get wrong, none of which would be visible at runtime if it broke:
//   Y  the baseline is captured BEFORE the build, never after the deploy
//   W  notification is its own job, after `deploy`, and the deploy depends on nothing IndexNow
//   X  an absent secret cannot reach the build; the key is only ever passed on main
//   +  indexnow.txt is the ONLY new permitted root artifact
//   +  a freshness run cannot skip the deploy of a commit that is not live yet
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const WF = readFileSync(join(root, '.github', 'workflows', 'pages.yml'), 'utf8');
const RS = readFileSync(join(root, '.github', 'workflows', 'indexnow-resubmit.yml'), 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('PASS —', m); } else { fail++; console.error('FAIL —', m); } };
const code = (t) => t.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
const WFC = code(WF);

// job slices
const idx = (re, t = WFC) => { const m = t.match(re); return m ? m.index : -1; };
const iBuild = idx(/^  build:/m), iDeploy = idx(/^  deploy:/m), iNotify = idx(/^  indexnow:/m);
ok(iBuild > 0 && iDeploy > iBuild && iNotify > iDeploy, 'W0 the jobs are build, deploy, indexnow in that order');
const BUILD = WFC.slice(iBuild, iDeploy), DEPLOY = WFC.slice(iDeploy, iNotify), NOTIFY = WFC.slice(iNotify);

// ---- Y: baseline before the build
const at = (re) => idx(re, BUILD);
const iBase = at(/page_semantics\.py fetch-baseline/), iGen = at(/gen_zip_pages\.py --out _site/);
const iDecide = at(/page_semantics\.py decide/), iUpload = at(/upload-pages-artifact/);
ok(iBase > 0 && iBase < iGen,
   'Y  the previous LIVE page state is captured before the build generates anything');
ok(iBase > 0 && iGen > iBase && iDecide > iGen && iUpload > iDecide, 'Y1 order: baseline -> generate -> decide -> upload');
ok(/--baseline "\$RUNNER_TEMP\/baseline-page-state\.json"/.test(BUILD) && /--delta-out/.test(BUILD),
   'Y2 the generator is handed the captured baseline and writes the delta');
ok((WFC.match(/fetch-baseline/g) || []).length === 1 && !/fetch-baseline/.test(DEPLOY + NOTIFY),
   'Y3 the baseline is read exactly once, in the build job, never after the deployment');
ok(!/gen_zip_pages|fetch-baseline/.test(NOTIFY), 'Y5 the notify job does not rebuild or re-read the baseline: it sends the precomputed set');

// ---- W: deploy first, notify second
ok(/needs:\s*\[build, deploy\]/.test(NOTIFY) && /needs\.deploy\.result == 'success'/.test(NOTIFY),
   'W  the indexnow job needs `deploy` and runs only if it SUCCEEDED');
ok(!/indexnow/i.test(DEPLOY.replace(/needs\.build\.outputs\.proceed/g, '')) && /needs:\s*build\b/.test(DEPLOY),
   'W1 `deploy` knows nothing about IndexNow: a notification failure cannot reach it');
ok(!/needs:.*indexnow/.test(DEPLOY), 'W2 nothing depends on the indexnow job');
ok(/github\.ref == 'refs\/heads\/main'/.test(NOTIFY.split('steps:')[0]) && /github\.event_name != 'pull_request'/.test(NOTIFY.split('steps:')[0]),
   'W3 notifications are main-only and never on a pull_request (the form workflow-secret-exposure accepts)');
ok(/needs\.build\.outputs\.submit_count != '0'/.test(NOTIFY.split('steps:')[0]), 'W4 no URLs, no job');
ok(/needs\.build\.outputs\.proceed == 'true'/.test(DEPLOY.split('steps:')[0]),
   'W5 a freshness run with nothing to publish does not deploy');
ok(!/continue-on-error/.test(NOTIFY), 'W6 the notify job is not allowed to hide its own failure');

// ---- X: the secret
const keyUses = [...WFC.matchAll(/secrets\.INDEXNOW_KEY/g)].map((m) => m.index);
ok(keyUses.length >= 3, `X0 control: the secret is referenced (${keyUses.length} places)`);
const inBuild = keyUses.filter((i) => i < iDeploy);
ok(inBuild.length === 2 && inBuild.every((i) => /github\.ref == 'refs\/heads\/main' && secrets\.INDEXNOW_KEY \|\| ''/.test(WFC.slice(i - 40, i + 30))),
   'X  in the build job the key is passed only when the ref is main (a pull_request build gets an empty value)');
ok(!/INDEXNOW_KEY/.test(DEPLOY), 'X1 the deploy job never sees the secret');
ok(!/echo[^\n]*INDEXNOW|set -x|::add-mask::/.test(WFC), 'X2 nothing in the workflow echoes the key or traces commands');

// ---- the one new root artifact
const gen = WFC.match(/def generated\(p\):\s*return \(p in \(([^)]*)\)/);
ok(gen && eq(gen[1].match(/'[^']+'/g), ["'zip-pages-manifest.json'", "'indexnow.txt'"]),
   'A  the artifact audit permits exactly one new root file: indexnow.txt (beside the existing manifest)');
function eq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
ok(!/\.txt'/.test((WFC.match(/def generated\(p\):[\s\S]*?\n\s*unexpected/) || [''])[0].replace("'indexnow.txt'", '')),
   'A1 no other .txt file and no wildcard was exempted');
ok(/indexnow\.py check-artifact --dir _site/.test(BUILD), 'A2 the artifact is scanned for the key after the build');

// ---- freshness
ok(/- cron: '40 6 \* \* \*'/.test(WFC) && /- cron: '12,42 \* \* \* \*'/.test(WFC), 'R0 the daily cron is unchanged and a half-hourly freshness tick was added');
ok(/github\.event\.schedule != '40 6 \* \* \*'/.test(BUILD), 'R1 only the NEW cron is a freshness run; the daily one still always deploys');
const sha = spawnSync('python3', ['-c', `
import sys, json; sys.path.insert(0, ${JSON.stringify(join(root, 'scripts'))}); import page_semantics as ps
same = {'seed': False, 'baseline_state_hash': 'h', 'candidate_state_hash': 'h', 'baseline_commit': 'abc'}
r = {}
r['no_change_same_commit'] = ps.decide(same, freshness=True, sha='abc')['proceed']
r['no_change_other_commit'] = ps.decide(same, freshness=True, sha='def')['proceed']
r['changed'] = ps.decide({**same, 'candidate_state_hash': 'g'}, freshness=True, sha='abc')['proceed']
r['seed'] = ps.decide({**same, 'seed': True}, freshness=True, sha='abc')['proceed']
r['push_never_skips'] = ps.decide(same, freshness=False, sha='abc')['proceed']
r['reseed_proceeds'] = ps.decide(same, freshness=True, sha='abc', reseed=True)['proceed']
print(json.dumps(r))`], { encoding: 'utf8' });
const d = JSON.parse(sha.stdout.trim().split('\n').pop());
ok(d.no_change_same_commit === false, 'R2 freshness + no semantic change + this commit is live => no deploy, no Playwright, no notification');
ok(d.no_change_other_commit === true,
   'R3 freshness + no semantic change but the live build is another commit => DEPLOY (a freshness run can replace a pending push-build; it must not swallow that deploy)');
ok(d.changed === true && d.seed === true && d.push_never_skips === true && d.reseed_proceeds === true,
   'R4 a changed state, a seed, any non-freshness trigger and a reseed all publish');
const heavy = ['Build gates', 'Artifact contract gate', 'Audit the REAL artifact', 'Offline gates for the generated documents',
  'Candidate crawler proof', 'Install Playwright'];
ok(heavy.every((n) => { const i = BUILD.indexOf(n); return i > 0 && /steps\.decide\.outputs\.proceed == 'true'/.test(BUILD.slice(i, i + 220)); }),
   'R5 every gate and the crawler proof are gated on the decision, never skipped by accident on a publishing run');
ok(/path: _site/.test(BUILD) && /upload-pages-artifact@v3\s*\n\s*if: steps\.decide\.outputs\.proceed == 'true'/.test(BUILD),
   'R6 the Pages artifact is uploaded only when this run publishes');

// ---- recovery workflow
const RSC = code(RS);
ok(/workflow_dispatch:/.test(RSC) && !/\n  (push|schedule|pull_request|workflow_run):/.test(RSC), 'Z0 indexnow-resubmit is dispatch-only');
ok(/github\.ref == 'refs\/heads\/main'/.test(RSC), 'Z1 and main-only');
ok(/--relax-state/.test(RSC) && /run-id: \$\{\{ inputs\.run_id \}\}/.test(RSC), 'Z2 it re-sends the stored delta of ONE earlier run and recomputes nothing');

// ---- Map 1 activation -> Rule D plane (existing authority) -> pages freshness
const N5 = readFileSync(join(root, '.github', 'workflows', 'n5-generation.yml'), 'utf8');
const N5C = code(N5);
const ORCH = readFileSync(join(root, 'scripts', 'n5_orchestrate.py'), 'utf8');
ok(/- name: Orchestrate\s*\n\s*id: orchestrate/.test(N5C), 'N0 the orchestrate step exposes outputs');
const ask = N5C.slice(N5C.indexOf('Ask homesignal-ingest to refresh the Rule D plane'));
ok(/steps\.orchestrate\.outputs\.n5_serving_changed != ''/.test(ask) && /continue-on-error: true/.test(ask),
   'N1 the plane refresh is requested only when the serving generation changed, and can never fail the orchestration');
ok(/refresh-development-seo-plane\.yml\/dispatches/.test(ask) && /"live":"true","publish":"true"/.test(ask),
   'N2 it asks the plane\'s OWN workflow (homesignal-ingest) to refresh: nothing is re-scored here');
ok(/INGEST_DISPATCH_TOKEN:-\}" \]/.test(ask) && /exit 0/.test(ask), 'N3 no token: skip with the reason, exit 0 (the daily refresh still runs)');
ok(!/rule_d|Rule D score|passesMateriality|hasUsableName/.test(code(ORCH).replace(/Rule D/g, '')),
   'N4 the orchestrator duplicates no Rule D scoring');
const fnAct = ORCH.slice(ORCH.indexOf('def activate(gen):'), ORCH.indexOf('def require_reason'));
ok(/announce_serving_change\(gen\)/.test(fnAct), 'N5 activation announces the serving change');
const fnRb = ORCH.slice(ORCH.indexOf('def mode_rollback'), ORCH.indexOf('def mode_fail'));
ok(/announce_serving_change\(gen\)/.test(fnRb), 'N6 a rollback is a serving change too');
ok(fnAct.indexOf('announce_serving_change') > fnAct.indexOf('_verify_state(gen, "ACTIVE")'),
   'N7 it announces only AFTER the database verified the generation is ACTIVE');

// ---- a failed notification self-heals on the next build
const iCarry = at(/indexnow\.py carry-over/);
ok(iCarry > iGen && iCarry < iDecide, 'C0 carry-over runs after the delta is computed and BEFORE the publish decision (a backlog must force a publish)');
ok(/actions: read/.test(BUILD.split('steps:')[0]) && /GH_TOKEN: \$\{\{ github\.token \}\}/.test(BUILD),
   'C1 the build job can read earlier runs (actions: read) with the workflow token, never a PAT');
ok(/- name: Carry over[^\n]*\n\s*if: github\.event_name != 'pull_request'/.test(BUILD), 'C2 not on pull requests');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
