// ZIP-page What's Changing cards open their own official record. Structural pin (offline).
import fs from 'node:fs'; import assert from 'node:assert/strict';
const page = fs.readFileSync('lib/community-page.js','utf8');
const tpl = fs.readFileSync('lib/templates.js','utf8');
// the one link reader: http(s) only, from the record's own fields
assert.match(tpl, /function rawRecordUrl\(item\)[\s\S]{0,300}\^https\?:/, 'the one URL reader accepts only http(s)');
assert.match(tpl, /recordHref\(item\)[\s\S]{0,120}rawRecordUrl\(item\)/, 'recordHref reads through it');
assert.match(tpl, /miniCardLink[\s\S]{0,400}rel="noopener noreferrer"/, 'external links open safely');
// every card type on the page goes through it
// 4 = notice + news cards on the normal page, the news list on the non-pass page, and the notices on the
// ZIP-coverage branch (a ZIP with no Census-drawn area, 2026-10-03); the news list there reuses localNewsSection.
assert.equal((page.match(/HS\.tpl\.miniCardLink\(n, n\.category, HS\.tpl\.recordHref\(n\)\)/g)||[]).length, 4, 'notice + news cards');
assert.match(page, /var ph = HS\.tpl\.recordHref\(p\)/, 'development cards');
assert.match(page, /var mh = ''; meetings\.some/, 'civic card');
assert.doesNotMatch(page, /HS\.tpl\.miniCard\(n, n\.category\)/, 'no non-interactive card left');
// a record without a link stays a plain card (no fabricated href)
assert.match(tpl, /if \(!href\) return tpl\.miniCard/);
console.log('PASS community-card-links');
