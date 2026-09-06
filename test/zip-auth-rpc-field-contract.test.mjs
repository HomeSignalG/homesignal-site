// THE RPC FIELD CONTRACT — what app_zip_projects_markers MUST ship, proven against what the
// page and Residential Rule 5 actually READ.
//
// WHY THIS FILE EXISTS (the defect it is the control for, 2026-09-06):
//
//   Migration `zip_markers_project_only_read_fields` narrowed the authoritative branch from
//   `to_jsonb(a.*)` (all 35 app_projects columns) to a 12-field projection, to cut the payload
//   on dense ZIPs. The projection was derived by reading `zipAuthSiteFromMarker` — and it was
//   RIGHT about that function. It missed `type_raw`, which no site builder reads directly but
//   which `HS.residentialActivity` reads off the SAME project object, one call deeper, inside
//   the Rule 5 gate. So Rule 5 shipped to production judging every authoritative record with
//   HALF its evidence: `type_raw` was `undefined`, normalised to ' ', and every verdict that
//   depended on the source's own class text silently became name-only.
//
//   Nothing failed. The RPC returned 200, the page rendered, the counts looked plausible, and
//   the loss was invisible because a record Rule 5 rejects is DROPPED rather than marked. The
//   only way to see it was to read the two files together — which is what this test does, so a
//   human never has to remember to.
//
// THE RULE THIS PINS: every field name read off a project object anywhere in the ZIP-mode
// authoritative path must be present in the RPC's emitted field set. A future narrowing that
// drops one fails here by name.
//
// Run: node test/zip-auth-rpc-field-contract.test.mjs
import fs from 'node:fs';
let fails = 0;
const ok = (c, name, detail) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name + (detail ? '\n        ' + detail : ''));
  if (!c) fails++;
};
const read = p => fs.readFileSync(new URL(p, import.meta.url), 'utf8');

// ── 1. What the page reads off a project object ───────────────────────────────────────────
// `zipAuthSiteFromMarker(marker, project)` is the one place a ZIP-mode site is built.
const zipAuth = read('../lib/zip-authoritative.js');
const pageReads = new Set([...zipAuth.matchAll(/\bproject\.([a-z_][a-z0-9_]*)/gi)].map(m => m[1]));

// ── 2. What Rule 5 reads off the SAME object ──────────────────────────────────────────────
// residentialActivity binds `const p = project || {}` and then reads p.<field>. That aliasing
// is exactly what made the miss invisible, so the test follows the alias rather than the name.
const qualify = read('../lib/residential-qualify.js');
const activity = qualify.slice(qualify.indexOf('HS.residentialActivity'));
const ruleReads = new Set([...activity.matchAll(/\bp\.([a-z_][a-z0-9_]*)/gi)].map(m => m[1]));

// ── 3. What the RPC actually emits ────────────────────────────────────────────────────────
// The DDL of record. Read the authoritative branch only — the legacy branch still ships
// to_jsonb(p) and would mask a narrowing in the branch that is live.
const ddl = read('../docs/n5-unit-a4-delivery-contract.sql');
const authStart = ddl.indexOf("-- One project per (ZIP, source_key)");
ok(authStart > 0, 'the DDL of record still carries the authoritative branch marker',
   'looked for the "One project per (ZIP, source_key)" comment');
const authBranch = ddl.slice(authStart);
const emitted = new Set([...authBranch.matchAll(/'([a-z_][a-z0-9_]*)'\s*,\s*a\.([a-z_][a-z0-9_]*)/g)]
  .map(m => m[1]));

// ── 4. The contract ───────────────────────────────────────────────────────────────────────
// Keys the page synthesises rather than reads from the row, and keys the marker supplies.
const NOT_FROM_APP_PROJECTS = new Set(['project_ref', 'point_rule']);
const required = [...new Set([...pageReads, ...ruleReads])].filter(f => !NOT_FROM_APP_PROJECTS.has(f)).sort();
const missing = required.filter(f => !emitted.has(f));

ok(required.length > 0, `the scan found project fields to check (${required.length})`, required.join(', '));
ok(missing.length === 0,
   'every project field the ZIP-mode path reads is emitted by the RPC',
   missing.length ? 'MISSING FROM THE RPC: ' + missing.join(', ') : 'emitted: ' + [...emitted].sort().join(', '));

// type_raw is named explicitly, not merely covered by the scan above: it is the field the
// narrowing dropped, and a regex that stopped matching it would make this file pass silently.
ok(ruleReads.has('type_raw'), 'Rule 5 still reads type_raw (if this fails, the scan broke, not the rule)');
ok(emitted.has('type_raw'), 'the RPC emits type_raw — Rule 5 has its source-class evidence');

// The page reads the marker's coordinates, never the project's, so a project object carrying
// lat/lng/zip is pure payload. Asserting their ABSENCE keeps a future session from "restoring"
// them and re-inflating a 9.6 MB response for fields nothing reads.
for (const dead of ['lat', 'lng', 'zip', 'stage']) {
  ok(!emitted.has(dead), `the RPC does not ship '${dead}' — nothing in the ZIP-mode path reads it`);
}

// ── 5. The DDL of record must match what is DEPLOYED ──────────────────────────────────────
// Not checkable offline; named here so the omission is deliberate rather than forgotten.
console.log('NOTE — parity against the LIVE function is proven by scripts/verify-map1-zip-states.mjs,\n'
          + '       which reads the RPC over the network. This file pins the committed DDL only.');

console.log(fails ? `\n${fails} check(s) failed` : '\nAll checks passed');
process.exit(fails ? 1 : 0);
