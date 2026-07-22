// Local News materialization — regression guards.
// The fix routes Local News through the SAME production pipeline (app_refresh_zip ->
// app_changes) as Government Notices and Upcoming Meetings, surfaces it in the Local
// News tab via HS.data.news(), and keeps it OUT of every other app_changes consumer so
// no customer-visible behavior changes outside Local News. These are static-source
// guards (CI has no DB), mirroring test/alerts-filter.test.mjs.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const data = readFileSync(join(root, 'lib/data.js'), 'utf8');
const alerts = readFileSync(join(root, 'alerts.html'), 'utf8');
const migration = readFileSync(join(root, 'docs/app-refresh-zip-local-news-migration.sql'), 'utf8');
const ddlPointer = readFileSync(join(root, 'docs/app-content-materialize.sql'), 'utf8');

let fails = 0;
const ok = (cond, name) => {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
  if (!cond) fails++;
};

// ---- data layer: one table, two category-scoped reads (no second pipeline) ----
ok(/async\s+news\s*\(/.test(data), 'data.js exposes a news() reader');
ok(/\.eq\(\s*'category'\s*,\s*'Local News'\s*\)/.test(data),
  "news() reads app_changes rows tagged category='Local News'");
ok(/c\.category\s*!==\s*'Local News'/.test(data),
  "changes() excludes 'Local News' so notices/meetings and every changes() consumer are unchanged");

// ---- alerts.html: the Local News tab is fed by the materialized news read ----
ok(/HS\.data\.news\s*\(/.test(alerts), 'alerts.html loads Local News via HS.data.news()');
ok(/news:\s*news\b/.test(alerts), "alerts.html news pool = the news() result (not derived from changes())");
ok(!/news:\s*all\.filter\(isNewsItem\)/.test(alerts),
  'alerts.html no longer derives the news pool from the general changes() feed');
// still cover gov + meetings; isNewsItem retained to guard isGovNotice
ok(/gov:\s*all\.filter\(isGovNotice\)/.test(alerts) && /meetings:\s*buildMeetingsPool\(\)/.test(alerts),
  'alerts.html preserves the gov + meetings pools unchanged');

// ---- category routing invariant: 'Local News' lands in the news tab, nowhere else ----
// These regexes are the exact predicates alerts.html classifies with; assert they still exist.
ok(/newsTopics\.indexOf\(cat\)\s*!==\s*-1\s*\|\|\s*\/news\/i\.test\(cat\)/.test(alerts),
  'alerts.html isNewsItem keys on /news/i');
ok(/\/planning\|government\|civic\/i\.test/.test(alerts),
  'alerts.html isGovNotice keys on /planning|government|civic/i');
ok(/news/i.test('Local News'), "'Local News' routes to the news tab (matches /news/i)");
ok(!/planning|government|civic/i.test('Local News'), "'Local News' is NOT a government-notice category");
ok(!/^Public meeting/.test('Local News'), "'Local News' is NOT a meeting mirror");

// ---- materializer: one additive statement, canonical pipeline, sourced + deduped ----
ok(/create or replace function public\.app_refresh_zip/i.test(migration),
  'migration replaces app_refresh_zip (extends the existing materializer)');
ok(/insert into public\.app_changes[\s\S]*'Local News'/.test(migration),
  "migration materializes local news into app_changes as category 'Local News'");
ok(/pipeline_type\s*=\s*'news'/.test(migration) && /a\.category\s*=\s*'local_news'/.test(migration),
  "migration reads the canonical alerts source (pipeline_type='news', category='local_news')");
ok(/coalesce\(a\.source_url,''\)<>''/.test(migration),
  'migration requires a source_url (anti-fabrication)');
ok(/not exists \(select 1 from public\.app_changes ac where ac\.zip=_zip and ac\.source_ref = a\.source_url\)/.test(migration),
  'migration dedupes local news by source_ref against rows the same run wrote');
ok(/a\.community_id = coalesce\(_root,_cid\)/.test(migration),
  'migration anchors news at the chain root (same anchor as notices/meetings)');

// ---- gate safety: news is materialized AFTER the meta upsert so it never feeds the gates ----
const iNcCount = migration.indexOf('count(*) into _nc');
const iMetaUpsert = migration.indexOf('on conflict (zip) do update');
const iNewsInsert = migration.search(/insert into public\.app_changes[^;]*'Local News'/);
ok(iNcCount > -1 && iMetaUpsert > -1 && iNewsInsert > -1, 'migration has the _nc count, meta upsert, and news insert');
ok(iNcCount < iMetaUpsert && iMetaUpsert < iNewsInsert,
  'news insert is placed AFTER the meta upsert -> data_quality/indexable gates unchanged');

// ---- DDL-of-record pointer updated ----
ok(/app_refresh_zip_local_news/.test(ddlPointer),
  'app-content-materialize.sql records the app_refresh_zip_local_news update');

process.exit(fails ? 1 : 0);
