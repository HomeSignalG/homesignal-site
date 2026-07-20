// Onboarding decision unit tests. Run: node test/onboarding.test.mjs
import { createRequire } from 'node:module';
const {
  needsOnboarding,
  addressLooksValid,
  zipLooksValid,
  inputMode,
  canContinue,
  destinationHref
} = createRequire(import.meta.url)('../lib/onboarding.js');

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

ok(needsOnboarding(realSession, null, null), 'signed-in, no zip, no home -> onboarding');
ok(!needsOnboarding(realSession, '78617', null), 'signed-in with saved zip -> skip');
ok(!needsOnboarding(realSession, null, home), 'signed-in with saved home -> skip');
ok(!needsOnboarding(null, null, null), 'signed-out -> skip onboarding overlay');
ok(!needsOnboarding(demoSession, null, null), 'demo session -> skip onboarding overlay');

ok(addressLooksValid('123 Main St, Austin, TX'), 'valid address shape');
ok(!addressLooksValid('short'), 'too-short address rejected');
ok(zipLooksValid('78617'), 'valid zip');
ok(!zipLooksValid('7861'), 'invalid zip rejected');

eq(inputMode('123 Main St, Austin, TX', '78617'), 'address', 'address preferred when both valid');
eq(inputMode('', '78617'), 'zip', 'zip-only mode');
eq(inputMode('123 Main St, Austin, TX', ''), 'address', 'address-only mode');

ok(canContinue('123 Main St, Austin, TX', ''), 'continue enabled with address');
ok(canContinue('', '78617'), 'continue enabled with zip');
ok(!canContinue('', ''), 'continue disabled with empty inputs');

eq(destinationHref('development', '78617'), 'homesignalmap.html?zip=78617', 'development destination href');
eq(destinationHref('qol', '78617'), 'maps.html?zip=78617', 'qol destination href');
eq(destinationHref('updates', '78617'), 'alerts.html?zip=78617', 'updates destination href');
eq(destinationHref('development', '78617', (p, z) => p + '?zip=' + z), 'homesignalmap.html?zip=78617', 'custom navHref builder');

if (fails) { console.error(`\n${fails} assertion(s) failed`); process.exit(1); }
console.log('\nAll onboarding assertions passed.');
