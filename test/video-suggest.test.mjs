// Tab 16 "Suggest a video" (lib/acq-video-suggest.js): wiring and SQL shape, offline. Founder, 2026-10-28: Tab 16 and
// Tab 17 each need their own suggestion box. The real-browser half is test/video-suggest.browser.test.mjs.
// Run: node test/video-suggest.test.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const fs = require('node:fs');
const crypto = require('node:crypto');
let fails = 0;
const ok = (c, name) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name); if (!c) fails++; };
const read = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const lib = read('lib/acq-video-suggest.js');
const yv = read('lib/acq-youtube-videos.js');
const page0 = read('acquisition.html');
const sql = read('docs/youtube-video-suggestions.sql');

// 1. structure
const key = crypto.createHash('sha256').update(lib).digest('hex').slice(0, 8);
ok(page0.includes('lib/acq-video-suggest.js?v=' + key), '1a acquisition.html loads the module with its content key');
ok(/<div class="tab" id="tab-youtubevideos"><div id="yv-suggest-host"><\/div><div id="yv-list-host"><\/div><\/div>/.test(page0),
  '1b Tab 16 has its own suggestion box beside the video list, so the list refresh never wipes typing');
ok(/acqVideoSuggest\.mount\(window\.hsClient, sg\)/.test(page0) && /getElementById\('yv-list-host'\)[\s\S]{0,120}acqYoutubeVideos\.load/.test(page0),
  '1c the tab mounts the box and loads the list into its own host');
ok(!/yv-suggest|acqImpactDiscovery|impactstories/.test(yv), '1d Tab 16 no longer jumps to Tab 17');
const rpcs = (lib.match(/rpc\('([a-z_]+)'/g) || []).map((s) => s.slice(5, -1)).sort();
ok(JSON.stringify(rpcs) === JSON.stringify(['hs_youtube_video_suggest', 'hs_youtube_video_suggestion_withdraw', 'hs_youtube_video_suggestions_list']),
  '1e the box calls only its three functions: ' + rpcs.join(', '));
ok(!/impact_discovery/.test(sql.replace(/--.*$/gm, '')) && !/rpc\('hs_impact/.test(lib), '1f it never touches Tab 17\'s Hot Topics queue');
ok(/revoke all on public\.youtube_video_suggestions from public, anon, authenticated/.test(sql) && /enable row level security/.test(sql),
  '1g the table is closed to visitors');

if (fails) { console.log(fails + ' failed'); process.exit(1); }
console.log('all passed');
