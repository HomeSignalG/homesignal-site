// Bluesky Publishing Schedule (Tab 12) + MAPS vs Shorts, offline. Run: node test/bluesky-schedule.test.mjs
// The schedule itself is decided in homesignal-ingest (migration 20261027170000, tested on a disposable Postgres there);
// this pins the site half: the page only reads/previews/saves through the gated functions, the channel decision stays in
// classify_channel, and the reader is admin-only and says what it does not measure.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
let fails = 0;
const ok = (c, name) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name); if (!c) fails++; };
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const LIB = read('lib/acq-bluesky-schedule.js');
const SQL = read('docs/bluesky-maps-vs-shorts.sql');
const ATTR = read('docs/acquisition-attribution.sql');
const PAGE = read('acquisition.html');
const Q = read('docs/video-bluesky-queue.sql');
const code = LIB.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

// 1. the module
const rpcs = [...code.matchAll(/rpc\('([a-z_]+)'/g)].map((m) => m[1]).sort();
ok(JSON.stringify([...new Set(rpcs)]) === JSON.stringify(['hs_bsky_maps_vs_shorts', 'hs_bsky_schedule_overview', 'hs_bsky_schedule_preview', 'hs_bsky_schedule_save']),
  '1a the page calls only the four gated functions: ' + [...new Set(rpcs)].join(', '));
ok(!/\.from\(['"]/.test(code) && !/\.insert\(|\.update\(|\.delete\(|\.upsert\(/.test(code), '1b it never reads or writes a table directly');
ok(/p_expected_moves: pv\.reschedule \? pv\.moved : null/.test(code), '1c a save that moves posts sends the count the founder previewed');
ok(/window\.confirm\(q\)/.test(code) && code.indexOf("window.confirm(q)") < code.indexOf("rpc('hs_bsky_schedule_save'"), '1d it asks for confirmation before saving');
ok(!/America\/Denver/.test(code), '1e no Denver time anywhere');
const sb = { window: {} };
vm.runInNewContext(LIB, sb);
const S = sb.window.HS.acqBlueskySchedule;
const slots = {}; for (let d = 0; d < 7; d++) slots[String(d)] = d % 6 === 0 ? { maps: ['10:00', '14:30'], video: ['17:30', '20:30'] } : { maps: ['08:30', '13:30'], video: ['18:00', '21:00'] };
ok(S.formRepresents(slots) === true, '1f the seeded week is a weekday / weekend pattern');
const odd = JSON.parse(JSON.stringify(slots)); odd['3'].video = ['19:00', '21:30'];
ok(S.formRepresents(odd) === false, '1g a week with one different weekday is reported, not silently flattened');
ok(S.esc('<b>"x"</b>') === '&lt;b&gt;&quot;x&quot;&lt;/b&gt;', '1h values are escaped');
ok(/sdsutca|@proton/.test(LIB) === false, '1i no email address in the page code');

// 2. the page wiring
ok(/<script src="lib\/acq-bluesky-schedule\.js\?v=[0-9a-f]{8}"><\/script>/.test(PAGE), '2a acquisition.html loads the module with a content key');
ok(/id="bsky-schedule"/.test(PAGE) && /HS\.acqBlueskySchedule\.mount\(window\.hsClient, schedHost, null\)/.test(PAGE), '2b tab 12 mounts it in its own host');
ok(/bluesky_shorts:'Bluesky: video posts \(shorts\)'/.test(PAGE), '2c the channel report names the new channel');

// 3. the SQL
ok(/if c = 'shorts' then return 'bluesky_shorts'; end if;/.test(ATTR), '3a the cumulative classify_channel record carries the shorts line');
ok(/pg_get_functiondef\('public\.classify_channel\(text,text,text,text,text\)'::regprocedure\)/.test(SQL) && /anchor matched % times/.test(SQL), '3b the change is spliced from the live body, fail-closed');
ok(/dashboard_admins da where da\.email = caller_email/.test(SQL) && /raise exception 'not authorized' using errcode = '42501'/.test(SQL), '3c the reader is admin-only');
ok(/revoke all on function public\.hs_bsky_maps_vs_shorts\(int, boolean\) from public, anon;/.test(SQL) && /grant execute on function public\.hs_bsky_maps_vs_shorts\(int, boolean\) to authenticated;/.test(SQL), '3d anon cannot run it');
ok(/'unavailable', jsonb_build_array\(\s*'YouTube views/.test(SQL), '3e it says in its own output what is not measured (YouTube)');
ok(/array\['bluesky_maps_auto', 'bluesky_pierce_auto'\]\), \('shorts', array\['bluesky_shorts'\]\)/.test(SQL), '3f MAPS and Shorts are told apart by the channel classify_channel decided, never by a second rule');
ok(!/classify_channel\(/.test(SQL.split('-- 2. the reader')[1]), '3g the reader does not classify anything itself');
ok(!/\b(email|referrer|landing_path)\b/.test(SQL.split('-- 2. the reader')[1].replace(/caller_email|da\.email|auth\.jwt\(\) ->> 'email'/g, '')), '3h it returns no email, referrer or landing path');

// 4. the video queue asks the one picker
ok(/create or replace function public\.video_next_slot\(p_tz text default 'America\/Los_Angeles'\)\s+returns timestamptz\s+language plpgsql volatile/.test(Q)
   && /return public\.bsky_next_slot\('video'\);/.test(Q), '4a video_next_slot is the shared schedule\'s picker (volatile, no ladder)');
ok(!/array\['09:00', '17:30', '12:30'\]/.test(Q.replace(/--.*$/gm, '')), '4b the Denver ladder is gone from the queue SQL');

console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
process.exit(fails ? 1 : 0);
