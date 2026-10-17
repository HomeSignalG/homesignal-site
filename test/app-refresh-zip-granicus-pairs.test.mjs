// app_refresh_zip(): a Granicus meeting posted as event_id and again as clip_id is ONE notice on the ZIP page.
// Offline: pins the SQL OF RECORD (docs/app-refresh-zip-granicus-pairs.sql), a splice run against the live body.
//
// WHY. Measured 2026-10-17 (control: 18,143 government notices): 312 stored granicus.com event_id notices have a
// clip_id notice with the same community, title and published day; 29 communities, 1,522 app_changes rows, 510 ZIP pages.
// The behavioural proof is the live re-measurement in the PR (Skagit: 0 event_id rows left, 12 clip_id rows).

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const raw = readFileSync(join(root, 'docs/app-refresh-zip-granicus-pairs.sql'), 'utf8');
const exec = raw.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');

const failures = [];
const ok = (name, cond) => { if (cond) console.log(`PASS — ${name}`); else { console.log(`FAIL — ${name}`); failures.push(name); } };

ok('splices the live body', exec.includes("pg_get_functiondef('public.app_refresh_zip(text)'::regprocedure)"));
ok('does not carry its own copy of app_refresh_zip', !/create or replace function public\.app_refresh_zip\s*\(/i.test(exec));
ok('refuses on a needle count mismatch', exec.includes("raise exception 'splice % refused: needle found % time(s), expected %'"));
ok('asserts exactly 3 call sites', /<>\s*3 then\s+raise exception 'expected exactly 3 app_notice_superseded/.test(exec));
ok('requires the notice-dates change first', exec.includes('app-refresh-zip-notice-dates.sql must be applied first'));
ok('archives the pre-change body before executing', exec.indexOf('app_refresh_zip_def_archive') > 0 && exec.lastIndexOf('execute d;') > exec.indexOf('app_refresh_zip_def_archive'));

// narrowness: only the Granicus event/clip shape, same community + title + published day
ok('only granicus.com event_id links can be superseded', /p_url ~ 'granicus\\\.com' and p_url like '%event_id=%'/.test(exec));
ok('the twin must be a granicus.com clip_id link', /b\.source_url ~ 'granicus\\\.com' and b\.source_url like '%clip_id=%'/.test(exec));
ok('same community, same title, same published day', exec.includes('b.community_id = a.community_id') && exec.includes('b.title = a.title') && exec.includes('b.published_at::date = a.published_at::date'));
ok('an undated notice is never collapsed', exec.includes('b.published_at is not null and a.published_at is not null'));
ok('a plain title match is not enough (no title-only dedupe)', !/select distinct on|group by title/i.test(exec));

// nothing is deleted or edited in alerts
ok('writes nothing to public.alerts', !/(insert into|update|delete from)\s+public\.alerts/i.test(exec));
ok('revokes from anon/authenticated, grants only postgres/service_role', exec.includes('from public, anon, authenticated;') && exec.includes('to postgres, service_role;'));

if (failures.length) { console.log(`\n${failures.length} FAILED`); process.exit(1); }
console.log('\nall checks passed');
