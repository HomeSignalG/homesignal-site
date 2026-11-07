// Tab 16, out-of-date files (2026-11-07), in real Chromium against a stub client: a version built from an older
// script than the one on main says so, cannot be approved from the page, and points at Full rebuild. The case is
// video 3014's main video version 4, built before the founder's checklist note reached the script.
// The decision itself is the database's (docs/youtube-video-outdated.sql); this checks only that the page shows it.
// Run: node test/youtube-video-outdated.browser.test.mjs
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
  const files = { final: { path: 's/final.mp4', version: 4 }, short1: { path: 's/short1.mp4', version: 5 },
    short2: { path: 's/short2.mp4' }, thumbnail: { path: 's/thumbnail.png' } };
  window.row = { slug: 's', title: '3014 Speaker Petition', status: 'pending', created_at: '2026-11-07T01:00:00Z', files, meta: {},
    file_decisions: {}, versions: [], revisions: [],
    outdated: { final: { state: 'script', outdated: true, version: 4, script_changed_at: '2026-11-07T15:21:29Z' },
                short1: { state: 'script', outdated: false, version: 5, script_changed_at: '2026-11-07T15:21:29Z' } } };
  window.calls = [];
  window.confirm = () => true;
  window.client = {
    rpc: (n, a) => {
      if (n === 'hs_youtube_videos_list') return Promise.resolve({ data: [JSON.parse(JSON.stringify(window.row))], error: null });
      if (n === 'hs_youtube_video_plans') return Promise.resolve({ data: [], error: null });
      window.calls.push([n, a]);
      return Promise.resolve({ data: null, error: { code: 'x' } });
    },
    storage: { from: () => ({ download: () => new Promise(() => {}) }) }
  };
});
await page.evaluate(() => window.HS.acqYoutubeVideos.load(window.client, document.getElementById('host')));
const F = '.yv-file[data-key="final"] ', S1 = '.yv-file[data-key="short1"] ', S2 = '.yv-file[data-key="short2"] ';

const ftxt = await page.locator(F).textContent();
ok(ftxt.includes('Out of date') && ftxt.includes('press Full rebuild'), '1 an out-of-date file says so and points at Full rebuild');
ok(await page.locator(F + '.yv-fapprove').isDisabled(), '2 its Approve button is disabled');
ok(await page.locator(F + '.yv-rebuild.yv-primary').count() === 1, '3 Full rebuild is the main button on it');
await page.locator(F + '.yv-fapprove').click({ force: true }).catch(() => {});
ok(!(await page.evaluate(() => window.calls.some((c) => c[0] === 'hs_youtube_video_file_decide'))), '4 clicking the disabled Approve sends nothing');
ok(!(await page.locator(S1).textContent()).includes('Out of date') && !(await page.locator(S1 + '.yv-fapprove').isDisabled()),
  '5 a file built from the current script is not called out of date');
ok(!(await page.locator(S2).textContent()).includes('Out of date') && !(await page.locator(S2 + '.yv-fapprove').isDisabled()),
  '6 a file the database says nothing about is not called out of date');

await browser.close();
if (fails) { console.log(fails + ' failed'); process.exit(1); }
console.log('all out-of-date page checks passed');
