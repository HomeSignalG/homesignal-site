// Every Map 1 list band header is white text (.band-h{color:#fff}), so each one must carry a
// t-* class that gives it a background. A bare .band-h renders white on a white card: the
// Water rights filings column on /map/84307/ showed no title (founder, 2026-10-30).
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const page = readFileSync(new URL('../homesignalmap.html', import.meta.url), 'utf8');
assert.match(page, /\.band-h\{[^}]*color:#fff/, 'band headers are white text (premise of this test)');
const heads = [...page.matchAll(/<div class="(band-h[^"]*)">([^<]*)<\/div>/g)];
assert.ok(heads.length >= 6, `expected the six list bands, found ${heads.length}`);
for (const [, cls, label] of heads) {
  const t = cls.split(/\s+/).find(c => c.startsWith('t-'));
  assert.ok(t, `band header "${label}" has no t-* class, so it renders white on white`);
  const re = new RegExp(`\\.band-h\\.${t}\\{background:#[0-9a-fA-F]{6}\\}`);
  assert.match(page, re, `band header "${label}" (.${t}) has no background rule`);
}
const hex = (k) => (page.match(new RegExp(`\\.band-h\\.${k}\\{background:(#[0-9a-fA-F]{6})\\}`)) || [])[1];
const pin = (f) => (readFileSync(new URL(`../lib/${f}`, import.meta.url), 'utf8').match(/color: '(#[0-9a-fA-F]{6})'/) || [])[1];
assert.equal(hex('t-water'), pin('water-rights-map.js'), 'water header matches the W pin');
assert.equal(hex('t-cleanup'), pin('state-cleanup.js'), 'cleanup header matches the C pin');
console.log(`map1-band-headers: ${heads.length} headers, each with a background`);
