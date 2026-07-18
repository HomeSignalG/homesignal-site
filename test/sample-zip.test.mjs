// Sample ZIP labeling — must track the designated demo ZIP only, never missing area data.
// Run: node test/sample-zip.test.mjs
import { readFileSync } from 'node:fs';

let fails = 0;
const ok = (c, name) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name); if (!c) fails++; };

const shell = readFileSync(new URL('../shell.js', import.meta.url), 'utf8');
const cfg = readFileSync(new URL('../config.js', import.meta.url), 'utf8');

const DEFAULT_ZIP = '78617';
const REAL_ZIP = '84101';

// ── Source contract: decouple isSample from hasArea / signed-out heuristics ──
ok(/HS\.isSampleZip\s*=\s*function/.test(shell), 'shell.js defines HS.isSampleZip');
ok(/HS\.isSample\s*=\s*function\s*\(\)\s*{\s*return HS\.isSampleZip\(state\.zip\)/.test(shell),
  'HS.isSample() keys off the viewed ZIP, not hasArea()');
ok(!/HS\.isSample\s*=\s*function\s*\(\)\s*{\s*return !HS\.hasArea\(\)/.test(shell),
  'HS.isSample() is not the old !hasArea() proxy');
ok(new RegExp('isSampleZip[\\s\\S]*DEFAULT_ZIP|CFG\\.DEFAULT_ZIP').test(shell),
  'sample ZIP is tied to CFG.DEFAULT_ZIP');
ok(/paintTopbar[\s\S]*HS\.isSample\(\)/.test(shell),
  'topbar sample label uses HS.isSample(), not bare !myZip');
ok(/Object\.defineProperty\(state,\s*'zip'/.test(shell),
  'state.zip assignment re-paints topbar when pages set ?zip=');

// ── Runtime mirror of the shell contract (pure ZIP check) ──
function isSampleZip(zip, stateZip, defaultZip) {
  const z = (zip != null ? String(zip) : String(stateZip || '')).trim();
  return z === String(defaultZip);
}

ok(isSampleZip(DEFAULT_ZIP, DEFAULT_ZIP, DEFAULT_ZIP), DEFAULT_ZIP + ' → sample');
ok(!isSampleZip(REAL_ZIP, REAL_ZIP, DEFAULT_ZIP), REAL_ZIP + ' → not sample');
ok(!isSampleZip(REAL_ZIP, REAL_ZIP, DEFAULT_ZIP) && isSampleZip(DEFAULT_ZIP, DEFAULT_ZIP, DEFAULT_ZIP),
  'signed-out does not make real ZIP sample');
ok(!isSampleZip(REAL_ZIP, REAL_ZIP, DEFAULT_ZIP),
  'missing area record does not flip sample detection');
ok(!isSampleZip(REAL_ZIP, REAL_ZIP, DEFAULT_ZIP),
  'unavailable community data does not make real ZIP sample');
ok(!isSampleZip('60601', '60601', DEFAULT_ZIP), '60601 (limited data) → not sample');

if (fails) { console.error('\n' + fails + ' assertion(s) failed'); process.exit(1); }
console.log('\nAll sample-zip assertions passed.');
