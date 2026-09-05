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
  Bucket, ColumnMap, ColumnRef, FileDateKind, NormalizedRecord, StatusToBucket,
  ExcludedStatus, UnmappedStatus, CaseFoldMatch, NormalizedLookup,
} from "./socrata.ts";
import {
  buildBucketLookup, buildTypeLookup, resolveNormalized, noteCaseFold, caseFoldList,
} from "./socrata.ts";
import { fenceGeocode } from "./geo-fence.ts";
import { applyCommercialWorkEvidence } from "./commercial-eligibility.ts";
import type { CommercialWorkEvidence } from "./commercial-eligibility.ts";
import { buildGeocodeInput } from "./geo-input.ts";

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
  /** OPT-IN: assemble a COMPLETE one-line address (street + city-from-jurisdiction + state +
   *  ZIP) before geocoding, instead of sending the bare address column. Set true ONLY for
   *  connectors whose address column is a bare street line the Census geocoder can't match
   *  (verified 2026-07-22). Absent/false ⇒ prior behavior. See sources/geo-input.ts. */
  geocode_assemble?: boolean;
  coverage: { state: string; county?: string }[];
  column_map: ColumnMap;
  type_map?: Record<string, string>;
  status_to_bucket: StatusToBucket;
  record_url_template?: string;
  /** Columns whose values (joined with "|") form the source_id record segment,
   *  INSTEAD of case_number. Use when the case-number column is not a record
   *  identifier. Fails closed: any missing/empty field falls back to case_number. */
  identity_fields?: string[];
  record_url_precision?: "record" | "dataset";
  /** false → not run in ZIP-aggregate mode. Default true. */
  zip_mode?: boolean;
  /** updated-at column for incremental `where`; also the paging sort key when present. */
  incremental_field?: string;
  /** drop rows whose file_date/incremental_field is older than N days. Absent ⇒ no filter. */
  /** Optional: what `column_map.file_date` MEANS on this dataset —
   *  "filed" | "issued" | "scheduled" | "estimated" | "decided". Absent ⇒ "filed".
   *  Declared, never inferred; it is what the page labels the date with. */
  file_date_kind?: FileDateKind;
  recency_days?: number;
  /** hard cap on rows pulled per dataset. Default 20000. */
  max_rows?: number;
  /** Optional outFields PROJECTION (additive): fetch ONLY these attribute columns
   *  instead of "*". Dense-metro layers with wide rows (Miami: 44 columns/permit)
   *  blow the edge worker's CPU budget at outFields=* — project the mapped columns.
   *  Absent ⇒ "*" (every existing entry behaves byte-identically). */
  out_fields?: string[];
  /** Optional page size for the query loop (additive). Some hosted layers respond
   *  slowly to edge-runtime egress (~30s/request regardless of size — Miami), so
   *  fewer, larger pages keep the report inside the worker budget. Cap at the
   *  layer's maxRecordCount. Absent ⇒ 1000 (existing behavior). */
  page_size?: number;
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
  /** Dataset-level use_type for layers whose only type-bearing column is FREE TEXT, i.e. a
   *  vocabulary that cannot be enumerated and therefore cannot be mapped (Rule 5 terminal).
   *  The MIRROR of status_const, and subject to the same discipline: it is a constant because
   *  the publisher states no classifiable type, NEVER an override for a layer that has one --
   *  entries with a mappable type_source keep mapping it, and setting both is a config error
   *  the loader rejects below.
   *
   *  It must be a member of the CLOSED use_type vocabulary (lib/map.js::TYPE_EXACT). For a
   *  heterogeneous land-use case list the honest member is "Development" -- the generic value
   *  that renders the "Other project" pin and asserts nothing about the use (the Phoenix
   *  residual-bucket precedent). Do NOT reach for a specific type to make an entry look
   *  complete; that is fabrication with extra steps.
   *
   *  Worked case: Sussex County DE conditional-use applications. proposed_use is free prose
   *  ("operate a food truck for a period exceeding three days"), 400+ values mostly n=1, so no
   *  type_map exists. current_zoning IS a closed 38-value vocabulary but describes the PARCEL,
   *  not the PROPOSAL -- a conditional use is by definition something the zoning does not
   *  already allow, so mapping AR-1 to Residential would label an electrical substation
   *  "Residential". Constant "Development" is the only non-fabricating option. */
  use_type_const?: string;
  /** ENGINE-LEVEL option — consumed by sources/yields.ts at report assembly, NOT by this
   *  connector's fetch path (declared here so the option-surface guard knows it is real).
   *  Names a sibling entry this entry yields to: a record drops ONLY when the named entry
   *  emitted the SAME case_number in the SAME report assembly. If the yielded-to fetch
   *  failed or returned nothing this cycle there is nothing to yield to and every record
   *  survives — an outage degrades to dual-source absence, never silent record loss.
   *  Full contract + tests: sources/yields.ts, test/yields-hook.test.mjs. First consumer:
   *  ar-ardot-job-status-points → ar-ardot-job-status-lines (the 60 dual-representation
   *  ARDOT jobs). */
  yields_to?: string;
  /** Optional ZIP-scoping override for layers with NO ZIP column but a ZIP embedded in a text
   *  field (e.g. a full "…, UT 84604" address). A VERBATIM SQL template with a `{zip}` token,
   *  used as the ZIP clause INSTEAD of `{zip_col}='{zip}'` (e.g.
   *  "Address LIKE '%UT {zip}%'"). When present, column_map.zip is not required. The point
   *  geometry still supplies the precise location; this only scopes which rows the ZIP pulls. */
  /** VERBATIM whitelist on the column_map.type_source column — the SQL twin of csv.ts's
   *  parse-time filter, pushed down as `{typeCol} IN ('a','b',…)` so rows are dropped AT
   *  SOURCE. Pushed down rather than filtered post-fetch on purpose: a post-fetch filter
   *  lets a max_rows cap bind on rows the whitelist would have removed, silently costing
   *  whitelisted records.
   *  ⚠️ THIS OPTION WAS csv-ONLY UNTIL 2026-08-03 AND WAS SILENTLY IGNORED HERE. Six arcgis
   *  entries carried it, each mirroring its own type_map, so their intended noise filter did
   *  nothing — and because an unmapped TYPE does not fail closed (unlike an unmapped status;
   *  see normalizeRow's `|| "unclassified"`), the rows published anyway. Measured live before
   *  the fix: columbus 40,469 of 42,067 records (96.2%) unclassified, cincinnati 72.5%,
   *  nashville 39.5%, portland 7.6% — ~52,000 records beyond intent.
   *  Requires a SINGLE type_source column: column_map arrays JOIN their values here (the UDOT
   *  standing answer), so an array cannot be expressed as a column IN (…) and the entry is
   *  QUARANTINED rather than silently unfiltered. Absent ⇒ no type filter. */
  include_types?: string[];
  /** COMMERCIAL WORK-EVIDENCE GATE (founder Commercial product rule, 2026-09-05).
   *  Requires source-native evidence about the WORK before a record may be Commercial, so a
   *  property's occupancy/zoning/land-use can no longer make a standalone trade, sign,
   *  business-licence or administrative record into a commercial development object.
   *  Scoped to Commercial BY CONSTRUCTION — see sources/commercial-eligibility.ts, which also
   *  explains why this is not expressible as `extra_where` on a mixed-type entry.
   *  Absent ⇒ behaviour unchanged. */
  commercial_work_evidence?: CommercialWorkEvidence;
  /** Escape hatch for layers whose date column is a STRING, where recency_days' `DATE '…'`
   *  literal cannot apply (the frisco / worcester / anaheim class). Verbatim clause with
   *  `{cutoff}` → 'YYYY-MM-DD' and `{cutoff_compact}` → 'YYYYMMDD' substituted; requires
   *  recency_days to supply the cutoff. The socrata twin, added 2026-08-03 — socrata gained
   *  recency_expr after the nyc-dob defect while arcgis had NO fallback at all, which is why
   *  worcester needed a hardcoded `LIKE '%/2025'` window that goes blind every January.
   *  Absent ⇒ default behaviour, unchanged. */
  recency_expr?: string;
  zip_where_template?: string;
  /** SPATIAL ZIP-scoping for point layers with NO ZIP column and no ZIP anywhere in a text
   *  field (e.g. Denver's construction-permit layers: ADDRESS has no ZIP). Queries an
   *  ArcGIS envelope of ± this many miles around the ZIP centroid (deps.zipCentroid) — the
   *  engine's standard centroid+radius ZIP approximation (same shape as the EPA FRS floor
   *  and ZIP_RADIUS_MI). Records still place by their OWN per-parcel geometry; nothing is
   *  guessed. When present, column_map.zip / zip_where_template are not required. */
  spatial_zip_radius_mi?: number;
  /** ATTRIBUTE-BBOX spatial scoping for geometry-less TABLES that carry per-record
   *  Latitude/Longitude COLUMNS instead (e.g. Scottsdale's OpenData_Tabular permits —
   *  the Detroit-tables cousin). Pair with spatial_zip_radius_mi: instead of an ArcGIS
   *  geometry-envelope param (meaningless on a table), the envelope is AND'd into WHERE
   *  as `lat_col BETWEEN ymin AND ymax AND lng_col BETWEEN xmin AND xmax`. Rows still
   *  place by their OWN column coordinates (column_map.lat/lng); nothing is guessed. */
  spatial_latlng_cols?: { lat: string; lng: string };
  /** POLYGON layers: ask the SERVER for its own polygon centroid (`returnCentroid=true`),
   *  returned per feature as `{centroid:{x,y}}` alongside the rings. OPT-IN per entry, never
   *  automatic, because the parameter is not universally supported and failure modes differ:
   *   • hosted ArcGIS Online / Enterprise ≥10.9.1 FeatureServers honor it (verified live:
   *     clark-county-active-projects, douglas-county-major-projects);
   *   • classic ArcGIS Server MapServer layers SILENTLY IGNORE it (verified live: the
   *     Houston PlatTracker, Harris Plats, Fort Worth zoning, NRH zoning and Washoe Accela
   *     layers all return rings with no `centroid` key);
   *   • NON-polygon layers HARD-REJECT it — a polyline layer answers HTTP 200 with
   *     `{"error":{"code":400,…"Return geometry centroid is only supported on layer with
   *     polygon geometry type."}}`, which the connector treats as a failed fetch (verified
   *     live: txdot-projects-info-all). Never set this on a point or polyline entry.
   *  Absent/false ⇒ the query string is byte-identical to before, so every point entry is
   *  unaffected. When the param is ignored or absent, featurePoint() still derives the same
   *  centroid from the feature's own rings — this option only prefers the server's value. */
  return_centroid?: boolean;
}

export interface ArcgisRunReport {
  registry_id: string;
  service_url: string;
  fetched: number;
  emitted: number;
  excluded_by_status: ExcludedStatus[];
  unmapped_statuses: UnmappedStatus[];
  /** matched a registry key only after case-folding — NON-failing drift note */
  case_insensitive_matches: CaseFoldMatch[];
  blank_status: number;
  geocode_failures: number;
  no_record_url: number;
  /** Records the Commercial work-evidence gate downgraded to "other project". */
  commercial_downgraded: number;
  quarantined: { reason: string; sample: string }[];
  /** non-null ⇒ the max_rows cap bound the fetch and this report is INCOMPLETE. */
  truncated_at_max_rows: number | null;
}

/** Set by fetchRows when the max_rows cap BOUND the fetch — i.e. the source has MORE matching
 *  records than this report contains. Silent truncation is the dangerous shape: a capped result and
 *  a complete one are indistinguishable apart from the count, so a truncated page reads as "we have
 *  everything". (2026-08-02 hardening — see QUEUE.md "the 20,000 is a SILENT CAP".) */
interface FetchMeta { truncated: boolean; cap: number }

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
    case_insensitive_matches: [],
    blank_status: 0, geocode_failures: 0, no_record_url: 0, commercial_downgraded: 0, quarantined: [], truncated_at_max_rows: null,
  };
  const records: NormalizedRecord[] = [];

  // use_type_const AND type_map may be set TOGETHER (2026-08-03 founder ruling). They are not in
  // competition — they answer different questions, and the difference is load-bearing:
  //   • type_map      — the publisher STATED a value; we classify it. Absent from the map ⇒ WE
  //                     chose not to classify it ⇒ `unclassified`.
  //   • use_type_const — the publisher stated NOTHING. That is honest absence, not a mapping gap,
  //                     and the record is still real (located, dated, filed). It renders under the
  //                     generic member rather than as a missing classification.
  // See normalizeRow: the constant fills ONLY on an EMPTY source value, never on a present-but-
  // unmapped one — collapsing those two would erase exactly the distinction this permits.
  // (Adams County's 21,506 blank `BuildingUse` rows are the case; its 6 stated values still map.)

  // A whitelist that cannot be expressed is FAIL-CLOSED, never silently unfiltered — the whole
  // point of implementing this option is that an ignored filter published ~52,000 unintended
  // records. Emitting everything here would reproduce exactly that, just with new code.
  if (entry.include_types?.length && !soleTypeCol(entry)) {
    report.quarantined.push({
      reason: "config error: include_types set but column_map.type_source is absent or a multi-column array "
        + "(arrays JOIN their values, so no single column holds the whitelisted string) — cannot filter, entry skipped",
      sample: entry.service_url,
    });
    return { records, report };
  }

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

  // Registry maps are normalized (trim + case-fold) with a collision guard — see the shared
  // helpers in sources/socrata.ts. An unresolvable collision quarantines THIS entry only.
  let lookup: NormalizedLookup<Bucket>;
  let typeLookup: NormalizedLookup<string> | null;
  try {
    lookup = buildBucketLookup(entry.status_to_bucket, entry.registry_id);
    typeLookup = buildTypeLookup(entry.type_map, entry.registry_id);
  } catch (e) {
    report.quarantined.push({ reason: `registry map collision: ${(e as Error).message}`, sample: entry.service_url });
    return { records, report };
  }
  const excludeCount = new Map<string, number>();
  const unmappedCount = new Map<string, number>();
  const caseFold = new Map<string, CaseFoldMatch>();
  const unmappedSample = new Map<string, string>();   // status → first case/permit no seen

  const fetchMeta: FetchMeta = { truncated: false, cap: 0 };
  let rows: Record<string, unknown>[];
  try {
    rows = await fetchRows(entry, zip, zipCol ?? "", deps, fetchMeta);
  } catch (e) {
    report.quarantined.push({ reason: `fetch failed: ${(e as Error).message}`, sample: entry.service_url });
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
    const statusRaw = String(entry.status_const ?? readCol(row, entry.column_map.status_raw) ?? "").trim();
    if (!statusRaw) { report.blank_status++; continue; }
    const hit = resolveNormalized(lookup, statusRaw);
    const bucket = hit.value;
    if (bucket === undefined) {                                        // unmapped → exclude + FLAG
      unmappedCount.set(statusRaw, (unmappedCount.get(statusRaw) ?? 0) + 1);
      // Name a concrete record so the flag is actionable, not just a count.
      if (!unmappedSample.has(statusRaw)) {
        const cn = valOrNull(readCol(row, entry.column_map.case_number));
        if (cn) unmappedSample.set(statusRaw, String(cn));
      }
      continue;
    }
    if (hit.caseInsensitive) noteCaseFold(caseFold, "status", statusRaw, hit.matchedKey);
    if (bucket === "exclude") { excludeCount.set(statusRaw, (excludeCount.get(statusRaw) ?? 0) + 1); continue; }
    const rec = await normalizeRow(row, entry, statusRaw, bucket, zip, deps, report, typeLookup, caseFold);
    if (rec) records.push(rec);
  }

  report.emitted = records.length;
  report.excluded_by_status = [...excludeCount].map(([status, count]) => ({ status, count })).sort((a, b) => b.count - a.count);
  report.unmapped_statuses = [...unmappedCount].map(([status, count]) => ({ status, count, sample: unmappedSample.get(status) ?? null })).sort((a, b) => b.count - a.count);
  report.case_insensitive_matches = caseFoldList(caseFold);
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
  // A mapped value always wins; the constant only fills where the publisher states no
  // classifiable type at all. Mirrors status_const, and still never guesses from the title.
  // The constant applies when the entry declares NO type_map at all (its original meaning,
  // byte-for-byte unchanged for every such entry), or when the publisher left the mapped column
  // EMPTY. A value that is PRESENT but unmapped still falls through to `unclassified` — that is
  // the unmapped-vs-empty distinction, and it must survive.
  const constantApplies = !typeLookup || !typeSrcVal;
  const classifiedType = typeHit?.value || (constantApplies ? entry.use_type_const : undefined) || "unclassified";
  // COMMERCIAL WORK-EVIDENCE GATE — founder rule, 2026-09-05. A no-op for every non-Commercial
  // type and for every entry that declares no rule; see sources/commercial-eligibility.ts.
  const commercialGate = applyCommercialWorkEvidence(
    classifiedType, entry.commercial_work_evidence,
    (col) => readCol(row, col), soleTypeCol(entry),
  );
  if (commercialGate.downgraded) report.commercial_downgraded++;
  const useType = commercialGate.useType;

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
    // behavior (bare address to the geocoder; filedZip = zip column / reportZip). ON ⇒ build a
    // COMPLETE one-line address first (city from jurisdiction, state from coverage, ZIP from
    // the mapped column / embedded / reportZip) — a bare street line does not match the Census
    // geocoder (measured). resolveGeocode()/cache/fence are unchanged either way.
    const gi = entry.geocode_assemble
      ? buildGeocodeInput({ rawAddress: address, jurisdiction: entry.jurisdiction, state: entry.coverage[0]?.state, zipColValue: valOrNull(readCol(row, cm.zip)), reportZip })
      : { input: address, filedZip: (String(readCol(row, cm.zip) ?? "").match(/\b\d{5}\b/)?.[0]) || reportZip || null };
    const g = await deps.geocode(gi.input);
    if (!g) { report.geocode_failures++; report.quarantined.push({ reason: "geocode failed", sample: gi.input }); lat = null; lng = null; geoPrecision = "jurisdiction"; scope = "area"; }
    else {
      // GEOFENCE (anti-fabrication): a geocoded point is trusted only when the geocoder's
      // own output agrees with where the record is filed. Census range-interpolation can
      // match the same street name in another city/state (live example: a Fort Worth permit
      // rendered in Michigan). Two local checks, no extra lookups; a miss NULLS the coords —
      // the record stays listed as an area item, the untrusted marker is never rendered.
      // filedZip from the complete-address builder: mapped ZIP column → ZIP embedded in the
      // address (the Clark County fix: fence against the address's OWN ZIP, not the report
      // ZIP) → reportZip. Same fence comparison as before, just a more accurate filed ZIP.
      const verdict = fenceGeocode(g, gi.filedZip, deps.zipCentroid);
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

  const rec: NormalizedRecord = {
    source_id: `arcgis:${entry.registry_id}:${identityFromFields(row, entry.identity_fields) ?? caseNo ?? rowId(row) ?? title}`,
    source_class: "arcgis",
    source_registry_id: entry.registry_id,
    jurisdiction: entry.jurisdiction,
    label: (title || caseNo || "Development record").slice(0, 120),
    title,
    use_type: useType,
    type_raw: typeSrcVal || null,   // verbatim publisher value, pre-map (see NormalizedRecord)
    bucket,
    type: BUCKET_TO_TYPE[bucket],
    relevance: "development",
    rel_rule: `source:arcgis:${entry.registry_id}`,
    layer: layerFor(useType),
    status_raw: statusRaw,
    file_date: isoDay(readCol(row, cm.file_date)),
    file_date_kind: entry.file_date_kind ?? "filed",
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

/** An ArcGIS query feature. Geometry is a point ({x,y}), a polygon ({rings}) or a
 *  polyline ({paths}); `centroid` rides alongside only when return_centroid was honored. */
export interface ArcgisFeature {
  attributes?: Record<string, unknown>;
  geometry?: { x?: number; y?: number; rings?: number[][][]; paths?: number[][][] };
  centroid?: { x?: number; y?: number };
}

const finite2 = (x: unknown, y: unknown): { lng: number; lat: number } | null =>
  typeof x === "number" && typeof y === "number" && Number.isFinite(x) && Number.isFinite(y)
    ? { lng: x, lat: y }
    : null;

/**
 * The map pin for one feature, taken from the feature's OWN geometry — never guessed, never
 * defaulted to a jurisdiction centre. A feature that yields no point returns null and the
 * record is placed exactly as before (geocode the address, else area scope).
 *
 * Order of preference:
 *   1. POINT geometry {x,y} — the original and only path before this; unchanged.
 *   2. The SERVER's polygon centroid (return_centroid, hosted FeatureServers only).
 *   3. POLYGON rings → the area-weighted (shoelace) centroid, computed here. Signed ring
 *      areas make holes and multipart polygons subtract/add correctly. Validated against
 *      the server's own centroid on the two layers that publish both: agreement was
 *      2.6e-5° (~2.9 m, clark-county-active-projects) and 8.3e-6° (~0.9 m,
 *      douglas-county-major-projects) — the same quantity at pin precision, the residual
 *      being planar-degree vs geodesic arithmetic. A degenerate (zero-area) ring set falls
 *      back to the mean vertex.
 *   4. POLYLINE paths → the point at half the cumulative length of the LONGEST path, i.e.
 *      a point that lies ON the line (a road project pins to the middle of its segment).
 *      A polyline has no centroid endpoint upstream — the server rejects returnCentroid
 *      outright — so this is the only way such a record can carry a marker.
 */
export function featurePoint(f: ArcgisFeature): { lng: number; lat: number } | null {
  const g = f.geometry;
  const asPoint = finite2(g?.x, g?.y);
  if (asPoint) return asPoint;

  const server = finite2(f.centroid?.x, f.centroid?.y);
  if (server) return server;

  const rings = g?.rings;
  if (Array.isArray(rings) && rings.length) {
    let a2 = 0, cx = 0, cy = 0, sx = 0, sy = 0, n = 0;
    for (const ring of rings) {
      if (!Array.isArray(ring)) continue;
      for (let i = 0; i < ring.length; i++) {
        const p = ring[i];
        if (!finite2(p?.[0], p?.[1])) continue;
        sx += p[0]; sy += p[1]; n++;
        const q = ring[i + 1];
        if (!finite2(q?.[0], q?.[1])) continue;
        const cross = p[0] * q[1] - q[0] * p[1];
        a2 += cross; cx += (p[0] + q[0]) * cross; cy += (p[1] + q[1]) * cross;
      }
    }
    if (a2 !== 0) {
      const out = finite2(cx / (3 * a2), cy / (3 * a2));
      if (out) return out;
    }
    if (n > 0) return finite2(sx / n, sy / n);  // degenerate ring (zero area) — mean vertex
    return null;
  }

  const paths = g?.paths;
  if (Array.isArray(paths) && paths.length) {
    let best: number[][] | null = null, bestLen = -1;
    for (const path of paths) {
      if (!Array.isArray(path) || path.length < 2) continue;
      let len = 0;
      for (let i = 0; i + 1 < path.length; i++) {
        const p = path[i], q = path[i + 1];
        if (!finite2(p?.[0], p?.[1]) || !finite2(q?.[0], q?.[1])) continue;
        len += Math.hypot(q[0] - p[0], q[1] - p[1]);
      }
      if (len > bestLen) { bestLen = len; best = path; }
    }
    if (!best) return null;
    if (bestLen <= 0) return finite2(best[0]?.[0], best[0]?.[1]);
    let walked = 0;
    for (let i = 0; i + 1 < best.length; i++) {
      const p = best[i], q = best[i + 1];
      if (!finite2(p?.[0], p?.[1]) || !finite2(q?.[0], q?.[1])) continue;
      const seg = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (walked + seg >= bestLen / 2) {
        const t = seg === 0 ? 0 : (bestLen / 2 - walked) / seg;
        return finite2(p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t);
      }
      walked += seg;
    }
    const last = best[best.length - 1];
    return finite2(last?.[0], last?.[1]);
  }

  // MULTIPOINT (esriGeometryMultipoint) — a bare `points` array of [x, y] vertices.
  // Mean of the vertices, exactly as the polygon branch above degrades to a mean vertex
  // when a ring encloses zero area. A multipoint feature has no interior and no length,
  // so there is no centroid or midpoint to derive; the mean IS the honest representative
  // point, and it is what every consumer of this function wants (one pin per feature).
  //
  // WHY THIS BRANCH EXISTS. Without it a multipoint layer produced NO coordinate, so every
  // record fell through to `scope: "area"`, was anchored at the report centroid, and was
  // dropped by the point-scope-only `app_projects` materializer. Found live 2026-08-05 on
  // lake-county-il-construction-program: 77 records across 27 ZIPs in development_reports
  // and ZERO in app_projects, while the polyline (Cook) and polygon (Champaign) entries
  // wired the same day materialized normally. Nothing was fabricated and the records still
  // rendered — but 27 Lake pages served dated records with no pins.
  const points = g?.points;
  if (Array.isArray(points) && points.length) {
    let sx = 0, sy = 0, n = 0;
    for (const p of points) {
      if (!finite2(p?.[0], p?.[1])) continue;
      sx += p[0]; sy += p[1]; n++;
    }
    if (n > 0) return finite2(sx / n, sy / n);
    return null;
  }

  return null;
}

async function fetchRows(
  entry: ArcgisRegistryEntry,
  zip: string,
  zipCol: string,
  deps: ArcgisDeps,
  meta: FetchMeta,
): Promise<Record<string, unknown>[]> {
  const pageSize = entry.page_size ?? deps.pageSize ?? 1000;
  const maxRows = entry.max_rows ?? 20000;
  const outSr = entry.out_sr ?? 4326;
  const where = buildWhere(entry, zip, zipCol);
  const orderBy = entry.incremental_field ? `${entry.incremental_field} DESC` : "";

  // Spatial ZIP scoping (entry-driven): an envelope of ±radius miles around the ZIP centroid,
  // for point layers with no ZIP attribute anywhere. Standard ArcGIS spatial query params.
  // ATTRIBUTE-BBOX mode (spatial_latlng_cols): geometry-less tables with lat/lng COLUMNS get
  // the same envelope AND'd into WHERE instead — a geometry param is meaningless on a table.
  const attrCols = entry.spatial_latlng_cols;
  const env = (entry.spatial_zip_radius_mi ?? 0) > 0 && deps.zipCentroid
    ? envelopeFor(deps.zipCentroid.lat, deps.zipCentroid.lng, entry.spatial_zip_radius_mi as number)
    : null;
  const spatial = env && !attrCols ? env : null;
  const attrWhere = env && attrCols
    ? ` AND (${attrCols.lat} >= ${env.ymin} AND ${attrCols.lat} <= ${env.ymax} AND ${attrCols.lng} >= ${env.xmin} AND ${attrCols.lng} <= ${env.xmax})`
    : "";

  const out: Record<string, unknown>[] = [];
  let offset = 0;
  // Deliberately `<=`: fetch ONE row past the cap so truncation is EXACT. A full final page
  // does NOT prove more rows exist — a source holding precisely max_rows records is COMPLETE, and
  // inferring truncation from a full page would cry wolf on exactly that case.
  while (out.length <= maxRows) {
    const url = new URL(`${entry.service_url.replace(/\/$/, "")}/query`);
    url.searchParams.set("where", where + attrWhere);
    if (spatial) {
      url.searchParams.set("geometry", `${spatial.xmin},${spatial.ymin},${spatial.xmax},${spatial.ymax}`);
      url.searchParams.set("geometryType", "esriGeometryEnvelope");
      url.searchParams.set("inSR", "4326");
      url.searchParams.set("spatialRel", "esriSpatialRelIntersects");
    }
    url.searchParams.set("outFields", entry.out_fields?.length ? entry.out_fields.join(",") : "*");
    url.searchParams.set("returnGeometry", "true");
    // Polygon layers only, opt-in (see return_centroid): ask the server for its own centroid.
    // Absent ⇒ this param is never sent, so point entries keep their exact prior query string.
    if (entry.return_centroid) url.searchParams.set("returnCentroid", "true");
    url.searchParams.set("outSR", String(outSr));
    url.searchParams.set("resultOffset", String(offset));
    url.searchParams.set("resultRecordCount", String(pageSize));
    if (orderBy) url.searchParams.set("orderByFields", orderBy);
    url.searchParams.set("f", "json");
    const page = await getWithBackoff(url.toString(), deps) as {
      features?: ArcgisFeature[];
      exceededTransferLimit?: boolean;
      error?: { message?: string };
    };
    if (page?.error) throw new Error(`ArcGIS error: ${page.error.message ?? "unknown"}`);
    const feats = Array.isArray(page?.features) ? page.features : [];
    if (feats.length === 0) break;
    for (const f of feats) {
      const row = { ...(f.attributes ?? {}) } as Record<string, unknown>;
      // flatten the feature's OWN geometry so a column_map can read lat/lng from
      // __lat/__lng (mirrors the socrata geojson flatten). ArcGIS geometry with
      // outSR=4326 is {x:lng,y:lat}.
      const pt = featurePoint(f);
      if (pt) { row.__lng = pt.lng; row.__lat = pt.lat; }
      out.push(row);
    }
    // SERVER-CAPPED PAGING (fixed 2026-08-03). A layer may cap page size BELOW our request via its
    // own `maxRecordCount` — Portland's is 200 against a default pageSize of 1000 — and answers with
    // a short page plus `exceededTransferLimit: true` meaning "there IS more". Two defects lived here:
    //   • the old `feats.length < pageSize` break SHORT-CIRCUITED before the exceededTransferLimit
    //     check that exists to catch exactly this, so every such layer stopped after ONE page.
    //     Measured: 3 separate Portland ZIPs cached exactly 200 records each.
    //   • `offset += pageSize` advanced by the REQUESTED size, not the RECEIVED count, so a
    //     server-capped page would also SKIP the difference (800 rows per page here) had the loop
    //     continued. Latent only because the break fired first — fixing one without the other would
    //     have turned silent truncation into silent gaps, which is worse.
    // Now: advance by what we actually received, and stop only when the server does not say there is
    // more AND the page came back short. `feats.length === 0` above still guards the empty case, and
    // the `out.length <= maxRows` loop condition still bounds it.
    offset += feats.length;
    // Order matters, and each line covers a case the other does not:
    //   • an EXPLICIT `false` means "that is all" even on a full page — the one thing the old
    //     condition got right, and which a naive rewrite drops (caught by this suite);
    //   • otherwise stop only on a SHORT page, so a server-capped page with `true` keeps going.
    if (page.exceededTransferLimit === false) break;
    if (page.exceededTransferLimit !== true && feats.length < pageSize) break;
  }
  // The cap bound the fetch iff we actually SAW a row beyond it.
  meta.truncated = out.length > maxRows;
  meta.cap = maxRows;
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
  // TYPE WHITELIST, pushed down at source. Only reachable with a single type_source column —
  // fetchRows quarantines the array case before we get here, so this never silently no-ops.
  const typeClause = includeTypesClause(entry);
  if (typeClause) clauses.push(typeClause);
  if (entry.recency_days && entry.recency_days > 0) {
    const cutoff = new Date(Date.now() - entry.recency_days * 86400000).toISOString().slice(0, 10);
    // recency_expr wins when present: the DATE literal below is invalid against a STRING
    // date column, and there was previously no way to express that here.
    if (entry.recency_expr && entry.recency_expr.trim()) {
      clauses.push(entry.recency_expr.trim()
        .replaceAll("{cutoff_compact}", cutoff.replaceAll("-", ""))
        .replaceAll("{cutoff}", cutoff));
    } else {
      const dateCol = firstCol(entry.column_map.file_date) || entry.incremental_field;
      if (dateCol) clauses.push(`${dateCol} >= DATE '${cutoff}'`);
    }
  }
  return clauses.join(" AND ");
}

/** `{typeCol} IN ('a','b',…)` for an entry's include_types, or null when it does not apply.
 *  Values are used VERBATIM (they are the publisher's own strings) with SQL quotes escaped. */
export function includeTypesClause(entry: ArcgisRegistryEntry): string | null {
  const list = entry.include_types;
  if (!list || !list.length) return null;
  const typeCol = soleTypeCol(entry);
  if (!typeCol) return null;                       // array/absent — quarantined in fetchRows
  const vals = list.map((v) => `'${String(v).trim().replaceAll("'", "''")}'`).join(",");
  return `${typeCol} IN (${vals})`;
}

/** The ONE type_source column, or null when type_source is absent or a multi-column array
 *  (arrays JOIN their values, so no single column carries the whitelisted string). */
export function soleTypeCol(entry: ArcgisRegistryEntry): string | null {
  const ts = entry.column_map.type_source;
  if (!ts) return null;
  if (Array.isArray(ts)) return ts.length === 1 ? String(ts[0]) : null;
  return String(ts);
}

async function getWithBackoff(url: string, deps: ArcgisDeps): Promise<unknown> {
  const headers: Record<string, string> = { "Accept": "application/json", "User-Agent": "HomeSignal public-records refresh (contact: admin@homesignal.net)" };
  // LONG-QUERY POST FALLBACK (Scottsdale class, 2026-07-16): classic ArcGIS Server on IIS
  // caps GET query strings at 2,048 chars (IIS maxQueryString → 404.15), so a long verbatim
  // type whitelist in the WHERE 404s as a GET. ArcGIS query endpoints accept the identical
  // parameters as a form-encoded POST — switch automatically when the URL would overflow.
  // Behavior-identical for every existing entry (their URLs are far under the cap).
  const qs = url.indexOf("?");
  const usePost = url.length > 1900 && qs > 0;
  const fetchUrl = usePost ? url.slice(0, qs) : url;
  const makeInit = (): RequestInit => usePost
    ? {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/x-www-form-urlencoded" },
        body: url.slice(qs + 1),
        signal: AbortSignal.timeout(30000),
      }
    : { headers, signal: AbortSignal.timeout(30000) };
  let delay = 800;
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await deps.fetch(fetchUrl, makeInit());
    if (res.status === 429 || res.status >= 500) { await sleep(delay); delay *= 2; continue; }
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${fetchUrl}`);
    return await res.json();
  }
  throw new Error(`rate-limited/5xx after retries: ${fetchUrl}`);
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

/**
 * ADDITIVE, default-off. When a registry entry declares `identity_fields`, the source_id's
 * record segment is built from those columns instead of case_number.
 *
 * WHY THIS EXISTS (measured 2026-08-10): case_number serves DISPLAY, and on some layers the
 * column that reads like a case number is not a record identifier. Brunswick County's
 * `PermitNumber` is a per-project SEQUENCE — value "1000" appears 57,543 times across
 * different projects and addresses — so every one of those records derived the same
 * source_id. Overloading case_number to fix identity would corrupt the displayed case
 * number instead; identity and presentation are separated here on purpose.
 *
 * FAIL CLOSED: every declared field must be present and non-empty. If any is missing the
 * function returns null and the caller falls back to the existing case_number/rowId ladder,
 * so a schema drift degrades to today's behaviour rather than silently minting a key like
 * "|1|" that would collide across unrelated records.
 */
export function identityFromFields(row: Record<string, unknown>, fields?: string[]): string | null {
  if (!fields?.length) return null;
  const parts: string[] = [];
  for (const f of fields) {
    const v = row[f];
    if (v == null) return null;
    const s = String(v).trim();
    if (s === "") return null;
    parts.push(s);
  }
  return parts.join("|");
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
  // YEAR-first slash form, e.g. "2023/01/03". Unambiguous (a 4-digit leading group can never
  // be a month or day) and disjoint from the two patterns above, so this only ever turns a
  // null into a date. Two live sources publish it as a STRING column and every row was being
  // silently dropped: virginia-beach-building-permits (IssueDate) and anaheim-land-use-cases
  // (Application_Received). docs/accuracy-audit-2026-08.md §H1.
  const ymd = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  if (ymd) return `${ymd[1]}-${ymd[2].padStart(2, "0")}-${ymd[3].padStart(2, "0")}`;
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

/** The geofence now lives in ONE place — sources/geo-fence.ts — because it was previously
 *  duplicated here and in socrata.ts and MISSING from ckan/carto/csv. Re-exported so existing
 *  importers and tests keep their entry point. */
export { GEOCODE_FENCE_MI, milesBetween } from "./geo-fence.ts";
