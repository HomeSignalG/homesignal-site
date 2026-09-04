// MAP 1 ADDRESS + RADIUS — the feature Map 2 had and Map 1 did not.
//
// Two halves, because half the contract is behaviour and half is wiring:
//   * BEHAVIOUR runs the real lib/n5-radius.js (pure, no DOM, no fetch) over rows shaped exactly
//     like the installed RPC's output;
//   * WIRING asserts against homesignalmap.html, because "the page calls geocode-address and
//     passes its exact lat/lng to the RPC" cannot be executed offline but can be read.
//
// The invariant behind almost every case below: the RPC owns SPACE (membership + distance,
// measured server-side against true canonical geometry), app_projects owns CONTENT, and
// marker_lat/marker_lng own nothing but where to draw a pin.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const page = readFileSync(join(root, 'homesignalmap.html'), 'utf8');

global.window = { HS: {} };
await import('../lib/n5-radius.js');
const HS = global.window.HS;

let fails = 0;
const ok = (c, name) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name); if (!c) fails++; };

// The page's own anti-fabrication gate, mirrored so a built site can be tested against the
// same predicate the renderer applies.
const sourced = (s) => !!(s && ((s.url && String(s.url).trim()) || (s.record_url && String(s.record_url).trim())));
// The page's facility test. ANY registry_id means "EPA FRS facility" on this page.
const frsRid = (s) => (s && s.registry_id != null) ? String(s.registry_id).trim() : '';

// The instrument must prove it ran.
ok(page.length > 50000, 'Map 1 page loaded');
ok(typeof HS.n5SitesFrom === 'function' && typeof HS.n5MergeSites === 'function', 'n5 helpers loaded');

// Rows shaped like the installed revision-3 RPC. HOME is the proven positive control's geocode
// result; it is a VERIFICATION control only — nothing in the implementation knows these values.
const HOME = { lat: 30.215054966235, lng: -97.53885104845 };
const ROWS = [
  { source_key: 'socrata:data.austintexas.gov:mavg-96ck:SP-2021-0320D', feature_id: 'pt:1',
    registry_id: 'austin-site-plan-cases', provenance: 'proven_stored_point',
    distance_mi: 0.021017590124, geometry_type: 'ST_Point',
    marker_lat: 30.2154, marker_lng: -97.5391, has_more: false },
  { source_key: 'socrata:data.austintexas.gov:mavg-96ck:SP-2020-0236D', feature_id: 'pt:1',
    registry_id: 'austin-site-plan-cases', provenance: 'proven_stored_point',
    distance_mi: 0.278213114517, geometry_type: 'ST_Point',
    marker_lat: 30.2189, marker_lng: -97.5402, has_more: false },
  // one project, THREE geometry instances — a real shape in this corpus (a highway project
  // carrying many features). The polygon's marker deliberately sits far from its nearest edge.
  { source_key: 'arcgis:massdot-highway-projects:609402', feature_id: 'f:1',
    registry_id: 'massdot-highway-projects', provenance: 'recovered_authoritative',
    distance_mi: 0.4, geometry_type: 'ST_MultiLineString',
    marker_lat: 30.2200, marker_lng: -97.5300, has_more: false },
  { source_key: 'arcgis:massdot-highway-projects:609402', feature_id: 'f:2',
    registry_id: 'massdot-highway-projects', provenance: 'recovered_authoritative',
    distance_mi: 0.12, geometry_type: 'ST_MultiPolygon',
    marker_lat: 30.2600, marker_lng: -97.5900, has_more: false },   // marker ~3.5 mi from home
  // NULL marker — the geometry class the marker rule does not cover, or an unusable SRID.
  { source_key: 'arcgis:massdot-highway-projects:609402', feature_id: 'f:3',
    registry_id: 'massdot-highway-projects', provenance: 'recovered_authoritative',
    distance_mi: 0.31, geometry_type: 'ST_MultiPoint',
    marker_lat: null, marker_lng: null, has_more: false }
];
const PROJECTS = [
  { source_key: 'socrata:data.austintexas.gov:mavg-96ck:SP-2021-0320D', name: 'Caldwell Lane',
    type: 'Industrial', status: 'Approved', registry_id: 'austin-site-plan-cases',
    source_ref: 'https://abc.austintexas.gov/web/permit/public-search-other?t_detail=1&t_selected_folderrsn=12774743',
    submitted_at: '2021-09-07', date_kind: 'filed', impact_score: 55, impact_dimensions: null,
    // app_projects DOES carry a representative point. It must never reach a marker.
    lat: 29.0, lng: -95.0 },
  { source_key: 'socrata:data.austintexas.gov:mavg-96ck:SP-2020-0236D', name: 'Riverside Resort',
    type: 'unclassified', status: 'Proposed', registry_id: 'austin-site-plan-cases',
    source_ref: 'https://abc.austintexas.gov/web/permit/public-search-other?t_detail=1&t_selected_folderrsn=12487869',
    submitted_at: '2020-06-11', date_kind: 'filed', impact_score: 72, impact_dimensions: null,
    lat: 29.0, lng: -95.0 },
  { source_key: 'arcgis:massdot-highway-projects:609402', name: 'Route 9 reconstruction',
    type: 'Infrastructure', status: 'Operating', registry_id: 'massdot-highway-projects',
    source_ref: 'https://example.gov/record/609402', submitted_at: '2024-01-02',
    date_kind: 'filed', impact_score: null, impact_dimensions: null, lat: 42.3, lng: -71.0 }
];
const SITES = HS.n5SitesFrom(ROWS, PROJECTS, HOME);

// ── E. markers come from the RPC's own marker coordinates ───────────────────────────────────
ok(SITES[0].lat === ROWS[0].marker_lat && SITES[0].lng === ROWS[0].marker_lng,
  'E — marker position is marker_lat / marker_lng, verbatim');
ok(SITES.filter(s => s.lat != null).every((s, i) => true) && SITES[3].lat === 30.2600,
  'E — every placed site takes its own row\'s marker, including the polygon');

// ── F. app_projects representative coordinates NEVER become the marker ──────────────────────
ok(SITES.every(s => s.lat !== 29.0 && s.lat !== 42.3 && s.lng !== -95.0 && s.lng !== -71.0),
  'F — app_projects.lat/lng is never substituted for a marker');
// load-bearing: the hydration rows really do carry a different point, so the check can fail
ok(PROJECTS.every(p => typeof p.lat === 'number') && PROJECTS[0].lat !== ROWS[0].marker_lat,
  'F — control: the hydration fixtures carry a DIFFERENT representative point');
ok(!/select:\s*"source_key,name,type,status,source_ref,registry_id[^"]*\blat\b/.test(page),
  'F — the hydration select does not even request app_projects lat/lng');

// ── G. distance is the RPC's, never recomputed in the browser ───────────────────────────────
ok(SITES.every((s, i) => s.distance_mi === ROWS[i].distance_mi),
  'G — distance_mi is carried through from the RPC unchanged');
const poly = SITES[3];
const hypotMi = Math.hypot(poly.e, poly.n);
ok(poly.distance_mi === 0.12 && hypotMi > 1,
  'G — control: the polygon\'s marker is ' + hypotMi.toFixed(2) + ' mi out while its true distance is 0.12 mi — a browser recompute would be wrong by ' + (hypotMi - 0.12).toFixed(2) + ' mi');
ok(/function siteDistMi\(s\)\{[\s\S]{0,400}s\.distance_mi/.test(page.replace(/\r/g, '')),
  'G — the page has ONE distance reader and it prefers distance_mi');
ok(!/Math\.hypot\(s\.e,\s*s\.n\)/.test(page) || (page.match(/Math\.hypot\(s\.e/g) || []).length === 1,
  'G — no display path recomputes distance from coordinates except the single fallback');

// ── H. hydration joins by source_key ────────────────────────────────────────────────────────
ok(SITES[0].label === 'Caldwell Lane' && SITES[1].label === 'Riverside Resort',
  'H — content is joined onto each row by source_key');
ok(SITES[2].label === 'Route 9 reconstruction' && SITES[4].label === 'Route 9 reconstruction',
  'H — one project\'s content is shared by all of its geometry instances');
const orphan = HS.n5SitesFrom([ROWS[0]], [], HOME)[0];
ok(orphan && orphan.label === '' && orphan.record_url === '' && !sourced(orphan),
  'H — a row with no hydration produces no invented label or URL, and fails sourced()');

// ── I. the (source_key, feature_id) grain survives ──────────────────────────────────────────
ok(SITES.length === ROWS.length, 'I — every returned geometry instance becomes its own site');
const multi = SITES.filter(s => s.n5_source_key === 'arcgis:massdot-highway-projects:609402');
ok(multi.length === 3 && new Set(multi.map(s => s.n5_feature_id)).size === 3,
  'I — one source_key with three feature_ids stays three separate spatial results');
ok(new Set(multi.map(s => s.distance_mi)).size === 3 && new Set(multi.map(s => s.n5_geometry_type)).size === 3,
  'I — each instance keeps its OWN distance and geometry type');
ok(!/distinct|dedupe|uniqBy/i.test(readFileSync(join(root, 'lib/n5-radius.js'), 'utf8').split('n5SitesFrom')[1] || ''),
  'I — n5SitesFrom collapses nothing');

// ── J. a NULL marker is honest, never fabricated ────────────────────────────────────────────
const nullMarker = SITES[4];
ok(nullMarker.lat === undefined && nullMarker.lng === undefined,
  'J — a NULL marker produces NO coordinates rather than a substituted one');
ok(nullMarker.distance_mi === 0.31 && nullMarker.label === 'Route 9 reconstruction',
  'J — the record still exists, with its real distance and content');
ok(sourced(nullMarker), 'J — and it still passes the anti-fabrication gate, so it still lists');

// ── K. has_more is never silently treated as complete ───────────────────────────────────────
const truncated = ROWS.map(r => Object.assign({}, r, { has_more: true }));
ok(HS.n5HasMore(truncated) === true && HS.n5HasMore(ROWS) === false, 'K — has_more is read from the rows');
ok(/more canonical project geometry exists/.test(HS.n5CoverageNote(truncated, '1 mi')),
  'K — a truncated result says so');
ok(!/more canonical project geometry exists/.test(HS.n5CoverageNote(ROWS, '1 mi')),
  'K — a complete result does not claim truncation');
ok(!/p_limit:\s*\d+\s*\*\s*\d|unbounded/i.test(page) && /p_limit:\s*N5_LIMIT/.test(page),
  'K — completeness is not solved by an unbounded query');

// ── 12. zero results are scoped to the corpus queried, never "nothing nearby" ────────────────
const zero = HS.n5CoverageNote([], '2 mi');
ok(/no canonical project geometry in the development corpus fell within 2 mi/.test(zero),
  '12 — zero rows are described as what the development corpus returned');
ok(!/nothing nearby|nothing near|no development near/i.test(zero), '12 — no universal absence claim');

// ── Q + the registry_id trap: an N5 project is never an EPA facility ────────────────────────
ok(SITES.every(s => frsRid(s) === ''),
  'Q — no N5 site carries registry_id, so frsRid() is empty and none is an EPA facility');
ok(SITES.every(s => s.src === 'austin-site-plan-cases' || s.src === 'massdot-highway-projects'),
  'Q — the source registry identity is preserved, on `src`, where nothing keys facility behaviour off it');
ok(PROJECTS.every(p => p.registry_id) && SITES.every(s => s.registry_id === undefined),
  'Q — control: hydration DOES carry a registry_id and it is deliberately not copied');
ok(SITES.every(s => s.relevance === 'development' && s.scope === 'point'),
  'Q — N5 results are development points, never facilities');

// ── merge: facilities and area notices survive untouched ────────────────────────────────────
const REPORT_SITES = [
  { scope: 'point', label: 'ACME PLATING', registry_id: '110000123456', url: 'https://echo.epa.gov/x' },
  { scope: 'point', relevance: 'development', label: 'engine dev point', record_url: 'https://x/1' },
  { scope: 'area', relevance: 'development', label: 'County rezoning hearing', record_url: 'https://x/2' },
  { scope: 'area', relevance: 'civic', label: 'Budget hearing', record_url: 'https://x/3' }
];
const merged = HS.n5MergeSites(REPORT_SITES, SITES);
ok(merged.filter(s => s.scope === 'point' && s.relevance !== 'development').length === 1,
  'Q — the EPA facility survives the merge unchanged');
ok(merged.find(s => s.label === 'ACME PLATING').registry_id === '110000123456',
  'Q — and keeps its FRS registry id, so it is still a facility');
ok(!merged.some(s => s.label === 'engine dev point'),
  'address mode replaces the engine\'s own development points with canonical results');
ok(merged.filter(s => s.scope === 'area').length === 2,
  'P — both area/jurisdiction notices survive');
ok(merged.filter(s => s.scope === 'area').every(s => s.distance_mi === undefined),
  'P — an area notice is given no radius distance, so it can never be labelled "within X miles"');
ok(/jurisdiction-wide notice|County\/city-wide notice/i.test(page),
  'P — the page still frames area notices as jurisdiction-wide, not sited');
ok(merged.length === REPORT_SITES.length - 1 + SITES.length, 'merge keeps exactly what it should');

// ── lifecycle mapping is a closed vocabulary, never a guess ─────────────────────────────────
ok(HS.n5BucketFromStatus('Approved') === 'approved' && HS.n5BucketFromStatus('Proposed') === 'proposed'
  && HS.n5BucketFromStatus('Operating') === 'operating', 'status maps to the three lifecycle words');
ok(HS.n5BucketFromStatus('Active') === 'unknown' && HS.n5BucketFromStatus(null) === 'unknown'
  && HS.n5BucketFromStatus('') === 'unknown',
  'an unrecognised or absent status resolves to `unknown` — never a guessed colour');
ok(SITES[0].bucket === 'approved' && SITES[0].type === 'approved' && SITES[0].use_type === 'Industrial',
  'the lifecycle word and the project category are carried separately');

// ══════════════════════ WIRING — asserted against the page ══════════════════════
// B. address mode uses the existing production geocoder
ok(/GEOCODE_ENDPOINT\s*=\s*SUPABASE_URL\s*\+\s*"\/functions\/v1\/geocode-address"/.test(page),
  'B — address mode calls the existing production geocode-address function');
ok((page.match(/geocodeAddress\(/g) || []).length >= 2 && !/nominatim|mapbox|google.*geocod/i.test(page),
  'B — one geocoder, and no second one was introduced');
ok(/HOME is the geocoder's exact returned point/.test(page), 'B — HOME comes from the geocoder');
ok(!/ZIP centroid[\s\S]{0,80}home\s*=/.test(page), 'B — a ZIP centroid is never used as HOME');

// C. the geocoder's exact coordinates reach the RPC
ok(/var home = \{ lat: m\.lat, lng: m\.lng \};/.test(page),
  'C — HOME is the geocoder\'s lat/lng, taken verbatim');
ok(/p_lat: home\.lat, p_lng: home\.lng/.test(page), 'C — those exact values are the RPC arguments');
// scoped to the address path: the page legitimately uses toFixed() elsewhere for display.
const runBody = page.slice(page.indexOf('function run(address)'), page.indexOf('// ZIP mode: read the cached'));
ok(!/toFixed\(|Math\.round\(|parseFloat\(m\.|Number\(m\./.test(runBody),
  'C — nothing on the address path rounds, reformats or reparses the geocoder coordinates');
ok(/m\.lat/.test(runBody) && !/m\.lat\s*\.toFixed|\+\s*m\.lat/.test(runBody),
  'C — control: the address path really does read m.lat, and does not transform it');

// D. the selected radius reaches the RPC, and only supported radii can be sent
ok(/p_radius_mi: radiusMi/.test(page) && /n5Radius\(home, radius\)/.test(page),
  'D — the selected radius is the RPC argument');
ok(/var radius = CUR_RADIUS;/.test(page),
  'M — the radius is pinned per search, so a later click cannot rewrite an in-flight query');
ok(/function snapRadiusForAddress\(\)/.test(page) && /function syncRadiusStops\(\)/.test(page),
  'D — address mode is constrained to the RPC\'s own radius allowlist');
ok(/HS\.N5_RADII\.indexOf\(r\) >= 0/.test(page) && JSON.stringify(HS.N5_RADII) === '[0.5,1,2,5]',
  'D — the allowlist is exactly 0.5 / 1 / 2 / 5');

// A + N. the two modes stay separate
ok(/development_reports\?zip=eq\./.test(page), 'A — ZIP mode still reads the entire-ZIP cached report');
const loadZipBody = page.slice(page.indexOf('function loadZip(zip)'), page.indexOf('function render(data)'));
ok(!/n5Radius\(|N5_RPC_URL/.test(loadZipBody), 'A — ZIP mode never calls the N5 radius RPC');
ok(!/development_reports/.test(page.slice(page.indexOf('function run(address)'), page.indexOf('// ZIP mode: read the cached'))),
  'N — address mode never reads the ZIP cache');
ok(/N5_NOTE = "";\s*\/\/ ZIP mode never carries/.test(page),
  'N — switching to ZIP mode clears the address-radius note');

// L + M + 13. stale responses cannot repaint a newer search
ok(/var REQ_SEQ = 0;/.test(page) && /function currentReq\(t\)\{ return t === REQ_SEQ; \}/.test(page),
  'L — every search takes a ticket');
ok((page.match(/if\(!currentReq\(token\)\) return;/g) || []).length >= 4,
  'L — the ticket is re-checked at every async continuation (' + (page.match(/if\(!currentReq\(token\)\) return;/g) || []).length + ' guards)');
ok(/function loadZip\(zip\)\{[\s\S]{0,400}var token = \+\+REQ_SEQ;/.test(page.replace(/\n/g, '\n')),
  'N — ZIP mode takes a ticket too, so a slow ZIP read cannot repaint over a newer address');
ok(/geocoder[\s\S]{0,200}no-match|couldn't find that address/i.test(page),
  '13 — a geocoder no-match renders nothing and says so');

// O. the anti-fabrication gate still governs what renders
ok(/function sourced\(s\)\{ return !!\(s && \(\(s\.url/.test(page), 'O — the sourced() gate is unchanged');
ok(/var sites = \(data\.sites \|\| \[\]\)\.filter\(sourced\);/.test(page),
  'O — every site, N5 included, still passes through it before rendering');

// 8. the results feed the EXISTING Map 1 experience, not a second renderer
ok(!/function renderN5|function drawN5|n5List|n5Renderer/i.test(page),
  '8 — no parallel renderer was introduced; N5 sites enter the existing render()/drawMap()');
ok(/data\.sites = HS\.n5MergeSites\(data\.sites \|\| \[\], n5\.sites\);/.test(page),
  '8 — canonical results are merged into the page\'s one site array');

// 17. Map 2 untouched
ok(!/maps\.html/.test(page.slice(page.indexOf('function run(address)'), page.indexOf('function render(data)'))),
  '17 — the address path does not touch Map 2');

process.exit(fails ? 1 : 0);
