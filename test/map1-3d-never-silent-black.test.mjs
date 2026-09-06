// MAP 1 — A 3D VIEW MUST NEVER PRESENT AS A SILENT BLACK RECTANGLE.
//
// THE DEFECT THIS LOCKS DOWN (reproduced against the real page, 2026-09-06)
//   homesignalmap.html offers two WebGL views layered over a dark panel (#0a1012):
//   3D aerial (three.js) and 3D satellite (MapLibre GL). setView() revealed that panel
//   BEFORE the library initialised, and the lazy loader ran its callback inside a bare
//   `try{ fn(); }catch(e){}`. So any initialisation failure left the panel's own
//   background on screen — a completely black rectangle — with the explanation discarded.
//
//   Two failure classes were measured, both producing exactly that:
//     * NO WEBGL. With getContext('webgl') returning null — one REPRODUCED trigger, whose
//       causes are many (blocked/unavailable WebGL, no hardware acceleration, a driver
//       denylist, a virtualised GPU, an older mobile device) — three.js r132 THROWS
//       "Error creating WebGL context." and MapLibre 4.7.1 throws "Failed to initialize
//       WebGL". BOTH 3D views go black while the 2D Leaflet map, which needs no WebGL,
//       keeps working. The trigger is not attributed to any one browser.
//     * NON-FINITE HOME. render() can pass {lat:null,lng:null} (the branch for a ZIP with
//       authoritative geography but no cached development_reports row). MapLibre's
//       constructor then throws "Invalid LngLat object: (NaN, NaN)" — captured verbatim
//       from the shipped bundle's stack.
//
// THE TRAP A NAIVE FIX FALLS INTO, and why §3 is the load-bearing half:
//   isFinite(null) is TRUE, because Number(null) is 0. A guard written as
//   `isFinite(h.lat) && isFinite(h.lng)` therefore waves {lat:null,lng:null} straight
//   through to MapLibre and back into the black panel it was added to prevent. That was
//   written, measured failing, and corrected — so the test pins the typeof half directly.
//
// Offline: loads the REAL lib/map.js and reads the REAL page source. No network, no DB.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0;
const ok = (c, name, detail) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name);
  if (!c) { fails++; if (detail !== undefined) console.log('           detail: ' + JSON.stringify(detail)); }
};

const win = { HS: {} };
globalThis.window = win;
globalThis.document = { getElementById: () => null };
new Function('window', 'document', readFileSync(join(root, 'lib/map.js'), 'utf8'))(win, globalThis.document);
const HS = win.HS;
const page = readFileSync(join(root, 'homesignalmap.html'), 'utf8');

// ── §1 the capability probe answers the question the 3D views actually ask ──────────────
const docWith = (ctx) => ({ createElement: () => ({ getContext: ctx }) });
ok(typeof HS.webglSupported === 'function', '§1 HS.webglSupported is exported');
ok(HS.webglSupported(docWith((t) => (t === 'webgl' ? {} : null))) === true,
  '§1 a browser that grants a webgl context reports supported');
ok(HS.webglSupported(docWith((t) => (t === 'webgl2' ? {} : null))) === true,
  '§1 webgl2 alone is enough');
// The measured shape: the API exists, the context is refused. Presence != capability.
ok(HS.webglSupported(docWith(() => null)) === false,
  '§1 a browser that REFUSES the context reports unsupported — presence of the API is not capability');
ok(HS.webglSupported({ createElement: () => ({}) }) === false,
  '§1 a canvas with no getContext reports unsupported');
// A probe that can throw is a second failure mode, so it must swallow its own errors only.
ok(HS.webglSupported(docWith(() => { throw new Error('blocked'); })) === false,
  '§1 a throwing getContext returns false rather than propagating');
ok(HS.webglSupported(null) === false, '§1 no document reports unsupported, never throws');

// ── §2 the failure copy is BROWSER-NEUTRAL and never asks anyone to weaken a setting ────
// Founder ruling, 2026-09-06. HomeSignal must work across supported browsers and must never
// instruct a resident to change a privacy control, a shield, or a security setting to see a
// map. An earlier draft named a specific browser's fingerprinting setting and told the
// resident to turn it down. This section exists so that copy cannot come back — it is the
// half of this file that guards a PRODUCT rule rather than a defect.
const EXPECTED =
  '3D view isn\u2019t available on this device or browser right now. ' +
  'You\u2019ve been returned to the 2D map.';
ok(HS.MAP3D_FALLBACK === EXPECTED,
  '§2 the fallback message is the approved string, character for character', HS.MAP3D_FALLBACK);
ok(HS.MAP3D_FALLBACK_DETAIL === '3D views require WebGL and hardware-accelerated graphics.',
  '§2 the optional secondary line is the approved string', HS.MAP3D_FALLBACK_DETAIL);
// Every failure class yields the SAME resident-facing string. A per-reason message is how
// vendor-specific copy re-enters: one branch gets "helpful" and names a browser.
['nowebgl', 'load', 'init', undefined, 'something-new'].forEach((r) => {
  ok(HS.map3dFailCopy(r) === EXPECTED,
    '§2 reason ' + JSON.stringify(r) + ' yields the same neutral message');
});
// The prohibition, asserted as a prohibition rather than trusted to the string comparison
// above — so it still holds if the approved copy is ever revised.
const BANNED = [
  [/brave/i, 'a browser name (Brave)'], [/chrome|chromium/i, 'a browser name (Chrome)'],
  [/safari/i, 'a browser name (Safari)'], [/firefox/i, 'a browser name (Firefox)'],
  [/edge\b/i, 'a browser name (Edge)'],
  [/shield/i, 'a privacy control (Shields)'], [/fingerprint/i, 'fingerprinting protection'],
  [/settings?\b/i, 'browser settings'], [/\benable\b|\bre-enable\b/i, 'an instruction to enable something'],
  [/\bturn (on|off)\b/i, 'an instruction to turn something on or off'],
  [/\bdisable\b/i, 'an instruction to disable something'],
  [/hardware acceleration\b(?!.*require)/i, 'an instruction about hardware acceleration'],
];
const allCopy = [HS.MAP3D_FALLBACK, HS.MAP3D_FALLBACK_DETAIL, HS.map3dFailCopy('nowebgl')].join(' | ');
BANNED.forEach(([re, what]) => {
  ok(!re.test(allCopy), '§2 the copy never mentions ' + what);
});
// And the page must not carry a second, older copy path that bypasses the helper.
ok(!/Brave|Shields|fingerprint/i.test(page),
  '§2 no browser-specific fallback copy remains anywhere in the page');
ok(!/Brave|Shields|fingerprint/i.test(readFileSync(join(root, 'lib/map.js'), 'utf8').split('\n')
     .filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n')),
  '§2 no browser-specific fallback copy remains in lib/map.js outside its comments');

// ── §3 the page guards BOTH measured failure classes ────────────────────────────────────
// The exact defect: a callback invoked into an empty catch. Its absence is the fix.
// Narrow on purpose: the page carries other, deliberate empty catches (an optional
// setTerrain, a debug export). The defect was specifically the LOADER invoking its
// callback into one, so that is what is asserted gone — and that runLibCb replaced it.
ok(!/cbs\.forEach\(function\(fn\)\{\s*try\{\s*fn\(\);\s*\}catch/.test(page),
  '§3 the loader no longer invokes its callback into an empty catch');
ok(/function runLibCb\(cb, onFail, label\)\{/.test(page),
  '§3 the reporting wrapper replaced it');
ok(/HS\.webglSupported\(document\)/.test(page) && /fail3D\(mode,\s*"nowebgl"\)/.test(page),
  '§3 setView preflights WebGL and routes the no-WebGL case to the failure path');
ok(/homePointOK\(LAST_HOME\)/.test(page),
  '§3 setView refuses a non-finite home before handing it to MapLibre');
// THE TRAP. isFinite(null) === true, so typeof is what actually holds the line.
ok(/typeof h\.lat === "number"/.test(page) && /typeof h\.lng === "number"/.test(page),
  '§3 homePointOK tests typeof, not isFinite alone — isFinite(null) is true');
ok(Number.isFinite(null) === false && isFinite(null) === true,
  '§3 control: the language really does behave the way the guard assumes');
ok(/function fail3D\(/.test(page) && /setView\("2d"\)/.test(page),
  '§3 a failed 3D view falls back to the 2D map rather than stranding a dead panel');
ok(/syncViewSeg\("2d"\)/.test(page),
  '§3 the segmented control follows the fallback, so the highlight stays honest');

// ── §4 the resident is told, in the frame, in every state ───────────────────────────────
ok(/id="mapMsg"/.test(page), '§4 the in-frame notice element exists');
ok(/mapMsg\("3D aerial", "Loading the 3D view…", "load"\)/.test(page),
  '§4 entering 3D aerial shows a loading state, not an unexplained dark panel');
ok(/mapMsg\("3D satellite", "Loading satellite imagery…", "load"\)/.test(page),
  '§4 entering 3D satellite shows a loading state');
ok(/\.map-msg\.mm-bar\{/.test(page),
  '§4 the failure notice has a strip mode — it must not cover the 2D map it falls back to');
ok(/mapMsg\(copy, detail, "fail"\)/.test(page),
  '§4 the fallback renders the approved primary message with the optional secondary line');
ok(/@media \(max-width: 560px\)\{ \.map-msg \.mm-sub\{display:none\} \}/.test(page),
  '§4 the secondary line is dropped where there is no room, rather than growing the strip');
ok(/-webkit-backdrop-filter/.test(page),
  '§4 the notice is styled for WebKit too — this must render on Safari, not only Chromium');
ok(/status\(""\);\s*\/\/ one explanation, not two/.test(page),
  '§4 a load failure shows ONE message, not the loader status plus the strip');
ok(/console\.error\("\[HomeSignal\] " \+ label \+ " failed to start:"/.test(page),
  '§4 the swallowed exception is now logged, so a console error exists to paste');
ok(/GL\.map\.on\("error"/.test(page) && /webglcontextlost/.test(page),
  '§4 MapLibre asynchronous failures are surfaced too — they never reach the loader catch');

// ── §5 the working 2D path is untouched ─────────────────────────────────────────────────
ok(/L\.map\("mapInner", \{ scrollWheelZoom:false \}\)/.test(page),
  '§5 the 2D Leaflet map is constructed exactly as before');
ok(/if\(mode==="2d"\)\{ mapMsg\(\); if\(map\) setTimeout\(function\(\)\{ map\.invalidateSize\(\); \},20\); \}/.test(page),
  '§5 switching back to 2D clears the notice and still invalidates size');

console.log(fails ? `\n${fails} check(s) failed` : '\nAll checks passed');
process.exit(fails ? 1 : 0);
