// Real Chromium: the Tab 20 Stage 2 proof-slice screens (lib/acq-weekly-slice.js) against a STUB client.
// Every value below is TEST DATA, shaped like public.hs_weekly_overview() in docs/weekly-stage2-slice.sql; none is real
// research. No request leaves the page. Run: node test/weekly-slice.browser.test.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const fs = require('node:fs');
let fails = 0;
const ok = (c, name) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name); if (!c) fails++; };
const read = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const style = read('acquisition.html').match(/<style>[\s\S]*?<\/style>/)[0];
const HTML = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' + style +
  '</head><body><div id="ws"></div><script src="/ws.js"></script></body></html>';

const OV = {
  topic: 'Air Quality',
  requests: [{ id: 'q1', request_text: 'x', created_at: '2026-11-10T12:00:00Z' }],
  runs: [{ id: 'r1', kind: 'research_ingest', status: 'done', error: null }],
  findings: [
    { id: 'f1', finding_key: 'air-proposal-status', version: 2, statement: 'TEST: the change is proposed, not final <b>x</b>', qualifiers: ['proposed'],
      uncertainty: 'TEST', is_latest: true, human_decision: 'pending',
      sources: [{ url: 'https://example.test/a', publisher: 'TEST Agency', quote_match: 'exact', date_extraction: 'not_stated', published_date: null },
                { url: 'javascript:alert(1)', publisher: 'TEST bad link', quote_match: 'not_checked', date_extraction: 'unknown', fetch_error: 'refused: scheme' }] },
    { id: 'f0', finding_key: 'air-proposal-status', version: 1, statement: 'TEST old version', is_latest: false, human_decision: 'approved', sources: [] }],
  library_versions: [{ id: 'lv1', n: 1, sealed: true, findings: 2 }],
  profiles: [{ id: 'p1', version: 1, rules: ['TEST rule'], approved: true }],
  scripts: [{ id: 's1', body: { segments: [{ text: 'TEST spoken line about company emissions detected by third parties.', claim_ids: ['air-proposal-status@1'] }] },
    checks: { label: 'mechanical checks passed', certifies_accuracy: false }, approved: false,
    lesson_uses: [{ id: 7, lesson_id: 'l1', retrieved: true, included: true, assessed: 'applied', assessed_by: 'rule', assessment_note: 'avoid_phrase absent', reviewer_decision: 'pending' }] }],
  lessons: [{ id: 'l1', text: 'Say "company emissions detected by third parties", not "third-party leaks".', test: { type: 'avoid_phrase', value: 'third-party leaks' }, status: 'approved' }],
  corrections: [{ id: 'c1', script_id: 's0', segment_index: 0, before_text: 'TEST third-party leaks', after_text: 'TEST company emissions detected by third parties' }],
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
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
  window.client = { rpc: (n, a) => { window.calls.push([n, a]); return Promise.resolve(n === 'hs_weekly_overview' ? { data: window.fixture, error: null } : { data: 'ok', error: null }); } };
  return window.HS.acqWeeklySlice.mount(window.client, document.getElementById('ws'));
}, OV);
const T = () => page.locator('#ws').innerText();
let t = await T();

ok(t.includes('Topic: Air Quality') && t.includes('Quality-of-Life Weekly Report: Air') && t.includes('Who Saves, Who Pays?'), '1a the Air topic and working title');
const req = await page.locator('#ws-reqtext').inputValue();
ok(req.includes('WEEKLY-ANSWER v1') && req.includes('Super Emitter Program') && req.includes('proposed or final'), '1b the request names the answer format, the subject and the proposed/final rule');
ok(/Nothing is sent to Perplexity from here/.test(t), '1c the research step is manual');
// three labels, separate; no "verified"
ok(t.includes('Quote found (exact)') && t.includes('Publication date not stated') && t.includes('Your decision: pending'), '2a quote match, date and decision are shown separately');
ok(!/verified/i.test(await page.locator('#ws-findings').innerText()), '2b no finding is labelled verified');
ok(t.includes('Quote not checked (page not read)') && t.includes('Publication date unknown') && t.includes('refused: scheme'), '2c an unread page says so, and its date stays unknown');
ok(await page.locator('#ws-findings a[href^="javascript:"]').count() === 0, '2d a javascript: link is not linked');
ok(await page.locator('#ws-findings b').first().innerText() === 'TEST: the change is proposed, not final <b>x</b>', '2e statements are escaped');
ok(!t.includes('TEST old version'), '2f only the latest version of a finding is listed for review');
// scripts
ok(t.includes('mechanical checks passed') && t.includes('Automated checks; not a certification of factual accuracy.'), '3a checks are labelled mechanical, not a certification');
const spoken = await page.locator('.ws-spoken').innerText();
ok(!/air-proposal-status|\[\d+\]|https?:/.test(spoken) && await page.locator('.ws-chip').innerText() === 'air-proposal-status@1', '3b claim IDs sit beside the spoken text, never inside it');
const uses = await page.locator('.ws-uses').innerText();
ok(/Retrieved[\s\S]*Included in prompt[\s\S]*Automated assessment[\s\S]*Your review/.test(uses) && /applied \(rule\)/.test(uses) && /pending/.test(uses), '3c the four lesson-use states are separate columns');
// actions call exactly the admin functions
await page.locator('button[data-ws="decide"][data-d="approved"]').click();
await page.locator('.ws-corr').fill('TEST corrected line');
await page.locator('button[data-ws="correct"]').click();
await page.locator('.ws-ltext').fill('TEST lesson');
await page.locator('.ws-lavoid').fill('third-party leaks');
await page.locator('button[data-ws="lesson"]').click();
await page.locator('button[data-ws="use"][data-d="confirmed"]').click();
await page.locator('button[data-ws="draft"]').click();
await page.locator('#ws-answer').fill('TEST pasted answer');
await page.locator('button[data-ws="paste"]').click();
await page.waitForFunction(() => window.calls.filter((c) => c[0] !== 'hs_weekly_overview').length >= 6);
const calls = await page.evaluate(() => window.calls);
const names = calls.map((c) => c[0]).filter((n) => n !== 'hs_weekly_overview');
ok(JSON.stringify(names) === JSON.stringify(['hs_weekly_finding_decide', 'hs_weekly_correction_save', 'hs_weekly_lesson_propose',
  'hs_weekly_lesson_use_review', 'hs_weekly_script_request', 'hs_weekly_paste_answer']), '4a each button calls its admin function, in order');
const arg = (n) => calls.find((c) => c[0] === n)[1];
ok(arg('hs_weekly_finding_decide').p_decision === 'approved' && arg('hs_weekly_finding_decide').p_finding === 'f1', '4b decide sends the finding and the decision');
ok(arg('hs_weekly_lesson_propose').p_test.type === 'avoid_phrase' && arg('hs_weekly_lesson_propose').p_test.value === 'third-party leaks', '4c a lesson carries its avoid-phrase test');
ok(arg('hs_weekly_script_request').p_library_version === 'lv1' && arg('hs_weekly_script_request').p_profile === 'p1', '4d a draft is requested from the sealed version and approved profile');
ok(arg('hs_weekly_lesson_use_review').p_use === 7 && arg('hs_weekly_lesson_use_review').p_decision === 'confirmed', '4e confirming sends the use id');
ok(calls.every((c) => /^hs_weekly_/.test(c[0])), '4f only hs_weekly_* admin functions are called');
// refusals and gating
await page.evaluate(() => { window.fixture = Object.assign({}, window.fixture, { profiles: [{ id: 'p2', version: 1, rules: ['r'], approved: false }] });
  window.client.rpc('noop', {}); });
await page.evaluate(() => window.HS.acqWeeklySlice.mount(window.client, document.getElementById('ws')));
ok(await page.locator('button[data-ws="draft"]').isDisabled(), '5a no draft without an approved profile');
await page.evaluate(() => { window.client.rpc = (n) => Promise.resolve(n === 'hs_weekly_overview' ? { data: window.fixture, error: null } : { data: null, error: { message: 'not authorized' } }); });
await page.locator('button[data-ws="decide"][data-d="rejected"]').click();
await page.waitForSelector('.ws-bad[role="alert"]');
ok((await page.locator('.ws-bad[role="alert"]').innerText()) === 'not authorized', '5b a refused call is shown, not hidden');
// phone width
await page.setViewportSize({ width: 390, height: 844 });
const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
ok(over <= 0, '6 no sideways scroll at 390px (' + over + 'px)');
ok(outside.length === 0, '7a no request left the page');
ok(errors.length === 0, '7b no script errors or dialogs' + (errors.length ? ': ' + errors.join(' | ') : ''));
await browser.close();
console.log(fails ? fails + ' failed' : 'all passed');
process.exit(fails ? 1 : 0);
