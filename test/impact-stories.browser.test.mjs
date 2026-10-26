// Real Chromium: Tab 17 Impact Stories against a stub Supabase client (no network, no credential).
// Library -> workspace -> steps; the story outline (FEAR / ANGER / MOTIVATION + integrated outline); script editor
// dirty/save; the ONE integrated-narrative decision; per-section revision notes; source drawer;
// honest Media / Distribution / Results states; deep link; responsive widths; keyboard focus.
// Run: node test/impact-stories.browser.test.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const fs = require('node:fs');
let fails = 0;
const ok = (c, name) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name); if (!c) fails++; };
const lib = fs.readFileSync(new URL('../lib/acq-impact-stories.js', import.meta.url), 'utf8');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await page.setContent('<!doctype html><html><head><style>:root{--line:#ddd;--panel:#fff;--panel2:#f7f7f7;--ink:#111;--muted:#555;--accent:#157a49;--real:#1f9d5c;--shadow-sm:none}</style></head><body><div id="is"></div></body></html>');
await page.addScriptTag({ content: lib });
await page.evaluate(() => {
  window.calls = [];
  const L = (t, ...c) => ({ text: t, claims: c });
  const body = {
    schema: 'impact-story/2', suitability: 'All three threads are usable.',
    arc: {
      fear: { status: 'needs_qualification', reason: 'Listed species near the site, each with a safeguard.', reason_claims: ['species'],
        beat: L('A new dock in water with listed species.', 'species'), supporting: ['species', 'flood'], counter: ['bubble', 'dns_concl'],
        unknowns: ['The biological studies (not reviewed)'], qualifier: L('The studies behind these safeguards were not reviewed.', 'docs_read'),
        narration: [{ act: 5, ...L('A bubble curtain will be used.', 'bubble') }, { act: 5, ...L('The studies behind these safeguards were not reviewed.', 'docs_read') }] },
      anger: { status: 'omitted', reason: 'The records raise no accountability question.', narration: [] },
      motivation: { status: 'supported', reason: 'The city states the purpose.', beat: L('A working dock for <fishers>.', 'purpose'),
        supporting: ['purpose', 'approved'], counter: ['cost_none'], unknowns: [], narration: [{ act: 1, ...L('Line of act 1.', 'approved') }] },
    },
    outline: [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ act: n, name: 'Act ' + n, threads: n === 5 ? ['fear'] : n === 1 ? ['motivation'] : ['context'], summary: 'Summary ' + n, claims: [] })),
    main: { acts: [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ act: n, name: 'Act ' + n, scenes: [{ thread: n === 5 ? 'fear' : 'context', purpose: 'p' + n, visual: { kind: 'source_document', desc: 'crop', layout: 'evidence_reveal' }, narration: [L('Line of act ' + n + '.', 'approved')] }] })) },
    qol: ['Traffic', 'Noise', 'Air', 'Water', 'Soil', 'Light'].map((t) => ({ topic: t, status: t === 'Soil' ? 'not_addressed' : 'addressed', summary: L(t + ' summary.', t === 'Soil' ? undefined : 'roads') })),
    shorts: { a: { question: 'Who?', emotion: 'MOTIVATION', title: 'Who gets it?', description: L('d', 'purpose'), beats: ['hook', 'answer', 'evidence', 'next'].map((b) => ({ beat: b, narration: [L(b + ' line', 'purpose')], visual: { kind: 'illustrative', desc: 'card' } })) },
      b: null, b_exception: 'Only one defensible question.' },
    packaging: { titles: [L('Who gets the dock?', 'purpose')], thumbnail: L('Who gets the new dock?', 'purpose'), description: L('Approved dock.', 'approved'), bluesky: { hook: L('Approved dock.', 'approved') } },
  };
  const art = (state, why, ld) => ({ state, why, last_decision: ld || null });
  window.db = {
    version: 7,
    status: () => ({ stage: 'script', next: 'Review and approve the integrated narrative', library: 'needs_review', fresh: window.db.fresh !== false,
      artifacts: { narrative: art(window.db.nstate || 'blocked', window.db.nwhy || 'Short A: Short A next line 1: promises a link.', { decision: 'approved', version: 6, actor: 'f@x', at: '2026-10-25T10:00:00Z' }) },
      job: window.db.job }),
    job: { id: 'j1', kind: 'generate', status: 'failed', error: 'The AI drafting key is not configured on the worker.', attempts: 1, created_at: '2026-10-25T10:00:00Z' },
  };
  const v6 = JSON.parse(JSON.stringify(body)); v6.main.acts[2].scenes[0].narration[0].text = 'Old wording of act 3.';
  const pack = { title: 'Gig Harbor dock', verified_at: '2026-10-24T21:43:29Z', age_days: 1, fresh_days: 30, record_id: '202601747',
    sources: [{ id: 'nod', label: 'Notice of decision', url: 'https://example.gov/nod' }, { id: 'x', label: 'Scanned DNS', url: null }],
    claims: ['approved', 'purpose', 'dns_concl', 'schedule', 'neighbors', 'roads'].map((id) => ({ id, status: 'stated', text: id, quote: 'Quote for ' + id, source_label: 'Notice of decision', source_url: 'https://example.gov/nod' })),
    conflicts: [{ claims: ['dns_size', 'nod_size'], reason: 'Two documents state this differently.' }], warnings: ['Not reviewed: the scanned DNS'], editor_notes: ['Sizes differ.'] };
  const derived = { ledger: [{ where: 'Act 1.1', line: 'Line of act 1.', claim: 'approved', status: 'stated', quote: 'Quote for approved', source: 'Notice', url: 'https://example.gov/nod' }],
    variants: { variants: [{ destination: 'youtube', asset: 'main', format: '16:9', title: 'Who gets the dock?', description: 'desc', publish: 'manual' },
      { destination: 'tiktok', asset: 'short_a', format: '9:16', title: 't', caption: 'c #JODYTracks', connection: 'not_connected', publish: 'manual' },
      { destination: 'bluesky', asset: 'post', format: 'text', text: 'Approved dock.\n\nFull investigation: (pending)', chars: 40, fits: true, full_video_pending: true, publish: 'manual' }] } };
  window.client = { rpc: (n, a) => {
    window.calls.push([n, a]);
    const d = {
      hs_impact_story_list: [{ id: 's1', title: 'Gig Harbor <dock>', video_slug: 'gig-harbor-fishing-homeport-dock', primary_emotion: 'MOTIVATION', updated_at: '2026-10-25T10:00:00Z', verified_at: '2026-10-24T21:43:29Z', archived: false, status: window.db.status() },
        { id: 's2', title: 'Old story', video_slug: 'x', archived: true, updated_at: '2026-10-01T00:00:00Z', status: { library: 'archived', next: 'Archived.' } }],
      hs_impact_story_catalog: [{ slug: 'gig-harbor-fishing-homeport-dock', title: '3003 Gig Harbor' }],
      hs_impact_story_get: { story: { id: 's1', title: 'Gig Harbor <dock>', video_slug: 'gig-harbor-fishing-homeport-dock', current_version: window.db.version }, pack, status: window.db.status(),
        version: { version: window.db.version, body: JSON.parse(JSON.stringify(body)), checked: true, derived,
          validation: { arc: { fear: { ok: true, blocking: [], warnings: [] }, anger: { ok: true, blocking: [] }, motivation: { ok: false, blocking: ['MOTIVATION: none of its counterevidence (cost_none) is spoken.'] } },
            outline: { ok: true, blocking: [] }, short_a: { ok: false, blocking: ['Short A next line 1: promises a link.'] }, main: { ok: true, blocking: [], warnings: [] },
            narrative: { ok: false, blocking: ['Short A: Short A next line 1: promises a link.'] } } },
        versions: [{ version: 7 }, { version: 6 }], approvals: [], jobs: [], events: [{ at: '2026-10-25T10:00:00Z', kind: 'job_failed', actor: 'worker', detail: {} },
          { at: '2026-10-25T11:00:00Z', kind: 'section_revision', actor: 'f@x', detail: { section: 'fear', version: 7, note: 'Name the <floodplain> earlier.' } }] },
      hs_impact_story_version: { version: 6, body: v6 },
      hs_impact_story_save: { version: 8, job: { status: 'queued' } },
      hs_impact_story_request: { job_id: 'j2', status: 'queued', existing: false },
      hs_impact_story_create: { story_id: 's1' },
      hs_impact_story_section_revision: { recorded: true },
    }[n];
    if (n === 'hs_impact_story_save') window.db.version = 8;
    return Promise.resolve({ data: d === undefined ? {} : d, error: null });
  } };
  window.confirm = () => true;
  window.prompt = () => 'Lead with the date.';
});

await page.evaluate(() => window.HS.acqImpactStories.load(window.client, document.getElementById('is')));
await page.waitForTimeout(50);
let txt = await page.locator('#is').innerText();
ok(txt.includes('Gig Harbor <dock>') && !txt.includes('Old story'), 'library: a story card is shown, archived ones are filtered out by default');
ok(txt.includes('Next: Review and approve'), 'library: the card says the NEXT action');
ok(await page.locator('#is [data-act=dup]').count() === 1 && await page.locator('#is [data-act=archive]').count() === 1, 'library: Duplicate and Archive exist');
ok((await page.innerHTML('#is')).includes('Gig Harbor &lt;dock&gt;'), 'library: titles are escaped');
await page.click('#is [data-act=filter][data-f=archived]');
ok((await page.locator('#is').innerText()).includes('Old story'), 'library: the Archived filter shows archived stories');
await page.click('#is [data-act=filter][data-f=published]');
ok((await page.locator('#is').innerText()).includes('not built yet'), 'library: the Published filter says plainly why it is empty');
await page.click('#is [data-act=filter][data-f=all]');
await page.click('#is [data-act=new]');
ok(await page.locator('#is-new-slug option').count() === 1, 'new story: verified projects are offered');
await page.click('#is [data-act=create]'); await page.waitForTimeout(80);
ok(await page.evaluate(() => window.calls.some((c) => c[0] === 'hs_impact_story_create' && c[1].p_video_slug === 'gig-harbor-fishing-homeport-dock')), 'new story: create calls the gated function with the project');
ok(await page.evaluate(() => location.hash.startsWith('#impact=s1&step=intake')), 'workspace: the URL keeps the story and step');

txt = await page.locator('#is').innerText();
ok(txt.includes('sources checked 2026-10-24') && txt.includes('Saved'), 'workspace header: source freshness and save state');
ok(txt.includes('Failed (attempt 1): The AI drafting key is not configured') && await page.locator('#is [data-act=retry]').count() === 1, 'a failed job says what failed and offers Retry');
ok(txt.includes('no public link') && txt.includes('Documents that disagree') && txt.includes('Not reviewed'), 'intake: missing links, conflicts and unreviewed records are shown');
ok(await page.locator('#is .is-step').count() === 6, 'stepper: six steps');

await page.click('#is [data-act=step][data-step=outline]');
txt = await page.locator('#is').innerText();
ok(await page.locator('#is .is-step').nth(1).innerText().then((t) => t.includes('Story Outline')), 'stepper: step 2 is the Story Outline');
ok(['FEAR', 'ANGER', 'MOTIVATION'].every((x) => txt.includes(x)) && txt.includes('What could affect residents?') && txt.includes('What deserves scrutiny?') && txt.includes('What can residents do?'),
   'outline: all three sections are always shown, each with its question');
ok(txt.includes('Needs qualification') && txt.includes('Supported') && txt.includes('Omitted'), 'outline: each section shows its evidence status');
ok(txt.includes('Proposed hook or story beat') && txt.includes('Supporting source records') && txt.includes('Counterevidence and mitigating facts') && txt.includes('Proposed narration'),
   'outline: beat, supporting records, counterevidence and proposed narration');
ok(txt.includes('The studies behind these safeguards were not reviewed.') && txt.includes('Its limit, spoken out loud'), 'outline: a qualified section shows its spoken limit');
ok(txt.includes('Left out of the script') && txt.includes('raise no accountability question'), 'outline: an omitted section says why, and offers no narration');
ok(txt.includes('none of its counterevidence (cost_none) is spoken') && txt.includes('Fails evidence checks'), 'outline: a section that fails a check says why');
ok(txt.includes('Integrated outline') && txt.includes('Total') && (await page.locator('#is .is-thr.fear').count()) >= 1, 'outline: the integrated outline shows threads per act and a running time');
ok(await page.locator('#is button:has-text("Use this angle")').count() === 0 && await page.locator('#is [data-act=angle]').count() === 0, 'outline: there is no single-angle choice');
ok(txt.includes('Name the <floodplain> earlier.') && (await page.innerHTML('#is')).includes('Name the &lt;floodplain&gt; earlier.'), 'outline: revision notes are shown, escaped');
await page.click('#is [data-act=revise][data-sec=anger]'); await page.waitForTimeout(50);
ok(await page.evaluate(() => window.calls.some((c) => c[0] === 'hs_impact_story_section_revision' && c[1].p_section === 'anger' && c[1].p_note === 'Lead with the date.' && c[1].p_expected_version === 7)),
   'outline: Request revision sends the section, the note and the version');
ok((await page.locator('#is').innerText()).includes('Revision note saved'), 'outline: the revision note is confirmed');

await page.click('#is [data-act=step][data-step=script]');
txt = await page.locator('#is').innerText();
ok(txt.includes('First 30 seconds') && txt.includes('Act 8'), 'script: eight acts and the first 30 seconds');
ok(await page.locator('#is [data-act=decide][data-a=narrative][data-d=approved]').count() === 1 && await page.locator('#is [data-act=decide]:not([data-a=narrative])').count() === 0,
   'script: ONE approval, the integrated narrative, and no per-part approvals');
ok(await page.locator('#is [data-act=decide][data-a=narrative][data-d=approved]').isDisabled() && txt.includes('promises a link'), 'script: a blocked narrative cannot be approved, and says why');
ok(txt.includes('changed since approved'), 'script: a line changed since the approved version is marked');
await page.click('#is [data-act=diff][data-a=narrative]');
ok((await page.locator('#is .is-drawer').innerText()).includes('Old wording of act 3.'), 'script: compare with the approved version shows the old wording');
await page.click('#is [data-act=claim][data-id=approved] >> nth=0');
ok((await page.locator('#is .is-drawer').innerText()).includes('Quote for approved'), 'source drawer: a claim opens its quote and document');
const before = await page.evaluate(() => window.calls.filter((c) => c[0] === 'hs_impact_story_save').length);
await page.fill('#is textarea[data-ed="main.acts.0.scenes.0.narration.0.text"]', 'Edited first line.');
ok((await page.locator('#is').innerText()).includes('Unsaved changes'), 'editor: typing marks unsaved changes');
ok(await page.locator('#is [data-act=decide][data-d=approved]').first().isDisabled(), 'editor: approve is disabled while there are unsaved changes');
ok(await page.evaluate(() => window.calls.filter((c) => c[0] === 'hs_impact_story_save').length) === before, 'editor: nothing is saved without Save');
await page.click('#is .is-panel [data-act=save]'); await page.waitForTimeout(80);
const save = await page.evaluate(() => window.calls.filter((c) => c[0] === 'hs_impact_story_save').pop());
ok(save && save[1].p_expected_version === 7 && save[1].p_body.main.acts[0].scenes[0].narration[0].text === 'Edited first line.', 'save: the edit is sent with the expected version (optimistic lock)');
ok((await page.locator('#is').innerText()).includes('Saved as version 8'), 'save: visible confirmation');

await page.click('#is [data-act=doc][data-doc=short_a]');
ok((await page.locator('#is').innerText()).includes('promises a link'), 'Short A: its blocking check is shown');
await page.click('#is [data-act=doc][data-doc=short_b]');
ok((await page.locator('#is').innerText()).includes('Editorial exception — second Short unavailable'), 'Short B: the exception is shown, nothing invented');
await page.click('#is [data-act=revise][data-sec=short_b]'); await page.waitForTimeout(50);
ok(await page.evaluate(() => window.calls.some((c) => c[0] === 'hs_impact_story_section_revision' && c[1].p_section === 'short_b')), 'Short B: a revision note names its part');
await page.evaluate(() => { window.db.nstate = 'pending'; window.db.nwhy = 'Ready for your decision.'; });
await page.click('#is [data-act=step][data-step=intake]'); await page.click('#is [data-act=step][data-step=script]');
await page.evaluate(() => window.HS.acqImpactStories.load(window.client, document.getElementById('is'))); await page.waitForTimeout(80);
await page.click('#is [data-act=decide][data-a=narrative][data-d=rejected]'); await page.waitForTimeout(50);
ok(await page.evaluate(() => window.calls.some((c) => c[0] === 'hs_impact_story_decide' && c[1].p_artifact === 'narrative' && c[1].p_decision === 'rejected' && c[1].p_note === 'Lead with the date.' && c[1].p_target)), 'reject: the note and its target line are sent');
await page.click('#is [data-act=decide][data-a=narrative][data-d=approved]'); await page.waitForTimeout(50);
ok(await page.evaluate(() => window.calls.some((c) => c[0] === 'hs_impact_story_decide' && c[1].p_artifact === 'narrative' && c[1].p_decision === 'approved' && c[1].p_expected_version === 8)), 'approve: one call approves the integrated narrative on the current version');

await page.click('#is [data-act=step][data-step=media]');
ok((await page.locator('#is').innerText()).includes('Not built yet'), 'media: honestly not built; no render button');
ok(await page.locator('#is button:has-text("Render")').count() === 0, 'media: there is no Render button');
await page.click('#is [data-act=step][data-step=distribution]');
txt = await page.locator('#is').innerText();
ok(txt.includes('Not published') && txt.includes('Not connected') && txt.includes('Full video URL pending') && txt.includes('unavailable'), 'distribution: not published / not connected / pending URL / publishing unavailable');
ok(await page.locator('#is [data-act=export]').isDisabled(), 'distribution: export stays locked until every approval is in place');
ok(!/publish now|schedule post/i.test(txt), 'distribution: no publish or schedule action');
await page.click('#is [data-act=step][data-step=results]');
txt = await page.locator('#is').innerText();
ok(txt.includes('Not published') && !/\b0\b/.test(txt.replace(/0-3|utm|impact-/g, '')), 'results: nothing is shown as zero');

// keyboard + responsive
await page.focus('#is [data-act=step][data-step=intake]');
await page.keyboard.press('Enter'); await page.waitForTimeout(30);
ok(await page.locator('#is [data-step=intake][aria-current=step]').count() === 1, 'keyboard: a step opens with Enter');
for (const w of [1440, 1024, 390]) {
  await page.setViewportSize({ width: w, height: 900 });
  const ov = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok(ov <= 1, 'no horizontal page scroll at ' + w + 'px (overflow ' + ov + ')');
}
// deep link reopen
await page.evaluate(() => { location.hash = '#impact=s1&step=outline'; window.HS.acqImpactStories._state.open = null; window.HS.acqImpactStories._state.data = null; });
await page.evaluate(() => window.HS.acqImpactStories.load(window.client, document.getElementById('is'))); await page.waitForTimeout(80);
ok(await page.locator('#is [data-step=outline][aria-current=step]').count() === 1, 'reload: the deep link reopens the same story and step');
await browser.close();
console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
process.exit(fails ? 1 : 0);
