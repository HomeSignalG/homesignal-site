// Sample homes reach dashboard + properties via the ONE data source, signed-out.
// Run: node test/sample-view.test.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const fs = require('node:fs');
let fails = 0;
const ok = (c, name) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name); if (!c) fails++; };

// Part A (unit): HS.data.properties() returns the flagged sample when signed out.
global.window = {
  HS_CONFIG: { DATA_SOURCE: 'supabase', DEMO_SESSION: false },
  HS: { state: { session: null, zip: '78617' } },
  HS_SEED: { properties: [{ id: 'p1', address: '123 Sample St', city: 'Del Valle', state: 'TX', zip: '78617', score: 80 }] },
};
require('../lib/data.js');
const HS = global.window.HS;

const out = await HS.data.properties();
ok(out.length === 1 && out.every(p => p.sample === true), 'signed-out -> sample homes, flagged sample:true');
HS.state.session = { user: { id: 'demo' }, demo: true };
ok((await HS.data.properties()).length === 1, 'demo session -> sample homes');

// Part B (static): both pages render that one source; neither reads HS_SEED itself.
const dash  = fs.readFileSync(new URL('../dashboard.html', import.meta.url), 'utf8');
const props = fs.readFileSync(new URL('../properties.html', import.meta.url), 'utf8');
ok(/S\.properties/.test(dash)  && !/HS_SEED/.test(dash),  'dashboard renders state.properties, no own HS_SEED read');
ok(/S\.properties/.test(props) && !/HS_SEED/.test(props), 'properties renders state.properties, no own HS_SEED read');

// The anti-fabrication marker is present on both (a fake address must be labeled sample).
ok(/isSample\(\)/.test(dash),  'dashboard shows an HS.isSample()-gated sample marker');
ok(/isSample\(\)/.test(props), 'properties shows an HS.isSample()-gated sample marker');

if (fails) { console.error(`\n${fails} failed`); process.exit(1); }
console.log('\nAll sample-view assertions passed.');
