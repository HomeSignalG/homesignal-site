// db-migrate runner: durable out-of-band approval, credential-free request step, single-use authenticator code.
// Drives the REAL scripts/db_migrate.py against a fake Management API, a fake public REST endpoint and a throwaway git repo.
// Run: node test/db-migrate-runner.test.mjs
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createHmac, createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const ROOT = resolve('.');
const SCRIPT = join(ROOT, 'scripts/db_migrate.py');
let n = 0;
const ok = async (name, fn) => { await fn(); n++; console.log('ok -', name); };

// ---- RFC 4226/6238 reference in JS (independent of the Python under test) ----------------------------------------------
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const b32dec = (s) => { let bits = ''; for (const c of s.replace(/=+$/, '')) bits += B32.indexOf(c).toString(2).padStart(5, '0'); const out = []; for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2)); return Buffer.from(out); };
const hotp = (secret, counter) => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(counter)); const h = createHmac('sha1', b32dec(secret)).update(b).digest(); const o = h[19] & 15; return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, '0'); };
const SEED = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
const nowCounter = () => Math.floor(Date.now() / 30000);
const code = (offset = 0) => hotp(SEED, nowCounter() + offset);

// ---- fakes ------------------------------------------------------------------------------------------------------------------
function fakeApi(cfg = {}) {
  const log = []; const used = new Set();
  const srv = createServer((req, res) => {
    let body = ''; req.on('data', (d) => (body += d)); req.on('end', () => {
      const q = (JSON.parse(body || '{}').query) || '';
      log.push({ url: req.url, auth: req.headers.authorization, apikey: req.headers.apikey, query: q, body });
      const send = (c, o) => { res.writeHead(c, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
      if (req.url.includes('/rpc/migration_state')) return cfg.noLedger ? send(404, { message: 'Could not find the function public.migration_state' }) : send(200, cfg.state || []);
      if (q.includes('create table if not exists public.migration_runs')) return send(200, []);
      if (q.includes('insert into public.migration_totp_used')) { const c = q.match(/values \((\d+)\)/)[1]; if (used.has(c) || (cfg.usedCounters || []).includes(c)) return send(409, { message: 'duplicate key 23505' }); used.add(c); return send(200, []); }
      if (q.startsWith('select status from public.migration_runs')) return send(200, cfg.prior || []);
      if (q.includes('insert into public.migration_runs')) return send(200, [{ id: 7 }]);
      if (q.startsWith('update public.migration_runs')) return send(200, []);
      if (cfg.hang) return; // the migration file itself, never answered
      return send(cfg.fileStatus || 200, cfg.fileStatus ? { message: 'boom' } : []);
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, log, url: `http://127.0.0.1:${srv.address().port}` })));
}
const sh = (cmd, cwd) => { const r = spawnSync('sh', ['-ec', cmd], { cwd, encoding: 'utf8' }); if (r.status) throw new Error(cmd + '\n' + r.stderr); return r.stdout.trim(); };
const SQL = "-- test migration\nselect 1;\n";
function repo({ onMain = true } = {}) {
  const base = mkdtempSync(join(tmpdir(), 'dbm-'));
  sh(`git init -q --bare origin.git && git clone -q origin.git work 2>/dev/null`, base);
  const w = join(base, 'work');
  mkdirSync(join(w, 'docs'));
  writeFileSync(join(w, 'docs/m.sql'), SQL);
  writeFileSync(join(w, 'config.js'), "window.HS_CONFIG={SUPABASE_URL:'https://example.invalid',SUPABASE_ANON_KEY:'ANON_PUBLIC_KEY_FOR_TEST'};");
  sh(`git -c user.email=t@t -c user.name=t checkout -q -b main && git add -A && git -c user.email=t@t -c user.name=t commit -qm init && git push -q -u origin main`, w);
  let commit = sh('git rev-parse HEAD', w);
  if (!onMain) {
    sh(`git checkout -q -b feature && echo "select 2;" >> docs/m.sql && git -c user.email=t@t -c user.name=t commit -qam feat && git push -q -u origin feature`, w);
    commit = sh('git rev-parse HEAD', w);
  }
  const sha = createHash('sha256').update(readFileSync(join(w, 'docs/m.sql'))).digest('hex');
  return { w, commit, sha, base };
}
const request = (r, api, rest, extra = {}) => new Promise((res) => {
  const p = spawn('python3', ['-I', SCRIPT, 'request', 'docs/m.sql', r.commit], { cwd: r.w,
    env: { PATH: process.env.PATH, DB_MIGRATE_TEST_REST: rest.url, REQUEST_BODY_FILE: join(r.w, 'body.md'), ...extra } });
  let out = '', err = ''; p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (err += d));
  p.on('close', (status) => res({ status, stdout: out, stderr: err })); });
function decideEnv(r, api, commentBody, o = {}) {
  const ev = { issue: { number: 5, state: 'open', html_url: 'https://github.com/x/y/issues/5', user: { login: 'github-actions[bot]' }, labels: [{ name: 'migration-request' }],
      body: `<!-- db-migrate-request v1 file=docs/m.sql sha256=${r.sha} commit=${r.commit} on_main=${o.onMain === false ? 'false' : 'true'} -->\nbody`, ...(o.issue || {}) },
    comment: { body: commentBody, user: { login: o.user || 'HomeSignalG', type: o.type || 'User' } } };
  const evp = join(r.w, 'event.json'); writeFileSync(evp, JSON.stringify(ev));
  return { PATH: process.env.PATH, GITHUB_EVENT_PATH: evp, GITHUB_OUTPUT: join(r.w, 'out.txt'), RESULT_FILE: join(r.w, 'result.md'), GITHUB_REPOSITORY_OWNER: 'HomeSignalG',
    SUPABASE_PROJECT_REF: 'REF', SUPABASE_ACCESS_TOKEN: 'WRITE_TOKEN_FOR_TEST', MIGRATION_TOTP_SECRET: SEED, DB_MIGRATE_TEST_API: api.url, GITHUB_RUN_ID: '99', ...(o.env || {}) };
}
const decide = (r, env) => new Promise((res) => { const p = spawn('python3', ['-I', SCRIPT, 'decide'], { cwd: r.w, env }); let out = '', err = ''; p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (err += d)); p.on('close', (status) => res({ status, out, err })); });
const outKV = (r) => (existsSync(join(r.w, 'out.txt')) ? readFileSync(join(r.w, 'out.txt'), 'utf8') : '');
const approve = (r, c = code(), extra = '') => `/approve ${r.sha} ${r.commit} ${c}${extra}`;

// ---- tests -------------------------------------------------------------------------------------------------------------------
await ok('RFC 6238 vector: the Python verifier agrees with an independent reference', () => {
  const rfc = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'; // "12345678901234567890"
  assert.equal(hotp(rfc, Math.floor(59 / 30)), '287082');
  const r = spawnSync('python3', ['-I', '-c', `import importlib.util as u;s=u.spec_from_file_location('m','${SCRIPT}');m=u.module_from_spec(s);s.loader.exec_module(m);print(m.hotp('${rfc}',1), m.totp_counter_for('${rfc}','287082',now=59), m.totp_counter_for('${rfc}','000000',now=59))`], { encoding: 'utf8' });
  assert.equal(r.stdout.trim(), '287082 1 None');
});

await ok('request: holds NO production credential and writes nothing, even if a token is present in the environment', async () => {
  const api = await fakeApi(), rest = await fakeApi({ state: [] }); const r = repo();
  const out = await request(r, api, rest, { SUPABASE_ACCESS_TOKEN: 'WRITE_TOKEN_FOR_TEST', DB_MIGRATE_TEST_API: api.url });
  assert.equal(out.status, 0, out.stderr);
  assert.equal(api.log.length, 0, 'the request step must never touch the write API');
  assert.equal(rest.log.length, 1);
  assert.equal(rest.log[0].apikey, 'ANON_PUBLIC_KEY_FOR_TEST');
  assert.ok(!JSON.stringify(rest.log).includes('WRITE_TOKEN_FOR_TEST'), 'the write token never reaches the read endpoint');
  const body = readFileSync(join(r.w, 'body.md'), 'utf8');
  assert.match(body, new RegExp(`sha256=${r.sha} commit=${r.commit} on_main=true`));
  assert.match(body, /never expires/);
  api.srv.close(); rest.srv.close();
});
await ok('request: reports a production without the ledger yet, and refuses an already-applied file', async () => {
  const api = await fakeApi(), rest1 = await fakeApi({ noLedger: true }), r = repo();
  assert.equal((await request(r, api, rest1)).status, 0);
  assert.match(readFileSync(join(r.w, 'body.md'), 'utf8'), /ledger installed in production: false/);
  const rest2 = await fakeApi({ state: [{ status: 'applied' }] });
  assert.equal((await request(r, api, rest2)).status, 3);
  [api, rest1, rest2].forEach((x) => x.srv.close());
});
await ok('request: an unmerged commit is labelled as such and the approval must say so', async () => {
  const api = await fakeApi(), rest = await fakeApi(), r = repo({ onMain: false });
  assert.equal((await request(r, api, rest)).status, 0);
  const b = readFileSync(join(r.w, 'body.md'), 'utf8');
  assert.match(b, /on_main=false/); assert.match(b, /NO, an unmerged branch/); assert.match(b, /`unmerged`/);
  api.srv.close(); rest.srv.close();
});

await ok('decide: a commenter who is not an approver is ignored and nothing is touched', async () => {
  const api = await fakeApi(), r = repo();
  const res = await decide(r, decideEnv(r, api, approve(r), { user: 'mallory' }));
  assert.equal(res.status, 0); assert.equal(api.log.length, 0); assert.match(outKV(r), /decision=ignored/);
  api.srv.close();
});
await ok('decide: a bot account, a pull-request comment, an unlabelled issue and a hand-written issue are all ignored', async () => {
  const api = await fakeApi(), r = repo();
  for (const o of [{ type: 'Bot' }, { issue: { labels: [] } }, { issue: { user: { login: 'HomeSignalG' } } }, { issue: { state: 'closed' } }]) {
    const res = await decide(r, decideEnv(r, api, approve(r), o)); assert.equal(res.status, 0);
  }
  assert.equal(api.log.length, 0); api.srv.close();
});
await ok('decide: a wrong sha, a wrong commit or a changed file is refused before any write', async () => {
  const api = await fakeApi(), r = repo();
  let res = await decide(r, decideEnv(r, api, `/approve ${'0'.repeat(64)} ${r.commit} ${code()}`)); assert.equal(res.status, 0);
  assert.match(readFileSync(join(r.w, 'result.md'), 'utf8'), /do not match this request/);
  res = await decide(r, decideEnv(r, api, `/approve ${r.sha} ${'1'.repeat(40)} ${code()}`));
  assert.match(readFileSync(join(r.w, 'result.md'), 'utf8'), /do not match this request/);
  assert.equal(api.log.length, 0); api.srv.close();
});
await ok('decide: a wrong or expired one-time code is refused and writes nothing', async () => {
  const api = await fakeApi(), r = repo();
  for (const c of ['000000', code(-5), code(+5)]) {
    const res = await decide(r, decideEnv(r, api, approve(r, c)));
    assert.equal(res.status, 0); assert.match(readFileSync(join(r.w, 'result.md'), 'utf8'), /wrong or expired/);
  }
  assert.equal(api.log.length, 0); api.srv.close();
});
await ok('decide: with no authenticator seed configured, no approval can be verified', async () => {
  const api = await fakeApi(), r = repo();
  const res = await decide(r, decideEnv(r, api, approve(r), { env: { MIGRATION_TOTP_SECRET: '' } }));
  assert.match(readFileSync(join(r.w, 'result.md'), 'utf8'), /not configured/); assert.equal(api.log.length, 0); api.srv.close();
});
await ok('decide: a valid approval runs the committed file exactly once, in order, with the token only on the write API', async () => {
  const api = await fakeApi(), r = repo();
  const res = await decide(r, decideEnv(r, api, approve(r)));
  assert.equal(res.status, 0, res.err);
  assert.match(outKV(r), /decision=applied/);
  const q = api.log.map((x) => x.query);
  const idx = (re) => q.findIndex((s) => re.test(s));
  assert.ok(idx(/create table if not exists public\.migration_runs/) < idx(/insert into public\.migration_totp_used/));
  assert.ok(idx(/insert into public\.migration_totp_used/) < idx(/insert into public\.migration_runs/));
  assert.ok(idx(/insert into public\.migration_runs/) < q.indexOf(SQL));
  assert.ok(q.indexOf(SQL) < idx(/update public\.migration_runs set status='applied'/));
  assert.equal(q.filter((s) => s === SQL).length, 1, 'the file ran exactly once');
  assert.ok(api.log.every((x) => x.auth === 'Bearer WRITE_TOKEN_FOR_TEST'));
  assert.match(readFileSync(join(r.w, 'result.md'), 'utf8'), /APPLIED/);
  api.srv.close();
});
await ok('decide: a replayed one-time code is refused and the file is NOT run', async () => {
  const api = await fakeApi({ usedCounters: [String(nowCounter())] }), r = repo();
  const res = await decide(r, decideEnv(r, api, approve(r, code())));
  assert.equal(res.status, 0); assert.match(readFileSync(join(r.w, 'result.md'), 'utf8'), /already used/);
  assert.ok(!api.log.some((x) => x.query === SQL)); api.srv.close();
});
await ok('decide: a file that already has an applied / started / unknown ledger entry is not run again', async () => {
  for (const st of ['applied', 'started', 'unknown']) {
    const api = await fakeApi({ prior: [{ status: st }] }), r = repo();
    const res = await decide(r, decideEnv(r, api, approve(r)));
    assert.equal(res.status, 0); assert.match(readFileSync(join(r.w, 'result.md'), 'utf8'), new RegExp(`ledger entry \\(${st}\\)`));
    assert.ok(!api.log.some((x) => x.query === SQL)); api.srv.close();
  }
});
await ok('decide: an unmerged commit needs the explicit word, and then runs', async () => {
  const api = await fakeApi(), r = repo({ onMain: false });
  let res = await decide(r, decideEnv(r, api, approve(r), { onMain: false }));
  assert.match(readFileSync(join(r.w, 'result.md'), 'utf8'), /not on main/); assert.equal(api.log.length, 0);
  res = await decide(r, decideEnv(r, api, approve(r, code(), ' unmerged'), { onMain: false }));
  assert.match(outKV(r), /decision=applied/); api.srv.close();
});
await ok('decide: /reject records a refusal and runs nothing', async () => {
  const api = await fakeApi(), r = repo();
  const res = await decide(r, decideEnv(r, api, '/reject not now'));
  assert.equal(res.status, 0); assert.match(outKV(r), /decision=rejected/); assert.match(readFileSync(join(r.w, 'result.md'), 'utf8'), /Rejected/);
  assert.equal(api.log.length, 0); api.srv.close();
});
await ok('decide: a failing migration is recorded failed (not applied) and exits non-zero', async () => {
  const api = await fakeApi({ fileStatus: 500 }), r = repo();
  const res = await decide(r, decideEnv(r, api, approve(r)));
  assert.equal(res.status, 1); assert.match(outKV(r), /decision=failed/);
  assert.ok(api.log.some((x) => /update public\.migration_runs set status='failed'/.test(x.query))); api.srv.close();
});
await ok('decide: a timeout is recorded UNKNOWN - neither applied nor failed - and exits 4', async () => {
  const api = await fakeApi({ hang: true }), r = repo();
  const res = await decide(r, decideEnv(r, api, approve(r), { env: { DB_MIGRATE_TEST_TIMEOUT: '1' } }));
  assert.equal(res.status, 4, res.err); assert.match(outKV(r), /decision=unknown/);
  assert.ok(api.log.some((x) => /update public\.migration_runs set status='unknown'/.test(x.query)));
  assert.ok(!api.log.some((x) => /status='applied'/.test(x.query))); api.srv.close();
});

// ---- structure of the workflows (the credential boundary) ---------------------------------------------------------------
const strip = (t) => t.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');
const wfDir = join(ROOT, '.github/workflows');
const onBlock = (t) => t.split(/^jobs:/m)[0];
const req = strip(readFileSync(join(wfDir, 'db-migrate-request.yml'), 'utf8'));
const dec = strip(readFileSync(join(wfDir, 'db-migrate-decide.yml'), 'utf8'));
await ok('the request workflow holds no secret and no environment, so it cannot write production', () => {
  assert.doesNotMatch(req, /secrets\./); assert.doesNotMatch(req, /\benvironment:/); assert.doesNotMatch(req, /SUPABASE_ACCESS_TOKEN/);
  assert.match(onBlock(req), /workflow_dispatch:/); assert.doesNotMatch(onBlock(req), /pull_request|^\s*push:|schedule:/m);
});
await ok('only the decide workflow names the write token, only inside the protected environment, only on issue comments', () => {
  assert.match(onBlock(dec), /issue_comment:/); assert.doesNotMatch(onBlock(dec), /pull_request|^\s*push:|schedule:|workflow_dispatch/m);
  assert.equal((dec.match(/environment: prod-db-write/g) || []).length, 1);
  assert.match(dec, /environment: prod-db-write[\s\S]*SUPABASE_ACCESS_TOKEN: \$\{\{ secrets\.SUPABASE_ACCESS_TOKEN \}\}/);
  assert.match(dec, /pull_request == null/);
  assert.match(dec, /startsWith\(github\.event\.comment\.body, '\/approve'\)/);
  assert.match(dec, /github\.repository_owner/);
});
await ok('there is no ungated environment that holds a write-capable credential anywhere', () => {
  const all = readdirSync(wfDir).map((f) => readFileSync(join(wfDir, f), 'utf8')).join('\n');
  assert.doesNotMatch(all, /prod-db-read/);
  assert.doesNotMatch(strip(readFileSync(join(wfDir, 'db-migrate-request.yml'), 'utf8')), /MIGRATION_TOTP/);
});
await ok('no run line interpolates a dispatch input or comment body, and nothing sets the test hooks', () => {
  for (const t of [req, dec]) {
    for (const l of t.split('\n')) if (/^\s*(run:|gh |python3 )/.test(l)) assert.doesNotMatch(l, /\$\{\{\s*(inputs|github\.event)/);
    assert.doesNotMatch(t, /DB_MIGRATE_TEST_/);
  }
});
await ok('the script never wraps a migration in begin/rollback and never prints the token', () => {
  const py = readFileSync(SCRIPT, 'utf8');
  assert.doesNotMatch(py, /\brollback;/i); assert.doesNotMatch(py, /print\([^)]*(tok|SUPABASE_ACCESS_TOKEN)/);
  const fn = py.slice(py.indexOf('def cmd_request'), py.indexOf('# ---- decide'));
  assert.doesNotMatch(fn, /write_sql|SUPABASE_ACCESS_TOKEN/, 'the request path must not be able to write');
});
console.log(`db-migrate runner: ${n} checks passed`);
