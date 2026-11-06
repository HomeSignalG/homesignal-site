// Offline tests for the arcgis connector's http1_only option (sources/http1.ts) — NO network.
//
// WHY (2026-11-06): maps.huntsvilleal.gov answered a GitHub runner's HTTP/1.1 request with 19,015
// permits (ingest recon-fetch run 42265451897), while the engine's fetch and pg_net, which negotiate
// HTTP/2, failed every day with "error sending request" / "Stream error in the HTTP/2 framing layer".
// http1_only asks Deno for an HTTP/1.1-only client and must never quietly fall back to HTTP/2.
// Run: node scripts/run-unit-tests.mjs   (or: node test/arcgis-http1-only.test.ts)
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { arcgisForZip, type ArcgisRegistryEntry } from "../supabase/functions/get-address-report/sources/arcgis.ts";
import { resetHttp1Client } from "../supabase/functions/get-address-report/sources/http1.ts";

let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${detail ? " — " + detail : ""}`); }
}

const root = process.cwd();
const registry = JSON.parse(readFileSync(join(root, "supabase/functions/get-address-report/jurisdiction-registry.json"), "utf8"));
const HSV = (registry.arcgis as ArcgisRegistryEntry[]).find((e) => e.registry_id === "huntsville-building-permits")!;
const COMM = HSV.coverage.map((c) => ({ state: c.state, county: c.county ?? null }));
const FEATURE = { attributes: { PermitID: 700433, OccupancyType: "Commercial", Permit_Issue_DateTime: Date.now() - 86400000, Address: "100 Test St" }, geometry: { x: -86.58, y: 34.73 } };

function spy() {
  const inits: RequestInit[] = [];
  const f = (async (_u: RequestInfo | URL, init?: RequestInit) => {
    inits.push(init ?? {});
    return new Response(JSON.stringify({ features: [FEATURE] }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  return { f, inits };
}
const g = globalThis as { Deno?: unknown };

console.log("arcgis http1_only");
check("the Huntsville entry opts in", !!HSV && HSV.http1_only === true);

// 1. No HTTP/1.1 client available (node, or a runtime that withholds it): the source fails with the
//    reason and makes NO request, so the failure log says why instead of repeating the HTTP/2 error.
{
  delete g.Deno; resetHttp1Client();
  const s = spy();
  const { reports } = await arcgisForZip("35801", COMM, [HSV], { fetch: s.f, zipCentroid: { lat: 34.73, lng: -86.58 } });
  const q = JSON.stringify(reports[0]?.quarantined ?? []);
  check("no client: zero requests (never falls back to HTTP/2)", s.inits.length === 0, `requests=${s.inits.length}`);
  check("no client: the fetch failure names http1_only", q.includes("http1_only"), q);
}

// 2. A client is available: every request carries it.
{
  const made: Record<string, unknown>[] = [];
  const CLIENT = { tag: "h1" };
  g.Deno = { createHttpClient: (o: Record<string, unknown>) => { made.push(o); return CLIENT; } };
  resetHttp1Client();
  const s = spy();
  const { sites } = await arcgisForZip("35801", COMM, [HSV], { fetch: s.f, zipCentroid: { lat: 34.73, lng: -86.58 } });
  check("client asked for HTTP/1.1 only", made.length === 1 && made[0].http2 === false, JSON.stringify(made));
  check("every request carries the client", s.inits.length > 0 && s.inits.every((i) => (i as { client?: unknown }).client === CLIENT));
  check("records still emitted", sites.length >= 1, `sites=${sites.length}`);
}

// 3. Additive: an entry without the option never gets a client, even when one is available.
{
  const s = spy();
  await arcgisForZip("35801", COMM, [{ ...HSV, http1_only: undefined } as ArcgisRegistryEntry], { fetch: s.f, zipCentroid: { lat: 34.73, lng: -86.58 } });
  check("without the option no client is passed", s.inits.length > 0 && s.inits.every((i) => !("client" in (i as object))));
  delete g.Deno; resetHttp1Client();
}

console.log(failures === 0 ? "\nAll arcgis http1_only assertions passed." : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
