// Video Producer — saved-project multi-record regression tests.
// Run: node test/acquisition-video-producer-projects.test.mjs
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
      const file = p === '/' ? '/acquisition.html' : p;
      const fp = path.join(root, decodeURIComponent(file));
      if (!fp.startsWith(root) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) {
        res.writeHead(404); res.end('not found'); return;
      }
      const ext = path.extname(fp);
      const types = { '.html': 'text/html', '.js': 'text/javascript' };
      res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
      fs.createReadStream(fp).pipe(res);
    });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port }));
  });
}

const sampleVpHtml = fs.readFileSync(
  path.join(root, 'test', 'fixtures', 'video-producer-shell.html'),
  'utf8'
);

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch (e) {
  console.log('SKIP acquisition-video-producer-projects — playwright not installed');
  process.exit(0);
}

const { srv, port } = await startServer();
const base = 'http://127.0.0.1:' + port;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
page.on('dialog', (d) => d.accept());

async function bootVideoProducer() {
  await page.goto(base + '/acquisition.html', { waitUntil: 'domcontentloaded' });
  await page.evaluate(function (html) {
    window.__sampleVpHtml = html;
    window.hsUser = { email: 'test@example.com' };
    window.hsClient = {
      rpc: function () {
        return Promise.resolve({
          data: {
            meta: { snapshot: '2026-07-25' },
            S: [],
            tabs: { videoproducer: window.__sampleVpHtml },
            tab_scripts: {}
          }
        });
      },
      from: function () {
        return { select: function () { return this; }, in: function () { return this; }, order: function () { return Promise.resolve({ data: [] }); } };
      }
    };
    localStorage.removeItem('hs_video_projects_v1');
    window.hsOnAuthChange();
  }, sampleVpHtml);

  await page.waitForFunction(() => document.getElementById('video-producer-root'));
  await page.click('nav.tabs button[data-tab="videoproducer"]');
  await page.waitForFunction(() => document.getElementById('tab-videoproducer')?.getAttribute('data-vp-initialized') === '1');
}

async function saveProject() {
  await page.click('#vp-save-project');
  await page.waitForTimeout(50);
}

async function chipLabels() {
  return page.$$eval('.vp-project-chip', (nodes) => nodes.map((n) => n.textContent.trim()));
}

async function readStorage() {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key) || '[]'), STORAGE_KEY);
}

try {
  await bootVideoProducer();

  // 1. Save project A
  await page.fill('#vp-project-name', 'smoke test 2');
  await page.fill('#vp-speaker', 'Speaker A');
  await saveProject();

  let chips = await chipLabels();
  ok(chips.length === 1 && chips[0] === 'smoke test 2', 'save project A — one chip for A');

  let stored = await readStorage();
  ok(stored.length === 1 && stored[0].name === 'smoke test 2', 'save project A — one record in localStorage');
  const idA = stored[0].id;
  ok(!!idA, 'save project A — record has id');

  // 2. Create new project B (draft)
  await page.click('#vp-new-project');
  await page.waitForFunction(() => document.getElementById('vp-project-name')?.value === '');

  // 3. Save project B
  await page.fill('#vp-project-name', 'smoke test 3');
  await page.fill('#vp-speaker', 'Speaker B');
  await saveProject();

  chips = await chipLabels();
  ok(chips.length === 2, 'save project B — two chips visible');
  ok(chips.includes('smoke test 2') && chips.includes('smoke test 3'),
    'save project B — both A and B names appear');

  stored = await readStorage();
  ok(stored.length === 2, 'save project B — two records in localStorage');
  const recA = stored.find((p) => p.id === idA);
  const recB = stored.find((p) => p.name === 'smoke test 3');
  ok(recA && recA.name === 'smoke test 2' && recA.speaker === 'Speaker A',
    'save project B — project A unchanged in storage');
  ok(recB && recB.id !== idA, 'save project B — project B has distinct id');

  // 4. Edit B and confirm A remains unchanged
  await page.fill('#vp-speaker', 'Speaker B edited');
  await saveProject();

  stored = await readStorage();
  const recAAfter = stored.find((p) => p.id === idA);
  const recBAfter = stored.find((p) => p.name === 'smoke test 3');
  ok(recAAfter && recAAfter.speaker === 'Speaker A',
    'edit B — project A speaker unchanged');
  ok(recBAfter && recBAfter.speaker === 'Speaker B edited',
    'edit B — project B speaker updated');

  // 5. Switch to A and confirm its state restores
  await page.click('.vp-project-chip:text("smoke test 2")');
  await page.waitForFunction(() => document.getElementById('vp-project-name')?.value === 'smoke test 2');
  const formA = await page.evaluate(() => ({
    name: document.getElementById('vp-project-name').value,
    speaker: document.getElementById('vp-speaker').value
  }));
  ok(formA.name === 'smoke test 2' && formA.speaker === 'Speaker A',
    'switch to A — form restores A state');

  // 6. Switch to B and confirm its state restores
  await page.click('.vp-project-chip:text("smoke test 3")');
  await page.waitForFunction(() => document.getElementById('vp-project-name')?.value === 'smoke test 3');
  const formB = await page.evaluate(() => ({
    name: document.getElementById('vp-project-name').value,
    speaker: document.getElementById('vp-speaker').value
  }));
  ok(formB.name === 'smoke test 3' && formB.speaker === 'Speaker B edited',
    'switch to B — form restores B state');

  // 7. Simulated auth refresh re-render keeps project chips visible
  await page.evaluate(function () { window.hsOnAuthChange(); });
  await page.waitForTimeout(500);
  chips = await chipLabels();
  ok(chips.length === 2 && chips.includes('smoke test 2') && chips.includes('smoke test 3'),
    'auth refresh re-render — both project chips remain visible');

  const activeAfterRefresh = await page.evaluate(() => document.getElementById('vp-project-name')?.value || '');
  ok(activeAfterRefresh === 'smoke test 3',
    'auth refresh re-render — active project selection preserved');

  // 8. Forced DOM replace + reboot restores chips from localStorage
  await page.evaluate(function (html) {
    var c = document.getElementById('tab-videoproducer');
    c.innerHTML = html;
    window.HomeSignalVideoProducer.reboot(c);
  }, sampleVpHtml);
  await page.waitForTimeout(300);
  chips = await chipLabels();
  ok(chips.length === 2 && chips.includes('smoke test 2') && chips.includes('smoke test 3'),
    'reboot after DOM replace — project chips restored from localStorage');
} finally {
  await browser.close();
  srv.close();
}

if (fails) {
  console.error('\n' + fails + ' assertion(s) failed');
  process.exit(1);
}
console.log('\nAll acquisition-video-producer-projects assertions passed.');
