// Real Chromium: the Weekly Report topic queue (lib/acq-weekly-topics.js), mounted by the weekly screen
// (lib/acq-weekly-slice.js), against a STUB client. The queue is test/fixtures/weekly-topic-queue.json: the real answer of
// hs_weekly_topic_queue on a disposable database (built by test/weekly_stage2_pg/build_topic_queue_fixture.py). The two
// founder leads in it are UNVERIFIED; everything else is TEST DATA. No request leaves the page.
//   node test/weekly-topics.browser.test.mjs [screenshot-dir]
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
  '</head><body><div id="ws"></div><script src="/tq.js"></script><script src="/ws.js"></script></body></html>';
const Q = JSON.parse(read('test/fixtures/weekly-topic-queue.json'));
const OV = JSON.parse(read('test/fixtures/weekly-workbench-overview.json'));
const lead = (re) => Q.leads.find((l) => re.test(l.title));
const L1 = lead(/SpaceX/), L2 = lead(/Oregon lake/), LQ = lead(/title only/), LD = lead(/draft commitment/), LP = lead(/publicly promised/),
  LF = lead(/deferred and waiting/), LX = lead(/published report/);
const ED = (k) => Q.editions.find((e) => e.edition_key === k);
const EA2 = ED('air-quality-2026-11-09'), EC = ED('data-centers-2026-11-09'), EW = ED('water-quality-2026-11-02'), EA = ED('air-quality-2026-11-02');

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1300, height: 900 }, deviceScaleFactor: shots ? 2 : 1 });
const outside = [];
await ctx.route('**/*', (r) => {
  const u = new URL(r.request().url());
  if (u.origin !== 'https://ws.test') { outside.push(u.href); return r.abort(); }
  if (u.pathname === '/tq.js') return r.fulfill({ contentType: 'text/javascript', body: read('lib/acq-weekly-topics.js') });
  if (u.pathname === '/ws.js') return r.fulfill({ contentType: 'text/javascript', body: read('lib/acq-weekly-slice.js') });
  return r.fulfill({ contentType: 'text/html', body: HTML });
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('dialog', (d) => { errors.push('dialog'); d.dismiss(); });
await page.goto('https://ws.test/');
await page.evaluate(([Q, OV]) => {
  window.calls = [];
  window.queue = Q;
  window.answers = {};                       // name -> {data} | {error}; default {data:{ok:true}}
  window.client = { rpc: (n, a) => {
    window.calls.push([n, a]);
    if (n === 'hs_weekly_topic_queue') {
      // like the real function: the "this edition" list is only filled for the edition asked for (the fixture was read for one)
      const q = JSON.parse(JSON.stringify(window.queue));
      if (!a || a.p_edition !== window.queue.selected_edition) { q.views.edition = []; q.selected_edition = (a && a.p_edition) || null; }
      return Promise.resolve({ data: q, error: null });
    }
    if (n === 'hs_weekly_overview') return Promise.resolve({ data: OV, error: null });
    const r = window.answers[n];
    return Promise.resolve(r && r.error ? { data: null, error: { message: r.error } } : { data: (r && r.data) || { ok: true }, error: null });
  } };
  window.client.storage = { from: () => ({ download: () => Promise.resolve({ data: null, error: { message: 'none' } }) }) };
  return window.HS.acqWeeklySlice.mount(window.client, document.getElementById('ws'));
}, [Q, OV]);
await page.waitForSelector('.tq-lead');
const T = (sel) => page.locator(sel).innerText();
const calls = (name) => page.evaluate((n) => window.calls.filter((c) => c[0] === n).map((c) => c[1]), name);
const clear = () => page.evaluate(() => { window.calls = []; window.answers = {}; });
const view = async (v) => { await page.click('.tq-tabs button[data-v="' + v + '"]'); };
const card = (l) => page.locator('.tq-lead[data-lead="' + l.id + '"]');

// 1 the queue sits above the existing weekly screen, and that screen still works
ok((await page.locator('#ws > .ws-topics-host .tq-root').count()) === 1 && (await page.locator('#ws > .ws-slice-host .ws-root').count()) === 1, '1a the queue and the existing weekly screen each have their own box');
ok((await T('.ws-slice-host')).includes('Topic: Air Quality') && (await page.locator('.ws-slice-host #ws-angles .ws-card').count()) === 3, '1b the existing weekly screen still renders its drafts');
ok(/Nothing here posts, publishes or starts a job/.test(await T('.tq-root')), '1c the queue says it posts nothing');

// 2 inbox: the founder's two leads are unverified, with no address and no promise
let inbox = await T('#tq-list');
ok((await page.locator('#tq-list .tq-lead').count()) === 3 && inbox.includes(L2.title) && inbox.includes(LQ.title) && inbox.includes(LD.title) && !inbox.includes(L1.title), '2a inbox lists the unassigned topics only');
await card(L2).locator('.tq-details > summary').click();   // the long text sits under Details
const c2 = await card(L2).innerText();
ok(c2.includes('Captured') && c2.includes('UNVERIFIED LEAD') && c2.includes('No source address recorded') && !c2.includes('Promised publicly')
  && c2.includes('Which lake is it?') && (await card(L2).locator('a').count()) === 0, '2b the Oregon lead: captured, unverified, no address, not promised');
ok((await card(LD).innerText()).includes('Draft commitment, not published') && (await card(LD).locator('.tq-promised').count()) === 0, '2c a draft commitment is not shown as a public promise');
ok((await card(LQ).innerText()).includes('No category yet'), '2d a topic saved with a title only is listed');
const counts = await page.locator('.tq-tabs button').evaluateAll((bs) => Object.fromEntries(bs.map((b) => [b.getAttribute('data-v'), +b.querySelector('.tq-count').textContent])));
ok(counts.inbox === 3 && counts.promised === 1 && counts.research === 2 && counts.deferred === 1 && counts.published === 1 && counts.edition === 0 && counts.all === 7, '2e every view shows its count');

// 3 capture: a title is enough, and only the title is sent
await clear();
await page.click('#tq-capture button[data-tq="save"]');
ok((await calls('hs_weekly_lead_save')).length === 0 && (await T('.tq-root [role="alert"]')).includes('needs a title'), '3a no title: nothing is sent');
await page.fill('#tq-title', 'TEST: a new quick topic');
await page.click('#tq-capture button[data-tq="save"]');
await page.waitForFunction(() => window.calls.some((c) => c[0] === 'hs_weekly_lead_save'));
const saved = (await calls('hs_weekly_lead_save'))[0];
ok(saved.p_lead === null && JSON.stringify(saved.p_fields) === JSON.stringify({ title: 'TEST: a new quick topic' }), '3b capture sends the title and nothing else');
await page.waitForFunction(() => /Topic captured/.test(document.querySelector('.tq-root').innerText));
ok(true, '3c a saved topic is confirmed');
// full capture, with a commitment
await clear();
await page.fill('#tq-title', 'TEST: a full topic');
await page.click('#tq-more > summary');
await page.selectOption('#tq-topic', 'Water Quality');
await page.fill('#tq-location', 'TEST Town');
await page.fill('#tq-sources', 'https://news.example.test/one\nhttps://news.example.test/two');
await page.fill('#tq-questions', 'TEST question one?\n\nTEST question two?');
await page.fill('#tq-commit-wording', 'TEST: we will cover this.');
await page.fill('#tq-commit-url', 'https://social.example.test/post/7');
await page.click('#tq-capture button[data-tq="save"]');
await page.waitForFunction(() => window.calls.some((c) => c[0] === 'hs_weekly_lead_save'));
const full = (await calls('hs_weekly_lead_save'))[0].p_fields;
ok(full.topic === 'Water Quality' && full.location === 'TEST Town' && full.source_urls.length === 2 && full.questions.length === 2
  && full.commitment_wording === 'TEST: we will cover this.' && full.commitment_post_url === 'https://social.example.test/post/7' && !('notes' in full), '3d the optional fields are sent only when filled');

// 4 send to research. A topic is only offered the reports the database would accept it into (category, open, not
// already published, not one it was deferred or dropped from); the database still checks every call.
await clear();
const offered = (l) => card(l).locator('.tq-send-edition option').evaluateAll((os) => os.map((o) => o.value).filter(Boolean));
// the Oregon lead is Water Quality; the fixture's only Water Quality report is already published, so nothing is offered
const nw = await card(L2).innerText();
ok((await card(L2).locator('.tq-send-edition, button[data-tq="send"], button[data-tq="assign"]').count()) === 0
  && /There is no open Water Quality report to add it to yet/.test(nw), '4a a Water topic is offered no Data Centers, Air Quality or published Water report: it says there is no open Water Quality report');
ok(JSON.stringify((await offered(LD)).sort()) === JSON.stringify([EA2.id]), '4b an Air Quality topic is offered only the open Air Quality report (not the closed one, not Data Centers, not Water)');
ok(JSON.stringify((await offered(LQ)).sort()) === JSON.stringify([EA2.id, EC.id].sort()) && !(await offered(LQ)).includes(EW.id) && !(await offered(LQ)).includes(EA.id),
  '4b2 a topic with no category yet is offered every open report whose video is not yet published');
const ldOpts = await card(LD).locator('.tq-send-edition option').allInnerTexts();
ok(ldOpts.length === 1 && ldOpts[0] === 'Air Quality report, Nov 9–15, 2026' && !/air-quality-2026-11-09/.test(await card(LD).locator('.tq-next').innerText()),
  '4b3 the choice reads as a report and its dates; the technical identifier is not in the selector');
await card(LQ).locator('button[data-tq="send"]').click();
ok((await calls('hs_weekly_lead_send_to_research')).length === 0 && (await T('.tq-root [role="alert"]')).includes('Choose a report edition first'), '4c no report chosen: nothing is sent');
await clear();
await page.evaluate((id) => { window.answers.hs_weekly_lead_send_to_research = { data: { request_id: 'abcdef12-0000-0000-0000-000000000000', existing: false, lead_id: id } }; }, LD.id);
await card(LD).locator('button[data-tq="send"]').click();
await page.waitForFunction(() => window.calls.some((c) => c[0] === 'hs_weekly_lead_send_to_research'));
const sent = (await calls('hs_weekly_lead_send_to_research'))[0];
const fmt = await page.evaluate(() => window.HS.acqWeeklySlice.answerFormatText());
ok(sent.p_lead === LD.id && sent.p_edition === EA2.id && sent.p_answer_format === fmt && /WEEKLY-ANSWER v1/.test(fmt), '4d the handoff names the topic, the edition’s id and the weekly screen’s own answer format');
await page.waitForFunction(() => /Sent to research: request abcdef12/.test(document.querySelector('.tq-root').innerText));
ok(true, '4e a successful handoff is confirmed with its request');
// a repeat: the same request, said so
await clear();
await page.evaluate(() => { window.answers.hs_weekly_lead_send_to_research = { data: { request_id: 'abcdef12-0000-0000-0000-000000000000', existing: true } }; });
await card(LD).locator('button[data-tq="send"]').click();
await page.waitForFunction(() => /Already sent: research request abcdef12/.test(document.querySelector('.tq-root').innerText));
ok(/No second request was made/.test(await T('.tq-root .tq-ok')), '4f a repeated handoff says the existing request was kept');
// a refusal the page cannot foresee: the database's reason is shown, no success message, and the topic still reads as it did
await clear();
await page.evaluate(() => { window.answers.hs_weekly_lead_send_to_research = { error: 'edition air-quality-2026-11-09 is closed' }; });
await card(LD).locator('button[data-tq="send"]').click();
await page.waitForFunction(() => document.querySelector('.tq-root [role="alert"]'));
ok((await T('.tq-root [role="alert"]')).includes('edition air-quality-2026-11-09 is closed') && (await page.locator('.tq-root .tq-ok').count()) === 0
  && (await card(LD).getAttribute('data-status')) === 'captured' && (await card(LD).locator('.tq-edchip').count()) === 0, '4g a refused handoff shows why and the topic is still unassigned');
// a report the topic was already deferred from is not offered again (the database refuses it), even while that report is open
await clear();
await page.evaluate((a) => { const q = JSON.parse(JSON.stringify(window.queue)); const f = q.leads.find((l) => l.id === a.lf);
  f.state.editions[0].edition = q.editions.find((e) => e.id === a.ea2); f.state.last_disposition.edition = f.state.editions[0].edition; window.queue = q; }, { lf: LF.id, ea2: EA2.id });
await page.selectOption('#tq-edition', EC.id); await page.waitForFunction(() => window.calls.some((c) => c[0] === 'hs_weekly_topic_queue'));
await view('deferred');
ok((await card(LF).locator('.tq-send-edition').count()) === 0 && /There is no open Air Quality report to add it to yet/.test(await card(LF).innerText())
  && /Deferred from the Air Quality report, Nov 9–15, 2026/.test(await card(LF).innerText()), '4h a report the topic was deferred from is not offered again; the deferral and its reason stay visible');
await page.evaluate((Q) => { window.queue = Q; }, Q);
await page.selectOption('#tq-edition', ''); await view('inbox');

// 5 research in progress: the linked request, kept for the manual Perplexity step
await clear();
await view('research');
ok((await page.locator('#tq-list .tq-lead').count()) === 2 && (await card(L1).innerText()).includes('Queued for research'), '5a research in progress lists the handed-off topics');
const nb = card(L1).locator('.tq-next');
ok((await nb.locator('button').count()) === 1 && (await nb.locator('button.tq-primary').innerText()) === 'Open and copy the research request'
  && (await nb.locator('button[data-tq="dispose"]').count()) === 0 && (await card(L1).locator('.tq-later button[data-tq="dispose"]').count()) === 3
  && /After you have read the research, record a decision/.test(await card(L1).locator('.tq-later').innerText()), '5a2 a prepared request: the one primary action opens and copies it; Include/Defer/Drop sit apart, after the research');
const nc0 = (await page.evaluate(() => window.calls.length));
await nb.locator('button[data-tq="open-request"]').click();
await page.waitForFunction((id) => document.querySelector('.tq-request[data-lead="' + id + '"]').open && /Copied|Copying failed/.test(document.querySelector('.tq-request[data-lead="' + id + '"] .tq-copied').textContent), L1.id);
ok((await page.evaluate(() => window.calls.length)) === nc0 && (await card(L1).getAttribute('data-status')) === 'queued_for_research'
  && (/does not submit or complete the research/.test(await card(L1).locator('.tq-copied').innerText()) || /^Copying failed\./.test(await card(L1).locator('.tq-copied').innerText())),
  '5a3 open-and-copy opens the request, makes no call, changes no status, and never says the research was done');
// copying fails (the browser refuses the clipboard, or has none): the request still opens, and the card says copying FAILED
for (const how of ['refused', 'absent']) {
  await page.evaluate((id) => { const d = document.querySelector('.tq-request[data-lead="' + id + '"]'); d.open = false; d.querySelector('.tq-copied').textContent = ''; }, L1.id);
  await page.evaluate((h) => { Object.defineProperty(navigator, 'clipboard', { configurable: true,
    value: h === 'refused' ? { writeText: () => Promise.reject(new Error('NotAllowedError')) } : undefined }); }, how);
  const n0 = await page.evaluate(() => window.calls.length);
  await card(L1).locator('button[data-tq="open-request"]').click();
  await page.waitForFunction((id) => document.querySelector('.tq-request[data-lead="' + id + '"] .tq-copied').textContent !== '', L1.id);
  const note = await card(L1).locator('.tq-copied').innerText();
  ok((await card(L1).locator('.tq-request').evaluate((d) => d.open)) && (await card(L1).locator('.tq-reqtext').isVisible())
    && /^Copying failed\. The request is open above/.test(note) && !/Copied/.test(note) && (await page.evaluate(() => window.calls.length)) === n0
    && (await card(L1).getAttribute('data-status')) === 'queued_for_research', '5a4 clipboard ' + how + ': the request still opens, the card says copying failed (never "Copied"), and nothing is recorded');
}
const req = await card(L1).locator('.tq-reqtext').inputValue();
ok(req.includes('SpaceX proposed Cochise County, Arizona data center') && req.includes('1. What is the power demand?') && req.includes('6. How can the public take part?')
  && req.includes('Location: Cochise County, Arizona') && req.includes('Public coverage commitment: none recorded') && req.includes('unverified lead'), '5b the request carries the topic, its location, its questions and no invented commitment');
await card(L1).locator('.tq-answer').fill('TEST pasted answer');
await card(L1).locator('button[data-tq="paste"]').click();
await page.waitForFunction(() => window.calls.some((c) => c[0] === 'hs_weekly_paste_answer'));
const pasted = (await calls('hs_weekly_paste_answer'))[0];
ok(pasted.p_request === L1.request.id && pasted.p_raw_text === 'TEST pasted answer', '5c the pasted answer goes to the existing research step, for that request');

// 6 promised publicly: its own flag, at every stage; and the earlier deferral stays on record
await view('promised');
await card(LP).locator('.tq-details > summary').click();
const cp = await card(LP).innerText();
ok((await page.locator('#tq-list .tq-lead').count()) === 1 && (await card(LP).locator('.tq-promised').count()) === 1 && cp.includes('Queued for research'), '6a the promised topic shows its flag beside its status');
ok(cp.includes('“TEST: we will look into this next week.”') && cp.includes('This records the promise. It is not evidence for the story.'), '6b the commitment is shown as a promise, not as evidence');
ok(/air-quality-2026-11-02: deferred — TEST: the permit record is not public yet; carry it to next week/.test(cp) && /air-quality-2026-11-09 \(current assignment\): no decision yet/.test(cp), '6c the earlier deferral and its reason are kept apart from the current assignment');

// 7 deferred / carry forward: still there after its edition closed
await view('deferred');
const cf = await card(LF).innerText();
ok((await page.locator('#tq-list .tq-lead').count()) === 1 && cf.includes('Deferred from the Air Quality report, Nov 2–8, 2026: TEST: waiting for the next hearing') && cf.includes('Send to research'), '7a a deferred topic stays in carry forward, with its reason, and can be sent again');
ok(/Deferred topics stay here, with their reasons/.test(await T('#tq-list')), '7b the view says deferred topics are kept');

// 8 this edition: what must be decided before approval
await clear();
await page.selectOption('#tq-edition', EA2.id);
await page.waitForFunction((id) => window.calls.some((c) => c[0] === 'hs_weekly_topic_queue' && c[1].p_edition === id), EA2.id);
await view('edition');
const ed = await T('#tq-editions');
ok(/1 still need a decision before this report can be approved: TEST: a publicly promised topic/.test(ed) && ed.includes('Versions linked to this edition: angles'), '8a the edition names the topic that still needs a decision, and its linked version');
ok((await page.locator('#tq-list .tq-lead').count()) === 1 && (await card(LP).locator('button[data-tq="dispose"]').count()) === 3, '8b the edition view offers include, defer and drop');
// the page does not decide whether a reason is needed; the database does, and its refusal is shown
await page.evaluate(() => { window.answers.hs_weekly_lead_disposition = { error: 'this lead was promised publicly: say why it is deferred (at least 10 characters)' }; });
await card(LP).locator('button[data-d="deferred"]').click();
await page.waitForFunction(() => document.querySelector('.tq-root [role="alert"]'));
ok((await T('.tq-root [role="alert"]')).includes('promised publicly: say why it is deferred') && (await calls('hs_weekly_lead_disposition'))[0].p_reason === null, '8c deferring a promised topic without a reason is refused');
await clear();
await card(LP).locator('.tq-reason').fill('TEST: still unverified');
await card(LP).locator('button[data-d="deferred"]').click();
await page.waitForFunction(() => window.calls.some((c) => c[0] === 'hs_weekly_lead_disposition'));
const dz = (await calls('hs_weekly_lead_disposition'))[0];
ok(dz.p_lead === LP.id && dz.p_edition === EA2.id && dz.p_disposition === 'deferred' && dz.p_reason === 'TEST: still unverified', '8d the decision is recorded for that topic in that edition, with its reason');
// link a version, close, publish: each is one call for the selected edition
await clear();
const vopts = await page.locator('#tq-version option').evaluateAll((os) => os.map((o) => o.value).filter(Boolean));
ok(vopts.length > 0 && vopts.every((id) => OV.versions.some((v) => v.id === id)), '8e the versions offered for linking are the weekly screen’s own');
await page.selectOption('#tq-version', vopts[0]);
await page.click('button[data-tq="link-version"]');
await page.waitForFunction(() => window.calls.some((c) => c[0] === 'hs_weekly_edition_link_version'));
ok(JSON.stringify((await calls('hs_weekly_edition_link_version'))[0]) === JSON.stringify({ p_edition: EA2.id, p_version: vopts[0] }), '8f linking a version names the edition explicitly');
await clear();
await page.evaluate(() => { window.answers.hs_weekly_edition_publish = { error: 'publication needs both our video\'s address and its publication date' }; });
await page.fill('#tq-video', 'https://video.example.test/watch?v=NEW');
await page.click('button[data-tq="publish"]');
await page.waitForFunction(() => document.querySelector('.tq-root [role="alert"]'));
const pub = (await calls('hs_weekly_edition_publish'))[0];
ok(pub.p_video_url === 'https://video.example.test/watch?v=NEW' && pub.p_published_on === null && (await T('.tq-root [role="alert"]')).includes('needs both')
  && (await T('#tq-editions')).includes('Our video is not recorded as published'), '8g an address without a date does not record a publication');

// 9 published: our video and its date, apart from "included"
await view('published');
const cx = await card(LX).innerText();
ok((await page.locator('#tq-list .tq-lead').count()) === 1 && cx.includes('Published') && cx.includes('https://video.example.test/watch?v=TEST') && cx.includes('2026-11-08'), '9a a published topic shows our video and its date');
// its edition is published but still open, and a research request is on file: neither makes it look unfinished
ok(!EW.closed && EW.published && (await card(LX).locator('button[data-tq="dispose"], button[data-tq="send"], button[data-tq="send-current"], button[data-tq="open-request"], .tq-primary').count()) === 0
  && /Done\. This topic is in our published video for the Water Quality report, Nov 2–8, 2026/.test(cx) && !/Prepare research request|Open the research request|record a decision/i.test(cx),
  '9a2 a published topic offers no research step and no Include/Defer/Drop for the published report');
await clear();
await card(LX).locator('button[data-tq="followup"]').click();
ok((await page.evaluate(() => window.calls.length)) === 0 && (await T('#tq-capture h3')) === 'Capture a follow-up topic' && (await page.inputValue('#tq-title')) === 'Follow-up: ' + LX.title
  && (await page.inputValue('#tq-topic')) === 'Water Quality' && /the published report is not changed/.test(await T('#tq-capture')), '9a3 a follow-up is an explicit new topic for a later report: the form is filled in, nothing is saved, the published report is untouched');
await page.click('button[data-tq="cancel-edit"]');
ok((await T('#tq-capture h3')) === 'Capture a topic' && (await page.inputValue('#tq-title')) === '', '9a4 cancelling the follow-up leaves an empty form');
await page.selectOption('#tq-edition', EA.id);
await page.waitForFunction(() => /Closed: TEST: no video this week/.test(document.querySelector('#tq-editions').innerText));
ok(!(await T('#tq-editions')).includes('Close this edition') && (await T('#tq-editions')).includes('Our video is not recorded as published'), '9b a closed edition with no video says so and cannot be closed again');

// 10 editing a promised topic: the commitment cannot be changed here
await view('promised');
await card(LP).locator('button[data-tq="edit"]').click();
ok((await T('#tq-capture')).includes('Promised publicly. This is recorded and cannot be changed.') && (await page.locator('#tq-commit-url').count()) === 0
  && (await page.inputValue('#tq-title')) === LP.title, '10a a recorded commitment is shown locked');
await page.click('button[data-tq="cancel-edit"]');

// 11 hostile text and addresses stay text
await page.evaluate(() => {
  const q = JSON.parse(JSON.stringify(window.queue));
  const l = q.leads[1];
  l.title = 'TEST <img src=x onerror="window.pwned=1">'; l.source_urls = ['javascript:alert(1)', 'https://ok.example.test/a']; l.notes = '<script>window.pwned=2</script>';
  window.queue = q;
});
await clear();
await page.selectOption('#tq-edition', '');
await page.waitForFunction(() => window.calls.some((c) => c[0] === 'hs_weekly_topic_queue'));
await view('inbox');
await page.waitForFunction(() => /TEST <img src=x/.test(document.querySelector('.tq-root').innerText));
ok((await page.evaluate(() => window.pwned)) === undefined && (await page.locator('.tq-lead img, .tq-lead script').count()) === 0
  && (await page.locator('.tq-lead a[href^="javascript"]').count()) === 0 && (await page.locator('.tq-lead a[href="https://ok.example.test/a"]').count()) === 1, '11 markup and script addresses are shown as text');

// 12 a phone-width screen does not scroll sideways
await page.setViewportSize({ width: 390, height: 800 });
await view('all');
ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), '12 no sideways scroll at phone width');
if (shots) {
  await page.setViewportSize({ width: 1300, height: 900 });
  await page.evaluate((Q) => { window.queue = Q; }, Q);
  await page.selectOption('#tq-edition', EA2.id);
  await view('all');
  await page.locator('.ws-topics-host').screenshot({ path: path.join(shots, 'weekly-topic-queue.png') });
}

// 13 nothing outside, nothing that posts
const names = await page.evaluate(() => Array.from(new Set(window.calls.map((c) => c[0]))));
ok(outside.length === 0, '13a no request left the page');
ok(errors.length === 0, '13b no script errors or dialogs' + (errors.length ? ': ' + errors.join(' | ') : ''));
ok(names.every((n) => /^hs_weekly_/.test(n)) && !names.some((n) => /bluesky|youtube|publish_post|social/i.test(n)), '13c every call is a weekly admin function; nothing posts');

await browser.close();
if (fails) { console.log(fails + ' failed'); process.exit(1); }
console.log('all passed');
