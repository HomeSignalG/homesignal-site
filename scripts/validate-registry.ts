// scripts/validate-registry.ts — CI gate for jurisdiction-registry.json (backbone Phase 2).
//
// Runs under Deno in verify-edge-function.yml. It imports the ONE validator from the neutral
// backbone contract, so there is exactly one implementation of "what a valid entry is" —
// no second copy to drift.
//
// Why this exists: a malformed registry entry currently fails SILENTLY in production. The
// coverage gate closes, or every row lands unclassified, and the ZIP just shows 0 records —
// indistinguishable from "this jurisdiction has no permits". Catch it in CI instead.
//
// Exit 0 = clean. Exit 1 = at least one structural error (printed, grouped by section).

import { validateRegistryEntry } from "../supabase/functions/get-address-report/sources/contract.ts";

const registryPath = new URL(
  "../supabase/functions/get-address-report/jurisdiction-registry.json",
  import.meta.url,
);
const registry = JSON.parse(await Deno.readTextFile(registryPath)) as Record<string, unknown>;

const SECTIONS = ["socrata", "arcgis", "ckan", "csv", "carto"];
let total = 0;
const errors: string[] = [];

for (const section of SECTIONS) {
  const entries = registry[section];
  if (!Array.isArray(entries)) continue;
  for (const raw of entries) {
    if (!raw || typeof raw !== "object") { errors.push(`${section}: non-object entry`); continue; }
    total++;
    errors.push(...validateRegistryEntry(raw as Record<string, unknown>, section).map((e) => `${section}/${e}`));
  }
}

// Registry-wide invariant: registry_id must be globally unique — the cache keys development
// records on source_registry_id, so a collision silently merges two jurisdictions' records.
const ids = new Map<string, string>();
for (const section of SECTIONS) {
  for (const raw of (Array.isArray(registry[section]) ? registry[section] as Record<string, unknown>[] : [])) {
    const id = String(raw?.registry_id ?? "");
    if (!id) continue;
    if (ids.has(id)) errors.push(`duplicate registry_id "${id}" in ${ids.get(id)} and ${section}`);
    else ids.set(id, section);
  }
}

console.log(`validate-registry: ${total} entries across ${SECTIONS.length} sections`);
if (errors.length) {
  console.error(`\n${errors.length} structural error(s):`);
  for (const e of errors) console.error("  - " + e);
  Deno.exit(1);
}
console.log("validate-registry: OK — every entry is structurally valid, all registry_ids unique.");
