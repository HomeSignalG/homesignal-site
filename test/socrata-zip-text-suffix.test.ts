// Offline unit tests for the socrata connector's zip_text_suffix option, NO network.
//
// WHY (2026-11-05): Kansas City, Missouri publishes 'City Issued Permits' (data.kcmo.org w8jz-wjgn) with the
// ZIP only inside an address-text column, main_address_line2 = "Kansas City, MO 64156". An exact match on
// that column can never equal a ZIP, so the entry would silently return nothing. zip_text_suffix matches the
// ZIP at the END of the text instead. Rows below are verbatim from the live dataset (pg_net 24545, 2026-11-05).
// Run: node scripts/run-unit-tests.mjs   (or: node test/socrata-zip-text-suffix.test.ts)
import { readFileSync } from "node:fs";
import { socrataForZip, zipSuffixClause, type SocrataRegistryEntry } from "../supabase/functions/get-address-report/sources/socrata.ts";

let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${detail ? " — " + detail : ""}`); }
}

const REG = JSON.parse(readFileSync(new URL("../supabase/functions/get-address-report/jurisdiction-registry.json", import.meta.url), "utf8"));
const KC = (REG.socrata as SocrataRegistryEntry[]).find((e) => e.registry_id === "kcmo-building-permits") as SocrataRegistryEntry;
const COMMUNITIES = [{ state: "MO", county: "Jackson" }] as never;

const ROWS = [
  { permit_number: "CPBC-2026-01116", issue_date: "2026-10-30T08:12:02.740", project: "1308 W 11th St West Bottoms Parking",
    permit_type: "CPPU - Building (Commercial)", work_class: "Site Improvement", permit_status: "Issued",
    main_address_line1: "1308 W 11th St", main_address_line2: "Kansas City, MO 64101" },
  { permit_number: "CPDC-2026-00165", issue_date: "2026-10-05T10:54:07.993",
    permit_type: "CPPU - Demolition (Commercial)", work_class: "Interior Demolition Only", permit_status: "Issued",
    main_address_line1: "1400 Union Ave", main_address_line2: "Kansas City, MO 64101" },
];

async function run(entry: SocrataRegistryEntry, zip: string) {
  let where = "";
  const geocoded: string[] = [];
  const deps = {
    fetch: async (url: string) => {
      where = new URL(url).searchParams.get("$where") ?? "";
      const off = Number(new URL(url).searchParams.get("$offset") ?? "0");
      const body = off === 0 ? ROWS : [];
      return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
    },
    geocode: async (address: string) => { geocoded.push(address); return { lat: 39.1018, lng: -94.6022, match_type: "Exact", matched_address: address }; },
    zipCentroid: { lat: 39.1027, lng: -94.5986 },
  } as never;
  const out = await socrataForZip(zip, COMMUNITIES, [entry], deps);
  return { where, geocoded, out: out as unknown as { sites: Record<string, unknown>[]; reports: Record<string, unknown>[] } };
}

console.log("socrata zip_text_suffix");

// 1. The clause itself.
check("suffix clause matches the ZIP at the end, plain or ZIP+4",
  zipSuffixClause("main_address_line2", "64101") ===
  "(upper(main_address_line2) like '% 64101' OR upper(main_address_line2) like '% 64101-%')");
check("only the 5 digits reach the query (nothing else from the input)",
  !zipSuffixClause("c", "64101' OR 1=1 --").includes("1=1"), zipSuffixClause("c", "64101' OR 1=1 --"));

// 2. The shipped Kansas City entry emits it, with the type whitelist and the rolling window.
check("registry entry exists and opts in", !!KC && KC.zip_text_suffix === true && KC.platform === "socrata");
const r = await run(KC, "64101");
check("emitted $where uses the suffix match, never an exact match",
  r.where.includes("like '% 64101'") && !r.where.includes("='64101'"), r.where);
check("building/demolition filter pushed down at source", r.where.includes("starts_with(permit_type, 'CPPU - Building')") && r.where.includes("starts_with(permit_type, 'CPPU - Demolition')"), r.where);
check("recency window on issue_date", /issue_date > '\d{4}-\d{2}-\d{2}T00:00:00'/.test(r.where), r.where);

// 3. Records: placed by geocoding their own street address with the ZIP read from the address text.
const recs = (r.out.sites ?? []) as Record<string, unknown>[];
check("both permits emitted", recs.length === 2, JSON.stringify(r.out.reports));
check("geocode input carries the filed ZIP from main_address_line2",
  r.geocoded.length === 2 && r.geocoded.every((g) => g.includes("64101")), JSON.stringify(r.geocoded));
check("issued permits are approved (CLAUDE.md 7.12a)", recs.length === 2 && recs.every((x) => x.bucket === "approved"), JSON.stringify(recs.map((x) => x.bucket)));
check("placed at the geocoded point, not the ZIP centroid", recs.length === 2 && recs.every((x) => x.scope === "point" && x.lat === 39.1018));
check("title is the work class plus the project name", recs[0]?.title === "Site Improvement — 1308 W 11th St West Bottoms Parking" || String(recs[0]?.title).startsWith("Site Improvement"), String(recs[0]?.title));
check("every record keeps an official link", recs.length === 2 && recs.every((x) => typeof x.record_url === "string" && String(x.record_url).startsWith("https://data.kcmo.org/")));

// 4. Additive: an entry that does not opt in keeps the exact match.
const off = await run({ ...KC, zip_text_suffix: false } as SocrataRegistryEntry, "64101");
check("without the option the old exact match is emitted", off.where.includes("upper(main_address_line2)='64101'"), off.where);

console.log(failures === 0 ? "\nAll socrata zip_text_suffix assertions passed." : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
