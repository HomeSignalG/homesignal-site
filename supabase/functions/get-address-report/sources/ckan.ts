// CKAN datastore connector — the generic per-record reader for CKAN open-data portals
// (first consumer: Boston's data.boston.gov "Approved Building Permits"). ADDITIVE: a new
// source class beside socrata.ts/arcgis.ts; it changes no existing source behavior. All
// logic is entry-driven from jurisdiction-registry.json — no portal host, no field name,
// no status string is hardcoded here.
//
// Same non-negotiables as the sibling connectors:
//   • COVERAGE GATE: an entry runs for a ZIP only if some resolved community matches its
//     coverage (state + optional county). No match → skipped. (Shared coverageMatches.)
//   • ZIP SCOPING: rows pulled with WHERE {zip_col} = '{zip}' — an entry with no zip column
//     is skipped for a ZIP report (quarantined), never pulled statewide.
//   • NEVER GUESS THE BUCKET: status → bucket is an exact (trimmed) lookup; unmapped →
//     excluded + surfaced; blank → excluded + counted. (Fail-closed.)
//   • record_url (anti-fabrication): column → template → dataset landing page; a row that
//     can produce no URL is quarantined, never emitted.
//   • Absent fields stay absent. Rows place by their OWN coordinates; a coordinate-less row
//     with a full street address may geocode (deps.geocode); else it stays area-scope.
//
// Fetch path: CKAN's datastore_search_sql action (verified live on data.boston.gov) with
// LIMIT/OFFSET paging — SELECT * FROM "{resource_id}" WHERE … ORDER BY "_id".

import {
  Bucket, ColumnMap, ColumnRef, ExcludedStatus, NormalizedRecord, StatusToBucket,
  UnmappedStatus, coverageMatches,
} from "./socrata.ts";

// ───────────────────────────── registry entry + types ─────────────────────────────

export interface CkanRegistryEntry {
  registry_id: string;
  platform: "ckan";
  /** Portal origin, e.g. "https://data.boston.gov" (no trailing slash). */
  base_url: string;
  /** The datastore resource id (a UUID on most portals). */
  resource_id: string;
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
  /** drop rows whose file_date is older than N days. Absent ⇒ no filter. */
  recency_days?: number;
  /** Optional VERBATIM SQL clause AND'd into every query (entry-driven scoping — drop noise
   *  permit classes at source). Data, not code: the connector never inspects it. */
  extra_where?: string;
  /** hard cap on rows pulled per resource. Default 20000. */
  max_rows?: number;
}

export interface CkanRunReport {
  registry_id: string;
  resource_id: string;
  fetched: number;
  emitted: number;
  excluded_by_status: ExcludedStatus[];
  unmapped_statuses: UnmappedStatus[];
  blank_status: number;
  geocode_failures: number;
  no_record_url: number;
  quarantined: { reason: string; sample: string }[];
}

export interface CkanDeps {
  fetch: typeof fetch;
  geocode?: (address: string) => Promise<
    { lat: number; lng: number; match_type?: string; matched_address?: string | null; geocode_source?: string; needs_review?: boolean } | null
  >;
  /** Polite page size. Default 1000. */
  pageSize?: number;
}

export interface CkanCommunityRow { state?: string | null; county?: string | null; }

// ───────────────────────────── engine entry point ─────────────────────────────

/** ZIP-mode entry point — the ONLY function index.ts calls (twin of socrataForZip). */
export async function ckanForZip(
  zip: string,
  communities: CkanCommunityRow[],
  entries: CkanRegistryEntry[],
  deps: CkanDeps,
): Promise<{ sites: NormalizedRecord[]; reports: CkanRunReport[] }> {
  const sites: NormalizedRecord[] = [];
  const reports: CkanRunReport[] = [];
  for (const entry of entries) {
    if (entry.platform !== "ckan") continue;
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
  entry: CkanRegistryEntry,
  zip: string,
  deps: CkanDeps,
): Promise<{ records: NormalizedRecord[]; report: CkanRunReport }> {
  const report: CkanRunReport = {
    registry_id: entry.registry_id, resource_id: entry.resource_id,
    fetched: 0, emitted: 0, excluded_by_status: [], unmapped_statuses: [],
    blank_status: 0, geocode_failures: 0, no_record_url: 0, quarantined: [],
  };
  const records: NormalizedRecord[] = [];

  const zipCol = firstCol(entry.column_map.zip);
  if (!zipCol) {
    report.quarantined.push({ reason: "no zip column mapped — resource skipped for ZIP report", sample: entry.resource_id });
    return { records, report };
  }

  const lookup = buildBucketLookup(entry.status_to_bucket);
  const excludeCount = new Map<string, number>();
  const unmappedCount = new Map<string, number>();

  let rows: Record<string, unknown>[];
  try {
    rows = await fetchRows(entry, zip, zipCol, deps);
  } catch (e) {
    report.quarantined.push({ reason: `fetch failed: ${(e as Error).message}`, sample: entry.resource_id });
    return { records, report };
  }
  report.fetched = rows.length;

  for (const row of rows) {
    const statusRaw = String(readCol(row, entry.column_map.status_raw) ?? "").trim();
    if (!statusRaw) { report.blank_status++; continue; }
    const bucket = lookup.get(statusRaw);
    if (bucket === undefined) { unmappedCount.set(statusRaw, (unmappedCount.get(statusRaw) ?? 0) + 1); continue; }
    if (bucket === "exclude") { excludeCount.set(statusRaw, (excludeCount.get(statusRaw) ?? 0) + 1); continue; }
    const rec = await normalizeRow(row, entry, statusRaw, bucket, deps, report);
    if (rec) records.push(rec);
  }

  report.emitted = records.length;
  report.excluded_by_status = [...excludeCount].map(([status, count]) => ({ status, count })).sort((a, b) => b.count - a.count);
  report.unmapped_statuses = [...unmappedCount].map(([status, count]) => ({ status, count })).sort((a, b) => b.count - a.count);
  return { records, report };
}

const BUCKET_TO_TYPE: Record<string, NormalizedRecord["type"]> = {
  proposed: "proposed", approved: "approved", operating: "built",
};

async function normalizeRow(
  row: Record<string, unknown>,
  entry: CkanRegistryEntry,
  statusRaw: string,
  bucket: Exclude<Bucket, "exclude">,
  deps: CkanDeps,
  report: CkanRunReport,
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
      lat = g.lat; lng = g.lng; geoPrecision = "address"; scope = "point";
      if (g.match_type) geoQuality.match_type = g.match_type;
      if (g.matched_address) geoQuality.matched_address = g.matched_address;
      if (g.geocode_source) geoQuality.geocode_source = g.geocode_source;
      if (g.needs_review !== undefined) geoQuality.needs_review = g.needs_review;
    }
  } else {
    geoPrecision = "jurisdiction"; scope = "area"; lat = null; lng = null;
  }

  const rec: NormalizedRecord = {
    source_id: `ckan:${hostOf(entry.base_url)}:${entry.resource_id}:${caseNo ?? rowId(row) ?? title}`,
    source_class: "ckan",
    source_registry_id: entry.registry_id,
    jurisdiction: entry.jurisdiction,
    label: (title || caseNo || "Development record").slice(0, 120),
    title,
    use_type: useType,
    bucket,
    type: BUCKET_TO_TYPE[bucket],
    relevance: "development",
    rel_rule: `source:ckan:${entry.registry_id}`,
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

// ───────────────────────────── fetch / datastore SQL ─────────────────────────────

async function fetchRows(
  entry: CkanRegistryEntry,
  zip: string,
  zipCol: string,
  deps: CkanDeps,
): Promise<Record<string, unknown>[]> {
  const pageSize = deps.pageSize ?? 1000;
  const maxRows = entry.max_rows ?? 20000;
  const where = buildWhere(entry, zip, zipCol);

  const out: Record<string, unknown>[] = [];
  let offset = 0;
  while (out.length < maxRows) {
    const sql = `SELECT * FROM "${entry.resource_id}" WHERE ${where} ORDER BY "_id" LIMIT ${pageSize} OFFSET ${offset}`;
    const url = `${entry.base_url}/api/3/action/datastore_search_sql?sql=${encodeURIComponent(sql)}`;
    const page = await getWithBackoff(url, deps) as { success?: boolean; result?: { records?: Record<string, unknown>[] } };
    if (!page || page.success !== true) throw new Error("datastore_search_sql returned success=false");
    const rows = page.result?.records ?? [];
    if (!Array.isArray(rows) || rows.length === 0) break;
    out.push(...rows);
    if (rows.length < pageSize) break;
    offset += pageSize;
  }
  return out.slice(0, maxRows);
}

/** ZIP filter (mandatory) AND'd with the optional entry-driven extra clause and recency
 *  window — the socrata buildWhere's twin, in the datastore's PostgreSQL dialect. */
export function buildWhere(entry: CkanRegistryEntry, zip: string, zipCol: string): string {
  const clauses = [`"${zipCol}" = '${zip.replace(/'/g, "''")}'`];
  if (entry.extra_where && entry.extra_where.trim()) clauses.push(`(${entry.extra_where.trim()})`);
  if (entry.recency_days && entry.recency_days > 0) {
    const dateCol = firstCol(entry.column_map.file_date);
    if (dateCol) {
      const cutoff = new Date(Date.now() - entry.recency_days * 86400000).toISOString().slice(0, 10);
      clauses.push(`"${dateCol}" > '${cutoff}'`);
    }
  }
  return clauses.join(" AND ");
}

async function getWithBackoff(url: string, deps: CkanDeps): Promise<unknown> {
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

// ───────────────────────────── small helpers (socrata.ts siblings) ─────────────────────────────

function buildBucketLookup(s2b: StatusToBucket): Map<string, Bucket> {
  const m = new Map<string, Bucket>();
  for (const b of ["proposed", "approved", "operating", "exclude"] as Bucket[]) {
    for (const status of s2b[b] ?? []) { const k = status.trim(); if (!m.has(k)) m.set(k, b); }
  }
  return m;
}

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
  if (typeof v === "object" && v !== null && "url" in (v as Record<string, unknown>)) {
    return valOrNull((v as Record<string, unknown>).url);
  }
  const s = String(v).trim();
  return /^https?:\/\//i.test(s) ? s : null;
}

function fillTemplate(tpl: string, row: Record<string, unknown>, caseNo: string | null): string | null {
  const out = tpl.replace(/\{(\w+)\}/g, (_, k) => {
    if (k === "case_number" && caseNo) return encodeURIComponent(caseNo);
    const v = row[k];
    return v == null ? "" : encodeURIComponent(String(v));
  });
  return /^https?:\/\//i.test(out) && !/\{\w+\}/.test(out) && !/=($|&)/.test(out) ? out : null;
}

function rowId(row: Record<string, unknown>): string | null {
  return valOrNull(row["_id"]);
}

function hostOf(baseUrl: string): string {
  try { return new URL(baseUrl).host; } catch { return baseUrl; }
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
    default: return "development";     // Development / unclassified → neutral
  }
}

function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }
