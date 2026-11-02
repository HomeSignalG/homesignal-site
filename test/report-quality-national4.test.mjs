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
  ok(JSON.stringify(M.publisherOf('seattle-land-use-permits')) === JSON.stringify({ agency: 'City of Seattle', dataset: 'data.seattle.gov, dataset ht3q-kdvx', status_const: null, date_label: null })
    && M.publisherOf('wa-ecology-sepa-register').agency === 'Washington State Department of Ecology (SEPA Register)'
    && M.publisherOf('wa-ecology-sepa-register').dataset === 'data.wa.gov, dataset mmcb-z6jf', '1c the two sources the Seattle sample named nobody for now name their agency and dataset');
  ok(JSON.stringify(M.publisherOf('no-such-source')) === JSON.stringify({ agency: null, dataset: null, status_const: null, date_label: null }) && M.publisherOf(null).agency === null, '1d a source the registry does not know names no agency (never a guess)');
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
// national-6 (2026-11-02): M.workScope() is retired. Its successor is M.relevance(), which keeps the same evidence words: minor work is now
// reason 'routine_work' and is left out of the report (kept in intelligence.relevance_review), and a record whose words establish no
// neighborhood-facing change is 'not_established' (also left out, never called routine). Full rule: test/report-quality-national6.test.mjs.
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
    // significance outranks a minor word in the same title
    'Construct new building addition and interior alterations to unit 4',
    'Demolish existing building and repair retaining wall',
  ];
  // national-6 (2026-11-02): these named no minor-work evidence and so were 'development' under workScope. Under relevance() their words
  // establish no nearby change on their own, so they are 'not_established' (left out, flagged for review). What still holds is the
  // national-4 point: a bare "repair", an address or an unstated record is never called minor/routine work.
  const unstated = [
    'Residential construction: Toohey Plat, Lot 5',
    'Commercial construction',
    'SR 7/S 100th St to S of S 38th St - Paving & ADA Compliance HMA Inlay',
    '315 1ST AVE N',
    'Auto & Boat Repair',
    'Hwys. 96 & 255 Flood Repairs (Sebastian Co.) (S)',
  ];
  const R = (n, t) => M.relevance({ name: n, type_raw: null }, t);
  const wrongM = minor.filter((n) => R(n).reason !== 'routine_work');
  const wrongD = development.filter((n) => R(n).include !== true);
  const wrongU = unstated.filter((n) => R(n).reason === 'routine_work' || R(n).include === true);
  ok(wrongM.length === 0, '3a interior, single-unit and like-for-like repair permits are routine work (' + minor.length + ')', wrongM);
  ok(wrongD.length === 0, '3b development, land-use, demolition and change-of-use records are included, even when they also name a repair or an interior (' + development.length + ')', wrongD);
  ok(wrongU.length === 0 && unstated.every((n) => R(n).reason === 'not_established'), '3b2 a bare "repair", an address or an unstated record is never called routine work: its relevance is not established (' + unstated.length + ')', wrongU);
  ok(R('SR-266; 200 W. Bridge Collision Repair, repairs to deck', 'infrastructure').include === true
    && R('Construct repairs to exterior of existing building', 'commercial').include === false, '3c2 a road or bridge project is never minor building work, whatever its words; the same words on a building are not included');
  ok(R(null).reason === 'not_established' && M.relevance({ name: 'Water heater', type_raw: 'Mechanical' }).reason === 'routine_work', '3c no words: not established (positive evidence is required); the class field counts as the record\'s own words');
  ok(M.normalizeWords('Re-Roof, deck!') === ' re roof deck ' && !M.normalizeWords('decker').includes(' deck '), '3d one normalisation: phrases match whole words only');
  // national-6 (2026-11-02): relevance() passes registry_id through to the canonical residential rule (a founder-bounded development-class
  // source family, 2026-09-06), so "registry" and "source" now appear by design; the place / ZIP / clock half of the check still holds.
  const fn = (M.relevance.toString() + M.normalizeWords.toString()).replace(/\/\/[^\n]*/g, '');
  ok(!/zip|county|seattle|tacoma|Date|now\(/i.test(fn), '3e the rule reads only the record\'s own words (and the residential rule\'s source family): no place, ZIP or clock', fn.match(/zip|county|seattle|tacoma|Date|now\(/i));
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
  // national-6 (2026-11-02): a routine (minor_work) record is no longer listed apart: it is hidden from every section, the map and the counts
  // (the engine keeps it in intelligence.relevance_review). Was: a separate "minor building work" section. See test/report-quality-national6.test.mjs.
  ok(m && m.total === 4 && m.development === 4 && m.hiddenRoutine === 1 && !m.nums.A4 && m.nums.A1 === 1, '4a the routine record leaves the list, the map numbering and the counts (4 shown, 1 hidden)', m && { total: m.total, dev: m.development, hidden: m.hiddenRoutine });
  const h = V.html(response, { subject: '1 Main St, Example, WA 98121' });
  const devSec = (h.match(/<section class="da-rv-sec da-rv-sec--records"[\s\S]*?<\/section>/) || [''])[0];
  ok(!/da-rv-sec--minor/.test(h) && !h.includes('bathroom remodel') && !h.includes('https://example.gov/r/A4') && devSec.includes('https://example.gov/r/A1'), '4b the routine record appears nowhere in the report (no minor section, no title, no link)');
  ok(/4 official records within 0\.5 miles of this property document a nearby change: /.test(h) && !/minor building work/.test(h), '4c the briefing counts only the records that document a nearby change');
  ok(devSec.includes('315 1ST AVE N (record A2)') && devSec.includes('315 1ST AVE N (record A3)') && devSec.includes('Construct a 10-story apartment building</span>'), '4d records that share a title are told apart by the agency\'s record number; a unique title is left alone');
  // national-6 (2026-11-02): the view shortens long titles at a word (TITLE_MAX) and the note says "description"
  ok(/<span class="da-rv-name">Xx+…<\/span>/.test(devSec) && /The source feed shortens this description\. The full description is in the official record\./.test(devSec), '4e a shortened title ends in an ellipsis and says the full description is in the official record');
  ok((devSec.match(/City of Example \(data\.example\.gov, dataset abcd-1234\)\./g) || []).length === 4 && /Agency record number:<\/span> A1/.test(devSec), '4f every row names its agency and dataset, and its agency record number');
  ok(/Official agency data in this report:<\/span> City of Example \(data\.example\.gov, dataset abcd-1234\)\./.test(h), '4g the coverage note names the agency');
  // an older saved report (no national-4 fields) reads exactly as before: no minor section, no record numbers, no shortened-title note
  const old = JSON.parse(JSON.stringify(response));
  old.report.projects.forEach((p) => { delete p.scope; delete p.title_cut; p.source = { url: p.source.url, attribution: 'Old credit.' }; });
  const ho = V.html(old, { subject: '1 Main St, Example, WA 98121' });
  // national-6 (2026-11-02): with no scope field nothing is hidden as routine, so all 5 show (there is no minor section in any report now)
  ok(!/da-rv-sec--minor|Agency record number|shortens this|\(record A2\)/.test(ho) && V.read(old).hiddenRoutine === 0 && V.read(old).total === 5, '4h a report saved before national-4 renders as it did');
}

console.log(`\n${total - fails} passed, ${fails} failed of ${total}`);
process.exit(fails ? 1 : 0);
