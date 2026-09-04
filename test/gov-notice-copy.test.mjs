// The Government Notices empty state may only say things the stored data supports.
//
// Each assertion is a BAN recorded in lib/gov-notice-copy.js. The last block is a
// self-test: it feeds build() inputs that MUST produce copy in both states, so a green
// run cannot come from a build() that returns null for everything — the vacuous-pass
// shape, where an instrument that never ran attests to nothing.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const GN = require(join(root, 'lib/gov-notice-copy.js'));
const MAP = JSON.parse(readFileSync(join(root, 'lib/generated/gov-notice-coverage.json'), 'utf8'));
const failures = [];
const t = (r) => (r ? r.label + ': ' + r.text : '');

// ── The artifact itself ──────────────────────────────────────────────────────────────
if (MAP._counts.canonical_zip_pages !== 12722) failures.push('map: canonical denominator is not 12,722');
if (MAP.configured_zips.length !== MAP._counts.configured) failures.push('map: configured count disagrees with the list length');
if (MAP._counts.configured + MAP._counts.unconfigured !== 12722) failures.push('map: configured + unconfigured != 12,722');
if (new Set(MAP.configured_zips).size !== MAP.configured_zips.length) failures.push('map: duplicate ZIP in configured_zips');
if (MAP.configured_zips.some((z) => !/^\d{5}$/.test(z))) failures.push('map: a configured entry is not a 5-digit ZIP');
// 80249 is the removed non-canonical Denver hand-insert (founder ruling). It must not appear.
if (MAP.configured_zips.includes('80249')) failures.push('map: non-canonical 80249 present');

// ── Both real states, by name ────────────────────────────────────────────────────────
const tracked  = GN.build({ zip: '84302', county: 'Box Elder', state: 'UT', noticeCount: 0, map: MAP });
const noSource = GN.build({ zip: '21204', county: 'Baltimore', state: 'MD', noticeCount: 0, map: MAP });
const noMap    = GN.build({ zip: '84302', county: 'Box Elder', state: 'UT', noticeCount: 0, map: null });

if (!tracked  || tracked.state  !== 'tracked')   failures.push('84302 (wired county) did not produce the tracked state');
if (!noSource || noSource.state !== 'no_source') failures.push('21204 (unwired county) did not produce the no_source state');
if (!noMap    || noMap.state    !== 'no_source') failures.push('BAN 5: a missing map must fail closed to no_source');

for (const [name, r] of [['tracked', tracked], ['no_source', noSource], ['no map', noMap]]) {
  const s = t(r);
  if (!s) { failures.push(`${name}: produced no copy`); continue; }

  // BAN 1 — never assert what a government body publishes or does not publish.
  if (/\b(county|city|borough|parish|they)\b[^.]{0,40}\b(publishes? (no|nothing)|does not publish|has not published|posted nothing)/i.test(s))
    failures.push(`${name}: asserts what the government body publishes`);
  if (/\bno (notices|meetings) (were|have been) (posted|published)\b/i.test(s))
    failures.push(`${name}: asserts nothing was posted`);

  // BAN 2 — the gap is ours; never blame or characterise the jurisdiction.
  if (/\b(refus|declin|denied|will not provide|does not provide|unavailable from)\b/i.test(s))
    failures.push(`${name}: characterises the jurisdiction as withholding`);

  // BAN 3 — no date, no promise.
  if (/\b(soon|coming soon|shortly|in the coming|by (january|february|march|april|may|june|july|august|september|october|november|december)|20\d\d)\b/i.test(s))
    failures.push(`${name}: makes a dated promise`);
  if (/\bwe('| a)re (adding|working on|rolling out)\b/i.test(s))
    failures.push(`${name}: promises future work`);

  // BAN 6 — never claim a fetch result.
  if (/\bwe (checked|queried|asked|searched|fetched)\b/i.test(s))
    failures.push(`${name}: claims a fetch was performed`);
  if (/\breturned (nothing|no records|none)\b/i.test(s))
    failures.push(`${name}: claims what a fetch returned`);
}

// BAN 4 — a page with no wired source must not name a source, portal or vendor.
if (noSource && /\b(legistar|granicus|civicplus|civicclerk|iqm2|novusagenda|escribe|agendacenter|portal|rss)\b/i.test(t(noSource)))
  failures.push('no_source: names a source it does not hold');

// ── The section is never blanked when it has content ─────────────────────────────────
if (GN.build({ zip: '84302', county: 'Box Elder', state: 'UT', noticeCount: 1, map: MAP }) !== null)
  failures.push('build() must return null when the section has notices');

// ── Place naming is a factual claim too ──────────────────────────────────────────────
if (GN.placeName('Baltimore', 'MD') !== 'Baltimore') failures.push('placeName: invented a term for the MD Baltimore city/county collision');
if (GN.placeName('Fairfax', 'VA') !== 'Fairfax')     failures.push('placeName: invented a term for the VA Fairfax collision');
if (GN.placeName('Bethel', 'AK') !== 'Bethel')       failures.push('placeName: appended "County" to an Alaska borough/census area');
if (GN.placeName('Box Elder', 'UT') !== 'Box Elder County') failures.push('placeName: dropped the County suffix where it is safe');

// ── Containment: the independent-city split must be preserved ────────────────────────
// Baltimore CITY delivers, Baltimore COUNTY does not. A (state,county) shortcut would
// grant the county the city's coverage; the per-ZIP map must keep them apart.
if (!MAP.configured_zips.includes('21201')) failures.push('containment: Baltimore city ZIP 21201 should be configured');
if (MAP.configured_zips.includes('21204'))  failures.push('containment: Baltimore COUNTY ZIP 21204 must not be configured');

if (failures.length) { console.error(failures.map((f) => 'FAIL ' + f).join('\n')); process.exit(1); }
console.log(`ok  gov-notice-copy: ${MAP._counts.configured} configured / ${MAP._counts.unconfigured} unconfigured of 12,722`);
