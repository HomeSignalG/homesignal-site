// PRODUCTION PROOF for the canonical ZIP community pages.
//
// The sandbox has no egress to homesignal.net (the agent proxy answers 403 to CONNECT), so
// this runs on a GitHub runner — the same reason verify-communities.yml exists. It is
// READ-ONLY: it fetches public URLs and renders them. It writes nothing anywhere.
//
// It is the deployed twin of scripts/prove-zip-pages.mjs, which proves the same contract
// against the built artifact BEFORE deployment. Two instruments, one contract: if they ever
// disagree, the deployment is what changed.
//
// WHAT IT PROVES, and what it deliberately does not:
//   * every SEO assertion is made against the INITIAL HTTP RESPONSE BODY — the bytes, before
//     any JavaScript. A post-JS DOM is never accepted as proof of crawlability.
//   * JavaScript is then executed separately, and asserted only to have NOT reversed the
//     build-time decision or deleted the content the crawler was served.
//
// Controls are passed in as CONTROLS (classes A-J) so a reclassification by normal ingestion
// is a visible one-line replacement rather than an edit to this file.
import { chromium } from 'playwright';

const SITE = (process.env.SITE_BASE || 'https://homesignal.net').replace(/\/$/, '');
const UA_MOB = 'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/W.X.Y.Z Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';
const UA_DESK = 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Googlebot/2.1; +http://www.google.com/bot.html) Chrome/W.X.Y.Z Safari/537.36';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('PASS —', m); } else { fail++; console.error('FAIL —', m); } };
const grab = (h, re) => { const m = re.exec(h); return m ? m[1].trim() : null; };
const sha = async (s) => {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(b)].slice(0, 12).map((x) => x.toString(16).padStart(2, '0')).join('');
};
const get = async (url, ua) => {
  const r = await fetch(url, { headers: ua ? { 'User-Agent': ua } : {}, redirect: 'follow' });
  return { status: r.status, url: r.url, redirected: r.redirected,
           xRobots: r.headers.get('x-robots-tag'), ct: r.headers.get('content-type'),
           body: await r.text() };
};

// Every SEO field, read from the initial bytes only.
const seo = (h) => ({
  robots: grab(h, /<meta name="robots" content="([^"]+)"/),
  canonical: grab(h, /<link rel="canonical" href="([^"]+)"/),
  title: grab(h, /<title>([^<]+)<\/title>/),
  desc: grab(h, /<meta name="description" content="([^"]+)"/),
  h1: grab(h, /<h1>([^<]+)<\/h1>/),
  items: (h.match(/<section class="zsec"><h2>[^<]+<\/h2><ul>/g) || []).length,
  headings: (h.match(/<h2>([^<]+)<\/h2>/g) || []).map((x) => x.replace(/<\/?h2>/g, '')),
  links: (h.match(/<nav class="zsec">[\s\S]*?<\/nav>/) || [''])[0],
});

const main = async () => {
  const C = JSON.parse(process.env.CONTROLS || '{}');
  for (const k of ['pass_dev_pass', 'pass_dev_fail', 'fail_dev_pass', 'fail_dev_fail', 'local_news',
                   'weather_thin', 'honest_empty', 'fanout', 'point_dense',
                   'meetings_same_a', 'meetings_same_b', 'meetings_other']) {
    if (!C[k]) throw new Error(`CONTROLS is missing ${k}`);
  }
  console.log(`base: ${SITE}\ncontrols: ${JSON.stringify(C)}\n`);

  // ---- STEP 5/6: initial HTML, three user agents ----------------------------------------
  const body = {};
  for (const [cls, zip] of Object.entries(C)) {
    const r = await get(`${SITE}/community/${zip}/`);
    body[cls] = r;
    ok(r.status === 200, `[${zip}] ${cls}: initial response HTTP 200`);
    ok(!r.redirected, `[${zip}] ${cls}: no redirect — the canonical path is served directly`);
    const s = seo(r.body);
    ok(s.canonical === `${SITE}/community/${zip}/`, `[${zip}] self-canonical ${s.canonical}`);
    ok((s.title || '').length > 20 && (s.h1 || '').includes(zip),
       `[${zip}] ZIP-specific title + H1 (${JSON.stringify(s.h1)})`);
    ok((s.desc || '').includes(zip), `[${zip}] ZIP-specific meta description`);
    ok(['Government notices', 'Upcoming public meetings', 'Local news']
        .every((x) => s.headings.includes(x)), `[${zip}] all three Alerts headings present`);
    ok(/homesignalmap\.html\?zip=/.test(s.links) && /href="\/"/.test(s.links),
       `[${zip}] usable internal links in the initial HTML`);
    ok(!r.xRobots, `[${zip}] no X-Robots-Tag header overriding the page's own directive`);
  }
  const idx = ['pass_dev_pass', 'pass_dev_fail', 'local_news', 'fanout', 'point_dense'];
  const nidx = ['fail_dev_pass', 'fail_dev_fail', 'weather_thin', 'honest_empty'];
  for (const k of idx) {
    const s = seo(body[k].body);
    ok(s.robots === 'index, follow', `[${C[k]}] ${k}: initial HTML is index, follow`);
    ok(s.items > 0, `[${C[k]}] ${k}: initial HTML carries real Alerts items (${s.items} list sections)`);
  }
  for (const k of nidx) {
    const s = seo(body[k].body);
    ok(s.robots === 'noindex, follow', `[${C[k]}] ${k}: initial HTML is noindex, follow`);
    ok(/No government notices on file|No upcoming public meetings on file|No qualifying local news on file/.test(body[k].body)
       || s.items > 0, `[${C[k]}] ${k}: honest content — either real items or a truthful empty line`);
  }
  // weather displays but never carries Rule F
  ok(/<h2>Weather alerts<\/h2>/.test(body.weather_thin.body),
     `F [${C.weather_thin}] weather is DISPLAYED on a page it did not qualify`);

  // ---- STEP 6: no cloaking ---------------------------------------------------------------
  for (const k of ['pass_dev_fail', 'fail_dev_pass']) {
    const z = C[k];
    const n = body[k];
    const m = await get(`${SITE}/community/${z}/`, UA_MOB);
    const d = await get(`${SITE}/community/${z}/`, UA_DESK);
    const [hn, hm, hd] = await Promise.all([sha(n.body), sha(m.body), sha(d.body)]);
    console.log(`  [${z}] body sha12 normal ${hn} · gbot-mobile ${hm} · gbot-desktop ${hd}`);
    ok(hn === hm && hn === hd, `[${z}] Googlebot smartphone + desktop receive BYTE-IDENTICAL HTML`);
    ok(m.status === 200 && d.status === 200, `[${z}] both Googlebot UAs get HTTP 200`);
    ok(seo(m.body).robots === seo(n.body).robots && seo(d.body).robots === seo(n.body).robots,
       `[${z}] the robots directive does not vary by user agent`);
  }
  ok(body.pass_dev_fail.body !== body.fail_dev_pass.body, 'two ZIPs return different documents');

  // ---- STEP 8: local news is IN the page that local news qualified ------------------------
  {
    const h = body.local_news.body;
    const sec = /<h2>Local news<\/h2><ul>([\s\S]*?)<\/ul>/.exec(h);
    const n = sec ? (sec[1].match(/<li>/g) || []).length : 0;
    console.log(`  [${C.local_news}] local news items in initial HTML: ${n}`);
    ok(n > 0, `[${C.local_news}] the local news that qualifies this page is IN the initial HTML`);
  }

  // ---- STEP 9: meetings geography — the cascade is real, the leak is not ----------------
  // The defect this detects: meetings attached by walking DOWN to every ZIP descendant with
  // no most-specific resolution and no sibling-exclusion, which put other jurisdictions'
  // meetings on a ZIP page and counted them toward Rule F.
  //
  // ⚠️ HONEST SCOPE, stated rather than implied: the sibling-exclusion rule
  // (`City government (X)` scoped to the ZIP's own place) is VACUOUS in production today —
  // there are currently ZERO forward-dated `City government (%)` meetings in the table, so
  // there is nothing for it to exclude and this control cannot exercise it. That specific
  // rule is proven by the offline fixture instead (test/zip-pages-seo.test.mjs §5, which
  // carries an Agawam and a Springfield council on one shared county root). What IS
  // exercised live: the cascade lands on every ZIP of the county that owns the meetings,
  // and does NOT land on a ZIP of a different county.
  {
    const meetingTitles = (h) => {
      const sec = /<h2>Upcoming public meetings<\/h2>(?:<ul>([\s\S]*?)<\/ul>|<p)/.exec(h);
      return sec && sec[1]
        ? [...sec[1].matchAll(/<li>(?:<a[^>]*>)?([^<]+)/g)].map((m) => m[1].trim()) : [];
    };
    const a = meetingTitles((await get(`${SITE}/community/${C.meetings_same_a}/`)).body);
    const b = meetingTitles((await get(`${SITE}/community/${C.meetings_same_b}/`)).body);
    const o = meetingTitles((await get(`${SITE}/community/${C.meetings_other}/`)).body);
    console.log(`  [${C.meetings_same_a}] ${a.length} meetings: ${JSON.stringify(a.slice(0, 3))}`);
    console.log(`  [${C.meetings_same_b}] ${b.length} meetings: ${JSON.stringify(b.slice(0, 3))}`);
    console.log(`  [${C.meetings_other}]  ${o.length} meetings: ${JSON.stringify(o.slice(0, 3))}`);
    ok(a.length > 0 && a.length <= 12,
       `[${C.meetings_same_a}] meetings render and respect the shipped 12-item cap (${a.length})`);
    ok(JSON.stringify(a) === JSON.stringify(b),
       `two ZIPs in the SAME county receive the same cascaded meetings — the cascade works`);
    const shared = o.filter((t) => a.includes(t));
    ok(shared.length === 0,
       `a ZIP in a DIFFERENT county receives NONE of them (${shared.length} shared titles)`);
  }

  // ---- STEP 10: legacy URL + invalid ZIP --------------------------------------------------
  {
    const z = C.pass_dev_fail;
    const legacy = await get(`${SITE}/community.html?zip=${z}`);
    ok(legacy.status === 200, 'legacy community.html?zip= still returns HTTP 200');
    ok(/content="noindex, nofollow"/.test(legacy.body),
       'legacy community.html?zip= is noindex in its initial HTML — it cannot compete');
    ok(!/<link rel="canonical"/.test(legacy.body) || /\/community\//.test(legacy.body),
       'legacy page carries no competing self-canonical in its initial HTML');
    const canon = await get(`${SITE}/community/${z}/`);
    ok(canon.status === 200 && !canon.redirected,
       'the canonical path returns 200 DIRECTLY (not via a redirect from the legacy URL)');
    ok(seo(canon.body).canonical === `${SITE}/community/${z}/`, 'one canonical identity');

    const bad = await get(`${SITE}/community/00000/`);
    const bs = seo(bad.body);
    ok(bad.status === 404 || /noindex/.test(bs.robots || ''),
       `a non-canonical ZIP is never an indexable community page (status ${bad.status}, robots ${bs.robots})`);
  }

  // ---- STEP 11: sitemap -------------------------------------------------------------------
  {
    const sm = (await get(`${SITE}/sitemap.xml`)).body;
    const canonZips = [...sm.matchAll(/<loc>[^<]*\/community\/(\d{5})\/<\/loc>/g)].map((m) => m[1]);
    const legacyZips = [...sm.matchAll(/community\.html\?zip=(\d{5})/g)].map((m) => m[1]);
    const dev = [...sm.matchAll(/homesignalmap\.html\?zip=(\d{5})/g)].map((m) => m[1]);
    const dupes = canonZips.length - new Set(canonZips).size;
    const bad5 = canonZips.filter((z) => !/^\d{5}$/.test(z));
    console.log(`  sitemap: canonical community ${canonZips.length} · legacy ${legacyZips.length} · `
                + `development ${dev.length} · duplicates ${dupes} · malformed ${bad5.length}`);
    ok(legacyZips.length === 0, 'sitemap advertises ZERO legacy community.html?zip= URLs');
    ok(dupes === 0, 'sitemap has no duplicate canonical community URLs');
    ok(bad5.length === 0, 'sitemap has no malformed community URLs');
    ok(canonZips.includes(C.pass_dev_fail), 'a Rule-F-PASS control is advertised');
    ok(!canonZips.includes(C.fail_dev_pass), 'a Rule-F-FAIL control is NOT advertised');
    ok(dev.length > 0, 'the development sitemap population survives (page-purpose separation)');
    console.log(`SITEMAP_CANONICAL_COUNT=${canonZips.length}`);
  }

  // ---- STEP 12: no point / radius / address in any control's initial HTML ------------------
  {
    const LEAK = [/\d+(\.\d+)?\s*mi\b/, /distance_mi/, /data-home/, /centroid/i, /radius/i, /nearest/i];
    let leaks = 0;
    for (const [cls, r] of Object.entries(body)) {
      for (const re of LEAK) if (re.test(r.body)) { leaks++; console.error(`  leak ${cls} ${re}`); }
    }
    ok(leaks === 0, 'no distance / HOME / centroid / radius string in ANY control document');
  }

  // ---- STEP 7 + 13: hydration, and the map/address surface still works ---------------------
  const browser = await chromium.launch();
  for (const k of ['pass_dev_fail', 'fail_dev_pass', 'pass_dev_pass']) {
    const z = C[k];
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(String(e)));
    await page.goto(`${SITE}/community/${z}/`, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(5000);
    const after = await page.evaluate(() => ({
      robots: (document.querySelector('meta[name=robots]') || {}).content || null,
      canonical: (document.querySelector('link[rel=canonical]') || {}).href || null,
      title: document.title,
      h1: (document.querySelector('h1') || {}).textContent || '',
      ssrItems: document.querySelectorAll('#hs-ssr li').length,
      text: (document.body.innerText || ''),
      navLinks: document.querySelectorAll('a[href*="homesignalmap.html"]').length,
    }));
    const want = seo(body[k].body).robots;
    ok(after.robots === want, `[${z}] robots is STILL "${want}" after JavaScript`);
    ok((after.canonical || '').endsWith(`/community/${z}/`), `[${z}] canonical survives hydration`);
    ok(after.h1.includes(z) && after.title.includes(z), `[${z}] ZIP identity + title survive hydration`);
    ok(errs.length === 0, `[${z}] no uncaught page errors during hydration (${errs.slice(0, 1)})`);
    ok(after.navLinks > 0, `[${z}] the development-map link still works after hydration`);
    if (k !== 'fail_dev_pass') {
      const kept = after.ssrItems > 0;
      const reRendered = /Government & civic|Local news|Public meetings/i.test(after.text);
      ok(kept || reRendered,
         `[${z}] Alerts substance survives hydration (ssr items ${after.ssrItems}, re-rendered ${reRendered})`);
    }
    if (k === 'pass_dev_fail') {
      // the 529-class defect: an Alerts-PASS page whose data_quality is coverage_coming
      // renders coverage copy on hydration and MUST keep the build-time Alerts block.
      ok(after.ssrItems > 0,
         `[${z}] 529-class: the build-time Alerts block is KEPT after hydration (${after.ssrItems} items)`);
    }
    await ctx.close();
  }
  // map/address regression: the map page still loads and still runs its own client
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(String(e)));
    const r = await page.goto(`${SITE}/homesignalmap.html?zip=${C.point_dense}`,
      { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(7000);
    const map = await page.evaluate(() => ({
      leaflet: !!document.querySelector('#map .leaflet-container'),
      sites: (window.__HS_SITES || []).length,
      addrBox: !!document.querySelector('input[id*="addr"], input[placeholder*="address" i]'),
    }));
    ok(r.status() === 200, `[map ${C.point_dense}] homesignalmap.html?zip= returns 200`);
    ok(map.leaflet, `[map ${C.point_dense}] the Leaflet map still renders`);
    ok(map.sites > 0, `[map ${C.point_dense}] the map still loads real sites (${map.sites})`);
    ok(map.addrBox, `[map ${C.point_dense}] the address search box is still present`);
    ok(errs.length === 0, `[map ${C.point_dense}] no uncaught errors (${errs.slice(0, 1)})`);
    await ctx.close();
  }
  await browser.close();

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
};
main().catch((e) => { console.error(e); process.exit(1); });
