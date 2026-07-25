// supabase/functions/get-address-report/sources/contract.ts
//
// THE NEUTRAL BACKBONE CONTRACT — platform-independent by construction.
//
// Every development-record source (socrata, arcgis, ckan, csv, carto, and future
// EnerGov / OpenGov / Municity / TABS / JSON / XML adapters) speaks this contract.
// Nothing in this file may import from a platform module; the dependency arrow points
// ONE WAY — platform adapters import the contract, never the reverse.
//
// WHY THIS FILE EXISTS (backbone review, 2026-07-25): the record shape and ~11 helpers
// were defined inside sources/socrata.ts and imported by the other four connectors, so
// "the contract" was a side effect of one platform's implementation. Adding a platform
// meant editing socrata.ts. That is now fixed.
//
// ─────────────────────────────────────────────────────────────────────────────────────
// WHAT IS **NOT** HERE, AND WHY (read before "finishing the job")
//
// A helper is hoisted into this file ONLY when every adapter's copy was proven
// behaviourally identical (or a strict superset). Auditing the five copies found that
// most were NOT identical — hoisting them blindly would have silently changed output in
// three adapters. The divergent ones are therefore declared as PLATFORM POLICY on the
// RecordCodec interface below and stay adapter-local:
//
//   isoDay        3 semantics: strict regex (socrata) | +epoch-millis (arcgis) |
//                 permissive `new Date(s)` (ckan/csv/carto). A ckan value like
//                 "15 Jul 2026" parses under one and returns null under another.
//   numOrNull     whitespace differs: `" "` → 0 (socrata/arcgis, via `v === ""`)
//                 vs null (ckan/csv/carto, via `String(v).trim() === ""`).
//   fillTemplate  3 semantics: raw substitution (socrata/arcgis) | encode + URL
//                 validation (ckan) | encode + trim + stricter validation (csv/carto).
//   extractUrl    3 semantics: returns "" vs null; http-scheme validation present or not.
//   rowId         platform-specific id precedence (:id / OBJECTID / _id).
//
// Unifying any of those is a BEHAVIOUR CHANGE and needs its own evidence pass + re-cache
// diff. See docs/backbone-architecture.md "Remaining technical debt".
// ─────────────────────────────────────────────────────────────────────────────────────

// ───────────────────────────── record contract ─────────────────────────────

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
  /** Optional: the source's own parcel/APN identifier when it states one. */
  parcel_id?: ColumnRef;
}

export interface StatusToBucket {
  proposed?: string[];
  approved?: string[];
  operating?: string[];
  exclude?: string[];
}

/** Coverage scope — the mandatory gate (docs/source-registry.md rule 1). */
export interface Coverage { state: string; county?: string }

/**
 * THE normalized development record. Every adapter emits exactly this shape.
 *
 * ANTI-FABRICATION INVARIANTS (never relax):
 *   • record_url is REQUIRED and non-empty — a record without one is dropped, not rendered.
 *   • Absent fields stay absent. Never default, never infer, never interpolate.
 *   • lat/lng are present ONLY when the source supplied geometry or a geocode passed the
 *     geofence (see applyGeofence). A fenced-out record keeps its data and loses its point.
 */
export interface NormalizedRecord {
  source_id: string;                 // {source_class}:{domain}:{dataset}:{case_number|row id}
  source_class: string;              // "socrata" | "arcgis" | "ckan" | "csv" | "carto" | …
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
  rel_rule: string;                  // "source:{source_class}:{registry_id}"
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

  // ── Contract-complete metadata (backbone review §4). DECLARED, NOT YET POPULATED. ──
  // These close the gaps the review identified. They are optional so that adding them
  // changed no existing output byte; an adapter opts in by setting them. Populating
  // retrieved_at/raw_ref is the staging-layer work (Phase 4) and is NOT done here.
  /** The source's own parcel/APN when stated (Fairfax PARCEL_ID, El Paso PID, …). */
  parcel_id?: string | null;
  /** True when the point is synthetic/spread rather than the record's own location. */
  approx?: boolean;
  /** ISO instant this record was retrieved from its source. Requires the staging layer. */
  retrieved_at?: string;
  /** Pointer to the retained raw payload. Requires the staging layer. */
  raw_ref?: { staging_id: string; fetched_at: string; endpoint: string };
}

// ───────────────────────────── run report contract ─────────────────────────────

export interface ExcludedStatus { status: string; count: number }
/** A status value the entry does not bucket. Surfaced, never guessed (fail-closed). */
export interface UnmappedStatus { status: string; count: number }
export interface QuarantineNote { reason: string; sample: string }

/**
 * The fields EVERY adapter's run report carries. Platform adapters extend this with
 * their own identity field (dataset_id / service_url / resource_id / file_url / table)
 * and any platform-specific counters — the engine only relies on the common core.
 */
export interface RunReport {
  registry_id: string;
  fetched: number;                   // raw rows pulled (after source-side scoping)
  emitted: number;                   // records that survived every gate
  excluded_by_status: ExcludedStatus[];
  unmapped_statuses: string[];       // fail-closed: a status in no bucket is surfaced, not guessed
  blank_status: number;
  geocode_failures: number;
  no_record_url: number;             // anti-fabrication drops
  quarantined: QuarantineNote[];     // quarantine-don't-stop
}

// ───────────────────────────── adapter contract ─────────────────────────────

/** Geocode result handed back to an adapter by the shared write-once geocode cache. */
export interface GeocodeHit {
  lat: number;
  lng: number;
  match_type?: string;
  matched_address?: string;
  geocode_source?: string;
  needs_review?: boolean;
}

/** Everything the engine injects. One shape for every adapter — the engine builds it once. */
export interface AdapterDeps {
  fetch: typeof fetch;
  /** Shared write-once geocode cache + zero-fee ladder. null ⇒ geocode failed (quarantine). */
  geocode?: (address: string) => Promise<GeocodeHit | null>;
  /** Report ZIP centroid — for spatial ZIP scoping and the geocode geofence. */
  zipCentroid?: { lat: number; lng: number };
  /** Optional per-platform credential (e.g. Socrata app token). Never logged. */
  appToken?: string;
}

/** The community rows the coverage gate is evaluated against. */
export interface CommunityRow { state?: string | null; county?: string | null }

/**
 * THE ADAPTER INTERFACE. A new platform implements exactly this and is registered in the
 * engine's ADAPTERS table — no other engine edit. Adding a jurisdiction to an existing
 * platform stays a jurisdiction-registry.json edit with no code at all.
 */
export interface SourceAdapter<E = unknown, R extends RunReport = RunReport> {
  /** Stable platform key — also the jurisdiction-registry.json section name. */
  readonly source_class: string;
  /** Response key the engine publishes this adapter's reports under. */
  readonly report_key: string;
  /** Coverage-gated, ZIP-scoped fetch. MUST NOT throw: quarantine and continue. */
  forZip(
    zip: string,
    communities: CommunityRow[],
    entries: E[],
    deps: AdapterDeps,
  ): Promise<{ sites: NormalizedRecord[]; reports: R[] }>;
}

/**
 * PLATFORM POLICY — the deliberately NON-shared surface (see the header note). An adapter
 * declares how it parses its platform's dates/numbers/URLs. These differ by real,
 * measured semantics; the contract names them instead of pretending they are the same.
 */
export interface RecordCodec {
  isoDay(v: unknown): string | null;
  numOrNull(v: unknown): number | null;
  extractUrl(v: unknown): string | null | string;
  fillTemplate(tpl: string, row: Record<string, unknown>, caseNo: string | null): string | null;
  rowId(row: Record<string, unknown>): string | null;
}

// ───────────────── shared helpers — ONLY the provably-safe ones ─────────────────

/**
 * Read a mapped column: a single value, or an array of columns joined by spaces.
 *
 * SUPERSET-SAFE HOIST: this is socrata's variant, which adds dot-path support for nested
 * columns (Montgomery County MD's `location.latitude`). The path walk runs ONLY when
 * `row[ref] === undefined && ref.includes(".")`, so for every flat ref — i.e. every
 * arcgis/ckan/csv/carto mapping — it returns `row[ref]`, byte-identical to their copies.
 */
export function readCol(row: Record<string, unknown>, ref?: ColumnRef): unknown {
  if (!ref) return undefined;
  if (Array.isArray(ref)) {
    const parts = ref.map((c) => row[c]).filter((v) => v != null && String(v).trim() !== "").map((v) => String(v).trim());
    return parts.length ? parts.join(" ") : undefined;
  }
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

/** First column of a ref (the one used for source-side WHERE clauses). */
export function firstCol(ref?: ColumnRef): string | null {
  if (!ref) return null;
  return Array.isArray(ref) ? (ref[0] ?? null) : ref;
}

/** Trimmed string, or null when absent/blank. (All five copies were equivalent.) */
export function valOrNull(v: unknown): string | null {
  const s = v == null ? "" : String(v).trim();
  return s === "" ? null : s;
}

/**
 * status → bucket, exact after trim. Later buckets never override earlier ones (a status
 * should appear in exactly one; if duplicated, first wins and the registry is the bug).
 * FAIL-CLOSED: a status in no bucket is excluded and surfaced in the run report.
 * (All five copies were semantically identical — forEach vs for-of only.)
 */
export function buildBucketLookup(s2b: StatusToBucket): Map<string, Bucket> {
  const m = new Map<string, Bucket>();
  for (const b of ["proposed", "approved", "operating", "exclude"] as Bucket[]) {
    for (const status of s2b[b] ?? []) { const k = status.trim(); if (!m.has(k)) m.set(k, b); }
  }
  return m;
}

/** Bucket → the page's lifecycle band. */
export const BUCKET_TO_TYPE: Record<Exclude<Bucket, "exclude">, "built" | "approved" | "proposed"> = {
  operating: "built", approved: "approved", proposed: "proposed",
};

/** Map layer from the (already source-derived) classification — never from the title. */
export function layerFor(useType: string): string {
  switch (useType.toLowerCase()) {
    case "industrial": return "industrial";
    case "utility": return "energy";
    case "residential": return "residential";
    case "commercial": return "commercial";
    case "civic/public": return "civic";
    default: return "development";     // Development / unclassified → neutral
  }
}

/** Coverage gate — exact string equality after trim+lowercase. A source never runs
 *  outside its declared coverage. (Identical in socrata + arcgis; the canonical copy.) */
export function coverageMatches(coverage: Coverage[], communities: CommunityRow[]): boolean {
  const norm = (s?: string | null) => String(s ?? "").trim().toLowerCase();
  for (const cov of coverage) {
    for (const c of communities) {
      if (norm(c.state) === norm(cov.state) && (!cov.county || norm(c.county) === norm(cov.county))) return true;
    }
  }
  return false;
}

// ───────────────── shared safety: the geocode geofence ─────────────────

/**
 * Geofence for GEOCODED points. SOURCE-SUPPLIED GEOMETRY IS NEVER FENCED — a real parcel
 * can legitimately sit far from a big county's centroid.
 *
 * Why (engine v20, measured): Census range-interpolation matches the same street name in
 * another city/state — Fort Worth permits rendered markers in Michigan and South Carolina,
 * a Cincinnati permit rendered in Missouri. A geocoded point is trusted only when
 *   (a) the matched-address ZIP equals the record's filed ZIP, AND
 *   (b) it sits within GEOCODE_FENCE_MI of the report ZIP centroid.
 * A miss NULLS the coordinates: the record stays listed as an area item (no content loss),
 * and the untrusted marker is never rendered (no fabrication).
 */
export const GEOCODE_FENCE_MI = 25;

/** Equirectangular distance in miles — plenty at fence scale. */
export function milesBetween(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = (lat2 - lat1) * 69;
  const dLng = (lng2 - lng1) * 69 * Math.cos(((lat1 + lat2) / 2) * Math.PI / 180);
  return Math.sqrt(dLat * dLat + dLng * dLng);
}

/** The fence decision, extracted so every adapter can apply the identical rule. */
export function geofenceVerdict(
  g: GeocodeHit,
  filedZip: string | null,
  zipCentroid?: { lat: number; lng: number },
): { ok: true } | { ok: false; reason: string } {
  const matchedZip = ((g.matched_address || "").match(/\b(\d{5})(?:-\d{4})?\s*$/)?.[1]) ?? null;
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

// ───────────────── shared safety: rate limiting / retries ─────────────────

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Shared backoff policy: retry on 429 + 5xx with exponential delay, throw on other
 * non-2xx, give up after `attempts`. Adapters pass their own headers/parser because
 * platforms differ (JSON vs text vs CSV) — the RETRY POLICY is what is shared.
 */
export async function fetchWithBackoff(
  url: string,
  init: RequestInit,
  doFetch: typeof fetch,
  opts: { attempts?: number; baseDelayMs?: number; timeoutMs?: number } = {},
): Promise<Response> {
  const attempts = opts.attempts ?? 4;
  let delay = opts.baseDelayMs ?? 800;
  for (let i = 0; i < attempts; i++) {
    const res = await doFetch(url, { ...init, signal: AbortSignal.timeout(opts.timeoutMs ?? 30000) });
    if (res.status === 429 || res.status >= 500) { await sleep(delay); delay *= 2; continue; }
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return res;
  }
  throw new Error(`rate-limited/5xx after retries: ${url}`);
}

// ───────────────── registry validation (CI gate, not a runtime path) ─────────────────

/**
 * Structural validation of a jurisdiction-registry entry. Catches malformed config in CI
 * instead of in production, where a bad entry currently just yields 0 records silently.
 * Returns [] when the entry is well-formed.
 */
export function validateRegistryEntry(e: Record<string, unknown>, sourceClass: string): string[] {
  const errs: string[] = [];
  const id = String(e.registry_id ?? "(missing registry_id)");
  const req = (k: string) => { if (e[k] == null || String(e[k]).trim() === "") errs.push(`${id}: missing ${k}`); };
  req("registry_id"); req("platform"); req("jurisdiction"); req("dataset_url");
  if (e.platform !== sourceClass) errs.push(`${id}: platform "${String(e.platform)}" != section "${sourceClass}"`);

  const cov = e.coverage;
  if (!Array.isArray(cov) || cov.length === 0) errs.push(`${id}: coverage must be a non-empty array`);
  else for (const c of cov as Record<string, unknown>[]) {
    if (!c || typeof c !== "object" || !c.state) errs.push(`${id}: every coverage entry needs a state`);
  }

  const cm = e.column_map as Record<string, unknown> | undefined;
  if (!cm || typeof cm !== "object") errs.push(`${id}: column_map is required`);
  else if (cm.title == null) errs.push(`${id}: column_map.title is required`);

  // A record needs a derivable status: a mapped column, or a dataset-level constant.
  const hasStatusCol = !!(cm && cm.status_raw);
  if (!hasStatusCol && (e.status_const == null || String(e.status_const).trim() === "")) {
    errs.push(`${id}: needs column_map.status_raw or status_const (fail-closed status)`);
  }
  const s2b = (e.status_to_bucket ?? {}) as Record<string, unknown>;
  if (typeof s2b !== "object") errs.push(`${id}: status_to_bucket must be an object`);

  // status_const has TWO DIFFERENT SEMANTICS across platforms — verified in source, and
  // exactly the kind of divergence this validator exists to police:
  //   • socrata.ts:68  status_const?: "proposed" | "approved" | "operating"
  //                    line 225 assigns it DIRECTLY to `bucket` — status_to_bucket is bypassed,
  //                    which is why the live socrata entries carry `status_to_bucket: {}`.
  //   • arcgis.ts:86   status_const?: string
  //                    line 207 feeds it into statusRaw, which is then bucketed THROUGH
  //                    status_to_bucket (Detroit/Cleveland/Nashville: const "Issued" →
  //                    status_to_bucket.approved ["Issued"]).
  // Validating one rule for both is wrong in one direction or the other, so the rule is
  // selected by section. ckan/csv/carto declare no status_const at all today.
  const konst = e.status_const == null ? "" : String(e.status_const).trim();
  if (konst !== "") {
    if (sourceClass === "socrata") {
      if (!["proposed", "approved", "operating"].includes(konst)) {
        errs.push(`${id}: socrata status_const must be a bucket name (proposed|approved|operating), got "${konst}"`);
      }
    } else {
      const all = Object.values(s2b).flatMap((v) => (Array.isArray(v) ? v.map(String) : []));
      if (!all.map((s) => s.trim()).includes(konst)) {
        errs.push(`${id}: status_const "${konst}" is not present in status_to_bucket`);
      }
    }
  }
  // include_types without a type_map leaves every record unclassified.
  if (Array.isArray(e.include_types) && (e.include_types as unknown[]).length) {
    const tm = (e.type_map ?? {}) as Record<string, unknown>;
    for (const t of e.include_types as string[]) {
      if (tm[t] == null) errs.push(`${id}: include_types "${t}" has no type_map entry`);
    }
  }
  const prec = e.record_url_precision;
  if (prec != null && prec !== "record" && prec !== "dataset") {
    errs.push(`${id}: record_url_precision must be "record" or "dataset"`);
  }
  return errs;
}
