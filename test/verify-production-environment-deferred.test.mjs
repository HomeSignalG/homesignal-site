// Runs the embedded script of .github/workflows/verify-production-environment.yml offline, for each
// state the database URL secret can be in. production-boundary-new-workflows.test.mjs reads the YAML
// and never executes the Python, so without this file the DEFERRED logic was proven by nothing.
//   absent      (flag True)   -> C0 and C1 read DEFERRED, psql is never called, exit 0
//   blank       (whitespace)  -> C0 FAILS as "set but blank", nothing reads DEFERRED, exit 1
//   set                       -> C1a, C1b, C1c run and PASS, the "set DB_URL_DEFERRED to False" notice prints
//   flag_false  (absent)      -> C0 FAILS as MISSING, exit 1
//   absent_one_fail           -> DEFERRED does not hide another failing check, exit 1
// urllib and psql are stubbed by test/fixtures/verify-production-environment/harness.py, and every
// secret value is a fake that must never appear in the output.
import { readFileSync, writeFileSync, mkdtempSync, copyFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const WF = readFileSync(join(root, '.github', 'workflows', 'verify-production-environment.yml'), 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('PASS —', m); } else { fail++; console.error('FAIL —', m); } };

// The embedded script: the lines between the heredoc opener and its closing PY, dedented.
const lines = WF.split('\n');
const start = lines.findIndex((l) => l.trimEnd().endsWith("python3 -I - <<'PY'"));
const end = lines.findIndex((l, i) => i > start && l.trim() === 'PY');
ok(start > 0 && end > start, 'the workflow carries exactly one embedded script between <<\'PY\' and PY');
const indent = (lines[end].match(/^ */) || [''])[0].length;
const body = lines.slice(start + 1, end).map((l) => l.slice(Math.min(indent, l.length - l.trimStart().length))).join('\n') + '\n';
ok(/DB_URL_DEFERRED = True/.test(body) && /deferred = DB_URL_DEFERRED and not RAW_DB_URL/.test(body),
   'the extracted script is the one that decides DEFERRED (positive control on the slice)');

const dir = mkdtempSync(join(tmpdir(), 'verify-prod-env-'));
const script = join(dir, 'verify_script.py');
const harness = join(dir, 'harness.py');
writeFileSync(script, body);
copyFileSync(join(root, 'test', 'fixtures', 'verify-production-environment', 'harness.py'), harness);

const FAKES = ['svc-FAKE-7f3a', 'sbp_FAKE_9c1d', 'p@ss-FAKE', 'p%40ss-FAKE'];
const run = (c) => {
  const r = spawnSync('python3', ['-I', harness, script, c], { cwd: root, encoding: 'utf8', env: { PATH: process.env.PATH } });
  if (r.error) return { code: -1, out: String(r.error) };
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
};
const row = (out, name) => out.split('\n').find((l) => l.startsWith('| ' + name)) || '';
const clean = (c, out) => ok(!FAKES.some((f) => out.includes(f)), `${c}: no secret value appears in the output`);

{
  const { code, out } = run('absent');
  ok(code === 0, `absent: exit 0 (got ${code})`);
  ok(/\| DEFERRED \|$/.test(row(out, 'C0 PROD_SUPABASE_DB_URL is set')), 'absent: C0 for the database URL reads DEFERRED');
  ok(/\| DEFERRED \|$/.test(row(out, 'C1 database URL checks')), 'absent: the C1 summary row reads DEFERRED');
  ok(out.includes('HARNESS psql calls: 0'), 'absent: psql is never called');
  ok(/failures=0/.test(out) && out.includes('is DEFERRED'), 'absent: 0 failures and the DEFERRED notice prints');
  clean('absent', out);
}
{
  const { code, out } = run('blank');
  ok(code === 1, `blank: exit 1 (got ${code})`);
  const c0 = row(out, 'C0 PROD_SUPABASE_DB_URL is set');
  ok(c0.includes('set but blank') && /\| FAIL \|$/.test(c0), 'blank: C0 FAILS as "set but blank"');
  ok(!out.includes('| DEFERRED |'), 'blank: nothing reads DEFERRED');
  clean('blank', out);
}
{
  const { code, out } = run('set');
  ok(code === 0, `set: exit 0 (got ${code})`);
  for (const name of ['C1a', 'C1b', 'C1c']) ok(/\| PASS \|$/.test(row(out, name)), `set: ${name} runs and passes`);
  ok(out.includes('HARNESS psql calls: 1') && out.includes('HARNESS PGPASSWORD decoded: True'),
     'set: psql is called once, with the password decoded into PGPASSWORD');
  ok(out.includes('HARNESS password in argv: False'), 'set: the password never reaches the psql argument list');
  ok(out.includes('set DB_URL_DEFERRED to False'), 'set: the run says to set the flag to False');
  clean('set', out);
}
{
  const { code, out } = run('flag_false');
  ok(code === 1, `flag_false: exit 1 (got ${code})`);
  const c0 = row(out, 'C0 PROD_SUPABASE_DB_URL is set');
  ok(c0.includes('MISSING') && /\| FAIL \|$/.test(c0), 'flag_false: an absent secret FAILS as MISSING');
  clean('flag_false', out);
}
{
  const { code, out } = run('absent_one_fail');
  ok(code === 1, `absent_one_fail: exit 1 (got ${code})`);
  ok(/\| FAIL \|$/.test(row(out, 'C3a')), 'absent_one_fail: the refused token fails C3a');
  ok(/\| DEFERRED \|$/.test(row(out, 'C0 PROD_SUPABASE_DB_URL is set')), 'absent_one_fail: the database URL still reads DEFERRED');
  clean('absent_one_fail', out);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
console.log('ALL PASS');
