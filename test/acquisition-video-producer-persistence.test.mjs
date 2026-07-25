// Video Producer — persistence, storage-repair and resilience regression tests.
//
// Every assertion here was written against a reproduction of a real defect
// found in the 2026-07-25 audit of the deployed Tab 11 build. Each one FAILS on
// the pre-fix asset, so none of them is a tautology about a function existing.
//
// Run: node test/acquisition-video-producer-persistence.test.mjs
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const STORAGE_KEY = 'hs_video_projects_v1';

let fails = 0;
const ok = (c, name) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name); if (!c) fails++; };

function startServer() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const p = req.url.split('?')[0];
      const fp = path.join(root, decodeURIComponent(p === '/' ? '/acquisition.html' : p));
      if (!fp.startsWith(root) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) {
        res.writeHead(404); res.end('not found'); return;
      }
      const types = { '.html': 'text/html', '.js': 'text/javascript' };
      res.writeHead(200, { 'Content-Type': types[path.extname(fp)] || 'application/octet-stream' });
      fs.createReadStream(fp).pipe(res);
    });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port }));
  });
}

const sampleVpHtml = fs.readFileSync(path.join(root, 'test/fixtures/video-producer-shell.html'), 'utf8');

// 1x1 PNG — a real image so the evidence upload path behaves normally.
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch (e) {
  console.log('SKIP acquisition-video-producer-persistence — playwright not installed');
  process.exit(0);
}

const { srv, port } = await startServer();
const base = 'http://127.0.0.1:' + port;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
page.on('dialog', (d) => d.accept());
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e.message)));

// Boots the dashboard with a stubbed gated RPC, optionally seeding localStorage
// BEFORE the Video Producer initializes (so storage-repair paths are exercised).
async function boot(seedRaw) {
  await page.goto(base + '/acquisition.html', { waitUntil: 'domcontentloaded' });
  await page.evaluate(([html, seed]) => {
    window.__sampleVpHtml = html;
    window.hsUser = { email: 'test@example.com' };
    window.hsClient = {
      rpc: () => Promise.resolve({
        data: {
          meta: { snapshot: '2026-07-25' }, S: [],
          tabs: { videoproducer: window.__sampleVpHtml }, tab_scripts: {}
        }
      }),
      from: () => ({ select() { return this; }, in() { return this; }, order: () => Promise.resolve({ data: [] }) })
    };
    if (seed === null) localStorage.removeItem('hs_video_projects_v1');
    else localStorage.setItem('hs_video_projects_v1', seed);
    window.hsOnAuthChange();
  }, [sampleVpHtml, seedRaw === undefined ? null : seedRaw]);
  await page.waitForFunction(() => document.getElementById('video-producer-root'));
  await page.click('nav.tabs button[data-tab="videoproducer"]');
  await page.waitForFunction(() => document.getElementById('tab-videoproducer')?.getAttribute('data-vp-initialized') === '1');
}

const readStore = () => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || '[]'), STORAGE_KEY);
const readRaw = () => page.evaluate((k) => localStorage.getItem(k), STORAGE_KEY);

async function addStatement(text) {
  await page.click('.vp-step[data-vp-step="statements"]');
  await page.fill('#vp-statement-input', text);
  await page.click('#vp-locate-statements');
  await page.waitForFunction(() => document.querySelectorAll('#vp-statements-list .vp-stmt').length >= 1);
}

async function attachEvidence(name = 'evidence-photo.png') {
  await page.click('.vp-step[data-vp-step="commentary"]');
  await page.setInputFiles('.vp-evidence-upload', {
    name, mimeType: 'image/png', buffer: Buffer.from(PNG_B64, 'base64')
  });
  await page.waitForFunction(() => document.querySelectorAll('.vp-evidence-item').length >= 1);
}

async function buildStoryboard() {
  await page.click('.vp-step[data-vp-step="storyboard"]');
  await page.click('#vp-build-storyboard');
  await page.waitForFunction(() => {
    const s = document.getElementById('vp-storyboard-status');
    return s && s.textContent.length > 0;
  }, { timeout: 5000 });
}

try {
  // ------------------------------------------------------------------
  // 1. Evidence blobs never reach localStorage — including via the
  //    storyboard, which used to smuggle them back in as storyboard[].files.
  // ------------------------------------------------------------------
  await boot();
  await page.fill('#vp-project-name', 'Blob Project');
  await page.fill('#vp-transcript-paste', 'alpha bravo charlie delta');
  await page.click('#vp-analyze-transcript');
  await addStatement('alpha bravo');
  await attachEvidence();

  ok(await page.evaluate(() => {
    const img = document.querySelector('.vp-evidence-item img');
    return !!img && img.getAttribute('src').indexOf('data:image/png') === 0;
  }), 'evidence thumbnail shows the real blob during the session it was attached');

  let raw = await readRaw();
  ok(raw.indexOf(PNG_B64.slice(0, 24)) < 0,
    'evidence blob is not written to localStorage on attach');

  await buildStoryboard();
  raw = await readRaw();
  ok(raw.indexOf(PNG_B64.slice(0, 24)) < 0,
    'evidence blob is not written to localStorage by Build storyboard (storyboard[].files)');

  let stored = await readStore();
  const sbEvidence = (stored[0].storyboard || []).filter((i) => i.type === 'evidence');
  ok(sbEvidence.length >= 1, 'storyboard contains an evidence item');
  ok(sbEvidence.every((i) => (i.files || []).every((f) => !('dataUrl' in f))),
    'storyboard evidence files carry no dataUrl');
  ok(sbEvidence.every((i) => (i.files || []).every((f) => f.name && f.type)),
    'storyboard evidence files keep name and type (metadata is preserved, not deleted)');
  ok(stored[0].statements[0].evidence.length === 1 &&
    stored[0].statements[0].evidence[0].name === 'evidence-photo.png' &&
    !('dataUrl' in stored[0].statements[0].evidence[0]),
    'statement evidence keeps name/type but drops the blob');

  // Storage repair removes blobs WITHOUT deleting statements or evidence metadata.
  ok(stored[0].statements.length === 1 && stored[0].statements[0].text === 'alpha bravo',
    'storage repair preserves statements');
  ok(stored[0].transcriptRaw === 'alpha bravo charlie delta',
    'storage repair preserves the transcript');

  // ------------------------------------------------------------------
  // 2. Reopening a saved project restores it, and evidence never renders
  //    as a broken <img src="undefined">.
  // ------------------------------------------------------------------
  await boot(raw);
  await page.click('.vp-step[data-vp-step="commentary"]');
  const reopened = await page.evaluate(() => {
    const img = document.querySelector('.vp-evidence-item img');
    return {
      items: document.querySelectorAll('.vp-evidence-item').length,
      brokenImg: !!img && img.getAttribute('src') === 'undefined',
      anyImg: !!img,
      text: (document.querySelector('.vp-evidence-item') || {}).textContent || '',
      statements: document.querySelectorAll('#vp-commentary-list .vp-stmt').length
    };
  });
  ok(reopened.items === 1, 'reopened project still lists its evidence attachment');
  ok(!reopened.brokenImg, 'reopened evidence never renders <img src="undefined">');
  ok(reopened.text.indexOf('evidence-photo.png') >= 0,
    'reopened evidence shows the real file name');
  ok(/not stored/i.test(reopened.text),
    'reopened evidence states honestly that the preview is not stored');
  ok(reopened.statements === 1, 'reopened project restores its statements');

  const storedStoryboardLen = JSON.parse(raw)[0].storyboard.length;
  const reopenedStoryboard = await page.evaluate(() => {
    document.querySelector('.vp-step[data-vp-step="storyboard"]').click();
    return document.querySelectorAll('#vp-storyboard-list .vp-sb-item').length;
  });
  ok(storedStoryboardLen > 0 && reopenedStoryboard === storedStoryboardLen,
    'reopening a saved project restores its storyboard exactly (' + reopenedStoryboard + '/' + storedStoryboardLen + ' items)');

  // ------------------------------------------------------------------
  // 3. Two projects never overwrite one another — saving B leaves A
  //    byte-for-byte unchanged.
  // ------------------------------------------------------------------
  await boot();
  await page.fill('#vp-project-name', 'Project A');
  await page.fill('#vp-speaker', 'Speaker A');
  await page.fill('#vp-transcript-paste', 'alpha bravo charlie');
  await page.click('#vp-analyze-transcript');
  await addStatement('alpha bravo');
  await attachEvidence('a-evidence.png');
  await buildStoryboard();

  const idA = (await readStore())[0].id;

  await page.click('.vp-step[data-vp-step="source"]');
  await page.click('#vp-new-project');
  await page.waitForFunction(() => document.getElementById('vp-project-name')?.value === '');
  // Snapshot A AFTER "New project" has flushed its final save of A. Everything
  // from here on belongs to B, so A must not change by so much as a byte.
  const snapshotA = JSON.stringify((await readStore()).find((p) => p.id === idA));

  await page.fill('#vp-project-name', 'Project B');
  await page.fill('#vp-speaker', 'Speaker B');
  await page.fill('#vp-transcript-paste', 'zulu yankee xray');
  await page.click('#vp-analyze-transcript');
  await addStatement('zulu yankee');
  await attachEvidence('b-evidence.png');
  await buildStoryboard();

  const storeAfterB = await readStore();
  const recA = storeAfterB.find((p) => p.id === idA);
  const recB = storeAfterB.find((p) => p.name === 'Project B');

  ok(storeAfterB.length === 2, 'two distinct projects are stored');
  ok(!!recA && !!recB && recA.id !== recB.id, 'projects keep distinct, stable ids');
  // updatedAt is the one field a save legitimately refreshes on the SAVED record;
  // A was not saved, so even that must be untouched.
  ok(JSON.stringify(recA) === snapshotA,
    'saving project B leaves project A byte-for-byte unchanged');
  ok(recA.speaker === 'Speaker A' && recB.speaker === 'Speaker B',
    'each project keeps its own speaker');
  ok(recA.statements[0].evidence[0].name === 'a-evidence.png' &&
    recB.statements[0].evidence[0].name === 'b-evidence.png',
    'each project keeps its own evidence metadata');
  ok(recA.transcriptRaw === 'alpha bravo charlie' && recB.transcriptRaw === 'zulu yankee xray',
    'each project keeps its own transcript');

  // Switching back to A restores A, not B.
  await page.click('.vp-project-chip:text("Project A")');
  await page.waitForFunction(() => document.getElementById('vp-project-name')?.value === 'Project A');
  const restoredA = await page.evaluate(() => ({
    name: document.getElementById('vp-project-name').value,
    speaker: document.getElementById('vp-speaker').value,
    transcript: document.getElementById('vp-transcript-paste').value,
    storyboard: document.querySelectorAll('#vp-storyboard-list .vp-sb-item').length
  }));
  ok(restoredA.name === 'Project A' && restoredA.speaker === 'Speaker A' &&
    restoredA.transcript === 'alpha bravo charlie',
    'switching back to A restores A');
  ok(restoredA.storyboard === recA.storyboard.length && recA.storyboard.length > 0,
    'switching back to A restores A\'s storyboard exactly (' + restoredA.storyboard + '/' + recA.storyboard.length + ')');

  // The storyboard button still works after a project switch.
  await page.click('#vp-build-storyboard');
  await page.waitForTimeout(150);
  ok(await page.evaluate(() => /Storyboard built/.test(document.getElementById('vp-storyboard-status').textContent)),
    'Build storyboard still works after switching projects');

  // ------------------------------------------------------------------
  // 4. Malformed localStorage fails VISIBLY and safely.
  // ------------------------------------------------------------------
  await boot('this is not json {{{');
  const malformed = await page.evaluate((k) => ({
    raw: localStorage.getItem(k),
    backup: localStorage.getItem(k + '_corrupt_backup'),
    status: document.getElementById('vp-storyboard-status')?.textContent || '',
    rootAlive: !!document.getElementById('video-producer-root'),
    buildButton: !!document.getElementById('vp-build-storyboard')
  }), STORAGE_KEY);
  ok(malformed.raw === '[]', 'malformed storage is actually repaired, not left corrupt');
  ok(malformed.backup === 'this is not json {{{',
    'the damaged copy is preserved under a backup key rather than destroyed');
  ok(/unreadable/i.test(malformed.status),
    'malformed storage produces a VISIBLE message, not a silent console error');
  ok(malformed.rootAlive && malformed.buildButton,
    'the Video Producer stays usable after malformed storage');

  // Recovery: the tool still saves after a repair.
  await page.fill('#vp-project-name', 'After Repair');
  await page.click('#vp-save-project');
  await page.waitForTimeout(80);
  ok((await readStore()).some((p) => p.name === 'After Repair'),
    'projects save normally after a storage repair');

  // ------------------------------------------------------------------
  // 5. Quota failure fails VISIBLY — never reported as a success.
  // ------------------------------------------------------------------
  await boot();
  await page.fill('#vp-project-name', 'Quota Project');
  await page.fill('#vp-transcript-paste', 'alpha bravo charlie');
  await page.click('#vp-analyze-transcript');
  await addStatement('alpha bravo');
  await page.evaluate(() => {
    // Simulate a full quota for this key only.
    const orig = Storage.prototype.setItem;
    window.__origSetItem = orig;
    Storage.prototype.setItem = function (k) {
      if (k === 'hs_video_projects_v1') {
        const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e;
      }
      return orig.apply(this, arguments);
    };
  });
  await buildStoryboard();
  const quota = await page.evaluate(() => {
    const el = document.getElementById('vp-storyboard-status');
    return { text: el.textContent, color: el.style.color, live: el.getAttribute('aria-live') };
  });
  ok(/COULD NOT BE SAVED/.test(quota.text),
    'a storyboard build that fails to save says so — it is not reported as success');
  ok(quota.color === 'var(--persist)', 'the quota failure is styled as an error, not a hint');
  ok(quota.live === 'assertive', 'the quota failure is announced assertively to screen readers');
  await page.evaluate(() => { Storage.prototype.setItem = window.__origSetItem; });

  // ------------------------------------------------------------------
  // 6. A malformed storyboard record must not brick the tab.
  // ------------------------------------------------------------------
  await boot(JSON.stringify([{
    id: 'vp_good', name: 'Good Project', transcriptRaw: 'x', parsed: { plain: 'x', cues: [] },
    statements: [], storyboard: [], updatedAt: '2026-07-25T02:00:00Z'
  }, {
    id: 'vp_bad', name: 'Bad Storyboard', transcriptRaw: 'y', parsed: { plain: 'y', cues: [] },
    statements: [],
    // No `type` field — used to throw a TypeError out of renderStoryboard.
    storyboard: [{ label: 'item with no type' }, { type: 'alert', title: 'T', subtitle: 'S' }],
    updatedAt: '2026-07-25T03:00:00Z'
  }]));
  // boot() loads the first stored record, so select the damaged one explicitly.
  await page.click('.vp-project-chip:text("Bad Storyboard")');
  await page.waitForFunction(() => document.getElementById('vp-project-name')?.value === 'Bad Storyboard');
  await page.click('.vp-step[data-vp-step="storyboard"]');
  await page.waitForTimeout(150);
  const bad = await page.evaluate(() => ({
    sbItems: document.querySelectorAll('#vp-storyboard-list .vp-sb-item').length,
    chips: document.querySelectorAll('.vp-project-chip').length,
    name: document.getElementById('vp-project-name').value
  }));
  ok(bad.sbItems === 2, 'a storyboard item with no type still renders (as unknown) rather than throwing');
  ok(bad.chips === 2,
    'project chips survive a malformed storyboard — the operator can still switch away');
  ok(!pageErrors.some((m) => /reading 'replace'/.test(m)),
    'no TypeError escapes renderStoryboard for a malformed record');

  // And the escape hatch actually works.
  await page.click('.vp-project-chip:text("Good Project")');
  await page.waitForFunction(() => document.getElementById('vp-project-name')?.value === 'Good Project');
  ok(true, 'switching away from the malformed project works');

  // ------------------------------------------------------------------
  // 7. Storyboard order persists, by drag AND by keyboard.
  // ------------------------------------------------------------------
  await boot();
  await page.fill('#vp-project-name', 'Order Project');
  await page.fill('#vp-transcript-paste', 'alpha bravo charlie');
  await page.click('#vp-analyze-transcript');
  await addStatement('alpha\nbravo');
  await buildStoryboard();

  const orderBefore = (await readStore())[0].storyboard.map((i) => i.type);
  await page.evaluate(() => {
    const rows = document.querySelectorAll('#vp-storyboard-list .vp-sb-item');
    const dt = new DataTransfer();
    rows[0].dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
    rows[3].dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt }));
  });
  await page.waitForTimeout(120);
  const orderAfterDrag = (await readStore())[0].storyboard.map((i) => i.type);
  ok(JSON.stringify(orderBefore) !== JSON.stringify(orderAfterDrag),
    'drag-and-drop changes the storyboard order');
  ok(orderAfterDrag[3] === orderBefore[0], 'the dragged item lands at the drop position');

  // Keyboard reorder — the only mouse-free path.
  await page.evaluate(() => document.querySelector('.vp-sb-item[data-ix="0"]').focus());
  await page.keyboard.press('Alt+ArrowDown');
  await page.waitForTimeout(120);
  const orderAfterKb = (await readStore())[0].storyboard.map((i) => i.type);
  ok(orderAfterKb[1] === orderAfterDrag[0] && orderAfterKb[0] === orderAfterDrag[1],
    'Alt+ArrowDown moves a storyboard row down and persists the new order');
  ok(await page.evaluate(() => document.querySelector('.vp-sb-item')?.getAttribute('tabindex') === '0'),
    'storyboard rows are keyboard focusable');
  ok(await page.evaluate(() => /reorder/i.test(document.querySelector('.vp-sb-item')?.getAttribute('aria-label') || '')),
    'storyboard rows describe the reorder shortcut to screen readers');

  // The order survives a reload.
  await boot(await readRaw());
  await page.click('.vp-step[data-vp-step="storyboard"]');
  const orderAfterReload = (await readStore())[0].storyboard.map((i) => i.type);
  ok(JSON.stringify(orderAfterReload) === JSON.stringify(orderAfterKb),
    'storyboard order survives a reload');

  // ------------------------------------------------------------------
  // 8. Editing statements never leaves a stale storyboard in storage.
  // ------------------------------------------------------------------
  await boot();
  await page.fill('#vp-project-name', 'Invalidate Project');
  await page.fill('#vp-transcript-paste', 'alpha bravo charlie');
  await page.click('#vp-analyze-transcript');
  await addStatement('alpha');
  await buildStoryboard();
  ok((await readStore())[0].storyboard.length > 3, 'storyboard is stored after a build');

  await page.click('.vp-step[data-vp-step="statements"]');
  await page.evaluate(() => { window.prompt = () => 'bravo'; });
  await page.click('#vp-add-statement');
  await page.waitForTimeout(150);
  const afterAdd = await readStore();
  ok(afterAdd[0].storyboard.length === 0,
    'adding a statement clears the stale storyboard in STORAGE, not just in memory');
  ok(afterAdd[0].statements.length === 2, 'the new statement is stored');

  // ------------------------------------------------------------------
  // 9. Render output belongs to one project.
  // ------------------------------------------------------------------
  await boot(JSON.stringify([
    { id: 'vp_r1', name: 'Render One', transcriptRaw: 'a', parsed: { plain: 'a', cues: [] }, statements: [], storyboard: [], updatedAt: '2026-07-25T05:00:00Z' },
    { id: 'vp_r2', name: 'Render Two', transcriptRaw: 'b', parsed: { plain: 'b', cues: [] }, statements: [], storyboard: [], updatedAt: '2026-07-25T04:00:00Z' }
  ]));
  await page.evaluate(() => {
    document.getElementById('vp-render-out').innerHTML = '<video id="stale-render"></video>';
    document.getElementById('vp-render-status').textContent = 'Render complete. Download or preview below.';
  });
  await page.click('.vp-project-chip:text("Render Two")');
  await page.waitForFunction(() => document.getElementById('vp-project-name')?.value === 'Render Two');
  ok(!(await page.evaluate(() => !!document.getElementById('stale-render'))),
    'switching projects clears the previous project\'s render output');
  ok(await page.evaluate(() => document.getElementById('vp-render-status').textContent === 'Ready.'),
    'switching projects resets the render status');

  // ------------------------------------------------------------------
  // 10. Repeated tab opening duplicates neither handlers nor UI.
  // ------------------------------------------------------------------
  await boot();
  for (let i = 0; i < 8; i++) {
    await page.click('nav.tabs button[data-tab="bluesky"]');
    await page.click('nav.tabs button[data-tab="videoproducer"]');
  }
  const dupes = await page.evaluate(() => ({
    roots: document.querySelectorAll('#video-producer-root').length,
    build: document.querySelectorAll('#vp-build-storyboard').length,
    fetch: document.querySelectorAll('#vp-fetch-transcript').length,
    status: document.querySelectorAll('#vp-storyboard-status').length,
    steps: document.querySelectorAll('.vp-step').length
  }));
  ok(dupes.roots === 1 && dupes.build === 1 && dupes.fetch === 1 && dupes.steps === 5,
    '8 open/close cycles create no duplicate roots, buttons or step controls');
  ok(dupes.status <= 1, 'the storyboard status element is never duplicated');

  await page.fill('#vp-project-name', 'Dedupe Project');
  await page.fill('#vp-transcript-paste', 'alpha bravo charlie');
  await page.click('#vp-analyze-transcript');
  await addStatement('alpha');
  ok((await readStore())[0].statements.length === 1,
    'one click on Locate creates exactly one statement after 8 reopens (no stacked handlers)');

  // ------------------------------------------------------------------
  // 11. User-entered HTML/script text is rendered as text, never executed.
  // ------------------------------------------------------------------
  await boot();
  const XSS = '<img src=x onerror="window.__xssFired=(window.__xssFired||0)+1">';
  const XSS2 = '"><script>window.__xssFired=(window.__xssFired||0)+1<\/script>';
  await page.fill('#vp-project-name', XSS);
  await page.fill('#vp-speaker', XSS2);
  await page.click('#vp-save-project');
  await page.fill('#vp-transcript-paste', XSS + ' the county commission met ' + XSS2);
  await page.click('#vp-analyze-transcript');
  await addStatement(XSS);
  await page.fill('#vp-transcript-search', 'county commission');
  await buildStoryboard();
  await page.click('.vp-step[data-vp-step="commentary"]');
  await page.waitForTimeout(200);

  const xss = await page.evaluate(() => ({
    fired: window.__xssFired || 0,
    injected: document.querySelectorAll('#video-producer-root img[src="x"]').length,
    scripts: document.querySelectorAll('#video-producer-root script').length,
    chip: document.querySelector('.vp-project-chip')?.textContent || '',
    stmt: document.querySelector('#vp-statements-list h4')?.textContent || '',
    // The claim row is the one carrying the hostile statement text.
    sb: Array.from(document.querySelectorAll('.vp-sb-preview'))
      .map((n) => n.textContent).find((t) => t.indexOf('<img') >= 0) || ''
  }));
  ok(xss.fired === 0, 'user-entered script/HTML never executes');
  ok(xss.injected === 0 && xss.scripts === 0, 'no attacker-controlled elements are created in the DOM');
  ok(xss.chip.indexOf('<img') === 0, 'a hostile project name renders as literal text in the chip');
  ok(xss.stmt.indexOf('<img') === 0, 'a hostile statement renders as literal text');
  ok(xss.sb.indexOf('<img') >= 0, 'a hostile statement renders as literal text in the storyboard preview');

  // Evidence file names are attacker-controlled too.
  await page.setInputFiles('.vp-evidence-upload', {
    name: 'x" onerror="window.__xssFired=1".png', mimeType: 'image/png', buffer: Buffer.from(PNG_B64, 'base64')
  });
  await page.waitForFunction(() => document.querySelectorAll('.vp-evidence-item').length >= 1);
  ok(await page.evaluate(() => (window.__xssFired || 0) === 0),
    'a hostile evidence file name does not execute');

  // Transcript highlight escapes too, and marks the right span.
  const markText = await page.evaluate(() => {
    document.querySelector('.vp-step[data-vp-step="statements"]').click();
    return document.querySelector('#vp-transcript-view mark')?.textContent || '';
  });
  ok(markText === 'county commission',
    'transcript search highlights the exact matched text (raw-text span, not a normalized-index slice)');

  ok(!pageErrors.some((m) => /video-producer/i.test(m)), 'no uncaught Video Producer errors during the run');
} finally {
  await browser.close();
  srv.close();
}

if (fails) { console.error('\n' + fails + ' assertion(s) failed'); process.exit(1); }
console.log('\nAll acquisition-video-producer-persistence assertions passed.');
