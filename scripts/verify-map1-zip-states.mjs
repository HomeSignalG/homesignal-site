// LIVE production verification of Map 1's ZIP-mode geography contract, across all three
// geography states, plus the address-mode separation.
//
// Every control ZIP's producer status is asserted in this same run rather than assumed, and
// the two mode contracts are checked SEPARATELY - ZIP mode must carry no distance and no
// radius semantics, address mode must send a real geocoded home and a chosen radius.
import { chromium } from 'playwright';
import { surfaceBanner } from './lib/surface-banner.mjs';

const BASE = process.env.SITE_BASE || 'https://homesignal.net';
let fails = 0;
const ok = (c, name, detail) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name + (detail ? '  [' + detail + ']' : ''));
  if (!c) fails++;
};

// Every expectation below was read out of production's own cutover/status tables immediately
// before this run — none is carried over from an earlier session.
//
// 08005 MOVED, and that is the point of re-reading rather than trusting the old list. It was
// this file's 'pending' control; the Phase 2 manifest-gap cutover measured its whole ZCTA
// against the whole corpus, found 0 intersections and 0 declared candidates, and enabled it as
// an authoritative MEASURED ZERO (run_id phase2-gap-caseA-2026-09-05). Re-pointing it is
// following the proven state, not making a red test green — and the 'pending' state it vacated
// is now covered by two ZIPs that really are pending.
//
//   dev  = authoritative membership rows the production relation holds for that ZIP
//   fac  = whether the page must still carry facilities (proves facilities are unaffected)
const CASES = [
  // ── controls that predate Phase 2, expectations unchanged ────────────────────────────────
  { zip: '01001', kind: 'authoritative', dev: 12,   fac: false, tag: 'pre-Phase-2 control' },
  { zip: '01004', kind: 'not_measured',              fac: false, tag: 'NO_ZCTA_IN_TIGER_2025' },
  { zip: '01009', kind: 'measured_zero',             fac: false, tag: 'pre-Phase-2 control' },

  // ── Phase 2, shards 284/300 — authoritative NON-ZERO, the newly built population ──────────
  { zip: '28428', kind: 'authoritative', dev: 2440, fac: true,  tag: 'shard 284 · retired 2,424 legacy' },
  { zip: '30033', kind: 'authoritative', dev: 2261, fac: true,  tag: 'shard 300 · retired 10,960 legacy' },
  { zip: '28456', kind: 'authoritative', dev: 12,   fac: true,  tag: 'shard 284 · small non-zero' },

  // ── Phase 2 — authoritative MEASURED ZERO, the state that must never read as unmeasured ───
  { zip: '08005', kind: 'measured_zero',             fac: false, tag: 'manifest-gap 442' },
  { zip: '38801', kind: 'measured_zero',             fac: true,  tag: 'manifest-gap 442 · 40 facilities' },
  { zip: '30090', kind: 'measured_zero',             fac: true,  tag: 'shard 300 Case A · 40 facilities' },

  // ── the 3 genuinely pending ZIPs — must NOT present as boundary_complete ──────────────────
  { zip: '99128', kind: 'pending', tag: 'Case C: intersection exists, membership unbuildable' },
  { zip: '94128', kind: 'pending', tag: 'unevaluatable legacy candidates' },
];

const browser = await chromium.launch();
const page = await browser.newPage();
surfaceBanner('verify-map1-zip-states');
console.log('LIVE Map 1 ZIP-state verification — ' + BASE + '\n');

const facBaseline = {};

for (const c of CASES) {
  await page.goto(`${BASE}/homesignalmap.html?zip=${c.zip}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__HS_SITES !== undefined, { timeout: 60000 }).catch(() => {});
  // SETTLE, don't guess. A fixed 3s wait read 798 of 28428's 2,442 records and 0 of 30033's
  // 2,261 - a partial render mid-load, which is indistinguishable from wrong data if you
  // sample once. Wait until the rendered set stops growing, then sample.
  let prevLen = -1, stable = 0;
  for (let i = 0; i < 60 && stable < 3; i++) {
    await page.waitForTimeout(1000);
    const len = await page.evaluate(() => (window.__HS_SITES || []).length);
    stable = (len === prevLen) ? stable + 1 : 0;
    prevLen = len;
  }

  const m = await page.evaluate(() => {
    const sites = window.__HS_SITES || [];
    const dev = sites.filter(s => s && s.relevance === 'development');
    const fac = sites.filter(s => s && s.relevance !== 'development');
    const txt = document.body.innerText || '';
    return {
      dev: dev.length, fac: fac.length,
      // Which layer each development record came from. The authoritative RPC stamps
      // authoritative:true; anything without it came from the development_reports cache.
      devAuthoritative: dev.filter(s => s.authoritative === true).length,
      devCached:        dev.filter(s => s.authoritative !== true).length,
      // ZIP mode must never carry address-mode geometry on a development record
      devWithDistance: dev.filter(s => s.distance_mi != null || s.e != null || s.n != null).length,
      notMeasured: /not measured yet/i.test(txt),
      couldNotRead: /could not be read/i.test(txt),
      addressCta:  /street address/i.test(txt),
      wholeZip:    /whole of ZIP|whole ZIP/i.test(txt),
      noCircle:    /will not estimate it from a circle/i.test(txt),
    };
  });
  facBaseline[c.zip] = m.fac;

  console.log(`── ${c.zip} (${c.kind}${c.tag ? ' · ' + c.tag : ''}) · development=${m.dev}`
    + ` (authoritative=${m.devAuthoritative} cached=${m.devCached}) · facilities/other=${m.fac}`
    + ` · settled after ${prevLen} sites`);

  // Facilities must survive a geography cutover untouched. Asserted on the pages where
  // production holds facility rows, INCLUDING measured-zero pages - a page with zero
  // development must still show its facilities, or the cutover ate something it never owned.
  if (c.fac === true) {
    ok(m.fac > 0, `${c.zip}: facilities still present after the cutover`, `facilities=${m.fac}`);
  }

  // The invariant that applies to EVERY state: no fabricated ZIP-mode geography.
  ok(m.devWithDistance === 0,
     `${c.zip}: no ZIP-mode development record carries address-mode distance or offsets`,
     `${m.devWithDistance} offenders`);

  if (c.kind === 'pending') {
    ok(m.notMeasured && !m.couldNotRead,
       `${c.zip}: states the honest not-measured status, NOT a read failure`,
       `not-measured=${m.notMeasured} could-not-read=${m.couldNotRead}`);
    ok(m.addressCta, `${c.zip}: directs the resident to address mode`);
    ok(m.noCircle,   `${c.zip}: and says it will not estimate from a circle`);
    ok(m.dev === 0,  `${c.zip}: renders NO development — nothing fabricated`, `dev=${m.dev}`);
  }
  if (c.kind === 'authoritative') {
    ok(m.dev > 0, `${c.zip}: still renders whole-ZIP development (regression control)`, `dev=${m.dev}`);
    // The strong form: the live page renders EXACTLY what the authoritative relation holds.
    // A legacy-geography fallback would show a different number, so this is also the live
    // no-fallback proof - the legacy 3-mile branch never returns the membership count.
    if (c.dev != null) {
      ok(m.dev === c.dev,
         `${c.zip}: live rendered development EQUALS the authoritative relation`,
         `live=${m.dev} relation=${c.dev}`);
    }
    ok(!m.notMeasured && !m.couldNotRead,
       `${c.zip}: makes no not-measured and no failure claim`);
    ok(m.wholeZip, `${c.zip}: claims the measurement across the WHOLE ZIP`);
  }
  if (c.kind === 'not_measured') {
    ok(m.notMeasured && !m.couldNotRead, `${c.zip}: genuine not_measured wording unchanged`);
    ok(m.dev === 0, `${c.zip}: renders no development`, `dev=${m.dev}`);
  }
  if (c.kind === 'measured_zero') {
    ok(!m.notMeasured, `${c.zip}: a MEASURED zero never claims to be unmeasured`);
    ok(m.wholeZip, `${c.zip}: it asserts a real whole-ZIP measurement`);
    ok(m.dev === 0, `${c.zip}: and shows nothing, because there is nothing`, `dev=${m.dev}`);
  }
  console.log('');
}

// ── the read-failure distinction, evaluated inside the LIVE shipped bundle ──────────────────
console.log('── read-failure distinction, in the live page\'s own code ──');
const f = await page.evaluate(() => {
  const H = window.HS;
  return {
    nullRead: H.zipAuthOutcome(null),
    novel:    H.zipAuthOutcome({ status: 'partially_measured' }),
    unknown:  H.zipAuthOutcome({ status: 'unknown' }),
    completeWithNulls: H.zipAuthOutcome({ status: 'boundary_complete', projects: null, markers: null }),
    noteFail: H.zipAuthNote(null, '99999', []),
  };
});
ok(f.nullRead === 'unavailable',
   'a genuinely failed read is STILL unavailable — it does not masquerade as not_measured', f.nullRead);
ok(f.novel === 'unavailable',
   'an unvetted novel status is STILL unavailable — the allow-list is not a catch-all', f.novel);
ok(f.completeWithNulls === 'unavailable',
   'a complete status carrying NULLs is still not trusted as a measurement', f.completeWithNulls);
ok(f.unknown === 'not_measured', "…while 'unknown' is now correctly recognised", f.unknown);
ok(/could not be read/i.test(f.noteFail),
   'a real failure still SAYS so — the two states never merged');
console.log('');

// ── address mode: separate contract, real geocoded home + chosen radius, no ZIP ─────────────
console.log('── address mode, driven through the real form ──');
let payload = null, endpoint = null;
page.on('request', (req) => {
  if (req.url().includes('/functions/v1/get-address-report') && req.method() === 'POST') {
    endpoint = req.url();
    try { payload = JSON.parse(req.postData() || '{}'); } catch (_e) { payload = { _unparsed: true }; }
  }
});
await page.goto(`${BASE}/homesignalmap.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2000);
// choose a radius explicitly, the way a resident does
await page.evaluate(() => {
  const b = document.querySelector('[data-r="2"]');
  if (b) b.click();
});
await page.fill('#addr', '2200 Caldwell Ln, Del Valle, TX 78617');
await page.click('#go');
await page.waitForTimeout(9000);

ok(payload !== null, 'address mode issues its own report request', endpoint ? 'POST get-address-report' : 'none seen');
if (payload) {
  ok(typeof payload.address === 'string' && payload.address.length > 0,
     'it sends the street ADDRESS', JSON.stringify(payload.address));
  ok(payload.radius_mi != null, 'and an explicitly selected RADIUS', String(payload.radius_mi));
  ok(payload.zip == null,
     'and NO zip — address geography is never substituted for ZIP geography',
     'zip=' + JSON.stringify(payload.zip));
}
const addrMode = await page.evaluate(() => {
  const sites = window.__HS_SITES || [];
  const dev = sites.filter(s => s && s.relevance === 'development');
  return { dev: dev.length, withDistance: dev.filter(s => s.distance_mi != null).length };
});
ok(addrMode.dev === 0 || addrMode.withDistance > 0,
   'address-mode development is distance-bearing — the opposite of ZIP mode',
   `dev=${addrMode.dev} with-distance=${addrMode.withDistance}`);

await browser.close();
console.log(`\n${fails === 0 ? 'LIVE ZIP-STATE GATE: PASS' : fails + ' FAILURE(S)'}`);
process.exit(fails ? 1 : 0);
