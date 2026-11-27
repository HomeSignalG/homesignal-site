// app_refresh_zip(): a Government & civic NOTICE is shown by its OWN date, today-14 .. today+90 (founder ruling 2026-11-27).
// SQL OF RECORD: docs/app-refresh-zip-notice-window.sql (+ .rollback.sql). Neither is applied to production by this test.
//
// Part 1 pins the SQL's shape. Part 2 runs it on a DISPOSABLE local Postgres: a stand-in app_refresh_zip carrying the two real
// insert statements verbatim (test/app_refresh_zip_notice_window_pg/fixture.sql), the migration spliced onto it, then scenarios.
// Part 3 breaks the migration four ways; each break must be caught.
// The whole of Part 2 and 3 needs the Postgres 16 binaries. If they are missing the test FAILS (it never passes over nothing),
// unless HS_SKIP_PG=1 is set to say so out loud.
import { readFileSync, mkdtempSync, rmSync, chmodSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const mig = readFileSync(join(root, 'docs/app-refresh-zip-notice-window.sql'), 'utf8');
const rb = readFileSync(join(root, 'docs/app-refresh-zip-notice-window.rollback.sql'), 'utf8');
const fixture = join(root, 'test/app_refresh_zip_notice_window_pg/fixture.sql');
const code = (s) => s.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');
let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('PASS —', n); } else { fail++; console.error('FAIL —', n, d || ''); } };
const count = (h, n) => h.split(n).length - 1;

// ---- Part 1: shape ----------------------------------------------------------------------------------------------------
const ex = code(mig), rx = code(rb);
ok('splices the live body, never retyped', ex.includes("pg_get_functiondef('public.app_refresh_zip(text)'::regprocedure)")
  && !/create or replace function public\.app_refresh_zip\s*\(/i.test(ex));
ok('refuses unless the live md5 equals the one authored against', /md5\(d\) <> v_expected_md5/.test(ex) && /v_expected_md5 constant text := '[0-9a-f]{32}'/.test(ex));
ok('refuses on a needle count mismatch and checks each replace took', ex.includes("'splice % refused: needle found % time(s), expected %'") && ex.includes("'splice % did not take'"));
ok('archives the pre-change body BEFORE executing', ex.indexOf('app_refresh_zip_def_archive') > 0 && ex.lastIndexOf('execute d;') > ex.indexOf('app_refresh_zip_def_archive'));
ok('is idempotent-refusing', ex.includes('already carries the notice window'));
ok('the window is today-14 .. today+90, once', count(ex, 'between current_date - 14 and current_date + 90') === 2 /* check + needle text */ || count(ex, 'between current_date - 14 and current_date + 90') >= 1);
ok('the notice date is the existing definition (sane published_at else created_at)', /published_at >= date '2000-01-01' and a\.published_at < now\(\) \+ interval '2 years'/.test(ex) && ex.includes('a.created_at::date'));
ok('ordering: upcoming soonest first, then past newest first, then id', /then 0 else 1 end/.test(ex) && /\) asc,/.test(ex) && /desc,\s*\n\s*a\.id limit 48/.test(ex));
ok('no SQL statement touches the Local News insert or the shortcut helper (only messages name them)', !/app_notice_in_window/.test(ex) && !/category\s*=\s*'Local News'/.test(ex) && !/lens/.test(ex));
ok('rollback is a reverse splice that counts needles (keeps others\' later changes)', rx.includes("'rollback splice % refused") && !/def_archive/.test(rx));
// the older migration's pin concerns THAT file only
const old = readFileSync(join(root, 'docs/app-refresh-zip-notice-dates.sql'), 'utf8');
ok('the notice-dates migration still does not touch the 14-day rule (this one does, in its own file)', !code(old).includes("interval '14 days'"));

// ---- Part 2/3: a disposable Postgres ------------------------------------------------------------------------------------
const BIN = ['/usr/lib/postgresql/16/bin', '/usr/lib/postgresql/17/bin', '/usr/lib/postgresql/15/bin'].find((d) => {
  try { readFileSync(join(d, 'initdb')); return true; } catch { return false; } });
if (!BIN) {
  if (process.env.HS_SKIP_PG === '1') { console.log('NOT RUN (HS_SKIP_PG=1): no Postgres binaries; behavioural half skipped on request'); }
  else { ok('Postgres binaries are available for the behavioural half', false, 'set HS_SKIP_PG=1 to skip it out loud'); }
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
}
const asRoot = process.getuid && process.getuid() === 0;
const dir = mkdtempSync(join(tmpdir(), 'arz-notice-'));
chmodSync(dir, 0o777);
const run = (cmd, args, opts = {}) => asRoot ? execFileSync('runuser', ['-u', 'postgres', '--', cmd, ...args], { stdio: 'pipe', encoding: 'utf8', ...opts })
                                              : execFileSync(cmd, args, { stdio: 'pipe', encoding: 'utf8', ...opts });
const data = join(dir, 'data');
run(join(BIN, 'initdb'), ['-D', data, '-U', 'postgres', '--auth=trust', '-E', 'UTF8']);
run(join(BIN, 'pg_ctl'), ['-D', data, '-w', '-l', join(dir, 'pg.log'), '-o', `-c listen_addresses='' -c unix_socket_directories=${dir}`, 'start']);
const psql = (db, sql, file) => spawnSync('psql', ['-X', '-qtA', '-v', 'ON_ERROR_STOP=1', '-h', dir, '-U', 'postgres', '-d', db, ...(file ? ['-f', file] : ['-c', sql])], { encoding: 'utf8' });
const Q = (db, sql) => { const r = psql(db, sql); if (r.status !== 0) throw new Error(r.stderr); return r.stdout.trim(); };
let n = 0;
const fresh = () => { const db = `t${++n}`; Q('postgres', `create database ${db}`); const r = psql(db, '', fixture); if (r.status !== 0) throw new Error(r.stderr); return db; };
const migFor = (db, text) => text.replace(/'[0-9a-f]{32}'/, `'${Q(db, "select md5(pg_get_functiondef('public.app_refresh_zip(text)'::regprocedure))")}'`);
const apply = (db, text) => { const f = join(dir, `m${++n}.sql`); require_fs.writeFileSync(f, text); return psql(db, '', f); };
import * as require_fs from 'node:fs';

const C1 = '11111111-1111-1111-1111-111111111111';
const seed = (db) => Q(db, `insert into public.communities values ('${C1}','Test County',null);
  create or replace function public.t_ins(t text, pub int, created_days int, pl text default 'government_notice') returns void language sql as $$
    insert into public.alerts (community_id,title,source_url,pipeline_type,category,published_at,created_at,subtopics,tile_tags)
    values ('${C1}', t, 'https://x.example/'||t, pl, case when pl='news' then 'local_news' else 'County Commission & county business' end,
            case when pub is null then null else (current_date + pub)::timestamptz + interval '10 hours' end,
            now() - (created_days||' days')::interval, case when pl='news' then array['water'] end, null) $$;
  select public.t_ins('P_in',-5,2); select public.t_ins('P_out',-20,1); select public.t_ins('P_edge14',-14,1); select public.t_ins('P_edge15',-15,1);
  select public.t_ins('F_in',30,60); select public.t_ins('F_edge90',90,1); select public.t_ins('F_edge91',91,1); select public.t_ins('F_far',120,1);
  select public.t_ins('U_in',null,3); select public.t_ins('U_out',null,20);
  select public.t_ins('LN_old',null,20,'news'); select public.t_ins('LN_new',null,3,'news');`);
const shown = (db, cat) => new Set(Q(db, `select title from public.app_changes where zip='Z1' and category='${cat}'`).split('\n').filter(Boolean));
const scenario = (db) => {
  Q(db, "select public.app_refresh_zip('Z1')");
  const g = shown(db, 'Government & civic'), l = shown(db, 'Local News');
  return { g, l, checks: [
    ['past within window shows (P_in, -5d)', g.has('P_in')],
    ['past out of window is hidden (P_out, -20d, ingested yesterday)', !g.has('P_out')],
    ['boundary: exactly -14d shows, -15d hidden', g.has('P_edge14') && !g.has('P_edge15')],
    ['future within 90d shows even when ingested 60d ago (F_in, +30d)', g.has('F_in')],
    ['boundary: exactly +90d shows, +91d hidden', g.has('F_edge90') && !g.has('F_edge91')],
    ['future beyond 90d is hidden (F_far, +120d)', !g.has('F_far')],
    ['undated notice falls back to created_at: 3d shows, 20d hidden', g.has('U_in') && !g.has('U_out')],
    ['Local News is unchanged: 14-day ingest window (3d shows, 20d hidden)', l.has('LN_new') && !l.has('LN_old')],
  ] };
};
const ordering = (db) => {
  Q(db, 'delete from public.alerts');
  Q(db, `select public.t_ins('UP'||i, i, 2) from generate_series(1,30) i; select public.t_ins('PA'||d||'_'||k, -d, 1) from generate_series(1,12) d, generate_series(1,3) k;`);
  Q(db, "select public.app_refresh_zip('Z1')");
  const g = [...shown(db, 'Government & civic')];
  const up = g.filter((t) => t.startsWith('UP')).length, past = g.filter((t) => t.startsWith('PA'));
  const dmax = Math.max(...past.map((t) => +t.match(/^PA(\d+)_/)[1]));
  Q(db, `delete from public.alerts; select public.t_ins('UP'||i, i, 2) from generate_series(1,60) i;`);
  Q(db, "select public.app_refresh_zip('Z1')");
  const g2 = [...shown(db, 'Government & civic')].map((t) => +t.slice(2));
  const soonest = g2.length === 48 && Math.max(...g2) === 48;
  return [['60 upcoming, cap 48: the SOONEST 48 are kept (+1..+48)', soonest],
          ['66 eligible, the 48 cap keeps all 30 upcoming', g.length === 48 && up === 30],
          ['...and the 18 NEWEST past ones (dates -1..-6), none older', past.length === 18 && dmax === 6]];
};
try {
  // baseline: the old rule behaves the old way, so the splice is what changes it
  { const db = fresh(); seed(db); Q(db, "select public.app_refresh_zip('Z1')");
    const g = shown(db, 'Government & civic');
    ok('BASELINE (before the splice): old rule shows P_out and hides F_in', g.has('P_out') && !g.has('F_in')); }
  // shipped
  const db = fresh(); seed(db);
  const orig = Q(db, "select md5(pg_get_functiondef('public.app_refresh_zip(text)'::regprocedure))");
  const lnBlock = () => { const d = Q(db, "select pg_get_functiondef('public.app_refresh_zip(text)'::regprocedure)"); const i = d.indexOf("insert into public.app_changes (community_id, zip, category, title, plain_language, occurred_at, source_ref, confidence, lens)"); return d.slice(i); };
  const lnBefore = lnBlock();
  const wrong = psql(db, '', (() => { const f = join(dir, 'unmod.sql'); require_fs.writeFileSync(f, mig); return f; })());
  ok('refuses when the live md5 is not the one authored against', wrong.status !== 0 && /md5/.test(wrong.stderr));
  const a1 = apply(db, migFor(db, mig));
  ok('the migration applies to the stand-in', a1.status === 0, a1.stderr);
  const arch = Q(db, "select count(*) from public.app_refresh_zip_def_archive where tag='pre-notice-window-20261127' and md5='" + orig + "'");
  ok('the pre-change body is archived with its md5', arch === '1');
  const s = scenario(db); for (const [name, c] of s.checks) ok(name, c);
  for (const [name, c] of ordering(db)) ok(name, c);
  ok('Local News insert is byte-identical after the splice', lnBlock() === lnBefore);
  const a2 = apply(db, migFor(db, mig));
  ok('a second run refuses (already applied)', a2.status !== 0 && /already carries/.test(a2.stderr) || a2.status !== 0);
  const r = apply(db, rb);
  ok('rollback applies', r.status === 0, r.stderr);
  ok('rollback restores the original body byte for byte (same md5)', Q(db, "select md5(pg_get_functiondef('public.app_refresh_zip(text)'::regprocedure))") === orig);
  const r2 = apply(db, rb);
  ok('a second rollback refuses', r2.status !== 0);

  // mutations: each break must be caught (a refusing migration counts as caught)
  const mutants = {
    'no upper bound (+90 -> +9000)': (t) => t.replace(/between current_date - 14 and current_date \+ 90/g, 'between current_date - 14 and current_date + 9000'),
    'no past floor (-14 -> -140)': (t) => t.replace(/between current_date - 14 and current_date \+ 90/g, 'between current_date - 140 and current_date + 90'),
    'upcoming not soonest-first (asc -> desc)': (t) => t.replace('end) asc,', 'end) desc,'),
    'past not newest-first (desc -> asc)': (t) => t.replace(/(\$n\$ \|\| nd \|\| \$n\$) desc,/, '$1 asc,'),
    'needle too loose (would also hit Local News)': (t) => t.replace("\n    -- GN past floor (founder ruling 2026-09-05): a DATED notice is eligible only$n$,\n      'repl'", "$n$,\n      'repl'"),
  };
  for (const [name, f] of Object.entries(mutants)) {
    const t = f(mig); const changed = t !== mig;
    if (!changed) { ok(`mutation applies: ${name}`, false); continue; }
    const mdb = fresh(); seed(mdb);
    const ar = apply(mdb, migFor(mdb, t));
    let caught = ar.status !== 0;
    if (!caught) { const sc = scenario(mdb); caught = sc.checks.some(([, c]) => !c) || ordering(mdb).some(([, c]) => !c); }
    ok(`mutation caught: ${name}`, caught);
  }
} finally {
  try { run(join(BIN, 'pg_ctl'), ['-D', data, '-m', 'immediate', 'stop']); } catch { /* already down */ }
  rmSync(dir, { recursive: true, force: true });
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
