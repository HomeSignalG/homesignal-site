// THE ATTRIBUTION CONTRACT, PINNED — offline.
// Run: node test/acquisition-attribution.test.mjs
//
// WHY THIS FILE EXISTS. Measured 2026-09-15, before the change it guards:
//
//   1. events.js shipped in the Pages artifact (scripts/stage_site.py) and NO DOCUMENT
//      LOADED IT. window.hsLogEvent was therefore undefined, every call site was guarded
//      with `typeof window.hsLogEvent === 'function'`, and all three no-opped in silence.
//      The events table's newest row was 2026-07-12 — 65 days stale.
//   2. shell.js::captureReferral captured a first touch correctly and its own comment
//      promised "a separate, schema-gated step stamps it onto the conversion row". That
//      step did not exist for the account path: HS.authSubmit never read it. Control:
//      users.referral_source non-null on 5 of 11 rows, every one 'bluesky'/'test-manual'.
//   3. captureReferral read utm_source/medium/campaign and NOT utm_content, so every
//      social conversion collapsed into one campaign bucket with no post distinguishable
//      from another.
//   4. homesignalmap.html contained ZERO calls to HS.openAuth / HS.openPremiumModal /
//      HS.openLoc. Control: `grep -c` returned 0, 0, 0 across 299 KB.
//
// EVERY ONE OF THOSE IS INVISIBLE TO A TEST THAT READS SOURCE FOR THE HAPPY PATH — they
// are all ABSENCES. So §1-§5 and §7-§8 pin the wiring structurally (an absence is exactly
// what a structural pin is for), §6 executes the SHIPPED paintCtaBand against a stub DOM,
// and §9 proves the whole file is load-bearing by mutating the shipped source and
// requiring each mutation to fail.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SHELL = readFileSync(join(root, 'shell.js'), 'utf8');
const MAP = readFileSync(join(root, 'homesignalmap.html'), 'utf8');
const EVENTS = readFileSync(join(root, 'events.js'), 'utf8');
const STAGE = readFileSync(join(root, 'scripts/stage_site.py'), 'utf8');

let fails = 0;
const ok = (c, name, detail) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name);
  if (!c) { fails++; if (detail !== undefined) console.log('           detail: ' + JSON.stringify(detail)); }
};
const section = (s) => console.log('\n' + s);

// Index of a substring, or -1. Used for ORDERING assertions, where "both present" is not
// the same claim as "present in this order" and only the second one is load-bearing.
const at = (hay, needle) => hay.indexOf(needle);

// ---------------------------------------------------------------- §1 utm_content ----
section('§1 — captureReferral records all FOUR utm parameters');
{
  // Slice captureReferral WHOLE: utm_source is read into `src` above the object literal,
  // so a slice starting at LS.set would report a false absence for exactly one of the four.
  const i = at(SHELL, 'function captureReferral()');
  const block = SHELL.slice(i, at(SHELL, "HS.referral = function"));
  for (const [key, param] of [['source', 'utm_source'], ['medium', 'utm_medium'],
                              ['campaign', 'utm_campaign'], ['content', 'utm_content']]) {
    ok(new RegExp(key + ':\\s').test(block) && block.includes(param),
      `first touch stores ${key} from ${param}`);
  }
  // utm_content is the creative slot. Without it every post in a campaign is the same row.
  ok(at(SHELL, "q.get('utm_content')") > -1, 'utm_content is read from the query string');
}

// ------------------------------------------------------------- §2 events.js wiring ----
section('§2 — events.js is loaded, and by the shell rather than by fifteen pages');
{
  ok(at(SHELL, 'function loadAnalytics()') > -1, 'shell.js defines loadAnalytics()');
  ok(/s\.src\s*=\s*'events\.js'/.test(SHELL), 'loadAnalytics injects events.js');
  ok(at(SHELL, 'window.hsClient = HS.sb()') > -1,
    'loadAnalytics assigns window.hsClient — events.js drops every row without it');
  // ORDERING: analytics must be armed before anything can fail, exactly like captureReferral.
  const boot = at(SHELL, 'async function boot()');
  const call = at(SHELL, 'loadAnalytics();');
  const inject = at(SHELL, 'await injectShell();');
  ok(call > boot && call < inject, 'boot() calls loadAnalytics() before injectShell()');
  ok(!/await\s+loadAnalytics\(\)/.test(SHELL),
    'loadAnalytics is NOT awaited — analytics must never block boot');
  // The artifact has always shipped it; that was never the missing half.
  ok(at(STAGE, "'events.js'") > -1, 'events.js is still in the Pages artifact allowlist');
  ok(at(EVENTS, 'window.hsLogEvent = function') > -1, 'events.js still defines window.hsLogEvent');
}

// -------------------------------------------------------------- §3 the stamp exists ----
section('§3 — HS.stampAcquisition exists and every conversion calls it');
{
  ok(at(SHELL, 'HS.stampAcquisition = function') > -1, 'HS.stampAcquisition is defined');
  ok(at(SHELL, "'hs_record_acquisition_touch'") > -1, 'it calls the hs_record_acquisition_touch RPC');

  // All FOUR conversion paths. Three of them existed and stamped nothing; the account
  // path is the one the audit found silently dropping every Bluesky signup.
  const calls = SHELL.match(/HS\.stampAcquisition\(/g) || [];
  ok(calls.length === 4, 'exactly 4 CALL sites (the definition is `= function`, not a call)', calls.length);
  ok(at(SHELL, "HS.stampAcquisition('account')") > -1, "account conversion is stamped");
  ok(at(SHELL, "HS.stampAcquisition('waitlist'") > -1, "waitlist conversion is stamped");
  ok((SHELL.match(/HS\.stampAcquisition\('area_request'/g) || []).length === 2,
    'BOTH area-request paths are stamped (onboarding + coverage modal)');

  // A direct visit must still be recorded, or every campaign reads as 100% of acquisition.
  ok(!/if\s*\(!r\s*\|\|\s*!r\.source\)\s*return/.test(
       SHELL.slice(at(SHELL, 'HS.stampAcquisition = function'), at(SHELL, 'HS.stampAcquisition = function') + 1400)),
    'an absent first touch does NOT skip the stamp — it is the direct/organic denominator');
}

// ------------------------------------------------------ §4 the account stamp ordering ----
section('§4 — the account stamp is ordered and awaited (both are load-bearing)');
{
  const getSession = at(SHELL, "const s = await HS.sb().auth.getSession()");
  const stamp = at(SHELL, "await HS.stampAcquisition('account')");
  const redirect = at(SHELL, 'HS.closeModal(\'authModal\');');
  ok(getSession > -1 && stamp > getSession,
    'the stamp runs AFTER getSession, so the client carries the new JWT and auth.uid() resolves');
  ok(at(SHELL, "await HS.stampAcquisition('account')") > -1,
    'the stamp is AWAITED — the 700ms redirect would otherwise race it away');
  ok(stamp < redirect, 'the stamp runs before the post-signin navigation');
}

// ------------------------------------------------------------------ §5 funnel events ----
section('§5 — the funnel stages that had no measure now fire');
{
  ok(at(SHELL, "HS.logEvent('page_view')") > -1, 'page_view (landing) fires');
  ok(at(SHELL, "HS.logEvent('signup_intent')") > -1, 'signup_intent (signup start) fires');
  ok(at(SHELL, "HS.logEvent('signup_complete')") > -1, 'signup_complete fires');
  // signup_intent must fire from the modal OPENING, which is the intent — not from submit,
  // which would make intent and completion the same number.
  const openAuth = at(SHELL, 'HS.openAuth = function');
  const intent = at(SHELL, "HS.logEvent('signup_intent')");
  const submit = at(SHELL, 'HS.authSubmit = async function');
  ok(intent > openAuth && intent < submit, 'signup_intent fires on openAuth, not on submit');
  // page_view fires at the END of boot, so a page that failed to boot is not counted.
  const resolveReady = at(SHELL, '_resolveReady(HS);');
  ok(at(SHELL, "HS.logEvent('page_view')") < resolveReady &&
     at(SHELL, "HS.logEvent('page_view')") > at(SHELL, 'async function boot()'),
    'page_view fires at the end of boot(), never for a page that failed to boot');
}

// --------------------------------------------------------- §6 paintCtaBand, executed ----
section('§6 — paintCtaBand: the SHIPPED function, run against a stub DOM');

// Slice the shipped function out of homesignalmap.html by brace-counting, so this drives
// production code and not a copy of it that could drift.
function extractFn(src, signature) {
  const i = src.indexOf(signature);
  if (i < 0) throw new Error('not found: ' + signature);
  let depth = 0, j = src.indexOf('{', i);
  const start = j;
  for (; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(i, j + 1); }
  }
  throw new Error('unbalanced braces for ' + signature);
}
const fnText = extractFn(MAP, 'function paintCtaBand(renderedCount){');

function makeEl() {
  return { textContent: '', hidden: true, onclick: null };
}
function runPaint({ renderedCount, zipMode, zipCode, signedIn, embed }) {
  const els = { ctaBand: makeEl(), ctaBtn: makeEl(), ctaH: makeEl(), ctaS: makeEl(), ctaFine: makeEl() };
  const opened = [];
  const documentStub = {
    getElementById: (id) => els[id] || null,
    documentElement: { classList: { contains: (c) => embed && c === 'hs-embed' } }
  };
  const windowStub = {
    HS: {
      state: { session: signedIn ? { user: { id: 'u1' } } : null },
      openAuth: () => opened.push('auth'),
      openLoc: () => opened.push('loc')
    }
  };
  // ZIP_MODE / ZIP_CODE are free variables in the shipped module scope; supply them as
  // parameters so the extracted body runs unmodified.
  const factory = new Function('document', 'window', 'ZIP_MODE', 'ZIP_CODE',
    fnText + '; return paintCtaBand;');
  factory(documentStub, windowStub, zipMode, zipCode)(renderedCount);
  if (els.ctaBtn.onclick) els.ctaBtn.onclick();
  return { els, opened };
}

{
  // A ZIP with records, signed out -> the free-account ask.
  const a = runPaint({ renderedCount: 42, zipMode: true, zipCode: '76102', signedIn: false, embed: false });
  ok(a.els.ctaBand.hidden === false, 'records + signed out -> band is shown');
  ok(/Follow this area/.test(a.els.ctaBtn.textContent), 'CTA is the free-account ask', a.els.ctaBtn.textContent);
  ok(a.opened[0] === 'auth', 'the button opens the auth modal', a.opened);

  // An empty ZIP -> the coverage request, because there is nothing to follow yet.
  const b = runPaint({ renderedCount: 0, zipMode: true, zipCode: '99999', signedIn: false, embed: false });
  ok(b.els.ctaBand.hidden === false, 'empty ZIP -> band is still shown');
  ok(/cover your ZIP/i.test(b.els.ctaBtn.textContent), 'CTA becomes the coverage request', b.els.ctaBtn.textContent);
  ok(b.els.ctaH.textContent.includes('99999'), 'the headline names the ZIP', b.els.ctaH.textContent);
  ok(b.opened[0] === 'loc', 'the button opens the coverage modal', b.opened);

  // Signed in with records -> nothing honest left to ask for.
  const c = runPaint({ renderedCount: 42, zipMode: true, zipCode: '76102', signedIn: true, embed: false });
  ok(c.els.ctaBand.hidden === true, 'signed in + records -> band is hidden');

  // Signed in on an EMPTY ZIP still gets the coverage ask: having an account does not
  // mean we cover their ZIP, and this is the one thing they can still usefully do.
  const d = runPaint({ renderedCount: 0, zipMode: true, zipCode: '99999', signedIn: true, embed: false });
  ok(d.els.ctaBand.hidden === false, 'signed in + empty ZIP -> coverage ask still shown');
  ok(/cover your ZIP/i.test(d.els.ctaBtn.textContent), 'and it is the coverage CTA', d.els.ctaBtn.textContent);

  // Embed mode is a Place's context map inside an iframe, not a landing page.
  const e = runPaint({ renderedCount: 42, zipMode: true, zipCode: '76102', signedIn: false, embed: true });
  ok(e.els.ctaBand.hidden === true, 'embed mode -> band is hidden');

  // Address mode (ZIP_MODE false) with records still converts — it is the same visitor.
  const f = runPaint({ renderedCount: 12, zipMode: false, zipCode: null, signedIn: false, embed: false });
  ok(f.els.ctaBand.hidden === false, 'address mode + records -> band is shown');
  ok(/Follow this area/.test(f.els.ctaBtn.textContent), 'address mode gets the account ask');

  // An empty ADDRESS search must not claim we do not cover a ZIP — there is no ZIP.
  const g = runPaint({ renderedCount: 0, zipMode: false, zipCode: null, signedIn: false, embed: false });
  ok(!/cover your ZIP/i.test(g.els.ctaBtn.textContent),
    'empty address mode does NOT show the ZIP-coverage ask', g.els.ctaBtn.textContent);
}

// -------------------------------------------------------- §7 the band is reachable ----
section('§7 — paintCtaBand is called from BOTH paths that end a ZIP load');
{
  ok(at(MAP, 'paintCtaBand(sites.length)') > -1, 'render() paints the band');
  // The true-empty ZIP branch does NOT call render(), so without its own call the
  // coverage CTA would be unreachable on exactly the pages it exists for.
  ok(at(MAP, 'paintCtaBand(0)') > -1, 'the no-records branch paints the band too');
  const emptyBranch = at(MAP, 'HS.zipAuthNote(auth, zip, [])');
  const emptyPaint = at(MAP, 'paintCtaBand(0)');
  ok(emptyPaint > emptyBranch && emptyPaint - emptyBranch < 400,
    'the paintCtaBand(0) call sits in the zipAuthNote empty branch');
  // A FAILED read is not an empty ZIP: offering to "cover your ZIP" there would be a
  // false claim about our own coverage.
  const cat = at(MAP, "status(\"Couldn't load ZIP \"");
  ok(at(MAP, '_b.hidden = true') > cat, 'the catch branch hides the band rather than asking');

  ok(at(MAP, 'id="ctaBand"') > -1, 'the band markup exists');
  ok(at(MAP, 'function paintCtaBand') < at(MAP, '  function render(data){'),
    'paintCtaBand is at module scope, not redefined inside render() on every paint');
}

// ------------------------------------------------------------------- §8 honest copy ----
section('§8 — the CTA claims nothing the product does not do');
{
  const band = MAP.slice(at(MAP, 'id="ctaBand"'), at(MAP, 'id="ctaBand"') + 900)
             + extractFn(MAP, 'function paintCtaBand(renderedCount){');
  // The engine has NO project identity across filings, so proposed->approved->built is
  // not tracked; ECHO violation counts read 0 for effectively every facility; and there
  // is no per-street or real-time alerting.
  for (const banned of [/instant/i, /real-?time/i, /\bevery permit near your street\b/i,
                        /track .{0,30}from proposal/i, /guarantee/i, /violation/i]) {
    ok(!banned.test(band), 'does not claim: ' + banned);
  }
  ok(/free/i.test(band), 'does say the account is free — it is');
  ok(/links back to the permit, agenda, or filing/i.test(band),
    'carries the sourcing promise the site already makes and CI already enforces');
}

// ------------------------------------------------------- §9 the pins are load-bearing ----
section('§9 — mutation: each pin fails when the thing it guards is removed');
{
  // A pin that passes against the OLD code is not a pin. Reproduce the four measured
  // pre-change states and require this file to reject each.
  const mutations = [
    ['utm_content dropped from captureReferral',
      () => SHELL.replace("content:  q.get('utm_content') || null,", ''),
      (s) => at(s, "q.get('utm_content')") === -1],
    ['events.js never loaded (the measured pre-change state)',
      () => SHELL.replace("s.src = 'events.js';", "s.src = 'nothing.js';"),
      (s) => !/s\.src\s*=\s*'events\.js'/.test(s)],
    ['the account stamp removed (the Bluesky signup drop)',
      () => SHELL.replace("await HS.stampAcquisition('account');", ''),
      (s) => at(s, "HS.stampAcquisition('account')") === -1],
    ['the account stamp no longer awaited (races the redirect)',
      () => SHELL.replace("await HS.stampAcquisition('account');", "HS.stampAcquisition('account');"),
      (s) => at(s, "await HS.stampAcquisition('account')") === -1],
    ['the empty-ZIP branch stops painting the band',
      () => MAP.replace('paintCtaBand(0);', ''),
      (s) => at(s, 'paintCtaBand(0)') === -1]
  ];
  for (const [name, mutate, detects] of mutations) {
    ok(detects(mutate()), `a pin would catch: ${name}`);
  }
  // And the reverse control: the unmutated sources must NOT trip those detectors, or the
  // detectors are vacuous and would "pass" against anything.
  ok(at(SHELL, "q.get('utm_content')") > -1 &&
     /s\.src\s*=\s*'events\.js'/.test(SHELL) &&
     at(SHELL, "await HS.stampAcquisition('account')") > -1 &&
     at(MAP, 'paintCtaBand(0)') > -1,
    'control: the SHIPPED sources satisfy every detector above');
}

console.log('\n' + (fails ? `FAILED — ${fails} assertion(s)` : 'OK — all assertions passed'));
process.exit(fails ? 1 : 0);
