// CSV-file connector — the generic per-record reader for first-party portals whose
// interface is a published CSV file (first consumer: San Diego's seshat.datasd.org
// development-permit approvals ledger). ADDITIVE: a new source class beside
// socrata.ts/arcgis.ts/ckan.ts; it changes no existing source behavior. All logic is
// entry-driven from jurisdiction-registry.json — no host, no field name, no status
// string is hardcoded here.
//
// Same non-negotiables as the sibling connectors:
//   • COVERAGE GATE: an entry runs for a ZIP only if some resolved community matches its
//     coverage (state + optional county). No match → skipped. (Shared coverageMatches.)
//   • ZIP SCOPING: rows filtered to {zip_col} == zip when a ZIP column exists; a no-ZIP
//     file may instead declare spatial_zip_radius_mi and scope by each row's OWN
//     coordinates against the ZIP centroid (the engine's standard centroid+radius ZIP
//     approximation — records keep their own per-parcel points, nothing is guessed).
//     Neither → the entry is skipped for ZIP reports (quarantined), never pulled whole.
//   • NEVER GUESS THE BUCKET: status → bucket is an exact (trimmed) lookup; unmapped →
//     excluded + surfaced; blank → excluded + counted. (Fail-closed.)
//   • record_url (anti-fabrication): column → template → dataset landing page; a row that
//     can produce no URL is quarantined, never emitted.
//   • Absent fields stay absent. Rows place by their OWN coordinates; in spatial mode a
//     coordinate-less row cannot be scoped to the ZIP and is skipped (counted), never
//     centre-pinned.
//
// FETCH-ONCE-PER-REFRESH: a published CSV has no server-side query, so the noise/type
// filter (include_types), the recency window, and the column projection are applied ONCE
// at parse time and the compact result is memoized module-level per registry entry
// (CACHE_MINUTES). A warm isolate serves every ZIP in a batch from that one fetch — the
// design pinned in docs/source-registry.md for the 14.9 MB San Diego file. Batches
// should fire such ZIPs in modest waves so cold isolates don't multiply the download.

import {
  Bucket, ColumnMap, ColumnRef, ExcludedStatus, NormalizedRecord, StatusToBucket,
  UnmappedStatus, coverageMatches,
} from "./socrata.ts";

// ───────────────────────────── registry entry + types ─────────────────────────────

export interface CsvRegistryEntry {
  registry_id: string;
  platform: "csv";
  /** The published CSV file URL (https). */
  url: string;
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
  /** drop rows whose file_date is older than N days (applied in-memory on the parsed
   *  date at cache-build time). Absent ⇒ no filter. */
  recency_days?: number;
  /** VERBATIM whitelist on column_map.type_source values — the CSV twin of the SQL
   *  connectors' extra_where noise drop. Rows whose type is not listed are dropped at
   *  parse time (counted in the run report), before anything is cached or emitted.
   *  Absent ⇒ no type filter. */
  include_types?: string[];
  /** SPATIAL ZIP-scoping for files with NO ZIP column: keep rows whose OWN lat/lng sits
   *  within ±this many miles of the ZIP centroid. Requires deps.zipCentroid. */
  spatial_zip_radius_mi?: number;
  /** hard cap on rows emitted per ZIP (safety net). Default 20000. */
  max_rows?: number;
  /** memoize the parsed file this long. Default 360 (the daily refresh re-fetches). */
  cache_minutes?: number;
}

export interface CsvRunReport {
  registry_id: string;
  url: string;
  /** rows in the parsed file after the include_types + recency projection. */
  file_rows: number;
  /** rows scoped to this ZIP (before status bucketing). */
  fetched: number;
  emitted: number;
  excluded_by_status: ExcludedStatus[];
  unmapped_statuses: UnmappedStatus[];
  blank_status: number;
  /** spatial mode only: ZIP-scoped candidates dropped for having no coordinates. */
  skipped_no_coords: number;
  geocode_failures: number;
  no_record_url: number;
  quarantined: { reason: string; sample: string }[];
}

export interface CsvDeps {
  fetch: typeof fetch;
  geocode?: (address: string) => Promise<
    { lat: number; lng: number; match_type?: string; matched_address?: string | null; geocode_source?: string; needs_review?: boolean } | null
  >;
  /** ZIP centroid for entries using spatial_zip_radius_mi. */
  zipCentroid?: { lat: number; lng: number };
}

export interface CsvCommunityRow { state?: string | null; county?: string | null; }

// ───────────────────────────── module-level file cache ─────────────────────────────

interface CachedFile { at: number; rows: Record<string, unknown>[]; }
const FILE_CACHE = new Map<string, CachedFile>();

/** test hook — clears the memo so unit tests can exercise fresh fetches. */
export function _clearCsvCache(): void { FILE_CACHE.clear(); }

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
    if (!coverageMatches(entry.coverage, communities)) continue;   // coverage gate
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
    registry_id: entry.registry_id, url: entry.url,
    file_rows: 0, fetched: 0, emitted: 0, excluded_by_status: [], unmapped_statuses: [],
    blank_status: 0, skipped_no_coords: 0, geocode_failures: 0, no_record_url: 0, quarantined: [],
  };
  const records: NormalizedRecord[] = [];

  const zipCol = firstCol(entry.column_map.zip);
  const spatial = (entry.spatial_zip_radius_mi ?? 0) > 0;
  if (spatial && !deps.zipCentroid) {
    report.quarantined.push({ reason: "spatial_zip_radius_mi set but no zipCentroid provided — skipped", sample: entry.url });
    return { records, report };
  }
  if (!zipCol && !spatial) {
    report.quarantined.push({ reason: "no zip column mapped and no spatial_zip_radius_mi — file skipped for ZIP report", sample: entry.url });
    return { records, report };
  }

  let fileRows: Record<string, unknown>[];
  try {
    fileRows = await loadFile(entry, deps);
  } catch (e) {
    report.quarantined.push({ reason: `fetch/parse failed: ${(e as Error).message}`, sample: entry.url });
    return { records, report };
  }
  report.file_rows = fileRows.length;

  // ZIP scoping — native column, else each row's OWN point vs the ZIP centroid.
  let zipRows: Record<string, unknown>[];
  if (zipCol) {
    zipRows = fileRows.filter((r) => String(r[zipCol] ?? "").trim().slice(0, 5) === zip);
  } else {
    const radius = entry.spatial_zip_radius_mi as number;
    const { lat: cLat, lng: cLng } = deps.zipCentroid as { lat: number; lng: number };
    zipRows = [];
    for (const r of fileRows) {
      const lat = numOrNull(readCol(r, entry.column_map.lat));
      const lng = numOrNull(readCol(r, entry.column_map.lng));
      if (lat == null || lng == null) { report.skipped_no_coords++; continue; }
      if (milesBetween(cLat, cLng, lat, lng) <= radius) zipRows.push(r);
    }
  }
  report.fetched = zipRows.length;

  const lookup = buildBucketLookup(entry.status_to_bucket);
  const excludeCount = new Map<string, number>();
  const unmappedCount = new Map<string, number>();
  const maxRows = entry.max_rows ?? 20000;

  for (const row of zipRows) {
    if (records.length >= maxRows) break;
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
    source_id: `csv:${hostOf(entry.url)}:${entry.registry_id}:${caseNo ?? title}`,
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

// ───────────────────────────── fetch / parse / project ─────────────────────────────

/** Fetch + parse the CSV ONCE per cache window, applying the entry's include_types
 *  whitelist, recency window, and column projection at parse time so only the compact
 *  kept rows are held in memory / served to every ZIP in the batch. */
async function loadFile(entry: CsvRegistryEntry, deps: CsvDeps): Promise<Record<string, unknown>[]> {
  const ttlMs = (entry.cache_minutes ?? 360) * 60000;
  const cached = FILE_CACHE.get(entry.registry_id);
  if (cached && Date.now() - cached.at < ttlMs) return cached.rows;

  const res = await deps.fetch(entry.url, {
    headers: { "Accept": "text/csv", "User-Agent": "HomeSignal public-records refresh (contact: admin@homesignal.net)" },
    signal: AbortSignal.timeout(120000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${entry.url}`);
  const text = await res.text();

  const parsed = parseCsv(text);
  if (!parsed.length) throw new Error("empty CSV");
  const header = parsed.shift() as string[];
  const hIdx = new Map<string, number>();
  header.forEach((h, i) => hIdx.set(h.trim(), i));

  // Column projection: keep only the columns the entry maps.
  const wanted = new Set<string>();
  for (const ref of Object.values(entry.column_map)) {
    if (!ref) continue;
    for (const c of Array.isArray(ref) ? ref : [ref]) wanted.add(c);
  }
  if (entry.record_url_template) {
    for (const m of entry.record_url_template.matchAll(/\{(\w+)\}/g)) if (m[1] !== "case_number") wanted.add(m[1]);
  }
  const wantedIdx: [string, number][] = [...wanted].map((c) => [c, hIdx.get(c) ?? -1]);

  const typeCol = firstCol(entry.column_map.type_source);
  const typeIdx = typeCol ? (hIdx.get(typeCol) ?? -1) : -1;
  const include = entry.include_types ? new Set(entry.include_types.map((t) => t.trim())) : null;
  const dateCol = firstCol(entry.column_map.file_date);
  const dateIdx = dateCol ? (hIdx.get(dateCol) ?? -1) : -1;
  const cutoff = entry.recency_days && entry.recency_days > 0
    ? Date.now() - entry.recency_days * 86400000 : null;

  const rows: Record<string, unknown>[] = [];
  for (const raw of parsed) {
    if (include && typeIdx >= 0) {
      const t = String(raw[typeIdx] ?? "").trim();
      if (!include.has(t)) continue;                     // noise dropped at parse (the CSV "at source")
    }
    if (cutoff != null && dateIdx >= 0) {
      const d = new Date(String(raw[dateIdx] ?? "").trim());
      if (isNaN(d.getTime()) || d.getTime() < cutoff) continue;
    }
    const obj: Record<string, unknown> = {};
    for (const [c, i] of wantedIdx) if (i >= 0) obj[c] = raw[i];
    rows.push(obj);
  }
  FILE_CACHE.set(entry.registry_id, { at: Date.now(), rows });
  return rows;
}

/** RFC-4180 CSV parser (quotes, escaped quotes, embedded commas/newlines) — SLICE-BASED.
 *  The naive per-char `field += ch` implementation blew the edge worker's CPU budget on the
 *  15 MB San Diego file (WORKER_RESOURCE_LIMIT, 2026-07-16 smoke test); this scanner slices
 *  fields out of the source string and uses native indexOf for quoted spans, parsing the
 *  same file in a few hundred ms. Behavior is byte-identical (unit-tested). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let i = 0;
  const n = text.length;
  while (i < n) {
    let field: string;
    if (text.charCodeAt(i) === 34 /* '"' */) {
      // quoted field: jump between quote chars with indexOf; '""' is an escaped quote.
      let j = i + 1;
      let hasEsc = false;
      for (;;) {
        const idx = text.indexOf('"', j);
        if (idx === -1) { j = n; break; }
        if (text.charCodeAt(idx + 1) === 34) { hasEsc = true; j = idx + 2; continue; }
        j = idx; break;
      }
      field = text.slice(i + 1, j);
      if (hasEsc) field = field.replaceAll('""', '"');
      i = Math.min(j + 1, n);
    } else {
      let j = i;
      while (j < n) {
        const c = text.charCodeAt(j);
        if (c === 44 /* , */ || c === 10 /* \n */ || c === 13 /* \r */) break;
        j++;
      }
      field = text.slice(i, j);
      i = j;
    }
    row.push(field);
    const c = i < n ? text.charCodeAt(i) : -1;
    if (c === 44) { i++; continue; }        // comma → next field on the same row
    if (c === 13) i++;                       // consume \r
    if (i < n && text.charCodeAt(i) === 10) i++;   // consume \n
    if (row.length > 1 || row[0] !== "") rows.push(row);
    row = [];
  }
  // Text ended right after a comma: the dangling empty field closes the pending row.
  if (row.length) { row.push(""); rows.push(row); }
  return rows;
}

/** Planar miles between two points (same small-angle approximation the engine uses). */
function milesBetween(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const MILES_PER_DEG_LAT = 69.0;
  const n = (lat2 - lat1) * MILES_PER_DEG_LAT;
  const e = (lng2 - lng1) * MILES_PER_DEG_LAT * Math.cos((lat1 * Math.PI) / 180);
  return Math.hypot(e, n);
}

// ───────────────────────────── small helpers (ckan.ts siblings) ─────────────────────────────

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
    default: return "development";     // Development / unclassified → neutral
  }
}
