// Offline unit tests for the 2026-08-02 SILENT-CAP hardening — NO network.
//
// THE DEFECT: every connector defaults `max_rows` to 20000 and then does
// `while (out.length < maxRows) …` + `out.slice(0, maxRows)`. When the cap binds, the excess is
// dropped and NOTHING says so — a capped result and a complete one are indistinguishable apart
// from the count, so a truncated page reads as "we have everything". That is the same dangerous
// shape as the torn-body class: the failure looks like clean data.
//
// The fix must be EXACT in both directions, which is what this suite pins:
//   • capped fetch      ⇒ report.truncated_at_max_rows = the cap, plus a quarantine note;
//   • complete fetch    ⇒ null, even when the row count lands EXACTLY on the cap (a source with
//                         precisely max_rows matching records is complete, not truncated — a
//                         count-only check would cry wolf here, and a guard that cries wolf gets
//                         deleted).
// Both the paged connectors (ckan here, standing in for the identical arcgis/socrata/carto loop)
// and the emit-time cap in csv.ts are covered.
// Run: node scripts/run-unit-tests.mjs   (or: node test/max-rows-truncation.test.ts)
import { ckanForZip, type CkanRegistryEntry } from "../supabase/functions/get-address-report/sources/ckan.ts";

let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${detail ? " — " + detail : ""}`); }
}

const SUFFOLK = [{ state: "MA", county: "Suffolk" }];

const ENTRY: CkanRegistryEntry = {
  registry_id: "boston-approved-building-permits",
  platform: "ckan",
  base_url: "https://data.boston.gov",
  resource_id: "6ddcd912-32a0-43df-9908-63574f8c7e77",
  dataset_url: "https://data.boston.gov/dataset/approved-building-permits",
  jurisdiction: "City of Boston",
  coverage: [{ state: "MA", county: "Suffolk" }],
  column_map: {
    title: ["permittypedescr"], status_raw: "status", type_source: "permittypedescr",
    file_date: "issued_date", address: "address", lat: "y_latitude", lng: "x_longitude",
    case_number: "permitnumber", zip: "zip",
  },
  type_map: { "Amendment to a Long Form": "Development" },
  status_to_bucket: { approved: ["Open"], operating: [], exclude: [] },
};

const row = (i: number) => ({
  _id: i, permitnumber: `A${i}`, permittypedescr: "Amendment to a Long Form",
  status: "Open", issued_date: "2026-06-28T16:29:26", address: `${i} State ST`,
  city: "Boston", state: "MA", zip: "02109", y_latitude: 42.35919, x_longitude: -71.05292,
});

/** A DataStore that owns `total` matching rows and serves them in pages of `pageSize`. */
function server(total: number) {
  let pages = 0;
  const fetchMock = (async (u: string) => {
    pages++;
    const sql = decodeURIComponent(String(u).split("sql=")[1] ?? "");
    const limit = Number((sql.match(/LIMIT (\d+)/) || [])[1] ?? 0);
    const offset = Number((sql.match(/OFFSET (\d+)/) || [])[1] ?? 0);
    const n = Math.max(0, Math.min(limit, total - offset));
    const records = Array.from({ length: n }, (_, k) => row(offset + k + 1));
    return { ok: true, status: 200, json: async () => ({ success: true, result: { records } }) };
  }) as unknown as typeof fetch;
  return { fetchMock, pages: () => pages };
}

async function main() {
  // 1) THE CAP BINDS — the source has more than we take, and the report says so.
  console.log("1) capped fetch is reported, not silent");
  {
    const { fetchMock } = server(250);                    // 250 available, cap 100
    const { sites, reports } = await ckanForZip("02109", SUFFOLK, [{ ...ENTRY, max_rows: 100 }],
      { fetch: fetchMock, pageSize: 50 });
    check("exactly max_rows emitted", sites.length === 100, String(sites.length));
    check("truncated_at_max_rows carries the cap", reports[0].truncated_at_max_rows === 100,
      String(reports[0].truncated_at_max_rows));
    check("a quarantine note names the cap and says the source has MORE",
      reports[0].quarantined.some((q) => /max_rows cap of 100/.test(q.reason) && /MORE matching records/.test(q.reason)),
      JSON.stringify(reports[0].quarantined));
    check("the note names the registry entry, so it is actionable",
      reports[0].quarantined.some((q) => q.sample === "boston-approved-building-permits"));
  }

  // 2) THE CAP DOES NOT BIND — a complete fetch must stay clean.
  console.log("2) complete fetch is NOT flagged");
  {
    const { fetchMock } = server(70);                     // 70 available, cap 100
    const { sites, reports } = await ckanForZip("02109", SUFFOLK, [{ ...ENTRY, max_rows: 100 }],
      { fetch: fetchMock, pageSize: 50 });
    check("all 70 emitted", sites.length === 70, String(sites.length));
    check("truncated_at_max_rows stays null", reports[0].truncated_at_max_rows === null);
    check("no truncation note", !reports[0].quarantined.some((q) => /max_rows/.test(q.reason)));
  }

  // 3) THE EXACT-BOUNDARY CASE — the one a count-only check gets wrong. A source holding
  //    PRECISELY max_rows matching rows is complete; flagging it would be a false alarm.
  console.log("3) exactly max_rows available is complete, not truncated");
  {
    const { fetchMock } = server(100);                    // 100 available, cap 100
    const { sites, reports } = await ckanForZip("02109", SUFFOLK, [{ ...ENTRY, max_rows: 100 }],
      { fetch: fetchMock, pageSize: 50 });
    check("all 100 emitted", sites.length === 100, String(sites.length));
    check("truncated_at_max_rows stays null at the exact boundary",
      reports[0].truncated_at_max_rows === null, String(reports[0].truncated_at_max_rows));
    check("no truncation note at the exact boundary",
      !reports[0].quarantined.some((q) => /max_rows/.test(q.reason)));
  }

  // 4) The cap still bounds the FETCH — a capped run must not keep paging the publisher for rows
  //    it will discard. Exactness costs exactly ONE extra page (the probe past the cap that
  //    distinguishes case 1 from case 3), and that cost is bounded, not proportional to the source.
  console.log("4) the cap bounds the number of requests");
  {
    const s = server(10_000);
    await ckanForZip("02109", SUFFOLK, [{ ...ENTRY, max_rows: 100 }], { fetch: s.fetchMock, pageSize: 50 });
    check("stopped after 3 pages of 50 (2 kept + 1 probe), not 200 pages", s.pages() === 3, `pages=${s.pages()}`);
  }

  // 5) EVERY connector carries the field — the hardening is not one-connector-deep. Asserted
  //    against the SHIPPED sources so a new connector cannot inherit the silent shape.
  console.log("5) all five connectors report the cap");
  {
    const { readFileSync } = await import("node:fs");
    for (const f of ["arcgis", "socrata", "carto", "ckan", "csv"]) {
      const src = readFileSync(new URL(`../supabase/functions/get-address-report/sources/${f}.ts`, import.meta.url), "utf8");
      check(`${f}.ts declares truncated_at_max_rows on its run report`,
        /truncated_at_max_rows: number \| null;/.test(src));
      check(`${f}.ts initializes it to null`, /truncated_at_max_rows: null/.test(src));
      check(`${f}.ts sets it when the cap binds`, /report\.truncated_at_max_rows = /.test(src));
    }
  }

  console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll max_rows truncation checks passed.");
  process.exit(failures ? 1 : 0);
}

await main();
