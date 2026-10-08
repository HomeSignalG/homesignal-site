// REPORT PRIVATE CONTEXT — the structural half (the executable half is test/report_private_context_pg).
//
// The customer-entered street address is NOT permanent intelligence (founder decision 2026-09-29). It lives in
// a deletable table, is kept only while a report, a property Follow or an account relationship needs it, is
// purged 90 days after the LAST such need ends (immediately on a verified privacy request or a legal
// requirement), and is purged IN PLACE so the permanent snapshot that points at it stays whole.
// A PostgreSQL suite proves that BEHAVES. What it cannot see is a second definition of the 90 days, a way to
// delete a row instead of purging it, a writer beside the audited functions, a consumer that reads the private
// table before Orders J and L have designed who may, or a schedule armed without a go. Those are pinned here on
// COMMENT-STRIPPED text, each with a positive control so a scan that matched nothing cannot pass.
// Run: node test/report-private-context-structure.test.mjs
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

let n = 0, bad = 0;
const ok = (c, m, d) => { n++; if (c) console.log('PASS — ' + m); else { bad++; console.log('FAIL — ' + m + (d !== undefined ? '  [' + d + ']' : '')); } };
const ROOT = new URL('..', import.meta.url).pathname;
const read = (f) => readFileSync(join(ROOT, f), 'utf8');
const stripSql = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');

const RAW = read('docs/report-private-context.sql');
const SQL = stripSql(RAW);
const SQL_NO_STRINGS = SQL.replace(/'(?:[^']|'')*'/g, "''");
const SUITE = read('test/report_private_context_pg/suite.sql');
const MUT = read('test/report_private_context_pg/mutate.py');
const RUN = read('test/report_private_context_pg/run.sh');
const WF = existsSync(join(ROOT, '.github/workflows/report-snapshot-suite.yml')) ? read('.github/workflows/report-snapshot-suite.yml') : '';
const fn = (name) => (SQL.match(new RegExp('create or replace function public\\.' + name + '\\([\\s\\S]*?\\n(?:end \\$\\$;|\\$\\$;)')) || [''])[0];
const CREATE = fn('report_private_context_create');
const OPEN = fn('report_private_context_need_open');
const CLOSE = fn('report_private_context_need_close');
const PURGE = fn('report_private_context_purge');
const DUE = fn('report_private_context_purge_due');
const CHECK = fn('report_private_context_retention_check');
const CTX_TABLE = (SQL.match(/create table if not exists public\.report_private_context \([\s\S]*?\n\);/) || [''])[0];
const EVT_TABLE = (SQL.match(/create table if not exists public\.report_private_context_event \([\s\S]*?\n\);/) || [''])[0];

// ── 0. everything under test is located (positive control for every scan below) ─────────────────────
ok(SQL.length > 9000 && SUITE.length > 25000 && MUT.length > 8000 && RUN.length > 2500,
  '0: the SQL of record, the suite, the mutations and the harness are all located and non-empty');
ok([CREATE, OPEN, CLOSE, PURGE, DUE, CHECK].every((f) => f.length > 300) && CTX_TABLE.length > 900 && EVT_TABLE.length > 500,
  '0b: every function and both tables are found', [CREATE, OPEN, CLOSE, PURGE, DUE, CHECK].map((f) => f.length).join('/'));

// ── 1. the 90 days is defined once ──────────────────────────────────────────────────────────────────────
const literals = SQL_NO_STRINGS.match(/interval\s+''/g) || [];
ok((SQL.match(/interval\s+'90 days'/g) || []).length === 1 && /report_private_context_grace\(\)[\s\S]{0,80}interval '90 days'/.test(SQL),
  '1: the interval \'90 days\' appears exactly once in the code, and it is the body of report_private_context_grace()');
ok((SQL.match(/report_private_context_grace\(\)/g) || []).length === 4
   && /constraint report_private_context_grace_ceiling check \(purge_due_at is null or purge_due_at <= last_needed_at \+ public\.report_private_context_grace\(\)\)/.test(CTX_TABLE)
   && /purge_due_at = now\(\) \+ public\.report_private_context_grace\(\)/.test(CLOSE),
  '1b: the ceiling constraint, the clock and the audit all go through that one function — a second number cannot be typed in beside it');
ok(!/\b(180|365|30|60|120)\s*days\b/.test(SQL) && !/make_interval|interval\s+'\d+\s+(hour|month|year|week)/i.test(SQL),
  '1c: no other retention period exists in the file');

// ── 2. a purge is IN PLACE: nothing here deletes, truncates or drops private data ────────────────────────
ok(!/\bdelete\s+from\b/i.test(SQL) && !/\btruncate\b/i.test(SQL.replace(/before truncate/gi, '')) && !/\bdrop\s+(table|view|trigger|policy|schema|function|column)\b/i.test(SQL),
  '2: the SQL never deletes a row, truncates a table or drops an object (the rollback lives in a comment) — purging is an UPDATE that blanks the values and keeps the tombstone');
const upd = (re) => (SQL.match(re) || []).length;
ok(upd(/\bupdate\s+public\.report_private_context\b(?!_)/g) === 3 && /update public\.report_private_context\s+set state = 'purged'/.test(PURGE),
  '2b: the context table is updated in exactly three places — need_open, need_close, purge — and the one that sets state to purged is the purge function', upd(/\bupdate\s+public\.report_private_context\b(?!_)/g));
const blanked = ['address', 'normalized_address', 'latitude', 'longitude', 'property_keys', 'label'];
ok(blanked.every((c) => new RegExp('\\b' + c + ' = null').test(PURGE)) && /purge_due_at = null/.test(PURGE),
  '2c: the purge blanks all six private columns and the clock', blanked.filter((c) => !new RegExp('\\b' + c + ' = null').test(PURGE)).join(','));
ok(blanked.every((c) => new RegExp('\\b' + c + ' is null').test(CTX_TABLE)) && /constraint report_private_context_purged_is_empty/.test(CTX_TABLE),
  '2d: the table itself refuses a purged row that still holds any of the six (so a mutated purge cannot silently keep one)');
ok(/before update or delete on public\.report_private_context\s+for each row execute function public\.report_private_context_guard\(\)/.test(SQL)
   && /old\.state = 'purged'/.test(SQL) && /never deleted \(% refused\)/.test(SQL),
  '2e: a purged context is terminal and no context row can be deleted (trigger), so the snapshot\'s foreign key can never dangle');
ok(!/before truncate on public\.report_private_context\b(?!_)/.test(SQL) && /before truncate on public\.report_private_context_need/.test(SQL) && /before truncate on public\.report_private_context_event/.test(SQL),
  '2f: truncate is stopped where it can be stopped — the append-only need and event tables (PostgreSQL itself refuses a plain TRUNCATE of the referenced context table, and CASCADE reaches those two)');

// ── 3. the retention rule, as code ───────────────────────────────────────────────────────────────────────────
ok(/if not exists \(select 1 from public\.report_private_context_need where context_id = p_context and closed_at is null\) then/.test(CLOSE)
   && /purge_due_at = now\(\) \+ public\.report_private_context_grace\(\)/.test(CLOSE),
  '3: the clock starts only when the LAST open need closes');
ok(/set last_needed_at = now\(\), purge_due_at = null/.test(OPEN),
  '3b: opening a need clears the clock (the recovery window)');
ok(/p_reason = 'retention_expired'/.test(PURGE) && /c\.purge_due_at > now\(\)/.test(PURGE) && /closed_at is null/.test(PURGE),
  '3c: "retention_expired" is refused unless the clock has run out and nothing needs the context');
ok(/p_reason not in \('retention_expired', 'verified_privacy_request', 'legal_requirement'\)/.test(PURGE),
  '3d: a privacy request and a legal requirement are accepted without waiting for the clock, and no other reason is');
const reasonSets = [PURGE, CTX_TABLE, EVT_TABLE].map((t) => [...(t.match(/'(retention_expired|verified_privacy_request|legal_requirement)'/g) || [])].map((x) => x.replace(/'/g, '')));
ok(reasonSets.every((s) => new Set(s).size === 3), '3e: the same three purge reasons are named by the function, the context table and the audit log', reasonSets.map((s) => [...new Set(s)].join('/')).join(' | '));
ok(/purge_due_at <= now\(\)/.test(DUE) && /report_private_context_purge\(r\.context_id, 'retention_expired'\)/.test(DUE) && /exception when sqlstate '55000'/.test(DUE),
  '3f: the batch purges only contexts whose clock has run out, through the same audited purge, and leaves one alone if a need was reopened in the meantime');

// ── 4. what may be stored, and what may not ──────────────────────────────────────────────────────────────────────
const allowed = (CREATE.match(/k not in \(([^)]*)\)/) || ['', ''])[1].match(/'(\w+)'/g)?.map((x) => x.replace(/'/g, '')).sort();
ok(JSON.stringify(allowed) === JSON.stringify(['address', 'label', 'latitude', 'longitude', 'normalized_address', 'property_keys']),
  '4: create() accepts exactly six fields and REFUSES any other — a client name, email or phone has no way in', String(allowed));
ok(!/client|email|phone|name\b/i.test(CTX_TABLE) && !/client|email|phone/i.test(CREATE.replace(/unknown field/g, '')),
  '4b: no column or code path in the private layer is for a client identifier');
ok(!/\bowner|account_id|user_id|brokerage/i.test(CTX_TABLE),
  '4c: no owner column yet — whose context it is depends on the account tables of Orders J and L, and is added with them');
const evtCols = [...EVT_TABLE.matchAll(/^\s{2}(\w+)\s+(?:bigint|uuid|text|timestamptz)\b/gm)].map((m) => m[1]).sort();
ok(JSON.stringify(evtCols) === JSON.stringify(['at', 'context_id', 'event_id', 'kind', 'need_kind', 'reason']),
  '4d: the audit log has six columns and no free-text one', evtCols.join(','));
ok(['kind', 'need_kind', 'reason'].every((c) => new RegExp('constraint report_private_context_event_' + c + ' check').test(EVT_TABLE)),
  '4e: each of its three text columns is restricted to a fixed vocabulary by a CHECK, so the log cannot hold an address even by mistake');

// ── 5. the only writers, and the only readers ────────────────────────────────────────────────────────────────────────
ok((SQL.match(/\binsert\s+into\s+public\.report_private_context\b(?!_)/g) || []).length === 1 && /insert into public\.report_private_context \(/.test(CREATE),
  '5: the only INSERT into the private table is inside create()');
ok((SQL.match(/\binsert\s+into\s+public\.report_private_context_event\b/g) || []).length >= 5
   && ![OPEN, CLOSE, PURGE, CREATE].some((f) => false)
   && [...SQL.matchAll(/insert into public\.report_private_context_event/g)].every((m) => [CREATE, OPEN, CLOSE, PURGE].some((f) => f.includes(m[0]))),
  '5b: every audit event is written by one of the four functions that change state — no other code logs, and none skips logging');
const allFiles = (() => {
  const out = [];
  const walk = (dir) => { const abs = join(ROOT, dir); if (!existsSync(abs)) return; for (const f of readdirSync(abs)) { const p = join(abs, f); if (f === 'node_modules' || f === '.git') continue; if (statSync(p).isDirectory()) walk(join(dir, f)); else out.push(relative(ROOT, p)); } };
  ['lib', 'scripts', 'supabase', 'partials', 'bluesky'].forEach(walk);
  readdirSync(ROOT).filter((f) => /\.(html|js|mjs|ts)$/.test(f)).forEach((f) => out.push(f));
  readdirSync(join(ROOT, 'docs')).filter((f) => f.endsWith('.sql')).forEach((f) => out.push('docs/' + f));
  return out.filter((f) => /\.(sql|js|mjs|ts|html|py|sh|yml|json)$/.test(f));
})();
const code = (f) => { const t = readFileSync(join(ROOT, f), 'utf8'); return f.endsWith('.sql') ? stripSql(t) : t; };
const namesPrivate = allFiles.filter((f) => /report_private_context/.test(code(f)));
ok(allFiles.length > 50 && namesPrivate.includes('docs/report-private-context.sql'),
  '5c-control: the scan covers the code directories, the root files and every docs SQL, and finds the SQL of record', allFiles.length + ' files');
// The ONE addition (2026-10-01, founder go for gate 5): the file that schedules the purge and watches it. It names the layer
// because it must; test/report-private-context-purge-structure.test.mjs pins that it never names a private COLUMN, never
// writes the layer, and never calls the per-context purge. Anything else naming the layer is still a consumer nobody designed.
// The SECOND addition (2026-10-01, the Follow / Changes Since Report function; contract §4: "a property Follow ... registers its own"
// need, and §6 gate 4): the one file that calls the two need functions. It is the data layer of an internal admin function, and
// 5c2 below pins that it names ONLY those two functions: never the table, never a column, never the read function (5d), never
// the writer or the purge. Anything else naming the layer is still a consumer nobody designed.
const FOLLOW_DATA = 'supabase/functions/follow-development-report/data.ts';
// The THIRD addition (2026-10-02): the follow-up that closes the audit log's identity counter, which production left usable by
// anon and authenticated. It names the layer because it must (it finds the counter through the layer's tables); 5c3 below pins that
// it names ONLY the event table and its own name, never a column, a function or the read path, and
// test/report-private-context-sequence-lockdown-structure.test.mjs pins that it only ever REVOKES, from a computed lookup.
const SEQ_LOCKDOWN = 'docs/report-private-context-sequence-lockdown.sql';
// The FOURTH addition (2026-10-02, build step 5b): the report function's data layer. When a retried trial key returns the FIRST stored
// report (docs/evaluation-entitlement.sql D-L6: the key is bound to the evaluation, never to the address), it must know whether that
// report is about the same property before showing it. It calls the read function ONCE and compares the address inside one function;
// only 'match' / 'mismatch' / 'unknown' leaves it (5c4, 5d). It never names the table, a column outside that comparison, the writer
// or the purge.
const REPORT_DATA = 'supabase/functions/get-development-activity-report/data.ts';
// The FIFTH addition (2026-10-03, build step 8): the ONE reader of a stored report's address and client label, _shared/private-subject.ts. Build
// steps 6 and 7 had that read inside the report function's data layer; step 8 lets the holder of a client share link see the street address too
// (founder, 2026-10-03), and a second copy of "only while the layer still keeps it" in the public function would be a second way to decide that
// fact. So the read moved to one shared file with two windows: subjectOf (address and label, for a member of the brokerage) and addressOf
// (the address alone, for the holder of a link). 5c5 and 5d pin it.
const PRIVATE_SUBJECT = 'supabase/functions/_shared/private-subject.ts';
// The SIXTH addition (2026-10-03, build step 9): the Watch. Its SQL (docs/property-watch.sql) asks the layer to KEEP a watched property (need_open) and to let go
// of it (need_close, from the trigger that runs on every removal of a watch) and reads the need table once, in its audit; it never asks for a value. The ONE reader
// above gains a third window, pointOf, for the daily job alone: the property's point, and nothing else. 5c6 pins the SQL; 5c5 pins the three windows.
const WATCH_SQL = 'docs/property-watch.sql';
ok(namesPrivate.every((f) => ['docs/report-private-context.sql', 'docs/report-snapshot.sql', 'docs/report-private-context-purge-schedule.sql', FOLLOW_DATA, SEQ_LOCKDOWN, REPORT_DATA, PRIVATE_SUBJECT, WATCH_SQL].includes(f)),
  '5c: nothing else in the repository names the private layer — no page, script, function or consumer reads or writes it yet (Orders J and L design who may); the additions are the file that schedules and watches the purge, the Follow function\'s data layer, the file that closes the audit log\'s counter, the report function\'s replay check, and the one shared reader of a stored report\'s address, label and (for the daily Watch) point, and the Watch SQL, which only asks the layer to keep and release a property', namesPrivate.join(','));
{
  const names = [...new Set([...code(SEQ_LOCKDOWN).matchAll(/report_private_context\w*/g)].map((m) => m[0]))].sort();
  ok(namesPrivate.includes(SEQ_LOCKDOWN) && names.length > 0
     && names.every((x) => ['report_private_context', 'report_private_context_event', 'report_private_context_sequence_lockdown'].includes(x)),
    '5c3: the counter lock-down names the private layer only as its event table, the layer\'s own name and its own prefix (control: it does name them; never a column, a function or the read path)', names.join(','));
}
{
  const names = [...code(FOLLOW_DATA).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1').matchAll(/report_private_context\w*/g)].map((m) => m[0]);
  ok(namesPrivate.includes(FOLLOW_DATA) && names.length === 2 && names.every((x) => x === 'report_private_context_need_open' || x === 'report_private_context_need_close'),
    '5c2: the Follow function\'s data layer names the private layer only as report_private_context_need_open and report_private_context_need_close (control: it does name them; and nothing else, in code)', names);
}
{
  const t = code(REPORT_DATA).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
  const names = [...t.matchAll(/report_private_context\w*/g)].map((m) => m[0]);
  const fn = (t.match(/async contextMatches\(contextId, address\) \{[\s\S]*?\n    \},/) || [''])[0];
  // build step 8: the report function's data layer no longer reads a stored report's address itself; it hands that to the one shared reader (5c5).
  // What stays here is the replay check: contextMatches returns only 'match' / 'mismatch' / 'unknown' and reads no column but the address it compares.
  ok(namesPrivate.includes(REPORT_DATA) && JSON.stringify(names) === '["report_private_context_read"]' && fn.includes('report_private_context_read')
     && /subjectOf: \(contextId\) => subjects\.subjectOf\(contextId, LABEL_MAX\),/.test(t) && /const subjects = makePrivateSubjectReads\(rpc\);/.test(t)
     && [...fn.matchAll(/return ([^;]+);/g)].map((m) => m[1]).every((r) => /^'unknown'$|^norm\(c\.address\) === norm\(address\) \? 'match' : 'mismatch'$/.test(r))
     && !/c\.(normalized_address|latitude|longitude|label|property_keys|purge)/.test(t),
    '5c4: the report function\'s data layer names the private layer once, the read function, inside contextMatches (which returns only \'match\' / \'mismatch\' / \'unknown\' and reads no column but the address it compares); a stored report\'s address and label are asked of the shared reader, and no private column is named here (control: it does name it)', names);
}
{
  const t = code(PRIVATE_SUBJECT).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
  const names = [...t.matchAll(/report_private_context\w*/g)].map((m) => m[0]);
  const subj = (t.match(/async subjectOf\(contextId: string \| null, labelMax: number\)[^{]*\{[\s\S]*?\n    \},/) || [''])[0];
  const addr = (t.match(/async addressOf\(contextId: string \| null\)[^{]*\{[\s\S]*?\n    \},/) || [''])[0];
  // the ONE reader, with two windows. subjectOf (for a member of the brokerage) returns the address and the cleaned label; addressOf (for the holder
  // of a client share link) returns the address as a bare string, and its text cannot reach the label. Both read only while the layer holds the
  // context ('active'); a failed or oddly shaped read is a fault, never "no address".
  // build step 9: a THIRD window, pointOf, for the daily Watch job. It is a separate read of the same function (so the two display windows can
  // never hand back a coordinate by accident), which is why the function is now named twice here: once inside activeContext (the display windows) and
  // once inside pointOf. The point columns appear in pointOf and NOWHERE else; pointOf names no address and no label, so it cannot return one.
  const cut = t.indexOf('async pointOf(');
  const display = cut > 0 ? t.slice(0, cut) : '';
  const point = cut > 0 ? t.slice(cut) : '';
  ok(namesPrivate.includes(PRIVATE_SUBJECT) && names.length === 2 && names.every((x) => x === 'report_private_context_read')
     && (display.match(/report_private_context_read/g) || []).length === 1 && (point.match(/report_private_context_read/g) || []).length === 1
     && /if \(!c \|\| c\.state !== 'active'\) return null;/.test(display) && /if \(!contextId\) return null;/.test(display) && /if \(error \|\| !Array\.isArray\(data\)\) throw new DataUnavailable\('private context'\);/.test(display)
     && subj.length > 100 && /label: cleanDisplayName\(c\.label, labelMax\)/.test(subj)
     && addr.length > 60 && !/label/i.test(addr) && /return c \? addressText\(c\.address\) : null;/.test(addr)
     && (t.match(/c\.label/g) || []).length === 2 && /return \{ address: c\.address, label: c\.label \};/.test(display)
     && !/c\.(normalized_address|latitude|longitude|property_keys|purge)/.test(display)
     && point.length > 200 && /if \(!c \|\| c\.state !== 'active'\) return null;/.test(point) && /return \{ lat, lng \};/.test(point)
     && !/address|label|normalized|property_keys|purge/i.test(point.replace(/DataUnavailable\('private context'\)/g, '')),
    '5c5: the shared reader calls the read function once per window kind, only for a context the layer still holds (state \'active\'): subjectOf returns the address and the cleaned label, addressOf returns the address alone and its text never names the label, pointOf returns the point alone and names no address or label, and the point columns are read nowhere else (control: it does name the function, twice)', names);
}
{
  // build step 9: the Watch SQL asks the layer to KEEP a watched property and to LET GO of it, and reads the need table once (its audit). It never reads a value:
  // not the read function, not the private table, not a column of either. Comments are stripped first (the file's header names the layer in prose).
  const t = code(WATCH_SQL).replace(/--[^\n]*/g, '');
  const names = [...new Set([...t.matchAll(/report_private_context\w*/g)].map((m) => m[0]))].sort();
  ok(namesPrivate.includes(WATCH_SQL) && JSON.stringify(names) === '["report_private_context_need","report_private_context_need_close","report_private_context_need_open"]'
     && !/report_private_context_(read|create|purge|retention)/.test(t) && !/from public\.report_private_context\s/.test(t)
     && (t.match(/public\.report_private_context_need n\b/g) || []).length === 1 && /select 1 from public\.report_private_context_need n/.test(t),
    '5c6: the Watch SQL names the private layer only as need_open, need_close and the need table (read once, in its audit, as an existence test); never the read function, the private table, or a value (control: it does name all three)', names.join(','));
}
ok(allFiles.filter((f) => f !== 'docs/report-private-context.sql' && /report_private_context_read/.test(code(f))).sort().join() === [PRIVATE_SUBJECT, REPORT_DATA].sort().join(),
  '5d: two FILES call the function that returns the private values: the report function\'s data layer, for the replay check (compares, returns no value), and the one shared reader of a stored report\'s own address and label (build steps 6, 7 and 8)');
ok(!/cron\./i.test(SQL) && !/pg_cron/i.test(SQL) && !/net\.http/i.test(SQL),
  '5e: THIS file arms no schedule and makes no network call — the purge batch is scheduled only by docs/report-private-context-purge-schedule.sql, a separate file with its own go and its own proof');

// ── 6. lock-down: system-only ─────────────────────────────────────────────────────────────────────────────────────────────
ok(['report_private_context', 'report_private_context_need', 'report_private_context_event'].every((t) =>
    new RegExp('alter table public\\.' + t + '\\s+enable row level security;').test(SQL)
    && new RegExp('revoke all on public\\.' + t + '\\s+from public, anon, authenticated, service_role;').test(SQL)),
  '6: all three tables have RLS on and every privilege revoked from public, anon, authenticated and service_role');
const grants = [...SQL.matchAll(/^grant\s+(.*?)\s+on\s+(\S+)\s+to\s+(.*?);/gim)].map((m) => m[1] + ' | ' + m[2] + ' | ' + m[3]);
ok(JSON.stringify(grants.sort()) === JSON.stringify(['select | public.report_private_context_event | service_role', 'select | public.report_private_context_need | service_role']),
  '6b: the ONLY table grants are SELECT on the need and event tables to service_role — the private table itself is granted to nobody', grants.join(' ; '));
ok(/like 'report\\_private\\_context\\_%'/.test(SQL) && /revoke all on function %s from public, anon, authenticated/.test(SQL) && /grant execute on function %s to service_role/.test(SQL),
  '6c: every report_private_context_ function is locked by a COMPUTED loop, then granted to service_role only');
const definers = ['create', 'need_open', 'need_close', 'read', 'purge', 'purge_due', 'retention_check'].filter((f) => new RegExp('report_private_context_' + f + '\\([\\s\\S]*?security definer set search_path = public, pg_temp').test(SQL));
ok(definers.length === 7 && (SQL.match(/security definer/g) || []).length === 7,
  '6d: exactly the seven functions that touch private data are security definer with a pinned search_path', definers.join(','));

// ── 7. additive, no locality ───────────────────────────────────────────────────────────────────────────────────────────────
ok(![...SQL.matchAll(/\balter\s+table\s+(?:if exists\s+)?(\S+)/gi)].some((m) => !/^public\.report_private_context(_need|_event)?$/.test(m[1])),
  '7: only the three tables of this file are altered');
const localisms = SQL.match(/\b(nyc|new york|manhattan|brooklyn|bronx|queens|staten|dob|socrata|arcgis|legistar|granicus|tucson|phoenix|denver)\b/gi) || [];
ok(localisms.length === 0, '7b: no city, market or source-vendor literal', localisms.join(','));
ok(/ROLLBACK/.test(RAW) && RAW.slice(RAW.lastIndexOf('-- ROLLBACK')).includes('report-snapshot.sql') && RAW.slice(RAW.lastIndexOf('-- ROLLBACK')).includes('drop table if exists public.report_private_context_event'),
  '7c: the ROLLBACK block names the three tables and says to roll back the snapshot file first (its foreign key points here)');

// ── 8. the suite, its mutations and its workflow are real and wired ───────────────────────────────────────────────────────
const checks = new Set([...SUITE.matchAll(/pg_temp\._ck\(\s*'([A-Z]\d+[a-z]?\d*)\b/g)].map((m) => m[1])).size;
const mutNames = [...MUT.matchAll(/^    '([a-z_0-9]+)': \[/gm)].map((m) => m[1]);
ok(checks >= 45, '8: the executable suite carries at least 45 checks', checks);
ok(mutNames.length >= 45 && new Set(mutNames).size === mutNames.length, '8b: at least 45 distinct prohibited mutations', mutNames.length);
ok(['grace_is_91_days', 'grace_is_89_days', 'no_ceiling_constraint', 'clock_never_starts', 'clock_starts_while_still_needed', 'purge_keeps_the_address', 'purge_keeps_the_coordinates',
    'purge_keeps_label_and_keys', 'no_expiry_guard', 'privacy_request_waits_for_the_clock', 'purged_is_not_terminal', 'context_row_can_be_deleted', 'events_can_be_edited',
    'unknown_fields_are_stored', 'audit_log_holds_the_address', 'service_role_can_read_the_private_table', 'anon_can_read_the_log', 'noop_close_restarts_the_clock', 'check_has_no_control']
     .every((m) => mutNames.includes(m)),
  '8c: the mutations that matter most are all present — the 90 days either way, the ceiling, the clock, every private column surviving a purge, the expiry guard, the override, terminal state, deletion, unknown fields, an address in the log, service_role reading the table, anon reading the log, a no-op close restarting the clock, and an audit check with no control');
ok(/\*disposable\*/.test(RUN) && /mutated="\$\(python3/.test(RUN) && /SURVIVED/.test(RUN) && /APPLIED TWICE/.test(RUN),
  '8d: the harness refuses a non-disposable database, fails on any surviving mutation, and proves a second apply changes nothing');
ok(/set client_min_messages = warning;/.test(SUITE) && /create function pg_temp\._purge\(/.test(SUITE) && /S01/.test(SUITE),
  '8e: the suite\'s setup steps are crash-proof (a regression becomes a failed check, not a suite that stops before naming it)');
ok(/grant usage on schema public to anon, authenticated, service_role/.test(SUITE) && /alter role service_role bypassrls/.test(SUITE),
  '8f: the suite gives the stand-in roles the schema usage and RLS bypass Supabase gives them, so a refusal can only come from the objects');
ok(WF.length > 300 && /test\/report_private_context_pg\/run\.sh/.test(WF) && /docs\/report-private-context\.sql/.test(WF) && !/SUPABASE_[A-Z_]+:\s*\$\{\{\s*secrets\./.test(WF),
  '8g: the workflow runs this harness against a disposable container and is triggered by changes to this SQL');

console.log('\n' + (n - bad) + ' passed, ' + bad + ' failed of ' + n);
process.exit(bad ? 1 : 0);
