// supabase/functions/get-address-report/sources/arcgis.ts
//
// GENERIC ArcGIS FeatureServer connector — one connector for EVERY ArcGIS/Esri open-data
// layer. Coverage grows by APPENDING an entry to jurisdiction-registry.json's `arcgis`
// array, never by editing this file. There is deliberately ZERO jurisdiction-specific
// logic here: no service host, no field name, no status string is hardcoded. Everything
// comes from the registry entry passed in. This is the ArcGIS twin of sources/socrata.ts
// and shares its NormalizedRecord shape + governance verbatim (docs/source-registry.md).
//
// GOVERNANCE (the five rules that never bend — CLAUDE.md §8), identical to socrata.ts:
//   • ANTI-FABRICATION: every emitted record carries record_url (column → template →
//     dataset landing page). A record that can produce no URL is quarantined, never emitted.
//   • NEVER GUESS CLASSIFICATION: use_type = type_map[<type_source>], else "unclassified".
//   • NEVER GUESS GEOGRAPHY: a precise point ONLY if the row carries lat/lng (mapped column
//     or the feature geometry, flattened to __lat/__lng) or a full street address that
//     geocodes. Otherwise geo_precision:"jurisdiction", lat/lng null — anchored like any area
//     item, never a centre-pin.
//   • NEVER GUESS THE BUCKET: status → bucket is an exact (trimmed) lookup; a status in NO
//     bucket → excluded + surfaced in the run report (a human adds it). Blank status → excluded.
//   • QUARANTINE, DON'T STOP: any per-record failure is logged and skipped; the run continues.
//
// ArcGIS REST: paged GET on {service_url}/query?where=<zip filter>&outFields=*&f=json&
// outSR=4326, resultOffset/resultRecordCount paging, exceededTransferLimit honored. Point
// geometry {x:lng,y:lat} is flattened into __lng/__lat so the column_map reads it uniformly.

import type {
  Bucket, ColumnMap, ColumnRef, NormalizedRecord, StatusToBucket,
  ExcludedStatus, UnmappedStatus,
} from "./socrata.ts";

// ───────────────────────────── registry entry + types ─────────────────────────────

export interface ArcgisRegistryEntry {
  registry_id: string;
  platform: "arcgis";
  /** The FeatureServer LAYER query base, e.g.
   *  "https://services6.arcgis.com/ABC/arcgis/rest/services/Permits/FeatureServer/0". */
  service_url: string;
  /** Human landing page; the record_url fallback when no per-row URL is derivable. */
  dataset_url: string;
  jurisdiction: string;
  coverage: { state: string; county?: string }[];
  column_map: ColumnMap;
  type_map?: Record<string, string>;
  status_to_bucket: StatusToBucket;
  record_url_template?: string;
  record_url_precision?: "record" | "dataset";
  /** false → not run in ZIP-aggregate mode. Default true. */
  zip_mode?: boolean;
  /** updated-at column for incremental `where`; also the paging sort key when present. */
  incremental_field?: string;
  /** drop rows whose file_date/incremental_field is older than N days. Absent ⇒ no filter. */
  recency_days?: number;
  /** hard cap on rows pulled per dataset. Default 20000. */
  max_rows?: number;
  /** output spatial reference for geometry; default 4326 (WGS84 lat/lng). */
  out_sr?: number;
  /** Optional VERBATIM SQL clause AND'd into every query (entry-driven scoping — e.g. drop
   *  administrative-paperwork subtypes). Data, not code: the connector never inspects it. */
  extra_where?: string;
  /** Dataset-level status for issued-ledger layers that carry NO status column (e.g. Detroit
   *  BSEED: the layer publishes issuances only, so every row IS an issued permit). Applied
   *  verbatim as each row's status_raw and bucketed through status_to_bucket like any live
   *  value. Pair it with an extra_where guard on the row-level fact that backs the constant
   *  (e.g. `issued_date IS NOT NULL`) so it never outruns the data. Never use it to override
   *  a real status column — entries that have one keep mapping it. */
  status_const?: string;
  /** Optional ZIP-scoping override for layers with NO ZIP column but a ZIP embedded in a text
   *  field (e.g. a full "…, UT 84604" address). A VERBATIM SQL template with a `{zip}` token,
   *  used as the ZIP clause INSTEAD of `{zip_col}='{zip}'` (e.g.
   *  "Address LIKE '%UT {zip}%'"). When present, column_map.zip is not required. The point
   *  geometry still supplies the precise location; this only scopes which rows the ZIP pulls. */
  zip_where_template?: string;
  /** SPATIAL ZIP-scoping for point layers with NO ZIP column and no ZIP anywhere in a text
   *  field (e.g. Denver's construction-permit layers: ADDRESS has no ZIP). Queries an
   *  ArcGIS envelope of ± this many miles around the ZIP centroid (deps.zipCentroid) — the
   *  engine's standard centroid+radius ZIP approximation (same shape as the EPA FRS floor
   *  and ZIP_RADIUS_MI). Records still place by their OWN per-parcel geometry; nothing is
   *  guessed. When present, column_map.zip / zip_where_template are not required. */
  spatial_zip_radius_mi?: number;
}

export interface ArcgisRunReport {
  registry_id: string;
  service_url: string;
  fetched: number;
  emitted: number;
  excluded_by_status: ExcludedStatus[];
  unmapped_statuses: UnmappedStatus[];
  blank_status: number;
  geocode_failures: number;
  no_record_url: number;
  quarantined: { reason: string; sample: string }[];
}

export interface ArcgisDeps {
  fetch: typeof fetch;
  /** Engine geocode cache (geocode-cache.ts). Returns null on failure → quarantine. Only
   *  called for rows WITHOUT source lat/lng that DO carry a full street address. */
  geocode?: (address: string) => Promise<
    { lat: number; lng: number; match_type?: string; matched_address?: string | null; geocode_source?: string; needs_review?: boolean } | null
  >;
  /** Polite page size. Default 1000. */
  pageSize?: number;
  /** ZIP centroid of the report being built — required only by entries using
   *  spatial_zip_radius_mi (the engine passes its home lat/lng). */
  zipCentroid?: { lat: number; lng: number } | null;
}

export interface ArcgisCommunityRow { state?: string | null; county?: string | null; }

// ───────────────────────────── engine entry point ─────────────────────────────

/**
 * ZIP-mode entry point — the ONLY function index.ts calls (twin of socrataForZip).
 *  • COVERAGE GATE: runs for this ZIP only if some resolved community matches the entry's
 *    coverage (state, and county when named). No match → skipped.
 *  • ZIP SCOPING: rows pulled with `where {zip_col}='{zip}'`; an entry with no zip column is
 *    skipped for a ZIP report (logged), never a whole-state pull.
 */
export async function arcgisForZip(
  zip: string,
  communities: ArcgisCommunityRow[],
  entries: ArcgisRegistryEntry[],
  deps: ArcgisDeps,
): Promise<{ sites: NormalizedRecord[]; reports: ArcgisRunReport[] }> {
  const sites: NormalizedRecord[] = [];
  const reports: ArcgisRunReport[] = [];
  for (const entry of entries) {
    if (entry.platform !== "arcgis") continue;
    if (entry.zip_mode === false) continue;
    if (!coverageMatches(entry.coverage, communities)) continue;
    const { records, report } = await runEntry(entry, zip, deps);
    sites.push(...records);
    reports.push(report);
  }
  return { sites, reports };
}

/** True iff some community row satisfies an entry coverage clause (state + optional county). */
export function coverageMatches(
  coverage: { state: string; county?: string }[],
  communities: ArcgisCommunityRow[],
): boolean {
  const norm = (s?: string | null) => (s || "").trim().toLowerCase();
  return coverage.some((cov) =>
    communities.some((c) =>
      norm(c.state) === norm(cov.state) &&
      (!cov.county || norm(c.county) === norm(cov.county))
    )
  );
}

// ───────────────────────────── per-entry run ─────────────────────────────

async function runEntry(
  entry: ArcgisRegistryEntry,
  zip: string,
  deps: ArcgisDeps,
): Promise<{ records: NormalizedRecord[]; report: ArcgisRunReport }> {
  const report: ArcgisRunReport = {
    registry_id: entry.registry_id, service_url: entry.service_url,
    fetched: 0, emitted: 0, excluded_by_status: [], unmapped_statuses: [],
    blank_status: 0, geocode_failures: 0, no_record_url: 0, quarantined: [],
  };
  const records: NormalizedRecord[] = [];

  const zipCol = firstCol(entry.column_map.zip);
  const spatial = (entry.spatial_zip_radius_mi ?? 0) > 0;
  if (spatial && !deps.zipCentroid) {
    report.quarantined.push({ reason: "spatial_zip_radius_mi set but no zipCentroid provided — skipped", sample: entry.service_url });
    return { records, report };
  }
  if (!zipCol && !entry.zip_where_template && !spatial) {
    report.quarantined.push({ reason: "no zip column mapped and no zip_where_template — statewide dataset skipped for ZIP report", sample: entry.service_url });
    return { records, report };
  }

  const lookup = buildBucketLookup(entry.status_to_bucket);
  const excludeCount = new Map<string, number>();
  const unmappedCount = new Map<string, number>();

  let rows: Record<string, unknown>[];
  try {
    rows = await fetchRows(entry, zip, zipCol ?? "", deps);
  } catch (e) {
    report.quarantined.push({ reason: `fetch failed: ${(e as Error).message}`, sample: entry.service_url });
    return { records, report };
  }
  report.fetched = rows.length;

  for (const row of rows) {
    const statusRaw = String(entry.status_const ?? readCol(row, entry.column_map.status_raw) ?? "").trim();
    if (!statusRaw) { report.blank_status++; continue; }
    const bucket = lookup.get(statusRaw);
    if (bucket === undefined) { unmappedCount.set(statusRaw, (unmappedCount.get(statusRaw) ?? 0) + 1); continue; }
    if (bucket === "exclude") { excludeCount.set(statusRaw, (excludeCount.get(statusRaw) ?? 0) + 1); continue; }
    const rec = await normalizeRow(row, entry, statusRaw, bucket, zip, deps, report);
    if (rec) records.push(rec);
  }

  report.emitted = records.length;
  report.excluded_by_status = [...excludeCount].map(([status, count]) => ({ status, count })).sort((a, b) => b.count - a.count);
  report.unmapped_statuses = [...unmappedCount].map(([status, count]) => ({ status, count })).sort((a, b) => b.count - a.count);
  return { records, report };
}

async function normalizeRow(
  row: Record<string, unknown>,
  entry: ArcgisRegistryEntry,
  statusRaw: string,
  bucket: Exclude<Bucket, "exclude">,
  reportZip: string,
  deps: ArcgisDeps,
  report: ArcgisRunReport,
): Promise<NormalizedRecord | null> {
  const cm = entry.column_map;
  const title = String(readCol(row, cm.title) ?? "").trim();
  const caseNo = valOrNull(readCol(row, cm.case_number));

  // record_url (anti-fabrication): column → template → dataset landing page.
  let recordUrl = extractUrl(readCol(row, cm.record_url));
  let precision: "record" | "dataset" = entry.record_url_precision ?? "record";
  if (!recordUrl && entry.record_url_template) recordUrl = fillTemplate(entry.record_url_template, row, caseNo);
  if (!recordUrl) { recordUrl = entry.dataset_url; precision = "dataset"; }
  if (!recordUrl) { report.no_record_url++; report.quarantined.push({ reason: "no record_url derivable", sample: title || caseNo || "??" }); return null; }

  // classification (never from the title)
  const typeSrcVal = String(readCol(row, cm.type_source) ?? "").trim();
  const useType = (entry.type_map && typeSrcVal && entry.type_map[typeSrcVal]) || "unclassified";

  // geography: source coords → point; else geocode a full address → address; else jurisdiction.
  let lat = numOrNull(readCol(row, cm.lat));
  let lng = numOrNull(readCol(row, cm.lng));
  const address = valOrNull(readCol(row, cm.address));
  let geoPrecision: NormalizedRecord["geo_precision"];
  let scope: "point" | "area";
  const geoQuality: Partial<NormalizedRecord> = {};
  if (lat != null && lng != null) {
    geoPrecision = "point"; scope = "point";
  } else if (address && deps.geocode) {
    const g = await deps.geocode(address);
    if (!g) { report.geocode_failures++; report.quarantined.push({ reason: "geocode failed", sample: address }); lat = null; lng = null; geoPrecision = "jurisdiction"; scope = "area"; }
    else {
      // GEOFENCE (anti-fabrication): a geocoded point is trusted only when the geocoder's
      // own output agrees with where the record is filed. Census range-interpolation can
      // match the same street name in another city/state (live example: a Fort Worth permit
      // rendered in Michigan). Two local checks, no extra lookups; a miss NULLS the coords —
      // the record stays listed as an area item, the untrusted marker is never rendered.
      const filedZip = (String(readCol(row, cm.zip) ?? "").match(/\b\d{5}\b/)?.[0]) || reportZip || null;
      const matchedZip = ((g.matched_address || "").match(/\b(\d{5})(?:-\d{4})?\s*$/)?.[1]) ?? null;
      const zipMismatch = !!(filedZip && matchedZip && filedZip !== matchedZip);
      const c = deps.zipCentroid;
      const fenceMiles = c ? milesBetween(c.lat, c.lng, g.lat, g.lng) : null;
      const outOfFence = fenceMiles != null && fenceMiles > GEOCODE_FENCE_MI;
      if (zipMismatch || outOfFence) {
        report.geocode_failures++;
        report.quarantined.push({
          reason: zipMismatch
            ? `geocode geofence: matched ZIP ${matchedZip} != filed ${filedZip} — coords nulled`
            : `geocode geofence: point ${Math.round(fenceMiles!)} mi from ZIP centroid (> ${GEOCODE_FENCE_MI}) — coords nulled`,
          sample: address,
        });
        lat = null; lng = null; geoPrecision = "jurisdiction"; scope = "area";
      } else {
        lat = g.lat; lng = g.lng; geoPrecision = "address"; scope = "point";
        if (g.match_type) geoQuality.match_type = g.match_type;
        if (g.matched_address) geoQuality.matched_address = g.matched_address;
        if (g.geocode_source) geoQuality.geocode_source = g.geocode_source;
        if (g.needs_review !== undefined) geoQuality.needs_review = g.needs_review;
      }
    }
  } else {
    geoPrecision = "jurisdiction"; scope = "area"; lat = null; lng = null;
  }

  const rec: NormalizedRecord = {
    source_id: `arcgis:${entry.registry_id}:${caseNo ?? rowId(row) ?? title}`,
    source_class: "arcgis",
    source_registry_id: entry.registry_id,
    jurisdiction: entry.jurisdiction,
    label: (title || caseNo || "Development record").slice(0, 120),
    title,
    use_type: useType,
    bucket,
    type: BUCKET_TO_TYPE[bucket],
    relevance: "development",
    rel_rule: `source:arcgis:${entry.registry_id}`,
    layer: layerFor(useType),
    status_raw: statusRaw,
    file_date: isoDay(readCol(row, cm.file_date)),
    decision_date: isoDay(readCol(row, cm.decision_date)),
    address,
    lat, lng, scope, geo_precision: geoPrecision,
    zip: valOrNull(readCol(row, cm.zip)),
    case_number: caseNo,
    record_url: recordUrl,
    record_url_precision: precision,
    ...geoQuality,
  };
  return rec;
}

// ───────────────────────────── fetch / ArcGIS REST ─────────────────────────────

async function fetchRows(
  entry: ArcgisRegistryEntry,
  zip: string,
  zipCol: string,
  deps: ArcgisDeps,
): Promise<Record<string, unknown>[]> {
  const pageSize = deps.pageSize ?? 1000;
  const maxRows = entry.max_rows ?? 20000;
  const outSr = entry.out_sr ?? 4326;
  const where = buildWhere(entry, zip, zipCol);
  const orderBy = entry.incremental_field ? `${entry.incremental_field} DESC` : "";

  // Spatial ZIP scoping (entry-driven): an envelope of ±radius miles around the ZIP centroid,
  // for point layers with no ZIP attribute anywhere. Standard ArcGIS spatial query params.
  const spatial = (entry.spatial_zip_radius_mi ?? 0) > 0 && deps.zipCentroid ? {
    ...envelopeFor(deps.zipCentroid.lat, deps.zipCentroid.lng, entry.spatial_zip_radius_mi as number),
  } : null;

  const out: Record<string, unknown>[] = [];
  let offset = 0;
  while (out.length < maxRows) {
    const url = new URL(`${entry.service_url.replace(/\/$/, "")}/query`);
    url.searchParams.set("where", where);
    if (spatial) {
      url.searchParams.set("geometry", `${spatial.xmin},${spatial.ymin},${spatial.xmax},${spatial.ymax}`);
      url.searchParams.set("geometryType", "esriGeometryEnvelope");
      url.searchParams.set("inSR", "4326");
      url.searchParams.set("spatialRel", "esriSpatialRelIntersects");
    }
    url.searchParams.set("outFields", "*");
    url.searchParams.set("returnGeometry", "true");
    url.searchParams.set("outSR", String(outSr));
    url.searchParams.set("resultOffset", String(offset));
    url.searchParams.set("resultRecordCount", String(pageSize));
    if (orderBy) url.searchParams.set("orderByFields", orderBy);
    url.searchParams.set("f", "json");
    const page = await getWithBackoff(url.toString(), deps) as {
      features?: { attributes?: Record<string, unknown>; geometry?: { x?: number; y?: number } }[];
      exceededTransferLimit?: boolean;
      error?: { message?: string };
    };
    if (page?.error) throw new Error(`ArcGIS error: ${page.error.message ?? "unknown"}`);
    const feats = Array.isArray(page?.features) ? page.features : [];
    if (feats.length === 0) break;
    for (const f of feats) {
      const row = { ...(f.attributes ?? {}) } as Record<string, unknown>;
      // flatten point geometry so a column_map can read lat/lng from __lat/__lng (mirrors
      // the socrata geojson flatten). ArcGIS point geometry with outSR=4326 is {x:lng,y:lat}.
      if (f.geometry && typeof f.geometry.x === "number" && typeof f.geometry.y === "number") {
        row.__lng = f.geometry.x; row.__lat = f.geometry.y;
      }
      out.push(row);
    }
    if (feats.length < pageSize || page.exceededTransferLimit === false) break;
    offset += pageSize;
  }
  return out.slice(0, maxRows);
}

/** ZIP filter (mandatory) AND'd with an optional recency window (ArcGIS DATE literal). */
function buildWhere(entry: ArcgisRegistryEntry, zip: string, zipCol: string): string {
  // ArcGIS SQL string equality; the ZIP is a 5-digit code (safe chars only). Escape quotes.
  const safeZip = zip.replace(/'/g, "''");
  // ZIP scoping: a `zip_where_template` (verbatim, {zip}-substituted) wins for layers whose ZIP
  // lives in a text field; otherwise the default `{zipCol}='{zip}'` exact match on a ZIP column.
  // A spatial_zip_radius_mi entry scopes via the envelope query params instead (fetchRows), so
  // its WHERE carries only the extra/recency clauses.
  const zipClause = (entry.spatial_zip_radius_mi ?? 0) > 0
    ? "1=1"
    : entry.zip_where_template && entry.zip_where_template.trim()
      ? entry.zip_where_template.replaceAll("{zip}", safeZip)
      : `${zipCol}='${safeZip}'`;
  const clauses = [zipClause];
  if (entry.extra_where && entry.extra_where.trim()) clauses.push(`(${entry.extra_where.trim()})`);
  if (entry.recency_days && entry.recency_days > 0) {
    const dateCol = firstCol(entry.column_map.file_date) || entry.incremental_field;
    if (dateCol) {
      const cutoff = new Date(Date.now() - entry.recency_days * 86400000).toISOString().slice(0, 10);
      clauses.push(`${dateCol} >= DATE '${cutoff}'`);
    }
  }
  return clauses.join(" AND ");
}

async function getWithBackoff(url: string, deps: ArcgisDeps): Promise<unknown> {
  const headers: Record<string, string> = { "Accept": "application/json", "User-Agent": "HomeSignal public-records refresh (contact: admin@homesignal.net)" };
  let delay = 800;
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await deps.fetch(url, { headers, signal: AbortSignal.timeout(30000) });
    if (res.status === 429 || res.status >= 500) { await sleep(delay); delay *= 2; continue; }
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.json();
  }
  throw new Error(`rate-limited/5xx after retries: ${url}`);
}

// ───────────────────────────── helpers (mirror socrata.ts, kept local so that file is untouched) ─────────────────────────────

const BUCKET_TO_TYPE: Record<Exclude<Bucket, "exclude">, "built" | "approved" | "proposed"> = {
  operating: "built", approved: "approved", proposed: "proposed",
};

function layerFor(useType: string): string {
  switch (useType.toLowerCase()) {
    case "industrial": return "industrial";
    case "utility": return "energy";
    case "residential": return "residential";
    case "commercial": return "commercial";
    case "civic/public": return "civic";
    default: return "development";
  }
}

function buildBucketLookup(s2b: StatusToBucket): Map<string, Bucket> {
  const m = new Map<string, Bucket>();
  (["proposed", "approved", "operating", "exclude"] as Bucket[]).forEach((b) => {
    for (const status of s2b[b] ?? []) { const k = status.trim(); if (!m.has(k)) m.set(k, b); }
  });
  return m;
}

function firstCol(ref?: ColumnRef): string | null {
  if (!ref) return null;
  return Array.isArray(ref) ? (ref[0] ?? null) : ref;
}

function readCol(row: Record<string, unknown>, ref?: ColumnRef): unknown {
  if (!ref) return undefined;
  if (Array.isArray(ref)) {
    const parts = ref.map((c) => row[c]).filter((v) => v != null && String(v).trim() !== "").map((v) => String(v).trim());
    return parts.length ? parts.join(" ") : undefined;
  }
  return row[ref];
}

function extractUrl(v: unknown): string {
  if (!v) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "object" && v !== null && typeof (v as { url?: unknown }).url === "string") return String((v as { url: string }).url).trim();
  return "";
}

function fillTemplate(tpl: string, row: Record<string, unknown>, caseNo: string | null): string {
  return tpl.replace(/\{(\w+)\}/g, (_m, key) => {
    if (key === "case_number") return caseNo ?? "";
    const v = row[key];
    return v == null ? "" : String(v);
  });
}

function rowId(row: Record<string, unknown>): string | null {
  const id = row["FID"] ?? row["OBJECTID"] ?? row["ObjectId"] ?? row[":id"] ?? row["id"];
  return id == null ? null : String(id);
}

function valOrNull(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function numOrNull(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Any ISO-ish or date string, or an ArcGIS epoch-millis number → YYYY-MM-DD, else null. */
function isoDay(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "number" && Number.isFinite(v)) {
    // ArcGIS dates are epoch milliseconds.
    const d = new Date(v);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const md = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (md) return `${md[3]}-${md[1].padStart(2, "0")}-${md[2].padStart(2, "0")}`;
  if (/^\d{13}$/.test(s)) { const d = new Date(Number(s)); if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10); }
  return null;
}

function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }

/** WGS84 envelope of ±radius miles around a point (1° lat ≈ 69 mi; lng scaled by cos(lat)). */
export function envelopeFor(lat: number, lng: number, radiusMi: number): { xmin: number; ymin: number; xmax: number; ymax: number } {
  const dLat = radiusMi / 69;
  const dLng = radiusMi / (69 * Math.max(Math.cos(lat * Math.PI / 180), 0.1));
  return { xmin: lng - dLng, ymin: lat - dLat, xmax: lng + dLng, ymax: lat + dLat };
}

/** Geofence for GEOCODED points (source-supplied geometry is never fenced): a Census
 *  interpolation landing farther than this from the report's ZIP centroid cannot be an
 *  address inside that ZIP — the coords are nulled, the record stays listed (area scope). */
export const GEOCODE_FENCE_MI = 25;

/** Equirectangular distance in miles — plenty at fence scale. */
export function milesBetween(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = (lat2 - lat1) * 69;
  const dLng = (lng2 - lng1) * 69 * Math.cos(((lat1 + lat2) / 2) * Math.PI / 180);
  return Math.sqrt(dLat * dLat + dLng * dLng);
}
