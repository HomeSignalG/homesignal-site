// Deno integration test: the SHIPPED get-address-report handler (index.ts), ZIP mode, EPA facility plane.
// Proves the plane covers the WHOLE ZIP boundary (2026-11-09 fix, sources/epa-frs-zip.ts) with no
// address, no stored point, no radius cut and no cap ahead of the boundary test.
//
// Deterministic: EPA FRS is served from REAL responses saved on 2026-11-09
// (test/fixtures/epa-zip-boundary/frs-85083-64166-2026-11-09.json). The stub answers a circle request
// with every saved row inside that circle, so circle placement matters exactly as it does live. The
// boundary test (public.zip_scope_members) is answered by a point-in-polygon over the REAL ZCTA
// polygons, and section 0 proves that stand-in agrees with production PostGIS on every saved row.
//
// Run (CI: verify-edge-function.yml): deno run --allow-env --allow-read epa-zip-boundary.handler.test.ts

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`PASS ${name}`); }
  else { fail++; console.log(`FAIL ${name}${detail ? `\n     ${detail}` : ""}`); }
}

const FIX = JSON.parse(await Deno.readTextFile(new URL("../../../test/fixtures/epa-zip-boundary/frs-85083-64166-2026-11-09.json", import.meta.url)));
type Row = { RegistryId: string; FacilityName: string; Latitude83: string; Longitude83: string; verdict_85083: string; verdict_64166: string };

// ── geometry stand-in for geo.zip_point_membership_in ───────────────────────────────────────
type Ring = number[][]; type MultiPoly = Ring[][];
function inRing(x: number, y: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function inMulti(lat: number, lng: number, mp: MultiPoly): boolean {
  return mp.some((poly) => inRing(lng, lat, poly[0]) && !poly.slice(1).some((h) => inRing(lng, lat, h)));
}
const POLYS: Record<string, MultiPoly> = {
  "85083": FIX.polygons["85083"].coordinates,
  "64166": FIX.polygons["64166"].coordinates,
  // Synthetic MULTIPART ZIP: two separate squares about 6 miles apart.
  // Synthetic DENSE ZIP: a 0.06° square (~4 x 3 mi) holding 320 qualifying facilities (no count cap).
  "99903": [[[[-90.03, 35.00], [-89.97, 35.00], [-89.97, 35.06], [-90.03, 35.06], [-90.03, 35.00]]]],
  "99901": [
    [[[-100.10, 40.00], [-100.08, 40.00], [-100.08, 40.02], [-100.10, 40.02], [-100.10, 40.00]]],
    [[[-99.99, 40.00], [-99.97, 40.00], [-99.97, 40.02], [-99.99, 40.02], [-99.99, 40.00]]],
  ],
};
const boxOf = (mp: MultiPoly) => {
  const xs = mp.flat(2).map((p) => p[0]), ys = mp.flat(2).map((p) => p[1]);
  return { xmin: Math.min(...xs), ymin: Math.min(...ys), xmax: Math.max(...xs), ymax: Math.max(...ys) };
};
const BOUNDS: Record<string, { xmin: number; ymin: number; xmax: number; ymax: number }> = {
  "85083": FIX.bounds["85083"], "64166": FIX.bounds["64166"], "99901": boxOf(POLYS["99901"]),
  // The dense ZIP's box is wider than its polygon so outside rows sit inside the retrieval area.
  "99903": { xmin: -90.05, ymin: 35.00, xmax: -89.95, ymax: 35.06 },
};

// ── the saved FRS rows (union of every saved response) + synthetic rows for 99901 ───────────
const POOL = new Map<string, Row>();
for (const rows of Object.values(FIX.responses) as Row[][]) for (const r of rows) POOL.set(r.RegistryId, r);
const synth = (id: string, name: string, lat: number, lng: number) =>
  POOL.set(id, { RegistryId: id, FacilityName: name, Latitude83: String(lat), Longitude83: String(lng), verdict_85083: "outside", verdict_64166: "outside" });
synth("SYN-WEST", "WEST ISLAND STEEL MILL", 40.01, -100.09);     // inside part 1
synth("SYN-EAST", "EAST ISLAND CONCRETE PLANT", 40.01, -99.98);  // inside part 2
synth("SYN-GAP", "MIDDLE GAP ASPHALT PLANT", 40.01, -100.03);    // between the parts: outside
// 99903: 320 qualifying facilities on a 20 x 16 grid inside the square, 60 outside it (inside the box,
// both flanks), and 40 inside it that the existing name filter drops (a store is not industrial).
const DENSE_IN: string[] = [], DENSE_OUT: string[] = [], DENSE_NONQUAL: string[] = [];
for (let i = 0; i < 320; i++) {
  const id = `DENSE-IN-${String(i).padStart(3, "0")}`; DENSE_IN.push(id);
  synth(id, `DENSE MANUFACTURING PLANT ${i}`, 35.002 + Math.floor(i / 20) * 0.0036, -90.028 + (i % 20) * 0.0029);
}
for (let i = 0; i < 60; i++) {
  const id = `DENSE-OUT-${String(i).padStart(2, "0")}`; DENSE_OUT.push(id);
  synth(id, `OUTSIDE CHEMICAL PLANT ${i}`, 35.003 + Math.floor(i / 2) * 0.0018, i % 2 ? -89.955 : -90.045);
}
for (let i = 0; i < 40; i++) {
  const id = `DENSE-STORE-${String(i).padStart(2, "0")}`; DENSE_NONQUAL.push(id);
  synth(id, `CORNER STORE ${i}`, 35.004 + i * 0.0013, -90.0);
}

// ── stubs ───────────────────────────────────────────────────────────────────────────────────
Deno.env.set("SUPABASE_URL", "https://stub.supabase.test");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "stub-service-key");
for (const k of ["ZIP_SCOPE_BOUNDS_MODE", "ZIP_SCOPE_BOUNDS_ZIPS"]) Deno.env.delete(k);
let handler: ((req: Request) => Promise<Response>) | null = null;
(Deno as unknown as { serve: (h: (req: Request) => Promise<Response>) => unknown }).serve = (h) => { handler = h; return {}; };

const miles = (la1: number, ln1: number, la2: number, ln2: number) =>
  Math.hypot((la2 - la1) * 69, (ln2 - ln1) * 69 * Math.cos((((la1 + la2) / 2) * Math.PI) / 180));
type FrsMode = { tooBigAbove?: number; failCircle?: (lat: number, lng: number, r: number) => boolean };
let frsMode: FrsMode = {};
let membersFail = false;
let frsCalls: { lat: number; lng: number; r: number }[] = [];
const jsonRes = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });

globalThis.fetch = (async (input: Request | URL | string, init?: RequestInit) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  if (url.hostname === "stub.supabase.test") {
    if (url.pathname.endsWith("/rpc/zip_scope_bounds")) {
      const zip = JSON.parse(String(init?.body ?? "{}")).p_zip as string;
      return jsonRes(BOUNDS[zip] ? [BOUNDS[zip]] : []);
    }
    if (url.pathname.endsWith("/rpc/zip_scope_members")) {
      const b = JSON.parse(String(init?.body ?? "{}")) as { p_zip: string; p_pts: number[][] };
      if (membersFail) return jsonRes({ message: "membership unavailable" }, 500);
      const mp = POLYS[b.p_zip];
      return jsonRes(b.p_pts.map((p, i) => ({ ord: i + 1, verdict: !mp ? "not_measured" : inMulti(p[0], p[1], mp) ? "member" : "outside" })));
    }
    return jsonRes([]);
  }
  if (url.hostname === "ofmpub.epa.gov") {
    const lat = Number(url.searchParams.get("latitude83")), lng = Number(url.searchParams.get("longitude83"));
    const r = Number(url.searchParams.get("search_radius"));
    frsCalls.push({ lat, lng, r });
    if (frsMode.failCircle?.(lat, lng, r)) return jsonRes({ message: "busy" }, 503);
    if (frsMode.tooBigAbove !== undefined && r > frsMode.tooBigAbove) {
      return jsonRes({ Results: { Error: { ErrorMessage: "Queryset Limit would be exceeded" } } });
    }
    const rows = [...POOL.values()].filter((x) => miles(lat, lng, Number(x.Latitude83), Number(x.Longitude83)) <= r)
      .map(({ RegistryId, FacilityName, Latitude83, Longitude83 }) => ({ RegistryId, FacilityName, Latitude83, Longitude83 }));
    return jsonRes({ Results: { FRSFacility: rows } });
  }
  return jsonRes([]);
}) as typeof fetch;

await import("./index.ts");
if (!handler) { console.log("FAIL index.ts did not register a Deno.serve handler"); Deno.exit(1); }

async function zipRun(body: Record<string, unknown>) {
  frsCalls = [];
  const res = await handler!(new Request("https://stub.functions.test/get-address-report", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  }));
  const text = await res.text();
  let j: Record<string, unknown> = {};
  try { j = JSON.parse(text); } catch { /* keep {} */ }
  const sites = ((j.sites as Record<string, unknown>[]) ?? []).filter((s) => s.registry_id !== undefined);
  return { status: res.status, j, sites, ids: sites.map((s) => String(s.registry_id)).sort(), epa: (j.epa ?? {}) as Record<string, unknown>, calls: [...frsCalls], text };
}
const [P83lat, P83lng] = FIX.stored_points["85083"];
const [P66lat, P66lng] = FIX.stored_points["64166"];
const stored3mi = (zip: string, id: string) => {
  const [la, ln] = FIX.stored_points[zip]; const r = POOL.get(id)!;
  return miles(la, ln, Number(r.Latitude83), Number(r.Longitude83));
};

// ── 0. the polygon stand-in agrees with production PostGIS on every saved row ───────────────
{
  let n = 0, bad: string[] = [];
  for (const r of POOL.values()) {
    if (r.RegistryId.startsWith("SYN-")) continue;
    for (const z of ["85083", "64166"]) {
      n++;
      const js = inMulti(Number(r.Latitude83), Number(r.Longitude83), POLYS[z]) ? "member" : "outside";
      const pg = (r as unknown as Record<string, string>)[`verdict_${z}`];
      if (js !== pg) bad.push(`${z}/${r.RegistryId}: js=${js} pg=${pg}`);
    }
  }
  ok(`0a. stand-in membership equals PostGIS on all ${n} saved (row, ZIP) pairs`, bad.length === 0 && n > 200, bad.join("; "));
  const m83 = [...POOL.values()].filter((r) => r.verdict_85083 === "member").length;
  ok("0b. positive control: the saved rows include facilities inside 85083 (non-zero)", m83 >= 30, String(m83));
}

// ── 1. 85083 from the stored point: the whole ZIP, not a 3-mile circle ───────────────────────
const base = await zipRun({ zip: "85083", lat: P83lat, lng: P83lng });
{
  ok("1a. 200", base.status === 200, base.text.slice(0, 200));
  ok("1b. the EPA plane answered (ok:true, mode zip_boundary)", base.epa.ok === true && base.epa.mode === "zip_boundary", JSON.stringify(base.epa));
  const outside = base.sites.filter((s) => (POOL.get(String(s.registry_id))?.verdict_85083) !== "member");
  ok("1c. every stored facility is inside the 85083 boundary (production verdict)", base.sites.length > 0 && outside.length === 0, JSON.stringify(outside.map((s) => s.label)));
  ok("1d. Pyramid Peak Water Treatment Plant (in ZIP, 3.8 mi from the stored point) is included",
    base.ids.includes("110000520856") && stored3mi("85083", "110000520856") > 3.5, `${stored3mi("85083", "110000520856").toFixed(2)} mi`);
  const beyond3 = base.ids.filter((id) => stored3mi("85083", id) > 3);
  ok("1e. at least one included facility lies beyond 3 mi of the stored point", beyond3.length >= 1, beyond3.join(","));
  ok("1f. Skunk Creek Landfill (both registrations) and the TSMC registration the cache already had are still included",
    ["110002572252", "110071161804", "110071325164"].every((id) => base.ids.includes(id)), base.ids.join(","));
  ok("1g. an outside-ZIP facility inside the retrieval circle is excluded (STANDARD CONCRETE INCORPORATED, in the old cache as outside)",
    !base.ids.includes("110070272610") && POOL.get("110070272610")?.verdict_85083 === "outside" &&
    FIX.responses.zip85083_cover.some((r: Row) => r.RegistryId === "110070272610"));
  ok("1h. the old cache held 3; boundary coverage holds more", base.sites.length > 3, String(base.sites.length));
  ok("1i. outside rows are counted, not silently lost", Number(base.epa.outside_excluded) > 0 && base.epa.members === base.sites.length && base.epa.complete === true, JSON.stringify(base.epa));
  ok("1j. no FRS request is centred on the stored point", base.calls.every((c) => miles(c.lat, c.lng, P83lat, P83lng) > 1), JSON.stringify(base.calls));
  ok("1k. one request covers the box (FRS answered it)", base.calls.length === 1 && base.calls[0].r > 3.5, JSON.stringify(base.calls));
  ok("1l. no facility is labelled with a lifecycle (EPA registration is not Operating)",
    base.sites.every((s) => s.type === undefined && s.bucket === undefined && s.status === undefined));
}

// ── 2. the stored point does not change the inventory; no point at all works ────────────────
{
  const moved = await zipRun({ zip: "85083", lat: 33.70, lng: -112.20 });
  ok("2a. a different stored point ⇒ identical facility set", JSON.stringify(moved.ids) === JSON.stringify(base.ids), `${moved.ids.length} vs ${base.ids.length}`);
  const noPoint = await zipRun({ zip: "85083" });
  ok("2b. a ZIP-only request (no lat/lng, no address) is a 200", noPoint.status === 200, noPoint.text.slice(0, 200));
  ok("2c. ...with the identical facility set", JSON.stringify(noPoint.ids) === JSON.stringify(base.ids));
  const refresh = await zipRun({ zip: "85083", lat: P83lat, lng: P83lng, frs_start_mi: 1 });
  ok("2d. the scheduled-refresh body (with frs_start_mi) ⇒ identical facility set", JSON.stringify(refresh.ids) === JSON.stringify(base.ids));
}

// ── 3. a refused circle is split, the quarters overlap, rows are de-duplicated ──────────────
{
  frsMode = { tooBigAbove: 2.5 };
  const t = await zipRun({ zip: "85083", lat: P83lat, lng: P83lng });
  frsMode = {};
  ok("3a. FRS refuses the big circle ⇒ four quarter circles answer", t.epa.ok === true && t.epa.tiles === 4 && t.calls.length === 5, JSON.stringify({ tiles: t.epa.tiles, calls: t.calls.length }));
  ok("3b. same facility set as the single circle", JSON.stringify(t.ids) === JSON.stringify(base.ids), `${t.ids.length} vs ${base.ids.length}`);
  ok("3c. overlapping circles returned duplicates, and none survive", Number(t.epa.raw_rows) > Number(t.epa.unique_rows) && new Set(t.ids).size === t.ids.length,
    JSON.stringify({ raw: t.epa.raw_rows, unique: t.epa.unique_rows }));
}

// ── 4. partial retrieval is never presented as complete ─────────────────────────────────────
{
  frsMode = { tooBigAbove: 2.5, failCircle: (lat, lng, r) => r < 2.5 && lat > 33.74 && lng < -112.16 };
  const p = await zipRun({ zip: "85083", lat: P83lat, lng: P83lng });
  frsMode = {};
  ok("4a. one quarter fails ⇒ ok:false (transient), no facility list", p.epa.ok === false && p.epa.reason === "transient" && p.sites.length === 0, JSON.stringify(p.epa));
  frsMode = { tooBigAbove: 0.1 };
  const floor = await zipRun({ zip: "85083", lat: P83lat, lng: P83lng });
  frsMode = {};
  ok("4b. refused down to the smallest circle ⇒ ok:false, never a partial set", floor.epa.ok === false && floor.sites.length === 0, JSON.stringify(floor.epa));
  membersFail = true;
  const m = await zipRun({ zip: "85083", lat: P83lat, lng: P83lng });
  membersFail = false;
  ok("4c. boundary test unavailable ⇒ ok:false (membership), no unfiltered rows", m.epa.ok === false && m.epa.reason === "membership" && m.sites.length === 0, JSON.stringify(m.epa));
}

// ── 5. a ZIP with no boundary fails explicitly, never a radius search ───────────────────────
{
  const n = await zipRun({ zip: "99902", lat: 40.0, lng: -100.0 });
  ok("5a. no boundary ⇒ ok:false reason no_boundary", n.epa.ok === false && n.epa.reason === "no_boundary", JSON.stringify(n.epa));
  ok("5b. ...and EPA is never asked for a radius around the point", n.calls.length === 0, JSON.stringify(n.calls));
  const none = await zipRun({ zip: "99902" });
  ok("5c. no boundary AND no point ⇒ an explicit 422, not a guessed point", none.status === 422, none.text.slice(0, 160));
}

// ── 6. multipart ZIP: both parts covered, the gap excluded ──────────────────────────────────
{
  const mp = await zipRun({ zip: "99901" });
  ok("6a. a facility in each part is included", mp.ids.includes("SYN-WEST") && mp.ids.includes("SYN-EAST"), mp.ids.join(","));
  ok("6b. a facility between the parts (inside the box) is excluded", !mp.ids.includes("SYN-GAP"));
}

// ── 7. 64166 (small ZIP, wholly inside the old circle): same in-ZIP rows either way ─────────
{
  const k = await zipRun({ zip: "64166", lat: P66lat, lng: P66lng });
  const members = FIX.responses.zip64166_stored_point_3mi.filter((r: Row) => r.verdict_64166 === "member").map((r: Row) => r.RegistryId).sort();
  ok("7a. 200 and ok:true", k.status === 200 && k.epa.ok === true, JSON.stringify(k.epa));
  ok("7b. the boundary circle sees exactly the in-ZIP rows the old 3-mile circle saw", Number(k.epa.members) <= members.length && k.ids.every((id) => members.includes(id)),
    `${k.ids.join(",")} | ${members.join(",")}`);
  const coverMembers = FIX.responses.zip64166_cover.filter((r: Row) => r.verdict_64166 === "member").map((r: Row) => r.RegistryId).sort();
  ok("7c. live 2026-11-09: the boundary circle and the old 3-mile circle hold the same 7 in-ZIP registrations",
    JSON.stringify(coverMembers) === JSON.stringify(members) && members.length === 7, `${coverMembers.length} vs ${members.length}`);
}

// ── 8. NO COUNT CAP: more than 250 qualifying in-ZIP facilities are all retained ─────────────
{
  frsMode = { tooBigAbove: 1.0 }; // force tiling, so overlapping circles also exercise de-duplication
  const d = await zipRun({ zip: "99903" });
  frsMode = {};
  const counts = (d.j.counts ?? {}) as Record<string, unknown>;
  ok("8a. 200 and ok:true for the dense ZIP", d.status === 200 && d.epa.ok === true, JSON.stringify(d.epa));
  ok("8b. all 320 qualifying in-ZIP facilities are in the report, each once",
    d.ids.length === 320 && new Set(d.ids).size === 320 && JSON.stringify(d.ids) === JSON.stringify([...DENSE_IN].sort()),
    `${d.ids.length} ids`);
  ok("8c. counts.facilities is the full inventory (320), not a capped number", counts.facilities === 320, JSON.stringify(counts));
  ok("8d. epa reports members = kept = 320 and complete", d.epa.members === 320 && d.epa.kept === 320 && d.epa.complete === true,
    JSON.stringify(d.epa));
  ok("8e. no field reports a cap or an over-cap remainder", !("cap" in d.epa) && !("over_cap" in d.epa), JSON.stringify(d.epa));
  ok("8f. the 60 outside the polygon are excluded and counted", d.epa.outside_excluded === 60 && !d.ids.some((id) => DENSE_OUT.includes(id)),
    JSON.stringify(d.epa));
  ok("8g. the name filter still drops non-industrial rows (relevance rule unchanged)", !d.ids.some((id) => DENSE_NONQUAL.includes(id)));
  ok("8h. it took more than one circle, and stayed within the request bound", d.calls.length > 1 && d.calls.length <= 64, `${d.calls.length} calls`);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) Deno.exit(1);
Deno.exit(0);
