#!/usr/bin/env node
/**
 * GEOGRAPHY REGISTRY PARITY GATE — governance, not processing.
 *
 * THE INVARIANT
 *   Every registry that exists in HomeSignal ingest has an EXPLICIT geography
 *   disposition. There is no silent third state.
 *
 * TWO QUESTIONS, TWO AUTHORITIES, NO DUPLICATION
 *   "Does this registry exist in ingest?"      -> jurisdiction-registry.json
 *                                                 (compiled into the engine at
 *                                                 get-address-report/index.ts:72)
 *   "What is its geography disposition?"       -> docs/geo-registry-classification.json
 *   "Is it eligible to be PROCESSED right now?"-> geo.n5_accepted_source (runtime table)
 *
 *   TWO DIFFERENT EXCLUSION MECHANISMS — verified in code, and they are not the same:
 *     ABSENT from geo.n5_accepted_source -> excluded at the INNER JOIN
 *       (scripts/n5_shard.py:653), and scripts/n5_acquire_registry.py:49 raises
 *       "STOP: <id> has no row in geo.n5_accepted_source". This is UNCLASSIFIED.
 *     PRESENT with a non-processable treatment -> carried into geo.n5_frozen but
 *       matched by NEITHER association branch: n5_shard.py:540 takes treatment='PROVEN'
 *       and :543 takes treatment='RECOVERY'. n5_acquire_registry.py:50 refuses anything
 *       that is not RECOVERY. This is CLASSIFIED-AND-EXCLUDED.
 *   Both fail closed. They differ in whether the exclusion is RECORDED.
 *   So this gate adds no enforcement code — it makes the decision explicit and visible.
 *
 * WHAT THIS GATE MUST NEVER DO
 *   assign PROVEN or RECOVERY, enable authoritative geography, write production,
 *   or dispatch acquisition / membership / markers. It only compares and reports.
 *
 * ⚠️ WHY THE DB HALF IS OPTIONAL, AND WHY THAT IS NOT A LOOPHOLE
 *   Measured 2026-09-19: only the `postgres` role can SELECT geo.n5_accepted_source —
 *   anon, authenticated AND service_role all have can_select=false and no USAGE on
 *   schema geo. An ordinary CI job therefore CANNOT read it. So the DB comparison runs
 *   only when a postgres-privileged job supplies a dump via --catalogue. With no dump
 *   the gate prints NOT VERIFIED for that half and never reports it as passing.
 *
 * Usage:
 *   node scripts/check-geo-registry-parity.mjs
 *   node scripts/check-geo-registry-parity.mjs --catalogue <file>   # "id|TREATMENT" per line
 *   node scripts/check-geo-registry-parity.mjs --self-test
 */
import { readFileSync } from 'node:fs';

const REGISTRY = 'supabase/functions/get-address-report/jurisdiction-registry.json';
const CLASSIFICATION = 'docs/geo-registry-classification.json';
const FAMILIES = ['socrata', 'arcgis', 'ckan', 'csv', 'carto', 'opendatasoft'];
const PROCESSABLE = new Set(['PROVEN', 'RECOVERY']);
const NON_PROCESSABLE = new Set(['NOAUTH', 'HIST_UNRECOVERABLE', 'IDENT_UNRESOLVED']);
const GOVERNANCE = new Set(['PENDING_REVIEW', 'BLOCKED_NO_RECORDS']);
const ALL = new Set([...PROCESSABLE, ...NON_PROCESSABLE, ...GOVERNANCE]);
const DB_SENTINEL = '(null)';

export function ingestRegistryIds(registryJson) {
  const ids = [];
  for (const fam of FAMILIES) {
    for (const e of registryJson[fam] || []) {
      if (e && typeof e === 'object' && e.registry_id) ids.push(e.registry_id);
    }
  }
  return ids;
}

export function check(registryJson, classification, catalogue /* Map|null */) {
  const fail = [];
  const ids = ingestRegistryIds(registryJson);

  // duplicate registry_id inside the ingest registry itself
  const seen = new Set(), dupes = new Set();
  for (const id of ids) { if (seen.has(id)) dupes.add(id); seen.add(id); }
  for (const id of [...dupes].sort()) {
    fail.push(`FAILURE C: registry_id "${id}" appears more than once in ${REGISTRY}`);
  }

  const entries = classification.registries || {};

  // FAILURE A — a live ingest registry with no explicit geography decision
  for (const id of [...seen].sort()) {
    if (!Object.prototype.hasOwnProperty.call(entries, id)) {
      fail.push(`FAILURE A: ingest registry "${id}" has NO geography disposition. `
        + `Add an evidence-backed entry to ${CLASSIFICATION}. Do NOT assign a treatment to make this pass.`);
    }
  }

  // FAILURE C — invalid / missing disposition value
  for (const [id, v] of Object.entries(entries).sort()) {
    const d = v && v.disposition;
    if (!d) { fail.push(`FAILURE C: "${id}" has no disposition field`); continue; }
    if (!ALL.has(d)) {
      fail.push(`FAILURE C: "${id}" has unknown disposition "${d}" (allowed: ${[...ALL].sort().join(', ')})`);
    }
    if (GOVERNANCE.has(d) && !v.evidence) {
      fail.push(`FAILURE C: "${id}" is ${d} but records no evidence. A governance hold must say why.`);
    }
  }

  // FAILURE B (file half) — a disposition for a registry ingest no longer has
  for (const id of Object.keys(entries).sort()) {
    if (!seen.has(id) && id !== DB_SENTINEL) {
      fail.push(`FAILURE B: ${CLASSIFICATION} classifies "${id}" but it is not in ${REGISTRY}. `
        + `Remove it, or record an explicit historical reason.`);
    }
  }

  // DB half — only when a postgres-privileged dump was supplied
  let dbVerified = false;
  if (catalogue) {
    dbVerified = true;
    for (const [id, treatment] of [...catalogue.entries()].sort()) {
      if (id === DB_SENTINEL) continue; // documented sentinel, not a registry
      if (!seen.has(id)) {
        fail.push(`FAILURE B: geo.n5_accepted_source has "${id}" but ingest does not. `
          + `Stale classification for a removed registry.`);
      }
      const e = entries[id];
      if (e && e.disposition !== treatment) {
        fail.push(`FAILURE C: "${id}" disposition mismatch — file says ${e.disposition}, `
          + `geo.n5_accepted_source says ${treatment}.`);
      }
    }
    // A RECORDED TREATMENT must exist in the runtime table; a GOVERNANCE HOLD must not.
    // Presence alone is not eligibility — treatment decides (n5_shard.py:540/:543).
    for (const [id, v] of Object.entries(entries).sort()) {
      const recorded = PROCESSABLE.has(v.disposition) || NON_PROCESSABLE.has(v.disposition);
      const inDb = catalogue.has(id);
      if (recorded && !inDb) {
        fail.push(`FAILURE A: "${id}" is ${v.disposition} in the file but has NO row in `
          + `geo.n5_accepted_source, so it is excluded at the JOIN as UNCLASSIFIED rather than `
          + `recorded as ${v.disposition}.`);
      }
      if (GOVERNANCE.has(v.disposition) && inDb) {
        fail.push(`FAILURE C: "${id}" is a governance hold (${v.disposition}) but HAS a row in `
          + `geo.n5_accepted_source. A hold must be excluded at the JOIN — remove the row.`);
      }
    }
  }
  return { fail, counts: { ingest: seen.size, classified: Object.keys(entries).length }, dbVerified };
}

function parseCatalogue(text) {
  const m = new Map();
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    const i = t.indexOf('|');
    if (i < 0) continue;
    m.set(t.slice(0, i), t.slice(i + 1).split('|')[0]);
  }
  return m;
}

function selfTest() {
  const reg = { arcgis: [{ registry_id: 'a' }, { registry_id: 'b' }] };
  const okCls = { registries: { a: { disposition: 'PROVEN' }, b: { disposition: 'BLOCKED_NO_RECORDS', evidence: 'x' } } };
  const cases = [
    ['clean file-only', reg, okCls, null, 0],
    ['FAILURE A missing disposition', reg, { registries: { a: { disposition: 'PROVEN' } } }, null, 1],
    ['FAILURE C unknown disposition', reg, { registries: { a: { disposition: 'MAGIC' }, b: { disposition: 'PROVEN' } } }, null, 1],
    ['FAILURE C governance hold with no evidence', reg,
      { registries: { a: { disposition: 'PROVEN' }, b: { disposition: 'PENDING_REVIEW' } } }, null, 1],
    ['FAILURE B stale classification', reg,
      { registries: { ...okCls.registries, zzz: { disposition: 'PROVEN' } } }, null, 1],
    ['recorded non-processable treatment IS allowed in DB',
      { arcgis: [{ registry_id: 'a' }, { registry_id: 'n' }] },
      { registries: { a: { disposition: 'PROVEN' }, n: { disposition: 'NOAUTH' } } },
      new Map([['a', 'PROVEN'], ['n', 'NOAUTH']]), 0],
    ['FAILURE C governance hold present in DB', reg, okCls,
      new Map([['a', 'PROVEN'], ['b', 'PROVEN']]), 2],
    ['FAILURE A recorded treatment missing from DB', reg, okCls, new Map(), 1],
    ['sentinel is exempt', reg, okCls, new Map([['a', 'PROVEN'], [DB_SENTINEL, 'NOAUTH']]), 0],
  ];
  let bad = 0;
  for (const [name, r, c, cat, want] of cases) {
    const got = check(r, c, cat).fail.length;
    const ok = got === want;
    if (!ok) bad++;
    console.log(`${ok ? 'PASS' : 'FAIL'} — ${name} (expected ${want} failure(s), got ${got})`);
  }
  console.log(bad === 0 ? '\nself-test: all cases behave as specified' : `\nself-test: ${bad} case(s) wrong`);
  return bad === 0 ? 0 : 1;
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) process.exit(selfTest());
  const ci = argv.indexOf('--catalogue');
  const catalogue = ci >= 0 ? parseCatalogue(readFileSync(argv[ci + 1], 'utf8')) : null;
  const reg = JSON.parse(readFileSync(REGISTRY, 'utf8'));
  const cls = JSON.parse(readFileSync(CLASSIFICATION, 'utf8'));
  const { fail, counts, dbVerified } = check(reg, cls, catalogue);

  console.log(`ingest registries      : ${counts.ingest}`);
  console.log(`explicit dispositions  : ${counts.classified}`);
  const byD = {};
  for (const v of Object.values(cls.registries || {})) byD[v.disposition] = (byD[v.disposition] || 0) + 1;
  for (const [d, n] of Object.entries(byD).sort((a, b) => b[1] - a[1])) console.log(`  ${d.padEnd(20)} ${n}`);
  console.log(`DB parity              : ${dbVerified ? 'VERIFIED against supplied catalogue'
    : 'NOT VERIFIED — no --catalogue supplied (only the postgres role can read geo.n5_accepted_source)'}`);

  if (fail.length) {
    console.log(`\n${fail.length} FAILURE(S):`);
    for (const f of fail) console.log(`  ${f}`);
    console.log('\nThis gate never assigns a treatment. Classify with evidence, or record a governance hold.');
    process.exit(1);
  }
  console.log('\nPASS — every ingest registry has an explicit geography disposition.');
}
if (import.meta.url === `file://${process.argv[1]}`) main();
