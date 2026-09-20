#!/usr/bin/env node
// scripts/enable-decision-buckets.mjs
//
// Move DECISION statuses out of `exclude` and into the new `denied` / `withdrawn`
// buckets in jurisdiction-registry.json, so a denied application is EMITTED with a
// sourced decision notation instead of being deleted.
//
// ── WHY THIS IS A SCRIPT AND NOT AN EDIT (CLAUDE.md claims rule 7) ───────────────────
// "NEVER TRANSCRIBE A LIST INTO A MIGRATION. Compute the set inside the database, or
// generate the change from the source of truth programmatically." 294 denial-shaped
// values across 239 entries is exactly the list that gets hand-reflowed and silently
// loses five members. This computes the set from the registry itself, prints every
// decision with the rule that made it, and fingerprints the result (rule 8) so the
// applied file can be checked against the computation rather than eyeballed.
//
// ── THE CLASSIFIER REFUSES BEFORE IT GUESSES ─────────────────────────────────────────
// A value only moves when the publisher's own word states, unambiguously, that the
// application was REFUSED by the authority or PULLED by the applicant. Everything else
// stays exactly where it is, which is the pre-existing behaviour — so the honest failure
// mode of this script is "fewer decisions surfaced", never "a decision asserted that the
// source did not state". The AMBIGUOUS list is printed, not hidden: it is the residual,
// and it is part of the measured coverage rather than a rounding error.
//
//   node scripts/enable-decision-buckets.mjs            # report only, writes nothing
//   node scripts/enable-decision-buckets.mjs --apply    # rewrite the registry
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const REG_PATH = join(root, 'supabase/functions/get-address-report/jurisdiction-registry.json');
const FAMILIES = ['socrata', 'arcgis', 'ckan', 'csv', 'carto', 'opendatasoft'];
const apply = process.argv.includes('--apply');

// The authority refused it. Whole words only — `denial` must not fire on a value that
// merely contains the letters, and `rejected` must not fire on "Intake Rejected"… which
// it SHOULD, so that one is handled by the ambiguity rules below, not by narrowing this.
const DENIED = /\b(den(?:y|ied|ies|ial)|reject(?:ed|s)?|disapprov\w*|refus\w*)\b/i;
// The applicant pulled it.
const WITHDRAWN = /\b(withdraw\w*|withdrew)\b/i;

// ── AMBIGUITY: each rule names a REAL value it refuses, and refusing means "stay in
//    exclude", i.e. behave exactly as before this script existed.
const AMBIGUOUS = [
  [/\bor\b/i, 'the source states ALTERNATIVES, not an outcome ("Denied or Expired", "Placed on File or Denied") — we cannot tell which happened'],
  [/\bestimated\b/i, 'the publisher itself marks the value as an ESTIMATE ("ESTIMATED Rejected") — an estimated decision is not a recorded one'],
  [/\bvoid(ed)?\b/i, 'leads with an administrative nullification ("VOIDED - Applicant Withdrew Permit"); void and decided are different facts'],
  [/\bwithdraw\w*\s+by\s+(?!applicant)/i, 'withdrawn by someone OTHER than the applicant ("WITHDRAWN BY COUNTY") — the label reads "Withdrawn by applicant" and would name the wrong actor'],
  [/\b(amendment|reconsideration|appeal)\b/i, 'a SUB-PROCEEDING was decided ("Amendment Denied", "Reconsideration Denied") — that is not necessarily the application\'s own disposition, and an appeal is never an approval'],
  [/\bdept\b|\bdepartment\b/i, 'ONE DEPARTMENT\'s review ("Dept Disapproval") — an internal step, not the body\'s decision'],
];

// ⚠️ ORDER MATTERS, AND THE FIRST DRAFT HAD IT WRONG IN A WAY THAT LOOKED FINE.
// Running the ambiguity rules FIRST made every ordinary `"Void"` status — a value that
// is not a decision candidate at all and never was — report as "decision-shaped but
// REFUSED". The refusal count read 52 when the real residual was 6: the instrument's own
// noise was 88% of its finding, and the number it printed is exactly the one a reader
// would quote as the coverage gap. So candidacy is established FIRST, and ambiguity is
// only ever asked of an actual candidate.
function classify(value) {
  const v = String(value);
  const candidate = DENIED.test(v) ? 'denied' : WITHDRAWN.test(v) ? 'withdrawn' : null;
  if (!candidate) return { bucket: null, rule: 'not a decision word' };
  for (const [re, why] of AMBIGUOUS) if (re.test(v)) return { bucket: null, rule: `AMBIGUOUS: ${why}` };
  return candidate === 'denied'
    ? { bucket: 'denied', rule: 'the authority refused it' }
    : { bucket: 'withdrawn', rule: 'the applicant pulled it' };
}

const reg = JSON.parse(readFileSync(REG_PATH, 'utf8'));
const moved = [];      // [registry_id, value, bucket, rule]
const refused = [];    // [registry_id, value, rule]  — decision-shaped but ambiguous
let entries = 0, excludeValues = 0, touchedEntries = 0;

for (const fam of FAMILIES) {
  for (const e of (Array.isArray(reg[fam]) ? reg[fam] : [])) {
    entries++;
    const s2b = e.status_to_bucket;
    if (!s2b || !Array.isArray(s2b.exclude)) continue;
    const keep = [], toDenied = [], toWithdrawn = [];
    for (const v of s2b.exclude) {
      excludeValues++;
      const { bucket, rule } = classify(v);
      if (bucket === 'denied') { toDenied.push(v); moved.push([e.registry_id, v, bucket, rule]); }
      else if (bucket === 'withdrawn') { toWithdrawn.push(v); moved.push([e.registry_id, v, bucket, rule]); }
      else {
        keep.push(v);
        if (rule.startsWith('AMBIGUOUS')) refused.push([e.registry_id, v, rule]);
      }
    }
    if (!toDenied.length && !toWithdrawn.length) continue;
    touchedEntries++;
    // A status must live in EXACTLY ONE bucket — buildBucketLookup throws on a value
    // mapped to two different targets, and test/registry-map-collisions.test.mjs drives
    // the shipped builder over the live registry. So the value MOVES; it is never copied.
    s2b.exclude = keep;
    if (toDenied.length) s2b.denied = (s2b.denied ?? []).concat(toDenied);
    if (toWithdrawn.length) s2b.withdrawn = (s2b.withdrawn ?? []).concat(toWithdrawn);
  }
}

const fp = (rows) => createHash('md5')
  // `sort()` is JS codepoint order on BOTH sides of any comparison made against this
  // fingerprint, so no DB collation is involved (CLAUDE.md claims rule 9).
  .update(rows.map((r) => r.join('\u0001')).sort().join('\n')).digest('hex');

const byBucket = { denied: 0, withdrawn: 0 };
for (const [, , b] of moved) byBucket[b]++;

console.log(`registry entries read           ${entries}`);
console.log(`exclude values read (control)   ${excludeValues}`);
console.log(`entries changed                 ${touchedEntries}`);
console.log(`values moved -> denied          ${byBucket.denied}`);
console.log(`values moved -> withdrawn       ${byBucket.withdrawn}`);
console.log(`decision-shaped but REFUSED     ${refused.length}  (left in exclude — unchanged behaviour)`);
console.log(`moved fingerprint (md5)         ${fp(moved)}`);
console.log(`refused fingerprint (md5)       ${fp(refused)}`);
console.log('');
console.log('── MOVED ───────────────────────────────────────────────────────────────');
for (const [rid, v, b, rule] of moved.slice().sort()) console.log(`  ${b.padEnd(10)} ${JSON.stringify(v).padEnd(38)} ${rid}  — ${rule}`);
console.log('');
console.log('── REFUSED (decision-shaped, left in exclude) ──────────────────────────');
for (const [rid, v, rule] of refused.slice().sort()) console.log(`  ${JSON.stringify(v).padEnd(40)} ${rid}\n      ${rule}`);

// ── SERIALISE THE WAY THE FILE IS ALREADY SERIALISED ────────────────────────────────
// The committed registry escapes every non-ASCII character as \uXXXX. `JSON.stringify`
// emits raw UTF-8, so writing it back naively rewrites 314 unrelated lines (measured) —
// an em-dash here, a bullet there — and buries a 101-value change in a 314-line diff
// nobody can review. Same discipline the ingest repo's feeds.csv rule states: change the
// bytes you mean to change and no others.
function serialize(obj) {
  return JSON.stringify(obj, null, 2)
    .replace(/[\u0080-\uFFFF]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')) + '\n';
}

if (apply) {
  writeFileSync(REG_PATH, serialize(reg));
  console.log(`\nWROTE ${REG_PATH}`);
} else {
  console.log('\n(report only — pass --apply to write)');
}
