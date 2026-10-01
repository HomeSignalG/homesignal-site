// DURABLE REPORT SNAPSHOTS — the structural half (the executable halves are test/report_snapshot_pg
// for the database and test/report-snapshot.test.mjs for the module; the deletable private layer has its
// own: test/report_private_context_pg and test/report-private-context-structure.test.mjs).
//
// A PostgreSQL suite proves the table BEHAVES. What it cannot see is a second way to mint or store a
// report identity growing up beside it, a column that could hold a customer's address appearing in the
// PERMANENT table, a client that reads the table, an API role granted access, the body column drifting to
// jsonb, or the lock-down loosened. Those are pinned here on COMMENT-STRIPPED text, each with a positive
// control so a scan that matched nothing cannot pass.
// Run: node test/report-snapshot-structure.test.mjs
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative } from 'node:path';

let n = 0, bad = 0;
const ok = (c, m, d) => { n++; if (c) console.log('PASS — ' + m); else { bad++; console.log('FAIL — ' + m + (d !== undefined ? '  [' + d + ']' : '')); } };
const ROOT = new URL('..', import.meta.url).pathname;
const read = (f) => readFileSync(join(ROOT, f), 'utf8');
const stripSql = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');

const RAW = read('docs/report-snapshot.sql');
const SQL = stripSql(RAW);
const SQL_NO_STRINGS = SQL.replace(/'(?:[^']|'')*'/g, "''");   // a word inside an error message or a to_regprocedure() literal is not a statement
const PRIV_SQL = stripSql(read('docs/report-private-context.sql'));
const SUITE = read('test/report_snapshot_pg/suite.sql');
const MUT = read('test/report_snapshot_pg/mutate.py');
const RUN = read('test/report_snapshot_pg/run.sh');
const MODULE = read('supabase/functions/_shared/report-snapshot.ts');
const WF_PATH = '.github/workflows/report-snapshot-suite.yml';
const WF = existsSync(join(ROOT, WF_PATH)) ? read(WF_PATH) : '';
const TABLE = (SQL.match(/create table if not exists public\.report_snapshot \([\s\S]*?\n\);/) || [''])[0];
const WRITER = (SQL.match(/create or replace function public\.report_snapshot_issue\([\s\S]*?\nend \$\$;/) || [''])[0];
const TRIGGER_FN = (SQL.match(/create or replace function public\.report_snapshot_no_private_values\(\)[\s\S]*?\nend \$\$;/) || [''])[0];

// ── 0. everything under test is located (positive control for every scan below) ─────────────────────
ok(SQL.length > 3500 && SUITE.length > 15000 && MUT.length > 6000 && RUN.length > 3000,
  '0: the SQL of record, the suite, the mutations and the harness are all located and non-empty');
ok(TABLE.length > 500 && WRITER.length > 500 && TRIGGER_FN.length > 800, '0b: the table definition, the writer and the containment trigger are all found', TABLE.length + '/' + WRITER.length + '/' + TRIGGER_FN.length);

// ── 1. the two identifiers are two columns, and only one of them is minted here ───────────────────────
const insertCols = (WRITER.match(/insert into public\.report_snapshot as s \(([^)]*)\)/) || ['', ''])[1];
ok(/report_id\s+uuid\s+primary key,/.test(TABLE) && !/report_id[^,\n]*default/.test(TABLE)
   && (SQL_NO_STRINGS.match(/gen_random_uuid\(\)/g) || []).length === 1 && /v_id\s+uuid := gen_random_uuid\(\);/.test(WRITER),
  '1: report_id is a uuid primary key with NO column default, and the ONE gen_random_uuid() in the file is the writer\'s own variable — nothing else can mint an identity');
ok(/\breport_id\b/.test(insertCols) && /values \(v_id,/.test(WRITER) && !/\bgenerated_at\b/.test(insertCols),
  '1a: the writer inserts the id it minted itself (v_id) and lets generated_at default to the database clock', insertCols);
ok(/content_hash\s+text\s+not null/.test(TABLE)
   && /content_hash = encode\(sha256\(convert_to\(body, 'UTF8'\)\), 'hex'\)/.test(TABLE),
  '1b: content_hash is a separate column and the table enforces that it is the SHA-256 of the stored body');
ok(/\bbody\s+text\s+not null/.test(TABLE) && !/\bbody\s+jsonb\b/.test(TABLE),
  '1c: the body is TEXT — jsonb reorders keys and could never hash back to content_hash');
ok(!/\bp_report_id\b|\bp_generated_at\b|\bp_id\b|\bp_context_id\b/.test(WRITER),
  '1d: the writer has no argument for report_id, generated_at or a context id, so no caller can choose any of them');

// ── 2. one writer; nothing else stores, reads or updates the table ────────────────────────────────────
ok((SQL.match(/\binsert\s+into\s+public\.report_snapshot\b/g) || []).length === 1 && /insert\s+into\s+public\.report_snapshot\b/.test(WRITER),
  '2: the only INSERT into the table is inside the one writer');
ok(!/\bupdate\s+public\.report_snapshot\b|\bdelete\s+from\b|\btruncate\s+(table\s+)?public\.report_snapshot\b/i.test(SQL),
  '2b: the code never updates, deletes or truncates a snapshot (rollback lives in a comment)');
const drops = [...SQL_NO_STRINGS.matchAll(/\bdrop\s+(\w+)(?:\s+if exists)?\s+([^;]+);/gi)].map((m) => (m[1] + ' ' + m[2]).replace(/\s+/g, ' ').trim());
const EXPECTED_DROPS = ['column inputs', 'column property_key', 'constraint report_snapshot_inputs_object', 'constraint report_snapshot_key_named',
  'function public.report_snapshot_issue(text, text, text, jsonb, text)'];
ok(JSON.stringify([...drops].sort()) === JSON.stringify([...EXPECTED_DROPS].sort()),
  '2c: the ONLY drops are the upgrade of the Order F table — its two address-bearing columns, their two constraints, and the Order F writer — nothing else is ever dropped', drops.join(' | '));
ok(!/\bdrop\s+(table|view|trigger|policy|schema)\b/i.test(SQL) && drops.length === 5 && /alter column report_id drop default;/.test(SQL),
  '2d: no table, view, trigger or policy is dropped (positive control: the five upgrade drops and the id-default drop were found)', drops.length);
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
const scanned = [...CODE_DIRS.flatMap((d) => walk(d)), ...rootFiles, ...sqlDocs]
  .filter((f) => /\.(sql|js|mjs|ts|html|py|sh|yml|json)$/.test(f));
const codeOf = (f) => { const t = readFileSync(join(ROOT, f), 'utf8'); return f.endsWith('.sql') ? stripSql(t) : t; };
const namesTable = scanned.filter((f) => /\breport_snapshot\b/.test(codeOf(f)));
ok(scanned.length > 50 && namesTable.includes('docs/report-snapshot.sql'),
  '3-control: the scan covers the code directories, the root files and every docs SQL, and finds the SQL of record', scanned.length + ' files');
// The one reviewed reader (2026-10-01, Follow / Changes Since Report; contract §8.5): the data layer of an internal admin function.
// 3b pins that it can only SELECT the columns it needs and names the table nowhere else in code.
const FOLLOW_DATA = 'supabase/functions/follow-development-report/data.ts';
ok(namesTable.every((f) => f === 'docs/report-snapshot.sql' || f === FOLLOW_DATA),
  '3: no client, page, script, function or other SQL names the table itself in code — every consumer goes through the writer or a later, reviewed reader (the one reader is the Follow / Changes Since Report data layer)', namesTable.join(','));
{
  const t = readFileSync(join(ROOT, FOLLOW_DATA), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
  const uses = [...t.matchAll(/\breport_snapshot\b[^'"`]*/g)].map((m) => m[0]);
  // two SELECTs, one per kind of request: `changes` reads the body and identity and never the private-context handle;
  // follow / unfollow read only the handle and never the body. Neither selects an engine input or any private column.
  ok(namesTable.includes(FOLLOW_DATA) && uses.length === 2
    && uses.includes('report_snapshot?select=report_id,content_hash,report_version,generated_at,body&report_id=eq.')
    && uses.includes('report_snapshot?select=private_context_id&report_id=eq.')
    && !/method: '(PUT|PATCH|DELETE)'/.test(t),
    '3b: the one reader names the table twice, in two SELECTs for one report each (the body and identity; the context handle alone), and has no write verb (control: it does name it)', uses);
}
const callsWriter = scanned.filter((f) => /report_snapshot_issue/.test(readFileSync(join(ROOT, f), 'utf8')));
ok(callsWriter.every((f) => ['docs/report-snapshot.sql', 'supabase/functions/_shared/report-snapshot.ts'].includes(f)),
  '3c: the writer is called from one place only, the shared module', callsWriter.join(','));

// ── 4. one place mints a report identity; the two legacy fingerprint sites are named, not extended ─────
const assigners = scanned.filter((f) => !f.startsWith('test/') && /\b(draft|report|out|result)\.report_id\s*=[^=]/.test(readFileSync(join(ROOT, f), 'utf8')));
ok(JSON.stringify(assigners.sort()) === JSON.stringify(['lib/nyc-v1-report.js', 'supabase/functions/get-future-surroundings-report/allowlist.ts']),
  '4: the only code that assigns a report_id is the two legacy NYC fingerprint sites (left untouched, ruling R6) — a third one, or a new engine minting its own, fails here', assigners.join(','));

// ── 5. lock-down: system-only ───────────────────────────────────────────────────────────────────────────
ok(/alter table public\.report_snapshot enable row level security;/.test(SQL)
   && /revoke all on public\.report_snapshot from public, anon, authenticated, service_role;/.test(SQL)
   && /grant select on public\.report_snapshot to service_role;/.test(SQL),
  '5: RLS on, everything revoked, then SELECT only to service_role');
ok(!/grant[^;]*\bto\b[^;]*\b(anon|authenticated|public)\b/i.test(SQL) && !/grant[^;]*\b(insert|update|delete|truncate|all)\b[^;]*report_snapshot\b/i.test(SQL.replace(/revoke[^;]*;/gi, '')),
  '5b: nothing is granted to anon, authenticated or PUBLIC, and service_role is never granted insert, update, delete, truncate or all on the table');
ok(/like 'report\\_snapshot\\_%'/.test(SQL) && /revoke all on function %s from public, anon, authenticated/.test(SQL) && /grant execute on function %s to service_role/.test(SQL),
  '5c: every report_snapshot_ function is locked by a COMPUTED loop, then granted to service_role only');
ok(/security definer/.test(WRITER) && /set search_path = public, pg_temp/.test(WRITER), '5d: the writer is security definer with a pinned search_path');
ok(/before update or delete on public\.report_snapshot/.test(SQL) && /before truncate on public\.report_snapshot/.test(SQL),
  '5e: update, delete and truncate are refused by trigger, for every role including the owner');

// ── 6. THE PRIVACY BOUNDARY (founder decision 2026-09-29) ────────────────────────────────────────────────────────────
const cols = [...TABLE.matchAll(/^\s{2}(\w+)\s+(?:uuid|text|timestamptz|jsonb|integer)\b/gm)].map((m) => m[1]).sort();
ok(JSON.stringify(cols) === JSON.stringify(['body', 'body_bytes', 'content_hash', 'engine_inputs', 'generated_at', 'private_context_id', 'report_id', 'report_version']),
  '6: the permanent table has exactly the eight columns that may be permanent — every column is either an identity, an integrity value, a version, a time, the body, or an opaque reference', cols.join(','));
ok(!cols.some((c) => /address|street|lat|lng|coord|owner|client|email|phone|label|property|parcel|^inputs$/i.test(c)),
  '6b: no column of the permanent table could hold an address, coordinates, an owner, a client, a label or a raw request');
ok(/private_context_id\s+uuid\s+references public\.report_private_context \(context_id\),/.test(TABLE) && !/on delete|on update/i.test(TABLE),
  '6c: the private context is referenced by an opaque id with NO cascade — deleting the private context can never delete or alter a snapshot, and a context row can never be deleted from under one');
ok(/before insert on public\.report_snapshot\s+for each row execute function public\.report_snapshot_no_private_values\(\)/.test(SQL),
  '6d: the containment trigger runs BEFORE INSERT on the permanent table, for every row');
ok(/from public\.report_private_context where context_id = new\.private_context_id/.test(TRIGGER_FN)
   && /report_snapshot_norm\(new\.body\)/.test(TRIGGER_FN) && /report_snapshot_norm\(new\.engine_inputs::text\)/.test(TRIGGER_FN)
   && ['address', 'normalized_address', 'label', 'latitude', 'longitude', 'property_key'].every((f) => TRIGGER_FN.includes("'" + f + "'")),
  '6e: it reads the private context and scans BOTH the body and the engine inputs for the address, the normalized address, the label, both coordinates and every property key');
ok(/using errcode = '23514', constraint = 'report_snapshot_no_private_values'/.test(TRIGGER_FN) && /contains the private context''s %', f\b(?!,)/.test(TRIGGER_FN)
   && !/,\s*v\s*\n?\s*using/.test(TRIGGER_FN),
  '6f: its refusal names the FIELD and never the VALUE (the raise carries f, not v), under a named constraint');
ok(/public\.report_private_context_create\(p_private, 'report', v_id::text\)/.test(WRITER),
  '6g: the writer creates the private context through the private layer\'s own function, with the first need "this report" tied to the report_id it minted — one transaction, no second insert path');
ok((WRITER.match(/\bp_private\b/g) || []).length === 3 && !/insert into public\.report_private_context/i.test(SQL),
  '6h: the writer touches p_private in exactly three places (its signature, the null test, the hand-off to the private layer) and never writes the private table itself', (WRITER.match(/\bp_private\b/g) || []).length);
ok(/length\(v\) >= 3/.test(TRIGGER_FN),
  '6i: a private value shorter than three characters is not scanned (it is not an identifier, and would refuse innocent bodies)');
ok(/scale\(c\.latitude\) >= 5/.test(TRIGGER_FN) && /scale\(c\.longitude\) >= 5/.test(TRIGGER_FN),
  '6j: coordinates are scanned only at full precision (5+ decimals, about a metre)');
ok(/export const SUBJECT_RELATIVE_KEY/.test(MODULE) && /subjectRelativeKeys/.test(MODULE) && /p_private:\s*privateContext/.test(MODULE),
  '6k: the shared module refuses subject-relative keys (offsets that recover the private point, which the database cannot see) and sends the private context as p_private');

// ── 7. the upgrade of the Order F table is real, bounded and starts from production ──────────────────────────────
ok(/if exists \(select 1 from public\.report_snapshot\) then\s+raise exception 'report_snapshot: the Order F shape holds stored reports/.test(SQL),
  '7: the upgrade fails closed — it refuses, changing nothing, if a single snapshot has been stored');
const f1 = readFileSync(join(ROOT, 'test/report_snapshot_pg/f1_applied.sql'));
ok(createHash('md5').update(f1).digest('hex') === '545d7d94977ce606e0524e0922b6a096',
  '7b: the upgrade test starts from the EXACT text that is live in production (md5 545d7d94977ce606e0524e0922b6a096, read back from supabase_migrations 2026-09-29)');
ok(/upgrade_checks/.test(RUN) && /f1_applied\.sql/.test(RUN) && /REFUSED a table holding a stored report/.test(RUN),
  '7c: the harness runs the upgrade from that file — identical to a fresh install, idempotent, and refused when a report is stored');

// ── 8. additive, no schedule, no locality ───────────────────────────────────────────────────────────────────
ok(!/cron\./i.test(SQL) && !/pg_cron/i.test(SQL), '8: no schedule is armed here');
ok(![...SQL.matchAll(/\balter\s+table\s+(?:if exists\s+)?(\S+)/gi)].some((m) => m[1] !== 'public.report_snapshot'), '8b: no other table is altered');
const localisms = SQL.match(/\b(nyc|new york|manhattan|brooklyn|bronx|queens|staten|dob|socrata|arcgis|legistar|granicus|tucson|phoenix|denver)\b/gi) || [];
ok(localisms.length === 0, '8c: no city, market or source-vendor literal in the table, the trigger or the writer', localisms.join(','));
ok(/ROLLBACK/.test(RAW) && RAW.slice(RAW.lastIndexOf('-- ROLLBACK')).includes('drop table if exists public.report_snapshot;')
   && RAW.slice(RAW.lastIndexOf('-- ROLLBACK')).includes('report_snapshot_no_private_values()'),
  '8d: the ROLLBACK block names the table, the writer and the containment trigger function, and says to run before the private layer\'s');

// ── 9. the suite, its mutations and its workflow are real and wired ─────────────────────────────────────────────
const checks = new Set([...SUITE.matchAll(/pg_temp\._ck\(\s*'([A-Z]\d+[a-z]?\d*)\b/g)].map((m) => m[1])).size;
const mutNames = [...MUT.matchAll(/^    '([a-z_0-9]+)': \[/gm)].map((m) => m[1]);
ok(checks >= 55, '9: the executable suite carries at least 55 checks', checks);
ok(mutNames.length >= 50 && new Set(mutNames).size === mutNames.length, '9b: at least 50 distinct prohibited mutations', mutNames.length);
ok(['no_hash_check', 'hash_over_jsonb_text', 'caller_chooses_id', 'no_update_delete_trigger', 'service_role_can_insert', 'anon_can_read', 'writer_not_security_definer', 'constant_id',
    'containment_trigger_dropped', 'containment_ignores_the_address', 'containment_ignores_the_latitude', 'containment_ignores_engine_inputs', 'writer_swallows_the_refusal',
    'table_keeps_a_property_key_column', 'table_keeps_an_inputs_column', 'no_reference_to_the_private_context', 'reference_cascades_on_delete', 'upgrade_drops_a_table_holding_reports']
     .every((m) => mutNames.includes(m)),
  '9c: the mutations that matter most are all present — the hash check, a caller-chosen id, immutability, the direct-insert grant, anon access, definer rights, and the whole privacy boundary (each private field, the trigger, the swallowed refusal, an address-bearing column, the reference, its cascade, the upgrade guard)');
ok(/\*disposable\*/.test(RUN) && /mutated="\$\(python3/.test(RUN) && /SURVIVED/.test(RUN) && /APPLIED TWICE/.test(RUN),
  '9d: the harness refuses a non-disposable database, fails on any surviving mutation, and proves a second apply changes nothing');
ok(/grant usage on schema public to anon, authenticated, service_role/.test(SUITE) && /alter role service_role bypassrls/.test(SUITE),
  '9e: the suite gives the stand-in roles the schema usage and RLS bypass Supabase gives them, so a refusal can only come from the objects');
ok(WF.length > 300 && /test\/report_snapshot_pg\/run\.sh/.test(WF) && /test\/report_private_context_pg\/run\.sh/.test(WF) && /Refuse to run if any Supabase credential is present/.test(WF)
   && /services:\s*\n\s*postgres:/.test(WF) && !/SUPABASE_[A-Z_]+:\s*\$\{\{\s*secrets\./.test(WF),
  '9f: the workflow runs BOTH database harnesses against a disposable service container, holds no Supabase secret, and refuses to run if one is present');
ok(existsSync(join(ROOT, 'test/report_snapshot_module_mutants.py')) && (read('test/report_snapshot_module_mutants.py').match(/^    '[a-z_]+': \[/gm) || []).length >= 20,
  '9g: the module\'s own mutation script exists and carries at least 20 mutations (run by hand: python3 test/report_snapshot_module_mutants.py)');

console.log('\n' + (n - bad) + ' passed, ' + bad + ' failed of ' + n);
process.exit(bad ? 1 : 0);
