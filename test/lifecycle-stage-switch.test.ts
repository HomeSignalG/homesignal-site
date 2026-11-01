// The per-source stage switch (docs/lifecycle-classification-audit-2026-11-01.md §6 step 3).
// Run: node test/lifecycle-stage-switch.test.ts
//
// 1. OFF is byte-identical: for EVERY registry entry, statusLookupFor(entry) equals the old
//    buildBucketLookup(status_to_bucket) exactly.
// 2. Nothing is switched on: no registry entry carries stage_model (release gate §10).
// 3. ON follows the founder decisions through the one stage-to-column rule, and fails closed.
// 4. All five connectors use the one lookup and attach the stage fields only when switched on.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { statusLookupFor, buildBucketLookup, resolveNormalized } from "../supabase/functions/get-address-report/sources/socrata.ts";
import { stageFieldsFor, validateStageModel } from "../supabase/functions/get-address-report/sources/lifecycle-stage.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
let failures = 0;
const ok = (c: boolean, name: string, detail?: unknown) => {
  if (c) console.log("PASS — " + name);
  else { failures++; console.error("FAIL — " + name + (detail !== undefined ? "  [" + JSON.stringify(detail) + "]" : "")); }
};
// deno-lint-ignore no-explicit-any
const asObj = (lk: any) => JSON.stringify({ e: [...lk.exact].sort(), f: [...lk.folded].sort(), o: [...lk.origin].sort() });

// ── 1 + 2. Every real entry, switch off ─────────────────────────────────────────────
const reg = JSON.parse(readFileSync(join(root, "supabase/functions/get-address-report/jurisdiction-registry.json"), "utf8"));
let compared = 0, differ: string[] = [], switched: string[] = [];
for (const p of ["socrata", "arcgis", "ckan", "csv", "carto"]) for (const e of reg[p] || []) {
  if (e.stage_model !== undefined || e.status_to_stage || e.status_to_activity) switched.push(e.registry_id);
  let a: string, b: string;
  try { a = asObj(statusLookupFor(e)); } catch (x) { a = "THROW " + (x as Error).message; }
  try { b = asObj(buildBucketLookup(e.status_to_bucket, e.registry_id)); } catch (x) { b = "THROW " + (x as Error).message; }
  compared++;
  if (a !== b) differ.push(e.registry_id);
}
ok(compared > 200, "1a: every registry entry compared (control)", compared);
ok(differ.length === 0, "1b: with the switch off, statusLookupFor equals buildBucketLookup for every entry", differ.slice(0, 5));
ok(switched.length === 0, "2: no registry entry is switched on (release gate)", switched);

// ── 3. Switch on, synthetic entries ─────────────────────────────────────────────────
const base = {
  registry_id: "synthetic-zoning", stage_model: true, record_class: "zoning_change",
  status_to_bucket: { proposed: ["In Review"], operating: ["Closed"], withdrawn: ["Withdrawn"], exclude: ["On Hold", "Aborted", "Test"] },
  status_to_stage: { "In Review": "under_review", "Closed": "closed_unspecified", "Test": "invalid_record" },
  status_to_activity: {
    "Withdrawn": { activity: "inactive", category: "withdrawn", term_stage: "filed", receipt: "agency glossary p.3" },
    "On Hold": { activity: "paused", receipt: "agency glossary p.3" },
    "Aborted": { activity: "undetermined" },
  },
  inactive_date_column: "withdrawn_on",
};
const lk = statusLookupFor(base);
const b = (s: string) => resolveNormalized(lk, s).value;
ok(b("In Review") === "proposed", "3a: under review is Proposed");
ok(b("Closed") === ("unknown" as never), "3b: D5 — Closed is Lifecycle unknown, not Operating");
ok(b("Test") === "exclude", "3c: invalid_record is not shown");
ok(b("Withdrawn") === "proposed", "3d: a withdrawn filing keeps its historical column (term rung: filed)");
ok(b("On Hold") === ("unknown" as never), "3e: a paused record with no stage evidence is Lifecycle unknown, not dropped");
ok(b("Aborted") === ("unknown" as never), "3f: D8 — an undocumented term is never cancelled");

const rc = (row: Record<string, unknown>) => (c: string | string[]) => row[c as string];
const today = "2026-11-01";
const fW = stageFieldsFor(base as never, "Withdrawn", rc({ withdrawn_on: "2026-03-12" }), today, "2026-01-05");
ok(!!fW && fW.activity === "inactive" && fW.inactive_category === "withdrawn" && fW.activity_term === "Withdrawn"
  && fW.activity_effective_date === "2026-03-12" && fW.lifecycle_stage === "filed" && fW.lifecycle_stage_basis === "term",
  "3g: withdrawn fields carry the term, category, verified date and evidence basis", fW);
const fFuture = stageFieldsFor(base as never, "Withdrawn", rc({ withdrawn_on: "2027-03-12" }), today, null);
ok(fFuture?.activity_effective_date === null, "3h: a future date is not verified");
const fBefore = stageFieldsFor(base as never, "Withdrawn", rc({ withdrawn_on: "2025-12-01" }), today, "2026-01-05");
ok(fBefore?.activity_effective_date === null, "3i: a date before the record's own date is not verified");
const fA = stageFieldsFor(base as never, "Aborted", rc({ withdrawn_on: "2026-03-12" }), today, null);
ok(fA?.activity === "undetermined" && fA.inactive_category === null && fA.activity_effective_date === null,
  "3j: undetermined gets no category and no date", fA);
const fR = stageFieldsFor(base as never, "In Review", rc({}), today, null);
ok(fR?.activity === "active" && fR.lifecycle_stage === "under_review", "3k: an active status is active with its stage");

// A completion on a zoning record never reaches Operating (entitlement class).
const op = statusLookupFor({ ...base, registry_id: "synthetic-zoning-2", status_to_bucket: { operating: ["Done"] },
  status_to_stage: { Done: "operation_established" }, status_to_activity: {} });
ok(resolveNormalized(op, "Done").value === ("unknown" as never), "3l: operation on an entitlement record is not Operating");

// Fail closed.
const throws = (e: unknown, name: string, re: RegExp) => {
  let msg = "";
  try { statusLookupFor(e as never); } catch (x) { msg = (x as Error).message; }
  ok(re.test(msg), name, msg || "did not throw");
};
throws({ ...base, record_class: "parking_lot" }, "3m: an unknown record class is refused", /record_class/);
throws({ ...base, status_to_stage: { "In Review": "under_review", "Test": "invalid_record" } }, "3n: a status mapped today but undeclared is refused (no silent drop)", /Closed.*not declared/);
throws({ ...base, status_to_activity: { ...base.status_to_activity, "On Hold": { activity: "paused" } } }, "3o: D8 — a paused mapping without a receipt is refused", /On Hold.*receipt/);
throws({ ...base, status_to_activity: { ...base.status_to_activity, "Withdrawn": { activity: "inactive", category: "gone", receipt: "x" } } }, "3p: an inactive category outside the four is refused", /category/);
throws({ ...base, entry_stage: "permitted" }, "3q: an entry stage without a receipt is refused (no generic membership)", /entry_stage_receipt/);
throws({ ...base, status_to_stage: { ...base.status_to_stage, "Withdrawn": "filed" } }, "3r: a status declared twice is refused", /more than once/);
let validated = false;
try { validateStageModel(base as never); validated = true; } catch { /* reported below */ }
ok(validated, "3s: a complete declaration validates (positive control)");

// ── 4. Wiring in all five connectors ────────────────────────────────────────────────
for (const f of ["arcgis", "socrata", "ckan", "carto", "csv"]) {
  const src = readFileSync(join(root, `supabase/functions/get-address-report/sources/${f}.ts`), "utf8");
  ok((src.match(/lookup = statusLookupFor\(entry\);/g) || []).length === 1, `4a: ${f} uses the one lookup`);
  // socrata.ts holds statusLookupFor, whose switch-off branch is the one remaining call; nobody else makes it.
  const direct = (src.match(/buildBucketLookup\(entry\.status_to_bucket/g) || []).length;
  ok(direct === (f === "socrata" ? 1 : 0), `4b: ${f} builds no bucket lookup of its own outside statusLookupFor`, direct);
  ok(/if \(rec && stageModelEnabled\(entry\)\) \{/.test(src), `4c: ${f} attaches stage fields only when switched on`);
}

if (failures) { console.error("\n" + failures + " FAILURE(S)"); process.exit(1); }
console.log("\nALL PASS");
