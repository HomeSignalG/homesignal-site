// HEAVY FACILITIES ARE INDUSTRIAL, AND EACH KIND HAS ITS OWN IMPACT SENTENCE (founder, 2026-11-01).
//
// "classify them as industrial and give them each their own impact sentence": landfills, quarries/mines, burning
// (incinerator, pyrolysis, waste-to-energy) and solid-waste transfer stations. ONE decision lives in lib/project-type.js
// (heavyFacilityKind, precedence 2.5 in classifyProjectType); the engine reads the generated copy and passes type.kind;
// lib/da-report-view.js turns the kind into the sentence. Every positive and negative name below is a real production
// app_projects name (read 2026-11-01), so the guards are proven against the false positives that actually exist.
// Run: node test/heavy-facility-type.test.mjs
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
let bad = 0;
const ok = (c, m, d) => { if (c) console.log('PASS — ' + m); else { bad++; console.log('FAIL — ' + m + (d !== undefined ? '  [' + JSON.stringify(d) + ']' : '')); } };

const sb = { window: {} }; sb.window.window = sb.window;
runInNewContext(read('lib/project-type.js'), sb);
const HS = Object.assign({}, sb.window.HS, { heavyFacilityKind: sb.window.HS.projectType.heavyFacilityKind, HEAVY_FACILITY_KINDS: sb.window.HS.projectType.HEAVY_FACILITY_KINDS });
const vb = { window: {} };
runInNewContext(read('lib/da-report-view.js'), vb);
const V = vb.window.HS.daReportView;

// §1 positives: the kind, Industrial, and the shape rule — whatever bucket the source used
const POS = [
  ['Puyallup Closed Landfill Maintenance Project', 'Development', 'landfill'],
  ['Bismarck Landfill Expansion', 'Commercial', 'landfill'],
  ['WM Sand and Gravel', 'Industrial', 'quarry'],
  ['HILLTOP SAND & GRAVEL COMPANY', 'Development', 'quarry'],
  ['Sand & Gravel Mine', 'Industrial', 'quarry'],
  ['Limestone quarry expansion', '', 'quarry'],
  ["Commercial 40' X 40' CONCRETE PAD FOR NEW INCINERATOR", 'Commercial', 'burning'],
  ['Waste-to-Energy facility', 'Development', 'burning'],
  ['Plastic pyrolysis plant', '', 'burning'],
  ['Solid Waste Transfer Station', 'Utility', 'transfer'],
  ['Mark II Transfer Station Special Use Permit WM Mark II (Waste Management)', 'Development', 'transfer']
];
for (const [name, type, kind] of POS) {
  const r = HS.classifyProjectType({ type, use_type: type, name, title: name, label: name });
  ok(HS.heavyFacilityKind({ type, name }) === kind && r.typeKey === 'industrial' && r.shapeRule === 'HEAVY:' + kind && r.facilityKind === kind,
    '1 ' + kind + ' → Industrial: ' + name + ' [' + type + ']', r);
}

// §2 negatives: street, creek, place and passing references are not facilities
const NEG = [
  ['Residential 2200 Landfill Rd', 'Residential'], ['Concrete hauled to the county landfill', 'Development'],
  ['SFR 100 Rock Quarry Road', 'Residential'], ['The Terrace at Rock Quarry', 'Residential'], ['Rock Quarry Tennis courts', ''],
  ['Gravel Pit Interchange improvements', 'Utility'], ['Stone Quarry Creek culvert', 'Utility'], ['Bitcoin mining container', 'Commercial'],
  ['Data mining office tenant improvement', 'Commercial'], ['12 Transfer Station Road SFR', 'Residential'],
  ['FIRE OPEN BURNING 4510 SW H ST', 'unclassified'], ['Mechanical Permit Adding burner and gas piping', 'Development'],
  ['Application for gravel parking on M1/M2', 'Development'], ['Residential 385 AUBURN LN NW', 'Residential']
];
for (const [name, type] of NEG) {
  const r = HS.classifyProjectType({ type, use_type: type, name, title: name, label: name });
  ok(HS.heavyFacilityKind({ type, name }) === null && !/^HEAVY:/.test(r.shapeRule) && !r.facilityKind, '2 not a heavy facility: ' + name, r);
}

// §3 a stated data centre still wins; canonicalProjectType carries the kind only when set
ok(HS.classifyProjectType({ type: 'Data Center', name: 'Data center next to landfill' }).typeKey === 'datacenter', '3a a stated data centre outranks the heavy-facility rule');
const cpt = HS.canonicalProjectType({ type: 'Utility', name: 'Solid Waste Transfer Station' });
ok(cpt && cpt.typeKey === 'industrial' && cpt.facilityKind === 'transfer', '3b canonicalProjectType carries facilityKind', cpt);
const plain = HS.canonicalProjectType({ type: 'Residential', name: 'New single family home' });
ok(plain && Object.keys(plain).join() === 'typeKey,label', '3c every other record answers exactly as before', plain);

// §4 the report: one sentence per kind, each ending in the not-verified clause; old saved reports unchanged
const texts = {};
for (const k of HS.HEAVY_FACILITY_KINDS) texts[k] = V.qolImpact({ type: { key: 'industrial', label: 'Industrial', kind: k }, lifecycle: { key: 'proposed' } }).text;
const industrial = V.qolImpact({ type: { key: 'industrial', label: 'Industrial' }, lifecycle: { key: 'proposed' } }).text;
ok(HS.HEAVY_FACILITY_KINDS.join() === 'burning,landfill,quarry,transfer', '4a the four kinds', HS.HEAVY_FACILITY_KINDS);
ok(new Set(Object.values(texts).concat(industrial)).size === 5, '4b each kind has its own sentence, none equal to the Industrial one', texts);
ok(Object.values(texts).every((t) => /^Potential /.test(t) && / Not site-verified; no effect is established\.$/.test(t)), '4c every sentence is a potential consideration, not a finding');
ok(/odor/.test(texts.landfill) && /groundwater/.test(texts.landfill) && /blasting/.test(texts.quarry) && /wells/.test(texts.quarry)
  && /smoke/.test(texts.burning) && /ash/.test(texts.burning) && /odor/.test(texts.transfer), '4d the sentences name the founder\'s considerations');
ok(V.qolImpact({ type: { key: 'commercial', kind: 'landfill' }, lifecycle: { key: 'proposed' } }).text === V.qolImpact({ type: { key: 'commercial' }, lifecycle: { key: 'proposed' } }).text,
  '4e a kind on a non-Industrial type is ignored');
ok(V.qolImpact({ type: { key: 'industrial', kind: 'bogus' }, lifecycle: { key: 'proposed' } }).text === industrial, '4f an unknown kind falls back to the Industrial sentence');

// §5 the engine passes the kind; the generated copy is current
const nr = read('supabase/functions/_shared/national-report.ts');
ok(/type: t \? \{ key: t\.typeKey, label: t\.label, \.\.\.\(t\.facilityKind \? \{ kind: t\.facilityKind \} : \{\}\) \}/.test(nr), '5a national-report passes type.kind only when set');
ok(read('supabase/functions/_shared/project-type.generated.js').includes(read('lib/project-type.js').trim().slice(200, 2000)) && /heavyFacilityKind/.test(read('supabase/functions/_shared/project-type.generated.js')),
  '5b the engine copy carries heavyFacilityKind');

console.log(bad ? '\n' + bad + ' FAILED' : '\nall passed');
process.exit(bad ? 1 : 0);
