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
      hs_impact_story_get: { media: window.db.media || { render_job: null, files: [] }, visuals: window.db.visuals || { state: 'none', why: 'Prepare the visuals.' }, story: { id: 's1', title: 'Gig Harbor <dock>', video_slug: 'gig-harbor-fishing-homeport-dock', current_version: window.db.version }, pack, status: window.db.status(),
        version: { version: window.db.version, body: Object.assign(JSON.parse(JSON.stringify(body)), (window.db.extra || {}).body || {}), checked: true, derived,
          validation: { arc: { fear: { ok: true, blocking: [], warnings: [] }, anger: { ok: true, blocking: [] }, motivation: { ok: false, blocking: ['MOTIVATION: none of its counterevidence (cost_none) is spoken.'] } },
            outline: { ok: true, blocking: [] }, short_a: { ok: false, blocking: ['Short A next line 1: promises a link.'] }, main: { ok: true, blocking: [], warnings: [] },
            narrative: { ok: false, blocking: ['Short A: Short A next line 1: promises a link.'] }, v3: (window.db.extra || {}).v3 } },
        versions: [{ version: 7 }, { version: 6 }], approvals: [], jobs: [], events: [{ at: '2026-10-25T10:00:00Z', kind: 'job_failed', actor: 'worker', detail: {} },
          { at: '2026-10-25T11:00:00Z', kind: 'section_revision', actor: 'f@x', detail: { section: 'fear', version: 7, note: 'Name the <floodplain> earlier.' } }] },
      hs_impact_story_version: { version: 6, body: v6 },
      hs_impact_story_save: { version: 8, job: { status: 'queued' } },
      hs_impact_story_request: { job_id: 'j2', status: 'queued', existing: false },
      hs_impact_story_create: { story_id: 's1' },
      hs_impact_story_section_revision: { recorded: true },
      hs_impact_story_visuals_prepare: { job_id: 'jv', status: 'queued', existing: false },
      hs_impact_story_visuals_approve: { ok: true },
    }[n];
    if (n === 'hs_impact_story_save') window.db.version = 8;
    return Promise.resolve({ data: d === undefined ? {} : d, error: null });
  } };
  window.client.storage = { from: (b) => ({ download: (p) => { window.calls.push(['download', b, p]); return Promise.resolve({ data: new Blob(['x'], { type: 'video/mp4' }), error: null }); } }) };
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
ok(await page.locator('#is .is-step').count() === 7, 'stepper: seven steps (Visuals sits between Script & Shorts and Media Review)');

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
ok(!txt.includes('What residents could lose') && !txt.includes('Three story concepts'), 'outline: a v2 story shows no V3 panels');
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
ok((await page.locator('#is').innerText()).includes('needs the one editorial approval') && await page.locator('#is [data-act=render]').count() === 0,
   'media: no Render button before the narrative is approved');
await page.evaluate(() => { window.db.nstate = 'approved'; window.db.nwhy = 'Approved on version 8.'; window.HS.acqImpactStories.load(window.client, document.getElementById('is')); });
await page.waitForTimeout(80);
ok((await page.locator('#is').innerText()).includes('Approve the visuals first') && await page.locator('#is .is-panel [data-act=render]').count() === 0,
   'media: before the visuals are approved, Render is replaced by a way to the Visuals step');

// VISUALS (P2): one still per shot, the exceptions first, ONE approval for the whole set
await page.click('#is [data-act=step][data-step=visuals]'); await page.waitForTimeout(50);
await page.click('#is .is-panel [data-act=vprep]'); await page.waitForTimeout(50);
ok(await page.evaluate(() => window.calls.some((c) => c[0] === 'hs_impact_story_visuals_prepare' && c[1].p_expected_version === 8 && c[1].p_new === false)),
   'visuals: Prepare queues one visuals job for the current approved version');
await page.evaluate(() => {
  const P = (k, i) => ({ path: 's1/visuals/jv/preview-' + k + '-00' + i + '.jpg', frame: 10 * i });
  const rec = { license: 'CC BY 4.0', title: 'File:Oak.jpg', page_url: 'https://commons.wikimedia.org/wiki/File:Oak.jpg' };
  window.db.visuals = { state: 'ready', why: 'Every shot passed the checks. Look them over, then Approve all visuals.', manifest_id: 41, manifest_hash: 'a'.repeat(64),
    created_at: '2026-10-29T20:00:00Z', counts: { clear: 3, flagged: 1, blocked: 0 }, manifest_job_id: 'jv', job: { id: 'jv-newer', status: 'failed' },
    manifest: { timing: { total_s: 640 }, identity: { same: true },
      assets: { main: { shots: [
        { id: 'a1-s1', act: 1, act_name: 'Attachment', status: 'clear', label: 'REPRESENTATIVE PHOTO · NOT THIS SITE', onscreen: 'A dock for <fishers>', preview: P('main', 0), photo: { id: 'oak', credit: 'Oak: A. Person, CC BY 4.0', record: rec } },
        { id: 'a2-s1', act: 2, act_name: 'Disruption', status: 'flagged', label: 'ILLUSTRATION · NOT A PICTURE OF THE SITE', preview: P('main', 1), reasons: ['An illustration stands where the plan wanted a photo (trees).'], illustration: { category: 'trees', missing: true } }] },
        short_a: { shots: [{ id: 'short_a-hook', beat: 'hook', status: 'clear', label: 'MAP', preview: P('short_a', 0), map: true }] },
        thumbnail: { shots: [{ id: 'thumbnail', status: 'clear', label: 'PHOTO', preview: P('thumbnail', 0) }] } },
      alternatives: [{ subject_id: 'oak-trees', subject: 'Oak trees', candidates: [{ id: 'oak-2', title: 'File:Oak2.jpg', license: 'CC BY-SA 4.0', author: 'B', page_url: 'https://commons.wikimedia.org/wiki/File:Oak2.jpg', preview: { path: 's1/visuals/jv/cand-x.jpg' } }] }] } };
  window.db.baseStatus = window.db.status;
  window.db.status = ((st) => () => Object.assign(st(), { stage: 'visuals', next: 'Review the visuals, then Approve all visuals' }))(window.db.status);
  window.HS.acqImpactStories.load(window.client, document.getElementById('is'));
});
await page.waitForTimeout(150);
let vt = await page.locator('#is').innerText();
ok(vt.includes('Needs your attention (1)') && vt.includes('An illustration stands where the plan wanted a photo'), 'visuals: the shots that need you are listed first, with why');
ok(vt.includes('3 clear · 1 to look at · 0 blocked') && vt.includes('Approve all visuals (4 shots)'), 'visuals: the counts and ONE approve action for the whole set');
ok(await page.evaluate(() => ['s1/visuals/jv/preview-main-000.jpg', 's1/visuals/jv/preview-main-001.jpg', 's1/visuals/jv/cand-x.jpg']
   .every((p) => window.calls.some((c) => c[0] === 'download' && c[1] === 'impact-media' && c[2] === p))),
   'visuals: the previews on screen are downloaded with the admin session (blob links)');
ok(await page.evaluate(() => !window.calls.some((c) => c[0] === 'download' && c[2] === 's1/visuals/jv/preview-short_a-000.jpg')), 'visuals: previews of other videos load only when opened');
ok(await page.locator('#is img[src^="blob:"]').count() >= 3 && (await page.innerHTML('#is')).includes('A dock for &lt;fishers&gt;'), 'visuals: previews show from blob links; text is escaped');
await page.click('#is [data-act=vtab][data-k=short_a]'); await page.waitForTimeout(120);
ok((await page.locator('#is').innerText()).includes('short_a-hook') && await page.evaluate(() => window.calls.some((c) => c[0] === 'download' && c[2] === 's1/visuals/jv/preview-short_a-000.jpg')),
   'visuals: Short A shows its own shots');
await page.click('#is [data-act=choose][data-id=oak-2]'); await page.waitForTimeout(50);
ok(await page.evaluate(() => window.calls.some((c) => c[0] === 'hs_impact_story_choose_asset' && c[1].p_job === 'jv' && c[1].p_subject === 'oak-trees' && c[1].p_candidate === 'oak-2')),
   'visuals: another licensed photo is one click, from the job that made the manifest shown (not a newer failed job)');
// A preview that cannot be downloaded is tried once, says so, and is tried again only on request (no redraw loop).
await page.evaluate(() => {
  window.prevStorage = window.client.storage;
  window.client.storage = { from: (b) => ({ download: (p) => { window.calls.push(['download', b, p]);
    if (p === 's1/visuals/jv/preview-short_b-000.jpg') return Promise.resolve({ data: null, error: new Error('Object not found') });
    return window.prevStorage.from(b).download(p); } }) };
  window.db.visuals.manifest.assets.short_b = { shots: [{ id: 'short_b-hook', beat: 'hook', status: 'clear', label: 'MAP', preview: { path: 's1/visuals/jv/preview-short_b-000.jpg', frame: 0 }, map: true }] };
  window.HS.acqImpactStories.load(window.client, document.getElementById('is'));
});
await page.waitForTimeout(150);
await page.click('#is [data-act=vtab][data-k=short_b]'); await page.waitForTimeout(400);
const nFail = await page.evaluate(() => window.calls.filter((c) => c[0] === 'download' && c[2] === 's1/visuals/jv/preview-short_b-000.jpg').length);
ok(nFail === 1 && (await page.locator('#is').innerText()).includes('Preview could not be loaded'), 'visuals: a failed preview download is tried once and says so (' + nFail + ' tries)');
await page.click('#is [data-act=vretry]'); await page.waitForTimeout(300);
ok(await page.evaluate(() => window.calls.filter((c) => c[0] === 'download' && c[2] === 's1/visuals/jv/preview-short_b-000.jpg').length) === 2,
   'visuals: "Try the previews again" tries a failed preview exactly once more');
await page.evaluate(() => { window.client.storage = window.prevStorage; });
await page.click('#is [data-act=vtab][data-k=main]'); await page.waitForTimeout(50);
await page.locator('#is .is-panel [data-act=vapprove]').last().focus();
await page.keyboard.press('Enter'); await page.waitForTimeout(50);
ok(await page.evaluate(() => window.calls.some((c) => c[0] === 'hs_impact_story_visuals_approve' && c[1].p_manifest_id === 41 && c[1].p_expected_hash === 'a'.repeat(64))),
   'visuals: Approve all visuals (keyboard) sends the manifest the page showed');
// Use your own photo (plan v3 §6.3): straight into the story's private uploads folder, then recorded with its checksum.
// setContent pages are not a secure context, so the browser hides crypto.subtle and randomUUID (the https dashboard has
// both): give this page Node's SHA-256 behind the same calls.
await page.exposeFunction('__nodeSha256', async (bytes) => (await import('node:crypto')).createHash('sha256').update(Buffer.from(bytes)).digest('hex'));
await page.evaluate(() => {
  Object.defineProperty(window.crypto, 'subtle', { configurable: true, value: { digest: async (alg, buf) => {
    const h = await window.__nodeSha256(Array.from(new Uint8Array(buf)));
    return new Uint8Array(h.match(/../g).map((x) => parseInt(x, 16))).buffer; } } });
  Object.defineProperty(window.crypto, 'randomUUID', { configurable: true, value: () => '1b2c3d4e-0000-4000-8000-00000000abcd' });
});
await page.evaluate(() => {
  window.db.extra = { body: { discovery: { subjects: [{ id: 'oak-trees', subject: 'Oak trees', category: 'trees' }] } } };
  window.prevStorage2 = window.client.storage;
  window.client.storage = { from: (b) => ({ download: (p) => window.prevStorage2.from(b).download(p),
    upload: (p, f, o) => { window.calls.push(['upload', b, p, o && o.contentType, o && o.upsert, f.size]); return Promise.resolve({ data: { path: p }, error: null }); } }) };
  window.HS.acqImpactStories.load(window.client, document.getElementById('is'));
});
await page.waitForTimeout(150);
ok((await page.locator('#is').innerText()).includes('Use your own photo') && await page.locator('#is #is-up-subj option').count() === 1,
   'upload: the Visuals step offers your own photo for each of the story\'s subjects');
const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8]);
const { createHash } = await import('node:crypto');
const jpgSha = createHash('sha256').update(jpg).digest('hex');
await page.setInputFiles('#is #is-up-file', { name: 'oak.jpg', mimeType: 'image/jpeg', buffer: jpg });
await page.fill('#is #is-up-credit', 'J. Founder');
await page.click('#is [data-act=vupload]'); await page.waitForTimeout(120);
ok((await page.locator('#is').innerText()).includes('Confirm that you own this photo') && !(await page.evaluate(() => window.calls.some((c) => c[0] === 'upload'))),
   'upload: nothing is uploaded until the permission statement is confirmed');
await page.setInputFiles('#is #is-up-file', { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
await page.check('#is #is-up-perm');
await page.click('#is [data-act=vupload]'); await page.waitForTimeout(120);
ok((await page.locator('#is').innerText()).includes('Upload a JPEG or PNG photo') && !(await page.evaluate(() => window.calls.some((c) => c[0] === 'upload'))),
   'upload: a file that is not a JPEG or PNG is refused before upload');
await page.setInputFiles('#is #is-up-file', { name: 'oak.jpg', mimeType: 'image/jpeg', buffer: jpg });
ok(await page.inputValue('#is #is-up-credit') === 'J. Founder', 'upload: the form keeps what was typed after an error');
await page.check('#is #is-up-perm');
await page.click('#is [data-act=vupload]'); await page.waitForTimeout(200);
const up = await page.evaluate(() => window.calls.find((c) => c[0] === 'upload'));
const rec = await page.evaluate(() => (window.calls.find((c) => c[0] === 'hs_impact_story_upload_photo') || [])[1]);
ok(up && up[1] === 'impact-media' && /^s1\/uploads\/[0-9a-f-]{36}\.jpg$/.test(up[2]) && up[3] === 'image/jpeg' && up[4] === false && up[5] === jpg.length,
   'upload: the file goes into this story\'s private uploads folder as a new JPEG');
ok(rec && rec.p_story === 's1' && rec.p_subject === 'oak-trees' && up[2].endsWith('/' + rec.p_upload + '.jpg') && rec.p_mime === 'image/jpeg'
   && rec.p_sha256 === jpgSha && rec.p_credit === 'J. Founder' && rec.p_shows_site === false && rec.p_permission === true,
   'upload: it is recorded with the same id, its checksum, the credit and the permission statement');
ok((await page.locator('#is').innerText()).includes('Photo added. Prepare the visuals again'), 'upload: the page says what to do next');
// Codex #2400: the panel is redrawn by the page's own refresh, and must not lose what was chosen and typed.
await page.evaluate(() => { window.calls.length = 0; });
await page.setInputFiles('#is #is-up-file', { name: 'oak.jpg', mimeType: 'image/jpeg', buffer: jpg });
await page.fill('#is #is-up-credit', 'K. Founder');
await page.check('#is #is-up-site');
await page.check('#is #is-up-perm');
await page.evaluate(() => window.HS.acqImpactStories.load(window.client, document.getElementById('is')));
await page.waitForTimeout(150);
ok(await page.inputValue('#is #is-up-credit') === 'K. Founder' && await page.isChecked('#is #is-up-site') && await page.isChecked('#is #is-up-perm')
   && (await page.locator('#is #is-up-chosen').innerText()).includes('oak.jpg'),
   'upload: a background redraw keeps the chosen photo, the credit and both boxes');
await page.click('#is [data-act=vupload]'); await page.waitForTimeout(200);
const rec2 = await page.evaluate(() => (window.calls.find((c) => c[0] === 'hs_impact_story_upload_photo') || [])[1]);
ok(rec2 && rec2.p_credit === 'K. Founder' && rec2.p_shows_site === true && rec2.p_sha256 === jpgSha,
   'upload: after a redraw the photo chosen before it is the one uploaded');
// Codex #2400: switching story while the file uploads must not record it on the other story.
await page.evaluate(() => {
  window.calls.length = 0;
  const prev = window.client.storage;
  window.client.storage = { from: (b) => ({ download: (p) => prev.from(b).download(p),
    upload: (p, f, o) => new Promise((res) => { window.calls.push(['upload', b, p]); window.__release = () => res({ data: { path: p }, error: null }); }) }) };
  window.__restoreStorage = () => { window.client.storage = prev; };
});
await page.setInputFiles('#is #is-up-file', { name: 'oak.jpg', mimeType: 'image/jpeg', buffer: jpg });
await page.fill('#is #is-up-credit', 'K. Founder');
await page.check('#is #is-up-perm');
await page.click('#is [data-act=vupload]'); await page.waitForTimeout(150);
await page.evaluate(() => { window.HS.acqImpactStories._state.open = 's2'; window.__release(); });
await page.waitForTimeout(200);
const up3 = await page.evaluate(() => window.calls.find((c) => c[0] === 'upload'));
const rec3 = await page.evaluate(() => (window.calls.find((c) => c[0] === 'hs_impact_story_upload_photo') || [])[1]);
ok(up3 && up3[2].startsWith('s1/uploads/') && rec3 && rec3.p_story === 's1',
   'upload: a story switch during the upload still records the photo on the story it was uploaded for');
await page.evaluate(() => { window.__restoreStorage(); window.HS.acqImpactStories._state.open = 's1'; });
await page.evaluate(() => { window.client.storage = window.prevStorage2; window.db.extra = null; });
await page.evaluate(() => { window.db.visuals = Object.assign({}, window.db.visuals, { state: 'needs_fixes', why: '1 shot(s) cannot be shown as planned.', counts: { clear: 3, flagged: 0, blocked: 1 } });
  window.HS.acqImpactStories.load(window.client, document.getElementById('is')); });
await page.waitForTimeout(100);
ok(await page.locator('#is [data-act=vapprove]').count() === 0 && (await page.locator('#is').innerText()).includes('Needs fixes'), 'visuals: a blocked shot leaves no approve button');
await page.evaluate(() => { window.db.visuals = Object.assign({}, window.db.visuals, { state: 'approved', why: 'Approved.' });
  window.db.status = () => Object.assign(window.db.baseStatus(), { stage: 'media', next: 'Render the videos' });
  window.HS.acqImpactStories.load(window.client, document.getElementById('is')); });
await page.waitForTimeout(80);
await page.click('#is [data-act=step][data-step=media]'); await page.waitForTimeout(50);
await page.click('#is .is-panel [data-act=render]'); await page.waitForTimeout(50);
await page.evaluate(() => { window.db.status = window.db.baseStatus; });
ok(await page.evaluate(() => window.calls.some((c) => c[0] === 'hs_impact_story_render' && c[1].p_expected_version === 8 && c[1].p_new === false)),
   'media: Render queues one render of the current approved version');
const qc = (ok) => ({ ok, checks: [{ name: 'dimensions', ok: true, detail: '1920x1080' }, { name: 'loudness', ok, detail: '-14.0 LUFS (target -14)' }] });
await page.evaluate((qc) => {
  const f = (id, asset, w, h, state, q, extra) => Object.assign({ id, asset, path: 's1/j9/' + asset + (asset === 'thumbnail' ? '.png' : '.mp4'), width: w, height: h, duration_s: 291,
    bytes: 4e7, preset: 'impact-16x9-v1', qc: q, state, why: state === 'blocked' ? 'The media checks failed: see the checks below.' : 'Watch it, then approve or reject.',
    stills: ['s1/j9/qc-' + asset + '-00010.png'], shots: [{ id: 'a1-s1', layout: 'open', kind: 'MAP', start_s: 0 }], captions_path: asset === 'thumbnail' ? null : 's1/j9/' + asset + '.srt' }, extra);
  window.db.media = { render_job: 'j9', current: true, complete: false, version: 8, renderer: 'impact-render-1', rendered_at: '2026-10-26T20:00:00Z',
    files: [f(1, 'main', 1920, 1080, 'pending', qc[0]), f(2, 'short_a', 1080, 1920, 'blocked', qc[1]), f(3, 'thumbnail', 1280, 720, 'pending', { ok: true, checks: [] })] };
  window.HS.acqImpactStories.load(window.client, document.getElementById('is'));
}, [qc(true), qc(false)]);
await page.waitForTimeout(80);
txt = await page.locator('#is').innerText();
ok(txt.includes('Main video (16:9)') && txt.includes('Short A (9:16)') && txt.includes('Checks failed') && txt.includes('Render again'), 'media: each file is listed with its own state');
ok(await page.locator('#is [data-act=mdecide][data-d=approved][data-id="2"]').isDisabled(), 'media: a file that failed its checks cannot be approved');
await page.click('#is [data-act=watch][data-path="s1/j9/main.mp4"]'); await page.waitForTimeout(80);
ok(await page.evaluate(() => window.calls.some((c) => c[0] === 'download' && c[1] === 'impact-media' && c[2] === 's1/j9/main.mp4'))
   && /^blob:/.test(await page.locator('#is video').getAttribute('src')), 'media: a video is downloaded with the admin session and played from a blob link');
await page.click('#is [data-act=mdecide][data-d=approved][data-id="1"]'); await page.waitForTimeout(50);
ok(await page.evaluate(() => window.calls.some((c) => c[0] === 'hs_impact_story_media_decide' && c[1].p_asset_id === 1 && c[1].p_decision === 'approved')), 'media: approve sends one file decision');
await page.evaluate(() => { window.prompt = () => { throw new Error('no pop-up for a fix request'); }; });
await page.click('#is [data-act=fixform][data-id="3"]'); await page.waitForTimeout(50);
await page.fill('#fx-note-3', 'Text too small on a phone.'); await page.fill('#fx-tc-3', '0:12');
await page.click('#is [data-act=fixsend][data-id="3"]'); await page.waitForTimeout(50);
ok(await page.evaluate(() => window.calls.some((c) => c[0] === 'hs_impact_story_media_decide' && c[1].p_asset_id === 3 && c[1].p_decision === 'rejected'
   && c[1].p_note === 'Text too small on a phone.' && c[1].p_timecode === '0:12')), 'media: a fix request is written in a form under the video and sends what to fix and the moment');
await page.evaluate(() => { window.prompt = () => 'Lead with the date.'; });
// Fix (2026-10-28): every request stays listed with what happened to it; the button sends the open ones and starts the job
await page.evaluate(() => {
  const m = window.db.media;
  m.fix_requests = [
    { id: 4, asset: 'short_b', note: 'End card: full <investigation> on YouTube', at: '2026-10-28T13:38:06Z', status: 'open', batch: null },
    { id: 3, asset: 'main', note: 'Rename the checklist', timecode: '1:05', at: '2026-10-28T13:32:49Z', status: 'rerendered', narrative_changed: false,
      rerendered_at: '2026-10-28T15:00:00Z', batch: null },
    { id: 2, asset: 'main', note: 'Tree photo', at: '2026-10-28T13:31:20Z', status: 'open',
      batch: { status: 'done', outcome: 'needs_you', note: 'Choose a licensed photo', completed_at: '2026-10-28T14:00:00Z' } }];
  m.fix_batch = { status: 'needs_you', requests: 1, requested_at: '2026-10-28T13:40:00Z', completed_at: '2026-10-28T14:00:00Z',
    summary: 'Photo needed', next_step: 'Choose a photo in Media review.' };
  window.HS.acqImpactStories.load(window.client, document.getElementById('is'));
});
await page.waitForTimeout(80);
txt = await page.locator('#is').innerText();
ok(txt.includes('Fix requests (3)') && txt.includes('End card: full <investigation> on YouTube') && txt.includes('Not sent yet')
   && txt.includes('Re-rendered, but nothing in the story changed') && txt.includes('Needs you') && txt.includes('Next: Choose a photo in Media review.'),
   'fixes: every request is listed with its own status, the batch says what is next');
ok(await page.locator('#is .is-badge.warn', { hasText: 'Re-rendered, but nothing' }).count() === 1, 'fixes: a re-render with no story change is amber');
await page.click('#is [data-act=fixstart]'); await page.waitForTimeout(50);
ok(await page.evaluate(() => window.calls.some((c) => c[0] === 'hs_impact_story_fix_start' && c[1].p_story === 's1')), 'fixes: Fix sends the story');
await page.evaluate(() => { window.db.media.fix_batch = { status: 'queued', requests: 1, requested_at: '2026-10-28T16:00:00Z' };
  window.db.media.fix_requests[0].batch = { status: 'queued' }; window.HS.acqImpactStories.load(window.client, document.getElementById('is')); });
await page.waitForTimeout(80);
txt = await page.locator('#is').innerText();
ok(txt.includes('Starting: the fixer begins within a minute') && await page.locator('#is [data-act=fixstart]').count() === 0,
   'fixes: while a batch is queued the status shows and the button is gone');
await page.evaluate(() => { window.db.media.fix_batch = { status: 'stalled', requests: 1, requested_at: '2026-10-28T12:00:00Z', claimed_at: '2026-10-28T12:01:00Z' };
  window.HS.acqImpactStories.load(window.client, document.getElementById('is')); });
await page.waitForTimeout(80);
ok(await page.locator('#is [data-act=fixstart]', { hasText: 'Fix again' }).count() === 1, 'fixes: a stalled batch offers Fix again');
// the quality gates (2026-10-27): a file the visual gate failed, a blocked render with licensed candidates, the status check
await page.evaluate(() => {
  const m = window.db.media;
  m.files[1].qc.ok = true; m.files[1].state = 'blocked'; m.files[1].why = 'The visual quality gate failed: Too many documents and cards.';
  m.files[1].qc.quality = { ok: false, failures: [{ code: 'excessive_documents', label: 'Too many documents and cards', asset: 'short_a',
      detail: 'documents, cards and maps fill 54% <b>', action: 'Show the subject; quote the record over its photo.' }],
    storyboard: { metrics: { real_share: 0.46, document_share: 0.54 }, targets: { real_min: 0.55, document_max: 0.3 } },
    frames: { metrics: { frames: 66, real_share: 0.455, page_share: 0.52 }, targets: { real_min: 0.55 } } };
  m.currency = { state: 'current', checked_at: '2026-10-27', pack_fetched_at: '2026-10-25', events: [], blocking: [] };
  m.blocked = { job_id: 'jb', at: '2026-10-27T20:00:00Z', error: 'Nothing was rendered',
    failures: [{ code: 'missing_essential_image', label: 'Missing essential image', detail: 'Oak trees: no licensed photo yet.', action: 'Choose one of the licensed candidates.' }],
    candidates: [{ subject_id: 'oak-trees', subject: 'Oak trees', queries: ['Oregon white oak'], candidates: [
      { id: 'oak-1', title: 'File:Oak.jpg', license: 'CC BY-SA 4.0', author: 'A <Person>', page_url: 'https://commons.wikimedia.org/wiki/File:Oak.jpg', near: [] }] }] };
  m.choices = [];
  window.HS.acqImpactStories.load(window.client, document.getElementById('is'));
});
await page.waitForTimeout(80);
await page.click('#is [data-act=step][data-step=media]'); await page.waitForTimeout(50);
txt = await page.locator('#is').innerText();
ok(txt.includes('Visual quality: FAILED') && txt.includes('Too many documents and cards') && txt.includes('Show the subject; quote the record over its photo.')
   && txt.includes('Real-world pictures') && txt.includes('46%') && txt.includes('checked frame by frame (66 frames)'), 'media: the visual quality report shows failures, actions and metrics against targets');
ok(txt.includes('stopped before rendering anything') && txt.includes('Missing essential image') && txt.includes('REPRESENTATIVE PHOTO')
   && txt.includes('Latest development check') && !(await page.locator('#is b').allInnerTexts()).some((x) => x.includes('<b>')), 'media: a blocked render names what is missing and the licensed candidates');
ok(await page.locator('#is [data-act=mdecide][data-d=approved][data-id="2"]').isDisabled(), 'media: a file the visual gate failed cannot be approved');
ok(!(await page.locator('#is').innerHTML()).includes('<b>Person'), 'media: candidate text is escaped');
await page.click('#is [data-act=choose][data-id="oak-1"]'); await page.waitForTimeout(50);
ok(await page.evaluate(() => window.calls.some((c) => c[0] === 'hs_impact_story_choose_asset' && c[1].p_job === 'jb' && c[1].p_subject === 'oak-trees' && c[1].p_candidate === 'oak-1')),
   'media: choosing a photo sends the render, subject and candidate');
await page.evaluate(() => { window.prompt = () => 'Lead with the date.'; });
await page.click('#is [data-act=step][data-step=distribution]');
txt = await page.locator('#is').innerText();
ok(txt.includes('Not published') && txt.includes('Not connected') && txt.includes('Full video URL pending') && txt.includes('unavailable'), 'distribution: not published / not connected / pending URL / publishing unavailable');
ok(await page.locator('#is [data-act=export]').isDisabled(), 'distribution: export stays locked until every approval is in place');
ok(!/publish now|schedule post/i.test(txt), 'distribution: no publish or schedule action');
await page.click('#is [data-act=step][data-step=results]');
txt = await page.locator('#is').innerText();
ok(txt.includes('Not published') && !/\b0\b/.test(txt.replace(/0-3|utm|impact-/g, '')), 'results: nothing is shown as zero');

// impact-story/3: discovery, three scored concepts, the quality gate and the visual plan
await page.evaluate(() => {
  const L = (t, ...c) => ({ text: t, claims: c });
  const pic = (subject, status, extra) => Object.assign({ kind: status === 'registry' ? 'representative_image' : 'illustrative', category: 'wildlife', emotion: 'concern',
    subject, shot: 'wide', camera: 'slow_push', duration: 7, transition: 'dissolve', why: 'The species on the list' }, { asset: Object.assign({ status }, extra) });
  const concept = (id, role, title) => ({ id, role, trigger: role, title, confidence: 'medium', fit: 'Fit of ' + id,
    opening: L('Opening of ' + id + '.', 'purpose'), stakes: L('Stakes of ' + id + '.', 'purpose'), conflict: L('Conflict of ' + id + '.', 'purpose'),
    arc: { attachment: L('A line.', 'purpose'), disruption: L('B line.', 'purpose'), controversy: L('C line.', 'purpose'), evidence: L('D line.', 'purpose'), turning_point: L('E line.', 'purpose'), action: L('F line.', 'purpose') } });
  const body = { schema: 'impact-story/3',
    discovery: { findings: [
      { dimension: 'wildlife', classification: 'documented_potential', finding: L('Pile driving near <orcas>.', 'purpose'), affected: 'Orcas', could_lose: 'Quiet water' },
      { dimension: 'financial', classification: 'no_evidence', finding: L('No cost named.'), affected: '', could_lose: '' }],
      conflict: L('Two records differ.', 'purpose'), protections: [L('A bubble curtain.', 'purpose')],
      participation: { text: 'The appeal window closed.', claims: ['purpose'], open: false }, approach: { trigger: 'concern', why: 'Species on the record.' },
      accountability: {
        researched: { owner: { result: 'not_found', looked_in: 'The assessor record was not fetched.' }, applicant: { result: 'found', claims: ['purpose'] } },
        parties: [{ id: 'applicant', name: null, label: 'the applicant', type: 'unknown', roles: ['applicant'], claims: ['purpose'],
                    identity_questions: ['Legal name <not> in the records.'] },
                  { id: 'city', name: 'City of Gig Harbor', type: 'public_agency', roles: ['agency', 'decision_maker'], claims: ['purpose'] }],
        attributions: [{ id: 'cut', party: 'applicant', kind: 'violation', basis: 'finding', status: 'established', confidence: 'high',
                         action: L('The city found the applicant removed trees.', 'purpose'),
                         enforcement: { type: 'administrative', state: 'overturned', claims: ['purpose'] },
                         response_none: 'No response in the records.', later_rulings: 'Hearing Examiner reversed it.' },
                       { id: 'cmp', party: 'city', kind: 'other', basis: 'allegation', status: 'alleged', confidence: 'low',
                         action: L('A complaint says the city waited.', 'purpose'), response: L('The city disputes it.', 'purpose') }],
        opportunity: { type: 'violation', why: 'A finding against the applicant.' } } },
    concepts: [concept('orcas', 'concern', 'A dock in orca water'), concept('two-docks', 'accountability', 'Six floats or 15?'), concept('waterfront', 'empowerment', 'A working waterfront')],
    selection: { concept: 'orcas', mode: 'emotional', why: 'Highest score.' } };
  body.main = { acts: [{ act: 1, name: 'The harbor', scenes: [{ thread: 'fear', purpose: 'p', visual: pic('A southern resident killer whale', 'registry', { id: 'southern-resident-orca' }), narration: [L('Line.', 'purpose')] },
    { thread: 'fear', purpose: 'p', visual: pic('A heron', 'missing', { search: ['great blue heron'] }), narration: [L('Line.', 'purpose')] }] }] };
  window.db.extra = { body, v3: {
    scores: { orcas: { total: 86, parts: { 'evidence integrity': 25 } }, 'two-docks': { total: 57, parts: {} }, waterfront: { total: 74, parts: {} } },
    quality: { criteria: { attachment: 2, 'visual power': 1 }, total: 13, max: 14, reject: [] },
    accountability: { verified: false, missing: ['Property owner and ownership entity'], leads: { names: [{ name: 'City of Gig Harbor' }, { name: 'Harbor Holdings LLC' }] } },
    missing_assets: [{ scene: 'a1-s2', subject: 'A heron' }], short_timing: { a: [{ beat: 'hook', ends: 3.1 }, { beat: 'care', ends: 6.9 }] },
    photos: [{ id: 'southern-resident-orca', usable: true, title: 'File:Orca.jpg', license: 'CC BY-SA 3.0', author: 'NOAA <staff>', page_url: 'https://commons.wikimedia.org/wiki/File:Orca.jpg', site_specific: false }] } };
  window.HS.acqImpactStories.load(window.client, document.getElementById('is'));
});
await page.waitForTimeout(80);
await page.click('#is [data-act=step][data-step=outline]');
txt = await page.locator('#is').innerText();
ok(txt.includes('What residents could lose') && txt.includes('Documented potential') && txt.includes('No evidence') && txt.includes('Wildlife & nature'),
   'V3 outline: discovery shows each finding with its strength of evidence');
ok((await page.innerHTML('#is')).includes('Pile driving near &lt;orcas&gt;.'), 'V3 outline: findings are escaped');
ok(txt.includes('Three story concepts') && txt.includes('A dock in orca water') && txt.includes('Six floats or 15?') && txt.includes('86') && txt.includes('Selected'),
   'V3 outline: three concepts with their scores, the selected one marked');
ok(txt.includes('A. Attachment') && txt.includes('F. Motivation and action'), 'V3 outline: each concept shows its arc A-F');
ok(txt.includes('Quality gate') && txt.includes('13 / 14') && txt.includes('need an editorial decision'), 'V3 outline: the quality gate and the missing pictures are shown');
ok(txt.includes('Accountability research') && txt.includes('The city found the applicant removed trees.') && txt.includes('Name not in the records')
   && txt.includes('Alleged · not a finding') && txt.includes('Later overturned') && txt.includes('The city disputes it.') && txt.includes('No response in the records.'),
   'accountability: who did what, its status, any reversal and the response are shown');
ok(txt.includes('Missing attribution') && txt.includes('Property owner and ownership entity') && txt.includes('Harbor Holdings LLC')
   && !/not in the map\) \(check each\): [^\n]*City of Gig Harbor/.test(txt),
   'accountability: missing roles and names in the records that are not in the map are flagged');
ok((await page.innerHTML('#is')).includes('Legal name &lt;not&gt; in the records.'), 'accountability: identity questions are escaped');
await page.click('#is [data-act=research]'); await page.waitForTimeout(50);
ok(await page.evaluate(() => window.calls.some((c) => c[0] === 'hs_impact_story_section_revision' && c[1].p_section === 'accountability'
   && c[1].p_note.startsWith('Deeper research: '))), 'accountability: the founder can request deeper research');
ok(await page.locator('#is [data-act=revise][data-sec=accountability]').count() === 1, 'accountability: and request a correction');
ok(await page.locator('#is [data-act=concept]').count() === 2, 'V3 outline: the two other concepts can be chosen instead');
await page.click('#is [data-act=concept][data-id=two-docks]'); await page.waitForTimeout(50);
ok(await page.evaluate(() => window.calls.some((c) => c[0] === 'hs_impact_story_section_revision' && c[1].p_section === 'concepts'
   && c[1].p_note.includes('(two-docks)') && c[1].p_note.includes('instead of orcas') && c[1].p_note.includes('Lead with the date.'))),
   'V3 outline: choosing another concept records a revision note with the reason');
await page.click('#is [data-act=step][data-step=script]');
await page.click('#is [data-act=doc][data-doc=visuals]');
txt = await page.locator('#is').innerText();
ok(txt.includes('Licensed photo') && txt.includes('representative, not this site') && txt.includes('CC BY-SA 3.0') && txt.includes('MISSING: needs editorial review'),
   'V3 visual plan: each picture says where it comes from and its license, and a missing one is flagged');
ok(txt.includes('hook ends 3.1s') && txt.includes('Hook by 3 s'), 'V3 visual plan: Shorts timing is shown against its rule');
ok((await page.innerHTML('#is')).includes('NOAA &lt;staff&gt;'), 'V3 visual plan: photo credits are escaped');
await page.evaluate(() => { window.db.extra = null; window.HS.acqImpactStories.load(window.client, document.getElementById('is')); }); await page.waitForTimeout(80);

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
// an old link from the first build (step=angles) and an unknown step must still draw the workspace, never a blank tab
for (const [step, want] of [['angles', 'outline'], ['nope', 'script']]) {
  await page.evaluate((st) => { location.hash = '#impact=s1&step=' + st; window.HS.acqImpactStories._state.open = null; window.HS.acqImpactStories._state.data = null; document.getElementById('is').innerHTML = ''; }, step);
  await page.evaluate(() => window.HS.acqImpactStories.load(window.client, document.getElementById('is'))); await page.waitForTimeout(80);
  ok(await page.locator('#is [data-step=' + want + '][aria-current=step]').count() === 1, 'old or unknown step "' + step + '" opens ' + want + ' instead of a blank tab');
}
await browser.close();
console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
process.exit(fails ? 1 : 0);
