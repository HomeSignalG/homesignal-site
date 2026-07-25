// Video Producer — source media, clips, timestamps and trimmed export.
//
// Covers the 12 behaviours required after the 2026-07-25 source-video audit.
// These are written against reproductions of real defects: a YouTube URL that
// produced fabricated "source_clip" storyboard items with no media behind
// them, and a renderer that drew one paused frame instead of trimmed footage.
//
// Run: node test/acquisition-video-producer-source.test.mjs
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

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch (e) {
  console.log('SKIP acquisition-video-producer-source — playwright not installed');
  process.exit(0);
}

const { srv, port } = await startServer();
const base = 'http://127.0.0.1:' + port;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
page.on('dialog', (d) => d.accept());
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e.message)));

// Build a real 6-second WebM in the browser (2s red / 2s green / 2s blue) so
// the clip + trim assertions run against decodable footage, not a stub.
async function makeSourceVideo() {
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await p.goto('about:blank');
  const b64 = await p.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 320; c.height = 240;
    const x = c.getContext('2d');
    const st = c.captureStream(24);
    const rec = new MediaRecorder(st, { mimeType: 'video/webm;codecs=vp8', videoBitsPerSecond: 400000 });
    const chunks = []; rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    const done = new Promise((r) => { rec.onstop = r; });
    rec.start(200);
    const cols = ['#ff0000', '#00ff00', '#0000ff'];
    const t0 = performance.now();
    await new Promise((res) => {
      (function frame() {
        const el = (performance.now() - t0) / 1000;
        if (el >= 6) { res(); return; }
        x.fillStyle = cols[Math.min(2, Math.floor(el / 2))];
        x.fillRect(0, 0, 320, 240);
        if (st.getVideoTracks()[0].requestFrame) st.getVideoTracks()[0].requestFrame();
        setTimeout(frame, 1000 / 24);
      })();
    });
    rec.requestData(); rec.stop(); await done;
    const buf = await new Blob(chunks, { type: 'video/webm' }).arrayBuffer();
    let s = ''; const u = new Uint8Array(buf);
    for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
    return btoa(s);
  });
  await ctx.close();
  return Buffer.from(b64, 'base64');
}

const VIDEO = await makeSourceVideo();

async function boot(seedRaw) {
  await page.goto(base + '/acquisition.html', { waitUntil: 'domcontentloaded' });
  await page.evaluate(([html, seed]) => {
    window.__sampleVpHtml = html;
    window.hsUser = { email: 'test@example.com' };
    window.hsClient = {
      rpc: () => Promise.resolve({
        data: { meta: { snapshot: '2026-07-25' }, S: [], tabs: { videoproducer: window.__sampleVpHtml }, tab_scripts: {} }
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

async function uploadSource() {
  await page.click('.vp-step[data-vp-step="source"]');
  await page.setInputFiles('#vp-source-video', { name: 'src6s.webm', mimeType: 'video/webm', buffer: VIDEO });
  await page.waitForFunction(() => {
    const p = document.getElementById('vp-clip-player');
    return p && p.getAttribute('src');
  }, { timeout: 8000 });
  // Wait for the duration probe to settle so range validation has a bound.
  await page.waitForFunction(() => {
    const l = JSON.parse(localStorage.getItem('hs_video_projects_v1') || '[]');
    return l.some((p) => p.sourceMeta && p.sourceMeta.duration > 0);
  }, { timeout: 8000 }).catch(() => {});
}

async function addClip(inT, outT) {
  await page.click('.vp-step[data-vp-step="storyboard"]');
  await page.fill('#vp-clip-in', inT);
  await page.fill('#vp-clip-out', outT);
  await page.click('#vp-clip-add');
  await page.waitForTimeout(150);
  return page.evaluate(() => ({
    msg: (document.getElementById('vp-clip-msg')||{}).textContent||'',
    isError: ((document.getElementById('vp-clip-msg')||{}).style||{}).color === 'var(--persist)'
  }));
}

async function addStatement(text) {
  await page.click('.vp-step[data-vp-step="statements"]');
  await page.fill('#vp-statement-input', text);
  await page.click('#vp-locate-statements');
  await page.waitForFunction(() => document.querySelectorAll('#vp-statements-list .vp-stmt').length >= 1);
}

try {
  // ------------------------------------------------------------------
  // 1. A YouTube URL alone never creates a renderable clip.
  // 2. The UI explains that a local authorized file is needed.
  // 8. The storyboard status reflects what was actually created.
  // ------------------------------------------------------------------
  await boot();
  await page.fill('#vp-project-name', 'YouTube Only');
  await page.fill('#vp-youtube', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  await page.fill('#vp-transcript-paste', 'the county approved the data center today');
  await page.click('#vp-analyze-transcript');
  await addStatement('the county approved');
  await page.click('.vp-step[data-vp-step="storyboard"]');
  await page.click('#vp-build-storyboard');
  await page.waitForTimeout(250);

  const yt = await page.evaluate(() => {
    const sb = JSON.parse(localStorage.getItem('hs_video_projects_v1'))[0].storyboard;
    return {
      types: sb.map((i) => i.type),
      clipCount: sb.filter((i) => i.type === 'clip').length,
      legacyFabricated: sb.filter((i) => i.type === 'source_clip' || i.type === 'resume').length,
      buildStatus: (document.getElementById('vp-storyboard-status')||{}).textContent||'',
      strip: (document.querySelector('.vp-source-status')||{}).textContent||'',
      frameSrc: (document.getElementById('vp-yt-frame') || {}).src || null,
      frameNote: (document.getElementById('vp-yt-note') || {}).textContent || '',
      addDisabled: (document.getElementById('vp-clip-add')||{}).disabled,
      setInDisabled: (document.getElementById('vp-clip-set-in')||{}).disabled,
      storedHasSourceVideo: JSON.parse(localStorage.getItem('hs_video_projects_v1'))[0].hasSourceVideo,
      storedSourceMeta: JSON.parse(localStorage.getItem('hs_video_projects_v1'))[0].sourceMeta
    };
  });

  ok(yt.clipCount === 0, 'a YouTube URL alone creates NO clip items');
  ok(yt.legacyFabricated === 0,
    'a YouTube URL alone no longer fabricates source_clip/resume placeholders');
  ok(yt.storedHasSourceVideo === false && yt.storedSourceMeta === null,
    'a YouTube URL alone is not recorded as renderable source media');
  ok(/YouTube reference loaded\. Upload an authorized MP4 or WebM copy to create renderable clips\./.test(yt.strip),
    'the UI states that an authorized local MP4/WebM is required');
  ok(/YouTube URL is a reference only/.test(yt.buildStatus) && /No source-video clips included/.test(yt.buildStatus),
    'the build status says the sequence contains no source footage and why');
  ok(!/^Storyboard built — \d+ items\.$/.test(yt.buildStatus.trim()),
    'the build status is never a bare "Storyboard built" when source items were omitted');
  ok(yt.frameSrc === 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
    'the YouTube reference uses the privacy-enhanced embed, not a download');
  ok(/CANNOT be used in the final render/i.test(yt.frameNote),
    'the reference player states plainly that it cannot be rendered');
  ok(yt.addDisabled === true && yt.setInDisabled === true,
    'clip controls are disabled while no renderable media exists');

  // ------------------------------------------------------------------
  // 3. An uploaded source video creates multiple timestamped clips.
  // 7. Invalid in/out timestamps are rejected visibly.
  // ------------------------------------------------------------------
  await boot();
  await page.fill('#vp-project-name', 'Clips Project');
  await page.fill('#vp-transcript-paste', 'the county approved the data center today');
  await page.click('#vp-analyze-transcript');
  await addStatement('the county approved');
  await uploadSource();

  const ready = await page.evaluate(() => ({
    strip: (document.querySelector('.vp-source-status')||{}).textContent||'',
    addDisabled: (document.getElementById('vp-clip-add')||{}).disabled,
    meta: JSON.parse(localStorage.getItem('hs_video_projects_v1'))[0].sourceMeta
  }));
  ok(/Renderable source loaded/.test(ready.strip) && ready.addDisabled === false,
    'uploading an authorized file enables clip creation');
  ok(!!ready.meta && ready.meta.name === 'src6s.webm' && ready.meta.duration > 0,
    'source identity + probed duration are recorded (duration ' + (ready.meta && ready.meta.duration) + 's)');

  const badOrder = await addClip('0:04', '0:02');
  ok(badOrder.isError && /must be later than/i.test(badOrder.msg),
    'Out <= In is rejected visibly: ' + JSON.stringify(badOrder.msg));

  const badLong = await addClip('0:01', '9:59');
  ok(badLong.isError && /past the end of the source video/i.test(badLong.msg),
    'a clip past the media duration is rejected visibly');

  const c1 = await addClip('0:00', '0:02');
  const c2 = await addClip('0:02', '0:04');
  ok(!c1.isError && !c2.isError, 'two valid clips are accepted');

  let stored = await readStore();
  let clips = stored[0].storyboard.filter((i) => i.type === 'clip');
  ok(clips.length === 2, 'both clips are stored (' + clips.length + ')');
  ok(clips.every((c) => c.id && c.sourceId && c.label &&
    typeof c.start === 'number' && typeof c.end === 'number' && typeof c.duration === 'number'),
    'each clip carries id, sourceId, start, end, duration and label');
  ok(clips[0].start === 0 && clips[0].end === 2 && clips[0].duration === 2 &&
    clips[1].start === 2 && clips[1].end === 4,
    'clip timestamps round-trip exactly');
  ok(clips.every((c) => c.sourceId === stored[0].sourceMeta.id),
    'clips reference the source they were cut from');
  ok(new Set(clips.map((c) => c.id)).size === clips.length, 'clip ids are unique');

  const listText = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.vp-sb-preview')).map((n) => n.textContent));
  ok(listText.some((t) => /0:00 → 0:02/.test(t) && /2\.0s/.test(t)),
    'the sequence list shows each clip range and duration');

  // ------------------------------------------------------------------
  // 4. Commentary can be inserted between clips.
  // ------------------------------------------------------------------
  await page.click('#vp-build-storyboard');
  await page.waitForTimeout(250);
  const seq = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('hs_video_projects_v1'))[0].storyboard.map((i) => i.type));
  const firstClip = seq.indexOf('clip');
  const lastClip = seq.lastIndexOf('clip');
  const commentaryIx = seq.indexOf('commentary');
  ok(firstClip >= 0 && lastClip > firstClip, 'the sequence contains more than one clip');
  ok(commentaryIx > firstClip && commentaryIx < lastClip,
    'commentary sits BETWEEN two source clips: ' + JSON.stringify(seq));
  ok(seq.filter((t) => t === 'clip').length === 2 && seq.includes('claim') && seq.includes('evidence'),
    'clips and commentary items coexist as separate types');

  const buildStatus = await page.evaluate(() => (document.getElementById('vp-storyboard-status')||{}).textContent||'');
  ok(/2 source clip\(s\) included/.test(buildStatus),
    'the build status reports the real number of source clips: ' + JSON.stringify(buildStatus));

  // ------------------------------------------------------------------
  // 9. Preview plays only the selected clip range.
  // ------------------------------------------------------------------
  const preview = await page.evaluate(async () => {
    const rows = Array.from(document.querySelectorAll('.vp-sb-item'));
    const target = rows.find((r) => /0:02 → 0:04/.test(r.textContent));
    if (!target) return { error: 'clip row not found' };
    target.querySelector('.vp-sb-preview-btn').click();
    await new Promise((r) => setTimeout(r, 300));
    const p = document.getElementById('vp-clip-player');
    const startedAt = p.currentTime;
    await new Promise((r) => setTimeout(r, 2600));
    return {
      claim: (document.getElementById('vp-preview-claim')||{}).textContent||'',
      startedAt: startedAt,
      endedAt: p.currentTime,
      paused: p.paused
    };
  });
  ok(preview.claim === 'SOURCE CLIP', 'previewing a clip shows the clip card');
  ok(Math.abs(preview.startedAt - 2) < 0.7,
    'preview starts at the clip IN point (t=' + (preview.startedAt || 0).toFixed(2) + ')');
  ok(preview.endedAt <= 4.5 && preview.paused,
    'preview stops at the clip OUT point and does not run on (t=' + (preview.endedAt || 0).toFixed(2) + ')');

  // ------------------------------------------------------------------
  // 10. Export uses the selected clip ranges rather than the whole source.
  //     The source is 2s red / 2s green / 2s blue; a 0:00-0:02 + 0:02-0:04
  //     sequence must therefore contain red and green but NEVER blue.
  // ------------------------------------------------------------------
  const exported = await page.evaluate(async () => {
    const status = document.getElementById('vp-render-status');
    document.querySelector('.vp-step[data-vp-step="render"]').click();
    document.getElementById('vp-start-render').click();
    const t0 = Date.now();
    await new Promise((resolve) => {
      const iv = setInterval(() => {
        if (/complete|Could not|empty|not supported/i.test(status.textContent) || Date.now() - t0 > 90000) {
          clearInterval(iv); resolve();
        }
      }, 400);
    });
    const v = document.querySelector('#vp-render-out video');
    if (!v) return { status: status.textContent, played: false };

    // Decode the exported file and sample its frames.
    await new Promise((r) => { if (v.readyState >= 2) r(); else v.addEventListener('loadeddata', r, { once: true }); });
    const c = document.createElement('canvas'); c.width = 32; c.height = 24;
    const x = c.getContext('2d');
    const seen = [];
    async function sampleAt(t) {
      await new Promise((r) => {
        const on = () => { v.removeEventListener('seeked', on); r(); };
        v.addEventListener('seeked', on);
        try { v.currentTime = t; } catch (e) { r(); }
        setTimeout(r, 1200);
      });
      x.drawImage(v, 0, 0, 32, 24);
      const d = x.getImageData(16, 12, 1, 1).data;
      seen.push([d[0], d[1], d[2]]);
    }
    const dur = isFinite(v.duration) && v.duration > 0 ? v.duration : 6;
    for (let i = 0; i < 8; i++) await sampleAt((dur * i) / 8);
    return { status: status.textContent, played: true, duration: dur, samples: seen };
  });

  ok(/complete/i.test(exported.status), 'export completes: ' + JSON.stringify(exported.status));
  if (exported.played) {
    const dominant = (px) => (px[2] > 110 && px[2] > px[0] + 40 && px[2] > px[1] + 40) ? 'blue'
      : (px[1] > 110 && px[1] > px[0] + 40) ? 'green'
        : (px[0] > 110 && px[0] > px[1] + 40) ? 'red' : 'other';
    const kinds = exported.samples.map(dominant);
    ok(!kinds.includes('blue'),
      'export excludes footage outside the clip ranges (no blue 0:04-0:06 segment): ' + JSON.stringify(kinds));
    ok(kinds.includes('red') || kinds.includes('green'),
      'export contains real footage from inside the clip ranges: ' + JSON.stringify(kinds));
    const uniqueSamples = new Set(exported.samples.map((s) => s.join(',')));
    ok(uniqueSamples.size > 1,
      'export contains MOVING footage, not one frozen frame (' + uniqueSamples.size + ' distinct samples)');
  } else {
    ok(false, 'export produced a playable file to inspect');
  }

  // ------------------------------------------------------------------
  // 5. Clip order persists after switching projects and reloading.
  // 11. Missing / reselected source media is handled visibly and safely.
  // ------------------------------------------------------------------
  const orderBefore = (await readStore())[0].storyboard.map((i) => i.type + ':' + (i.start != null ? i.start : ''));
  const raw = await readRaw();

  await boot(raw);
  await page.click('.vp-step[data-vp-step="storyboard"]');
  await page.waitForTimeout(250);

  const afterReload = await page.evaluate(() => {
    const rec = JSON.parse(localStorage.getItem('hs_video_projects_v1'))[0];
    return {
      order: rec.storyboard.map((i) => i.type + ':' + (i.start != null ? i.start : '')),
      clips: rec.storyboard.filter((i) => i.type === 'clip').map((c) => [c.start, c.end, c.duration]),
      strip: (document.querySelector('.vp-source-status')||{}).textContent||'',
      renderDisabled: (document.getElementById('vp-start-render')||{}).disabled,
      renderStatus: (document.getElementById('vp-render-status')||{}).textContent||'',
      notLoadedBadges: Array.from(document.querySelectorAll('.vp-conf.low')).filter((n) => /source not loaded/.test(n.textContent)).length,
      addDisabled: (document.getElementById('vp-clip-add')||{}).disabled,
      playerSrc: (document.getElementById('vp-clip-player')||{getAttribute:()=>null}).getAttribute('src')
    };
  });

  ok(JSON.stringify(afterReload.order) === JSON.stringify(orderBefore),
    'clip order and commentary placement survive a reload exactly');
  ok(JSON.stringify(afterReload.clips) === JSON.stringify([[0, 2, 2], [2, 4, 2]]),
    'clip timestamps survive a reload exactly: ' + JSON.stringify(afterReload.clips));
  ok(/must be reselected/i.test(afterReload.strip),
    'the UI states that the source file must be reselected');
  ok(afterReload.playerSrc === null, 'no stale media is attached after reload');
  ok(afterReload.renderDisabled === true && /no loaded source media/i.test(afterReload.renderStatus),
    'export is disabled while the sequence needs media that is not loaded');
  ok(afterReload.notLoadedBadges === 2, 'each clip is marked "source not loaded" in the list');
  ok(afterReload.addDisabled === true, 'clip creation is disabled until the source is reselected');

  await uploadSource();
  await page.click('.vp-step[data-vp-step="storyboard"]');
  await page.waitForTimeout(250);
  const afterReselect = await page.evaluate(() => ({
    strip: (document.querySelector('.vp-source-status')||{}).textContent||'',
    renderDisabled: (document.getElementById('vp-start-render')||{}).disabled,
    loadedBadges: Array.from(document.querySelectorAll('.vp-conf.high')).filter((n) => /source loaded/.test(n.textContent)).length,
    clips: JSON.parse(localStorage.getItem('hs_video_projects_v1'))[0].storyboard.filter((i) => i.type === 'clip').map((c) => [c.start, c.end])
  }));
  ok(/Renderable source loaded/.test(afterReselect.strip) && afterReselect.renderDisabled === false,
    'reselecting the same file restores renderability');
  ok(afterReselect.loadedBadges === 2, 'clips relink to the reselected file');
  ok(JSON.stringify(afterReselect.clips) === JSON.stringify([[0, 2], [2, 4]]),
    'reselecting does not disturb clip timings');

  // Deleting one clip leaves the other clip and the source intact.
  const afterDelete = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('.vp-sb-item'));
    const target = rows.find((r) => /0:00 → 0:02/.test(r.textContent));
    target.querySelector('.vp-sb-remove-btn').click();
    const rec = JSON.parse(localStorage.getItem('hs_video_projects_v1'))[0];
    return {
      clips: rec.storyboard.filter((i) => i.type === 'clip').map((c) => [c.start, c.end]),
      sourceMeta: rec.sourceMeta,
      playerSrc: (document.getElementById('vp-clip-player')||{getAttribute:()=>null}).getAttribute('src'),
      status: (document.getElementById('vp-storyboard-status')||{}).textContent||''
    };
  });
  ok(JSON.stringify(afterDelete.clips) === JSON.stringify([[2, 4]]),
    'deleting one clip removes only that clip');
  ok(!!afterDelete.sourceMeta && !!afterDelete.playerSrc,
    'deleting a clip does not delete the underlying source video');
  ok(/source video is untouched/i.test(afterDelete.status),
    'the UI confirms the source survived the delete');

  // ------------------------------------------------------------------
  // 6. Project A and Project B never share source media or clip state.
  // ------------------------------------------------------------------
  const idA = (await readStore())[0].id;
  await page.click('.vp-step[data-vp-step="source"]');
  await page.click('#vp-new-project');
  await page.waitForFunction(() => document.getElementById('vp-project-name')?.value === '');
  const snapshotA = JSON.stringify((await readStore()).find((p) => p.id === idA));

  const bState = await page.evaluate(() => ({
    playerSrc: (document.getElementById('vp-clip-player')||{getAttribute:()=>null}).getAttribute('src'),
    strip: (document.querySelector('.vp-source-status')||{}).textContent||'',
    addDisabled: (document.getElementById('vp-clip-add')||{}).disabled
  }));
  ok(bState.playerSrc === null, 'a new project does not inherit the previous project\'s media');
  ok(/No source video loaded/.test(bState.strip) && bState.addDisabled === true,
    'a new project reports no source and disables clip creation');

  await page.fill('#vp-project-name', 'Project B');
  await page.fill('#vp-transcript-paste', 'zulu yankee xray');
  await page.click('#vp-analyze-transcript');
  // Analyze advances to Step 2, which hides the source panel's Save button.
  await page.click('.vp-step[data-vp-step="source"]');
  await page.click('#vp-save-project');
  await page.waitForTimeout(120);

  const both = await readStore();
  const recA = both.find((p) => p.id === idA);
  const recB = both.find((p) => p.name === 'Project B');
  ok(JSON.stringify(recA) === snapshotA, 'saving project B leaves project A byte-for-byte unchanged');
  ok(!!recB && recB.sourceMeta === null && recB.storyboard.filter((i) => i.type === 'clip').length === 0,
    'project B has its own empty source state');
  ok(recA.sourceMeta && recA.sourceMeta.name === 'src6s.webm' &&
    recA.storyboard.filter((i) => i.type === 'clip').length === 1,
    'project A keeps its own source identity and clip');

  // Switching back to A must not silently attach B's (absent) media.
  await page.click('.vp-project-chip:text("Clips Project")');
  await page.waitForFunction(() => document.getElementById('vp-project-name')?.value === 'Clips Project');
  const backToA = await page.evaluate(() => ({
    playerSrc: (document.getElementById('vp-clip-player')||{getAttribute:()=>null}).getAttribute('src'),
    strip: (document.querySelector('.vp-source-status')||{}).textContent||'',
    clips: JSON.parse(localStorage.getItem('hs_video_projects_v1')).find((p) => p.name === 'Clips Project')
      .storyboard.filter((i) => i.type === 'clip').length
  }));
  ok(backToA.playerSrc === null && /must be reselected/i.test(backToA.strip),
    'switching back to A asks for A\'s own file rather than reusing any loaded media');
  ok(backToA.clips === 1, 'A\'s clip survives the round trip');

  // ------------------------------------------------------------------
  // 12. Existing transcript / statement / evidence / commentary behaviour.
  // ------------------------------------------------------------------
  const legacy = await page.evaluate(() => {
    const rec = JSON.parse(localStorage.getItem('hs_video_projects_v1')).find((p) => p.name === 'Clips Project');
    document.querySelector('.vp-step[data-vp-step="statements"]').click();
    const stmts = document.querySelectorAll('#vp-statements-list .vp-stmt').length;
    document.querySelector('.vp-step[data-vp-step="commentary"]').click();
    const comm = document.querySelectorAll('#vp-commentary-list .vp-stmt').length;
    return {
      transcript: rec.transcriptRaw,
      statements: rec.statements.length,
      statementsRendered: stmts,
      commentaryRendered: comm,
      hasClaim: rec.storyboard.some((i) => i.type === 'claim'),
      hasEvidence: rec.storyboard.some((i) => i.type === 'evidence'),
      hasCommentary: rec.storyboard.some((i) => i.type === 'commentary')
    };
  });
  ok(legacy.transcript === 'the county approved the data center today',
    'the transcript is unchanged by the source-media work');
  ok(legacy.statements === 1 && legacy.statementsRendered === 1 && legacy.commentaryRendered === 1,
    'statements and commentary still render');
  ok(legacy.hasClaim && legacy.hasEvidence && legacy.hasCommentary,
    'claim / evidence / commentary storyboard items still exist alongside clips');

  // ------------------------------------------------------------------
  // Legacy projects: fabricated source_clip/resume items migrate to clips
  // rather than disappearing or throwing.
  // ------------------------------------------------------------------
  await boot(JSON.stringify([{
    id: 'vp_legacy', name: 'Legacy Project', transcriptRaw: 'x', parsed: { plain: 'x', cues: [] },
    statements: [], hasSourceVideo: true,
    storyboard: [
      { type: 'source_clip', label: 'Source clip (intro)', start: 0, duration: 3 },
      { type: 'alert', title: 'DEVELOPMENT ALERT', subtitle: 'HomeSignal Intelligence' },
      { type: 'resume', label: 'Resume video', start: 12, duration: 4 }
    ],
    updatedAt: '2026-07-25T06:00:00Z'
  }]));
  await page.click('.vp-step[data-vp-step="storyboard"]');
  await page.waitForTimeout(200);
  const migrated = await page.evaluate(() => {
    const sb = JSON.parse(localStorage.getItem('hs_video_projects_v1'))[0].storyboard;
    return {
      types: sb.map((i) => i.type),
      clips: sb.filter((i) => i.type === 'clip').map((c) => [c.start, c.end]),
      rows: document.querySelectorAll('#vp-storyboard-list .vp-sb-item').length,
      renderDisabled: (document.getElementById('vp-start-render')||{}).disabled
    };
  });
  ok(migrated.types.indexOf('source_clip') < 0 && migrated.types.indexOf('resume') < 0,
    'legacy fabricated item types no longer exist after load');
  ok(JSON.stringify(migrated.clips) === JSON.stringify([[0, 3], [12, 16]]),
    'legacy items migrate to real clips preserving their one known timestamp');
  ok(migrated.rows === 3, 'the legacy sequence still renders with its original ordering');
  ok(migrated.renderDisabled === true,
    'a migrated legacy project cannot export until its source file is supplied');

  ok(!pageErrors.some((m) => !/createClient/.test(m)),
    'no uncaught Video Producer errors during the run: ' + JSON.stringify(pageErrors.filter((m) => !/createClient/.test(m))));
} finally {
  await browser.close();
  srv.close();
}

if (fails) { console.error('\n' + fails + ' assertion(s) failed'); process.exit(1); }
console.log('\nAll acquisition-video-producer-source assertions passed.');
