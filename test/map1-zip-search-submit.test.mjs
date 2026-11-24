// Regression for ZIP input on the Development Map's ONE existing search form.
// Run: node test/map1-zip-search-submit.test.mjs
// Evaluates the actual form handler from the shipped page, not a reimplementation.
// Does not contact JODY production or require Playwright.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runInNewContext } from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'development-map.html'), 'utf8');
const start = html.indexOf('  $("form").addEventListener("submit", function(e){');
assert.ok(start >= 0, 'existing form submit handler must exist');
const end = html.indexOf('\n  });', start);
assert.ok(end > start, 'existing submit handler must close');
const handlerSource = html.slice(start, end + '\n  });'.length);

const input = { value: '' };
const visits = [];
const addressSearches = [];
let validationErrors = 0;
let clearedErrors = 0;
let submissions = 0;
let onSubmit = null;
const nodes = {
  form: {
    addEventListener(name, fn) {
      assert.equal(name, 'submit');
      assert.equal(onSubmit, null, 'only one submit handler');
      onSubmit = fn;
    }
  },
  addr: input
};

runInNewContext(handlerSource, {
  $: id => nodes[id],
  window: { location: { assign: url => visits.push(url) } },
  run: address => addressSearches.push(address),
  showAddrError: () => { validationErrors++; },
  clearAddrError: () => { clearedErrors++; }
});
assert.equal(typeof onSubmit, 'function', 'submission bound to existing form');

function submit(value) {
  input.value = value;
  let prevented = false;
  onSubmit({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true, 'form prevents native submission');
  submissions++;
}
submit('52638');
assert.deepEqual(visits, ['/development-map.html?zip=52638'],
  'Middletown ZIP goes through the canonical ZIP page, not the address geocoder');
assert.deepEqual(addressSearches, [], 'no address lookup for a ZIP');

submit('07001');
assert.equal(visits.at(-1), '/development-map.html?zip=07001',
  'leading-zero ZIP is preserved exactly');

submit(' 85083 ');
assert.equal(visits.at(-1), '/development-map.html?zip=85083',
  'ZIP input is trimmed before navigation');

submit('17571 DMC Highway 79, Middletown, IA 52638');
assert.equal(addressSearches.at(-1), '17571 DMC Highway 79, Middletown, IA 52638',
  'full street address preserves the existing geocoding path');
assert.equal(visits.length, 3, 'street address does not route as ZIP');

submit('52638-1234');
assert.equal(addressSearches.at(-1), '52638-1234',
  'ZIP+4 is not silently truncated into a ZIP-wide search');

submit('');
assert.equal(validationErrors, 1, 'blank input shows the existing validation error');
assert.equal(addressSearches.length, 2, 'blank input does not geocode');
assert.equal(visits.length, 3, 'blank input does not navigate');

assert.ok(/function loadZip\(zip\)/.test(html), 'reuse the existing ZIP loader');
assert.ok(/loadZip\(zz\);\s*loadDevTracker\(zz\);/.test(html),
  'the ZIP route still boots the canonical ZIP map and tracker');
assert.equal(clearedErrors, submissions - 1, 'valid inputs clear inline validation');

console.log('PASS — Map 1 ZIP search routing (52638, 07001, 85083, addresses, blank)');
