// Proves the SHIPPED preview code renders a real image under the SHIPPED CSP, in a real
// browser. The functions and the CSP are EXTRACTED from acquisition.html rather than
// retyped, so this cannot pass against a stale copy of either.
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Imported in the form scripts/run-unit-tests.mjs detects, so this file is classified
// BROWSER-BACKED and never runs in the required offline job without a browser.
let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  // Globally-installed playwright (this sandbox and the Actions image both have one).
  const { createRequire } = await import('node:module');
  const req = createRequire(import.meta.url);
  try { ({ chromium } = req('/opt/node22/lib/node_modules/playwright')); } catch {}
}
if (!chromium) {
  console.log('SKIP maps-preview-render.test.mjs — playwright not installed '
    + '(run: npx -p playwright node test/maps-preview-render.test.mjs)');
  process.exit(0);
}
const HERE = dirname(fileURLToPath(import.meta.url));
const DASH = readFileSync(join(HERE, '..', 'acquisition.html'), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log(`  ok  ${n}`); }
  else { fail++; console.log(`  FAIL ${n}${d ? ' — ' + d : ''}`); } };

// --- extract, never retype ---------------------------------------------------------
const csp = (DASH.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/) || [])[1];
if (!csp) throw new Error('CSP meta not found in acquisition.html');
const slice = (from, to) => {
  const i = DASH.indexOf(from), j = DASH.indexOf(to, i);
  if (i < 0 || j < 0) throw new Error(`could not extract ${from}`);
  return DASH.slice(i, j);
};
const shipped = slice('  var _bskyBlobUrl = {};', '  // VISUAL STATUS.')
              + slice('  function mapsVisual(p){', '  function mapsEvidence(');
// ⚖️ THE SHIPPED MAP-GATE LIBS ARE LOADED, NOT STUBBED. The approval gate now consults
// the UNIVERSAL map requirement (HS.mapsMapGateBlock), which FAILS CLOSED when its module
// is absent — so a harness that omits them would lock every button and this suite would be
// measuring the fail-closed branch while claiming to measure the image-painted one.
const LIBS = ['map', 'maps-social-theme', 'maps-capture-policy', 'maps-capture-binding']
  .map((f) => readFileSync(join(HERE, '..', 'lib', `${f}.js`), 'utf8')).join('\n');

// Two DIFFERENT 1x1 PNGs, so "each draft shows its own image" is a real comparison.
const PNG_RED  = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const PNG_BLUE = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

const html = `<meta http-equiv="Content-Security-Policy" content="${csp}">
<div id="host"></div>
<div class="card" data-post="A"><button class="bsky-btn" data-act="approve" data-gate="image" disabled>Approve</button></div>
<div class="card" data-post="B"><button class="bsky-btn" data-act="approve" data-gate="image" disabled>Approve</button></div>
<div class="card" data-post="X"><button class="bsky-btn" data-act="approve" data-gate="image" disabled>Approve</button></div>
<div class="card" data-post="C"><button class="bsky-btn" data-act="approve">Approve</button></div>
<div id="vis-A"></div><div id="vis-B"></div><div id="vis-X"></div>
<script>
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){
  return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
var BYTES={ 'maps/a.png': window.__A, 'maps/b.png': window.__B };
window.hsClient={ storage:{ from:function(){ return { download:function(path){
  var b=BYTES[path];
  return Promise.resolve(b ? {data:new Blob([b],{type:'image/png'}),error:null}
                           : {data:null,error:{message:'Object not found'}});
} }; } } };
window.HS = window.HS || {};
${LIBS}
${shipped}
</script>`;

const dir = mkdtempSync(join(tmpdir(), 'hs-preview-'));
const file = join(dir, 'harness.html');
writeFileSync(file, html);

console.log('MAPS preview render (real browser, shipped code, shipped CSP)');
const browser = await chromium.launch();
const page = await browser.newPage();
const cspViolations = [];
page.on('console', (m) => { if (/Content Security Policy/i.test(m.text())) cspViolations.push(m.text()); });
page.on('pageerror', (e) => console.log('  PAGEERROR:', String(e.message).slice(0,300)));
await page.addInitScript(({ a, b }) => {
  const dec = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  window.__A = dec(a); window.__B = dec(b);
}, { a: PNG_RED.toString('base64'), b: PNG_BLUE.toString('base64') });
await page.goto(pathToFileURL(file).href);

// ⚖️ EACH MAPS ROW CARRIES A ZIP AND A BOUND ZIP-SCOPE CAPTURE, because every MAPS post
// now needs one to reach approval at all. Without it the universal gate refuses first and
// the image-painted gate — the thing this suite exists to measure — is never reached. The
// key is stamped IN-PAGE by the shipped builder, never typed here.
const mapsRow = (id, path) => ({
  id, content_family: 'MAPS', tile: 'development', zip: '80210', image_bucket_path: path,
  evidence: { visual: { scope: 'zip' } },
});
const rowA = mapsRow('A', 'maps/a.png');
const rowB = mapsRow('B', 'maps/b.png');
const rowX = mapsRow('X', 'maps/missing.png');
const rowC = mapsRow('C', null);
const rowAl = { id: 'AL', content_family: 'ALERTS', image_bucket_path: 'maps/a.png' };

// ⚠️ THE ROW IS REGISTERED FIRST, exactly as the shipped queue renderer does. The gate keys
// its "this image has painted" flag on the row id PLUS its image path — because a re-capture
// writes a NEW object path, and a flag keyed on the id alone would let a SUPERSEDED blob mark
// a new image as seen. So the gate needs the row to know which path it is asking about, and
// a row it has never seen stays LOCKED (§ below pins that, so the dependency is a stated
// property rather than an accident of this harness).
const render = async (row) => page.evaluate((r) => new Promise((res) => {
  if (r.content_family === 'MAPS' && r.evidence && r.evidence.visual) {
    r.evidence.visual.capture_key = HS.mapsCaptureKey(r, 'zip');
  }
  _bskyRows[r.id] = r;
  const host = document.getElementById('vis-' + r.id);
  bskyRenderImage(host, r, null, (okFlag) => { bskyApplyApprovalGate(r.id); res(okFlag); });
}), row);

// CASE A ---------------------------------------------------------------------------
const aOk = await render(rowA);
const a = await page.evaluate(() => { const i = document.querySelector('#vis-A img');
  return i ? { src: i.src, w: i.naturalWidth } : null; });
ok('CASE A — the image actually PAINTS in the browser under the page CSP',
  aOk === true && a && a.w === 1, JSON.stringify(a));
ok('CASE A — it is rendered from a blob: URL (the download path), not a remote URL',
  !!a && a.src.startsWith('blob:'), a && a.src);
ok('CASE A — approve UNLOCKS once the exact image has painted',
  (await page.evaluate(() => !document.querySelector('[data-post="A"] button').disabled)) === true);

// CASE A2 — A NEW IMAGE ON THE SAME ROW IS A CACHE MISS ------------------------------
// This is the "a cached blob shows an older image" path, and it is the reason the flag is
// keyed on the path. The row keeps its id and gets a NEW object (what a re-capture writes);
// the gate must LOCK again until that specific image has painted.
const rowA2 = mapsRow('A', 'maps/b.png');
await page.evaluate((r) => {
  r.evidence.visual.capture_key = HS.mapsCaptureKey(r, 'zip');
  _bskyRows[r.id] = r; bskyApplyApprovalGate(r.id);
}, rowA2);
ok('CASE A2 — a re-captured row LOCKS again: the old blob cannot vouch for the new image',
  (await page.evaluate(() => document.querySelector('[data-post="A"] button').disabled)) === true);
const a2Ok = await render(rowA2);
const a2 = await page.evaluate(() => document.querySelector('#vis-A img').src);
ok('CASE A2 — …and the NEW object is fetched and painted, not served from the id cache',
  a2Ok === true && a2.startsWith('blob:') && a2 !== a.src, `${a.src} vs ${a2}`);
ok('CASE A2 — approve unlocks only once THAT image has painted',
  (await page.evaluate(() => !document.querySelector('[data-post="A"] button').disabled)) === true);
// Restore case A's own row so the later cases read the state they were written against.
await render(rowA);

// CASE B ---------------------------------------------------------------------------
await render(rowB);
const b = await page.evaluate(() => document.querySelector('#vis-B img').src);
ok('CASE B — the second draft renders its OWN object, not case A\'s',
  b.startsWith('blob:') && b !== a.src, `${a.src} vs ${b}`);
// Compare what is actually PAINTED, not the URLs -- two previews could share bytes
// behind different blob handles. Canvas readback of a same-origin blob is permitted;
// fetch(blob:) is not, because connect-src does not list blob: (the CSP working).
const pixels = await page.evaluate(() => {
  const read = (sel) => {
    const img = document.querySelector(sel);
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    c.getContext('2d').drawImage(img, 0, 0);
    return Array.from(c.getContext('2d').getImageData(0, 0, 1, 1).data).join(',');
  };
  return { a: read('#vis-A img'), b: read('#vis-B img') };
});
ok('CASE B — the two previews PAINT different pixels (compared, not inferred from URLs)',
  pixels.a !== pixels.b, JSON.stringify(pixels));

// UNREADABLE IMAGE -> FAIL CLOSED ---------------------------------------------------
const xOk = await render(rowX);
ok('an unreadable image reports failure rather than rendering nothing quietly',
  xOk === false && (await page.evaluate(() => /IMAGE COULD NOT BE READ/.test(
    document.getElementById('vis-X').textContent))));
ok('FAIL CLOSED — approve stays LOCKED when the image cannot be shown',
  (await page.evaluate(() => document.querySelector('[data-post="X"] button').disabled)) === true);

// CASE C + ALERTS -------------------------------------------------------------------
// ⚖️ FLIPPED — EVERY MAPS POST MUST HAVE A MAP. A no-image MAPS draft used to be "not
// image-gated", which is how 27 of 55 drafts rendered an ENABLED Approve button with no map
// behind it: `mapsImageRequired` required `image_bucket_path`, so the lock was conditional
// on the very thing it was meant to demand. It still renders no <img> — there is nothing to
// render — but it is gated, and the gate holds it shut.
ok('CASE C — a no-image MAPS draft IS image-gated, and still renders no <img>',
  (await page.evaluate((r) => mapsImageRequired(r) === true && mapsVisual(r) === '', rowC)) === true);
ok('CASE C — …and the universal map gate blocks it, naming the missing screenshot',
  (await page.evaluate((r) => /No Map 1 screenshot exists/.test(bskyMapGateBlock(r)), rowC)) === true);
ok('ALERTS is never image-gated by this change',
  (await page.evaluate((r) => mapsImageRequired(r) === false, rowAl)) === true);
ok('no CSP violation was reported while rendering', cspViolations.length === 0,
  cspViolations[0]);

await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
