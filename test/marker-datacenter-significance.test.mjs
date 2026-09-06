// DATA CENTER SIGNIFICANCE — what KIND of activity, not just what it relates to.
//
// THE PRODUCT PROBLEM: "Data center" was the whole answer for a 285,282 SF ground-up
// data hall AND for a sign permit. Correct, and useless for judging significance.
//
// THE EVIDENCE CONTRACT, measured over the whole shipped corpus (107 records / 479 rows):
//   app_projects.size / .investment / .jobs / .scope_text / .developer  →  0 of 479 rows.
// There is NO structured scale. Only the issuing authority's own permit class (`type_raw`)
// and the record's own description text exist, so those are the only inputs, and
// ABSENCE OF SCALE IS NEVER READ AS SMALL.
//
// Every string below is VERBATIM production text (pulled 2026-09-06).
//
// Run: node test/marker-datacenter-significance.test.mjs
let fails = 0;
const ok = (c, name) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name); if (!c) fails++; };

global.window = { HS: {}, sessionStorage: { _v: null, getItem() { return this._v; }, setItem(k, v) { this._v = v; } } };
await import('../lib/templates.js');
await import('../lib/map.js');
const HS = global.window.HS;
const m = (item) => HS.resolveMarker(Object.assign({ status: 'Proposed' }, item));
const sig = (item) => { const r = m(item).significance; return r ? r.key : null; };
const frsRid = (s) => (s && s.registry_id != null) ? String(s.registry_id).trim() : '';
const track = (s) => HS.resolveTrackerMarker(s, frsRid);

// ── 1. PROVEN MAJOR — all 5 records the corpus supports, verbatim ────────────────
[['Commercial', 'Commercial/Industrial Projects', 'Commercial/Industrial Projects New ground up 285,282 SF unlimited area data hall building with type II-B construction. G'],
 ['Commercial', 'Commercial/Industrial Projects', 'Commercial/Industrial Projects Shell data hall building 1, construction type II-B, two story 243,332 SF total building. '],
 ['Development', 'NEW CONSTRUCTION', 'NEW CONSTRUCTION Construct Data Center (IB158 #1) per plans reviewed for code compliance. BOP DCH Area #1'],
 ['Development', 'Building Commercial - New', 'Building Commercial - New To construct a single-story 103,877 SF structure to accommodate a Data Center (established as '],
 ['Commercial', 'SHELL - STRUC/ELEC/PLMB/MECH', 'PHOENIX NAP II DATA CENTER - SHELL']
].forEach(function (r, i) {
  ok(sig({ type: r[0], type_raw: r[1], name: r[2] }) === 'major',
    '1.' + i + ': MAJOR — "' + r[2].slice(0, 52) + '…"');
});

// ── 2. PROVEN ANCILLARY — the issuing authority's OWN permit class says so ───────
[['Development', 'SIGN  PERMIT', 'QTS DATA CENTER'],
 ['Civic/Public', 'FP STATIONARY LEAD-ACID BATTERY SYSTEM', 'PHX 05-3 DATA HALL 1B BESS PERMIT'],
 ['Civic/Public', 'FP STATIONARY LEAD-ACID BATTERY SYSTEM', 'PHX05-3 DATA HALL 1A EESS'],
 ['Civic/Public', 'FP FIRE ALARM MODIFICATION', 'FIRE ALARM TI - DATA HALLS'],
 ['Civic/Public', 'FP FIRE ALARM MODIFICATION', 'SC-35 DATA HALL OFFICE ALARM MOD'],
 ['Civic/Public', 'FP FIRE ALARM INSTALLATION', 'LA SALLE 1G SERVERS DATA CENTER T.I F/A'],
 ['Civic/Public', 'FP FIRE PUMP INSTALLATION', 'IRON MOUNTAIN DATA CENTER - PUMP'],
 ['Civic/Public', 'FP VEHICLE ACCESS CONTROL DEVICE GATES', 'IRON MTN DATA CENTER-GATES'],
 ['Civic/Public', 'FIRE PREVENTION SERVICE REQUEST', 'MCDOWELL ROAD DATA CENTER'],
 ['Development', 'Commercial', 'Commercial Replacement of Data Center cooling tower (EC-1).  Misc. steel work and associated Mechanical and Electrical w'],
 ['Utility', '', 'Training & Data Center Roofs CTDOT Training and Data Center Roof Replacements, Newington.']
].forEach(function (r, i) {
  ok(sig({ type: r[0], type_raw: r[1], name: r[2] }) === 'ancillary',
    '2.' + i + ': ANCILLARY — "' + r[2].slice(0, 46) + '…"');
});

// ── 3. THE VETO — the source's own class outranks its free text ─────────────────
// This record's description reads "Construct data center", which is exactly the wording
// that proves MAJOR elsewhere. The jurisdiction filed it as an alteration. 2 production
// records turn on this conflict, and the class wins.
const veto = { type: 'Development', type_raw: 'ADDITIONS/ALTERATIONS/REPAIRS',
  name: 'ADDITIONS/ALTERATIONS/REPAIRS Construct data center and pump house renovations per plans reviewed for code compliance.' };
ok(sig(veto) === 'unknown', '3a: an alteration permit whose text says "Construct data center" is NOT major');
// Load-bearing proof: strip the class and the same text DOES read as major.
ok(sig({ type: 'Development', type_raw: '', name: veto.name }) === 'major',
  '3b: …and the veto is what stopped it — the identical text with no permit class is major');

// ── 4. ADVERSARIAL — the words that must NOT carry a verdict on their own ───────
// Every one of these is a real production record, and every one stays UNKNOWN.
[['"building" is a verb here, not a new building', 'Commercial', 'COM', 'ACC Project: Building a Data Center - Phase 1\nThe first phase of the data center project focuses on the initial deployme'],
 ['"Building" as a permit class is not new construction', 'Development', 'Building', 'Building American Tower Modular Data Center Phase 2 - Addition to Unmanned Modular data storage facility. Pro'],
 ['a generator is not automatically minor work', 'Development', 'Minor Site Plan', 'AT&T - OAKTON DATA CENTER GENERATOR POWER (PR)'],
 ['"EXPANSION" of HVAC is not a data-centre expansion', 'Utility', 'Vertical Construction (Ch 149)', 'BOSTON- DATA CENTER & HVAC EXPANSION & UPGRADES AT HQ BOSTON'],
 ['an equipment ADDITION is not a building expansion', 'Commercial', 'STRUC/MECH/ELEC', 'DATA CENTER CRAC ADDITION'],
 ['grading is site work, neither proven major nor ancillary', 'Development', 'GRADING/DRAINAGE CIVIL PERMIT', 'PHOENIX NAP II DATA CENTER - G&D'],
 ['a 9-story land-use APPLICATION is permission, not construction', 'Industrial', 'Industrial', 'Master Use Permit Land Use Application to allow a 9-story Business Support Services (Data Center) building. Parking for '],
 ['a county proposal states no activity', 'Development', '', '600 River Road - Data Center'],
 ['"data hall" proves IDENTITY, never scale', 'Commercial', 'COM', 'AMAZON DATA HALL PH02- ACCESS CONTROL'],
 ['an interior alteration of an existing data centre is not new construction', 'Development', 'PERMIT - RENOVATION/ALTERATION', 'PERMIT - RENOVATION/ALTERATION SPR 2019 CBRC: 1ST FLOOR INTERIOR AND EXTERIOR ALTERATIONS IN EXISTING 2-STORY DATA CENTE']
].forEach(function (r, i) {
  ok(sig({ type: r[1], type_raw: r[2], name: r[3] }) === 'unknown', '4.' + i + ': ' + r[0]);
});
// MW in a name is a capacity claim, not proof of construction activity.
ok(sig({ type: 'Commercial', type_raw: '', name: 'CLT 15 12MW Data Center' }) === 'unknown',
  '4x: "12MW" in a name does not by itself establish major development');

// ── 5. UNKNOWN IS NOT "MINOR" — the single most dangerous confusion ─────────────
// All 13 San Jose records are named for their use type and address and state no activity.
const sj = { type: 'Industrial', type_raw: 'Data Center', name: 'Data Center 123  GREAT OAKS BL  , SAN JOSE CA 95119' };
ok(sig(sj) === 'unknown', '5a: a record stating no activity is unknown');
ok(m(sj).significance.label === 'Significance not stated',
  '5b: …and it SAYS so — the resident is never left to infer "minor" from silence');
ok(HS.SIGNIFICANCE.unknown.label.toLowerCase().indexOf('minor') === -1
   && HS.SIGNIFICANCE.unknown.label.toLowerCase().indexOf('small') === -1,
  '5c: the unknown label never implies smallness');
// Absence of square footage is not smallness: the same record with no SF is still major.
ok(sig({ type: 'Development', type_raw: 'NEW CONSTRUCTION', name: 'NEW CONSTRUCTION Construct Data Center (IB158 #1)' }) === 'major',
  '5d: a MAJOR record with no square footage is still major — SF is evidence, not a requirement');

// ── 6. TYPE AND SYMBOL ARE UNTOUCHED — significance is a second dimension ───────
const majorMk = m({ type: 'Development', type_raw: 'NEW CONSTRUCTION', name: 'NEW CONSTRUCTION Construct Data Center (IB158 #1)' });
const ancMk = m({ type: 'Development', type_raw: 'SIGN  PERMIT', name: 'QTS DATA CENTER' });
ok(majorMk.categoryKey === 'datacenter' && majorMk.shape === 'octagon'
   && ancMk.categoryKey === 'datacenter' && ancMk.shape === 'octagon',
  '6a: major and ancillary are the SAME type and the SAME octagon — significance never changes identity');
ok(JSON.stringify(majorMk.categories) === JSON.stringify(ancMk.categories),
  '6b: …and the same filter membership');

// ── 7. GATE 7 — EPA facilities carry no development significance ────────────────
const dual = track({ type: 'built', label: 'CORESITE - VA1 DATA CENTER', layer: 'datacenter',
  scope: 'point', registry_id: '110071955663' });
ok(dual.significance.key === 'unknown' && dual.significanceApplies === false,
  '7a: an operating EPA data centre is never major or ancillary — facility identity proves no activity');
ok(dual.categoryKey === 'datacenter' && dual.shape === 'octagon' && dual.signal
   && dual.signal.shape === 'square' && dual.isFacility === true,
  '7b: dual identity is byte-for-byte as shipped — octagon primary, EPA square subordinate');
ok(dual.popupLabel.indexOf('Significance') === -1,
  '7c: …and its popup line does not append a significance verdict it cannot support');
const plainFac = track({ type: 'built', label: 'ANDURIL INDUSTRIES, INC', layer: 'industrial',
  scope: 'point', registry_id: '110072041130' });
ok(plainFac.significance === null && plainFac.shape === 'square' && !plainFac.signal,
  '8: an ordinary regulated facility is untouched and carries no significance at all');

// ── 9. EVERY OTHER TYPE IS UNTOUCHED ────────────────────────────────────────────
[['industrial', { type: 'Industrial', type_raw: 'NEW CONSTRUCTION', name: 'NEW CONSTRUCTION Steel Mill' }],
 ['residential', { type: 'Residential', type_raw: 'SIGN  PERMIT', name: 'Monument sign' }],
 ['commercial', { type: 'Commercial', type_raw: 'FP FIRE ALARM MODIFICATION', name: 'Retail alarm mod' }],
 ['civic', { type: 'Civic/Public', type_raw: 'NEW CONSTRUCTION', name: 'Fire Station 4' }],
 ['other', { type: 'Development', type_raw: 'SIGN  PERMIT', name: 'Permit' }]
].forEach(function (r, i) {
  const mk = m(r[1]);
  ok(mk.categoryKey === r[0] && mk.significance === null && mk.significanceApplies === false,
    '9.' + i + ': ' + r[0] + ' carries NO significance even with a matching permit class — data centres only');
});

// ── 10. The tracker path carries the permit class WITHOUT widening the classifier ─
ok(track({ type: 'proposed', label: 'QTS DATA CENTER', layer: 'development',
  type_raw: 'SIGN  PERMIT', scope: 'point' }).significance.key === 'ancillary',
  '10a: significance works on the Map 1 tracker path (permit_class carries type_raw)');
// FROZEN CLASSIFIER PROOF: these two records' ONLY data-centre evidence is type_raw.
// If the tracker item mapped type_raw under its own name they would become data centres,
// which would silently widen the shipped classifier. They must stay exactly as they are.
[['Hewlett Packard- Site 2 EcoPOD', 'Data Center'],
 ['Norwood Park, Replat of Lots 2-4 of Resub of Lots 6-7 of Replat of', 'Data Center']
].forEach(function (r, i) {
  const mk = track({ type: 'approved', label: r[0], layer: 'development', type_raw: r[1], scope: 'point' });
  ok(mk.categoryKey !== 'datacenter',
    '10b.' + i + ': "' + r[0].slice(0, 40) + '…" does NOT become a data centre — the frozen classifier is unchanged');
});

// ── 10c. ZIP MODE — the flagship surface carries the permit class, or degrades safely ─
// ZIP-mode development is rebuilt by zipAuthSiteFromMarker from the RPC payload, which
// does not include `type_raw` under its own name. Measured: of the 15 ancillary records,
// 12 are provable ONLY from the permit class — so without carrying it, ZIP pages would
// lose 12 of 15 ancillary verdicts (major loses none; every major record's evidence also
// appears in its name).
await import('../lib/zip-authoritative.js');
const zipSite = HS.zipAuthSiteFromMarker(
  { lat: 33.45, lng: -112.06, marker_rule: 'POINT_AUTHORITATIVE', marker_seq: 0, project_ref: 'p1' },
  { project_ref: 'p1', name: 'QTS DATA CENTER', type: 'Development', type_raw: 'SIGN  PERMIT',
    status: 'Proposed', source_ref: 'https://example.gov/x', registry_id: 'phoenix-building-permits' });
ok(zipSite && zipSite.permit_class === 'SIGN  PERMIT',
  '10c: a ZIP-mode site carries the issuing authority\'s permit class');
ok(track(zipSite).significance.key === 'ancillary',
  '10d: …so a ZIP page can say a sign permit is ancillary work');
// FAIL-SAFE: if a future RPC projection drops the column the verdict is LOST, never wrong.
const zipSiteNoClass = HS.zipAuthSiteFromMarker(
  { lat: 33.45, lng: -112.06, marker_rule: 'POINT_AUTHORITATIVE', marker_seq: 0, project_ref: 'p2' },
  { project_ref: 'p2', name: 'QTS DATA CENTER', type: 'Development',
    status: 'Proposed', source_ref: 'https://example.gov/x', registry_id: 'phoenix-building-permits' });
ok(zipSiteNoClass.permit_class === null && track(zipSiteNoClass).significance.key === 'unknown',
  '10e: …and with no permit class it degrades to "not stated" — a lost verdict, never a wrong one');
// The ZIP-mode site must not gain a `type_raw` key: that name feeds the frozen classifier
// and Rule 5 residential qualification, neither of which this unit may widen.
ok(!('type_raw' in zipSite), '10f: the ZIP-mode site carries NO `type_raw` — frozen readers see no new field');

// ── 11. Geography is untouched ──────────────────────────────────────────────────
ok(majorMk.lat === undefined && majorMk.lng === undefined && majorMk.zip === undefined,
  '11: the significance path returns no geography — it cannot move a record');

console.log(fails ? `\n${fails} FAILED` : '\nAll passed');
process.exit(fails ? 1 : 0);
