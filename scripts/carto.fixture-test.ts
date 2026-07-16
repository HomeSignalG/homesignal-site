// Offline unit tests for sources/carto.ts — NO network. deps.fetch is a mock serving
// Carto SQL-API responses shaped from the REAL 2026-07-16 phl.carto.com receipts
// (docs/source-registry.md "PENNSYLVANIA WIRE PASS"): the permits-table row shape with
// ZIP+4 zip, verbatim statuses, and ST_Y/ST_X geometry extraction. Commits the offline
// gate proof as a durable, re-runnable suite.
// Run: npx -y esbuild scripts/carto.fixture-test.ts --bundle --format=esm \
//        --outfile=/tmp/carto-test.mjs && node /tmp/carto-test.mjs
import { buildWhere, cartoForZip, type CartoRegistryEntry } from "../supabase/functions/get-address-report/sources/carto.ts";

let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${detail ? " — " + detail : ""}`); }
}

const ENTRY: CartoRegistryEntry = {
  registry_id: "philadelphia-li-permits",
  platform: "carto",
  sql_url: "https://phl.carto.com/api/v2/sql",
  table: "permits",
  dataset_url: "https://phl.carto.com/api/v2/sql?q=SELECT%20*%20FROM%20permits%20LIMIT%2010",
  jurisdiction: "City of Philadelphia",
  coverage: [{ state: "PA", county: "Philadelphia" }],
  column_map: {
    title: ["typeofwork", "permitdescription"],
    status_raw: "status",
    type_source: "typeofwork",
    file_date: "permitissuedate",
    address: "address",
    zip: "zip",
    case_number: "permitnumber",
  },
  geom_col: "the_geom",
  type_map: { "New Construction": "Development", "Full Demolition": "Development" },
  status_to_bucket: { approved: ["Issued"], operating: ["Completed"], exclude: ["Expired", "Cancelled"] },
  extra_where: "permittype IN ('Building','Residential Building','Demolition','Zoning')",
  recency_days: 365,
};

function row(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    permitnumber: "ZP-2026-004918", zip: "19143-3005", status: "Issued",
    permittype: "Building", typeofwork: "New Construction",
    permitdescription: "NEW 3-STORY STRUCTURE", address: "917 S 59TH ST",
    permitissuedate: "2026-07-10T16:48:23Z",
    __lat: 39.94716686085295, __lng: -75.24156041008963, ...over,
  };
}
function ok(rows: Record<string, unknown>[]) { return { rows }; }

const PHILA = [{ state: "PA", county: "Philadelphia" }];
const ALLEGHENY = [{ state: "PA", county: "Allegheny" }];
const UT = [{ state: "Utah", county: "Box Elder" }];

function mockFetch(rows: Record<string, unknown>[], opts: { error?: boolean } = {}) {
  let calls: string[] = [];
  const fn = (async (url: RequestInfo | URL) => {
    calls.push(String(url));
    if (opts.error) return new Response(JSON.stringify({ error: ["relation \"permits\" does not exist"] }), { status: 200 });
    return new Response(JSON.stringify(ok(rows)), { status: 200 });
  }) as typeof fetch;
  return { fn, calls: () => calls };
}

console.log("carto.ts offline fixture tests");

// 1. WHERE: ZIP+4 prefix LIKE + extra_where + recency interval, PostgreSQL dialect.
{
  const w = buildWhere(ENTRY, "19143", "zip");
  check("ZIP prefix LIKE (ZIP+4 handling)", w.startsWith("zip LIKE '19143%'"), w);
  check("extra_where AND'd", w.includes("permittype IN ("));
  check("recency interval clause", w.includes("permitissuedate > now() - interval '365 days'"));
}

// 2. Happy path: verbatim status mapping, PostGIS point, ZIP truncated to 5 digits.
{
  const m = mockFetch([row(), row({ permitnumber: "X2", status: "Completed" }), row({ permitnumber: "X3", status: "Expired" }), row({ permitnumber: "X4", status: "Under Audit" })]);
  const { sites, reports } = await cartoForZip("19143", PHILA, [ENTRY], { fetch: m.fn });
  check("emits mapped rows only", sites.length === 2, JSON.stringify(reports[0]));
  check("SELECT carries ST_Y/ST_X of geom_col", m.calls()[0].includes(encodeURIComponent("ST_Y(the_geom) AS __lat")));
  check("row places by its own PostGIS point", sites[0].lat === 39.94716686085295 && sites[0].geo_precision === "point");
  check("ZIP+4 truncated to 5", sites[0].zip === "19143");
  check("Expired excluded verbatim", reports[0].excluded_by_status.some((e) => e.status === "Expired"));
  check("unmapped status surfaced, not guessed", reports[0].unmapped_statuses.some((u) => u.status === "Under Audit"));
  check("dataset-precision record_url fallback", sites[0].record_url === ENTRY.dataset_url && sites[0].record_url_precision === "dataset");
}

// 3. Bidirectional coverage gate: wrong county / wrong state never fetch.
{
  const m = mockFetch([row()]);
  const a = await cartoForZip("15213", ALLEGHENY, [ENTRY], { fetch: m.fn });
  const b = await cartoForZip("84302", UT, [ENTRY], { fetch: m.fn });
  check("Allegheny ZIP: Philly entry skipped, 0 fetches", a.sites.length === 0 && a.reports.length === 0 && m.calls().length === 0);
  check("Utah ZIP: entry skipped, 0 fetches", b.sites.length === 0 && b.reports.length === 0 && m.calls().length === 0);
}

// 4. Fail-closed: Carto SQL error object quarantines the entry (never fabricates).
{
  const m = mockFetch([], { error: true });
  const { sites, reports } = await cartoForZip("19143", PHILA, [ENTRY], { fetch: m.fn });
  check("SQL error → quarantined, 0 rows", sites.length === 0 && reports[0].quarantined[0].reason.includes("Carto SQL error"));
}

// 5. Fail-closed: entry without a zip column is skipped for ZIP reports.
{
  const entry = { ...ENTRY, column_map: { ...ENTRY.column_map, zip: undefined } } as unknown as CartoRegistryEntry;
  const m = mockFetch([row()]);
  const { sites, reports } = await cartoForZip("19143", PHILA, [entry], { fetch: m.fn });
  check("no zip col → quarantined, 0 fetches", sites.length === 0 && reports[0].quarantined.length === 1 && m.calls().length === 0);
}

// 6. Geometry-less row with a street address goes through deps.geocode → point.
{
  const m = mockFetch([row({ __lat: null, __lng: null })]);
  const { sites } = await cartoForZip("19143", PHILA, [ENTRY], {
    fetch: m.fn,
    geocode: async () => ({ lat: 39.9, lng: -75.2, match_type: "rooftop", geocode_source: "test" }),
  });
  check("geocode path → address precision", sites.length === 1 && sites[0].geo_precision === "address" && sites[0].lat === 39.9);
}

// 7. Blank status counts fail-closed.
{
  const m = mockFetch([row({ status: "" })]);
  const { sites, reports } = await cartoForZip("19143", PHILA, [ENTRY], { fetch: m.fn });
  check("blank status → excluded + counted", sites.length === 0 && reports[0].blank_status === 1);
}

console.log(failures ? `\n${failures} FAILURE(S)` : "\nall carto.ts tests passed");
if (failures) (globalThis as { process?: { exit: (c: number) => void } }).process?.exit(1);
