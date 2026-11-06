// Real Chromium: Tab 17 "Create another video from this research" (founder, 2026-11-06). The EPA methane investigation and a
// "how to register to speak before November 10" tutorial are two videos sharing one verified research pack: the library
// shows the tutorial first (approaching deadline) with its objective and the research it shares; the workspace lists both
// videos; the button sends exactly one gated call with the chosen objective, title, deadline and links, and survives a
// re-render while the founder types. Run: node test/impact-stories-another-video.browser.test.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const fs = require('node:fs');
let fails = 0;
const ok = (c, name) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name); if (!c) fails++; };
const read = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.setContent('<!doctype html><html><head><style>:root{--line:#ddd;--panel:#fff;--panel2:#f7f7f7;--ink:#111;--muted:#555;--accent:#157a49}</style></head><body><div id="is"></div></body></html>');
await page.addScriptTag({ content: read('lib/acq-impact-discovery.js') });   // defines HS.impactVideo (the shared labels)
await page.addScriptTag({ content: read('lib/acq-impact-stories.js') });
await page.evaluate(() => {
  window.calls = [];
  const soon = new Date(Date.now() + 4 * 864e5).toISOString().slice(0, 10);
  const st = (next) => ({ stage: 'intake', next, library: 'needs_review', fresh: true, artifacts: {}, owner: 'you' });
  const inv = { id: 'inv', title: 'EPA proposes to end the Methane Super Emitter Program', video_slug: 'epa-super-emitter', objective: 'investigative',
    research_of: null, deadline: null, current_version: 3, updated_at: '2026-11-06T15:00:00Z', verified_at: '2026-11-06T14:58:15Z', status: st('Review and approve the integrated narrative') };
  const tut = { id: 'tut', title: 'EPA Methane Hearing: How to Register to Speak Before November 10', video_slug: 'epa-super-emitter--register-to-speak',
    objective: 'participation', research_of: 'inv', research_title: inv.title, deadline: soon, current_version: 0, updated_at: '2026-11-06T16:00:00Z',
    verified_at: '2026-11-06T16:00:00Z', status: st('Check the sources') };
  const videos = [{ id: 'inv', title: inv.title, objective: 'investigative', original: true, current: true, next: 'Review and approve the integrated narrative' },
    { id: 'tut', title: tut.title, objective: 'participation', deadline: soon, original: false, current: false, next: 'Check the sources' }];
  window.client = { rpc: (n, a) => {
    window.calls.push([n, a]);
    const d = {
      hs_impact_story_list: [tut, inv],
      hs_impact_story_catalog: [],
      hs_impact_story_get: { story: Object.assign({}, inv), pack: { title: 'EPA methane', verified_at: inv.verified_at, sources: [], claims: [], conflicts: [], warnings: [] },
        status: inv.status, media: { files: [] }, visuals: { state: 'none' }, line_notes: [], version: null, versions: [], approvals: [], jobs: [], events: [],
        research_videos: videos },
      hs_impact_story_another_video: { candidate_id: 'c9', research: { status: 'queued' } },
      hs_impact_discovery_overview: { candidates: [], recent_scans: [], exclusions: [], settings: {}, performance: {}, learning: {} },
    }[n];
    return Promise.resolve({ data: d === undefined ? {} : d, error: null });
  } };
  window.confirm = () => true;
});
await page.evaluate(() => window.HS.acqImpactStories.load(window.client, document.getElementById('is')));
await page.waitForTimeout(80);
let txt = await page.locator('#is').innerText();
ok(txt.indexOf('How to Register to Speak') >= 0 && txt.indexOf('How to Register to Speak') < txt.indexOf('EPA proposes to end'), 'library: the video with the approaching deadline is listed first');
ok(/Public participation/.test(txt) && /Deadline \d{4}-\d{2}-\d{2} \(4 days\)/.test(txt), 'library: the tutorial shows its objective and its deadline');
ok(txt.includes('Shares verified research with “EPA proposes to end the Methane Super Emitter Program”'), 'library: the tutorial names the research it shares');

await page.click('#is [data-act=open][data-id=inv]'); await page.waitForTimeout(80);
txt = await page.locator('#is').innerText();
ok(txt.includes('Videos from this research (2)') && txt.includes('original research'), 'workspace: both videos from the research are listed, the original marked');
ok(await page.locator('#is .is-sec button[data-act=open][data-id=tut]').count() === 1, 'workspace: the other video opens from the list (its own story)');
await page.click('#is [data-act=another]');
const opts = await page.locator('#is-av-objective option').evaluateAll((os) => os.map((o) => o.value));
ok(!opts.includes('investigative') && !opts.includes('participation') && opts.includes('education') && opts.includes('follow_up'),
  'form: only objectives that do not exist yet for this research are offered (' + opts.join(', ') + ')');
await page.selectOption('#is-av-objective', 'education');
await page.fill('#is-av-title', 'How to submit a written comment on the methane rule');
await page.fill('#is-av-deadline', '2026-12-16');
await page.fill('#is-av-links', 'https://www.regulations.gov/docket/EPA-HQ-OAR-2025-0163\nhttps://www.epa.gov/x');
await page.evaluate(() => window.HS.acqImpactStories && window.HS.acqImpactStories.load(window.client, document.getElementById('is')));   // a poll re-render
await page.waitForTimeout(80);
ok(await page.inputValue('#is-av-title') === 'How to submit a written comment on the methane rule' && await page.inputValue('#is-av-objective') === 'education',
  'form: what the founder typed survives a re-render');
await page.click('#is [data-act=anothersend]'); await page.waitForTimeout(80);
const sent = await page.evaluate(() => window.calls.filter((c) => c[0] === 'hs_impact_story_another_video'));
ok(sent.length === 1 && sent[0][1].p_story === 'inv' && sent[0][1].p_video.objective === 'education' && sent[0][1].p_video.deadline === '2026-12-16'
  && sent[0][1].p_video.links.length === 2, 'send: one gated call with the objective, title, deadline and links');
txt = await page.locator('#is').innerText();
ok(txt.includes('This story is not changed') && await page.locator('#is-av-title').count() === 0, 'send: the page says research started and closes the form');
ok(!(await page.evaluate(() => window.calls.some((c) => /save|decide|render/.test(c[0])))), 'send: nothing on the original story is saved, approved or rendered');
await page.setViewportSize({ width: 390, height: 800 });
ok(await page.evaluate(() => document.documentElement.scrollWidth <= 390), 'phone: no sideways scroll');
ok(errors.length === 0, 'no page errors ' + errors.join(' | '));
await browser.close();
console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
process.exit(fails ? 1 : 0);
