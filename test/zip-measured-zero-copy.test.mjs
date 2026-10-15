// A MEASURED ZERO SAYS WHAT WAS MEASURED — founder wording, option B, 2026-10-14.
//
// 3,825 boundary_complete ZIPs have empty membership (measured 2026-10-14: 77 under 10 ha, 267
// 10-100, 721 100-1,000, 2,760 over 1,000; 76203 is 2.4 ha, 99557 is 3.57M ha). The area is not
// available to an anon page, so NO size claim is made. The sentence below is pinned WHOLE and
// applies ONLY to a complete read with no projects. not_measured / unknown / unavailable /
// non-empty are untouched ("never convert unknown to zero").
//
// Run: node test/zip-measured-zero-copy.test.mjs
import { readFileSync } from 'node:fs';
let fails = 0;
const ok = (c, name, d) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name); if (!c) { fails++; if (d !== undefined) console.log('   got: ' + JSON.stringify(d)); } };
global.window = {};
new Function(readFileSync(new URL('../lib/zip-authoritative.js', import.meta.url), 'utf8'))();
const HS = global.window.HS;

const sentence = (z) => 'No development records fall inside the Census boundary for ZIP ' + z
  + '. Enter a street address to see development around that address.';
const COMPLETE = { status: 'boundary_complete', projects: [], markers: [] };

for (const z of ['76203', '99557', '01009']) {
  ok(HS.zipAuthNote(COMPLETE, z, []) === sentence(z), '1 complete+empty ' + z + ' = founder text, whole', HS.zipAuthNote(COMPLETE, z, []));
}
ok(!/hectare|very small|qualifying|whole ZIP/i.test(HS.zipAuthNote(COMPLETE, '76203', [])), '2 no size claim, no retired wording');
ok(HS.zipAuthNote(COMPLETE, '', []).indexOf('for this ZIP.') !== -1, '3 no ZIP -> "this ZIP", no "undefined"', HS.zipAuthNote(COMPLETE, '', []));

// unchanged outcomes
ok(HS.zipAuthNote({ status: 'not_measured' }, '76202', []) === HS.zipNoMappedAreaFact('76202'), '4 not_measured keeps the no-mapped-area sentence');
ok(/is not measured yet/.test(HS.zipAuthNote({ status: 'unknown' }, '76202', [])), '5 unknown keeps "not measured yet"');
ok(/could not be read just now/.test(HS.zipAuthNote({ status: 'unavailable' }, '76202', [])), '6 unavailable keeps "could not be read"');
ok(HS.zipAuthNote(COMPLETE, '76201', [{ zip_project_ref: 'a' }, { zip_project_ref: 'b' }]) === '2 projects across the whole of ZIP 76201.', '7 complete+nonempty unchanged');
for (const st of ['not_measured', 'unknown', 'unavailable']) {
  ok(HS.zipAuthNote({ status: st }, '76202', []) !== sentence('76202'), '8 ' + st + ' never gets the measured-zero sentence');
}
process.exit(fails ? 1 : 0);
