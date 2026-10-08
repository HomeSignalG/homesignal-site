// DEVELOPMENT CHANGE LEDGER, REPORTABLE EVENTS — the structural half (the executable half is
// test/dev_change_reportable_pg).
//
// A PostgreSQL suite proves the view BEHAVES. What it cannot see is the rule quietly gaining a second
// home: a reader that selects from dev_change_event itself and re-derives "is this a change" (a second
// truth path, and the very mistake the 959 cross-copy events were), a view that starts writing, a
// view that judges the run by the record instead of the event, a column that stops matching the
// ledger, or the lock-down loosened. Those are pinned here on COMMENT-STRIPPED text, each with a
// positive control so a scan that matched nothing cannot pass.
// Run: node test/dev-change-reportable-structure.test.mjs
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

let n = 0, bad = 0;
const ok = (c, m, d) => { n++; if (c) console.log('PASS — ' + m); else { bad++; console.log('FAIL — ' + m + (d !== undefined ? '  [' + d + ']' : '')); } };
const ROOT = new URL('..', import.meta.url).pathname;
const read = (f) => readFileSync(join(ROOT, f), 'utf8');
const stripSql = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');

const RAW = read('docs/dev-change-reportable.sql');
const SQL = stripSql(RAW);
const LEDGER_RAW = read('docs/dev-change-ledger.sql');
const LEDGER = stripSql(LEDGER_RAW);
const SUITE = read('test/dev_change_reportable_pg/suite.sql');
const MUT = read('test/dev_change_reportable_pg/mutate.py');
const RUN = read('test/dev_change_reportable_pg/run.sh');
const WF_PATH = '.github/workflows/dev-change-reportable-suite.yml';
const WF = existsSync(join(ROOT, WF_PATH)) ? read(WF_PATH) : '';

const VIEW = (SQL.match(/create or replace view public\.dev_change_event_reportable[\s\S]*?;\n/) || [''])[0];
const ledgerEventTable = (LEDGER.match(/create table if not exists public\.dev_change_event \([\s\S]*?constraint dev_change_event_shape/) || [''])[0];
const ledgerCols = [...ledgerEventTable.matchAll(/^  ([a-z_]+)\s+(?:bigint|text|boolean|timestamptz|jsonb|date|uuid|smallint|text\[\])\b/gm)].map((m) => m[1]);
const viewCols = [...(VIEW.match(/select([\s\S]*?)\bfrom\b/) || ['', ''])[1].matchAll(/\be\.([a-z_]+)/g)].map((m) => m[1]);

// ── 0. everything under test is located (positive control for every scan below) ────────────────────
ok(SQL.length > 800 && SUITE.length > 6000 && MUT.length > 1500 && RUN.length > 800 && LEDGER.length > 4000,
  '0: the SQL of record, the Order C ledger, the suite, mutations and harness are all located and non-empty');
ok(VIEW.length > 400 && ledgerCols.length === 19 && viewCols.length === 19,
  '0b: the view and the ledger\'s event table are both found and each yields 19 columns', VIEW.length + '/' + ledgerCols.length + '/' + viewCols.length);

// ── 1. it builds on Order C, fails closed, and reads only ───────────────────────────────────────────
ok(/to_regprocedure\('public\.dev_change_observe_zip\(text, uuid\)'\) is null/.test(SQL) && /Order C/.test(RAW.split('-- ---- 1.')[0]),
  '1: the file refuses to apply unless the Order C ledger is installed, and says it builds on it');
ok(ledgerCols.every((c) => new RegExp("\\('dev_change_event', '" + c + "'\\)").test(SQL)) && /\('dev_change_run', 'baseline'\)/.test(SQL) && /\('dev_change_run', 'id'\)/.test(SQL),
  '1b: the precondition names every event column the view selects, and the run\'s id and baseline');
ok((SQL.match(/create or replace view /g) || []).length === 1 && !/create\s+(or replace\s+)?(function|table|trigger|index|materialized)/i.test(SQL),
  '2: the file creates exactly one view and nothing else (no table, function, trigger, index or materialised copy)');
ok(!/\b(insert\s+into|update\s+public|delete\s+from|truncate|alter\s+table|drop\s+(table|function|view))\b/i.test(SQL),
  '2b: the code never writes, alters or drops (rollback lives in a comment)');
ok(!/cron\./i.test(SQL) && !/pg_cron/i.test(SQL),
  '2c: no schedule is armed here');

// ── 2. the rule: the EVENT'S OWN run, an inner join, not a baseline run ─────────────────────────────
ok(/\bjoin public\.dev_change_run r on r\.id = e\.run_id\b/.test(VIEW) && /\bwhere not r\.baseline\b/.test(VIEW),
  '3: an event is reportable when the run named by ITS OWN run_id is not a baseline run');
// only the FROM ... WHERE part: the words "create or replace" in the header are not a condition
const BODY = VIEW.slice(VIEW.search(/\bfrom\b/));
const LOOSE = /\bleft\s+join\b|\bright\s+join\b|\bfull\s+join\b|\bcross\s+join\b|\bcoalesce\b|\bis\s+not\s+true\b|\bor\b/i;
ok(BODY.length > 100 && LOOSE.test(' left join x') && LOOSE.test(' where not r.baseline or true'),
  '3b-control: the body is found and the scan flags a left join and an OR');
ok(!LOOSE.test(BODY),
  '3b: an INNER join and a single plain condition — an event naming no run fails closed, and nothing can be OR-ed in');
ok(!/dev_change_project|first_run_id|last_run_id/.test(VIEW),
  '3c: the run is never taken from the project (its first or last run says nothing about this event)');
ok(!/is_baseline/.test(VIEW.replace(/select[\s\S]*?\bfrom\b/, '')),
  '3d: the event\'s own is_baseline flag is not the rule (the 959 cross-copy events carry is_baseline = false inside a baseline run)');

// ── 3. it adds no fact of its own: the event's columns, in the ledger's order ────────────────────────
ok(!/\be\.\*/.test(VIEW) && !/\br\.[a-z_]+\s*(,|\bfrom\b)/.test((VIEW.match(/select([\s\S]*?)\bfrom\b/) || ['', ''])[1]),
  '4: an explicit column list — no e.* and no column taken from the run');
ok(JSON.stringify(viewCols) === JSON.stringify(ledgerCols),
  '4b: the view\'s columns are exactly the ledger event table\'s columns, in order (a new event column must be decided here, not inherited)',
  viewCols.join(',') + ' vs ' + ledgerCols.join(','));

// ── 4. lock-down ─────────────────────────────────────────────────────────────────────────────────────
ok(/with \(security_invoker = true\)/.test(VIEW),
  '5: the view runs with the caller\'s rights');
ok(/revoke all on public\.dev_change_event_reportable from public, anon, authenticated, service_role;/.test(SQL)
   && /grant select on public\.dev_change_event_reportable to service_role;/.test(SQL),
  '5b: revoked from everyone, then SELECT only to service_role');
ok(!/grant[^;]*\bto\b[^;]*\b(anon|authenticated|public)\b/i.test(SQL),
  '5c: nothing is ever granted to anon, authenticated or PUBLIC');

// ── 5. no locality, no lifecycle, no classifier ──────────────────────────────────────────────────────
const localisms = SQL.match(/\b(nyc|new york|manhattan|brooklyn|bronx|queens|staten|dob|market|socrata|arcgis|legistar|granicus|civicplus|tucson|phoenix|denver)\b/gi) || [];
ok(localisms.length === 0, '6: no city, market or source-vendor literal', localisms.join(','));
ok(!/'(proposed|approved|operating|unknown)'/.test(SQL) && !/lifecycle/i.test(SQL) && !/event_type\s*(=|in)/i.test(SQL) && !/\bmaterial\s*(=|and|or)/i.test(SQL),
  '6b: no lifecycle key and no event-type or materiality filter (ruling R2; hero eligibility stays a reader decision)');

// ── 6. ONE reader path: nothing else selects from the raw event table ────────────────────────────────
// A reader that reads dev_change_event itself has to re-derive "is this a change", and the national
// baseline showed how that goes wrong. Scan every place code or SQL can live.
const walk = (dir, out = []) => {
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) return out;
  for (const f of readdirSync(abs)) {
    const p = join(abs, f);
    if (f === 'node_modules' || f === '.git') continue;
    if (statSync(p).isDirectory()) walk(join(dir, f), out); else out.push(relative(ROOT, p));
  }
  return out;
};
const CODE_DIRS = ['lib', 'scripts', 'supabase', 'partials', 'bluesky'];
const rootFiles = readdirSync(ROOT).filter((f) => /\.(html|js|mjs|ts)$/.test(f));
const sqlDocs = readdirSync(join(ROOT, 'docs')).filter((f) => f.endsWith('.sql')).map((f) => 'docs/' + f);
const scanned = [...CODE_DIRS.flatMap((d) => walk(d)), ...rootFiles, ...sqlDocs];
const mentions = scanned.filter((f) => /\.(sql|js|mjs|ts|html|py|sh|yml|json)$/.test(f) && /\bdev_change_event\b/.test(readFileSync(join(ROOT, f), 'utf8')));
// docs/dev-change-copy-conflicts-apply.sql is the GENERATED production upgrade: the whole ledger file verbatim plus a guard and a
// post-condition (test/dev-change-ledger-structure.test.mjs 9j pins that it is exactly that, so it can name the table only as the ledger does).
const ALLOWED = ['docs/dev-change-baseline.sql', 'docs/dev-change-copy-conflicts-apply.sql', 'docs/dev-change-ledger.sql', 'docs/dev-change-reportable.sql'];
ok(scanned.length > 50 && mentions.includes('docs/dev-change-ledger.sql'),
  '7-control: the scan covers the code directories, the root files and every docs SQL, and it finds the ledger itself', scanned.length + ' files, ' + mentions.length + ' mention(s)');
ok(mentions.every((f) => ALLOWED.includes(f)),
  '7: no reader, script, page or function selects from dev_change_event — the only files that name it are the ledger (and its generated upgrade), this view and the baseline driver', mentions.filter((f) => !ALLOWED.includes(f)).join(','));
const baselineMentions = (stripSql(read('docs/dev-change-baseline.sql')).match(/.*\bdev_change_event\b.*/g) || []);
ok(baselineMentions.length === 1 && /pg_total_relation_size\('public\.dev_change_event'\)/.test(baselineMentions[0]) && !/\bfrom\s+public\.dev_change_event\b/.test(stripSql(read('docs/dev-change-baseline.sql'))),
  '7b: the baseline driver names the event table once, only to measure its SIZE (the capacity gate), and never reads a row from it');

// ── 7. rollback names the view ─────────────────────────────────────────────────────────────────────────
ok(RAW.slice(RAW.lastIndexOf('-- ROLLBACK')).includes('drop view if exists public.dev_change_event_reportable;'),
  '8: the ROLLBACK block names the view');

// ── 8. the suite, its mutations and its workflow are real and wired ───────────────────────────────────
const checks = new Set([...SUITE.matchAll(/pg_temp\._ck\(\s*'(R\d+[a-z]?)\b/g)].map((m) => m[1])).size + (SUITE.match(/'R10b? an? (update|delete)/g) || []).length;
const mutNames = [...MUT.matchAll(/^    '([a-z_0-9]+)': \[/gm)].map((m) => m[1]);
ok(checks >= 18, '9: the executable suite carries at least 18 checks', checks);
ok(mutNames.length >= 12 && new Set(mutNames).size === mutNames.length, '9b: at least 12 distinct prohibited mutations', mutNames.length);
ok(['no_baseline_filter', 'flag_instead_of_run', 'run_less_included', 'judged_by_first_run', 'judged_by_last_run', 'view_not_invoker']
     .every((m) => mutNames.includes(m)),
  '9c: the mutations that matter most are all present — the baseline filter, the is_baseline shortcut, the run-less event, the record-level run, invoker rights');
ok(/\*disposable\*/.test(RUN) && /mutated="\$\(python3/.test(RUN) && /SURVIVED/.test(RUN) && /REFUSED without the Order C ledger/.test(RUN),
  '9d: the harness refuses a non-disposable database, fails on any surviving mutation, and proves the refusal without the ledger');
ok(/grant usage on schema public to anon, authenticated, service_role/.test(SUITE) && /alter role service_role bypassrls/.test(SUITE),
  '9e: the suite gives the stand-in roles the schema usage and RLS bypass Supabase gives them, so a refusal can only come from the view');
ok(WF.length > 300 && /test\/dev_change_reportable_pg\/run\.sh/.test(WF) && /Refuse to run if any Supabase credential is present/.test(WF)
   && /services:\s*\n\s*postgres:/.test(WF) && !/SUPABASE_[A-Z_]+:\s*\$\{\{\s*secrets\./.test(WF),
  '9f: the workflow runs the harness against a disposable service container, holds no Supabase secret, and refuses to run if one is present');

console.log('\n' + (n - bad) + ' passed, ' + bad + ' failed of ' + n);
process.exit(bad ? 1 : 0);
