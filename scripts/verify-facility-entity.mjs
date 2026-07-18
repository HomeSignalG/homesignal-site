// verify-facility-entity.mjs — live browser check that regulated facilities follow the
// SAME lettered-pin + near-you-card + detail workflow as projects on maps.html/development.html.
// Runs on a GitHub runner (the sandbox has no egress). Self-adapting: expectations are read
// from the live DB, so it stays green whether or not fail-open ECHO permit_status is present.
//
// Verifies the task's acceptance on ZIP 78617 (Del Valle):
//   1. A regulated facility appears as a lettered card in "NEAR YOU · CLOSEST FIRST"
//      (interleaved with projects — NOT a separate section, NOT a plain purple square).
//   2. The facility card carries a purple letter badge, and that letter also marks a pin.
//   3. Clicking the facility card opens the detail page (development.html?id=), and NO
//      echo.epa.gov link exists anywhere on maps.html (facilities route internally).
//   4. The detail page uses the standard layout (How this affects you / The bottom line /
//      What you can do / The specs), reads "Regulated facility", has NO timeline, NO
//      project-only actions, NO empty/dead slot, and the ECHO/TCEQ record link + Follow.
//   5. Honest: no fabricated clean record; where permit_status exists it's the §5 line,
//      where it doesn't the bottom line states the honest absence.
//
// Read-only. Prints OBSERVED lines; exits 1 on any failed assertion.
import { chromium } from 'playwright';

const SITE = process.env.SITE_BASE || 'https://homesignal.net';
const SB = 'https://qwnnmljucajnexpxdgxr.supabase.co';
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF3bm5tbGp1Y2FqbmV4cHhkZ3hyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA0MTAyOTgsImV4cCI6MjA5NTk4NjI5OH0.prpXB6lSIhWMAsdkkaxAfkvEodbojfUUyN4L4JbQE1U';
const ZIP = process.env.ZIP || '78617';
const PURPLE = 'rgb(111, 66, 193)';   // #6f42c1 — the shared "Regulated facility" color key

let failures = 0;
const ok = (cond, label, observed) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}\n      observed: ${observed}`);
  if (!cond) failures++;
};

// ── Ground truth from the live DB ──
const rows = await (await fetch(
  `${SB}/rest/v1/app_projects?zip=eq.${ZIP}&record_kind=eq.facility&select=id,name,registry_id,facility_env,lat,lng&order=name.asc`,
  { headers: { apikey: ANON, Authorization: `Bearer ${ANON}` } })).json();
const mapped = rows.filter(r => r.lat != null && r.lng != null);
const names = new Set(rows.map(r => r.name));
const withPermit = rows.filter(r => r.facility_env?.epa?.permit_status);
const dalfen = rows.find(r => r.registry_id === '110071346495');
const dalfenStatus = dalfen?.facility_env?.epa?.permit_status || null;
console.log(`DB ground truth ${ZIP}: ${rows.length} facility rows (${mapped.length} mapped), ${withPermit.length} with permit_status. DALFEN id=${dalfen?.id}, status=${dalfenStatus || '(none — fail-open)'}`);

const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();

// ── maps.html: interleaved lettered facility cards ──
await page.goto(`${SITE}/maps.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('#pinList .card.mini', { timeout: 60000 });
await page.waitForTimeout(4000);   // marker layers attach after the map engine settles

// No separate "Regulated facilities" section header — facilities are in the near-you list now.
const heads = await page.$$eval('#pinList .groupHead', els => els.map(e => e.textContent.trim()));
ok(!heads.some(h => /^Regulated facilities/i.test(h)) && heads.some(h => /Near you/i.test(h)),
  '1. facilities are in "Near you", not a separate section', JSON.stringify(heads));

// Facility cards = purple-bordered near-you cards, each with a letter badge.
const facCards = await page.$$eval('#pinList .card.mini', (els, PURPLE) => els
  .filter(e => getComputedStyle(e).borderLeftColor === PURPLE)
  .map(e => ({ letter: (e.querySelector('.letter')?.textContent || '').trim(),
               name: (e.querySelector('h3')?.textContent || '').trim(),
               eyebrow: (e.querySelector('.lens')?.textContent || '').replace(/\s+/g, ' ').trim(),
               body: (e.querySelector('.sowhat')?.textContent || '').trim() })), PURPLE);
ok(facCards.length >= 1 && facCards.every(c => /^[A-P]$/.test(c.letter)) && facCards.every(c => names.has(c.name)),
  '1. facility cards render lettered (A–P) in the near-you list, titled by facility name',
  `${facCards.length} facility cards; first: ${JSON.stringify(facCards[0])}`);

// Eyebrow uses program + distance, NEVER a development lifecycle status.
ok(facCards.every(c => !/proposed|approved|operating|on file/i.test(c.eyebrow)) && facCards.every(c => !!c.body),
  '1. facility eyebrow uses program (no dev status word); body non-empty (compliance/honest-absence)',
  `eyebrow: "${facCards[0]?.eyebrow}" · body: "${facCards[0]?.body}"`);

// The card's letter also marks a map pin (any live engine), purple where determinable.
const L = facCards[0].letter;
const pinHit = await page.evaluate((L) => {
  const div = [...document.querySelectorAll('#mapgl div, #maplf div')]
    .find(n => (n.textContent || '').trim() === L);
  if (div) return { where: 'tile marker', purple: (div.style.background || '').includes('rgb(111, 66, 193)') };
  const txt = [...document.querySelectorAll('#mapSch svg text')].find(n => (n.textContent || '').trim() === L);
  if (txt) { const circ = txt.parentNode?.querySelector('circle'); return { where: 'schematic', purple: (circ?.getAttribute('fill') === '#6f42c1') }; }
  return null;
}, L);
ok(!!pinHit, `2. the facility card letter "${L}" also marks a map pin`, JSON.stringify(pinHit));

// No echo.epa.gov anywhere on maps.html (facilities route internally, not to raw ECHO).
const echoLinks = await page.$$eval('a', as => as.filter(a => (a.href || '').includes('echo.epa.gov')).length);
ok(echoLinks === 0, '3. no echo.epa.gov link anywhere in the maps.html DOM', `${echoLinks} echo links`);

// Clicking a facility card navigates to the detail route.
const facIdx = await page.$$eval('#pinList .card.mini', (els, PURPLE) =>
  els.findIndex(e => getComputedStyle(e).borderLeftColor === PURPLE), PURPLE);
await page.$$eval('#pinList .card.mini', (els, i) => els[i].click(), facIdx);
await page.waitForURL(/development\.html\?id=/, { timeout: 15000 });
ok(true, '3. facility card opens development.html?id=', page.url());

// ── detail page: standard layout, no dead/empty slot ──
const target = withPermit[0] || mapped[0] || rows[0];
await page.goto(`${SITE}/development.html?id=${encodeURIComponent(target.id)}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('#devPage .detail', { timeout: 60000 });
const body = await page.$eval('#devPage', el => el.innerText);
const kickers = await page.$$eval('#devPage .kicker', els => els.map(e => e.textContent.trim()));

ok(/How this affects you/i.test(body) && kickers.includes('The bottom line') && kickers.includes('What you can do') && kickers.includes('The specs'),
  '4. detail uses the standard layout (bottom line / what you can do / the specs)', JSON.stringify(kickers));
ok(/regulated facility/i.test(body),
  '4. detail reads "Regulated facility"', `"${(body.match(/^.*regulated facility.*$/mi) || [])[0]}"`);
ok(!kickers.some(k => /story so far/i.test(k)) && !/story so far/i.test(body),
  '4. THE STORY SO FAR timeline is omitted for facilities', `kickers: ${JSON.stringify(kickers)}`);
ok(!/Submit a public comment/i.test(body) && !/Add hearing to calendar/i.test(body),
  '4. project-only actions (comment / add hearing) are NOT rendered', 'neither present');

// No dead/empty slot: no spec row renders a bare "—", and every action button has an onclick.
const dashRows = await page.$$eval('#devPage .specs .row b', bs => bs.map(b => b.textContent.trim()).filter(t => t === '—').length);
const deadBtns = await page.$$eval('#devPage .doact button', bs => bs.filter(b => !b.getAttribute('onclick')).length);
ok(dashRows === 0 && deadBtns === 0, '4. no empty spec row (no "—") and no dead action button',
  `${dashRows} dash rows, ${deadBtns} dead buttons`);

// Source link + Follow present.
const actions = await page.$$eval('#devPage .doact button', bs => bs.map(b => b.textContent.trim()));
ok(actions.some(a => /EPA source|public record|TCEQ/i.test(a)) && actions.some(a => /Follow this facility/i.test(a)),
  '4. official record link + "Follow this facility" present', JSON.stringify(actions));

// Honest interpretation: where permit_status exists, the §5 line; else honest absence — never a fabricated clean record.
if (target.facility_env?.epa?.permit_status) {
  ok(/permit (terminated|expired|retired|application pending)|Active .* permit|No permit required/i.test(body),
    `5. permit_status present (${target.facility_env.epa.permit_status}) → §5 interpreted line renders`,
    `"${(body.match(/^.*permit.*$/mi) || [])[0]}"`);
} else {
  ok(/compliance status not on record|permitted|violation|program|registry/i.test(body.toLowerCase()) && !/no recorded epa violations/i.test(body),
    '5. no permit_status → honest bottom line, no fabricated "clean record"',
    `"${(body.match(/bottom line[\s\S]{0,120}/i) || [])[0]?.replace(/\s+/g, ' ')}"`);
}

await browser.close();
console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
