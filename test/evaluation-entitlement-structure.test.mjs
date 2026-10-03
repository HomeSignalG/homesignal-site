// EVALUATION ENTITLEMENT — the structural half (the executable half is test/evaluation_entitlement_pg).
//
// Order L1 adds the database layer of the 20-report brokerage evaluation: four tables (the entitlement, the hashed invite, the
// append-only credit ledger, the append-only event log) and the functions that mint, redeem and revoke an invite and issue a report
// against the shared pool. A PostgreSQL suite proves that BEHAVES, with real concurrent sessions. What it cannot see is a column that
// would hold an address, a hash of one, a client or an email; a second account or member table; a counter standing in for the ledger;
// a token written to a log line or returned as a hash; a second caller of the snapshot writer; a handler, a gate or a page that
// started reading the evaluation before the later orders design who may; a grant to a caller that was meant to be locked out; a
// schedule or a network call; an order struck complete on the strength of its first, unapplied step. Those are pinned here on
// COMMENT-STRIPPED text, each with a positive control so a scan that matched nothing cannot pass.
// Run: node test/evaluation-entitlement-structure.test.mjs
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

let n = 0, bad = 0;
const ok = (c, m, d) => { n++; if (c) console.log('PASS — ' + m); else { bad++; console.log('FAIL — ' + m + (d !== undefined ? '  [' + d + ']' : '')); } };
const ROOT = new URL('..', import.meta.url).pathname;
const exists = (f) => existsSync(join(ROOT, f));
const read = (f) => (exists(f) ? readFileSync(join(ROOT, f), 'utf8') : '');
const stripSql = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');
const stripJs = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
const stripHash = (s) => s.split('\n').map((l) => l.replace(/(^|\s)#.*$/, '$1')).join('\n');
const sorted = (a) => JSON.stringify([...a].sort());

const SQL_FILE = 'docs/evaluation-entitlement.sql';
const SPINE_FILE = 'docs/brokerage-account-spine.sql';
const SNAP_FILE = 'docs/report-snapshot.sql';
const RAW = read(SQL_FILE);
const SQL = stripSql(RAW);
const SQL_NS = SQL.replace(/'(?:[^']|'')*'/g, "''");               // no string literals
const SUITE = read('test/evaluation_entitlement_pg/suite.sql');
const FIXTURE = read('test/evaluation_entitlement_pg/fixture.sql');
const RUN = read('test/evaluation_entitlement_pg/run.sh');
const MUT = read('test/evaluation_entitlement_mutants.py');
const WF = read('.github/workflows/brokerage-account-suite.yml');
const DOC = read('docs/development-activity-evaluation-2026-10-02.md');
const K0DOC = read('docs/development-activity-agent-workspace-2026-10-01.md');
const STATUS = read('docs/development-activity-status-2026-09-30.md');
const CONTRACT = read('docs/report-snapshot-contract-2026-09-30.md');
const GATE = read('supabase/functions/_shared/admin-gate.ts');
const REST = read('supabase/functions/_shared/service-rest.ts');
const SNAPMOD = read('supabase/functions/_shared/report-snapshot.ts');
const HAN_FOLLOW = read('supabase/functions/follow-development-report/handler.ts');
const HAN_REPORT = read('supabase/functions/get-development-activity-report/handler.ts');

const fn = (name) => {
  const m = SQL.match(new RegExp('create or replace function public\\.' + name + '\\([\\s\\S]*?\\n(?:end \\$\\$;|\\$\\$;)'));
  return m ? m[0] : '';
};
const tableBody = (t) => (SQL.match(new RegExp('create table if not exists public\\.' + t + ' \\([\\s\\S]*?\\n\\);')) || [''])[0];
const columnsOf = (body) => [...body.matchAll(/^\s{2}(?!constraint\b)(\w+)\s+\w/gm)].map((m) => m[1]).sort();
const columnTypes = (body) => [...body.matchAll(/^\s{2}(?!constraint\b)(\w+)\s+(\w+)/gm)].map((m) => [m[1], m[2]]);

const TABLES = ['evaluation', 'evaluation_invite', 'evaluation_credit', 'evaluation_event'];
const FUNCTIONS = ['evaluation_report_limit', 'evaluation_append_only', 'evaluation_guard', 'evaluation_invite_guard', 'evaluation_credit_after_insert',
  'evaluation_invite_mint', 'evaluation_create', 'evaluation_invite_redeem', 'evaluation_invite_revoke', 'evaluation_revoke', 'evaluation_report_issue',
  'evaluation_usage', 'evaluation_check'];
const DEFINERS = ['evaluation_invite_mint', 'evaluation_create', 'evaluation_invite_redeem', 'evaluation_invite_revoke', 'evaluation_revoke', 'evaluation_report_issue',
  'evaluation_usage', 'evaluation_check'];
const BODY = Object.fromEntries(TABLES.map((t) => [t, tableBody(t)]));
const F = Object.fromEntries(FUNCTIONS.map((f) => [f, fn(f)]));
const ISSUE = F.evaluation_report_issue, REDEEM = F.evaluation_invite_redeem, MINT = F.evaluation_invite_mint, CREATE = F.evaluation_create;
const IREVOKE = F.evaluation_invite_revoke, EREVOKE = F.evaluation_revoke, USAGE = F.evaluation_usage, CHECK = F.evaluation_check;
const EGUARD = F.evaluation_guard, IGUARD = F.evaluation_invite_guard, AFTER = F.evaluation_credit_after_insert;
const at = (s, needle) => s.indexOf(needle);

// ── 0. everything under test is located (positive control for every scan below) ─────────────────────────────────
ok(SQL.length > 20000 && SUITE.length > 40000 && FIXTURE.length > 500 && RUN.length > 12000 && MUT.length > 30000 && WF.length > 800 && DOC.length > 12000,
  '0: the SQL of record, the suite, the fixture, the harness, the mutations, the workflow and the design doc are all located and non-empty',
  [SQL.length, SUITE.length, FIXTURE.length, RUN.length, MUT.length, WF.length, DOC.length].join('/'));
ok(TABLES.every((t) => BODY[t].length > 150) && FUNCTIONS.every((f) => F[f].length > 40) && ISSUE.length > 2500 && REDEEM.length > 2500 && MINT.length > 1500,
  '0b: all four tables and all thirteen functions are found in the code', TABLES.map((t) => BODY[t].length).join('/') + ' | ' + FUNCTIONS.filter((f) => F[f].length <= 40).join(','));

// ── 1. the names are fixed, and nothing else is created ──────────────────────────────────────────────────────────
ok((SQL.match(/\bcreate table\b/g) || []).length === 4 && TABLES.every((t) => new RegExp('create table if not exists public\\.' + t + ' \\(').test(SQL)),
  '1: exactly four tables are created, named evaluation, evaluation_invite, evaluation_credit and evaluation_event — no second account table and no second member table (the evaluation references public.brokerage_account)');
const created = [...SQL.matchAll(/create or replace function public\.(\w+)\(/g)].map((m) => m[1]);
ok(created.length === 13 && sorted(created) === sorted(FUNCTIONS) && !/\bcreate function\b/.test(SQL),
  '1b: exactly thirteen functions are created, and they are the planned ones (a fourteenth, such as a counter or an email lookup, fails here)', created.join(','));
const triggers = [...SQL.matchAll(/create or replace trigger (\w+)/g)].map((m) => m[1]);
ok(sorted(triggers) === sorted(['evaluation_guard_trg', 'evaluation_invite_guard_trg', 'evaluation_credit_append_only', 'evaluation_credit_no_truncate',
    'evaluation_event_append_only', 'evaluation_event_no_truncate', 'evaluation_credit_complete_trg']),
  '1c: exactly seven triggers: the ledger and the log refuse update, delete and truncate; the evaluation and the invite are state machines; the status flips on the last credit', triggers.join(','));
ok(!/\bcreate\s+(?:or replace\s+)?(?:view|materialized view|type|sequence|policy|role|schema|extension|rule)\b/i.test(SQL)
   && (SQL.match(/\bcreate\s+(?:unique\s+)?index\b/g) || []).length === 1 && /create index if not exists evaluation_event_by_evaluation on public\.evaluation_event \(evaluation_id, event_id\);/.test(SQL)
   && (SQL.match(/generated always as identity/g) || []).length === 1,
  '1d: no view, type, sequence, policy, role, schema or extension is created; one explicit index beside the keys; and the one identity column (the event id) is the only sequence');

// ── 2. what the tables may hold, and may not ─────────────────────────────────────────────────────────────────────────
const COLS = Object.fromEntries(TABLES.map((t) => [t, columnsOf(BODY[t])]));
ok(sorted(COLS.evaluation) === sorted(['brokerage_id', 'created_at', 'evaluation_id', 'expires_at', 'revoked_at', 'seat_limit', 'status'])
   && sorted(COLS.evaluation_invite) === sorted(['created_at', 'evaluation_id', 'expires_at', 'invite_id', 'redeemed_at', 'redeemed_by', 'revoked_at', 'role', 'status', 'token_hash'])
   && sorted(COLS.evaluation_credit) === sorted(['evaluation_id', 'idempotency_key', 'issued_at', 'ordinal', 'report_id'])
   && sorted(COLS.evaluation_event) === sorted(['at', 'evaluation_id', 'event_id', 'invite_id', 'kind', 'role']),
  '2: the four tables carry exactly the planned columns and no others', TABLES.map((t) => COLS[t].join(',')).join(' | '));
const FORBIDDEN = /address|label|client|propert|email|domain|latitude|longitude|street|note|detail|comment|issued_by|actor|used|counter|balance|price|quota|billing|phone|name|payload|body|hash_of|(^|_)(ip|lat|lng|geo|zip|city)(_|$)/i;
const planted = ['address_hash', 'property_key', 'issued_by', 'credits_used', 'client_name', 'owner_email', 'note', 'detail', 'ip', 'actor', 'lat', 'user_ip', 'price_cents', 'email_domain', 'report_label'];
ok(![].concat(...TABLES.map((t) => COLS[t])).some((c) => FORBIDDEN.test(c)) && planted.every((c) => FORBIDDEN.test(c)),
  '2b: no column is named for an address, a hash of one, a property, a label, a client, an email or domain, an ip, coordinates, a counter of used credits, an actor, a note or a price (control: the same scan flags fifteen planted columns)');
const typeOk = [].concat(...TABLES.map((t) => columnTypes(BODY[t]))).every(([, ty]) => ['uuid', 'text', 'integer', 'timestamptz', 'bigint'].includes(ty));
ok(typeOk && !/\b(jsonb?|inet|point|geometry|geography|bytea|numeric|double)\b/i.test(TABLES.map((t) => BODY[t]).join('\n')),
  '2c: every column is a uuid, text, integer, timestamptz or bigint: nothing that could carry a document, a coordinate or an address');
const textCols = [].concat(...TABLES.map((t) => columnTypes(BODY[t]).filter(([, ty]) => ty === 'text').map(([c]) => [t, c])));
const checksOf = (body) => [...body.matchAll(/\bcheck \(([\s\S]*?)\)(?:,\n|\n\)\;)/g)].map((m) => m[1]).join('\n');
ok(textCols.length === 6 && textCols.every(([t, c]) => new RegExp('\\b' + c + '\\b').test(checksOf(BODY[t]))),
  '2d: every text column (the status, role, token hash and event kind of the four tables) is closed by a CHECK — a vocabulary or the 64-hex shape — so no free text, token or address can be written to any of them', textCols.map((x) => x.join('.')).join(','));
const vocab = (re, body) => { const m = body.match(re); return m ? [...m[1].matchAll(/'(\w+)'/g)].map((x) => x[1]) : []; };
ok(sorted(vocab(/evaluation_status\s+check \(status in \(([^)]*)\)\)/, BODY.evaluation)) === sorted(['active', 'complete', 'revoked'])
   && sorted(vocab(/evaluation_invite_role\s+check \(role in \(([^)]*)\)\)/, BODY.evaluation_invite)) === sorted(['owner', 'agent'])
   && sorted(vocab(/evaluation_event_kind\s+check \(kind in \(([^)]*)\)/, BODY.evaluation_event)) === sorted(['created', 'invite_minted', 'invite_redeemed', 'invite_revoked', 'completed', 'revoked'])
   && /token_hash ~ '\^\[0-9a-f\]\{64\}\$'/.test(BODY.evaluation_invite) && /status = 'open'[\s\S]*status = 'redeemed'[\s\S]*status = 'revoked'/.test(BODY.evaluation_invite),
  '2e: the vocabularies are closed — evaluation active | complete | revoked; invite role owner | agent and status open | redeemed | revoked (with what each implies); event kind of six lifecycle words; a token hash is exactly 64 lowercase hex');
ok(!/\bcredits?_(used|remaining|left|balance)\b|\bused_credits\b|\bremaining\b\s+(integer|int)\b|\bbalance\b/i.test(TABLES.map((t) => BODY[t]).join('\n'))
   && /select count\(\*\)::integer as n from public\.evaluation_credit c where c\.evaluation_id = e\.evaluation_id/.test(USAGE),
  '2f: used credits are the COUNT of ledger rows, derived by the reader — there is no counter, balance or remaining column anywhere to drift from the ledger');

// ── 3. ONE account spine, ONE identity system: the only places these tables point and the only objects the code names ──────────
const fkTargets = [...SQL.matchAll(/\breferences\s+([\w.]+)/g)].map((m) => m[1]);
ok(fkTargets.length === 7 && sorted(fkTargets) === sorted(['auth.users', 'public.brokerage_account', 'public.evaluation', 'public.evaluation', 'public.evaluation', 'public.evaluation_invite', 'public.report_snapshot'])
   && /brokerage_id\s+uuid\s+not null references public\.brokerage_account \(id\)/.test(BODY.evaluation) && /constraint evaluation_one_per_brokerage unique \(brokerage_id\)/.test(BODY.evaluation),
  '3: the evaluation REFERENCES public.brokerage_account, one per account — and nothing points anywhere else but auth.users (the one login system), its own tables and public.report_snapshot (the stored report the ledger links)', fkTargets.join(','));
ok(/redeemed_by\s+uuid\s+references auth\.users \(id\) on delete set null/.test(BODY.evaluation_invite) && (SQL.match(/\bon delete\b/gi) || []).length === 1
   && ![].concat(...['evaluation_credit', 'evaluation_event'].map((t) => COLS[t])).some((c) => /user|by$/.test(c)),
  '3b: the ONE user id kept anywhere is evaluation_invite.redeemed_by, which is cleared (ON DELETE SET NULL) when the person\'s account is deleted; the append-only ledger and log hold no user id at all (D-K4 stands: an account deletion or privacy request is never blocked)');
const OWN = [...TABLES, ...FUNCTIONS];
const ALLOWED_PUBLIC = [...OWN, 'brokerage_account', 'brokerage_member', 'brokerage_membership_of', 'report_snapshot', 'report_snapshot_issue'];
const publicNames = new Set([...SQL.matchAll(/\bpublic\.(\w+)/g)].map((m) => m[1]));
ok(publicNames.size >= 20 && [...publicNames].every((x) => ALLOWED_PUBLIC.includes(x)) && ['subscriptions', 'report_private_context', 'users', 'app_follows', 'dashboard_admins', 'app_projects'].every((x) => !ALLOWED_PUBLIC.includes(x)),
  '3c: the only public objects the code names are its own, the account spine and the snapshot writer and table — it never names public.subscriptions (the map-paywall product), the private-context table, a resident table or the admin allow-list', [...publicNames].filter((x) => !ALLOWED_PUBLIC.includes(x)).join(','));
const readTargets = [...SQL.replace(/\brevoke\b[^;]*;/gi, '').replace(/\bdistinct\s+from\s+[\w.]+/g, '').matchAll(/\b(?:from|join)\s+([\w.]+)/g)].map((m) => m[1]);
ok(readTargets.length >= 25 && readTargets.every((t) => /^public\.(evaluation|evaluation_invite|evaluation_credit|brokerage_account|brokerage_member|report_snapshot|brokerage_membership_of|report_snapshot_issue|evaluation_invite_mint)$/.test(t) || /^pg_\w+$/.test(t) || t === 'auth.users' || t === 'lateral'),
  '3d: every relation the code reads from (a table or a function in FROM) is one of its own, the two account tables and the resolver, the snapshot and its writer, auth.users (a user-existence check) or a PostgreSQL catalog', [...new Set(readTargets)].join(','));
ok((SQL_NS.match(/\bauth\.\w+/g) || []).join(',') === 'auth.users,auth.users' && !/\bauth\.(?!users\b)\w+/.test(SQL),
  '3e: no other part of auth is touched: auth.users appears twice in code (the foreign key and the user-existence check), and in the precondition string');
ok(/not exists \(select 1 from auth\.users u where u\.id = p_user_id\)/.test(REDEEM) && !/email|domain/i.test(SQL_NS),
  '3f: a person is a Supabase Auth user id, checked to exist; no email or domain appears anywhere in the code (an invite is not matched to an email, and no domain grants access)');

// ── 4. the only readers and callers: nobody consumes this layer before Orders J, M and the handler design who may ────────────────────
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
const rootFiles = readdirSync(ROOT).filter((f) => /\.(html|js|mjs|ts|sql|sh|py|yml|json)$/.test(f));
const SCAN = [...new Set([
  ...['lib', 'scripts', 'supabase', 'partials', 'bluesky', '.github/workflows', 'data'].flatMap((d) => walk(d)),
  ...walk('docs').filter((f) => !f.endsWith('.md')),            // script-like docs: SQL, shell, python, json, csv ... anything executable that is not prose
  ...rootFiles])].filter((f) => /\.(sql|js|mjs|ts|html|py|sh|yml|yaml|json|csv|psv|toml)$/.test(f));
const code = (f) => { const t = readFileSync(join(ROOT, f), 'utf8'); return f.endsWith('.sql') ? stripSql(t) : /\.(js|mjs|ts)$/.test(f) ? stripJs(t) : /\.(yml|yaml|sh|py|toml)$/.test(f) ? stripHash(t) : t; };
const OURS = /\bevaluation_(report_issue|invite_mint|invite_redeem|invite_revoke|create|revoke|usage|check|report_limit|invite|credit|event)\b|\bpublic\.evaluation\b/;
const namingOurs = SCAN.filter((f) => OURS.test(code(f)));
ok(SCAN.length > 200 && SCAN.some((f) => f.startsWith('.github/workflows/')) && SCAN.some((f) => f.startsWith('data/')) && SCAN.some((f) => f.startsWith('docs/')) && namingOurs.includes(SQL_FILE)
   && OURS.test(stripSql('select 1 from public.evaluation_credit;')) && !OURS.test(stripSql('-- evaluation_credit in a comment\nselect 1;')),
  '4-control: the scan covers the code directories, the workflows, data/, every non-prose file under docs/ and the root files, finds the SQL of record, flags a planted use and ignores a comment', SCAN.length + ' files');
// Build step 5b (2026-10-02) is "the handler work": the report function reads a member's trial (evaluation_usage) and charges a trial
// report (evaluation_report_issue, through the one shared snapshot module). Build step 5c moves the trial read into ONE shared module,
// _shared/evaluation-reads.ts, used by both the report function and the trial function (which also redeems an invite there).
// Build step 5d gives evaluation_create its first caller, in the same module: the trial function's admin-only create action.
// Build step 5e gives evaluation_invite_mint its first edge-function caller, in the same module: a trial owner invites an agent, the
// owner passed as the ACTOR so the database decides who may. evaluation_invite_revoke and evaluation_revoke still have no caller.
const EVAL_READS = 'supabase/functions/_shared/evaluation-reads.ts', SNAP_MOD = 'supabase/functions/_shared/report-snapshot.ts';
const namesIn = (f) => [...new Set([...code(f).matchAll(new RegExp(OURS.source, 'g'))].map((m) => m[0]))].sort();
// Build step 6: docs/saved-reports.sql is a second SQL file that reads the ledger (two STABLE functions, no DML); test/saved-reports-structure.test.mjs pins it.
const SAVED_SQL = 'docs/saved-reports.sql';
// Build step 8: docs/report-share-delivery.sql is a third SQL file that reads the ledger (it joins evaluation_credit and evaluation to find whose a
// stored report is, and asks evaluation_report_open whether a brokerage has standing). It writes no row of this layer: its only writes are calls to the
// share primitive. test/report-share-delivery-structure.test.mjs pins that (1g) and that standing is the SAME check saved reports use (1i).
const DELIVERY_SQL = 'docs/report-share-delivery.sql';
const deliveryCode = code(DELIVERY_SQL);
// Build step 9: docs/property-watch.sql is a fourth SQL file that reads the ledger: start asks evaluation_report_open whether a brokerage has standing (the SAME
// check saved reports use) and the list joins evaluation_credit once to show a report's number. Every row it writes is a row of its own two property_watch tables.
const WATCH_SQL = 'docs/property-watch.sql';
const watchCode = code(WATCH_SQL);
const dmlTargets = (t) => { const x = t.replace(/'(?:[^']|'')*'/g, "''"); return [...x.matchAll(/\binsert\s+into\s+(?:public\.)?(\w+)/gi), ...x.matchAll(/\bupdate\s+(?:public\.)?(\w+)\s+\w*\s*set\b/gi), ...x.matchAll(/\bdelete\s+from\s+(?:public\.)?(\w+)/gi), ...x.matchAll(/\btruncate\s+(?:table\s+)?(?:public\.)?(\w+)/gi)].map((m) => m[1]).filter((t) => t !== 'on'); }; // 'on' is the trigger event of `before truncate on <table>`, not a table
ok(JSON.stringify(namingOurs.sort()) === JSON.stringify([SQL_FILE, SAVED_SQL, DELIVERY_SQL, WATCH_SQL, EVAL_READS, SNAP_MOD].sort())
   && dmlTargets(watchCode).length >= 5 && dmlTargets(watchCode).every((t) => /^property_watch/.test(t))
   && /public\.evaluation_report_open\(p_user_id, p_report_id\)/.test(watchCode) && (watchCode.match(new RegExp(OURS.source, 'g')) || []).join() === 'evaluation_credit,evaluation_credit'
   && !/\b(insert\s+into|update|delete\s+from|truncate)\b/i.test(deliveryCode.replace(/'(?:[^']|'')*'/g, "''"))
   && /public\.evaluation_report_open\(p_user_id, p_report_id\)/.test(deliveryCode)
   && JSON.stringify(namesIn(EVAL_READS)) === '["evaluation_create","evaluation_invite_mint","evaluation_invite_redeem","evaluation_usage"]' && JSON.stringify(namesIn(SNAP_MOD)) === '["evaluation_report_issue"]',
  '4: outside its SQL (and the read-only saved-reports SQL, build step 6, the share-delivery SQL, build step 8, and the property-watch SQL, build step 9, which write no row of this layer), exactly two files name this layer in code: the shared trial module reads a member\'s trial, redeems an invite, (build step 5d) creates a trial and (build step 5e) lets an owner mint an agent invite (evaluation_usage, evaluation_invite_redeem, evaluation_create, evaluation_invite_mint only), and the shared snapshot module charges through evaluation_report_issue only — no page, function handler, script, workflow, data file or other SQL', namingOurs.join(','));
{
  const ER = code(EVAL_READS);
  const mints = [...ER.matchAll(/rpc\('evaluation_invite_mint', \{([^}]*)\}\)/g)];
  ok(mints.length === 1 && /^ p_evaluation_id: t\.evaluation_id, p_role: 'agent', p_actor: userId $/.test(mints[0][1]),
    '4-mint: the one mint call asks for an AGENT invite with the signed-in person as the ACTOR, so the database checks they are an active owner of that very brokerage (D-L8); no call mints without an actor, and none mints an owner', mints.map((m) => m[1]));
}
const strip4 = (t) => stripJs(t);
const NAMES_L1 = /evaluation_(report_issue|invite|credit|event|create|revoke|usage|check)|public\.evaluation\b|brokerage/i;
ok(GATE.length > 1500 && REST.length > 1500 && SNAPMOD.length > 1500 && HAN_FOLLOW.length > 1500 && HAN_REPORT.length > 1500
   && ![GATE, REST, HAN_FOLLOW, HAN_REPORT].some((t) => NAMES_L1.test(strip4(t)))
   && JSON.stringify([...strip4(SNAPMOD).matchAll(new RegExp(NAMES_L1.source, 'gi'))].map((m) => m[0])) === '["evaluation_report_issue"]',
  '4b: the gate, the service reader and both report handlers name no evaluation table or function and no brokerage (the gate asks deps.trialOf; the decision stays in the database), and the snapshot module names only the issue function it calls');
{
  const TH = readFileSync(join(ROOT, 'supabase/functions/development-activity-trial/handler.ts'), 'utf8');
  const TD = readFileSync(join(ROOT, 'supabase/functions/development-activity-trial/data.ts'), 'utf8');
  ok(TH.length > 1500 && TD.length > 300 && ![TH, TD].some((t) => OURS.test(strip4(t)))
     && /const evaluation = makeEvaluationReads\(rpc\);/.test(strip4(TD)) && /trialOf: evaluation\.trialOf, redeemInvite: evaluation\.redeemInvite, createTrial: evaluation\.createTrial,/.test(strip4(TD))
     && /roleOf: evaluation\.roleOf, inviteAgent: evaluation\.inviteAgent,/.test(strip4(TD))
     && !/evaluation_id|brokerage_id|invite_id|brokerage_membership_of/.test(strip4(TH)),
    '4b2: the trial function (build steps 5c, 5d, 5e) names no evaluation function, no resolver and no id: it asks the shared trial module (status, role, redeem, create, invite), and never returns an evaluation, brokerage or invite id');
}
const callers = SCAN.filter((f) => /report_snapshot_issue/.test(readFileSync(join(ROOT, f), 'utf8')));
ok(callers.includes(SNAP_FILE) && callers.includes('supabase/functions/_shared/report-snapshot.ts') && callers.includes(SQL_FILE)
   && callers.every((f) => [SNAP_FILE, 'supabase/functions/_shared/report-snapshot.ts', SQL_FILE].includes(f)),
  '4c: the snapshot writer has exactly three files that name it anywhere — its own SQL, the one shared module, and this layer\'s issue function — searched across code, workflows, data/ and every non-prose docs file (control: all three are found)', callers.join(','));
const calls = (SQL.match(/report_snapshot_issue\(/g) || []).length;
ok(calls === 2 && /from public\.report_snapshot_issue\(p_body, p_content_hash, p_report_version, p_engine_inputs, p_private\) s;/.test(ISSUE) && (ISSUE.match(/report_snapshot_issue\(/g) || []).length === 1,
  '4d: the writer is called ONCE, inside evaluation_report_issue (the other mention is the precondition\'s existence check), with the body, hash, version, engine inputs and private context passed straight through');
ok(/stores_reports: false/.test(strip4(HAN_FOLLOW)) && !/issueSnapshot\b/.test(strip4(HAN_REPORT)) && (strip4(HAN_REPORT).match(/deps\.issue\(/g) || []).length === 1
   && /if \(!trial \|\| !credit\.uses_report\)/.test(strip4(HAN_REPORT)),
  '4e: the Follow handler still stores nothing; the report handler never calls the plain snapshot writer and stores only a trial report the credit rule charges, through this layer\'s issue function, once');
ok(/dashboard_admins\?select=email&limit=1&email=eq\./.test(strip4(REST)) && /rows\.length === 1 && rows\[0\]\.email === email/.test(strip4(REST))
   && /deps\.isAdmin\(user\.email\)/.test(strip4(GATE)) && /authorizeAdmin/.test(strip4(GATE)),
  '4f: the gate is unchanged: service-rest.ts still answers "is this an admin" from public.dashboard_admins by exact email and admin-gate.ts still asks isAdmin of the signed-in user');

// ── 5. lock-down: system-only ───────────────────────────────────────────────────────────────────────────────────────────
ok(TABLES.every((t) => new RegExp('alter table public\\.' + t + '\\s+enable row level security;').test(SQL) && new RegExp('revoke all on public\\.' + t + '\\s+from public, anon, authenticated, service_role;').test(SQL))
   && (SQL.match(/\balter\s+table\b/gi) || []).length === 4,
  '5: all four tables have RLS on and every privilege revoked from public, anon, authenticated AND service_role, and they are altered for nothing else');
ok(!/\bcreate\s+policy\b/i.test(SQL) && !/\bforce row level security\b/i.test(SQL),
  '5b: no policy exists, so nothing is readable by an API role through RLS either');
ok((SQL.match(/\bgrant\b/gi) || []).length === 1 && /execute format\('grant execute on function %s to service_role', f\.sig\);/.test(SQL),
  '5c: the ONLY grant in the file is execute on a function to service_role, inside the computed loop — no table or sequence is granted to anybody');
ok(/p\.proname like 'evaluation\\_%'/.test(SQL) && /p\.prorettype = 'trigger'::regtype/.test(SQL) && /if not f\.is_trigger then/.test(SQL)
   && /revoke all on function %s from public, anon, authenticated, service_role/.test(SQL)
   && /format\('%I\.%I\(%s\)', n\.nspname, p\.proname, pg_get_function_identity_arguments\(p\.oid\)\)/.test(SQL),
  '5d: the function lock is a COMPUTED loop over this file\'s own prefix, naming each function by its SCHEMA-QUALIFIED identity (a typed list would stop covering the next function, and an unqualified name could re-target a same-named function in an earlier schema); a trigger function is granted to nobody');
ok(/do \$seq\$[\s\S]*pg_depend d on d\.classid = 'pg_class'::regclass[\s\S]*d\.deptype in \('a', 'i'\)[\s\S]*c\.relkind = 'S'[\s\S]*end \$seq\$;/.test(SQL)
   && /for s in select format\('%I\.%I', n\.nspname, c\.relname\) as sig/.test(SQL) && /revoke all on sequence %s from public, anon, authenticated, service_role/.test(SQL)
   && /t\.relname in \('evaluation', 'evaluation_invite', 'evaluation_credit', 'evaluation_event'\) loop\s+execute format\('revoke all on sequence/.test(SQL),
  '5e: the identity column\'s SEQUENCE is revoked by a COMPUTED, schema-qualified loop over the sequences that depend on this file\'s four tables (Supabase\'s default privileges open a sequence to anon and authenticated; a typed name would stop covering a second one)');
ok(DEFINERS.every((f) => /security definer set search_path = public, pg_temp/.test(F[f]))
   && FUNCTIONS.filter((f) => !DEFINERS.includes(f)).every((f) => !/security definer/.test(F[f]))
   && (SQL.match(/security definer/g) || []).length === 8
   && FUNCTIONS.filter((f) => f !== 'evaluation_report_limit').every((f) => /set search_path = public, pg_temp/.test(F[f])),
  '5f: exactly eight functions are security definer — the eight a caller may run — and every function that touches a table pins its search_path; the trigger functions and the limit are not definers');

// ── 6. the invariants, in the code ───────────────────────────────────────────────────────────────────────────────────────
ok(/language sql immutable as \$\$ select 20 \$\$;/.test(SQL) && (SQL.match(/\b20\b/g) || []).length === 1,
  '6: the number of free reports is defined ONCE (evaluation_report_limit() = 20); no other statement writes the number, so changing it is one edit and a second copy cannot drift');
ok(/constraint evaluation_credit_pkey\s+primary key \(evaluation_id, ordinal\)/.test(BODY.evaluation_credit)
   && /constraint evaluation_credit_ordinal\s+check \(ordinal between 1 and public\.evaluation_report_limit\(\)\)/.test(BODY.evaluation_credit)
   && /constraint evaluation_credit_key_unique\s+unique \(evaluation_id, idempotency_key\)/.test(BODY.evaluation_credit)
   && /constraint evaluation_credit_report_unique unique \(report_id\)/.test(BODY.evaluation_credit)
   && /report_id\s+uuid\s+not null references public\.report_snapshot \(report_id\)/.test(BODY.evaluation_credit) && /ordinal\s+integer\s+not null/.test(BODY.evaluation_credit),
  '6b: THE CAP IS A CONSTRAINT: the ledger\'s primary key is (evaluation, ordinal) and the ordinal is checked between 1 and the limit, so at most twenty rows can exist per evaluation at ANY isolation level and for ANY writer; a retried key and a report are each unique; every row links a stored report');
ok(/create or replace trigger evaluation_credit_complete_trg\s+after insert on public\.evaluation_credit\s+for each row execute function public\.evaluation_credit_after_insert\(\);/.test(SQL)
   && /new\.ordinal = public\.evaluation_report_limit\(\)/.test(AFTER) && /set status = 'complete'/.test(AFTER) && /'completed'/.test(AFTER),
  '6c: the status flips to complete in an AFTER INSERT trigger on the ledger row that uses the last credit, whoever wrote it, and writes one completed event: the flip cannot be skipped');
ok(/create or replace trigger evaluation_credit_append_only\s+before update or delete on public\.evaluation_credit/.test(SQL) && /create or replace trigger evaluation_credit_no_truncate\s+before truncate on public\.evaluation_credit/.test(SQL)
   && /create or replace trigger evaluation_event_append_only\s+before update or delete on public\.evaluation_event/.test(SQL) && /create or replace trigger evaluation_event_no_truncate\s+before truncate on public\.evaluation_event/.test(SQL)
   && /raise exception '% is append-only \(% refused\)', tg_table_name, tg_op using errcode = '55000'/.test(F.evaluation_append_only),
  '6d: the credit ledger and the event log refuse update, delete and truncate from every role, including the table owner');
ok(/tg_op = 'DELETE'[\s\S]*never deleted/.test(EGUARD) && /new\.evaluation_id <> old\.evaluation_id or new\.brokerage_id <> old\.brokerage_id or new\.created_at <> old\.created_at/.test(EGUARD)
   && /old\.status = 'revoked'[\s\S]*terminal/.test(EGUARD) && /old\.status = 'complete' and new\.status <> 'revoked'/.test(EGUARD)
   && /new\.status = 'complete'[\s\S]*evaluation_credit[\s\S]*< public\.evaluation_report_limit\(\)/.test(EGUARD) && /new\.revoked_at := now\(\);/.test(EGUARD),
  '6e: an evaluation is a state machine and is never deleted: identity never changes, revoked is terminal, complete can only be revoked and is reachable only with a full ledger, and the revocation time is stamped by the database');
ok(/tg_op = 'DELETE'[\s\S]*never deleted/.test(IGUARD) && /new\.token_hash <> old\.token_hash/.test(IGUARD) && /a redeemed or revoked invite is terminal/.test(IGUARD)
   && /old\.expires_at <= now\(\)[\s\S]*an expired invite cannot be redeemed/.test(IGUARD) && /new\.redeemed_at := now\(\);/.test(IGUARD) && /new\.redeemed_by is null/.test(IGUARD),
  '6f: an invite is open, then redeemed or revoked and either is terminal; identity, role, token hash and lifetime never change; an expired invite cannot be redeemed by any writer; the times are stamped by the database; the one other change allowed is the account-deletion foreign key clearing redeemed_by');

// the two functions whose answers depend on a row lock refuse any other isolation level, BEFORE they read or lock
const isoGuard = (f, nm) => new RegExp("if current_setting\\('transaction_isolation'\\) <> 'read committed' then\\s+raise exception '" + nm + ": needs READ COMMITTED[^']*',\\s*current_setting\\('transaction_isolation'\\) using errcode = '55000';\\s+end if;").test(f);
ok(isoGuard(ISSUE, 'evaluation_report_issue') && isoGuard(REDEEM, 'evaluation_invite_redeem') && isoGuard(MINT, 'evaluation_invite_mint') && isoGuard(IREVOKE, 'evaluation_invite_revoke')
   && at(ISSUE, 'transaction_isolation') < at(ISSUE, 'for update') && at(ISSUE, 'transaction_isolation') < at(ISSUE, 'brokerage_membership_of')
   && at(REDEEM, 'transaction_isolation') < at(REDEEM, 'for update') && at(REDEEM, 'transaction_isolation') < at(REDEEM, 'select i.evaluation_id')
   && at(MINT, 'transaction_isolation') < at(MINT, 'for update') && at(MINT, 'transaction_isolation') < at(MINT, 'brokerage_membership_of')
   && at(IREVOKE, 'transaction_isolation') < at(IREVOKE, 'for update') && at(IREVOKE, 'transaction_isolation') < at(IREVOKE, 'brokerage_membership_of'),
  '6g: evaluation_report_issue, evaluation_invite_redeem, evaluation_invite_mint and evaluation_invite_revoke REFUSE any transaction above READ COMMITTED, before they read or lock: a row lock refreshes what a check sees only there (measured on K0\'s owner guard: two sessions both passed and left zero owners; and an owner removed after a REPEATABLE READ snapshot could still mint or revoke). evaluation_create reaches mint, so it is covered. The cap itself does not rely on this — it is a constraint');
const iLock = at(ISSUE, 'for update'), iRecheck = at(ISSUE, 'where r.brokerage_id = ev.brokerage_id'), iReplay = at(ISSUE, 'c.idempotency_key = p_idempotency_key'),
  iFull = at(ISSUE, "'EVALUATION_COMPLETE'"), iSnap = at(ISSUE, 'report_snapshot_issue('), iLedger = at(ISSUE, 'insert into public.evaluation_credit');
ok((ISSUE.match(/for update/g) || []).length === 1 && /from public\.evaluation e where e\.brokerage_id = m\.brokerage_id for update;/.test(ISSUE)
   && iLock > 0 && iLock < iRecheck && iRecheck < iReplay && iReplay < iFull && iFull < iSnap && iSnap < iLedger,
  '6h: evaluation_report_issue locks the evaluation row FIRST, asks the entitlement again once it holds the lock, answers a retried key from the ledger (no charge), refuses report 21 with EVALUATION_COMPLETE, and only then calls the snapshot writer and appends the ledger row — one transaction, so any refusal rolls everything back and costs no credit');
ok(/select r\.\* into m from public\.brokerage_membership_of\(p_user_id\) r;/.test(ISSUE) && !/brokerage_member\b/.test(ISSUE.replace(/brokerage_membership_of/g, ''))
   && !/\binsert\s+into\s+public\.brokerage_(account|member)\b|\bupdate\s+public\.brokerage_|\bdelete\s+from\s+public\.brokerage_/.test(ISSUE)
   && /not found or ev\.status = 'revoked' or \(ev\.expires_at is not null and ev\.expires_at <= now\(\)\)/.test(ISSUE),
  '6i: the entitlement is the ONE resolver brokerage_membership_of (an active member of an ACTIVE brokerage), never a table read or a re-derivation; a revoked or expired evaluation is refused as NOT_ENTITLED');
ok(!/\b(md5|sha256|digest|encode)\s*\(/.test(ISSUE) && /p_idempotency_key uuid/.test(ISSUE) && /idempotency_key = p_idempotency_key/.test(ISSUE),
  '6j: the idempotency key is a caller-chosen UUID bound to the evaluation only: nothing in the issue function hashes the body, the address or the engine inputs (a hash of an address stored in an append-only table would resolve to one address)');
ok(/select e\.\* into ev  from public\.evaluation e        where e\.evaluation_id = v_eval  for update;/.test(REDEEM)
   && /select i\.\* into inv from public\.evaluation_invite i where i\.token_hash = v_hash     for update;/.test(REDEEM)
   && at(REDEEM, 'from public.evaluation e') < at(REDEEM, 'from public.evaluation_invite i where i.token_hash = v_hash     for update'),
  '6k: lock order is always the evaluation, then the invite (the issue function takes only the evaluation), so two paths cannot deadlock');
ok(/insert into public\.brokerage_member \(brokerage_id, user_id, role\) values \(ev\.brokerage_id, p_user_id, inv\.role\);/.test(REDEEM)
   && /exists \(select 1 from public\.brokerage_member m where m\.user_id = p_user_id and m\.status = 'active'\)[\s\S]*ALREADY_A_MEMBER/.test(REDEEM)
   && /m\.role = 'agent' and m\.status = 'active'/.test(REDEEM) && /SEAT_LIMIT_REACHED/.test(REDEEM)
   && !/\b(update|delete)\s+(from\s+)?public\.brokerage_member\b/i.test(SQL_NS) && !/\b(insert\s+into|update|delete\s+from)\s+public\.brokerage_account\b/i.test(REDEEM),
  '6l: the redeem function is the WRITER for public.brokerage_member and only inserts: it refuses a person who already holds an ACTIVE membership (K0: one per user) and counts agent seats; nothing in this file ever updates or deletes a membership, so it never reaches K0\'s owner-removal guard and never removes an owner');
ok(/insert into public\.brokerage_account \(name\) values \(p_brokerage_name\)/.test(CREATE) && /evaluation_invite_mint\(v_eval, 'owner', null, p_invite_ttl\)/.test(CREATE)
   && (SQL.match(/insert into public\.brokerage_account/g) || []).length === 1 && /'created'/.test(CREATE),
  '6m: the account, the evaluation and the first OWNER invite are created in ONE function and so one transaction (K0 asked for the account and its first owner to be created together); nothing else creates an account');
ok(/v_actor\.brokerage_id <> ev\.brokerage_id or v_actor\.role <> 'owner' or p_role <> 'agent'/.test(MINT) && /v_actor\.brokerage_id <> ev\.brokerage_id or v_actor\.role <> 'owner'/.test(IREVOKE)
   && /brokerage_membership_of\(p_actor\)/.test(MINT) && /brokerage_membership_of\(p_actor\)/.test(IREVOKE),
  '6n: an actor may mint or revoke only as an active OWNER of that invite\'s own brokerage (through the one resolver), and may invite agents only; the admin path (no actor) is the system caller');

// ── 7. the token ─────────────────────────────────────────────────────────────────────────────────────────────────────────
ok(/encode\(sha256\(convert_to\(v_token, 'UTF8'\)\), 'hex'\)/.test(MINT) && /encode\(sha256\(convert_to\(p_token, 'UTF8'\)\), 'hex'\)/.test(REDEEM)
   && !/\bmd5\b/i.test(SQL) && /gen_random_uuid\(\)::text, '-', ''\) \|\| replace\(gen_random_uuid\(\)::text, '-', ''\)/.test(MINT) && /'\^hse1_\[0-9a-f\]\{64\}\$'/.test(REDEEM),
  '7: a token is hse1_ and 64 hex characters from two random UUIDs (244 random bits); ONLY its SHA-256 is stored and looked up; there is no md5 anywhere');
ok([...SQL.matchAll(/\braise\b[^;]*;/g)].every((m) => !/\b(v_token|p_token|v_hash|token_hash)\b/.test(m[0])),
  '7b: no RAISE (notice, log or exception) names the token or its hash, so neither can reach a log line or an error message through this code');
ok([...SQL.matchAll(/returns table \(([^)]*)\)/g)].every((m) => !/token_hash|hash\b/.test(m[1].replace(/p_content_hash/g, ''))) && /returns table \(invite_id uuid, token text, expires_at timestamptz\)/.test(MINT)
   && [...SQL.matchAll(/return query[^;]*;/g)].every((m) => !/token_hash/.test(m[0])),
  '7c: no function returns the stored hash; the raw token is returned ONCE, by mint and create, and nothing reads it back');
ok(/INVITE_UNUSABLE/.test(REDEEM) && (REDEEM.match(/'INVITE_UNUSABLE'/g) || []).length === 6 && !/INVITE_(EXPIRED|REVOKED|ALREADY|NOT_FOUND|UNKNOWN)/.test(SQL),
  '7d: an unknown, malformed, expired, revoked or already-redeemed token (and an ended evaluation, an unknown user, another person\'s token) all get the ONE generic message — the refusal never says which');

// ── 8. what the events and the ledger are written with ───────────────────────────────────────────────────────────────────────────
const inserts = [...SQL.matchAll(/insert into public\.(evaluation_event|evaluation_credit|evaluation_invite|evaluation)\s*\(([^)]*)\)/g)].map((m) => [m[1], m[2].replace(/\s+/g, ' ').trim()]);
const byTable = (t) => [...new Set(inserts.filter(([x]) => x === t).map(([, c]) => c))].sort();
ok(JSON.stringify(byTable('evaluation_event')) === JSON.stringify(['evaluation_id, kind', 'evaluation_id, kind, role, invite_id'])
   && JSON.stringify(byTable('evaluation_credit')) === JSON.stringify(['evaluation_id, ordinal, idempotency_key, report_id'])
   && JSON.stringify(byTable('evaluation_invite')) === JSON.stringify(['evaluation_id, role, token_hash, expires_at'])
   && JSON.stringify(byTable('evaluation')) === JSON.stringify(['brokerage_id, seat_limit, expires_at']),
  '8: the event log is written only with (evaluation, kind[, role, invite]) and the ledger only with (evaluation, ordinal, key, report id): there is no column through which an address, a label, a user or free text could pass', inserts.map((x) => x.join(':')).join(' | '));
ok(!/\bdelete\s+from\b/i.test(SQL_NS) && !/\btruncate\s+(table\s+)?public\./i.test(SQL_NS) && !/\bupdate\s+public\.(evaluation_credit|evaluation_event)\b/.test(SQL_NS)
   && [...SQL_NS.matchAll(/\bupdate\s+(public\.\w+)/g)].every((m) => ['public.evaluation', 'public.evaluation_invite'].includes(m[1])),
  '8b: nothing deletes or truncates a row, nothing updates the ledger or the log, and the only updates are the two state machines (evaluation status, invite status)');
const NOBODY = SQL.replace(/\$\$[\s\S]*?\$\$/g, '$$$$').replace(/\$(pre|post|seq|lock)\$[\s\S]*?\$\1\$/g, '$$$1$$$$');
ok(!/\b(insert\s+into|update\s+public|delete\s+from|truncate\s+(table\s+)?public\.|drop\s+(table|view|trigger|policy|schema|function|column|index|constraint))\b/i.test(NOBODY.replace(/'(?:[^']|'')*'/g, "''"))
   && NOBODY.length > 3000 && NOBODY.length < SQL.length / 2,
  '8c: outside the function bodies the file writes no row, deletes none, drops nothing: the four tables are EMPTY after the apply (control: the bodies, stripped here, are over half of the code)', NOBODY.length + ' of ' + SQL.length);
ok(/\bcreate table if not exists\b/.test(SQL) && !/\bcreate table (?!if not exists)/.test(SQL) && !/\bcreate (?:unique )?index (?!if not exists)/.test(SQL) && !/\bcreate function\b/.test(SQL) && !/\bcreate trigger\b/.test(SQL),
  '8d: every create is idempotent (if not exists / or replace), so the file applies twice');
ok(!/cron\.|pg_cron|net\.http|pg_net|\bpg_notify\b|\bnotify\b|\bcopy\b|\blo_|dblink|\bhttp_/i.test(SQL_NS), '8e: the file arms no schedule and makes no network call');
const localisms = SQL.match(/\b(nyc|new york|manhattan|brooklyn|bronx|queens|staten|dob|socrata|arcgis|legistar|granicus|tucson|phoenix|denver|utah|texas|chicago)\b/gi) || [];
ok(localisms.length === 0, '8f: no city, state, market or source-vendor literal', localisms.join(','));

// ── 9. rollback, preconditions, post-condition ───────────────────────────────────────────────────────────────────────────────────────
const tail = RAW.slice(RAW.indexOf('-- ROLLBACK-BEGIN'));
ok(/-- ROLLBACK \(this file only\)\./.test(RAW) && tail.includes('drop table if exists public.evaluation_event, public.evaluation_credit, public.evaluation_invite, public.evaluation;')
   && FUNCTIONS.every((f) => tail.includes('public.' + f + '(')) && /FIRST/.test(RAW.slice(RAW.indexOf('-- ROLLBACK (this file only)'), RAW.indexOf('-- ROLLBACK-BEGIN')))
   && /-- ROLLBACK-END/.test(RAW),
  '9: the ROLLBACK block names all four tables and all thirteen functions, and says anything a later order hung off them (the ownership rows, the paid state) must be rolled back FIRST');
ok(/do \$post\$[\s\S]*relrowsecurity[\s\S]*pg_policy[\s\S]*has_table_privilege\(r, t, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'\)[\s\S]*end \$post\$;/.test(SQL)
   && (SQL.slice(SQL.indexOf('do $post$')).match(/aclexplode\(coalesce\(/g) || []).length === 3
   && /acldefault\('r', c\.relowner\)/.test(SQL) && /acldefault\('s', c\.relowner\)/.test(SQL) && /acldefault\('f', p\.proowner\)/.test(SQL)
   && /a\.grantee <> c\.relowner/.test(SQL) && /a\.grantee <> p\.proowner/.test(SQL) && /v_seqs <> 1/.test(SQL) && /v_fns < 13/.test(SQL),
  '9b: the file ends with a fail-closed post-condition that reads the WHOLE ACL (aclexplode over the relacl, the sequence\'s and the function\'s, with the default ACL when none is stored): no grantee but the owner on a table or sequence, and on a function only service_role, never on a trigger function — a grant to an unnamed role or to PUBLIC stops the apply; it also expects exactly one sequence');
ok(/gen_random_uuid\(\)/.test(SQL) && /to_regprocedure\('sha256\(bytea\)'\)/.test(SQL) && /to_regclass\('auth\.users'\)/.test(SQL) && /to_regprocedure\('public\.brokerage_membership_of\(uuid\)'\)/.test(SQL)
   && /to_regprocedure\('public\.report_snapshot_issue\(text, text, text, jsonb, jsonb\)'\)/.test(SQL) && /apply docs\/brokerage-account-spine\.sql first/.test(SQL) && /apply docs\/report-snapshot\.sql first/.test(SQL),
  '9c: the preconditions fail closed with a message naming what to apply first (the account spine and the snapshot), so applying it out of order stops rather than half-applies');

// ── 10. the suite, its mutations, its harness and its workflow are real and wired ─────────────────────────────────────────────────────
const checkIds = new Set([...SUITE.matchAll(/pg_temp\._ck\(\s*'([A-Z]\d+[a-z]?)\s/g)].map((m) => m[1]));
const sqlMutNames = [...MUT.matchAll(/^    '([a-z_0-9]+)': (?:\[|lockdown\(|add_column\(|drop_trigger\()/gm)].map((m) => m[1]);
const fileMutNames = [...MUT.matchAll(/^    '([a-z_0-9]+)': \(/gm)].map((m) => m[1]);
ok(checkIds.size >= 75, '10: the executable suite carries at least 75 checks', checkIds.size);
ok(sqlMutNames.length >= 190 && new Set(sqlMutNames).size === sqlMutNames.length && fileMutNames.length >= 30 && new Set([...sqlMutNames, ...fileMutNames]).size === sqlMutNames.length + fileMutNames.length,
  '10b: the harness carries at least 190 distinct prohibited mutations of the SQL (and the structural-only ones beside them) and 30 of the files around it', sqlMutNames.length + ' + ' + fileMutNames.length);
ok(['limit_is_21', 'ordinal_check_unbounded', 'ordinal_not_unique_per_evaluation', 'key_unique_dropped', 'report_unique_dropped', 'complete_trigger_removed', 'append_only_credit_trigger_removed',
    'issue_without_the_evaluation_lock', 'issue_not_rechecked_after_the_lock', 'issue_replay_lookup_removed', 'issue_replay_key_is_global', 'issue_ignores_the_ledger_count', 'issue_swallows_a_snapshot_refusal',
    'issue_isolation_check_removed', 'redeem_without_any_lock', 'redeem_replay_for_any_user', 'redeem_skips_the_seat_limit', 'redeem_skips_the_one_membership_check', 'token_stored_raw', 'token_hash_is_md5',
    'credit_has_address_hash_column', 'credit_has_user_column', 'event_has_free_text_column', 'evaluation_has_used_counter', 'mint_foreign_actor_allowed', 'functions_unlocked', 'sequence_loop_removed',
    'authenticated_can_read_invite', 'post_condition_removed', 'invite_user_fk_blocks_deletion', 'file_seeds_a_row']
     .every((m) => sqlMutNames.includes(m))
   && ['lock_loop_unqualified', 'sequence_loop_unqualified', 'file_names_subscriptions', 'file_updates_a_membership', 'file_arms_a_schedule'].every((m) => MUT.includes("'" + m + "'"))
   && ['admin_gate_names_the_evaluation', 'handler_names_the_issue_function', 'second_handler_imports_the_snapshot_module', 'status_strikes_order_l', 'workflow_holds_a_secret', 'harness_loses_the_race'].every((m) => fileMutNames.includes(m)),
  '10c: the mutations the audit named are all present — the cap (number, ordinal check, keys), the lock and its recheck, the replay, the snapshot refusal swallowed, the isolation refusal, the token stored raw or as md5, the forbidden columns, mint and revoke authorization, widened grants, a policy, the sequence, a seeded row, a gate or handler naming the layer, a struck order');
ok(/\*disposable\*/.test(RUN) && /python3 "\$MUTS" --sql/.test(RUN) && /SURVIVED/.test(RUN) && /APPLIED TWICE/.test(RUN) && /pg_sleep/.test(RUN) && /poison/i.test(RUN)
   && ['race_next', 'race_last', 'race_same_key', 'race_storm', 'race_redeem_token', 'race_redeem_seat', 'race_redeem_person', 'race_removed_while_waiting', 'race_mint_while_revoking'].every((r) => RUN.includes(r + '() {') && (RUN.match(/for name in ([^;]*); do/) || ['', ''])[1].split(' ').includes(r))
   && /race_constraint "repeatable read"/.test(RUN) && /race_constraint "serializable"/.test(RUN) && /isolation level \$lvl/.test(RUN) && /sha256sum/.test(RUN) && /rollback_exact/.test(RUN),
  '10d: the harness refuses a non-disposable database, fails on any surviving mutation, proves a second apply changes nothing, races real sessions (two issues, the last credit, one key, thirty callers for twenty credits, one token, one seat, one person, a member removed while waiting, a mint during a revocation), proves the cap at REPEATABLE READ and SERIALIZABLE, checks the hash against sha256sum, proves a poisoned state stops the apply, and proves the rollback exact');
ok(/set client_min_messages = warning;/.test(SUITE) && /create function pg_temp\._do\(/.test(SUITE) && /S01/.test(SUITE) && /alter role service_role nobypassrls/.test(SUITE),
  '10e: the suite\'s setup steps are crash-proof (a regression becomes a failed check), and it reads as service_role WITHOUT row-level-security bypass so the posture is what refuses, not a missing privilege alone');
ok(/create table auth\.users/.test(FIXTURE) && /alter default privileges in schema public grant all on tables\s+to anon, authenticated, service_role/.test(FIXTURE)
   && /alter default privileges in schema public grant all on sequences to anon, authenticated, service_role/.test(FIXTURE) && /grant execute on functions to anon, authenticated, service_role/.test(FIXTURE),
  '10f: the fixture stands in auth.users and Supabase\'s DEFAULT privileges on tables, SEQUENCES and functions, so the lock-down is tested against the posture that actually needs undoing');
const wfPaths = (p) => (WF.match(new RegExp("^      - '" + p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "'$", 'gm')) || []).length;
ok(/bash test\/evaluation_entitlement_pg\/run\.sh/.test(WF) && wfPaths('docs/evaluation-entitlement.sql') === 2 && wfPaths('test/evaluation_entitlement_pg/**') === 2 && wfPaths('test/evaluation_entitlement_mutants.py') === 2
   && wfPaths('docs/brokerage-account-spine.sql') === 2 && wfPaths('docs/report-snapshot.sql') === 2 && wfPaths('docs/report-private-context.sql') === 2 && wfPaths('.github/workflows/brokerage-account-suite.yml') === 2
   && /bash test\/brokerage_account_pg\/run\.sh/.test(WF) && (WF.match(/Refuse to run if any Supabase credential is present/g) || []).length === 2
   && !/secrets\./.test(WF) && !/SUPABASE_[A-Z_]+:\s*\$\{\{/.test(WF) && (WF.match(/postgres:17/g) || []).length === 2 && /POSTGRES_DB: evaluation_disposable/.test(WF),
  '10g: the workflow runs the evaluation harness against its own disposable container beside the spine\'s, is triggered (pull request AND push to main) by changes to this SQL, the three files it stands on, the suite, the harness and itself, holds no secret and refuses to run if one is present');
ok(!/\bschedule\s*:/.test(WF) && /pull_request:/.test(WF) && /push:/.test(WF) && /workflow_dispatch/.test(WF), '10h: the workflow has no schedule');
const NEW_FILES = { SQL: RAW, SUITE, FIXTURE, RUN, MUT, WF, DOC };
ok(Object.values(NEW_FILES).every((t) => t.length > 0) && !Object.values(NEW_FILES).some((t) => /(claude-[a-z0-9]|sonnet|opus-\d|haiku|gpt-\d)/i.test(t)),
  '10i: no model identifier appears in any file of this unit');
ok(!Object.values({ SQL: RAW, SUITE, FIXTURE, RUN, WF }).some((t) => /(service_role_key|eyJ[A-Za-z0-9_-]{20,}|sb_secret|postgres(?:ql)?:\/\/[^\s'"]*@)/i.test(t)),
  '10j: no secret, key or connection string appears in any file of this unit');

// ── 11. the record: the order stays OPEN, the defaults are stated, the unapplied state is named ──────────────────────────────────────────
ok(/^- L\. Evaluation build and security tests — open\b/m.test(STATUS) && !/^- ~~L\./m.test(STATUS) && /^11\. Autonomous 20-report brokerage evaluation — \*\*open/m.test(STATUS),
  '11: the status file still lists Order L and Master Step 11 as OPEN (an order is never struck on the strength of its first, unapplied step)');
ok(/database layer built, not applied, not wired/i.test(STATUS) && /docs\/evaluation-entitlement\.sql/.test(STATUS) && /docs\/development-activity-evaluation-2026-10-02\.md/.test(STATUS),
  '11b: the status file\'s L entry says "database layer built, not applied, not wired" and points at the SQL of record and the design doc');
ok(['Canonical truth path', 'Decision owner', 'Shortcut check', 'GENUINE GAP', 'Open founder decisions', 'Concurrency'].every((h) => DOC.includes(h)) && ['D-L1', 'D-L2', 'D-L3', 'D-L4', 'D-L5', 'D-L6', 'D-L7', 'D-L8'].every((d) => DOC.includes(d)),
  '11c: the design doc states the canonical truth path, the decision owner and the shortcut check BEFORE the build, the concurrency verdict, the open founder decisions, and the eight defaults taken');
ok(/NOT APPLIED/.test(DOC) && /NOT APPLIED/.test(RAW) && /needs its own founder go/i.test(RAW + DOC) && /UNVERIFIED/.test(DOC) && /K0|#1534/.test(DOC),
  '11d: the SQL and the doc both say the file is NOT APPLIED and needs its own founder go (and the K0 account spine first), and the doc marks what this offline build could not verify as UNVERIFIED');
ok(/Permanent historical intelligence/.test(DOC) && /customer-entered/i.test(DOC) && /report_private_context/.test(DOC) && /public\.subscriptions/.test(DOC),
  '11e: the doc states the privacy rule this unit must not break (customer-entered private context lives only in the deletable private layer) and names public.subscriptions as the map-paywall product it does not touch');
ok(/Order L1 is now the first writer/.test(K0DOC) && /ownership lives in the credit ledger/.test(CONTRACT),
  '11f: the K0 design doc records that this layer is now the first writer of the account tables (its "no writers" default is superseded, not hidden), and the snapshot contract points at where ownership will live (the ledger links the report; the snapshot gains no owner column)');

console.log('\n' + (n - bad) + ' passed, ' + bad + ' failed of ' + n);
process.exit(bad ? 1 : 0);
