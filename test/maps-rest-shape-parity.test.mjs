#!/usr/bin/env node
// Proves records AFTER the 16 lettered pins keep their resolved shape.
//
// WHY THIS EXISTS: `restFeatureCollection` used to compute the marker via
// resolveMarker() and then emit only `col` — the shape was dropped — and the GL
// layer was `type:'circle'`. So the first 16 (lettered) records drew their real
// symbol and EVERY record past them drew a circle regardless of type. On the live
// 78617 view that was 97 of 113 records: 73 of them had a correct non-circle shape
// computed and thrown away. Classification was never at fault.
//
// The corpus below is deliberately >16 mixed-type records so the lettered head and
// the rest tail are both populated, and asserts the tail behaves like the head.
//
// ANTI-FABRICATION: records whose source states no type and whose name yields no
// keyword MUST still be circles. A fix that made everything a polygon would be
// worse than the bug, so the honest fallback is asserted explicitly.
//
// Run: node test/maps-rest-shape-parity.test.mjs
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
const check = (name, cond, detail) => {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
};

global.window = {};
window.HS = {};
await import(join(root, 'lib/map.js'));
const HS = window.HS;
const REG = HS.CATEGORY_REGISTRY;

// 30 records — every canonical category, plus honest-fallback records, ordered so
// the interesting types land BOTH inside and outside the 16-letter head.
const mk = (i, type, name, kind) => ({
  id: 'r' + i, name, type, status: 'Approved', record_kind: kind || 'development',
  lat: 30.17 + i * 0.001, lng: -97.61 + i * 0.001,
});
const CORPUS = [
  mk(1, 'Commercial', 'Sonic Drive In-Ross Road'),
  mk(2, 'Residential', 'Los Cielos Sec 3'),
  mk(3, 'unclassified', 'AU01469E (BERRY)'),                 // honest fallback
  mk(4, 'Civic/Public', 'Del Valle Fire Station'),
  mk(5, 'Industrial', 'Colorado Bend Industrial'),
  mk(6, 'Utility', 'Pearce Lane Wastewater Lift Station'),
  mk(7, 'unclassified', 'Hyperscale data center campus'),    // -> datacenter octagon
  mk(8, 'industrial', 'DALFEN INDUSTRIAL', 'facility'),      // -> facility square
  mk(9, 'Commercial', "O'Reilly Auto Parts"),
  mk(10, 'Residential', 'Berdoll Farms Ph 2 Sec 1'),
  mk(11, 'unclassified', 'Caldwell Lane'),                   // honest fallback
  mk(12, 'Civic/Public', 'Del Valle High School Addition'),
  mk(13, 'Utility', 'Water and Wastewater Extension'),
  mk(14, 'Commercial', 'Pearce Retail Center'),
  mk(15, 'Residential', 'Oaks Ranch Section 2'),
  mk(16, 'Industrial', 'Burch Drive Industrial Park'),
  // ---- everything below here lands in the REST tail (position 17+) ----
  mk(17, 'Commercial', 'Ross Retail Center'),
  mk(18, 'Residential', 'Randall Ridge'),
  mk(19, 'Civic/Public', 'Los Cielos Neighborhood Park'),
  mk(20, 'Industrial', 'Austin Granite Warehouse'),
  mk(21, 'Utility', 'Central Texas Pipeline'),
  mk(22, 'unclassified', 'COTA Land'),                       // honest fallback
  mk(23, 'unclassified', 'ZYDECO DATA CENTER'),              // -> datacenter octagon
  mk(24, 'industrial', 'SAND HILL ENERGY CENTER', 'facility'),
  mk(25, 'Commercial', 'Dollar General - Ross Rd'),
  mk(26, 'Residential', 'Kellam Multi Family Phase 1'),
  mk(27, 'unclassified', 'Ida Mae Burch Estate; Partition of'), // honest fallback
  mk(28, 'Civic/Public', 'Del Valle I.S.D. Administration Building'),
  mk(29, 'Utility', 'Berdoll Detention Pond Improvements'),
  mk(30, 'Industrial', 'Clarius Industrial'),
];

check('corpus is larger than the 16-letter cap', CORPUS.length > 16, String(CORPUS.length));

const LETTERS = 'ABCDEFGHIJKLMNOP';
const lettered = CORPUS.slice(0, LETTERS.length);
const rest = HS.restAfterLetters(CORPUS, lettered);

console.log('\n-- the lettered head and the rest tail are both populated --');
check('16 lettered', lettered.length === 16, String(lettered.length));
check('14 in the rest tail', rest.length === CORPUS.length - 16, String(rest.length));

console.log('\n-- every rest feature CARRIES its resolved shape (the regression) --');
const fc = HS.restFeatureCollection(rest);
check('one feature per rest record', fc.features.length === rest.length);
check('every feature has a shape property',
  fc.features.every((f) => typeof f.properties.shape === 'string' && f.properties.shape));
check('every feature has an icon id', fc.features.every((f) => !!f.properties.icon));
check('every feature keeps its status colour (shape=type, colour=lifecycle)',
  fc.features.every((f) => /^#[0-9a-f]{6}$/i.test(f.properties.col)));

console.log('\n-- rest shapes equal what resolveMarker returns (head/tail parity) --');
{
  let mismatch = 0;
  rest.forEach((it, i) => {
    const want = HS.resolveMarker(it).shape;
    const got = fc.features[i].properties.shape;
    if (want !== got) { mismatch++; console.error(`      ${it.name}: want ${want} got ${got}`); }
  });
  check('no rest record renders a shape other than its resolved one', mismatch === 0,
    `${mismatch} mismatched`);

  // The core claim: position in the list must not change the shape.
  const byName = {};
  CORPUS.forEach((it) => { byName[it.name] = HS.resolveMarker(it).shape; });
  const headShapes = lettered.map((it) => byName[it.name]);
  const tailShapes = rest.map((it) => byName[it.name]);
  check('the tail uses the same shape vocabulary as the head',
    tailShapes.every((s) => Object.values(REG).some((c) => c.symbol === s)));
  check('head and tail both produce non-circle shapes',
    headShapes.some((s) => s !== 'circle') && tailShapes.some((s) => s !== 'circle'));
}

console.log('\n-- non-circle records do not render as circles --');
{
  const wrongly = rest.filter((it) => {
    const m = HS.resolveMarker(it);
    const f = fc.features.find((x) => x.properties.id === it.id);
    return m.shape !== 'circle' && f.properties.shape === 'circle';
  });
  check('zero classified rest records collapse to a circle', wrongly.length === 0,
    wrongly.map((w) => w.name).join(', '));
}

console.log('\n-- anti-fabrication: honest fallbacks are STILL circles --');
{
  const honest = rest.filter((it) => HS.resolveMarker(it).shapeRule === 'FALLBACK:other');
  check('the rest tail contains honest-fallback records', honest.length > 0, String(honest.length));
  honest.forEach((it) => {
    const f = fc.features.find((x) => x.properties.id === it.id);
    const m = HS.resolveMarker(it);
    check(`"${it.name}" stays a circle with a stated reason`,
      f.properties.shape === 'circle' && !!m.fallbackReason, m.fallbackReason || '(no reason)');
  });
}

console.log('\n-- regulated facility stays distinct from data center --');
{
  const fac = HS.resolveMarker(CORPUS.find((r) => r.name === 'SAND HILL ENERGY CENTER'));
  const dc = HS.resolveMarker(CORPUS.find((r) => r.name === 'ZYDECO DATA CENTER'));
  check('facility renders the registry square', fac.shape === REG.facility.symbol && fac.shape === 'square');
  check('data center renders the registry octagon', dc.shape === REG.datacenter.symbol && dc.shape === 'octagon');
  check('the two are visually different', fac.shape !== dc.shape);
  // and both survive into the rest layer
  const dcF = fc.features.find((f) => f.properties.id === 'r23');
  const facF = fc.features.find((f) => f.properties.id === 'r24');
  check('data center keeps the octagon in the REST layer', dcF && dcF.properties.shape === 'octagon');
  check('facility keeps the square in the REST layer', facF && facF.properties.shape === 'square');
}

console.log('\n-- Street / Satellite / Focus agree on shape --');
{
  // Street and Satellite share one code path (the GL rest features); Focus builds
  // its own complete set via plottedMarkerSet. Both must equal resolveMarker.
  const plotted = HS.plottedMarkerSet(CORPUS, [], [], { cap: 16 });
  check('Focus plots every record', plotted.length === CORPUS.length,
    `${plotted.length} vs ${CORPUS.length}`);
  let disagree = 0;
  plotted.forEach((p) => {
    const want = HS.resolveMarker(p.item).shape;
    if (p.shape !== want) disagree++;
    const f = fc.features.find((x) => x.properties.id === p.item.id);
    if (f && f.properties.shape !== want) disagree++;
  });
  check('Focus and the tile rest layer agree with resolveMarker on every record',
    disagree === 0, `${disagree} disagreements`);
}

console.log('\n-- icon specs are deterministic and cover every needed pair --');
{
  const specs = HS.restIconSpecs(fc);
  const needed = new Set(fc.features.map((f) => f.properties.icon));
  check('one spec per distinct (shape,colour) pair', specs.length === needed.size,
    `${specs.length} vs ${needed.size}`);
  check('every feature icon has a spec', fc.features.every((f) =>
    specs.some((s) => s.id === f.properties.icon)));
  check('spec ids are stable/deterministic',
    HS.restIconId('octagon', '#3f7fb0') === HS.restIconId('octagon', '#3f7fb0')
    && HS.restIconId('octagon', '#3f7fb0') !== HS.restIconId('square', '#3f7fb0'));
  check('every spec shape is a registry symbol',
    specs.every((s) => Object.values(REG).some((c) => c.symbol === s.shape)),
    specs.map((s) => s.shape).join(','));
  // Every spec must be renderable by the SAME builder the lettered pins use.
  check('markerSVG renders every spec shape',
    specs.every((s) => {
      const svg = HS.markerSVG(s.shape, s.color, '', 44);
      return typeof svg === 'string' && svg.indexOf('<svg') === 0
        && (svg.indexOf('<polygon') > -1 || svg.indexOf('<circle') > -1 || svg.indexOf('<rect') > -1);
    }));
}

console.log('\n-- legend matches what the rest layer actually draws --');
{
  const legendShapes = new Set((HS.markerRegistry.shapeLegend || []).map((r) => r.shape));
  const drawn = new Set(fc.features.map((f) => f.properties.shape));
  const missing = [...drawn].filter((s) => s !== REG.facility.symbol && !legendShapes.has(s));
  check('every shape the rest layer draws is explained by the legend', missing.length === 0,
    missing.join(', '));
}

// REMOVED 2026-09-04 with the retirement of the second map: this block read maps.html and
// asserted how THAT page wired the GL symbol layer, its Leaflet fallback and its
// __HS_REST_VERIFY hook. The page is now a redirect stub, so the assertions had no
// subject. Everything above this point tests lib/map.js — the shape/icon resolution that
// the primary map still uses through markerSVG/shapeEl — and is untouched.

if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log('\nAll maps-rest-shape-parity checks passed.');
