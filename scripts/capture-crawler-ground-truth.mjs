// CRAWLER GROUND TRUTH — read-only capture for the Alerts SEO-readiness program.
//
// Answers ONE question that cannot be answered from source: for a real production ZIP
// page, what does a crawler receive in the INITIAL HTTP RESPONSE, and how does that
// differ from the DOM after JavaScript runs?
//
// Read-only. It fetches public URLs and renders them. It writes nothing anywhere.
//
// Why this exists rather than reusing verify-communities.mjs: that verifier walks a whole
// county (or the whole table) and asserts a policy. This captures an explicit, frozen
// control list and REPORTS, with no pass/fail opinion — the control ZIPs were chosen from
// the committed readiness matrix BEFORE any fetch, so the instrument must not select them.
import { chromium } from 'playwright';

const SITE = (process.env.SITE_BASE || 'https://homesignal.net').replace(/\/$/, '');
const ZIPS = (process.env.ZIPS || '01001,01034,01002,02543,07010,75001').split(',').map(s => s.trim()).filter(Boolean);

const UA_GBOT_MOBILE = 'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/W.X.Y.Z Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';
const UA_GBOT_DESKTOP = 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Googlebot/2.1; +http://www.google.com/bot.html) Chrome/W.X.Y.Z Safari/537.36';

const md5 = async (s) => {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].slice(0, 8).map(b => b.toString(16).padStart(2, '0')).join('');
};

// Strip <script>/<style> then tags, and collapse whitespace: what a text-only consumer reads.
const visibleText = (html) => html
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/\s+/g, ' ').trim();

const pick = (html, re) => { const m = re.exec(html); return m ? m[1].trim() : null; };

async function initial(url, ua) {
  const res = await fetch(url, { headers: ua ? { 'User-Agent': ua } : {}, redirect: 'follow' });
  const html = await res.text();
  const txt = visibleText(html);
  return {
    status: res.status,
    finalUrl: res.url,
    redirected: res.redirected,
    xRobotsTag: res.headers.get('x-robots-tag'),
    bytes: html.length,
    bodyHash: await md5(html),
    robots: pick(html, /<meta\s+name=["']robots["'][^>]*content=["']([^"']+)["']/i),
    title: pick(html, /<title>([\s\S]*?)<\/title>/i),
    description: pick(html, /<meta\s+name=["']description["'][^>]*content=["']([^"']*)["']/i),
    canonical: pick(html, /<link\s+rel=["']canonical["'][^>]*href=["']([^"']+)["']/i),
    h1: pick(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i),
    jsonLd: /application\/ld\+json/i.test(html),
    hasTemplate: /<template id="hs-content">/.test(html),
    templateInner: pick(html, /<template id="hs-content">([\s\S]*?)<\/template>/i),
    visibleTextLen: txt.length,
    visibleTextSample: txt.slice(0, 200),
  };
}

async function rendered(browser, url, ua) {
  const ctx = await browser.newContext(ua ? { userAgent: ua } : {});
  const page = await ctx.newPage();
  let out;
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    // Readiness: the page runtime fills #commPage. Not fatal if it stays empty — an empty
    // render is itself a finding, so a timeout here is REPORTED, never thrown away.
    await page.waitForFunction(() => {
      const p = document.getElementById('commPage');
      return !!(p && p.textContent && p.textContent.trim().length > 0);
    }, { timeout: 30000 }).catch(() => {});
    out = await page.evaluate(() => {
      const rm = document.getElementById('robots-meta');
      const p = document.getElementById('commPage');
      const txt = (p && p.textContent) ? p.textContent.replace(/\s+/g, ' ').trim() : '';
      const heads = [...document.querySelectorAll('.groupHead')].map(e => e.textContent.replace(/\s+/g, ' ').trim());
      const canon = document.querySelector('link[rel=canonical]');
      return {
        robots: rm ? rm.getAttribute('content') : null,
        title: document.title,
        canonical: canon ? canon.getAttribute('href') : null,
        h1: (document.querySelector('#commPage h1') || {}).textContent || null,
        jsonLd: !!document.querySelector('script[type="application/ld+json"]'),
        groupHeads: heads,
        localNews: document.querySelectorAll('[data-tile="news"] .card, .newsCard').length,
        renderedTextLen: txt.length,
        renderedTextSample: txt.slice(0, 300),
      };
    });
  } catch (e) {
    out = { error: String(e && e.message || e) };
  }
  await ctx.close();
  return out;
}

const main = async () => {
  const browser = await chromium.launch();
  const report = [];
  for (const zip of ZIPS) {
    const url = `${SITE}/community.html?zip=${zip}`;
    const row = { zip, url };
    row.initial_normal = await initial(url, null);
    row.initial_gbot_mobile = await initial(url, UA_GBOT_MOBILE);
    row.initial_gbot_desktop = await initial(url, UA_GBOT_DESKTOP);
    row.rendered_normal = await rendered(browser, url, null);
    row.rendered_gbot_mobile = await rendered(browser, url, UA_GBOT_MOBILE);
    report.push(row);
    console.log(`\n=== ZIP ${zip} ===`);
    console.log('  INITIAL   status=%s bytes=%s hash=%s robots=%j canonical=%j jsonld=%s visibleText=%s',
      row.initial_normal.status, row.initial_normal.bytes, row.initial_normal.bodyHash,
      row.initial_normal.robots, row.initial_normal.canonical, row.initial_normal.jsonLd,
      row.initial_normal.visibleTextLen);
    console.log('  INITIAL   title=%j h1=%j templateInner=%j', row.initial_normal.title,
      row.initial_normal.h1, row.initial_normal.templateInner);
    console.log('  GBOT-MOB  hash=%s  identical_to_normal=%s',
      row.initial_gbot_mobile.bodyHash, row.initial_gbot_mobile.bodyHash === row.initial_normal.bodyHash);
    console.log('  GBOT-DESK hash=%s  identical_to_normal=%s',
      row.initial_gbot_desktop.bodyHash, row.initial_gbot_desktop.bodyHash === row.initial_normal.bodyHash);
    console.log('  RENDERED  robots=%j title=%j renderedText=%s jsonld=%s',
      row.rendered_normal.robots, row.rendered_normal.title,
      row.rendered_normal.renderedTextLen, row.rendered_normal.jsonLd);
    console.log('  RENDERED  h1=%j', row.rendered_normal.h1);
    console.log('  RENDERED  groupHeads=%j', row.rendered_normal.groupHeads);
    console.log('  RENDERED  sample=%j', row.rendered_normal.renderedTextSample);
    console.log('  RENDERED(gbot-mobile) robots=%j textLen=%s',
      row.rendered_gbot_mobile.robots, row.rendered_gbot_mobile.renderedTextLen);
  }
  await browser.close();
  console.log('\n=== RAW JSON ===');
  console.log(JSON.stringify(report, null, 1));
};
main().catch(e => { console.error(e); process.exit(1); });
