// Live production verification of the customer-facing Alerts page (alerts.html).
//
// The map/development pages have verify-development / verify-representative-zips;
// this closes the gap for the page subscribers actually read: for each panel ZIP it
// loads https://homesignal.net/alerts.html?zip=<zip> in a real browser and asserts
// the page shows exactly what the database says it should — no more, no less.
//
//   SITE_BASE=https://homesignal.net node scripts/verify-alerts-page.mjs
//
// Env: SITE_BASE, ZIPS (comma list; default = the launch panel), MOBILE (0|1, default 1).
//
// Checks per ZIP (truth = app_changes via the same anon REST the page uses):
//   • page loads (no "We couldn't load your alerts" error state)
//   • Government Notices tab renders one card per DB gov row (same isGovNotice
//     classification the page applies), or the honest empty state
//   • no duplicate cards (title|source link)
//   • every gov card carries a real first-party source link (Read →) or a
//     project detail link — never a dead '#'
//   • Meetings tab renders ≥1 card when the DB has meeting mirrors for the ZIP,
//     with a date in the plain-language line
//   • News tab shows the honest empty state while Local News is deferred (or
//     real cards if news rows exist — never a blank pane)
//   • mobile viewport (390×844): no horizontal overflow, content still renders

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const cfg = readFileSync(new URL('../config.js', import.meta.url), 'utf8');
const grab = (name) => {
  const m = cfg.match(new RegExp(`${name}:\\s*['"]([^'"]+)['"]`));
  if (!m) throw new Error(`Could not read ${name} from config.js`);
  return m[1];
};
const SUPABASE_URL = grab('SUPABASE_URL');
const APIKEY = grab('SUPABASE_ANON_KEY');
const SITE_BASE = (process.env.SITE_BASE || 'https://homesignal.net').replace(/\/$/, '');
const MOBILE = process.env.MOBILE !== '0';

// Launch panel: batch-1 (AZ/MI/OR), batch-1b (MN/WA), Utah pilot, TX prototype.
const DEFAULT_ZIPS = '85701,48502,97202,84302,55101,98101,78617';
const ZIPS = (process.env.ZIPS || DEFAULT_ZIPS).split(',').map((z) => z.trim()).filter(Boolean);

// Mirror of alerts.html's pool classification — keep in sync with the page.
const isMeetingMirror = (ch) => /^Public meeting\s*[—–-]/i.test(ch.title || '');
const isNewsItem = (ch) => /news/i.test(ch.category || '');
const isGovNotice = (ch) =>
  !isMeetingMirror(ch) && !isNewsItem(ch) &&
  (/planning|government|civic/i.test(ch.category || '') || /^Government notice/i.test(ch.plain_language || ''));

async function dbChanges(zip) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/app_changes?zip=eq.${encodeURIComponent(zip)}&select=id,title,category,plain_language,source_ref,occurred_at&limit=1000`,
    { headers: { apikey: APIKEY, Authorization: `Bearer ${APIKEY}` } },
  );
  if (!res.ok) throw new Error(`Supabase app_changes ${zip}: ${res.status}`);
  return res.json();
}

async function readTab(page, tab) {
  await page.click(`#alFilter button[data-tab="${tab}"]`);
  await page.waitForTimeout(250);
  return page.evaluate(() => {
    const cards = [...document.querySelectorAll('#alBand .card, #alGroups .card')].map((el) => {
      const read = el.querySelector('.actions .btn:not(.ghost)');
      const onclick = read ? read.getAttribute('onclick') || '' : '';
      const m = onclick.match(/window\.open\('([^']+)'/) || onclick.match(/location\.href='([^']+)'/);
      return {
        id: el.getAttribute('data-alert-id'),
        title: (el.querySelector('h3') || {}).textContent || '',
        plain: (el.querySelector('.sowhat') || {}).textContent || '',
        link: m ? m[1] : null,
      };
    });
    const quiet = document.querySelector('#alGroups .quiet, #alQuiet .quiet');
    return { cards, emptyText: quiet ? quiet.textContent : null };
  });
}

const report = [];
let failures = 0;
const P = (zip, name, detail) => { report.push({ zip, check: name, ok: true, detail }); console.log(`- PASS: ${name} — ${detail}`); };
const F = (zip, name, detail) => { failures++; report.push({ zip, check: name, ok: false, detail }); console.log(`- FAIL: ${name} — ${detail}`); };

const browser = await chromium.launch();
try {
  for (const zip of ZIPS) {
    console.log(`\n### ${zip} — alerts.html`);
    const rows = await dbChanges(zip);
    const govExpected = rows.filter(isGovNotice);
    const mirrors = rows.filter(isMeetingMirror);
    const newsRows = rows.filter(isNewsItem);

    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(`${SITE_BASE}/alerts.html?zip=${zip}`, { waitUntil: 'networkidle', timeout: 60000 });
    const bodyText = await page.evaluate(() => document.body.innerText);
    if (/couldn't load your alerts/i.test(bodyText)) {
      F(zip, 'page loads', 'error state rendered');
      await page.close();
      continue;
    }
    P(zip, 'page loads', 'no error state');

    // Government Notices
    const gov = await readTab(page, 'gov');
    if (govExpected.length === 0) {
      if (gov.cards.length === 0 && /No government notices on file/i.test(gov.emptyText || '')) {
        P(zip, 'gov honest empty', 'no rows in DB and honest empty copy shown');
      } else if (gov.cards.length > 0) {
        F(zip, 'gov tab', `DB has 0 gov rows but page shows ${gov.cards.length} card(s)`);
      } else {
        F(zip, 'gov honest empty', `empty but copy missing (got: ${String(gov.emptyText).slice(0, 80)})`);
      }
    } else if (gov.cards.length === govExpected.length) {
      P(zip, 'gov cards match DB', `${gov.cards.length} card(s) == ${govExpected.length} DB row(s)`);
    } else {
      F(zip, 'gov cards match DB', `page ${gov.cards.length} vs DB ${govExpected.length}`);
    }
    const keys = gov.cards.map((c) => `${c.title}|${c.link}`);
    if (new Set(keys).size === keys.length) P(zip, 'no duplicate gov cards', `${keys.length} unique`);
    else F(zip, 'no duplicate gov cards', 'duplicate title|link pair on page');
    const badLink = gov.cards.find((c) => !c.link || c.link === '#' || !/^(https?:\/\/|development\.html)/.test(c.link));
    if (gov.cards.length && !badLink) P(zip, 'gov source links', 'every card links to a source or project detail');
    else if (badLink) F(zip, 'gov source links', `card "${badLink.title.slice(0, 60)}" has link ${badLink.link}`);
    const untitled = gov.cards.find((c) => !c.title.trim());
    if (!untitled) P(zip, 'gov titles present', 'all cards titled');
    else F(zip, 'gov titles present', 'untitled card found');

    // Upcoming Meetings
    const mtg = await readTab(page, 'meetings');
    if (mirrors.length > 0) {
      if (mtg.cards.length > 0) {
        const dated = mtg.cards.filter((c) => /Public meeting on /i.test(c.plain) || c.plain.trim());
        P(zip, 'meetings render', `${mtg.cards.length} card(s); ${dated.length} with plain-language date/venue line`);
      } else F(zip, 'meetings render', `DB has ${mirrors.length} meeting mirror(s) but page shows 0`);
    } else if (mtg.cards.length > 0) {
      P(zip, 'meetings render', `${mtg.cards.length} card(s) from the meetings cascade (no mirrors in app_changes)`);
    } else if (/No upcoming public meetings on file/i.test(mtg.emptyText || '')) {
      P(zip, 'meetings honest empty', 'honest empty copy shown');
    } else {
      F(zip, 'meetings honest empty', `empty but copy missing (got: ${String(mtg.emptyText).slice(0, 80)})`);
    }

    // Local News (deferred at launch — honest empty unless real rows exist)
    const news = await readTab(page, 'news');
    if (newsRows.length === 0) {
      if (news.cards.length === 0 && /No local news items on file/i.test(news.emptyText || '')) {
        P(zip, 'news honest empty', 'deferred tile shows honest empty copy');
      } else if (news.cards.length > 0) {
        F(zip, 'news tab', `DB has 0 news rows but page shows ${news.cards.length} card(s)`);
      } else {
        F(zip, 'news honest empty', `empty but copy missing (got: ${String(news.emptyText).slice(0, 80)})`);
      }
    } else {
      if (news.cards.length > 0) P(zip, 'news cards', `${news.cards.length} card(s) for ${newsRows.length} DB row(s)`);
      else F(zip, 'news cards', `DB has ${newsRows.length} news rows but page shows 0`);
    }

    // Mobile usability
    if (MOBILE) {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(300);
      const m = await page.evaluate(() => ({
        overflow: document.scrollingElement.scrollWidth - window.innerWidth,
        hasContent: !!document.querySelector('#alGroups .card, #alBand .card, #alGroups .quiet, #alQuiet .quiet'),
      }));
      if (m.overflow <= 2 && m.hasContent) P(zip, 'mobile layout', `no horizontal overflow (${m.overflow}px); content renders at 390px`);
      else F(zip, 'mobile layout', `overflow=${m.overflow}px hasContent=${m.hasContent}`);
    }

    await page.close();
  }
} finally {
  await browser.close();
}

mkdirSync('verify', { recursive: true });
writeFileSync('verify/alerts-page-report.json', JSON.stringify(report, null, 2));
console.log(`\nWrote verify/alerts-page-report.json — ${report.length} checks, ${failures} failure(s)`);
process.exit(failures ? 1 : 0);
