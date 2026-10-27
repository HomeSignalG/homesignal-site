// Tab 5 (Engagement Tracker) live card, offline. Run: node test/engagement-tracker.test.mjs
// The card displays two admin-only readers and decides nothing; a post never measured is a dash, never 0.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
let fails = 0;
const ok = (c, n) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + n); if (!c) fails++; };
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const LIB = read('lib/acq-engagement.js');
const PAGE = read('acquisition.html');
const SQL = read('docs/bluesky-post-engagement.sql');
const FX = JSON.parse(read('test/fixtures/engagement/readers-2026-10-27.json'));
const code = LIB.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const sb = { window: {} }; vm.runInNewContext(LIB, sb);
const E = sb.window.HS.acqEngagement;

// 1. the module reads only the two gated readers
const rpcs = [...new Set([...code.matchAll(/rpc\('([a-z_]+)'/g)].map((m) => m[1]))].sort();
ok(JSON.stringify(rpcs) === JSON.stringify(['hs_bsky_maps_vs_shorts', 'hs_bsky_post_engagement']), '1a only the two admin readers: ' + rpcs.join(', '));
ok(!/\.from\(['"]/.test(code) && !/\.insert\(|\.update\(|\.delete\(|\.upsert\(/.test(code), '1b no direct table read or write');
ok(!/classify_channel|ref_source|utm_/.test(code), '1c it decides no channel');

// 2. real production shape: nothing measured -> dashes, not zeros
const rows0 = E.rowsFrom(FX.an, FX.eng);
ok(rows0.length === 4 && rows0.every((r) => !r.measured && r.likes === null), '2a an unmeasured post has null likes');
const f0 = E.funnel(FX.an, rows0);
ok(f0.posts === 35 && f0.engagement === null && f0.visitors === 0, '2b totals come from the reader summary (35 posts), engagement unknown, not 0');
const html0 = E._render(FX.an, FX.eng);
ok(/Not available<\/b><span>Impressions/.test(html0), '2c impressions are shown as not available');
ok(/Likes have not been collected yet/.test(html0), '2d it says likes are not collected yet');
ok(/3 more visitors came from Bluesky without a post tag/.test(html0), '2e untagged Bluesky visitors are named, not hidden');
ok(/Not measured:<\/b> Impressions: Bluesky has no/.test(html0) && /YouTube views/.test(html0), '2f both readers\' "not measured" lists are shown');
ok(!/<td class="n">0<\/td><td class="n">0<\/td><td class="n">0<\/td><td class="n">0<\/td>/.test(html0) && /<td class="n">—<\/td>/.test(html0), '2g unmeasured likes render as a dash');

// 3. join by post id, sort by visitors then engagement
const id = FX.an.posts[2].post_id;
const eng = { collected_at: '2026-10-27T20:00:00Z', unavailable: [], posts: { [id]: { kind: 'maps', bsky_uri: 'at://did:plc:abc123/app.bsky.feed.post/3lxyz', likes: 4, reposts: 0, replies: 1, quotes: null } } };
const an = JSON.parse(JSON.stringify(FX.an)); an.posts[3].visitors = 2;
const rows = E.rowsFrom(an, eng);
ok(rows[0].post_id === an.posts[3].post_id && rows[1].post_id === id, '3a most visitors first, then most engagement');
ok(rows[1].measured && rows[1].likes === 4 && rows[1].reposts === 0 && rows[1].engagement === 5, '3b metrics join by post id; a real 0 stays 0; a null quote is not added');
ok(rows[1].url === 'https://bsky.app/profile/did:plc:abc123/post/3lxyz', '3c the post links to Bluesky');
ok(E.webUrl('javascript:alert(1)') === null && E.webUrl('at://evil/"><x') === null, '3d anything but an at:// post uri gives no link');
const f = E.funnel(an, rows);
ok(f.measured === 1 && f.engagement === 5, '3e engagement sums measured posts only');
const html = E._render(an, eng);
ok(/Likes last collected/.test(html) && /href="https:\/\/bsky\.app\/profile\/did:plc:abc123\/post\/3lxyz"/.test(html), '3f the link and the collection time render');
ok(E.esc('<b>"x"</b>') === '&lt;b&gt;&quot;x&quot;&lt;/b&gt;' && !/<script/.test(E._render({ ...an, posts: [{ ...an.posts[0], label: '<script>x</script>' }] }, eng)), '3g labels are escaped');

// 4. the page
const key = createHash('sha256').update(LIB).digest('hex').slice(0, 8);
ok(PAGE.includes('<script src="lib/acq-engagement.js?v=' + key + '"></script>'), '4a acquisition.html loads the module at its content key (' + key + ')');
const iMount = PAGE.indexOf('window.HS.acqEngagement.mount('), iLive = PAGE.indexOf('    wireLive();\n');
ok(iMount > 0 && iMount < iLive, '4b the card mounts before the followers card is added (followers stays on top)');
ok(/Older snapshot/.test(LIB) && /<details class="card en-snap">/.test(LIB), '4c the old snapshot is kept, collapsed and labelled not live');

// 5. the SQL
ok(/enable row level security/.test(SQL) && /revoke all on table public\.bsky_post_metrics from public, anon, authenticated;/.test(SQL), '5a the metrics table is closed to visitors');
ok(/dashboard_admins da where da\.email = caller_email/.test(SQL) && /errcode = '42501'/.test(SQL), '5b the reader is admin-only');
ok(/revoke all on function public\.hs_bsky_post_engagement\(\) from public, anon;/.test(SQL), '5c anon cannot run it');
const body = SQL.split('create or replace function public.hs_bsky_post_engagement()')[1];
ok(!/acquisition_touch|classify_channel|events|users/.test(body), '5d the reader counts no visits or people (that is hs_bsky_maps_vs_shorts)');
ok(/check \(kind in \('maps', 'shorts'\)\)/.test(SQL), '5e kinds are the same two the funnel reader uses');

// 7. posts made by hand on Bluesky (kind 'direct') are listed with their likes and no visitors (their links carry no tag)
const NOW = Date.now();  // relative dates, so the test does not age out
const engD = { posts: {
  'at://did:plc:me/app.bsky.feed.post/v1': { kind: 'direct', bsky_uri: 'at://did:plc:me/app.bsky.feed.post/v1', media: 'video',
    label: 'What does a new fishing dock have to do with orcas?', posted_at: new Date(NOW - 864e5).toISOString(), likes: 1, reposts: 0, replies: 0, quotes: 0 },
  'at://did:plc:me/app.bsky.feed.post/old': { kind: 'direct', bsky_uri: 'at://did:plc:me/app.bsky.feed.post/old', media: 'link',
    label: 'old', posted_at: new Date(NOW - 87 * 864e5).toISOString(), likes: 5 } } };
const anD = { summary: { maps: { posts: 1, visitors: 2 }, shorts: { posts: 0 } }, posts: [{ post_id: 'm1', kind: 'maps', label: '98335', published_at: '2026-10-25T16:00:00Z', visitors: 2 }] };
const rD = E.rowsFrom(anD, engD, 30, NOW);
ok(rD.length === 2 && rD.some((r) => r.direct && r.label.startsWith('What does')), '7a a direct post inside the period is listed; one outside it is not');
const dv = rD.find((r) => r.direct);
ok(dv.visitors === null && dv.registrations === null && dv.reports === null && dv.likes === 1, '7b a direct post shows likes and a dash (null) for visitors, never 0');
ok(E.kindLabel(dv) === 'VIDEO · direct' && E.kindLabel({ direct: false, kind: 'shorts' }) === 'VIDEO', '7c the badge says VIDEO · direct');
const fD = E.funnel(anD, rD);
ok(fD.posts === 2 && fD.direct === 1 && fD.engagement === 1 && fD.visitors === 2, '7d direct posts count as posts and likes, not as visitors');
const htmlD = E._render(anD, engD);
ok(/posted directly/.test(htmlD) && /carry no post tag/.test(htmlD), '7e the card says which posts are direct and why they have no visitors');

// 6. the followers card appears once: load() runs on every auth change, and both async wireLive() calls can finish late
const wl = PAGE.slice(PAGE.indexOf('async function wireLive('), PAGE.indexOf('async function load('));
ok(wl.startsWith('async function wireLive(') && wl.includes('hs_social_followers'), '6a (control) the slice is wireLive');
ok(/id="acq-followers-card"/.test(PAGE) && PAGE.match(/acq-followers-card/g).length >= 2, '6b the followers card carries one id');
const rm = wl.indexOf("getElementById('acq-followers-card')"), ins = wl.indexOf('insertBefore');
ok(rm > 0 && ins > rm && /\.remove\(\)/.test(wl.slice(rm, ins)), '6c an existing card is removed before the new one is inserted');

console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
process.exit(fails ? 1 : 0);
