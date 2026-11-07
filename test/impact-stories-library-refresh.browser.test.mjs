// Real Chromium: the Tab 17 library updates by itself while a story is being worked on (founder, 2026-11-07: "the
// update in needs you needs to be automatic once i review and complete an action"). Only the story cards are redrawn,
// so what is typed in the search box stays.
// Run: node test/impact-stories-library-refresh.browser.test.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const fs = require('node:fs');
let fails = 0;
const ok = (c, name) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name); if (!c) fails++; };
const lib = fs.readFileSync(new URL('../lib/acq-impact-stories.js', import.meta.url), 'utf8');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.setContent('<!doctype html><html><body><div id="is"></div></body></html>');
await page.addScriptTag({ content: lib });
await page.evaluate(() => {
  window.listCalls = 0;
  window.story = { id: 's1', title: 'Stratos water application', video_slug: 'stratos', updated_at: '2026-11-07T13:21:00Z', archived: false,
    status: { stage: 'media', owner: 'working', library: 'needs_review', fresh: true,
      next: 'Claude is reading your fix requests and writing a plan (a few minutes). Nothing changes until you confirm it.' } };
  window.client = { rpc: (n) => {
    if (n === 'hs_impact_story_list') window.listCalls++;
    const d = { hs_impact_story_list: [JSON.parse(JSON.stringify(window.story))], hs_impact_story_catalog: [] }[n];
    return Promise.resolve({ data: d === undefined ? [] : d, error: null });
  } };
});
await page.evaluate(() => window.HS.acqImpactStories.load(window.client, document.getElementById('is')));
await page.waitForTimeout(100);
let txt = await page.locator('#is').innerText();
ok(txt.includes('Working on it') && txt.includes('Now: Claude is reading your fix requests'), 'a story being worked on is listed under Working on it');

await page.fill('#is-q', 'strat');
await page.evaluate(() => { window.story.status = { stage: 'media', owner: 'you', library: 'needs_review', fresh: true,
  next: "Read Claude's fix plan in Media review, then press Confirm. Nothing changes until you do." }; });
await page.waitForTimeout(9000);
txt = await page.locator('#is').innerText();
ok(txt.includes("Your next step: Read Claude's fix plan") && txt.includes('Needs you'), 'the card moves to Needs you with the new step, without a reload');
ok(await page.inputValue('#is-q') === 'strat', 'the search box keeps what was typed');
const callsWhenIdle = await page.evaluate(() => window.listCalls);
await page.waitForTimeout(9000);
ok(await page.evaluate(() => window.listCalls) === callsWhenIdle, 'once nothing is being worked on, the library stops asking');

await browser.close();
if (fails) { console.log(fails + ' FAILED'); process.exit(1); }
console.log('all passed');
