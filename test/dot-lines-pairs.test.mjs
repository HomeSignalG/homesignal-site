// Offline checks for the OHIO, MAINE and VERMONT points+lines PAIRS.
//
// WHY THIS EXISTS. A sweep of all 48 statewide registry entries (2026-08-23) asked one
// question of each: does the publisher ship a LINE layer alongside the POINT layer we wired?
// Three did, and in every case only the point layer was live:
//
//   OH  Projects/Current_Projects_Points   →  Projects/Current_Projects_Lines      1,827 rows
//   ME  MaineDOT_OpenData/MapServer/4      →  MaineDOT_OpenData/MapServer/5        1,138 rows
//   VT  AMP/FeatureServer/10               →  AMP/FeatureServer/9                    518 rows
//
// A polyline intersects many ZIP radii where a point sits in exactly one, and that reach is
// what drives dark pages: the same sweep found statewide-entry states run 17.3% dark while
// county-scoped-only states run 58.2%, and the difference tracks geometry, not presence.
//
// THE HAZARD THIS FILE GUARDS. Where the two layers describe the SAME projects, wiring both
// double-emits — the Houston-plats class, which exact-identity dedup CANNOT catch across two
// different source_registry_ids. Each POINTS entry therefore declares `yields_to` its LINES
// entry (the ARDOT/UDOT/Iowa mechanism). For Ohio the overlap is PROVEN (3 PID_NBR values from
// the lines layer match 9 rows in the points layer). For Maine and Vermont a small key sample
// matched nothing, which is evidence of low overlap and NOT proof of none — so the yield is
// declared there as a FAIL-SAFE. That is sound in both directions: the yields hook leaves a
// points record with no matching line untouched, so a yield on a disjoint pair is a structural
// no-op, while its absence on an overlapping pair is a silent doubling.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0;
const ok = (c, name, detail) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name + (!c && detail ? '\n     ' + detail : ''));
  if (!c) fails++;
};

const REG = JSON.parse(readFileSync(join(root, 'supabase/functions/get-address-report/jurisdiction-registry.json'), 'utf8'));
const byId = (id) => REG.arcgis.find((e) => e.registry_id === id);
const USE_TYPES = new Set(['Industrial', 'Development', 'Residential', 'Utility', 'Commercial', 'Civic/Public']);

const PAIRS = [
  { state: 'OH', pts: 'odot-current-projects', lin: 'odot-current-projects-lines',
    ptsUrl: 'https://tims.dot.state.oh.us/ags/rest/services/Projects/Current_Projects_Points/MapServer/0',
    linUrl: 'https://tims.dot.state.oh.us/ags/rest/services/Projects/Current_Projects_Lines/MapServer/0' },
  { state: 'ME', pts: 'maine-dot-public-projects', lin: 'maine-dot-public-projects-lines',
    ptsUrl: 'https://gis.maine.gov/mapservices/rest/services/dot/MaineDOT_OpenData/MapServer/4',
    linUrl: 'https://gis.maine.gov/mapservices/rest/services/dot/MaineDOT_OpenData/MapServer/5' },
  { state: 'VT', pts: 'vtrans-project-locations', lin: 'vtrans-project-locations-lines',
    ptsUrl: 'https://maps.vtrans.vermont.gov/arcgis/rest/services/Master/AMP/FeatureServer/10',
    linUrl: 'https://maps.vtrans.vermont.gov/arcgis/rest/services/Master/AMP/FeatureServer/9' },
];

for (const p of PAIRS) {
  const PTS = byId(p.pts), LIN = byId(p.lin);
  console.log(`\n── ${p.state} ─────────────────────────────────────────────`);
  ok(!!PTS && !!LIN, `${p.state}: both entries exist`);
  if (!PTS || !LIN) continue;

  // 1. Two layers of one publisher's project family
  ok(PTS.service_url === p.ptsUrl, `${p.state}: points entry reads the point layer`);
  ok(LIN.service_url === p.linUrl, `${p.state}: lines entry reads the line layer`);
  ok(LIN.dataset_url === p.linUrl, `${p.state}: lines dataset_url moved with service_url (a stale dataset_url points readers at the wrong layer)`);
  ok(LIN.coverage.length === 1 && !LIN.coverage[0].county && LIN.coverage[0].state === p.state,
    `${p.state}: coverage is statewide with no county — the registry contract allows this for a statewide dataset`);
  ok(JSON.stringify(LIN.coverage) === JSON.stringify(PTS.coverage), `${p.state}: both carry the same coverage`);

  // 2. THE DUPLICATE GUARD
  ok(PTS.yields_to === p.lin, `${p.state}: POINTS yields_to LINES — without it an overlapping pair silently doubles`);
  ok(!Object.hasOwn(LIN, 'yields_to'), `${p.state}: LINES yields to nothing — one-directional, or the pair cancels out`);
  ok(PTS.column_map.case_number === LIN.column_map.case_number,
    `${p.state}: both key case_number on '${LIN.column_map.case_number}' — the yield matches on it, so a differing key disables the guard silently`);

  // 3. use_type stays inside the closed six-value set
  if (LIN.use_type_const) {
    ok(USE_TYPES.has(LIN.use_type_const), `${p.state}: use_type_const '${LIN.use_type_const}' is canonical`);
  }
  if (LIN.type_map) {
    const bad = Object.entries(LIN.type_map).filter(([, v]) => !USE_TYPES.has(v));
    ok(bad.length === 0, `${p.state}: every type_map value is one of the six canonical use_types`, JSON.stringify(bad));
  }

  // 4. No stalled value may claim motion (the Bismarck lint, applied by hand here)
  const s2b = LIN.status_to_bucket;
  const moving = [...s2b.proposed, ...s2b.approved];
  const stalled = moving.filter((v) => /hold|stall|suspend|paus|dormant|inactive/i.test(v));
  ok(stalled.length === 0, `${p.state}: no stalled-sounding status is bucketed as proposed/approved`, JSON.stringify(stalled));
  const all = [...s2b.proposed, ...s2b.approved, ...s2b.operating, ...s2b.exclude];
  ok(new Set(all).size === all.length, `${p.state}: no status value is bucketed twice`);
}

// ── Per-state facts measured live, pinned so a later edit cannot quietly undo them ──
console.log('\n── live-measured specifics ───────────────────────────');
{
  // OHIO. The lines layer publishes 35 PRIMARY_WORK_CATEGORY values summing to 1,827 = the layer
  // count, so the vocabulary is complete rather than sampled. THIRTEEN of them never occur on the
  // points layer and were therefore absent from the points type_map; unmapped means unclassified,
  // and use_type drives the pin SHAPE. Each is resolved against a precedent already inside this
  // entry's own map — Traffic Control Maintenance → Utility, Shared Use Path / Bike Facility →
  // Utility, Interchange Expansion → Utility, Other Studies/ Tasks → Development — never invented.
  const OH = byId('odot-current-projects-lines');
  const OH_LIVE = ['Interchange Expansion', 'Other Building / Facility Work', 'Building Demolition',
    'Roadway Improvement (Jobs & Commerce)', 'Pavement Maintenance', 'Shared Use Path', 'Bridge Expansion',
    'Roadway Major Rehab', 'Geologic Maintenance / Slide Repair', 'New Roadway', 'Roadway Improvement (Safety)',
    'Traffic Control Maintenance', 'Bridge / Culvert Maintenance', 'Pedestrian Facilities', 'Bike Facility',
    'Roadside / Median Improvement (Safety)', 'Rest Area', 'Add Through Lane(s)', 'Traffic Control (Safety)',
    'Railroad Improvements & Rehabilitation', 'New Building/ Facility', 'Transport System Mgmt and Ops (TSMO)',
    'Enhanced Crossing', 'Intersection Improvement (Safety)', 'Roadway Minor Rehab', 'Emission Reduction',
    'Culvert Preservation', 'Noise Wall', 'Lighting (Safety)', 'Interchange Improvement (Safety)',
    'Guardrail / Roadside Maintenance', 'Asset Inventory / Inspection', 'Bridge Preservation',
    'Vegetative Maintenance', 'Parks'];
  ok(OH_LIVE.length === 35, 'OH: the pinned live vocabulary is all 35 values');
  const unmapped = OH_LIVE.filter((v) => !Object.hasOwn(OH.type_map, v));
  ok(unmapped.length === 0, 'OH: every one of the 35 live work categories is mapped — 0 of 1,827 rows land unclassified',
    JSON.stringify(unmapped));
  for (const [v, want] of [['Traffic Control (Safety)', 'Utility'], ['Pedestrian Facilities', 'Utility'],
                           ['Parks', 'Civic/Public'], ['Asset Inventory / Inspection', 'Development']]) {
    ok(OH.type_map[v] === want, `OH: '${v}' → ${want} (absent from the points map; follows this entry's own precedent)`);
  }
  // Live: PROJECT_PLANS_URL populated on 1,827 of 1,827, so record precision genuinely holds.
  ok(OH.record_url_precision === 'record' && OH.column_map.record_url === 'PROJECT_PLANS_URL',
    'OH: record-precision URL kept — PROJECT_PLANS_URL is populated on 1,827 of 1,827 line rows');

  // MAINE. reporting_status groupBy: 597 + 366 + 96 + 79 = 1,138 = the layer count. Every value was
  // already bucketed by the points entry, so no vocabulary change was needed here.
  const ME = byId('maine-dot-public-projects-lines');
  for (const [v, b] of [['1 - Awaiting Kick-Off', 'proposed'], ['2 - Design/Permitting Phase', 'proposed'],
                        ['3 - Construction Phase', 'approved'], ['4 - Construction Complete', 'operating']]) {
    ok(ME.status_to_bucket[b].includes(v), `ME: '${v}' → ${b}`);
  }

  // VERMONT. ProjectStatus groupBy: ACTIVE 300 + null 198 + ON HOLD 18 + CANCELLED 1 + COMPLETE 1
  // = 518 = the layer count. COMPLETE occurs ONLY on the lines layer and was unmapped.
  const VT = byId('vtrans-project-locations-lines');
  ok(VT.status_to_bucket.operating.includes('COMPLETE'),
    'VT: COMPLETE → operating (occurs only on the lines layer; was unmapped)');
  ok(VT.status_to_bucket.exclude.includes('ON HOLD') && VT.status_to_bucket.exclude.includes('CANCELLED'),
    'VT: ON HOLD + CANCELLED stay excluded — a stalled value must never claim motion');
  ok(!byId('vtrans-project-locations').status_to_bucket.operating.includes('COMPLETE'),
    'VT: the POINTS entry is left alone — COMPLETE does not occur there, and adding it would be an unmeasured edit');
}

console.log();
if (fails) { console.log(`${fails} check(s) FAILED`); process.exit(1); }
console.log('All dot-lines-pairs checks passed.');
