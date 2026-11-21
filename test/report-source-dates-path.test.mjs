// The source-date PATH end to end with the PERSISTED shape (report-accuracy-universal, 2026-11-19):
//   connector record (source-dates.ts) -> site object (index.ts spreads the record) -> app_refresh_zip provenance -> hydrate (selects `provenance`) -> assemble -> view.
// The provenance objects come from test/app_refresh_zip_source_dates_pg/run.sh, which runs the PROPOSED migration's splice on the live provenance expression in a disposable
// Postgres (not production) and writes test/fixtures/report-accuracy/persisted-provenance.json. Names along the path: `source_dates` (connector, site, provenance)
// becomes `record_dates` ONLY in the report (project entry), so a consumer of the report never sees the stored key.
// Run: node --experimental-strip-types test/report-source-dates-path.test.mjs
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SD = await import('../supabase/functions/get-address-report/sources/source-dates.ts');
const W = await import('./lib/da-report-' + 'view-world.mjs');
const sandbox = { window: {} };
runInNewContext(readFileSync(join(root, 'lib', 'da-report-' + 'view.js'), 'utf8'), sandbox);
const V = sandbox.window.HS.daReportView;
let n = 0, fails = 0;
const ok = (c, name, d) => { n++; console.log((c ? 'PASS' : 'FAIL') + ' — ' + name); if (!c) { fails++; if (d !== undefined) console.log('   ' + JSON.stringify(d).slice(0, 500)); } };
const txt = (h) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const reg = JSON.parse(readFileSync(join(root, 'supabase/functions/get-address-report/jurisdiction-registry.json'), 'utf8'));
const entry = reg.arcgis.find((e) => e.file_date_basis === 'record_created');
const FAM = entry.registry_id ?? entry.id;
const persisted = JSON.parse(readFileSync(join(root, 'test/fixtures/report-accuracy/persisted-provenance.json'), 'utf8'));

// 1. the connector output, through the engine's site mapping (a spread), is what the SQL reads as `el->'source_dates'`
const cm = { source_created: 'CREATED', source_updated: 'MODIFIED' };
const rec = SD.sourceDatesField({ CREATED: 1, MODIFIED: 2 }, cm, (r, k) => r[k], (v) => (v === 1 ? '2024-08-26' : '2026-09-20'));
const site = { ...rec, record_url: 'https://example.gov/r', url: 'https://example.gov/r', e: 0, n: 0 };
ok(site.source_dates?.created === '2024-08-26' && site.source_dates?.updated === '2026-09-20', 'the site object carries source_dates under the same name the SQL reads', site);
// 2. the persisted provenance (real SQL) keeps the key and, for a record without dates, is unchanged
ok(persisted.with_source_dates.source_dates?.updated === '2026-09-20' && !('source_dates' in persisted.without_source_dates), 'the persisted provenance carries source_dates only when the site has them');
// 3. hydrate -> assemble -> view
const world = (prov) => ({ rows: [W.row('p1', 0.2, FAM)], projects: [W.proj('p1', FAM, { submitted_at: '2024-08-26', status: 'Approved', stage: 'Approved', provenance: prov })], ledger: [], events: [], health: [] });
const att = { version: 1, attribution: {} };
const withD = await W.wire(world(persisted.with_source_dates), { attribution: att });
const p = withD.report.projects[0];
ok(p.record_dates?.updated === '2026-09-20' && p.record_dates?.created === '2024-08-26', 'the report project carries the dates as record_dates (renamed from source_dates)', p.record_dates);
ok(!('source_dates' in p), 'the stored key name does not leak into the report');
const html = txt(V.html(withD, { subject: W.ADDRESS }));
ok(/Record created Aug 26, 2024/.test(html) && /last modified Sep 20, 2026/.test(html), 'a source modification date reaches the rendered report, labelled as a modification', html.match(/Verify:.{0,330}/)?.[0]);
ok(/a modification is not a project milestone/.test(html), 'and it is said not to be a milestone');
// 4. the old shape (no source_dates) renders exactly as before this change for the same record
const without = await W.wire(world(persisted.without_source_dates), { attribution: att });
const html0 = txt(V.html(without, { subject: W.ADDRESS }));
ok(!/last modified/.test(html0) && !('record_dates' in without.report.projects[0]), 'a record persisted before the migration shows no modification and no record_dates');
// 5. nothing downstream changes: identity, ledger input and the change list are the same with and without source dates
const strip = (r) => { const q = JSON.parse(JSON.stringify(r.report.projects[0])); delete q.record_dates; return q; };
ok(JSON.stringify(strip(withD).project_id) === JSON.stringify(strip(without).project_id) && JSON.stringify(withD.report.activity) === JSON.stringify(without.report.activity), 'project id and activity outcome are identical with and without source dates');
ok(withD.charged === without.charged && withD.credit?.decision === without.credit?.decision && withD.status === without.status && withD.coverage_state === without.coverage_state, 'credit, status and coverage state are identical', { a: withD.credit, b: without.credit });
console.log(`\n${n - fails}/${n} passed`); process.exit(fails ? 1 : 0);
