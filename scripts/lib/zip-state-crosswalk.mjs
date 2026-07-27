// zip-state-crosswalk.mjs — the cross-state ZIP modeling guard.
//
// WHY THIS EXISTS: the 42-remaining-states build keyed county identity on
// `county_fips` from the U.S. Census 2020 ZCTA5->County Relationship File. A ZCTA
// whose polygon straddles a state line is listed under EVERY county it overlaps,
// so 19 border ZCTAs were seeded under the NEIGHBOURING state's county. The damage
// is invisible in the model and only shows up downstream as content: ZIP 79922 (El
// Paso, TEXAS) rooted to Dona Ana County, NEW MEXICO, so the first Gold Master
// ingestion anchored 73 El Paso TX articles to a New Mexico county and the
// materializer served them on 25 ZIP pages, 23 of which are genuine NM towns.
//
// That class is now caught HERE, in CI, instead of by a downstream content anomaly.
// Full record: docs/cross-state-zip-root-defect.md + docs/cross-state-zip-repair-seed.sql
//
// AUTHORITATIVE SOURCE: docs/zip-state-v3.csv, generated from the `zipcodes` PyPI
// package v3.0.0 — the same bundled offline USPS dataset every state build pins
// (CLAUDE.md §12.0 "never guess a ZIP<->county mapping") and the same source behind
// docs/zip-centroids-v3.csv. Every ZIP in that package maps to exactly ONE state
// (verified at generation: 42,789 ZIPs, 0 with more than one state), so the
// crosswalk is unambiguous by construction.

import { readFileSync } from 'node:fs';

// ── The ONLY tolerated exceptions ───────────────────────────────────────────────
// Two ZIPs modeled from the Census ZCTA file are absent from the USPS package
// entirely, so it can neither confirm nor contradict their state. They are
// QUARANTINED — excluded from the state assertion by name, never guessed, and
// never used to weaken the assertion for anything else. Documented in CLAUDE.md
// §7 ("84684/84685 were absent from the `zipcodes` dataset and quarantined
// (excluded, not guessed)").
//
// This list is deliberately explicit and tiny. Adding to it is a reviewable code
// change, and each entry must name a ZIP that is genuinely ABSENT from the
// crosswalk — `assertQuarantineIsHonest()` below fails if a quarantined ZIP is
// actually present, so this can never be used to silence a real mismatch.
export const QUARANTINED_ZCTA_ONLY = Object.freeze({
  '84684': 'ZCTA-only (Census 2020); absent from zipcodes v3.0.0 — modeled UT, unverifiable',
  '84685': 'ZCTA-only (Census 2020); absent from zipcodes v3.0.0 — modeled UT, unverifiable',
});

export function loadZipStateCrosswalk(csvPath) {
  const text = readFileSync(csvPath, 'utf8');
  const map = new Map();
  const lines = text.split('\n');
  if ((lines[0] || '').trim() !== 'zip,state') {
    throw new Error(`zip-state crosswalk: unexpected header "${lines[0]}" (expected "zip,state")`);
  }
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const [zip, state] = line.split(',');
    if (!/^\d{5}$/.test(zip) || !/^[A-Z]{2}$/.test(state || '')) {
      throw new Error(`zip-state crosswalk: malformed row ${i + 1}: "${line}"`);
    }
    map.set(zip, state);
  }
  if (map.size < 40000) {
    throw new Error(`zip-state crosswalk looks truncated (${map.size} rows) — refusing to run a weakened check`);
  }
  return map;
}

// A quarantine entry is only honest if the ZIP really is missing from the
// crosswalk. If the dataset later gains it, the exception must go — otherwise the
// list becomes a place to hide real defects.
export function assertQuarantineIsHonest(crosswalk) {
  const dishonest = Object.keys(QUARANTINED_ZCTA_ONLY).filter((z) => crosswalk.has(z));
  if (dishonest.length) {
    throw new Error(
      `Quarantine list is stale: ${dishonest.join(', ')} now EXIST in the crosswalk. ` +
      `Remove them from QUARANTINED_ZCTA_ONLY and let the assertion cover them.`
    );
  }
}

// ── THE INVARIANT ───────────────────────────────────────────────────────────────
// For every modeled level='zip' community, with Z = its single ZIP and
// A = crosswalk[Z] (the authoritative USPS state):
//
//   1. zip.state             === A
//   2. root(zip).state       === A          (root = top of the parent_id chain)
//   3. no level='county' row with state !== A may claim Z in its zip_codes
//   4. Z is claimed by county roots of at most ONE state
//
// Rows whose ZIP is in QUARANTINED_ZCTA_ONLY are skipped for 1 and 2 (no
// authoritative value exists to compare against) but STILL checked for 3 and 4,
// which are internal-consistency rules needing no external truth.
//
// `communities` is the raw row set: {id, name, slug, level, state, county,
// parent_id, zip_codes}. Pure — no I/O, no network — so it is directly testable
// against fixtures.
export function checkZipStateIntegrity(communities, crosswalk) {
  const byId = new Map(communities.map((c) => [c.id, c]));
  const violations = [];

  const rootOf = (row) => {
    let cur = row;
    for (let hops = 0; cur.parent_id && hops < 8; hops++) {
      const next = byId.get(cur.parent_id);
      if (!next) return { root: cur, broken: true };
      cur = next;
    }
    return { root: cur, broken: false };
  };

  // Which county roots claim each ZIP (drives rules 3 and 4).
  const claims = new Map(); // zip -> [{slug, state}]
  for (const c of communities) {
    if (c.level !== 'county') continue;
    for (const z of c.zip_codes || []) {
      if (!claims.has(z)) claims.set(z, []);
      claims.get(z).push({ slug: c.slug, state: c.state, name: c.name });
    }
  }

  for (const c of communities) {
    if (c.level !== 'zip') continue;
    const zips = c.zip_codes || [];
    if (zips.length !== 1) {
      violations.push({
        rule: 'zip-page-shape',
        zip: zips.join('|') || '(none)',
        detail: `ZIP page "${c.name}" carries ${zips.length} ZIPs; the per-ZIP model expects exactly 1`,
      });
      continue;
    }
    const zip = zips[0];
    const quarantined = Object.prototype.hasOwnProperty.call(QUARANTINED_ZCTA_ONLY, zip);
    const auth = crosswalk.get(zip);

    if (!quarantined && !auth) {
      violations.push({
        rule: 'zip-not-in-crosswalk',
        zip,
        detail: `"${c.name}" is not in the authoritative crosswalk and is not a named quarantine exception — ` +
                `add it to QUARANTINED_ZCTA_ONLY with a reason, or correct the ZIP`,
      });
      continue;
    }

    if (auth) {
      // Rule 1 — the ZIP page's own state
      if (c.state !== auth) {
        violations.push({
          rule: 'zip-state-mismatch',
          zip,
          detail: `"${c.name}" is modeled state=${c.state} but the authoritative state is ${auth}`,
        });
      }
      // Rule 2 — the chain root's state
      const { root, broken } = rootOf(c);
      if (broken) {
        violations.push({ rule: 'broken-parent-chain', zip, detail: `"${c.name}" has a parent_id with no matching row` });
      } else if (root.state !== auth) {
        violations.push({
          rule: 'root-state-mismatch',
          zip,
          detail: `"${c.name}" (authoritative ${auth}) roots to "${root.name}" in ${root.state}` +
                  ` — a ${auth} ZIP would inherit ${root.state} government`,
        });
      }
      // Rule 3 — wrong-state county claim
      for (const cl of claims.get(zip) || []) {
        if (cl.state !== auth) {
          violations.push({
            rule: 'wrong-state-county-claim',
            zip,
            detail: `county root "${cl.name}" (${cl.state}) claims ${zip}, whose authoritative state is ${auth}`,
          });
        }
      }
    }

    // Rule 4 — claimed across multiple states (internal consistency; runs even
    // for quarantined ZIPs, since it needs no external truth)
    const states = [...new Set((claims.get(zip) || []).map((cl) => cl.state))];
    if (states.length > 1) {
      violations.push({
        rule: 'multi-state-county-claim',
        zip,
        detail: `${zip} is claimed by county roots in ${states.length} states: ${states.join(', ')}`,
      });
    }
  }

  return violations;
}
