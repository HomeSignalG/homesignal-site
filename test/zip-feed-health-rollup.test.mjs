// TAB 2 · ALL ZIP PAGES AND FEEDS ROLL-UP (2026-11-20). Run: node test/zip-feed-health-rollup.test.mjs
// The roll-up below is the reader's real output on 2026-11-20 (trimmed). Each class is checked on it, then flipped to prove it is load-bearing.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const rd = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
let n = 0, bad = 0;
const ok = (c, m) => { n++; if (c) console.log('PASS — ' + m); else { bad++; console.log('FAIL — ' + m); } };

const ctx = { console, Date }; ctx.globalThis = ctx; vm.createContext(ctx);
vm.runInContext(rd('../lib/acq-zip-feed-health.js'), ctx);
const HS = ctx.HS, H = HS.acqZipFeedHealth;
const NOW = Date.parse('2026-11-20T17:30:00Z');

const real = () => ({
  zips: { registry_zips: 12746, with_report: 12746, refreshed_24h: 5759, refreshed_24_72h: 6955, refreshed_72h_7d: 14, refreshed_older_7d: 18, epa_layer_unavailable: 5818, epa_clock_older_7d: 3585,
    no_map_area_by_design: 706, map_area_measured: 12040, serving_generation: 'n5-national-2026-11-20 · 2026-11-20 10:04:28+00',
    stalest: [{ zip: '99999', refreshed_at: '2026-10-01T00:00:00Z', epa_unavailable: true, subscriber_zip: false }, { zip: '85083', refreshed_at: '2026-11-19T19:56:00Z', epa_unavailable: true, subscriber_zip: true }] },
  sources_48h: [{ registry_id: 'fdot-active-construction-projects', kind: 'fetch_failed', events: 411, zips: 411, last_seen: '2026-11-20T10:00:00Z', sample_reason: 'timeout', subscriber_zips: 0 },
    { registry_id: 'old-source', kind: 'retired', events: 3, zips: 3, last_seen: '2026-11-20T10:00:00Z', sample_reason: 'retired', subscriber_zips: 0 }],
  publishing: { maps_posts_by_status: { draft: 175 }, drafts_waiting_over_3d: 163, approved_not_published: 7, newest_published: '2026-11-20T16:30:43Z' },
  alarms: { total: 20, failing: 4, failing_checks: [{ check: 'x_check', detail: '<b>bad</b>', since: '2026-11-19', alertable: true }] },
  source_registry: { registered_sources: 6, with_schedule: 0 }, heartbeats: [],
  not_computed: ['per-ZIP records missing from Map 1 for non-subscriber ZIPs', 'per-source expected schedules', 'comparison with official city systems'],
});
const st = (r, k) => HS.zipFeedHealthStates(r).find((s) => s.key === k);

// 1 · each class is its own state, with the real numbers
ok(st(real(), 'STALE_REPORTS').count === 32 && st(real(), 'STALE_REPORTS').tone === 'bad', 'stale reports = 14 + 18, bad');
ok(st(real(), 'EPA_LAYER_FAILURES').count === 5818 && st(real(), 'EPA_LAYER_FAILURES').tone === 'warn', 'EPA layer failures counted apart from stale reports');
ok(st(real(), 'SOURCE_FAILURES').count === 1, 'a retired source is NOT counted as a failed read');
ok(/fdot-active-construction-projects \(411 ZIPs\)/.test(st(real(), 'SOURCE_FAILURES').detail), 'the largest failing source is named with its ZIP count');
ok(st(real(), 'MAP_PLACEMENT').tone === 'info' && /706 have none by design/.test(st(real(), 'MAP_PLACEMENT').detail), 'ZIPs with no map area are shown as by design, not as failures');
ok(st(real(), 'PUBLISHING').count === 163 + 7 + 4, 'publishing counts waiting drafts, unpublished approvals and failing monitor checks');
ok(st(real(), 'UNVERIFIED_COVERAGE').tone === 'unverified' && /0 of 6 registered sources/.test(st(real(), 'UNVERIFIED_COVERAGE').detail), 'unverified coverage is its own state and names the missing schedules');
ok(/never verified/.test(st(real(), 'UNVERIFIED_COVERAGE').detail), 'no new activity is distinguished from coverage never verified');
// 2 · flipping each input moves only its own state
const clean = real(); clean.zips.refreshed_72h_7d = 0; clean.zips.refreshed_older_7d = 0;
ok(st(clean, 'STALE_REPORTS').tone === 'ok' && st(clean, 'EPA_LAYER_FAILURES').count === 5818, 'clearing stale reports does not touch the EPA state');
const noSrc = real(); noSrc.sources_48h = [];
ok(st(noSrc, 'SOURCE_FAILURES').tone === 'ok' && st(noSrc, 'STALE_REPORTS').tone === 'bad', 'no source failures does not clear stale reports');
const missing = real(); missing.zips.with_report = 12700;
ok(st(missing, 'ZIP_PAGES_WITHOUT_REPORT').count === 46 && st(missing, 'ZIP_PAGES_WITHOUT_REPORT').tone === 'bad', 'ZIP pages with no report are counted');
const unk = real(); unk.source_registry.with_schedule = 6; unk.not_computed = [];
ok(st(unk, 'UNVERIFIED_COVERAGE').count === 0, 'the state clears only when schedules AND every not-computed item are gone');
const nc = real(); nc.source_registry.with_schedule = 6;
ok(st(nc, 'UNVERIFIED_COVERAGE').count === 3 && st(nc, 'UNVERIFIED_COVERAGE').tone === 'unverified', 'recording schedules does NOT clear unverified coverage');

// 3 · rendering
const html = H.render({ rollup: real(), as_of: '2026-11-20T17:30:00Z' }, NOW);
ok(/All ZIP pages and feeds/.test(html) && /Separate from Subscriber ZIP Health/.test(html), 'the section says it is separate from subscriber monitoring');
ok(/\(subscriber ZIP\)/.test(html), 'subscriber ZIPs are flagged inside the all-ZIP lists');
ok(!/<b>bad<\/b>/.test(html) && /&lt;b&gt;bad/.test(html), 'monitor detail text is escaped');
ok(/No roll-up was returned/.test(H.render({}, NOW)), 'an empty answer is shown as unverified, not as fine');
ok(!/healthy/i.test(html), 'the word "healthy" is never printed');

// 4 · wiring and SQL shape
const page = rd('../acquisition.html'), sql = rd('../docs/zip-feed-health-rollup.sql'), lib = rd('../lib/acq-zip-feed-health.js');
ok(/lib\/acq-zip-feed-health\.js\?v=[0-9a-f]{8}/.test(page), 'the page loads the module with a content key');
ok(/acqSubscriberZipHealth\.mount[^\n]*\n[^\n]*\n\s*if\(window\.HS && window\.HS\.acqZipFeedHealth\)[^\n]*mount\(window\.hsClient, \$\('tab-feed'\)\)/.test(page), 'it mounts right after the subscriber section');
ok(/hs_zip_feed_health/.test(lib) && !/\.from\(/.test(lib), 'the page reads one gated RPC and no table');
ok(/dashboard_admins/.test(sql) && /grant execute on function public\.hs_zip_feed_health\(\) to authenticated/.test(sql) && /revoke all on function public\.hs_zip_feed_health\(\) from public, anon/.test(sql), 'the reader is admin-gated and closed to anon');
ok(/revoke all on function public\._hs_zip_feed_health_core\(\) from public, anon, authenticated/.test(sql), 'the core function is not callable by any visitor role');
ok(!/\b(insert|update|delete)\b\s+(into\s+)?public\./i.test(sql.replace(/--[^\n]*/g, '')), 'the SQL writes nothing');
ok(/kind/.test(sql) && /'retired'|retired/.test(rd('../lib/acq-zip-feed-health.js')), 'failure kinds stay separate in the reader and the page');

console.log(`\n${n - bad}/${n} passed`);
process.exit(bad ? 1 : 0);
