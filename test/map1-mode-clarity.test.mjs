// MAP 1 FIRST-LAUNCH CLARITY — can an ordinary homeowner tell the two modes apart?
//
// Map 1 has two geographies and they answer different questions:
//   ZIP mode      "what is happening anywhere in this entire ZIP?"
//   address mode  "what is happening within X miles of this home?"
// Both used to be captioned in ways that left that ambiguous, and there was no way back from
// address mode to the whole-ZIP view except editing the URL. These assert the resident-facing
// contract in the SHIPPED page and the SHIPPED note text. Presentation only - no data logic.
import { readFileSync } from 'node:fs';

let fails = 0;
const ok = (c, name, detail) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name);
  if (!c) { fails++; if (detail !== undefined) console.log('   got: ' + JSON.stringify(detail)); }
};
const PAGE = readFileSync(new URL('../homesignalmap.html', import.meta.url), 'utf8');
global.window = {};
new Function(readFileSync(new URL('../lib/zip-authoritative.js', import.meta.url), 'utf8'))();
const HS = global.window.HS;

// ── 1. ZIP mode names the ENTIRE ZIP, in the heading, before anything else ────────────────────
ok(/\$\("withinLbl"\)\.textContent = "All development across ZIP " \+ ZIP_CODE;/.test(PAGE),
   'ZIP heading reads "All development across ZIP <ZIP>"');
ok(/The entire ZIP — every project anywhere inside it/.test(PAGE),
   'ZIP subheading says "the entire ZIP", not "nearby"');
ok(!/textContent = "Across ZIP "/.test(PAGE),
   'the old ambiguous "Across ZIP" heading is gone');

// ── 2. Address mode names the radius AND the centre ───────────────────────────────────────────
ok(/"Showing development within " \+ radiusLabel\(CUR_RADIUS\) \+ " of"/.test(PAGE),
   'address heading reads "Showing development within <radius> of" + the address');

// ── 3. THE WAY BACK — the control the launch standard requires ────────────────────────────────
ok(/id="backToZip"/.test(PAGE), 'the back-to-ZIP control exists in the markup');
ok(/"← Back to all development in ZIP " \+ backZip/.test(PAGE),
   'it reads "Back to all development in ZIP <ZIP>"');
ok(/bz\.setAttribute\("href", "\?zip=" \+ encodeURIComponent\(backZip\)\)/.test(PAGE),
   'it navigates to the ZIP view, not to a dead anchor');
ok(/var backZip = ZIP_CODE \|\| addrZip;/.test(PAGE),
   'it prefers the ZIP the resident came from, falling back to the ZIP in the searched address');
ok(/body\.zipmode \.backzip\{display:none\}/.test(PAGE),
   'it is hidden in ZIP mode — no control that does nothing');
ok(/if\(\$\("backToZip"\)\) \$\("backToZip"\)\.style\.display = "none";/.test(PAGE),
   '...and hidden by render() too, so a mode switch cannot leave it stranded');
ok(/\} else \{ bz\.style\.display = "none"; \}/.test(PAGE),
   'no ZIP to return to -> no control, rather than a link that goes nowhere');

// ── 4. THE THREE STATES A HOMEOWNER MUST TELL APART ───────────────────────────────────────────
// A real zero, a ZIP nobody has measured, and a failed read are three different facts. If any
// two read alike the resident draws a false conclusion about their own neighbourhood.
const notMeasured = HS.zipAuthNote({ status: 'not_measured', projects: null, markers: null }, '01004', []);
const unknown     = HS.zipAuthNote({ status: 'unknown', projects: null, markers: null }, '01004', []);
const realZero    = HS.zipAuthNote({ status: 'boundary_complete', projects: [], markers: [] }, '01009', []);
const unavailable = HS.zipAuthNote(null, '99999', []);

ok(new Set([notMeasured, realZero, unavailable]).size === 3,
   'the three states are worded differently — none can be mistaken for another');
ok(notMeasured === unknown, 'both producer statuses (not_measured / unknown) read identically to the resident');

ok(/is not measured yet/.test(notMeasured), 'NOT MEASURED says so in plain words');
ok(/not showing development/i.test(notMeasured) && /rather show nothing than guess/i.test(notMeasured),
   'NOT MEASURED says we are withholding, not estimating');
ok(/street address/i.test(notMeasured), 'NOT MEASURED offers the resident a next step that works today');
ok(!/centroid|circle around the ZIP|ZIP centre|ZIP center/i.test(notMeasured),
   'NOT MEASURED carries no jargon a homeowner cannot parse', notMeasured);

ok(/whole of ZIP 01009/.test(realZero), 'REAL ZERO says what was checked');
ok(/real zero/i.test(realZero) && /not a search that came up empty/i.test(realZero),
   'REAL ZERO distinguishes itself from a failed search');

ok(/could not load/i.test(unavailable) && /temporary/i.test(unavailable),
   'UNAVAILABLE is named as our problem, not as an empty ZIP');
ok(/not a statement that the ZIP has nothing in it/i.test(unavailable),
   'UNAVAILABLE explicitly refuses to be read as zero');

// ── 5. A COUNTED ZIP still states the whole-ZIP claim at PROJECT grain (prior unit intact) ─────
const counted = HS.zipAuthNote(
  { status: 'boundary_complete', projects: [{ project_ref: 'a' }], markers: [] },
  '84029',
  [{ zip_project_ref: 'a' }, { zip_project_ref: 'a' }, { zip_project_ref: 'b' }]);
ok(/^2 projects across the whole of ZIP 84029/.test(counted),
   'a counted ZIP counts PROJECTS across the whole ZIP, not markers', counted);

// ── 6. NOTHING HERE TOUCHED GEOGRAPHY ─────────────────────────────────────────────────────────
ok(/var rows = HS\.zipAuthCollapseToProjects\(sites\);/.test(PAGE), 'project grain still in place');
ok(/drawMap\(data, sites\.filter\(/.test(PAGE), 'the map still draws every authoritative marker');
ok(!/ZIP_RADIUS|centroid/i.test(PAGE.split('function render(')[1].slice(0, 4000)),
   'no radius or centroid logic entered ZIP-mode rendering');

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
