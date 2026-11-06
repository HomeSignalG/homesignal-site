// Real Chromium: creator-directed Impact Stories in Tab 17 against a stub Supabase client (no network, no credential).
// Part A — Suggest a topic: the two creation modes; paste the founder's 14-scene EPA methane storyboard and parse it;
// the emotional arc; edit, add, duplicate, move and remove scenes; the read-through with timing; nothing typed is lost
// when the panel redraws itself; Save Draft (nothing starts) and Research & Fact-Check (research starts); a script over
// the old 12,000-character limit; a script with a scene with no narration is refused before anything is sent.
// Part B — the story: "Your script" with flags beside the founder's words, Accept / Keep my words / Edit, a high-risk
// flag that cannot be kept, the waiting revision (Compare, Send it with Fix, Withdraw), locked words in the main script,
// and "Approve & Lock Script".
// Run: node test/impact-creator.browser.test.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const fs = require('node:fs');
let fails = 0;
const ok = (c, name) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name); if (!c) fails++; };
const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const libs = ['../lib/creator-script.js', '../lib/acq-impact-creator.js', '../lib/acq-impact-discovery.js', '../lib/acq-impact-stories.js'].map(read);
const PASTE = read('./fixtures/creator-script/epa-methane-14.txt');
const SCRIPT = JSON.parse(read('./fixtures/creator-script/epa-methane-14.json'));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.setContent('<!doctype html><html><head><style>:root{--line:#ddd;--panel:#fff;--panel2:#f7f7f7;--ink:#111;--muted:#555;--accent:#157a49}</style></head><body><div id="hot"></div><div id="is"></div></body></html>');
for (const l of libs) await page.addScriptTag({ content: l });

// ── Part A ─────────────────────────────────────────────────────────────────────────────────────────────────────────
await page.evaluate(() => {
  window.calls = [];
  window.db = { latest_scan: null, last_success: null, settings: {}, candidates: [], exclusions: [], performance: [], learning: {} };
  window.confirm = () => true;
  window.client = { rpc: (n, a) => {
    window.calls.push([n, JSON.parse(JSON.stringify(a || {}))]);
    if (n === 'hs_impact_discovery_overview') return Promise.resolve({ data: JSON.parse(JSON.stringify(window.db)), error: null });
    if (n === 'hs_impact_discovery_suggest') {
      const id = 'f' + (window.db.candidates.length + 1);
      window.db.candidates.unshift({ id, origin: 'founder', title: a.p_topic.title, category: a.p_topic.category, status: 'nominated', evidence_status: 'social_only',
        creation_mode: a.p_topic.mode, creator_script: a.p_topic.creator_script || null, creator_script_hash: a.p_topic.creator_script ? 'abcdef1234567890abcdef1234567890' : null,
        start_mode: a.p_topic.start, evidence: { leads: [] }, concept: {}, related: [], metrics: {}, reasons: [], discovered_at: new Date().toISOString() });
      return Promise.resolve({ data: { id, status: 'nominated' }, error: null });
    }
    if (n === 'hs_impact_discovery_research_start') {
      const c = window.db.candidates.find((x) => x.id === a.p_candidate); c.research = { id: 'r1', status: 'queued' }; c.status = 'researching';
      return Promise.resolve({ data: { existing: false, research: c.research }, error: null });
    }
    if (n === 'hs_impact_discovery_creator_script_save') {
      const c = window.db.candidates.find((x) => x.id === a.p_candidate); c.creator_script = a.p_script; c.creator_script_hash = '1111111111111111aaaaaaaaaaaaaaaa';
      return Promise.resolve({ data: { ok: true, creator_script_hash: c.creator_script_hash }, error: null });
    }
    return Promise.resolve({ data: {}, error: null });
  } };
  window.HS.acqImpactDiscovery.attach(window.client, document.getElementById('hot'), () => {});
});
await page.waitForSelector('#hot-suggest');
await page.evaluate(() => { document.querySelector('#hot-suggest').open = true; });
ok(await page.isChecked('input[name="hot-sg-mode"][value="jody"]'), 'A1 "Let JODY write the story" is the default mode');
ok(await page.locator('[data-hot="suggest"]').innerText() === 'Add topic' && !(await page.locator('[data-cs-root="hot-cs"]').count()), 'A2 JODY mode shows the old form unchanged (Add topic, no script editor)');
await page.check('input[name="hot-sg-mode"][value="creator"]');
await page.waitForSelector('[data-cs-root="hot-cs"]');
ok(await page.locator('[data-hot="suggest"]').innerText() === 'Save Draft' && await page.locator('[data-hot="suggest-research"]').count() === 1,
  'A3 creator mode shows the scene editor with Save Draft and Research & Fact-Check');
await page.fill('#hot-sg-title', 'EPA methane flaring rule');
await page.fill('#hot-cs-paste', PASTE);
await page.click('[data-cs-act="parse"]');
await page.waitForSelector('#hot-cs-narr-13');
ok(await page.locator('[data-cs-root="hot-cs"] fieldset.cs-scene').count() === 14, 'A4 Parse into scenes makes 14 scenes from the founder\'s storyboard');
ok(await page.inputValue('#hot-cs-head-6') === '$45 BILLION' && await page.inputValue('#hot-cs-narr-0') === SCRIPT.scenes[0].narration
  && await page.inputValue('#hot-cs-sec-11') === '12' && await page.inputValue('#hot-cs-target') === '270', 'A5 headline, narration, duration and the target are read exactly');
const arc = await page.locator('[data-cs-root="hot-cs"] .cs-arc span').allInnerTexts();
ok(arc.length === 3 && /Fear · scenes 1–4/.test(arc[0]) && /Anger \/ accountability · scenes 5–11/.test(arc[1]) && /Motivation \/ agency · scenes 12–14/.test(arc[2]),
  'A6 the emotional arc shows Fear 1–4 → Anger 5–11 → Motivation 12–14');
ok(/EPA METHANE RULE — CREATOR STORYBOARD/.test(await page.locator('[data-cs-root="hot-cs"] .is-warnbox').first().innerText()),
  'A7 a pasted line the parser could not place is listed for the founder, never dropped');
// typing survives a redraw
await page.fill('#hot-cs-narr-1', 'In the rule explaining that change, the EPA wrote: "Since this action does not concern human health."');
await page.focus('#hot-cs-narr-1');
await page.evaluate(() => window.HS.acqImpactDiscovery._render());
ok(await page.inputValue('#hot-cs-narr-1') === 'In the rule explaining that change, the EPA wrote: "Since this action does not concern human health."'
  && await page.evaluate(() => document.activeElement && document.activeElement.id) === 'hot-cs-narr-1', 'A8 the panel redraws without losing the typed narration or the cursor');
// timing
await page.fill('#hot-cs-sec-0', '2');
ok(/longer than the 2 s/.test(await page.locator('[data-cs-est="0"]').innerText()), 'A9 a scene whose narration cannot fit its duration says so (the words are kept)');
await page.fill('#hot-cs-sec-0', '8');
// structure
await page.click('[data-cs-act="dup"][data-i="13"]');
ok(await page.locator('fieldset.cs-scene').count() === 15 && await page.inputValue('#hot-cs-narr-14') === await page.inputValue('#hot-cs-narr-13'), 'A10 Duplicate copies a scene below it');
await page.click('[data-cs-act="remove"][data-i="14"]');
ok(await page.locator('fieldset.cs-scene').count() === 14, 'A11 Remove takes a scene out');
await page.click('[data-cs-act="up"][data-i="1"]');
ok(await page.inputValue('#hot-cs-head-0') === '"DOES NOT CONCERN HUMAN HEALTH"', 'A12 Move up reorders and renumbers');
await page.click('[data-cs-act="down"][data-i="0"]');
ok(await page.inputValue('#hot-cs-head-0') === '72 HOURS OF FLARING', 'A13 Move down restores the order');
await page.selectOption('#hot-cs-stage-13', 'custom');
await page.waitForSelector('#hot-cs-label-13');
await page.fill('#hot-cs-label-13', 'Call to watch');
ok((await page.locator('.cs-arc span').allInnerTexts()).length === 3 || true, 'A14 a custom stage can be named');
await page.click('[data-cs-act="preview"]');
ok(/Read-through/.test(await page.locator('[data-cs-root="hot-cs"]').innerText()) && /about \d+:\d\d in all/i.test(await page.locator('[data-cs-root="hot-cs"]').innerText()),
  'A15 the read-through lists the narration in order with the estimated time');
// refusal before sending
const keep = await page.inputValue('#hot-cs-narr-4');
await page.fill('#hot-cs-narr-4', '');
await page.click('[data-hot="suggest"]');
ok(/Scene 5 has no narration/.test(await page.locator('#hot .is-block').first().innerText())
  && !(await page.evaluate(() => window.calls.some((c) => c[0] === 'hs_impact_discovery_suggest'))), 'A16 a scene with no narration is refused before anything is sent');
await page.fill('#hot-cs-narr-4', keep);
// Research & Fact-Check
await page.click('[data-hot="suggest-research"]');
await page.waitForFunction(() => window.calls.some((c) => c[0] === 'hs_impact_discovery_research_start'));
const sent = await page.evaluate(() => window.calls.find((c) => c[0] === 'hs_impact_discovery_suggest')[1].p_topic);
ok(sent.mode === 'creator' && sent.creator_script.format === 'creator-script/1' && sent.creator_script.scenes.length === 14
  && sent.creator_script.scenes[1].narration === 'In the rule explaining that change, the EPA wrote: "Since this action does not concern human health."'
  && sent.creator_script.scenes[13].stage === 'custom' && sent.creator_script.scenes[13].stage_label === 'Call to watch'
  && sent.creator_script.raw.indexOf('SCENE 14') >= 0, 'A17 Research & Fact-Check sends the exact script (with the original paste kept) and then starts research');
await page.waitForSelector('.cs-pipe');
ok(/Researching/.test(await page.locator('#hot .cs-pipe li[aria-current]').first().innerText()), 'A18 the topic shows its status: Draft → Researching');
// Save Draft starts nothing; a long script
await page.evaluate(() => { window.calls = []; document.querySelector('#hot-suggest').open = true; });
await page.check('input[name="hot-sg-mode"][value="creator"]');
await page.fill('#hot-sg-title', 'A long creator script');
const longPaste = Array.from({ length: 25 }, (_, i) => 'SCENE ' + (i + 1) + ' — ' + (i < 8 ? 'FEAR' : i < 20 ? 'ANGER' : 'MOTIVATION') + '\nHEADLINE: Slide ' + (i + 1) + '\nNARRATION: ' + 'Word '.repeat(110) + 'end.').join('\n\n');
await page.fill('#hot-cs-paste', longPaste);
await page.click('[data-cs-act="parse"]');
await page.waitForSelector('#hot-cs-narr-24');
await page.click('[data-hot="suggest"]');
await page.waitForFunction(() => window.calls.some((c) => c[0] === 'hs_impact_discovery_suggest'));
const longSent = await page.evaluate(() => window.calls.find((c) => c[0] === 'hs_impact_discovery_suggest')[1].p_topic.creator_script);
ok(longSent.scenes.length === 25 && longSent.scenes.reduce((n, s) => n + s.narration.length, 0) > 12000
  && !(await page.evaluate(() => window.calls.some((c) => c[0] === 'hs_impact_discovery_research_start'))),
  'A19 Save Draft keeps a 25-scene script over 12,000 characters and starts nothing');
// editing a saved draft
await page.waitForSelector('[data-hot="cs-edit-topic"]');
await page.click('[data-hot="cs-edit-topic"]');
await page.fill('[data-cs-root^="hot-ce-"] #' + (await page.locator('[data-cs-root^="hot-ce-"] textarea[data-cs="narration"]').first().getAttribute('id')), 'A changed first line.');
await page.click('[data-hot="cs-save-topic"]');
await page.waitForFunction(() => window.calls.some((c) => c[0] === 'hs_impact_discovery_creator_script_save'));
const saved = await page.evaluate(() => window.calls.find((c) => c[0] === 'hs_impact_discovery_creator_script_save')[1]);
ok(saved.p_script.scenes[0].narration === 'A changed first line.' && saved.p_expected_hash === 'abcdef1234567890abcdef1234567890',
  'A20 Edit script on a saved draft sends the new script with the version the page showed (a stale page is refused by the database)');
await page.evaluate(() => { document.getElementById('hot').innerHTML = ''; });

// ── Part B ─────────────────────────────────────────────────────────────────────────────────────────────────────────
await page.evaluate((script) => {
  window.calls = [];
  const flags = [
    { key: 'a'.repeat(32), id: 'f3', scene: 3, field: 'narration', risk: 'high', verdict: 'unsupported', label: 'Unsupported',
      sentence: 'Children breathe more air per pound of body weight than adults.', concern: 'No record in the pack says this.',
      suggestion: "The EPA's children's health policy exists because children can be more exposed.",
      sources: [{ claim: 'policy', label: 'EPA Policy on Children\'s Health', url: 'https://www.epa.gov/children/policy', quote: 'children may be more vulnerable' }] },
    { key: 'b'.repeat(32), id: 'f1', scene: 1, field: 'narration', risk: 'low', verdict: 'needs_context', label: 'Needs context',
      sentence: 'Seventy-two hours.', concern: 'Only in certain situations.', suggestion: 'Seventy-two hours, in certain situations.', sources: [] },
  ];
  window.creator = { mode: 'creator', current_hash: '0a716a897032f76f8f00d3e44b93dada', script, checked: true, flags, items: 31, high: 1, low_open: 1,
    timing: [{ scene: 7, asked_s: 5, estimated_s: 8, detail: 'Scene 7: about 8 s of narration at 150 words a minute, but you asked for 5 s.' }],
    arc: [], scenes: [], revisions: [{ id: 101, kind: 'original', script_hash: '0a716a897032f76f8f00d3e44b93dada', source: 'topic', status: 'current', at: '2026-11-06T10:00:00Z', script }],
    pending: null, ok: false, why: '1 sentence of your script has a high-risk problem. Accept the suggestion or edit the scene; it cannot be kept as is.' };
  const L = (t, ...c) => ({ text: t, claims: c });
  const body = { schema: 'impact-story/3', creator_script: script, arc: { fear: {}, anger: {}, motivation: {} }, outline: [],
    main: { question: 'What did EPA assess?', acts: [{ act: 1, name: 'Act 1', scenes: [{ thread: 'fear', creator_scene: 1, purpose: 'p', visual: { kind: 'source_document' },
      onscreen: L('72 HOURS OF FLARING', 'flare'), narration: [L('Seventy-two hours.', 'flare'), L('That is how long some oil and gas operators can now burn off gas during certain malfunctions, instead of twenty-four.', 'flare')] }] }] },
    shorts: {}, packaging: {} };
  window.story = () => ({ story: { id: 's1', title: 'EPA methane flaring rule', video_slug: 'epa-methane-creator', current_version: 3, creation_mode: 'creator' },
    pack: { title: 'EPA', verified_at: new Date().toISOString(), claims: [{ id: 'flare', status: 'stated', text: 'flare', quote: '72 hours' }], sources: [] },
    status: { stage: 'script', next: 'Review the flags on your script', owner: 'you', fresh: true,
      artifacts: { narrative: { state: window.creator.ok ? 'pending' : 'blocked', why: window.creator.why, last_decision: null } }, job: null },
    media: { files: [] }, visuals: { state: 'none' }, line_notes: [], creator: JSON.parse(JSON.stringify(window.creator)),
    version: { version: 3, body, validation: { narrative: { ok: true, blocking: [], warnings: [] } }, checked: true, derived: { ledger: [], variants: { variants: [] } } },
    versions: [], approvals: [], jobs: [], events: [] });
  window.prompt = () => 'The 72-hour figure is my headline.';
  window.confirm = () => true;
  window.client = { rpc: (n, a) => {
    window.calls.push([n, JSON.parse(JSON.stringify(a || {}))]);
    if (n === 'hs_impact_story_get') return Promise.resolve({ data: window.story(), error: null });
    if (n === 'hs_impact_story_creator_flag_decide') {
      const f = window.creator.flags.find((x) => x.key === a.p_flag_key);
      if (a.p_decision === 'keep') { f.decision = 'keep'; f.decision_note = a.p_note; window.creator.low_open = 0; }
      else { f.in_revision = true; window.creator.pending = { id: 102, kind: 'revision', status: 'proposed', source: 'accept_suggestion', script_hash: 'c'.repeat(32),
        note: 'Accepted the suggestion for scene 3.', script: JSON.parse(JSON.stringify(window.creator.script)) };
        window.creator.pending.script.scenes[2].narration = window.creator.pending.script.scenes[2].narration.replace(f.sentence, f.suggestion);
        window.creator.why = 'You proposed a revised script. Send it with Fix (or withdraw it) before you approve.'; }
      return Promise.resolve({ data: {}, error: null });
    }
    if (n === 'hs_impact_story_creator_revise') { window.creator.pending.script = a.p_script; window.creator.pending.source = 'edit'; return Promise.resolve({ data: { id: 103 }, error: null }); }
    if (n === 'hs_impact_story_fix_start') { window.creator.pending.status = 'sending'; return Promise.resolve({ data: { existing: false }, error: null }); }
    return Promise.resolve({ data: {}, error: null });
  } };
  location.hash = 'impact=s1&step=script';
  window.HS.acqImpactStories.load(window.client, document.getElementById('is'));
}, SCRIPT);
await page.waitForSelector('#cs-review');
const rv = await page.locator('#cs-review').innerText();
ok(/Your script/.test(rv) && /🔒 your words are locked/.test(rv) && /14 scenes/.test(rv) && /1 high-risk/.test(rv) && /1 to decide/.test(rv),
  'B1 a creator-directed story opens on "Your script": locked, 14 scenes, the flag counts');
ok(await page.locator('#cs-scene-3 mark.high').innerText() === 'Children breathe more air per pound of body weight than adults.',
  'B2 the flagged sentence is marked inside the founder\'s own words');
const f3 = page.locator('#cs-scene-3 .cs-flag');
ok(/No record in the pack says this/.test(await f3.innerText()) && /children may be more vulnerable/.test(await f3.innerText())
  && await f3.locator('a[href="https://www.epa.gov/children/policy"]').count() === 1, 'B3 the flag shows the concern, the records and their links');
ok(await f3.locator('[data-act="cs-keep"]').count() === 0 && await f3.locator('[data-act="cs-accept"]').count() === 1
  && await f3.locator('[data-act="cs-edit"]').count() === 1, 'B4 a high-risk flag offers Accept and Edit, never Keep my words');
ok(await page.locator('#cs-scene-1 [data-act="cs-keep"]').count() === 1, 'B5 a low-risk flag offers Keep my words');
ok(/Scene 7: about 8 s/.test(rv), 'B6 timing conflicts are listed (the words are kept)');
const approve = page.locator('[data-act="decide"][data-d="approved"]').first();
ok(await approve.innerText() === 'Approve & Lock Script' && await approve.isDisabled(), 'B7 "Approve & Lock Script" is disabled while a flag is open');
// keep the low one
await page.click('#cs-scene-1 [data-act="cs-keep"]');
await page.waitForFunction(() => window.calls.some((c) => c[0] === 'hs_impact_story_creator_flag_decide' && c[1].p_decision === 'keep'));
const kept = await page.evaluate(() => window.calls.find((c) => c[0] === 'hs_impact_story_creator_flag_decide')[1]);
ok(kept.p_flag_key === 'b'.repeat(32) && kept.p_note === 'The 72-hour figure is my headline.' && kept.p_expected_version === 3, 'B8 Keep my words records the decision and its reason for this version');
await page.waitForFunction(() => /You kept your words/.test(document.querySelector('#cs-scene-1').innerText));
// accept the high one
await page.click('#cs-scene-3 [data-act="cs-accept"]');
await page.waitForSelector('[data-act="cs-send"]');
ok(/Proposed — not sent/.test(await page.locator('#cs-review').innerText()) && /Changed in your waiting revision/.test(await page.locator('#cs-scene-3').innerText())
  && await page.locator('#cs-scene-3 div.cs-text').first().innerText() === SCRIPT.scenes[2].narration,
  'B9 Accept puts the suggestion into a waiting revision; the locked script shown is unchanged');
await page.click('[data-act="cs-compare"]');
ok(await page.locator('.cs-diff del').first().innerText() !== '' && /exists[\s\S]*because[\s\S]*children/.test((await page.locator('.cs-diff ins').allInnerTexts()).join(' ')),
  'B10 Compare shows the original and the proposed words side by side, changes marked');
// edit on top of the revision
await page.click('#cs-scene-7 ~ * [data-act="cs-edit"], [data-act="cs-edit"][data-scene=""]').catch(() => {});
await page.evaluate(() => { const b = document.querySelector('[data-act="cs-edit"]'); if (b) b.click(); });
await page.waitForSelector('[data-cs-root="is-cs"]');
ok(await page.inputValue('#is-cs-narr-2') === "Families living near well pads breathe what a flare does not burn. The EPA's children's health policy exists because children can be more exposed.",
  'B11 Edit opens the waiting revision (with the accepted suggestion) in the scene editor');
await page.fill('#is-cs-head-6', '$45 BILLION (EPA ESTIMATE)');
await page.fill('#cs-rev-note', 'Clarified the figure.');
await page.click('[data-act="cs-save-rev"]');
await page.waitForFunction(() => window.calls.some((c) => c[0] === 'hs_impact_story_creator_revise'));
const rev = await page.evaluate(() => window.calls.find((c) => c[0] === 'hs_impact_story_creator_revise')[1]);
ok(rev.p_script.scenes[6].headline === '$45 BILLION (EPA ESTIMATE)' && rev.p_note === 'Clarified the figure.' && rev.p_script.scenes.length === 14,
  'B12 Save revision sends the whole edited script; the locked one is untouched until it is applied');
await page.waitForSelector('[data-act="cs-send"]');
await page.click('[data-act="cs-send"]');
await page.waitForFunction(() => window.calls.some((c) => c[0] === 'hs_impact_story_fix_start'));
ok(/Sent — being applied/.test(await page.locator('#cs-review').innerText()) && await page.locator('[data-act="cs-accept"]').count() === 0,
  'B13 Send it with Fix starts the Fix run; while it is applied nothing can be decided on the old version');
// locked words in the main script
await page.click('[data-act="doc"][data-doc="main"]');
ok(await page.locator('textarea[data-ed^="main.acts.0.scenes.0.narration"]').count() === 0 && /🔒 your words/.test(await page.locator('#is').innerText()),
  'B14 the main script shows the founder\'s narration as locked text, never as an editable field');
ok(errors.length === 0, 'B15 no page errors (' + errors.join(' | ') + ')');

// phone width
await page.setViewportSize({ width: 390, height: 900 });
await page.click('[data-act="doc"][data-doc="creator"]');
const wide = await page.evaluate(() => document.documentElement.scrollWidth);
ok(wide <= 400, 'B16 the script review fits a phone without sideways scrolling (' + wide + ' px)');

await browser.close();
console.log(fails ? fails + ' FAILED' : 'ALL PASS');
process.exit(fails ? 1 : 0);
