// verify-zip-meetings-card.mjs — open named ZIP pages on the live site in Chromium at desktop and
// phone widths and check the Government & civic meetings card shipped in #2840:
//   * it lists min(N, 6) meetings, N being the count in the group heading;
//   * each row has a date and its own meeting-record link (no two rows share a link);
//   * the Cancelled badge appears exactly on rows whose meeting the page's own data marks
//     is_cancelled (read from the page's /rest/v1/meetings responses, matched by record link);
//   * "<N-6> more upcoming|recent meetings" when N > 6, and no such line otherwise;
//   * the card's sentence makes no claim about agenda contents;
//   * no console error, page error, failed request or HTTP >= 400; no horizontal overflow.
// Read-only. Env: ZIPS (comma list, required), SITE_BASE (default https://jodytracks.com).
import { chromium, devices } from 'playwright';
import { surfaceBanner } from './lib/surface-banner.mjs';

surfaceBanner('verify-zip-meetings-card');

const SITE_BASE = (process.env.SITE_BASE || 'https://jodytracks.com').replace(/\/$/, '');
const ZIPS = (process.env.ZIPS || '').split(',').map((s) => s.trim()).filter(Boolean);
if (!ZIPS.length || ZIPS.some((z) => !/^\d{5}$/.test(z))) { console.error('ZIPS must be 5-digit ZIPs, comma separated'); process.exit(2); }
const MAX = 6;
const VIEWS = [['desktop', { viewport: { width: 1280, height: 900 } }], ['phone', { ...devices['iPhone 13'] }]];

const browser = await chromium.launch();
const lines = [];
let failed = 0;
for (const zip of ZIPS) {
  for (const [label, opts] of VIEWS) {
    const ctx = await browser.newContext(opts);
    const page = await ctx.newPage();
    const errs = [];
    const flags = new Map();   // source_url -> is_cancelled, from the page's own meetings reads
    page.on('response', async (r) => {
      if (!/\/rest\/v1\/meetings\b/.test(r.url()) || r.status() !== 200) return;
      try { const j = await r.json(); if (Array.isArray(j)) for (const m of j) if (m && m.source_url) flags.set(m.source_url, m.is_cancelled === true); } catch { /* not JSON */ }
    });
    page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 200)); });
    page.on('pageerror', (e) => errs.push('pageerror: ' + String(e).slice(0, 200)));
    page.on('requestfailed', (r) => errs.push('requestfailed: ' + r.url().slice(0, 160) + ' ' + ((r.failure() || {}).errorText || '')));
    page.on('response', (r) => { if (r.status() >= 400) errs.push('http ' + r.status() + ': ' + r.url().slice(0, 160)); });
    const problems = [];
    let r = null;
    try {
      await page.goto(`${SITE_BASE}/community/${zip}/`, { waitUntil: 'networkidle', timeout: 60000 });
      await page.waitForFunction(() => /Government\s*&\s*civic/i.test((document.getElementById('commPage') || {}).textContent || ''), { timeout: 45000 });
      await page.waitForTimeout(1500);
      r = await page.evaluate(() => {
        const head = [...document.querySelectorAll('.groupHead')].map((e) => e.textContent.replace(/\s+/g, ' ').trim()).find((t) => /Government\s*&\s*civic/i.test(t)) || '';
        const card = document.querySelector('[data-mtg-list]');
        const rows = card ? [...card.querySelectorAll('li.mtg-row')].map((li) => {
          const a = li.querySelector('a');
          return { text: li.textContent.replace(/\s+/g, ' ').trim(), title: a ? a.textContent.trim() : '', href: a ? a.href : null,
            badge: !!li.querySelector('.mtg-cancelled'), date: (li.querySelector('.quiet') || {}).textContent || '' };
        }) : [];
        const ps = card ? [...card.querySelectorAll('p')].map((p) => p.textContent.replace(/\s+/g, ' ').trim()) : [];
        return { head, hasCard: !!card, dataAttr: card ? card.getAttribute('data-mtg-list') : null, rows, ps,
          scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth };
      });
      const m = r.head.match(/—\s*(\d+)\s+(upcoming|recent)/i);
      const n = m ? Number(m[1]) : null, word = m ? m[2].toLowerCase() : '';
      if (n == null) problems.push('group heading count not found: ' + r.head);
      else if (n > 0) {
        if (!r.hasCard) problems.push('no meetings card');
        if (r.rows.length !== Math.min(n, MAX)) problems.push(`rows ${r.rows.length} != min(${n},${MAX})`);
        r.rows.forEach((row, i) => {
          if (!/\d{4}/.test(row.date)) problems.push(`row ${i + 1} has no date: ${row.text}`);
          if (!row.href || !/^https?:\/\//.test(row.href)) problems.push(`row ${i + 1} has no record link`);
          if (!flags.has(row.href)) problems.push(`row ${i + 1} link not found in the page's meetings data: ${row.href}`);
          else if (row.badge !== flags.get(row.href)) problems.push(`row ${i + 1} badge ${row.badge} but is_cancelled ${flags.get(row.href)}`);
        });
        const hrefs = r.rows.map((x) => x.href).filter(Boolean);
        if (new Set(hrefs).size !== hrefs.length) problems.push('two rows share a link');
        const more = r.ps.find((p) => /more (upcoming|recent) meeting/i.test(p));
        if (n > MAX) {
          const mm = more && more.match(/^(\d+) more (upcoming|recent)/i);
          if (!mm || Number(mm[1]) !== n - MAX || mm[2].toLowerCase() !== word) problems.push(`remainder line wrong: ${more || '(none)'} (expected ${n - MAX} more ${word})`);
        } else if (more) problems.push('remainder line shown with ' + n + ' meetings');
        if (r.ps.some((p) => /agenda/i.test(p))) problems.push('card sentence mentions agendas: ' + r.ps.join(' | '));
      }
      if (r.scrollW > r.innerW + 1) problems.push(`horizontal overflow ${r.scrollW} > ${r.innerW}`);
    } catch (e) { problems.push(String(e.message).split('\n')[0]); }
    problems.push(...errs);
    if (problems.length) failed++;
    const out = { zip, view: label, ok: !problems.length, meetings_read: flags.size, head: r && r.head, rows: r && r.rows, card_text: r && r.ps, scroll: r && `${r.scrollW}/${r.innerW}`, problems };
    console.log(JSON.stringify(out, null, 1));
    lines.push(`- ${problems.length ? '✗' : '✓'} ${zip} ${label}: ${r ? r.head : ''}${problems.length ? ' — ' + problems.join('; ') : ''}`);
    await ctx.close();
  }
}
await browser.close();
const summary = `# Meetings card\n\n- Site: ${SITE_BASE}\n\n${lines.join('\n')}\n`;
console.log('\n' + summary);
if (process.env.GITHUB_STEP_SUMMARY) (await import('node:fs')).appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
process.exit(failed ? 1 : 0);
