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
console.log(fails ? `\n${fails} FAILED` : '\nall passed'); process.exit(fails ? 1 : 0);
