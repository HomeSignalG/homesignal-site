// Offline unit tests for resolveGeocode + censusRung (no network, no DB).
// Pins the health-plan rules: a Census transport error is not a cached miss;
// a completed HTTP 200 with zero matches is a persisted census_no_match.
//
// Run under Deno (CI) OR Node 22: `node --experimental-strip-types geocode-cache.test.ts`.
import {
  censusRung,
  GeocodeTransportError,
  resolveGeocode,
  REVIEW_REASON_NO_MATCH,
  REVIEW_REASON_TRANSPORT,
  type GeocodeResult,
  type GeocodeStore,
  type GeocoderRung,
} from "./geocode-cache.ts";

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

function memStore(seed?: GeocodeResult): GeocodeStore & { rows: Map<string, GeocodeResult>; puts: number } {
  const rows = new Map<string, GeocodeResult>();
  if (seed) rows.set(seed.canonical_addr, seed);
  const store = {
    rows,
    puts: 0,
    get: async (k: string) => rows.get(k) ?? null,
    put: async (row: GeocodeResult) => { store.puts++; rows.set(row.canonical_addr, row); },
  };
  return store;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
function matches(...addrs: { addr: string; lat: number; lng: number }[]) {
  return {
    result: {
      addressMatches: addrs.map((a) => ({
        matchedAddress: a.addr,
        coordinates: { x: a.lng, y: a.lat },
      })),
    },
  };
}

const missRung = (source: string): GeocoderRung => ({
  source,
  resolve: async () => null,
});

// ── censusRung: transport vs no-match ────────────────────────────────────────
{
  const rung = censusRung(async () => jsonResponse({ result: { addressMatches: [] } }));
  eq("census.200_empty_is_null", await rung.resolve("1 MAIN ST", "1 MAIN ST"), null);
}
{
  const rung = censusRung(async () => jsonResponse(matches({ addr: "1 MAIN ST, COLUMBUS, OH, 43215", lat: 40, lng: -83 })));
  const hit = await rung.resolve("1 MAIN ST", "1 MAIN ST");
  eq("census.200_hit_lat", hit?.lat, 40);
  eq("census.200_hit_source_type", hit?.match_type, "range_interpolated");
}
{
  const rung = censusRung(async () => jsonResponse({ error: "unavailable" }, 503));
  let threw: unknown = null;
  try { await rung.resolve("1 MAIN ST", "1 MAIN ST"); }
  catch (e) { threw = e; }
  ok("census.503_throws_transport", threw instanceof GeocodeTransportError, String(threw));
  eq("census.503_status", (threw as GeocodeTransportError).status, 503);
}
{
  const rung = censusRung(async () => { throw new Error("TimeoutError"); });
  // fetch impl threw a plain Error — censusRung wraps it
  let threw: unknown = null;
  try { await rung.resolve("1 MAIN ST", "1 MAIN ST"); }
  catch (e) { threw = e; }
  ok("census.fetch_throw_is_transport", threw instanceof GeocodeTransportError, String(threw));
}
{
  const rung = censusRung(async () => new Response("not-json", { status: 200 }));
  let threw: unknown = null;
  try { await rung.resolve("1 MAIN ST", "1 MAIN ST"); }
  catch (e) { threw = e; }
  ok("census.non_json_is_transport", threw instanceof GeocodeTransportError, String(threw));
}

// ── resolveGeocode: do not cache transport; do cache genuine no-match ────────
{
  const store = memStore();
  const census: GeocoderRung = {
    source: "census_onelineaddress",
    resolve: async () => { throw new GeocodeTransportError("census HTTP 503", 503); },
  };
  const r = await resolveGeocode(store, "1 MAIN ST", "1 MAIN ST", [missRung("openaddresses"), census]);
  eq("resolve.transport_match_type", r.match_type, "failed");
  eq("resolve.transport_reason", r.review_reason, REVIEW_REASON_TRANSPORT);
  eq("resolve.transport_not_persisted", store.puts, 0);
  eq("resolve.transport_not_in_store", await store.get("1 MAIN ST"), null);
}
{
  const store = memStore();
  const census: GeocoderRung = { source: "census_onelineaddress", resolve: async () => null };
  const r = await resolveGeocode(store, "1 MAIN ST", "1 MAIN ST", [missRung("openaddresses"), census]);
  eq("resolve.nomatch_reason", r.review_reason, REVIEW_REASON_NO_MATCH);
  eq("resolve.nomatch_persisted", store.puts, 1);
  eq("resolve.nomatch_stored_type", store.rows.get("1 MAIN ST")?.match_type, "failed");
}
{
  const store = memStore();
  let calls = 0;
  const census: GeocoderRung = {
    source: "census_onelineaddress",
    resolve: async () => {
      calls++;
      throw new GeocodeTransportError("timeout");
    },
  };
  await resolveGeocode(store, "1 MAIN ST", "1 MAIN ST", [census]);
  await resolveGeocode(store, "1 MAIN ST", "1 MAIN ST", [census]);
  eq("resolve.transport_retries_next_call", calls, 2);
}
{
  const cached: GeocodeResult = {
    canonical_addr: "1 MAIN ST",
    input_address: "1 MAIN ST",
    lat: null,
    lng: null,
    match_type: "failed",
    matched_address: null,
    geocode_source: "none",
    needs_review: true,
    review_reason: REVIEW_REASON_NO_MATCH,
  };
  const store = memStore(cached);
  let calls = 0;
  const census: GeocoderRung = { source: "census_onelineaddress", resolve: async () => { calls++; return null; } };
  const r = await resolveGeocode(store, "1 MAIN ST", "1 MAIN ST", [census]);
  eq("resolve.cached_failed_still_returned", r.match_type, "failed");
  eq("resolve.cached_failed_no_rung_yet", calls, 0);
}
{
  const store = memStore();
  const census: GeocoderRung = {
    source: "census_onelineaddress",
    resolve: async () => ({
      lat: 40.1, lng: -83.1, match_type: "range_interpolated", matched_address: "1 MAIN ST, OH",
    }),
  };
  const r = await resolveGeocode(store, "1 MAIN ST", "1 MAIN ST", [missRung("openaddresses"), census]);
  eq("resolve.hit_source", r.geocode_source, "census_onelineaddress");
  eq("resolve.hit_persisted", store.puts, 1);
  eq("resolve.hit_lat", r.lat, 40.1);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) (globalThis as { process?: { exit(n: number): void } }).process?.exit(1);
