// verify-facility-entity.mjs — live browser check of the regulated-facilities-entity build
// (PR #265) on the deployed site. Runs on a GitHub runner (the sandbox has no egress).
//
// Observes, against the live DB's own expectations for the pilot ZIP (78617):
//   1. maps.html renders the "Regulated facilities · nearby" sidebar section with one row
//      per app_projects facility row (closest-first list).
//   2. A purple facility marker/pin routes into the HomeSignal dossier
//      (development.html?id=…), NEVER to echo.epa.gov (no echo link anywhere on maps.html).
//   3. The DALFEN dossier renders the Terminated interpretation + the tracking-off caveat,
//      and never presents the zero counts as a clean record.
//   4. Facilities without a confirmed permit status say "Permit status not yet confirmed"
//      — an explicit state, not a blank and not a guessed status.
//
// Read-only. Prints OBSERVED lines for the human report; exits 1 on any failed assertion.
import { chromium } from 'playwright';

const SITE = process.env.SITE_BASE || 'https://homesignal.net';
const SB = 'https://qwnnmljucajnexpxdgxr.supabase.co';
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF3bm5tbGp1Y2FqbmV4cHhkZ3hyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA0MTAyOTgsImV4cCI6MjA5NTk4NjI5OH0.prpXB6lSIhWMAsdkkaxAfkvEodbojfUUyN4L4JbQE1U';
const ZIP = process.env.ZIP || '78617';
const KNOWN = ['Effective', 'Admin Continued', 'Administratively Continued', 'Expired', 'Pending', 'Not Needed', 'Retired', 'Terminated'];

let failures = 0;
const ok = (cond, label, observed) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}\n      observed: ${observed}`);
  if (!cond) failures++;
};

// ── Ground truth from the live DB (what the page is supposed to show) ──
const rows = await (await fetch(
  `${SB}/rest/v1/app_projects?zip=eq.${ZIP}&record_kind=eq.facility&select=id,name,registry_id,facility_env&order=name.asc`,
  { headers: { apikey: ANON, Authorization: `Bearer ${ANON}` } })).json();
const confirmed = rows.filter(r => KNOWN.includes(r.facility_env?.epa?.permit_status));
const unconfirmed = rows.filter(r => !KNOWN.includes(r.facility_env?.epa?.permit_status));
const dalfen = rows.find(r => r.registry_id === '110071346495');
console.log(`DB ground truth for ${ZIP}: ${rows.length} facility rows, ${confirmed.length} with confirmed permit status, ${unconfirmed.length} unconfirmed. DALFEN id=${dalfen?.id}, status=${dalfen?.facility_env?.epa?.permit_status}`);

const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();

// ── 1 + 2 (sidebar + pins) on maps.html ──
await page.goto(`${SITE}/maps.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('#pinList .groupHead', { timeout: 60000 });
await page.waitForTimeout(4000);   // marker layers attach after the map engine settles

const heads = await page.$$eval('#pinList .groupHead', els => els.map(e => e.textContent.trim()));
ok(heads.some(h => h.startsWith('Regulated facilities')), '1. sidebar section header renders', JSON.stringify(heads));

const facCards = await page.$$eval('#pinList [data-fac]', els => els.map(e => ({
  lens: e.querySelector('.lens')?.textContent.trim(), name: e.querySelector('h3')?.textContent.trim(),
  sowhat: e.querySelector('.sowhat')?.textContent.trim() })));
ok(facCards.length === rows.length, `1. one sidebar row per DB facility row (expect ${rows.length})`,
  `${facCards.length} rows; first: ${JSON.stringify(facCards[0])}`);

const notYet = facCards.filter(c => /permit status not yet confirmed/i.test(c.sowhat || ''));
const blankRows = facCards.filter(c => !(c.sowhat || '').trim());
ok(notYet.length === unconfirmed.length && blankRows.length === 0,
  `4. unconfirmed facilities say "Permit status not yet confirmed" (expect ${unconfirmed.length}, no blanks)`,
  `${notYet.length} "not yet confirmed" rows, ${blankRows.length} blank rows; sample: "${notYet[0]?.sowhat}"`);

const echoLinks = await page.$$eval('a', as => as.filter(a => (a.href || '').includes('echo.epa.gov')).length);
ok(echoLinks === 0, '2. no echo.epa.gov link anywhere in the maps.html DOM', `${echoLinks} echo links`);

// Purple pin click opens the in-map sidebar (never a popup or dossier redirect).
const pin = await page.evaluateHandle(() => {
  const divs = [...document.querySelectorAll('#mapgl div, #maplf div')]
    .filter(d => (d.style.background || '').includes('rgb(111, 66, 193)') || d.querySelector('svg rect'));
  return divs[0] || document.querySelector('#mapSch svg rect') || null;
});
let pinObserved = 'no purple marker element found';
let pinOk = false;
if (await pin.evaluate(el => !!el)) {
  await pin.asElement().click();
  await page.waitForTimeout(1500);
  const panel = await page.evaluate(() => ({
    open: document.getElementById('infoSlide').classList.contains('open'),
    detail: !!document.querySelector('#infoPanel.idetail'),
    popup: !!document.querySelector('.maplibregl-popup, .leaflet-popup'),
    body: (document.getElementById('infoPanel') || {}).textContent || ''
  }));
  pinOk = panel.open && panel.detail && !panel.popup;
  pinObserved = JSON.stringify(panel);
}
ok(pinOk, '2. purple pin opens facility detail in the sidebar (no popup/redirect)', pinObserved);

// Sidebar row click opens the same panel (no page navigation).
const beforeUrl = page.url();
await page.click('#pinList [data-fac]');
await page.waitForTimeout(800);
const facPanel = await page.evaluate(() => ({
  open: document.getElementById('infoSlide').classList.contains('open'),
  detail: !!document.querySelector('#infoPanel.idetail'),
  name: (document.querySelector('#infoPanel h2') || {}).textContent || ''
}));
ok(page.url() === beforeUrl && facPanel.open && facPanel.detail,
  '2. sidebar facility row opens in-map detail without navigation', JSON.stringify(facPanel));

// ── 3. DALFEN dossier ──
await page.goto(`${SITE}/development.html?id=${encodeURIComponent(dalfen.id)}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('#devPage .detail', { timeout: 60000 });
const body = await page.$eval('#devPage', el => el.innerText);
// Case-insensitive: .ph .eyebrow is CSS-uppercased (app.css text-transform:uppercase),
// and Chromium's innerText reflects the transform — the header renders REGULATED FACILITY.
ok(/regulated facility/i.test(body) && !/How this affects you/.test(body),
  '3. dossier header reads "Regulated facility" (facility branch, not the project template)',
  `header line: "${(body.match(/^.*regulated facility.*$/mi) || [])[0]}"`);
ok(/Clean Water Act permit terminated — past its end date, no longer active/.test(body),
  '3. DALFEN shows the §5 Terminated interpreted line',
  `"${(body.match(/.*permit terminated.*$/mi) || [])[0]}"`);
ok(/not a verified clean operating history/.test(body),
  '3. tracking-off caveat renders',
  `"${(body.match(/Once a permit is inactive.*$/mi) || [])[0] || 'caveat text not found'}"`);
ok(!/no recorded EPA violations/i.test(body),
  '3. zeros are NOT presented as a clean record (positive zero-signal absent)',
  /no recorded EPA violations/i.test(body) ? 'FOUND the positive zero line' : 'positive zero line absent');
const dfr = await page.$$eval('#devPage button, #devPage a', els =>
  els.map(e => e.textContent.trim() + ' → ' + (e.getAttribute('onclick') || e.href || '')).filter(t => t.includes('echo.epa.gov')));
ok(dfr.length >= 1, '3. ECHO reachable via the in-panel source link', JSON.stringify(dfr));

// ── 4. an unconfirmed facility's dossier states the honest absence ──
const un = unconfirmed[0];
await page.goto(`${SITE}/development.html?id=${encodeURIComponent(un.id)}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('#devPage .detail', { timeout: 60000 });
const ubody = await page.$eval('#devPage', el => el.innerText);
ok(/Permit status not yet confirmed/.test(ubody),
  `4. unconfirmed facility (${un.name}) dossier says "Permit status not yet confirmed"`,
  `"${(ubody.match(/Permit status not yet confirmed.*$/mi) || [])[0] || 'text not found'}"`);
ok(!KNOWN.some(s => new RegExp(`permit ${s.toLowerCase()}`).test(ubody.toLowerCase())),
  '4. no fake/guessed status on the unconfirmed dossier', 'no §5 status phrasing present');

await browser.close();
console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
