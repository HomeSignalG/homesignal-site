// REGULATORY IS AN OVERLAY ON TYPE, NOT A WAY PAST THE TYPE ROW.
//
// ⚖️ FOUNDER RULING 2026-09-15, after the same confusion was reported twice from live ZIP
// pages. `HS.categoryVisible` was a flat any-of over the membership set, which made
// `facility` an EXISTENCE GRANT outranking the Type dimension:
//
//   78617 Del Valle — Data center the only Type checked → 30 pins, 0 data centres
//   75009 Celina    — Data center the only Type checked → 27 pins, 0 data centres
//
// All 57 were EPA industrial/energy records admitted by `facility` while their own Type
// chip was OFF, drawn with the Type silhouette the resident had just unchecked. Turning
// Regulatory off then emptied the map, which read as "regulatory hides data centres".
//
// The records below are VERBATIM production rows (app_projects, both ZIPs, pulled
// 2026-09-15) — the real names are what makes the contradiction legible: a resident asking
// for data centres was shown CELINA HOT MIX PLANT.
//
// WHY THIS IS A UNIT TEST AND NOT ONLY A BROWSER ONE: the rule is a predicate over filter
// state, and the browser suite can only drive the states a page exposes. Here every one of
// the twelve (typed / untyped) x (Type on / Type off / no Type at all) x (reg on / off)
// combinations is asserted directly, including the ones no chip layout can currently reach.
//
// Run: node test/map1-regulatory-not-a-type-bypass.test.mjs
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0;
const ok = (c, name, extra) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name + (extra !== undefined ? '  [' + extra + ']' : ''));
  if (!c) fails++;
};

function loadHS() {
  const win = { HS: {}, HS_CONFIG: { DATA_SOURCE: 'seed' } };
  const doc = { getElementById: () => null, querySelectorAll: () => [], querySelector: () => null };
  new Function('window', 'document', readFileSync(join(ROOT, 'lib/map.js'), 'utf8'))(win, doc);
  return win.HS;
}
const HS = loadHS();

// Only Type keys are set here; `facility` is driven separately so a test can never
// accidentally assert the regulatory limb through a Type chip.
function setFilters(typeKeys, reg) {
  HS.categoryFilterKeys.forEach(k => HS.setCategoryFilter(k, false));
  (typeKeys || []).forEach(k => HS.setCategoryFilter(k, true));
  HS.setCategoryFilter(HS.REGULATORY_LEGEND.key, !!reg);
}

// ── production records, verbatim ────────────────────────────────────────────────────
// 75009 Celina: 27 EPA facilities, 26 `industrial` + 1 `logistics`. Zero data centres in
// the ZIP — the text probe for data-centre terms returned 0 of 51 rows.
const CELINA_BATCH_PLANT = { record_kind: 'facility', registry_id: '110070011520',
  name: 'CONCRETE BATCH PLANT CELINA', type: 'industrial', status: 'Operating' };
const CELINA_HOT_MIX = { record_kind: 'facility', registry_id: '110034213642',
  name: 'CELINA HOT MIX PLANT', type: 'industrial', status: 'Operating' };
const CELINA_COSTCO = { record_kind: 'facility', registry_id: '110072107590',
  name: 'COSTCO WAREHOUSE - CELINA', type: 'logistics', status: 'Operating' };
// 78617 Del Valle: the LAYER_EXACT:energy overlay, which is `infrastructure`, not Industrial.
const DELVALLE_POWER = { record_kind: 'facility', registry_id: '110000455322',
  name: 'SANDHILL POWER PLANT', type: 'energy', status: 'Operating' };
// A TxDOT road project — an ordinary typed record with NO regulatory membership.
const TXDOT_SEAL_COAT = { record_kind: 'development', registry_id: 'txdot-projects-info-all',
  name: 'FM 455 Seal Coat, Pavement Markings, Mill & Inlay', type: 'Utility',
  status: 'Approved', type_raw: 'Seal Coat' };

// ── 0. the fixtures are what this test thinks they are ──────────────────────────────
// Without this the assertions below could pass over records that classify some other way,
// which is the shape of a test that agrees with itself and with nothing else.
const m = (x) => HS.resolveMarker(x);
ok(m(CELINA_BATCH_PLANT).typeKey === 'industrial' && m(CELINA_BATCH_PLANT).isFacility,
  '0a: the Celina batch plant is a TYPED regulatory record (industrial + facility)',
  m(CELINA_BATCH_PLANT).shapeRule);
ok(m(CELINA_COSTCO).typeKey === 'industrial',
  '0b: COSTCO (logistics) maps to Industrial, per the 2026-09-07 ruling', m(CELINA_COSTCO).shapeRule);
ok(m(DELVALLE_POWER).typeKey === 'infrastructure',
  '0c: SANDHILL POWER PLANT (energy) maps to Roads & infrastructure', m(DELVALLE_POWER).shapeRule);
ok(m(TXDOT_SEAL_COAT).typeKey === 'infrastructure' && !m(TXDOT_SEAL_COAT).isFacility,
  '0d: the TxDOT job is a typed record with NO regulatory membership', m(TXDOT_SEAL_COAT).shapeRule);
ok(JSON.stringify(m(CELINA_BATCH_PLANT).categories) === '["industrial","facility"]',
  '0e: MEMBERSHIP IS UNCHANGED — still [typeKey, facility]',
  JSON.stringify(m(CELINA_BATCH_PLANT).categories));

// ── 1. THE REPORTED DEFECT — Data center checked, nothing else ──────────────────────
setFilters(['datacenter'], true);
ok(!HS.categoryVisible(CELINA_BATCH_PLANT),
  '1a: Data center ON + Regulatory ON → an industrial EPA record is NOT shown');
ok(!HS.categoryVisible(CELINA_HOT_MIX) && !HS.categoryVisible(CELINA_COSTCO)
   && !HS.categoryVisible(DELVALLE_POWER),
  '1b: …and neither are the hot-mix plant, the Costco, or the power plant');
ok([CELINA_BATCH_PLANT, CELINA_HOT_MIX, CELINA_COSTCO, DELVALLE_POWER, TXDOT_SEAL_COAT]
     .filter(HS.categoryVisible).length === 0,
  '1c: the whole Celina/Del Valle sample draws ZERO pins under Data center — the honest answer');

// ── 2. THE PIN THE RULING PROTECTS — Regulatory OFF leaves the Type pin ─────────────
setFilters(['industrial'], true);
ok(HS.categoryVisible(CELINA_BATCH_PLANT), '2a: Industrial ON + Regulatory ON → shown');
setFilters(['industrial'], false);
ok(HS.categoryVisible(CELINA_BATCH_PLANT),
  '2b: Industrial ON + Regulatory OFF → STILL SHOWN. The switch drops the R, never the pin');
ok(!HS.categoryVisible(DELVALLE_POWER),
  '2c: …and the energy record is correctly absent — its Type is infrastructure, not Industrial');

// ── 3. REGULATORY NEVER ADMITS A RECORD ────────────────────────────────────────────
// ⚖️ SUPERSEDED 2026-09-15. This section previously asserted the opposite: that with no
// Type selected the switch showed EPA records ("all types off except EPA"). Under the
// ruling regulatory is ALWAYS an independent overlay, so no Type selected means no base
// pin, and the switch changes nothing about that.
setFilters([], true);
ok(!HS.categoryVisible(CELINA_BATCH_PLANT) && !HS.categoryVisible(DELVALLE_POWER),
  '3a: NO Type selected + Regulatory ON → NOTHING is shown; the switch admits no record');
ok(!HS.categoryVisible(TXDOT_SEAL_COAT),
  '3b: …and an ordinary project is hidden too — the state is genuinely empty');
setFilters([], false);
ok(!HS.categoryVisible(CELINA_BATCH_PLANT),
  '3c: NO Type + Regulatory OFF → identical; the switch is not a variable in this answer');

// ── 4. AN UNTYPED REGULATORY RECORD HAS NO BASE PIN, IN ANY SWITCH STATE ───────────
// ⚖️ SUPERSEDED 2026-09-15 (was: "governed by the switch alone"). A record matching no
// selected Type has no base pin, and regulatory may not render one — so the switch cannot
// make it appear or disappear. THAT is what stops a pin vanishing on a regulatory toggle.
// MEASURED, so the change is known to cost nothing: 0 of 216,405 production facility
// records are untyped (industrial 154,512 · energy 37,281 · logistics 23,868 ·
// datacenter 744), so this shape is a contract guard, not a live population.
const UNTYPED_FAC = { record_kind: 'facility', registry_id: '110000000001',
  name: 'A REGULATED LOCATION WITH NO STATED CLASS', status: 'Operating' };
ok(JSON.stringify(m(UNTYPED_FAC).categories) === '["facility"]',
  '4a: an unclassifiable EPA record carries facility membership ALONE',
  JSON.stringify(m(UNTYPED_FAC).categories));
ok(m(UNTYPED_FAC).shape === 'square',
  '4b: …and draws the standalone purple square', m(UNTYPED_FAC).shape);
setFilters(HS.typeFilterKeys, true);
ok(!HS.categoryVisible(UNTYPED_FAC),
  '4c: ALL types ON + Regulatory ON → no base pin; it matches no Type');
setFilters(HS.typeFilterKeys, false);
ok(!HS.categoryVisible(UNTYPED_FAC),
  '4d: ALL types ON + Regulatory OFF → IDENTICAL. The switch cannot remove what it cannot add');
setFilters(['datacenter'], true);
ok(!HS.categoryVisible(UNTYPED_FAC),
  '4e: one Type ON + Regulatory ON → still no base pin');

// ── 5. THE DEFAULT VIEW IS UNCHANGED, AND SO IS REGULATORY-OFF OVER IT ──────────────
// The regression that would matter most: this ruling must not remove a single pin from the
// view a resident lands on, and Regulatory OFF over that view must still remove none.
const SAMPLE = [CELINA_BATCH_PLANT, CELINA_HOT_MIX, CELINA_COSTCO, DELVALLE_POWER,
                TXDOT_SEAL_COAT, UNTYPED_FAC];
setFilters(HS.typeFilterKeys, true);
const defaultOn = SAMPLE.filter(HS.categoryVisible).length;
setFilters(HS.typeFilterKeys, false);
const defaultRegOff = SAMPLE.filter(HS.categoryVisible).length;
ok(defaultOn === 5, '5a: ALL types ON + Regulatory ON → all 5 TYPED records draw', defaultOn);
ok(defaultRegOff === 5,
  '5b: ALL types ON + Regulatory OFF → THE SAME 5. Not one base pin leaves on a toggle',
  defaultRegOff);

// ── 6. THE OLD BEHAVIOUR IS REFUSED, NAMED ─────────────────────────────────────────
// A flat any-of is what produced both live reports. Asserted as its own check so a future
// "simplification" back to one loop fails here with the reason, not just a count.
setFilters(['datacenter'], true);
const flatAnyOf = (item) => HS.markerCategories(item)
  .some(k => HS.getCategoryFilters()[k]);
ok(flatAnyOf(CELINA_BATCH_PLANT) && !HS.categoryVisible(CELINA_BATCH_PLANT),
  '6: the flat any-of WOULD admit this record and the shipped rule does not — the fix is live');

console.log('\n' + (fails ? fails + ' FAILURE(S)' : 'all checks passed'));
process.exit(fails ? 1 : 0);
