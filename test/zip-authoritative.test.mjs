// ZIP MODE = THE ENTIRE ZIP. Behaviour of lib/zip-authoritative.js against the REAL shapes the
// production RPC returns, plus static guards that the page is wired to it.
//
// Every payload below was measured live on 2026-09-04 against
// public.app_zip_projects_markers(p_zip, 'development', true):
//   78617 -> status boundary_complete, 497 projects / 522 markers / 500 marker project_refs,
//            0 projects outside the ZIP, 3 orphan markers whose project has no record_url
//   01009 -> status boundary_complete, projects [] and markers []  (measured, genuinely zero)
//   01004 -> status not_measured,      projects null and markers null
// The 01004/01009 pair is the whole point: `null` and `[]` must never collapse together.
import { readFileSync } from 'node:fs';

let fails = 0;
const ok = (c, name, detail) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name);
  if (!c) { fails++; if (detail !== undefined) console.log('   got: ' + JSON.stringify(detail)); }
};

// -- load the libs the way the page does (n5-radius supplies the shared bucket resolver) ------
global.window = {};
const load = (p) => new Function(readFileSync(new URL(p, import.meta.url), 'utf8'))();
load('../lib/n5-radius.js');
load('../lib/zip-authoritative.js');
const HS = global.window.HS;

// ── real shapes ──────────────────────────────────────────────────────────────────────────────
const COMPLETE = {
  zip: '78617', mode: 'authoritative', status: 'boundary_complete',
  projects: [
    { project_ref: 'p1', name: 'Valle Del Ahorro', type: 'Commercial', status: 'Proposed',
      source_ref: 'https://abc.austintexas.gov/web/permit/x', registry_id: 'austin-site-plan-cases',
      point_rule: 'POINT_MIN_XY', submitted_at: '2026-08-21', impact_score: 72 },
    // one project, several authoritative markers - a road drawn as points along its length
    { project_ref: 'p2', name: 'FM 1327 widening', type: 'Utility', status: 'Operating',
      source_ref: 'https://txdot.example/026501118', registry_id: 'txdot-projects-info-all' }
  ],
  markers: [
    { project_ref: 'p1', marker_seq: 1, lat: 30.15046708, lng: -97.58577921, marker_rule: 'POINT_AUTHORITATIVE' },
    { project_ref: 'p2', marker_seq: 1, lat: 30.1942004834018, lng: -97.6240166141657, marker_rule: 'LINE_MERGED_COMPONENT_INTERVAL_1000M' },
    { project_ref: 'p2', marker_seq: 2, lat: 30.1915996368654, lng: -97.6200000000000, marker_rule: 'LINE_MERGED_COMPONENT_INTERVAL_1000M' },
    // an ORPHAN marker: membership exists, hydration found no project (3 of these on real 78617)
    { project_ref: 'ghost', marker_seq: 1, lat: 30.2148, lng: -97.6577, marker_rule: 'POINT_AUTHORITATIVE' }
  ]
};
const MEASURED_ZERO = { zip: '01009', mode: 'authoritative', status: 'boundary_complete', projects: [], markers: [] };
const NOT_MEASURED  = { zip: '01004', mode: 'authoritative', status: 'not_measured', projects: null, markers: null };

// ── A. the distinction the invariant rests on ────────────────────────────────────────────────
console.log('\nA. not_measured is not the same fact as measured-zero');
ok(HS.zipAuthOutcome(COMPLETE) === 'complete', 'A1 a measured ZIP with projects reads complete');
ok(HS.zipAuthOutcome(MEASURED_ZERO) === 'complete', 'A2 a measured ZIP with NOTHING in it still reads complete');
ok(HS.zipAuthOutcome(NOT_MEASURED) === 'not_measured', 'A3 an unmeasured ZIP reads not_measured');
ok(HS.zipAuthOutcome(null) === 'unavailable', 'A4 a failed read is unavailable, never "measured empty"');
ok(HS.zipAuthOutcome({ status: 'boundary_complete', projects: null, markers: null }) === 'unavailable',
  'A5 a complete status carrying NULLs is not trusted as an empty measurement');
ok(HS.zipAuthOutcome({ status: 'something_new' }) === 'unavailable',
  'A6 an unknown status is unavailable, not silently treated as measured');
// the failure this pair exists to prevent, stated as an assertion
ok(HS.zipAuthOutcome(MEASURED_ZERO) !== HS.zipAuthOutcome(NOT_MEASURED),
  'A7 the two empties never collapse to the same outcome');

// A8-A10. 'unknown' is the producer's OTHER way of saying "no geography for this ZIP", and it
// covers 1,259 of the 12,722 live ZIP pages. Measured 2026-09-05 against production: every ZIP
// the geography view calls `pending` returns status 'unknown', and all 1,259 have NO row in
// geo.maps_zip_geography_status - nobody measured them. Reading that as 'unavailable' told those
// residents their coverage "could not be read just now", which is a false claim about a read that
// succeeded, and dropped the address-mode invitation the honest wording carries.
const UNKNOWN = { zip: '08005', mode: 'authoritative', status: 'unknown', projects: null, markers: null };
ok(HS.zipAuthOutcome(UNKNOWN) === 'not_measured',
  "A8 a 'unknown' status reads not_measured - the read SUCCEEDED and said it holds nothing");
ok(HS.zipAuthNote(UNKNOWN, '08005', []).indexOf('not measured yet') !== -1
   && HS.zipAuthNote(UNKNOWN, '08005', []).indexOf('could not be read') === -1,
  'A9 ...so the page states the honest status, never a transient-failure claim');
ok(HS.zipAuthNote(UNKNOWN, '08005', []).indexOf('street address') !== -1,
  'A10 ...and keeps the address-mode route, which is the only live answer for such a ZIP');
// The allow-list must stay an allow-list of two. A9 above would also pass if every unrecognised
// status were swept into not_measured, so A6's control is what makes this change safe, and it is
// re-asserted here against a DIFFERENT novel status than A6 uses.
ok(HS.zipAuthOutcome({ status: 'partially_measured' }) === 'unavailable',
  'A11 a status nobody has vetted is STILL unavailable - this is not a catch-all');
ok(HS.zipAuthOutcome(null) === 'unavailable',
  'A12 a genuinely failed read stays distinguishable from an unmeasured ZIP');

// ── B. sites are built at the marker grain, from content ─────────────────────────────────────
console.log('\nB. marker grain, and nothing drawn without content');
const sites = HS.zipAuthSitesFrom(COMPLETE);
ok(sites.length === 3, 'B1 one site per marker THAT HAS CONTENT (4 markers, 1 orphan dropped)', sites.length);
ok(HS.zipAuthProjectCount(sites) === 2, 'B2 the rail counts PROJECTS, not pins (3 pins, 2 projects)',
  HS.zipAuthProjectCount(sites));
ok(sites.filter(s => s.zip_project_ref === 'p2').length === 2,
  'B3 a multi-part project keeps every one of its authoritative markers');
ok(!sites.some(s => s.zip_project_ref === 'ghost'),
  'B4 a marker whose project has no content is never drawn');
ok(sites.every(s => s.scope === 'point' && s.relevance === 'development'),
  'B5 every ZIP-mode site routes through the existing development rails');
ok(sites[0].lat === 30.15046708 && sites[0].lng === -97.58577921,
  'B6 the pin is the AUTHORITATIVE marker position, not a project centroid');
ok(sites[0].zip_marker_rule === 'POINT_AUTHORITATIVE' && sites[1].zip_marker_rule.indexOf('LINE_MERGED') === 0,
  'B7 the marker rule is carried, so how a pin was placed is never guessed at');

// ── C. the traps this page has been bitten by before ─────────────────────────────────────────
console.log('\nC. the traps');
ok(sites.every(s => s.registry_id === undefined),
  'C1 registry_id is NEVER copied — frsRid() would relabel every project an EPA facility',
  sites.map(s => s.registry_id));
ok(sites[0].src === 'austin-site-plan-cases', 'C2 source identity rides on src instead');
ok(sites.every(s => s.distance_mi === undefined && s.e === undefined && s.n === undefined),
  'C3 NO distance and NO home offsets — there is no HOME in ZIP mode to measure from');
ok(sites[0].record_url === 'https://abc.austintexas.gov/web/permit/x',
  'C4 the official record link survives (the anti-fabrication gate needs it)');
ok(sites[0].bucket === 'proposed' && sites[1].bucket === 'operating',
  'C5 lifecycle comes from the shared closed-vocabulary resolver',
  [sites[0].bucket, sites[1].bucket]);
ok(HS.zipAuthSiteFromMarker({ lat: null, lng: null }, { name: 'x', source_ref: 'u' }) === null,
  'C6 a marker with no position draws nothing rather than being placed somewhere plausible');

// ── D. a not-measured ZIP renders NOTHING, and says so ───────────────────────────────────────
console.log('\nD. an unmeasured ZIP is never rendered as an empty one');
ok(HS.zipAuthSitesFrom(NOT_MEASURED).length === 0, 'D1 not_measured yields no sites');
ok(HS.zipAuthSitesFrom(MEASURED_ZERO).length === 0, 'D2 measured-zero also yields no sites');
const noteNM = HS.zipAuthNote(NOT_MEASURED, '01004', []);
const noteMZ = HS.zipAuthNote(MEASURED_ZERO, '01009', []);
ok(noteNM !== noteMZ, 'D3 ...but the two are DESCRIBED differently, which is the whole point');
ok(/not measured yet/i.test(noteNM), 'D4 the unmeasured ZIP says it is not measured', noteNM);
ok(/will not estimate/i.test(noteNM), 'D5 ...and says we will not estimate it from a circle', noteNM);
ok(/No qualifying development/i.test(noteMZ) && /whole ZIP/i.test(noteMZ),
  'D6 the measured-zero ZIP claims a real whole-ZIP measurement', noteMZ);
ok(/2 projects across the whole of ZIP 78617/.test(HS.zipAuthNote(COMPLETE, '78617', sites)),
  'D7 a measured ZIP counts projects across the WHOLE ZIP', HS.zipAuthNote(COMPLETE, '78617', sites));

// ── E. the merge keeps what it must and replaces what it must ────────────────────────────────
console.log('\nE. merge: authoritative development replaces radius-derived development');
const report = [
  { scope: 'point', relevance: 'development', label: 'centroid-radius permit' },   // must go
  { scope: 'point', relevance: 'facility', label: 'EPA facility', registry_id: '110000' }, // must stay
  { scope: 'area', relevance: 'development', label: 'county-wide hearing' }        // must stay
];
const merged = HS.zipAuthMergeSites(report, sites);
ok(!merged.some(s => s.label === 'centroid-radius permit'),
  'E1 the cached report\'s own development points are replaced');
ok(merged.some(s => s.label === 'EPA facility'), 'E2 EPA facilities are preserved untouched');
ok(merged.some(s => s.label === 'county-wide hearing'), 'E3 area/jurisdiction notices are preserved');
ok(merged.length === 2 + sites.length, 'E4 nothing else is lost', merged.length);
ok(HS.zipAuthMergeSites(report, []).every(s => s.label !== 'centroid-radius permit'),
  'E5 an unmeasured ZIP drops radius development too — it is not a fallback');

// ── F. the page is actually wired to all of this ─────────────────────────────────────────────
console.log('\nF. page wiring');
const page = readFileSync(new URL('../homesignalmap.html', import.meta.url), 'utf8');
ok(/lib\/zip-authoritative\.js/.test(page), 'F1 the page ships the library');
ok(/rpc\/app_zip_projects_markers/.test(page), 'F2 ZIP mode calls the authoritative RPC');
ok(/HS\.zipAuthSitesFrom\(/.test(page) && /HS\.zipAuthMergeSites\(/.test(page),
  'F3 ZIP mode builds and merges authoritative sites');
ok(/HS\.zipAuthNote\(/.test(page), 'F4 the honest note is rendered');
ok(/body\.zipmode \.radsel\{display:none\}/.test(page),
  'F5 the radius control is not offered in ZIP mode');
ok(/if\(!CUR_ADDRESS\) return;/.test(page),
  'F6 the radius handler refuses to act without an address-derived HOME centre');
ok(!/else if\(ZIP_MODE && LAST_DRAW\)\{ drawMap/.test(page),
  'F7 the old ZIP-mode radius re-cull is gone');
ok(/if\(ZIP_MODE \|\| dd<=CUR_RADIUS\+0\.3\)/.test(page) && /if\(!ZIP_MODE && Math\.hypot/.test(page),
  'F8 the 3D view never culls a ZIP-mode record by radius');
// address mode must survive this change untouched
ok(/rpc\/n5_projects_within_radius/.test(page), 'F9 address mode still calls the N5 radius RPC');
ok(/classList\.remove\("zipmode"\)/.test(page),
  'F10 an address search restores the radius control');
ok(/HS\.n5SitesFrom\(/.test(page) && /HS\.n5MergeSites\(/.test(page),
  'F11 address mode still builds its own radius sites');

// ── G. THE HEADLINE NUMBER MUST DESCRIBE THE MAP ─────────────────────────────────────────────
// Measured live on production 2026-09-04 BEFORE this guard: ZIP 78617's "New projects proposed
// nearby" tile read 48 while 55 were actually drawn. The tile came from the cached report's
// counters, computed over the centroid-radius development set that ZIP mode no longer renders.
// The page states the contract itself above #cDev: "it must equal the orange Proposed rail."
console.log('\nG. the cached report\'s development counters cannot outlive the set they described');
ok(/delete zipCounts\.development; delete zipCounts\.proposed; delete zipCounts\.comment_open;/.test(page),
  'G1 ZIP mode drops the counters that described the replaced development set');
ok(/counts:zipCounts/.test(page) && !/counts:row\.counts\|\|\{\}/.test(page),
  'G2 ...and renders from the cleaned counts, not the raw cached ones');
// The same guard address mode has always had - this is that pattern, not a new invention.
ok(/delete data\.counts\.development; delete data\.counts\.proposed; delete data\.counts\.comment_open;/.test(page),
  'G3 address mode keeps its equivalent guard (the pattern this follows)');
// AND the fallback the deletion now exposes must count what is RENDERED as development.
// Counting only area items would make a ZIP of 519 project POINTS announce itself
// facilities-only; address mode never hit this because FACILITIES_ONLY is ZIP_MODE-gated.
ok(/data\.counts\.development : \(permits\.length \+ dev\.length\)/.test(page),
  'G4 the exposed devCount fallback counts development POINTS as well as area items');
ok(/FACILITIES_ONLY = ZIP_MODE && devCount === 0 && facCount > 0/.test(page),
  'G5 ...which is what keeps the facilities-only / coverage-coming note honest');

console.log(fails ? '\n' + fails + ' zip-authoritative assertion(s) FAILED.' : '\nAll zip-authoritative assertions passed.');
process.exit(fails ? 1 : 0);
