// Pins HS.card (lib/property-card.js) — the state vocabulary and renderers shared by the full
// property card (property-card.html) and the Maps slide-in that links to it (maps.html).
//
// WHY EVERY ASSERTION HERE IS AN ANTI-FABRICATION GATE. The card's only job is to keep five
// different facts visibly different: we looked and found records · we looked and found none ·
// we have not looked · we tried and the source failed · the source refuses access. Collapse any
// two of those and the card starts asserting things nobody checked. The specific collapse this
// file exists to make impossible is a COUNT next to a source we never queried: a "0" there
// reads as "clean", which is the defect PR #662 had to repair on the ZIP page after a failed
// EPA read rendered as zero facilities.
//
// Run: node --test test/property-card.test.mjs
import test from 'node:test';
import assert from 'node:assert';

global.window = { HS: {} };
await import('../lib/templates.js');        // esc
await import('../lib/property-card.js');
const HS = global.window.HS;
const C = HS.card;

test('the state vocabulary is closed and complete', () => {
  // Part 12's seven states, none collapsible, plus the three coverage states the card needs.
  ['verified', 'reported', 'unresolved', 'conflicting', 'unavailable', 'not_checked', 'checked_empty']
    .forEach((k) => assert.ok(C.STATES[k], `Part 12 state "${k}" must exist`));
  ['partial', 'in_progress', 'access_restricted']
    .forEach((k) => assert.ok(C.STATES[k], `coverage state "${k}" must exist`));

  Object.entries(C.STATES).forEach(([k, s]) => {
    assert.ok(s.label && s.label.length > 3, `${k} needs a resident-facing label`);
    assert.ok(s.short && s.short.length > 2, `${k} needs a short label for tight badges`);
    assert.ok(s.tone, `${k} needs a tone so the badge can be coloured`);
    assert.strictEqual(typeof s.countable, 'boolean', `${k} must declare whether it can carry a count`);
    assert.ok(C.STATE_NOTES[k] && C.STATE_NOTES[k].length > 20, `${k} needs a plain-language note`);
  });

  // The distinction the whole file exists for: these two labels must not read the same.
  assert.notStrictEqual(C.STATES.not_checked.label, C.STATES.checked_empty.label);
  assert.match(C.STATES.not_checked.label, /not checked/i);
  assert.match(C.STATES.checked_empty.label, /no records found/i);
  assert.match(C.STATES.unavailable.label, /unavailable/i);
});

test('only states that actually counted something are countable', () => {
  // checked_empty IS countable — its zero is a real, measured zero and must render as 0.
  assert.strictEqual(C.isCountable('checked_empty'), true);
  assert.strictEqual(C.isCountable('verified'), true);
  assert.strictEqual(C.isCountable('reported'), true);
  // Nothing was counted in any of these, so nothing may be printed.
  ['not_checked', 'unavailable', 'access_restricted', 'in_progress', 'partial', 'unresolved']
    .forEach((k) => assert.strictEqual(C.isCountable(k), false, `${k} must never carry a count`));
});

test('normalization is fail-closed: an unrecognized state is never guessed', () => {
  // No source_check row at all IS "not checked" — Part 12's definition, not an assumption.
  assert.strictEqual(C.state(null), 'not_checked');
  assert.strictEqual(C.state(undefined), 'not_checked');
  assert.strictEqual(C.state(''), 'not_checked');
  // Tolerant of shape, never of meaning.
  assert.strictEqual(C.state('NOT CHECKED'), 'not_checked');
  assert.strictEqual(C.state('checked-empty'), 'checked_empty');
  // A value we do not recognize must NOT become the nearest plausible state — every state is
  // a claim about what we did, so guessing one fabricates a provenance record.
  assert.strictEqual(C.state('clean'), null);
  assert.strictEqual(C.state('ok'), null);
  assert.strictEqual(C.state('no violations'), null);
  assert.match(C.label('clean'), /not recognized/i);
  assert.strictEqual(C.isCountable('clean'), false, 'an unreadable state can never print a number');
});

test('THE GATE: an unchecked, failed, or restricted source never renders a number', () => {
  // The exact regression: zero next to a source nobody queried.
  assert.strictEqual(C.metricText('not_checked', 0), C.NO_VALUE);
  assert.strictEqual(C.metricText('unavailable', 0), C.NO_VALUE);
  assert.strictEqual(C.metricText('access_restricted', 0), C.NO_VALUE);
  assert.strictEqual(C.metricText('in_progress', 0), C.NO_VALUE);
  assert.strictEqual(C.metricText('partial', 0), C.NO_VALUE);
  // ...and it is not just zero: no count of any size escapes a non-countable state.
  assert.strictEqual(C.metricText('not_checked', 12), C.NO_VALUE);
  assert.strictEqual(C.metricText('unavailable', 3), C.NO_VALUE);

  // A measured zero DOES render as 0 — printing "unavailable" over a correct zero would be a
  // new inaccuracy in the opposite direction (the ruling behind test/facilities-unavailable-copy).
  assert.strictEqual(C.metricText('checked_empty', 0), '0');
  assert.strictEqual(C.metricText('verified', 4), '4');
  assert.strictEqual(C.metricText('reported', 1), '1');

  // A countable state with no value is still an em-dash: "we counted" is not "we have a number".
  assert.strictEqual(C.metricText('verified', null), C.NO_VALUE);
  assert.strictEqual(C.metricText('verified', undefined), C.NO_VALUE);
  assert.strictEqual(C.metricText('verified', NaN), C.NO_VALUE);
  assert.strictEqual(C.metricText('verified', '7'), C.NO_VALUE, 'a string is not a counted number');

  assert.strictEqual(C.NO_VALUE, '\u2014', 'the absent marker is an em-dash');
});

test('badges carry the state and its explanation, and escape their input', () => {
  const b = C.badgeHTML('not_checked');
  assert.match(b, /class="pcst t-none"/);
  assert.match(b, /Not checked/);
  assert.match(b, /title="[^"]*have not queried/i, 'the badge explains itself on hover');
  assert.match(C.badgeHTML('checked_empty', { short: true }), />Checked</);
  assert.doesNotMatch(C.badgeHTML('<img src=x onerror=1>'), /<img/, 'input is escaped');
});

test('section rollup reports the weakest thing true of the section', () => {
  assert.strictEqual(C.rollup([]), 'not_checked', 'no rows is not a check');
  assert.strictEqual(C.rollup(['verified', 'verified']), 'verified');
  assert.strictEqual(C.rollup(['not_checked', 'not_checked']), 'not_checked');
  // A single unread source cannot hide behind its neighbours' green.
  assert.strictEqual(C.rollup(['verified', 'not_checked']), 'partial');
  assert.strictEqual(C.rollup(['checked_empty', 'not_checked']), 'partial');
  // A failed read outranks everything: we genuinely do not know.
  assert.strictEqual(C.rollup(['verified', 'verified', 'unavailable']), 'unavailable');
  assert.strictEqual(C.rollup(['not_checked', 'access_restricted']), 'access_restricted');
  assert.strictEqual(C.rollup(['verified', 'conflicting']), 'conflicting');
  // Fail closed: one unreadable state makes the rollup unreadable rather than optimistic.
  assert.strictEqual(C.rollup(['verified', 'clean']), null);
  assert.strictEqual(C.metricText(C.rollup(['verified', 'clean']), 0), C.NO_VALUE);
});

test('completeness counts sources by state and never scores them', () => {
  const rows = [{ state: 'verified' }, { state: 'verified' }, { state: 'not_checked' },
    { state: 'checked_empty' }, { state: 'unavailable' }, { state: 'clean' }];
  const c = C.completeness(rows);
  assert.strictEqual(c.total, 6);
  assert.strictEqual(c.byState.verified, 2);
  assert.strictEqual(c.byState.not_checked, 1);
  assert.strictEqual(c.byState.unavailable, 1);
  assert.strictEqual(c.unrecognized, 1, 'an unreadable state is counted as unreadable, not as a state');
  assert.ok(!('clean' in c.byState));
  // There is deliberately no percentage, grade, or weight anywhere in the result.
  assert.deepStrictEqual(Object.keys(c).sort(), ['byState', 'total', 'unrecognized']);
});

test('the donut is inline SVG, sums to its own total, and is honest when empty', () => {
  const svg = C.donutSVG(C.completeness([{ state: 'verified' }, { state: 'not_checked' }, { state: 'not_checked' }]));
  assert.match(svg, /^<svg /);
  // CSP on every data page allows script-src self + jsDelivr only, so charts are inline SVG
  // by rule — a chart library or a remote asset here would be unloadable, not just untidy.
  assert.doesNotMatch(svg, /https?:\/\//, 'no external references in the chart');
  assert.doesNotMatch(svg, /<script/i);
  assert.match(svg, /role="img"/);
  assert.match(svg, /aria-label="Coverage by information category"/);

  const arcs = [...svg.matchAll(/stroke-dasharray="([\d.]+) ([\d.]+)"/g)];
  assert.strictEqual(arcs.length, 2, 'one arc per present state, absent states draw nothing');
  const drawn = arcs.reduce((n, m) => n + Number(m[1]), 0);
  const circumference = Number(arcs[0][1]) + Number(arcs[0][2]);
  assert.ok(Math.abs(drawn - circumference) < 0.5, 'the arcs fill the ring exactly once');
  // 1 verified + 2 not_checked, in DONUT_ORDER: verified first, then not_checked (twice as long).
  assert.ok(Number(arcs[1][1]) > Number(arcs[0][1]));

  const empty = C.donutSVG(C.completeness([]));
  assert.doesNotMatch(empty, /stroke-dasharray/, 'nothing to count draws no slice');
  assert.match(empty, new RegExp(C.NO_VALUE), 'an empty donut shows an em-dash, not 0 or 100%');
});

test('the declared structure is the one the page renders against', () => {
  assert.ok(C.TABS.length >= 8);
  assert.strictEqual(C.TABS[0].id, 'overview', 'Overview is the first tab and the digest of all sections');
  const tabIds = C.TABS.map((t) => t.id);
  assert.strictEqual(new Set(tabIds).size, tabIds.length, 'tab ids are unique');

  const secIds = C.SECTIONS.map((s) => s.id);
  assert.strictEqual(new Set(secIds).size, secIds.length, 'section ids are unique');
  C.SECTIONS.forEach((s) => {
    assert.ok(s.title && s.title.length > 3, `${s.id} needs a title`);
    assert.ok(tabIds.includes(s.tab), `${s.id} claims tab "${s.tab}", which is not declared`);
    assert.notStrictEqual(s.tab, 'overview', 'Overview owns no sections of its own — it shows every section');
  });
  // Every non-Overview tab must own at least one section, or it is a dead tab.
  tabIds.filter((t) => t !== 'overview').forEach((t) => {
    assert.ok(C.SECTIONS.some((s) => s.tab === t), `tab "${t}" owns no section`);
  });
  // The sections the redesign is specifically about.
  ['entity-track-record', 'parent-track-record', 'property-ownership', 'development-activity',
    'facility-connections', 'natural-hazards', 'meetings-notices', 'sustainability',
    'recorded-instruments', 'regulatory-records', 'sources-verification', 'data-completeness']
    .forEach((id) => assert.ok(secIds.includes(id), `section "${id}" is missing`));
});

test('the disclaimer refuses the reading the layout invites', () => {
  // A grid of green and grey badges looks like a grade. The footer has to say it is not one.
  assert.match(C.DISCLAIMER, /source coverage/i);
  assert.match(C.DISCLAIMER, /not a rating/i);
  assert.match(C.DISCLAIMER, /score/i);
  assert.match(C.DISCLAIMER, /prediction/i);
});

test('identity is the engine key or nothing — the page never invents one', () => {
  assert.strictEqual(C.keyOf({ canonical_addr: '2200 CALDWELL LN, DEL VALLE, TX 78617' }),
    '2200 CALDWELL LN, DEL VALLE, TX 78617');
  // canonical wins over the filed variant: one normalizer, engine-side.
  assert.strictEqual(C.keyOf({ canonical_addr: 'A', location_addr: 'B' }), 'A');
  assert.strictEqual(C.keyOf({ location_addr: 'B' }), 'B');
  // A record with no engine-emitted address yields NOTHING — not a nearby address, not a ZIP
  // centroid, not a name. An unresolved parcel is a real answer the card renders as one.
  assert.strictEqual(C.keyOf({ name: 'Some project', zip: '78617', lat: 30.1, lng: -97.6 }), null);
  assert.strictEqual(C.keyOf({ canonical_addr: '   ' }), null);
  assert.strictEqual(C.keyOf(null), null);
});

test('links and the slide-in CTA point at the card and carry only real params', () => {
  assert.strictEqual(C.href({}), 'property-card.html');
  assert.strictEqual(C.href({ zip: '78617' }), 'property-card.html?zip=78617');
  assert.strictEqual(C.href({ zip: 'abc' }), 'property-card.html', 'a non-ZIP is dropped, not passed through');
  assert.match(C.href({ addr: '2200 CALDWELL LN, DEL VALLE, TX 78617' }), /addr=2200%20CALDWELL%20LN%2C%20DEL%20VALLE%2C%20TX%2078617/);

  const cta = C.ctaHTML({ zip: '78617', id: 'p-1' });
  assert.match(cta, /^<a class="pccta"/);
  // & is HTML-escaped in the attribute (HS.esc), which is what a valid href needs.
  assert.match(cta, /href="property-card\.html\?zip=78617&amp;id=p-1"/);
  assert.match(cta, new RegExp(C.CTA_LABEL));
  // With no address, the CTA must not imply one.
  assert.doesNotMatch(cta, /\d{5}\s*$/);
  assert.match(cta, /have not checked/i, 'it names what the card holds instead');
  // With an address, the CTA shows it, so a resident knows which parcel they are opening.
  assert.match(C.ctaHTML({ addr: '2200 CALDWELL LN' }), />2200 CALDWELL LN</);
});
