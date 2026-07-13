// Cross-state shell + populate spot-check (live site, GitHub runner).
//
// For each ZIP in $ZIPS (comma-separated), loads BOTH page types on the real site and
// reports, as a markdown table: does the v13 left-sidebar shell render (present, at the
// left edge, nav populated), is the page non-blank, and which honest state it shows —
// populated / coverage-coming / not-covered — flagging anything broken or blank.
// Read-only; no assertions change the site. Exit 1 only if a page is BROKEN/blank.
//
//   ZIPS="84302,78617,94545" SITE_BASE=https://homesignal.net node scripts/spot-check-shell.mjs
import { appendFileSync } from 'node:fs';
import { chromium } from 'playwright';

const SITE_BASE = process.env.SITE_BASE || 'https://homesignal.net';
const ZIPS = (process.env.ZIPS || '').split(',').map(s => s.trim()).filter(Boolean);
if (!ZIPS.length) { console.error('Set ZIPS="12345,67890,..."'); process.exit(2); }

async function inspect(page, url) {
  const errors = [];
  const onErr = (e) => errors.push(String(e));
  page.on('pageerror', onErr);
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(6500); // let the shell inject + data queries settle
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

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const rows = [];
let broken = 0;

for (const zip of ZIPS) {
  const comm = await inspect(page, `${SITE_BASE}/community.html?zip=${zip}`);
  const dev = await inspect(page, `${SITE_BASE}/homesignalmap.html?zip=${zip}`);
  const shellOk = (s) => s.failed ? 'FAIL' : (s.shellPresent && s.shellLeft ? 'yes' : 'NO');
  const commClass = classifyComm(comm);
  const devClass = classifyDev(dev);
  if (/BROKEN|FAIL/.test(commClass) || /BROKEN/.test(devClass) || shellOk(comm) !== 'yes' || shellOk(dev) !== 'yes') broken++;
  const jsErr = [...(comm.errors || []), ...(dev.errors || [])].filter(e => !/net::|Failed to fetch|Load failed/i.test(e));
  rows.push({ zip, commShell: shellOk(comm), commClass, devShell: shellOk(dev), devClass,
    jsErr: jsErr.length ? jsErr[0].slice(0, 80) : '' });
  console.log(`${zip}: community[shell=${shellOk(comm)} ${commClass}] tracker[shell=${shellOk(dev)} ${devClass}]${jsErr.length ? ' JSERR ' + jsErr[0].slice(0, 80) : ''}`);
}
await browser.close();

const table = [
  '| ZIP | community shell | community state | tracker shell | tracker state | JS errors |',
  '|---|---|---|---|---|---|',
  ...rows.map(r => `| ${r.zip} | ${r.commShell} | ${r.commClass} | ${r.devShell} | ${r.devClass} | ${r.jsErr} |`),
].join('\n');
console.log('\n' + table);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Shell + populate spot-check\n\n${table}\n`);
if (broken) { console.error(`\n${broken} page(s) broken/blank/missing shell`); process.exit(1); }
console.log('\nAll sampled pages render the shell and an honest state. ✓');
