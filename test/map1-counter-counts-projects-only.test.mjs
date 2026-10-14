// Founder decision A (2026-10-13): the "New projects proposed nearby" tile counts projects with a
// source-published point only. Hearing/agenda notices (scope "area") stay in the Proposed rail but
// are not counted.
import fs from 'node:fs';
import assert from 'node:assert/strict';
const src = fs.readFileSync(new URL('../homesignalmap.html', import.meta.url), 'utf8')
  .replace(/\/\/.*$/gm, '');
const m = src.match(/var propPoints = permits\.filter[\s\S]*?var propActive = [^;]+;/);
assert.ok(m, 'propActive must be computed from propPoints');
assert.ok(/permits\.filter/.test(m[0]), 'propPoints must come from point permits');
assert.ok(!/dev\.filter/.test(m[0]), 'area items must not feed the counter');
assert.ok(/var prop = permits[\s\S]{0,200}dev\.filter/.test(src), 'the rail must still list area notices');
console.log('ok: counter counts project points only; rail still lists area notices');
