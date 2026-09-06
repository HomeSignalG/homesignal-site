// MAP 1 — "Type — pin shape" legend chips are FILTER TOGGLES, not decoration.
//
// THE BUG THIS PINS. homesignalmap.html shipped two legend rows that looked identical and
// behaved differently. "Stage — pin color" chips got tabIndex + role="button" + click and
// keydown handlers. "Type — pin shape" chips were one innerHTML string with no wiring — while
// inheriting the FULL toggle affordance from `.mapkey span` (cursor:pointer, a :hover state, a
// :focus-visible outline and a defined `.off` appearance). So they looked switchable, defined
// what "off" looks like, and did nothing. The only type filter the product ever had was the
// "Project types" dropdown on maps.html, removed in #338 on the reasoning that "project types
// are already shown in the map legend's Type — pin shape section" — true of SHOWN, false of
// FILTERED — and then maps.html itself was retired in #1028.
//
// WHY IT IS CHECKED STRUCTURALLY. The toggle lives in an inline <script> that needs Leaflet,
// MapLibre, Three.js and a live DOM to execute, so this suite reads the shipped file. A string
// check that only ever sees the fixed file is worthless — it would pass over the broken code
// too — so every check is run TWICE: once against the shipped page, and once against the
// verbatim pre-change source embedded below, which it MUST reject. An instrument that cannot
// fail is not evidence.
//
// The category half is NOT structural: it drives the real shipped resolver out of lib/map.js,
// so a chip that switches nothing and a record that no chip can switch both fail here.
//
// Run: node test/map1-type-filter.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0;
const ok = (c, name) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name); if (!c) fails++; };

const PAGE = readFileSync(join(root, 'homesignalmap.html'), 'utf8');

// ── THE CHECKER ───────────────────────────────────────────────────────────────────────
// Returns the list of wiring properties a source is MISSING. Empty = fully wired.
function missingWiring(src) {
  const miss = [];
  // The shape-legend BUILDER, isolated so a match inside the STAGE builder cannot score for
  // the Type row — the two are near-identical and that is exactly how this would false-pass.
  // Anchored on the builder's own condition. Two weaker anchors were tried and BOTH read a
  // window of the wrong code, reporting the wired page as unwired: the bare id "mapkeyShapes"
  // first matches the HTML div ~1,400 lines earlier, and `getElementById("mapkeyShapes")`
  // first matches __HS_TRACKER_MARKER_VERIFY's own legend assertion. In a file where the same
  // identifier appears in markup, a verifier and the builder, indexOf on the obvious token is
  // not the builder.
  const i = src.indexOf('if(shapes && HS.SHAPE_LEGEND){');
  const block = i === -1 ? '' : src.slice(i, i + 3000);
  if (i === -1) miss.push('no-shape-legend-builder');
  if (!/row\.tabIndex\s*=\s*0/.test(block)) miss.push('type-chip-not-focusable');
  if (!/setAttribute\(\s*["']role["']\s*,\s*["']button["']\s*\)/.test(block)) miss.push('type-chip-no-button-role');
  if (!/addEventListener\(\s*["']click["']/.test(block)) miss.push('type-chip-no-click');
  if (!/addEventListener\(\s*["']keydown["']/.test(block)) miss.push('type-chip-no-keydown');
  if (!/aria-pressed/.test(block)) miss.push('type-chip-no-aria-pressed');
  if (!/TYPE_FILTER\[/.test(block)) miss.push('type-chip-writes-no-filter-state');
  // State must exist and be read by a predicate.
  if (!/var\s+TYPE_FILTER\s*=/.test(src)) miss.push('no-type-filter-state');
  if (!/function\s+typeVisible\s*\(/.test(src)) miss.push('no-typeVisible-predicate');
  // DEFAULT-VISIBLE polarity. `!TYPE_FILTER[k]` would make an unseen category read as hidden —
  // the `FILTER.built` legacy-alias trap, where a key missing from the map silently drops every
  // record carrying it and looks exactly like a ZIP that has none.
  if (!/TYPE_FILTER\[typeKeyOf\(s\)\]\s*!==\s*false/.test(src)) miss.push('type-filter-not-default-visible');
  // ALL THREE VIEWS, ASSERTED PER PATH. The legend is persistent across 2D / 3D aerial / 3D
  // satellite, so a chip that only filters the view it was clicked in is a worse bug than no
  // chip at all — the resident switches a type off, changes view, and it is back.
  //
  // This began as a count of `typeVisible(` with a floor of 4 and it did NOT catch deleting the
  // call from the satellite path: the count included the function's own DEFINITION, so 5 became
  // 4 and still cleared the floor. A total over a file is not coverage of the paths in it.
  // Each render function is now sliced out and checked on its own name.
  [['applyFilter', 1], ['build3DFacilities', 2], ['buildGLMarkers', 1]].forEach(([fn, want]) => {
    const j = src.indexOf('function ' + fn + '(){');
    if (j === -1) { miss.push('render-path-missing:' + fn); return; }
    // Bounded by the next top-level `\n  function ` so one path cannot borrow another's call.
    const rest = src.slice(j + 10);
    const end = rest.indexOf('\n  function ');
    const body = end === -1 ? rest : rest.slice(0, end);
    const got = (body.match(/typeVisible\(/g) || []).length;
    if (got < want) miss.push('typeVisible-missing-in:' + fn + '(' + got + '<' + want + ')');
  });
  return miss;
}

// ── 1. THE SHIPPED PAGE IS FULLY WIRED ────────────────────────────────────────────────
const shipped = missingWiring(PAGE);
ok(shipped.length === 0, '1: the shipped Type row is a real toggle — missing: [' + shipped.join(', ') + ']');

// ── 2. SELF-TEST — the checker REJECTS the code as it shipped before this fix ──────────
// Verbatim from homesignalmap.html before the repair (the whole shape-legend builder), plus
// the surrounding state it did NOT have. If this block ever passes, every check above is
// vacuous and the suite is scoring green over nothing.
const PRE_CHANGE = `
    var shapes = document.getElementById("mapkeyShapes");
    if(shapes && HS.SHAPE_LEGEND){
      var neutral = HS.markerRegistry.neutralHex;
      var rows = HS.SHAPE_LEGEND.map(function(s){
        return "<span class='sh'><span class='ic'>" + HS.markerSVG(s.shape, neutral, "", 14) + "</span><span class='t'>" + esc(s.label) + "</span></span>";
      });
      rows.push("<span class='sh'><span class='ic'>" + HS.markerSVG("square", HS.markerRegistry.facilityHex, "", 14) + "</span><span class='t'>Regulated facility</span></span>");
      shapes.innerHTML = rows.join("");
    }
`;
const pre = missingWiring(PRE_CHANGE);
const MUST_CATCH = ['type-chip-not-focusable', 'type-chip-no-button-role', 'type-chip-no-click',
  'type-chip-no-keydown', 'no-type-filter-state', 'no-typeVisible-predicate'];
MUST_CATCH.forEach((k) => ok(pre.includes(k), '2: self-test — the checker catches ' + k + ' in the pre-change source'));

// ── 3. WRONG-POLARITY SELF-TEST ───────────────────────────────────────────────────────
// The plausible wrong fix: `!TYPE_FILTER[...]`, which reads an untouched category as OFF and
// blanks the map on first paint. It must be caught, or the polarity rule is unenforced.
ok(missingWiring(PAGE.replace(/TYPE_FILTER\[typeKeyOf\(s\)\]\s*!==\s*false/, '!TYPE_FILTER[typeKeyOf(s)]'))
  .includes('type-filter-not-default-visible'), '3: self-test — fail-closed polarity is rejected');

// ── 4. A CHIP PER CATEGORY, DRIVEN THROUGH THE REAL SHIPPED RESOLVER ──────────────────
global.window = { HS: {} };
await import('../lib/templates.js');
await import('../lib/map.js');
const HS = global.window.HS;

// The chip keys the page builds: SHAPE_LEGEND (generated from CATEGORY_REGISTRY) + the
// facility row it appends, because lib/map.js filters isFacility out of that list.
const chipKeys = new Set(HS.SHAPE_LEGEND.map((s) => s.categoryKey).concat(['facility']));

// One fixture per registry category, in the page's own call shape (site object -> the real
// resolveTrackerMarker with the real frsRid), never resolveMarker directly.
const frsRid = (s) => (s && s.registry_id != null ? String(s.registry_id).trim() : '');
const FIXTURES = [
  ['datacenter',     { label: 'DC',    use_type: 'Data Center',  type: 'approved' }],
  ['industrial',     { label: 'Plant', use_type: 'Industrial',   type: 'proposed' }],
  ['residential',    { label: 'Homes', use_type: 'Residential',  type: 'built'    }],
  ['infrastructure', { label: 'Road',  use_type: 'Infrastructure', type: 'approved' }],
  ['commercial',     { label: 'Shop',  use_type: 'Commercial',   type: 'proposed' }],
  ['civic',          { label: 'Fire',  use_type: 'Civic/Public', type: 'approved' }],
  ['other',          { label: 'Misc',  use_type: 'unclassified', type: 'approved' }],
  ['facility',       { label: 'EPA',   use_type: 'Industrial',   type: 'built', registry_id: 'TX-VERIFY' }]
];
FIXTURES.forEach(([want, site]) => {
  const got = HS.resolveTrackerMarker(site, frsRid).typeKey;
  ok(got === want, '4: ' + site.label + ' resolves to typeKey "' + want + '" (got "' + got + '")');
  // A record whose category has no chip can never be switched off — an unswitchable pin.
  ok(chipKeys.has(got), '4: typeKey "' + got + '" has a legend chip (no unswitchable record)');
});

// No DEAD chip: every chip must correspond to a category the resolver actually emits — that is
// the precise defect being repaired, one level up (a control that switches nothing).
const emitted = new Set(FIXTURES.map(([, s]) => HS.resolveTrackerMarker(s, frsRid).typeKey));
[...chipKeys].forEach((k) => ok(emitted.has(k), '5: chip "' + k + '" switches a category the resolver emits'));

// ── 6. EVERY REGISTRY CATEGORY IS COVERED (no silent shrink) ──────────────────────────
const registryKeys = Object.keys(HS.CATEGORY_REGISTRY).filter((k) => HS.CATEGORY_REGISTRY[k].legend);
ok(registryKeys.every((k) => chipKeys.has(k)),
  '6: every legend-bearing registry category has a chip — registry ' + registryKeys.length + ', chips ' + chipKeys.size);

// ── 7. THE EMPTY STATE EXISTS ─────────────────────────────────────────────────────────
// Switching off every Type renders a blank map. Without a note that is indistinguishable from
// a ZIP with no records — the same silence-vs-filtered ambiguity the polarity rule guards.
ok(/id="mapkeyEmpty"/.test(PAGE), '7: the page carries an empty-state node');
ok(/mapkeyEmpty[\s\S]{0,400}?em\.hidden\s*=/.test(PAGE.slice(PAGE.indexOf('function applyFilter'))),
  '7: applyFilter drives the empty-state node');

console.log('\n' + (fails ? fails + ' FAILED' : 'map1-type-filter: all checks passed'));
process.exit(fails ? 1 : 0);
