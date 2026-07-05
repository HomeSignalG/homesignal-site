// get-address-report — Supabase edge function (project qwnnmljucajnexpxdgxr), DEPLOYED v13.
// PARKED HERE FOR REFERENCE/REPRODUCIBILITY ONLY — Supabase is the source of truth
// (docs/development-tracker-source-of-truth.md §2). v11 = MULTI-COUNTY: resolveCommunityIds()
// maps a ZIP to its own community chain (city+county) so each ZIP shows its OWN county's
// planning notices, never a hardcoded one; ZIP mode + address mode both use it. v12 = FRS
// radius back-off + tolerant JSON: dense urban ZIPs made the fixed 5-mi EPA-FRS query exceed
// FRS's process limit, which returned an error object the old code read as 0 facilities — so the
// densest ZIPs falsely showed zero. frsFacilities() now shrinks the radius until FRS answers and
// escapes FRS's invalid-JSON backslashes. v13 = distinguish transient FRS 5xx (retry same radius)
// from the process-limit error (shrink) — a flaky FRS 502 was making the code shrink and undercount
// (Box Elder 23→18); floor lowered to 0.25 mi. Address-mode input/output shape unchanged. Redeploy
// via mcp__Supabase__deploy_edge_function — committing does not deploy.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const BOX_ELDER_COMMUNITY_ID = "d67c558f-1f04-4811-a565-873ae2afd6f3";
const DEV_CATEGORIES = [
  "Planning, zoning & development",
  "Stratos data center project",
  "County Commission & county business",
];
const MILES_PER_DEG_LAT = 69.0;
const MAX_FACILITIES = 40;
const MAX_RADIUS_MI = 5;
const TEASER_LIMIT = 5;
const PAYWALL_ENABLED = (Deno.env.get("PAYWALL_ENABLED") || "").toLowerCase() === "true";

// ── ZIP mode (additive; see docs/development-tracker-source-of-truth.md §3) ──────────
// A ZIP centroid anchors the crawlable /development/<zip> page. Centroids are PINNED to the
// `zipcodes` PyPI package v3.0.0 (bundled offline USPS dataset — the same authoritative
// source the alerts builds pin, community-build-source-of-truth.md §12.0). The refresh
// batch owns the ZIP dataset and passes {zip,lat,lng}; this built-in map lets a bare
// {zip} resolve for the pilot ZIPs without embedding a national dataset in the function.
// A ZIP with no pinned centroid returns 422 — it is never given a guessed point.
const ZCTA_CENTROIDS: Record<string, [number, number]> = {
  "84302": [41.5079, -112.0152], // Brigham City, Box Elder County, UT — zipcodes v3.0.0
};
const ZIP_RADIUS_MI = 3; // centroid-radius approximation of a ZIP's extent (polygon-precise
                         // clipping is a decoupled engine enrichment, §7.6)

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
  const { data: alerts } = await supabase.from("alerts").select("title,category,agency_name,geographic_reference,source_url,comment_deadline").in("community_id", communityIds).eq("pipeline_type", "government_notice").in("category", DEV_CATEGORIES).order("published_at", { ascending: false }).limit(100);
  const { data: meetings } = await supabase.from("meetings").select("title,category,location,meeting_date,source_url,is_public_hearing,comment_period_open").in("community_id", communityIds).or("is_public_hearing.eq.true,comment_period_open.eq.true").order("meeting_date", { ascending: false }).limit(150);
  for (const a of alerts ?? []) {
    const pt = centroid((a.geographic_reference as string) || (a.agency_name as string) || "");
    if (!pt) continue;
    const [e, n] = toEN(homeLat, homeLng, pt[0], pt[1]);
    const title = ((a.title as string) || "").trim();
    const approved = /\b(approved|approves|granted|adopted|entitled|permit issued|issued a permit|under construction|final plat|site plan approv|authoriz|ground ?break|breaks ground|begins construction|construction begins)\b/i.test(title);
    const s: Record<string, unknown> = { label: title.slice(0, 120) || "Development item", e, n, lat: pt[0], lng: pt[1], scope: "area", type: approved ? "approved" : "proposed", layer: classifyLayer(title, a.category as string), src: ((a.agency_name as string) || (a.category as string) || "Planning record").trim(), url: (a.source_url as string) || "" };
    if (a.comment_deadline) s.comment_deadline = a.comment_deadline;
    sites.push(s);
  }
  for (const m of meetings ?? []) {
    const pt = centroid((m.location as string) || "") ?? PLACES["box elder county"];
    const [e, n] = toEN(homeLat, homeLng, pt[0], pt[1]);
    sites.push({ label: ((m.title as string) || "Public hearing").slice(0, 120), e, n, lat: pt[0], lng: pt[1], scope: "area", type: "proposed", layer: classifyLayer((m.title as string) || "", m.category as string), src: m.is_public_hearing ? "Public hearing" : "Comment window", url: (m.source_url as string) || "", meeting_date: m.meeting_date });
  }
  const groups: Record<string, Record<string, unknown>[]> = {};
  for (const s of sites) { const k = `${(s.lat as number).toFixed(4)},${(s.lng as number).toFixed(4)}`; (groups[k] ??= []).push(s); }
  for (const members of Object.values(groups)) {
    if (members.length < 2) continue;
    members.forEach((s, i) => { const ang = i * 2.399963, rad = 0.18 + 0.09 * Math.sqrt(i); s.e = Math.round(((s.e as number) + rad * Math.cos(ang)) * 1000) / 1000; s.n = Math.round(((s.n as number) + rad * Math.sin(ang)) * 1000) / 1000; s.approx = true; });
  }
  return sites;
}
// One FRS query at a fixed radius. Distinguishes the two failure modes that matter:
//  • tooBig  → FRS returned its "Process Limit would be exceeded" Error object (deterministic,
//              result set too large). Retrying the same radius is futile — must shrink.
//  • transient → 5xx / network / parse failure (FRS is intermittently flaky and 502s under load).
//              Retrying the SAME radius is the right move; shrinking here would undercount.
async function frsAt(lat: number, lng: number, rad: number): Promise<{ ok: boolean; tooBig: boolean; rows: Record<string, unknown>[] }> {
  const q = new URLSearchParams({ latitude83: lat.toFixed(6), longitude83: lng.toFixed(6), search_radius: String(rad), output: "JSON" });
  try {
    const r = await fetch(`https://ofmpub.epa.gov/frs_public2/frs_rest_services.get_facilities?${q}`, { signal: AbortSignal.timeout(30000) });
    if (r.status >= 500) return { ok: false, tooBig: false, rows: [] };   // transient FRS 5xx
    const text = await r.text();
    // Escape any backslash that isn't the start of a valid JSON escape so JSON.parse survives FRS
    // payloads like "BULLOUGHS INSULATION\B..." (a lone backslash, invalid JSON).
    const data = JSON.parse(text.replace(/\\(?!["\\/bfnrtu])/g, "\\\\")) as Record<string, unknown>;
    const res = data?.Results as Record<string, unknown> | undefined;
    if (res?.Error) return { ok: false, tooBig: true, rows: [] };          // process-limit refusal
    const rows = (res?.FRSFacility ?? res?.Facilities ?? data?.FRSFacility ?? []) as Record<string, unknown>[];
    return { ok: true, tooBig: false, rows: Array.isArray(rows) ? rows : [] };
  } catch (_e) { return { ok: false, tooBig: false, rows: [] }; }          // network/parse → transient
}
// Fetch FRS facilities with radius back-off + transient retry. FRS refuses a query whose result set
// is too large ("Process Limit would be exceeded") — common in dense urban ZIPs (downtown SLC has
// 800+ facilities within a mile). The old code read that error through `?? []` as ZERO facilities,
// so the DENSEST ZIPs falsely showed nothing. We start at the needed radius and shrink ONLY on the
// process-limit error; on a transient 5xx we retry the same radius (shrinking there would undercount,
// which is exactly how a flaky FRS made Box Elder drop 23→18). Floor is 0.25 mi for ultra-dense cores.
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
// Resolve a ZIP to the community rows whose jurisdiction covers it (the ZIP's chain — its
// city + county). Planning notices are queried for THESE ids, so each ZIP shows its OWN
// county's hearings, not a hardcoded one. A ZIP with no modeled community → [] (facilities-
// only, never another county's notices — that would be fabrication). Box Elder ZIPs resolve
// to [Brigham City, Box Elder County]; only the county carries content, so output is unchanged.
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
  let body: { address?: string; radius_mi?: number; zip?: string | number; lat?: number; lng?: number };
  try { body = await req.json(); } catch { return json({ error: "bad JSON" }, 400, cors); }

  // ── ZIP MODE (additive) ────────────────────────────────────────────────────────────
  // {zip[,lat,lng]} → home = ZIP centroid, sites = points inside the ZIP + that ZIP's
  // jurisdiction notices, counts computed ZIP-wide. The anti-fabrication guarantee is
  // enforced HERE: only sites carrying a public-record URL survive. Address mode below is
  // left byte-for-byte unchanged (docs/development-tracker-source-of-truth.md §3).
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
    // Anti-fabrication: a marker with no official record URL is not rendered, not counted.
    const dev = devRaw.filter((s) => (s.url as string) && (s.url as string).trim() !== "");
    const fac = facRaw.filter((s) => (s.record_url as string) && (s.record_url as string).trim() !== "");
    const allSites = [...dev, ...fac];
    const access = await accessLevel(req, supabase);
    const sites = access === "full" ? allSites : allSites.slice(0, TEASER_LIMIT);
    const locked = access === "full" ? 0 : Math.max(0, allSites.length - sites.length);
    return json({ zip, mode: "zip", home: { lat: clat, lng: clng }, radius_mi: zipRadius, access, paywall: PAYWALL_ENABLED, counts: { facilities: fac.length, development: dev.length, locked }, note: "ZIP-wide view centered on the ZIP centroid (not a home). Development items are jurisdiction-level (scope=area); facilities are precise (scope=point). Violations link to the EPA ECHO record. Not for resale.", sites }, 200, cors);
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
  const access = await accessLevel(req, supabase);
  const sites = access === "full" ? allSites : allSites.slice(0, TEASER_LIMIT);
  const locked = access === "full" ? 0 : Math.max(0, allSites.length - sites.length);
  return json({ address: matched, home: { lat, lng }, radius_mi: radiusMi, access, paywall: PAYWALL_ENABLED, counts: { facilities: fac.length, development: dev.length, locked }, note: "Development items are jurisdiction-level (scope=area); facilities are precise (scope=point). Violations link to the EPA ECHO record. Not for resale.", sites }, 200, cors);
});
