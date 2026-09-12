// Clicking Development on a project dossier must stay on that dossier.
//
// PRODUCTION FAIL (founder-observed 2026-09-12): Pearce Lane was in Viewing, then
// the sidebar Development click opened the ZIP list (or leftover myZip 75009)
// because paintNavHrefs stamped development.html?zip= and dropped ?id=.
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const { pageHref, navHref } = require('../lib/view-zip.js');

let fails = 0;
const ok = (c, name, d) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name
    + (!c && d !== undefined ? '  detail: ' + JSON.stringify(d).slice(0, 220) : ''));
  if (!c) fails++;
};
const read = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const strip = (x) => x.replace(/^\s*\/\/.*$/gm, '').replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
const shell = strip(read('shell.js'));
const paint = (shell.match(/function paintNavHrefs\(\)[\s\S]*?\n  \}/) || [''])[0];
ok(paint.length > 200, 'paintNavHrefs body found');

const PEARCE = '4cb51a6a-14ac-4850-aef9-aaced7097719';
const ZIP = '78617';
const OLD = '75009';

console.log('--- Development self-link on a dossier keeps the record ---');
ok(/base === 'development.html' && dossierId && HS\.pageHref/.test(paint),
  'only the Development item, and only with a dossier id, uses pageHref');
const dossierHref = pageHref('development.html', { zip: ZIP, id: PEARCE });
ok(dossierHref === 'development.html?zip=' + ZIP + '&id=' + PEARCE
  || dossierHref === 'development.html?id=' + PEARCE + '&zip=' + ZIP,
  'pageHref carries zip AND id for the dossier self-link', dossierHref);
ok(dossierHref.indexOf(OLD) < 0, 'the self-link does not carry leftover myZip');

console.log('--- other tools stay zip-only; the list stays a list ---');
ok(navHref('alerts.html', ZIP) === 'alerts.html?zip=' + ZIP, 'Alerts from the dossier is still area-scoped');
ok(navHref('dashboard.html', ZIP) === 'dashboard.html?zip=' + ZIP, 'Dashboard from the dossier is still area-scoped');
ok(navHref('development.html', ZIP) === 'development.html?zip=' + ZIP
  && navHref('development.html', ZIP).indexOf('id=') < 0,
  'the Development LIST href (no dossier id) still has no record id');

console.log('--- Back to development remains the list ---');
const dev = strip(read('development.html'));
ok(/HS\.navHref\('development.html', S\.zip\)/.test(dev),
  'Back to development still uses navHref(list), not the dossier self-link');

if (fails) { console.error('\n' + fails + ' assertion(s) failed'); process.exit(1); }
console.log('\nAll development-dossier sidebar assertions passed.');
