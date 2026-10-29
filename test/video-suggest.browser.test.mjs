// Tab 16 "Suggest a video" (lib/acq-video-suggest.js): real Chromium against a stub client
// (no network, no credential). Founder, 2026-10-28: Tab 16 and Tab 17 each need their own suggestion box.
// Run: node test/video-suggest.browser.test.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const fs = require('node:fs');
let fails = 0;
const ok = (c, name) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name); if (!c) fails++; };
const read = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const lib = read('lib/acq-video-suggest.js');

// 2. browser
const { chromium } = require('playwright');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.setContent('<!doctype html><html><body><div id="host"></div></body></html>');
await page.addScriptTag({ content: lib });
await page.evaluate(() => {
  window.calls = [];
  window.rows = [{ id: 'm1', title: 'Made one <b>', status: 'made', project_slug: 'port-x', links: ['https://ok.gov/a', 'javascript:alert(1)'],
    created_at: '2026-10-20T00:00:00Z' }];
  window.client = { rpc: (n, a) => {
    window.calls.push([n, a]);
    if (n === 'hs_youtube_video_suggestions_list') return Promise.resolve({ data: JSON.parse(JSON.stringify(window.rows)), error: null });
    if (n === 'hs_youtube_video_suggest') {
      if (a.p_topic.links.some((u) => !/^https?:\/\//.test(u))) return Promise.resolve({ data: null, error: { code: '22023', message: 'This is not a web link (it must start with http:// or https://): ' + a.p_topic.links[0] } });
      window.rows.unshift({ id: 'n' + window.rows.length, title: a.p_topic.title, place: a.p_topic.place, note: a.p_topic.note, links: a.p_topic.links,
        status: 'waiting', created_at: new Date().toISOString() });
      return Promise.resolve({ data: window.rows[0], error: null });
    }
    if (n === 'hs_youtube_video_suggestion_withdraw') { const r = window.rows.find((x) => x.id === a.p_id); r.status = 'withdrawn'; return Promise.resolve({ data: r, error: null }); }
    return Promise.resolve({ data: null, error: { code: 'x' } });
  } };
});
await page.evaluate(() => window.HS.acqVideoSuggest.mount(window.client, document.getElementById('host')));
let html = await page.innerHTML('#host');
ok(html.includes('Suggest a video') && html.includes('Made one &lt;b&gt;') && !html.includes('<b>Made one <b>'), '2a the box and an escaped existing suggestion are shown');
ok(html.includes('href="https://ok.gov/a"') && !html.includes('javascript:'), '2b only web links become links');
ok(!html.includes('vs-withdraw'), '2c a made suggestion has no Withdraw button');

await page.click('#vs-form summary');
await page.fill('#vs-title', 'Blair Waterway dredging');
await page.fill('#vs-place', '98421');
// 2d: words typed in the Links box (the founder's "Apollo Global Management,") are kept as a note,
// a bare domain gets https://, and the suggestion is added instead of failing silently.
await page.fill('#vs-links', 'Apollo Global Management,\nwww.waterrights.utah.gov/x');
await page.click('.vs-add');
await page.waitForFunction(() => /Added/.test(document.querySelector('.vs-msg').textContent));
const sentD = await page.evaluate(() => window.calls.filter((c) => c[0] === 'hs_youtube_video_suggest').pop()[1].p_topic);
ok(sentD.links.length === 1 && sentD.links[0] === 'https://www.waterrights.utah.gov/x' && /Apollo Global Management/.test(sentD.note),
  '2d words in the Links box become the note; a bare domain becomes an https link');
const sp = await page.evaluate(() => window.HS.acqVideoSuggest.splitLinks('see https://a.gov/x), and b.org'));
ok(sp.links.join('|') === 'https://a.gov/x|https://b.org' && sp.words === 'see and', '2d2 splitLinks strips trailing punctuation and keeps words');
// put the form back for 2e
await page.click('#vs-form summary').catch(() => {});
if (!(await page.isVisible('#vs-title'))) await page.click('#vs-form summary');
await page.fill('#vs-title', 'Blair Waterway dredging');
await page.fill('#vs-place', '98421');
await page.fill('#vs-links', 'https://apps.ecology.wa.gov/x\nhttps://pierce.gov/y');
await page.fill('#vs-note', 'Biggest change in the port');
await page.click('.vs-add');
await page.waitForFunction(() => /Added/.test(document.querySelector('.vs-msg').textContent));
const sent = await page.evaluate(() => window.calls.filter((c) => c[0] === 'hs_youtube_video_suggest').pop()[1].p_topic);
ok(sent.title === 'Blair Waterway dredging' && sent.place === '98421' && sent.links.length === 2 && sent.note === 'Biggest change in the port',
  '2e the suggestion sends title, place, both links and the note');
html = await page.innerHTML('#host');
ok(html.includes('Blair Waterway dredging') && html.includes('Waiting: the next video session takes it first') && html.includes('vs-withdraw'),
  '2f the new suggestion is listed as waiting, with Withdraw');
ok((await page.inputValue('#vs-title')) === '', '2g the form is cleared after adding');

await page.click('.vs-item[data-id="n1"] .vs-withdraw');
await page.waitForFunction(() => /Withdrawn/.test(document.querySelector('.vs-item[data-id="n1"]').textContent));
ok(true, '2h Withdraw closes the suggestion');

await page.setViewportSize({ width: 390, height: 800 });
ok(await page.evaluate(() => document.documentElement.scrollWidth <= 390), '2i no sideways scroll at phone width');
await browser.close();

if (fails) { console.log(fails + ' failed'); process.exit(1); }
console.log('all passed');
