// PROJECT GRAIN vs GEOMETRY-MARKER GRAIN — Map 1 ZIP mode.
//
// THE DEFECT THIS EXISTS TO PREVENT RECURRING. Map 1 renders ZIP-mode development at MARKER
// grain, which is correct for geography: a road corridor clipped to a ZCTA is drawn as one
// marker per ~1km of its length (marker_rule LINE_MERGED_COMPONENT_INTERVAL_1000M), and every
// one of those markers sits on the project's own geometry. What was wrong is that the resident-
// facing COUNT and the Proposed/Approved/Operating RAILS also ran at marker grain, so one road
// project read as many projects.
//
// Measured in production 2026-09-05 (snapshot: membership objects == marker objects == 595,759,
// the two halves agreeing, so the numbers are from one coherent state):
//   ZIP 84029  -> 8 real projects, 221 markers. ONE UDOT project ("I-80/84; WWD RAMP UPGRADES",
//                 type_raw "Traffic and Safety", Approved, spanning 16 ZIPs) owns 188 of them.
//   nationally -> 4,813 of 7,663 populated ZIP pages overstated their project count, and road-
//                 corridor line geometry accounted for 91,046 of the 99,402 excess markers.
//   multi-ZIP  -> 6,263 of 16,135 road-corridor projects intersect more than one ZIP (max 44),
//                 which is legitimate and must NOT be de-duplicated away.
//
// Offline: drives the SHIPPED lib/*.js against the real shapes the production RPC returns, plus
// static guards that homesignalmap.html is actually wired to them (a helper nothing calls is not
// a fix). No network, no DB.
import { readFileSync } from 'node:fs';

let fails = 0;
const ok = (c, name, detail) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name);
  if (!c) { fails++; if (detail !== undefined) console.log('   got: ' + JSON.stringify(detail)); }
};
const eq = (a, b, name) => ok(a === b, `${name} (want ${JSON.stringify(b)}, got ${JSON.stringify(a)})`);

// -- load the libs the way the page loads them ------------------------------------------------
global.window = {};
global.document = { getElementById: () => null };
const load = (p) => new Function('window', 'document',
  readFileSync(new URL(p, import.meta.url), 'utf8'))(global.window, global.document);
load('../lib/map.js');
load('../lib/n5-radius.js');
load('../lib/zip-authoritative.js');
const HS = global.window.HS;
const PAGE = readFileSync(new URL('../homesignalmap.html', import.meta.url), 'utf8');

ok(typeof HS.zipAuthCollapseToProjects === 'function', 'the project-grain helper is shipped');

// ── the real 84029 shape, at the grain the RPC actually returns ───────────────────────────────
// One UDOT corridor with 188 markers + 7 other real projects, exactly as measured.
const UDOT = {
  project_ref: 'arcgis:udot-active-projects-lines:6382',
  name: 'I-80/84; WWD RAMP UPGRADES I-80; MP .00 - 192.00',
  type: 'Utility', status: 'Approved',
  source_ref: 'https://data-uplan.opendata.arcgis.com/datasets/udot-project',
  registry_id: 'udot-active-projects-lines',
};
const OTHERS = Array.from({ length: 7 }, (_, i) => ({
  project_ref: 'arcgis:udot-active-projects-lines:other' + i,
  name: 'SR-36 project ' + i, type: 'Utility', status: i % 2 ? 'Proposed' : 'Approved',
  source_ref: 'https://data-uplan.opendata.arcgis.com/datasets/udot-project',
  registry_id: 'udot-active-projects-lines',
}));
const markersFor = (ref, n, rule) => Array.from({ length: n }, (_, i) => ({
  project_ref: ref, marker_seq: i + 1, lat: 40.6 + i * 0.001, lng: -112.4 + i * 0.001,
  marker_rule: rule,
}));
const PAYLOAD_84029 = {
  zip: '84029', mode: 'authoritative', status: 'boundary_complete',
  projects: [UDOT, ...OTHERS],
  markers: [
    ...markersFor(UDOT.project_ref, 188, 'LINE_MERGED_COMPONENT_INTERVAL_1000M'),
    ...OTHERS.flatMap((p, i) => markersFor(p.project_ref, [9, 6, 5, 4, 4, 3, 2][i],
      'LINE_MERGED_COMPONENT_INTERVAL_1000M')),
  ],
};

const sites84029 = HS.zipAuthSitesFrom(PAYLOAD_84029);
const rows84029 = HS.zipAuthCollapseToProjects(sites84029);
eq(sites84029.length, 221, '84029 — marker grain is preserved: 221 markers still drawable');
eq(rows84029.length, 8, '84029 — project grain: 8 resident-facing project rows');
eq(HS.zipAuthProjectCount(sites84029), 8, '84029 — the freshness line already said 8, and still does');
eq(HS.zipAuthProjectCount(rows84029), 8, '84029 — count and list now agree');
eq(rows84029.filter((r) => r.zip_project_ref === UDOT.project_ref).length, 1,
   '84029 — the 188-marker UDOT corridor produces exactly ONE project row');
eq(sites84029.filter((s) => s.zip_project_ref === UDOT.project_ref).length, 188,
   '84029 — and remains geographically represented by all 188 markers');

// ── DETERMINISM: marker order must never decide what the resident reads ───────────────────────
const shuffled = sites84029.slice().reverse();
const a = HS.zipAuthCollapseToProjects(sites84029).map((r) => r.zip_marker_seq).join(',');
const b = HS.zipAuthCollapseToProjects(shuffled).map((r) => r.zip_marker_seq).join(',');
eq(b, a.split(',').reverse().join(','), 'representative is order-independent (same seq per project)');
ok(HS.zipAuthCollapseToProjects(shuffled).every((r) => !r.zip_project_ref || r.zip_marker_seq === 1),
   'representative is the lowest marker_seq — the largest component, not the first array entry');

// ── CONTROL 1 — POINT project: 1 project, 1 row, 1 marker ─────────────────────────────────────
const pointPayload = {
  zip: '17601', status: 'boundary_complete',
  projects: [{ project_ref: 'arcgis:penndot-transportation-projects:1', name: 'Bridge Improvement — SR 4020 over L',
              type: 'Utility', status: 'Proposed', source_ref: 'https://penndot.example/1',
              registry_id: 'penndot-transportation-projects' }],
  markers: [{ project_ref: 'arcgis:penndot-transportation-projects:1', marker_seq: 1, lat: 40.06, lng: -76.3,
              marker_rule: 'POINT_AUTHORITATIVE' }],
};
const pSites = HS.zipAuthSitesFrom(pointPayload);
eq(pSites.length, 1, 'CONTROL point — 1 marker');
eq(HS.zipAuthCollapseToProjects(pSites).length, 1, 'CONTROL point — 1 project row');

// ── CONTROL 2 — LINE project: 1 row, many geographically correct markers ──────────────────────
const lSites = sites84029.filter((s) => s.zip_project_ref === UDOT.project_ref);
eq(HS.zipAuthCollapseToProjects(lSites).length, 1, 'CONTROL line — 1 project row');
eq(lSites.length, 188, 'CONTROL line — 188 markers retained');
ok(lSites.every((s) => typeof s.lat === 'number' && typeof s.lng === 'number'),
   'CONTROL line — every retained marker keeps real coordinates');

// ── CONTROL 3 — POLYGON / multi-component project ─────────────────────────────────────────────
const polyPayload = {
  zip: '06385', status: 'boundary_complete',
  projects: [{ project_ref: 'arcgis:ctdot-project-work-areas:9', name: 'Route 85 CTSS Upgrade',
              type: 'Utility', status: 'Approved', source_ref: 'https://ctdot.example/9',
              registry_id: 'ctdot-project-work-areas' }],
  markers: markersFor('arcgis:ctdot-project-work-areas:9', 4, 'POLYGON_COMPONENT_POINT_ON_SURFACE'),
};
const polySites = HS.zipAuthSitesFrom(polyPayload);
eq(polySites.length, 4, 'CONTROL polygon — all 4 component markers retained');
eq(HS.zipAuthCollapseToProjects(polySites).length, 1, 'CONTROL polygon — 1 project row');

// ── CONTROL 4 — MULTI-ZIP: once per ZIP, never de-duplicated across ZIPs ──────────────────────
// The read is per-ZIP, so the same corridor arrives in two SEPARATE payloads. Both must list it.
const zipA = HS.zipAuthCollapseToProjects(HS.zipAuthSitesFrom({
  zip: '84029', status: 'boundary_complete', projects: [UDOT],
  markers: markersFor(UDOT.project_ref, 188, 'LINE_MERGED_COMPONENT_INTERVAL_1000M') }));
const zipB = HS.zipAuthCollapseToProjects(HS.zipAuthSitesFrom({
  zip: '84017', status: 'boundary_complete', projects: [UDOT],
  markers: markersFor(UDOT.project_ref, 121, 'LINE_MERGED_COMPONENT_INTERVAL_1000M') }));
eq(zipA.length, 1, 'CONTROL multi-ZIP — the corridor appears once on ZIP 84029');
eq(zipB.length, 1, 'CONTROL multi-ZIP — and once on ZIP 84017 (16 ZIPs in production)');

// ── CONTROL 5 — DATA CENTER typing/rendering unchanged ────────────────────────────────────────
const dcSite = HS.zipAuthSiteFromMarker(
  { project_ref: 'dc1', marker_seq: 1, lat: 41, lng: -112, marker_rule: 'POINT_AUTHORITATIVE' },
  { project_ref: 'dc1', name: 'Project Stratos Data Center', type: 'Data center', status: 'Proposed',
    source_ref: 'https://x/1', registry_id: 'r' });
const dcM = HS.resolveMarker(dcSite);
eq(dcM.typeKey, 'datacenter', 'CONTROL data center — typeKey unchanged');
eq(dcM.shape, 'octagon', 'CONTROL data center — symbol unchanged');
eq(HS.zipAuthCollapseToProjects([dcSite]).length, 1, 'CONTROL data center — passes through the collapse');

// ── CONTROL 6 — REGULATED FACILITY unchanged, and never collapsed together ────────────────────
// Facilities come from the cached report and carry NO zip_project_ref. Keying them on a shared
// falsy value would collapse an entire facility rail into one row — the trap this asserts against.
const facs = [
  { scope: 'point', relevance: 'facility', label: 'ACME Plating', registry_id: '110000111', _facility: true },
  { scope: 'point', relevance: 'facility', label: 'Bar H Feeders', registry_id: '110000222', _facility: true },
  { scope: 'point', relevance: 'facility', label: 'Wonder Valley LLC', registry_id: '110000333', _facility: true },
];
eq(HS.zipAuthCollapseToProjects(facs).length, 3, 'CONTROL facility — 3 facilities stay 3 rows');
const fm = HS.resolveMarker(facs[0]);
eq(fm.typeKey, 'facility', 'CONTROL facility — typeKey unchanged');
eq(fm.shape, 'square', 'CONTROL facility — symbol unchanged');

// ── CONTROL 7 — ADDRESS MODE untouched ────────────────────────────────────────────────────────
// Address-mode sites never carry zip_project_ref, so the helper is an identity function on them:
// same length, same order, same object references.
const addrSites = [
  { scope: 'point', relevance: 'development', type: 'proposed', use_type: 'Utility', label: 'A', distance_mi: 0.4 },
  { scope: 'point', relevance: 'development', type: 'approved', use_type: 'Residential', label: 'B', distance_mi: 1.2 },
  { scope: 'area', relevance: 'development', label: 'County notice' },
];
const addrOut = HS.zipAuthCollapseToProjects(addrSites);
eq(addrOut.length, addrSites.length, 'CONTROL address mode — length unchanged');
ok(addrOut.every((s, i) => s === addrSites[i]), 'CONTROL address mode — identical objects, identical order');

// ── THE TYPE THE RESIDENT READS: NAME / TYPE / STAGE ──────────────────────────────────────────
// The Type comes from the SHARED resolver, so the word and the pin shape cannot disagree.
const roadSite = HS.zipAuthSiteFromMarker(
  { project_ref: 'r1', marker_seq: 1, lat: 30.2, lng: -97.7, marker_rule: 'LINE_MERGED_COMPONENT_INTERVAL_1000M' },
  { project_ref: 'r1', name: 'IH 35 from US 290 to SH 71 — Capital Express Central', type: 'Utility',
    status: 'Proposed', source_ref: 'https://txdot.example/1', registry_id: 'txdot-projects-info-all' });
const rm = HS.resolveMarker(roadSite);
eq(rm.legendLabel, 'Roads & infrastructure', 'Type word for a road corridor');
eq(rm.shape, 'diamond', 'Type symbol for a road corridor — matches the legend row');
eq(roadSite.zip_authoritative, true, 'ZIP-authoritative records are flagged, so the Type line is scoped to them');
eq(HS.n5BucketFromStatus(roadSite.use_type ? 'Proposed' : ''), 'proposed', 'stage stays a separate fact');

// ── STATIC WIRING GUARDS — a helper nothing calls is not a fix ────────────────────────────────
ok(/var rows = HS\.zipAuthCollapseToProjects\(sites\);/.test(PAGE),
   'page computes the project-grain set');
ok(/var permits = rows\.filter\(isDevPoint\);/.test(PAGE),
   'the rails read PROJECT grain');
ok(/drawMap\(data, sites\.filter\(/.test(PAGE),
   'the MAP still reads MARKER grain — geography is not collapsed');
ok(/function typeLabelFor\(s\)\{/.test(PAGE), 'the Type-label helper is shipped');
ok(/var tline = typeLabelFor\(s\);/.test(PAGE), 'the popup renders NAME / TYPE / STAGE');
ok(/var tag = typeLabelFor\(s\) \|\| LAYER_LABEL/.test(PAGE),
   'the rail row shows the real Type instead of the literal "Development"');
ok(/lib\/zip-authoritative\.js\?v=20260905b/.test(PAGE),
   'the changed shared runtime is cache-busted, so no browser serves the old copy');

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
