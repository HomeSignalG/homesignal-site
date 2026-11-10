// Real Chromium: Tab 20 · Weekly Report (Stage 1 offline prototype) on a page that uses the dashboard's own styles.
// The page is served from a stub origin so localStorage behaves as on the dashboard; no network request leaves it.
// The import fixture is TEST DATA (test/fixtures/weekly-report), not real discovery output.
// Run: node test/weekly-report.browser.test.mjs            (SHOTS=<dir> also saves screenshots)
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
let fails = 0;
const ok = (c, name) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name); if (!c) fails++; };
const read = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const acq = read('acquisition.html');
const style = acq.match(/<style>[\s\S]*?<\/style>/)[0];
const HTML = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' + style +
  '</head><body><main><div class="tab active" id="tab-weeklyreport"></div></main><script src="/topics.js"></script><script src="/wr.js"></script>' +
  '<script>window.HS.acqWeeklyReport.load(null, document.getElementById("tab-weeklyreport"));</script></body></html>';
const FIX = path.join(path.dirname(new URL(import.meta.url).pathname), 'fixtures/weekly-report');
const SHOTS = process.env.SHOTS || '';

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: SHOTS ? 2 : 1 });
const outside = [];
await ctx.route('**/*', (r) => {
  const u = new URL(r.request().url());
  if (u.origin !== 'https://wr.test') { outside.push(u.href); return r.abort(); }
  if (u.pathname === '/topics.js') return r.fulfill({ contentType: 'text/javascript', body: read('topics.js') });
  if (u.pathname === '/wr.js') return r.fulfill({ contentType: 'text/javascript', body: read('lib/acq-weekly-report.js') });
  return r.fulfill({ contentType: 'text/html', body: HTML });
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('dialog', (d) => { errors.push('dialog: ' + d.message()); d.dismiss(); });
await page.goto('https://wr.test/');
const T = () => page.locator('#tab-weeklyreport');
const text = () => T().innerText();
const shot = async (name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name + '.png'), fullPage: true }); };

// 1. opens empty, on Data Centers
const topics = await page.locator('.wr-topic').allInnerTexts();
const expected = await page.evaluate(() => window.HS.universalTopics.slice());
ok(topics.length === 13 && JSON.stringify(topics) === JSON.stringify(expected), '1a all 13 topics, in the Local News order');
ok(await page.locator('.wr-topic.on').innerText() === 'Data Centers', '1b Data Centers is selected first');
let t = await text();
ok(t.includes('QUALITY-of-LIFE Weekly Report : Data Centers'), '1c the Data Centers thumbnail title');
ok(t.includes('No sourced knowledge for this topic yet.') && !/DEMO/.test(t), '1d an honest empty workspace, no demo content');
ok(t.includes('Not connected until Stage 2') && t.includes('This prototype does not learn from finished videos.'), '1e Stage 2 features are marked not connected');
const secs = await page.locator('.wr-sec').allInnerTexts();
ok(JSON.stringify(secs) === JSON.stringify(['Overview / knowledge', 'Research', 'Visual library', 'New weekly report', 'Previous reports', 'Lessons and corrections']), '1f the six sections');
await shot('01-empty-data-centers');

// 2. titles change with the topic; every topic gets the same workspace
await page.locator('.wr-topic', { hasText: 'Air Quality' }).click();
ok((await text()).includes('QUALITY-of-LIFE Weekly Report : Air'), '2a Air Quality → ": Air"');
await page.locator('.wr-topic', { hasText: 'Water Quality' }).click();
ok((await text()).includes('QUALITY-of-LIFE Weekly Report : Water'), '2b Water Quality → ": Water"');
await page.locator('.wr-topic', { hasText: 'Radiation' }).click();
ok((await text()).includes('QUALITY-of-LIFE Weekly Report : Radiation') && await page.locator('.wr-sec').count() === 6, '2c Radiation uses its name and the same six sections');
await page.locator('.wr-topic', { hasText: 'Data Centers' }).click();

// 3. demo data is labelled and kept apart
await page.locator('[data-act="demo"]').click();
t = await text();
ok(t.includes('DEMO DATA — an example, not real discovery output.'), '3a the demo banner');
ok(t.includes('DEMO: A county board approved') && /disputed/i.test(t) && /superseded/i.test(t), '3b demo knowledge shows verified, disputed and superseded findings');
await shot('02-demo-overview');
await page.locator('.wr-sec', { hasText: 'New weekly report' }).click();
await page.locator('[data-act="draft"]').click();
for (const id of ['s1', 's2']) await page.locator('.wr-story[data-story="' + id + '"]').check();
ok(await page.locator('[data-act="pick"][data-cand="dm3"]').isDisabled() && await page.locator('[data-act="pick"][data-cand="dm4"]').isDisabled(), '3c rights-unresolved demo pictures cannot be selected');
await page.locator('[data-act="pick"][data-cand="dm1"]').click();
await page.locator('[data-act="approve"][data-kind="pictures"]').click();
ok((await page.locator('[data-appr="pictures"]').innerText()).includes('approved'), '3d a demo picture approval');
ok(await page.locator('#wr-render').isDisabled() && (await text()).includes('Demo data can never be rendered.'), '3e demo can never be rendered');
await shot('03-demo-new-report');
const stored = await page.evaluate(() => localStorage.getItem('hs-weekly-report-stage1'));
ok(!stored || !/DEMO|dm1|approvals":\{"pictures":\{/.test(stored), '3f nothing from the demo reached the real store');
await page.locator('[data-act="real"]').click();
await page.locator('.wr-sec', { hasText: 'New weekly report' }).click();
ok((await text()).includes('Start a new report') && !/DEMO/.test(await text()), '3g back in the real workspace there is no demo report or approval');
await page.reload();
await page.locator('.wr-sec', { hasText: 'New weekly report' }).click();
ok(!/DEMO/.test(await text()), '3h after a reload the demo is gone too');

// 4. importing a discovery run (TEST DATA)
await page.locator('.wr-sec', { hasText: 'Visual library' }).click();
await page.setInputFiles('#wr-import', [path.join(FIX, 'test-data.json'), path.join(FIX, 'test-sheet.html')]);
await page.waitForSelector('.wr-msg');
t = await text();
ok(t.includes('Loaded 3 candidates from test-data.json.'), '4a 3 candidates loaded (2 searched + 1 lead image)');
ok(t.includes('Missing: TEST: County weighs a data center rezoning · a hearing room') && t.includes('Failed search: TEST openverse: HTTP 503'), '4b the missing need and the failed search are shown');
ok(await page.locator('.wr-card[data-cand="TEST-RUN-1:aaa111aaa111"] img.wr-thumb').count() === 1, '4c the thumbnail comes from the contact sheet');
const lead = page.locator('.wr-card[data-cand="TEST-RUN-1:ccc333ccc333"]');
ok(await lead.locator('img').count() === 0 && (await lead.innerText()).includes('Image not embedded: rights unresolved.'), '4d the lead image is never embedded, only linked');
const xss = page.locator('.wr-card[data-cand="TEST-RUN-1:bbb222bbb222"]');
ok((await xss.innerText()).includes('<img src=x onerror=alert(1)>') && await xss.locator('img[onerror]').count() === 0, '4e titles are escaped');
ok(await xss.locator('a[href^="javascript:"]').count() === 0, '4f a javascript: link is not linked');
ok((await xss.innerText()).includes('uncertain: location not stated by the source'), '4g uncertainty is shown');
await shot('04-real-visual-library');

// 5. a real report: approvals and their invalidation
await page.locator('.wr-sec', { hasText: 'New weekly report' }).click();
await page.locator('[data-act="draft"]').click();
await page.locator('.wr-story[data-story="TEST-RUN-1:t-rezone"]').check();
const SID = 'TEST-RUN-1:t-rezone';
ok(await page.locator('[data-act="pick"][data-cand="TEST-RUN-1:bbb222bbb222"]').isDisabled() && await page.locator('[data-act="pick"][data-cand="TEST-RUN-1:ccc333ccc333"]').isDisabled(), '5a rights-unresolved pictures cannot be selected');
await page.locator('[data-act="pick"][data-cand="TEST-RUN-1:aaa111aaa111"]').click();
await page.locator('textarea[data-seg="' + SID + '|0"]').fill('Farmland near the proposed site.');
await page.locator('select[data-vis="' + SID + '|0"]').selectOption('TEST-RUN-1:aaa111aaa111');
await page.locator('[data-act="approve"][data-kind="pictures"]').click();
await page.locator('[data-act="approve"][data-kind="script"]').click();
const appr = async (k) => page.locator('[data-appr="' + k + '"]').innerText();
ok(/approval:\s*approved/.test(await appr('pictures')) && /approval:\s*approved/.test(await appr('script')), '5b both approvals current');
ok(await page.locator('#wr-render').isDisabled(), '5c render stays disabled even with both approvals');
t = await text();
ok(/✓ Every picture in the script is rights-cleared/.test(t) && /✕ Remotion licence/.test(t) && /✕ Render job connected/.test(t), '5d gates: pictures cleared, licence and job not');
await shot('05-real-report-approved');
// script edit
await page.locator('textarea[data-seg="' + SID + '|0"]').fill('Farmland near the proposed site, edited.');
ok(/changed after approval/.test(await appr('script')) && /approval:\s*approved/.test(await appr('pictures')), '5e editing the script makes only the script approval stale');
await page.locator('[data-act="approve"][data-kind="script"]').click();
// assignment change
await page.locator('select[data-vis="' + SID + '|0"]').selectOption('');
ok(/changed after approval/.test(await appr('pictures')) && /changed after approval/.test(await appr('script')), '5f changing the segment picture makes both approvals stale');
await page.locator('select[data-vis="' + SID + '|0"]').selectOption('TEST-RUN-1:aaa111aaa111');
ok(/approval:\s*approved/.test(await appr('pictures')) && /approval:\s*approved/.test(await appr('script')), '5g putting it back matches what was approved');
// picture selection change
await page.locator('[data-act="reject"][data-cand="TEST-RUN-1:aaa111aaa111"]').click();
ok(/changed after approval/.test(await appr('pictures')), '5h rejecting the selected picture makes the picture approval stale');
await page.locator('[data-act="pick"][data-cand="TEST-RUN-1:aaa111aaa111"]').click();
await page.locator('select[data-vis="' + SID + '|0"]').selectOption('TEST-RUN-1:aaa111aaa111');
ok(/approval:\s*approved/.test(await appr('pictures')) && /approval:\s*approved/.test(await appr('script')), '5h2 restoring the selection and its segment matches what was approved again');
// rights evidence change on re-import
const fix = JSON.parse(fs.readFileSync(path.join(FIX, 'test-data.json'), 'utf8'));
fix.stories[0].needs[0].shown[0].rights_evidence = 'TEST: CC BY-SA 4.0 stated on the file page';
const tmp = path.join(require('node:os').tmpdir(), 'wr-reimport-' + process.pid + '.json');
fs.writeFileSync(tmp, JSON.stringify(fix));
await page.locator('.wr-sec', { hasText: 'Visual library' }).click();
await page.setInputFiles('#wr-import', [tmp]);
await page.waitForSelector('.wr-msg');
await page.locator('.wr-sec', { hasText: 'New weekly report' }).click();
ok(/changed after approval/.test(await appr('pictures')) && /approval:\s*approved/.test(await appr('script')), '5i a rights-evidence change on re-import makes the picture approval stale');
fix.stories[0].needs[0].shown[0].rights = 'needs_confirmation';
fs.writeFileSync(tmp, JSON.stringify(fix));
await page.locator('.wr-sec', { hasText: 'Visual library' }).click();
await page.setInputFiles('#wr-import', [tmp]);
await page.waitForSelector('.wr-msg');
await page.locator('.wr-sec', { hasText: 'New weekly report' }).click();
ok(/✕ Every picture in the script is rights-cleared/.test(await text()), '5j a picture whose rights become unresolved fails the rights gate');
fs.unlinkSync(tmp);

// 6. real work survives a reload; a wrong file is refused
await page.reload();
await page.locator('.wr-sec', { hasText: 'New weekly report' }).click();
ok(await page.locator('textarea[data-seg="' + SID + '|0"]').inputValue() === 'Farmland near the proposed site, edited.', '6a the real report is still there after a reload');
await page.locator('.wr-sec', { hasText: 'Visual library' }).click();
const bad = path.join(require('node:os').tmpdir(), 'wr-bad-' + process.pid + '.json');
fs.writeFileSync(bad, JSON.stringify({ schema: 'something-else' }));
await page.setInputFiles('#wr-import', [bad]);
await page.waitForSelector('.wr-msg');
ok((await page.locator('.wr-msg').innerText()).startsWith('Not loaded:'), '6b a file of another kind is refused');
fs.unlinkSync(bad);

// 7. phone width
await page.setViewportSize({ width: 390, height: 844 });
for (const sec of ['Overview / knowledge', 'Visual library', 'New weekly report']) {
  await page.locator('.wr-sec', { hasText: sec }).click();
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok(over <= 0, '7 no sideways scroll at 390px: ' + sec + ' (' + over + 'px)');
}
await shot('06-phone-new-report');

ok(outside.length === 0, '8a no request left the page (' + outside.length + ')');
ok(errors.length === 0, '8b no script errors or dialogs' + (errors.length ? ': ' + errors.join(' | ') : ''));
await browser.close();
console.log(fails ? fails + ' failed' : 'all passed');
process.exit(fails ? 1 : 0);
