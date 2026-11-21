// Email and Messages tiles hand off to the person's own app. A target="_blank" on a mailto: or sms:
// link leaves a blank "Untitled" tab behind (founder, 2026-11-19, from Reports -> Share report).
// Run: node test/share-modal-mailto.test.mjs
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
let fails = 0;
const ok = (c, n) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + n); if (!c) fails++; };
const win = {};
vm.runInNewContext(readFileSync(new URL('../lib/share-modal.js', import.meta.url), 'utf8'), { window: win, document: { addEventListener() {} } });
const html = win.HS.shareGridHTML('https://jodytracks.com/r/abc', 'A private development activity report prepared for you');
const tags = html.match(/<a [^>]*>/g) || [];
const by = (p) => tags.filter((t) => t.includes('href="' + p));
ok(by('mailto:').length === 1 && !/target=/.test(by('mailto:')[0]), 'Email opens in place (no target)');
ok(by('sms:').length === 1 && !/target=/.test(by('sms:')[0]), 'Messages opens in place (no target)');
ok(/href="mailto:\?subject=A%20private%20development%20activity%20report%20prepared%20for%20you&amp;body=https%3A%2F%2Fjodytracks\.com%2Fr%2Fabc"/.test(html), 'Email subject and body are encoded');
const web = tags.filter((t) => /href="https?:/.test(t));
ok(web.length === 10 && web.every((t) => /target="_blank" rel="noopener"/.test(t)), 'every web target still opens a new tab with noopener');
console.log(fails ? fails + ' FAILED' : 'all passed');
process.exit(fails ? 1 : 0);
