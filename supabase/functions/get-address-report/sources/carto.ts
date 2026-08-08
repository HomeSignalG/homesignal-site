// Carto SQL-API connector — the generic per-record reader for Carto-hosted open-data
// portals (first consumer: Philadelphia's phl.carto.com `permits` table, the city's
// official L&I ledger behind OpenDataPhilly). ADDITIVE: a new source class beside
// socrata.ts/arcgis.ts/ckan.ts/csv.ts; it changes no existing source behavior. All
// logic is entry-driven from jurisdiction-registry.json — no host, no table name, no
// status string is hardcoded here.
//
// Same non-negotiables as the sibling connectors:
//   • COVERAGE GATE: an entry runs for a ZIP only if some resolved community matches its
//     coverage (state + optional county). No match → skipped. (Shared coverageMatches.)
//   • ZIP SCOPING: rows pulled with WHERE {zip_col} LIKE '{zip}%' — Carto portals store
//     ZIP+4 ("19143-3005"), so the 5-digit prefix match IS the exact-ZIP filter. An entry
//     with no zip column is skipped for ZIP reports (quarantined), never pulled whole.
//   • NEVER GUESS THE BUCKET: status → bucket is an exact (trimmed) lookup; unmapped →
//     excluded + surfaced; blank → excluded + counted. (Fail-closed.)
//   • record_url (anti-fabrication): column → template → dataset landing page; a row that
//     can produce no URL is quarantined, never emitted.
//   • Absent fields stay absent. Geometry rides PostGIS: the query SELECTs
//     ST_Y(the_geom) AS __lat, ST_X(the_geom) AS __lng when the entry declares geom_col —
//     rows place by their OWN parcel point; a geometry-less row with a full street
//     address may geocode (deps.geocode); else it stays area-scope.
//
// Fetch path: GET https://{account}.carto.com/api/v2/sql?q=<SQL> (verified live on
// phl.carto.com 2026-07-16) with LIMIT/OFFSET paging. The SQL dialect is PostgreSQL.

// Types and values are imported separately: Node's type stripping (used by the offline
// fixture scripts) does no type analysis, so a TYPE listed in a value import becomes a real
// runtime import and fails to resolve. Deno erases it either way.
import type {
  Bucket, ColumnMap, ColumnRef, FileDateKind, ExcludedStatus, NormalizedRecord, StatusToBucket,
  UnmappedStatus, CaseFoldMatch, NormalizedLookup,
} from "./socrata.ts";
import { fenceGeocode, filedZipOf } from "./geo-fence.ts";
import {
  coverageMatches,
  buildBucketLookup, buildTypeLookup, resolveNormalized, noteCaseFold, caseFoldList,
} from "./socrata.ts";

// ───────────────────────────── registry entry + types ─────────────────────────────

export interface CartoRegistryEntry {
  registry_id: string;
  platform: "carto";
  /** SQL API base, e.g. "https://phl.carto.com/api/v2/sql" (no trailing slash). */
  sql_url: string;
  /** The Carto table name, e.g. "permits". */
  table: string;
  /** Human landing page; the record_url fallback when no per-row URL is derivable. */
  dataset_url: string;
  jurisdiction: string;
  coverage: { state: string; county?: string }[];
  column_map: ColumnMap;
  type_map?: Record<string, string>;
  status_to_bucket: StatusToBucket;
  record_url_template?: string;
  record_url_precision?: "record" | "dataset";
  /** The PostGIS geometry column (e.g. "the_geom"). When set, the query SELECTs
   *  ST_Y/ST_X of it as __lat/__lng and rows place by their own point. */
  geom_col?: string;
  /** false → not run in ZIP-aggregate mode. Default true. */
  zip_mode?: boolean;
  /** drop rows whose file_date is older than N days (SQL now() - interval). */
  /** Optional: what `column_map.file_date` MEANS on this dataset —
   *  "filed" | "issued" | "scheduled" | "estimated" | "decided". Absent ⇒ "filed".
   *  Declared, never inferred; it is what the page labels the date with. */
  file_date_kind?: FileDateKind;
  recency_days?: number;
  /** Optional VERBATIM SQL clause AND'd into every query (drop noise types at source). */
  extra_where?: string;
  /** hard cap on rows pulled per table. Default 20000. */
  max_rows?: number;
}

export interface CartoRunReport {
  registry_id: string;
  table: string;
  fetched: number;
  emitted: number;
  excluded_by_status: ExcludedStatus[];
  unmapped_statuses: UnmappedStatus[];
  /** matched a registry key only after case-folding — NON-failing drift note */
  case_insensitive_matches: CaseFoldMatch[];
  blank_status: number;
  geocode_failures: number;
  no_record_url: number;
  quarantined: { reason: string; sample: string }[];
  /** non-null ⇒ the max_rows cap bound the fetch and this report is INCOMPLETE. */
  truncated_at_max_rows: number | null;
}

/** Set by fetchRows when the max_rows cap BOUND the fetch — i.e. the source has MORE matching
 *  records than this report contains. Silent truncation is the dangerous shape: a capped result and
 *  a complete one are indistinguishable apart from the count, so a truncated page reads as "we have
 *  everything". (2026-08-02 hardening — see QUEUE.md "the 20,000 is a SILENT CAP".) */
interface FetchMeta { truncated: boolean; cap: number }

export interface CartoDeps {
  fetch: typeof fetch;
  geocode?: (address: string) => Promise<
    { lat: number; lng: number; match_type?: string; matched_address?: string | null; geocode_source?: string; needs_review?: boolean } | null
  >;
  /** Report ZIP centroid — the distance half of the GEOCODE geofence (sources/geo-fence.ts).
   *  Absent ⇒ that half fails open; the matched-ZIP half still applies. Source-supplied
   *  coordinates are NEVER fenced. */
  zipCentroid?: { lat: number; lng: number } | null;
  /** Polite page size. Default 1000. */
  pageSize?: number;
}

export interface CartoCommunityRow { state?: string | null; county?: string | null; }

// ───────────────────────────── engine entry point ─────────────────────────────

/** ZIP-mode entry point — the ONLY function index.ts calls (twin of ckanForZip). */
export async function cartoForZip(
  zip: string,
  communities: CartoCommunityRow[],
  entries: CartoRegistryEntry[],
  deps: CartoDeps,
): Promise<{ sites: NormalizedRecord[]; reports: CartoRunReport[] }> {
  const sites: NormalizedRecord[] = [];
  const reports: CartoRunReport[] = [];
  for (const entry of entries) {
    if (entry.platform !== "carto") continue;
    if (entry.zip_mode === false) continue;
    if (!coverageMatches(entry.coverage, communities)) continue;   // coverage gate
    const { records, report } = await runEntry(entry, zip, deps);
    sites.push(...records);
    reports.push(report);
  }
  return { sites, reports };
}

// ───────────────────────────── per-entry run ─────────────────────────────

async function runEntry(
  entry: CartoRegistryEntry,
  zip: string,
  deps: CartoDeps,
): Promise<{ records: NormalizedRecord[]; report: CartoRunReport }> {
  const report: CartoRunReport = {
    registry_id: entry.registry_id, table: entry.table,
    fetched: 0, emitted: 0, excluded_by_status: [], unmapped_statuses: [],
    case_insensitive_matches: [],
    blank_status: 0, geocode_failures: 0, no_record_url: 0, quarantined: [], truncated_at_max_rows: null,
  };
  const records: NormalizedRecord[] = [];

  const zipCol = firstCol(entry.column_map.zip);
  if (!zipCol) {
    report.quarantined.push({ reason: "no zip column mapped — table skipped for ZIP report", sample: entry.table });
    return { records, report };
  }

  // Registry maps are normalized (trim + case-fold) with a collision guard — see the shared
  // helpers in sources/socrata.ts. An unresolvable collision quarantines THIS entry only.
  let lookup: NormalizedLookup<Bucket>;
  let typeLookup: NormalizedLookup<string> | null;
  try {
    lookup = buildBucketLookup(entry.status_to_bucket, entry.registry_id);
    typeLookup = buildTypeLookup(entry.type_map, entry.registry_id);
  } catch (e) {
    report.quarantined.push({ reason: `registry map collision: ${(e as Error).message}`, sample: entry.table });
    return { records, report };
  }
  const excludeCount = new Map<string, number>();
  const unmappedCount = new Map<string, number>();
  const caseFold = new Map<string, CaseFoldMatch>();

  const fetchMeta: FetchMeta = { truncated: false, cap: 0 };
  let rows: Record<string, unknown>[];
  try {
    rows = await fetchRows(entry, zip, zipCol, deps, fetchMeta);
  } catch (e) {
    report.quarantined.push({ reason: `fetch failed: ${(e as Error).message}`, sample: entry.table });
    return { records, report };
  }
  report.fetched = rows.length;
  // A capped fetch is INCOMPLETE and must say so. Surfaced twice on purpose: a machine-readable
  // field, and a quarantine note so it appears wherever quarantines are already read.
  if (fetchMeta.truncated) {
    report.truncated_at_max_rows = fetchMeta.cap;
    report.quarantined.push({
      reason: `max_rows cap of ${fetchMeta.cap} bound the fetch — the source has MORE matching records than this report contains`,
      sample: entry.registry_id,
    });
  }

  for (const row of rows) {
    const statusRaw = String(readCol(row, entry.column_map.status_raw) ?? "").trim();
    if (!statusRaw) { report.blank_status++; continue; }
    const hit = resolveNormalized(lookup, statusRaw);
    const bucket = hit.value;
    if (bucket === undefined) { unmappedCount.set(statusRaw, (unmappedCount.get(statusRaw) ?? 0) + 1); continue; }
    if (hit.caseInsensitive) noteCaseFold(caseFold, "status", statusRaw, hit.matchedKey);
    if (bucket === "exclude") { excludeCount.set(statusRaw, (excludeCount.get(statusRaw) ?? 0) + 1); continue; }
    const rec = await normalizeRow(row, entry, statusRaw, bucket, deps, report, typeLookup, caseFold, zip);
    if (rec) records.push(rec);
  }

  report.emitted = records.length;
  report.excluded_by_status = [...excludeCount].map(([status, count]) => ({ status, count })).sort((a, b) => b.count - a.count);
  report.unmapped_statuses = [...unmappedCount].map(([status, count]) => ({ status, count })).sort((a, b) => b.count - a.count);
  report.case_insensitive_matches = caseFoldList(caseFold);
  return { records, report };
}

const BUCKET_TO_TYPE: Record<string, NormalizedRecord["type"]> = {
  proposed: "proposed", approved: "approved", operating: "built",
};

async function normalizeRow(
  row: Record<string, unknown>,
  entry: CartoRegistryEntry,
  statusRaw: string,
  bucket: Exclude<Bucket, "exclude">,
  deps: CartoDeps,
  report: CartoRunReport,
  typeLookup: NormalizedLookup<string> | null,
  caseFold: Map<string, CaseFoldMatch>,
  reportZip: string | null,
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

  // geography: PostGIS __lat/__lng (from geom_col) or mapped lat/lng columns → point;
  // else geocode a full street address → address; else jurisdiction.
  let lat = numOrNull(row["__lat"] ?? readCol(row, cm.lat));
  let lng = numOrNull(row["__lng"] ?? readCol(row, cm.lng));
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
      // GEOFENCE (anti-fabrication) — the shared implementation, identical across all five
      // connectors. Census range-interpolation can match the same street name in another
      // city/state. A miss NULLS the coords — the record stays listed as an area item, the
      // untrusted marker is never rendered. Source-supplied coords are NEVER fenced.
      const verdict = fenceGeocode(g, filedZipOf(readCol(row, cm.zip), reportZip), deps.zipCentroid);
      if (!verdict.ok) {
        report.geocode_failures++;
        report.quarantined.push({ reason: verdict.reason, sample: address });
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

  const zipVal = valOrNull(readCol(row, cm.zip));
  const rec: NormalizedRecord = {
    source_id: `carto:${hostOf(entry.sql_url)}:${entry.table}:${caseNo ?? title}`,
    source_class: "carto",
    source_registry_id: entry.registry_id,
    jurisdiction: entry.jurisdiction,
    label: (title || caseNo || "Development record").slice(0, 120),
    title,
    use_type: useType,
    bucket,
    type: BUCKET_TO_TYPE[bucket],
    relevance: "development",
    rel_rule: `source:carto:${entry.registry_id}`,
    layer: layerFor(useType),
    status_raw: statusRaw,
    file_date: isoDay(readCol(row, cm.file_date)),
    file_date_kind: entry.file_date_kind ?? "filed",
    decision_date: isoDay(readCol(row, cm.decision_date)),
    address,
    lat, lng, scope, geo_precision: geoPrecision,
    zip: zipVal ? zipVal.slice(0, 5) : null,
    case_number: caseNo,
    record_url: recordUrl,
    record_url_precision: precision,
    ...geoQuality,
  };
  return rec;
}

// ───────────────────────────── fetch / SQL API ─────────────────────────────

async function fetchRows(
  entry: CartoRegistryEntry,
  zip: string,
  zipCol: string,
  deps: CartoDeps,
  meta: FetchMeta,
): Promise<Record<string, unknown>[]> {
  const pageSize = deps.pageSize ?? 1000;
  const maxRows = entry.max_rows ?? 20000;
  const where = buildWhere(entry, zip, zipCol);
  const geoSel = entry.geom_col
    ? `, ST_Y(${entry.geom_col}) AS __lat, ST_X(${entry.geom_col}) AS __lng`
    : "";

  const out: Record<string, unknown>[] = [];
  let offset = 0;
  // Deliberately `<=`: fetch ONE row past the cap so truncation is EXACT. A full final page
  // does NOT prove more rows exist — a source holding precisely max_rows records is COMPLETE, and
  // inferring truncation from a full page would cry wolf on exactly that case.
  while (out.length <= maxRows) {
    const sql = `SELECT *${geoSel} FROM ${entry.table} WHERE ${where} LIMIT ${pageSize} OFFSET ${offset}`;
    const url = `${entry.sql_url}?q=${encodeURIComponent(sql)}`;
    const page = await getWithBackoff(url, deps) as { rows?: Record<string, unknown>[]; error?: string[] };
    if (page?.error) throw new Error(`Carto SQL error: ${page.error.join("; ")}`);
    const rows = page?.rows ?? [];
    if (!Array.isArray(rows) || rows.length === 0) break;
    out.push(...rows);
    if (rows.length < pageSize) break;
    offset += pageSize;
  }
  // The cap bound the fetch iff we actually SAW a row beyond it.
  meta.truncated = out.length > maxRows;
  meta.cap = maxRows;
  return out.slice(0, maxRows);
}

/** ZIP prefix filter (mandatory — Carto portals store ZIP+4) AND'd with the optional
 *  entry-driven extra clause and recency window (PostgreSQL dialect). */
export function buildWhere(entry: CartoRegistryEntry, zip: string, zipCol: string): string {
  const safeZip = zip.replace(/'/g, "''");
  const clauses = [`${zipCol} LIKE '${safeZip}%'`];
  if (entry.extra_where && entry.extra_where.trim()) clauses.push(`(${entry.extra_where.trim()})`);
  if (entry.recency_days && entry.recency_days > 0) {
    const dateCol = firstCol(entry.column_map.file_date);
    if (dateCol) clauses.push(`${dateCol} > now() - interval '${entry.recency_days} days'`);
  }
  return clauses.join(" AND ");
}

async function getWithBackoff(url: string, deps: CartoDeps): Promise<unknown> {
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

// ───────────────────────────── small helpers (ckan.ts siblings) ─────────────────────────────

function readCol(row: Record<string, unknown>, ref?: ColumnRef): unknown {
  if (!ref) return undefined;
  if (Array.isArray(ref)) {
    const parts = ref.map((c) => row[c]).filter((v) => v != null && String(v).trim() !== "").map((v) => String(v).trim());
    return parts.length ? parts.join(" ") : undefined;
  }
  return row[ref];
}

function firstCol(ref?: ColumnRef): string | null {
  if (!ref) return null;
  return Array.isArray(ref) ? (ref[0] ?? null) : ref;
}

function valOrNull(v: unknown): string | null {
  const s = v == null ? "" : String(v).trim();
  return s === "" ? null : s;
}

function numOrNull(v: unknown): number | null {
  if (v == null || String(v).trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function isoDay(v: unknown): string | null {
  if (v == null || String(v).trim() === "") return null;
  const s = String(v).trim();
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

function extractUrl(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return /^https?:\/\//i.test(s) ? s : null;
}

function fillTemplate(tpl: string, row: Record<string, unknown>, caseNo: string | null): string | null {
  const out = tpl.replace(/\{(\w+)\}/g, (_, k) => {
    if (k === "case_number" && caseNo) return encodeURIComponent(caseNo);
    const v = row[k];
    return v == null ? "" : encodeURIComponent(String(v).trim());
  });
  return /^https?:\/\//i.test(out) && !/\{\w+\}/.test(out) && !/=($|&)/.test(out) && !/\/($|\?)/.test(out.replace(/^https?:\/\/[^/]+/, "")) ? out : null;
}

function hostOf(url: string): string {
  try { return new URL(url).host; } catch { return url; }
}

/** Map layer from the (already source-derived) classification — byte-for-byte the
 *  socrata.ts mapping so the same use_type renders on the same layer everywhere. */
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

function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }
