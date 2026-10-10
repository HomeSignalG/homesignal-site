// ONE definition of the ZIP-mode SPATIAL SCOPE for radius-scoped sources (spatial_zip_radius_mi).
//
// WHY THIS EXISTS (docs/geographic-coverage-audit-2026-10-10.md)
// A radius-scoped entry used to ask the source for records inside ±R miles of the ZIP CENTROID.
// A ZIP is a polygon, not a disc, and large or elongated ZIPs extend well past that square:
// the Denton County layer lost 5,429 of 25,727 records (21%) — every one of them outside every
// modeled ZIP's envelope and none of them ever stored — and 5,061 of those lie INSIDE the nine
// pilot ZIP polygons. Map 1 / the report are boundary-based (geo.n5_serving_membership), so a
// record that is never fetched can never be served, whatever its polygon says.
//
// THE RULE: the scope is the UNION of
//   (a) the legacy centroid square (so nothing fetched today can stop being fetched), and
//   (b) the bounding box of the ZIP's canonical polygon (geo.zcta_boundary), when known.
// It is a PREFILTER only. Who belongs to a ZIP is still decided downstream by polygon membership
// (geo.zip_point_membership_in via the serving generation); this module never decides membership
// and never claims the box is the boundary.
//
// FAIL-SAFE: without bounds the result is byte-for-byte the legacy square. A missing/failed
// bounds read can therefore never shrink what is fetched, only leave it as it is today.

export interface ScopeBox { xmin: number; ymin: number; xmax: number; ymax: number }

/** Bounding box of a ZIP's canonical polygon, in degrees (NAD83 ≈ WGS84 to ~1 m). */
export type ZipBounds = ScopeBox;

/** WGS84 square of ±radius miles around a point (1° lat ≈ 69 mi; lng scaled by cos(lat)).
 *  This is the LEGACY envelope, kept here verbatim so there is exactly one copy of it. */
export function centroidSquare(lat: number, lng: number, radiusMi: number): ScopeBox {
  const dLat = radiusMi / 69;
  const dLng = radiusMi / (69 * Math.max(Math.cos(lat * Math.PI / 180), 0.1));
  return { xmin: lng - dLng, ymin: lat - dLat, xmax: lng + dLng, ymax: lat + dLat };
}

/** A usable bounds object: four finite numbers, min < max, inside the lat/lng domain. */
export function validBounds(b: unknown): b is ZipBounds {
  if (!b || typeof b !== "object") return false;
  const { xmin, ymin, xmax, ymax } = b as Record<string, unknown>;
  const n = [xmin, ymin, xmax, ymax];
  if (!n.every((v) => typeof v === "number" && Number.isFinite(v))) return false;
  const [x0, y0, x1, y1] = n as number[];
  return x0 < x1 && y0 < y1 && x0 >= -180 && x1 <= 180 && y0 >= -90 && y1 <= 90;
}

/** The ZIP-mode scope: legacy centroid square ∪ polygon bbox (the smallest box holding both). */
export function scopeBox(
  centroid: { lat: number; lng: number },
  radiusMi: number,
  bounds?: ZipBounds | null,
): ScopeBox {
  const sq = centroidSquare(centroid.lat, centroid.lng, radiusMi);
  if (!validBounds(bounds)) return sq;
  return {
    xmin: Math.min(sq.xmin, bounds.xmin),
    ymin: Math.min(sq.ymin, bounds.ymin),
    xmax: Math.max(sq.xmax, bounds.xmax),
    ymax: Math.max(sq.ymax, bounds.ymax),
  };
}

/** True when the box strictly widens the legacy square (i.e. the fix changes this fetch). */
export function widensLegacy(box: ScopeBox, centroid: { lat: number; lng: number }, radiusMi: number): boolean {
  const sq = centroidSquare(centroid.lat, centroid.lng, radiusMi);
  return box.xmin < sq.xmin || box.ymin < sq.ymin || box.xmax > sq.xmax || box.ymax > sq.ymax;
}

export function pointInBox(lat: number, lng: number, b: ScopeBox): boolean {
  return lng >= b.xmin && lng <= b.xmax && lat >= b.ymin && lat <= b.ymax;
}
