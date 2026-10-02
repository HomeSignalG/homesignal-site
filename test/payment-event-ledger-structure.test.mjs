// PAYMENT-EVENT LEDGER — the structural half (the executable half is test/payment_event_ledger_pg; run it with
// bash test/payment_event_ledger_pg/run.sh against a disposable Postgres, or let payment-event-ledger-suite.yml do it).
//
// Order M, step M0 (docs/payment-event-ledger.sql; contract docs/development-activity-paid-continuation-2026-10-01.md).
// A PostgreSQL suite proves the ledger BEHAVES. What it cannot see is a second place that decides "is this account paid"
// growing up beside it, a column that could hold a payer appearing in the IMMUTABLE table, a second ordering rule or a second
// status mapping, a caller wired in before Orders L/H/K exist, the webhook being copied into this repo, a schedule armed, a
// workflow that holds a credential, or the status file striking an order that is still open. Those are pinned here on
// COMMENT-STRIPPED text (a scanner, not a regex: a `--` inside a string literal is not a comment), each with a positive control so a
// scan that matched nothing cannot pass. Every pin has a mutation in test/payment_event_ledger_mutants.py that must turn it red.
// Run: node test/payment-event-ledger-structure.test.mjs
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

let n = 0, bad = 0;
const ok = (c, m, d) => { n++; if (c) console.log('PASS — ' + m); else { bad++; console.log('FAIL — ' + m + (d !== undefined ? '  [' + d + ']' : '')); } };
const ROOT = new URL('..', import.meta.url).pathname;
const read = (f) => readFileSync(join(ROOT, f), 'utf8');
const has = (f) => existsSync(join(ROOT, f));
// A scanner, not a regex: a `--` INSIDE a string literal is not a comment, and a regex that cuts the line there leaves an
// unterminated quote that flips which text every later pin thinks is a string (found by mutation in the purge-schedule pins).
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
const blankStrings = (s) => s.replace(/'(?:[^']|'')*'/g, "''");   // a word inside an error message or a regex literal is not a statement
const count = (s, re) => (s.match(re) || []).length;

const SQL_PATH = 'docs/payment-event-ledger.sql';
const RAW = read(SQL_PATH);
const SQL = stripSql(RAW);
const CODE = blankStrings(SQL);
const SUITE = read('test/payment_event_ledger_pg/suite.sql');
const MUT = read('test/payment_event_ledger_pg/mutate.py');
const RUN = read('test/payment_event_ledger_pg/run.sh');
const FIX = read('test/payment_event_ledger_pg/fixture.sql');
const WF_PATH = '.github/workflows/payment-event-ledger-suite.yml';
const WF = has(WF_PATH) ? read(WF_PATH) : '';
const DOC_PATH = 'docs/development-activity-paid-continuation-2026-10-01.md';
const DOC = has(DOC_PATH) ? read(DOC_PATH) : '';
const STATUS = read('docs/development-activity-status-2026-09-30.md');

const TABLE = (SQL.match(/create table if not exists public\.payment_event \([\s\S]*?\n\);/) || [''])[0];
// every function: { name, header (up to AS), body }
const FUNCS = [...SQL.matchAll(/create or replace function public\.(\w+)\(([\s\S]*?)\)\s*(?:returns[\s\S]*?)?\n?\s*language[\s\S]*?\bas \$\$([\s\S]*?)\$\$;/g)]
  .map((m) => ({ name: m[1], header: m[0].slice(0, m[0].indexOf('as $$')), body: m[3] }));
const fn = (name) => (FUNCS.find((f) => f.name === name) || { header: '', body: '' });
const RECORDER = fn('payment_event_record');
const LATEST = fn('payment_event_latest_id');
const MAP = fn('payment_event_map_status');
const KEYS_FN = fn('payment_event_allowed_keys');
const OPAQUE = fn('payment_event_opaque_ok');

// ── 0. everything under test is located (positive control for every scan below) ───────────────────────────────────────
ok(RAW.length > 9000 && SQL.length > 6000 && SUITE.length > 20000 && MUT.length > 8000 && RUN.length > 6000 && FIX.length > 1500,
  '0: the SQL of record, the suite, the mutations, the harness and the fixture are all located and non-empty');
ok(TABLE.length > 900 && FUNCS.length === 8 && RECORDER.body.length > 2500 && LATEST.body.length > 100 && MAP.body.length > 200 && KEYS_FN.body.length > 80,
  '0b: the table definition and all eight functions are found and split (the recorder, the ordering rule, the mapping, the allow-list among them)',
  TABLE.length + '/' + FUNCS.length + '/' + FUNCS.map((f) => f.name).join(','));
ok(count(SQL, /'/g) % 2 === 0 && count(SQL, /'/g) > 100, '0c: after comment stripping every string literal is closed (an odd quote count would mean the scan swapped strings and code)', count(SQL, /'/g));
ok(!/planted/.test(stripSql("select 1; -- planted comment\n/* planted */ select '-- kept' as x;")) && /-- kept/.test(stripSql("select '-- kept' as x;")) && !/planted/.test(blankStrings("select 'planted'")),
  '0d: the scanner removes a comment, keeps a `--` inside a string literal, and the string blanker empties a literal (positive control for every code pin)');

// ── 1. what can be stored: an exact allow-list, in an immutable table ─────────────────────────────────────────────────────
const cols = [...TABLE.matchAll(/^ {2}(\w+)\s+(?:bigint|text|timestamptz|boolean)\b/gm)].map((m) => m[1]).sort();
const EXPECTED_COLS = ['event_id', 'event_name', 'idempotency_key', 'livemode', 'mapped_status', 'occurred_at', 'processor', 'processor_status', 'product_ref', 'recorded_at', 'subscription_ref', 'variant_ref'];
ok(JSON.stringify(cols) === JSON.stringify(EXPECTED_COLS),
  '1: the ledger has exactly the twelve columns that may exist — an identity, the processor and its opaque ids, the event and status words, the mapped status, two times, two catalogue refs and the mode', cols.join(','));
const PERSON = /(^|_)(e?mail|first_name|last_name|full_name|payer|customer|buyer|card|cardholder|billing|address|street|phone|ip|user|account|owner|client|label|lat|lng|payload|body|raw)($|_)/i;
ok(['user_email', 'customer_email', 'card_last_four', 'billing_address', 'full_name', 'payer_name', 'phone', 'customer_ref', 'payload', 'raw_body', 'ip_address', 'user_id'].every((s) => PERSON.test(s))
   && cols.length === 12 && !cols.some((c) => PERSON.test(c)),
  '1b: no column NAME could hold a person (the screen matches every one of twelve sample person-shaped names, and none of the ledger\'s twelve columns)');
const insertCols = ((RECORDER.body.match(/insert into public\.payment_event as e\s*\(([^)]*)\)/) || ['', ''])[1]).split(',').map((s) => s.trim()).filter(Boolean).sort();
const allowed = [...(KEYS_FN.body.match(/'(\w+)'/g) || [])].map((s) => s.replace(/'/g, '')).filter((s) => s !== 'text').sort();
ok(insertCols.length === 9 && JSON.stringify(insertCols) === JSON.stringify(allowed)
   && JSON.stringify(insertCols) === JSON.stringify(cols.filter((c) => !['event_id', 'mapped_status', 'recorded_at'].includes(c))),
  '1c: the recorder\'s allow-list, its INSERT column list, and the table\'s columns agree — nine keys, and the identity, the mapped status and the server time are never keys (a key with no column, or a column with no key, fails here)',
  insertCols.length + ' / ' + allowed.length);
ok(/mapped_status\s+text\s+generated always as \(public\.payment_event_map_status\(processor, processor_status\)\) stored/.test(TABLE) && !/\bmapped_status\b/.test(RECORDER.body),
  '1d: the mapped status is a GENERATED column computed by the one mapping function, and the recorder never names it — no caller and no code path can choose it');
ok(/event_id\s+bigint\s+generated always as identity primary key/.test(TABLE) && /recorded_at\s+timestamptz\s+not null default now\(\)/.test(TABLE),
  '1e: the identity is generated ALWAYS (a caller cannot supply it) and the arrival time is the server\'s own clock');

// ── 2. one writer; nothing else stores, updates or deletes ───────────────────────────────────────────────────────────────
ok(count(CODE, /\binsert\s+into\s+public\.payment_event\b/g) === 1 && /insert\s+into\s+public\.payment_event\b/.test(RECORDER.body),
  '2: the only INSERT into the ledger is inside the one recorder');
ok(!/\bupdate\s+public\.payment_event\b|\bdelete\s+from\b|\btruncate\s+(table\s+)?public\.payment_event\b/i.test(CODE) && !/\bdrop\s+/i.test(CODE),
  '2b: the code never updates, deletes, truncates or drops anything (the rollback lives in a comment, between markers)');
ok([...CODE.matchAll(/\balter\s+table\s+(?:if exists\s+)?(\S+)/gi)].every((m) => m[1] === 'public.payment_event') && count(CODE, /\balter\s+table\b/gi) === 1,
  '2c: the only ALTER TABLE in the file is on the ledger itself (row-level security), and there is exactly one');
ok(!/\breferences\b/i.test(CODE) && !/\bcreate\s+(or replace\s+)?view\b/i.test(CODE) && !/\bcreate\s+(or replace\s+)?(materialized\s+)?table\b(?!\s+if not exists public\.payment_event\b)/i.test(CODE),
  '2d: no foreign key, no view, and no table other than the ledger is created — nothing references the ledger or depends on a table of anyone else\'s');

// ── 3. ENTITLEMENT-FREE: the file touches no table of anyone else's, and names no entitlement concept ─────────────────────
const FORBIDDEN = /\b(subscriptions?|user_subscriptions|entitle\w*|evaluation|credit|credits|quota|brokerage|account|accounts|tenant|seat|seats|invite|invites|billing|invoice|auth\.users|dashboard_admins)\b/i;
ok(!FORBIDDEN.test(CODE) && FORBIDDEN.test('insert into public.subscriptions') && FORBIDDEN.test('entitlement') && FORBIDDEN.test('select 1 from auth.users')
   && !FORBIDDEN.test('subscription_ref') && /subscription_ref/.test(CODE),
  '3: the code (comments removed, strings blanked) names no subscriptions table, entitlement, evaluation, credit, quota, brokerage, account, seat, invite or auth table (controls: the screen catches each planted word, and does NOT trip on the ledger\'s own subscription_ref, which the code uses)');
const rel = new Set([...CODE.matchAll(/\bpublic\.(\w+)/g)].map((m) => m[1]));
ok(rel.has('payment_event') && rel.has('payment_event_record') && [...rel].every((r) => r === 'payment_event' || r.startsWith('payment_event_')),
  '3b: every relation and routine the code names in the public schema is the ledger or one of its own payment_event_ functions', [...rel].join(','));
ok(!/\b(cron|pg_net|net\.http|http_get|http_post|dblink|pg_notify|listen|notify)\b/i.test(CODE) && !/\bcopy\b[\s\S]{0,40}\bprogram\b/i.test(CODE),
  '3c: nothing in the code schedules a job, makes a network call or sends a notification — the ledger is passive and nothing is armed');

// ── 4. definer rights, a pinned search path, and a lock-down that is computed ────────────────────────────────────────────
const definers = FUNCS.filter((f) => /\bsecurity definer\b/i.test(f.header));
ok(definers.length === 1 && definers[0].name === 'payment_event_record' && definers.every((f) => /set search_path = public, pg_temp/.test(f.header)),
  '4: exactly ONE function runs with definer rights — the recorder — and it pins its search_path (every definer function in the file would have to)');
ok(FUNCS.filter((f) => f.name !== 'payment_event_immutable').every((f) => /set search_path = public, pg_temp/.test(f.header)),
  '4b: every function except the trigger function pins its search_path, so none can be hijacked by a schema earlier on the path');
ok(/alter table public\.payment_event enable row level security;/.test(SQL)
   && /revoke all on public\.payment_event from public, anon, authenticated, service_role;/.test(SQL)
   && /grant select on public\.payment_event to service_role;/.test(SQL),
  '4c: row-level security is on, everything is revoked, then SELECT only to service_role');
ok(!/grant[^;]*\bto\b[^;]*\b(anon|authenticated|public)\b/i.test(CODE) && !/grant[^;]*\b(insert|update|delete|truncate|all)\b[^;]*payment_event\b/i.test(CODE.replace(/revoke[^;]*;/gi, '')),
  '4d: nothing is granted to anon, authenticated or PUBLIC, and service_role is never granted insert, update, delete, truncate or all on the ledger');
ok(/like 'payment\\_event\\_%'/.test(SQL) && /revoke all on function %s from public, anon, authenticated/.test(SQL) && /grant execute on function %s to service_role/.test(SQL),
  '4e: every payment_event_ function is locked by a COMPUTED loop (never a typed list), then granted to service_role only');
ok(/pg_get_serial_sequence\('public\.payment_event', 'event_id'\)/.test(SQL) && /revoke all on sequence %s from public, anon, authenticated, service_role/.test(SQL),
  '4f: the identity sequence behind event_id is looked up and its default API grants are revoked');

// ── 5. append-only ───────────────────────────────────────────────────────────────────────────────────────────────────
ok(/before update or delete on public\.payment_event\s+for each row execute function public\.payment_event_immutable\(\)/.test(SQL)
   && /before truncate on public\.payment_event\s+for each statement execute function public\.payment_event_immutable\(\)/.test(SQL)
   && count(CODE, /create or replace trigger/g) === 2,
  '5: update and delete are refused per row, and truncate per statement, by one trigger function, for every role including the owner — and those are the only two triggers');

// ── 6. ONE ordering rule, ONE idempotency rule, ONE status mapping ────────────────────────────────────────────────────────────────
ok(count(CODE, /\border\s+by\b/gi) === 1 && /order by e\.occurred_at desc, e\.event_id desc/.test(LATEST.body) && /payment_event_latest_id\(/.test(RECORDER.body),
  '6: there is exactly ONE ORDER BY in the file — the ordering rule, inside payment_event_latest_id, by the processor\'s time first and arrival only to break a tie — and the recorder asks that function rather than ordering for itself');
ok(/constraint payment_event_idempotency\s+unique \(processor, idempotency_key\)/.test(TABLE) && /on conflict \(processor, idempotency_key\) do nothing/.test(RECORDER.body),
  '6b: an event is unique by (processor, idempotency_key) in the table, and the recorder\'s conflict target is the same pair');
ok(/\(r\.subscription_ref, r\.event_name, r\.processor_status, r\.occurred_at, r\.product_ref, r\.variant_ref, r\.livemode\)\s+is distinct from \(v_sub, v_name, v_status, v_occ, v_prod, v_var, v_live\) then\s+raise exception 'payment_event: this idempotency key was already recorded for a different event'\s+using errcode = '23505', constraint = 'payment_event_idempotency_key_reused'/.test(RECORDER.body),
  '6c: a key that was already recorded for a DIFFERENT event — any difference in subscription, event, status, time, product, variant or mode — is refused (23505, a named constraint) the moment the two differ, with no other condition between the comparison and the refusal, instead of being returned as a duplicate');
const elses = [...MAP.body.matchAll(/\belse\s+'([^']*)'/g)].map((m) => m[1]);
ok(elses.length === 2 && elses.every((e) => e === 'unknown') && count(CODE, /\bcase\b/gi) === 2 && /when p_processor = 'lemonsqueezy' then/.test(MAP.body),
  '6d: the ONE mapping has exactly two fall-through branches (a status it does not know, a processor it does not know) and both are \'unknown\' — never \'active\'', elses.join(','));
const mapped = [...MAP.body.matchAll(/then\s+'(\w+)'/g)].map((m) => m[1]);
ok(JSON.stringify([...new Set(mapped)].sort()) === JSON.stringify(['active', 'canceled', 'past_due', 'paused', 'trialing', 'unpaid']) && mapped.length === 7
   && /mapped_status in \('trialing', 'active', 'paused', 'past_due', 'unpaid', 'canceled', 'unknown'\)/.test(TABLE),
  '6e: the mapping produces only the six known values (seven words map to them: expired and cancelled both to canceled), and the table closes the vocabulary at those six plus \'unknown\'', mapped.join(','));
ok(/pg_advisory_xact_lock\(hashtextextended\(/.test(RECORDER.body) && RECORDER.body.indexOf('pg_advisory_xact_lock') < RECORDER.body.indexOf('insert into public.payment_event'),
  '6f: calls for one subscription are serialised by a transaction-scoped advisory lock taken BEFORE the insert, so is_latest is accurate for events recorded at the same moment');
ok(/livemode/.test(LATEST.body) && /p_livemode/.test(LATEST.body) && /v_live::text/.test(RECORDER.body),
  '6g: the mode is part of a subscription\'s identity for ordering and for the lock, so a test-mode event never displaces a live one');

// ── 7. what the recorder accepts: closed shapes ──────────────────────────────────────────────────────────────────────────────────
ok(/j <> all \(public\.payment_event_allowed_keys\(\)\)/.test(RECORDER.body) && /if v_bad is not null then\s+raise exception 'payment_event: unknown field "%"[^']*', v_bad using errcode = '22023'/.test(RECORDER.body),
  '7: a key outside the allow-list is REFUSED (22023), by name, and the message\'s only argument is the key — never a value');
ok(count(RAW, /\^\[A-Za-z0-9\._:\|=\+\/-\]\{1,200\}\$/g) === 1 && /\[A-Za-z0-9\._:\|=\+\/-\]\{1,200\}/.test(OPAQUE.body) && !/@|\s/.test((OPAQUE.body.match(/'\^\[([^\]]*)\]/) || ['', ''])[1]),
  '7b: an opaque token is defined ONCE (1 to 200 of letters, digits and . _ : | = + / -), and the allowed set has neither an @ nor a space — an email address or a name cannot be one');
ok(/\(Z\|\[\+-\]\[0-9\]\{2\}:\[0-9\]\{2\}\)\$'/.test(RECORDER.body) && /exception when others then\s+raise exception 'payment_event: "occurred_at" is not a valid timestamp'/.test(RECORDER.body),
  '7c: the processor\'s time must carry an explicit offset (Z or +hh:mm) and must be a real instant — a zone-less value would be read in the session\'s zone');
ok(/security definer/i.test(RECORDER.header) && /returns table \(outcome text, event_id bigint, is_latest boolean, recorded_at timestamptz\)/.test(RECORDER.header) && /payment_event_record\(p_event jsonb\)/.test(RECORDER.header),
  '7d: the recorder takes ONE json argument — there is no argument for an id, a time, a status or a mapped value to choose — and returns exactly outcome, event_id, is_latest and recorded_at');

const OPAQUE_FIELD = fn('payment_event_opaque_field');
const raises = [...OPAQUE_FIELD.body.matchAll(/raise exception '[^']*'([^;]*);/g)].map((m) => m[1].replace(/\s+/g, ' ').trim());
ok(raises.length === 3 && raises.every((r) => /^, p_key using errcode = '22023'$/.test(r)) && !/raise exception[^;]*p_event\s*->>/.test(OPAQUE_FIELD.body),
  '7e: every refusal of a malformed field names the FIELD (p_key) and nothing else — none of the three messages can carry the value it refused', raises.join(' | '));

// ── 8. the file is additive, idempotent, and says what it is not ───────────────────────────────────────────────────────────────────
const created = [...CODE.matchAll(/create or replace function public\.(\w+)/g)].map((m) => m[1]);
const rb = (RAW.match(/-- ROLLBACK-BEGIN\n([\s\S]*?)-- ROLLBACK-END/) || ['', ''])[1];
const rbLines = rb.split('\n').filter((l) => /^-- /.test(l)).map((l) => l.replace(/^-- /, ''));
const dropped = rbLines.filter((l) => /^drop function if exists public\.(\w+)/.test(l)).map((l) => l.match(/public\.(\w+)/)[1]);
ok(created.length === 8 && JSON.stringify([...created].sort()) === JSON.stringify([...dropped].sort()) && /^drop table if exists public\.payment_event;$/.test(rbLines[0]) && rbLines.length === 9,
  '8: the ROLLBACK block drops the table FIRST (its generated column and checks call the functions), then every one of the eight functions the file creates — computed from the file, not typed — and nothing else', created.length + '/' + dropped.length);
ok(/create table if not exists public\.payment_event/.test(SQL) && !/\bcreate\s+table\s+public\./i.test(CODE) && count(CODE, /create or replace function/g) === 8,
  '8b: the file is idempotent in shape (create table if not exists, create or replace function, create index if not exists) and creates nothing that could not be created twice');
ok(/NOT APPLIED/.test(RAW.slice(0, 400)) && /PROVISIONAL/.test(RAW) && /UNVERIFIED/.test(RAW) && /Order L/.test(RAW),
  '8c: the file says, at its head, that it is NOT APPLIED, and says that its processor assumptions are PROVISIONAL and UNVERIFIED and that entitlement is Order L\'s');

// ── 9. NO CALLER, no webhook, no second ledger ────────────────────────────────────────────────────────────────────────────────────────
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
const scanned = [...CODE_DIRS.flatMap((d) => walk(d)), ...rootFiles, ...sqlDocs, ...walk('.github/workflows')].filter((f) => /\.(sql|js|mjs|ts|html|py|sh|yml|json)$/.test(f));
const namesLedger = scanned.filter((f) => /\bpayment_event\w*/.test(read(f)));
ok(scanned.length > 100 && namesLedger.includes(SQL_PATH),
  '9-control: the scan covers the code directories, the root pages, every docs SQL and every workflow, and finds the SQL of record', scanned.length + ' files');
ok(namesLedger.every((f) => f === SQL_PATH || f === WF_PATH),
  '9: NO CALLER — no page, script, function, library or other SQL names the ledger or its recorder; only the SQL of record and its own check workflow do (the entitlement function, the gate and the checkout do not exist yet)', namesLedger.join(','));
const fnDirs = readdirSync(join(ROOT, 'supabase/functions'));
ok(fnDirs.length >= 5 && fnDirs.includes('get-address-report') && !fnDirs.some((d) => /lemon|squeez|payment|webhook|checkout|stripe|billing/i.test(d)),
  '9b: the processor webhook is NOT in this repo (it lives in homesignal-ingest and stays there) — no function directory here is a webhook, a checkout or a payment handler (control: the directory lists other functions)', fnDirs.join(','));
ok(!/\b(lemonsqueezy|lemon squeezy)\b/i.test(CODE) && /'lemonsqueezy'/.test(MAP.body),
  '9c: the only processor named in executable code is the mapping\'s one reviewed branch for it; the recorder, the table and the ordering are processor-neutral');

// ── 10. a CHECK, not a job: the workflow ───────────────────────────────────────────────────────────────────────────────────────────────
const wfOn = (WF.match(/\non:\n([\s\S]*?)\npermissions:/) || ['', ''])[1];
ok(WF.length > 1500 && /\n {2}pull_request:\n/.test('\n' + wfOn) && !/\bschedule\b|\bcron\b|\bpush\b|\bworkflow_dispatch\b|\bworkflow_run\b|\brepository_dispatch\b/.test(wfOn.replace(/#.*$/gm, '')),
  '10: the workflow is triggered by pull_request ONLY — no schedule, no cron, no push, no manual or chained trigger', wfOn.replace(/\s+/g, ' ').slice(0, 120));
ok(/test\/payment_event_ledger_pg\/run\.sh/.test(WF) && /Refuse to run if any Supabase credential is present/.test(WF) && /services:\s*\n\s*postgres:/.test(WF)
   && /POSTGRES_DB: payment_event_disposable/.test(WF) && /PGDATABASE: payment_event_disposable/.test(WF) && !/\$\{\{\s*secrets\./.test(WF) && !/secrets:\s*inherit/.test(WF),
  '10b: it runs the harness against a disposable service container, holds no secret, and refuses to run if a Supabase credential is present');
ok(['docs/payment-event-ledger.sql', 'test/payment_event_ledger_pg/**', 'test/payment-event-ledger-structure.test.mjs', '.github/workflows/payment-event-ledger-suite.yml'].every((p) => WF.includes("'" + p + "'")),
  '10c: it runs on a change to the SQL, the harness, the structural test or itself');

// ── 11. the suite, its mutations and its harness are real and wired ───────────────────────────────────────────────────────────────────────
const checks = new Set([...SUITE.matchAll(/pg_temp\._ck\(\s*'([A-Z]\d+[a-z]?\d*)\b/g)].map((m) => m[1])).size;
const mutNames = [...MUT.matchAll(/^    '([a-z_0-9]+)': \[/gm)].map((m) => m[1]);
ok(checks >= 50, '11: the executable suite carries at least 50 checks', checks);
ok(mutNames.length >= 40 && new Set(mutNames).size === mutNames.length, '11b: at least 40 distinct prohibited mutations of the SQL', mutNames.length);
const AUDIT_NINE = ['no_unique_idempotency_key', 'no_append_only_trigger', 'authenticated_can_execute', 'ordering_by_arrival', 'email_column_added',
  'allowlist_widened_to_email', 'whole_payload_stored', 'recorder_search_path_unpinned', 'recorder_writes_subscriptions', 'unknown_status_mapped_to_active'];
ok(AUDIT_NINE.every((m) => mutNames.includes(m)) && ['race_no_subscription_lock', 'rollback_leaves_the_table', 'key_reuse_not_detected', 'map_ignores_the_processor', 'no_rls', 'refusal_message_leaks_the_value', 'zoneless_time_accepted'].every((m) => mutNames.includes(m)),
  '11c: the nine mutations the Order M audit named (ten with the payload variant) are all present, and so are the ones that guard the race, the rollback, key reuse, the processor-scoped mapping, row-level security, value leakage and zone-less times');
ok(/\*disposable\*/.test(RUN) && /SURVIVED/.test(RUN) && /APPLIED TWICE/.test(RUN) && /rollback_checks/.test(RUN) && /race_checks/.test(RUN) && /wait_for_sleeper/.test(RUN)
   && /rollback_\*\)/.test(RUN) && /race_\*\)/.test(RUN) && /SUPABASE_DB_URL/.test(RUN),
  '11d: the harness refuses a non-disposable database and any Supabase credential, fails on any surviving mutation, proves a second apply changes nothing, runs and proves the rollback, and runs two real concurrent sessions that start only once the first is observed holding its transaction open');
ok(/create trigger subscriptions_trap_row/.test(FIX) && /raise exception 'TRAP: public\.subscriptions was touched/.test(FIX) && /alter default privileges in schema public grant all on tables\s+to anon, authenticated, service_role/.test(FIX),
  '11e: the fixture reproduces Supabase\'s default privileges and stands in a subscriptions table that RAISES on any touch, so a recorder that wrote to it fails the suite');
ok(/grant usage on schema public to anon, authenticated, service_role/.test(SUITE) && /alter role service_role bypassrls/.test(SUITE),
  '11f: the suite gives the stand-in roles the schema usage and RLS bypass Supabase gives them, so a refusal can only come from the objects');

// ── 12. the contract, and the status file: Order M stays OPEN ──────────────────────────────────────────────────────────────────────────────
ok(DOC.length > 12000 && /canonical truth path/i.test(DOC) && /decision owner/i.test(DOC) && /shortcut check/i.test(DOC) && /concurrency check/i.test(DOC),
  '12: the contract exists and states, before anything else, the canonical truth path, the decision owner, the shortcut check and the concurrency check', DOC.length);
ok(/PROVISIONAL/.test(DOC) && /UNVERIFIED/.test(DOC) && /not applied/i.test(DOC) && /Order L/.test(DOC) && /Order H/.test(DOC) && /Order K/.test(DOC),
  '12b: the contract marks the key and ordering columns PROVISIONAL and the processor payload UNVERIFIED, says the ledger is not applied, and names the orders it depends on');
const DECISIONS = ['offer', 'billing unit', 'seats', 'failed-payment', 'cancellation', 'commercial terms', 'Lemon Squeezy', 'rights', 'homesignal-ingest'];
ok(DECISIONS.every((d) => new RegExp(d, 'i').test((DOC.match(/## 8\.[\s\S]*?(?=\n## 9\.)/) || [''])[0])),
  '12c: every open founder decision the audit named (offer unit and price, seats, failed-payment and cancellation behaviour, commercial terms, the processor, source rights, and the right to touch homesignal-ingest) is listed in the decisions section — as a question, never as copy');
ok(!/\$\s?\d/.test(RAW) && !/\$\s?\d{2,}\s*\/\s*month/i.test(DOC.replace(/\$79\/month/g, '')) && !/refund window|grace period of \d|\d+ days of grace/i.test(RAW),
  '12d: no price, unit, refund window or grace length is invented — the SQL contains no dollar figure, and the only price the contract repeats is the one the landing page already publishes, quoted');
const mRow = (STATUS.match(/^- M\. Paid continuation path[^\n]*(?:\n {2}[^\n]*)*/m) || [''])[0];
ok(/^- M\. Paid continuation path/.test(mRow) && /\bopen\b/i.test(mRow) && /M0/.test(mRow) && /not applied/i.test(mRow) && !/~~/.test(mRow) && !/\bdone\b/i.test(mRow),
  '12e: the status file lists Order M as OPEN with M0 built and NOT applied — and not struck through, and not "done"', mRow.slice(0, 80));
ok(count(STATUS, /^- M\. Paid continuation path/gm) === 1 && /^- ~~C\. Durable observation\/delta layer~~/m.test(STATUS) && /^- N\. End-to-end launch gate — open\./m.test(STATUS),
  '12f: the status file lists M exactly once, and the rest of it is as it was (control: Order C is still struck, Order N still open)');

// ── 13. nothing here is a secret or a model name ────────────────────────────────────────────────────────────────────────────────────────────────────
const NEW_FILES = [SQL_PATH, DOC_PATH, WF_PATH, 'test/payment_event_ledger_pg/suite.sql', 'test/payment_event_ledger_pg/mutate.py', 'test/payment_event_ledger_pg/run.sh', 'test/payment_event_ledger_pg/fixture.sql'];
const SECRET = /eyJ[A-Za-z0-9_-]{20,}|-----BEGIN [A-Z ]*PRIVATE|\bsk_(live|test)_[A-Za-z0-9]{8,}|\bwhsec_[A-Za-z0-9]{8,}|service_role_key\s*[:=]/;
const MODEL = new RegExp('\\b(' + ['cl' + 'aude(?!\\.md)', 'son' + 'net', 'op' + 'us', 'hai' + 'ku', 'anthr' + 'opic', 'g' + 'pt-?\\d'].join('|') + ')\\b', 'i');
ok(NEW_FILES.every(has) && NEW_FILES.every((f) => !SECRET.test(read(f))) && SECRET.test('whsec_abcdefgh12345678') && SECRET.test('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'),
  '13: no file of this change carries a secret, a signing secret, a JWT or a private key (control: the screen catches a planted one)');
ok(NEW_FILES.every((f) => !MODEL.test(read(f))) && MODEL.test('a ' + 'cl' + 'aude id') && MODEL.test('gpt-4') && !MODEL.test('see CLAUDE.md'),
  '13b: no file of this change names a model or a model vendor (control: the screen catches a planted one)');

console.log('\n' + (n - bad) + ' passed, ' + bad + ' failed of ' + n);
process.exit(bad ? 1 : 0);
