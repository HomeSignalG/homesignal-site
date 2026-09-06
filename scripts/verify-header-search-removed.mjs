// TEMPORARY, read-only live verification of PR #1097 (header universal search removed).
// Loads two production pages in a real browser and asserts the search UI is gone, the
// header order is intact, the served shell.js carries the new content key, and Map 1's
// own address field + Data center type filter still work. Makes no writes of any kind.
import { chromium } from 'playwright';

const BASE = process.env.SITE_BASE || 'https://homesignal.net';
const fails = [];
const notes = [];
const ok = (m) => notes.push('PASS  ' + m);
const bad = (m) => { fails.push(m); notes.push('FAIL  ' + m); };

const browser = await chromium.launch();

async function fresh(url) {
  // A brand-new context every time = no service worker, no HTTP cache carried over.
  const ctx = await browser.newContext({ bypassCSP: false });
  const page = await ctx.newPage();
  const shellReqs = [];
  const pageErrors = [];
  page.on('request', (r) => { const u = r.url(); if (u.includes('shell.js')) shellReqs.push(u); });
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(6000);
  return { ctx, page, shellReqs, pageErrors, status: resp && resp.status() };
}

async function headerChecks(page, label) {
  const found = await page.evaluate(() => {
    const ids = ['hs-search', 'hs-search-btn', 'hs-searchwrap', 'hs-search-results', 'hs-searchpanel'];
    const present = ids.filter((i) => !!document.getElementById(i));
    const top = document.getElementById('hs-top');
    if (!top) return { present, noTop: true };
    const vis = (el) => !!(el.offsetParent || el.getClientRects().length);
    // Any visible control in the top bar that reads as a search affordance.
    const searchy = Array.from(top.querySelectorAll('button,a,input,[role=button]')).filter((el) => {
      const t = (el.textContent || '').trim();
      const ph = (el.getAttribute('placeholder') || '') + ' ' + (el.getAttribute('aria-label') || '');
      return vis(el) && (/search/i.test(t) || /search/i.test(ph));
    }).map((el) => el.tagName + '#' + (el.id || '-') + ':' + (el.textContent || '').trim().slice(0, 24));
    // Direct children of the top bar, in document order, with a stable signature each.
    const sig = (el) => {
      if (el.id) return '#' + el.id;
      const c = (el.getAttribute('class') || '').trim().split(/\s+/)[0];
      const al = el.getAttribute('aria-label');
      const t = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 18);
      return (c ? '.' + c : el.tagName.toLowerCase()) + (al ? '[' + al + ']' : t ? '(' + t + ')' : '');
    };
    const children = Array.from(top.children).map((el) => ({ sig: sig(el), visible: vis(el) }));
    return { present, searchy, children, noTop: false };
  });

  if (found.noTop) { bad(`${label}: #hs-top not found`); return found; }

  if (found.present.length === 0) ok(`${label}: none of #hs-search / #hs-search-btn / #hs-searchwrap / #hs-search-results / #hs-searchpanel exist`);
  else bad(`${label}: search element ids still present -> ${found.present.join(', ')}`);

  if (found.searchy.length === 0) ok(`${label}: no visible search-like control anywhere in the top bar`);
  else bad(`${label}: visible search-like control(s) -> ${found.searchy.join(' | ')}`);

  const line = found.children.map((c) => c.sig + (c.visible ? '' : ' (hidden)')).join(' > ');
  notes.push(`      ${label} #hs-top children: ${line}`);

  // Order assertion: the four named landmarks must appear, in this relative order,
  // with nothing search-shaped between them.
  const sigs = found.children.map((c) => c.sig);
  const idxLoc = sigs.findIndex((s) => /^\.loc/.test(s));
  const idxShare = sigs.findIndex((s) => /Share/.test(s));
  const idxBell = sigs.findIndex((s) => /\[Notifications\]/.test(s));
  const idxAuth = sigs.findIndex((s) => s === '#hs-signin');
  const idxAvatar = sigs.findIndex((s) => s === '#hs-avatar');
  const idxIdentity = idxAuth >= 0 ? idxAuth : idxAvatar;
  const seq = [idxLoc, idxShare, idxBell, idxIdentity];
  if (seq.some((i) => i < 0)) bad(`${label}: a header landmark is missing (loc=${idxLoc} share=${idxShare} bell=${idxBell} identity=${idxIdentity})`);
  else if (idxLoc < idxShare && idxShare < idxBell && idxBell < idxIdentity && idxIdentity <= idxAvatar)
    ok(`${label}: header order is location -> Share -> Notifications -> Sign in/avatar`);
  else bad(`${label}: header order wrong -> ${line}`);
  return found;
}

// ---- Page 1: Map 1 -------------------------------------------------------
{
  const url = `${BASE}/homesignalmap.html?zip=78617`;
  const { ctx, page, shellReqs, pageErrors, status } = await fresh(url);
  notes.push(`\n=== ${url}  (HTTP ${status}) ===`);
  await headerChecks(page, 'maps');

  const keys = shellReqs.map((u) => (u.match(/shell\.js\?v=([a-z0-9]+)/) || [])[1] || '(none)');
  if (keys.includes('d6e6818c')) ok(`maps: served shell.js key = d6e6818c`);
  else bad(`maps: shell.js key not d6e6818c -> ${JSON.stringify(shellReqs)}`);

  // The page's own address field must still exist and be usable.
  const addr = await page.evaluate(() => {
    const i = document.getElementById('addr');
    const b = document.getElementById('go');
    const l = document.querySelector('label.search-label');
    return i ? {
      placeholder: i.placeholder, disabled: i.disabled,
      label: l ? l.textContent.trim() : null,
      cta: b ? b.textContent.trim() : null
    } : null;
  });
  if (addr && addr.placeholder === 'Start typing an address' && !addr.disabled) ok(`maps: address field present and enabled (label "${addr.label}", CTA "${addr.cta}")`);
  else bad(`maps: address field wrong or missing -> ${JSON.stringify(addr)}`);

  // Data center type filter still present and togglable.
  const dc = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('button,[role=button],label'));
    const el = els.find((e) => /data\s*cent(er|re)/i.test((e.textContent || '').trim()));
    if (!el) return null;
    const before = el.getAttribute('aria-pressed');
    el.click();
    const after = el.getAttribute('aria-pressed');
    el.click();
    return { text: (el.textContent || '').trim().slice(0, 40), before, after, restored: el.getAttribute('aria-pressed') };
  });
  if (dc && dc.before !== dc.after) ok(`maps: Data center type filter toggles (${dc.before} -> ${dc.after}, restored ${dc.restored})`);
  else if (dc) bad(`maps: Data center chip found but aria-pressed did not change -> ${JSON.stringify(dc)}`);
  else bad('maps: no Data center type control found');

  const sites = await page.evaluate(() => (Array.isArray(window.__HS_SITES) ? window.__HS_SITES.length : null));
  notes.push(`      maps: window.__HS_SITES length = ${sites}`);
  if (pageErrors.length) bad(`maps: uncaught page errors -> ${pageErrors.slice(0, 3).join(' | ')}`);
  else ok('maps: 0 uncaught page errors');

  await page.screenshot({ path: 'receipt-maps-header.png', clip: { x: 0, y: 0, width: 1280, height: 220 } });
  await ctx.close();
}

// ---- Page 2: Community (non-Maps) ---------------------------------------
{
  const url = `${BASE}/community.html?zip=78617`;
  const { ctx, page, shellReqs, pageErrors, status } = await fresh(url);
  notes.push(`\n=== ${url}  (HTTP ${status}) ===`);
  await headerChecks(page, 'community');
  const keys = shellReqs.map((u) => (u.match(/shell\.js\?v=([a-z0-9]+)/) || [])[1] || '(none)');
  if (keys.includes('d6e6818c')) ok(`community: served shell.js key = d6e6818c`);
  else bad(`community: shell.js key not d6e6818c -> ${JSON.stringify(shellReqs)}`);
  if (pageErrors.length) bad(`community: uncaught page errors -> ${pageErrors.slice(0, 3).join(' | ')}`);
  else ok('community: 0 uncaught page errors');
  await page.screenshot({ path: 'receipt-community-header.png', clip: { x: 0, y: 0, width: 1280, height: 220 } });
  await ctx.close();
}

await browser.close();
console.log(notes.join('\n'));
console.log('\n---------------------------------------------');
console.log(fails.length ? `${fails.length} FAILURE(S)` : 'ALL CHECKS PASS');
process.exit(fails.length ? 1 : 0);
