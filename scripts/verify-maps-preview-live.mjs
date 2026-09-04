#!/usr/bin/env node
// PRODUCTION PROOF for the MAPS founder-review / publish-parity fix.
//
// Runs on a GitHub runner, because the build sandbox has no egress to homesignal.net
// or to Supabase. It proves the DEPLOYED artifact, under PRODUCTION's own CSP, renders
// the REAL stored screenshot bytes for the RIGHT draft -- and that a draft whose image
// cannot be read stays un-approvable.
//
// What is real here: the served document, its CSP, the shipped preview functions, the
// image bytes (downloaded server-side from the private bucket with the service key),
// and the draft->image correspondence read from public.social_posts.
// What is simulated: the founder's logged-in session. The dashboard is gated by email
// OTP, which cannot be automated, and the service-role key MUST NOT reach a browser
// page (CLAUDE.md §Security). So the storage TRANSPORT is stubbed with the real bytes
// while every other part of the path is production. That limit is stated, never hidden.
import { chromium } from 'playwright';
import { surfaceBanner } from './lib/surface-banner.mjs';

// Names the surface and the tables this verifier reads, per the repo's surface rule:
// a clean layer is not evidence about a surface that bypasses it.
surfaceBanner('verify-maps-preview-live');

const SITE   = process.env.SITE_URL || 'https://homesignal.net';
const SB     = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SRK    = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const ANON   = (process.env.SUPABASE_ANON_KEY || '').trim();
if (!SB || !SRK) { console.error('SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required'); process.exit(1); }

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FAIL ${n}${d ? '\n         ' + d : ''}`); } };
const H = { apikey: SRK, Authorization: `Bearer ${SRK}` };
const sha256 = async (buf) => {
  const h = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
};

// ---------------------------------------------------------------- 1. the ARTIFACT
console.log('\n1. PRODUCTION ARTIFACT');
const docRes = await fetch(`${SITE}/acquisition.html`, { cache: 'no-store' });
const docBuf = await docRes.arrayBuffer();
const doc = new TextDecoder().decode(docBuf);
console.log(`   GET ${SITE}/acquisition.html -> ${docRes.status}, ${docBuf.byteLength} bytes`);
console.log(`   served sha256 = ${await sha256(docBuf)}`);
ok('production serves acquisition.html', docRes.ok);
ok('served CSP allows blob: as an image source (THE FIX)',
  /img-src 'self' data: blob:;/.test(doc));
ok('served CSP still does NOT allow the Supabase host as an image source',
  !/img-src[^;]*supabase\.co/.test(doc));
ok('served page downloads images instead of signing a URL',
  /storage\.from\('social-images'\)\.download\(p\.image_bucket_path\)/.test(doc));
ok('served page renders the Approve button LOCKED for image-bearing MAPS drafts',
  /data-gate="image" disabled/.test(doc));
ok('served page re-checks the gate in the click handler',
  /mapsImageRequired\(gr\) && !_bskyImgOk\[id\]/.test(doc));
ok('served page never makes the bucket public and holds no service key',
  !/getPublicUrl/.test(doc) && !/service_role|SUPABASE_SERVICE/.test(doc));

// ------------------------------------------------------- 2. the REAL drafts + bytes
console.log('\n2. REAL MAPS DRAFTS AND THEIR REAL IMAGE OBJECTS');
const q = async (path) => {
  const r = await fetch(`${SB}/rest/v1/${path}`, { headers: H });
  if (!r.ok) throw new Error(`${path} -> ${r.status} ${await r.text()}`);
  return r.json();
};
const withImg = await q('social_posts?content_family=eq.MAPS&image_bucket_path=not.is.null'
  + '&select=id,zip,post_text,hashtags,embed,embed_kind,image_bucket_path,status,scheduled_slot'
  + '&order=created_at.asc&limit=2');
const noImg = await q('social_posts?content_family=eq.MAPS&image_bucket_path=is.null'
  + '&select=id,zip,post_text,hashtags,embed,embed_kind,image_bucket_path,status'
  + '&order=created_at.asc&limit=1');
ok('two image-backed MAPS drafts exist (cases A and B)', withImg.length === 2);
ok('a no-image MAPS draft exists (case C)', noImg.length === 1);

const bytesFor = async (p) => {
  const r = await fetch(`${SB}/storage/v1/object/social-images/${encodeURIComponent(p)}`, { headers: H });
  if (!r.ok) throw new Error(`storage ${p} -> ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
};
const real = {};
for (const d of withImg) {
  real[d.id] = await bytesFor(d.image_bucket_path);
  console.log(`   ${d.id}  zip ${d.zip}  ${d.image_bucket_path}`);
  console.log(`      ${real[d.id].byteLength} bytes  sha256 ${await sha256(real[d.id].buffer)}`);
}
ok('the two drafts carry DIFFERENT image objects',
  withImg[0].image_bucket_path !== withImg[1].image_bucket_path);
ok('both objects are real PNGs (magic bytes)',
  withImg.every((d) => real[d.id][0] === 0x89 && real[d.id][1] === 0x50));
// This is the publisher's own read: same host, same bucket, same column, same key.
ok('these are the exact objects the publisher fetches (social-images/<image_bucket_path>)',
  withImg.every((d) => !!real[d.id].byteLength));

// ------------------------------------------------------------ 3. bucket is PRIVATE
console.log('\n3. PRIVATE STORAGE');
const anonTry = await fetch(
  `${SB}/storage/v1/object/social-images/${encodeURIComponent(withImg[0].image_bucket_path)}`,
  { headers: ANON ? { apikey: ANON, Authorization: `Bearer ${ANON}` } : {} });
console.log(`   anon GET of a real object -> ${anonTry.status}`);
ok('an anon read of a real object is REFUSED (bucket still private)', anonTry.status !== 200,
  `got ${anonTry.status}`);
const pubTry = await fetch(`${SB}/storage/v1/object/public/social-images/${encodeURIComponent(withImg[0].image_bucket_path)}`);
console.log(`   public-path GET -> ${pubTry.status}`);
ok('the public storage path is REFUSED too', pubTry.status !== 200, `got ${pubTry.status}`);

// -------------------------------------------- 4. render in the LIVE page, real bytes
console.log('\n4. LIVE FOUNDER REVIEW');
const browser = await chromium.launch();
const page = await browser.newPage();
const csp = [];
page.on('console', (m) => { if (/Content Security Policy/i.test(m.text())) csp.push(m.text()); });
await page.goto(`${SITE}/acquisition.html`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => typeof window.bskyRenderImage === 'function', { timeout: 30000 })
  .catch(() => {});
const live = await page.evaluate(() => typeof window.bskyRenderImage === 'function');
ok('the LIVE page defines the shipped preview functions', live);
if (!live) { await browser.close(); console.log(`\n${pass} passed, ${fail} failed`); process.exit(1); }

// Stub ONLY the storage transport, with the real bytes fetched above.
await page.evaluate(({ map }) => {
  const B = {};
  for (const k of Object.keys(map)) B[k] = Uint8Array.from(atob(map[k]), (c) => c.charCodeAt(0));
  window.hsClient = window.hsClient || {};
  window.hsClient.storage = { from: () => ({ download: (path) => Promise.resolve(
    B[path] ? { data: new Blob([B[path]], { type: 'image/png' }), error: null }
            : { data: null, error: { message: 'Object not found' } }) }) };
  const mk = (id) => {
    if (document.querySelector(`[data-post="${id}"]`)) return;
    const c = document.createElement('div');
    c.className = 'card'; c.setAttribute('data-post', id);
    c.innerHTML = '<button class="bsky-btn" data-act="approve" data-gate="image" disabled>Approve</button>'
      + `<div id="vis-${id}"></div>`;
    document.body.appendChild(c);
  };
  window.__mk = mk;
}, { map: Object.fromEntries(withImg.map((d) => [d.image_bucket_path, Buffer.from(real[d.id]).toString('base64')])) });

const renderOne = async (row) => {
  await page.evaluate((id) => window.__mk(id), row.id);
  return page.evaluate((r) => new Promise((res) => {
    bskyRenderImage(document.getElementById('vis-' + r.id), r, null,
      (okFlag) => { bskyApplyApprovalGate(r.id); res(okFlag); });
  }), row);
};

// CASE A
const A = withImg[0];
const aOk = await renderOne(A);
const aInfo = await page.evaluate((id) => {
  const i = document.querySelector(`#vis-${id} img`);
  if (!i) return null;
  const c = document.createElement('canvas');
  c.width = i.naturalWidth; c.height = i.naturalHeight;
  c.getContext('2d').drawImage(i, 0, 0);
  return { w: i.naturalWidth, h: i.naturalHeight, blob: i.src.startsWith('blob:'),
           complete: i.complete, px: c.toDataURL().length };
}, A.id);
console.log(`   CASE A  ${A.id}  zip ${A.zip}  ${A.image_bucket_path}`);
console.log(`      rendered ${aInfo && aInfo.w}x${aInfo && aInfo.h}, blob=${aInfo && aInfo.blob}`);
ok('CASE A — the real screenshot VISIBLY RENDERS in the live page',
  aOk === true && !!aInfo && aInfo.w > 0 && aInfo.h > 0 && aInfo.complete);
ok('CASE A — no broken-image state (natural dimensions are non-zero)',
  !!aInfo && aInfo.w >= 1200 && aInfo.h >= 600, JSON.stringify(aInfo));
ok('CASE A — Approve UNLOCKS only after that image painted',
  (await page.evaluate((id) => !document.querySelector(`[data-post="${id}"] button`).disabled, A.id)));

// CASE B
const B = withImg[1];
await renderOne(B);
const cmp = await page.evaluate(([a, b]) => {
  const read = (id) => {
    const i = document.querySelector(`#vis-${id} img`);
    const c = document.createElement('canvas');
    c.width = i.naturalWidth; c.height = i.naturalHeight;
    c.getContext('2d').drawImage(i, 0, 0);
    return { src: i.src, data: c.toDataURL() };
  };
  const x = read(a), y = read(b);
  return { differentUrl: x.src !== y.src, differentPixels: x.data !== y.data };
}, [A.id, B.id]);
console.log(`   CASE B  ${B.id}  zip ${B.zip}  ${B.image_bucket_path}`);
ok('CASE B — the second draft renders its OWN object', cmp.differentUrl);
ok('CASE B — the two previews PAINT different images (pixel comparison)', cmp.differentPixels);

// UNREADABLE -> FAIL CLOSED
const X = { id: 'gone', content_family: 'MAPS', image_bucket_path: 'maps/does-not-exist.png' };
const xOk = await renderOne(X);
ok('an unreadable image reports the failure instead of failing silently', xOk === false);
ok('FAIL CLOSED — Approve stays LOCKED when the image cannot be shown',
  (await page.evaluate(() => document.querySelector('[data-post="gone"] button').disabled)) === true);

// CASE C
const C = noImg[0];
console.log(`   CASE C  ${C.id}  zip ${C.zip}  (no image_bucket_path)`);
ok('CASE C — a no-image draft is not image-gated and renders no <img>',
  (await page.evaluate((r) => mapsImageRequired(r) === false && mapsVisual(r) === '',
    { ...C, evidence: {} })) === true);
ok('no CSP violation occurred in the live page while rendering', csp.length === 0, csp[0]);

// ------------------------------------------------- 5. payload parity, from the row
console.log('\n5. PAYLOAD PARITY (values read back from the persisted row)');
for (const d of [A, B]) {
  console.log(`   ${d.id}`);
  console.log(`      text      ${JSON.stringify(d.post_text).slice(0, 96)}…`);
  console.log(`      hashtags  ${JSON.stringify(d.hashtags)}`);
  console.log(`      embed     ${d.embed_kind} -> ${d.embed && d.embed.uri}`);
}
ok('both drafts are app.bsky.embed.external with a destination uri',
  [A, B].every((d) => d.embed_kind === 'external' && d.embed && d.embed.uri));
ok('the preview reads text/hashtags/link from the persisted row, not a regeneration',
  /esc\(p\.post_text\)/.test(doc) && /p\.hashtags\|\|\[\]/.test(doc) && /esc\(e\.uri\)/.test(doc));

// -------------------------------------------------------------- 6. publication hold
console.log('\n6. PUBLICATION HOLD');
const all = await q('social_posts?content_family=eq.MAPS&select=status,scheduled_slot');
const n = (f) => all.filter(f).length;
console.log(`   MAPS rows ${all.length} · approved ${n((r) => r.status === 'approved')}`
  + ` · scheduled ${n((r) => r.scheduled_slot)} · published ${n((r) => r.status === 'published')}`);
ok('0 MAPS approved', n((r) => r.status === 'approved') === 0);
ok('0 MAPS scheduled', n((r) => r.scheduled_slot) === 0);
ok('0 MAPS published', n((r) => r.status === 'published') === 0);

await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
