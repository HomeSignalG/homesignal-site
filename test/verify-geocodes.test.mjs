// Offline, deterministic tests for scripts/verify-geocodes.mjs (no network, no DB).
// Proves the 2026-07-23 correction: a development is judged against its OWN address ZIP,
// not the ZIP page it renders on (spatial_zip_radius_mi neighbouring-page display), while
// still failing coordinates proven wrong for the record's own address.
import { classifyPoint, collectPoints, zipOf, stateOf, normCounty } from '../scripts/verify-geocodes.mjs';

let passN = 0, failN = 0;
function ok(name, cond, detail) {
  if (cond) { passN++; console.log(`PASS ${name}`); }
  else { failN++; console.log(`FAIL ${name}${detail ? '\n     ' + detail : ''}`); }
}
function verdict(name, p, reverse, wantVerdict, wantCategory) {
  const r = classifyPoint(p, reverse);
  const good = r.verdict === wantVerdict && (wantCategory == null || r.category === wantCategory);
  ok(name, good, `got verdict=${r.verdict} category=${r.category} — want ${wantVerdict}${wantCategory ? '/' + wantCategory : ''}  (${r.reason})`);
  return r;
}

// helpers
ok('helper.zipOf', zipOf('37915 NE AMBOY RD, YACOLT, WA 98675') === '98675');
ok('helper.zipOf.none', zipOf('5662 WEXLER RD') === null);
ok('helper.stateOf', stateOf('…, YACOLT, WA, 98675') === 'WA');
ok('helper.stateOf.noComma', stateOf('2200 CALDWELL LN, DEL VALLE, TX 78617') === 'TX');
ok('helper.normCounty', normCounty('Franklin County') === normCounty('franklin'));

// 1. A correct radius-scoped development shown on a neighbouring ZIP page PASSES.
verdict('1.radius_neighbor_page_passes',
  { id: 'clark:1', src: 'clark-county-active-dev-permits', label: 'Amboy dev', page_zip: '98601',
    address: '37915 NE AMBOY RD, YACOLT, WA 98675', matched_address: '37915 NE AMBOY RD, YACOLT, WA, 98675',
    statedCounty: '', match_type: 'range_interpolated', lat: 45.86, lng: -122.4, isRadiusScoped: true },
  { zcta: '98675', county: 'Clark', state: 'WA' }, 'pass', 'own_zip_neighbor_page');

// 2. The same scenario works WITHOUT any hard-coded source name — the decision is semantic
//    (point sits in its own ZIP), and passes even with the radius flag off.
verdict('2.generalizes_unknown_source_flag_off',
  { id: 'x:1', src: 'some-brand-new-connector', label: 'generic dev', page_zip: '30301',
    address: '1 MAIN ST, ATLANTA, GA 30302', matched_address: '1 MAIN ST, ATLANTA, GA, 30302',
    statedCounty: '', match_type: 'range_interpolated', lat: 33.75, lng: -84.39, isRadiusScoped: false },
  { zcta: '30302', county: 'Fulton', state: 'GA' }, 'pass', 'own_zip_neighbor_page');

// 3. matched ZIP disagrees with the record's own address ZIP → FAIL.
verdict('3.matched_zip_disagrees_own_address',
  { id: 'x:2', src: 'somesrc', label: 'mismatch', page_zip: '75201',
    address: '100 OAK ST, DALLAS, TX 75201', matched_address: '100 OAK ST, FORT WORTH, TX, 76102',
    statedCounty: '', match_type: 'range_interpolated', lat: 32.75, lng: -97.33, isRadiusScoped: false },
  { zcta: '76102', county: 'Tarrant', state: 'TX' }, 'fail', 'matched_zip_disagrees_own_address');

// 4. Wrong-STATE coordinate → FAIL (the classic Fort-Worth-rendered-in-Michigan class).
verdict('4.wrong_state',
  { id: 'x:3', src: 'somesrc', label: 'fw permit', page_zip: '76102',
    address: '100 MAIN ST, FORT WORTH, TX 76102', matched_address: '100 MAIN ST, FORT WORTH, TX, 76102',
    statedCounty: '', match_type: 'range_interpolated', lat: 42.29, lng: -85.58, isRadiusScoped: false },
  { zcta: '49001', county: 'Kalamazoo', state: 'MI' }, 'fail', 'wrong_state');

// 5. Proven wrong-COUNTY coordinate (county evidence present) → FAIL.
verdict('5.wrong_county',
  { id: 'caldwell:1', src: 'property_reports', label: '2200 CALDWELL LN', page_zip: '78617',
    address: '2200 CALDWELL LN, DEL VALLE, TX 78617', matched_address: '2200 CALDWELL LN, DEL VALLE, TX 78617',
    statedCounty: 'Travis', match_type: 'range_interpolated', lat: 30.1, lng: -97.5, isRadiusScoped: false },
  { zcta: '78612', county: 'Bastrop', state: 'TX' }, 'fail', 'wrong_county');

// 6. An ordinary NON-radius record whose point sits outside its own ZIP with no USPS-vs-ZCTA
//    explanation (here: a different state) → FAIL — non-radius sources are not exempted.
verdict('6.non_radius_outside_own_zip',
  { id: 'x:6', src: 'columbus-building-permits', label: 'columbus permit', page_zip: '43016',
    address: '5662 WEXLER RD', matched_address: '5662 WEXLER RD, DUBLIN, OH, 43016',
    statedCounty: '', match_type: 'range_interpolated', lat: 39.95, lng: -75.16, isRadiusScoped: false },
  { zcta: '19104', county: 'Philadelphia', state: 'PA' }, 'fail', 'wrong_state');

// 7. USPS ZIP vs Census ZCTA (same state, forward geocoder agrees on the record's ZIP) → BORDERLINE.
verdict('7.usps_vs_zcta_borderline',
  { id: 'x:7', src: 'columbus-building-permits', label: 'reynoldsburg permit', page_zip: '43068',
    address: '2025 BRICE RD', matched_address: '2025 BRICE RD, REYNOLDSBURG, OH, 43068',
    statedCounty: '', match_type: 'range_interpolated', lat: 39.95, lng: -82.8, isRadiusScoped: false },
  { zcta: '43232', county: 'Franklin', state: 'OH' }, 'borderline', 'usps_vs_zcta');

// 8. Reverse-lookup unavailable → SKIP (never a false fail), and it carries fields for logging.
{
  const r = classifyPoint(
    { id: 'x:8', src: 'clark-county-active-dev-permits', label: 'skip me', page_zip: '98601',
      address: '1 A ST, YACOLT, WA 98675', matched_address: '1 A ST, YACOLT, WA, 98675',
      statedCounty: '', match_type: 'range_interpolated', lat: 45.86, lng: -122.4, isRadiusScoped: true },
    null);
  ok('8.reverse_unavailable_skips', r.verdict === 'skip' && r.category === 'reverse_unavailable'
    && r.page_zip === '98601' && r.own_zip === '98675' && r.lat === 45.86, `got ${JSON.stringify(r)}`);
}

// 9. The exact prior Clark AND Pierce failure mechanism is now covered (both PASS).
verdict('9a.clark_mechanism_now_passes',
  { id: 'clark:9', src: 'clark-county-active-dev-permits', label: 'vancouver dev', page_zip: '98660',
    address: '7010 NE SAINT JOHNS RD, VANCOUVER, WA 98665', matched_address: '7010 NE ST JOHNS RD, VANCOUVER, WA, 98665',
    statedCounty: '', match_type: 'range_interpolated', lat: 45.68, lng: -122.6, isRadiusScoped: true },
  { zcta: '98665', county: 'Clark', state: 'WA' }, 'pass', 'own_zip_neighbor_page');
verdict('9b.pierce_mechanism_now_passes',
  { id: 'pierce:9', src: 'pierce-county-pals-permits', label: 'gig harbor dev', page_zip: '98333',
    address: '6604 CROMWELL BEACH DR NW, Gig Harbor, WA 98335', matched_address: '6604 CROMWELL BEACH DR NW, GIG HARBOR, WA, 98335',
    statedCounty: '', match_type: 'range_interpolated', lat: 47.3, lng: -122.6, isRadiusScoped: true },
  { zcta: '98335', county: 'Pierce', state: 'WA' }, 'pass', 'own_zip_neighbor_page');

// 10. Genuine historic bad-geocode fixtures still FAIL (v20 out-of-state interpolation).
verdict('10a.historic_bad_geocode_wrong_state',
  { id: 'hist:1', src: 'fort-worth-development-permits', label: 'fw permit', page_zip: '76102',
    address: '100 W 7TH ST, FORT WORTH, TX 76102', matched_address: '100 W 7TH ST, FORT WORTH, TX, 76102',
    statedCounty: '', match_type: 'range_interpolated', lat: 34.0, lng: -81.03, isRadiusScoped: false },
  { zcta: '29201', county: 'Richland', state: 'SC' }, 'fail', 'wrong_state');
verdict('10b.historic_bad_geocode_wrong_county',
  { id: 'hist:2', src: 'somesrc', label: 'county-tagged permit', page_zip: '78617',
    address: '9 FAR RD, DEL VALLE, TX 78617', matched_address: '9 FAR RD, DEL VALLE, TX, 78617',
    statedCounty: 'Travis', match_type: 'range_interpolated', lat: 29.4, lng: -98.5, isRadiusScoped: false },
  { zcta: '78201', county: 'Bexar', state: 'TX' }, 'fail', 'wrong_county');

// 11. Facilities retain their existing treatment — EXCLUDED from the geofence (no match_type),
//     while a geocoded development point IS collected. isRadiusScoped derives from the registry set.
{
  const dev = [{ zip: '43016', sites: [
    { label: 'ASHLAND CHEMICAL CO', lat: 40.09, lng: -83.15, src: 'EPA FRS · registry 110004639605', scope: 'point' }, // facility: no match_type
    { label: 'permit', lat: 40.05, lng: -83.17, match_type: 'range_interpolated', address: '5662 WEXLER RD',
      matched_address: '5662 WEXLER RD, DUBLIN, OH, 43016', source_registry_id: 'clark-county-active-dev-permits' },
  ] }];
  const pts = collectPoints(dev, [], new Set(['clark-county-active-dev-permits']));
  ok('11.facilities_excluded_dev_included', pts.length === 1 && pts[0].label === 'permit' && pts[0].isRadiusScoped === true,
    `collected ${pts.length}: ${JSON.stringify(pts.map((p) => [p.label, p.isRadiusScoped]))}`);
}

// 12. No unrelated regression: a normal same-page point in its own ZIP passes; a property point
//     correctly in its own ZIP/county passes.
verdict('12a.normal_same_page_passes',
  { id: 'x:12', src: 'cincinnati-building-permits', label: 'downtown permit', page_zip: '45202',
    address: '1400 ELM ST', matched_address: '1400 ELM ST, CINCINNATI, OH, 45202',
    statedCounty: '', match_type: 'range_interpolated', lat: 39.11, lng: -84.51, isRadiusScoped: false },
  { zcta: '45202', county: 'Hamilton', state: 'OH' }, 'pass', 'own_zip');
verdict('12b.property_point_passes',
  { id: 'caldwell:ok', src: 'property_reports', label: '2200 CALDWELL LN', page_zip: '78617',
    address: '2200 CALDWELL LN, DEL VALLE, TX 78617', matched_address: '2200 CALDWELL LN, DEL VALLE, TX 78617',
    statedCounty: 'Travis', match_type: 'range_interpolated', lat: 30.17, lng: -97.61, isRadiusScoped: false },
  { zcta: '78617', county: 'Travis', state: 'TX' }, 'pass', 'own_zip');

console.log(`\n${passN} passed, ${failN} failed`);
if (failN) process.exit(1);
