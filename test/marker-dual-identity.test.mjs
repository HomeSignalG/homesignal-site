// DATA CENTER + EPA REGULATED FACILITY — dual identity on Map 1.
//
// THE CONTRACT (founder, 2026-09-06):
//   • A record HomeSignal can defensibly establish is both a data centre and an
//     EPA-regulated facility has ONE primary identity — Data center — and carries the
//     regulatory fact as a SUBORDINATE signal beneath the primary symbol.
//   • It belongs to BOTH filter memberships and renders as ONE marker.
//   • FILTER MEMBERSHIP decides whether a record qualifies to be VISIBLE.
//     ENTITY IDENTITY decides its PRIMARY SYMBOL. The two never swap jobs.
//
// Every FRS string below is VERBATIM from production `app_projects` /
// `development_reports` (pulled 2026-09-06). The `layer:'datacenter'` /
// `type:'energy'` values are the EPA-FRS record's own stamped class, not ours.
//
// Run: node test/marker-dual-identity.test.mjs
let fails = 0;
const ok = (c, name) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name); if (!c) fails++; };

global.window = { HS: {}, sessionStorage: { _v: null, getItem() { return this._v; }, setItem(k, v) { this._v = v; } } };
await import('../lib/templates.js');
await import('../lib/map.js');
const HS = global.window.HS;
const frsRid = (s) => (s && s.registry_id != null) ? String(s.registry_id).trim() : '';
const track = (s) => HS.resolveTrackerMarker(s, frsRid);

// The real cached site object for CoreSite VA1's EPA registration, field for field.
const DUAL = { e: 1.482, n: 1.664, lat: 38.94932, lng: -77.36519,
  src: 'EPA FRS · registry 110071955663', type: 'built', label: 'CORESITE - VA1 DATA CENTER',
  layer: 'datacenter', scope: 'point', registry_id: '110071955663',
  record_url: 'https://echo.epa.gov/detailed-facility-report?fid=110071955663' };
// An ordinary regulated facility — the control for every "unchanged" claim below.
const PLAIN_FAC = { type: 'built', label: 'ACME PLATING WORKS', layer: 'industrial',
  scope: 'point', registry_id: '110000000001', record_url: 'https://echo.epa.gov/x' };
// An ordinary data-centre PROJECT (no EPA registration).
const DC_PROJECT = { type: 'approved', label: 'Pennhurst Data Centers', layer: 'datacenter',
  use_type: 'Data Center', scope: 'point', record_url: 'https://example.gov/p' };

const dual = track(DUAL), plain = track(PLAIN_FAC), proj = track(DC_PROJECT);

// ── 1-3. The three record kinds resolve to the right primary identity ─────────────
ok(proj.categoryKey === 'datacenter' && proj.shape === 'octagon' && !proj.isFacility && !proj.signal,
  '1: ordinary Data center project — octagon, no EPA signal');
ok(plain.categoryKey === 'facility' && plain.shape === 'square'
   && plain.color === HS.markerRegistry.facilityHex && !plain.signal,
  '2: ordinary Regulated facility — purple square, unchanged, no secondary symbol');
ok(dual.categoryKey === 'datacenter' && dual.shape === 'octagon' && dual.isFacility === true
   && dual.isDataCenter === true && dual.shapeRule === 'DUAL:datacenter+facility',
  '3: proven dual identity — PRIMARY identity is Data center, and it is still a facility');

// The primary symbol must not be the EPA colour: purple is what the SECONDARY symbol
// says, and letting it own the whole pin is exactly "EPA presence redefines the entity".
ok(dual.color !== HS.markerRegistry.facilityHex && dual.signal.color === HS.markerRegistry.facilityHex
   && dual.signal.shape === HS.CATEGORY_REGISTRY.facility.symbol,
  '3b: the EPA square is the SECONDARY symbol and owns the purple; the primary does not');

// ── 4-8. FILTER MATRIX — the founder's table, tested as written ───────────────────
const CATS = HS.categoryFilterKeys;
function setOnly(...on) { CATS.forEach(k => HS.setCategoryFilter(k, on.indexOf(k) !== -1)); }
function allOn() { CATS.forEach(k => HS.setCategoryFilter(k, true)); }

setOnly('datacenter');
ok(HS.categoryVisible(dual) === true, '4: Data Center ON / EPA OFF → dual record VISIBLE');
ok(track(DUAL).shape === 'octagon' && track(DUAL).signal !== null,
  '4b: …still the Data center octagon, and the EPA square is STILL attached');
ok(HS.categoryVisible(plain) === false, '4c: …an ordinary EPA facility is correctly hidden');

setOnly('facility');
ok(HS.categoryVisible(dual) === true, '5: Data Center OFF / EPA ON → dual record VISIBLE');
ok(track(DUAL).categoryKey === 'datacenter' && track(DUAL).shape === 'octagon',
  '5b: …and its primary symbol is STILL Data center — the filter that admitted it does not rename it');
ok(HS.categoryVisible(proj) === false, '5c: …a plain data-centre project is correctly hidden');

setOnly('datacenter', 'facility');
ok(HS.categoryVisible(dual) === true, '6: BOTH ON → visible');

setOnly();
ok(HS.categoryVisible(dual) === false, '7: BOTH OFF → not visible');
ok(HS.allCategoriesOff() === true, '7b: the all-off state is genuinely empty');

// TEST E — the founder's acceptance scenario, stated as its own assertion.
setOnly('facility');
ok(HS.categoryVisible(dual) === true && track(DUAL).categoryKey === 'datacenter'
   && track(DUAL).shape === HS.CATEGORY_REGISTRY.datacenter.symbol
   && track(DUAL).signal.shape === HS.CATEGORY_REGISTRY.facility.symbol,
  '8: ALL TYPES OFF EXCEPT EPA → the data centre remains visible, as a DATA CENTER with its EPA square');

// ── 9-11. One record, one marker — membership is any-of, never a join ─────────────
setOnly('datacenter', 'facility');
const memberships = HS.markerCategories(dual);
ok(memberships.length === 2 && memberships.indexOf('datacenter') === 0 && memberships.indexOf('facility') === 1,
  '9: the record holds exactly two memberships');
// The de-duplication proof: filtering a LIST returns the record once, not once per
// matching membership. This is the assertion that fails if anyone "solves" dual identity
// by emitting a second marker.
const list = [DUAL, PLAIN_FAC, DC_PROJECT].map(s => track(s));
const shown = HS.filterByCategory(list);
ok(shown.length === 3 && shown.filter(x => x.isDataCenter && x.isFacility).length === 1,
  '10: both filters on → the dual record appears ONCE in the visible set, not twice');
setOnly('facility');
ok(HS.filterByCategory(list).length === 2,
  '11: EPA only → exactly the two facility-membership records, each once');

// ── 12-13. Count semantics ───────────────────────────────────────────────────────
// A category-specific count may legitimately count the record under BOTH categories…
allOn();
const perCategory = {};
list.forEach(mk => HS.markerCategories(mk).forEach(k => { perCategory[k] = (perCategory[k] || 0) + 1; }));
ok(perCategory.datacenter === 2 && perCategory.facility === 2,
  '12: category-specific counts — the dual record contributes +1 to Data center AND +1 to Regulated facility');
// …but the UNIQUE-RESULTS count must not double it.
ok(HS.filterByCategory(list).length === 3,
  '13: unique-results count is 3, not 4 — dual membership never inflates the underlying total');

// ── 14. Popup / detail carries both truths, primary first ────────────────────────
ok(dual.popupLabel.indexOf('Data center') < dual.popupLabel.indexOf('Regulated facility')
   && dual.popupLabel.indexOf('Data center') !== -1 && dual.popupLabel.indexOf('Regulated facility') !== -1,
  '14: the popup states BOTH truths, identity first');
ok(plain.popupLabel.indexOf('Data center') === -1 && plain.popupLabel.indexOf('Regulated facility') !== -1,
  '14b: an ordinary facility popup is unchanged and claims no data centre');
// The popup must not editorialise EPA presence into harm.
ok(!/pollut|danger|contamin|hazard|toxic|risk/i.test(dual.popupLabel),
  '14c: the EPA signal is stated as a regulatory fact — never as proof of harm');

// ── 15-17. NO FABRICATED IDENTITY — the three joins we refuse to make ─────────────
// Campus grain: three CyrusOne power pods at one campus. Pod 1's NAME mentions the data
// hall it powers; all three are stamped `energy` by the authoritative record. Reading
// the name would call one of three identical facilities a data centre.
[['CYRUS ONE DATA HALL 1 POWER POD 1', '110038203734'],
 ['CYRUSONE POWER POD 5', '110041896945'],
 ['CYRUSONE POWER POD 7', '110041734317']
].forEach(function (r, i) {
  const mk = track({ type: 'built', label: r[0], layer: 'energy', scope: 'point', registry_id: r[1] });
  ok(mk.categoryKey === 'facility' && !mk.isDataCenter,
    '15.' + i + ': "' + r[0] + '" — campus grain: a power pod is not the data centre it powers');
});
// Similar name / same operator — CyrusOne runs data centres; that is not evidence about
// THIS facility. The record's own class field says substation.
ok(track({ type: 'built', label: 'CYRUSONE CHI 11 SUBSTATION MASS GRADING', layer: 'energy',
           scope: 'point', registry_id: '110072130291' }).categoryKey === 'facility',
  '16: operator brand alone never establishes identity — the substation stays a facility');
// Proximity-only: a facility sitting at a data centre's coordinates is still not one.
ok(track({ type: 'built', label: 'ACME PLATING WORKS', layer: 'industrial', scope: 'point',
           lat: DUAL.lat, lng: DUAL.lng, registry_id: '110000000002' }).categoryKey === 'facility',
  '17: identical coordinates to a proven data centre prove nothing — no proximity join');

// ── 18. Geography is untouched ───────────────────────────────────────────────────
// The resolver returns presentation only. It must never emit a coordinate, and the
// composed marker must keep the primary symbol on the icon anchor (the badge overflows
// downward) so the record renders at its true point.
ok(dual.lat === undefined && dual.lng === undefined && dual.zip === undefined,
  '18: the resolver returns no geography — it cannot move a record');
const svgDual = HS.markerSVG(dual.shape, dual.color, '', 14, dual.signal);
const svgPlain = HS.markerSVG(proj.shape, proj.color, '', 14, null);
const box = (s) => (s.match(/viewBox="([^"]+)"/) || [])[1];
ok(box(svgDual) === box(svgPlain) && /width="14" height="14"/.test(svgDual),
  '18b: the composed marker keeps the SAME icon box as every other pin — no anchor shift');

// ── 19-20. Nothing else moved ────────────────────────────────────────────────────
ok((svgDual.match(/<polygon/g) || []).length === 1 && (svgDual.match(/<rect/g) || []).length === 1,
  '19: ONE primary polygon + ONE subordinate square — a single composed marker, not two markers');
// Subordination is measurable, not a matter of taste: the EPA square is drawn smaller.
const rSig = Number((svgDual.match(/<rect x="[\d.]+" y="[\d.]+" width="([\d.]+)"/) || [])[1]);
ok(rSig > 0 && rSig < 14 * 0.40 * 2,
  '19b: the EPA square is strictly smaller than the primary symbol — visually subordinate');
[['industrial', { type: 'Industrial', name: 'Steel Mill' }],
 ['residential', { type: 'Residential', name: 'Alteration' }],
 ['commercial', { type: 'Commercial', name: 'Retail Shell' }],
 ['civic', { type: 'Civic/Public', name: 'Fire Station 4' }],
 ['other', { type: 'Development', name: 'Permit' }]
].forEach(function (r, i) {
  const mk = HS.resolveMarker(r[1]);
  ok(mk.categoryKey === r[0] && mk.signals.length === 0 && mk.signal === null,
    '20.' + i + ': ' + r[0] + ' is untouched and carries no signal — this unit is Data centers only');
});

console.log(fails ? `\n${fails} FAILED` : '\nAll passed');
process.exit(fails ? 1 : 0);
