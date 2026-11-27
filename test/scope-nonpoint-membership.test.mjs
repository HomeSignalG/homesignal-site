// WHOLE-GEOMETRY MEMBERSHIP for widened LINE/POLYGON features (docs/zip-scope-members-geom.sql, sources/scope-members.ts).
// Closes the gap this file used to pin: a line crossing the ZIP polygon whose PIN is outside it was excluded by the widened fetch although
// serving membership (ST_Intersects of the whole geometry) would include it. A widened non-point feature is now judged by its WHOLE geometry;
// a missing/failing geometry function is a legacy FALLBACK reported incomplete, never a silent discard and never the pin.
// Run: node test/scope-nonpoint-membership.test.mjs
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
const bounds = { xmin: -97.40, ymin: 33.2, xmax: -96.9, ymax: 33.4, geom_sig: 'abcdef0123456789' };
const crossing = { attributes: { CONTROL_SECT_JOB: 'X-CROSS', PROJ_STG: 'Construction', PROJ_CLASS: 'Overlay', HIGHWAY_NUMBER: 'US 377', TYPE_OF_WORK: 'Overlay', LIMITS_FROM: 'A', LIMITS_TO: 'B' },
  geometry: { paths: [[[-97.45, 33.30], [-97.15, 33.30]]] } };   // pin (midpoint) lng -97.30 is OUTSIDE the polygon; east vertex -97.15 is INSIDE; bbox is outside the legacy square
const inside = { attributes: { ...crossing.attributes, CONTROL_SECT_JOB: 'X-PIN-IN' }, geometry: { paths: [[[-97.19, 33.30], [-97.16, 33.30]]] } };


const calls = [], gcalls = [];
const membership = async (pts) => { calls.push(pts.length); return pts.map(([lat, lng]) => (inPoly(lat, lng) ? 'member' : 'outside')); };
// whole-geometry stand-in: a path intersects the half-plane iff ANY point of any segment has lng > -97.22, i.e. its max x does
const geomMember = async (feats) => { gcalls.push(feats.length); return feats.map((g) => (g.c.some((p) => p.some((q) => q[0] > -97.22)) ? 'member' : 'outside')); };
const wholly = { attributes: { ...crossing.attributes, CONTROL_SECT_JOB: 'X-FAR' }, geometry: { paths: [[[-97.60, 33.30], [-97.45, 33.30]]] } };
const pt = { attributes: { ...crossing.attributes, CONTROL_SECT_JOB: 'X-PT' }, geometry: { x: -97.30, y: 33.30 } };
const mkfx = (feats) => async (u) => new Response(JSON.stringify(new URL(String(u)).searchParams.get('resultOffset') === '0' ? { features: feats } : { features: [] }), { status: 200 });
const run = (feats, deps) => arcgisForZip('76247', [{ state: 'TX' }], [TX], { fetch: mkfx(feats), zipCentroid: centroid, zipBounds: bounds, ...deps });

let out = await run([crossing, inside, wholly], { zipMembers: membership, zipGeomMembers: geomMember });
let ids = out.sites.map((s) => s.source_id), rep = out.reports[0];
ok(ids.includes('arcgis:txdot-projects-info-all:X-CROSS'), 'CLOSED GAP: the crossing line (pin outside the polygon) is now KEPT by its whole geometry', ids);
ok(ids.includes('arcgis:txdot-projects-info-all:X-PIN-IN'), 'a line whose pin is inside is still kept', ids);
ok(!ids.includes('arcgis:txdot-projects-info-all:X-FAR'), 'a line wholly outside the polygon is excluded', ids);
ok(rep.scope_membership.geometry_tested === 3 && rep.scope_membership.members_recovered === 2 && rep.scope_membership.outside_excluded === 1, 'counted: 3 tested by geometry, 2 recovered, 1 outside', rep.scope_membership);
ok(calls.length === 0 && gcalls.length === 1, 'non-point features do NOT go through the point function', { calls, gcalls });
ok(rep.scope_receipt.scope === 'expanded' && rep.scope_receipt.complete === true && /^v3:/.test(rep.scope_receipt.version), 'receipt: expanded, complete, rule version v3', rep.scope_receipt);

calls.length = 0; gcalls.length = 0;
out = await run([pt], { zipMembers: membership, zipGeomMembers: geomMember });
ok(calls.length === 1 && gcalls.length === 0, 'a POINT feature is judged exactly as before (point function, geometry function never called)', { calls, gcalls });

out = await run([crossing, inside], { zipMembers: membership, zipGeomMembers: null });
ids = out.sites.map((s) => s.source_id); rep = out.reports[0];
ok(rep.scope_fallback === 'legacy_after_membership_error' && rep.scope_receipt.scope === 'fallback' && rep.scope_receipt.complete === false, 'NO geometry function: legacy fallback, receipt fallback + INCOMPLETE (never a silent discard)', rep.scope_receipt);
ok(rep.scope_membership.legacy_fallback === 'geometry_unavailable', 'and the reason is named', rep.scope_membership);

out = await run([crossing], { zipMembers: membership, zipGeomMembers: async () => { throw new Error('function public.zip_scope_members_geom does not exist'); } });
rep = out.reports[0];
ok(rep.scope_receipt.scope === 'fallback' && rep.scope_receipt.complete === false && rep.scope_membership.rpc_failures === 1, 'geometry RPC throws (function missing): fallback, incomplete, failure counted', rep.scope_membership);

out = await run([crossing], { zipMembers: membership, zipGeomMembers: async () => ['member', 'member'] });
rep = out.reports[0];
ok(rep.scope_receipt.scope === 'fallback' && rep.scope_receipt.complete === false, 'wrong-length geometry answer: fallback, incomplete', rep.scope_receipt);

out = await run([crossing], { zipMembers: membership, zipGeomMembers: async (f) => f.map(() => 'no_coordinates') });
ids = out.sites.map((s) => s.source_id); rep = out.reports[0];
ok(ids.includes('arcgis:txdot-projects-info-all:X-CROSS') && rep.scope_membership.geometry_unresolved_kept === 1 && rep.scope_receipt.complete === false, 'undecidable geometry is KEPT (never discarded) and the receipt is INCOMPLETE', rep.scope_membership);

const huge = { attributes: { ...crossing.attributes, CONTROL_SECT_JOB: 'X-HUGE' }, geometry: { paths: [Array.from({ length: 50001 }, (_, i) => [-97.6 + i * 1e-6, 33.3])] } };
gcalls.length = 0;
out = await run([huge], { zipMembers: membership, zipGeomMembers: geomMember });
ids = out.sites.map((s) => s.source_id); rep = out.reports[0];
ok(gcalls.length === 0 && ids.includes('arcgis:txdot-projects-info-all:X-HUGE') && rep.scope_membership.geometry_untested_kept === 1 && rep.scope_receipt.complete === false, 'an oversize feature is not sent, is KEPT, counted untested, receipt INCOMPLETE', rep.scope_membership);

// batching: 250 widened lines => 3 geometry calls (100/100/50)
const many = Array.from({ length: 250 }, (_, i) => ({ attributes: { ...crossing.attributes, CONTROL_SECT_JOB: 'M' + i }, geometry: { paths: [[[-97.60, 33.3 + i * 1e-4], [-97.45, 33.3 + i * 1e-4]]] } }));
gcalls.length = 0;
out = await run(many, { zipMembers: membership, zipGeomMembers: geomMember });
ok(JSON.stringify(gcalls) === '[100,100,50]', 'geometry features are batched 100 per call', gcalls);
console.log(`\n${fails ? 'FAILED' : 'ALL PASSED'} (${n} checks)`);
process.exit(fails ? 1 : 0);
