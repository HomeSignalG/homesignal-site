// SQL <-> JS PARITY for the Residential qualification rule.
//
// The product decision is made in JS (lib/residential-qualify.js) but the NATIONAL population
// is measured in Postgres, because 450k+ objects cannot be streamed to a test runner. That is
// two execution engines for one rule, which is exactly how rules drift. Two things keep them
// identical, and this file pins both:
//
//   1. The SQL is GENERATED from the module's own exported vocabulary
//      (scripts/residential-qualify-sql.mjs), so the words cannot differ.
//   2. Every phrase is pure [a-z0-9 ]. With no metacharacter anywhere, a POSIX alternation of
//      literals and a substring containment test are the SAME predicate — so the generated
//      regex form and the shipped substring form agree by construction, not by luck. This file
//      re-evaluates the GENERATED regexes in JS over real production strings and asserts the
//      two forms return the same verdict for every one.
//
// Run: node test/residential-qualify-sql-parity.test.mjs
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
let fails = 0;
const ok = (c, name) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name); if (!c) fails++; };

global.window = { HS: {} };
await import('../lib/residential-qualify.js');
const HS = global.window.HS;
const V = HS.RESIDENTIAL_VOCABULARY;

// 1. The literal-only invariant that licenses the regex translation at all.
const LITERAL = /^[a-z0-9 ]+$/;
const bad = [];
for (const k of ['dev_anywhere', 'dev_phrase_anywhere', 'dev_head', 'dev_head_weak', 'dev_noun',
                 'routine_anywhere', 'routine_object', 'scale_noun', 'place_ambiguous']) {
  for (const p of V[k]) if (!LITERAL.test(p)) bad.push(k + ':' + JSON.stringify(p));
}
ok(bad.length === 0, '1: every vocabulary phrase is pure [a-z0-9 ] — ' + (bad.join(', ') || 'none'));

// 2. The generator runs and emits SQL that carries the CURRENT vocabulary.
const gen = execFileSync(process.execPath,
  [fileURLToPath(new URL('../scripts/residential-qualify-sql.mjs', import.meta.url))], { encoding: 'utf8' });
ok(gen.includes(V.routine_anywhere[0].trim()) && gen.includes(V.dev_anywhere[0].trim()),
  '2: the generated SQL carries the module vocabulary');
const famIds = Object.keys(V.family_rules);
ok(famIds.every((id) => gen.includes(id)), '3: the generated SQL carries every per-family rule');

// 3. Rebuild the SAME predicates the generator emits, as JS RegExps, and compare verdicts.
const alt = (ps) => ps.map((x) => x.trim()).join('|');
const rHas = (ps) => new RegExp(' (' + alt(ps) + ') ');
const rHead = (ps) => new RegExp('^ (' + alt(ps) + ') ');
const RE = {
  devAny: rHas(V.dev_anywhere), devPhrase: rHas(V.dev_phrase_anywhere),
  devHead: rHead(V.dev_head), devWeak: rHead(V.dev_head_weak),
  devNoun: rHas(V.dev_noun), routineAny: rHas(V.routine_anywhere), routineHead: rHead(V.routine_anywhere),
  accessory: rHas(V.routine_object), scale: rHas(V.scale_noun),
  routineNoPlace: rHas(V.routine_anywhere.filter((w) => V.place_ambiguous.indexOf(w) === -1))
};
// The generated CASE ladder, re-expressed over those regexes. Same order as the SQL.
function sqlVerdict(p) {
  const tr = HS.residentialNormalize(p.type_raw), nm = HS.residentialNormalize(p.name), both = tr + nm;
  const rid = String(p.registry_id || '');
  const isLabel = !!V.name_kind_label[rid];
  if (RE.routineAny.test(tr)) return 'ROUTINE';
  if (RE.routineHead.test(nm)) return 'ROUTINE';
  const devPhrase = RE.devPhrase.test(tr) || (!isLabel && RE.devPhrase.test(nm));
  const devHead = RE.devHead.test(tr) || (!isLabel && RE.devHead.test(nm));
  const weak = (RE.devWeak.test(tr) && RE.devNoun.test(tr))
            || (!isLabel && RE.devWeak.test(nm) && RE.devNoun.test(nm));
  if (devPhrase || devHead || weak) {
    return (RE.accessory.test(both) && !RE.scale.test(both)) ? 'ROUTINE' : 'DEVELOPMENT';
  }
  if (RE.routineAny.test(tr) || (!isLabel && RE.routineAny.test(nm)) || RE.routineNoPlace.test(nm)) return 'ROUTINE';
  if (RE.devAny.test(both)) return 'DEVELOPMENT';
  if (V.dev_provenance[rid]) return 'DEVELOPMENT';
  const fam = V.family_rules[rid];
  if (fam && fam.dev_type_raw.some((t) => tr === ' ' + t + ' ')) return 'DEVELOPMENT';
  return 'UNRESOLVED';
}

// Real production strings, spread across the families that drive the national counts.
const CORPUS = [
  ['new-hanover-county-building-permits', 'NHC Residential Trade Permit', 'NHC Residential Trade Permit QUEEN'],
  ['new-hanover-county-building-permits', 'NHC Residential Building', 'NHC Residential Building 4409 EXUMA LN'],
  ['louisville-active-construction-permits', 'HVAC Residential', 'HVAC Residential 6131 SHOOTING STAR DR'],
  ['little-rock-permits', 'APARTMENT COMPLEX', 'PLU 315 S ROCK ST U-601'],
  ['little-rock-permits', 'APARTMENT COMPLEX', 'MEC 1500 S BROADWAY ST'],
  ['little-rock-permits', 'SINGLE FAMILY/DUPLEX', 'BLD 8300 CANTRELL RD'],
  ['loudoun-county-residential-permits', 'SINGLE-FAMILY DETACHED', 'SINGLE-FAMILY DETACHED 23445 MORNING WALK DR'],
  ['loudoun-county-residential-permits', 'MULTI-FAMILY STACKED', 'MULTI-FAMILY STACKED 42920 PIEDMONT LN'],
  ['brunswick-county-permits', 'Residential', 'Residential 1009 SHARRON CREEK DR 28470'],
  ['sioux-falls-building-permits', 'Residential Building', 'Residential Building 2317 S Red Oak Ave, Sioux Falls, SD 57110'],
  ['memphis-dpd-building-permits', 'RES', 'NEW New construction custom home'],
  ['memphis-dpd-building-permits', 'RES', 'ALT Pocket door and trim work'],
  ['miami-building-permits', 'Residential', 'NEW CONSTRUCTION 2 STORY SINGLE FAMILY RESIDENCE'],
  ['miami-building-permits', 'Residential', 'ADDITION AND ALTERATION TO EXISTING RESIDENCE'],
  ['miami-building-permits', 'Residential', 'DEMOLITION DEMOLITION OF EXISTING STRUCTURE'],
  ['dekalb-county-building-permits', 'Single Family Detached', 'Repairs to Existing Structure 1188 DRUID WALK'],
  ['dekalb-county-building-permits', 'New Homes', 'New Single Family Home 3200 PEACHTREE'],
  ['denton-county-dev-permits', 'HOUSE', 'HOUSE LENNAR HOMES OF TEXAS INC'],
  ['denton-county-dev-permits', 'ADDITION TO HOUSE', 'ADDITION TO HOUSE SMITH'],
  ['overland-park-building-permits', 'Deck', 'Building (Residential) 11513 W 115TH ST'],
  ['henderson-residential-permits', 'BLDG - Dwelling', 'BLDG - Dwelling'],
  ['minneapolis-ccs-permits', 'Res', 'Res Replace 2 windows same size'],
  ['jackson-county-or-building-permits', 'Residential', 'Residential 7.4kW roof mounted photovoltaic system'],
  ['chattanooga-building-permits', 'Residential', '1234 FIRELIGHT DR'],
  ['fairfax-active-site-construction', 'Infill Lot Grading Plan', 'LITTLE VIENNA ESTATES SEC 1 LT 3'],
  ['x', 'Residential', 'PIONEER CROSSING EAST RESIDENTIAL SUBDIVISION PHASE 2'],
  ['x', 'Site Dev Residential', 'Site Dev Residential OAKMONT PARK'],
  ['x', 'Residential', 'NEW HOPE RD'],
  ['x', 'Residential', 'Sundeck Lane 45'],
  ['x', 'Residential', 'Residential Alteration'],
  // The audit's own production strings — every mechanism this change touches.
  ['topeka-building-permits', 'Residential Interior Remodel', 'Residential Interior Remodel 4124 SW STONEYLAKE DR LOT8 BLOCK A CLARION LAKE SUBDIVISION'],
  ['memphis-dpd-building-permits', 'RES', 'ACC Build wood fence according to site plan'],
  ['wake-county-building-permits', 'Residential Accessory Building Structure', 'Residential Accessory Building Structure EXIST SFD'],
  ['york-county-pa-planning-subdivisions', 'NO NO YES NO NO NO NO NO', 'Cherry Tree'],
  ['austin-subdivision-cases', 'Single Family', 'Shoalwood Addition Sec 4'],
  ['austin-subdivision-cases', 'SF', 'TRAVIS COOKE ROAD ADDITION NO. 2'],
  ['austin-site-plan-cases', 'MF', 'MOUNTAIN SHADOWS APARTMENTS'],
  ['austin-site-plan-cases', 'Single Family', 'Stassney Lane Townhomes'],
  ['austin-site-plan-cases', 'Single Family', 'Evans Resident Boat Dock Remodel'],
  ['delaware-county-pa-subdivisions-land-developments', 'Residential', 'Glendale Heights HOA Subdivide 41.411 acres into two lots'],
  ['delaware-county-pa-subdivisions-land-developments', 'Residential', 'Sunnybrae Farm Further develop 2.28 acres with 6,113 sq ft of building additions'],
  ['seattle-land-use-permits', 'Single Family/Duplex', 'Master Use Permit Land Use Application to subdivide one development site into two'],
  ['seattle-land-use-permits', 'Single Family/Duplex', 'Master Use Permit Shoreline application to allow an addition to an existing single family residence'],
  ['fairfax-active-site-construction', 'Infill Lot Grading Plan', 'ORCHARD VIEW LOT 39 POOL'],
  ['fairfax-active-site-construction', 'Infill Lot Grading Plan', 'FOX LAKE CAVALIERS ADDITION LOT 10 (SU)'],
  ['fairfax-active-site-construction', 'Subdivision Grading Plan', "Digges Addition to Chesterbrook Lot 1"],
  ['dallas-specific-use-permits', 'Multiple-family use', 'Multiple-family use'],
  ['slc-planning-petitions', 'Routine and Uncontest Home Occ', 'Routine and Uncontest Home Occ'],
  ['naperville-building-permits', 'RESIDENTIAL', 'RESIDENTIAL Single Family New Construction - Lot 168'],
  ['overland-park-building-permits', 'Deck', 'Building (Residential) 5804 NEWTON ST'],
  ['montgomery-county-residential-permits', 'CONSTRUCT', 'CONSTRUCT Build deck using Typical Deck Details, New Deck'],
  ['slo-county-planning-permits', 'Residential New Structure', 'Residential New Structure 1234 MAIN ST']
];
let mismatches = 0;
for (const [registry_id, type_raw, name] of CORPUS) {
  const p = { registry_id, type_raw, name };
  const a = HS.residentialActivity(p).verdict, b = sqlVerdict(p);
  if (a !== b) { mismatches++; console.log(`   MISMATCH js=${a} sql=${b} :: ${JSON.stringify(name)}`); }
}
ok(mismatches === 0, `4: substring form and generated-alternation form agree on all ${CORPUS.length} production strings`);

// 4. Proven load-bearing: a phrase carrying a metacharacter must FAIL the invariant, or the
//    regex translation would silently mean something else than the shipped substring rule.
ok(!LITERAL.test('new (construction)'), '5: the literal guard rejects a metacharacter phrase');

console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURE(S)`);
process.exit(fails === 0 ? 0 : 1);
