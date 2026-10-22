// app_notice_superseded(): one Granicus session recorded as several clip_id videos is ONE notice on the ZIP page.
// Offline: pins the SQL OF RECORD (docs/app-refresh-zip-granicus-clip-sessions.sql).
//
// WHY. Measured 2026-10-22 (control: 4,150 granicus.com government notices): after the event/clip rule, 49 groups of
// clip_id notices shared community + title + published day + host + view_id; 69 extra rows on 133 page lines across
// 94 ZIP pages (Skagit: Planning Commission Oct 13, clips 5159 and 5160). Applied the same day; live function body
// md5 cc1712c84e2e4e3e43f0ff86ce0ebc19 equals this file's body (checked after apply).

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const raw = readFileSync(join(root, 'docs/app-refresh-zip-granicus-clip-sessions.sql'), 'utf8');
const exec = raw.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');
const body = (raw.match(/\$f\$([\s\S]*?)\$f\$/) || [])[1] || '';

const failures = [];
const ok = (name, cond) => { if (cond) console.log(`PASS — ${name}`); else { console.log(`FAIL — ${name}`); failures.push(name); } };

ok('body md5 is the applied one', createHash('md5').update(body).digest('hex') === 'cc1712c84e2e4e3e43f0ff86ce0ebc19');
ok('refuses unless the live helper is the event/clip version', exec.includes("'0f29d0876c2b92bc6d8cd275d7edee31'") && exec.includes("refusing"));
ok('re-checks the 3 app_refresh_zip call sites', /<>\s*3 then\s+raise exception 'app_refresh_zip no longer has exactly 3/.test(exec));
ok('does not replace app_refresh_zip itself', !/create or replace function public\.app_refresh_zip\s*\(/i.test(exec));

// the event/clip half is the previous body, unchanged
const pairs = readFileSync(join(root, 'docs/app-refresh-zip-granicus-pairs.sql'), 'utf8');
const prev = (pairs.match(/\$f\$([\s\S]*?)\$f\$/) || [])[1] || '';
const prevExists = prev.slice(prev.indexOf("and exists ("), prev.lastIndexOf("'government_notice')") + "'government_notice')".length);
ok('event/clip rule kept byte for byte', prevExists.length > 100 && body.includes(prevExists));

// narrowness of the new clip/clip rule
ok('only granicus.com clip_id links can be superseded by the new rule', body.includes("p_url ~ 'granicus\\.com' and p_url ~ '[?&]clip_id=\\d+'"));
ok('same community, title and published day', body.includes('b.community_id = a.community_id') && body.includes('b.title = a.title') && body.includes('b.published_at::date = a.published_at::date'));
ok('an undated notice is never collapsed', (body.match(/b\.published_at is not null and a\.published_at is not null/g) || []).length === 2);
ok('same host and path', body.includes("split_part(b.source_url, '?', 1) = split_part(a.source_url, '?', 1)"));
ok('same view_id', body.includes("substring(b.source_url from '[?&]view_id=(\\d+)') is not distinct from substring(a.source_url from '[?&]view_id=(\\d+)')"));
ok('keeps the LOWEST clip_id (a later clip is hidden, never the first)', body.includes("substring(b.source_url from '[?&]clip_id=(\\d+)')::bigint < substring(a.source_url from '[?&]clip_id=(\\d+)')::bigint"));
ok('no title-only dedupe', !/select distinct on|group by title/i.test(body));

// display only
ok('writes nothing to public.alerts', !/(insert into|update|delete from)\s+public\.alerts/i.test(exec));
ok('revokes from anon/authenticated, grants only postgres/service_role', exec.includes('from public, anon, authenticated;') && exec.includes('to postgres, service_role;'));
ok('post-condition refuses a left-over group and a zero control', exec.includes('clip_id groups still show more than one notice') && exec.includes('control: 0 granicus notices'));

if (failures.length) { console.log(`\n${failures.length} FAILED`); process.exit(1); }
console.log('\nall checks passed');
