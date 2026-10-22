// app_refresh_zip(): one row per official record on a ZIP page, and a meeting summary that does not repeat its place.
// Offline: pins the SQL OF RECORD (docs/app-refresh-zip-one-row-per-record.sql), a splice run against the live body.
//
// WHY. The cached civic copy and the meeting mirror did not check each other, so one council meeting appeared twice on
// a page (7,189 repeated rows on 2,597 ZIP pages, 2026-10-22; Pierce County WA: 239 of 957 government rows). And the
// meeting summary was <place> <meeting_type>, which doubled "Pierce County Pierce County Council".
//
// The behavioural proof is not here (CI has no database): it is the live re-measurement recorded in the PR.
// What this file makes impossible is the fix drifting silently.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const raw = readFileSync(join(root, 'docs/app-refresh-zip-one-row-per-record.sql'), 'utf8');
const exec = raw.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');

const failures = [];
const ok = (name, cond) => { if (cond) console.log(`PASS — ${name}`); else { console.log(`FAIL — ${name}`); failures.push(name); } };
const count = (h, n) => h.split(n).length - 1;

// 1. spliced from the live body, never retyped (claims rule 7)
ok('splices pg_get_functiondef of the live function', exec.includes("pg_get_functiondef('public.app_refresh_zip(text)'::regprocedure)"));
ok('does not carry its own copy of the function', !/create or replace function public\.app_refresh_zip\s*\(/i.test(exec));

// 2. fails closed: per-needle count + per-replace post-condition + whole-body post-conditions
ok('refuses on a needle count mismatch', exec.includes("raise exception 'splice % refused: needle found % time(s), expected %'"));
ok('checks each replace took', exec.includes("raise exception 'splice % did not take'"));
ok('asserts exactly 1 label call site', exec.includes("raise exception 'expected exactly 1 app_meeting_label call site'"));
ok('asserts the old summary is gone', exec.includes("raise exception 'the old meeting summary survived'"));
ok('asserts exactly 1 per-record delete', exec.includes("raise exception 'expected exactly 1 per-record delete'"));
ok('asserts the delete runs before the notice count', exec.includes("raise exception 'the per-record delete must run before the notice count'"));
ok('is idempotent-refusing', exec.includes("raise exception 'app_refresh_zip already carries app_meeting_label"));

// 3. rollback exists and is taken BEFORE the replace
const arch = exec.indexOf('app_refresh_zip_def_archive');
const execAt = exec.lastIndexOf('execute d;');
ok('archives the pre-change body before executing', arch > 0 && execAt > arch);
ok('archive tag is named', exec.includes("'pre-one-row-per-record-20261022'"));

// 4. the label rule: the type alone only when it already starts with the place, at a word boundary
ok('label keeps "<place> meeting" for an empty type', exec.includes("coalesce(p_place, '') || ' meeting'"));
ok('label compares the start of the type case-insensitively', exec.includes('lower(left(p_type, length(p_place))) = lower(p_place)'));
ok('label requires a word boundary after the place', exec.includes("substr(p_type, length(p_place) + 1, 1) !~ '[[:alnum:]]'"));
ok('label otherwise keeps place + type', exec.includes("p_place || ' ' || p_type"));
ok('label is not open to the public key', exec.includes('revoke all on function public.app_meeting_label(text, text) from public, anon, authenticated;'));

// 5. the per-record delete: scope, ranking, determinism
ok('delete is scoped to this ZIP', /delete from public\.app_changes x[\s\S]*?where zip=_zip and category <> 'Local News'/.test(exec));
ok('Local News is never touched', exec.includes("category <> 'Local News'"));
ok('rows without a source are never touched', exec.includes("coalesce(source_ref,'')<>'') dup"));
ok('one row per source_ref', exec.includes('partition by source_ref'));
ok('the meeting wins, then a High notice', /order by \(title like 'Public meeting — %'\) desc, \(confidence = 'High'\) desc/.test(exec));
ok('ties are broken by content, never the random row id', exec.includes("md5(coalesce(title,'')||'|'||coalesce(plain_language,''))") && !/partition by source_ref[\s\S]*?order by[^;]*\bid\b\s*(asc|desc)?\)/.test(exec));
ok('keeps exactly the first row', exec.includes('dup.rn > 1'));

// 6. nothing else moves
ok('does not rename a category', count(exec, "'Planning & zoning'") === 0 && count(exec, "'Government & civic'") === 0);
ok('does not edit the 14-day rule', !exec.includes("interval '14 days'"));
ok('does not change a limit', !/\blimit \d+/.test(exec.replace(/limit 1\b/g, '')));

if (failures.length) { console.log(`\n${failures.length} FAILED`); process.exit(1); }
console.log('\nall checks passed');
