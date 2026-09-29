// RESOLVER HARDENING — the structural half; the executable half is test/dc_resolver_hardening_pg/run.sh.
// Run: node test/dc-resolver-hardening-structure.test.mjs
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

let n = 0, bad = 0;
const ok = (c, m, d) => { n++; if (c) console.log('PASS — ' + m); else { bad++; console.log('FAIL — ' + m + (d ? '  [' + d + ']' : '')); } };
const ROOT = new URL('..', import.meta.url).pathname;
const read = (f) => readFileSync(join(ROOT, f), 'utf8');
const stripSql = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');

const SQL = stripSql(read('docs/dc-resolver-hardening.sql'));
const BLOCK = (SQL.match(/_block\s+text := \$blk\$([\s\S]*?)\$blk\$;/) || [, ''])[1];
ok(BLOCK.length > 1500 && SQL.length > BLOCK.length, '0: the monitor block is located (positive control)');

// ── the revoke is by NAME, on both resolvers ──────────────────────────────────────────────────────
ok(/revoke all on function public\.dc_resolve_canonical\(boolean, boolean\) from public, anon, authenticated;/.test(SQL)
   && /revoke all on function public\.dc_resolve_geography\(boolean\) from public, anon, authenticated;/.test(SQL),
  'R1: both resolvers are revoked from public, anon AND authenticated by name (a revoke from PUBLIC alone is not a lock on Supabase)');
ok(!/grant\s/i.test(SQL), 'R2: the file grants nothing — it can only close access');
ok(/for j in select jobname, username, command from cron\.job where command ~ 'dc_resolve'/.test(SQL)
   && /has_function_privilege\(j\.username/.test(SQL) && /raise exception 'job % runs as % which would lose EXECUTE/.test(SQL),
  'R3: all or nothing — a cron job that names a resolver and would lose EXECUTE makes the file refuse');

// ── the check ─────────────────────────────────────────────────────────────────────────────────────
ok(/select 'dc_resolvers',\s*\(q\.problems = ''\),\s*true,/.test(BLOCK),
  'C1: the check is ALERTABLE unconditionally — an absent job or empty history is a failure, never a quiet pass');
ok(!/\b(insert into (?!_eval)|update |delete from|create |drop )/i.test(BLOCK.replace(/insert into _eval/g, '')),
  'C2: the block only reads (pg_cron history, cron.job, grants) and writes nothing but its own _eval row');
ok(/values \('dc-resolve-canonical',\s*interval '3 hours',\s*120\)/.test(BLOCK)
   && /\('dc-resolve-geography',\s*interval '3 hours',\s*300\)/.test(BLOCK)
   && /\('dc-resolve-on-acquisition', interval '10 minutes', 120\)/.test(BLOCK),
  'C3: the measured limits — hourly jobs 3 h (one failed run is not an alert), watcher 10 min; statement limits 120 / 300 / 120');
ok(/\(s\.limit_s \* 2 \/ 3\) as warn_s/.test(BLOCK) && /p\.slowest_s > p\.warn_s/.test(BLOCK),
  'C4: slow = more than 2/3 of the job\'s own limit (80 s of 120, 200 s of 300)');
ok(/d\.status = 'succeeded'\) as last_ok/.test(BLOCK) && /d\.status = 'succeeded'\s+and d\.start_time > _now - interval '24 hours'\) as slowest_s/.test(BLOCK),
  'C5: only SUCCEEDED runs count as health, and slowness looks at the last 24 h only');
ok(/when p\.jobid is null then 'job ' \|\| p\.jobname \|\| ' is not scheduled'/.test(BLOCK)
   && /when not p\.active then 'job ' \|\| p\.jobname \|\| ' is disabled'/.test(BLOCK)
   && /coalesce\(to_char\(p\.last_ok[^)]*\) \|\| ' UTC', 'ever'\)/.test(BLOCK),
  'C6: absent, disabled and never-succeeded each fail and say so');
const fnList = ['public.dc_resolve_canonical(boolean, boolean)', 'public.dc_resolve_geography(boolean)',
                'public.dc_resolve_serialized(text)', 'public.dc_resolve_on_acquisition()'];
ok(fnList.every((f) => BLOCK.includes("('" + f + "')")) && /values \('anon'\), \('authenticated'\)/.test(BLOCK)
   && /to_regrole\(r\.rolname\) is null\s+or has_function_privilege\(r\.rolname, f\.fname, 'execute'\)/.test(BLOCK),
  'C7: it keeps all FOUR resolver functions locked against anon and authenticated, and fails if it cannot find either role');

// ── splice discipline (same as steps 12 and 13) ───────────────────────────────────────────────────
ok(SQL.includes("_anchor text := 'insert into public.pipeline_health_check as c ('")
   && /expected exactly 1 — refusing to splice/.test(SQL) && /dc_resolvers already present — nothing to do/.test(SQL)
   && /splice did not take/.test(SQL),
  'S1: one anchor, fail closed, idempotent, re-read after the splice');

// ── the timeout lives in the job command, in the two files of record ──────────────────────────────
const WATCH = stripSql(read('docs/dc-marker-loss-watcher.sql'));
ok(/cron\.schedule\('dc-resolve-geography', '35 \* \* \* \*',\s*\$c\$set statement_timeout = '300s'; select public\.dc_resolve_serialized\('geography'\)\$c\$\)/.test(WATCH),
  'T1: geography runs with a 300 s ceiling set as a SEPARATE STATEMENT ahead of the call');
ok(/v_geo is distinct from 'select count\(\*\) from public\.dc_resolve_geography\(true\)'\s+and v_geo is distinct from \$c\$select public\.dc_resolve_serialized\('geography'\)\$c\$\s+and v_geo is distinct from \$c\$set statement_timeout = '300s'; select public\.dc_resolve_serialized\('geography'\)\$c\$/.test(WATCH),
  'T2: the drift guard accepts the step 3b command, the unprefixed serialized one (production today) and the 300 s one');
const MON = stripSql(read('docs/dc-address-check-monitor.sql'));
ok(/cron\.schedule\('dc-address-check-snapshot', '50 11 \* \* \*',\s*\$c\$set statement_timeout = '300s'; select public\.dc_address_check_snapshot\(\)\$c\$\)/.test(MON),
  'T3: step 12\'s snapshot job carries its 300 s ceiling the same way (it was set inside the function, where it does nothing)');
// the invariant behind T1/T3: no function body in these files tries to raise its own statement_timeout
const fnBodies = [WATCH, MON, SQL].flatMap((s) => [...s.matchAll(/\$fn\$([\s\S]*?)\$fn\$/g)].map((m) => m[1]));
ok(fnBodies.length >= 3 && fnBodies.every((b) => !/statement_timeout/.test(b)),
  'T4: no function here sets statement_timeout inside itself — a SET in a running statement re-arms nothing (measured, run.sh H5)', `${fnBodies.length} bodies`);

// ── wiring ────────────────────────────────────────────────────────────────────────────────────────
const WF = read('.github/workflows/zip-membership-suite.yml');
ok(/bash test\/dc_resolver_hardening_pg\/run\.sh/.test(WF) && (WF.match(/'docs\/dc-resolver-hardening\.sql'/g) || []).length === 2
   && (WF.match(/'test\/dc_resolver_hardening_pg\/\*\*'/g) || []).length === 2,
  'A1: CI runs the executable proof on pull requests and pushes touching the file or its test');

console.log(`\n${n - bad}/${n} passed`);
process.exit(bad ? 1 : 0);
