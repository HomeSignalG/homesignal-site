// Real Chromium: the ACTUAL acquisition.html entry point, Tab 20 · Weekly Report (the queue-only release), against a
// stub Supabase client. Nothing here reaches a database or the network.
//
// The stub REPLAYS test/fixtures/weekly-queue-only-flow.json, which test/weekly_stage2_pg/build_queue_only_flow.py built
// by making these same calls against the queue-only SQL (docs/weekly-1-base.sql + docs/weekly-2-topic-queue.sql) on a
// disposable Postgres. So: every screen below is what that SQL returned, and the page must make exactly the recorded
// calls, in order, with the recorded arguments. A call the fixture does not expect is answered with an error and fails
// the test. The two founder leads are UNVERIFIED fixtures; everything else is TEST DATA.
//   node test/weekly-tab20.browser.test.mjs [screenshot-dir]
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile } from './lib/serve-page.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, normalize } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const fs = require('node:fs');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0;
const ok = (c, name, detail) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name); if (!c) { fails++; if (detail !== undefined) console.log('           detail: ' + JSON.stringify(detail).slice(0, 600)); } };
const shots = process.argv[2] || '';
const F = JSON.parse(fs.readFileSync(join(root, 'test/fixtures/weekly-queue-only-flow.json'), 'utf8'));
const ID = F.ids;

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = createServer(async (req, res) => {
  const p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
  if (!p.startsWith(root)) { res.writeHead(403).end(); return; }
  try { res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' }).end(await readFile(p)); }
  catch { res.writeHead(404).end('not found'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;

// ── the stub backend: replays the fixture ──
const QUEUE_FNS = ['hs_weekly_edition_close', 'hs_weekly_edition_create', 'hs_weekly_edition_publish', 'hs_weekly_lead_assign', 'hs_weekly_lead_disposition',
  'hs_weekly_lead_save', 'hs_weekly_lead_send_to_research', 'hs_weekly_topic_queue'];
let at = 0;                       // steps consumed
const calls = [], unexpected = [];
function rpc(name, args) {
  calls.push([name, args]);
  if (name === 'hs_acquisition_dashboard') return { data: { tabs: {}, meta: { snapshot: 'TEST' }, S: [] }, error: null };
  if (!/^hs_weekly_/.test(name)) return { data: null, error: null };          // every other tab's reads: empty
  // The Bluesky sources (docs/weekly-bluesky-sources.sql) are not part of the queue-only release this fixture recorded:
  // answered as that database answers, "not found", which the page reads as "not installed" and hides the section.
  if (name === 'hs_weekly_bsky_sources') return { data: null, error: { message: 'Could not find the function public.hs_weekly_bsky_sources(p_edition) in the schema cache', code: 'PGRST202' } };
  // Same for the Perplexity status reader (docs/weekly-perplexity-api.sql): not installed there, so the page shows the paste path.
  if (name === 'hs_weekly_perplexity_status') return { data: null, error: { message: 'Could not find the function public.hs_weekly_perplexity_status(p_requests) in the schema cache', code: 'PGRST202' } };
  if (name === 'hs_weekly_topic_queue') {
    const qs = at ? F.steps[at - 1].queues : F.initial, key = (args && args.p_edition) || '';
    if (!(key in qs)) { unexpected.push([name, args]); return { data: null, error: { message: 'STUB: no recorded queue for that edition' } }; }
    return { data: qs[key], error: null };
  }
  const want = F.steps[at];
  if (!want || want.rpc !== name || !isDeepStrictEqual(want.args, args)) {
    unexpected.push({ got: [name, args], want: want && [want.rpc, want.args] });
    return { data: null, error: { message: 'STUB: unexpected call ' + name } };
  }
  at++;
  return want.error ? { data: null, error: { message: want.error } } : { data: want.result, error: null };
}
const FAKE_SUPABASE = `(function(){
  function builder(){ var b = {}; ['select','eq','order','limit','range','in','neq','gte','lte','lt','gt','is','or','not','single','maybeSingle','ilike','like','filter','contains','match','insert','upsert','update','delete']
    .forEach(function(m){ b[m] = function(){ return b; }; }); b.then = function(res, rej){ return Promise.resolve({ data: [], error: null }).then(res, rej); }; return b; }
  var session = { access_token: 'TEST', user: { id: '00000000-0000-0000-0000-000000000001', email: 'founder@test.invalid' } };
  var client = { from: builder, rpc: function(n, a){ return window.__rpc(n, a === undefined ? null : a); },
    storage: { from: function(){ window.__storageTouched = true; return { download: function(){ return Promise.resolve({ data: null, error: { message: 'none' } }); },
      createSignedUrl: function(){ return Promise.resolve({ data: null, error: { message: 'none' } }); } }; } },
    functions: { invoke: function(){ return Promise.resolve({ data: null, error: null }); } },
    auth: { getSession: function(){ return Promise.resolve({ data: { session: session } }); }, getUser: function(){ return Promise.resolve({ data: { user: session.user } }); },
      onAuthStateChange: function(){ return { data: { subscription: { unsubscribe: function(){} } } }; }, signOut: function(){ return Promise.resolve({ error: null }); } } };
  window.supabase = { createClient: function(){ return client; } };
})();`;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1300, height: 900 }, deviceScaleFactor: shots ? 2 : 1 });
await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
const outside = [];
await ctx.route('**/*', (r) => {
  const url = r.request().url();
  if (url.startsWith(base)) return r.continue();
  if (url.includes('@supabase/supabase-js')) return r.fulfill({ status: 200, contentType: 'text/javascript', body: FAKE_SUPABASE });
  outside.push(url);
  return r.fulfill({ status: 200, contentType: /\.js(\?|$)/.test(url) ? 'text/javascript' : 'text/plain', body: '' });
});
await ctx.exposeFunction('__rpc', rpc);
// A Stage 1 browser draft and an unrelated key exist before the page loads. Neither may be touched.
const STAGE1 = JSON.stringify({ schema: 'stage1', note: 'TEST: a Stage 1 browser-only draft that must survive untouched', items: [1, 2, 3] });
await ctx.addInitScript(([k, v]) => {
  if (!window.localStorage.getItem(k)) { window.localStorage.setItem(k, v); window.localStorage.setItem('unrelated-key', 'keep me'); }
  window.__storageWrites = [];
  ['setItem', 'removeItem', 'clear'].forEach((m) => { const o = Storage.prototype[m]; Storage.prototype[m] = function () { window.__storageWrites.push([m, arguments[0]]); return o.apply(this, arguments); }; });
}, ['hs-weekly-report-stage1', STAGE1]);
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('dialog', (d) => { errors.push('dialog: ' + d.message()); d.dismiss(); });

const T = (sel) => page.locator(sel).innerText();
const card = (id) => page.locator('#tab-weeklyreport .tq-lead[data-lead="' + id + '"]');
const view = (v) => page.click('#tab-weeklyreport .tq-tabs button[data-v="' + v + '"]');
const wait = async (n, re) => { for (let i = 0; i < 200 && at < n; i++) await page.waitForTimeout(25); if (re) await page.waitForFunction((s) => new RegExp(s).test(document.querySelector('#tab-weeklyreport').innerText), re.source); };
const shot = async (sel, name) => { if (shots) await page.locator(sel).first().screenshot({ path: join(shots, name) }); };
async function openTab() {
  await page.goto(base + '/acquisition.html', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#dash-root', { state: 'visible' });
  if (!openTab.checked) {
    // 0 the workbench file is on the page as a library only: loading it mounts nothing, calls nothing and requests nothing
    openTab.checked = true;
    await page.waitForTimeout(400);
    const lib = await page.evaluate(() => ({ format: /WEEKLY-ANSWER v1/.test(window.HS.acqWeeklySlice.answerFormatText()), css: !!document.getElementById('ws-css') || !!document.getElementById('tq-css'),
      dom: document.querySelectorAll('[class^="ws-"], [class^="tq-"]').length, tab: document.getElementById('tab-weeklyreport').innerHTML }));
    ok(lib.format && !lib.css && lib.dom === 0 && lib.tab === '' && !calls.some((c) => /^hs_weekly_/.test(c[0])) && outside.length === 0,
      '0 before Tab 20 is opened: the library is loaded and has mounted nothing, added no style, made no weekly call and no request', lib);
  }
  await page.click('nav.tabs button[data-tab="weeklyreport"]');
  await page.waitForSelector('#tab-weeklyreport .tq-root #tq-list');
}
async function capture(fields) {
  await page.fill('#tq-title', fields.title);
  const extra = Object.keys(fields).filter((k) => k !== 'title');
  if (extra.length) {
    if (!(await page.locator('#tq-more').evaluate((d) => d.open))) await page.click('#tq-more > summary');
    const sel = { topic: '#tq-topic', location: '#tq-location', notes: '#tq-notes', commitment_wording: '#tq-commit-wording', commitment_post_url: '#tq-commit-url' };
    for (const k of extra) {
      if (k === 'topic') await page.selectOption(sel.topic, fields.topic);
      else if (k === 'questions') await page.fill('#tq-questions', fields.questions.join('\n'));
      else await page.fill(sel[k], fields[k]);
    }
  }
  await page.click('#tq-capture button[data-tq="save"]');
}
async function newEdition(topic, start) {
  if (!(await page.locator('#tq-newed').evaluate((d) => d.open))) await page.click('#tq-newed > summary');
  await page.selectOption('#tq-ed-topic', topic); await page.fill('#tq-ed-start', start);
  await page.click('button[data-tq="create-edition"]');
}

// ── 1 the page: Tab 20 exists, is the queue, and the editorial workbench is not rendered ──
await openTab();
const labels = await page.locator('nav.tabs button').evaluateAll((bs) => bs.map((b) => b.textContent));
ok(labels.length === 20 && labels[19] === '20 · Weekly Report' && labels[16] === '17 · Impact Stories' && labels[18] === '19 · Claim Check', '1a Tab 20 is "20 · Weekly Report"; tabs 1-19 keep their labels');
ok((await page.locator('#tab-weeklyreport .tq-root').count()) === 1 && (await page.locator('.ws-root, .ws-slice-host, .ws-topics-host').count()) === 0, '1b the queue is mounted directly; the editorial workbench is not rendered');
ok(await page.evaluate(() => !!(window.HS.acqImpactStories && window.HS.acqClaimCheck && document.getElementById('tab-impactstories') && document.getElementById('tab-claimcheck'))), '1c the other tabs’ modules and containers are still there');
const empty = await T('#tab-weeklyreport');
ok(/No unassigned topics/.test(empty) && /Nothing here posts, publishes or starts a job/.test(empty), '1d an empty queue says so');
ok(isDeepStrictEqual(F.initial[''].capabilities, { version_linking: false, answer_processing_installed: false }), '1e the queue-only database reports no version linking and no answer processing');
await shot('#tab-weeklyreport', 'A1-tab20-empty-queue.png');

// ── 2 capture with a title only; it is still there after a full page reload ──
const LQ = F.steps[0].args.p_fields;
await capture(LQ); await wait(1, /Topic captured/);
ok(at === 1 && (await card(ID.lq).getAttribute('data-status')) === 'captured' && (await card(ID.lq).innerText()).includes(LQ.topic), '2a a lead saved with its title and category is Captured');
await shot('#tab-weeklyreport', 'A2-title-only-captured.png');
await openTab();
ok((await card(ID.lq).count()) === 1 && (await card(ID.lq).innerText()).includes(LQ.title), '2b after reloading the page the lead is read back from the database');

// ── 3 Water and Data Centers leads (the founder's two, unverified) ──
await capture(F.steps[1].args.p_fields); await wait(2, /Topic captured/);
await capture(F.steps[2].args.p_fields); await wait(3, /Topic captured/);
// the notes, questions, sources and edition history sit under each card's Details
const openDetails = async (c) => { if (!(await c.locator('.tq-details').evaluate((d) => d.open))) await c.locator('.tq-details > summary').click(); };
await openDetails(card(ID.l2)); await openDetails(card(ID.l1));
const cW = await card(ID.l2).innerText(), cD = await card(ID.l1).innerText();
ok(at === 3 && /Water Quality/.test(cW) && /UNVERIFIED LEAD/.test(cW) && /No source address recorded/.test(cW) && !/Promised publicly/.test(cW)
  && /Data Centers/.test(cD) && /Cochise County, Arizona/.test(cD) && /UNVERIFIED LEAD/.test(cD), '3a the Water and Data Centers leads are captured, unverified, with no address and no promise');
await newEdition('Water Quality', '2026-11-09'); await wait(4, /Edition water-quality-2026-11-09 created/);
await newEdition('Data Centers', '2026-11-09'); await wait(5, /Edition data-centers-2026-11-09 created/);
ok(at === 5 && /Linking a script to an edition is unavailable in this release/.test(await T('#tq-editions')) && (await page.locator('#tq-version, button[data-tq="link-version"]').count()) === 0, '3b editions for both categories; version linking is shown as unavailable, with no control');

// ── 4 prepare a research request: prepared, not submitted; nothing can be processed ──
const c1 = card(ID.l1);
ok(/Prepare research request/.test(await c1.innerText()) && !/Send to research/.test(await T('#tab-weeklyreport')), '4a the action is labelled "Prepare research request"');
await c1.locator('.tq-send-edition').selectOption(ID.ec);
await shot('#tab-weeklyreport .tq-lead[data-lead="' + ID.l1 + '"]', 'B1-choose-edition-and-prepare.png');
await c1.locator('button[data-tq="send"]').click(); await wait(6, /Research request prepared: request/);
ok(at === 6 && /Nothing was submitted for processing/.test(await T('#tab-weeklyreport .tq-ok')), '4b the confirmation says the request was prepared and nothing was submitted');
await shot('#tab-weeklyreport .tq-root > .card', 'B2-request-prepared-confirmation.png');
await view('research');
const prepared = await c1.innerText();
ok(/Research request prepared/.test(await c1.locator('.tq-status').innerText()) && !/Researching|Queued for research/.test(prepared)
  && /Research requests prepared/.test(await T('#tab-weeklyreport .tq-tabs')), '4c the lead reads "Research request prepared", never Researching or Queued');
await c1.locator('.tq-request > summary').click();
const reqText = await c1.locator('.tq-reqtext').inputValue();
ok(/prepared, not submitted/.test(await c1.locator('.tq-request > summary').innerText()) && reqText.includes('1. What is the power demand?') && reqText.includes('WEEKLY-ANSWER v1')
  && reqText.includes('Location: Cochise County, Arizona'), '4d the prepared request carries the questions, the location and the answer format');
const dis = c1.locator('.tq-unavailable button');
ok((await dis.count()) === 1 && (await dis.isDisabled()) && /Submit an answer for processing/.test(await dis.innerText())
  && /Unavailable in this release: research processing is not deployed/.test(await c1.locator('.tq-unavailable').innerText())
  && (await c1.locator('.tq-answer, button[data-tq="paste"]').count()) === 0, '4e processing is a disabled action with its reason; there is no answer box');
const before = calls.length;
await dis.click({ force: true }).catch(() => {});
await c1.locator('button[data-tq="copy"]').click();
await page.waitForFunction((id) => /Copied/.test(document.querySelector('.tq-lead[data-lead="' + id + '"] .tq-copied').textContent), ID.l1);
ok((await page.evaluate(() => navigator.clipboard.readText())) === reqText && calls.length === before
  && (await c1.getAttribute('data-status')) === 'queued_for_research' && /Research request prepared/.test(await c1.locator('.tq-status').innerText()), '4f copying the request makes no call and changes no status; the disabled action does nothing');
await shot('#tab-weeklyreport .tq-lead[data-lead="' + ID.l1 + '"]', 'B3-prepared-request-processing-unavailable.png');

// ── 5 commitment tracking: a promised lead, deferred only with a reason ──
await capture(F.steps[6].args.p_fields); await wait(7, /Topic captured/);
await view('promised');
const cp = card(ID.lp);
ok(at === 7 && (await cp.locator('.tq-promised').count()) === 1 && /This records the promise\. It is not evidence for the story\./.test(await cp.innerText()), '5a the promised lead carries its flag, shown as a promise and not as evidence');
await cp.locator('.tq-send-edition').selectOption(ID.ew);
await cp.locator('button[data-tq="send"]').click(); await wait(8, /Research request prepared/);
ok(at === 8 && (await cp.locator('.tq-promised').count()) === 1 && /Research request prepared/.test(await cp.locator('.tq-status').innerText()), '5b the flag stays beside the new status');
await cp.locator('button[data-d="deferred"]').click(); await wait(9);
await page.waitForSelector('#tab-weeklyreport .tq-root [role="alert"]');
ok(at === 9 && /promised publicly: say why it is deferred/.test(await T('#tab-weeklyreport .tq-root [role="alert"]')) && (await cp.getAttribute('data-status')) === 'queued_for_research', '5c deferring a promised lead with no reason is refused and nothing changes');
await cp.locator('.tq-reason').fill(F.steps[9].args.p_reason);
await shot('#tab-weeklyreport .tq-lead[data-lead="' + ID.lp + '"]', 'C1-promised-lead-defer-with-reason.png');
await cp.locator('button[data-d="deferred"]').click(); await wait(10, /Decision recorded/);
await view('deferred');
ok(at === 10 && (await cp.getAttribute('data-status')) === 'deferred' && /Deferred from the Water Quality report, Nov 9–15, 2026: TEST: the record is not public yet/.test(await cp.innerText())
  && (await cp.locator('.tq-promised').count()) === 1, '5d deferred with its reason; it is in carry forward and still flagged as promised');
// the only other open report is Data Centers: the database would refuse it for a Water topic, and the report it was deferred from would be refused too
ok((await cp.locator('.tq-send-edition, button[data-tq="send"], button[data-tq="assign"]').count()) === 0 && /There is no open Water Quality report to add it to yet/.test(await cp.innerText()),
  '5e no report the database would refuse is offered: not the Data Centers report, not the report it was deferred from');
await shot('#tab-weeklyreport #tq-list', 'C2-deferred-in-carry-forward.png');

// ── 6 disposition and publication ──
await view('inbox');
const c2 = card(ID.l2);
await c2.locator('.tq-send-edition').selectOption(ID.ew);
await c2.locator('button[data-tq="assign"]').click(); await wait(11, /Assigned to the edition/);
await view('all');
await c2.locator('button[data-d="included"]').click(); await wait(12, /Decision recorded/);
ok(at === 12 && (await c2.getAttribute('data-status')) === 'included' && /Our video is not recorded as published yet/.test(await c2.innerText()), '6a the Water lead is included; included is not published');
ok((await c2.locator('button[data-tq="send-current"], .tq-primary').count()) === 0 && !/Prepare the research request/.test(await c2.innerText()), '6a2 an included topic is not sent back to its first research step');
await page.selectOption('#tq-edition', ID.ew);
await page.waitForFunction(() => /Our video is not recorded as published/.test(document.querySelector('#tq-editions').innerText) && !!document.querySelector('#tq-video'));
await page.fill('#tq-video', F.steps[13].args.p_video_url);
await page.click('button[data-tq="publish"]'); await wait(13);
await page.waitForSelector('#tab-weeklyreport .tq-root [role="alert"]');
ok(at === 13 && /needs both our video's address and its publication date/.test(await T('#tab-weeklyreport .tq-root [role="alert"]')) && (await c2.getAttribute('data-status')) === 'included', '6b an address without a date records nothing');
await page.fill('#tq-video', F.steps[13].args.p_video_url); await page.fill('#tq-pubdate', F.steps[13].args.p_published_on);
await page.click('button[data-tq="publish"]'); await wait(14, /Publication recorded/);
await view('published');
ok(at === 14 && (await c2.getAttribute('data-status')) === 'published' && (await c2.innerText()).includes('https://video.example.test/watch?v=TEST') && (await c2.innerText()).includes('2026-11-10'), '6c with both, the lead is Published with our video and its date');
ok((await c2.locator('button[data-tq="dispose"], button[data-tq="send-current"], .tq-primary').count()) === 0 && /Done\. This topic is in our published video/.test(await c2.innerText())
  && (await c2.locator('button[data-tq="followup"]').count()) === 1, '6d published (its report is still open): no research step and no Include/Defer/Drop; a follow-up is offered as a new topic');
await shot('#tab-weeklyreport #tq-list', 'D1-published-with-our-video.png');

// ── 7 carry forward into the next edition ──
await newEdition('Water Quality', '2026-11-16'); await wait(15, /Edition water-quality-2026-11-16 created/);
await view('deferred');
await cp.locator('.tq-send-edition').selectOption(ID.ew2);
await cp.locator('button[data-tq="send"]').click(); await wait(16, /Research request prepared/);
await view('promised');
await openDetails(cp);
const carried = await cp.innerText();
ok(at === 16 && /water-quality-2026-11-09: deferred — TEST: the record is not public yet/.test(carried) && /water-quality-2026-11-16 \(current assignment\): no decision yet/.test(carried)
  && (await cp.locator('.tq-promised').count()) === 1, '7a carried into the next edition: the earlier deferral and reason are kept apart from the current assignment');
await shot('#tab-weeklyreport .tq-lead[data-lead="' + ID.lp + '"]', 'C3-carried-into-next-edition.png');
await view('all');
await shot('#tab-weeklyreport', 'E1-tab20-all-topics-end-state.png');

// ── 7b Edit opens the form BELOW the sticky tab bar: the Title box is reachable, at desktop and phone width ──
const reachable = () => page.evaluate(() => { const t = document.querySelector('#tq-title').getBoundingClientRect(), n = document.querySelector('nav.tabs').getBoundingClientRect();
  return { hit: document.elementFromPoint(t.left + 20, t.top + t.height / 2) === document.querySelector('#tq-title'), heading: document.querySelector('#tq-capture h3').getBoundingClientRect().top >= n.bottom,
    sticky: getComputedStyle(document.querySelector('nav.tabs')).position }; });
for (const w of [1300, 390]) {
  await page.setViewportSize({ width: w, height: w === 390 ? 800 : 900 });
  await page.locator('#tab-weeklyreport .tq-lead button[data-tq="edit"]').last().click();
  await page.waitForFunction(() => /Edit topic/.test(document.querySelector('#tq-capture h3').textContent));
  const r = await reachable();
  ok(r.sticky === 'sticky' && r.hit && r.heading, '7b at ' + w + 'px: after Edit, the form’s heading and Title box are below the sticky tab bar, not under it', r);
  await page.click('button[data-tq="cancel-edit"]');
}
await page.setViewportSize({ width: 1300, height: 900 });

// ── 8 the whole run: exact calls, nothing that dispatches, storage untouched, no outside request ──
const weekly = calls.filter((c) => /^hs_weekly_/.test(c[0]) && c[0] !== 'hs_weekly_bsky_sources' && c[0] !== 'hs_weekly_perplexity_status').map((c) => c[0]);
ok(at === F.steps.length && unexpected.length === 0, '8a the page made exactly the ' + F.steps.length + ' recorded calls, in order, with the recorded arguments', unexpected);
ok(weekly.every((n) => QUEUE_FNS.includes(n)) && !weekly.includes('hs_weekly_paste_answer') && !weekly.some((n) => /request_research|link_version|angles|script|title|doc_cue|source_copy/.test(n)), '8b only the queue’s own functions were called: no answer processing, no workbench, no version link');
ok(isDeepStrictEqual(F.after, { answers: 0, outbound_calls: 0, requests: 3, runs: 0 }), '8c on the database this flow left 3 prepared requests and no run, no saved answer and no outbound call');
const store = await page.evaluate(() => ({ stage1: window.localStorage.getItem('hs-weekly-report-stage1'), other: window.localStorage.getItem('unrelated-key'),
  weeklyKeys: Object.keys(window.localStorage).filter((k) => /weekly/i.test(k)), session: Object.keys(window.sessionStorage).filter((k) => /weekly|tq/i.test(k)),
  writes: window.__storageWrites.filter((w) => /weekly/i.test(String(w[1])) || w[0] === 'clear'), touched: !!window.__storageTouched }));
ok(store.stage1 === STAGE1 && store.other === 'keep me' && isDeepStrictEqual(store.weeklyKeys, ['hs-weekly-report-stage1']) && store.session.length === 0 && store.writes.length === 0,
  '8d the Stage 1 browser draft is byte-identical; nothing weekly was written, removed or cleared in browser storage', store);
ok(!store.touched, '8e no storage bucket was touched');
ok(outside.length === 0, '8f no request left the page', outside);
ok(errors.length === 0, '8g no script errors or dialogs', errors);
await page.setViewportSize({ width: 390, height: 800 });
ok(await page.evaluate(() => document.querySelector('#tab-weeklyreport').scrollWidth <= document.documentElement.clientWidth + 1), '8h no sideways scroll at phone width');

await browser.close(); server.close();
if (fails) { console.log(fails + ' failed'); process.exit(1); }
console.log('all passed');
