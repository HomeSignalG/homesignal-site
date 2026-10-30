// Tab 19 · Data Center Claim Check: offline contract between the page, the SQL of record and the dashboard shell, plus
// rendering of a researched claim from a fixture. Run: node test/claim-check.test.mjs
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
let fails = 0;
const ok = (c, name) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name); if (!c) fails++; };
const read = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const js = read('lib/acq-claim-check.js');
const html = read('acquisition.html');
const sql = read('docs/claim-check.sql');
const code = js.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// 1. the shell
const nav = html.match(/<nav class="tabs">([\s\S]*?)<\/nav>/)[1];
const labels = [...nav.matchAll(/data-tab="([^"]+)">([^<]+)</g)].map((m) => [m[1], m[2]]);
ok(labels.length === 19 && labels[18][0] === 'claimcheck' && labels[18][1] === '19 · Claim Check', '1a tab 19 is "19 · Claim Check"');
ok(html.includes('<div class="tab" id="tab-claimcheck"></div>'), '1b the tab container exists');
ok(/claimcheck: function \(\) \{[\s\S]*?HS\.acqClaimCheck\.load\(window\.hsClient, el\)/.test(html), '1c a trusted initializer loads the module');
ok(/if\(id==='claimcheck'\) return;/.test(html), '1d a snapshot refresh never overwrites the tab');
const key = createHash('sha256').update(readFileSync(new URL('../lib/acq-claim-check.js', import.meta.url))).digest('hex').slice(0, 8);
ok(html.includes('<script src="lib/acq-claim-check.js?v=' + key + '"></script>'), '1e the script is loaded with its content key');
const csp = (html.match(/Content-Security-Policy" content="([^"]+)"/) || [])[1] || '';
ok(/img-src [^;]*https:\/\/i\.ytimg\.com/.test(csp) && /frame-src https:\/\/www\.youtube-nocookie\.com/.test(csp), '1f the CSP allows YouTube thumbnails and the nocookie player');
ok(!/img-src[^;]*\*/.test(csp) && !/frame-src[^;]*youtube\.com(?!-)/.test(csp.replace('youtube-nocookie.com', '')), '1g no wildcard image host and no tracking YouTube player');

// 2. the page writes only through the claim-check functions
const rpcs = [...new Set([...code.matchAll(/rpc\('([a-z_]+)'/g)].map((m) => m[1]))].sort();
ok(JSON.stringify(rpcs) === JSON.stringify(['hs_claim_check_claim', 'hs_claim_check_decide', 'hs_claim_check_overview',
  'hs_claim_check_person_save', 'hs_claim_check_person_status', 'hs_claim_check_scan_now']), '2a the page calls exactly the six functions (' + rpcs.join(', ') + ')');
ok(!/client\.from\(/.test(code), '2b the page touches no table directly');
for (const f of ['hs_claim_check_overview()', 'hs_claim_check_decide(uuid,text,text,jsonb,integer)']) {
  ok(sql.includes("'" + f + "'"), '2c ' + f + ' is in the authenticated grant list');
}
ok(!/bsky\.social\/xrpc|createRecord|agent\.post/.test(code), '2d the page cannot post to Bluesky (the publisher does)');

// 3. the SQL guarantees, by text (the pg suite proves behaviour)
ok(/a false or misleading verdict needs at least one contradicting evidence item/.test(sql), '3a False/Misleading needs contradicting evidence');
ok(/a scan cannot set a verdict, quote or evidence/.test(sql), '3b a scan cannot set a verdict');
ok(/bsky_next_slot_any\(now\(\)\)/.test(sql) && /MAPS and video times is not applied/.test(sql), '3c a post takes the next shared MAPS/video time, refused until the schedule change is applied');
ok(/where c\.public_state <> 'none' and c\.approved_at is not null/.test(sql), '3d the public export is approved claims only');
ok(!/geograph|region_weight|state_weight|place_weight/i.test(sql.replace(/-- .*$/gm, '')), '3e no geographic weighting in the SQL');

// 4. rendering a researched claim
const sandbox = { window: {}, document: {}, Intl, Array, Promise, console };
sandbox.window.HS = {};
vm.runInNewContext(js, sandbox);
const T = sandbox.window.HS.acqClaimCheck._test;
ok(T.thumbUrl('https://i.ytimg.com/vi/x/hqdefault.jpg') && !T.thumbUrl('https://evil.example/x.jpg') && !T.thumbUrl('javascript:alert(1)'), '4a only platform thumbnail hosts render');
ok(T.embedUrl('https://www.youtube-nocookie.com/embed/abcDEF12345') && !T.embedUrl('https://www.youtube.com/embed/abcDEF12345') && !T.embedUrl('https://www.youtube-nocookie.com/embed/x?autoplay=1'), '4b only the nocookie player embeds');
const claim = {
  id: '00000000-0000-0000-0000-000000000001', status: 'research_ready', research_version: 1, speaker_name: 'Kevin <b>O\'Leary</b>',
  quote: 'It uses no water.', quote_verified: true, quote_source_url: 'https://example.com/t', timestamp_s: 95, assertion: 'No water is used.',
  verdict: 'false', verdict_explanation: 'The permit requests water.', public_state: 'none', headline: 'H', post_text: '"It uses no water." The permit says otherwise.',
  evidence: { supporting: [], contradicting: [{ url: 'https://waterrights.utah.gov/x', title: 'Permit', finding: 'Requests water <script>' }] },
  sources: [{ platform: 'youtube', publisher: 'Fox Business', url: 'https://www.youtube.com/watch?v=abcDEF12345', rights: 'embed_only',
    embed_url: 'https://www.youtube-nocookie.com/embed/abcDEF12345', thumbnail_url: 'https://i.ytimg.com/vi/abcDEF12345/hqdefault.jpg', published_at: '2026-07-20T00:00:00Z' }],
  decisions: [], runs: []
};
const out = T.detailView(claim);
ok(out.includes('src="https://www.youtube-nocookie.com/embed/abcDEF12345?start=95"'), '4c the publisher player starts at the quote');
ok(out.includes('Proposed verdict: <b>False</b>') && out.includes('data-act="approve"'), '4d a ready claim shows its verdict and Approve');
ok(!out.includes('<b>O\'Leary</b>') && !out.includes('<script>'), '4e record text is escaped');
const linkOnly = T.detailView(Object.assign({}, claim, { sources: [Object.assign({}, claim.sources[0], { rights: 'unresolved' })] }));
ok(!linkOnly.includes('<iframe') && linkOnly.includes('i.ytimg.com'), '4f footage with unresolved rights shows a thumbnail and link, no player');
const cand = T.detailView(Object.assign({}, claim, { status: 'candidate', verdict: null, quote: null, research_version: 0 }));
ok(!cand.includes('data-act="approve"') && cand.includes('No verdict.') && cand.includes('data-act="request_research"'), '4g a candidate cannot be approved and offers research');
const pub = T.detailView(Object.assign({}, claim, { status: 'approved', public_state: 'published', slug: 's' }));
ok(pub.includes('data-act="correct"') && !pub.includes('data-act="skip"'), '4h a published claim offers correction, not skip');
const sched = T.detailView(Object.assign({}, claim, { status: 'approved', public_state: 'published', slug: 's', bsky_status: 'none' }));
ok(sched.includes('data-act="schedule"') && sched.includes('no time is added'), '4h2 an approved public claim can be scheduled on a shared time');
const booked = T.detailView(Object.assign({}, claim, { status: 'approved', public_state: 'published', slug: 's', bsky_status: 'scheduled',
  bsky_slot_kind: 'maps', scheduled_slot: '2026-11-02T16:30:00Z' }));
ok(booked.includes('data-act="unschedule"') && !booked.includes('data-act="schedule"') && booked.includes('(a MAPS time)') && booked.includes('8:30 AM Pacific'), '4h3 a booked post shows its time and kind, and can be taken off');
const posted = T.detailView(Object.assign({}, claim, { status: 'approved', public_state: 'published', slug: 's', bsky_status: 'published',
  bsky_uri: 'at://did:plc:abc/app.bsky.feed.post/3kabc', published_at: '2026-11-02T16:31:00Z' }));
ok(posted.includes('https://bsky.app/profile/did:plc:abc/post/3kabc') && !posted.includes('data-act="schedule"'), '4h4 a posted claim links its Bluesky post');
const noThumb = T.row({ id: 'x', status: 'candidate', topic: 'T', sources: [{ platform: 'youtube', thumbnail_url: 'https://evil.example/x.jpg' }] });
ok(noThumb.includes('No thumbnail available') && !noThumb.includes('evil.example'), '4i an unknown thumbnail host shows the labelled placeholder');
ok(T.graphemes('👍🏽ab') === 3, '4j the post counter counts graphemes');

console.log(fails ? fails + ' FAILED' : 'all passed');
process.exit(fails ? 1 : 0);
