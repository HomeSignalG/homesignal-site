// Cross-state shell + populate spot-check (live site, GitHub runner).
//
// For each ZIP in $ZIPS (comma-separated), loads THREE page types on the real site —
// community.html, homesignalmap.html, and the app's development.html — and reports, as a
// markdown table: does the v13 left-sidebar shell render (present, at the left edge, nav
// populated), is the page non-blank, and which honest state it shows — populated /
// coverage-coming / not-covered / honest-empty — flagging anything broken or blank.
// development.html additionally flags the RETIRED empty-state claim ("We check county and
// permit records ... continuously") as BROKEN if it ever reappears live (PR #733 removed
// it; lib/coverage-copy.js is the replacement).
// Read-only; no assertions change the site. Exit 1 only if a page is BROKEN/blank.
//
//   ZIPS="84302,78617,94545" SITE_BASE=https://homesignal.net node scripts/spot-check-shell.mjs
import { appendFileSync } from 'node:fs';
import { chromium } from 'playwright';

const SITE_BASE = process.env.SITE_BASE || 'https://homesignal.net';
const ZIPS = (process.env.ZIPS || '').split(',').map(s => s.trim()).filter(Boolean);
if (!ZIPS.length) { console.error('Set ZIPS="12345,67890,..."'); process.exit(2); }
// SETTLE_MS — how long to let the shell inject and the data queries finish before reading
// state. DEFAULT 6500 = the historical hardcoded value, so every existing caller is
// byte-identical. It is configurable because 6.5 s cannot distinguish "the page errored"
// from "the page is still loading", and on the heaviest ZIPs that distinction is the whole
// question: community.html/maps.html block on a 1,000-row-windowed read of app_projects
// (~20 sequential round trips at 19.5k rows). A slow page and a broken page need different
// fixes, so the probe has to be able to wait longer than the impatience threshold.
const SETTLE_MS = process.env.SETTLE_MS ? parseInt(process.env.SETTLE_MS, 10) : 6500;

async function inspect(page, url) {
  const errors = [];
  const onErr = (e) => errors.push(String(e));
  page.on('pageerror', onErr);
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(SETTLE_MS); // let the shell inject + data queries settle (SETTLE_MS, default 6500)
    const st = await page.evaluate(() => {
      const side = document.querySelector('.side');
      const nav = document.querySelector('.side .nav a, .nav a');
      const r = side ? side.getBoundingClientRect() : null;
      const slot = document.getElementById('hs-slot');
      const text = (document.body.innerText || '').trim();
      return {
        shellPresent: !!side && !!nav,
        shellLeft: r ? (r.x < 60 && r.width > 100 && r.height > 200) : false,
        slotHasContent: !!(slot && slot.children.length && (slot.innerText || '').trim().length > 20),
        textLen: text.length,
        hasStrip: !!document.querySelector('.strip'),
        hasMap: !!document.querySelector('#map .leaflet-container, #map canvas'),
        sites: (window.__HS_SITES || []).length,
        coverage: /coverage[^.]*coming|being wired|feeds .*on the way/i.test(text),
        notCovered: /isn'?t covered yet|not tracking this ZIP/i.test(text),
        h1: (document.querySelector('h1') || {}).innerText || '',
        // development.html empty-state signals (inert on the other two page types):
        devCards: document.querySelectorAll('.devgrid > *').length,
        covBlock: /What's on this page, and what isn't/i.test(text),
        plainEmpty: /No permit or planning records for this area/i.test(text),
        retiredClaim: /We check county and permit records/i.test(text),
        // Distinguishes the HONEST ERROR path (maps.html throws 'incomplete
        // app_projects read' and renders a can't-load state) from a page that is
        // merely still loading. Without this, both read as 'unrecognized'.
        loadFail: /can.?t load right now|couldn.?t load|can.?t load/i.test(text),
        stillLoading: /loading|Loading/.test(text) && !/\.strip/.test(text),
        excerpt: text.slice(0, 180).replace(/\s+/g, ' '),
      };
    });
    page.off('pageerror', onErr);
    return { ...st, errors };
  } catch (e) {
    page.off('pageerror', onErr);
    return { failed: String(e).split('\n')[0], errors };
  }
}

function classifyComm(st) {
  if (st.failed || st.textLen < 40) return 'BROKEN/blank';
  if (st.hasStrip) return 'populated';
  if (st.coverage) return 'coverage-coming';
  if (st.notCovered) return 'not-covered';
  return 'BROKEN (unrecognized state)';
}
function classifyDev(st) {
  if (st.failed || st.textLen < 40) return 'BROKEN/blank';
  if (st.sites > 0) return `populated (${st.sites} sites)`;
  return st.hasMap || st.coverage ? 'empty (honest, map/coverage note)' : 'BROKEN (unrecognized state)';
}
function classifyDevApp(st) {
  if (st.failed || st.textLen < 40) return 'BROKEN/blank';
  // The retired claim reappearing is a regression even on a populated page.
  if (st.retiredClaim) return 'BROKEN (retired "we check continuously" claim is live)';
  if (st.devCards > 0) return `populated (${st.devCards} records)`;
  if (st.covBlock) return 'empty (honest coverage block)';
  if (st.plainEmpty) return 'empty (honest, plain fallback)';
  return 'BROKEN (unrecognized state)';
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const rows = [];
let broken = 0;

for (const zip of ZIPS) {
  const comm = await inspect(page, `${SITE_BASE}/community.html?zip=${zip}`);
  const dev = await inspect(page, `${SITE_BASE}/homesignalmap.html?zip=${zip}`);
  const app = await inspect(page, `${SITE_BASE}/development.html?zip=${zip}`);
  const shellOk = (s) => s.failed ? 'FAIL' : (s.shellPresent && s.shellLeft ? 'yes' : 'NO');
  const commClass = classifyComm(comm);
  const devClass = classifyDev(dev);
  const appClass = classifyDevApp(app);
  if (/BROKEN|FAIL/.test(commClass) || /BROKEN/.test(devClass) || /BROKEN/.test(appClass)
    || shellOk(comm) !== 'yes' || shellOk(dev) !== 'yes' || shellOk(app) !== 'yes') broken++;
  const jsErr = [...(comm.errors || []), ...(dev.errors || []), ...(app.errors || [])].filter(e => !/net::|Failed to fetch|Load failed/i.test(e));
  rows.push({ zip, commShell: shellOk(comm), commClass, devShell: shellOk(dev), devClass,
    appShell: shellOk(app), appClass, jsErr: jsErr.length ? jsErr[0].slice(0, 80) : '' });
  console.log(`${zip}: community[shell=${shellOk(comm)} ${commClass}] tracker[shell=${shellOk(dev)} ${devClass}] devapp[shell=${shellOk(app)} ${appClass}]${jsErr.length ? ' JSERR ' + jsErr[0].slice(0, 80) : ''}`);
  // DIAGNOSTIC: on any unrecognized state, say WHICH it is — an honest can't-load
  // error is a different defect from a page still mid-load at the settle deadline.
  for (const [name, st] of [['community', comm], ['tracker', dev], ['devapp', app]]) {
    const cls = name === 'community' ? commClass : name === 'tracker' ? devClass : appClass;
    if (/BROKEN/.test(cls)) {
      console.log(`    ${zip} ${name}: settle=${SETTLE_MS}ms loadFail=${!!st.loadFail} `
        + `stillLoading=${!!st.stillLoading} textLen=${st.textLen} :: ${st.excerpt || ''}`);
    }
  }
}
await browser.close();

const table = [
  '| ZIP | community shell | community state | tracker shell | tracker state | dev-app shell | dev-app state | JS errors |',
  '|---|---|---|---|---|---|---|---|',
  ...rows.map(r => `| ${r.zip} | ${r.commShell} | ${r.commClass} | ${r.devShell} | ${r.devClass} | ${r.appShell} | ${r.appClass} | ${r.jsErr} |`),
].join('\n');
console.log('\n' + table);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Shell + populate spot-check\n\n${table}\n`);
if (broken) { console.error(`\n${broken} page(s) broken/blank/missing shell`); process.exit(1); }
console.log('\nAll sampled pages render the shell and an honest state. ✓');
