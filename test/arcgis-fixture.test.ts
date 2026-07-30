// Offline unit tests for sources/arcgis.ts driven by the RESTORED
// madison-planning-projects registry entry — NO network. deps.fetch is a mock
// serving the committed fixture of 7 REAL features captured live 2026-07-24
// (fixtures/madison/planning-projects-sample.json) plus synthetic paging/error
// shapes. Exercises the ACTUAL adapter code path end to end: registry-driven
// discovery + coverage gate, spatial envelope scoping, pagination, field
// normalization, status mapping, unknown-status fail-closed exclusion, source
// point geometry, deterministic source IDs, duplicate prevention, empty
// upstream response, and upstream error handling.
// Run: node scripts/run-unit-tests.mjs   (or: node test/arcgis-fixture.test.ts)
// Discovered automatically by run-unit-tests.mjs and executed in the `unit` CI job.
// node >=22.6 strips the TypeScript types natively — no esbuild step.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  arcgisForZip, coverageMatches, envelopeFor,
  type ArcgisRegistryEntry,
} from "../supabase/functions/get-address-report/sources/arcgis.ts";

// Run from the repo root (the bundle's own path is a temp file — cwd is the anchor).
const root = process.cwd();
let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${detail ? " — " + detail : ""}`); }
}

// The COMMITTED entry — read from the registry itself so these tests pin the shipped
// config, not a copy that could drift.
const registry = JSON.parse(readFileSync(
  join(root, "supabase/functions/get-address-report/jurisdiction-registry.json"), "utf8"));
const ENTRY = (registry.arcgis as ArcgisRegistryEntry[])
  .find((e) => e.registry_id === "madison-planning-projects")!;
check("registry carries the madison-planning-projects entry", !!ENTRY);

const FIXTURE = JSON.parse(readFileSync(join(root, "fixtures/madison/planning-projects-sample.json"), "utf8"));

const DANE = [{ state: "WI", county: "Dane" }];
const MILWAUKEE = [{ state: "WI", county: "Milwaukee" }];
const UTAH = [{ state: "Utah", county: "Box Elder" }];
const MADISON_CENTROID = { lat: 43.0731, lng: -89.4012 }; // 53703

function mockFetch(handler: (url: string) => unknown): typeof fetch {
  const calls: string[] = [];
  const f = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    const body = handler(url);
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  (f as unknown as { calls: string[] }).calls = calls;
  return f;
}
const callsOf = (f: typeof fetch) => (f as unknown as { calls: string[] }).calls;

// ── coverage gate (discovery is registry-driven) ────────────────────────────
{
  check("coverage matches Dane WI", coverageMatches(ENTRY.coverage, DANE));
  check("coverage rejects Milwaukee WI (sibling-county gate)", !coverageMatches(ENTRY.coverage, MILWAUKEE));
  check("coverage rejects Utah (cross-state gate)", !coverageMatches(ENTRY.coverage, UTAH));

  const fetchSpy = mockFetch(() => FIXTURE);
  const { sites, reports } = await arcgisForZip("84302", UTAH, [ENTRY],
    { fetch: fetchSpy, zipCentroid: { lat: 41.5, lng: -112.0 } });
  check("out-of-coverage ZIP: zero fetches, zero sites, zero reports",
    sites.length === 0 && reports.length === 0 && callsOf(fetchSpy).length === 0);
}

// ── main run over the real-feature fixture ──────────────────────────────────
{
  const fetchSpy = mockFetch(() => FIXTURE);
  const { sites, reports } = await arcgisForZip("53703", DANE, [ENTRY],
    { fetch: fetchSpy, zipCentroid: MADISON_CENTROID });
  const r = reports[0];

  check("one run report for the entry", reports.length === 1 && r.registry_id === "madison-planning-projects");
  check("7 fetched", r.fetched === 7, `fetched=${r?.fetched}`);
  check("5 emitted (2 dead statuses fail closed)", r.emitted === 5 && sites.length === 5);
  check("excluded_by_status names exactly the 2 dead statuses",
    r.excluded_by_status.length === 2 &&
    r.excluded_by_status.every((x) => ["Approval(s) Expired", "Placed on File or Denied"].includes(x.status)));
  check("nothing unmapped, nothing blank", r.unmapped_statuses.length === 0 && r.blank_status === 0);
  check("nothing quarantined", r.quarantined.length === 0, JSON.stringify(r.quarantined));

  const by = Object.fromEntries(sites.map((s) => [s.case_number, s]));
  const g = by["LNDUSE-2015-00037"];
  check("golden case emitted", !!g);
  check("bucket approved / type approved", g?.bucket === "approved" && g?.type === "approved");
  check("status_raw verbatim", g?.status_raw === "Final Approval Granted");
  check("file_date epoch-ms → 2015-08-21", g?.file_date === "2015-08-21");
  check("record_url = ProjectURL (column wins) = canonical template",
    g?.record_url === "https://www.cityofmadison.com/dpced/planning/development.cfm?record=LNDUSE-2015-00037"
    && g?.record_url_precision === "record");
  check("deterministic source_id", g?.source_id === "arcgis:madison-planning-projects:LNDUSE-2015-00037");
  check("source point geometry (scope point, geo_precision point, no geocode)",
    g?.scope === "point" && g?.geo_precision === "point"
    && Math.abs((g?.lat ?? 0) - 43.138815692663215) < 1e-9
    && Math.abs((g?.lng ?? 0) - -89.291471135905979) < 1e-9);
  check("use_type unclassified (no type_map — golden parity)", g?.use_type === "unclassified");
  check("In Process → proposed", by["LNDUSE-2019-00032"]?.bucket === "proposed");
  check("Approval Granted, Completed → operating/built",
    by["LNDUSE-2025-00011"]?.bucket === "operating" && by["LNDUSE-2025-00011"]?.type === "built");
  check("no duplicate source_ids", new Set(sites.map((s) => s.source_id)).size === sites.length);

  const q = callsOf(fetchSpy)[0];
  const u = new URL(q);
  const env = envelopeFor(MADISON_CENTROID.lat, MADISON_CENTROID.lng, 3);
  check("spatial envelope query (esriGeometryEnvelope, ±3 mi, intersects)",
    u.searchParams.get("geometryType") === "esriGeometryEnvelope"
    && u.searchParams.get("spatialRel") === "esriSpatialRelIntersects"
    && u.searchParams.get("geometry") === `${env.xmin},${env.ymin},${env.xmax},${env.ymax}`);
  check("no attribute ZIP clause (where=1=1 — spatial scoping only)", u.searchParams.get("where") === "1=1");
  check("WGS84 output requested", u.searchParams.get("outSR") === "4326");
}

// ── pagination: two pages, exceededTransferLimit honored ────────────────────
{
  const pageRows = (page: number, n: number) => ({
    ...FIXTURE,
    features: Array.from({ length: n }, (_, i) => ({
      attributes: {
        RECORD_RecordID: `PG${page}-${i}`, RECORD_Status: "Final Approval Granted",
        Project_Description: `page ${page} row ${i}`,
        ProjectURL: `https://www.cityofmadison.com/dpced/planning/development.cfm?record=PG${page}-${i}`,
        DATES_SubmittedDate: 1700000000000, APO_ADDRESS_PARTIAL_LINE: "1 Main St",
      },
      geometry: { x: -89.4, y: 43.07 },
    })),
    exceededTransferLimit: page === 1,
  });
  const fetchSpy = mockFetch((url) => {
    const off = Number(new URL(url).searchParams.get("resultOffset") || "0");
    return off === 0 ? pageRows(1, 1000) : pageRows(2, 3);
  });
  const { sites, reports } = await arcgisForZip("53703", DANE, [ENTRY],
    { fetch: fetchSpy, zipCentroid: MADISON_CENTROID });
  check("pagination walks both pages (1000 + 3)", reports[0].fetched === 1003 && sites.length === 1003);
  check("second request used resultOffset=1000",
    callsOf(fetchSpy).some((u) => new URL(u).searchParams.get("resultOffset") === "1000"));
  check("paged rows keep unique source_ids", new Set(sites.map((s) => s.source_id)).size === 1003);
}

// ── empty upstream response → honest empty, no quarantine ───────────────────
{
  const fetchSpy = mockFetch(() => ({ ...FIXTURE, features: [] }));
  const { sites, reports } = await arcgisForZip("53703", DANE, [ENTRY],
    { fetch: fetchSpy, zipCentroid: MADISON_CENTROID });
  check("empty response → 0 fetched, 0 emitted, 0 quarantined",
    reports[0].fetched === 0 && sites.length === 0 && reports[0].quarantined.length === 0);
}

// ── upstream error object → failed fetch (quarantine), never empty-success ──
{
  const fetchSpy = mockFetch(() => ({ error: { code: 400, message: "Failed to execute query.", details: [] } }));
  const { sites, reports } = await arcgisForZip("53703", DANE, [ENTRY],
    { fetch: fetchSpy, zipCentroid: MADISON_CENTROID });
  check("ArcGIS error body → quarantined fetch failure, 0 sites",
    sites.length === 0 && reports[0].quarantined.length === 1
    && reports[0].quarantined[0].reason.includes("fetch failed"));
}

// ── missing centroid (spatial entry) → skipped with a quarantine note ───────
{
  const fetchSpy = mockFetch(() => FIXTURE);
  const { sites, reports } = await arcgisForZip("53703", DANE, [ENTRY], { fetch: fetchSpy });
  check("no zipCentroid for a spatial entry → skipped + quarantine note, zero fetches",
    sites.length === 0 && callsOf(fetchSpy).length === 0
    && reports[0].quarantined.some((x) => x.reason.includes("spatial_zip_radius_mi")));
}

if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log("\nAll arcgis.fixture-test checks passed.");
