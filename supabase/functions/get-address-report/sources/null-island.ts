// (0, 0) IS NOT A PLACE. Some publishers fill an empty coordinate with zeros ("Null Island", in the
// Gulf of Guinea). A connector that trusts it skips the geocoder, so the record is never pinned: the
// materializer's outlier guard (public.app_coord_outlier) later blanks the point, and the permit shows
// in lists only. Measured 2026-10-20 in development_reports: 9,536 cached records from 3 sources
// (overland-park-building-permits 9,158 on 35 ZIP pages, gilbert-energov-permits 300 on 9,
// little-rock-permits 78 on 7) carried lat 0 / lng 0, and all 9,536 had a street address.
//
// Both values exactly zero is treated as ABSENT, so the record takes the same path as a row with no
// coordinates: geocode its own address where the entry allows it (the geofence still applies), else
// area scope. A single zero is kept; it is a real meridian or equator coordinate, and no covered place
// is near either.

export function dropNullIsland(lat: number | null, lng: number | null): [number | null, number | null] {
  if (lat === 0 && lng === 0) return [null, null];
  return [lat, lng];
}
