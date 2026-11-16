// Real Chromium: the data-center PROJECT CHECK inside Tab 17's Hot Topics tiles (lib/acq-impact-dc-check.js, mounted by
// lib/acq-impact-discovery.js) against a stub Supabase client. The results it shows are produced by the shipped worker code
// (scripts/impact-dc-verify.mjs) with a fake database, so the page is tested on the real result shape.
// Run: node test/impact-dc-check.browser.test.mjs
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { verifyOne } from '../scripts/impact-dc-verify.mjs';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { console.log('SKIP — playwright is not installed'); process.exit(process.env.CI ? 1 : 0); }
let fails = 0;
const ok = (c, name, extra) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name + (!c && extra !== undefined ? '  [' + JSON.stringify(extra).slice(0, 300) + ']' : '')); if (!c) fails++; };
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

// ── results from the real worker ──
const row = (o = {}) => Object.assign({ source_key: 'dc:aaa', project_name: 'CyrusOne Vint Hill', developer_or_operator: 'CyrusOne',
  map_status: 'Proposed', raw_status: 'proposed', location_text: 'Vint Hill, VA', source_url: 'https://atlas.example/cyrusone', source_name: 'Compute Atlas' }, o);
const deps = (o = {}) => ({
  rpc: async (fn, b) => ({
    map1_dc_zip_members: () => (o.members || { 20187: [row()] })[b.p_zip] || [],
    map1_project_stable_keys: () => ['dcrec:compute_atlas|facilities|cyrusone-vint-hill'],
    map1_project_locate: () => ({ key: b.p_key, state: 'found', zip: '20187', zips: ['20187'], map_key: 'dc:aaa' }),
    map1_project_document_propose: () => 'd1',
    map1_project_documents: () => o.docs || [],
  })[fn](),
  fetchDoc: async () => ({ ok: true, status: 200, title: 'Doc' }),
  checkPage: async () => ({ state: 'verified', checks: [] }),
});
const topic = { title: 'CyrusOne Vint Hill expansion', place: 'Fauquier County, VA', zips: ['20187'], evidence: { leads: [] } };
const appDoc = { url: 'https://www.fauquiercounty.gov/a.pdf', title: 'Rezoning application', doc_kind: 'application' };
const verified = await verifyOne(deps({ docs: [appDoc] }), { candidate: topic });
const dirOnly = await verifyOne(deps(), { candidate: topic });
const ambiguous = await verifyOne(deps({ members: { 20187: [row(), row({ source_key: 'dc:bbb', source_url: 'https://atlas.example/b' })] } }), { candidate: topic });
ok(verified.outcome === 'verified' && dirOnly.outcome === 'missing_documentation' && ambiguous.outcome === 'needs_review', '0 the worker produced the three results');

const iso = (h) => new Date(Date.now() - h * 3600e3).toISOString();
const view = (id, result, o = {}) => Object.assign({ candidate_id: id, freshness: 'current', stale_reasons: [], last_success_at: iso(1),
  job: { status: 'done', attempts: 0 }, result, reply_edit: null,
  link_available: !!(result.link && result.link.available), reply_ready: !!(result.reply && result.reply.ready) }, o);
const STATE = {
  c1: view('c1', verified),
  c2: view('c2', dirOnly),
  c3: view('c3', verified, { freshness: 'stale', stale_reasons: ['Changed since the last check: The project\'s status changed.'], link_available: false, reply_ready: false }),
  c4: view('c4', ambiguous),
};
const cand = (id, title, o = {}) => Object.assign({ id, title, category: 'data_centers', track: 'core', status: 'open', evidence_status: 'leads_found', score: 70,
  metrics: {}, lead_url: 'https://bsky.app/profile/a.test/post/' + id, lead_author: 'a.test', discovered_at: iso(3), last_seen_at: iso(1),
  coverage: { places: [{ zip_pages: 2 }] }, evidence: { leads: [] }, reasons: [], concept: {} }, o);
const OVERVIEW = { latest_scan: null, last_success: { status: 'success', finished_at: iso(2), errors: [] }, settings: {}, exclusions: [], performance: [], learning: {},
  candidates: [cand('c1', 'Verified topic'), cand('c2', 'Directory only'), cand('c3', 'Stale topic'), cand('c4', 'Ambiguous topic'),
               cand('c5', 'Water topic', { category: 'water_groundwater' })] };

const browser = await chromium.launch();
async function mount(opts = {}) {
  const page = await browser.newPage({ viewport: opts.viewport || { width: 1280, height: 1000 } });
  await page.setContent('<!doctype html><html><head><style>:root{--line:#ddd;--panel:#fff;--ink:#111;--muted:#555}</style></head><body><div id="hot"></div></body></html>');
  await page.evaluate(([ov, st, missing]) => {
    window.calls = []; window.copied = [];
    window.db = { ov, st, edits: {}, docs: { 'dcrec:compute_atlas|facilities|cyrusone-vint-hill': [
      { document_id: 'd1', url: 'https://www.fauquiercounty.gov/a.pdf', title: 'Rezoning application', publisher: 'Fauquier County', doc_kind: 'application',
        supports: 'Linked from the Bluesky topic.', proposed_at: new Date().toISOString(), state: 'pending' }] } };
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: (t) => { window.copied.push(t); return Promise.resolve(); } } });
    window.prompt = () => 'Not about this project';
    const R = (d) => Promise.resolve({ data: JSON.parse(JSON.stringify(d)), error: null });
    window.client = { rpc: (n, a) => {
      window.calls.push([n, a]);
      if (n === 'hs_impact_discovery_overview') return R(window.db.ov);
      if (missing && n.startsWith('hs_impact_dc')) return Promise.resolve({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } });
      if (n === 'hs_impact_dc_verification_state') return R(a.p_candidates.filter((id) => window.db.st[id]).map((id) =>
        Object.assign({}, window.db.st[id], { reply_edit: window.db.edits[id] || null })));
      if (n === 'hs_impact_dc_reply_save') { window.db.edits[a.p_candidate] = a.p_text ? { text: a.p_text.trim(), saved_at: new Date().toISOString(), link_changed: false, facts_changed: false,
        has_current_link: a.p_text.includes(window.db.st[a.p_candidate].result.link.url) } : null; return R({ saved: true }); }
      if (n === 'hs_impact_dc_verification_recheck') { window.db.st[a.p_candidate].job = { status: 'queued', attempts: 0 }; return R('queued'); }
      if (n === 'hs_impact_dc_project_documents') return R(window.db.docs[a.p_project_key] || []);
      if (n === 'hs_map1_project_document_decide') { const d = Object.values(window.db.docs).flat().find((x) => x.document_id === a.p_document_id); d.state = a.p_decision; return R(a.p_decision); }
      return R(null);
    } };
  }, [OVERVIEW, STATE, !!opts.missing]);
  await page.addScriptTag({ content: read('lib/acq-impact-dc-check.js') });
  await page.addScriptTag({ content: read('lib/acq-impact-discovery.js') });
  await page.evaluate(() => HS.acqImpactDiscovery.attach(window.client, document.getElementById('hot'), () => {}));
  await page.waitForFunction(() => document.querySelectorAll('.dcv').length >= 4 && !document.querySelector('.dcv p.is-muted:only-child'));
  await page.waitForTimeout(100);
  return page;
}
const tile = (page, id) => page.locator('#dcv-' + id);
const LINK = verified.link.url;

let page = await mount();
console.log('\n1. what each tile shows');
let t = await tile(page, 'c1').innerText();
ok(/CyrusOne Vint Hill/.test(t) && /Vint Hill, VA · ZIP 20187/.test(t) && /Proposed \(as JODY's map shows it, listed by Compute Atlas\)/.test(t) && /Verified/.test(t), '1a project, location, status and check', t);
ok(await tile(page, 'c1').locator('a', { hasText: 'Open project on JODY' }).getAttribute('href') === LINK, '1b Open project on JODY is the stable link');
ok(await tile(page, 'c1').locator('a', { hasText: 'Open original post' }).getAttribute('href') === 'https://bsky.app/profile/a.test/post/c1', '1c the original post stays easy to open');
ok(/Verification checked/.test(t) && !/Source last observed/.test(t), '1d the date is labelled as the verification check');
ok(await page.locator('#dcv-c5').count() === 0, '1e a topic that is not about data centers has no project check');
t = await tile(page, 'c2').innerText();
ok(/Missing documentation/.test(t) && /directory listing/.test(t) && await tile(page, 'c2').locator('a', { hasText: 'Open project on JODY' }).count() === 1
  && await tile(page, 'c2').locator('[data-dcv="copy-reply"]').isDisabled(), '1f directory only: the link is there, the reply cannot be copied', t);
t = await tile(page, 'c3').innerText();
ok(/Out of date/.test(t) && /status changed/.test(t) && await tile(page, 'c3').locator('a', { hasText: 'Open project on JODY' }).count() === 0
  && await tile(page, 'c3').locator('[data-dcv="copy-reply"]').isDisabled(), '1g a stale result is labelled, its link and reply held back', t);
t = await tile(page, 'c4').innerText();
ok(/Needs review: which project/.test(t) && /Possible projects/.test(t) && /No project link yet/.test(t), '1h ambiguous: the possible projects are listed, no link', t);

console.log('\n2. copy and edit');
await tile(page, 'c1').locator('[data-dcv="copy-link"]').click();
await page.waitForFunction(() => window.copied.length === 1);
ok(await page.evaluate(() => window.copied[0]) === LINK, '2a Copy project link copies the stable link');
await tile(page, 'c1').locator('[data-dcv="copy-reply"]').click();
await page.waitForFunction(() => window.copied.length === 2);
ok(await page.evaluate(() => window.copied[1]) === verified.reply.text, '2b Copy reply copies the suggested reply');
ok(!(await page.evaluate(() => window.calls.some((c) => /post|publish|bsky/i.test(c[0])))), '2c nothing posts');
const box = tile(page, 'c1').locator('textarea');
await box.fill('Watch this one: ' + LINK);
ok(await tile(page, 'c1').locator('[data-dcv="copy-reply"]').isDisabled() && await tile(page, 'c1').locator('[data-dcv="save-reply"]').isEnabled(), '2d an unsaved edit must be saved before copying');
await page.evaluate(() => HS.acqImpactDiscovery._render());
ok(await tile(page, 'c1').locator('textarea').inputValue() === 'Watch this one: ' + LINK, '2e a refresh keeps what is being typed');
await tile(page, 'c1').locator('[data-dcv="save-reply"]').click();
await page.waitForFunction(() => /Your wording is saved/.test(document.querySelector('#dcv-c1').innerText));
ok(await page.evaluate(() => window.calls.some((c) => c[0] === 'hs_impact_dc_reply_save' && c[1].p_text.startsWith('Watch this one'))), '2f Save my wording saves it');
await tile(page, 'c1').locator('[data-dcv="copy-reply"]').click();
await page.waitForFunction(() => window.copied.length === 3);
ok(await page.evaluate(() => window.copied[2]) === 'Watch this one: ' + LINK, '2g the saved wording is what is copied');
await page.evaluate(() => { window.db.edits.c1 = Object.assign({}, window.db.edits.c1, { link_changed: true, facts_changed: true, has_current_link: false }); });
await page.evaluate(() => HS.acqImpactDcCheck.load(['c1']).then(() => HS.acqImpactDiscovery._render()));
t = await tile(page, 'c1').innerText();
ok(/link changed since you edited/.test(t) && /details changed since you edited/.test(t) && /does not contain the current project link/.test(t)
  && await tile(page, 'c1').locator('[data-dcv="copy-reply"]').isDisabled(), '2h a changed link or facts is flagged; a reply without the link cannot be copied', t);
await tile(page, 'c1').locator('[data-dcv="reset-reply"]').click();
await page.waitForFunction(() => /Back to the suggested reply/.test(document.querySelector('#dcv-c1').innerText));
ok(await tile(page, 'c1').locator('textarea').inputValue() === verified.reply.text, '2i Use the suggested reply goes back to it');
await tile(page, 'c1').locator('textarea').fill('x'.repeat(301));
ok(/301 \/ 300/.test(await tile(page, 'c1').innerText()), '2j the counter shows Bluesky\'s limit');

console.log('\n3. recheck and documents');
await tile(page, 'c2').locator('[data-dcv="recheck"]').click();
await page.waitForFunction(() => /Recheck queued/.test(document.querySelector('#dcv-c2').innerText));
ok(await page.evaluate(() => window.calls.some((c) => c[0] === 'hs_impact_dc_verification_recheck' && c[1].p_candidate === 'c2')), '3a Recheck asks the database');
await tile(page, 'c2').locator('[data-dcv="docs"]').click();
await page.waitForFunction(() => /Waiting for your review/.test(document.querySelector('#dcv-c2').innerText));
t = await tile(page, 'c2').innerText();
ok(/never changes the project's status/.test(t) && /Rezoning application/.test(t), '3b documents are listed with what approval means', t);
await tile(page, 'c2').locator('[data-dcv="doc"][data-a="reject"]').click();
await page.waitForFunction(() => /Saved\. The project is checked again/.test(document.querySelector('#dcv-c2').innerText));
ok(await page.evaluate(() => window.calls.some((c) => c[0] === 'hs_map1_project_document_decide' && c[1].p_decision === 'rejected' && c[1].p_reason === 'Not about this project')),
  '3c rejecting asks for a reason and saves it');
ok(await tile(page, 'c2').locator('[data-dcv="doc"][data-a="approve"]').count() === 1, '3d a rejected document can still be approved by the founder');
ok(!(await page.evaluate(() => window.calls.some((c) => c[0] === 'hs_map1_project_document_decide' && c[1].p_decision === 'approved'))), '3e nothing is approved by itself');
await page.close();

console.log('\n4. not set up yet, and phone width');
page = await mount({ missing: true });
ok(/not set up yet/.test(await tile(page, 'c1').innerText()) && await page.locator('.is-card').count() === 5, '4a before the SQL is applied, the tiles still show and say so');
await page.close();
page = await mount({ viewport: { width: 390, height: 900 } });
ok(await page.evaluate(() => document.documentElement.scrollWidth <= 390), '4b no sideways scroll at phone width');
await page.close();

await browser.close();
console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);
