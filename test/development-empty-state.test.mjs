// development.html must never again promise that we check permit records for a county we
// have no source for.
//
// THE CLAIM THAT WAS SHIPPED: "We check county and permit records for this area continuously
// — new projects appear here the moment they're filed." It rendered on EVERY empty page,
// including all 443 whose county has no registry entry at all. Nothing is being checked
// there and nothing will appear. This pins its removal and pins the wiring that replaced it,
// so a future edit cannot quietly restore either the sentence or the inference behind it.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(root, 'development.html'), 'utf8');
const failures = [];

// ── The false claim is gone, in every phrasing that would reintroduce it ──────────────
if (/We check county and permit records/i.test(src)) {
  failures.push('the "We check county and permit records ... continuously" claim is back');
}
if (/appear here the moment they'?re filed/i.test(src)) {
  failures.push('the "the moment they\'re filed" promise is back — we cannot promise delivery '
    + 'from a source we have not identified');
}
// Any future variant of "we continuously check" is the same unsupported claim.
if (/continuously/i.test(src) && /(check|monitor|watch)/i.test(src)) {
  failures.push('a "continuously check/monitor" claim is present');
}

// ── The replacement is actually wired ────────────────────────────────────────────────
if (!/<script src="lib\/coverage-copy\.js"><\/script>/.test(src)) {
  failures.push('lib/coverage-copy.js is not loaded — the honest block can never render');
}
if (!/HS\.coverageCopy\.build\(/.test(src)) failures.push('build() is never called');
if (!/lib\/generated\/county-sources\.json/.test(src)) {
  failures.push('the generated county->source map is never fetched, so no source can be named');
}

// The block must be driven by all THREE live counts. Dropping civicCount is the specific
// regression that would put "we have not identified a source for your county" onto the
// Pima County AZ pages, which carry live Board of Supervisors and Planning & Zoning agendas.
for (const field of ['devCount:', 'facCount:', 'civicCount:']) {
  if (!src.includes(field)) failures.push(`build() is not passed ${field.replace(':', '')}`);
}
if (!/HS\.data\.changes\(/.test(src)) {
  failures.push('civic changes are never read, so civicCount cannot be real');
}

// Fail closed: a failed map fetch must yield null (name nothing), never a throw or a guess.
if (!/\.catch\(function \(\) \{ return null; \}\)/.test(src)) {
  failures.push('the county-source fetch does not fail closed to null');
}

// ── The fallback branch must also be free of the claim ───────────────────────────────
// Both branches were wrong before; only one of them was replaced by the rich block.
const emptyBranch = src.slice(src.indexOf('if (!a.length)'), src.indexOf('if (!a.length)') + 900);
if (!/No permit or planning records for this area/.test(emptyBranch)) {
  failures.push('the fallback empty state does not state plainly what the page holds');
}
if (/\bwe (check|monitor|track) /i.test(emptyBranch)) {
  failures.push('the fallback empty state makes a checking claim');
}

// ── Cost guard: the extra reads must be gated on the page actually being empty ────────
if (!/if \(!projects\.length && !facilities\.length && community\)/.test(src)) {
  failures.push('the coverage reads are not gated on an empty page — a page with records '
    + 'would pay for two reads it cannot use');
}

if (failures.length) {
  console.error(failures.map((f) => `FAIL — ${f}`).join('\n'));
  process.exit(1);
}
console.log('development.html: the unsupportable "we check county and permit records '
  + 'continuously" claim is gone from both empty branches; the honest block is wired, driven '
  + 'by all three live counts, fails closed, and is gated on the page being empty.');
