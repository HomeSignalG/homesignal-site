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
ok(st(real(), 'PUBLISHING').count === 3, 'publishing counts open publishing issues, one unit, without adding drafts to checks');
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

// 5 · standing monitor (stored findings, recovery, monitor-of-the-monitor)
const mon = (o) => Object.assign({ last_run: { ok: true, error: null }, last_ok_run_at: '2026-11-20T17:00:00Z', runs_24h: 24, failed_runs_24h: 0,
  cron: [{ job: 'dev-source-freshness', schedule: '41 * * * *', max_age_minutes: 180, owner: 'ingestion', registered: true, last_ok: '2026-11-20T16:41:00Z' }, { job: 'gone', schedule: 'x', max_age_minutes: 10, owner: 'o', registered: false, last_ok: null }],
  findings: [{ finding_key: 'SOURCE_READ|fdot', class: 'SOURCE_READ_FAILURE', subject: 'fdot', severity: 'bad', first_seen: '2026-11-18T00:00:00Z', last_seen: '2026-11-20T17:00:00Z', resolved_at: null,
      detail: { what: 'Source read failed', evidence: 'HTTP 403', threshold: 'any failed read in 48 h', action: 'Check endpoint', owner: 'ingestion', zip_count: 419, zips: [{ zip: '33301', subscriber: true }, { zip: '33302' }] } },
    { finding_key: 'x', class: 'X', subject: 'old-source', severity: 'bad', first_seen: '2026-11-15T00:00:00Z', last_seen: '2026-11-19T00:00:00Z', resolved_at: '2026-11-19T01:00:00Z', detail: { what: 'w', evidence: '<i>e</i>', threshold: 't', action: 'a', owner: 'o', zip_count: 0, zips: [] } }] }, o);
ok(HS.zipFeedMonitorStatus(mon(), NOW).tone === 'ok', 'a recent good run reads as running');
ok(HS.zipFeedMonitorStatus(mon({ last_ok_run_at: '2026-11-20T10:00:00Z' }), NOW).tone === 'bad' && /STALE/.test(HS.zipFeedMonitorStatus(mon({ last_ok_run_at: '2026-11-20T10:00:00Z' }), NOW).text), 'a monitor with no good run in 2 h is shown as stale');
ok(/FAILED/.test(HS.zipFeedMonitorStatus(mon({ last_run: { ok: false, error: 'boom' } }), NOW).text), 'a failed monitor run is shown as failed');
ok(HS.zipFeedMonitorStatus(null, NOW).tone === 'bad' && /never recorded a run/.test(HS.zipFeedMonitorStatus({}, NOW).text), 'no run on record is shown as not monitored, never as fine');
const mh = H.render({ rollup: real(), as_of: '2026-11-20T17:30:00Z' }, NOW, mon());
ok(/ONGOING/.test(mh) && /RECOVERED/.test(mh), 'findings are shown as ongoing or recovered');
ok(/33301\*/.test(mh) && /subscriber ZIP/.test(mh) && /Affected ZIPs \(419, first 2 shown\)/.test(mh), 'a finding names its affected ZIPs, flags subscribers and says how many are shown');
ok(/First seen/.test(mh) && /Last checked/.test(mh) && /Threshold/.test(mh) && /Action/.test(mh) && /owner: ingestion/.test(mh), 'a finding states first seen, last checked, threshold, action and owner');
ok(/NOT REGISTERED/.test(mh), 'a monitoring job that is not registered is flagged');
ok(!/<i>e<\/i>/.test(mh) && /&lt;i&gt;e/.test(mh), 'finding evidence is escaped');
ok(/Monitoring history unavailable/.test(H.render({ rollup: real() }, NOW)), 'when the monitor cannot be read the page says history is unverified');
ok(/not running; see "Coverage not verified"/.test(mh), 'checks that do not run are stated as not running');
const msql = rd('../docs/zip-feed-health-monitor.sql');
ok(/cron\.schedule\('zip-feed-health-record'/.test(msql) && /revoke all on public\.zip_feed_health_runs/.test(msql) && /revoke all on function public\._hs_zip_feed_health_findings\(\) from public, anon, authenticated/.test(msql), 'the monitor is scheduled, its tables are closed and the finder is not callable by visitors');
ok(/COVERAGE_NOT_VERIFIED/.test(msql) && /dev_monitoring_coverage/.test(msql) && !/insert into public\.source_registry|update public\.source_registry/i.test(msql), 'unverified coverage is a recorded finding and source_registry is untouched');

// 5b · one unit per tile when the monitor is available
const fm = { findings: [{ class: 'SOURCE_READ_FAILURE', resolved_at: null }, { class: 'SOURCE_READ_FAILURE', resolved_at: null }, { class: 'SOURCE_READ_FAILURE', resolved_at: '2026-11-20T00:00:00Z' }, { class: 'MAPS_DRAFTS_WAITING', resolved_at: null }, { class: 'MONITOR_CHECK_FAILING', resolved_at: null }] };
ok(HS.zipFeedHealthStates(real(), fm).find((s) => s.key === 'SOURCE_FAILURES').count === 2, 'the failing-source tile counts every open source finding, not only the roll-up top rows, and not recovered ones');
ok(HS.zipFeedHealthStates(real(), fm).find((s) => s.key === 'PUBLISHING').count === 2, 'the publishing tile counts open publishing findings');
// 6 · full affected-ZIP access and all-ZIP accounting
const acc = { registry_zips: 12746, bucket_sum: 12746, every_zip_accounted_for: true, buckets: { COVERAGE_NOT_VERIFIED: 11492, SOURCE_READ_FAILING: 888, NO_CHANGE_EVIDENCE: 334, STALE_REPORT: 32 } };
const ah = H.render({ rollup: real(), as_of: 'x' }, NOW, mon(), acc);
ok(/Every ZIP is in exactly one bucket \(12,746 of 12,746\)/.test(ah) && /data-key="ACCOUNT\|NO_CHANGE_EVIDENCE"/.test(ah), 'every ZIP is accounted for and each bucket can list its ZIPs');
ok(/No bucket means "verified complete"/.test(ah), 'no bucket is labelled verified complete');
ok(/MISMATCH/.test(H.render({ rollup: real() }, NOW, mon(), Object.assign({}, acc, { every_zip_accounted_for: false, bucket_sum: 12700 }))), 'a ZIP missing from the accounting is shown as a mismatch');
ok(/ZIP accounting unavailable/.test(H.render({ rollup: real() }, NOW, mon(), null)), 'unreadable accounting is shown as unverified');
ok(/data-key="SOURCE_READ\|fdot"/.test(ah) && /Show all 419 affected ZIPs/.test(ah), 'a finding offers all of its ZIPs, not only the stored preview');
// paging: 250 ZIPs in 3 pages of 100
const calls = []; let pg = '';
const client = { rpc: (fn, a) => { calls.push(a.p_offset); const rows = []; for (let i = a.p_offset; i < Math.min(a.p_offset + a.p_limit, 250); i++) rows.push({ zip: String(10000 + i), subscriber: i === 3 }); return Promise.resolve({ data: { total: 250, rows } }); } };
const out = { insertAdjacentHTML: (_, h) => { pg += h; } }; const attrs = { 'data-key': 'SOURCE_READ|fdot', 'data-off': '0' };
const btn = { classList: { contains: (c) => c === 'zfh-all' }, disabled: false, nextSibling: out, style: {}, textContent: '', getAttribute: (k) => attrs[k], setAttribute: (k, v) => { attrs[k] = v; } };
await HS.zipFeedLoadZips(client, btn); await new Promise((r) => setTimeout(r, 0));
await HS.zipFeedLoadZips(client, btn); await new Promise((r) => setTimeout(r, 0));
await HS.zipFeedLoadZips(client, btn); await new Promise((r) => setTimeout(r, 0));
ok(calls.join(',') === '0,100,200' && /10249/.test(pg) && /10000/.test(pg) && btn.style.display === 'none' && /All 250 ZIPs shown/.test(pg), 'paging reaches every one of 250 ZIPs and then stops');
ok(/10003\*/.test(pg), 'subscriber ZIPs are flagged in the full list');
const dsql = rd('../docs/zip-feed-health-detail.sql');
ok(/limit 50/.test(rd('../docs/zip-feed-health-monitor.sql')) && /least\(greatest\(coalesce\(p_limit, 100\), 1\), 500\)/.test(dsql) && /dashboard_admins/.test(dsql) && /revoke all on function public\.hs_zip_feed_health_zips\(text, int, int\) from public, anon/.test(dsql), 'the full-list reader is admin-gated and paged; the stored 50 is only a preview');
ok(/last_tick_at > f\.seen_at/.test(dsql) && /anchor 1 appeared/.test(dsql), 'a later successful tick supersedes an earlier failure, spliced fail-closed');
ok(!/\b(insert|update|delete)\b\s+(into\s+)?public\./i.test(dsql.replace(/--[^\n]*/g, '')), 'the detail SQL writes nothing');

console.log(`\n${n - bad}/${n} passed`);
process.exit(bad ? 1 : 0);
