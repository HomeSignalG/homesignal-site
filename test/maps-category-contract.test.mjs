// Maps-backbone category/symbol/lifecycle contract — regression protection for the
// Del Valle maps-backbone repair. Offline: loads the REAL lib/map.js, no network, no DB.
//
// What this file locks down (the defects it exists to prevent recurring):
//   • 46% of Del Valle markers rendered as the generic circle, many for records whose
//     own name states a building class.
//   • "Civic/Public" was a real data category with NO legend row — silently relabelled
//     "Other project".
//   • `square` meant BOTH "Data center" and "Regulated facility" while the legend said
//     "pin shape shows project type".
//   • TABS records with no lifecycle evidence rendered green "Operating now" on the ZIP
//     tracker and grey "On file" on the app map — two pages, one record, two answers.
//   • lifecycle-unknown records were filtered under the "Operating" toggle.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const win = { HS: {} };
globalThis.window = win;
globalThis.document = { getElementById: () => null };
new Function('window', 'document', readFileSync(join(root, 'lib/map.js'), 'utf8'))(win, globalThis.document);
const HS = win.HS;

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.error('FAIL ' + msg); } };
const eq = (a, b, msg) => ok(a === b, `${msg} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
const M = (item, opts) => HS.resolveMarker(item, opts || {});

// ── 1. Every category has exactly one symbol and one legend label ─────────────
const REG = HS.CATEGORY_REGISTRY;
ok(REG && typeof REG === 'object', '1: CATEGORY_REGISTRY exists');
for (const k of Object.keys(REG)) {
  const c = REG[k];
  eq(c.key, k, `1: ${k} key matches its registry slot`);
  ok(typeof c.label === 'string' && c.label.length > 0, `1: ${k} has a label`);
  ok(typeof c.symbol === 'string' && c.symbol.length > 0, `1: ${k} has a symbol`);
}

// ── 2. Symbols are semantically unique — no symbol serves two categories ──────
{
  const bySymbol = {};
  for (const k of Object.keys(REG)) (bySymbol[REG[k].symbol] ||= []).push(k);
  const dupes = Object.entries(bySymbol).filter(([, ks]) => ks.length > 1);
  ok(dupes.length === 0, `2: no symbol maps to two categories (dupes: ${JSON.stringify(dupes)})`);
  ok(REG.datacenter.symbol !== REG.facility.symbol, '2: Data center and Regulated facility differ');
}

// ── 3/4. Facility precedence is absolute, both directions ────────────────────
{
  const f = M({ record_kind: 'facility', type: 'Residential', name: 'Kingswood Apartments' });
  eq(f.shape, REG.facility.symbol, '3: facility keeps the facility symbol despite a residential type');
  eq(f.categoryKey, 'facility', '3: facility categoryKey');
  const devShapes = Object.keys(REG).filter((k) => !REG[k].isFacility).map((k) => REG[k].symbol);
  for (const t of ['Residential', 'Commercial', 'Industrial', 'Data center', 'Civic/Public', 'unclassified']) {
    const m = M({ type: t, status: 'Approved', name: 'X' });
    ok(m.shape !== REG.facility.symbol, `4: development type "${t}" never gets the facility symbol`);
    ok(devShapes.includes(m.shape), `4: development type "${t}" resolves to a registered development symbol`);
  }
}

// ── 5. Civic/public is first-class ───────────────────────────────────────────
{
  const c = M({ type: 'Civic/Public', status: 'Approved', name: 'X' });
  eq(c.categoryKey, 'civic', '5: Civic/Public → civic category');
  eq(c.legendLabel, 'Civic & public', '5: civic legend label');
  ok(c.shape !== 'circle', '5: civic no longer draws the generic circle');
}

// ── 6. Austin-style names classify correctly (positive cases) ────────────────
const POSITIVE = [
  ['DEL VALLE HIGH SCHOOL', 'civic'],
  ['POPHAM ELEMENTARY SCHOOL DEMOLITION PROJECT', 'civic'],
  ['Austin Del Valle Fire & EMS Station', 'civic'],
  ['Travis County Fire Rescue ESD #11-station 1103', 'civic'],
  ['DEL VALLE CORRECTION FACILITY', 'civic'],
  ["TRAVIS COUNTY SHERIFF'S ACADEMY-DEL VALLE CORRECTIONAL COMPLEX", 'civic'],
  ['New Del Valle South Community Center', 'civic'],
  ['SOUTH AUSTIN REGIONAL WASTEWATER TREATMENT PLANT DECHLORINATION', 'infrastructure'],
  ['SARWWTP-LIFT STATION INTERCONNECT TUNNEL', 'infrastructure'],
  ['PEARCE LANE WASTEWATER LIFT STATION', 'infrastructure'],
  ['Giga Texas Offsite Reclaimed Waterline', 'infrastructure'],
  ['Central Texas Pipeline', 'infrastructure'],
  ['Stoney Ridge Substation', 'infrastructure'],
  ['SAND HILL ENERGY CENTER', 'infrastructure'],
  ['SCHMIDT PROPERTY (TELECOMMUNICATIONS TOWER AU54XC223)', 'infrastructure'],
  ['AUSTIN AIRPORT HOTEL', 'commercial'],
  ['Wingate Hotels', 'commercial'],
  ['Riverside Resort', 'commercial'],
  ['Ross Retail Center', 'commercial'],
  ['BURCH DRIVE BUSINESS PARK', 'commercial'],
  ['AAA Self-Storage Facility', 'commercial'],
  ['J.P. CAR WASHES', 'commercial'],
  ['BERGSTROM EAST COMMERCIAL SUBDIVISION', 'commercial'],   // commercial beats subdivision
  ['Austin Granite Warehouse', 'industrial'],
  ['TEXAS INDUSTRIAL MECHANICS, INC.', 'industrial'],
  ['Live Oak Brewery', 'industrial'],
  ['Kingswood Apartments', 'residential'],
  ['Kellam Multi Family Phase 1', 'residential'],
  ['DEERWOOD MANUFACTURED HOME DEVELOPMENT', 'residential'],
  ['BAPTIST SUBDIVISION', 'residential'],
  ['EAST TRAVIS HILLS, RESUBDIVISION OF LOT 20', 'residential'],
];
for (const [name, want] of POSITIVE) {
  eq(M({ type: 'unclassified', status: 'Approved', name }).categoryKey, want, `6: "${name}"`);
}

// ── 7. Adversarial names must NOT trigger a category ─────────────────────────
const NEGATIVE = [
  'AIRPORT FAST PARK PHASE II',              // "Park" is not civic
  'Longview Model Home Parking Lot 7',       // "Parking" is not civic/infrastructure
  'Lot 1, Block C',                          // states nothing
  'Sun Chase South Section 7 Final Plat',    // a plat/section number states no class
  'Amended Plat of Stoney Ridge Phase C Section 3A Lots 7A & 7B',
  'COTA Land',
  'Velocity Crossing',
  'APAC Texas-Buck',
  // Cross-state false positives found in the national audit — must NOT classify:
  '2760 Gattis School Rd - Rezoning',                       // street name, not a school
  '4001 Smith School Road',                                 // street name
  'Special Event: Water Safety Day Held By Aqua Ducks Swim School',  // private business
  'Change of Use of Land to Trade School (Truck Driving) School',    // private business
  'Acton Business School',                                  // private business
  'Accessory Structure 10x10 Accessory Storage Shed in backyard',    // residential shed
  'Attached Garage addition with unconditioned storage above',       // residential
  '720 sq ft Detached Pole Building for Workshop and Personal Storage',
  'AAA STORAGE HWY 71 EAST',                                // states no storage NOUN
];
for (const name of NEGATIVE) {
  const m = M({ type: 'unclassified', status: 'Approved', name });
  eq(m.categoryKey, 'other', `7: adversarial "${name}" stays the honest fallback`);
  ok(typeof m.fallbackReason === 'string' && m.fallbackReason.length > 0, `7: "${name}" carries a fallback reason`);
}
// Word-boundary proofs: the substring must not fire the rule.
eq(M({ type: 'unclassified', status: 'Approved', name: 'Schooner Bay Marina' }).categoryKey, 'other', '7: "Schooner" ≠ school');
eq(M({ type: 'unclassified', status: 'Approved', name: 'Broadway Retail' }).categoryKey, 'commercial', '7: Broadway+Retail → commercial, not infrastructure');

// ── 8. Missing lifecycle never defaults to operating ─────────────────────────
{
  eq(M({ type: 'Commercial', status: '', name: 'X' }).lifecycle, 'unknown', '8: blank status → unknown');
  eq(M({ type: 'Commercial', status: 'On file', name: 'X' }).lifecycle, 'unknown', '8: "On file" → unknown');
  eq(M({ type: 'Commercial', status: 'Wat', name: 'X' }).lifecycle, 'unknown', '8: unrecognised status → unknown');
  ok(M({ type: 'Commercial', status: '', name: 'X' }).lifecycle !== 'operating', '8: never silently operating');
  eq(M({ type: 'Commercial', status: '', name: 'X' }).filterKey, 'unknown', '8: unknown filters as unknown, not operating');
  ok(HS.statusFilterKeys.includes('unknown'), '8: unknown is a real filter bucket');
}

// ── 9. TABS-shaped records normalise consistently across pages ───────────────
{
  // ZIP-tracker shape (development_reports.sites): TABS carries NO bucket, NO status_raw.
  // The ENGINE fix (supabase/functions/get-address-report/sources/tdlr-tabs.ts) stops
  // TABS stamping a lifecycle it cannot evidence: it emits NO `type`/`bucket` and an
  // explicit lifecycle_unknown_reason. The client then resolves it to `unknown`.
  const tabsSite = { layer: 'industrial', label: 'TABS project', project_no: 'TABS2026011928',
                     lifecycle_unknown_reason: 'TDLR TABS registry mode states no project status' };
  const tracker = HS.resolveTrackerMarker(tabsSite, (x) => x.registry_id || '');
  eq(tracker.lifecycle, 'unknown', '9: TABS on the ZIP tracker → unknown (not Operating now)');
  // app_projects shape (same record after the materializer): status 'On file'.
  const app = M({ type: 'industrial', status: 'On file', name: 'TABS project' });
  eq(app.lifecycle, 'unknown', '9: TABS on the app map → unknown');
  eq(tracker.lifecycle, app.lifecycle, '9: the SAME record shows the SAME lifecycle on both pages');
  eq(tracker.shape, app.shape, '9: …and the same symbol');
  // A record WITH evidence still resolves normally.
  eq(HS.resolveTrackerMarker({ type: 'built', bucket: 'operating', use_type: 'Commercial', label: 'X' }, () => '').lifecycle,
     'operating', '9: an engine-bucketed record is still operating');
}

// ── 11. Marker / popup / sidebar / legend agree ──────────────────────────────
{
  const m = M({ type: 'Civic/Public', status: 'Approved', name: 'Del Valle High School' });
  ok(m.popupLabel.includes('Del Valle High School'), '11: popup names the record');
  const legendLabels = HS.SHAPE_LEGEND.map((r) => r.label).concat([REG.facility.label]);
  ok(legendLabels.includes(m.legendLabel), '11: the marker legend label exists in the shape legend');
  const legendShapes = HS.SHAPE_LEGEND.map((r) => r.shape).concat([REG.facility.symbol]);
  ok(legendShapes.includes(m.shape), '11: the marker symbol exists in the shape legend');
}

// ── 6b/12. Legend integrity — generated from the registry, both directions ───
{
  for (const row of HS.SHAPE_LEGEND) {
    ok(!!REG[row.categoryKey], `12: legend row "${row.label}" maps to a real category`);
    eq(row.shape, REG[row.categoryKey].symbol, `12: legend row "${row.label}" symbol matches the registry`);
    eq(row.label, REG[row.categoryKey].label, `12: legend row "${row.label}" label matches the registry`);
  }
  const legendKeys = new Set(HS.SHAPE_LEGEND.map((r) => r.categoryKey));
  for (const k of Object.keys(REG)) {
    if (REG[k].isFacility) continue;
    ok(legendKeys.has(k), `12: category "${k}" has a legend row`);
  }
  // Every lifecycle value has a documented colour + legend meaning.
  const lcKeys = new Set(HS.STATUS_LEGEND_ROWS.map((r) => r.key));
  for (const k of HS.LIFECYCLE_KEYS) ok(lcKeys.has(k), `12: lifecycle "${k}" has a legend row`);
  for (const row of HS.STATUS_LEGEND_ROWS) ok(/^#[0-9a-f]{6}$/i.test(row.hex), `12: lifecycle "${row.key}" has a hex colour`);
}

// ── 12b. Every registered symbol actually renders geometry ──────────────────
for (const k of Object.keys(REG)) {
  const svg = HS.shapeEl(REG[k].symbol, 12, 12, 8, '#000', 3);
  ok(/^<(polygon|rect|circle)\b/.test(svg), `12b: symbol "${REG[k].symbol}" (${k}) renders a real shape`);
}

// ── 14. Marker totals are unchanged by classification (nothing may vanish) ───
{
  const inputs = POSITIVE.map(([name]) => ({ type: 'unclassified', status: 'Approved', name }))
    .concat(NEGATIVE.map((name) => ({ type: 'unclassified', status: 'Approved', name })));
  const out = inputs.map((i) => M(i));
  eq(out.length, inputs.length, '14: every input yields exactly one marker');
  ok(out.every((m) => m.shape && m.categoryKey && m.lifecycle), '14: every marker is fully resolved');
}

console.log(`maps-category-contract: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
