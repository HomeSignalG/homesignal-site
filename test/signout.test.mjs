// GUARD: signing out must clear this browser's account-scoped local state, so the
// next visitor never inherits the previous account's saved ZIP / active property /
// follows / topic picks (a cross-account privacy leak — #5), and the app falls back
// to the sample view (#6, downstream of #5). Run: node test/signout.test.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const fs = require('node:fs');
let fails = 0;
const ok = (c, name) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name); if (!c) fails++; };

// lib/data.js is a browser IIFE that hangs helpers off window.HS. Give it a window.
global.window = { HS_CONFIG: { DATA_SOURCE: 'supabase', DEMO_SESSION: false }, HS: {} };
require('../lib/data.js');
const HS = global.window.HS;

// --- The key list is the contract: every account-scoped key, and NOT referral ---
for (const k of ['myZip', 'activeProp', 'follows', 'topicPrefs']) {
  ok(HS.ACCOUNT_LOCAL_KEYS.includes(k),
     `ACCOUNT_LOCAL_KEYS includes '${k}' (cleared on sign-out)`);
}
ok(!HS.ACCOUNT_LOCAL_KEYS.includes('referral'),
   "ACCOUNT_LOCAL_KEYS excludes 'referral' (browser-level marketing attribution, not account state)");

// --- clearAccountLocal empties every account key and preserves referral ---
// Minimal Storage stand-in (get/set/removeItem over a plain map), keys 'hs:'-prefixed.
function fakeLS(seed) {
  const m = Object.assign({}, seed);
  return {
    _m: m,
    getItem(k) { return k in m ? m[k] : null; },
    setItem(k, v) { m[k] = String(v); },
    removeItem(k) { delete m[k]; },
  };
}
const ls = fakeLS({
  'hs:myZip': '"78617"', 'hs:activeProp': '"p1"', 'hs:follows': '["78617"]',
  'hs:topicPrefs': '{"a":1}', 'hs:dismissed': '["x"]', 'hs:myCommunities': '["c"]',
  'hs:referral': '"launch-email"',
});
HS.clearAccountLocal(ls);
for (const k of HS.ACCOUNT_LOCAL_KEYS) {
  ok(ls.getItem('hs:' + k) === null, `clearAccountLocal removed hs:${k}`);
}
ok(ls.getItem('hs:referral') === '"launch-email"',
   'clearAccountLocal preserved hs:referral (not account-scoped)');

// --- After the clear, hasAreaFrom(null,null) is false -> the app is a SAMPLE view ---
ok(HS.hasAreaFrom(null, null) === false,
   'no active property + no saved ZIP -> hasAreaFrom is false (isSample() would be true)');
ok(HS.hasAreaFrom({ id: 'p1' }, null) === true, 'a real active property -> hasAreaFrom true');
ok(HS.hasAreaFrom(null, '78617') === true, 'a saved ZIP -> hasAreaFrom true');

// --- The sign-out path in shell.js actually calls the clear (can't silently regress) ---
const shell = fs.readFileSync(new URL('../shell.js', import.meta.url), 'utf8');
ok(/onAvatar[\s\S]*?HS\.clearSession\(\)[\s\S]*?signOut\(\)/.test(shell),
   'shell.js onAvatar clears session state BEFORE signOut()');
ok(/HS\.clearSession\s*=\s*function[\s\S]*?HS\.clearAccountLocal\(localStorage\)/.test(shell),
   'shell.js clearSession clears account-scoped localStorage');
ok(/state\.activeProperty,\s*LS\.get\('myZip'/.test(shell),
   'shell.js HS.hasArea delegates to the guarded HS.hasAreaFrom');

if (fails) { console.error(`\n${fails} failed`); process.exit(1); }
console.log('\nAll sign-out clear-state assertions passed.');
