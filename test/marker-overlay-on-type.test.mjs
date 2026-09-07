// OVERLAY-ON-TYPE — GLOBAL. Regulatory is an overlay on every Map 1, not a pin
// and not a ZIP exception.
//
// ⚖️ FOUNDER RULING 2026-09-07 (reversing the keep-purple pin; restoring Type
// membership that #1121 dropped). `HS.resolveMarker` is the sole pin authority
// for all ~12,722 ZIP reports, address mode, 2D / 3D aerial / satellite, and
// the dashboard preview. A classifiable EPA record draws Type shape + operating
// colour + purple R. Regulatory OFF drops the R and leaves the Type pin.
// Unmapped EPA (no classifiable class field) stay a purple square, hidden when
// overlay is off. Classification is CLASS FIELDS ONLY — the name is not a Type.
//
// Run: node test/marker-overlay-on-type.test.mjs
let fails = 0;
const ok = (c, name, extra) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name + (extra !== undefined ? '  [' + extra + ']' : ''));
  if (!c) fails++;
};

global.window = { HS: {}, sessionStorage: { _v: null, getItem() { return this._v; }, setItem(k, v) { this._v = v; } } };
await import('../lib/templates.js');
await import('../lib/map.js');
const HS = global.window.HS;
const statusOperating = HS.resolveMarker({ type: 'Industrial', status: 'Operating' }).color;
const lcOperating = HS.LIFECYCLE_HEX.operating;
const frsRid = (s) => (s && s.registry_id != null) ? String(s.registry_id).trim() : '';
const track = (s) => HS.resolveTrackerMarker(s, frsRid);
const fac = (fields) => HS.resolveMarker(Object.assign({ record_kind: 'facility', status: 'Operating' }, fields));

const allOn = () => HS.categoryFilterKeys.forEach(k => HS.setCategoryFilter(k, true));
allOn();

// ── 1. GLOBAL CLASS-FIELD TABLE — not a 78617 special case ───────────────────────
const CLASS_FIELDS = [
  { type: 'industrial', want: 'industrial', shape: 'triangle', label: 'Industrial' },
  { type: 'logistics', want: 'industrial', shape: 'triangle', label: 'Industrial' },
  { type: 'commercial', want: 'commercial', shape: 'hexagon', label: 'Commercial' },
  { type: 'energy', want: 'infrastructure', shape: 'diamond', label: 'Roads & infrastructure' },
  { type: 'residential', want: 'residential', shape: 'pentagon', label: 'Residential' },
  { type: 'civic', want: 'civic', shape: 'cross', label: 'Civic & public' },
  { layer: 'industrial', want: 'industrial', shape: 'triangle', label: 'Industrial' },
  { layer: 'logistics', want: 'industrial', shape: 'triangle', label: 'Industrial' },
  { layer: 'commercial', want: 'commercial', shape: 'hexagon', label: 'Commercial' },
  { layer: 'energy', want: 'infrastructure', shape: 'diamond', label: 'Roads & infrastructure' }
];
CLASS_FIELDS.forEach((c, i) => {
  const mk = fac({ name: 'EPA ' + i, type: c.type, layer: c.layer });
  ok(mk.overlayOnType === true && mk.categoryKey === c.want && mk.shape === c.shape
     && mk.color === statusOperating && mk.color !== REG.color
     && mk.signal && mk.signal.letter === 'R' && mk.signal.color === REG.color
     && JSON.stringify(mk.categories) === JSON.stringify([c.want, 'facility'])
     && mk.filterKey === 'facility',
    '1.' + i + ': class field ' + JSON.stringify(c.type || c.layer) + ' → ' + c.want + ' + R, not a purple pin',
    mk.shapeRule + ' ' + mk.color);
});

// ── 2. DE-ANDA TRUCKING is logistics → Industrial — an example of §1, not a one-off
const deAnda = fac({ name: 'DE-ANDA TRUCKING', type: 'logistics' });
ok(deAnda.categoryKey === 'industrial' && deAnda.shape === 'triangle'
   && deAnda.overlayOnType === true && deAnda.color !== REG.color
   && /Industrial/.test(deAnda.popupLabel) && /Regulated facility/.test(deAnda.popupLabel)
   && deAnda.popupLabel.indexOf('Industrial') < deAnda.popupLabel.indexOf('Regulated facility'),
  '2: DE-ANDA TRUCKING (type logistics) is Industrial · Regulated facility',
  deAnda.popupLabel);
const deAndaTrack = track({ type: 'built', label: 'DE-ANDA TRUCKING', layer: 'logistics',
  registry_id: '110034291059' });
ok(deAndaTrack.categoryKey === 'industrial' && deAndaTrack.shape === 'triangle'
   && deAndaTrack.color === lcOperating && deAndaTrack.signal && deAndaTrack.signal.letter === 'R',
  '2b: the Map 1 tracker path (layer:logistics) is the same Industrial overlay',
  deAndaTrack.color + ' ' + deAndaTrack.shapeRule);

// ── 3. THE NAME IS NOT A TYPE ────────────────────────────────────────────────────
ok(fac({ name: 'DE-ANDA TRUCKING' }).categoryKey === 'facility'
   && fac({ name: 'DE-ANDA TRUCKING' }).shape === 'square'
   && fac({ name: 'DE-ANDA TRUCKING' }).color === REG.color
   && !fac({ name: 'DE-ANDA TRUCKING' }).signal,
  '3: a trucking NAME with no class field stays the unmapped purple square — we do not invent Type from the label');
ok(fac({ type: 'industrial', name: 'Residential Water Treatment Co' }).categoryKey === 'industrial'
   && fac({ type: 'industrial', name: 'Residential Water Treatment Co' }).shape === 'triangle',
  '3b: a stated Industrial class is not stolen by words in the name');
ok(track({ type: 'built', label: 'CYRUS ONE DATA HALL 1 POWER POD 1', layer: 'energy',
           registry_id: '110038203734' }).categoryKey === 'infrastructure'
   && !track({ type: 'built', label: 'CYRUS ONE DATA HALL 1 POWER POD 1', layer: 'energy',
               registry_id: '110038203734' }).isDataCenter,
  '3c: energy class + data-hall NAME is Roads & infrastructure overlay, not a data centre');

// ── 4. UNMAPPED EPA STAY THE PURPLE SQUARE ───────────────────────────────────────
const unmapped = fac({ name: 'GENERIC EPA SITE 99' });
ok(unmapped.categoryKey === 'facility' && unmapped.shape === 'square'
   && unmapped.color === REG.color && !unmapped.signal && !unmapped.overlayOnType
   && JSON.stringify(unmapped.categories) === JSON.stringify(['facility']),
  '4: no classifiable class field → standalone purple square, no R');

// ── 5. THE SWITCH OWNS THE R, NOT THE TYPE PIN ───────────────────────────────────
allOn();
ok(HS.visibleSignal(deAnda) === deAnda.signal, '5: Regulatory ON → the R is drawn');
HS.setCategoryFilter(REG.key, false);
ok(HS.visibleSignal(deAnda) === null && HS.categoryVisible(deAnda) === true,
  '5b: Regulatory OFF → R gone, Industrial pin still visible');
ok(HS.categoryVisible(unmapped) === false,
  '5c: Regulatory OFF → unmapped purple square is hidden');
HS.setCategoryFilter('industrial', false);
ok(HS.categoryVisible(deAnda) === false,
  '5d: Industrial OFF + Regulatory OFF → the overlay record is hidden');
HS.setCategoryFilter(REG.key, true);
ok(HS.categoryVisible(deAnda) === true && deAnda.categoryKey === 'industrial',
  '5e: Type OFF + Regulatory ON → still visible via facility membership, still Industrial');
allOn();

// ── 6. DUAL-IDENTITY DATA CENTRES ARE UNCHANGED ──────────────────────────────────
const dual = track({ type: 'built', label: 'CORESITE - VA1 DATA CENTER', layer: 'datacenter',
  registry_id: '110071955663' });
ok(dual.shapeRule === 'DUAL:datacenter+facility' && dual.categoryKey === 'datacenter'
   && dual.shape === 'octagon' && dual.signal && dual.signal.letter === 'R',
  '6: a stated data-centre EPA record is still dual identity, not overlay-on-industrial');

console.log(fails ? `\n${fails} FAILED` : '\nAll passed');
process.exit(fails ? 1 : 0);
