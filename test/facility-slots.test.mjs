// Pins HS.reserveFacilitySlots: the maps.html shownItems() floor that guarantees the
// closest regulated facilities get lettered slots alongside development. The 78617
// default view must letter >= min(4, #facilities) facilities AND include DALFEN.
// (Sandbox has no egress, so the live 78617 shape is represented by the fixture below;
// the end-to-end live check is verify-development CI.) Run: node test/facility-slots.test.mjs
let fails = 0;
const ok = (c, name) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name); if (!c) fails++; };

global.window = { HS: {} };
await import('../lib/map.js');
const HS = global.window.HS;
const LET = 'ABCDEFGHIJKLMNOP';

// --- 78617-shaped fixture: 6 regulated facilities (incl. DALFEN) + 8 development records.
const facs78617 = [
  { id: 'f-dalfen', name: 'DALFEN INDUSTRIAL - DEL VALLE', type: 'Regulated facility', lat: 30.18, lng: -97.62, distance_mi: 0.8 },
  { id: 'f-tesla',  name: 'Tesla Del Valle',   lat: 30.19, lng: -97.61, distance_mi: 1.1 },
  { id: 'f-metals', name: 'ABC Metals',        lat: 30.20, lng: -97.60, distance_mi: 1.4 },
  { id: 'f-plant',  name: 'XYZ Plant',         lat: 30.21, lng: -97.59, distance_mi: 2.0 },
  { id: 'f-gravel', name: 'Gravel Pit',        lat: 30.22, lng: -97.58, distance_mi: 2.6 },
  { id: 'f-water',  name: 'Water Plant',       lat: 30.23, lng: -97.57, distance_mi: 3.0 },
];
const dev78617 = Array.from({ length: 8 }, (_, i) => ({
  id: 'd' + i, name: 'Permit ' + i, type: 'permit', status: 'Proposed',
  lat: 30.17 + i * 0.005, lng: -97.63 + i * 0.005, distance_mi: 0.3 + i * 0.28,
}));
// A dev record that DUPLICATES a facility id — proves de-dupe (facility wins, appears once).
dev78617.push({ id: 'f-tesla', name: 'stale tesla permit', type: 'permit', distance_mi: 0.5 });

const out = HS.reserveFacilitySlots(dev78617, facs78617, { cap: 16, floor: 4, letters: LET });
const facsShown = out.filter(x => x._facility);

// --- The pinned assertions ---
ok(out.length <= 16, 'respects the 16-slot cap (got ' + out.length + ')');
ok(facsShown.length >= Math.min(4, facs78617.length),
   '>= min(4, #facilities) facilities are lettered (got ' + facsShown.length + ' of floor ' + Math.min(4, facs78617.length) + ')');
const dalfen = out.find(x => /DALFEN/.test(x.name || ''));
ok(!!dalfen, 'DALFEN present in the 78617 default shownItems set');
ok(dalfen && dalfen._facility === true && !!dalfen._letter,
   'DALFEN is flagged _facility and carries a map letter (' + (dalfen && dalfen._letter) + ')');
ok(out.every((x, i) => x._letter === LET[i]),
   'every shown item is lettered A.. in order (no gaps, no dupes)');

// --- de-dupe: the id shared by a facility and a dev record appears exactly once, as the facility ---
const tesla = out.filter(x => x.id === 'f-tesla');
ok(tesla.length === 1, "shared id 'f-tesla' appears exactly once (de-duped)");
ok(tesla[0] && tesla[0]._facility === true && tesla[0].name === 'Tesla Del Valle',
   'the surviving f-tesla is the FACILITY, not the stale dev dup');

// --- floor scales down when facilities are scarce (min, not a fixed 4) ---
const scarce = HS.reserveFacilitySlots(dev78617, facs78617.slice(0, 2), { cap: 16, floor: 4, letters: LET });
ok(scarce.filter(x => x._facility).length === 2,
   'floor = min(4, #facilities): 2 facilities available -> exactly 2 reserved');

// --- no facilities -> all development, still lettered, never throws ---
const none = HS.reserveFacilitySlots(dev78617, [], { cap: 16, floor: 4, letters: LET });
ok(none.filter(x => x._facility).length === 0 && none.length > 0 && none[0]._letter === 'A',
   'zero facilities -> development-only lettered list (no floor to fill)');

if (fails) { console.error(`\n${fails} failed`); process.exit(1); }
console.log('\nAll facility-slot assertions passed.');
