// Offline unit tests for buildGeocodeInput (no network, no DB). Pins the measured
// connector behaviors (2026-07-22 investigation): complete-address assembly, Clark
// embedded-ZIP fence fix, Pierce no-city, unit stripping, already-complete passthrough.
//
// Run under Deno (CI) OR Node 22: `node --experimental-strip-types geo-input.test.ts`.
import { buildGeocodeInput, cityFromJurisdiction } from "./geo-input.ts";

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`PASS ${name}`); }
  else { fail++; console.log(`FAIL ${name}\n     got  ${g}\n     want ${w}`); }
}

// Columbus (arcgis, bare + zip col) — the dominant case.
eq("columbus.basic",
  buildGeocodeInput({ rawAddress: "6013 WINSTEAD RD", jurisdiction: "City of Columbus", state: "OH", zipColValue: "43235", reportZip: "43235" }),
  { input: "6013 WINSTEAD RD, Columbus, OH 43235", filedZip: "43235" });

// Columbus with a unit → unit stripped before assembly.
eq("columbus.unit_stripped",
  buildGeocodeInput({ rawAddress: "6013 WINSTEAD RD APT 3", jurisdiction: "City of Columbus", state: "OH", zipColValue: "43235", reportZip: "43235" }),
  { input: "6013 WINSTEAD RD, Columbus, OH 43235", filedZip: "43235" });

// Cincinnati (socrata, bare + zip col).
eq("cincinnati.basic",
  buildGeocodeInput({ rawAddress: "1400 ELM ST", jurisdiction: "City of Cincinnati", state: "OH", zipColValue: "45202", reportZip: "45202" }),
  { input: "1400 ELM ST, Cincinnati, OH 45202", filedZip: "45202" });

// Bellevue (arcgis, bare + zip col).
eq("bellevue.basic",
  buildGeocodeInput({ rawAddress: "15419 SE 8th St", jurisdiction: "City of Bellevue", state: "WA", zipColValue: "98007", reportZip: "98007" }),
  { input: "15419 SE 8th St, Bellevue, WA 98007", filedZip: "98007" });

// Fort Worth (arcgis, bare place-name jurisdiction + zip col).
eq("fortworth.basic",
  buildGeocodeInput({ rawAddress: "817 FOREST HEIGHTS DR", jurisdiction: "Fort Worth", state: "TX", zipColValue: "76036", reportZip: "76036" }),
  { input: "817 FOREST HEIGHTS DR, Fort Worth, TX 76036", filedZip: "76036" });

// Pierce County — NO city guessed (county jurisdiction), no zip column → reportZip.
// Measured: city-less "…, WA 98444" matched 98444 in-fence; a guessed city → wrong ZIP.
eq("pierce.no_city",
  buildGeocodeInput({ rawAddress: "1128 104TH ST E", jurisdiction: "Pierce County (PALS)", state: "WA", zipColValue: null, reportZip: "98444" }),
  { input: "1128 104TH ST E, WA 98444", filedZip: "98444" });

// Clark County — address ALREADY complete → passthrough; filedZip is the address's OWN
// ZIP (98661), NOT the report ZIP (98664). This is the verified fence/filed-ZIP fix.
eq("clark.embedded_zip_passthrough",
  buildGeocodeInput({ rawAddress: "4510 NE 62ND AVE, VANCOUVER, WA 98661", jurisdiction: "Clark County", state: "WA", zipColValue: null, reportZip: "98664" }),
  { input: "4510 NE 62ND AVE, VANCOUVER, WA 98661", filedZip: "98661" });

// cityFromJurisdiction rules.
eq("city.city_of", cityFromJurisdiction("City of Columbus"), "Columbus");
eq("city.bare_place", cityFromJurisdiction("Fort Worth"), "Fort Worth");
eq("city.county_null", cityFromJurisdiction("Pierce County (PALS)"), null);
eq("city.county_plain_null", cityFromJurisdiction("Clark County"), null);
eq("city.empty_null", cityFromJurisdiction(""), null);
eq("city.strip_trailing_state", cityFromJurisdiction("City of Worcester, Massachusetts"), "Worcester");
eq("city.strip_kansas_city_state", cityFromJurisdiction("City of Kansas City, Missouri"), "Kansas City");
eq("city.metro", cityFromJurisdiction("Louisville Metro, Kentucky"), "Louisville");

// Graceful degradation: missing state + missing zip → just street (+ city).
eq("missing.state_and_zip",
  buildGeocodeInput({ rawAddress: "100 MAIN ST", jurisdiction: "City of Nowhere", state: null, zipColValue: null, reportZip: null }),
  { input: "100 MAIN ST, Nowhere", filedZip: null });

// Do not duplicate a city already present in the street text.
eq("no_duplicate_city",
  buildGeocodeInput({ rawAddress: "100 MAIN ST COLUMBUS", jurisdiction: "City of Columbus", state: "OH", zipColValue: "43215", reportZip: "43215" }),
  { input: "100 MAIN ST COLUMBUS, OH 43215", filedZip: "43215" });

// Do not duplicate a ZIP already embedded (Pierce 48% carry an inline ZIP).
eq("no_duplicate_zip",
  buildGeocodeInput({ rawAddress: "1128 104TH ST E 98444", jurisdiction: "Pierce County", state: "WA", zipColValue: null, reportZip: "98444" }),
  { input: "1128 104TH ST E 98444, WA", filedZip: "98444" });

// Audit high-impact city ledgers: bare street + zip becomes a complete one-liner.
eq("hartford.assemble",
  buildGeocodeInput({ rawAddress: "123 MAIN ST", jurisdiction: "City of Hartford", state: "CT", zipColValue: "06103", reportZip: "06103" }),
  { input: "123 MAIN ST, Hartford, CT 06103", filedZip: "06103" });
eq("anaheim.assemble",
  buildGeocodeInput({ rawAddress: "100 S HARBOR BLVD", jurisdiction: "City of Anaheim", state: "CA", zipColValue: null, reportZip: "92805" }),
  { input: "100 S HARBOR BLVD, Anaheim, CA 92805", filedZip: "92805" });
eq("austin.assemble",
  buildGeocodeInput({ rawAddress: "1000 E 11TH ST", jurisdiction: "City of Austin", state: "TX", zipColValue: "78702", reportZip: "78702" }),
  { input: "1000 E 11TH ST, Austin, TX 78702", filedZip: "78702" });
eq("worcester.city_stripped",
  buildGeocodeInput({ rawAddress: "202 MAY ST", jurisdiction: "City of Worcester, Massachusetts", state: "MA", zipColValue: null, reportZip: "01602" }),
  { input: "202 MAY ST, Worcester, MA 01602", filedZip: "01602" });

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) (globalThis as { process?: { exit(n: number): void } }).process?.exit(1);
