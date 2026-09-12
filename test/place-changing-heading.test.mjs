// PLACE CONTEXT HEADING — "See what is changing at/in [CURRENT GEOGRAPHY]"
// Run: node test/place-changing-heading.test.mjs
//
// THE CONTRACT. The Place-map heading names the geography the MAP is currently
// rendering. Address-radius uses "at" + the saved display address; ZIP-area uses
// "in" + the ZIP whose full geography is in the iframe. Kind is the HOST, never
// inferred from the string (no regex, no digit count, no URL parse). Unresolved
// values withhold the heading rather than printing "at undefined".
let fails = 0;
const ok = (c, name, eviq) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name + (c || eviq === undefined ? '' : '\n        ' + eviq));
  if (!c) fails++;
};

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const code = (s) => s.replace(/^\s*\/\/.*$/gm, '').replace(/<!--[\s\S]*?-->/g, '')
  .replace(/(^|[^:/])\/\*[\s\S]*?\*\//g, '$1');

global.window = { HS: {} };
await import('../lib/templates.js');
const HS = global.window.HS;

const helperSrc = code(read('lib/templates.js'));
const propRaw = read('property.html');
const prop = code(propRaw);
const cpRaw = read('lib/community-page.js');
const cp = code(cpRaw);
const m1Raw = read('homesignalmap.html');

console.log('='.repeat(78));
console.log('PLACE CHANGING HEADING — copy, kind, sources, stale-state');
console.log('='.repeat(78));

// ── §1 approved copy, driven on the shipped helper ──────────────────────────
ok(typeof HS.placeChangingHeading === 'function', '1a HS.placeChangingHeading is defined');
ok(HS.placeChangingHeading('address', '13313 Coomes Dr') === 'See what is changing at 13313 Coomes Dr',
  '1b ADDRESS uses "at" + the display address');
ok(HS.placeChangingHeading('zip', '78617') === 'See what is changing in 78617',
  '1c ZIP uses "in" + the ZIP');
ok(HS.placeChangingHeading('address', '4400 Wildhorse Trail') === 'See what is changing at 4400 Wildhorse Trail',
  '1d a second address is still "at"');
ok(HS.placeChangingHeading('zip', '78612') === 'See what is changing in 78612',
  '1e a second ZIP is still "in"');

// ── §2 kind is the HOST — never inferred from the value ─────────────────────
ok(HS.placeChangingHeading('address', '78617') === 'See what is changing at 78617',
  '2a an address-kind value that happens to be five digits still uses "at"');
ok(HS.placeChangingHeading('zip', '13313 Coomes Dr') === 'See what is changing in 13313 Coomes Dr',
  '2b a zip-kind value that looks like a street still uses "in"');
ok(!/\\d\{5\}/.test(helperSrc) && !/\.length\s*===\s*5/.test(helperSrc),
  '2c the helper does not branch on digit count or a five-digit regex');
ok(!/parseZipParam|location\.search|myZip/.test(helperSrc),
  '2d the helper does not read the URL or myZip — callers pass kind + value');

// ── §3 stale / malformed values withhold the heading ────────────────────────
ok(HS.placeChangingHeading('address', undefined) === '', '3a address undefined → \'\'');
ok(HS.placeChangingHeading('address', null) === '', '3b address null → \'\'');
ok(HS.placeChangingHeading('zip', '') === '', '3c empty string → \'\'');
ok(HS.placeChangingHeading('address', '   ') === '', '3d whitespace → \'\'');
ok(HS.placeChangingHeading('address', 'undefined') === '', '3e the string "undefined" → \'\'');
ok(HS.placeChangingHeading('address', 'null') === '', '3f the string "null" → \'\'');
ok(HS.placeChangingHeading('zip', 'Undefined') === '', '3g case-insensitive "Undefined" → \'\'');
ok(HS.placeChangingHeading('city', '78617') === '', '3h unknown kind → \'\' (does not guess ZIP vs address)');
ok(HS.placeChangingHeading('address', '  13313 Coomes Dr  ') === 'See what is changing at 13313 Coomes Dr',
  '3i surrounding whitespace is trimmed, not rejected');

// ── §4 ADDRESS host binds heading to the same `p` the iframe uses ───────────
ok(/HS\.placeChangingHeading\('address',\s*p\.address\)/.test(prop),
  '4a property.html calls placeChangingHeading(\'address\', p.address)');
ok(!/placeChangingHeading\('address',\s*p\.zip\)/.test(prop)
  && !/placeChangingHeading\('address',\s*S\.activeProperty/.test(prop)
  && !/placeChangingHeading\('address',\s*HS\.state/.test(prop),
  '4b ...not p.zip, not activeProperty, not some other state field');
ok(/id="propPlaceHeading"/.test(prop), '4c the Address heading has id="propPlaceHeading"');
ok(!/Where this address is/.test(propRaw), '4d the old "Where this address is" copy is gone');
const propHeadingAt = prop.indexOf('id="propPlaceHeading"');
const propFrameAt = prop.indexOf('id="propMapFrame"');
const propMapAt = prop.indexOf('var contextMap = realAddress');
ok(propMapAt >= 0 && propHeadingAt > propMapAt && propFrameAt > propHeadingAt,
  '4e heading and iframe are composed in the SAME contextMap block',
  { propMapAt, propHeadingAt, propFrameAt });
ok(/lat=' \+ encodeURIComponent\(p\.lat\)/.test(prop) && /lng=' \+ encodeURIComponent\(p\.lng\)/.test(prop),
  '4f the iframe still carries p.lat/p.lng — no second geography');
ok(/var realAddress = pcmHasPoint\(p\) && !p\.sample && !p\.demo;/.test(prop)
  && prop.indexOf('var contextMap = realAddress') < prop.indexOf('id="propPlaceHeading"'),
  '4g the heading rides inside the existing realAddress gate — no map, no heading');
ok(/id="propMapOpen"/.test(prop) && /Open in Development/.test(propRaw),
  '4h "Open in Development →" is unchanged');

// ── §5 ZIP host binds heading to the same `zip` the iframe uses ─────────────
ok(/HS\.placeChangingHeading\('zip',\s*zip\)/.test(cp),
  '5a community-page.js calls placeChangingHeading(\'zip\', zip)');
ok(/var zip = HS\.ensureViewedZip\(document\.body\.dataset\.zip\);/.test(cp),
  '5b ...and that `zip` is ensureViewedZip — the same authority the map already uses');
ok(!/placeChangingHeading\('zip',\s*HS\.state/.test(cp)
  && !/placeChangingHeading\('zip',\s*.*myZip/.test(cp)
  && !/placeChangingHeading\('zip',\s*.*followed/.test(cp)
  && !/placeChangingHeading\('zip',\s*c\.zip\)/.test(cp),
  '5c ...not myZip, not a followed ZIP, not community metadata zip, not HS.state');
ok(/id="zipPlaceHeading"/.test(cp), '5d the ZIP heading has id="zipPlaceHeading"');
ok(!/The area you're following/.test(cpRaw) && !/The area you\\'re following/.test(cpRaw),
  '5e the old "The area you\'re following" copy is gone');
ok(/placeChangingHeading\('zip'/.test(cp) && cp.indexOf("placeChangingHeading('zip'") < cp.indexOf('var zipContextMap'),
  '5f heading is computed next to zipContextMap');
ok(/zip=' \+ encodeURIComponent\(zip\)/.test(cp)
  && cp.indexOf("id=\"zipPlaceHeading\"") < cp.indexOf("id=\"zipMapFrame\""),
  '5g the iframe still carries encodeURIComponent(zip) — same variable');
ok(/var zipContextMap = \(sess && !sess\.demo\)/.test(cp),
  '5h the heading rides inside the existing A-022 session gate');

// ── §6 no second geography mechanism, no Map 1 hero rewrite ─────────────────
ok(/See what is changing in your zip code/.test(m1Raw),
  '6a Map 1\'s own ZIP standfirst is untouched');
ok(!/placeChangingHeading/.test(m1Raw),
  '6b homesignalmap.html does not call the Place heading helper');
ok(!/placeChangingHeading\('address',\s*p\.zip\)/.test(prop + cp)
  && !/geocode/i.test(prop.slice(prop.indexOf('var contextMap = realAddress'))),
  '6c neither host geocodes or substitutes ZIP for the address heading');

// ── §7 callers escape; the helper does not ──────────────────────────────────
ok(/HS\.esc\(placeHeading\)/.test(prop) && /HS\.esc\(placeHeading\)/.test(cp),
  '7a both hosts run HS.esc on the heading before inserting it');
ok(!/HS\.esc/.test(helperSrc.slice(helperSrc.indexOf('placeChangingHeading'),
  helperSrc.indexOf('placeChangingHeading') + 600)),
  '7b the helper itself does not HTML-escape (avoids double-escaping)');

console.log(fails === 0 ? '\nALL PASS' : '\n' + fails + ' FAILURE(S)');
process.exit(fails ? 1 : 0);
