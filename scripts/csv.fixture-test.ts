// Offline unit tests for sources/csv.ts — NO network. deps.fetch is a mock serving a
// CSV body shaped from the REAL 2026-07-16 receipts (docs/source-registry.md
// "CALIFORNIA WIRE PASS"): the San Diego approvals_issued_2026_datasd.csv row shape
// (54-column ledger; GIS_LATITUDE/GIS_LONGITUDE, no ZIP column → spatial scoping;
// per-record OpenDSD approval URL verified real-vs-bogus). Commits the offline gate
// proof as a durable, re-runnable suite.
// Run: npx -y esbuild scripts/csv.fixture-test.ts --bundle --format=esm \
//        --outfile=/tmp/csv-test.mjs && node /tmp/csv-test.mjs
import { _clearCsvCache, csvForZip, parseCsv, type CsvRegistryEntry } from "../supabase/functions/get-address-report/sources/csv.ts";

let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${detail ? " — " + detail : ""}`); }
}

const ENTRY: CsvRegistryEntry = {
  registry_id: "san-diego-approved-permits",
  platform: "csv",
  url: "https://seshat.datasd.org/development_permits/approvals_issued_2026_datasd.csv",
  dataset_url: "https://data.sandiego.gov/datasets/development-permits-set1/",
  jurisdiction: "City of San Diego",
  coverage: [{ state: "CA", county: "San Diego" }],
  column_map: {
    title: ["APPROVAL_TYPE", "PROJECT_TITLE"],
    status_raw: "APPROVAL_STATUS",
    type_source: "APPROVAL_TYPE",
    file_date: "APPROVAL_ISSUE_DATE",
    address: "GIS_ADDRESS",
    lat: "GIS_LATITUDE",
    lng: "GIS_LONGITUDE",
    case_number: "APPROVAL_ID",
  },
  type_map: { "Building Permit": "Development", "Demolition Permit": "Development" },
  status_to_bucket: { approved: ["Issued"], operating: ["Completed"], exclude: ["Cancelled"] },
  include_types: ["Building Permit", "Demolition Permit"],
  spatial_zip_radius_mi: 3,
  record_url_template: "https://opendsd.sandiego.gov/web/approvals/{APPROVAL_ID}",
};

// CSV body shaped from the real 2026-07-16 Range receipt (quoted fields, embedded
// escaped quotes, one noise type, one far-away row, one coordinate-less row).
const HEADER = `"APPROVAL_ID","APPROVAL_TYPE","APPROVAL_STATUS","APPROVAL_ISSUE_DATE","PROJECT_TITLE","GIS_ADDRESS","GIS_LATITUDE","GIS_LONGITUDE"`;
function csvBody(rows: string[]): string { return [HEADER, ...rows].join("\n") + "\n"; }
const R_NEAR = `"2618042","Building Permit","Issued","2026-01-12","Const Chg ""C"" pump room","4949 EASTGATE ML",32.7185,-117.1593`;
const R_DEMO = `"2618043","Demolition Permit","Issued","2026-02-01","Teardown","123 MAIN ST",32.7200,-117.1600`;
const R_NOISE = `"2618044","Deferred Document Review","Issued","2026-03-01","Paperwork","1 PAPER ST",32.7185,-117.1593`;
const R_FAR = `"2618045","Building Permit","Issued","2026-01-20","Far away","9 REMOTE RD",33.5000,-117.9000`;
const R_NOCOORD = `"2618046","Building Permit","Issued","2026-01-25","No coords","5 LOST LN",,`;
const R_CANCEL = `"2618047","Building Permit","Cancelled","2026-01-30","Dead permit","7 GONE CT",32.7190,-117.1590`;
const R_ODD = `"2618048","Building Permit","Under Audit","2026-02-10","Odd status","9 ODD AVE",32.7191,-117.1591`;

const SD = [{ state: "CA", county: "San Diego" }];
const ORANGE = [{ state: "CA", county: "Orange" }];
const UT = [{ state: "Utah", county: "Box Elder" }];
const CENTROID = { lat: 32.7185, lng: -117.1593 };   // 92101

function mockFetch(body: string, opts: { fail?: boolean } = {}) {
  let calls = 0;
  const fn = (async (_url: RequestInfo | URL) => {
    calls++;
    if (opts.fail) return new Response("nope", { status: 503 });
    return new Response(body, { status: 200 });
  }) as typeof fetch;
  return { fn, calls: () => calls };
}

console.log("csv.ts offline fixture tests");

// 1. parseCsv handles RFC-4180 quoting (embedded escaped quotes + commas).
{
  const rows = parseCsv(`"a","b ""q"" c",3\r\n"x,y",z,`);
  check("parseCsv quotes/commas", rows.length === 2 && rows[0][1] === `b "q" c` && rows[1][0] === "x,y");
}

// 2. Happy path: spatial scoping keeps near rows, drops far + no-coord rows; noise type
//    dropped at parse; excluded status excluded; unmapped status surfaced not guessed.
{
  _clearCsvCache();
  const { fn } = mockFetch(csvBody([R_NEAR, R_DEMO, R_NOISE, R_FAR, R_NOCOORD, R_CANCEL, R_ODD]));
  const { sites, reports } = await csvForZip("92101", SD, [ENTRY], { fetch: fn, zipCentroid: CENTROID });
  const rpt = reports[0];
  check("emits the 2 near, kept-type, mapped rows", sites.length === 2, JSON.stringify(rpt));
  check("noise type dropped at parse (never in file_rows)", rpt.file_rows === 6);
  check("far row scoped out spatially", !sites.some((s) => s.case_number === "2618045"));
  check("no-coord row skipped + counted", rpt.skipped_no_coords === 1);
  check("Cancelled excluded", rpt.excluded_by_status.some((e) => e.status === "Cancelled"));
  check("unmapped status surfaced, not guessed", rpt.unmapped_statuses.some((u) => u.status === "Under Audit"));
  check("record-precision record_url template", sites[0].record_url === "https://opendsd.sandiego.gov/web/approvals/2618042");
  check("bucket approved → type approved", sites.every((s) => s.type === "approved"));
  check("rows keep their OWN point", sites[0].lat === 32.7185 && sites[0].geo_precision === "point");
}

// 3. Bidirectional coverage gate: wrong county and wrong state never fetch.
{
  _clearCsvCache();
  const near = mockFetch(csvBody([R_NEAR]));
  const a = await csvForZip("92801", ORANGE, [ENTRY], { fetch: near.fn, zipCentroid: CENTROID });
  const b = await csvForZip("84302", UT, [ENTRY], { fetch: near.fn, zipCentroid: CENTROID });
  check("Orange County ZIP: entry skipped, 0 fetches", a.sites.length === 0 && a.reports.length === 0 && near.calls() === 0);
  check("Utah ZIP: entry skipped, 0 fetches", b.sites.length === 0 && b.reports.length === 0 && near.calls() === 0);
}

// 4. Fail-closed: spatial entry without a centroid is quarantined (no rows).
{
  _clearCsvCache();
  const { fn } = mockFetch(csvBody([R_NEAR]));
  const { sites, reports } = await csvForZip("92101", SD, [ENTRY], { fetch: fn });
  check("no centroid → quarantined, 0 rows", sites.length === 0 && reports[0].quarantined.length === 1);
}

// 5. Fail-closed: no zip column AND no spatial option → skipped for ZIP reports.
{
  _clearCsvCache();
  const entry = { ...ENTRY, spatial_zip_radius_mi: undefined } as unknown as CsvRegistryEntry;
  const { fn } = mockFetch(csvBody([R_NEAR]));
  const { sites, reports } = await csvForZip("92101", SD, [entry], { fetch: fn, zipCentroid: CENTROID });
  check("no zip col + no spatial → quarantined", sites.length === 0 && reports[0].quarantined.length === 1);
}

// 6. Fetch failure quarantines the entry (never fabricates, never throws).
{
  _clearCsvCache();
  const { fn } = mockFetch("", { fail: true });
  const { sites, reports } = await csvForZip("92101", SD, [ENTRY], { fetch: fn, zipCentroid: CENTROID });
  check("fetch failure → quarantined, 0 rows", sites.length === 0 && reports[0].quarantined[0].reason.startsWith("fetch/parse failed"));
}

// 7. FETCH-ONCE memo: two ZIP runs in one isolate hit the network once.
{
  _clearCsvCache();
  const m = mockFetch(csvBody([R_NEAR, R_DEMO]));
  await csvForZip("92101", SD, [ENTRY], { fetch: m.fn, zipCentroid: CENTROID });
  await csvForZip("92102", SD, [ENTRY], { fetch: m.fn, zipCentroid: { lat: 32.7139, lng: -117.1219 } });
  check("file fetched once for two ZIPs", m.calls() === 1);
}

// 8. Recency window drops old rows at parse time.
{
  _clearCsvCache();
  const entry = { ...ENTRY, recency_days: 365 };
  const OLD = `"1111111","Building Permit","Issued","2020-01-01","Ancient","1 OLD RD",32.7185,-117.1593`;
  const { fn } = mockFetch(csvBody([R_NEAR, OLD]));
  const { sites, reports } = await csvForZip("92101", SD, [entry], { fetch: fn, zipCentroid: CENTROID });
  check("old row dropped by recency", reports[0].file_rows === 1 && sites.length === 1);
}

// 9. Empty template substitution never yields a truncated record URL (falls to dataset).
{
  _clearCsvCache();
  const NOID = `,"Building Permit","Issued","2026-01-12","No id","4949 EASTGATE ML",32.7185,-117.1593`;
  const { fn } = mockFetch(csvBody([NOID]));
  const { sites } = await csvForZip("92101", SD, [ENTRY], { fetch: fn, zipCentroid: CENTROID });
  check("blank id → dataset-precision fallback", sites.length === 1 && sites[0].record_url_precision === "dataset" && sites[0].record_url === ENTRY.dataset_url);
}

console.log(failures ? `\n${failures} FAILURE(S)` : "\nall csv.ts tests passed");
if (failures) (globalThis as { process?: { exit: (c: number) => void } }).process?.exit(1);
