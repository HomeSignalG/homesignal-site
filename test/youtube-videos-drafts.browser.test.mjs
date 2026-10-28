// Tab 16 (lib/acq-youtube-videos.js): a reload never wipes what the founder typed and has not saved.
// Founder, 2026-10-28: "my fix notes are disappearing again and it keeps automatically refreshing page". While a
// revision runs the tab reloads itself every 10 s, and each reload rebuilt the whole tab from scratch.
// Real Chromium against a stub client (no network, no credential). Run: node test/youtube-videos-drafts.browser.test.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const fs = require('node:fs');
let fails = 0;
const ok = (c, name) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name); if (!c) fails++; };
const lib = fs.readFileSync(new URL('../lib/acq-youtube-videos.js', import.meta.url), 'utf8');

const { chromium } = require('playwright');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.setContent('<!doctype html><html><body><div id="host"></div></body></html>');
await page.addScriptTag({ content: lib });
await page.evaluate(() => {
  const files = { final: { path: 's/final.mp4' }, short1: { path: 's/short1.mp4' }, short2: { path: 's/short2.mp4' }, thumbnail: { path: 's/thumbnail.png' } };
  window.row = { slug: 's', title: '3009 Test', status: 'pending', created_at: '2026-10-28T00:00:00Z', files, meta: {},
    file_decisions: { short1: { status: 'rejected', note: 'calling it a ranch is odd' }, short2: { status: 'rejected', note: '' } },
    versions: [], revisions: [{ id: 'r1', file_key: 'short1', parent_version: 1, instruction: 'calling it a ranch is odd', status: 'running', attempts: 1, plan: null, result: null }] };
  window.lists = 0;
  window.client = {
    rpc: (n) => {
      if (n === 'hs_youtube_videos_list') { window.lists++; return Promise.resolve({ data: [JSON.parse(JSON.stringify(window.row))], error: null }); }
      return Promise.resolve({ data: null, error: { code: 'x' } });
    },
    storage: { from: () => ({ download: () => new Promise(() => {}) }) }
  };
});
const load = () => page.evaluate(() => window.HS.acqYoutubeVideos.load(window.client, document.getElementById('host')));
await load();
const note2 = '.yv-file[data-key="short2"] .yv-fnote-in';
const noteF = '.yv-file[data-key="final"] .yv-fnote-in';
ok(await page.locator(note2).count() === 1 && await page.locator(noteF).count() === 1, '1 the rejected Short 2 and the final video each show a note box');

// The founder types two notes and leaves the second box focused, then the page reloads (as the 10 s poll does).
await page.fill(noteF, 'say Bar H Ranch, Inc. in full');
await page.fill(note2, 'use the company');
await page.focus(note2);
await page.locator(note2).press('End');
await page.locator(note2).type(' legal name');
await load();
ok(await page.evaluate(() => window.lists) === 2, '2 the tab really reloaded');
ok(await page.inputValue(note2) === 'use the company legal name', '3 the unsaved Short 2 note survives the reload');
ok(await page.inputValue(noteF) === 'say Bar H Ranch, Inc. in full', '4 the unsaved final-video note survives the reload');
ok(await page.evaluate((s) => document.activeElement === document.querySelector(s), note2), '5 the box being typed in keeps the focus');

// Typing continues after the reload and lands in the same box.
await page.keyboard.type('!');
ok(await page.inputValue(note2) === 'use the company legal name!', '6 typing after the reload continues where it left off');

// A value the server changed is never overwritten by an older draft.
await page.evaluate(() => { window.row.file_decisions.short2 = { status: 'rejected', note: 'saved elsewhere' }; });
await load();
ok(await page.inputValue(note2) === 'saved elsewhere', '7 a note the server changed is shown, not the older draft');

// An opened section stays open across a reload.
const det = await page.locator('#host details').count();
if (det) {
  await page.evaluate(() => { document.querySelector('#host details').open = true; });
  await load();
  ok(await page.evaluate(() => document.querySelector('#host details').open === true), '8 an opened section stays open after a reload');
} else ok(false, '8 the fixture renders a <details> section');

// A reload does not flash "Loading videos…" over the tab.
await page.evaluate(() => {
  window.seen = false;
  new MutationObserver(() => { if (/Loading videos/.test(document.getElementById('host').textContent)) window.seen = true; })
    .observe(document.getElementById('host'), { childList: true, subtree: true });
});
await load();
ok(await page.evaluate(() => window.seen) === false, '9 a reload keeps the tab on screen instead of blanking it');

// The founder can see what a running revision is doing (founder, 2026-10-28: "no indication of what it is working on").
const prog = await page.evaluate(() => {
  const P = window.HS.acqYoutubeVideos.progressHtml, now = Date.parse('2026-10-28T21:50:00Z');
  return {
    queued: P({ status: 'queued', created_at: '2026-10-28T21:38:00Z', attempts: 1 }, now),
    running: P({ status: 'running', created_at: '2026-10-28T21:38:00Z', started_at: '2026-10-28T21:40:00Z', attempts: 2 }, now),
    checking: P({ status: 'validating', started_at: '2026-10-28T21:40:00Z', attempts: 1 }, now),
    tile: document.querySelector('.yv-file[data-key="short1"]').textContent
  };
});
ok(/waiting for a build computer/.test(prog.queued) && /12 min ago/.test(prog.queued), '10 a queued job says it is waiting, and for how long');
ok(/building the corrected version/.test(prog.running) && /10 min so far/.test(prog.running) && /Attempt 2 of 3/.test(prog.running), '11 a running job says it is building, for how long, and which attempt');
ok(/checking the corrected version/.test(prog.checking), '12 a validating job says it is checking');
ok(/Step 1 of 3: waiting/.test(prog.tile) && /Last checked/.test(prog.tile), '13 the generating tile shows the step and when the page last checked');

await browser.close();
if (fails) { console.log(fails + ' FAILED'); process.exit(1); }
console.log('all passed');
