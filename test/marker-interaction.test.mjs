// Canonical marker interaction — hover tooltip + sidebar click path (lib/map.js).
// Run: node test/marker-interaction.test.mjs
let fails = 0;
const ok = (c, name) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name); if (!c) fails++; };

global.window = { HS: {}, document: { getElementById: function () { return null; } } };
await import('../lib/templates.js');
await import('../lib/map.js');
const HS = global.window.HS;

const project = { name: 'Project Nova', type: 'Data Center', status: 'Proposed', dist: '0.8 mi away' };
const facility = { name: 'Plant X', type: 'Industrial', _facility: true, status: 'Operating', dist: '1.2 mi' };

const hp = HS.markerHoverParts(project);
ok(hp.type === 'Data Center' && hp.name === 'Project Nova', 'hover parts: type + name only');
ok(!HS.markerHoverText(project).includes('Proposed'), 'hover text excludes status');
ok(!HS.markerHoverText(project).includes('0.8'), 'hover text excludes distance');
ok(!HS.markerHoverHTML(project).includes('Impact'), 'hover HTML excludes impact fields');

const fhp = HS.markerHoverParts(facility);
ok(fhp.type === 'Regulated facility' && fhp.name === 'Plant X', 'facility hover parts');

ok(HS.markerHoverIsClean('Data Center\nProject Nova'), 'clean hover passes');
ok(!HS.markerHoverIsClean('Project Nova · Proposed · 0.8 mi away'), 'rich hover fails clean check');

// Sidebar controller — select without navigation
let selected = null;
let opened = 0;
const sidebar = HS.createMapSidebar({
  onSelect: function (item) { selected = item; },
  onOpen: function () { opened++; }
});
const fakeEl = {
  addEventListener: function () {},
  setAttribute: function () {},
  getAttribute: function () { return null; },
  hasAttribute: function () { return false; },
  tabIndex: 0
};
sidebar.bindMarker(fakeEl, project);
sidebar.handleMarkerClick(project, { preventDefault: function () {}, stopPropagation: function () {} });
ok(selected === project, 'click handler selects item in sidebar');
ok(opened >= 1, 'click handler opens sidebar');

let navigated = false;
const orig = global.location;
global.location = { href: 'maps.html' };
sidebar.handleMarkerClick(facility, { preventDefault: function () {}, stopPropagation: function () {} });
ok(global.location.href === 'maps.html', 'click handler never changes location.href');
global.location = orig;

// Source-level regression: maps must not redirect on marker click.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const mapsSrc = readFileSync(join(root, 'maps.html'), 'utf8');
const trackerSrc = readFileSync(join(root, 'homesignalmap.html'), 'utf8');
const dashSrc = readFileSync(join(root, 'dashboard.html'), 'utf8');
ok(/function openItem\(it\) \{ if \(!it\) return; selectItem\(it\); \}/.test(mapsSrc), 'maps.html openItem delegates to sidebar only');
ok(!/bindPopup\(popupHTML/.test(trackerSrc), 'homesignalmap.html site markers have no popups');
ok(!/mouseenter[\s\S]*togglePopup/.test(trackerSrc), 'homesignalmap.html GL markers do not auto-open popups');
ok(/dashSidebar\.select/.test(dashSrc), 'dashboard.html uses sidebar for marker clicks');
ok(mapsSrc.includes('HS.attachMarkerHover'), 'maps.html uses shared hover attachment');
ok(trackerSrc.includes('HS.attachMarkerHover'), 'homesignalmap.html uses shared hover attachment');

if (fails) {
  console.error('\n' + fails + ' assertion(s) failed');
  process.exit(1);
}
console.log('\nAll marker-interaction tests passed.');
