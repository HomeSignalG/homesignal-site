#!/usr/bin/env node
// Generate lib/generated/county-sources.json from the jurisdiction registry.
//
// WHY THIS FILE EXISTS. The empty-state copy on a ZIP page has to name the sources we
// actually track for that county — and jurisdiction-registry.json lives inside the edge
// function, which the browser cannot read. This projects the ONE fact the copy needs
// (county -> the sources declaring coverage of it) into a static asset the page can load.
//
// THE SELF-CLEARING PROPERTY, which is the whole point. Wiring a new source is a registry
// edit; regenerating this file is part of that same edit, enforced by
// test/county-sources-parity.test.mjs. So a county moves from "no source identified" to
// "here is the source" in the SAME commit and the SAME deploy — there is no second step
// for anyone to forget, and no window where the page names a source that is not wired or
// claims none when one exists.
//
// Regenerate:  node scripts/gen-county-sources.mjs
// Verify:      node test/county-sources-parity.test.mjs   (also runs in the unit suite)
//
// WHAT IS AND IS NOT DERIVED HERE. Two transformations, both deterministic and both
// pinned by the parity test:
//   • label  — the entry's OWN `jurisdiction` string, verbatim, truncated at the first
//     em-dash separator. That suffix is the dataset edition ("… — STIP FFY 2024-2027
//     (Approved Final)"), not the body's name; 12 of the entries carry one. Nothing else
//     is rewritten, so a label can never say something the registry does not.
//   • commercial — whether this entry can still classify a record as Commercial, read
//     from the config and nothing else: its type_map maps some value to "Commercial"
//     (or use_type_const is "Commercial") AND its commercial_work_evidence is not
//     `unresolved`. This is the ONE derived subject-matter fact in the file, and it exists
//     because the founder's Commercial rule (2026-09-05) makes "no Commercial source covers
//     this county" a statement the page MUST be able to make. A county with no such entry
//     can never show a Commercial pin, so a page there must not imply it measured and found
//     none. It is read from config, never inferred from an id, a family or a name.
//   • scope  — read from the entry's own shape, never guessed:
//       statewide : the coverage row declares a state and no county
//       city      : `jurisdiction` begins "City of " — the source's own declaration that
//                   it covers a city, which is what lets the copy say so
//       local     : anything else (county, district, authority)
// `commercial` above is the ONE exception, and it is read from config rather than inferred.
// Otherwise no subject-matter claim is derived: we never write "road projects" or "building
// permits" from an id or a family — the registry does not state it, so neither do we.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const REGISTRY = join(root, 'supabase/functions/get-address-report/jurisdiction-registry.json');
const OUT = join(root, 'lib/generated/county-sources.json');

export function buildCountySources(registry) {
  const entries = [];
  for (const [family, list] of Object.entries(registry)) {
    if (family.startsWith('_')) continue;          // _readme / _arcgis_readme / …
    for (const e of list) entries.push(e);
  }
  const statewide = {};
  const counties = {};
  for (const e of entries) {
    const label = String(e.jurisdiction ?? '').split(' — ')[0].trim();
    if (!label) continue;                          // no self-description -> name nothing
    // See the header note: config-read, never inferred. An entry whose work-evidence rule
    // is `unresolved` is no longer capable of asserting Commercial, so it must not count as
    // Commercial coverage — otherwise the copy would name a source for a claim it can no
    // longer make.
    const declaresCommercial =
      Object.values(e.type_map ?? {}).includes('Commercial') || e.use_type_const === 'Commercial';
    const commercial = declaresCommercial && !(e.commercial_work_evidence?.unresolved === true);
    for (const cv of e.coverage ?? []) {
      const state = cv.state;
      if (!state) continue;
      if (cv.county == null) {
        (statewide[state] ||= []).push({ id: e.registry_id, label, scope: 'statewide', commercial });
      } else {
        const scope = /^City of /i.test(label) ? 'city' : 'local';
        (counties[`${state}|${cv.county}`] ||= []).push({ id: e.registry_id, label, scope, commercial });
      }
    }
  }
  // Deterministic order + de-dupe by id: two coverage rows of one entry must not list it
  // twice, and the file has to be byte-stable so the parity test means something.
  const tidy = (arr) => {
    const seen = new Set();
    return arr.filter((x) => !seen.has(x.id) && seen.add(x.id))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  };
  const sortKeys = (obj) => Object.fromEntries(
    Object.keys(obj).sort().map((k) => [k, tidy(obj[k])]));

  return {
    _generated: 'AUTO-GENERATED — do not edit. Source: supabase/functions/get-address-report/jurisdiction-registry.json',
    _regenerate: 'node scripts/gen-county-sources.mjs',
    _contract: 'label is the entry jurisdiction verbatim, truncated at the first em-dash. scope is read from the entry, never guessed. The ONLY derived subject-matter fact is `commercial`: the entry maps a value to Commercial (or use_type_const is Commercial) AND its commercial_work_evidence is not unresolved. Nothing else is inferred from an id, family or name.',
    registry_entries: entries.length,
    statewide: sortKeys(statewide),
    counties: sortKeys(counties)
  };
}

export function readRegistry() {
  return JSON.parse(readFileSync(REGISTRY, 'utf8'));
}

export function serialize(obj) {
  return JSON.stringify(obj, null, 2) + '\n';
}

if (process.argv[1] && process.argv[1].endsWith('gen-county-sources.mjs')) {
  const out = buildCountySources(readRegistry());
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, serialize(out));
  const nCounty = Object.keys(out.counties).length;
  const nState = Object.keys(out.statewide).length;
  console.log(`county-sources.json written — ${out.registry_entries} registry entries -> `
    + `${nCounty} counties, ${nState} statewide states.`);
}
