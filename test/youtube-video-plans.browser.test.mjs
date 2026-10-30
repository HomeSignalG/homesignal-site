// Tab 16, step 6, in real Chromium against a stub client (no network, no credential): Preview changes asks Claude to read
// the note; the plan shows "Here's what I'll change"; Confirm sends exactly the plan's md5; Cancel drops it.
// Run: node test/youtube-video-plans.browser.test.mjs
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
    file_decisions: { short1: { status: 'approved', version: 1 } }, versions: [], revisions: [] };
  window.plans = [];
  window.calls = [];
  window.confirmed = 0;
  window.confirm = () => { window.confirmed++; return true; };
  window.client = {
    rpc: (n, a) => {
      if (n === 'hs_youtube_videos_list') return Promise.resolve({ data: [JSON.parse(JSON.stringify(window.row))], error: null });
      if (n === 'hs_youtube_video_plans') return Promise.resolve({ data: JSON.parse(JSON.stringify(window.plans)), error: null });
      window.calls.push([n, a]);
      if (n === 'hs_youtube_video_plan_start') {
        window.plans = [{ id: 'p1', slug: 's', file_key: a.p_key, status: 'planning', note: a.p_note, created_at: '2026-10-30T10:00:00Z' }];
        return Promise.resolve({ data: { plan_id: 'p1', status: 'planning' }, error: null });
      }
      if (n === 'hs_youtube_video_plan_confirm' || n === 'hs_youtube_video_plan_cancel') {
        window.plans[0].status = n === 'hs_youtube_video_plan_confirm' ? 'confirmed' : 'cancelled';
        return Promise.resolve({ data: {}, error: null });
      }
      return Promise.resolve({ data: null, error: { code: 'x' } });
    },
    storage: { from: () => ({ download: () => new Promise(() => {}) }) }
  };
});
const load = () => page.evaluate(() => window.HS.acqYoutubeVideos.load(window.client, document.getElementById('host')));
const T = '.yv-file[data-key="short1"] ';
await load();

// 1. the approved Short: write a note, press Preview changes
await page.fill(T + '.yv-fnote-in', 'the music is too loud');
await page.click(T + '.yv-revise-now');
await page.waitForFunction(() => document.querySelector('.yv-file[data-key="short1"]').textContent.includes('Claude is reading'));
const start = await page.evaluate(() => window.calls.find((c) => c[0] === 'hs_youtube_video_plan_start'));
ok(start[0] === 'hs_youtube_video_plan_start' && start[1].p_note === 'the music is too loud' && start[1].p_key === 'short1', '1 Preview changes asks Claude to read the note');
ok(await page.evaluate(() => window.calls.every((c) => c[0] !== 'hs_youtube_video_file_decide')), '2 nothing is rejected while the note is read');
ok(await page.evaluate(() => window.confirmed) === 0, '3 no approval warning yet: nothing is replaced by reading a note');

// 2. Claude's plan arrives
await page.evaluate(() => {
  Object.assign(window.plans[0], { status: 'ready', plan_md5: 'md5-of-plan',
    plan: { steps: [{ from_note: 'the music is too loud', instruction: 'lower the music', changes: ['Background music halved (gain 0.045 -> 0.023).'] }],
            not_done: [], corrections: [{ kind: 'music', summary: 'Background music halved', delta: { bed_gain: 0.0225 } }] } });
});
await load();
const txt = await page.locator(T).textContent();
ok(txt.includes('Here’s what I’ll change') && txt.includes('Background music halved'), '4 the plan says what will change');
ok(await page.locator(T + '.yv-pconfirm').isVisible(), '5 Confirm is shown');

// 3. Confirm on an approved file warns first, then sends the plan's md5
await page.click(T + '.yv-pconfirm');
await page.waitForFunction(() => window.calls.some((c) => c[0] === 'hs_youtube_video_plan_confirm'));
const conf = await page.evaluate(() => window.calls.find((c) => c[0] === 'hs_youtube_video_plan_confirm'));
ok(conf[1].p_plan_id === 'p1' && conf[1].p_plan_md5 === 'md5-of-plan', '6 Confirm sends exactly the plan and its md5');
ok(await page.evaluate(() => window.confirmed) === 1, '7 confirming on an approved file asks first');

// 4. Cancel
await page.evaluate(() => { window.plans = [{ id: 'p2', slug: 's', file_key: 'short1', status: 'planning', note: 'x', created_at: '2026-10-30T12:00:00Z' }]; });
await load();
await page.click(T + '.yv-pcancel');
await page.waitForFunction(() => window.calls.some((c) => c[0] === 'hs_youtube_video_plan_cancel'));
await load();
ok(await page.locator(T + '.yv-revise-now').count() === 1 && !(await page.locator(T).textContent()).includes('Claude is reading'), '8 Cancel brings the note box back');

// 5. step 7: the main video's pronunciation fix, also for the Shorts that say the word; Short 1 is approved
const M = '.yv-file[data-key="final"] ';
await page.evaluate(() => {
  window.calls = []; window.confirmed = 0;
  window.confirm = (m) => { window.confirmed++; window.lastConfirm = m; return true; };
  const pron = (lvl) => ({ kind: 'pronunciation', summary: 'Pronunciation of "tacoma", treatment ' + lvl + ' of 3.', delta: { word: 'tacoma', level: lvl } });
  window.plans = [{ id: 'p3', slug: 's', file_key: 'final', status: 'ready', note: 'Tacoma is wrong', plan_md5: 'md5-3', created_at: '2026-10-30T13:00:00Z',
    plan: { steps: [{ from_note: 'Tacoma is wrong', instruction: '"Tacoma" is mispronounced', changes: [pron(1).summary] }], not_done: [], corrections: [pron(1)],
            also: { short1: { parent_version: 1, plan: { asset: 'short1', corrections: [pron(2)] } },
                    short2: { parent_version: 1, plan: { asset: 'short2', corrections: [pron(1)] } } } } }];
});
await load();
ok(await page.locator(M + '.yv-palso:checked').count() === 2, '9 both Shorts that say the word are offered, ticked');
await page.click(M + '.yv-pconfirm');
await page.waitForFunction(() => window.calls.some((c) => c[0] === 'hs_youtube_video_plan_confirm'));
let c3 = await page.evaluate(() => window.calls.find((c) => c[0] === 'hs_youtube_video_plan_confirm'));
ok(JSON.stringify(c3[1].p_also) === '["short1","short2"]' && c3[1].p_plan_md5 === 'md5-3', '10 Confirm sends the ticked files with the plan md5');
ok(await page.evaluate(() => window.confirmed === 1 && /Short 1 is approved/.test(window.lastConfirm)), '11 a ticked file that is approved is named in the warning');
await page.evaluate(() => { window.calls = []; window.confirmed = 0; window.plans[0].status = 'ready'; });
await load();
await page.uncheck(M + '.yv-palso[value="short1"]');
await page.click(M + '.yv-pconfirm');
await page.waitForFunction(() => window.calls.some((c) => c[0] === 'hs_youtube_video_plan_confirm'));
c3 = await page.evaluate(() => window.calls.find((c) => c[0] === 'hs_youtube_video_plan_confirm'));
ok(JSON.stringify(c3[1].p_also) === '["short2"]' && await page.evaluate(() => window.confirmed === 0), '12 an unticked file is left alone, and no warning is needed');

await browser.close();
console.log(fails ? fails + ' FAILURE(S)' : 'ALL PASS');
process.exit(fails ? 1 : 0);
