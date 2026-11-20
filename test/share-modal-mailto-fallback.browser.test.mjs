// The Share box's Email tile when no mail app takes over. A mailto: link does nothing visible then, so the
// box says so and offers the subject and message to copy. When the window loses focus (an app opened) it stays silent.
// Run: node test/share-modal-mailto-fallback.browser.test.mjs   (needs playwright; CI's browser job)
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'share-modal.js'), 'utf8');
let fails = 0;
const ok = (c, n) => { if (!c) fails++; console.log((c ? 'PASS ' : 'FAIL ') + n); };
const b = await chromium.launch(); const p = await (await b.newContext()).newPage();
await p.setContent('<div id="w"><div id="g"></div></div>');
await p.addScriptTag({ content: src });
await p.evaluate(() => HS.fillShareGridEl(document.getElementById('g'), 'https://jodytracks.com/shared-report.html#share=abc', 'A private report for you'));
await p.click('#g a[href^="mailto"]'); await p.waitForTimeout(1600);
const t = await p.$eval('#w .hs-mailto-note', e => e.textContent).catch(() => '');
ok(/No email app opened/.test(t) && /Copy the email text/.test(t), 'no app took over: the box says so and offers the text');
await p.click('#w .hs-mailto-note button');
ok(/Copied/.test(await p.$eval('#w .hs-mailto-note', e => e.textContent)), 'Copy the email text confirms');
await p.evaluate(() => document.querySelector('.hs-mailto-note').remove());
await p.click('#g a[href^="mailto"]'); await p.evaluate(() => window.dispatchEvent(new Event('blur'))); await p.waitForTimeout(1600);
ok(!(await p.$('#w .hs-mailto-note')), 'an app opened (window lost focus): no message');
await b.close();
process.exit(fails ? 1 : 0);
