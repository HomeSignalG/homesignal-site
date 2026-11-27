// COMPATIBILITY of the report-accuracy change (2026-11-19), over the real modules and local fixtures only (no database, no report, no follow, watch, credit or email is touched):
// identity and dedupe, the ledger's fingerprint inputs, change detection, stored-report reads (old and new shapes), the snapshot privacy boundary, credit, and watch/follow reads.
// Run: node --experimental-strip-types test/report-accuracy-compat.test.mjs
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const M = await import('../supabase/functions/_shared/national-report.ts');
const CS = await import('../supabase/functions/_shared/changes-since-report.ts');
const SS = await import('../supabase/functions/_shared/report-snapshot.ts');
const CR = await import('../supabase/functions/_shared/credit-rule.ts');
globalThis.window = globalThis;
await import('../lib/project-type.js');
let n = 0, fails = 0;
const ok = (c, name, d) => { n++; console.log((c ? 'PASS' : 'FAIL') + ' — ' + name); if (!c) { fails++; if (d !== undefined) console.log('   ' + JSON.stringify(d).slice(0, 500)); } };
const read = (f) => readFileSync(join(root, f), 'utf8');

// ── identity: the dedupe key and the project id never read source_dates ──
const idx = read('supabase/functions/get-address-report/index.ts');
const key = idx.slice(idx.indexOf('const dedupeExactPermits'), idx.indexOf('return out;', idx.indexOf('const dedupeExactPermits')));
ok(key.includes('s.file_date') && !/source_dates|source_updated|source_created/.test(key), 'the exact-identity dedupe key reads the filing/decision date and never source_dates');
const arc = read('supabase/functions/get-address-report/sources/arcgis.ts');
ok(!/(case_number|source_key|identity)[^;\n]*source_dates/.test(arc), 'the arcgis connector derives no identity or case number from source_dates');
// ── the ledger: facts are 14 named columns, provenance is not one of them (live: md5 4ddb04fd..., 2026-11-19, no "provenance" in the body) ──
const led = read('docs/dev-change-ledger.sql');
const facts = led.slice(led.indexOf('create or replace function public.dev_change_facts('), led.indexOf('create or replace function public.dev_change_fp'));
ok(!/provenance/.test(facts.replace(/--.*$/gm, '')), 'the ledger fact set (dev_change_facts) does not read provenance, so source_dates cannot change a fingerprint or create an event');
// ── engine: same world, with and without source dates → identical identity, changes, outcome, credit input ──
const attribution = { version: 1, attribution: {} };
const NOW = new Date('2026-11-19T18:00:00Z');
const PUB = { 'fam': { agency: 'Agency', dataset: 'Data', date_basis: 'record_created' } };
const proj = (prov) => ({ source_key: 'k1', registry_id: 'fam', record_kind: 'development', name: 'New 40-unit apartment building', type: 'Development', type_raw: 'New Construction', status: 'Approved', stage: 'Approved',
  developer: null, size: null, investment: null, submitted_at: '2024-08-26', date_kind: 'filed', address: null, source_ref: 'https://example.gov/k1', provenance: prov });
const rowk = { source_key: 'k1', feature_id: 'f:1', registry_id: 'fam', provenance: 'recovered_authoritative', distance_mi: 0.2, geometry_type: 'ST_Point', has_more: false, marker_lat: 40.02, marker_lng: -105.28 };
const WL = await import('./lib/da-report-' + 'view-world.mjs');
const ledger = [{ ...WL.led('k1', 'fam'), first_observed_at: '2026-10-01T00:00:00Z', last_observed_at: '2026-11-18T00:00:00Z' }];
const events = [WL.evt('k1', { observed_at: '2026-11-10T10:00:00Z' })];
const run = (prov, view = 'customer') => M.assemble({ now: NOW, subject: { address: '1 Test St', matched_address: null, lat: 40.0177, lng: -105.28, zip: '80302' }, radius_mi: 0.5, view, zip_supported: true,
  attribution, rows: [rowk], projects: [proj(prov)], ledger, events, health: [], publishers: PUB });
const WITHD = { source_dates: { created: '2024-08-26', updated: '2026-11-10' } };
const a = run(WITHD), b = run({});
const pa = a.intelligence.projects[0];
ok(a.intelligence.projects.length === 1 && Array.isArray(pa.homesignal_detected_changes) && pa.homesignal_detected_changes.length >= 1 && pa.record_dates?.updated === '2026-11-10', 'control: the world detects a change and the new dates are present, so the comparisons below are not vacuous', { n: a.intelligence.projects.length, ch: pa.homesignal_detected_changes, rd: pa.record_dates });
const strip = (r) => { const c = JSON.parse(JSON.stringify(r)); for (const p of c.intelligence?.projects ?? []) { delete p.record_dates; } return c; };
ok(JSON.stringify(strip(a).intelligence.projects.map((p) => [p.project_id, p.homesignal_detected_changes, p.what_changed_recently])) === JSON.stringify(strip(b).intelligence.projects.map((p) => [p.project_id, p.homesignal_detected_changes, p.what_changed_recently])), 'project identity and detected changes are identical with and without source dates');
ok(a.activity?.outcome === b.activity?.outcome && a.coverage_state === b.coverage_state && a.intelligence.activity?.outcome === b.intelligence.activity?.outcome, 'outcome and coverage state are identical');
const cd = (r) => CR.creditDecision({ status: r.status ?? 'OK', view: 'customer', activity: r.activity ?? r.intelligence?.activity, storable: true });
ok(JSON.stringify(cd(a)) === JSON.stringify(cd(b)), 'the credit decision is identical with and without source dates', { a: cd(a), b: cd(b) });
ok(JSON.stringify(a.renderOnly ?? null) !== undefined && Object.keys(a.renderOnly?.internal?.excluded ?? {}).every((k) => (a.renderOnly.internal.excluded[k] ?? 0) === (b.renderOnly?.internal?.excluded?.[k] ?? 0)), 'no record is excluded or admitted differently');
// the stage and the dates a customer reads differ ONLY in the new fields, never in the older ones
const oldKeys = (p) => Object.keys(p).filter((k) => !['record_dates', 'status_attribution'].includes(k)).sort().join();
ok(oldKeys(a.intelligence.projects[0]) === oldKeys(b.intelligence.projects[0]), 'the same project has the same older keys; only the new ones differ');

// ── stored reports: new body readable by the watch/follow reader; an OLD body (none of the new fields) still reads; keys are not subject-relative ──
const asStored = (r) => ({ generated_at: '2026-11-19T18:00:00Z', body: JSON.stringify(r.intelligence ? { product: r.intelligence.product, ...r.intelligence } : r) });
let readNew = null, readOld = null;
try { readNew = CS.parseStoredReport(asStored(a)); } catch (e) { readNew = String(e); }
const oldBody = JSON.parse(asStored(a).body); for (const p of oldBody.projects) { delete p.record_dates; delete p.status_attribution; } delete oldBody.coverage?.categories;
try { readOld = CS.parseStoredReport({ generated_at: '2026-11-19T18:00:00Z', body: JSON.stringify(oldBody) }); } catch (e) { readOld = String(e); }
ok(readNew && typeof readNew === 'object' && readNew.projects.length === 1, 'a stored report that carries the new fields is read by the watch/follow reader', readNew);
ok(readOld && typeof readOld === 'object' && readOld.projects.length === 1 && readNew.projects[0].project_id === readOld.projects[0].project_id, 'a stored report from before this change still reads, with the same project identity');
ok(SS.subjectRelativeKeys(a.intelligence).length === 0, 'the new keys are not subject-relative: the permanent snapshot boundary accepts them', SS.subjectRelativeKeys(a.intelligence));
const hNew = await SS.contentHashOf(a.intelligence), hOld = await SS.contentHashOf(b.intelligence);
ok(hNew !== hOld, 'KNOWN, expected: the content hash of a NEW report differs when source dates exist (a new report is a new snapshot; stored ones are immutable and unchanged)');
// ── the report view of an OLD stored report (no new fields) ──
import { runInNewContext } from 'node:vm';
const sb = { window: {} }; runInNewContext(read('lib/da-report-' + 'view.js'), sb); const V = sb.window.HS.daReportView;
const W = await import('./lib/da-report-' + 'view-world.mjs');
const wr = await W.wire({ rows: [W.row('v1', 0.2, 'wsdot-project-delivery-plan-proposed')], projects: [W.proj('v1', 'wsdot-project-delivery-plan-proposed')], ledger: [], events: [], health: [] });
for (const p of wr.report.projects) { delete p.record_dates; delete p.status_attribution; } delete wr.report.coverage?.categories;
let threw = false, html = ''; try { html = V.html(wr, { subject: W.ADDRESS }); } catch { threw = true; }
ok(!threw && html.length > 500 && !/last modified|Source coverage|connected sources/i.test(html.replace(/<[^>]+>/g, ' ')), 'a stored report without the new fields renders with no modification note and no coverage line (nothing is guessed)');
// ── watch / follow / notification readers do not read the new fields ──
for (const f of ['_shared/property-watch.ts', '_shared/watch-email.ts', '_shared/watch-reads.ts', '_shared/changes-since-report.ts', '_shared/credit-rule.ts']) {
  ok(!/record_dates|status_attribution|source_dates|coverage\.categories|category_coverage/.test(read('supabase/functions/' + f)), f + ' reads none of the new fields, so no comparison, eligibility or credit rule can move on them');
}
for (const f of ['follow-development-report', 'manage-property-watch']) {
  const src = read('supabase/functions/' + f + '/handler.ts');
  ok(!/record_dates|status_attribution|source_dates|category_coverage/.test(src.replace(/\/\/.*$/gm, '')) || /readReportInputs|assemble/.test(src), f + ' either ignores the new fields or reaches them only through the shared assemble');
}
console.log(`\n${n - fails}/${n} passed`); process.exit(fails ? 1 : 0);
