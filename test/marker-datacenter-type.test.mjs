// DATA CENTER type on the maps (lib/map.js — the DATACENTER precedence phase).
//
// The contract: a record whose OWN words state a data centre resolves to the
// `datacenter` category (octagon, "Data center" legend row), whatever coarse bucket
// our registry `type_map` collapsed it into. Every category this displaces —
// Utility, Industrial, Commercial, Civic, Other — is strictly BROADER, so the stated
// class is always the better answer. It never invents one: a record that states no
// data centre is untouched, and a regulated facility keeps its own square.
//
// Every string below is VERBATIM from production `app_projects` (pulled 2026-09-05)
// unless marked "adversarial".
//
// Run: node test/marker-datacenter-type.test.mjs
let fails = 0;
const ok = (c, name) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name); if (!c) fails++; };

global.window = { HS: {} };
await import('../lib/templates.js');
await import('../lib/map.js');
const HS = global.window.HS;
const m = (item) => HS.resolveMarker(Object.assign({ status: 'Proposed' }, item));
const key = (item) => m(item).categoryKey;
const shape = (item) => m(item).shape;

// ── 1. The legend row this build exists to make real ──────────────────────────────
const dcRow = HS.SHAPE_LEGEND.filter((r) => r.categoryKey === 'datacenter');
ok(dcRow.length === 1 && dcRow[0].label === 'Data center' && dcRow[0].shape === 'octagon',
  '1: the generated legend carries exactly one Data center row, octagon');

// ── 2. THE DEFECT — a stated data centre under a coarse source type ───────────────
// 260 production rows across 4 coarse types drew a non-data-centre shape. Each case
// below is one of those rows; the assertion is that the STATED class now wins.
ok(key({ type: 'Utility', type_raw: 'Vertical Construction (Ch 149)',
  name: 'BOSTON- DATA CENTER ELECTRIC UPGRADES AT HQ BOSTON' }) === 'datacenter',
  '2a: MA "DATA CENTER ELECTRIC UPGRADES" under type=Utility → datacenter (was infrastructure/diamond)');
ok(key({ type: 'Industrial', type_raw: 'Industrial', name: 'Pennhurst Data Centers' }) === 'datacenter',
  '2b: PA "Pennhurst Data Centers" under type=Industrial → datacenter (was industrial/triangle)');
ok(key({ type: 'Industrial', type_raw: 'Industrial', name: 'The Data Centers' }) === 'datacenter',
  '2c: PA "The Data Centers" under type=Industrial → datacenter');
ok(key({ type: 'Commercial', type_raw: 'SHELL - STRUC/ELEC/PLMB/MECH',
  name: 'PHOENIX NAP II DATA CENTER - SHELL' }) === 'datacenter',
  '2d: AZ "PHOENIX NAP II DATA CENTER - SHELL" under type=Commercial → datacenter (was commercial/hexagon)');
ok(key({ type: 'Commercial', type_raw: 'prelimenary plan', name: 'Sandy Farm Data Center - Phase 2' }) === 'datacenter',
  '2e: MD "Sandy Farm Data Center - Phase 2" under type=Commercial → datacenter');
ok(key({ type: 'Commercial', type_raw: null, name: 'CLT 15 12MW Data Center' }) === 'datacenter',
  '2f: NC "CLT 15 12MW Data Center" under type=Commercial → datacenter');
ok(key({ type: 'Civic/Public', type_raw: 'FIRE PREVENTION SERVICE REQUEST',
  name: 'MCDOWELL ROAD DATA CENTER' }) === 'datacenter',
  '2g: AZ "MCDOWELL ROAD DATA CENTER" under type=Civic/Public → datacenter (was civic/cross)');
ok(key({ type: 'Civic/Public', type_raw: 'Public Improvement Plan',
  name: 'AVION DATA CENTER DUCT BANK (AMAZON)' }) === 'datacenter',
  '2h: VA "AVION DATA CENTER DUCT BANK (AMAZON)" under type=Civic/Public → datacenter');

// Phoenix files data-centre fire work under the F-range department code, which the
// registry maps to Civic/Public. The record still states the data centre.
ok(key({ type: 'Civic/Public', type_raw: 'FP FIRE PUMP INSTALLATION',
  name: 'IRON MOUNTAIN DATA CENTER - PUMP' }) === 'datacenter',
  '2i: AZ Iron Mountain fire-pump permit AT a data centre → datacenter, not civic');

// ── 3. `type_raw` — the SOURCE'S OWN WORDS, which our type_map had discarded ───────
// San Jose publishes `Data Center` verbatim; the registry entry collapsed it to
// Industrial. The name here is incidental — assert the class field alone carries it.
ok(m({ type: 'Industrial', type_raw: 'Data Center', name: '2001 FORTUNE DR 2' }).shapeRule === 'DATACENTER:type_raw',
  '3a: type_raw="Data Center" resolves through the class field, not the name');
ok(key({ type: 'Industrial', type_raw: 'Data Center', name: '2001 FORTUNE DR 2' }) === 'datacenter',
  '3b: source-stated type_raw beats the mapped type');
// type_raw is read ONLY by this rule — it must not reshape anything else.
ok(key({ type: 'Development', type_raw: 'Single Family Dwelling', name: 'permit 12345' }) === 'other',
  '3c: a NON-data-centre type_raw is still ignored by every other phase (honest circle)');

// ── 4. The one-word production spelling now resolves through the TYPE phase ────────
// 738 rows carry type='datacenter'; none carries the spaced form. Before this build
// the one-word spelling only resolved by accident, through LAYER_EXACT.
ok(m({ type: 'datacenter', name: 'x' }).shapeRule === 'DATACENTER:type',
  '4a: type="datacenter" resolves as a stated data centre');
ok(key({ use_type: 'data center', name: 'x' }) === 'datacenter', '4b: use_type="data center" → datacenter');
ok(key({ layer: 'datacenter', name: 'x' }) === 'datacenter',     '4c: layer="datacenter" → datacenter');

// ── 5. TRUNCATION — connectors cut long names mid-word ────────────────────────────
// 37 production rows end "... EXISTING 2-STORY DATA CENTE". Requiring the whole word
// would drop exactly the records with the most descriptive names.
ok(key({ type: 'Commercial', name: 'ALT REMODEL OF EXISTING 2-STORY DATA CENTE' }) === 'datacenter',
  '5: a name truncated to "DATA CENTE" still resolves');

// ── 6. FACILITY PRECEDENCE IS UNCHANGED — deliberately out of scope ───────────────
// All 738 type='datacenter' rows are EPA-FRS facilities. The purple square and the
// `facility` filter bucket are a founder-set contract; whether a regulated facility
// that IS a data centre should draw the octagon is a separate, resident-visible call.
const fac = m({ type: 'datacenter', record_kind: 'facility', name: 'IRON MOUNTAIN INCORPORATED' });
ok(fac.categoryKey === 'facility' && fac.shape === 'square' && fac.shapeRule === 'PRECEDENCE:facility-flag',
  '6a: an EPA facility typed datacenter keeps the Regulated facility square');
ok(m({ _facility: true, name: 'SERVER FARM LLC' }).categoryKey === 'facility',
  '6b: the _facility flag still short-circuits before the data-centre phase');

// ── 7. NEGATIVE CONTROLS — the rule must not widen ────────────────────────────────
// Street-name guard. Measured 0 collisions in production today (control: 1,188 rows
// match the pattern on the name), written because the `\bschool\b` rule needed the
// same guard the moment a national audit ran. ADVERSARIAL.
ok(key({ type: 'Commercial', name: '4200 Data Center Drive - Retail Shell' }) === 'commercial',
  '7a: "Data Center Drive" as an ADDRESS is not claimed — the source type stands');
ok(key({ type: 'Development', name: '1100 DATACENTER RD SFR ADDITION' }) === 'other',
  '7b: "DATACENTER RD" as an address falls through to the honest circle');
// Vocabulary must not bleed into neighbouring words. ADVERSARIAL.
ok(key({ type: 'Commercial', name: 'Data Central Analytics Office Fitout' }) === 'commercial',
  '7c: "Data Central" is not a data centre');
// Records that state no data centre are byte-for-byte unaffected.
ok(key({ type: 'Residential', name: 'Residential Alteration' }) === 'residential', '7d: residential unchanged');
ok(key({ type: 'Commercial', name: 'ALT Main building alterations' }) === 'commercial', '7e: commercial unchanged');
ok(key({ type: 'Industrial', name: 'Warehouse shell' }) === 'industrial', '7f: industrial unchanged');
ok(key({ type: 'Utility', name: 'Water main replacement' }) === 'infrastructure', '7g: utility unchanged');
ok(key({ type: 'Civic/Public', name: 'Del Valle High School' }) === 'civic', '7h: civic unchanged');
ok(key({ type: 'Development', name: 'Sign permit' }) === 'other', '7i: generic + no class stays the honest circle');

// ── 8. The label a resident reads matches the pin they see ────────────────────────
ok(m({ type: 'Utility', name: 'BOSTON- DATA CENTER ELECTRIC UPGRADES AT HQ BOSTON' }).typeLabel === 'Data center',
  '8a: typeLabel reads "Data center", never the coarse bucket it displaced');
ok(m({ type: 'Utility', name: 'BOSTON- DATA CENTER ELECTRIC UPGRADES AT HQ BOSTON' })
    .popupLabel.indexOf('Data center') !== -1,
  '8b: the popup says Data center');
ok(m({ type: 'Commercial', name: 'CLT 15 12MW Data Center' }).fallbackReason === null,
  '8c: a resolved data centre carries no "uncategorised" reason');

// ── 9. THE RULE IS LOAD-BEARING — prove it by removing its input ───────────────────
// Same record with the data-centre words stripped must fall back to the coarse type.
// A test that only ever sees the fixed shape cannot fail when the rule is deleted.
ok(key({ type: 'Civic/Public', type_raw: 'FIRE PREVENTION SERVICE REQUEST',
  name: 'MCDOWELL ROAD PUMP STATION' }) === 'civic',
  '9: with the data-centre words removed the coarse type stands — the rule, not the fixture, is what moves 2g');

// ── 11. OPERATOR BRANDS MUST NEVER CLASSIFY — the Case B adversarial set ──────────
// Measured 2026-09-05 over 522 of the 1,045 ZIPs where Compute Atlas independently places a
// data centre: matching on a data-centre OPERATOR BRAND finds 5 real missed data centres and
// 31 false positives. These are the false positives, VERBATIM from production. Every one of
// them is what a brand-token rule would have turned into a Data center octagon on a resident's
// map. The classifier reads only what the record says it IS, never who is named in it — these
// tests are what stops that property from being "simplified" away later.
ok(key({ type: 'Residential', name: 'Residential New VANTAGE HILL - LOT 12 - TH' }) === 'residential',
  '11a: "VANTAGE HILL - LOT 12 - TH" is a TOWNHOUSE (Vantage is a data-centre operator AND a subdivision name)');
// Lands on the honest circle, not residential: NAME_RULES matches `townhou?se`, which does not
// cover the plural "TOWNHOMES". That is a PRE-EXISTING residential-rule gap, unrelated to this
// change and deliberately not fixed here — what matters for this unit is that it is not a data centre.
ok(key({ type: 'Development', name: 'VANTAGE HILL TOWNHOMES' }) === 'other',
  '11b: "VANTAGE HILL TOWNHOMES" is not a data centre (honest circle; see note on TOWNHOMES)');
ok(key({ type: 'Commercial', name: 'Commercial Addition/Alteration VANTAGE HILL - LOT 1 - GARAGE TO SALES OFFICE CONVERSION' }) === 'commercial',
  '11c: a garage-to-sales-office conversion at Vantage Hill stays commercial');
ok(key({ type: 'Commercial', type_raw: 'site development plan', name: 'AMAZON DELIVERY STATION, 7659 SOLLEY ROAD (MODIFICATION)' }) === 'commercial',
  '11d: an AMAZON DELIVERY STATION is a warehouse, not a data centre');
ok(key({ type: 'Commercial', name: 'Commercial Addition/Alteration Google Reston Training Room/ 16 FL' }) === 'commercial',
  '11e: a Google office training room is not a data centre');
ok(key({ type: 'Commercial', name: 'Commercial Addition/Alteration Oracle-Reston-/ 4th FL corridor' }) === 'commercial',
  '11f: an Oracle office corridor is not a data centre');
ok(key({ type: 'Development', name: "General Construction NRF 2026: Retail's Big Show - ORACLE BOOTH #5739 to install a temporary exhibit" }) === 'commercial',
  '11g: an ORACLE trade-show BOOTH reads commercial off "Retail", never data centre');
ok(key({ type: 'Utility', name: 'US 202:  Markley Street (SB) Norristown Borough Reconstruction/Signal Improvements' }) === 'infrastructure',
  '11h: "Markley Street" is a STREET (Markley Group is a data-centre operator) — stays infrastructure');
ok(key({ type: 'Development', name: 'Structural Structural work to rebuild raised floor platform, aligned with existing slab' }) === 'other',
  '11i: "aligned" as an ordinary English verb is not the operator Aligned Data Centers');

// Vocabulary probes that ALSO must not classify — both are real production strings found by
// the Case B sweep, and both are the reason `colo` and megawatt language stayed OUT of the rule.
ok(key({ type: 'Development', name: 'Building AT&T full Colo on existing rooftop - install antenna, ancillary equipment, mounts, fiber' }) === 'infrastructure',
  '11j: a rooftop cell-site "Colo" reads infrastructure off "antenna", never data centre');
ok(key({ type: 'Development', name: 'NEW Installation of a new stationary Cummins 1.5 MW optional standby power generator on a new concrete pad' }) === 'other',
  '11k: a 1.5 MW standby generator is not a data centre');

// The invariant behind every case in §11, asserted directly: not one operator-brand string
// reaches the Data center category by any path.
[['Residential','Residential New VANTAGE HILL - LOT 12 - TH'],['Development','VANTAGE HILL TOWNHOMES'],
 ['Commercial','AMAZON DELIVERY STATION, 7659 SOLLEY ROAD (MODIFICATION)'],
 ['Commercial','Commercial Addition/Alteration Google Reston Training Room/ 16 FL'],
 ['Commercial','Commercial Addition/Alteration Oracle-Reston-/ 4th FL corridor'],
 ['Utility','US 202:  Markley Street (SB) Norristown Borough Reconstruction/Signal Improvements'],
 ['Development','Building AT&T full Colo on existing rooftop - install antenna'],
 ['Development','NEW Installation of a new stationary Cummins 1.5 MW optional standby power generator']
].forEach(function (r, i) {
  ok(key({ type: r[0], name: r[1] }) !== 'datacenter', '11z.' + i + ': operator-brand string never reaches datacenter');
});

// ── 12. The five REAL Case B misses — documented as KNOWN GAPS, not silently "passing" ───
// These are genuine data-centre projects (CoreSite VA1/VA3, EdgeConnex — all corroborated by
// Compute Atlas) whose HomeSignal source wording never says "data center". The classifier
// CORRECTLY declines them: the only signal available is the operator brand, and §11 above shows
// what classifying on that costs. Asserting the current behaviour keeps the gap visible.
ok(key({ type: 'Development', type_raw: 'Minor Site Plan', name: 'CoreSite VA1' }) === 'other',
  '12a: KNOWN GAP — "CoreSite VA1" is a real data centre; source states no class, so it stays the honest circle');
ok(key({ type: 'Commercial', name: 'Commercial Addition/Alteration EDGECONNEX / #500' }) === 'commercial',
  '12b: KNOWN GAP — "EDGECONNEX / #500" is a real data centre; source wording carries only the brand');

// ── 10. Symbol uniqueness still holds across the closed registry ──────────────────
const symbols = Object.keys(HS.CATEGORY_REGISTRY).map((k) => HS.CATEGORY_REGISTRY[k].symbol);
ok(new Set(symbols).size === symbols.length, '10: no two categories share a symbol');

console.log(fails ? `\n${fails} FAILED` : '\nAll passed');
process.exit(fails ? 1 : 0);
