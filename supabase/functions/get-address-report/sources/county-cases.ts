// County land-use CASE connector — the per-record reader for a county whose planning cases are
// published ONLY as an HTML index (CivicPlus) with a map/tax-lot description in each case, and whose
// authoritative parcel layer is a public ArcGIS FeatureServer (first consumer: Tillamook County OR).
// ADDITIVE: a new source class beside socrata/arcgis/ckan/csv/carto; changes no existing source.
//
// Non-negotiables (same as the siblings):
//   • COVERAGE GATE: runs only when a resolved community matches the entry's coverage.
//   • LOCATION IS VERIFIED OR THERE IS NO PIN. A case is pinned only from the county's own parcel
//     layer, joined on the tax lots the case's own request text names (township / range / section /
//     lot). Never from an address, never inferred. Every named lot must resolve ( and the found parcels must lie together (max_spread_m); otherwise the case is
//     quarantined with the reason and NOT emitted (it stays a Government & civic notice elsewhere).
//   • STATUS IS THE COUNTY'S OWN WORD, mapped by an exact (case-folded) lookup. Unmapped → excluded and
//     reported. An "Appeal Period" status states that a decision was issued but not WHICH decision, so
//     the registry leaves it out rather than guess approved/denied.
//   • SIGNIFICANT CASES ONLY: a case must match `significant_if` and no `routine_if` pattern.
//   • record_url is the county's own case page. A case with none is dropped.
//   • The applicant / owner columns are never read.
import {
  coverageMatches, buildBucketLookup, resolveNormalized,
  type NormalizedRecord, type StatusToBucket, type FileDateKind,
} from "./socrata.ts";
import { decisionFor, decisionEvidenceLevel } from "./decision.ts";
import type { MembershipFn } from "./scope-members.ts";

export interface CountyCasesRegistryEntry {
  registry_id: string;
  platform: "county_cases";
  index_url: string;
  /** ArcGIS FeatureServer layer (…/FeatureServer/0) holding the county's parcels. */
  parcel_url: string;
  /** Parcel field carrying the joined map+tax-lot key, e.g. "5S1124AB01300". */
  parcel_key_field: string;
  dataset_url: string;
  jurisdiction: string;
  coverage: { state: string; county?: string }[];
  status_to_bucket: StatusToBucket;
  significant_if: string[];       // regex sources, matched case-insensitively against type + request
  routine_if?: string[];          // a match drops the case
  residential_if?: string[];      // a match maps use_type to Residential; otherwise "Development"
  /** "OR" etc. Used to bound the pin sanity box. */
  bbox: { min_lat: number; max_lat: number; min_lng: number; max_lng: number };
  file_date_kind?: FileDateKind;
  file_date_label?: string;
  date_label?: string;            // page label of the stated date, e.g. "Date of Notice"
  recency_days?: number;
  max_cases?: number;
  /** The county site's robots.txt asks for a crawl delay: min ms between requests to index_url's host (default 10000). */
  crawl_delay_ms?: number;
  /** Case pages read per run (date + hearing history). Bounded so the delay above cannot exhaust the report. */
  max_page_reads?: number;
  min_found_share?: number;       // default 1: every named lot must resolve
  max_spread_m?: number;          // default 1500
  record_url_precision?: "record" | "dataset";
  zip_mode?: boolean;
  spatial_zip_radius_mi?: number; // fallback ZIP scope when no polygon membership function is supplied
}

export interface CountyCasesRunReport {
  registry_id: string;
  index_rows: number;
  significant: number;
  emitted: number;
  excluded_by_status: { status: string; count: number }[];
  unmapped_statuses: { status: string; count: number; sample?: string | null }[];
  not_in_zip: number;
  duplicates_folded?: number;
  quarantined: { reason: string; sample: string }[];
}

export interface CountyCasesDeps {
  fetch: typeof fetch;
  /** Test hook: waits ms. Default real timer. */
  sleep?: (ms: number) => Promise<void>;
  zipCentroid?: { lat: number; lng: number };
  zipMembers?: MembershipFn | null;
  today?: Date;
}
export interface CountyCommunityRow { state?: string | null; county?: string | null; }

// ───────────────────────────── parsing (pure, exported for tests) ─────────────────────────────

export interface IndexCase { case_ids: string[]; url: string; request: string; type: string; status: string; }

function clean(h: string): string {
  return h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").replace(/&amp;/g, "&")
    .replace(/\s+/g, " ").trim();
}

/** One row per case: case-number link | applicant | request | type | status. The applicant cell is never read. */
export function parseCaseIndex(html: string, base: string): IndexCase[] {
  const out: IndexCase[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => c[1]);
    if (cells.length < 5) continue;
    const hm = cells[0].match(/href="([^"]+)"/i);
    const ids = [...clean(cells[0]).matchAll(/\b851-\d{2}-\d{6}-PLNG\b/gi)].map((x) => x[0].toUpperCase());
    if (!hm || !ids.length) continue;
    let url: string;
    try { url = new URL(hm[1].replace(/&amp;/g, "&"), base).toString(); } catch { continue; }
    if (seen.has(url)) continue;
    seen.add(url);
    out.push({ case_ids: [...new Set(ids)], url, request: clean(cells[2]), type: clean(cells[3]), status: clean(cells[4]) });
  }
  return out;
}

/** Tax lots named in a request, e.g. "Tax Lots 1300, 1301 and 1400 of Section 24AB, Township 5 South,
 *  Range 11 West" → MapTaxlot keys "5S1124AB01300"… Returns null when the text does not state a complete,
 *  unambiguous description (never a partial guess). West-of-the-Willamette ranges only. */
export function taxlotKeys(request: string): string[] | null {
  const re = /Tax\s+Lots?\s+([\d,\s]+(?:\s*(?:and|&)\s*[\d,\s]+)?)\s*(?:,\s*)?(?:in|of)\s+Section\s+(\d{1,2})([A-D]{0,2})\s*,?\s*Township\s+(\d{1,2})\s+(North|South)\s*,?\s*Range\s+(\d{1,2})\s+(West)/i;
  const m = request.match(re);
  if (!m) return null;
  const lots = (m[1].match(/\d{1,5}/g) ?? []).map((x) => x.padStart(5, "0"));
  const quarter = (m[3] || "").toUpperCase();
  if (!lots.length || quarter.length === 1) return null;
  const sec = m[2].padStart(2, "0");
  const key = (lot: string) => `${m[4]}${m[5][0].toUpperCase()}${m[6]}${sec}${quarter || "00"}${lot}`;
  return [...new Set(lots.map(key))];
}

const MONTHS: Record<string, number> = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };
/** The date stated under "<label>:" on a case page, or null. */
/** The county's own "Status Update(s)" text (hearing history), verbatim and bounded; null when absent. */
export function statusHistory(pageHtml: string): string | null {
  const t = clean(pageHtml);
  const m = t.match(/Status Updates?\s*:?\s*(.{20,1400}?)\s*(?:Files\b|Calendar\b|$)/i);
  return m ? m[1].trim() : null;
}

export function statedDate(pageHtml: string, label: string): string | null {
  const t = clean(pageHtml);
  const i = t.search(new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*:", "i"));
  if (i < 0) return null;
  const dm = t.slice(i, i + 160).match(/(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(20\d{2})/i);
  if (!dm) return null;
  const mo = MONTHS[dm[1].toLowerCase()];
  const d = Number(dm[2]);
  if (!mo || d < 1 || d > 31) return null;
  return `${dm[3]}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function haversineM(a: [number, number], b: [number, number]): number {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (b[0] - a[0]) * r, dLng = (b[1] - a[1]) * r;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

/** Mean of parcel centroids when enough of the named lots resolved and they lie together; else a reason. */
export function pinFromParcels(
  wanted: string[], found: { key: string; lat: number; lng: number }[],
  opt: { min_found_share: number; max_spread_m: number; bbox: CountyCasesRegistryEntry["bbox"] },
): { lat: number; lng: number; found: number; wanted: number } | { reason: string } {
  const uniq = new Map(found.map((f) => [f.key, f]));
  const pts = [...uniq.values()].filter((f) => wanted.includes(f.key));
  if (!pts.length) return { reason: "no_parcel_found" };
  if (pts.length / wanted.length < opt.min_found_share) return { reason: `parcels_found_${pts.length}_of_${wanted.length}` };
  const lat = pts.reduce((s, p) => s + p.lat, 0) / pts.length;
  const lng = pts.reduce((s, p) => s + p.lng, 0) / pts.length;
  if (lat < opt.bbox.min_lat || lat > opt.bbox.max_lat || lng < opt.bbox.min_lng || lng > opt.bbox.max_lng) return { reason: "outside_county_box" };
  const spread = Math.max(...pts.map((p) => haversineM([lat, lng], [p.lat, p.lng])));
  if (spread > opt.max_spread_m) return { reason: `parcels_spread_${Math.round(spread)}m` };
  return { lat, lng, found: pts.length, wanted: wanted.length };
}

// ───────────────────────────── engine entry point ─────────────────────────────

const MEMO = new Map<string, { at: number; v: unknown }>();
const TTL_MS = 60 * 60 * 1000;
export function _clearCountyCasesCache(): void { MEMO.clear(); }
async function memo<T>(key: string, f: () => Promise<T>): Promise<T> {
  const h = MEMO.get(key);
  if (h && Date.now() - h.at < TTL_MS) return h.v as T;
  const v = await f();
  MEMO.set(key, { at: Date.now(), v });
  return v;
}

export async function countyCasesForZip(
  zip: string, communities: CountyCommunityRow[], entries: CountyCasesRegistryEntry[], deps: CountyCasesDeps,
): Promise<{ sites: NormalizedRecord[]; reports: CountyCasesRunReport[] }> {
  const sites: NormalizedRecord[] = [];
  const reports: CountyCasesRunReport[] = [];
  for (const entry of entries) {
    if (entry.platform !== "county_cases") continue;
    if (entry.zip_mode === false) continue;
    if (!coverageMatches(entry.coverage, communities)) continue;
    const { records, report } = await runEntry(entry, zip, deps);
    sites.push(...records);
    reports.push(report);
  }
  return { sites, reports };
}

const LAST_HIT = new Map<string, number>();
/** Honors the county's robots crawl delay between requests to ITS host only (the ArcGIS host is a separate service). */
async function paced(deps: CountyCasesDeps, host: string, delayMs: number): Promise<void> {
  const last = LAST_HIT.get(host) ?? 0;
  const wait = last + delayMs - Date.now();
  if (wait > 0) await (deps.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms))))(wait);
  LAST_HIT.set(host, Date.now());
}
export function _clearCountyCasesPacing(): void { LAST_HIT.clear(); }

async function getText(deps: CountyCasesDeps, url: string): Promise<string> {
  const r = await deps.fetch(url, { headers: { "user-agent": "HomeSignal/1.0 (+https://jodytracks.com)" } });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  return await r.text();
}

async function runEntry(entry: CountyCasesRegistryEntry, zip: string, deps: CountyCasesDeps):
  Promise<{ records: NormalizedRecord[]; report: CountyCasesRunReport }> {
  const report: CountyCasesRunReport = {
    registry_id: entry.registry_id, index_rows: 0, significant: 0, emitted: 0,
    excluded_by_status: [], unmapped_statuses: [], not_in_zip: 0, quarantined: [],
  };
  const records: NormalizedRecord[] = [];
  const quarantine = (reason: string, sample: string) => { report.quarantined.push({ reason, sample }); };
  let rows: IndexCase[];
  try {
    rows = await memo(`idx:${entry.index_url}`, async () => { await paced(deps, new URL(entry.index_url).host, entry.crawl_delay_ms ?? 10000); return parseCaseIndex(await getText(deps, entry.index_url), entry.index_url); });
  } catch (e) { quarantine("index_fetch_failed", String((e as Error).message)); return { records, report }; }
  report.index_rows = rows.length;

  const sig = entry.significant_if.map((p) => new RegExp(p, "i"));
  const routine = (entry.routine_if ?? []).map((p) => new RegExp(p, "i"));
  const resi = (entry.residential_if ?? []).map((p) => new RegExp(p, "i"));
  const lookup = buildBucketLookup(entry.status_to_bucket, entry.registry_id);
  const excluded = new Map<string, number>();
  const unmapped = new Map<string, { count: number; sample: string }>();
  const today = deps.today ?? new Date();
  const cutoff = entry.recency_days ? new Date(today.getTime() - entry.recency_days * 86400000).toISOString().slice(0, 10) : null;
  const wantStatus: { c: IndexCase; bucket: string }[] = [];
  for (const c of rows) {
    const hay = `${c.type} ${c.request}`;
    if (!sig.some((r) => r.test(hay)) || routine.some((r) => r.test(hay))) continue;
    report.significant++;
    const st = resolveNormalized(lookup, c.status);
    if (st.value === undefined) {
      const u = unmapped.get(c.status) ?? { count: 0, sample: c.case_ids[0] };
      u.count++; unmapped.set(c.status, u); continue;
    }
    if (st.value === "exclude") { excluded.set(c.status, (excluded.get(c.status) ?? 0) + 1); continue; }
    wantStatus.push({ c, bucket: st.value });
  }
  report.excluded_by_status = [...excluded].map(([status, count]) => ({ status, count }));
  report.unmapped_statuses = [...unmapped].map(([status, v]) => ({ status, count: v.count, sample: v.sample }));

  const limit = entry.max_cases ?? 25;
  const keyed: { c: IndexCase; bucket: string; keys: string[]; merged?: string[] }[] = [];
  for (const w of wantStatus) {
    const keys = taxlotKeys(w.c.request);
    if (!keys) { quarantine("no_complete_tax_lot_description", w.c.case_ids[0]); continue; }
    keyed.push({ ...w, keys });
    if (keyed.length >= limit) break;
  }
  if (!keyed.length) return { records, report };
  // Related planning applications on the same land are ONE project / ONE marker: a case that shares any
  // tax lot with an earlier (newer-first) case is folded into it and listed as a related case.
  const merged: typeof keyed = [];
  for (const k of keyed) {
    const host = merged.find((m) => m.keys.some((x) => k.keys.includes(x)));
    if (host) { host.merged = [...(host.merged ?? []), ...k.c.case_ids]; report.duplicates_folded = (report.duplicates_folded ?? 0) + 1; continue; }
    merged.push(k);
  }
  keyed.length = 0; keyed.push(...merged);

  // Parcel lookup — ONE query for every lot of every candidate case.
  const allKeys = [...new Set(keyed.flatMap((k) => k.keys))];
  const found: { key: string; lat: number; lng: number }[] = [];
  try {
    for (let i = 0; i < allKeys.length; i += 150) {
      const chunk = allKeys.slice(i, i + 150);
      const where = `${entry.parcel_key_field} IN (${chunk.map((k) => `'${k.replace(/'/g, "")}'`).join(",")})`;
      const q = `${entry.parcel_url}/query?where=${encodeURIComponent(where)}&outFields=${entry.parcel_key_field}&returnGeometry=true&returnCentroid=true&outSR=4326&resultRecordCount=2000&f=json`;
      const j = JSON.parse(await getText(deps, q));
      if (j.error) throw new Error(`parcel layer error ${j.error.code}`);
      for (const f of j.features ?? []) {
        const c = f.centroid;
        const k = f.attributes?.[entry.parcel_key_field];
        if (k && c && Number.isFinite(c.x) && Number.isFinite(c.y)) found.push({ key: String(k).trim(), lat: c.y, lng: c.x });
      }
    }
  } catch (e) { quarantine("parcel_lookup_failed", String((e as Error).message)); return { records, report }; }

  const pins: { k: typeof keyed[number]; lat: number; lng: number; found: number }[] = [];
  for (const k of keyed) {
    const p = pinFromParcels(k.keys, found, { min_found_share: entry.min_found_share ?? 1, max_spread_m: entry.max_spread_m ?? 1500, bbox: entry.bbox });
    if ("reason" in p) { quarantine(p.reason, k.c.case_ids[0]); continue; }
    pins.push({ k, lat: p.lat, lng: p.lng, found: p.found });
  }
  // ZIP scope: the canonical polygon when available, else the centroid radius. Never both unknown.
  let keep: boolean[];
  if (deps.zipMembers) {
    try { keep = (await deps.zipMembers(pins.map((p) => [p.lat, p.lng] as const))).map((v) => v === "member"); }
    catch (e) { quarantine("zip_membership_failed", String((e as Error).message)); return { records, report }; }
  } else if (deps.zipCentroid && entry.spatial_zip_radius_mi) {
    keep = pins.map((p) => haversineM([deps.zipCentroid!.lat, deps.zipCentroid!.lng], [p.lat, p.lng]) <= entry.spatial_zip_radius_mi! * 1609.344);
  } else { quarantine("no_zip_scope_available", zip); return { records, report }; }

  let pageReads = 0;
  for (let i = 0; i < pins.length; i++) {
    if (!keep[i]) { report.not_in_zip++; continue; }
    const { k, lat, lng } = pins[i];
    let fileDate: string | null = null;
    let history: string | null = null;
    try {
      if (pageReads >= (entry.max_page_reads ?? 4)) throw new Error("page_read_budget");
      const page = await memo(`pg:${k.c.url}`, async () => { pageReads++; await paced(deps, new URL(k.c.url).host, entry.crawl_delay_ms ?? 10000); return getText(deps, k.c.url); });
      if (entry.date_label) fileDate = statedDate(page, entry.date_label);
      history = statusHistory(page);
    } catch { /* the page is optional context; the record stands on the index row */ }
    if (cutoff && fileDate && fileDate < cutoff) continue;
    const kind = k.c.type || "Land use application";
    const title = `${kind} — ${k.c.case_ids.join(" / ")}`;
    const bucket = k.bucket as "proposed" | "approved" | "operating";
    const useType = resi.some((r) => r.test(`${k.c.type} ${k.c.request}`)) ? "Residential" : "Development";
    const decision = decisionFor({ bucket, statusRaw: k.c.status, decisionDate: null, recordUrl: k.c.url, urlPrecision: entry.record_url_precision ?? "record" });
    records.push({
      source_id: `county_cases:${entry.registry_id}:${k.c.case_ids[0]}`,
      source_class: "county_cases",
      source_registry_id: entry.registry_id,
      jurisdiction: entry.jurisdiction,
      label: title.slice(0, 120),
      title,
      use_type: useType,
      type_raw: k.c.type || null,
      bucket,
      type: bucket === "operating" ? "built" : bucket,
      decision,
      decided: decision !== null,
      decision_evidence: decisionEvidenceLevel(entry),
      relevance: "development",
      rel_rule: `source:county_cases:${entry.registry_id}`,
      layer: useType === "Residential" ? "residential" : "development",
      status_raw: k.c.status,
      file_date: fileDate,
      file_date_kind: entry.file_date_kind ?? "filed",
      decision_date: null,
      address: null,
      lat, lng, scope: "point", geo_precision: "point",
      zip: null,
      case_number: k.c.case_ids[0],
      record_url: k.c.url,
      record_url_precision: entry.record_url_precision ?? "record",
      scope_text: k.c.request.slice(0, 300),
      // Honesty about the pin: a parcel CENTROID, not a construction site; the whole named footprint resolved.
      location_basis: "parcel_centroid",
      location_approx: true,
      parcels_named: k.keys.length,
      parcels_matched: pins[i].found,
      related_cases: k.c.case_ids.slice(1).concat(k.merged ?? []),
      status_history: history,
    } as unknown as NormalizedRecord);
    report.emitted++;
  }
  return { records, report };
}
