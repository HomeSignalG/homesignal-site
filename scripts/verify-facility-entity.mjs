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

// Co-located same-name registrations merge into ONE card — same key HS.fac.groupKey uses
// (name + lat/lng to 3 dp). distinctFacilities counts merged SITES; mergedGroups are the
// sites carrying >1 EPA registration (both records must stay reachable from one dossier).
const gkey = r => `${String(r.name || '').trim().toUpperCase()}@${Number(r.lat).toFixed(3)},${Number(r.lng).toFixed(3)}`;
const groups = {};
mapped.forEach(r => { (groups[gkey(r)] = groups[gkey(r)] || []).push(r); });
const distinctFacilities = Object.keys(groups).length;
const mergedGroups = Object.values(groups).filter(g => g.length > 1);
const facFloor = Math.min(4, distinctFacilities);
console.log(`DB ground truth ${ZIP}: ${rows.length} facility rows (${mapped.length} mapped, ${distinctFacilities} distinct after merge, ${mergedGroups.length} merged site(s)), ${withPermit.length} with permit_status. DALFEN id=${dalfen?.id}, status=${dalfenStatus || '(none — fail-open)'}`);
mergedGroups.forEach(g => console.log(`  merged: ${g[0].name} → ${g.map(r => r.registry_id + '(' + (r.facility_env?.epa?.permit_status || 'no status') + ')').join(' + ')}`));

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

// ── Global fix #1: facility slots are RESERVED in the A–P cap ──
// At least min(4, #distinct facilities) facilities must letter on the DEFAULT view, and
// DALFEN INDUSTRIAL (naturally near the cap edge, ~1.5 mi out) must be one of them — it
// must not be pushed off by closer development items.
const facNames = facCards.map(c => c.name);
ok(facCards.length >= facFloor,
  `1. ≥ min(4, #distinct)=${facFloor} facilities letter on the default ${ZIP} view (slots reserved)`,
  `${facCards.length} facility cards lettered: ${facNames.join(' | ')}`);
ok(facNames.some(n => /DALFEN INDUSTRIAL/i.test(n)),
  '1. DALFEN INDUSTRIAL is present on the default view (its reserved slot held)',
  facNames.join(' | '));

// A merged card, if one is in the lettered list, flags itself with the secondary marker.
const mergeMarked = facCards.filter(c => /EPA registrations/i.test(c.eyebrow)).map(c => c.name);
console.log(`      lettered merged cards flagged "N EPA registrations": ${mergeMarked.length ? mergeMarked.join(', ') : '(none in top-16)'}`);

// ── Global fix #2: the "Map view" pill is HONEST — it filters NOTHING ──
const pill = await page.$eval('#radiusPill', el => el.textContent.trim());
ok(/map view/i.test(pill) && !/radius/i.test(pill),
  '2. the map-size pill reads "Map view", not "Radius" (honest label)', `"${pill}"`);
const countCards = () => page.evaluate((PURPLE) => {
  const cards = [...document.querySelectorAll('#pinList .card.mini')];
  return { total: cards.length, fac: cards.filter(e => getComputedStyle(e).borderLeftColor === PURPLE).length };
}, PURPLE);
const before = await countCards();
for (let i = 0; i < 4; i++) { await page.click('#radiusPill'); await page.waitForTimeout(300); }   // cycle 1→2→3→5 mi
await page.waitForTimeout(600);
const after = await countCards();
ok(before.total === after.total && before.fac === after.fac && after.fac >= facFloor,
  '2. cycling the map-view pill does NOT filter the near-you list or facility cards',
  `before ${JSON.stringify(before)} · after ${JSON.stringify(after)}`);

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

// ── Global fix #1 (merge): a co-located multi-registration site reaches BOTH records ──
// One physical site can hold >1 EPA (FRS) registration with different statuses. They
// collapse to ONE dossier, but a reader must be able to reach EITHER public record — both
// registry_ids appear as ECHO source links, and the merge is disclosed (never hidden).
if (mergedGroups.length) {
  const grp = mergedGroups[0];                       // e.g. LONGVIEW OFFSITE UTILITIES PHASE 1
  const rids = grp.map(r => r.registry_id);
  await page.goto(`${SITE}/development.html?id=${encodeURIComponent(grp[0].id)}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('#devPage .detail', { timeout: 60000 });
  const detailBody = await page.$eval('#devPage', el => el.innerText);
  // Every ECHO record link is a button whose onclick opens echo.epa.gov?...fid=<registry_id>.
  const echoFids = await page.$$eval('#devPage .doact button', bs => bs
    .map(b => (b.getAttribute('onclick') || ''))
    .filter(o => /echo\.epa\.gov/.test(o))
    .map(o => (o.match(/fid=(\d+)/) || [])[1])
    .filter(Boolean));
  ok(rids.every(r => echoFids.includes(r)),
    `1. merged site "${grp[0].name}" reaches BOTH EPA records (${rids.join(' + ')})`,
    `ECHO fids offered in the dossier: ${JSON.stringify(echoFids)}`);
  // The merge is disclosed: the "N EPA registrations" note + a per-registration list.
  ok(new RegExp(`${grp.length}\\s*EPA registrations`, 'i').test(detailBody) && /EPA registrations at this site/i.test(detailBody),
    `1. the merge is disclosed on the dossier (${grp.length} registrations, both statuses listed)`,
    `"${(detailBody.match(/[^.\n]*EPA registrations[^.\n]*/i) || [])[0]?.trim()}"`);
  // Most-active drives the bottom line — the site is NOT implied wholly Terminated when a
  // registration is still active. Build the expected most-active status from the DB.
  const ORDER = ['Effective', 'Admin Continued', 'Administratively Continued', 'Expired', 'Pending', 'Not Needed', 'Retired', 'Terminated'];
  const rank = s => { const i = ORDER.indexOf(s); return i < 0 ? 98 : i; };
  const mostActive = grp.map(r => r.facility_env?.epa?.permit_status).filter(Boolean).sort((a, b) => rank(a) - rank(b))[0];
  const others = grp.map(r => r.facility_env?.epa?.permit_status).filter(s => s && s !== mostActive);
  const bottomLine = (detailBody.match(/The bottom line\s*([^\n]+)/i) || [])[1] || '';
  if (mostActive && others.length) {
    ok(!/terminated/i.test(bottomLine) || mostActive === 'Terminated',
      `1. bottom line reflects the MOST-ACTIVE registration (${mostActive}), not a co-located ${others.join('/')}`,
      `bottom line: "${bottomLine.trim()}"`);
  }
} else {
  ok(true, '1. (no co-located multi-registration site in this ZIP — merge path not exercised here)', 'skipped');
}

await browser.close();
console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
