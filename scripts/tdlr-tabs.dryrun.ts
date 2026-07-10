// Dry-run of the get-address-report v15 TABS integration (runbook §1) — OFFLINE.
// Exercises tabsForZip(), the exact entry point index.ts calls, with:
//   • deps.fetch serving the committed Step-0 fixtures (fixtures/tabs/) instead of
//     the live registry — no network, no live-cache writes;
//   • deps.geocode STUBBED to the pinned 78617 centroid (30.1745, -97.6134 —
//     zipcodes PyPI v3.0.0, per docs/del-valle-78617-development-reports-seed.sql).
//     The live run geocodes each filed street address via the Census path; stub
//     coordinates here are a clearly-labeled offline stand-in, NEVER cached.
// Also asserts the coverage gate: the source must NOT run for a Utah ZIP.
import { readFileSync } from "node:fs";
import { tabsForZip } from "../supabase/functions/get-address-report/sources/tdlr-tabs";

const FIX_DIR = new URL("../fixtures/tabs", import.meta.url).pathname;
const pins = JSON.parse(readFileSync(new URL("../docs/pins/tdlr-tabs-projects.travis.json", import.meta.url), "utf8"));

// home anchor = pinned ZIP centroid (same value the ZIP-mode batch passes)
const HOME: [number, number] = [30.1745, -97.6134];
const MILES_PER_DEG_LAT = 69.0;
const toEN = (lat: number, lng: number): [number, number] => [
  Math.round((lng - HOME[1]) * MILES_PER_DEG_LAT * Math.cos((HOME[0] * Math.PI) / 180) * 1000) / 1000,
  Math.round((lat - HOME[0]) * MILES_PER_DEG_LAT * 1000) / 1000,
];

const deps = {
  fetch: (async (url: string) => {
    const no = String(url).split("/").pop()!;
    try {
      const body = readFileSync(`${FIX_DIR}/${no}.html`, "utf8");
      return { ok: true, status: 200, text: async () => body } as unknown as Response;
    } catch {
      return { ok: false, status: 404, text: async () => "" } as unknown as Response;
    }
  }) as unknown as typeof fetch,
  geocode: async (_addr: string) => ({ lat: HOME[0], lng: HOME[1] }), // OFFLINE STUB (see header)
  delayMs: 0,
};

async function main() {
  // 1) coverage gate — a Utah ZIP must not activate the source
  const gated = await tabsForZip("84302", [{ state: "Utah", county: "Box Elder" }], { travis: pins }, deps);
  if (gated.sites.length || gated.quarantined.length) throw new Error("COVERAGE GATE FAILED: TABS ran for a UT ZIP");
  console.log("✓ coverage gate: UT ZIP 84302 → TABS did not run (0 sites, 0 quarantined)\n");

  // 2) the real thing — ZIP 78617 resolves to Travis County, TX rows in `communities`
  const res = await tabsForZip("78617", [
    { state: "TX", county: "Travis" },       // Del Valle (78617) level=zip page
    { state: "TX", county: "Travis" },       // Travis County root
  ], { travis: pins }, deps);

  const sites = res.sites.map((s) => { const [e, n] = toEN(s.lat!, s.lng!); return { ...s, e, n }; });
  console.log(`ZIP 78617 → ${sites.length} TABS sites (counts.development += ${sites.length}), ${res.quarantined.length} quarantined\n`);
  console.log(JSON.stringify(sites, null, 2));
  console.log("\ntabs_quarantined:", JSON.stringify(res.quarantined, null, 2));

  // invariants: every site record_url'd + project_no matches the URL suffix (verifier §3 probe)
  for (const s of sites) {
    if (!/^https:\/\/www\.tdlr\.texas\.gov\/TABS\/Projects\/TABS\d{10}$/.test(s.record_url)) throw new Error(`bad record_url: ${s.record_url}`);
    if (!s.record_url.endsWith(s.project_no)) throw new Error(`project_no mismatch: ${s.project_no}`);
  }
  console.log(`\n✓ all ${sites.length} sites carry a valid TABS record_url matching project_no`);
  console.log("DRY RUN PASS");
}
main().catch((e) => { console.error(e); process.exit(1); });
