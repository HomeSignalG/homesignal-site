// Step-0 acceptance driver: run parseProjectHtml() against the REAL fixtures under
// fixtures/tabs/ and compare against the runbook §2 acceptance table. The table values
// are leads transcribed from the source video — THE FIXTURE PARSE IS THE FACT. A
// mismatch is reported; the parsed (live-page) value wins, never "corrected" to match.
import { readFileSync, readdirSync } from "node:fs";
import {
  parseProjectHtml, mapStatus, classifyLayer, entitiesFrom, recordUrl,
} from "../supabase/functions/get-address-report/sources/tdlr-tabs";

const FIX_DIR = new URL("../fixtures/tabs", import.meta.url).pathname;

// runbook §2 acceptance, corrected to FIXTURE-VERIFIED values (fetched 2026-07-10;
// the runbook says its values are leads from the video — the fixture parse is the
// acceptance test). Deviations from the leads are annotated in the final report.
// undefined = the live page states nothing → field must be ABSENT.
const EXPECT: Record<string, any> = {
  TABS2023006483: { type: "built", layer: "research", owner: "River Bottoms Ranch", owner_phone_norm: "8137589100", contact_name: "Scott Padilla", filed_by: "Jeff Gutknecht", design_firm: "Emersion Design", est_cost: 2000000, sqft: 7500 },
  TABS2023006449: { type: "built", layer: "animal-facility", owner: "River Bottoms Ranch LLC", owner_phone_norm: "8137586679", contact_name: undefined, filed_by: "Jeff Gutknecht", design_firm: "Emersion Design", est_cost: 2000000, sqft: 14200 },
  TABS2024016698: { type: "built", layer: "commercial", owner: "RIVER BOTTOMS RANCH LLC", owner_phone_norm: "8137586679", contact_name: undefined, filed_by: "Jeff Gutknecht", design_firm: "Emersion Design LLC", est_cost: 1000000, sqft: 3410 },
  TABS2024022676: { type: "built", layer: ["industrial", "development"], owner: "Neuralink", owner_phone_norm: "8137586679", contact_name: "Scott Padilla", filed_by: "Brian Conklin", design_firm: "Studio8 Architects", est_cost: 14700000, sqft: 112000 },
  TABS2026011928: { type: "approved", layer: "commercial", owner: "Neuralink Corporation", owner_phone_norm: "7078031177", contact_name: "Kristin Lorentzen", filed_by: "Kristin Lorentzen", design_firm: "Neuralink", est_cost: 8200000, sqft: 37607 },
};

const digits = (v?: string) => (v || "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");

const files = readdirSync(FIX_DIR).filter((f) => f.endsWith(".html")).sort();
console.log(`fixtures found: ${files.join(", ")}\n`);

let pass = 0, fail = 0;
const allSites: any[] = [];

for (const f of files) {
  const no = f.replace(".html", "");
  const html = readFileSync(`${FIX_DIR}/${f}`, "utf8");
  const parsed = parseProjectHtml(html, no);
  console.log(`\n═══ ${no} ═══`);
  if ("error" in parsed) { console.log(`  PARSE ERROR: ${parsed.error}`); fail++; continue; }
  console.log(JSON.stringify(parsed, null, 2));

  const derived = {
    type: mapStatus(parsed.status_text, parsed.end_date),
    layer: classifyLayer(parsed.scope_text, parsed.project_name),
    owner: parsed.owner,
    owner_phone_norm: parsed.owner_phone ? digits(parsed.owner_phone) : undefined,
    contact_name: parsed.contact_name,
    filed_by: parsed.filed_by,
    design_firm: parsed.design_firm,
    est_cost: parsed.est_cost,
    sqft: parsed.sqft,
  };
  console.log("derived:", JSON.stringify(derived));

  const exp = EXPECT[no];
  if (!exp) { console.log("  (no expectation row — skipping compare)"); continue; }
  let ok = true;
  for (const [k, want] of Object.entries(exp)) {
    const got = (derived as any)[k];
    const match = Array.isArray(want) ? want.includes(got) : JSON.stringify(got) === JSON.stringify(want);
    if (!match) { ok = false; console.log(`  ✗ ${k}: parsed=${JSON.stringify(got)} lead=${JSON.stringify(want)}`); }
    else console.log(`  ✓ ${k} = ${JSON.stringify(got)}`);
  }
  ok ? pass++ : fail++;

  // build a pseudo-site for the entity pass (no geocode here — parse-level only)
  const site: any = { record_url: recordUrl(no), project_no: no };
  if (parsed.owner) site.owner = parsed.owner;
  if (parsed.owner_phone) site.owner_phone_norm = digits(parsed.owner_phone);
  if (parsed.contact_name) site.contact_name = parsed.contact_name;
  if (parsed.design_firm) site.design_firm = parsed.design_firm;
  if (parsed.design_firm_phone) site.design_firm_phone_norm = digits(parsed.design_firm_phone);
  allSites.push(site);
}

// entity-link check over REAL parsed data: owners sharing a phone across ≥2 records
console.log("\n═══ entity-link check (real fixtures) ═══");
const rows = allSites.flatMap((s) => entitiesFrom(s));
const byPhone: Record<string, { names: Set<string>; urls: Set<string> }> = {};
for (const r of rows) {
  if (!r.phone_norm || r.kind !== "owner") continue;
  (byPhone[r.phone_norm] ??= { names: new Set(), urls: new Set() });
  byPhone[r.phone_norm].names.add(r.name);
  byPhone[r.phone_norm].urls.add(r.record_url);
}
for (const [ph, g] of Object.entries(byPhone)) {
  if (g.urls.size >= 2) console.log(`  shared phone ${ph}: ${[...g.names].join(" ↔ ")}\n    evidence: ${[...g.urls].join("\n              ")}`);
}
const link = byPhone["8137586679"];
console.log(link && link.urls.size >= 2 && link.names.size >= 2
  ? "  ✓ River Bottoms Ranch LLC ↔ Neuralink link established (≥2 record_urls)"
  : "  ✗ expected shared-phone link 8137586679 NOT established");

console.log(`\nRESULT: ${pass} pass / ${fail} fail of ${files.length} fixtures`);
process.exit(fail ? 1 : 0);
