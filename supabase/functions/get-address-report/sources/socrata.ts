// supabase/functions/get-address-report/sources/socrata.ts
//
// GENERIC Socrata connector — one connector for EVERY Socrata open-data portal.
// Coverage grows by APPENDING an entry to jurisdiction-registry.json, never by editing
// this file. There is deliberately ZERO jurisdiction-specific logic here: no domain, no
// dataset id, no column name, no status string is hardcoded. Everything comes from the
// registry entry passed in. (docs/source-registry.md; brief "Zero-Pay Ingest" Task 1.)
//
// GOVERNANCE (the five rules that never bend — CLAUDE.md §8):
//   • ANTI-FABRICATION: every emitted record carries record_url. Resolution order is
//     column_map.record_url (string, or an object whose .url is used) → record_url_template
//     ({case_number}/{<col>} filled) → the dataset landing page with
//     record_url_precision:"dataset". A record that can produce no URL at all is quarantined,
//     never emitted.
//   • NEVER GUESS CLASSIFICATION: `use_type` comes from type_map[<type_source value>]; an
//     unmapped/absent value → "unclassified". Never inferred from the title.
//   • NEVER GUESS GEOGRAPHY: a record is a precise point ONLY if the row carries lat/lng
//     (geo_precision:"point") or a full street address that geocodes (geo_precision:"address").
//     Otherwise geo_precision:"jurisdiction", lat/lng null — the engine anchors it like any
//     other area item, never a centre-pin.
//   • NEVER GUESS THE BUCKET: status → bucket is an exact (trimmed) lookup in the entry's
//     status_to_bucket. A status in NO bucket → excluded + surfaced in the run report's
//     unmapped_statuses (a human adds it to the map). Blank status → excluded + logged.
//   • QUARANTINE, DON'T STOP: any per-record failure is logged and skipped; the run continues.
//
// SoQL: paged GET on https://{domain}/resource/{dataset_id}.json (or .geojson when
// entry.geographic), $where for the ZIP filter + optional recency window, $limit/$offset
// paging, optional app-token header (SOCRATA_APP_TOKEN) to raise rate limits, 429 back-off.

import { buildGeocodeInput } from "./geo-input.ts";

// ───────────────────────────── types ─────────────────────────────

export type Bucket = "proposed" | "approved" | "operating" | "exclude";

/** One field's source column. A single column name, an array of columns to join with a
 *  space (composite street address), or null/absent when the dataset has no such field. */
export type ColumnRef = string | string[] | null;

export interface ColumnMap {
  title: ColumnRef;
  /** Optional: omit for issuance ledgers with no status column (see entry.status_const). */
  status_raw?: ColumnRef;
  type_source?: ColumnRef;
  file_date?: ColumnRef;
  decision_date?: ColumnRef;
  address?: ColumnRef;
  lat?: ColumnRef;
  lng?: ColumnRef;
  case_number?: ColumnRef;
  zip?: ColumnRef;
  /** A column carrying a per-row official URL (string, or an object with a `.url`). */
  record_url?: ColumnRef;
}

export interface StatusToBucket {
  proposed?: string[];
  approved?: string[];
  operating?: string[];
  exclude?: string[];
}

export interface SocrataRegistryEntry {
  registry_id: string;
  platform: "socrata";
  domain: string;
  dataset_id: string;
  dataset_url: string;
  jurisdiction: string;
  /** OPT-IN: assemble a COMPLETE one-line address before geocoding instead of sending the
   *  bare address column. Set true ONLY for connectors with a bare street-line address the
   *  Census geocoder can't match (verified 2026-07-22). Absent/false ⇒ prior behavior. */
  geocode_assemble?: boolean;
  /** state + county, or state alone for a statewide dataset. The engine additionally
   *  filters to served ZIPs, so a ZIP is never listed here (founder call 2026-07-11). */
  coverage: { state: string; county?: string }[];
  column_map: ColumnMap;
  /** source classification value → Industrial|Development|Residential|Utility. Empty ⇒ all
   *  records are use_type:"unclassified" until a human fills it (query distinct type_source
   *  values first — same discipline as status_to_bucket). */
  type_map?: Record<string, string>;
  status_to_bucket: StatusToBucket;
  /** For issuance ledgers with NO status column: assign this CONSTANT bucket to every row
   *  that carries a non-empty file_date (evidence it was issued). Mirrors the arcgis
   *  connector's status_const. column_map.status_raw may be omitted; a row missing its
   *  file_date is still excluded (never publish a record with no issuance evidence). */
  status_const?: "proposed" | "approved" | "operating";
  /** true → the native zip column is a NUMBER, not text: filter with `zip=<digits>` instead of
   *  `upper(zip)='<zip>'` (upper() on a numeric column is a Socrata type-mismatch 400). Absent/
   *  false ⇒ prior text behavior. Only affects entries with a native zip column (not spatial). */
  zip_numeric?: boolean;
  /** e.g. "https://…/{case_number}". Used only when column_map.record_url is absent. */
  record_url_template?: string;
  record_url_precision?: "record" | "dataset";
  /** false → the entry is NOT run in ZIP-aggregate mode (reserved for the per-address property
   *  page). Default true. Used for high-volume, geocode-heavy datasets (e.g. individual building
   *  permits) that belong at a single address, not a whole-ZIP snapshot. */
  zip_mode?: boolean;
  /** updated-at column for incremental `$where`; also the paging sort key when present. */
  incremental_field?: string;
  /** Optional: drop rows whose file_date/incremental_field is older than N days (volume cap
   *  for high-history permit datasets). Absent ⇒ no recency filter. */
  recency_days?: number;
  /** Optional VERBATIM SoQL predicate replacing the default recency comparison, for datasets
   *  whose date column is TEXT rather than a floating_timestamp. The default clause emits an
   *  ISO literal (`col > '2025-08-02T00:00:00'`), which on a text column compares
   *  LEXICOGRAPHICALLY — so an MM/DD/YYYY column matches NOTHING and the source silently
   *  returns zero rows for every ZIP (nyc-dob-permit-issuance, found 2026-08-02).
   *
   *  Substituted at REQUEST TIME so the window keeps rolling — the whole point of expressing it
   *  here rather than freezing a literal into extra_where, which would age silently:
   *    {cutoff}         → 'YYYY-MM-DD'  (recency_days before today)
   *    {cutoff_compact} → 'YYYYMMDD'
   *  e.g. "(substring(d,7,4)||substring(d,1,2)||substring(d,4,2)) >= '{cutoff_compact}'".
   *  Requires recency_days (which supplies the cutoff). Absent ⇒ default behaviour, unchanged. */
  recency_expr?: string;
  /** Optional VERBATIM SoQL clause ANDed into every query (drop noise types at source —
   *  mirror of the arcgis connector's extra_where). Data, not code. */
  extra_where?: string;
  /** SPATIAL ZIP-scoping for datasets with NO ZIP column (mirror of the arcgis option):
   *  within_circle(spatial_point_col, centroid, ±this many miles). Requires
   *  spatial_point_col and deps.zipCentroid; records keep their own per-parcel points. */
  spatial_zip_radius_mi?: number;
  /** The Socrata Point column within_circle scopes on (e.g. Chicago's `location`). */
  spatial_point_col?: string;
  /** true → fetch `.geojson` (geographic datasets expose geometry). */
  geographic?: boolean;
  /** Optional hard cap on rows pulled per dataset (safety net). Default 20000. */
  max_rows?: number;
}

/** Normalized internal record — the brief's shape, carried through to development_reports.sites.
 *  `type` is the LIFECYCLE bucket the page renders (built|approved|proposed); the mapped source
 *  classification is `use_type` (kept separate so the two never collide). */
export interface NormalizedRecord {
  source_id: string;                 // socrata:{domain}:{dataset_id}:{case_number|:id}
  source_class: string;              // "socrata"
  // NOT `registry_id` — the page reserves that field for the EPA FRS RegistryId (frsRid) and
  // would render any record carrying it with the "Facility · operating now" ECHO popup.
  source_registry_id: string;        // which jurisdiction-registry entry produced this record
  jurisdiction: string;
  label: string;
  title: string;
  use_type: string;                  // Industrial|Development|Residential|Utility|unclassified
  bucket: Exclude<Bucket, "exclude">;
  type: "built" | "approved" | "proposed";   // lifecycle for the page (bucket→type)
  relevance: "development";          // permit/case filings are development by construction
  rel_rule: string;                  // "source:socrata:{registry_id}"
  layer: string;                     // map layer, derived from use_type (never from the title)
  status_raw: string;
  file_date: string | null;
  decision_date: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  scope: "point" | "area";
  geo_precision: "point" | "address" | "jurisdiction";
  zip: string | null;
  case_number: string | null;
  record_url: string;
  record_url_precision: "record" | "dataset";
  // geocode-quality passthrough (present only when this record was geocoded)
  match_type?: string;
  matched_address?: string;
  geocode_source?: string;
  needs_review?: boolean;
}

// An unmapped status is EXCLUDED from the output (it cannot be bucketed correctly) but must
// never vanish silently: `sample` carries the first case/permit number seen with that value so
// the run report names a concrete record a human can look up. Type stays non-fatal by design —
// an unmapped type only degrades the pin shape, it never drops the record.
export interface UnmappedStatus { status: string; count: number; sample?: string | null; }
export interface ExcludedStatus { status: string; count: number; }
// CaseFoldMatch is declared with the shared lookup helpers further down this file.

export interface SocrataRunReport {
  registry_id: string;
  dataset_id: string;
  fetched: number;                   // raw rows pulled (after the ZIP/recency $where)
  emitted: number;                   // records that made it into a band
  excluded_by_status: ExcludedStatus[];   // matched the "exclude" bucket (intended drop)
  unmapped_statuses: UnmappedStatus[];     // status in NO bucket → excluded + FLAGGED
  /** matched a registry key only after case-folding — NON-failing drift note */
  case_insensitive_matches: CaseFoldMatch[];
  blank_status: number;              // rows with no status value → excluded
  geocode_failures: number;          // rows needing geocode that failed → quarantined
  no_record_url: number;             // rows that could produce no URL → quarantined
  quarantined: { reason: string; sample: string }[];
}

export interface SocrataDeps {
  fetch: typeof fetch;
  /** Engine geocode cache (geocode-cache.ts). Returns null on failure → quarantine.
   *  Only called for rows WITHOUT source lat/lng that DO carry a full street address. */
  geocode?: (address: string) => Promise<
    { lat: number; lng: number; match_type?: string; matched_address?: string | null; geocode_source?: string; needs_review?: boolean } | null
  >;
  /** Socrata app token (env SOCRATA_APP_TOKEN) to raise the anonymous rate limit. Optional. */
  appToken?: string;
  /** Polite page size. Default 1000 (Socrata max without token is 1000). */
  pageSize?: number;
  /** ZIP centroid of the report being built — required only by entries using
   *  spatial_zip_radius_mi (the engine passes its home lat/lng). */
  zipCentroid?: { lat: number; lng: number } | null;
}

// ───────────────────────────── engine entry point ─────────────────────────────

export interface SocrataCommunityRow { state?: string | null; county?: string | null; }

/**
 * ZIP-mode entry point — the ONLY function index.ts calls. Additive, coverage-gated.
 *  • COVERAGE GATE: an entry runs for this ZIP only if some resolved community matches its
 *    coverage (state, and county when the entry names one). No match → the entry is skipped.
 *  • ZIP SCOPING: rows are pulled with `$where {zip_col} = '{zip}'` when the entry maps a zip
 *    column; a statewide entry with no zip column is skipped for a ZIP report (logged) rather
 *    than pulling a whole state.
 * Returns the normalized records (all record_url'd) + one run report per dataset actually run.
 */
export async function socrataForZip(
  zip: string,
  communities: SocrataCommunityRow[],
  entries: SocrataRegistryEntry[],
  deps: SocrataDeps,
): Promise<{ sites: NormalizedRecord[]; reports: SocrataRunReport[] }> {
  const sites: NormalizedRecord[] = [];
  const reports: SocrataRunReport[] = [];
  for (const entry of entries) {
    if (entry.platform !== "socrata") continue;
    if (entry.zip_mode === false) continue;                        // reserved for the per-address property page
    if (!coverageMatches(entry.coverage, communities)) continue;   // coverage gate
    const { records, report } = await runEntry(entry, zip, deps);
    sites.push(...records);
    reports.push(report);
  }
  return { sites, reports };
}

/** True iff some community row satisfies an entry coverage clause (state + optional county). */
export function coverageMatches(
  coverage: { state: string; county?: string }[],
  communities: SocrataCommunityRow[],
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
  entry: SocrataRegistryEntry,
  zip: string,
  deps: SocrataDeps,
): Promise<{ records: NormalizedRecord[]; report: SocrataRunReport }> {
  const report: SocrataRunReport = {
    registry_id: entry.registry_id, dataset_id: entry.dataset_id,
    fetched: 0, emitted: 0, excluded_by_status: [], unmapped_statuses: [],
    case_insensitive_matches: [],
    blank_status: 0, geocode_failures: 0, no_record_url: 0, quarantined: [],
  };
  const records: NormalizedRecord[] = [];

  const zipCol = firstCol(entry.column_map.zip);
  const spatial = (entry.spatial_zip_radius_mi ?? 0) > 0;
  if (spatial && (!deps.zipCentroid || !entry.spatial_point_col)) {
    report.quarantined.push({ reason: "spatial_zip_radius_mi set but no zipCentroid/spatial_point_col — skipped", sample: entry.dataset_id });
    return { records, report };
  }
  if (!zipCol && !spatial) {
    report.quarantined.push({ reason: "no zip column mapped — statewide dataset skipped for ZIP report", sample: entry.dataset_id });
    return { records, report };
  }

  // Registry maps are normalized (trim + case-fold) with a collision guard. A collision
  // whose targets differ cannot be resolved → quarantine THIS entry only, so the other
  // sources on the page still ship (the quarantine-don't-stop rule).
  let lookup: NormalizedLookup<Bucket>;
  let typeLookup: NormalizedLookup<string> | null;
  try {
    lookup = buildBucketLookup(entry.status_to_bucket, entry.registry_id);
    typeLookup = buildTypeLookup(entry.type_map, entry.registry_id);
  } catch (e) {
    report.quarantined.push({ reason: `registry map collision: ${(e as Error).message}`, sample: entry.dataset_id });
    return { records, report };
  }
  const excludeCount = new Map<string, number>();
  const unmappedCount = new Map<string, number>();
  const caseFold = new Map<string, CaseFoldMatch>();
  const unmappedSample = new Map<string, string>();   // status → first case/permit no seen

  let rows: Record<string, unknown>[];
  try {
    rows = await fetchRows(entry, zip, zipCol, deps);
  } catch (e) {
    report.quarantined.push({ reason: `fetch failed: ${(e as Error).message}`, sample: entry.dataset_id });
    return { records, report };
  }
  report.fetched = rows.length;

  for (const row of rows) {
    const rawStatus = entry.column_map.status_raw
      ? String(readCol(row, entry.column_map.status_raw) ?? "").trim() : "";
    let statusRaw = rawStatus;
    let bucket: Bucket | undefined;
    if (!rawStatus) {
      // No status value. status_const (issuance-ledger datasets with no status column)
      // assigns a CONSTANT bucket, but ONLY when the row carries a file_date — evidence it
      // was issued. No const, or no file_date → excluded as blank (fail-closed, as before).
      const fileDate = entry.column_map.file_date
        ? String(readCol(row, entry.column_map.file_date) ?? "").trim() : "";
      if (entry.status_const && fileDate) {
        statusRaw = entry.status_const;                                // surface const as the label
        bucket = entry.status_const;
      } else {
        report.blank_status++; continue;                              // blank → exclude + count
      }
    } else {
      const hit = resolveNormalized(lookup, rawStatus);
      bucket = hit.value;
      if (bucket === undefined) {                                      // unmapped → exclude + FLAG
        unmappedCount.set(rawStatus, (unmappedCount.get(rawStatus) ?? 0) + 1);
        // Name a concrete record so the flag is actionable, not just a count.
        if (!unmappedSample.has(rawStatus)) {
          const cn = valOrNull(readCol(row, entry.column_map.case_number));
          if (cn) unmappedSample.set(rawStatus, String(cn));
        }
        continue;
      }
      if (hit.caseInsensitive) noteCaseFold(caseFold, "status", rawStatus, hit.matchedKey);
      if (bucket === "exclude") {                                      // intended drop
        excludeCount.set(rawStatus, (excludeCount.get(rawStatus) ?? 0) + 1);
        continue;
      }
    }

    const rec = await normalizeRow(row, entry, statusRaw, bucket as Exclude<Bucket, "exclude">, deps, report, zip, typeLookup, caseFold);
    if (rec) records.push(rec);
  }

  report.emitted = records.length;
  report.excluded_by_status = [...excludeCount].map(([status, count]) => ({ status, count })).sort((a, b) => b.count - a.count);
  report.unmapped_statuses = [...unmappedCount].map(([status, count]) => ({ status, count, sample: unmappedSample.get(status) ?? null })).sort((a, b) => b.count - a.count);
  report.case_insensitive_matches = caseFoldList(caseFold);
  return { records, report };
}

// GEOCODE geofence constant + distance — kept in lockstep with sources/arcgis.ts
// (GEOCODE_FENCE_MI / milesBetween). A geocoded point farther than this from the report
// ZIP centroid is an untrusted cross-city/state match and is nulled (area scope).
const GEOCODE_FENCE_MI_GEO = 25;
function milesBetweenGeo(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = (lat2 - lat1) * 69;
  const dLng = (lng2 - lng1) * 69 * Math.cos(((lat1 + lat2) / 2) * Math.PI / 180);
  return Math.sqrt(dLat * dLat + dLng * dLng);
}

async function normalizeRow(
  row: Record<string, unknown>,
  entry: SocrataRegistryEntry,
  statusRaw: string,
  bucket: Exclude<Bucket, "exclude">,
  deps: SocrataDeps,
  report: SocrataRunReport,
  reportZip: string | null,
  typeLookup: NormalizedLookup<string> | null,
  caseFold: Map<string, CaseFoldMatch>,
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
  const typeHit = typeLookup && typeSrcVal ? resolveNormalized(typeLookup, typeSrcVal) : null;
  if (typeHit?.caseInsensitive) noteCaseFold(caseFold, "type", typeSrcVal, typeHit.matchedKey);
  const useType = typeHit?.value || "unclassified";

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
    // OPT-IN per registry entry (`geocode_assemble`). OFF ⇒ byte-identical to the prior
    // behavior. ON ⇒ build a COMPLETE one-line address first — a bare street line does not
    // match the Census geocoder (measured). resolveGeocode()/cache/fence unchanged either way.
    const gi = entry.geocode_assemble
      ? buildGeocodeInput({ rawAddress: address, jurisdiction: entry.jurisdiction, state: entry.coverage[0]?.state, zipColValue: valOrNull(readCol(row, cm.zip)), reportZip })
      : { input: address, filedZip: (String(readCol(row, cm.zip) ?? "").match(/\b\d{5}\b/)?.[0]) || reportZip || null };
    const g = await deps.geocode(gi.input);
    if (!g) { report.geocode_failures++; report.quarantined.push({ reason: `geocode failed`, sample: gi.input }); lat = null; lng = null; geoPrecision = "jurisdiction"; scope = "area"; }
    else {
      // GEOFENCE (anti-fabrication) — identical to the arcgis connector. Census
      // range-interpolation can match the same street name in another city/state (live
      // example: a Cincinnati permit rendered in Missouri). Two local checks, no extra
      // lookups; a miss NULLS the coords — the record stays listed as an area item, the
      // untrusted marker is never rendered. Source-supplied coords (the branch above) are
      // NEVER fenced.
      const filedZip = gi.filedZip;   // mapped ZIP col → embedded ZIP → reportZip (same fence, more accurate filed ZIP)
      const matchedZip = ((g.matched_address || "").match(/\b(\d{5})(?:-\d{4})?\s*$/)?.[1]) ?? null;
      const zipMismatch = !!(filedZip && matchedZip && filedZip !== matchedZip);
      const c = deps.zipCentroid;
      const fenceMiles = c ? milesBetweenGeo(c.lat, c.lng, g.lat, g.lng) : null;
      const outOfFence = fenceMiles != null && fenceMiles > GEOCODE_FENCE_MI_GEO;
      if (zipMismatch || outOfFence) {
        report.geocode_failures++;
        report.quarantined.push({
          reason: zipMismatch
            ? `geocode geofence: matched ZIP ${matchedZip} != filed ${filedZip} — coords nulled`
            : `geocode geofence: point ${Math.round(fenceMiles!)} mi from ZIP centroid (> ${GEOCODE_FENCE_MI_GEO}) — coords nulled`,
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
    source_id: `socrata:${entry.domain}:${entry.dataset_id}:${caseNo ?? rowId(row) ?? title}`,
    source_class: "socrata",
    source_registry_id: entry.registry_id,
    jurisdiction: entry.jurisdiction,
    label: (title || caseNo || "Development record").slice(0, 120),
    title,
    use_type: useType,
    bucket,
    type: BUCKET_TO_TYPE[bucket],
    relevance: "development",
    rel_rule: `source:socrata:${entry.registry_id}`,
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

// ───────────────────────────── fetch / SoQL ─────────────────────────────

async function fetchRows(
  entry: SocrataRegistryEntry,
  zip: string,
  zipCol: string,
  deps: SocrataDeps,
): Promise<Record<string, unknown>[]> {
  const pageSize = deps.pageSize ?? 1000;
  const maxRows = entry.max_rows ?? 20000;
  const ext = entry.geographic ? "geojson" : "json";
  const where = buildWhere(entry, zip, zipCol, deps.zipCentroid ?? null);
  const order = entry.incremental_field || ":id";

  const out: Record<string, unknown>[] = [];
  let offset = 0;
  while (out.length < maxRows) {
    const url = new URL(`https://${entry.domain}/resource/${entry.dataset_id}.${ext}`);
    url.searchParams.set("$where", where);
    url.searchParams.set("$order", order);
    url.searchParams.set("$limit", String(pageSize));
    url.searchParams.set("$offset", String(offset));
    const page = await getWithBackoff(url.toString(), deps);
    const rows = entry.geographic ? geojsonRows(page) : (page as Record<string, unknown>[]);
    if (!Array.isArray(rows) || rows.length === 0) break;
    out.push(...rows);
    if (rows.length < pageSize) break;
    offset += pageSize;
  }
  return out.slice(0, maxRows);
}

/** ZIP filter (mandatory) AND'd with an optional entry-driven extra clause and recency window.
 *  SPATIAL ZIP-scoping (entry-driven, mirror of arcgis spatial_zip_radius_mi): datasets with
 *  NO ZIP column but a Socrata Point column (entry.spatial_point_col, e.g. Chicago's
 *  `location`) scope via within_circle around the ZIP centroid — the engine's standard
 *  centroid+radius ZIP approximation. Records keep their OWN per-parcel points. */
function buildWhere(entry: SocrataRegistryEntry, zip: string, zipCol: string, centroid: { lat: number; lng: number } | null): string {
  const spatial = (entry.spatial_zip_radius_mi ?? 0) > 0 && centroid && entry.spatial_point_col;
  const clauses = [spatial
    ? `within_circle(${entry.spatial_point_col}, ${centroid.lat}, ${centroid.lng}, ${Math.round((entry.spatial_zip_radius_mi as number) * 1609.34)})`
    : (entry.zip_numeric
        ? `${zipCol}=${zip.replace(/[^0-9]/g, "")}`               // numeric zip column: no upper(), no quotes
        : `upper(${zipCol})='${zip.replace(/'/g, "''")}'`)];
  // extra_where (additive, data-driven — the arcgis connector's twin): a VERBATIM SoQL
  // clause ANDed into every query, used to drop noise types AT SOURCE (e.g. Seattle's
  // ECA/street-exception and roof permits). The connector never inspects it.
  if (entry.extra_where && entry.extra_where.trim()) clauses.push(`(${entry.extra_where.trim()})`);
  if (entry.recency_days && entry.recency_days > 0) {
    const cutoff = new Date(Date.now() - entry.recency_days * 86400000).toISOString().slice(0, 10);
    // TEXT-DATE ESCAPE HATCH: the default comparison below emits an ISO literal, which on a text
    // column compares lexicographically and can silently match nothing. An entry whose date column
    // is text supplies its own predicate; the cutoff is still computed here, so the window rolls.
    if (entry.recency_expr && entry.recency_expr.trim()) {
      clauses.push(entry.recency_expr.trim()
        .replaceAll("{cutoff_compact}", cutoff.replaceAll("-", ""))
        .replaceAll("{cutoff}", cutoff));
    } else {
      const dateCol = firstCol(entry.column_map.file_date) || entry.incremental_field;
      if (dateCol) clauses.push(`${dateCol} > '${cutoff}T00:00:00'`);
    }
  }
  return clauses.join(" AND ");
}

async function getWithBackoff(url: string, deps: SocrataDeps): Promise<unknown> {
  const headers: Record<string, string> = { "Accept": "application/json", "User-Agent": "HomeSignal public-records refresh (contact: admin@homesignal.net)" };
  if (deps.appToken) headers["X-App-Token"] = deps.appToken;
  let delay = 800;
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await deps.fetch(url, { headers, signal: AbortSignal.timeout(30000) });
    if (res.status === 429 || res.status >= 500) { await sleep(delay); delay *= 2; continue; }   // back off
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.json();
  }
  throw new Error(`rate-limited/5xx after retries: ${url}`);
}

function geojsonRows(page: unknown): Record<string, unknown>[] {
  const feats = (page as { features?: { properties?: Record<string, unknown>; geometry?: { coordinates?: [number, number] } }[] })?.features;
  if (!Array.isArray(feats)) return [];
  // flatten geometry into properties so the column_map can read lat/lng uniformly
  return feats.map((f) => {
    const p = { ...(f.properties ?? {}) } as Record<string, unknown>;
    const c = f.geometry?.coordinates;
    if (Array.isArray(c) && c.length >= 2) { p.__lng = c[0]; p.__lat = c[1]; }
    return p;
  });
}

// ───────────────────────────── discovery (seeding assistant) ─────────────────────────────

/** Discovery API — PROPOSES candidate datasets for a domain; a human confirms them into the
 *  registry. Never auto-ingests. (brief Task 1: "Discovery proposes, the registry disposes.") */
export async function discoverDatasets(
  domain: string,
  terms: string[],
  deps: SocrataDeps,
): Promise<{ id: string; name: string; url: string; term: string }[]> {
  const out: { id: string; name: string; url: string; term: string }[] = [];
  const seen = new Set<string>();
  for (const term of terms) {
    const url = `https://api.us.socrata.com/api/catalog/v1?domains=${encodeURIComponent(domain)}&q=${encodeURIComponent(term)}&limit=30`;
    try {
      const data = await getWithBackoff(url, deps) as { results?: { resource?: { id?: string; name?: string } }[] };
      for (const r of data.results ?? []) {
        const id = r.resource?.id; if (!id || seen.has(id)) continue; seen.add(id);
        out.push({ id, name: r.resource?.name ?? "", url: `https://${domain}/d/${id}`, term });
      }
    } catch { /* discovery is best-effort — never blocks a run */ }
  }
  return out;
}

// ───────────────────────────── helpers ─────────────────────────────

const BUCKET_TO_TYPE: Record<Exclude<Bucket, "exclude">, "built" | "approved" | "proposed"> = {
  operating: "built", approved: "approved", proposed: "proposed",
};

/** Map layer from the (already source-derived) classification — never from the title.
 *  Use-types: Industrial | Development | Residential | Utility | Commercial | Civic/Public. */
function layerFor(useType: string): string {
  switch (useType.toLowerCase()) {
    case "industrial": return "industrial";
    case "utility": return "energy";
    case "residential": return "residential";
    case "commercial": return "commercial";
    case "civic/public": return "civic";
    default: return "development";     // Development / unclassified → neutral
  }
}

// ─────────────── SHARED normalized map lookup (status_to_bucket + type_map) ───────────────
// Used by all five connectors (socrata / arcgis / ckan / carto / csv) so one normalization
// rule governs every registry map. Both sides of the comparison are trimmed AND case-folded,
// the same normalization `coverageMatches` above already applies to state/county.
//
// WHY: the lookup used to be exact-after-trim, so a publisher that changed the CASE of a
// status value (Denver's residential CLASS: 'New Building' → 'NEW BUILDING') silently
// dropped every record — the fail-closed path is correct about unmapped values but a
// case-only difference is the SAME value, not a new one.
//
// An EXACT hit is still preferred; the case-folded map is the fallback, and a hit that only
// matched case-insensitively is NOTED on the run report (non-failing) so the drift is
// visible rather than invisibly absorbed.
//
// COLLISION GUARD: if two keys of one map collapse to the same normalized form AND point at
// different targets, the lookup cannot choose — that throws at build time (the caller
// quarantines the entry, so one bad map never blanks the other sources on the page). A
// collapse onto the SAME target is benign (some registry maps enumerate case variants
// defensively) and keeps first-wins. `test/registry-map-collisions.test.mjs` asserts the
// live registry is collision-free, so a new one goes red in CI before it can ship.

export function normKey(s: unknown): string { return String(s ?? "").trim().toLowerCase(); }

export interface NormalizedLookup<T> {
  /** trimmed registry key → value (exact match, the pre-existing behavior) */
  exact: Map<string, T>;
  /** trimmed + lowercased registry key → value */
  folded: Map<string, T>;
  /** normalized key → the registry key it came from (for the case-fold note) */
  origin: Map<string, string>;
}

export class RegistryMapCollisionError extends Error {
  constructor(message: string) { super(message); this.name = "RegistryMapCollisionError"; }
}

export function buildNormalizedLookup<T>(
  pairs: Iterable<[string, T]>,
  mapName: string,
  registryId: string,
): NormalizedLookup<T> {
  const exact = new Map<string, T>();
  const folded = new Map<string, T>();
  const origin = new Map<string, string>();
  for (const [rawKey, value] of pairs) {
    const k = String(rawKey).trim();
    if (!exact.has(k)) exact.set(k, value);            // first wins (unchanged)
    const nk = k.toLowerCase();
    if (folded.has(nk)) {
      const prev = folded.get(nk) as T;
      if (prev !== value) {
        throw new RegistryMapCollisionError(
          `${registryId}: ${mapName} keys ${JSON.stringify(origin.get(nk))} and ${JSON.stringify(k)} ` +
          `collapse to the same normalized form ${JSON.stringify(nk)} but map to different values ` +
          `(${JSON.stringify(String(prev))} vs ${JSON.stringify(String(value))}). Case-insensitive ` +
          `lookup cannot choose between them — fix the registry map.`,
        );
      }
      continue;                                        // same target → benign, first wins
    }
    folded.set(nk, value);
    origin.set(nk, k);
  }
  return { exact, folded, origin };
}

/** status → bucket. Later buckets don't override earlier ones (a status should appear in
 *  exactly one; if duplicated, first wins and the map should be fixed). */
export function buildBucketLookup(s2b: StatusToBucket, registryId = "?"): NormalizedLookup<Bucket> {
  const pairs: [string, Bucket][] = [];
  (["proposed", "approved", "operating", "exclude"] as Bucket[]).forEach((b) => {
    for (const status of s2b[b] ?? []) pairs.push([status, b]);
  });
  return buildNormalizedLookup(pairs, "status_to_bucket", registryId);
}

/** type_source value → use_type. null when the entry declares no type_map (→ unclassified). */
export function buildTypeLookup(
  typeMap: Record<string, string> | undefined,
  registryId = "?",
): NormalizedLookup<string> | null {
  if (!typeMap) return null;
  return buildNormalizedLookup(Object.entries(typeMap), "type_map", registryId);
}

export function resolveNormalized<T>(
  lk: NormalizedLookup<T>,
  raw: string,
): { value: T | undefined; caseInsensitive: boolean; matchedKey: string | null } {
  const k = raw.trim();
  if (lk.exact.has(k)) return { value: lk.exact.get(k), caseInsensitive: false, matchedKey: k };
  const nk = k.toLowerCase();
  if (lk.folded.has(nk)) {
    return { value: lk.folded.get(nk), caseInsensitive: true, matchedKey: lk.origin.get(nk) ?? null };
  }
  return { value: undefined, caseInsensitive: false, matchedKey: null };
}

/** Non-failing note: this live value matched a registry key only after case-folding. */
export interface CaseFoldMatch {
  field: "status" | "type";
  value: string;        // the LIVE value as the source published it
  matched_key: string;  // the registry key it matched case-insensitively
  count: number;
}

export function noteCaseFold(
  m: Map<string, CaseFoldMatch>,
  field: "status" | "type",
  value: string,
  matchedKey: string | null,
): void {
  // NUL is written as an escape, never a raw byte: a literal 0x00 makes this file
  // "binary" to grep/file, which then SKIP it silently without -a — "no match" and
  // "did not run" become indistinguishable on a file every audit searches.
  const key = `${field}\u0000${value}\u0000${matchedKey ?? ""}`;
  const cur = m.get(key);
  if (cur) { cur.count++; return; }
  m.set(key, { field, value, matched_key: matchedKey ?? "", count: 1 });
}

export function caseFoldList(m: Map<string, CaseFoldMatch>): CaseFoldMatch[] {
  return [...m.values()].sort((a, b) => b.count - a.count);
}

function firstCol(ref?: ColumnRef): string | null {
  if (!ref) return null;
  return Array.isArray(ref) ? (ref[0] ?? null) : ref;
}

/** Read a mapped column: a single value, or an array of columns joined by spaces. */
function readCol(row: Record<string, unknown>, ref?: ColumnRef): unknown {
  if (!ref) return undefined;
  if (Array.isArray(ref)) {
    const parts = ref.map((c) => row[c]).filter((v) => v != null && String(v).trim() !== "").map((v) => String(v).trim());
    return parts.length ? parts.join(" ") : undefined;
  }
  // Dot-path support for Socrata `location`-type columns (e.g. Montgomery County MD's
  // nested location.latitude/location.longitude). An exact column of that name always
  // wins; the path walk only runs when no such column exists. Additive — flat refs and
  // every existing entry behave byte-identically.
  if (row[ref] === undefined && ref.includes(".")) {
    let v: unknown = row;
    for (const seg of ref.split(".")) {
      if (v == null || typeof v !== "object") return undefined;
      v = (v as Record<string, unknown>)[seg];
    }
    return v;
  }
  return row[ref];
}

/** record_url column may be a bare string or a Socrata URL object {url:"…"}. */
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
  const id = row[":id"] ?? row["id"];
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

/** Any ISO-ish or date string → YYYY-MM-DD, else null (absent stays absent). */
function isoDay(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const md = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (md) return `${md[3]}-${md[1].padStart(2, "0")}-${md[2].padStart(2, "0")}`;
  return null;
}

function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }
