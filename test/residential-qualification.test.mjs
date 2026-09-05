// RESIDENTIAL DEVELOPMENT QUALIFICATION — the founder rule of 2026-09-05, pinned.
//
//   Map 1 Residential = meaningful NEW residential development.
//   It is NOT routine work on an existing residential property.
//
// Every string below is VERBATIM from production `app_projects` (pulled 2026-09-05) unless
// marked "adversarial". The adversarial ones are the cases that broke an earlier draft of the
// rule and would silently come back without a test.
//
// These drive the REAL SHIPPED PATH — project row -> zipAuthSiteFromMarker -> trackerSiteItem
// -> resolveMarker — not a convenient approximation. The previous audit produced a false
// lifecycle defect by calling resolveMarker directly, so the page's own call shape is the only
// one asserted here.
//
// Run: node test/residential-qualification.test.mjs
let fails = 0;
const ok = (c, name) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name); if (!c) fails++; };

global.window = { HS: {} };
await import('../lib/templates.js');
await import('../lib/map.js');
await import('../lib/residential-qualify.js');
await import('../lib/n5-radius.js');
await import('../lib/zip-authoritative.js');
const HS = global.window.HS;

// The real page path: one app_projects row + one authoritative marker -> a Map 1 site or null.
const MARKER = { project_ref: 'k', marker_seq: 1, lat: 38.9, lng: -77.5, marker_rule: 'POINT_AUTHORITATIVE' };
function site(p) {
  return HS.zipAuthSiteFromMarker(MARKER, Object.assign(
    { source_key: 'k', project_ref: 'k', status: 'Approved', source_ref: 'https://example.gov/r/1' }, p));
}
const shown = (p) => site(p) !== null;
const verdict = (p) => HS.residentialActivity(p).verdict;

// ── CLASS 1 — TRADE PERMITS ARE EXCLUDED ──────────────────────────────────────────────
ok(!shown({ type: 'Residential', type_raw: 'HVAC Residential', name: 'HVAC Residential 6131 SHOOTING STAR DR' }),
  '1: HVAC Residential is excluded');
ok(!shown({ type: 'Residential', type_raw: 'PLUMBING RESIDENTIAL', name: 'PLUMBING RESIDENTIAL 4410 S 3RD ST' }),
  '2: residential plumbing is excluded');
ok(!shown({ type: 'Residential', type_raw: 'Electrical Residential', name: 'Electrical Residential 2201 W BROADWAY' }),
  '3: residential electrical is excluded');
ok(!shown({ type: 'Residential', type_raw: 'Mechanical - Residential', name: 'Mechanical - Residential 900 E MAIN' }),
  '4: residential mechanical is excluded');
ok(!shown({ type: 'Residential', type_raw: 'APARTMENT COMPLEX', name: 'PLU 315 S ROCK ST U-601' }),
  '5: plumbing at an apartment complex is excluded (building type is not activity type)');
ok(!shown({ type: 'Residential', type_raw: 'APARTMENT COMPLEX', name: 'ELE 1500 S BROADWAY ST' }),
  '6: electrical at an apartment complex is excluded');
ok(!shown({ type: 'Residential', type_raw: 'NHC Residential Trade Permit', name: 'NHC Residential Trade Permit QUEEN' }),
  '6b: a source that maps its own trade permit to Residential is still excluded');

// ── CLASS 2 — ALTERATION / ACCESSORY / MAINTENANCE ARE EXCLUDED ───────────────────────
ok(!shown({ type: 'Residential', type_raw: 'Renovations/Remodels', name: 'Renovations/Remodels 204 SF remodel converting the existing single car garage bay' }),
  '7: an ordinary remodel is excluded');
ok(!shown({ type: 'Residential', type_raw: 'Residential', name: 'Reroof existing single family dwelling' }),
  '8: a reroof is excluded');
ok(!shown({ type: 'Residential', type_raw: 'Res', name: 'Res Replace 2 windows same size' }),
  '9: maintenance/replacement is excluded');
ok(!shown({ type: 'Residential', type_raw: 'Deck', name: 'Building (Residential) 11513 W 115TH ST' }),
  '9b: a deck permit is excluded');
ok(!shown({ type: 'Residential', type_raw: 'Residential', name: 'ADDITION AND ALTERATION' }),
  '9c: an addition/alteration is excluded');

// ── CLASSES 5 & 6 — GENUINE DEVELOPMENT QUALIFIES ────────────────────────────────────
ok(shown({ type: 'Residential', type_raw: 'Residential', name: 'PIONEER CROSSING EAST RESIDENTIAL SUBDIVISION PHASE 2' }),
  '10: a residential subdivision qualifies');
ok(shown({ type: 'Residential', type_raw: 'Site Dev Residential', name: 'Site Dev Residential OAKMONT PARK' }),
  '10b: a residential site development case qualifies');
ok(shown({ type: 'Residential', type_raw: 'Residential', name: 'NEW CONSTRUCTION 40 UNIT APARTMENT BUILDING' }),
  '11: genuine new multifamily construction qualifies');
ok(shown({ type: 'Residential', type_raw: 'RES', name: 'NEW New construction custom home' }),
  '12: genuine new single-family construction can qualify');

// ── CLASS 4 — GENERIC `Residential` FAILS CONSERVATIVELY ─────────────────────────────
ok(!shown({ type: 'Residential', type_raw: 'Residential', name: 'Residential 1009 SHARRON CREEK DR 28470' }),
  '13: generic Residential + an address alone does not qualify');
ok(!shown({ type: 'Residential', type_raw: 'SINGLE-FAMILY DETACHED', name: 'SINGLE-FAMILY DETACHED 23445 MORNING WALK DR' }),
  '14: a dwelling-TYPE label with no activity evidence fails conservatively');
ok(verdict({ type_raw: 'Residential Building', name: 'Residential Building 2317 S Red Oak Ave' }) === 'UNRESOLVED',
  '14b: no activity evidence is UNRESOLVED, never guessed into DEVELOPMENT');

// ── PRECEDENCE — STRONG NEGATIVE ACTIVITY OUTRANKS WEAK RESIDENTIAL-USE KEYWORDS ─────
ok(!shown({ type: 'Residential', type_raw: 'Residential', name: 'Residential Alteration' }),
  '15: "Residential Alteration" — the routine activity outranks the word "Residential"');
ok(verdict({ registry_id: 'dekalb-county-building-permits', type_raw: 'New Homes',
             name: 'Repairs to Existing Structure 1188 DRUID WALK' }) === 'ROUTINE',
  '15b: the WORK-TYPE column outranks the OCCUPANCY column (adversarial: DeKalb)');

// ── EXCLUDED RECORDS CANNOT RE-ENTER, AND ARE NOT RETYPED ────────────────────────────
// lib/map.js NAME_RULES matches a bare /residential/, so without the gate running BEFORE
// type resolution these would be readmitted as Residential by their own names.
const hvac = { type: 'Residential', type_raw: 'HVAC Residential', name: 'HVAC Residential 6131 SHOOTING STAR DR' };
ok(HS.resolveMarker({ type: 'Residential', use_type: 'Residential', name: hvac.name }).typeKey === 'residential',
  '16a: control — the classifier alone WOULD call the excluded record Residential');
ok(site(hvac) === null, '16b: the gate drops it before the classifier can readmit it');
ok(site(hvac) === null && HS.residentialActivity(hvac).verdict === 'ROUTINE',
  '17: an excluded record becomes NO Map 1 object — it is never relabelled Development or other');

// ── RETAINED RESIDENTIAL KEEPS THE EXISTING VISUAL CONTRACT ──────────────────────────
const keeper = { type: 'Residential', type_raw: 'Residential', name: 'NEW CONSTRUCTION 40 UNIT APARTMENT BUILDING' };
const km = HS.resolveTrackerMarker(site(keeper));
ok(km.typeKey === 'residential' && km.shape === 'pentagon' && km.legendLabel === 'Residential',
  '18: retained Residential resolves to the pentagon');
ok(HS.resolveTrackerMarker(site(Object.assign({}, keeper, { status: 'Proposed' }))).shape === 'pentagon'
  && HS.resolveTrackerMarker(site(Object.assign({}, keeper, { status: 'Operating' }))).shape === 'pentagon',
  '19: shape stays TYPE-driven — Stage does not change it');
ok(HS.resolveTrackerMarker(site(Object.assign({}, keeper, { status: 'Proposed' }))).color === HS.LIFECYCLE_HEX.proposed
  && HS.resolveTrackerMarker(site(Object.assign({}, keeper, { status: 'Operating' }))).color === HS.LIFECYCLE_HEX.operating,
  '20: colour stays STAGE-driven');
const unk = HS.resolveTrackerMarker(site(Object.assign({}, keeper, { status: null })));
ok(unk.color === HS.LIFECYCLE_HEX.unknown && unk.statusLabel === 'Lifecycle unknown',
  '21: an unknown lifecycle stays honestly unknown, never guessed to Operating');

// ── OTHER MAP TYPES ARE UNTOUCHED ────────────────────────────────────────────────────
ok(shown({ type: 'Commercial', type_raw: 'Commercial', name: 'HVAC replacement at 100 Main St' }),
  '22a: a COMMERCIAL trade permit is untouched — this gate only scopes Residential');
ok(shown({ type: 'data center', type_raw: 'Data Center', name: 'Data center electrical upgrade' }),
  '22b: Data center is untouched');
ok(shown({ type: 'Roads & infrastructure', type_raw: 'Utility', name: 'Water main repair' }),
  '22c: Roads & infrastructure is untouched');
ok(HS.resolveMarker({ _facility: true, name: 'X' }).categoryKey === 'facility',
  '22d: Regulated facility is untouched');

// ── RAIL / COUNT SEMANTICS ───────────────────────────────────────────────────────────
const payload = {
  status: HS.ZIP_AUTH_COMPLETE,
  projects: [
    { project_ref: 'a', source_key: 'a', type: 'Residential', type_raw: 'HVAC Residential', name: 'HVAC Residential 1 A ST', status: 'Operating', source_ref: 'u' },
    { project_ref: 'b', source_key: 'b', type: 'Residential', type_raw: 'Residential', name: 'NEW CONSTRUCTION 12 UNIT TOWNHOMES', status: 'Approved', source_ref: 'u' }
  ],
  markers: [
    { project_ref: 'a', marker_seq: 1, lat: 1, lng: 2, marker_rule: 'POINT_AUTHORITATIVE' },
    { project_ref: 'b', marker_seq: 1, lat: 1, lng: 2, marker_rule: 'POINT_AUTHORITATIVE' }
  ]
};
const sites = HS.zipAuthSitesFrom(payload);
ok(sites.length === 1 && HS.zipAuthProjectCount(sites) === 1,
  '23: the rail counts 1, not 2 — a non-qualifying record is not a project');
ok(/^1 project across the whole of ZIP 20148/.test(HS.zipAuthNote(payload, '20148', sites)),
  '23b: the ZIP note states the qualifying count, so map and count agree');

// ── ADDRESS MODE MAKES THE SAME DECISION AS ZIP MODE ─────────────────────────────────
const row = { source_key: 'a', feature_id: 'f1', marker_lat: 1, marker_lng: 2, distance_mi: 0.4 };
ok(HS.n5SiteFromRow(row, { source_key: 'a', type: 'Residential', type_raw: 'HVAC Residential', name: 'HVAC Residential 1 A ST', status: 'Operating', source_ref: 'u' }) === null,
  '24a: address mode excludes the same record ZIP mode excludes');
ok(HS.n5SiteFromRow(row, { source_key: 'b', type: 'Residential', type_raw: 'Residential', name: 'NEW CONSTRUCTION 12 UNIT TOWNHOMES', status: 'Approved', source_ref: 'u' }) !== null,
  '24b: address mode retains the same record ZIP mode retains');

// ── ADVERSARIAL: the cases that broke earlier drafts ─────────────────────────────────
ok(verdict({ type_raw: 'Residential', name: 'NEW HOPE RD' }) === 'UNRESOLVED',
  'A1: adversarial — a street starting "NEW" is not a development (weak head needs its own noun)');
ok(verdict({ type_raw: 'Residential', name: 'NEW CASTLE DR' }) === 'UNRESOLVED',
  'A2: adversarial — "NEW CASTLE DR" is an address, not new construction');
ok(verdict({ type_raw: 'Residential', name: 'Sundeck Lane 45' }) === 'UNRESOLVED',
  'A3: adversarial — "Sundeck" must not match the phrase " deck "');
ok(verdict({ registry_id: 'denton-county-dev-permits', type_raw: 'ADDITION TO HOUSE', name: 'ADDITION TO HOUSE SMITH' }) === 'ROUTINE',
  'A4: a family dev-type rule cannot override an explicit routine activity');
ok(verdict({ registry_id: 'denton-county-dev-permits', type_raw: 'HOUSE', name: 'HOUSE LENNAR HOMES OF TEXAS INC' }) === 'DEVELOPMENT',
  'A5: Denton PermitType=HOUSE is a new dwelling permit and qualifies');

console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURE(S)`);
process.exit(fails === 0 ? 0 : 1);
