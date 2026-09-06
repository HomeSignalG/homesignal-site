// ADVERSARIAL REGRESSIONS for Map 1 Residential — written from the independent audit's own
// production findings, and deliberately covering the source families the previous 146-test
// suite did not touch at all (austin-*, delaware-county-pa-*, york-county-pa-*,
// seattle-land-use-permits, fairfax-active-site-construction, dallas-specific-use-permits).
// Those were the six families the rule performed WORST on, and their absence is why a
// green suite shipped a defect.
//
// EVERY case below drives the SHIPPED PATH, not the isolated predicate:
//   * type resolution through HS.resolveTrackerMarker (the page's own wrapper)
//   * the site gate through HS.residentialQualifySites (what render() and renderProperty() call)
// A test that only called HS.residentialActivity would pass while the page rendered the record.
//
// Run: node test/residential-total-qualification.test.mjs
import fs from 'node:fs';
let fails = 0;
const ok = (c, name) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name); if (!c) fails++; };

global.window = { HS: {} };
await import('../lib/map.js');
await import('../lib/tracker-marker.js').catch(() => {});
await import('../lib/residential-qualify.js');
const HS = global.window.HS;

// ── the shipped page path, reproduced exactly ───────────────────────────────────────────────
// A cached report site as development_reports.sites actually stores one (keys taken from the
// live payload census, 2026-09-06: title, label, type_raw, use_type, source_registry_id,
// record_url, scope, relevance).
function areaSite(o) {
  return {
    scope: 'area', relevance: 'development', label: o.title, title: o.title,
    type_raw: o.type_raw, use_type: o.use_type || 'Residential',
    source_registry_id: o.registry_id, record_url: 'https://example.gov/r/1',
    url: 'https://example.gov/r/1', lat: null, lng: null
  };
}
function pointSite(o) {
  const s = areaSite(o); s.scope = 'point'; s.lat = 30.1; s.lng = -97.6; return s;
}
const kept = (sites) => HS.residentialQualifySites(sites).length;
const typeOf = (s) => { try { return HS.resolveTrackerMarker(s).typeKey; } catch (e) { return 'ERR'; } };

// ── 1. BYPASS — the P0 the audit proved ─────────────────────────────────────────────────────
// The audit's executable control used verbatim Overland Park rows from ZIP 66212. Both
// resolved to a residential pentagon and both were UNRESOLVED on their own evidence, and both
// rendered anyway because zipAuthMergeSites only ever dropped scope 'point'.
const opDeck = areaSite({ title: 'Building (Residential) 10925 GILLETTE ST', type_raw: 'Deck',
                          registry_id: 'overland-park-building-permits' });
const opRepair = areaSite({ title: 'Building (Residential) 11704 W 102ND ST', type_raw: 'Repair',
                            registry_id: 'overland-park-building-permits' });
ok(typeOf(opDeck) === 'residential', '1a: the bypassing area record IS typed residential by the shipped classifier');
ok(kept([opDeck, opRepair]) === 0, '1b: an area-scope Residential candidate with routine evidence is REMOVED');

// The other direction: a genuine area-scope residential development must survive.
const napervilleArea = areaSite({ title: 'RESIDENTIAL Single Family New Construction - Lot 168',
                                  type_raw: 'RESIDENTIAL', registry_id: 'naperville-building-permits' });
ok(kept([napervilleArea]) === 1, '1c: a genuine area-scope Residential development is KEPT');

// The property/address path uses the same helper, so the same record cannot earn a Type on the
// address dossier that it could not earn on the ZIP page.
ok(kept([opDeck, napervilleArea]) === 1, '1d: the property-report path applies the identical contract');

// Scope: the gate only ever touches development records.
const facility = { scope: 'point', relevance: 'facility', label: 'ACME PLATING', registry_id: '110000123456',
                   record_url: 'https://echo.epa.gov/x', lat: 30, lng: -97 };
ok(HS.residentialQualifySites([facility]).length === 1, '1e: a facility is returned untouched');
const civic = { scope: 'area', relevance: 'civic', label: 'Planning Commission Work Session', url: 'https://x' };
ok(HS.residentialQualifySites([civic]).length === 1, '1f: a civic notice is returned untouched');

// ── 2. PROVENANCE — granted families ────────────────────────────────────────────────────────
const V = (rid, tr, nm) => HS.residentialActivity({ registry_id: rid, type_raw: tr, name: nm });
const dev = (rid, tr, nm) => V(rid, tr, nm).verdict === 'DEVELOPMENT';
ok(dev('austin-subdivision-cases', 'Single Family', 'The Vistas of Austin Section 1'),
  '2a: Austin subdivision case qualifies');
ok(dev('austin-site-plan-cases', 'MF', 'MOUNTAIN SHADOWS APARTMENTS'),
  '2b: Austin site-plan multifamily qualifies');
ok(dev('delaware-county-pa-subdivisions-land-developments', 'Residential',
       '60 West Avenue Develop 1.76 acres with a 45-unit residential/mixed use building'),
  '2c: Delaware County land-development case qualifies');
ok(dev('york-county-pa-planning-subdivisions', 'NO NO YES NO NO NO NO NO', 'Winfield Phase I'),
  '2d: York County subdivision plan qualifies despite a checkbox-matrix type_raw');
ok(dev('seattle-land-use-permits', 'Single Family/Duplex',
       'Master Use Permit Land Use Application to subdivide one development site into two'),
  '2e: Seattle land-use subdivision qualifies');
ok(dev('fairfax-active-site-construction', 'Infill Lot Grading Plan', 'FOX LAKE CAVALIERS ADDITION LOT 10'),
  '2f: Fairfax infill lot grading plan qualifies');
// REJECTED provenance, each on the census that rejected it.
ok(V('dallas-specific-use-permits', 'Multiple-family use', 'Multiple-family use').verdict === 'UNRESOLVED',
  '2g: Dallas SUP is NOT provenance-qualified (530 use values, not a development corpus)');
ok(V('slc-planning-petitions', 'Routine and Uncontest Home Occ', 'Routine and Uncontest Home Occ').verdict
     !== 'DEVELOPMENT',
  '2h: an SLC home-occupation petition is not development');
ok(!HS.RESIDENTIAL_VOCABULARY.dev_provenance['burlington-vt-zoning-permits']
   && !HS.RESIDENTIAL_VOCABULARY.dev_provenance['slo-county-planning-permits']
   && !HS.RESIDENTIAL_VOCABULARY.dev_provenance['arlington-permit-applications'],
  '2i: zoning-district and mixed-corpus families were NOT granted provenance');
// Provenance is BELOW row-level routine evidence — a pool in a development registry is a pool.
ok(V('fairfax-active-site-construction', 'Infill Lot Grading Plan', 'Carriage Hill Lot 60 - Pool').verdict
     === 'ROUTINE',
  '2j: PROVENANCE NEVER OVERRIDES row-level routine evidence (68 real Fairfax pools)');

// ── 3. NAME COLLISIONS — a project name is not an activity ──────────────────────────────────
ok(dev('york-county-pa-planning-subdivisions', 'NO NO YES NO NO NO NO NO', 'Cherry Tree'),
  '3a: a subdivision plan called "Cherry Tree" is not tree-removal evidence');
ok(dev('austin-subdivision-cases', 'Single Family', 'Shoalwood Addition Sec 4'),
  '3b: a Texas subdivision called "... Addition" is not a building addition');
ok(dev('austin-subdivision-cases', 'SF', 'CRIST LAND ADDITION'), '3c: ...and again on a second real case');
// The control that makes 3a-3c a fix rather than a hole: the same words in ACTIVITY text still exclude.
ok(V('miami-building-permits', 'Residential', 'ADDITION AND ALTERATION TO EXISTING RESIDENCE').verdict
     === 'ROUTINE',
  '3d: a genuine building ADDITION is still excluded');
ok(V('miami-building-permits', 'Residential', 'NEW CONSTRUCTION TREE REMOVAL').verdict === 'ROUTINE',
  '3e: a tree-removal permit is still excluded');
ok(V('seattle-land-use-permits', 'Single Family/Duplex',
     'Master Use Permit Shoreline application to allow an addition to an existing single family residence')
     .verdict === 'ROUTINE',
  '3f: "addition" keeps full force in a family whose name column IS a description');
ok(HS.residentialNameIsLabel('york-county-pa-planning-subdivisions')
   && !HS.residentialNameIsLabel('seattle-land-use-permits'),
  '3g: the label/activity split comes from the registry, not from the record');

// ── 4. DEVELOPMENT VOCABULARY ───────────────────────────────────────────────────────────────
ok(dev('delaware-county-pa-subdivisions-land-developments', 'Residential',
       'Glendale Heights HOA Subdivide 41.411 acres into two lots'), '4a: "subdivide" qualifies');
ok(dev('austin-subdivision-cases', 'Single Family', 'Manor Road Addition Resub of a Part of BLK A & D'),
  '4b: "resub" qualifies');
ok(V('x', 'Residential', 'Resubmission of plans for kitchen remodel').verdict === 'ROUTINE',
  '4c: "resub" is space-delimited — it cannot match "resubmission"');
ok(V('x', 'Residential', 'Adjacent to the new development on Elm').verdict === 'UNRESOLVED',
  '4d: incidental "development" wording does not qualify');
ok(dev('naperville-building-permits', 'RESIDENTIAL', 'RESIDENTIAL Single Family New Construction - Lot 168'),
  '4e: an unanchored "new construction" in activity text qualifies (Naperville)');

// ── 5. PRECEDENCE — strong routine outranks incidental development vocabulary ───────────────
ok(V('topeka-building-permits', 'Residential Interior Remodel',
     'Residential Interior Remodel 4124 SW STONEYLAKE DR LOT8 BLOCK A CLARION LAKE SUBDIVISION').verdict
     === 'ROUTINE',
  '5a: a remodel is NOT rescued by "SUBDIVISION" in its address');
ok(V('wake-county-building-permits', 'Residential Accessory Building Structure',
     'Residential Accessory Building Structure EXIST SFD').verdict === 'ROUTINE',
  '5b: an accessory structure stays excluded');
ok(V('memphis-dpd-building-permits', 'RES', 'ACC Build wood fence according to site plan').verdict === 'ROUTINE',
  '5c: a fence is not development because the scope text says "site plan"');
ok(V('x', 'Residential', 'HVAC replacement at Cherry Tree Estates').verdict === 'ROUTINE',
  '5d: routine work AT a named development is still routine');
ok(V('miami-building-permits', 'Residential', 'NEW CONSTRUCTION COMBINATION POOL AND SPA').verdict === 'ROUTINE',
  '5e: an accessory object outranks a construction head');
ok(dev('miami-building-permits', 'Residential', 'NEW CONSTRUCTION TWO-FAMILY RESIDENCE|WATERPROOFING'),
  '5f: a real two-family residence survives a misleading component word');
ok(dev('x', 'Residential', 'NEW CONSTRUCTION 200 UNITS APARTMENT WITH POOL'),
  '5g: a scale noun outranks an accessory object inside a real development');

// ── 6. CONSERVATIVE CONTROLS — the over-correction guard ────────────────────────────────────
ok(V('topeka-building-permits', 'Residential Building Footing and Foundat',
     'Residential Building Footing and Foundation 5641 SW 33RD').verdict === 'UNRESOLVED',
  '6a: Topeka footing/foundation stays UNRESOLVED (104 of its 427 addresses also carry an Addition)');
ok(V('brunswick-county-permits', 'Residential', 'Residential 594 BARRINGTON PL').verdict === 'UNRESOLVED',
  '6b: a bare "Residential" + address is UNRESOLVED');
ok(V('durham-building-permits', 'MULTI_FAMILY', 'MULTI_FAMILY Fayette Place Affordable').verdict === 'UNRESOLVED',
  '6c: multifamily USE alone does not prove development');
ok(V('little-rock-permits', 'APARTMENT COMPLEX', 'PLU 8101 CANTRELL RD').verdict === 'ROUTINE',
  '6d: plumbing at an apartment complex is still excluded');
ok(V('montgomery-county-residential-permits', 'CONSTRUCT',
     'CONSTRUCT Prefabricated Suncast Modernist shed, New Shed').verdict === 'ROUTINE',
  '6e: Montgomery "CONSTRUCT" was NOT granted a family rule — its sampled rows are sheds and decks');
ok(V('x', 'Residential', 'NEW HOPE RD').verdict === 'UNRESOLVED',
  '6f: a street beginning with "NEW" is not a development');

// ── 7. CROSS-TYPE — no collateral damage, no silent retyping ────────────────────────────────
const dc = pointSite({ title: 'Data Center Building Permit', type_raw: 'Data Center', use_type: 'Data center',
                       registry_id: 'x' });
const road = pointSite({ title: 'Highway Reconstruction', type_raw: 'Roadway', use_type: 'Roads & infrastructure',
                         registry_id: 'x' });
const comm = pointSite({ title: 'Commercial Building Permit 0 BLVD', type_raw: 'Commercial Building Permit',
                         use_type: 'Commercial', registry_id: 'fort-worth-development-permits' });
const commApt = pointSite({ title: 'Middle Fiskville Senior Apartments', type_raw: 'Commercial Multi Family',
                            use_type: 'Commercial', registry_id: 'austin-site-plan-cases' });
ok(kept([dc, road, comm]) === 3, '7a: Data center / Roads / Commercial records are untouched');
ok(kept([commApt]) === 1,
  '7b: a Commercial record carrying apartment wording is NOT rewritten by this workstream');
ok(typeOf(commApt) === 'commercial', '7c: ...and it keeps its Commercial identity');
// A rejected Residential record is DROPPED, never relabelled. The classifier alone would still
// call it residential — that is the control proving the gate is what removes it.
ok(typeOf(opDeck) === 'residential' && HS.residentialQualifySites([opDeck]).length === 0,
  '7d: a rejected Residential record is removed, never retyped to Development or other');

// ── 8. THE PAGE ACTUALLY CALLS IT ───────────────────────────────────────────────────────────
const page = fs.readFileSync(new URL('../homesignalmap.html', import.meta.url), 'utf8');
const calls = page.match(/HS\.residentialQualifySites\(/g) || [];
ok(calls.length === 2, '8a: homesignalmap.html routes BOTH funnels through the gate (render + property) — found ' + calls.length);
ok(/window\.__HS_SITES = sites;/.test(page) && page.indexOf('HS.residentialQualifySites(sites)') < page.indexOf('window.__HS_SITES = sites;'),
  '8b: the gate runs BEFORE __HS_SITES is exposed, so rails/counts/markers read the qualified set');

console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURE(S)`);
process.exit(fails === 0 ? 0 : 1);
