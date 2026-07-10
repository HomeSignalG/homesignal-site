// get-address-report — Supabase edge function (project qwnnmljucajnexpxdgxr), DEPLOYED v17.
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
import tabsPinsTravis from "./pins/tdlr-tabs-projects.travis.json" with { type: "json" };
import { censusRung, geocodioRung, resolveGeocode, supabaseStore, txgioRung } from "./geocode-cache.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// Geocodio fallback rung is OPT-IN: only added to the ladder if the secret is set. Absent key
// → ladder is TxGIO → Census (no error). Cap defaults to 25,000 lookups/mo (~$25 ceiling).
const GEOCODIO_API_KEY = Deno.env.get("GEOCODIO_API_KEY") ?? "";
const GEOCODIO_MONTHLY_CAP = Number(Deno.env.get("GEOCODIO_MONTHLY_CAP") ?? "25000");

const BOX_ELDER_COMMUNITY_ID = "d67c558f-1f04-4811-a565-873ae2afd6f3";
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

const PLACES: Record<string, [number, number]> = {
  "brigham city": [41.5105, -112.0155], "tremonton": [41.7130, -112.1655],
  "garland": [41.7410, -112.1610], "perry": [41.4622, -112.0283],
  "willard": [41.4099, -112.0361], "corinne": [41.5544, -112.1141],
  "mantua": [41.5033, -111.9430], "honeyville": [41.6411, -112.0791],
  "deweyville": [41.7002, -112.0930], "bear river city": [41.6161, -112.1319],
  "fielding": [41.8125, -112.1136], "elwood": [41.6922, -112.1502],
  "snowville": [41.9647, -112.7105], "box elder county": [41.5105, -112.0155],
};

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
function centroid(geoRef: string): [number, number] | null {
  const low = (geoRef || "").toLowerCase();
  for (const [name, pt] of Object.entries(PLACES)) if (low.includes(name)) return pt;
  if (low.includes("box elder") || low.includes("utah")) return PLACES["box elder county"];
  return null;
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
  const floorIso = new Date(Date.now() - MEETING_LOOKBACK_DAYS * 86400000).toISOString().slice(0, 10);
  const { data: alerts } = await supabase.from("alerts").select("title,category,agency_name,geographic_reference,source_url,comment_deadline").in("community_id", communityIds).eq("pipeline_type", "government_notice").in("category", DEV_CATEGORIES).order("published_at", { ascending: false }).limit(100);
  const { data: meetings } = await supabase.from("meetings").select("title,category,location,meeting_date,source_url,is_public_hearing,comment_period_open").in("community_id", communityIds).or("is_public_hearing.eq.true,comment_period_open.eq.true").gte("meeting_date", floorIso).order("meeting_date", { ascending: false }).limit(150);
  for (const a of alerts ?? []) {
    const pt = centroid((a.geographic_reference as string) || (a.agency_name as string) || "");
    if (!pt) continue;
    const [e, n] = toEN(homeLat, homeLng, pt[0], pt[1]);
    const title = ((a.title as string) || "").trim();
    const approved = /\b(approved|approves|granted|adopted|entitled|permit issued|issued a permit|under construction|final plat|site plan approv|authoriz|ground ?break|breaks ground|begins construction|construction begins)\b/i.test(title);
    // A DECIDED item (approved OR denied/withdrawn/tabled) is not an open comment opportunity.
    const denied = /\b(denied|denies|deny|withdrawn|withdrew|withdraws|rejected|rejects|tabled|dismissed|vacated|rescinded)\b/i.test(title);
    const [rel, relRule] = classifyRelevance(title, (a.category as string) || "", (a.agency_name as string) || "");
    const s: Record<string, unknown> = { label: title.slice(0, 120) || "Development item", e, n, lat: pt[0], lng: pt[1], scope: "area", type: approved ? "approved" : "proposed", decided: approved || denied, relevance: rel, rel_rule: relRule, layer: classifyLayer(title, a.category as string), src: ((a.agency_name as string) || (a.category as string) || "Planning record").trim(), url: (a.source_url as string) || "" };
    if (a.comment_deadline) s.comment_deadline = a.comment_deadline;
    sites.push(s);
  }
  for (const m of meetings ?? []) {
    const pt = centroid((m.location as string) || "") ?? PLACES["box elder county"];
    const [e, n] = toEN(homeLat, homeLng, pt[0], pt[1]);
    const [rel, relRule] = classifyRelevance((m.title as string) || "", (m.category as string) || "", "");
    sites.push({ label: ((m.title as string) || "Public hearing").slice(0, 120), e, n, lat: pt[0], lng: pt[1], scope: "area", type: "proposed", decided: false, relevance: rel, rel_rule: relRule, layer: classifyLayer((m.title as string) || "", m.category as string), src: m.is_public_hearing ? "Public hearing" : "Comment window", url: (m.source_url as string) || "", meeting_date: m.meeting_date });
  }
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
// Best-effort EPA ECHO violation-count enrichment (shared by both modes; read-only).
async function enrichViolations(supabase: ReturnType<typeof createClient>, fac: Record<string, unknown>[]): Promise<void> {
  const rids = fac.map((f) => f.registry_id as string).filter(Boolean);
  if (!rids.length) return;
  try {
    const { data: rows } = await supabase.from("echo_violation_counts").select("registry_id,count").in("registry_id", rids);
    const byId = new Map((rows ?? []).map((r) => [r.registry_id as string, r.count as number]));
    for (const f of fac) { const c = byId.get(f.registry_id as string); if (c && c > 0) { f.viol = c; f.violUrl = f.record_url; } }
  } catch (_e) { /* best-effort */ }
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
// Resolve a ZIP to the community rows whose jurisdiction covers it (city + county chain).
async function resolveCommunityIds(supabase: ReturnType<typeof createClient>, zip: string | null): Promise<string[]> {
  if (!zip || !/^\d{5}$/.test(zip)) return [];
  const { data } = await supabase.from("communities").select("id").contains("zip_codes", [zip]);
  return (data ?? []).map((r) => r.id as string);
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
Deno.serve(async (req: Request) => {
  const cors = corsHeaders();
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405, cors);
  let body: { address?: string; radius_mi?: number; zip?: string | number; lat?: number; lng?: number; regeocode?: string[]; diag?: string };
  try { body = await req.json(); } catch { return json({ error: "bad JSON" }, 400, cors); }

  // ── TEMPORARY DIAGNOSTIC (v21, to be removed) ── {diag:"geocodio"} → reports ONLY whether the
  // function can see GEOCODIO_API_KEY and its length. NEVER returns the key value. Remove once
  // the secret is confirmed working.
  if (body.diag === "geocodio") {
    return json({ geocodio_key_present: !!GEOCODIO_API_KEY, geocodio_key_len: GEOCODIO_API_KEY.length, geocodio_monthly_cap: GEOCODIO_MONTHLY_CAP }, 200, cors);
  }

  // ── RE-GEOCODE MODE ── {regeocode:["<canonical_addr>",...]} → the improvement-guarded batch.
  // For each address ALREADY in geocodes, re-run the ladder fresh (forceRefresh bypasses the
  // write-once cache read) and write through upsert_geocode_if_better (only upgrades; no delete
  // gap), bumping provider_vintage. Reports before/after so an upgrade is auditable. Bounded to
  // existing rows (input_address is read from geocodes) and to the Geocodio monthly cap.
  if (Array.isArray(body.regeocode)) {
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const geoStore = supabaseStore(supabase);
    const geoLadder = [
      txgioRung(supabase, "tx_address_points", "rooftop"),
      txgioRung(supabase, "tx_parcels", "parcel_centroid"),
      ...(GEOCODIO_API_KEY ? [geocodioRung(supabase, GEOCODIO_API_KEY, { monthlyCap: GEOCODIO_MONTHLY_CAP })] : []),
      censusRung(fetch),
    ];
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
    // TX TDLR/TABS enrichment (v16, additive — runbook §1). Coverage-gated inside
    // tabsForZip(): the source never runs for a non-TX ZIP. Separate query keeps
    // resolveCommunityIds() untouched (additive-only rule, source-registry #4).
    const { data: commRows } = await supabase.from("communities").select("state,county").contains("zip_codes", [zip]);
    // Geocoding goes through the write-once, quality-aware cache. The LADDER degrades in a fixed
    // precision order and NEVER hard-errors — each rung returns null on a miss so the next rung
    // is tried, ending at Census range_interpolation:
    //   TxGIO Address Points (rooftop, local lookup, no egress)
    //   → TxGIO Land Parcels (parcel_centroid, local lookup)
    //   → Geocodio (national fallback; opt-in via secret; monthly spend cap; fail-safe)
    //   → Census (range_interpolated, last resort).
    // Only rooftop clears needs_review; parcel_centroid renders but stays flagged (#2). Writes go
    // through the SQL improvement guard, so a re-geocode can only upgrade, never downgrade.
    const geoStore = supabaseStore(supabase);
    const geoLadder = [
      txgioRung(supabase, "tx_address_points", "rooftop"),
      txgioRung(supabase, "tx_parcels", "parcel_centroid"),
      ...(GEOCODIO_API_KEY ? [geocodioRung(supabase, GEOCODIO_API_KEY, { monthlyCap: GEOCODIO_MONTHLY_CAP })] : []),
      censusRung(fetch),
    ];
    const tabs = await tabsForZip(zip, (commRows ?? []) as { state?: string; county?: string }[], TABS_PINS, {
      fetch,
      geocode: async (a: string) => {
        const g = await resolveGeocode(geoStore, a, canonicalAddr(a), geoLadder);
        if (g.lat == null || g.lng == null) return null;   // failed → quarantine (tdlr-tabs.ts)
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
    const allSites = [...dev, ...tabsSites, ...fac];
    const access = await accessLevel(req, supabase);
    const sites = access === "full" ? allSites : allSites.slice(0, TEASER_LIMIT);
    const locked = access === "full" ? 0 : Math.max(0, allSites.length - sites.length);
    // TABS records are development filings → counts.development, never counts.facilities.
    return json({ zip, mode: "zip", home: { lat: clat, lng: clng }, radius_mi: zipRadius, access, paywall: PAYWALL_ENABLED, counts: { facilities: fac.length, development: devReal.length + tabsSites.length, civic: dev.length - devReal.length, locked }, tabs_quarantined: tabs.quarantined, note: "ZIP-wide view centered on the ZIP centroid (not a home). Development items are jurisdiction-level (scope=area); facilities are precise (scope=point). Violations link to the EPA ECHO record. Not for resale.", sites }, 200, cors);
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
  const rids = fac.map((f) => f.registry_id as string).filter(Boolean);
  if (rids.length) {
    try { const { data: rows } = await supabase.from("echo_violation_counts").select("registry_id,count").in("registry_id", rids); const byId = new Map((rows ?? []).map((r) => [r.registry_id as string, r.count as number])); for (const f of fac) { const c = byId.get(f.registry_id as string); if (c && c > 0) { f.viol = c; f.violUrl = f.record_url; } } } catch (_e) { /* best-effort */ }
  }
  const allSites = [...dev, ...fac];
  const devReal = dev.filter((s) => s.relevance !== "civic");
  const access = await accessLevel(req, supabase);
  const sites = access === "full" ? allSites : allSites.slice(0, TEASER_LIMIT);
  const locked = access === "full" ? 0 : Math.max(0, allSites.length - sites.length);
  return json({ address: matched, home: { lat, lng }, radius_mi: radiusMi, access, paywall: PAYWALL_ENABLED, counts: { facilities: fac.length, development: devReal.length, civic: dev.length - devReal.length, locked }, note: "Development items are jurisdiction-level (scope=area); facilities are precise (scope=point). Violations link to the EPA ECHO record. Not for resale.", sites }, 200, cors);
});
