// FIX 9 — a monitored address is never presented as the user's home.
//
// Scope: SHIPPED IN-APP user-facing surfaces only. This guard must not fail on:
//   - internal identifiers (saveHome, isRealHome, myZip, stored tag:'Your home')
//   - historical docs / test descriptions of legacy behavior
//   - the frozen mock homesignalphase1_13.html
//   - marketing / SEO / acquisition copy explicitly excluded from Fix 9
//     (index.html, homesignalmap.html title/H1/OG, how-it-works.html, share.js)
//
// The shipped in-app UI may describe the CURRENT geography as "Viewing" and a
// stored address/ZIP as Address / ZIP Code. It must not assume ownership or
// residency. Collection names My Places / Your Places stay.
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
const stripInternal = (x) => strip(x)
  .replace(/p\.tag === 'Your home'/g, '')
  .replace(/\/\^\(your home\|my home\|home\)\$\/i/g, '')
  .replace(/'Your home'\s*:\s*'var\(--green\)'/g, '')
  .replace(/tag:'Your home'/g, '')
  .replace(/label:'Your home'/g, '');

const OWNERSHIP = /\b(?:your|my)\s+home\b/i;
const YOUR_PROPERTY = /\byour\s+propert(?:y|ies)\b/i;
const YOUR_RESIDENCE = /\byour\s+residence\b/i;
const EXTRA = [
  [/\bnear home\b/i, 'near home'],
  [/\bfrom home\b/i, 'from home'],
  [/\bthis home\b/i, 'this home'],
  [/Near-home/i, 'Near-home'],
];

// In-app operational surfaces. Not marketing, not frozen mockups, not docs.
const IN_APP_HTML = [
  'dashboard.html', 'properties.html', 'property.html', 'alerts.html',
  'partials/shell.html', 'reports.html', 'community.html', 'development.html',
];
const IN_APP_JS = [
  'shell.js', 'lib/map.js', 'lib/why.js', 'lib/impact.js', 'lib/zip-authoritative.js',
  'lib/templates.js',
];

function scanOwnership(label, body) {
  const homeHit = body.match(OWNERSHIP);
  ok(!homeHit, label + ' has no user-facing "your/my home"', homeHit && homeHit[0]);
  const propHit = body.match(YOUR_PROPERTY);
  ok(!propHit, label + ' has no user-facing "your property"', propHit && propHit[0]);
  const resHit = body.match(YOUR_RESIDENCE);
  ok(!resHit, label + ' has no user-facing "your residence"', resHit && resHit[0]);
  for (const [re, name] of EXTRA) {
    const hit = body.match(re);
    ok(!hit, label + ' has no user-facing "' + name + '"', hit && hit[0]);
  }
}

console.log('--- in-app HTML templates never assume the address is home ---');
for (const f of IN_APP_HTML) {
  scanOwnership(f + ' template', stripScripts(read(f)));
}

console.log('--- in-app scripts never assume the address is home ---');
for (const f of IN_APP_JS.concat(['dashboard.html', 'properties.html', 'property.html', 'alerts.html'])) {
  scanOwnership(f + ' runtime', stripInternal(read(f)));
}

console.log('--- current geography is Viewing, never Your home ---');
const shell = strip(read('shell.js'));
ok(/\$\('locLabel'\)\.textContent = \(p && homeIsCurrent\)\s*\?\s*\('Viewing · ' \+ p\.address\)/.test(shell),
  'address-in-view chip is "Viewing · <street>"');
ok(/'Viewing · ' \+ viewedLabel\(\)/.test(shell),
  'ZIP / area chip is "Viewing · <label>"');
ok(!/'Your home · '/.test(shell),
  'shell.js never concatenates "Your home · " into the chip');
ok(/function \(p, fallback\) \{[\s\S]*your home\|my home\|home/.test(shell),
  'placeDisplayTag maps stored Your home / my home / home tags to Address');
ok(/p\.tag === 'Your home'/.test(read('shell.js')),
  'isRealHome still recognises the stored tag (internal, not displayed)');
ok(/HS\.isRealHome\s*=\s*function/.test(read('shell.js')),
  'isRealHome identifier is unchanged (internal)');

console.log('--- dashboard header: chip names geography; #phWhere is absent ---');
const dashRaw = read('dashboard.html');
const dash = strip(dashRaw);
ok(/data-no-where/.test(dashRaw),
  'dashboard <body> sets data-no-where so #phWhere is not injected');
ok(/document\.body\.dataset\.noWhere != null/.test(shell),
  'paintWhereLine honors data-no-where (shared helper stays for other .ph pages)');
ok(!/id="phWhere"/.test(dashRaw),
  'dashboard.html does not itself render a #phWhere duplicate');
ok(/saved place/.test(dash) && /here\\'s what needs your attention across them/.test(dash),
  'dashboard subline uses "saved place(s)", not homes followed');
ok(!/Your home/.test(dash),
  'dashboard.html has no "Your home" after comment strip');
ok(/id="dashHi">Welcome back</.test(dash),
  'dashboard still greets with Welcome back (hierarchy unchanged)');
ok(/placeDisplayTag\(p, 'Address'\)/.test(dashRaw),
  'dashboard place rows use placeDisplayTag → Address, not stored Your home');

console.log('--- place type labels ---');
ok(/typeChip\('Address'\)/.test(read('properties.html')),
  'My Places address cards type as Address');
ok(/typeChip\('ZIP Code'\)/.test(read('properties.html')),
  'My Places ZIP cards type as ZIP Code');
ok(!/one home/.test(stripScripts(read('properties.html'))),
  'My Places intro does not call an Address "one home"');
ok(/HS\.placeDisplayTag\(p, 'Address'\)/.test(read('properties.html')),
  'My Places cards map stored home tags through placeDisplayTag');
ok(/HS\.placeDisplayTag\(home, 'Address'\)/.test(read('property.html')),
  'property eyebrow uses placeDisplayTag, not the stored Your home tag');
ok(!/home\.tag\|\|home\.label/.test(read('property.html')),
  'property.html no longer renders stored tag/label as the eyebrow');

console.log('--- add-address modal ---');
const shellHtml = strip(read('partials/shell.html'));
ok(/id="homeTitle">Add an address</.test(shellHtml),
  'add-address modal title is Add an address');
ok(/>Save this place</.test(shellHtml),
  'confirm action is Save this place');
ok(/<h4>Place saved</.test(shellHtml),
  'success copy is Place saved');
ok(!/Add your home/.test(shellHtml) && !/Save as my home/.test(shellHtml),
  'modal does not ask the user to add/save "your/my home"');

console.log('--- branding / geography contracts were not renamed ---');
ok(/Home<span style="color:var\(--green-2\)">Signal<\/span>/.test(shellHtml),
  'HomeSignal wordmark is unchanged');
ok(/>My Places</.test(shellHtml) || /data-nav="props"/.test(shellHtml),
  'My Places navigation is still present');
ok(/LS\.get\('myZip'/.test(shell),
  'myZip storage key is unchanged (internal)');
ok(/HS\.ensureViewedZip\s*=\s*function/.test(shell),
  'ensureViewedZip geography helper is unchanged');
ok(/HS\.saveHome\s*=\s*async function/.test(read('shell.js')),
  'saveHome writer name is unchanged (internal)');
ok(/id="homeModal"/.test(shellHtml),
  'homeModal element id is unchanged (internal)');
ok(/function paintTopbar\(\)/.test(shell) && /homeIsCurrent/.test(shell),
  'homeIsCurrent geography gate is still what paintTopbar uses');

console.log('--- multiple saved places are not collapsed into one home ---');
ok(/You have ' \+ n \+ ' place/.test(shell),
  'switcher counts places, not homes');
ok(/typeChip\('Address'\)/.test(shell) && /typeChip\('ZIP Code'\)/.test(shell),
  'switcher still distinguishes Address vs ZIP Code types');

console.log('--- in-app map / alerts / property operational copy ---');
const alerts = stripScripts(read('alerts.html'));
ok(/What needs your attention in this area/.test(alerts),
  'alerts H1 is "in this area", not "near home"');
const mapPage = strip(read('homesignalmap.html'));
ok(/>👁 From this place</.test(mapPage),
  '3D re-frame control is "From this place"');
ok(/mi from this address/.test(mapPage),
  'distance copy is "mi from this address"');
ok(/Address view/.test(mapPage),
  'address-mode eyebrow is "Address view"');
ok(/of this address/.test(mapPage),
  'map caption radius line uses "of this address"');
ok(!/\.pk'>Your home/.test(mapPage) && !/\.pk">Your home/.test(mapPage),
  'map popups do not label the saved-address pin "Your home"');
const prop = strip(read('property.html'));
ok(/Effect at this address/.test(prop),
  'property impact line is "Effect at this address"');
ok(!/Effect on this home/.test(prop),
  'property.html no longer says "Effect on this home"');
ok(!/your property/.test(prop + dash + shellHtml),
  'fix did not substitute "your property" for ownership language');
ok(!/Saved Place/.test(dash + stripScripts(read('properties.html')) + stripScripts(read('property.html')) + shellHtml),
  'A-002: management surfaces still do not say Saved Place');

console.log('--- marketing / SEO / acquisition copy is out of scope and left intact ---');
ok(/See what's being planned around your home/.test(read('index.html')),
  'index.html marketing title left intact');
ok(/Development around your home/.test(read('homesignalmap.html')),
  'homesignalmap.html marketing title/H1 left intact');
ok(/around your home/.test(read('how-it-works.html')),
  'how-it-works.html marketing copy left intact');
ok(/around your home/.test(read('share.js')),
  'share.js acquisition copy left intact');

if (fails) { console.error('\n' + fails + ' assertion(s) failed'); process.exit(1); }
console.log('\nAll Fix 9 ownership-language assertions passed.');
process.exit(0);
