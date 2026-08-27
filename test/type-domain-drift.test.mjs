// The TYPE-domain drift gate (source-monitor Phase 3.6) and the invariants around it.
//
// WHY THE GATE EXISTS. The status check's header called an unmapped status "the one soft-fail
// that DROPS a record". `include_types` drops records too, and more completely — the whitelist
// is pushed down INTO THE QUERY, so an unlisted value yields no record, no quarantine and no
// `unclassified` pin. The only symptom is a count that fails to grow. Cleveland's
// `Install Permits` appeared 2026-03-18, AFTER that entry was wired, and was dropped silently
// for five months; nothing reported it.
//
// WHY THERE IS A BASELINE. Whitelists deliberately exclude noise. Measured live 2026-08-19 in
// each connector's own scope: SLO keeps 49 of 83 live values, Aurora 50 of 60, Columbus 5 of 7,
// Cincinnati 2 of 11. A literal "any unlisted value gates" fires on 80 values on night one,
// almost all deliberate. So the gate fires only on a value in NEITHER `include_types` NOR
// `observed_types_unreviewed`. THE SELF-TEST BELOW PINS BOTH DIRECTIONS, because a gate that
// over-flags is not a safer gate — a false alarm every night is how a real one gets ignored.
//
// Run: node test/type-domain-drift.test.mjs   (discovered by scripts/run-unit-tests.mjs)
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import {
  soleTypeCol, typeDriftApplies, hasBaseline, knownTypeSet, classifyTypeValues,
  whitelistMappingGaps,
} from '../scripts/lib/type-drift.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'supabase/functions/get-address-report/sources');
let fails = 0;
const ok = (c, name, detail) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name + (!c && detail ? '\n     ' + detail : ''));
  if (!c) fails++;
};
const REG = JSON.parse(readFileSync(join(ROOT, 'supabase/functions/get-address-report/jurisdiction-registry.json'), 'utf8'));
const ALL = Object.values(REG).filter(Array.isArray).flat()
  .filter((e) => e && typeof e === 'object' && e.registry_id);
const WHITELISTED = ALL.filter((e) => Array.isArray(e.include_types) && e.include_types.length);

// ── A. THE SELF-TEST, BOTH DIRECTIONS ────────────────────────────────────────────────────
// A fixture entry standing in for a real one: two values fetched, one deliberate exclusion
// already on the baseline.
const FIXTURE = {
  registry_id: 'fixture-permits',
  column_map: { type_source: 'PERMIT_SUBTYPE' },
  include_types: ['Residential', 'Commercial'],
  type_map: { Residential: 'Residential', Commercial: 'Commercial' },
  observed_types_unreviewed: ['Roofing', 'Plumbing Permit'],
};
const UNCHANGED = [
  { value: 'Residential', n: 400 }, { value: 'Commercial', n: 200 },
  { value: 'Roofing', n: 900 }, { value: 'Plumbing Permit', n: 700 },
];

{
  // DIRECTION 1 — the vocabulary is unchanged. The gate MUST stay silent even though two of
  // the four live values are not fetched, because both were already known when it was armed.
  const r = classifyTypeValues(FIXTURE, UNCHANGED, true);
  ok(r.gating.length === 0,
    'A1 an UNCHANGED vocabulary does NOT gate — deliberate exclusions are not drift',
    JSON.stringify(r.gating));
  ok(r.baselineHits.length === 2,
    'A2 …the two unfetched values are still REPORTED, as unreviewed baseline hits',
    JSON.stringify(r.baselineHits));
  ok(r.listedNotLive.length === 0, 'A3 …and nothing is falsely reported as declared-but-dead');
}
{
  // DIRECTION 2 — the publisher adds a value. THE GATE MUST FIRE. This is Cleveland's
  // `Install Permits`, reproduced.
  const r = classifyTypeValues(FIXTURE, [...UNCHANGED, { value: 'Install Permits', n: 109 }], true);
  ok(r.gating.length === 1 && r.gating[0].value === 'Install Permits',
    'A4 a NEW value — in neither list — GATES', JSON.stringify(r.gating));
  ok(r.gating[0].n === 109, 'A5 …carrying its record count, so the cost of the drop is stated');
  ok(r.baselineHits.length === 2,
    'A6 …and the unchanged part of the vocabulary still does not gate (no collateral flagging)');
}
{
  // The new value OUT of window is latent, never gating — the connector cannot fetch it today.
  const r = classifyTypeValues(FIXTURE, [{ value: 'Install Permits', n: 109 }], false);
  ok(r.gating.length === 0 && r.latent.length === 1,
    'A7 the same new value OUT of window is latent, not gating', JSON.stringify(r));
}
{
  // Case and whitespace are REAL differences: the whitelist goes down as `col IN ('a','b')`,
  // byte-exact with no folding. `Renewable Energy ` (trailing space, 3,386 live rows at SLO)
  // is genuinely not fetched by an entry declaring `Renewable Energy`.
  const r = classifyTypeValues(FIXTURE, [{ value: 'residential', n: 5 }, { value: 'Commercial ', n: 7 }], true);
  ok(r.gating.length === 2,
    'A8 a case- or whitespace-different value GATES — the pushdown does not fold either',
    JSON.stringify(r.gating));
}
{
  // A blank is not a type value; the connectors cannot whitelist it and it is not drift.
  const r = classifyTypeValues(FIXTURE, [{ value: '', n: 3 }, { value: null, n: 4 }], true);
  ok(r.gating.length === 0, 'A9 blank/null values are not drift');
}
{
  // Tier 3: declared, matching zero live rows — Cleveland's fictional `Building`.
  const r = classifyTypeValues(FIXTURE, [{ value: 'Residential', n: 400 }], true);
  ok(JSON.stringify(r.listedNotLive) === JSON.stringify(['Commercial']),
    'A10 a DECLARED value with no live rows is reported (the `Building` class)', JSON.stringify(r.listedNotLive));
  ok(r.gating.length === 0, 'A11 …and does not gate — it is corrosive, not harmful');
}

// ── B. BASELINE NOT ESTABLISHED is a THIRD state, never "clean" ──────────────────────────
{
  const noBaseline = { ...FIXTURE }; delete noBaseline.observed_types_unreviewed;
  ok(hasBaseline(FIXTURE) === true, 'B1 a seeded entry has a baseline');
  ok(hasBaseline({ ...FIXTURE, observed_types_unreviewed: [] }) === true,
    'B2 an EMPTY baseline is established — a positive "enumerated, nothing unfetched"');
  ok(hasBaseline(noBaseline) === false,
    'B3 an ABSENT baseline is NOT established — its silence attests to nothing');
  ok(hasBaseline({ ...FIXTURE, observed_types_unreviewed: null }) === false,
    'B4 …and null is absent, not empty — the two must never collapse to one falsy check');
}

// ── C. the restatement matches the SHIPPED connector ─────────────────────────────────────
// The monitor's runner pins Node 20 (no TS type stripping), so it cannot import the connector.
// This test runs where it can, and proves the copy has not drifted.
{
  let shipped = null;
  try { ({ soleTypeCol: shipped } = await import(join(SRC, 'arcgis.ts'))); }
  catch (err) {
    ok(false, 'C0 import sources/arcgis.ts (needs Node >= 22.18 type stripping)', err.message);
  }
  if (shipped) {
    const cases = [
      { column_map: { type_source: 'PERMIT_SUBTYPE' } },
      { column_map: { type_source: ['ONE'] } },
      { column_map: { type_source: ['A', 'B'] } },       // arrays JOIN → no single column
      { column_map: {} },
      { column_map: { type_source: '' } },
    ];
    const mine = cases.map((c) => soleTypeCol(c));
    const theirs = cases.map((c) => shipped(c));
    ok(JSON.stringify(mine) === JSON.stringify(theirs),
      'C1 the lib\'s soleTypeCol agrees with the SHIPPED connector on every shape',
      `lib ${JSON.stringify(mine)} vs connector ${JSON.stringify(theirs)}`);
    ok(mine[2] === null,
      'C2 …including the multi-column array, where include_types cannot apply at all');
  }
}

// ── D. the real registry ─────────────────────────────────────────────────────────────────
{
  ok(WHITELISTED.length === 12,
    `D1 the include_types fleet is the expected 12 entries (${WHITELISTED.length})`,
    WHITELISTED.map((e) => e.registry_id).join(', '));
  const applies = WHITELISTED.filter(typeDriftApplies);
  ok(applies.length === WHITELISTED.length,
    'D2 every whitelisted entry resolves a single type column, so all 12 are checkable',
    WHITELISTED.filter((e) => !typeDriftApplies(e)).map((e) => e.registry_id).join(', '));

  const seeded = WHITELISTED.filter(hasBaseline);
  ok(seeded.length === 10,
    `D3 10 entries carry a seeded baseline (${seeded.length})`, seeded.map((e) => e.registry_id).join(', '));
  const pending = WHITELISTED.filter((e) => !hasBaseline(e)).map((e) => e.registry_id).sort();
  ok(JSON.stringify(pending) === JSON.stringify(['portland-building-permits', 'san-diego-approved-permits']),
    'D4 …and exactly the two that could not be enumerated are BASELINE NOT ESTABLISHED',
    JSON.stringify(pending));
  const total = seeded.reduce((s, e) => s + e.observed_types_unreviewed.length, 0);
  ok(total === 115, `D5 115 values are recorded observed-not-fetched (${total})`);

  // A baseline value that is ALSO whitelisted would be a contradiction: fetched and unfetched.
  // VERBATIM on the baseline side, trimmed on the config side — the connector's own asymmetry.
  // Compared with a trim on both, SLO's `Renewable Energy ` would look like a contradiction with
  // its declared `Renewable Energy`; they are different strings and the database treats them so.
  const contradictions = seeded.filter((e) =>
    e.observed_types_unreviewed.some((t) => e.include_types.map((x) => String(x).trim()).includes(String(t))));
  ok(contradictions.length === 0,
    'D6 no value is in BOTH include_types and the baseline', contradictions.map((e) => e.registry_id).join(', '));

  // The padded-value case, asserted on the REAL registry rather than only in the fixture:
  // this is 3,386 in-window rows SLO is not fetching, recorded as observed-not-fetched.
  const slo = seeded.find((e) => e.registry_id === 'slo-county-planning-permits');
  ok(!!slo && slo.observed_types_unreviewed.includes('Renewable Energy ')
     && slo.include_types.includes('Renewable Energy'),
    'D7 SLO\'s trailing-space `Renewable Energy ` is on the baseline while the clean spelling '
    + 'is whitelisted — a real not-fetched value, not a formatting artefact');
}

// ── E. THE INVARIANT MADE PERMANENT ──────────────────────────────────────────────────────
// A whitelisted value with no type_map line is FETCHED and then emitted `unclassified` — the
// opposite failure to the gate above. It held across all 10 entries on 2026-08-19; asserting it
// here is what keeps it holding, rather than someone re-checking by hand.
{
  const gaps = whitelistMappingGaps(ALL);
  ok(gaps.length === 0,
    'E1 every whitelisted value has a type_map line (or a use_type_const) — none is fetched '
    + 'only to render `unclassified`',
    gaps.map((g) => `${g.registry_id}: ${g.missing.join(', ')}`).join(' | '));
  // …and the checker actually detects the violation, so E1's silence means something.
  const planted = whitelistMappingGaps([{ registry_id: 'x', include_types: ['A', 'B'], type_map: { A: 'Residential' } }]);
  ok(planted.length === 1 && planted[0].missing.length === 1 && planted[0].missing[0] === 'B',
    'E2 …and the check FIRES on a planted gap, so E1 is not vacuous', JSON.stringify(planted));
  const constEntry = whitelistMappingGaps([{ registry_id: 'y', include_types: ['A'], use_type_const: 'Development' }]);
  ok(constEntry.length === 0, 'E3 a use_type_const entry needs no per-value mapping');
}

// ── F. knownTypeSet is the union, trimmed ────────────────────────────────────────────────
{
  const s = knownTypeSet(FIXTURE);
  ok(s.size === 4 && s.has('Residential') && s.has('Roofing'),
    'F1 knownTypeSet unions what is fetched with what is observed-not-fetched', [...s].join(', '));
  ok(knownTypeSet({ include_types: [' Padded '], observed_types_unreviewed: [] }).has('Padded'),
    'F2 …trimming both sides, matching the connectors\' own trim');
}

console.log(fails ? `\n${fails} type-domain-drift assertion(s) FAILED.` : '\nAll type-domain-drift assertions passed.');
process.exit(fails ? 1 : 0);
