// verify-maps.mjs — live end-to-end check of the APP MAP page (maps.html), dedicated to
// the facility-slot reservation (HS.reserveFacilitySlots). Separate from verify-development
// (which drives homesignalmap.html, a different stack). Runs where egress works (GitHub
// Actions); the build sandbox cannot reach homesignal.net.
//
// WHAT IT ASSERTS on maps.html signed-out (which defaults to CFG.DEFAULT_ZIP = 78617):
//   HARD  — the reserve-slot FLOOR holds: at least min(4, #mappable-facilities) of the
//           lettered pins are facilities. This proves the mechanism on REAL data.
//   SOFT  — a facility named "DALFEN" is among the lettered pins. LOGGED, never fails the
//           run: a data-name variance in app_projects must not red-flag CI as if the code
//           broke (founder decision 2026-07-18). CI proves the slot mechanism, not a string.
//
// The page exposes window.__HS_MAP = { items, facCount } (see maps.html shownItems()).
//
// Config via env: SITE_BASE (default https://homesignal.net), MAPS_PATH (default /maps.html),
// DALFEN_ZIP (informational; the page picks the ZIP from DEFAULT_ZIP when signed out).

import { chromium } from 'playwright';

const SITE_BASE = (process.env.SITE_BASE || 'https://homesignal.net').replace(/\/$/, '');
const MAPS_PATH = process.env.MAPS_PATH || '/maps.html';
const FLOOR = 4;
const SOFT_NAME = process.env.SOFT_NAME || 'DALFEN';
const target = SITE_BASE + MAPS_PATH;

async function gotoWithRetry(page, url) {
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  } catch (e) {
    if (!String(e && e.message).includes('Timeout')) throw e;
    console.log(`  ~ nav timeout, retrying once: ${url}`);
    await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
  }
}

async function main() {
  console.log(`Verifying the app map facility-slot floor against ${target}`);
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const fails = [];
  const soft = [];

  try {
    await gotoWithRetry(page, target);
    // Wait until shownItems() has run once and published the hook.
    await page.waitForFunction(
      () => window.__HS_MAP && Array.isArray(window.__HS_MAP.items),
      { timeout: 20000 }
    );
    const snap = await page.evaluate(() => {
      const m = window.__HS_MAP || {};
      const items = Array.isArray(m.items) ? m.items : [];
      return {
        facCount: typeof m.facCount === 'number' ? m.facCount : 0,
        total: items.length,
        lettered: items.map((it) => ({ letter: it._letter, facility: !!it._facility, name: it.name || it.title || '' })),
      };
    });

    const facLettered = snap.lettered.filter((x) => x.facility);
    const floor = Math.min(FLOOR, snap.facCount);   // can't letter more facilities than exist

    // HARD: the reserve floor holds.
    if (facLettered.length < floor) {
      fails.push(
        `facility-slot floor NOT met: ${facLettered.length} lettered facilities, expected >= min(${FLOOR}, ${snap.facCount}) = ${floor}`
      );
    }
    // Every lettered item must carry a letter (mechanism sanity).
    const gap = snap.lettered.findIndex((x, i) => x.letter !== 'ABCDEFGHIJKLMNOP'[i]);
    if (gap !== -1) fails.push(`lettering gap/dup at index ${gap} (letter "${snap.lettered[gap] && snap.lettered[gap].letter}")`);

    // SOFT: DALFEN present — logged only.
    const hasSoft = facLettered.some((x) => new RegExp(SOFT_NAME, 'i').test(x.name));
    if (!hasSoft) soft.push(`soft: "${SOFT_NAME}" not among the lettered facilities (data-name variance, not a code failure)`);

    console.log(
      `  ${snap.total} lettered pins · ${facLettered.length}/${floor} facility floor · ` +
      `${snap.facCount} mappable facilities on 78617 default · ${SOFT_NAME}: ${hasSoft ? 'present' : 'absent (soft)'}`
    );
    if (facLettered.length) console.log(`  facilities lettered: ${facLettered.map((x) => `${x.letter}:${x.name}`).join(' · ')}`);
  } catch (e) {
    fails.push(`could not verify maps page: ${(e && e.message) || e}`);
  } finally {
    await browser.close();
  }

  const summary = [
    `# App-map facility-slot verification`,
    ``,
    `- Site: ${SITE_BASE}${MAPS_PATH}`,
    `- Hard check (reserve floor min(${FLOOR}, #facilities)): **${fails.length ? 'FAIL' : 'PASS'}**`,
    ...(soft.length ? [`- ${soft[0]}`] : [`- Soft check "${SOFT_NAME}": present`]),
    ...(fails.length ? [``, `## Failures`, ...fails.map((f) => `- ${f}`)] : []),
  ].join('\n');
  console.log('\n' + summary);
  if (process.env.GITHUB_STEP_SUMMARY) {
    const { appendFileSync } = await import('node:fs');
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + '\n');
  }
  if (fails.length) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
