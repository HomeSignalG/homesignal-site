// P0 (2026-11-19): NATIONWIDE SOURCE COMPLETENESS of the address-level Development Activity Report. Diagnostic example: 1777 Broadway, Boulder CO.
// Proves, with agencies from three states and three geometry levels (point, linear, area), that eligible records reach the report whatever
// their geometry, jurisdiction or filing age, and that a record the hydrate step could not read is COUNTED, not silently lost.
// Run: node test/report-source-completeness.test.mjs
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const M = await import('../supabase/functions/_shared/national-report.ts');
globalThis.window = globalThis;
await import('../lib/project-type.js');
let fails = 0;
const ok = (c, n, d) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + n); if (!c) { fails++; if (d !== undefined) console.log('   ' + JSON.stringify(d).slice(0, 600)); } };
const attribution = JSON.parse(readFileSync(join(root, 'supabase/functions/_shared/source-attribution.json'), 'utf8'));
const NOW = new Date('2026-11-19T18:00:00Z');
const old = '2025-03-01T00:00:00Z'; // far outside the 90-day window: an active project's filing date is not its currency
const mk = (key, reg, name, status, type, extra = {}) => ({ source_key: key, registry_id: reg, record_kind: 'development', name, type, type_raw: null, status, stage: null,
  developer: null, size: null, investment: null, submitted_at: old, date_kind: 'filed', address: null, source_ref: 'https://example.gov/' + key, ...extra });
const row = (key, reg, d, gt) => ({ source_key: key, feature_id: 'f:1', registry_id: reg, provenance: 'recovered_authoritative', distance_mi: d, geometry_type: gt, has_more: false, marker_lat: 40.02, marker_lng: -105.28 });
const cases = [
  // [state, geometry, registry, key, name, status, type]
  ['TX', 'ST_MultiLineString', 'txdot-projects-info-all', 'tx:1', 'SH 119 safety improvements', 'Approved', 'Development'],
  ['UT', 'ST_MultiLineString', 'udot-active-projects-lines', 'ut:1', 'New highway: construct new interchange and bridge replacement', 'Proposed', 'Development'],
  ['WA', 'ST_MultiPolygon', 'wsdot-project-delivery-plan-under-construction', 'wa:1', 'Construct new bridge and widen roadway', 'Approved', 'Development'],
  ['CO', 'ST_Point', 'boulder-construction-permits', 'co:1', 'New 120-unit apartment building', 'Approved', 'Development'],
];
const projects = cases.map(([, , reg, key, name, status, type]) => mk(key, reg, name, status, type));
const rows = cases.map(([, gt, reg, key], i) => row(key, reg, 0.1 + i * 0.1, gt));
const SUBJECT = { address: '1777 Broadway, Boulder, CO 80302', matched_address: null, lat: 40.0177, lng: -105.28, zip: '80302' };
const a = M.assemble({ now: NOW, subject: SUBJECT, radius_mi: 0.5, view: 'internal', zip_supported: true, attribution, rows, projects, ledger: [], events: [], health: [] });
const got = new Set((a.intelligence?.projects ?? []).map((p) => p.project_id));
for (const [st, gt, , key] of cases) ok(got.has(key), `${st} ${gt} project filed >90 days ago reaches the report`, a.renderOnly?.internal?.excluded);
// the 90-day window is not a filter on active projects; only an operating record with no event is a standing inventory
ok(!('filing_age' in (a.renderOnly?.internal?.excluded ?? {})), 'no filing-age exclusion exists in the report');
// a key the radius returned but hydrate could not read must be disclosed
const lost = M.assemble({ now: NOW, subject: SUBJECT, radius_mi: 0.5, view: 'internal', zip_supported: true, attribution,
  rows: [...rows, row('co:gone', 'boulder-construction-permits', 0.2, 'ST_Point')], projects, ledger: [], events: [], health: [] });
ok((lost.renderOnly?.internal?.excluded?.not_hydrated ?? 0) === 1, 'a radius key with no hydrated development row is counted as not_hydrated, never silently dropped', lost.renderOnly?.internal?.excluded);
// a retired source (no development rows left in the store at all) is not a loss and must not mark nearby reports incomplete
const retired = M.assemble({ now: NOW, subject: SUBJECT, radius_mi: 0.5, view: 'internal', zip_supported: true, attribution,
  rows: [...rows, row('dc:old', 'denton-county-dev-permits', 0.2, 'ST_Point')], projects, ledger: [], events: [], health: [] });
ok((retired.renderOnly?.internal?.excluded?.not_hydrated ?? 0) === 0 && !JSON.stringify(retired).includes('RECORDS_NOT_LOADED'), 'keys of a wholly retired source family are not reported as lost records');
// not_hydrated must make the report LIMITED, never complete
ok(lost.coverage?.state === 'LIMITED_COVERAGE' || lost.coverage_state === 'LIMITED_COVERAGE' || JSON.stringify(lost).includes('RECORDS_NOT_LOADED'), 'unhydrated records add a coverage limitation', Object.keys(lost));
ok(JSON.stringify(lost).includes('RECORDS_NOT_LOADED') && !JSON.stringify(a).includes('RECORDS_NOT_LOADED'), 'the limitation appears only when records were lost');
// transportation agency identity alone is not enough: only a capital-project/improvement program qualifies
const pub = { agency: 'Texas Department of Transportation', dataset: 'service TxDOT_Projects_Info_All' };
ok(M.isCapitalProgramSource('txdot-projects-info-all', pub) === true, 'a DOT capital-project program qualifies');
ok(M.isCapitalProgramSource('txdot-row-permits', pub) === false, 'a DOT permit / right-of-way feed does not qualify');
ok(M.isCapitalProgramSource('boulder-construction-permits', { agency: 'City of Boulder', dataset: null }) === false, 'a non-transportation agency does not qualify');
const roads = (a.intelligence?.projects ?? []).filter((p) => p.project_id === 'tx:1');
ok(roads.length === 1 && roads[0].type?.key === 'infrastructure' && roads[0].type?.label === 'Roads & infrastructure', 'an untitled DOT project is typed Roads & infrastructure so the category filter finds it', roads[0]?.type);
// representative cross-category records (real registry families; every one must be included with a basis)
const more = [
  ['datacenter', 'seattle-land-use-permits', 'dc:1', 'Proposed data center campus, 40 MW, new construction', 'Industrial'],
  ['utility', 'wa-ecology-sepa-register', 'ut:u', 'New water treatment plant and sewer main extension', 'Utility'],
  ['civic', 'seattle-building-permits', 'cv:1', 'New public school building', 'Civic/Public'],
  ['heavy-facility', 'wake-county-building-permits', 'hf:1', 'Landfill expansion permit, new cell construction', 'Industrial'],
  ['industrial', 'wake-county-building-permits', 'in:1', 'New warehouse building, 200,000 sq ft', 'Industrial'],
  ['commercial', 'boulder-construction-permits', 'cm:1', 'New 5-story office building', 'Commercial'],
];
const p2 = more.map(([, reg, key, name, type]) => mk(key, reg, name, 'Approved', type));
const r2 = more.map(([, , key, ], i) => row(key, more[i][1], 0.1 + i * 0.05, 'ST_Point'));
const b = M.assemble({ now: NOW, subject: SUBJECT, radius_mi: 0.5, view: 'internal', zip_supported: true, attribution, rows: r2, projects: p2, ledger: [], events: [], health: [] });
const gb = new Map((b.intelligence?.projects ?? []).map((p) => [p.project_id, p]));
for (const [cat, , key] of more) ok(gb.has(key), `${cat} record reaches the report`, { got: [...gb.keys()], excl: b.renderOnly?.internal?.excluded });
// EPA FRS facility rows (record_kind facility) are the regulatory plane, never development activity
const epa = M.assemble({ now: NOW, subject: SUBJECT, radius_mi: 0.5, view: 'internal', zip_supported: true, attribution, rows: [row('frs:1', '110000', 0.1, 'ST_Point')],
  projects: [{ ...mk('frs:1', '110000', 'ACME PLANT', 'Operating', 'industrial'), record_kind: 'facility' }], ledger: [], events: [], health: [] });
ok((epa.renderOnly?.internal?.excluded?.development_only ?? 0) === 1, 'an EPA registry facility row is counted as development_only (regulatory plane), not listed as activity', epa.renderOnly?.internal?.excluded);
console.log(fails ? `\n${fails} FAILED` : '\nall passed'); process.exit(fails ? 1 : 0);
