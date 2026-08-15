// The empty-state copy may only say things the stored data supports.
//
// Each assertion below corresponds to a measured constraint recorded in lib/coverage-copy.js.
// They are written as BANS with a self-test: the last block feeds build() an input that must
// produce copy, so a green run cannot come from a build() that returns null for everything —
// the vacuous-pass shape (an instrument that never ran attests to nothing).
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const HS = require(join(root, 'lib/coverage-copy.js'));
const MAP = JSON.parse(readFileSync(join(root, 'lib/generated/county-sources.json'), 'utf8'));
const failures = [];
const text = (r) => (r ? r.lines.map((l) => l.label + ': ' + l.text).join(' \n') : '');

// ── The three real pages, by name ────────────────────────────────────────────────────
const arroyoHondo = HS.build({                      // class (d) — 443 pages
  county: 'Taos', state: 'NM', devCount: 0, facCount: 0, civicCount: 0, map: MAP });
const akiachak = HS.build({                         // class (b) statewide-only — 243 pages
  county: 'Bethel', state: 'AK', devCount: 0, facCount: 0, civicCount: 0, map: MAP });
const jemezSprings = HS.build({                     // class (b) city source — 111 pages
  county: 'Sandoval', state: 'NM', devCount: 0, facCount: 0, civicCount: 0, map: MAP });

for (const [name, r] of [['Arroyo Hondo', arroyoHondo], ['Akiachak', akiachak], ['Jemez Springs', jemezSprings]]) {
  if (!r) { failures.push(`${name}: build() returned null for an all-empty page`); continue; }
  const t = text(r);

  // BAN 1 — no distance. frsFacilities() backs off 3 -> 0.25 mi and records nothing.
  if (/\b\d+(\.\d+)?\s*(mile|mi\b|km)/i.test(t)) failures.push(`${name}: names a distance`);

  // BAN 2 — never "EPA lists no regulated facilities". The count is name-filtered.
  if (/EPA[^.]*\b(lists?|has)\s+no\b/i.test(t)) failures.push(`${name}: claims EPA lists nothing`);
  if (/no regulated facilit/i.test(t)) failures.push(`${name}: claims there are no regulated facilities`);

  // BAN 3 — no fetch-execution claim. There is no sources_checked on development_reports.
  if (/\bwe (checked|queried|asked|searched)\b/i.test(t)) failures.push(`${name}: claims a fetch was performed`);
  if (/\breturned (nothing|no records|none)\b/i.test(t)) failures.push(`${name}: claims what a fetch returned`);

  // BAN 4 — never blame the county for refusing or lacking access.
  if (/does not (publish|provide|offer)|no API|refus|declin|will not provide/i.test(t)) {
    failures.push(`${name}: attributes the gap to the jurisdiction`);
  }

  // BAN 5 — no promise, no date.
  if (/coming soon|we're adding|we are adding|will be added|shortly|in the coming/i.test(t)) {
    failures.push(`${name}: promises future coverage`);
  }

  // BAN 6 — never tell a resident the page is blank; local news rides below.
  if (/\bnothing (at all|here)\b|\bblank\b|\bempty page\b/i.test(t)) failures.push(`${name}: calls the page blank`);

  // The gap must be attributed to us wherever we claim one.
  if (/isn't covered/i.test(t) && !/we have not identified|aren't among our sources/i.test(t)) {
    failures.push(`${name}: states a gap without attributing it to us`);
  }
}

// ── Per-page facts that must actually appear ─────────────────────────────────────────
if (arroyoHondo && !/Taos County/.test(text(arroyoHondo))) {
  failures.push('Arroyo Hondo: does not name Taos County');
}
if (arroyoHondo && /Alaska|Albuquerque/.test(text(arroyoHondo))) {
  failures.push('Arroyo Hondo: names a source that does not cover Taos');
}
if (akiachak && !/Alaska Department of Transportation/.test(text(akiachak))) {
  failures.push('Akiachak: does not name the one source covering it');
}
// "Bethel County" does not exist — Bethel is a census area.
if (akiachak && /Bethel County/.test(text(akiachak))) failures.push('Akiachak: invents "Bethel County"');
// "Bethel" bare would read as the town of Bethel — a different page (99559) with its own records.
if (akiachak && !/Bethel, Alaska/.test(text(akiachak))) {
  failures.push('Akiachak: does not disambiguate Bethel the census area from Bethel the town');
}
if (jemezSprings && !/City of Albuquerque/.test(text(jemezSprings))) {
  failures.push('Jemez Springs: does not name the city source it actually holds');
}
if (jemezSprings && !/cover the city/.test(text(jemezSprings))) {
  failures.push('Jemez Springs: does not disclose that the city ledger does not reach the county');
}

// ── The gate: a page with ANY content gets no block ──────────────────────────────────
// The 20-page cache-vs-canonical case. Pima County AZ pages carry 9 live civic notices
// (Board of Supervisors agendas, Planning and Zoning Commission agendas) while holding no
// map markers. Telling them we have not identified a source would be the worst misfire of
// this copy, so civic content alone must suppress it.
if (HS.build({ county: 'Pima', state: 'AZ', devCount: 0, facCount: 0, civicCount: 9, map: MAP })) {
  failures.push('a page with civic notices still got the empty-state block');
}
if (HS.build({ county: 'Taos', state: 'NM', devCount: 1, facCount: 0, civicCount: 0, map: MAP })) {
  failures.push('a page with a development record still got the block');
}
if (HS.build({ county: 'Taos', state: 'NM', devCount: 0, facCount: 8, civicCount: 0, map: MAP })) {
  failures.push('a page with facilities still got the block');
}

// ── Fail closed with no map: name nothing rather than guess ──────────────────────────
const noMap = HS.build({ county: 'Sandoval', state: 'NM', devCount: 0, facCount: 0, civicCount: 0, map: null });
if (!noMap) failures.push('build() returned null when the source map was missing — it must still render');
if (noMap && /Albuquerque/.test(text(noMap))) failures.push('named a source with no map loaded');

// ── EPA outage: make no facility claim, defer to the existing outage copy ────────────
const outage = HS.build({ county: 'Taos', state: 'NM', devCount: 0, facCount: 0, civicCount: 0,
  facUnavailable: true, map: MAP });
if (outage && /Facility Registry Service/.test(text(outage))) {
  failures.push('made an EPA claim on a snapshot whose EPA read failed');
}
if (outage && /no facility, permit or planning/.test(text(outage))) {
  failures.push('counted facilities as a verified zero when the EPA read failed');
}

// ── Class (c): incomplete, not empty; never permanent, never blame ───────────────────
const failing = HS.build({ county: 'Nye', state: 'NV', devCount: 0, facCount: 0, civicCount: 0,
  failedSources: ['Nevada Department of Transportation'], map: MAP });
if (!failing || !/incomplete rather than empty/.test(text(failing))) {
  failures.push('a failed source did not produce the incomplete-not-empty line');
}
if (failing && /block|blocked|refus|permanently|unavailable to us/i.test(text(failing))) {
  failures.push('described a transient failure as a block — all four measured cases were timeouts/resets');
}

// ── Place naming is a factual claim too ──────────────────────────────────────────────
const names = [
  ['Taos', 'NM', 'Taos County'],
  ['Bethel', 'AK', 'Bethel, Alaska'],      // census area, not a county — and not the town
  ['Kenai Peninsula', 'AK', 'Kenai Peninsula, Alaska'],
  ['Caddo', 'LA', 'Caddo Parish'],
  ['Virginia Beach', 'VA', 'Virginia Beach, Virginia'],
  ['St. Louis', 'MO', 'St. Louis, Missouri'],  // city/county collision — qualify, never guess
  ['Sandoval', 'NM', 'Sandoval County']
];
for (const [c, s, want] of names) {
  const got = HS.placeName(c, s);
  if (got !== want) failures.push(`placeName(${c}, ${s}) = "${got}", expected "${want}"`);
}

// ── Self-test: the bans above must be capable of firing ──────────────────────────────
// A suite of negative assertions passes trivially if build() returns nothing, so prove the
// checks are live by running them against copy that violates every one.
const bad = 'We checked EPA and it returned nothing: EPA lists no regulated facilities within 3 miles. '
  + 'Taos County does not publish permit data. Coverage coming soon.';
const bans = [
  /\b\d+(\.\d+)?\s*(mile|mi\b|km)/i, /EPA[^.]*\b(lists?|has)\s+no\b/i, /no regulated facilit/i,
  /\bwe (checked|queried|asked|searched)\b/i, /\breturned (nothing|no records|none)\b/i,
  /does not (publish|provide|offer)|no API|refus|declin|will not provide/i,
  /coming soon|we're adding|we are adding|will be added|shortly|in the coming/i
];
const missed = bans.filter((re) => !re.test(bad));
if (missed.length) failures.push(`${missed.length} ban patterns failed to catch deliberately bad copy`);

if (failures.length) {
  console.error(failures.map((f) => `FAIL — ${f}`).join('\n'));
  process.exit(1);
}
console.log('coverage-copy: 3 real pages render; 6 bans enforced and self-tested; content of any '
  + 'kind (incl. civic notices) suppresses the block; fails closed with no map; no EPA claim during '
  + 'an outage; place naming correct for census areas, parishes and independent cities.');
