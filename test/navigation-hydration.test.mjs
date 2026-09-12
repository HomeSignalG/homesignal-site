// FIX 6 / GATE 1 — VIEWED PLACE OWNERSHIP ACROSS ACCOUNT HYDRATION.
//
// THE DEFECT THIS PINS. It was a sequential overwrite, not a race:
//   1. script parse  -> resolveViewedZip({urlZip}) sets the viewed ZIP
//   2. await hydrateAccountLocation() -> syncFollowsFromAccount() assigned
//      `state.zip = _serverFollowZips[0]` and overwrote myZip with it
//   3. HS.onReady -> the page fetches S.zip, which is now somebody else's ZIP
// So app_follows ROW ORDER silently replaced the place the resident had explicitly
// chosen. community.html survived only because lib/community-page.js re-reads the URL
// after hydrate; Dashboard / Alerts / Development had no such reset.
//
// WHY THE BEHAVIOURAL HALF DRIVES REAL CODE. The decision now lives in
// lib/view-zip.js::myZipAfterFollowSync, which has NO viewed-ZIP return value — the
// boundary is structural, not a convention. These cases run that shipped function
// inside a model of the real boot ORDER, so they fail if the decision regresses.
//
// WHY THE STRUCTURAL HALF RUNS ON A COMMENT-STRIPPED COPY. The fix's own comments
// name the very assignments they forbid ("state.zip = _serverFollowZips[0]"). This
// repo has already shipped three assertions that went green off a code comment
// mentioning the string they banned (see test/my-places-contract.test.mjs). A comment
// explaining why something is absent must not be able to satisfy a check that it is
// absent.
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const { resolveViewedZip, myZipAfterFollowSync } = require('../lib/view-zip.js');

let fails = 0;
const ok = (c, name, d) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name
    + (!c && d !== undefined ? '  detail: ' + JSON.stringify(d).slice(0, 200) : ''));
  if (!c) fails++;
};

const DEF = '78617';
// The brief's stubbed account: 84301 is what the resident chose, and it is deliberately
// NOT first — 75009 is. Follow-list order is the thing that used to win.
const FOLLOWS = ['75009', '78617', '84301'];

// A model of the real boot ORDER (resolve -> hydrate -> fetch). `zip` is the viewed
// place; hydrate may only touch the saved-place store. The page then fetches `zip`.
function boot({ urlZip = null, myZip = null, sessionViewZip = null, follows = FOLLOWS, localFollows = [] } = {}) {
  const store = { myZip };
  const zip = resolveViewedZip({ urlZip, myZip, sessionViewZip, defaultZip: DEF });
  const hydrate = () => {
    const initZip = myZipAfterFollowSync({
      myZip: store.myZip, serverFollowZips: follows, localFollowZips: localFollows
    });
    if (initZip) store.myZip = initZip;
    // Hydrate returns nothing that can become the viewed ZIP — that is the contract.
    return undefined;
  };
  hydrate();
  return { zip, myZip: store.myZip, rehydrate: hydrate, fetched: () => zip };
}

console.log('--- Gate 1 proof: stubbed follows [75009, 78617, 84301] ---');

// 1. explicit ?zip= survives hydration, and an established myZip is not touched
let r = boot({ urlZip: '84301', myZip: '84301' });
ok(r.zip === '84301', '1a ?zip=84301 is still the viewed ZIP after hydrate', r);
ok(r.myZip === '84301', '1a established myZip=84301 unchanged by hydrate', r);
r = boot({ urlZip: '84301', myZip: '90210' });
ok(r.zip === '84301', '1b ?zip=84301 wins over a different established myZip', r);
ok(r.myZip === '90210', '1b hydrate does not replace an established myZip with follow[0]', r);

// 2. no ?zip=, established myZip -> myZip is the viewed ZIP and survives
r = boot({ myZip: '84301' });
ok(r.zip === '84301', '2 established myZip=84301 is the viewed ZIP after hydrate', r);
ok(r.myZip === '84301', '2 established myZip=84301 stays 84301', r);

// 3. no ?zip=, no myZip, session viewZip -> session value survives hydration
r = boot({ sessionViewZip: '84301' });
ok(r.zip === '84301', '3 session viewZip=84301 survives hydration', r);

// 4. nothing set -> DOCUMENTED fallback only. "first followed ZIP" is NOT a fallback.
r = boot({});
ok(r.zip === DEF, '4 no URL / myZip / viewZip -> CFG.DEFAULT_ZIP, not follows[0]', r);
ok(r.zip !== '75009', '4 the first followed ZIP was NOT invented as a viewed-ZIP fallback', r);

// 5. re-running the sync after boot still cannot assign the viewed ZIP
r = boot({ urlZip: '84301', myZip: '84301' });
ok(r.rehydrate() === undefined, '5 a second sync call returns no viewed ZIP at all');
r.rehydrate(); r.rehydrate();
ok(r.zip === '84301' && r.fetched() === '84301',
  '5 repeated hydrate/sync calls leave the viewed ZIP at 84301', r);
ok(r.myZip === '84301', '5 repeated hydrate/sync calls leave myZip at 84301', r);

console.log('--- the ownership rule itself (shipped myZipAfterFollowSync) ---');
ok(myZipAfterFollowSync({ myZip: '84301', serverFollowZips: FOLLOWS }) === null,
  'an established myZip is never replaced by the first server follow');
ok(myZipAfterFollowSync({ myZip: null, serverFollowZips: FOLLOWS }) === '75009',
  'first-follow INITIALIZATION still fills an absent myZip (cross-device onboarding)');
ok(myZipAfterFollowSync({ myZip: null, serverFollowZips: [], localFollowZips: [{}.zip] }) === null,
  'no usable follow -> nothing written (never a guessed ZIP)');
ok(myZipAfterFollowSync({ myZip: null, serverFollowZips: [], localFollowZips: ['84301'] }) === '84301',
  'a local-only follow can initialize an absent myZip');
ok(myZipAfterFollowSync({ myZip: 'abc', serverFollowZips: FOLLOWS }) === '75009',
  'a malformed stored myZip is not treated as established');
ok(myZipAfterFollowSync({ myZip: null, serverFollowZips: ['x', '9', '84301'] }) === '84301',
  'non-ZIP follow rows are skipped, never emitted');
// The boundary is structural: there is no viewed-ZIP channel to regress through.
const out = myZipAfterFollowSync({ myZip: null, serverFollowZips: FOLLOWS });
ok(typeof out === 'string' || out === null,
  'the follow-sync decision returns a myZip string or null — never a {zip} view decision');

console.log('--- shell.js: the forbidden assignments are GONE (comment-stripped) ---');
const raw = fs.readFileSync(new URL('../shell.js', import.meta.url), 'utf8');
const strip = (x) => x.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
const shell = strip(raw);
// Prove the stripper actually removed the explanatory comments, or every "absence"
// assertion below would be vacuous.
ok(/SAVED PLACES ONLY/.test(raw) && !/SAVED PLACES ONLY/.test(shell),
  'the comment stripper really strips (positive control — absence checks are not vacuous)');

// Scope each pin to the statement it is about: a repo-wide search for a string the
// file legitimately contains elsewhere is how a pin stops guarding.
function body(src, header) {
  const i = src.indexOf(header);
  if (i < 0) return '';
  let d = 0, started = false;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') { d++; started = true; }
    else if (src[j] === '}') { d--; if (started && d === 0) return src.slice(i, j + 1); }
  }
  return '';
}
const sync = body(shell, 'async function syncFollowsFromAccount()');
const hydr = body(shell, 'async function hydrateAccountLocation()');
ok(sync.length > 200, 'syncFollowsFromAccount body was found for contract pins', sync.length);
ok(hydr.length > 200, 'hydrateAccountLocation body was found for contract pins', hydr.length);

ok(!/state\.zip\s*=/.test(sync),
  'syncFollowsFromAccount contains NO assignment to state.zip',
  (sync.match(/.{0,60}state\.zip\s*=.{0,60}/) || [])[0]);
ok(!/_serverFollowZips\[0\]/.test(sync),
  'syncFollowsFromAccount never reads _serverFollowZips[0] as geography',
  (sync.match(/.{0,60}_serverFollowZips\[0\].{0,60}/) || [])[0]);
ok(!/local\[0\]/.test(sync),
  'syncFollowsFromAccount never reads local[0] as geography',
  (sync.match(/.{0,60}local\[0\].{0,60}/) || [])[0]);
ok(/myZipAfterFollowSync/.test(sync),
  'syncFollowsFromAccount routes its only myZip write through the shared decision');
ok((sync.match(/LS\.set\('myZip'/g) || []).length === 1,
  'syncFollowsFromAccount writes myZip exactly once, and only via that decision',
  (sync.match(/LS\.set\('myZip'[^\n]*/g) || []));
ok(/if \(initZip\) LS\.set\('myZip', initZip\);/.test(sync),
  'that single write is guarded by the decision returning a value');

ok(!/state\.zip\s*=/.test(hydr),
  'hydrateAccountLocation contains NO assignment to state.zip',
  (hydr.match(/.{0,60}state\.zip\s*=.{0,60}/) || [])[0]);
ok(!/state\.activePropId = state\.properties\[0\]\.id/.test(hydr),
  'hydrateAccountLocation no longer elects properties[0] as the active address',
  (hydr.match(/.{0,80}properties\[0\].{0,40}/) || [])[0]);
ok(/String\(p\.zip\) === String\(state\.zip\)/.test(hydr),
  'any election hydrate still makes is gated on the property being in the VIEWED ZIP');

// The canonical file and the shell mirror must not drift (docs/zip-navigation.md).
ok(/HS\.myZipAfterFollowSync = function/.test(shell),
  'shell.js mirrors myZipAfterFollowSync for the no-module boot path');
ok(/myZipAfterFollowSync: myZipAfterFollowSync/.test(
  fs.readFileSync(new URL('../lib/view-zip.js', import.meta.url), 'utf8')),
  'lib/view-zip.js (canonical) exports myZipAfterFollowSync');

// Boot order itself is unchanged — Gate 1 fixes ownership, not precedence.
ok(resolveViewedZip({ myZip: '90210', sessionViewZip: '84101', defaultZip: DEF }) === '90210',
  'boot precedence unchanged: myZip still outranks session viewZip');

if (fails) { console.error('\n' + fails + ' assertion(s) failed'); process.exit(1); }
console.log('\nAll Gate 1 hydration-ownership assertions passed.');
