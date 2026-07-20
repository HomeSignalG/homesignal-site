// Onboarding decision unit tests. Run: node test/onboarding.test.mjs
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const {
  needsOnboarding,
  hasServerLocation,
  isRealSavedProperty,
  addressLooksValid,
  zipLooksValid,
  inputMode,
  canContinue,
  validCoords,
  destinationHref,
  isDuplicateDbError
} = createRequire(import.meta.url)('../lib/onboarding.js');

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const shell = readFileSync(join(root, 'shell.js'), 'utf8');

let fails = 0;
const eq = (got, want, name) => {
  const ok = got === want;
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${name} (got ${JSON.stringify(got)})`);
  if (!ok) fails++;
};
const ok = (cond, name) => {
  console.log(`${cond ? 'PASS' : 'FAIL'} — ${name}`);
  if (!cond) fails++;
};

const realSession = { user: { id: 'u1' } };
const demoSession = { user: { id: 'demo' }, demo: true };
const home = { id: 'p1', address: '123 Main St', zip: '78617' };
const sampleHome = { id: 'p2', address: '4400 Wildhorse Trail', zip: '78617', sample: true };
const hydrated = { hydrated: true, serverFollowZips: [], activeProperty: null };

// --- eligibility (server-backed only) ---
ok(needsOnboarding(realSession, hydrated), 'new user with no server location sees onboarding');
ok(!needsOnboarding(realSession, { hydrated: true, activeProperty: home, serverFollowZips: [] }),
  'returning user with property skips onboarding');
ok(!needsOnboarding(realSession, { hydrated: true, activeProperty: null, serverFollowZips: ['78617'] }),
  'returning user with ZIP follow only skips onboarding');
ok(!needsOnboarding(realSession, { hydrated: false, activeProperty: null, serverFollowZips: [] }),
  'not hydrated yet -> do not show onboarding (prevents flash)');
ok(needsOnboarding(realSession, { hydrated: true, activeProperty: null, serverFollowZips: [], staleLocalZip: '90210' }),
  'stale localStorage ZIP in ctx is ignored when server has no follow');
ok(needsOnboarding(realSession, { hydrated: true, activeProperty: null, serverFollowZips: [], urlZip: '78617' }),
  'URL ZIP does not skip onboarding');
ok(needsOnboarding(realSession, { hydrated: true, activeProperty: sampleHome, serverFollowZips: [] }),
  'sample/demo home does not skip onboarding');
ok(!needsOnboarding(null, hydrated), 'signed-out -> skip onboarding overlay');
ok(!needsOnboarding(demoSession, hydrated), 'demo session -> skip onboarding overlay');

ok(hasServerLocation({ activeProperty: home, serverFollowZips: [] }), 'property alone qualifies');
ok(hasServerLocation({ activeProperty: null, serverFollowZips: ['84101'] }), 'server follow alone qualifies');
ok(!hasServerLocation({ activeProperty: sampleHome, serverFollowZips: [] }), 'sample home does not qualify');
ok(!hasServerLocation({ activeProperty: null, serverFollowZips: [] }), 'empty server state does not qualify');
ok(hasServerLocation({ activeProperty: home, serverFollowZips: ['84101'] }),
  'deleting one of multiple locations: property remains -> still has location');
ok(!hasServerLocation({ activeProperty: null, serverFollowZips: [] }),
  'clearing the final valid location -> no server location');
ok(!isRealSavedProperty(sampleHome), 'isRealSavedProperty rejects sample');

// --- input validation ---
ok(addressLooksValid('123 Main St, Austin, TX'), 'valid address shape');
ok(!addressLooksValid('short'), 'too-short address rejected');
ok(zipLooksValid('78617'), 'valid zip');
ok(!zipLooksValid('7861'), 'invalid zip rejected');
ok(!zipLooksValid('abcde'), 'invalid ZIP letters rejected');

eq(inputMode('123 Main St, Austin, TX', '78617'), 'address', 'address preferred when both valid');
eq(inputMode('', '78617'), 'zip', 'zip-only mode');
eq(inputMode('123 Main St, Austin, TX', ''), 'address', 'address-only mode');

ok(canContinue('123 Main St, Austin, TX', ''), 'continue enabled with address');
ok(canContinue('', '78617'), 'continue enabled with zip');
ok(!canContinue('', ''), 'continue disabled with empty inputs');

// --- geocode validation helpers ---
ok(validCoords(30.17, -97.61), 'valid coordinates accepted');
ok(!validCoords(null, -97.61), 'missing lat rejected');
ok(!validCoords(30.17, null), 'missing lng rejected');
ok(!validCoords(999, -97.61), 'out-of-range lat rejected');

ok(isDuplicateDbError({ code: '23505' }), 'duplicate db error detected');
ok(!isDuplicateDbError({ code: '42501' }), 'non-duplicate error not treated as duplicate');

// --- destinations ---
eq(destinationHref('development', '78617'), 'homesignalmap.html?zip=78617', 'development destination href');
eq(destinationHref('qol', '78617'), 'maps.html?zip=78617', 'qol destination href');
eq(destinationHref('updates', '78617'), 'alerts.html?zip=78617', 'updates destination href');
eq(destinationHref('development', '78617', (p, z) => p + '?zip=' + z), 'homesignalmap.html?zip=78617', 'custom navHref builder');
ok(!destinationHref('development', 'bad'), 'invalid zip -> no destination href');

// Account switch: User A's stale local ZIP must not skip onboarding for User B.
ok(needsOnboarding({ user: { id: 'user-b' } }, {
  hydrated: true,
  activeProperty: null,
  serverFollowZips: []
}), 'account switch: User B with empty server state sees onboarding despite prior local ZIP on device');

const needsOnbFn = shell.match(/HS\.needsOnboarding\s*=\s*function\s*\(\)\s*\{[\s\S]*?\n  \};/);
ok(needsOnbFn && /onboardingCtx\(\)/.test(needsOnbFn[0]),
  'shell needsOnboarding passes server context via onboardingCtx()');
ok(needsOnbFn && !/LS\.get\('myZip'/.test(needsOnbFn[0]),
  'shell needsOnboarding does not read localStorage myZip');
ok(/_accountHydrated/.test(shell), 'shell tracks account hydration gate');
ok(/ensureAccountScope/.test(shell), 'shell scopes localStorage on account switch');
ok(/clearAccountLocalState/.test(shell), 'shell clears account local state on sign-out');
ok(/persistCommunityFollow/.test(shell), 'shell has server-verified community follow helper');
ok(/_onbSaving/.test(shell), 'shell blocks double submission during onboarding save');
ok(/onbRecovery/.test(shell) || /onbRetryBtn/.test(readFileSync(join(root, 'partials/shell.html'), 'utf8')),
  'recovery UI present for failed saves');

if (fails) { console.error(`\n${fails} assertion(s) failed`); process.exit(1); }
console.log('\nAll onboarding assertions passed.');
