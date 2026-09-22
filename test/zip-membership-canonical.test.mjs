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
//   H  fail-closed states
//   K  KNOWN OPEN — the facility plane is still radius context; pinned so it moves deliberately
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
const NATL = fnBody('public.national_dc_zip_members');
ok(PRED && NATL, 'A0 the canonical predicate and the national read are present (positive control for the slices)');
ok((SQL.match(/ST_Intersects/g) || []).length === 1 && /ST_Intersects/.test(PRED),
  'A1 ST_Intersects appears EXACTLY ONCE in the SQL of record — inside the canonical predicate');
ok(!/ST_DWithin|ST_Distance|ST_Buffer|ST_Centroid|ST_PointOnSurface|3958\.8|\basin\(|radius/i.test(SQL),
  'A2 no proximity construct (DWithin/Distance/Buffer/Centroid/haversine/radius) anywhere in executable SQL');
ok(/geo\.zip_point_membership_in\(/.test(NATL), 'A3 the national read CALLS the canonical predicate');
ok(/verdict = 'member'/.test(NATL), 'A4 the national read serves only rows whose verdict is member');
ok(!/project_type\s*=|source_name\s*=/.test(NATL), 'A5 the national read never filters on Type or source');
ok(!/create or replace function public\.dev_reports_enforce|create trigger|update public\.development_reports/i.test(SQL),
  'A6 the SQL of record carries NO write-path object — the reverted trigger cannot be reinstalled by replaying it');
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
const DOOR = ['zipMemberAdmitted', 'zipAuthMergeSites', 'zipModeSites'].map(body);
ok(DOOR.every(Boolean), 'C0 the three door functions were found (positive control)');
ok(DOOR.every((b) => !/\blat\b|\blng\b|distance|radius|centroid|haversine|Math\./i.test(b)),
  'C1 the door does no geometry of its own — no coordinate, distance, radius or centroid');
ok(DOOR.every((b) => !/use_type|\.layer|type_raw|category|\.name\b|\.src\b|registry_id|source_name|typeKey|CATEGORY_REGISTRY/.test(b)),
  'C2 the door reads no Type and no source field');

// ── D-H. BEHAVIOUR ────────────────────────────────────────────────────────────────────────────
const HS = loadHS();
const COMPLETE = { zip: '99901', mode: 'authoritative', status: 'boundary_complete', projects: [], markers: [] };
const NOT_MEASURED = { zip: '99901', mode: 'authoritative', status: 'not_measured', projects: null, markers: null };
const pt = (o) => Object.assign({ scope: 'point', lat: 40.38, lng: -99.98, record_url: 'https://x.test/1' }, o);
// the membership-gated planes: national (verdict) — the facility plane is section K
const admitted = (site, auth) => HS.zipModeSites([], auth || COMPLETE, [site]).length === 1;
const TYPES = [
  { layer: 'industrial' }, { layer: 'energy' }, { layer: 'logistics' }, { layer: 'datacenter' },
  { use_type: 'Residential' }, { use_type: 'Commercial' }, { use_type: 'Roads & infrastructure' },
  { use_type: 'Civic/public' }, { use_type: 'Utility' }, { use_type: 'other project' },
  { use_type: 'Data center', type_raw: 'NEW DATA HALL', name: 'Stratos campus', category: 'datacenter' }];
for (const v of ['member', 'outside', 'not_measured', 'no_coordinates', undefined]) {
  const got = TYPES.map((t) => admitted(pt(Object.assign({ zip_membership: v }, t))));
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
  const nat = SOURCES.map((s) => admitted(pt(Object.assign({ zip_membership: v, type: 'datacenter' }, s))));
  ok(nat.every((g) => g === (v === 'member')),
    'E1 source independence — verdict ' + v + ' admits identically for every source', nat);
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
ok(HS.zipModeSites([], COMPLETE, [rogue]).length === 0, 'G3 ...injected on the national plane without a verdict, it is not shown');
ok(HS.zipAuthMergeSites([], [rogue]).length === 0,
  'G4 ...passed off as authoritative development without zip_authoritative, it is not shown');
ok(HS.zipModeSites([], COMPLETE, [Object.assign({}, rogue, { zip_membership: 'member' })]).length === 1,
  'G5 the SAME record with the server\'s member verdict IS shown (positive control)');

// H. fail-closed states
ok(HS.zipModeSites([], NOT_MEASURED, [pt({ zip_membership: 'member' })]).length === 0,
  'H1 the national plane on a not-measured ZIP shows nothing even with member rows (Fix 29)');
ok(HS.zipModeSites([], null, [pt({ zip_membership: 'member' })]).length === 0, 'H2 ...nor on a failed read');
ok(HS.zipModeSites([{ scope: 'area', label: 'county notice' }], NOT_MEASURED, []).length === 1,
  'H4 area notices are not point claims and keep their jurisdiction treatment');

// K. ⛔ KNOWN OPEN — the facility plane (EPA FRS in development_reports.sites) is still
//    radius-derived and NOT membership-gated (CLAUDE.md §7.08: the row-level fix was reverted
//    after three production restarts). Pinned in BOTH directions so the next change moves it
//    on purpose: today an unverdicted facility point IS shown; when the plane is fixed this
//    assertion must be inverted, not deleted.
ok(HS.zipModeSites([pt({ registry_id: '110000000001', layer: 'industrial' })], COMPLETE, []).length === 1,
  'K1 KNOWN OPEN: a facility point with no membership verdict is still shown (radius context)');
ok(/KNOWN OPEN/.test(read('lib/zip-authoritative.js')) && /KNOWN OPEN/.test(PAGE),
  'K2 the open plane is named where a reader of the door and of the page will see it');

// ── M. LOAD-BEARING: two mutated doors must each fail the behaviour above ───────────────────
function mutantFails(src) {
  const H = loadHS(src);
  const s1 = H.zipModeSites([], COMPLETE, [pt({ zip_membership: 'outside', lat: 40.2, lng: -99.8 })]).length === 0;
  const s2 = H.zipModeSites([], COMPLETE, [pt({ source_name: 'Brand New Feed' })]).length === 0;
  const s3 = H.zipModeSites([], COMPLETE, [pt({ zip_membership: 'member', lat: 40.38, lng: -99.98 })]).length === 1;
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
