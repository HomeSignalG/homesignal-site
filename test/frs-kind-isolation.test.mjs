// KIND ISOLATION — the page-side half, pinned so it cannot quietly stop being a defence.
//
// public.app_zip_projects_markers filters PROJECTS by p_kind but reads MARKERS unfiltered:
//     select ... from geo.zip_authoritative_marker k where k.zcta5 = p_zip;
// Measured read-only against production on ZIP 84302 (2026-09-05): with that ZIP's 22 real
// EPA FRS facilities simulated as facility markers, the shipped unfiltered read returns 210
// markers where the kind-filtered read returns 188 — the live development count exactly. So
// once facility rows exist, every facility marker rides out inside the development payload.
//
// docs/frs-facility-kind-isolation-migration.sql is the fix (record_kind on both relations,
// both reads filtered, both prefix-rebuild DELETEs scoped). It is parked, not applied, while
// another session's national development build is still rebuilding those relations.
//
// Until then — and after it, as a second line of defence — the PAGE is what stops a
// contaminated payload from becoming a wrong pin: HS.zipAuthSitesFrom only builds a site when
// the marker's project_ref resolves to a hydrated project of the requested kind. That
// property is currently incidental (it exists because a marker with no project has no content
// to draw), and incidental safety is exactly the kind that disappears in a refactor. This file
// makes it a requirement.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('FAIL ' + m); } };

// Load the shipped module the way the page does — a bare script hanging helpers off window.
global.window = {};
new Function(readFileSync(join(root, 'lib/zip-authoritative.js'), 'utf8'))();
const HS = global.window.HS;
ok(typeof HS.zipAuthSitesFrom === 'function', '0: shipped lib/zip-authoritative.js loaded');

// A development payload that, under the CURRENT unfiltered marker read, has been handed two
// facility markers alongside its own. Shapes taken from production: development project_refs
// are registry source keys, facility ones are 'epa_frs:<RegistryId>'.
const payload = {
  mode: 'authoritative', zip: '84302', status: 'boundary_complete',
  projects: [
    { project_ref: 'arcgis:udot-active-projects:1042', name: 'SR-13 widening',
      status: 'Approved', type: 'Roads & infrastructure',
      source_ref: 'https://example.gov/record/1042', registry_id: 'udot-active-projects' },
    { project_ref: 'socrata:x:y:PZ-2026-0007', name: 'Willard South subdivision',
      status: 'Proposed', type: 'Residential',
      source_ref: 'https://example.gov/record/PZ-2026-0007', registry_id: 'brigham-cases' },
  ],
  markers: [
    { project_ref: 'arcgis:udot-active-projects:1042', marker_seq: 1, lat: 41.51, lng: -112.02, marker_rule: 'LINE_MERGED_COMPONENT_INTERVAL_1000M' },
    { project_ref: 'socrata:x:y:PZ-2026-0007', marker_seq: 1, lat: 41.52, lng: -112.03, marker_rule: 'POINT_AUTHORITATIVE' },
    // the contamination: facility markers with no matching development project
    { project_ref: 'epa_frs:110070171250', marker_seq: 1, lat: 41.49, lng: -112.05, marker_rule: 'POINT_AUTHORITATIVE' },
    { project_ref: 'epa_frs:110005052085', marker_seq: 1, lat: 41.50, lng: -112.06, marker_rule: 'POINT_AUTHORITATIVE' },
  ],
};

const sites = HS.zipAuthSitesFrom(payload);

// ── 1. no facility marker becomes a rendered object in a development read ────────────
ok(sites.length === 2, `1: 2 sites drawn from 4 markers — got ${sites.length}`);
ok(!sites.some((s) => String(s.zip_project_ref || '').startsWith('epa_frs:')),
  '1: no epa_frs marker produced a site');
ok(HS.zipAuthProjectCount(sites) === 2,
  `1: project count counts projects, not stray markers — got ${HS.zipAuthProjectCount(sites)}`);

// ── 2. every site it DOES draw is a development object, never a facility one ─────────
// lib/zip-authoritative.js rule 2: registry_id must stay free for frsRid()'s use, so an
// authoritative development site carries source identity on `src` and no registry_id.
for (const s of sites) {
  ok(s.relevance === 'development', `2: site relevance is development (${s.relevance})`);
  ok(s.registry_id === undefined,
    '2: an authoritative development site sets no registry_id — frsRid() must not read it as a facility');
  ok(s.scope === 'point', '2: site scope is point');
  ok(s.distance_mi === undefined && s.e === undefined && s.n === undefined,
    '2: ZIP mode sets no distance and no e/n — there is no HOME');
}

// ── 3. the guard is load-bearing: give the facility markers matching projects and they
//       DO become sites. Without this, test 1 could pass because the helper is broken.
const withFacProjects = {
  ...payload,
  projects: payload.projects.concat([
    { project_ref: 'epa_frs:110070171250', name: 'AGGREGATE HAULERS DEL VALLE',
      status: 'Operating', type: 'industrial',
      source_ref: 'https://echo.epa.gov/detailed-facility-report?fid=110070171250' },
  ]),
};
ok(HS.zipAuthSitesFrom(withFacProjects).length === 3,
  '3: the drop is caused by the missing project, not by a broken helper');

// ── 4. a not-measured read still yields nothing, whatever markers arrive ─────────────
ok(HS.zipAuthSitesFrom({ ...payload, status: 'not_measured', projects: null, markers: null }).length === 0,
  '4: not_measured yields no sites');
ok(HS.zipAuthOutcome({ ...payload, status: 'not_measured', projects: null, markers: null }) === 'not_measured',
  '4: not_measured is reported as itself, never as measured-and-empty');

// ── 5. the parked migration says what it must, so the fix cannot drift from this test ──
const mig = readFileSync(join(root, 'docs/frs-facility-kind-isolation-migration.sql'), 'utf8');
for (const needle of ['mm.record_kind = p_kind', 'k.record_kind = p_kind',
                      'zip_authoritative_membership', 'zip_authoritative_marker',
                      "record_kind = 'development'"]) {
  ok(mig.includes(needle), `5: migration carries ${needle}`);
}
ok(/NOT APPLIED/.test(mig), '5: the migration states its application status');

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
