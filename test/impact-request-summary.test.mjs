import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const src = readFileSync(new URL('../lib/acq-impact-stories.js', import.meta.url), 'utf8');
assert.match(src, /function requestSummary\(\)/, 'summary function exists');
assert.match(src, /return head \+ bar \+ intro \+ requestSummary\(\)/, 'summary is drawn on the Visuals step');
assert.match(src, /id="is-req-summary"/);
for (const w of ['Found', 'None found', 'Not tried yet']) assert.ok(src.includes('>' + w + '<'), w);
console.log('impact-request-summary: ok');
