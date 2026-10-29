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
    rpc: (n, a) => {
      if (n === 'hs_youtube_videos_list') { window.lists++; return Promise.resolve({ data: [JSON.parse(JSON.stringify(window.row))], error: null }); }
      (window.calls = window.calls || []).push([n, a]);
      if (n === 'hs_youtube_video_file_decide') return Promise.resolve({ data: null, error: null });
      if (n === 'hs_youtube_video_revise' && window.reviseErr) return Promise.resolve({ data: null, error: window.reviseErr });
      if (n === 'hs_youtube_video_reject_and_revise') return Promise.resolve(window.reviseErr ? { data: null, error: window.reviseErr } : { data: { revision_id: 'rx' }, error: null });
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

// 2026-10-29: Generate sends the note in the box, even when it was typed before a reload (the founder's edits
// "did not stick"), and a refusal from the server stays on the tile through the next reloads.
await page.evaluate(() => { window.calls = []; window.reviseErr = { code: '55000', message: 'this exact note was already tried on this version and could not be applied; change the wording, then try again' }; });
await page.fill(note2, 'remove the background hum');
await load();
await page.click('.yv-file[data-key="short2"] .yv-revise-now');
await page.waitForFunction(() => /change the wording/.test(document.querySelector('.yv-file[data-key="short2"] .yv-fmsg').textContent));
const sent = await page.evaluate(() => window.calls.filter((c) => c[0] === 'hs_youtube_video_reject_and_revise').map((c) => c[1].p_note));
const twoCalls = await page.evaluate(() => window.calls.filter((c) => c[0] === 'hs_youtube_video_file_decide' || c[0] === 'hs_youtube_video_revise').length);
ok(sent.length === 1 && sent[0] === 'remove the background hum', '14 Generate saves the note typed before the reload, not the old one');
ok(twoCalls === 0, '14b Generate is ONE call (reject-and-revise), so a refusal cannot cost an approval');
ok(await page.locator('.yv-file[data-key="short2"] .yv-revise-now').isDisabled(), '14c after a refusal, Generate stays off for the same note');
await page.fill(note2, 'remove the background hum please');
ok(!(await page.locator('.yv-file[data-key="short2"] .yv-revise-now').isDisabled()), '14d changing the note turns Generate back on');
await load(); await load();
ok(/change the wording/.test(await page.textContent('.yv-file[data-key="short2"] .yv-fmsg')), '15 the refusal stays on the tile after two reloads');
ok(!/change the wording/.test(await page.textContent('.yv-file[data-key="final"] .yv-fmsg')), '16 the refusal shows only on its own file');
await page.evaluate(() => { window.reviseErr = null; });
await page.click('.yv-file[data-key="short2"] .yv-fsavenote');
await load();
ok(!/change the wording/.test(await page.textContent('.yv-file[data-key="short2"] .yv-fmsg')), '17 pressing a button on that file clears the old refusal');

// A revision that failed 3 times because of our system says so, and points at Generate (which still works).
await page.evaluate(() => { window.row.revisions = [{ id: 'r9', file_key: 'short1', parent_version: 1, instruction: 'x', status: 'failed', attempts: 3, error: 'Generation failed.', created_at: '2026-10-29T00:00:00Z' }]; });
await load();
const sys = await page.textContent('.yv-file[data-key="short1"]');
ok(/problem on our side, not your note/.test(sys) && !/Three attempts/.test(sys) && await page.locator('.yv-file[data-key="short1"] .yv-revise-now').count() === 1, '18 a system failure after 3 tries says it was not the note and keeps Generate');


// A note that came back "could not apply" on this version: Generate is off until the wording changes (no wasted runs).
await page.evaluate(() => {
  window.row.file_decisions.short2 = { status: 'rejected', note: 'make it pop more', version: 1 };
  window.row.revisions = [{ id: 'u1', file_key: 'short2', parent_version: 1, instruction: 'make it pop more', status: 'unsupported', attempts: 1,
    error: 'No automatic correction could be made.', plan: { unsupported: [{ text: 'make it pop more', reason: 'I could not match this request.' }] }, created_at: '2026-10-29T00:00:00Z' }];
});
await load();
const g2 = '.yv-file[data-key="short2"] .yv-revise-now';
ok(await page.locator(g2).isDisabled() && /Change the wording to try again/.test(await page.textContent('.yv-file[data-key="short2"]')), '19 a refused note keeps Generate off and says why');
await page.fill(note2, 'make the music louder');
ok(!(await page.locator(g2).isDisabled()), '20 a reworded note turns Generate back on');
await page.fill(note2, '  make it pop more ');
ok(await page.locator(g2).isDisabled(), '21 typing the refused note again turns it off again');

// A revision that worked but skipped part of the note says what it skipped.
await page.evaluate(() => {
  window.row.file_decisions.short2 = undefined;
  window.row.files.short2 = { path: 's/versions/short2/v2-aa.mp4', version: 2 };
  window.row.revisions = [{ id: 'g1', file_key: 'short2', parent_version: 1, instruction: 'fix Apollo; also add a map', status: 'succeeded', attempts: 1,
    result: { summary: 'Pronunciation of Apollo fixed', unsupported: [{ text: 'also add a map', reason: 'Adding new pictures is not something this system does.', suggestion: 'Ask Claude.' }] },
    created_at: '2026-10-29T00:00:00Z' }];
});
await load();
const t22 = await page.textContent('.yv-file[data-key="short2"]');
ok(/Not done from your note/.test(t22) && /also add a map/.test(t22) && /Adding new pictures/.test(t22), '22 a revised file lists the parts of the note that were not done');
await page.evaluate(() => { window.row.file_decisions.short2 = { status: 'approved', version: 2 }; });
await load();
ok(/Not done from your note/.test(await page.textContent('.yv-file[data-key="short2"]')), '23 the list stays after the file is approved');

// A failure shows its cause, and the error does not repeat the button's words.
await page.evaluate(() => {
  window.row.file_decisions.short1 = { status: 'rejected', note: 'x', version: 1 };
  window.row.revisions = [{ id: 'f1', file_key: 'short1', parent_version: 1, instruction: 'x', status: 'failed', attempts: 1,
    error: 'Revision failed because narration generation could not complete. Your original video is safe. Retry Generation.',
    result: { cause: 'RuntimeError: Kokoro returned no audio for sentence 4' }, created_at: '2026-10-29T00:00:00Z' }];
});
await load();
const t24 = await page.textContent('.yv-file[data-key="short1"] .yv-fdec');
ok(/What went wrong: RuntimeError: Kokoro returned no audio for sentence 4/.test(t24), '24 a failure shows the real cause');
ok(!/safe\. Retry Generation/.test(t24) && (await page.locator('.yv-file[data-key="short1"] .yv-rretry').count()) === 1, '25 the error text no longer ends in "Retry Generation"; the button does that');

// Every description shown carries its own video code, so the pasted text matches on YouTube (0 of 18 had matched).
await page.evaluate(() => {
  window.row.title = '3009 Test';
  window.row.meta = { description: 'Main text\nSOURCES', short_descriptions: { short1: 'Short one text\n\nVideo code: JODY-3009-S1\n', short2: 'Short two text' } };
});
await load();
const pres = await page.$$eval('#host pre.yv-pre', (els) => els.map((e) => e.textContent));
const main = pres.find((t) => /^Main text/.test(t)), s1 = pres.find((t) => /^Short one/.test(t)), s2 = pres.find((t) => /^Short two/.test(t));
ok(main && /Video code: JODY-3009-V\n?$/.test(main), '26 the main description ends with its video code');
ok(s1 && (s1.match(/JODY-3009-S1/g) || []).length === 1 && s2 && /Video code: JODY-3009-S2/.test(s2), '27 each Short description has its own code, once');

await browser.close();
if (fails) { console.log(fails + ' FAILED'); process.exit(1); }
console.log('all passed');
