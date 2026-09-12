// THE ADDRESS DOSSIER MUST NEVER PAINT AN EMPTY SLOT.
//
// WHY THIS FILE EXISTS. Production (2026-09-11): a signed-in resident clicked
// 96 Island Drive in My Places and landed on
//   property.html?id=35aa4f34-50e6-4dca-8567-297e33bca300
// with Viewing still reading "ZIP 75009" and #propPage empty — no heading, no
// "No Address", no back button. The page starts as an empty <div id="propPage">
// and used to assign innerHTML only AFTER three awaits plus a render that called
// pr.status.toLowerCase() with no null guard. A throw or a hang before that
// assignment is byte-identical to "nothing comes up".
//
// Dashboard already wraps its data load in try/catch. This page did not.
// reports.html already refuses `|| activeProperty` when ?id= is present. This
// page did not — so a miss showed a different Address, or, when render then
// threw, a blank slot.
//
// Every check runs on comment-stripped source. A comment that names the defect
// must not be able to satisfy a pin that the defect is gone.
import fs from 'node:fs';
let fails = 0;
const ok = (c, name, d) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name
    + (!c && d !== undefined ? '  detail: ' + JSON.stringify(d).slice(0, 220) : ''));
  if (!c) fails++;
};
const read = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const strip = (x) => x.replace(/^\s*\/\/.*$/gm, '').replace(/<!--[\s\S]*?-->/g, '')
  .replace(/(^|[^:/])\/\*[\s\S]*?\*\//g, '$1');

const propRaw = read('property.html');
const prop = strip(propRaw);
const shell = strip(read('shell.js'));

// ── 1. Identity paints BEFORE the data awaits ────────────────────────────────
const loadIdx = prop.indexOf("id=\"propLoading\"");
const firstAwait = prop.search(/await Promise\.all|await HS\.data\.projects/);
ok(loadIdx > 0, '1a the Address chrome includes a loading line (propLoading)');
ok(firstAwait > 0, '1b there is still a data await — the dossier is not a static stub');
ok(loadIdx < firstAwait, '1c the loading chrome is assigned BEFORE the first data await',
  { loadIdx, firstAwait });
ok(/identityHtml\(p\)/.test(prop) && /Loading nearby records/.test(propRaw),
  '1d the heading is the saved Address, not an empty slot, while records load');

// ── 2. ?id= is an identity, never a fallback to some other Address ───────────
ok(/String\(x\.id\) === String\(id\)/.test(prop),
  '2a id match is String-coerced — UUID vs string must not miss');
ok(!/\|\| S\.activeProperty/.test(prop) && !/\|\| HS\.state\.activeProperty/.test(prop),
  '2b no activeProperty fallback when resolving ?id=',
  (prop.match(/.{0,50}activeProperty.{0,50}/) || [])[0]);
ok(/id\s*\n\s*\? \(S\.properties/.test(prop) || /id\s*\? \(S\.properties/.test(prop),
  '2c when ?id= is present, resolution is find-by-id only');
ok(/: S\.activeProperty/.test(prop),
  '2d with no ?id=, the page still opens the active Address');
ok(/<h1>No Address<\/h1>/.test(prop),
  '2e a miss still renders the named empty state, never a blank slot');

// ── 3. Fail closed on data/render, the way dashboard.html already does ────────
ok(/\[property\] data load failed/.test(prop) && /Could not load nearby records/.test(prop),
  '3a a failed read renders an honest retry, not an empty #propPage');
ok(/\[property\] render failed/.test(prop) && /Could not display this Address/.test(prop),
  '3b a render throw keeps the Address chrome and offers Try again');
ok(/try \{[\s\S]*Promise\.all\([\s\S]*projects\(zip, p\)/.test(prop),
  '3c the three record reads run together inside try/catch');

// ── 4. The production crash: null status on a live 75009 row ─────────────────
// Live 75009 (measured 2026-09-11): 470 development rows, 3 with status: null.
// The old `pr.status.toLowerCase()` threw TypeError and left the slot empty.
ok(!/\.status\.toLowerCase\(\)/.test(prop),
  '4a property.html never calls .status.toLowerCase() on a possibly-null field',
  (prop.match(/.{0,40}\.status\.toLowerCase.{0,40}/) || [])[0]);
ok(/String\(pr\.status \|\| ''\)\.toLowerCase\(\)/.test(prop),
  '4b status display is String(pr.status || \'\') — null becomes empty, not a throw');
function oldCrash(pr) { return pr.status.toLowerCase(); }
function guarded(pr) { return String(pr.status || '').toLowerCase(); }
let threw = false;
try { oldCrash({ status: null }); } catch (e) { threw = e instanceof TypeError; }
ok(threw, '4c control: the old expression throws TypeError on status: null');
ok(guarded({ status: null }) === '' && guarded({ status: 'Approved' }) === 'approved',
  '4d the new expression survives null and still lowercases a real status');

// ── 5. Nearby records are THIS Address's ZIP, not the viewed ZIP ─────────────
ok(/function dataZipFor\(home\)/.test(prop) && /home && home\.zip/.test(prop),
  '5a data ZIP is taken from the Address row');
ok(/HS\.data\.projects\(zip, p\)/.test(prop) && /HS\.data\.changes\(zip, p\)/.test(prop)
  && /HS\.data\.envRisk\(zip\)/.test(prop),
  '5b projects/changes/envRisk are called with that ZIP, not a hardcoded S.zip');
ok(!/HS\.data\.projects\(S\.zip/.test(prop) && !/HS\.data\.changes\(S\.zip/.test(prop),
  '5c S.zip is not the fetch key — that mixed 75009 TxDOT rows onto a 78657 home');
// 5d WAS TWO CLAIMS IN ONE ASSERTION, AND ONLY ONE OF THEM IS STILL TRUE.
// Its NAME is the myZip half, and that half is UNCHANGED and still asserted below:
// loading a dossier must never rewrite the resident's saved area (NAV-01).
// Its IMPLEMENTATION also banned every `state.zip =`, and that half is deliberately
// reversed by the P0 address-dossier fix (2026-09-12): the dossier is a PLACE-SELECTION,
// so it writes the VIEWED zip from the Address's own p.zip. Without that write the sidebar
// and the bell stamped whatever leftover session geography the tab held — from the Coomes
// dossier (78617) Alerts opened 78657, a different place.
// The blanket ban is NARROWED rather than dropped, so the protection it was really giving
// (no foreign geography written on this page) survives: the ONLY permitted geography write
// is from p.zip. 5a-5c above — the fetch key — are untouched and unaffected.
ok(!/LS\.set\('myZip'/.test(prop),
  '5d loading a dossier does not write myZip (NAV-01)');
const zipWrites = prop.match(/state\.zip\s*=\s*[^;]+/g) || [];
ok(zipWrites.length === 1 && /state\.zip = String\(p\.zip\)/.test(zipWrites[0]),
  '5d2 the dossier writes geography exactly once, and only from the ADDRESS\'s p.zip',
  zipWrites);

// ── 6. The Viewing chip names the Address this page is showing ───────────────
ok(/HS\.setViewLabel\(p\.address, \{ precise: true \}\)/.test(prop),
  '6a setViewLabel marks the street as a precise view, so the chip is not stuck on ZIP 75009');

// ── 7. Env rows and impact_dimensions fail closed ────────────────────────────
ok(/var r = env\[k\];\s*if \(!r\) return '';/.test(prop),
  '7a a missing flood/wildfire/heat key does not throw on r.tone');
ok(/Array\.isArray\(pr\.impact_dimensions\)/.test(prop),
  '7b a non-array impact_dimensions is normalised before the card renderer');

// ── 8. The map contract from PCM-5 is untouched ──────────────────────────────
ok(/var realAddress = pcmHasPoint\(p\) && !p\.sample && !p\.demo;/.test(prop),
  '8a the embed is still gated on a real point AND the demo-exclusion predicate');
ok(/<iframe id="propMapFrame"/.test(prop) && /homesignalmap\.html\?embed=1/.test(prop),
  '8b the context map is still an iframe of Map 1');
ok(/Generate property report/.test(propRaw)
  && /id="propReportBtn"/.test(propRaw)
  && /location\.href=\\'reports\.html\?id=' \+ encodeURIComponent\(p\.id\)/.test(propRaw),
  '8c the Generate-report CTA stays on this page, same label, same ?id= route');
ok(/id="propCols"/.test(propRaw) && prop.indexOf("'<div class=\"cols\" id=\"propCols\"><div>'") < prop.indexOf('+ contextMap'),
  '8d the Address map sits inside #propCols — not a full-width sibling that buries the CTA');

// ── 9. switchProperty on this page opens the Address URL, it does not reload
ok(/page === 'property.html' && p/.test(shell)
  && /property\.html\?id=' \+ encodeURIComponent\(p\.id\)/.test(shell),
  '9a from the dossier, picking another Address goes to property.html?id=');
const sw = (shell.match(/HS\.switchProperty = function[\s\S]*?\n  \};/) || [''])[0];
ok(sw.length > 200, '9b switchProperty body was found');
ok(!/if \(page === 'property.html'\) return HS\.navHref\('properties.html'/.test(sw),
  '9c switchProperty itself does not send an Address pick to My Places');

console.log(fails ? '\n' + fails + ' property-dossier-blank assertion(s) FAILED.' : '\nAll property-dossier-blank assertions passed.');
process.exit(fails ? 1 : 0);
