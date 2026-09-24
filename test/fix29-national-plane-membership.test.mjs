// FIX 29 — PROXIMITY IS NOT MEMBERSHIP.
//
// public.national_dc_for_zip(p_zip, p_radius_mi => 5) selects national data-center records
// within a 5-mile great-circle radius of development_reports.home_lat/home_lng — a ZIP
// CENTROID. On a ZIP page with no authoritative whole-ZIP geography that distance was the
// ONLY thing asserting the record belongs to the ZIP.
//
// MEASURED ON PRODUCTION 2026-09-15, before the fix:
//   12,722 canonical ZIP pages · 12,016 with a usable geo.zcta_boundary polygon · 706 without
//   351 of those 706 rendered 1,597 dot placements drawn from 141 distinct records
//   Cross-tab with ZERO contradictory rows: maps_zip_geography_status 'boundary_complete'
//   holds for exactly the 12,013 canonical ZIPs carrying a polygon, 'not_measured' for
//   exactly the 706 that do not (3 more carry a polygon but no status row -> 'unknown').
//
// SCOPE. This is a MEMBERSHIP gate, not a containment test and not a classifier change.
// A ZIP that HAS geography keeps today's behaviour exactly, including a national record near
// the centroid but outside the polygon — that population is Fix 28's.
import { readFileSync } from 'node:fs';

let fails = 0;
const ok = (c, name, detail) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name);
  if (!c) { fails++; if (detail !== undefined) console.log('   got: ' + JSON.stringify(detail)); }
};

global.window = {};
const load = (p) => new Function(readFileSync(new URL(p, import.meta.url), 'utf8'))();
load('../lib/n5-radius.js');
load('../lib/zip-authoritative.js');
const HS = global.window.HS;

const PAGE = readFileSync(new URL('../homesignalmap.html', import.meta.url), 'utf8');
const LIB  = readFileSync(new URL('../lib/zip-authoritative.js', import.meta.url), 'utf8');

// Real producer shapes (measured 2026-09-04/15 against app_zip_projects_markers).
const NOT_MEASURED = { zip: '01004', mode: 'authoritative', status: 'not_measured',
                       projects: null, markers: null };
const UNKNOWN      = { zip: '94128', mode: 'authoritative', status: 'unknown',
                       projects: null, markers: null };
const COMPLETE     = { zip: '78617', mode: 'authoritative', status: 'boundary_complete',
                       projects: [], markers: [] };

// ── TEST A — NON-POLYGON ZIP: centroid/radius records are NOT admitted ───────────────────
ok(HS.nationalPlaneAdmitted(NOT_MEASURED) === false,
   '[A] not_measured ZIP (01004) refuses the centroid/radius national plane');
ok(HS.nationalPlaneAdmitted(UNKNOWN) === false,
   '[A] unknown-status ZIP refuses it too (fails closed, never admits on an unread state)');

// ── TEST B — POLYGON ZIP: legitimate behaviour is untouched ──────────────────────────────
ok(HS.nationalPlaneAdmitted(COMPLETE) === true,
   '[B] boundary_complete ZIP (78617) still admits the national plane');
ok(HS.nationalPlaneAdmitted({ ...COMPLETE, projects: [{ project_ref: 'p1' }], markers: [{ lat: 1, lng: 2 }] }) === true,
   '[B] a populated boundary_complete ZIP admits it as well');
// A measured ZERO is a real measurement and must NOT be downgraded to "no geography".
ok(HS.zipAuthOutcome(COMPLETE) === 'complete' && HS.nationalPlaneAdmitted(COMPLETE) === true,
   '[B] a measured-zero ZIP ([] / []) is complete, not not_measured — admission survives');

// ── TEST C — NEARBY BUT OUTSIDE: proximity alone cannot create membership ────────────────
// The gate never receives a distance, so no distance can ever flip it. Asserted directly:
// the same payload decides identically whatever the records claim about nearness.
const near = { distance_mi: 0.01 }, far = { distance_mi: 4.99 };
ok([near, far].every(() => HS.nationalPlaneAdmitted(NOT_MEASURED) === false),
   '[C] a record 0.01 mi from the centroid is still refused on a non-polygon ZIP');
ok(HS.nationalPlaneAdmitted.length === 1,
   '[C] the gate takes ONLY the geography payload — no radius/distance/centroid parameter');

// ── TEST D — NO CENTROID FALLBACK MAY BE REINTRODUCED ────────────────────────────────────
// Structural pins on the page, scoped to the statements they are about (a pin that names the
// string it forbids must not also search the whole file for it).
const natlLine = (PAGE.match(/^.*var natlSites = .*$/m) || [''])[0];
ok(/!natlAdmitted \? \[\] :/.test(natlLine),
   '[D] natlSites is gated on natlAdmitted at construction', natlLine.trim());
ok(/var natlAdmitted = HS\.nationalPlaneAdmitted\(auth\);/.test(PAGE),
   '[D] admission is computed from the authoritative payload the page already fetched');
// The gate must sit BEFORE the sites are built, or a record is accepted then hidden.
ok(PAGE.indexOf('var natlAdmitted =') < PAGE.indexOf('var natlSites ='),
   '[D] the gate precedes site construction (membership, not visibility)');
// Both render branches consume the gated variable — neither may rebuild from natl.records.
const branches = PAGE.match(/sites: [^\n]*natlSites[^\n]*/g) || [];
ok(branches.length === 2, '[D] both render branches use the gated natlSites', branches.length);
ok(!/\.concat\(\s*natl\.records/.test(PAGE),
   '[D] no branch concatenates raw natl.records, bypassing the gate');
// ONE definition of usable ZIP geography — the new name must delegate, not re-test.
ok(/HS\.nationalPlaneAdmitted = function \(payload\) \{\s*return HS\.zipAuthIsComplete\(payload\);/.test(LIB),
   '[D] nationalPlaneAdmitted delegates to zipAuthIsComplete (no second definition)');
// No centroid/radius vocabulary may creep into the ZIP-mode membership contract.
ok(!/(centroid|radius|buffer|nearest)/i.test(
     (LIB.match(/HS\.nationalPlaneAdmitted = function[\s\S]*?\n  \};/) || [''])[0]),
   '[D] the gate body contains no centroid/radius/buffer/nearest logic');

// ── TEST E — THE CANONICAL DATA CENTER CLASSIFIER IS UNTOUCHED ───────────────────────────
// The classifier moved verbatim from lib/map.js to lib/project-type.js (2026-09-24). "The
// classifier" is that file now, so every [E] check reads it; the assertions are unchanged.
const MAP = readFileSync(new URL('../lib/project-type.js', import.meta.url), 'utf8');
ok(/const DATACENTER_RE = \/data\\s\*cent\(\?:er\|re\|e\)\|data\\s\*hall\|hyperscale\|server\\s\*farm\/i;/.test(MAP),
   '[E] DATACENTER_RE is unchanged');
ok(/const DATACENTER_NOT_RE = /.test(MAP) && /const DATACENTER_SERVING_RE = /.test(MAP)
   && /const DATACENTER_COMPETING_RE = /.test(MAP),
   '[E] both stated-data-centre guards (street + incidental) still present');
ok(/const DATACENTER_CLASS_FIELDS = \['type', 'type_raw', 'use_type', 'layer', 'category'\];/.test(MAP),
   '[E] the class-field precedence list is unchanged');
ok(!/nationalPlaneAdmitted/.test(MAP),
   '[E] Fix 29 introduced nothing into the classifier');

// ── FIX 28 NON-INTERFERENCE ──────────────────────────────────────────────────────────────
// Fix 28 is about dots OUTSIDE an existing polygon, i.e. ZIPs that HAVE one. Those ZIPs are
// exactly the case this gate admits, so its population cannot be masked by this change.
ok(HS.nationalPlaneAdmitted(COMPLETE) === true,
   '[F28] polygon-backed ZIPs still admit the plane — Fix 28 stays independently testable');
ok(!/ST_Intersects|inside|containment/i.test(
     (LIB.match(/HS\.nationalPlaneAdmitted = function[\s\S]*?\n  \};/) || [''])[0]),
   '[F28] Fix 29 performs no containment test and cannot pre-empt Fix 28');

// ── NO GEOGRAPHY FABRICATION ─────────────────────────────────────────────────────────────
ok(HS.nationalPlaneAdmitted(null) === false && HS.nationalPlaneAdmitted(undefined) === false
   && HS.nationalPlaneAdmitted({}) === false,
   '[G] a missing/unreadable payload refuses — never admits by default');

console.log(fails ? `\n${fails} FAILED` : '\nAll checks passed');
process.exit(fails ? 1 : 0);
