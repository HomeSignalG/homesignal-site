// DEVELOPMENT CHANGE BASELINE — the structural half (the executable half is test/dev_change_baseline_pg).
//
// A PostgreSQL suite proves the driver BEHAVES. What it cannot see is the driver quietly gaining a
// second way to decide something another owner already decides: a second ledger writer, a direct read
// of app_projects (a second ZIP universe), an armed schedule, a health LABEL with an invented
// threshold, a city or source literal, the capacity floor drifting from the one the N5 build uses, or
// the lock-down loosened. Those are pinned here on COMMENT-STRIPPED text, each with a positive
// control so a scan that matched nothing cannot pass.
// Run: node test/dev-change-baseline-structure.test.mjs
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

let n = 0, bad = 0;
const ok = (c, m, d) => { n++; if (c) console.log('PASS — ' + m); else { bad++; console.log('FAIL — ' + m + (d !== undefined ? '  [' + d + ']' : '')); } };
const ROOT = new URL('..', import.meta.url).pathname;
const read = (f) => readFileSync(join(ROOT, f), 'utf8');
const stripSql = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');

const RAW = read('docs/dev-change-baseline.sql');
const SQL = stripSql(RAW);
const LEDGER = stripSql(read('docs/dev-change-ledger.sql'));
const N5 = read('docs/n5-generation-publish.sql');
const SUITE = read('test/dev_change_baseline_pg/suite.sql');
const MUT = read('test/dev_change_baseline_pg/mutate.py');
const RUN = read('test/dev_change_baseline_pg/run.sh');
const FIXTURE = read('test/dev_change_baseline_pg/fixture.sql');
const WF_PATH = '.github/workflows/dev-change-baseline-suite.yml';
const WF = existsSync(join(ROOT, WF_PATH)) ? read(WF_PATH) : '';

const TICK = (SQL.match(/create or replace function public\.dev_change_tick\([\s\S]*?\$fn\$;/) || [''])[0];
const VIEW = (SQL.match(/create or replace view public\.dev_change_source_health[\s\S]*?;\n/) || [''])[0];

// ── 0. everything under test is located (positive control for every scan below) ───────────────
ok(SQL.length > 4000 && SUITE.length > 8000 && MUT.length > 3000 && RUN.length > 800 && FIXTURE.length > 400 && LEDGER.length > 4000,
  '0: the SQL of record, the Order C ledger it builds on, the suite, mutations, harness and fixture are all located and non-empty');
ok(TICK.length > 2500 && VIEW.length > 800, '0b: the driver function and the source-health view are both found', TICK.length + '/' + VIEW.length);

// ── 1. it builds on Order C and adds no second writer ──────────────────────────────────────────────
ok(/to_regprocedure\('public\.dev_change_observe_zip\(text, uuid\)'\) is null/.test(SQL) && /Order C/.test(RAW.split('-- ---- 1.')[0]),
  '1: the file refuses to apply unless the Order C ledger is present, and says it builds on it');
ok(!/insert\s+into\s+public\.dev_change_(project|event|run)\b/.test(SQL) && !/update\s+public\.dev_change_(project|event|run)\b/.test(SQL),
  '2: this file never writes a project, an event or a run — dev_change_observe_zip stays the ledger\'s ONLY writer');
ok((TICK.match(/public\.dev_change_observe_zip\(/g) || []).length === 1,
  '2b: the driver reaches the ledger through exactly one call to dev_change_observe_zip');
ok(!/create or replace function public\.dev_change_(observe_zip|classify|facts|fp|key_is_durable|start_run|finish_run)\b/.test(SQL),
  '2c: none of the Order C functions is redefined here');
ok((SQL.match(/insert\s+into\s+public\.dev_change_zip_cursor\b/g) || []).length === 2 && (TICK.match(/insert\s+into\s+public\.dev_change_zip_cursor\b/g) || []).length === 2,
  '2d: the cursor has exactly two writers (success and failure), both inside the driver');

// ── 2. one ZIP universe, one "the ZIP changed" clock ──────────────────────────────────────────────────────
ok(!/\bapp_projects\b/.test(SQL), '3: the driver never reads app_projects — the ledger writer does; the driver only decides WHICH ZIP');
ok(/from public\.canonical_zip_registry r/.test(TICK) && (TICK.match(/public\.canonical_zip_registry/g) || []).length === 2,
  '3b: the universe is the canonical ZIP registry, in both the selection and the remaining-count');
ok(/join public\.app_community_meta m on m\.zip = r\.zip/.test(TICK) && /m\.updated_at > c\.materialized_at/.test(TICK),
  '3c: "the ZIP changed" is app_community_meta.updated_at, the materialiser\'s own clock');
ok(/\(_baseline or c\.first_ok_at is not null\)/.test(TICK),
  '3d: a ZIP is only ever FIRST observed inside a baseline run');

// ── 3. capacity and bounds fail closed ──────────────────────────────────────────────────────────────────────
const floorMine = (TICK.match(/_floor_mb\s+constant bigint := (\d+)/) || [])[1];
const floorN5 = [...N5.matchAll(/v::bigint < (\d+) \+ \d+/g)].map((m) => m[1]);
ok(floorMine === '2048' && floorN5.length >= 2 && floorN5.every((f) => f === floorMine),
  '4: the safety floor equals the one docs/n5-generation-publish.sql uses (2,048 MB) — one convention, not two', floorMine + ' vs ' + floorN5.join(','));
ok(/if _baseline or p_verified_free_disk_mb is not null then/.test(TICK) && /CAPACITY GATE/.test(TICK),
  '4b: a baseline run cannot start without a stated free-disk figure (a supplied figure is checked on any run)');
ok(/p_ledger_budget_mb is null or p_ledger_budget_mb < 1/.test(TICK) && /_ledger >= p_ledger_budget_mb \* 1048576/.test(TICK),
  '4c: a ledger byte budget is required and enforced (a stop, not an error)');
ok(/p_max_zips > 500/.test(TICK) && /p_max_seconds > 100/.test(TICK) && /statement timeout/.test(TICK),
  '4d: a tick is bounded by ZIP count and by seconds, below the 120 s statement timeout');
ok(/exception when others then/.test(TICK) && /_tried/.test(TICK),
  '4e: a failing ZIP is isolated (sub-transaction) and never retried inside one tick');

// ── 4. no schedule, no delete, no health label, no source or city literal ──────────────────────────────────────
ok(!/cron\./i.test(SQL) && !/pg_cron/i.test(SQL) && /NO SCHEDULE IS ARMED/.test(RAW),
  '5: no recurring job is armed here (arming one is a separate reviewed act)');
ok(!/\bdelete\s+from\b/i.test(SQL) && !/\btruncate\s+(table\s+)?public\./i.test(SQL) && !/\bdrop\s+(table|function|view)\b/i.test(SQL),
  '5b: the code never deletes, truncates or drops (rollback lives in a comment)');
// The workbook's words are UPPER case. The cursor's own lowercase status 'error' means "this ZIP's
// observation failed" — a different thing, so the scan is case-sensitive for the words that collide
// (ERROR, UNKNOWN, N/A) and case-insensitive for the ones that do not.
const labelScan = (t) => [...(t.match(/'(HEALTHY|STALE|VERIFIED ZERO|PAUSED)'/gi) || []), ...(t.match(/'(ERROR|UNKNOWN|N\/A)'/g) || [])];
const labels = labelScan(SQL);
ok(labelScan("select 'ERROR', 'healthy'").length === 2 && labelScan("status in ('ok', 'error')").length === 0,
  '6-control: the label scan sees the workbook words and does not see the cursor\'s lowercase status');
ok(labels.length === 0 && /SLA_UNDEFINED/.test(RAW) && /CHANGE CONTROL/.test(RAW),
  '6: the view carries no HEALTHY/STALE/ERROR label — the workbook defines them, records NO approved SLA for the development family (SLA_UNDEFINED) and forbids an agent redefining them', labels.join(','));
const freshCols = (t) => [...t.matchAll(/\bas\s+([a-z_0-9]*fresh[a-z_0-9]*)/gi)].map((m) => m[1]);
ok(freshCols('select 1 as newest_freshness, 2 as ok_col').length === 1 && freshCols(VIEW).length === 0 && /\bas newest_filing_date\b/.test(VIEW),
  '6c: no view column is called freshness — a filing date (submitted_at) is not a freshness field, and the column says so by name');
ok(/interval '24 hours'/.test(VIEW) && /interval '14 days'/.test(VIEW) && !/interval '7 days'/.test(VIEW),
  '6d: the only evidence windows are the two the workbook itself uses (24 hours and 14 days)');
// One CASE block at a time: a regex that spans the whole view would pair a date guard with an
// unrelated `interval` in a later FILTER clause.
const caseBlocks = (t) => t.match(/\bcase\s+when[\s\S]*?\bend\b/gi) || [];
const ageCase = (t) => caseBlocks(t).filter((b) => /\binterval\b|\bdays?\b|current_date\s*-|now\(\)\s*-/i.test(b));
ok(caseBlocks(VIEW).length >= 1 && ageCase("case when x < now() - interval '9 days' then 'a' end").length === 1,
  '6b-control: the view has a CASE block to inspect, and the scan flags a CASE over an age');
ok(ageCase(VIEW).length === 0,
  '6b: the view invents no threshold (no CASE over an age)');
const localisms = SQL.match(/\b(nyc|new york|manhattan|brooklyn|bronx|queens|staten|dob|market|socrata|arcgis|legistar|granicus|civicplus|tucson|phoenix|denver)\b/gi) || [];
ok(localisms.length === 0, '7: no city, market or source-vendor literal anywhere in the driver or the view', localisms.join(','));
ok(!/'(proposed|approved|operating|unknown)'/.test(SQL) && !/lifecycle/i.test(SQL),
  '7b: no lifecycle key (ruling R2 — lifecycle stays a read-time decision in lib/project-type.js)');
ok(/where f\.kind in \('fetch_failed', 'truncated', 'retired'\)/.test(VIEW) && !/fire_/.test(VIEW),
  '8: the view reads only the failure kinds that belong to a source, never the whole-report fire kinds');
ok(/from public\.dev_refresh_source_failures f/.test(VIEW) && !/create table[^;]*failure/i.test(SQL),
  '8b: source failure evidence is READ from the refresh\'s own record; no second failure table is created');

// ── 5. lock-down ──────────────────────────────────────────────────────────────────────────────────────────────────
ok(/enable row level security/.test(SQL) && /revoke all on public\.dev_change_zip_cursor from public, anon, authenticated, service_role;/.test(SQL)
   && /grant select, insert, update on public\.dev_change_zip_cursor to service_role;/.test(SQL),
  '9: the cursor has RLS on and service_role holds only select/insert/update');
ok(/revoke all on public\.dev_change_source_health from public, anon, authenticated, service_role;/.test(SQL) && /grant select on public\.dev_change_source_health to service_role;/.test(SQL)
   && /with \(security_invoker = true\)/.test(SQL),
  '9b: the view is revoked from everyone, readable by service_role only, and runs with the caller\'s rights');
ok(!/grant[^;]*\bto\b[^;]*\b(anon|authenticated|public)\b/i.test(SQL), '9c: nothing is ever granted to anon, authenticated or PUBLIC');
ok(/like 'dev\\_change\\_%'/.test(SQL) && /revoke all on function %s from public, anon, authenticated/.test(SQL),
  '9d: every dev_change_ function (including the driver) is locked down by a COMPUTED loop');
ok(/security definer/.test(TICK) && /set search_path = public, pg_temp/.test(TICK), '9e: the driver is security definer with a pinned search_path');
ok(/fillfactor = 80/.test(SQL), '9f: the ledger project table is given room for HOT updates');

// ── 6. rollback names everything created ─────────────────────────────────────────────────────────────────────────
const rollback = RAW.slice(RAW.lastIndexOf('-- ROLLBACK'));
ok(['public.dev_change_source_health', 'public.dev_change_tick(uuid, integer, integer, bigint, bigint, integer)', 'public.dev_change_zip_cursor', 'reset (fillfactor)']
     .every((s) => rollback.includes(s)),
  '10: the ROLLBACK block names the view, the driver, the cursor and the storage parameter');

// ── 7. the suite, its mutations and its workflow are real and wired ────────────────────────────────────────────────────
const checks = (SUITE.match(/pg_temp\._ck\(\s*'D\d+/g) || []).length;
const mutNames = [...MUT.matchAll(/^    '([a-z_0-9]+)': \[/gm)].map((m) => m[1]);
ok(checks >= 35, '11: the executable suite carries at least 35 checks', checks);
ok(mutNames.length >= 25 && new Set(mutNames).size === mutNames.length, '11b: at least 25 distinct prohibited mutations', mutNames.length);
ok(/\*disposable\*/.test(RUN) && /mutated="\$\(python3/.test(RUN) && /SURVIVED/.test(RUN),
  '11c: the harness refuses a non-disposable database and fails on any mutation that survives');
ok(WF.length > 300 && /test\/dev_change_baseline_pg\/run\.sh/.test(WF) && /Refuse to run if any Supabase credential is present/.test(WF)
   && /services:\s*\n\s*postgres:/.test(WF) && !/SUPABASE_[A-Z_]+:\s*\$\{\{\s*secrets\./.test(WF),
  '11d: the workflow runs the harness against a disposable service container, holds no Supabase secret, and refuses to run if one is present');

console.log('\n' + (n - bad) + ' passed, ' + bad + ' failed of ' + n);
process.exit(bad ? 1 : 0);
