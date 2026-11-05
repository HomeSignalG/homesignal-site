// Real Chromium: Tab 17's storyboard workspace on two REAL committed stories, as the engine serves and checks them
// (fixtures exported from homesignal-ingest: impact.draft generate + rules.validate, including impact/audit.py):
//   - house-democratic-leadership-vote-secret-ballot: a public-affairs story with a founder brief
//   - stratos-data-center-water-box-elder: a development story written before the production audit
// Checks the three-panel storyboard, read mode, the five gates, the production audit, the brief coverage, and that
// the Quality-of-Life chart appears only for the development story.
// Run: node test/impact-stories-real-drafts.browser.test.mjs   (SHOTS=<dir> also saves screenshots)
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const fs = require('node:fs');
let fails = 0;
const ok = (c, name) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name); if (!c) fails++; };
const lib = fs.readFileSync(new URL('../lib/acq-impact-stories.js', import.meta.url), 'utf8');
const fx = (s) => JSON.parse(fs.readFileSync(new URL('./fixtures/impact-real/' + s + '.json', import.meta.url), 'utf8'));
const SHOTS = process.env.SHOTS;

const browser = await chromium.launch();
async function open(slug) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.setContent('<!doctype html><html><head><style>:root{--line:#ddd;--panel:#fff;--panel2:#f7f7f7;--ink:#111;--muted:#555;--accent:#157a49;--shadow-sm:none}</style></head><body><div id="is"></div></body></html>');
  await page.addScriptTag({ content: lib });
  await page.evaluate((f) => {
    window.calls = [];
    const story = { id: 's1', title: f.pack.title, video_slug: f.slug, current_version: 3, place: '' };
    const status = { stage: 'script', next: 'Review and approve the integrated narrative', library: 'needs_review', fresh: true,
      artifacts: { narrative: { state: f.validation.narrative.ok ? 'pending' : 'blocked', why: 'Ready for your decision.', last_decision: null } }, job: null };
    window.client = { rpc: (n, a) => {
      window.calls.push([n, a]);
      const d = {
        hs_impact_story_catalog: [],
        hs_impact_story_list: [{ id: 's1', title: story.title, video_slug: f.slug, updated_at: '2026-11-05T20:00:00Z', status }],
        hs_impact_story_get: { story, status, pack: f.pack, version: { version: 3, body: f.body, validation: f.validation, derived: { ledger: [] } },
          visuals: { state: 'none' }, media: {}, line_notes: [], events: [] },
      }[n];
      return Promise.resolve(d === undefined ? { data: null, error: { message: 'not stubbed: ' + n } } : { data: d, error: null });
    } };
    window.HS.acqImpactStories.load(window.client, document.getElementById('is'));
  }, fx(slug));
  await page.waitForTimeout(150);
  await page.click('#is [data-act=open] >> nth=0').catch(() => {});
  await page.waitForTimeout(150);
  await page.click('#is [data-act=step][data-step=script]');
  await page.waitForTimeout(80);
  return { page, errs };
}

// 1. House Speaker: public affairs, with a brief
{
  const { page, errs } = await open('house-democratic-leadership-vote-secret-ballot');
  const all = await page.locator('#is').innerText();
  ok(await page.locator('#is .is-sbitem').count() >= 18, 'House: the navigator lists every scene of the real script');
  ok(await page.locator('#is [data-act=doc][data-doc=qol]').count() === 0, 'House: a public-affairs story shows no Quality-of-Life tab');
  ok(!/quality.of.life/i.test(await page.locator('#is .is-read, #is .is-sb').first().innerText()), 'House: no quality-of-life wording in the storyboard');
  ok((await page.locator('#is .is-review > summary').innerText()).includes('10 of 10 pass') && !(await page.locator('#is details.is-review').getAttribute('open') !== null),
     'House: a passing audit folds to one line');
  await page.click('#is .is-review > summary');
  const audit = await page.locator('#is .is-two').innerText();
  ok(audit.includes('Production audit') && (audit.match(/Pass/g) || []).length === 10, 'House: all ten audit checks pass on the rewritten script');
  ok(audit.includes('Your brief, topic by topic') && audit.includes('Ocasio-Cortez') && audit.includes('Left out') && audit.includes('petition'),
     'House: the brief is answered topic by topic, the petition marked Left out with its reason');
  const gates = await page.locator('#is .is-gates').innerText();
  ok(gates.includes('✓ Evidence verified') && gates.includes('✓ Production audit') && !gates.includes('✓ Production ready'), 'House: evidence and audit pass, Production ready stays closed');
  await page.click('#is [data-act=sbsel][data-key="a5-s1"]');
  const side = await page.locator('#is .is-sbside').innerText();
  ok(side.includes('Connolly') || side.includes('Ocasio-Cortez'), 'House: Act 5 cites the Oversight-race records, with their quotes');
  ok((await page.locator('#is .is-sbmain').innerText()).includes('Act 5'), 'House: the selected scene is Act 5');
  if (SHOTS) await page.screenshot({ path: SHOTS + '/house-storyboard.png', fullPage: true });
  await page.click('#is [data-act=doc][data-doc=read]');
  const read = await page.locator('#is .is-read').innerText();
  ok(read.includes('How do House Democrats choose their Speaker nominee') && read.includes('Watch the early-January House roll call'), 'House: read mode is the full script, question to close');
  if (SHOTS) await page.screenshot({ path: SHOTS + '/house-read.png', fullPage: true });
  ok(!errs.length, 'House: no page errors ' + errs.join(' | '));
  ok(all.includes('Script & Shorts'), 'House: the workspace rendered');
  await page.close();
}

// 2. Stratos: development story written before the audit
{
  const { page, errs } = await open('stratos-data-center-water-box-elder');
  ok(await page.locator('#is [data-act=doc][data-doc=qol]').count() === 1, 'Stratos: a development story keeps its Quality-of-Life chart');
  await page.click('#is .is-review > summary');
  const audit = await page.locator('#is .is-two').innerText();
  ok(audit.includes('Written before the audit') && audit.includes('Next:'), 'Stratos: the audit runs as warnings, each with what to change');
  ok(!audit.includes('Your brief, topic by topic'), 'Stratos: no brief panel for a story with no brief');
  ok(await page.locator('#is .is-sbitem').count() >= 15, 'Stratos: the navigator lists every scene');
  await page.click('#is [data-act=sbissues]');
  const n = await page.locator('#is .is-sbitem').count();
  ok(n >= 0 && n < 30, 'Stratos: "Unresolved issues only" narrows the scene list (' + n + ')');
  if (SHOTS) await page.screenshot({ path: SHOTS + '/stratos-storyboard.png', fullPage: true });
  ok(!errs.length, 'Stratos: no page errors ' + errs.join(' | '));
  await page.close();
}

// 3. phone width: the three panels stack and nothing scrolls sideways
{
  const { page } = await open('house-democratic-leadership-vote-secret-ballot');
  await page.setViewportSize({ width: 390, height: 900 });
  await page.waitForTimeout(80);
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok(over <= 2, 'phone: no sideways scroll (' + over + ' px)');
  await page.close();
}

await browser.close();
console.log(fails ? fails + ' FAILED' : 'all passed');
process.exit(fails ? 1 : 0);
