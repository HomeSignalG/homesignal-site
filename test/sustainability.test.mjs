// Company Sustainability Record — the render contract for a DOWNSTREAM enrichment layer.
//
// The point of the re-integration is that ESG no longer has an opinion about who owns,
// develops or operates anything. These tests pin the consequences:
//
//   • the renderer consumes a company the identity layer resolved; it cannot create one;
//   • a verified direct company and a verified parent are separate, separately-labelled records;
//   • an FRS-Reported direct company stays Reported after an ESG lookup;
//   • an unresolved identity produces silence, not "ESG data unavailable";
//   • missing data is never a zero, and a numeric without a unit never renders;
//   • WikiRate attribution rides with every displayed item;
//   • the first-level card stays one line.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { GARFIELD, ATX1, BFI, UNRESOLVED, NOT_CHECKED, DIRECT_WITH_DATA }
  from './fixtures/sustainability-78617.mjs';

const ctx = { window: {}, document: undefined };
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(readFileSync(new URL('../lib/templates.js', import.meta.url), 'utf8'), ctx);
vm.runInContext(readFileSync(new URL('../lib/sustainability.js', import.meta.url), 'utf8'), ctx);
const S = ctx.window.HS.sustain;

const SRC = readFileSync(new URL('../lib/sustainability.js', import.meta.url), 'utf8');
const codeOf = (s) => s.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
const textOf = (h) => String(h).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

// ── 1. ESG consumes an existing company; it never creates identity ─────────────────────
test('the renderer reads companies from the payload and cannot invent one', () => {
  const names = S.direct(GARFIELD).concat(S.parents(GARFIELD)).map(c => c.company_name);
  assert.deepEqual(names, ['Martin Marietta Materials Southwest, LLC', 'TXI Operations, LP',
                           'Martin Marietta Materials, Inc.']);
  // An empty payload yields nothing — there is no search path to fall back on.
  assert.equal(S.direct({ id: 'x' }).length, 0);
  assert.equal(S.parents({ id: 'x' }).length, 0);
  assert.equal(S.detailHTML({ id: 'x' }), '');
  // And no lookup/search/fetch machinery lives in this file at all.
  const code = codeOf(SRC);
  ['fetch(', 'XMLHttpRequest', 'filter[name]', 'match(', 'similar', 'levenshtein']
    .forEach(t => assert.ok(!code.includes(t), 'sustainability renderer must not do lookups: ' + t));
});

// ── 2. A verified direct company is queryable and renders as itself ────────────────────
test('a verified direct company with data renders as a company record', () => {
  const html = S.detailHTML(DIRECT_WITH_DATA);
  assert.match(html, /Company sustainability record/);
  assert.ok(!/Parent-company sustainability record/.test(html));
  assert.match(html, /Example Materials, Inc\./);
  assert.match(html, /Developer/);
  assert.match(html, /1,200,000 cubic metres/);
  assert.ok(!/not a measurement of this individual facility/.test(html),
    'the parent caveat belongs only on a parent record');
});

// ── 3. An FRS-Reported direct company keeps its Reported status ────────────────────────
test('an ESG lookup does not upgrade a Reported identity', () => {
  const rows = S.direct(BFI);
  assert.equal(rows.length, 2);
  rows.forEach(c => {
    assert.equal(c.identity_tier, 'frs_affiliation');
    assert.equal(S.identityWord(c), 'Reported');
  });
  // Eligible for a lookup — it was checked — and still Reported afterwards.
  assert.equal(S.state(rows[0]), 'no_data');
  assert.equal(S.identityWord({ identity_verification: 'VERIFIED' }), 'Verified');
});

// ── 4. An unresolved identity cannot trigger a lookup, and says nothing about ESG ───────
test('an unresolved company produces silence, never "ESG data unavailable"', () => {
  assert.equal(S.state(UNRESOLVED.sustainability), 'unresolved');
  assert.equal(S.direct(UNRESOLVED).length, 0);
  assert.equal(S.indicatorHTML(UNRESOLVED), '');
  assert.equal(S.detailHTML(UNRESOLVED), '');
  assert.equal(S.evidenceEntries(UNRESOLVED).length, 0);
  assert.equal(S.STATE_LINE.unresolved, 'Company identity not yet verified');
  const all = Object.values(S.STATE_LINE).join(' ');
  assert.ok(!/ESG data unavailable/i.test(all));
  assert.ok(!/\bESG\b/.test(all), 'no availability line may use the term ESG');
});

// ── 5. A verified parent is queried and shown separately from its subsidiary ───────────
test('the parent record is its own record, not the subsidiary’s', () => {
  const direct = S.direct(GARFIELD), parents = S.parents(GARFIELD);
  assert.equal(direct.length, 2);
  assert.equal(parents.length, 1);
  // The direct company was checked and has nothing; the parent's data does not fill that in.
  direct.forEach(c => assert.equal(S.state(c), 'no_data'));
  assert.equal(S.state(parents[0]), 'available');
  assert.equal(parents[0].parent_of_name, 'Martin Marietta Materials Southwest, LLC');
  const html = S.detailHTML(GARFIELD);
  assert.match(html, /Parent-company sustainability record/);
  assert.ok(!/>Company sustainability record</.test(html),
    'the direct company has no record, so no direct-company block is drawn');
});

// ── 6. An unverified parent can never be queried ───────────────────────────────────────
test('only a VERIFIED parent reaches the sustainability layer', () => {
  // The eligibility decision is made upstream in SQL; what the renderer must guarantee is that
  // it has no way to construct a parent itself. There is no parent-derivation code here.
  const code = codeOf(SRC);
  ['parent_candidates', 'company_parents', 'unverified_candidate', 'infer']
    .forEach(t => assert.ok(!code.includes(t), 'renderer must not reason about parentage: ' + t));
  // A payload carrying only direct companies renders no parent block, whatever else it holds.
  assert.equal(S.parents(BFI).length, 0);
  assert.ok(!/Parent-company/.test(S.detailHTML(BFI)));
});

// ── 7. Direct and parent results render separately ─────────────────────────────────────
test('direct and parent blocks are distinct and never merged', () => {
  const merged = { id: 'both', sustainability: { companies:
    S.direct(DIRECT_WITH_DATA).concat(S.parents(GARFIELD)) } };
  const html = S.detailHTML(merged);
  const iDirect = html.indexOf('Company sustainability record');
  const iParent = html.indexOf('Parent-company sustainability record');
  assert.ok(iDirect >= 0 && iParent >= 0, 'both blocks render');
  assert.notEqual(iDirect, iParent);
  assert.equal((html.match(/<div class="sussec">/g) || []).length, 2, 'two separate blocks');
});

// ── 8. The parent result carries the parent caveat ─────────────────────────────────────
test('a parent record says it is not a measurement of this facility', () => {
  const html = S.detailHTML(GARFIELD);
  assert.match(html, /Parent company<\/span><b>Martin Marietta Materials, Inc\./);
  assert.match(html, /Parent of<\/span><b>Martin Marietta Materials Southwest, LLC/);
  assert.match(html, /applies to the parent company and is not a measurement of this individual facility/);
  const ev = S.evidenceEntries(GARFIELD);
  assert.ok(ev.length > 0);
  ev.forEach(e => {
    assert.match(e.role, /^Parent-company sustainability/);
    assert.match(e.note, /not a measurement of this individual facility/);
  });
});

// ── 9. An ESG result cannot overwrite company identity ─────────────────────────────────
test('the WikiRate name never replaces the HomeSignal company name', () => {
  const p = S.parents(GARFIELD)[0];
  assert.equal(p.external_company_name, 'Martin Marietta Materials');   // what WikiRate calls it
  assert.equal(p.company_name, 'Martin Marietta Materials, Inc.');      // what HomeSignal resolved
  const html = S.companyHTML(p);
  assert.match(html, /Martin Marietta Materials, Inc\./);
  // The WikiRate spelling is disclosure-only — it is a citation, not the company's name.
  assert.ok(!/<b>Martin Marietta Materials<\/b>/.test(html));
  const ev = S.evidenceEntries(GARFIELD);
  assert.ok(ev.every(e => e.entity === 'Martin Marietta Materials, Inc.'));
  assert.match(ev[0].document, /listed on WikiRate as "Martin Marietta Materials"/);
});

// ── 10. Missing data never renders as a zero ───────────────────────────────────────────
test('an absent sustainability record renders nothing, never 0', () => {
  assert.equal(S.indicatorHTML(ATX1), '');
  assert.equal(S.detailHTML(ATX1), '');
  assert.equal(S.evidenceEntries(ATX1).length, 0);
  assert.equal(S.state(S.direct(ATX1)[0]), 'no_data');
  assert.equal(S.STATE_LINE.no_data, 'No sustainability data found in the sources checked');
  assert.ok(!/\b0\b/.test(Object.values(S.STATE_LINE).join(' ')));
  // "checked and empty" and "not yet checked" stay different answers.
  assert.equal(S.state(S.direct(NOT_CHECKED)[0]), 'not_checked');
  assert.notEqual(S.STATE_LINE.not_checked, S.STATE_LINE.no_data);
});

// ── 11. A numeric with no unit is suppressed ───────────────────────────────────────────
test('every displayed numeric carries its unit', () => {
  // The gate is in SQL (esg_load_indicators reads the unit WikiRate publishes on the metric
  // card, and a bare number without one is never stored). What the renderer must not do is
  // manufacture a number of its own, or print a bare figure it was handed.
  const nums = S.parents(GARFIELD)[0].indicators.filter(i => /[0-9]/.test(i.value));
  assert.ok(nums.length > 0);
  nums.forEach(i => assert.match(i.value, /^[0-9,]+ [a-zA-Z].*$/,
    'a numeric indicator must arrive with its unit already attached: ' + i.value));
  const code = codeOf(SRC);
  ['toFixed', 'Math.', 'parseFloat', 'parseInt', '/ 100', '* 100']
    .forEach(t => assert.ok(!code.includes(t), 'no arithmetic belongs in the renderer: ' + t));
});

// ── 12. No synthetic score, grade or rating ────────────────────────────────────────────
test('there is no HomeSignal ESG score anywhere in the surface', () => {
  const surfaces = [S.detailHTML(GARFIELD), S.detailHTML(DIRECT_WITH_DATA),
                    S.indicatorHTML(GARFIELD), Object.values(S.STATE_LINE).join(' ')].join('\n');
  [/ESG score/i, /\bgrade\b/i, /\brating\b/i, /out of 100/i, /\b[A-F][+-]?\srating/]
    .forEach(re => assert.ok(!re.test(surfaces), 'scoring language leaked: ' + re));
  assert.ok(!/score/i.test(textOf(surfaces)), 'the word "score" must not reach the card');
  // and the preferred consumer wording IS present
  assert.match(S.detailHTML(GARFIELD), /sustainability record/i);
});

// ── 13. WikiRate attribution stays visible ─────────────────────────────────────────────
test('every displayed item keeps its WikiRate attribution and its own link', () => {
  const ev = S.evidenceEntries(GARFIELD);
  assert.equal(ev.length, 4);
  ev.forEach(e => {
    assert.equal(e.org, 'WikiRate');
    assert.match(e.document, /Data from WikiRate \(wikirate\.org\), published under CC BY-SA 4\.0/);
    assert.match(e.document, /Metric designed by /);
    assert.match(e.url, /^https:\/\/wikirate\.org\//);
    assert.ok(e.retrieved, 'retrieval date is part of the attribution');
  });
  assert.match(S.detailHTML(GARFIELD), /Source<\/span><b>WikiRate/);
  // reporting year survives to the card
  assert.match(S.detailHTML(GARFIELD), /\(2022\)/);
});

// ── 14. No proprietary rating source is introduced ─────────────────────────────────────
test('no proprietary ESG provider appears in the code or the data', () => {
  const blob = [SRC, JSON.stringify(GARFIELD), JSON.stringify(DIRECT_WITH_DATA)].join('\n');
  ['MSCI', 'Sustainalytics', 'S&P Global', 'RepRisk', 'ISS ESG', 'Refinitiv', 'Bloomberg ESG']
    .forEach(p => assert.ok(!blob.includes(p), 'proprietary provider present: ' + p));
});

// ── 15. The first-level card stays compact ─────────────────────────────────────────────
test('the property card shows one availability line and no indicators', () => {
  const ind = S.indicatorHTML(GARFIELD);
  assert.equal(textOf(ind), 'Parent-company sustainability information available');
  assert.ok(!/4,609,000|Scope|tonnes|Commons/.test(ind), 'no indicator values on the first level');
  assert.equal((ind.match(/<p /g) || []).length, 1, 'exactly one line');
  // A direct match says so instead — the distinction matters to the reader.
  assert.equal(textOf(S.indicatorHTML(DIRECT_WITH_DATA)), 'Company sustainability information available');
  // Nothing displayable -> no line at all, rather than an empty heading.
  assert.equal(S.indicatorHTML(BFI), '');
});

// ── Disclosure is not performance (brief §13) ──────────────────────────────────────────
test('a disclosure "No" is worded as "not reported", never as poor performance', () => {
  assert.equal(S.valueLine({ kind: 'disclosure', value: 'No' }), 'Not reported in this benchmark');
  assert.equal(S.valueLine({ kind: 'disclosure', value: 'Yes' }), 'Reported');
  assert.equal(S.valueLine({ kind: 'disclosure', value: 'Partially' }), 'Partly reported in this benchmark');
  // A performance figure is passed through untouched — it is a measurement, not a disclosure.
  assert.equal(S.valueLine({ kind: 'performance', value: '626,000 tonnes' }), '626,000 tonnes');
  const html = S.detailHTML(GARFIELD);
  assert.match(html, /Not reported in this benchmark/);
  assert.ok(!/>No</.test(html), 'a bare "No" must not render as the value');
  assert.match(html, /it is not a measurement of how the company performs/);
});

// ══════════════════════════════════════════════════════════════════════════════════════
// Added by the Williamson County coverage-validation pilot (2026-08-10). Everything below
// pins a state or a defect the SECOND geography surfaced and Del Valle never reached.
// ══════════════════════════════════════════════════════════════════════════════════════

// A company WikiRate has never heard of, and a company whose lookup could not be completed,
// are different answers and must stay so. Williamson produced 30 of the first and, before the
// retry loop, 41 requests of the second.
const NO_MATCH = {
  id: 'proj-nomatch', name: 'Longhorn Disposal site',
  sustainability: { companies: [
    { role: 'Operator', source: 'WikiRate', attribution: 'direct_company',
      company_name: 'LONGHORN DISPOSAL, INC.', identity_tier: 'identifier_backed',
      identity_verification: 'HIGH_CONFIDENCE', lookup_status: 'checked_no_data',
      parent_of_name: null, external_company_name: null, indicators: [] } ] }
};
const REJECTED = {
  id: 'proj-rejected', name: 'Cypress Semiconductor site',
  sustainability: { companies: [
    { role: 'Operator', source: 'WikiRate', attribution: 'direct_company',
      company_name: 'CYPRESS SEMICONDUCTOR CORPORATION', identity_tier: 'identifier_backed',
      identity_verification: 'HIGH_CONFIDENCE', lookup_status: 'ambiguous_rejected',
      parent_of_name: null, external_company_name: null, indicators: [] } ] }
};
const INCOMPLETE = {
  id: 'proj-incomplete', name: 'Timed-out lookup',
  sustainability: { companies: [
    { role: 'Operator', source: 'WikiRate', attribution: 'direct_company',
      company_name: 'SPAWGLASS CONTRACTORS, INC.', identity_tier: 'identifier_backed',
      identity_verification: 'HIGH_CONFIDENCE', lookup_status: 'error',
      parent_of_name: null, external_company_name: null, indicators: [] } ] }
};
const MATCHED_EMPTY = {
  id: 'proj-matched-empty', name: 'Matched but nothing displayable',
  sustainability: { companies: [
    { role: 'Operator', source: 'WikiRate', attribution: 'direct_company',
      company_name: 'Example Matched Co.', identity_tier: 'identifier_backed',
      identity_verification: 'VERIFIED', lookup_status: 'matched',
      parent_of_name: null, external_company_name: 'Example Matched', indicators: [] } ] }
};

test('no-match, matched-with-nothing, rejected and incomplete are four different states', () => {
  // They must never collapse into one "no ESG data" bucket — the reason we found nothing is
  // the whole output of a coverage pilot.
  const states = [NO_MATCH, MATCHED_EMPTY, REJECTED, INCOMPLETE]
    .map(r => S.direct(r)[0].lookup_status);
  assert.deepEqual(states, ['checked_no_data', 'matched', 'ambiguous_rejected', 'error']);
  assert.equal(new Set(states).size, 4);
  // None of them displays anything, and none of them displays a zero.
  [NO_MATCH, MATCHED_EMPTY, REJECTED, INCOMPLETE].forEach(r => {
    assert.equal(S.indicatorHTML(r), '');
    assert.equal(S.detailHTML(r), '');
    assert.equal(S.withData(r).length, 0);
  });
});

test('an incomplete lookup is never rendered as "no data found"', () => {
  // A timeout means we did not finish looking. Saying "no sustainability data found in the
  // sources checked" would assert a search concluded when it did not.
  const c = S.direct(INCOMPLETE)[0];
  assert.equal(c.lookup_status, 'error');
  assert.notEqual(S.STATE_LINE.no_data, S.STATE_LINE.not_checked);
  assert.ok(!/No sustainability data found/.test(S.detailHTML(INCOMPLETE)));
  assert.ok(!/no other sustainability information exists/i.test(
    Object.values(S.STATE_LINE).join(' ')));
});

test('a rejected WikiRate candidate never becomes a company on the card', () => {
  // WikiRate offered "Cypress Semiconductor" and "Southland (Cambodia) Co. Ltd."; neither is
  // key-equal to the resolved identity, so neither may appear anywhere.
  const html = S.detailHTML(REJECTED) + S.indicatorHTML(REJECTED)
    + JSON.stringify(S.evidenceEntries(REJECTED));
  assert.ok(!/Cypress Semiconductor</.test(html));
  assert.ok(!/Southland/.test(html));
  assert.equal(S.direct(REJECTED)[0].external_company_name, null,
    'a rejected candidate leaves no external name on the identity');
});

test('direct and parent statistics stay separately addressable', () => {
  // The renderer must never let a parent match be counted as direct coverage. The two lists
  // are disjoint by construction, and the first-level wording differs.
  const both = { id: 'both', sustainability: { companies:
    S.direct(NO_MATCH).concat(S.parents(GARFIELD)) } };
  assert.equal(S.direct(both).length, 1);
  assert.equal(S.parents(both).length, 1);
  assert.equal(S.direct(both).filter(c => S.parents(both).includes(c)).length, 0);
  // Only the parent has data, so the card says parent-company — not "company".
  assert.equal(textOf(S.indicatorHTML(both)), 'Parent-company sustainability information available');
});
