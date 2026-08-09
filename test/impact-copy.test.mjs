// Pins the property-card copy pass (2026-08-09):
//   1. the factual record sentence — grammar, lifecycle wording, noun specificity
//   2. the Quality of Life Impact Score™ suppression gate
//
// The sentence this replaced was built by concatenating raw field values,
// `'A ' + status + ' ' + type`, and shipped "A operating industrial is on the public
// record near you": wrong article, an adjective standing in for a noun, and a claim
// about where the reader lives. Every assertion below exists to keep one of those back.
// Run: node --test test/impact-copy.test.mjs
import test from 'node:test';
import assert from 'node:assert';

global.window = { HS: {} };
await import('../lib/templates.js');
await import('../lib/impact.js');
const HS = global.window.HS;

const say = p => HS.projectImpact(p);

// ── 1. grammar ──────────────────────────────────────────────────────────────
test('the article agrees with the word that follows it', () => {
  // The article is computed from the PHRASE, so a lifecycle adjective in front of a
  // consonant noun flips it: "warehouse" -> a, "approved warehouse" -> an.
  const pairs = [
    [{ type: 'Industrial', status: 'Operating' }, /^An operating/],
    [{ type: 'Industrial', status: 'Proposed' },  /^A proposed/],
    [{ type: 'Industrial', status: 'Approved' },  /^An approved/],
    [{ type: 'Warehouse',  status: 'On file' },   /^A warehouse/],
    [{ type: 'Warehouse',  status: 'Approved' },  /^An approved warehouse/],
    [{ type: 'Office',     status: 'On file' },   /^An office/],
    // "utility" is spelt with a vowel and sounds like a consonant — the classic trap.
    [{ type: 'Utility',    status: 'On file' },   /^A utility/],
    [{ type: 'unclassified', status: 'Proposed' }, /^A proposed development/]
  ];
  for (const [rec, re] of pairs) {
    assert.match(say(rec), re, JSON.stringify(rec));
  }
});

test('no record produces the broken constructions this pass removed', () => {
  const specimens = [
    { type: 'industrial', status: 'Operating', record_kind: 'facility' },
    { type: 'Industrial', status: 'Proposed' },
    { type: 'animal-facility', status: 'Active' },
    { type: 'Utility', status: 'Approved', stage: 'Construction' },
    { type: 'unclassified', status: 'On file' },
    { type: 'Data Center', status: 'Proposed' },
    {}
  ];
  for (const rec of specimens) {
    const s = say(rec);
    assert.doesNotMatch(s, /\bA (a|e|i|o)[a-z]/, 'a + vowel: ' + s);
    assert.doesNotMatch(s, /\bAn [bcdfgjklmnpqrstvwxyz]/, 'an + consonant: ' + s);
    assert.doesNotMatch(s, /\b(unknown|undefined|null|on file)\b/i, 'raw field value leaked: ' + s);
    // "industrial is …" — an adjective used where a noun belongs.
    assert.doesNotMatch(s, /\b(industrial|commercial|residential|proposed|approved|operating) is\b/,
      'bare adjective used as a noun: ' + s);
    assert.match(s, /^[A-Z]/, 'starts capitalised: ' + s);
    assert.match(s, /\.$/, 'ends as a sentence: ' + s);
    assert.ok(s.length <= 140, 'within the card budget: ' + s.length);
    assert.strictEqual(s, say(rec), 'deterministic');
  }
});

test('the lifecycle word is never doubled', () => {
  // A source whose type text already carries the lifecycle word must not repeat it.
  assert.strictEqual(say({ type: 'Proposed Development', status: 'Proposed' }),
    'A proposed development is listed in public records near this location.');
});

// ── 2. lifecycle vocabulary ─────────────────────────────────────────────────
test('each lifecycle renders its own wording', () => {
  const t = 'Industrial';
  assert.match(say({ type: t, status: 'Proposed' }),  /A proposed industrial development/);
  assert.match(say({ type: t, status: 'Approved' }),  /An approved industrial development/);
  assert.match(say({ type: t, status: 'Operating' }), /An operating industrial development/);
  assert.match(say({ type: t, status: 'Active' }),    /An operating industrial development/);
  assert.match(say({ type: t, status: 'Closed' }),    /A closed industrial development/);
  // Construction is POSTPOSITIVE — a state the project is in, not a kind of project.
  assert.match(say({ type: t, status: 'Approved', stage: 'Construction' }),
    /An industrial development under construction/);
});

test('an unstated lifecycle drops the adjective rather than naming one', () => {
  for (const status of ['On file', 'Decided', '', undefined, 'Zorp']) {
    const s = say({ type: 'Industrial', status });
    assert.strictEqual(s, 'An industrial development is listed in public records near this location.',
      'status ' + JSON.stringify(status));
  }
  // and a proposed record is never re-read as under construction by a stray stage word
  assert.match(say({ type: 'Industrial', status: 'Proposed', stage: 'Construction Plans In Review' }),
    /^A proposed industrial development/);
});

// ── 3. noun specificity — quoted from the source, never promoted ────────────
test('a specific noun is used only when the source states it', () => {
  assert.match(say({ type: 'Data Center', status: 'Proposed' }), /a proposed data center/i);
  assert.match(say({ type: 'Manufacturing', status: 'Operating', record_kind: 'facility' }),
    /an operating manufacturing facility/i);
  assert.match(say({ type: 'Warehouse', status: 'Approved' }), /an approved warehouse/i);
  assert.match(say({ type: 'Power', status: 'Operating', record_kind: 'facility' }),
    /an operating power facility/i);
});

test('a generic bucket never becomes a specific facility type', () => {
  for (const type of ['unclassified', 'Development', 'other', 'Project', '', null]) {
    const s = say({ type, status: 'Proposed' });
    assert.strictEqual(s, 'A proposed development is listed in public records near this location.',
      'type ' + JSON.stringify(type) + ' must stay generic');
    assert.doesNotMatch(s, /data center|manufacturing|warehouse|power|industrial/i);
  }
});

test('the record kind picks the head noun, and never doubles it', () => {
  assert.match(say({ type: 'industrial', status: 'Operating', record_kind: 'facility' }),
    /^An operating industrial facility/);
  assert.match(say({ type: 'industrial', status: 'Proposed' }),
    /^A proposed industrial development/);
  // a type that already ends in a head noun is used as filed
  assert.match(say({ type: 'animal-facility', status: 'Active' }), /^An operating animal facility/);
  assert.doesNotMatch(say({ type: 'animal-facility', status: 'Active' }), /facility facility/);
  // road/utility records are projects — "utility development" would misdescribe them
  assert.match(say({ type: 'Utility', status: 'Approved' }), /^An approved utility project/);
});

test('sourced impact_dimensions still win over the factual sentence', () => {
  // The dimension-derived branches are untouched by this pass; the factual sentence is
  // only the no-dimensions fallback.
  const s = say({ type: 'Data Center', status: 'Proposed',
                  impact_dimensions: [{ label: 'Water', bad: true }, { label: 'Traffic', bad: true }] });
  assert.match(s, /water/i);
  assert.doesNotMatch(s, /is listed in public records/);
});

// ── 4. the Quality of Life Impact Score™ gate ───────────────────────────────
test('the stored score is declared a lifecycle constant and is not displayable', () => {
  assert.strictEqual(HS.IMPACT_SCORE_METHOD, 'lifecycle_constant');
  assert.strictEqual(HS.impactScoreIsEvidenceBased(), false);
  assert.strictEqual(HS.impactScoreDisplayable(), false);
});

test('the score is suppressed everywhere it used to render', () => {
  assert.strictEqual(HS.impactScoreValue(72), '', 'display value is empty');
  assert.strictEqual(HS.impactScoreValue(30), '', 'facility constant too');
  assert.strictEqual(HS.tpl.impactScoreLine({ impact_score: 72 }), '',
    'no paragraph, no label, no em-dash placeholder');
  const block = HS.tpl.devImpactBlock({ impact_score: 72, type: 'Industrial', status: 'Proposed' });
  assert.doesNotMatch(block, /Quality of Life Impact Score/, 'brand name gone from the card');
  assert.doesNotMatch(block, /72|High/, 'the number and its rating are gone');
  assert.match(block, /A proposed industrial development/, 'the factual sentence remains');
});

test('suppression leaves no empty container or orphan label', () => {
  const block = HS.tpl.devImpactBlock({ impact_score: 72, type: 'Industrial', status: 'Proposed' });
  // exactly one <p>, and it is the sentence — not a second, empty one
  assert.strictEqual((block.match(/<p\b/g) || []).length, 1, 'one paragraph only');
  assert.doesNotMatch(block, /<p[^>]*>\s*<\/p>/, 'no empty paragraph');
  assert.doesNotMatch(block, /<b>\s*<\/b>|:\s*<\/p>/, 'no label with nothing after it');
  assert.doesNotMatch(block, /—\s*<\/p>/, 'no em-dash placeholder');
  const card = HS.tpl.devCard({ id: 'x', name: 'N', impact_score: 72, type: 'Industrial', status: 'Proposed' });
  assert.doesNotMatch(card, /Quality of Life Impact Score/, 'devCard is clean too');
  assert.doesNotMatch(card, /<p[^>]*>\s*<\/p>/, 'devCard has no empty paragraph');
});

test('the scoring code is preserved, not deleted — the gate restores it', () => {
  // The original computation is intact under its own name...
  assert.strictEqual(HS.impactScoreRaw(72), '72 | High');
  assert.strictEqual(HS.impactScoreRaw(55), '55 | Medium');
  assert.strictEqual(HS.impactScoreRaw(30), '30 | Low');
  assert.strictEqual(HS.impactScoreRaw(null), '');
  // ...and flipping the gate brings the display back with no other change.
  HS.SHOW_LIFECYCLE_ONLY_SCORE = true;
  try {
    assert.strictEqual(HS.impactScoreDisplayable(), true);
    assert.strictEqual(HS.impactScoreValue(72), '72 | High');
    assert.match(HS.tpl.impactScoreLine({ impact_score: 72 }), /Quality of Life Impact Score/);
  } finally {
    HS.SHOW_LIFECYCLE_ONLY_SCORE = false;
  }
  assert.strictEqual(HS.impactScoreValue(72), '', 'gate closed again');
});

test('a real methodology re-enables the score without touching the gate flag', () => {
  const was = HS.IMPACT_SCORE_METHOD;
  HS.IMPACT_SCORE_METHOD = 'sourced_v1';
  try {
    assert.strictEqual(HS.impactScoreIsEvidenceBased(), true);
    assert.strictEqual(HS.impactScoreValue(72), '72 | High');
  } finally {
    HS.IMPACT_SCORE_METHOD = was;
  }
});
