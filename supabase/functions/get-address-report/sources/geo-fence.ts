// GEOCODE GEOFENCE — the single implementation, shared by every connector.
//
// WHY THIS FILE EXISTS. CLAUDE.md §8 lists this among "the five rules that never bend":
// "an area-scope record whose geocoder returns coordinates outside the covered jurisdiction's
// bounding box gets its lat/lng nulled, not trusted." It was nonetheless enforced in only TWO
// of five connectors — arcgis.ts and socrata.ts each carried their OWN copy (socrata's named
// GEOCODE_FENCE_MI_GEO / milesBetweenGeo, with a comment saying it was "kept in lockstep"),
// while ckan.ts, carto.ts and csv.ts geocoded with no fence at all.
//
// That is the connector-option-surface divergence class (status_const, include_types) applied
// to a SAFETY rule: the blast radius was small only because those three connectors rarely
// geocode, and every future entry on them would have inherited the unfenced path.
//
// Live proof, found 2026-08-04 on the first ckan entry that geocoded anything:
//   allegheny-county-asbestos-permits, ZIP 15202, "294 UNION AVENUE"
//   → cached lat 42.993118, lng -74.398022, geo_precision "address", scope "point"
//   → matched_address "295 UNION AVE EXD, JOHNSTOWN, NY, 12095"
// Wrong state, wrong ZIP, wrong house number, ~300 mi from Pittsburgh. BOTH checks below
// would have rejected it. Same class as the Fort Worth permit that rendered in Michigan.
//
// SEMANTICS ARE UNCHANGED from the arcgis/socrata originals — they were already identical to
// each other in every operative detail (25 mi, the same equirectangular distance, the same
// trailing-ZIP regex, the same mismatch test, the same null-out, the same reason strings).
// Only the identifiers differed. Nothing was reconciled because nothing diverged; this file
// removes the duplication that made a future divergence inevitable.
//
// SOURCE-SUPPLIED GEOMETRY IS NEVER FENCED. A real parcel can legitimately sit far from a big
// county's ZIP centroid. Only GEOCODED points — where the geocoder may have guessed — pass here.

/** Geofence for GEOCODED points: a Census interpolation landing farther than this from the
 *  report's ZIP centroid cannot be an address inside that ZIP — the coords are nulled and the
 *  record stays listed (area scope), so nothing is lost but the untrusted marker. */
export const GEOCODE_FENCE_MI = 25;

/** Equirectangular distance in miles — plenty at fence scale. */
export function milesBetween(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = (lat2 - lat1) * 69;
  const dLng = (lng2 - lng1) * 69 * Math.cos(((lat1 + lat2) / 2) * Math.PI / 180);
  return Math.sqrt(dLat * dLat + dLng * dLng);
}

/** What a connector's deps.geocode resolves to (the shape every connector already uses). */
export interface GeocodeHit {
  lat: number;
  lng: number;
  match_type?: string;
  matched_address?: string | null;
  geocode_source?: string;
  needs_review?: boolean;
}

export type FenceVerdict =
  | { ok: true }
  | { ok: false; reason: string };

/** Pull the trailing 5-digit ZIP out of a geocoder's matched address ("… , NY, 12095" → 12095;
 *  a ZIP+4 keeps its first five). Returns null when the geocoder stated no ZIP. */
export function matchedZipOf(matchedAddress?: string | null): string | null {
  return ((matchedAddress || "").match(/\b(\d{5})(?:-\d{4})?\s*$/)?.[1]) ?? null;
}

/**
 * Decide whether a GEOCODED point may be trusted. Two local checks, no extra lookups:
 *
 *   1. the geocoder's own matched ZIP must equal the ZIP the record was filed under, and
 *   2. the point must sit within GEOCODE_FENCE_MI of the report's ZIP centroid.
 *
 * Either miss ⇒ the caller NULLS the coords and demotes the record to area scope. The record
 * still renders in the list with its record_url; only the marker is withheld.
 *
 * Both checks FAIL OPEN when their input is absent, exactly as the arcgis/socrata originals
 * did: an unknown filed ZIP or an absent centroid cannot prove a point wrong, and inventing a
 * rejection would drop real records. This is deliberate — the fence catches what it can prove.
 */
export function fenceGeocode(
  g: GeocodeHit,
  filedZip: string | null,
  zipCentroid?: { lat: number; lng: number } | null,
): FenceVerdict {
  const matchedZip = matchedZipOf(g.matched_address);
  if (filedZip && matchedZip && filedZip !== matchedZip) {
    return { ok: false, reason: `geocode geofence: matched ZIP ${matchedZip} != filed ${filedZip} — coords nulled` };
  }
  if (zipCentroid) {
    const miles = milesBetween(zipCentroid.lat, zipCentroid.lng, g.lat, g.lng);
    if (miles > GEOCODE_FENCE_MI) {
      return { ok: false, reason: `geocode geofence: point ${Math.round(miles)} mi from ZIP centroid (> ${GEOCODE_FENCE_MI}) — coords nulled` };
    }
  }
  return { ok: true };
}

/** The filed ZIP for the fence when a connector does NOT use the geocode_assemble builder:
 *  the record's own mapped ZIP column if it carries a 5-digit ZIP, else the report ZIP. */
export function filedZipOf(zipColValue: unknown, reportZip: string | null): string | null {
  return (String(zipColValue ?? "").match(/\b\d{5}\b/)?.[0]) || reportZip || null;
}
