// Browser proof: the ZIP page shows a SMALL Map 1 preview near the top to EVERY visitor,
// signed in or not, with "View full Development Map →" under it opening the full map.
//
// Founder, 2026-10-02, on the signed-out community.html?zip=78657: "a map should be on this
// page. it should be like the other page where it is at the top and small but you can click
// on View Development Map ... to expand to full map development page." The other page is
// development.html, whose preview is pinned by development-map-preview.browser.test.mjs.
//
// Before this, the map was withheld from signed-out visitors (the 2026-09-10 A-022 posture),
// so the public page carried no map at all. ZIP health keeps that gate, and §3 checks it.
//
// Run: node test/zip-map-preview.browser.test.mjs
import { createServer } from 'node:http';
import { readFile } from './lib/serve-page.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, normalize } from 'node:path';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch (e) {
  console.log('SKIP zip-map-preview.browser.test.mjs — playwright not installed');
  process.exit(0);
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0;
const ok = (c, name, detail) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name);
  if (!c) { fails++; if (detail !== undefined) console.log('           detail: ' + JSON.stringify(detail)); }
};

const ZIP = '78617';   // the seed community (Del Valle, TX), status 'pass' in seed mode

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
// Seed mode signs a visitor in only through ?demo=1, and a demo session is excluded from
// ZIP health on purpose. For the signed-in check (§3) the server serves shell.js with that
// one flag flipped, the same rewrite place-changing-heading.browser.test.mjs uses. Only
// requests carrying ?signedin=1 get it, so §1 and §2 run the shipped file unchanged.
const DEMO_FLAG = 'demo: true, name: u.name, initials: u.initials';
const server = createServer(async (req, res) => {
  const p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
  if (!p.startsWith(root)) { res.writeHead(403).end(); return; }
  try {
    let body = await readFile(p);
    if (p.endsWith('shell.js') && /[?&]signedin=1/.test(req.headers.referer || '')) {
      const text = String(body);
      if (text.indexOf(DEMO_FLAG) < 0) throw new Error('shell.js seed session string moved');
      body = Buffer.from(text.replace(DEMO_FLAG, 'demo: false, name: u.name, initials: u.initials'));
    }
    res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' }).end(body);
  } catch { res.writeHead(404).end('not found'); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;

const browser = await chromium.launch({ channel: 'chrome' }).catch(() =>
  chromium.launch(process.env.HS_CHROME ? { executablePath: process.env.HS_CHROME } : {}));

// A stub supabase-js. `signedIn` decides what getSession returns: null is a signed-out
// visitor, exactly what the live site sees without an account.
const supabaseStub = (signedIn) => `window.supabase={createClient:function(){
  function q(){
    var o={};
    ['select','eq','in','order','limit','contains','gte','lte','not','or','filter','range','match','maybeSingle','single','insert','update','delete','upsert']
      .forEach(function(m){ o[m]=function(){ return o; }; });
    o.then=function(r){ return Promise.resolve({data:[],error:null}).then(r); };
    return o;
  }
  var sess = ${signedIn ? "{user:{id:'00000000-0000-0000-0000-000000000001',email:'resident@example.com'},access_token:'t'}" : 'null'};
  return {
    from:function(){ return q(); },
    rpc:function(){ return Promise.resolve({data:null,error:null}); },
    functions:{invoke:function(){ return Promise.resolve({data:null,error:null}); }},
    auth:{
      getSession:function(){ return Promise.resolve({data:{session:sess}}); },
      getUser:function(){ return Promise.resolve({data:{user:sess && sess.user}}); },
      onAuthStateChange:function(){ return {data:{subscription:{unsubscribe:function(){}}}}; }
    }
  };
}};`;

async function openZip(width, height, signedIn) {
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.startsWith(base)) return route.continue();
    if (url.includes('/rest/v1/') || url.includes('/auth/v1/') || url.includes('/functions/v1/')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    }
    if (url.includes('cdn.jsdelivr.net')) {
      return route.fulfill({ status: 200, contentType: url.endsWith('.css') ? 'text/css' : 'text/javascript',
        body: url.endsWith('.css') ? '' : supabaseStub(signedIn) });
    }
    return route.abort();
  });
  await page.goto(base + '/community.html?data=seed&zip=' + ZIP + (signedIn ? '&demo=1&signedin=1' : ''),
    { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.HS && window.HS.ready);
  await page.evaluate(() => window.HS.ready);
  await page.waitForSelector('#zip-score-strip', { timeout: 20000 });
  return { context, page };
}

// ── 1. Signed out: the map is there, small, at the top, with the full-map link ─────────
for (const [w, h, label] of [[1280, 800, 'desktop'], [390, 844, 'mobile']]) {
  const { context, page } = await openZip(w, h, false);
  const signedIn = await page.evaluate(() => !!(window.HS.state && window.HS.state.session));
  ok(!signedIn, label + ': the visitor is signed out (control)', signedIn);
  const n = await page.locator('iframe#zipMapFrame').count();
  ok(n === 1, label + ': a signed-out visitor sees exactly one map', n);
  const src = await page.getAttribute('#zipMapFrame', 'src');
  ok(src === 'homesignalmap.html?embed=1&zip=' + ZIP, label + ': the map is Map 1 in embed mode for this ZIP', src);
  const full = await page.locator('#zipMapFull');
  ok(await full.count() === 1 && /View full Development Map/.test(await full.innerText()),
    label + ': "View full Development Map →" sits under the map');
  const fullHref = await page.evaluate(() => {
    const a = document.getElementById('zipMapFull');
    return a ? new URL(a.getAttribute('href'), location.href) : null;
  }).then((u) => u && { path: new URL(u).pathname, zip: new URL(u).searchParams.get('zip'), embed: new URL(u).searchParams.get('embed') });
  ok(!!fullHref && fullHref.path === '/homesignalmap.html' && fullHref.zip === ZIP && fullHref.embed === null,
    label + ': ...and it opens the FULL Development Map for this ZIP, not the embed', fullHref);
  const geo = await page.evaluate(() => {
    const ph = document.querySelector('#commPage .ph') || document.querySelector('.ph');
    const ctx = document.getElementById('zipContext');
    const strip = document.getElementById('zip-score-strip');
    const frame = document.getElementById('zipMapFrame').getBoundingClientRect();
    const link = document.getElementById('zipMapFull').getBoundingClientRect();
    return {
      order: !!(ph && ctx && strip) && !!(ph.compareDocumentPosition(ctx) & 4) && !!(ctx.compareDocumentPosition(strip) & 4),
      linkInFrame: !!document.getElementById('zipMapFrame').querySelector('a'),
      linkBelow: link.top >= frame.bottom,
      h: Math.round(frame.height), w: Math.round(frame.width),
      sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth,
      health: !!document.getElementById('zip-health-authed'),
    };
  });
  ok(geo.order, label + ': order is header, then the map, then the score strip', geo);
  ok(geo.linkBelow && !geo.linkInFrame, label + ': the link is below the map, outside the frame', geo);
  console.log('      ' + label + ' map ' + geo.w + 'x' + geo.h + ' (viewport ' + geo.cw + ', scrollWidth ' + geo.sw + ')');
  ok(geo.h >= 280 && geo.h <= 425, label + ': the map is small, like the Development page preview', geo.h);
  ok(geo.sw <= geo.cw, label + ': no horizontal overflow', geo);
  ok(!geo.health, label + ': ZIP health still needs a session — signed out, it is not shown', geo.health);

  if (label === 'desktop') {
    // Same size as development.html's preview, measured on the rendered page.
    const dctx = await browser.newContext({ viewport: { width: w, height: h } });
    const dp = await dctx.newPage();
    await dp.route('**/*', (route) => {
      const url = route.request().url();
      if (url.startsWith(base)) return route.continue();
      if (url.includes('/rest/v1/') || url.includes('/auth/v1/') || url.includes('/functions/v1/'))
        return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      if (url.includes('cdn.jsdelivr.net'))
        return route.fulfill({ status: 200, contentType: 'text/javascript', body: supabaseStub(false) });
      return route.abort();
    });
    await dp.goto(base + '/development.html?data=seed&zip=' + ZIP, { waitUntil: 'domcontentloaded' });
    await dp.waitForSelector('#devMapFrame', { timeout: 20000 });
    const devH = await dp.evaluate(() => Math.round(document.getElementById('devMapFrame').getBoundingClientRect().height));
    ok(devH === geo.h, 'desktop: the ZIP map is the same height as the Development page preview (' + geo.h + ' vs ' + devH + ')');
    await dctx.close();

    // Inside the frame is canonical Map 1 with its own controls.
    await page.evaluate(() => document.getElementById('zipMapFrame').scrollIntoView());
    const frame = await (await page.waitForSelector('#zipMapFrame')).contentFrame();
    await frame.waitForLoadState('domcontentloaded');
    await frame.waitForFunction(() => window.HS && window.HS.ready, null, { timeout: 20000 });
    const inside = await frame.evaluate(() => ({
      embed: document.documentElement.classList.contains('hs-embed'),
      key: !!document.querySelector('#mapkey'),
      map: !!document.querySelector('#map'),
      zip: new URL(location.href).searchParams.get('zip'),
    }));
    ok(inside.embed && inside.key && inside.map && inside.zip === ZIP,
      'desktop: inside the frame is Map 1 in embed mode, with its controls, for this ZIP', inside);
  }
  await context.close();
}

// ── 2. The header keeps its own "View Development Map →" ───────────────────────────────
{
  const { context, page } = await openZip(1280, 800, false);
  const headerLink = await page.evaluate(() => {
    const ph = document.querySelector('#commPage .ph') || document.querySelector('.ph');
    return !!ph && [...ph.querySelectorAll('a')].some((a) => /View Development Map/.test(a.textContent));
  });
  ok(headerLink, 'the header still carries "View Development Map →"');
  await context.close();
}

// ── 3. Signed in: the same map, plus ZIP health ────────────────────────────────────────
{
  const { context, page } = await openZip(1280, 800, true);
  const s = await page.evaluate(() => ({
    sess: !!(window.HS.state && window.HS.state.session),
    frames: document.querySelectorAll('iframe#zipMapFrame').length,
    src: (document.getElementById('zipMapFrame') || {}).getAttribute && document.getElementById('zipMapFrame').getAttribute('src'),
    health: !!document.getElementById('zip-health-authed'),
  }));
  ok(s.sess, 'signed in: the visitor has a session (control)', s);
  ok(s.frames === 1 && s.src === 'homesignalmap.html?embed=1&zip=' + ZIP, 'signed in: the same single map', s);
  ok(s.health, 'signed in: ZIP health is shown', s);
  await context.close();
}

await browser.close();
server.close();
console.log(fails ? '\nFAILED ' + fails : '\nAll ZIP map-preview browser checks passed');
process.exit(fails ? 1 : 0);
