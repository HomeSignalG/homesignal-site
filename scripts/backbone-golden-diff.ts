// scripts/backbone-golden-diff.ts — EMPIRICAL zero-diff harness for the backbone refactor.
//
// PURPOSE: prove that the Phase 1–3 refactor changed NO connector output. It runs the five
// registry-driven connectors against FROZEN, deterministic inputs and prints canonical JSON.
// CI runs it once on the BASE commit and once on the BRANCH and diffs the two outputs.
// Byte-identical stdout == the refactor is behaviour-preserving.
//
// WHY SYNTHETIC-BUT-DERIVED FIXTURES (not captured payloads):
//   The fixture rows are generated FROM each source's real jurisdiction-registry entry — every
//   column the entry's column_map references is populated, so the fixture automatically matches
//   whatever the live entry maps. That does two things a captured payload cannot:
//     1. it stays correct if a registry entry changes, and
//     2. it deliberately hits the EDGE CASES that the helper audit flagged as divergent —
//        whitespace-only numerics (numOrNull), three date spellings (isoDay), an object-shaped
//        URL and a non-http string (extractUrl), an unmapped status (fail-closed), a blank
//        record_url (anti-fabrication drop), and a row with no coordinates (geocode path).
//   Equivalence is what is being proven here, NOT correctness — so inputs that maximise
//   path coverage are strictly better than a real payload that exercises one happy path.
//
// NO NETWORK, NO DATABASE, NO PRODUCTION. fetch and geocode are both stubbed deterministically.

import { socrataForZip } from "../supabase/functions/get-address-report/sources/socrata.ts";
import { arcgisForZip } from "../supabase/functions/get-address-report/sources/arcgis.ts";
import { ckanForZip } from "../supabase/functions/get-address-report/sources/ckan.ts";
import { csvForZip } from "../supabase/functions/get-address-report/sources/csv.ts";
import { cartoForZip } from "../supabase/functions/get-address-report/sources/carto.ts";
import registry from "../supabase/functions/get-address-report/jurisdiction-registry.json" with { type: "json" };

type Row = Record<string, unknown>;
const REG = registry as unknown as Record<string, Row[]>;

/** THE GOLDEN SET — every ZIP names the connector path it exercises. */
const GOLDEN: { zip: string; platform: string; registry_id: string; exercises: string }[] = [
  // ── ArcGIS ────────────────────────────────────────────────────────────────────────
  { zip: "22003", platform: "arcgis", registry_id: "fairfax-active-site-construction", exercises: "record-level URL column; spatial ZIP scoping; multi-bucket status map" },
  { zip: "22102", platform: "arcgis", registry_id: "fairfax-recent-building-permits", exercises: "record URL; 7-value status vocab incl. exclude bucket; recency" },
  { zip: "48226", platform: "arcgis", registry_id: "detroit-building-permits", exercises: "status_const issuance ledger; native zip + own lat/lng" },
  { zip: "43215", platform: "arcgis", registry_id: "columbus-building-permits", exercises: "out_fields + page_size projection; native ZIP" },
  { zip: "44113", platform: "arcgis", registry_id: "cleveland-issued-building-permits", exercises: "status_const + spatial radius + per-record Accela URL" },
  { zip: "92805", platform: "arcgis", registry_id: "anaheim-land-use-cases", exercises: "geometry-less TABLE → GEOCODE path + geofence" },
  { zip: "80301", platform: "arcgis", registry_id: "boulder-construction-permits", exercises: "geocoded records; area-scope fallback on geocode failure" },
  { zip: "85201", platform: "socrata", registry_id: "mesa-building-permits", exercises: "large verbatim status vocab; en-dash status variants" },
  // ── Socrata ───────────────────────────────────────────────────────────────────────
  { zip: "60601", platform: "socrata", registry_id: "chicago-building-permits", exercises: "spatial_point_col within_circle; extra_where noise drop" },
  { zip: "11201", platform: "socrata", registry_id: "nyc-dobnow-approved-permits", exercises: "native zip + lat/lng; include_types whitelist" },
  { zip: "94941", platform: "socrata", registry_id: "marin-county-building-permits", exercises: "status_const; dataset-precision URL; native text zip" },
  { zip: "98101", platform: "socrata", registry_id: "seattle-building-permits", exercises: "native ZIP; per-record link; extra_where" },
  { zip: "78701", platform: "socrata", registry_id: "austin-subdivision-cases", exercises: "composite address array; decision_date mapping" },
  // ── CKAN ──────────────────────────────────────────────────────────────────────────
  { zip: "02128", platform: "ckan", registry_id: "boston-approved-building-permits", exercises: "CKAN datastore; native zip + lat/lng; operating bucket" },
  { zip: "15213", platform: "ckan", registry_id: "pittsburgh-pli-permits", exercises: "CKAN; 13 verbatim statuses; native zip_code" },
  // ── CSV ───────────────────────────────────────────────────────────────────────────
  { zip: "92101", platform: "csv", registry_id: "san-diego-approved-permits", exercises: "published CSV parse; record-precision URL template; spatial scope" },
  // ── Carto ─────────────────────────────────────────────────────────────────────────
  { zip: "19107", platform: "carto", registry_id: "philadelphia-li-permits", exercises: "Carto SQL API; ZIP+4 LIKE prefix; ST_Y/ST_X geometry" },
  // ── Coverage-gate negatives (a source must NOT run outside its coverage) ───────────
  { zip: "84302", platform: "arcgis", registry_id: "fairfax-active-site-construction", exercises: "COVERAGE GATE: Box Elder UT ZIP must yield 0 fetches from a VA source" },
  { zip: "78617", platform: "socrata", registry_id: "chicago-building-permits", exercises: "COVERAGE GATE: Del Valle TX ZIP must yield 0 fetches from an IL source" },
  { zip: "84604", platform: "ckan", registry_id: "boston-approved-building-permits", exercises: "COVERAGE GATE: Utah County ZIP must yield 0 fetches from an MA source" },
  { zip: "84083", platform: "csv", registry_id: "san-diego-approved-permits", exercises: "COVERAGE GATE: empty UT desert ZIP must yield 0 fetches from a CA source" },
  { zip: "55407", platform: "carto", registry_id: "philadelphia-li-permits", exercises: "COVERAGE GATE: Minneapolis ZIP must yield 0 fetches from a PA source" },
  { zip: "33130", platform: "socrata", registry_id: "marin-county-building-permits", exercises: "COVERAGE GATE: Miami ZIP must yield 0 fetches from a CA source" },
];

/** Community rows per golden ZIP — the coverage gate's input. Frozen, not read from the DB. */
const COMMUNITIES: Record<string, { state: string; county: string }> = {
  "22003": { state: "VA", county: "Fairfax" },   "22102": { state: "VA", county: "Fairfax" },
  "48226": { state: "MI", county: "Wayne" },     "43215": { state: "OH", county: "Franklin" },
  "44113": { state: "OH", county: "Cuyahoga" },  "92805": { state: "CA", county: "Orange" },
  "80301": { state: "CO", county: "Boulder" },   "85201": { state: "AZ", county: "Maricopa" },
  "60601": { state: "IL", county: "Cook" },      "11201": { state: "NY", county: "Kings" },
  "94941": { state: "CA", county: "Marin" },     "98101": { state: "WA", county: "King" },
  "78701": { state: "TX", county: "Travis" },    "02128": { state: "MA", county: "Suffolk" },
  "15213": { state: "PA", county: "Allegheny" }, "92101": { state: "CA", county: "San Diego" },
  "19107": { state: "PA", county: "Philadelphia" },
  "84302": { state: "UT", county: "Box Elder" }, "78617": { state: "TX", county: "Travis" },
  "84604": { state: "UT", county: "Utah" },      "84083": { state: "UT", county: "Tooele" },
  "55407": { state: "MN", county: "Hennepin" },  "33130": { state: "FL", county: "Miami-Dade" },
};

const ZIP_CENTROID: Record<string, { lat: number; lng: number }> = {
  "22003": { lat: 38.8307, lng: -77.2142 }, "22102": { lat: 38.9540, lng: -77.2210 },
  "48226": { lat: 42.3299, lng: -83.0456 }, "43215": { lat: 39.9689, lng: -83.0055 },
  "44113": { lat: 41.4839, lng: -81.6960 }, "92805": { lat: 33.8366, lng: -117.9110 },
  "80301": { lat: 40.0470, lng: -105.2210 }, "85201": { lat: 33.4310, lng: -111.8480 },
  "60601": { lat: 41.8858, lng: -87.6229 }, "11201": { lat: 40.6939, lng: -73.9903 },
  "94941": { lat: 37.8894, lng: -122.5450 }, "98101": { lat: 47.6109, lng: -122.3350 },
  "78701": { lat: 30.2712, lng: -97.7430 }, "02128": { lat: 42.3800, lng: -71.0060 },
  "15213": { lat: 40.4440, lng: -79.9530 }, "92101": { lat: 32.7180, lng: -117.1620 },
  "19107": { lat: 39.9500, lng: -75.1600 }, "84302": { lat: 41.5105, lng: -112.0155 },
  "78617": { lat: 30.1745, lng: -97.6134 }, "84604": { lat: 40.2760, lng: -111.6390 },
  "84083": { lat: 40.7500, lng: -114.0300 }, "55407": { lat: 44.9350, lng: -93.2520 },
  "33130": { lat: 25.7680, lng: -80.2030 },
};

function entryFor(platform: string, id: string): Row | null {
  return (REG[platform] ?? []).find((e) => e.registry_id === id) ?? null;
}

/** Every column name an entry's column_map references (flattened). */
function mappedColumns(entry: Row): string[] {
  const cm = (entry.column_map ?? {}) as Record<string, unknown>;
  const out: string[] = [];
  for (const v of Object.values(cm)) {
    if (typeof v === "string") out.push(v);
    else if (Array.isArray(v)) for (const c of v) if (typeof c === "string") out.push(c);
  }
  if (typeof entry.incremental_field === "string") out.push(entry.incremental_field);
  if (entry.spatial_point_col) out.push(String(entry.spatial_point_col));
  const sc = entry.spatial_latlng_cols as { lat?: string; lng?: string } | undefined;
  if (sc?.lat) out.push(sc.lat);
  if (sc?.lng) out.push(sc.lng);
  return [...new Set(out.filter((c) => !c.startsWith("__")))];
}

/** Statuses/types the entry declares, so rows land in real buckets (plus one unmapped). */
function declaredStatuses(entry: Row): string[] {
  const s2b = (entry.status_to_bucket ?? {}) as Record<string, string[]>;
  const all = Object.values(s2b).flatMap((v) => (Array.isArray(v) ? v : []));
  const konst = typeof entry.status_const === "string" ? [entry.status_const] : [];
  return [...konst, ...all].slice(0, 4);
}
function declaredTypes(entry: Row): string[] {
  const it = Array.isArray(entry.include_types) ? (entry.include_types as string[]) : [];
  const tm = Object.keys((entry.type_map ?? {}) as Record<string, unknown>);
  return [...new Set([...it, ...tm])].slice(0, 3);
}

/**
 * Deterministic fixture rows for an entry. Row 0..n-1 walk the flagged edge cases:
 *   0 native coords + mapped status/type          5 whitespace-only numeric (numOrNull)
 *   1 ISO date                                    6 blank record_url (anti-fabrication drop)
 *   2 M/D/YYYY date                               7 UNMAPPED status (fail-closed exclusion)
 *   3 epoch-millis date                           8 no coords at all (geocode path)
 *   4 object-shaped url {url:…}                   9 non-http url string (extractUrl)
 */
function fixtureRows(entry: Row, zip: string, n = 10): Row[] {
  const cols = mappedColumns(entry);
  const cm = (entry.column_map ?? {}) as Record<string, unknown>;
  const first = (k: string) => { const v = cm[k]; return typeof v === "string" ? v : Array.isArray(v) ? String(v[0]) : null; };
  const statusCol = first("status_raw"), typeCol = first("type_source"), dateCol = first("file_date");
  const latCol = first("lat"), lngCol = first("lng"), zipCol = first("zip"), urlCol = first("record_url");
  const statuses = declaredStatuses(entry), types = declaredTypes(entry);
  const c = ZIP_CENTROID[zip] ?? { lat: 40, lng: -100 };

  const rows: Row[] = [];
  for (let i = 0; i < n; i++) {
    const r: Row = {};
    for (const col of cols) r[col] = `${col}_v${i}`;          // deterministic default for every mapped column
    if (statusCol) r[statusCol] = i === 7 ? "ZZ_UNMAPPED_STATUS" : (statuses[i % Math.max(1, statuses.length)] ?? "");
    if (typeCol) r[typeCol] = types[i % Math.max(1, types.length)] ?? "";
    if (dateCol) r[dateCol] = i === 2 ? "3/14/2026" : i === 3 ? 1773100800000 : "2026-03-14T00:00:00";
    if (zipCol) r[zipCol] = zip;
    if (latCol && lngCol) {
      if (i === 8) { r[latCol] = null; r[lngCol] = null; }     // → geocode path
      else if (i === 5) { r[latCol] = "  "; r[lngCol] = "  "; } // → numOrNull whitespace divergence
      else { r[latCol] = c.lat + i * 0.0005; r[lngCol] = c.lng + i * 0.0005; }
    }
    if (urlCol) {
      r[urlCol] = i === 4 ? { url: `https://example.gov/record/${i}` }
        : i === 6 ? "" : i === 9 ? "not-a-url" : `https://example.gov/record/${i}`;
    }
    if (entry.spatial_point_col) r[String(entry.spatial_point_col)] = { latitude: String(c.lat), longitude: String(c.lng) };
    r["__row"] = i; r[":id"] = String(i); r["_id"] = i; r["OBJECTID"] = i; r["FID"] = i;
    rows.push(r);
  }
  return rows;
}

/** Platform response envelopes. Second call for the same URL returns empty → paging terminates. */
function envelope(platform: string, entry: Row, rows: Row[], zip: string): string {
  const c = ZIP_CENTROID[zip] ?? { lat: 40, lng: -100 };
  switch (platform) {
    case "socrata": return JSON.stringify(rows);
    case "ckan": return JSON.stringify({ success: true, result: { records: rows, fields: [] } });
    case "carto": return JSON.stringify({ rows, total_rows: rows.length });
    case "arcgis": return JSON.stringify({
      features: rows.map((a, i) => ({ attributes: a, geometry: i === 8 ? undefined : { x: c.lng + i * 0.0005, y: c.lat + i * 0.0005 } })),
    });
    case "csv": {
      const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
      const esc = (v: unknown) => { const s = v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
      return [cols.join(","), ...rows.map((r) => cols.map((k) => esc(r[k])).join(","))].join("\n");
    }
    default: return "{}";
  }
}

/** Deterministic geocoder — inside the fence for every ZIP, so the fence verdict is stable. */
function stubGeocode(zip: string) {
  const c = ZIP_CENTROID[zip] ?? { lat: 40, lng: -100 };
  return (_addr: string) => Promise.resolve({
    lat: c.lat + 0.001, lng: c.lng + 0.001,
    match_type: "parcel_centroid", matched_address: `1 TEST ST, TESTVILLE ${zip}`,
    geocode_source: "stub", needs_review: true,
  });
}

/** Canonical stringify — key order never affects the diff. */
function canon(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>; const out: Record<string, unknown> = {};
    for (const k of Object.keys(o).sort()) out[k] = canon(o[k]);
    return out;
  }
  return v;
}

const RUNNERS: Record<string, (z: string, c: unknown[], e: unknown[], d: unknown) => Promise<unknown>> = {
  // deno-lint-ignore no-explicit-any
  socrata: (z, c, e, d) => socrataForZip(z, c as any, e as any, d as any) as any,
  // deno-lint-ignore no-explicit-any
  arcgis: (z, c, e, d) => arcgisForZip(z, c as any, e as any, d as any) as any,
  // deno-lint-ignore no-explicit-any
  ckan: (z, c, e, d) => ckanForZip(z, c as any, e as any, d as any) as any,
  // deno-lint-ignore no-explicit-any
  csv: (z, c, e, d) => csvForZip(z, c as any, e as any, d as any) as any,
  // deno-lint-ignore no-explicit-any
  carto: (z, c, e, d) => cartoForZip(z, c as any, e as any, d as any) as any,
};

const results: unknown[] = [];

for (const g of GOLDEN) {
  const entry = entryFor(g.platform, g.registry_id);
  if (!entry) { results.push({ ...g, error: "registry entry not found" }); continue; }
  const rows = fixtureRows(entry, g.zip);
  const seen = new Set<string>();
  let fetchCount = 0;

  const stubFetch = ((url: string | URL | Request, init?: RequestInit) => {
    const u = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
    fetchCount++;
    const key = u + "|" + String((init?.body as string) ?? "");
    const body = seen.has(key) ? envelope(g.platform, entry, [], g.zip) : envelope(g.platform, entry, rows, g.zip);
    seen.add(key);
    return Promise.resolve(new Response(body, { status: 200, headers: { "content-type": "application/json" } }));
  }) as unknown as typeof fetch;

  const deps = {
    fetch: stubFetch,
    geocode: stubGeocode(g.zip),
    zipCentroid: ZIP_CENTROID[g.zip],
    appToken: undefined,
  };
  const comm = [COMMUNITIES[g.zip]];

  try {
    const out = await RUNNERS[g.platform](g.zip, comm, [entry], deps) as { sites: unknown[]; reports: unknown[] };
    results.push(canon({
      zip: g.zip, platform: g.platform, registry_id: g.registry_id, exercises: g.exercises,
      fetch_calls: fetchCount, site_count: out.sites.length,
      sites: out.sites, reports: out.reports,
    }));
  } catch (e) {
    results.push({ zip: g.zip, platform: g.platform, registry_id: g.registry_id, threw: String(e instanceof Error ? e.message : e) });
  }
}

console.log(JSON.stringify(results, null, 2));
