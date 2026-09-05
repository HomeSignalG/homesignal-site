#!/usr/bin/env node
// TERMINAL-NEUTRAL vs GENERIC — the distinction this suite exists to pin.
//
// WHY THIS EXISTS. Removing an unsupported Type is only half a correction: the record still
// has to LAND somewhere. `development`/`unclassified` are GENERIC and deliberately NON-TERMINAL,
// so a record routed there continues into KEYWORD/NAME inference and the classifier reads the
// PROPERTY's name. That turned "we proved this is not Civic" into "therefore it is Residential /
// Data center", which the evidence never supported: a sprinkler permit at an apartment is not a
// Residential development, and a fire-pump permit at a data centre is not a Data center project.
//
// The engine already writes ONE explicit terminal value — commercial-eligibility.ts's
// NON_QUALIFYING_COMMERCIAL_USE_TYPE ("other project"). It survived the keyword and name phases
// (TYPE_EXACT resolves it; GENERIC_EXACT omits it) but NOT statedDataCenter(), which runs before
// the TYPE_EXACT loop and reads the record NAME. So the terminal value leaked on exactly one Type.
// classifyProjectType now checks terminalNeutral() first, so terminal means terminal everywhere.
//
// This suite drives the SHIPPED classifier and asserts BOTH directions — the terminal state holds,
// AND generic inference is untouched. Either half alone would let the defect back in.
//
// Run: node test/terminal-neutral-type-state.test.mjs
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
const check = (name, cond, detail) => {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
};

global.window = {};
window.HS = {};
await import(join(root, 'lib/map.js'));
const HS = window.HS;
const REG = HS.CATEGORY_REGISTRY;
const TERMINAL = 'other project';

// The two REAL item shapes Map 1 classifies. ZIP mode builds sites in zipAuthSiteFromMarker
// (use_type = app_projects.type, type = lifecycle bucket); the cached report carries `layer`
// and `type_raw` too. A fallback field must not resurrect a Type on either path.
const zipSite = (useType, name) => ({ scope: 'point', relevance: 'development',
  bucket: 'proposed', type: 'proposed', use_type: useType, label: name });
const reportSite = (useType, name, typeRaw) => ({ scope: 'point', relevance: 'development',
  bucket: 'proposed', type: 'proposed', use_type: useType, layer: 'development',
  type_raw: typeRaw || '', label: name, title: name, name });

// Each row: [Type, exact source value, a name whose ONLY Type evidence is that name, key]
const TYPES = [
  ['Residential',    'residential',    'TOLL BROTHERS APARTMENT - BLD 1',    'residential'],
  ['Commercial',     'commercial',     'Airport Hotel Center',               'commercial'],
  ['Civic & public', 'civic/public',   'Del Valle High School',              'civic'],
  ['Data center',    'data center',    'IRON MOUNTAIN DATA CENTER - PUMP',   'datacenter'],
  ['Infrastructure', 'infrastructure', 'New water main replacement',         'infrastructure'],
  ['Industrial',     'industrial',     'Granite Warehouse',                  'industrial'],
];

console.log('\n-- 1. EXACT source types are unchanged (no frozen Type was redefined) --');
for (const [label, exact, , key] of TYPES) {
  const m = HS.resolveMarker(zipSite(exact, 'X'));
  check(`${label}: exact "${exact}" still resolves ${key}`, m.typeKey === key, String(m.typeKey));
}

console.log('\n-- 2. GENERIC still infers from the name (this behaviour is valuable, keep it) --');
for (const gen of ['Development', 'unclassified']) {
  for (const [label, , name, key] of TYPES) {
    const m = HS.resolveMarker(zipSite(gen, name));
    check(`${gen} + "${name.slice(0, 34)}" -> ${key}`, m.typeKey === key, String(m.typeKey));
  }
}

console.log('\n-- 3. TERMINAL-NEUTRAL never infers, for the SAME names --');
for (const [label, , name] of TYPES) {
  const z = HS.resolveMarker(zipSite(TERMINAL, name));
  const r = HS.resolveMarker(reportSite(TERMINAL, name));
  check(`${label}: terminal-neutral stays Other project (ZIP path)`,
    z.typeKey === 'other' && z.shape === 'circle' && z.legendLabel === 'Other project',
    `${z.typeKey}/${z.shape}`);
  check(`${label}: terminal-neutral stays Other project (report path)`,
    r.typeKey === 'other' && r.shape === 'circle', `${r.typeKey}/${r.shape}`);
}

console.log('\n-- 4. it beats statedDataCenter(), which runs before the TYPE_EXACT loop --');
{
  // The regression that motivated this: the ONLY inference that outranked the terminal value.
  const leak = HS.resolveMarker(zipSite(TERMINAL, 'IRON MOUNTAIN DATA CENTER - PUMP'));
  check('a data-centre NAME cannot re-type a terminal-neutral record',
    leak.typeKey === 'other', `${leak.typeKey} via ${leak.shapeRule}`);
  check('and the rule that answered is the terminal one',
    String(leak.shapeRule).startsWith('TERMINAL_NEUTRAL:'), String(leak.shapeRule));
  // Control: the SAME name on a generic type must still reach Data center, or this test
  // would pass simply because data-centre classification broke.
  const ctl = HS.resolveMarker(zipSite('Development', 'IRON MOUNTAIN DATA CENTER - PUMP'));
  check('CONTROL: the same name on a GENERIC type still resolves Data center',
    ctl.typeKey === 'datacenter', String(ctl.typeKey));
}

console.log('\n-- 5. an adversarial name carrying EVERY Type keyword still terminates --');
{
  const adv = 'IRON MOUNTAIN DATA CENTER hyperscale APARTMENT dwelling residential subdivision '
    + 'HOTEL retail commercial office WAREHOUSE industrial manufacturing factory FIRE STATION '
    + 'courthouse public library community center SCHOOL water main pipeline substation roadway '
    + 'right-of-way mixed-use';
  for (const [pathName, site] of [['ZIP', zipSite(TERMINAL, adv)], ['report', reportSite(TERMINAL, adv)]]) {
    const m = HS.resolveMarker(site);
    check(`${pathName} path: every-keyword name still resolves Other project`,
      m.typeKey === 'other', `${m.typeKey} via ${m.shapeRule}`);
  }
  // Same adversarial name on a generic type MUST classify — proving the name is really loaded.
  const ctl = HS.resolveMarker(zipSite('Development', adv));
  check('CONTROL: the adversarial name does classify when the type is generic',
    ctl.typeKey !== 'other', String(ctl.typeKey));
}

console.log('\n-- 6. the terminal state is honest about itself --');
{
  const m = HS.resolveMarker(zipSite(TERMINAL, 'COSTCO #465'));
  check('presentation is the existing honest neutral, not a new category',
    m.typeKey === 'other' && m.legendLabel === REG.other.label && m.shape === REG.other.symbol);
  check('carries a machine-readable reason naming the source decision',
    typeof m.fallbackReason === 'string' && /explicitly resolved no project type/.test(m.fallbackReason),
    String(m.fallbackReason));
  check('no new legend row was introduced',
    (HS.markerRegistry.shapeLegend || []).every((r) => REG[r.categoryKey]));
}

console.log('\n-- 7. the facility flag still outranks everything (untouched precedence) --');
{
  const m = HS.resolveMarker({ _facility: true, use_type: TERMINAL, label: 'IRON MOUNTAIN DATA CENTER' });
  check('regulated facility precedence is unchanged', m.typeKey === 'facility', String(m.typeKey));
}

if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log('\nAll terminal-neutral-type-state checks passed.');
