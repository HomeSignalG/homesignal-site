// FIX 16 — AUTOMATED VERIFICATION MAY NOT CREATE A PREMIUM ACQUISITION LEAD.
// Run: node test/premium-verifier-no-production-write.test.mjs
//
// WHAT WAS BROKEN. test/property-reports-premium.browser.test.mjs §D submitted the
// shared Premium modal with the join RPC UN-intercepted, so every green run of the
// browser job appended a permanent row to public.app_premium_waitlist. Measured
// 2026-09-12: 40 of the table's 44 rows, 4 human, and the pollution GREW with CI
// frequency. Each row's address carried the Date.now() it was created at
// (agent.pr.reports.<epoch>@homesignal.net), and the epoch matched created_at to
// within 0.336s across all 40 — which is how the producer was proven.
//
// WHY THIS FILE PINS THE BEHAVIOUR AND NOT THE STRING. Banning the literal
// "agent.pr.reports." would be satisfied by renaming the variable, and the next
// browser suite to drive the modal would reintroduce the write with a fresh
// identity. The invariant is structural and repo-wide:
//
//   IN ANY BROWSER SUITE, EVERY PREMIUM-MODAL SUBMIT MUST HAVE AN ACTIVE
//   page.route INTERCEPTION OF hs_premium_waitlist_join AT THAT POINT.
//
// A submit is a click on #premiumSubmit, a call to HS.submitWaitlist, or an Enter
// keypress dispatched at #premiumEmail. Interception state is tracked as a
// route/unroute timeline over the file, so a suite that unroutes and then submits
// again is caught exactly like one that never routed at all.
//
// Deliberately NOT asserted here: that the modal works. That is
// property-reports-premium.browser.test.mjs's job, and it still proves the payload,
// the source, the ZIP, the truthful failure state and — in §D2 — that the deployed
// RPC is reachable, using a call its own guard rejects before any INSERT.
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const testDir = join(root, 'test');

let fails = 0;
const ok = (c, name, detail) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name);
  if (!c) { fails++; if (detail !== undefined) console.log('           detail: ' + JSON.stringify(detail)); }
};

console.log('='.repeat(78));
console.log('FIX 16 — NO BROWSER SUITE MAY CREATE A DURABLE PREMIUM ACQUISITION LEAD');
console.log('='.repeat(78));

const JOIN = 'hs_premium_waitlist_join';
// A submit is any of the three ways the shipped modal can be sent. partials/shell.html
// wires BOTH #premiumSubmit's onclick and #premiumEmail's Enter key to HS.submitWaitlist,
// so a suite can reach the RPC without ever touching the button.
//
// ⚠️ THE ENTER CASE MUST BE SCOPED TO #premiumEmail, AND THAT IS NOT A DETAIL.
// A bare press('Enter') matched Map 1's ADDRESS SEARCH field (#addr) in
// map1-address-search-control.browser.test.mjs §4a — a suite with ZERO Premium
// references. An over-flagging gate is how a real violation gets waved through later,
// so an Enter counts only when the nearest preceding fill/focus targeted #premiumEmail
// (or a #premiumEmail locator is chained straight into .press).
const DIRECT_RE = /click\(\s*['"]#premiumSubmit['"]|#premiumSubmit['"]\s*\)\s*\.click\(|HS\.submitWaitlist\s*\(/g;
const ENTER_RE = /press\(\s*['"]Enter['"]/g;
const FIELD_RE = /(?:fill|focus|locator)\(\s*['"](#[A-Za-z][\w-]*)['"]/g;
const CHAINED_ENTER_RE = /['"]#premiumEmail['"]\s*\)\s*\.press\(\s*['"]Enter['"]/g;
const ROUTE_RE = new RegExp('\\.route\\(\\s*[\'"`][^\'"`]*' + JOIN + '[^\'"`]*[\'"`]', 'g');
const UNROUTE_RE = new RegExp('\\.unroute\\(\\s*[\'"`][^\'"`]*' + JOIN + '[^\'"`]*[\'"`]', 'g');

const marks = (src, re) => {
  const out = [];
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(src))) out.push(m.index);
  return out;
};

// Every point in a suite at which the shared Premium modal is actually submitted.
const submitMarks = (src) => {
  const fields = [];
  FIELD_RE.lastIndex = 0;
  let m;
  while ((m = FIELD_RE.exec(src))) fields.push({ i: m.index, sel: m[1] });
  const enterOnPremium = marks(src, ENTER_RE).filter((at) => {
    const prior = fields.filter((f) => f.i < at);
    return prior.length > 0 && prior[prior.length - 1].sel === '#premiumEmail';
  });
  return marks(src, DIRECT_RE)
    .concat(enterOnPremium)
    .concat(marks(src, CHAINED_ENTER_RE))
    .sort((a, b) => a - b);
};

// Is the join RPC intercepted at character offset `at`? True iff the nearest preceding
// route/unroute event is a route.
const interceptedAt = (src, at) => {
  const timeline = marks(src, ROUTE_RE).map((i) => ({ i, on: true }))
    .concat(marks(src, UNROUTE_RE).map((i) => ({ i, on: false })))
    .filter((e) => e.i < at)
    .sort((a, b) => a.i - b.i);
  return timeline.length ? timeline[timeline.length - 1].on : false;
};

const browserSuites = readdirSync(testDir)
  .filter((f) => f.endsWith('.browser.test.mjs'))
  .sort();

ok(browserSuites.length > 0, '0 browser suites were found (the scan is not vacuous)', browserSuites.length);

// ── 1. THE INVARIANT, over every browser suite ────────────────────────────────
let submittingSuites = 0;
let uncovered = [];
for (const f of browserSuites) {
  const src = readFileSync(join(testDir, f), 'utf8');
  const submits = submitMarks(src);
  if (!submits.length) continue;
  submittingSuites++;
  for (const at of submits) {
    if (!interceptedAt(src, at)) uncovered.push({ file: f, line: src.slice(0, at).split('\n').length });
  }
}
ok(submittingSuites > 0, '1a at least one browser suite drives the Premium modal (the pin has a subject)', submittingSuites);
ok(uncovered.length === 0,
  '1b EVERY Premium submit in every browser suite is intercepted — no run can create a durable lead',
  uncovered);

// ── 2. The known producer, named, so a revert is unmistakable ─────────────────
const PRODUCER = 'property-reports-premium.browser.test.mjs';
const prod = readFileSync(join(testDir, PRODUCER), 'utf8');
ok(browserSuites.indexOf(PRODUCER) >= 0, '2a the historical producer is still in the scanned set', PRODUCER);
ok(submitMarks(prod).length >= 2,
  '2b it still exercises BOTH the refused and the accepted submit (interception did not delete a case)',
  submitMarks(prod).length);
// A durable synthetic identity is an address built at run time. Any Date.now()/uuid
// interpolated into an email is that shape, whatever it is called.
const MINTED_EMAIL_RE = /['"`][^'"`\s]*['"`]\s*\+\s*(Date\.now\(\)|[A-Za-z_$][\w$]*Id|randomUUID\(\))[\s\S]{0,40}?@/;
ok(!MINTED_EMAIL_RE.test(prod),
  '2c it no longer mints a per-run identity — nothing durable can be keyed to a run', 
  (prod.match(MINTED_EMAIL_RE) || [''])[0]);

// ── 3. Production is still PROVEN reachable, without writing ──────────────────
// The zero-write probe is what stops §D's interception from becoming a coverage hole.
// Both halves are required: the 22023 assertion AND the PGRST202 control that makes it
// discriminating. A probe with no control is green when the endpoint is wrong.
ok(/22023/.test(prod) && /invalid email/.test(prod),
  '3a the suite still calls the DEPLOYED RPC and asserts its pre-INSERT guard ran');
ok(/PGRST202/.test(prod),
  '3b the wrong-argument-name CONTROL is present, so 22023 discriminates rather than merely passing');
ok(/DID NOT RUN/.test(prod),
  '3c an unreachable endpoint reports as UNRUN, never as a pass (silence is not evidence)');

// ═══ 4. SELF-TEST — the detector is proven in BOTH directions ═══
// A gate that cannot fail is not a gate, and a gate that fires on everything is noise.
// Both are asserted here against synthetic sources, so §1b's green means something.
const VIOLATION = "await page.fill('#premiumEmail', e); await page.click('#premiumSubmit');";
const COVERED = "await page.route('**/rest/v1/rpc/hs_premium_waitlist_join', h);\n"
  + "await page.fill('#premiumEmail', e); await page.click('#premiumSubmit');";
const REVOKED = COVERED + "\nawait page.unroute('**/rest/v1/rpc/hs_premium_waitlist_join');\n"
  + "await page.click('#premiumSubmit');";
const ENTER_VIOLATION = "await page.fill('#premiumEmail', e); await page.keyboard.press('Enter');";
const OTHER_FIELD = "await page.fill('#addr', a); await page.keyboard.press('Enter');";

const anyUncovered = (src) => submitMarks(src).some((at) => !interceptedAt(src, at));
ok(anyUncovered(VIOLATION), '4a a bare submit with no interception is CAUGHT');
ok(!anyUncovered(COVERED), '4b a submit under an active interception is allowed');
ok(anyUncovered(REVOKED), '4c a submit AFTER unroute is CAUGHT (the timeline is honoured)');
ok(anyUncovered(ENTER_VIOLATION), '4d an un-intercepted Enter on #premiumEmail is CAUGHT');
ok(submitMarks(OTHER_FIELD).length === 0,
  '4e OVER-FLAGGING: Enter on another field is NOT a Premium submit (the #addr false positive)');

console.log(fails ? '\n' + fails + ' assertion(s) FAILED.' : '\nAll Fix 16 no-production-write assertions passed.');
process.exit(fails ? 1 : 0);
