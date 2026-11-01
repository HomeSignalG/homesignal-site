// national-4 (2026-11-01): the four Development Activity Report quality rules, tested on the records that exposed them
// (the 3101 Western Ave, Seattle sample and the Parkland, Tacoma backup) and on controls that must NOT change.
//   1. every record names its publishing agency and dataset (source registry), and the coverage note lists every agency in the report;
//   2. a title the source feed cut at its 120-character cap is marked as shortened, never shown as if complete;
//      records that share a title are told apart by the agency's own record number, shown only when the official link carries it;
//   3. minor building work (interior, single-unit, like-for-like repair) is listed apart from development, and never removed;
//   4. nothing here reads a place, a ZIP, a source name or a clock to decide.
// Run: node test/report-quality-national4.test.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const M = await import('../supabase/functions/_shared/national-report.ts');
globalThis.window = globalThis;
await import('../lib/project-type.js');
await import('../lib/da-report-view.js');
const V = globalThis.HS.daReportView;
let fails = 0, total = 0;
const ok = (c, name, detail) => { total++; console.log((c ? 'PASS' : 'FAIL') + ' — ' + name); if (!c) { fails++; if (detail !== undefined) console.log('           detail: ' + JSON.stringify(detail).slice(0, 600)); } };
const read = (f) => readFileSync(join(root, f), 'utf8');

// ---- 1. the publisher, from the source registry -------------------------------------------------------------------------------------------------
{
  const gen = spawnSync(process.execPath, ['scripts/gen-source-publishers.mjs', '--check'], { cwd: root, encoding: 'utf8' });
  ok(gen.status === 0, '1a source-publishers.generated.json is exactly what the source registry produces (node scripts/gen-source-publishers.mjs)', gen.stderr || gen.stdout);
  const reg = JSON.parse(read('supabase/functions/get-address-report/jurisdiction-registry.json'));
  const pubs = JSON.parse(read('supabase/functions/_shared/source-publishers.generated.json')).publishers;
  const ids = ['socrata', 'arcgis', 'ckan', 'csv', 'carto'].flatMap((c) => (reg[c] || []).map((e) => e.registry_id));
  ok(ids.length > 200 && ids.every((id) => pubs[id] && pubs[id].agency && pubs[id].dataset), '1b every registry source has an agency and a dataset reference (' + ids.length + ')');
  ok(JSON.stringify(M.publisherOf('seattle-land-use-permits')) === JSON.stringify({ agency: 'City of Seattle', dataset: 'data.seattle.gov, dataset ht3q-kdvx' })
    && M.publisherOf('wa-ecology-sepa-register').agency === 'Washington State Department of Ecology (SEPA Register)'
    && M.publisherOf('wa-ecology-sepa-register').dataset === 'data.wa.gov, dataset mmcb-z6jf', '1c the two sources the Seattle sample named nobody for now name their agency and dataset');
  ok(JSON.stringify(M.publisherOf('no-such-source')) === JSON.stringify({ agency: null, dataset: null }) && M.publisherOf(null).agency === null, '1d a source the registry does not know names no agency (never a guess)');
  // the agency names are the publishers' own: each Socrata dataset's `attribution` metadata (views API, read 2026-11-01) is
  // "City of Seattle" for ht3q-kdvx and 76t5-zqzr and "Washington State Department of Ecology" for mmcb-z6jf
  ok(M.publisherOf('seattle-land-use-permits').agency === 'City of Seattle' && M.publisherOf('seattle-building-permits').agency === 'City of Seattle'
    && M.publisherOf('wa-ecology-sepa-register').agency.startsWith('Washington State Department of Ecology'), '1e the registry agency names agree with the publishers\' own dataset attribution');
  // a credit line stays what it is: only a source whose publisher REQUIRES one carries it (source-attribution.json; this change adds none)
  const credits = JSON.parse(read('supabase/functions/_shared/source-attribution.json')).attribution;
  ok(Object.keys(credits).sort().join() === 'nyc-dob-permit-issuance,nyc-dobnow-approved-permits,seattle-building-permits', '1f no credit line was invented: the agency name rides in its own field');
}

// ---- 2. the record number, and a shortened title ------------------------------------------------------------------------------------------------
{
  const sepa = { provenance: { case_number: '202505363' }, source_ref: 'https://apps.ecology.wa.gov/separ/Main/SEPA/Record.aspx?SEPANumber=202505363' };
  ok(M.recordIdOf(sepa) === '202505363', '2a the agency record number is shown when the official link carries it');
  ok(M.recordIdOf({ provenance: { case_number: '999' }, source_ref: sepa.source_ref }) === null, '2b a number the official link does not carry is not shown');
  ok(M.recordIdOf({ provenance: null, source_ref: sepa.source_ref }) === null && M.recordIdOf({ provenance: { case_number: '202505363' }, source_ref: null }) === null, '2c no provenance, or no link: no number');
  ok(M.recordIdOf({ provenance: { case_number: '3042925-LU' }, source_ref: 'https://services.seattle.gov/portal/customize/LinkToRecord.aspx?altId=3042925-LU' }) === '3042925-LU', '2d a Seattle permit number is read off its own record link');
  const cut = 'Master Use Permit Land Use Application to allow an 8-story, 254-unit apartment building. Parking for 163 vehicles propos';
  ok(cut.length === 120 && M.titleCut(cut) && !M.titleCut('Commercial Demolish commercial warehouse building  per plan.') && !M.titleCut(null), '2e a title at the 120-character cap is marked as cut; a shorter one is not');
  // the cap is the connectors' own: each development connector stores `.slice(0, 120)`, and the engine's constant must be that number
  const dir = 'supabase/functions/get-address-report/sources';
  const caps = readdirSync(join(root, dir)).filter((f) => f.endsWith('.ts') && !f.includes('test')).map((f) => read(join(dir, f)))
    .flatMap((t) => [...t.matchAll(/label: \(title \|\| caseNo \|\| "Development record"\)\.slice\(0, (\d+)\)/g)].map((m) => Number(m[1])));
  ok(caps.length >= 5 && caps.every((n) => n === M.SOURCE_TITLE_CAP), '2f SOURCE_TITLE_CAP (' + M.SOURCE_TITLE_CAP + ') is the cap every connector stores a title at (' + caps.join(',') + ')', caps);
}

// ---- 3. minor building work: positive evidence required, significance always wins ---------------------------------------------------------------
{
  const minor = [
    'Single Family/Duplex Construct bathroom remodel in unit 1B1B in a mixed use building  subject to field inspection (STFI)',
    'Multifamily Construct interior kitchen remodel in existing condominium unit PH8  subject to field inspection  STFI.',
    'Multifamily Construct in-kind repairs to unit #208 in existing apartment building  subject to field inspection (STFI)',
    'Multifamily Construct alterations to unit #1000 in existing mixed use building  per plan.',
    'Multifamily STFI - interior remodel (finishes)  no structural or exterior work',
    'Multifamily Construct repairs to replace in kind fire rated assemblies  floor/wall and ceiling surfaces and finishes and',
    'Commercial Construct pergola at 4th floor of existing live/work and commercial building  occupy per plan.',
    'Building Replace 4 windows, like-for-like, at a residential home.at SF',
    'Building relocation of the gas meter',
  ];
  const development = [
    'Master Use Permit Land Use Application to allow an 8-story, 254-unit apartment building. Parking for 163 vehicles propos',
    'Multifamily Phased Permit: Construct a residential high rise building  occupy per plan. Mechanical included.',
    'Commercial PHASED PERMIT: Construct substantial alterations to a commercial office building for a mixed use -  multi-fam',
    'Multifamily Establish use as permanent supportive housing for 83 stacked dwelling units and human services facilities  p',
    'Commercial Demolish commercial warehouse building  per plan.',
    'Master Use Permit Shoreline Substantial Development application to allow installation of electrical vehicle chargers and',
    'Commercial Change of use to drinking establishment. Construct tenant improvement for bar (Saanj Wine Bar) at ground floo',
    'Building Construction of new duplex residential building. Each unit ap',
    'Residential construction: Toohey Plat, Lot 5',
    'Commercial construction',
    'SR 7/S 100th St to S of S 38th St - Paving & ADA Compliance HMA Inlay',
    '315 1ST AVE N',
    // a bare "repair" is not minor work: a business named for it, and a road or bridge repair (sampled nationally, 2026-11-01)
    'Auto & Boat Repair',
    'Hwys. 96 & 255 Flood Repairs (Sebastian Co.) (S)',
    // significance outranks a minor word in the same title
    'Construct new building addition and interior alterations to unit 4',
    'Demolish existing building and repair retaining wall',
  ];
  const wrongM = minor.filter((n) => M.workScope({ name: n, type_raw: null }).key !== 'minor_work');
  const wrongD = development.filter((n) => M.workScope({ name: n, type_raw: null }).key !== 'development');
  ok(wrongM.length === 0, '3a interior, single-unit and like-for-like repair permits are minor building work (' + minor.length + ')', wrongM);
  ok(wrongD.length === 0, '3b development, land-use, demolition, change-of-use, road and unstated records stay development, even when they also name a repair or an interior (' + development.length + ')', wrongD);
  ok(M.workScope({ name: 'SR-266; 200 W. Bridge Collision Repair, repairs to deck', type_raw: null }, 'infrastructure').key === 'development'
    && M.workScope({ name: 'Construct repairs to exterior of existing building', type_raw: null }, 'commercial').key === 'minor_work', '3c2 a road or bridge project is never minor building work, whatever its words; the same words on a building are');
  ok(M.workScope({ name: null, type_raw: null }).key === 'development' && M.workScope({ name: 'Water heater', type_raw: 'Mechanical' }).key === 'minor_work', '3c no words: development (positive evidence is required); the class field counts as the record\'s own words');
  ok(M.normalizeWords('Re-Roof, deck!') === ' re roof deck ' && !M.normalizeWords('decker').includes(' deck '), '3d one normalisation: phrases match whole words only');
  const fn = M.workScope.toString() + M.normalizeWords.toString();
  ok(!/zip|county|state|registry|source|seattle|tacoma|Date|now/i.test(fn), '3e the rule reads only the record\'s own words: no place, ZIP, source or clock', fn.length);
}

// ---- 4. the view: whose record, which record, shortened titles, and a separate minor section that keeps every record ----------------------------
{
  const P = (id, name, extra) => Object.assign({ project_id: id, name, type: { key: 'commercial', label: 'Commercial' }, lifecycle: { key: 'approved', label: 'Approved' },
    stage: { key: 'approved', label: 'Approved / Coming' }, publisher_stage: 'Issued', source: { url: 'https://example.gov/r/' + id, attribution: null, agency: 'City of Example', feed_ref: 'data.example.gov, dataset abcd-1234', record_id: id } }, extra || {});
  const projects = [
    P('A1', 'Construct a 10-story apartment building', { scope: { key: 'development' } }),
    P('A2', '315 1ST AVE N', { scope: { key: 'development' } }),
    P('A3', '315 1ST AVE N', { scope: { key: 'development' } }),
    P('A4', 'Construct bathroom remodel in unit 2 STFI', { scope: { key: 'minor_work', evidence: 'stfi' } }),
    P('A5', 'x'.repeat(119) + 'y', { title_cut: true, scope: { key: 'development' } }),
  ];
  const response = { status: 'OK', report: { radius_mi: 0.5, as_of: '2026-11-01T18:00:00Z', zip: '98121', recent_days: 90, projects,
    coverage: { source_feed_count: 1, limitations: [] }, sections: { by_stage: { approved: projects.map((p) => p.project_id), proposed: [], permitted: [] }, by_lifecycle: { approved: [], proposed: [], operating: [], unknown: [] }, what_changed_recently: [], recent_official_activity: [] } },
    render: { distances_mi: { A1: 0.1, A2: 0.2, A3: 0.2, A4: 0.3, A5: 0.4 }, bearings_deg: { A1: 0, A2: 90, A3: 90, A4: 180, A5: 270 } } };
  const m = V.read(response);
  ok(m && m.total === 5 && m.development === 4 && m.minor.length === 1 && m.minor[0].p.project_id === 'A4' && !m.nums.A4 && m.nums.A1 === 1, '4a the minor record leaves the development list and the map numbering, and stays in the report (total 5 = 4 + 1)', m && { total: m.total, dev: m.development, minor: m.minor.length });
  const h = V.html(response, { subject: '1 Main St, Example, WA 98121' });
  const minorSec = (h.match(/<section class="da-rv-sec da-rv-sec--minor"[\s\S]*?<\/section>/) || [''])[0];
  const devSec = (h.match(/<section class="da-rv-sec da-rv-sec--records"[\s\S]*?<\/section>/) || [''])[0];
  ok(minorSec.includes('Construct bathroom remodel in unit 2 STFI') && minorSec.includes('https://example.gov/r/A4') && !devSec.includes('bathroom remodel'), '4b the minor record is in its own section with its official link, and not in Nearby Development');
  ok(/5 official records within 0\.5 miles of this property\. 4 are development: /.test(h) && /The other 1 is minor building work \(interior, single-unit or like-for-like repair permits\), listed separately\./.test(h), '4c the briefing counts development and minor building work separately and the total is every record');
  ok(devSec.includes('315 1ST AVE N (record A2)') && devSec.includes('315 1ST AVE N (record A3)') && devSec.includes('Construct a 10-story apartment building</span>'), '4d records that share a title are told apart by the agency\'s record number; a unique title is left alone');
  ok(devSec.includes('x'.repeat(119) + 'y…') && /The source feed shortens this title\. The full description is in the official record\./.test(devSec), '4e a shortened title ends in an ellipsis and says the full description is in the official record');
  ok((devSec.match(/City of Example \(data\.example\.gov, dataset abcd-1234\)\./g) || []).length === 4 && /Agency record number:<\/span> A1/.test(devSec), '4f every row names its agency and dataset, and its agency record number');
  ok(/Official agency data in this report:<\/span> City of Example \(data\.example\.gov, dataset abcd-1234\)\./.test(h), '4g the coverage note names the agency');
  // an older saved report (no national-4 fields) reads exactly as before: no minor section, no record numbers, no shortened-title note
  const old = JSON.parse(JSON.stringify(response));
  old.report.projects.forEach((p) => { delete p.scope; delete p.title_cut; p.source = { url: p.source.url, attribution: 'Old credit.' }; });
  const ho = V.html(old, { subject: '1 Main St, Example, WA 98121' });
  ok(!/da-rv-sec--minor|Agency record number|shortens this title|\(record A2\)/.test(ho) && V.read(old).minor.length === 0 && V.read(old).total === 5, '4h a report saved before national-4 renders as it did');
}

console.log(`\n${total - fails} passed, ${fails} failed of ${total}`);
process.exit(fails ? 1 : 0);
