// Tab 18 · Development Dossiers (lib/acq-development-review.js): real Chromium against a stub client
// (no network, no credential). The page only calls development_review_queue, development_link_decide,
// development_project_set, development_project_create and development_publish_request.
// Run: node test/development-review.browser.test.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const fs = require('node:fs');
let fails = 0;
const ok = (c, name) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name); if (!c) fails++; };
const lib = fs.readFileSync(new URL('../lib/acq-development-review.js', import.meta.url), 'utf8');

const { chromium } = require('playwright');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.setContent('<!doctype html><html><body><div id="host"></div></body></html>');
await page.addScriptTag({ content: lib });
await page.evaluate(() => {
  window.calls = [];
  window.queue = { last_publish_request: null, projects: [
    { project_key: 'stratos-box-elder', state: 'UT', path: '/development/ut/stratos-box-elder/', display_name: null,
      record_name: 'Stratos data center project', page_state: 'draft', links: [
        { link_id: 'L1', object_kind: 'land_assembly', object_ref: 'stratos-box-elder', role: 'associated_land', grade: 'a',
          evidence_url: 'https://pmn.utah.gov/x', evidence_label: 'MIDA notice <1075195>', link_state: 'candidate',
          proposed_by: 'automated:research', display_text: 'Land <b>assembly</b>' },
        { link_id: 'L2', object_kind: 'organization', object_ref: 'UT:Somebody', role: 'applicant', grade: 'c',
          evidence_url: 'https://x.gov/', link_state: 'candidate', proposed_by: 'automated:research' },
        { link_id: 'L3', object_kind: 'organization', object_ref: 'UT:Person', role: 'applicant', grade: 'a',
          evidence_url: 'javascript:alert(1)', link_state: 'candidate', proposed_by: 'automated:research', names_private_person: true },
        { link_id: 'L4', object_kind: 'water_filing', object_ref: 'ut_dwr:a55167', role: 'water_change_application', grade: 'a',
          evidence_url: 'https://waterrights.utah.gov/a', link_state: 'approved', proposed_by: 'automated:research', decided_at: '2026-10-30T00:00:00Z' },
        { link_id: 'L5', object_kind: 'document', object_ref: 'https://x.gov/d', role: 'primary_document', grade: 'a',
          evidence_url: 'https://x.gov/d', link_state: 'rejected', decision_reason: 'Wrong project', proposed_by: 'automated:research' }] },
    { project_key: 'proctor-4-tacoma', state: 'WA', path: '/development/wa/proctor-4-tacoma/', display_name: 'Proctor 4',
      record_name: null, page_state: 'published', links: [] }] };
  window.fail = null;
  window.client = { rpc: (n, a) => {
    window.calls.push([n, a]);
    if (window.fail && window.fail[0] === n) return Promise.resolve({ data: null, error: window.fail[1] });
    if (n === 'development_review_queue') return Promise.resolve({ data: JSON.parse(JSON.stringify(window.queue)), error: null });
    return Promise.resolve({ data: 'ok', error: null });
  } };
});
await page.evaluate(() => window.HS.acqDevelopmentReview.load(window.client, document.getElementById('host')));
let html = await page.innerHTML('#host');
ok(html.includes('Stratos data center project') && html.includes('Proctor 4'), '1a each project is listed under its one name');
ok(html.includes('<b>2</b> projects') && html.includes('<b>3</b> links waiting'), '1b the counts are the queue\'s');
ok(html.includes('Land &lt;b&gt;assembly&lt;/b&gt;') && html.includes('MIDA notice &lt;1075195&gt;') && !html.includes('<b>assembly</b>'), '1c every value is escaped');
ok(!html.includes('javascript:'), '1d only https sources become links');
const approveFor = (id) => page.$$eval('.dr-link[data-link="' + id + '"] .dr-approve', (e) => e.length);
ok((await approveFor('L1')) === 1 && (await approveFor('L2')) === 0 && (await approveFor('L3')) === 0, '1e only grade a/b links naming no private person can be approved');
ok(html.includes('Grade c: only grades a and b') && html.includes('Names a private person'), '1f the reason is shown instead');
ok(html.includes('Rejected or revoked (1)') && html.includes('Wrong project'), '1g decided links are kept as history');
ok(html.includes('href="/development/wa/proctor-4-tacoma/"') && !html.includes('href="/development/ut/stratos-box-elder/"'), '1h only a published page is linked');

await page.click('.dr-link[data-link="L1"] .dr-approve');
await page.waitForFunction(() => /Approved/.test(document.querySelector('.dr-msg').textContent));
let last = await page.evaluate(() => window.calls.filter((c) => c[0] !== 'development_review_queue').pop());
ok(last[0] === 'development_link_decide' && last[1].p_link_id === 'L1' && last[1].p_decision === 'approved', '2a Approve decides that link');

const before = await page.evaluate(() => window.calls.length);
await page.click('.dr-link[data-link="L2"] .dr-reject');
ok((await page.textContent('.dr-msg')).includes('Write a reason') && (await page.evaluate(() => window.calls.length)) === before, '2b Reject without a reason sends nothing');
await page.fill('.dr-link[data-link="L2"] .dr-reason', 'Not the applicant');
await page.click('.dr-link[data-link="L2"] .dr-reject');
await page.waitForFunction(() => /Rejected/.test(document.querySelector('.dr-msg').textContent));
last = await page.evaluate(() => window.calls.filter((c) => c[0] !== 'development_review_queue').pop());
ok(last[0] === 'development_link_decide' && last[1].p_decision === 'rejected' && last[1].p_reason === 'Not the applicant', '2c Reject sends the reason');

await page.fill('.dr-link[data-link="L4"] .dr-reason', 'Superseded');
await page.click('.dr-link[data-link="L4"] .dr-revoke');
await page.waitForFunction(() => /Revoked/.test(document.querySelector('.dr-msg').textContent));
last = await page.evaluate(() => window.calls.filter((c) => c[0] !== 'development_review_queue').pop());
ok(last[1].p_decision === 'revoked' && last[1].p_link_id === 'L4', '2d Revoke revokes an approved link');

await page.click('.dr-project[data-project="stratos-box-elder"] .dr-publish');
await page.waitForFunction(() => /Published/.test(document.querySelector('.dr-msg').textContent));
last = await page.evaluate(() => window.calls.filter((c) => c[0] !== 'development_review_queue').pop());
ok(last[0] === 'development_project_set' && last[1].p_page_state === 'published' && last[1].p_display_name === null, '3a Publish keeps a land-assembly name (passes no name of its own)');
await page.click('.dr-project[data-project="proctor-4-tacoma"] .dr-withdraw');
await page.waitForFunction(() => /Withdrawn/.test(document.querySelector('.dr-msg').textContent));
last = await page.evaluate(() => window.calls.filter((c) => c[0] !== 'development_review_queue').pop());
ok(last[1].p_page_state === 'withdrawn' && last[1].p_display_name === 'Proctor 4', '3b Withdraw passes the project\'s own name back unchanged');

const n0 = await page.evaluate(() => window.calls.length);
await page.click('details summary');
await page.fill('.dr-new-key', 'Bad Key');
await page.fill('.dr-new-state', 'UT');
await page.click('.dr-create');
ok((await page.evaluate(() => window.calls.length)) === n0, '4a a bad key is refused before anything is sent');
if (!(await page.isVisible('.dr-new-key'))) await page.click('details summary');
await page.fill('.dr-new-key', 'new-project');
await page.fill('.dr-new-state', 'wa');
await page.click('.dr-create');
await page.waitForFunction(() => /created/.test(document.querySelector('.dr-msg').textContent));
last = await page.evaluate(() => window.calls.filter((c) => c[0] !== 'development_review_queue').pop());
ok(last[0] === 'development_project_create' && last[1].p_project_key === 'new-project' && last[1].p_state === 'WA' && last[1].p_display_name === null, '4b Create sends the key, the state upper-cased and no name');

await page.click('.dr-site');
await page.waitForFunction(() => /site update has started/.test(document.querySelector('.dr-msg').textContent));
last = await page.evaluate(() => window.calls.filter((c) => c[0] !== 'development_review_queue').pop());
ok(last[0] === 'development_publish_request', '5a Update the site starts the publisher');
await page.evaluate(() => { window.fail = ['development_publish_request', { code: '55006', message: 'publishing was requested at 12:00:00; wait 2 minutes before requesting again' }]; });
await page.click('.dr-site');
await page.waitForFunction(() => /wait 2 minutes/.test(document.querySelector('.dr-msg').textContent));
ok(true, '5b the database\'s refusal is shown in its own words');

await page.evaluate(() => { window.fail = ['development_review_queue', { code: '42501', message: 'x' }]; });
await page.evaluate(() => window.HS.acqDevelopmentReview.load(window.client, document.getElementById('host')));
ok((await page.innerHTML('#host')).includes('not a development reviewer') && !(await page.innerHTML('#host')).includes('dr-project'), '6a a non-reviewer sees a plain refusal and no projects');
ok(errors.length === 0, '6b no page errors (' + errors.join('; ') + ')');

await browser.close();
if (fails) { console.log(fails + ' failure(s)'); process.exit(1); }
console.log('all passed');
