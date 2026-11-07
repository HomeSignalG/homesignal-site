// Real Chromium: Tab 16 Bluesky copy + Tab 12 VIDEOS monitor, wired to a stub Supabase client (no network, no credential).
// Run: node test/video-bluesky-queue.browser.test.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const fs = require('node:fs');
let fails = 0;
const ok = (c, name) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name); if (!c) fails++; };
const lib = (f) => fs.readFileSync(new URL('../lib/' + f, import.meta.url), 'utf8');

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent('<!doctype html><html><body><div id="yv"></div><div id="vq"></div></body></html>');
await page.addScriptTag({ content: lib('acq-bluesky-videos.js') });
await page.addScriptTag({ content: lib('acq-youtube-videos.js') });
await page.evaluate(() => {
  window.calls = [];
  const rows = [{ slug: 'p', title: 'Port <b>X</b>', status: 'pending', created_at: '2026-10-24T12:00:00Z', youtube_url: null, reconcile_required: true,
    files: { final: { path: 'p/f.mp4' }, short1: { path: 'p/s1.mp4' }, short2: { path: 'p/s2.mp4' }, thumbnail: { path: 'p/t.png' } },
    file_decisions: { short1: { status: 'approved', decided_by: 'a@b.c' } },
    bsky_posts: { short1: { caption: 'Will it be loud?', hashtags: ['Tacoma', 'JodyTracks'], alt: 'alt', link_youtube: true } }, meta: {} }];
  const jobs = [
    { slug: 'p', file_key: 'final', title: 'Port X', decision: 'pending', text: null, file_path: 'p/f.mp4' },
    { slug: 'p', file_key: 'short1', title: 'Port X', decision: 'approved', job_id: 'j1', job_status: 'held', hold_reason: 'missing_youtube_url', text: 'Will it be loud?\n\n#Tacoma #JodyTracks', alt: 'alt', file_path: 'p/s1.mp4', link_youtube: true },
    { slug: 'p', file_key: 'short2', title: 'Port X', decision: 'approved', job_id: 'j2', job_status: 'scheduled', scheduled_slot: '2026-10-26T15:00:00Z', local_tz: 'America/Denver', text: 'Air?\nhttps://youtu.be/qEv0XlxlvcY\n\n#Tacoma', alt: 'a', file_path: 'p/s2.mp4', youtube_url: 'https://youtu.be/qEv0XlxlvcY' },
  ];
  window.client = {
    rpc: (n, a) => { window.calls.push([n, a]); return Promise.resolve({ data: n === 'hs_youtube_videos_list' ? rows : n === 'hs_video_jobs_list' ? jobs : {}, error: null }); },
    storage: { from: () => ({ download: () => Promise.resolve({ data: new Blob(['x'], { type: 'video/mp4' }), error: null }) }) },
  };
  window.confirm = () => true;
});

// Tab 16
await page.evaluate(() => window.HS.acqYoutubeVideos.load(window.client, document.getElementById('yv')));
ok(await page.locator('#yv .yv-bsky').count() === 3, 'tab 16: three Bluesky boxes (Main, Short 1, Short 2)');
ok((await page.locator('#yv .yv-bsky .tile-tag').first().innerText()).length > 0, 'tab 16: each box shows where the item is in the queue');
ok((await page.locator('#yv').innerText()).includes('Check Bluesky first'), 'tab 16: the pilot reconciliation gate is shown');
await page.fill('#yv .yv-bsky[data-key="short1"] .yv-bcap', 'Will it be MUCH louder?');
await page.click('#yv .yv-bsky[data-key="short1"] .yv-bsave');
await page.waitForTimeout(50);
const save = await page.evaluate(() => window.calls.find((c) => c[0] === 'hs_video_bluesky_caption_set'));
ok(save && save[1].p_key === 'short1' && save[1].p_caption === 'Will it be MUCH louder?' && save[1].p_hashtags.join() === 'Tacoma,JodyTracks', 'tab 16: Save sends the edited caption + tags for exactly that item');
await page.fill('#yv .yv-yturl', 'https://youtu.be/qEv0XlxlvcY');
await page.click('#yv .yv-ytsave'); await page.waitForTimeout(50);
ok(await page.evaluate(() => window.calls.some((c) => c[0] === 'hs_video_youtube_url_set' && c[1].p_url === 'https://youtu.be/qEv0XlxlvcY')), 'tab 16: the YouTube link is saved through its gated function');
await page.click('#yv .yv-recon'); await page.waitForTimeout(50);
ok(await page.evaluate(() => window.calls.some((c) => c[0] === 'hs_video_reconcile_done')), 'tab 16: the founder confirmation releases the pilot');
await page.click('#yv .yv-file[data-key="short2"] .yv-fapprove'); await page.waitForTimeout(50);
ok(await page.evaluate(() => window.calls.filter((c) => c[0] === 'hs_youtube_video_file_decide' && c[1].p_key === 'short2' && c[1].p_status === 'approved').length) === 1, 'tab 16: approving Short 2 is ONE call for Short 2 only (no second approval anywhere)');

// Tab 12 VIDEOS
await page.evaluate(async () => {
  const items = await window.HS.acqBlueskyVideos.fetch(window.client);
  window.HS.acqBlueskyVideos.mount(window.client, document.getElementById('vq'), items, () => { window.reloaded = true; });
});
const txt = await page.locator('#vq').innerText();
ok(/Awaiting approval in Tab 16/.test(txt) && /Held/.test(txt) && /Scheduled/.test(txt), 'tab 12: awaiting / held / scheduled are shown as distinct states');
ok(!/Published/.test(await page.locator('#vq .tile-tag').allInnerTexts().then((a) => a.join(' '))), 'tab 12: nothing claims Published that is not');
ok(txt.includes('Waiting for the full YouTube link'), 'tab 12: a held item says why in plain words');
ok(await page.locator('#vq button:has-text("Approve")').count() === 0, 'tab 12: there is no Approve button');
await page.click('#vq .vq-card[data-vq-job="j2"] .vq-play'); await page.waitForTimeout(100);
ok(await page.locator('#vq .vq-card[data-vq-job="j2"] video').count() === 1, 'tab 12: the MP4 preview loads from the private bucket as a blob');
await page.click('#vq .vq-card[data-vq-job="j2"] [data-vq="cancel"]'); await page.waitForTimeout(50);
ok(await page.evaluate(() => window.calls.some((c) => c[0] === 'hs_video_job_cancel' && c[1].p_id === 'j2')) && await page.evaluate(() => window.reloaded === true), 'tab 12: cancel calls the gated function and refreshes');
await page.click('#vq .vq-card[data-vq-job="j1"] [data-vq="retry"]'); await page.waitForTimeout(50);
ok(await page.evaluate(() => window.calls.some((c) => c[0] === 'hs_video_job_retry' && c[1].p_id === 'j1')), 'tab 12: retry calls the gated function');

// The thumbnail is a Bluesky post too (docs/video-bluesky-thumbnail.sql). Its box appears only when the database lists it.
ok(await page.locator('#yv .yv-thumbwrap .yv-bsky').count() === 0, 'tab 16: no thumbnail box while the database does not list the thumbnail (older database)');
await page.evaluate(() => {
  const base = window.client.rpc;
  window.client.rpc = (n, a) => {
    if (n === 'hs_video_jobs_list') {
      window.calls.push([n, a]);
      return Promise.resolve({ data: [
        { slug: 'p', file_key: 'final', title: 'Port X', decision: 'pending', text: null, file_path: 'p/f.mp4' },
        { slug: 'p', file_key: 'thumbnail', title: 'Port X', decision: 'approved', job_id: 'jt', job_status: 'held', hold_reason: 'missing_youtube_url',
          text: 'Who decides?\n\n#JodyTracks', alt: 'Thumbnail: Speaker Petition', file_path: 'p/t.png', link_youtube: true },
      ], error: null });
    }
    return base(n, a);
  };
});
await page.evaluate(() => window.HS.acqYoutubeVideos.load(window.client, document.getElementById('yv')));
const tbox = page.locator('#yv .yv-thumbwrap .yv-bsky[data-key="thumbnail"]');
ok(await tbox.count() === 1, 'tab 16: the thumbnail tile carries its own Bluesky box once the database lists it');
ok((await tbox.locator('.yv-balt').getAttribute('placeholder')).startsWith('Describe the image'), 'tab 16: the thumbnail asks for an image description');
ok((await tbox.innerText()).includes('once the main video is public on YouTube'), 'tab 16: the thumbnail post says it waits for the YouTube link');
await tbox.locator('.yv-bcap').fill('Thumbnail caption');
await tbox.locator('.yv-bsave').click(); await page.waitForTimeout(50);
ok(await page.evaluate(() => window.calls.some((c) => c[0] === 'hs_video_bluesky_caption_set' && c[1].p_key === 'thumbnail' && c[1].p_caption === 'Thumbnail caption')), 'tab 16: saving the thumbnail copy names the thumbnail item');
await page.evaluate(() => { window.confirmText = ''; window.confirm = (m) => { window.confirmText = m; return true; }; });
await page.click('#yv .yv-thumbwrap .yv-fapprove'); await page.waitForTimeout(50);
ok(await page.evaluate(() => /queued for Bluesky/.test(window.confirmText)), 'tab 16: approving the thumbnail says it will be queued for Bluesky');
await page.evaluate(async () => {
  document.getElementById('vq').removeAttribute('data-vq-wired'); document.getElementById('vq').innerHTML = '';
  const items = await window.HS.acqBlueskyVideos.fetch(window.client);
  window.HS.acqBlueskyVideos.mount(window.client, document.getElementById('vq'), items, () => {});
});
const tcard = page.locator('#vq .vq-card[data-vq-job="jt"]');
ok((await tcard.innerText()).includes('Thumbnail (image post)') && (await tcard.innerText()).includes('Image description'), 'tab 12: the thumbnail job is labelled an image post');
await tcard.locator('.vq-play').click(); await page.waitForTimeout(100);
ok(await tcard.locator('img').count() === 1 && await tcard.locator('video').count() === 0, 'tab 12: the thumbnail preview is an image, not a video player');
await browser.close();
console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
process.exit(fails ? 1 : 0);
