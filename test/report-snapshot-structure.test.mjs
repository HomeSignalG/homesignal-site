// DURABLE REPORT SNAPSHOTS — the structural half (the executable halves are test/report_snapshot_pg
// for the database and test/report-snapshot.test.mjs for the module).
//
// A PostgreSQL suite proves the table BEHAVES. What it cannot see is a second way to mint or store a
// report identity growing up beside it: another writer, another place that assigns a report_id, a
// client that reads the table, an API role granted access, the body column drifting to jsonb, or
// the lock-down loosened. Those are pinned here on COMMENT-STRIPPED text, each with a positive
// control so a scan that matched nothing cannot pass.
// Run: node test/report-snapshot-structure.test.mjs
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

let n = 0, bad = 0;
const ok = (c, m, d) => { n++; if (c) console.log('PASS — ' + m); else { bad++; console.log('FAIL — ' + m + (d !== undefined ? '  [' + d + ']' : '')); } };
const ROOT = new URL('..', import.meta.url).pathname;
const read = (f) => readFileSync(join(ROOT, f), 'utf8');
const stripSql = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');

const RAW = read('docs/report-snapshot.sql');
const SQL = stripSql(RAW);
const SUITE = read('test/report_snapshot_pg/suite.sql');
const MUT = read('test/report_snapshot_pg/mutate.py');
const RUN = read('test/report_snapshot_pg/run.sh');
const WF_PATH = '.github/workflows/report-snapshot-suite.yml';
const WF = existsSync(join(ROOT, WF_PATH)) ? read(WF_PATH) : '';
const TABLE = (SQL.match(/create table if not exists public\.report_snapshot \([\s\S]*?\n\);/) || [''])[0];
const WRITER = (SQL.match(/create or replace function public\.report_snapshot_issue\([\s\S]*?\n\$\$;/) || [''])[0];

// ── 0. everything under test is located (positive control for every scan below) ─────────────────────
ok(SQL.length > 2500 && SUITE.length > 9000 && MUT.length > 3000 && RUN.length > 800,
  '0: the SQL of record, the suite, the mutations and the harness are all located and non-empty');
ok(TABLE.length > 700 && WRITER.length > 400, '0b: the table definition and the writer are both found', TABLE.length + '/' + WRITER.length);

// ── 1. the two identifiers are two columns, and only one of them is minted here ───────────────────────
const insertCols = (WRITER.match(/insert into public\.report_snapshot as s \(([^)]*)\)/) || ['', ''])[1];
ok(/report_id\s+uuid\s+primary key default gen_random_uuid\(\)/.test(TABLE) && (SQL.match(/default gen_random_uuid\(\)/g) || []).length === 1
   && insertCols.length > 10 && !/\breport_id\b|\bgenerated_at\b/.test(insertCols),
  '1: report_id is a uuid primary key minted by the database\'s own default (one default in the file), and the writer\'s INSERT does not list report_id or generated_at', insertCols);
ok(/content_hash\s+text\s+not null/.test(TABLE)
   && /content_hash = encode\(sha256\(convert_to\(body, 'UTF8'\)\), 'hex'\)/.test(TABLE),
  '1b: content_hash is a separate column and the table enforces that it is the SHA-256 of the stored body');
ok(/\bbody\s+text\s+not null/.test(TABLE) && !/\bbody\s+jsonb\b/.test(TABLE),
  '1c: the body is TEXT — jsonb reorders keys and could never hash back to content_hash');
ok(!/\bp_report_id\b|\bp_generated_at\b/.test(WRITER),
  '1d: the writer has no argument for report_id or generated_at, so no caller can choose either');

// ── 2. one writer; nothing else stores, reads or updates the table ────────────────────────────────────
ok((SQL.match(/\binsert\s+into\s+public\.report_snapshot\b/g) || []).length === 1 && /insert\s+into\s+public\.report_snapshot\b/.test(WRITER),
  '2: the only INSERT into the table is inside the one writer');
ok(!/\bupdate\s+public\.report_snapshot\b|\bdelete\s+from\b|\btruncate\s+(table\s+)?public\.report_snapshot\b/i.test(SQL)
   && !/\bdrop\s+(table|function|view)\b/i.test(SQL),
  '2b: the code never updates, deletes, truncates or drops (rollback lives in a comment)');
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
const namesTable = scanned.filter((f) => /\breport_snapshot\b/.test(readFileSync(join(ROOT, f), 'utf8')));
ok(scanned.length > 50 && namesTable.includes('docs/report-snapshot.sql'),
  '3-control: the scan covers the code directories, the root files and every docs SQL, and finds the SQL of record', scanned.length + ' files');
ok(namesTable.every((f) => f === 'docs/report-snapshot.sql'),
  '3: no client, page, script or function names the table itself — every consumer goes through the writer or a later, reviewed reader', namesTable.join(','));
const callsWriter = scanned.filter((f) => /report_snapshot_issue/.test(readFileSync(join(ROOT, f), 'utf8')));
ok(callsWriter.every((f) => ['docs/report-snapshot.sql', 'supabase/functions/_shared/report-snapshot.ts'].includes(f)),
  '3b: the writer is called from one place only, the shared module', callsWriter.join(','));

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

// ── 6. additive, no schedule, no locality ───────────────────────────────────────────────────────────────────
ok(!/cron\./i.test(SQL) && !/pg_cron/i.test(SQL), '6: no schedule is armed here');
ok(!/\balter\s+table\s+(?!public\.report_snapshot\b)/i.test(SQL), '6b: no existing table is altered');
const localisms = SQL.match(/\b(nyc|new york|manhattan|brooklyn|bronx|queens|staten|dob|socrata|arcgis|legistar|granicus|tucson|phoenix|denver)\b/gi) || [];
ok(localisms.length === 0, '6c: no city, market or source-vendor literal in the table or the writer', localisms.join(','));
ok(/RollBACK|ROLLBACK/.test(RAW) && RAW.slice(RAW.lastIndexOf('-- ROLLBACK')).includes('drop table if exists public.report_snapshot;'),
  '6d: the ROLLBACK block names the table and the writer');

// ── 7. the suite, its mutations and its workflow are real and wired ─────────────────────────────────────
const checks = new Set([...SUITE.matchAll(/pg_temp\._ck\(\s*'([A-Z]\d+[a-z]?\d*)\b/g)].map((m) => m[1])).size;
const mutNames = [...MUT.matchAll(/^    '([a-z_0-9]+)': \[/gm)].map((m) => m[1]);
ok(checks >= 28, '7: the executable suite carries at least 28 checks', checks);
ok(mutNames.length >= 20 && new Set(mutNames).size === mutNames.length, '7b: at least 20 distinct prohibited mutations', mutNames.length);
ok(['no_hash_check', 'hash_over_jsonb_text', 'caller_chooses_id', 'no_update_delete_trigger', 'service_role_can_insert', 'anon_can_read', 'writer_not_security_definer', 'constant_id']
     .every((m) => mutNames.includes(m)),
  '7c: the mutations that matter most are all present — the hash check, the jsonb hash, a caller-chosen id, immutability, the direct-insert grant, anon access, definer rights, a constant id');
ok(/\*disposable\*/.test(RUN) && /mutated="\$\(python3/.test(RUN) && /SURVIVED/.test(RUN) && /APPLIED TWICE/.test(RUN),
  '7d: the harness refuses a non-disposable database, fails on any surviving mutation, and proves a second apply changes nothing');
ok(/grant usage on schema public to anon, authenticated, service_role/.test(SUITE) && /alter role service_role bypassrls/.test(SUITE),
  '7e: the suite gives the stand-in roles the schema usage and RLS bypass Supabase gives them, so a refusal can only come from the objects');
ok(WF.length > 300 && /test\/report_snapshot_pg\/run\.sh/.test(WF) && /Refuse to run if any Supabase credential is present/.test(WF)
   && /services:\s*\n\s*postgres:/.test(WF) && !/SUPABASE_[A-Z_]+:\s*\$\{\{\s*secrets\./.test(WF),
  '7f: the workflow runs the harness against a disposable service container, holds no Supabase secret, and refuses to run if one is present');

console.log('\n' + (n - bad) + ' passed, ' + bad + ' failed of ' + n);
process.exit(bad ? 1 : 0);
