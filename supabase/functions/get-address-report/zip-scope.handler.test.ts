// Deno integration test: the SHIPPED get-address-report handler (index.ts), ZIP mode, with the
// network stubbed. It proves — under the real Deno runtime and the real module graph — that the
// polygon-bbox spatial scope is controlled ONLY by server policy:
//   • unset / "off" / unknown mode  ⇒ no bounds read, the legacy centroid square is queried;
//   • "allowlist"                   ⇒ only listed ZIPs read bounds and widen;
//   • "all"                         ⇒ every ZIP widens;
//   • a request body can NEVER turn it on or off (the endpoint is deployed --no-verify-jwt).
//
// Run (CI: verify-edge-function.yml): deno run --allow-env --allow-read zip-scope.handler.test.ts
// It prints `N passed, M failed` and exits non-zero on failure. No production service is contacted.

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`PASS ${name}`); }
  else { fail++; console.log(`FAIL ${name}${detail ? `\n     ${detail}` : ""}`); }
}

// ── environment the module reads at import time ─────────────────────────────────────────────
Deno.env.set("SUPABASE_URL", "https://stub.supabase.test");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "stub-service-key");
for (const k of ["ZIP_SCOPE_BOUNDS_MODE", "ZIP_SCOPE_BOUNDS_ZIPS"]) Deno.env.delete(k);

// ── capture the handler instead of binding a port ───────────────────────────────────────────
let handler: ((req: Request) => Promise<Response>) | null = null;
(Deno as unknown as { serve: (h: (req: Request) => Promise<Response>) => unknown }).serve = (h) => { handler = h; return {}; };

// ── the stubbed network ─────────────────────────────────────────────────────────────────────
const BOUNDS: Record<string, { xmin: number; ymin: number; xmax: number; ymax: number }> = {
  "76247": { xmin: -97.419356, ymin: 33.005089, xmax: -97.226825, ymax: 33.179387 },
  "76258": { xmin: -97.0372, ymin: 33.288322, xmax: -96.815242, ymax: 33.449421 },
  "76227": { xmin: -97.123906, ymin: 33.188336, xmax: -96.863538, ymax: 33.357867 },
};
const CENTROID: Record<string, [number, number]> = { "76247": [33.0734, -97.3093], "76258": [33.371, -96.9446], "76227": [33.292, -96.9879] };

interface Calls { rpc: string[]; denton: string[]; members: { zip: string; pts: number[][] }[] }
let calls: Calls = { rpc: [], denton: [], members: [] };
// Denton features to serve (point geometry, lng/lat); empty by default.
let dentonFeatures: { attributes: Record<string, unknown>; geometry: { x: number; y: number } }[] = [];
let membersMode: "ok" | "error" = "ok";
const jsonRes = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });

globalThis.fetch = (async (input: Request | URL | string, init?: RequestInit) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  if (url.hostname === "stub.supabase.test") {
    if (url.pathname.endsWith("/rpc/zip_scope_bounds")) {
      const zip = JSON.parse(String(init?.body ?? "{}")).p_zip as string;
      calls.rpc.push(zip);
      return jsonRes(BOUNDS[zip] ? [BOUNDS[zip]] : []);
    }
    if (url.pathname.endsWith("/rpc/zip_scope_members")) {
      const b = JSON.parse(String(init?.body ?? "{}")) as { p_zip: string; p_pts: number[][] };
      calls.members.push({ zip: b.p_zip, pts: b.p_pts });
      if (membersMode === "error") return jsonRes({ message: "membership unavailable" }, 500);
      // stand-in verdicts: northern half of the box is "outside" (the real SQL is proven on PostGIS)
      return jsonRes(b.p_pts.map((p, i) => ({ ord: i + 1, verdict: p[0] > 33.40 ? "outside" : "member" })));
    }
    if (url.pathname.endsWith("/rest/v1/communities")) {
      const sel = url.searchParams.get("select") ?? "";
      return jsonRes(sel.includes("state") ? [{ state: "TX", county: "Denton" }] : [{ id: "00000000-0000-0000-0000-000000000001" }]);
    }
    return jsonRes([]);                                    // every other table/RPC: empty
  }
  if (url.hostname === "gis.dentoncounty.gov") {           // the real Denton registry entry
    calls.denton.push(url.href);
    return jsonRes({ features: dentonFeatures, exceededTransferLimit: false });
  }
  return jsonRes([]);                                      // every other publisher: nothing
}) as typeof fetch;

await import("./index.ts");
if (!handler) { console.log("FAIL index.ts did not register a Deno.serve handler"); Deno.exit(1); }

async function zipRun(zip: string, extra: Record<string, unknown> = {}) {
  calls = { rpc: [], denton: [], members: [] };
  const [lat, lng] = CENTROID[zip];
  const res = await handler!(new Request("https://stub.functions.test/get-address-report", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ zip, lat, lng, ...extra }),
  }));
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try { body = JSON.parse(text); } catch { /* keep {} */ }
  const geom = calls.denton.length ? new URL(calls.denton[0]).searchParams.get("geometry") : null;
  return { status: res.status, body, geom, rpc: [...calls.rpc], members: [...calls.members], text };
}
const legacyGeom = (zip: string) => {
  const [lat, lng] = CENTROID[zip];
  const dLat = 3 / 69, dLng = 3 / (69 * Math.max(Math.cos(lat * Math.PI / 180), 0.1));
  return [lng - dLng, lat - dLat, lng + dLng, lat + dLat];
};
const near = (a: number[], b: number[]) => a.length === 4 && b.length === 4 && a.every((v, i) => Math.abs(v - b[i]) < 1e-9);
const parse = (g: string | null) => (g ?? "").split(",").map(Number);
const widerThanLegacy = (zip: string, g: string | null) => {
  const [x0, y0, x1, y1] = parse(g), [lx0, ly0, lx1, ly1] = legacyGeom(zip);
  return x0 <= lx0 && y0 <= ly0 && x1 >= lx1 && y1 >= ly1 && (x0 < lx0 || y0 < ly0 || x1 > lx1 || y1 > ly1);
};

// ── 1. default: OFF ─────────────────────────────────────────────────────────────────────────
{
  const r = await zipRun("76247");
  ok("handler runs ZIP mode end to end under Deno (200)", r.status === 200, `status ${r.status}: ${r.text.slice(0, 200)}`);
  ok("default (no env): the real Denton entry is queried", r.geom !== null);
  ok("default: legacy centroid square, byte-for-byte", near(parse(r.geom), legacyGeom("76247")), String(r.geom));
  ok("default: zip_scope_bounds is NOT called", r.rpc.length === 0, JSON.stringify(r.rpc));
}
// ── 2. a caller cannot turn it ON ───────────────────────────────────────────────────────────
for (const extra of [{ scope_bounds: true }, { scopeBounds: true }, { ZIP_SCOPE_BOUNDS_MODE: "all" }, { zip_scope_bounds: true }]) {
  const r = await zipRun("76247", extra);
  ok(`request body ${JSON.stringify(extra)} cannot enable the scope`, near(parse(r.geom), legacyGeom("76247")) && r.rpc.length === 0, String(r.geom));
}
// ── 3. unknown mode fails closed ────────────────────────────────────────────────────────────
for (const mode of ["", "off", "OFF", "on", "true", "1", "allow", "everything"]) {
  Deno.env.set("ZIP_SCOPE_BOUNDS_MODE", mode);
  Deno.env.set("ZIP_SCOPE_BOUNDS_ZIPS", "76247");
  const r = await zipRun("76247");
  ok(`mode "${mode}" (even with the ZIP listed) ⇒ OFF`, near(parse(r.geom), legacyGeom("76247")) && r.rpc.length === 0, String(r.geom));
}
// ── 4. allowlist ────────────────────────────────────────────────────────────────────────────
Deno.env.set("ZIP_SCOPE_BOUNDS_MODE", "allowlist");
Deno.env.set("ZIP_SCOPE_BOUNDS_ZIPS", "76258");
{
  const on = await zipRun("76258");
  ok("allowlist: a listed ZIP reads its bounds", on.rpc.length === 1 && on.rpc[0] === "76258", JSON.stringify(on.rpc));
  ok("allowlist: a listed ZIP queries the WIDER scope", widerThanLegacy("76258", on.geom), String(on.geom));
  const b = BOUNDS["76258"], g = parse(on.geom);
  ok("allowlist: the wider scope contains the ZIP polygon box", g[0] <= b.xmin && g[1] <= b.ymin && g[2] >= b.xmax && g[3] >= b.ymax, String(on.geom));
  const off = await zipRun("76247");
  ok("allowlist: an UNLISTED ZIP is untouched (legacy square, no bounds read)", near(parse(off.geom), legacyGeom("76247")) && off.rpc.length === 0, String(off.geom));
  const offBody = await zipRun("76247", { scope_bounds: true });
  ok("allowlist: a body flag cannot add an unlisted ZIP", near(parse(offBody.geom), legacyGeom("76247")) && offBody.rpc.length === 0);
  const onBody = await zipRun("76258", { scope_bounds: false });
  ok("allowlist: a body flag cannot remove a listed ZIP", widerThanLegacy("76258", onBody.geom) && onBody.rpc.length === 1);
}
Deno.env.set("ZIP_SCOPE_BOUNDS_ZIPS", " 76258 , 76247;76227 not-a-zip 7624 762477");
{
  const a = await zipRun("76247"), b = await zipRun("76227"), c = await zipRun("76258");
  ok("allowlist parsing: valid 5-digit tokens only (`;` is not a separator, so `76247;76227` is one malformed token and lists neither)",
    near(parse(a.geom), legacyGeom("76247")) && near(parse(b.geom), legacyGeom("76227")) && widerThanLegacy("76258", c.geom),
    `76247:${a.geom} 76227:${b.geom} 76258:${c.geom}`);
}
Deno.env.set("ZIP_SCOPE_BOUNDS_ZIPS", "");
{
  const r = await zipRun("76258");
  ok("allowlist mode with an EMPTY list enables nothing", near(parse(r.geom), legacyGeom("76258")) && r.rpc.length === 0);
}
// ── 5. all ──────────────────────────────────────────────────────────────────────────────────
Deno.env.set("ZIP_SCOPE_BOUNDS_MODE", "all");
{
  const r = await zipRun("76247");
  ok('mode "all": every ZIP widens', widerThanLegacy("76247", r.geom) && r.rpc[0] === "76247", String(r.geom));
  const off = await zipRun("76247", { scope_bounds: false });
  ok('mode "all": a body flag cannot switch it off', widerThanLegacy("76247", off.geom));
}
// ── 6. policy on, bounds unavailable ⇒ legacy scope, never an error ─────────────────────────
Deno.env.set("ZIP_SCOPE_BOUNDS_MODE", "allowlist");
Deno.env.set("ZIP_SCOPE_BOUNDS_ZIPS", "76247");
{
  const orig = BOUNDS["76247"];
  delete BOUNDS["76247"];                                  // the RPC now answers "no boundary"
  const r = await zipRun("76247");
  BOUNDS["76247"] = orig;
  ok("policy on but no boundary row ⇒ legacy scope and a 200 (fail-safe)", r.status === 200 && near(parse(r.geom), legacyGeom("76247")), String(r.geom));
}

// ── 7. widened-only containment through the real handler ───────────────────────────────────
Deno.env.set("ZIP_SCOPE_BOUNDS_MODE", "all");
{
  const f = (lng: number, lat: number, id: string) => ({ attributes: { OBJECTID: id }, geometry: { x: lng, y: lat } });
  const [cLat, cLng] = CENTROID["76258"];
  // legacy: at the centroid. widened-only: east of the square (inside / "outside" by the stub's rule).
  dentonFeatures = [f(cLng, cLat, "legacy"), f(-96.84, 33.38, "wide-in"), f(-96.84, 33.43, "wide-out")];
  const r = await zipRun("76258");
  const sent = r.members.flatMap((m) => m.pts);
  ok("handler: membership RPC is called once with only the widened-only points",
    r.members.length === 1 && r.members[0].zip === "76258" && sent.length === 2 &&
    sent.some((p) => p[0] === 33.38 && p[1] === -96.84) && sent.some((p) => p[0] === 33.43) && !sent.some((p) => p[0] === cLat),
    JSON.stringify(r.members));
  ok("handler: a 200 with the membership answer applied", r.status === 200);
  membersMode = "error";
  const e = await zipRun("76258");
  membersMode = "ok";
  ok("handler: membership RPC failure ⇒ still a 200 (legacy scope for that source, never an error page)", e.status === 200 && e.members.length >= 1, String(e.status));
  Deno.env.set("ZIP_SCOPE_BOUNDS_MODE", "off");
  const o = await zipRun("76258");
  ok("handler: mode off ⇒ the membership RPC is never called", o.members.length === 0 && o.rpc.length === 0, JSON.stringify(o.members));
  dentonFeatures = [];
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) Deno.exit(1);
Deno.exit(0);
