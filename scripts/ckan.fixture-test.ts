// Offline unit tests for sources/ckan.ts — NO network. deps.fetch is a mock serving
// CKAN DataStore SQL responses shaped from the REAL 2026-07-15 pg_net receipts
// (docs/source-registry.md "MASSACHUSETTS WIRE PASS"): the Boston Approved Building
// Permits row shape (resource 6ddcd912-…) with native zip / y_latitude / x_longitude.
// These commit the "offline unit-tested incl. a bidirectional gate proof" claim in the
// MA status block as a durable, re-runnable suite.
// Run: npx -y esbuild scripts/ckan.fixture-test.ts --bundle --format=esm \
//        --outfile=/tmp/ckan-test.mjs && node /tmp/ckan-test.mjs
import { ckanForZip, type CkanRegistryEntry } from "../supabase/functions/get-address-report/sources/ckan.ts";

let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${detail ? " — " + detail : ""}`); }
}

const ENTRY: CkanRegistryEntry = {
  registry_id: "boston-approved-building-permits",
  platform: "ckan",
  base_url: "https://data.boston.gov",
  resource_id: "6ddcd912-32a0-43df-9908-63574f8c7e77",
  dataset_url: "https://data.boston.gov/dataset/approved-building-permits",
  jurisdiction: "City of Boston",
  coverage: [{ state: "MA", county: "Suffolk" }],
  column_map: {
    title: ["permittypedescr", "description"],
    status_raw: "status",
    type_source: "permittypedescr",
    file_date: "issued_date",
    address: "address",
    lat: "y_latitude",
    lng: "x_longitude",
    case_number: "permitnumber",
    zip: "zip",
  },
  type_map: { "Erect/New Construction": "Development", "Amendment to a Long Form": "Development" },
  status_to_bucket: { approved: ["Open", "Issued"], operating: ["Closed"], exclude: ["Stop Work"] },
  recency_days: 365,
  extra_where: "\"permittypedescr\" IN ('Erect/New Construction','Long Form/Alteration Permit','Amendment to a Long Form','Foundation Permit','Use of Premises')",
};

// Row shape from the real receipt (datastore_search on 6ddcd912, 2026-07-15).
function row(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    _id: 1, permitnumber: "A1000569", worktype: "INTEXT",
    permittypedescr: "Amendment to a Long Form", description: "Interior/Exterior Work",
    status: "Open", occupancytype: "1-2FAM", issued_date: "2026-06-28T16:29:26",
    address: "181-183 State ST", city: "Boston", state: "MA", zip: "02109",
    y_latitude: 42.35919, x_longitude: -71.05292, ...over,
  };
}

function ok(records: Record<string, unknown>[]) {
  return { success: true, result: { records } };
}

const SUFFOLK = [{ state: "MA", county: "Suffolk" }];
const MIDDLESEX = [{ state: "MA", county: "Middlesex" }];
const UTAH = [{ state: "Utah", county: "Box Elder" }];

async function main() {
  // 1) DataStore SQL construction: zip filter + verbatim extra_where + recency + _id paging
  console.log("1) DataStore SQL construction");
  {
    const urls: string[] = [];
    const fetchMock = (async (u: string) => {
      urls.push(u);
      return { ok: true, status: 200, json: async () => ok([row()]) };
    }) as unknown as typeof fetch;
    const { sites } = await ckanForZip("02109", SUFFOLK, [ENTRY], { fetch: fetchMock });
    const sql = decodeURIComponent(urls[0].split("sql=")[1]);
    check("one page fetched", urls.length === 1);
    check("zip filter present", sql.includes(`"zip" = '02109'`), sql);
    check("extra_where verbatim", sql.includes("permittypedescr\" IN ('Erect/New Construction'"), sql);
    check("recency clause on file_date col", /"issued_date" > '\d{4}-\d{2}-\d{2}'/.test(sql), sql);
    check("stable paging order", sql.includes(`ORDER BY "_id"`), sql);
    check("1 record emitted", sites.length === 1);
  }

  // 2) Coverage gate — bidirectional (the never-fetches half of the live-receipt proof)
  console.log("2) coverage gate");
  {
    let called = 0;
    const fetchMock = (async () => { called++; return { ok: true, status: 200, json: async () => ok([]) }; }) as unknown as typeof fetch;
    await ckanForZip("84302", UTAH, [ENTRY], { fetch: fetchMock });
    check("UT community → 0 fetches (gate holds)", called === 0);
    await ckanForZip("02138", MIDDLESEX, [ENTRY], { fetch: fetchMock });
    check("Middlesex community → Suffolk entry still 0 fetches (county gate)", called === 0);
    await ckanForZip("02109", SUFFOLK, [ENTRY], { fetch: fetchMock });
    check("Suffolk community → source runs", called === 1);
  }

  // 3) FAIL-CLOSED status buckets
  console.log("3) fail-closed status");
  {
    const rows = [
      row(),                                                        // Open → approved
      row({ _id: 2, permitnumber: "B1", status: "Closed" }),        // operating → built
      row({ _id: 3, permitnumber: "B2", status: "Stop Work" }),     // mapped exclude
      row({ _id: 4, permitnumber: "B3", status: "Under Review" }),  // UNMAPPED → excluded + flagged
      row({ _id: 5, permitnumber: "B4", status: "" }),              // blank → excluded + counted
    ];
    const fetchMock = (async () => ({ ok: true, status: 200, json: async () => ok(rows) })) as unknown as typeof fetch;
    const { sites, reports } = await ckanForZip("02109", SUFFOLK, [ENTRY], { fetch: fetchMock });
    check("only mapped non-exclude rows emitted", sites.length === 2);
    check("Open → bucket approved / type approved", sites[0].bucket === "approved" && sites[0].type === "approved");
    check("Closed → bucket operating / type built", sites[1].bucket === "operating" && sites[1].type === "built");
    check("Stop Work counted as intended exclude", reports[0].excluded_by_status.some((s) => s.status === "Stop Work" && s.count === 1));
    check("unmapped status FLAGGED, not published", reports[0].unmapped_statuses.some((s) => s.status === "Under Review" && s.count === 1));
    check("blank status counted", reports[0].blank_status === 1);
  }

  // 4) Normalization: point coords, dataset-precision record_url, type_map, composite title
  console.log("4) normalization");
  {
    const fetchMock = (async () => ({ ok: true, status: 200, json: async () => ok([row()]) })) as unknown as typeof fetch;
    const { sites } = await ckanForZip("02109", SUFFOLK, [ENTRY], { fetch: fetchMock });
    const s = sites[0];
    check("point from native coords", s.scope === "point" && s.geo_precision === "point" && s.lat === 42.35919 && s.lng === -71.05292);
    check("record_url = dataset landing page (founder-accepted dataset precision)", s.record_url === ENTRY.dataset_url && s.record_url_precision === "dataset");
    check("type_map applied (never from the title)", s.use_type === "Development");
    check("composite title joins mapped columns", s.title === "Amendment to a Long Form Interior/Exterior Work");
    check("case number carried", s.case_number === "A1000569");
    check("file_date ISO day", s.file_date === "2026-06-28");
    check("source id + rel rule stamped", s.source_class === "ckan" && s.rel_rule === "source:ckan:boston-approved-building-permits");
  }

  // 5) Absent coords + no geocode dep → jurisdiction scope (never a guessed point)
  console.log("5) never guess geography");
  {
    const fetchMock = (async () => ({ ok: true, status: 200, json: async () => ok([row({ y_latitude: null, x_longitude: null })]) })) as unknown as typeof fetch;
    const { sites } = await ckanForZip("02109", SUFFOLK, [ENTRY], { fetch: fetchMock });
    check("no coords + no geocoder → area scope, null lat/lng", sites[0].scope === "area" && sites[0].lat === null && sites[0].lng === null && sites[0].geo_precision === "jurisdiction");
  }

  // 6) {success:false} is a fetch ERROR (quarantined + visible), never "0 records"
  console.log("6) success:false fails loud");
  {
    const fetchMock = (async () => ({ ok: true, status: 200, json: async () => ({ success: false, error: { message: "invalid query" } }) })) as unknown as typeof fetch;
    const { sites, reports } = await ckanForZip("02109", SUFFOLK, [ENTRY], { fetch: fetchMock });
    check("0 sites emitted", sites.length === 0);
    check("fetch failure quarantined + visible", reports[0].quarantined.some((q) => q.reason.startsWith("fetch failed")));
  }

  // 7) Paging: a full page triggers the next offset; a short page stops
  console.log("7) paging");
  {
    const urls: string[] = [];
    const fetchMock = (async (u: string) => {
      urls.push(u);
      const offset = Number((decodeURIComponent(u).match(/OFFSET (\d+)/) ?? [])[1] ?? 0);
      const rows = offset === 0 ? Array.from({ length: 3 }, (_, i) => row({ _id: i, permitnumber: `P${i}` })) : [row({ _id: 99, permitnumber: "P99" })];
      return { ok: true, status: 200, json: async () => ok(rows) };
    }) as unknown as typeof fetch;
    const { sites } = await ckanForZip("02109", SUFFOLK, [ENTRY], { fetch: fetchMock, pageSize: 3 });
    check("second page fetched after a full page", urls.length === 2 && decodeURIComponent(urls[1]).includes("OFFSET 3"));
    check("all rows across pages emitted", sites.length === 4);
  }

  // 8) A resource with no zip column is skipped for ZIP mode, never pulled portal-wide
  console.log("8) no-zip-column skip");
  {
    let called = 0;
    const fetchMock = (async () => { called++; return { ok: true, status: 200, json: async () => ok([row()]) }; }) as unknown as typeof fetch;
    const noZip = { ...ENTRY, column_map: { ...ENTRY.column_map, zip: undefined } } as unknown as CkanRegistryEntry;
    const { sites, reports } = await ckanForZip("02109", SUFFOLK, [noZip], { fetch: fetchMock });
    check("0 fetches, 0 sites, quarantine note", called === 0 && sites.length === 0 && reports[0].quarantined.some((q) => q.reason.includes("no zip column")));
  }

  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  if (failures > 0) process.exit(1);
}

main();
