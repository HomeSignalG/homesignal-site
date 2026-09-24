// dc-geocode-observations.ts — DERIVES location evidence for the source addresses the database
// queues, through HomeSignal's ONE production geocoding ladder. It decides nothing.
//
// WHAT IT REUSES (nothing is re-implemented, and nothing here is data-centre specific):
//   canonicalAddr     supabase/functions/get-address-report/canonical-addr.ts (the ONE normalizer)
//   productionLadder  geocode-cache.ts (OpenAddresses dataset rung -> Census range interpolation)
//   resolveGeocode    geocode-cache.ts (the same ladder walk the report engine performs)
//   supabaseStore     geocode-cache.ts: the public.geocodes cache, written ONLY through
//                     upsert_geocode_if_better (upgrade-only), exactly as the report engine does
//
// WHAT IT DOES NOT DO:
//   * choose what to geocode -- the queue is decided in SQL and handed in as JSON lines;
//   * judge the answer -- whether a derived point may become a site is decided in SQL
//     (dc_derived_point_verdict), never here;
//   * write any data-centre table -- it prints JSON lines; the workflow loads them through
//     docs/dc-geocode-observations-load.sql, which accepts only queued queries and only the
//     current ladder version, append-only.
//
// forceRefresh: the ladder runs fresh because the SQL verdict needs the provider's own
// diagnostics (how many candidates it matched), which a cache hit does not carry. The cache
// write that follows is the report engine's own upgrade-only write, so a re-run can never
// downgrade a stored point.
//
// INPUT  DCG_INPUT  = JSON lines {geocoder_query, ladder_version} (docs/dc-geocode-observations-queue.sql)
// OUTPUT DCG_OUTPUT = JSON lines, one per input, for docs/dc-geocode-observations-load.sql
// RUN_REF           = the workflow run that derived them (provenance on every row)

import { createClient } from "jsr:@supabase/supabase-js@2";
import { canonicalAddr } from "../supabase/functions/get-address-report/canonical-addr.ts";
import {
  productionLadder,
  resolveGeocode,
  supabaseStore,
} from "../supabase/functions/get-address-report/geocode-cache.ts";

const url = Deno.env.get("SUPABASE_URL");
const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const inPath = Deno.env.get("DCG_INPUT");
const outPath = Deno.env.get("DCG_OUTPUT");
const runRef = Deno.env.get("RUN_REF");
if (!url || !key || !inPath || !outPath || !runRef) {
  console.error("REFUSED: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DCG_INPUT, DCG_OUTPUT and RUN_REF are all required");
  Deno.exit(2);
}
const supabase = createClient(url, key, { auth: { persistSession: false } });
const store = supabaseStore(supabase);
const ladder = productionLadder(supabase, fetch);

const inputs = (await Deno.readTextFile(inPath)).split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
const out: string[] = [];
const byType: Record<string, number> = {};
for (const r of inputs) {
  const query = String(r.geocoder_query ?? "").trim();
  if (!query || !r.ladder_version) {
    console.error(`REFUSED: malformed queue row ${JSON.stringify(r)}`);
    Deno.exit(1);
  }
  const canonical = canonicalAddr(query);
  const g = await resolveGeocode(store, query, canonical, ladder, { forceRefresh: true });
  byType[g.match_type] = (byType[g.match_type] ?? 0) + 1;
  out.push(JSON.stringify({
    geocoder_query: query,
    canonical_addr: canonical,
    ladder_version: r.ladder_version,
    provider: g.geocode_source ?? "none",
    match_type: g.match_type,
    lat: g.lat ?? null,
    lng: g.lng ?? null,
    matched_address: g.matched_address ?? null,
    // null = the rung reported no count; the SQL verdict treats that as NOT exactly one (fails closed)
    provider_candidates: g.diag?.provider_candidates ?? null,
    provider_matched_addresses: g.diag?.provider_matched_addresses ?? [],
    run_ref: runRef,
  }));
  await new Promise((res) => setTimeout(res, 300)); // polite pacing for the public Census endpoint
}
await Deno.writeTextFile(outPath, out.length ? out.join("\n") + "\n" : "");
console.log(`derived ${out.length} of ${inputs.length} queued address(es) through the production ladder: ${JSON.stringify(byType)}`);
if (out.length !== inputs.length) Deno.exit(1);
