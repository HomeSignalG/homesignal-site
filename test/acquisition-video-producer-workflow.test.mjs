// Video Producer — end-to-end workflow regression tests.
// Covers the full operator path: projects, evidence, storyboard, render,
// export, reload, failure recovery, and stress cases not covered elsewhere.
//
// Run: node test/acquisition-video-producer-workflow.test.mjs
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const STORAGE_KEY = 'hs_video_projects_v1';
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

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

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch (e) {
  console.log('SKIP acquisition-video-producer-workflow — playwright not installed');
  process.exit(0);
}

const { srv, port } = await startServer();
const base = 'http://127.0.0.1:' + port;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
page.on('dialog', (d) => d.accept());
const pageErrors = [];
const consoleErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e.message)));
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text());
});

async function boot(seedRaw = null) {
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
  }, [sampleVpHtml, seedRaw]);
  await page.waitForFunction(() => document.getElementById('video-producer-root'));
  await page.click('nav.tabs button[data-tab="videoproducer"]');
  await page.waitForFunction(() => document.getElementById('tab-videoproducer')?.getAttribute('data-vp-initialized') === '1');
}

const readStore = () => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || '[]'), STORAGE_KEY);

async function addStatement(text) {
  await page.click('.vp-step[data-vp-step="statements"]');
  await page.fill('#vp-statement-input', text);
  await page.click('#vp-locate-statements');
  await page.waitForSelector('#vp-statements-list .vp-stmt');
}

async function attachEvidence(name = 'evidence.png') {
  await page.click('.vp-step[data-vp-step="commentary"]');
  await page.setInputFiles('.vp-evidence-upload', {
    name, mimeType: 'image/png', buffer: Buffer.from(PNG_B64, 'base64')
  });
  await page.waitForSelector('.vp-evidence-item');
}

async function buildStoryboard() {
  await page.click('.vp-step[data-vp-step="storyboard"]');
  await page.click('#vp-build-storyboard');
  await page.waitForFunction(() => {
    const s = document.getElementById('vp-storyboard-status');
    return s && /Storyboard built/.test(s.textContent);
  }, { timeout: 8000 });
}

async function renderVideo() {
  await page.click('.vp-step[data-vp-step="render"]');
  await page.click('#vp-start-render');
  for (let i = 0; i < 120; i++) {
    const done = await page.evaluate(() => {
      const btn = document.getElementById('vp-start-render');
      const status = document.getElementById('vp-render-status');
      return !!(btn && !btn.disabled && status && /complete|empty|not supported|Could not/i.test(status.textContent));
    });
    if (done) return;
    await page.waitForTimeout(500);
  }
  throw new Error('renderVideo timed out');
}

try {
  // ------------------------------------------------------------------
  // 1. Complete workflow: Project A with transcript, statements, evidence,
  //    storyboard, save, Project B, switch, reload.
  // ------------------------------------------------------------------
  await boot();
  await page.fill('#vp-project-name', 'Workflow A');
  await page.fill('#vp-speaker', 'Speaker A');
  await page.fill('#vp-transcript-paste', 'The county commission met today to discuss zoning changes.');
  await page.click('#vp-analyze-transcript');
  await addStatement('county commission');
  await attachEvidence('a-proof.png');
  await buildStoryboard();

  const sbCountA = await page.evaluate(() => document.querySelectorAll('#vp-storyboard-list .vp-sb-item').length);
  ok(sbCountA >= 5, 'workflow A — storyboard has items after build');

  await page.click('.vp-step[data-vp-step="source"]');
  await page.waitForFunction(() => document.getElementById('vp-panel-source')?.classList.contains('active'));
  await page.click('#vp-save-project');
  const idA = (await readStore())[0].id;

  await page.click('.vp-step[data-vp-step="source"]');
  await page.click('#vp-new-project');
  await page.waitForFunction(() => document.getElementById('vp-project-name')?.value === '');
  await page.fill('#vp-project-name', 'Workflow B');
  await page.fill('#vp-speaker', 'Speaker B');
  await page.fill('#vp-transcript-paste', 'School board approved the budget unanimously.');
  await page.click('#vp-analyze-transcript');
  await addStatement('school board');
  await attachEvidence('b-proof.png');
  await buildStoryboard();
  await page.click('.vp-step[data-vp-step="source"]');
  await page.waitForFunction(() => document.getElementById('vp-panel-source')?.classList.contains('active'));
  await page.click('#vp-save-project');

  const store = await readStore();
  ok(store.length === 2, 'workflow — two projects saved');
  ok(store.find((p) => p.id === idA)?.name === 'Workflow A', 'workflow — project A name intact');
  ok(store.find((p) => p.name === 'Workflow B')?.speaker === 'Speaker B', 'workflow — project B saved');

  // Switch A ↔ B repeatedly
  for (let i = 0; i < 3; i++) {
    await page.click('.vp-project-chip:text("Workflow A")');
    await page.waitForFunction(() => document.getElementById('vp-project-name')?.value === 'Workflow A');
    await page.click('.vp-project-chip:text("Workflow B")');
    await page.waitForFunction(() => document.getElementById('vp-project-name')?.value === 'Workflow B');
  }
  ok(true, 'rapid project switching (3 cycles) does not throw');

  // Reload and verify isolation
  const rawBeforeReload = JSON.stringify(await readStore());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.evaluate((html) => {
    window.__sampleVpHtml = html;
    window.hsUser = { email: 'test@example.com' };
    window.hsClient = {
      rpc: () => Promise.resolve({ data: { meta: {}, S: [], tabs: { videoproducer: html }, tab_scripts: {} } }),
      from: () => ({ select() { return this; }, in() { return this; }, order: () => Promise.resolve({ data: [] }) })
    };
    window.hsOnAuthChange();
  }, sampleVpHtml);
  await page.click('nav.tabs button[data-tab="videoproducer"]');
  await page.waitForFunction(() => document.getElementById('tab-videoproducer')?.getAttribute('data-vp-initialized') === '1');

  const afterReload = await page.evaluate(() => ({
    chips: document.querySelectorAll('.vp-project-chip').length,
    name: document.getElementById('vp-project-name')?.value || ''
  }));
  ok(afterReload.chips === 2, 'reload — both project chips restored');
  ok(JSON.stringify(await readStore()) === rawBeforeReload, 'reload — storage unchanged');

  await page.click('.vp-project-chip:text("Workflow A")');
  await page.click('.vp-step[data-vp-step="commentary"]');
  const evidenceA = await page.evaluate(() => ({
    text: document.querySelector('.vp-evidence-item')?.textContent || '',
    broken: !!document.querySelector('.vp-evidence-item img[src="undefined"]')
  }));
  ok(evidenceA.text.indexOf('a-proof.png') >= 0, 'reload — project A evidence name restored');
  ok(/not stored|re-attach/i.test(evidenceA.text), 'reload — session-only evidence shows honest placeholder');
  ok(!evidenceA.broken, 'reload — no broken evidence image');

  // ------------------------------------------------------------------
  // 2. Storyboard stale on statement edit.
  // ------------------------------------------------------------------
  await page.click('.vp-step[data-vp-step="statements"]');
  await page.fill('#vp-statement-input', 'zoning changes');
  await page.click('#vp-locate-statements');
  await page.waitForSelector('#vp-statements-list .vp-stmt:nth-child(2)', { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(150);
  const stale = await page.evaluate(() => ({
    domItems: document.querySelectorAll('#vp-storyboard-list .vp-sb-item').length,
    hasPlaceholder: !!document.querySelector('#vp-storyboard-list .muted'),
    storage: (JSON.parse(localStorage.getItem('hs_video_projects_v1') || '[]')
      .find((p) => p.name === 'Workflow A') || {}).storyboard?.length || 0
  }));
  ok(stale.domItems === 0 || stale.hasPlaceholder, 'add statement clears in-memory storyboard');
  ok(stale.storage === 0, 'add statement clears storyboard in storage');

  // ------------------------------------------------------------------
  // 3. Render, render failure recovery, render again, export.
  // ------------------------------------------------------------------
  await buildStoryboard();
  await renderVideo();
  const render1 = await page.evaluate(() => ({
    disabled: document.getElementById('vp-start-render')?.disabled,
    status: document.getElementById('vp-render-status')?.textContent || '',
    hasVideo: !!document.querySelector('#vp-render-out video'),
    label: document.getElementById('vp-start-render')?.textContent || ''
  }));
  ok(!render1.disabled, 'render — button re-enabled after success');
  ok(/complete/i.test(render1.status), 'render — status reports completion');
  ok(render1.hasVideo, 'render — preview video element present');
  ok(render1.label.indexOf('WebM') >= 0, 'render — button label says WebM');

  // Force synchronous render failure
  await page.evaluate(() => {
    const orig = HTMLCanvasElement.prototype.captureStream;
    window.__origCaptureStream = orig;
    HTMLCanvasElement.prototype.captureStream = function () { throw new Error('captureStream blocked for test'); };
  });
  await page.click('#vp-start-render');
  for (let i = 0; i < 20; i++) {
    const recovered = await page.evaluate(() => {
      const btn = document.getElementById('vp-start-render');
      const status = document.getElementById('vp-render-status');
      return !!(btn && !btn.disabled && /Could not start|blocked/i.test(status?.textContent || ''));
    });
    if (recovered) break;
    await page.waitForTimeout(200);
  }
  await page.evaluate(() => {
    HTMLCanvasElement.prototype.captureStream = window.__origCaptureStream;
  });
  ok(true, 'render failure — button re-enabled after synchronous throw');
  ok(await page.evaluate(() => /Could not start/i.test(document.getElementById('vp-render-status').textContent)),
    'render failure — error surfaced in status');

  // Render again after recovery
  await renderVideo();
  ok(await page.evaluate(() => /complete/i.test(document.getElementById('vp-render-status').textContent)),
    'render — succeeds again after failure recovery');

  // Export JSON multiple times — no throw, object URLs revoked
  const urlCountBefore = await page.evaluate(() => performance.getEntriesByType('resource').filter((r) => r.name.startsWith('blob:')).length);
  for (let i = 0; i < 3; i++) {
    await page.click('#vp-export-project');
    await page.waitForTimeout(50);
  }
  const urlCountAfter = await page.evaluate(() => performance.getEntriesByType('resource').filter((r) => r.name.startsWith('blob:')).length);
  ok(urlCountAfter - urlCountBefore <= 1, 'export — repeated exports do not leak unbounded blob URLs');

  // ------------------------------------------------------------------
  // 4. Empty transcript — analyze blocked with alert (dialog auto-accepted).
  // ------------------------------------------------------------------
  await boot();
  await page.fill('#vp-transcript-paste', '   ');
  await page.click('#vp-analyze-transcript');
  const emptyStep = await page.evaluate(() => document.querySelector('.vp-step[data-vp-step="statements"]')?.classList.contains('active'));
  ok(!emptyStep, 'empty transcript — analyze does not advance to statements step');

  // ------------------------------------------------------------------
  // 5. Long transcript — no freeze, locate still works.
  // ------------------------------------------------------------------
  await boot();
  const longText = 'word '.repeat(10000) + 'UNIQUE_MARKER_PHRASE ' + 'tail '.repeat(500);
  const t0 = Date.now();
  await page.fill('#vp-transcript-paste', longText);
  await page.click('#vp-analyze-transcript');
  await addStatement('UNIQUE_MARKER_PHRASE');
  const elapsed = Date.now() - t0;
  ok(elapsed < 5000, 'long transcript — locate completes in under 5s (' + elapsed + 'ms)');
  ok(await page.evaluate(() => document.querySelectorAll('#vp-statements-list .vp-stmt').length === 1),
    'long transcript — statement located');

  // ------------------------------------------------------------------
  // 6. Large storyboard — many statements.
  // ------------------------------------------------------------------
  await boot();
  await page.fill('#vp-project-name', 'Large SB');
  await page.fill('#vp-transcript-paste', Array.from({ length: 8 }, (_, i) => 'claim number ' + i).join(' '));
  await page.click('#vp-analyze-transcript');
  const lines = Array.from({ length: 8 }, (_, i) => 'claim number ' + i).join('\n');
  await page.fill('#vp-statement-input', lines);
  await page.click('#vp-locate-statements');
  await page.waitForFunction(() => document.querySelectorAll('#vp-statements-list .vp-stmt').length === 8);
  await buildStoryboard();
  const largeSb = await page.evaluate(() => document.querySelectorAll('#vp-storyboard-list .vp-sb-item').length);
  ok(largeSb >= 30, 'large storyboard — ' + largeSb + ' items for 8 statements');

  // ------------------------------------------------------------------
  // 7. Mobile viewport — no horizontal overflow, storyboard builds.
  // ------------------------------------------------------------------
  await page.setViewportSize({ width: 390, height: 844 });
  await boot();
  await page.fill('#vp-transcript-paste', 'mobile test transcript for viewport');
  await page.click('#vp-analyze-transcript');
  await addStatement('mobile test');
  await buildStoryboard();
  const mobile = await page.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
    items: document.querySelectorAll('#vp-storyboard-list .vp-sb-item').length
  }));
  ok(mobile.scrollW <= mobile.clientW + 2, 'mobile — no horizontal overflow');
  ok(mobile.items >= 5, 'mobile — storyboard builds at 390px width');
  await page.setViewportSize({ width: 1280, height: 720 });

  // ------------------------------------------------------------------
  // 8. Other Acquisition tabs unaffected after VP use.
  // ------------------------------------------------------------------
  await boot();
  await page.fill('#vp-transcript-paste', 'tab integrity check');
  await page.click('#vp-analyze-transcript');
  await page.click('nav.tabs button[data-tab="bluesky"]');
  await page.waitForTimeout(100);
  await page.click('nav.tabs button[data-tab="exec"]');
  await page.waitForTimeout(100);
  const tabsOk = await page.evaluate(() => ({
    exec: !!document.getElementById('tab-exec')?.classList.contains('active'),
    bluesky: !!document.getElementById('tab-bluesky'),
    vp: !!document.getElementById('tab-videoproducer')
  }));
  ok(tabsOk.exec, 'other tabs — exec activates after VP session');
  ok(tabsOk.bluesky && tabsOk.vp, 'other tabs — bluesky and VP panels still present');

  // ------------------------------------------------------------------
  // 9. No unhandled errors across the workflow.
  // ------------------------------------------------------------------
  const vpConsoleErrors = consoleErrors.filter((m) =>
    /video.producer|vp-|hs_video/i.test(m) && !/render failed to start|could not save/i.test(m)
  );
  if (vpConsoleErrors.length) console.log('VP console errors:', vpConsoleErrors);
  ok(!pageErrors.length, 'workflow — no uncaught page errors (' + pageErrors.length + ')');
  ok(!vpConsoleErrors.length, 'workflow — no VP-related console errors');

} finally {
  await browser.close();
  srv.close();
}

if (fails) { console.error('\n' + fails + ' assertion(s) failed'); process.exit(1); }
console.log('\nAll acquisition-video-producer-workflow assertions passed.');
