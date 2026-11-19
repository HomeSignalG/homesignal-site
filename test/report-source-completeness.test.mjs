// P0 (2026-11-19, CTO directive): NATIONWIDE SOURCE COMPLETENESS of the address-level Development Activity Report.
// Diagnostic example only: 1777 Broadway, Boulder CO. Every case runs the real engine (assemble) on records from several states and geometry levels.
// Run: node --experimental-strip-types test/report-source-completeness.test.mjs
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const M = await import('../supabase/functions/_shared/national-report.ts');
globalThis.window = globalThis;
await import('../lib/project-type.js');
let fails = 0;
const ok = (c, n, d) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + n); if (!c) { fails++; if (d !== undefined) console.log('   ' + JSON.stringify(d).slice(0, 500)); } };
const attribution = JSON.parse(readFileSync(join(root, 'supabase/functions/_shared/source-attribution.json'), 'utf8'));
const capital = JSON.parse(readFileSync(join(root, 'supabase/functions/_shared/capital-program-sources.generated.json'), 'utf8')).families;
const NOW = new Date('2026-11-19T18:00:00Z');
const OLD = '2025-03-01T00:00:00Z'; // far outside the 90-day window: an active project's filing date is not its currency
const mk = (key, reg, name, status, type, extra = {}) => ({ source_key: key, registry_id: reg, record_kind: 'development', name, type, type_raw: null, status, stage: null,
  developer: null, size: null, investment: null, submitted_at: OLD, date_kind: 'filed', address: null, source_ref: 'https://example.gov/' + key, ...extra });
const row = (key, reg, d, gt, more = {}) => ({ source_key: key, feature_id: 'f:1', registry_id: reg, provenance: 'recovered_authoritative', distance_mi: d, geometry_type: gt, has_more: false, marker_lat: 40.02, marker_lng: -105.28, ...more });
const SUBJECT = { address: '1777 Broadway, Boulder, CO 80302', matched_address: null, lat: 40.0177, lng: -105.28, zip: '80302' };
const run = (rows, projects, health = []) => M.assemble({ now: NOW, subject: SUBJECT, radius_mi: 0.5, view: 'internal', zip_supported: true, attribution, rows, projects, ledger: [], events: [], health });
const ex = (a) => a.renderOnly?.internal?.excluded ?? {};
const lims = (a) => (a.intelligence?.coverage?.limitations ?? []).map((l) => l.code);
const ids = (a) => new Set((a.intelligence?.projects ?? []).map((p) => p.project_id));
const byId = (a, k) => (a.intelligence?.projects ?? []).find((p) => p.project_id === k);

// ── eligibility across states and the three geometry levels, filed long before the 90-day window ──
const cases = [
  ['AK', 'ST_Point', 'akdot-stip-24-27', 'ak:1', 'SH 3 safety improvements'],
  ['NC', 'ST_MultiLineString', 'ncdot-stip-projects-lines', 'nc:1', 'US 74 widening'],
  ['WA', 'ST_MultiPolygon', 'wsdot-project-delivery-plan-under-construction', 'wa:1', 'Construct new bridge and widen roadway'],
  ['CO', 'ST_Point', 'boulder-construction-permits', 'co:1', 'New 120-unit apartment building'],
];
const base = run(cases.map(([, gt, reg, key], i) => row(key, reg, 0.1 + i * 0.1, gt)), cases.map(([, , reg, key, name]) => mk(key, reg, name, 'Approved', 'Development')));
for (const [st, gt, , key] of cases) ok(ids(base).has(key), `${st} ${gt} active project filed >90 days ago reaches the report`, ex(base));
ok(!('filing_age' in ex(base)), 'no filing-age exclusion exists in the report');
ok(lims(base).length === 0 && base.coverage_state !== 'LIMITED_COVERAGE', 'positive control: a complete retrieval carries no limitation', lims(base));

// ── transportation eligibility: documented capital-project program only ──
ok(['akdot-stip-24-27', 'ncdot-stip-projects-lines', 'wsdot-project-delivery-plan-under-construction'].every((f) => M.isCapitalProgramSource(f)), 'verified: the registry documents these as capital-project programs');
for (const k of ['ak:1', 'nc:1', 'wa:1']) { const p = byId(base, k); ok(p?.type?.key === 'infrastructure' && p?.type?.label === 'Roads & infrastructure', `${k} is filed under the canonical Roads & infrastructure category`, p?.type); }
ok(M.isCapitalProgramSource('txdot-projects-info-all') === false, 'negative: a DOT-published family without registry evidence of a capital program is NOT eligible by publisher identity');
ok(M.isCapitalProgramSource('boulder-construction-permits') === false && M.isCapitalProgramSource('txdot-row-permits') === false && M.isCapitalProgramSource(null) === false, 'negative: permit / non-transportation / unknown families never qualify');
ok(Object.keys(capital).every((f) => !/permit|license|inspection|right.of.way/i.test(f)), 'no permit, license or inspection feed is listed as a capital program');
const unrelated = run([row('tx:u', 'txdot-projects-info-all', 0.2, 'ST_MultiLineString')], [mk('tx:u', 'txdot-projects-info-all', 'SH 119 safety improvements', 'Approved', 'Development')]);
ok(!ids(unrelated).has('tx:u') && ex(unrelated).relevance_not_established === 1, 'an untitled record from an unverified DOT family is excluded, counted, never silently listed', ex(unrelated));
// the same words from a documented program ARE listed (the controlled pair for the case above)
const pair = run([row('ak:p', 'akdot-stip-24-27', 0.2, 'ST_Point')], [mk('ak:p', 'akdot-stip-24-27', 'SH 119 safety improvements', 'Approved', 'Development')]);
ok(ids(pair).has('ak:p'), 'control: the same words from a documented capital program are listed');

// ── missing hydration ──
const keep = cases.map(([, gt, reg, key], i) => row(key, reg, 0.1 + i * 0.1, gt));
const proj = cases.map(([, , reg, key, name]) => mk(key, reg, name, 'Approved', 'Development'));
const activeLoss = run([...keep, row('co:gone', 'boulder-construction-permits', 0.2, 'ST_Point')], proj);
ok(ex(activeLoss).not_hydrated === 1 && lims(activeLoss).includes('RECORDS_NOT_LOADED') && activeLoss.coverage_state === 'LIMITED_COVERAGE', 'missing hydration from an active source while others hydrate is counted and limits the report', { e: ex(activeLoss), l: lims(activeLoss) });
const retired = run([...keep, row('dc:old', 'denton-county-dev-permits', 0.2, 'ST_Point')], proj);
ok(M.isRetiredSource('denton-county-dev-permits') && ex(retired).retired_source === 1 && (ex(retired).not_hydrated ?? 0) === 0 && !lims(retired).includes('RECORDS_NOT_LOADED'), 'missing hydration from an explicitly retired source (documented decision) is not a loss', { e: ex(retired), l: lims(retired) });
const unknown = run([...keep, row('cb:1', 'cabarrus-county-plan-reviews', 0.2, 'ST_Point')], proj);
ok(M.isRetiredSource('cabarrus-county-plan-reviews') === false && ex(unknown).not_hydrated === 1 && lims(unknown).includes('RECORDS_NOT_LOADED'), 'missing hydration when retirement is unknown counts as lost (no inference from absence of rows)', { e: ex(unknown), l: lims(unknown) });
const total = run([row('a:1', 'boulder-construction-permits', 0.1, 'ST_Point'), row('a:2', 'akdot-stip-24-27', 0.2, 'ST_Point')], []);
ok(ex(total).not_hydrated === 2 && lims(total).includes('RECORDS_NOT_LOADED') && total.coverage_state === 'LIMITED_COVERAGE', 'complete hydration failure counts every key and limits the report', { e: ex(total), l: lims(total) });
ok(total.intelligence?.activity?.outcome !== 'DEVELOPMENT_SHOWN' && (total.intelligence?.projects ?? []).length === 0, 'complete failure is never presented as a report with development');

// ── zero qualifying records: a limitation must survive, its absence must too ──
const zeroLimited = run([row('z:1', 'boulder-construction-permits', 0.1, 'ST_Point', { has_more: true })], [mk('z:1', 'boulder-construction-permits', 'Re-roof 123 Main', 'Approved', 'Development')]);
ok((zeroLimited.intelligence?.projects ?? []).length === 0 && lims(zeroLimited).includes('AREA_TRUNCATED') && zeroLimited.coverage_state === 'LIMITED_COVERAGE', 'zero qualifying records with a known retrieval limitation stays LIMITED_COVERAGE', { l: lims(zeroLimited), s: zeroLimited.coverage_state });
ok(zeroLimited.intelligence?.activity?.outcome !== 'NO_DEVELOPMENT_ACTIVITY', 'a limited empty report never claims confirmed absence');
const zeroClean = run([], []);
ok((zeroClean.intelligence?.projects ?? []).length === 0 && lims(zeroClean).length === 0 && zeroClean.coverage_state !== 'LIMITED_COVERAGE', 'control: zero records and no limitation reads as an ordinary empty report', { s: zeroClean.coverage_state, l: lims(zeroClean) });

// ── the EPA plane is not development activity ──
const epa = run([row('frs:1', '110000', 0.1, 'ST_Point')], [{ ...mk('frs:1', '110000', 'ACME PLANT', 'Operating', 'industrial'), record_kind: 'facility' }]);
ok(ex(epa).development_only === 1 && !ids(epa).has('frs:1'), 'an EPA registry facility row is regulatory-plane, not listed as development activity', ex(epa));

// ── a known retrieval failure is disclosed for every geographically applicable source, even one that contributed nothing ──
const App = await import('../supabase/functions/_shared/source-applicability.ts');
const RR = await import('../supabase/functions/_shared/report-run.ts');
const cov = JSON.parse(readFileSync(join(root, 'supabase/functions/_shared/source-coverage.generated.json'), 'utf8')).families;
const boulderIds = App.applicableFamilies([{ state: 'Colorado', county: 'Boulder County' }]);
ok(boulderIds.includes('boulder-construction-permits') && !boulderIds.includes('seattle-building-permits') && boulderIds.every((id) => cov[id].some((c) => c.state === 'CO')), 'applicability: Boulder CO selects only sources whose declared coverage names CO (and Boulder, or statewide)', boulderIds.slice(0, 5));
ok(App.applicableFamilies([]).length === 0 && App.applicableFamilies([{ state: 'Atlantis', county: 'X' }]).length === 0 && App.applicableFamilies([{ state: 'CO', county: '' }]).every((id) => cov[id].every((c) => c.state !== 'CO' || !c.county) || !cov[id].some((c) => c.county)), 'applicability: unknown geography, or a county-scoped source with no verified county, makes nothing applicable');
const fakeReads = (health, places, calls = {}) => ({ radius: async () => [], hydrate: async (k) => (calls.h = k, []), ledger: async () => [], events: async () => [],
  health: async (f) => (calls.fams = f, health.filter((h) => f.includes(h.registry_id))), jurisdictions: async (z) => (calls.zip = z, places) });
const fail = [{ registry_id: 'boulder-construction-permits', fetch_failures_24h: 3, blocked_24h: 0, truncated_24h: 0 }];
const calls = {};
const inp = await RR.readReportInputs(fakeReads(fail, [{ state: 'CO', county: 'Boulder' }], calls), { lat: 40.0177, lng: -105.28, radiusMi: 0.5, now: NOW, zip: '80302' });
ok(calls.zip === '80302' && calls.fams?.includes('boulder-construction-permits') && inp.health.length === 1, 'failure evidence is READ for an applicable source that returned no record');
const emptyFail = M.assemble({ now: NOW, subject: SUBJECT, radius_mi: 0.5, view: 'internal', zip_supported: true, attribution, rows: [], projects: [], ledger: [], events: [], health: inp.health, applicable_families: inp.applicable_families });
ok(lims(emptyFail).includes('SOURCE_NOT_FULLY_READ') && emptyFail.coverage_state === 'LIMITED_COVERAGE' && emptyFail.intelligence?.activity?.outcome !== 'NO_DEVELOPMENT_ACTIVITY', 'a failed read of an applicable source with no records is disclosed and never reads as confirmed absence', { l: lims(emptyFail) });
const oth = await RR.readReportInputs(fakeReads([{ registry_id: 'seattle-building-permits', fetch_failures_24h: 5, blocked_24h: 0, truncated_24h: 0 }], [{ state: 'CO', county: 'Boulder' }]), { lat: 40.0177, lng: -105.28, radiusMi: 0.5, now: NOW, zip: '80302' });
const notApplicable = M.assemble({ now: NOW, subject: SUBJECT, radius_mi: 0.5, view: 'internal', zip_supported: true, attribution, rows: [], projects: [], ledger: [], events: [], health: oth.health, applicable_families: oth.applicable_families });
ok(!lims(notApplicable).includes('SOURCE_NOT_FULLY_READ'), 'control: a failing source that does not apply to the subject\'s verified geography adds no warning');
const unknownGeo = await RR.readReportInputs(fakeReads(fail, []), { lat: 40.0177, lng: -105.28, radiusMi: 0.5, now: NOW, zip: '80302' });
ok(unknownGeo.applicable_families.length === 0 && unknownGeo.health.length === 0, 'control: unverified geography makes no source applicable and invents no warning');
const noZip = await RR.readReportInputs(fakeReads(fail, [{ state: 'CO', county: 'Boulder' }]), { lat: 40.0177, lng: -105.28, radiusMi: 0.5, now: NOW });
ok(noZip.applicable_families.length === 0, 'control: with no ZIP the applicability route is not used');
// a source the spatial read FOUND (loaded or not) is judged too, with no geography lookup at all
const viaRow = M.assemble({ now: NOW, subject: SUBJECT, radius_mi: 0.5, view: 'internal', zip_supported: true, attribution, rows: [row('only:1', 'boulder-construction-permits', 0.1, 'ST_Point')], projects: [], ledger: [], events: [], health: fail });
ok(lims(viaRow).includes('SOURCE_NOT_FULLY_READ') && lims(viaRow).includes('RECORDS_NOT_LOADED'), 'a source whose key the spatial read found is judged on its failure even when nothing hydrated', lims(viaRow));
// the other two callers share the one read: the Watch passes the ZIP, and both data layers provide the geography read
for (const f of ['supabase/functions/run-property-watch/handler.ts', 'supabase/functions/get-development-activity-report/handler.ts']) ok(/zip: (stored\.zip|g\.zip)/.test(readFileSync(join(root, f), 'utf8')), f + ' passes the ZIP to readReportInputs');
for (const f of ['supabase/functions/run-property-watch/data.ts', 'supabase/functions/get-development-activity-report/data.ts']) ok(/jurisdictions: reportReads\.jurisdictions/.test(readFileSync(join(root, f), 'utf8')), f + ' provides the geography read');

// ── generated files are current ──
for (const g of ['gen-capital-program-sources.mjs', 'gen-source-publishers.mjs', 'gen-source-coverage.mjs']) { const r = spawnSync(process.execPath, ['scripts/' + g, '--check'], { cwd: root, encoding: 'utf8' }); ok(r.status === 0, g + ' --check is current', r.stderr); }
console.log(fails ? `\n${fails} FAILED` : '\nall passed'); process.exit(fails ? 1 : 0);
