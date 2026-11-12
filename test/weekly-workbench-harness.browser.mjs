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

// ── LIVE: the edition's video sequence (lib/acq-weekly-edition.js) against a DISPOSABLE Postgres ─────────────────────────
// Every action goes through the real functions of docs/weekly-8 and 9: the page's client.rpc is bridged to psql as the
// signed-in admin (role authenticated, the fixture's test.jwt), so "approved" is always the database's answer.
// Needs HARNESS_PG=1 and PGHOST/PGDATABASE pointing at a throwaway database; it DROPS and rebuilds that database's schemas.
if (process.env.HARNESS_PG !== '1') {
  console.log('SKIP — live edition sequence editor: set HARNESS_PG=1 and PGHOST/PGDATABASE for a disposable database');
} else {
  const { spawnSync } = require('node:child_process');
  const root = new URL('..', import.meta.url).pathname;
  const sh = (cmd) => { const r = spawnSync('bash', ['-c', cmd], { cwd: root, encoding: 'utf8' }); if (r.status) throw new Error(cmd + '\n' + r.stderr); return r.stdout; };
  const ADMIN = '{"email":"founder@test.invalid"}';
  // a fresh disposable database: fixture, files 1-9, the two-topic TEST DATA seed, one Air edition covering Water too,
  // with Air's and Water's approved script versions linked to it (what the topic queue does)
  sh(`set -e; . test/weekly_stage2_pg/config.sh; WEEKLY_FULL+=("\${WEEKLY_VIDEO[@]}"); t=$(mktemp); weekly_combine "$t" "$WEEKLY_DOCS" "\${WEEKLY_FULL[@]}"
      psql -X -q -c "drop schema if exists public cascade; drop schema if exists auth cascade; drop schema if exists vault cascade; drop schema if exists net cascade; drop schema if exists storage cascade; create schema public;" >/dev/null 2>&1
      psql -X -q -v ON_ERROR_STOP=1 -f test/weekly_stage2_pg/fixture.sql >/dev/null; psql -X -q -v ON_ERROR_STOP=1 -f "$t" >/dev/null 2>&1
      python3 test/weekly_stage2_pg/build_edition_sequence_state.py`);
  const setup = `\\set ON_ERROR_STOP 1
select id as air from public.weekly_scripts where stage = 'script' and topic = 'Air Quality' and (public.weekly_version_status(id) ->> 'current')::boolean \\gset
select id as water from public.weekly_scripts where stage = 'script' and topic = 'Water Quality' and (public.weekly_version_status(id) ->> 'current')::boolean \\gset
select set_config('test.jwt', '${ADMIN}', false) \\g /dev/null
set role authenticated;
select (public.hs_weekly_edition_create('Air Quality', '2026-11-09') ->> 'id') as ed \\gset
select public.hs_weekly_edition_add_topic(:'ed', 'Water Quality') \\g /dev/null
select public.hs_weekly_edition_link_version(:'ed', :'air') \\g /dev/null
select public.hs_weekly_edition_link_version(:'ed', :'water') \\g /dev/null
\\pset tuples_only on
\\pset format unaligned
select 'IDS ' || :'ed' || ' ' || :'air' || ' ' || :'water';`;
  const ids = spawnSync('psql', ['-X', '-q'], { input: setup, encoding: 'utf8' }).stdout.split('\n').find((l) => l.startsWith('IDS ')).split(' ');
  const [ED, AIR, WATER] = ids.slice(1);
  const ALLOWED = new Set(['hs_weekly_edition_video', 'hs_weekly_edition_sequence_set', 'hs_weekly_edition_sequence_approve', 'hs_weekly_edition_topics']);
  function pgRpc(name, args) {   // one call as the signed-in admin; named arguments only; values are psql variables
    if (!/^hs_weekly_[a-z_]+$/.test(name)) return { data: null, error: { message: 'bridge: not an admin function' } };
    const vars = ['-v', 'jwt=' + ADMIN], named = [];
    Object.keys(args || {}).forEach((k, i) => {
      if (!/^p_[a-z_]+$/.test(k)) throw new Error('bad argument name ' + k);
      const v = args[k];
      if (v === null || v === undefined) { named.push(k + ' => NULL'); return; }
      vars.push('-v', 'a' + i + '=' + (typeof v === 'object' ? JSON.stringify(v) : String(v))); named.push(k + " => :'a" + i + "'");
    });
    const sql = `\\set ON_ERROR_STOP 1\n\\set VERBOSITY verbose\nselect set_config('test.jwt', :'jwt', false) \\g /dev/null\nset role authenticated;\nselect public.${name}(${named.join(', ')})::text;\n`;
    const r = spawnSync('psql', ['-X', '-q', '-tA', ...vars], { input: sql, encoding: 'utf8' });
    if (r.status) { const m = /ERROR:\s+([0-9A-Z]{5}): (.*)/.exec(r.stderr) || [null, null, r.stderr.trim()]; return { data: null, error: { code: m[1], message: m[2] } }; }
    const out = r.stdout.trim().split('\n').pop();
    return { data: out ? JSON.parse(out) : null, error: null };
  }
  const psqlAs = (sql) => { const r = spawnSync('psql', ['-X', '-q', '-tA', '-v', 'ON_ERROR_STOP=1'], { input: `select set_config('test.jwt', '${ADMIN}', false) \\g /dev/null\nset role authenticated;\n` + sql, encoding: 'utf8' }); if (r.status) throw new Error(r.stderr); return r.stdout; };

  const ctx2 = await browser.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: shots ? 2 : 1 });
  const out2 = [], calls2 = [];
  await ctx2.route('**/*', (r) => {
    const u = new URL(r.request().url());
    if (u.origin !== 'https://ws.test') { out2.push(u.href); return r.abort(); }
    if (u.pathname === '/we.js') return r.fulfill({ contentType: 'text/javascript', body: read('lib/acq-weekly-edition.js') });
    if (u.pathname.startsWith('/rpc/')) {
      const name = u.pathname.slice(5), args = JSON.parse(r.request().postData() || '{}');
      calls2.push(name);
      return r.fulfill({ contentType: 'application/json', body: JSON.stringify(pgRpc(name, args)) });
    }
    return r.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head><meta charset="utf-8">' + style + HARNESS_CSS + '</head><body>' +
      '<div class="hx"><h2>LOCAL HARNESS — not Tab 20, not production</h2><p>The edition video sequence, on a disposable database with TEST DATA. Every button calls the real database functions.</p></div>' +
      '<div id="we" style="margin:12px"></div><script src="/we.js"></script></body></html>' });
  });
  const p2 = await ctx2.newPage();
  const err2 = [];
  p2.on('pageerror', (e) => err2.push(e.message));
  await p2.goto('https://ws.test/edition');
  await p2.evaluate((ed) => {
    window.client = { rpc: (n, a) => fetch('/rpc/' + n, { method: 'POST', body: JSON.stringify(a || {}) }).then((r) => r.json()) };
    return window.HS.acqWeeklyEdition.mount(window.client, document.getElementById('we'), { edition: ed });
  }, ED);
  const status = () => p2.locator('#we-status').innerText();
  const cards = () => p2.locator('#we-order tr[data-row]').evaluateAll((trs) => trs.map((t) => (t.cells[1].querySelector('.card') ? 'card ' : '') + t.cells[1].innerText.replace('Section card', '').trim()));
  const done = () => p2.waitForFunction(() => document.getElementById('we').getAttribute('data-busy') === '0');
  const press = async (sel) => { await p2.click(sel); await done(); };
  const pick = async (v, ns) => { for (const n of ns) await p2.locator(`.we-pick[data-version="${v}"][data-n="${n}"]`).check(); await p2.click('[data-we="add"]'); };
  await p2.waitForSelector('#we-status');
  ok((await status()).includes('No sequence yet') && (await p2.locator('.we-cand').count()) === 2, 'L1 a new edition has no sequence; it offers the two approved versions linked to it');
  // choose: Air segment 1, Water segments 1-2, Air segment 2 (Air story 1 -> Water -> Air story 2)
  await pick(AIR, [0]); await pick(WATER, [0, 1]); await pick(AIR, [1]);
  ok((await status()).includes('Unsaved changes') && (await p2.locator('[data-we="approve"]').count()) === 0 &&
     (await p2.locator('#we-order tr[data-row]').count()) === 3, 'L2 the chosen order is unsaved, and an unsaved order cannot be approved');
  await press('[data-we="save"]');
  ok(JSON.stringify(await cards()) === JSON.stringify(['card Air Quality', 'card Water Quality', 'card Air Quality']) &&
     (await p2.locator('#we-topics').innerText()).includes('Air Quality, Water Quality') && (await status()).includes('Not approved: not approved yet'),
     'L3 saved: Air returns with its own section card; the opening lists each topic once; not approved yet');
  if (shots) await p2.screenshot({ path: shots + '/edition-saved.png', fullPage: true });
  const shown = await p2.locator('#we-digest').innerText();
  ok(shown === psqlAs(`select public.hs_weekly_edition_video('${ED}') ->> 'digest';`).trim(), 'L4 the digest on screen is the one the database computes');
  await press('[data-we="approve"]');
  ok((await status()).startsWith('Approved') && psqlAs(`select (public.hs_weekly_edition_video('${ED}') ->> 'approved');`).trim() === 'true', 'L5 approving records the database approval for that digest');
  if (shots) await p2.screenshot({ path: shots + '/edition-approved.png', fullPage: true });
  // reorder: move Air story 2 up; save -> the earlier approval no longer holds
  await p2.click('[data-we="up"][data-i="2"]');
  ok((await status()).includes('Unsaved changes'), 'L6 moving a story marks the order unsaved');
  await press('[data-we="save"]');
  ok((await status()).includes('Not approved: the sequence changed after the newest approval') &&
     JSON.stringify(await cards()) === JSON.stringify(['card Air Quality', 'Air Quality', 'card Water Quality']),
     'L7 after reordering, the approval is stale, and the two Air entries now share one section card');
  if (shots) await p2.screenshot({ path: shots + '/edition-stale-after-reorder.png', fullPage: true });
  // a stale page: someone saves a different order behind it; approving what the page shows is refused
  psqlAs(`select public.hs_weekly_edition_sequence_set('${ED}', '[{"version_id": "${WATER}", "from": 0, "to": 1}, {"version_id": "${AIR}", "from": 0, "to": 1}]'::jsonb) is not null;`);
  await press('[data-we="approve"]');
  ok((await p2.locator('#we-err').innerText()).includes('changed since you reviewed') &&
     JSON.stringify(await cards()) === JSON.stringify(['card Water Quality', 'card Air Quality']) && psqlAs(`select (public.hs_weekly_edition_video('${ED}') ->> 'approved');`).trim() === 'false',
     'L8 approving a page that is out of date is refused by the database (digest mismatch), and the page then shows what is actually saved');
  // remove an entry, save, approve the exact sequence now shown
  await p2.click('[data-we="remove"][data-i="0"]'); await press('[data-we="save"]');
  await press('[data-we="approve"]');
  ok((await status()).startsWith('Approved') && (await p2.locator('#we-order tr[data-row]').count()) === 1 &&
     psqlAs(`select (public.hs_weekly_edition_video('${ED}') ->> 'approved');`).trim() === 'true', 'L9 after removing the Water entry and saving, the new exact sequence can be approved');
  // the content changes: a person moves Air's document cue, which writes a new Air version; the approval goes stale
  psqlAs(`select public.hs_weekly_doc_cue_set('${AIR}', 0, null) is not null;`);
  await p2.reload();
  await p2.evaluate((ed) => {
    window.client = { rpc: (n, a) => fetch('/rpc/' + n, { method: 'POST', body: JSON.stringify(a || {}) }).then((r) => r.json()) };
    return window.HS.acqWeeklyEdition.mount(window.client, document.getElementById('we'), { edition: ed });
  }, ED);
  await p2.waitForSelector('#we-status');
  ok((await status()).includes('Not approved') && (await status()).includes('not the current approved version') &&
     psqlAs(`select (public.hs_weekly_edition_video('${ED}') ->> 'approved');`).trim() === 'false', 'L10 a newer version of included content makes the approval stale, with the reason');
  if (shots) await p2.screenshot({ path: shots + '/edition-stale-after-content-change.png', fullPage: true });
  ok(calls2.length > 0 && calls2.every((n) => ALLOWED.has(n)), 'L11 the editor called only the four edition functions (' + [...new Set(calls2)].join(', ') + ')');
  ok((await p2.locator('button', { hasText: /render|export|publish/i }).count()) === 0 && out2.length === 0 && err2.length === 0, 'L12 no render, export or publish button; nothing left the page; no page errors');
  await ctx2.close();
}

await browser.close();
console.log(fails ? fails + ' FAILED' : 'all passed');
process.exit(fails ? 1 : 0);
