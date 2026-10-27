// Video -> Bluesky queue: the dashboard half (VIDEOS monitor, Tab 16 Bluesky copy) and the SQL of record's shape.
// The SQL BEHAVIOUR is executed by test/video_bluesky_queue_pg/run.sh (64 checks on a disposable Postgres).
// Run: node test/video-bluesky-queue.test.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const fs = require('node:fs');
let fails = 0;
const ok = (c, name) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name); if (!c) fails++; };
const read = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const strip = (s) => s.replace(/--.*$/gm, '');

global.window = { HS: {} };
require('../lib/acq-bluesky-videos.js');
require('../lib/acq-youtube-videos.js');
const B = global.window.HS.acqBlueskyVideos;
const Y = global.window.HS.acqYoutubeVideos;
const page = read('acquisition.html');
const bjs = read('lib/acq-bluesky-videos.js');
const yjs = read('lib/acq-youtube-videos.js');
const sql = read('docs/video-bluesky-queue.sql');
const code = strip(sql);
const review = read('docs/youtube-video-review.sql');
const apply = read('docs/youtube-video-file-decide-queue-apply.sql');

// 1. wiring: no new top-level tab, VIDEOS beside ALL | MAPS | ALERTS
// (Tab 17 "Impact Stories" was added later by founder handoff v2.4; VIDEOS still adds no tab of its own.)
const navTabs = page.match(/<nav class="tabs">[\s\S]*?<\/nav>/)[0];
ok((navTabs.match(/data-tab=/g) || []).length === 17 && !/>[^<]*\bVIDEOS\b[^<]*<\/button>/.test(navTabs) && /data-tab="impactstories"/.test(navTabs), '1a: VIDEOS adds no top-level tab (17 tabs, the 17th is Impact Stories)');
ok(/bskyNavBtn\('family','VIDEOS','VIDEOS'/.test(page) && /bskyNavBtn\('family','ALERTS','ALERTS'/.test(page) && /bskyNavBtn\('family','MAPS','MAPS'/.test(page), '1b: ALL | MAPS | ALERTS | VIDEOS');
ok(/<script src="lib\/acq-bluesky-videos\.js\?v=[0-9a-f]{8}"><\/script>/.test(page), '1c: the monitor script is content-keyed');
ok(/_bskyFamily==='VIDEOS'[\s\S]{0,400}acqBlueskyVideos\.mount/.test(page), '1d: the VIDEOS view mounts the video monitor');
ok(!/hs_approve_social_post[\s\S]{0,40}video/i.test(page), '1e: the MAPS/ALERTS approve path is not touched');

// 2. the monitor: honest states, no second approval, escaping
const base = { slug: 's', title: '<b>T</b>', file_key: 'short1', file_path: 's/short1.mp4', text: 'Q?\nhttps://youtu.be/qEv0XlxlvcY\n\n#Tacoma #JodyTracks', alt: 'a', local_tz: 'America/Denver', decision: 'approved', youtube_url: 'https://youtu.be/qEv0XlxlvcY' };
const st = (o) => B.stateOf(Object.assign({}, base, o)).label;
ok(st({ job_status: 'scheduled', scheduled_slot: '2026-10-26T15:00:00Z' }) === 'Scheduled', '2a: scheduled only when a job is scheduled WITH a slot');
ok(st({ job_status: 'scheduled', scheduled_slot: null }) !== 'Scheduled', '2b: a scheduled job without a slot is not shown as Scheduled');
ok(st({ job_id: null, job_status: null }) === 'Approved / queued' && st({ decision: 'pending' }) === 'Awaiting approval in Tab 16', '2c: awaiting approval and approved/queued are distinct');
ok(st({ job_status: 'published', bsky_uri: 'at://did:plc:x/app.bsky.feed.post/3kabc' }) === 'Published' && st({ job_status: 'uploading' }) === 'Uploading' && st({ job_status: 'processing' }) === 'Processing' && st({ job_status: 'publishing' }) === 'Publishing', '2d: uploading, processing, publishing, published');
ok(st({ job_status: 'failed' }) === 'Failed' && st({ job_status: 'held' }) === 'Held' && st({ decision: 'rejected' }) === 'Rejected in Tab 16', '2e: failed, held, rejected');
const html = B.render([Object.assign({}, base, { job_id: 'j1', job_status: 'published', bsky_uri: 'at://did:plc:x/app.bsky.feed.post/3kabc', published_at: '2026-10-26T15:01:00Z' })]);
ok(html.includes('https://bsky.app/profile/did:plc:x/post/3kabc') && !html.includes('<b>T</b>') && html.includes('&lt;b&gt;T&lt;/b&gt;'), '2f: the real Bluesky link is shown and values are escaped');
ok(B.postUrl('javascript:alert(1)') === '' && B.postUrl('at://did:plc:x/app.bsky.feed.post/a b') === '', '2g: only a real Bluesky address becomes a link');
ok(!/data-act="approve"|hs_approve|hs_youtube_video_file_decide/.test(bjs) && !/Approve</.test(html), '2h: the VIDEOS monitor has no approve button and calls no approval function');
ok(/hs_video_job_cancel/.test(bjs) && /hs_video_job_retry/.test(bjs) && /hs_video_jobs_list/.test(bjs), '2i: it reads the list and offers cancel and retry only');
ok(!/BSKY_APP_PASSWORD|service_role|app password|createSession|atproto/i.test(bjs + yjs), '2j: no Bluesky credential or Bluesky API in browser code');
ok(!/impression|views_count|click_count/i.test(bjs.replace(/\/\*[\s\S]*?\*\//g, '')), '2k: no invented performance metrics');
const c = B.counts([{ decision: 'pending' }, { decision: 'approved', job_status: 'scheduled', scheduled_slot: 'x' }, { job_status: 'published' }, { job_status: 'failed' }, { job_status: 'held' }]);
ok(c.awaiting === 1 && c.scheduled === 1 && c.published === 1 && c.problem === 2, '2l: the four metrics partition the items');
ok(B.render([base]).includes('Cancel before it posts') === false && B.render([Object.assign({}, base, { job_id: 'j', job_status: 'scheduled', scheduled_slot: '2026-10-26T15:00:00Z' })]).includes('Cancel before it posts'), '2m: cancel is offered only for an unpublished job');
ok(B.render([Object.assign({}, base, { job_id: 'j', job_status: 'published', bsky_uri: 'at://did:plc:x/app.bsky.feed.post/a' })]).includes('Cancel before it posts') === false, '2n: a published video cannot be cancelled');

// 3. Tab 16: Bluesky copy beside each approval; hidden until the queue exists
const row = { slug: 'x', title: 'T', status: 'pending', files: { final: { path: 'x/f.mp4' }, short1: { path: 'x/s1.mp4' }, short2: { path: 'x/s2.mp4' }, thumbnail: { path: 'x/t.png' } },
  bsky_posts: { short1: { caption: 'Will it be loud? <i>', hashtags: ['Tacoma', 'JodyTracks'], alt: 'alt', link_youtube: true } }, meta: {} };
const withQ = Y.render([row], {}, true);
ok((withQ.match(/class="yv-bsky"/g) || []).length === 3, '3a: Main Video, Short 1 and Short 2 each get their own Bluesky post box (not the thumbnail)');
ok(withQ.includes('Will it be loud? &lt;i&gt;') && !withQ.includes('<i>'), '3b: captions are escaped');
ok(!/class="yv-bsky"/.test(Y.render([row], {}, false)), '3c: nothing changes until the queue exists');
ok(withQ.includes('yv-yturl') && withQ.includes('Save link'), '3d: the verified YouTube link is entered by the founder');
ok(Y.render([Object.assign({}, row, { reconcile_required: true })], {}, true).includes('Check Bluesky first'), '3e: the pilot shows the reconciliation gate');
ok(/hs_video_bluesky_caption_set/.test(yjs) && /hs_video_youtube_url_set/.test(yjs) && /hs_video_reconcile_done/.test(yjs), '3f: three gated functions');
ok(!/p_status: 'approved'[^;]{0,200}hs_video/.test(yjs), '3g: the Bluesky copy functions never approve anything');

// 4. SQL of record: shape (behaviour is in test/video_bluesky_queue_pg)
ok(/unique \(slug, file_key, platform\)/.test(code), '4a: one job per item and destination, enforced by the table');
ok(/enable row level security/.test(code) && /revoke all on public\.video_bluesky_jobs from public, anon, authenticated/.test(code), '4b: RLS on, no direct grants');
ok(/video_job_claim[\s\S]*?to service_role/.test(sql.slice(sql.indexOf('-- 8. grants'))) && !/grant execute on function public\.video_job_[^;]*authenticated/.test(code), '4c: worker functions are service_role only');
ok((code.match(/hs_video_assert_admin\(\)/g) || []).length >= 8, '4d: every dashboard function checks dashboard_admins');
ok(!/social_posts[^;]{0,80}(insert|update|delete)\b/i.test(code.replace(/select[\s\S]*?from public\.social_posts/gi, '')), '4e: the queue never writes social_posts (MAPS/ALERTS untouched)');
ok(!/create or replace function public\.hs_approve_social_post|social_posts_publication_guard/.test(code), '4f: hs_approve_social_post and the publication guard are not redefined');
ok(/jody-videos/.test(code) && !/update storage|public = true|storage\.buckets/.test(code), '4g: the private bucket is only read');
ok(!/create policy[^;]*storage\.objects/i.test(code), '4h: no storage policy is added');
// the apply file is the LIVE hs_youtube_video_file_decide (incl. #2222's revision guard) plus the queue hook, and refuses
// to run if the live body moved since it was read, so it can never revert another session's change
const fnA = (apply.match(/AS \$function\$[\s\S]*?\$function\$;/) || [''])[0];
ok(/_hs_yv_admin\(\)/.test(fnA) && /errcode = '55006'/.test(fnA) && /'version', coalesce/.test(fnA), '4i: the apply file keeps the live revision guard, admin helper and version stamp');
ok(/video_bsky_sync/.test(fnA) && /to_regprocedure\('public\.video_bsky_sync\(text,text\)'\)/.test(fnA), '4j: an approval calls the queue in its own transaction');
ok(/is distinct from '2dc922d7324d78e57ceeb4ad21a8bb3e'/.test(apply) && /post-check failed/.test(apply), '4i2: it refuses unless the live body is the one it was built from, and checks its own result');
ok(/not in \('pending', 'approved', 'rejected'\)|p_status not in \('approved', 'rejected', 'pending'\)/.test(review), '4k: the decision vocabulary is unchanged');
ok(/grant execute on function public\.hs_video_jobs_list\(\)/.test(code) || /hs_video_jobs_list\(\)[\s\S]{0,200}to authenticated/.test(code), '4l: the list is callable by a signed-in admin only');
console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
process.exit(fails ? 1 : 0);
