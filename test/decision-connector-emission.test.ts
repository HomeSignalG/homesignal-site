// test/decision-connector-emission.test.ts
//
// THE DEFECT, DRIVEN THROUGH THE SHIPPED CONNECTOR. Before this, a status in a registry
// entry's `exclude` bucket was the ONLY home for "Denied", and `exclude` means `continue`
// — the row never became a record, so a proposal a government body refused simply was not
// on HomeSignal. Measured 2026-09-20 across all 239 registry entries: 294 denial-shaped
// values, 294 of 294 in `exclude`, 0 in any emitting bucket.
//
// This file proves the opposite end to end, against sources/arcgis.ts itself — not a copy
// of its logic — with a SYNTHETIC registry entry and a mock fetch, so it tests the code
// path rather than today's registry contents (the real registry's decision buckets are
// pinned separately, in test/decision-history-contract.test.mjs §5).
//
// Run: node test/decision-connector-emission.test.ts
import { arcgisForZip, type ArcgisRegistryEntry } from "../supabase/functions/get-address-report/sources/arcgis.ts";
import { isActiveUndecided } from "../supabase/functions/get-address-report/sources/decision.ts";

let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${detail ? " — " + detail : ""}`); }
}

const COVERAGE = [{ state: "PA", county: "Chester" }];
const CENTROID = { lat: 40.176, lng: -75.548 };   // 19475, Spring City — the regression ZIP

const ENTRY: ArcgisRegistryEntry = {
  registry_id: "test-decision-emission",
  platform: "arcgis",
  service_url: "https://example.gov/arcgis/rest/services/Cases/FeatureServer/0",
  dataset_url: "https://example.gov/cases",
  jurisdiction: "Test County",
  coverage: COVERAGE,
  spatial_zip_radius_mi: 3,
  column_map: {
    title: "CaseName",
    status_raw: "CaseStatus",
    type_source: "CaseType",
    file_date: "FiledDate",
    decision_date: "DecidedDate",
    lat: "__lat",
    lng: "__lng",
    case_number: "CaseNo",
    record_url: "CaseUrl",
  },
  type_map: { "Conditional Use": "Development" },
  status_to_bucket: {
    proposed: ["Under Review"],
    approved: ["Approved"],
    operating: [],
    denied: ["Denied"],
    withdrawn: ["Withdrawn"],
    exclude: ["Expired"],
  },
  record_url_precision: "record",
} as ArcgisRegistryEntry;

const row = (n: number, status: string, decided: string | null) => ({
  attributes: {
    CaseNo: `C-${n}`, CaseName: `Case ${n}`, CaseStatus: status, CaseType: "Conditional Use",
    FiledDate: "2024-01-05", DecidedDate: decided, CaseUrl: `https://example.gov/case/${n}`,
  },
  geometry: { x: -75.548, y: 40.176 },
});

const FIXTURE = {
  features: [
    row(1, "Under Review", null),      // a live proposal
    row(2, "Denied", "2024-03-12"),    // refused, with a stated decision date
    row(3, "Denied", null),            // refused, with NO date the source states
    row(4, "Withdrawn", "2024-05-02"), // pulled by the applicant
    row(5, "Approved", "2024-02-01"),
    row(6, "Expired", null),           // administrative lapse — still dropped
  ],
};

const mockFetch = (async () => new Response(JSON.stringify(FIXTURE), {
  status: 200, headers: { "content-type": "application/json" },
})) as unknown as typeof fetch;

const { sites, reports } = await arcgisForZip("19475", COVERAGE, [ENTRY],
  { fetch: mockFetch, zipCentroid: CENTROID });
const r = reports[0];
const by = (n: number) => sites.find((s) => s.case_number === `C-${n}`);

// ── it is EMITTED, which is the whole defect ────────────────────────────────────
check("6 rows fetched (control — a zero would make every assertion below vacuous)", r.fetched === 6, `fetched=${r.fetched}`);
check("5 emitted: the denied and withdrawn rows are RECORDS now, only the expired one is dropped",
  r.emitted === 5 && sites.length === 5, `emitted=${r.emitted} sites=${sites.length}`);
check("the denied row exists at all — the defect, gone", !!by(2));
check("the withdrawn row exists", !!by(4));
check("the EXPIRED row is still dropped — an administrative lapse is not a ruling",
  !by(6) && r.excluded_by_status.some((x) => x.status === "Expired"));

// ── separation 1: browsing category ─────────────────────────────────────────────
check("a denied application browses as PROPOSED — discoverable where a resident looks",
  by(2)!.type === "proposed", `type=${by(2)!.type}`);
check("a withdrawn application browses as PROPOSED too", by(4)!.type === "proposed");
check("and is NEVER promoted to approved", by(2)!.type !== "approved" && by(4)!.type !== "approved");
check("the live proposal is unchanged (control)", by(1)!.type === "proposed" && by(1)!.decision === null);
check("the approved row is unchanged (control)", by(5)!.type === "approved" && by(5)!.decision === null);

// ── separation 2: the sourced decision ──────────────────────────────────────────
check("the decision names the outcome and keeps the publisher's own word",
  by(2)!.decision?.outcome === "denied" && by(2)!.decision?.status_raw === "Denied");
check("a stated decision date is carried verbatim", by(2)!.decision?.decided_on === "2024-03-12");
check("an UNSTATED decision date stays null — never substituted from the filing date",
  by(3)!.decision?.decided_on === null && by(3)!.file_date === "2024-01-05");
check("the decision carries the official record URL that proves it",
  by(2)!.decision?.source_url === "https://example.gov/case/2");
check("withdrawal keeps its own outcome — not collapsed into 'denied'",
  by(4)!.decision?.outcome === "withdrawn");
check("`decided` mirrors the decision on every row",
  sites.every((s) => s.decided === (s.decision !== null)));

// ── separation 3: current-status evidence, stamped per source ───────────────────
check("every record carries this SOURCE's evidence level, so a page never has to guess",
  sites.every((s) => s.decision_evidence === "decision"));

// ── separation 4: eligibility ───────────────────────────────────────────────────
check("the live proposal counts as active", isActiveUndecided(by(1)!));
check("the denied one does NOT — in the Proposed rail, out of every active count",
  !isActiveUndecided(by(2)!) && !isActiveUndecided(by(3)!));
check("nor does the withdrawn one", !isActiveUndecided(by(4)!));
check("active-undecided count is 1, browsing-category count is 4 — and that gap is the feature",
  sites.filter((s) => isActiveUndecided(s)).length === 1
  && sites.filter((s) => s.type === "proposed").length === 4);

// ── the run report distinguishes SURFACED from DROPPED ──────────────────────────
check("decided_by_status names the three decision rows",
  r.decided_by_status.reduce((a, x) => a + x.count, 0) === 3,
  JSON.stringify(r.decided_by_status));
check("and they are NOT reported as exclusions — 'we surfaced 3' must never read as 'we dropped 3'",
  !r.excluded_by_status.some((x) => x.status === "Denied" || x.status === "Withdrawn"));

console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll decision-emission checks passed.");
process.exit(failures ? 1 : 0);
