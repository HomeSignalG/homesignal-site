// MAP 1 — THE REGULATORY/TYPE CONTRACT, PROVEN ON THE DEPLOYED SITE.
//
// The defect this proves gone (#1218, reported twice from live ZIP pages): the Regulatory
// chip acted as a TYPE BYPASS. With Data center the only Type checked, 78617 drew 30 pins
// and 75009 drew 27, and not one of the 57 was a data centre — they were EPA industrial and
// energy records admitted by `facility` while their own Type chip was off.
//
// ── WHY THIS IS A GLOBAL PROOF AND NOT A SAMPLE, STATED EXACTLY ──────────────────────
// Map 1 is ONE document (`homesignalmap.html`) parameterised by `?zip=`, loading ONE
// runtime (`lib/map.js`) through ONE <script> tag. There are not 12,722 Map 1 documents to
// check — there is one file that all 12,722 canonical ZIPs resolve to. So:
//
//   LAYER A (GLOBAL, exhaustive)  — read the DEPLOYED /lib/map.js and verify that
//     production base-pin membership is Type-only and that Regulatory is an independent
//     visual overlay, not a base-pin admission path; and that the page's cache-buster
//     points at exactly those bytes. One file proven ⇒ every ZIP.
//   LAYER B (BEHAVIOURAL, sampled) — drive real production ZIP pages in a real browser and
//     prove the rule HOLDS as rendered. A sample is honest here because Layer A has already
//     established there is only one implementation to sample.
//
// ⚠️ Layer B alone would be a sample of 12,722 and could not support a global claim.
// Layer A alone proves the bytes shipped but not that they behave. Neither is dropped.
//
// NO SECRETS, read-only, public anon key only — the same browser session a resident has.
// Run: BASE=https://homesignal.net node scripts/map1-regulatory-live-proof.mjs
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'https://homesignal.net';
const ZIPS = (process.env.ZIPS || '78617,75009,20171,85003,60601')
  .split(',').map(s => s.trim()).filter(Boolean);

let fails = 0;
const ok = (c, name, extra) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name + (extra !== undefined ? '  [' + extra + ']' : ''));
  if (!c) fails++;
};

// ══ LAYER A — THE SHIPPED BYTES, WHICH IS THE GLOBAL CLAIM ═══════════════════════════
console.log('== LAYER A — the deployed runtime (one file, all 12,722 ZIPs) ==');

const pageHtml = await (await fetch(BASE + '/homesignalmap.html')).text();
const tag = (pageHtml.match(/<script src="lib\/map\.js\?v=([a-f0-9]+)"><\/script>/) || [])[1];
ok(!!tag, 'A1: homesignalmap.html loads lib/map.js with a cache key', tag || 'NO TAG');

// Exactly one loader. A second <script> for the same runtime would mean a page could get
// different bytes depending on which tag won, and the global claim would not hold.
const loaders = (pageHtml.match(/<script src="lib\/map\.js/g) || []).length;
ok(loaders === 1, 'A2: …and loads it exactly ONCE — one runtime, no second copy', loaders);

const res = await fetch(BASE + '/lib/map.js?v=' + tag);
ok(res.status === 200, 'A3: the keyed runtime URL serves', res.status);
const js = await res.text();

// ── A4-A6 — THE PREDICATE ITSELF, SCOPED TO ITS OWN BODY ─────────────────────────────
// ⚖️ REWRITTEN 2026-09-15 for the overlay-only ruling (#1222), which DELETED the three-case
// rule these three used to grep for. Left as they were, they failed against the shipped fix
// while printing "the deployed runtime does not carry the fix" — the exact inverse of the
// truth, and an abort before Layer B ever ran.
//
// ⚠️ WHY THE ASSERTION IS SCOPED TO THE FUNCTION BODY RATHER THAN THE FILE. `REGULATORY_
// LEGEND`, `facility` and `isFacility` appear all over lib/map.js for legitimate reasons —
// `visibleSignal`, the legend row, the category registry, the marker's own membership. A
// file-wide grep therefore cannot answer "is regulatory an ADMISSION PATH": it would fire on
// the overlay code the ruling keeps. The question is only ever about ONE function, so the
// proof reads only that function's body.
const cvBody = (js.match(/HS\.categoryVisible = function \(item\) \{\n([\s\S]*?)\n  \};/) || [])[1];
ok(!!cvBody, 'A4: the deployed HS.categoryVisible body was isolated out of the shipped bytes',
  cvBody ? cvBody.replace(/\s+/g, ' ').trim().slice(0, 96) : 'NOT FOUND');

// The keys it evaluates are derived from TYPE keys only: membership in, facility keys
// filtered OUT, the loop over what survives, and a default of false.
const TYPE_ONLY_FILTER =
  /\.filter\(\s*function\s*\(k\)\s*\{\s*return\s*!CATEGORY_REGISTRY\[k\]\.isFacility;\s*\}\s*\)/;
ok(!!cvBody
   && /markerCategories\(item\)/.test(cvBody)
   && TYPE_ONLY_FILTER.test(cvBody)
   && /for\s*\(let i = 0; i < typeCats\.length; i\+\+\)\s*if\s*\(categoryFilters\[typeCats\[i\]\]\)\s*return true;/.test(cvBody)
   && /return false;/.test(cvBody),
  'A5: base-pin membership is TYPE-ONLY — keys filtered by !isFacility, looped as typeCats, '
  + 'default false');

// THE ADMISSION-PATH NEGATIVE, and the one that catches a revert of any shape. Remove the
// single legitimate mention — the `!isFacility` EXCLUSION asserted directly above — and NO
// regulatory token may remain. Anything surviving that strip is an admit branch by
// construction, because exclusion is the only role the concept has inside this function.
// This is deliberately stronger than naming the old flat any-of (A7): it refuses a regulatory
// admit path written in ANY new form, not just the one that shipped the defect.
const cvRemainder = (cvBody || '').replace(TYPE_ONLY_FILTER, '');
const regTokens = cvRemainder.match(/REGULATORY_LEGEND|isFacility|['"]facility['"]/g) || [];
ok(!!cvBody && regTokens.length === 0,
  'A6: regulatory is NOT an admission path inside categoryVisible — no regulatory token '
  + 'survives once the !isFacility exclusion is removed', regTokens.join(',') || 'none');

// THE NEGATIVE, which is the one that actually catches a revert: the old predicate was a
// single unguarded loop over the whole membership set. Its shape must be gone.
const flatAnyOf = /const cats = markerCategories\(item\);\s*\n\s*for \(let i = 0; i < cats\.length; i\+\+\) if \(categoryFilters\[cats\[i\]\]\) return true;/;
ok(!flatAnyOf.test(js), 'A7: the flat any-of is GONE from the shipped bytes — the bypass cannot recur');
ok(/typeCats/.test(js) && /REGULATORY_LEGEND\.key/.test(js),
  'A8: …and the Type/regulatory split it was replaced with is present');

// Membership itself must NOT have changed — the ruling moved which dimension admits a
// record, never what the record is. A build that "fixed" this by dropping the Type key
// would pass A7 and be the #1121 defect again.
ok(/categories: \[overlay\.typeKey, 'facility'\]/.test(js),
  'A9: membership is UNCHANGED — overlay records still carry [typeKey, facility]');

if (fails) {
  console.log('\nLAYER A FAILED — the deployed runtime does not carry the fix. '
    + 'Layer B is not run: behaviour cannot be proven against bytes that are wrong.');
  process.exit(1);
}
console.log('LAYER A PASSED — the single deployed runtime carries the rule, so every one of '
  + 'the 12,722 canonical ZIPs resolves to fixed code.\n');

// ══ LAYER B — THE RULE AS RENDERED, on real production ZIPs ══════════════════════════
console.log('== LAYER B — behaviour on deployed ZIP pages ==');
const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });

const read = (page) => page.evaluate(() => {
  const mk = Array.from(document.querySelectorAll('#map .leaflet-marker-icon'))
    .filter(el => !el.classList.contains('homepin'));
  return {
    pins: mk.length,
    r: mk.filter(el => {
      const h = (el.querySelector('svg') || {}).outerHTML || '';
      return /#7d148c/i.test(h) && />R<\/text>/.test(h);
    }).length
  };
});
const setTypes = (page, keys) => page.evaluate(ks => {
  Array.from(document.querySelectorAll('#mapkeyShapes .typechip[data-cat]')).forEach(r => {
    const want = ks.indexOf(r.getAttribute('data-cat')) !== -1;
    if (want !== !!(r.querySelector('input') || {}).checked) r.click();
  });
}, keys);
const setReg = (page, on) => page.evaluate(v => {
  const t = document.getElementById('regToggle');
  if (t && (!!(t.querySelector('input') || {}).checked) !== v) t.click();
}, on);

for (const zip of ZIPS) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  try {
    await page.goto(BASE + '/homesignalmap.html?zip=' + zip, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => Array.isArray(window.__HS_SITES), null, { timeout: 60000 });
    await page.waitForTimeout(1500);

    // The baseline every other reading is relative to.
    await setTypes(page, await page.evaluate(() =>
      Array.from(document.querySelectorAll('#mapkeyShapes .typechip[data-cat]')).map(r => r.getAttribute('data-cat'))));
    await setReg(page, true); await page.waitForTimeout(600);
    const all = await read(page);

    // ── B1. THE CONTRACT THE RULING PROTECTS ────────────────────────────────────────
    // Regulatory OFF over the default view must drop every R and NOT ONE PIN.
    await setReg(page, false); await page.waitForTimeout(600);
    const regOff = await read(page);
    ok(regOff.pins === all.pins,
      'B1 ' + zip + ': all Types ON, Regulatory OFF → not one pin removed',
      all.pins + ' -> ' + regOff.pins);
    ok(regOff.r === 0, 'B1b ' + zip + ': …and every purple R is gone', regOff.r);

    // ── B2. THE REPORTED DEFECT ─────────────────────────────────────────────────────
    // Every pin drawn while ONE Type is selected must actually BE that Type. This is the
    // assertion that was false in production: 30 industrial pins under "Data center".
    await setTypes(page, ['datacenter']); await setReg(page, true); await page.waitForTimeout(600);
    const dcOnly = await read(page);
    const offType = await page.evaluate(() => {
      const on = Array.from(document.querySelectorAll('#mapkeyShapes .typechip[data-cat]'))
        .filter(r => !!(r.querySelector('input') || {}).checked).map(r => r.getAttribute('data-cat'));
      return (window.__HS_SITES || []).filter(s => {
        const m = window.__HS_RESOLVE_TRACKER(s);
        const cats = (m.categories && m.categories.length) ? m.categories : [m.categoryKey];
        const typeCats = cats.filter(k => k !== 'facility');
        // A drawn record whose own Type is not among the checked chips is a bypass.
        return typeCats.length && !typeCats.some(k => on.indexOf(k) !== -1)
               && window.HS.categoryVisible(m);
      }).length;
    });
    ok(offType === 0,
      'B2 ' + zip + ': Data center only + Regulatory ON → ZERO pins drawn under a Type the '
      + 'resident switched off', 'bypassing=' + offType + ' pins=' + dcOnly.pins);

    // ── B3. NO TYPE SELECTED IS GENUINELY EMPTY — IN EITHER SWITCH STATE ────────────
    // ⚖️ INVERTED 2026-09-15 (#1222). This used to assert the OPPOSITE: that with no Type
    // selected the switch still showed the regulatory layer ("turn OFF every Map 1 type
    // except EPA"). The overlay-only ruling removed that limb — regulatory may never ADMIT
    // a record — so no selected Type now means no base pin, switch or no switch.
    // `hasReg` is kept and is now the POSITIVE CONTROL, not the condition: a zero measured
    // on a ZIP holding no regulatory records at all would be meaningless, so the log has to
    // show that this ZIP had something the old behaviour would have drawn.
    await setTypes(page, []); await setReg(page, true); await page.waitForTimeout(600);
    const epaOnly = await read(page);
    const hasReg = await page.evaluate(() => (window.__HS_SITES || [])
      .some(s => s && s.registry_id));
    ok(epaOnly.pins === 0,
      'B3 ' + zip + ': no Types + Regulatory ON → ZERO base pins; the switch admits nothing',
      'pins=' + epaOnly.pins + ' zipHasRegulatoryRecords=' + hasReg);
    await setTypes(page, []); await setReg(page, false); await page.waitForTimeout(600);
    ok((await read(page)).pins === 0,
      'B4 ' + zip + ': nothing selected at all → genuinely empty');
  } catch (e) {
    ok(false, 'B ' + zip + ': the page could not be driven', String(e && e.message).slice(0, 120));
  } finally {
    await ctx.close();
  }
}

await browser.close();
console.log('\n' + (fails ? fails + ' FAILURE(S)' : 'all checks passed'));
process.exit(fails ? 1 : 0);
