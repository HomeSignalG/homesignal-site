// The City of Boulder permit source states what it does NOT establish (2026-11-19, BOLO ZIP expansion review).
// Verification level: LOCAL + FIXTURE. It runs the shipped engine (assemble) and the shipped report view on synthetic inputs and the committed registry files.
// It does NOT verify live permit extraction, data freshness, deployment, or production routing, and it reads no database or network.
// Run: node --experimental-strip-types test/boulder-permit-scope-note.test.mjs
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
globalThis.window = globalThis; globalThis.HS = globalThis.HS || {};
const M = await import('../supabase/functions/_shared/national-report.ts');
const App = await import('../supabase/functions/_shared/source-applicability.ts');
await import('../lib/project-type.js');
await import('../lib/da-report-view.js');
let fails = 0;
const ok = (c, n, d) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + n); if (!c) { fails++; if (d !== undefined) console.log('   ' + JSON.stringify(d).slice(0, 400)); } };
const NOTE = 'This source contains City of Boulder permits only. It does not establish permit coverage for Lafayette, Louisville, Superior, or unincorporated Boulder County. Coverage for those areas, if available, depends on separate sources.';
const attribution = JSON.parse(readFileSync(join(root, 'supabase/functions/_shared/source-attribution.json'), 'utf8'));
const NOW = new Date('2026-11-19T18:00:00Z');
const subj = (zip, address, lat, lng) => ({ address, matched_address: null, lat, lng, zip });
const report = (subject, county, state = 'Colorado') => M.assemble({ now: NOW, subject, radius_mi: 0.5, view: 'internal', zip_supported: true, attribution,
  rows: [], projects: [], ledger: [], events: [], health: [], applicable_families: App.applicableFamilies([{ state, county }]) });
const notes = (a) => a.intelligence?.coverage?.source_scope_notes ?? [];
const html = (a) => HS.daReportView.html({ status: 'OK', coverage_state: a.coverage_state, report: a.intelligence, render: a.renderOnly?.customer ?? null }, { subject: a.intelligence?.zip });

// 1. the registry's own words, exactly as supplied
const reg = JSON.parse(readFileSync(join(root, 'supabase/functions/get-address-report/jurisdiction-registry.json'), 'utf8'));
const entry = reg.arcgis.find((e) => e.registry_id === 'boulder-construction-permits');
ok(entry?.scope_note === NOTE, 'registry: the Boulder city permit entry carries the approved wording, word for word');
ok(JSON.stringify(entry.coverage) === JSON.stringify([{ state: 'CO', county: 'Boulder' }]) && entry.column_map.zip === 'OriginalZip' && entry.jurisdiction === 'City of Boulder', 'registry: the {CO, Boulder} coverage gate, OriginalZip filter and jurisdiction label are unchanged');
ok(reg.arcgis.filter((e) => e.scope_note).length === 1, 'registry: only this entry carries a scope note');

// 2. a Boulder ZIP page and a Lafayette ZIP page both state it, though the source listed nothing for them
const boulder = report(subj('80302', '1777 Broadway, Boulder, CO 80302', 40.0177, -105.28), 'Boulder County');
const lafayette = report(subj('80026', 'Public Rd, Lafayette, CO 80026', 39.9936, -105.0897), 'Boulder County');
for (const [n, a] of [['Boulder 80302', boulder], ['Lafayette 80026', lafayette]]) {
  ok(notes(a).length === 1 && notes(a)[0].note === NOTE && notes(a)[0].source_family === 'boulder-construction-permits', `${n}: the engine carries the scope statement`, notes(a));
  ok(html(a).includes(NOTE.replace(/,/g, ',')), `${n}: the report view prints the statement`, html(a).length);
  ok(a.coverage_state !== 'LIMITED_COVERAGE', `${n}: the statement is not a limitation and does not change the coverage state`, a.coverage_state);
}
// 3. controls
const denver = report(subj('80202', '1500 Blake St, Denver, CO 80202', 39.75, -105.0), 'Denver County');
ok(notes(denver).length === 0 && !html(denver).includes('City of Boulder permits only'), 'control: a Denver ZIP does not carry the Boulder statement');
const unknown = M.assemble({ now: NOW, subject: subj('80026', 'x', 39.99, -105.09), radius_mi: 0.5, view: 'internal', zip_supported: true, attribution, rows: [], projects: [], ledger: [], events: [], health: [] });
ok(notes(unknown).length === 0, 'control: with no verified county the statement is not attached (applicability is unchanged)');
const withRecord = M.assemble({ now: NOW, subject: subj('80302', 'x', 40.0177, -105.28), radius_mi: 0.5, view: 'internal', zip_supported: true, attribution,
  rows: [{ source_key: 'co:1', feature_id: 'f:1', registry_id: 'boulder-construction-permits', provenance: 'recovered_authoritative', distance_mi: 0.1, geometry_type: 'ST_Point', has_more: false, marker_lat: 40.02, marker_lng: -105.28 }],
  projects: [{ source_key: 'co:1', registry_id: 'boulder-construction-permits', record_kind: 'development', name: 'New 120-unit apartment building', type: 'Development', type_raw: null, status: 'Approved', stage: null, developer: null, size: null, investment: null, submitted_at: '2025-03-01T00:00:00Z', date_kind: 'filed', address: null, source_ref: 'https://example.gov/co:1' }],
  ledger: [], events: [], health: [] });
ok(notes(withRecord).length === 1, 'a Boulder report that lists a Boulder permit carries it once');
// 4. the generated publishers file is current (it carries the note)
const r = spawnSync(process.execPath, ['scripts/gen-source-publishers.mjs', '--check'], { cwd: root, encoding: 'utf8' });
ok(r.status === 0, 'gen-source-publishers --check is current', r.stderr);
console.log(fails ? `\n${fails} FAILED` : '\nall passed'); process.exit(fails ? 1 : 0);
