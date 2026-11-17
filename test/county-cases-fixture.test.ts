// Offline tests for sources/county-cases.ts — NO network. The index rows and request texts are the REAL
// Tillamook County land-use records read 2026-11-16 (docs/source-registry.md "TILLAMOOK COUNTY LAND-USE CASES");
// parcel centroids are the REAL values the county's Taxlots layer returned for 5S11130000202 and
// 5S1124AB01300/01301/01400. Remaining Sahhali lot centroids are synthetic and marked so.
import {
  _clearCountyCasesCache, _clearCountyCasesPacing, countyCasesForZip, parseCaseIndex, taxlotKeys, parseTaxlots, requestFromPage, statedDate, statusHistory, pinFromParcels,
  type CountyCasesRegistryEntry,
} from "../supabase/functions/get-address-report/sources/county-cases.ts";
import registry from "../supabase/functions/get-address-report/jurisdiction-registry.json" with { type: "json" };

let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${detail ? " — " + detail : ""}`); }
}

const ENTRY = (registry as unknown as { county_cases: CountyCasesRegistryEntry[] }).county_cases[0];
const ENTRY_WIDE: CountyCasesRegistryEntry = { ...ENTRY, max_page_reads: 12 };
const COMM = [{ state: "OR", county: "Tillamook" }];
const CAMP_REQ = "Request for Conditional Use approval of a recreational campground master plan consisting of 18 sites and amenities on a property zoned Rural Residential 2-Acre (RR-2) and Recreation Management (RM) located north and east of the Unincorporated Community of Neskowin. The subject property is accessed via Highway 101, and designated as Tax Lot 202 of Section 13, Township 5 South, Range 11 West of the Willamette Meridian, Tillamook County, Oregon.";
const SAH_REQ = "851-25-000549-PLNG : Request for subdivision plat approval for the subdivision identified as &quot;Sahhali South&quot; together with Conditional Use request #851-25-000548-PLNG on a property accessed off Highway 101 South, a state highway, through Sahhali Drive to Proposal Point Drive and Heron View Drive, private roads, and located in the Unincorporated Community of Neskowin. The subject property is zoned Neskowin Rural Residential zone (NeskRR) and affected lots are designated as Tax Lots 1300, 1301, 1400, 1500, 1600, 1700, 1800, 1900, 4600, 4700, 4800, 4801 and 5900 of Section 24AB, Township 5 South, Range 11 West of the Willamette Meridian, Tillamook County, Oregon.";
const SAH_REQ_CUT = SAH_REQ.slice(0, SAH_REQ.indexOf("1400, 15") + "1400, 15".length); // the county's list view cuts the text here (live 2026-11-16)
const PD_REQ = "Conditional Use request to amend the Planned Development Master Plan for 'Sahhali Shores at Neskowin Unit III'. Located between Sahhali Drive and Tyee Court, both private roads, the subject property is located within the Neskowin Unincorporated Community, zoned Neskowin Rural Residential (NeskRR), and designated as Tax Lot 5700 of Section 13DC, Township 5 South, Range 11 West of the Willamette Meridian, Tillamook County, Oregon.";
const WARE_REQ = "Request for conditional use approval of a 120,000 square foot warehouse and distribution facility on a property designated as Tax Lot 700 of Section 13, Township 5 South, Range 11 West of the Willamette Meridian, Tillamook County, Oregon.";
const PD_SCALE_REQ = "Request to amend the Planned Development Master Plan to add 24 dwelling units. The subject property is designated as Tax Lot 5800 of Section 13DC, Township 5 South, Range 11 West of the Willamette Meridian, Tillamook County, Oregon.";
const DEAD_REQ = "Request for conditional use approval of a 6-site campground. The subject property is designated as Tax Lot 100 of Section 13DC, Township 5 South, Range 11 West of the Willamette Meridian, Tillamook County, Oregon.";
const GONE_REQ = "Request for conditional use approval of a 9-site campground. The subject property is designated as Tax Lot 1000 of Section 13DC, Township 5 South, Range 11 West of the Willamette Meridian, Tillamook County, Oregon.";
const OVERLAP_REQ = "Request for conditional use approval of a 4-site campground. Tax Lot 1300 of Section 24AB, Township 5 South, Range 11 West of the Willamette Meridian.";
const row = (ids: string[], href: string, req: string, type: string, status: string) =>
  `<tr><td><a href="${href}">${ids.join(" ")}</a></td><td>APPLICANT NAME (never read)</td><td>${req}</td><td>${type}</td><td>${status}</td></tr>`;
const INDEX = `<table>` + [
  row(["851-26-000190-PLNG"], "https://www.tillamookcounty.gov/2612/851-26-000190-PLNG", CAMP_REQ, "Conditional Use", "Planning Commission Hearing"),
  row(["851-25-000549-PLNG", "851-25-000548-PLNG"], "/1139/851-25-000549-plng851-25-000548-plng", SAH_REQ_CUT, "Subdivision", "Planning Commission Hearing"),
  row(["851-26-000365-PLNG"], "/2700/851-26-000365-PLNG", "Request for a partition of one parcel into two parcels. Tax Lot 100 of Section 24, Township 5 South, Range 11 West.", "Partition", "Planning Commission Hearing"),
  row(["851-24-000293-PLNG"], "/2301/851-24-000293-PLNG", "Request for conditional use approval to amend the Planned Development Master Plan for Sahhali South. Tax Lots 4000 and 4100 of Section 24AB, Township 5 South, Range 11 West.", "Conditional Use", "Appeal Period"),
  row(["851-26-000500-PLNG"], "/2800/851-26-000500-PLNG", OVERLAP_REQ, "Conditional Use", "Planning Commission Hearing"),
  row(["851-26-000501-PLNG"], "/2801/851-26-000501-PLNG", "Request for a campground of 20 sites. No parcel is described here.", "Conditional Use", "Planning Commission Hearing"),
  row(["851-23-000219-PLNG"], "/commdev/project/851-23-000219-plng", PD_REQ, "Conditional Use", "Planning Commission Hearing"),
  row(["851-26-000600-PLNG"], "/2900/851-26-000600-PLNG", WARE_REQ, "Conditional Use", "Planning Commission Hearing"),
  row(["851-26-000601-PLNG"], "/2901/851-26-000601-PLNG", PD_SCALE_REQ, "Conditional Use", "Planning Commission Hearing"),
  row(["851-26-000602-PLNG"], "/commdev/project/851-26-000602-plng", DEAD_REQ, "Conditional Use", "Planning Commission Hearing"),
  row(["851-26-000603-PLNG"], "/3000/851-26-000603-PLNG", GONE_REQ, "Conditional Use", "Planning Commission Hearing"),
].join("") + `</table>`;
const page = (id: string, req: string, notice: string, update: string) => `<h1>${id}</h1><p>Permit ID(s): ${id}</p><p>Request: ${req}</p><h2>Date of Notice:</h2><p>${notice}</p><h2>Status Updates</h2><p>${update}</p><p>Files</p>`;
const CAMP_PAGE = page("851-26-000190-PLNG", CAMP_REQ, "Tuesday, October 13, 2026", "Planning Commission hearing scheduled for November 12, 2026 at 7:00p.m.");
const SAH_PAGE = page("851-25-000549-PLNG 851-25-000548-PLNG", SAH_REQ.replace("851-25-000549-PLNG : ", "851-25-000549-PLNG: ").replace("&quot;", "&amp;quot;").replace("&quot;", "&amp;quot;"), "Tuesday, December 9, 2025", "At the initial hearing on January 8, 2026 the Planning Commission voted and approved to continue this hearing to February 12, 2026 at 7 pm.");
const CUSTOM404 = `<h1>Custom404</h1><p>We're sorry, but there is not a web page matching your entry. You entered: https://www.tillamookcounty.gov/3000/851-26-000603-plng</p>`;

const REAL: Record<string, [number, number]> = { // key → [lat, lng], real Taxlots centroids
  "5S11130000202": [45.13752185179074, -123.97013017751362],
  "5S1124AB01300": [45.1295495136831, -123.97195279735315],
  "5S1124AB01301": [45.12949142187177, -123.97170657954996],
  "5S1124AB01400": [45.12909396113069, -123.97292206800651],
  "5S1113DC05700": [45.130698821597704, -123.97256414205854],
};
// The REAL outline of the campground's parcel (county Taxlots layer, 2026-11-16, 5 decimals).
const CAMP_RING: number[][] = [[-123.96989,45.141],[-123.96951,45.14078],[-123.96924,45.13968],[-123.96844,45.13842],[-123.96776,45.13773],[-123.96738,45.13695],[-123.96743,45.13668],[-123.96735,45.13649],[-123.96729,45.13629],[-123.96723,45.1361],[-123.96718,45.13591],[-123.96697,45.1354],[-123.96694,45.13517],[-123.96692,45.13494],[-123.96691,45.13471],[-123.96692,45.13448],[-123.96693,45.13424],[-123.96695,45.13401],[-123.96698,45.13378],[-123.96845,45.13381],[-123.9709,45.13384],[-123.9709,45.13414],[-123.97089,45.1351],[-123.97089,45.13519],[-123.97088,45.13575],[-123.97087,45.13653],[-123.97086,45.13747],[-123.97363,45.13751],[-123.97373,45.14014],[-123.97137,45.14074],[-123.97021,45.14236],[-123.96989,45.141]];
const SYNTH_EXTRA: Record<string, [number, number]> = { // SYNTHETIC points for invented fixture cases
  "5S11130000700": [45.1311, -123.9702], "5S1113DC05800": [45.1305, -123.9731], "5S1113DC00100": [45.1301, -123.9711], "5S1113DC01000": [45.1304, -123.9715],
};
const SAH_LOTS = ["01300", "01301", "01400", "01500", "01600", "01700", "01800", "01900", "04600", "04700", "04800", "04801", "05900"].map((l) => `5S1124AB${l}`);
function parcelCentroids(keys: string[], synth: boolean): Record<string, [number, number]> {
  const out: Record<string, [number, number]> = {};
  for (const k of keys) {
    if (REAL[k]) out[k] = REAL[k];
    else if (SYNTH_EXTRA[k]) out[k] = SYNTH_EXTRA[k];
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
    if (u.includes("/2900/")) return new Response(page("851-26-000600-PLNG", WARE_REQ, "Monday, November 2, 2026", "Notice issued."), { status: 200 });
    if (u.includes("/2901/")) return new Response(page("851-26-000601-PLNG", PD_SCALE_REQ, "Monday, November 2, 2026", "Notice issued."), { status: 200 });
    if (u.includes("/2800/")) return new Response(page("851-26-000500-PLNG", OVERLAP_REQ, "Monday, November 2, 2026", "Notice issued."), { status: 200 });
    if (u.includes("/commdev/project/")) return new Response("not found", { status: 404 });
    if (u.includes("/3000/")) return new Response(CUSTOM404, { status: 200 });
    if (u.includes("/FeatureServer/0/query")) {
      const where = decodeURIComponent(new URL(u).searchParams.get("where") ?? "");
      const keys = [...where.matchAll(/'([^']+)'/g)].map((m) => m[1]);
      const c = parcelCentroids(keys, opts.synth);
      return new Response(JSON.stringify({ features: Object.entries(c).map(([k, [lat, lng]]) => ({ attributes: { MapTaxlot: k }, centroid: { x: lng, y: lat }, ...(k === "5S11130000202" ? { geometry: { rings: [CAMP_RING] } } : {}) })) }), { status: 200 });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
}
const run = async (o: { synth: boolean; members?: "member" | "outside"; entry?: CountyCasesRegistryEntry; fn?: (pts: ReadonlyArray<readonly [number, number]>) => Promise<("member" | "outside")[]> }) => {
  _clearCountyCasesCache(); _clearCountyCasesPacing();
  const log: string[] = [];
  const r = await countyCasesForZip("97149", COMM, [o.entry ?? ENTRY_WIDE], {
    fetch: mockFetch({ synth: o.synth, log }), sleep: async () => {},
    zipMembers: o.fn ?? (async (pts) => pts.map(() => o.members ?? "member")),
    today: new Date("2026-11-16T12:00:00Z"),
  });
  return { ...r, log };
};

console.log("parsing");
const rows = parseCaseIndex(INDEX, ENTRY.index_url);
check("index parsed: 11 rows, applicant cell never read", rows.length === 11 && !JSON.stringify(rows).includes("APPLICANT NAME"));
check("two-case row keeps both ids", rows[1].case_ids.length === 2 && rows[1].case_ids[1] === "851-25-000548-PLNG");
check("relative href resolved against the index", rows[1].url === "https://www.tillamookcounty.gov/1139/851-25-000549-plng851-25-000548-plng");
check("campground → one lot key", JSON.stringify(taxlotKeys(CAMP_REQ)) === JSON.stringify(["5S11130000202"]));
check("Sahhali (full text) → 13 lot keys incl. quarter AB", (taxlotKeys(SAH_REQ) ?? []).length === 13 && taxlotKeys(SAH_REQ)![0] === "5S1124AB01300" && taxlotKeys(SAH_REQ)!.includes("5S1124AB05900"));
check("range is padded to two digits like the county layer (R9W → 09)", JSON.stringify(taxlotKeys("designated as Tax Lot 405 in Section 26 of Township 1 South, Range 9 West of the Willamette Meridian")) === JSON.stringify(["1S09260000405"]));
check("'in Section X of Township' wording and a two-letter quarter parse", JSON.stringify(taxlotKeys("designated as Tax Lot 5600 in Section 30BA of Township 4 South Range 10 West")) === JSON.stringify(["4S1030BA05600"]));
check("no tax lot text → reason, never guessed", JSON.stringify(parseTaxlots("Request for a campground of 20 sites.")) === JSON.stringify({ reason: "no_tax_lot_named" }));
check("a lot list the county's index cuts off is reported as truncated", JSON.stringify(parseTaxlots(SAH_REQ_CUT)) === JSON.stringify({ reason: "tax_lot_text_truncated" }));
check("a complete sentence in unrecognized wording is its own reason", JSON.stringify(parseTaxlots("The parcel is Tax Lot 1600 near the river. Nothing else is stated.")) === JSON.stringify({ reason: "tax_lot_wording_unrecognized" }));
check("one-letter quarter section is refused", JSON.stringify(parseTaxlots("Tax Lot 100 of Section 24A, Township 5 South, Range 11 West")) === JSON.stringify({ reason: "quarter_section_ambiguous" }));
check("the page copy is found by the request's own words; a different description is refused", (requestFromPage(SAH_PAGE, SAH_REQ_CUT) ?? "").includes("5900 of Section 24AB") && requestFromPage(CAMP_PAGE, SAH_REQ_CUT) === null);
check("stated date parsed from the labelled field", statedDate(CAMP_PAGE, "Date of Notice") === "2026-10-13" && statedDate("<p>soon</p>", "Date of Notice") === null);
check("status history kept verbatim", (statusHistory(SAH_PAGE) ?? "").startsWith("At the initial hearing on January 8, 2026"));
check("partial parcel match is refused", "reason" in pinFromParcels(["a", "b", "c"], [{ key: "a", lat: 45.13, lng: -123.97 }], { min_found_share: 1, max_spread_m: 1500, bbox: ENTRY.bbox }));
check("spread beyond limit is refused", "reason" in pinFromParcels(["a", "b"], [{ key: "a", lat: 45.13, lng: -123.97 }, { key: "b", lat: 45.30, lng: -123.97 }], { min_found_share: 1, max_spread_m: 1500, bbox: ENTRY.bbox }));

console.log("only 3 of 13 Sahhali lots resolvable (real data only): still refused, never a partial footprint");
{
  const { sites, reports } = await run({ synth: false });
  check("Sahhali NOT emitted on a partial parcel match", !sites.some((s) => s.case_number === "851-25-000549-PLNG"));
  const q = reports[0].quarantined.map((x) => x.reason);
  check("partial match is quarantined with its reason", q.includes("parcels_found_3_of_13"), q.join(","));
}

console.log("everything resolvable: who is emitted and why");
{
  const { sites, reports, log } = await run({ synth: true });
  const R = reports[0];
  const ids = sites.map((s) => String(s.case_number)).sort();
  const camp = sites.find((s) => s.case_number === "851-26-000190-PLNG");
  check("campground emitted as a proposed point on its real parcel centroid", !!camp && camp.bucket === "proposed" && camp.scope === "point" && Math.abs(camp.lat! - 45.13752) < 1e-4 && Math.abs(camp.lng! + 123.97013) < 1e-4);
  check("status is the county's own words, not an approval", camp?.status_raw === "Planning Commission Hearing" && camp?.decided === false);
  check("date of notice kept; hearing history kept", camp?.file_date === "2026-10-13" && String((camp as any)?.status_history).includes("November 12, 2026"));
  check("pin labelled approximate parcel centroid", (camp as any)?.location_approx === true && (camp as any)?.location_basis === "parcel_centroid");
  check("record URL is the county case page", camp?.record_url === "https://www.tillamookcounty.gov/2612/851-26-000190-PLNG" && camp?.record_url_precision === "record");
  const sah = sites.find((s) => s.case_number === "851-25-000549-PLNG");
  check("Sahhali, cut off in the county's list, is read from its case page and emitted once with both applications", !!sah && (sah as any).related_cases.includes("851-25-000548-PLNG") && sites.filter((s) => s.case_number === "851-25-000549-PLNG").length === 1);
  check("all 13 named parcels matched", (sah as any)?.parcels_named === 13 && (sah as any)?.parcels_matched === 13);
  check("Sahhali is a Residential subdivision, county status kept, hearing history kept", sah?.use_type === "Residential" && sah?.status_raw === "Planning Commission Hearing" && String((sah as any).status_history).includes("continue this hearing to February 12, 2026"));
  check("overlapping later case (same lot 1300) folded, not a second marker", !ids.includes("851-26-000500-PLNG") && (sah as any).related_cases.includes("851-26-000500-PLNG") && R.duplicates_folded === 1);
  check("a single-lot amendment of an existing plan that states no scale is routine, and is listed", !ids.includes("851-23-000219-PLNG") && (R.routine_single_lot ?? []).includes("851-23-000219-PLNG"));
  check("a large project on ONE lot is NOT excluded for being one lot", ids.includes("851-26-000600-PLNG") && (sites.find((s) => s.case_number === "851-26-000600-PLNG") as any).parcels_named === 1);
  check("a single-lot amendment that states a scale (24 dwelling units) is NOT routine", ids.includes("851-26-000601-PLNG"));
  check("a dead county link (HTTP 404) is quarantined, never published", !ids.includes("851-26-000602-PLNG") && R.quarantined.some((x) => x.reason === "record_page_gone" && x.sample === "851-26-000602-PLNG"));
  check("a 'page not found' screen served with HTTP 200 is quarantined too", !ids.includes("851-26-000603-PLNG") && R.quarantined.some((x) => x.reason === "record_page_gone" && x.sample === "851-26-000603-PLNG"));
  check("exactly the verified projects are emitted", JSON.stringify(ids) === JSON.stringify(["851-25-000549-PLNG", "851-26-000190-PLNG", "851-26-000600-PLNG", "851-26-000601-PLNG"]), ids.join(","));
  const q = R.quarantined.map((x) => x.reason);
  check("partition dropped as routine, appeal-period excluded, no-lot case quarantined with its own reason",
    !ids.includes("851-26-000365-PLNG") && !ids.includes("851-24-000293-PLNG") && R.excluded_by_status.some((x) => x.status === "Appeal Period") && q.includes("no_tax_lot_named"));
  check("no request to any host other than the county site and its ArcGIS parcel service", log.every((u) => /tillamookcounty\.gov|services3\.arcgis\.com\/JnnlTIrcZLzs7d68/.test(u)));
}

console.log("a parcel that straddles the ZIP line: centroid in the neighbouring ZIP, parcel reaches this one");
{
  // SYNTHETIC ZIP boundary for the test only: the half-plane south of lat 45.1370 is "this ZIP". The campground's parcel
  // (real outline) spans lat 45.1338–45.1424, so its centroid (45.13752) is outside and part of the parcel is inside.
  const southOnly = async (pts: ReadonlyArray<readonly [number, number]>) => pts.map(([lat]) => (lat < 45.1370 ? "member" : "outside") as "member" | "outside");
  const { sites, reports } = await run({ synth: true, fn: southOnly });
  const camp = sites.find((s) => s.case_number === "851-26-000190-PLNG") as any;
  check("campground IS published for this ZIP because its parcel intersects it", !!camp);
  check("its pin is a point inside this ZIP, not the out-of-ZIP centroid", !!camp && camp.lat < 45.1370 && camp.lat > 45.1338, String(camp?.lat));
  check("the pin lies ON the parcel (inside its own outline)", !!camp && (() => { let inside = false; for (let i = 0, j = CAMP_RING.length - 1; i < CAMP_RING.length; j = i++) { const [xi, yi] = CAMP_RING[i], [xj, yj] = CAMP_RING[j]; if ((yi > camp.lat) !== (yj > camp.lat) && camp.lng < ((xj - xi) * (camp.lat - yi)) / (yj - yi) + xi) inside = !inside; } return inside; })());
  check("the pin says how it was placed", camp?.location_basis === "parcel_portion_in_zip" && camp?.location_approx === true && String(camp?.zip_overlap).startsWith("parcel_reaches_this_zip"));
  check("the report names the case placed by overlap", (reports[0].pinned_by_parcel_overlap ?? []).includes("851-26-000190-PLNG"));
  const north = async (pts: ReadonlyArray<readonly [number, number]>) => pts.map(([lat]) => (lat > 45.1500 ? "member" : "outside") as "member" | "outside");
  const none = await run({ synth: true, fn: north });
  check("a parcel with NO part in the ZIP is still not published", none.sites.length === 0);
}

console.log("page budget and index/page disagreement");
{
  const { sites, reports } = await run({ synth: true, entry: { ...ENTRY, max_page_reads: 1 } });
  check("with a one-page budget only a case whose page was actually read is published; the rest are quarantined unverified", sites.every((s) => s.case_number === "851-25-000549-PLNG") && reports[0].quarantined.some((x) => x.reason === "record_page_unverified_budget"), JSON.stringify(reports[0].quarantined));
}

console.log("ZIP boundary and gates");
{
  const { sites, reports } = await run({ synth: true, members: "outside" });
  check("a project outside the ZIP polygon is not emitted (the campground's real centroid is in ZCTA 97112)", sites.length === 0 && reports[0].not_in_zip === 6);
  _clearCountyCasesCache();
  const none = await countyCasesForZip("97149", [{ state: "OR", county: "Marion" }], [ENTRY], { fetch: mockFetch({ synth: true, log: [] }), sleep: async () => {} });
  check("coverage gate: another county never fetches", none.sites.length === 0 && none.reports.length === 0);
}

console.log("pacing");
{
  _clearCountyCasesCache(); _clearCountyCasesPacing();
  const waits: number[] = [];
  await countyCasesForZip("97149", COMM, [ENTRY_WIDE], { fetch: mockFetch({ synth: true, log: [] }), sleep: async (ms) => { waits.push(ms); }, zipMembers: async (p) => p.map(() => "member"), today: new Date("2026-11-16T12:00:00Z") });
  check("requests to the county host are spaced by the robots crawl delay", waits.length >= 1 && waits.every((w) => w > 0 && w <= 10000), JSON.stringify(waits));
}

if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log("\nall county-cases checks passed");
