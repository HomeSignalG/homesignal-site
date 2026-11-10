// Real Chromium: the Tab 20 Stage 2 slice screens, including the editorial workbench (lib/acq-weekly-slice.js), against a
// STUB client. The overview is test/fixtures/weekly-workbench-overview.json: the real answer of hs_weekly_overview on a
// disposable database (built by test/weekly_stage2_pg/build_demo_fixture.py from the "Put the conflict first"
// demonstration). Every value is TEST DATA. No request leaves the page.
//   node test/weekly-slice.browser.test.mjs [screenshot-dir]
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
let fails = 0;
const ok = (c, name) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name); if (!c) fails++; };
const read = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const shots = process.argv[2] || '';
const style = read('acquisition.html').match(/<style>[\s\S]*?<\/style>/)[0];
const HTML = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' + style +
  '</head><body><div id="ws"></div><script src="/ws.js"></script></body></html>';
const OV = JSON.parse(read('test/fixtures/weekly-workbench-overview.json'));
const scripts = OV.versions.filter((v) => v.stage === 'script');
const v1 = scripts.find((v) => v.status.superseded), v2 = scripts.find((v) => !v.status.superseded);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: shots ? 2 : 1 });
const outside = [];
await ctx.route('**/*', (r) => {
  const u = new URL(r.request().url());
  if (u.origin !== 'https://ws.test') { outside.push(u.href); return r.abort(); }
  if (u.pathname === '/ws.js') return r.fulfill({ contentType: 'text/javascript', body: read('lib/acq-weekly-slice.js') });
  if (u.pathname === '/page.png') return r.fulfill({ contentType: 'image/png', body: fs.readFileSync(new URL('../test/fixtures/weekly-doc-cue-page.png', import.meta.url)) });
  return r.fulfill({ contentType: 'text/html', body: HTML });
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('dialog', (d) => { errors.push('dialog'); d.dismiss(); });
await page.goto('https://ws.test/');
await page.evaluate((OV) => {
  window.calls = [];
  window.fixture = OV;
  window.client = { rpc: (n, a) => { window.calls.push([n, a]); return Promise.resolve(n === 'hs_weekly_overview' ? { data: window.fixture, error: null } : { data: { ok: true }, error: null }); } };
  // private-bucket download stub: every object is the fixture page (Tab 16's page 1 render of the EPA proposed rule)
  window.downloads = [];
  window.client.storage = { from: (b) => ({ download: (name) => { window.downloads.push(b + '/' + name);
    return fetch('/page.png').then((r) => r.blob()).then((d) => ({ data: d, error: null })); } }) };
  return window.HS.acqWeeklySlice.mount(window.client, document.getElementById('ws'));
}, OV);
const T = (sel) => page.locator(sel || '#ws').innerText();
let t = await T();

ok(t.includes('Topic: Air Quality') && t.includes('Quality-of-Life Weekly Report: Air'), '1a the Air topic and working title');
ok(/Nothing is sent to Perplexity from here/.test(t), '1b the research step is manual');
ok(t.includes('Quote found (exact)') && t.includes('Your decision: approved') && !/verified/i.test(await T('#ws-findings')), '1c quote match and decision are separate; nothing says verified');
// angle cards
const ang = await T('#ws-angles');
ok((await page.locator('#ws-angles .ws-card').count()) === 3 && ang.includes('Why it differs') && ang.includes('opens on the mechanism'), '2a three cards, each with why it differs');
ok(/may share evidence\. You decide whether they are meaningfully different/.test(ang), '2b distinctness is the reviewer’s decision');
ok(ang.includes('Approved (this version)') && (await page.locator('#ws-angles input[name="ws-angle"]:checked').getAttribute('value')) === '0', '2c the approved selection is shown');
ok(ang.includes('public_interest') && ang.includes('contradiction') && ang.includes('misleading_framing'), '2d categories may differ but are not required to');
// outline
const out = await T('#ws-outline');
ok(out.includes('collision') && out.includes('landing') && out.includes('a guide, not fixed wording') && out.includes('Approved (this version)'), '3a the outline and its status');
// editor
const ed = await T('#ws-scripts');
ok((await page.locator('.ws-grid .ws-left').count()) === 1 && (await page.locator('.ws-grid .ws-center').count()) === 1 &&
  (await page.locator('.ws-grid .ws-right').count()) === 1 && (await page.locator('.ws-bottom').count()) === 1, '4a left, center, right and bottom panes');
ok(ed.includes('Evidence') && ed.includes('Quotes') && ed.includes('Unresolved questions') && ed.includes('how often reports led to action'), '4b left: angle, evidence, quotes, unresolved questions');
const spoken = await page.locator('.ws-center .ws-spoken').first().innerText();
ok(spoken.startsWith('Under an EPA proposal') && !/@\d|https?:/.test(spoken) && (await page.locator('.ws-center .ws-seg').first().locator('.ws-chip').count()) === 4, '4c center: version 2 by beat, claim ids beside the spoken text');
ok((await page.locator('.ws-center .ws-beat').first().innerText()).toLowerCase().startsWith('collision'), '4d passages are labelled by beat');
ok((await page.locator('.ws-action option').count()) >= 7 && ed.includes('Put the conflict first') && ed.includes('Strengthen the closing'), '4e the seven rewrite actions are offered');
ok(ed.includes('Quote: not found in the sources reviewed') && ed.includes('Quote: contradicted by evidence'), '4f reviewer quote findings are separate choices');
ok((await T('.ws-spokenwords')) === String(v2.checks.word_counts.spoken_words) && ed.includes('notes and sources: 0') && ed.includes('No rhythm warnings.'), '4g right: spoken words counted apart; no warnings on version 2');
ok((await page.locator('.ws-dim').count()) === 7 && ed.includes('Provisional internal criteria, not validated performance benchmarks') && ed.includes('factual discipline = 4'), '4h the seven-dimension rubric and its gates');
const bot = await T('.ws-bottom');
ok(bot.includes('a person changed only a document visual') && bot.includes('Put the conflict first.') && bot.includes('For several years') && bot.includes('Under an EPA proposal') && bot.includes('lesson reusable'), '4i bottom: before and after with the reason, findings and lesson scope');
ok(bot.includes('Superseded by a newer version') && bot.includes('Not approved') && bot.includes('No decision on this version.'), '4j version history: the new version needs its own approval');
ok(bot.includes('Audience outcomes: not collected') && bot.includes('No virality or improvement is claimed'), '4k measurement kept apart; no audience or virality claim');
// title section
const tsec = await T('#ws-title');
ok((await T('.ws-title-text')) === '$45B Gift to Oil\u2014At Your Expense', 'T1 the approved title renders exactly, punctuation included');
ok(tsec.includes('Wording: approved (this version)') && tsec.includes('Fixture approval (a test identity on a disposable database). Not a production approval.') &&
  !tsec.includes('2026-11-10 '), 'T2 the fixture approval is labelled as fixture data, with no invented time');
ok(tsec.includes('waiting for a person’s review (not cleared)') && tsec.includes('Publication: not approved') &&
  (await page.locator('button[data-ws="title-publish"]').isDisabled()), 'T3 editorial approval does not clear evidence or approve publication');
ok(tsec.includes('Approving the wording does not clear the evidence or approve publication'), 'T4 the three decisions are said to be separate');
ok(tsec.includes('Why it was selected') && tsec.includes('approved by the founder in a conversation'), 'T5 why it was selected');
ok(tsec.includes('editorial characterization, not an allegation of a crime') && !/criminal_implication/.test(tsec), 'T6 “gift” is a characterization, not a crime finding');
const tprofText = await page.locator('.ws-tprof').textContent();
ok((await page.locator('.ws-tpref').count()) === 7 && tprofText.includes('not part of the approval of this episode’s title') &&
  tprofText.includes('no future title has to use a dollar amount') && (tprofText.match(/inferred/g) || []).length >= 7, 'T7 seven editable inferred preferences, kept apart from the approval');
ok(tsec.includes('Candidate history (1 version)') && !/viral/i.test(tsec), 'T8 candidate history; no virality label');
if (shots) {
  await page.evaluate(() => document.querySelectorAll('#ws-title details').forEach((d) => { d.open = true; }));
  await page.locator('#ws-title').screenshot({ path: path.join(shots, 'weekly-title.png') });
  await page.evaluate(() => document.querySelectorAll('#ws-title details').forEach((d) => { d.open = false; }));
}
if (shots) {
  await page.locator('#ws-angles').screenshot({ path: path.join(shots, 'weekly-workbench-angles.png') });
  await page.locator('#ws-scripts').screenshot({ path: path.join(shots, 'weekly-workbench-editor.png') });
  await page.locator('.ws-bottom').screenshot({ path: path.join(shots, 'weekly-workbench-before-after.png') });
}
// DOCUMENT CUE on passage 1 of the current version: resolved against the stored EPA proposed rule by the engine
const cueSeg = page.locator('.ws-center .ws-seg').nth(0), plainSeg = page.locator('.ws-center .ws-seg').nth(1);
const cueRes = v2.visual_checks.segments[0], cueDoc = cueRes.scene.doc;
const ct = await cueSeg.innerText();
ok(v2.kind === 'human_reviewed' && v2.cues === 1 && ct.includes('Document visual (chosen by a person)') && ct.includes('EPA, Proposed Rule, 91 FR 68234') &&
  ct.includes('page 1') && ct.includes('First, the EPA proposes to rescind the Super Emitter Program.') && ct.includes('Found in the stored document on page 1'), 'C1 the cue: source, page, exact words, resolved');
await page.waitForFunction(() => document.querySelector('.ws-docpassage') && document.querySelector('.ws-docpassage').getAttribute('data-drawn'));
const dl = await page.evaluate(() => window.downloads);
ok(dl.length === 1 && dl[0] === cueRes.preview_path && dl[0].startsWith('weekly-visuals/' + v2.id + '/pages/'), 'C2 the page image is Tab 16’s staged page, from the private bucket');
const prev = await page.evaluate(() => {
  const img = document.querySelector('.ws-docpage img'), hl = [...document.querySelectorAll('.ws-docpage .ws-hl')];
  return { w: img.naturalWidth, h: img.naturalHeight, n: hl.length, bg: hl.length ? getComputedStyle(hl[0]).backgroundColor : '',
    left: hl.length ? hl[0].style.left : '', drawn: document.querySelector('.ws-docpassage').getAttribute('data-drawn') };
});
ok(prev.w === cueDoc.pageWidthPx && prev.h === cueDoc.pageHeightPx && prev.n === cueDoc.highlights.length && prev.n === 2 &&
  prev.bg === 'rgba(255, 200, 40, 0.45)' && Math.abs(parseFloat(prev.left) - cueDoc.highlights[0].x * 100) < 0.01 && prev.drawn === '2', 'C3  the engine’s highlight boxes, in DocScene’s yellow, on the page and on the readable passage');
const pt = await plainSeg.innerText();
ok(pt.includes('No document visual. Citing a source does not add one; a person chooses it.') && (await plainSeg.locator('.ws-docprev').count()) === 0 &&
  v2.body.segments[1].claim_ids.includes('air-proposal-status@1'), 'C4 a passage citing the same finding with a stored document has no visual unless chosen');
ok(!(await page.locator('button[data-ws="approve-script"]').isDisabled()) && (await page.locator('.ws-cueblock').count()) === 0, 'C5 a resolved cue does not block approval');
if (shots) {
  await cueSeg.screenshot({ path: path.join(shots, 'weekly-doc-cue.png') });
  await page.locator('.ws-docpassage').screenshot({ path: path.join(shots, 'weekly-doc-cue-passage.png') });
}
// set and remove cues: exactly the admin function, with the cue's own fields
await plainSeg.locator('.ws-cueform summary').click();
await plainSeg.locator('.ws-cuequote').fill('First, the EPA proposes to rescind the Super Emitter Program.');
await plainSeg.locator('button[data-ws="cue-set"]').click();
ok((await T('.ws-bad')).includes('Give the page number'), 'C6 a PDF cue needs its page');
await plainSeg.locator('.ws-cueform summary').click();   // the error re-rendered the screen
await plainSeg.locator('.ws-cuequote').fill('First, the EPA proposes to rescind the Super Emitter Program.');
await plainSeg.locator('.ws-cuepage').fill('1');
await plainSeg.locator('button[data-ws="cue-set"]').click();
await page.waitForFunction(() => window.calls.some((c) => c[0] === 'hs_weekly_doc_cue_set'));
let cc = (await page.evaluate(() => window.calls)).find((x) => x[0] === 'hs_weekly_doc_cue_set')[1];
ok(cc.p_script === v2.id && cc.p_segment === 1 && JSON.stringify(cc.p_cue) === JSON.stringify({ type: 'doc', claim_id: 'air-proposal-status@1',
  source_id: v2.body.segments[0].visual.source_id, page: 1, quote: 'First, the EPA proposes to rescind the Super Emitter Program.', highlight: 'yellow' }), 'C7 setting a cue sends the person’s choice');
await page.locator('.ws-center .ws-seg').nth(0).locator('button[data-ws="cue-remove"]').click();
await page.waitForFunction(() => window.calls.filter((c) => c[0] === 'hs_weekly_doc_cue_set').length >= 2);
cc = (await page.evaluate(() => window.calls)).filter((x) => x[0] === 'hs_weekly_doc_cue_set')[1][1];
ok(cc.p_segment === 0 && cc.p_cue === null, 'C8 removing a cue');
// an unresolved cue: flagged, nothing drawn in its place, approval blocked; an unchecked cue blocks too
const remount = (fx) => page.evaluate((fx) => { window.fixture = fx; window.downloads = []; return window.HS.acqWeeklySlice.mount(window.client, document.getElementById('ws')); }, fx);
const bad = JSON.parse(JSON.stringify(OV)), bv = bad.versions.find((v) => v.id === v2.id);
bv.visual_checks = { ok: false, unresolved: 1, segments: [{ segment: 0, status: 'unresolved', scene: null, problems: ['the words to highlight are not in the document'] }, { segment: 1, status: 'none' }] };
await remount(bad);
const bt = await page.locator('.ws-center .ws-seg').nth(0).innerText();
ok(bt.includes('Not resolved. Nothing is shown in its place.') && bt.includes('the words to highlight are not in the document') &&
  (await page.locator('.ws-docprev').count()) === 0 && (await page.evaluate(() => window.downloads.length)) === 0, 'C9 an unresolved cue is flagged; no page and no substitute image');
ok((await page.locator('button[data-ws="approve-script"]').isDisabled()) && (await T('.ws-cueblock')).includes('not resolved'), 'C10 an unresolved cue blocks approval');
bv.visual_checks = null;
await remount(bad);
ok((await page.locator('.ws-center .ws-seg').nth(0).innerText()).includes('Not checked against the stored document yet.') &&
  (await page.locator('button[data-ws="approve-script"]').isDisabled()), 'C11 an unchecked cue blocks approval');
await remount(OV);
await page.waitForFunction(() => document.querySelector('.ws-docpassage') && document.querySelector('.ws-docpassage').getAttribute('data-drawn'));
// version 1 (open from history): the weak opening and its warnings; no approval offered on a superseded version
await page.locator('button[data-ws="open"]').first().click();
const ed1 = await T('#ws-scripts');
ok(ed1.includes('delayed_conflict') && ed1.includes('late_public_stake') && ed1.includes('automated assessments, not factual findings'), '5a version 1 shows its rhythm warnings, labelled automated');
ok((await page.locator('button[data-ws="approve-script"]').count()) === 0 && (await page.locator('button[data-ws="rewrite"]').count()) === 0, '5b a superseded version cannot be approved or rewritten');
if (shots) await page.locator('#ws-scripts').screenshot({ path: path.join(shots, 'weekly-workbench-version1.png') });
await page.locator('button[data-ws="open"]').last().click();
// actions call exactly the admin functions with the right arguments
const nCalls = async () => (await page.evaluate(() => window.calls)).filter((c) => c[0] !== 'hs_weekly_overview');
await page.locator('button[data-ws="approve-script"]').click();
ok((await T('.ws-bad')).includes('Score all seven rubric dimensions'), '6a approval needs all seven scores');
for (const [d, v] of [['hook_conflict', 3], ['human_stakes', 3], ['emotional_force', 3], ['argument_coherence', 3], ['factual_discipline', 4], ['spoken_clarity', 3], ['closing', 3]])
  await page.locator('.ws-dim[data-d="' + d + '"]').fill(String(v));
await page.locator('button[data-ws="approve-script"]').click();
await page.waitForFunction(() => window.calls.some((c) => c[0] === 'hs_weekly_version_approve'));
let c = (await nCalls()).find((x) => x[0] === 'hs_weekly_version_approve')[1];
ok(c.p_version === v2.id && c.p_rubric.factual_discipline === 4 && Object.keys(c.p_rubric).length === 7 && c.p_high_risk_ack === false, '6b approval binds the open version with the rubric');
await page.locator('button[data-ws="rewrite"]').first().click();
ok((await T('.ws-bad')).includes('Say why'), '6c a rewrite needs a reason');
await page.locator('.ws-reason').first().fill('TEST DATA: still slow to the point');
await page.locator('.ws-action').first().selectOption('tighten');
await page.locator('.ws-scope').first().selectOption('reusable');
await page.locator('button[data-ws="rewrite"]').first().click();
await page.waitForFunction(() => window.calls.some((c) => c[0] === 'hs_weekly_passage_review'));
c = (await nCalls()).find((x) => x[0] === 'hs_weekly_passage_review')[1];
ok(c.p_script === v2.id && c.p_decision === 'rewrite' && c.p_action === 'tighten' && c.p_lesson_scope === 'reusable' &&
  JSON.stringify(c.p_finding_ids) === JSON.stringify(v2.body.segments[0].claim_ids), '6d a rewrite keeps the passage’s findings');
await page.locator('.ws-review').first().selectOption('quote_contradicted');
await page.locator('.ws-reason').first().fill('TEST DATA: a later finding contradicts it');
await page.locator('.ws-fids').first().fill('air-proposal-status@1');
await page.locator('button[data-ws="review"]').first().click();
await page.waitForFunction(() => window.calls.filter((c) => c[0] === 'hs_weekly_passage_review').length >= 2);
c = (await nCalls()).filter((x) => x[0] === 'hs_weekly_passage_review')[1][1];
ok(c.p_decision === 'quote_contradicted' && c.p_finding_ids[0] === 'air-proposal-status@1', '6e a reviewer quote finding carries its findings');
await page.locator('button[data-ws="approve-angle"]').click();
await page.waitForFunction(() => window.calls.filter((c) => c[0] === 'hs_weekly_version_approve').length >= 2);
c = (await nCalls()).filter((x) => x[0] === 'hs_weekly_version_approve')[1][1];
ok(c.p_selected === 0 && c.p_rubric === null, '6f approving an angle sends the selected card');
const tv = OV.versions.find((v) => v.stage === 'title');
await page.locator('.ws-tnew').fill('TEST DATA: a different wording');
await page.locator('button[data-ws="title-edit"]').click();
await page.waitForFunction(() => window.calls.some((c) => c[0] === 'hs_weekly_title_propose'));
c = (await nCalls()).find((x) => x[0] === 'hs_weekly_title_propose')[1];
ok(c.p_parent === tv.id && c.p_candidates[0].title === 'TEST DATA: a different wording' &&
  JSON.stringify(c.p_candidates[0].input) === JSON.stringify(tv.body.candidates[0].input), 'T9 editing proposes a new version from the approved one');
await page.locator('button[data-ws="title-evidence"][data-d="concerns"]').click();
ok((await T('.ws-bad')).includes('Describe the concern'), 'T10 a concern needs a note');
await page.locator('.ws-treason').fill('TEST DATA: check the beneficiary wording');
await page.locator('button[data-ws="title-evidence"][data-d="concerns"]').click();
await page.waitForFunction(() => window.calls.some((c) => c[0] === 'hs_weekly_title_evidence_review'));
c = (await nCalls()).find((x) => x[0] === 'hs_weekly_title_evidence_review')[1];
ok(c.p_decision === 'concerns' && c.p_version === tv.id && !(await nCalls()).some((x) => x[0] === 'hs_weekly_title_propose' && x[1].p_candidates[0].title !== 'TEST DATA: a different wording'),
  'T11 a concern is recorded and never rewrites the title');
await page.locator('.ws-tprof summary').click();
await page.locator('.ws-tpref').first().fill('Concrete benefit first, when the findings support one.');
await page.locator('button[data-ws="title-profile-save"]').click();
await page.waitForFunction(() => window.calls.some((c) => c[0] === 'hs_weekly_profile_create'));
c = (await nCalls()).find((x) => x[0] === 'hs_weekly_profile_create')[1];
ok(c.p_scope === 'title' && c.p_rules.length === 7 && c.p_rules[0].text.startsWith('Concrete benefit first, when') && c.p_rules[0].origin === 'user', 'T12 edited preferences become a new title profile version');
ok((await nCalls()).every((x) => /^hs_weekly_/.test(x[0])), '6g only hs_weekly_* admin functions are called');
// a refused call is shown
await page.evaluate(() => { window.client.rpc = (n) => Promise.resolve(n === 'hs_weekly_overview' ? { data: window.fixture, error: null } : { data: null, error: { message: 'outdated: the outline it was written from has a newer version' } }); });
for (const [d, v] of [['hook_conflict', 3], ['human_stakes', 3], ['emotional_force', 3], ['argument_coherence', 3], ['factual_discipline', 4], ['spoken_clarity', 3], ['closing', 3]])
  await page.locator('.ws-dim[data-d="' + d + '"]').fill(String(v));
await page.locator('button[data-ws="approve-script"]').click();
await page.waitForSelector('.ws-bad[role="alert"]');
ok((await T('.ws-bad[role="alert"]')).startsWith('outdated'), '7 a refused approval is shown, not hidden');
// phone width
await page.setViewportSize({ width: 390, height: 844 });
const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
ok(over <= 0, '8 no sideways scroll at 390px (' + over + 'px)');
if (shots) await page.locator('#ws-scripts').screenshot({ path: path.join(shots, 'weekly-workbench-phone.png') });
ok(outside.length === 0, '9a no request left the page');
ok(errors.length === 0, '9b no script errors or dialogs' + (errors.length ? ': ' + errors.join(' | ') : ''));
await browser.close();
console.log(fails ? fails + ' failed' : 'all passed');
process.exit(fails ? 1 : 0);
