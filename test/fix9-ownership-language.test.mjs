// FIX 9 — a monitored address is never presented as the user's home.
//
// The shipped UI may describe the CURRENT geography as "Viewing" and a stored
// address/ZIP as a saved place. It must not assume ownership or residency.
// Internal identifiers (isRealHome, saveHome, homeModal, myZip, stored
// tag:'Your home') stay — they are not user-facing copy.
//
// Run: node test/fix9-ownership-language.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let fails = 0;
const ok = (c, name, d) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name
    + (!c && d !== undefined ? '  detail: ' + JSON.stringify(d).slice(0, 240) : ''));
  if (!c) fails++;
};
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const strip = (x) => x
  .replace(/^\s*\/\/.*$/gm, '')
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '');
const stripScripts = (x) => strip(x).replace(/<script\b[\s\S]*?<\/script>/gi, '');
const OWNERSHIP = /\b(?:your|my)\s+home\b/i;
const YOUR_PROPERTY = /\byour\s+propert(?:y|ies)\b/i;

const FROZEN_MOCK = 'homesignalphase1_13.html';
const htmlPages = fs.readdirSync(root).filter((f) => f.endsWith('.html') && f !== FROZEN_MOCK)
  .concat(fs.readdirSync(path.join(root, 'partials')).filter((f) => f.endsWith('.html')).map((f) => 'partials/' + f));

console.log('--- shipped HTML (templates, not scripts) never assumes the address is home ---');
for (const f of htmlPages) {
  const body = stripScripts(read(f));
  const homeHit = body.match(OWNERSHIP);
  ok(!homeHit, f + ' has no user-facing "your/my home"', homeHit && homeHit[0]);
  const propHit = body.match(YOUR_PROPERTY);
  ok(!propHit, f + ' has no user-facing "your property"', propHit && propHit[0]);
}

console.log('--- current geography is Viewing, never Your home ---');
const shell = strip(read('shell.js'));
ok(/\$\('locLabel'\)\.textContent = \(p && homeIsCurrent\)\s*\?\s*\('Viewing · ' \+ p\.address\)/.test(shell),
  'address-in-view chip is "Viewing · <street>"');
ok(/'Viewing · ' \+ viewedLabel\(\)/.test(shell),
  'ZIP / area chip is "Viewing · <label>"');
ok(!/'Your home · '/.test(shell),
  'shell.js never concatenates "Your home · " into the chip');
ok(/el\.textContent = 'Viewing · ' \+ HS\.homeAddressLine\(p\)/.test(shell),
  'dashboard where-line is "Viewing · <full address>"');
ok(/function \(p, fallback\) \{[\s\S]*your home\|my home\|home/.test(shell),
  'placeDisplayTag maps stored Your home / my home / home tags to Address');
ok(/p\.tag === 'Your home'/.test(shell),
  'isRealHome still recognises the stored tag (internal, not displayed)');

console.log('--- dashboard + modal copy ---');
const dash = strip(read('dashboard.html'));
ok(/saved place/.test(dash) && /here\\'s what needs your attention across them/.test(dash),
  'dashboard subline uses "saved place(s)", not homes followed');
ok(!/Your home/.test(dash),
  'dashboard.html has no "Your home" after comment strip');
ok(/id="dashHi">Welcome back</.test(dash),
  'dashboard still greets with Welcome back (hierarchy unchanged)');
const shellHtml = strip(read('partials/shell.html'));
ok(/id="homeTitle">Add an address</.test(shellHtml),
  'add-address modal title is Add an address');
ok(/>Save this place</.test(shellHtml),
  'confirm action is Save this place');
ok(/<h4>Place saved</.test(shellHtml),
  'success copy is Place saved');

console.log('--- branding / geography contracts were not renamed ---');
ok(/Home<span style="color:var\(--green-2\)">Signal<\/span>/.test(shellHtml),
  'HomeSignal wordmark is unchanged');
ok(/>My Places</.test(shellHtml) || /data-nav="props"/.test(shellHtml),
  'My Places navigation is still present');
ok(/LS\.get\('myZip'/.test(shell),
  'myZip storage key is unchanged (internal)');
ok(/HS\.ensureViewedZip\s*=\s*function/.test(shell),
  'ensureViewedZip geography helper is unchanged');
ok(/HS\.saveHome\s*=\s*async function/.test(shell),
  'saveHome writer name is unchanged (internal)');
ok(/id="homeModal"/.test(shellHtml),
  'homeModal element id is unchanged (internal)');

console.log('--- multiple saved places are not collapsed into one home ---');
ok(/You have ' \+ n \+ ' place/.test(shell),
  'switcher counts places, not homes');
ok(/typeChip\('Address'\)/.test(shell) && /typeChip\('ZIP Code'\)/.test(shell),
  'switcher still distinguishes Address vs ZIP Code types');

if (fails) { console.error('\n' + fails + ' assertion(s) failed'); process.exit(1); }
console.log('\nAll Fix 9 ownership-language assertions passed.');
process.exit(0);
