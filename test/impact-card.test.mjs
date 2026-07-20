// Pins the Phase-2 card + page wiring: the resolved impact line (level ·
// score/100 · direction + sentence) replaces the generic placeholder WITHOUT
// removing any existing card information, every page path resolves through the
// ONE shared resolver, and "Impact on me" uses the shared comparator.
// Run: node test/impact-card.test.mjs
import test from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';

global.window = { HS: {} };
await import('../lib/templates.js');
await import('../lib/impact.js');
await import('../lib/impact-resolver.js');
const HS = global.window.HS;

const resolved = {
  id: 'p1', name: 'Distribution Center', status: 'Proposed', type: 'Industrial',
  stage: 'Under review', dist: '0.4 mi', sowhat: '', source_ref: 'https://x/rec/1',
  impact_resolved: {
    score: 82, level: 'high', direction: 'negative', confidence: 0.8, basis: 'document',
    sentence: 'Likely to increase truck traffic and nighttime noise near the home.',
    categoryScores: [], evidence: [], factors: { base: 82, distanceWeight: 1 }, version: 'impact-score-v1'
  }
};

test('devCard shows level · score/100 · direction plus the grounded sentence', () => {
  const html = HS.tpl.devCard(Object.assign({}, resolved, HS.tpl ? {} : {}));
  assert.match(html, /class="ibadge high"/, 'level badge present');
  assert.match(html, /High · 82\/100/, 'score renders as level · NN/100');
  assert.match(html, /class="idir negative"/, 'direction label present');
  assert.match(html, /Likely to increase truck traffic/, 'grounded sentence rendered');
  assert.doesNotMatch(html, /open the official filing to learn what may change/i, 'generic placeholder replaced');
});

test('no existing card information removed — resolved and unresolved cards keep every element', () => {
  const base = { id: 'p2', name: 'Plaza', status: 'Approved', type: 'Commercial', stage: 'Permits issued', dist: '1.1 mi', sowhat: 'spec line', impact_dimensions: [{ k: 'traffic', label: 'Traffic', bad: true, dir: 'up' }] };
  for (const p of [base, Object.assign({}, base, { impact_resolved: resolved.impact_resolved })]) {
    const html = HS.tpl.devCard(p);
    assert.match(html, /class="lens"/, 'status/type lens kept');
    assert.match(html, /<h3>Plaza<\/h3>/, 'title kept');
    assert.match(html, /class="impactline"/, 'Impact line kept');
    assert.match(html, /class="sowhat"/, 'sowhat line kept');
    assert.match(html, /class="impacts"/, 'impact chips block kept');
    assert.match(html, /class="foot"/, 'footer kept');
    assert.match(html, /class="status appr"/, 'status pill kept');
    assert.match(html, /1\.1 mi/, 'distance kept');
    assert.match(html, /Permits issued/, 'stage kept');
  }
});

test('unresolved card falls back to the deterministic Phase-1 sentence (never blocked)', () => {
  const html = HS.tpl.devCard({ id: 'p3', name: 'Depot', status: 'Proposed', type: 'Industrial' });
  assert.match(html, /class="impactline"/);
  assert.match(html, /public record|on file/i, 'Phase-1 factual fallback still renders');
});

test('development.html wires the shared resolver + comparator + analyses join', () => {
  const page = readFileSync(new URL('../development.html', import.meta.url), 'utf8');
  assert.match(page, /lib\/impact-resolver\.js/, 'page loads the shared resolver');
  assert.match(page, /HS\.attachResolvedImpact\(/, 'projects resolved through the shared resolver');
  assert.match(page, /HS\.data\.impactAnalyses\(/, 'per-document analyses joined by source_ref');
  assert.match(page, /a\.sort\(HS\.impactSortCompare\)/, '"Impact on me" uses the shared comparator');
  assert.match(page, /Impact analysis/, 'detail view carries the impact-analysis block');
});

test('data layer exposes the analyses join (public-read table, chunked in())', () => {
  const src = readFileSync(new URL('../lib/data.js', import.meta.url), 'utf8');
  assert.match(src, /async impactAnalyses\(sourceRefs\)/);
  assert.match(src, /development_impact_analyses/);
});
