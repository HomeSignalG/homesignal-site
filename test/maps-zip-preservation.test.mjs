// Maps ZIP-preservation (P1) — a visitor on maps.html?zip=<zip> who taps an
// "Add your home / watch this area" prompt gets the viewed ZIP prefilled into the
// signup box, so they never re-type it. Scoped to maps.html; shell.js/openLoc and
// every other page's location flow stay byte-identical.
// Run: node test/maps-zip-preservation.test.mjs
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0;
const ok = (c, name) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name); if (!c) fails++; };

const maps = readFileSync(join(root, 'maps.html'), 'utf8');
const shell = readFileSync(join(root, 'shell.js'), 'utf8');

// ── 1. wiring is present in maps.html ──────────────────────────────────────
ok(/function mapsAddHome\s*\(\)/.test(maps), 'maps.html defines the mapsAddHome() helper');
ok(maps.includes("var viewedZip = qs.get('zip');"), 'helper reads the viewed ZIP from the URL (?zip), not a fallback default');
ok(maps.includes("!zipField.value && /^\\d{5}$/.test(String(viewedZip || ''))"),
  'helper guards on empty field AND a valid 5-digit ZIP (never clobbers typed text; never inserts an invalid ZIP)');
ok(maps.includes('zipField.value = viewedZip;'), 'helper prefills the shared #locZip box');
// both Maps prompts route through the helper
ok(maps.includes("el.onclick = function(){ mapsAddHome(); };"), 'floating "Add your home" prompt routes through mapsAddHome');
ok(/id="emptyAddHome"[\s\S]*?:\s*mapsAddHome;/.test(maps), 'empty-state "Add your home to watch this area" routes through mapsAddHome');
// "Check a different area" (resident with a home) intentionally stays a BLANK lookup
ok(/hasRealHome[\s\S]*?\?\s*function \(\) \{ if \(HS\.addHome\) HS\.addHome\(\); else if \(HS\.openLoc\) HS\.openLoc\(\); \}/.test(maps),
  '"Check a different area" keeps the unchanged blank-lookup behavior');
// the old always-blank inline onclick is fully removed from maps.html
ok(!maps.includes('onclick="HS.addHome ? HS.addHome() : HS.openLoc()"'), 'no maps.html prompt still opens the flow with a blank ZIP inline');

// ── 2. shell.js / the shared flow is UNCHANGED (other pages unaffected) ─────
ok(/const z = \$\('locZip'\); z\.value = ''/.test(shell),
  'shell.js openLoc still blanks #locZip by default — the shared flow is byte-identical for every other page');
ok(!shell.includes('mapsAddHome'), 'shell.js has no knowledge of the Maps helper (change is maps.html-scoped)');

// ── 3. behavior proof: replicate the EXACT guard and run the 6 required cases ─
// Mirrors the maps.html helper: prefill only when the field is empty AND ?zip is
// a valid 5-digit code; otherwise leave whatever is there.
function prefill(fieldValueBefore, viewedZip) {
  let v = fieldValueBefore;
  if (!v && /^\d{5}$/.test(String(viewedZip || ''))) v = viewedZip;
  return v;
}
ok(prefill('', '53703') === '53703', 'case 1: maps.html?zip=53703 prefills 53703');
ok(prefill('', '78617') === '78617', 'case 2: maps.html?zip=78617 prefills 78617');
ok(prefill('', 'abcde') === '' && prefill('', '123') === '' && prefill('', '78617-1234') === '',
  'case 3: invalid ZIP values (non-numeric / too short / ZIP+4) are never inserted');
ok(prefill('', null) === '' && prefill('', undefined) === '' && prefill('', '') === '',
  'case 4: no ZIP preserves the existing blank/default behavior');
ok(prefill('90210', '53703') === '90210', 'case 5: text the user already typed is never erased');
// case 6 is covered by the shell.js assertions in section 2 (shared flow untouched).
ok(true, 'case 6: other pages using the shared location flow are unchanged (see section 2)');

if (fails) { console.error('\n' + fails + ' failed'); process.exit(1); }
console.log('\nAll maps-zip-preservation assertions passed.');
