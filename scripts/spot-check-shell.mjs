// SCRATCH — read-only live probe for the Environment P0 controls. Lives ONLY on the
// never-merge diagnostic branch claude/env-utilities-adhoc; dispatched through the existing
// spot-check.yml (which runs this path from the dispatched ref). Writes nothing.
import { chromium } from 'playwright';
const BASE = process.env.SITE_BASE || 'https://homesignal.net';
const ZIPS = (process.env.ZIPS || '').split(',').map(s => s.trim()).filter(Boolean);
const SETTLE = Number(process.env.SETTLE_MS || 4000);
// Control records, verbatim production titles/names (from db-sql probes on this branch).
const NEEDLES = [
  'Public Meeting and Public Hearing',                                   // Bear River WCD notice (Water districts & utilities)
  'Baltimore to begin blending river water with reservoir supply amid drought', // environmental Local News
  'HP HOOD LLC - AGAWAM PLANT',                                          // EPA/ECHO facility, 01001
  'Storm Sewer Repair or Replacement Roosevelt Avenue',                  // utility-sounding Development, 46205
];
const browser = await chromium.launch();
const out = [];
for (const zip of ZIPS) {
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e).slice(0, 160)));
  const url = BASE + '/community/' + zip + '/?cb=' + Date.now();
  let status = null;
  try { const r = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }); status = r && r.status(); } catch (e) { errs.push('goto ' + e.message.slice(0, 120)); }
  await page.waitForFunction(() => /Government\s*&\s*civic/.test((document.getElementById('commPage') || {}).textContent || ''), null, { timeout: 60000 }).catch(() => errs.push('commPage sections never rendered'));
  await page.waitForTimeout(SETTLE);
  const r = await page.evaluate((needles) => {
    const el = document.getElementById('commPage');
    const t = el ? el.textContent : '';
    const heads = el ? [].slice.call(el.querySelectorAll('.groupHead')).map(h => h.textContent.replace(/\s+/g, ' ').trim()) : [];
    const cnt = (n) => t.split(n).length - 1;
    return {
      runtime: ([].slice.call(document.querySelectorAll('script[src]')).map(s => s.getAttribute('src')).find(s => /community-page\.js/.test(s)) || null),
      heads,
      envHeading: /environment\s*(&|and)\s*utilit/i.test(t),
      envAbsenceSentence: /no environment or utility notices on file/i.test(t),
      needles: Object.fromEntries(needles.map(n => [n.slice(0, 40), cnt(n)])),
    };
  }, NEEDLES);
  out.push({ zip, status, errs, ...r });
  console.log('RESULT ' + JSON.stringify({ zip, status, errs, ...r }));
  await page.close();
}
await browser.close();
