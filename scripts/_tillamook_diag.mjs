import { parseCaseIndex, taxlotKeys, pinFromParcels } from "../supabase/functions/get-address-report/sources/county-cases.ts";
import fs from "node:fs";
const reg = JSON.parse(fs.readFileSync("supabase/functions/get-address-report/jurisdiction-registry.json", "utf8"));
const find = (o) => { if (o && typeof o === "object") { if (o.registry_id === "tillamook-county-land-use-cases") return o; for (const v of Object.values(o)) { const x = find(v); if (x) return x; } } };
const e = find(reg);
const UA = { "user-agent": "HomeSignal/1.0 (+https://jodytracks.com)" };
const txt = (h) => h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const html = await (await fetch(e.index_url, { headers: UA })).text();
const rows = parseCaseIndex(html, e.index_url);
console.log("INDEX_ROWS", rows.length);
const sig = e.significant_if.map((p) => new RegExp(p, "i")), rt = e.routine_if.map((p) => new RegExp(p, "i"));
let nSig = 0, nRoutine = 0, nNeither = 0;
const sigRows = [];
for (const c of rows) {
  const hay = `${c.type} ${c.request}`;
  const s = sig.some((r) => r.test(hay)), r = rt.some((r) => r.test(hay));
  if (s && r) nRoutine++; else if (s) { nSig++; sigRows.push(c); } else nNeither++;
}
console.log("CLASS significant_and_not_routine", nSig, "significant_but_routine_pattern", nRoutine, "no_significance_pattern", nNeither);
const targets = ["851-26-000190-PLNG", "851-25-000549-PLNG", "851-25-000548-PLNG", "851-23-000219-PLNG"];
for (const t of targets) {
  const c = rows.find((x) => x.case_ids.includes(t));
  console.log("TARGET", t, c ? "FOUND" : "NOT_IN_INDEX");
  if (!c) continue;
  const hay = `${c.type} ${c.request}`;
  console.log(JSON.stringify({ ids: c.case_ids, url: c.url, type: c.type, status: c.status, sig: sig.some((r) => r.test(hay)), routine: rt.filter((r) => r.test(hay)).map(String), keys: taxlotKeys(c.request) }));
  console.log("REQUEST", c.request);
}
console.log("SIGNIFICANT_ROWS");
for (const c of sigRows) console.log(JSON.stringify({ id: c.case_ids[0], type: c.type, status: c.status, keys: (taxlotKeys(c.request) || []).length, req: c.request.slice(0, 220) }));

const lotSentence = (r) => { const m = r.match(/.{0,60}Tax\s*Lots?.{0,260}/i); return m ? m[0] : r.slice(-200); };
const sah = rows.find((x) => x.case_ids.includes("851-25-000549-PLNG"));
console.log("SAHHALI_FULL_REQUEST_TAIL", JSON.stringify(sah.request.slice(200)));
console.log("QUARANTINE_CANDIDATES");
for (const c of sigRows) {
  if (!/Planning Commission Hearing|Board of Commissioners Hearing|Notice of Application|Public Notice|Pending|Under Review/i.test(c.status)) continue;
  if (taxlotKeys(c.request)) continue;
  console.log(JSON.stringify({ id: c.case_ids[0], type: c.type, status: c.status, lots: lotSentence(c.request) }));
}
// parcel centroids for every keyed candidate in a mapped status
const cand = sigRows.filter((c) => /Planning Commission Hearing|Board of Commissioners Hearing|Notice of Application|Public Notice|Pending|Under Review/i.test(c.status) && taxlotKeys(c.request));
const ak = [...new Set(cand.flatMap((c) => taxlotKeys(c.request)))];
const wh = `${e.parcel_key_field} IN (${ak.map((k) => `'${k}'`).join(",")})`;
const jj = await (await fetch(`${e.parcel_url}/query?where=${encodeURIComponent(wh)}&outFields=${e.parcel_key_field}&returnGeometry=true&returnCentroid=true&outSR=4326&f=json`)).json();
const cm = new Map((jj.features || []).map((f) => [f.attributes[e.parcel_key_field], f.centroid]));
for (const c of cand) {
  const ks = taxlotKeys(c.request);
  console.log("CAND", JSON.stringify({ id: c.case_ids[0], type: c.type, keys: ks, centroids: ks.map((k) => cm.get(k) ? [cm.get(k).y, cm.get(k).x] : null), req: c.request.slice(0, 260) }));
}
// diag3
{
  await new Promise((r) => setTimeout(r, 10500));
  const pg = txt(await (await fetch("https://www.tillamookcounty.gov/1139/851-25-000549-plng851-25-000548-plng", { headers: UA })).text());
  const i = pg.indexOf("851-25-000549-PLNG:");
  console.log("SAHHALI_PAGE_REQUEST", pg.slice(i, i + 1500));
  const s2 = await (await fetch(`${e.parcel_url}/query?where=${encodeURIComponent("MapTaxlot LIKE '1S09%'")}&outFields=MapTaxlot&returnGeometry=false&resultRecordCount=3&f=json`)).json();
  console.log("KEY_FORMAT_R9", JSON.stringify((s2.features || []).map((f) => f.attributes.MapTaxlot)));
  const s3 = await (await fetch(`${e.parcel_url}/query?where=${encodeURIComponent("MapTaxlot LIKE '1S926%'")}&outFields=MapTaxlot&returnGeometry=false&resultRecordCount=3&f=json`)).json();
  console.log("KEY_FORMAT_R9_UNPADDED_MATCHES", (s3.features || []).length);
  const g = await (await fetch(`${e.parcel_url}/query?where=${encodeURIComponent("MapTaxlot IN ('5S11130000202','5S1113DC05700')")}&outFields=MapTaxlot&returnGeometry=true&outSR=4326&f=json`)).json();
  for (const f of g.features || []) console.log("PARCEL_RINGS", f.attributes.MapTaxlot, JSON.stringify(f.geometry.rings.map((r) => r.map((p) => [Math.round(p[0]*1e5)/1e5, Math.round(p[1]*1e5)/1e5]))).slice(0, 2500));
}
