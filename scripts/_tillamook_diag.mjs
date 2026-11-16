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
// case pages for targets (crawl delay 10 s)
for (const t of targets) {
  const c = rows.find((x) => x.case_ids.includes(t)); if (!c) continue;
  await new Promise((r) => setTimeout(r, 10500));
  const p = txt(await (await fetch(c.url, { headers: UA })).text());
  console.log("PAGE", t, p.slice(0, 3000));
}
// parcel lookup for the Sahhali lots as the county text states them
const keys = ["5S1124AB01300","5S1124AB01301","5S1124AB01400","5S1124AB01500","5S1124AB01600","5S1124AB01700","5S1124AB01800","5S1124AB01900","5S1124AB04600","5S1124AB04700","5S1124AB04800","5S1124AB04801","5S1124AB05900"];
const where = `${e.parcel_key_field} IN (${keys.map((k) => `'${k}'`).join(",")})`;
const q = `${e.parcel_url}/query?where=${encodeURIComponent(where)}&outFields=${e.parcel_key_field}&returnGeometry=false&f=json`;
const j = await (await fetch(q)).json();
console.log("SAHHALI_LOTS_RESOLVED", (j.features || []).map((f) => f.attributes[e.parcel_key_field]).sort().join(","));
