// A CI push must never become the head of an open PR.
//
// A push made with a workflow's GITHUB_TOKEN starts no other workflows, so a bot commit on a
// branch with an open PR leaves that PR with no checks on its head. homesignal-ingest hit it
// on #407 and #714 and added scripts/guard_bot_push.sh (homesignal-ingest #720); this repo
// carries the same script. This test pins what it answers (against a fake `curl`) and that
// every workflow step that pushes asks it first.
//
// Run: node test/bot-push-guard.test.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const GUARD = path.join(root, 'scripts', 'guard_bot_push.sh');
const dir = path.join(root, '.github', 'workflows');

let fails = 0;
const ok = (c, name) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name); if (!c) fails++; };

function runGuard(branch, { body = '', curlRc = 0, token = 't', repo = 'HomeSignalG/homesignal-site', event } = {}) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-'));
  const log = path.join(d, 'calls');
  fs.writeFileSync(path.join(d, 'body'), body);
  fs.writeFileSync(path.join(d, 'curl'),
    `#!/usr/bin/env bash\necho "$@" >> ${log}\ncat ${path.join(d, 'body')}\nexit ${curlRc}\n`, { mode: 0o755 });
  const env = { PATH: d + path.delimiter + process.env.PATH };
  if (token !== null) env.GH_TOKEN = token;
  if (repo !== null) env.GITHUB_REPOSITORY = repo;
  if (event) env.GITHUB_EVENT_NAME = event;
  const p = spawnSync('bash', [GUARD, branch], { env, encoding: 'utf8' });
  const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : [];
  fs.rmSync(d, { recursive: true, force: true });
  return { rc: p.status, out: (p.stdout || '') + (p.stderr || ''), calls };
}

// 1. What the guard answers.
let r = runGuard('main', { token: null, repo: null });
ok(r.rc === 0 && r.calls.length === 0, 'main is always safe and asks GitHub nothing');
r = runGuard('claude/x', { body: '[{"number": 2062}]' });
ok(r.rc === 3 && r.out.includes('#2062'), 'an open PR on the branch refuses (3) and names it');
ok(r.calls.length === 1 && r.calls[0].includes('head=HomeSignalG:claude/x') && r.calls[0].includes('state=open'),
  'it asks for open PRs whose head is this branch');
ok(runGuard('claude/x', { body: '[{"number": 2062}]', event: 'push' }).rc === 4,
  'the same refusal on a push-started run is 4 (step ends green, nothing pushed)');
ok(runGuard('claude/x', { body: '[]' }).rc === 0, 'no open PR is safe');
ok(runGuard('claude/x', { curlRc: 22 }).rc === 1, 'an HTTP error is unsafe, never "no PR"');
ok(runGuard('claude/x', { body: '{"message":"Bad"}' }).rc === 1, 'a non-list answer is unsafe');
ok(runGuard('claude/x', { body: '[]', token: null }).rc === 1, 'no token is unsafe');

// 2. The call shape every workflow uses: push only on 0, fail only on 1/3.
const SHAPE = '|| { [ $? -eq 4 ] && exit 0; exit 1; }';
for (const [rc, wantExit, pushed] of [[0, 0, true], [3, 1, false], [4, 0, false], [1, 1, false]]) {
  const p = spawnSync('bash', ['-c', `bash -c "exit ${rc}" ${SHAPE}; echo PUSHED`], { encoding: 'utf8' });
  ok(p.status === wantExit && p.stdout.includes('PUSHED') === pushed, `call shape on guard exit ${rc}`);
}

// 3. Every workflow step that pushes calls the guard before its first push.
const files = fs.readdirSync(dir).filter(f => /\.ya?ml$/.test(f)).sort();
let pushingSteps = 0;
const bad = [];
for (const f of files) {
  const lines = fs.readFileSync(path.join(dir, f), 'utf8').split('\n');
  let stepStart = 0;
  let guarded = false;
  let sawPushInStep = false;
  let hasPush = false;
  lines.forEach((l, i) => {
    const s = l.trim();
    if (/^-\s+(name|uses|run):/.test(s)) { stepStart = i; guarded = false; sawPushInStep = false; }
    if (s.startsWith('#')) return;
    if (s.includes('scripts/guard_bot_push.sh') && s.includes('GH_TOKEN=') && s.endsWith(SHAPE)) guarded = true;
    if (/\bgit push\b/.test(s)) {
      hasPush = true;
      if (!sawPushInStep) { pushingSteps++; sawPushInStep = true; }
      if (!guarded) bad.push(`${f}:${i + 1}`);
    }
  });
  if (hasPush && !/^\s+pull-requests:\s*(read|write)/m.test(lines.join('\n'))) bad.push(`${f}: no pull-requests permission`);
}
// Floor 6 -> 4 on 2026-10-22 (founder, "remove deploy key"): sitemap.yml was deleted and
// source-monitor.yml stopped pushing, the two pushes to main. The 4 left push to feature or
// scratch branches (fetch-tabs-fixtures, gen-gov-notice-coverage, verify-dev-tracker,
// verify-maps-live); test/no-deploy-key-push.test.mjs keeps every one of them off main.
ok(pushingSteps >= 4, `control: pushing workflow steps were found (${pushingSteps})`);
ok(bad.length === 0, 'every push is preceded in its step by the guard' + (bad.length ? ': ' + bad.join(', ') : ''));

if (fails) { console.log(`\n${fails} FAILED`); process.exit(1); }
console.log('\nALL PASS');
