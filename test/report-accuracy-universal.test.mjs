// report-accuracy-universal (2026-11-19): ONE contract for what a date on a record means, who stated a status and how fresh it is, and which kinds of record the
// connected sources cover. Every case runs the real engine (assemble), the real date/coverage modules and the real view, on fixtures from several source types and
// states. The shared rules never name a source, place or agency; a source differs only through its registry METADATA (the `publishers` table passed to assemble, the
// same shape the generated file has).
// Run: node --experimental-strip-types test/report-accuracy-universal.test.mjs
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const M = await import('../supabase/functions/_shared/national-report.ts');
const D = await import('../supabase/functions/_shared/record-dates.ts');
const C = await import('../supabase/functions/_shared/coverage-categories.ts');
const SD = await import('../supabase/functions/get-address-report/sources/source-dates.ts');
globalThis.window = globalThis;
await import('../lib/project-type.js');
const sandbox = { window: {} };
runInNewContext(readFileSync(join(root, 'lib', 'da-report-' + 'view.js'), 'utf8'), sandbox);
const V = sandbox.window.HS.daReportView;
let fails = 0, n = 0;
const ok = (c, name, d) => { n++; console.log((c ? 'PASS' : 'FAIL') + ' — ' + name); if (!c) { fails++; if (d !== undefined) console.log('   ' + JSON.stringify(d).slice(0, 600)); } };

const attribution = { version: 1, attribution: {} };
const NOW = new Date('2026-11-19T18:00:00Z');
const TODAY = '2026-11-19';
const mk = (key, reg, name, status, extra = {}) => ({ source_key: key, registry_id: reg, record_kind: 'development', name, type: 'Development', type_raw: 'New Construction', status, stage: status,
  developer: null, size: null, investment: null, submitted_at: '2024-08-26', date_kind: 'filed', address: null, source_ref: 'https://example.gov/' + key, provenance: {}, ...extra });
const row = (key, reg, d = 0.2) => ({ source_key: key, feature_id: 'f:' + key, registry_id: reg, provenance: 'recovered_authoritative', distance_mi: d, geometry_type: 'ST_Point', has_more: false, marker_lat: 40.02, marker_lng: -105.28 });
const SUBJECT = { address: '1 Test St, Anytown', matched_address: null, lat: 40.0177, lng: -105.28, zip: '80302' };
// three DIFFERENT source types with different declared date meanings (registry metadata only)
const PUB = {
  'fam-filing': { agency: 'City A', dataset: 'Permits', date_basis: 'filing' },
  'fam-created': { agency: 'State B', dataset: 'Projects', date_basis: 'record_created' },
  'fam-unstated': { agency: 'County C', dataset: 'Cases' },
  'fam-labeled': { agency: 'Agency D', dataset: 'Register', date_label: 'Published in the register' },
};
const run = (rows, projects, extra = {}) => M.assemble({ now: NOW, subject: SUBJECT, radius_mi: 0.5, view: 'internal', zip_supported: true, attribution, rows, projects, ledger: [], events: [], health: [], publishers: PUB, ...extra });
const one = (reg, proj, extra) => { const a = run([row(proj.source_key, reg)], [proj], extra); return { a, p: (a.intelligence?.projects ?? []).find((x) => x.project_id === proj.source_key) }; };

// ── 1. date semantics ─────────────────────────────────────────────────────────────────────
const filing = one('fam-filing', mk('f1', 'fam-filing', 'New 40-unit apartment building', 'Approved'));
ok(filing.p?.record_date?.label === 'Filed', 'a source that declares a FILING date labels it Filed', filing.p?.record_date);
const created = one('fam-created', mk('c1', 'fam-created', 'New 40-unit apartment building', 'Approved'));
ok(created.p?.record_date?.label === 'Record created', 'a CREATION date is never labelled Filed', created.p?.record_date);
ok(created.p?.record_date?.basis === 'record_created', 'the date carries its declared basis', created.p?.record_date);
const unstated = one('fam-unstated', mk('u1', 'fam-unstated', 'New 40-unit apartment building', 'Approved'));
ok(unstated.p?.record_date?.label === 'Filed' && unstated.p?.record_date?.basis === undefined, 'an undeclared basis keeps the legacy label and invents no basis (follow-up list, not a guess)', unstated.p?.record_date);
const labeled = one('fam-labeled', mk('l1', 'fam-labeled', 'New 40-unit apartment building', 'Approved'));
ok(labeled.p?.record_date?.label === 'Published in the register', "the registry's own date label still wins", labeled.p?.record_date);

// source dates are validated: modified later than created, sentinel and future days dropped, a fetch time is never one of them
const sd = D.sourceDatesOf({ source_dates: { created: '2024-08-26', updated: '2026-10-01', status_updated: '1900-01-01', milestones: [{ label: 'Advertise', date: '2027-02-01', kind: 'planned' }, { label: 'Bad', date: '9999-01-01' }, { label: '', date: '2026-01-01' }] } }, TODAY);
ok(sd?.created === '2024-08-26' && sd?.updated === '2026-10-01', 'created and updated are kept apart', sd);
ok(sd?.status_updated === undefined, 'a sentinel status date is dropped', sd);
ok(sd?.milestones?.length === 1 && sd.milestones[0].kind === 'planned', 'a planned future milestone is kept with its kind; a sentinel or unlabeled one is dropped', sd?.milestones);
ok(D.sourceDatesOf({ source_dates: { updated: '2027-06-01' } }, TODAY) === null, 'a modification date in the future is dropped', null);
ok(D.sourceDatesOf({}, TODAY) === null && D.sourceDatesOf(null, TODAY) === null, 'no source dates means null, never an invented date');
ok(D.sourceDatesOf({ source_dates: { fetched_at: '2026-11-19', last_read: '2026-11-19' } }, TODAY) === null, 'our own fetch time is never a source date');

// an older creation date with a newer modification
const withMod = one('fam-created', mk('c2', 'fam-created', 'New 40-unit apartment building', 'Approved', { provenance: { source_dates: { created: '2024-08-26', updated: '2026-11-10' } } }));
ok(withMod.p?.record_dates?.updated === '2026-11-10' && withMod.p?.record_dates?.created === '2024-08-26', 'created and modified both ride on the project, separately', withMod.p?.record_dates);
ok(withMod.p?.record_date?.verify?.reason === 'creation_only', 'a modification does not count as a later official date: the record is still creation-only', withMod.p?.record_date?.verify);
// a genuine status update IS a later official date
const withStatus = one('fam-created', mk('c3', 'fam-created', 'New 40-unit apartment building', 'Approved', { provenance: { source_dates: { created: '2024-08-26', updated: '2026-11-10', status_updated: '2026-11-05' } } }));
ok(withStatus.p?.record_date?.verify?.reason !== 'creation_only' && withStatus.p?.status_attribution?.status_date?.date === '2026-11-05', 'a mapped status-update date is carried and counts, a generic modification does not', { v: withStatus.p?.record_date?.verify, s: withStatus.p?.status_attribution });
// an unchanged old record read just now
const stale = one('fam-filing', mk('s1', 'fam-filing', 'New 40-unit apartment building', 'Approved'), { ledger: [], events: [] });
ok(!!stale.p?.record_date?.verify && stale.p.record_date.verify.latest_official_date === '2024-08-26', 'a recent fetch of an unchanged old record leaves the uncertainty in place', stale.p?.record_date?.verify);

// ── 2. status attribution ─────────────────────────────────────────────────────────────────
ok(created.p?.status_attribution?.basis === 'source_reported' && created.p?.status_attribution?.verified_by_jody === false, 'a stage is the source\'s word, never verified by Jody', created.p?.status_attribution);
ok(created.p?.status_attribution?.status_date === null, 'with no status-update date the status date is null, not the filing or modification date', created.p?.status_attribution);

// ── 3. coverage categories ────────────────────────────────────────────────────────────────
const PL = [{ state: 'CO', county: 'Boulder' }];
const reg = { 'dot-state': ['transportation_capital'], 'city-permits': ['building_permits'], 'cnty-plan': ['planning_zoning'], 'state-permits': ['building_permits', 'planning_zoning'], 'no-meta': [] };
const complete = { 'city-permits': ['building_permits'] };
const scope = (id) => ({ 'dot-state': 'statewide', 'city-permits': 'county', 'cnty-plan': 'county', 'state-permits': 'statewide', 'no-meta': 'county' })[id] ?? null;
const cov = (apps, r = reg, c = complete) => C.categoryCoverage(PL, apps, r, scope, c);
const keys = (l) => l.map((e) => e.category).sort();
const find = (t, k) => t.connected.find((e) => e.category === k);
const t1 = cov(['dot-state']);
ok(keys(t1.connected).join() === 'transportation_capital' && keys(t1.not_connected).join() === 'building_permits,planning_zoning,subdivision_land_division', 'transportation-only: the other categories are NOT connected', t1);
const t2 = cov(['dot-state', 'city-permits', 'cnty-plan']);
ok(keys(t2.connected).join() === 'building_permits,planning_zoning,transportation_capital' && keys(t2.not_connected).join() === 'subdivision_land_division', 'mixed transportation, permit and planning coverage', t2);
// scope and category are separate: a STATEWIDE source that declares local categories IS connected for them (scope statewide), never ruled out by its scope
const t6 = cov(['state-permits']);
ok(find(t6, 'building_permits')?.scope === 'statewide' && find(t6, 'planning_zoning')?.scope === 'statewide', 'a statewide source that declares local categories is connected for them, scope statewide', t6);
ok(find(t6, 'building_permits')?.completeness === 'not_established', 'a statewide source never implies comprehensive local coverage (completeness not established)', find(t6, 'building_permits'));
ok(find(cov(['city-permits']), 'building_permits')?.completeness === 'declared_complete', 'completeness is "declared complete" only when the registry declared it', cov(['city-permits']));
ok(find(cov(['cnty-plan']), 'planning_zoning')?.completeness === 'not_established', 'a county-scope source is not complete either unless it declared it', cov(['cnty-plan']));
ok(find(cov(['state-permits', 'city-permits']), 'building_permits')?.scope === 'county' && find(cov(['state-permits', 'city-permits']), 'building_permits')?.completeness === 'declared_complete', 'a statewide and a county source together: county scope, declared complete by the one that declared it');
// mixed sources: known coverage is not erased by another applicable source that lacks metadata, but absence claims stop
const t3 = cov(['dot-state', 'no-meta']);
ok(keys(t3.connected).join() === 'transportation_capital', 'known coverage survives another source that declares nothing', t3);
ok(t3.not_connected.length === 0 && keys(t3.not_established).join() === 'building_permits,planning_zoning,subdivision_land_division', 'unknown metadata prevents an absence claim: the rest is "not established", never "not connected"', t3);
const t4 = C.categoryCoverage([], ['dot-state'], reg, scope, complete);
ok(t4.not_connected.length === 0 && t4.geography_verified === false, 'unverified geography never produces a missing claim', t4);
ok(cov([]).connected.length === 0 && cov([]).not_connected.length === 0, 'no applicable source: nothing connected and nothing claimed missing (geography cannot be tied to a source)');
ok(C.categoryCoverageOf(null) === null && C.categoryCoverageOf({ rule: 'coverage-categories-1', connected: [], not_connected: [], not_established: [] }) === null && C.categoryCoverageOf(t1) === t1, 'a stored value is read back only when it is a rule-2 category coverage');
// a typo in the registry cannot silently drop a source's coverage
const G = await import('../scripts/gen-source-categories.mjs');
let threw = false; try { G.build({ arcgis: [{ registry_id: 'x', coverage_categories: ['building_permit'] }] }); } catch { threw = true; }
ok(threw, 'an unknown category word fails the generator');
threw = false; try { G.build({ arcgis: [{ registry_id: 'x', coverage_categories: ['building_permits'], coverage_complete_for: ['planning_zoning'] }] }); } catch { threw = true; }
ok(threw, 'completeness cannot be declared for a category the source does not declare');

// coverage rides on the report and is separate from outcome, limitations and credit
const noCov = run([], []);
const covRun = run([], [], { category_coverage: t1 });
ok(covRun.intelligence?.coverage?.categories?.not_connected?.length === 3 && !noCov.intelligence?.coverage?.categories, 'the report carries the category coverage and only when given', covRun.intelligence?.coverage?.categories);
ok(covRun.activity?.outcome === noCov.activity?.outcome && covRun.coverage_state === noCov.coverage_state && JSON.stringify(covRun.intelligence?.coverage?.limitations) === JSON.stringify(noCov.intelligence?.coverage?.limitations),
  'coverage disclosure changes neither the outcome, the coverage state nor the limitations (so no credit decision moves)', { a: covRun.activity?.outcome, b: noCov.activity?.outcome });
const failing = run([row('x1', 'fam-filing')], [mk('x1', 'fam-filing', 'New 40-unit apartment building', 'Approved')], { category_coverage: t1, health: [{ registry_id: 'fam-filing', fetch_failures_24h: 2, blocked_24h: 0, truncated_24h: 0 }] });
ok((failing.intelligence?.coverage?.limitations ?? []).some((l) => l.code === 'SOURCE_NOT_FULLY_READ') && failing.intelligence.coverage.categories.not_connected.length === 3, 'a failing applicable source is SOURCE_NOT_FULLY_READ, kept apart from the missing-category list', (failing.intelligence?.coverage?.limitations ?? []).map((l) => l.code));

// ── 4. no unintended change events ────────────────────────────────────────────────────────
const a1 = run([row('e1', 'fam-created')], [mk('e1', 'fam-created', 'New 40-unit apartment building', 'Approved')]);
const a2 = run([row('e1', 'fam-created')], [mk('e1', 'fam-created', 'New 40-unit apartment building', 'Approved', { provenance: { source_dates: { created: '2024-08-26', updated: '2026-11-10', status_updated: '2026-11-05', milestones: [{ label: 'Advertise', date: '2027-02-01', kind: 'planned' }] } } })]);
ok(JSON.stringify(a1.intelligence?.what_changed ?? null) === JSON.stringify(a2.intelligence?.what_changed ?? null), 'adding source dates to a record creates no change event', { a: a1.intelligence?.what_changed, b: a2.intelligence?.what_changed });
const connectorRec = SD.sourceDatesField({ c: 1, m: 2 }, { source_created: 'c', source_updated: 'm' }, (r, k) => r[k], (v) => (v === 1 ? '2024-08-26' : '2026-11-10'));
ok(connectorRec.source_dates?.created === '2024-08-26' && connectorRec.source_dates?.updated === '2026-11-10', 'the connector reads the mapped source columns', connectorRec);
ok(Object.keys(SD.sourceDatesField({ a: 1 }, {}, (r, k) => r[k], () => null)).length === 0, 'a source mapping nothing adds nothing to the record');
const fp = readFileSync(join(root, 'supabase/functions/get-address-report/sources/source-dates.ts'), 'utf8');
ok(/Nothing here is a fingerprint input/.test(fp), 'the connector documents that source dates are not a ledger fingerprint input');

// ── 5. no source, place or agency name in the shared rules ──────────────────────────────
for (const f of ['record-dates.ts', 'coverage-categories.ts']) {
  const src = readFileSync(join(root, 'supabase/functions/_shared', f), 'utf8').replace(/\/\/.*$/gm, '');
  ok(!/udot|utah|brigham|boulder|\bzip\b|wsdot|txdot|county_cases/i.test(src), f + ': no source, place or agency name in the shared rules');
}
const reg2 = JSON.parse(readFileSync(join(root, 'supabase/functions/get-address-report/jurisdiction-registry.json'), 'utf8'));
const withBasis = Object.values(reg2).filter(Array.isArray).flat().filter((e) => e && e.file_date_basis);
ok(withBasis.every((e) => ['filing', 'record_created'].includes(e.file_date_basis)), 'every declared date basis is in the closed vocabulary');
ok(withBasis.length >= 1, 'the confirmed mappings declare their basis (' + withBasis.length + ')');

// ── 6. the view ───────────────────────────────────────────────────────────────────────────
const txt = (h) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const W = await import('./lib/da-report-' + 'view-world.mjs');
const FAMC = withBasis[0].registry_id ?? withBasis[0].id;
const world = (prov) => ({ rows: [W.row('v1', 0.2, FAMC)], projects: [W.proj('v1', FAMC, { submitted_at: '2024-08-26', provenance: prov, status: 'Approved', stage: 'Approved' })], ledger: [], events: [], health: [] });
const respMod = await W.wire(world({ source_dates: { created: '2024-08-26', updated: '2026-09-20' } }), { attribution: { version: 1, attribution: {} } });
const vCreated = txt(V.html(respMod, { subject: W.ADDRESS }));
ok(/Record created/.test(vCreated) && !/Filed Aug/.test(vCreated), 'the view says Record created, not Filed, for a creation date', vCreated.slice(0, 300));
ok(/a modification is not a project milestone/i.test(vCreated), 'the view explains that a modification is not a milestone');
ok(/a creation date does not show the work is active/.test(vCreated), 'the view says a creation date does not show the work is active');
const respStatus = await W.wire(world({ source_dates: { created: '2024-08-26', updated: '2026-09-20', status_updated: '2026-09-15' } }), { attribution: { version: 1, attribution: {} } });
const vStatus = txt(V.html(respStatus, { subject: W.ADDRESS }));
ok(/Agency status updated Sep 15, 2026/.test(vStatus), 'a mapped status-update date is shown as the agency status date');
ok(!/Agency status updated/.test(vCreated), 'a modification date alone is never shown as a status date');
ok(/does not independently verify/i.test(vCreated), 'the view says Jody does not independently verify a stage');
const respEmpty = await W.wire({ rows: [], projects: [], ledger: [], events: [], health: [] }, { attribution: { version: 1, attribution: {} } });
respEmpty.report.coverage ??= {}; respEmpty.report.coverage.categories = t1; // a report whose categories are the t1 case (transportation connected, nothing declared complete)
const vEmpty = txt(V.html(respEmpty, { subject: W.ADDRESS }));
ok(/completeness not established/.test(vEmpty) && !/declared complete/.test(vEmpty), 'a connected category with no declared completeness reads "completeness not established", never complete', vEmpty.match(/Connected sources hold.{0,200}/)?.[0]);
ok(/only the sources Jody has connected/i.test(vEmpty) && /Transportation capital projects|building permits/i.test(vEmpty), 'an empty report names what the connected sources cover and what no source covers', vEmpty.slice(0, 400));
ok(!/nothing is happening|no development is|no activity/i.test(vEmpty.replace(/No (significant )?development activity[^.]*\./i, '')), 'the caveat makes no absence claim');

// ── generated files are in step with the registry (the same --check the generators expose) ──
const { spawnSync } = await import('node:child_process');
for (const g of ['gen-source-categories', 'gen-source-publishers']) {
  const r = spawnSync(process.execPath, [join(root, 'scripts', g + '.mjs'), '--check'], { cwd: root, encoding: 'utf8' });
  ok(r.status === 0, g + ' --check: the generated file matches the registry', r.stderr);
}
// ── 7. the date-basis audit: names are leads, declared mappings are not re-listed as candidates ──
const AU = await import('../scripts/audit-date-basis.mjs');
const au = AU.audit({ arcgis: [
  { registry_id: 'a', column_map: { file_date: 'CreatedDate' } }, { registry_id: 'b', column_map: { file_date: 'CreatedDate' }, file_date_basis: 'record_created' },
  { registry_id: 'c', column_map: { file_date: 'ApplicationDate' } }, { registry_id: 'd', column_map: { file_date: 'D1' } },
  { registry_id: 'e', column_map: { file_date: 'LastEditDate' }, file_date_label: 'Published' }, { registry_id: 'f', column_map: {} }] });
const st = Object.fromEntries(au.map((r) => [r.registry_id, r.status]));
ok(st.a === 'candidate_review' && st.b === 'declared' && st.c === 'name_suggests_filing' && st.d === 'unclassified_name' && st.e === 'own_label' && !('f' in st), 'the audit separates candidates, declared, own-label, unproven and unclassified mappings', st);
ok(AU.audit(AU.REGISTRY).filter((r) => r.file_date_basis).every((r) => r.status === 'declared'), 'every real declared mapping is listed as declared, never as a candidate');

console.log(`\n${n - fails}/${n} passed`);
process.exit(fails ? 1 : 0);
