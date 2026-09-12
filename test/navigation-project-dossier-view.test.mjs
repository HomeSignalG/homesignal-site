// PROJECT DOSSIER — VIEWING NAMES THE LISTED STREET.
//
// PRODUCTION FAIL (founder-observed 2026-09-12): open
//   development.html?zip=78617&id=<Pearce Lane>
// and Viewing reads "ZIP 78617" while My Places already shows
// "11921 PEARCE LN · ZIP 78617" from the same project row's address field.
//
// ROOT CAUSE: development.html calls HS.ensureViewedZip() (area) and never
// HS.setViewLabel(p.address, { precise: true }). The Address dossier already
// does that for a saved home; a project dossier did not, so the chip could not
// name the record on screen.
//
// A project is NOT a saved Address: this page must not write myZip, must not
// insert app_properties, must not selectProperty, and must not fold projects
// into the Viewing switcher. Absent address stays absent.
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const { ZIP_NAV_PAGES } = require('../lib/view-zip.js');

let fails = 0;
const ok = (c, name, d) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name
    + (!c && d !== undefined ? '  detail: ' + JSON.stringify(d).slice(0, 220) : ''));
  if (!c) fails++;
};
const read = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const strip = (x) => x.replace(/^\s*\/\/.*$/gm, '').replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

const dev = strip(read('development.html'));
const props = strip(read('properties.html'));
const shell = strip(read('shell.js'));
const seed = read('seed/delvalle.js');

function fnBody(src, name) {
  return (src.match(new RegExp('function ' + name + '[\\s\\S]*?\\n  \\}')) || [''])[0];
}

console.log('--- the dossier names the listed street in Viewing ---');
ok(/function listedAddress\(rec\)/.test(dev) && /function applyRecordView\(rec\)/.test(dev),
  'listedAddress / applyRecordView exist so project and facility share one writer');
const listed = fnBody(dev, 'listedAddress');
const apply = fnBody(dev, 'applyRecordView');
ok(/rec\.address/.test(listed) && /String\(rec\.address\)\.trim\(\)/.test(listed),
  'listedAddress is the stored address field, trimmed');
ok(!/\.lat|\.lng|\.note/.test(listed + apply),
  'neither helper treats lat/lng or note as an address',
  (listed + apply).slice(0, 240));
ok(/HS\.setViewLabel\(addr, \{ precise: true \}\)/.test(apply),
  'applyRecordView marks the street precise so Gate 4 cannot replace it with a saved home');
ok(/HS\.state\.zip = String\(rec\.zip\)/.test(apply)
  && /\/\^\\d\{5\}\$\/\.test\(String\(rec\.zip\)\)/.test(apply),
  'viewed ZIP is written from the record only when it is a real 5-digit ZIP');

const detail = fnBody(dev, 'renderDetail');
const facility = fnBody(dev, 'renderFacility');
const list = fnBody(dev, 'renderList');
ok(/applyRecordView\(p\)/.test(detail),
  'project detail applies the listed location to Viewing');
ok(/applyRecordView\(f\)/.test(facility),
  'facility detail applies the listed location to Viewing');
ok(detail.indexOf('applyRecordView(p)') < detail.indexOf('HS.data.meetings'),
  'the chip updates as soon as the record resolves, before the meetings fetch paints');
ok(!/applyRecordView|setViewLabel/.test(list),
  'the Development LIST stays an area view — it does not name a project street',
  (list.match(/.{0,40}(applyRecordView|setViewLabel).{0,40}/) || [])[0]);

console.log('--- the same field My Places already shows ---');
ok(/function projectLocationLine\(p\)/.test(props) && /p\.address/.test(fnBody(props, 'projectLocationLine')),
  'My Places still reads p.address for the project location line (unregressed)');
ok(/listedAddr \? specRow\('Address', listedAddr\)/.test(detail),
  'when the record has a street, THE SPECS names it Address — the chip is not the only surface');
ok(/listedAddr \? specRow\('Address', listedAddr\)/.test(facility),
  'a facility with a listed street names it in Identity');

console.log('--- boundaries this fix must not cross ---');
ok(!/LS\.set\('myZip'/.test(dev) && !/\bmyZip\b/.test(dev),
  'the dossier never writes myZip — viewed geography only',
  (dev.match(/.{0,50}myZip.{0,30}/) || [])[0]);
ok(!/selectProperty/.test(dev),
  'a project is not elected as the saved Address');
ok(!/from\('app_properties'\)/.test(dev) && !/insert\(/.test(dev),
  'development.html does not write app_properties');
ok(/Addresses \(' \+ addresses\.length/.test(shell)
  && /ZIP Codes \(' \+ zips\.length/.test(shell),
  'Viewing switcher still lists Addresses + ZIP Codes only');
const switcher = (shell.match(/HS\.openSwitcher = function[\s\S]*?\n  \};/) || [''])[0];
ok(switcher.length > 200, 'openSwitcher body found');
ok(!/followedProjectIds/.test(switcher) && !/data-kind="project"/.test(switcher),
  'followed projects were not folded into the Viewing switcher');
ok(ZIP_NAV_PAGES.indexOf('development.html') >= 0,
  'development.html stays ZIP-scoped for the list and tool chrome');
ok(!/\baddress:/.test(seed.match(/id:'proj-datacenter'[\s\S]*?\},\s*\n\s*\{ id:'proj-giga'/) || [''])[0],
  'seed proj-datacenter still has no street — this fix does not invent one');

if (fails) { console.error('\n' + fails + ' assertion(s) failed'); process.exit(1); }
console.log('\nAll project-dossier Viewing assertions passed.');
