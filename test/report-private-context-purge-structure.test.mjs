// PRIVATE-CONTEXT PURGE SCHEDULE — the structural half (the executable half is test/report_private_context_purge_pg).
//
// The F2 private layer blanks a customer-entered address 90 days after the last thing that needed it. The rule was
// live and nothing ran it; docs/report-private-context-purge-schedule.sql arms it (pg_cron, every 15 minutes) and puts
// an alarm on the one existing monitor. A PostgreSQL suite proves that BEHAVES. What it cannot see is a SECOND purge
// implementation beside the audited one, a second definition of "overdue", a schedule slower than the rule needs, an
// alarm that cannot page, a check that can leak a private value into an email, a job armed without its alarm, or the
// alarm moved into GitHub Actions (which is the one place it must never live: one of the failure modes it watches for
// is "Actions will not run jobs"). Those are pinned here on COMMENT-STRIPPED text, each with a positive control so a
// scan that matched nothing cannot pass.
// Run: node test/report-private-context-purge-structure.test.mjs
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

let n = 0, bad = 0;
const ok = (c, m, d) => { n++; if (c) console.log('PASS — ' + m); else { bad++; console.log('FAIL — ' + m + (d !== undefined ? '  [' + d + ']' : '')); } };
const ROOT = new URL('..', import.meta.url).pathname;
const read = (f) => readFileSync(join(ROOT, f), 'utf8');
// A scanner, not a regex: a `--` INSIDE a string literal (the splice markers are exactly that) is not a comment, and a
// regex that cuts the line there leaves an unterminated quote that flips which text every later pin thinks is a string.
// That bug was found by mutation (a private column in the health read survived pin 3f), hence the parity control in 0c.
const stripSql = (src) => {
  let out = '', i = 0, str = false;
  while (i < src.length) {
    const c = src[i], d = src[i + 1];
    if (str) { out += c; if (c === "'" && d === "'") { out += d; i += 2; continue; } if (c === "'") str = false; i++; continue; }
    if (c === '-' && d === '-') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? src.length : e + 2; continue; }
    if (c === "'") str = true;
    out += c; i++;
  }
  return out;
};
const count = (s, re) => (s.match(re) || []).length;

const RAW = read('docs/report-private-context-purge-schedule.sql');
// the monitor block lives inside a dollar-quoted string and its own comments are DATA there, so strip comments from the
// whole file first and look inside the strings second
const SQL = stripSql(RAW);
const SUITE = read('test/report_private_context_purge_pg/suite.sql');
const MUT = read('test/report_private_context_purge_pg/mutate.py');
const RUN = read('test/report_private_context_purge_pg/run.sh');
const WF = read('.github/workflows/report-snapshot-suite.yml');
const F2 = stripSql(read('docs/report-private-context.sql'));

const section = (start, end) => { const a = SQL.indexOf(start); const b = SQL.indexOf(end, a + 1); return a >= 0 && b > a ? SQL.slice(a, b) : ''; };
const PRE = section('do $pre$', '$pre$;');
const HEALTH = section('create or replace function public.report_private_context_purge_health', 'revoke all on function public.report_private_context_purge_health');
const CRON = section('do $cron$', '$cron$;');
const MIG = section('do $mig$', '$mig$;');
const BLOCK = section('$blk$', '$blk$;');

// ── 0. everything under test is located (positive control for every scan below) ───────────────────────────────────
ok(RAW.length > 7000 && SQL.length > 4500 && SUITE.length > 12000 && MUT.length > 5000 && RUN.length > 3000,
  '0: the SQL of record, the suite, the mutations and the harness are all located and non-empty');
ok([PRE, HEALTH, CRON, MIG, BLOCK].every((s) => s.length > 200), '0b: every section of the file is found',
  [PRE, HEALTH, CRON, MIG, BLOCK].map((s) => s.length).join('/'));

ok(count(SQL, /'/g) % 2 === 0 && count(SQL, /'/g) > 100, '0c: after comment stripping every string literal is closed (an odd quote count would mean the scan swapped strings and code)', count(SQL, /'/g));

// ── 1. the schedule: one job, one command, a period short enough for the rule ──────────────────────────────────
const SCHED = (CRON.match(/_sched\s+constant text := '([^']+)'/) || [])[1];
const CMD = (CRON.match(/_cmd\s+constant text := '([^']+)'/) || [])[1];
const NAME = (CRON.match(/_name\s+constant text := '([^']+)'/) || [])[1];
ok(SCHED === '5,20,35,50 * * * *' && CMD === 'select public.report_private_context_purge_due()' && NAME === 'report-private-context-purge',
  '1: the job is `report-private-context-purge`, fires at minutes 5/20/35/50 of every hour, and calls the F2 purge batch', [SCHED, CMD, NAME].join(' | '));
const minutes = (SCHED || '').split(' ')[0].split(',').map(Number).sort((a, b) => a - b);
const gaps = minutes.map((m, i) => (minutes[(i + 1) % minutes.length] - m + 60) % 60 || 60);
ok(minutes.length === 4 && Math.max(...gaps) === 15 && (SCHED || '').split(' ').slice(1).join(' ') === '* * * *',
  '1b: the longest gap between runs is 15 minutes (the founder\'s "no more than 90 days" is overshot by at most that), every hour of every day', gaps.join(','));
ok(count(SQL, /cron\.schedule\(/g) === 1 && count(SQL, /cron\.alter_job\(/g) === 1 && !/net\.http_(post|get)|pg_net|cron\.unschedule\(/.test(SQL),
  '1c: exactly one job is created and it is altered in place on a re-apply; nothing is dispatched to GitHub, nothing is unscheduled (the rollback lives in a comment)');
ok(/perform cron\.alter_job\(_id, schedule := _sched, command := _cmd, active := true\)/.test(CRON),
  '1d: a re-apply restores the schedule, the command AND the active flag (arming is the job of this file)');
ok(!/'\*\/\d+|\b\d+\s+\d+\s+\*\s+\*\s+\*'/.test(SCHED || ''), '1e: not a daily or once-an-hour cadence');

// ── 2. there is no second purge implementation, and no second definition of "overdue" ────────────────────────────
ok(!/\bupdate\b|\bdelete\b|\binsert\s+into\s+public\.report_private_context|\btruncate\b/i.test(HEALTH + CRON + PRE),
  '2: the health read, the schedule and the preconditions write nothing — the purge itself stays the audited F2 function');
ok(!/\b(select|perform)\s+public\.report_private_context_purge\(/.test(SQL) && count(SQL, /report_private_context_purge_due\(\)/g) === 2 && /_cmd\s+constant text := 'select public\.report_private_context_purge_due\(\)'/.test(SQL),
  '2b: this file never calls the per-context purge; the batch is named only as the job command and in the precondition that it exists (it adds no purge logic)', count(SQL, /report_private_context_purge_due\(\)/g));
ok(/c\.state = 'active' and c\.purge_due_at is not null and c\.purge_due_at <= now\(\) - p_grace/.test(HEALTH)
   && /state = 'active' and c\.purge_due_at is not null and c\.purge_due_at <= now\(\)/.test(F2),
  '2c: "overdue" is the F2 audit\'s own predicate (active, a clock, past it) plus a grace — the same words in both places, pinned so they cannot drift apart');
ok(/from public\.report_private_context_retention_check\(\) r\s+where r\.kind = 'invariant'/.test(HEALTH),
  '2d: the invariants are READ from the F2 audit function, not re-derived here');

// ── 3. the monitor: alertable, bounded, never leaking ────────────────────────────────────────────────────────────────
ok(/select 'report_private_context_retention', \(q\.problems = ''\), true,/.test(BLOCK),
  '3: the check is ALERTABLE (the third column is the literal true) and passes only when there is no problem');
ok(/begin\s+insert into _eval[\s\S]*?exception when others then\s+insert into _eval values \('report_private_context_retention', false, true,[\s\S]*?end;/.test(BLOCK),
  '3b: the check is wrapped so a failure of its own makes a FAILING row, never a dead monitor');
ok(/sqlstate/.test(BLOCK) && !/sqlerrm|get stacked diagnostics|message_text/i.test(SQL),
  '3c: the failure row carries the SQLSTATE and never the error message (a message could quote a value)');
ok(/public\.report_private_context_purge_health\(interval '1 hour'\) h/.test(BLOCK)
   && /p_grace interval default interval '1 hour'/.test(HEALTH)
   && count(SQL, /interval '1 hour'/g) === 2 && !/interval '\d+ (minute|second|day|week)/.test(SQL.replace(/p_grace interval default/g, '')),
  '3d: the grace is one hour, written twice (the function default and the monitor call) and nowhere else');
ok(60 >= 4 * Math.max(...gaps),
  '3e: the one-hour grace is at least four job periods, so a context stuck that long means the job is not purging, not that it is late');
ok(!/\b(address|normalized_address|latitude|longitude|property_keys|label)\b/.test(SQL.replace(/'(?:[^']|'')*'/g, "''")),
  '3f: no private column is named anywhere in the code of this file — the health read and the monitor can only ever return counts, a date and fixed words');
ok(!/from\s+public\.report_private_context\s+(?!c\b)/.test(BLOCK) && !/report_private_context(?!_)/.test(BLOCK.replace(/'report_private_context_retention'/g, '')),
  '3g: the monitor block reads the health function only — it names no private table');

// ── 4. the alarm is spliced the way every other check was: live definition, one anchor, fail closed, re-read ─────────
ok(/_anchor text := 'insert into public\.pipeline_health_check as c \('/.test(MIG) && /<> 1 then\s+raise exception 'anchor/.test(MIG)
   && /splice did not take/.test(MIG) && /execute replace\(_def, _anchor, _block \|\| _anchor\)/.test(MIG),
  '4: it splices into the LIVE definition at one anchor, refuses unless that anchor appears exactly once, re-reads, and refuses unless the check appears once');
ok(/position\(_begin in _def\) > 0 then\s+raise notice[^;]*already present/.test(MIG), '4b: a second apply is a no-op');
const beginMarks = [...RAW.matchAll(/'(-- >>> report_private_context_retention \(begin\))'/g)].map((m) => m[1]);
const endMarks = [...RAW.matchAll(/'(-- <<< report_private_context_retention \(end\))'/g)].map((m) => m[1]);
ok(beginMarks.length === 3 && new Set(beginMarks).size === 1 && endMarks.length === 1
   && RAW.includes('$blk$' + beginMarks[0]) && RAW.includes(endMarks[0] + '\n  $blk$'),
  '4c: the begin marker is one string in the splice, its precondition and the rollback, and the block opens and closes with exactly the markers the rollback cuts between',
  beginMarks.length + '/' + endMarks.length);

// ── 5. nothing is armed without its alarm ───────────────────────────────────────────────────────────────────────────────
const at = (s) => SQL.indexOf(s);
ok(at('do $pre$') >= 0 && at('do $pre$') < at('do $cron$'),
  '5: the preconditions come before the job is created');
ok(/is not applied/.test(PRE) && /is not there/.test(PRE) && /no single splice anchor/.test(PRE),
  '5b: it refuses, changing nothing, when the private layer, the monitor or the splice anchor is missing');
ok(at('do $pre$') < at('create or replace function public.report_private_context_purge_health') && at('create or replace function public.report_private_context_purge_health') < at('do $cron$'),
  '5c: order is preconditions, then the health read, then the job, then the splice — the job never exists without the function the alarm reads');

// ── 6. who may call what ──────────────────────────────────────────────────────────────────────────────────────────────────
ok(/language plpgsql security definer set search_path = public, pg_temp/.test(HEALTH)
   && /revoke all on function public\.report_private_context_purge_health\(interval\) from public, anon, authenticated;/.test(SQL)
   && /grant execute on function public\.report_private_context_purge_health\(interval\) to service_role;/.test(SQL)
   && !/grant[^;]*\bto\b[^;]*\b(anon|authenticated|public)\b/i.test(SQL.replace(/revoke[^;]*;/gi, '')),
  '6: the health read is SECURITY DEFINER with a pinned search_path, revoked from public/anon/authenticated by name, granted to service_role only');

// ── 7. nothing else runs this, and the alarm does not live in Actions ─────────────────────────────────────────────────────────
const walk = (d, out = []) => { for (const e of readdirSync(join(ROOT, d))) { if (['node_modules', '.git'].includes(e)) continue; const p = join(d, e); const st = statSync(join(ROOT, p)); if (st.isDirectory()) walk(p, out); else out.push(p); } return out; };
const callers = walk('.github/workflows').concat(walk('scripts'), walk('supabase')).filter((f) => /\.(ya?ml|mjs|js|ts|sql|py|sh)$/.test(f))
  .filter((f) => /report_private_context_purge(_due)?\b/.test(read(f)));
ok(callers.length === 0, '7: no workflow, script or edge function calls the purge — it runs from pg_cron, which keeps working when GitHub Actions does not', callers.join(', '));
ok(!/purge_due|purge_health|retention_check/.test(WF), '7b: the workflow only RUNS the suites; it holds no purge or alarm logic of its own');

// ── 8. the suite, the mutations and the workflow are wired and cannot be thinned silently ───────────────────────────────────────
ok(count(SUITE, /pg_temp\._ck\('/g) >= 29, '8: the suite carries at least 29 named checks', count(SUITE, /pg_temp\._ck\('/g));
ok(count(MUT, /^    '[a-z0-9_]+': \[/gm) >= 22, '8b: at least 22 prohibited mutations are registered', count(MUT, /^    '[a-z0-9_]+': \[/gm));
ok(/ROLLBACK-BEGIN/.test(RUN) && /rollback_sql/.test(RUN) && /N01/.test(RUN) && /N03/.test(RUN) && /A03/.test(RUN) && /R01/.test(RUN),
  '8c: the harness proves re-apply, re-arm, rollback and both fail-closed refusals');
ok(/docs\/report-private-context-purge-schedule\.sql/.test(WF) && /test\/report_private_context_purge_pg\/\*\*/.test(WF)
   && /report_private_context_purge_pg\/run\.sh/.test(WF) && /Refuse to run if any Supabase credential is present/.test(WF),
  '8d: the workflow runs this harness on a change to the SQL or the suite, and still refuses to run with a Supabase credential present');
ok(/dev_change_disposable/.test(WF) && !/^\s+SUPABASE_\w+:\s/m.test(WF), '8e: it addresses only the disposable container and sets no Supabase secret');

console.log(`\n${n - bad}/${n} pass`);
process.exit(bad ? 1 : 0);
