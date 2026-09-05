// REGULATED FACILITY TYPE — the label a resident reads must not out-claim its evidence.
//
// Map 1's `Regulated facility` Type carries exactly one piece of type evidence per record:
// the EPA FRS facility NAME. `homesignalmap.html::facilityType()` normalises that name into a
// friendly label, and that label is what the popup, the list rail, the 3D sprite and the
// focus card all render (lines 869 / 881 / 1972 / 2529).
//
// THE DEFECT THIS PINS. The function used to end
//     return LAYER_LABEL[s.layer] || "Industrial facility";
// and `s.layer` is itself a keyword guess (index.ts::classifyLayer) that DEFAULTS to
// "industrial". Measured against production 2026-09-05: 31,169 of ~113,895 regulated sites
// (27.4%) reached that default, and the bucket contained turkey processing, a Del Monte foods
// plant, a Union Pacific rail yard, a university heating plant and road/utility construction
// permits — every one of them shown to a resident as "Industrial".
//
// The suite runs the SHIPPED function, extracted from homesignalmap.html's own source text, so
// it cannot drift from what the page renders. Every input below is a real production
// `app_projects.name` value.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('FAIL ' + m); } };

const page = readFileSync(join(root, 'homesignalmap.html'), 'utf8');

function span(opener, closer, label) {
  const i = page.indexOf(opener);
  if (i < 0) throw new Error(`homesignalmap.html no longer contains ${label}`);
  const j = page.indexOf(closer, i + opener.length);
  if (j < 0) throw new Error(`${label} span is unterminated`);
  return page.slice(i, j + closer.length);
}

const frsRidSrc = span('function frsRid(s){', '}\n', 'frsRid');
const facilityTypeSrc = span('function facilityType(s){', '\n  }', 'facilityType');

// stageWord is only reachable for NON-FRS points (permit filings), which this Type is not;
// it is stubbed so a change there can never silently pass as a facility-label change.
const shipped = new Function(
  `${frsRidSrc}\n` +
  `function stageWord(){ return "__STAGE_WORD__"; }\n` +
  `${facilityTypeSrc}\n` +
  'return facilityType;')();

const t = (name) => shipped({ registry_id: '110000000001', label: name });

// ── 1. the fallback no longer asserts a kind ─────────────────────────────────
// Every one of these is a real production name that landed in the "Industrial" default.
const NO_SIGNAL = [
  'UNION PACIFIC RAILROAD - CLEARFIELD YARD',
  '2024 ROAD & UTILITY PROJECT',
  '14600 S RAILROAD CROSSING',
  'CEDAR CITY ABANDONED UP RAILROAD ROW',
  'JEFFERSON UTILITY IMPROVEMENTS',
  'LAKE BOYNTON ESTATES UTILITY IMPROVEMENTS',
  'NORTH CAROLINA STATE PORTS AUTHORITY - NORTH PROPERTY RAIL STORAGE YARD',
  'OFF RAILROAD BRIDGE IN NIANTIC RIVER',
  'RIDGEFIELD RAILROAD ENGINE SERVICE AREA',
  'RED MILLS CONVENIENCE CENTER INC',
  'GYPSUM MILLS MOBILE HOME PARK',
  'COLEMAN AEROSPACE',
  'BE AEROSPACE INC',
];
for (const n of NO_SIGNAL) {
  ok(t(n) === 'Regulated facility', `1: no-signal name is not given a kind — ${n} -> ${t(n)}`);
}
ok(!NO_SIGNAL.some((n) => t(n) === 'Industrial'),
  '1: not one no-signal production name is still called Industrial');

// ── 2. material sourced labels survive, unchanged ────────────────────────────
const SOURCED = [
  ['ALIGNED DATA CENTER SLC-4',                    'Data center'],
  ['BLUFFDALE SAND QUARRY',                        'Aggregate / gravel'],
  ['BAUER READY MIX CONCRETE',                     'Concrete / asphalt'],
  ['BARON WOOLEN MILLS INCORPORATED',              'Textile mill'],
  ['ANDERSON LUMBER',                              'Lumber / planing mill'],
  ['ARBUCKLE SHEET METAL, INC',                    'Metal works'],
  ['BRIGHAM CITY WASTEWATER TREATMENT PLANT',      'Water treatment'],
  ['BOUNTIFUL CITY LIGHT & POWER',                 'Energy / power'],
  ['CAMBRIA DISTRIBUTION CENTER',                  'Logistics / warehouse'],
  ['BORDEN MEADOW GOLD DAIRY',                     'Food / ag processing'],
  ['AMERICAN CHEMICAL LLC',                        'Chemical / refining'],
  ['BEAR RIVER RECYCLING CORP',                    'Waste / recycling'],
];
for (const [n, want] of SOURCED) {
  ok(t(n) === want, `2: ${n} -> ${want} (got ${t(n)})`);
}

// ── 3. a mill in a PLACE NAME is not a mill ──────────────────────────────────
for (const n of ['MILL POND RACE', 'BARNES MILL ROAD IMPROVEMENTS', 'MILL RD AT KILMER BROOK',
                 'FORT MILL COMMERCIAL DEVELOPMENT', 'ADDITION TO SHELTON MILL TOWNHOMES',
                 'GRANTS MILL RD & MERCEDES DR-ENTRANCE LOT DEVELOPMENT',
                 'MAGNOLIA PARK AT MUNDY MILL PHASE 2 - LOT 32B']) {
  ok(t(n) === 'Regulated facility', `3: toponym mill demoted — ${n} -> ${t(n)}`);
}
for (const n of ['SPINTEX MILL', 'GERDAU TAMPA MILL', 'HAMMER MILL', 'MFGR PAPER MILL',
                 'U S SUGAR CORP BRYANT MILL', 'WASHINGTON ST MILL LLC']) {
  ok(t(n) === 'Mill', `3: real mill kept — ${n} -> ${t(n)}`);
}

// ── 4. the two recoveries, each measured before it was added ─────────────────
ok(t('NY8 - ELP STILLWATER WIND') === 'Energy / power', '4: wind is Energy / power');
ok(t('ACME DATACENTER LLC') === 'Data center', '4: one-word datacenter is Data center');

// ── 4b. a PLACE called *water* is not a water facility ───────────────────────
// `water` was unbounded and sat above the energy/waste rules, so these production names
// were all labelled "Water treatment". 143 of 5,740 lower-half matches were released by
// bounding it; not one released name is a water facility.
ok(t('NY8 - ELP STILLWATER SOLAR') === 'Energy / power', '4b: STILLWATER SOLAR is energy');
ok(t('EAST BRIDGEWATER SOLAR') === 'Energy / power', '4b: BRIDGEWATER SOLAR is energy');
ok(t('WATERTOWN SANITARY LANDFILL') === 'Waste / recycling', '4b: WATERTOWN LANDFILL is waste');
ok(t('SCA LANDFILL / WATERTOWN') === 'Waste / recycling', '4b: WATERTOWN landfill is waste');
ok(t('CLEARWATER MANUFACTURING CO.') === 'Industrial', '4b: CLEARWATER MANUFACTURING is industrial');
ok(t('FORMER BRIDGEWATER DAIRY FARM') === 'Food / ag processing', '4b: BRIDGEWATER DAIRY is food/ag');
ok(t("WATERBURY PLANT - BEN & JERRY'S") === 'Regulated facility', '4b: WATERBURY PLANT claims nothing');
// ...while real water facilities are untouched, including the compound forms.
ok(t('BRIGHAM CITY WASTEWATER TREATMENT PLANT') === 'Water treatment', '4b: wastewater kept');
ok(t('SARASOTA COUNTY STORMWATER ENVIR UTILITY') === 'Water treatment', '4b: stormwater kept');
ok(t('BIG TWELVE WATER ASSN-TREATMENT PLANT') === 'Water treatment', '4b: whole-word water kept');
ok(t('3 KINGS WATER TREATMENT PLANT') === 'Water treatment', '4b: water treatment kept');

// ── 5. self-described industrial operators keep a true label ─────────────────
for (const n of ['MORGAN INDUSTRIES INC', 'M.G. MANUFACTURING LLC', 'UTAH INDUSTRIAL DEPOT',
                 'GLOBAL INDUSTRIES LLC', 'ROBERTS MANUFACTURING']) {
  ok(t(n) === 'Industrial', `5: self-described industrial — ${n} -> ${t(n)}`);
}
// ...but `plant` alone must NOT buy that label back, or the defect returns by another door.
ok(t('BYU CENTRAL HEATING PLANT') === 'Regulated facility',
  '5: a generic "plant" is not evidence of industry');
ok(t('DEL MONTE FOODS PLANT #140') === 'Regulated facility',
  '5: a foods plant is not asserted industrial');

// ── 6. the label never invents, and never replaces the name ──────────────────
ok(t('') === 'Regulated facility', '6: an empty name yields the honest label, not a guess');
ok(t('   ') === 'Regulated facility', '6: whitespace yields the honest label');
ok(t('ZZZQ 4471') === 'Regulated facility', '6: an opaque name yields the honest label');
// determinism
ok(t('SPINTEX MILL') === t('SPINTEX MILL'), '6: deterministic');
ok(t('spintex mill') === t('SPINTEX MILL'), '6: case-insensitive, same verdict');

// ── 7. the dead LAYER_LABEL dependency is gone ───────────────────────────────
// It was the mechanism of the defect: a layer guess promoted to a user-facing claim.
ok(!facilityTypeSrc.includes('LAYER_LABEL'),
  '7: facilityType no longer reads the layer guess');
ok(!facilityTypeSrc.includes('Industrial facility'),
  '7: the hardcoded "Industrial facility" default is gone');
// s.layer must not influence the label at all any more.
ok(shipped({ registry_id: '1', label: 'ZZZQ 4471', layer: 'industrial' }) === 'Regulated facility',
  '7: a stored layer of "industrial" no longer produces an Industrial label');
ok(shipped({ registry_id: '1', label: 'ZZZQ 4471', layer: 'datacenter' }) === 'Regulated facility',
  '7: a stored layer of "datacenter" no longer produces a Data center label');

// ── 8. a non-FRS point is still not a facility ───────────────────────────────
ok(shipped({ label: 'SOME PERMIT FILING' }) === '__STAGE_WORD__',
  '8: a point with no FRS registry id is still labelled by lifecycle stage, not as a facility');

// ── 9. GEOGRAPHY, the two modes, pinned separately ──────────────────────────
// They are different contracts and must never be proven together.
const engine = readFileSync(join(root, 'supabase/functions/get-address-report/index.ts'), 'utf8');

// ADDRESS MODE — origin is the geocoded HOME, extent is the radius the resident picked.
ok(/\[lat, lng, matched\] = await geocode\(address\)/.test(engine),
  '9 addr: HOME comes from geocoding the entered address');
ok(/const radiusMi = Math\.min\(Math\.max\(Number\(body\.radius_mi\)/.test(engine),
  '9 addr: the extent is the radius_mi the page sent, not a constant');
ok(/facilitySites\(lat, lng, radiusMi\)/.test(engine),
  '9 addr: facilities are queried from HOME at that radius');
ok(/if \(d > radiusMi \+ 0\.05\) continue;/.test(engine),
  '9 addr: each facility is culled by ITS OWN distance from HOME, not by the source radius alone');
ok(/if \(!isFinite\(lat\) \|\| !isFinite\(lng\)\) continue;/.test(engine),
  '9 addr: a facility with no coordinate is DROPPED — never presented as radius-proven');
// the page may only ask for the four supported stops
const n5 = readFileSync(join(root, 'lib/n5-radius.js'), 'utf8');
ok(/HS\.N5_RADII = \[0\.5, 1, 2, 5\];/.test(n5), '9 addr: the four stops are 0.5 / 1 / 2 / 5');
ok(/HS\.N5_RADII\.indexOf\(r\) >= 0/.test(page),
  '9 addr: address mode refuses a radius outside those four stops');

// ZIP MODE — pinned as the KNOWN GAP so it cannot be quietly forgotten or quietly claimed.
// The facility half of a ZIP page is still a centroid + ZIP_RADIUS_MI query, not ZCTA
// membership. Measured 2026-09-05: geo.zip_authoritative_membership holds 0 rows keyed
// `epa_frs:%`, so no facility has authoritative whole-ZIP geography yet.
ok(/const ZIP_RADIUS_MI = 3;/.test(engine),
  '9 zip: ZIP-mode facilities still come from a centroid radius (the known, reported gap)');
ok(/facilitySites\(clat, clng, zipRadius\)/.test(engine),
  '9 zip: and that radius, not ZCTA geography, is what selects them');
// The wording must therefore keep saying "nearby", never "in this ZIP".
ok(/nearby\s*"?\s*\+?\s*$|nearby regulated facilities|nearby facilities/i.test(page),
  '9 zip: the page still says NEARBY for facilities, matching what the query actually proves');
ok(!/regulated facilities (in|across) (this )?ZIP/i.test(page),
  '9 zip: the page never claims facilities are measured across the ZIP');

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
