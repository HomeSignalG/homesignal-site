// YouTube channel sync: the dashboard half (Tab 16 shows what the hourly check found) and the SQL of record's shape.
// The SQL BEHAVIOUR is executed by test/youtube_channel_sync_pg/run.sh (32 checks on a disposable Postgres).
// Run: node test/youtube-channel-sync.test.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const fs = require('node:fs');
let fails = 0;
const ok = (c, name) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name); if (!c) fails++; };
const read = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');

global.window = { HS: {} };
require('../lib/acq-bluesky-videos.js');
require('../lib/acq-youtube-videos.js');
const Y = global.window.HS.acqYoutubeVideos;
const B = global.window.HS.acqBlueskyVideos;
const sql = read('docs/youtube-channel-sync.sql').replace(/--.*$/gm, '');

const row = { slug: 'p1', title: 'Port X', status: 'pending', youtube_url: 'https://youtu.be/NEWVIDEO001',
  files: { final: { path: 'p1/final.mp4', bytes: 10 }, short1: { path: 'p1/short1.mp4', bytes: 5 } }, meta: {},
  bsky_posts: { short1: { caption: 'Q?', hashtags: ['Tacoma'], link_youtube: true } } };
const v = (o) => Object.assign({ video_id: 'X', url: 'https://youtu.be/X', title: 'T', match_state: 'matched', historical: false }, o);
const channel = { last_ok: '2026-10-25T20:00:00Z', last_run: { ok: true, public_only: false }, videos: [
  v({ video_id: 'NEWVIDEO001', url: 'https://youtu.be/NEWVIDEO001', title: 'Full investigation', slug: 'p1', file_key: 'final', public_verified_at: '2026-10-25T19:00:00Z', link_state: 'linked' }),
  v({ video_id: 'SCHED000001', title: 'Coming soon', slug: 'p1', file_key: 'short1', publish_at: '2026-10-30T15:00:00Z', privacy_status: 'private' }),
  v({ video_id: 'UNKNOWN0001', title: 'Mystery upload', match_state: 'unmatched', match_note: 'no project description found' }),
  v({ video_id: 'OLDVIDEO001', title: 'Old video', match_state: 'unmatched', historical: true }),
] };

// 0. each file shows its video code, from the series number in front of the Tab 16 title
{
  const h = Y.render([Object.assign({}, row, { title: '3006 Proctor 4 Mixed-Use (Tacoma)' })], {}, true, channel);
  ok(h.includes('<code>JODY-3006-V</code>') && h.includes('<code>JODY-3006-S1</code>'), '0a main video and Short 1 show their codes');
  ok(!h.includes('JODY-3006-S2'), '0b a file not uploaded shows no code');
  ok(!Y.render([row], {}, true, channel).includes('JODY-'), '0c a title with no number shows no code');
}

// 1. states, in the founder's words
ok(Y.ytState(channel.videos[0]).label === 'Published on YouTube', '1a public verified -> Published on YouTube');
ok(/^Scheduled for /.test(Y.ytState(channel.videos[1]).label), '1b scheduled -> Scheduled for <date>');
ok(Y.ytState(channel.videos[2]).label === 'Awaiting investigation match', '1c unmatched -> Awaiting investigation match');
ok(Y.ytState(v({ link_state: 'conflict' })).label === 'Needs attention', '1d link conflict -> Needs attention');
ok(Y.ytState(v({ match_state: 'not_ours' })).label === 'Not a project video', '1e not ours');
ok(Y.ytState(v({ privacy_status: 'private' })).label === 'Uploaded, not public yet', '1f private, not scheduled');

// 2. the project shows its found link and videos; typing a link is tucked away for exceptions
const html = Y.render([row], {}, true, channel);
ok(/On YouTube<\/b> \(found automatically\): <a href="https:\/\/youtu\.be\/NEWVIDEO001"/.test(html), '2a the found link is shown');
ok(/Full investigation[\s\S]{0,200}Published on YouTube/.test(html) && /Coming soon[\s\S]{0,200}Scheduled for/.test(html), '2b each found video with its status');
ok(/<details><summary class="sub">Fix the link by hand[\s\S]*?class="yv-yturl"/.test(html), '2c the hand-typed link is only an exception, inside a closed details');
// 3. the channel card lists only the videos that need a person, with the one manual control
ok(/YouTube channel<\/h3>[\s\S]*Checked automatically twice a day/.test(html), '3a channel card says it is automatic');
ok((html.match(/class="yv-msel"/g) || []).length === 1 && /data-vid="UNKNOWN0001"/.test(html), '3b only the unmatched new video gets a match control');
ok(!/data-vid="OLDVIDEO001"/.test(html), '3c a historical video is not put in front of the founder');
ok(/value="\|none">Not a project video/.test(html) && /value="p1\|short2">/.test(html), '3d choices are project items or "not a project video"');
ok(/The last check failed/.test(Y.render([row], {}, true, Object.assign({}, channel, { last_run: { ok: false, detail: { error: 'quotaExceeded' } } }))), '3e a failed check is shown');
ok(/Public videos only/.test(Y.render([row], {}, true, Object.assign({}, channel, { last_run: { ok: true, public_only: true } }))) && !/Public videos only/.test(html), '3f public-only reading is said, owner reading is not');
// 4. without the sync applied the tab is unchanged
const before = Y.render([row], {}, true, null);
ok(!/YouTube channel<\/h3>/.test(before) && !/<details><summary class="sub">Fix the link/.test(before) && /class="yv-yturl"/.test(before), '4a no channel data: no card, link input as before');
ok(!/YouTube channel<\/h3>/.test(Y.render([row], {}, false, channel)), '4b no queue: no channel card');
// 5. hold reasons
ok(/not public yet/.test(B.holdWords('youtube_not_public')) && /found automatically/.test(B.holdWords('missing_youtube_url')), '5a hold words for the new reasons');
// 6. escaping: a hostile title cannot inject markup
ok(!/<img/.test(Y.render([row], {}, true, { videos: [v({ title: '<img src=x onerror=alert(1)>', match_state: 'unmatched' })] })), '6a titles are escaped');
// 7. SQL of record shape
ok(/video_id\s+text primary key/.test(sql), '7a one row per YouTube video id');
ok(/create unique index if not exists youtube_channel_videos_item_uq[\s\S]{0,120}where match_state = 'matched'/.test(sql), '7b one matched video per project item');
ok(/r\.youtube_url is not null then st := 'conflict'/.test(sql), '7c an existing different link is never replaced');
ok(/c\.historical and coalesce\(c\.match_method, ''\) <> 'manual' then st := 'historical'/.test(sql), '7d historical videos never link by themselves');
ok(/revoke all on public\.youtube_channel_videos from public, anon, authenticated/.test(sql), '7e the table has no browser access');
// The guard pins the md5 of the queue file's CURRENT bodies (computed here, so a change to the queue file fails this test
// until the guard is updated with it).
{
  const crypto = require('node:crypto');
  const q = read('docs/video-bluesky-queue.sql');
  const md5 = (n) => crypto.createHash('md5').update(q.match(new RegExp('create or replace function public\\.' + n + '\\(.*?as \\$fn\\$([\\s\\S]*?)\\$fn\\$;', 's'))[1]).digest('hex');
  const sync = read('docs/youtube-channel-sync.sql');
  ok(sync.includes("'" + md5('video_bsky_text') + "'") && sync.includes("'" + md5('video_bsky_problems') + "'"), '7f it refuses unless the live composer and problems are the queue versions');
}
const wfs = fs.readdirSync(new URL('../.github/workflows/', import.meta.url));
ok(wfs.some((f) => /youtube-channel-sync/.test(f)), '7g the SQL suite runs in CI');

// 8. Save match (2026-10-30): a taken item is greyed out with its video, and a refusal survives the tab's rebuilds
{
  const h = Y.channelCard(channel, [row]);
  ok(/<option value="p1\|final" disabled>Port X · Main video \(already matched: Full investigation\)<\/option>/.test(h), '8a a matched item cannot be chosen and names its video');
  ok(/<option value="p1\|short2">Port X · Short 2<\/option>/.test(h), '8b a free item stays selectable');
  const src = read('lib/acq-youtube-videos.js');
  ok(/matchErrors\[vid\] = text/.test(src) && /querySelectorAll\('\.yv-msave'\)/.test(src), '8c a Save match refusal is kept and put back after each rebuild');
}

if (fails) { console.log(fails + ' FAILED'); process.exit(1); }
console.log('all passed');
