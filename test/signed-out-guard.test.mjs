// GUARD: a signed-out visitor must never surface the seeded demo persona
// ("4400 Wildhorse Trail"). Enforces the config.js:14-20 invariant + the two
// root-cause fixes for the #282 regression. Run: node test/signed-out-guard.test.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const fs = require('node:fs');
let fails = 0;
const ok = (c, name) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name); if (!c) fails++; };

// --- Root cause 1: HS.data.properties() gates seeded homes behind DEMO_SESSION ---
global.window = {
  HS_CONFIG: { DATA_SOURCE: 'supabase', DEMO_SESSION: false },
  HS: { state: { session: null, zip: '78617' } },
  HS_SEED: { properties: [{ id: 'p1', address: '4400 Wildhorse Trail', city: 'Del Valle', state: 'TX', zip: '78617' }] },
};
require('../lib/data.js');
const HS = global.window.HS;

ok((await HS.data.properties()).length === 0,
   'signed-out (DEMO_SESSION=false) -> HS.data.properties() is EMPTY (no seeded sample homes)');

// --- Root cause 2: activeProperty selection excludes samples -> null ---
// pickActiveProperty is the pure core the shell.js state.activeProperty getter delegates to.
ok(HS.pickActiveProperty([], null) === null,
   'no properties -> activeProperty is null');
ok(HS.pickActiveProperty([{ id: 'p1', address: '4400 Wildhorse Trail', sample: true }], 'p1') === null,
   'sample-only properties -> activeProperty is null (never the demo persona)');
ok(HS.pickActiveProperty([{ id: 'p2', address: '10 Real St' }], 'p2').id === 'p2',
   'a real property -> activeProperty is that property');
ok(HS.pickActiveProperty([{ id: 's', sample: true }, { id: 'r', address: '10 Real St' }], 's').id === 'r',
   'active id points at a sample -> falls through to the real property, never the sample');

// --- The gate can't be silently dropped again ---
const cfg   = fs.readFileSync(new URL('../config.js', import.meta.url), 'utf8');
const data  = fs.readFileSync(new URL('../lib/data.js', import.meta.url), 'utf8');
const shell = fs.readFileSync(new URL('../shell.js', import.meta.url), 'utf8');
ok(/DEMO_SESSION:\s*false/.test(cfg), 'config.js DEMO_SESSION is false in production');
ok(/CFG\.DEMO_SESSION\s*&&/.test(data), 'lib/data.js properties() still gates sample homes behind DEMO_SESSION');
ok(/get activeProperty\(\)\s*{[^}]*HS\.pickActiveProperty/.test(shell),
   'shell.js activeProperty getter delegates to the guarded HS.pickActiveProperty');

// --- No fabricated persona address is hardcoded anywhere it could render in chrome ---
const base = new URL('../', import.meta.url);
for (const f of ['shell.js', 'index.html', 'dashboard.html', 'properties.html', 'maps.html',
                 'community.html', 'today.html', 'reports.html', 'alerts.html', 'development.html']) {
  ok(!/Wildhorse/.test(fs.readFileSync(new URL(f, base), 'utf8')),
     `${f}: no hardcoded demo persona address`);
}

if (fails) { console.error(`\n${fails} failed`); process.exit(1); }
console.log('\nAll signed-out guard assertions passed.');
