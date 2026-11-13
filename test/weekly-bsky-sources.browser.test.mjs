// Real Chromium: Tab 20's Bluesky weekly-report posts (lib/acq-weekly-topics.js, HS.acqWeeklyTopics.load, the Tab 20
// entry point) against a STUB client. test/fixtures/weekly-bsky-sources.json holds the REAL answers of
// hs_weekly_topic_queue and hs_weekly_bsky_sources on a disposable database after test/weekly_bsky_sources_pg/suite.sql.
// Everything in it is TEST DATA. No request leaves the page.
//   node test/weekly-bsky-sources.browser.test.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const fs = require('node:fs');
let fails = 0;
const ok = (c, name) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name); if (!c) fails++; };
const read = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const style = read('acquisition.html').match(/<style>[\s\S]*?<\/style>/)[0];
const HTML = '<!doctype html><html><head><meta charset="utf-8">' + style + '</head><body><div id="t"></div><script src="/tq.js"></script></body></html>';
const F = JSON.parse(read('test/fixtures/weekly-bsky-sources.json'));
const DC = F.queue.leads.find((l) => l.title === 'data centers');

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1300, height: 900 } });
const outside = [];
await ctx.route('**/*', (r) => {
  const u = new URL(r.request().url());
  if (u.origin !== 'https://t.test') { outside.push(u.href); return r.abort(); }
  if (u.pathname === '/tq.js') return r.fulfill({ contentType: 'text/javascript', body: read('lib/acq-weekly-topics.js') });
  return r.fulfill({ contentType: 'text/html', body: HTML });
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('dialog', (d) => { errors.push('dialog'); d.dismiss(); });
await page.goto('https://t.test/');
const boot = (F, mode) => page.evaluate(([F, mode]) => {
  window.calls = [];
  window.F = F;
  window.client = { rpc: (n, a) => {
    window.calls.push([n, a]);
    const ed = a && a.p_edition;
    if (n === 'hs_weekly_topic_queue') return Promise.resolve({ data: ed ? F.queue_edition : F.queue, error: null });
    if (n === 'hs_weekly_bsky_sources') {
      if (mode === 'missing') return Promise.resolve({ data: null, error: { message: 'Could not find the function public.hs_weekly_bsky_sources(p_edition) in the schema cache (PGRST202)' } });
      return Promise.resolve({ data: ed ? F.sources_edition : F.sources, error: null });
    }
    return Promise.resolve({ data: { ok: true }, error: null });
  } };
  document.getElementById('t').innerHTML = '';
  document.getElementById('t').__tqBound = false;
  return window.HS.acqWeeklyTopics.load(window.client, document.getElementById('t'));
}, [F, mode]);

// 1 not installed: the queue renders and there is no Bluesky section
await boot(F, 'missing');
await page.waitForSelector('.tq-lead');
ok((await page.locator('#tq-bsky').count()) === 0 && (await page.locator('.tq-lead').count()) > 0 && !(await page.locator('.tq-bad').count()),
  '1 when the SQL file is not installed, the section is hidden and the queue works as before');

// 2 installed
await boot(F, 'ok');
await page.waitForSelector('#tq-bsky');
const sec = await page.locator('#tq-bsky').innerText();
ok(/QUALITY-of-LIFE WEEKLY REPORT:/.test(sec) && /every 2 hours/.test(sec) && /last check failed/.test(sec) && /bsky 503/.test(sec),
  '2a the section says what it imports, how often, and the last failure');
ok(/Needs a topic \(1\)/.test(sec) && /Data Centersville/.test(sec) && (await page.locator('select[data-bsky-file]').count()) === 1,
  '2b a post with no matching topic is kept for review with a topic chooser');
const dc = page.locator('.tq-lead[data-lead="' + DC.id + '"]');
await page.click('.tq-tabs button[data-v="all"]');
const dcText = await dc.innerText();
ok(/Bluesky posts \(3\)/.test(dcText) && /also matches: Data Center/.test(dcText) && /SpaceX plans/.test(dcText) && /Oakland extends/.test(dcText),
  '2c the topic card lists its posts by headline, with the alias it answers to');
const sp = dc.locator('.tq-bs', { hasText: 'SpaceX plans' });
await sp.locator('summary').click();
const spText = await sp.innerText();
ok(/3 continuations/.test(spText) && spText.indexOf('First reply') < spText.indexOf('Second reply') && spText.indexOf('Second reply') < spText.indexOf('Third reply'),
  '2d the account\'s continuation replies, in order');
ok(/Quoted post by @reporter\.example/.test(spText) && /someone else’s writing/.test(spText) && /Their words/.test(spText), '2e a quoted post is shown as someone else\'s writing');
const orig = sp.locator('a', { hasText: 'Original post' });
ok((await orig.getAttribute('href')).startsWith('https://bsky.app/profile/') && (await orig.getAttribute('rel')) === 'noopener noreferrer', '2f the original post link');
ok((await page.locator('#t img').count()) === 0, '2g no third-party image is loaded (media are links only)');

// 3 filing a review item calls the admin function with the chosen topic
const sel = page.locator('select[data-bsky-file]');
const sid = await sel.getAttribute('data-bsky-file');
await sel.selectOption(DC.id);
await page.evaluate(() => { window.calls = []; });
await page.click('button[data-tq="bsky-file"]');
await page.waitForFunction(() => window.calls.some((c) => c[0] === 'hs_weekly_topic_queue'));
const filed = await page.evaluate(() => window.calls.filter((c) => c[0] === 'hs_weekly_bsky_source_file').map((c) => c[1]));
ok(filed.length === 1 && filed[0].p_source === sid && filed[0].p_lead === DC.id, '3 "File" files the post under the chosen topic');

// 4 an edition: its posts, as published
await page.selectOption('#tq-edition', F.edition_id);
await page.waitForFunction(() => /Bluesky posts for this edition/.test(document.getElementById('tq-bsky').innerText));
const edText = await page.locator('#tq-bsky').innerText();
ok(/Bluesky posts for this edition \(2\)/.test(edText) && /as they were when its publication was recorded/.test(edText) && (await page.locator('button[data-tq="bsky-copy"]').count()) === 1,
  '4a an edition shows its topics\' posts, as published, with a copy button');
const copy = await page.evaluate(() => window.HS.acqWeeklyTopics.bskyCopyText(window.F.sources_edition.edition.sources));
ok(/https:\/\/bsky\.app\/profile\//.test(copy) && /quotes @reporter\.example \(someone else\)/.test(copy) && /continuation: First reply/.test(copy)
  && !/Third reply/.test(copy), '4b the copied text carries links, continuations and attribution, and the published version only');

// 5 imported text is shown as text
const evil = JSON.parse(JSON.stringify(F));
evil.sources.review[0].story_text = '<img src=x onerror="window.pwned=1">';
evil.sources.review[0].content.text = '<script>window.pwned=1</script>';
await boot(evil, 'ok');
await page.waitForSelector('#tq-bsky');
ok(!(await page.evaluate(() => window.pwned)) && (await page.locator('#tq-bsky').innerText()).includes('<img src=x'), '5 a post\'s text is escaped, never run');

ok(!errors.length, '6a no script errors or dialogs' + (errors.length ? ': ' + errors.join('; ') : ''));
ok(!outside.length, '6b no request left the page');
await browser.close();
console.log(fails ? fails + ' failed' : 'all passed');
process.exit(fails ? 1 : 0);
