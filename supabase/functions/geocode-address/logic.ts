// Testable Census proxy. index.ts is the Deno.serve wrapper and keeps the
// source-gate literals (oneline URL, Public_AR_Current, exactly one fetch().
import { pickCensusMatch } from "./census-match.ts";

export const CENSUS_TIMEOUT_MS = 15000;
export const CENSUS_ONELINE = "https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress";
// The geographies endpoint returns the same addressMatches as locations/, plus the
// incorporated place (city) the matched point lies in. Measured 2026-10-18 through
// pg_net: an address inside a city carries geographies["Incorporated Places"][0]
// (GEOID 5373465 "University Place", 5338038 "Lakewood"); an unincorporated one
// (17602 Pacific Ave, Spanaway, a CDP) carries "geographies":{} with no such key.
export const CENSUS_PLACE_LAYER = "Incorporated Places";

export type GeocodeAddressResult = { body: Record<string, unknown>; status: number };

function clientMatch(
  m: {
    matchedAddress?: string;
    coordinates?: { x?: unknown; y?: unknown };
    addressComponents?: { zip?: string; city?: string; state?: string };
    geographies?: Record<string, { GEOID?: unknown; BASENAME?: unknown; FUNCSTAT?: unknown }[]>;
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
    ...placeOf(m.geographies),
  };
}

/** The incorporated city the matched point lies in, as Census states it.
 *  placeChecked: false when Census sent no geographies block at all (nothing was
 *  measured, so nothing is claimed). placeChecked: true with place: null means the
 *  point lies in no incorporated place — the county governs it. Only an active
 *  government (FUNCSTAT A) counts; a GEOID is kept only when it is 7 digits. */
export function placeOf(
  g: Record<string, { GEOID?: unknown; BASENAME?: unknown; FUNCSTAT?: unknown }[]> | undefined,
): { place: { geoid: string; name: string } | null; placeChecked: boolean } {
  if (!g || typeof g !== "object" || Array.isArray(g)) return { place: null, placeChecked: false };
  const p = (Array.isArray(g[CENSUS_PLACE_LAYER]) ? g[CENSUS_PLACE_LAYER] : [])
    .find((x) => /^\d{7}$/.test(String(x?.GEOID ?? "")) && String(x?.FUNCSTAT ?? "A") === "A");
  return p
    ? { place: { geoid: String(p.GEOID), name: String(p.BASENAME ?? "") }, placeChecked: true }
    : { place: null, placeChecked: true };
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
  const u = `${CENSUS_ONELINE}?benchmark=Public_AR_Current&vintage=Current_Current`
    + `&layers=${encodeURIComponent(CENSUS_PLACE_LAYER)}&format=json&address=${encodeURIComponent(q)}`;
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
    geographies?: Record<string, { GEOID?: unknown; BASENAME?: unknown; FUNCSTAT?: unknown }[]>;
  }[];
  const m = pickCensusMatch(matches, q);
  return { body: { match: clientMatch(m, q) }, status: 200 };
}
