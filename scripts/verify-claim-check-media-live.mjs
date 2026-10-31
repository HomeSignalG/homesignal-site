// Daily, read-only: does Tab 19 (Claim Check) still show real Bluesky and YouTube media on the LIVE site?
//
// The offline tests render the page against sample data and never load a real image or player, so they could not see the
// 2026-10-30 breakages (Bluesky video previews redirect to video.cdn.bsky.app, which the page's CSP blocked; Bluesky posts
// had no player). This script takes, from production:
//   - acquisition.html's own Content-Security-Policy and the script key it loads,
//   - that exact lib/acq-claim-check.js,
// renders the page's own detail view for a real Bluesky post and a real YouTube video in Chromium under that CSP, and fails
// unless every preview image loads, both players load from their own hosts, and the browser reports no CSP violation.
// The admin tab itself needs a sign-in, so the rendering function is called directly; everything it loads is real.
// Writes nothing, holds no secret. Run: node scripts/verify-claim-check-media-live.mjs [--site https://jodytracks.com]
import http from 'node:http';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const SITE = arg('--site', 'https://jodytracks.com').replace(/\/$/, '');
// A real Bluesky post with a video (Aaron Rupar, Trump on data centers, 2026-10-25) and a long-lived embeddable YouTube video.
const BSKY_URI = 'at://did:plc:4llrhdclvdlmmynkwsmg5tdc/app.bsky.feed.post/3mynwycgzla2p';
const YT_ID = 'jNQXAC9IVRw';

let fails = 0;
const ok = (c, name, detail) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name + (detail ? ' (' + detail + ')' : '')); if (!c) fails++; };
const infra = (msg) => { console.log('INFRASTRUCTURE: ' + msg + '\nNOTHING WAS VERIFIED.'); process.exit(1); };
async function get(url) {
  const r = await fetch(url, { headers: { 'cache-control': 'no-cache' } }).catch((e) => infra('GET ' + url + ': ' + e.message));
  if (!r.ok) infra('GET ' + url + ' -> HTTP ' + r.status);
  return r;
}

// 1. what production serves
const html = await (await get(SITE + '/acquisition.html?cb=' + Date.now())).text();
const csp = (html.match(/Content-Security-Policy" content="([^"]+)"/) || [])[1];
if (!csp) infra('the live acquisition.html carries no Content-Security-Policy meta tag');
const key = (html.match(/lib\/acq-claim-check\.js\?v=([0-9a-f]{8})/) || [])[1];
if (!key) infra('the live acquisition.html does not load lib/acq-claim-check.js');
const js = await (await get(SITE + '/lib/acq-claim-check.js?v=' + key)).text();
const liveKey = createHash('sha256').update(js).digest('hex').slice(0, 8);
ok(liveKey === key, 'the live script matches the key the live page loads', 'key ' + key + ', file ' + liveKey);
let repoKey = null;
try { repoKey = createHash('sha256').update(readFileSync(new URL('../lib/acq-claim-check.js', import.meta.url))).digest('hex').slice(0, 8); } catch (e) { /* no checkout */ }
if (repoKey) console.log((repoKey === key ? 'INFO' : 'NOTE') + ' — live script ' + key + ', this checkout ' + repoKey + (repoKey === key ? '' : ' (a deploy may be pending)'));

// 2. a real Bluesky post, read from Bluesky's public API (no sign-in)
const pr = await (await get('https://public.api.bsky.app/xrpc/app.bsky.feed.getPosts?uris=' + encodeURIComponent(BSKY_URI))).json();
const post = (pr.posts || [])[0];
if (!post) infra('Bluesky returned no post for ' + BSKY_URI + ' (deleted?). Pick another post with a video.');
const thumb = post.embed && (post.embed.thumbnail || (post.embed.media && post.embed.media.thumbnail));
if (!thumb) infra('the Bluesky post has no video thumbnail any more. Pick another post with a video.');
const rkey = BSKY_URI.split('/').pop();
const bsky = { platform: 'bluesky', author: post.author.handle, publisher: post.author.displayName || null,
  url: 'https://bsky.app/profile/' + post.author.handle + '/post/' + rkey, thumbnail_url: thumb, rights: 'link_only',
  source_key: 'bsky:' + BSKY_URI.replace('at://', ''), published_at: post.indexedAt };
const yt = { platform: 'youtube', publisher: 'YouTube', url: 'https://www.youtube.com/watch?v=' + YT_ID, rights: 'embed_only',
  embed_url: 'https://www.youtube-nocookie.com/embed/' + YT_ID, thumbnail_url: 'https://i.ytimg.com/vi/' + YT_ID + '/hqdefault.jpg',
  published_at: '2005-04-24T00:00:00Z' };
const base = { id: '00000000-0000-0000-0000-000000000001', status: 'candidate', research_version: 0, speaker_name: 'Test',
  verdict: null, quote: null, public_state: 'none', evidence: { supporting: [], contradicting: [] } };

// 3. a local page carrying the live CSP and the live script, nothing else
const page = '<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="' +
  csp.replace(/"/g, '&quot;') + '"><script src="/hs.js"></script><script src="/lib.js"></script></head><body><div id="out"></div></body></html>';
const files = { '/': ['text/html', page], '/hs.js': ['text/javascript', 'window.HS = window.HS || {};'], '/lib.js': ['text/javascript', js] };
const server = http.createServer((q, s) => { const f = files[q.url.split('?')[0]]; if (!f) { s.writeHead(404); return s.end(); } s.writeHead(200, { 'content-type': f[0] }); s.end(f[1]); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = 'http://127.0.0.1:' + server.address().port;

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  const violations = [];
  await p.addInitScript(() => { window.__csp = []; document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(e.violatedDirective + ' ' + e.blockedURI)); });
  const statuses = {};
  p.on('response', (r) => { const u = r.url(); if (/embed\.bsky\.app\/embed\/|youtube-nocookie\.com\/embed\//.test(u)) statuses[u] = r.status(); });
  await p.goto(origin + '/');
  const ready = await p.evaluate(() => !!(window.HS && window.HS.acqClaimCheck && window.HS.acqClaimCheck._test));
  ok(ready, 'the live script loads under the live CSP');
  if (!ready) throw new Error('script did not load');
  await p.evaluate(([b, y, c]) => {
    const T = window.HS.acqClaimCheck._test;
    const noKey = Object.assign({}, b, { source_key: null });   // a Bluesky post with no key shows its preview linked to the post
    document.getElementById('out').innerHTML = T.detailView(Object.assign({}, c, { sources: [b] })) +
      T.detailView(Object.assign({}, c, { sources: [y] })) + T.detailView(Object.assign({}, c, { sources: [noKey] }));
  }, [bsky, yt, base]);
  await p.waitForTimeout(12000);
  const imgs = await p.evaluate(() => [...document.images].map((i) => ({ src: i.currentSrc || i.src, w: i.naturalWidth })));
  ok(imgs.length > 0, 'the rendered views carry preview images', imgs.length + ' image(s)');
  for (const i of imgs) ok(i.w > 0, 'preview image loads', i.src.slice(0, 90));
  const frames = await p.evaluate(() => [...document.querySelectorAll('iframe')].map((f) => ({ src: f.src, sandbox: f.getAttribute('sandbox') })));
  const bf = frames.find((f) => f.src.startsWith('https://embed.bsky.app/embed/'));
  const yf = frames.find((f) => f.src.startsWith('https://www.youtube-nocookie.com/embed/'));
  ok(!!bf, 'the Bluesky post plays in Bluesky\'s player');
  ok(!!yf, 'the YouTube video plays in the nocookie player');
  if (bf) ok(statuses[bf.src] === 200, 'Bluesky\'s player answers', 'HTTP ' + statuses[bf.src]);
  if (yf) ok(statuses[yf.src] === 200, 'YouTube\'s player answers', 'HTTP ' + statuses[yf.src]);
  if (bf) {
    const fr = p.frames().find((f) => f.url().startsWith('https://embed.bsky.app/'));
    const txt = fr ? await fr.evaluate(() => document.body ? document.body.innerText.length : 0).catch(() => -1) : -1;
    ok(txt > 0, 'Bluesky\'s player renders inside its sandbox', txt + ' characters');
  }
  violations.push(...await p.evaluate(() => window.__csp));
  ok(violations.length === 0, 'the browser reports no CSP violation', violations.join('; '));
} finally {
  await browser.close();
  server.close();
}
console.log(fails ? fails + ' FAILED' : 'all passed');
process.exit(fails ? 1 : 0);
