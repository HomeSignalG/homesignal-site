// Tab 16, step 8, in real Chromium against a stub client (no network, no credential): Full rebuild asks once, calls
// hs_youtube_video_rebuild for that file, shows the rebuild while it runs, and afterwards names the fixes that no longer
// apply. Run: node test/youtube-video-rebuild.browser.test.mjs
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
    file_decisions: { final: { status: 'approved', version: 1 } }, versions: [], revisions: [] };
  window.calls = [];
  window.confirms = [];
  window.answer = true;
  window.confirm = (m) => { window.confirms.push(m); return window.answer; };
  window.client = {
    rpc: (n, a) => {
      if (n === 'hs_youtube_videos_list') return Promise.resolve({ data: [JSON.parse(JSON.stringify(window.row))], error: null });
      if (n === 'hs_youtube_video_plans') return Promise.resolve({ data: [], error: null });
      window.calls.push([n, a]);
      if (n === 'hs_youtube_video_rebuild') {
        window.row.revisions.push({ id: 'r1', file_key: a.p_key, parent_version: 1, status: 'queued', attempts: 1,
          instruction: 'Full rebuild from the current script, keeping every fix already accepted.', plan: { mode: 'rebuild' },
          created_at: '2026-10-30T10:00:00Z' });
        return Promise.resolve({ data: { revision_id: 'r1', status: 'queued' }, error: null });
      }
      return Promise.resolve({ data: null, error: { code: 'x' } });
    },
    storage: { from: () => ({ download: () => new Promise(() => {}) }) }
  };
});
const load = () => page.evaluate(() => window.HS.acqYoutubeVideos.load(window.client, document.getElementById('host')));
const T = '.yv-file[data-key="final"] ';
await load();

ok(await page.locator(T + '.yv-rebuild').count() === 1, '1 every file has a Full rebuild button');
// a "no" in the confirm starts nothing
await page.evaluate(() => { window.answer = false; });
await page.click(T + '.yv-rebuild');
ok(await page.evaluate(() => !window.calls.some((c) => c[0] === 'hs_youtube_video_rebuild')), '2 answering no starts nothing');
ok(await page.evaluate(() => /approved/.test(window.confirms[0]) && /keeping every fix/.test(window.confirms[0])), '3 the question says the approval is replaced and fixes are kept');
await page.evaluate(() => { window.answer = true; });
await page.click(T + '.yv-rebuild');
await page.waitForFunction(() => document.querySelector('.yv-file[data-key="final"]').textContent.includes('Rebuilding this file'));
const c = await page.evaluate(() => window.calls.find((x) => x[0] === 'hs_youtube_video_rebuild'));
ok(c[0] === 'hs_youtube_video_rebuild' && c[1].p_slug === 's' && c[1].p_key === 'final', '4 it rebuilds exactly this file');
ok(!(await page.locator(T).textContent()).includes('Your note:'), '5 a rebuild is not shown as a note');
ok(await page.locator(T + '.yv-rebuild').count() === 0, '6 no second rebuild button while it runs');

// it finished: the new version says it was rebuilt and lists what could not be kept
await page.evaluate(() => {
  const r = window.row.revisions[0];
  Object.assign(r, { status: 'succeeded', result_version: 2, result: { summary: 'Full rebuild from the current script, keeping 2 accepted fixes; 1 no longer applies.' },
    plan: { mode: 'rebuild', corrections: [], dropped: [{ fix: 'speaking speed', detail: 'The old sentence.', reason: 'that sentence is no longer in the script' }] } });
  window.row.files.final.version = 2;
  window.row.file_decisions = {};
});
await load();
const txt = await page.locator(T).textContent();
ok(txt.includes('Rebuilt from the current script') && !txt.includes('Corrected from your note'), '7 the new version says it was rebuilt');
ok(txt.includes('Fixes that no longer apply') && txt.includes('The old sentence.') && txt.includes('no longer in the script'), '8 a fix the script lost is named');

// a plan Claude could not use (the note was a question) is waiting: Full rebuild is still offered on that file
await page.evaluate(() => {
  window.row.files.short1.version = 1;
  window.planRows = [{ id: 'p1', slug: 's', file_key: 'short1', status: 'ready', parent_version: 1, note: 'who are the cost savings going to?',
    plan: { corrections: [], not_done: [{ note: 'who are the cost savings going to?', reason: 'This is a question, not a change request.' }] },
    plan_md5: 'x', created_at: '2026-11-03T00:00:00Z' }];
  const orig = window.client.rpc;
  window.client.rpc = (n, a) => n === 'hs_youtube_video_plans' ? Promise.resolve({ data: window.planRows, error: null }) : orig(n, a);
});
await load();
const S = '.yv-file[data-key="short1"] ';
ok((await page.locator(S).textContent()).includes('who are the cost savings going to?'), '9 the unusable plan is on screen');
ok(await page.locator(S + '.yv-rebuild').count() === 1, '10 Full rebuild is offered beside a plan waiting for Confirm');

await browser.close();
if (fails) { console.log(fails + ' failed'); process.exit(1); }
console.log('all rebuild page checks passed');
