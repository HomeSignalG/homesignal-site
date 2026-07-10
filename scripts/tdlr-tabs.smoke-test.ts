// Smoke test with a SYNTHETIC fixture mimicking the TABS page structure seen in the
// screenshots. Real fixtures are Step 0 — this only proves the parsing/normalize logic.
import { parseProjectHtml, mapStatus, classifyLayer, entitiesFrom, recordUrl } from "../supabase/functions/get-address-report/sources/tdlr-tabs";

const fixture = `
<html><body><div>
<h1>Texas Department of Licensing and Regulation</h1>
<h2>Architectural Barriers Project Details Page</h2>
<p>Project #: TABS2024022676</p><p>Registration Date: 7/10/2024</p>
<div>PROJECT</div>
<table>
<tr><td>Project Name:</td><td>ATX1 New Construction</td></tr>
<tr><td>Project Number:</td><td>TABS2024022676</td></tr>
<tr><td>Facility Name:</td><td>ATX1</td></tr>
<tr><td>Location Address:</td><td>2200 Caldwell Lane<br>Del Valle, TX 78617</td></tr>
<tr><td>Location County:</td><td>Travis</td></tr>
<tr><td>Start Date:</td><td>7/15/2024</td></tr>
<tr><td>Completion Date:</td><td>5/31/2025</td></tr>
<tr><td>Estimated Cost:</td><td>$14,700,000</td></tr>
<tr><td>Type of Work:</td><td>New Construction</td></tr>
<tr><td>Scope of Work:</td><td>This project is privately funded, on private land for private use.</td></tr>
<tr><td>Current Status:</td><td>Inspection Complete</td></tr>
</table>
<div>PERSON FILING FORM</div>
<table>
<tr><td>Contact Name:</td><td>Brian Conklin</td></tr>
</table>
<div>OWNER</div>
<table>
<tr><td>Owner Name:</td><td>Neuralink</td></tr>
<tr><td>Owner Address:</td><td>2200 Caldwell Lane<br>Del Valle, Texas 78617</td></tr>
<tr><td>Owner Phone:</td><td>(813) 758-6679</td></tr>
<tr><td>Contact Name:</td><td>Scott Padilla</td></tr>
</table>
<div>TENANT</div><p>Not Assigned</p>
<div>DESIGN FIRM</div>
<table>
<tr><td>Design Firm Name:</td><td>Studio8 Architects</td></tr>
<tr><td>Design Firm Address:</td><td>1608 West 5th Street Suite 100<br>Austin, TX</td></tr>
<tr><td>Design Firm Phone:</td><td>(845) 339-0001</td></tr>
</table>
</div></body></html>`;

const parsed = parseProjectHtml(fixture, "TABS2024022676");
if ("error" in parsed) throw new Error("parse failed: " + parsed.error);
console.log(JSON.stringify(parsed, null, 2));

// assertions
const eq = (a: unknown, b: unknown, what: string) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`FAIL ${what}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
  console.log("  ok", what);
};
eq(parsed.project_name, "ATX1 New Construction", "project_name");
eq(parsed.owner, "Neuralink", "owner");
eq(parsed.owner_phone, "(813) 758-6679", "owner_phone");
eq(parsed.contact_name, "Scott Padilla", "contact_name");
eq(parsed.filed_by, "Brian Conklin", "filed_by (PERSON FILING FORM fenced from OWNER)");
eq(parsed.design_firm, "Studio8 Architects", "design_firm");
eq(parsed.est_cost, 14700000, "est_cost");
eq(parsed.start_date, "2024-07-15", "start_date");
eq(parsed.end_date, "2025-05-31", "end_date");
eq(parsed.location_county, "Travis", "location_county");
eq(mapStatus(parsed.status_text, parsed.end_date), "built", "status→built (Inspection Complete)");
eq(mapStatus("Registered", "2027-01-01"), "approved", "status→approved (active)");
eq(classifyLayer("fully sprinklered barn for animal holding & 740sf Mezzanine"), "animal-facility", "layer barn");
eq(classifyLayer("1 story, 7500sf Lab, storage, office, mechanical & gas storage"), "research", "layer lab");

// entity extraction + shared-phone smoke test
const siteA: any = { record_url: recordUrl("TABS2024022676"), owner: "Neuralink", owner_phone_norm: "8137586679", contact_name: "Scott Padilla", design_firm: "Studio8 Architects", design_firm_phone_norm: "8453390001" };
const siteB: any = { record_url: recordUrl("TABS2024016698"), owner: "River Bottoms Ranch LLC", owner_phone_norm: "8137586679" };
const rows = [...entitiesFrom(siteA), ...entitiesFrom(siteB)];
const byPhone: Record<string, Set<string>> = {};
for (const r of rows) if (r.phone_norm && r.kind === "owner") (byPhone[r.phone_norm] ??= new Set()).add(r.record_url);
const link = byPhone["8137586679"];
if (!link || link.size < 2) throw new Error("FAIL entity link: expected >=2 record_urls on shared phone");
console.log("  ok entity link 8137586679 →", [...link].join(" + "));
console.log("\nALL SMOKE TESTS PASS");
