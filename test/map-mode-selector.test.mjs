// Pins the shared map-view selector on maps.html — the ONE page that serves every
// ZIP's development map (via ?zip=). The selector order and labels must be exactly:
//   Street | Satellite | Focus
// "Focus" is the simplified HomeSignal schematic view; its data-mode key stays
// "impact" so all view logic / deep links / active-button wiring is unchanged.
// Because maps.html is a single shared template, this holds for every ZIP page.
// Run: node test/map-mode-selector.test.mjs
import { readFileSync } from 'node:fs';

let fails = 0;
const ok = (c, name) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name); if (!c) fails++; };

const html = readFileSync(new URL('../maps.html', import.meta.url), 'utf8');

// Pull the #mapMode segment and its buttons, in document order.
const seg = html.match(/<div class="seg" id="mapMode">([\s\S]*?)<\/div>/);
ok(!!seg, '#mapMode selector segment exists in maps.html');

const buttons = [...(seg ? seg[1] : '').matchAll(/<button[^>]*data-mode="([^"]+)"[^>]*>\s*([^<]*?)\s*<\/button>/g)]
  .map((m) => ({ mode: m[1], label: m[2] }));

// Exact order + labels — the whole point of this test.
const labels = buttons.map((b) => b.label);
ok(JSON.stringify(labels) === JSON.stringify(['Street', 'Satellite', 'Focus']),
  'selector labels are exactly Street | Satellite | Focus (got: ' + labels.join(' | ') + ')');

// data-mode keys are preserved (renaming a key would break view logic + deep links).
const modes = buttons.map((b) => b.mode);
ok(JSON.stringify(modes) === JSON.stringify(['street', 'satellite', 'impact']),
  'data-mode keys preserved as street | satellite | impact (got: ' + modes.join(' | ') + ')');

// The old label must be gone from the selector, and "Focus" must map to the
// schematic ("impact") view — the simplified HomeSignal map.
ok(!labels.includes('Impact'), 'no button is still labelled "Impact"');
const focus = buttons.find((b) => b.label === 'Focus');
ok(focus && focus.mode === 'impact', '"Focus" button drives the simplified (impact/schematic) view');

// The active-button state mechanism is intact: exactly one button carries class="on"
// at load, and the runtime toggles it by data-mode (setActiveMode) — unchanged here.
const onCount = [...(seg ? seg[1] : '').matchAll(/<button[^>]*class="on"[^>]*>/g)].length;
ok(onCount === 1, 'exactly one button is active by default (class="on")');

if (fails) { console.error('\n' + fails + ' assertion(s) failed'); process.exit(1); }
console.log('\nAll map-mode-selector assertions passed.');
