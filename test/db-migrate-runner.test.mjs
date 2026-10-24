// db-migrate: a deadline-free, committed, auditable migration path (docs/db-migration-runner.md).
// Run: node test/db-migrate-runner.test.mjs
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const wf = readFileSync('.github/workflows/db-migrate.yml', 'utf8');
const py = readFileSync('scripts/db_migrate.py', 'utf8');
let n = 0;
const ok = (name, fn) => { fn(); n++; console.log('ok -', name); };

ok('dispatch-only: no pull_request / push / schedule trigger', () => {
  const on = wf.split(/^jobs:/m)[0].split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');
  assert.match(on, /workflow_dispatch:/);
  assert.doesNotMatch(on, /pull_request|^\s*push:|schedule:/m);
});
ok('writes need the protected environment; reads use the ungated one; verify is never a writer', () => {
  assert.match(wf, /apply:[\s\S]*?environment: prod-db-write/);
  assert.match(wf, /preflight:[\s\S]*?environment: prod-db-read/);
  assert.match(wf, /verify:[\s\S]*?environment: prod-db-read/);
  assert.equal((wf.match(/environment: prod-db-write/g) || []).length, 1);
});
ok('apply cannot start before preflight; verify only after apply', () => {
  assert.match(wf, /apply:\s*\n\s*needs: preflight/);
  assert.match(wf, /verify:\s*\n\s*needs: apply/);
});
ok('no dispatch input is interpolated into a shell line', () => {
  for (const l of wf.split('\n')) if (/^\s*run:/.test(l)) assert.doesNotMatch(l, /\$\{\{/);
});
ok('no begin/rollback "check mode" and no workflow-level secret', () => {
  assert.doesNotMatch(py, /rollback;/i);
  assert.doesNotMatch(wf.split(/^jobs:/m)[0].split('\n').filter((l) => !l.trim().startsWith('#')).join('\n'), /secrets\./);
});
ok('a timeout is recorded unknown, never applied or failed', () => {
  assert.match(py, /except TimeoutError[\s\S]{0,200}status, detail = 'unknown'/);
  assert.match(py, /'started','applied','failed','unknown'/);
});
ok('the token is never printed', () => {
  assert.doesNotMatch(py, /print\([^)]*tok/);
});
const run = (args, env = {}) => spawnSync('python3', ['-I', 'scripts/db_migrate.py', ...args], { encoding: 'utf8', env: { PATH: process.env.PATH, ...env } });
ok('a path outside the allowlist is refused before any network call', () => {
  const r = run(['apply', '/etc/passwd', 'a'.repeat(64)]);
  assert.notEqual(r.status, 0); assert.match(r.stderr, /not an allowed migration path/);
  const r2 = run(['apply', 'docs/../scripts/db_migrate.py', 'a'.repeat(64)]);
  assert.match(r2.stderr, /not an allowed migration path/);
});
ok('a sha256 that differs from the approval pin is refused', () => {
  const r = run(['preflight', 'docs/video-bluesky-queue.sql', 'a'.repeat(64)]);
  assert.notEqual(r.status, 0); assert.match(r.stderr, /sha256 mismatch/);
});
ok('the right pin passes the file check and then stops at the missing credential, not before', () => {
  const sha = createHash('sha256').update(readFileSync('docs/video-bluesky-queue.sql')).digest('hex');
  const r = run(['preflight', 'docs/video-bluesky-queue.sql', sha]);
  assert.match(r.stderr, /SUPABASE_ACCESS_TOKEN not set/);
});
ok('the verify file for the video queue is select-only', () => {
  const v = readFileSync('docs/video-bluesky-queue.verify.sql', 'utf8').replace(/--[^\n]*/g, '').toLowerCase();
  assert.match(v.trim(), /^select/);
  assert.doesNotMatch(v, /\b(insert|update|delete|drop|alter|create|truncate|grant|revoke)\b/);
});
console.log(`db-migrate runner: ${n} checks passed`);
