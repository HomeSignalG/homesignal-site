// THE LAUNCH / MANUAL TEST LOCATION: Brigham City, Utah 84302 (founder, 2026-10-04: "use Brigham City, Utah 84302 everywhere the launch/manual test
// location is needed. Do not use Bingham Canyon or ZIP 84006").
//
// ONE definition, imported by every launch-path test (the launch gate, the trial round trip, the customer page in Chromium, the Brigham City journey
// test) and quoted by the manual test instructions, so the location cannot drift between them. `test/launch-location-structure.test.mjs` pins it.
//
// WHAT THIS IS AND IS NOT. It is a PLACE to type into the report, so the whole journey (address -> ZIP -> coverage -> report) is exercised somewhere real.
// It is NOT a data source and NOT a clearance: the ZIP being covered says where a report can be asked for, never that any publisher's records may be shown
// to a paying customer (that is supabase/functions/_shared/report-rights.json, which clears nothing today; build step 12). The street address and the
// point below are FIXTURE VALUES copied from test/national-report.test.mjs, where they stand in for what the geocoder returns; whether the live geocoder
// resolves this exact address is checked by a person in the manual test (docs/development-activity-manual-test-brigham-city-84302.md), not here.
export const LAUNCH_TEST_LOCATION = Object.freeze({
  label: 'Brigham City, UT 84302',
  city: 'Brigham City',
  state: 'UT',
  zip: '84302',
  county: 'Box Elder',
  address: '20 N Main St, Brigham City, UT 84302',
  matched: '20 N MAIN ST, BRIGHAM CITY, UT, 84302',
  lat: 41.51090028281,
  lng: -112.015646109683,
});

/** A second, different property in the same place (for "another property" cases). */
export const OTHER_PROPERTY = '22 N Main St, Brigham City, UT 84302';

/** The nth distinct street address in the test location (a report needs a different address each time). Numbers stay small and plain on purpose. */
export const addressNo = (i) => (100 + Number(i)) + ' N Main St, Brigham City, UT 84302';

/** What the geocoder stand-in answers for any address typed in the test location (the real one is the geocode-address function). */
export const geocodeStandIn = (typed) => ({
  matchedAddress: String(typed).toUpperCase().replace(/,\s*UT\s+84302$/, ', UT, 84302'),
  lat: LAUNCH_TEST_LOCATION.lat,
  lng: LAUNCH_TEST_LOCATION.lng,
  zip: LAUNCH_TEST_LOCATION.zip,
});
