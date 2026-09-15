// FIX 6 / GATE 4 — TOOL vs PLACE IN THE UI.
//
//     Sidebar = which TOOL.     Viewing = which PLACE.
//
// The ZIP hub deliberately highlights NO sidebar tool (data-nav="comm"), which makes the
// Viewing control the only thing on the page that says where the resident is looking —
// and "ZIP 84301" is a code, not a place.
//
// DELIBERATELY NOT DUPLICATED HERE: that the sidebar is exactly four containers, that
// community.html declares "comm" and highlights nothing, and that the generator stamps
// the same token, are all already pinned by test/nav-identity.test.mjs (A-021). A second
// copy of a pin drifts from the first; this file asserts only what Fix 6 adds — place
// IDENTIFICATION — plus a guard that Fix 6 did not grow the sidebar.
import fs from 'node:fs';
let fails = 0;
const ok = (c, name, d) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name
    + (!c && d !== undefined ? '  detail: ' + JSON.stringify(d).slice(0, 200) : ''));
  if (!c) fails++;
};
const read = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const strip = (x) => x.replace(/^\s*\/\/.*$/gm, '').replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
const cpage = strip(read('lib/community-page.js'));
const shell = strip(read('shell.js'));
const shellHtml = strip(read('partials/shell.html'));

console.log('--- the ZIP hub names its place in the Viewing control ---');
ok(/HS\.setViewLabel\(String\(meta\.name\)\.indexOf\(String\(zip\)\) >= 0/.test(cpage)
   && /meta\.name \+ ' · ' \+ zip/.test(cpage),
  'the ZIP hub identifies the place by its locality name, adding the ZIP only when the name lacks it');
ok(/meta && meta\.name && HS\.setViewLabel/.test(cpage),
  'it is guarded on real metadata — no locality, no claim');
// Locality comes from application metadata. A hard-coded city would be a fabricated place
// name on all ~12,722 generated ZIP documents.
ok(!/Bear River City|Del Valle|Brigham City/.test(cpage),
  'no hard-coded city name in the ZIP-hub runtime',
  (cpage.match(/Bear River City|Del Valle|Brigham City/) || [])[0]);
// Set BEFORE the coverage branch, so an honest-empty ZIP is identified too rather than
// silently falling back to "ZIP #####" exactly where the page has least else to say.
const at = cpage.indexOf('HS.setViewLabel(String(meta.name)');
const branch = cpage.indexOf("if (status !== 'pass')");
ok(at > 0 && branch > 0 && at < branch,
  'the place is named BEFORE the coverage branches, so honest-empty pages are named too',
  { at, branch });

console.log('--- A ZIP PAGE IS A ZIP PLACE (founder, 2026-09-15) ---');
// The Viewing control answers "which of my Places am I looking at". On the ZIP hub that
// is the ZIP Code — including for a resident whose saved Address sits inside that very
// ZIP, which is the case the 2026-09-04 cross-ZIP gate left showing "Viewing · 13313
// COOMES DR" on /community.html?zip=78617. The page DECLARES its Place type; the chip
// must not infer it from whether a text label happened to load.
ok(/HS\.setViewPlaceType\('zip'\)/.test(cpage),
  'the ZIP hub declares itself a ZIP Place');
const declAt = cpage.indexOf("HS.setViewPlaceType('zip')");
ok(declAt > 0 && declAt < cpage.indexOf('await'),
  'it declares BEFORE the first await, so the chip is never briefly the saved address',
  { declAt, firstAwait: cpage.indexOf('await') });
ok(!/setViewLabel\(meta\.name[^)]*\{\s*precise/.test(cpage),
  'the ZIP-hub label is still an AREA label, never flagged precise');
ok(/const homeIsCurrent = !!\(p && String\(p\.zip\) === String\(state\.zip\)\s*\n?\s*&& state\.viewPlaceType !== 'zip' && !state\.viewLabelPrecise\);/.test(shell),
  'paintTopbar gates the address label on the viewed ZIP AND on the page not being a ZIP Place');
ok(/\(p && homeIsCurrent\)\s*\?\s*\('Viewing · ' \+ p\.address\)/.test(shell),
  'where the page declares no ZIP Place, a saved address in the viewed ZIP still reads "Viewing · <street>"');
ok((shell.match(/state\.viewPlaceType !== 'zip'/g) || []).length === 2,
  'the switcher check-mark uses the SAME gate as the chip — one rule, never two');
ok(!/'Your home · '/.test(shell),
  'paintTopbar never prefixes the chip with "Your home · "');

console.log('--- the label lives in the shared shell, not a page-local string ---');
ok(/HS\.setViewLabel = function/.test(shell) && /function viewedLabel\(\)/.test(shell),
  'setViewLabel / viewedLabel are shell-level, so every page identifies place the same way');
ok(/return state\.viewLabel \|\| \('ZIP ' \+ state\.zip\)/.test(shell),
  'with no locality metadata the control falls back to the ZIP alone — never a guess');
ok(!/locLabel/.test(cpage),
  'the ZIP hub does not write the top-bar label directly — it goes through the shared API',
  (cpage.match(/.{0,40}locLabel.{0,40}/) || [])[0]);

console.log('--- Fix 6 did not grow the sidebar or add a place label to it ---');
const navBlock = (shellHtml.match(/<nav class="nav" id="hs-nav">[\s\S]*?<\/nav>/) || [''])[0];
ok(navBlock.length > 0, 'the sidebar block was found');
ok((navBlock.match(/<a /g) || []).length === 4,
  'the sidebar is still EXACTLY FOUR tools', (navBlock.match(/data-nav="[a-z]+"/g) || []));
ok(!/data-nav="comm"/.test(navBlock),
  'the ZIP hub is still not a fifth sidebar container');
// A persistent sidebar place label is explicitly deferred — the place lives in Viewing.
ok(!/state\.zip|viewedLabel|locLabel|setViewLabel/.test(navBlock),
  'no place label was added to the sidebar in this unit', navBlock.slice(0, 120));
ok(/data-nav="comm"/.test(strip(read('community.html'))),
  'community.html still declares comm (A-021 owns the full pin)');
ok(!/data-nav="dev"/.test(strip(read('community.html'))),
  'the ZIP hub does not pretend to be Development because it contains a map');

if (fails) { console.error('\n' + fails + ' assertion(s) failed'); process.exit(1); }
console.log('\nAll Gate 4 place-identity assertions passed.');
