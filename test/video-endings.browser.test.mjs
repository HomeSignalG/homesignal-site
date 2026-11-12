// Your recorded endings (lib/acq-video-endings.js): real Chromium against a stub client (no network, no credential).
// Founder, 2026-11-12: upload a recording, choose it per main video / Short in Tab 16, 17 and 20.
// Run: node test/video-endings.browser.test.mjs
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
const require = createRequire(import.meta.url);
const fs = require('node:fs');
let fails = 0;
const ok = (c, name) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name); if (!c) fails++; };
const read = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const lib = read('lib/acq-video-endings.js');
const page0 = read('acquisition.html');

// 1. wiring
const key = crypto.createHash('sha256').update(fs.readFileSync(new URL('../lib/acq-video-endings.js', import.meta.url))).digest('hex').slice(0, 8);
ok(page0.includes('lib/acq-video-endings.js?v=' + key), '1a acquisition.html loads the module with its content key');
ok(page0.includes('<div id="ve-youtube-host"></div>') && /acqVideoEndings\.mount\(window\.hsClient, ve, \{ tab: 'youtube' \}\)/.test(page0),
  '1b Tab 16 mounts it in its own box');
ok(page0.includes('<div id="ve-impact-host"></div><div id="is-host"></div>') && /acqVideoEndings\.mount\(window\.hsClient, ve, \{ tab: 'impact' \}\)/.test(page0)
  && /getElementById\('is-host'\)/.test(page0), '1c Tab 17 mounts it above the workspace, which moves to its own box');
ok(!/service_role|SERVICE_ROLE/.test(lib), '1d no service key in the page');

const { chromium } = require('playwright');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
// localhost is a secure context (the dashboard is https), so crypto.subtle is available as in production
const http = require('node:http');
const srv = http.createServer((q, r) => { r.setHeader('content-type', 'text/html'); r.end('<!doctype html><html><head></head><body><div id="host"></div></body></html>'); });
await new Promise((res) => srv.listen(0, '127.0.0.1', res));
await page.goto('http://127.0.0.1:' + srv.address().port + '/');
await page.addScriptTag({ content: lib });
await page.evaluate(() => {
  window.calls = []; window.uploads = [];
  window.endings = [{ id: 'e1', label: 'Sign-off <A>', bytes: 3145728, path: 'e1.mp4' }];
  window.choices = { v1: { short1: { id: 'e1', label: 'Sign-off <A>' } } };
  window.client = {
    storage: { from: (b) => ({ upload: (p, f, o) => { window.uploads.push([b, p, f.size, o]); return Promise.resolve({ data: {}, error: null }); } }) },
    rpc: (n, a) => {
      window.calls.push([n, a]);
      const ret = (d) => Promise.resolve({ data: JSON.parse(JSON.stringify(d)), error: null });
      if (n === 'hs_video_endings_list') return ret(window.endings);
      if (n === 'hs_youtube_videos_list') return ret([{ slug: 'v1', title: 'Video one', files: { final: {}, short1: {} } }]);
      if (n === 'hs_impact_story_list') return ret([{ id: 7, story_number: 3001, title: 'Story', archived: null }, { id: 8, title: 'Old', archived: '2026-01-01' }]);
      if (n === 'hs_video_ending_choices') return ret(window.choices[a.p_target] || {});
      if (n === 'hs_video_ending_register') { window.endings.unshift({ id: 'e2', label: a.p_label, bytes: 10, path: a.p_path }); return ret({ id: 'e2' }); }
      if (n === 'hs_video_ending_choose') return ret({ changed: true, revision_id: 'r1' });
      if (n === 'hs_video_ending_archive') { window.endings = window.endings.filter((e) => e.id !== a.p_id); return ret({ archived: true }); }
      return Promise.resolve({ data: null, error: { code: 'x', message: 'unexpected ' + n } });
    }
  };
});
await page.evaluate(() => window.HS.acqVideoEndings.mount(window.client, document.getElementById('host'), { tab: 'youtube' }));
await page.waitForSelector('details.ve-card');
let html = await page.innerHTML('#host');
ok(html.includes('Sign-off &lt;A&gt;') && !html.includes('<A>'), '2a the library lists recordings, escaped');
ok((await page.$eval('select[data-asset="short1"]', (s) => s.value)) === 'e1', '2b the current choice is selected');
ok(await page.$eval('select[data-asset="short2"]', (s) => s.disabled), '2c a file not made yet cannot be chosen for');
ok(await page.$eval('select[data-asset="final"] option', (o) => o.textContent === 'Generated closing line'), '2d "Generated closing line" is the default');

// choose
await page.click('details.ve-card summary');
await page.selectOption('select[data-asset="final"]', 'e1');
await page.waitForFunction(() => /Rebuilding that file/.test((document.querySelector('.ve-msg') || {}).textContent || ''));
let c = await page.evaluate(() => window.calls.filter((x) => x[0] === 'hs_video_ending_choose').pop()[1]);
ok(c.p_tab === 'youtube' && c.p_target === 'v1' && c.p_asset === 'final' && c.p_ending === 'e1', '3a choosing sends tab, video, file and recording');
ok(await page.$eval('details.ve-card', (d) => d.open), '3b the panel stays open after a change');
await page.selectOption('select[data-asset="final"]', '');
c = await page.evaluate(() => window.calls.filter((x) => x[0] === 'hs_video_ending_choose').pop()[1]);
ok(c.p_ending === null, '3c choosing the generated line sends null');

// upload
await page.setInputFiles('.ve-upload input[type=file]', { name: 'me.mov', mimeType: 'video/quicktime', buffer: Buffer.from('hello video') });
await page.fill('.ve-upload input[name=label]', 'Thanks for watching');
await page.click('.ve-upload button[type=submit]');
await page.waitForFunction(() => document.querySelector('.ve-msg, .ve-err') && !/Uploading/.test(document.querySelector('.ve-upload button').textContent));
const up = await page.evaluate(() => window.uploads[0]);
const reg = await page.evaluate(() => window.calls.find((x) => x[0] === 'hs_video_ending_register')[1]);
const want = crypto.createHash('sha256').update('hello video').digest('hex');
ok(up[0] === 'video-endings' && /^[0-9a-f-]{36}\.mov$/.test(up[1]) && up[3].upsert === false, '4a the file goes to the private bucket under <uuid>.mov, never replacing one');
ok(reg.p_path === up[1] && reg.p_sha256 === want && reg.p_label === 'Thanks for watching', '4b it is registered with its sha256');
ok((await page.innerHTML('#host')).includes('Thanks for watching'), '4c the new recording is listed');

// refusals
await page.setInputFiles('.ve-upload input[type=file]', { name: 'me.txt', mimeType: 'text/plain', buffer: Buffer.from('x') });
await page.fill('.ve-upload input[name=label]', 'Bad');
await page.click('.ve-upload button[type=submit]');
ok(/MP4, MOV, WebM or M4V/.test(await page.textContent('.ve-err')), '5a a non-video is refused before upload');

// archive
await page.click('[data-archive="e1"]');
await page.waitForFunction(() => /Removed from your library/.test((document.querySelector('.ve-msg') || {}).textContent || ''));
ok((await page.$eval('select[data-asset="short1"]', (s) => s.selectedOptions[0].textContent)).includes('(archived)'),
  '6a a file still using a removed recording shows it as archived');

// Tab 17
await page.evaluate(() => window.HS.acqVideoEndings.mount(window.client, document.getElementById('host'), { tab: 'impact' }));
await page.waitForSelector('select[data-asset="short_a"]', { state: 'attached' });
html = await page.innerHTML('#host');
ok(html.includes('3001 Story') && !html.includes('Old'), '7a Tab 17 lists open stories only');
await page.click('details.ve-card summary');
await page.selectOption('select[data-asset="short_a"][data-target="7"]', 'e2');
await page.waitForFunction(() => /Prepare the visuals again/.test((document.querySelector('.ve-msg') || {}).textContent || ''));
ok(true, '7b a Tab 17 choice says to prepare the visuals again');

// Tab 20 (weekly): targets handed in
await page.evaluate(() => window.HS.acqVideoEndings.mount(window.client, document.getElementById('host'), { tab: 'weekly', targets: [{ id: 'ed-1', title: 'Week 1', has: () => true }] }));
await page.waitForSelector('select[data-target="ed-1"]', { state: 'attached' });
ok(true, '8a Tab 20 can mount it with its own editions');

// not set up
await page.evaluate(() => { window.client.rpc = () => Promise.resolve({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }); });
await page.evaluate(() => window.HS.acqVideoEndings.mount(window.client, document.getElementById('host'), { tab: 'youtube' }));
await page.waitForFunction(() => /not set up/.test(document.getElementById('host').textContent));
ok(true, '9a before the SQL is applied the panel says so');

// phone width: no sideways scroll
await page.setViewportSize({ width: 390, height: 800 });
await page.evaluate(() => { window.client.rpc = (n, a) => Promise.resolve({ data: n === 'hs_video_endings_list' ? [] : n === 'hs_youtube_videos_list' ? [{ slug: 'v1', title: 'A very long title that should wrap on a phone screen', files: {} }] : {}, error: null }); });
await page.evaluate(() => window.HS.acqVideoEndings.mount(window.client, document.getElementById('host'), { tab: 'youtube' }));
await page.waitForSelector('details.ve-card');
await page.click('details.ve-card summary');
ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), '10a no sideways scroll at 390px');

await browser.close(); srv.close();
console.log(fails ? fails + ' FAILED' : 'ALL PASS');
process.exit(fails ? 1 : 0);
