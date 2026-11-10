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
ok(bot.includes('Put the conflict first.') && bot.includes('For several years') && bot.includes('Under an EPA proposal') && bot.includes('lesson reusable'), '4i bottom: before and after with the reason, findings and lesson scope');
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
