// Offline unit tests for the socrata connector's TEXT-DATE recency escape hatch — NO network.
// deps.fetch is a mock that captures the emitted URL instead of serving data.
//
// THE DEFECT THIS PINS (found 2026-08-02, docs/source-registry.md):
// `nyc-dob-permit-issuance` was wired across all five NYC boroughs, documented as live, and had
// placed ZERO records — ever. Its `issuance_date` is TEXT in MM/DD/YYYY, while buildWhere emitted
// an ISO literal (`issuance_date > '2025-08-02T00:00:00'`). On a text column that comparison is
// LEXICOGRAPHIC: every value starts with '0' or '1', so it is always < '2025-…' and nothing can
// match. Live receipts on ZIP 11214: 23,761 rows unfiltered, 0 with the connector's own clause.
//
// The failure is silent — a well-formed query returning an honest-looking empty set — so it is
// pinned here rather than left to the next reader to rediscover.
// Run: node scripts/run-unit-tests.mjs   (or: node test/socrata-text-date-recency.test.ts)
import { socrataForZip, type SocrataRegistryEntry } from "../supabase/functions/get-address-report/sources/socrata.ts";

let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${detail ? " — " + detail : ""}`); }
}

const BASE: SocrataRegistryEntry = {
  registry_id: "nyc-dob-permit-issuance",
  platform: "socrata",
  domain: "data.cityofnewyork.us",
  dataset_id: "ipu4-2q9a",
  dataset_url: "https://data.cityofnewyork.us/d/ipu4-2q9a",
  jurisdiction: "New York City (DOB BIS legacy)",
  coverage: [{ state: "NY", county: "Kings" }],
  column_map: {
    title: ["permit_type", "street_name"],
    status_raw: "permit_status",
    type_source: "permit_type",
    file_date: "issuance_date",
    address: ["house__", "street_name"],
    lat: "gis_latitude",
    lng: "gis_longitude",
    case_number: "job__",
    zip: "zip_code",
  },
  status_to_bucket: { proposed: ["IN PROCESS"], approved: ["ISSUED", "RE-ISSUED"], operating: [], exclude: ["REVOKED"] },
  type_map: { NB: "Development", DM: "Development", AL: "Development", FO: "Development" },
  extra_where: "permit_type in ('NB','DM','AL','FO')",
  recency_days: 365,
} as SocrataRegistryEntry;

const COMMUNITIES = [{ state: "NY", county: "Kings" }] as never;

/** Drive the SHIPPED connector and capture the $where it actually emits. */
async function whereFor(entry: SocrataRegistryEntry): Promise<string> {
  let captured = "";
  const deps = {
    fetch: async (url: string) => {
      captured = new URL(url).searchParams.get("$where") ?? "";
      return { ok: true, status: 200, json: async () => [], text: async () => "[]" };
    },
  } as never;
  await socrataForZip("11214", COMMUNITIES, [entry], deps);
  return captured;
}

const today = new Date();
const cutoff = new Date(today.getTime() - 365 * 86400000).toISOString().slice(0, 10);
const compact = cutoff.replaceAll("-", "");

console.log("socrata text-date recency");

// 1. THE DEFECT, demonstrated: without the escape hatch the connector emits an ISO literal against
//    a text MM/DD/YYYY column — the clause that matched nothing in production.
const broken = await whereFor(BASE);
check("default emits the ISO literal that cannot match a text MM/DD/YYYY column",
  broken.includes(`issuance_date > '${cutoff}T00:00:00'`), broken);

// 2. THE FIX: recency_expr replaces the comparison, and the cutoff is substituted at REQUEST time
//    so the window keeps rolling rather than freezing the way an extra_where literal would.
const fixed = await whereFor({
  ...BASE,
  recency_expr: "(substring(issuance_date,7,4)||substring(issuance_date,1,2)||substring(issuance_date,4,2)) >= '{cutoff_compact}'",
} as SocrataRegistryEntry);
check("recency_expr emits the substring comparison",
  fixed.includes("substring(issuance_date,7,4)"), fixed);
check("cutoff is substituted at request time (rolling, not frozen)",
  fixed.includes(`>= '${compact}'`), fixed);
check("the broken ISO comparison is GONE, not merely accompanied",
  !fixed.includes("T00:00:00"), fixed);
check("extra_where still ANDed alongside",
  fixed.includes("permit_type in ('NB','DM','AL','FO')"), fixed);
check("{cutoff} (dashed) form also substitutes",
  (await whereFor({ ...BASE, recency_expr: "d >= '{cutoff}'" } as SocrataRegistryEntry)).includes(`d >= '${cutoff}'`));

// 3. ADDITIVE: an entry that does not opt in is byte-identical to before the change.
check("entries without recency_expr are unchanged (additive)",
  (await whereFor(BASE)) === broken);

// 4. An empty/whitespace recency_expr must not silently drop the recency window altogether.
const blank = await whereFor({ ...BASE, recency_expr: "   " } as SocrataRegistryEntry);
check("blank recency_expr falls back to the default clause, never to no filter",
  blank.includes("T00:00:00"), blank);

console.log(failures === 0 ? "\nAll socrata text-date recency assertions passed." : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
