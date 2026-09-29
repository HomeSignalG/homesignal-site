// DEVELOPMENT CHANGE LEDGER — the structural half (the executable half is test/dev_change_ledger_pg).
//
// A PostgreSQL suite proves the ledger BEHAVES. What it cannot see is the ledger quietly
// gaining a second way to decide the same fact: a second writer, a stronger event word
// ("approved", "denied") inferred from weaker evidence, a retrieval clock or a coordinate
// leaking into the declared facts, a lifecycle key stored beside the canonical authority, a
// city or source literal, or the lock-down loosened. Those are pinned here on COMMENT-STRIPPED
// text, each with a positive control so a scan that matched nothing cannot pass.
// Run: node test/dev-change-ledger-structure.test.mjs
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

let n = 0, bad = 0;
const ok = (c, m, d) => { n++; if (c) console.log('PASS — ' + m); else { bad++; console.log('FAIL — ' + m + (d !== undefined ? '  [' + d + ']' : '')); } };
const ROOT = new URL('..', import.meta.url).pathname;
const read = (f) => readFileSync(join(ROOT, f), 'utf8');
const stripSql = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');

const RAW = read('docs/dev-change-ledger.sql');
const SQL = stripSql(RAW);
const SUITE = read('test/dev_change_ledger_pg/suite.sql');
const MUT = read('test/dev_change_ledger_pg/mutate.py');
const RUN = read('test/dev_change_ledger_pg/run.sh');
const FIXTURE = read('test/dev_change_ledger_pg/fixture.sql');
const WF_PATH = '.github/workflows/dev-change-ledger-suite.yml';
const WF = existsSync(join(ROOT, WF_PATH)) ? read(WF_PATH) : '';

const fn = (name) => (SQL.match(new RegExp('create or replace function public\\.' + name + '\\([\\s\\S]*?\\$(?:fn)?\\$;')) || [''])[0];

// ── 0. everything under test is located (positive control) ──────────────────────────────────────
ok(SQL.length > 4000 && SUITE.length > 4000 && MUT.length > 2000 && RUN.length > 800 && FIXTURE.length > 500,
  '0: the SQL of record, suite, mutations, harness and fixture are all located and non-empty');
ok(['dev_change_facts', 'dev_change_classify', 'dev_change_observe_zip', 'dev_change_key_is_durable'].every((f) => fn(f).length > 60),
  '0b: the four functions the rules live in are all found (positive control for every scan below)');

// ── 1. the event vocabulary is exactly three words ──────────────────────────────────────────────────────
const vocab = (SQL.match(/event_type\s+in\s*\(([^)]*)\)/) || ['', ''])[1].split(',').map((s) => s.trim().replace(/'/g, '')).sort();
ok(JSON.stringify(vocab) === JSON.stringify(['first_detected', 'source_record_updated', 'status_changed']),
  '1: the event_type CHECK admits exactly first_detected / status_changed / source_record_updated', vocab.join(','));
const stronger = SQL.match(/'(approved|denied|withdrawn|cancell?ed|completed|permit_issued|permitted|construction_started|under_construction|application_filed|demolished)'/g) || [];
ok(stronger.length === 0 && /'status_changed'/.test(SQL),
  '2: no stronger event word appears anywhere in the code — those need reviewed evidence and, for denied/withdrawn, the existing decision authority (decision.ts)', stronger.join(','));

// ── 2. the declared facts are exactly the 14 publisher/derived fields ──────────────────────────────────────────────
const FACTS = fn('dev_change_facts');
const factKeys = [...FACTS.matchAll(/'([a-z_]+)',\s*r\./g)].map((m) => m[1]).sort();
ok(factKeys.length === 14
   && JSON.stringify(factKeys) === JSON.stringify(['address', 'date_kind', 'developer', 'end_date', 'investment', 'name', 'size', 'source_ref', 'stage', 'start_date', 'status', 'submitted_at', 'type', 'type_raw']),
  '3: the declared facts are exactly the 14 named fields', factKeys.join(','));
ok(!/provenance|last_seen_at|created_at|\blat\b|\blng\b|impact|scope_text|parties|\.zip\b|\.id\b|community/.test(FACTS.replace(/create or replace function[^\n]*\n/, '')),
  '3b: no retrieval field, coordinate, score, description, id or ZIP can enter the facts');
ok(!/last_seen_at/.test(SQL),
  '3c: last_seen_at (a ZIP-refresh clock, not a change clock) is never read anywhere');

// ── 3. the ONE clock: the retrieval time carried in provenance ──────────────────────────────────────────────────────────
const OBS = fn('dev_change_observe_zip');
ok(/provenance->>'refreshed_at'/.test(OBS) && /a\.record_kind = 'development'/.test(OBS),
  '4: an observation is dated by provenance.refreshed_at and only DEVELOPMENT rows are read (facility/regulatory rows are not changes)');
ok(/observed_at <= now\(\) \+ interval '5 minutes'/.test(OBS), '4b: a future-stamped observation is refused');
ok(/o\.observed_at > o\.old_last_observed_at/.test(OBS) && /old_facts_version = _fv/.test(OBS),
  '4c: an event needs a NEWER observation and the same fact definition');

// ── 4. comparability fails closed ────────────────────────────────────────────────────────────────────────────────────────────
ok(/n_rows = 1 and g\.max_seq = 1/.test(OBS) && /comparable = p\.comparable and o\.here_comparable/.test(OBS),
  '5: a record is comparable only if durable AND alone under its key, and comparability never turns back on');
ok(/basis !~\* '\(\^\|:\)row_id\$\|MUTABLE'/.test(fn('dev_change_key_is_durable')),
  '5b: the durable-basis rule equals the ingest repo\'s NON_DURABLE_BASIS = /(^|:)row_id$|MUTABLE/i (keep them equal)');
ok(/NON_DURABLE_BASIS/.test(RAW), '5c: the SQL names the rule it must stay equal to');

// ── 5. materiality is exactly the publisher's own status / event kind ────────────────────────────────────────────────
const CLS = fn('dev_change_classify');
const mat = CLS.match(/ch\.f && array\['stage', 'date_kind'\]/g) || [];
ok(mat.length === 2 && !/\barray\[[^\]]*'(status|type|name|address)'/.test(CLS),
  '6: material = the publisher\'s stage or date_kind changed — a derived field (status, type) or a name/address edit never is', mat.length);

// ── 6. no lifecycle key is stored beside the canonical authority; no source/city literal ───────────────────────────
ok(!/lifecycle/i.test(SQL) && !/'(proposed|approved|operating|unknown)'/.test(SQL),
  '7: no lifecycle column or lifecycle key — lifecycle stays lib/project-type.js HS.canonicalLifecycle at read time (ruling R2)');
const localisms = SQL.match(/\b(nyc|new york|manhattan|brooklyn|bronx|queens|staten|dob|addresspoint|market|city|county|socrata|arcgis|legistar|granicus|civicplus)\b/gi) || [];
ok(localisms.length === 0, '8: no city, market, county or source literal anywhere in the ledger code', localisms.join(','));

// ── 7. exactly one writer, and nothing is ever removed ────────────────────────────────────────────────────────────────────────
const evInserts = (SQL.match(/insert\s+into\s+public\.dev_change_event\b/g) || []).length;
const evInsertsInWriter = (OBS.match(/insert\s+into\s+public\.dev_change_event\b/g) || []).length;
const prInserts = (SQL.match(/insert\s+into\s+public\.dev_change_project\b/g) || []).length;
ok(evInserts === 2 && evInsertsInWriter === 2 && prInserts === 1 && (OBS.match(/insert\s+into\s+public\.dev_change_project\b/g) || []).length === 1,
  '9: dev_change_observe_zip is the ONLY writer of events and projects (two event inserts, one project insert, all inside it)', evInserts + '/' + prInserts);
ok(!/\bdelete\s+from\b/i.test(SQL) && !/\btruncate\s+(table\s+)?public\./i.test(SQL) && !/\bdrop\s+(table|function)\b/i.test(SQL),
  '9b: the code never deletes, truncates or drops (rollback lives in a comment)');
ok(/create or replace trigger dev_change_event_no_update_delete/.test(SQL) && /create or replace trigger dev_change_event_no_truncate/.test(SQL),
  '9c: the event log is guarded by append-only triggers');

// ── 8. lock-down ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
ok((SQL.match(/enable row level security/g) || []).length === 3, '10: row level security is enabled on all three tables');
ok(/revoke all on public\.dev_change_run, public\.dev_change_project, public\.dev_change_event\s+from public, anon, authenticated, service_role;/.test(SQL),
  '10b: the three tables are revoked from PUBLIC, anon, authenticated AND service_role before service_role is granted back exactly what it uses');
ok(!/grant[^;]*\bto\b[^;]*\b(anon|authenticated|public)\b/i.test(SQL), '10c: nothing is ever granted to anon, authenticated or PUBLIC');
ok(/like 'dev\\_change\\_%'/.test(SQL) && /revoke all on function %s from public, anon, authenticated/.test(SQL),
  '10d: every dev_change_ function is locked down by a COMPUTED loop, not a typed list');
ok(!/grant[^;]*(delete|truncate|all)[^;]*public\.dev_change_event/i.test(SQL) && /grant select, insert\s+on public\.dev_change_event\s+to service_role;/.test(SQL),
  '10e: service_role may only read and insert events');

// ── 9. rollback lists everything that is created (a drift check) ─────────────────────────────────────────────────────────────────
const rollback = RAW.slice(RAW.lastIndexOf('-- ROLLBACK'));
const createdFns = [...SQL.matchAll(/create or replace function public\.([a-z_]+)\(/g)].map((m) => m[1]);
const createdTables = [...SQL.matchAll(/create table if not exists public\.([a-z_]+)/g)].map((m) => m[1]);
ok(createdFns.length >= 10 && createdTables.length === 3
   && createdFns.every((f) => rollback.includes('public.' + f)) && createdTables.every((t) => rollback.includes('public.' + t)),
  '11: the ROLLBACK block names every created function and table', createdFns.length + ' fns, ' + createdTables.length + ' tables');

// ── 10. the suite, its mutations and its workflow are real and wired ───────────────────────────────────────────────────────────
const checks = (SUITE.match(/pg_temp\._ck\(\s*'C\d+/g) || []).length;
const mutNames = [...MUT.matchAll(/^    '([a-z_]+)': \[/gm)].map((m) => m[1]);
ok(checks >= 30, '12: the executable suite carries at least 30 checks', checks);
ok(mutNames.length >= 20 && new Set(mutNames).size === mutNames.length, '12b: at least 20 distinct prohibited mutations', mutNames.length);
ok(/\*disposable\*/.test(RUN) && /mutated="\$\(python3/.test(RUN) && /SURVIVED/.test(RUN),
  '12c: the harness refuses a non-disposable database and fails on any mutation that survives');
ok(WF.length > 300 && /test\/dev_change_ledger_pg\/run\.sh/.test(WF) && /Refuse to run if any Supabase credential is present/.test(WF)
   && /services:\s*\n\s*postgres:/.test(WF) && !/SUPABASE_[A-Z_]+:\s*\$\{\{\s*secrets\./.test(WF),
  '12d: the workflow runs the harness against a disposable service container, holds no Supabase secret, and refuses to run if one is present');

console.log('\n' + (n - bad) + ' passed, ' + bad + ' failed of ' + n);
process.exit(bad ? 1 : 0);
