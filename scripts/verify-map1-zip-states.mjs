// LIVE production verification of Map 1's ZIP-mode geography contract, across all three
// geography states, plus the address-mode separation.
//
// Every control ZIP's producer status is asserted in this same run rather than assumed, and
// the two mode contracts are checked SEPARATELY - ZIP mode must carry no distance and no
// radius semantics, address mode must send a real geocoded home and a chosen radius.
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { surfaceBanner } from './lib/surface-banner.mjs';
import { kindFromProducer, ZIP_STATE_KINDS } from './lib/zip-state-kind.mjs';

const BASE = process.env.SITE_BASE || 'https://homesignal.net';
let fails = 0;
const ok = (c, name, detail) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name + (detail ? '  [' + detail + ']' : ''));
  if (!c) fails++;
};

// ── THE KIND IS RESOLVED, NEVER HARDCODED ───────────────────────────────────────────────────
// This file's own header promises "every control ZIP's producer status is asserted in this same
// run rather than assumed". It was not: the four kinds were a literal list, captured once and
// commented "Verified against production before this run" — a snapshot presented as a standing
// fact. A ZIP's geography state is a moving target, and one of them moved.
//
// WHAT IT COST, measured 2026-09-15: ZIP 08005 was pinned as `pending`. The producer now reports
// `boundary_complete` with project_count 0, i.e. a MEASURED ZERO. The page correctly stopped
// saying "not measured yet" and this gate called that a failure — for nine days, across nine
// unrelated branches. Two red assertions, both false, on a page that was right. A gate that
// cries wolf is a gate that gets ignored, which is the real damage.
//
// THE FIX IS NOT A NEW FIXTURE. Re-pinning 08005 to `measured_zero` would buy time until the
// next ZIP moves and reproduce this exactly. The kind is now READ from the same producer the
// page reads, per run, and the assertion block is selected from that. The candidate list below
// only has to supply a ZIP in each state — it can never again disagree with production about
// what state a ZIP is IN.
const PRODUCER_RPC = 'app_zip_projects_markers';

// CANDIDATES, not fixtures. Deliberately MORE than four and redundant per state, so one ZIP
// graduating (exactly what happened to 08005) costs coverage nothing.
const CANDIDATES = [
  '94128', '95219', '99128',   // the fix-3 ZIPs: once 'unknown', now measured (see FORMER_GAP)
  '01004',                     // not_measured
  '01001',                     // boundary_complete, projects > 0 -> authoritative
  '01009', '08005',            // boundary_complete, projects = 0 -> measured_zero
];

// ── `pending` HAS NO LIVE MEMBER, ON PURPOSE (fix 3, 2026-09-29) ─────────────────────────────
// Measured 2026-09-15: 12,013 boundary_complete + 706 not_measured + 3 unknown. The 3 were
// 94128 / 95219 / 99128: each has a Census ZCTA boundary and had NO row in the generation that
// served until 2026-09-27, because each is the only canonical ZIP of its ZIP3 prefix and the
// legacy build wrote only prefixes that had a shard. Every national generation since carries
// all 12,722 rows (12,016 + 706), and READY / ACTIVATE refuse a generation that misses one or
// labels one against its boundary. So a live `pending` ZIP is now a REGRESSION, not coverage:
//   * FORMER_GAP must each resolve to a MEASURED state; one reading `pending` fails loudly;
//   * the page's pending contract is still exercised, on the LIVE page, by handing it the
//     producer's exact 'unknown' answer (SYNTHETIC_PENDING below). Every other state still
//     needs a real live member, or COVERAGE fails as before.
const FORMER_GAP = ['94128', '95219', '99128'];
const SYNTHETIC_PENDING_KIND = 'pending';
// public.app_zip_projects_markers' reply when a ZIP has no serving status row, read from the
// live function body 2026-09-29: jsonb_build_object('mode','authoritative','zip',p_zip,
// 'status',coalesce(v_status,'unknown'),'projects',null,'markers',null).
const unknownPayload = (zip) => ({ mode: 'authoritative', zip, status: 'unknown', projects: null, markers: null });

const KINDS = ZIP_STATE_KINDS;

// Read the Supabase URL + anon key out of the shipped page, so this gate cannot drift from what
// the page actually calls. Same helper shape as scripts/verify-development.mjs.
const pageHtml = readFileSync(new URL('../homesignalmap.html', import.meta.url), 'utf8');
const grabVar = (name) => {
  const m = pageHtml.match(new RegExp(`var ${name}\\s*=\\s*["']([^"']+)["']`));
  if (!m) throw new Error(`Could not read ${name} from homesignalmap.html`);
  return m[1];
};
const APIKEY = grabVar('APIKEY');
const SUPABASE_URL = grabVar('ENDPOINT').replace(/\/functions\/v1\/.*$/, '');

async function resolveKind(zip) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${PRODUCER_RPC}`, {
    method: 'POST',
    headers: { apikey: APIKEY, Authorization: `Bearer ${APIKEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_zip: zip, p_kind: 'development', p_authoritative: true }),
  });
  if (!res.ok) return { zip, kind: null, why: `producer read ${res.status}` };
  const auth = await res.json().catch(() => null);
  const kind = kindFromProducer(auth);
  return { zip, kind, why: kind ? `status=${auth && auth.status} projects=${auth && auth.project_count}`
                                : `unresolvable payload (status=${auth && auth.status})` };
}

surfaceBanner('verify-map1-zip-states');
console.log('LIVE Map 1 ZIP-state verification — ' + BASE + '\n');

// ── Resolve every candidate against the producer BEFORE opening a browser ───────────────────
console.log('── producer states, read live (the kinds below are measured, not assumed) ──');
const resolved = [];
for (const zip of CANDIDATES) resolved.push(await resolveKind(zip));
for (const r of resolved) console.log(`   ${r.zip} -> ${r.kind || 'UNRESOLVED'}  [${r.why}]`);

const unresolved = resolved.filter((r) => !r.kind);
ok(unresolved.length === 0,
   'every candidate ZIP resolved to a known producer state',
   unresolved.length ? unresolved.map((r) => `${r.zip}: ${r.why}`).join('; ') : 'all resolved');

const gapNow = resolved.filter((r) => FORMER_GAP.includes(r.zip));
ok(gapNow.length === FORMER_GAP.length && gapNow.every((r) => r.kind && r.kind !== 'pending'),
   'the three ZIPs that once had NO serving row (fix 3) now resolve to a MEASURED state',
   gapNow.map((r) => `${r.zip}=${r.kind || 'UNRESOLVED'}`).join(' '));

// One representative per state. Browsing one ZIP per kind keeps this gate the same size it has
// always been; the extra candidates exist for redundancy, not to lengthen the run.
const CASES = KINDS
  .map((kind) => {
    const hit = resolved.find((r) => r.kind === kind);
    if (hit) return { zip: hit.zip, kind };
    // No live member. Only `pending` may be exercised synthetically (see FORMER_GAP above), on a
    // real ZIP whose page otherwise loads normally: a MEASURED candidate, never a guess.
    if (kind === SYNTHETIC_PENDING_KIND) {
      const host = resolved.find((r) => r.kind === 'measured_zero') || resolved.find((r) => r.kind === 'authoritative');
      if (host) return { zip: host.zip, kind, synthetic: true };
    }
    return { zip: null, kind };
  });

// ⚠️ COVERAGE IS ASSERTED, because a state with no representative would otherwise make this
// gate SILENTLY stop testing it — zero assertions and a green run, which is the vacuous-pass
// shape this repo refuses everywhere else. The message says COVERAGE so it can never be
// misread as the page being broken: those are different failures and they need different fixes.
for (const c of CASES) {
  if (!c.zip) {
    ok(false, `COVERAGE: no candidate ZIP is currently in the '${c.kind}' state`,
       'add one to CANDIDATES — the page contract for this state went UNTESTED this run');
  }
}
console.log('');

const browser = await chromium.launch();
const page = await browser.newPage();

const facBaseline = {};

// ── READINESS: WAIT FOR THE RENDER, NOT FOR A VARIABLE TO EXIST ─────────────────────────────
// `__HS_SITES !== undefined` + a fixed 3s was the wrong condition, and it produced FALSE REDS
// on exactly the ZIPs with the most data. Measured in production 2026-09-15, tracing every
// write to __HS_SITES with a property setter (one write per load, from render() at
// homesignalmap.html:2400):
//
//     01001  write lands at 4105 / 4734 / 5233 ms      01004  at 701 / 706 / 927 ms
//     01009  write lands at 4376 / 4858 / 5343 ms      94128  at 681 / 736 / 892 ms
//
// The gate measured at ~3000 ms, so for the two heavy ZIPs it read BEFORE the only write.
// `window.__HS_SITES || []` then turned "not there yet" into an empty array, and an
// unfinished page was reported as a page that renders nothing. Reproduced 6/6 on both a
// reused page and a fresh context — deterministic, never a flake.
//
// ⚠️ THIS IS NOT "WAIT LONGER". A bigger sleep would still be a guess, and the whole failure
// class is guessing. It waits for the render to SETTLE and says so if it never does. A
// genuinely empty ZIP settles at 0 immediately and every assertion still runs against it, so
// nothing is masked — which was the live question before this was measured.
async function waitForRenderSettled(page, { quietMs = 1500, timeoutMs = 45000 } = {}) {
  const t0 = Date.now();
  let last = null, lastChange = Date.now();
  for (;;) {
    const n = await page.evaluate(() => Array.isArray(window.__HS_SITES) ? window.__HS_SITES.length : -1);
    if (n !== last) { last = n; lastChange = Date.now(); }
    else if (n >= 0 && Date.now() - lastChange >= quietMs) return { settled: true, n, ms: Date.now() - t0 };
    if (Date.now() - t0 >= timeoutMs) return { settled: false, n, ms: Date.now() - t0 };
    await page.waitForTimeout(150);
  }
}

for (const c of CASES.filter((c) => c.zip)) {
  // SYNTHETIC pending: only the development geography answer is replaced, and only for this
  // page load. Facilities, notices and the page's own code are all live.
  let faked = 0;
  if (c.synthetic) {
    console.log(`── ${c.zip}: no live ZIP is pending (expected since fix 3) - exercising the pending ` +
                `contract by handing the LIVE page the producer's 'unknown' answer`);
    await page.route('**/rest/v1/rpc/app_zip_projects_markers', async (route) => {
      let body = null;
      try { body = JSON.parse(route.request().postData() || 'null'); } catch (e) { body = null; }
      if (body && body.p_kind === 'development' && body.p_zip === c.zip) {
        faked++;
        return route.fulfill({ status: 200, contentType: 'application/json',
                               body: JSON.stringify(unknownPayload(c.zip)) });
      }
      return route.continue();
    });
  }
  await page.goto(`${BASE}/homesignalmap.html?zip=${c.zip}`, { waitUntil: 'domcontentloaded' });
  const settle = await waitForRenderSettled(page);
  ok(settle.settled, `${c.zip}: the page finished rendering`,
     settle.settled ? `settled at ${settle.ms}ms with ${settle.n} site(s)`
                    : `NEVER SETTLED after ${settle.ms}ms — nothing below was measured on a finished page`);
  if (c.synthetic) {
    await page.unroute('**/rest/v1/rpc/app_zip_projects_markers');
    // An instrument must prove it ran: a fake the page never asked for would leave the REAL
    // measured answer on screen and score the pending contract against it.
    ok(faked > 0, `${c.zip}: SYNTHETIC pending - the page received the producer's 'unknown' answer`,
       `development geography requests replaced: ${faked}`);
    if (!faked) { console.log(''); continue; }
  }
  if (!settle.settled) { console.log(''); continue; }

  const m = await page.evaluate(() => {
    const sites = window.__HS_SITES || [];
    const dev = sites.filter(s => s && s.relevance === 'development');
    const fac = sites.filter(s => s && s.relevance !== 'development');
    const txt = document.body.innerText || '';
    // The address control's own placeholder is part of what the page says, and since the
    // hero's helper sentence was removed it is where the direction now LIVES. innerText
    // cannot see a placeholder attribute, so it is read explicitly and tested with the
    // SAME pattern — widening the input, never the pattern.
    const ph = (document.getElementById('addr') || {}).placeholder || '';
    return {
      dev: dev.length, fac: fac.length,
      // ZIP mode must never carry address-mode geometry on a development record
      devWithDistance: dev.filter(s => s.distance_mi != null || s.e != null || s.n != null).length,
      notMeasured: /not measured yet/i.test(txt),
      // Founder wording 2026-10-02: a ZIP with no Census area (producer 'not_measured') says so,
      // in the sentence pinned whole by test/zip-no-mapped-area-copy.test.mjs. Only a ZIP waiting
      // on a build (producer 'unknown', the synthetic pending case) still says "not measured yet".
      noMappedArea: /has no mapped area\. The Census does not draw a boundary for this ZIP code/.test(txt),
      couldNotRead: /could not be read/i.test(txt),
      // THE PAGE HAS TWO DIFFERENT FAILURE SENTENCES AND THIS GATE ONLY KNEW ONE.
      // `could not be read` is lib/zip-authoritative.js::zipAuthNote — a statement about the
      // authoritative READ. homesignalmap.html's outer .catch() says "Couldn't load ZIP N."
      // instead, which matches neither existing pattern, so a page that honestly reported a
      // failed load was scored as a page that violated its contract. Different failures,
      // different fixes; pinned against drift by test/map1-zip-state-kind-resolution.test.mjs,
      // which asserts this regex matches the literal string in the shipped page.
      loadFailed: /Couldn't load ZIP/i.test(txt),
      // Matched on the address-mode DIRECTION, never on a literal. History: the phrase
      // 'street address' named a shape the geocoder never required and left the ZIP-mode hint in
      // #1079, which reddened this check on deploy; the replacement spanned the wordings known at
      // the time and #1086 then reddened it again with 'Enter A street address to switch…'. An
      // article list is the wrong shape for this — the guarantee is that the page tells the
      // resident to ENTER something, so the pattern is anchored on the imperative verb and the
      // noun, with whatever wording sits between them.
      //
      // Anchoring is load-bearing in BOTH directions. A bare /address/i would be satisfied by the
      // ZIP clarifier 'The entire ZIP area — not only projects near one address.', which is not a
      // CTA — the guard would then pass on a page whose CTA had been deleted. [^.\n]{0,24} keeps
      // the match inside one sentence and one text node, so a stray 'Enter…' elsewhere on the
      // page cannot reach across to an unrelated 'address'.
      //
      // THE VERB SET IS THE THIRD COPY EDIT TO REACH THIS LINE, and the reason is always the
      // same: the guarantee is 'the page directs the resident to the address control', while the
      // regex can only enumerate ways of saying it. #1088 replaced a literal-phrase list with
      // verb+noun for exactly this reason; 'choose'/'select'/'pick' are the same imperative in
      // the same guarantee and belong in the same set.
      //
      // ⚠️ WHAT IS READ CHANGED, THE PATTERN DID NOT. The hero's helper sentence ('Choose an
      // address from the suggestions, press Enter, or click search.') was removed — the field
      // now carries its own instruction in a complete example PLACEHOLDER, which
      // document.body.innerText cannot see. So the same pattern is applied to the placeholder
      // as well as the body text. Without this the guard would have gone red on every pending
      // ZIP the moment the sentence left, reporting a missing CTA on a page that has one.
      //
      // NOT A LOOSENING — every negative #1088 proved stays negative, because none of them
      // contains ANY of these verbs: the ZIP clarifier, the static Box Elder hint, and a note
      // whose CTA sentence has been deleted all still fail. Widening the INPUT cannot admit
      // them: they are body text, and the body text is still tested by the same pattern.
      // Proven in both directions offline by test/address-cta-guard.test.mjs, which also pins
      // this pattern IDENTICAL to the copy in user-journey 14c — #1088 asked for that and
      // nothing enforced it.
      addressCta:  /\b(enter|type|search|choose|select|pick)\b[^.\n]{0,24}\baddress\b/i.test(txt + '\n' + ph),
      wholeZip:    /whole of ZIP|whole ZIP/i.test(txt),
      noCircle:    /will not estimate it from a circle/i.test(txt),
    };
  });
  facBaseline[c.zip] = m.fac;

  console.log(`── ${c.zip} (${c.kind}) · development=${m.dev} · facilities/other=${m.fac}`);

  // A page that never loaded cannot tell you anything about its contract. Reporting one as a
  // contract violation is how a transport problem gets filed as a product bug — so it is its
  // own failure, named INFRASTRUCTURE, and the state assertions below are SKIPPED rather than
  // run against a page that has nothing on it.
  if (m.loadFailed) {
    ok(false, `INFRASTRUCTURE: ${c.zip} reported a failed load — NOTHING was verified for it`,
       'the page said "Couldn\'t load ZIP"; this is not a contract result');
    console.log('');
    continue;
  }

  // The invariant that applies to EVERY state: no fabricated ZIP-mode geography.
  ok(m.devWithDistance === 0,
     `${c.zip}: no ZIP-mode development record carries address-mode distance or offsets`,
     `${m.devWithDistance} offenders`);

  if (c.kind === 'pending') {
    ok(m.notMeasured && !m.noMappedArea && !m.couldNotRead,
       `${c.zip}: states the honest not-measured status, NOT a read failure or a missing area`,
       `not-measured=${m.notMeasured} could-not-read=${m.couldNotRead}`);
    ok(m.addressCta, `${c.zip}: directs the resident to address mode`);
    ok(m.noCircle,   `${c.zip}: and says it will not estimate from a circle`);
    ok(m.dev === 0,  `${c.zip}: renders NO development — nothing fabricated`, `dev=${m.dev}`);
  }
  if (c.kind === 'authoritative') {
    ok(m.dev > 0, `${c.zip}: still renders whole-ZIP development (regression control)`, `dev=${m.dev}`);
    ok(!m.notMeasured && !m.noMappedArea && !m.couldNotRead,
       `${c.zip}: makes no not-measured, no-area and no failure claim`);
    ok(m.wholeZip, `${c.zip}: claims the measurement across the WHOLE ZIP`);
  }
  if (c.kind === 'not_measured') {
    ok(m.noMappedArea && !m.notMeasured && !m.couldNotRead,
       `${c.zip}: says it has no mapped area (founder wording), never "not measured yet"`,
       `no-mapped-area=${m.noMappedArea} not-measured=${m.notMeasured} could-not-read=${m.couldNotRead}`);
    ok(m.addressCta, `${c.zip}: directs the resident to address mode`);
    ok(m.dev === 0, `${c.zip}: renders no development`, `dev=${m.dev}`);
  }
  if (c.kind === 'measured_zero') {
    ok(!m.notMeasured && !m.noMappedArea, `${c.zip}: a MEASURED zero never claims to be unmeasured or unmapped`);
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
