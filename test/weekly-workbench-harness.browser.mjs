// LOCAL HARNESS (not a page, not production): the EXISTING Tab 20 editorial workbench (lib/acq-weekly-slice.js, unchanged)
// mounted in real Chromium against a STUB client, with the read model from test/fixtures/weekly-render-handoff.json (the
// answers of hs_weekly_overview and weekly_run_claim on a disposable database; TEST DATA). Nothing leaves the page.
//
// Beside the workbench, OUTSIDE the component, a harness panel shows the MANUAL handoff to the render path: the version the
// workbench has open, its body hash and its approval, read from the same read model, and the two commands a person runs
// (homesignal-ingest weekly_slice.render_bundle, then weekly_slice.render check). There is no Render button: nothing in
// the page can run the narrator or the renderer.
//   node test/weekly-workbench-harness.browser.mjs [screenshot-dir]
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const fs = require('node:fs');
let fails = 0;
const ok = (c, name) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name); if (!c) fails++; };
const read = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const shots = process.argv[2] || '';
const FX = JSON.parse(read('test/fixtures/weekly-render-handoff.json'));
const style = read('acquisition.html').match(/<style>[\s\S]*?<\/style>/)[0];
const HARNESS_CSS = '<style>.hx{border:3px dashed #b45309;background:#fffbeb;padding:12px 16px;margin:12px;border-radius:8px;font:14px/1.45 system-ui}' +
  '.hx h2{margin:0 0 6px;font-size:16px;color:#92400e}.hx code,.hx pre{font:12px ui-monospace,monospace;background:#fff;border:1px solid #e5e7eb;padding:2px 4px;border-radius:4px}' +
  '.hx pre{white-space:pre-wrap;padding:8px}.hx .bad{color:#b91c1c;font-weight:600}</style>';
const HTML = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' + style + HARNESS_CSS +
  '</head><body><div class="hx" id="hx-top"><h2>LOCAL HARNESS — not Tab 20, not production</h2>' +
  '<p>The existing workbench component, mounted here with TEST DATA from a disposable database. Tab 20 itself shows only the topic queue.</p></div>' +
  '<div id="ws"></div><div class="hx" id="hx-handoff"></div><script src="/ws.js"></script></body></html>';

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
await page.goto('https://ws.test/');
await page.evaluate((OV) => {
  window.calls = [];
  window.client = { rpc: (n, a) => { window.calls.push([n, a]); return Promise.resolve(n === 'hs_weekly_overview' ? { data: OV, error: null } : { data: null, error: { message: 'harness: read-only' } }); } };
  window.client.storage = { from: () => ({ download: () => fetch('/page.png').then((r) => r.blob()).then((d) => ({ data: d, error: null })) }) };
  return window.HS.acqWeeklySlice.mount(window.client, document.getElementById('ws'));
}, FX.overview);
await page.waitForSelector('#ws-scripts .ws-hist .ws-here');

// Which version the workbench has open: the history row it marks, over the same ordered list it renders (stage = script).
const scripts = FX.overview.versions.filter((v) => v.stage === 'script');
const rows = await page.locator('#ws-scripts .ws-hist tr').evaluateAll((trs) => trs.slice(1).map((t) => t.className));
const idx = rows.indexOf('ws-here');
const sel = scripts[idx];
await page.evaluate(({ sel, claim }) => {
  const a = (sel.approvals || []).filter((x) => x.kind === 'editorial' && x.this_version);
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
  document.getElementById('hx-handoff').innerHTML = '<h2>Manual handoff to the render path (harness panel, outside the workbench)</h2>' +
    '<p>No button here runs the renderer. A person runs these two commands on a machine that has the narrator model and the renderer.</p>' +
    '<p>Version the workbench has open: <code id="hx-vid">' + esc(sel.id) + '</code> · stage ' + esc(sel.stage) + ' · ' +
    (sel.status.current ? 'approved, current' : '<span class="bad">not approved/current</span>') + '</p>' +
    '<p>Body hash (database): <code id="hx-sha">' + esc(sel.body_sha256) + '</code></p>' +
    '<p>Editorial approval on this exact text: ' + (a.length ? '<code id="hx-appr">' + esc(a[0].body_sha256) + '</code> by ' + esc(a[0].approved_by) : '<span class="bad">none</span>') + '</p>' +
    '<p>visual_check claim for: <code id="hx-claim">' + esc(claim.cue_version.id) + '</code> · hash <code>' + esc(claim.cue_version.body_sha256) + '</code></p>' +
    '<pre id="hx-cmd">python -m weekly_slice.render_bundle --claim claim.json --overview overview.json \\\n  --version ' + esc(sel.id) + ' --storage-dir &lt;local copy of weekly-sources&gt; --out bundle\n' +
    'python -m weekly_slice.render check bundle</pre>';
}, { sel, claim: FX.claim });

const t = await page.locator('body').innerText();
ok(idx >= 0 && sel && sel.id === FX.version_id, '1 the workbench opens the version the fixture names (' + (sel && sel.id) + ')');
ok(sel.id === FX.claim.cue_version.id && sel.body_sha256 === FX.claim.cue_version.body_sha256, '2 the open version is the claim\'s version, same body hash');
ok((sel.approvals || []).some((a) => a.kind === 'editorial' && a.this_version && a.body_sha256 === sel.body_sha256) && sel.status.current, '3 its editorial approval is bound to that hash, and it is current');
const ed = await page.locator('#ws-scripts').innerText();
ok(ed.includes('Document visual') && /Found in the stored document on page 1/.test(ed), '4 the workbench shows the person-chosen cue, resolved on page 1');
ok((await page.locator('button', { hasText: /render|export/i }).count()) === 0 && (await page.locator('[data-ws*="render"]').count()) === 0 &&
  (await page.locator('#ws').innerText()).includes('Nothing here narrates, renders or publishes'), '5 no Render or export button; the workbench says it renders nothing');
ok(t.includes('LOCAL HARNESS') && t.includes('Manual handoff'), '6 the page says it is a local harness and the handoff is manual');
ok((await page.locator('[data-ws="approve-script"]').count()) === 0, '7 an approved version shows no approve button');
ok(outside.length === 0 && errors.length === 0, '8 no request left the page, no page errors');
ok(window_calls_ok(await page.evaluate(() => window.calls)), '9 the workbench only read hs_weekly_overview');
function window_calls_ok(c) { return c.length > 0 && c.every((x) => x[0] === 'hs_weekly_overview'); }
if (shots) {
  await page.locator('#ws-scripts').scrollIntoViewIfNeeded();
  await page.screenshot({ path: shots + '/workbench-full.png', fullPage: true });
  const sy = await page.evaluate(() => window.scrollY);
  const box0 = await page.locator('#ws-scripts').boundingBox(), hb0 = await page.locator('#hx-handoff').boundingBox();
  const box = { y: box0.y + sy }, hb = { y: hb0.y + sy, height: hb0.height };
  await page.screenshot({ path: shots + '/workbench-script-and-handoff.png', fullPage: true,
    clip: { x: 0, y: box.y - 10, width: 1400, height: Math.min(4000, hb.y + hb.height - box.y + 20) } });
  fs.writeFileSync(shots + '/selected.json', JSON.stringify({ id: sel.id, body_sha256: sel.body_sha256 }));
}
await browser.close();
console.log(fails ? fails + ' FAILED' : 'all passed');
process.exit(fails ? 1 : 0);
