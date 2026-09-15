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
// graduating (exactly what happened to 08005) costs coverage nothing. Measured 2026-09-15:
// 12,013 of 12,722 canonical ZIPs are boundary_complete, 706 not_measured and just 3 unknown —
// so `pending` is the scarce state and carries all three of its live members.
const CANDIDATES = [
  '94128', '95219', '99128',   // unknown  -> pending        (all 3 that exist)
  '01004',                     // not_measured
  '01001',                     // boundary_complete, projects > 0 -> authoritative
  '01009', '08005',            // boundary_complete, projects = 0 -> measured_zero
];

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

// One representative per state. Browsing one ZIP per kind keeps this gate the same size it has
// always been; the extra candidates exist for redundancy, not to lengthen the run.
const CASES = KINDS
  .map((kind) => {
    const hit = resolved.find((r) => r.kind === kind);
    return hit ? { zip: hit.zip, kind } : { zip: null, kind };
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

for (const c of CASES.filter((c) => c.zip)) {
  await page.goto(`${BASE}/homesignalmap.html?zip=${c.zip}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__HS_SITES !== undefined, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(3000);

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
      couldNotRead: /could not be read/i.test(txt),
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
