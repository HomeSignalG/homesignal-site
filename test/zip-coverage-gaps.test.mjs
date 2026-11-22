// TAB 2 · COVERAGE GAPS AND UNCONFIRMED FINDINGS (2026-11-22). Run: node test/zip-coverage-gaps.test.mjs
// Counts are the reader's real output on 2026-11-22 (12,746 ZIPs: 4,083 with no active feed, 142 whose feeds all failed their latest read).
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const rd = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
let n = 0, bad = 0;
const ok = (c, m) => { n++; if (c) console.log('PASS — ' + m); else { bad++; console.log('FAIL — ' + m); } };
const ctx = { console, Date }; ctx.globalThis = ctx; vm.createContext(ctx);
vm.runInContext(rd('../lib/acq-zip-feed-health.js'), ctx);
const H = ctx.HS.acqZipFeedHealth;
const NOW = Date.parse('2026-11-22T14:00:00Z');
const roll = { zips: { registry_zips: 12746, with_report: 12746, refreshed_24h: 12746, refreshed_24_72h: 0, refreshed_72h_7d: 0, refreshed_older_7d: 0, epa_layer_unavailable: 0, epa_clock_older_7d: 0, no_map_area_by_design: 706, map_area_measured: 12040, stalest: [] }, sources_48h: [], publishing: {}, alarms: { total: 0, failing: 0, failing_checks: [] }, source_registry: { registered_sources: 0, with_schedule: 0 }, heartbeats: [], not_computed: [] };
const gaps = () => ({ registry_zips: 12746, mapped_zips: 8663,
  unmapped_zips: { count: 4083, meaning: 'Canonical ZIP pages that no active feed reaches. This is a coverage gap. It is not a failed ingestion, and it does not show that no suitable feed exists.', owner: 'ingestion (sources) with the site (community mapping)' },
  all_failing_zips: { count: 142, meaning: 'Mapped ZIPs whose every active feed latest read failed.', owner: 'ingestion' },
  official_record: { status: 'NOT_MEASURED', meaning: 'Whether JODY holds every official record for a ZIP has not been measured.', last_comparison: null, owner: 'site (Tab 2)' },
  evidence: { computed_at: '2026-11-22T13:50:00Z', latest_outcome_at: '2026-11-22T13:44:00Z', latest_outcome_run_id: '45021217123' } });
const mon = (findings) => ({ last_run: { run_at: '2026-11-22T13:55:00Z', ok: true }, last_ok_run_at: '2026-11-22T13:55:00Z', runs_24h: 24, failed_runs_24h: 0, cron: [], findings, as_of: '2026-11-22T14:00:00Z' });
const unc = (days) => ({ finding_key: 'SOURCE_READ_FAILURE:old-' + days, class: 'SOURCE_READ_FAILURE', subject: 'old-source-' + days, severity: 'warn', first_seen: '2026-10-01T00:00:00Z', last_seen: '2026-11-22T13:55:00Z',
  resolved_at: new Date(NOW - days * 86400000).toISOString(), resolution_basis: 'AGED_OUT_UNCONFIRMED', resolution_evidence: { proof: 'the failure left the 48-hour window; no later successful read has been observed for every failing ZIP' }, detail: { what: 'x', zip_count: 7 } });

const h = H.render({ rollup: roll, as_of: '2026-11-22T14:00:00Z' }, NOW, mon([]), null, null, gaps());
ok(/4,083/.test(h) && /ZIPs with no active feed mapped/.test(h), 'unmapped ZIPs have their own count');
ok(/142/.test(h) && /feeds all failed their latest read/.test(h), 'all-failing mapped ZIPs have their own count');
ok(/Not measured/.test(h) && /Official-record completeness/.test(h), 'official-record coverage is shown as not measured, not as a count');
ok(/It is not a failed ingestion/.test(h) && /does not show that no suitable feed exists/.test(h), 'the unmapped gap is not presented as a failure or as proof no feed exists');
ok(/data-kind="unmapped"/.test(h) && /data-kind="all_failing"/.test(h), 'each countable gap has a drill-down');
ok(/Computed 2026-11-22T13:50:00Z/.test(h) && /45021217123/.test(h), 'the evidence timestamp and the feed-read run id are printed');
// unconfirmed findings never expire
for (const d of [1, 8, 30, 90]) {
  const x = H.render({ rollup: roll, as_of: 'x' }, NOW, mon([unc(d)]), null, null, undefined);
  ok(/Aged out, recovery not confirmed \(1\)/.test(x) && /old-source-/.test(x), 'an unconfirmed finding is listed ' + d + ' days after it left the set');
  ok(!/Recovered with evidence in the last 7 days \(1\)/.test(x), 'and is never counted as a recovery (' + d + ' days)');
}
const miss = H.render({ rollup: roll, as_of: 'x' }, NOW, mon([]), null, null, null);
ok(/Coverage gaps unavailable/.test(miss), 'an unreadable gap reader is shown as unverified');
ok(!/Coverage gaps/.test(H.render({ rollup: roll, as_of: 'x' }, NOW, mon([]))), 'older callers that pass no gaps argument are unchanged');
// SQL: the listing window keeps unconfirmed findings, and the gap kinds are closed
const sql = rd('../docs/zip-coverage-gaps.sql');
ok(/resolution_basis = 'AGED_OUT_UNCONFIRMED'\) f/.test(sql) && /interval '7 days' or resolution_basis/.test(sql), 'monitor SQL lists unconfirmed findings regardless of age');
ok(/p_kind not in \('unmapped', 'all_failing'\)/.test(sql), 'gap page accepts only the two defined kinds');
ok(/health_state = 'READ_FAILED'/.test(sql) && !/STALE_EVIDENCE/.test(sql.replace(/--.*$/gm, '')), 'only a failed latest read counts as failing; stale or never-checked feeds do not');
console.log(`\n${n - bad}/${n} passed`); process.exit(bad ? 1 : 0);
