// BROKERAGE ACCOUNT SPINE — the structural half (the executable half is test/brokerage_account_pg).
//
// Order K0 adds the two tables and the one resolver that say WHO a signed-in person is in the commercial sense: a
// brokerage account, an explicit membership of one Supabase Auth user in one brokerage (owner or agent), and
// public.brokerage_membership_of(user_id). A PostgreSQL suite proves that BEHAVES. What it cannot see is a column that
// would hold a customer-entered value or a commercial detail that belongs to a later order, a second identity system, a
// consumer that reads these tables before Orders J and L have designed who may, a handler that calls the resolver
// instead of going through the admin gate, a gate that quietly stopped reading dashboard_admins, a schedule or a
// delete, an order struck complete on the strength of its first unapplied step. Those are pinned here, on
// COMMENT-STRIPPED text, each with a positive control so a scan that matched nothing cannot pass.
// Run: node test/brokerage-account-structure.test.mjs
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

let n = 0, bad = 0;
const ok = (c, m, d) => { n++; if (c) console.log('PASS — ' + m); else { bad++; console.log('FAIL — ' + m + (d !== undefined ? '  [' + d + ']' : '')); } };
const ROOT = new URL('..', import.meta.url).pathname;
const exists = (f) => existsSync(join(ROOT, f));
const read = (f) => (exists(f) ? readFileSync(join(ROOT, f), 'utf8') : '');
const stripSql = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');
const stripJs = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');

const SQL_FILE = 'docs/brokerage-account-spine.sql';
const RAW = read(SQL_FILE);
const SQL = stripSql(RAW);
const SUITE = read('test/brokerage_account_pg/suite.sql');
const FIXTURE = read('test/brokerage_account_pg/fixture.sql');
const RUN = read('test/brokerage_account_pg/run.sh');
const MUT = read('test/brokerage_account_mutants.py');
const WF = read('.github/workflows/brokerage-account-suite.yml');
const DOC = read('docs/development-activity-agent-workspace-2026-10-01.md');
const STATUS = read('docs/development-activity-status-2026-09-30.md');
const GATE = read('supabase/functions/_shared/admin-gate.ts');
const REST = read('supabase/functions/_shared/service-rest.ts');

const fn = (name) => (SQL.match(new RegExp('create or replace function public\\.' + name + '\\([\\s\\S]*?\\n(?:end \\$\\$;|\\$\\$;)')) || [''])[0];
const GUARD = fn('brokerage_member_guard');
const RESOLVER = fn('brokerage_membership_of');
const tableBody = (t) => (SQL.match(new RegExp('create table if not exists public\\.' + t + ' \\([\\s\\S]*?\\n\\);')) || [''])[0];
const ACCOUNT = tableBody('brokerage_account');
const MEMBER = tableBody('brokerage_member');
const columnsOf = (body) => [...body.matchAll(/^\s{2}(?!constraint\b)(\w+)\s+\w/gm)].map((m) => m[1]).sort();
const sorted = (a) => JSON.stringify([...a].sort());

// ── 0. everything under test is located (positive control for every scan below) ─────────────────────────────────
ok(SQL.length > 4000 && SUITE.length > 20000 && FIXTURE.length > 500 && RUN.length > 3000 && MUT.length > 12000 && WF.length > 500 && DOC.length > 6000,
  '0: the SQL of record, the suite, the fixture, the harness, the mutations, the workflow and the design doc are all located and non-empty',
  [SQL.length, SUITE.length, FIXTURE.length, RUN.length, MUT.length, WF.length, DOC.length].join('/'));
ok(GUARD.length > 800 && RESOLVER.length > 250 && ACCOUNT.length > 250 && MEMBER.length > 600,
  '0b: both functions and both tables are found in the code', [GUARD, RESOLVER, ACCOUNT, MEMBER].map((x) => x.length).join('/'));

// ── 1. the names are fixed, and nothing else is created ──────────────────────────────────────────────────────────
ok((SQL.match(/\bcreate table\b/g) || []).length === 2 && /create table if not exists public\.brokerage_account \(/.test(SQL) && /create table if not exists public\.brokerage_member \(/.test(SQL),
  '1: exactly two tables are created, named brokerage_account and brokerage_member (Order L hangs its rows off these names and creates no account tables of its own)');
ok((SQL.match(/create or replace function public\.(\w+)\(/g) || []).length === 2 && /create or replace function public\.brokerage_membership_of\(p_user_id uuid\)/.test(SQL)
   && /create or replace function public\.brokerage_member_guard\(\) returns trigger/.test(SQL),
  '1b: exactly two functions are created: the resolver brokerage_membership_of(user id) and the trigger function that guards a membership');
ok(!/\bcreate\s+(?:or replace\s+)?(?:view|materialized view|type|sequence|policy|role|schema|extension|rule)\b/i.test(SQL) && (SQL.match(/\bcreate\s+(?:unique\s+)?index\b/g) || []).length === 2,
  '1c: no view, type, sequence, policy, role, schema or extension is created, and exactly two indexes (one active membership per user; by brokerage)');

// ── 2. what the tables may hold, and may not ─────────────────────────────────────────────────────────────────────────
const FORBIDDEN = /address|label|client|propert|email|domain|credit|quota|price|token|invite|seat|bill|phone|plan|subscription|report|evaluation|entitle/i;
const accountCols = columnsOf(ACCOUNT), memberCols = columnsOf(MEMBER);
ok(sorted(accountCols) === sorted(['created_at', 'id', 'name', 'status']) && sorted(memberCols) === sorted(['brokerage_id', 'deactivated_at', 'id', 'joined_at', 'role', 'status', 'user_id']),
  '2: the two tables carry exactly the planned columns and no others', accountCols.join(',') + ' | ' + memberCols.join(','));
ok(![...accountCols, ...memberCols].some((c) => FORBIDDEN.test(c))
   && ['email_domain', 'credit_balance', 'invite_token', 'client_name', 'property_address', 'report_label', 'price_cents', 'seat_limit', 'quota', 'billing_plan'].every((c) => FORBIDDEN.test(c)),
  '2b: no column is named for an address, label, client, property, email, domain, credit, quota, price, token, invite, seat or billing (control: the same scan flags ten planted columns)');
ok(/\bname\s+text\s+not null/.test(ACCOUNT) && !/\b(street|city|zip|lat|lng|latitude|longitude|geo)\b/i.test(ACCOUNT + MEMBER),
  '2c: the brokerage carries a name and nothing geographic: customer-entered private context lives only in the deletable private layer, never here');

// ── 3. ONE identity system: the only places these tables point ────────────────────────────────────────────────────────
const fkTargets = [...SQL.matchAll(/\breferences\s+([\w.]+)/g)].map((m) => m[1]);
ok(fkTargets.length === 2 && sorted(fkTargets) === sorted(['auth.users', 'public.brokerage_account']),
  '3: the only foreign-key targets are auth.users (the one login system) and brokerage_account — no second identity table, no resident table, no report table', fkTargets.join(','));
ok(/user_id\s+uuid\s+not null references auth\.users \(id\) on delete cascade/.test(MEMBER) && (SQL.match(/\bon delete\b/gi) || []).length === 1,
  '3b: a membership follows the auth user (cascade — deleting an account or answering a privacy request is never blocked by this spine, default D-K4), and nothing else cascades');
const publicNames = new Set([...SQL.matchAll(/\bpublic\.(\w+)/g)].map((m) => m[1]));
const ALLOWED_PUBLIC = ['brokerage_account', 'brokerage_member', 'brokerage_member_guard', 'brokerage_membership_of'];
ok(publicNames.size >= 4 && [...publicNames].every((x) => ALLOWED_PUBLIC.includes(x)),
  '3c: the only public objects the SQL names are its own four — it reads no resident table (app_*, users), no report table, no allow-list, no subscription, no ledger', [...publicNames].join(','));
const readTargets = [...SQL.replace(/\brevoke\b[^;]*;/gi, '').matchAll(/\b(?:from|join)\s+([\w.]+)/g)].map((m) => m[1]);
ok(readTargets.length >= 6 && readTargets.every((t) => /^public\.brokerage_(account|member)$/.test(t) || /^pg_\w+$/.test(t) || t === 'unnest'),
  '3d: every table the code reads from (a revoke\'s "from public" is not a read) is one of its own two tables or a PostgreSQL catalog', [...new Set(readTargets)].join(','));
const SQL_NS = SQL.replace(/'(?:[^']|'')*'/g, "''");
ok(!/\bauth\.(?!users\b)\w+/.test(SQL) && (SQL_NS.match(/\bauth\.\w+/g) || []).join(',') === 'auth.users' && (SQL.match(/\bauth\.users\b/g) || []).length === 3,
  '3e: no other part of auth is touched: auth.users is named once in code (the foreign key) and twice in strings (the precondition and its message)');

// ── 4. the only readers: nobody consumes these tables before Orders J and L design who may ───────────────────────────
const allFiles = (() => {
  const out = [];
  const walk = (dir) => { const abs = join(ROOT, dir); if (!existsSync(abs)) return; for (const f of readdirSync(abs)) { const p = join(abs, f); if (f === 'node_modules' || f === '.git') continue; if (statSync(p).isDirectory()) walk(join(dir, f)); else out.push(relative(ROOT, p)); } };
  ['lib', 'scripts', 'supabase', 'partials', 'bluesky'].forEach(walk);
  readdirSync(ROOT).filter((f) => /\.(html|js|mjs|ts)$/.test(f)).forEach((f) => out.push(f));
  readdirSync(join(ROOT, 'docs')).filter((f) => f.endsWith('.sql')).forEach((f) => out.push('docs/' + f));
  return out.filter((f) => /\.(sql|js|mjs|ts|html|py|sh|yml|json)$/.test(f));
})();
const code = (f) => { const t = readFileSync(join(ROOT, f), 'utf8'); return f.endsWith('.sql') ? stripSql(t) : /\.(js|mjs|ts)$/.test(f) ? stripJs(t) : t; };
const NAMES = /brokerage_account|brokerage_member|brokerage_membership_of/;
const naming = allFiles.filter((f) => NAMES.test(code(f)));
ok(allFiles.length > 50 && naming.includes(SQL_FILE) && NAMES.test(stripSql('select 1 from public.brokerage_member;')) && !NAMES.test(stripSql('-- brokerage_member in a comment\nselect 1;')),
  '4-control: the scan covers the code directories, the root files and every docs SQL, finds the SQL of record, flags a planted use and ignores a comment', allFiles.length + ' files');
ok(naming.length === 1 && naming[0] === SQL_FILE,
  '4: nothing else in the repository names the tables or the resolver — no page, script, edge function or other SQL reads or writes them yet (Orders J and L design who may)', naming.join(','));
ok(GATE.length > 1500 && REST.length > 1500 && !/brokerage/i.test(stripJs(GATE)) && !/brokerage/i.test(stripJs(REST)),
  '4b: the admin gate and the service reader do not mention a brokerage at all — the resolver is not a second gate, and when Orders J and L swap the entitlement check into the gate it is read THERE, never called from a handler');

// ── 5. the gate is unchanged ──────────────────────────────────────────────────────────────────────────────────────────
ok(/dashboard_admins\?select=email&limit=1&email=eq\./.test(stripJs(REST)) && /rows\.length === 1 && rows\[0\]\.email === email/.test(stripJs(REST)),
  '5: supabase/functions/_shared/service-rest.ts still answers "is this an admin" from public.dashboard_admins by exact email');
ok(/deps\.isAdmin\(user\.email\)/.test(stripJs(GATE)) && /authorizeAdmin/.test(stripJs(GATE)),
  '5b: supabase/functions/_shared/admin-gate.ts still asks isAdmin of the signed-in user: the gate was not touched by this unit');

// ── 6. lock-down: system-only ───────────────────────────────────────────────────────────────────────────────────────────
ok(['brokerage_account', 'brokerage_member'].every((t) =>
    new RegExp('alter table public\\.' + t + '\\s+enable row level security;').test(SQL)
    && new RegExp('revoke all on public\\.' + t + '\\s+from public, anon, authenticated, service_role;').test(SQL)),
  '6: both tables have RLS on and every privilege revoked from public, anon, authenticated AND service_role (the dashboard_admins posture, and the private context\'s)');
ok(!/\bcreate\s+policy\b/i.test(SQL) && !/\bforce row level security\b/i.test(SQL),
  '6b: no policy exists, so nothing is readable by an API role through RLS either');
ok((SQL.match(/\bgrant\b/gi) || []).length === 1 && /execute format\('grant execute on function %s to service_role', f\.sig\);/.test(SQL),
  '6c: the ONLY grant in the file is execute on a function to service_role, inside the computed loop — no table is granted to anybody');
ok(/p\.proname like 'brokerage\\_member%'/.test(SQL) && /p\.prorettype = 'trigger'::regtype/.test(SQL) && /if not f\.is_trigger then/.test(SQL)
   && /revoke all on function %s from public, anon, authenticated, service_role/.test(SQL)
   && /format\('%I\.%I\(%s\)', n\.nspname, p\.proname, pg_get_function_identity_arguments\(p\.oid\)\)/.test(SQL),
  '6d: the function lock is a COMPUTED loop over this file\'s own prefix, naming each function by its SCHEMA-QUALIFIED identity (a typed list would stop covering the next function, a wider prefix would re-lock a later order\'s functions, and an unqualified name could re-target a same-named function in an earlier schema); a trigger function is granted to nobody');
ok((SQL.match(/security definer/g) || []).length === 1 && /security definer set search_path = public, pg_temp/.test(RESOLVER)
   && (SQL.match(/set search_path = public, pg_temp/g) || []).length === 2,
  '6e: exactly one function is security definer — the resolver — and both functions pin their search_path');

// ── 7. the invariants, in the code ──────────────────────────────────────────────────────────────────────────────────────
ok(/create unique index if not exists brokerage_member_one_active_per_user\s+on public\.brokerage_member \(user_id\) where status = 'active';/.test(SQL),
  '7: one ACTIVE membership per user is a partial unique index on user_id (so an invite cannot mint a second pool; a deactivated row blocks nothing)');
ok(/create or replace trigger brokerage_member_guard_trg\s+before update on public\.brokerage_member\s+for each row execute function public\.brokerage_member_guard\(\);/.test(SQL),
  '7b: the guard is a BEFORE UPDATE row trigger on the membership table');
const vocab = (re, body) => { const m = body.match(re); return m ? [...m[1].matchAll(/'(\w+)'/g)].map((x) => x[1]) : []; };
ok(sorted(vocab(/check \(role in \(([^)]*)\)\)/, MEMBER)) === sorted(['owner', 'agent'])
   && sorted(vocab(/brokerage_member_status\s+check \(status in \(([^)]*)\)\)/, MEMBER)) === sorted(['active', 'deactivated'])
   && sorted(vocab(/brokerage_account_status check \(status in \(([^)]*)\)\)/, ACCOUNT)) === sorted(['active', 'suspended', 'closed']),
  '7c: role is exactly owner | agent, membership status exactly active | deactivated, brokerage status exactly active | suspended | closed — each by CHECK (defaults D-K2, D-K6)');
ok(/brokerage_member_deactivation check \(\(status = 'active'\) = \(deactivated_at is null\)\)/.test(MEMBER) && /brokerage_member_span\s+check \(deactivated_at is null or deactivated_at >= joined_at\)/.test(MEMBER)
   && /brokerage_account_name\s+check \(btrim\(name\) <> ''\)/.test(ACCOUNT),
  '7d: a membership is active exactly when it has no deactivation time, a deactivation never precedes the join, and a brokerage has a non-blank name');
ok(/old\.role = 'owner' and \(new\.role <> 'owner' or new\.status <> 'active'\)/.test(GUARD)
   && /a\.id = old\.brokerage_id and a\.status = 'active'/.test(GUARD)
   && /m\.brokerage_id = old\.brokerage_id and m\.id <> old\.id and m\.role = 'owner' and m\.status = 'active'/.test(GUARD)
   && /the last active owner of an active brokerage cannot be deactivated or demoted/.test(GUARD),
  '7e: the last-owner rule refuses a demotion or a deactivation of an owner when the brokerage is ACTIVE and no OTHER ACTIVE owner of the SAME brokerage remains');
ok(/perform 1 from public\.brokerage_account a where a\.id = old\.brokerage_id for no key update;/.test(GUARD)
   && GUARD.indexOf('for no key update') < GUARD.indexOf('the last active owner'),
  '7f: concurrent removals of two owners are serialised on the brokerage row BEFORE the check, so both cannot pass it and leave none');
ok(/if current_setting\('transaction_isolation'\) <> 'read committed' then\s+raise exception 'brokerage_member: removing or demoting an owner needs READ COMMITTED[^']*',\s*current_setting\('transaction_isolation'\) using errcode = '55000';\s+end if;/.test(GUARD)
   && GUARD.indexOf("transaction_isolation") > GUARD.indexOf("old.role = 'owner'") && GUARD.indexOf("transaction_isolation") < GUARD.indexOf('for no key update'),
  '7i: an owner removal above READ COMMITTED is REFUSED, inside the owner branch and BEFORE the row lock: the lock refreshes what the check sees only at READ COMMITTED, so at REPEATABLE READ two owners could both be removed (measured: zero left)');
ok(/new\.id <> old\.id or new\.brokerage_id <> old\.brokerage_id or new\.user_id <> old\.user_id or new\.joined_at <> old\.joined_at/.test(GUARD)
   && /old\.status = 'deactivated'[\s\S]{0,200}terminal/.test(GUARD) && /new\.deactivated_at := now\(\);/.test(GUARD),
  '7g: identity columns never change, a deactivated membership is terminal (re-joining is a new row), and the deactivation time is stamped by the database, never taken from the caller');
ok(!/\bdelete\b/i.test(GUARD) && !/\binsert\b/i.test(GUARD),
  '7h: the guard fires on UPDATE only and nothing in it writes a row: an auth-user deletion cascades through it untouched (default D-K4)');

// ── 8. the resolver ────────────────────────────────────────────────────────────────────────────────────────────────────────
ok(/returns table \(brokerage_id uuid, role text\)/.test(RESOLVER) && /language sql stable security definer/.test(RESOLVER),
  '8: the resolver returns (brokerage_id, role), is STABLE, and is the one security-definer function');
ok(/from public\.brokerage_member m\s+join public\.brokerage_account a on a\.id = m\.brokerage_id\s+where m\.user_id = p_user_id and m\.status = 'active' and a\.status = 'active'/.test(RESOLVER),
  '8b: it answers for an ACTIVE member of an ACTIVE brokerage, matched on the user id parameter and nothing else');
ok(!/email|domain|auth\.|\bhost\b|\bname\b/i.test(RESOLVER.replace(/p_user_id/g, '')),
  '8c: it never matches by email or domain and reads no name (membership is explicit; plan Hard Rules 38-41), and it reads nothing of auth');

// ── 9. no schedule, no network, no write, additive only ──────────────────────────────────────────────────────────────────
ok(!/cron\.|pg_cron|net\.http|pg_net/i.test(SQL), '9: the file arms no schedule and makes no network call');
ok(!/\bdelete\s+from\b/i.test(SQL_NS) && !/\btruncate\b/i.test(SQL_NS) && !/\bdrop\s+(table|view|trigger|policy|schema|function|column|index|constraint)\b/i.test(SQL_NS)
   && !/\binsert\s+into\b/i.test(SQL_NS) && !/\bupdate\s+public\./i.test(SQL_NS)
   && /TRUNCATE/.test(SQL) && /\btruncate\b/i.test(SQL) && !/\btruncate\b/i.test(SQL_NS),
  '9b: the file deletes no row, truncates nothing, drops nothing (the rollback lives in a comment) and writes no row: the tables stay EMPTY (strings are stripped first: the post-condition names TRUNCATE as a privilege type, which the control confirms is seen in the raw text and absent from the code)');
ok(![...SQL.matchAll(/\balter\s+table\s+(?:if exists\s+)?(\S+)/gi)].some((m) => !/^public\.brokerage_(account|member)$/.test(m[1])) && (SQL.match(/\balter\s+table\b/gi) || []).length === 2,
  '9c: only the two tables of this file are altered, and only to enable row level security');
ok(/\bcreate table if not exists\b/.test(SQL) && !/\bcreate table (?!if not exists)/.test(SQL) && !/\bcreate (?:unique )?index (?!if not exists)/.test(SQL) && !/\bcreate function\b/.test(SQL),
  '9d: every create is idempotent (if not exists / or replace), so the file applies twice');
const tail = RAW.slice(RAW.lastIndexOf('-- ROLLBACK'));
ok(/ROLLBACK/.test(RAW) && tail.includes('drop table if exists public.brokerage_member;') && tail.includes('drop table if exists public.brokerage_account;')
   && tail.includes('drop function if exists public.brokerage_membership_of(uuid);') && /FIRST/.test(tail),
  '9e: the ROLLBACK block names both tables and the resolver, and says to roll back anything a later order hung off them first');
ok(/do \$post\$[\s\S]*relrowsecurity[\s\S]*pg_policy[\s\S]*has_table_privilege\(r, t, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'\)[\s\S]*end \$post\$;/.test(SQL)
   && /aclexplode\(c\.relacl\)[\s\S]*a\.grantee <> c\.relowner/.test(SQL.slice(SQL.indexOf('do $post$')))
   && (SQL.match(/raise exception 'brokerage_account_spine:/g) || []).length === 6,
  '9f: the file ends with a fail-closed post-condition (RLS on, no policy, no API-role privilege on either table, and no grantee at all but the owner, read from the whole ACL) and has two preconditions: a half-applied or poisoned state stops the apply');
const localisms = SQL.match(/\b(nyc|new york|manhattan|brooklyn|bronx|queens|staten|dob|socrata|arcgis|legistar|granicus|tucson|phoenix|denver|utah|texas)\b/gi) || [];
ok(localisms.length === 0, '9g: no city, state, market or source-vendor literal', localisms.join(','));

// ── 10. the suite, its mutations, its harness and its workflow are real and wired ───────────────────────────────────────────
const checkIds = new Set([...SUITE.matchAll(/pg_temp\._ck\(\s*'([A-Z]\d+[a-z]?)\b/g)].map((m) => m[1]));
const sqlMutNames = [...MUT.matchAll(/^    '([a-z_0-9]+)': (?:\[|lockdown\(|add_column\()/gm)].map((m) => m[1]);
const fileMutNames = [...MUT.matchAll(/^    '([a-z_0-9]+)': \(/gm)].map((m) => m[1]);
ok(checkIds.size >= 45, '10: the executable suite carries at least 45 checks', checkIds.size);
ok(sqlMutNames.length >= 50 && new Set(sqlMutNames).size === sqlMutNames.length && fileMutNames.length >= 14 && new Set([...sqlMutNames, ...fileMutNames]).size === sqlMutNames.length + fileMutNames.length,
  '10b: the harness carries at least 50 distinct prohibited mutations of the SQL and 14 of the files around it', sqlMutNames.length + ' + ' + fileMutNames.length);
ok(['no_one_active_membership_index', 'no_guard_trigger', 'guard_counts_deactivated_owner', 'guard_ignores_demotion', 'guard_without_lock', 'functions_unlocked', 'authenticated_can_read_member',
    'policy_for_authenticated', 'resolver_ignores_member_status', 'resolver_ignores_brokerage_status', 'guard_ignores_isolation_level', 'post_condition_reads_only_typed_roles', 'resolver_security_invoker', 'resolver_overload_by_email', 'member_has_email_column',
    'account_has_email_domain_column', 'account_has_address_column', 'member_has_label_column', 'account_has_credits_column', 'account_has_quota_column', 'file_seeds_a_row', 'fk_not_cascade',
    'post_condition_removed', 'deactivation_time_from_caller', 'identity_columns_can_change', 'deactivation_not_terminal', 'service_role_can_read_member']
     .every((m) => sqlMutNames.includes(m))
   && ['admin_gate_names_the_resolver', 'handler_names_the_table', 'service_rest_stops_reading_the_allow_list', 'sql_names_a_resident_table', 'sql_arms_a_schedule', 'status_strikes_order_k', 'workflow_holds_a_secret']
     .every((m) => fileMutNames.includes(m)),
  '10c: the mutations the audit named are all present — the one-active index, the last-owner guard (and its lock, its count of deactivated owners, its demotion arm), widened grants, a policy, the resolver ignoring member or brokerage status or going SECURITY INVOKER or taking an email, an email, domain, address, label, credit or quota column, a seeded row, a gate that names the resolver, a struck order');
ok(/\*disposable\*/.test(RUN) && /python3 "\$MUTS" --sql/.test(RUN) && /SURVIVED/.test(RUN) && /APPLIED TWICE/.test(RUN) && /concurrent/i.test(RUN) && /pg_sleep/.test(RUN) && /poison/i.test(RUN),
  '10d: the harness refuses a non-disposable database, fails on any surviving mutation, proves a second apply changes nothing, races two owner removals, and proves a poisoned state stops the apply');
ok(/set client_min_messages = warning;/.test(SUITE) && /create function pg_temp\._do\(/.test(SUITE) && /S01/.test(SUITE) && /alter role service_role bypassrls/.test(SUITE) && /grant usage on schema public to anon, authenticated, service_role/.test(SUITE),
  '10e: the suite\'s setup steps are crash-proof (a regression becomes a failed check), and it gives the stand-in roles the schema usage and RLS bypass Supabase gives them, so a refusal can only come from the objects');
ok(/create table auth\.users/.test(FIXTURE) && /alter default privileges in schema public grant all on tables\s+to anon, authenticated, service_role/.test(FIXTURE) && /grant execute on functions to anon, authenticated, service_role/.test(FIXTURE),
  '10f: the fixture stands in auth.users and Supabase\'s DEFAULT privileges, so the lock-down is tested against the posture that actually needs undoing');
const wfPaths = (p) => (WF.match(new RegExp("^      - '" + p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "'$", 'gm')) || []).length;
ok(/bash test\/brokerage_account_pg\/run\.sh/.test(WF) && wfPaths('docs/brokerage-account-spine.sql') === 2 && wfPaths('test/brokerage_account_pg/**') === 2 && wfPaths('test/brokerage_account_mutants.py') === 2
   && wfPaths('.github/workflows/brokerage-account-suite.yml') === 2
   && /Refuse to run if any Supabase credential is present/.test(WF) && !/secrets\./.test(WF) && !/SUPABASE_[A-Z_]+:\s*\$\{\{/.test(WF) && /postgres:17/.test(WF),
  '10g: the workflow runs the harness against a disposable container, is triggered (pull request AND push to main) by changes to this SQL, the suite, the harness and itself, holds no secret and refuses to run if one is present');
ok(!/\bschedule\s*:/.test(WF) && /pull_request:/.test(WF) && /push:/.test(WF) && /workflow_dispatch/.test(WF), '10h: the workflow has no schedule');
const NEW_FILES = { SQL: RAW, SUITE, FIXTURE, RUN, MUT, WF, DOC };
ok(Object.values(NEW_FILES).every((t) => t.length > 0) && !Object.values(NEW_FILES).some((t) => /(claude-[a-z0-9]|sonnet|opus-\d|haiku|gpt-\d)/i.test(t)),
  '10i: no model identifier appears in any file of this unit');
ok(!Object.values({ SQL: RAW, SUITE, FIXTURE, RUN, WF }).some((t) => /(service_role_key|eyJ[A-Za-z0-9_-]{20,}|sb_secret|postgres(?:ql)?:\/\/[^\s'"]*@)/i.test(t)),
  '10j: no secret, key or connection string appears in any file of this unit');

// ── 11. the record: the order stays OPEN, the audit's defaults are stated, the unapplied state is named ────────────────────────
ok(/^- K\. Agent Workspace \+ Brokerage Admin — open\b/m.test(STATUS) && !/^- ~~K\./m.test(STATUS) && /^8\. Agent Workspace \+ Brokerage Admin — \*\*open/m.test(STATUS),
  '11: the status file still lists Order K and Master Step 8 as OPEN (an order is never struck on the strength of its first, unapplied step)');
ok(/account spine built, not applied/i.test(STATUS) && /docs\/brokerage-account-spine\.sql/.test(STATUS) && /docs\/development-activity-agent-workspace-2026-10-01\.md/.test(STATUS),
  '11b: the status file\'s K entry says "account spine built, not applied" and points at the SQL of record and the design doc');
ok(['Canonical truth path', 'Decision owner', 'Shortcut check', 'GENUINE GAP'].every((h) => DOC.includes(h)) && ['D-K1', 'D-K2', 'D-K3', 'D-K4', 'D-K5', 'D-K6'].every((d) => DOC.includes(d)),
  '11c: the design doc states the canonical truth path, the decision owner and the shortcut check BEFORE the build, the concurrency verdict, and the six defaults taken');
ok(/NOT APPLIED/.test(DOC) && /NOT APPLIED/.test(RAW) && /needs its own founder go/i.test(RAW + DOC) && /UNVERIFIED/.test(DOC),
  '11d: the SQL and the doc both say the file is NOT APPLIED and needs its own founder go, and the doc marks what this offline build could not verify as UNVERIFIED');
ok(/CLAUDE\.md[\s\S]{0,400}Permanent historical intelligence|Permanent historical intelligence/.test(DOC) && /customer-entered/i.test(DOC) && /report_private_context/.test(DOC),
  '11e: the doc states the privacy rule this unit must not break (customer-entered private context lives only in the deletable private layer)');

console.log('\n' + (n - bad) + ' passed, ' + bad + ' failed of ' + n);
process.exit(bad ? 1 : 0);
