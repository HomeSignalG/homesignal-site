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
  // ── controls that predate Phase 2 ─────────────────────────────────────────────────────────
  { zip: '01001', kind: 'authoritative', markers: 34,     projects: 12,    fac: false, tag: 'pre-Phase-2 control' },
  { zip: '19103', kind: 'authoritative', markers: 303,    projects: 303,   fac: false, tag: 'pre-Phase-2 medium, 468 kB before' },
  { zip: '01004', kind: 'not_measured',                                    fac: false, tag: 'NO_ZCTA_IN_TIGER_2025' },
  { zip: '01009', kind: 'measured_zero',                                   fac: false, tag: 'pre-Phase-2 control' },

  // ── the two ZIPs whose live failure opened this unit ──────────────────────────────────────
  { zip: '28428', kind: 'authoritative', markers: 2442,   projects: 2410,  fac: true,  tag: 'DENSE — rendered 798 of 2,442 before' },
  { zip: '30033', kind: 'authoritative', markers: 2261,   projects: 2218,  fac: true,  tag: 'DENSE — "could not be read" before, 17.3 s' },
  { zip: '28456', kind: 'authoritative', markers: 12,     projects: 12,    fac: true,  tag: 'shard 284 small non-zero' },

  // ── EXTREME density. Gate 6: a repair proven only at ~2,400 is not proven. ────────────────
  { zip: '20148', kind: 'authoritative', markers: 13935,  projects: 13934, fac: false, tag: 'EXTREME pre-Phase-2, 13,934 memberships, 21.7 MB before' },
  { zip: '28451', kind: 'authoritative', markers: 14705,  projects: 14636, fac: false, tag: 'EXTREME — densest in production, 14,702 memberships' },

  // ── authoritative MEASURED ZERO ───────────────────────────────────────────────────────────
  { zip: '08005', kind: 'measured_zero',                                   fac: false, tag: 'manifest-gap 442' },
  { zip: '38801', kind: 'measured_zero',                                   fac: true,  tag: 'manifest-gap 442 · 40 facilities' },
  { zip: '30090', kind: 'measured_zero',                                   fac: true,  tag: 'shard 300 Case A · keeps cached area notices' },

  // ── the 3 genuinely pending ZIPs ──────────────────────────────────────────────────────────
  { zip: '99128', kind: 'pending', tag: 'Case C: intersection exists, membership unbuildable' },
  { zip: '94128', kind: 'pending', tag: 'unevaluatable legacy candidates' },
  { zip: '95219', kind: 'pending', tag: '100% unevaluatable candidates - 0 of 2 have geometry' },

  // ── a ZIP repaired 2026-09-06 from NO STATE ROW to not_measured ───────────────────────────
  // The 64 that had no geography-state row at all are now stamped not_measured /
  // NO_ZCTA_IN_TIGER_2025, proven by the pinned TIGER archive read on a runner with a passing
  // positive control. The write was behaviour-neutral by design - the RPC already returned
  // 'unknown' for a ZIP with no row, and the page maps 'unknown' and 'not_measured' to the
  // same honest state. This case is what makes that claim a MEASUREMENT rather than a reading
  // of the code: if the repair had changed what a resident sees, this ZIP would fail here.
  { zip: '10015', kind: 'not_measured', fac: false, tag: 'repaired 2026-09-06 - was stateless, NYC PO-box ZIP with no ZCTA' },
  { zip: '78711', kind: 'not_measured', fac: false, tag: 'repaired 2026-09-06 - Austin PO-box ZIP with no ZCTA' },

  // ── RESIDENTIAL RULE 5 / type_raw control ─────────────────────────────────────────────────
  // 76227 is the sharpest available proof that type_raw reaches Rule 5 in production. 5,388 of
  // its records are denton-county-dev-permits with type_raw 'HOUSE' and name 'HOUSE' - the name
  // carries NO evidence beyond the type, so FAMILY_TYPE_RAW is the ONLY rule that can admit
  // them and it reads type_raw alone. Blank that one field and all 5,388 fall to UNRESOLVED and
  // vanish. The same ZIP carries its own negative controls: 'ADDITION TO HOUSE' and 'GARAGE'
  // must stay dropped, so a pass here cannot be bought by admitting everything.
  { zip: '76227', kind: 'authoritative', markers: 5869, projects: 5708, fac: false, ruleFiveControl: 5000,
    tag: 'DENSE - Rule 5 / type_raw control, 5,388 denton HOUSE permits' },
];

const browser = await chromium.launch();
const page = await browser.newPage();
surfaceBanner('verify-map1-zip-states');
console.log('LIVE Map 1 ZIP-state verification — ' + BASE + '\n');

const facBaseline = {};

for (const c of CASES) {
  // ZIP_AUTH is module-scoped, NOT on window - reading it returned "absent" even on a ZIP
  // that plainly rendered authoritative sites. Intercept the response instead, which is the
  // technique scripts/probe-map1-record-loss.mjs proved works.
  let authPayload = null;
  const grab = async (res) => {
    if (res.url().includes('/rpc/app_zip_projects_markers')) {
      try { authPayload = JSON.parse(await res.text()); } catch (_e) { authPayload = null; }
    }
  };
  page.on('response', grab);
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

  const m = await page.evaluate(({ auth, wantCounterfactual }) => {
    const sites = window.__HS_SITES || [];
    const dev = sites.filter(s => s && s.relevance === 'development');
    const fac = sites.filter(s => s && s.relevance !== 'development');
    const txt = document.body.innerText || '';
    return {
      dev: dev.length, fac: fac.length,
      // WHICH LAYER each development record came from. `authoritative` is NOT propagated
      // into __HS_SITES - reading it returned 0 on every page including ones provably serving
      // authoritative data. `zip_authoritative` is the flag zipAuthSiteFromMarker actually
      // sets, and it is the correct discriminator.
      devAuthoritative: dev.filter(s => s.zip_authoritative === true).length,
      devCached:        dev.filter(s => s.zip_authoritative !== true).length,
      // Distance/offsets are forbidden on AUTHORITATIVE ZIP-mode records. Cached area-scope
      // civic notices legitimately carry synthetic offsets (engine v18 anchors them at the
      // report centroid), so they are counted separately rather than failed.
      // Cached development that is POINT-scope. This is the one that matters on an
      // unmeasured ZIP: a point inside a ZIP nobody has measured is a centroid-radius
      // approximation wearing the clothes of a measurement, and zipAuthMergeSites drops it
      // unconditionally. Area-scope jurisdiction notices legitimately survive - they make no
      // whole-ZIP claim - so counting them as a violation would fail a healthy page.
      devPoint: dev.filter(s => s && s.scope === 'point').length,
      authWithDistance: dev.filter(s => s.zip_authoritative === true &&
                          (s.distance_mi != null || s.e != null || s.n != null)).length,
      // The page's own project count - one road project drawn as 9 markers is ONE project.
      projectCount: (window.HS && HS.zipAuthProjectCount) ? HS.zipAuthProjectCount(dev) : -1,
      // RULE 5 ACCOUNTING. zipAuthSiteFromMarker drops records the founder's residential
      // qualification rule rejects (routine work on an existing residential property is not
      // new residential DEVELOPMENT). Those are legitimately absent, so "delivered == relation"
      // is the wrong identity. The right one is: delivered + rule-5 dropped == relation, with
      // NOTHING unexplained. Computed with the page's OWN shipped gate, never a copy of it.
      ruleFive: (function () {
        const a = auth;
        if (!a || !Array.isArray(a.markers) || !Array.isArray(a.projects) || !window.HS) return null;
        const byRef = Object.create(null);
        a.projects.forEach(p => { if (p && p.project_ref && !byRef[p.project_ref]) byRef[p.project_ref] = p; });
        // FOUR OUTCOMES, and only one of them is a defect:
        //   delivered        drawn on the map
        //   droppedByRuleFive  an INTENTIONAL QUALIFICATION EXCLUSION - the founder's residential
        //                    rule rejecting routine work on an existing residential property
        //   staleMembership  an explicitly PROVEN UNRENDERABLE-DATA EXCEPTION - authoritative
        //                    geography holds this source_key but app_projects has no row for it
        //                    at all, so there is no record to draw and drawing one would be
        //                    fabrication. Measured nationally 2026-09-06: 16,513 membership rows
        //                    across 988 ZIPs, against 901,465 membership rows in total (1.83%).
        //                    It is REPORTED, never asserted to zero - it is real and sized.
        //   unexplained      everything else, and it must be 0
        let delivered = 0, droppedByRuleFive = 0, staleMembership = 0, unexplained = 0;
        a.markers.forEach(m => {
          const proj = byRef[m.project_ref];
          if (!proj) { staleMembership++; return; }
          if (HS.zipAuthSiteFromMarker(m, proj)) { delivered++; return; }
          // rebuild what the site WOULD have been, then ask the shipped gate if it is the reason
          const hasBasis = typeof m.lat === 'number' && typeof m.lng === 'number';
          if (hasBasis && HS.residentialGateDrops) {
            const probe = { use_type: proj.type || '', label: proj.name || '' };
            if (HS.residentialGateDrops(probe, proj)) { droppedByRuleFive++; return; }
          }
          unexplained++;
        });
        // TYPE_RAW COUNTERFACTUAL. Rule 5 reads project.type_raw inside HS.residentialActivity,
        // one call deeper than the site builder - which is how a payload narrowing dropped it
        // on 2026-09-06 and shipped Rule 5 with half its evidence for ~15 hours, silently,
        // because a rejected record is DROPPED rather than marked. Re-running the SHIPPED gate
        // over the SAME markers with that one field blanked measures whether it is still
        // load-bearing IN PRODUCTION. `deliveredNoTypeRaw` materially below `delivered` is the
        // proof; equality would mean the field is not reaching the rule.
        // Only for the case that asks for it: on an extreme ZIP this doubles ~14,000 runs of
        // the full classifier for a number nothing reads, which is work that buys nothing.
        let deliveredNoTypeRaw = null, projectsWithTypeRaw = null;
        if (wantCounterfactual) {
          deliveredNoTypeRaw = 0; projectsWithTypeRaw = 0;
          a.projects.forEach(p => { if (p && typeof p.type_raw === 'string' && p.type_raw) projectsWithTypeRaw++; });
          a.markers.forEach(m => {
            const proj = byRef[m.project_ref];
            if (!proj) return;
            const blanked = Object.assign({}, proj); delete blanked.type_raw;
            if (HS.zipAuthSiteFromMarker(m, blanked)) deliveredNoTypeRaw++;
          });
        }
        return { relation: a.markers.length, membership: a.membership_count,
                 hydrated: a.projects.length,
                 delivered, droppedByRuleFive, staleMembership, unexplained,
                 deliveredNoTypeRaw, projectsWithTypeRaw };
      })(),
      // ZIP mode must never carry address-mode geometry on a development record
      devWithDistance: dev.filter(s => s.distance_mi != null || s.e != null || s.n != null).length,
      notMeasured: /not measured yet/i.test(txt),
      couldNotRead: /could not be read/i.test(txt),
      addressCta:  /street address/i.test(txt),
      wholeZip:    /whole of ZIP|whole ZIP/i.test(txt),
      noCircle:    /will not estimate it from a circle/i.test(txt),
    };
  }, { auth: authPayload, wantCounterfactual: !!c.ruleFiveControl });
  page.off('response', grab);
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
  ok(m.authWithDistance === 0,
     `${c.zip}: no AUTHORITATIVE ZIP-mode record carries address-mode distance or offsets`,
     `${m.authWithDistance} offenders of ${m.devAuthoritative} authoritative`);

  if (c.kind === 'pending') {
    ok(m.notMeasured && !m.couldNotRead,
       `${c.zip}: states the honest not-measured status, NOT a read failure`,
       `not-measured=${m.notMeasured} could-not-read=${m.couldNotRead}`);
    ok(m.addressCta, `${c.zip}: directs the resident to address mode`);
    ok(m.noCircle,   `${c.zip}: and says it will not estimate from a circle`);
    // WHAT THE INVARIANT ACTUALLY SAYS, and 95219 is why this had to be rewritten. Its cached
    // report holds 5 development sites - 3 area-scope and 2 point-scope - and the page renders
    // 3. zipAuthMergeSites dropped BOTH point-scope records (a point inside an unmeasured ZIP
    // is a centroid-radius approximation dressed as a measurement) and kept the 3 jurisdiction
    // notices, which claim nothing about the ZIP. `dev === 0` passed only because the two
    // pending ZIPs sampled first happened to carry no area notices; it was a property of the
    // SAMPLE, not of the rule, and it failed the moment a third pending ZIP was added.
    ok(m.devAuthoritative === 0, `${c.zip}: renders NO AUTHORITATIVE development — nothing fabricated`,
       `authoritative=${m.devAuthoritative} of dev=${m.dev}`);
    ok(m.devPoint === 0, `${c.zip}: renders NO POINT-scope development — no centroid-radius stand-in`,
       `point-scope=${m.devPoint} of dev=${m.dev}`);
  }
  if (c.kind === 'authoritative') {
    ok(m.dev > 0, `${c.zip}: still renders whole-ZIP development (regression control)`, `dev=${m.dev}`);
    // The strong form: the live page renders EXACTLY what the authoritative relation holds.
    // A legacy-geography fallback would show a different number, so this is also the live
    // no-fallback proof - the legacy 3-mile branch never returns the membership count.
    // EVERY authoritative marker is accounted for: delivered, or dropped by the shipped
    // Rule 5 gate. Anything else is silent truncation and fails.
    if (m.ruleFive) {
      const r = m.ruleFive;
      ok(r.unexplained === 0,
         `${c.zip}: every authoritative marker accounted for — 0 unexplained losses`,
         `relation=${r.relation} delivered=${r.delivered} rule5-dropped=${r.droppedByRuleFive} `
         + `stale-membership=${r.staleMembership} UNEXPLAINED=${r.unexplained}`);
      // THE FOUNDER'S ACCOUNTING IDENTITY, in full:
      //   raw authoritative relation
      //     − intentional qualification exclusions (Rule 5)
      //     − explicitly proven unrenderable-data exceptions (stale membership)
      //     = the qualifying authoritative population that is delivered
      ok(r.delivered + r.droppedByRuleFive + r.staleMembership === r.relation,
         `${c.zip}: delivered + rule-5 dropped + stale-membership == the authoritative relation`,
         `${r.delivered} + ${r.droppedByRuleFive} + ${r.staleMembership} = `
         + `${r.delivered + r.droppedByRuleFive + r.staleMembership} vs ${r.relation}`);
      // The stale class must be attributable to the PRODUCER, not to the transport: a marker
      // with no project is only excusable when the RPC itself hydrated fewer source_keys than
      // geography holds. If those two ever disagree, records went missing between them.
      ok(r.membership == null || r.hydrated == null
         || r.staleMembership <= (r.membership - r.hydrated) + (r.relation - r.membership),
         `${c.zip}: stale markers are explained by the producer, not by a lost payload`,
         `membership=${r.membership} hydrated=${r.hydrated} markers=${r.relation} `
         + `stale=${r.staleMembership}`);
      ok(m.devAuthoritative === r.delivered,
         `${c.zip}: everything the gate admitted actually reached the rendered set`,
         `rendered=${m.devAuthoritative} admitted=${r.delivered}`);
      // GATE 8 - type_raw reaches Rule 5, proven live rather than read off the SQL.
      if (c.ruleFiveControl) {
        ok(r.projectsWithTypeRaw > 0,
           `${c.zip}: the live RPC ships type_raw on the project objects`,
           `${r.projectsWithTypeRaw} of ${r.hydrated} carry a non-empty type_raw`);
        ok(r.deliveredNoTypeRaw < r.delivered,
           `${c.zip}: type_raw is LOAD-BEARING — blanking it in the shipped gate loses records`,
           `delivered=${r.delivered} vs deliveredWithoutTypeRaw=${r.deliveredNoTypeRaw} `
           + `(loss ${r.delivered - r.deliveredNoTypeRaw})`);
        ok(r.delivered - r.deliveredNoTypeRaw >= c.ruleFiveControl,
           `${c.zip}: the loss is the whole FAMILY_TYPE_RAW population, not a rounding effect`,
           `expected at least ${c.ruleFiveControl}, measured ${r.delivered - r.deliveredNoTypeRaw}`);
      }
    } else if (c.markers != null) {
      ok(false, `${c.zip}: could not read the authoritative payload to account for it`, 'ZIP_AUTH absent');
    }
    ok(!m.notMeasured && !m.couldNotRead,
       `${c.zip}: makes no not-measured and no failure claim`);
    ok(m.wholeZip, `${c.zip}: claims the measurement across the WHOLE ZIP`);
  }
  if (c.kind === 'not_measured') {
    ok(m.notMeasured && !m.couldNotRead, `${c.zip}: genuine not_measured wording unchanged`);
    ok(m.devAuthoritative === 0, `${c.zip}: renders no AUTHORITATIVE development`,
       `authoritative=${m.devAuthoritative}`);
    ok(m.devPoint === 0, `${c.zip}: renders no POINT-scope development — no centroid-radius stand-in`,
       `point-scope=${m.devPoint} of dev=${m.dev}`);
  }
  if (c.kind === 'measured_zero') {
    ok(!m.notMeasured, `${c.zip}: a MEASURED zero never claims to be unmeasured`);
    ok(m.wholeZip, `${c.zip}: it asserts a real whole-ZIP measurement`);
    ok(m.devAuthoritative === 0,
       `${c.zip}: zero AUTHORITATIVE development, because the measurement found none`,
       `authoritative=${m.devAuthoritative} (cached area notices ${m.devCached} may remain)`);
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
// CLEAR THE GLOBAL, THEN REQUIRE IT BACK. Without this the address-mode assertion reads
// whatever the LAST ZIP case left behind: it passed as `dev=0 with-distance=0` for as long as
// the final case was a ZIP that renders nothing, which is a vacuous pass - it asserted that a
// measurement which had not happened carried no distances. Adding a dense final case exposed
// it as `dev=5852`, exactly the previous page's count. An instrument must prove it ran.
await page.evaluate(() => { window.__HS_SITES = undefined; });
await page.waitForTimeout(2000);
// choose a radius explicitly, the way a resident does
await page.evaluate(() => {
  const b = document.querySelector('[data-r="2"]');
  if (b) b.click();
});
await page.fill('#addr', '2200 Caldwell Ln, Del Valle, TX 78617');
await page.click('#go');
await page.waitForFunction(() => window.__HS_SITES !== undefined, { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(3000);

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
  const sites = window.__HS_SITES;
  if (sites === undefined) return { rendered: false, dev: 0, withDistance: 0, auth: 0 };
  const dev = (sites || []).filter(s => s && s.relevance === 'development');
  return { rendered: true, dev: dev.length,
           withDistance: dev.filter(s => s.distance_mi != null).length,
           auth: dev.filter(s => s.zip_authoritative === true).length };
});
ok(addrMode.rendered, 'address mode actually rendered — the measurement is not of a stale page',
   addrMode.rendered ? 'window.__HS_SITES repopulated' : 'window.__HS_SITES never came back');
ok(addrMode.auth === 0,
   'address mode carries NO ZIP-authoritative record — the two modes are never conflated',
   `zip_authoritative=${addrMode.auth}`);
ok(addrMode.dev === 0 || addrMode.withDistance > 0,
   'address-mode development is distance-bearing — the opposite of ZIP mode',
   `dev=${addrMode.dev} with-distance=${addrMode.withDistance}`);

await browser.close();
console.log(`\n${fails === 0 ? 'LIVE ZIP-STATE GATE: PASS' : fails + ' FAILURE(S)'}`);
process.exit(fails ? 1 : 0);
