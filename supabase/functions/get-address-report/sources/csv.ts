// CSV-file connector — the generic per-record reader for portals whose only machine
// interface is a published CSV file (first consumers: San Diego's datasd
// development-permit approvals at seshat.datasd.org; San Jose's 30-day planning-permits
// CSV). ADDITIVE: a new source class beside socrata.ts/arcgis.ts/ckan.ts; it changes no
// existing source behavior. All logic is entry-driven from jurisdiction-registry.json —
// no host, no header name, no status string is hardcoded here.
//
// Same non-negotiables as the sibling connectors:
//   • COVERAGE GATE: an entry runs for a ZIP only if some resolved community matches its
//     coverage (state + optional county). No match → the CSV is NEVER fetched. (Shared
//     coverageMatches.)
//   • ZIP SCOPING: a CSV cannot be queried, so scoping happens post-parse and is
//     MANDATORY — either a native zip column equals the report ZIP, or the row's OWN
//     coordinates fall within scope.radius_mi of the report centroid (deps.home). An
//     entry with neither is quarantined for ZIP reports, never emitted county-wide.
//   • NEVER GUESS THE BUCKET: status → bucket is an exact (trimmed) lookup; unmapped →
//     excluded + surfaced; blank → excluded + counted. (Fail-closed.)
//   • record_url (anti-fabrication): column → template → dataset landing page; a row that
//     can produce no URL is quarantined, never emitted.
//   • Absent fields stay absent. Rows place by their OWN coordinates; a coordinate-less
//     row with a full street address may geocode (deps.geocode); else it stays area-scope.
//
// BIG-FILE AMORTIZATION: the SD issued-2026 file is ~15 MB. Fetching it per ZIP report
// would hammer the publisher (115 SD ZIPs/night), so parsed rows are memoized module-level
// per URL with a TTL (default 30 min). Warm edge-function instances serve a whole refresh
// wave from one fetch; a cold start simply re-fetches. The memo stores PARSED rows, not
// the raw text.

import {
  Bucket, ColumnMap, ColumnRef, ExcludedStatus, NormalizedRecord, StatusToBucket,
  UnmappedStatus, coverageMatches,
} from "./socrata.ts";

// ───────────────────────────── registry entry + types ─────────────────────────────

export interface CsvRegistryEntry {
  registry_id: string;
  platform: "csv";
  /** The authoritative CSV file URL (first-party publisher). */
  csv_url: string;
  /** Human landing page; the record_url fallback when no per-row URL is derivable. */
  dataset_url: string;
  jurisdiction: string;
  coverage: { state: string; county?: string }[];
  /** Header-name column map (headers matched verbatim after trim). */
  column_map: ColumnMap;
  type_map?: Record<string, string>;
  status_to_bucket: StatusToBucket;
  record_url_template?: string;
  record_url_precision?: "record" | "dataset";
  /** How rows scope to a ZIP report — REQUIRED (a CSV cannot be queried).
   *  native-zip: column_map.zip equals the report ZIP.
   *  latlng-radius: the row's own lat/lng within radius_mi of the report centroid. */
  scope: { mode: "native-zip" } | { mode: "latlng-radius"; radius_mi: number };
  /** false → not run in ZIP-aggregate mode. Default true. */
  zip_mode?: boolean;
  /** drop rows whose file_date is older than N days. Absent ⇒ no filter. */
  recency_days?: number;
  /** hard cap on rows EMITTED per entry per report. Default 20000. */
  max_rows?: number;
  /** parsed-row memo TTL in minutes (big-file amortization). Default 30. */
  cache_ttl_minutes?: number;
  /** refuse files larger than this many MB (default 40) — a runaway download is a defect. */
  max_file_mb?: number;
}

export interface CsvRunReport {
  registry_id: string;
  csv_url: string;
  fetched: number;               // rows parsed from the file (post-cache)
  in_scope: number;              // rows matching the ZIP scope
  emitted: number;
  excluded_by_status: ExcludedStatus[];
  unmapped_statuses: UnmappedStatus[];
  blank_status: number;
  geocode_failures: number;
  no_record_url: number;
  quarantined: { reason: string; sample: string }[];
  cache_hit: boolean;
}

export interface CsvDeps {
  fetch: typeof fetch;
  geocode?: (address: string) => Promise<
    { lat: number; lng: number; match_type?: string; matched_address?: string | null; geocode_source?: string; needs_review?: boolean } | null
  >;
  /** Report centroid — REQUIRED for scope.mode latlng-radius (the engine passes its
   *  home lat/lng, same value spatial socrata/arcgis entries use). */
  home?: { lat: number; lng: number };
  /** Test hook: bypass the module-level memo. */
  noCache?: boolean;
}

export interface CsvCommunityRow { state?: string | null; county?: string | null; }

// ───────────────────────────── engine entry point ─────────────────────────────

/** ZIP-mode entry point — the ONLY function index.ts calls (twin of ckanForZip). */
export async function csvForZip(
  zip: string,
  communities: CsvCommunityRow[],
  entries: CsvRegistryEntry[],
  deps: CsvDeps,
): Promise<{ sites: NormalizedRecord[]; reports: CsvRunReport[] }> {
  const sites: NormalizedRecord[] = [];
  const reports: CsvRunReport[] = [];
  for (const entry of entries) {
    if (entry.platform !== "csv") continue;
    if (entry.zip_mode === false) continue;
    if (!coverageMatches(entry.coverage, communities)) continue;   // coverage gate — never fetched
    const { records, report } = await runEntry(entry, zip, deps);
    sites.push(...records);
    reports.push(report);
  }
  return { sites, reports };
}

// ───────────────────────────── per-entry run ─────────────────────────────

async function runEntry(
  entry: CsvRegistryEntry,
  zip: string,
  deps: CsvDeps,
): Promise<{ records: NormalizedRecord[]; report: CsvRunReport }> {
  const report: CsvRunReport = {
    registry_id: entry.registry_id, csv_url: entry.csv_url,
    fetched: 0, in_scope: 0, emitted: 0, excluded_by_status: [], unmapped_statuses: [],
    blank_status: 0, geocode_failures: 0, no_record_url: 0, quarantined: [], cache_hit: false,
  };
  const records: NormalizedRecord[] = [];

  // Scope prerequisites — fail closed BEFORE fetching anything.
  const zipCol = entry.scope.mode === "native-zip" ? firstCol(entry.column_map.zip) : null;
  if (entry.scope.mode === "native-zip" && !zipCol) {
    report.quarantined.push({ reason: "scope native-zip but no zip column mapped — entry skipped", sample: entry.registry_id });
    return { records, report };
  }
  if (entry.scope.mode === "latlng-radius" && !deps.home) {
    report.quarantined.push({ reason: "scope latlng-radius but no report centroid provided — entry skipped", sample: entry.registry_id });
    return { records, report };
  }

  let rows: Record<string, string>[];
  try {
    const got = await fetchRowsCached(entry, deps);
    rows = got.rows;
    report.cache_hit = got.cacheHit;
  } catch (e) {
    report.quarantined.push({ reason: `fetch failed: ${(e as Error).message}`, sample: entry.csv_url });
    return { records, report };
  }
  report.fetched = rows.length;

  const lookup = buildBucketLookup(entry.status_to_bucket);
  const excludeCount = new Map<string, number>();
  const unmappedCount = new Map<string, number>();
  const maxRows = entry.max_rows ?? 20000;
  const cutoff = entry.recency_days && entry.recency_days > 0
    ? new Date(Date.now() - entry.recency_days * 86400000).toISOString().slice(0, 10)
    : null;

  for (const row of rows) {
    if (records.length >= maxRows) break;

    // ZIP scope (mandatory, post-parse).
    if (entry.scope.mode === "native-zip") {
      const z = String(readCol(row, entry.column_map.zip) ?? "").trim().slice(0, 5);
      if (z !== zip) continue;
    } else {
      const lat = numOrNull(readCol(row, entry.column_map.lat));
      const lng = numOrNull(readCol(row, entry.column_map.lng));
      if (lat == null || lng == null) continue;                        // no coords → out of scope, never guessed in
      if (haversineMi(lat, lng, deps.home!.lat, deps.home!.lng) > entry.scope.radius_mi) continue;
    }
    report.in_scope++;

    // Recency window on file_date (post-parse — a CSV cannot be queried).
    if (cutoff) {
      const fd = isoDay(readCol(row, entry.column_map.file_date));
      if (!fd || fd <= cutoff) continue;
    }

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
  row: Record<string, string>,
  entry: CsvRegistryEntry,
  statusRaw: string,
  bucket: Exclude<Bucket, "exclude">,
  deps: CsvDeps,
  report: CsvRunReport,
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
    source_id: `csv:${hostOf(entry.csv_url)}:${entry.registry_id}:${caseNo ?? title}`,
    source_class: "csv",
    source_registry_id: entry.registry_id,
    jurisdiction: entry.jurisdiction,
    label: (title || caseNo || "Development record").slice(0, 120),
    title,
    use_type: useType,
    bucket,
    type: BUCKET_TO_TYPE[bucket],
    relevance: "development",
    rel_rule: `source:csv:${entry.registry_id}`,
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

// ───────────────────────────── fetch + memo + RFC-4180 parse ─────────────────────────────

const memo = new Map<string, { ts: number; rows: Record<string, string>[] }>();

async function fetchRowsCached(
  entry: CsvRegistryEntry,
  deps: CsvDeps,
): Promise<{ rows: Record<string, string>[]; cacheHit: boolean }> {
  const ttlMs = (entry.cache_ttl_minutes ?? 30) * 60000;
  if (!deps.noCache) {
    const hit = memo.get(entry.csv_url);
    if (hit && Date.now() - hit.ts < ttlMs) return { rows: hit.rows, cacheHit: true };
  }
  const headers: Record<string, string> = { "User-Agent": "HomeSignal public-records refresh (contact: admin@homesignal.net)" };
  let delay = 800;
  let text: string | null = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await deps.fetch(entry.csv_url, { headers, signal: AbortSignal.timeout(60000) });
    if (res.status === 429 || res.status >= 500) { await sleep(delay); delay *= 2; continue; }
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${entry.csv_url}`);
    text = await res.text();
    break;
  }
  if (text == null) throw new Error(`rate-limited/5xx after retries: ${entry.csv_url}`);
  const maxBytes = (entry.max_file_mb ?? 40) * 1024 * 1024;
  if (text.length > maxBytes) throw new Error(`file exceeds max_file_mb (${text.length} bytes)`);
  const rows = parseCsv(text);
  if (!deps.noCache) memo.set(entry.csv_url, { ts: Date.now(), rows });
  return { rows, cacheHit: false };
}

/** Minimal RFC-4180 parser: quoted fields, escaped quotes (""), CR/LF and newlines inside
 *  quotes. Header row (trimmed) keys every record. No external deps. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let field = "", cur: string[] = [], inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      cur.push(field); field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      cur.push(field); field = "";
      if (cur.length > 1 || cur[0] !== "") rows.push(cur);
      cur = [];
    } else field += c;
  }
  if (field !== "" || cur.length) { cur.push(field); if (cur.length > 1 || cur[0] !== "") rows.push(cur); }
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => {
    const o: Record<string, string> = {};
    for (let j = 0; j < header.length; j++) o[header[j]] = r[j] ?? "";
    return o;
  });
}

function haversineMi(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3958.8, toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// ───────────────────────────── small helpers (ckan.ts siblings) ─────────────────────────────

function buildBucketLookup(s2b: StatusToBucket): Map<string, Bucket> {
  const m = new Map<string, Bucket>();
  for (const b of ["proposed", "approved", "operating", "exclude"] as Bucket[]) {
    for (const status of s2b[b] ?? []) { const k = status.trim(); if (!m.has(k)) m.set(k, b); }
  }
  return m;
}

function readCol(row: Record<string, string>, ref?: ColumnRef): unknown {
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

function fillTemplate(tpl: string, row: Record<string, string>, caseNo: string | null): string | null {
  const out = tpl.replace(/\{(\w+)\}/g, (_, k) => {
    if (k === "case_number" && caseNo) return encodeURIComponent(caseNo);
    const v = row[k];
    return v == null ? "" : encodeURIComponent(String(v));
  });
  return /^https?:\/\//i.test(out) && !/\{\w+\}/.test(out) && !/=($|&)/.test(out) ? out : null;
}

function hostOf(url: string): string {
  try { return new URL(url).host; } catch { return url; }
}

/** Byte-for-byte the socrata.ts/ckan.ts mapping so the same use_type renders on the same
 *  layer everywhere. */
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
