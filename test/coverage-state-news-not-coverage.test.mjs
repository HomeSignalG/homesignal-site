// Offline pin for the 2026-08-02 coverage-state correction — no network, no DB.
//
// THE DEFECT: `app_changes` started as a civic table ('Government & civic',
// 'Planning & zoning') — exactly the set app_refresh_zip counts into `_nc` when it
// stamps app_community_meta.data_quality. The app_coverage_states view counted that
// table with NO category filter, so when Local News later began materializing into the
// same table (79,424 rows across 9,796 ZIPs) the view silently started reading news as
// coverage. Measured cost: 5,734 ZIPs reported one state better than their data
// supports — 5,072 whose only map content is the national EPA floor (real state
// facilities_only, and so denied the accurate "feeds still being wired" banner) and 662
// with no markers and no civic notices at all (real state honestly_empty).
//
// The materializer never drifted — it counts `_nc` BEFORE the Local News insert — which
// is why exactly one assertion failed: `legacy: populated/facilities_only => pass`.
//
// THE RULE: coverage means SOURCED CIVIC/DEVELOPMENT RECORDS. A Local News article is
// real, sourced content, still rides the page's news list, and can NEVER lift a ZIP's
// coverage state on its own. This suite pins both halves — the classifier's behavior and
// the SQL of record — so a future category added to app_changes cannot widen coverage
// again by accident.
// Run: node scripts/run-unit-tests.mjs   (or: node test/coverage-state-news-not-coverage.test.mjs)
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log(`PASS ${name}`); }
  else { fail++; console.log(`FAIL ${name}${detail ? '\n     ' + detail : ''}`); }
};

// ── 1. The classification rule, as a pure function of the view's own columns.
// Mirrors the CASE in docs/coverage-state-model.sql (content branches only — the
// freshness branches above them are unchanged by this correction).
function classify({ dev_markers = 0, fac_markers = 0, changes = 0 }) {
  if (dev_markers > 0 || changes > 0) return 'populated';
  if (fac_markers > 0) return 'facilities_only';
  return 'honestly_empty';
}

// `changes` is CIVIC-only. news_items rides alongside and is never an input.
const civic = (rows) => rows.filter((r) => r.category !== 'Local News').length;
const news = (rows) => rows.filter((r) => r.category === 'Local News').length;

const NEWS_ONLY = [{ category: 'Local News' }, { category: 'Local News' }];
const CIVIC_ONE = [{ category: 'Government & civic' }];
const PLANNING = [{ category: 'Planning & zoning' }];

// 1a. The 662-ZIP class: news and nothing else => honestly_empty, NOT populated.
ok('news-only ZIP is honestly_empty',
  classify({ dev_markers: 0, fac_markers: 0, changes: civic(NEWS_ONLY) }) === 'honestly_empty');
ok('news-only ZIP reports its news additively (not hidden by the narrower count)',
  news(NEWS_ONLY) === 2 && civic(NEWS_ONLY) === 0);

// 1b. The 5,072-ZIP class: EPA facility floor + news => facilities_only, NOT populated.
// This is the state that renders the accurate "meeting and permit feeds … still being
// wired" banner on community.html, which those pages were being denied.
ok('facility floor + news is facilities_only',
  classify({ dev_markers: 0, fac_markers: 40, changes: civic(NEWS_ONLY) }) === 'facilities_only');

// 1c. Real coverage still classifies as populated — from either civic category or from
// development markers. The correction narrows what counts, it does not shrink coverage.
ok('a government notice is coverage',
  classify({ dev_markers: 0, fac_markers: 0, changes: civic(CIVIC_ONE) }) === 'populated');
ok('a planning notice is coverage',
  classify({ dev_markers: 0, fac_markers: 0, changes: civic(PLANNING) }) === 'populated');
ok('development markers are coverage regardless of changes',
  classify({ dev_markers: 7, fac_markers: 0, changes: 0 }) === 'populated');
ok('civic + news together are still populated (news neither adds nor subtracts)',
  classify({ dev_markers: 0, fac_markers: 0, changes: civic([...CIVIC_ONE, ...NEWS_ONLY]) }) === 'populated');

// 1d. SELF-TEST — prove these assertions can FAIL. The pre-fix rule counted the whole
// table; feed the classifier that input and require the WRONG verdict, so a green run
// here means the narrowing is actually doing something (CLAUDE.md: "an instrument must
// prove it ran before its silence counts as evidence").
const preFixChanges = (rows) => rows.length;          // the defect: no category filter
ok('1d.self-test: the pre-fix rule DID overstate news-only as populated',
  classify({ dev_markers: 0, fac_markers: 0, changes: preFixChanges(NEWS_ONLY) }) === 'populated');
ok('1d.self-test: the pre-fix rule DID overstate the facility floor as populated',
  classify({ dev_markers: 0, fac_markers: 40, changes: preFixChanges(NEWS_ONLY) }) === 'populated');

// ── 2. The SQL of record must carry the narrowed count and the additive column.
// docs/*.sql is the DDL of record for this project (CLAUDE.md §1 source #3), so a
// production migration that is not reflected there is drift.
const sql = readFileSync(new URL('../docs/coverage-state-model.sql', import.meta.url), 'utf8');
ok('SQL of record filters Local News out of `changes`',
  /count\(\*\)\s*filter\s*\(where a\.category\s*<>\s*'Local News'\)\s*changes/.test(sql),
  'the view still counts app_changes with no category filter');
ok('SQL of record reports news_items additively',
  /count\(\*\)\s*filter\s*\(where a\.category\s*=\s*'Local News'\)\s*news_items/.test(sql)
  && /news_items\b/.test(sql.split('from public.app_community_meta')[0]),
  'news_items is not selected — the news would be hidden rather than reported');
ok('SQL of record explains the correction (so the next session does not re-derive it)',
  /CORRECTION 2026-08-02/.test(sql) && /content, not coverage|not coverage/i.test(sql));

// ── 3. The live verifier must assert the rule, not merely report it.
const ver = readFileSync(new URL('../scripts/verify-coverage-state.mjs', import.meta.url), 'utf8');
ok('verify-coverage-state reads news_items from the view',
  /select=[^'"`]*\bnews_items\b/.test(ver));
ok('verify-coverage-state fails on a news-only ZIP that is not honestly_empty',
  /ok\('news is not coverage[\s\S]{0,400}?coverage_state === 'honestly_empty'/.test(ver));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
