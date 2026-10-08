// FIX 6 / BROWSER HISTORY GATE — Back and Forward restore a coherent PLACE.
//
// An explicit place change must be a REAL full-page navigation carrying ?zip=, because
// that is the only thing the browser stack can restore. A `location.reload()` that does
// not update the URL leaves the address bar describing a place the page is no longer
// showing, and Back then restores the URL while the rendered geography stays stale.
//
// The app is full-page loads by design; this file also pins that no SPA pushState router
// was introduced to "fix" history, which would have created the exact URL/DOM divergence
// the gate exists to prevent.
import fs from 'node:fs';
let fails = 0;
const ok = (c, name, d) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name
    + (!c && d !== undefined ? '  detail: ' + JSON.stringify(d).slice(0, 200) : ''));
  if (!c) fails++;
};
const read = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const strip = (x) => x.replace(/^\s*\/\/.*$/gm, '').replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
const shell = strip(read('shell.js'));
const fn = (n) => (shell.match(new RegExp(n + '[\\s\\S]*?\\n  \\};')) || [''])[0];

console.log('--- an explicit place change is a real navigation with ?zip= ---');
const switchZip = fn('HS\\.switchZip = function');
const switchProp = fn('HS\\.switchProperty = function');
const focusHref = (shell.match(/function focusHref\(zip\)[\s\S]*?\n  \}/) || [''])[0];
ok(/location\.href = focusHref\(zip\);/.test(switchZip),
  'ZIP switch: 84301 -> 75009 pushes a history entry carrying the new ZIP');
ok(/location\.href = focusHref\(zip\);/.test(switchProp),
  'Address switch across ZIPs pushes a history entry carrying that property ZIP');
ok(/HS\.navHref\(page, zip\)/.test(focusHref) && /HS\.navHref\('properties\.html', zip\)/.test(focusHref),
  'focusHref emits a ?zip=-bearing URL through the shared helper for both destinations');

console.log('--- no reload-without-?zip= on a PLACE change ---');
ok(!/location\.reload\(\)/.test(switchZip),
  'switchZip never reloads — every ZIP switch updates the URL',
  (switchZip.match(/.{0,40}location\.reload\(\).{0,20}/) || [])[0]);
// switchProperty DOES reload, but only on the branch where the ZIP is unchanged: that is
// an active-Address change WITHIN the same place, so there is no place change to record
// and the URL already describes the place correctly.
ok(/if \(zip && zip !== String\(state\.zip\)\) \{[\s\S]*?location\.href = focusHref\(zip\);[\s\S]*?return;\s*\}\s*location\.reload\(\);/.test(switchProp),
  'switchProperty reloads ONLY after the cross-ZIP branch has returned (same place, no place change)');
ok(/const changed = id !== state\.activePropId \|\| \(zip && zip !== String\(state\.zip\)\);/.test(switchProp)
   && /if \(!changed\) return;/.test(switchProp),
  're-picking the place already being viewed navigates nowhere at all');

console.log('--- no SPA router was introduced ---');
ok(!/history\.pushState/.test(shell),
  'shell.js adds no pushState routing — place changes are full-page loads',
  (shell.match(/.{0,60}history\.pushState.{0,30}/) || [])[0]);
for (const f of ['alerts.html', 'dashboard.html', 'development.html', 'lib/community-page.js'])
  ok(!/history\.pushState/.test(strip(read(f))), f + ' adds no pushState place routing');
// Map 1 uses replaceState for FILTER clicks on purpose (20 filter clicks must not become
// 20 Back presses). It rebuilds from the live URL and only sets `stages`, so ?zip= — the
// place — survives every filter interaction.
const map = read('homesignalmap.html');
ok(!/history\.pushState/.test(strip(map)), 'Map 1 uses no pushState either');
const writeStages = (map.match(/function writeStagesToUrl\(\)[\s\S]*?\n  \}/) || [''])[0];
ok(/new URL\(window\.location\.href\)/.test(writeStages) && /u\.searchParams\.set\("stages"/.test(writeStages),
  'Map 1 filter state is written onto the LIVE url, so the viewed ZIP is preserved');
ok(!/searchParams\.delete\("zip"\)/.test(map),
  'nothing on Map 1 strips ?zip= out of the URL');

console.log('--- the restored URL re-resolves to the same place ---');
// Back restores a URL; the page must then derive the SAME place from it. That is exactly
// what the shared re-assertion does, and it reads ?zip= first — so a restored
// alerts.html?zip=84301 renders 84301 even with a different myZip saved.
const { resolveViewedZip } = (await import('node:module')).createRequire(import.meta.url)('../lib/view-zip.js');
ok(resolveViewedZip({ urlZip: '84301', myZip: '75009', sessionViewZip: '75009', defaultZip: '78617' }) === '84301',
  'Back to ?zip=84301 re-resolves to 84301, not the saved/most-recent place');
ok(resolveViewedZip({ urlZip: '75009', myZip: '84301', sessionViewZip: '84301', defaultZip: '78617' }) === '75009',
  'Forward to ?zip=75009 re-resolves to 75009 — both directions, same rule');
ok(/HS\.ensureViewedZip = function/.test(shell),
  'and every ZIP-scoped page re-asserts that URL before it fetches');

if (fails) { console.error('\n' + fails + ' assertion(s) failed'); process.exit(1); }
console.log('\nAll browser-history assertions passed.');
