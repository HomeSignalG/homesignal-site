// Real Chromium: Public Participation / How-To stories in Tab 17 (2026-11-06).
//   1. Story Outline: the participation review panel, from the engine's own check output (fixtures/impact-participation.json,
//      exported from homesignal-ingest impact/participation.py on the EPA-hearing-shaped fixture: one ready, one expired).
//   2. Hot Topics: the story-type chip and override on a topic card, and the Story type field of Suggest a topic.
// Run: node test/impact-participation.browser.test.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const fs = require('node:fs');
let fails = 0;
const ok = (c, name) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name); if (!c) fails++; };
const stories = fs.readFileSync(new URL('../lib/acq-impact-stories.js', import.meta.url), 'utf8');
const discovery = fs.readFileSync(new URL('../lib/acq-impact-discovery.js', import.meta.url), 'utf8');
const FX = JSON.parse(fs.readFileSync(new URL('./fixtures/impact-participation.json', import.meta.url), 'utf8'));
const FORM = 'https://survey.alchemer.com/s3/9078544/OG-Recon2-PublicHearing-2026';
const CSS = '<style>:root{--line:#ddd;--panel:#fff;--panel2:#f7f7f7;--ink:#111;--muted:#555;--accent:#157a49;--shadow-sm:none}</style>';
const browser = await chromium.launch();

async function outline(fx) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.setContent('<!doctype html><html><head>' + CSS + '</head><body><div id="is"></div></body></html>');
  await page.addScriptTag({ content: stories });
  await page.evaluate((f) => {
    const story = { id: 's1', title: 'EPA Methane Hearing — How to Register to Speak', video_slug: f.pack.slug, current_version: 1, place: '' };
    const status = { stage: 'outline', next: 'Review the outline', library: 'needs_review', fresh: true,
      artifacts: { narrative: { state: 'pending', why: 'Ready for your decision.', last_decision: null } }, job: null };
    window.client = { rpc: (n) => {
      const d = {
        hs_impact_story_catalog: [],
        hs_impact_story_list: [{ id: 's1', title: story.title, video_slug: story.video_slug, updated_at: '2026-11-06T15:00:00Z', status }],
        hs_impact_story_get: { story, status, pack: f.pack, version: { version: 1, checked: true, body: f.body, validation: f.validation, derived: { ledger: [] } },
          visuals: { state: 'none' }, media: {}, line_notes: [], events: [] },
      }[n];
      return Promise.resolve(d === undefined ? { data: null, error: { message: 'not stubbed: ' + n } } : { data: d, error: null });
    } };
    window.HS.acqImpactStories.load(window.client, document.getElementById('is'));
  }, fx);
  await page.waitForTimeout(150);
  await page.click('#is [data-act=open] >> nth=0').catch(() => {});
  await page.waitForTimeout(150);
  await page.click('#is [data-act=step][data-step=outline]');
  await page.waitForTimeout(80);
  return { page, errs };
}

{ // 1a. the EPA hearing case, ready
  const { page, errs } = await outline(FX.open);
  const t = await page.locator('#is .is-part').innerText();
  ok(/Public Participation \/ How-To/.test(t), '1a the story classification is shown');
  ok(await page.locator('#is [data-part-status=ready]').innerText() === 'Ready for Review', '1b status Ready for Review comes from the engine check');
  ok(/U\.S\. Environmental Protection Agency/.test(t) && /Register to speak/.test(t), '1c official agency and primary action');
  ok(/2026-11-10/.test(t) && /open · 4 days left/.test(t), '1d the verified deadline with its state and days left');
  ok(/2026-11-16 to 2026-11-17/.test(t) && /virtual/.test(t) && /not the registration deadline/.test(t), '1e the hearing dates are shown apart from the deadline');
  ok(await page.locator('#is .is-part a[href="' + FORM + '"]').count() === 1 && /the agency page .* links it/.test(t), '1f the official action link, and how it was verified');
  ok((await page.locator('#is .is-part ol li').count()) === 5 && /Choose to provide testimony/.test(t), '1g the five numbered steps');
  ok(/Submit a comment/.test(t) && /2026-12-16/.test(t) && /Open/.test(t), '1h the written-comment alternative and its deadline');
  ok(/illustrative, not a screenshot/.test(t), '1i the visual plan says the steps card is not a screenshot');
  ok(await page.locator('#is button[data-act=revise][data-sec=participation]').count() === 1, '1j a revision of the action can be requested');
  ok(!errs.length, '1k no page errors ' + errs.join(' | '));
  await page.close();
}
{ // 1b. the same story after the deadline
  const { page, errs } = await outline(FX.expired);
  const t = await page.locator('#is .is-part').innerText();
  const all = await page.locator('#is').innerText();
  ok(await page.locator('#is [data-part-status=expired]').innerText() === 'Expired', '1l an expired deadline shows Expired');
  ok(await page.locator('#is [data-part-deadline=expired]').count() === 1 && /passed/.test(t), '1m the deadline reads passed');
  ok(/has passed, so the story cannot tell viewers to register to speak/.test(all) && /Submit a comment by 2026-12-16/.test(all), '1n the blocking reason names the open alternative');
  ok(!errs.length, '1o no page errors ' + errs.join(' | '));
  await page.close();
}
{ // 1c. an investigative story shows no participation panel
  const fx = JSON.parse(JSON.stringify(FX.open));
  fx.body.discovery.story_type = 'investigative';
  delete fx.validation.participation;
  const { page } = await outline(fx);
  ok(await page.locator('#is .is-part').count() === 0, '1p an investigative story has no participation panel');
  await page.close();
}

{ // 2. Hot Topics
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.setContent('<!doctype html><html><head>' + CSS + '</head><body><div id="hot"></div></body></html>');
  await page.addScriptTag({ content: discovery });
  await page.evaluate(() => {
    window.calls = [];
    const now = new Date().toISOString();
    const base = { origin: 'founder', category: 'other', track: 'core', status: 'nominated', evidence_status: 'social_only', score: 0, evidence: { leads: [] },
      concept: {}, related: [], metrics: {}, discovered_at: now, last_seen_at: now, reasons: [], start_mode: 'auto' };
    window.db = { settings: { scan_enabled: false }, candidates: [
      Object.assign({}, base, { id: 'h1', title: 'EPA Methane Hearing — How to Register to Speak Before November 10', story_type: 'auto',
        story_type_detected: { type: 'participation', confidence: 'high', signals: ['title: register to speak'] }, story_type_resolved: 'participation' }),
      Object.assign({}, base, { id: 'h2', title: 'Old topic from before story types' }),
    ], exclusions: [], performance: [], learning: {} };
    window.client = { rpc: (n, a) => {
      window.calls.push([n, a]);
      if (n === 'hs_impact_discovery_overview') return Promise.resolve({ data: JSON.parse(JSON.stringify(window.db)), error: null });
      if (n === 'hs_impact_discovery_set_story_type') { const c = window.db.candidates.find((x) => x.id === a.p_candidate);
        c.story_type = a.p_type; c.story_type_resolved = a.p_type === 'auto' ? c.story_type_detected.type : a.p_type;
        return Promise.resolve({ data: { ok: true, story_type: a.p_type, story_type_resolved: c.story_type_resolved }, error: null }); }
      if (n === 'hs_impact_discovery_suggest') return Promise.resolve({ data: { id: 'n1', status: 'nominated' }, error: null });
      return Promise.resolve({ data: {}, error: null });
    } };
    HS.acqImpactDiscovery.attach(window.client, document.getElementById('hot'), () => {});
  });
  await page.waitForSelector('.is-card');
  const card = page.locator('article', { hasText: 'EPA Methane Hearing' });
  ok((await card.locator('[data-hot-type-chip=h1]').innerText()) === 'Public Participation / How-To', '2a the topic card shows the detected story type');
  ok(/detected, high confidence/.test(await card.innerText()), '2b it says the type was detected, and how sure');
  ok(/Auto-detect \(Public Participation \/ How-To\)/.test(await card.locator('select[data-hot-type]').innerText()), '2c the override list shows what Auto-detect chose');
  ok(await page.locator('article', { hasText: 'Old topic' }).locator('[data-hot-type-chip]').count() === 0, '2d a topic the database sent no type for shows no control');
  await card.locator('select[data-hot-type]').selectOption('public_policy');
  await page.waitForTimeout(80);
  const set = (await page.evaluate(() => window.calls)).find((c) => c[0] === 'hs_impact_discovery_set_story_type');
  ok(set && set[1].p_candidate === 'h1' && set[1].p_type === 'public_policy', '2e an override is saved with the founder setter');
  ok((await page.locator('article', { hasText: 'EPA Methane Hearing' }).locator('[data-hot-type-chip=h1]').innerText()) === 'Public Policy' &&
     /your choice/.test(await page.locator('article', { hasText: 'EPA Methane Hearing' }).innerText()), '2f the card now shows the founder\'s choice');
  await page.evaluate(() => { document.getElementById('hot-suggest').open = true; });
  ok(await page.locator('#hot-sg-type').inputValue() === 'auto', '2g Suggest a topic defaults to Auto-detect');
  await page.fill('#hot-sg-title', 'How do I speak at a public hearing before Friday?');
  await page.selectOption('#hot-sg-type', 'participation');
  await page.click('[data-hot=suggest]');
  await page.waitForTimeout(80);
  const sg = (await page.evaluate(() => window.calls)).find((c) => c[0] === 'hs_impact_discovery_suggest');
  ok(sg && sg[1].p_topic.story_type === 'participation', '2h a chosen story type goes with the suggestion');
  await page.close();
}

await browser.close();
console.log(fails ? fails + ' FAILED' : 'all passed');
process.exit(fails ? 1 : 0);
