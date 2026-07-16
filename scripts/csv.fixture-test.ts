// Offline unit tests for sources/csv.ts — NO network. deps.fetch is a mock serving a
// CSV shaped from the REAL 2026-07-16 recon-fetch receipts (docs/source-registry.md
// "CA / AZ / MD RECON PASS"): San Diego's approvals_issued_2026_datasd.csv header +
// row shapes (APPROVAL_STATUS "Issued", GIS_LATITUDE/GIS_LONGITUDE per record).
// Covers: coverage gate (bidirectional — the CSV is NEVER fetched for an out-of-scope
// ZIP), latlng-radius scoping by the row's OWN coords, native-zip scoping, fail-closed
// status handling (unmapped + blank), RFC-4180 quoting (embedded commas/quotes/newlines),
// dataset-precision record_url fallback, the module-level fetch memo, and the
// no-centroid / oversized-file quarantines.
// Run: npx -y esbuild scripts/csv.fixture-test.ts --bundle --format=esm \
//        --outfile=/tmp/csv-test.mjs && node /tmp/csv-test.mjs
import { csvForZip, parseCsv, type CsvRegistryEntry } from "../supabase/functions/get-address-report/sources/csv.ts";

let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${detail ? " — " + detail : ""}`); }
}

// CSV fixture — header trimmed from the real file; 5 rows exercising every path.
// Row 1: Issued, near-centroid coords, quoted scope w/ comma + escaped quotes + newline.
// Row 2: Issued but ~200 mi away (out of radius).
// Row 3: unmapped status ("Plan Review") — must be surfaced, never guessed.
// Row 4: excluded status ("Withdrawn").
// Row 5: Issued but no coords (out of scope for latlng-radius; in scope for native-zip via ZIP col test entry).
const CSV = [
  `"PROJECT_ID","PROJECT_TITLE","APPROVAL_TYPE","APPROVAL_STATUS","APPROVAL_ISSUE_DATE","APPROVAL_SCOPE","GIS_ADDRESS","GIS_LATITUDE","GIS_LONGITUDE","ZIP"`,
  `"708918","CC5 to PTS: 0610877","Construction Change - Building","Issued","2026-06-18","Arch., Struct., Elect., \nupdates, ""Delta 24""","1338 G ST ","32.712875","-117.152163","92101"`,
  `"708919","Far away job","New Building","Issued","2026-06-20","far","1 Far St","34.05","-118.24","90012"`,
  `"708920","Pending job","New Building","Plan Review","2026-06-21","pending","2 Main St","32.713","-117.153","92101"`,
  `"708921","Dead job","New Building","Withdrawn","2026-06-22","dead","3 Main St","32.714","-117.151","92101"`,
  `"708922","No coords job","New Building","Issued","2026-06-23","nocoords","4 Main St","","","92101"`,
].join("\r\n");

const BASE: Omit<CsvRegistryEntry, "scope"> = {
  registry_id: "san-diego-approvals-issued",
  platform: "csv",
  csv_url: "https://seshat.datasd.org/development_permits/approvals_issued_2026_datasd.csv",
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
    case_number: "PROJECT_ID",
    zip: "ZIP",
  },
  type_map: { "New Building": "Development" },
  status_to_bucket: { approved: ["Issued"], exclude: ["Withdrawn", "Expired"] },
  record_url_precision: "dataset",
};

const SD = { lat: 32.7157, lng: -117.1611 };  // San Diego centroid
let fetchCount = 0;
const deps = {
  fetch: ((url: string) => {
    fetchCount++;
    return Promise.resolve(new Response(CSV, { status: 200 }));
  }) as unknown as typeof fetch,
  home: SD,
  noCache: false,
};

const CA_COMMUNITIES = [{ state: "CA", county: "San Diego" }];
const MI_COMMUNITIES = [{ state: "MI", county: "Wayne" }];

console.log("csv.ts offline fixture tests");

// 0) parser: quoted comma + escaped quotes + embedded newline survive
{
  const rows = parseCsv(CSV);
  check("parseCsv: 5 data rows", rows.length === 5, String(rows.length));
  check("parseCsv: embedded newline + escaped quotes preserved",
    rows[0]["APPROVAL_SCOPE"].includes('"Delta 24"') && rows[0]["APPROVAL_SCOPE"].includes("\n"));
  check("parseCsv: header trimmed keys", "PROJECT_ID" in rows[0]);
}

// 1) latlng-radius mode: in-radius Issued emitted; far row dropped; unmapped surfaced; excluded counted; no-coords dropped
{
  const entry: CsvRegistryEntry = { ...BASE, scope: { mode: "latlng-radius", radius_mi: 3 } };
  const { sites, reports } = await csvForZip("92101", CA_COMMUNITIES, [entry], { ...deps, noCache: true });
  const r = reports[0];
  check("radius: emits exactly the near Issued rows", sites.length === 1 && sites[0].case_number === "708918", JSON.stringify(sites.map(s => s.case_number)));
  check("radius: far row out of scope", !sites.some(s => s.case_number === "708919"));
  check("radius: unmapped status surfaced (Plan Review)", r.unmapped_statuses.some(u => u.status === "Plan Review"));
  check("radius: excluded status counted (Withdrawn)", r.excluded_by_status.some(x => x.status === "Withdrawn"));
  check("radius: coordless row never guessed in", !sites.some(s => s.case_number === "708922"));
  check("radius: record_url falls back to dataset landing (precision dataset)",
    sites[0].record_url === BASE.dataset_url && sites[0].record_url_precision === "dataset");
  check("radius: bucket/type from status map", sites[0].bucket === "approved" && sites[0].type === "approved");
  check("radius: point precision from own coords", sites[0].geo_precision === "point" && sites[0].scope === "point");
  check("radius: file_date parsed", sites[0].file_date === "2026-06-18");
}

// 2) native-zip mode: ZIP column drives scope (coordless row included, far-ZIP row not)
{
  const entry: CsvRegistryEntry = { ...BASE, scope: { mode: "native-zip" } };
  const { sites } = await csvForZip("92101", CA_COMMUNITIES, [entry], { ...deps, noCache: true });
  const ids = sites.map(s => s.case_number).sort();
  check("native-zip: 92101 Issued rows incl. coordless", ids.join(",") === "708918,708922", ids.join(","));
  const noCoords = sites.find(s => s.case_number === "708922")!;
  check("native-zip: coordless row is area-scope (no geocoder in deps)", noCoords.scope === "area" && noCoords.lat === null);
}

// 3) bidirectional coverage gate: out-of-scope communities → CSV NEVER fetched
{
  const entry: CsvRegistryEntry = { ...BASE, scope: { mode: "latlng-radius", radius_mi: 3 } };
  const before = fetchCount;
  const { sites, reports } = await csvForZip("48226", MI_COMMUNITIES, [entry], { ...deps, noCache: true });
  check("gate: 0 sites and 0 reports for MI ZIP", sites.length === 0 && reports.length === 0);
  check("gate: fetch NEVER called", fetchCount === before, `fetchCount ${before} -> ${fetchCount}`);
}

// 4) module-level memo: second call within TTL serves from cache
{
  const entry: CsvRegistryEntry = { ...BASE, scope: { mode: "latlng-radius", radius_mi: 3 } };
  const before = fetchCount;
  const a = await csvForZip("92101", CA_COMMUNITIES, [entry], deps);
  const b = await csvForZip("92101", CA_COMMUNITIES, [entry], deps);
  check("memo: one fetch for two reports", fetchCount === before + 1, `fetches ${fetchCount - before}`);
  check("memo: second report flagged cache_hit", b.reports[0].cache_hit === true && a.reports[0].cache_hit === false);
}

// 5) fail-closed prerequisites: latlng-radius without a centroid → quarantined, nothing emitted
{
  const entry: CsvRegistryEntry = { ...BASE, scope: { mode: "latlng-radius", radius_mi: 3 } };
  const { sites, reports } = await csvForZip("92101", CA_COMMUNITIES, [entry], { fetch: deps.fetch, noCache: true });
  check("no-centroid: quarantined, 0 emitted", sites.length === 0 && reports[0].quarantined.length === 1);
}

// 6) oversized file → quarantined fetch failure (never a partial parse)
{
  const entry: CsvRegistryEntry = { ...BASE, scope: { mode: "latlng-radius", radius_mi: 3 }, max_file_mb: 0.00001 };
  const { sites, reports } = await csvForZip("92101", CA_COMMUNITIES, [entry], { ...deps, noCache: true });
  check("oversize: quarantined, 0 emitted", sites.length === 0 && reports[0].quarantined[0].reason.startsWith("fetch failed"));
}

// 7) recency window drops old rows (post-parse)
{
  const entry: CsvRegistryEntry = { ...BASE, scope: { mode: "latlng-radius", radius_mi: 3 }, recency_days: 5 };
  const { sites } = await csvForZip("92101", CA_COMMUNITIES, [entry], { ...deps, noCache: true });
  check("recency: 2026-06-18 row dropped under a 5-day window", sites.length === 0, JSON.stringify(sites.map(s => s.case_number)));
}

console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL PASS");
if (failures) (globalThis as { process?: { exitCode?: number } }).process!.exitCode = 1;
