// Testable Census proxy. index.ts is the Deno.serve wrapper and keeps the
// source-gate literals (oneline URL, Public_AR_Current, exactly one fetch().
import { pickCensusMatch } from "./census-match.ts";

export const CENSUS_TIMEOUT_MS = 15000;
export const CENSUS_ONELINE = "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress";

export type GeocodeAddressResult = { body: Record<string, unknown>; status: number };

function clientMatch(
  m: {
    matchedAddress?: string;
    coordinates?: { x?: unknown; y?: unknown };
    addressComponents?: { zip?: string; city?: string; state?: string };
  } | undefined,
  q: string,
): Record<string, unknown> | null {
  if (!m?.coordinates || !m.addressComponents?.zip) return null;
  return {
    matchedAddress: m.matchedAddress || q,
    lat: m.coordinates.y,
    lng: m.coordinates.x,
    zip: m.addressComponents.zip,
    city: m.addressComponents.city || null,
    state: m.addressComponents.state || null,
  };
}

/** Resolve one address against Census. fetchFn is injected so tests stay offline.
 *  Transport (timeout, HTTP non-200, non-JSON) → 502 geocoder_unavailable.
 *  A completed lookup with zero matches → 200 { match: null }. */
export async function handleGeocodeAddress(
  address: unknown,
  fetchFn: typeof fetch,
): Promise<GeocodeAddressResult> {
  const q = String(address || "").trim().slice(0, 200);
  if (q.length < 8 || q.indexOf(" ") < 0) return { body: { match: null }, status: 200 };
  const u = `${CENSUS_ONELINE}?benchmark=Public_AR_Current&format=json&address=${encodeURIComponent(q)}`;
  let r: Response;
  try {
    r = await fetchFn(u, { signal: AbortSignal.timeout(CENSUS_TIMEOUT_MS) });
  } catch {
    return { body: { error: "geocoder_unavailable" }, status: 502 };
  }
  if (!r.ok) return { body: { error: "geocoder_unavailable" }, status: 502 };
  let j: { result?: { addressMatches?: unknown[] } };
  try {
    j = await r.json();
  } catch {
    return { body: { error: "geocoder_unavailable" }, status: 502 };
  }
  const matches = (j?.result?.addressMatches ?? []) as {
    matchedAddress?: string;
    coordinates?: { x?: unknown; y?: unknown };
    addressComponents?: { zip?: string; city?: string; state?: string };
  }[];
  const m = pickCensusMatch(matches, q);
  return { body: { match: clientMatch(m, q) }, status: 200 };
}
