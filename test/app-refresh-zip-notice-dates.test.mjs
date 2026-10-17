// app_refresh_zip(): a government notice is dated by ITS OWN published date, and the newest are chosen.
// Offline: pins the SQL OF RECORD (docs/app-refresh-zip-notice-dates.sql), a splice run against the live body.
//
// WHY. The cached-site shortcut inserts wrote current_date (or file_date else current_date) and picked their 6 rows by
// `order by md5(el::text)`; the alerts path then skipped the source_ref the shortcut had written. Measured 2026-10-17:
// 55,005 of 120,728 notice rows (46%) carried a date different from the notice's published_at, on 6,549 ZIP pages.
//
// The behavioural proof is not here (CI has no database): it is the live re-measurement recorded in the PR
// (Skagit County: 224 notice rows, 0 with a wrong date, 0 outside the window, newest first).
// What this file makes impossible is the fix drifting silently.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const raw = readFileSync(join(root, 'docs/app-refresh-zip-notice-dates.sql'), 'utf8');
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
ok('asserts exactly 4 app_notice_date call sites', /<>\s*4 then\s+raise exception 'expected exactly 4 app_notice_date/.test(exec));
ok('asserts exactly 2 app_notice_in_window call sites', /<>\s*2 then\s+raise exception 'expected exactly 2 app_notice_in_window/.test(exec));
ok('asserts no bare md5 ordering survives', exec.includes("raise exception 'a bare md5 ordering survived'"));
ok('is idempotent-refusing', exec.includes("raise exception 'app_refresh_zip already carries app_notice_date"));

// 3. rollback exists and is taken BEFORE the replace
const arch = exec.indexOf('app_refresh_zip_def_archive');
const execAt = exec.lastIndexOf('execute d;');
ok('archives the pre-change body before executing', arch > 0 && execAt > arch);

// 4. the date owner is alerts.published_at, with the alerts path's own fallback
ok('app_notice_date reads published_at then created_at', /published_at >= date '2000-01-01'[\s\S]*?a\.created_at::date/.test(exec));
ok('app_notice_date is scoped to the root community (unique index)', /a\.community_id = p_cid and a\.source_url = p_url/.test(exec));
ok('window is the founder 365 / 730 ruling', exec.includes('current_date - 365 and current_date + 730'));
ok('an undated notice is KEPT by the window', /a\.published_at is not null/.test(exec));

// 5. newest-first replaces the pseudo-random pick, both inserts
ok('both inserts order by the notice date, nulls last', exec.includes("'expect', 2") && exec.includes('desc nulls last, md5(el::text)'));

// 6. the helpers are not open to the public key
ok('revokes both helpers from anon/authenticated', count(exec, 'from public, anon, authenticated;') === 2);
ok('grants only postgres and service_role', count(exec, 'to postgres, service_role;') === 2);

// 7. nothing else moves: no category rename, no touch to the alerts path's 14-day rule
ok('does not rename a category', !/'Planning & zoning'|'Government & civic'/.test(exec));
ok('does not edit the alerts path', !exec.includes("interval '14 days'"));

if (failures.length) { console.log(`\n${failures.length} FAILED`); process.exit(1); }
console.log('\nall checks passed');
