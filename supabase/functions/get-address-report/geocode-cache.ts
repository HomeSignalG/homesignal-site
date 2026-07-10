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
  | "parcel_centroid"
  | "range_interpolated"
  | "zip_centroid"
  | "county_centroid"
  | "failed";

// DISTINCT, ORDERED quality tiers. Higher = more precise. parcel_centroid is its OWN tier
// between rooftop and range_interpolated — never folded into rooftop. This ordering is the
// single source of truth the never-downgrade guard uses (mirrored in SQL as
// geocode_quality_rank(); see docs/txgio-geocode-tables.sql). Keep the two in lockstep.
export const QUALITY_RANK: Record<MatchType, number> = {
  rooftop: 3,
  parcel_centroid: 2,
  range_interpolated: 1,
  zip_centroid: 0,
  county_centroid: 0,
  failed: -1,
};

// Only a ROOFTOP point is precise enough to clear the review queue. A parcel centroid is a
// real, rendered point (better than interpolation) but STAYS flagged (needs_review=true):
// on a large/industrial lot a centroid can sit well off the building, so we surface it for an
// optional rooftop upgrade rather than trusting it silently (owner decision, #2). match_type
// still carries the exact tier (rooftop | parcel | range_interpolated) so the frontend can
// style all three distinctly.
export const CLEARS_REVIEW: ReadonlySet<MatchType> = new Set<MatchType>(["rooftop"]);

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
  // input = the raw filed address (what an HTTP geocoder wants); canonical = canonicalAddr(input)
  // (the exact key a loaded-dataset rung, e.g. TxGIO, looks up). A rung uses whichever it needs.
  resolve: (
    input: string,
    canonical: string,
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
  opts?: { providerVintage?: string; forceRefresh?: boolean },
): Promise<GeocodeResult> {
  // Normal (write-once) path: return the cached row untouched. forceRefresh (the re-geocode
  // batch) SKIPS the cache read so the ladder runs fresh — but the write still goes through the
  // SQL improvement guard (upsert_geocode_if_better), so a re-run can only upgrade, never
  // downgrade, and there is no delete/refresh gap where the row goes missing.
  if (!opts?.forceRefresh) {
    const cached = await store.get(canonical_addr).catch(() => null);
    if (cached) return cached;
  }

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
    // A rung returns null on a miss (no match or API error) → try the next rung. This is how the
    // ladder degrades safely: the zero-fee dataset rung (OpenAddresses parcel_centroid) →
    // Census (range_interpolated), ending at interpolation rather than ever hard-erroring.
    const hit = await rung.resolve(input_address, canonical_addr).catch(() => null);
    if (!hit) continue;
    const clears = CLEARS_REVIEW.has(hit.match_type);
    resolved = {
      canonical_addr,
      input_address,
      lat: hit.lat,
      lng: hit.lng,
      match_type: hit.match_type,
      matched_address: hit.matched_address,
      geocode_source: rung.source,
      needs_review: !clears,
      review_reason: clears ? null : `match_type=${hit.match_type} (not rooftop) — flagged for optional precise upgrade`,
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

/** Dataset rung — a LOCAL-DATASET lookup, no runtime egress, no per-call cost. Reads a table
 *  the CI loader populated (today: national_address_points from OpenAddresses), keyed by
 *  canonicalAddr(). Returns the point AT THE TIER THE LOADER STAMPED ON THE ROW (match_type):
 *  OpenAddresses defaults to 'parcel_centroid' and is only 'rooftop' where the source gave an
 *  explicit rooftop signal — so precision is never overstated. A miss returns null → next rung.
 *  (No commercial geocoder rung exists — the ladder is zero-fee: this dataset, then Census.) */
// deno-lint-ignore no-explicit-any
export function datasetRung(supabase: any, table: string, source = table): GeocoderRung {
  return {
    source,
    resolve: async (_input: string, canonical: string) => {
      const { data } = await supabase.from(table).select("lat,lng,match_type").eq("canonical_addr", canonical).maybeSingle();
      if (!data || typeof data.lat !== "number" || typeof data.lng !== "number") return null;
      // Honour the row's stamped tier; fall back to the conservative parcel_centroid, never rooftop.
      const mt = (data.match_type === "rooftop" || data.match_type === "parcel_centroid") ? data.match_type : "parcel_centroid";
      return { lat: data.lat, lng: data.lng, match_type: mt as MatchType, matched_address: canonical };
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
      // THE IMPROVEMENT GUARD lives in SQL: upsert_geocode_if_better() inserts a new address,
      // but on conflict only overwrites when the new tier STRICTLY OUTRANKS the stored one
      // (geocode_quality_rank(excluded) > geocode_quality_rank(existing)). So a re-geocode can
      // only ever upgrade a point — a lower/equal tier (incl. a transient 'failed') can never
      // clobber a better stored point. Routing every write through it makes the guarantee
      // universal (write-once path AND the re-geocode batch), not batch-only.
      await supabase.rpc("upsert_geocode_if_better", {
        p_canonical: row.canonical_addr,
        p_input: row.input_address,
        p_lat: row.lat,
        p_lng: row.lng,
        p_match_type: row.match_type,
        p_matched: row.matched_address,
        p_source: row.geocode_source,
        p_needs_review: row.needs_review,
        p_review_reason: row.review_reason,
        p_vintage: row.provider_vintage ?? null,
      });
    },
  };
}
