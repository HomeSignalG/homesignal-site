// PRIVATE-CONTEXT EVENT COUNTER LOCK-DOWN — the structural half (the executable half is
// test/report_private_context_pg/sequence_lockdown.sh).
//
// docs/report-private-context-sequence-lockdown.sql closes the one sequence behind public.report_private_context_event's
// identity column, which production left usable by anon and authenticated (measured read-only 2026-10-02). A PostgreSQL
// suite proves it closes the counter and leaves the writers working. What it cannot see is the file growing a second job:
// a GRANT, a change to a table or function, a sequence that belongs to another workstream named and revoked on a guess, a
// lookup that types the sequence's name (and so stops covering the next one), or a fail-closed refusal that quietly
// disappears. Those are pinned here on COMMENT-STRIPPED text, each with a positive control so a scan that matched nothing
// cannot pass.
// Run: node test/report-private-context-sequence-lockdown-structure.test.mjs
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

let n = 0, bad = 0;
const ok = (c, m, d) => { n++; if (c) console.log('PASS — ' + m); else { bad++; console.log('FAIL — ' + m + (d !== undefined ? '  [' + d + ']' : '')); } };
const ROOT = new URL('..', import.meta.url).pathname;
const read = (f) => readFileSync(join(ROOT, f), 'utf8');
// A scanner, not a regex: a `--` inside a string literal is not a comment (see report-private-context-purge-structure.test.mjs).
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
const count = (s, re) => (s.match(re) || []).length;

const RAW = read('docs/report-private-context-sequence-lockdown.sql');
const SQL = stripSql(RAW);
const RUN = read('test/report_private_context_pg/sequence_lockdown.sh');
const MUT = read('test/report_private_context_pg/sequence_lockdown_mutate.py');
const WF = read('.github/workflows/report-snapshot-suite.yml');
const STATUS = read('docs/development-activity-status-2026-09-30.md');

// ── 0. everything under test is located (positive control for every scan below) ───────────────────────────────────────
ok(RAW.length > 4000 && SQL.length > 1800 && RUN.length > 4000 && MUT.length > 3000, '0: the SQL of record, the harness and the mutations are located and non-empty',
  [RAW.length, SQL.length, RUN.length, MUT.length].join('/'));
ok(count(SQL, /'/g) % 2 === 0 && count(SQL, /'/g) > 20, '0b: after comment stripping every string literal is closed', count(SQL, /'/g));
ok(RAW.length - SQL.length > 2500 && /grant all on sequence/.test(RAW) && !/grant all on sequence/.test(SQL),
  '0c: stripping removed the comments (the rollback GRANT is in a comment and is gone from the executable text)', RAW.length - SQL.length);

// ── 1. it is parked, and says so ───────────────────────────────────────────────────────────────────────────────────────
ok(/NOT APPLIED/.test(RAW.slice(0, 600)) && /own go/i.test(RAW.slice(0, 600)),
  '1: the header says the file is NOT APPLIED by its own merge and that applying it needs its own go');

// ── 2. it does one thing: it removes privileges from sequences ──────────────────────────────────────────────────────────
ok(count(SQL, /\brevoke\b/gi) === 1 && count(SQL, /execute format\(/gi) === 1,
  '2: exactly one REVOKE, issued through exactly one dynamic EXECUTE', count(SQL, /\brevoke\b/gi) + '/' + count(SQL, /execute format\(/gi));
ok(!/\bgrant\b/i.test(SQL), '2b: no GRANT in the executable text (the file only removes privileges)');
ok(!/\b(create|alter|drop|truncate|insert|update|delete)\b/i.test(SQL.replace(/'[^']*'/g, "''")),
  '2c: no CREATE, ALTER, DROP, TRUNCATE, INSERT, UPDATE or DELETE outside a string literal (it touches no table, function or row)');
ok(/revoke all on sequence %s from public, anon, authenticated, service_role/.test(SQL),
  '2d: the revoke names all four principals: PUBLIC, anon, authenticated and service_role');

// ── 3. the lookup is COMPUTED from the catalogue, not typed ───────────────────────────────────────────────────────────
ok(/pg_depend/.test(SQL) && /deptype in \('a', 'i'\)/.test(SQL) && /t\.relname like 'report\\_private\\_context%'/.test(SQL),
  '3: the sequences are found through pg_depend (the sequence a report_private_context* column owns), not by name');
ok(!/report_private_context_event_event_id_seq/.test(SQL) && /report_private_context_event_event_id_seq/.test(RAW),
  '3b: the sequence name appears only in a comment, never in executable code (a typed name stops covering the next sequence)');

// ── 4. it fails closed ─────────────────────────────────────────────────────────────────────────────────────────────────
ok(/to_regclass\('public\.report_private_context_event'\) is null/.test(SQL) && /raise exception/.test(SQL.slice(SQL.indexOf('$pre$'), SQL.indexOf('$pre$;'))),
  '4: it refuses to run when the event table is absent');
ok(/if n = 0 then/.test(SQL) && /found no sequence/.test(SQL),
  '4b: it refuses to report success over a lookup that found nothing (a loop over nothing looks exactly like a loop that worked)');
ok(/aclexplode\(coalesce\(c\.relacl, acldefault\('S', c\.relowner\)\)\)/.test(SQL) && /a\.grantee <> c\.relowner/.test(SQL) && /is still usable by/.test(SQL),
  '4c: the post-condition is computed (no grantee at all except the owner, PUBLIC included) and refuses when any remains');
ok(/has_sequence_privilege\(s\.relowner, s\.oid, 'USAGE'\)/.test(SQL), '4d: the post-condition also refuses if the owner lost the counter (every definer writer would fail)');

// ── 5. it names no other workstream's sequence ─────────────────────────────────────────────────────────────────────────
const OTHERS = ['dc_acquisition_run', 'local_news_geo_migration_rows', 'maps_dc_generation_request', 'source_document_events'];
ok(OTHERS.every((t) => RAW.includes(t)) && OTHERS.every((t) => !SQL.includes(t)),
  '5: the four other open counters are named in the header for their owners and never in executable code (revoking from a role their writers may rely on, unread, would be a guess)');

// ── 6. the harness proves the gap first, the fix second, and every refusal ───────────────────────────────────────────────
ok(count(RUN, /ck "BEFORE:/g) >= 6 && /BEFORE: anon nextval succeeds/.test(RUN) && /BEFORE: authenticated setval succeeds/.test(RUN),
  '6: the harness reproduces the gap first (at least 6 BEFORE checks, including that anon nextval and authenticated setval SUCCEED)', count(RUN, /ck "BEFORE:/g));
ok(/grant usage on schema public to anon, authenticated, service_role/.test(RUN) && /grant usage on sequence \$SEQ to public/.test(RUN),
  '6b: the API roles hold schema USAGE (so a refusal is the sequence\'s) and PUBLIC holds a grant to be cleared (so forgetting PUBLIC is visible)');
ok(/ABSENT TABLE/.test(RUN) && /ZERO SEQUENCES/.test(RUN) && /a second apply changes nothing/.test(RUN) && /AFTER: a definer writer still works/.test(RUN)
   && /an UNRELATED sequence is left exactly as it was/.test(RUN),
  '6c: it proves both refusals, idempotence, that a definer writer still works, and that an unrelated sequence is untouched');
ok(count(MUT, /^    '[a-z_]+': \[/gm) >= 9 && /partial_revoke_and_no_post/.test(MUT) && /def post_block_removed/.test(MUT),
  '6d: at least 10 prohibited mutations are registered, including one that removes the post-condition so the checks must stand alone', count(MUT, /^    '[a-z_]+': \[/gm));

// ── 7. CI runs it, and the record names it ───────────────────────────────────────────────────────────────────────────────
ok(count(WF, /docs\/report-private-context-sequence-lockdown\.sql/g) >= 2 && /report_private_context_pg\/sequence_lockdown\.sh/.test(WF),
  '7: the workflow triggers on the SQL (push and pull request) and runs the harness', count(WF, /docs\/report-private-context-sequence-lockdown\.sql/g));
// Anchored on the entry's own bullet marker: the title is also quoted in the file's "Last updated" line, and an anchor on the bare
// title would slice from there and judge the wrong text.
const ENTRY_AT = STATUS.indexOf('- **Open event counter found in production');
const ENTRY = ENTRY_AT >= 0 ? STATUS.slice(ENTRY_AT, ENTRY_AT + 5200) : '';
// The entry was written while the fix was parked ("NOT applied") and was then applied to production on 2026-10-02 (db-sql run
// 37020139550). The pin follows the truth: the first lines say APPLIED, the run that did it is named, the present-tense "parked and
// NOT applied" sentence is gone (the finding's own before-state keeps the past tense), and the four other counters stay named.
ok(ENTRY.length > 3000 && /report-private-context-sequence-lockdown\.sql/.test(ENTRY) && OTHERS.every((t) => ENTRY.includes(t))
    && /APPLIED to production 2026-10-02/.test(ENTRY.slice(0, 400)) && /37020139550/.test(ENTRY) && !/is parked and NOT applied/.test(ENTRY),
  '7b: the status file records the finding, names the four other counters for their owners, says in its first lines that this fix was APPLIED and by which run, and no longer says it is parked', ENTRY.length);

console.log(`\n${n - bad}/${n} pass`);
process.exit(bad ? 1 : 0);
