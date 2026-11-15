// Real Chromium: Tab 20's Video card (lib/acq-weekly-video.js), mounted through the Tab 20 entry point
// (HS.acqWeeklyTopics.load) against a STUB client. The queue answers are the real fixture of
// test/fixtures/weekly-bsky-sources.json; the video answers have the shape hs_weekly_video_status returns
// (docs/weekly-video.sql, proven in test/weekly_stage2_pg/video.sql). Everything is TEST DATA. No request leaves the page.
//   node test/weekly-video.browser.test.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const fs = require('node:fs');
let fails = 0;
const ok = (c, name, x) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name + (c || x === undefined ? '' : ' ' + JSON.stringify(x))); if (!c) fails++; };
const read = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const style = read('acquisition.html').match(/<style>[\s\S]*?<\/style>/)[0];
const HTML = '<!doctype html><html><head><meta charset="utf-8">' + style +
  '</head><body><div id="t"></div><script src="/wv.js"></script><script src="/tq.js"></script></body></html>';
const F = JSON.parse(read('test/fixtures/weekly-bsky-sources.json'));
const ED = F.edition_id;
const JOB = '11111111-2222-4333-8444-555555555555';
const done = { jobs: [{ id: JOB, status: 'done', requested_by: 'founder@test.invalid', requested_at: '2026-11-15T15:00:00Z',
  claimed_at: '2026-11-15T15:01:00Z', finished_at: '2026-11-15T15:50:00Z', error: null, result: { quality: { ok: true } },
  assets: [
    { id: 'a-main', asset: 'main', path: 'weekly/x/' + JOB + '/main.mp4', width: 1920, height: 1080, duration_s: 212, qc: { ok: true, quality: { ok: false, failures: [{ code: 'slow_pacing', label: 'Slow pacing' }] } }, stills: [], decisions: [] },
    { id: 'a-thumb', asset: 'thumbnail', path: 'weekly/x/' + JOB + '/thumbnail.png', width: 1280, height: 720, qc: { ok: true }, stills: [], decisions: [] }] }] };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1300, height: 900 } });
const outside = [];
await ctx.route('**/*', (r) => {
  const u = new URL(r.request().url());
  if (u.origin !== 'https://t.test') { outside.push(u.href); return r.abort(); }
  if (u.pathname === '/tq.js') return r.fulfill({ contentType: 'text/javascript', body: read('lib/acq-weekly-topics.js') });
  if (u.pathname === '/wv.js') return r.fulfill({ contentType: 'text/javascript', body: read('lib/acq-weekly-video.js') });
  return r.fulfill({ contentType: 'text/html', body: HTML });
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('dialog', (d) => { errors.push('dialog'); d.dismiss(); });
await page.goto('https://t.test/');
const boot = (mode, st) => page.evaluate(([F, mode, st]) => {
  window.calls = []; window.downloads = [];
  window.st = st;
  window.client = {
    rpc: (n, a) => {
      window.calls.push([n, a]);
      const ed = a && a.p_edition;
      if (n === 'hs_weekly_topic_queue') return Promise.resolve({ data: ed ? F.queue_edition : F.queue, error: null });
      if (n === 'hs_weekly_bsky_sources') return Promise.resolve({ data: ed ? F.sources_edition : F.sources, error: null });
      if (n === 'hs_weekly_video_status') {
        if (mode === 'missing') return Promise.resolve({ data: null, error: { message: 'Could not find the function public.hs_weekly_video_status(p_edition) in the schema cache', code: 'PGRST202' } });
        return Promise.resolve({ data: window.st, error: null });
      }
      if (n === 'hs_weekly_video_request') { window.st = { jobs: [{ id: 'j2', status: 'queued', requested_at: '2026-11-15T16:00:00Z', assets: [] }] }; return Promise.resolve({ data: { job_id: 'j2', status: 'queued', existing: false }, error: null }); }
      if (n === 'hs_weekly_video_decide') return Promise.resolve({ data: { ok: true }, error: null });
      return Promise.resolve({ data: null, error: { message: 'Could not find the function (PGRST202)', code: 'PGRST202' } });
    },
    storage: { from: (b) => ({ download: (p) => { window.downloads.push([b, p]); return Promise.resolve({ data: new Blob(['x'], { type: p.endsWith('.png') ? 'image/png' : 'video/mp4' }), error: null }); } }) },
  };
  const el = document.getElementById('t'); el.innerHTML = ''; el.__tqBound = false; el.__wvEl = null;
  return window.HS.acqWeeklyTopics.load(window.client, el);
}, [F, mode, st]);

// 1 not installed: no card, and the queue works
await boot('missing', null);
await page.waitForSelector('#tq-edition');
await page.selectOption('#tq-edition', ED);
await page.waitForTimeout(300);
ok((await page.locator('#wv-card').count()) === 0 && (await page.locator('.wv-bad').count()) === 0, '1 without the video SQL installed, there is no Video card and no error');

// 2 no video yet: Make video, placed right under Report editions
await boot('ok', { jobs: [] });
await page.selectOption('#tq-edition', ED);
await page.waitForSelector('#wv-card');
const order = await page.evaluate(() => { const ids = [...document.querySelectorAll('.card')].map((c) => c.id); return ids; });
ok(order.indexOf('wv-card') === order.indexOf('tq-editions') + 1, '2a the Video card sits right under Report editions', order);
ok(/No video made for this edition yet/.test(await page.locator('#wv-card').innerText()), '2b it says no video has been made yet');
await page.click('[data-wv="make"]');
await page.waitForSelector('.wv-busy');
const req = await page.evaluate(() => window.calls.filter((c) => c[0] === 'hs_weekly_video_request'));
ok(req.length === 1 && req[0][1].p_edition === F.edition_id, '2c Make video asks the database for this edition only');
ok(/Waiting for a worker/.test(await page.locator('#wv-card').innerText()) && (await page.locator('[data-wv="make"]').count()) === 0,
  '2d while a job is queued the card says so and offers no second Make video');

// 3 a finished video: watch, warnings, approve, ask for changes
await boot('ok', done);
await page.selectOption('#tq-edition', ED);
await page.waitForSelector('.wv-asset');
const txt = await page.locator('#wv-card').innerText();
ok(/Main video/.test(txt) && /Thumbnail/.test(txt) && /0 of 2 approved/.test(txt), '3a both files are listed with how many are approved');
ok(/Picture check: Slow pacing/.test(txt), '3b a picture-check warning is shown in plain words');
await page.click('[data-wv="play"][data-path$="main.mp4"]');
await page.waitForSelector('video.wv-video');
const dl = await page.evaluate(() => window.downloads);
ok(dl.length === 1 && dl[0][0] === 'impact-media' && dl[0][1].endsWith('/main.mp4') && /^blob:/.test(await page.locator('video.wv-video').getAttribute('src')),
  '3c Watch downloads the file from the private bucket and plays it from a blob', dl);
// a redraw of the queue keeps the playing video
await page.selectOption('#tq-edition', ED);
await page.waitForTimeout(300);
ok((await page.locator('video.wv-video').count()) === 1, '3d redrawing the queue does not reset the playing video');
await page.click('[data-wv="changes"][data-asset="a-main"]');
ok(/Say what should change first/.test(await page.locator('#wv-card').innerText()), '3e asking for changes with no note is refused on the page');
await page.fill('[data-note="a-main"]', 'Use a photo of Westlake');
await page.click('[data-wv="changes"][data-asset="a-main"]');
await page.waitForTimeout(200);
await page.click('[data-wv="approve"][data-asset="a-thumb"]');
await page.waitForTimeout(200);
const dec = await page.evaluate(() => window.calls.filter((c) => c[0] === 'hs_weekly_video_decide').map((c) => c[1]));
ok(dec.length === 2 && dec[0].p_asset === 'a-main' && dec[0].p_decision === 'changes' && dec[0].p_note === 'Use a photo of Westlake'
  && dec[1].p_asset === 'a-thumb' && dec[1].p_decision === 'approved', '3f decisions are sent with the file, the decision and the note', dec);

// 4 a failed job says why
await boot('ok', { jobs: [{ id: 'j3', status: 'failed', error: 'No video script has been written for this edition yet.', assets: [] }] });
await page.selectOption('#tq-edition', ED);
await page.waitForSelector('#wv-card .wv-bad');
ok(/could not be made: No video script/.test(await page.locator('#wv-card').innerText()) && (await page.locator('[data-wv="make"]').count()) === 1,
  '4 a failed job shows its reason and offers Make the video again');

// 5 an error message is escaped, never run
await boot('ok', { jobs: [{ id: 'j4', status: 'failed', error: '<img src=x onerror="window.pwned=1">', assets: [] }] });
await page.selectOption('#tq-edition', ED);
await page.waitForSelector('#wv-card .wv-bad');
ok(!(await page.evaluate(() => window.pwned)) && (await page.locator('#wv-card img').count()) === 0, '5 text from the database is escaped');

// 5b a photo the script asks for that the video does not show is named, with why (2026-11-15: never skipped in silence)
const held = JSON.parse(JSON.stringify(done));
held.jobs[0].result.photos_not_used = [{ id: 'cap', title: 'File:Capitol <b>.jpg', license: 'CC BY-SA 3.0', reason: 'license CC BY-SA 3.0 is held for review' }];
await boot('ok', held);
await page.selectOption('#tq-edition', ED);
await page.waitForSelector('#wv-card .wv-warn');
const ht = await page.locator('#wv-card').innerText();
ok(/1 photo the script asks for is not in the video/.test(ht) && ht.includes('Capitol <b>.jpg (CC BY-SA 3.0): license CC BY-SA 3.0 is held')
  && !(await page.innerHTML('#wv-card')).includes('<b>.jpg'), '5b a held photo is named with its license and reason, escaped');
ok(errors.length === 0, '6a no script errors or dialogs', errors);
ok(outside.length === 0, '6b no request left the page', outside);
await browser.close();
console.log(fails ? fails + ' failed' : 'all passed');
process.exit(fails ? 1 : 0);
