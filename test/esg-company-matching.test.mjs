// esg-company-matching.test.mjs — drives the SHIPPED ESG matcher/classifier, not a copy.
// The governing rule under test: no ESG result is better than the wrong company's ESG result.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fn = join(root, 'supabase/functions/esg-refresh');
const {
  normalizeCompanyName, companyCore, nameVariants, classifyCandidate,
  resolveCandidates, companyFromSiteName, isDisplayable, DISPLAY_TIERS,
} = await import(join(fn, 'normalize.ts'));
const {
  parseMetricName, pillarFor, isHeadlineMetric, displayableValue, displayTitle,
  classifyAnswers, designerIsDisplayable, searchCompany,
} = await import(join(fn, 'wikirate.ts'));

const REGISTRY = JSON.parse(readFileSync(join(fn, 'company-aliases.json'), 'utf8')).companies;
const entry = (k) => REGISTRY.find((e) => e.company_key === k);
let n = 0;
const t = (name, f) => { f(); n++; console.log('  ok', name); };

console.log('normalization');
t('legal suffixes are stripped to a comparison core', () => {
  assert.equal(companyCore('Amazon.com, Inc.'), 'amazon com');
  assert.equal(companyCore('Equinix Inc.'), 'equinix');
  assert.equal(companyCore('Digital Realty Trust Inc'), 'digital realty');
  assert.equal(companyCore('Microsoft Corporation'), 'microsoft');
});
t('a name of only legal tokens does NOT collapse to empty', () => {
  // An empty core would be equal to every other empty core — a match-everything bug.
  // Every token is a legal form, so stripping would empty it — the normalized name is kept.
  assert.equal(companyCore('The Company Ltd'), 'the company ltd');
  assert.notEqual(companyCore('The Company Ltd'), '');
});
t('ampersand and accents fold deterministically', () => {
  assert.equal(normalizeCompanyName('Sand & Gravel'), 'sand and gravel');
  assert.equal(normalizeCompanyName('Nestlé S.A.'), 'nestle s a');
});
t('variants are ordered most-specific first', () => {
  const v = nameVariants('Amazon.com, Inc.');
  assert.equal(v[0], 'Amazon.com, Inc.');
  assert.ok(v.includes('amazon com'));
});

console.log('candidate classification — substring is NOT a match');
t('the Amazonia false-friend set is rejected', () => {
  // Live 2026-08-09: filter[name]=Amazon returns these alongside Amazon.com, Inc.
  for (const noise of ['Banco da Amazonia', 'Amazonas Industria e Comercio Ltda.',
                       'Copag da Amazonia SA', 'Orient Relogios Da Amazonia Ltda.']) {
    assert.equal(classifyCandidate('Amazon.com, Inc.', noise), null, noise);
  }
  assert.equal(classifyCandidate('Amazon.com, Inc.', 'Amazon.com, Inc.'), 'exact');
});
t('a legal-form-only difference is HIGH, not exact', () => {
  assert.equal(classifyCandidate('Equinix Inc.', 'Equinix'), 'high');
});
t('an exact hit wins over a high-tier near-twin', () => {
  const r = resolveCandidates('Tesla Motors', [
    { id: 6273, name: 'Tesla Motors' },
    { id: 9763819, name: 'TESLA MOTORS LIMITED' },   // core-equal → high
    { id: 8220974, name: 'TESLA MOTORS AUSTRALIA, PTY LTD' },
  ]);
  assert.equal(r.confidence, 'exact');
  assert.equal(r.candidate.id, 6273);
});
t('a genuine tie HOLDS instead of picking the first', () => {
  const r = resolveCandidates('Acme Corp', [
    { id: 1, name: 'Acme Corporation' },
    { id: 2, name: 'Acme Co' },
  ]);
  assert.equal(r.confidence, 'ambiguous');
  assert.equal(r.candidate, null);
  assert.equal(r.tied.length, 2);
});
t('the same card returned twice is not ambiguity', () => {
  const r = resolveCandidates('Equinix Inc.', [{ id: 7, name: 'Equinix Inc.' }, { id: 7, name: 'Equinix Inc.' }]);
  assert.equal(r.confidence, 'exact');
});
t('only exact/high/parent are displayable; unknown fails closed', () => {
  assert.deepEqual([...DISPLAY_TIERS], ['exact', 'high', 'parent']);
  assert.equal(isDisplayable('ambiguous'), false);
  assert.equal(isDisplayable(undefined), false);
  assert.equal(isDisplayable('EXACT'), false);   // case-sensitive on purpose
});

console.log('facility-name identification — the real live traps');
t('ALPHABET GARDEN CHILDCARE is never Alphabet Inc', () => {
  const r = companyFromSiteName('ALPHABET GARDEN CHILDCARE-TREATMENT PLANT 1', REGISTRY);
  assert.equal(r.entry, null);
  assert.notEqual(r.outcome, 'matched');
});
t('PG&E TESLA SUBSTATION is not Tesla (Tesla, CA is a place)', () => {
  const r = companyFromSiteName('PG&E TESLA SUBSTATION', REGISTRY);
  assert.equal(r.entry, null);
  assert.equal(r.outcome, 'denied');
});
t('WALMART C/O TESLA ENERGY is held, not attributed to Tesla', () => {
  const r = companyFromSiteName('WALMART C/O TESLA ENERGY', REGISTRY);
  assert.equal(r.entry, null);
});
t('ExecuTesla (a real 78617 permit) does not match Tesla — whole tokens only', () => {
  const r = companyFromSiteName('ExecuTesla', REGISTRY);
  assert.equal(r.entry, null);
  assert.equal(r.outcome, 'no_match');
});
t('AMAZONIA does not match the amazon entry', () => {
  assert.equal(companyFromSiteName('AMAZONAS INDUSTRIA E COMERCIO', REGISTRY).entry, null);
});
t('a genuine facility name still matches', () => {
  assert.equal(companyFromSiteName('MICROSOFT PHX 16 DATA CENTER', REGISTRY).entry.company_key, 'microsoft');
  assert.equal(companyFromSiteName('TESLA FORT LAUDERDALE WAREHOUSE', REGISTRY).entry.company_key, 'tesla');
});
t('two companies in one name is AMBIGUOUS with both named', () => {
  const r = companyFromSiteName('MICROSOFT / EQUINIX JOINT FACILITY', REGISTRY);
  assert.equal(r.outcome, 'ambiguous');
  assert.deepEqual(r.competing.sort(), ['equinix', 'microsoft']);
});
t('the Del Valle owners are registered and resolve to their own keys', () => {
  assert.equal(companyFromSiteName('Neuralink Corporation', REGISTRY).entry.company_key, 'neuralink');
  assert.equal(companyFromSiteName('RIVER BOTTOMS RANCH LLC', REGISTRY).entry.company_key, 'river-bottoms-ranch');
  assert.equal(companyFromSiteName('BFI WASTE SYSTEMS OF TEXAS LP', REGISTRY).entry.company_key, 'bfi-waste-systems-tx');
});
t('no Del Valle HOLD entry smuggles in a parent link', () => {
  // The BFI→Republic and TXI→Martin Marietta lineages are unsourced; a parent_key here
  // would attach a real company's ESG to a facility on nothing but folklore.
  assert.equal(entry('bfi-waste-systems-tx').parent_key, undefined);
  assert.equal(entry('txi-garfield').parent_key, undefined);
});

console.log('licensing gate');
t('proprietary rating designers are refused even if allowlisted by mistake', () => {
  for (const d of ['MSCI', 'Sustainalytics', 'S&P Global ESG', 'ISS ESG', 'Refinitiv', 'EcoVadis']) {
    assert.equal(designerIsDisplayable(d), false, d);
  }
});
t('an unknown designer fails CLOSED', () => {
  assert.equal(designerIsDisplayable('Some Research Group 2019'), false);
  assert.equal(designerIsDisplayable('World Benchmarking Alliance'), true);
});

console.log('metric selection and value honesty');
t('metric names split into designer / title / research group', () => {
  const p = parseMetricName('World Benchmarking Alliance+Greenhouse Gas Emissions Reduction Targets+World Benchmarking Alliance Research Group');
  assert.equal(p.designer, 'World Benchmarking Alliance');
  assert.equal(p.title, 'Greenhouse Gas Emissions Reduction Targets');
  assert.equal(p.scored, true);
  assert.equal(parseMetricName('World Benchmarking Alliance+Urban Benchmark').scored, false);
});
t('the WBA benchmark code prefix is stripped, the wording kept verbatim', () => {
  assert.equal(displayTitle('URB-A.01.A - Material Sustainability Impact Identification'), 'Material Sustainability Impact Identification');
  assert.equal(displayTitle('JST-01 - Fundamentals of social dialogue'), 'Fundamentals of social dialogue');
  assert.equal(displayTitle('Greenhouse Gas Emissions Reporting'), 'Greenhouse Gas Emissions Reporting');
});
t('the homeowner shortlist selects subjects, code-prefixed or not', () => {
  assert.equal(isHeadlineMetric('Greenhouse Gas Emissions Reporting'), true);
  assert.equal(isHeadlineMetric('URB-D.02.A - Waste Reduction Target'), true);      // code prefix ignored
  assert.equal(isHeadlineMetric('URB-A.01.C - Materiality Stakeholder Consultation Disclosure'), false);
  assert.equal(isHeadlineMetric('Digital Access Programme Targeting Women and Girls'), false);
});
t('REGRESSION: the shortlist must not be jointly empty with the value rule', () => {
  // The defect this replaced: "headline roll-ups only" + "Yes/No values only" were each
  // defensible and together matched NOTHING — measured 2026-08-09, Republic Services'
  // 55 Yes/No answers yielded 0. A real WBA answer shape must survive both filters.
  const real = [
    { metric: 'World Benchmarking Alliance+URB-D.03.A - Waste Reduction Target', company: 'Republic Services', year: 2025, value: 'No' },
    { metric: 'World Benchmarking Alliance+URB-A.03.A - Governance Body Sustainability Responsibility', company: 'Republic Services', year: 2025, value: 'Yes' },
    { metric: 'World Benchmarking Alliance+URB-A.01.D - Sustainability Strategy Disclosure', company: 'Republic Services', year: 2025, value: 'Yes' },
    { metric: 'World Benchmarking Alliance+Urban Benchmark', company: 'Republic Services', year: 2025, value: '1.8623333' },
  ];
  const out = classifyAnswers(real);
  const total = out.environmental.length + out.social.length + out.governance.length + out.unclassified.length;
  assert.ok(total >= 3, 'a real WBA answer set must yield displayable rows, not silently nothing');
  assert.ok(out.environmental.some((m) => m.label === 'Waste Reduction Target'));
  assert.ok(out.governance.some((m) => m.label === 'Governance Body Sustainability Responsibility'));
  // "Sustainability Strategy Disclosure" names no pillar in its own words, so it is shown
  // under "Other reported areas" rather than being forced into one.
  assert.ok(out.unclassified.some((m) => m.label === 'Sustainability Strategy Disclosure'));
  // The scale-less roll-up is still suppressed.
  assert.ok(!JSON.stringify(out).includes('1.8623333'));
});
t('a scale-less number is SUPPRESSED, never rendered as a score', () => {
  // WikiRate publishes no unit/value_type for these metrics (both sub-cards 404, 2026-08-09),
  // so "1.8623333" has no stated maximum anywhere in the API.
  assert.equal(displayableValue('1.8623333333333332'), null);
  assert.equal(displayableValue('10.0'), null);
  assert.deepEqual(displayableValue('Yes'), { text: 'Yes', kind: 'disclosure' });
  assert.deepEqual(displayableValue('no'), { text: 'No', kind: 'disclosure' });
});
t('pillars come from the metric’s own words, and unknown stays unclassified', () => {
  assert.equal(pillarFor('Greenhouse Gas Emissions Reporting'), 'environmental');
  assert.equal(pillarFor('URB-D - Climate Change and Resilient Cities'), 'environmental');
  assert.equal(pillarFor('URB-A - Sustainable Governance'), 'governance');
  assert.equal(pillarFor('Diversity and inclusion policy'), 'social');
  assert.equal(pillarFor('Zorp Index'), 'unclassified');
});
t('classifyAnswers keeps only licence-clean, headline, scale-free values', () => {
  const out = classifyAnswers([
    { metric: 'World Benchmarking Alliance+Greenhouse Gas Emissions Reporting', company: 'X', year: 2025, value: 'Yes' },
    { metric: 'World Benchmarking Alliance+Greenhouse Gas Emissions Reporting+WBA Research Group', company: 'X', year: 2025, value: '10.0' },
    { metric: 'World Benchmarking Alliance+URB-A.02.C - Action Plan Disclosure', company: 'X', year: 2025, value: 'No' },
    { metric: 'World Benchmarking Alliance+Urban Benchmark', company: 'X', year: 2025, value: '1.86' },
    { metric: 'MSCI+ESG Rating', company: 'X', year: 2025, value: 'AA' },
  ]);
  assert.equal(out.environmental.length, 1);
  assert.equal(out.environmental[0].value, 'Yes');
  assert.equal(out.environmental[0].source, 'wba');
  assert.equal(out.reporting_year, 2025);
  // everything else is dropped WITH a reason (auditable, not silent)
  assert.equal(out.dropped.length, 4);
  assert.ok(out.dropped.every((d) => d.reason && d.reason.length > 5));
  assert.ok(out.dropped.some((d) => /allowlist/.test(d.reason)));
});
t('an overall score is never synthesised from the pillar values', () => {
  const out = classifyAnswers([
    { metric: 'World Benchmarking Alliance+Greenhouse Gas Emissions Reporting', company: 'X', year: 2025, value: 'Yes' },
  ]);
  assert.equal('overall_score' in out, false);
  assert.equal('score' in out, false);
});

console.log('search — company_id only, ties terminal');
t('searchCompany stops at a tie and never falls through to a looser variant', async () => {
  const calls = [];
  const fake = async (url) => {
    calls.push(url);
    return { ok: true, status: 200, json: async () => ({ items: [{ id: 1, name: 'Acme Corporation' }, { id: 2, name: 'Acme Co' }] }) };
  };
  const r = await searchCompany('Acme Corp', fake);
  assert.equal(r.confidence, 'ambiguous');
  assert.equal(calls.length, 1, 'a tie must be terminal, not retried with a looser query');
});
t('searchCompany records every payload it saw for the raw cache', async () => {
  const fake = async () => ({ ok: true, status: 200, json: async () => ({ items: [{ id: 9, name: 'Equinix Inc.' }] }) });
  const r = await searchCompany('Equinix Inc.', fake);
  assert.equal(r.confidence, 'exact');
  assert.equal(r.raw.length, 1);
  assert.ok(r.raw[0].endpoint.includes('filter%5Bname%5D='));
});

console.log(`\n${n} assertions passed`);
