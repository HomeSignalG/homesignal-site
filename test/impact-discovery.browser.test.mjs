// Real Chromium: Tab 17 "Hot Topics — Automatically Discovered" against a stub Supabase client (no network, no credential).
// Ranked candidates with their fields; scan status; a failed scan shown as a failure; Scan Now; Open Sources / View Story
// Concept; Create Impact Story only for a verified topic; Reject / Dismiss / Exclude Similar; escaping; phone width.
// Run: node test/impact-discovery.browser.test.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const fs = require('node:fs');
let fails = 0;
const ok = (c, name) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name); if (!c) fails++; };
const lib = fs.readFileSync(new URL('../lib/acq-impact-discovery.js', import.meta.url), 'utf8');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await page.setContent('<!doctype html><html><head><style>:root{--line:#ddd;--panel:#fff;--panel2:#f7f7f7;--ink:#111;--muted:#555;--accent:#157a49}</style></head><body><div id="hot"></div></body></html>');
await page.addScriptTag({ content: lib });
await page.evaluate(() => {
  window.calls = [];
  const now = Date.now();
  const iso = (h) => new Date(now - h * 3600e3).toISOString();
  const cand = (o) => Object.assign({ track: 'core', category: 'data_centers', status: 'open', evidence_status: 'leads_found', score: 70,
    metrics: { replies: 46, reposts: 31, likes: 210, posts: 3 }, lead_created_at: iso(14), discovered_at: iso(3), last_seen_at: iso(1),
    lead_author: 'wnywater.test', lead_url: 'https://bsky.app/profile/wnywater.test/post/3k1',
    related: [{ url: 'https://bsky.app/profile/wnywater.test/post/3k1', author: 'wnywater.test', created_at: iso(14), replies: 46, reposts: 31, likes: 210 },
              { url: 'javascript:alert(1)', author: 'evil.test', created_at: iso(5), replies: 1, reposts: 0, likes: 2, syndicated: true }],
    evidence: { leads: [{ url: 'https://www.co.genesee.ny.us/planning/agenda.pdf', domain: 'co.genesee.ny.us', kind: 'official' }] },
    score_parts: { mission: 25, verifiable: 20, engagement: 15, stakes: 15, visuals: 10, timeliness: 10, report_potential: 5 },
    reasons: ['Matches Data centers: data center, hyperscale.'], concept: { verified: false, hook: 'What would this mean?', fear: 'f', anger: 'a', motivation: 'm',
    opening_visual: 'a map', first3s: 'In Genesee County…', affected: ['families'] }, coverage: { places: [{ zip_pages: 6 }] } }, o);
  window.db = {
    latest_scan: { id: 'sc2', status: 'failed', trigger: 'scheduled', created_at: iso(0.5), finished_at: iso(0.4), rate_limited: true,
      errors: [{ kind: 'rate_limited', message: 'Bluesky answered 429 Too Many Requests for app.bsky.feed.searchPosts.' }], posts_examined: null },
    last_success: { id: 'sc1', status: 'success', finished_at: iso(6), posts_examined: 412, candidates_qualified: 6, candidates_nominated: 1, errors: [] },
    next_scan_at: new Date(now + 4 * 3600e3).toISOString(),
    settings: { scan_enabled: true, scan_times: ['08:00', '14:00'], window_hours: 72, nominate_score: 80, max_prepare_per_scan: 1,
      target_replies: 20, target_likes: 50, target_reposts: 10, experimental_enabled: true, experimental_auto: false, learning_enabled: true },
    candidates: [
      cand({ id: 'c1', title: 'Tonawanda Seneca Nation <data center>', place: 'Genesee County, NY', score: 100, status: 'nominated' }),
      cand({ id: 'c2', title: 'Emerson Lake trees', place: 'Lakewood, WA', score: 84, status: 'ready_for_review', evidence_status: 'verified',
             source_slug: 'emerson-lake', story_id: 's9', concept: { verified: true, hook: 'Who decided?', fear: 'f', anger: 'a', motivation: 'm', opening_visual: 'the trees', first3s: 'x' } }),
      cand({ id: 'c3', title: 'Spill rumor', score: 58, evidence_status: 'social_only', evidence: { leads: [] } }),
      cand({ id: 'c4', title: 'Ethics complaint', track: 'experimental', category: 'public_accountability', score: 53,
             concept: { verified: false, neutral: true, hook: 'What is being decided?', motivation: 'm', note: 'Neutral framing.', opening_visual: 'x', first3s: 'y' } }),
      cand({ id: 'c5', title: 'PFAS wells', score: 73, evidence_status: 'verified', source_slug: 'pfas-wells' }),
    ],
    exclusions: [], performance: [{ error: 'Attribution tables are not available, so performance is not measured.' }], learning: {},
  };
  window.client = { rpc: (n, a) => {
    window.calls.push([n, a]);
    if (n === 'hs_impact_discovery_overview') return Promise.resolve({ data: JSON.parse(JSON.stringify(window.db)), error: null });
    if (n === 'hs_impact_discovery_scan_now') { window.db.latest_scan = { id: 'sc3', status: 'queued', trigger: 'manual', created_at: new Date().toISOString(), errors: [] };
      return Promise.resolve({ data: { scan_id: 'sc3', status: 'queued', existing: false }, error: null }); }
    if (n === 'hs_impact_discovery_decide') { const c = window.db.candidates.find((x) => x.id === a.p_candidate); c.status = { reject: 'rejected', dismiss: 'dismissed', exclude_similar: 'excluded' }[a.p_action];
      window.db.candidates = window.db.candidates.filter((x) => x.status !== c.status); return Promise.resolve({ data: { ok: true }, error: null }); }
    if (n === 'hs_impact_discovery_suggest') {
      if (a.p_topic.links.some((u) => !/^https?:\/\//.test(u))) return Promise.resolve({ data: null, error: { message: 'This is not a web link (it must start with http:// or https://): ' + a.p_topic.links[0] } });
      window.db.candidates.unshift({ id: 'f1', origin: 'founder', title: a.p_topic.title, place: a.p_topic.place, category: a.p_topic.category, track: 'core',
        status: 'nominated', evidence_status: a.p_topic.links.length ? 'leads_found' : 'social_only', score: 0, submitted_note: a.p_topic.note,
        evidence: { leads: a.p_topic.links.map((u) => ({ url: u, kind: 'founder' })) }, concept: {}, related: [], metrics: {},
        discovered_at: new Date().toISOString(), last_seen_at: new Date().toISOString(), reasons: ['You suggested this topic.'] });
      return Promise.resolve({ data: { id: 'f1', status: 'nominated' }, error: null }); }
    if (n === 'hs_impact_discovery_open_story') return Promise.resolve({ data: { story_id: 'new-story', existing: false }, error: null });
    if (n === 'hs_impact_discovery_settings_save') return a.p_settings.scan_times.every((t) => /^\d\d:\d\d$/.test(t))
      ? Promise.resolve({ data: {}, error: null }) : Promise.resolve({ data: null, error: { message: 'Scan times are HH:MM (24-hour): 8am' } });
    return Promise.resolve({ data: {}, error: null });
  } };
  window.opened = null;
  window.prompt = () => 'Not our beat.';
  HS.acqImpactDiscovery.attach(window.client, document.getElementById('hot'), (id) => { window.opened = id; });
});
await page.waitForSelector('.is-card');
const text = () => page.evaluate(() => document.getElementById('hot').innerText);
let t = await text();

// status
ok(/Hot Topics — Automatically Discovered/.test(t), '1a the section heading');
ok(/Last successful scan:/.test(t) && /Posts examined: 412/.test(t) && /Topics qualified: 6/.test(t) && /Nominated: 1/.test(t), '1b last success, posts examined, qualified, nominated');
ok(/Next scan:/.test(t) && / PT/.test(t), '1c the next scan time in Pacific time');
ok(await page.isVisible('[role=alert]') && /The latest scan failed/.test(t) && /429 Too Many Requests/.test(t) && /rate-limited/.test(t), '1d a failed scan is a visible failure with its reason');
ok(!/Posts examined: 0/.test(t), '1e the failed scan shows no zero count');

// ranking and fields
const titles = await page.$$eval('.is-card h4', (h) => h.map((x) => x.textContent));
ok(titles[0] === 'Tonawanda Seneca Nation <data center>', '2a candidates in the order the database ranked them, text escaped');
ok(await page.evaluate(() => !document.querySelector('#hot data, #hot script')), '2b no markup injected from a title');
ok(/Genesee County, NY/.test(t) && /Data centers/.test(t) && /46 replies, 31 reposts, 210 likes across 3 post/.test(t), '2c place, category, engagement');
ok(/JODY covers 6 ZIP page/.test(t) && /Nominated for research/.test(t) && /Independent sources linked — not yet checked/.test(t), '2d coverage, status and evidence status');
ok(/Experimental: broader public accountability/.test(t), '2e the experimental track is labelled');
ok(/Social posts only — unverified/.test(t), '2f a social-only topic says so');
ok(/Auto-discovered — Ready for Review/.test(t), '2g a prepared topic is Ready for Review');

// buttons
const c3 = page.locator('article', { hasText: 'Spill rumor' });
ok(await c3.locator('button:has-text("Create Impact Story")').isDisabled(), '3a Create Impact Story is disabled for an unverified topic');
ok(await page.locator('article', { hasText: 'Emerson Lake' }).locator('button:has-text("Open Impact Story")').count() === 1, '3b a topic with a story offers Open Impact Story');
ok(await page.locator('article', { hasText: 'Emerson Lake' }).locator('button:has-text("Reject")').count() === 0, '3c a topic with a story cannot be rejected here');
await page.locator('article', { hasText: 'Tonawanda' }).locator('button:has-text("Open Sources")').click();
t = await text();
ok(/are not evidence/.test(t) && /co\.genesee\.ny\.us/.test(t), '3d Open Sources lists the posts (not evidence) and the documents to check');
ok(await page.evaluate(() => [...document.querySelectorAll('#hot a')].every((a) => /^https?:/.test(a.getAttribute('href')))), '3e no non-http link is rendered');
ok(await page.evaluate(() => [...document.querySelectorAll('#hot a')].every((a) => a.rel.includes('noopener'))), '3f outside links use noopener');
await page.locator('article', { hasText: 'Tonawanda' }).locator('button:has-text("View Story Concept")').click();
t = await text();
ok(/Provisional — written from the posts, unverified/.test(t) && /FEAR/.test(t) && /First 3 seconds/.test(t) && /Opening visual/.test(t), '3g the concept is labelled provisional and shows the hook, threads, opening visual and first 3 seconds');
await page.locator('article', { hasText: 'Ethics complaint' }).locator('button:has-text("View Story Concept")').click();
t = await text();
ok(/Neutral framing/.test(await page.locator('article', { hasText: 'Ethics complaint' }).innerText()) &&
   !/ANGER/.test(await page.locator('article', { hasText: 'Ethics complaint' }).innerText()), '3h the experimental concept is neutral (no fear / anger framing)');
await page.locator('article', { hasText: 'Tonawanda' }).locator('button:has-text("Score")').click();
ok(/Mission\s*25 \/ 25/.test(await page.locator('article', { hasText: 'Tonawanda' }).innerText()), '3i the score breakdown');

// actions
await page.locator('article', { hasText: 'PFAS wells' }).locator('button:has-text("Create Impact Story")').click();
await page.waitForFunction(() => window.opened === 'new-story');
ok(await page.evaluate(() => window.calls.some((c) => c[0] === 'hs_impact_discovery_open_story' && c[1].p_candidate === 'c5')), '4a Create Impact Story calls the database for that topic and opens the story');
await page.locator('article', { hasText: 'Spill rumor' }).locator('button:has-text("Reject")').click();
await page.waitForFunction(() => !document.getElementById('hot').innerText.includes('Spill rumor'));
ok(await page.evaluate(() => window.calls.some((c) => c[0] === 'hs_impact_discovery_decide' && c[1].p_action === 'reject' && c[1].p_note === 'Not our beat.')), '4b Reject records the note and the topic leaves the list');
await page.locator('article', { hasText: 'Ethics complaint' }).locator('button:has-text("Exclude Similar Topics")').click();
await page.waitForFunction(() => !document.getElementById('hot').innerText.includes('Ethics complaint'));
ok(await page.evaluate(() => window.calls.some((c) => c[1] && c[1].p_action === 'exclude_similar')), '4c Exclude Similar Topics');
await page.locator('button:has-text("Dismiss Topic")').first().click();
ok(await page.evaluate(() => window.calls.some((c) => c[1] && c[1].p_action === 'dismiss')), '4d Dismiss Topic');
await page.click('button:has-text("Scan Now")');
await page.waitForFunction(() => /Scan started/.test(document.getElementById('hot').innerText));
t = await text();
ok(/Scanning…/.test(t) && await page.locator('button:has-text("Scanning…")').isDisabled(), '4e Scan Now starts one scan and disables itself while it runs');

// settings
await page.click('summary:has-text("Scan settings")');
await page.fill('#hot-times', '8am');
await page.click('button:has-text("Save settings")');
await page.waitForFunction(() => /HH:MM/.test(document.getElementById('hot').innerText));
ok(true, '5a a bad scan time is refused with the database\'s reason');
ok(/Attribution tables are not available/.test(await page.evaluate(() => document.getElementById('hot').innerHTML)), '5b unmeasured performance is explained, not zero');

// an automatic refresh (as during a scan) keeps the open settings, an unsaved edit and the cursor
await page.fill('#hot-window', '96');
await page.evaluate(() => window.HS.acqImpactDiscovery._render());
ok(await page.evaluate(() => document.getElementById('hot-set').open
  && document.getElementById('hot-window').value === '96' && document.getElementById('hot-times').value === '8am'
  && document.activeElement && document.activeElement.id === 'hot-window'),
  '5c a refresh keeps the settings open, the unsaved values and the focus');


// Suggest a topic (founder, 2026-10-28)
await page.evaluate(() => window.HS.acqImpactDiscovery.suggest());
ok(await page.evaluate(() => document.getElementById('hot-suggest').open && document.activeElement.id === 'hot-sg-title'),
  '7a suggest() opens the form and puts the cursor in Topic');
await page.fill('#hot-sg-title', 'Van Tramp <fill> project');
await page.fill('#hot-sg-links', 'javascript:alert(1)');
await page.evaluate(() => window.HS.acqImpactDiscovery._render());
ok(await page.evaluate(() => document.getElementById('hot-suggest').open && document.getElementById('hot-sg-title').value === 'Van Tramp <fill> project'),
  '7b a refresh keeps the form open and what was typed');
await page.click('button:has-text("Add topic")');
await page.waitForFunction(() => /not a web link/.test(document.getElementById('hot').innerText));
ok(await page.evaluate(() => document.getElementById('hot-sg-title').value === 'Van Tramp <fill> project'), '7c a refused link keeps the form filled and shows the reason');
await page.fill('#hot-sg-links', 'https://www.cityofpuyallup.org/permit/123\nhttps://news.example.com/x');
await page.fill('#hot-sg-place', 'Puyallup, WA');
await page.selectOption('#hot-sg-cat', 'zoning_development');
await page.fill('#hot-sg-note', 'Up to 95 trucks a day next to a park.');
await page.click('button:has-text("Add topic")');
await page.waitForFunction(() => /Topic added/.test(document.getElementById('hot').innerText));
const sent = await page.evaluate(() => window.calls.filter((c) => c[0] === 'hs_impact_discovery_suggest').pop()[1].p_topic);
ok(sent.title === 'Van Tramp <fill> project' && sent.place === 'Puyallup, WA' && sent.category === 'zoning_development'
  && sent.links.length === 2 && sent.note === 'Up to 95 trucks a day next to a park.', '7d Add topic sends the title, place, category, links (one per line) and note');
const first = page.locator('.is-card').first();
const ft = await first.innerText();
ok(/Van Tramp <fill> project/.test(ft) && /Your pick/.test(ft) && /waiting for research/.test(ft) && /Why it matters: Up to 95 trucks/.test(ft),
  '7e the new topic is first, tagged Your pick, waiting for research, with the note (escaped)');
ok(!/of 100/.test(ft) && !/Lead post/.test(ft) && await first.locator('button:has-text("Score")').count() === 0
  && await first.locator('button:has-text("Exclude Similar")').count() === 0, '7f no score, no Bluesky lead, no Score or Exclude Similar buttons');
await first.locator('button:has-text("Open Sources")').click();
ok(/Links you added/.test(await first.innerText()) && /cityofpuyallup\.org/.test(await first.innerText()), '7g Open Sources lists the links you added as leads');
ok(await page.evaluate(() => !document.getElementById('hot-suggest').open && document.getElementById('hot-sg-title').value === ''), '7h after adding, the form is closed and cleared');

// phone width: no horizontal scroll
await page.setViewportSize({ width: 390, height: 900 });
ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), '6a no horizontal scroll at 390px');

await browser.close();
console.log(fails ? '\n' + fails + ' failed' : '\nall passed');
process.exit(fails ? 1 : 0);
