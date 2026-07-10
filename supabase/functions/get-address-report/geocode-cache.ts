// geocode-cache.ts — the write-once, quality-aware geocode cache for the dev tracker.
//
// Root problem it fixes: point records (TABS today) were geocoded blind with Census
// range-interpolation and stored as lat/lng only — no quality signal, no automatic
// flagging, no way to tell a good point from a bad one. This module resolves each real
// address ONCE, classifies the match quality, flags anything that isn't precise, and
// persists the lot (docs/geocodes-setup.sql).
//
// Design goals (confirmed with the owner before build):
//  • Write-once, quality-aware: a read-through cache keyed by canonicalAddr(); a miss
//    runs the LADDER and stores the classified result — never "cache whatever
//    interpolation returned" with no label.
//  • Source-agnostic scaffolding: the ladder is an injected, ordered array of rungs
//    (highest precision first). Adding a parcel/rooftop rung later = prepend one rung.
//    resolveGeocode(), the needs_review rule, the table, and the frontend gate are all
//    untouched — no schema or client rework.
//  • Portable to the Python ingest repo later WITHOUT a rewrite: the only runtime
//    couplings are (a) the geocoder transport (a rung) and (b) the DB surface
//    (GeocodeStore = two ops). Re-implement those two in Python against the same table
//    and enum; the classify + flag logic is language-neutral and lives here.

export type MatchType =
  | "rooftop"
  | "parcel"
  | "range_interpolated"
  | "zip_centroid"
  | "county_centroid"
  | "failed";

// Precise = a point we trust to the building/parcel. Drives needs_review AND the
// dormant frontend "approximate" marker style (a point is shown approximate only once
// SOME precise point exists in the set — purely data-driven, no code change needed).
export const PRECISE: ReadonlySet<MatchType> = new Set<MatchType>(["rooftop", "parcel"]);

export interface GeocodeResult {
  canonical_addr: string;
  input_address: string;
  lat: number | null;
  lng: number | null;
  match_type: MatchType;
  matched_address: string | null;
  geocode_source: string;
  needs_review: boolean;
  review_reason: string | null;
}

// One rung of the ladder. resolve() returns a classified point, or null on a miss so
// the next (lower-precision) rung is tried. A rung classifies its OWN match_type —
// only the rung knows whether it produced a rooftop, a parcel centroid, or an
// interpolation.
export interface GeocoderRung {
  source: string;
  resolve: (
    input: string,
  ) => Promise<{ lat: number; lng: number; match_type: MatchType; matched_address: string | null } | null>;
}

// Minimal DB surface so this module ports cleanly (same two ops in Python later).
export interface GeocodeStore {
  get: (canonical_addr: string) => Promise<GeocodeResult | null>;
  put: (row: GeocodeResult & { provider_vintage?: string }) => Promise<void>;
}

/** The write-once read-through cache. Hit → stored row; miss → run ladder in order,
 *  classify, set needs_review, persist, return. Never throws for a geocode miss — a
 *  failed resolve is a first-class result (match_type='failed', needs_review=true), so
 *  the caller quarantines the record instead of the page breaking. */
export async function resolveGeocode(
  store: GeocodeStore,
  input_address: string,
  canonical_addr: string,
  ladder: GeocoderRung[],
  opts?: { providerVintage?: string },
): Promise<GeocodeResult> {
  const cached = await store.get(canonical_addr).catch(() => null);
  if (cached) return cached;

  let resolved: GeocodeResult = {
    canonical_addr,
    input_address,
    lat: null,
    lng: null,
    match_type: "failed",
    matched_address: null,
    geocode_source: "none",
    needs_review: true,
    review_reason: "no geocoder rung resolved this address",
  };

  for (const rung of ladder) {
    const hit = await rung.resolve(input_address).catch(() => null);
    if (!hit) continue;
    const precise = PRECISE.has(hit.match_type);
    resolved = {
      canonical_addr,
      input_address,
      lat: hit.lat,
      lng: hit.lng,
      match_type: hit.match_type,
      matched_address: hit.matched_address,
      geocode_source: rung.source,
      needs_review: !precise,
      review_reason: precise ? null : `match_type=${hit.match_type} (not rooftop/parcel) — needs a precise source`,
    };
    break;
  }

  // Persist even a failure, so the review queue captures it and we don't re-hit a dead
  // address every refresh. Never let a cache-write error break the caller.
  await store.put({ ...resolved, provider_vintage: opts?.providerVintage }).catch(() => {});
  return resolved;
}

// ─────────────────────────── rungs ───────────────────────────

/** Today's only rung: US Census onelineaddress, Public_AR_Current benchmark.
 *  This benchmark is address-range interpolation along TIGER/Line segments — it has NO
 *  rooftop tier — so every successful match is classified 'range_interpolated' and is
 *  therefore always flagged for review. That is the correct, honest signal until a
 *  parcel/rooftop rung is added ahead of this one. Returns null on no match → the caller
 *  falls to the next rung, or (today, with only this rung) to a 'failed' result. */
export function censusRung(fetchFn: typeof fetch): GeocoderRung {
  return {
    source: "census_onelineaddress",
    resolve: async (input: string) => {
      const q = new URLSearchParams({ address: input, benchmark: "Public_AR_Current", format: "json" });
      const r = await fetchFn(
        `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?${q}`,
        { signal: AbortSignal.timeout(15000) },
      );
      const data = await r.json();
      const matches = data?.result?.addressMatches ?? [];
      if (!matches.length) return null;
      const m = matches[0];
      const c = m.coordinates;
      return {
        lat: Number(c.y),
        lng: Number(c.x),
        match_type: "range_interpolated" as MatchType,
        matched_address: (m.matchedAddress as string) ?? input,
      };
    },
  };
}

// ─────────────────────────── store ───────────────────────────

// The only Supabase-coupled piece. A Python port reimplements just this against the
// same `geocodes` table. `supabase` is the createClient() instance; typed loosely to
// avoid dragging the supabase-js types across the module boundary.
// deno-lint-ignore no-explicit-any
export function supabaseStore(supabase: any): GeocodeStore {
  const COLS =
    "canonical_addr,input_address,lat,lng,match_type,matched_address,geocode_source,needs_review,review_reason";
  return {
    get: async (canonical_addr: string) => {
      const { data } = await supabase.from("geocodes").select(COLS).eq("canonical_addr", canonical_addr).maybeSingle();
      return (data as GeocodeResult) ?? null;
    },
    put: async (row) => {
      await supabase.from("geocodes").upsert(
        {
          canonical_addr: row.canonical_addr,
          input_address: row.input_address,
          lat: row.lat,
          lng: row.lng,
          match_type: row.match_type,
          matched_address: row.matched_address,
          geocode_source: row.geocode_source,
          needs_review: row.needs_review,
          review_reason: row.review_reason,
          provider_vintage: row.provider_vintage ?? null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "canonical_addr" },
      );
    },
  };
}
