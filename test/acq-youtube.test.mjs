// Tab 5 YouTube card, offline. Run: node test/acq-youtube.test.mjs
// The card displays one admin-only reader and decides nothing; a count never read is a dash, never 0.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
let fails = 0;
const ok = (c, n) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + n); if (!c) fails++; };
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const LIB = read('lib/acq-youtube.js');
const PAGE = read('acquisition.html');
const SQL = read('docs/youtube-engagement.sql');
const code = LIB.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const sb = { window: {} }; vm.runInNewContext(LIB, sb);
const Y = sb.window.HS.acqYouTube;

// 1. it reads only the one gated reader and decides nothing
const rpcs = [...new Set([...code.matchAll(/rpc\('([a-z_]+)'/g)].map((m) => m[1]))];
ok(JSON.stringify(rpcs) === JSON.stringify(['hs_youtube_engagement']), '1a only the admin reader: ' + rpcs.join(', '));
ok(!/\.from\(['"]/.test(code) && !/\.insert\(|\.update\(|\.delete\(|\.upsert\(/.test(code), '1b no direct table read or write');
const logic = code.replace(/'(?:[^'\\\n]|\\.)*'/g, "''");
ok(!/classify_channel|duration_s|<=\s*180|utm_source|searchParams|URLSearchParams|new URL\(/.test(logic), '1c it decides no channel and no Short (the reader\'s kind)');
ok(/v\.kind/.test(logic), '1c2 (control) the stripped code still reads the reader\'s kind');

// 2. the reader's shape (as test/youtube_engagement_pg seeds it), counts never read -> dashes
const R = {
  channel: { subscribers: 37, subscribers_hidden: false, views: 285, videos: 14, counted_at: '2026-10-27T21:30:00Z',
    counting_since: '2026-10-27T21:30:00Z', subscribers_in_period: null, views_in_period: null },
  summary: { videos: 3, mains: 2, shorts: 1, published_in_period: 1, visitors: 3, registrations: 1, reports: 1, visitors_with_video_tag: 2 },
  videos: [
    { video_id: 'MAIN_OLD', url: 'https://www.youtube.com/watch?v=MAIN_OLD', title: 'Old main', published_at: '2026-08-28T00:00:00Z', kind: 'main', views: 160, views_in_period: 60, likes: 9, comments: 3, visitors: 0 },
    { video_id: 'SHORT_NEW', url: 'https://www.youtube.com/watch?v=SHORT_NEW', title: 'New <short>', published_at: '2026-10-25T00:00:00Z', kind: 'short', views: 55, views_in_period: 55, likes: null, comments: 0, visitors: 2 },
    { video_id: 'NOCOUNT01', url: 'javascript:alert(1)', title: 'Never counted', published_at: '2026-10-27T00:00:00Z', kind: 'main', views: null, views_in_period: null, likes: null, comments: null, visitors: 0 }],
  unavailable: ['Watch time, impressions, click-through rate, traffic sources and audience: these need YouTube Analytics.'] };
const html = Y._render(R, 30);
ok(/<b>37<\/b><span>Subscribers/.test(html) && /change: not known for this period yet/.test(html), '2a subscribers shown; an unknown change is said in words, not +0');
ok(/2 main · 1 Shorts · 1 new/.test(html), '2b main / Short split comes from the reader');
ok(/<b>3<\/b><span>First visits from YouTube/.test(html) && /2 credited to a video/.test(html), '2c YouTube visitors and how many are credited to a video');
ok(/<td class="n">—<\/td>/.test(html) && !/>NaN</.test(html), '2d a count never read is a dash');
ok(/Not measured:<\/b> Watch time/.test(html), '2e what is not measured is said');
ok(/New &lt;short&gt;/.test(html) && !/<short>/.test(html), '2f titles are escaped');
ok(!/href="javascript/.test(html) && /href="https:\/\/www\.youtube\.com\/watch\?v=MAIN_OLD"/.test(html), '2g only a YouTube link is clickable');
const order = Y.videosFrom(R).map((v) => v.video_id);
ok(JSON.stringify(order) === JSON.stringify(['MAIN_OLD', 'SHORT_NEW', 'NOCOUNT01']), '2h sorted by views in the period, unknown last: ' + order.join(','));
ok(/SHORT<\/span>/.test(html) && /MAIN<\/span>/.test(html), '2i each video says MAIN or SHORT');
ok(/Hidden/.test(Y._render({ ...R, channel: { ...R.channel, subscribers_hidden: true, subscribers: null } }, 30)), '2j hidden subscribers say Hidden, not 0');
ok(/Counts have not been read yet/.test(Y._render({ ...R, channel: null }, 30)), '2k before the first read the card says so');
ok(/Not available/.test(Y._render(null, 30)), '2l a refused reader says not available');

// 3. the page
const key = createHash('sha256').update(LIB).digest('hex').slice(0, 8);
ok(PAGE.includes('<script src="lib/acq-youtube.js?v=' + key + '"></script>'), '3a acquisition.html loads the module at its content key (' + key + ')');
const iEn = PAGE.indexOf('window.HS.acqEngagement.mount('), iYt = PAGE.indexOf('window.HS.acqYouTube.mount('), iLive = PAGE.indexOf('    wireLive();\n');
ok(iEn > 0 && iEn < iYt && iYt < iLive, '3b the YouTube card mounts after the Bluesky card (it is placed under it)');
ok(/youtube:'YouTube'/.test(PAGE), '3c the channel report names the youtube channel');

// 4. the SQL
ok(/enable row level security/.test(SQL) && /revoke all on table public\.youtube_video_metrics, public\.youtube_channel_metrics from public, anon, authenticated;/.test(SQL), '4a count tables closed to visitors');
ok(/dashboard_admins da where da\.email = caller_email/.test(SQL) && /errcode = '42501'/.test(SQL), '4b the reader is admin-only');
ok(/revoke all on function public\.hs_youtube_engagement\(int, boolean\) from public, anon;/.test(SQL), '4c anon cannot run it');
const ACQ = read('docs/acquisition-attribution.sql');
ok(/if s = 'youtube' then return 'youtube'/.test(ACQ) && /youtube\\.com\|youtu\\.be/.test(ACQ), '4d the cumulative classifier record carries the youtube lines');

console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
process.exit(fails ? 1 : 0);
