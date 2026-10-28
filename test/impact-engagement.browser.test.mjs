// Real Chromium: Tab 17 "Engage on Bluesky" against a stub Supabase client (no network, no credential).
// Strongest five first (at most two per topic); each post's own counts; REPLY / QUOTE-POST / SKIP; the draft counter and
// the 300 limit; Preview, Copy, Open Original, Mark Posted, Skip; escaping; posted results; phone width.
// Run: node test/impact-engagement.browser.test.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const fs = require('node:fs');
let fails = 0;
const ok = (c, name) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name); if (!c) fails++; };
const lib = fs.readFileSync(new URL('../lib/acq-impact-engagement.js', import.meta.url), 'utf8');

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();
await page.setContent('<!doctype html><html><head><style>:root{--line:#ddd;--panel2:#f7f7f7}.is-cards{display:grid;gap:10px}</style></head><body><div id="eng"></div></body></html>');
await page.addScriptTag({ content: lib });
await page.evaluate(() => {
  window.calls = [];
  window.clip = null;
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: (t) => { window.clip = t; return Promise.resolve(); } } });
  const iso = (h) => new Date(Date.now() - h * 3600e3).toISOString();
  const opp = (id, cand, score, action, o) => Object.assign({ id, key: 'e-' + id.padEnd(10, '0'), candidate_id: cand, topic_title: 'Topic ' + cand,
    topic_place: 'Lakewood, WA', author: 'n' + id + '.bsky.social', display_name: 'Neighbor ' + id, post_text: 'Post ' + id,
    post_created_at: iso(3), replies: 10 + score, reposts: 4, likes: 30, quotes: 1, score, action, status: 'suggested',
    target_url: 'https://bsky.app/profile/n' + id + '.bsky.social/post/3k' + id, reasons: ['why ' + id],
    score_parts: { conversation: 22, recency: 16, velocity: 12, relevance: 9, contribution: 6, velocity_per_hour: 14.2 },
    draft: action === 'SKIP' ? null : { text: 'Was there a permit for the clearing, and who approved it?', basis: 'questions_only', facts_used: [] } }, o || {});
  window.db = {
    last_run: { scan_id: 's1', status: 'ok', at: iso(1) },
    suggested: [
      opp('a', 'T1', 90, 'REPLY'), opp('b', 'T1', 88, 'QUOTE', { draft: { text: 'Tracking it: https://jodytracks.com/?utm_content=e-b #JODYTracks', basis: 'questions_only' } }),
      opp('c', 'T1', 87, 'REPLY'), opp('d', 'T2', 80, 'REPLY', { post_text: '<img src=x onerror=alert(1)>', target_url: 'javascript:alert(1)' }),
      opp('e', 'T3', 70, 'REPLY'), opp('f', 'T4', 60, 'REPLY'), opp('g', 'T5', 50, 'REPLY'), opp('h', 'T6', 20, 'SKIP')],
    posted: [opp('p', 'T7', 70, 'REPLY', { status: 'posted', posted_action: 'REPLY', posted_text: 'my reply', posted_at: iso(30),
      posted_url: 'https://bsky.app/profile/jodytracks.com/post/3kz', result: { replies: 3, reposts: 1, likes: 9 }, visits: 4, registrations: 1 }),
      opp('q', 'T7', 60, 'QUOTE', { status: 'posted', posted_action: 'QUOTE', posted_at: iso(2), result: null, visits: 0, registrations: 0 })],
    skipped: [], totals: {} };
  const client = { rpc: (name, args) => { window.calls.push([name, args]); return Promise.resolve({ data: name === 'hs_impact_engagement_overview' ? window.db : { ok: true }, error: null }); } };
  window.prompt = () => 'off-topic';
  return window.HS.acqImpactEngagement.attach(client, document.getElementById('eng'));
});
await page.waitForSelector('.is-card');

const top = await page.$$eval('h4 + .is-cards > .is-card', (els) => els.map((e) => e.getAttribute('aria-label') + '|' + e.querySelector('.is-score').textContent));
ok(top.length === 5, '1a five shown first (' + top.length + ')');
const scores = top.map((s) => +s.split('|')[1]);
ok(JSON.stringify(scores) === JSON.stringify([90, 88, 80, 70, 60]), '1b strongest first, at most two from one topic (' + scores + ')');
ok(/Show 3 more/.test(await page.textContent('#eng')), '1c the rest wait behind Show more');
ok(/This post: 100 replies · 4 reposts · 30 likes · 1 quotes/.test(await page.textContent('#eng')), '1d each card shows the post\'s own counts');
ok(await page.$$eval('.is-badge', (b) => b.some((x) => x.textContent === 'QUOTE-POST')) , '1e QUOTE recommendation labelled QUOTE-POST');
ok(!(await page.$('img[src="x"]')) && /&lt;img/.test(await page.innerHTML('#eng')), '1f post text is escaped');
ok(!(await page.$('a[href^="javascript"]')), '1g a non-https link is never clickable');

// draft counter and the 300 limit
const ta = '#ie-t-a';
await page.fill(ta, 'x'.repeat(301));
ok(/301 \/ 300/.test(await page.textContent('.is-card')) && await page.$eval('.is-card [data-ie="copy"]', (b) => b.disabled), '2a over 300 graphemes disables Copy');
await page.fill(ta, 'Was the permit public? 🌲🏠');
ok(/25 \/ 300/.test(await page.textContent('.is-card')), '2b emoji count as one grapheme each');
await page.click('.is-card [data-ie="copy"]');
await page.waitForTimeout(50);
ok((await page.evaluate(() => window.clip)) === 'Was the permit public? 🌲🏠', '2c Copy puts the edited draft on the clipboard');
ok(await page.evaluate(() => window.calls.some(([n, a]) => n === 'hs_impact_engagement_decide' && a.p_action === 'copied')), '2d the copy is recorded, nothing posted');

// preview
await page.click('[data-ie="preview"][data-id="b"]');
ok(/JODY TRACKS/.test(await page.textContent('.ie-prev')) && /Post b/.test(await page.textContent('.ie-prev')), '3a preview shows the quote over the original');

// mark posted
await page.click('[data-ie="post-form"][data-id="a"]');
await page.fill('#ie-u-a', 'https://bsky.app/profile/jodytracks.com/post/3kabc');
await page.click('[data-ie="posted"][data-id="a"]');
await page.waitForTimeout(50);
const mp = await page.evaluate(() => window.calls.filter(([n, a]) => a && a.p_action === 'mark_posted').map(([, a]) => a)[0]);
ok(mp && mp.p_id === 'a' && mp.p_posted_url === 'https://bsky.app/profile/jodytracks.com/post/3kabc' && mp.p_text === 'Was the permit public? 🌲🏠',
  '4a Mark Posted sends the link and the text as posted');
await page.click('[data-ie="skip"][data-id="e"]');
await page.waitForTimeout(50);
ok(await page.evaluate(() => window.calls.some(([, a]) => a && a.p_action === 'skip' && a.p_note === 'off-topic')), '4b Skip records the reason');

// posted results
const posted = await page.textContent('#ie-posted');
ok(/3 replies · 1 reposts · 9 likes/.test(posted) && /not read yet/.test(posted), '5a posted results shown; an unread one says so');
ok(/Visits/.test(posted) && /Registrations/.test(posted), '5b visits and registrations columns');

// no RPC beyond the two founder functions
ok(await page.evaluate(() => window.calls.every(([n]) => n === 'hs_impact_engagement_overview' || n === 'hs_impact_engagement_decide')), '6a only the two founder functions are called');

await page.setViewportSize({ width: 390, height: 900 });
ok(await page.evaluate(() => document.documentElement.scrollWidth <= 390), '7a no horizontal scroll at phone width');

await browser.close();
if (fails) { console.log(fails + ' FAILED'); process.exit(1); }
console.log('all passed');
