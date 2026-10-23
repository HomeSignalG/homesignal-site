// THE UNIT-TEST RUNNER MUST SAY WHY A FILE FAILED, AT THE END OF THE LOG (scripts/run-unit-tests.mjs).
//
// 2026-10-08: home-index.browser.test.mjs failed in CI three times and cleared by itself. The job
// log tool returns the last 5,000 lines; the failing file's output was ~15,000 lines earlier, and
// the summary named only the file. The reason was unrecoverable, so the flake was never explained.
// The runner now keeps each file's output tail and re-prints it, with a GitHub annotation, at the
// END. This points the runner at a directory of throwaway suites (UNIT_TEST_DIR) and checks it.
//
// Run: node test/run-unit-tests-failure-report.test.mjs
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RUNNER = join(ROOT, 'scripts', 'run-unit-tests.mjs');
let fails = 0;
const ok = (c, name, extra) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name + (!c && extra !== undefined ? '  [' + String(extra).slice(0, 400) + ']' : '')); if (!c) fails++; };

const dir = mkdtempSync(join(tmpdir(), 'hs-runner-'));
const put = (name, body) => writeFileSync(join(dir, name), body);
put('a-good.test.mjs', "console.log('PASS - a good file');\n");
put('b-bad.test.mjs', "console.log('PASS - before'); for (let i = 0; i < 400; i++) console.log('filler line ' + i);\nconsole.log('FAIL - the reason it failed: expected 3 got 4'); process.exit(1);\n");
put('c-good.test.mjs', "console.log('PASS - after the failure the runner keeps going');\n");
put('d-signal.test.mjs', "console.log('about to die'); process.kill(process.pid, 'SIGKILL');\n");
put('e-silent.test.mjs', 'process.exit(2);\n');

const run = (env, args = []) => spawnSync(process.execPath, [RUNNER, ...args], { cwd: ROOT, encoding: 'utf8',
  env: { ...process.env, UNIT_TEST_DIR: dir, GITHUB_ACTIONS: '', ...env } });
try {
  const r = run({});
  const all = r.stdout + r.stderr;
  const endOfLog = all.slice(all.lastIndexOf('test file(s) failed'));
  ok(r.status === 1, '1 a run with failing files exits 1', r.status);
  ok(/=== c-good\.test\.mjs ===/.test(all) && /after the failure the runner keeps going/.test(all),
     '2 a failure does not stop the later files (and output is still streamed in order)');
  ok(/3 test file\(s\) failed:\n\s+- b-bad\.test\.mjs\n\s+- d-signal\.test\.mjs \(signal SIGKILL\)\n\s+- e-silent\.test\.mjs/.test(all),
     '3 the summary names every failed file, and a signal death says so', endOfLog);
  ok(/FAILED OUTPUT/.test(endOfLog) && /the reason it failed: expected 3 got 4/.test(endOfLog),
     '4 the reason the file failed is printed AGAIN at the end of the log, after the summary', endOfLog);
  const firstReason = all.indexOf('the reason it failed');
  ok(firstReason >= 0 && firstReason < all.lastIndexOf('test file(s) failed') && all.lastIndexOf('the reason it failed') > all.lastIndexOf('test file(s) failed'),
     '5 CONTROL: it was already printed once, far earlier (the buried copy the log tail loses)');
  ok(/about to die/.test(endOfLog) && /the file printed nothing/.test(endOfLog),
     '6 a killed file shows what it printed before dying; a silent one says it printed nothing', endOfLog);
  ok(!/::error/.test(all), '7 outside GitHub Actions no annotation is written');

  const g = run({ GITHUB_ACTIONS: 'true' });
  const ann = (g.stdout + g.stderr).split('\n').filter((l) => l.startsWith('::error'));
  ok(ann.length === 3 && ann.some((l) => /title=Test file failed b-bad\.test\.mjs::/.test(l) && /the reason it failed: expected 3 got 4/.test(l)),
     '8 on GitHub Actions each failed file becomes an ::error annotation carrying the reason', ann);
  ok(ann.every((l) => !l.slice(l.indexOf('::', 8)).includes('\n')) && ann.some((l) => l.includes('%0A')),
     '9 annotation newlines are percent-encoded, so one failure is one command line');

  put('b-bad.test.mjs', "console.log('PASS - fixed');\n"); put('d-signal.test.mjs', "console.log('PASS');\n"); put('e-silent.test.mjs', "console.log('PASS');\n");
  const g2 = run({});
  ok(g2.status === 0 && /All 5 unit test file\(s\) passed/.test(g2.stdout) && !/FAILED OUTPUT/.test(g2.stdout + g2.stderr),
     '10 an all-green run exits 0, says so, and prints no failure block');

  // A crashed test can leave a child (a browser) holding the pipes open. The runner must not wait for it.
  put('f-grandchild.test.mjs', "import { spawn } from 'node:child_process';\nspawn(process.execPath, ['-e', 'setTimeout(()=>{}, 60000)'], { stdio: 'inherit', detached: true }).unref();\nconsole.log('PASS - left a grandchild holding the pipes'); process.exit(0);\n");
  const t0 = Date.now();
  const g3 = run({});
  const took = Date.now() - t0;
  ok(g3.status === 0 && took < 15000, '11 a grandchild holding the pipes open does not hang the runner (took ' + took + ' ms)', took);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);
