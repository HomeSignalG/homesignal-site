// get-address-report — Supabase edge function (project qwnnmljucajnexpxdgxr).
// v20 = GEOCODE GEOFENCE (sources/arcgis.ts): a GEOCODED point (never source-supplied geometry)
// is trusted only when (a) the Census matched-address ZIP equals the record's filed ZIP and
// (b) the point sits within GEOCODE_FENCE_MI (25) of the report ZIP centroid. A miss NULLS the
// coords (record stays listed, area scope) — verify-geocodes caught 23 live out-of-polygon
// geocodes incl. Fort Worth permits rendering in Michigan/South Carolina (Census range
// interpolation matching the same street name in another state).
// v18 = BACKBONE FIX (area-item placement): jurisdiction-level (scope=area) planning notices and
// meetings no longer geocode against the Box-Elder-only place map. That map DROPPED every
// non-Box-Elder alert (centroid() → null → skipped) and stamped every non-Box-Elder meeting with
// Box Elder County, UT coordinates (41.5105,-112.0155) — wrong cached data on a national build
// (verified: a Travis County TX meeting carried a Utah lat/lng). Area items now anchor at the
// report centroid (homeLat/homeLng); the page already positions them synthetically, so this is
// display-identical everywhere (Box Elder included) while removing the fabricated coordinate and
// the dropped-record content loss. centroid()/PLACES/BOX_ELDER_COMMUNITY_ID removed (were the bug).
// PARKED IN REPO FOR REFERENCE/REPRODUCIBILITY — Supabase is the source of truth
// (docs/development-tracker-source-of-truth.md §2). v11 = MULTI-COUNTY: resolveCommunityIds()
// maps a ZIP to its own community chain (city+county) so each ZIP shows its OWN county's
// planning notices, never a hardcoded one; ZIP mode + address mode both use it. v12 = FRS
// radius back-off + tolerant JSON: dense urban ZIPs made the fixed 5-mi EPA-FRS query exceed
// FRS's process limit, which returned an error object the old code read as 0 facilities — so the
// densest ZIPs falsely showed zero. frsFacilities() now shrinks the radius until FRS answers and
// escapes FRS's invalid-JSON backslashes. v13 = distinguish transient FRS 5xx (retry same radius)
// from the process-limit error (shrink) — a flaky FRS 502 was making the code shrink and undercount
// (Box Elder 23→18); floor lowered to 0.25 mi. v14 = tracker-accuracy: dedup dev items (url|title+date
// — ingest can double-emit), age out concluded hearings older than MEETING_LOOKBACK_DAYS, and stamp
// `decided` (approved|denied/withdrawn/tabled) so the page never shows a resolved item as "open for
// comment". v15 = RELEVANCE: classifyRelevance() stamps every dev item `relevance`
// ('development'|'civic') + `rel_rule` (which rule decided — auditable, overridable, queryable in the
// cache; 'unmatched' items are stamped, not silently dropped). Only relevance='development' counts as
// a project: counts.development excludes civic notices (board vacancies, tax sales, budget/comp/bond
// hearings) and counts.civic reports them separately so the page can list them non-headlined.
// v16 = TX TDLR/TABS enrichment source (docs/tdlr-tabs-adapter-runbook.md §1): an ADDITIVE,
// coverage-gated ZIP-mode branch — the source only activates when the ZIP's resolved communities
// are in Texas (docs/source-registry.md, mandatory covers check), TABS sites count under
// counts.development (never counts.facilities), and the quarantine log rides on the run output as
// tabs_quarantined. Address-mode behavior unchanged. v17 = PROPERTY REPORTS: canonicalAddr()
// (the ONE address normalizer, engine-side — case-study §4.3) stamps canonical_addr on every
// point record with a FILED street address, and the ZIP-mode refresh collapses those records
// into per-address property_reports rows (the dossier cache behind homesignalmap.html?addr=…).
// sources_checked lists ONLY sources this refresh actually queried that came back empty at
// that address — never an assumed check.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { tabsForZip, type TabsPins } from "./sources/tdlr-tabs.ts";
import { siteKey, tceqForZip, type TceqCommunityRow, type TceqEntity } from "./sources/tceq-cr.ts";
import tabsPinsTravis from "./pins/tdlr-tabs-projects.travis.json" with { type: "json" };
import { censusRung, datasetRung, resolveGeocode, supabaseStore } from "./geocode-cache.ts";
import { socrataForZip, type SocrataCommunityRow, type SocrataRegistryEntry } from "./sources/socrata.ts";
import jurisdictionRegistry from "./jurisdiction-registry.json" with { type: "json" };
const SOCRATA_ENTRIES = (jurisdictionRegistry as unknown as { socrata?: SocrataRegistryEntry[] }).socrata ?? [];
import { arcgisForZip, type ArcgisRegistryEntry } from "./sources/arcgis.ts";
import { ckanForZip, type CkanCommunityRow, type CkanRegistryEntry } from "./sources/ckan.ts";
import { csvForZip, type CsvCommunityRow, type CsvRegistryEntry } from "./sources/csv.ts";
import { cartoForZip, type CartoCommunityRow, type CartoRegistryEntry } from "./sources/carto.ts";
const ARCGIS_ENTRIES = (jurisdictionRegistry as unknown as { arcgis?: ArcgisRegistryEntry[] }).arcgis ?? [];
const CKAN_ENTRIES = (jurisdictionRegistry as unknown as { ckan?: CkanRegistryEntry[] }).ckan ?? [];
const CSV_ENTRIES = (jurisdictionRegistry as unknown as { csv?: CsvRegistryEntry[] }).csv ?? [];
const CARTO_ENTRIES = (jurisdictionRegistry as unknown as { carto?: CartoRegistryEntry[] }).carto ?? [];

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// Zero-fee geocode ladder: OpenAddresses (national_address_points, loaded free) → US Census.
// No commercial geocoder, no API key. datasetRung honours the per-row match_type the loader
// stamped (OpenAddresses defaults to parcel_centroid), so precision is never overstated.
const GEO_LADDER = (supabase: ReturnType<typeof createClient>) =>
  [datasetRung(supabase, "national_address_points", "openaddresses"), censusRung(fetch)];

const DEV_CATEGORIES = [
  "Planning, zoning & development",
  "Stratos data center project",
  "County Commission & county business",
];
const MILES_PER_DEG_LAT = 69.0;
const MAX_FACILITIES = 40;
const MAX_RADIUS_MI = 5;
const MEETING_LOOKBACK_DAYS = 90;   // age out concluded hearings older than this (keep recent + upcoming)
const TEASER_LIMIT = 5;
const PAYWALL_ENABLED = (Deno.env.get("PAYWALL_ENABLED") || "").toLowerCase() === "true";

// TX TDLR/TABS registry-mode pins, keyed by county. docs/pins/ is the canonical reviewed
// set; ./pins/ is its byte-identical bundle mirror (a relative import cannot escape the
// function root). tabsForZip() enforces the coverage gate — a pins entry only refreshes
// when the ZIP's chain matches its county.
const TABS_PINS: Record<string, TabsPins> = { travis: tabsPinsTravis as TabsPins };

// ── ZIP mode (additive; see docs/development-tracker-source-of-truth.md §3) ──────────
const ZCTA_CENTROIDS: Record<string, [number, number]> = {
  "84302": [41.5079, -112.0152], // Brigham City, Box Elder County, UT — zipcodes v3.0.0
};
const ZIP_RADIUS_MI = 3; // centroid-radius approximation of a ZIP's extent

const LAYER_KEYWORDS: [string, string[]][] = [
  ["datacenter", ["data center", "datacenter"]],
  ["energy", ["power", "turbine", "turbines", "solar", "wind", "energy", "electric", "generation", "generating", "substation"]],
  ["logistics", ["logistics", "logistic", "warehouse", "distribution", "freight", "trucking"]],
  ["industrial", ["chemical", "chemicals", "rendering", "fertilizer", "refinery", "refining", "manufacturing", "processing", "plant", "mill", "mills", "foundry", "metal", "metals", "waste", "sanitation", "concrete"]],
];
const INCLUDE = new Set([
  ...LAYER_KEYWORDS.flatMap(([, ws]) => ws).filter((w) => !w.includes(" ")),
  "industrial", "industries", "steel", "aggregate", "gravel", "cement", "asphalt",
  "lumber", "grain", "feed", "dairy", "meat", "packing", "cannery", "aerospace",
  "munitions", "explosives", "recycling", "landfill", "wastewater", "treatment",
  "utility", "utilities", "quarry", "compost", "dryers", "railroad", "rail",
]);
const EXCLUDE = new Set([
  "dds", "dmd", "dental", "dentist", "orthodontics", "clinic", "medical", "physician",
  "bank", "credit", "school", "elementary", "middle", "academy", "university",
  "college", "church", "chapel", "apartments", "apartment", "plex", "cleaners",
  "salon", "photo", "lube", "tire", "buick", "chevrolet", "ford", "motors", "auto",
  "dealership", "store", "market", "pharmacy", "cafe", "restaurant", "hotel", "motel",
  "office", "insurance", "realty", "conoco", "chevron", "phillips", "sinclair",
  "maverik", "sunoco", "exxon", "gas", "windshield", "barber", "floral", "boutique",
]);

function corsHeaders(): Record<string, string> {
  return { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, apikey, Authorization" };
}
function json(body: unknown, status: number, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...cors } });
}
function tokenize(name: string): Set<string> { return new Set((name.toLowerCase().match(/[a-z]+/g) || [])); }
function looksIndustrial(name: string): boolean {
  const low = name.toLowerCase(); const t = tokenize(name);
  for (const w of t) if (EXCLUDE.has(w)) return false;
  if (low.includes("data center") || t.has("datacenter")) return true;
  for (const w of t) if (INCLUDE.has(w)) return true;
  return false;
}
function classifyLayer(name: string, category = ""): string {
  if (category.toLowerCase().includes("stratos") || name.toLowerCase().includes("data cent")) return "datacenter";
  const t = tokenize(name), low = name.toLowerCase();
  for (const [layer, words] of LAYER_KEYWORDS) for (const w of words) { if ((w.includes(" ") && low.includes(w)) || (!w.includes(" ") && t.has(w))) return layer; }
  return "industrial";
}
// ── Relevance classifier (v15) ─────────────────────────────────────────────────────────
// Only land-use / development actions belong in the development buckets; procedural civic
// notices go to a separate non-headlined list. Rules are ordered so a mixed agenda that
// names a real land-use action (e.g. "MDA, Fee Schedule Amendment, Overlay Zone") stays a
// development item, while a purely procedural hearing ("Budget and Exec Compensation")
// leaves. The county's own category tag is the fallback for generic titles, and anything
// no rule matches is stamped rel_rule:'unmatched' (routed to the civic list for review —
// visible in the cache, never dropped). Patterns were derived from the live alerts/meetings
// corpus for the Utah County and Box Elder chains, not invented.
const DEV_TITLE = new RegExp([
  "rezon", "zone chang", "zoning", "subdivision", "subdivide", "\\bplat\\b", "site plan",
  "conditional use", "variance", "annex", "general plan", "master plan", "comprehensive plan",
  "development agreement", "master development", "\\bmda\\b", "armda", "overlay zone",
  "overlay district", "land use", "planned unit", "\\bpud\\b", "concept plan",
  "development code", "lot split", "lot line", "boundary adjustment", "street vacat",
  "road vacat", "\\bvacate\\b", "easement vacat", "vacation of", "\\bpue\\b",
  "right.of.way", "infrastructure district", "impact fee", "\\bpcph\\b",
  "planning commission", "agriculture protection", "data cent", "moratorium", "housing",
  "warehouse", "solar", "wind farm", "substation", "landfill", "quarry", "gravel pit",
  "mining", "asphalt", "concrete", "refinery", "water treatment", "wastewater",
].join("|"), "i");
const CIVIC_TITLE = new RegExp([
  "vacanc", "tax sale", "budget", "compensation", "salar", "fee schedule", "property tax",
  "tax increase", "\\bbond", "enterprise fund", "utility transfer", "notice of transfer",
  "transfers? notice", "canvass", "election", "unclaimed property",
  "disposition of real property", "reorganiz", "\\baudit\\b", "procurement", "\\brfp\\b",
  "surplus", "block grant", "newsletter", "mayor.?s\\b.*report",
].join("|"), "i");
const DEV_CATEGORY = /planning|zoning|stratos|development/i;
function classifyRelevance(title: string, category: string, agency: string): [string, string] {
  const t = title || "";
  if (DEV_TITLE.test(t)) return ["development", "title:landuse"];
  if (CIVIC_TITLE.test(t)) return ["civic", "title:civic"];
  if (DEV_CATEGORY.test(category || "")) return ["development", "category:planning"];
  if (/planning/i.test(agency || "")) return ["development", "agency:planning"];
  return ["civic", "unmatched"];   // generic agendas / meeting notices — logged for review
}
function toEN(homeLat: number, homeLng: number, lat: number, lng: number): [number, number] {
  const n = (lat - homeLat) * MILES_PER_DEG_LAT;
  const e = (lng - homeLng) * MILES_PER_DEG_LAT * Math.cos((homeLat * Math.PI) / 180);
  return [Math.round(e * 1000) / 1000, Math.round(n * 1000) / 1000];
}
async function geocode(address: string): Promise<[number, number, string]> {
  const q = new URLSearchParams({ address, benchmark: "Public_AR_Current", format: "json" });
  const r = await fetch(`https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?${q}`, { signal: AbortSignal.timeout(15000) });
  const data = await r.json();
  const matches = data?.result?.addressMatches ?? [];
  if (!matches.length) throw new Error(`No geocoder match for: ${address}`);
  const c = matches[0].coordinates;
  return [Number(c.y), Number(c.x), matches[0].matchedAddress ?? address];
}
async function devSites(supabase: ReturnType<typeof createClient>, homeLat: number, homeLng: number, communityIds: string[]): Promise<Record<string, unknown>[]> {
  const sites: Record<string, unknown>[] = [];
  if (!communityIds.length) return sites;   // ZIP has no modeled jurisdiction → facilities-only page (valid)
  // TASK 4 (universal) — devSites no longer reads the `meetings` table. Every row in `meetings` is a
  // government meeting AGENDA (council/commission agendas, public-meeting notices) from an agenda
  // source — CivicClerk, Granicus, Legistar, iQM2, CivicPlus, the Utah PMN meeting feed, and bespoke
  // city sites alike. Agenda items mix land-use with all other government business and carry no
  // structured type/status, so classifying one as development is guesswork (this produced the
  // "Commissioners Court Employee Hearing" false positive on 78617). Development records now come from
  // structured NOTICES (the alerts government_notice pull below) + structured permit/case feeds
  // (socrataForZip / TABS / federal). The ingest meeting feeds stay ACTIVE — those meetings still
  // populate the civic-alerts "Meetings" tile on community.html; they are just not development records.
  const { data: alerts } = await supabase.from("alerts").select("title,category,agency_name,geographic_reference,source_url,comment_deadline").in("community_id", communityIds).eq("pipeline_type", "government_notice").in("category", DEV_CATEGORIES).order("published_at", { ascending: false }).limit(100);
  // AREA (jurisdiction-level) notices have NO trustworthy point — a county/city notice applies
  // county- or city-WIDE, not to one address. The page never trusts these coordinates: all three
  // map views position area items synthetically around the report anchor (homesignalmap.html
  // placeAreaSites / siteLL / siteEN). So the engine anchors every area item at the REPORT
  // CENTROID (homeLat/homeLng) and never at a hardcoded place.
  //   Why this changed (v18 backbone fix): the old code geocoded area items against a
  //   Box-Elder-only place map (centroid()/PLACES). At national scale that was wrong two ways —
  //   (1) it DROPPED every non-Box-Elder ALERT (centroid() returned null → `continue`, so real
  //   out-of-state planning notices never rendered), and (2) it stamped every non-Box-Elder
  //   MEETING with Box Elder County, UT coordinates (the `?? PLACES["box elder county"]` fallback)
  //   — e.g. a Travis County, TX meeting cached with lat 41.5105, lng -112.0155. Anchoring to the
  //   report centroid is honest (the item is "activity within the area you're viewing"), loses no
  //   record, and — since area coordinates are never displayed — is display-identical everywhere,
  //   Box Elder included. Every rendered fact still comes from the record's source_url.
  const [ae, an] = toEN(homeLat, homeLng, homeLat, homeLng);   // [0,0] — the report anchor
  for (const a of alerts ?? []) {
    const title = ((a.title as string) || "").trim();
    const approved = /\b(approved|approves|granted|adopted|entitled|permit issued|issued a permit|under construction|final plat|site plan approv|authoriz|ground ?break|breaks ground|begins construction|construction begins)\b/i.test(title);
    // A DECIDED item (approved OR denied/withdrawn/tabled) is not an open comment opportunity.
    const denied = /\b(denied|denies|deny|withdrawn|withdrew|withdraws|rejected|rejects|tabled|dismissed|vacated|rescinded)\b/i.test(title);
    const [rel, relRule] = classifyRelevance(title, (a.category as string) || "", (a.agency_name as string) || "");
    const s: Record<string, unknown> = { label: title.slice(0, 120) || "Development item", e: ae, n: an, lat: homeLat, lng: homeLng, scope: "area", type: approved ? "approved" : "proposed", decided: approved || denied, relevance: rel, rel_rule: relRule, layer: classifyLayer(title, a.category as string), src: ((a.agency_name as string) || (a.category as string) || "Planning record").trim(), url: (a.source_url as string) || "" };
    if (a.comment_deadline) s.comment_deadline = a.comment_deadline;
    sites.push(s);
  }
  // (meetings loop removed — see the TASK 4 note above; agenda meetings are no longer development records)
  // Dedup: ingest can emit the same notice more than once. First-seen wins.
  const seen = new Set<string>();
  const deduped = sites.filter((s) => {
    const url = ((s.url as string) || "").trim();
    const key = url || `${(s.label as string) || ""}|${(s.meeting_date as string) || (s.comment_deadline as string) || ""}`;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
  const groups: Record<string, Record<string, unknown>[]> = {};
  for (const s of deduped) { const k = `${(s.lat as number).toFixed(4)},${(s.lng as number).toFixed(4)}`; (groups[k] ??= []).push(s); }
  for (const members of Object.values(groups)) {
    if (members.length < 2) continue;
    members.forEach((s, i) => { const ang = i * 2.399963, rad = 0.18 + 0.09 * Math.sqrt(i); s.e = Math.round(((s.e as number) + rad * Math.cos(ang)) * 1000) / 1000; s.n = Math.round(((s.n as number) + rad * Math.sin(ang)) * 1000) / 1000; s.approx = true; });
  }
  return deduped;
}
// One FRS query at a fixed radius; tooBig = FRS process-limit refusal (shrink), transient = retry.
async function frsAt(lat: number, lng: number, rad: number): Promise<{ ok: boolean; tooBig: boolean; rows: Record<string, unknown>[] }> {
  const q = new URLSearchParams({ latitude83: lat.toFixed(6), longitude83: lng.toFixed(6), search_radius: String(rad), output: "JSON" });
  try {
    const r = await fetch(`https://ofmpub.epa.gov/frs_public2/frs_rest_services.get_facilities?${q}`, { signal: AbortSignal.timeout(30000) });
    if (r.status >= 500) return { ok: false, tooBig: false, rows: [] };   // transient FRS 5xx
    const text = await r.text();
    // Escape any backslash that isn't a valid JSON escape so JSON.parse survives FRS payloads.
    const data = JSON.parse(text.replace(/\\(?!["\\/bfnrtu])/g, "\\\\")) as Record<string, unknown>;
    const res = data?.Results as Record<string, unknown> | undefined;
    if (res?.Error) return { ok: false, tooBig: true, rows: [] };          // process-limit refusal
    const rows = (res?.FRSFacility ?? res?.Facilities ?? data?.FRSFacility ?? []) as Record<string, unknown>[];
    return { ok: true, tooBig: false, rows: Array.isArray(rows) ? rows : [] };
  } catch (_e) { return { ok: false, tooBig: false, rows: [] }; }          // network/parse → transient
}
// Radius back-off + transient retry (v12/v13) — never read an FRS failure as "0 facilities".
async function frsFacilities(lat: number, lng: number, radiusMi: number): Promise<Record<string, unknown>[]> {
  const radii = [radiusMi, 3, 2, 1.5, 1, 0.5, 0.25].filter((r, i, a) => r <= radiusMi && a.indexOf(r) === i);
  for (const rad of radii) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const { ok, tooBig, rows } = await frsAt(lat, lng, rad);
      if (ok) return rows;      // success (possibly empty — a genuinely empty area)
      if (tooBig) break;        // result too large → next smaller radius (retry won't help)
      // else transient → retry the same radius
    }
  }
  return [];
}
async function facilitySites(homeLat: number, homeLng: number, radiusMi: number): Promise<Record<string, unknown>[]> {
  const rows = await frsFacilities(homeLat, homeLng, radiusMi);
  const kept: Record<string, unknown>[] = [];
  for (const rr of rows) {
    const lat = Number(rr.Latitude83 ?? rr.FacLat), lng = Number(rr.Longitude83 ?? rr.FacLong);
    if (!isFinite(lat) || !isFinite(lng)) continue;
    const name = String(rr.FacilityName ?? rr.FacName ?? "Facility").trim();
    if (!looksIndustrial(name)) continue;
    const [e, n] = toEN(homeLat, homeLng, lat, lng);
    const d = Math.hypot(e, n);
    if (d > radiusMi + 0.05) continue;
    const rid = String(rr.RegistryId ?? rr.RegistryID ?? "").trim();
    kept.push({ label: name, e, n, lat, lng, _d: d, scope: "point", type: "built", layer: classifyLayer(name), registry_id: rid, src: rid ? `EPA FRS · registry ${rid}` : "EPA FRS", record_url: rid ? `https://echo.epa.gov/detailed-facility-report?fid=${rid}` : "" });
  }
  kept.sort((a, b) => (a._d as number) - (b._d as number));
  return kept.slice(0, MAX_FACILITIES).map((f) => { delete f._d; return f; });
}
// Best-effort EPA ECHO violation-count enrichment from the pre-cached table (shared by both
// modes; read-only). Kept as a fallback under echoEnrich() (the live pull below wins).
async function enrichViolations(supabase: ReturnType<typeof createClient>, fac: Record<string, unknown>[]): Promise<void> {
  const rids = fac.map((f) => f.registry_id as string).filter(Boolean);
  if (!rids.length) return;
  try {
    const { data: rows } = await supabase.from("echo_violation_counts").select("registry_id,count").in("registry_id", rids);
    const byId = new Map((rows ?? []).map((r) => [r.registry_id as string, r.count as number]));
    for (const f of fac) { const c = byId.get(f.registry_id as string); if (c && c > 0) { f.viol = c; f.violUrl = f.record_url; } }
  } catch (_e) { /* best-effort */ }
}

// ── v19: ENVIRONMENTAL-RECORDS LAYER (EPA ECHO federal + TCEQ Central Registry state) ──────────
// Cached, geo-matched enrichment (docs/source-registry.md). The two sources hang off the ids we
// already carry — ECHO off the FRS registry_id (reuse frsRid), TCEQ off the RN — and stamp
// s.env = { link_type:"geo_matched", epa?, tceq? }. The PAGE turns env into one plain-language
// status line (all four render paths share that helper). Absent stays absent; nothing is invented.

// Live EPA ECHO compliance enrichment. ONE get_facilities → get_qid pair per report (by
// lat/lng/radius) returns every ECHO facility near the point WITH its interpreted compliance
// summary, keyed on RegistryID — joined straight onto the FRS facilities we already placed
// (ADDITIVE: FRS discovery is unchanged; this only annotates). This is the real-ECHO replacement
// for the near-empty echo_violation_counts table. Fail-open: any hiccup leaves facilities
// un-enriched, never blocking the page. Verified reachable + free (STEP 0, 2026-07-11).
const ECHO_BASE = "https://echodata.epa.gov/echo";
const ECHO_STATUTES: [string, string][] = [["CWA", "CWAComplianceStatus"], ["CAA", "CAAComplianceStatus"], ["RCRA", "RCRAComplianceStatus"], ["SDWA", "SDWAComplianceStatus"]];
function echoParse(text: string): Record<string, any> { return JSON.parse(text.replace(/\\(?!["\\/bfnrtu])/g, "\\\\")); }
function echoYear(mdY?: string): string | null { const all = String(mdY ?? "").match(/\d{4}/g); return all && all.length ? all[all.length - 1] : null; }
// One ECHO facility row → the interpreted env.epa fact block (absent stays absent).
function interpretEcho(row: Record<string, string>): Record<string, unknown> {
  const inViolation: string[] = [];
  for (const [code, field] of ECHO_STATUTES) {
    const v = String(row[field] ?? "");
    if (/violation|significant|non.?compliance/i.test(v) && !/no violation|no data/i.test(v)) inViolation.push(code);
  }
  const epa: Record<string, unknown> = { in_violation: inViolation };
  if (row.FacSNCFlg === "Y") epa.snc = true;
  const qtrs = parseInt(row.FacQtrsWithNC ?? "", 10); if (Number.isFinite(qtrs) && qtrs > 0) epa.quarters_nc = qtrs;
  const insp = parseInt(row.FacInspectionCount ?? "", 10); if (Number.isFinite(insp) && insp > 0) epa.inspections = insp;
  const yr = echoYear(row.FacDateLastFormalAction); if (yr) epa.action_year = yr;
  const pen = parseInt(row.FacPenaltyCount ?? "", 10); if (Number.isFinite(pen) && pen > 0) epa.penalty_count = pen;
  epa.current_as_of = new Date().toISOString().slice(0, 10);
  return epa;
}
async function echoEnrich(fac: Record<string, unknown>[], lat: number, lng: number, radiusMi: number): Promise<void> {
  if (!fac.some((f) => String(f.registry_id ?? "").trim())) return;
  try {
    const q1 = new URLSearchParams({ output: "JSON", p_lat: lat.toFixed(6), p_long: lng.toFixed(6), p_radius: String(Math.min(radiusMi, MAX_RADIUS_MI)) });
    const r1 = await fetch(`${ECHO_BASE}/echo_rest_services.get_facilities?${q1}`, { signal: AbortSignal.timeout(25000) });
    if (!r1.ok) return;
    const qid = echoParse(await r1.text())?.Results?.QueryID;
    if (!qid) return;
    const q2 = new URLSearchParams({ output: "JSON", qid: String(qid), responseset: "500" });
    const r2 = await fetch(`${ECHO_BASE}/echo_rest_services.get_qid?${q2}`, { signal: AbortSignal.timeout(25000) });
    if (!r2.ok) return;
    const rows = (echoParse(await r2.text())?.Results?.Facilities ?? []) as Record<string, string>[];
    const byId = new Map<string, Record<string, string>>();
    for (const row of rows) { const id = String(row.RegistryID ?? "").trim(); if (id) byId.set(id, row); }
    for (const f of fac) {
      const row = byId.get(String(f.registry_id ?? "").trim());
      if (!row) continue;
      const epa = interpretEcho(row);
      const env = (f.env ??= {}) as Record<string, unknown>;
      env.link_type = "geo_matched"; env.epa = epa;
      f.viol = (epa.in_violation as string[]).length;         // back-compat: viol == # open violations
      if (row.FacStreet) f._fstreet = String(row.FacStreet);  // verified address for the TCEQ dedup key
      if (row.FacZip) f._fzip = String(row.FacZip).slice(0, 5);
    }
  } catch (_e) { /* best-effort — never block the page */ }
}

// TCEQ dedup + enrich: attach each TCEQ RN onto the FRS facility at the same physical site
// (matched by siteKey = house# + street + ZIP, else by exact normalized name), so a facility with
// BOTH an FRS id and a TCEQ RN renders ONCE with both badges. NO geocoding — the matched site
// reuses the FRS coordinate (build rule: existing coords or free Census only, no paid services).
const NAME_STOP = new Set(["THE", "OF", "AND", "LLC", "INC", "LP", "LTD", "CO", "CORP", "COMPANY", "CITY", "TX", "TEXAS", "WWTP", "WTP", "PLANT", "FACILITY", "CENTER", "STATION", "SITE"]);
function nameTokens(s: string): Set<string> {
  return new Set(String(s || "").toUpperCase().replace(/[^A-Z0-9 ]/g, " ").split(/\s+/).filter((t) => t.length > 1 && !NAME_STOP.has(t)));
}
function normName(s: string): string {
  const toks = Array.from(nameTokens(s));
  return toks.length ? toks.join(" ") : "";
}
function sharesToken(a: Set<string>, b: Set<string>): boolean { for (const t of a) if (b.has(t)) return true; return false; }
// Dedup + enrich, PRECISION OVER RECALL (verified against real 78617 data — the siteKey alone
// collides distinct businesses at a shared house#+road+ZIP, e.g. an AutoZone and a parkade at
// "4700 ROSS"). A match is confident only when EITHER the normalized names are exactly equal, OR
// the site keys match AND the names share at least one significant token. When several RNs sit at
// one key we pick the token-sharing one — never an arbitrary neighbor. Missing a real match is
// safe; attaching the wrong RN's programs would be fabrication.
function enrichTceq(fac: Record<string, unknown>[], entities: TceqEntity[]): { matched: number } {
  if (!entities.length) return { matched: 0 };
  const byKey = new Map<string, TceqEntity[]>(), byName = new Map<string, TceqEntity>();
  for (const e of entities) {
    if (e.key) (byKey.get(e.key) ?? byKey.set(e.key, []).get(e.key)!).push(e);
    const nk = normName(e.name); if (nk && !byName.has(nk)) byName.set(nk, e);
  }
  let matched = 0;
  for (const f of fac) {
    const fTok = nameTokens(String(f.label ?? ""));
    const fk = siteKey(String(f._fstreet ?? ""), String(f._fzip ?? ""));
    // 1) same site (key) AND a shared name token → confident.
    let e = fk ? (byKey.get(fk) || []).find((c) => sharesToken(fTok, nameTokens(c.name))) : undefined;
    // 2) exact normalized-name equality → confident regardless of address.
    if (!e) { const nk = normName(String(f.label ?? "")); if (nk) e = byName.get(nk); }
    if (!e) continue;
    const env = (f.env ??= {}) as Record<string, unknown>;
    env.link_type = "geo_matched";
    env.tceq = { programs: e.programs, status: e.status, name: e.name };
    f.tceq_rn = e.rn;
    f.tceq_url = "https://www15.tceq.texas.gov/crpub/";   // official CR query (the RN is shown in the UI)
    matched++;
  }
  return { matched };
}
// Strip the internal match-key fields so they never persist in the cache.
function stripEnvInternals(fac: Record<string, unknown>[]): void {
  for (const f of fac) { delete f._fstreet; delete f._fzip; }
}
// ── v17: the ONE canonical-address normalizer (case-study §4.3) ────────────────────────
// Deterministic string normalization of a FILED street address, so records filed with
// suffix/spelling variants ("2200 Caldwell Lane" vs "2200 Caldwell Ln") and the Census
// matchedAddress form ("…, TX, 78617") all collapse to one property_reports key. The page
// never normalizes — it links with the engine-stamped canonical_addr.
function canonicalAddr(a: string): string {
  return String(a).toUpperCase().replace(/\./g, "")
    .replace(/\bLANE\b/g, "LN").replace(/\bSTREET\b/g, "ST").replace(/\bDRIVE\b/g, "DR")
    .replace(/\bROAD\b/g, "RD").replace(/\bAVENUE\b/g, "AVE").replace(/\bBOULEVARD\b/g, "BLVD")
    .replace(/\bPARKWAY\b/g, "PKWY").replace(/\bHIGHWAY\b/g, "HWY").replace(/\bCOURT\b/g, "CT")
    .replace(/\bCIRCLE\b/g, "CIR").replace(/\bPLACE\b/g, "PL").replace(/\bSUITE\b/g, "STE")
    .replace(/\bTEXAS\b/g, "TX").replace(/\bUTAH\b/g, "UT")
    .replace(/\s*,\s*/g, ", ").replace(/,\s*(\d{5}(-\d{4})?)\s*$/, " $1").replace(/\s+/g, " ").trim();
}
// v17: collapse every point record with a filed street address into its per-address
// property_reports row (public select / service-role writes — docs/property-reports-cache.sql).
// sources_checked carries ONLY sources this refresh actually queried that returned nothing
// at that address, with the check's real scope stated — never an assumed or inferred check.
async function writePropertyReports(
  supabase: ReturnType<typeof createClient>,
  zip: string, county: string | null, state: string | null,
  pointRecords: Record<string, unknown>[], tabsRan: boolean, vintage: string,
): Promise<void> {
  const groups: Record<string, Record<string, unknown>[]> = {};
  for (const s of pointRecords) {
    const key = (s.canonical_addr as string) || "";
    if (!key) continue;
    (groups[key] ??= []).push(s);
  }
  for (const [address, recs] of Object.entries(groups)) {
    const filings = recs.filter((r) => r.project_no);
    const checked: Record<string, string>[] = [];
    if (!recs.some((r) => String(r.src || "").indexOf("EPA FRS") === 0)) {
      checked.push({ src: "EPA FRS", result: "no facility at this address among this ZIP's query results" });
    }
    if (tabsRan && !filings.length) {
      checked.push({ src: "TX TDLR TABS", result: "no filing at this address in the pinned registry set" });
    }
    const first = recs.find((r) => typeof r.lat === "number");
    try {
      await supabase.from("property_reports").upsert({
        address, zip, county, state,
        lat: first ? (first.lat as number) : null, lng: first ? (first.lng as number) : null,
        counts: { filings: filings.length, federal: recs.length - filings.length },
        sites: recs, sources_checked: checked,
        source_vintage: vintage, refreshed_at: new Date().toISOString(),
      }, { onConflict: "address" });
    } catch (_e) { /* the dossier cache must never break the page response */ }
  }
}
// FAIL-LOUD communities read (founder directive 2026-07-17): these two lookups GATE
// content — resolveCommunityIds feeds the civic-notices layer and the state/county rows
// feed every connector's coverage gate. A silently-failed read (observed under heavy
// PostgREST load during verifier walks) used to resolve to "no communities", closing
// every gate and letting a real dev-backed page cache as facilities-floor/empty. That
// must never happen: retry the read, and if it still fails THROW — the request 500s,
// a 500 is never collected into development_reports, and the refresh cron's
// transient-safe upsert never sees it. Wrong data is worse than no data.
async function mustReadCommunities<T>(
  read: () => PromiseLike<{ data: T[] | null; error: { message?: string } | null }>,
  what: string,
): Promise<T[]> {
  let lastErr = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const { data, error } = await read();
      if (!error && data !== null) return data;
      lastErr = error?.message || "null data with no error";
    } catch (e) { lastErr = (e as Error).message; }
    if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 500));
  }
  throw new Error(`communities read failed (${what}) after 3 attempts: ${lastErr} — refusing to emit a report with coverage gates closed`);
}
// Resolve a ZIP to the community rows whose jurisdiction covers it (city + county chain).
async function resolveCommunityIds(supabase: ReturnType<typeof createClient>, zip: string | null): Promise<string[]> {
  if (!zip || !/^\d{5}$/.test(zip)) return [];
  const rows = await mustReadCommunities<{ id: string }>(
    () => supabase.from("communities").select("id").contains("zip_codes", [zip]),
    `ids for ${zip}`,
  );
  return rows.map((r) => r.id as string);
}
async function accessLevel(req: Request, supabase: ReturnType<typeof createClient>): Promise<"full" | "teaser"> {
  if (!PAYWALL_ENABLED) return "full";
  const auth = req.headers.get("Authorization") || ""; const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return "teaser";
  try {
    const { data: userData } = await supabase.auth.getUser(token); const uid = userData?.user?.id;
    if (!uid) return "teaser";
    const { data, error } = await supabase.from("subscriptions").select("status").eq("user_id", uid).in("status", ["trialing", "active"]).limit(1);
    if (error) return "teaser";
    return (data && data.length) ? "full" : "teaser";
  } catch (_e) { return "teaser"; }
}
// Top-level fail-loud wrapper: a thrown gate-critical error (e.g. mustReadCommunities
// exhausting retries) becomes an explicit JSON 500 — never a 200 with silently-empty
// gated content, so it can never be collected into development_reports.
Deno.serve(async (req: Request) => {
  try {
    return await handleRequest(req);
  } catch (e) {
    return json({ error: "engine error: " + String(e instanceof Error ? e.message : e) }, 500, corsHeaders());
  }
});
async function handleRequest(req: Request): Promise<Response> {
  const cors = corsHeaders();
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405, cors);
  let body: { address?: string; radius_mi?: number; zip?: string | number; lat?: number; lng?: number; regeocode?: string[] };
  try { body = await req.json(); } catch { return json({ error: "bad JSON" }, 400, cors); }

  // ── RE-GEOCODE MODE ── {regeocode:["<canonical_addr>",...]} → the improvement-guarded batch.
  // For each address ALREADY in geocodes, re-run the ladder fresh (forceRefresh bypasses the
  // write-once cache read) and write through upsert_geocode_if_better (only upgrades; no delete
  // gap), bumping provider_vintage. Reports before/after so an upgrade is auditable. Bounded to
  // rows already in geocodes (input_address is read from there). Zero-fee ladder — no spend.
  if (Array.isArray(body.regeocode)) {
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const geoStore = supabaseStore(supabase);
    const geoLadder = GEO_LADDER(supabase);
    const vintage = "regeocode " + new Date().toISOString().slice(0, 10);
    const results: Record<string, unknown>[] = [];
    for (const canon of body.regeocode) {
      const { data: row } = await supabase.from("geocodes")
        .select("canonical_addr,input_address,match_type,lat,lng,needs_review").eq("canonical_addr", canon).maybeSingle();
      if (!row) { results.push({ canonical_addr: canon, skipped: "not in geocodes" }); continue; }
      const before = { match_type: row.match_type, lat: row.lat, lng: row.lng, needs_review: row.needs_review };
      const after = await resolveGeocode(geoStore, row.input_address as string, canon, geoLadder, { providerVintage: vintage, forceRefresh: true });
      results.push({ canonical_addr: canon, before,
        after: { match_type: after.match_type, lat: after.lat, lng: after.lng, geocode_source: after.geocode_source, needs_review: after.needs_review },
        upgraded: before.match_type !== after.match_type });
    }
    return json({ mode: "regeocode", vintage, results }, 200, cors);
  }

  // ── ZIP MODE ── {zip[,lat,lng]} → home = ZIP centroid; anti-fabrication enforced here.
  if (body.zip !== undefined && body.zip !== null && String(body.zip).trim() !== "") {
    const zip = String(body.zip).trim();
    if (!/^\d{5}$/.test(zip)) return json({ error: "zip must be 5 digits" }, 400, cors);
    let clat = Number(body.lat), clng = Number(body.lng);
    if (!isFinite(clat) || !isFinite(clng)) {
      const c = ZCTA_CENTROIDS[zip];
      if (!c) return json({ error: `no pinned centroid for ZIP ${zip}; pass {zip,lat,lng}` }, 422, cors);
      [clat, clng] = c;
    }
    const zipRadius = Math.min(Math.max(Number(body.radius_mi) || ZIP_RADIUS_MI, 0.5), MAX_RADIUS_MI);
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const communityIds = await resolveCommunityIds(supabase, zip);
    const [devRaw, facRaw] = await Promise.all([devSites(supabase, clat, clng, communityIds), facilitySites(clat, clng, zipRadius)]);
    await enrichViolations(supabase, facRaw);
    // v19: live EPA ECHO compliance enrichment (real violations/programs, keyed on registry_id).
    await echoEnrich(facRaw, clat, clng, zipRadius);
    // TX TDLR/TABS enrichment (v16, additive — runbook §1). Coverage-gated inside
    // tabsForZip(): the source never runs for a non-TX ZIP. Separate query keeps
    // resolveCommunityIds() untouched (additive-only rule, source-registry #4).
    // FAIL-LOUD (founder directive): a failed read here used to silently close every
    // connector's coverage gate — see mustReadCommunities. Throws after 3 attempts.
    const commRows = await mustReadCommunities<{ state: string | null; county: string | null }>(
      () => supabase.from("communities").select("state,county").contains("zip_codes", [zip]),
      `state/county for ${zip}`,
    );
    // v19: TCEQ Central Registry (Texas state) — coverage-gated inside tceqForZip(). Dedupes each
    // RN onto the FRS facility at the same physical site and stamps env.tceq (state programs).
    const tceq = await tceqForZip(zip, (commRows ?? []) as TceqCommunityRow[], { fetch });
    const tceqStats = enrichTceq(facRaw, tceq.entities);
    stripEnvInternals(facRaw);
    // Geocoding goes through the write-once, quality-aware cache. ZERO-FEE LADDER, degrades in a
    // fixed precision order and NEVER hard-errors — each rung returns null on a miss so the next
    // is tried, ending at Census range_interpolation:
    //   OpenAddresses (national_address_points, local lookup, no egress, no per-call cost;
    //     tier = the loader-stamped match_type — parcel_centroid unless an explicit rooftop signal)
    //   → US Census (range_interpolated, last resort).
    // Only rooftop clears needs_review; parcel_centroid renders but stays flagged. Writes go through
    // the SQL improvement guard, so a re-geocode can only upgrade, never downgrade.
    const geoStore = supabaseStore(supabase);
    const geoLadder = GEO_LADDER(supabase);
    const tabs = await tabsForZip(zip, (commRows ?? []) as { state?: string; county?: string }[], TABS_PINS, {
      fetch,
      geocode: async (a: string) => {
        const g = await resolveGeocode(geoStore, a, canonicalAddr(a), geoLadder);
        if (g.lat == null || g.lng == null) return null;   // failed → quarantine (tdlr-tabs.ts)
        return { lat: g.lat, lng: g.lng, match_type: g.match_type, matched_address: g.matched_address, geocode_source: g.geocode_source, needs_review: g.needs_review };
      },
    });
    // TASK 1 — structured open-data permit/case records (Socrata), coverage-gated per registry entry.
    // Generic connector; adding a city is a jurisdiction-registry.json edit, never code here. Records
    // are development point records (relevance:"development") bucketed by their status_to_bucket type.
    const socrata = await socrataForZip(zip, (commRows ?? []) as SocrataCommunityRow[], SOCRATA_ENTRIES, {
      fetch,
      geocode: async (a: string) => {
        const g = await resolveGeocode(geoStore, a, canonicalAddr(a), geoLadder);
        if (g.lat == null || g.lng == null) return null;   // failed → quarantine (socrata.ts)
        return { lat: g.lat, lng: g.lng, match_type: g.match_type, matched_address: g.matched_address, geocode_source: g.geocode_source, needs_review: g.needs_review };
      },
      appToken: Deno.env.get("SOCRATA_APP_TOKEN") || undefined,
      zipCentroid: { lat: clat, lng: clng },
    });
    // TASK 1 (ArcGIS twin) — same generic, coverage-gated connector for Esri/ArcGIS FeatureServer
    // permit/case layers (e.g. Salt Lake City building permits). Adding a jurisdiction is a
    // jurisdiction-registry.json `arcgis` edit, never code here. Same NormalizedRecord shape + gates.
    const arcgis = await arcgisForZip(zip, (commRows ?? []) as { state?: string | null; county?: string | null }[], ARCGIS_ENTRIES, {
      fetch,
      geocode: async (a: string) => {
        const g = await resolveGeocode(geoStore, a, canonicalAddr(a), geoLadder);
        if (g.lat == null || g.lng == null) return null;   // failed → quarantine (arcgis.ts)
        return { lat: g.lat, lng: g.lng, match_type: g.match_type, matched_address: g.matched_address, geocode_source: g.geocode_source, needs_review: g.needs_review };
      },
      // ZIP centroid for entries using spatial_zip_radius_mi (layers with no ZIP attribute) —
      // the engine's standard centroid+radius ZIP approximation; records keep their own points.
      zipCentroid: { lat: clat, lng: clng },
    });
    // TASK 1 (CKAN twin) — same generic, coverage-gated connector for CKAN datastore portals
    // (e.g. Boston's data.boston.gov Approved Building Permits). Adding a jurisdiction is a
    // jurisdiction-registry.json `ckan` edit, never code here. Same NormalizedRecord shape + gates.
    const ckan = await ckanForZip(zip, (commRows ?? []) as CkanCommunityRow[], CKAN_ENTRIES, {
      fetch,
      geocode: async (a: string) => {
        const g = await resolveGeocode(geoStore, a, canonicalAddr(a), geoLadder);
        if (g.lat == null || g.lng == null) return null;   // failed → quarantine (ckan.ts)
        return { lat: g.lat, lng: g.lng, match_type: g.match_type, matched_address: g.matched_address, geocode_source: g.geocode_source, needs_review: g.needs_review };
      },
    });
    // TASK 1 (CSV twin) — same generic, coverage-gated connector for first-party portals whose
    // interface is a published CSV file (e.g. San Diego's seshat.datasd.org approvals ledger).
    // Adding a jurisdiction is a jurisdiction-registry.json `csv` edit, never code here. The
    // file is fetched once per cache window (module memo) and served to every ZIP in the batch.
    const csv = await csvForZip(zip, (commRows ?? []) as CsvCommunityRow[], CSV_ENTRIES, {
      fetch,
      geocode: async (a: string) => {
        const g = await resolveGeocode(geoStore, a, canonicalAddr(a), geoLadder);
        if (g.lat == null || g.lng == null) return null;   // failed → quarantine (csv.ts)
        return { lat: g.lat, lng: g.lng, match_type: g.match_type, matched_address: g.matched_address, geocode_source: g.geocode_source, needs_review: g.needs_review };
      },
      zipCentroid: { lat: clat, lng: clng },
    });
    // TASK 1 (Carto twin) — same generic, coverage-gated connector for Carto SQL-API portals
    // (e.g. Philadelphia's phl.carto.com permits table). Adding a jurisdiction is a
    // jurisdiction-registry.json `carto` edit, never code here. ZIP scoping is a LIKE prefix
    // (Carto portals store ZIP+4); geometry rides PostGIS ST_Y/ST_X of the entry's geom_col.
    const carto = await cartoForZip(zip, (commRows ?? []) as CartoCommunityRow[], CARTO_ENTRIES, {
      fetch,
      geocode: async (a: string) => {
        const g = await resolveGeocode(geoStore, a, canonicalAddr(a), geoLadder);
        if (g.lat == null || g.lng == null) return null;   // failed → quarantine (carto.ts)
        return { lat: g.lat, lng: g.lng, match_type: g.match_type, matched_address: g.matched_address, geocode_source: g.geocode_source, needs_review: g.needs_review };
      },
    });
    // Anti-fabrication: a marker with no official record URL is not rendered, not counted.
    const dev = devRaw.filter((s) => (s.url as string) && (s.url as string).trim() !== "");
    // TABS filings are development records by construction (state permit registry) — stamp
    // relevance/rel_rule so the cache stays queryable alongside the v15 classifier's output,
    // and canonical_addr (v17) so filings at one address share one property_reports key.
    const tabsSites: Record<string, unknown>[] = tabs.sites
      .filter((s) => (s.record_url || "").trim() !== "")
      .map((s) => { const [e, n] = toEN(clat, clng, s.lat!, s.lng!); return { ...s, e, n, relevance: "development", rel_rule: "source:tabs", canonical_addr: s.location_addr ? canonicalAddr(s.location_addr) : undefined }; });
    // Socrata records → engine site shape. record_url is the anti-fabrication key; also mirror it to
    // `url` so the shared dev gate + page link logic (which read `url`) treat them like other dev items.
    // A point record (source coords or geocoded address) sits at its real lat/lng; a jurisdiction-scope
    // record anchors at the report centroid like any area item (its coordinates are never displayed).
    const socrataSites: Record<string, unknown>[] = (socrata.sites as unknown as Record<string, unknown>[])
      .filter((s) => String(s.record_url || "").trim() !== "")
      .map((s) => {
        const lat = s.lat as number | null, lng = s.lng as number | null;
        const pt = lat != null && lng != null;
        const [e, n] = pt ? toEN(clat, clng, lat as number, lng as number) : [0, 0];
        return { ...s, url: s.record_url, e, n, lat: pt ? lat : clat, lng: pt ? lng : clng };
      });
    // ArcGIS records → engine site shape (identical mapping to socrataSites above).
    const arcgisSites: Record<string, unknown>[] = (arcgis.sites as unknown as Record<string, unknown>[])
      .filter((s) => String(s.record_url || "").trim() !== "")
      .map((s) => {
        const lat = s.lat as number | null, lng = s.lng as number | null;
        const pt = lat != null && lng != null;
        const [e, n] = pt ? toEN(clat, clng, lat as number, lng as number) : [0, 0];
        return { ...s, url: s.record_url, e, n, lat: pt ? lat : clat, lng: pt ? lng : clng };
      });
    // CKAN records → engine site shape (identical mapping to socrataSites above).
    const ckanSites: Record<string, unknown>[] = (ckan.sites as unknown as Record<string, unknown>[])
      .filter((s) => String(s.record_url || "").trim() !== "")
      .map((s) => {
        const lat = s.lat as number | null, lng = s.lng as number | null;
        const pt = lat != null && lng != null;
        const [e, n] = pt ? toEN(clat, clng, lat as number, lng as number) : [0, 0];
        return { ...s, url: s.record_url, e, n, lat: pt ? lat : clat, lng: pt ? lng : clng };
      });
    // CSV records → engine site shape (identical mapping to socrataSites above).
    const csvSites: Record<string, unknown>[] = (csv.sites as unknown as Record<string, unknown>[])
      .filter((s) => String(s.record_url || "").trim() !== "")
      .map((s) => {
        const lat = s.lat as number | null, lng = s.lng as number | null;
        const pt = lat != null && lng != null;
        const [e, n] = pt ? toEN(clat, clng, lat as number, lng as number) : [0, 0];
        return { ...s, url: s.record_url, e, n, lat: pt ? lat : clat, lng: pt ? lng : clng };
      });
    // Carto records → engine site shape (identical mapping to socrataSites above).
    const cartoSites: Record<string, unknown>[] = (carto.sites as unknown as Record<string, unknown>[])
      .filter((s) => String(s.record_url || "").trim() !== "")
      .map((s) => {
        const lat = s.lat as number | null, lng = s.lng as number | null;
        const pt = lat != null && lng != null;
        const [e, n] = pt ? toEN(clat, clng, lat as number, lng as number) : [0, 0];
        return { ...s, url: s.record_url, e, n, lat: pt ? lat : clat, lng: pt ? lng : clng };
      });
    const fac = facRaw.filter((s) => (s.record_url as string) && (s.record_url as string).trim() !== "");
    // v17: persist the per-address dossier rows for this ZIP (small N; must never fail the page).
    const isTx = (commRows ?? []).some((c) => /^(tx|texas)$/i.test(String((c as { state?: string }).state || "").trim()));
    const countyRow = (commRows ?? []).find((c) => (c as { county?: string }).county) as { county?: string; state?: string } | undefined;
    try {
      await writePropertyReports(supabase, zip, countyRow?.county ?? null, countyRow?.state ?? null,
        tabsSites, isTx, "get-address-report v17 ZIP mode");
    } catch (_e) { /* never block the page response */ }
    // Only genuine land-use items count as development; civic notices are carried in sites
    // (the page lists them non-headlined) but never inflate the project counts.
    const devReal = dev.filter((s) => s.relevance !== "civic");
    // TASK 5 — ONE PREDICATE PER NUMBER. Each band's count is the length of the exact record
    // array that ships in that band's list, so a counter can never disagree with its rail. A
    // development record is any non-civic land-use record (area planning notice + TABS filing +
    // Socrata permit/case); its lifecycle `type` (built|approved|proposed) IS the band. The page
    // groups sites[] by the same type, so counts.{proposed,approved,operating} === the rendered
    // arrays by construction. counts.development stays the sum (back-compat).
    const today = new Date().toISOString().slice(0, 10);
    for (const s of devReal) {
      // Stamp comment_open on an area notice that has a real, still-open comment deadline; the
      // page renders exactly these as commentable, so counts.comment_open === the commentable set.
      // Structured permit rows (TABS/Socrata) carry no comment window → comment_open stays false.
      if (s.scope === "area" && !s.decided && s.comment_deadline && String(s.comment_deadline).slice(0, 10) >= today) s.comment_open = true;
    }
    const devRecords = [...devReal, ...tabsSites, ...socrataSites, ...arcgisSites, ...ckanSites, ...csvSites, ...cartoSites];
    const proposedRecords = devRecords.filter((s) => s.type === "proposed");
    const approvedRecords = devRecords.filter((s) => s.type === "approved");
    const operatingRecords = devRecords.filter((s) => s.type === "built");
    const commentOpenRecords = devRecords.filter((s) => s.comment_open === true);
    const allSites = [...dev, ...tabsSites, ...socrataSites, ...arcgisSites, ...ckanSites, ...csvSites, ...cartoSites, ...fac];
    const access = await accessLevel(req, supabase);
    const sites = access === "full" ? allSites : allSites.slice(0, TEASER_LIMIT);
    const locked = access === "full" ? 0 : Math.max(0, allSites.length - sites.length);
    // v19: env-records audit — how many facilities carry EPA ECHO compliance and/or a TCEQ RN.
    const envEpa = fac.filter((s) => (s.env as { epa?: unknown } | undefined)?.epa).length;
    const envTceq = fac.filter((s) => (s.env as { tceq?: unknown } | undefined)?.tceq).length;
    // TABS records are development filings → counts.development, never counts.facilities.
    return json({ zip, mode: "zip", home: { lat: clat, lng: clng }, radius_mi: zipRadius, access, paywall: PAYWALL_ENABLED, counts: { facilities: fac.length, proposed: proposedRecords.length, approved: approvedRecords.length, operating: operatingRecords.length, development: proposedRecords.length + approvedRecords.length + operatingRecords.length, comment_open: commentOpenRecords.length, civic: dev.length - devReal.length, locked }, tabs_quarantined: tabs.quarantined, socrata_reports: socrata.reports, arcgis_reports: arcgis.reports, ckan_reports: ckan.reports, csv_reports: csv.reports, carto_reports: carto.reports, env_records: { epa_matched: envEpa, tceq_matched: tceqStats.matched, tceq_dataset: tceq.dataset ?? null, tceq_entities: tceq.entities.length, tceq_quarantined: tceq.quarantined }, note: "ZIP-wide view centered on the ZIP centroid (not a home). Development items are jurisdiction-level (scope=area); facilities are precise (scope=point). Environmental records (EPA ECHO federal + TCEQ Central Registry state) are geo-matched to each facility. Not for resale.", sites }, 200, cors);
  }

  const address = (body.address || "").trim();
  if (!address) return json({ error: "address required" }, 400, cors);
  const radiusMi = Math.min(Math.max(Number(body.radius_mi) || 1, 0.25), MAX_RADIUS_MI);
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  let lat: number, lng: number, matched: string;
  try { [lat, lng, matched] = await geocode(address); } catch (e) { return json({ error: String(e instanceof Error ? e.message : e) }, 422, cors); }
  const zipM = matched.match(/\b(\d{5})\b/);
  const communityIds = await resolveCommunityIds(supabase, zipM ? zipM[1] : null);
  const [dev, fac] = await Promise.all([devSites(supabase, lat, lng, communityIds), facilitySites(lat, lng, radiusMi)]);
  await enrichViolations(supabase, fac);
  // v19: same environmental-records layer as ZIP mode — live ECHO compliance + TCEQ Central
  // Registry (coverage-gated to TX), geo-matched onto the facilities we already placed.
  await echoEnrich(fac, lat, lng, radiusMi);
  const { data: addrComm } = await supabase.from("communities").select("state,county").contains("zip_codes", [zipM ? zipM[1] : ""]);
  const addrTceq = await tceqForZip(zipM ? zipM[1] : "", (addrComm ?? []) as TceqCommunityRow[], { fetch });
  enrichTceq(fac, addrTceq.entities);
  stripEnvInternals(fac);
  const allSites = [...dev, ...fac];
  const devReal = dev.filter((s) => s.relevance !== "civic");
  // TASK 5 — same one-predicate-per-number counts as ZIP mode (address mode has no TABS/Socrata
  // point records today, so the development set is the non-civic area notices).
  const today = new Date().toISOString().slice(0, 10);
  for (const s of devReal) {
    if (s.scope === "area" && !s.decided && s.comment_deadline && String(s.comment_deadline).slice(0, 10) >= today) s.comment_open = true;
  }
  const proposedRecords = devReal.filter((s) => s.type === "proposed");
  const approvedRecords = devReal.filter((s) => s.type === "approved");
  const operatingRecords = devReal.filter((s) => s.type === "built");
  const commentOpenRecords = devReal.filter((s) => s.comment_open === true);
  const access = await accessLevel(req, supabase);
  const sites = access === "full" ? allSites : allSites.slice(0, TEASER_LIMIT);
  const locked = access === "full" ? 0 : Math.max(0, allSites.length - sites.length);
  return json({ address: matched, home: { lat, lng }, radius_mi: radiusMi, access, paywall: PAYWALL_ENABLED, counts: { facilities: fac.length, proposed: proposedRecords.length, approved: approvedRecords.length, operating: operatingRecords.length, development: proposedRecords.length + approvedRecords.length + operatingRecords.length, comment_open: commentOpenRecords.length, civic: dev.length - devReal.length, locked }, note: "Development items are jurisdiction-level (scope=area); facilities are precise (scope=point). Violations link to the EPA ECHO record. Not for resale.", sites }, 200, cors);
}
