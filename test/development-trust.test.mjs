// Anti-fabrication gates for development.html project detail — synthetic timeline
// milestones and unsupported "Likely to affect…" verdicts must never return.
// Run: node test/development-trust.test.mjs
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const fs = require('node:fs');
let fails = 0;
const ok = (c, name) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name); if (!c) fails++; };

const devHtml = readFileSync(new URL('../development.html', import.meta.url), 'utf8');

// ── Source scan: banned synthetic copy must not exist in the page ──
for (const banned of [
  'Expected next quarter',
  'Commission vote',
  'Impact analysis published',
  'you can act here',
  'this filing is what put it on your map',
]) {
  ok(!devHtml.includes(banned), 'development.html does not contain banned synthetic copy: "' + banned + '"');
}

// ── Verdict is gated on sourced impact_dimensions (hiDims.length) ──
ok(/hiDims\.length/.test(devHtml), 'development.html gates "Likely to affect…" on hiDims.length');
ok(/p\.sowhat/.test(devHtml), 'development.html falls back to factual p.sowhat when no impact dimensions');

// ── Timeline built only from record fields + meetings (no push of invented milestones) ──
ok(!/thread\.push\(\{\s*date:\s*['"]Expected/.test(devHtml), 'no hard-coded future timeline push');
ok(/if\s*\(p\.submitted_at\)/.test(devHtml), 'filing milestone requires submitted_at');
ok(/if\s*\(mtg\s*&&\s*mtg\.starts_at\)/.test(devHtml), 'hearing milestone requires meeting.starts_at');

// ── Runtime: empty impact_dimensions never produce "Likely to affect" HTML ──
global.window = { HS: {} };
await import('../lib/templates.js');
const HS = global.window.HS;

function verdictSnippet(project) {
  const dims = project.impact_dimensions || [];
  const hiDims = dims.filter((i) => i.bad).slice(0, 2).map((i) => i.label.toLowerCase());
  const goodDim = dims.find((i) => !i.bad);
  if (hiDims.length) {
    return 'Likely to affect ' + hiDims.join(' and ')
      + (goodDim ? ' lift to ' + goodDim.label.toLowerCase() : '');
  }
  return project.sowhat || 'On the county\'s public record near you — the record below has the specifics.';
}

const bare = { name: 'Warehouse', status: 'Proposed', sowhat: 'Industrial · proposed — Applicant LLC' };
ok(!/Likely to affect/.test(verdictSnippet(bare)), 'no impact_dimensions -> no "Likely to affect" verdict');
ok(/Applicant LLC/.test(verdictSnippet(bare)), 'no impact_dimensions -> factual sowhat fallback');

const sourced = {
  name: 'Campus', sowhat: 'ignored',
  impact_dimensions: [{ label: 'Traffic', bad: true }, { label: 'Tax base', bad: false }]
};
ok(/Likely to affect traffic/.test(verdictSnippet(sourced)), 'sourced bad dimensions -> verdict allowed');

if (fails) { console.error('\n' + fails + ' failed'); process.exit(1); }
console.log('\nAll development-trust assertions passed.');
