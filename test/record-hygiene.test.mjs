// Offline checks for sources/record-hygiene.ts and its wiring (Tacoma minor-repair filter, Pierce PALS
// applicant-named titles). Every string below is a REAL scope/title read from production
// development_reports on 2026-10-15 (Pierce County WA ZIP pages) unless marked SYNTHETIC.
import { readFileSync } from 'node:fs';
import {
  isMinorRepairNoise, cleanApplicantTitle, MINOR_REPAIR_PATTERN, DEVELOPMENT_OVERRIDE_PATTERN,
} from '../supabase/functions/get-address-report/sources/record-hygiene.ts';

let pass = 0, fail = 0;
const ok = (c, name, d) => { if (c) { pass++; console.log('  ✓ ' + name); } else { fail++; console.error('  ✗ ' + name + (d ? '\n     ' + d : '')); } };

// 1. noise is dropped
for (const t of [
  'Building - Install Rheem Gas Furnace with 80% AFUE and Midea EVOX Heat Pump at SFD - Install Rheem Model (R801V) 50,000 BTU Gas Furnace.',
  'Building - Replace existing Notifier fire alarm system with Potter equivalent devices - Install (1) relay',
  'Building Repair water damage to Units: 502, 402, and 302, common areas: Lobby, Leasing Office, and Two Bathrooms',
  'Building Re-roof of commercial building',
  'Building REROOF OF COMMERCIAL BUILDING.',
  'Building WHOLE REPIPE at CONDO A101 in MULTI-FAMILY BLDG.',
  'Building Roof Replacement at The Windsor Apartments.',
  'Building NON-STRUCTURAL FIRE DAMAGE REPAIRS TO EXISTING MAIN FLOOR - UNIT C-6 IN BUILDING C.',
]) ok(isMinorRepairNoise(t), 'drops: ' + t.slice(0, 70));

// 2. development evidence always wins (precision over recall)
for (const t of [
  'Building CONSTRUCTION OF 500 SF SINGLE-STORY ADDITION IN WEST END OF AN EXISTING 4,500 SF SINGLE-STORY WOOD-FR',
  'Building Remodel to include new furnace, water heater, fireplace insert, new front door',
  'Building Interior remodel at SFD including remodel and expand kitchen, New Primary bathroom',
  'Building New SFD with furnace and water heater (SYNTHETIC)',
  'Building Construct a 244SF addition to SFD, new garage with ADU above (SYNTHETIC)',
  'Building Demolition of the existing building and construct new mixed-use structure with heat pumps (SYNTHETIC)',
  'Building House FIRE REPAIR and Remodel at SFD - *** Plumbing Included, NO mechanical*** *Re-roofing',
]) ok(!isMinorRepairNoise(t), 'keeps: ' + t.slice(0, 70));

// 3. no text / unrelated text is never dropped (no evidence either way ⇒ keep)
ok(!isMinorRepairNoise(''), 'empty text kept');
ok(!isMinorRepairNoise(null), 'null text kept');
ok(!isMinorRepairNoise('Land Use 125,000 GROSS SQUARE FOOT, THREE-STORY, MEDICAL OFFICE BUILDING'), 'land use project kept');
ok(!isMinorRepairNoise('Site - Site Development associated with [scope of BLDRN26-0280]. Includes erosion control, sewer, water, storm'), 'site development kept ("sewer"/"water" alone are not minor-repair terms)');
// word edges: "furnace" inside another word does not fire
ok(!isMinorRepairNoise('Building Furnaceville Plaza tenant space (SYNTHETIC)'), 'word edge: Furnaceville is not furnace');

// 4. applicant-named titles — FOUNDER DECISION: individuals stripped, corporate kept, plat untouched.
const T = (a, b, want) => ok(cleanApplicantTitle(a, b) === want, `title ${JSON.stringify([a, b])} → ${want}`, 'got ' + cleanApplicantTitle(a, b));
// corporate applicants are kept and labelled
T('Construction Residential', '3705 Rental LLC', 'Residential construction (applicant: 3705 Rental LLC)');
T('Construction Residential', 'DELTA CARE LLC', 'Residential construction (applicant: Delta Care LLC)');
T('Construction Residential', 'Silverbow Farms LLC', 'Residential construction (applicant: Silverbow Farms LLC)');
T('Construction Commercial', 'James Hardie Building Products Inc', 'Commercial construction (applicant: James Hardie Building Products Inc)');
T('Construction Residential', 'Charismatic Divine Care Adult Family Home LLC', 'Residential construction (applicant: Charismatic Divine Care Adult Family Home LLC)');
T('Land Use Permit', 'Lake Properties LLC', 'Land use permit (applicant: Lake Properties LLC)');
T('Land Use Permit', 'Acme Holdings, LLC', 'Land use permit (applicant: Acme Holdings, LLC)');
T('Construction Residential', 'Northwest Builders', 'Residential construction (applicant: Northwest Builders)');
T('Construction Residential', 'Harbor Homes Group', 'Residential construction (applicant: Harbor Homes Group)');
// individual homeowners are stripped ENTIRELY (the founder's own example, and the shapes PALS actually files)
T('Construction Single Family Residence', 'Lucy Chege', 'Single Family Residence construction');
T('Construction Residential', 'Chege, Lucy', 'Residential construction');
T('Site Dev Residential', 'Bartels, Darren & Mary', 'Site dev residential');
T('Construction Residential', 'SMITH, JOHN', 'Residential construction');
T('Land Use Variance', 'Heade, Patrick & Heade, Linda of Heade Revocable Living Trust', 'Land use variance');
// THE REASON the entity words are word-bounded: unanchored, "co"/"inc"/"lp" sit inside ordinary names
for (const person of ['Jacob Lincoln', 'Rebecca Marco', 'Vincent Scott', 'Nicole Coleman', 'Alpine Smith'])
  T('Construction Residential', person, 'Residential construction');
// a person's name that ALSO carries an entity word is still a person
T('Construction Residential', 'Smith, John Homes', 'Residential construction');
// plat / subdivision text is left exactly as filed
T('Construction Residential', 'Lake Minterwood, Lot 38, Blk 2', 'Residential construction: Lake Minterwood, Lot 38, Blk 2');
T('Construction Residential', 'Tehaleh Phase 4 Division 2', 'Residential construction: Tehaleh Phase 4 Division 2');
// FAIL CLOSED: a project name that states no entity word cannot be told from a person, so it is dropped
T('Construction Commercial', 'Gig Harbor Medical Office', 'Commercial construction');
T('Accessory Dwelling Unit', '', 'Accessory dwelling unit');
T('Construction Residential', 'Construction Residential Silverbow Farms LLC', 'Residential construction (applicant: Silverbow Farms LLC)');
ok(cleanApplicantTitle('', 'Foo Holdings LLC') === 'Foo Holdings LLC', 'no type ⇒ a corporate name alone');
ok(cleanApplicantTitle('', 'Lucy Chege') === '', 'no type + individual ⇒ nothing');
ok(!/\bnew\b/i.test(cleanApplicantTitle('Construction Residential', '3705 Rental LLC')), 'never invents "new"');
// the privacy property itself: across every individual-shaped input, no part of the name survives
for (const [ty, nm] of [['Construction Residential', 'Lucy Chege'], ['Construction Residential', 'Chege, Lucy'], ['Land Use Variance', 'Heade, Patrick & Heade, Linda'], ['Construction Residential', 'Jacob Lincoln']])
  ok(!nm.split(/[^A-Za-z]+/).filter(w => w.length > 2).some(w => cleanApplicantTitle(ty, nm).includes(w)), `no part of "${nm}" survives`);

// 5. wiring: both options are DECLARED by the connector (a typo'd key is silently ignored otherwise), used by
//    exactly the intended entries, and the SQL audit evaluates the SAME pattern strings.
const src = readFileSync(new URL('../supabase/functions/get-address-report/sources/arcgis.ts', import.meta.url), 'utf8');
ok(/\n  drop_minor_repairs\?: \{ types: string\[\] \};/.test(src), 'arcgis.ts declares drop_minor_repairs');
ok(/\n  applicant_title\?: \{ type: string; name: string \};/.test(src), 'arcgis.ts declares applicant_title');
ok(/isMinorRepairNoise\(String\(readCol\(row, cm\.title\)/.test(src), 'normalizeRow applies the filter to the title text');
const reg = JSON.parse(readFileSync(new URL('../supabase/functions/get-address-report/jurisdiction-registry.json', import.meta.url), 'utf8'));
const all = []; (function walk(o) { if (o && typeof o === 'object') { if (o.registry_id) all.push(o); Object.values(o).forEach(walk); } })(reg);
const withDrop = all.filter(e => e.drop_minor_repairs).map(e => e.registry_id);
const withApp = all.filter(e => e.applicant_title).map(e => e.registry_id);
ok(JSON.stringify(withDrop) === '["tacoma-accela-permits"]', 'only Tacoma drops minor repairs', JSON.stringify(withDrop));
ok(JSON.stringify(withApp) === '["pierce-county-pals-permits"]', 'only Pierce PALS rewrites applicant titles', JSON.stringify(withApp));
const tac = all.find(e => e.registry_id === 'tacoma-accela-permits');
ok(tac.drop_minor_repairs.types.every(t => Object.keys(tac.type_map).includes(t)), 'Tacoma drop types are real mapped types');
const sql = readFileSync(new URL('../scripts/audits/pierce-county-launch-audit.sql', import.meta.url), 'utf8');
ok(sql.includes(MINOR_REPAIR_PATTERN) && sql.includes(DEVELOPMENT_OVERRIDE_PATTERN), 'audit SQL carries the identical pattern strings');


// 6. END TO END through the shipped connector (stubbed server): the options act, and are inert when absent.
{
  const { arcgisForZip } = await import('../supabase/functions/get-address-report/sources/arcgis.ts');
  const feat = (id, type, desc, extra = {}) => ({ attributes: { OBJECTID: id, permit_type: type, description: desc,
    current_status: 'Finaled', application_date: 1760000000000, permit_number: 'P' + id, link: 'https://aca.example/' + id,
    address_line_1: id + ' PACIFIC AVE', latitude: 47.25, longitude: -122.44, zip: '98402', ...extra } });
  const feats = [
    feat(1, 'Building', 'Install Rheem Gas Furnace and Heat Pump at SFD'),
    feat(2, 'Building', 'New SFD with furnace and water heater'),
    feat(3, 'Land Use', 'Furnace Road lot segregation'),
    feat(4, 'Building', 'Construct a 244SF addition to SFD'),
  ];
  const stub = async () => new Response(JSON.stringify({ objectIdFieldName: 'OBJECTID', geometryType: 'esriGeometryPoint',
    fields: [], features: feats.map(f => ({ ...f, geometry: { x: -122.44, y: 47.25 } })), exceededTransferLimit: false }),
    { status: 200, headers: { 'content-type': 'application/json' } });
  const entry = { registry_id: 'tacoma-accela-permits', platform: 'arcgis', service_url: 'https://example.invalid/FeatureServer/0',
    dataset_url: 'https://example.invalid/d', jurisdiction: 'City of Tacoma', coverage: [{ state: 'WA', county: 'Pierce' }],
    column_map: { title: ['permit_type', 'description'], status_raw: 'current_status', type_source: 'permit_type', file_date: 'application_date',
      address: 'address_line_1', lat: 'latitude', lng: 'longitude', case_number: 'permit_number', zip: 'zip', record_url: 'link' },
    status_to_bucket: { proposed: [], approved: [], operating: ['Finaled'], exclude: [] },
    type_map: { Building: 'Development', 'Land Use': 'Development' } };
  const wa = [{ state: 'WA', county: 'Pierce' }];
  const deps = { fetch: stub, zipCentroid: { lat: 47.25, lng: -122.44 } };
  const off = await arcgisForZip('98402', wa, [entry], deps);
  ok(off.sites.length === 4 && off.reports[0].minor_repairs_dropped === 0, 'option absent ⇒ all 4 records, nothing dropped', JSON.stringify(off.reports[0].quarantined));
  const on = await arcgisForZip('98402', wa, [{ ...entry, drop_minor_repairs: { types: ['Building'] } }], deps);
  const ids = on.sites.map(s => s.case_number).sort().join(',');
  ok(ids === 'P2,P3,P4', 'furnace swap dropped; new SFD, Land Use "Furnace Road" and addition kept', ids);
  ok(on.reports[0].minor_repairs_dropped === 1, 'the drop is counted in the run report');
  const pals = { registry_id: 'pierce-county-pals-permits', platform: 'arcgis', service_url: 'https://example.invalid/FeatureServer/0',
    dataset_url: 'https://example.invalid/d', jurisdiction: 'Pierce County (PALS)', coverage: [{ state: 'WA', county: 'Pierce' }],
    column_map: { title: ['applicationType', 'projectName'], status_raw: 'applicationStatus', type_source: 'applicationType', file_date: 'applicationDate',
      address: 'siteAddress', lat: 'latitude', lng: 'longitude', case_number: 'applicationNumber', record_url: 'urlOnlinePermits' },
    status_to_bucket: { proposed: [], approved: ['Issued'], operating: [], exclude: [] }, type_map: { 'Construction Residential': 'Residential' },
    spatial_zip_radius_mi: 3 };
  const pf = [{ attributes: { OBJECTID: 9, applicationType: 'Construction Residential', projectName: '3705 Rental LLC', applicationStatus: 'Issued',
    applicationDate: 1760000000000, siteAddress: '3705 S 1ST ST', latitude: 47.2, longitude: -122.4, applicationNumber: 'R9', urlOnlinePermits: 'https://pals.example/R9' },
    geometry: { x: -122.4, y: 47.2 } }];
  const pstub = async () => new Response(JSON.stringify({ objectIdFieldName: 'OBJECTID', geometryType: 'esriGeometryPoint', fields: [], features: pf, exceededTransferLimit: false }),
    { status: 200, headers: { 'content-type': 'application/json' } });
  const pdeps = { fetch: pstub, zipCentroid: { lat: 47.2, lng: -122.4 } };
  const before = await arcgisForZip('98402', wa, [pals], pdeps);
  const after = await arcgisForZip('98402', wa, [{ ...pals, applicant_title: { type: 'applicationType', name: 'projectName' } }], pdeps);
  const personFeat = [{ ...pf[0], attributes: { ...pf[0].attributes, OBJECTID: 10, projectName: 'Chege, Lucy', applicationNumber: 'R10' } }];
  const person = await arcgisForZip('98402', wa, [{ ...pals, applicant_title: { type: 'applicationType', name: 'projectName' } }],
    { fetch: async () => new Response(JSON.stringify({ objectIdFieldName: 'OBJECTID', geometryType: 'esriGeometryPoint', fields: [], features: personFeat, exceededTransferLimit: false }), { status: 200, headers: { 'content-type': 'application/json' } }), zipCentroid: { lat: 47.2, lng: -122.4 } });
  const leaked = JSON.stringify(person.sites);
  ok(person.sites.length === 1 && !/Chege|Lucy/.test(leaked), 'END TO END: an individual applicant appears nowhere in the emitted record (title, label, source_id, ...)', leaked.slice(0, 200));
  ok(before.sites[0]?.title === 'Construction Residential 3705 Rental LLC', 'option absent ⇒ the raw joined title, unchanged', before.sites[0]?.title);
  ok(after.sites[0]?.title === 'Residential construction (applicant: 3705 Rental LLC)', 'option present ⇒ readable title', after.sites[0]?.title);
  ok(after.sites[0]?.label === after.sites[0]?.title && after.sites[0]?.type_raw === 'Construction Residential', 'label follows the title; raw permit type survives in type_raw');
  ok(after.sites[0]?.source_id === before.sites[0]?.source_id, 'record identity (source_id) is unchanged by the title rewrite');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
