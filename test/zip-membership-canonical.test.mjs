// ZIP MEMBERSHIP IS GEOGRAPHY, NOT PROXIMITY — the offline half of the anti-bypass gate.
//
// The executable half (the SHIPPED SQL against a disposable PostGIS, with centroid-radius,
// source-bypass and Type-scoped mutations that must be killed) is
// test/zip_membership_pg/run.sh, run by .github/workflows/zip-membership-suite.yml.
// This file proves the CLIENT consumes the server's verdict and nothing else, and that the
// architecture offers no second door:
//   A  one canonical predicate in the SQL of record, no proximity construct beside it
//   B  Map 1 ZIP mode reads only membership reads, and every render goes through one door
//   C  the door reads the verdict and NOTHING about Type, source, distance or coordinates
//   D  Type independence   E  source independence   F  a future Type   G  a future source
//   H  fail-closed states  I  the page's facility count follows the measurement
//   M  this suite is load-bearing: a centroid-radius door and a source-bypass door both fail it
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

let fails = 0;
const ok = (c, name, detail) => {
  if (c) console.log('PASS — ' + name);
  else { fails++; console.log('FAIL — ' + name + (detail !== undefined ? '  [' + JSON.stringify(detail) + ']' : '')); }
};
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const stripSql = (s) => s.replace(/--[^\n]*/g, '');
const stripJs = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

function loadHS(src) {
  const ctx = { window: {} };
  vm.createContext(ctx);
  vm.runInContext(read('lib/map.js'), ctx);          // the real classifier, for F
  vm.runInContext(src || read('lib/zip-authoritative.js'), ctx);
  return ctx.window.HS;
}

// ── A. THE SQL OF RECORD ────────────────────────────────────────────────────────────────────
// `comment on` literals are documentation, not executable SQL — stripped with the comments.
const SQL = stripSql(read('docs/zip-membership-canonical.sql')).replace(/comment on function[\s\S]*?';/gi, '');
const fnBody = (name) => {
  const i = SQL.indexOf('function ' + name + '(');
  if (i < 0) return '';
  const j = SQL.indexOf('$function$', i), k = SQL.indexOf('$function$', j + 10);
  return SQL.slice(j, k);
};
const PRED = fnBody('geo.zip_point_membership_in');
const TRIG = fnBody('public.dev_reports_enforce_dc_zip_membership');
const NATL = fnBody('public.national_dc_zip_members');
const FIX28 = fnBody('public.zip_dc_membership_outside');
ok(PRED && TRIG && NATL && FIX28, 'A0 every function the contract names is present (positive control for the slices)');
ok((SQL.match(/ST_Intersects/g) || []).length === 1 && /ST_Intersects/.test(PRED),
  'A1 ST_Intersects appears EXACTLY ONCE in the SQL of record — inside the canonical predicate');
ok(!/ST_DWithin|ST_Distance|ST_Buffer|ST_Centroid|ST_PointOnSurface|3958\.8|\basin\(|radius/i.test(SQL),
  'A2 no proximity construct (DWithin/Distance/Buffer/Centroid/haversine/radius) anywhere in executable SQL');
ok(/geo\.zip_point_membership_in\(/.test(TRIG) && /geo\.zip_point_membership_in\(/.test(NATL)
   && /geo\.zip_point_membership_in\(/.test(FIX28),
  'A3 the trigger, the national read and Fix 28\'s retained predicate all CALL the canonical predicate');
ok(/verdict = 'member'/.test(NATL), 'A4 the national read serves only rows whose verdict is member');
// the facility plane is decided by relevance; its drop does not consult a Type field
const facPlane = (TRIG.match(/as fac_plane/) && TRIG.slice(TRIG.lastIndexOf('select', TRIG.indexOf('as fac_plane')), TRIG.indexOf('as fac_plane'))) || '';
ok(/relevance/.test(facPlane) && !/use_type|layer|type_raw|category|registry_id|src/.test(facPlane),
  'A5 the facility plane is defined by relevance alone — no Type or source field', facPlane);
ok(/verdict = 'outside' and \(\s*fac_plane/.test(TRIG),
  'A6 an outside facility-plane point is removed on the verdict alone, before any Type test');
ok(/bb\.y0 and bb\.y1/.test(NATL) && /ST_XMin\(geom\)/.test(NATL),
  'A7 national candidates are retrieved by the ZCTA polygon\'s own extent, not a circle');

// ── B. THE PAGE: ZIP mode has one door and reads only membership reads ─────────────────────
const PAGE = read('homesignalmap.html');
const z0 = PAGE.indexOf('function loadZip(zip){'), z1 = PAGE.indexOf('function render(data){');
const LOADZIP = stripJs(PAGE.slice(z0, z1));
ok(z0 > 0 && z1 > z0 && /app_zip_projects_markers|ZIP_AUTH_RPC_URL/.test(LOADZIP),
  'B0 the ZIP-mode loader was found (positive control)');
ok(!/national_dc_for_zip/.test(LOADZIP) && !/p_radius_mi/.test(LOADZIP),
  'B1 ZIP mode never calls the radius read (national_dc_for_zip / p_radius_mi)');
ok(/rpc\/national_dc_zip_members/.test(LOADZIP), 'B2 ZIP mode reads the national plane through national_dc_zip_members');
const renders = LOADZIP.match(/render\(\{[\s\S]*?\}\);/g) || [];
ok(renders.length >= 2 && renders.every((r) => /sites:\s*HS\.zipModeSites\(/.test(r)),
  'B3 EVERY ZIP-mode render() receives its sites from HS.zipModeSites — no plane is appended beside it',
  renders.map((r) => (r.match(/sites:[^\n]*/) || [''])[0]));
const fetches = LOADZIP.match(/(?:fetch\(|rest\/v1\/)[^\n]{0,90}/g) || [];
// place labels, indexability and county source metadata carry no points
const allowed = /development_reports|ZIP_AUTH_RPC_URL|national_dc_zip_members|communities|app_community_meta|county-sources\.json|fetch\(url/;
ok(fetches.every((f) => allowed.test(f)),
  'B4 ZIP mode fetches only the report, the authoritative markers, the national membership read and point-free metadata',
  fetches.filter((f) => !allowed.test(f)));
ok(/zip_membership:r\.zip_membership/.test(LOADZIP) && /\.filter\(HS\.zipMemberAdmitted\)/.test(LOADZIP),
  'B5 each national site carries the server verdict and is filtered on it');

// ── C. THE DOOR reads the verdict and nothing else ─────────────────────────────────────────
const LIB = stripJs(read('lib/zip-authoritative.js'));
const body = (name) => (LIB.match(new RegExp('HS\\.' + name + ' = function[\\s\\S]*?\\n  \\};')) || [''])[0];
const DOOR = ['zipMemberAdmitted', 'zipAuthMergeSites', 'zipModeSites', 'zipFacilityPlaneMeasured'].map(body);
ok(DOOR.every(Boolean), 'C0 the four door functions were found (positive control)');
ok(DOOR.every((b) => !/\blat\b|\blng\b|distance|radius|centroid|haversine|Math\./i.test(b)),
  'C1 the door does no geometry of its own — no coordinate, distance, radius or centroid');
ok(DOOR.every((b) => !/use_type|\.layer|type_raw|category|\.name\b|\.src\b|registry_id|source_name|typeKey|CATEGORY_REGISTRY/.test(b)),
  'C2 the door reads no Type and no source field');

// ── D-H. BEHAVIOUR ────────────────────────────────────────────────────────────────────────────
const HS = loadHS();
const COMPLETE = { zip: '99901', mode: 'authoritative', status: 'boundary_complete', projects: [], markers: [] };
const NOT_MEASURED = { zip: '99901', mode: 'authoritative', status: 'not_measured', projects: null, markers: null };
const pt = (o) => Object.assign({ scope: 'point', lat: 40.38, lng: -99.98, record_url: 'https://x.test/1' }, o);
const admitted = (site, auth) => HS.zipModeSites([site], auth || COMPLETE, []).length === 1;
const TYPES = [
  { layer: 'industrial' }, { layer: 'energy' }, { layer: 'logistics' }, { layer: 'datacenter' },
  { use_type: 'Residential' }, { use_type: 'Commercial' }, { use_type: 'Roads & infrastructure' },
  { use_type: 'Civic/public' }, { use_type: 'Utility' }, { use_type: 'other project' },
  { use_type: 'Data center', type_raw: 'NEW DATA HALL', name: 'Stratos campus', category: 'datacenter' }];
for (const v of ['member', 'outside', 'not_measured', 'no_coordinates', undefined]) {
  const got = TYPES.map((t) => admitted(pt(Object.assign({ registry_id: '110000000001', zip_membership: v }, t))));
  ok(got.every((g) => g === (v === 'member')),
    'D1 Type independence — verdict ' + v + ' gives the same admission for all ' + TYPES.length + ' Types', got);
}
// the converse: same Type, different geography verdict -> different admission
ok(admitted(pt({ layer: 'industrial', zip_membership: 'member' })) === true
   && admitted(pt({ layer: 'industrial', zip_membership: 'outside' })) === false,
  'D2 changing ONLY geography changes membership');
// coordinates are not read: a "member" far from anywhere and an "outside" at the very centre
ok(admitted(pt({ zip_membership: 'member', lat: 0, lng: 0 })) && !admitted(pt({ zip_membership: 'outside', lat: 40.2, lng: -99.8 })),
  'D3 the client never re-derives membership from coordinates — the server verdict is final');

const SOURCES = [{ registry_id: '110000000001', src: 'EPA FRS' }, { registry_id: 'state-feed', src: 'state' },
  { source_name: 'Compute Atlas', source_key: 'atlas:1' }, { source_name: 'Epoch AI' }, { source_name: 'OpenStreetMap' }, {}];
for (const v of ['member', 'outside']) {
  const rep = SOURCES.map((s) => admitted(pt(Object.assign({ zip_membership: v }, s))));
  const nat = SOURCES.map((s) => HS.zipModeSites([], COMPLETE, [pt(Object.assign({ zip_membership: v, type: 'datacenter' }, s))]).length === 1);
  ok(rep.concat(nat).every((g) => g === (v === 'member')),
    'E1 source independence — verdict ' + v + ' admits identically for every source, on both planes', { rep, nat });
}

// F. a FUTURE TYPE: registered in the real CATEGORY_REGISTRY, no geography code added anywhere
HS.CATEGORY_REGISTRY.zzfuture = { key: 'zzfuture', label: 'Future type', symbol: 'circle', legend: true };
ok(admitted(pt({ use_type: 'zzfuture', layer: 'zzfuture', zip_membership: 'member' }))
   && !admitted(pt({ use_type: 'zzfuture', layer: 'zzfuture', zip_membership: 'outside' })),
  'F1 a synthetic future Type inherits membership with zero geography code');
delete HS.CATEGORY_REGISTRY.zzfuture;

// G. a FUTURE SOURCE that never went through the database cannot become a ZIP member
const rogue = pt({ label: 'new national feed record', source_name: 'Brand New Feed', relevance: 'development' });
ok(HS.zipModeSites([rogue], COMPLETE, []).length === 0, 'G1 a new source injected as a report development point is not shown');
ok(HS.zipModeSites([Object.assign({}, rogue, { relevance: 'facility' })], COMPLETE, []).length === 0,
  'G2 ...injected on the facility plane without a verdict, it is not shown');
ok(HS.zipModeSites([], COMPLETE, [rogue]).length === 0, 'G3 ...injected on the national plane without a verdict, it is not shown');
ok(HS.zipAuthMergeSites([], [rogue]).length === 0,
  'G4 ...passed off as authoritative development without zip_authoritative, it is not shown');
ok(HS.zipModeSites([], COMPLETE, [Object.assign({}, rogue, { zip_membership: 'member' })]).length === 1,
  'G5 the SAME record with the server\'s member verdict IS shown (positive control)');

// H. fail-closed states
ok(HS.zipModeSites([], NOT_MEASURED, [pt({ zip_membership: 'member' })]).length === 0,
  'H1 the national plane on a not-measured ZIP shows nothing even with member rows (Fix 29)');
ok(HS.zipModeSites([], null, [pt({ zip_membership: 'member' })]).length === 0, 'H2 ...nor on a failed read');
ok(HS.zipModeSites([pt({ zip_membership: 'not_measured', registry_id: '1' })], NOT_MEASURED, []).length === 0,
  'H3 a not_measured facility is not shown as a member');
ok(HS.zipModeSites([{ scope: 'area', label: 'county notice' }], NOT_MEASURED, []).length === 1,
  'H4 area notices are not point claims and keep their jurisdiction treatment');

// I. the facility count follows the measurement
ok(HS.zipFacilityPlaneMeasured([pt({ registry_id: '1', zip_membership: 'member' }), pt({ relevance: 'development' })]) === true,
  'I1 a fully verdicted facility plane is a measurement');
ok(HS.zipFacilityPlaneMeasured([pt({ registry_id: '1', zip_membership: 'not_measured' })]) === false,
  'I2 a ZIP with no boundary is NOT a facility measurement');
ok(HS.zipFacilityPlaneMeasured([pt({ registry_id: '1' })]) === false, 'I3 an unstamped row is NOT a measurement (fails closed)');
ok(/FAC_UNMEASURED = ZIP_MODE && !!data\.facUnmeasured;/.test(PAGE)
   && /facUnmeasured: !HS\.zipFacilityPlaneMeasured\(row\.sites\|\|\[\]\)/.test(PAGE),
  'I4 the page shows the unknown count as unknown when the facility plane is not measured');

// ── M. LOAD-BEARING: two mutated doors must each fail the behaviour above ───────────────────
function mutantFails(src) {
  const H = loadHS(src);
  const s1 = H.zipModeSites([pt({ zip_membership: 'outside', lat: 40.2, lng: -99.8 })], COMPLETE, []).length === 0;
  const s2 = H.zipModeSites([], COMPLETE, [pt({ source_name: 'Brand New Feed' })]).length === 0;
  const s3 = H.zipModeSites([pt({ zip_membership: 'member', lat: 40.38, lng: -99.98 })], COMPLETE, []).length === 1;
  return !(s1 && s2 && s3);
}
const ORIG = read('lib/zip-authoritative.js');
const radiusDoor = ORIG.replace(
  "return !!rec && rec.zip_membership === HS.ZIP_MEMBER;",
  "var d = Math.hypot((rec.lat - 40.2) * 69, (rec.lng + 99.8) * 53); return !!rec && d <= 5;");
const bypassDoor = ORIG.replace(
  "? (nationalSites || []).filter(HS.zipMemberAdmitted) : [];",
  "? (nationalSites || []) : [];");
ok(radiusDoor !== ORIG && bypassDoor !== ORIG, 'M0 both mutations actually APPLY (a no-op mutation proves nothing)');
ok(mutantFails(radiusDoor), 'M1 a centroid-radius door is caught');
ok(mutantFails(bypassDoor), 'M2 a national-source bypass door is caught');
ok(!mutantFails(ORIG), 'M3 the shipped door passes the same probe (control)');

console.log('\n' + (fails ? fails + ' assertion(s) FAILED' : 'all assertions passed'));
process.exit(fails ? 1 : 0);
