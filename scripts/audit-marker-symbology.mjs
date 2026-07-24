// Backbone marker-symbology audit — replays the REAL HS.resolveMarker (lib/map.js)
// against the COMPLETE production (record_kind, type, status) universe of app_projects
// and reports, with counts, exactly what symbol every production record resolves to.
//
// The universe below is a DB-pulled snapshot (provenance in the header) so this runs
// offline and deterministically in CI; regenerate with the SQL in
// docs/maps-marker-symbology-audit-2026-07-24.md when the universe changes.
//
//   Run: node scripts/audit-marker-symbology.mjs
//
// It is a PROOF, not a lint: it asserts (and exits non-zero on) the invariants the
// 2026-07-24 audit established — no development record ever resolves to the regulated
// (purple) icon, and every record resolves to a canonical status color.

global.window = { HS: {} };
await import('../lib/templates.js');
await import('../lib/map.js');
const HS = global.window.HS;
const FAC = HS.markerRegistry.facilityHex;

// ── production universe snapshot ────────────────────────────────────────────────────
// Source: app_projects, project qwnnmljucajnexpxdgxr, pulled 2026-07-24.
//   select record_kind, coalesce(type,'∅NULL'), coalesce(status,'∅NULL'), count(*)
//   from app_projects group by 1,2,3;
const UNIVERSE = [
  ['development', 'Development', 'Approved', 283367], ['development', 'Residential', 'Approved', 61245],
  ['development', 'unclassified', 'Approved', 39291], ['development', 'Development', 'Operating', 37640],
  ['development', 'Commercial', 'Approved', 32143], ['development', 'unclassified', 'Operating', 19577],
  ['development', 'Trades', 'Approved', 15669], ['development', 'Residential', 'Operating', 10714],
  ['development', 'Residential', 'Proposed', 5529], ['development', 'Development', 'Proposed', 4678],
  ['development', 'Commercial', 'Operating', 1914], ['development', 'Commercial', 'Proposed', 1765],
  ['development', 'unclassified', 'Proposed', 1309], ['development', 'Civic/Public', 'Approved', 303],
  ['development', 'Utility', 'Approved', 281], ['development', 'Industrial', 'Approved', 214],
  ['development', 'Land use', 'Operating', 82], ['development', 'Industrial', 'Proposed', 63],
  ['development', 'Industrial', 'Operating', 38], ['development', 'Utility', 'Proposed', 22],
  ['development', 'Civic/Public', 'Proposed', 21], ['development', 'Utility', 'Operating', 11],
  ['development', 'Land use', 'Approved', 10], ['development', 'Civic/Public', 'Operating', 5],
  ['development', 'commercial', 'On file', 2], ['development', 'animal-facility', 'On file', 1],
  ['development', 'industrial', 'On file', 1], ['development', 'research', 'On file', 1],
  ['facility', 'industrial', 'Operating', 155532], ['facility', 'energy', 'Operating', 37649],
  ['facility', 'logistics', 'Operating', 24026], ['facility', 'datacenter', 'Operating', 761],
];

const STATUS_EXPECT = { Proposed: '#c47a1a', Approved: '#3f7fb0', Operating: '#1f9d5c', 'On file': '#6b7f76' };
let records = 0, correctColor = 0, purpleOnDev = 0, devCircle = 0, fails = 0;
const byShape = {}, byColor = {};
console.log('records  record_kind  type            status     => shape     color    legend');
for (const [kind, type, status, n] of UNIVERSE) {
  const item = kind === 'facility' ? { type, status, record_kind: 'facility' } : { type, status };
  const m = HS.resolveMarker(item);
  const expect = kind === 'facility' ? FAC : STATUS_EXPECT[status];
  records += n;
  if (m.color === expect) correctColor += n;
  if (kind === 'development' && m.color === FAC) purpleOnDev += n;
  if (kind === 'development' && m.shape === 'circle') devCircle += n;
  byShape[m.shape] = (byShape[m.shape] || 0) + n;
  byColor[m.color] = (byColor[m.color] || 0) + n;
  console.log(String(n).padStart(7) + '  ' + kind.padEnd(11) + '  ' + type.padEnd(14) + '  ' +
    String(status).padEnd(9) + ' => ' + m.shape.padEnd(9) + ' ' + m.color + '  ' + m.legendLabel);
}
const devTotal = UNIVERSE.filter(u => u[0] === 'development').reduce((a, u) => a + u[3], 0);
console.log('\n--- TOTALS ---');
console.log('records                        :', records);
console.log('correct status/facility color  :', correctColor, '(' + (100 * correctColor / records).toFixed(3) + '%)');
console.log('DEV records painted PURPLE      :', purpleOnDev, '(regulated icon on a non-facility)');
console.log('DEV records → circle "Other"    :', devCircle, '(' + (100 * devCircle / devTotal).toFixed(1) + '% of dev — generic SOURCE type, honest neutral shape)');
console.log('by shape                        :', JSON.stringify(byShape));
console.log('by color                        :', JSON.stringify(byColor));

// ── invariants (fail the build if the backbone ever regresses) ──────────────────────
const assert = (c, name) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name); if (!c) fails++; };
console.log('\n--- INVARIANTS ---');
assert(purpleOnDev === 0, 'no development record resolves to the regulated (purple) icon');
assert(correctColor === records, 'every record resolves to its canonical status/facility color');
assert((byColor[FAC] || 0) === UNIVERSE.filter(u => u[0] === 'facility').reduce((a, u) => a + u[3], 0),
  'purple is used for exactly the facility records, no more no fewer');
if (fails) { console.error('\n' + fails + ' invariant(s) failed'); process.exit(1); }
console.log('\nBackbone marker classification is canonical across the full production universe.');
