// KNOWN GAP, PINNED (docs/denton-workstream-b-2026-10-14.md section 2): the widened ZIP scope decides a LINE/POLYGON project's membership by its
// PIN (the half-length point / area centroid), but serving membership (docs/n5-generation-publish.sql step 1) is ST_Intersects of the WHOLE geometry.
// A TxDOT polyline that crosses a ZIP polygon, lies outside the legacy +-3 mi square, and whose pin falls outside the polygon is therefore
// EXCLUDED by the widened fetch although serving would include it. This is the second cause behind the Denton audit's TxDOT "never ingested" ids
// (32 of 34 missing), after the centroid-square scope that the widened scope already fixes for points.
// Run: node test/scope-nonpoint-membership-gap.test.mjs
// This test asserts TODAY'S behaviour so that closing the gap (a geometry-aware membership RPC) has to move it ON PURPOSE.
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { arcgisForZip } = await import(pathToFileURL(join(root, 'supabase/functions/get-address-report/sources/arcgis.ts')).href);
const REG = JSON.parse(readFileSync(join(root, 'supabase/functions/get-address-report/jurisdiction-registry.json'), 'utf8')).arcgis;
const TX = REG.find((e) => e.registry_id === 'txdot-projects-info-all');
let fails = 0, n = 0;
const ok = (c, m, d) => { n++; console.log((c ? 'PASS' : 'FAIL') + ' - ' + m + (!c && d !== undefined ? '\n     ' + JSON.stringify(d) : '')); if (!c) fails++; };

// the ZIP polygon, as the mock knows it: everything with lng > -97.22 (a half-plane is enough to have a crossing line)
const inPoly = (lat, lng) => lng > -97.22;
const centroid = { lat: 33.3, lng: -97.0 };            // legacy square: lng -97.052..-96.948 (3 mi)
const bounds = { xmin: -97.40, ymin: 33.2, xmax: -96.9, ymax: 33.4 };
const crossing = { attributes: { CONTROL_SECT_JOB: 'X-CROSS', PROJ_STG: 'Construction', PROJ_CLASS: 'Overlay', HIGHWAY_NUMBER: 'US 377', TYPE_OF_WORK: 'Overlay', LIMITS_FROM: 'A', LIMITS_TO: 'B' },
  geometry: { paths: [[[-97.45, 33.30], [-97.15, 33.30]]] } };   // pin (midpoint) lng -97.30 is OUTSIDE the polygon; east vertex -97.15 is INSIDE; bbox is outside the legacy square
const inside = { attributes: { ...crossing.attributes, CONTROL_SECT_JOB: 'X-PIN-IN' }, geometry: { paths: [[[-97.19, 33.30], [-97.16, 33.30]]] } };

const calls = [];
const membership = async (pts) => { calls.push(pts.length); return pts.map(([lat, lng]) => (inPoly(lat, lng) ? 'member' : 'outside')); };
const fx = async (u) => new Response(JSON.stringify(new URL(String(u)).searchParams.get('resultOffset') === '0' ? { features: [crossing, inside] } : { features: [] }), { status: 200 });
const out = await arcgisForZip('76247', [{ state: 'TX' }], [TX], { fetch: fx, zipCentroid: centroid, zipBounds: bounds, zipMembers: membership });
const ids = out.sites.map((s) => s.source_id);
const rep = out.reports[0];

const vertexInside = crossing.geometry.paths[0].some(([x, y]) => inPoly(y, x));
ok(vertexInside, 'control: the crossing line has a vertex inside the polygon, so ST_Intersects (serving membership) would include it');
ok(ids.includes('arcgis:txdot-projects-info-all:X-PIN-IN'), 'control: a line whose pin is inside the polygon is kept by the widened scope', ids);
ok(rep.scope_widened === true && rep.scope_membership && rep.scope_membership.widened_candidates === 2, 'control: both lines were widened-only candidates tested through the membership RPC', rep.scope_membership);
ok(!ids.includes('arcgis:txdot-projects-info-all:X-CROSS'), 'KNOWN GAP: the crossing line is EXCLUDED because its pin is outside the polygon', ids);
ok(rep.scope_membership.outside_excluded === 1, 'and it is counted as a correct polygon exclusion (not a quarantine, not a truncation) - which is why the gap is silent', rep.scope_membership);
console.log(`\n${fails ? 'FAILED' : 'ALL PASSED'} (${n} checks)`);
process.exit(fails ? 1 : 0);
