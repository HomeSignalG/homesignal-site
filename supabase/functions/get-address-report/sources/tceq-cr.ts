// supabase/functions/get-address-report/sources/tceq-cr.ts
//
// TCEQ Central Registry source adapter — Texas state environmental records (the state analog
// of EPA ECHO). Enriches the facility points the engine already renders with the state
// programs a site is registered for (stormwater, petroleum storage tanks, hazardous waste,
// voluntary cleanup, …). Cached, not live: the engine geo-matches during data generation and
// stamps the interpreted facts onto s.env.tceq; the page just renders the cached fact.
//
// STEP-0 VERIFICATION (2026-07-11, via pg_net from the live pipeline — the sandbox is
// egress-blocked, so the DB is the reachability oracle):
//   • Reachable + FREE + no API key. TCEQ publishes the Central Registry on the Texas Open
//     Data Portal (Socrata) as five regional datasets. SoQL filter by
//     `re_phys_loc_addr_zip=<zip>` → HTTP 200 (78617 → 186 distinct RNs). Bulk-downloadable too.
//   • Fields (verified): ref_num_txt = the 11-char Regulated-Entity number (RN, e.g.
//     RN100215052); reg_ent_name; full physical address incl. re_phys_loc_addr_county / _zip
//     (both queryable); program_code (STORM, PSTREG, IHW, LPSTRMD, VCP, …); reg_ent_status_txt.
//   • NO lat/lng column. Per the build rule "geo-match uses parcels' EXISTING coordinates or the
//     free Census geocoder — NO paid services", we do NOT geocode here: this adapter is pure
//     enrichment that DEDUPES a TCEQ RN onto an FRS facility the engine already placed (matching
//     by house-number + street + ZIP), so the matched site reuses the FRS facility's own
//     coordinates. Standalone (unmatched) RN points are a logged, non-blocking follow-up.
//
// GOVERNANCE (docs/development-tracker-source-of-truth.md + docs/source-registry.md):
//   • COVERAGE GATE (mandatory): the source never runs for a non-Texas ZIP.
//   • ADDITIVE ONLY: this module never mutates FRS/ECHO behavior; it only attaches env.tceq.
//   • ABSENT STAYS ABSENT: a field the registry does not state is absent on the entity.
//   • QUARANTINE, DON'T STOP: a county with no mapped regional dataset yields [] + a note; the
//     refresh continues (facilities-only for that ZIP is valid).

// ───────────────────────────── types ─────────────────────────────

/** A regulated entity (RN) collapsed from its per-program rows. */
export interface TceqEntity {
  rn: string;                 // ref_num_txt — the 11-char RN (the state analog of the FRS id)
  name: string;               // reg_ent_name
  status?: string;            // reg_ent_status_txt (ACTIVE / INACTIVE / …)
  programs: string[];         // distinct program_code set for this RN, in the ZIP
  addr_line1?: string;        // re_phys_loc_addr_line_1 (for the house#+street+zip match key)
  city?: string;
  county?: string;            // re_phys_loc_addr_county
  zip?: string;               // re_phys_loc_addr_zip
  cn?: string;                // ref_num_txt_1 — the Customer Number (owner id), when stated
  /** house-number + first street word + ZIP — the deterministic dedup key (see siteKey). */
  key: string;
}

export interface TceqRefreshResult {
  entities: TceqEntity[];
  quarantined: { rn?: string; reason: string }[];
  dataset?: string;           // which regional dataset was queried (audit)
  raw_rows?: number;          // rows returned before grouping (audit)
}

export interface TceqCommunityRow {
  state?: string | null;
  county?: string | null;
}

export interface TceqDeps {
  fetch: typeof fetch;
  /** polite cap on rows pulled per ZIP (Socrata $limit). Default 2000. */
  rowLimit?: number;
}

// ───────────────────────────── constants ─────────────────────────────

const SOCRATA = "https://data.texas.gov/resource";

// TCEQ Central Registry regional datasets on the Texas Open Data Portal (verified 2026-07-11).
export const TCEQ_DATASETS = {
  central: "msah-s2rv",   // Central Texas   (Region 11 Austin — Travis, …)
  north: "5eqq-7nad",     // North Texas     (Regions 1,2,3,8)
  dfw: "t34q-qzi3",       // Dallas / Fort Worth
  coastal: "tzyg-j7q4",   // Coastal & East Texas (incl. Region 12 Houston)
  border: "9iad-hrn8",    // Border & Permian Basin
} as const;

// County (lower-case) → dataset. Verified counties only; widening = add one entry (pure data).
// An unmapped TX county returns [] + a quarantine note (facilities-only is valid) — never a guess.
export const TX_COUNTY_DATASET: Record<string, string> = {
  travis: TCEQ_DATASETS.central,
};

const RN_RE = /^RN\d{9,11}$/i;   // TCEQ RN format (e.g. RN100215052)

// ───────────────────────────── public API ─────────────────────────────

/**
 * ZIP-mode entry point — the ONLY function index.ts calls. Coverage-gated TX-only; picks the
 * regional dataset for the ZIP's county; queries the Central Registry by ZIP; collapses the
 * per-program rows into one entity per RN. Returns entities for the engine's dedup/enrich pass
 * (index.ts matches each entity onto an FRS facility by siteKey and stamps env.tceq).
 */
export async function tceqForZip(
  zip: string,
  communities: TceqCommunityRow[],
  deps: TceqDeps,
): Promise<TceqRefreshResult> {
  const isTx = communities.some((c) => /^(tx|texas)$/i.test((c.state || "").trim()));
  if (!isTx) return { entities: [], quarantined: [] };   // coverage gate — TX only

  const counties = Array.from(
    new Set(communities.map((c) => (c.county || "").trim().toLowerCase()).filter(Boolean)),
  );
  const dataset = counties.map((c) => TX_COUNTY_DATASET[c]).find(Boolean);
  if (!dataset) {
    return { entities: [], quarantined: [{ reason: `no TCEQ regional dataset mapped for county ${counties.join("/") || "?"} (facilities-only; add to TX_COUNTY_DATASET to widen)` }] };
  }

  const limit = deps.rowLimit ?? 2000;
  // SoQL: only the fields we render, filtered to the ZIP. Absent stays absent.
  const select = [
    "ref_num_txt", "reg_ent_name", "reg_ent_status_txt", "program_code",
    "re_phys_loc_addr_line_1", "re_phys_loc_city", "re_phys_loc_addr_county",
    "re_phys_loc_addr_zip", "ref_num_txt_1",
  ].join(",");
  const url = `${SOCRATA}/${dataset}.json?$select=${encodeURIComponent(select)}` +
    `&re_phys_loc_addr_zip=${encodeURIComponent(zip)}&$limit=${limit}`;

  let rows: Record<string, string>[];
  try {
    const r = await deps.fetch(url, { headers: { "User-Agent": "HomeSignal public-records refresh (contact: admin@homesignal.net)" } });
    if (!r.ok) return { entities: [], quarantined: [{ reason: `HTTP ${r.status} from TCEQ Socrata (${dataset})` }], dataset };
    rows = await r.json();
  } catch (e) {
    return { entities: [], quarantined: [{ reason: `fetch/parse exception: ${(e as Error).message}` }], dataset };
  }
  if (!Array.isArray(rows)) return { entities: [], quarantined: [{ reason: "TCEQ Socrata returned a non-array body" }], dataset };

  return { ...groupByRn(rows, zip), dataset, raw_rows: rows.length };
}

/** Collapse the per-program rows into one entity per RN (distinct program_code set). */
export function groupByRn(rows: Record<string, string>[], zip: string): { entities: TceqEntity[]; quarantined: { rn?: string; reason: string }[] } {
  const byRn: Record<string, TceqEntity> = {};
  const quarantined: { rn?: string; reason: string }[] = [];
  for (const row of rows) {
    const rn = String(row.ref_num_txt || "").trim().toUpperCase();
    if (!RN_RE.test(rn)) { quarantined.push({ rn, reason: "missing/invalid RN" }); continue; }
    const prog = String(row.program_code || "").trim().toUpperCase();
    let e = byRn[rn];
    if (!e) {
      const addr1 = clean(row.re_phys_loc_addr_line_1);
      e = byRn[rn] = {
        rn,
        name: clean(row.reg_ent_name) || rn,
        programs: [],
        key: siteKey(addr1, String(row.re_phys_loc_addr_zip || zip)),
      };
      if (row.reg_ent_status_txt) e.status = clean(row.reg_ent_status_txt);
      if (addr1) e.addr_line1 = addr1;
      if (row.re_phys_loc_city) e.city = clean(row.re_phys_loc_city);
      if (row.re_phys_loc_addr_county) e.county = clean(row.re_phys_loc_addr_county);
      if (row.re_phys_loc_addr_zip) e.zip = clean(row.re_phys_loc_addr_zip);
      if (row.ref_num_txt_1) e.cn = clean(row.ref_num_txt_1);
    }
    if (prog && e.programs.indexOf(prog) < 0) e.programs.push(prog);
  }
  return { entities: Object.values(byRn), quarantined };
}

// ───────────────────────────── match key ─────────────────────────────

// Street-word synonyms so an FRS "4836 HWY 71 EAST" and a TCEQ "4836 HIGHWAY 71 E" collapse to
// the SAME key. Deterministic, no geocoding — the whole point is to reuse the FRS facility's
// already-rendered coordinate rather than call any (paid or free) geocoder.
const STREET_SYNONYM: [RegExp, string][] = [
  [/\bHIGHWAY\b/g, "HWY"], [/\bEAST\b/g, "E"], [/\bWEST\b/g, "W"],
  [/\bNORTH\b/g, "N"], [/\bSOUTH\b/g, "S"], [/\bROAD\b/g, "RD"], [/\bSTREET\b/g, "ST"],
  [/\bLANE\b/g, "LN"], [/\bDRIVE\b/g, "DR"], [/\bAVENUE\b/g, "AVE"], [/\bBOULEVARD\b/g, "BLVD"],
  [/\bPARKWAY\b/g, "PKWY"], [/\bCOURT\b/g, "CT"], [/\bCIRCLE\b/g, "CIR"], [/\bPLACE\b/g, "PL"],
  [/\bTRAIL\b/g, "TRL"], [/\bFARM TO MARKET\b/g, "FM"], [/\bINTERSTATE\b/g, "IH"],
];

/**
 * Deterministic site key = leading house number + first street word (synonym-normalized) + ZIP.
 * Two records with the same house number and first street word in the same ZIP are the same
 * physical site (collisions within one ZIP are rare and, at worst, add a state badge to a
 * nearby regulated site — never a violation claim, which stays keyed on the FRS/ECHO id).
 * Returns "" when there is no house number (unkeyable → not matched, per absent-stays-absent).
 */
export function siteKey(line1?: string, zip?: string): string {
  const s = String(line1 || "").toUpperCase();
  const num = (s.match(/^\s*(\d+)/) || [])[1] || "";
  const z = String(zip || "").trim().slice(0, 5);
  if (!num || !/^\d{5}$/.test(z)) return "";
  let rest = s.replace(/^\s*\d+\s*/, "");
  for (const [re, to] of STREET_SYNONYM) rest = rest.replace(re, to);
  rest = rest.replace(/[^A-Z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  const firstWord = rest.split(" ")[0] || "";
  return `${num}|${firstWord}|${z}`;
}

function clean(v?: string): string { return String(v == null ? "" : v).replace(/\s+/g, " ").trim(); }
