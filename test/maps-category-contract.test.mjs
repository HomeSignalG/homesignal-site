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
const SRC = readFileSync(join(root, 'lib/map.js'), 'utf8');
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

// ── 12c. The POLYGON path renders the right number of vertices ──────────────
// This is what verify-maps' browser assertion `dashboard-no-triangle-marker` was really
// trying to prove. It could not prove it: that check required a live dashboard to happen to
// contain an `industrial` record, so it failed whenever the visitor's ZIP had none — a data
// condition reported as a rendering defect, red daily since at least 2026-08-02. The claim is
// deterministic and belongs here, where it always runs.
{
  const vertices = (svg) => {
    const m = svg.match(/points="([^"]+)"/);
    return m ? m[1].trim().split(/\s+/).filter(Boolean).length : 0;
  };
  eq(vertices(HS.shapeEl('triangle', 12, 12, 8, '#000', 3)), 3, '12c: triangle renders exactly 3 points');
  eq(vertices(HS.shapeEl('diamond', 12, 12, 8, '#000', 3)), 4, '12c: diamond renders exactly 4 points');
  eq(vertices(HS.shapeEl('pentagon', 12, 12, 8, '#000', 3)), 5, '12c: pentagon renders exactly 5 points');
  eq(vertices(HS.shapeEl('hexagon', 12, 12, 8, '#000', 3)), 6, '12c: hexagon renders exactly 6 points');
  eq(vertices(HS.shapeEl('octagon', 12, 12, 8, '#000', 3)), 8, '12c: octagon renders exactly 8 points');
  // And at least one registered category actually USES the polygon path, so the assertions
  // above cannot become dead letters if the registry is ever rewritten to circles only.
  ok(Object.keys(REG).some((k) => ['triangle', 'diamond', 'pentagon', 'hexagon', 'octagon'].includes(REG[k].symbol)),
    '12c: some category still uses a polygon symbol');
}

// ── 13. TYPE symbols are GEOMETRICALLY distinguishable, not just differently named ──
// §2 compares symbol NAMES. Necessary, and NOT sufficient: 'octagon' and 'circle' are
// different strings whose rendered silhouettes are ~95% identical at the 14px legend
// size, so Data center and Other project shipped to production as the same dot while §2
// stayed green the whole time. A name-uniqueness test cannot see that class of defect,
// so this section measures the SHIPPED geometry instead.
//
// METRIC — silhouette distance = 1 - IoU of the two filled shapes, rasterised from
// HS.shapeEl at the real 14px legend/marker size. Max RADIAL deviation was tried first
// and rejected: it scored cross-vs-circle at 0.98px, BELOW hexagon-vs-circle, because a
// plus sign's arms reach nearly the circle's radius even though nobody would confuse the
// two. Area disagreement tracks what a person actually sees.
//
// THRESHOLD — measured, not guessed. Among the seven symbols this repo pins, the weakest
// pair is octagon vs hexagon (Data center vs Commercial) at ~8%. The proven production
// failure was octagon vs circle at ~5%. FLOOR sits in that measured gap: it catches the
// real defect without falsely condemning any symbol a completed workstream owns.
{
  const SIZE = 14, cc = SIZE / 2, rr = SIZE * 0.40;
  const FLOOR = 0.07;        // every TYPE pair must clear this
  const OTHER_BAR = 0.25;    // the residual bucket must be UNMISTAKABLE, not merely legal

  // Parse a shapeEl string into an inside(x,y) predicate. Covers the three primitives
  // shapeEl can emit; an unknown one throws rather than silently scoring as distinct.
  function predicate(svg) {
    let m;
    if ((m = svg.match(/<circle cx="(\S+?)" cy="(\S+?)" r="(\S+?)"/))) {
      const x0 = +m[1], y0 = +m[2], rad = +m[3];
      return (x, y) => (x - x0) ** 2 + (y - y0) ** 2 <= rad * rad;
    }
    if ((m = svg.match(/<rect x="(\S+?)" y="(\S+?)" width="(\S+?)" height="(\S+?)" rx="(\S+?)"/))) {
      const x0 = +m[1], y0 = +m[2], w = +m[3], h = +m[4], rx = +m[5];
      const ix0 = x0 + rx, ix1 = x0 + w - rx, iy0 = y0 + rx, iy1 = y0 + h - rx;
      return (x, y) => {
        const px = Math.min(Math.max(x, ix0), ix1), py = Math.min(Math.max(y, iy0), iy1);
        return (x - px) ** 2 + (y - py) ** 2 <= rx * rx + 1e-9;
      };
    }
    if ((m = svg.match(/points="([^"]+)"/))) {
      const pts = m[1].trim().split(/\s+/).map((p) => p.split(',').map(Number));
      return (x, y) => {
        let inside = false;
        for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
          const [xi, yi] = pts[i], [xj, yj] = pts[j];
          if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
        }
        return inside;
      };
    }
    throw new Error('13: unrecognised geometry from shapeEl: ' + svg.slice(0, 60));
  }
  const HALF = 12, STEP = 0.1, N = Math.round(2 * HALF / STEP);
  function raster(sym) {
    const inside = predicate(HS.shapeEl(sym, cc, cc, rr, '#000', 3));
    const g = new Uint8Array(N * N);
    for (let iy = 0; iy < N; iy++) {
      const y = cc - HALF + (iy + 0.5) * STEP;
      for (let ix = 0; ix < N; ix++) {
        if (inside(cc - HALF + (ix + 0.5) * STEP, y)) g[iy * N + ix] = 1;
      }
    }
    return g;
  }
  function distance(a, b) {
    let inter = 0, uni = 0;
    for (let i = 0; i < a.length; i++) { const x = a[i], y = b[i]; if (x && y) inter++; if (x || y) uni++; }
    return uni ? 1 - inter / uni : 0;
  }

  const keys = Object.keys(REG);
  const grid = {};
  for (const k of keys) grid[REG[k].symbol] = raster(REG[k].symbol);

  // 13a. THE GUARD IS LOAD-BEARING. Before asserting the live set passes, prove the metric
  // FAILS the exact production defect this section exists to prevent. Without this, a
  // metric that quietly stopped discriminating would score a clean green forever.
  grid.circle = grid.circle || raster('circle');
  const proven = distance(grid.circle, grid.octagon);
  ok(proven < FLOOR,
    `13a: the metric still catches the shipped defect — circle vs octagon scored ${(proven * 100).toFixed(1)}%, must be under the ${(FLOOR * 100).toFixed(0)}% floor`);

  // 13b. No two TYPE symbols may be materially indistinguishable at production size.
  let worst = { d: 1, a: '', b: '' };
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const sa = REG[keys[i]].symbol, sb = REG[keys[j]].symbol;
      const d = distance(grid[sa], grid[sb]);
      if (d < worst.d) worst = { d, a: keys[i], b: keys[j] };
      ok(d >= FLOOR,
        `13b: ${keys[i]} (${sa}) vs ${keys[j]} (${sb}) silhouette distance ${(d * 100).toFixed(1)}% — must be >= ${(FLOOR * 100).toFixed(0)}%`);
    }
  }
  console.log(`      [13] weakest TYPE pair: ${worst.a} vs ${worst.b} at ${(worst.d * 100).toFixed(1)}% (floor ${(FLOOR * 100).toFixed(0)}%)`);

  // 13c. Other project is the residual bucket — the one a resident is most likely to meet
  // and the one that has no other cue to fall back on. It must be UNMISTAKABLE against
  // every classified type, not merely past the floor.
  for (const k of keys) {
    if (k === 'other') continue;
    const d = distance(grid[REG.other.symbol], grid[REG[k].symbol]);
    ok(d >= OTHER_BAR,
      `13c: Other project (${REG.other.symbol}) vs ${k} (${REG[k].symbol}) is ${(d * 100).toFixed(1)}% — must be >= ${(OTHER_BAR * 100).toFixed(0)}%`);
  }

  // 13d. The symbols two completed workstreams own are not collateral of this one.
  eq(REG.datacenter.symbol, 'octagon', '13d: Data center still owns the octagon');
  eq(REG.commercial.symbol, 'hexagon', '13d: Commercial still owns the hexagon');
  eq(REG.facility.symbol, 'square', '13d: Regulated facility still owns the square');

  // 13e. ORPHAN GEOMETRY. KEYWORD_RULES / NAME_RULES carry literal `shape:` values that
  // bypass the registry, so a rule can emit a shape no legend row explains — exactly what
  // the school rule did (it drew the Other-project circle while declaring typeKey 'civic',
  // and moving `other` to the capsule would have left that circle explaining nothing).
  // Every shape any rule can emit must be a symbol some category owns.
  const owned = new Set(Object.values(REG).map((c) => c.symbol));
  const literals = [...SRC.matchAll(/\{ re: \/(?:[^/\\]|\\.)*\/[a-z]*,[^}]*?shape: '([a-z]+)'/g)].map((m) => m[1]);
  ok(literals.length >= 10, `13e: the rule scan still finds the rule table (found ${literals.length} literal shapes)`);
  for (const sh of new Set(literals)) {
    ok(owned.has(sh), `13e: rule-emitted shape "${sh}" is owned by a registry category`);
  }
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
