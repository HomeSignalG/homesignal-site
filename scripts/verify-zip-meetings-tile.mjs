// verify-zip-meetings-tile.mjs — open named ZIP pages in a real browser and read what the
// Government & civic group says about meetings. Built to confirm a county whose Upcoming
// Meetings feed was just armed actually shows them (CLAUDE.md "Verify in Supabase, not the live site"
// proves the rows; this proves the page). Read-only. No assertion about which meetings, only that the
// page's own count matches a real, non-zero number and the wording is honest (upcoming vs recent).
//
// Env: ZIPS (comma list, required), SITE_BASE (default https://jodytracks.com), MIN (default 1).
import { chromium } from 'playwright';
import { surfaceBanner } from './lib/surface-banner.mjs';

surfaceBanner('verify-zip-meetings-tile');

const SITE_BASE = (process.env.SITE_BASE || 'https://jodytracks.com').replace(/\/$/, '');
const ZIPS = (process.env.ZIPS || '').split(',').map((s) => s.trim()).filter(Boolean);
const MIN = parseInt(process.env.MIN || '1', 10);
if (!ZIPS.length || ZIPS.some((z) => !/^\d{5}$/.test(z))) { console.error('ZIPS must be 5-digit ZIPs, comma separated'); process.exit(2); }

const browser = await chromium.launch();
const rows = [];
for (const zip of ZIPS) {
  const page = await browser.newPage();
  let row = { zip, ok: false, why: '' };
  try {
    await page.goto(`${SITE_BASE}/community/${zip}/`, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForFunction(() => /Government\s*&\s*civic/i.test((document.getElementById('commPage') || {}).textContent || ''), { timeout: 45000 });
    const t = await page.evaluate(() => (document.getElementById('commPage').textContent || '').replace(/\s+/g, ' '));
    // lib/community-page.js writes: 'Government & civic — <n> <upcoming|recent> · <m> notices' (no word 'meetings').
    const m = t.match(/Government\s*&\s*civic\s*—\s*(\d+)\s+(upcoming|recent)\s*·/i);
    const tile = t.match(/(\d+)\s*(Public|Recent) meetings/i);
    const quiet = /No upcoming public meetings on file/i.test(t);
    if (!m) row.why = 'Government & civic meetings count not found';
    else {
      row = { zip, ok: Number(m[1]) >= MIN && !quiet, count: Number(m[1]), kind: m[2].toLowerCase(), tile: tile ? tile[0] : null, quiet };
      if (!row.ok) row.why = quiet ? 'page says no meetings on file' : `count ${m[1]} < ${MIN}`;
    }
  } catch (e) { row.why = String(e.message).split('\n')[0]; }
  rows.push(row);
  console.log(JSON.stringify(row));
  await page.close();
}
await browser.close();
const bad = rows.filter((r) => !r.ok);
const summary = `# Meetings tile\n\n- Site: ${SITE_BASE}\n- ZIPs: ${ZIPS.length} · showing meetings: **${rows.length - bad.length}** · not: **${bad.length}**\n\n` +
  rows.map((r) => `- ${r.ok ? '✓' : '✗'} ${r.zip}: ${r.ok ? `${r.count} ${r.kind} (${r.tile})` : r.why}`).join('\n') + '\n';
console.log('\n' + summary);
if (process.env.GITHUB_STEP_SUMMARY) (await import('node:fs')).appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
process.exit(bad.length ? 1 : 0);
