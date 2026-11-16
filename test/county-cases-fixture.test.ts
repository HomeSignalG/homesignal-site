// Offline tests for sources/county-cases.ts — NO network. The index rows and request texts are the REAL
// Tillamook County land-use records read 2026-11-16 (docs/source-registry.md "TILLAMOOK COUNTY LAND-USE CASES");
// parcel centroids are the REAL values the county's Taxlots layer returned for 5S11130000202 and
// 5S1124AB01300/01301/01400. Remaining Sahhali lot centroids are synthetic and marked so.
import {
  _clearCountyCasesCache, _clearCountyCasesPacing, countyCasesForZip, parseCaseIndex, taxlotKeys, statedDate, statusHistory, pinFromParcels,
  type CountyCasesRegistryEntry,
} from "../supabase/functions/get-address-report/sources/county-cases.ts";
import registry from "../supabase/functions/get-address-report/jurisdiction-registry.json" with { type: "json" };

let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${detail ? " — " + detail : ""}`); }
}

const ENTRY = (registry as unknown as { county_cases: CountyCasesRegistryEntry[] }).county_cases[0];
const COMM = [{ state: "OR", county: "Tillamook" }];
const CAMP_REQ = "Request for Conditional Use approval of a recreational campground master plan consisting of 18 sites and amenities on a property zoned Rural Residential 2-Acre (RR-2) and Recreation Management (RM) located north and east of the Unincorporated Community of Neskowin. The subject property is accessed via Highway 101, and designated as Tax Lot 202 of Section 13, Township 5 South, Range 11 West of the Willamette Meridian, Tillamook County, Oregon.";
const SAH_REQ = "851-25-000549-PLNG : Request for subdivision plat approval for the subdivision identified as &quot;Sahhali South&quot; together with Conditional Use request #851-25-000548-PLNG on a property accessed off Highway 101 South, a state highway, through Sahhali Drive to Proposal Point Drive and Heron View Drive, private roads, and located in the Unincorporated Community of Neskowin. The subject property is zoned Neskowin Rural Residential zone (NeskRR) and affected lots are designated as Tax Lots 1300, 1301, 1400, 1500, 1600, 1700, 1800, 1900, 4600, 4700, 4800, 4801 and 5900 of Section 24AB, Township 5 South, Range 11 West of the Willamette Meridian, Tillamook County, Oregon.";
const row = (ids: string[], href: string, req: string, type: string, status: string) =>
  `<tr><td><a href="${href}">${ids.join(" ")}</a></td><td>APPLICANT NAME (never read)</td><td>${req}</td><td>${type}</td><td>${status}</td></tr>`;
const INDEX = `<table>` + [
  row(["851-26-000190-PLNG"], "https://www.tillamookcounty.gov/2612/851-26-000190-PLNG", CAMP_REQ, "Conditional Use", "Planning Commission Hearing"),
  row(["851-25-000549-PLNG", "851-25-000548-PLNG"], "/1139/851-25-000549-plng851-25-000548-plng", SAH_REQ, "Subdivision", "Planning Commission Hearing"),
  row(["851-26-000365-PLNG"], "/2700/851-26-000365-PLNG", "Request for a partition of one parcel into two parcels. Tax Lot 100 of Section 24, Township 5 South, Range 11 West.", "Partition", "Planning Commission Hearing"),
  row(["851-24-000293-PLNG"], "/2301/851-24-000293-PLNG", "Request for conditional use approval to amend the Planned Development Master Plan for Sahhali South. Tax Lots 4000 and 4100 of Section 24AB, Township 5 South, Range 11 West.", "Conditional Use", "Appeal Period"),
  row(["851-26-000500-PLNG"], "/2800/851-26-000500-PLNG", "Request to amend the Planned Development Master Plan for Sahhali South. Tax Lot 1300 of Section 24AB, Township 5 South, Range 11 West of the Willamette Meridian.", "Conditional Use", "Planning Commission Hearing"),
  row(["851-26-000501-PLNG"], "/2801/851-26-000501-PLNG", "Request for a campground of 20 sites. No tax lot is described here.", "Conditional Use", "Planning Commission Hearing"),
].join("") + `</table>`;
const CAMP_PAGE = `<h2>Date of Notice:</h2><p>Tuesday, October 13, 2026</p><p>Status Update</p><p>Planning Commission hearing scheduled for November 12, 2026 at 7:00p.m.</p><p>Files</p>`;
const SAH_PAGE = `<h2>Date of Notice:</h2><p>Tuesday, December 9, 2025</p><h2>Status Updates</h2><p>At the initial hearing on January 8, 2026 the Planning Commission voted and approved to continue this hearing to February 12, 2026 at 7 pm.</p><p>Files</p>`;

const REAL: Record<string, [number, number]> = { // key → [lat, lng], real Taxlots centroids
  "5S11130000202": [45.13752185179074, -123.97013017751362],
  "5S1124AB01300": [45.1295495136831, -123.97195279735315],
  "5S1124AB01301": [45.12949142187177, -123.97170657954996],
  "5S1124AB01400": [45.12909396113069, -123.97292206800651],
};
const SAH_LOTS = ["01300", "01301", "01400", "01500", "01600", "01700", "01800", "01900", "04600", "04700", "04800", "04801", "05900"].map((l) => `5S1124AB${l}`);
function parcelCentroids(keys: string[], synth: boolean): Record<string, [number, number]> {
  const out: Record<string, [number, number]> = {};
  for (const k of keys) {
    if (REAL[k]) out[k] = REAL[k];
    else if (synth && SAH_LOTS.includes(k)) out[k] = [45.1295 + (SAH_LOTS.indexOf(k) % 5) * 0.0002, -123.9722 + (SAH_LOTS.indexOf(k) % 3) * 0.0002]; // SYNTHETIC
  }
  return out;
}
function mockFetch(opts: { synth: boolean; log: string[] }): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const u = String(input);
    opts.log.push(u);
    if (u.includes("/1098/")) return new Response(INDEX, { status: 200 });
    if (u.includes("2612")) return new Response(CAMP_PAGE, { status: 200 });
    if (u.includes("1139")) return new Response(SAH_PAGE, { status: 200 });
    if (u.includes("/FeatureServer/0/query")) {
      const where = decodeURIComponent(new URL(u).searchParams.get("where") ?? "");
      const keys = [...where.matchAll(/'([^']+)'/g)].map((m) => m[1]);
      const c = parcelCentroids(keys, opts.synth);
      return new Response(JSON.stringify({ features: Object.entries(c).map(([k, [lat, lng]]) => ({ attributes: { MapTaxlot: k }, centroid: { x: lng, y: lat } })) }), { status: 200 });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
}
const run = async (o: { synth: boolean; members?: "member" | "outside" }) => {
  _clearCountyCasesCache(); _clearCountyCasesPacing();
  const log: string[] = [];
  const r = await countyCasesForZip("97149", COMM, [ENTRY], {
    fetch: mockFetch({ synth: o.synth, log }), sleep: async () => {},
    zipMembers: async (pts) => pts.map(() => o.members ?? "member"),
    today: new Date("2026-11-16T12:00:00Z"),
  });
  return { ...r, log };
};

console.log("parsing");
const rows = parseCaseIndex(INDEX, ENTRY.index_url);
check("index parsed: 6 rows, applicant cell never read", rows.length === 6 && !JSON.stringify(rows).includes("APPLICANT NAME"));
check("two-case row keeps both ids", rows[1].case_ids.length === 2 && rows[1].case_ids[1] === "851-25-000548-PLNG");
check("relative href resolved against the index", rows[1].url === "https://www.tillamookcounty.gov/1139/851-25-000549-plng851-25-000548-plng");
check("campground → one lot key", JSON.stringify(taxlotKeys(CAMP_REQ)) === JSON.stringify(["5S11130000202"]));
check("Sahhali → 13 lot keys incl. quarter AB", (taxlotKeys(SAH_REQ) ?? []).length === 13 && taxlotKeys(SAH_REQ)![0] === "5S1124AB01300" && taxlotKeys(SAH_REQ)!.includes("5S1124AB05900"));
check("no tax lot text → null (never guessed)", taxlotKeys("Request for a campground of 20 sites.") === null);
check("one-letter quarter section is refused", taxlotKeys("Tax Lot 100 of Section 24A, Township 5 South, Range 11 West") === null);
check("stated date parsed from the labelled field", statedDate(CAMP_PAGE, "Date of Notice") === "2026-10-13" && statedDate("<p>soon</p>", "Date of Notice") === null);
check("status history kept verbatim", (statusHistory(SAH_PAGE) ?? "").startsWith("At the initial hearing on January 8, 2026"));
check("partial parcel match is refused", "reason" in pinFromParcels(["a", "b", "c"], [{ key: "a", lat: 45.13, lng: -123.97 }], { min_found_share: 1, max_spread_m: 1500, bbox: ENTRY.bbox }));
check("spread beyond limit is refused", "reason" in pinFromParcels(["a", "b"], [{ key: "a", lat: 45.13, lng: -123.97 }, { key: "b", lat: 45.30, lng: -123.97 }], { min_found_share: 1, max_spread_m: 1500, bbox: ENTRY.bbox }));

console.log("campground + Sahhali, only 3 of 13 Sahhali lots resolvable (real data only)");
{
  const { sites, reports, log } = await run({ synth: false });
  const camp = sites.find((s) => s.case_number === "851-26-000190-PLNG");
  check("campground emitted as a proposed point", !!camp && camp.bucket === "proposed" && camp.scope === "point");
  check("campground pin is the real parcel centroid", !!camp && Math.abs(camp.lat! - 45.13752) < 1e-4 && Math.abs(camp.lng! + 123.97013) < 1e-4);
  check("status is the county's own words, not an approval", camp?.status_raw === "Planning Commission Hearing" && camp?.decided === false);
  check("date of notice kept; hearing history kept", camp?.file_date === "2026-10-13" && String((camp as any)?.status_history).includes("November 12, 2026"));
  check("pin labelled approximate parcel centroid", (camp as any)?.location_approx === true && (camp as any)?.location_basis === "parcel_centroid");
  check("record URL is the county case page", camp?.record_url === "https://www.tillamookcounty.gov/2612/851-26-000190-PLNG" && camp?.record_url_precision === "record");
  check("Sahhali NOT emitted on a partial parcel match", !sites.some((s) => s.case_number === "851-25-000549-PLNG"));
  const q = reports[0].quarantined.map((x) => x.reason);
  check("partial match is quarantined with its reason", q.includes("parcels_found_3_of_13"), q.join(","));
  check("partition dropped as routine, appeal-period excluded, no-lot case quarantined",
    !sites.some((s) => ["851-26-000365-PLNG", "851-24-000293-PLNG", "851-26-000501-PLNG"].includes(String(s.case_number))) && reports[0].excluded_by_status.some((x) => x.status === "Appeal Period") && q.includes("no_complete_tax_lot_description"));
  check("no request to any host other than the county site and its ArcGIS parcel service", log.every((u) => /tillamookcounty\.gov|services3\.arcgis\.com\/JnnlTIrcZLzs7d68/.test(u)));
}

console.log("Sahhali with the full footprint resolved");
{
  const { sites, reports } = await run({ synth: true });
  const sah = sites.find((s) => s.case_number === "851-25-000549-PLNG");
  check("Sahhali emitted once, both applications on one marker", !!sah && (sah as any).related_cases.includes("851-25-000548-PLNG") && sites.filter((s) => String(s.title).includes("Sahhali") || s.case_number === "851-25-000549-PLNG").length === 1);
  check("overlapping later case (same lot 1300) folded, not a second marker", !sites.some((s) => s.case_number === "851-26-000500-PLNG") && (sah as any).related_cases.includes("851-26-000500-PLNG") && reports[0].duplicates_folded === 1);
  check("all 13 named parcels matched", (sah as any)?.parcels_named === 13 && (sah as any)?.parcels_matched === 13);
  check("Sahhali is a Residential subdivision, county status kept, hearing history kept", sah?.use_type === "Residential" && sah?.status_raw === "Planning Commission Hearing" && String((sah as any).status_history).includes("continue this hearing to February 12, 2026"));
  check("two markers total (campground, Sahhali)", sites.length === 2);
}

console.log("ZIP boundary and gates");
{
  const { sites, reports } = await run({ synth: true, members: "outside" });
  check("a project outside the ZIP polygon is not emitted", sites.length === 0 && reports[0].not_in_zip === 2);
  _clearCountyCasesCache();
  const none = await countyCasesForZip("97149", [{ state: "OR", county: "Marion" }], [ENTRY], { fetch: mockFetch({ synth: true, log: [] }), sleep: async () => {} });
  check("coverage gate: another county never fetches", none.sites.length === 0 && none.reports.length === 0);
}

console.log("pacing");
{
  _clearCountyCasesCache(); _clearCountyCasesPacing();
  const waits: number[] = [];
  await countyCasesForZip("97149", COMM, [ENTRY], { fetch: mockFetch({ synth: true, log: [] }), sleep: async (ms) => { waits.push(ms); }, zipMembers: async (p) => p.map(() => "member"), today: new Date("2026-11-16T12:00:00Z") });
  check("requests to the county host are spaced by the robots crawl delay", waits.length >= 1 && waits.every((w) => w > 0 && w <= 10000), JSON.stringify(waits));
}

if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log("\nall county-cases checks passed");
