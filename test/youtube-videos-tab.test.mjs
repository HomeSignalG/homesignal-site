// "YouTube Videos" dashboard tab: wiring, rendering (escaping, no publish capability) and the SQL of record.
// Run: node test/youtube-videos-tab.test.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const fs = require('node:fs');
let fails = 0;
const ok = (c, name) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name); if (!c) fails++; };
const read = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');

global.window = { HS: {} };
require('../lib/acq-youtube-videos.js');
const Y = global.window.HS.acqYoutubeVideos;
const page = read('acquisition.html');
const js = read('lib/acq-youtube-videos.js');
const sql = read('docs/youtube-video-review.sql');

// 1. wiring
ok(/data-tab="youtubevideos">16 · YouTube Videos<\/button>/.test(page), '1a: the tab button is named "YouTube Videos"');
ok(page.includes('id="tab-youtubevideos"'), '1b: the tab container exists');
ok(/youtubevideos: function \(\)[\s\S]{0,300}acqYoutubeVideos\.load\(window\.hsClient/.test(page), '1c: the trusted initialiser loads the tab live');
ok(/<script src="lib\/acq-youtube-videos\.js\?v=[0-9a-f]{8}"><\/script>/.test(page), '1d: the script is content-keyed');

// 2. render
const row = { slug: 'port-x', title: '<img src=x onerror=alert(1)>Blair', status: 'pending', created_at: '2026-10-23T20:00:00Z',
  files: { final: { path: 'port-x/final.mp4', bytes: 72000000 }, short1: { path: 'port-x/short1.mp4' }, short2: { path: 'port-x/short2.mp4' }, thumbnail: { path: 'port-x/thumbnail.png' } },
  meta: { titles: ['T1 <b>'], description: 'D <script>', tags: 'a, b', ledger: 'L & M' } };
const html = Y.render([row]);
ok(!html.includes('<img src=x') && !html.includes('<script>') && html.includes('&lt;img src=x') && html.includes('T1 &lt;b&gt;') && html.includes('D &lt;script&gt;'), '2a: titles, description and ledger are escaped');
ok(html.includes('Waiting for your review') && html.includes('Main video') && html.includes('Short 1') && html.includes('Short 2') && html.includes('Thumbnail'), '2b: a pending project shows all four files and its status');
ok(html.includes('Nothing here is published'), '2c: the page says nothing is published');
ok(Y.render([]).includes('No videos have been uploaded'), '2d: an empty list says so');
ok(Y.render([Object.assign({}, row, { status: 'approved', decided_by: 'a@b.c', decided_at: '2026-10-23T21:00:00Z' })]).includes('Approved by you'), '2e: an approved project says so');

// 3. no publish capability, no key
ok(!/googleapis|youtube\.com\/upload|oauth|api[_-]?key|service_role/i.test(js), '3: the tab has no YouTube API call and no key');
ok(/hs_youtube_videos_list/.test(js) && /hs_youtube_video_decide/.test(js), '3b: it talks to exactly the two gated functions');

// 4. SQL of record
ok(/'jody-videos', 'jody-videos', false/.test(sql), '4a: the bucket is private');
ok(/for select to authenticated[\s\S]{0,200}dashboard_admins/.test(sql) && !/for (insert|update|delete|all)/i.test(sql.replace(/--.*$/gm, '')), '4b: only a dashboard-admin SELECT policy exists on the bucket');
ok(/enable row level security/.test(sql) && /revoke all on public\.youtube_video_reviews from public, anon, authenticated/.test(sql), '4c: the table is RLS-on with no direct grants');
ok((sql.match(/dashboard_admins da where da\.email = caller_email/g) || []).length === 2, '4d: both functions check dashboard_admins');
ok(/revoke all on function public\.hs_youtube_videos_list\(\) from public, anon/.test(sql) && /grant execute on function public\.hs_youtube_video_decide\(text, text, text\) to authenticated/.test(sql), '4e: anon cannot run either function');
ok(/status in \('pending', 'approved', 'rejected'\)/.test(sql), '4f: status vocabulary is closed');
console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
process.exit(fails ? 1 : 0);
