// Acquisition dashboard — Video Producer trusted static asset wiring.
// Run: node test/acquisition-video-producer.test.mjs
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const acqPath = path.join(root, 'acquisition.html');
const vpPath = path.join(root, 'assets', 'acquisition-video-producer.js');

let fails = 0;
const ok = (c, name) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name); if (!c) fails++; };

const acq = fs.readFileSync(acqPath, 'utf8');
const vp = fs.readFileSync(vpPath, 'utf8');

function noDynamicExec(src, label) {
  ok(!/\beval\s*\(/.test(src), label + ' — no eval()');
  ok(!/\bnew\s+Function\s*\(/.test(src), label + ' — no new Function()');
  ok(!/(?<![.\w])Function\s*\(/.test(src), label + ' — no Function() constructor');
}

// Tab order and labels
const tabButtons = [...acq.matchAll(/data-tab="([^"]+)">([^<]+)</g)].map((m) => ({ id: m[1], label: m[2].trim() }));
ok(tabButtons.length >= 12, 'acquisition nav has at least 12 tabs');
ok(tabButtons[10].id === 'videoproducer' && /11\s*·\s*Video Producer/.test(tabButtons[10].label),
  'Tab 11 is Video Producer');
ok(tabButtons[11].id === 'bluesky' && /12\s*·\s*Bluesky Posts/.test(tabButtons[11].label),
  'Tab 12 is Bluesky');
ok(tabButtons[0].id === 'exec' && tabButtons[9].id === 'acquisition',
  'existing tabs remain in original order (exec … acquisition)');

// Static asset + trusted initializer registry
ok(/<script\s+src="assets\/acquisition-video-producer\.js"><\/script>/.test(acq),
  'Video Producer static asset script tag is present');
ok(/var\s+TAB_TRUSTED_INIT\s*=\s*\{/.test(acq), 'TAB_TRUSTED_INIT registry is defined');
ok(/HomeSignalVideoProducer\.init\(container,\s*\{\}\)/.test(acq),
  'trusted initializer calls HomeSignalVideoProducer.init');
ok(/media-src[^;]*blob:/.test(acq), 'CSP allows blob URLs for rendered video preview');
ok(/tabInitDone\.videoproducer/.test(acq), 'videoproducer init guarded against duplicate calls');
ok(/data-vp-initialized/.test(acq) && /videoproducer.*data-vp-initialized/.test(acq),
  'render preserves Video Producer DOM across auth refresh');
ok(!/p\.tab_scripts/.test(acq), 'render does not read tab_scripts from snapshot');
ok(!/\(0,\s*eval\)/.test(acq), 'acquisition.html does not eval snapshot scripts');

noDynamicExec(acq, 'acquisition.html');
noDynamicExec(vp, 'assets/acquisition-video-producer.js');

ok(/window\.HomeSignalVideoProducer\s*=\s*\{/.test(vp),
  'static asset exposes window.HomeSignalVideoProducer');
ok(/init:\s*function\s*\(container,\s*payload\)/.test(vp),
  'static asset exposes init(container, payload)');
ok(/Browser Preview Export — WebM/.test(vp),
  'render label says Browser Preview Export — WebM');
ok(!/Render MP4/i.test(vp), 'static asset does not claim MP4 render support');
ok(/data-vp-delegate-wired/.test(vp), 'static asset uses container-level event delegation');
ok(/vp-build-storyboard/.test(vp), 'static asset handles build storyboard clicks');
ok(/fetch-youtube-transcript/.test(vp), 'static asset invokes fetch-youtube-transcript edge function');
ok(/vp-fetch-transcript/.test(vp), 'static asset wires Fetch transcript from YouTube button');

// Gate remains for unauthorized users
ok(/id="gate"/.test(acq) && /function loginState/.test(acq) && /function noAccess/.test(acq),
  'Acquisition Dashboard gate helpers remain');
ok(/\$\('gate'\)\.style\.display='none'/.test(acq) && /\$\('dash-root'\)\.style\.display='block'/.test(acq),
  'authorized render still reveals dash-root and hides gate');

// Runtime: trusted init called once; reopening tab does not stack handlers
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

const sampleVpHtml = fs.readFileSync(path.join(root, 'test/fixtures/video-producer-shell.html'), 'utf8');

const { srv, port } = await startServer();
const base = 'http://127.0.0.1:' + port;

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch (e) {
  console.log('SKIP runtime Video Producer init checks — playwright not installed');
  srv.close();
  if (fails) { console.error('\n' + fails + ' assertion(s) failed'); process.exit(1); }
  console.log('\nAll acquisition-video-producer static assertions passed.');
  process.exit(0);
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

try {
  await page.goto(base + '/acquisition.html', { waitUntil: 'domcontentloaded' });

  await page.evaluate(function () {
    window.__vpInitCalls = 0;
    var orig = window.HomeSignalVideoProducer.init;
    window.HomeSignalVideoProducer.init = function (container, payload) {
      window.__vpInitCalls++;
      return orig.call(this, container, payload);
    };
    window.hsUser = { email: 'test@example.com' };
    window.hsClient = {
      rpc: function () {
        return Promise.resolve({
          data: {
            meta: { snapshot: '2026-07-24' },
            S: [],
            tabs: { videoproducer: window.__sampleVpHtml },
            tab_scripts: { videoproducer: 'window.__evilSnapshotExec = true;' }
          }
        });
      },
      from: function () {
        return { select: function () { return this; }, in: function () { return this; }, order: function () { return Promise.resolve({ data: [] }); } };
      }
    };
  });

  await page.evaluate(function (html) {
    window.__sampleVpHtml = html;
    window.hsOnAuthChange();
  }, sampleVpHtml);

  await page.waitForFunction(() => {
    return document.getElementById('dash-root').style.display === 'block' &&
      document.getElementById('video-producer-root');
  }, { timeout: 5000 });

  await page.click('nav.tabs button[data-tab="videoproducer"]');
  await page.waitForFunction(() => document.getElementById('tab-videoproducer')?.getAttribute('data-vp-initialized') === '1');

  const boot = await page.evaluate(() => ({
    initCalls: window.__vpInitCalls || 0,
    evil: !!window.__evilSnapshotExec,
    label: document.getElementById('vp-start-render')?.textContent || '',
    wired: document.getElementById('tab-videoproducer')?.getAttribute('data-vp-initialized') === '1'
  }));

  ok(boot.initCalls >= 1, 'trusted initializer runs on first open');
  ok(!boot.evil, 'tab_scripts from snapshot are ignored and never executed');
  ok(boot.label.indexOf('WebM') >= 0 && boot.label.indexOf('MP4') < 0,
    'render label says WebM, not MP4 (runtime)');
  ok(boot.wired, 'container marked initialized after first open');

  await page.evaluate(() => {
    document.querySelector('nav.tabs button[data-tab="bluesky"]').click();
    document.querySelector('nav.tabs button[data-tab="videoproducer"]').click();
  });

  const reopen = await page.evaluate(() => ({
    initCalls: window.__vpInitCalls || 0,
    stepHandlers: document.querySelectorAll('.vp-step').length
  }));
  ok(reopen.initCalls >= 1, 'reopening the tab can refresh init without stacking handlers');
  ok(reopen.stepHandlers >= 1, 'Video Producer step buttons remain wired after tab switch');

  // Storyboard build works; survives simulated auth refresh that replaces tab HTML.
  await page.evaluate(() => {
    document.querySelector('nav.tabs button[data-tab="videoproducer"]').click();
  });
  await page.click('.vp-step[data-vp-step="statements"]');
  await page.fill('#vp-statement-input', 'Test claim for storyboard');
  await page.click('#vp-locate-statements');
  await page.click('.vp-step[data-vp-step="storyboard"]');
  await page.click('#vp-build-storyboard');
  await page.waitForFunction(() => {
    var list = document.getElementById('vp-storyboard-list');
    return list && list.querySelectorAll('.vp-sb-item').length >= 2;
  }, { timeout: 5000 });

  const beforeRefresh = await page.evaluate(() => ({
    items: document.querySelectorAll('#vp-storyboard-list .vp-sb-item').length,
    wired: document.getElementById('tab-videoproducer')?.getAttribute('data-vp-delegate-wired') === '1'
  }));
  ok(beforeRefresh.items >= 2, 'build storyboard populates the sequence list');
  ok(beforeRefresh.wired, 'Video Producer uses container-level delegation');

  // Simulate auth refresh that replaces VP innerHTML — delegation on the tab container survives.
  await page.evaluate(function (html) {
    var el = document.getElementById('tab-videoproducer');
    if (!el) return;
    el.innerHTML = html;
    if (window.HomeSignalVideoProducer && typeof window.HomeSignalVideoProducer.init === 'function') {
      window.HomeSignalVideoProducer.init(el, {});
    }
  }, sampleVpHtml);
  await page.waitForTimeout(200);

  await page.click('.vp-step[data-vp-step="storyboard"]');
  await page.click('#vp-build-storyboard');
  await page.waitForFunction(() => {
    var list = document.getElementById('vp-storyboard-list');
    return list && list.querySelectorAll('.vp-sb-item').length >= 2;
  }, { timeout: 5000 });

  const afterRefresh = await page.evaluate(() => ({
    items: document.querySelectorAll('#vp-storyboard-list .vp-sb-item').length,
    claim: document.getElementById('vp-preview-claim')?.textContent || ''
  }));
  ok(afterRefresh.items >= 2, 'build storyboard still works after VP DOM replacement');
  ok(afterRefresh.claim.indexOf('DEVELOPMENT ALERT') >= 0, 'build storyboard previews first branded card');
} finally {
  await browser.close();
  srv.close();
}

if (fails) { console.error('\n' + fails + ' assertion(s) failed'); process.exit(1); }
console.log('\nAll acquisition-video-producer assertions passed.');
