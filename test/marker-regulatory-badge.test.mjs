// REGULATORY RECORDS ARE A THIRD DIMENSION — the legend row, the R badge, the switch.
//
// ⚖️ FOUNDER RULING 2026-09-06. "Regulated facility" must NOT appear under Project Type
// or Status. It is regulatory CONTEXT that overlaps with any project type and any
// lifecycle stage, so:
//   • the Type row carries the SEVEN project types and nothing else;
//   • a qualifying project marker keeps its Type shape and its Stage colour and gains a
//     small purple badge carrying a white capital R in its LOWER-RIGHT corner;
//   • a location with a regulatory record and no mapped project type draws a standalone
//     purple square (unchanged — it has no project symbol to ride on);
//   • one on/off switch owns the badge and the standalone squares, and touches NOTHING
//     in the Stage or Type dimensions.
//
// This suite covers the model half (lib/map.js). The rendered legend and the switch's
// effect on the live map are covered by test/map1-regulatory-toggle.browser.test.mjs.
//
// Run: node test/marker-regulatory-badge.test.mjs
let fails = 0;
const ok = (c, name, extra) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name + (extra !== undefined ? '  [' + extra + ']' : ''));
  if (!c) fails++;
};

global.window = { HS: {}, sessionStorage: { _v: null, getItem() { return this._v; }, setItem(k, v) { this._v = v; } } };
await import('../lib/templates.js');
await import('../lib/map.js');
const HS = global.window.HS;
const REG = HS.REGULATORY_LEGEND;
const frsRid = (s) => (s && s.registry_id != null) ? String(s.registry_id).trim() : '';
const track = (s) => HS.resolveTrackerMarker(s, frsRid);

// Production records, verbatim (ZIP 20171, pulled 2026-09-06) — the same three the
// dual-identity suites use, so the two units cannot disagree about the same rows.
const DUAL = { e: 1.482, n: 1.664, lat: 38.94932, lng: -77.36519,
  src: 'EPA FRS · registry 110071955663', type: 'built', label: 'CORESITE - VA1 DATA CENTER',
  layer: 'datacenter', scope: 'point', registry_id: '110071955663',
  record_url: 'https://echo.epa.gov/detailed-facility-report?fid=110071955663' };
const PLAIN_FAC = { type: 'built', label: 'ANDURIL INDUSTRIES, INC', layer: 'industrial',
  scope: 'point', registry_id: '110072041130', record_url: 'https://echo.epa.gov/x' };
const DC_PROJECT = { type: 'approved', label: 'Pennhurst Data Centers', layer: 'datacenter',
  use_type: 'Data Center', scope: 'point', record_url: 'https://plus.fairfaxcounty.gov/x' };

const dual = track(DUAL), plain = track(PLAIN_FAC), proj = track(DC_PROJECT);
const allOn = () => HS.categoryFilterKeys.forEach(k => HS.setCategoryFilter(k, true));
allOn();

// ── 1. THE TYPE ROW IS SEVEN PROJECT TYPES, AND REGULATED FACILITY IS NOT ONE ──────
ok(HS.typeFilterKeys.length === 7 && HS.typeFilterKeys.indexOf('facility') === -1,
  '1: the Type dimension is the seven project types — no facility', HS.typeFilterKeys.join(','));
ok(HS.SHAPE_LEGEND.length === 7 && !HS.SHAPE_LEGEND.some(r => r.categoryKey === 'facility'),
  '1b: the generated shape legend carries no facility row');
// …and it is absent from Status/Stage too. The Stage row is the four lifecycle chips.
const stageKeys = HS.STATUS_LEGEND_ROWS.filter(r => !r.squareSwatch).map(r => r.key);
ok(stageKeys.length === 4 && stageKeys.indexOf('facility') === -1,
  '1c: the Stage dimension is the four lifecycle stages — no facility', stageKeys.join(','));
// The Type row is GENERATED from the registry, so a new category cannot skip it.
ok(HS.typeFilterKeys.every(k => HS.CATEGORY_REGISTRY[k] && !HS.CATEGORY_REGISTRY[k].isFacility)
   && HS.categoryFilterKeys.length === HS.typeFilterKeys.length + 1,
  '1d: Type = every category key except the one facility key — derived, not hand-listed');

// ── 2. THE THIRD ROW EXISTS AND SAYS WHAT THE FOUNDER SET ─────────────────────────
ok(REG && REG.key === 'facility', '2: the regulatory row reuses the facility FILTER key', REG && REG.key);
ok(REG.heading === 'Regulatory records', '2b: row heading', REG.heading);
ok(REG.toggleLabel === 'Show regulatory facilities', '2c: toggle label', REG.toggleLabel);
ok(REG.helper === 'Purple R = environmental regulatory record. Includes EPA and linked state, '
                + 'local, tribal, and federal records.', '2d: helper text, verbatim', REG.helper);
ok(REG.letter === 'R' && REG.color === HS.markerRegistry.facilityHex,
  '2e: the badge is a capital R in the regulatory purple', REG.letter + ' ' + REG.color);
// The helper claims a RECORD, never a finding (development-tracker §10 legal framing).
ok(!/violat|pollut|harm|unsafe|danger/i.test(REG.helper),
  '2f: the helper states a regulatory record, never a verdict on any operator');

// ── 3. THE BADGE IS AN OVERLAY, NEVER A REPLACEMENT ───────────────────────────────
ok(dual.shape === HS.CATEGORY_REGISTRY.datacenter.symbol && dual.categoryKey === 'datacenter',
  '3: a regulated data centre still draws its DATA CENTER shape — the type symbol survives');
ok(dual.color !== REG.color, '3b: …and its LIFECYCLE colour — purple is the badge, not the pin');
ok(dual.signal && dual.signal.letter === 'R' && dual.signal.color === REG.color,
  '3c: …and carries the purple R as a subordinate signal');
ok(proj.signal === null && plain.signal === null,
  '3d: a project with no regulatory record, and a regulatory-only location, carry no badge');

// ── 4. REGULATORY-ONLY LOCATIONS KEEP THE STANDALONE PURPLE SQUARE ────────────────
ok(plain.categoryKey === 'facility' && plain.shape === 'square' && plain.color === REG.color,
  '4: a regulatory record with no mapped project type is a standalone purple square');
ok(REG.symbol === plain.shape,
  '4b: the legend names the same standalone symbol the renderer draws', REG.symbol);

// ── 5. GEOMETRY — LOWER-RIGHT, SECONDARY, AND LEGIBLE ─────────────────────────────
// Read out of the emitted markup, never from the constants that produced it.
const rect = (svg) => {
  const m = svg.match(/<rect x="([-\d.]+)" y="([-\d.]+)" width="([\d.]+)" height="([\d.]+)"/);
  return m ? { x: +m[1], y: +m[2], w: +m[3], h: +m[4] } : null;
};
[12, 14, 15, 20, 26].forEach((size) => {
  const svg = HS.markerSVG(dual.shape, dual.color, '', size, dual.signal);
  const b = rect(svg);
  const c = size / 2, r = size * 0.40;
  ok(!!b && b.w === b.h, '5.' + size + 'a: the badge is square-proportioned', b && b.w);
  // LOWER-RIGHT: its centre must sit right of and below the primary symbol's centre.
  ok(b && (b.x + b.w / 2) > c && (b.y + b.h / 2) > c,
    '5.' + size + 'b: badge centre is down-and-right of the pin centre',
    b && ((b.x + b.w / 2).toFixed(1) + ',' + (b.y + b.h / 2).toFixed(1)));
  // SECONDARY: strictly smaller than the primary symbol's width (2r).
  ok(b && b.w < r * 2, '5.' + size + 'c: strictly smaller than the primary symbol',
    b && (b.w.toFixed(1) + ' < ' + (r * 2).toFixed(1)));
  // LEGIBLE: never allowed to shrink below the floor, whatever the pin size.
  ok(b && b.w >= 7, '5.' + size + 'd: never smaller than the legibility floor', b && b.w);
  ok(/>R<\/text>/.test(svg), '5.' + size + 'e: the badge carries the white capital R');
});
// The badge is drawn AFTER the primary shape, which is what makes it an overlay rather
// than something the pin sits on top of.
const svg26 = HS.markerSVG(dual.shape, dual.color, '', 26, dual.signal);
ok(svg26.indexOf('<polygon') < svg26.indexOf('<rect'),
  '5f: the badge is painted ON TOP of the project marker, not beneath it');
// It must not move the record: same icon box as an unbadged pin of the same size.
const box = (x) => (x.match(/viewBox="([^"]+)"/) || [])[1];
ok(box(svg26) === box(HS.markerSVG(proj.shape, proj.color, '', 26, null)),
  '5g: badging a pin never changes its icon box — the record keeps its coordinate');

// ── 6. THE SWITCH OWNS THE BADGE, AND ONLY THE BADGE ──────────────────────────────
allOn();
ok(HS.regulatoryVisible() === true && HS.visibleSignal(dual) === dual.signal,
  '6: switch ON  -> the R is drawn');
HS.setCategoryFilter(REG.key, false);
ok(HS.regulatoryVisible() === false && HS.visibleSignal(dual) === null,
  '6b: switch OFF -> the R is not drawn');
// …and the project itself is NOT hidden by that: it still clears its Type membership.
ok(HS.categoryVisible(dual) === true,
  '6c: switch OFF -> the regulated DATA CENTRE is still on the map, as a plain data centre');
ok(HS.markerSVG(dual.shape, dual.color, '', 26, HS.visibleSignal(dual))
   === HS.markerSVG(dual.shape, dual.color, '', 26, null),
  '6d: …drawn byte-identically to any other data centre of its stage');
// …while the regulatory-ONLY location is hidden, because there the record IS the marker.
ok(HS.categoryVisible(plain) === false,
  '6e: switch OFF -> regulatory-only locations are hidden');
allOn();
ok(HS.categoryVisible(plain) === true, '6f: switch ON  -> they come back');

// ── 7. THE DIMENSIONS ARE INDEPENDENT — the founder's "must NOT change" list ───────
// Toggling regulatory must not change, reset or hide ANY Type filter, in either
// direction, and must not be changed BY them.
const snapshot = () => JSON.stringify(HS.typeFilterKeys.map(k => !!HS.getCategoryFilters()[k]));
allOn();
HS.setCategoryFilter('industrial', false);
HS.setCategoryFilter('civic', false);
const typesBefore = snapshot();
HS.setCategoryFilter(REG.key, false);
ok(snapshot() === typesBefore, '7: turning regulatory OFF leaves every Type filter exactly as it was', typesBefore);
HS.setCategoryFilter(REG.key, true);
ok(snapshot() === typesBefore, '7b: turning it back ON leaves them alone too', snapshot());
// …and the reverse: a Type click never moves the regulatory switch.
HS.setCategoryFilter(REG.key, false);
HS.typeFilterKeys.forEach(k => HS.setCategoryFilter(k, true));
ok(HS.regulatoryVisible() === false, '7c: restoring every Type filter never turns regulatory back on');
// Stage is a separate model entirely (STATUS_LEGEND_ROWS / FILTER on the page), so the
// structural guarantee is that the regulatory key is not one of the stage keys.
ok(stageKeys.indexOf(REG.key) === -1 && !HS.STATUS_LEGEND_ROWS.some(r => r.key === REG.key && !r.squareSwatch),
  '7d: the regulatory key is not a Stage bucket, so it cannot filter one');

// ── 8. ALL SEVEN TYPES OFF IS NOT AN EMPTY MAP WHEN REGULATORY IS ON ──────────────
// The page's "all types are hidden" note keys on this predicate; folding the regulatory
// key back into it would make the note unreachable whenever the switch was on.
HS.typeFilterKeys.forEach(k => HS.setCategoryFilter(k, false));
HS.setCategoryFilter(REG.key, true);
ok(HS.allTypeCategoriesOff() === true, '8: every Type off is reported as every Type off…');
ok(HS.allCategoriesOff() === false, '8b: …while the map is NOT category-empty — regulatory is on');
ok(HS.categoryVisible(plain) === true && HS.categoryVisible(dual) === true,
  '8c: …and the regulatory records are exactly what is still drawn');
HS.setCategoryFilter(REG.key, false);
ok(HS.allTypeCategoriesOff() === true && HS.allCategoriesOff() === true,
  '8d: types off AND regulatory off is genuinely empty');

// ── 9. DUAL IDENTITY (#1056) SURVIVES THE PRESENTATION SPLIT ──────────────────────
// Only the LEGEND moved. The filter key, the membership set and the one-marker rule are
// the same objects they were, which is what keeps the founder's acceptance scenario true.
allOn();
ok(JSON.stringify(HS.markerCategories(dual)) === JSON.stringify(['datacenter', 'facility']),
  '9: the dual record still holds exactly its two memberships');
HS.categoryFilterKeys.forEach(k => HS.setCategoryFilter(k, k === REG.key));
ok(HS.categoryVisible(dual) === true && track(DUAL).categoryKey === 'datacenter',
  '9b: every Type off + regulatory ON -> the regulated data centre is still there, still a data centre');
const list = [DUAL, PLAIN_FAC, DC_PROJECT].map(track);
ok(HS.filterByCategory(list).length === 2,
  '9c: …and it is counted ONCE, not once per membership', HS.filterByCategory(list).length);
allOn();
ok(HS.filterByCategory(list).length === 3, '9d: everything on -> three records, not four');

console.log(fails ? `\n${fails} FAILED` : '\nAll passed');
process.exit(fails ? 1 : 0);
