// supabase/functions/get-address-report/sources/tdlr-tabs.ts
//
// TX TDLR/TABS source adapter — per-jurisdiction enrichment for Texas ZIPs.
// (Texas analog of the Utah PMN source; sits at level 2 in the §2 precedence table.)
//
// GOVERNANCE (docs/development-tracker-source-of-truth.md + the 78617 case-study doc):
//   • ANTI-FABRICATION: every emitted site carries record_url =
//     https://www.tdlr.texas.gov/TABS/Projects/<project_no>. A field the registry page
//     does not state is ABSENT on the site — never defaulted, never inferred.
//   • QUARANTINE, DON'T STOP: a project that fails to fetch, parse, or geocode is
//     returned in `quarantined[]` with a reason and skipped. The refresh continues.
//   • STEP-0 PINS (adapter will not run in search mode until these are set):
//       PIN_SEARCH: the exact TABS search interface (URL, method, params) captured
//                   live + committed as docs/pins/tdlr-tabs-search.md with vintage.
//       PIN_FIXTURES: ≥3 saved project-page HTML fixtures committed under
//                   supabase/functions/get-address-report/fixtures/tabs/ so the
//                   parser is tested against real markup, not assumptions.
//     Until PIN_SEARCH exists, run in REGISTRY MODE: refresh a committed list of
//     known project numbers (docs/pins/tdlr-tabs-projects.<county>.json). This keeps
//     the adapter shippable without asserting an unverified search API.
//
// The parser targets the labeled field structure of TABS "Architectural Barriers
// Project Details" pages (PROJECT / OWNER / TENANT / DESIGN FIRM sections with
// "Label:  Value" rows). Confirm against PIN_FIXTURES before first live run.

// ───────────────────────────── types ─────────────────────────────

/** Extended site shape (§4.1 of the case-study doc) — additive over the v15 contract. */
export interface TabsSite {
  // v15 core fields
  label: string;
  scope: "point";                       // TABS records carry real street addresses
  type: "built" | "approved";           // TABS has no "proposed" phase (see mapStatus)
  layer: string;                        // classified from scope_text (see classifyLayer)
  lat?: number;
  lng?: number;
  e?: number;                           // miles E of the report anchor (engine fills)
  n?: number;                           // miles N of the report anchor (engine fills)
  src: string;                          // "TX TDLR TABS · TABS2024022676"
  record_url: string;                   // the anti-fabrication key — always present
  // §4.1 extension fields — present ONLY when stated on the registry page
  project_no: string;
  owner?: string;
  owner_addr?: string;
  owner_phone?: string;                 // as filed (display)
  owner_phone_norm?: string;            // digits-only, for the entity matcher
  contact_name?: string;
  filed_by?: string;                    // PERSON FILING FORM → Contact Name (fixture-verified section)
  design_firm?: string;
  design_firm_addr?: string;
  design_firm_phone?: string;
  design_firm_phone_norm?: string;
  est_cost?: number;                    // USD
  sqft?: number;
  scope_text?: string;                  // the filing's Scope of Work, verbatim
  start_date?: string;                  // ISO YYYY-MM-DD
  end_date?: string;                    // ISO YYYY-MM-DD
  status_text?: string;                 // registry status, verbatim
  facility_name?: string;
  location_addr?: string;
  location_county?: string;
}

export interface Quarantined {
  project_no: string;
  reason: string;
}

export interface TabsRefreshResult {
  sites: TabsSite[];
  quarantined: Quarantined[];
}

/** Injected by the engine so this module stays transport/geocoder-agnostic. */
export interface TabsDeps {
  /** fetch impl (edge runtime's fetch). */
  fetch: typeof fetch;
  /** The engine's existing Census geocoder. Return null on failure → quarantine. */
  geocode: (address: string) => Promise<{ lat: number; lng: number } | null>;
  /** Polite delay between registry requests, ms. Default 1200. */
  delayMs?: number;
  /** Optional pinned search executor (set only after PIN_SEARCH exists). */
  search?: (q: TabsSearchQuery) => Promise<string[]>; // → project numbers
}

export interface TabsSearchQuery {
  county?: string;                      // e.g. "Travis"
  address?: string;                     // e.g. "2200 Caldwell"
  zip?: string;                         // e.g. "78617"
}

// ───────────────────────────── constants ─────────────────────────────

const TABS_BASE = "https://www.tdlr.texas.gov/TABS";
export const recordUrl = (projectNo: string) => `${TABS_BASE}/Projects/${projectNo}`;

const PROJECT_NO_RE = /^TABS\d{10}$/;   // e.g. TABS2024022676

// ───────────────────────────── public API ─────────────────────────────

/**
 * REGISTRY MODE — refresh a committed list of project numbers.
 * `projectNos` comes from docs/pins/tdlr-tabs-projects.<county>.json (pinned, reviewed).
 */
export async function refreshByRegistry(
  projectNos: string[],
  deps: TabsDeps,
): Promise<TabsRefreshResult> {
  const sites: TabsSite[] = [];
  const quarantined: Quarantined[] = [];
  const delay = deps.delayMs ?? 1200;

  for (const raw of projectNos) {
    const projectNo = String(raw).trim();
    if (!PROJECT_NO_RE.test(projectNo)) {
      quarantined.push({ project_no: projectNo, reason: "invalid project number format" });
      continue;
    }
    try {
      const res = await deps.fetch(recordUrl(projectNo), {
        headers: { "User-Agent": "HomeSignal public-records refresh (contact: admin@homesignal.net)" },
      });
      if (!res.ok) {
        quarantined.push({ project_no: projectNo, reason: `HTTP ${res.status} fetching record page` });
        continue;
      }
      const html = await res.text();
      const parsed = parseProjectHtml(html, projectNo);
      if ("error" in parsed) {
        quarantined.push({ project_no: projectNo, reason: parsed.error });
        continue;
      }
      const site = await normalize(parsed, deps);
      if ("error" in site) {
        quarantined.push({ project_no: projectNo, reason: site.error });
        continue;
      }
      sites.push(site);
    } catch (e) {
      quarantined.push({ project_no: projectNo, reason: `fetch/parse exception: ${(e as Error).message}` });
    }
    await sleep(delay); // be polite to the registry — sequential, throttled
  }
  return { sites, quarantined };
}

/**
 * SEARCH MODE — only callable once PIN_SEARCH exists and deps.search is provided.
 * Refuses (throws) otherwise: an unpinned search interface is a Step-0 stop for THIS
 * adapter job only — the page batch never blocks on it (§7.6).
 */
export async function refreshBySearch(
  q: TabsSearchQuery,
  deps: TabsDeps,
): Promise<TabsRefreshResult> {
  if (!deps.search) {
    throw new Error(
      "TABS search interface not pinned (PIN_SEARCH). Run in registry mode, or complete " +
      "Step 0: capture the live search interface into docs/pins/tdlr-tabs-search.md and " +
      "wire deps.search.",
    );
  }
  const projectNos = await deps.search(q);
  return refreshByRegistry(projectNos, deps);
}

// ───────────────────────────── parser ─────────────────────────────

interface ParsedProject {
  project_no: string;
  project_name?: string;
  facility_name?: string;
  location_addr?: string;
  location_county?: string;
  start_date?: string;
  end_date?: string;
  est_cost?: number;
  sqft?: number;
  scope_text?: string;
  status_text?: string;
  owner?: string;
  owner_addr?: string;
  owner_phone?: string;
  contact_name?: string;
  filed_by?: string;
  design_firm?: string;
  design_firm_addr?: string;
  design_firm_phone?: string;
}

/**
 * Label-based extraction from the TABS project details page.
 * The page renders labeled rows ("Project Name:", "Owner Name:", …) inside PROJECT /
 * OWNER / TENANT / DESIGN FIRM sections. We strip tags and read label → value pairs
 * per section, so modest markup changes don't break the parser. Anything not found
 * is simply absent (anti-fabrication: absent, never defaulted).
 *
 * VALIDATE AGAINST PIN_FIXTURES BEFORE FIRST LIVE RUN.
 */
export function parseProjectHtml(
  html: string,
  expectedProjectNo: string,
): ParsedProject | { error: string } {
  const text = htmlToText(html);

  // sanity: the page must state the project number we asked for
  const stated = text.match(/TABS\d{10}/)?.[0];
  if (!stated) return { error: "no project number found on page (layout change? wrong page?)" };
  if (stated !== expectedProjectNo) {
    return { error: `page states ${stated}, expected ${expectedProjectNo}` };
  }

  // split into sections so "Owner Phone" and "Design Firm Phone" can't cross-contaminate.
  // PERSON FILING FORM (fixture-verified section, between PROJECT and OWNER) has its own
  // "Contact Name:" row — fence it so it never bleeds into the PROJECT or OWNER reads.
  const sec = sectionize(text, ["PROJECT", "PERSON FILING FORM", "OWNER", "TENANT", "DESIGN FIRM", "RAS"]);
  const proj = sec["PROJECT"] ?? text;
  const filing = sec["PERSON FILING FORM"] ?? "";
  const owner = sec["OWNER"] ?? "";
  const firm = sec["DESIGN FIRM"] ?? "";

  const p: ParsedProject = { project_no: expectedProjectNo };

  p.project_name = field(proj, "Project Name");
  p.facility_name = field(proj, "Facility Name");
  p.location_county = field(proj, "Location County");
  p.location_addr = multilineField(proj, "Location Address", "Location County");
  p.start_date = isoDate(field(proj, "Start Date"));
  p.end_date = isoDate(field(proj, "Completion Date"));
  p.est_cost = usd(field(proj, "Estimated Cost"));
  p.sqft = sqft(field(proj, "Square Footage"));
  p.scope_text = field(proj, "Scope of Work");
  p.status_text = field(proj, "Current Status");

  p.owner = field(owner, "Owner Name");
  p.owner_addr = multilineField(owner, "Owner Address", "Owner Phone");
  p.owner_phone = phone(field(owner, "Owner Phone"));
  p.contact_name = field(owner, "Contact Name");
  p.filed_by = field(filing, "Contact Name");

  p.design_firm = field(firm, "Design Firm Name");
  p.design_firm_addr = multilineField(firm, "Design Firm Address", "Design Firm Phone");
  p.design_firm_phone = phone(field(firm, "Design Firm Phone"));

  if (!p.project_name && !p.facility_name) {
    return { error: "parse produced no project/facility name — layout change; re-pin fixtures" };
  }
  return p;
}

// ───────────────────────────── normalize ─────────────────────────────

async function normalize(
  p: ParsedProject,
  deps: TabsDeps,
): Promise<TabsSite | { error: string }> {
  // point-scope records MUST geocode; a point with no coordinates is a quarantine,
  // never a synthetic placement (case-study doc §6 standing answer).
  if (!p.location_addr) return { error: "no location address on record page" };
  const geo = await deps.geocode(p.location_addr);
  if (!geo) return { error: `geocode failed for "${p.location_addr}"` };

  const site: TabsSite = {
    label: p.project_name || p.facility_name || p.project_no,
    scope: "point",
    type: mapStatus(p.status_text, p.end_date),
    layer: classifyLayer(p.scope_text, p.project_name),
    lat: geo.lat,
    lng: geo.lng,
    src: `TX TDLR TABS · ${p.project_no}`,
    record_url: recordUrl(p.project_no),
    project_no: p.project_no,
  };

  // extension fields: copy ONLY what the page stated (absent stays absent)
  if (p.facility_name) site.facility_name = p.facility_name;
  if (p.location_addr) site.location_addr = p.location_addr;
  if (p.location_county) site.location_county = p.location_county;
  if (p.owner) site.owner = p.owner;
  if (p.owner_addr) site.owner_addr = p.owner_addr;
  if (p.owner_phone) {
    site.owner_phone = p.owner_phone;
    site.owner_phone_norm = digits(p.owner_phone);
  }
  if (p.contact_name) site.contact_name = p.contact_name;
  if (p.filed_by) site.filed_by = p.filed_by;
  if (p.design_firm) site.design_firm = p.design_firm;
  if (p.design_firm_addr) site.design_firm_addr = p.design_firm_addr;
  if (p.design_firm_phone) {
    site.design_firm_phone = p.design_firm_phone;
    site.design_firm_phone_norm = digits(p.design_firm_phone);
  }
  if (p.est_cost != null) site.est_cost = p.est_cost;
  if (p.sqft != null) site.sqft = p.sqft;
  if (p.scope_text) site.scope_text = p.scope_text;
  if (p.start_date) site.start_date = p.start_date;
  if (p.end_date) site.end_date = p.end_date;
  if (p.status_text) site.status_text = p.status_text;

  return site;
}

/**
 * Lifecycle mapping (case-study doc §4.2):
 *   terminal registry statuses → built; everything else registered → approved.
 * TABS registrations are filed projects, never proposals — "proposed" stays the
 * planning-notice sources' bucket.
 *
 * Fixture-verified (Step 0, 2026-07-10): "Review Complete" is a PLAN-REVIEW state,
 * not a construction-terminal one — TABS2026011928 carries it while its tenant
 * improvement is barely past the filed dates. Only "Project Closed" /
 * "Inspection Complete" are the registry asserting the work is done. For
 * non-terminal statuses fall back to the FILED completion date with a 90-day
 * grace, so a just-passed estimate doesn't flip a live project to built.
 */
export function mapStatus(statusText?: string, endDate?: string): "built" | "approved" {
  const s = (statusText || "").toLowerCase();
  if (/closed|inspection complete|project complete/.test(s)) return "built";
  if (endDate && daysSince(endDate) > 90) return "built"; // filed completion long passed
  return "approved";
}

/**
 * Layer classification from the filing's OWN scope-of-work text (fixes the
 * name-regex misfire flagged in the audit: "Histology Lab" → lab, "barn for
 * animal holding" → agriculture/research, not "Industrial facility").
 *
 * Fixture-verified (Step 0): the project NAME is only a fallback when the filing
 * states no scope — TABS2024016698 ("Barn 2 ACT Office", scope: interior office
 * fit-out) misclassified as animal-facility when name and scope were blended.
 * "Tenant improvement" / "fit-out" outrank a bare "manufacturing use" mention
 * (TABS2026011928: TI of shell space for office and manufacturing → commercial),
 * while a manufacturing BUILD stays industrial (TABS2024022676: new construction
 * with machine shop and cleanroom device manufacturing).
 */
export function classifyLayer(scopeText?: string, name?: string): string {
  const t = (scopeText || name || "").toLowerCase();
  if (/histolog|\blab\b|laborator|research|vivarium/.test(t)) return "research";
  if (/animal holding|\bbarn\b|livestock|kennel/.test(t)) return "animal-facility";
  if (/tenant improvement|fit.?out/.test(t)) return "commercial";
  if (/manufactur|assembly|fabricat/.test(t)) return "industrial";
  if (/office|shell space/.test(t)) return "commercial";
  if (/warehouse|logistic|distribution/.test(t)) return "logistics";
  if (/residen|apartment|housing/.test(t)) return "residential";
  if (/power|substation|solar|energy/.test(t)) return "energy";
  return "development";
}

// ───────────────────────────── engine integration (runbook §1) ─────────────────────────────

export interface TabsCommunityRow {
  state?: string | null;
  county?: string | null;
}

export interface TabsPins {
  county: string;
  project_nos: string[];
}

/**
 * ZIP-mode entry point for the engine — the ONLY function index.ts calls.
 * Additive TX-only branch:
 *  • COVERAGE GATE (docs/source-registry.md, mandatory): the source never runs for a
 *    ZIP whose resolved communities are not in Texas. No exceptions.
 *  • Registry mode per county: only pinned lists whose county matches the ZIP's
 *    resolved chain are refreshed.
 *  • ZIP scoping: a record whose FILED location address does not state the requested
 *    ZIP is dropped to the quarantine log (report, don't fail — §7.2), never rendered.
 * Returns sites (all record_url'd) + the quarantine log for the run output.
 */
export async function tabsForZip(
  zip: string,
  communities: TabsCommunityRow[],
  pinsByCounty: Record<string, TabsPins>,
  deps: TabsDeps,
): Promise<TabsRefreshResult> {
  const isTx = communities.some((c) => /^(tx|texas)$/i.test((c.state || "").trim()));
  if (!isTx) return { sites: [], quarantined: [] };   // coverage gate — TX only
  const counties = new Set(
    communities.map((c) => (c.county || "").trim().toLowerCase()).filter(Boolean),
  );
  const sites: TabsSite[] = [];
  const quarantined: Quarantined[] = [];
  for (const pins of Object.values(pinsByCounty)) {
    if (!counties.has(pins.county.trim().toLowerCase())) continue;
    const r = await refreshByRegistry(pins.project_nos, deps);
    for (const s of r.sites) {
      if ((s.location_addr || "").includes(zip)) sites.push(s);
      else quarantined.push({ project_no: s.project_no, reason: `outside ZIP ${zip} (filed location: ${s.location_addr})` });
    }
    quarantined.push(...r.quarantined);
  }
  return { sites, quarantined };
}

// ───────────────────────────── entity extraction ─────────────────────────────

export interface EntityRow {
  kind: "owner" | "contact" | "filer" | "design_firm";
  name: string;
  phone_norm?: string;
  address_norm?: string;
  record_url: string;                   // the filing that establishes this entity
  role: "owner" | "contact" | "filer" | "design_firm";
}

/** Feed for the nightly entity matcher (case-study doc §4.4). Pure extraction —
 *  linking (shared_phone / shared_contact / shared_address) happens in the matcher
 *  job, never here, and every link must cite ≥2 record_urls (verifier §4.5). */
export function entitiesFrom(site: TabsSite): EntityRow[] {
  const rows: EntityRow[] = [];
  if (site.owner) {
    rows.push({
      kind: "owner", role: "owner", name: site.owner,
      phone_norm: site.owner_phone_norm,
      address_norm: normAddr(site.owner_addr),
      record_url: site.record_url,
    });
  }
  if (site.contact_name) {
    rows.push({
      kind: "contact", role: "contact", name: site.contact_name,
      phone_norm: site.owner_phone_norm,   // contact is filed under the owner block's phone
      record_url: site.record_url,
    });
  }
  if (site.filed_by) {
    rows.push({
      // PERSON FILING FORM contact — name only, the form states no phone/address.
      // Links via shared_contact (name) in the matcher, never via a borrowed phone.
      kind: "filer", role: "filer", name: site.filed_by,
      record_url: site.record_url,
    });
  }
  if (site.design_firm) {
    rows.push({
      kind: "design_firm", role: "design_firm", name: site.design_firm,
      phone_norm: site.design_firm_phone_norm,
      address_norm: normAddr(site.design_firm_addr),
      record_url: site.record_url,
    });
  }
  return rows;
}

// ───────────────────────────── helpers ─────────────────────────────

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(div|p|tr|td|th|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n");
}

/** Split flattened text into named sections (section headings appear on their own line). */
function sectionize(text: string, headings: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  const idx = headings
    .map((h) => ({ h, i: text.search(new RegExp(`^\\s*${h}\\s*$`, "m")) }))
    .filter((x) => x.i >= 0)
    .sort((a, b) => a.i - b.i);
  for (let k = 0; k < idx.length; k++) {
    const start = idx[k].i;
    const end = k + 1 < idx.length ? idx[k + 1].i : text.length;
    out[idx[k].h] = text.slice(start, end);
  }
  return out;
}

/** Single-line labeled value: "Label: value\n". Absent → undefined (never ""). */
function field(section: string, label: string): string | undefined {
  const m = section.match(new RegExp(`${escapeRe(label)}\\s*:\\s*([^\\n]+)`, "i"));
  const v = m?.[1]?.trim();
  return v || undefined;
}

/** Multi-line labeled value (addresses): capture from the label until the next label. */
function multilineField(section: string, label: string, nextLabel: string): string | undefined {
  const re = new RegExp(
    `${escapeRe(label)}\\s*:\\s*([\\s\\S]*?)(?=${escapeRe(nextLabel)}\\s*:|$)`, "i",
  );
  const v = section.match(re)?.[1]?.replace(/\n+/g, ", ").replace(/\s{2,}/g, " ").replace(/\s+,/g, ",").replace(/,\s*,/g, ",").trim().replace(/,$/, "");
  return v || undefined;
}

function usd(v?: string): number | undefined {
  if (!v) return undefined;
  const n = Number(v.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function sqft(v?: string): number | undefined {
  if (!v) return undefined;
  // fixture-verified: the page writes "112,000 ft <sup>2</sup>" — cut at the unit
  // token so the superscript 2 can't ride into the digits ("112,000" not "1120002")
  const cleaned = v.replace(/(sq\.?\s*ft|square\s+feet|ft)[\s\S]*$/i, "");
  const n = Number(cleaned.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** "3/2/2026" | "12/27/2022" → "2026-03-02" | "2022-12-27". Unparseable → undefined. */
function isoDate(v?: string): string | undefined {
  if (!v) return undefined;
  const m = v.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return undefined;
  return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

function phone(v?: string): string | undefined {
  if (!v) return undefined;
  const d = digits(v);
  return d.length >= 10 ? v.trim() : undefined;   // keep as filed; norm is separate
}

function digits(v?: string): string {
  return (v || "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
}

function normAddr(v?: string): string | undefined {
  if (!v) return undefined;
  return v.toLowerCase()
    .replace(/\b(lane|ln\.?)\b/g, "ln").replace(/\b(street|st\.?)\b/g, "st")
    .replace(/\b(boulevard|blvd\.?)\b/g, "blvd").replace(/\b(parkway|pkwy\.?)\b/g, "pkwy")
    .replace(/\b(suite|ste\.?|#)\s*/g, "#")
    .replace(/[^a-z0-9#]+/g, " ").replace(/\s+/g, " ").trim();
}

function daysSince(isoDate: string): number {
  return (Date.now() - new Date(`${isoDate}T00:00:00Z`).getTime()) / 86400000;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
