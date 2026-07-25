// Name-enrichment phase of the canonical marker resolver (lib/map.js NAME_RULES) —
// regression tests on VERBATIM production strings (app_projects, pulled 2026-07-25).
//
// The contract: a record whose SOURCE type is generic ("Development"/"unclassified"/
// "Trades") may have its type SHAPE derived from the source's own permit-class text
// in the record NAME — never from a guess. A record with a SPECIFIC source type is
// never reinterpreted; a name that states no building type stays the honest neutral
// circle; facilities are untouched (purple square, explicit flag only).
//
// Run: node test/marker-name-enrichment.test.mjs
let fails = 0;
const ok = (c, name) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name); if (!c) fails++; };

global.window = { HS: {} };
await import('../lib/templates.js');
await import('../lib/map.js');
const HS = global.window.HS;
const FAC = HS.markerRegistry.facilityHex;
const shape = (type, name) => HS.resolveMarker({ type, name, status: 'Approved' }).shape;

// ── 1. Verbatim production names → enriched shapes ─────────────────────────────────
// Residential (pentagon)
ok(shape('Development', 'Residential Alteration') === 'pentagon', 'Detroit "Residential Alteration" → pentagon');
ok(shape('unclassified', '1,2,3 Family - Other MEP') === 'pentagon', 'Columbus "1,2,3 Family - Other MEP" → pentagon');
ok(shape('unclassified', 'Multi Family - Other Structural') === 'pentagon', 'Columbus "Multi Family - Other Structural" → pentagon');
ok(shape('Development', 'Addition and/or Alteration Residential Building Permit') === 'pentagon', 'Philly residential permit → pentagon');
ok(shape('Development', 'PERMIT - NEW CONSTRUCTION SELF CERT 2019 CBC: ERECT 2 STORY VA FRAME SINGLE FAMILY RESIDENCE WITH BASEMENT') === 'pentagon', 'Chicago single-family → pentagon');
ok(shape('Development', 'General Construction NEW 3 STORY 2 FAMILY DWELLING. OBTAIN NEW CERTIFICATE OF OCCUPANCY.') === 'pentagon', 'NYC 2-family dwelling → pentagon');
ok(shape('Development', 'Building Residential - New To build a garage with living area above') === 'pentagon', 'Nashville "Building Residential - New" → pentagon');
// Commercial (hexagon)
ok(shape('Development', 'Addition and/or Alteration Commercial Building Permit') === 'hexagon', 'Philly commercial permit → hexagon');
ok(shape('unclassified', 'Building Commercial - Rehab To conduct interior renovations for new tenant; VAPE SHOP (retail).') === 'hexagon', 'Nashville "Building Commercial - Rehab" → hexagon');
ok(shape('Development', 'Commercial Alterations') === 'hexagon', 'Detroit "Commercial Alterations" → hexagon');
ok(shape('Development', 'Earth Work ALT-1 FILING TO RENOVATION OF EXISTING MIXED USE BUILDING WITH NEW 2ND. FLOOR') === 'hexagon', 'NYC mixed-use → hexagon');
// Industrial (triangle)
ok(shape('Development', 'Building Commercial - New To construct 46,250SF warehouse with associated office space.') === 'triangle', 'Nashville warehouse → triangle (industrial)');
// Data center (square — NOT the facility purple)
const dc = HS.resolveMarker({ type: 'unclassified', name: 'ZYDECO DATA CENTER (WITHDRAWAL & RESUBMITTAL OF SP-06-0332C)', status: 'Proposed' });
ok(dc.shape === 'square' && dc.color !== FAC && dc.isFacility === false, 'Austin "ZYDECO DATA CENTER" → data-center square, status color, never facility purple');
// Infrastructure (diamond)
ok(shape('Development', 'Neighborhood Development Permit Wireless Communication Facility(WCF)-Discretionary Project:9292/Miramar') === 'diamond', 'San Diego wireless facility → diamond (adversarial: NOT pentagon from "Neighborhood")');

// ── 2. Honest neutral: class states no building type → circle stays ────────────────
ok(shape('Development', 'Building Permits') === 'circle', 'bare "Building Permits" → circle');
ok(shape('Development', 'Building: Alteration and Addition') === 'circle', 'Cambridge generic alteration → circle');
ok(shape('Trades', 'Plumbing Permit Install sewer line') === 'circle', 'sewer LATERAL is a trade job → circle (not infrastructure)');
ok(shape('Trades', 'Plumbing Permit DWSD LEAD SERVICE LINE REPLACEMENT -WORK ORDER #725821') === 'circle', 'Detroit lead service line → circle');
ok(shape('Trades', 'Mechanical Permit HEATING') === 'circle', 'trades HVAC → circle');
ok(shape('unclassified', 'Sign') === 'circle', 'sign permit → circle');
ok(shape('Development', 'General Construction Exterior facade restoration; install temporary sidewalk shed for duration of the work.') === 'circle', 'facade job mentioning a sidewalk SHED → circle (adversarial: not infrastructure)');
ok(shape('Development', 'PERMIT - RENOVATION/ALTERATION SPR 2019 CBRC: INTERIOR ALTERATIONS TO SUBDIVIDE SPACE.') === 'circle', 'typeless Chicago renovation → circle');
const blank = HS.resolveMarker({});
ok(blank.shape === 'circle' && blank.color === HS.markerRegistry.neutralHex, 'no fields at all → neutral circle');

// ── 2b. #373 keyword-recovery traps stay fixed (real strings, proven live) ─────────
// Names must go through NAME_RULES, never the broad KEYWORD_RULES: 'road' inside a
// street name and 'neighborhood' inside a permit-class name misfired on main (#373).
ok(shape('Development', 'Building Permit General-Express-Building Construction:655/Broadway') === 'circle',
   'San Diego street-name "Broadway" → circle (adversarial: broad keyword \'road\' must not fire on names)');
ok(shape('Development', 'Building Permit General-Express-Building Construction:879/Harbor') === 'circle',
   'San Diego street-name permit → circle');

// ── 3. Precedence invariants ────────────────────────────────────────────────────────
// A SPECIFIC source type is never reinterpreted by the name.
ok(shape('Residential', 'Commercial building fit-out') === 'pentagon', 'specific type Residential wins over a commercial-sounding name');
// Civic/Public is a GENERIC bucket per #373's merged GENERIC_EXACT decision (non-
// terminal), so a civic record with residential class text may refine — pinned here
// so the semantics are explicit, not accidental.
ok(shape('Civic/Public', 'Residential shelter renovation') === 'pentagon', 'Civic/Public is generic (#373 GENERIC_EXACT) — name may refine');
ok(shape('Industrial', 'Residential-adjacent warehouse') === 'triangle', 'specific Industrial type wins');
// Facilities untouched: explicit flag only, always purple square.
const fac = HS.resolveMarker({ type: 'industrial', name: 'Residential Water Treatment Co', record_kind: 'facility', status: 'Operating' });
ok(fac.shape === 'square' && fac.color === FAC && fac.isFacility === true, 'facility flag beats every name rule — purple square');
// A non-facility can never gain purple from the name phase.
const nn = HS.resolveMarker({ type: 'Development', name: 'Regulated facility annex expansion', status: 'Approved' });
ok(nn.color !== FAC, 'name text can never paint a non-facility purple');
// Status color is independent of name enrichment.
const st = HS.resolveMarker({ type: 'Development', name: 'Residential Alteration', status: 'Proposed' });
ok(st.shape === 'pentagon' && st.color === '#c47a1a', 'enriched shape keeps the canonical status color (Proposed orange)');

if (fails) { console.error('\n' + fails + ' assertion(s) failed'); process.exit(1); }
console.log('\nAll marker name-enrichment tests passed.');
