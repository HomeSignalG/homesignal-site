// dc-geocode-probe.ts — ZERO-WRITE probe: every current Epoch data-centre address, plus an Atlas
// calibration set, through HomeSignal's PRODUCTION geocoding ladder.
//
// WHAT IT REUSES (nothing is re-implemented):
//   canonicalAddr     supabase/functions/get-address-report/canonical-addr.ts (the ONE normalizer)
//   productionLadder  geocode-cache.ts (OpenAddresses dataset rung -> Census range interpolation)
//   resolveGeocode    geocode-cache.ts (the same ladder walk the report engine performs)
//
// WHY IT WRITES NOTHING: resolveGeocode is handed a store whose put() is a no-op and is called with
// forceRefresh, so the ladder runs fresh (we want the provider's answer AND its diagnostics, which a
// cache hit does not carry) and the result is printed, never persisted. public.geocodes is read
// only to report whether a cached answer already exists and whether it agrees.
//
// INPUT  PROBE_INPUT  = JSON lines {kind, oid, name, query} written by the workflow's read-only psql.
// OUTPUT PROBE_OUTPUT = JSON lines, one per input, consumed by docs/dc-geocode-probe-analysis.sql.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { canonicalAddr } from "../supabase/functions/get-address-report/canonical-addr.ts";
import {
  type GeocodeResult,
  type GeocodeStore,
  productionLadder,
  resolveGeocode,
} from "../supabase/functions/get-address-report/geocode-cache.ts";

const url = Deno.env.get("SUPABASE_URL");
const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const inPath = Deno.env.get("PROBE_INPUT");
const outPath = Deno.env.get("PROBE_OUTPUT");
if (!url || !key || !inPath || !outPath) {
  console.error("REFUSED: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, PROBE_INPUT and PROBE_OUTPUT are all required");
  Deno.exit(2);
}
const supabase = createClient(url, key, { auth: { persistSession: false } });

// Read-only store: get() reports the cached row; put() writes NOTHING.
const readOnly: GeocodeStore = {
  get: async (c) => {
    const { data } = await supabase.from("geocodes")
      .select("canonical_addr,input_address,lat,lng,match_type,matched_address,geocode_source,needs_review,review_reason")
      .eq("canonical_addr", c).maybeSingle();
    return (data as GeocodeResult) ?? null;
  },
  put: async () => {},
};

const inputs = (await Deno.readTextFile(inPath)).split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
const ladder = productionLadder(supabase, fetch);
const out: string[] = [];
let n = 0;
for (const r of inputs) {
  const query = String(r.query ?? "").trim();
  const canonical = canonicalAddr(query);
  const cached = query ? await readOnly.get(canonical) : null;
  const fresh = query
    ? await resolveGeocode(readOnly, query, canonical, ladder, { forceRefresh: true })
    : null;
  out.push(JSON.stringify({
    kind: r.kind, oid: r.oid, name: r.name, query, canonical_addr: canonical,
    provider: fresh?.geocode_source ?? null, match_type: fresh?.match_type ?? "not_attempted",
    lat: fresh?.lat ?? null, lng: fresh?.lng ?? null, matched_address: fresh?.matched_address ?? null,
    provider_candidates: fresh?.diag?.provider_candidates ?? null,
    provider_matched_addresses: fresh?.diag?.provider_matched_addresses ?? null,
    cached_match_type: cached?.match_type ?? null, cached_lat: cached?.lat ?? null, cached_lng: cached?.lng ?? null,
  }));
  n++;
  if (n % 25 === 0) console.log(`probe: ${n}/${inputs.length}`);
  await new Promise((res) => setTimeout(res, 300)); // polite pacing for the public Census endpoint
}
await Deno.writeTextFile(outPath, out.join("\n") + "\n");
console.log(`probe: ${n} addresses resolved through the production ladder; 0 rows written`);
