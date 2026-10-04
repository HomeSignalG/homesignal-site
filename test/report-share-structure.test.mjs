// REPORT SHARE LINKS — the structural half (the executable halves are test/report_share_pg for the database and
// test/report-share.test.mjs for the module). Development Activity plan, Order J, unit J1.
//
// A PostgreSQL suite proves the primitive BEHAVES. What it cannot see is a second way to decide that a link is usable, a
// column that could hold a raw token or a visitor's identity, a caller that arrives before the unit that designs who may call,
// a second place that mints a share identity, an API role granted access, a stray reach into the snapshot or the private layer,
// or a module that grows a URL builder. Those are pinned here on COMMENT-STRIPPED text, each with a positive control so a scan
// that matched nothing cannot pass. Every pin is shown to turn red under its own mutation: test/report_share_pin_mutants.py.
// Run: node test/report-share-structure.test.mjs
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

let n = 0, bad = 0;
const ok = (c, m, d) => { n++; if (c) console.log('PASS — ' + m); else { bad++; console.log('FAIL — ' + m + (d !== undefined ? '  [' + d + ']' : '')); } };
const ROOT = new URL('..', import.meta.url).pathname;
const read = (f) => readFileSync(join(ROOT, f), 'utf8');
const stripSql = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');
const stripTs = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');

const RAW = read('docs/report-share.sql');
const SQL = stripSql(RAW);
const SQL_NO_STRINGS = SQL.replace(/'(?:[^']|'')*'/g, "''");   // a word inside an error message or a to_regprocedure() literal is not a statement
const SUITE = read('test/report_share_pg/suite.sql');
const MUT = read('test/report_share_pg/mutate.py');
const RUN = read('test/report_share_pg/run.sh');
const MODULE_RAW = read('supabase/functions/_shared/report-share.ts');
const MODULE = stripTs(MODULE_RAW);
const WF_PATH = '.github/workflows/report-snapshot-suite.yml';
const WF = existsSync(join(ROOT, WF_PATH)) ? read(WF_PATH) : '';
const SNAPSHOT_PIN = read('test/report-snapshot-structure.test.mjs');
const fn = (name) => (SQL.match(new RegExp('create or replace function public\\.' + name + '\\([\\s\\S]*?\\nend \\$\\$;')) || [''])[0];
const SHARE_TABLE = (SQL.match(/create table if not exists public\.report_share \([\s\S]*?\n\);/) || [''])[0];
const EVENT_TABLE = (SQL.match(/create table if not exists public\.report_share_event \([\s\S]*?\n\);/) || [''])[0];
const CREATE = fn('report_share_create');
const REVOKE = fn('report_share_revoke');
const RESOLVE = fn('report_share_resolve');
const GUARD = fn('report_share_guard');
const EVENT_IMM = fn('report_share_event_immutable');
const cols = (t) => [...t.matchAll(/^\s{2}(\w+)\s+(?:uuid|text|timestamptz|bigint)\b/gm)].map((m) => m[1]).sort();

// ── 0. everything under test is located (positive control for every scan below) ───────────────────────────────────────────
ok(SQL.length > 4000 && SUITE.length > 30000 && MUT.length > 8000 && RUN.length > 5000 && MODULE.length > 900,
  '0: the SQL of record, the suite, the mutations, the harness and the module are all located and non-empty');
ok(SHARE_TABLE.length > 400 && EVENT_TABLE.length > 250 && [CREATE, REVOKE, RESOLVE, GUARD, EVENT_IMM].every((f) => f.length > 120),
  '0b: both tables and all five functions are found', [SHARE_TABLE, EVENT_TABLE, CREATE, REVOKE, RESOLVE, GUARD, EVENT_IMM].map((f) => f.length).join('/'));
ok(/report_share may only be revoked, once/.test(SQL) && /report_share_event is append-only/.test(SQL),
  '0c: the comment stripper kept the error messages inside the SQL (it did not swap strings and comments)');

// ── 1. the token is never stored; the identity is the writer's ──────────────────────────────────────────────────────────
ok(JSON.stringify(cols(SHARE_TABLE)) === JSON.stringify(['created_at', 'expires_at', 'report_id', 'revoked_at', 'share_id', 'token_sha256']),
  '1: the share table has exactly six columns — the ones that may exist — and a token HASH among them, never a token', cols(SHARE_TABLE).join(','));
ok(/token_sha256\s+text\s+not null,/.test(SHARE_TABLE) && /constraint report_share_hash_shape\s+check \(token_sha256 ~ '\^\[0-9a-f\]\{64\}\$'\)/.test(SHARE_TABLE)
   && /constraint report_share_hash_unique\s+unique \(token_sha256\)/.test(SHARE_TABLE) && /report_id\s+uuid\s+not null,/.test(SHARE_TABLE),
  '1b: the hash is NOT NULL, must be exactly 64 lower-case hex digits (a 43-character token cannot be stored by mistake) and is UNIQUE; the report is NOT NULL');
ok(/share_id\s+uuid\s+primary key,/.test(SHARE_TABLE) && !/share_id[^,\n]*default/.test(SHARE_TABLE)
   && (SQL_NO_STRINGS.match(/gen_random_uuid\(\)/g) || []).length === 1 && /v_id uuid := gen_random_uuid\(\);/.test(CREATE),
  '1c: share_id is a uuid primary key with NO column default, and the ONE gen_random_uuid() in the file is the writer\'s own variable — nothing else can mint a share identity');
ok(/\bshare_id\b/.test((CREATE.match(/insert into public\.report_share \(([^)]*)\)/) || ['', ''])[1]) && /values \(v_id,/.test(CREATE)
   && !/\bp_share_id\b|\bp_id\b|\bp_share\b|\bp_created_at\b|\bp_revoked_at\b/.test(CREATE),
  '1d: the writer inserts the id it minted (v_id) and has no argument for an id, a creation time or a revocation');
ok((CREATE.match(/^create or replace function public\.report_share_create\(([^)]*)\)/m) || ['', ''])[1].split(',').map((a) => a.trim().split(' ')[0]).join(',') === 'p_report,p_token_sha256,p_expires_at',
  '1e: the writer has exactly three arguments — the report, the hash and an optional expiry');
ok(/p_expires_at timestamptz default null/.test(CREATE) && /values \(v_id, p_report, p_token_sha256, p_expires_at\);/.test(CREATE),
  '1f: the expiry is optional and is passed through untouched — the writer applies no default expiry of its own');

// ── 2. nothing that could identify a client, an owner or a visitor ───────────────────────────────────────────────────────────
ok(JSON.stringify(cols(EVENT_TABLE)) === JSON.stringify(['at', 'event_id', 'kind', 'share_id']),
  '2: the audit log has exactly four columns and no free-text one', cols(EVENT_TABLE).join(','));
ok(![...cols(SHARE_TABLE), ...cols(EVENT_TABLE)].some((c) => /address|street|lat|lng|coord|owner|client|email|phone|label|property|parcel|actor|user|agent|referrer|note|reason|detail|message|comment|^ip$|_ip$|^ip_/i.test(c))
   && [...cols(SHARE_TABLE), ...cols(EVENT_TABLE)].filter((c) => /token/i.test(c)).join(',') === 'token_sha256',
  '2b: no column of either table could hold an address, coordinates, an owner, a client, a label, an actor, an IP address, a user agent, a referrer or a note — and the only column that mentions a token is the hash');
ok(/constraint report_share_event_kind\s+check \(kind in \('created', 'revoked'\)\)/.test(EVENT_TABLE) && /kind\s+text\s+not null,/.test(EVENT_TABLE)
   && (EVENT_TABLE.match(/\btext\b/g) || []).length === 1,
  '2c: the one text column, kind, is restricted by a CHECK to exactly two words — created and revoked — so the log cannot hold anything else, not even by mistake. Nothing records that a link was OPENED');

// ── 3. one writer for each thing ────────────────────────────────────────────────────────────────────────────────────────────
ok((SQL.match(/\binsert\s+into\s+public\.report_share\b(?!_)/g) || []).length === 1 && /insert\s+into\s+public\.report_share\b(?!_)/.test(CREATE),
  '3: the only INSERT into the share table is inside the writer');
ok((SQL.match(/\bupdate\s+public\.report_share\b(?!_)/g) || []).length === 1 && /update public\.report_share set revoked_at = now\(\) where share_id = p_share;/.test(REVOKE),
  '3b: the only UPDATE of the share table is inside the revoke, and it sets revoked_at and nothing else');
ok((SQL.match(/\binsert\s+into\s+public\.report_share_event\b/g) || []).length === 2
   && /insert into public\.report_share_event \(share_id, kind\) values \(v_id, 'created'\);/.test(CREATE)
   && /insert into public\.report_share_event \(share_id, kind\) values \(p_share, 'revoked'\);/.test(REVOKE),
  '3c: the audit log is written in exactly two places — the writer ("created") and the revoke ("revoked") — and nowhere else');
ok(!/\bdelete\s+from\b/i.test(SQL) && !/\btruncate\b/i.test(SQL.replace(/before truncate/gi, '')) && !/\bdrop\s+(table|view|trigger|policy|schema|function|column|constraint)\b/i.test(SQL),
  '3d: the SQL never deletes a row, truncates a table or drops an object (the rollback lives in a comment)');
ok(/select \* into s from public\.report_share where share_id = p_share for update;/.test(REVOKE) && /raise exception 'report_share: no such share' using errcode = '23503';/.test(REVOKE)
   && /if s\.revoked_at is not null then\s+return false;\s+end if;/.test(REVOKE) && /return true;/.test(REVOKE),
  '3e: revoke locks the row (two concurrent revokes write one event), raises for a share that does not exist (never a quiet false), and returns false without writing when it was already revoked');
ok(/\bperform\b/i.test(SQL) === false && !/report_share_event.*kind\s*=\s*'viewed'/.test(SQL),
  '3f: no function calls another (no PERFORM): create and revoke touch only the share tables');

// ── 4. the guard: one update, never a delete or a truncate ────────────────────────────────────────────────────────────────────
ok(/if tg_op = 'UPDATE' then\s+if old\.revoked_at is null and new\.revoked_at is not null\s+and new\.share_id = old\.share_id and new\.report_id = old\.report_id\s+and new\.token_sha256 = old\.token_sha256 and new\.created_at = old\.created_at\s+and new\.expires_at is not distinct from old\.expires_at then\s+return new;\s+end if;\s+end if;\s+raise exception 'report_share may only be revoked, once \(% refused\)', tg_op;/.test(GUARD),
  '4: the guard allows exactly ONE update — revoked_at from null to a time with the share_id, report, hash, creation time and EXPIRY all unchanged — and refuses everything else, including every delete and truncate');
ok(/raise exception 'report_share_event is append-only \(% refused\)', tg_op;/.test(EVENT_IMM) && !/return\b/.test(EVENT_IMM.replace(/returns trigger/, '')),
  '4b: the event guard has no way out — it raises for every operation it is attached to');
const trg = (name, timing, table, level, f) => new RegExp('create or replace trigger ' + name + '\\s+before ' + timing + ' on public\\.' + table + '\\s+for each ' + level + ' execute function public\\.' + f + '\\(\\);').test(SQL);
ok(trg('report_share_only_revoke', 'update or delete', 'report_share', 'row', 'report_share_guard')
   && trg('report_share_no_truncate', 'truncate', 'report_share', 'statement', 'report_share_guard')
   && trg('report_share_event_no_change', 'update or delete', 'report_share_event', 'row', 'report_share_event_immutable')
   && trg('report_share_event_no_truncate', 'truncate', 'report_share_event', 'statement', 'report_share_event_immutable'),
  '4c: update, delete and truncate are refused by trigger on BOTH tables, for every role including the owner (a truncate trigger on the share table is belt and braces: PostgreSQL itself refuses a plain truncate while the event table references it)');

// ── 5. what the tables refer to ──────────────────────────────────────────────────────────────────────────────────────────────────
ok(/constraint report_share_report_fk\s+foreign key \(report_id\) references public\.report_snapshot \(report_id\),/.test(SHARE_TABLE)
   && /constraint report_share_event_share_fk foreign key \(share_id\) references public\.report_share \(share_id\),/.test(EVENT_TABLE)
   && (SQL.match(/\breferences\b/g) || []).length === 2 && !/on delete|on update/i.test(SQL),
  '5: a share points at its stored report by foreign key and an event at its share — those are the ONLY two references in the file — and neither cascades (a share can never be deleted by deleting anything it refers to)');

// ── 6. resolve is the one decision ──────────────────────────────────────────────────────────────────────────────────────────────────
ok(/returns table \(status text, report_id uuid\)\s+language plpgsql stable security definer set search_path = public, pg_temp/.test(RESOLVE),
  '6: resolve returns exactly (status, report_id), is STABLE, and is security definer with a pinned search_path — it cannot return a body, a private-context handle, an address, a share_id or a time, and it cannot write');
ok(!/\b(insert|update|delete)\b/i.test(RESOLVE) && (RESOLVE.match(/\bfrom public\.report_share\b/g) || []).length === 1 && !/report_snapshot|report_share_event/.test(RESOLVE),
  '6b: resolve reads the share table once and nothing else — never the snapshot, never the audit log — and writes nothing');
{
  const i = (s) => RESOLVE.indexOf(s);
  ok(i("'UNKNOWN'") > -1 && i("'UNKNOWN'") < i("s.revoked_at is not null") && i("s.revoked_at is not null") < i("s.expires_at is not null") && i("s.expires_at is not null") < i("'ACTIVE'")
     && JSON.stringify([...RESOLVE.matchAll(/'([A-Z_]+)'::text/g)].map((m) => m[1]).sort()) === JSON.stringify(['ACTIVE', 'EXPIRED', 'REVOKED', 'UNKNOWN']) && /s\.expires_at <= now\(\)/.test(RESOLVE),
    '6c: the four statuses are exactly ACTIVE, EXPIRED, REVOKED and UNKNOWN; revoked is decided BEFORE expired (revoked wins); and an expiry that has been reached (<= now) is EXPIRED');
}
ok((RESOLVE.match(/null::uuid/g) || []).length === 3 && /return query select 'ACTIVE'::text, s\.report_id;/.test(RESOLVE) && (RESOLVE.match(/s\.report_id/g) || []).length === 1,
  '6d: the report_id is returned ONLY for ACTIVE — a dead or unknown link is given null, so it gets no handle on any report');
ok(/where token_sha256 = p_token_sha256;/.test(RESOLVE) && !/\b(lower|upper|trim|btrim|substr|left|right)\s*\(/i.test(RESOLVE),
  '6e: the hash is matched exactly as given — never normalised — so only the exact lower-case hash resolves');

// ── 7. this file reaches into nothing it depends on ───────────────────────────────────────────────────────────────────────────────
ok((SQL_NO_STRINGS.match(/\breport_snapshot\b/g) || []).length === 1 && /references public\.report_snapshot \(report_id\)/.test(SQL_NO_STRINGS)
   && !/\b(select|insert|update|delete|truncate)\b[^;]*\breport_snapshot\b/i.test(SQL_NO_STRINGS)
   && !/report_snapshot_/.test(SQL_NO_STRINGS) && !/\bgrant\b[^;]*report_snapshot/i.test(SQL_NO_STRINGS),
  '7: the snapshot is named ONCE in code, as the foreign-key reference, and is never selected, inserted, updated, deleted, truncated, granted or called — this file stores a pointer and never reads a report (the precondition names it only inside a string)');
ok(!/report_private_context/i.test(SQL) && !/report_private_context/i.test(MODULE_RAW),
  '7b: neither the SQL nor the module names ANY private-layer object or function — creating a share opens no need and starts no clock, and a purge of the private layer cannot reach a share');
ok([...SQL_NO_STRINGS.matchAll(/\balter\s+table\s+(?:if exists\s+)?(\S+)\s+(\w+)/gi)].every((m) => /^public\.report_share(_event)?$/.test(m[1]) && m[2].toLowerCase() === 'enable')
   && (SQL_NO_STRINGS.match(/\balter\s+table\b/gi) || []).length === 2,
  '7c: the file alters exactly two tables, its own, and only to enable row-level security — it never alters the snapshot or the private layer');
ok(!/cron\./i.test(SQL) && !/pg_cron/i.test(SQL) && !/net\.http/i.test(SQL) && !/\bpg_notify\b|\blisten\b/i.test(SQL),
  '7d: no schedule is armed and no network call is made — nothing here runs on its own');
{
  const loc = SQL.match(/\b(nyc|new york|manhattan|brooklyn|bronx|queens|staten|dob|socrata|arcgis|legistar|granicus|tucson|phoenix|denver)\b/gi) || [];
  ok(loc.length === 0, '7e: no city, market or source-vendor literal', loc.join(','));
}

// ── 8. lock-down: system-only ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
ok(['report_share', 'report_share_event'].every((t) => new RegExp('alter table public\\.' + t + '\\s+enable row level security;').test(SQL)
     && new RegExp('revoke all on public\\.' + t + '\\s+from public, anon, authenticated, service_role;').test(SQL)),
  '8: both tables have RLS on (and no policy exists) and every privilege revoked from public, anon, authenticated and service_role');
{
  const grants = [...SQL.matchAll(/^grant\s+(.*?)\s+on\s+(\S+)\s+to\s+(.*?);/gim)].map((m) => m[1] + ' | ' + m[2] + ' | ' + m[3]);
  ok(JSON.stringify(grants.sort()) === JSON.stringify(['select | public.report_share | service_role', 'select | public.report_share_event | service_role']) && !/\bcreate policy\b/i.test(SQL),
    '8b: the ONLY table grants are SELECT on the two tables to service_role — no INSERT, UPDATE or DELETE to anyone, and nothing to anon, authenticated or PUBLIC', grants.join(' ; '));
}
ok(/relkind = 'S' and c\.relname like 'report\\_share\\_%'/.test(SQL) && /revoke all on sequence %s from public, anon, authenticated, service_role/.test(SQL)
   && /format\('%I\.%I', n\.nspname, c\.relname\)/.test(SQL),
  '6a2: the identity sequence behind report_share_event.event_id is revoked from public, anon, authenticated AND service_role by a COMPUTED, schema-qualified loop over this file\'s own prefix (rule 9: nothing here is readable or writable by an API role)');
ok(/p\.proname like 'report\\_share\\_%'/.test(SQL) && /revoke all on function %s from public, anon, authenticated/.test(SQL) && /grant execute on function %s to service_role/.test(SQL)
   && (SQL.match(/\bgrant execute\b/g) || []).length === 1,
  '8c: every report_share_ function is locked by a COMPUTED loop (the snapshot and private-layer loops do not match this prefix), then granted to service_role only — and no function is granted anywhere else');
{
  const defs = ['report_share_create', 'report_share_revoke', 'report_share_resolve'].filter((f) => new RegExp(f + '\\([\\s\\S]*?security definer set search_path = public, pg_temp').test(SQL));
  ok(defs.length === 3 && (SQL.match(/security definer/g) || []).length === 3 && (SQL.match(/set search_path = public, pg_temp/g) || []).length === 3,
    '8d: exactly the three functions that touch shares are security definer with a pinned search_path (the two trigger functions are not)', defs.join(','));
}

// ── 9. additive, reversible ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
ok(/if to_regclass\('public\.report_snapshot'\) is null then\s+raise exception 'report_share: apply docs\/report-snapshot\.sql first/.test(SQL),
  '9: the file fails closed unless the snapshot table exists');
ok((SQL.match(/create table if not exists/g) || []).length === 2 && !/create table (?!if not exists)/.test(SQL) && !/create function\b/.test(SQL) && (SQL.match(/create or replace trigger/g) || []).length === 4,
  '9b: every object is created idempotently (create table if not exists, create or replace function and trigger), so applying the file twice is a no-op');
{
  const tail = RAW.slice(RAW.indexOf('-- ROLLBACK-BEGIN'));
  ok(/-- ROLLBACK-END/.test(tail) && /drop function if exists public\.report_share_resolve\(text\), public\.report_share_revoke\(uuid\)/.test(tail)
     && /public\.report_share_create\(uuid, text, timestamptz\)/.test(tail) && /drop table if exists public\.report_share_event, public\.report_share;/.test(tail)
     && /drop function if exists public\.report_share_guard\(\), public\.report_share_event_immutable\(\);/.test(tail) && !/report_snapshot|report_private_context/.test(tail.replace(/^-- ROLLBACK-BEGIN/, '')),
    '9c: the ROLLBACK footer (between its markers, run by the harness) drops both tables and all five functions and names nothing of the snapshot or the private layer');
}

// ── 10. NO CALLER: nothing uses the primitive until the unit that designs who may call it ─────────────────────────────────────────────────────
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
const scanned = [...CODE_DIRS.flatMap((d) => walk(d)), ...rootFiles, ...sqlDocs].filter((f) => /\.(sql|js|mjs|ts|html|py|sh|yml|json)$/.test(f));
const codeOf = (f) => { const t = readFileSync(join(ROOT, f), 'utf8'); return f.endsWith('.sql') ? stripSql(t) : t; };
const namesShare = scanned.filter((f) => /\breport_share\w*/.test(codeOf(f)));
ok(scanned.length > 50 && scanned.includes('supabase/functions/_shared/report-snapshot.ts') && namesShare.includes('docs/report-share.sql'),
  '10-control: the scan covers the code directories, the root files and every docs SQL (it reaches the shared edge-function directory) and finds the SQL of record', scanned.length + ' files');
// Build step 8 is the unit this pin was waiting for ("the unit that designs who may call"). It names exactly three files: the SQL of record, the
// delivery SQL that gives it an owner, a lifetime and a reader (docs/report-share-delivery.sql), and the ONE edge module that calls them
// (_shared/share-reads.ts). No page, script, workflow or other function names a share object; test/report-share-delivery-structure.test.mjs
// pins what those two additions may and may not do.
// Build step 11 adds a fourth: docs/brokerage-billing.sql, which names report_share_open twice and does nothing else with it: once in its precondition (the function
// must exist) and once in the list of ownership readers whose bodies it re-reads from the catalog so they read the one ownership view. It neither creates, revokes,
// calls nor resolves a share; test/brokerage_billing_pg proves the splice leaves the reader's attributes and behaviour as they were.
const SHARE_FILES = ['docs/brokerage-billing.sql', 'docs/report-share-delivery.sql', 'docs/report-share.sql', 'supabase/functions/_shared/share-reads.ts'];
ok(JSON.stringify([...namesShare].sort()) === JSON.stringify(SHARE_FILES)
   && (codeOf('docs/brokerage-billing.sql').match(/\breport_share\w*/g) || []).join() === 'report_share_open,report_share_open'
   && !/\b(create\s+(or\s+replace\s+)?function|insert\s+into|update|delete\s+from|select[^;]*from)\s+(public\.)?report_share/i.test(codeOf('docs/brokerage-billing.sql')),
  '10: nothing outside the SQL of record, the delivery SQL, the one share-reads module and (build step 11) the billing SQL, which names the client read twice and never creates, calls or writes a share, names a share object or function — no page, script, other edge function or other SQL creates, revokes or resolves a share', namesShare.join(','));
const importsModule = scanned.filter((f) => f !== 'supabase/functions/_shared/report-share.ts' && /report-share(\.ts|\.js)?['"`]/.test(readFileSync(join(ROOT, f), 'utf8')));
// The scan above stops at the code directories. A workflow that curls the RPC, or a data file that calls it, is also a caller, so the
// FUNCTION names (not the table names, which this unit's own workflow path filters mention) are searched in the places a caller could hide.
const HIDING = [...walk('.github'), ...walk('data'), ...walk('docs').filter((f) => /\.(md|mjs|js|json|yml)$/.test(f))];
const callsFunction = HIDING.filter((f) => /report_share_(create|revoke|resolve)\b|rpc\/report_share/.test(readFileSync(join(ROOT, f), 'utf8')) && f !== 'docs/development-activity-status-2026-09-30.md'
  && !/^docs\/(report-snapshot-contract|report-private-context-contract|development-activity-)/.test(f));
ok(HIDING.length > 30 && HIDING.some((f) => f.startsWith('.github/workflows/')) && callsFunction.length === 0,
  '10c: no workflow, data file or script-like document calls a share function or its RPC route (the design documents that DESCRIBE the functions are exempt by name; a workflow or data file is not)', HIDING.length + ' files; ' + callsFunction.join(','));
ok(existsSync(join(ROOT, 'supabase/functions/_shared/report-share.ts')) && JSON.stringify(importsModule) === JSON.stringify(['supabase/functions/_shared/share-reads.ts']),
  '10b: the share module (the token mint, shape and hash) has exactly ONE importer, _shared/share-reads.ts — the two functions that serve a link (the agent\'s, behind a sign-in, and the client\'s, behind the token itself) reach it only through that file', importsModule.join(','));
{
  const callers = scanned.filter((f) => /issueSnapshot|report_snapshot_issue/.test(readFileSync(join(ROOT, f), 'utf8')));
  ok(callers.length > 0 && !callers.includes('docs/report-share.sql') && !callers.includes('supabase/functions/_shared/report-share.ts')
     && !/issueSnapshot|report_snapshot_issue/.test(RAW) && !/issueSnapshot|report_snapshot_issue/.test(MODULE_RAW),
    '10c: neither the SQL nor the module calls the snapshot writer — a share never issues a report (control: the snapshot module and its writer are found by the same scan)', callers.length);
}

// ── 11. the module does three things and nothing else ─────────────────────────────────────────────────────────────────────────────────────────
ok(!/^\s*(import|export\s+\*|export\s+\{[^}]*\}\s+from)\b/m.test(MODULE) && !/\brequire\(|\bimport\(/.test(MODULE),
  '11: the module imports nothing — it has no client library, no helper and no dependency to reach the database or a network by');
ok(!/\bfetch\s*\(|XMLHttpRequest|WebSocket|\bDeno\b|\bprocess\b|\.env\b|\blocation\b|localStorage|sessionStorage|document\./.test(MODULE),
  '11b: it reads no environment, no storage, no page, makes no request and opens no connection');
ok(!/https?:|new URL|URLSearchParams|\.href\b|\.origin\b|\bhash\s*=|\?\s*\w+=/.test(MODULE) && !/\b(address|zip|radius|latitude|longitude|lat|lng|coord\w*|property|parcel|owner|client|label)\b/i.test(MODULE),
  '11c: it builds no URL and has no identifier that could take an address, a ZIP, a radius, coordinates or a client — the shape of a link is the next unit\'s decision');
{
  const exported = [...MODULE.matchAll(/^export\s+(?:async\s+)?(?:function|const)\s+(\w+)/gm)].map((m) => m[1]).sort();
  ok(exported.join(',') === 'SHARE_TOKEN_BYTES,SHARE_TOKEN_LENGTH,hashShareToken,isWellFormedToken,newShareToken' && (MODULE.match(/^export\b/gm) || []).length === 5,
    '11d: it exports exactly three functions and two constants', exported.join(','));
}
ok((MODULE.match(/crypto\.getRandomValues\(/g) || []).length === 1 && !/Math\.random|Date\.now|performance\./.test(MODULE) && (MODULE.match(/crypto\.subtle\.digest\('SHA-256'/g) || []).length === 1
   && /SHARE_TOKEN_BYTES = 32;/.test(MODULE) && /SHARE_TOKEN_LENGTH = 43;/.test(MODULE),
  '11e: the only source of randomness is the platform CSPRNG (once), nothing is derived from a clock or Math.random, the only hash is SHA-256, and a token is 32 bytes / 43 characters');
ok(!/report_snapshot|report_private_context/.test(MODULE_RAW) && !/report_share/.test(MODULE_RAW),
  '11f: the module names no snapshot, private-layer or share object even in a comment, so it cannot be mistaken for a consumer by the scans that guard those layers');

// ── 12. the existing guards on the snapshot, amended deliberately and narrowly ──────────────────────────────────────────────────────────────────
ok(/'docs\/report-share\.sql'/.test(SNAPSHOT_PIN) && /3d:/.test(SNAPSHOT_PIN),
  '12: the snapshot structure test names docs/report-share.sql in its allow-list of files that may name the table, and carries the pin (3d) that this file only REFERENCES it by foreign key — the allow-list was amended, not bypassed');

// ── 13. the suite, its mutations and its workflow are real and wired ─────────────────────────────────────────────────────────────────────────────────
const checks = new Set([...SUITE.matchAll(/pg_temp\._ck\(\s*'([A-Z]\d+[a-z]?\d*)\b/g)].map((m) => m[1])).size;
const mutNames = [...MUT.matchAll(/^    '([a-z_0-9]+)': \[/gm)].map((m) => m[1]);
ok(checks >= 50, '13: the executable suite carries at least 50 checks', checks);
ok(mutNames.length >= 60 && new Set(mutNames).size === mutNames.length, '13b: at least 60 distinct prohibited mutations', mutNames.length);
ok(['plaintext_token_column', 'hash_not_unique', 'resolve_ignores_expiry', 'resolve_ignores_revocation', 'expired_beats_revoked', 'revoke_can_be_undone', 'expiry_extendable', 'delete_allowed',
    'truncate_allowed', 'anon_can_execute', 'writer_not_security_definer', 'resolve_returns_body', 'resolve_returns_context_id', 'event_free_text', 'create_opens_private_need',
    'create_requires_active_context', 'no_fk_to_snapshot', 'lockdown_loop_missing'].every((m) => mutNames.includes(m)),
  '13c: the eighteen mutations the audit named are all present — the plaintext token, the unique hash, expiry and revocation ignored, expired beating revoked, an undoable revoke, an extendable expiry, delete and truncate, anon and definer rights, a body or a context handle returned, free text in the log, a private need opened, an active context required, no foreign key, and no lock-down loop');
ok(/\*disposable\*/.test(RUN) && /mutated="\$\(python3/.test(RUN) && /SURVIVED/.test(RUN) && /CRASHED/.test(RUN) && /APPLIED TWICE/.test(RUN) && /ROLLED BACK/.test(RUN) && /REFUSED without the snapshot table/.test(RUN) && /UNTOUCHED/.test(RUN),
  '13d: the harness refuses a non-disposable database, fails on any surviving mutation AND on any mutation that merely crashes the suite, proves a second apply changes nothing, proves the rollback, the refusal without the snapshot, and that the dependencies were not touched');
ok(/grant usage on schema public to anon, authenticated, service_role/.test(SUITE) && /alter role service_role bypassrls/.test(SUITE),
  '13e: the suite gives the stand-in roles the schema usage and RLS bypass Supabase gives them, so a refusal can only come from the objects');
ok(/create function pg_temp\._share\(/.test(SUITE) && /create function pg_temp\._report\(/.test(SUITE) && /S01/.test(SUITE),
  '13f: the suite\'s setup steps are crash-proof (a regression becomes a failed named check, not a suite that stops before naming it)');
ok(WF.length > 300 && /test\/report_share_pg\/run\.sh/.test(WF) && /docs\/report-share\.sql/.test(WF) && /supabase\/functions\/_shared\/report-share\.ts/.test(WF)
   && /test\/report-share-structure\.test\.mjs/.test(WF) && /Refuse to run if any Supabase credential is present/.test(WF) && !/SUPABASE_[A-Z_]+:\s*\$\{\{\s*secrets\./.test(WF),
  '13g: the workflow runs the share harness against the disposable service container, is triggered by changes to the share SQL, module and tests, still refuses to run if a Supabase credential is present, and holds no secret');
ok(existsSync(join(ROOT, 'test/report_share_module_mutants.py')) && (read('test/report_share_module_mutants.py').match(/^    '[a-z_0-9]+': \[/gm) || []).length >= 20
   && existsSync(join(ROOT, 'test/report_share_pin_mutants.py')),
  '13h: the module\'s mutation script (at least 20) and this file\'s own pin-mutation script exist (run by hand: python3 test/report_share_module_mutants.py, python3 test/report_share_pin_mutants.py)');

console.log('\n' + (n - bad) + ' passed, ' + bad + ' failed of ' + n);
process.exit(bad ? 1 : 0);
