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
  /** A single-lot case whose text matches one of these (an amendment to an existing plan) is routine UNLESS
   *  its text states a scale (`scale_if`) or names a use that is significant on its own. One parcel alone is never
   *  a reason to exclude: a large commercial or industrial project can occupy one lot. */
  single_lot_minor_if?: string[];
  scale_if?: string[];
  /** Cases held out until a person verifies their outcome (e.g. the county's list page is stale). A held case is
   *  quarantined with its reason and never emitted, whatever status the list shows. */
  hold_cases?: { case_id: string; reason: string }[];
  /** Markers that a county's "page not found" screen carries even when it answers HTTP 200. */
  page_gone_if?: string[];
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
  /** Single-lot amendments to an existing plan that state no scale (routine), by case id. */
  routine_single_lot?: string[];
  /** Cases whose pin was moved from the parcel centroid to a point ON the parcel inside this ZIP because the
   *  centroid lies in a neighbouring ZIP but the parcel itself reaches this one. */
  pinned_by_parcel_overlap?: string[];
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

export type TaxlotParse = { keys: string[] } | { reason: "no_tax_lot_named" | "tax_lot_text_truncated" | "tax_lot_wording_unrecognized" | "quarter_section_ambiguous" };

/** Tax lots named in a request, e.g. "Tax Lots 1300, 1301 and 1400 of Section 24AB, Township 5 South,
 *  Range 11 West" → MapTaxlot keys "5S1124AB01300"… (township, N/S, range PADDED to two digits, section,
 *  two-letter quarter or "00", five-digit lot — the county layer's own key shape, e.g. "1S0928CB02202").
 *  Accepts "in|of Section 26 of Township …". Never a partial guess: anything else returns a reason. West-of-the-Willamette only. */
export function parseTaxlots(request: string): TaxlotParse {
  const at = request.search(/Tax\s+Lots?\b/i);
  if (at < 0) return { reason: "no_tax_lot_named" };
  const re = /Tax\s+Lots?\s+([\d,\s]+(?:\s*(?:and|&)\s*[\d,\s]+)?)\s*(?:,\s*)?(?:in|of)\s+(?:Index\s+)?Section\s+(\d{1,2})([A-D]{0,2})\s*,?\s*(?:of\s+)?Township\s+(\d{1,2})\s+(North|South)\s*,?\s*Range\s+(\d{1,2})\s+(West)/i;
  const m = request.match(re);
  if (!m) {
    // A lot list that simply stops (the county's index shortens long descriptions) is distinct from one worded differently.
    const tail = request.slice(at);
    const stops = !/\bRange\b/i.test(tail) && !/[.!?]["')]?\s*$/.test(request.trim());
    return { reason: stops ? "tax_lot_text_truncated" : "tax_lot_wording_unrecognized" };
  }
  const lots = (m[1].match(/\d{1,5}/g) ?? []).map((x) => x.padStart(5, "0"));
  const quarter = (m[3] || "").toUpperCase();
  if (!lots.length || quarter.length === 1) return { reason: "quarter_section_ambiguous" };
  const sec = m[2].padStart(2, "0");
  const key = (lot: string) => `${m[4]}${m[5][0].toUpperCase()}${m[6].padStart(2, "0")}${sec}${quarter || "00"}${lot}`;
  return { keys: [...new Set(lots.map(key))] };
}
export function taxlotKeys(request: string): string[] | null {
  const p = parseTaxlots(request);
  return "keys" in p ? p.keys : null;
}

/** The county case page repeats the full request text the index list cuts short. Finds the page's copy of THIS
 *  request by a run of its own plain words (so a different description can never be adopted) and returns the
 *  text from there. Null when the page does not carry the same description. */
export function requestFromPage(pageHtml: string, indexRequest: string): string | null {
  const words = indexRequest.split(/\s+/);
  let run: string[] = [];
  for (let i = 0; i + 8 <= words.length; i++) {
    const w = words.slice(i, i + 8);
    if (w.every((x) => /^[A-Za-z]+$/.test(x))) { run = w; break; }
  }
  if (!run.length) return null;
  const t = clean(pageHtml);
  const m = t.match(new RegExp(run.join("\\s+"), "i"));
  if (!m || m.index === undefined) return null;
  return t.slice(m.index, m.index + 3000);
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

type Ring = number[][]; // [lng, lat] pairs (ArcGIS, outSR 4326)
function pointInRings(lat: number, lng: number, rings: Ring[]): boolean {
  let inside = false; // even-odd across every ring: holes subtract, multipart parts combine
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}
/** Points ON a parcel for ZIP intersection tests: interior grid points first (preferred as a pin), then boundary
 *  vertices. Interior points are kept only when they fall inside the parcel's own polygon. Bounded. */
export function parcelSamplePoints(rings: Ring[] | undefined, max: number): { lat: number; lng: number; kind: "interior" | "vertex" }[] {
  if (!rings?.length || max <= 0) return [];
  const all = rings.flat().filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
  if (!all.length) return [];
  const lngs = all.map((p) => p[0]), lats = all.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...lngs), Math.max(...lngs), Math.min(...lats), Math.max(...lats)];
  const out: { lat: number; lng: number; kind: "interior" | "vertex" }[] = [];
  const n = 7;
  for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) {
    const lng = x0 + ((a + 0.5) / n) * (x1 - x0), lat = y0 + ((b + 0.5) / n) * (y1 - y0);
    if (pointInRings(lat, lng, rings as Ring[])) out.push({ lat, lng, kind: "interior" });
  }
  const step = Math.max(1, Math.ceil(all.length / Math.max(1, Math.floor(max / 2))));
  for (let i = 0; i < all.length; i += step) out.push({ lat: all[i][1], lng: all[i][0], kind: "vertex" });
  if (out.length <= max) return out;
  // keep a spread of both kinds within the bound
  const interior = out.filter((p) => p.kind === "interior"), vertex = out.filter((p) => p.kind === "vertex");
  const take = <T,>(a: T[], k: number) => a.filter((_, i) => i % Math.max(1, Math.ceil(a.length / Math.max(1, k))) === 0).slice(0, k);
  return [...take(interior, Math.ceil(max / 2)), ...take(vertex, Math.floor(max / 2))];
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
    const held = (entry.hold_cases ?? []).find((h) => c.case_ids.includes(h.case_id));
    if (held) { quarantine("held_pending_verification: " + held.reason, held.case_id); continue; }
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
  const minorSingle = (entry.single_lot_minor_if ?? []).map((p) => new RegExp(p, "i"));
  const scale = (entry.scale_if ?? []).map((p) => new RegExp(p, "i"));
  const gone = (entry.page_gone_if ?? []).map((p) => new RegExp(p, "i"));
  const delay = entry.crawl_delay_ms ?? 10000;
  const budget = entry.max_page_reads ?? 4;
  let pageReads = 0;
  const pageOf = (url: string) => memo(`pg:${url}`, async () => {
    if (pageReads >= budget) throw new Error("page_read_budget");
    pageReads++;
    await paced(deps, new URL(url).host, delay);
    return getText(deps, url);
  });
  const routineSingle: string[] = [];
  const keyed: { c: IndexCase; bucket: string; keys: string[]; merged?: string[]; page?: string }[] = [];
  for (const w of wantStatus) {
    let p = parseTaxlots(w.c.request);
    let page: string | undefined;
    if ("reason" in p && p.reason === "tax_lot_text_truncated") {
      // The county's list view shortens long descriptions; its case page carries the whole text. Adopt the page's
      // lot list only when the page repeats THIS description and agrees with every complete lot the list showed.
      try {
        page = await pageOf(w.c.url);
        const full = requestFromPage(page, w.c.request);
        const fp = full ? parseTaxlots(full) : null;
        if (fp && "keys" in fp) {
          const shown = ((w.c.request.match(/Tax\s+Lots?\s+([\d,\s]+)$/i)?.[1] ?? "").split(",").map((x) => x.trim()).filter((x, i, a) => x !== "" && i < a.length - 1)).map((x) => x.padStart(5, "0"));
          if (shown.every((l) => fp.keys.some((k) => k.endsWith(l)))) p = fp;
          else quarantine("tax_lot_page_disagrees_with_index", w.c.case_ids[0]);
        } else quarantine(fp ? fp.reason : "tax_lot_text_truncated", w.c.case_ids[0]);
      } catch (e) { quarantine(String((e as Error).message) === "page_read_budget" ? "page_read_budget_exhausted" : "case_page_unreadable", w.c.case_ids[0]); }
      if ("reason" in p) continue;
    }
    if ("reason" in p) { quarantine(p.reason, w.c.case_ids[0]); continue; }
    const hay = `${w.c.type} ${w.c.request}`;
    if (p.keys.length === 1 && minorSingle.some((r) => r.test(hay)) && !scale.some((r) => r.test(hay))) { routineSingle.push(w.c.case_ids[0]); continue; }
    keyed.push({ ...w, keys: p.keys, page });
    if (keyed.length >= limit) break;
  }
  if (routineSingle.length) report.routine_single_lot = routineSingle;
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
  const found: { key: string; lat: number; lng: number; rings?: Ring[] }[] = [];
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
        if (k && c && Number.isFinite(c.x) && Number.isFinite(c.y)) found.push({ key: String(k).trim(), lat: c.y, lng: c.x, rings: f.geometry?.rings });
      }
    }
  } catch (e) { quarantine("parcel_lookup_failed", String((e as Error).message)); return { records, report }; }

  const pins: { k: typeof keyed[number]; lat: number; lng: number; found: number; cands: { lat: number; lng: number; kind: "centroid" | "interior" | "vertex" }[] }[] = [];
  for (const k of keyed) {
    const p = pinFromParcels(k.keys, found, { min_found_share: entry.min_found_share ?? 1, max_spread_m: entry.max_spread_m ?? 1500, bbox: entry.bbox });
    if ("reason" in p) { quarantine(p.reason, k.c.case_ids[0]); continue; }
    // Candidate points for the ZIP test: the centroid, then points ON the named parcels themselves.
    const mine = found.filter((f, i, a) => k.keys.includes(f.key) && a.findIndex((x) => x.key === f.key) === i);
    const per = Math.max(6, Math.floor(120 / Math.max(1, mine.length)));
    const cands: { lat: number; lng: number; kind: "centroid" | "interior" | "vertex" }[] = [{ lat: p.lat, lng: p.lng, kind: "centroid" }];
    for (const m of mine) cands.push({ lat: m.lat, lng: m.lng, kind: "centroid" }, ...parcelSamplePoints(m.rings, per));
    pins.push({ k, lat: p.lat, lng: p.lng, found: p.found, cands });
  }
  // ZIP scope. A project belongs on this ZIP when ANY part of its named parcels intersects the ZIP polygon, not only
  // its centroid: a development can span two ZIP areas. The pin is the centroid when that is a member; otherwise a
  // point ON the parcel that lies inside this ZIP (so the Map's point-in-ZIP placement agrees). Membership is
  // always the canonical polygon's verdict; no point is ever invented off the parcels.
  let keep: boolean[];
  if (deps.zipMembers) {
    try {
      const flat = pins.flatMap((p) => p.cands.map((c) => [c.lat, c.lng] as const));
      const verdicts = flat.length ? await deps.zipMembers(flat) : [];
      let at = 0;
      keep = pins.map((p) => {
        const v = verdicts.slice(at, at + p.cands.length).map((x) => x === "member"); at += p.cands.length;
        if (!v.some(Boolean)) return false;
        if (v[0]) return true; // centroid is a member: pin unchanged
        const members = p.cands.filter((_, i) => v[i]);
        const pool = members.some((m) => m.kind === "interior") ? members.filter((m) => m.kind === "interior") : members;
        const best = pool.reduce((a, b) => (haversineM([p.lat, p.lng], [a.lat, a.lng]) <= haversineM([p.lat, p.lng], [b.lat, b.lng]) ? a : b));
        p.lat = best.lat; p.lng = best.lng;
        (p as { overlap?: boolean }).overlap = true;
        return true;
      });
    } catch (e) { quarantine("zip_membership_failed", String((e as Error).message)); return { records, report }; }
  } else if (deps.zipCentroid && entry.spatial_zip_radius_mi) {
    keep = pins.map((p) => haversineM([deps.zipCentroid!.lat, deps.zipCentroid!.lng], [p.lat, p.lng]) <= entry.spatial_zip_radius_mi! * 1609.344);
  } else { quarantine("no_zip_scope_available", zip); return { records, report }; }

  for (let i = 0; i < pins.length; i++) {
    if (!keep[i]) { report.not_in_zip++; continue; }
    const { k, lat, lng } = pins[i];
    let fileDate: string | null = null;
    let history: string | null = null;
    // A pin needs a WORKING official record: the case page must load and be that case's page. A dead link, a
    // county "not found" screen, or an unread page is quarantined for follow-up and never published.
    let page: string;
    try { page = k.page ?? await pageOf(k.c.url); }
    catch (e) {
      const m = String((e as Error).message);
      quarantine(/HTTP (404|410)\b/.test(m) ? "record_page_gone" : m === "page_read_budget" ? "record_page_unverified_budget" : "record_page_unreadable", k.c.case_ids[0]);
      continue;
    }
    if (gone.some((r) => r.test(clean(page))) || !clean(page).toUpperCase().includes(k.c.case_ids[0])) { quarantine("record_page_gone", k.c.case_ids[0]); continue; }
    if (entry.date_label) fileDate = statedDate(page, entry.date_label);
    history = statusHistory(page);
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
      location_basis: (pins[i] as { overlap?: boolean }).overlap ? "parcel_portion_in_zip" : "parcel_centroid",
      zip_overlap: (pins[i] as { overlap?: boolean }).overlap ? "parcel_reaches_this_zip_centroid_is_in_another" : null,
      location_approx: true,
      parcels_named: k.keys.length,
      parcels_matched: pins[i].found,
      related_cases: k.c.case_ids.slice(1).concat(k.merged ?? []),
      status_history: history,
    } as unknown as NormalizedRecord);
    if ((pins[i] as { overlap?: boolean }).overlap) (report.pinned_by_parcel_overlap ??= []).push(k.c.case_ids[0]);
    report.emitted++;
  }
  return { records, report };
}
