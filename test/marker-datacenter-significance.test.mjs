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
// ⚖️ REVISED 2026-09-06 after an adversarial competitor-CTO audit of 96eade0, which found
// no false classification and two resident-facing weaknesses: `Ancillary work` asserted a
// magnitude no evidence establishes, and 16 records whose own wording proved work on an
// EXISTING data centre were being discarded into the unknown bucket.
//
// Every string below is VERBATIM production text (pulled 2026-09-06) unless marked
// ADVERSARIAL.
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
const lab = (item) => { const r = m(item).significance; return r ? r.label : null; };
const frsRid = (s) => (s && s.registry_id != null) ? String(s.registry_id).trim() : '';
const track = (s) => HS.resolveTrackerMarker(s, frsRid);

// ── 1. ALL 5 PRODUCTION MAJOR RECORDS REMAIN MAJOR (Gate 8.1) ───────────────────
// This is the regression that matters most: the new precedence runs two phases BEFORE
// the major test, and neither may steal a major verdict.
const MAJORS = [
 ['Commercial', 'Commercial/Industrial Projects', 'Commercial/Industrial Projects New ground up 285,282 SF unlimited area data hall building with type II-B construction. G'],
 ['Commercial', 'Commercial/Industrial Projects', 'Commercial/Industrial Projects Shell data hall building 1, construction type II-B, two story 243,332 SF total building. '],
 ['Development', 'NEW CONSTRUCTION', 'NEW CONSTRUCTION Construct Data Center (IB158 #1) per plans reviewed for code compliance. BOP DCH Area #1'],
 ['Development', 'Building Commercial - New', 'Building Commercial - New To construct a single-story 103,877 SF structure to accommodate a Data Center (established as '],
 ['Commercial', 'SHELL - STRUC/ELEC/PLMB/MECH', 'PHOENIX NAP II DATA CENTER - SHELL']
];
MAJORS.forEach(function (r, i) {
  ok(sig({ type: r[0], type_raw: r[1], name: r[2] }) === 'major',
    '1.' + i + ': MAJOR preserved — "' + r[2].slice(0, 50) + '…"');
});
// A genuine new shell with no TI wording must still be major (Gate 8.2 control).
ok(sig({ type: 'Commercial', type_raw: 'SHELL - STRUC/ELEC/PLMB/MECH', name: 'NEW DATA CENTER SHELL BUILDING' }) === 'major',
  '1x: a genuine shell/new-construction control remains MAJOR — the TI veto is not a blanket shell veto');

// ── 2. THE TI/SHELL VECTOR IS CLOSED (Gate 8.3, 8.4) ────────────────────────────
// ADVERSARIAL. No such record exists in the 107-record corpus; this is preventive
// hardening the audit asked for, against a national corpus where `SHELL TI` is common
// permit shorthand for tenant improvement inside an existing shell.
['SHELL TI', 'TI - SHELL', 'SHELL T.I.', 'SHELL - T I'].forEach(function (cls, i) {
  ok(sig({ type: 'Commercial', type_raw: cls, name: 'NEW DATA CENTER BUILDING' }) !== 'major',
    '2.' + i + ': permit class "' + cls + '" is NOT major — tenant improvement contradicts `shell`');
});

// ── 3. WORK ON AN EXISTING DATA CENTER — recovered from the unknown bucket ───────
// THE PRECEDENCE CASE the audit named. Both records' descriptions say "Construct data
// center"; the jurisdiction filed them as alterations. They must not be MAJOR, and they
// must no longer be silent — the alteration evidence is authoritative and useful.
const VETO = { type: 'Development', type_raw: 'ADDITIONS/ALTERATIONS/REPAIRS',
  name: 'ADDITIONS/ALTERATIONS/REPAIRS Construct data center and pump house renovations per plans reviewed for code compliance.' };
ok(sig(VETO) === 'existing', '3a: the ADDITIONS/ALTERATIONS record is now Work on existing data center, not silence');
ok(lab(VETO) === 'Work on existing data center', '3b: …and reads exactly that');
ok(sig(VETO) !== 'major', '3c: …and is still NOT major — the class veto is intact');
// Load-bearing proof of the veto, ISOLATED. The record above no longer isolates it: its
// own NAME says "ALTERATIONS" and "renovations", so it now reaches `existing` on the name
// alone. To prove the CLASS veto still does work, use a name carrying only major wording
// and a class that trips the veto without tripping the existing-work rule.
const MAJOR_TEXT = 'Construct data center for the north campus';
ok(sig({ type: 'Development', type_raw: '', name: MAJOR_TEXT }) === 'major',
  '3d: major wording with no permit class reads as major');
ok(sig({ type: 'Development', type_raw: 'ADDITION', name: MAJOR_TEXT }) === 'unknown',
  '3d2: …and the SAME text under an `ADDITION` class does not — the class veto is still load-bearing');
// Gate 8.5-8.9: alteration · renovation · interior · tenant improvement · upfit.
[['alteration', 'PERMIT - RENOVATION/ALTERATION', 'PERMIT - RENOVATION/ALTERATION SPR 2019 CBRC: 1ST FLOOR INTERIOR AND EXTERIOR ALTERATIONS IN EXISTING 2-STORY DATA CENTE'],
 ['renovation', 'General Construction', 'General Construction Proposed architectural renovations for the CUNY NAC Data Center on the 1st and 6th floors as descri'],
 ['interior work', 'General Construction', 'General Construction REMOVE AND INSTALL INTERIOR PARITIONS, DOORS AND CEILINGS AT 12 FLOOR DATA CENTER. NO CHANGE TO USE'],
 ['tenant upfit', 'ADDITIONS/ALTERATIONS/REPAIRS', 'ADDITIONS/ALTERATIONS/REPAIRS Tenant Upfit of an Existing Data Center Building Permit # CRBF-2025-050376'],
 ['interior alteration', 'COM', 'ALT Main building data center alterations'],
 ['tenant improvement', 'STRUC/ELEC/PLMB/MECH', 'I M DATA CENTER-TI OF SUITE SC 37']
].forEach(function (r, i) {
  ok(sig({ type: 'Development', type_raw: r[1], name: r[2] }) === 'existing',
    '3e.' + i + ': ' + r[0] + ' → Work on existing data center');
});
// It claims nothing about magnitude, in either direction.
ok(!/major|minor|small|large|significant|upgrade|expansion/i.test(HS.SIGNIFICANCE.existing.label),
  '3f: the existing-work label claims no magnitude — not major, not minor, not an expansion');

// ── 4. SUPPORTING ACTIVITY — the authority's own activity, not a magnitude ───────
// Gate 8.10-8.13. `Ancillary work` is GONE. Each of these now reads as the activity the
// issuing authority named.
[['SIGN  PERMIT', 'QTS DATA CENTER', 'Sign permit'],
 ['FP FIRE ALARM MODIFICATION', 'FIRE ALARM TI - DATA HALLS', 'Fire-alarm permit'],
 ['FP FIRE ALARM MODIFICATION', 'SC-35 DATA HALL OFFICE ALARM MOD', 'Fire-alarm permit'],
 ['FP FIRE ALARM INSTALLATION', 'LA SALLE 1G SERVERS DATA CENTER T.I F/A', 'Fire-alarm permit'],
 ['FP FIRE PUMP INSTALLATION', 'IRON MOUNTAIN DATA CENTER - PUMP', 'Fire-pump permit'],
 ['FP STATIONARY LEAD-ACID BATTERY SYSTEM', 'PHX 05-3 DATA HALL 1B BESS PERMIT', 'Battery-system permit'],
 ['FP STATIONARY LEAD-ACID BATTERY SYSTEM', 'PHX05-3 DATA HALL 1A EESS', 'Battery-system permit'],
 ['FP VEHICLE ACCESS CONTROL DEVICE GATES', 'IRON MTN DATA CENTER-GATES', 'Access-control permit'],
 ['FIRE PREVENTION SERVICE REQUEST', 'MCDOWELL ROAD DATA CENTER', 'Fire-prevention service request'],
 ['', 'Training & Data Center Roofs CTDOT Training and Data Center Roof Replacements, Newington.', 'Roof replacement'],
 ['Commercial', 'Commercial Replacement of Data Center cooling tower (EC-1).  Misc. steel work and associated Mechanical and Electrical w', 'Cooling-tower work']
].forEach(function (r, i) {
  const mk = m({ type: 'Civic/Public', type_raw: r[0], name: r[1] });
  ok(mk.significance.key === 'supporting' && mk.significance.label === r[2],
    '4.' + i + ': "' + r[1].slice(0, 40) + '…" → ' + r[2]);
});
// Gate 8.14: a supporting record whose activity cannot be safely normalized falls back to
// the neutral phrase — never to a magnitude word.
ok(m({ type: 'Development', type_raw: '', name: 'Data Center roof replacement, north elevation' }).significance.label === 'Roof replacement',
  '4x: a description-only supporting act is still named from the description');

// ── 5. THE MAGNITUDE PROHIBITION (Gate 8.18, 8.19) ──────────────────────────────
// The single most important semantic assertion in this file. A battery-system permit or
// a fire-pump installation can be SUBSTANTIAL; HomeSignal knows only the activity.
const BANNED = /\b(minor|small|smaller|insignificant|unimportant|low|trivial|negligible|slight)\b/i;
Object.keys(HS.SIGNIFICANCE).forEach(function (k) {
  ok(!BANNED.test(HS.SIGNIFICANCE[k].label),
    '5a.' + k + ': the "' + HS.SIGNIFICANCE[k].label + '" label implies no magnitude');
});
['Sign permit', 'Fire-alarm permit', 'Fire-pump permit', 'Battery-system permit',
 'Access-control permit', 'Fire-prevention service request', 'Roof replacement', 'Cooling-tower work'
].forEach(function (l, i) {
  ok(!BANNED.test(l), '5b.' + i + ': the supporting label "' + l + '" implies no magnitude');
});
ok(!/ancillary/i.test(JSON.stringify(HS.SIGNIFICANCE))
   && lab({ type: 'Development', type_raw: 'SIGN  PERMIT', name: 'QTS DATA CENTER' }) !== 'Ancillary work',
  '5c: "Ancillary work" is no longer a resident-facing label anywhere');
// A BESS permit must never read as smaller than a sign permit — both say only what they are.
ok(lab({ type: 'Civic/Public', type_raw: 'FP STATIONARY LEAD-ACID BATTERY SYSTEM', name: 'PHX 05-3 DATA HALL 1B BESS PERMIT' }) === 'Battery-system permit',
  '5d: a stationary-battery installation is named, never sized');

// ── 6. UNKNOWN — attributed to the source, and never read as "nothing here" ──────
// Gate 8.15, 8.17.
const SJ = { type: 'Industrial', type_raw: 'Data Center', name: 'Data Center 123  GREAT OAKS BL  , SAN JOSE CA 95119' };
ok(sig(SJ) === 'unknown', '6a: a record stating no activity is unknown');
ok(lab(SJ) === 'Scope not stated by source',
  '6b: …and the wording attributes the silence to the SOURCE, not to a HomeSignal finding');
ok(!/significan/i.test(HS.SIGNIFICANCE.unknown.label),
  '6c: it no longer says "significance", which read as HomeSignal judging the activity');
// Absence of square footage is not smallness.
ok(sig({ type: 'Development', type_raw: 'NEW CONSTRUCTION', name: 'NEW CONSTRUCTION Construct Data Center (IB158 #1)' }) === 'major',
  '6d: a MAJOR record with no square footage is still major — SF is evidence, not a requirement');

// ── 7. TRUNCATION (Gate 8.16, 8.17) ─────────────────────────────────────────────
// 25 of 107 production records are cut at exactly 120 characters, and 3 of the 5 MAJOR
// records are among them. The rule must judge only what it can see, and must never treat
// the absence of wording after the cut as evidence of anything.
const T120 = MAJORS[0][2];
ok(T120.length === 120, '7a: the fixture is at the real 120-character truncation boundary');
ok(sig({ type: 'Commercial', type_raw: 'Commercial/Industrial Projects', name: T120 }) === 'major',
  '7b: a truncated record still classifies on the wording that SURVIVED the cut');
// Truncation must not manufacture a verdict either: a record cut BEFORE its qualifying
// wording is unknown, not "not major".
const CUT_EARLY = 'Commercial/Industrial Projects Data hall building 1 for the campus at 1500 W Elliot Rd, permit set A, sheets 1 throughhh';
ok(CUT_EARLY.length === 120 && sig({ type: 'Commercial', type_raw: 'Commercial/Industrial Projects', name: CUT_EARLY }) === 'unknown',
  '7c: ADVERSARIAL — a record whose qualifying wording fell past the cut is UNKNOWN, never asserted');
// And the absence of a suffix is never read as a contradiction: the same string with
// alteration wording restored beyond the cut would have been `existing`, so the truncated
// form must not claim `major` on a technicality it cannot see.
ok(sig({ type: 'Commercial', type_raw: 'Commercial/Industrial Projects', name: CUT_EARLY + ' interior alterations' }) === 'existing',
  '7d: …and when the wording IS present, it is read — proving 7c is silence, not a dead rule');

// ── 8. ADVERSARIAL — words that must NOT carry a verdict ────────────────────────
[['"building" is a verb here, not a new building', 'COM', 'ACC Project: Building a Data Center - Phase 1\nThe first phase of the data center project focuses on the initial deployme'],
 ['"Building" as a permit class is not new construction', 'Building', 'Building American Tower Modular Data Center Phase 2 - Addition to Unmanned Modular data storage facility. Pro'],
 ['a generator is not automatically supporting or minor', 'Minor Site Plan', 'AT&T - OAKTON DATA CENTER GENERATOR POWER (PR)'],
 ['an equipment ADDITION is not a building expansion', 'STRUC/MECH/ELEC', 'DATA CENTER CRAC ADDITION'],
 ['grading is site work, neither proven major nor supporting', 'GRADING/DRAINAGE CIVIL PERMIT', 'PHOENIX NAP II DATA CENTER - G&D'],
 ['a 9-story land-use APPLICATION is permission, not construction', 'Industrial', 'Master Use Permit Land Use Application to allow a 9-story Business Support Services (Data Center) building. Parking for '],
 ['a county proposal states no activity', '', '600 River Road - Data Center'],
 ['"data hall" proves IDENTITY, never scale', 'COM', 'AMAZON DATA HALL PH02- ACCESS CONTROL']
].forEach(function (r, i) {
  ok(sig({ type: 'Development', type_raw: r[1], name: r[2] }) === 'unknown', '8.' + i + ': ' + r[0]);
});
ok(sig({ type: 'Commercial', type_raw: '', name: 'CLT 15 12MW Data Center' }) === 'unknown',
  '8x: "12MW" in a name does not by itself establish major development');

// ── 9. TYPE, SYMBOL AND FILTERS ARE UNTOUCHED (Gate 8.21, 8.23) ─────────────────
const majorMk = m({ type: 'Development', type_raw: 'NEW CONSTRUCTION', name: 'NEW CONSTRUCTION Construct Data Center (IB158 #1)' });
const supMk = m({ type: 'Development', type_raw: 'SIGN  PERMIT', name: 'QTS DATA CENTER' });
const existMk = m(VETO);
ok(majorMk.categoryKey === 'datacenter' && supMk.categoryKey === 'datacenter' && existMk.categoryKey === 'datacenter',
  '9a: all three significance states are the SAME type');
ok(majorMk.shape === 'octagon' && supMk.shape === 'octagon' && existMk.shape === 'octagon',
  '9b: …and draw the SAME octagon — significance never changes identity or symbol');
ok(JSON.stringify(majorMk.categories) === JSON.stringify(supMk.categories)
   && JSON.stringify(supMk.categories) === JSON.stringify(existMk.categories),
  '9c: …and hold the same filter membership');

// ── 10. GATE 7 — EPA facilities carry no development significance ───────────────
const dual = track({ type: 'built', label: 'CORESITE - VA1 DATA CENTER', layer: 'datacenter',
  scope: 'point', registry_id: '110071955663' });
ok(dual.significance.key === 'unknown' && dual.significanceApplies === false,
  '10a: an operating EPA data centre is never major, supporting or existing-work');
ok(dual.categoryKey === 'datacenter' && dual.shape === 'octagon' && dual.signal
   && dual.signal.shape === 'square' && dual.isFacility === true,
  '10b: dual identity is byte-for-byte as shipped — octagon primary, EPA square subordinate');
ok(dual.popupLabel.indexOf('Scope not stated') === -1 && dual.popupLabel.indexOf('Supporting') === -1,
  '10c: …and its popup appends no significance verdict it cannot support');
const plainFac = track({ type: 'built', label: 'ANDURIL INDUSTRIES, INC', layer: 'industrial',
  scope: 'point', registry_id: '110072041130' });
ok(plainFac.significance === null && plainFac.shape === 'square' && !plainFac.signal,
  '10d: an ordinary regulated facility is untouched and carries no significance at all');

// ── 11. EVERY OTHER MAP 1 TYPE IS UNTOUCHED (Gate 8.25) ─────────────────────────
[['industrial', { type: 'Industrial', type_raw: 'NEW CONSTRUCTION', name: 'NEW CONSTRUCTION Steel Mill' }],
 ['residential', { type: 'Residential', type_raw: 'SIGN  PERMIT', name: 'Monument sign' }],
 ['commercial', { type: 'Commercial', type_raw: 'PERMIT - RENOVATION/ALTERATION', name: 'Retail interior alterations' }],
 ['civic', { type: 'Civic/Public', type_raw: 'NEW CONSTRUCTION', name: 'Fire Station 4' }],
 ['other', { type: 'Development', type_raw: 'SHELL TI', name: 'Permit' }]
].forEach(function (r, i) {
  const mk = m(r[1]);
  ok(mk.categoryKey === r[0] && mk.significance === null && mk.significanceApplies === false,
    '11.' + i + ': ' + r[0] + ' carries NO significance even with a matching permit class');
});

// ── 12. The tracker path carries the permit class WITHOUT widening the classifier ─
await import('../lib/zip-authoritative.js');
ok(track({ type: 'proposed', label: 'QTS DATA CENTER', layer: 'development',
  type_raw: 'SIGN  PERMIT', scope: 'point' }).significance.label === 'Sign permit',
  '12a: significance works on the Map 1 tracker path');
const zipSite = HS.zipAuthSiteFromMarker(
  { lat: 33.45, lng: -112.06, marker_rule: 'POINT_AUTHORITATIVE', marker_seq: 0, project_ref: 'p1' },
  { project_ref: 'p1', name: 'QTS DATA CENTER', type: 'Development', type_raw: 'SIGN  PERMIT',
    status: 'Proposed', source_ref: 'https://example.gov/x', registry_id: 'phoenix-building-permits' });
ok(zipSite && zipSite.permit_class === 'SIGN  PERMIT' && track(zipSite).significance.label === 'Sign permit',
  '12b: a ZIP-mode site carries the permit class and names the activity');
const zipNoClass = HS.zipAuthSiteFromMarker(
  { lat: 33.45, lng: -112.06, marker_rule: 'POINT_AUTHORITATIVE', marker_seq: 0, project_ref: 'p2' },
  { project_ref: 'p2', name: 'QTS DATA CENTER', type: 'Development',
    status: 'Proposed', source_ref: 'https://example.gov/x', registry_id: 'phoenix-building-permits' });
ok(zipNoClass.permit_class === null && track(zipNoClass).significance.key === 'unknown',
  '12c: …and with no permit class it degrades to source-silence — a lost verdict, never a wrong one');
ok(!('type_raw' in zipSite), '12d: the ZIP-mode site carries NO `type_raw` — frozen readers see no new field');
// FROZEN CLASSIFIER (Gate 8.21): these two records' ONLY data-centre evidence is type_raw.
[['Hewlett Packard- Site 2 EcoPOD', 'Data Center'],
 ['Norwood Park, Replat of Lots 2-4 of Resub of Lots 6-7 of Replat of', 'Data Center']
].forEach(function (r, i) {
  ok(track({ type: 'approved', label: r[0], layer: 'development', type_raw: r[1], scope: 'point' }).categoryKey !== 'datacenter',
    '12e.' + i + ': "' + r[0].slice(0, 36) + '…" does NOT become a data centre — the frozen classifier is unchanged');
});

// ── 13. Geography (Gate 8.24) ───────────────────────────────────────────────────
ok(majorMk.lat === undefined && majorMk.lng === undefined && majorMk.zip === undefined,
  '13: the significance path returns no geography — it cannot move a record');

console.log(fails ? `\n${fails} FAILED` : '\nAll passed');
process.exit(fails ? 1 : 0);
