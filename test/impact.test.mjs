// Pins HS.projectImpact (lib/impact.js) — development card impact line.
// Anti-fabrication: impact claims require impact_dimensions; otherwise factual fallbacks only.
// Run: node --test test/impact.test.mjs
import test from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

global.window = { HS: {} };
await import('../lib/templates.js');
await import('../lib/impact.js');
const HS = global.window.HS;

const seed = require('../seed/delvalle.js');
const projects = seed.projects || window.HS_SEED?.projects || [];

function lenOk(s) {
  return s.length >= 80 && s.length <= 140;
}

test('devCard renders Impact line below title', () => {
  const html = readFileSync(new URL('../lib/templates.js', import.meta.url), 'utf8');
  assert.match(html, /class="impactline"/, 'devCard includes impactline');
  assert.match(html, /<h3>\$\{esc\(p\.name\)\}<\/h3>\s*\$\{tpl\.devImpactBlock\(p\)\}/, 'impact block sits under title');
  assert.match(html, /Quality of Life Impact Score:/, 'devCard includes QoL impact score line');
  const page = readFileSync(new URL('../development.html', import.meta.url), 'utf8');
  assert.match(page, /lib\/impact\.js/, 'development.html loads impact.js');
  assert.match(page, /Quality of Life Score/, 'development table column renamed');
});

test('impactRating and impactScoreValue use stored impact_score', () => {
  assert.strictEqual(HS.impactRating(72), 'High');
  assert.strictEqual(HS.impactRating(55), 'Medium');
  assert.strictEqual(HS.impactRating(34), 'Low');
  assert.strictEqual(HS.impactRating(null), null);
  assert.strictEqual(HS.impactScoreValue(72), '72 | High');
  assert.strictEqual(HS.impactScoreValue(null), '');
});

test('devCard renders QoL score line between impact and sowhat', () => {
  const p = projects[0];
  const html = HS.tpl.devCard(p);
  const impactIdx = html.indexOf('Impact:');
  const scoreIdx = html.indexOf('Quality of Life Impact Score:');
  const sowhatIdx = html.indexOf('On the record:');
  const altSowhatIdx = html.indexOf('How it impacts you:');
  const recordIdx = sowhatIdx >= 0 ? sowhatIdx : altSowhatIdx;
  assert.ok(impactIdx >= 0 && scoreIdx > impactIdx, 'score line follows impact line');
  assert.ok(recordIdx > scoreIdx, 'score line precedes on-the-record section');
  assert.match(html, /Quality of Life Impact Score:<\/b> 88 \| High/, 'seed flagship shows score and rating on one line');
});

test('projectImpact is deterministic and length-bounded for seed projects', () => {
  assert.ok(projects.length, 'seed projects available');
  for (const p of projects) {
    const a = HS.projectImpact(p);
    const b = HS.projectImpact(p);
    assert.strictEqual(a, b, p.name + ' impact is deterministic');
    assert.ok(lenOk(a), p.name + ' impact length 80–140 (got ' + a.length + '): ' + a);
    assert.ok(!a.includes('\n'), p.name + ' impact is one line');
    assert.match(a, /[.!?]$|[…]$/, p.name + ' impact ends as a sentence');
  }
});

test('impact_dimensions gate — no invented pressure without sourced dimensions', () => {
  const bare = { name: 'Warehouse', status: 'Proposed', type: 'Industrial' };
  const s = HS.projectImpact(bare);
  assert.doesNotMatch(s, /pressure on|more traffic|more water/i, 'no dimensions -> no specific impact pressure');
  assert.match(s, /public record|on file/i, 'no dimensions -> factual record fallback');
  assert.ok(lenOk(s), 'bare fallback fits length budget');
});

test('sourced bad dimensions may name resident effects', () => {
  const sourced = {
    name: 'Campus', status: 'Proposed', type: 'Data Center',
    impact_dimensions: [
      { label: 'Water', bad: true },
      { label: 'Traffic', bad: true },
      { label: 'Tax base', bad: false }
    ]
  };
  const s = HS.projectImpact(sourced);
  assert.match(s, /water/i, 'bad water dimension surfaces');
  assert.match(s, /traffic/i, 'bad traffic dimension surfaces');
  assert.match(s, /tax base/i, 'good dimension surfaces when paired');
  assert.ok(lenOk(s), 'sourced impact fits length budget');
});

test('distance prefix only when sentence would otherwise be short', () => {
  const short = {
    name: 'X', status: 'Proposed', type: 'Solar',
    dist: '0.8 mi',
    impact_dimensions: [{ label: 'Tax base', bad: false }]
  };
  const s = HS.projectImpact(short);
  assert.ok(lenOk(s), 'good-only impact fits with optional dist padding');
});
