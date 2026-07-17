// Landing decision unit test (no DB, no browser). Run: node test/landing.test.mjs
// Pins: signed-in + home -> dashboard; signed-out -> hero; demo session -> hero (sample carve-out).
import { createRequire } from 'node:module';
const { landingFor } = createRequire(import.meta.url)('../lib/landing.js');

let fails = 0;
const eq = (got, want, name) => {
  const ok = got === want;
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${name} (got ${JSON.stringify(got)})`);
  if (!ok) fails++;
};

const home = { id: 'p1', address: '3614 Bill Price Rd' };
const realSession = { user: { id: 'u1' } };                 // no .demo
const demoSession = { user: { id: 'demo' }, demo: true };

eq(landingFor(realSession, home), 'dashboard.html', 'signed-in + home set -> dashboard');
eq(landingFor(null, home),        null,             'signed-out -> hero');
eq(landingFor(null, null),        null,             'signed-out, no home -> hero');
eq(landingFor(realSession, null), null,             'signed-in, no home yet -> hero');
eq(landingFor(demoSession, home), null,             'demo session -> hero (sample carve-out, protects #280)');

if (fails) { console.error(`\n${fails} assertion(s) failed`); process.exit(1); }
console.log('\nAll landing assertions passed.');
