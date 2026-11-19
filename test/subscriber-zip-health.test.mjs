// TAB 2 · SUBSCRIBER ZIP HEALTH (2026-11-19). Run: node test/subscriber-zip-health.test.mjs
// The facts below are the reader's real output for the two subscriber ZIPs on 2026-11-19 (trimmed), so the verdicts are
// checked against production shapes, then each rule is flipped to prove it is load-bearing.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const rd = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
let n = 0, bad = 0;
const ok = (c, m) => { n++; if (c) console.log('PASS — ' + m); else { bad++; console.log('FAIL — ' + m); } };

const ctx = { console, Date }; ctx.globalThis = ctx; vm.createContext(ctx);
vm.runInContext(rd('../lib/acq-subscriber-zip-health.js'), ctx);
const H = ctx.HS.acqSubscriberZipHealth, verdict = ctx.HS.subscriberZipVerdict;
const NOW = Date.parse('2026-11-19T18:00:00Z');

const src = (o) => Object.assign({ registry_id: 'phoenix-building-permits', records: 2048, newest_filed: '2026-11-17', last_seen: '2026-11-18T18:45:29Z',
  cadence: null, connection: null, failures_48h: 0, last_failed: null, failure_reason: null }, o);
const z85083 = () => ({ zip: '85083', subscribers: 1, report: { refreshed_at: '2026-11-18T13:14:00Z', facilities_unavailable: false },
  sources: [src({}), src({ registry_id: 'adot-tip-fy2026-2030', records: 1, newest_filed: null })], failures_without_records: [],
  recent_live_records: 631, drawn_on_map1: 4, drawn_on_other_zip: 627, not_in_serving_generation: 0,
  posts: { draft: { n: 1 }, skipped: { n: 2 }, published: { n: 1 } }, government: { feeds_active: 8, feeds_total: 9, newest_item: '2026-11-17T20:44:40Z' },
  email: { published_posts: 1, deliveries: 2, duplicate_deliveries: 0 } });
const z64166 = () => ({ zip: '64166', subscribers: 1, report: { refreshed_at: '2026-11-18T04:28:00Z', facilities_unavailable: true },
  sources: [src({ registry_id: 'kcmo-development-cases', records: 71, newest_filed: '2026-11-09' })], failures_without_records: [],
  recent_live_records: 10, drawn_on_map1: 2, drawn_on_other_zip: 8, not_in_serving_generation: 0, posts: { skipped: { n: 1 } },
  government: { feeds_active: 8, feeds_total: 9, newest_item: '2026-11-17T01:02:36Z' }, email: { published_posts: 0, deliveries: 0, duplicate_deliveries: 0 } });

// 1 · verdicts on the production shapes
ok(verdict(z85083(), NOW).key === 'UNVERIFIED', '85083: schedule not recorded in the source registry -> UNVERIFIED, never captured/healthy');
ok(verdict(z64166(), NOW).reasons.some((r) => /EPA facility layer unavailable/.test(r)), '64166: unavailable EPA layer is named as a reason');
// 2 · with every instrument present, activity is judged from the newest filed date
const full = (z) => { z.sources.forEach((s) => { s.cadence = 'daily'; }); z.report.facilities_unavailable = false; return z; };
ok(verdict(full(z85083()), NOW).key === 'ACTIVITY_CAPTURED', 'instrumented + filed within 30 days -> activity captured');
const quiet = full(z85083()); quiet.sources.forEach((s) => { s.newest_filed = '2026-09-01'; });
ok(verdict(quiet, NOW).key === 'NO_NEW_DEVELOPMENT_ACTIVITY', 'instrumented + nothing in 30 days -> no new activity (distinct from failure/missing)');
// 3 · the four failure-ish states stay distinct and outrank the quiet ones
const f = full(z85083()); f.sources[0].failures_48h = 2; f.sources[0].failure_reason = '57014';
ok(verdict(f, NOW).key === 'FAILED_INGESTION', 'a failed read in 48 h -> failed ingestion');
const st = full(z85083()); st.report.refreshed_at = '2026-11-15T00:00:00Z';
ok(verdict(st, NOW).key === 'FAILED_INGESTION', 'report older than 72 h -> failed ingestion');
const none = full(z85083()); none.sources = [];
ok(verdict(none, NOW).key === 'MISSING_SOURCE_COVERAGE', 'no source ever stored a record -> missing source coverage');
const miss = full(z85083()); miss.not_in_serving_generation = 3;
ok(verdict(miss, NOW).key === 'RECORDS_MISSING_FROM_MAP1', 'records in no Map 1 -> missing from Map 1');
const other = full(z85083());
ok(verdict(other, NOW).key !== 'RECORDS_MISSING_FROM_MAP1', 'records drawn on a NEIGHBOURING ZIP are not counted as missing');
const nofail = full(z85083()); nofail.failures_without_records = [{ registry_id: 'x', failures_48h: 1, reason: 'r' }];
ok(verdict(nofail, NOW).key === 'FAILED_INGESTION', 'a failing source that stored nothing still fails the ZIP');
const noRep = full(z85083()); noRep.report = null;
ok(verdict(noRep, NOW).key === 'UNVERIFIED', 'no cached report -> unverified');

// 4 · rendering
const html = H.renderZips({ zips: [z85083(), z64166()] }, NOW);
ok(/85083/.test(html) && /64166/.test(html) && /Unverified coverage/.test(html), 'both ZIPs render with their verdict');
ok(/expected schedule not recorded/.test(html), 'the missing schedule is shown, not hidden');
ok(/Not instrumented/.test(html), 'every card states that official-record reconciliation is not standing');
ok(/no published MAPS post for this ZIP/.test(html), 'email readiness says why nothing can go out (64166)');
ok(/2 delivery row\(s\), no duplicates/.test(html), 'email readiness reports deliveries and no duplicates (85083)');
const dup = z85083(); dup.email.duplicate_deliveries = 1;
ok(/duplicate delivery row/.test(H.renderZips({ zips: [dup] }, NOW)), 'a duplicate delivery is flagged');
ok(/unverified state, not an all-clear/.test(H.renderZips({ zips: [] }, NOW)), 'an empty answer is unverified, not an all-clear');
const xss = z85083(); xss.sources[0].registry_id = '<img src=x onerror=alert(1)>';
ok(!/<img src=x/.test(H.renderZips({ zips: [xss] }, NOW)), 'source names are escaped');
ok(!/healthy/i.test(html), 'the word "healthy" is never printed');

// 5 · wiring and SQL shape
const page = rd('../acquisition.html'), sql = rd('../docs/subscriber-zip-health.sql'), lib = rd('../lib/acq-subscriber-zip-health.js');
ok(/lib\/acq-subscriber-zip-health\.js\?v=[0-9a-f]{8}/.test(page), 'the page loads the module with a content key');
ok(/wireFeedInventory\(\);\s*\n\s*\/\/ Tab 2[^\n]*\n\s*if\(window\.HS && window\.HS\.acqSubscriberZipHealth\)[^\n]*mount\(window\.hsClient, \$\('tab-feed'\)\)/.test(page), 'it mounts on Tab 2 after the feed inventory, so it sits first');
ok(/hs_subscriber_zip_health/.test(lib) && !/\.from\(/.test(lib), 'the page reads one gated RPC and no table');
ok(/dashboard_admins/.test(sql) && /grant execute on function public\.hs_subscriber_zip_health\(\) to authenticated/.test(sql) && /revoke all on function public\.hs_subscriber_zip_health\(\) from public, anon/.test(sql), 'the reader is admin-gated and closed to anon');
ok(/revoke all on function public\._hs_subscriber_zip_health_core\(\) from public, anon, authenticated/.test(sql), 'the core function is not callable by any visitor role');
ok(!/\b(insert|update|delete)\b\s+(into\s+)?public\./i.test(sql.replace(/--[^\n]*/g, '')), 'the SQL writes nothing');
ok(/bsky_maps_priority_classification/.test(sql) && !/isEligible/.test(sql.replace(/--[^\n]*/g, '')), 'subscribers come from the ingest view; no eligibility rule is re-implemented');

console.log(`\n${n - bad}/${n} passed`);
process.exit(bad ? 1 : 0);
