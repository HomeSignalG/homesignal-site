import { countyCasesForZip } from "../supabase/functions/get-address-report/sources/county-cases.ts";
import fs from "node:fs";
const reg = JSON.parse(fs.readFileSync("supabase/functions/get-address-report/jurisdiction-registry.json", "utf8"));
const entry = reg.county_cases[0];
const log = [];
const f = async (u, o) => { log.push(u); return fetch(u, o); };
// ZIP polygon is not reachable from a runner: every verified pin is printed so ZIP membership is checked afterwards, read-only, against the canonical polygon.
const MEMBERS = new Set(fs.existsSync("scripts/_members.json") ? JSON.parse(fs.readFileSync("scripts/_members.json", "utf8")) : []);
const seen = [];
const r = await countyCasesForZip("97149", [{ state: "OR", county: "Tillamook" }], [entry], {
  fetch: f, today: new Date(),
  zipMembers: async (pts) => { for (const p of pts) seen.push(p); return pts.map((p) => (MEMBERS.has(p[0] + "," + p[1]) ? "member" : "outside")); },
});
console.log("POINTS", JSON.stringify(seen.map((p) => p[0] + "," + p[1])));
const R = r.reports[0];
console.log("REPORT", JSON.stringify(R));
for (const s of r.sites) console.log("PIN", JSON.stringify({ case: s.case_number, related: s.related_cases, title: s.title, type_raw: s.type_raw, use_type: s.use_type, bucket: s.bucket, status: s.status_raw, file_date: s.file_date, lat: s.lat, lng: s.lng, parcels: [s.parcels_matched, s.parcels_named], url: s.record_url, scope: String(s.scope_text).slice(0, 200), hist: String(s.status_history).slice(0, 160) }));
console.log("REQUESTS", log.length);
