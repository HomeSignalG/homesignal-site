// Pins lib/impact-resolver.js — the ONE deterministic Phase-2 impact scorer.
// Covers: distance decay bands, level thresholds, all four directions,
// absent-facts-stay-absent, metadata fallback + cautious wording, determinism,
// and the "Impact on me" comparator (incl. fallback demotion).
// Run: node test/impact-resolver.test.mjs
import test from 'node:test';
import assert from 'node:assert';

global.window = { HS: {} };
await import('../lib/impact-resolver.js');
const HS = global.window.HS;

const industrialFacts = {
  project_type: 'warehouse distribution center',
  truck_trips_per_day: 150,
  noise_sources: ['loading docks', 'truck idling'],
  nighttime_activity: true,
  document_quotes: [
    { page: 3, text: '150 truck trips per day', supports: 'truck_trips_per_day' },
    { page: 5, text: '24-hour loading dock operations', supports: 'nighttime_activity' }
  ]
};
const floodFacts = {
  project_type: 'regional detention basin',
  flood_control_features: ['detention basin', 'channel improvements'],
  document_quotes: [
    { page: 2, text: 'detention basin sized for the 100-year storm', supports: 'flood_control_features' },
    { page: 2, text: 'reduces downstream peak flows', supports: 'flood_control_features' }
  ]
};

test('distance decay bands match the documented table', () => {
  assert.strictEqual(HS.distanceWeight(0.3), 1.0);
  assert.strictEqual(HS.distanceWeight(0.5), 1.0);
  assert.strictEqual(HS.distanceWeight(0.8), 0.9);
  assert.strictEqual(HS.distanceWeight(1.5), 0.75);
  assert.strictEqual(HS.distanceWeight(4), 0.5);
  assert.strictEqual(HS.distanceWeight(8), 0.25);
  assert.strictEqual(HS.distanceWeight(25), 0.1);
  assert.strictEqual(HS.distanceWeight(null), 1.0, 'no home set -> no decay');
});

test('level thresholds: High 70-100, Medium 40-69, Low 0-39', () => {
  assert.strictEqual(HS.levelFor(100), 'high');
  assert.strictEqual(HS.levelFor(70), 'high');
  assert.strictEqual(HS.levelFor(69), 'medium');
  assert.strictEqual(HS.levelFor(40), 'medium');
  assert.strictEqual(HS.levelFor(39), 'low');
  assert.strictEqual(HS.levelFor(0), 'low');
});

test('documented industrial project near the home: high + negative + grounded sentence', () => {
  const r = HS.resolveProjectImpact({ extractedFacts: industrialFacts, projectMetadata: { type: 'Industrial' }, distanceMiles: 0.3 });
  assert.strictEqual(r.basis, 'document');
  assert.strictEqual(r.direction, 'negative');
  assert.ok(r.score >= 70, 'score high (got ' + r.score + ')');
  assert.strictEqual(r.level, 'high');
  assert.match(r.sentence, /truck traffic/i, 'names the documented truck traffic');
  assert.match(r.sentence, /noise/i, 'names the documented noise');
  assert.ok(!/warehouse distribution center/i.test(r.sentence), 'never repeats the project title');
  assert.ok(r.confidence >= 0.7, 'quantified + quoted facts -> high confidence');
  assert.ok(r.categoryScores.some(c => c.category === 'traffic'));
  assert.ok(r.categoryScores.some(c => c.category === 'noise'));
  assert.ok(r.evidence.some(e => e.fact === 'quote' && e.page === 3), 'document page refs preserved');
});

test('flood-control project: positive direction, improvement wording', () => {
  const r = HS.resolveProjectImpact({ extractedFacts: floodFacts, projectMetadata: {}, distanceMiles: 0.4 });
  assert.strictEqual(r.direction, 'positive');
  assert.match(r.sentence, /improve/i);
  assert.match(r.sentence, /drainage|flood/i);
  const cat = r.categoryScores.find(c => c.category === 'flooding/drainage');
  assert.ok(cat && cat.direction === 'positive');
});

test('mixed-use facts: mixed direction sentence carries both sides', () => {
  const r = HS.resolveProjectImpact({
    extractedFacts: {
      public_amenities: ['public plaza', 'trail connection'],
      vehicle_trips_per_day: 2400,
      unit_count: 220,
      document_quotes: [{ page: 1, text: 'x', supports: 'unit_count' }, { page: 2, text: 'y', supports: 'vehicle_trips_per_day' }]
    },
    projectMetadata: {}, distanceMiles: 0.4
  });
  assert.strictEqual(r.direction, 'mixed');
  assert.match(r.sentence, /improve .* while increasing/i);
});

test('distance weighting reduces the same document far away (and can drop the level)', () => {
  const near = HS.resolveProjectImpact({ extractedFacts: industrialFacts, distanceMiles: 0.3 });
  const far = HS.resolveProjectImpact({ extractedFacts: industrialFacts, distanceMiles: 12 });
  assert.ok(near.score > far.score);
  assert.strictEqual(far.factors.distanceWeight, 0.1);
  assert.strictEqual(far.level, 'low', 'a strong project 12 mi away is low-magnitude for this home');
  assert.strictEqual(far.direction, near.direction, 'distance never flips direction');
});

test('absent facts stay absent — an empty extraction claims no effects', () => {
  const r = HS.resolveProjectImpact({ extractedFacts: { project_type: null, unit_count: null }, projectMetadata: { type: 'Commercial' }, distanceMiles: 0.2 });
  assert.strictEqual(r.categoryScores.length, 0);
  assert.strictEqual(r.score, 0);
  assert.strictEqual(r.direction, 'neutral');
  assert.match(r.sentence, /does not document|more detail is needed/i);
});

test('metadata fallback: low confidence, cautious wording, marked fallback-derived', () => {
  const r = HS.resolveProjectImpact({ extractedFacts: null, projectMetadata: { type: 'Industrial', status: 'Proposed' }, distanceMiles: 0.4 });
  assert.strictEqual(r.basis, 'metadata_fallback');
  assert.ok(r.confidence <= 0.35, 'fallback confidence stays low (got ' + r.confidence + ')');
  assert.match(r.sentence, /suggests|may|could/i, 'cautious modal wording');
  assert.ok(r.score < 70, 'fallback never scores high');
});

test('unknown metadata: neutral, very low confidence, honest sentence', () => {
  const r = HS.resolveProjectImpact({ extractedFacts: null, projectMetadata: {}, distanceMiles: null });
  assert.strictEqual(r.score, 0);
  assert.strictEqual(r.direction, 'neutral');
  assert.ok(r.confidence <= 0.15);
  assert.match(r.sentence, /can’t be determined|limited/i);
});

test('descriptive-only extraction without grounded quotes uses cautious wording', () => {
  const r = HS.resolveProjectImpact({ extractedFacts: { noise_sources: ['outdoor stage'] }, distanceMiles: 0.3 });
  assert.ok(r.confidence < 0.45, 'no quotes + no numbers -> below cautious threshold');
  assert.match(r.sentence, /suggests|may|could/i);
});

test('deterministic repeatability — identical input, identical output', () => {
  const input = { extractedFacts: industrialFacts, projectMetadata: { type: 'Industrial' }, distanceMiles: 1.2 };
  const a = HS.resolveProjectImpact(input), b = HS.resolveProjectImpact(input);
  assert.strictEqual(JSON.stringify(a), JSON.stringify(b));
  assert.strictEqual(a.version, HS.IMPACT_RESOLVER_VERSION);
});

test('"Impact on me" comparator: score desc, confidence desc, distance asc, newest', () => {
  const P = (score, conf, basis, dist, sub) => ({
    impact_resolved: { score, confidence: conf, basis }, distance_mi: dist, submitted_at: sub
  });
  const cmp = HS.impactSortCompare;
  assert.ok(cmp(P(80, 0.8, 'document', 1, '2026-01-01'), P(60, 0.8, 'document', 1, '2026-01-01')) < 0, 'score desc');
  assert.ok(cmp(P(60, 0.9, 'document', 1, '2026-01-01'), P(60, 0.3, 'document', 1, '2026-01-01')) < 0, 'confidence desc');
  assert.ok(cmp(P(60, 0.5, 'document', 0.4, '2026-01-01'), P(60, 0.5, 'document', 3, '2026-01-01')) < 0, 'distance asc');
  assert.ok(cmp(P(60, 0.5, 'document', 1, '2026-06-01'), P(60, 0.5, 'document', 1, '2026-01-01')) < 0, 'newest last tiebreak');
});

test('fallback demotion: a generic fallback never outranks a similar well-supported score', () => {
  const doc = { impact_resolved: { score: 58, confidence: 0.8, basis: 'document' }, distance_mi: 1 };
  const fb = { impact_resolved: { score: 65, confidence: 0.3, basis: 'metadata_fallback' }, distance_mi: 0.5 };
  assert.ok(HS.impactSortCompare(doc, fb) < 0, 'document-based 58 outranks fallback 65 (within tolerance)');
  const fbBig = { impact_resolved: { score: 90, confidence: 0.3, basis: 'metadata_fallback' }, distance_mi: 0.5 };
  assert.ok(HS.impactSortCompare(fbBig, doc) < 0, 'a genuinely larger raw gap still wins');
});

test('attachResolvedImpact resolves every project (with or without an analysis row)', () => {
  const projects = [
    { source_ref: 'https://x/1', type: 'Industrial', distance_mi: 0.3 },
    { source_ref: 'https://x/2', type: 'Commercial', distance_mi: 2 }
  ];
  const byRef = { 'https://x/1': { extraction_status: 'extracted', extracted_facts: industrialFacts } };
  const out = HS.attachResolvedImpact(projects, byRef);
  assert.strictEqual(out[0].impact_resolved.basis, 'document');
  assert.strictEqual(out[1].impact_resolved.basis, 'metadata_fallback');
  assert.ok(out.every(p => p.impact_resolved && typeof p.impact_resolved.score === 'number'));
});
