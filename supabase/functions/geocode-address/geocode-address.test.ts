// Offline unit tests for the resident add-your-home Census proxy.
// Run: node --experimental-strip-types geocode-address.test.ts
import { pickCensusMatch } from "./census-match.ts";
import { pickCensusMatch as pickFromLadder } from "../get-address-report/geocode-cache.ts";
import { CENSUS_ONELINE, CENSUS_TIMEOUT_MS, handleGeocodeAddress, placeOf } from "./logic.ts";

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`PASS ${name}`); }
  else { fail++; console.log(`FAIL ${name}\n     got  ${g}\n     want ${w}`); }
}
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`PASS ${name}`); }
  else { fail++; console.log(`FAIL ${name}${detail ? `\n     ${detail}` : ""}`); }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

eq("pick.zip_prefers_filed",
  pickCensusMatch([
    { matchedAddress: "3250 S LOCUST GROVE RD, KUNA, ID, 83642" },
    { matchedAddress: "3250 S LOCUST GROVE RD, KUNA, ID, 83634" },
  ], "3250 S Locust Grove Rd, Kuna, ID 83634")?.matchedAddress,
  "3250 S LOCUST GROVE RD, KUNA, ID, 83634");
eq("pick.no_zip_keeps_first",
  pickCensusMatch([
    { matchedAddress: "3400 W 500 N, IN, 46001" },
    { matchedAddress: "3400 W 500 N, IN, 46002" },
  ], "3400 W 500 N, IN")?.matchedAddress,
  "3400 W 500 N, IN, 46001");
{
  const matches = [
    { matchedAddress: "3250 S LOCUST GROVE RD, KUNA, ID, 83642" },
    { matchedAddress: "3250 S LOCUST GROVE RD, KUNA, ID, 83634" },
  ];
  const input = "3250 S Locust Grove Rd, Kuna, ID 83634";
  eq("pick.parity_with_ladder", pickCensusMatch(matches, input)?.matchedAddress,
    pickFromLadder(matches, input)?.matchedAddress);
}

{
  const tooShort = await handleGeocodeAddress("1 Main", async () => { throw new Error("must not fetch"); });
  eq("logic.short_is_null", tooShort, { body: { match: null }, status: 200 });
}
{
  const r = await handleGeocodeAddress("1 MAIN ST, COLUMBUS, OH 43215", async () => jsonResponse({ result: { addressMatches: [] } }));
  eq("logic.200_empty_is_null", r, { body: { match: null }, status: 200 });
}
{
  const r = await handleGeocodeAddress("1 MAIN ST, COLUMBUS, OH 43215", async () => jsonResponse({ error: "unavailable" }, 503));
  eq("logic.503_is_unavailable", r, { body: { error: "geocoder_unavailable" }, status: 502 });
}
{
  const r = await handleGeocodeAddress("1 MAIN ST, COLUMBUS, OH 43215", async () => { throw new Error("TimeoutError"); });
  eq("logic.timeout_is_unavailable", r, { body: { error: "geocoder_unavailable" }, status: 502 });
}
{
  const r = await handleGeocodeAddress("1 MAIN ST, COLUMBUS, OH 43215", async () => new Response("not-json", { status: 200 }));
  eq("logic.non_json_is_unavailable", r, { body: { error: "geocoder_unavailable" }, status: 502 });
}
{
  let sawTimeout = false;
  const r = await handleGeocodeAddress("3250 S Locust Grove Rd, Kuna, ID 83634", async (_u, init) => {
    sawTimeout = !!(init && "signal" in init && init.signal);
    return jsonResponse({
      result: {
        addressMatches: [
          {
            matchedAddress: "3250 S LOCUST GROVE RD, KUNA, ID, 83642",
            coordinates: { x: -116.4, y: 43.5 },
            addressComponents: { zip: "83642", city: "KUNA", state: "ID" },
          },
          {
            matchedAddress: "3250 S LOCUST GROVE RD, KUNA, ID, 83634",
            coordinates: { x: -116.5, y: 43.4 },
            addressComponents: { zip: "83634", city: "KUNA", state: "ID" },
          },
        ],
      },
    });
  });
  ok("logic.passes_abort_signal", sawTimeout);
  eq("logic.prefers_filed_zip", r.status, 200);
  eq("logic.prefers_filed_zip_lat", (r.body.match as { lat?: number } | null)?.lat, 43.4);
  eq("logic.prefers_filed_zip_zip", (r.body.match as { zip?: string } | null)?.zip, "83634");
}

// The incorporated place, from the shapes Census actually returned (2026-10-18, pg_net).
eq("place.inside_city", placeOf({ "Incorporated Places": [{ GEOID: "5373465", BASENAME: "University Place", FUNCSTAT: "A" }] }),
  { place: { geoid: "5373465", name: "University Place" }, placeChecked: true });
eq("place.unincorporated_is_checked_null", placeOf({}), { place: null, placeChecked: true });
eq("place.no_block_is_unchecked", placeOf(undefined), { place: null, placeChecked: false });
eq("place.inactive_govt_is_not_a_city", placeOf({ "Incorporated Places": [{ GEOID: "5300000", BASENAME: "X", FUNCSTAT: "F" }] }),
  { place: null, placeChecked: true });
eq("place.bad_geoid_ignored", placeOf({ "Incorporated Places": [{ GEOID: "53", BASENAME: "X", FUNCSTAT: "A" }] }),
  { place: null, placeChecked: true });
ok("url.geographies_endpoint", CENSUS_ONELINE.endsWith("/geocoder/geographies/onelineaddress"));
{
  let url = "";
  const r = await handleGeocodeAddress("3628 Bridgeport Way W, University Place, WA 98466", async (u) => {
    url = String(u);
    return jsonResponse({ result: { addressMatches: [{
      matchedAddress: "3628 BRIDGEPORT WAY W, UNIVERSITY PLACE, WA, 98466",
      coordinates: { x: -122.537122645839, y: 47.225537544502 },
      addressComponents: { zip: "98466", city: "UNIVERSITY PLACE", state: "WA" },
      geographies: { "Incorporated Places": [{ GEOID: "5373465", BASENAME: "University Place", FUNCSTAT: "A" }] },
    }] } });
  });
  ok("url.asks_incorporated_places", url.includes("layers=Incorporated%20Places") && url.includes("vintage=Current_Current"), url);
  eq("logic.returns_place", (r.body.match as { place?: unknown } | null)?.place, { geoid: "5373465", name: "University Place" });
  eq("logic.place_checked", (r.body.match as { placeChecked?: unknown } | null)?.placeChecked, true);
}

eq("logic.timeout_ms", CENSUS_TIMEOUT_MS, 15000);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) (globalThis as { process?: { exit(n: number): void } }).process?.exit(1);
